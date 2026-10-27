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
  QrCode,
  Send,
  Copy,
  RefreshCw,
} from 'lucide-react';

interface QuickDemoAccount {
  name: string;
  email: string;
  roleLabel: string;
  roleId: string;
  scope: string;
  mfaMethod: 'TOTP_AUTHENTICATOR' | 'EMAIL_OTP';
  enabledModules: Array<'CRM' | 'ERP' | 'CHAMADOS'>;
  badgeColor: string;
}

const QUICK_ACCOUNTS: QuickDemoAccount[] = [
  {
    name: 'Marcelo Lopes Mira',
    email: 'marcelo.mira@setatelecom.com.br',
    roleLabel: 'Super Admin STI-hub / Diretoria',
    roleId: 'SUPER_ADMIN',
    scope: 'TODOS',
    mfaMethod: 'TOTP_AUTHENTICATOR',
    enabledModules: ['CRM', 'ERP', 'CHAMADOS'],
    badgeColor: 'bg-[#ff7a59] text-white',
  },
  {
    name: 'Evelyn Olivia de Rosa Ternero',
    email: 'evelyn@setatelecom.com.br',
    roleLabel: 'Gerente Comercial & RevOps',
    roleId: 'GERENTE_COMERCIAL',
    scope: 'TODOS',
    mfaMethod: 'TOTP_AUTHENTICATOR',
    enabledModules: ['CRM', 'ERP', 'CHAMADOS'],
    badgeColor: 'bg-indigo-600 text-white',
  },
  {
    name: 'Maria Luiza',
    email: 'marialuiza@setatelecom.com.br',
    roleLabel: 'Executiva de Contas (Sales Hub & Orçamentos)',
    roleId: 'VENDEDOR_SALES',
    scope: 'PROPRIOS',
    mfaMethod: 'TOTP_AUTHENTICATOR',
    enabledModules: ['CRM', 'ERP'],
    badgeColor: 'bg-sky-600 text-white',
  },
  {
    name: 'Amanda Ribeiro',
    email: 'marketing@setatelecom.com.br',
    roleLabel: 'Analista Marketing Hub & SDR (Apenas CRM)',
    roleId: 'ANALISTA_MARKETING',
    scope: 'EQUIPE',
    mfaMethod: 'TOTP_AUTHENTICATOR',
    enabledModules: ['CRM'],
    badgeColor: 'bg-teal-600 text-white',
  },
  {
    name: 'Michelle da Rocha',
    email: 'michelle.rocha@setatelecom.com.br',
    roleLabel: 'Financeiro, Contratos & Cobrança (Apenas ERP)',
    roleId: 'FINANCEIRO_FATURAMENTO',
    scope: 'TODOS',
    mfaMethod: 'TOTP_AUTHENTICATOR',
    enabledModules: ['ERP'],
    badgeColor: 'bg-emerald-600 text-white',
  },
  {
    name: 'Beatriz Nogueira',
    email: 'fiscal@setatelecom.com.br',
    roleLabel: 'Fiscal & Tributário SV 31 STF (Apenas ERP • E-mail OTP)',
    roleId: 'FISCAL_CONTABIL',
    scope: 'TODOS',
    mfaMethod: 'EMAIL_OTP',
    enabledModules: ['ERP'],
    badgeColor: 'bg-amber-600 text-white',
  },
  {
    name: 'Henrique Dias',
    email: 'henrique.noc@setatelecom.com.br',
    roleLabel: 'Suporte N1 Service Desk (Apenas Chamados • E-mail OTP)',
    roleId: 'TECNICO_NOC_OS',
    scope: 'EQUIPE',
    mfaMethod: 'EMAIL_OTP',
    enabledModules: ['CHAMADOS'],
    badgeColor: 'bg-purple-600 text-white',
  },
  {
    name: 'Carlos Eduardo Martins',
    email: 'carlos.noc@setatelecom.com.br',
    roleLabel: 'Engenharia NOC N2/N3 & O.S. (Chamados + ERP)',
    roleId: 'TECNICO_NOC_OS',
    scope: 'EQUIPE',
    mfaMethod: 'TOTP_AUTHENTICATOR',
    enabledModules: ['CHAMADOS', 'ERP'],
    badgeColor: 'bg-rose-600 text-white',
  },
];

