// Formas de pagamento do orçamento, da proposta pública, do PDF e da fatura (parcelas).
// Os valores internos (BOLETO, PIX, TED, CARTAO_CREDITO, FATURAMENTO_MENSAL) permanecem
// iguais para não quebrar registros já gravados. Cartão sai da lista de escolha;
// se um documento antigo ainda tiver cartão, o rótulo continua aparecendo.

export type ProposalPaymentMethodOption = {
  value: string;
  label: string;
  disabled?: boolean;
};

export const PROPOSAL_PAYMENT_METHOD_OPTIONS: ProposalPaymentMethodOption[] = [
  { value: 'BOLETO', label: 'Boleto' },
  { value: 'PIX', label: 'Pix' },
  { value: 'TED', label: 'Ted / Transferência' },
];

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  BOLETO: 'Boleto',
  PIX: 'Pix',
  TED: 'Ted / Transferência',
  CARTAO_CREDITO: 'Cartão de Crédito',
  FATURAMENTO_MENSAL: 'Faturamento Mensal',
};

const OLD_PAYMENT_METHOD_PHRASES: Array<[RegExp, string]> = [
  [/Boleto Bancário Híbrido PIX/gi, 'Boleto'],
  [/Boleto Bancário/gi, 'Boleto'],
  [/PIX Empresarial/gi, 'Pix'],
  [/TED \/ Transferência Bancária/gi, 'Ted / Transferência'],
  [/TED Bancária/gi, 'Ted / Transferência'],
];

/** Rótulo exibido para um valor interno ou texto já gravado. Não altera o que está no banco. */
export function proposalPaymentMethodLabel(value: string | null | undefined): string {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (PAYMENT_METHOD_LABELS[raw]) return PAYMENT_METHOD_LABELS[raw];
  const upper = raw.toUpperCase().replace(/[\s-]+/g, '_');
  if (PAYMENT_METHOD_LABELS[upper]) return PAYMENT_METHOD_LABELS[upper];
  return displayPaymentConditionText(raw);
}

/**
 * Ajusta, só na exibição, códigos e rótulos antigos no resumo da condição ou nas observações.
 * Idempotente e não reescreve dados salvos.
 */
export function displayPaymentConditionText(raw: string | null | undefined): string {
  let out = String(raw || '');
  if (!out) return '';
  for (const [pattern, label] of OLD_PAYMENT_METHOD_PHRASES) {
    out = out.replace(pattern, label);
  }
  out = out.replace(/\(CARTAO_CREDITO\)/g, '(Cartão de Crédito)');
  out = out.replace(/\(FATURAMENTO_MENSAL\)/g, '(Faturamento Mensal)');
  out = out.replace(/\(BOLETO\)/g, '(Boleto)');
  out = out.replace(/\(PIX\)/g, '(Pix)');
  out = out.replace(/\(TED\)/g, '(Ted / Transferência)');
  return out;
}

/** Lista de escolha: Boleto, Pix, Ted / Transferência. Cartão só entra desabilitado se já for o valor atual. */
export function proposalPaymentMethodOptions(opts?: {
  includeMonthlyBilling?: boolean;
  monthlyBillingLabel?: string;
  currentValue?: string | null;
}): ProposalPaymentMethodOption[] {
  const list: ProposalPaymentMethodOption[] = PROPOSAL_PAYMENT_METHOD_OPTIONS.map((o) => ({ ...o }));
  if (opts?.includeMonthlyBilling) {
    list.push({
      value: 'FATURAMENTO_MENSAL',
      label: opts.monthlyBillingLabel || 'Faturamento Mensal (Contrato)',
    });
  }
  const current = String(opts?.currentValue || '').trim();
  if (current && !list.some((o) => o.value === current)) {
    list.push({
      value: current,
      label: proposalPaymentMethodLabel(current),
      disabled: true,
    });
  }
  return list;
}

/** Identifica forma de pagamento em cartão (código ou rótulo), para tirar da lista de escolha. */
export function isCreditCardPaymentChoice(label: string | null | undefined): boolean {
  const n = String(label || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[\s/-]+/g, '_');
  if (!n) return false;
  return n === 'cartao_credito' || n.startsWith('cartao_de_credito') || n.startsWith('cartao_credito');
}

/** Sugestões do contrato/fatura, sem oferecer cartão; mantém o valor já gravado no documento. */
export function selectableContractPaymentMethods(
  methods: string[],
  currentValue?: string | null
): string[] {
  const current = String(currentValue || '').trim();
  return methods.filter((method) => !isCreditCardPaymentChoice(method) || method === current);
}
