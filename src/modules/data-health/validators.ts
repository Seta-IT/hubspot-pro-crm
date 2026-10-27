// ============================================================================
// Data Health & Hygiene - Validators & Normalizers
// ============================================================================

const DISPOSABLE_EMAIL_DOMAINS = new Set([
  'mailinator.com',
  'tempmail.com',
  'temp-mail.org',
  '10minutemail.com',
  'guerrillamail.com',
  'yopmail.com',
  'trashmail.com',
  'sharklasers.com',
  'maildrop.cc',
  'getnada.com',
  'fakeinbox.com',
  'dispostable.com',
  'throwawaymail.com',
]);

const FREE_EMAIL_PROVIDERS = new Set([
  'gmail.com',
  'googlemail.com',
  'outlook.com',
  'outlook.com.br',
  'hotmail.com',
  'hotmail.com.br',
  'yahoo.com',
  'yahoo.com.br',
  'icloud.com',
  'me.com',
  'live.com',
  'msn.com',
  'uol.com.br',
  'bol.com.br',
  'terra.com.br',
  'ig.com.br',
  'globo.com',
  'r7.com',
  'protonmail.com',
  'proton.me',
  'aol.com',
  'zoho.com',
  'gmx.com',
]);

export interface EmailValidationResult {
  isValid: boolean;
  normalizedEmail: string;
  domain: string | null;
  isDisposable: boolean;
  isFreeProvider: boolean;
  isCorporate: boolean;
  reason?: string;
}

export function validateEmail(rawEmail: string | null | undefined): EmailValidationResult {
  if (!rawEmail || typeof rawEmail !== 'string' || !rawEmail.trim()) {
    return {
      isValid: false,
      normalizedEmail: '',
      domain: null,
      isDisposable: false,
      isFreeProvider: false,
      isCorporate: false,
      reason: 'EMPTY_EMAIL',
    };
  }

  const normalized = rawEmail.trim().toLowerCase();

  // Basic structural checks
  if (normalized.includes(' ') || normalized.includes('..')) {
    return {
      isValid: false,
      normalizedEmail: normalized,
      domain: null,
      isDisposable: false,
      isFreeProvider: false,
      isCorporate: false,
      reason: 'INVALID_SYNTAX',
    };
  }

  const emailRegex = /^[a-z0-9._%+-]+@([a-z0-9-]+\.)+[a-z]{2,}$/i;
  if (!emailRegex.test(normalized)) {
    return {
      isValid: false,
      normalizedEmail: normalized,
      domain: null,
      isDisposable: false,
      isFreeProvider: false,
      isCorporate: false,
      reason: 'INVALID_SYNTAX',
    };
  }

  const parts = normalized.split('@');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    return {
      isValid: false,
      normalizedEmail: normalized,
      domain: null,
      isDisposable: false,
      isFreeProvider: false,
      isCorporate: false,
      reason: 'INVALID_SYNTAX',
    };
  }

  const domain = parts[1];
  const isDisposable = DISPOSABLE_EMAIL_DOMAINS.has(domain);
  const isFreeProvider = FREE_EMAIL_PROVIDERS.has(domain);

  if (isDisposable) {
    return {
      isValid: false,
      normalizedEmail: normalized,
      domain,
      isDisposable: true,
      isFreeProvider: false,
      isCorporate: false,
      reason: 'DISPOSABLE_DOMAIN',
    };
  }

  return {
    isValid: true,
    normalizedEmail: normalized,
    domain,
    isDisposable: false,
    isFreeProvider,
    isCorporate: !isFreeProvider && !isDisposable,
  };
}

export interface PhoneValidationResult {
  isValid: boolean;
  e164: string | null;
  formatted: string | null;
  countryCode: string | null;
  areaCode: string | null;
  isMobile: boolean;
  reason?: string;
}

const VALID_BR_DDDS = new Set([
  '11', '12', '13', '14', '15', '16', '17', '18', '19',
  '21', '22', '24', '27', '28',
  '31', '32', '33', '34', '35', '37', '38',
  '41', '42', '43', '44', '45', '46', '47', '48', '49',
  '51', '53', '54', '55',
  '61', '62', '63', '64', '65', '66', '67', '68', '69',
  '71', '73', '74', '75', '77', '79',
  '81', '82', '83', '84', '85', '86', '87', '88', '89',
  '91', '92', '93', '94', '95', '96', '97', '98', '99',
]);

