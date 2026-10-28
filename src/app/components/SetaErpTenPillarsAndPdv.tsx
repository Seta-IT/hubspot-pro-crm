'use client';

import React, { useState } from 'react';
import {
  ShoppingCart,
  Plus,
  Minus,
  Trash2,
  Printer,
  Mail,
  CheckCircle2,
  Search,
  QrCode,
  CreditCard,
  Banknote,
  Landmark,
  Gift,
  Boxes,
  ArrowLeftRight,
  ClipboardList,
  Truck,
  Sparkles,
  Wrench,
  Headphones,
  Users,
  Package,
  FileText,
  FileCheck2,
  Wallet,
  Receipt,
  Cpu,
  X,
  ArrowRight,
} from 'lucide-react';
import {
  Company,
  ErpCatalogItem,
  ErpPurchaseOrder,
  ErpSaleOrder,
  ErpServiceOrder,
  ErpSupplierRecord,
  GestaoClickConfig,
} from '../../db/types';
import { formatBRL } from './ui-helpers';
import { recordUpsertedCatalogItem, recordUpsertedPurchaseOrder } from '../lib/durable-storage';
import { GestaoClickMenuSection } from './ErpGestaoClickTab';
import { ClientEmailInitialPayload } from './ClientEmailComposerModal';

// ============================================================================
// MATRIZ INICIAL SETA ERP — 10 PILARES OFICIAIS (ZERO REDUNDÂNCIA, 100% CLICÁVEL)
// ============================================================================

export interface SetaErpPillarItem {
  num: number;
  title: string;
  subtitle: string;
  metrics: string;
  section: GestaoClickMenuSection;
  subId: string;
  icon: React.ComponentType<{ className?: string }>;
  accent: string;
}

export const SETA_ERP_TEN_PILLARS: SetaErpPillarItem[] = [
  {
    num: 1,
    title: 'Cadastros',
    subtitle: 'Clientes, Fornecedores, Funcionários e Transportadoras',
    metrics: '1.184 Clientes • 101 Forn.',
    section: 'CADASTROS',
    subId: 'CAD_CLIENTES',
    icon: Users,
    accent: 'border-l-blue-700',
  },
  {
    num: 2,
    title: 'Produtos e serviços',
    subtitle: 'Catálogo Telecom, Hardware, Licenças Cisco e Serviços NOC',
    metrics: '786 Produtos • 39 Serviços',
    section: 'ITENS',
    subId: 'ITENS_PRODUTOS',
    icon: Package,
    accent: 'border-l-sky-600',
  },
  {
    num: 3,
    title: 'Propostas e vendas',
    subtitle: 'Orçamentos (#4695), Link PDF Cliente A4 e Pedidos de Venda',
    metrics: '2.077 Orç. • 295 Vendas',
    section: 'ORCAMENTOS',
    subId: 'ORC_PRODUTOS',
    icon: FileText,
    accent: 'border-l-[#ff7a59]',
  },
  {
    num: 4,
    title: 'Estoque e compras',
    subtitle: 'Movimentações, Ajustes, Transferências, Cotações e OCs',
    metrics: 'S/N Ativos • 54 Compras',
    section: 'ESTOQUE',
    subId: 'EST_MOVIMENTACOES',
    icon: Boxes,
    accent: 'border-l-amber-500',
  },
  {
    num: 5,
    title: 'Contratos e locações',
    subtitle: 'Locação de Equipamentos S/N, Vigência e Reajuste IPCA/IGP-M',
    metrics: '344 Contratos Ativos',
    section: 'CONTRATOS',
    subId: 'CTR_LOCACOES',
    icon: FileCheck2,
    accent: 'border-l-emerald-600',
  },
  {
    num: 6,
    title: 'Financeiro',
    subtitle: 'Contas a Pagar/Receber, Fluxo de Caixa, DRE e Boletos Inter/Itaú',
    metrics: 'R$ 2,20M Saldo Disp.',
    section: 'FINANCEIRO',
    subId: 'FIN_FLUXO',
    icon: Wallet,
    accent: 'border-l-teal-600',
  },
  {
    num: 7,
    title: 'Fiscal',
    subtitle: 'Fatura Locação (0% ISS — LC 116 + SV 31 STF), NFS-e e NF-e 5.908',
    metrics: '100% Compliance STF',
    section: 'FISCAL',
    subId: 'FIS_SERVICOS',
    icon: Receipt,
    accent: 'border-l-indigo-600',
  },
  {
    num: 8,
    title: 'OS e suporte',
    subtitle: 'Ordens de Serviço Técnicas Integradas ao NOC Service Desk SLA',
    metrics: '1.378 O.S. • SLA 94%',
    section: 'ORDENS_SERVICOS',
    subId: 'OS_GERENCIAR',
    icon: Wrench,
    accent: 'border-l-purple-600',
  },
  {
    num: 9,
    title: 'Integrações e IA',
    subtitle: 'Conector Ao Vivo GestãoClick ERP-GROK, Servidor MCP e Copiloto IA',
    metrics: 'API + MCP Online',
    section: 'CONFIGURACOES',
    subId: 'CFG_GERAIS',
    icon: Cpu,
    accent: 'border-l-slate-800',
  },
];

