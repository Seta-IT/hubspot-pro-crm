// ============================================================================
// STI-hub — E-mail individual do CRM pela caixa Outlook 365 do proprio usuario (04/11/2026).
//   GET    /api/mailbox/status                 -> recurso ligado?, minhas caixas, minha assinatura
//   POST   /api/mailbox/connect                -> endereco de login da Microsoft (state + PKCE)
//   POST   /api/mailbox/oauth/complete         -> { code, state } do retorno da Microsoft
//   DELETE /api/mailbox/accounts/:id           -> desconecta (apaga os tokens)
//   PUT    /api/mailbox/signature              -> { signature } (texto puro)
//   POST   /api/mailbox/send                   -> envia pela caixa do usuario (Graph) e registra
//   POST   /api/mailbox/sync                   -> busca respostas/enviados das minhas caixas
//   GET    /api/mailbox/timeline?contactId=|companyId=|dealId=  -> e-mails da ficha
//   GET    /api/mailbox/never-log              -> lista "Nunca registrar" (+ canManage)
//   POST   /api/mailbox/never-log              -> { pattern }   (admin com 2FA)
//   DELETE /api/mailbox/never-log/:pattern     -> remove        (admin com 2FA)
// Regras: sessao com 2FA e modulo CRM (o gate do router ja exige 2FA em rota nao publica);
// conta de servico e contexto interno nao usam caixa de usuario; caixa so do proprio dono;
// tokens nunca saem em resposta; recusas e envios auditados sem conteudo do e-mail.
// ============================================================================
import { z } from 'zod';
import type { CrmRepository } from '../db/repository';
import { SlidingWindowRateLimiter } from './password-reset';
import {
  buildAuthorizeUrl,
  exchangeAuthCode,
  getGraphMe,
  GraphError,
  isMailboxFeatureEnabled,
  listGraphFolderSince,
  newOAuthState,
  newPkcePair,
  OAUTH_STATE_TTL_MS,
  refreshGraphTokens,
  resolveMsGraphConfig,
  sendGraphMail,
  type FetchLike,
  type GraphTokens,
} from '../modules/email/ms-graph';
import { openMailboxSecret, sealMailboxSecret } from '../modules/email/mailbox-crypto';
import { buildTrackedEmailBody, newTrackingId } from '../modules/email/mail-tracking';
import { normalizeEmailAddress, normalizeNeverLogPattern, NEVER_LOG_MAX_ENTRIES, shouldLogEmail } from '../modules/email/never-log';
import {
  newMailboxId,
  toPublicAccount,
  toTimelineEmail,
  type CrmEmailMessage,
  type MailboxAccount,
  type MailboxStore,
} from '../modules/email/mailbox-store';

export const MAILBOX_PATH_PREFIX = '/api/mailbox';
export const MAILBOX_SIGNATURE_MAX = 4000;
export const MAILBOX_SEND_LIMIT = Object.freeze({ max: 60, windowMs: 60 * 60 * 1000 });
export const MAILBOX_MAX_RECIPIENTS = 20;
export const MAILBOX_SYNC_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;

/** Textos para o usuario (sem detalhes tecnicos). */
export const MAILBOX_MESSAGES = Object.freeze({
  disabled: 'A conexão de caixas de e-mail ainda não foi liberada pelo administrador.',
  reconnect: 'Sua caixa de e-mail precisa ser conectada novamente.',
  noAccount: 'Conecte sua caixa de e-mail em Minha Conta para enviar pelo seu endereço.',
  sendFailed: 'Não foi possível enviar o e-mail agora. Tente novamente em instantes.',
  connectFailed: 'Não foi possível concluir a conexão com a Microsoft. Tente novamente.',
});

type Query = Record<string, string | undefined>;
type Ctx = { trustedInternal: boolean; serviceAccount?: boolean };
type ApiResponse = { status: number; body: unknown; headers?: Record<string, string> };

