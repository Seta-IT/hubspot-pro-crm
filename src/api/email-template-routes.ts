// ============================================================================
// STI-hub — Pacote O (02/11/2026): modelos de e-mail (/api/email-templates).
//   GET    /api/email-templates          -> lista + canManage (qualquer sessao com 2FA; usada ao enviar e-mail)
//   POST   /api/email-templates          -> cria   (2FA + Marketing EDIT/FULL ou admin)
//   GET    /api/email-templates/:id      -> le um  (qualquer sessao com 2FA)
//   PUT    /api/email-templates/:id      -> troca  name/category/subject/body (mesma alcada)
//   PATCH  /api/email-templates/:id      -> altera parte deles                (mesma alcada)
//   DELETE /api/email-templates/:id      -> exclui                            (mesma alcada)
// Regras: zod .strict() com tetos por campo e no corpo (16 KiB); id sempre gerado no servidor
// (o do navegador e ignorado; colisao => 409); createdBy/updatedBy sempre da sessao; recusas
// auditadas (EMAIL_TEMPLATE_WRITE_DENIED). O conteudo e texto puro: o e-mail sai como `text`
// na Resend e a tela renderiza como texto do React (sem HTML).
// O journal do navegador (reconcileClientState) passa por sanitizeEmailTemplateJournal.
// ============================================================================
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { CrmRepository } from '../db/repository';
import type { CrmEmailTemplate } from '../db/types';

export const EMAIL_TEMPLATE_COLLECTION_PATH = '/api/email-templates';
const ITEM_RE = /^\/api\/email-templates\/([^/]+)$/;
export const EMAIL_TEMPLATE_MAX_BODY_BYTES = 16 * 1024;
export const EMAIL_TEMPLATE_LIMITS = Object.freeze({ name: 120, subject: 200, body: 10_000 });
export const EMAIL_TEMPLATE_CATEGORIES = ['PROSPECCAO', 'FOLLOW_UP', 'PROPOSTA', 'DIAGNOSTICO', 'RENOVACAO'] as const;
/** Campos que o navegador ainda envia (ou que vem do journal) e que o servidor sempre ignora. */
export const EMAIL_TEMPLATE_SERVER_FIELDS = ['id', 'createdBy', 'updatedBy', 'usageCount', 'createdAt', 'updatedAt'] as const;

// Linha unica (nome/assunto): sem caracteres de controle (inclui CR/LF), sem bidi/zero-width.
const SINGLE_LINE_BAD = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/;
// Corpo: permite \n, \r e \t; recusa os demais controles e os invisiveis de direcao.
const BODY_BAD = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069\ufeff]/;

const singleLine = (max: number) =>
  z
    .string()
    .transform((s) => s.normalize('NFC').trim())
    .refine((s) => s.length >= 1, 'obrigatorio')
    .refine((s) => s.length <= max, `maximo de ${max} caracteres`)
    .refine((s) => !SINGLE_LINE_BAD.test(s), 'caracteres de controle ou invisiveis nao sao aceitos');

const bodyField = z
  .string()
  .transform((s) => s.normalize('NFC'))
  .refine((s) => s.trim().length >= 1, 'obrigatorio')
  .refine((s) => s.length <= EMAIL_TEMPLATE_LIMITS.body, `maximo de ${EMAIL_TEMPLATE_LIMITS.body} caracteres`)
  .refine((s) => !BODY_BAD.test(s), 'caracteres de controle nao sao aceitos');

const fields = {
  name: singleLine(EMAIL_TEMPLATE_LIMITS.name),
  category: z.enum(EMAIL_TEMPLATE_CATEGORIES),
  subject: singleLine(EMAIL_TEMPLATE_LIMITS.subject),
  body: bodyField,
};

export const emailTemplateCreateSchema = z
  .object({ ...fields, category: fields.category.optional() })
  .strict();
