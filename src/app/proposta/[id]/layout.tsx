import type { Metadata } from 'next';
import type { ReactNode } from 'react';

// Link assinado de proposta (29/10/2026): a pagina nunca envia Referer (o token fica no
// fragmento #t=, que de qualquer forma nao vai no Referer) e nao deve ser indexada.
export const metadata: Metadata = {
  referrer: 'no-referrer',
  robots: { index: false, follow: false },
};

export default function ProposalLinkLayout({ children }: { children: ReactNode }) {
  return children;
}
