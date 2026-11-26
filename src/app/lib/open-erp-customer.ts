// ============================================================================
// Clique na empresa a partir de orçamentos / contratos / notas:
// abre o cadastro para edição na mesma página (modal), sem trocar de seção.
// ============================================================================

import { LEAN_COMPANY_MARKER, type LeanCompany } from '../../modules/bootstrap/lean-payload';

export type CompanyListItem = {
  id: string;
  name: string;
  cnpj?: string | null;
};

export type OpenErpCustomerQuery = {
  companyId?: string | null;
  companyName?: string;
  companyCnpj?: string;
};

export type OpenErpCustomerPlan<T extends CompanyListItem = CompanyListItem> =
  | { action: 'open-edit'; company: T; stayOnPage: true; readOnly: false }
  | { action: 'hydrate-edit'; stub: LeanCompany; stayOnPage: true; readOnly: false }
  | { action: 'not-found'; stayOnPage: true; toast: string };

function digits(value: string | null | undefined): string {
  return String(value || '').replace(/\D+/g, '');
}

function normName(value: string | null | undefined): string {
  return String(value || '').trim().toLowerCase();
}

export function findCompanyInList<T extends CompanyListItem>(
  companies: T[],
  query: OpenErpCustomerQuery
): T | undefined {
  const id = String(query.companyId || '').trim();
  const cnpjDigits = digits(query.companyCnpj);
  const name = normName(query.companyName);
  return companies.find((c) => {
    if (id && c.id === id) return true;
    if (cnpjDigits && digits(c.cnpj) === cnpjDigits) return true;
    if (name && normName(c.name) === name) return true;
    return false;
  });
}

export function leanCompanyStub(query: OpenErpCustomerQuery & { companyId: string }): LeanCompany {
  const stub: LeanCompany = {
    id: query.companyId,
    name: String(query.companyName || '').trim() || query.companyId,
    [LEAN_COMPANY_MARKER]: true,
  };
  const cnpj = String(query.companyCnpj || '').trim();
  if (cnpj) stub.cnpj = cnpj;
  return stub;
}

export const ERP_CUSTOMER_NOT_FOUND_TOAST =
  'Não foi possível abrir o cadastro desta empresa. A empresa não foi encontrada.';

/**
 * Decide o que fazer ao clicar na empresa. Nunca troca a seção atual
 * (a edição abre no modal; fechar/salvar volta à lista).
 */
export function planOpenErpCustomer<T extends CompanyListItem>(
  companies: T[],
  query: OpenErpCustomerQuery
): OpenErpCustomerPlan<T> {
  const matched = findCompanyInList(companies, query);
  if (matched) {
    return { action: 'open-edit', company: matched, stayOnPage: true, readOnly: false };
  }
  const companyId = String(query.companyId || '').trim();
  if (companyId) {
    return {
      action: 'hydrate-edit',
      stub: leanCompanyStub({ ...query, companyId }),
      stayOnPage: true,
      readOnly: false,
    };
  }
  return { action: 'not-found', stayOnPage: true, toast: ERP_CUSTOMER_NOT_FOUND_TOAST };
}