export const emailTemplatePutSchema = z.object(fields).strict();
export const emailTemplatePatchSchema = z
  .object({
    name: fields.name.optional(),
    category: fields.category.optional(),
    subject: fields.subject.optional(),
    body: fields.body.optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, 'informe ao menos um campo');

type Query = Record<string, string | undefined>;
type Ctx = { trustedInternal: boolean; serviceAccount?: boolean };
type ApiResponse = { status: number; body: unknown; headers?: Record<string, string> };

export interface EmailTemplatePrivilege {
  allowed: boolean;
  authenticated: boolean;
  email?: string;
  name?: string;
  roleId?: string;
}

/** Alcada de escrita: sessao com 2FA e (admin IAM ou Marketing EDIT/FULL do perfil efetivo do rbac). */
export function emailTemplateWritePrivilege(repo: CrmRepository, query: Query, ctx: Ctx): EmailTemplatePrivilege {
  if (ctx.trustedInternal) return { allowed: true, authenticated: true, name: 'Sistema STI-hub', email: 'sistema' };
  if (ctx.serviceAccount) return { allowed: false, authenticated: true, email: 'conta-de-servico', name: 'Conta de serviço', roleId: 'SERVICE' };
  const tok = query._sessionToken;
  const sess = tok ? repo.resolveSessionFromToken(tok) : null;
  if (!sess || !sess.authenticated || !sess.user) return { allowed: false, authenticated: false };
  const mkt = String(sess.crmPermissions?.marketingAutomationAccess || 'NONE');
  const allowed = Boolean(
    sess.mfaVerified && (sess.effectiveActionGuards?.canManageUsersRbac === true || mkt === 'EDIT' || mkt === 'FULL')
  );
  return { allowed, authenticated: true, email: sess.user.email, name: sess.user.name, roleId: sess.user.roleId };
}

function audit(
  repo: CrmRepository,
  priv: EmailTemplatePrivilege,
  query: Query,
  action: string,
  resource: string,
  status: 'SUCCESS' | 'BLOCKED',
  details: string
) {
  try {
    repo.appendSecurityAuditLog({
      actorEmail: priv.email || 'desconhecido',
      actorName: priv.name || 'desconhecido',
      actorRole: priv.roleId || 'desconhecido',
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

function byteLength(v: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(v ?? {}), 'utf8');
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function stripServerFields(body: unknown): { clean: Record<string, unknown>; ignored: string[] } | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const clean: Record<string, unknown> = { ...(body as Record<string, unknown>) };
  const ignored: string[] = [];
  for (const k of EMAIL_TEMPLATE_SERVER_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(clean, k)) {
      ignored.push(k);
      delete clean[k];
    }
  }
  return { clean, ignored };
}

function invalid(error: z.ZodError | null, msg = 'Modelo de e-mail inválido.'): ApiResponse {
  return {
    status: 400,
    body: {
      error: msg,
      code: 'EMAIL_TEMPLATE_INVALID_BODY',
      fields: error ? error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })).slice(0, 20) : [],
    },
  };
}

export function isEmailTemplateRoute(cleanPath: string): boolean {
  return cleanPath === EMAIL_TEMPLATE_COLLECTION_PATH || ITEM_RE.test(cleanPath);
}

export function newEmailTemplateId(): string {
  return `tpl-${randomUUID()}`;
}

