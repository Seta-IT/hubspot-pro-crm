'use client';

// ============================================================================
// STI-hub ERP - Configurações gerais (item "Gerais" do menu Configurações)
// Layout no padrão GestãoClick: busca + lista de seções à esquerda, cards
// "Ajuste os ..." à direita e rodapé Cancelar / Salvar configurações.
// Salva pelo handleSaveAdminSettings existente (PUT /api/admin/settings) em
// generalParameters.erpConfigGerais e certificateSettings (Fiscal).
// E-mails (decisão do CISO): o envio do STI-hub é pela Resend, configurada por
// variável de ambiente no servidor. A seção é informativa: SMTP próprio aparece
// desabilitado ("disponível em breve") e não há campo nem armazenamento de senha.
// ============================================================================

import React, { useEffect, useMemo, useState } from 'react';
import {
  AlignLeft,
  Award,
  Barcode,
  BookOpen,
  Boxes,
  ChevronRight,
  Cloud,
  Coins,
  CreditCard,
  ExternalLink,
  FileText,
  Gift,
  Globe,
  Hash,
  Home,
  Image as ImageIcon,
  Info,
  KeyRound,
  Layers,
  ListOrdered,
  Lock,
  Mail,
  Monitor,
  Paintbrush,
  Paperclip,
  Pencil,
  Percent,
  Plus,
  Printer,
  Receipt,
  RefreshCw,
  Ruler,
  Search,
  Send,
  Server,
  Settings2,
  ShieldCheck,
  ShoppingCart,
  Store,
  Tag,
  Truck,
  Type,
  UserX,
  Wrench,
} from 'lucide-react';
import type { StiHubCertificateAndSeriesSettings } from '../../modules/erp/daily-sync-service';
import {
  DEFAULT_TEXT_ITEMS,
  ERP_GENERAL_SECTIONS,
  NUMBERING_GROUP_LABELS,
  NUMBERING_ROWS,
  PRINT_DOCS,
  PRINT_FIELDS,
  type ErpGeneralSectionId,
  type ErpGeneralSettings,
  type PrintDocKey,
  filterGeneralSections,
  isValidHexColor,
  mergeErpGeneralSettings,
  nextNumberLabel,
  printFieldSummary,
  sanitizeErpGeneralSettingsForSave,
} from '../lib/erp-general-settings';

const NAVY = '#1e3a6e'; // cor de destaque única do sistema (decisão do Marcéllo 02/11)

type IconType = React.ComponentType<{ className?: string; style?: React.CSSProperties }>;

const SECTION_ICONS: Record<ErpGeneralSectionId, IconType> = {
  GERAL: Settings2,
  NUMERACOES: ListOrdered,
  IMPRESSAO: Printer,
  TEXTOS: AlignLeft,
  PDV: Monitor,
  COMPRAS: ShoppingCart,
  FISCAL: FileText,
  EMAILS: Mail,
  DOMINIO: Globe,
};

function Card({ icon: Icon, lead, strong, tail, subtitle, right, children }: {
  icon: IconType;
  lead: string;
  strong: string;
  tail?: string;
  subtitle: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="bg-white rounded-md border border-slate-200 shadow-2xs">
      <header className="flex flex-wrap items-start justify-between gap-3 px-5 pt-4 pb-3">
        <div>
          <h3 className="flex items-center gap-2 text-[15px] text-slate-700">
            <Icon className="w-4 h-4 text-slate-500" />
            <span>
              {lead} <strong className="font-bold" style={{ color: NAVY }}>{strong}</strong>
              {tail ? ` ${tail}` : ''}
            </span>
          </h3>
          <p className="text-[11px] text-slate-500 mt-0.5">{subtitle}</p>
        </div>
        {right}
      </header>
      <div className="divide-y divide-slate-100 border-t border-slate-100">{children}</div>
    </section>
  );
}

function Row({ icon: Icon, title, description, children }: { icon: IconType; title: string; description: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-5 py-3">
      <div className="flex items-start gap-3 min-w-0">
        <Icon className="w-4 h-4 mt-0.5 text-slate-500 shrink-0" />
        <div className="min-w-0">
          <div className="text-xs font-semibold text-slate-800">{title}</div>
          <div className="text-[11px] text-slate-500">{description}</div>
        </div>
      </div>
      {children !== undefined && <div className="shrink-0 text-xs font-semibold">{children}</div>}
    </div>
  );
}