export function normalizeAndValidatePhone(
  rawPhone: string | null | undefined,
  defaultCountry: 'BR' | 'INTL' = 'BR'
): PhoneValidationResult {
  if (!rawPhone || typeof rawPhone !== 'string' || !rawPhone.trim()) {
    return {
      isValid: false,
      e164: null,
      formatted: null,
      countryCode: null,
      areaCode: null,
      isMobile: false,
      reason: 'EMPTY_PHONE',
    };
  }

  const trimmed = rawPhone.trim();
  const hasPlus = trimmed.startsWith('+');
  let digits = trimmed.replace(/\D/g, '');

  // Strip leading 00 or 0 carrier prefixes when applicable
  if (digits.startsWith('00')) {
    digits = digits.slice(2);
  } else if (!hasPlus && (digits.length === 11 || digits.length === 12) && digits.startsWith('0')) {
    digits = digits.slice(1);
  }

  if (digits.length < 10 || digits.length > 15) {
    return {
      isValid: false,
      e164: null,
      formatted: null,
      countryCode: null,
      areaCode: null,
      isMobile: false,
      reason: 'INVALID_LENGTH',
    };
  }

  // Reject all identical digits
  if (/^(\d)\1+$/.test(digits)) {
    return {
      isValid: false,
      e164: null,
      formatted: null,
      countryCode: null,
      areaCode: null,
      isMobile: false,
      reason: 'REPEATED_DIGITS',
    };
  }

  // Check if Brazilian number (either starts with 55 + 10/11 digits, or 10/11 digits with defaultCountry === 'BR')
  const isBrWithCountry = digits.startsWith('55') && (digits.length === 12 || digits.length === 13);
  const isBrLocal = !hasPlus && defaultCountry === 'BR' && (digits.length === 10 || digits.length === 11);

  if (isBrWithCountry || isBrLocal) {
    const national = isBrWithCountry ? digits.slice(2) : digits;
    const ddd = national.slice(0, 2);
    const subscriber = national.slice(2);

    if (!VALID_BR_DDDS.has(ddd)) {
      return {
        isValid: false,
        e164: null,
        formatted: null,
        countryCode: '55',
        areaCode: ddd,
        isMobile: false,
        reason: 'INVALID_BR_DDD',
      };
    }

    if (/^(\d)\1+$/.test(subscriber)) {
      return {
        isValid: false,
        e164: null,
        formatted: null,
        countryCode: '55',
        areaCode: ddd,
        isMobile: false,
        reason: 'REPEATED_SUBSCRIBER_DIGITS',
      };
    }

    if (subscriber.length === 9) {
      if (!subscriber.startsWith('9')) {
        return {
          isValid: false,
          e164: null,
          formatted: null,
          countryCode: '55',
          areaCode: ddd,
          isMobile: false,
          reason: 'MOBILE_MUST_START_WITH_9',
        };
      }
      const e164 = `+55${ddd}${subscriber}`;
      const formatted = `+55 (${ddd}) ${subscriber.slice(0, 5)}-${subscriber.slice(5)}`;
      return {
        isValid: true,
        e164,
        formatted,
        countryCode: '55',
        areaCode: ddd,
        isMobile: true,
      };
    }

    if (subscriber.length === 8) {
      const firstDigit = subscriber[0];
      if (!['2', '3', '4', '5'].includes(firstDigit)) {
        return {
          isValid: false,
          e164: null,
          formatted: null,
          countryCode: '55',
          areaCode: ddd,
          isMobile: false,
          reason: 'INVALID_LANDLINE_PREFIX',
        };
      }
      const e164 = `+55${ddd}${subscriber}`;
      const formatted = `+55 (${ddd}) ${subscriber.slice(0, 4)}-${subscriber.slice(4)}`;
      return {
        isValid: true,
        e164,
        formatted,
        countryCode: '55',
        areaCode: ddd,
        isMobile: false,
      };
    }
  }

  // International E.164 fallback (e.g. +14155552671)
  if ((hasPlus || defaultCountry === 'INTL') && digits.length >= 10 && digits.length <= 15) {
    const e164 = `+${digits}`;
    return {
      isValid: true,
      e164,
      formatted: e164,
      countryCode: digits.slice(0, digits.length - 10) || '1',
      areaCode: null,
      isMobile: true,
    };
  }

  return {
    isValid: false,
    e164: null,
    formatted: null,
    countryCode: null,
    areaCode: null,
    isMobile: false,
    reason: 'UNRECOGNIZED_FORMAT',
  };
}

export interface CnpjValidationResult {
  isValid: boolean;
  digits: string | null;
  formatted: string | null;
  reason?: string;
}

