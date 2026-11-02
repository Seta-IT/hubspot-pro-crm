'use client';

// ============================================================================
// ERP > Fiscal > Configurações fiscais
// Espelho da tela "Configurações > Fiscal" do GestaoClick: NF-e, NFC-e, NFS-e, autorização de
// download do XML e certificado digital (upload "em breve").
//  - Ambiente padrão: HOMOLOGAÇÃO. Produção exige confirmação explícita (modal) e alçada fiscal.
//  - O CSC nunca chega em claro do servidor: só a máscara. Para trocar, digite um novo.
//  - Emitente (CNPJ e regime) é só leitura; regime "aguardando confirmação".
// ============================================================================
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  FileText,
  ShieldCheck,
  ShieldAlert,
  Receipt,
  Wrench,
  Download,
  KeyRound,
  CheckCircle2,
  FlaskConical,
  AlertTriangle,
  Plus,
  Trash2,
  Lock,
} from 'lucide-react';
import type { FiscalEnvironment, NfseOperationNature, NfseSpecialRegime, NfseStandard, NfseTaxApportionment } from '../../db/types';
import {
  FISCAL_PRODUCTION_CONFIRMATION,
  FISCAL_PRODUCTION_GESTAOCLICK_WARNING,
  NFSE_OPERATION_NATURE_LABELS,
  NFSE_SPECIAL_REGIME_LABELS,
  NFSE_STANDARD_LABELS,
  NFSE_TAX_APPORTIONMENT_LABELS,
  formatCpfOrCnpj,
  normalizeCpfOrCnpj,
  type FiscalSettingsView,
} from '../../modules/erp/fiscal-settings';

type DocKey = 'nfe' | 'nfce' | 'nfse';

const DOC_LABEL: Record<DocKey, string> = { nfe: 'NF-e', nfce: 'NFC-e', nfse: 'NFS-e' };

const TAX_REGIME_LABEL: Record<string, string> = {
  SIMPLES_NACIONAL: 'Simples Nacional',
  LUCRO_PRESUMIDO: 'Lucro Presumido',
  LUCRO_REAL: 'Lucro Real',
};

interface FormState {
  nfe: { environment: FiscalEnvironment; serie: string; removeIcmsFromPisCofinsBase: boolean; simplifiedDanfe: boolean; additionalInfo: string };
  nfce: { environment: FiscalEnvironment; serie: string; tokenId: string; cscNew: string; additionalInfo: string };
  nfse: {
    standard: NfseStandard;
    environment: FiscalEnvironment;
    rpsSerie: string;
    operationNature: NfseOperationNature;
    specialRegime: NfseSpecialRegime;
    taxApportionment: NfseTaxApportionment;
    cityClassification: string;
    cityOperationIndicator: string;
    additionalInfo: string;
  };
  xmlDownloadAuthorizations: string[];
}

function formFromView(v: FiscalSettingsView): FormState {
  return {
    nfe: {
      environment: v.nfe.environment,
      serie: v.nfe.serie,
      removeIcmsFromPisCofinsBase: v.nfe.removeIcmsFromPisCofinsBase,
      simplifiedDanfe: v.nfe.simplifiedDanfe,
      additionalInfo: v.nfe.additionalInfo,
    },
    nfce: { environment: v.nfce.environment, serie: v.nfce.serie, tokenId: v.nfce.tokenId, cscNew: '', additionalInfo: v.nfce.additionalInfo },
    nfse: {
      standard: v.nfse.standard,
      environment: v.nfse.environment,
      rpsSerie: v.nfse.rpsSerie,
      operationNature: v.nfse.operationNature,
      specialRegime: v.nfse.specialRegime,
      taxApportionment: v.nfse.taxApportionment,
      cityClassification: v.nfse.cityClassification,
      cityOperationIndicator: v.nfse.cityOperationIndicator,
      additionalInfo: v.nfse.additionalInfo,
    },
    xmlDownloadAuthorizations: v.xmlDownloadAuthorizations.map((a) => a.formatted),
  };
}

const inputCls = 'w-full px-3 py-2 rounded border border-slate-300 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-[#1e3a6e]/30';
const labelCls = 'block text-[11px] font-bold text-slate-700 mb-1';
const hintCls = 'text-[10px] text-slate-500 mt-1';
const sectionTitleCls = 'text-[10px] font-extrabold uppercase tracking-wide text-slate-500 border-b border-slate-100 pb-1 mb-3';

