'use client';

// ============================================================================
// ERP > Fiscal > Notas de produtos > Adicionar NF-e (padrão do emissor GestaoClick)
// Ordem dos blocos igual aos prints: Dados gerais, Destinatário, Produtos, Transporte,
// Totais, Informações adicionais e os botões Cancelar / Cadastrar (▾ Cadastrar e emitir).
//  - Cadastrar grava RASCUNHO no ambiente das Configurações Fiscais (padrão HOMOLOGAÇÃO).
//  - Regime, CNPJ e município do emitente vêm da configuração e não são editáveis aqui;
//    CSOSN/CST por item são só sugestão editável.
//  - "Cadastrar e emitir" fica desabilitado até a integração com a SEFAZ.
// ============================================================================
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  FileText,
  User,
  Package,
  Truck,
  Calculator,
  Info,
  Pencil,
  Trash2,
  Plus,
  ChevronDown,
  Calendar,
  Clock,
  Hash,
  ArrowRightLeft,
  UserCheck,
  LogOut,
  Flag,
  Send,
  MapPin,
  Store,
  AlertTriangle,
  FlaskConical,
  Boxes,
  Scale,
  Tag,
  ListOrdered,
  X,
  Home,
  DollarSign,
} from 'lucide-react';
import type { Company, ErpCatalogItem, ErpFiscalInvoice, ErpSupplierRecord, ErpTaxRegime, FiscalEnvironment } from '../../db/types';
import { formatBRL } from './ui-helpers';
import {
  HOMOLOGATION_RECIPIENT_NAME,
  NFE_ATENDIMENTO_OPTIONS,
  NFE_CONSUMIDOR_FINAL_OPTIONS,
  NFE_CONTRIBUINTE_OPTIONS,
  NFE_CSOSN_OPTIONS,
  NFE_CST_ICMS_OPTIONS,
  NFE_DESTINO_OPTIONS,
  NFE_FINALIDADE_OPTIONS,
  NFE_FORMA_EMISSAO_OPTIONS,
  NFE_FRETE_OPTIONS,
  NFE_PAGAMENTO_OPTIONS,
  NFE_SAIDA_OPTIONS,
  NFE_TIPO_OPTIONS,
  PRODUCT_NFE_SEFAZ_PENDING_HINT,
  REGIME_LABELS,
  computeProductNfeTotals,
  crtFromRegime,
  isValidCnpjDv,
  isValidCpfDv,
  productNfeWarnings,
  suggestCfop,
  suggestIcmsCode,
} from '../../modules/erp/product-nfe-engine';

const NAVY = '#1e3a6e';
const inputCls = 'w-full px-3 py-2 rounded border border-slate-300 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-[#1e3a6e]/30';
const labelCls = 'block text-[11px] font-bold text-slate-700 mb-1';
const onlyDigits = (v: unknown) => String(v ?? '').replace(/\D/g, '');

interface NfeContext {
  environment: FiscalEnvironment;
  serie: string;
  nextNumber: number;
  taxRegime: ErpTaxRegime;
  crt: '1' | '3';
  emitterUf: string;
  additionalInfo: string;
  canIssue: boolean;
}

interface ItemRow {
  key: string;
  catalogItemId: string | null;
  code: string;
  description: string;
  ncm: string;
  cfop: string;
  unit: string;
  quantity: string;
  unitValue: string;
  origin: string;
  icmsCode: string;
  icmsRatePercent: string;
  ipiRatePercent: string;
  ean: string;
}

interface PlaceState {
  document: string;
  name: string;
  cep: string;
  street: string;
  number: string;
  complement: string;
  district: string;
  city: string;
  uf: string;
  cityIbge: string;
}
const emptyPlace = (): PlaceState => ({ document: '', name: '', cep: '', street: '', number: '', complement: '', district: '', city: '', uf: '', cityIbge: '' });

const parseNum = (v: string) => {
  const s = String(v ?? '').trim();
  if (!s) return 0;
  const n = Number(s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s);
  return Number.isFinite(n) ? n : 0;
};
const fmtNum = (n: number, d = 2) => n.toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });

function nowBrasilia(): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date());
  const g = (t: string) => parts.find((p) => p.type === t)?.value || '';
  return { date: `${g('year')}-${g('month')}-${g('day')}`, time: `${g('hour')}:${g('minute')}` };
}

function formatDoc(v: string, type: 'CNPJ' | 'CPF'): string {
  const d = onlyDigits(v).slice(0, type === 'CNPJ' ? 14 : 11);
  if (type === 'CPF') return d.replace(/^(\d{3})(\d)/, '$1.$2').replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3').replace(/\.(\d{3})(\d)/, '.$1-$2');
  return d
    .replace(/^(\d{2})(\d)/, '$1.$2')
    .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1/$2')
    .replace(/(\d{4})(\d)/, '$1-$2');
}
const formatCep = (v: string) => onlyDigits(v).slice(0, 8).replace(/^(\d{5})(\d)/, '$1-$2');

function parseCityState(v: unknown): { city: string; uf: string } {
  const s = String(v ?? '').trim();
  const m = /^(.*?)[\s]*[(/-][\s]*([A-Za-z]{2})\)?$/.exec(s);
  return m ? { city: m[1].trim(), uf: m[2].toUpperCase() } : { city: s, uf: '' };
}

// ---------------------------------------------------------------------------
// Pequenos componentes no visual do ERP
// ---------------------------------------------------------------------------
function Section({ icon, lead, strong, tail, subtitle, children }: { icon: React.ReactNode; lead: string; strong: string; tail: string; subtitle: string; children: React.ReactNode }) {
  return (
    <section className="bg-white border border-slate-200 rounded">
      <header className="px-4 pt-3 pb-2 border-b border-slate-100">
        <h3 className="text-sm text-slate-700 flex items-center gap-1.5">
          {icon} {lead} <strong style={{ color: NAVY }}>{strong}</strong> {tail}
        </h3>
        <p className="text-[10px] text-slate-500">{subtitle}</p>
      </header>
      <div className="p-4 space-y-3">{children}</div>
    </section>
  );
}

