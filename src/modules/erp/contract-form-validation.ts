/**
 * Regras de formulário do contrato de locação (UI e API).
 * Fonte única para "mínimo 1 produto" e demais consistências do rascunho.
 */

export type ContractFormTabId =
  | 'DADOS_GERAIS'
  | 'RENOVAR_VIGENCIA'
  | 'FATURAMENTO_RECIBOS'
  | 'REAJUSTE_ADITIVOS'
  | 'PRODUTOS'
  | 'DOCUMENTO_HISTORICO';

export interface ContractFieldError {
  field: string;
  tab: ContractFormTabId;
  message: string;
}

export interface ContractFormDraft {
  title?: string | null;
  companyName?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  dueDay?: number | string | null;
  paymentMethod?: string | null;
  emailAutomationMode?: string | null;
  nextBillingDate?: string | null;
  nextDueDate?: string | null;
  measurementNumber?: string | null;
  measurementPeriod?: string | null;
  equipments?: Array<{
    skuGestaoClick?: string | null;
    description?: string | null;
    quantity?: number | string | null;
    unitMonthlyRent?: number | string | null;
  }> | null;
}

export function isValidContractProduct(eq: {
  skuGestaoClick?: string | null;
  description?: string | null;
  quantity?: number | string | null;
  unitMonthlyRent?: number | string | null;
} | null | undefined): boolean {
  if (!eq || typeof eq !== 'object') return false;
  const named = Boolean(String(eq.skuGestaoClick || '').trim() || String(eq.description || '').trim());
  const qty = Number(eq.quantity);
  const price = Number(eq.unitMonthlyRent || 0);
  return named && Number.isFinite(qty) && qty > 0 && Number.isFinite(price) && price >= 0;
}

export function countValidContractProducts(
  equipments: ContractFormDraft['equipments']
): number {
  return (equipments || []).filter((eq) => isValidContractProduct(eq)).length;
}

export function validateRentalContractForm(draft: ContractFormDraft): {
  ok: boolean;
  errors: ContractFieldError[];
  firstTab: ContractFormTabId | null;
  banner: string | null;
} {
  const errors: ContractFieldError[] = [];

  if (!String(draft.title || '').trim()) {
    errors.push({ field: 'title', tab: 'DADOS_GERAIS', message: 'Nome do contrato.' });
  }
  if (!String(draft.companyName || '').trim()) {
    errors.push({ field: 'companyName', tab: 'DADOS_GERAIS', message: 'Cliente.' });
  }

  const start = String(draft.startDate || '').slice(0, 10);
  const end = String(draft.endDate || '').slice(0, 10);
  if (start && end && start > end) {
    errors.push({
      field: 'endDate',
      tab: 'DADOS_GERAIS',
      message: 'Fim da vigência deve ser igual ou posterior ao início.',
    });
  }

  if (draft.dueDay !== undefined && draft.dueDay !== null && String(draft.dueDay).trim() !== '') {
    const due = Number(draft.dueDay);
    if (!Number.isInteger(due) || due < 1 || due > 31) {
      errors.push({
        field: 'dueDay',
        tab: 'FATURAMENTO_RECIBOS',
        message: 'Dia de vencimento deve ser entre 1 e 31.',
      });
    }
  }

  if (!String(draft.paymentMethod || '').trim()) {
    errors.push({ field: 'paymentMethod', tab: 'FATURAMENTO_RECIBOS', message: 'Forma de pagamento.' });
  }
  if (!String(draft.emailAutomationMode || '').trim()) {
    errors.push({
      field: 'emailAutomationMode',
      tab: 'FATURAMENTO_RECIBOS',
      message: 'Enviar a fatura por e-mail.',
    });
  }
  if (!String(draft.nextBillingDate || draft.nextDueDate || '').trim()) {
    errors.push({
      field: 'nextBillingDate',
      tab: 'FATURAMENTO_RECIBOS',
      message: 'Próximo vencimento.',
    });
  }
  if (String(draft.measurementNumber || '').trim() && !String(draft.measurementPeriod || '').trim()) {
    errors.push({
      field: 'measurementPeriod',
      tab: 'FATURAMENTO_RECIBOS',
      message: 'Período de medição.',
    });
  }

  const equipments = draft.equipments || [];
  equipments.forEach((eq, index) => {
    const named = Boolean(String(eq?.skuGestaoClick || '').trim() || String(eq?.description || '').trim());
    if (!named) return;
    const qty = Number(eq?.quantity);
    if (!Number.isFinite(qty) || qty <= 0) {
      errors.push({
        field: `equipments.${index}.quantity`,
        tab: 'PRODUTOS',
        message: 'Quantidade deve ser maior que zero.',
      });
    }
    const price = Number(eq?.unitMonthlyRent || 0);
    if (!Number.isFinite(price) || price < 0) {
      errors.push({
        field: `equipments.${index}.unitMonthlyRent`,
        tab: 'PRODUTOS',
        message: 'Preço deve ser maior ou igual a zero.',
      });
    }
  });

  if (countValidContractProducts(equipments) < 1) {
    errors.push({
      field: 'equipments',
      tab: 'PRODUTOS',
      message: 'Adicione pelo menos um produto.',
    });
  }

  const productBanner = errors.find((e) => e.field === 'equipments');
  const first = productBanner || errors[0];
  return {
    ok: errors.length === 0,
    errors,
    firstTab: first?.tab ?? null,
    banner: first?.message ?? null,
  };
}
