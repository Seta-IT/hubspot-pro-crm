'use client';

/**
 * Campo de telefone no padrao HubSpot: pais (bandeira + DDI, padrao Brasil +55), mascara nacional
 * enquanto digita, ramal opcional so no telefone fixo e validacao de comprimento.
 * `value` aceita E.164, formatos antigos ou texto livre; `onChange` devolve E.164 (com ";ext=NN").
 * Texto antigo que nao da para interpretar continua intacto ate o usuario editar o numero.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { CountryCode } from 'libphonenumber-js/min';
import {
  DEFAULT_PHONE_COUNTRY,
  dialCodeOf,
  formatNationalAsYouType,
  isMobileNumber,
  maxNationalDigits,
  parseStoredPhone,
  phoneCountryOptions,
  toStoredPhone,
  validateNational,
  type PhoneKind,
} from '../lib/phone-format';

export interface PhoneInputProps {
  value: string | null | undefined;
  onChange: (stored: string) => void;
  /** 'phone' (fixo/geral, com ramal opcional) ou 'mobile' (celular, sem ramal). */
  kind?: PhoneKind;
  id?: string;
  name?: string;
  disabled?: boolean;
  required?: boolean;
  placeholder?: string;
  className?: string;
  /** Classe extra do campo de numero (para seguir o visual do formulario). */
  inputClassName?: string;
  'aria-label'?: string;
  'data-testid'?: string;
  defaultCountry?: CountryCode;
}

const VALIDATION_MSG: Record<string, string> = {
  TOO_SHORT: 'Número incompleto.',
  TOO_LONG: 'Número longo demais para o país.',
  INVALID: 'Número inválido para o país selecionado.',
};

