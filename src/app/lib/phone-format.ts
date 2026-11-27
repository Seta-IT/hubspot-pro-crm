// ============================================================================
// Telefone no padrao HubSpot (26/11/2026): pais com bandeira + DDI, mascara nacional,
// ramal opcional (so fixo), gravacao em E.164 e exibicao formatada.
// Valores antigos em texto livre: convertidos quando interpretaveis; senao, preservados.
// ============================================================================
import {
  AsYouType,
  getCountries,
  getCountryCallingCode,
  parsePhoneNumberFromString,
  validatePhoneNumberLength,
  type CountryCode,
} from 'libphonenumber-js/min';

export type PhoneKind = 'phone' | 'mobile';

export const DEFAULT_PHONE_COUNTRY: CountryCode = 'BR';

/** Paises mais usados primeiro; o resto em ordem alfabetica (pt-BR). */
const PRIORITY: CountryCode[] = ['BR', 'US', 'PT', 'AR', 'CL', 'CO', 'MX', 'PY', 'UY', 'PE', 'ES'];

export function countryFlag(country: string): string {
  const cc = String(country || '').toUpperCase();
  if (!/^[A-Z]{2}$/.test(cc)) return '';
  return String.fromCodePoint(...Array.from(cc).map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

function countryName(cc: CountryCode): string {
  try {
    const dn = new Intl.DisplayNames(['pt-BR'], { type: 'region' });
    return dn.of(cc) || cc;
  } catch {
    return cc;
  }
}

export interface PhoneCountryOption {
  code: CountryCode;
  name: string;
  dialCode: string;
  flag: string;
}

let cachedOptions: PhoneCountryOption[] | null = null;
export function phoneCountryOptions(): PhoneCountryOption[] {
  if (cachedOptions) return cachedOptions;
  const all = getCountries().map((code) => ({
    code,
    name: countryName(code),
    dialCode: `+${getCountryCallingCode(code)}`,
    flag: countryFlag(code),
  }));
  const top = PRIORITY.map((c) => all.find((o) => o.code === c)).filter(Boolean) as PhoneCountryOption[];
  const rest = all
    .filter((o) => !PRIORITY.includes(o.code))
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  cachedOptions = [...top, ...rest];
  return cachedOptions;
}

export function dialCodeOf(country: CountryCode): string {
  return `+${getCountryCallingCode(country)}`;
}

/** Separa ramal ("ramal 12", "r. 12", "ext 12", "x12", ";ext=12", "#12") do numero. */
export function splitExtension(raw: string): { number: string; ext: string } {
  const s = String(raw || '');
  const m = s.match(/\s*(?:;\s*ext\s*=\s*|,?\s*(?:ramal|ram\.?|r\.|ext\.?|extens[aã]o|x|#)\s*:?\s*)(\d{1,6})\s*$/i);
  if (!m || m.index === undefined) return { number: s.trim(), ext: '' };
  const number = s.slice(0, m.index).trim();
  // "x" solto so conta como ramal quando ha numero antes.
  if (!number.replace(/\D/g, '')) return { number: s.trim(), ext: '' };
  return { number, ext: m[1] };
}

export interface ParsedStoredPhone {
  /** Numero interpretado com seguranca? Se false, `raw` deve ser mantido como esta. */
  ok: boolean;
  country: CountryCode;
  /** Digitos nacionais (sem DDI). */
  nationalDigits: string;
  ext: string;
  e164: string | null;
  raw: string;
}

/** Le um valor gravado (E.164, "+55 (11) 9...", "11 98584-2279", texto livre...). */
export function parseStoredPhone(raw: unknown, fallbackCountry: CountryCode = DEFAULT_PHONE_COUNTRY): ParsedStoredPhone {
  const original = raw === null || raw === undefined ? '' : String(raw);
  const empty: ParsedStoredPhone = { ok: true, country: fallbackCountry, nationalDigits: '', ext: '', e164: null, raw: original };
  if (!original.trim()) return empty;
  const { number, ext } = splitExtension(original);
  const digits = number.replace(/\D/g, '');
  // Texto que nao parece telefone (letras alem de separadores) => preservar.
  const letters = number.replace(/(ramal|ext|tel|cel|fone|whats(app)?)/gi, '').replace(/[\d\s()+\-./]/g, '');
  if (letters.length > 0 || digits.length < 8) {
    return { ok: false, country: fallbackCountry, nationalDigits: '', ext: '', e164: null, raw: original };
  }
  let candidate = number.trim();
  if (!candidate.startsWith('+') && candidate.startsWith('00')) candidate = `+${digits.slice(2)}`;
  else if (!candidate.startsWith('+') && digits.startsWith('55') && (digits.length === 12 || digits.length === 13)) candidate = `+${digits}`;
  const parsed = parsePhoneNumberFromString(candidate, fallbackCountry);
  if (!parsed || !parsed.isValid()) {
    return { ok: false, country: fallbackCountry, nationalDigits: '', ext: '', e164: null, raw: original };
  }
  const country = (parsed.country || fallbackCountry) as CountryCode;
  return {
    ok: true,
    country,
    nationalDigits: String(parsed.nationalNumber),
    ext: ext || (parsed.ext ? String(parsed.ext) : ''),
    e164: parsed.number,
    raw: original,
  };
}

/** Mascara nacional enquanto digita (BR: "(11) 98584-2279" / "(11) 3333-4444"). */
export function formatNationalAsYouType(country: CountryCode, digits: string): string {
  const d = String(digits || '').replace(/\D/g, '').slice(0, 17);
  if (!d) return '';
  const out = new AsYouType(country).input(d);
  return out || d;
}

/** Maximo de digitos nacionais aceitos para o pais (BR: 11). */
export function maxNationalDigits(country: CountryCode): number {
  for (let n = 17; n >= 4; n--) {
    const probe = '9'.repeat(n);
    if (validatePhoneNumberLength(probe, country) !== 'TOO_LONG') return n;
  }
  return 15;
}

export type PhoneValidation = 'EMPTY' | 'OK' | 'TOO_SHORT' | 'TOO_LONG' | 'INVALID';

export function validateNational(country: CountryCode, digits: string): PhoneValidation {
  const d = String(digits || '').replace(/\D/g, '');
  if (!d) return 'EMPTY';
  const len = validatePhoneNumberLength(d, country);
  if (len === 'TOO_SHORT' || len === 'NOT_A_NUMBER') return 'TOO_SHORT';
  if (len === 'TOO_LONG') return 'TOO_LONG';
  if (len === 'INVALID_LENGTH') return 'INVALID';
  const p = parsePhoneNumberFromString(d, country);
  return p && p.isValid() ? 'OK' : 'INVALID';
}

/** Celular? (BR: 9 digitos apos o DDD). Indefinido => false. */
export function isMobileNumber(country: CountryCode, digits: string): boolean {
  const p = parsePhoneNumberFromString(String(digits || '').replace(/\D/g, ''), country);
  if (!p) return false;
  const t = p.getType();
  if (t === 'MOBILE') return true;
  if (country === 'BR') return /^\d{2}9\d{8}$/.test(p.nationalNumber);
  return false;
}

/** Valor para gravar: E.164 (+5511985842279), com ";ext=NN" quando ha ramal. */
export function toStoredPhone(country: CountryCode, digits: string, ext = ''): string {
  const d = String(digits || '').replace(/\D/g, '');
  if (!d) return '';
  const p = parsePhoneNumberFromString(d, country);
  const e164 = p && p.isValid() ? p.number : `${dialCodeOf(country)}${d}`;
  const x = String(ext || '').replace(/\D/g, '').slice(0, 6);
  return x ? `${e164};ext=${x}` : e164;
}

/** Exibicao: BR em formato nacional "(11) 98584-2279"; exterior "+1 415 555 2671"; ramal " ramal 12". */
export function formatPhoneForDisplay(raw: unknown): string {
  const original = raw === null || raw === undefined ? '' : String(raw);
  if (!original.trim()) return '';
  const parsed = parseStoredPhone(original);
  if (!parsed.ok || !parsed.e164) return original;
  const p = parsePhoneNumberFromString(parsed.e164);
  if (!p) return original;
  const base = parsed.country === DEFAULT_PHONE_COUNTRY ? p.formatNational() : p.formatInternational();
  return parsed.ext ? `${base} ramal ${parsed.ext}` : base;
}
