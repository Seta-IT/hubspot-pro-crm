import React from 'react';
import './globals.css';

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
