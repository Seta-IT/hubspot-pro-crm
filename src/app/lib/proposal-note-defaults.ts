/** Tipos com texto padrão de "Observações Comerciais & Fiscais". Códigos internos estáveis. */
export const PROPOSAL_NOTE_DEFAULT_TYPE_KEYS = [
  'PRODUTOS',
  'SERVICOS_PONTUAL',
  'SERVICOS_MENSAL',
  'LOCACAO',
] as const;

export type ProposalNoteDefaultTypeKey = (typeof PROPOSAL_NOTE_DEFAULT_TYPE_KEYS)[number];

export const PROPOSAL_NOTE_DEFAULT_TYPE_LABELS: Record<ProposalNoteDefaultTypeKey, string> = {
  PRODUTOS: 'Produtos',
  SERVICOS_PONTUAL: 'Serviço pontual',
  SERVICOS_MENSAL: 'Serviço mensal',
  LOCACAO: 'Locação',
};

/** Texto que o sistema já usava ao gravar proposta nova com observações vazias. */
export const SYSTEM_DEFAULT_COMMERCIAL_NOTES =
  'Locação de bens móveis sem mão de obra (Dispensa de ISSQN conforme LC 116/2003 e Súmula Vinculante 31 do STF).';

export type ProposalNoteDefaultsMap = Record<ProposalNoteDefaultTypeKey, string>;

export function seedProposalNoteDefaults(): ProposalNoteDefaultsMap {
  return {
    PRODUTOS: SYSTEM_DEFAULT_COMMERCIAL_NOTES,
    SERVICOS_PONTUAL: SYSTEM_DEFAULT_COMMERCIAL_NOTES,
    SERVICOS_MENSAL: SYSTEM_DEFAULT_COMMERCIAL_NOTES,
    LOCACAO: SYSTEM_DEFAULT_COMMERCIAL_NOTES,
  };
}

export function isProposalNoteDefaultTypeKey(value: unknown): value is ProposalNoteDefaultTypeKey {
  return PROPOSAL_NOTE_DEFAULT_TYPE_KEYS.includes(String(value) as ProposalNoteDefaultTypeKey);
}

/** Conjunto, Spare Parts e tipos desconhecidos não têm linha própria (não inventar). */
export function proposalNoteDefaultTypeKey(input: {
  budgetType?: string | null;
  contractMonths?: unknown;
}): ProposalNoteDefaultTypeKey | null {
  const t = String(input.budgetType || '').trim().toUpperCase();
  if (t === 'PRODUTOS') return 'PRODUTOS';
  if (t === 'LOCACAO') return 'LOCACAO';
  if (t === 'SERVICOS') {
    return Number(input.contractMonths) === 1 ? 'SERVICOS_PONTUAL' : 'SERVICOS_MENSAL';
  }
  return null;
}

export function commercialNoteFromDefaults(
  defaults: Partial<ProposalNoteDefaultsMap> | null | undefined,
  typeKey: ProposalNoteDefaultTypeKey | null
): string {
  if (!typeKey) return '';
  const seeded = seedProposalNoteDefaults();
  const raw = defaults && typeKey in (defaults as object) ? defaults[typeKey] : seeded[typeKey];
  return String(raw ?? seeded[typeKey] ?? '');
}

/**
 * Preenche observações vazias ou, na troca de tipo, reaplica o padrão
 * se o texto ainda for o padrão anterior. Não sobrescreve texto já editado.
 */
export function applyProposalCommercialNotesDefault(input: {
  currentNotes?: string | null;
  nextTypeKey: ProposalNoteDefaultTypeKey | null;
  previousTypeKey?: ProposalNoteDefaultTypeKey | null;
  defaults?: Partial<ProposalNoteDefaultsMap> | null;
}): string {
  const current = String(input.currentNotes ?? '');
  const nextDefault = commercialNoteFromDefaults(input.defaults, input.nextTypeKey);
  if (!input.nextTypeKey) return current;
  const previousDefault = input.previousTypeKey
    ? commercialNoteFromDefaults(input.defaults, input.previousTypeKey)
    : '';
  if (!current.trim() || current === previousDefault) return nextDefault;
  return current;
}

export function mergeProposalNoteDefaults(
  incoming?: Partial<ProposalNoteDefaultsMap> | null
): ProposalNoteDefaultsMap {
  const base = seedProposalNoteDefaults();
  if (!incoming) return base;
  const out = { ...base };
  for (const key of PROPOSAL_NOTE_DEFAULT_TYPE_KEYS) {
    if (incoming[key] !== undefined && incoming[key] !== null) {
      out[key] = String(incoming[key]);
    }
  }
  return out;
}

export const COMMERCIAL_NOTES_DEFAULT_MAX_LEN = 8000;

export function sanitizeCommercialNotesDefault(value: unknown): string {
  return String(value ?? '').replace(/\r\n/g, '\n');
}
