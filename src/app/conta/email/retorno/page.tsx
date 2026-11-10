'use client';
// Retorno do login da Microsoft ao conectar a caixa Outlook (OAuth2). A pagina so repassa
// code + state ao servidor (POST /api/mailbox/oauth/complete, com a sessao do usuario) e
// limpa o endereco do navegador. Nenhum token passa pelo navegador.
import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Loader2, Mail, XCircle } from 'lucide-react';

type Phase = 'LOADING' | 'OK' | 'ERROR';

export default function MailboxOAuthReturnPage() {
  const [phase, setPhase] = useState<Phase>('LOADING');
  const [message, setMessage] = useState('Concluindo a conexão da sua caixa de e-mail...');
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code') || '';
    const state = params.get('state') || '';
    const denied = params.get('error');
    window.history.replaceState(null, '', window.location.pathname);
    if (denied || !code || !state) {
      setPhase('ERROR');
      setMessage('A conexão foi cancelada ou não foi autorizada na Microsoft.');
      return;
    }
    (async () => {
      try {
        const res = await fetch('/api/mailbox/oauth/complete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code, state }),
        });
        const json = await res.json().catch(() => null);
        if (!res.ok) {
          setPhase('ERROR');
          setMessage(json?.error || 'Não foi possível concluir a conexão com a Microsoft. Tente novamente.');
          return;
        }
        setPhase('OK');
        setMessage(`Caixa ${json?.data?.mailboxAddress || ''} conectada. Os e-mails enviados pelo STI-hub sairão por este endereço.`);
      } catch {
        setPhase('ERROR');
        setMessage('Não foi possível concluir a conexão com a Microsoft. Tente novamente.');
      }
    })();
  }, []);

  return (
    <main className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
      <div className="w-full max-w-md bg-white rounded-xl border border-slate-200 p-6 space-y-4">
        <div className="flex items-center gap-2 text-slate-900">
          <Mail className="w-5 h-5 text-accent" />
          <h1 className="text-base font-semibold">Conexão da caixa de e-mail</h1>
        </div>
        <div className="flex items-start gap-2 text-sm text-slate-700">
          {phase === 'LOADING' && <Loader2 className="w-4 h-4 mt-0.5 animate-spin text-slate-500" />}
          {phase === 'OK' && <CheckCircle2 className="w-4 h-4 mt-0.5 text-accent" />}
          {phase === 'ERROR' && <XCircle className="w-4 h-4 mt-0.5 text-slate-500" />}
          <p className="font-semibold">{message}</p>
        </div>
        {phase !== 'LOADING' && (
          <a
            href="/"
            className="inline-flex items-center justify-center px-4 py-2 rounded-lg bg-accent hover:opacity-90 text-white text-sm font-semibold"
          >
            Voltar ao STI-hub
          </a>
        )}
      </div>
    </main>
  );
}
