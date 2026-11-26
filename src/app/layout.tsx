import React from 'react';
import './globals.css';

/** HTML da SPA não pode ficar um ano no cache (s-maxage padrão do Next estático). */
export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';

export const metadata = {
  title: 'STI-hub | Seta Telecom CRM & ERP',
  description:
    'STI-hub — STI HUB CRM, STI HUB ERP e STI HUB Desk Service da Seta Telecom (SETA IT): Propostas PDF, Contratos de Locação e Copiloto IA.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body className="bg-slate-50 text-slate-900 antialiased selection:bg-accent selection:text-white">
        {children}
      </body>
    </html>
  );
}
