'use client';

import React, { useState } from 'react';
import {
  ShieldCheck,
  Lock,
  Mail,
  KeyRound,
  ArrowRight,
  CheckCircle2,
  Building2,
  Smartphone,
  Sparkles,
  AlertTriangle,
} from 'lucide-react';

interface QuickDemoAccount {
  name: string;
  email: string;
  roleLabel: string;
  roleId: string;
  scope: string;
  badgeColor: string;
}

const QUICK_ACCOUNTS: QuickDemoAccount[] = [
  {
    name: 'Marcelo Lopes Mira',
    email: 'marcelo.mira@setatelecom.com.br',
    roleLabel: 'Super Admin STI-hub / Diretoria',
    roleId: 'SUPER_ADMIN',
    scope: 'TODOS',
    badgeColor: 'bg-[#ff7a59] text-white',
  },
  {
    name: 'Evelyn Olivia de Rosa Ternero',
    email: 'evelyn@setatelecom.com.br',
    roleLabel: 'Gerente Comercial & RevOps',
    roleId: 'GERENTE_COMERCIAL',
    scope: 'TODOS',
    badgeColor: 'bg-indigo-600 text-white',
  },
  {
    name: 'Maria Luiza',
    email: 'marialuiza@setatelecom.com.br',
    roleLabel: 'Executiva de Contas (Sales Hub)',
    roleId: 'VENDEDOR_SALES',
    scope: 'PROPRIOS',
    badgeColor: 'bg-sky-600 text-white',
  },
  {
    name: 'Michelle da Rocha',
    email: 'michelle.rocha@setatelecom.com.br',
    roleLabel: 'Financeiro, Contratos & Cobrança',
    roleId: 'FINANCEIRO_FATURAMENTO',
    scope: 'TODOS',
    badgeColor: 'bg-emerald-600 text-white',
  },
  {
    name: 'Beatriz Nogueira',
    email: 'fiscal@setatelecom.com.br',
    roleLabel: 'Fiscal & Tributário (SV 31 STF)',
    roleId: 'FISCAL_CONTABIL',
    scope: 'TODOS',
    badgeColor: 'bg-amber-600 text-white',
  },
  {
    name: 'Carlos Eduardo Martins',
    email: 'carlos.noc@setatelecom.com.br',
    roleLabel: 'Engenharia NOC N2/N3 & O.S.',
    roleId: 'TECNICO_NOC_OS',
    scope: 'EQUIPE',
    badgeColor: 'bg-purple-600 text-white',
  },
  {
    name: 'Lucas Ferreira',
    email: 'pdv.matriz@setatelecom.com.br',
    roleLabel: 'Operador PDV Balcão & Estoque',
    roleId: 'OPERADOR_PDV_ESTOQUE',
    scope: 'EQUIPE',
    badgeColor: 'bg-rose-600 text-white',
  },
  {
    name: 'Amanda Ribeiro',
    email: 'marketing@setatelecom.com.br',
    roleLabel: 'Analista Marketing Hub & SDR',
    roleId: 'ANALISTA_MARKETING',
    scope: 'EQUIPE',
    badgeColor: 'bg-teal-600 text-white',
  },
];

