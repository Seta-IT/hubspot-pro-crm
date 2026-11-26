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
import { LOTE3_DANGEROUS_SCOPES, moduleForScope, portfolioExceeds, PORTFOLIO_SCOPES, validateRequestedScopes } from './scopes';
import type { IntegrationApiKeyRecord } from './store';
import { generateId, generateIntegrationKey } from './tokens';
import { fiscalOpsEnabled, isFiscalScope } from './flags';

const MAX_TTL_DAYS = 365;
const DEFAULT_TTL_DAYS = 90;

const CreateKeySchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    scopes: z.array(z.string().max(80)).min(1).max(30),
    /** Lote 3: escopos perigosos so com confirmacao explicita do administrador. */
    confirmDangerousScopes: z.boolean().optional(),
    portfolioScope: z.enum(PORTFOLIO_SCOPES),
    moduleAccess: z.object({ crm: z.boolean(), chamados: z.boolean(), erp: z.boolean().default(false) }).strict(),
    ownerUserId: z.string().regex(/^[A-Za-z0-9._@-]{1,120}$/).optional(),
    teamMemberIds: z.array(z.string().regex(/^[A-Za-z0-9._@-]{1,120}$/)).max(200).optional(),
    expiresAt: z.string().datetime({ offset: true }).optional(),
  })
  .strict();

