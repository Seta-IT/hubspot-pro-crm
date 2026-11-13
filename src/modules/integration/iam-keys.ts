// ============================================================================
// STI-hub — IAM: CRUD de chaves de integracao (sessao 2FA + alcada ADMIN de IAM).
//  GET    /api/iam/integration-keys             lista (sem hash, sem segredo)
//  POST   /api/iam/integration-keys             cria; segredo exibido UMA unica vez
//  POST   /api/iam/integration-keys/{id}/revoke revoga
//  DELETE /api/iam/integration-keys/{id}        revoga (alias; o registro e mantido para auditoria)
// O segredo nunca e logado nem gravado: no Postgres so key_prefix + SHA-256.
// ============================================================================
import { z } from 'zod/v4';
import { verifyIamAdminSession } from './auth-context';
import { audit, newRequestId } from './executor';
import { scopesAboveUserAccess } from './use-cases/common';
import { json, postgresUnavailable, problem, readSessionToken, type IntegrationHttpRequest, type IntegrationHttpResponse } from './http';
import { resolveIntegrationDeps, type IntegrationDeps } from './runtime';
import { moduleForScope, portfolioExceeds, PORTFOLIO_SCOPES, validateRequestedScopes } from './scopes';
import type { IntegrationApiKeyRecord } from './store';
import { generateId, generateIntegrationKey } from './tokens';

const MAX_TTL_DAYS = 365;
const DEFAULT_TTL_DAYS = 90;

const CreateKeySchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    scopes: z.array(z.string().max(80)).min(1).max(30),
    portfolioScope: z.enum(PORTFOLIO_SCOPES),
    moduleAccess: z.object({ crm: z.boolean(), chamados: z.boolean() }).strict(),
    ownerUserId: z.string().regex(/^[A-Za-z0-9._@-]{1,120}$/).optional(),
    teamMemberIds: z.array(z.string().regex(/^[A-Za-z0-9._@-]{1,120}$/)).max(200).optional(),
    expiresAt: z.string().datetime({ offset: true }).optional(),
  })
  .strict();

export function toPublicKey(k: IntegrationApiKeyRecord) {
  return {
    id: k.id,
    name: k.name,
    keyPrefix: `stihub_int_${k.keyPrefix}_…`,
    scopes: k.scopes,
    portfolioScope: k.portfolioScope,
    moduleAccess: k.moduleAccess,
    ownerUserId: k.ownerUserId,
    teamMemberIds: k.teamMemberIds,
    createdByUserId: k.createdByUserId,
    expiresAt: k.expiresAt,
    revokedAt: k.revokedAt,
    lastUsedAt: k.lastUsedAt,
    createdAt: k.createdAt,
    status: k.revokedAt ? 'REVOKED' : k.expiresAt && k.expiresAt <= new Date().toISOString() ? 'EXPIRED' : 'ACTIVE',
  };
}