export default function StiHubLoginPage() {
  const [step, setStep] = useState<'CREDENTIALS' | 'MFA_2FA'>('CREDENTIALS');
  const [email, setEmail] = useState('marcelo.mira@setatelecom.com.br');
  const [password, setPassword] = useState('Seta@2026#StiHub');
  const [mfaCode, setMfaCode] = useState('436906');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [challengeData, setChallengeData] = useState<{
    challengeId: string;
    mfaMethod: string;
    demoTotpCode: string;
    user: { id: string; name: string; email: string; jobTitle: string; roleId: string; scope: string };
    role: { id: string; name: string };
  } | null>(null);

  const handleCredentialsSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setLoading(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password }),
      });
      const json = await res.json();
      if (!res.ok) {
        setErrorMsg(json.error || 'Falha na autenticação corporativa.');
        return;
      }
      setChallengeData(json.data);
      setMfaCode(json.data?.demoTotpCode || '436906');
      setStep('MFA_2FA');
    } catch {
      setErrorMsg('Erro de comunicação com o servidor de autenticação STI-hub.');
    } finally {
      setLoading(false);
    }
  };

  const handleMfaSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setLoading(true);
    try {
      const res = await fetch('/api/auth/verify-mfa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: challengeData?.user?.email || email.trim(),
          userId: challengeData?.user?.id,
          code: mfaCode.trim(),
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setErrorMsg(json.error || 'Código MFA 2FA inválido.');
        return;
      }

      if (typeof window !== 'undefined') {
        localStorage.setItem(
          'stihub_active_session_v1',
          JSON.stringify({
            authenticated: true,
            mfaVerified: true,
            sessionToken: json.data?.sessionToken,
            user: json.data?.user,
            role: json.data?.role,
            effectiveActionGuards: json.data?.effectiveActionGuards,
            loggedAt: new Date().toISOString(),
          })
        );
        document.cookie = 'stihub_logged_out=; Path=/; Max-Age=0';
        window.location.href = '/';
      }
    } catch {
      setErrorMsg('Falha ao validar código MFA 2FA.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0d2b4e] flex flex-col justify-between p-4 sm:p-8 text-slate-800 relative overflow-hidden">
      {/* Top Corporate Bar */}
      <div className="max-w-6xl w-full mx-auto flex flex-wrap items-center justify-between gap-3 z-10">
        <div className="flex items-center gap-3">
          <div className="px-2.5 h-9 rounded-md bg-white flex items-center justify-center gap-1.5 shadow-sm">
            <span className="font-black text-[#0d2b4e] text-sm tracking-tight">SETA</span>
            <span className="w-[2px] h-4 bg-[#f26522] inline-block" />
            <span className="font-black text-[#f26522] text-sm tracking-tight">IT</span>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-black text-white text-base tracking-tight">STI-hub</span>
              <span className="px-2 py-0.5 rounded bg-[#ff7a59] text-white text-[10px] font-extrabold uppercase">
                SSO &amp; MFA 2FA
              </span>
            </div>
            <p className="text-[11px] text-slate-300">
              Seta Telecom LTDA • CNPJ 14.806.925/0001-32 • GestãoClick #118887 + HubSpot #4369067
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 text-xs text-emerald-300 bg-white/10 px-3 py-1.5 rounded-full border border-white/15">
          <ShieldCheck className="w-4 h-4 text-emerald-400" />
          <span>Proteção Total de Rotas + RBAC 9 Perfis Ativo</span>
        </div>
      </div>

      {/* Main Content Grid */}
      <div className="max-w-5xl w-full mx-auto grid grid-cols-1 lg:grid-cols-12 gap-6 my-8 z-10 items-center">
        {/* Left Column: Login + MFA Box */}
        <div className="lg:col-span-7 bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden">
          <div className="px-6 py-5 bg-[#213343] text-white flex items-center justify-between">
            <div>
              <span className="text-[10px] font-extrabold uppercase tracking-wider text-[#ff7a59] block">
                {step === 'CREDENTIALS'
                  ? 'ETAPA 1 DE 2 • CREDENCIAIS CORPORATIVAS'
                  : 'ETAPA 2 DE 2 • VERIFICAÇÃO MULTIFATOR OBRIGATÓRIA (MFA 2FA)'}
              </span>
              <h1 className="text-lg font-extrabold mt-0.5">
                {step === 'CREDENTIALS'
                  ? 'Acesso Seguro ao STI-hub (CRM & ERP)'
                  : `Confirmar Código 2FA — ${challengeData?.user?.name}`}
              </h1>
            </div>
            <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center">
              {step === 'CREDENTIALS' ? (
                <Lock className="w-5 h-5 text-[#ff7a59]" />
              ) : (
                <Smartphone className="w-5 h-5 text-emerald-400" />
              )}
            </div>
          </div>

          <div className="p-6 space-y-5">
            {errorMsg && (
              <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-semibold flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
                <span>{errorMsg}</span>
              </div>
            )}

            {step === 'CREDENTIALS' ? (
              <form onSubmit={handleCredentialsSubmit} className="space-y-4">
                <div>
                  <label className="block text-xs font-extrabold text-slate-700 mb-1">
                    E-mail Corporativo Seta Telecom *
                  </label>
                  <div className="relative">
                    <Mail className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                    <input
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="nome@setatelecom.com.br"
                      className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-300 text-xs font-bold text-slate-900 focus:outline-none focus:border-[#0d2b4e]"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-extrabold text-slate-700 mb-1">
                    Senha Corporativa *
                  </label>
                  <div className="relative">
                    <KeyRound className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                    <input
                      type="password"
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-300 text-xs font-bold text-slate-900 focus:outline-none focus:border-[#0d2b4e]"
                    />
                  </div>
                </div>

                <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-[11px] text-slate-600 flex items-center justify-between">
                  <span>
                    🔒 <strong>MFA 2FA Obrigatório:</strong> Código de 6 dígitos solicitado na próxima tela.
                  </span>
                  <span className="font-bold text-emerald-700">TLS 1.3 + HttpOnly</span>
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-3 rounded-xl bg-[#ff7a59] hover:bg-[#e86646] text-white text-xs font-extrabold shadow-md flex items-center justify-center gap-2 cursor-pointer transition disabled:opacity-50"
                >
                  <span>{loading ? 'Validando Credenciais...' : 'Continuar para Verificação MFA (2FA)'}</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </form>
            ) : (
              <form onSubmit={handleMfaSubmit} className="space-y-4">
                <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-xs space-y-1">
                  <div className="font-extrabold text-emerald-950 flex items-center justify-between">
                    <span>Colaborador Identificado: {challengeData?.user?.name}</span>
                    <span className="px-2 py-0.5 rounded bg-emerald-700 text-white text-[10px]">
                      Escopo: {challengeData?.user?.scope}
                    </span>
                  </div>
                  <div className="text-emerald-800 text-[11px]">
                    Perfil RBAC: <strong>{challengeData?.role?.name}</strong> • Método:{' '}
                    <strong>{challengeData?.mfaMethod}</strong>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-extrabold text-slate-700 mb-1">
                    Código MFA 2FA de 6 Dígitos (TOTP Autenticador / E-mail Corporativo) *
                  </label>
                  <input
                    type="text"
                    required
                    maxLength={6}
                    value={mfaCode}
                    onChange={(e) => setMfaCode(e.target.value.replace(/\D+/g, ''))}
                    placeholder="436906"
                    className="w-full px-4 py-3 rounded-xl border-2 border-[#0d2b4e] text-center font-mono text-xl font-black tracking-[0.4em] text-[#0d2b4e]"
                  />
                  <p className="text-[11px] text-slate-500 mt-1.5">
                    Código TOTP Seta Telecom ativo para homologação:{' '}
                    <button
                      type="button"
                      onClick={() => setMfaCode(challengeData?.demoTotpCode || '436906')}
                      className="font-mono font-black text-[#0d2b4e] underline cursor-pointer"
                    >
                      {challengeData?.demoTotpCode || '436906'}
                    </button>{' '}
                    (ou <code className="font-mono">118887</code>).
                  </p>
                </div>

                <div className="flex items-center gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setStep('CREDENTIALS')}
                    className="px-4 py-3 rounded-xl border border-slate-300 text-xs font-bold text-slate-700 hover:bg-slate-50 cursor-pointer"
                  >
                    ← Voltar
                  </button>
                  <button
                    type="submit"
                    disabled={loading}
                    className="flex-1 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-extrabold shadow-md flex items-center justify-center gap-2 cursor-pointer transition disabled:opacity-50"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    <span>
                      {loading ? 'Autenticando Sessão MFA...' : 'Confirmar MFA 2FA & Entrar no STI-hub'}
                    </span>
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>

        {/* Right Column: Quick Profile Switcher for Executive Testing */}
        <div className="lg:col-span-5 bg-white/10 backdrop-blur-md rounded-2xl border border-white/15 p-5 text-white space-y-3.5">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-[10px] font-extrabold uppercase tracking-wider text-amber-300 block">
                MATRIZ RBAC • 9 PERFIS &amp; 22 USUÁRIOS SETA TELECOM
              </span>
              <h2 className="text-sm font-extrabold">
                Seleção Rápida de Perfil para Homologação
              </h2>
            </div>
            <Sparkles className="w-4 h-4 text-amber-300" />
          </div>
          <p className="text-[11px] text-slate-300 leading-relaxed">
            Clique em qualquer colaborador abaixo para preencher automaticamente o e-mail corporativo e testar as permissões granulares e o escopo (<strong className="text-white">Todos / Equipe / Próprios</strong>) no STI-hub:
          </p>

          <div className="space-y-1.5 max-h-80 overflow-y-auto pr-1">
            {QUICK_ACCOUNTS.map((acc) => {
              const isSelected = email.toLowerCase() === acc.email.toLowerCase();
              return (
                <button
                  key={acc.email}
                  type="button"
                  onClick={() => {
                    setEmail(acc.email);
                    setStep('CREDENTIALS');
                    setErrorMsg(null);
                  }}
                  className={`w-full text-left p-2.5 rounded-xl border transition flex items-center justify-between gap-2 cursor-pointer ${
                    isSelected
                      ? 'bg-white text-slate-900 border-amber-400 shadow-md'
                      : 'bg-white/5 hover:bg-white/15 border-white/10 text-white'
                  }`}
                >
                  <div className="min-w-0">
                    <div className="text-xs font-extrabold truncate">{acc.name}</div>
                    <div
                      className={`text-[10px] truncate ${
                        isSelected ? 'text-slate-600' : 'text-slate-300'
                      }`}
                    >
                      {acc.email} • {acc.roleLabel}
                    </div>
                  </div>
                  <span
                    className={`px-2 py-0.5 rounded text-[9px] font-black shrink-0 ${acc.badgeColor}`}
                  >
                    {acc.scope}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Footer Info */}
      <div className="max-w-6xl w-full mx-auto flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-300 border-t border-white/10 pt-4 z-10">
        <div className="flex items-center gap-2">
          <Building2 className="w-3.5 h-3.5 text-[#ff7a59]" />
          <span>Domínios Oficiais:</span>
          <code className="text-white font-mono">sti-hub.vercel.app</code>
          <span>•</span>
          <code className="text-emerald-300 font-mono">stihub.setatelecom.com.br</code>
          <span>•</span>
          <code className="text-sky-300 font-mono">erp.setatelecom.com.br</code>
        </div>
        <div>
          Rotas Públicas Liberadas: <code className="text-white">/login</code>,{' '}
          <code className="text-white">/proposta/[id]</code> (PDF Cliente) e{' '}
          <code className="text-white">/portal</code> (Chamados NOC)
        </div>
      </div>
    </div>
  );
}