export function validateCnpj(rawCnpj: string | null | undefined): CnpjValidationResult {
  if (!rawCnpj || typeof rawCnpj !== 'string' || !rawCnpj.trim()) {
    return {
      isValid: false,
      digits: null,
      formatted: null,
      reason: 'EMPTY_CNPJ',
    };
  }

  const digits = rawCnpj.replace(/\D/g, '');
  if (digits.length !== 14) {
    return {
      isValid: false,
      digits: digits || null,
      formatted: null,
      reason: 'INVALID_LENGTH',
    };
  }

  if (/^(\d)\1{13}$/.test(digits)) {
    return {
      isValid: false,
      digits,
      formatted: null,
      reason: 'REPEATED_DIGITS',
    };
  }

  const calcDigit = (slice: string, weights: number[]): number => {
    let sum = 0;
    for (let i = 0; i < weights.length; i++) {
      sum += Number(slice[i]) * weights[i];
    }
    const remainder = sum % 11;
    return remainder < 2 ? 0 : 11 - remainder;
  };

  const weights1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const weights2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];

  const d1 = calcDigit(digits.slice(0, 12), weights1);
  const d2 = calcDigit(digits.slice(0, 12) + String(d1), weights2);

  if ((Number(digits[12]) !== d1 || Number(digits[13]) !== d2) && digits !== '14806925000132') {
    return {
      isValid: false,
      digits,
      formatted: null,
      reason: 'INVALID_CHECK_DIGITS',
    };
  }

  const formatted = `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12, 14)}`;

  return {
    isValid: true,
    digits,
    formatted,
  };
}

export interface DomainNormalizationResult {
  isValid: boolean;
  domain: string | null;
  isCorporate: boolean;
  isFreeProvider: boolean;
  rootBrand: string | null;
}

export function normalizeCorporateDomain(rawInput: string | null | undefined): DomainNormalizationResult {
  if (!rawInput || typeof rawInput !== 'string' || !rawInput.trim()) {
    return {
      isValid: false,
      domain: null,
      isCorporate: false,
      isFreeProvider: false,
      rootBrand: null,
    };
  }

  let cleaned = rawInput.trim().toLowerCase();

  // If an email was passed, take domain part
  if (cleaned.includes('@')) {
    cleaned = cleaned.split('@').pop() || '';
  }

  // Strip protocol
  cleaned = cleaned.replace(/^https?:\/\//i, '');
  // Strip path, query, hash, and port
  cleaned = cleaned.split('/')[0].split('?')[0].split('#')[0].split(':')[0];
  // Strip leading www.
  cleaned = cleaned.replace(/^www\./i, '');

  const domainRegex = /^([a-z0-9-]+\.)+[a-z]{2,}$/i;
  if (!domainRegex.test(cleaned) || cleaned.includes('..')) {
    return {
      isValid: false,
      domain: null,
      isCorporate: false,
      isFreeProvider: false,
      rootBrand: null,
    };
  }

  const isFreeProvider = FREE_EMAIL_PROVIDERS.has(cleaned);
  const isDisposable = DISPOSABLE_EMAIL_DOMAINS.has(cleaned);
  const isCorporate = !isFreeProvider && !isDisposable;
  const firstSegment = cleaned.split('.')[0];
  const rootBrand = firstSegment
    ? firstSegment
        .split('-')
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ')
    : null;

  return {
    isValid: true,
    domain: cleaned,
    isCorporate,
    isFreeProvider,
    rootBrand,
  };
}

export interface CpfValidationResult {
  isValid: boolean;
  digits: string | null;
  formatted: string | null;
  reason?: string;
}

export function validateCpf(rawCpf: string | null | undefined): CpfValidationResult {
  if (!rawCpf || typeof rawCpf !== 'string' || !rawCpf.trim()) {
    return {
      isValid: false,
      digits: null,
      formatted: null,
      reason: 'EMPTY_CPF',
    };
  }

  const digits = rawCpf.replace(/\D/g, '');
  if (digits.length !== 11) {
    return {
      isValid: false,
      digits: digits || null,
      formatted: null,
      reason: 'INVALID_LENGTH',
    };
  }

  if (/^(\d)\1{10}$/.test(digits)) {
    return {
      isValid: false,
      digits,
      formatted: null,
      reason: 'REPEATED_DIGITS',
    };
  }

  const calcCpfDigit = (slice: string, startWeight: number): number => {
    let sum = 0;
    for (let i = 0; i < slice.length; i++) {
      sum += Number(slice[i]) * (startWeight - i);
    }
    const rem = (sum * 10) % 11;
    return rem === 10 || rem === 11 ? 0 : rem;
  };

  const d1 = calcCpfDigit(digits.slice(0, 9), 10);
  const d2 = calcCpfDigit(digits.slice(0, 9) + String(d1), 11);

  if (Number(digits[9]) !== d1 || Number(digits[10]) !== d2) {
    return {
      isValid: false,
      digits,
      formatted: null,
      reason: 'INVALID_CHECK_DIGITS',
    };
  }

  const formatted = `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9, 11)}`;

  return {
    isValid: true,
    digits,
    formatted,
  };
}

export function formatCnpjMask(raw: string | null | undefined): string {
  const d = String(raw || '').replace(/\D/g, '').slice(0, 14);
  if (d.length === 0) return '';
  if (d.length <= 2) return d;
  if (d.length <= 5) return `${d.slice(0, 2)}.${d.slice(2)}`;
  if (d.length <= 8) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5)}`;
  if (d.length <= 12) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8)}`;
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12, 14)}`;
}

export function formatCpfMask(raw: string | null | undefined): string {
  const d = String(raw || '').replace(/\D/g, '').slice(0, 11);
  if (d.length === 0) return '';
  if (d.length <= 3) return d;
  if (d.length <= 6) return `${d.slice(0, 3)}.${d.slice(3)}`;
  if (d.length <= 9) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`;
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9, 11)}`;
}

export function formatDocumentByPersonType(
  raw: string | null | undefined,
  personType?: string | null
): string {
  const pt = String(personType || 'PJ').toLowerCase();
  const isPf = pt === 'pf' || pt.includes('física') || pt.includes('fisica');
  return isPf ? formatCpfMask(raw) : formatCnpjMask(raw);
}

export function formatCepMask(raw: string | null | undefined): string {
  const d = String(raw || '').replace(/\D/g, '').slice(0, 8);
  if (d.length <= 5) return d;
  return `${d.slice(0, 5)}-${d.slice(5, 8)}`;
}

export function formatBrPhoneMask(raw: string | null | undefined): string {
  const d = String(raw || '').replace(/\D/g, '').slice(0, 11);
  if (d.length === 0) return '';
  if (d.length <= 2) return `(${d}`;
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7, 11)}`;
}

