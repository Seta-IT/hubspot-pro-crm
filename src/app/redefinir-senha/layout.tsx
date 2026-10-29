import React from 'react';

// O token de redefinicao vai na URL: nunca enviar Referer para terceiros nem indexar.
export const metadata = {
  title: 'Redefinir senha | STI-hub',
  referrer: 'no-referrer',
  robots: { index: false, follow: false },
};

export default function RedefinirSenhaLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
