import type { ErpCommercialProposal } from '../../db/types';

/** Página da lista de orçamentos (modo tabela ou o array do bootstrap). */
export interface ProposalListSnapshot {
  data: ErpCommercialProposal[];
  total: number;
  counts: { TODOS: number; PRODUTOS: number; LOCACAO: number; SERVICOS: number };
}

export interface ProposalListQuery {
  status?: string;
  type?: string;
  search?: string;
  offset?: number;
  pageSize?: number;
}

const EMPTY_COUNTS = { TODOS: 0, PRODUTOS: 0, LOCACAO: 0, SERVICOS: 0 };

export function emptyProposalListCounts(): ProposalListSnapshot['counts'] {
  return { ...EMPTY_COUNTS };
}

/** O mesmo recorte da lista (situação, aba e busca). Sem isso a linha nova entra na aba errada. */
export function proposalMatchesListQuery(proposal: ErpCommercialProposal, query: ProposalListQuery): boolean {
  const status = query.status || 'TODOS';
  if (status !== 'TODOS') {
    const converted = proposal.status === 'CONVERTIDA_CONTRATO' || Boolean(proposal.convertedContractId);
    if (status === 'CONVERTIDA_CONTRATO') {
      if (!converted) return false;
    } else if (proposal.status !== status) {
      return false;
    }
  }
  const type = String(query.type || 'TODOS').replace(/^ORC_/, '');
  if (type === 'PRODUTOS' && proposal.budgetType !== 'PRODUTOS') return false;
  if (type === 'SPARE_PARTS' && proposal.budgetType !== 'SPARE_PARTS') return false;
  if (type === 'SERVICOS' && proposal.budgetType !== 'SERVICOS' && proposal.budgetType !== 'CONJUNTO') return false;
  if (type === 'LOCACAO' && proposal.budgetType !== 'LOCACAO' && proposal.budgetType !== 'CONJUNTO') return false;
  const q = String(query.search || '').trim().toLowerCase();
  if (!q) return true;
  const hay = `${proposal.code || ''} ${proposal.title || ''} ${proposal.companyName || ''} ${proposal.companyCnpj || ''} ${proposal.sellerName || ''}`.toLowerCase();
  return hay.includes(q);
}

function stamp(value: string | undefined): number {
  const n = Date.parse(String(value || ''));
  return Number.isFinite(n) ? n : 0;
}

/** A resposta do servidor já tem esta gravação (ou uma mais nova). */
export function serverRowIncludesSave(serverRow: ErpCommercialProposal | undefined, saved: ErpCommercialProposal): boolean {
  if (!serverRow) return false;
  const savedAt = stamp(saved.updatedAt);
  if (!savedAt) return true;
  return stamp(serverRow.updatedAt) >= savedAt;
}

/**
 * Coloca a proposta salva na página visível sem esperar outro GET.
 * Criação entra no topo (a lista vem por número decrescente). Edição troca a linha.
 */
export function applyProposalSaveToListPage(
  page: ProposalListSnapshot | null,
  saved: ErpCommercialProposal,
  query: ProposalListQuery & { isNew: boolean }
): ProposalListSnapshot {
  const current: ProposalListSnapshot = page || { data: [], total: 0, counts: emptyProposalListCounts() };
  const pageSize = Math.max(1, query.pageSize || current.data.length || 50);
  const offset = Math.max(0, query.offset || 0);
  const matches = proposalMatchesListQuery(saved, query);
  const index = current.data.findIndex((row) => row.id === saved.id);
  if (!matches) {
    if (index < 0) return current;
    const data = current.data.filter((row) => row.id !== saved.id);
    return { ...current, data, total: Math.max(0, current.total - 1) };
  }
  if (index >= 0) {
    const data = current.data.slice();
    data[index] = saved;
    return { ...current, data };
  }
  if (!query.isNew) return current;
  if (offset > 0) {
    return { ...current, data: [saved], total: current.total + 1 };
  }
  return {
    ...current,
    data: [saved, ...current.data].slice(0, pageSize),
    total: current.total + 1,
  };
}

/**
 * Um GET que saiu antes do POST (ou veio do cache) não pode apagar a linha recém-salva.
 * Se o servidor já devolveu a mesma versão, a pendência sai da lista.
 */
export function reconcileProposalListPage(
  page: ProposalListSnapshot,
  pending: ErpCommercialProposal[],
  query: ProposalListQuery
): { page: ProposalListSnapshot; pending: ErpCommercialProposal[] } {
  const pageSize = Math.max(1, query.pageSize || page.data.length || 50);
  const offset = Math.max(0, query.offset || 0);
  let data = page.data.slice();
  let total = page.total;
  const still: ErpCommercialProposal[] = [];
  for (const saved of pending) {
    const index = data.findIndex((row) => row.id === saved.id);
    const serverRow = index >= 0 ? data[index] : undefined;
    if (serverRowIncludesSave(serverRow, saved)) continue;
    still.push(saved);
    if (!proposalMatchesListQuery(saved, query)) {
      if (index >= 0) {
        data.splice(index, 1);
        total = Math.max(0, total - 1);
      }
      continue;
    }
    if (index >= 0) {
      data[index] = saved;
      continue;
    }
    if (offset > 0) continue;
    const wasOnPage = page.data.some((row) => row.id === saved.id);
    data = [saved, ...data];
    if (!wasOnPage) total += 1;
  }
  return {
    page: { ...page, data: data.slice(0, pageSize), total },
    pending: still,
  };
}