/** CISO 26/11 (Lote 3, 2): IAM confirma escopos perigosos via OAuth para um cliente (e o verifica) ou usuario. */
const DangerousConfirmationSchema = z
  .object({
    subjectType: z.enum(['client', 'user']),
    subjectId: z.string().regex(/^[A-Za-z0-9._@:-]{1,120}$/),
    scopes: z.array(z.string().max(80)).max(30),
    /** So para subjectType=client: marca o cliente (DCR) como verificado pelo IAM. */
    clientVerified: z.boolean().optional(),
    confirmDangerousScopes: z.literal(true),
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

  // CISO 26/11 (Lote 3, 2): confirmacao de escopos perigosos via OAuth (cliente verificado / usuario).
  const dc = /^\/api\/iam\/integration-keys\/dangerous-confirmations(?:\/(client|user)\/([A-Za-z0-9._@:-]{1,120})\/revoke)?$/.exec(path);
  if (dc) {
    if (!(await store.manualMigrationReady())) {
      await log(503, 'iam.dangerous_confirmations', null, 'MIGRATION_REQUIRED');
      return problem(503, 'MIGRATION_REQUIRED', 'Migracao manual da API v1 nao aplicada (npm run db:migrate:api-v1 -- --apply).');
    }
    const [, revokeType, revokeId] = dc;
    if (revokeType && revokeId) {
      if (method !== 'POST') return problem(405, 'METHOD_NOT_ALLOWED', 'Use POST.');
      const ok = await store.revokeDangerousScopeConfirmation(revokeType as 'client' | 'user', revokeId, deps.now().toISOString());
      await log(ok ? 200 : 404, 'iam.dangerous_confirmations.revoke', null, ok ? null : 'NOT_FOUND', { targetUserId: revokeType === 'user' ? revokeId : null, details: { subjectType: revokeType, subjectId: revokeId } });
      return ok ? json(200, { data: { subjectType: revokeType, subjectId: revokeId, revoked: true } }) : problem(404, 'NOT_FOUND', 'Confirmacao inexistente ou ja revogada.');
    }
    if (method === 'GET') {
      const list = await store.listDangerousScopeConfirmations();
      await log(200, 'iam.dangerous_confirmations.list', null);
      return json(200, { data: list, total: list.length });
    }
    if (method !== 'POST') return problem(405, 'METHOD_NOT_ALLOWED', 'Use GET ou POST.');
    const parsed = DangerousConfirmationSchema.safeParse(req.body && typeof req.body === 'object' ? req.body : {});
    if (!parsed.success) {
      await log(400, 'iam.dangerous_confirmations.set', null, 'VALIDATION_FAILED');
      return problem(400, 'VALIDATION_FAILED', 'Dados invalidos (exige confirmDangerousScopes=true).', { fields: [...new Set(parsed.error.issues.map((i) => i.path.join('.') || '(corpo)'))] });
    }
    const input = parsed.data;
    const scopes = [...new Set(input.scopes)];
    const notDangerous = scopes.filter((sc) => !LOTE3_DANGEROUS_SCOPES.has(sc));
    if (notDangerous.length) {
      await log(422, 'iam.dangerous_confirmations.set', null, 'SCOPE_NOT_DANGEROUS');
      return problem(422, 'SCOPE_NOT_DANGEROUS', 'So escopos perigosos do Lote 3 sao confirmados aqui.', { invalid: notDangerous });
    }
    const fiscal = scopes.filter((sc) => isFiscalScope(sc));
    if (fiscal.length && !fiscalOpsEnabled()) {
      await log(422, 'iam.dangerous_confirmations.set', null, 'FISCAL_OPS_DISABLED');
      return problem(422, 'FISCAL_OPS_DISABLED', 'Operacoes fiscais desligadas nesta instalacao.', { invalid: fiscal });
    }
    if (input.subjectType === 'client') {
      const client = await store.getOAuthClient(input.subjectId);
      if (!client || client.revokedAt) {
        await log(422, 'iam.dangerous_confirmations.set', null, 'CLIENT_INVALID');
        return problem(422, 'CLIENT_INVALID', 'Cliente OAuth inexistente ou revogado.', { fields: ['subjectId'] });
      }
    } else {
      if (input.clientVerified !== undefined) {
        await log(422, 'iam.dangerous_confirmations.set', null, 'VALIDATION_FAILED');
        return problem(422, 'VALIDATION_FAILED', 'clientVerified so vale para subjectType=client.', { fields: ['clientVerified'] });
      }
      const snap = await deps.createDataPort().snapshot('crm');
      const u = snap.users.find((x) => x.id === input.subjectId);
      if (!u || !u.active) {
        await log(422, 'iam.dangerous_confirmations.set', null, 'OWNER_INVALID');
        return problem(422, 'OWNER_INVALID', 'Usuario inexistente ou inativo.', { fields: ['subjectId'] });
      }
      const above = scopesAboveUserAccess(scopes as never, u);
      if (above.length) {
        await log(422, 'iam.dangerous_confirmations.set', null, 'SCOPE_EXCEEDS_OWNER_ACCESS', { targetUserId: u.id });
        return problem(422, 'SCOPE_EXCEEDS_OWNER_ACCESS', 'Escopo acima da alcada (RBAC) do usuario.', { invalid: above });
      }
    }
    const rec = {
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      scopes,
      clientVerified: input.subjectType === 'client' ? input.clientVerified === true : false,
      confirmedByUserId: admin.uid,
      confirmedAt: deps.now().toISOString(),
      revokedAt: null,
    };
    await store.upsertDangerousScopeConfirmation(rec);
    await log(200, 'iam.dangerous_confirmations.set', null, null, { targetUserId: input.subjectType === 'user' ? input.subjectId : null, scope: scopes.join(' '), details: { ...rec } });
    return json(200, { data: rec });
  }

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
          ? 'Escopo bloqueado pela politica CISO (IAM/Admin, DELETE, merge, escrita de Sequencias/Fiscal/Financeiro/ERP ou integracao com o ERP de origem).'
          : 'Escopo inexistente no catalogo.', { invalid: scopes.invalid });
      }
      const fiscalScopes = scopes.scopes.filter((s) => isFiscalScope(s));
      if (fiscalScopes.length && !fiscalOpsEnabled()) {
        await log(422, 'iam.integration_keys.create', null, 'FISCAL_OPS_DISABLED');
        return problem(422, 'FISCAL_OPS_DISABLED', 'Operacoes fiscais desligadas nesta instalacao (INTEGRATION_ENABLE_FISCAL_OPS).', { invalid: fiscalScopes });
      }
      const dangerous = scopes.scopes.filter((s) => LOTE3_DANGEROUS_SCOPES.has(s));
      if (dangerous.length && input.confirmDangerousScopes !== true) {
        await log(422, 'iam.integration_keys.create', null, 'DANGEROUS_SCOPES_CONFIRMATION_REQUIRED');
        return problem(422, 'DANGEROUS_SCOPES_CONFIRMATION_REQUIRED', 'Escopos perigosos (excluir/mesclar/enviar/emitir/baixar...) exigem confirmDangerousScopes=true.', { invalid: dangerous });
      }
      const mismatch = scopes.scopes.filter((s) => {
        const mod = moduleForScope(s);
        return (mod === 'crm' && !input.moduleAccess.crm) || (mod === 'chamados' && !input.moduleAccess.chamados) || (mod === 'erp' && !input.moduleAccess.erp);
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
      if ((input.moduleAccess.crm && !owner.moduleAccess.crm) || (input.moduleAccess.chamados && !owner.moduleAccess.chamados) || (input.moduleAccess.erp && !owner.moduleAccess.erp)) {
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
