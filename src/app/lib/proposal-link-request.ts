// ============================================================================
// STI-hub — Encaminhamento das rotas publicas de proposta para o bridge (29/10/2026).
// O token do link chega SO no header X-Proposal-Token (a pagina le do fragmento #t=) e
// a Idempotency-Key no header Idempotency-Key. Aqui eles viram parametros internos da
// requisicao encaminhada ao bridge (forwardToCrmRouter, que segue aplicando todas as
// regras de sessao/IP/chaves reservadas). Qualquer `proposalLinkToken`/`proposalIdempotencyKey`
// vindo da URL do cliente e DESCARTADO: o token nunca e aceito na URL (logs/Referer).
// Nada aqui registra o token.
// ============================================================================
import { NextRequest } from 'next/server';

export const PROPOSAL_TOKEN_HEADER = 'x-proposal-token';
export const PROPOSAL_IDEMPOTENCY_HEADER = 'idempotency-key';
export const PROPOSAL_TOKEN_QUERY_KEY = 'proposalLinkToken';
export const PROPOSAL_IDEMPOTENCY_QUERY_KEY = 'proposalIdempotencyKey';

/** Copia a requisicao movendo os headers do link para parametros internos (apenas em memoria). */
export async function withProposalLinkParams(req: NextRequest): Promise<NextRequest> {
  const url = new URL(req.url);
  url.searchParams.delete(PROPOSAL_TOKEN_QUERY_KEY);
  url.searchParams.delete(PROPOSAL_IDEMPOTENCY_QUERY_KEY);
  const token = (req.headers.get(PROPOSAL_TOKEN_HEADER) || '').trim();
  const idem = (req.headers.get(PROPOSAL_IDEMPOTENCY_HEADER) || '').trim();
  if (token && token.length <= 1024) url.searchParams.set(PROPOSAL_TOKEN_QUERY_KEY, token);
  if (idem && idem.length <= 256) url.searchParams.set(PROPOSAL_IDEMPOTENCY_QUERY_KEY, idem);
  const headers = new Headers(req.headers);
  headers.delete(PROPOSAL_TOKEN_HEADER);
  const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
  const body = hasBody ? await req.text() : undefined;
  return new NextRequest(url, { method: req.method, headers, body });
}