export interface MailboxDeps {
  repo: CrmRepository;
  store: MailboxStore;
  fetch: FetchLike;
  sendLimiter: SlidingWindowRateLimiter;
}

export function newMailboxSendLimiter(): SlidingWindowRateLimiter {
  return new SlidingWindowRateLimiter(MAILBOX_SEND_LIMIT.max, MAILBOX_SEND_LIMIT.windowMs);
}

export function isMailboxRoute(cleanPath: string): boolean {
  return cleanPath === MAILBOX_PATH_PREFIX || cleanPath.startsWith(`${MAILBOX_PATH_PREFIX}/`);
}

interface MailboxActor {
  email: string;
  name: string;
  roleId: string;
  isAdmin: boolean;
  access: { contact: boolean; company: boolean; deal: boolean };
  /** Id do usuario (dono dos registros) e escopo de dados do RBAC. */
  id?: string;
  scope?: string;
}

/**
 * Parecer CISO 04/11 (item 1): escopo Proprios/Equipe na linha do tempo. Mesmo criterio das
 * propostas (M2): EQUIPE = PROPRIOS, dono pelo ownerId (id ou e-mail do usuario), nunca pelo nome.
 * Admin de usuarios ou escopo TODOS ve tudo.
 */
export function isMailboxScopeRestricted(actor: Pick<MailboxActor, 'isAdmin' | 'scope'>): boolean {
  return !actor.isAdmin && String(actor.scope || 'PROPRIOS') !== 'TODOS';
}

function ownedBy(ownerId: unknown, actor: Pick<MailboxActor, 'id' | 'email'>): boolean {
  const o = String(ownerId || '').trim().toLowerCase();
  if (!o) return false;
  return o === String(actor.id || '').trim().toLowerCase() || o === String(actor.email || '').trim().toLowerCase();
}

export function canSeeRecordInScope(repo: CrmRepository, actor: MailboxActor, ref: { contactId?: string | null; companyId?: string | null; dealId?: string | null }): boolean {
  if (!isMailboxScopeRestricted(actor)) return true;
  if (ref.contactId) return ownedBy(repo.getContactById(ref.contactId)?.ownerId, actor);
  if (ref.dealId) return ownedBy(repo.getDealById(ref.dealId)?.ownerId, actor);
  if (ref.companyId) {
    const cid = ref.companyId;
    const contacts = repo.listContacts() as Array<{ ownerId?: string | null; companyId?: string | null }>;
    if (contacts.some((c) => c.companyId === cid && ownedBy(c.ownerId, actor))) return true;
    const deals = (repo as unknown as { listDeals?: () => Array<{ ownerId?: string | null; companyId?: string | null }> }).listDeals?.() || [];
    return deals.some((d) => d.companyId === cid && ownedBy(d.ownerId, actor));
  }
  return false;
}

function resolveActor(repo: CrmRepository, query: Query, ctx: Ctx): MailboxActor | ApiResponse {
  if (ctx.serviceAccount || ctx.trustedInternal) {
    return { status: 403, body: { error: 'Recurso disponível só para usuários.', code: 'MAILBOX_USER_ONLY' } };
  }
  const tok = query._sessionToken;
  const sess = tok ? repo.resolveSessionFromToken(tok) : null;
  if (!sess || !sess.authenticated || !sess.user || !sess.mfaVerified) {
    return { status: 401, body: { error: 'Sessão corporativa STI-hub com 2FA obrigatória.', code: 'MFA_AUTH_REQUIRED' } };
  }
  if (!sess.moduleAccess?.crm) {
    return { status: 403, body: { error: 'Seu perfil não tem acesso ao CRM.', code: 'MAILBOX_CRM_FORBIDDEN' } };
  }
  const perm = sess.crmPermissions || ({} as Record<string, string>);
  const lvl = (k: string) => String((perm as unknown as Record<string, string>)[k] || 'NONE') !== 'NONE';
  return {
    email: String(sess.user.email || '').toLowerCase(),
    name: String(sess.user.name || sess.user.email || ''),
    roleId: String(sess.user.roleId || ''),
    isAdmin: sess.effectiveActionGuards?.canManageUsersRbac === true,
    access: { contact: lvl('contactsAccess'), company: lvl('companiesAccess'), deal: lvl('dealsFunnelAccess') },
    id: String(sess.user.id || ''),
    scope: String((sess.user as { scope?: string }).scope || 'PROPRIOS'),
  };
}

