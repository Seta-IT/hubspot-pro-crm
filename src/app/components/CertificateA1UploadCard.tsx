'use client';

// ============================================================================
// STI-hub - Configurações > Certificado digital (A1)
// Componente único usado pela Central de Administração (StiHubAdminRbacPanel,
// sub-view CERTIFICATE_A1) e, por ela, pelo item CFG_CERTIFICADO do menu ERP.
// Contrato final do CISO (pacote N, src/api/certificate-routes.ts):
// GET/POST/DELETE /api/erp/certificate; sucesso { data }, erro { error, code }.
//
// Segurança da tela:
// - Senha e base64 vivem só na memória do componente (useState / variável local),
//   nunca em localStorage, sessionStorage, journal ou console; são limpos (e o
//   input file também) depois de cada envio, com sucesso ou erro.
// - Enviar/Trocar/Excluir só aparecem quando data.canManage (calculado no
//   servidor: admin com 2FA) é verdadeiro. O backend revalida em cada chamada.
// - GET 401 (MFA_AUTH_REQUIRED) ou 403 (CERT_FORBIDDEN) esconde a seção inteira. Erros são exibidos por código, sem ecoar a
//   resposta crua do servidor.
// ============================================================================

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Award,
  Building2,
  CalendarClock,
  ChevronRight,
  FileKey2,
  Fingerprint,
  Home,
  KeyRound,
  Landmark,
  Loader2,
  Lock,
  Server,
  ShieldCheck,
  Trash2,
  Upload,
  UserRound,
} from 'lucide-react';
import {
  CERT_A1_ENDPOINT,
  CERT_A1_MAX_BYTES,
  type CertificateA1Metadata,
  certificateErrorMessage,
  certificateStatusBadge,
  certificateWarningMessages,
  formatCnpj,
  readCertificateData,
  readCertificateError,
  shouldHideCertificateSection,
  formatCertificateDate,
  formatDaysToExpire,
  stripDataUrlPrefix,
  validateCertificateFile,
  CERT_A1_ERROR_MESSAGES,
} from '../lib/certificate-a1-client';

type SefazEnvironment = 'PRODUCAO' | 'HOMOLOGACAO';

export interface CertificateA1UploadCardProps {
  onShowToast?: (msg: string) => void;
  /** Ambiente de emissão (já existente em certificateSettings.sefazEnvironment). */
  environment?: {
    value: SefazEnvironment;
    onChange: (value: SefazEnvironment) => void;
    onSave: () => void;
    saving?: boolean;
  };
  /** Atalho opcional para a tela de séries fiscais. */
  onOpenFiscalSeries?: () => void;
}

type LoadState = 'loading' | 'ready' | 'forbidden' | 'error';

function SectionCard({
  icon: Icon,
  lead,
  strong,
  subtitle,
  children,
  footer,
}: {
  icon: React.ComponentType<{ className?: string }>;
  lead: string;
  strong: string;
  subtitle: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <section className="bg-white rounded-md border border-slate-200 shadow-2xs">
      <header className="px-5 pt-4 pb-3">
        <h3 className="flex items-center gap-2 text-[15px] text-slate-700">
          <Icon className="w-4 h-4 text-slate-500" />
          <span>
            {lead} <strong className="font-semibold text-[#1e3a6e]">{strong}</strong>
          </span>
        </h3>
        <p className="text-[11px] text-slate-500 mt-0.5">{subtitle}</p>
      </header>
      <div className="divide-y divide-slate-100 border-t border-slate-100">{children}</div>
      {footer && <div className="px-5 py-3 border-t border-slate-100">{footer}</div>}
    </section>
  );
}

function SettingRow({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-5 py-3">
      <div className="flex items-start gap-3 min-w-0">
        <Icon className="w-4 h-4 mt-0.5 text-slate-500 shrink-0" />
        <div className="min-w-0">
          <div className="text-xs font-semibold text-slate-800">{title}</div>
          <div className="text-[11px] text-slate-500">{description}</div>
        </div>
      </div>
      <div className="sm:max-w-[60%] sm:text-right text-xs font-semibold text-slate-900 break-all">{children}</div>
    </div>
  );
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('read'));
    reader.onload = () => resolve(stripDataUrlPrefix(typeof reader.result === 'string' ? reader.result : ''));
    reader.readAsDataURL(file);
  });
}

async function errorMessageFrom(res: Response): Promise<string> {
  const j = await res.json().catch(() => null);
  const { code, cnpjCheck } = readCertificateError(j);
  return certificateErrorMessage(res.status, code, cnpjCheck);
}

