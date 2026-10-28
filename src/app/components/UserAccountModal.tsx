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
  const [phone, setPhone] = useState(user.phone || '(11) 3958-4929');
  const [department, setDepartment] = useState(user.department || '');
  const [jobTitle, setJobTitle] = useState(user.jobTitle || '');
  const [mfaMethod, setMfaMethod] = useState<'TOTP_AUTHENTICATOR' | 'EMAIL_OTP'>(
    user.mfaMethod || 'TOTP_AUTHENTICATOR'
  );
  const [newPassword, setNewPassword] = useState('');
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

  const loadTotpPairing = async (regenerate = false) => {
    setLoadingTotp(true);
    try {
      const res = await fetch('/api/auth/setup-totp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: user.email,
          userId: user.id,
          regenerate,
        }),
      });
      const json = await res.json();
      if (res.ok && json?.data) {
        const d = json.data;
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
      }
    } finally {
      setLoadingTotp(false);
    }
  };

  useEffect(() => {
    loadTotpPairing(false);
  }, [user.email]);

  const handleVerifyPairedTotpNow = async () => {
    const clean = verifyTotpInput.replace(/\D+/g, '');
    if (clean.length !== 6) {
      onShowToast('Digite os 6 dígitos gerados pelo seu app Google Authenticator.');
      return;
    }
    const res = await fetch('/api/auth/verify-mfa', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({
        email: user.email,
        userId: user.id,
        code: clean,
        mfaMethod: 'TOTP_AUTHENTICATOR',
        totpSecret: totpPairing?.totpSecret,
      }),
    });
    const json = await res.json();
    if (res.ok) {
      const token = json.data?.sessionToken || '';
      if (typeof window !== 'undefined' && token) {
        document.cookie = 'stihub_logged_out=; Path=/; Max-Age=0; SameSite=Lax';
        document.cookie = `stihub_session=${encodeURIComponent(token)}; Path=/; Max-Age=86400; SameSite=Lax`;
      }
      setTotpVerifiedMsg(
        `Google Authenticator validado e sincronizado com sucesso! (${json.data?.verifiedVia || 'RFC6238_TOTP'})`
      );
      setVerifyTotpInput('');
      onShowToast('Google Authenticator validado e salvo na sua conta!');
    } else {
      setTotpVerifiedMsg(null);
      onShowToast(json.error || 'Código de 6 dígitos inválido. Verifique o horário do celular.');
    }
  };

  const handleSendTestEmailOtp = async () => {
    setSendingEmailOtp(true);
    try {
      const res = await fetch('/api/auth/send-email-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: user.email,
          userId: user.id,
        }),
      });
      const json = await res.json();
      if (res.ok && json?.data) {
        onShowToast(
          `Código OTP de 6 dígitos enviado para ${json.data.email} (Protocolo ${json.data.protocol})!`
        );
      } else {
        onShowToast(json?.error || 'Erro ao enviar código OTP por e-mail.');
      }
    } finally {
      setSendingEmailOtp(false);
    }
  };

  const handleSaveAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        name: name.trim(),
        phone: phone.trim(),
        department: department.trim(),
        jobTitle: jobTitle.trim(),
        mfaMethod,
        mfaEnabled: true,
      };
      if (totpPairing?.totpSecret) {
        payload.totpSecret = totpPairing.totpSecret;
      }
      if (newPassword.trim().length >= 6) {
        payload.password = newPassword.trim();
      }
      const res = await fetch(`/api/admin/users/${encodeURIComponent(user.id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        const json = await res.json();
        if (json?.data) {
          onUserUpdated(json.data);
        }
        onShowToast('Configurações da conta e método 2FA salvos com sucesso!');
        onClose();
      }
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
              <label className="block font-semibold text-slate-700 mb-1">Departamento</label>
              <input
                type="text"
                value={department}
                onChange={(e) => setDepartment(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 text-slate-900"
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
                className="w-full px-3 py-2 rounded-lg border border-slate-300 text-slate-900"
              />
            </div>
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