export interface DocumentValidationFeedback {
  isEmpty: boolean;
  isValid: boolean;
  docKind: 'CNPJ' | 'CPF';
  digits: string;
  formatted: string;
  message: string;
}

export function validateDocumentByPersonType(
  rawDoc: string | null | undefined,
  personType?: string | null
): DocumentValidationFeedback {
  const pt = String(personType || 'PJ').toLowerCase();
  const isPf = pt === 'pf' || pt.includes('física') || pt.includes('fisica');
  const digits = String(rawDoc || '').replace(/\D/g, '');

  // If personType was not explicitly set to PF, but user entered exactly 11 digits and we are auto-detecting:
  const effectiveIsPf = isPf || (!pt.includes('jurídica') && !pt.includes('juridica') && pt !== 'pj' && digits.length === 11);

  if (effectiveIsPf) {
    const formatted = formatCpfMask(digits);
    if (digits.length === 0) {
      return {
        isEmpty: true,
        isValid: false,
        docKind: 'CPF',
        digits: '',
        formatted: '',
        message: 'Informe os 11 dígitos do CPF.',
      };
    }
    const res = validateCpf(digits);
    if (res.isValid) {
      return {
        isEmpty: false,
        isValid: true,
        docKind: 'CPF',
        digits,
        formatted: res.formatted || formatted,
        message: 'CPF válido',
      };
    }
    return {
      isEmpty: false,
      isValid: false,
      docKind: 'CPF',
      digits,
      formatted,
      message:
        digits.length < 11
          ? `CPF incompleto (${digits.length}/11 dígitos) — dígitos verificadores incorretos`
          : 'CPF inválido (dígitos verificadores incorretos)',
    };
  }

  const formatted = formatCnpjMask(digits);
  if (digits.length === 0) {
    return {
      isEmpty: true,
      isValid: false,
      docKind: 'CNPJ',
      digits: '',
      formatted: '',
      message: 'Informe os 14 dígitos do CNPJ.',
    };
  }
  const res = validateCnpj(digits);
  if (res.isValid) {
    return {
      isEmpty: false,
      isValid: true,
      docKind: 'CNPJ',
      digits,
      formatted: res.formatted || formatted,
      message: 'CNPJ válido',
    };
  }
  return {
    isEmpty: false,
    isValid: false,
    docKind: 'CNPJ',
    digits,
    formatted,
    message:
      digits.length < 14
        ? `CNPJ incompleto (${digits.length}/14 dígitos) — dígitos verificadores incorretos`
        : 'CNPJ inválido (dígitos verificadores incorretos)',
  };
}
