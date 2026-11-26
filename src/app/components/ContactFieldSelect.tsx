'use client';

import React from 'react';
import type { ContactFieldListKind } from '../lib/contact-field-lists';
import { useContactFieldOptions } from '../lib/use-contact-field-options';
import SearchableOptionSelect from './SearchableOptionSelect';

export default function ContactFieldSelect({
  kind,
  value,
  onChange,
  disabled,
  className,
  testId,
  placeholder = 'Selecionar',
  ariaLabel,
}: {
  kind: ContactFieldListKind;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  className?: string;
  testId?: string;
  placeholder?: string;
  ariaLabel?: string;
}) {
  const { optionsFor } = useContactFieldOptions();
  return (
    <SearchableOptionSelect
      value={value}
      onChange={onChange}
      options={optionsFor(kind, value)}
      disabled={disabled}
      className={className}
      testId={testId}
      placeholder={placeholder}
      ariaLabel={ariaLabel}
    />
  );
}