function GroupLabel({ children }: { children: React.ReactNode }) {
  return <div className="px-5 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500 bg-slate-50/60">{children}</div>;
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 items-center rounded-full transition cursor-pointer ${checked ? '' : 'bg-slate-300'}`}
      style={checked ? { backgroundColor: NAVY } : undefined}
    >
      <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition ${checked ? 'translate-x-4' : 'translate-x-0.5'}`} />
    </button>
  );
}

const selectCls = 'w-44 px-3 py-1.5 rounded border border-slate-300 bg-white text-xs font-semibold';
const inputCls = 'px-3 py-1.5 rounded border border-slate-300 bg-white text-xs font-semibold';

export interface ErpGeneralSettingsPageProps {
  /** generalParameters.erpConfigGerais vindo de GET /api/admin/settings. */
  savedSettings: unknown;
  certificateSettings: StiHubCertificateAndSeriesSettings;
  onCertificateSettingsChange: (next: StiHubCertificateAndSeriesSettings) => void;
  onSave: (settings: ErpGeneralSettings) => void | Promise<void>;
  onCancel?: () => void;
  saving?: boolean;
  onOpenCertificate?: () => void;
  /** Último número real de cada cadastro (calculado dos registros carregados). */
  numberingBase?: Record<string, number | null>;
}

