// Utilitarios compartilhados pelos casos de uso (CRM e Chamados).
import type { DataWriteResult, IntegrationUser } from '../data-port';
import { UseCaseError, type UseCaseContext } from './types';

const ACCESS_RANK: Record<string, number> = { NONE: 0, VIEW: 1, EDIT: 2, FULL: 3 };

/** Alcada do dono da credencial no CRM (quando definida) — a credencial nunca excede o usuario. */
export function requireOwnerAccess(
  ctx: UseCaseContext,
  area: keyof IntegrationUser['crmAccess'],
  level: 'VIEW' | 'EDIT'
): void {
  const v = ctx.owner.crmAccess[area];
  if (v === undefined || v === null || !(v in ACCESS_RANK)) return;
  if (ACCESS_RANK[v] < ACCESS_RANK[level]) {
    throw new UseCaseError(403, 'OWNER_ACCESS_INSUFFICIENT', 'O usuario dono desta credencial nao tem alcada para esta operacao.');
  }
}

/** Converte a resposta da rota interna em erro tipado (sem ecoar corpo do cliente). */
export function unwrapWrite(res: DataWriteResult, what: string): any {
  if (res.status >= 200 && res.status < 300) {
    const data = res.body && typeof res.body === 'object' ? (res.body as { data?: unknown }).data : undefined;
    if (!data) throw new UseCaseError(500, 'WRITE_EMPTY_RESULT', `Falha ao gravar ${what}.`);
    return data;
  }
  const msg = res.body && typeof res.body === 'object' && typeof (res.body as { error?: unknown }).error === 'string'
    ? String((res.body as { error: string }).error).slice(0, 300)
    : `Falha ao gravar ${what}.`;
  const code = res.body && typeof res.body === 'object' && typeof (res.body as { code?: unknown }).code === 'string'
    ? String((res.body as { code: string }).code).slice(0, 80)
    : 'WRITE_REJECTED';
  if (res.status === 404) throw new UseCaseError(404, 'NOT_FOUND', `${what} nao encontrado(a).`);
  if (res.status >= 400 && res.status < 500) throw new UseCaseError(res.status === 400 ? 422 : res.status, code, msg);
  throw new UseCaseError(502, 'UPSTREAM_ERROR', `Falha interna ao gravar ${what}.`);
}

export const sortByUpdatedDesc = <T extends { id: string; updatedAt?: string; createdAt?: string }>(list: T[]): T[] =>
  [...list].sort((a, b) => String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || '')) || a.id.localeCompare(b.id));

export const includesText = (q: string | undefined, ...fields: Array<unknown>): boolean => {
  const needle = String(q || '').trim().toLowerCase();
  if (!needle) return true;
  return fields.some((f) => String(f ?? '').toLowerCase().includes(needle));
};

export function sourceMetadata(ctx: UseCaseContext): Record<string, unknown> {
  return {
    source: ctx.auth.channel === 'mcp' ? 'STIHUB_MCP' : 'STIHUB_API_V1',
    integrationKeyId: ctx.auth.keyId,
    oauthClientId: ctx.auth.oauthClientId,
    requestId: ctx.auth.requestId,
  };
}