export function handleEmailTemplateRoute(
  repo: CrmRepository,
  method: string,
  cleanPath: string,
  query: Query,
  body: unknown,
  ctx: Ctx
): ApiResponse {
  const m = method.toUpperCase();
  const itemMatch = ITEM_RE.exec(cleanPath);
  let itemId: string | null = null;
  if (itemMatch) {
    try {
      itemId = decodeURIComponent(itemMatch[1]);
    } catch {
      return { status: 404, body: { error: 'Modelo de e-mail não encontrado.', code: 'EMAIL_TEMPLATE_NOT_FOUND' } };
    }
  }

  // Leitura: o gate do router ja exige sessao com 2FA.
  if (m === 'GET') {
    if (!itemId) {
      const list = repo.listEmailTemplates();
      // canManage: a mesma regra do POST/PUT/PATCH/DELETE, para a tela mostrar o formulario so a quem pode.
      const canManage = emailTemplateWritePrivilege(repo, query, ctx).allowed;
      return { status: 200, body: { data: list, total: list.length, canManage } };
    }
    const tpl = repo.listEmailTemplates().find((t) => t.id === itemId);
    if (!tpl) return { status: 404, body: { error: 'Modelo de e-mail não encontrado.', code: 'EMAIL_TEMPLATE_NOT_FOUND' } };
    return { status: 200, body: { data: tpl } };
  }

  const isWrite = (!itemId && m === 'POST') || (itemId && (m === 'PUT' || m === 'PATCH' || m === 'DELETE'));
  if (!isWrite) {
    return {
      status: 405,
      body: { error: 'Método não permitido para modelos de e-mail.', code: 'METHOD_NOT_ALLOWED' },
      headers: { Allow: itemId ? 'GET, PUT, PATCH, DELETE' : 'GET, POST' },
    };
  }

  const resource = `${m} ${cleanPath}`;
  const priv = emailTemplateWritePrivilege(repo, query, ctx);
  if (!priv.authenticated) {
    return { status: 401, body: { error: 'Sessão corporativa STI-hub com 2FA obrigatória.', code: 'MFA_AUTH_REQUIRED' } };
  }
  if (!priv.allowed) {
    audit(repo, priv, query, 'EMAIL_TEMPLATE_WRITE_DENIED', resource, 'BLOCKED',
      'Criar/alterar/excluir modelo de e-mail exige 2FA e permissão de Marketing (EDIT/FULL) ou administrador.');
    return {
      status: 403,
      body: {
        error: 'Permissão negada: modelos de e-mail exigem permissão de Marketing (editar ou total) ou administrador, com 2FA.',
        code: 'EMAIL_TEMPLATE_FORBIDDEN',
      },
    };
  }

  if (m !== 'DELETE' && byteLength(body) > EMAIL_TEMPLATE_MAX_BODY_BYTES) {
    return {
      status: 413,
      body: { error: 'Modelo de e-mail grande demais.', code: 'EMAIL_TEMPLATE_TOO_LARGE', maxBytes: EMAIL_TEMPLATE_MAX_BODY_BYTES },
    };
  }

  const actor = priv.name || priv.email || 'Sistema STI-hub';

  if (!itemId) {
    const stripped = stripServerFields(body);
    if (!stripped) return invalid(null);
    const parsed = emailTemplateCreateSchema.safeParse(stripped.clean);
    if (!parsed.success) return invalid(parsed.error);
    const id = newEmailTemplateId();
    if (repo.listEmailTemplates().some((t) => t.id === id)) {
      return { status: 409, body: { error: 'Colisão de identificador do modelo. Tente novamente.', code: 'EMAIL_TEMPLATE_ID_COLLISION' } };
    }
    const created = repo.createEmailTemplate({
      id,
      name: parsed.data.name,
      category: parsed.data.category || 'FOLLOW_UP',
      subject: parsed.data.subject,
      body: parsed.data.body,
      createdBy: actor,
      updatedBy: actor,
      usageCount: 0,
    });
    audit(repo, priv, query, 'EMAIL_TEMPLATE_CREATED', resource, 'SUCCESS',
      `Modelo ${created.id} criado${stripped.ignored.length ? `; campos do navegador ignorados: ${stripped.ignored.join(', ')}` : ''}.`);
    return { status: 201, body: { data: created } };
  }

  const current = repo.listEmailTemplates().find((t) => t.id === itemId);
  if (!current) return { status: 404, body: { error: 'Modelo de e-mail não encontrado.', code: 'EMAIL_TEMPLATE_NOT_FOUND' } };

  if (m === 'DELETE') {
    const ok = repo.deleteEmailTemplate(current.id);
    if (!ok) return { status: 404, body: { error: 'Modelo de e-mail não encontrado.', code: 'EMAIL_TEMPLATE_NOT_FOUND' } };
    audit(repo, priv, query, 'EMAIL_TEMPLATE_DELETED', resource, 'SUCCESS', `Modelo ${current.id} ("${current.name.slice(0, 80)}") excluído.`);
    return { status: 200, body: { data: { id: current.id, deleted: true } } };
  }

  const stripped = stripServerFields(body);
  if (!stripped) return invalid(null);
  const parsed = (m === 'PUT' ? emailTemplatePutSchema : emailTemplatePatchSchema).safeParse(stripped.clean);
  if (!parsed.success) return invalid(parsed.error);
  const updated = repo.updateEmailTemplate(current.id, parsed.data as Partial<Pick<CrmEmailTemplate, 'name' | 'category' | 'subject' | 'body'>>, actor);
  if (!updated) return { status: 404, body: { error: 'Modelo de e-mail não encontrado.', code: 'EMAIL_TEMPLATE_NOT_FOUND' } };
  audit(repo, priv, query, 'EMAIL_TEMPLATE_UPDATED', resource, 'SUCCESS',
    `Modelo ${current.id} alterado (${Object.keys(parsed.data).join(', ')}).`);
  return { status: 200, body: { data: updated } };
}

/**
 * Journal do navegador: o journal nunca cria modelo (id novo => descartado; criar so pelo POST),
 * nunca grava autoria/uso/datas e so altera name/category/subject/body com a mesma alcada do PUT.
 * Retorna a lista segura e quantas entradas que mudariam algo foram recusadas por falta de alcada.
 */
export function sanitizeEmailTemplateJournal(
  repo: CrmRepository,
  incoming: unknown,
  priv: EmailTemplatePrivilege
): { safe: CrmEmailTemplate[]; denied: number; droppedNew: number; invalid: number } {
  const out = { safe: [] as CrmEmailTemplate[], denied: 0, droppedNew: 0, invalid: 0 };
  if (!Array.isArray(incoming) || incoming.length === 0) return out;
  const byId = new Map(repo.listEmailTemplates().map((t) => [t.id, t] as const));
  const actor = priv.name || priv.email || 'Sistema STI-hub';
  for (const raw of incoming.slice(0, 500)) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    const cur = typeof r.id === 'string' ? byId.get(r.id) : undefined;
    if (!cur) {
      out.droppedNew++;
      continue;
    }
    const picked: Record<string, unknown> = {};
    for (const k of ['name', 'category', 'subject', 'body'] as const) if (k in r) picked[k] = r[k];
    const parsed = emailTemplatePatchSchema.safeParse(picked);
    if (!parsed.success) {
      out.invalid++;
      continue;
    }
    const changed = (Object.keys(parsed.data) as Array<keyof typeof parsed.data>).some(
      (k) => parsed.data[k] !== (cur as unknown as Record<string, unknown>)[k]
    );
    if (!changed) continue;
    if (!priv.allowed) {
      out.denied++;
      continue;
    }
    out.safe.push({
      ...cur,
      ...parsed.data,
      updatedBy: actor,
      updatedAt: new Date().toISOString(),
    } as CrmEmailTemplate);
  }
  return out;
}
