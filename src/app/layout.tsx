import React from 'react';
import './globals.css';

export const metadata = {
  title: 'STI-hub | Seta Telecom CRM & ERP',
  description:
    'STI-hub — Plataforma integrada de CRM e ERP da Seta Telecom (SETA IT) com GestãoClick ao vivo, Propostas PDF, Contratos de Locação e Copiloto IA.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body className="bg-slate-50 text-slate-900 antialiased selection:bg-[#ff7a59] selection:text-white">
        {children}
      </body>
    </html>
  );
}