export async function handleIamIntegrationKeys(req: IntegrationHttpRequest, depsIn?: IntegrationDeps): Promise<IntegrationHttpResponse> {
  const deps = depsIn || resolveIntegrationDeps();
  const requestId = newRequestId();
  const startedAt = Date.now();
  const method = req.method.toUpperCase();
  const path = req.path.replace(/\/+$/, '');

  // Sessao 2FA + ADMIN antes de tudo (nem o 503 vaza para quem nao e admin).
  const session = verifyIamAdminSession(readSessionToken(req));
  if (!session.ok || !session.claims) {
    return problem(
      session.status,
      session.code,
      session.status === 403
        ? 'Permissao negada: somente administradores de IAM gerenciam chaves de integracao.'
        : 'Autenticacao corporativa STI-hub + MFA 2FA obrigatoria.'
    );
  }
  const store = deps.store;
  if (!store) return postgresUnavailable();
  const admin = session.claims;
  const log = (
    statusCode: number,
    action: string,
    keyId: string | null,
    errorCode: string | null = null,
    extra: { targetUserId?: string | null; scope?: string | null; details?: Record<string, unknown> | null } = {}
  ) =>
    audit(store, {
      requestId,
      channel: 'iam',
      authType: 'session',
      actorUserId: admin.uid,
      keyId,
      action,
      path,
      statusCode,
      ip: req.ip,
      startedAt,
      errorCode,
      targetUserId: extra.targetUserId ?? null,
      scope: extra.scope ?? null,
      details: extra.details ?? null,
      now: deps.now(),
    });

  const m = /^\/api\/iam\/integration-keys(?:\/([A-Za-z0-9_]{1,80}))?(\/revoke)?$/.exec(path);
  if (!m) return problem(404, 'ROUTE_NOT_FOUND', 'Rota inexistente.');
  const [, id, revokeSuffix] = m;

  if (!id) {
    if (method === 'GET') {
      const list = await store.listApiKeys();
      await log(200, 'iam.integration_keys.list', null);
      return json(200, { data: list.map(toPublicKey), total: list.length });
    }
    if (method === 'POST') {
      const parsed = CreateKeySchema.safeParse(req.body && typeof req.body === 'object' ? req.body : {});
      if (!parsed.success) {
        const fields = [...new Set(parsed.error.issues.map((i) => (i.code === 'unrecognized_keys' ? (i as { keys: string[] }).keys.join(',') : i.path.join('.'))))];
        await log(400, 'iam.integration_keys.create', null, 'VALIDATION_FAILED');
        return problem(400, 'VALIDATION_FAILED', 'Dados invalidos para a chave de integracao.', { fields });
      }
      const input = parsed.data;
      const scopes = validateRequestedScopes(input.scopes);
      if (!scopes.ok) {
        await log(400, 'iam.integration_keys.create', null, scopes.code);
        return problem(400, scopes.code, scopes.code === 'SCOPE_BLOCKED'
          ? 'Escopo bloqueado pela politica CISO (IAM/Admin, DELETE, merge, Sequencias, Fiscal/Financeiro ou GestaoClick).'
          : 'Escopo inexistente no catalogo.', { invalid: scopes.invalid });
      }
      const mismatch = scopes.scopes.filter((s) => {
        const mod = moduleForScope(s);
        return (mod === 'crm' && !input.moduleAccess.crm) || (mod === 'chamados' && !input.moduleAccess.chamados);
      });
      if (mismatch.length) {
        await log(422, 'iam.integration_keys.create', null, 'SCOPE_MODULE_MISMATCH');
        return problem(422, 'SCOPE_MODULE_MISMATCH', 'Escopo exige modulo nao habilitado em moduleAccess.', { invalid: mismatch });
      }
      const ownerUserId = input.ownerUserId || admin.uid;
      const snap = await deps.createDataPort().snapshot('crm');
      const owner = snap.users.find((u) => u.id === ownerUserId);
      if (!owner || !owner.active) {
        await log(422, 'iam.integration_keys.create', null, 'OWNER_INVALID');
        return problem(422, 'OWNER_INVALID', 'Usuario dono inexistente ou inativo.', { fields: ['ownerUserId'] });
      }
      if (portfolioExceeds(input.portfolioScope, owner.portfolioScope)) {
        await log(422, 'iam.integration_keys.create', null, 'PORTFOLIO_EXCEEDS_OWNER');
        return problem(422, 'PORTFOLIO_EXCEEDS_OWNER', 'A carteira da chave nao pode exceder a carteira do usuario dono.', { fields: ['portfolioScope'] });
      }
      if ((input.moduleAccess.crm && !owner.moduleAccess.crm) || (input.moduleAccess.chamados && !owner.moduleAccess.chamados)) {
        await log(422, 'iam.integration_keys.create', null, 'MODULE_EXCEEDS_OWNER');
        return problem(422, 'MODULE_EXCEEDS_OWNER', 'moduleAccess da chave nao pode exceder o do usuario dono.', { fields: ['moduleAccess'] });
      }
      const aboveAccess = scopesAboveUserAccess(scopes.scopes, owner);
      if (aboveAccess.length) {
        await log(422, 'iam.integration_keys.create', null, 'SCOPE_EXCEEDS_OWNER_ACCESS', { targetUserId: owner.id });
        return problem(422, 'SCOPE_EXCEEDS_OWNER_ACCESS', 'Escopo acima da alcada (RBAC) do usuario dono.', { invalid: aboveAccess });
      }
      const team = [...new Set(input.teamMemberIds || [])];
      if (team.some((t) => !snap.users.some((u) => u.id === t))) {
        await log(422, 'iam.integration_keys.create', null, 'TEAM_MEMBER_INVALID');
        return problem(422, 'TEAM_MEMBER_INVALID', 'Membro de equipe inexistente.', { fields: ['teamMemberIds'] });
      }
      const now = deps.now();
      let expiresAt = new Date(now.getTime() + DEFAULT_TTL_DAYS * 86_400_000).toISOString();
      if (input.expiresAt) {
        const t = new Date(input.expiresAt).getTime();
        if (!(t > now.getTime()) || t > now.getTime() + MAX_TTL_DAYS * 86_400_000) {
          await log(422, 'iam.integration_keys.create', null, 'EXPIRY_INVALID');
          return problem(422, 'EXPIRY_INVALID', `expiresAt deve ser futura e no maximo ${MAX_TTL_DAYS} dias.`, { fields: ['expiresAt'] });
        }
        expiresAt = new Date(t).toISOString();
      }
      const gen = generateIntegrationKey();
      const rec: IntegrationApiKeyRecord = {
        id: generateId('ikey'),
        name: input.name,
        keyPrefix: gen.prefix,
        keyHash: gen.hash,
        scopes: scopes.scopes,
        portfolioScope: input.portfolioScope,
        moduleAccess: input.moduleAccess,
        ownerUserId,
        teamMemberIds: input.portfolioScope === 'EQUIPE' ? team : [],
        createdByUserId: admin.uid,
        expiresAt,
        revokedAt: null,
        lastUsedAt: null,
        createdAt: now.toISOString(),
      };
      await store.insertApiKey(rec);
      // Auditoria: dono, escopos, carteira, modulos e validade — NUNCA o segredo nem o hash.
      await log(201, 'iam.integration_keys.create', rec.id, null, {
        targetUserId: rec.ownerUserId,
        scope: rec.scopes.join(' '),
        details: {
          ownerUserId: rec.ownerUserId,
          scopes: rec.scopes,
          portfolioScope: rec.portfolioScope,
          moduleAccess: rec.moduleAccess,
          teamMemberIds: rec.teamMemberIds,
          keyPrefix: rec.keyPrefix,
          expiresAt: rec.expiresAt,
        },
      });
      return json(201, {
        data: toPublicKey(rec),
        secret: gen.token,
        warning: 'Guarde este segredo agora: ele e exibido uma unica vez e nao pode ser recuperado.',
      });
    }
    return problem(405, 'METHOD_NOT_ALLOWED', 'Metodo nao permitido.', {}, { Allow: 'GET, POST' });
  }

  const isRevoke = (method === 'POST' && revokeSuffix) || (method === 'DELETE' && !revokeSuffix);
  if (!isRevoke) return problem(405, 'METHOD_NOT_ALLOWED', 'Use POST /{id}/revoke.', {}, { Allow: revokeSuffix ? 'POST' : 'DELETE' });
  const revoked = await store.revokeApiKey(id, deps.now().toISOString());
  if (!revoked) {
    await log(404, 'iam.integration_keys.revoke', id, 'NOT_FOUND');
    return problem(404, 'NOT_FOUND', 'Chave nao encontrada.');
  }
  await log(200, 'iam.integration_keys.revoke', id, null, { targetUserId: revoked.ownerUserId, scope: revoked.scopes.join(' ') });
  return json(200, { data: toPublicKey(revoked) });
}