function audit(repo: CrmRepository, actor: Pick<MailboxActor, 'email' | 'name' | 'roleId'>, query: Query, action: string, resource: string, status: 'SUCCESS' | 'BLOCKED', details: string) {
  try {
    repo.appendSecurityAuditLog({
      actorEmail: actor.email || 'desconhecido',
      actorName: actor.name || 'desconhecido',
      actorRole: actor.roleId || 'desconhecido',
      action,
      module: 'CRM',
      resource: resource.slice(0, 200),
      status,
      ipAddress: String(query._clientIp || 'sem-ip').slice(0, 64),
      details: details.slice(0, 500),
    });
  } catch {
    // auditoria nunca derruba a resposta
  }
}

const SINGLE_LINE_BAD = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/;
const BODY_BAD = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069\ufeff]/;
const EMAIL_RE = /^[^\s@<>(),;:"\\[\]]{1,64}@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i;

const addrList = z
  .union([z.string().max(4000), z.array(z.string().max(254)).max(MAILBOX_MAX_RECIPIENTS)])
  .optional()
  .transform((v) => (Array.isArray(v) ? v : String(v || '').split(/[;,]/)).map(normalizeEmailAddress).filter(Boolean))
  .refine((l) => l.every((a) => EMAIL_RE.test(a)), 'endereço de e-mail inválido')
  .transform((l) => [...new Set(l)]);

const recId = z.string().trim().min(1).max(200).optional().nullable();

export const mailboxSendSchema = z
  .object({
    accountId: z.string().trim().min(1).max(200).optional(),
    to: addrList,
    cc: addrList,
    subject: z
      .string()
      .transform((s) => s.normalize('NFC').trim())
      .refine((s) => s.length >= 1 && s.length <= 200, 'assunto obrigatório (até 200 caracteres)')
      .refine((s) => !SINGLE_LINE_BAD.test(s), 'caracteres inválidos no assunto'),
    body: z
      .string()
      .max(20_000)
      .transform((s) => s.normalize('NFC'))
      .refine((s) => !BODY_BAD.test(s), 'caracteres inválidos no corpo'),
    contactId: recId,
    companyId: recId,
    dealId: recId,
    track: z.boolean().optional(),
  })
  .strict()
  .refine((v) => v.to.length >= 1, { message: 'informe ao menos um destinatário', path: ['to'] })
  .refine((v) => v.to.length + v.cc.length <= MAILBOX_MAX_RECIPIENTS, { message: `até ${MAILBOX_MAX_RECIPIENTS} destinatários`, path: ['to'] })
  .refine((v) => Boolean(v.contactId || v.companyId || v.dealId), { message: 'e-mail precisa estar ligado a uma ficha', path: ['contactId'] });

function invalid(error: z.ZodError | null, msg = 'Dados do e-mail inválidos.'): ApiResponse {
  return {
    status: 400,
    body: { error: msg, code: 'MAILBOX_INVALID_BODY', fields: error ? error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })).slice(0, 20) : [] },
  };
}

const disabledResponse = (): ApiResponse => ({ status: 503, body: { error: MAILBOX_MESSAGES.disabled, code: 'MAILBOX_DISABLED' } });