function EnvironmentToggle({ value, onChange, disabled }: { value: FiscalEnvironment; onChange: (v: FiscalEnvironment) => void; disabled?: boolean }) {
  return (
    <div className="grid grid-cols-2 rounded border border-slate-300 overflow-hidden text-xs font-bold" role="radiogroup">
      <button
        type="button"
        role="radio"
        aria-checked={value === 'PRODUCAO'}
        disabled={disabled}
        onClick={() => onChange('PRODUCAO')}
        className={`flex items-center justify-center gap-1 py-2 ${value === 'PRODUCAO' ? 'bg-white text-emerald-700 ring-1 ring-inset ring-emerald-500' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}
      >
        <CheckCircle2 className="w-3.5 h-3.5" /> Produção
      </button>
      <button
        type="button"
        role="radio"
        aria-checked={value === 'HOMOLOGACAO'}
        disabled={disabled}
        onClick={() => onChange('HOMOLOGACAO')}
        className={`flex items-center justify-center gap-1 py-2 ${value === 'HOMOLOGACAO' ? 'bg-white text-amber-700 ring-1 ring-inset ring-amber-500' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}
      >
        <FlaskConical className="w-3.5 h-3.5" /> Homologação
      </button>
    </div>
  );
}

function EnvBadge({ env }: { env: FiscalEnvironment }) {
  return env === 'PRODUCAO' ? (
    <span className="px-2 py-0.5 rounded text-[10px] font-extrabold bg-emerald-50 text-emerald-700 border border-emerald-300">Produção</span>
  ) : (
    <span className="px-2 py-0.5 rounded text-[10px] font-extrabold bg-amber-50 text-amber-700 border border-amber-300">Homologação</span>
  );
}

function NumberingFields({
  label,
  serieLabel,
  env,
  numbering,
  serie,
  onSerie,
  serieMax,
}: {
  label: string;
  serieLabel: string;
  env: FiscalEnvironment;
  numbering: { lastIssued: Record<FiscalEnvironment, number>; next: Record<FiscalEnvironment, number>; serie: string };
  serie: string;
  onSerie: (v: string) => void;
  serieMax: number;
}) {
  const sameSerie = String(Number(serie || 0)) === String(Number(numbering.serie || 0));
  return (
    <>
      <div>
        <label className={labelCls}>{label}</label>
        <div className="flex items-center gap-2">
          <Lock className="w-3.5 h-3.5 text-slate-400" />
          <input className={`${inputCls} text-right bg-slate-50`} value={sameSerie ? String(numbering.lastIssued[env]) : '—'} readOnly aria-readonly />
        </div>
        <p className={hintCls}>
          {sameSerie
            ? `Controlado pelo numerador do ERP (${env === 'PRODUCAO' ? 'produção' : 'homologação'}). Próximo: ${numbering.next[env]}. Outro ambiente: último ${numbering.lastIssued[env === 'PRODUCAO' ? 'HOMOLOGACAO' : 'PRODUCAO']}.`
            : 'Série alterada: o numerador desta série aparece após salvar.'}
        </p>
      </div>
      <div>
        <label className={labelCls}>{serieLabel}</label>
        <input
          className={`${inputCls} text-right`}
          value={serie}
          inputMode="numeric"
          maxLength={serieMax}
          onChange={(e) => onSerie(e.target.value.replace(/\D/g, '').slice(0, serieMax))}
        />
      </div>
    </>
  );
}

function ToggleRow({ icon, title, hint, checked, onChange }: { icon: React.ReactNode; title: string; hint: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2 border-b border-slate-100 last:border-b-0">
      <div className="flex items-start gap-3">
        <span className="text-slate-500 mt-0.5">{icon}</span>
        <div>
          <p className="text-xs font-bold text-slate-800">{title}</p>
          <p className="text-[10px] text-slate-500">{hint}</p>
        </div>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative w-10 h-5 rounded-full transition-colors ${checked ? 'bg-[#1e3a6e]' : 'bg-slate-300'}`}
      >
        <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${checked ? 'left-5' : 'left-0.5'}`} />
      </button>
    </div>
  );
}

