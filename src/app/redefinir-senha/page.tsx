'use client';

import React, { useEffect, useState } from 'react';
import AuthCardShell, { AUTH_BUTTON_CLASS, AUTH_INPUT_CLASS } from '../lib/AuthCardShell';
import { loadClientIamUsersOverride } from '../lib/auth';
import { saveClientIamUserOverrideIfNewer } from '../lib/iam-seal-cache';

export default function RedefinirSenhaPage() {
  const [token, setToken] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const t = params.get('token');
    if (t) {
      setToken(t);
      // Remove o token da barra de endereco/historico assim que lido.
      window.history.replaceState(null, '', '/redefinir-senha');
    } else {
      setError('Link de redefinição inválido. Solicite um novo em "Esqueci minha senha".');
    }
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!token) return;
    if (password.trim().length < 6) {
      setError('A senha deve ter pelo menos 6 caracteres.');
      return;
    }
    if (password.trim() !== confirm.trim()) {
      setError('A confirmação de senha não confere.');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ token, password: password.trim(), iamUsersOverride: loadClientIamUsersOverride() }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json?.error || 'Não foi possível redefinir a senha.');
        return;
      }
      if (json?.data?.user) saveClientIamUserOverrideIfNewer(json.data.user);
      // Encerra qualquer sessao local: o proximo acesso exige login + 2FA.
      try {
        localStorage.removeItem('stihub_active_session_v1');
      } catch {
        // ignore
      }
      // O cookie de sessao e HttpOnly: so o servidor consegue apaga-lo.
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' }).catch(() => {});
      setToken(null);
      setPassword('');
      setConfirm('');
      setDone(json?.data?.message || 'Senha redefinida com sucesso. Faça login com a nova senha.');
    } catch {
      setError('Erro de comunicação com o servidor.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthCardShell title="Redefinir senha" subtitle="Cadastre uma nova senha para acessar o STI-hub">
      {error && (
        <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-semibold">{error}</div>
      )}
      {done ? (
        <div className="space-y-4">
          <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs font-semibold">
            {done}
          </div>
          <a href="/login" className={AUTH_BUTTON_CLASS}>Ir para o login</a>
        </div>
      ) : token ? (
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Nova senha *</label>
            <input type="password" autoComplete="new-password" required minLength={6} value={password}
              onChange={(e) => setPassword(e.target.value)} placeholder="Mínimo de 6 caracteres" className={AUTH_INPUT_CLASS} />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Confirmar nova senha *</label>
            <input type="password" autoComplete="new-password" required minLength={6} value={confirm}
              onChange={(e) => setConfirm(e.target.value)} placeholder="Repita a nova senha" className={AUTH_INPUT_CLASS} />
          </div>
          <button type="submit" disabled={loading} className={AUTH_BUTTON_CLASS}>
            {loading ? 'Salvando...' : 'Redefinir senha'}
          </button>
        </form>
      ) : (
        <a href="/esqueci-senha" className={AUTH_BUTTON_CLASS}>Solicitar novo link</a>
      )}
    </AuthCardShell>
  );
}