export default function PhoneInput({
  value,
  onChange,
  kind = 'phone',
  id,
  name,
  disabled,
  required,
  placeholder,
  className = '',
  inputClassName = '',
  defaultCountry = DEFAULT_PHONE_COUNTRY,
  ...rest
}: PhoneInputProps) {
  const options = useMemo(() => phoneCountryOptions(), []);
  const parsedInitial = useMemo(() => parseStoredPhone(value, defaultCountry), [value, defaultCountry]);
  const [country, setCountry] = useState<CountryCode>(parsedInitial.country);
  const [digits, setDigits] = useState(parsedInitial.nationalDigits);
  const [ext, setExt] = useState(parsedInitial.ext);
  const [legacyText, setLegacyText] = useState<string | null>(parsedInitial.ok ? null : parsedInitial.raw);
  const [touched, setTouched] = useState(false);
  const lastEmitted = useRef<string | null>(null);

  // Valor externo mudou (outro registro, reset do formulario) => ressincroniza.
  useEffect(() => {
    const incoming = value === null || value === undefined ? '' : String(value);
    if (lastEmitted.current !== null && incoming === lastEmitted.current) return;
    const p = parseStoredPhone(incoming, defaultCountry);
    setCountry(p.country);
    setDigits(p.nationalDigits);
    setExt(p.ext);
    setLegacyText(p.ok ? null : p.raw);
    setTouched(false);
    lastEmitted.current = null;
  }, [value, defaultCountry]);

  const emit = (c: CountryCode, d: string, x: string) => {
    const stored = toStoredPhone(c, d, x);
    lastEmitted.current = stored;
    onChange(stored);
  };

  const maxDigits = useMemo(() => maxNationalDigits(country), [country]);
  const status = validateNational(country, digits);
  const showExt = kind === 'phone' && !(digits && isMobileNumber(country, digits));
  const errorMsg = touched && status !== 'OK' && status !== 'EMPTY' ? VALIDATION_MSG[status] : '';
  const nationalPlaceholder =
    placeholder || (country === 'BR' ? (kind === 'mobile' ? '(11) 98584-2279' : '(11) 3333-4444') : 'Número');

  const baseInput =
    'min-w-0 flex-1 bg-transparent px-2 py-1.5 text-sm text-slate-800 outline-none placeholder:text-slate-400 disabled:cursor-not-allowed';

  return (
    <div className={`w-full ${className}`} data-phone-input={kind}>
      <div
        className={`flex items-stretch rounded-md border bg-white ${
          errorMsg ? 'border-red-400' : 'border-slate-300 focus-within:border-[#0b6b7a] focus-within:ring-1 focus-within:ring-[#0b6b7a]'
        } ${disabled ? 'opacity-60' : ''}`}
      >
        <label className="relative flex items-center border-r border-slate-200 pl-2 pr-1 text-sm text-slate-700">
          <span aria-hidden className="mr-1 text-base leading-none">{options.find((o) => o.code === country)?.flag}</span>
          <span className="text-slate-600">{dialCodeOf(country)}</span>
          <span aria-hidden className="ml-1 text-[10px] text-slate-400">▼</span>
          <select
            aria-label="País do telefone"
            className="absolute inset-0 cursor-pointer opacity-0"
            value={country}
            disabled={disabled}
            onChange={(e) => {
              const c = e.target.value as CountryCode;
              setCountry(c);
              setLegacyText(null);
              if (digits) emit(c, digits, showExt ? ext : '');
            }}
          >
            {options.map((o) => (
              <option key={o.code} value={o.code}>
                {o.flag} {o.name} ({o.dialCode})
              </option>
            ))}
          </select>
        </label>
        {legacyText !== null ? (
          <input
            id={id}
            name={name}
            type="tel"
            className={`${baseInput} ${inputClassName}`}
            value={legacyText}
            disabled={disabled}
            required={required}
            aria-label={rest['aria-label']}
            data-testid={rest['data-testid']}
            title="Valor antigo em texto livre: será convertido ao editar."
            onChange={(e) => {
              const p = parseStoredPhone(e.target.value, country);
              if (p.ok && p.nationalDigits) {
                setLegacyText(null);
                setCountry(p.country);
                setDigits(p.nationalDigits);
                setExt(p.ext);
                emit(p.country, p.nationalDigits, p.ext);
              } else {
                setLegacyText(e.target.value);
                lastEmitted.current = e.target.value;
                onChange(e.target.value);
              }
            }}
          />
        ) : (
          <input
            id={id}
            name={name}
            type="tel"
            inputMode="tel"
            autoComplete="tel-national"
            className={`${baseInput} ${inputClassName}`}
            placeholder={nationalPlaceholder}
            value={formatNationalAsYouType(country, digits)}
            disabled={disabled}
            required={required}
            aria-label={rest['aria-label']}
            data-testid={rest['data-testid']}
            aria-invalid={errorMsg ? true : undefined}
            onBlur={() => setTouched(true)}
            onChange={(e) => {
              let raw = e.target.value;
              // Colou um numero internacional completo: detecta o pais.
              if (/^\s*(\+|00)/.test(raw)) {
                const p = parseStoredPhone(raw, country);
                if (p.ok && p.nationalDigits) {
                  setCountry(p.country);
                  setDigits(p.nationalDigits);
                  setExt(p.ext);
                  emit(p.country, p.nationalDigits, p.ext);
                  return;
                }
              }
              const prevFormatted = formatNationalAsYouType(country, digits);
              let d = raw.replace(/\D/g, '');
              // Backspace sobre um separador da mascara apaga o digito anterior.
              if (raw.length < prevFormatted.length && d === digits) d = d.slice(0, -1);
              d = d.slice(0, maxDigits);
              setDigits(d);
              emit(country, d, showExt ? ext : '');
            }}
          />
        )}
        {showExt && legacyText === null && (
          <input
            type="text"
            inputMode="numeric"
            aria-label="Ramal"
            placeholder="Ramal"
            className="w-20 border-l border-slate-200 bg-transparent px-2 py-1.5 text-sm text-slate-800 outline-none placeholder:text-slate-400"
            value={ext}
            disabled={disabled || !digits}
            onChange={(e) => {
              const x = e.target.value.replace(/\D/g, '').slice(0, 6);
              setExt(x);
              emit(country, digits, x);
            }}
          />
        )}
      </div>
      {errorMsg && <p className="mt-1 text-xs text-red-600">{errorMsg}</p>}
    </div>
  );
}
