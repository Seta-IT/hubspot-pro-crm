'use client';

// ============================================================================
// Botão de envio de arquivo (TXT/XML da NF-e de Importação) que sempre abre o seletor do sistema.
//  - O <input type="file"> fica SEMPRE montado e só escondido visualmente (sr-only), nunca com
//    display:none / atributo `hidden`: alguns navegadores (WebKit/Safari, webviews embutidas)
//    não abrem o seletor de um input com display:none ativado por <label>.
//  - <label htmlFor> aponta para o input pelo id (sem depender de aninhamento).
//  - Teclado (Enter/Espaço) e clique chamam inputRef.current.click() de forma SÍNCRONA, dentro do
//    gesto do usuário (sem await/setState/setTimeout antes), para o navegador não bloquear.
//  - value é limpo depois da leitura para permitir reenviar o mesmo arquivo.
// ============================================================================
import React, { useId, useRef } from 'react';

export const IMPORT_FILE_ACCEPT = '.txt,.xml,text/plain,text/xml,application/xml';

export interface ImportFilePickerProps {
  onFileSelected: (e: React.ChangeEvent<HTMLInputElement>) => void;
  className: string;
  children: React.ReactNode;
  accept?: string;
  testId?: string;
  title?: string;
}

export default function ImportFilePicker({
  onFileSelected,
  className,
  children,
  accept = IMPORT_FILE_ACCEPT,
  testId,
  title,
}: ImportFilePickerProps) {
  const reactId = useId();
  const inputId = `import-file-${reactId.replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const inputRef = useRef<HTMLInputElement>(null);

  const openChooserSync = () => {
    // Síncrono, no mesmo gesto do usuário.
    inputRef.current?.click();
  };

  return (
    <>
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        accept={accept}
        className="sr-only"
        tabIndex={-1}
        data-testid={testId ? `${testId}-input` : undefined}
        onChange={(e) => {
          onFileSelected(e);
          // permite escolher o mesmo arquivo de novo
          e.target.value = '';
        }}
      />
      <label
        htmlFor={inputId}
        role="button"
        tabIndex={0}
        title={title}
        data-testid={testId}
        className={className}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            openChooserSync();
          }
        }}
      >
        {children}
      </label>
    </>
  );
}
