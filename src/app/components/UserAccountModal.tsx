'use client';

import React, { useEffect, useState } from 'react';
import {
  ShieldCheck,
  Smartphone,
  Mail,
  QrCode,
  Copy,
  RefreshCw,
  CheckCircle2,
  Send,
  User,
  KeyRound,
  LogOut,
  Settings,
} from 'lucide-react';
import { StiHubMacroModule, StiHubUserRecord } from '../../db/types';
import { saveClientIamUserOverrideIfNewer } from '../lib/iam-seal-cache';

interface UserAccountModalProps {
  user: StiHubUserRecord;
  onClose: () => void;
  onUserUpdated: (updated: StiHubUserRecord) => void;
  onOpenAdminIam: () => void;
  onLogout: () => void;
  onShowToast: (msg: string) => void;
}

export default function UserAccountModal({
  user,
  onClose,
  onUserUpdated,
  onOpenAdminIam,
  onLogout,
  onShowToast,
}: UserAccountModalProps) {
  const [name, setName] = useState(user.name);
  const [phone, setPhone] = useState(user.phone || '');
  // Departamento e cargo: somente leitura (so o admin IAM edita, ate decisao do Marcello).
  const department = user.department || '';
  const jobTitle = user.jobTitle || '';
  const [mfaMethod, setMfaMethod] = useState<'TOTP_AUTHENTICATOR' | 'EMAIL_OTP'>(
    user.mfaMethod || 'TOTP_AUTHENTICATOR'
  );
  const [newPassword, setNewPassword] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  // PATCH /api/auth/me pendente de reverificacao MFA (403 STEP_UP_REQUIRED).
  const [pendingPatch, setPendingPatch] = useState<Record<string, unknown> | null>(null);
  const [stepUpCode, setStepUpCode] = useState('');
  const [totpPairing, setTotpPairing] = useState<{
    totpSecret: string;
    totpSecretFormatted: string;
    otpauthUri: string;
    qrCodeSvgDataUrl: string;
    secondsRemaining: number;
  } | null>(null);
  const [verifyTotpInput, setVerifyTotpInput] = useState('');
  const [totpVerifiedMsg, setTotpVerifiedMsg] = useState<string | null>(null);
  const [loadingTotp, setLoadingTotp] = useState(false);
  const [sendingEmailOtp, setSendingEmailOtp] = useState(false);
  const [saving, setSaving] = useState(false);

  // Revisao 7706b4a: reverificacao MFA (step-up) com a sessao ja autenticada. O desafio e
  // criado pelo servidor e ligado ao usuario da SESSAO; nenhum codigo/segredo volta na resposta.
  const [stepUpChallengeId, setStepUpChallengeId] = useState<string | null>(null);
  const [stepUpVerified, setStepUpVerified] = useState(false);
  const [pairingBlocked, setPairingBlocked] = useState(false);

  const loadTotpPairing = async (regenerate = false) => {
    setLoadingTotp(true);
    try {
      const res = await fetch('/api/auth/setup-totp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ regenerate, email: user.email }),
      });
      const json = await res.json().catch(() => null);
      if (res.ok && json?.data) {
        const d = json.data;
        setPairingBlocked(false);
        setTotpPairing({
          totpSecret: d.totpSecret,
          totpSecretFormatted:
            d.totpSecretFormatted || String(d.totpSecret || '').replace(/(.{4})/g, '$1 ').trim(),
          otpauthUri: d.otpauthUri,
          qrCodeSvgDataUrl: d.qrCodeSvgDataUrl,
          secondsRemaining: d.secondsRemaining || 30,
        });
        setVerifyTotpInput('');
        if (regenerate) {
          setTotpVerifiedMsg(null);
          onShowToast('Nova chave Base32 e QR Code Google Authenticator gerados!');
        }
      } else {
        // Ja pareado: o QR so aparece depois da reverificacao (step-up) com o codigo atual.
        setTotpPairing(null);
        setPairingBlocked(true);
      }
    } finally {
      setLoadingTotp(false);
    }
  };

  useEffect(() => {
    // Quem ja pareou nunca recebe QR/segredo automaticamente ao abrir "Minha Conta".
    if (user.totpConfigured === false) {
      loadTotpPairing(false);
    } else {
      setPairingBlocked(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user.email]);

  const startStepUp = async (method: 'TOTP_AUTHENTICATOR' | 'EMAIL_OTP') => {
    const res = await fetch('/api/auth/step-up/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ mfaMethod: method }),
    });
    const json = await res.json().catch(() => null);
    const cid = json?.data?.challengeId as string | undefined;
    if (cid) setStepUpChallengeId(cid);
    return { ok: res.ok && Boolean(cid), status: res.status, json, challengeId: cid || null };
  };

  const confirmStepUp = async (code: string, challengeId: string) => {
    const res = await fetch('/api/auth/step-up/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ challengeId, code }),
    });
    const json = await res.json().catch(() => null);
    if (res.ok) {
      // Pacote A: o novo cookie HttpOnly (com mfaStepUpAt) ja veio no Set-Cookie da resposta.
      setStepUpVerified(true);
      setStepUpChallengeId(null);
    }
    return { ok: res.ok, json };
  };

  const handleVerifyPairedTotpNow = async () => {
    const clean = verifyTotpInput.replace(/\D+/g, '');
    if (clean.length !== 6) {
      onShowToast('Digite os 6 dígitos gerados pelo seu app Google Authenticator (ou recebidos por e-mail).');
      return;
    }
    // Usa o desafio de e-mail pendente, se houver; senao cria um desafio TOTP da propria sessao.
    let cid = stepUpChallengeId;
    if (!cid) {
      const started = await startStepUp('TOTP_AUTHENTICATOR');
      if (!started.ok || !started.challengeId) {
        onShowToast(started.json?.error || 'Não foi possível iniciar a reverificação. Entre novamente.');
        return;
      }
      cid = started.challengeId;
    }
    const verified = await confirmStepUp(clean, cid);
    setVerifyTotpInput('');
    if (verified.ok) {
      setTotpVerifiedMsg(
        `Código validado com sucesso! (${verified.json?.data?.verifiedVia || 'RFC6238_TOTP'})`
      );
      onShowToast('Identidade reverificada.');
      if (mfaMethod === 'TOTP_AUTHENTICATOR' && !totpPairing) {
        await loadTotpPairing(false);
      }
    } else {
      setTotpVerifiedMsg(null);
      onShowToast(verified.json?.error || 'Código de 6 dígitos inválido. Verifique o horário do celular.');
    }
  };

  const handleSendTestEmailOtp = async () => {
    setSendingEmailOtp(true);
    try {
      const started = await startStepUp('EMAIL_OTP');
      if (started.ok) {
        onShowToast(
          `Código de 6 dígitos enviado para ${started.json?.data?.email || user.email}. Digite-o abaixo para confirmar.`
        );
      } else {
        onShowToast(started.json?.error || 'Erro ao enviar código OTP por e-mail.');
      }
    } finally {
      setSendingEmailOtp(false);
    }
  };

  /** So os campos alterados; nunca papel, permissoes, mfaEnabled, departamento ou cargo. */
  const buildSelfPatch = (): Record<string, unknown> => {
    const patch: Record<string, unknown> = {};
    if (name.trim() !== (user.name || '').trim()) patch.name = name.trim();
    if (phone.trim() && phone.trim() !== (user.phone || '').trim()) patch.phone = phone.trim();
    if (mfaMethod !== (user.mfaMethod || 'TOTP_AUTHENTICATOR')) patch.mfaMethod = mfaMethod;
    if (newPassword.trim()) {
      patch.newPassword = newPassword.trim();
      patch.currentPassword = currentPassword;
    }
    return patch;
  };

  const submitSelfPatch = async (patch: Record<string, unknown>): Promise<void> => {
    const res = await fetch('/api/auth/me', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(patch),
    });
    const json = await res.json().catch(() => null);
    if (res.ok) {
      const dto = (json?.data?.user || {}) as Record<string, unknown>;
      if (dto.iamSeal) saveClientIamUserOverrideIfNewer(dto);
      onUserUpdated({
        ...user,
        name: String(dto.name ?? user.name),
        phone: String(dto.phone ?? user.phone ?? ''),
        mfaMethod: (dto.mfaMethod as StiHubUserRecord['mfaMethod']) || user.mfaMethod,
      });
      setPendingPatch(null);
      setStepUpCode('');
      setNewPassword('');
      setCurrentPassword('');
      onShowToast(
        json?.data?.sessionRotated
          ? 'Senha alterada. As outras sessões foram encerradas.'
          : 'Configurações da conta salvas com sucesso!'
      );
      onClose();
      return;
    }
    if (res.status === 403 && json?.code === 'STEP_UP_REQUIRED') {
      // Reverificacao MFA da propria sessao; o PATCH so e reenviado depois do codigo.
      const method = user.totpConfigured === false ? 'EMAIL_OTP' : 'TOTP_AUTHENTICATOR';
      const started = await startStepUp(method);
      setPendingPatch(patch);
      onShowToast(
        started.ok
          ? method === 'EMAIL_OTP'
            ? 'Para alterar senha ou método 2FA, digite o código enviado ao seu e-mail.'
            : 'Para alterar senha ou método 2FA, digite o código atual do seu app autenticador.'
          : started.json?.error || 'Não foi possível iniciar a reverificação. Entre novamente.'
      );
      return;
    }
    onShowToast(
      json?.error ||
        (res.status === 401
          ? 'Sua sessão expirou. Entre novamente.'
          : 'Não foi possível salvar as configurações da conta.')
    );
  };

  const handleSaveAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    const patch = buildSelfPatch();
    if (Object.keys(patch).length === 0) {
      onShowToast('Nenhuma alteração para salvar.');
      return;
    }
    if (patch.newPassword !== undefined && !currentPassword) {
      onShowToast('Informe a senha atual para definir uma nova senha.');
      return;
    }
    setSaving(true);
    try {
      await submitSelfPatch(patch);
    } finally {
      setSaving(false);
    }
  };

  const handleConfirmStepUpAndSave = async () => {
    const clean = stepUpCode.replace(/\D+/g, '');
    if (clean.length !== 6 || !pendingPatch) {
      onShowToast('Digite o código de 6 dígitos.');
      return;
    }
    setSaving(true);
    try {
      let cid = stepUpChallengeId;
      if (!cid) {
        const started = await startStepUp('TOTP_AUTHENTICATOR');
        cid = started.challengeId;
      }
      if (!cid) {
        onShowToast('Não foi possível iniciar a reverificação. Entre novamente.');
        return;
      }
      const verified = await confirmStepUp(clean, cid);
      setStepUpCode('');
      if (!verified.ok) {
        onShowToast(verified.json?.error || 'Código inválido.');
        return;
      }
      await submitSelfPatch(pendingPatch);
    } finally {
      setSaving(false);
    }
  };

  const enabledModules: StiHubMacroModule[] =
    user.enabledModules && user.enabledModules.length > 0
      ? user.enabledModules
      : ['CRM', 'ERP', 'CHAMADOS'];

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-3xl w-full overflow-hidden text-xs my-6">
        {/* Header */}
        <div className="bg-[#0d2b4e] text-white px-6 py-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-[#ff7a59] text-white font-semibold text-sm flex items-center justify-center">
              {user.name
                .split(' ')
                .slice(0, 2)
                .map((p) => p[0])
                .join('')
                .toUpperCase()}
            </div>
            <div>
              <span className="text-[10px] font-semibold uppercase tracking-wider text-[#ff7a59] block">
                MINHA CONTA CORPORATIVA • SEGURANÇA 2FA &amp; ESCOPO IAM
              </span>
              <h3 className="text-base font-semibold">
                {user.name} ({user.email})
              </h3>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                onClose();
                onOpenAdminIam();
              }}
              className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white font-semibold inline-flex items-center gap-1.5 cursor-pointer"
            >
              <Settings className="w-3.5 h-3.5 text-[#ff7a59]" /> Painel IAM Completo
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 rounded-lg bg-white text-[#0d2b4e] font-semibold cursor-pointer"
            >
              Fechar
            </button>
          </div>
        </div>

        <form onSubmit={handleSaveAccount} className="p-6 space-y-5 max-h-[82vh] overflow-y-auto">
          {/* Active IAM Scope Summary */}
          <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 flex flex-wrap items-center justify-between gap-2">
            <div className="space-y-0.5">
              <div className="font-semibold text-slate-900 flex items-center gap-1.5">
                <ShieldCheck className="w-4 h-4 text-emerald-600" />
                <span>Perfil IAM Ativo: {user.roleId}</span>
                <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 text-[10px] font-semibold">
                  Escopo: {user.scope}
                </span>
              </div>
              <div className="text-[11px] text-slate-500">
                Módulos Habilitados para sua Conta:{' '}
                {enabledModules.map((m) => (
                  <span
                    key={m}
                    className="inline-block mr-1 px-2 py-0.5 rounded bg-[#0d2b4e] text-white text-[10px] font-semibold"
                  >
                    {m}
                  </span>
                ))}
              </div>
            </div>
            <button
              type="button"
              onClick={onLogout}
              className="px-3 py-1.5 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 font-semibold inline-flex items-center gap-1 cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5" /> Encerrar Sessão
            </button>
          </div>

          {/* Personal & Corporate Details */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                <User className="w-3.5 h-3.5 inline mr-1" /> Nome Completo
              </label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 font-semibold text-slate-900"
              />
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Telefone / Ramal</label>
              <input
                type="text"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 text-slate-900"
              />
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Departamento / Cargo</label>
              <input
                type="text"
                readOnly
                aria-readonly="true"
                value={[department, jobTitle].filter(Boolean).join(' • ') || '—'}
                title="Somente o administrador IAM altera departamento e cargo."
                className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-slate-100 text-slate-600 cursor-not-allowed"
              />
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                <KeyRound className="w-3.5 h-3.5 inline mr-1" /> Nova Senha Corporativa (Opcional)
              </label>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Manter senha atual (mín. 6 caracteres)"
                autoComplete="new-password"
                className="w-full px-3 py-2 rounded-lg border border-slate-300 text-slate-900"
              />
            </div>
            {newPassword.trim() && (
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  <KeyRound className="w-3.5 h-3.5 inline mr-1" /> Senha Atual
                </label>
                <input
                  type="password"
                  required
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  autoComplete="current-password"
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-slate-900"
                />
              </div>
            )}
            {pendingPatch && (
              <div className="sm:col-span-2 p-3 rounded-xl border border-amber-300 bg-amber-50 space-y-2">
                <div className="font-semibold text-amber-900">
                  Confirme sua identidade (reverificação MFA) para alterar senha ou método 2FA.
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    value={stepUpCode}
                    onChange={(e) => setStepUpCode(e.target.value)}
                    placeholder="Código de 6 dígitos"
                    autoComplete="one-time-code"
                    className="px-3 py-2 rounded-lg border border-slate-300 font-mono tracking-widest w-40"
                  />
                  <button
                    type="button"
                    disabled={saving}
                    onClick={handleConfirmStepUpAndSave}
                    className="px-3 py-2 rounded-lg bg-[#0d2b4e] text-white font-semibold cursor-pointer disabled:opacity-60"
                  >
                    Confirmar e salvar
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* 2FA Configuration: Google Authenticator (Real ISO 18004 QR Code) vs Email OTP */}
          <div className="rounded-xl border-2 border-[#0d2b4e]/20 bg-slate-50/70 p-4 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-2.5">
              <div>
                <span className="text-[10px] font-semibold uppercase text-[#ff7a59] block">
                  AUTENTICAÇÃO MULTIFATOR (2FA) DA SUA CONTA
                </span>
                <h4 className="text-sm font-semibold text-slate-900">
                  Escolha e pareie seu Método 2FA Preferido (Google Authenticator ou E-mail OTP)
                </h4>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setMfaMethod('TOTP_AUTHENTICATOR')}
                  className={`px-3 py-1.5 rounded-lg font-semibold cursor-pointer flex items-center gap-1.5 ${
                    mfaMethod === 'TOTP_AUTHENTICATOR'
                      ? 'bg-[#0d2b4e] text-white'
                      : 'bg-white border border-slate-300 text-slate-700'
                  }`}
                >
                  <Smartphone className="w-3.5 h-3.5 text-[#ff7a59]" /> Google Authenticator (TOTP)
                </button>
                <button
                  type="button"
                  onClick={() => setMfaMethod('EMAIL_OTP')}
                  className={`px-3 py-1.5 rounded-lg font-semibold cursor-pointer flex items-center gap-1.5 ${
                    mfaMethod === 'EMAIL_OTP'
                      ? 'bg-[#0d2b4e] text-white'
                      : 'bg-white border border-slate-300 text-slate-700'
                  }`}
                >
                  <Mail className="w-3.5 h-3.5 text-emerald-400" /> Código OTP por E-mail
                </button>
              </div>
            </div>

            {(mfaMethod === 'EMAIL_OTP' || (pairingBlocked && !totpPairing)) && (
              <div className="bg-white p-4 rounded-xl border border-slate-200 space-y-2">
                <div className="font-semibold text-slate-900">
                  {mfaMethod === 'TOTP_AUTHENTICATOR'
                    ? 'Seu autenticador já está pareado. Para ver o QR Code ou gerar nova chave, confirme sua identidade.'
                    : 'Confirme o código enviado ao seu e-mail.'}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    value={verifyTotpInput}
                    onChange={(e) => setVerifyTotpInput(e.target.value.replace(/\D+/g, ''))}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleVerifyPairedTotpNow();
                      }
                    }}
                    placeholder={mfaMethod === 'EMAIL_OTP' ? 'Código do e-mail' : 'Código atual do app'}
                    className="w-48 px-3 py-2 rounded-lg border-2 border-[#0d2b4e] font-mono text-sm font-semibold tracking-widest text-center text-[#0d2b4e]"
                  />
                  <button
                    type="button"
                    onClick={handleVerifyPairedTotpNow}
                    className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                  >
                    <CheckCircle2 className="w-4 h-4" /> Confirmar
                  </button>
                </div>
                {stepUpVerified && totpVerifiedMsg && (
                  <div className="p-2 rounded bg-emerald-50 border border-emerald-200 text-emerald-900 font-semibold text-[11px]">
                    {totpVerifiedMsg}
                  </div>
                )}
              </div>
            )}

            {mfaMethod === 'TOTP_AUTHENTICATOR' && totpPairing && (
              <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-center bg-white p-4 rounded-xl border border-slate-200">
                <div className="md:col-span-4 flex flex-col items-center text-center">
                  <img
                    src={totpPairing.qrCodeSvgDataUrl}
                    alt="QR Code Google Authenticator ISO 18004"
                    className="w-40 h-40 rounded-lg border border-slate-200 p-1 bg-white shadow-2xs"
                  />
                  <span className="text-[10px] font-semibold text-slate-600 mt-1.5 flex items-center gap-1">
                    <QrCode className="w-3 h-3 text-[#0d2b4e]" /> Escaneie com a câmera no Google Authenticator
                  </span>
                </div>

                <div className="md:col-span-8 space-y-2.5">
                  <div>
                    <div className="font-semibold text-slate-700 mb-1">
                      Chave Secreta Base32 (Para digitação manual no Google Authenticator):
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <code className="px-3 py-1.5 rounded-lg bg-slate-100 border border-slate-300 font-mono text-xs font-semibold text-[#0d2b4e] tracking-wider select-all">
                        {totpPairing.totpSecretFormatted}
                      </code>
                      <button
                        type="button"
                        onClick={() => {
                          navigator.clipboard?.writeText(totpPairing.totpSecret);
                          onShowToast('Chave Secreta Base32 copiada!');
                        }}
                        className="px-3 py-1.5 rounded-lg bg-[#0d2b4e] hover:bg-[#1e3a6e] text-white font-semibold inline-flex items-center gap-1 cursor-pointer"
                      >
                        <Copy className="w-3.5 h-3.5" /> Copiar Chave
                      </button>
                      <button
                        type="button"
                        disabled={loadingTotp}
                        onClick={() => loadTotpPairing(true)}
                        className="px-2.5 py-1.5 rounded-lg border border-slate-300 hover:bg-slate-100 text-slate-700 font-semibold inline-flex items-center gap-1 cursor-pointer"
                      >
                        <RefreshCw className={`w-3.5 h-3.5 ${loadingTotp ? 'animate-spin' : ''}`} /> Gerar Nova Chave
                      </button>
                    </div>
                  </div>

                  <div className="pt-1">
                    <label className="block font-semibold text-slate-700 mb-1">
                      Testar / Confirmar Código de 6 Dígitos do seu Google Authenticator:
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        maxLength={6}
                        value={verifyTotpInput}
                        onChange={(e) => setVerifyTotpInput(e.target.value.replace(/\D+/g, ''))}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            handleVerifyPairedTotpNow();
                          }
                        }}
                        placeholder="Digite os 6 dígitos do app"
                        className="w-48 px-3 py-2 rounded-lg border-2 border-[#0d2b4e] font-mono text-sm font-semibold tracking-widest text-center text-[#0d2b4e]"
                      />
                      <button
                        type="button"
                        onClick={handleVerifyPairedTotpNow}
                        className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                      >
                        <CheckCircle2 className="w-4 h-4" /> Validar Código Agora
                      </button>
                    </div>
                    {totpVerifiedMsg && (
                      <div className="mt-2 p-2 rounded bg-emerald-50 border border-emerald-200 text-emerald-900 font-semibold text-[11px]">
                        {totpVerifiedMsg}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {mfaMethod === 'EMAIL_OTP' && (
              <div className="bg-white p-4 rounded-xl border border-slate-200 flex flex-wrap items-center justify-between gap-3">
                <div className="space-y-1">
                  <div className="font-semibold text-slate-900">
                    Envio de Código OTP de 6 Dígitos por E-mail Corporativo
                  </div>
                  <p className="text-[11px] text-slate-600">
                    Ao fazer login no STI-hub, um código único temporário (válido por 5 minutos) será disparado automaticamente para <strong>{user.email}</strong>.
                  </p>
                </div>
                <button
                  type="button"
                  disabled={sendingEmailOtp}
                  onClick={handleSendTestEmailOtp}
                  className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>{sendingEmailOtp ? 'Enviando...' : 'Enviar Código OTP de Teste p/ Meu E-mail'}</span>
                </button>
              </div>
            )}
          </div>

          <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-200">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg border border-slate-300 font-semibold text-slate-700 cursor-pointer"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-5 py-2 rounded-lg bg-[#ff7a59] hover:bg-[#e86646] text-white font-semibold cursor-pointer"
            >
              {saving ? 'Salvando...' : 'Salvar Configurações da Minha Conta'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