function AdditionalInfo({ docLabel, value, onChange }: { docLabel: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="pt-3">
      <div className="flex items-start gap-3">
        <FileText className="w-4 h-4 text-slate-500 mt-0.5" />
        <div className="flex-1">
          <p className="text-xs font-bold text-slate-800">Informações complementares</p>
          <p className="text-[10px] text-slate-500 mb-2">Sai em toda {docLabel} emitida.</p>
          <textarea className={`${inputCls} min-h-[56px]`} maxLength={2000} value={value} placeholder="Sem texto padrão." onChange={(e) => onChange(e.target.value)} />
        </div>
      </div>
    </div>
  );
}

function Card({ icon, title, subtitle, env, children }: { icon: React.ReactNode; title: React.ReactNode; subtitle: string; env?: FiscalEnvironment; children: React.ReactNode }) {
  return (
    <section className="bg-white rounded-md border border-slate-200 p-5">
      <div className="flex items-start justify-between gap-3 border-b border-slate-200 pb-3 mb-4">
        <div className="flex items-start gap-2">
          <span className="text-[#1e3a6e] mt-0.5">{icon}</span>
          <div>
            <h3 className="text-base font-extrabold text-slate-900">{title}</h3>
            <p className="text-xs text-slate-500">{subtitle}</p>
          </div>
        </div>
        {env && <EnvBadge env={env} />}
      </div>
      {children}
    </section>
  );
}

