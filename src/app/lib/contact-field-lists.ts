/** Listas configuráveis de Posição (jobTitle) e Área (department). */

export const CONTACT_POSITION_KIND = 'contactPosition' as const;
export const CONTACT_DEPARTMENT_KIND = 'contactDepartment' as const;

export type ContactFieldListKind = typeof CONTACT_POSITION_KIND | typeof CONTACT_DEPARTMENT_KIND;

export const DEFAULT_CONTACT_POSITIONS = [
  'Sócio/Proprietário',
  'Diretor',
  'Gerente',
  'Coordenador',
  'Supervisor',
  'Analista',
  'Técnico',
  'Assistente',
  'Estagiário',
  'Outro',
] as const;

export const DEFAULT_CONTACT_DEPARTMENTS = [
  'Diretoria',
  'Comercial',
  'Compras',
  'Financeiro',
  'TI',
  'Operações',
  'Suporte/NOC',
  'RH',
  'Marketing',
  'Jurídico',
] as const;

export type SelectOption = { value: string; label: string; legacy?: boolean };

/** Inclui o valor antigo em texto livre como opção extra, sem apagá-lo. */
export function optionsWithLegacyValue(
  labels: readonly string[],
  current?: string | null
): SelectOption[] {
  const options: SelectOption[] = labels
    .map((label) => String(label || '').trim())
    .filter(Boolean)
    .map((label) => ({ value: label, label }));
  const cur = String(current || '').trim();
  if (!cur) return options;
  const exists = options.some((o) => o.value.toLowerCase() === cur.toLowerCase());
  if (exists) return options;
  return [{ value: cur, label: cur, legacy: true }, ...options];
}

export function isContactFieldListKind(value: unknown): value is ContactFieldListKind {
  return value === CONTACT_POSITION_KIND || value === CONTACT_DEPARTMENT_KIND;
}
