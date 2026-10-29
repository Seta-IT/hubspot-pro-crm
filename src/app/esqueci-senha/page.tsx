'use client';

import React, { useState } from 'react';
import { loadClientIamUsersOverride } from '../lib/auth';
import AuthCardShell, { AUTH_BUTTON_CLASS, AUTH_INPUT_CLASS } from '../lib/AuthCardShell';

export default function EsqueciSenhaPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ email: email.trim(), iamUsersOverride: loadClientIamUsersOverride() }),
      });
      const json = await res.json().catch(() => ({}));
      setDone(
        json?.data?.message ||
          'Se o e-mail informado pertencer a um usuário ativo do STI-hub, você receberá em instantes um link para redefinir a senha.'
      );
    } catch {
      setError('Erro de comunicação com o servidor. Tente novamente.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthCardShell title="Esqueci minha senha" subtitle="Informe o seu e-mail corporativo para receber o link de redefinição">
      {error && (
        <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-semibold">{error}</div>
      )}
      {done ? (
        <div className="space-y-4">
          <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs font-semibold">
            {done}
          </div>
          <a href="/login" className={AUTH_BUTTON_CLASS}>Voltar para o login</a>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">E-mail</label>
            <input
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="nome@setatelecom.com.br"
              className={AUTH_INPUT_CLASS}
            />
          </div>
          <button type="submit" disabled={loading} className={AUTH_BUTTON_CLASS}>
            {loading ? 'Enviando...' : 'Enviar link de redefinição'}
          </button>
          <div className="text-center">
            <a href="/login" className="text-xs font-semibold text-[#0d2b4e] hover:underline">Voltar para o login</a>
          </div>
        </form>
      )}
    </AuthCardShell>
  );
}