/** Ficha existe e o perfil enxerga esse tipo de registro. */
function checkRecordAccess(repo: CrmRepository, actor: MailboxActor, ref: { contactId?: string | null; companyId?: string | null; dealId?: string | null }): string | null {
  if (ref.contactId && (!actor.access.contact || !repo.getContactById(ref.contactId))) return 'contato';
  if (ref.companyId && (!actor.access.company || !repo.getCompanyById(ref.companyId))) return 'empresa';
  if (ref.dealId && (!actor.access.deal || !repo.getDealById(ref.dealId))) return 'negócio';
  return null;
}

/** Token de acesso valido (renova se preciso). Falha de renovacao => caixa em RECONECTAR. */
export async function getAccessToken(deps: MailboxDeps, account: MailboxAccount): Promise<string | null> {
  const cfg = resolveMsGraphConfig();
  if (!cfg || !account.tokenCipher || account.status !== 'ATIVADO') return null;
  let tokens: GraphTokens;
  try {
    tokens = JSON.parse(openMailboxSecret(account.tokenCipher, account.id)) as GraphTokens;
  } catch {
    await deps.store.updateAccount(account.id, { status: 'RECONECTAR', tokenCipher: null });
    return null;
  }
  if (tokens.expiresAt > Date.now() + 30_000) return tokens.accessToken;
  try {
    const next = await refreshGraphTokens(cfg, deps.fetch, tokens.refreshToken);
    await deps.store.updateAccount(account.id, { tokenCipher: sealMailboxSecret(JSON.stringify(next), account.id), tokenExpiresAt: next.expiresAt });
    return next.accessToken;
  } catch {
    await deps.store.updateAccount(account.id, { status: 'RECONECTAR', tokenCipher: null });
    return null;
  }
}

function contactIndex(repo: CrmRepository): Map<string, { id: string; companyId: string | null }> {
  const map = new Map<string, { id: string; companyId: string | null }>();
  for (const c of repo.listContacts()) {
    const e = normalizeEmailAddress(c.email);
    if (e && !map.has(e)) map.set(e, { id: c.id, companyId: (c as { companyId?: string | null }).companyId || null });
  }
  return map;
}

export interface MailboxSyncResult {
  accounts: number;
  received: number;
  sent: number;
  skipped: number;
  needsReconnect: number;
}

/** Sincroniza as caixas informadas: respostas (inbox) e enviados pelo Outlook (sentitems). */
export async function syncMailboxes(deps: MailboxDeps, accounts: MailboxAccount[]): Promise<MailboxSyncResult> {
  const out: MailboxSyncResult = { accounts: 0, received: 0, sent: 0, skipped: 0, needsReconnect: 0 };
  const patterns = (await deps.store.listNeverLog()).map((e) => e.pattern);
  const contacts = contactIndex(deps.repo);
  for (const acc of accounts) {
    if (acc.status !== 'ATIVADO') continue;
    const token = await getAccessToken(deps, acc);
    if (!token) {
      out.needsReconnect++;
      continue;
    }
    out.accounts++;
    for (const folder of ['inbox', 'sentitems'] as const) {
      const sinceField = folder === 'inbox' ? 'lastSyncInboxAt' : 'lastSyncSentAt';
      const since = acc[sinceField] || new Date(Date.now() - MAILBOX_SYNC_LOOKBACK_MS).toISOString();
      let list;
      try {
        list = await listGraphFolderSince(deps.fetch, token, folder, since);
      } catch (e) {
        if (e instanceof GraphError && e.status === 401) await deps.store.updateAccount(acc.id, { status: 'RECONECTAR' });
        continue;
      }
      let maxAt = since;
      for (const m of list) {
        if (m.at > maxAt) maxAt = m.at;
        const counterpart = folder === 'inbox' ? [m.from] : [...m.to, ...m.cc];
        if (!shouldLogEmail(counterpart, patterns)) {
          out.skipped++;
          continue;
        }
        const thread = m.conversationId ? await deps.store.findByConversation(m.conversationId) : null;
        let contactId = thread?.contactId || null;
        let companyId = thread?.companyId || null;
        const dealId = thread?.dealId || null;
        if (!thread) {
          const hit = counterpart.map((a) => contacts.get(a)).find(Boolean);
          if (hit) {
            contactId = hit.id;
            companyId = hit.companyId;
          }
        }
        if (!contactId && !companyId && !dealId) {
          out.skipped++;
          continue;
        }
        const rec: CrmEmailMessage = {
          id: newMailboxId('eml'),
          accountId: acc.id,
          ownerEmail: acc.ownerEmail,
          externalId: `graph:${m.id}`,
          conversationId: m.conversationId,
          internetMessageId: m.internetMessageId,
          direction: folder === 'inbox' ? 'RECEBIDO' : 'ENVIADO',
          source: 'OUTLOOK',
          fromAddress: m.from,
          fromName: m.fromName,
          to: m.to,
          cc: m.cc,
          subject: m.subject,
          bodyPreview: m.bodyPreview.slice(0, 500),
          occurredAt: new Date(m.at).toISOString(),
          contactId,
          companyId,
          dealId,
          trackingId: null,
          links: [],
          openCount: 0,
          clickCount: 0,
          lastOpenedAt: null,
          lastClickedAt: null,
          createdAt: new Date().toISOString(),
        };
        if (await deps.store.insertMessage(rec)) {
          if (folder === 'inbox') out.received++;
          else out.sent++;
        }
      }
      await deps.store.updateAccount(acc.id, { [sinceField]: maxAt } as Partial<MailboxAccount>);
    }
  }
  return out;
}

