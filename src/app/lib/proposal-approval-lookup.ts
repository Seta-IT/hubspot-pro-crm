import type { ErpCommercialProposal } from '../../db/types';

/**
 * Localiza no servidor o orçamento que a tela está mostrando.
 * Durante a indisponibilidade do banco a tela pode ter ficado com um id local;
 * o código (ex.: 4712) continua achando o registro gravado. Só leitura.
 */
export async function lookupServerProposal(
  proposal: { id: string; code?: string | null },
  fetchImpl: typeof fetch = fetch
): Promise<ErpCommercialProposal | null> {
  const refs: string[] = [];
  const push = (value: string) => {
    const ref = String(value || '').replace(/^#/, '').trim();
    if (ref && !refs.includes(ref)) refs.push(ref);
  };
  push(proposal.id);
  push(String(proposal.code || ''));
  for (const ref of refs) {
    try {
      const res = await fetchImpl(`/api/erp/proposals/${encodeURIComponent(ref)}`, {
        credentials: 'same-origin',
        cache: 'no-store',
      });
      if (!res.ok) continue;
      const json = await res.json().catch(() => null);
      const data = json?.data;
      if (data && !Array.isArray(data) && typeof data.id === 'string' && data.id.trim()) {
        return data as ErpCommercialProposal;
      }
    } catch {
      // tenta o próximo identificador
    }
  }
  return null;
}