export default function ErpGeneralSettingsPage({
  savedSettings,
  certificateSettings,
  onCertificateSettingsChange,
  onSave,
  onCancel,
  saving,
  onOpenCertificate,
  numberingBase = {},
}: ErpGeneralSettingsPageProps) {
  const [section, setSection] = useState<ErpGeneralSectionId>('GERAL');
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useState<ErpGeneralSettings>(() => mergeErpGeneralSettings(savedSettings));
  const [printTab, setPrintTab] = useState<'BASICO' | 'POR_DOCUMENTO'>('BASICO');
  const [editingText, setEditingText] = useState<string | null>(null);

  useEffect(() => {
    setDraft(mergeErpGeneralSettings(savedSettings));
  }, [savedSettings]);

  const visibleSections = useMemo(() => filterGeneralSections(query), [query]);

  const set = <K extends keyof ErpGeneralSettings>(key: K, patch: Partial<ErpGeneralSettings[K]>) =>
    setDraft((d) => ({ ...d, [key]: { ...(d[key] as object), ...(patch as object) } }));

  const handleCancel = () => {
    setDraft(mergeErpGeneralSettings(savedSettings));
    setEditingText(null);
    onCancel?.();
  };

  const handleSave = async () => {
    await onSave(sanitizeErpGeneralSettingsForSave(draft));
  };

  const systemAddress = typeof window !== 'undefined' ? window.location.host : 'sti-hub.vercel.app';

  // ------------------------------------------------------------------ seções
  const renderGeral = () => (
    <>
      <Card icon={Hash} lead="Ajuste os" strong="números e listagens" subtitle="Como valores e quantidades aparecem, e quantos registros por página.">
        <Row icon={Coins} title="Casas decimais nos valores" description="Preços, totais e lançamentos.">
          <select className={selectCls} value={draft.geral.valueDecimals} onChange={(e) => set('geral', { valueDecimals: Number(e.target.value) })}>
            {[2, 3, 4].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </Row>
        <Row icon={Boxes} title="Casas decimais nas quantidades" description="Itens de vendas, compras e estoque.">
          <select className={selectCls} value={draft.geral.quantityDecimals} onChange={(e) => set('geral', { quantityDecimals: Number(e.target.value) })}>
            {[0, 1, 2, 3, 4].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </Row>
        <Row icon={ListOrdered} title="Registros por página" description="Tamanho padrão das listagens.">
          <select className={selectCls} value={draft.geral.recordsPerPage} onChange={(e) => set('geral', { recordsPerPage: Number(e.target.value) })}>
            {[10, 20, 50, 100].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </Row>
      </Card>
      <Card icon={ShoppingCart} lead="Defina as" strong="regras de venda e estoque" subtitle="Valem para vendas, ordens de serviço e PDV.">
        <Row icon={Info} title="Vender produto sem estoque" description="Desligado, o sistema bloqueia a venda sem saldo.">
          <Toggle label="Vender produto sem estoque" checked={draft.geral.sellWithoutStock} onChange={(v) => set('geral', { sellWithoutStock: v })} />
        </Row>
        <Row icon={CreditCard} title="Vender sem condição de pagamento" description="Permite salvar a venda sem informar o pagamento.">
          <Toggle label="Vender sem condição de pagamento" checked={draft.geral.sellWithoutPaymentCondition} onChange={(v) => set('geral', { sellWithoutPaymentCondition: v })} />
        </Row>
        <Row icon={Layers} title="Estoque do produto composição" description="Usa o estoque dos itens que compõem o produto.">
          <Toggle label="Estoque do produto composição" checked={draft.geral.compositionStock} onChange={(v) => set('geral', { compositionStock: v })} />
        </Row>
        <Row icon={RefreshCw} title="Valor de custo nas compras" description="Como a compra atualiza o custo do produto.">
          <select className={selectCls} value={draft.geral.purchaseCostUpdate} onChange={(e) => set('geral', { purchaseCostUpdate: e.target.value as ErpGeneralSettings['geral']['purchaseCostUpdate'] })}>
            <option value="NAO_ATUALIZAR">Não atualizar</option>
            <option value="ULTIMO_CUSTO">Último custo</option>
            <option value="CUSTO_MEDIO">Custo médio</option>
          </select>
        </Row>
      </Card>
      <Card icon={UserX} lead="Ajuste os" strong="cadastros" subtitle="Regras de clientes, fornecedores e transportadoras.">
        <Row icon={ShieldCheck} title="Bloquear CPF/CNPJ repetido" description="Impede dois cadastros com o mesmo documento.">
          <Toggle label="Bloquear CPF/CNPJ repetido" checked={draft.geral.blockDuplicateDocument} onChange={(v) => set('geral', { blockDuplicateDocument: v })} />
        </Row>
      </Card>
    </>
  );

  const renderNumeracoes = () => (
    <Card icon={ListOrdered} lead="Defina o" strong="último número" tail="de cada registro" subtitle="O próximo registro sai com o número seguinte ao que estiver aqui.">
      <div className="hidden sm:grid grid-cols-12 px-5 py-2 text-[11px] font-semibold text-slate-600 bg-slate-50">
        <div className="col-span-7">Registro</div>
        <div className="col-span-3 text-right">Último número usado</div>
        <div className="col-span-2 text-right">Próximo sai como</div>
      </div>
      {(Object.keys(NUMBERING_GROUP_LABELS) as Array<keyof typeof NUMBERING_GROUP_LABELS>).map((g) => (
        <React.Fragment key={g}>
          <GroupLabel>{NUMBERING_GROUP_LABELS[g]}</GroupLabel>
          {NUMBERING_ROWS.filter((r) => r.group === g).map((r) => {
            const manual = draft.numeracoes[r.key];
            const base = numberingBase[r.key];
            const value = typeof manual === 'number' ? manual : typeof base === 'number' ? base : null;
            return (
              <div key={r.key} className="grid grid-cols-1 sm:grid-cols-12 items-center gap-2 px-5 py-2.5">
                <div className="sm:col-span-7 flex items-start gap-3">
                  <Hash className="w-4 h-4 mt-0.5 text-slate-500" />
                  <div>
                    <div className="text-xs font-semibold text-slate-800">{r.label}</div>
                    <div className="text-[11px] text-slate-500">{r.description}</div>
                  </div>
                </div>
                <div className="sm:col-span-3 sm:text-right">
                  <input
                    type="number"
                    min={0}
                    aria-label={`Último número usado em ${r.label}`}
                    value={value ?? ''}
                    placeholder="Sem base"
                    onChange={(e) =>
                      set('numeracoes', { [r.key]: e.target.value === '' ? null : Math.max(0, Math.floor(Number(e.target.value) || 0)) })
                    }
                    className={`${inputCls} w-32 text-right`}
                  />
                </div>
                <div className="sm:col-span-2 sm:text-right">
                  <span className="inline-block px-2 py-0.5 rounded border border-slate-300 bg-slate-50 text-[11px] font-semibold text-slate-700">
                    {nextNumberLabel(value)}
                  </span>
                </div>
              </div>
            );
          })}
        </React.Fragment>
      ))}
      <div className="px-5 py-2.5 text-[11px] text-slate-500 flex items-center gap-1.5">
        <Info className="w-3.5 h-3.5" /> NF-e, NFS-e e NFCom ficam na seção Fiscal, junto com a série de cada nota.
      </div>
    </Card>
  );

  const fontOptions = ['10px', '11px', '12px', '13px', '14px'] as const;
  const renderImpressao = () => (
    <>
      <Card icon={Printer} lead="Defina o" strong="formato" tail="da impressão" subtitle="Vale para orçamentos, vendas, ordens de serviço e cupons.">
        <Row icon={FileText} title="Formato do pedido A4" description="Como a folha A4 dos pedidos é gerada.">
          <select className={selectCls} value={draft.impressao.a4Format} onChange={(e) => set('impressao', { a4Format: e.target.value as 'PDF' | 'HTML' })}>
            <option value="PDF">PDF</option>
            <option value="HTML">HTML</option>
          </select>
        </Row>
        <Row icon={Type} title="Tamanho da fonte no A4" description="Texto dos itens e totais na folha.">
          <select className={selectCls} value={draft.impressao.a4FontSize} onChange={(e) => set('impressao', { a4FontSize: e.target.value as ErpGeneralSettings['impressao']['a4FontSize'] })}>
            {fontOptions.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
        </Row>
        <Row icon={Ruler} title="Tamanho da fonte no cupom" description="Impressão em impressora térmica.">
          <select className={selectCls} value={draft.impressao.couponFontSize} onChange={(e) => set('impressao', { couponFontSize: e.target.value as ErpGeneralSettings['impressao']['couponFontSize'] })}>
            {fontOptions.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
        </Row>
        <Row icon={Gift} title="Cupom de presente" description="Libera nas vendas a impressão do cupom sem valores.">
          <Toggle label="Cupom de presente" checked={draft.impressao.giftCoupon} onChange={(v) => set('impressao', { giftCoupon: v })} />
        </Row>
      </Card>
      <Card
        icon={BookOpen}
        lead="Escolha o que"
        strong="aparece"
        tail="nos documentos"
        subtitle="Colunas e conteúdos impressos em orçamentos, vendas, OS, compras e cotações."
        right={
          <div className="inline-flex rounded border border-slate-300 overflow-hidden text-[11px] font-semibold">
            {(['BASICO', 'POR_DOCUMENTO'] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setPrintTab(t)}
                className={`px-3 py-1.5 cursor-pointer ${printTab === t ? 'text-white' : 'bg-white text-slate-700 hover:bg-slate-50'}`}
                style={printTab === t ? { backgroundColor: NAVY } : undefined}
              >
                {t === 'BASICO' ? 'Básico' : 'Por documento'}
              </button>
            ))}
          </div>
        }
      >
        {(['PRODUTOS', 'SERVICOS', 'ANEXOS'] as const).map((g) => (
          <React.Fragment key={g}>
            <GroupLabel>{g === 'PRODUTOS' ? 'Produtos' : g === 'SERVICOS' ? 'Serviços' : 'Anexos'}</GroupLabel>
            {PRINT_FIELDS.filter((f) => f.group === g).map((f) => {
              const perDoc = draft.impressao.fields[f.key] || {};
              const summary = printFieldSummary(f, perDoc);
              const setDocs = (next: Partial<Record<PrintDocKey, boolean>>) =>
                set('impressao', { fields: { ...draft.impressao.fields, [f.key]: next } });
              const icon = g === 'ANEXOS' ? Paperclip : f.key.startsWith('imagem') ? ImageIcon : f.key === 'codigoProduto' ? Barcode : f.key === 'valorUnitario' ? Tag : g === 'SERVICOS' ? Wrench : AlignLeft;
              return (
                <Row key={f.key} icon={icon} title={f.label} description={summary.label}>
                  {printTab === 'BASICO' ? (
                    summary.state === 'CUSTOM' ? (
                      <button type="button" onClick={() => setPrintTab('POR_DOCUMENTO')} className="px-2.5 py-1 rounded border border-slate-300 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer">
                        {summary.label}
                      </button>
                    ) : (
                      <Toggle
                        label={f.label}
                        checked={summary.state === 'ALL'}
                        onChange={(v) => setDocs(Object.fromEntries(f.docs.map((d) => [d, v])))}
                      />
                    )
                  ) : (
                    <div className="flex flex-wrap gap-2 justify-end">
                      {PRINT_DOCS.filter((d) => f.docs.includes(d.key)).map((d) => (
                        <label key={d.key} className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-700">
                          <input type="checkbox" checked={perDoc[d.key] === true} onChange={(e) => setDocs({ ...perDoc, [d.key]: e.target.checked })} />
                          {d.label}
                        </label>
                      ))}
                    </div>
                  )}
                </Row>
              );
            })}
          </React.Fragment>
        ))}
      </Card>
    </>
  );

  const renderTextos = () => {
    const groups = Array.from(new Set(DEFAULT_TEXT_ITEMS.map((t) => t.group)));
    return (
      <Card icon={AlignLeft} lead="Defina os" strong="textos padrão" subtitle="Entram sozinhos em cada documento novo, já prontos para o próximo documento.">
        {groups.map((g) => (
          <React.Fragment key={g}>
            <GroupLabel>{g}</GroupLabel>
            {DEFAULT_TEXT_ITEMS.filter((t) => t.group === g).map((t) => {
              const value = draft.textos[t.key] || '';
              const editing = editingText === t.key;
              return (
                <div key={t.key} className="px-5 py-3 space-y-2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3 min-w-0">
                      <FileText className="w-4 h-4 mt-0.5 text-slate-500 shrink-0" />
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-slate-800">{t.label}</div>
                        <div className="text-[11px] text-slate-500">{t.description}</div>
                        {!editing && (
                          <div className="text-[11px] text-slate-600 mt-1 truncate">{value ? value : 'Sem texto padrão.'}</div>
                        )}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setEditingText(editing ? null : t.key)}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-slate-300 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer shrink-0"
                    >
                      {editing ? 'Concluir' : value ? (<><Pencil className="w-3 h-3" /> Editar</>) : (<><Plus className="w-3 h-3" /> Escrever</>)}
                    </button>
                  </div>
                  {editing && (
                    <textarea
                      rows={4}
                      value={value}
                      onChange={(e) => set('textos', { [t.key]: e.target.value })}
                      className="w-full px-3 py-2 rounded border border-slate-300 text-xs"
                      aria-label={`Texto padrão: ${g} - ${t.label}`}
                    />
                  )}
                </div>
              );
            })}
          </React.Fragment>
        ))}
      </Card>
    );
  };

  const renderPdv = () => (
    <Card icon={Monitor} lead="Ajuste o" strong="PDV" subtitle="Caixa e cupom das vendas de balcão.">
      <Row icon={Receipt} title="Imprimir cupom ao finalizar" description="Abre a impressão assim que a venda é concluída.">
        <Toggle label="Imprimir cupom ao finalizar" checked={draft.pdv.autoPrintCoupon} onChange={(v) => set('pdv', { autoPrintCoupon: v })} />
      </Row>
      <Row icon={Store} title="Vender sem identificar o cliente" description="Permite venda de balcão para consumidor não identificado.">
        <Toggle label="Vender sem identificar o cliente" checked={draft.pdv.allowAnonymousCustomer} onChange={(v) => set('pdv', { allowAnonymousCustomer: v })} />
      </Row>
      <Row icon={ShieldCheck} title="Pedir CPF/CNPJ no cupom" description="Pergunta o documento antes de fechar a venda.">
        <Toggle label="Pedir CPF/CNPJ no cupom" checked={draft.pdv.askDocumentOnCoupon} onChange={(v) => set('pdv', { askDocumentOnCoupon: v })} />
      </Row>
    </Card>
  );

  const renderCompras = () => (
    <Card icon={FileText} lead="Ajuste a" strong="importação do XML" tail="na compra" subtitle="Como os valores da nota do fornecedor entram no custo de cada produto.">
      <Row icon={Truck} title="Considerar frete" description="Soma o frete da nota no custo do produto.">
        <Toggle label="Considerar frete" checked={draft.compras.considerFreight} onChange={(v) => set('compras', { considerFreight: v })} />
      </Row>
      <Row icon={Percent} title="Considerar desconto" description="Abate o desconto da nota no custo do produto.">
        <Toggle label="Considerar desconto" checked={draft.compras.considerDiscount} onChange={(v) => set('compras', { considerDiscount: v })} />
      </Row>
      <Row icon={Receipt} title="Considerar impostos" description="Soma ICMS ST, IPI, seguro e II no custo do produto.">
        <Toggle label="Considerar impostos" checked={draft.compras.considerTaxes} onChange={(v) => set('compras', { considerTaxes: v })} />
      </Row>
      <Row icon={Plus} title="Considerar outras despesas" description="Soma as outras despesas da nota no custo do produto.">
        <Toggle label="Considerar outras despesas" checked={draft.compras.considerOtherExpenses} onChange={(v) => set('compras', { considerOtherExpenses: v })} />
      </Row>
      <Row icon={Search} title="Vincular produtos por" description="Como o item da nota é procurado no seu cadastro.">
        <select className={selectCls} value={draft.compras.linkProductsBy} onChange={(e) => set('compras', { linkProductsBy: e.target.value as ErpGeneralSettings['compras']['linkProductsBy'] })}>
          <option value="NOME">Nome do produto</option>
          <option value="CODIGO_FORNECEDOR">Código do fornecedor</option>
          <option value="CODIGO_BARRAS">Código de barras</option>
        </select>
      </Row>
    </Card>
  );

  const fiscalSeries: Array<{ label: string; desc: string; s: keyof StiHubCertificateAndSeriesSettings; n: keyof StiHubCertificateAndSeriesSettings }> = [
    { label: 'NF-e de produto (modelo 55)', desc: 'Série e próximo número da NF-e.', s: 'nfeProductSeries', n: 'nfeProductNextNumber' },
    { label: 'NFS-e de serviço (LC 116)', desc: 'Série e próximo número da NFS-e.', s: 'nfseServiceSeries', n: 'nfseServiceNextNumber' },
    { label: 'NFCom telecom (modelo 62)', desc: 'Série e próximo número da NFCom.', s: 'nfcomTelecomSeries', n: 'nfcomTelecomNextNumber' },
    { label: 'Fatura de locação (SV 31)', desc: 'Prefixo e próximo número da fatura de locação.', s: 'rentalInvoicePrefix', n: 'rentalInvoiceNextNumber' },
  ];
  const renderFiscal = () => (
    <>
      <Card
        icon={Award}
        lead="Confira o"
        strong="certificado digital"
        subtitle="O certificado A1 tem tela própria, com envio seguro do arquivo e da senha."
        right={
          onOpenCertificate ? (
            <button type="button" onClick={onOpenCertificate} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border text-[11px] font-semibold cursor-pointer hover:bg-slate-50" style={{ borderColor: NAVY, color: NAVY }}>
              <KeyRound className="w-3.5 h-3.5" /> Abrir Certificado digital
            </button>
          ) : undefined
        }
      >
        <Row icon={Server} title="Ambiente SEFAZ / Prefeitura" description="Produção para emissões reais; Homologação para testes.">
          <select
            className={selectCls}
            value={certificateSettings.sefazEnvironment}
            onChange={(e) => onCertificateSettingsChange({ ...certificateSettings, sefazEnvironment: e.target.value as 'PRODUCAO' | 'HOMOLOGACAO' })}
          >
            <option value="PRODUCAO">Produção</option>
            <option value="HOMOLOGACAO">Homologação</option>
          </select>
        </Row>
      </Card>
      <Card icon={FileText} lead="Defina as" strong="séries das notas" subtitle="NF-e, NFC-e, NFS-e e NFCom emitidas pela Seta Telecom.">
        {fiscalSeries.map((r) => (
          <Row key={r.s} icon={Hash} title={r.label} description={r.desc}>
            <div className="flex items-center gap-2">
              <input
                type="text"
                aria-label={`Série ${r.label}`}
                value={String(certificateSettings[r.s] ?? '')}
                onChange={(e) => onCertificateSettingsChange({ ...certificateSettings, [r.s]: e.target.value })}
                className={`${inputCls} w-20 font-mono`}
              />
              <input
                type="number"
                aria-label={`Próximo número ${r.label}`}
                value={Number(certificateSettings[r.n] ?? 1)}
                onChange={(e) => onCertificateSettingsChange({ ...certificateSettings, [r.n]: Number(e.target.value) || 1 })}
                className={`${inputCls} w-28 text-right font-mono`}
              />
            </div>
          </Row>
        ))}
        <Row icon={Truck} title="CFOP padrão da remessa em locação" description="Dentro do estado 5.908; fora do estado 6.908.">
          <select
            className={selectCls}
            value={certificateSettings.nfeRemessaCfopDefault}
            onChange={(e) => onCertificateSettingsChange({ ...certificateSettings, nfeRemessaCfopDefault: e.target.value as '5.908' | '6.908' })}
          >
            <option value="5.908">5.908</option>
            <option value="6.908">6.908</option>
          </select>
        </Row>
      </Card>
    </>
  );

  const renderEmails = () => (
    <Card icon={Send} lead="Veja por onde saem os" strong="e-mails" subtitle="Orçamentos, cobranças e avisos que o sistema envia aos seus clientes.">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-5">
        <div className="flex items-start gap-3 p-4 rounded border bg-slate-50" style={{ borderColor: NAVY }} aria-current="true">
          <Cloud className="w-4 h-4 mt-0.5 text-slate-500" />
          <span>
            <span className="block text-xs font-semibold text-slate-800">Servidor do sistema (Resend)</span>
            <span className="block text-[11px] text-slate-500">Em uso. Os e-mails saem pelo servidor do STI-hub, configurado pela equipe de segurança.</span>
          </span>
        </div>
        <div className="flex items-start gap-3 p-4 rounded border border-slate-200 bg-white opacity-60 cursor-not-allowed" aria-disabled="true">
          <Server className="w-4 h-4 mt-0.5 text-slate-400" />
          <span>
            <span className="flex items-center gap-2 text-xs font-semibold text-slate-600">
              Servidor próprio (SMTP)
              <span className="px-1.5 py-0.5 rounded border border-slate-300 bg-slate-50 text-[10px] font-semibold text-slate-600">Disponível em breve</span>
            </span>
            <span className="block text-[11px] text-slate-500">Envio pelo seu provedor, com o seu endereço.</span>
          </span>
        </div>
      </div>
      <Row icon={Info} title="Configuração do envio" description="Feita no servidor. Nenhuma senha de e-mail é pedida ou guardada nesta tela." />
      <Row icon={Send} title="Testar envio" description="Disponível em breve.">
        <button type="button" disabled className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-slate-300 text-[11px] font-semibold text-slate-400 cursor-not-allowed" title="Disponível em breve">
          <Send className="w-3.5 h-3.5" /> Testar envio
        </button>
      </Row>
    </Card>
  );

  const renderDominio = () => {
    const d = draft.dominio;
    const primary = isValidHexColor(d.primaryColor) ? d.primaryColor : NAVY;
    const secondary = isValidHexColor(d.secondaryColor) ? d.secondaryColor : '#000000';
    const shownHost = d.customDomain.trim() || systemAddress;
    return (
      <Card icon={Paintbrush} lead="Veja como o sistema" strong="aparece" tail="para quem acessa" subtitle="Endereço, marca e cores do seu domínio.">
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-5 p-5">
          <div className="lg:col-span-3">
            <div className="rounded-md border border-slate-200 overflow-hidden shadow-2xs" aria-label="Prévia aproximada">
              <div className="flex items-center gap-2 bg-slate-100 px-3 py-1.5">
                <span className="flex gap-1"><i className="w-2 h-2 rounded-full bg-slate-300" /><i className="w-2 h-2 rounded-full bg-slate-300" /><i className="w-2 h-2 rounded-full bg-slate-300" /></span>
                <span className="px-2 py-0.5 rounded-t bg-white text-[10px] font-semibold text-slate-700">{d.systemName || 'Sem nome'}</span>
              </div>
              <div className="px-3 py-1 text-[10px] text-slate-500 border-b border-slate-200 flex items-center gap-1"><Lock className="w-3 h-3" /> {shownHost}</div>
              <div className="px-3 py-2 text-white text-sm font-semibold" style={{ backgroundColor: primary }}>{d.systemName || 'Sem nome'}</div>
              <div className="grid grid-cols-3 gap-3 p-3 bg-white">
                <div className="space-y-1.5">
                  <div className="h-1.5 rounded" style={{ backgroundColor: secondary }} />
                  {[0, 1, 2].map((i) => <div key={i} className="h-1.5 rounded bg-slate-200" />)}
                </div>
                <div className="col-span-2 space-y-1.5">
                  {[0, 1, 2].map((i) => <div key={i} className="h-1.5 rounded bg-slate-100" />)}
                  <div className="h-3 w-14 rounded" style={{ backgroundColor: primary }} />
                </div>
              </div>
            </div>
            <p className="text-[11px] text-slate-500 mt-2">Prévia aproximada: o topo usa a cor principal e o nome.</p>
          </div>
          <div className="lg:col-span-2 space-y-4 text-xs">
            <div>
              <div className="text-[10px] font-semibold uppercase text-slate-500 mb-1">Endereços</div>
              <div className="flex items-start gap-2">
                <Globe className="w-3.5 h-3.5 mt-0.5 text-slate-500" />
                <div>
                  <div className="text-[11px] text-slate-500">Endereço do sistema</div>
                  <a href={`https://${systemAddress}`} target="_blank" rel="noreferrer" className="font-semibold inline-flex items-center gap-1" style={{ color: NAVY }}>
                    {systemAddress} <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              </div>
              <label className="flex items-start gap-2 mt-2">
                <Home className="w-3.5 h-3.5 mt-2 text-slate-500" />
                <span className="flex-1">
                  <span className="block text-[11px] text-slate-500">Domínio próprio</span>
                  <input className={`${inputCls} w-full`} value={d.customDomain} placeholder="Não configurado" onChange={(e) => set('dominio', { customDomain: e.target.value.trim().toLowerCase() })} />
                  <span className="block text-[11px] text-slate-500 mt-1">O apontamento DNS e o cadastro do domínio na hospedagem são feitos à parte.</span>
                </span>
              </label>
            </div>
            <div>
              <div className="text-[10px] font-semibold uppercase text-slate-500 mb-1">Cores</div>
              <div className="flex gap-4">
                {([['primaryColor', 'Principal'], ['secondaryColor', 'Secundária']] as const).map(([k, label]) => (
                  <label key={k} className="flex items-center gap-2">
                    <input type="color" value={isValidHexColor(d[k]) ? d[k] : '#000000'} onChange={(e) => set('dominio', { [k]: e.target.value.toUpperCase() })} className="w-8 h-8 rounded border border-slate-300 cursor-pointer" aria-label={`Cor ${label}`} />
                    <span>
                      <span className="block text-[11px] text-slate-500">{label}</span>
                      <span className="block font-semibold font-mono">{d[k]}</span>
                    </span>
                  </label>
                ))}
              </div>
            </div>
            <label className="block">
              <span className="block text-[10px] font-semibold uppercase text-slate-500 mb-1">Nome</span>
              <input className={`${inputCls} w-full`} value={d.systemName} onChange={(e) => set('dominio', { systemName: e.target.value })} />
              <span className="block text-[11px] text-slate-500 mt-1">Aparece na aba do navegador.</span>
            </label>
          </div>
        </div>
      </Card>
    );
  };

  const renderers: Record<ErpGeneralSectionId, () => React.ReactNode> = {
    GERAL: renderGeral,
    NUMERACOES: renderNumeracoes,
    IMPRESSAO: renderImpressao,
    TEXTOS: renderTextos,
    PDV: renderPdv,
    COMPRAS: renderCompras,
    FISCAL: renderFiscal,
    EMAILS: renderEmails,
    DOMINIO: renderDominio,
  };

  return (
    <div className="space-y-4 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-lg text-slate-800">
          <Settings2 className="w-5 h-5" style={{ color: NAVY }} />
          <span className="font-semibold">Configurações gerais</span>
        </h2>
        <nav aria-label="breadcrumb" className="flex items-center gap-1 text-[11px] text-slate-500">
          <Home className="w-3.5 h-3.5" />
          <span>Início</span>
          <ChevronRight className="w-3 h-3" />
          <span className="font-semibold text-slate-800">Configurações gerais</span>
        </nav>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <aside className="lg:col-span-3 space-y-2">
          <label className="block">
            <span className="block text-[11px] font-semibold text-slate-700 mb-1">Buscar configuração</span>
            <span className="relative block">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Ex.: estoque, nota, e-mail"
                className="w-full pl-8 pr-3 py-2 rounded border border-slate-300 bg-white text-xs"
              />
            </span>
          </label>
          <ul className="rounded-md border border-slate-200 bg-white divide-y divide-slate-100 overflow-hidden">
            {visibleSections.length === 0 && <li className="px-3 py-3 text-[11px] text-slate-500 font-semibold">Nenhuma configuração encontrada.</li>}
            {visibleSections.map((s) => {
              const Icon = SECTION_ICONS[s.id];
              const active = section === s.id;
              return (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => setSection(s.id)}
                    className={`w-full text-left flex items-start gap-3 px-3 py-2.5 cursor-pointer ${active ? 'text-white' : 'hover:bg-slate-50'}`}
                    style={active ? { backgroundColor: NAVY } : undefined}
                    aria-current={active ? 'page' : undefined}
                  >
                    <Icon className={`w-4 h-4 mt-0.5 ${active ? 'text-white' : 'text-slate-500'}`} />
                    <span>
                      <span className={`block text-xs font-semibold ${active ? 'text-white' : ''}`} style={active ? undefined : { color: NAVY }}>{s.title}</span>
                      <span className={`block text-[11px] ${active ? 'text-slate-200' : 'text-slate-500'}`}>{s.subtitle}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </aside>

        <div className="lg:col-span-9 space-y-4">
          {renderers[section]()}
          <div className="flex items-center justify-between gap-3 pt-1">
            <button type="button" onClick={handleCancel} disabled={saving} className="px-4 py-2 rounded border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 font-semibold cursor-pointer disabled:opacity-60">
              Cancelar
            </button>
            <button type="button" onClick={handleSave} disabled={saving} className="px-4 py-2 rounded text-white font-semibold cursor-pointer disabled:opacity-60" style={{ backgroundColor: NAVY }}>
              {saving ? 'Salvando...' : 'Salvar configurações'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