export function SetaErpTenPillarsMatrix({
  activeSection,
  activeSubId,
  onSelectPillar,
}: {
  activeSection: GestaoClickMenuSection;
  activeSubId: string;
  onSelectPillar: (section: GestaoClickMenuSection, subId: string) => void;
}) {
  const [expanded, setExpanded] = useState(true);

  return (
    <div className="bg-white rounded-md border border-slate-200 p-4 shadow-xs space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="px-2 py-0.5 rounded bg-[#0d2b4e] text-white text-[10px] font-normal uppercase">
            MATRIZ OFICIAL SETA ERP
          </span>
          <h2 className="text-xs sm:text-sm font-semibold text-slate-800">
            Arquitetura Unificada STI-hub (Módulos Operacionais Seta Telecom)
          </h2>
        </div>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="text-xs font-normal text-[#1e3a6e] hover:underline cursor-pointer"
        >
          {expanded ? 'Recolher Matriz ▲' : 'Expandir 10 Pilares ▼'}
        </button>
      </div>

      {expanded && (
        <div className="grid grid-cols-1 xs:grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5">
          {SETA_ERP_TEN_PILLARS.map((p) => {
            const Icon = p.icon;
            const isCurrent =
              activeSection === p.section &&
              (p.subId !== 'VENDAS_BALCAO' || activeSubId === 'VENDAS_BALCAO');
            return (
              <button
                key={p.num}
                type="button"
                onClick={() => onSelectPillar(p.section, p.subId)}
                className={`text-left p-2.5 rounded-md border border-l-4 ${p.accent} transition cursor-pointer flex flex-col justify-between gap-1.5 ${
                  isCurrent
                    ? 'bg-blue-50/70 border-slate-300 shadow-xs'
                    : 'bg-slate-50/60 hover:bg-white border-slate-200 hover:border-slate-300'
                }`}
              >
                <div>
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-[10px] font-normal text-slate-400">PILAR {p.num}</span>
                    <span className="px-1.5 py-0.2 rounded text-[9px] font-normal bg-emerald-100 text-emerald-800">
                      ● Ativo
                    </span>
                  </div>
                  <div className="text-xs font-normal text-[#1e3a6e] flex items-center gap-1.5 mt-0.5">
                    <Icon className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate">{p.title}</span>
                  </div>
                  <p className="text-[10px] text-slate-500 line-clamp-1 mt-0.5">{p.subtitle}</p>
                </div>
                <div className="pt-1 border-t border-slate-200/70 flex items-center justify-between text-[10px] font-normal text-slate-700">
                  <span className="truncate">{p.metrics}</span>
                  <ArrowRight className="w-3 h-3 text-[#1e3a6e] shrink-0" />
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// PILAR 9: PDV (FRENTE DE CAIXA / VENDA BALCÃO COM PIX, TROCO, NFC-E & FECHAMENTO)
// ============================================================================

interface PdvCartItem {
  id: string;
  sku: string;
  name: string;
  quantity: number;
  unitPrice: number;
  discountBrl: number;
}

export function SetaErpPdvPosView({
  catalog,
  companies,
  salesOrders,
  onRefresh,
  onShowToast,
  onOpenEmailModal,
}: {
  catalog: ErpCatalogItem[];
  companies: Company[];
  salesOrders: ErpSaleOrder[];
  onRefresh: () => Promise<void>;
  onShowToast: (msg: string) => void;
  onOpenEmailModal: (payload: ClientEmailInitialPayload) => void;
}) {
  const [searchSku, setSearchSku] = useState('');
  const [selectedClientName, setSelectedClientName] = useState('Consumidor Final / Venda Balcão');
  const [sellerName, setSellerName] = useState('Marcelo Mira');
  const [paymentMethod, setPaymentMethod] = useState<
    'PIX' | 'CARTAO' | 'DINHEIRO' | 'BOLETO_INTER' | 'CREDITO_CLIENTE'
  >('PIX');
  const [cashReceived, setCashReceived] = useState<string>('');
  const [globalDiscount, setGlobalDiscount] = useState<number>(0);
  const [submittingSale, setSubmittingSale] = useState(false);

  const [cart, setCart] = useState<PdvCartItem[]>(() => [
    {
      id: 'pdv-item-1',
      sku: 'SL-44-SEC-K9',
      name: 'Licença Cisco ISR 4400 Series Security (SL-44-SEC-K9)',
      quantity: 1,
      unitPrice: 4500,
      discountBrl: 180,
    },
  ]);

  const [emittedReceipt, setEmittedReceipt] = useState<{
    code: string;
    nfceNumber: string;
    date: string;
    clientName: string;
    sellerName: string;
    paymentMethod: string;
    items: PdvCartItem[];
    totalAmount: number;
    changeAmount: number;
  } | null>(null);

  const [shiftHistory, setShiftHistory] = useState<
    Array<{ code: string; client: string; method: string; amount: number; time: string }>
  >([
    { code: '2936', client: 'FOXCONN BRASIL INDUSTRIA E COMERCIO LTDA', method: 'PIX', amount: 6640, time: '09:42' },
    { code: '2935', client: 'IDEAL NETWORK COM DE EQUIP DE TELEFONIA', method: 'BOLETO_INTER', amount: 4280, time: '11:15' },
  ]);

  const addProductToCart = (item: ErpCatalogItem) => {
    setCart((prev) => {
      const idx = prev.findIndex((x) => x.sku === item.gestaoClickCode);
      if (idx >= 0) {
        const copy = [...prev];
        copy[idx] = { ...copy[idx], quantity: copy[idx].quantity + 1 };
        return copy;
      }
      return [
        ...prev,
        {
          id: `pdv-${Date.now()}`,
          sku: item.gestaoClickCode,
          name: item.name,
          quantity: 1,
          unitPrice: item.saleOrSetupPrice || item.monthlyRentalPrice || 450,
          discountBrl: 0,
        },
      ];
    });
  };

  const subtotalGross = cart.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
  const itemDiscounts = cart.reduce((s, i) => s + Number(i.discountBrl || 0), 0);
  const totalNet = Math.max(0, subtotalGross - itemDiscounts - Number(globalDiscount || 0));
  const cashNum = Number(cashReceived || 0);
  const changeBrl = paymentMethod === 'DINHEIRO' && cashNum > totalNet ? cashNum - totalNet : 0;

  const filteredCatalog = catalog.filter((c) => {
    if (!searchSku.trim()) return true;
    const q = searchSku.toLowerCase();
    return c.gestaoClickCode.toLowerCase().includes(q) || c.name.toLowerCase().includes(q);
  });

  const handleFinalizePdvSale = async () => {
    if (cart.length === 0) return;
    setSubmittingSale(true);
    const nextCode = String(2937 + salesOrders.length + shiftHistory.length);
    const nfceNum = `NFCe-65-000${nextCode}`;
    const todayBr = new Date().toLocaleDateString('pt-BR');

    try {
      await fetch('/api/erp/records/salesOrders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: `pdv-sale-${Date.now()}`,
          code: nextCode,
          companyName: selectedClientName,
          sellerName,
          date: todayBr,
          status: 'Concretizada',
          totalAmount: totalNet,
          itemsSummary: cart.map((i) => `${i.quantity}x ${i.sku}`).join(', '),
        }),
      });

      await fetch('/api/erp/financial', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'RECEBER',
          category: 'LOCACAO_EQUIPAMENTOS',
          description: `[PDV #${nextCode} • ${paymentMethod}] Venda Balcão (${cart.map((i) => i.sku).join(', ')})`,
          companyName: selectedClientName,
          costCenter: 'CC-PDV • Vendas Balcão Matriz #118887',
          amount: totalNet,
          dueDate: new Date().toISOString().slice(0, 10),
          status: 'PAGO',
          paymentMethod,
        }),
      });

      setShiftHistory((prev) => [
        {
          code: nextCode,
          client: selectedClientName,
          method: paymentMethod,
          amount: totalNet,
          time: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
        },
        ...prev,
      ]);

      setEmittedReceipt({
        code: nextCode,
        nfceNumber: nfceNum,
        date: `${todayBr} ${new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`,
        clientName: selectedClientName,
        sellerName,
        paymentMethod,
        items: [...cart],
        totalAmount: totalNet,
        changeAmount: changeBrl,
      });

      onShowToast(`Venda PDV #${nextCode} (${formatBRL(totalNet)}) finalizada e lançada no Caixa!`);
      await onRefresh();
    } finally {
      setSubmittingSale(false);
    }
  };

  const sumByMethod = (m: string) =>
    shiftHistory.filter((h) => h.method === m).reduce((s, h) => s + h.amount, 0);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* LEFT COLUMN (7 cols): CARRINHO PDV & BUSCA RÁPIDA DE PRODUTOS */}
        <div className="lg:col-span-7 bg-white rounded-md border border-slate-200 p-5 shadow-xs space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
            <div>
              <span className="text-[10px] font-normal uppercase text-rose-600 block">
                Pilar 9 • Frente de Caixa &amp; Venda Balcão (PDV Seta Telecom)
              </span>
              <h2 className="text-base font-semibold text-slate-900">
                PDV Rápido — Loja Matriz #118887
              </h2>
            </div>
            <span className="px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-800 text-xs font-normal">
              ● Caixa Aberto (Operador: {sellerName})
            </span>
          </div>

          {/* Client & Seller Row */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
            <div>
              <label className="block font-normal text-slate-700 mb-1">Cliente (ou Consumidor Balcão)</label>
              <select
                value={selectedClientName}
                onChange={(e) => setSelectedClientName(e.target.value)}
                className="w-full px-3 py-2 rounded border border-slate-300 bg-white font-normal"
              >
                <option value="Consumidor Final / Venda Balcão">Consumidor Final / Venda Balcão</option>
                <option value="MUNDIVOX COMUNICACOES LTDA">MUNDIVOX COMUNICACOES LTDA</option>
                {companies.map((c) => (
                  <option key={c.id} value={c.name}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block font-normal text-slate-700 mb-1">Vendedor / Operador de Caixa</label>
              <select
                value={sellerName}
                onChange={(e) => setSellerName(e.target.value)}
                className="w-full px-3 py-2 rounded border border-slate-300 bg-white font-normal"
              >
                <option value="Marcelo Mira">Marcelo Mira</option>
                <option value="Evelyn Olivia de Rosa Ternero">Evelyn Olivia de Rosa Ternero</option>
                <option value="Michelle da Rocha">Michelle da Rocha</option>
              </select>
            </div>
          </div>

          {/* Product Barcode / SKU Search + Quick Chips */}
          <div className="space-y-2">
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchSku}
                onChange={(e) => setSearchSku(e.target.value)}
                placeholder="Bipar código de barras, SKU (ex: SL-44-SEC-K9) ou nome do equipamento..."
                className="w-full pl-9 pr-4 py-2 rounded border border-slate-300 text-xs focus:outline-none focus:border-[#1e3a6e]"
              />
            </div>
            <div className="flex flex-wrap gap-1.5">
              {filteredCatalog.slice(0, 5).map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => addProductToCart(item)}
                  className="px-2.5 py-1 rounded border border-slate-200 bg-slate-50 hover:bg-blue-50 hover:border-[#1e3a6e] text-[11px] font-normal text-slate-700 cursor-pointer transition"
                >
                  + {item.gestaoClickCode} ({formatBRL(item.saleOrSetupPrice || item.monthlyRentalPrice)})
                </button>
              ))}
            </div>
          </div>

          {/* Cart Table */}
          <div className="border border-slate-200 rounded overflow-hidden">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-100 text-slate-600 uppercase text-[10px] border-b">
                <tr>
                  <th className="py-2 px-3">SKU / Produto</th>
                  <th className="py-2 px-2 text-center">Qtd</th>
                  <th className="py-2 px-2 text-right">Unitário</th>
                  <th className="py-2 px-2 text-right">Desconto (R$)</th>
                  <th className="py-2 px-3 text-right">Subtotal</th>
                  <th className="py-2 px-2 text-right"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {cart.map((it, idx) => {
                  const sub = Math.max(0, it.quantity * it.unitPrice - Number(it.discountBrl || 0));
                  return (
                    <tr key={it.id}>
                      <td className="py-2.5 px-3">
                        <div className="font-mono font-normal text-[#1e3a6e]">{it.sku}</div>
                        <div className="text-[11px] text-slate-600 truncate max-w-[210px]">{it.name}</div>
                      </td>
                      <td className="py-2.5 px-2">
                        <div className="flex items-center justify-center gap-1">
                          <button
                            type="button"
                            onClick={() => {
                              const copy = [...cart];
                              copy[idx].quantity = Math.max(1, copy[idx].quantity - 1);
                              setCart(copy);
                            }}
                            className="p-1 rounded border bg-slate-50 hover:bg-slate-100 cursor-pointer"
                          >
                            <Minus className="w-3 h-3" />
                          </button>
                          <span className="w-6 text-center font-normal">{it.quantity}</span>
                          <button
                            type="button"
                            onClick={() => {
                              const copy = [...cart];
                              copy[idx].quantity += 1;
                              setCart(copy);
                            }}
                            className="p-1 rounded border bg-slate-50 hover:bg-slate-100 cursor-pointer"
                          >
                            <Plus className="w-3 h-3" />
                          </button>
                        </div>
                      </td>
                      <td className="py-2.5 px-2 text-right font-normal">{formatBRL(it.unitPrice)}</td>
                      <td className="py-2.5 px-2 text-right">
                        <input
                          type="number"
                          min={0}
                          value={it.discountBrl}
                          onChange={(e) => {
                            const copy = [...cart];
                            copy[idx].discountBrl = Math.max(0, Number(e.target.value) || 0);
                            setCart(copy);
                          }}
                          className="w-20 px-2 py-1 rounded border text-right"
                        />
                      </td>
                      <td className="py-2.5 px-3 text-right font-normal text-slate-900">
                        {formatBRL(sub)}
                      </td>
                      <td className="py-2.5 px-2 text-right">
                        <button
                          type="button"
                          onClick={() => setCart(cart.filter((_, i) => i !== idx))}
                          className="p-1 text-rose-600 hover:bg-rose-50 rounded cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* RIGHT COLUMN (5 cols): PAGAMENTO & FECHAMENTO DE CUPOM NFC-E */}
        <div className="lg:col-span-5 bg-white rounded-md border border-slate-200 p-5 shadow-xs flex flex-col justify-between space-y-4">
          <div className="space-y-4">
            <div className="p-4 rounded-lg bg-[#1e3a6e] text-white flex items-center justify-between">
              <div>
                <span className="text-[10px] font-normal uppercase text-emerald-300 block">
                  Total Líquido a Pagar (PDV)
                </span>
                <div className="text-2xl font-normal mt-0.5">{formatBRL(totalNet)}</div>
                <span className="text-[11px] text-slate-200">
                  Bruto: {formatBRL(subtotalGross)} • Descontos: {formatBRL(itemDiscounts + globalDiscount)}
                </span>
              </div>
              <ShoppingCart className="w-8 h-8 text-emerald-300" />
            </div>

            <div>
              <label className="block text-xs font-normal uppercase text-slate-700 mb-2">
                Selecione a Forma de Pagamento
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                {[
                  { id: 'PIX', label: 'Pix Instantâneo (QR Code)', icon: QrCode },
                  { id: 'CARTAO', label: 'Cartão Crédito / Débito', icon: CreditCard },
                  { id: 'DINHEIRO', label: 'Dinheiro (Cálculo Troco)', icon: Banknote },
                  { id: 'BOLETO_INTER', label: 'Boleto Banco Inter', icon: Landmark },
                  { id: 'CREDITO_CLIENTE', label: 'Crédito / Vale-Compras', icon: Gift },
                ].map((pm) => {
                  const Icon = pm.icon;
                  const active = paymentMethod === pm.id;
                  return (
                    <button
                      key={pm.id}
                      type="button"
                      onClick={() => setPaymentMethod(pm.id as typeof paymentMethod)}
                      className={`p-2.5 rounded border text-left font-normal flex items-center gap-2 cursor-pointer transition ${
                        active
                          ? 'border-[#1e3a6e] bg-blue-50 text-[#1e3a6e]'
                          : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-white'
                      }`}
                    >
                      <Icon className="w-4 h-4 shrink-0" />
                      <span className="truncate">{pm.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {paymentMethod === 'DINHEIRO' && (
              <div className="p-3 rounded bg-amber-50 border border-amber-200 grid grid-cols-2 gap-3 text-xs">
                <div>
                  <label className="block font-normal text-amber-900 mb-1">Valor Recebido (R$)</label>
                  <input
                    type="number"
                    value={cashReceived}
                    onChange={(e) => setCashReceived(e.target.value)}
                    placeholder={String(totalNet)}
                    className="w-full px-2.5 py-1.5 rounded border bg-white font-normal"
                  />
                </div>
                <div>
                  <span className="block font-normal text-amber-900 mb-1">Troco a Devolver</span>
                  <div className="text-base font-normal text-emerald-700 pt-1">
                    {formatBRL(changeBrl)}
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="space-y-2 pt-3 border-t border-slate-200">
            <button
              type="button"
              disabled={submittingSale || cart.length === 0}
              onClick={handleFinalizePdvSale}
              className="w-full py-3 px-4 rounded-md bg-emerald-600 hover:bg-emerald-500 text-white text-xs sm:text-sm font-normal shadow-md flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
            >
              <CheckCircle2 className="w-4 h-4" />
              {submittingSale
                ? 'Processando Venda PDV...'
                : `Finalizar Venda PDV (${formatBRL(totalNet)}) & Emitir Cupom`}
            </button>
          </div>
        </div>
      </div>

      {/* CONFERÊNCIA E FECHAMENTO DE CAIXA POR FORMA DE PAGAMENTO */}
      <div className="bg-white rounded-md border border-slate-200 p-4 shadow-xs space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-xs font-semibold uppercase text-slate-800">
              Conferência de Caixa do Turno por Forma de Pagamento (Matriz #118887)
            </h3>
            <p className="text-[11px] text-slate-500">
              Conciliação automática das vendas realizadas no balcão/PDV.
            </p>
          </div>
          <span className="text-xs font-normal text-emerald-700">
            Total no Turno: {formatBRL(shiftHistory.reduce((s, h) => s + h.amount, 0))}
          </span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5 text-xs">
          {[
            ['PIX', 'Pix Instantâneo'],
            ['CARTAO', 'Cartão Créd./Déb.'],
            ['DINHEIRO', 'Dinheiro em Espécie'],
            ['BOLETO_INTER', 'Boleto Banco Inter'],
            ['CREDITO_CLIENTE', 'Crédito do Cliente'],
          ].map(([key, label]) => (
            <div key={key} className="p-2.5 rounded border border-slate-200 bg-slate-50">
              <span className="text-[10px] text-slate-500 block">{label}</span>
              <span className="text-sm font-normal text-slate-900">
                {formatBRL(sumByMethod(key))}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* MODAL CUPOM FISCAL / RECIBO PDV IMPRIMÍVEL */}
      {emittedReceipt && (
        <div className="fixed inset-0 z-50 bg-slate-900/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-lg border border-slate-300 shadow-2xl max-w-md w-full overflow-hidden">
            <div className="px-5 py-3.5 bg-[#1e3a6e] text-white flex items-center justify-between">
              <span className="text-xs font-normal">
                Cupom PDV / NFC-e #{emittedReceipt.code}
              </span>
              <button
                type="button"
                onClick={() => setEmittedReceipt(null)}
                className="text-slate-300 hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 space-y-3 text-xs font-mono text-slate-800">
              <div className="text-center border-b border-dashed border-slate-300 pb-3">
                <div className="font-normal text-sm">SETA TELECOM LTDA (SETA | IT)</div>
                <div>CNPJ 14.806.925/0001-32 • Loja Matriz #118887</div>
                <div>Documento Auxiliar NFC-e: {emittedReceipt.nfceNumber}</div>
                <div>Data: {emittedReceipt.date}</div>
              </div>
              <div>
                <div>Cliente: <span>{emittedReceipt.clientName}</span></div>
                <div>Vendedor: {emittedReceipt.sellerName}</div>
                <div>Forma Pagto: <span>{emittedReceipt.paymentMethod}</span></div>
              </div>
              <div className="border-y border-dashed border-slate-300 py-2 space-y-1">
                {emittedReceipt.items.map((it) => (
                  <div key={it.id} className="flex justify-between">
                    <span>
                      {it.quantity}x {it.sku}
                    </span>
                    <span>{formatBRL(it.quantity * it.unitPrice - it.discountBrl)}</span>
                  </div>
                ))}
              </div>
              <div className="flex justify-between text-sm font-normal">
                <span>TOTAL PAGO:</span>
                <span>{formatBRL(emittedReceipt.totalAmount)}</span>
              </div>
              <div className="pt-3 flex flex-wrap items-center justify-end gap-2 font-sans">
                <button
                  type="button"
                  onClick={() => {
                    onOpenEmailModal({
                      docType: 'FISCAL_INVOICE',
                      companyName: emittedReceipt.clientName,
                      documentCode: `PDV-${emittedReceipt.code}`,
                      amountBrl: emittedReceipt.totalAmount,
                    });
                  }}
                  className="px-3 py-2 rounded bg-sky-600 text-white text-xs font-normal cursor-pointer inline-flex items-center gap-1"
                >
                  <Mail className="w-3.5 h-3.5" /> Enviar por E-mail
                </button>
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="px-3 py-2 rounded bg-[#ff7a59] text-white text-xs font-normal cursor-pointer inline-flex items-center gap-1"
                >
                  <Printer className="w-3.5 h-3.5" /> Imprimir Cupom
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// PILAR 4: ESTOQUE E COMPRAS (MOVIMENTAÇÕES, AJUSTES, TRANSFERÊNCIAS, COTAÇÕES & OCs)
// ============================================================================

const SAMPLE_SEFAZ_NFE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">
  <NFe>
    <infNFe Id="NFe35261068993641000802550010000102451000102459" versao="4.00">
      <ide>
        <cUF>35</cUF>
        <natOp>VENDA DE EQUIPAMENTOS TELECOM E REDES</natOp>
        <mod>55</mod>
        <serie>1</serie>
        <nNF>10245</nNF>
        <dhEmi>2026-10-26T10:30:00-03:00</dhEmi>
      </ide>
      <emit>
        <CNPJ>68993641000802</CNPJ>
        <xNome>AGIS EQUIPAMENTOS E SERVICOS DE INFORMATICA LTDA.</xNome>
        <xFant>AGIS DISTRIBUIDORA TI &amp; TELECOM</xFant>
      </emit>
      <dest>
        <CNPJ>14806925000132</CNPJ>
        <xNome>SETA TELECOM LTDA</xNome>
      </dest>
      <det nItem="1">
        <prod>
          <cProd>SIP-T46U</cProd>
          <xProd>Telefone IP Gigabit Yealink SIP-T46U Dual USB PoE</xProd>
          <NCM>85171899</NCM>
          <CFOP>5102</CFOP>
          <uCom>UN</uCom>
          <qCom>4</qCom>
          <vUnCom>1450.00</vUnCom>
          <vProd>5800.00</vProd>
        </prod>
        <infAdProd>S/N: SN-YLK-T46U-9901, SN-YLK-T46U-9902, SN-YLK-T46U-9903, SN-YLK-T46U-9904</infAdProd>
      </det>
      <det nItem="2">
        <prod>
          <cProd>SL-44-SEC-K9</cProd>
          <xProd>Appliance Router &amp; Licenca Cisco ISR 4400 Series Security</xProd>
          <NCM>85176259</NCM>
          <CFOP>5102</CFOP>
          <uCom>UN</uCom>
          <qCom>2</qCom>
          <vUnCom>3100.00</vUnCom>
          <vProd>6200.00</vProd>
        </prod>
        <infAdProd>S/N: SN-CISCO-4400-8811, SN-CISCO-4400-8812</infAdProd>
      </det>
      <total>
        <ICMSTot>
          <vProd>12000.00</vProd>
          <vICMS>2160.00</vICMS>
          <vPIS>78.00</vPIS>
          <vCOFINS>360.00</vCOFINS>
          <vNF>12000.00</vNF>
        </ICMSTot>
      </total>
    </infNFe>
  </NFe>
</nfeProc>`;

export function SetaErpStockAndPurchasesSubbar({
  activeSubId,
  onSelectSubId,
  catalogCount,
  purchasesCount,
  suppliers,
  onCreatePurchaseOrder,
  onCreateStockTransfer,
  onRefresh,
  onShowToast,
}: {
  activeSubId: string;
  onSelectSubId: (subId: string) => void;
  catalogCount: number;
  purchasesCount: number;
  suppliers: ErpSupplierRecord[];
  onCreatePurchaseOrder: () => void;
  onCreateStockTransfer: () => void;
  onRefresh?: () => Promise<void>;
  onShowToast?: (msg: string) => void;
}) {
  const [showXmlModal, setShowXmlModal] = useState(false);
  const [xmlContent, setXmlContent] = useState(SAMPLE_SEFAZ_NFE_XML);
  const [cfopEntrada, setCfopEntrada] = useState(
    '1.551 — Compra de bem para o Ativo Imobilizado (Parque de Locação)'
  );
  const [costCenter, setCostCenter] = useState('CC-201 • CAPEX Ativos para Locação');
  const [autoReceiveStock, setAutoReceiveStock] = useState(true);
  const [importingXml, setImportingXml] = useState(false);
  const [importedResult, setImportedResult] = useState<{
    poCode: string;
    nfeNumber: string;
    supplierName: string;
    nfeAccessKey: string;
    totalAmount: number;
    serialCount: number;
  } | null>(null);

  const tabs = [
    { id: 'EST_MOVIMENTACOES', label: `Movimentações & S/N (${catalogCount})` },
    { id: 'EST_AJUSTES', label: 'Ajustes de Inventário' },
    { id: 'EST_TRANSFERENCIAS', label: 'Transferências Matriz / Clientes' },
    { id: 'EST_COTACOES', label: `Cotações (${suppliers.length} Fornecedores)` },
    { id: 'EST_COMPRAS', label: `Ordens de Compra / NF-e Entrada (${purchasesCount})` },
  ];

  const handleImportNfeXml = async () => {
    if (!xmlContent.trim()) return;
    setImportingXml(true);
    try {
      const res = await fetch('/api/erp/purchases/import-xml', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          xmlContent,
          cfopEntrada,
          costCenter,
          autoReceiveStock,
        }),
      });
      if (res.ok) {
        const json = await res.json();
        const po = json?.data?.purchaseOrder;
        const cats = json?.data?.updatedCatalogItems || [];
        if (po) recordUpsertedPurchaseOrder(po);
        for (const c of cats) recordUpsertedCatalogItem(c);
        setImportedResult({
          poCode: po?.code || '55',
          nfeNumber: po?.nfeNumber || '000.010.245',
          supplierName: po?.supplierName || 'Fornecedor Homologado',
          nfeAccessKey: po?.nfeAccessKey || '',
          totalAmount: Number(po?.totalAmount || 0),
          serialCount: Array.isArray(po?.serialNumbers) ? po.serialNumbers.length : 0,
        });
        onShowToast?.(
          `NF-e XML ${po?.nfeNumber} importada com sucesso! OC #${po?.code} criada e S/N registrados no estoque.`
        );
        onSelectSubId('EST_COMPRAS');
        if (onRefresh) await onRefresh();
      }
    } finally {
      setImportingXml(false);
    }
  };

  return (
    <div className="bg-white rounded-md border border-slate-200 p-3.5 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {tabs.map((t) => {
            const on = activeSubId === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => onSelectSubId(t.id)}
                className={`px-3 py-1.5 rounded text-xs font-normal cursor-pointer transition ${
                  on
                    ? 'bg-[#1e3a6e] text-white'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                {t.label}
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setImportedResult(null);
              setShowXmlModal(true);
            }}
            className="px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-normal cursor-pointer inline-flex items-center gap-1.5"
          >
            <FileText className="w-3.5 h-3.5" /> Importar XML NF-e (SEFAZ)
          </button>
          <button
            type="button"
            onClick={onCreateStockTransfer}
            className="px-3 py-1.5 rounded border border-slate-300 bg-white hover:bg-slate-50 text-xs font-normal text-slate-800 cursor-pointer inline-flex items-center gap-1"
          >
            <ArrowLeftRight className="w-3.5 h-3.5 text-[#1e3a6e]" /> + Transferência / Ajuste
          </button>
          <button
            type="button"
            onClick={onCreatePurchaseOrder}
            className="px-3.5 py-1.5 rounded bg-[#1e3a6e] hover:bg-[#162b54] text-white text-xs font-normal cursor-pointer inline-flex items-center gap-1"
          >
            <Truck className="w-3.5 h-3.5 text-emerald-300" /> + Nova Cotação / Ordem de Compra
          </button>
        </div>
      </div>

      {showXmlModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-lg border border-slate-300 shadow-2xl max-w-2xl w-full overflow-hidden">
            <div className="px-6 py-4 bg-[#1e3a6e] text-white flex items-center justify-between">
              <div>
                <span className="text-[10px] font-normal uppercase text-emerald-300 block">
                  Pilar 4 • Escrituração Automática SEFAZ Modelo 55 (Seta Telecom #118887)
                </span>
                <h3 className="text-sm font-semibold">
                  Importador de Arquivo XML de NF-e de Fornecedor (Compras &amp; Estoque S/N)
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowXmlModal(false)}
                className="text-slate-300 hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-4 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-normal text-slate-700 mb-1">
                    Enquadramento CFOP de Entrada
                  </label>
                  <select
                    value={cfopEntrada}
                    onChange={(e) => setCfopEntrada(e.target.value)}
                    className="w-full px-3 py-2 rounded border border-slate-300 bg-white font-normal"
                  >
                    <option value="1.551 — Compra de bem para o Ativo Imobilizado (Parque de Locação)">
                      1.551 — Ativo Imobilizado (Parque de Locação)
                    </option>
                    <option value="2.551 — Compra interestadual de bem para o Ativo Imobilizado">
                      2.551 — Ativo Imobilizado Interestadual
                    </option>
                    <option value="1.102 — Compra para comercialização / revenda de hardware">
                      1.102 — Compra para Comercialização / Revenda
                    </option>
                    <option value="2.102 — Compra interestadual para comercialização">
                      2.102 — Compra Interestadual para Revenda
                    </option>
                  </select>
                </div>
                <div>
                  <label className="block font-normal text-slate-700 mb-1">Centro de Custo</label>
                  <input
                    type="text"
                    value={costCenter}
                    onChange={(e) => setCostCenter(e.target.value)}
                    className="w-full px-3 py-2 rounded border border-slate-300 bg-white font-normal"
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2">
                <label className="inline-flex items-center gap-2 font-normal text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={autoReceiveStock}
                    onChange={(e) => setAutoReceiveStock(e.target.checked)}
                    className="w-4 h-4 accent-[#1e3a6e]"
                  />
                  Dar entrada física imediata no Estoque Matriz #118887 e registrar Números de Série (S/N)
                </label>

                <label className="px-3 py-1.5 rounded bg-slate-100 hover:bg-slate-200 border border-slate-300 font-normal text-slate-800 cursor-pointer">
                  Selecionar Arquivo .XML
                  <input
                    type="file"
                    accept=".xml,text/xml"
                    className="hidden"
                    onChange={async (e) => {
                      const f = e.target.files?.[0];
                      if (f) {
                        setXmlContent(await f.text());
                      }
                    }}
                  />
                </label>
              </div>

              <div>
                <label className="block font-normal text-slate-700 mb-1">
                  Conteúdo XML da NF-e (Padrão SEFAZ 4.00 — tags &lt;infNFe&gt;, &lt;emit&gt;, &lt;det&gt;, &lt;ICMSTot&gt;)
                </label>
                <textarea
                  value={xmlContent}
                  onChange={(e) => setXmlContent(e.target.value)}
                  rows={7}
                  className="w-full p-2.5 rounded border border-slate-300 font-mono text-[11px] text-slate-800"
                />
              </div>

              {importedResult && (
                <div className="p-3.5 rounded bg-emerald-50 border border-emerald-200 space-y-1 text-emerald-950">
                  <div className="font-normal flex items-center gap-1.5">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                    NF-e {importedResult.nfeNumber} Escriturada — Ordem de Compra #{importedResult.poCode}
                  </div>
                  <div className="text-[11px]">
                    Emitente: <span>{importedResult.supplierName}</span> • Total:{' '}
                    <span>{formatBRL(importedResult.totalAmount)}</span> •{' '}
                    <span>{importedResult.serialCount} S/N</span> incorporados ao almoxarifado.
                  </div>
                  {importedResult.nfeAccessKey && (
                    <div className="font-mono text-[10px] text-emerald-800">
                      Chave SEFAZ (44 dígitos): {importedResult.nfeAccessKey}
                    </div>
                  )}
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setShowXmlModal(false)}
                  className="px-4 py-2 rounded border border-slate-300 text-slate-700 font-normal cursor-pointer"
                >
                  Fechar
                </button>
                <button
                  type="button"
                  disabled={importingXml}
                  onClick={handleImportNfeXml}
                  className="px-4 py-2 rounded bg-emerald-600 hover:bg-emerald-700 text-white font-normal cursor-pointer disabled:opacity-50"
                >
                  {importingXml ? 'Importando XML SEFAZ...' : 'Processar XML & Gerar Ordem de Compra'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