export default function FiscalSettingsPanel({ onShowToast }: { onShowToast: (msg: string) => void }) {
  const [view, setView] = useState<FiscalSettingsView | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newAuthDoc, setNewAuthDoc] = useState('');
  const [pendingProduction, setPendingProduction] = useState<DocKey | null>(null);
  const [productionAck, setProductionAck] = useState(false);
  const [confirmedProduction, setConfirmedProduction] = useState<Set<DocKey>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/erp/fiscal-settings', { method: 'GET', cache: 'no-store' });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error || `Falha ao carregar (${res.status})`);
      setView(j.data);
      setForm(formFromView(j.data));
      setConfirmedProduction(new Set());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao carregar as Configurações Fiscais.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const setDoc = <K extends DocKey>(doc: K, patch: Partial<FormState[K]>) =>
    setForm((f) => (f ? { ...f, [doc]: { ...f[doc], ...patch } } : f));

  const requestEnvironment = (doc: DocKey, env: FiscalEnvironment) => {
    if (!form || !view) return;
    if (env === 'PRODUCAO' && view[doc].environment !== 'PRODUCAO' && !confirmedProduction.has(doc)) {
      setProductionAck(false);
      setPendingProduction(doc);
      return;
    }
    setDoc(doc, { environment: env } as Partial<FormState[DocKey]>);
  };

  const confirmProduction = () => {
    if (!pendingProduction || !productionAck) return;
    setDoc(pendingProduction, { environment: 'PRODUCAO' } as Partial<FormState[DocKey]>);
    setConfirmedProduction((s) => new Set(s).add(pendingProduction));
    setPendingProduction(null);
  };

  const authDocValid = useMemo(() => (newAuthDoc.trim() ? Boolean(normalizeCpfOrCnpj(newAuthDoc)) : true), [newAuthDoc]);

  const addAuthDoc = () => {
    if (!form) return;
    const digits = normalizeCpfOrCnpj(newAuthDoc);
    if (!digits) {
      onShowToast('CPF/CNPJ inválido: confira os dígitos verificadores.');
      return;
    }
    const formatted = formatCpfOrCnpj(digits);
    if (form.xmlDownloadAuthorizations.some((d) => d.replace(/\D/g, '') === digits)) {
      onShowToast('Esse CPF/CNPJ já está autorizado.');
      return;
    }
    if (form.xmlDownloadAuthorizations.length >= 10) {
      onShowToast('Limite de 10 CPF/CNPJ autorizados (leiaute NF-e 4.00).');
      return;
    }
    setForm({ ...form, xmlDownloadAuthorizations: [...form.xmlDownloadAuthorizations, formatted] });
    setNewAuthDoc('');
  };

  const handleSave = async () => {
    if (!form || !view) return;
    setSaving(true);
    try {
      const switching = (['nfe', 'nfce', 'nfse'] as DocKey[]).some((d) => form[d].environment === 'PRODUCAO' && view[d].environment !== 'PRODUCAO');
      const { cscNew, ...nfceRest } = form.nfce;
      const payload: Record<string, unknown> = {
        nfe: form.nfe,
        nfce: cscNew.trim() ? { ...nfceRest, csc: cscNew.trim() } : nfceRest,
        nfse: form.nfse,
        xmlDownloadAuthorizations: form.xmlDownloadAuthorizations,
      };
      if (switching) payload.confirmProductionSwitch = FISCAL_PRODUCTION_CONFIRMATION;
      const res = await fetch('/api/erp/fiscal-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        const issues = Array.isArray(j?.issues) ? ` (${j.issues.map((i: { path: string; message: string }) => `${i.path}: ${i.message}`).join('; ')})` : '';
        onShowToast(`${j?.error || `Falha ao salvar (${res.status})`}${issues}`);
        return;
      }
      setView(j.data);
      setForm(formFromView(j.data));
      setConfirmedProduction(new Set());
      onShowToast(
        Array.isArray(j.changedFields) && j.changedFields.length > 0
          ? `Configurações Fiscais salvas (${j.changedFields.length} alteração(ões)).`
          : 'Nenhuma alteração para salvar.'
      );
    } catch (e) {
      onShowToast(e instanceof Error ? e.message : 'Falha ao salvar as Configurações Fiscais.');
    } finally {
      setSaving(false);
    }
  };

  if (loading && !view) {
    return <div className="bg-white rounded-md border border-slate-200 p-5 text-xs text-slate-500">Carregando Configurações Fiscais…</div>;
  }
  if (error || !view || !form) {
    return (
      <div className="bg-white rounded-md border border-rose-200 p-5 text-xs text-rose-700 space-y-2">
        <p className="font-bold">Não foi possível carregar as Configurações Fiscais.</p>
        <p>{error}</p>
        <button type="button" onClick={() => void load()} className="px-3 py-1.5 rounded border border-rose-300 font-bold">
          Tentar novamente
        </button>
      </div>
    );
  }

  const anyProduction = (['nfe', 'nfce', 'nfse'] as DocKey[]).some((d) => form[d].environment === 'PRODUCAO');

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-md border border-slate-200 p-5">
        <span className="text-[10px] font-extrabold uppercase text-[#1e3a6e] block">Fiscal &gt; Configurações fiscais</span>
        <h2 className="text-base font-extrabold text-slate-900">Configurações Fiscais — NF-e, NFC-e e NFS-e</h2>
        <p className="text-xs text-slate-500">
          Ambiente padrão de todos os documentos: <strong>Homologação</strong> (sem validade fiscal). A numeração de homologação e a de produção são separadas.
        </p>
        <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
          <div className="rounded border border-slate-200 bg-slate-50 p-3">
            <p className="text-[10px] font-bold uppercase text-slate-500">Emitente</p>
            <p className="font-bold text-slate-800">{view.emitter.companyLegalName || '—'}</p>
          </div>
          <div className="rounded border border-slate-200 bg-slate-50 p-3">
            <p className="text-[10px] font-bold uppercase text-slate-500">CNPJ (somente leitura)</p>
            <p className="font-bold text-slate-800">{view.emitter.companyCnpj || '—'}</p>
          </div>
          <div className="rounded border border-amber-200 bg-amber-50 p-3">
            <p className="text-[10px] font-bold uppercase text-amber-700">Regime tributário (somente leitura)</p>
            <p className="font-bold text-slate-800">
              {view.emitter.taxRegime ? TAX_REGIME_LABEL[view.emitter.taxRegime] || view.emitter.taxRegime : '—'}{' '}
              <span className="text-[10px] font-bold text-amber-700">({view.emitter.taxRegimeNote})</span>
            </p>
          </div>
        </div>
      </div>

      {anyProduction && (
        <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900" role="alert">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <p>{FISCAL_PRODUCTION_GESTAOCLICK_WARNING}</p>
        </div>
      )}

      {/* NF-e */}
      <Card icon={<Receipt className="w-5 h-5" />} title={<>Configure a <span className="text-[#1e3a6e]">NF-e</span></>} subtitle="Nota fiscal de produtos, layout 4.00." env={form.nfe.environment}>
        <p className={sectionTitleCls}>Emissão</p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className={labelCls}>Ambiente</label>
            <EnvironmentToggle value={form.nfe.environment} onChange={(v) => requestEnvironment('nfe', v)} />
            <p className={hintCls}>As notas emitidas em homologação não têm valor fiscal.</p>
          </div>
          <NumberingFields
            label="Última NF-e emitida"
            serieLabel="Série"
            env={form.nfe.environment}
            numbering={view.nfe.numbering}
            serie={form.nfe.serie}
            onSerie={(v) => setDoc('nfe', { serie: v })}
            serieMax={3}
          />
        </div>
        <p className={`${sectionTitleCls} mt-5`}>Cálculo e listagem</p>
        <ToggleRow
          icon={<Wrench className="w-4 h-4" />}
          title="Tirar o ICMS da base do PIS e COFINS"
          hint="Não vale para todas as empresas: confirme com o seu contador."
          checked={form.nfe.removeIcmsFromPisCofinsBase}
          onChange={(v) => setDoc('nfe', { removeIcmsFromPisCofinsBase: v })}
        />
        <ToggleRow
          icon={<FileText className="w-4 h-4" />}
          title="DANFE simplificado"
          hint="Libera a impressão do DANFE simplificado na NF-e."
          checked={form.nfe.simplifiedDanfe}
          onChange={(v) => setDoc('nfe', { simplifiedDanfe: v })}
        />
        <AdditionalInfo docLabel="NF-e" value={form.nfe.additionalInfo} onChange={(v) => setDoc('nfe', { additionalInfo: v })} />
      </Card>

      {/* NFC-e */}
      <Card icon={<Receipt className="w-5 h-5" />} title={<>Configure a <span className="text-[#1e3a6e]">NFC-e</span></>} subtitle="Nota do consumidor, emitida no PDV." env={form.nfce.environment}>
        <p className={sectionTitleCls}>Emissão</p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className={labelCls}>Ambiente</label>
            <EnvironmentToggle value={form.nfce.environment} onChange={(v) => requestEnvironment('nfce', v)} />
            <p className={hintCls}>As notas emitidas em homologação não têm valor fiscal.</p>
          </div>
          <NumberingFields
            label="Última NFC-e emitida"
            serieLabel="Série"
            env={form.nfce.environment}
            numbering={view.nfce.numbering}
            serie={form.nfce.serie}
            onSerie={(v) => setDoc('nfce', { serie: v })}
            serieMax={3}
          />
        </div>
        <p className={`${sectionTitleCls} mt-5`}>Código de segurança (CSC)</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>ID do token</label>
            <input className={inputCls} value={form.nfce.tokenId} maxLength={6} inputMode="numeric" onChange={(e) => setDoc('nfce', { tokenId: e.target.value.replace(/\D/g, '').slice(0, 6) })} />
            <p className={hintCls}>Seis dígitos, gerado na SEFAZ.</p>
          </div>
          <div>
            <label className={labelCls}>CSC</label>
            <input
              className={inputCls}
              type="password"
              autoComplete="off"
              value={form.nfce.cscNew}
              placeholder={view.nfce.cscConfigured ? `Configurado (${view.nfce.cscMasked}) — digite para substituir` : 'Não configurado'}
              maxLength={36}
              onChange={(e) => setDoc('nfce', { cscNew: e.target.value.replace(/[^A-Za-z0-9]/g, '') })}
            />
            <p className={hintCls}>Código que acompanha o ID, também gerado na SEFAZ. Nunca é exibido em claro.</p>
          </div>
        </div>
        <AdditionalInfo docLabel="NFC-e" value={form.nfce.additionalInfo} onChange={(v) => setDoc('nfce', { additionalInfo: v })} />
      </Card>

      {/* NFS-e */}
      <Card icon={<Wrench className="w-5 h-5" />} title={<>Configure a <span className="text-[#1e3a6e]">NFS-e</span></>} subtitle="Nota de serviço, pela integradora ou pelo padrão nacional." env={form.nfse.environment}>
        <p className={sectionTitleCls}>Emissão</p>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div>
            <label className={labelCls}>Padrão da NFS-e</label>
            <select className={inputCls} value={form.nfse.standard} onChange={(e) => setDoc('nfse', { standard: e.target.value as NfseStandard })}>
              {(Object.keys(NFSE_STANDARD_LABELS) as NfseStandard[]).map((k) => (
                <option key={k} value={k}>
                  {NFSE_STANDARD_LABELS[k]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls}>Ambiente</label>
            <EnvironmentToggle value={form.nfse.environment} onChange={(v) => requestEnvironment('nfse', v)} />
            <p className={hintCls}>As notas emitidas em homologação não têm valor fiscal.</p>
          </div>
          <NumberingFields
            label="Último RPS emitido"
            serieLabel="Série do RPS"
            env={form.nfse.environment}
            numbering={view.nfse.numbering}
            serie={form.nfse.rpsSerie}
            onSerie={(v) => setDoc('nfse', { rpsSerie: v })}
            serieMax={5}
          />
        </div>
        <p className={`${sectionTitleCls} mt-5`}>Tributação</p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className={labelCls}>Natureza da operação</label>
            <select className={inputCls} value={form.nfse.operationNature} onChange={(e) => setDoc('nfse', { operationNature: e.target.value as NfseOperationNature })}>
              {(Object.keys(NFSE_OPERATION_NATURE_LABELS) as NfseOperationNature[]).map((k) => (
                <option key={k} value={k}>
                  {NFSE_OPERATION_NATURE_LABELS[k]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls}>Regime especial de tributação</label>
            <select className={inputCls} value={form.nfse.specialRegime} onChange={(e) => setDoc('nfse', { specialRegime: e.target.value as NfseSpecialRegime })}>
              {(Object.keys(NFSE_SPECIAL_REGIME_LABELS) as NfseSpecialRegime[]).map((k) => (
                <option key={k} value={k}>
                  {NFSE_SPECIAL_REGIME_LABELS[k]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls}>Apuração dos tributos</label>
            <select className={inputCls} value={form.nfse.taxApportionment} onChange={(e) => setDoc('nfse', { taxApportionment: e.target.value as NfseTaxApportionment })}>
              {(Object.keys(NFSE_TAX_APPORTIONMENT_LABELS) as NfseTaxApportionment[]).map((k) => (
                <option key={k || 'vazio'} value={k}>
                  {NFSE_TAX_APPORTIONMENT_LABELS[k]}
                </option>
              ))}
            </select>
          </div>
        </div>
        <p className={`${sectionTitleCls} mt-5`}>Acesso à prefeitura</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>Classificação</label>
            <input className={inputCls} maxLength={60} value={form.nfse.cityClassification} onChange={(e) => setDoc('nfse', { cityClassification: e.target.value })} />
          </div>
          <div>
            <label className={labelCls}>Indicador de operação</label>
            <input className={inputCls} maxLength={60} value={form.nfse.cityOperationIndicator} onChange={(e) => setDoc('nfse', { cityOperationIndicator: e.target.value })} />
          </div>
        </div>
        <AdditionalInfo docLabel="NFS-e" value={form.nfse.additionalInfo} onChange={(v) => setDoc('nfse', { additionalInfo: v })} />
      </Card>

      {/* Autorização de download do XML */}
      <Card icon={<Download className="w-5 h-5" />} title={<>Autorize o <span className="text-[#1e3a6e]">download do XML</span></>} subtitle="Quem pode baixar o XML das NF-e e NFC-e no portal nacional (ex.: o contador).">
        <div className="space-y-2 max-w-xl">
          {form.xmlDownloadAuthorizations.length === 0 && <p className="text-xs text-slate-500">Nenhum CPF/CNPJ autorizado.</p>}
          {form.xmlDownloadAuthorizations.map((doc) => (
            <div key={doc} className="flex items-center gap-2">
              <input className={`${inputCls} bg-slate-50`} value={doc} readOnly />
              <button
                type="button"
                aria-label={`Remover ${doc}`}
                onClick={() => setForm({ ...form, xmlDownloadAuthorizations: form.xmlDownloadAuthorizations.filter((d) => d !== doc) })}
                className="p-2 rounded border border-slate-300 text-slate-500 hover:text-rose-600"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
          <div className="flex items-center gap-2">
            <input
              className={`${inputCls} ${authDocValid ? '' : 'border-rose-400'}`}
              placeholder="CPF ou CNPJ"
              value={newAuthDoc}
              maxLength={18}
              onChange={(e) => setNewAuthDoc(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addAuthDoc();
                }
              }}
            />
          </div>
          {!authDocValid && <p className="text-[10px] text-rose-600">CPF/CNPJ inválido (dígito verificador).</p>}
          <button type="button" onClick={addAuthDoc} className="inline-flex items-center gap-1 px-3 py-1.5 rounded border border-[#1e3a6e] text-[#1e3a6e] text-xs font-bold">
            <Plus className="w-3.5 h-3.5" /> Adicionar CPF/CNPJ
          </button>
        </div>
      </Card>

      {/* Certificado digital (somente modelo de dados; upload em breve) */}
      <Card icon={<KeyRound className="w-5 h-5" />} title={<>Certificado <span className="text-[#1e3a6e]">digital</span></>} subtitle="Certificado A1 (.pfx) usado para assinar as notas.">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
          <div>
            <p className={labelCls}>Status</p>
            <p className="font-bold text-slate-800 flex items-center gap-1">
              {view.certificate.status === 'VALIDO' ? <ShieldCheck className="w-4 h-4 text-emerald-600" /> : <ShieldAlert className="w-4 h-4 text-slate-400" />}
              {view.certificate.status === 'VALIDO' ? 'Válido' : view.certificate.status === 'VENCIDO' ? 'Vencido' : 'Não configurado'}
            </p>
          </div>
          <div>
            <p className={labelCls}>Validade</p>
            <p className="font-bold text-slate-800">{view.certificate.validUntil ? new Date(view.certificate.validUntil).toLocaleDateString('pt-BR') : '—'}</p>
          </div>
          <div>
            <p className={labelCls}>CNPJ do certificado</p>
            <p className="font-bold text-slate-800">{view.certificate.certificateCnpj ? formatCpfOrCnpj(view.certificate.certificateCnpj) : '—'}</p>
          </div>
        </div>
        <div className="mt-4 flex items-center gap-3">
          <button type="button" disabled aria-disabled className="px-3 py-1.5 rounded border border-slate-300 bg-slate-100 text-slate-400 text-xs font-bold cursor-not-allowed">
            Enviar certificado (.pfx)
          </button>
          <span className="text-[11px] font-bold text-slate-500">Em breve. Nenhum arquivo .pfx ou senha é armazenado nesta versão.</span>
        </div>
      </Card>

      <div className="flex items-center justify-between gap-3">
        <button type="button" onClick={() => form && view && setForm(formFromView(view))} className="px-4 py-2 rounded border border-slate-300 bg-white text-xs font-bold text-slate-700">
          Cancelar
        </button>
        <button
          type="button"
          disabled={saving}
          onClick={() => void handleSave()}
          className="px-4 py-2 rounded bg-[#1e3a6e] hover:bg-[#162c54] text-white text-xs font-extrabold disabled:opacity-60"
        >
          {saving ? 'Salvando…' : 'Salvar configurações'}
        </button>
      </div>

      {pendingProduction && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-lg rounded-md bg-white p-5 shadow-xl space-y-3">
            <div className="flex items-center gap-2 text-amber-700">
              <AlertTriangle className="w-5 h-5" />
              <h3 className="text-sm font-extrabold">Emitir {DOC_LABEL[pendingProduction]} em PRODUÇÃO pelo ERP?</h3>
            </div>
            <p className="text-xs text-slate-700">
              As notas passam a ter validade fiscal e usam a numeração de produção (
              {pendingProduction === 'nfe'
                ? `próxima NF-e ${view.nfe.numbering.next.PRODUCAO}, série ${view.nfe.serie}`
                : pendingProduction === 'nfce'
                  ? `próxima NFC-e ${view.nfce.numbering.next.PRODUCAO}, série ${view.nfce.serie}`
                  : `próximo RPS ${view.nfse.numbering.next.PRODUCAO}, série ${view.nfse.rpsSerie}`}
              ).
            </p>
            <p className="text-xs font-bold text-amber-900 bg-amber-50 border border-amber-200 rounded p-2">{FISCAL_PRODUCTION_GESTAOCLICK_WARNING}</p>
            <label className="flex items-start gap-2 text-xs text-slate-800">
              <input type="checkbox" checked={productionAck} onChange={(e) => setProductionAck(e.target.checked)} className="mt-0.5" />
              Confirmo que o GestaoClick vai parar de emitir {DOC_LABEL[pendingProduction]} nesta série e que tenho autorização para emitir em produção.
            </label>
            <p className="text-[10px] text-slate-500">A troca só vale depois de “Salvar configurações” e fica registrada na auditoria.</p>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setPendingProduction(null)} className="px-3 py-1.5 rounded border border-slate-300 text-xs font-bold">
                Manter homologação
              </button>
              <button
                type="button"
                disabled={!productionAck}
                onClick={confirmProduction}
                className="px-3 py-1.5 rounded bg-emerald-700 text-white text-xs font-extrabold disabled:opacity-50"
              >
                Confirmar produção
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
