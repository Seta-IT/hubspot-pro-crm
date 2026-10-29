'use client';

import React, { useState, useRef, useEffect } from 'react';
import {
  Lock,
  Mail,
  KeyRound,
  CheckCircle2,
  Smartphone,
  AlertTriangle,
  QrCode,
  Send,
  Copy,
  UserCheck,
} from 'lucide-react';
import {
  loadClientDeletedUsersOverride,
  loadClientIamUsersOverride,
  saveClientIamUserOverride,
} from '../lib/auth';

export default function StiHubLoginPage() {
  const [step, setStep] = useState<'CREDENTIALS' | 'INVITE_PASSWORD' | 'MFA_2FA'>('CREDENTIALS');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [inviteToken, setInviteToken] = useState<string | null>(null);
  const [inviteUser, setInviteUser] = useState<{
    id: string;
    name: string;
    email: string;
    jobTitle?: string;
    department?: string;
    roleId: string;
    enabledModules?: string[];
    mfaEnabled?: boolean;
  } | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const [mfaCode, setMfaCode] = useState('');
  const [activeMfaChannel, setActiveMfaChannel] = useState<'TOTP_AUTHENTICATOR' | 'EMAIL_OTP'>(
    'TOTP_AUTHENTICATOR'
  );
  const [loading, setLoading] = useState(false);
  const [sendingEmailOtp, setSendingEmailOtp] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [infoMsg, setInfoMsg] = useState<string | null>(null);
  const mfaInputRef = useRef<HTMLInputElement | null>(null);

  const [challengeData, setChallengeData] = useState<{
    challengeId: string;
    mfaMethod: 'TOTP_AUTHENTICATOR' | 'EMAIL_OTP';
    totpConfigured?: boolean;
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
      delivered?: boolean;
      deliveryMode?: string;
      protocol?: string;
      providerError?: string;
    };
    user: {
      id: string;
      name: string;
      email: string;
      jobTitle: string;
      roleId: string;
      scope: string;
      totpConfigured?: boolean;
      enabledModules?: Array<'CRM' | 'ERP' | 'CHAMADOS'>;
    };
    role: { id: string; name: string };
  } | null>(null);

  const completeAuthenticatedRedirect = (data: Record<string, unknown>, fallbackEmail: string) => {
    if (typeof window === 'undefined') return;
    const token = String(data?.sessionToken || '');
    const userObj = (data?.user || {}) as Record<string, unknown>;
    const verifiedEmail = String(userObj?.email || fallbackEmail || '')
      .trim()
      .toLowerCase();

    if (userObj?.id) {
      localStorage.setItem('stihub_active_rbac_user_id_v1', String(userObj.id));
    }
    localStorage.setItem(
      'stihub_active_session_v1',
      JSON.stringify({
        authenticated: true,
        mfaVerified: true,
        verifiedVia: data?.verifiedVia || 'DIRECT_LOGIN',
        sessionToken: token,
        user: data?.user,
        role: data?.role,
        effectiveActionGuards: data?.effectiveActionGuards,
        enabledModules: data?.enabledModules,
        moduleAccess: data?.moduleAccess,
        crmPermissions: data?.crmPermissions,
        erpPermissions: data?.erpPermissions,
        loggedAt: new Date().toISOString(),
      })
    );
    document.cookie = 'stihub_logged_out=; Path=/; Max-Age=0; SameSite=Lax';
    document.cookie = `stihub_session=${encodeURIComponent(token)}; Path=/; Max-Age=86400; SameSite=Lax`;
    if (verifiedEmail && userObj?.totpConfigured !== false) {
      document.cookie = `stihub_totp_enrolled_r1=${encodeURIComponent(verifiedEmail)}; Path=/; Max-Age=31536000; SameSite=Lax`;
    }
    const params = new URLSearchParams(window.location.search);
    const rawNext = params.get('next') || '/';
    const nextUrl =
      rawNext.startsWith('/') &&
      !rawNext.startsWith('/login') &&
      !rawNext.startsWith('/convite')
        ? rawNext
        : '/';
    window.location.assign(nextUrl);
  };

  // Detect ?invite=... or ?token=... on mount
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const rawInvite = params.get('invite') || params.get('token');
    if (!rawInvite) return;

    setInviteToken(rawInvite);
    setLoading(true);
    fetch(`/api/auth/invite?token=${encodeURIComponent(rawInvite)}`, {
      credentials: 'same-origin',
    })
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok || !j?.data?.user) {
          setErrorMsg(j?.error || 'Link de convite inválido ou expirado.');
          return;
        }
        const u = j.data.user;
        setInviteUser(u);
        setEmail(u.email || '');
        setPassword('');
        setStep('INVITE_PASSWORD');
      })
      .catch(() => {
        setErrorMsg('Não foi possível validar o link de convite.');
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    if (step === 'MFA_2FA') {
      setTimeout(() => {
        mfaInputRef.current?.focus();
      }, 50);
    }
  }, [step, activeMfaChannel]);

  const handleAcceptInviteSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setInfoMsg(null);
    if (!inviteToken) return;
    if (newPassword.trim().length < 6) {
      setErrorMsg('A senha deve ter pelo menos 6 caracteres.');
      return;
    }
    if (newPassword.trim() !== confirmPassword.trim()) {
      setErrorMsg('A confirmação de senha não confere.');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/auth/accept-invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          token: inviteToken,
          password: newPassword.trim(),
          iamUsersOverride: loadClientIamUsersOverride(),
          iamDeletedUsersOverride: loadClientDeletedUsersOverride(),
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setErrorMsg(json.error || 'Não foi possível salvar a senha do convite.');
        return;
      }
      const d = json.data;
      if (d?.user) {
        saveClientIamUserOverride({
          ...d.user,
          password: newPassword.trim(),
        });
      }
      setPassword(newPassword.trim());

      // If 2FA is disabled for this user, enter the system immediately
      if (d?.mfaRequired === false && d?.sessionToken) {
        completeAuthenticatedRedirect(d, inviteUser?.email || email);
        return;
      }

      // First login after setting password: open Authenticator QR Code pairing automatically!
      setChallengeData(d);
      setActiveMfaChannel('TOTP_AUTHENTICATOR');
      setMfaCode('');
      setInfoMsg(
        'Senha cadastrada com sucesso! Escaneie o QR Code abaixo no seu aplicativo autenticador e digite os 6 dígitos para concluir seu primeiro acesso.'
      );
      setStep('MFA_2FA');
    } catch {
      setErrorMsg('Erro de comunicação ao ativar sua conta.');
    } finally {
      setLoading(false);
    }
  };

  const handleCredentialsSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setInfoMsg(null);
    setLoading(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          email: email.trim(),
          password,
          iamUsersOverride: loadClientIamUsersOverride(),
          iamDeletedUsersOverride: loadClientDeletedUsersOverride(),
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setErrorMsg(json.error || 'E-mail ou senha inválidos.');
        return;
      }
      const d = json.data;

      // If 2FA is disabled for this user (mfaRequired === false), log straight in!
      if (d?.mfaRequired === false && d?.sessionToken) {
        completeAuthenticatedRedirect(d, email.trim());
        return;
      }

      setChallengeData(d);
      setMfaCode('');

      // If it is the user's first login (totpConfigured === false) or email OTP failed because no SMTP is configured,
      // open the Authenticator tab automatically so the user is never blocked by an email error!
      const emailDelivered = Boolean(d?.emailOtpStatus?.delivered);
      const preferredMethod =
        d?.mfaMethod === 'EMAIL_OTP' && emailDelivered
          ? 'EMAIL_OTP'
          : 'TOTP_AUTHENTICATOR';
      setActiveMfaChannel(preferredMethod);

      if (preferredMethod === 'EMAIL_OTP' && emailDelivered) {
        setInfoMsg(`Enviamos um código de 6 dígitos para ${d.emailOtpStatus.dispatchedTo}.`);
      } else if (d?.totpConfigured === false && d?.totpPairing) {
        setInfoMsg(
          'Primeiro acesso: escaneie o QR Code abaixo no Google Authenticator e digite o código de 6 dígitos.'
        );
      }
      setStep('MFA_2FA');
    } catch {
      setErrorMsg('Erro de comunicação com o servidor.');
    } finally {
      setLoading(false);
    }
  };

  const handleLoadFirstTimeTotpQrIfNeeded = async () => {
    if (challengeData?.totpPairing || challengeData?.totpConfigured === true) return;
    try {
      const targetEmail = challengeData?.user?.email || email.trim();
      const res = await fetch('/api/auth/setup-totp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          email: targetEmail,
          userId: challengeData?.user?.id,
          challengeId: challengeData?.challengeId,
          iamUsersOverride: loadClientIamUsersOverride(),
          iamDeletedUsersOverride: loadClientDeletedUsersOverride(),
        }),
      });
      const json = await res.json();
      if (res.ok && json?.data) {
        setChallengeData((prev) =>
          prev
            ? {
                ...prev,
                totpConfigured: false,
                totpPairing: {
                  totpSecret: json.data.totpSecret,
                  otpauthUri: json.data.otpauthUri,
                  qrCodeSvgDataUrl: json.data.qrCodeSvgDataUrl,
                  secondsRemaining: json.data.secondsRemaining,
                },
              }
            : prev
        );
      }
    } catch {
      // ignore
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
        credentials: 'same-origin',
        body: JSON.stringify({
          email: targetEmail,
          userId: challengeData?.user?.id,
          challengeId: challengeData?.challengeId,
          iamUsersOverride: loadClientIamUsersOverride(),
          iamDeletedUsersOverride: loadClientDeletedUsersOverride(),
        }),
      });
      const json = await res.json();
      setActiveMfaChannel('EMAIL_OTP');
      setMfaCode('');
      if (!res.ok) {
        // Mensagem real do servidor (sem codigo OTP); so cai no texto de "nao configurado"
        // quando o provedor de fato nao esta disponivel.
        const serverMsg = typeof json?.error === 'string' ? json.error : '';
        if (res.status === 401) {
          setErrorMsg(serverMsg || 'Sua etapa de login expirou. Entre novamente com e-mail e senha.');
        } else if (res.status === 429) {
          setErrorMsg(serverMsg || 'Muitas solicitações de código. Aguarde alguns minutos e tente novamente.');
        } else {
          setErrorMsg(
            `${serverMsg || 'Não foi possível enviar o código por e-mail agora.'} Você pode usar o "Aplicativo Autenticador" ao lado.`
          );
        }
        return;
      }
      const otpData = json.data;
      setChallengeData((prev) =>
        prev
          ? {
              ...prev,
              challengeId: otpData.challengeId || prev.challengeId,
              emailOtpStatus: {
                dispatchedTo: otpData.email,
                expiresAt: otpData.expiresAt,
                ttlSeconds: otpData.ttlSeconds,
                delivered: otpData.delivered,
                deliveryMode: otpData.deliveryMode,
                protocol: otpData.protocol,
              },
            }
          : prev
      );
      setInfoMsg(`Código de 6 dígitos enviado para ${otpData.email}. Verifique sua caixa de entrada.`);
      mfaInputRef.current?.focus();
    } catch {
      setErrorMsg('Erro ao solicitar envio do código por e-mail.');
    } finally {
      setSendingEmailOtp(false);
    }
  };

  const handleMfaSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    const cleanCode = mfaCode.replace(/\D+/g, '');
    if (cleanCode.length !== 6) {
      setErrorMsg('Digite o código de 6 dígitos.');
      mfaInputRef.current?.focus();
      return;
    }
    setLoading(true);
    try {
      const res = await fetch('/api/auth/verify-mfa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          email: challengeData?.user?.email || email.trim(),
          userId: challengeData?.user?.id,
          code: cleanCode,
          mfaMethod: activeMfaChannel,
          totpSecret:
            challengeData?.totpConfigured === false
              ? challengeData?.totpPairing?.totpSecret
              : undefined,
          challengeId: challengeData?.challengeId,
          iamUsersOverride: loadClientIamUsersOverride(),
          iamDeletedUsersOverride: loadClientDeletedUsersOverride(),
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setErrorMsg(json.error || 'Código inválido ou expirado. Tente novamente.');
        setMfaCode('');
        mfaInputRef.current?.focus();
        return;
      }

      if (json.data?.user) {
        saveClientIamUserOverride({
          ...json.data.user,
          mfaEnabled: true,
          totpConfigured: true,
        });
      }
      completeAuthenticatedRedirect(json.data || {}, email.trim());
    } catch {
      setErrorMsg('Falha ao verificar o código.');
    } finally {
      setLoading(false);
    }
  };

  const isTotpAlreadyConfigured =
    challengeData?.totpConfigured !== false && !challengeData?.totpPairing;

  return (
    <div className="min-h-screen bg-[#0d2b4e] flex flex-col items-center justify-center p-4 sm:p-6 text-slate-800">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden">
        {/* Clean Brand Header */}
        <div className="px-6 py-6 bg-[#213343] text-white flex flex-col items-center text-center">
          <div className="px-3 h-10 rounded-md bg-white flex items-center justify-center gap-1.5 shadow-sm mb-3">
            <span className="font-semibold text-[#0d2b4e] text-base tracking-tight">SETA</span>
            <span className="w-[2px] h-4 bg-[#f26522] inline-block" />
            <span className="font-semibold text-[#f26522] text-base tracking-tight">IT</span>
          </div>
          <h1 className="text-lg font-semibold tracking-tight">
            {step === 'INVITE_PASSWORD'
              ? 'Ativar Conta e Cadastrar Senha'
              : step === 'CREDENTIALS'
                ? 'Acesso ao STI-hub'
                : 'Autenticação em Duas Etapas'}
          </h1>
          <p className="text-xs text-slate-300 mt-1">
            {step === 'INVITE_PASSWORD'
              ? 'Defina sua senha corporativa para acessar o STI-hub'
              : step === 'CREDENTIALS'
                ? 'Entre com seu e-mail e senha para acessar o sistema'
                : !isTotpAlreadyConfigured
                  ? 'Primeiro acesso: cadastre seu Aplicativo Autenticador'
                  : 'Escolha o método de verificação e digite o código de 6 dígitos'}
          </p>
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

          {step === 'INVITE_PASSWORD' && inviteUser ? (
            <form onSubmit={handleAcceptInviteSubmit} className="space-y-4">
              <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-1 text-xs">
                <div className="font-semibold text-slate-900 flex items-center gap-1.5">
                  <UserCheck className="w-4 h-4 text-emerald-600" />
                  <span>Bem-vindo(a), {inviteUser.name}</span>
                </div>
                <div className="text-slate-600 font-mono text-[11px]">{inviteUser.email}</div>
                {Array.isArray(inviteUser.enabledModules) && inviteUser.enabledModules.length > 0 && (
                  <div className="flex flex-wrap gap-1 pt-1">
                    {inviteUser.enabledModules.map((m) => (
                      <span
                        key={m}
                        className="px-2 py-0.5 rounded bg-[#0d2b4e] text-white text-[10px] font-semibold"
                      >
                        {m}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Criar Senha de Acesso *
                </label>
                <div className="relative">
                  <KeyRound className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="password"
                    required
                    minLength={6}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Mínimo de 6 caracteres"
                    className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-300 text-xs font-semibold text-slate-900 focus:outline-none focus:border-[#0d2b4e]"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Confirmar Senha *
                </label>
                <div className="relative">
                  <KeyRound className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="password"
                    required
                    minLength={6}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Repita a senha criada"
                    className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-300 text-xs font-semibold text-slate-900 focus:outline-none focus:border-[#0d2b4e]"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-3 rounded-xl bg-[#ff7a59] hover:bg-[#e86646] text-white text-sm font-semibold shadow-md flex items-center justify-center gap-2 cursor-pointer transition disabled:opacity-50"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>
                  {loading ? 'Ativando Conta...' : 'Cadastrar Senha e Continuar'}
                </span>
              </button>
            </form>
          ) : step === 'CREDENTIALS' ? (
            <form onSubmit={handleCredentialsSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  E-mail
                </label>
                <div className="relative">
                  <Mail className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="email"
                    autoComplete="username"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="nome@setatelecom.com.br"
                    className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-300 text-xs font-semibold text-slate-900 focus:outline-none focus:border-[#0d2b4e]"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Senha
                </label>
                <div className="relative">
                  <KeyRound className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="password"
                    autoComplete="current-password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Digite sua senha"
                    className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-300 text-xs font-semibold text-slate-900 focus:outline-none focus:border-[#0d2b4e]"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-3 rounded-xl bg-[#ff7a59] hover:bg-[#e86646] text-white text-sm font-semibold shadow-md flex items-center justify-center gap-2 cursor-pointer transition disabled:opacity-50"
              >
                <Lock className="w-4 h-4" />
                <span>{loading ? 'Entrando...' : 'Login'}</span>
              </button>
              <div className="text-center">
                <a
                  href="/esqueci-senha"
                  className="text-xs font-semibold text-[#0d2b4e] hover:underline"
                >
                  Esqueci minha senha
                </a>
              </div>
            </form>
          ) : (
            <form onSubmit={handleMfaSubmit} className="space-y-4">
              {/* Two Clean 2FA Options: App Authenticator vs Email Code */}
              <div className="grid grid-cols-2 gap-2.5">
                <button
                  type="button"
                  onClick={() => {
                    setActiveMfaChannel('TOTP_AUTHENTICATOR');
                    setMfaCode('');
                    setErrorMsg(null);
                    setInfoMsg(null);
                    handleLoadFirstTimeTotpQrIfNeeded();
                    mfaInputRef.current?.focus();
                  }}
                  className={`p-3 rounded-xl border text-left transition cursor-pointer flex items-center gap-2.5 ${
                    activeMfaChannel === 'TOTP_AUTHENTICATOR'
                      ? 'bg-[#0d2b4e] text-white border-[#0d2b4e] shadow-sm'
                      : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  <Smartphone className="w-4 h-4 shrink-0 text-[#ff7a59]" />
                  <div>
                    <div className="text-xs font-semibold">Aplicativo Autenticador</div>
                    <div className="text-[10px] opacity-80">Google Authenticator</div>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setActiveMfaChannel('EMAIL_OTP');
                    setMfaCode('');
                    setErrorMsg(null);
                    handleSendOrResendEmailOtp();
                  }}
                  className={`p-3 rounded-xl border text-left transition cursor-pointer flex items-center gap-2.5 ${
                    activeMfaChannel === 'EMAIL_OTP'
                      ? 'bg-[#0d2b4e] text-white border-[#0d2b4e] shadow-sm'
                      : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  <Mail className="w-4 h-4 shrink-0 text-emerald-400" />
                  <div>
                    <div className="text-xs font-semibold">Código por E-mail</div>
                    <div className="text-[10px] opacity-80">Receber no e-mail</div>
                  </div>
                </button>
              </div>

              {/* Option 1: Authenticator App — Automatically shows QR Code on 1st login (when totpConfigured === false) */}
              {activeMfaChannel === 'TOTP_AUTHENTICATOR' && (
                <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-2.5 text-xs">
                  {isTotpAlreadyConfigured ? (
                    <div className="text-slate-600 text-center py-0.5">
                      Abra o <strong>Google Authenticator</strong> no seu celular e digite o código atual de 6 dígitos (válido por 30s).
                    </div>
                  ) : (
                    challengeData?.totpPairing && (
                      <div className="p-3 rounded-lg bg-white border border-slate-200 flex flex-col items-center text-center space-y-2.5">
                        <div className="font-semibold text-[#0d2b4e] flex items-center gap-1.5">
                          <QrCode className="w-4 h-4" />
                          Primeiro acesso: Escaneie o QR Code no Google Authenticator
                        </div>
                        <img
                          src={challengeData.totpPairing.qrCodeSvgDataUrl}
                          alt="QR Code Google Authenticator"
                          className="w-36 h-36 rounded-lg border border-slate-200 p-1 bg-white"
                        />
                        <div className="w-full space-y-1.5">
                          <div className="text-[11px] font-semibold text-slate-600">
                            Ou copie a chave para cadastrar no aplicativo:
                          </div>
                          <div className="flex items-center justify-center gap-1.5">
                            <code className="px-2.5 py-1 rounded bg-slate-100 border border-slate-200 font-mono text-[11px] font-semibold text-[#0d2b4e] select-all">
                              {challengeData.totpPairing.totpSecret.replace(/(.{4})/g, '$1 ').trim()}
                            </code>
                            <button
                              type="button"
                              onClick={() => {
                                navigator.clipboard?.writeText(
                                  challengeData.totpPairing?.totpSecret || ''
                                );
                                setInfoMsg('Chave copiada!');
                                mfaInputRef.current?.focus();
                              }}
                              className="px-2.5 py-1 rounded bg-[#0d2b4e] hover:bg-[#1e3a6e] text-white text-[10px] font-semibold inline-flex items-center gap-1 cursor-pointer"
                            >
                              <Copy className="w-3 h-3" /> Copiar
                            </button>
                          </div>
                        </div>
                      </div>
                    )
                  )}
                </div>
              )}

              {/* Option 2: Email OTP info & resend */}
              {activeMfaChannel === 'EMAIL_OTP' && (
                <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between gap-2 text-xs">
                  <div className="text-slate-700">
                    Destinatário: <strong>{challengeData?.user?.email || email}</strong>
                  </div>
                  <button
                    type="button"
                    disabled={sendingEmailOtp}
                    onClick={handleSendOrResendEmailOtp}
                    className="px-3 py-1.5 rounded-lg bg-[#0d2b4e] hover:bg-[#1e3a6e] text-white text-[11px] font-semibold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50 shrink-0"
                  >
                    <Send className="w-3 h-3" />
                    <span>{sendingEmailOtp ? 'Enviando...' : 'Reenviar por e-mail'}</span>
                  </button>
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Código de 6 dígitos
                </label>
                <input
                  ref={mfaInputRef}
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  autoFocus
                  required
                  maxLength={6}
                  value={mfaCode}
                  onChange={(e) => setMfaCode(e.target.value.replace(/\D+/g, ''))}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      e.currentTarget.form?.requestSubmit();
                    }
                  }}
                  placeholder="000000"
                  className="w-full px-4 py-3 rounded-xl border-2 border-[#0d2b4e] text-center font-mono text-xl font-semibold tracking-[0.4em] text-[#0d2b4e]"
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold shadow-md flex items-center justify-center gap-2 cursor-pointer transition disabled:opacity-50"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>{loading ? 'Verificando...' : 'Confirmar'}</span>
              </button>

              <div className="text-center pt-1">
                <button
                  type="button"
                  onClick={() => {
                    setStep('CREDENTIALS');
                    setMfaCode('');
                    setErrorMsg(null);
                    setInfoMsg(null);
                  }}
                  className="text-xs font-semibold text-slate-500 hover:text-slate-800 cursor-pointer"
                >
                  Voltar para o login
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
