/**
 * Pacote G: proposta publica (/proposta/*) e API de propostas (/api/erp/proposals e /*) carregam
 * dados comerciais e, com o link assinado, um token na URL. Essas respostas nao vazam a URL por
 * Referer, nao ficam em cache (navegador/CDN) e nao sao indexadas. Seguro para Edge.
 */
export const SENSITIVE_PROPOSAL_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  'Referrer-Policy': 'no-referrer',
  'Cache-Control': 'no-store',
  'X-Robots-Tag': 'noindex',
});

export function isSensitiveProposalPath(pathname: string): boolean {
  const p = String(pathname || '/').toLowerCase().replace(/\/{2,}/g, '/');
  return (
    p === '/proposta' ||
    p.startsWith('/proposta/') ||
    p === '/api/erp/proposals' ||
    p.startsWith('/api/erp/proposals/')
  );
}