export async function handleMailboxRoute(
  deps: MailboxDeps,
  method: string,
  cleanPath: string,
  query: Query,
  body: unknown
,
  ctx: Ctx
): Promise<ApiResponse> {
  const m = method.toUpperCase();
  const actorOrErr = resolveActor(deps.repo, query, ctx);
  if ('status' in actorOrErr) return actorOrErr;
  const actor = actorOrErr;
  const sub = cleanPath.slice(MAILBOX_PATH_PREFIX.length) || '/';
  const enabled = isMailboxFeatureEnabled();
  const b = (body && typeof body === 'object' && !Array.isArray(body) ? body : {}) as Record<string, unknown>;

  // Parecer CISO 04/11: recurso desligado (sem app da Microsoft ou sem STI_HUB_MAILBOX_ENC_KEY)
  // nao toca o banco (nem cria as tabelas): status neutro, linha do tempo vazia, resto 503.
  if (!enabled) {
    if (sub === '/status' && m === 'GET') {
      return {
        status: 200,
        body: { data: { enabled: false, message: MAILBOX_MESSAGES.disabled, accounts: [], signature: null, canManageNeverLog: actor.isAdmin } },
      };
    }
    if (sub === '/timeline' && m === 'GET') return { status: 200, body: { data: [], total: 0 } };
    return disabledResponse();
  }

  // ---------------------------------------------------------------- status
  if (sub === '/status' && m === 'GET') {
    const accounts = enabled ? (await deps.store.listAccounts(actor.email)).map(toPublicAccount) : [];
    const signature = await deps.store.getSignature(actor.email);
    return {
      status: 200,
      body: { data: { enabled, message: enabled ? null : MAILBOX_MESSAGES.disabled, accounts, signature, canManageNeverLog: actor.isAdmin } },
    };
  }

  // ---------------------------------------------------------------- assinatura
  if (sub === '/signature' && m === 'PUT') {
    const sig = typeof b.signature === 'string' ? b.signature.normalize('NFC').replace(/\r\n/g, '\n') : null;
    if (sig === null || sig.length > MAILBOX_SIGNATURE_MAX || BODY_BAD.test(sig) || Object.keys(b).some((k) => k !== 'signature')) {
      return invalid(null, `Assinatura inválida (até ${MAILBOX_SIGNATURE_MAX} caracteres, texto simples).`);
    }
    await deps.store.setSignature(actor.email, sig.trim());
    return { status: 200, body: { data: { signature: sig.trim() } } };
  }

  // ---------------------------------------------------------------- nunca registrar
  if (sub === '/never-log' && m === 'GET') {
    return { status: 200, body: { data: await deps.store.listNeverLog(), canManage: actor.isAdmin } };
  }
  if ((sub === '/never-log' && m === 'POST') || (sub.startsWith('/never-log/') && m === 'DELETE')) {
    if (!actor.isAdmin) {
      audit(deps.repo, actor, query, 'EMAIL_NEVER_LOG_DENIED', `${m} ${cleanPath}`, 'BLOCKED', 'Alterar a lista Nunca registrar exige administrador com 2FA.');
      return { status: 403, body: { error: 'Só administradores podem alterar a lista Nunca registrar.', code: 'MAILBOX_NEVER_LOG_FORBIDDEN' } };
    }
    if (m === 'POST') {
      const pattern = normalizeNeverLogPattern(b.pattern);
      if (!pattern || Object.keys(b).some((k) => k !== 'pattern')) return invalid(null, 'Informe um domínio ou e-mail válido (ex.: *@empresa.com.br).');
      if ((await deps.store.listNeverLog()).length >= NEVER_LOG_MAX_ENTRIES) return invalid(null, 'Limite da lista atingido.');
      const added = await deps.store.addNeverLog(pattern, actor.name);
      audit(deps.repo, actor, query, 'EMAIL_NEVER_LOG_ADDED', `${m} ${cleanPath}`, 'SUCCESS', `Padrao ${pattern} ${added ? 'incluido' : 'ja existia'}.`);
      return { status: added ? 201 : 200, body: { data: { pattern, added } } };
    }
    let raw = '';
    try {
      raw = decodeURIComponent(sub.slice('/never-log/'.length));
    } catch {
      return invalid(null);
    }
    const pattern = normalizeNeverLogPattern(raw);
    if (!pattern) return invalid(null);
    const removed = await deps.store.removeNeverLog(pattern);
    if (!removed) return { status: 404, body: { error: 'Item não encontrado na lista.', code: 'MAILBOX_NEVER_LOG_NOT_FOUND' } };
    audit(deps.repo, actor, query, 'EMAIL_NEVER_LOG_REMOVED', `${m} ${cleanPath}`, 'SUCCESS', `Padrao ${pattern} removido.`);
    return { status: 200, body: { data: { pattern, removed: true } } };
  }

  // ---------------------------------------------------------------- linha do tempo
  if (sub === '/timeline' && m === 'GET') {
    const ref = { contactId: query.contactId || null, companyId: query.companyId || null, dealId: query.dealId || null };
    const set = Object.values(ref).filter(Boolean).length;
    if (set !== 1) return invalid(null, 'Informe uma ficha (contato, empresa ou negócio).');
    const denied = checkRecordAccess(deps.repo, actor, ref);
    if (denied) return { status: 404, body: { error: 'Ficha não encontrada.', code: 'MAILBOX_RECORD_NOT_FOUND' } };
    if (!canSeeRecordInScope(deps.repo, actor, ref)) return { status: 404, body: { error: 'Ficha não encontrada.', code: 'MAILBOX_RECORD_NOT_FOUND' } };
    const list = await deps.store.listForRecord(ref, 100);
    return { status: 200, body: { data: list.map(toTimelineEmail), total: list.length } };
  }

  // A partir daqui o recurso precisa estar ligado.
  if (!enabled) return disabledResponse();
  const cfg = resolveMsGraphConfig()!;

  // ---------------------------------------------------------------- conectar
  if (sub === '/connect' && m === 'POST') {
    const state = newOAuthState();
    const pkce = newPkcePair();
    await deps.store.saveOAuthState({
      state,
      ownerEmail: actor.email,
      verifierCipher: sealMailboxSecret(pkce.verifier, `state:${state}`),
      expiresAt: Date.now() + OAUTH_STATE_TTL_MS,
    });
    const hint = typeof b.loginHint === 'string' && EMAIL_RE.test(b.loginHint.trim()) ? b.loginHint.trim().toLowerCase() : undefined;
    return { status: 200, body: { data: { authorizeUrl: buildAuthorizeUrl(cfg, state, pkce.challenge, hint) } } };
  }

  if (sub === '/oauth/complete' && m === 'POST') {
    const code = typeof b.code === 'string' && b.code.length <= 4096 ? b.code : '';
    const state = typeof b.state === 'string' && /^[A-Za-z0-9_-]{20,64}$/.test(b.state) ? b.state : '';
    if (!code || !state) return invalid(null, MAILBOX_MESSAGES.connectFailed);
    const rec = await deps.store.consumeOAuthState(state);
    if (!rec || rec.ownerEmail !== actor.email) {
      audit(deps.repo, actor, query, 'MAILBOX_CONNECT_DENIED', `${m} ${cleanPath}`, 'BLOCKED', 'state ausente, expirado ou de outro usuario.');
      return { status: 400, body: { error: MAILBOX_MESSAGES.connectFailed, code: 'MAILBOX_STATE_INVALID' } };
    }
    try {
      const verifier = openMailboxSecret(rec.verifierCipher, `state:${state}`);
      const tokens = await exchangeAuthCode(cfg, deps.fetch, code, verifier);
      const me = await getGraphMe(deps.fetch, tokens.accessToken);
      const existing = (await deps.store.listAccounts(actor.email)).find((a) => a.mailboxAddress === me.address);
      const id = existing?.id || newMailboxId('mbx');
      const saved = await deps.store.upsertAccount({
        id,
        ownerEmail: actor.email,
        mailboxAddress: me.address,
        displayName: me.displayName,
        status: 'ATIVADO',
        tokenCipher: sealMailboxSecret(JSON.stringify(tokens), id),
        tokenExpiresAt: tokens.expiresAt,
        lastSyncInboxAt: existing?.lastSyncInboxAt || null,
        lastSyncSentAt: existing?.lastSyncSentAt || null,
      });
      // AAD usa o id: se o upsert manteve outro id (corrida), regrava com o id final.
      if (saved.id !== id) await deps.store.updateAccount(saved.id, { tokenCipher: sealMailboxSecret(JSON.stringify(tokens), saved.id) });
      audit(deps.repo, actor, query, 'MAILBOX_CONNECTED', `${m} ${cleanPath}`, 'SUCCESS', `Caixa ${me.address} conectada.`);
      return { status: 200, body: { data: toPublicAccount(saved) } };
    } catch {
      audit(deps.repo, actor, query, 'MAILBOX_CONNECT_FAILED', `${m} ${cleanPath}`, 'BLOCKED', 'falha na troca do codigo ou leitura do perfil.');
      return { status: 502, body: { error: MAILBOX_MESSAGES.connectFailed, code: 'MAILBOX_CONNECT_FAILED' } };
    }
  }

  // ---------------------------------------------------------------- desconectar
  if (sub.startsWith('/accounts/') && m === 'DELETE') {
    const id = sub.slice('/accounts/'.length);
    const ok = /^[A-Za-z0-9_-]{1,200}$/.test(id) && (await deps.store.deleteAccount(id, actor.email));
    if (!ok) return { status: 404, body: { error: 'Caixa não encontrada.', code: 'MAILBOX_NOT_FOUND' } };
    audit(deps.repo, actor, query, 'MAILBOX_DISCONNECTED', `${m} ${cleanPath}`, 'SUCCESS', `Caixa ${id} desconectada.`);
    return { status: 200, body: { data: { id, disconnected: true } } };
  }

  // ---------------------------------------------------------------- enviar
  if (sub === '/send' && m === 'POST') {
    const parsed = mailboxSendSchema.safeParse(body);
    if (!parsed.success) return invalid(parsed.error);
    const v = parsed.data;
    const denied = checkRecordAccess(deps.repo, actor, v);
    if (denied) return { status: 404, body: { error: 'Ficha não encontrada.', code: 'MAILBOX_RECORD_NOT_FOUND' } };
    const accounts = (await deps.store.listAccounts(actor.email)).filter((a) => a.status === 'ATIVADO');
    const account = v.accountId ? accounts.find((a) => a.id === v.accountId) : accounts[0];
    if (!account) return { status: 409, body: { error: MAILBOX_MESSAGES.noAccount, code: 'MAILBOX_NO_ACCOUNT' } };
    if (!deps.sendLimiter.hit(actor.email)) {
      return { status: 429, body: { error: 'Muitos e-mails em pouco tempo. Aguarde alguns minutos.', code: 'MAILBOX_RATE_LIMITED' } };
    }
    const token = await getAccessToken(deps, account);
    if (!token) return { status: 409, body: { error: MAILBOX_MESSAGES.reconnect, code: 'MAILBOX_RECONNECT' } };

    const patterns = (await deps.store.listNeverLog()).map((e) => e.pattern);
    const logIt = shouldLogEmail([...v.to, ...v.cc], patterns);
    const track = logIt && v.track !== false;
    const trackingId = track ? newTrackingId() : null;
    const signature = await deps.store.getSignature(actor.email);
    const built = buildTrackedEmailBody({ body: v.body, signature, trackingId });
    let sent;
    try {
      sent = await sendGraphMail(deps.fetch, token, { to: v.to, cc: v.cc, subject: v.subject, html: built.html });
    } catch (e) {
      if (e instanceof GraphError && e.status === 401) await deps.store.updateAccount(account.id, { status: 'RECONECTAR' });
      audit(deps.repo, actor, query, 'MAILBOX_SEND_FAILED', `${m} ${cleanPath}`, 'BLOCKED', `Falha no envio pela caixa ${account.mailboxAddress}.`);
      return { status: 502, body: { error: MAILBOX_MESSAGES.sendFailed, code: 'MAILBOX_SEND_FAILED' } };
    }
    let item = null;
    if (logIt) {
      const rec: CrmEmailMessage = {
        id: newMailboxId('eml'),
        accountId: account.id,
        ownerEmail: actor.email,
        externalId: `graph:${sent.id}`,
        conversationId: sent.conversationId,
        internetMessageId: sent.internetMessageId,
        direction: 'ENVIADO',
        source: 'STI_HUB',
        fromAddress: account.mailboxAddress,
        fromName: account.displayName || actor.name,
        to: v.to,
        cc: v.cc,
        subject: v.subject,
        bodyPreview: built.text.replace(/\s+/g, ' ').trim().slice(0, 500),
        occurredAt: new Date().toISOString(),
        contactId: v.contactId || null,
        companyId: v.companyId || null,
        dealId: v.dealId || null,
        trackingId,
        links: built.links,
        openCount: 0,
        clickCount: 0,
        lastOpenedAt: null,
        lastClickedAt: null,
        createdAt: new Date().toISOString(),
      };
      await deps.store.insertMessage(rec);
      item = toTimelineEmail(rec);
    }
    audit(deps.repo, actor, query, 'MAILBOX_EMAIL_SENT', `${m} ${cleanPath}`, 'SUCCESS',
      `E-mail enviado pela caixa ${account.mailboxAddress} para ${v.to.length + v.cc.length} destinatario(s); registrado: ${logIt ? 'sim' : 'nao'}.`);
    return { status: 201, body: { data: { sent: true, logged: logIt, tracked: track, email: item } } };
  }

  // ---------------------------------------------------------------- sincronizar
  if (sub === '/sync' && m === 'POST') {
    const result = await syncMailboxes(deps, await deps.store.listAccounts(actor.email));
    return { status: 200, body: { data: result } };
  }

  return { status: 404, body: { error: 'Rota de e-mail não encontrada.', code: 'MAILBOX_ROUTE_NOT_FOUND' } };
}
