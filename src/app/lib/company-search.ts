import type { Company } from '../../db/types';

const fold = (v: string) =>
  String(v || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();

/** Nome fantasia do cadastro (mesma regra do seletor de cliente do orcamento). */
export function companyTradeName(c: Company): string {
  const cp = (c.customProperties || {}) as Record<string, unknown>;
  return String(cp.tradeName || '').trim();
}

/**
 * Busca de clientes cadastrados (mesma fonte e regra do orcamento): nome, nome fantasia ou
 * CNPJ/CPF (com ou sem pontuacao). Sem texto => os primeiros da lista.
 */
export function filterCompaniesForPicker(companies: Company[], query: string, max = 10): Company[] {
  const pool = (companies || []).filter((c) => c && c.id && String(c.name || '').trim());
  const q = fold(query);
  if (!q) return pool.slice(0, max);
  const qDigits = q.replace(/\D+/g, '');
  const out: Company[] = [];
  for (const c of pool) {
    const nameHit = fold(c.name).includes(q) || fold(companyTradeName(c)).includes(q) || fold(c.domain || '').includes(q);
    const cnpjDigits = String(c.cnpj || '').replace(/\D+/g, '');
    const docHit = qDigits.length >= 2 && cnpjDigits.includes(qDigits);
    if (nameHit || docHit) out.push(c);
    if (out.length >= max) break;
  }
  return out;
}

/** Dados do cliente que entram na OS ao escolher um cadastro. */
export function serviceOrderCustomerFields(c: Company): { companyId: string; companyName: string; companyCnpj: string } {
  return { companyId: c.id, companyName: c.name, companyCnpj: String(c.cnpj || '') };
}
