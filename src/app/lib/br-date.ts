/**
 * Datas do orçamento em dd/mm/aaaa, sem depender do locale do navegador.
 * O valor persistido continua ISO (aaaa-mm-dd).
 */

export function isoToBrDate(value: string | null | undefined): string {
  const raw = String(value || '').trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  if (!m) return '';
  return `${m[3]}/${m[2]}/${m[1]}`;
}

export function maskBrDateInput(raw: string): string {
  const digits = String(raw || '').replace(/\D/g, '').slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}

/** Converte dd/mm/aaaa completo e válido em aaaa-mm-dd. Incompleto ou inválido devolve null. */
export function brDateToIso(value: string | null | undefined): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(value || '').trim());
  if (!m) return null;
  const day = Number(m[1]);
  const month = Number(m[2]);
  const year = Number(m[3]);
  if (year < 1900 || year > 2100 || month < 1 || month > 12 || day < 1) return null;
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    return null;
  }
  return `${m[3]}-${m[2]}-${m[1]}`;
}

export const BR_WEEKDAYS = ['seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom'] as const;

export const BR_MONTHS = [
  'janeiro',
  'fevereiro',
  'março',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro',
] as const;

export type BrMonthCell = { iso: string; day: number } | null;

/** Grade do mês começando na segunda-feira. month é 1–12. */
export function brMonthGrid(year: number, month: number): BrMonthCell[] {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const lead = (first.getUTCDay() + 6) % 7;
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const cells: BrMonthCell[] = [];
  for (let i = 0; i < lead; i += 1) cells.push(null);
  for (let day = 1; day <= days; day += 1) {
    const dd = String(day).padStart(2, '0');
    const mm = String(month).padStart(2, '0');
    cells.push({ day, iso: `${year}-${mm}-${dd}` });
  }
  return cells;
}

export function isoYearMonth(value: string | null | undefined): { year: number; month: number } {
  const m = /^(\d{4})-(\d{2})/.exec(String(value || ''));
  if (m) return { year: Number(m[1]), month: Number(m[2]) };
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() + 1 };
}