function Toggle({ checked, onChange, label, icon }: { checked: boolean; onChange: (v: boolean) => void; label: string; icon?: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2 text-xs text-slate-700 select-none">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={`w-8 h-4 rounded-full relative transition-colors cursor-pointer ${checked ? 'bg-[#1e3a6e]' : 'bg-slate-300'}`}
      >
        <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all ${checked ? 'left-4' : 'left-0.5'}`} />
      </button>
      {icon}
      <span className="cursor-pointer" onClick={() => onChange(!checked)}>{label}</span>
    </span>
  );
}

/** "Chip" com lápis do GestaoClick: mostra o valor; clicando, vira um select/input. */
function Chip({
  icon,
  label,
  value,
  options,
  onChange,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  options?: ReadonlyArray<{ value: string; label: string }>;
  onChange?: (v: string) => void;
  children?: React.ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  const current = options?.find((o) => o.value === value)?.label ?? value;
  return (
    <div className="border border-slate-200 rounded px-3 py-2 flex items-center gap-2 bg-white min-h-[44px]">
      <span className="text-slate-500">{icon}</span>
      <div className="flex-1 min-w-0">
        <p className="text-[9px] text-slate-500">{label}</p>
        {editing && options && onChange ? (
          <select
            autoFocus
            aria-label={label}
            className="w-full text-xs font-bold border-0 p-0 bg-transparent focus:outline-none"
            value={value}
            onChange={(e) => {
              onChange(e.target.value);
              setEditing(false);
            }}
            onBlur={() => setEditing(false)}
          >
            {options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        ) : editing && children ? (
          <div onBlur={() => setEditing(false)}>{children}</div>
        ) : (
          <p className="text-xs font-bold text-slate-800 truncate">{current || 'Não informado'}</p>
        )}
      </div>
      {(options || children) && (
        <button type="button" aria-label={`Editar ${label}`} onClick={() => setEditing((v) => !v)} className="text-slate-400 hover:text-slate-700">
          <Pencil className="w-3 h-3" />
        </button>
      )}
    </div>
  );
}

/** Campo de busca com lista suspensa (clientes/fornecedores, transportadoras, itens). */
function SearchBox<T>({
  value,
  onText,
  items,
  render,
  onPick,
  placeholder = 'Digite para buscar',
  ariaLabel,
}: {
  value: string;
  onText: (v: string) => void;
  items: T[];
  render: (it: T) => { key: string; title: string; subtitle?: string };
  onPick: (it: T) => void;
  placeholder?: string;
  ariaLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);
  return (
    <div className="relative" ref={boxRef}>
      <input
        aria-label={ariaLabel}
        className={inputCls}
        value={value}
        placeholder={placeholder}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          onText(e.target.value);
          setOpen(true);
        }}
      />
      {open && value.trim().length >= 1 && items.length > 0 && (
        <ul className="absolute z-30 left-0 right-0 mt-1 max-h-60 overflow-auto bg-white border border-slate-200 rounded shadow-lg text-xs">
          {items.slice(0, 8).map((it) => {
            const r = render(it);
            return (
              <li key={r.key}>
                <button
                  type="button"
                  className="w-full text-left px-3 py-1.5 hover:bg-slate-50"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    onPick(it);
                    setOpen(false);
                  }}
                >
                  <p className="font-semibold text-slate-800">{r.title}</p>
                  {r.subtitle && <p className="text-[10px] text-slate-500">{r.subtitle}</p>}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function Field({ label, required, children, className = '' }: { label: string; required?: boolean; children: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      <span className={labelCls}>
        {label}
        {required && <span className="text-rose-600">*</span>}
      </span>
      {children}
    </div>
  );
}

function PlaceFields({ value, onChange, title }: { value: PlaceState; onChange: (v: PlaceState) => void; title: string }) {
  const set = (k: keyof PlaceState) => (e: React.ChangeEvent<HTMLInputElement>) => onChange({ ...value, [k]: e.target.value });
  return (
    <div className="border border-slate-200 rounded p-3 space-y-2">
      <p className="text-[10px] font-extrabold uppercase tracking-wide text-slate-500">{title}</p>
      <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
        <Field label="CPF/CNPJ"><input aria-label={`${title}: CPF/CNPJ`} className={inputCls} value={value.document} onChange={set('document')} /></Field>
        <Field label="Nome / razão social" className="md:col-span-2"><input aria-label={`${title}: nome`} className={inputCls} value={value.name} onChange={set('name')} /></Field>
        <Field label="CEP"><input aria-label={`${title}: CEP`} className={inputCls} value={value.cep} onChange={(e) => onChange({ ...value, cep: formatCep(e.target.value) })} /></Field>
        <Field label="Logradouro" required><input aria-label={`${title}: logradouro`} className={inputCls} value={value.street} onChange={set('street')} /></Field>
        <Field label="Número"><input aria-label={`${title}: número`} className={inputCls} value={value.number} onChange={set('number')} /></Field>
        <Field label="Complemento"><input aria-label={`${title}: complemento`} className={inputCls} value={value.complement} onChange={set('complement')} /></Field>
        <Field label="Bairro" required><input aria-label={`${title}: bairro`} className={inputCls} value={value.district} onChange={set('district')} /></Field>
        <Field label="Cidade" required><input aria-label={`${title}: cidade`} className={inputCls} value={value.city} onChange={set('city')} /></Field>
        <Field label="UF" required><input aria-label={`${title}: UF`} className={inputCls} maxLength={2} value={value.uf} onChange={(e) => onChange({ ...value, uf: e.target.value.toUpperCase() })} /></Field>
        <Field label="Código IBGE do município"><input aria-label={`${title}: IBGE`} className={inputCls} maxLength={7} value={value.cityIbge} onChange={(e) => onChange({ ...value, cityIbge: onlyDigits(e.target.value) })} /></Field>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
export interface ProductNfeFormProps {
  companies: Company[];
  suppliers: ErpSupplierRecord[];
  catalog: ErpCatalogItem[];
  onCancel: () => void;
  onCreated: (inv: ErpFiscalInvoice) => void | Promise<void>;
  onShowToast: (msg: string) => void;
}

type Party = { kind: 'CLIENTE'; c: Company } | { kind: 'FORNECEDOR'; s: ErpSupplierRecord };

const NAT_OP_SUGGESTIONS = [
  'VENDA DE MERCADORIA',
  'VENDA DE MERCADORIA A CONSUMIDOR FINAL',
  'REMESSA DE BEM POR CONTA DE CONTRATO DE LOCACAO',
  'REMESSA PARA CONSERTO',
  'DEVOLUCAO DE MERCADORIA',
  'REMESSA EM BONIFICACAO',
];

export default function ProductNfeForm({ companies, suppliers, catalog, onCancel, onCreated, onShowToast }: ProductNfeFormProps) {
  const [ctx, setCtx] = useState<NfeContext | null>(null);
  const [ctxError, setCtxError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [submitMenu, setSubmitMenu] = useState(false);
  const [serverIssues, setServerIssues] = useState<Array<{ path: string; message: string }>>([]);

  // Dados gerais
  const start = useMemo(nowBrasilia, []);
  const [natOp, setNatOp] = useState('VENDA DE MERCADORIA');
  const [issueDate, setIssueDate] = useState(start.date);
  const [issueTime, setIssueTime] = useState(start.time);
  const [requestedNumber, setRequestedNumber] = useState('');
  const [tpNF, setTpNF] = useState('1');
  const [indFinal, setIndFinal] = useState('1');
  const [saida, setSaida] = useState('NA_EMISSAO');
  const [exitDateTime, setExitDateTime] = useState('');
  const [finNFe, setFinNFe] = useState('1');
  const [tpEmis, setTpEmis] = useState('1');
  const [idDest, setIdDest] = useState('1');
  const [indPres, setIndPres] = useState('1');
  const [hasRef, setHasRef] = useState(false);
  const [refKeys, setRefKeys] = useState('');

  // Destinatário
  const [partySearch, setPartySearch] = useState('');
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [supplierId, setSupplierId] = useState<string | null>(null);
  const [docType, setDocType] = useState<'CNPJ' | 'CPF'>('CNPJ');
  const [doc, setDoc] = useState('');
  const [name, setName] = useState('');
  const [taxpayerType, setTaxpayerType] = useState('1');
  const [ie, setIe] = useState('');
  const [suframa, setSuframa] = useState('');
  const [im, setIm] = useState('');
  const [addr, setAddr] = useState<PlaceState>(emptyPlace());
  const country = 'Brasil';
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [hasDelivery, setHasDelivery] = useState(false);
  const [delivery, setDelivery] = useState<PlaceState>(emptyPlace());
  const [hasPickup, setHasPickup] = useState(false);
  const [pickup, setPickup] = useState<PlaceState>(emptyPlace());

  // Produtos
  const newItem = (regime?: ErpTaxRegime): ItemRow => ({
    key: Math.random().toString(36).slice(2),
    catalogItemId: null,
    code: '',
    description: '',
    ncm: '',
    cfop: suggestCfop(idDest),
    unit: 'UN',
    quantity: '1,00',
    unitValue: '0,00',
    origin: '0',
    icmsCode: suggestIcmsCode(regime ?? ctx?.taxRegime),
    icmsRatePercent: '',
    ipiRatePercent: '0',
    ean: '',
  });
  const [items, setItems] = useState<ItemRow[]>(() => [newItem()]);
  const [editingItem, setEditingItem] = useState<number | null>(null);

  // Transporte
  const [modFrete, setModFrete] = useState('9');
  const [carrierSearch, setCarrierSearch] = useState('');
  const [carrier, setCarrier] = useState({ supplierId: null as string | null, docType: 'CNPJ' as 'CNPJ' | 'CPF', document: '', name: '', ie: '', address: '', city: '', uf: '' });
  const [volumes, setVolumes] = useState({ quantity: '1', species: '', netWeightKg: '0', grossWeightKg: '0', brand: '', numbering: '' });
  const [hasPayment, setHasPayment] = useState(false);
  const [payment, setPayment] = useState({ tPag: '15', amount: '' });
  const [hasVehicle, setHasVehicle] = useState(false);
  const [vehicle, setVehicle] = useState({ plate: '', uf: '', rntc: '' });
  const [hasRetention, setHasRetention] = useState(false);
  const [retention, setRetention] = useState({ serviceValue: '0', baseValue: '0', ratePercent: '0', cfop: '', cityIbge: '' });

  // Totais / informações adicionais
  const [freight, setFreight] = useState('0,00');
  const [insurance, setInsurance] = useState('0,00');
  const [otherExp, setOtherExp] = useState('0,00');
  const [discount, setDiscount] = useState('0,00');
  const [adjusting, setAdjusting] = useState(false);
  const [adjustedTotal, setAdjustedTotal] = useState<string>('');
  const [showOtherValues, setShowOtherValues] = useState(false);
  const [infCpl, setInfCpl] = useState('');
  const [infFisco, setInfFisco] = useState('');

  useEffect(() => {
    let alive = true;
    fetch('/api/erp/nfe-produtos/context', { cache: 'no-store' })
      .then(async (r) => {
        const j = await r.json().catch(() => null);
        if (!alive) return;
        if (!r.ok) {
          setCtxError(j?.error || `Falha ao carregar (${r.status})`);
          return;
        }
        const c = j.data as NfeContext;
        setCtx(c);
        setInfCpl((prev) => prev || c.additionalInfo || '');
        setItems((prev) => prev.map((it) => (it.description ? it : { ...it, icmsCode: suggestIcmsCode(c.taxRegime) })));
      })
      .catch(() => alive && setCtxError('Falha ao carregar as Configurações Fiscais.'));
    return () => {
      alive = false;
    };
  }, []);

  const taxRegime: ErpTaxRegime = ctx?.taxRegime || 'LUCRO_PRESUMIDO';
  const crt = crtFromRegime(taxRegime);

  const partyResults = useMemo<Party[]>(() => {
    const q = partySearch.trim().toLowerCase();
    if (!q) return [];
    const qd = onlyDigits(q);
    const cs: Party[] = companies
      .filter((c) => c.name.toLowerCase().includes(q) || (qd.length >= 3 && onlyDigits(c.cnpj).includes(qd)))
      .slice(0, 6)
      .map((c) => ({ kind: 'CLIENTE', c }));
    const ss: Party[] = suppliers
      .filter((s) => `${s.name} ${s.legalName}`.toLowerCase().includes(q) || (qd.length >= 3 && onlyDigits(s.cnpj).includes(qd)))
      .slice(0, 4)
      .map((s) => ({ kind: 'FORNECEDOR', s }));
    return [...cs, ...ss];
  }, [partySearch, companies, suppliers]);

  const pickParty = (p: Party) => {
    if (p.kind === 'CLIENTE') {
      const c = p.c;
      const cp = (c.customProperties || {}) as Record<string, unknown>;
      const a = (Array.isArray(cp.addresses) && cp.addresses[0] ? cp.addresses[0] : {}) as Record<string, unknown>;
      const cs = parseCityState(a.cityState);
      const d = onlyDigits(c.cnpj);
      const t: 'CNPJ' | 'CPF' = d.length === 11 ? 'CPF' : 'CNPJ';
      setCompanyId(c.id);
      setSupplierId(null);
      setDocType(t);
      setDoc(formatDoc(d, t));
      setName(String(cp.legalName || c.name || '').slice(0, 60));
      const ieInd = String(cp.ieIndicator || '').toLowerCase();
      const ieVal = String(cp.stateRegistration || '');
      setTaxpayerType(/isento/.test(ieInd) || /^isento$/i.test(ieVal) ? '2' : /não|nao/.test(ieInd) ? '9' : onlyDigits(ieVal) ? '1' : '9');
      setIe(/^isento$/i.test(ieVal) ? '' : ieVal);
      setSuframa(String(cp.suframa || ''));
      setIm(String(cp.municipalRegistration || ''));
      setAddr({
        ...emptyPlace(),
        cep: formatCep(String(a.cep || '')),
        street: String(a.street || ''),
        number: String(a.number || ''),
        complement: String(a.complement || ''),
        district: String(a.neighborhood || ''),
        city: cs.city || String(c.city || ''),
        uf: cs.uf || String(c.state || '').toUpperCase().slice(0, 2),
        cityIbge: onlyDigits(a.ibgeCode).slice(0, 7),
      });
      setPhone(String(cp.phone || cp.mainPhone || cp.telefone || ''));
      setEmail(String(cp.emailFinanceiroNfe || cp.email || '').split(/[;,\s]/)[0] || '');
      setPartySearch(c.name);
    } else {
      const s = p.s;
      const d = onlyDigits(s.cnpj);
      const t: 'CNPJ' | 'CPF' = d.length === 11 ? 'CPF' : 'CNPJ';
      const cs = parseCityState(s.cityState);
      setSupplierId(s.id);
      setCompanyId(null);
      setDocType(t);
      setDoc(formatDoc(d, t));
      setName((s.legalName || s.name).slice(0, 60));
      setAddr({ ...emptyPlace(), city: cs.city, uf: cs.uf });
      setPhone(s.phone || '');
      setEmail(s.email || '');
      setPartySearch(s.name);
    }
  };

  const setItem = (i: number, patch: Partial<ItemRow>) => setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
  const catalogResults = (q: string) => {
    const s = q.trim().toLowerCase();
    if (!s) return [];
    return catalog.filter((c) => c.isActive !== false && `${c.name} ${c.gestaoClickCode}`.toLowerCase().includes(s)).slice(0, 8);
  };
  const pickCatalog = (i: number, c: ErpCatalogItem) => {
    const ncm = onlyDigits(c.ncmOrLc116);
    const expected = suggestCfop(idDest);
    const cat = onlyDigits(c.cfopDefault);
    setItem(i, {
      catalogItemId: c.id,
      code: c.gestaoClickCode,
      description: c.name.slice(0, 120),
      ncm: ncm.length === 8 ? ncm : '',
      cfop: cat.length === 4 && cat.charAt(0) === expected.charAt(0) ? cat : expected,
      unit: (c.unitOfMeasure || 'UN').slice(0, 6),
      unitValue: fmtNum(Number(c.saleOrSetupPrice || 0)),
      ean: c.barcodeEan && /^(\d{8}|\d{12,14})$/.test(c.barcodeEan) ? c.barcodeEan : '',
    });
  };
  useEffect(() => {
    // Destino mudou: atualiza o CFOP sugerido dos itens que ainda seguem a sugestão
    setItems((prev) => prev.map((it) => (/^[567]102$/.test(it.cfop) ? { ...it, cfop: suggestCfop(idDest) } : it)));
  }, [idDest]);

  // Totais (erp-tax-engine, regime configurado)
  const totals = computeProductNfeTotals(
    {
      items: items.map((it) => ({
        quantity: parseNum(it.quantity),
        unitValue: parseNum(it.unitValue),
        icmsCode: it.icmsCode,
        ...(it.icmsRatePercent.trim() ? { icmsRatePercent: parseNum(it.icmsRatePercent) } : {}),
        ipiRatePercent: parseNum(it.ipiRatePercent),
      })),
      transport: { freightValue: parseNum(freight), insuranceValue: parseNum(insurance), otherExpenses: parseNum(otherExp) },
      totals: { discountValue: parseNum(discount), adjustedTotal: adjustedTotal.trim() ? parseNum(adjustedTotal) : null },
    },
    taxRegime
  );

  const docValid = docType === 'CNPJ' ? isValidCnpjDv(doc) : isValidCpfDv(doc);
  const filledItems = items.filter((it) => it.description.trim() || parseNum(it.unitValue) > 0);

  const buildPayload = () => ({
    general: {
      natOp: natOp.trim(),
      issueDateTime: `${issueDate}T${issueTime}`,
      ...(ctx?.serie ? { serie: ctx.serie } : {}),
      number: requestedNumber.trim() ? Number(onlyDigits(requestedNumber)) : null,
      tpNF,
      indFinal,
      saida,
      exitDateTime: saida === 'DATA_INFORMADA' ? exitDateTime : '',
      finNFe,
      tpEmis,
      idDest,
      indPres,
      hasReferencedNfe: hasRef,
      referencedKeys: hasRef ? refKeys.split(/[\s,;]+/).map(onlyDigits).filter(Boolean) : [],
    },
    recipient: {
      companyId,
      supplierId,
      documentType: docType,
      document: doc,
      name: name.trim(),
      taxpayerType,
      ie,
      suframa,
      im,
      address: { cep: addr.cep, street: addr.street, number: addr.number, complement: addr.complement, district: addr.district, city: addr.city, uf: addr.uf, cityIbge: addr.cityIbge },
      country,
      phone,
      email: email.trim(),
      hasDeliveryAddress: hasDelivery,
      ...(hasDelivery ? { deliveryAddress: delivery } : {}),
      hasPickupAddress: hasPickup,
      ...(hasPickup ? { pickupAddress: pickup } : {}),
    },
    items: filledItems.map((it) => ({
      catalogItemId: it.catalogItemId,
      code: it.code,
      description: it.description.trim(),
      ncm: onlyDigits(it.ncm),
      cfop: onlyDigits(it.cfop),
      unit: it.unit || 'UN',
      quantity: parseNum(it.quantity),
      unitValue: parseNum(it.unitValue),
      origin: it.origin,
      icmsCode: it.icmsCode,
      ...(it.icmsRatePercent.trim() ? { icmsRatePercent: parseNum(it.icmsRatePercent) } : {}),
      ipiRatePercent: parseNum(it.ipiRatePercent),
      ean: it.ean,
    })),
    transport: {
      modFrete,
      ...(modFrete !== '9'
        ? { carrier: { supplierId: carrier.supplierId, document: carrier.document, name: carrier.name, ie: carrier.ie, address: carrier.address, city: carrier.city, uf: carrier.uf } }
        : {}),
      volumes: {
        quantity: Math.round(parseNum(volumes.quantity)),
        species: volumes.species,
        netWeightKg: parseNum(volumes.netWeightKg),
        grossWeightKg: parseNum(volumes.grossWeightKg),
        brand: volumes.brand,
        numbering: volumes.numbering,
      },
      freightValue: parseNum(freight),
      insuranceValue: parseNum(insurance),
      otherExpenses: parseNum(otherExp),
      hasPayment,
      ...(hasPayment ? { payment: { tPag: payment.tPag, ...(payment.amount.trim() ? { amount: parseNum(payment.amount) } : {}) } } : {}),
      hasVehicle,
      ...(hasVehicle ? { vehicle: { plate: vehicle.plate.replace(/[^A-Za-z0-9]/g, ''), uf: vehicle.uf, rntc: vehicle.rntc } } : {}),
      hasIcmsRetention: hasRetention,
      ...(hasRetention
        ? {
            icmsRetention: {
              serviceValue: parseNum(retention.serviceValue),
              baseValue: parseNum(retention.baseValue),
              ratePercent: parseNum(retention.ratePercent),
              cfop: onlyDigits(retention.cfop),
              cityIbge: onlyDigits(retention.cityIbge),
            },
          }
        : {}),
    },
    totals: { discountValue: parseNum(discount), adjustedTotal: adjustedTotal.trim() ? parseNum(adjustedTotal) : null },
    additionalInfo: { complementary: infCpl, fisco: infFisco },
  });

  const liveWarnings = ctx
    ? productNfeWarnings(
        {
          general: { idDest, tpNF } as never,
          recipient: { address: { uf: addr.uf, cityIbge: addr.cityIbge } } as never,
          items: filledItems.map((it) => ({ icmsCode: it.icmsCode, cfop: onlyDigits(it.cfop) })) as never,
        },
        { taxRegime, emitterUf: ctx.emitterUf, additionalInfo: infCpl }
      )
    : [];

  const submit = async () => {
    setServerIssues([]);
    const body = buildPayload();
    if (!body.items.length) return onShowToast('Inclua ao menos um produto.');
    if (!docValid) return onShowToast(`${docType} do destinatário inválido (dígito verificador).`);
    setSaving(true);
    try {
      const res = await fetch('/api/erp/nfe-produtos', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const j = (await res.json().catch(() => null)) as { data?: ErpFiscalInvoice; error?: string; issues?: Array<{ path: string; message: string }>; warnings?: string[] } | null;
      if (!res.ok || !j?.data) {
        if (j?.issues) setServerIssues(j.issues);
        onShowToast(j?.error || `Não foi possível cadastrar a NF-e (${res.status}).`);
        return;
      }
      const pn = j.data.productNfe;
      onShowToast(
        `NF-e ${pn?.nNF} - série ${pn?.serie} cadastrada como RASCUNHO em ${pn?.environment === 'PRODUCAO' ? 'PRODUÇÃO' : 'HOMOLOGAÇÃO'}.${j.warnings?.length ? ` ${j.warnings.length} aviso(s).` : ''}`
      );
      await onCreated(j.data);
    } catch (e) {
      onShowToast(e instanceof Error ? e.message : 'Falha ao cadastrar a NF-e.');
    } finally {
      setSaving(false);
    }
  };

  const isHomolog = ctx?.environment !== 'PRODUCAO';
  const numberLabel = ctx ? `${requestedNumber.trim() ? onlyDigits(requestedNumber) : ctx.nextNumber} - série ${ctx.serie}` : 'carregando…';
  const carrierResults = useMemo(() => {
    const q = carrierSearch.trim().toLowerCase();
    if (!q) return [];
    const list = suppliers.filter((s) => s.supplierType === 'TRANSPORTADORA');
    return (list.length ? list : suppliers).filter((s) => `${s.name} ${s.legalName} ${s.cnpj}`.toLowerCase().includes(q));
  }, [carrierSearch, suppliers]);
  const natOpResults = NAT_OP_SUGGESTIONS.filter((n) => n.includes(natOp.toUpperCase()) && n !== natOp.toUpperCase());

  return (
    <div className="space-y-3" data-testid="product-nfe-form">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-slate-800">Adicionar NF-e</h2>
        <p className="text-[11px] text-slate-500 flex items-center gap-1">
          <Home className="w-3 h-3" /> Início <span>›</span> NF-e <span>›</span> <strong className="text-slate-700">Adicionar</strong>
        </p>
      </div>

      {ctxError && <p className="text-xs text-rose-600 bg-rose-50 border border-rose-200 rounded p-2">{ctxError}</p>}
      {ctx && (
        <div className={`text-[11px] rounded border p-2 flex items-start gap-2 ${isHomolog ? 'bg-amber-50 border-amber-200 text-amber-900' : 'bg-emerald-50 border-emerald-200 text-emerald-900'}`} data-testid="product-nfe-env-banner">
          {isHomolog ? <FlaskConical className="w-4 h-4 shrink-0" /> : <AlertTriangle className="w-4 h-4 shrink-0" />}
          <span>
            Ambiente da NF-e: <strong>{isHomolog ? 'HOMOLOGAÇÃO' : 'PRODUÇÃO'}</strong> (Configurações fiscais). A nota é gravada como <strong>rascunho</strong>, sem envio à SEFAZ.
            {isHomolog && <> No XML, o destinatário sai como “{HOMOLOGATION_RECIPIENT_NAME}”.</>} Regime configurado: <strong>{REGIME_LABELS[taxRegime]}</strong> (CRT {crt}), não alterado aqui.
          </span>
        </div>
      )}

      {/* 1. DADOS GERAIS */}
      <Section icon={<FileText className="w-4 h-4" />} lead="Informe os" strong="dados gerais" tail="da NF-e" subtitle="A natureza da operação preencherá o título e as opções que precisam logo abaixo.">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <Field label="Natureza de operação" required className="md:col-span-2">
            <SearchBox ariaLabel="Natureza de operação" value={natOp} onText={(v) => setNatOp(v.toUpperCase().slice(0, 60))} items={natOpResults} render={(n) => ({ key: n, title: n })} onPick={(n) => setNatOp(n)} />
          </Field>
          <Field label="Data de emissão" required>
            <div className="relative">
              <input type="date" aria-label="Data de emissão" className={inputCls} value={issueDate} onChange={(e) => setIssueDate(e.target.value)} />
              <Calendar className="w-3.5 h-3.5 absolute right-2 top-2.5 text-slate-400 pointer-events-none" />
            </div>
          </Field>
          <Field label="Hora de emissão" required>
            <div className="relative">
              <input type="time" aria-label="Hora de emissão" className={inputCls} value={issueTime} onChange={(e) => setIssueTime(e.target.value)} />
              <Clock className="w-3.5 h-3.5 absolute right-2 top-2.5 text-slate-400 pointer-events-none" />
            </div>
          </Field>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <Chip icon={<Hash className="w-3.5 h-3.5" />} label="Número e série" value={numberLabel}>
            <input
              autoFocus
              aria-label="Número da NF-e"
              placeholder={ctx ? String(ctx.nextNumber) : ''}
              className="w-full text-xs font-bold border-0 p-0 bg-transparent focus:outline-none"
              value={requestedNumber}
              onChange={(e) => setRequestedNumber(onlyDigits(e.target.value))}
            />
          </Chip>
          <Chip icon={<ArrowRightLeft className="w-3.5 h-3.5" />} label="Tipo" value={tpNF} options={NFE_TIPO_OPTIONS} onChange={setTpNF} />
          <Chip icon={<UserCheck className="w-3.5 h-3.5" />} label="Consumidor final" value={indFinal} options={NFE_CONSUMIDOR_FINAL_OPTIONS} onChange={setIndFinal} />
          <Chip icon={<LogOut className="w-3.5 h-3.5" />} label="Saída" value={saida} options={NFE_SAIDA_OPTIONS} onChange={setSaida} />
          <Chip icon={<Flag className="w-3.5 h-3.5" />} label="Finalidade" value={finNFe} options={NFE_FINALIDADE_OPTIONS} onChange={setFinNFe} />
          <Chip icon={<Send className="w-3.5 h-3.5" />} label="Forma de emissão" value={tpEmis} options={NFE_FORMA_EMISSAO_OPTIONS} onChange={setTpEmis} />
          <Chip icon={<MapPin className="w-3.5 h-3.5" />} label="Destino" value={idDest} options={NFE_DESTINO_OPTIONS} onChange={setIdDest} />
          <Chip icon={<Store className="w-3.5 h-3.5" />} label="Atendimento" value={indPres} options={NFE_ATENDIMENTO_OPTIONS} onChange={setIndPres} />
        </div>
        {saida === 'DATA_INFORMADA' && (
          <Field label="Data e hora de saída" required className="max-w-xs">
            <input type="datetime-local" aria-label="Data e hora de saída" className={inputCls} value={exitDateTime} onChange={(e) => setExitDateTime(e.target.value)} />
          </Field>
        )}
        <Toggle checked={hasRef} onChange={setHasRef} label="Possui NF-referenciada" icon={<FileText className="w-3.5 h-3.5" />} />
        {hasRef && (
          <Field label="Chaves de acesso referenciadas (44 dígitos, separadas por vírgula ou linha)">
            <textarea aria-label="Chaves referenciadas" className={`${inputCls} h-16 font-mono`} value={refKeys} onChange={(e) => setRefKeys(e.target.value)} />
          </Field>
        )}
      </Section>

      {/* 2. DESTINATÁRIO */}
      <Section icon={<User className="w-4 h-4" />} lead="Escolha o" strong="destinatário" tail="da nota" subtitle="Busque um cliente ou fornecedor, ou preencha os dados à mão.">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Field label="Cliente/Fornecedor">
            <SearchBox
              ariaLabel="Cliente/Fornecedor"
              value={partySearch}
              onText={setPartySearch}
              items={partyResults}
              render={(p) =>
                p.kind === 'CLIENTE'
                  ? { key: `c-${p.c.id}`, title: p.c.name, subtitle: `Cliente • ${p.c.cnpj || 'sem documento'}` }
                  : { key: `s-${p.s.id}`, title: p.s.name, subtitle: `${p.s.supplierType === 'TRANSPORTADORA' ? 'Transportadora' : 'Fornecedor'} • ${p.s.cnpj}` }
              }
              onPick={pickParty}
            />
          </Field>
          <Field label="Tipo de documento" required>
            <select
              aria-label="Tipo de documento"
              className={inputCls}
              value={docType}
              onChange={(e) => {
                const t = e.target.value as 'CNPJ' | 'CPF';
                setDocType(t);
                setDoc(formatDoc(doc, t));
              }}
            >
              <option value="CNPJ">CNPJ</option>
              <option value="CPF">CPF</option>
            </select>
          </Field>
          <Field label={docType} required>
            <input aria-label={docType} className={`${inputCls} ${doc && !docValid ? 'border-rose-400' : ''}`} value={doc} onChange={(e) => setDoc(formatDoc(e.target.value, docType))} />
            {doc && !docValid && <p className="text-[10px] text-rose-600 mt-0.5">{docType} inválido (dígito verificador).</p>}
          </Field>
          <Field label="Razão social" required>
            <input aria-label="Razão social" className={inputCls} maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Tipo de contribuinte" required>
            <select aria-label="Tipo de contribuinte" className={inputCls} value={taxpayerType} onChange={(e) => setTaxpayerType(e.target.value)}>
              {NFE_CONTRIBUINTE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Inscr. estadual" required={taxpayerType === '1'}>
            <input aria-label="Inscrição estadual" className={inputCls} value={ie} onChange={(e) => setIe(e.target.value)} />
          </Field>
          <Field label="Inscr. SUFRAMA">
            <input aria-label="Inscrição SUFRAMA" className={inputCls} value={suframa} onChange={(e) => setSuframa(e.target.value)} />
          </Field>
          <Field label="Inscr. municipal">
            <input aria-label="Inscrição municipal" className={inputCls} value={im} onChange={(e) => setIm(e.target.value)} />
          </Field>
          <Field label="CEP">
            <input aria-label="CEP" className={inputCls} value={addr.cep} onChange={(e) => setAddr({ ...addr, cep: formatCep(e.target.value) })} />
          </Field>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <Field label="Logradouro" required><input aria-label="Logradouro" className={inputCls} value={addr.street} onChange={(e) => setAddr({ ...addr, street: e.target.value })} /></Field>
          <Field label="Número" required><input aria-label="Número" className={inputCls} value={addr.number} onChange={(e) => setAddr({ ...addr, number: e.target.value })} /></Field>
          <Field label="Complemento"><input aria-label="Complemento" className={inputCls} value={addr.complement} onChange={(e) => setAddr({ ...addr, complement: e.target.value })} /></Field>
          <Field label="Bairro" required><input aria-label="Bairro" className={inputCls} value={addr.district} onChange={(e) => setAddr({ ...addr, district: e.target.value })} /></Field>
          <Field label="Cidade/UF" required>
            <div className="grid grid-cols-[1fr_56px_80px] gap-1">
              <input aria-label="Cidade" className={inputCls} placeholder="Cidade" value={addr.city} onChange={(e) => setAddr({ ...addr, city: e.target.value })} />
              <input aria-label="UF" className={inputCls} placeholder="UF" maxLength={2} value={addr.uf} onChange={(e) => setAddr({ ...addr, uf: e.target.value.toUpperCase() })} />
              <input aria-label="Código IBGE" className={inputCls} placeholder="IBGE" maxLength={7} title="Código IBGE do município (cMun)" value={addr.cityIbge} onChange={(e) => setAddr({ ...addr, cityIbge: onlyDigits(e.target.value) })} />
            </div>
          </Field>
          <Field label="País" required>
            <select aria-label="País" className={inputCls} value={country} disabled>
              <option>Brasil</option>
            </select>
          </Field>
          <Field label="Telefone"><input aria-label="Telefone" className={inputCls} value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
          <Field label="E-mail"><input aria-label="E-mail" type="email" className={inputCls} value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        </div>
        <div className="flex items-center gap-4 flex-wrap">
          <Toggle checked={hasDelivery} onChange={setHasDelivery} label="Informar endereço de entrega" icon={<MapPin className="w-3.5 h-3.5" />} />
          <Toggle checked={hasPickup} onChange={setHasPickup} label="Informar endereço de retirada" icon={<Home className="w-3.5 h-3.5" />} />
        </div>
        {hasDelivery && <PlaceFields title="Endereço de entrega" value={delivery} onChange={setDelivery} />}
        {hasPickup && <PlaceFields title="Endereço de retirada" value={pickup} onChange={setPickup} />}
      </Section>

      {/* 3. PRODUTOS */}
      <Section icon={<Package className="w-4 h-4" />} lead="Adicione os" strong="produtos" tail="da nota" subtitle="Produtos da nota: o lápis abre a tributação de cada item.">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-slate-600 bg-slate-50">
              <tr>
                <th className="p-2 text-left w-6" />
                <th className="p-2 text-left">Descrição<span className="text-rose-600">*</span></th>
                <th className="p-2 text-right w-32">Quantidade<span className="text-rose-600">*</span></th>
                <th className="p-2 text-right w-36">Valor<span className="text-rose-600">*</span></th>
                <th className="p-2 text-right w-36">Subtotal<span className="text-rose-600">*</span></th>
                <th className="p-2 text-center w-20">Ações</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it, i) => (
                <tr key={it.key} className="border-t border-slate-100 align-top">
                  <td className="p-2 font-bold text-slate-500">{i + 1}</td>
                  <td className="p-2">
                    <SearchBox
                      ariaLabel={`Descrição do item ${i + 1}`}
                      value={it.description}
                      onText={(v) => setItem(i, { description: v, catalogItemId: null })}
                      items={catalogResults(it.description)}
                      render={(c) => ({ key: c.id, title: c.name, subtitle: `${c.gestaoClickCode} • NCM ${c.ncmOrLc116} • ${formatBRL(c.saleOrSetupPrice)}` })}
                      onPick={(c) => pickCatalog(i, c)}
                      placeholder=""
                    />
                    <p className="text-[9px] text-slate-500 mt-0.5">
                      NCM {it.ncm || '—'} • CFOP {it.cfop || '—'} • {crt === '1' ? 'CSOSN' : 'CST'} {it.icmsCode} • {it.unit}
                    </p>
                  </td>
                  <td className="p-2"><input aria-label={`Quantidade do item ${i + 1}`} className={`${inputCls} text-right`} value={it.quantity} onChange={(e) => setItem(i, { quantity: e.target.value })} /></td>
                  <td className="p-2"><input aria-label={`Valor do item ${i + 1}`} className={`${inputCls} text-right`} value={it.unitValue} onChange={(e) => setItem(i, { unitValue: e.target.value })} /></td>
                  <td className="p-2"><input aria-label={`Subtotal do item ${i + 1}`} disabled className={`${inputCls} text-right bg-slate-100`} value={fmtNum(totals.items[i]?.vProd || 0)} /></td>
                  <td className="p-2 text-center whitespace-nowrap">
                    <button type="button" aria-label={`Editar item ${i + 1}`} onClick={() => setEditingItem(i)} className="p-1 text-slate-600 hover:text-slate-900">
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      aria-label={`Excluir item ${i + 1}`}
                      onClick={() => setItems((prev) => (prev.length === 1 ? [newItem(taxRegime)] : prev.filter((_, idx) => idx !== i)))}
                      className="p-1 text-rose-600 hover:text-rose-800"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button type="button" onClick={() => setItems((prev) => [...prev, newItem(taxRegime)])} className="inline-flex items-center gap-1 px-3 py-1.5 rounded border text-xs font-bold" style={{ borderColor: NAVY, color: NAVY }}>
          <Plus className="w-3.5 h-3.5" /> Adicionar produto
        </button>
      </Section>

      {/* 4. TRANSPORTE */}
      <Section icon={<Truck className="w-4 h-4" />} lead="Informe o" strong="transporte" tail="da mercadoria" subtitle="Quem paga o frete decide o resto do card.">
        <p className={labelCls}>
          Quem paga o frete <span className="text-rose-600">*</span>
        </p>
        <div className="grid grid-cols-2 md:grid-cols-6 gap-2" role="radiogroup" aria-label="Quem paga o frete">
          {NFE_FRETE_OPTIONS.map((o) => (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={modFrete === o.value}
              onClick={() => setModFrete(o.value)}
              className={`text-left border rounded px-3 py-2 ${modFrete === o.value ? 'border-[#1e3a6e] ring-1 ring-[#1e3a6e] bg-white' : 'border-slate-200 bg-slate-50 hover:bg-white'}`}
            >
              <p className="text-xs font-bold text-slate-800">{o.label}</p>
              <p className="text-[9px] text-slate-500">{o.hint}</p>
            </button>
          ))}
        </div>
        {modFrete !== '9' && (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <Field label="Transportadora">
              <SearchBox
                ariaLabel="Transportadora"
                value={carrierSearch}
                onText={setCarrierSearch}
                items={carrierResults}
                render={(s) => ({ key: s.id, title: s.name, subtitle: s.cnpj })}
                onPick={(s) => {
                  const d = onlyDigits(s.cnpj);
                  const t: 'CNPJ' | 'CPF' = d.length === 11 ? 'CPF' : 'CNPJ';
                  const cs = parseCityState(s.cityState);
                  setCarrier({ supplierId: s.id, docType: t, document: formatDoc(d, t), name: (s.legalName || s.name).slice(0, 60), ie: '', address: '', city: cs.city, uf: cs.uf });
                  setCarrierSearch(s.name);
                }}
              />
            </Field>
            <Field label="Tipo de documento">
              <select
                aria-label="Tipo de documento da transportadora"
                className={inputCls}
                value={carrier.docType}
                onChange={(e) => setCarrier({ ...carrier, docType: e.target.value as 'CNPJ' | 'CPF', document: formatDoc(carrier.document, e.target.value as 'CNPJ' | 'CPF') })}
              >
                <option value="CNPJ">CNPJ</option>
                <option value="CPF">CPF</option>
              </select>
            </Field>
            <Field label={carrier.docType}><input aria-label="Documento da transportadora" className={inputCls} value={carrier.document} onChange={(e) => setCarrier({ ...carrier, document: formatDoc(e.target.value, carrier.docType) })} /></Field>
            <Field label="Razão social"><input aria-label="Razão social da transportadora" className={inputCls} maxLength={60} value={carrier.name} onChange={(e) => setCarrier({ ...carrier, name: e.target.value })} /></Field>
            <Field label="Inscr. estadual"><input aria-label="IE da transportadora" className={inputCls} value={carrier.ie} onChange={(e) => setCarrier({ ...carrier, ie: e.target.value })} /></Field>
            <Field label="Endereço completo" className="md:col-span-2"><input aria-label="Endereço da transportadora" className={inputCls} maxLength={60} value={carrier.address} onChange={(e) => setCarrier({ ...carrier, address: e.target.value })} /></Field>
            <Field label="Cidade/UF">
              <div className="grid grid-cols-[1fr_56px] gap-1">
                <input aria-label="Cidade da transportadora" className={inputCls} placeholder="Cidade" value={carrier.city} onChange={(e) => setCarrier({ ...carrier, city: e.target.value })} />
                <input aria-label="UF da transportadora" className={inputCls} placeholder="UF" maxLength={2} value={carrier.uf} onChange={(e) => setCarrier({ ...carrier, uf: e.target.value.toUpperCase() })} />
              </div>
            </Field>
          </div>
        )}
        <p className="text-[10px] font-extrabold uppercase tracking-wide text-slate-500">Volumes transportados</p>
        <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
          {(
            [
              ['quantity', 'Volumes', <Boxes key="i" className="w-3.5 h-3.5" />],
              ['species', 'Espécie', <Tag key="i" className="w-3.5 h-3.5" />],
              ['netWeightKg', 'Peso líquido (kg)', <Scale key="i" className="w-3.5 h-3.5" />],
              ['grossWeightKg', 'Peso bruto (kg)', <Scale key="i" className="w-3.5 h-3.5" />],
              ['brand', 'Marca', <Tag key="i" className="w-3.5 h-3.5" />],
              ['numbering', 'Numeração', <ListOrdered key="i" className="w-3.5 h-3.5" />],
            ] as const
          ).map(([k, label, icon]) => (
            <Chip key={k} icon={icon} label={label} value={String(volumes[k] || '') || 'Não informada'}>
              <input
                autoFocus
                aria-label={label}
                className="w-full text-xs font-bold border-0 p-0 bg-transparent focus:outline-none"
                value={volumes[k]}
                onChange={(e) => setVolumes({ ...volumes, [k]: e.target.value })}
              />
            </Chip>
          ))}
        </div>
        <div className="flex items-center gap-4 flex-wrap">
          <Toggle checked={hasPayment} onChange={setHasPayment} label="Informar forma de pagamento" icon={<DollarSign className="w-3.5 h-3.5" />} />
          <Toggle checked={hasVehicle} onChange={setHasVehicle} label="Informar veículo" icon={<Truck className="w-3.5 h-3.5" />} />
          <Toggle checked={hasRetention} onChange={setHasRetention} label="Informar retenção de ICMS" icon={<Calculator className="w-3.5 h-3.5" />} />
        </div>
        {hasPayment && (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <Field label="Forma de pagamento">
              <select aria-label="Forma de pagamento" className={inputCls} value={payment.tPag} onChange={(e) => setPayment({ ...payment, tPag: e.target.value })}>
                {NFE_PAGAMENTO_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Valor pago (vazio = total da NF)"><input aria-label="Valor pago" className={inputCls} value={payment.amount} onChange={(e) => setPayment({ ...payment, amount: e.target.value })} /></Field>
          </div>
        )}
        {hasVehicle && (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <Field label="Placa"><input aria-label="Placa" className={inputCls} maxLength={8} value={vehicle.plate} onChange={(e) => setVehicle({ ...vehicle, plate: e.target.value.toUpperCase() })} /></Field>
            <Field label="UF"><input aria-label="UF do veículo" className={inputCls} maxLength={2} value={vehicle.uf} onChange={(e) => setVehicle({ ...vehicle, uf: e.target.value.toUpperCase() })} /></Field>
            <Field label="RNTC"><input aria-label="RNTC" className={inputCls} value={vehicle.rntc} onChange={(e) => setVehicle({ ...vehicle, rntc: e.target.value })} /></Field>
          </div>
        )}
        {hasRetention && (
          <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
            <Field label="Valor do serviço"><input aria-label="Valor do serviço" className={inputCls} value={retention.serviceValue} onChange={(e) => setRetention({ ...retention, serviceValue: e.target.value })} /></Field>
            <Field label="BC da retenção"><input aria-label="BC da retenção" className={inputCls} value={retention.baseValue} onChange={(e) => setRetention({ ...retention, baseValue: e.target.value })} /></Field>
            <Field label="Alíquota (%)"><input aria-label="Alíquota da retenção" className={inputCls} value={retention.ratePercent} onChange={(e) => setRetention({ ...retention, ratePercent: e.target.value })} /></Field>
            <Field label="CFOP"><input aria-label="CFOP da retenção" className={inputCls} maxLength={4} value={retention.cfop} onChange={(e) => setRetention({ ...retention, cfop: onlyDigits(e.target.value) })} /></Field>
            <Field label="Município do fato gerador (IBGE)"><input aria-label="Município da retenção" className={inputCls} maxLength={7} value={retention.cityIbge} onChange={(e) => setRetention({ ...retention, cityIbge: onlyDigits(e.target.value) })} /></Field>
          </div>
        )}
      </Section>

      {/* 5. TOTAIS */}
      <Section icon={<Calculator className="w-4 h-4" />} lead="Confira os" strong="totais" tail="da nota" subtitle="Calculados pelo motor fiscal do ERP com o regime configurado.">
        <div className="grid grid-cols-1 md:grid-cols-[minmax(220px,1fr)_3fr] gap-3">
          <div className="border border-slate-200 rounded p-3 bg-slate-50">
            <p className="text-[9px] font-bold text-slate-500">TOTAL DA NF</p>
            <p className="text-xl font-extrabold text-slate-800" data-testid="product-nfe-total">R$ {fmtNum(totals.vNF)}</p>
            {adjusting ? (
              <div className="flex items-center gap-1 mt-2">
                <input autoFocus aria-label="Total desejado" className={`${inputCls} w-28`} placeholder={fmtNum(totals.vNFBeforeAdjustment)} value={adjustedTotal} onChange={(e) => setAdjustedTotal(e.target.value)} />
                <button type="button" onClick={() => setAdjusting(false)} className="px-2 py-1 rounded text-white text-[10px] font-bold" style={{ backgroundColor: NAVY }}>
                  OK
                </button>
                <button
                  type="button"
                  aria-label="Desfazer ajuste"
                  onClick={() => {
                    setAdjustedTotal('');
                    setAdjusting(false);
                  }}
                  className="p-1 text-slate-500"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2 mt-2">
                <button type="button" onClick={() => setAdjusting(true)} className="inline-flex items-center gap-1 px-2 py-1 rounded border border-slate-300 bg-white text-[10px] font-bold">
                  <Pencil className="w-3 h-3" /> Ajustar total
                </button>
                <button type="button" onClick={() => setShowOtherValues((v) => !v)} className="text-[10px] font-semibold underline" style={{ color: NAVY }}>
                  Ver os outros valores
                </button>
              </div>
            )}
            {adjustedTotal.trim() && (
              <p className="text-[9px] text-slate-500 mt-1">
                Ajuste aplicado como {totals.vNF < totals.vNFBeforeAdjustment ? 'desconto' : 'outras despesas'} (antes: {formatBRL(totals.vNFBeforeAdjustment)}).
              </p>
            )}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            {(
              [
                ['Total bruto produtos', totals.vProd],
                ['Total BC ICMS', totals.vBC],
                ['Total ICMS', totals.vICMS],
                ['Total de IPI', totals.vIPI],
                ['Total de PIS', totals.vPIS],
                ['Total de COFINS', totals.vCOFINS],
              ] as const
            ).map(([label, v]) => (
              <div key={label} className="border border-slate-200 rounded px-3 py-2 bg-white">
                <p className="text-[9px] text-slate-500">{label}</p>
                <p className="text-xs font-bold text-slate-800">{fmtNum(v)}</p>
              </div>
            ))}
          </div>
        </div>
        {showOtherValues && (
          <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
            <Field label="Frete"><input aria-label="Frete" className={inputCls} value={freight} onChange={(e) => setFreight(e.target.value)} /></Field>
            <Field label="Seguro"><input aria-label="Seguro" className={inputCls} value={insurance} onChange={(e) => setInsurance(e.target.value)} /></Field>
            <Field label="Outras despesas"><input aria-label="Outras despesas" className={inputCls} value={otherExp} onChange={(e) => setOtherExp(e.target.value)} /></Field>
            <Field label="Desconto"><input aria-label="Desconto" className={inputCls} value={discount} onChange={(e) => setDiscount(e.target.value)} /></Field>
            <div className="text-[10px] text-slate-600 self-end">
              Tributos aproximados (Lei 12.741): <strong>{formatBRL(totals.vTotTrib)}</strong>
            </div>
          </div>
        )}
        {crt === '1' && <p className="text-[10px] text-slate-500">Simples Nacional: com CSOSN 102/103/300/400 a NF-e não destaca ICMS, PIS e COFINS (recolhidos no DAS).</p>}
        {liveWarnings.length > 0 && (
          <ul className="text-[10px] text-amber-900 bg-amber-50 border border-amber-200 rounded p-2 space-y-0.5" data-testid="product-nfe-warnings">
            {liveWarnings.map((w) => (
              <li key={w} className="flex items-start gap-1">
                <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" /> {w}
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* 6. INFORMAÇÕES ADICIONAIS */}
      <Section icon={<Info className="w-4 h-4" />} lead="Insira as" strong="informações adicionais" tail="da nota" subtitle="Textos impressos no DANFE e enviados à Sefaz junto com a nota.">
        <Field label="Informações complementares">
          <textarea aria-label="Informações complementares" className={`${inputCls} h-20`} maxLength={5000} value={infCpl} onChange={(e) => setInfCpl(e.target.value)} />
          <p className="text-[10px] text-slate-500 mt-1">O valor aproximado dos tributos é acrescentado automaticamente.</p>
        </Field>
        <Field label="Informações de interesse do fisco">
          <textarea aria-label="Informações de interesse do fisco" className={`${inputCls} h-12`} maxLength={2000} value={infFisco} onChange={(e) => setInfFisco(e.target.value)} />
        </Field>
      </Section>

      {serverIssues.length > 0 && (
        <ul className="text-[11px] text-rose-700 bg-rose-50 border border-rose-200 rounded p-2" data-testid="product-nfe-issues">
          {serverIssues.map((i) => (
            <li key={`${i.path}-${i.message}`}>
              • {i.path}: {i.message}
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-center justify-between">
        <button type="button" onClick={onCancel} className="px-4 py-2 rounded border border-slate-300 bg-white text-xs font-bold text-slate-700">
          Cancelar
        </button>
        <div className="relative inline-flex">
          <button type="button" disabled={saving || !ctx} onClick={() => void submit()} className="px-4 py-2 rounded-l text-white text-xs font-bold disabled:opacity-60" style={{ backgroundColor: NAVY }}>
            {saving ? 'Cadastrando…' : 'Cadastrar'}
          </button>
          <button
            type="button"
            aria-label="Mais opções de cadastro"
            aria-haspopup="menu"
            aria-expanded={submitMenu}
            onClick={() => setSubmitMenu((v) => !v)}
            className="px-2 py-2 rounded-r text-white border-l border-white/30"
            style={{ backgroundColor: NAVY }}
          >
            <ChevronDown className="w-3.5 h-3.5" />
          </button>
          {submitMenu && (
            <div role="menu" className="absolute right-0 bottom-full mb-1 w-64 bg-white border border-slate-200 rounded shadow-lg py-1 text-xs">
              <button type="button" role="menuitem" disabled aria-disabled title={PRODUCT_NFE_SEFAZ_PENDING_HINT} className="w-full text-left px-3 py-1.5 text-slate-400 cursor-not-allowed">
                Cadastrar e emitir <span className="block text-[9px] italic">{PRODUCT_NFE_SEFAZ_PENDING_HINT}</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {editingItem !== null && items[editingItem] && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={`Editar item ${editingItem + 1}`}>
          <div className="bg-white rounded shadow-xl w-full max-w-2xl">
            <div className="flex items-center justify-between px-4 py-2 border-b">
              <p className="text-sm font-bold">Item {editingItem + 1}: tributação</p>
              <button type="button" aria-label="Fechar" onClick={() => setEditingItem(null)}>
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4 grid grid-cols-1 md:grid-cols-3 gap-3">
              <Field label="Código"><input aria-label="Código do item" className={inputCls} value={items[editingItem].code} onChange={(e) => setItem(editingItem, { code: e.target.value })} /></Field>
              <Field label="Descrição" required className="md:col-span-2"><input aria-label="Descrição do item" className={inputCls} maxLength={120} value={items[editingItem].description} onChange={(e) => setItem(editingItem, { description: e.target.value })} /></Field>
              <Field label="NCM" required><input aria-label="NCM" className={inputCls} maxLength={8} value={items[editingItem].ncm} onChange={(e) => setItem(editingItem, { ncm: onlyDigits(e.target.value) })} /></Field>
              <Field label="CFOP" required><input aria-label="CFOP" className={inputCls} maxLength={4} value={items[editingItem].cfop} onChange={(e) => setItem(editingItem, { cfop: onlyDigits(e.target.value) })} /></Field>
              <Field label="Unidade" required><input aria-label="Unidade" className={inputCls} maxLength={6} value={items[editingItem].unit} onChange={(e) => setItem(editingItem, { unit: e.target.value.toUpperCase() })} /></Field>
              <Field label={crt === '1' ? 'CSOSN (sugestão do regime)' : 'CST ICMS (sugestão do regime)'} required>
                <select aria-label="CSOSN/CST" className={inputCls} value={items[editingItem].icmsCode} onChange={(e) => setItem(editingItem, { icmsCode: e.target.value })}>
                  {(crt === '1' ? NFE_CSOSN_OPTIONS : NFE_CST_ICMS_OPTIONS).map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Origem">
                <select aria-label="Origem" className={inputCls} value={items[editingItem].origin} onChange={(e) => setItem(editingItem, { origin: e.target.value })}>
                  <option value="0">0: Nacional</option>
                  <option value="1">1: Estrangeira, importação direta</option>
                  <option value="2">2: Estrangeira, adquirida no mercado interno</option>
                </select>
              </Field>
              <Field label="Alíquota ICMS (%), vazio = padrão do motor"><input aria-label="Alíquota ICMS" className={inputCls} value={items[editingItem].icmsRatePercent} onChange={(e) => setItem(editingItem, { icmsRatePercent: e.target.value })} /></Field>
              <Field label="Alíquota IPI (%)"><input aria-label="Alíquota IPI" className={inputCls} value={items[editingItem].ipiRatePercent} onChange={(e) => setItem(editingItem, { ipiRatePercent: e.target.value })} /></Field>
              <Field label="GTIN/EAN"><input aria-label="GTIN/EAN" className={inputCls} value={items[editingItem].ean} onChange={(e) => setItem(editingItem, { ean: onlyDigits(e.target.value) })} /></Field>
            </div>
            <div className="px-4 py-2 border-t flex justify-end">
              <button type="button" onClick={() => setEditingItem(null)} className="px-4 py-1.5 rounded text-white text-xs font-bold" style={{ backgroundColor: NAVY }}>
                Concluir
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
