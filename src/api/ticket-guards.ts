// ============================================================================
// Pacote H (30/10/2026): guardas das rotas de chamados da EQUIPE (router).
//  - PATCH /api/tickets/:id: zod .strict() com allowlist do que a equipe edita (campos usados
//    pelo ServiceDeskTab + metadados de triagem). comments, csatScore, firstRespondedAt,
//    resolvedAt, contactId, datas/estado de SLA, chave, canal, datas e IDs sao RECUSADOS (400).
//    Comentario => POST /api/tickets/:id/comments. CSAT => so o portal do cliente.
//  - Comentario da equipe: authorRole SEMPRE 'AGENT' (so o portal grava CUSTOMER); isInternal
//    e true salvo `isInternal: false` explicito (publicar exige intencao + auditoria).
//  - send-email: comentario so e PUBLICO se TODOS os destinatarios (to, cc, bcc) forem o
//    e-mail do solicitante/contato do chamado (comparacao normalizada); senao, interno.
// ============================================================================
import { z } from 'zod';

const str = (max: number) => z.string().trim().max(max);

export const TicketTeamPatchSchema = z
  .object({
    status: z.enum(['OPEN', 'IN_PROGRESS', 'WAITING_CUSTOMER', 'RESOLVED', 'CLOSED']).optional(),
    priority: z.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']).optional(),
    category: z.enum(['INCIDENT', 'SUPPORT', 'BILLING', 'BUG', 'FEATURE_REQUEST']).optional(),
    assignee: str(160).min(1).optional(), // responsavel / fila NOC
    subject: str(300).min(1).optional(),
    description: str(10000).optional(),
    resolution: str(10000).nullable().optional(),
    equipmentSerial: str(120).nullable().optional(),
    contractId: str(120).nullable().optional(),
    tags: z.array(str(60)).max(30).optional(),
  })
  .strict();

export type TicketTeamPatch = z.infer<typeof TicketTeamPatchSchema>;

/** 400 com a lista de campos recusados/invalidos (sem eco de valores). */
export function parseTicketTeamPatch(
  body: unknown
): { ok: true; data: TicketTeamPatch } | { ok: false; fields: string[] } {
  const r = TicketTeamPatchSchema.safeParse(body && typeof body === 'object' ? body : {});
  if (r.success) return { ok: true, data: r.data };
  const fields = new Set<string>();
  for (const issue of r.error.issues) {
    if (issue.code === 'unrecognized_keys') for (const k of issue.keys) fields.add(k);
    else fields.add(issue.path.join('.') || '(corpo)');
  }
  return { ok: false, fields: [...fields] };
}

/** isInternal: true por padrao; so `false` (boolean) explicito publica. */
export function resolveTeamCommentVisibility(raw: unknown): boolean {
  return raw === false ? false : true;
}

export function normalizeRecipientEmail(v: unknown): string {
  return String(v ?? '')
    .trim()
    .replace(/^.*<([^>]+)>\s*$/, '$1') // "Nome <email>"
    .trim()
    .toLowerCase();
}

export function splitRecipients(v: unknown): string[] {
  const arr = Array.isArray(v) ? v : v === undefined || v === null || v === '' ? [] : String(v).split(/[,;]/);
  return arr.map(normalizeRecipientEmail).filter(Boolean);
}

/** true => comentario publico (todos os destinatarios sao o solicitante/contato do chamado). */
export function emailCommentIsPublic(
  recipients: { to?: unknown; cc?: unknown; bcc?: unknown },
  ticketEmails: Array<string | null | undefined>
): boolean {
  const allowed = new Set(ticketEmails.map(normalizeRecipientEmail).filter(Boolean));
  const all = [...splitRecipients(recipients.to), ...splitRecipients(recipients.cc), ...splitRecipients(recipients.bcc)];
  return allowed.size > 0 && all.length > 0 && all.every((e) => allowed.has(e));
}