export default function CertificateA1UploadCard({ onShowToast, environment, onOpenFiscalSeries }: CertificateA1UploadCardProps) {
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [cert, setCert] = useState<CertificateA1Metadata | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState<null | 'upload' | 'delete'>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const toast = useCallback((msg: string) => onShowToast?.(msg), [onShowToast]);

  const clearSensitive = useCallback(() => {
    setPassword('');
    setFile(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, []);

  const loadCertificate = useCallback(async () => {
    try {
      const res = await fetch(CERT_A1_ENDPOINT, { credentials: 'same-origin', cache: 'no-store' });
      if (shouldHideCertificateSection(res.status)) {
        setLoadState('forbidden');
        return;
      }
      if (!res.ok) {
        setLoadState('error');
        return;
      }
      const data = readCertificateData(await res.json().catch(() => null));
      if (!data) {
        setLoadState('error');
        return;
      }
      setCert(data);
      setLoadState('ready');
    } catch {
      setLoadState('error');
    }
  }, []);

  useEffect(() => {
    void loadCertificate();
    return () => {
      // Sai da tela: nada sensível permanece na memória do componente.
      setPassword('');
      setFile(null);
    };
  }, [loadCertificate]);

  const present = Boolean(cert?.present);
  const canManage = cert?.canManage === true;
  const isCurrentValid = present && cert?.status !== 'VENCIDO';

  const handleSelectFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] ?? null;
    setErrorMsg(null);
    if (!f) {
      setFile(null);
      return;
    }
    const err = validateCertificateFile(f);
    if (err) {
      setErrorMsg(err);
      setFile(null);
      e.target.value = '';
      return;
    }
    setFile(f);
  };

  const handleUpload = async () => {
    if (!canManage || busy) return;
    setErrorMsg(null);
    const fileErr = validateCertificateFile(file);
    if (fileErr) {
      setErrorMsg(fileErr);
      return;
    }
    if (!password) {
      setErrorMsg(CERT_A1_ERROR_MESSAGES.CERT_CLIENT_PASSWORD);
      return;
    }
    if (isCurrentValid) {
      const ok = window.confirm(
        'Já existe um certificado digital vigente. Deseja substituí-lo pelo novo arquivo? O certificado atual deixará de ser usado nas emissões.'
      );
      if (!ok) return;
    }
    setBusy('upload');
    setWarnings([]);
    let pfxBase64 = '';
    try {
      pfxBase64 = await readFileAsBase64(file as File);
      const res = await fetch(CERT_A1_ENDPOINT, {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pfxBase64, password }),
      });
      pfxBase64 = '';
      if (!res.ok) {
        setErrorMsg(await errorMessageFrom(res));
        return;
      }
      const j = (await res.json().catch(() => null)) as { replaced?: unknown; warnings?: unknown } | null;
      const data = readCertificateData(j);
      if (data) setCert(data);
      else await loadCertificate();
      setWarnings(certificateWarningMessages(j?.warnings, data?.daysToExpire));
      toast(j?.replaced === true ? 'Certificado digital substituído com sucesso.' : 'Certificado digital enviado com sucesso.');
    } catch {
      setErrorMsg(CERT_A1_ERROR_MESSAGES.CERT_GENERIC);
    } finally {
      pfxBase64 = '';
      clearSensitive();
      setBusy(null);
    }
  };

  const handleDelete = async () => {
    if (!canManage || busy || !present) return;
    const ok = window.confirm(
      'Excluir o certificado digital A1 da Seta Telecom? As emissões de NF-e, NFS-e e NFCom ficarão indisponíveis até um novo envio.'
    );
    if (!ok) return;
    setBusy('delete');
    setErrorMsg(null);
    try {
      const res = await fetch(CERT_A1_ENDPOINT, { method: 'DELETE', credentials: 'same-origin', cache: 'no-store' });
      if (!res.ok) {
        setErrorMsg(await errorMessageFrom(res));
        if (res.status === 404) await loadCertificate();
        return;
      }
      const data = readCertificateData(await res.json().catch(() => null));
      if (data) setCert(data);
      else await loadCertificate();
      setWarnings([]);
      toast('Certificado digital excluído.');
    } catch {
      setErrorMsg(CERT_A1_ERROR_MESSAGES.CERT_GENERIC);
    } finally {
      setBusy(null);
    }
  };

  // GET 403: a seção inteira fica oculta.
  if (loadState === 'forbidden') return null;

  const badge = certificateStatusBadge(cert?.status ?? null);

  return (
    <div className="space-y-4 text-xs">
      {/* Título da página + breadcrumb */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-lg text-slate-800">
          <Award className="w-5 h-5 text-[#1e3a6e]" />
          <span className="font-semibold">Certificado digital</span>
        </h2>
        <nav aria-label="breadcrumb" className="flex items-center gap-1 text-[11px] text-slate-500">
          <Home className="w-3.5 h-3.5" />
          <span>Início</span>
          <ChevronRight className="w-3 h-3" />
          <span className="font-semibold text-slate-800">Certificado digital</span>
        </nav>
      </div>

      {errorMsg && (
        <div role="alert" className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-red-800">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <span className="font-semibold">{errorMsg}</span>
        </div>
      )}

      {warnings.length > 0 && (
        <div role="status" className="space-y-1 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-amber-800">
          {warnings.map((w) => (
            <div key={w} className="flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              <span className="font-semibold">{w}</span>
            </div>
          ))}
        </div>
      )}

      {/* Seção 1: certificado atual */}
      <SectionCard
        icon={ShieldCheck}
        lead="Certificado"
        strong="atual"
        subtitle="Certificado A1 ICP-Brasil usado nas emissões de NF-e, NFS-e e NFCom da Seta Telecom."
        footer={
          canManage && present ? (
            <div className="flex justify-end">
              <button
                type="button"
                onClick={handleDelete}
                disabled={busy !== null}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded border border-red-300 text-red-700 hover:bg-red-50 font-semibold cursor-pointer disabled:opacity-60"
              >
                {busy === 'delete' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                Excluir certificado
              </button>
            </div>
          ) : undefined
        }
      >
        {loadState === 'loading' && (
          <div className="flex items-center gap-2 px-5 py-6 text-slate-500 font-semibold">
            <Loader2 className="w-4 h-4 animate-spin" /> Carregando certificado...
          </div>
        )}
        {loadState === 'error' && (
          <div className="flex items-center justify-between gap-2 px-5 py-6">
            <span className="text-slate-600 font-semibold">Não foi possível consultar o certificado agora.</span>
            <button
              type="button"
              onClick={() => {
                setLoadState('loading');
                void loadCertificate();
              }}
              className="px-3 py-1.5 rounded border border-slate-300 text-slate-700 hover:bg-slate-50 font-semibold cursor-pointer"
            >
              Tentar novamente
            </button>
          </div>
        )}
        {loadState === 'ready' && !present && (
          <div className="flex items-center gap-3 px-5 py-6">
            <FileKey2 className="w-6 h-6 text-slate-400" />
            <div>
              <div className="font-semibold text-slate-800">Nenhum certificado digital cadastrado</div>
              <div className="text-[11px] text-slate-500">
                {canManage
                  ? 'Envie o certificado A1 (.pfx ou .p12) da Seta Telecom na seção abaixo.'
                  : 'Solicite a um administrador com 2FA o envio do certificado A1 da Seta Telecom.'}
              </div>
            </div>
          </div>
        )}
        {loadState === 'ready' && present && cert && (
          <>
            {cert.icpBrasil === false && (
              <div className="flex items-start gap-2 px-5 py-3 bg-amber-50 text-amber-800">
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                <span className="font-semibold">
                  Atenção: a cadeia deste certificado não foi reconhecida como ICP-Brasil. A SEFAZ e as prefeituras podem recusar as emissões.
                </span>
              </div>
            )}
            <SettingRow icon={CalendarClock} title="Status" description="Situação da validade do certificado.">
              <span className="inline-flex items-center gap-2 justify-end flex-wrap">
                <span className={`px-2 py-0.5 rounded border text-[11px] font-semibold ${badge.className}`}>{badge.label}</span>
                <span className="text-slate-600 font-semibold">{formatDaysToExpire(cert.daysToExpire)}</span>
              </span>
            </SettingRow>
            <SettingRow icon={UserRound} title="Titular" description="Razão social gravada no certificado.">
              {cert.subject || '-'}
            </SettingRow>
            <SettingRow icon={Building2} title="CNPJ" description="Documento do titular do certificado.">
              {cert.cnpj ? formatCnpj(cert.cnpj) : '-'}
            </SettingRow>
            <SettingRow icon={Landmark} title="Emissora" description="Autoridade certificadora que emitiu o certificado.">
              {cert.issuer || '-'}
            </SettingRow>
            <SettingRow icon={CalendarClock} title="Validade" description="Período de vigência do certificado.">
              {formatCertificateDate(cert.notBefore)} a {formatCertificateDate(cert.notAfter)}
            </SettingRow>
            <SettingRow icon={Fingerprint} title="Série e impressão digital" description="Identificadores técnicos (SHA-256).">
              <span className="font-mono text-[11px]">
                {cert.serial || '-'}
                {cert.fingerprintSha256 ? ` / ${cert.fingerprintSha256}` : ''}
              </span>
            </SettingRow>
            <SettingRow icon={Upload} title="Último envio" description="Quando e por quem o certificado foi enviado.">
              {formatCertificateDate(cert.uploadedAt)}
              {cert.uploadedBy ? ` por ${cert.uploadedBy}` : ''}
            </SettingRow>
          </>
        )}
      </SectionCard>

      {/* Seção 2: envio (somente admin com 2FA) */}
      {canManage ? (
        <SectionCard
          icon={Upload}
          lead="Envie o"
          strong="certificado A1"
          subtitle={`Arquivo .pfx ou .p12 de até ${CERT_A1_MAX_BYTES / 1024} KiB. O arquivo e a senha são criptografados no servidor e nunca voltam para o navegador.`}
          footer={
            <div className="flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => {
                  clearSensitive();
                  setErrorMsg(null);
                }}
                disabled={busy !== null}
                className="px-4 py-2 rounded border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 font-semibold cursor-pointer disabled:opacity-60"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleUpload}
                disabled={busy !== null || !file || !password}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded bg-[#1e3a6e] hover:bg-[#162d57] text-white font-semibold cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {busy === 'upload' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                {present ? 'Trocar certificado' : 'Enviar certificado'}
              </button>
            </div>
          }
        >
          <SettingRow icon={FileKey2} title="Arquivo do certificado" description="Selecione o arquivo A1 exportado com a chave privada.">
            <input
              ref={fileInputRef}
              type="file"
              accept=".pfx,.p12,application/x-pkcs12"
              onChange={handleSelectFile}
              disabled={busy !== null}
              className="block w-full sm:w-72 text-[11px] text-slate-700 file:mr-3 file:px-3 file:py-1.5 file:rounded file:border file:border-slate-300 file:bg-slate-50 file:text-slate-700 file:font-semibold"
            />
          </SettingRow>
          <SettingRow icon={KeyRound} title="Senha do certificado" description="Usada só para validar e proteger o arquivo. Não é exibida novamente.">
            <input
              type="password"
              name="certificate-a1-password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={busy !== null}
              className="w-full sm:w-72 px-3 py-2 rounded border border-slate-300"
            />
          </SettingRow>
        </SectionCard>
      ) : (
        loadState === 'ready' && (
          <div className="flex items-start gap-2 rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-slate-600">
            <Lock className="w-4 h-4 mt-0.5 shrink-0" />
            <span className="font-semibold">Somente administradores com 2FA ativo podem enviar, trocar ou excluir o certificado digital.</span>
          </div>
        )
      )}

      {/* Seção 3: ambiente de emissão (configuração já existente).
          Gravar (PUT /api/admin/settings) exige admin com 2FA: o mesmo sinal do servidor
          (data.canManage do GET /api/erp/certificate). Sem ele, sem Salvar e sem valor (não é lido). */}
      {environment && loadState === 'ready' && (
        <SectionCard
          icon={Server}
          lead="Ambiente de"
          strong="emissão"
          subtitle="Define se as notas são emitidas com validade jurídica ou em testes na SEFAZ e na prefeitura."
          footer={
            canManage ? (
            <div className="flex items-center justify-between gap-3">
              {onOpenFiscalSeries ? (
                <button
                  type="button"
                  onClick={onOpenFiscalSeries}
                  className="px-4 py-2 rounded border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 font-semibold cursor-pointer"
                >
                  Séries fiscais
                </button>
              ) : (
                <span />
              )}
              <button
                type="button"
                onClick={environment.onSave}
                disabled={environment.saving}
                className="px-4 py-2 rounded bg-[#1e3a6e] hover:bg-[#162d57] text-white font-semibold cursor-pointer disabled:opacity-60"
              >
                {environment.saving ? 'Salvando...' : 'Salvar'}
              </button>
            </div>
            ) : (
              <div className="flex items-center gap-2 text-slate-500">
                <Lock className="w-3.5 h-3.5" />
                <span className="font-semibold">Somente administradores com 2FA podem alterar o ambiente de emissão.</span>
              </div>
            )
          }
        >
          <SettingRow icon={Server} title="Ambiente SEFAZ / Prefeitura" description="Produção para emissões reais; Homologação para testes.">
            {canManage ? (
              <select
                value={environment.value}
                onChange={(e) => environment.onChange(e.target.value as SefazEnvironment)}
                className="w-full sm:w-72 px-3 py-2 rounded border border-slate-300 bg-white"
              >
                <option value="PRODUCAO">Produção (validade jurídica)</option>
                <option value="HOMOLOGACAO">Homologação (testes)</option>
              </select>
            ) : (
              // Sem canManage o valor real não é lido (/api/admin/settings exige admin com 2FA):
              // nunca mostrar o padrão local como se fosse o valor configurado.
              <span data-testid="sefaz-env-unavailable" className="text-slate-500 font-semibold">
                Não disponível para o seu perfil
              </span>
            )}
          </SettingRow>
        </SectionCard>
      )}
    </div>
  );
}
