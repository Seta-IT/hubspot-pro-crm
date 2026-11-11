// STI-hub — dados bancários da emitente (Seta Telecom LTDA) para recibos e faturas.
// Fonte única: não repetir agência/conta espalhados no HTML das folhas.

export const SETA_BANK_TRANSFER = {
  bankName: 'Itaú',
  agency: '0018',
  account: '71924-5',
} as const;

/** Linha única para exibição e cópia: "Banco Itaú • Ag 0018 • CC 71924-5". */
export function setaBankTransferLine(): string {
  const { bankName, agency, account } = SETA_BANK_TRANSFER;
  return `Banco ${bankName} • Ag ${agency} • CC ${account}`;
}
