import React from 'react';
import './globals.css';

export const metadata = {
  title: 'HubSpot Pro CRM — Inteligência Comercial, Saúde da Base & Copiloto IA',
  description:
    'Plataforma CRM estilo HubSpot Pro / Twenty CRM com IA Analista de Funil, Kanban Comercial, Smart Data Enrichment, Data Health e Cadências de E-mail.',
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