export default function StiHubLoginPage() {
  const [step, setStep] = useState<'CREDENTIALS' | 'MFA_2FA'>('CREDENTIALS');
  const [email, setEmail] = useState('marcelo.mira@setatelecom.com.br');
  const [password, setPassword] = useState('Seta@2026#StiHub');
  const [mfaCode, setMfaCode] = useState('');
  const [activeMfaChannel, setActiveMfaChannel] = useState<'TOTP_AUTHENTICATOR' | 'EMAIL_OTP'>(
    'TOTP_AUTHENTICATOR'
  );
  const [showTotpQrSetup, setShowTotpQrSetup] = useState(true);
  const [loading, setLoading] = useState(false);
  const [sendingEmailOtp, setSendingEmailOtp] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [infoMsg, setInfoMsg] = useState<string | null>(null);

  const [challengeData, setChallengeData] = useState<{
    challengeId: string;
    mfaMethod: 'TOTP_AUTHENTICATOR' | 'EMAIL_OTP';
    demoTotpCode: string;
    totpPairing?: {
      totpSecret: string;
      otpauthUri: string;
      qrCodeSvgDataUrl: string;
      secondsRemaining: number;
    };
    emailOtpStatus?: {
      dispatchedTo: string;
      expiresAt: string;
      ttlSeconds: number;
      deliveryMode?: string;
      protocol?: string;
      devOtpPreview?: string;
    };
    user: {
      id: string;
      name: string;
      email: string;
      jobTitle: string;
      roleId: string;
      scope: string;
      enabledModules?: Array<'CRM' | 'ERP' | 'CHAMADOS'>;
    };
    role: { id: string; name: string };
  } | null>(null);

  const handleCredentialsSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setInfoMsg(null);
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
      const d = json.data;
      setChallengeData(d);
      const preferredMethod =
        d?.mfaMethod === 'EMAIL_OTP' ? 'EMAIL_OTP' : 'TOTP_AUTHENTICATOR';
      setActiveMfaChannel(preferredMethod);
      setMfaCode(d?.demoTotpCode || '');
      if (preferredMethod === 'EMAIL_OTP' && d?.emailOtpStatus) {
        setInfoMsg(
          `Código OTP de 6 dígitos enviado para ${d.emailOtpStatus.dispatchedTo} (${d.emailOtpStatus.protocol || 'STI-OTP'}). Expira em 5 minutos.`
        );
      }
      setStep('MFA_2FA');
    } catch {
      setErrorMsg('Erro de comunicação com o servidor de autenticação STI-hub.');
    } finally {
      setLoading(false);
    }
  };

  const handleSendOrResendEmailOtp = async () => {
    setErrorMsg(null);
    setInfoMsg(null);
    setSendingEmailOtp(true);
    try {
      const targetEmail = challengeData?.user?.email || email.trim();
      const res = await fetch('/api/auth/send-email-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: targetEmail,
          userId: challengeData?.user?.id,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setErrorMsg(json.error || 'Falha ao enviar código OTP por e-mail.');
        return;
      }
      const otpData = json.data;
      setActiveMfaChannel('EMAIL_OTP');
      if (otpData?.devOtpPreview) {
        setMfaCode(otpData.devOtpPreview);
      }
      setChallengeData((prev) =>
        prev
          ? {
              ...prev,
              emailOtpStatus: {
                dispatchedTo: otpData.email,
                expiresAt: otpData.expiresAt,
                ttlSeconds: otpData.ttlSeconds,
                deliveryMode: otpData.deliveryMode,
                protocol: otpData.protocol,
                devOtpPreview: otpData.devOtpPreview,
              },
            }
          : prev
      );
      setInfoMsg(
        `Novo código OTP enviado para ${otpData.email} (Protocolo ${otpData.protocol} • ${
          otpData.deliveryMode === 'RESEND_HTTP_API'
            ? 'Entregue via Relay Corporativo'
            : 'Modo Homologação Ativo'
        }).`
      );
    } catch {
      setErrorMsg('Erro ao solicitar envio de código OTP por e-mail.');
    } finally {
      setSendingEmailOtp(false);
    }
  };

  const handleRefreshTotpPairing = async (regenerate = false) => {
    setErrorMsg(null);
    try {
      const targetEmail = challengeData?.user?.email || email.trim();
      const res = await fetch('/api/auth/setup-totp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: targetEmail,
          userId: challengeData?.user?.id,
          regenerate,
        }),
      });
      const json = await res.json();
      if (res.ok && json?.data) {
        const s = json.data;
        setChallengeData((prev) =>
          prev
            ? {
                ...prev,
                demoTotpCode: s.currentTotpCode || prev.demoTotpCode,
                totpPairing: {
                  totpSecret: s.totpSecret,
                  otpauthUri: s.otpauthUri,
                  qrCodeSvgDataUrl: s.qrCodeSvgDataUrl,
                  secondsRemaining: s.secondsRemaining,
                },
              }
            : prev
        );
        if (s.currentTotpCode && activeMfaChannel === 'TOTP_AUTHENTICATOR') {
          setMfaCode(s.currentTotpCode);
        }
        setInfoMsg(
          regenerate
            ? 'Nova chave secreta Base32 e QR Code Google Authenticator gerados com sucesso!'
            : 'Código TOTP RFC 6238 sincronizado com a janela atual de 30s.'
        );
      }
    } catch {
      // ignore
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
          mfaMethod: activeMfaChannel,
          totpSecret: challengeData?.totpPairing?.totpSecret,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setErrorMsg(json.error || 'Código MFA 2FA inválido.');
        return;
      }

      if (typeof window !== 'undefined') {
        const token = json.data?.sessionToken || '';
        localStorage.setItem(
          'stihub_active_session_v1',
          JSON.stringify({
            authenticated: true,
            mfaVerified: true,
            verifiedVia: json.data?.verifiedVia,
            sessionToken: token,
            user: json.data?.user,
            role: json.data?.role,
            effectiveActionGuards: json.data?.effectiveActionGuards,
            enabledModules: json.data?.enabledModules,
            moduleAccess: json.data?.moduleAccess,
            crmPermissions: json.data?.crmPermissions,
            erpPermissions: json.data?.erpPermissions,
            loggedAt: new Date().toISOString(),
          })
        );
        document.cookie = `stihub_session=${encodeURIComponent(token)}; Path=/; Max-Age=86400; SameSite=Lax`;
        document.cookie = 'stihub_logged_out=; Path=/; Max-Age=0';
        const params = new URLSearchParams(window.location.search);
        const nextUrl = params.get('next') || '/';
        window.location.href = nextUrl.startsWith('/') ? nextUrl : '/';
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
                IAM &amp; 2FA (TOTP RFC 6238 + E-mail OTP)
              </span>
            </div>
            <p className="text-[11px] text-slate-300">
              Seta Telecom LTDA • CNPJ 14.806.925/0001-32 • GestãoClick #118887 + HubSpot #4369067
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 text-xs text-emerald-300 bg-white/10 px-3 py-1.5 rounded-full border border-white/15">
          <ShieldCheck className="w-4 h-4 text-emerald-400" />
          <span>Sessão Assinada HMAC-SHA256 + Escopo Modular (CRM / ERP / Chamados)</span>
        </div>
      </div>

      {/* Main Content Grid */}
      <div className="max-w-5xl w-full mx-auto grid grid-cols-1 lg:grid-cols-12 gap-6 my-8 z-10 items-start">
        {/* Left Column: Login + MFA Box */}
        <div className="lg:col-span-7 bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden">
          <div className="px-6 py-5 bg-[#213343] text-white flex items-center justify-between">
            <div>
              <span className="text-[10px] font-extrabold uppercase tracking-wider text-[#ff7a59] block">
                {step === 'CREDENTIALS'
                  ? 'ETAPA 1 DE 2 • CREDENCIAIS CORPORATIVAS'
                  : 'ETAPA 2 DE 2 • AUTENTICAÇÃO DE DOIS FATORES (GOOGLE AUTHENTICATOR / E-MAIL OTP)'}
              </span>
              <h1 className="text-lg font-extrabold mt-0.5">
                {step === 'CREDENTIALS'
                  ? 'Acesso Seguro ao STI-hub (CRM, ERP & Chamados)'
                  : `Verificação 2FA — ${challengeData?.user?.name}`}
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

            {infoMsg && (
              <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs font-semibold flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>{infoMsg}</span>
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
                    <strong>2FA Obrigatório:</strong> Google Authenticator (TOTP RFC 6238) ou Código OTP por E-mail.
                  </span>
                  <span className="font-bold text-emerald-700">TLS 1.3 + HttpOnly</span>
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-3 rounded-xl bg-[#ff7a59] hover:bg-[#e86646] text-white text-xs font-extrabold shadow-md flex items-center justify-center gap-2 cursor-pointer transition disabled:opacity-50"
                >
                  <span>{loading ? 'Validando Credenciais...' : 'Continuar para Verificação 2FA'}</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </form>
            ) : (
              <form onSubmit={handleMfaSubmit} className="space-y-4">
                <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 text-xs space-y-1.5">
                  <div className="font-extrabold text-slate-900 flex flex-wrap items-center justify-between gap-2">
                    <span>Colaborador: {challengeData?.user?.name}</span>
                    <div className="flex items-center gap-1">
                      {(challengeData?.user?.enabledModules || ['CRM', 'ERP', 'CHAMADOS']).map(
                        (m) => (
                          <span
                            key={m}
                            className="px-2 py-0.5 rounded bg-[#0d2b4e] text-white text-[10px] font-black"
                          >
                            {m}
                          </span>
                        )
                      )}
                      <span className="px-2 py-0.5 rounded bg-emerald-700 text-white text-[10px]">
                        Escopo: {challengeData?.user?.scope}
                      </span>
                    </div>
                  </div>
                  <div className="text-slate-600 text-[11px]">
                    Perfil IAM: <strong>{challengeData?.role?.name}</strong> • E-mail:{' '}
                    <code className="font-mono">{challengeData?.user?.email}</code>
                  </div>
                </div>

                {/* Method Selector Tabs: Google Authenticator (TOTP) vs Email OTP */}
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setActiveMfaChannel('TOTP_AUTHENTICATOR');
                      setErrorMsg(null);
                    }}
                    className={`p-2.5 rounded-xl border text-left transition cursor-pointer flex items-center gap-2 ${
                      activeMfaChannel === 'TOTP_AUTHENTICATOR'
                        ? 'bg-[#0d2b4e] text-white border-[#0d2b4e] shadow-sm'
                        : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    <Smartphone className="w-4 h-4 shrink-0 text-[#ff7a59]" />
                    <div>
                      <div className="text-xs font-extrabold">Google Authenticator</div>
                      <div className="text-[10px] opacity-80">TOTP RFC 6238 (Janela 30s)</div>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setActiveMfaChannel('EMAIL_OTP');
                      setErrorMsg(null);
                      if (!challengeData?.emailOtpStatus) {
                        handleSendOrResendEmailOtp();
                      }
                    }}
                    className={`p-2.5 rounded-xl border text-left transition cursor-pointer flex items-center gap-2 ${
                      activeMfaChannel === 'EMAIL_OTP'
                        ? 'bg-[#0d2b4e] text-white border-[#0d2b4e] shadow-sm'
                        : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    <Mail className="w-4 h-4 shrink-0 text-emerald-400" />
                    <div>
                      <div className="text-xs font-extrabold">Código OTP por E-mail</div>
                      <div className="text-[10px] opacity-80">Disparo p/ E-mail Cadastrado</div>
                    </div>
                  </button>
                </div>

                {/* Method 1 Details: Google Authenticator Pairing & QR Code */}
                {activeMfaChannel === 'TOTP_AUTHENTICATOR' && (
                  <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-2.5 text-xs">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-extrabold text-slate-800 flex items-center gap-1.5">
                        <QrCode className="w-4 h-4 text-[#0d2b4e]" />
                        Autenticador TOTP RFC 6238 (Google / Microsoft Authenticator)
                      </span>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => handleRefreshTotpPairing(false)}
                          className="px-2 py-1 rounded bg-white border border-slate-300 text-[10px] font-bold text-slate-700 hover:bg-slate-100 cursor-pointer inline-flex items-center gap-1"
                        >
                          <RefreshCw className="w-3 h-3" /> Sincronizar 30s
                        </button>
                        <button
                          type="button"
                          onClick={() => setShowTotpQrSetup((v) => !v)}
                          className="px-2.5 py-1 rounded bg-[#0d2b4e] text-white text-[10px] font-extrabold cursor-pointer"
                        >
                          {showTotpQrSetup ? 'Ocultar QR Code' : 'Ver QR Code / Chave Base32'}
                        </button>
                      </div>
                    </div>

                    {showTotpQrSetup && challengeData?.totpPairing && (
                      <div className="p-3 rounded-lg bg-white border border-slate-200 grid grid-cols-1 sm:grid-cols-12 gap-3 items-center">
                        <div className="sm:col-span-4 flex flex-col items-center">
                          <img
                            src={challengeData.totpPairing.qrCodeSvgDataUrl}
                            alt="QR Code TOTP Google Authenticator"
                            className="w-32 h-32 rounded-lg border border-slate-200 p-1 bg-white"
                          />
                          <span className="text-[10px] text-slate-500 mt-1 font-semibold">
                            Escaneie no Google Authenticator
                          </span>
                        </div>
                        <div className="sm:col-span-8 space-y-2 text-[11px]">
                          <div>
                            <div className="font-bold text-slate-700">
                              Chave Secreta Base32 (RFC 4648):
                            </div>
                            <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
                              <code className="px-2.5 py-1.5 rounded bg-slate-100 border border-slate-200 font-mono text-[11px] font-black text-[#0d2b4e] select-all tracking-wider">
                                {challengeData.totpPairing.totpSecret.replace(/(.{4})/g, '$1 ').trim()}
                              </code>
                              <button
                                type="button"
                                onClick={() => {
                                  navigator.clipboard?.writeText(
                                    challengeData.totpPairing?.totpSecret || ''
                                  );
                                  setInfoMsg('Chave Secreta Base32 copiada para a área de transferência!');
                                }}
                                className="px-2.5 py-1.5 rounded bg-[#0d2b4e] hover:bg-[#1e3a6e] text-white text-[10px] font-extrabold inline-flex items-center gap-1 cursor-pointer"
                                title="Copiar Chave Base32"
                              >
                                <Copy className="w-3 h-3" /> Copiar Chave
                              </button>
                            </div>
                          </div>
                          <div>
                            <div className="font-bold text-slate-700">URI Padrão otpauth://:</div>
                            <input
                              type="text"
                              readOnly
                              value={challengeData.totpPairing.otpauthUri}
                              className="w-full px-2 py-1 rounded bg-slate-50 border border-slate-200 font-mono text-[10px] text-slate-600 mt-0.5"
                            />
                          </div>
                          <div className="flex items-center justify-between pt-1">
                            <span className="text-[10px] text-emerald-700 font-bold">
                              Algoritmo: HMAC-SHA1 • 6 dígitos • Janela: 30s
                            </span>
                            <button
                              type="button"
                              onClick={() => handleRefreshTotpPairing(true)}
                              className="text-[10px] font-bold text-rose-700 hover:underline cursor-pointer"
                            >
                              Rotacionar Chave TOTP
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Method 2 Details: Email OTP Dispatch */}
                {activeMfaChannel === 'EMAIL_OTP' && (
                  <div className="p-3.5 rounded-xl bg-emerald-50/70 border border-emerald-200 space-y-2 text-xs">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <div className="font-extrabold text-emerald-950">
                          Código OTP enviado para: {challengeData?.user?.email}
                        </div>
                        <div className="text-[11px] text-emerald-800">
                          Validade: 5 minutos • Máximo de 5 tentativas • Protocolo:{' '}
                          <code className="font-mono font-bold">
                            {challengeData?.emailOtpStatus?.protocol || 'STI-OTP'}
                          </code>
                        </div>
                      </div>
                      <button
                        type="button"
                        disabled={sendingEmailOtp}
                        onClick={handleSendOrResendEmailOtp}
                        className="px-3 py-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-[11px] font-extrabold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                      >
                        <Send className="w-3.5 h-3.5" />
                        <span>{sendingEmailOtp ? 'Enviando...' : 'Reenviar OTP por E-mail'}</span>
                      </button>
                    </div>
                  </div>
                )}

                <div>
                  <label className="block text-xs font-extrabold text-slate-700 mb-1">
                    {activeMfaChannel === 'TOTP_AUTHENTICATOR'
                      ? 'Código de 6 Dígitos do Google Authenticator (TOTP) *'
                      : 'Código OTP de 6 Dígitos recebido por E-mail *'}
                  </label>
                  <input
                    type="text"
                    required
                    maxLength={6}
                    value={mfaCode}
                    onChange={(e) => setMfaCode(e.target.value.replace(/\D+/g, ''))}
                    placeholder="000000"
                    className="w-full px-4 py-3 rounded-xl border-2 border-[#0d2b4e] text-center font-mono text-xl font-black tracking-[0.4em] text-[#0d2b4e]"
                  />
                  <p className="text-[11px] text-slate-500 mt-1.5 flex flex-wrap items-center justify-between gap-1">
                    <span>
                      Código 2FA sincronizado para homologação:{' '}
                      <button
                        type="button"
                        onClick={() =>
                          setMfaCode(
                            activeMfaChannel === 'EMAIL_OTP' &&
                              challengeData?.emailOtpStatus?.devOtpPreview
                              ? challengeData.emailOtpStatus.devOtpPreview
                              : challengeData?.demoTotpCode || '436906'
                          )
                        }
                        className="font-mono font-black text-[#0d2b4e] underline cursor-pointer"
                      >
                        {activeMfaChannel === 'EMAIL_OTP' &&
                        challengeData?.emailOtpStatus?.devOtpPreview
                          ? challengeData.emailOtpStatus.devOtpPreview
                          : challengeData?.demoTotpCode || '436906'}
                      </button>
                    </span>
                    <span className="text-[10px] text-slate-400">
                      RFC 6238 / OTP Verificado no Servidor
                    </span>
                  </p>
                </div>

                <div className="flex items-center gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => {
                      setStep('CREDENTIALS');
                      setErrorMsg(null);
                      setInfoMsg(null);
                    }}
                    className="px-4 py-3 rounded-xl border border-slate-300 text-xs font-bold text-slate-700 hover:bg-slate-50 cursor-pointer"
                  >
                    Voltar
                  </button>
                  <button
                    type="submit"
                    disabled={loading}
                    className="flex-1 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-extrabold shadow-md flex items-center justify-center gap-2 cursor-pointer transition disabled:opacity-50"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    <span>
                      {loading ? 'Autenticando Sessão 2FA...' : 'Confirmar 2FA & Entrar no STI-hub'}
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
                IAM &amp; ESCOPO MODULAR • 9 PERFIS &amp; 22 USUÁRIOS SETA TELECOM
              </span>
              <h2 className="text-sm font-extrabold">
                Seleção Rápida de Perfil &amp; Escopo por Módulo
              </h2>
            </div>
            <Sparkles className="w-4 h-4 text-amber-300" />
          </div>
          <p className="text-[11px] text-slate-300 leading-relaxed">
            Clique em um colaborador para testar o login 2FA (<strong className="text-white">Google Authenticator TOTP</strong> ou <strong className="text-white">E-mail OTP</strong>) e o isolamento de acesso por módulo (<strong className="text-white">CRM</strong>, <strong className="text-white">ERP</strong>, <strong className="text-white">Chamados</strong>):
          </p>

          <div className="space-y-1.5 max-h-96 overflow-y-auto pr-1">
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
                    setInfoMsg(null);
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
                    <div className="flex flex-wrap items-center gap-1 mt-1">
                      {acc.enabledModules.map((mod) => (
                        <span
                          key={mod}
                          className={`px-1.5 py-0.2 rounded text-[9px] font-black ${
                            isSelected
                              ? 'bg-[#0d2b4e] text-white'
                              : 'bg-white/15 text-amber-200'
                          }`}
                        >
                          {mod}
                        </span>
                      ))}
                      <span
                        className={`px-1.5 py-0.2 rounded text-[9px] font-bold ${
                          isSelected
                            ? 'bg-slate-200 text-slate-700'
                            : 'bg-white/10 text-slate-300'
                        }`}
                      >
                        {acc.mfaMethod === 'EMAIL_OTP' ? 'E-mail OTP' : 'Google Auth TOTP'}
                      </span>
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
