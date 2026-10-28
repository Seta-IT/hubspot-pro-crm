'use client';

import React, { useEffect, useState } from 'react';
import {
  Megaphone,
  Mail,
  Users,
  FileCode2,
  Send,
  Target,
  BookOpen,
  Calendar,
  ShieldCheck,
  Building2,
  Globe,
  CheckCircle2,
  AlertTriangle,
} from 'lucide-react';
import { formatBRL } from './ui-helpers';
import { ClientEmailInitialPayload } from './ClientEmailComposerModal';
import type {
  AccountEngagementSummary,
  MarketingCampaign,
  MarketingLandingPage,
  MarketingSegment,
  SuppressionEntry,
} from '../../db/types';

// ============================================================================
// 1. MARKETING HUB PRO + MAILCHIMP + SALES ENGAGEMENT SUITE (SETA TELECOM)
// ============================================================================

export type MarketingHubSubView =
  | 'CAMPAIGNS_ROI'
  | 'EMAIL_MARKETING'
  | 'SEGMENTS_SCORING'
  | 'FORMS_LANDING_PAGES';

const INITIAL_CAMPAIGNS: MarketingCampaign[] = [
  {
    id: 'cmp-1',
    name: 'Campanha ABM Q4 — Substituição CAPEX por Locação Pura (0% ISS — SV 31 STF)',
    objective: 'Gerar oportunidades de locação recorrente de servidores, switches PoE e FortiGate SD-WAN.',
    status: 'ACTIVE',
    channel: 'LinkedIn Ads + E-mail ABM + Landing Page',
    sendingProvider: 'MARKETING_ESP',
    utmCampaign: 'abm-q4-locacao-sv31',
    budgetBrl: 18500,
    sessions: 4820,
    sentCount: 6450,
    deliveredCount: 6280,
    uniqueClicksCount: 840,
    repliesCount: 512,
    unsubscribesCount: 18,
    bouncesCount: 170,
    contactsGenerated: 142,
    mqlCount: 64,
    sqlCount: 28,
    opportunitiesCount: 94,
    attributedDeals: 9,
    wonDealsCount: 3,
    attributedRevenueBrl: 634000,
    ownerName: 'Marcelo Lopes Mira',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'cmp-2',
    name: 'Modernização Telefonia IP & Cluster PABX Cloud High-Availability',
    objective: 'Substituir centrais legadas E1 por clusters PABX IP Yealink/Seta Cloud.',
    status: 'ACTIVE',
    channel: 'Google Search + Cadência Outlook 1:1 + Webinar',
    sendingProvider: 'OUTLOOK_M365',
    utmCampaign: 'modernizacao-pabx-ip-ha',
    budgetBrl: 12000,
    sessions: 3190,
    sentCount: 3800,
    deliveredCount: 3690,
    uniqueClicksCount: 490,
    repliesCount: 344,
    unsubscribesCount: 11,
    bouncesCount: 110,
    contactsGenerated: 96,
    mqlCount: 41,
    sqlCount: 19,
    opportunitiesCount: 56,
    attributedDeals: 6,
    wonDealsCount: 2,
    attributedRevenueBrl: 412000,
    ownerName: 'Evelyn Ternero Seta Telecom',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'cmp-3',
    name: 'SD-WAN FortiGate Dual-WAN, Renovação & Spare Parts Base GestãoClick (#118887)',
    objective: 'Expansão de contratos ativos, renovação 24/36m e oferta de redundância BGP/SD-WAN.',
    status: 'IN_PROGRESS',
    channel: 'E-mail Marketing Base GestãoClick (#118887)',
    sendingProvider: 'MARKETING_ESP',
    utmCampaign: 'sdwan-fortigate-renovacao-gc',
    budgetBrl: 8500,
    sessions: 2150,
    sentCount: 2200,
    deliveredCount: 2110,
    uniqueClicksCount: 290,
    repliesCount: 190,
    unsubscribesCount: 8,
    bouncesCount: 90,
    contactsGenerated: 78,
    mqlCount: 35,
    sqlCount: 14,
    opportunitiesCount: 34,
    attributedDeals: 5,
    wonDealsCount: 2,
    attributedRevenueBrl: 298000,
    ownerName: 'Marcelo Lopes Mira',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
];

const INITIAL_SEGMENTS: MarketingSegment[] = [
  {
    id: 'seg-abm-tier1-decisores',
    name: 'Contas Alvo ABM Tier 1 (Decisores C-Level & VP)',
    description: 'Decisores e Compradores Econômicos em contas corporativas Tier 1 elegíveis para campanhas.',
    type: 'DYNAMIC',
    filterExpression: "company.icpTier = 'TIER_1' AND contact.buyingRole IN ('DECISOR','COMPRADOR_ECONOMICO') AND subscriptionStatus = 'SUBSCRIBED'",
    criteria: { icpTier: 'TIER_1', targetAccountOnly: true, onlySubscribedEligible: true },
    count: 6,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'seg-sql-high-score',
    name: 'Leads Quentes & Oportunidades (Lead Score >= 80 pts)',
    description: 'Contatos altamente engajados com Lead Score >= 80 e opt-in LGPD válido.',
    type: 'DYNAMIC',
    filterExpression: 'contact.leadScore >= 80 AND contact.lgpdConsent = true',
    criteria: { minLeadScore: 80, onlySubscribedEligible: true },
    count: 6,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'seg-multi-thread-accounts',
    name: 'Contas com Engajamento Multi-Contato (Account-Based Engagement)',
    description: 'Empresas onde múltiplos decisores interagiram com campanhas, cadências ou propostas.',
    type: 'DYNAMIC',
    filterExpression: 'company.engagedContactsCount >= 2',
    criteria: { minCompanyEngagedContacts: 2, onlySubscribedEligible: true },
    count: 4,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'seg-clientes-locacao-gc',
    name: 'Carteira Ativa Locação & Contratos GestãoClick (#118887)',
    description: 'Base de clientes com contrato de locação/serviços ativo para renovação e spare parts.',
    type: 'STATIC',
    filterExpression: "lifecyclestage = 'CUSTOMER' AND gestaoclick_contract_active = true",
    criteria: { lifecycleStage: 'CUSTOMER', onlySubscribedEligible: true },
    count: 344,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
];

const INITIAL_LANDING_PAGES: MarketingLandingPage[] = [
  {
    id: 'lp-locacao-sv31',
    name: 'LP Executiva — Locação Pura de Servidores, PABX IP & SD-WAN (0% ISS SV 31 STF)',
    slug: 'locacao-equipamentos-ti-telecom-sv31',
    title: 'Substitua CAPEX por Locação Pura com 0% de ISSQN e SLA NOC 24x7',
    subtitle: 'Simule a redução imediata de TCO em servidores, switches PoE, terminais IP Yealink e firewalls FortiGate.',
    formId: 'form-enterprise-demo',
    campaignId: 'cmp-1',
    utmCampaign: 'abm-q4-locacao-sv31',
    status: 'PUBLISHED',
    viewsCount: 2480,
    submissionsCount: 184,
    conversionRate: 7.42,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'lp-playbook-revops',
    name: 'LP Inbound — Guia de Alta Disponibilidade Telecom & Governança B2B',
    slug: 'guia-alta-disponibilidade-telecom-2026',
    title: 'Arquitetura de Redundância BGP, Entroncamento SIP TLS e Continuidade Operacional',
    subtitle: 'Material técnico elaborado pela Engenharia N3 da Seta Telecom para CTOs e gestores de infraestrutura.',
    formId: 'form-revops-guide',
    campaignId: 'cmp-2',
    utmCampaign: 'modernizacao-pabx-ip-ha',
    status: 'PUBLISHED',
    viewsCount: 3250,
    submissionsCount: 645,
    conversionRate: 19.85,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
];

export function MarketingHubSuiteTop({
  activeView,
  onSelectView,
  onOpenEmailModal,
}: {
  activeView: MarketingHubSubView;
  onSelectView: (v: MarketingHubSubView) => void;
  onOpenEmailModal?: (payload: ClientEmailInitialPayload) => void;
}) {
  const [campaigns, setCampaigns] = useState<MarketingCampaign[]>(INITIAL_CAMPAIGNS);
  const [segments, setSegments] = useState<MarketingSegment[]>(INITIAL_SEGMENTS);
  const [landingPages, setLandingPages] = useState<MarketingLandingPage[]>(INITIAL_LANDING_PAGES);
  const [accountEngagement, setAccountEngagement] = useState<AccountEngagementSummary[]>([]);
  const [suppressionList, setSuppressionList] = useState<SuppressionEntry[]>([]);

  const [newCmpName, setNewCmpName] = useState('');
  const [newCmpBudget, setNewCmpBudget] = useState('15000');
  const [newCmpProvider, setNewCmpProvider] = useState<'MARKETING_ESP' | 'OUTLOOK_M365'>('MARKETING_ESP');
  const [newCmpUtm, setNewCmpUtm] = useState('');

  const [newSegName, setNewSegName] = useState('');
  const [newSegFilter, setNewSegFilter] = useState("company.icpTier = 'TIER_1' AND contact.leadScore >= 75");

  const [newLpName, setNewLpName] = useState('');
  const [newLpUtm, setNewLpUtm] = useState('locacao-servidores-q4');

  const [dispatchStatusMsg, setDispatchStatusMsg] = useState<string | null>(null);

  const loadMarketingData = async () => {
    try {
      const [cmpRes, segRes, lpRes, prefRes] = await Promise.all([
        fetch('/api/marketing/campaigns'),
        fetch('/api/marketing/segments'),
        fetch('/api/marketing/landing-pages'),
        fetch('/api/marketing/preferences'),
      ]);
      if (cmpRes.ok) {
        const json = await cmpRes.json();
        if (Array.isArray(json.data) && json.data.length > 0) setCampaigns(json.data);
        if (Array.isArray(json.accountEngagement)) setAccountEngagement(json.accountEngagement);
      }
      if (segRes.ok) {
        const json = await segRes.json();
        if (Array.isArray(json.data) && json.data.length > 0) setSegments(json.data);
      }
      if (lpRes.ok) {
        const json = await lpRes.json();
        if (Array.isArray(json.data) && json.data.length > 0) setLandingPages(json.data);
      }
      if (prefRes.ok) {
        const json = await prefRes.json();
        if (Array.isArray(json.suppressionList)) setSuppressionList(json.suppressionList);
      }
    } catch {
      // Fallback to initial seed state if offline
    }
  };

  useEffect(() => {
    void loadMarketingData();
  }, []);

  const handleAddCampaign = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCmpName.trim()) return;
    try {
      const res = await fetch('/api/marketing/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newCmpName.trim(),
          budgetBrl: Number(newCmpBudget) || 15000,
          sendingProvider: newCmpProvider,
          utmCampaign: newCmpUtm.trim() || undefined,
          channel:
            newCmpProvider === 'OUTLOOK_M365'
              ? 'Cadência Comercial 1:1 (Microsoft 365 Graph)'
              : 'E-mail Marketing ABM + Landing Page (ESP)',
        }),
      });
      if (res.ok) {
        const json = await res.json();
        if (json.data) {
          setCampaigns((prev) => [json.data, ...prev]);
        }
      }
    } catch {
      // ignore
    }
    setNewCmpName('');
    setNewCmpUtm('');
  };

  const handleAddSegment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSegName.trim()) return;
    try {
      const res = await fetch('/api/marketing/segments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newSegName.trim(),
          type: 'DYNAMIC',
          filterExpression: newSegFilter.trim(),
          criteria: { onlySubscribedEligible: true },
        }),
      });
      if (res.ok) {
        const json = await res.json();
        if (json.data) {
          setSegments((prev) => [json.data, ...prev]);
        }
      }
    } catch {
      // ignore
    }
    setNewSegName('');
  };

  const handleAddLandingPage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newLpName.trim()) return;
    try {
      const res = await fetch('/api/marketing/landing-pages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newLpName.trim(),
          title: newLpName.trim(),
          utmCampaign: newLpUtm.trim() || 'campanha-abm-seta',
          formId: 'form-enterprise-demo',
          campaignId: campaigns[0]?.id || 'cmp-1',
        }),
      });
      if (res.ok) {
        const json = await res.json();
        if (json.data) {
          setLandingPages((prev) => [json.data, ...prev]);
        }
      }
    } catch {
      // ignore
    }
    setNewLpName('');
  };

  const handleValidatedCampaignDispatch = async (campaignId: string) => {
    try {
      const res = await fetch('/api/marketing/campaigns/dispatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ campaignId }),
      });
      if (res.ok) {
        const json = await res.json();
        const d = json.data;
        setDispatchStatusMsg(
          `Disparo validado (${d.deliveryChannel}): ${d.dispatchedCount} contatos elegíveis enviados | ${d.blockedSuppressedCount} bloqueados pela lista de supressão LGPD/Bounce.`
        );
        void loadMarketingData();
      }
    } catch {
      // ignore
    }
  };

  const totalSent = campaigns.reduce((s, c) => s + (c.sentCount || 0), 0) || 12450;
  const totalDelivered = campaigns.reduce((s, c) => s + (c.deliveredCount || 0), 0) || 12080;
  const totalUniqueClicks = campaigns.reduce((s, c) => s + (c.uniqueClicksCount || 0), 0) || 1620;
  const totalReplies = campaigns.reduce((s, c) => s + (c.repliesCount || 0), 0) || 1046;
  const totalOpportunities = campaigns.reduce((s, c) => s + (c.opportunitiesCount || 0), 0) || 184;
  const totalUnsubscribes = campaigns.reduce((s, c) => s + (c.unsubscribesCount || 0), 0) || 37;
  const replyRatePct = totalSent > 0 ? ((totalReplies / totalSent) * 100).toFixed(1).replace('.', ',') : '8,4';

  return (
    <div className="space-y-4">
      {/* MARKETING HUB NAVIGATION BAR (CORPORATE CLEAN — ZERO EMOJIS) */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-2xs flex flex-wrap items-center justify-between gap-3">
        <div>
          <span className="text-[10px] font-semibold uppercase text-[#e05835] block">
            STI-hub • Email Marketing, Cadências &amp; Sales Engagement (HubSpot Pro + Mailchimp — Seta Telecom)
          </span>
          <h2 className="text-base sm:text-lg font-semibold text-slate-900">
            Marketing Hub &amp; Sales Engagement — Campanhas, Audiências ABM, UTMs, LGPD &amp; Receita
          </h2>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {(
            [
              ['CAMPAIGNS_ROI', 'Campanhas, Funil & Receita (ROI)', Megaphone],
              ['EMAIL_MARKETING', 'E-mail Marketing & Motores de Envio', Mail],
              ['SEGMENTS_SCORING', 'Segmentos, Contas ABM & LGPD', Users],
              ['FORMS_LANDING_PAGES', 'Landing Pages, Formulários & UTMs', FileCode2],
            ] as const
          ).map(([id, label, Icon]) => {
            const on = activeView === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => onSelectView(id)}
                className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold cursor-pointer transition ${
                  on
                    ? 'bg-[#ff7a59] text-white shadow-xs'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {/* PAINEL EXECUTIVO EMAIL & SALES ENGAGEMENT (ESPECIFICACAO SETA TELECOM — ULTIMOS 30 DIAS) */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-2xs space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
          <div>
            <span className="text-[10px] font-semibold uppercase tracking-wider text-[#1e3a6e]">
              Email &amp; Sales Engagement • Últimos 30 dias
            </span>
            <h3 className="text-sm font-semibold text-slate-900">
              Funil Consolidado de Engajamento Comercial &amp; Marketing Conectado ao CRM/ERP
            </h3>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-[11px]">
            <span className="px-2.5 py-1 rounded-lg bg-blue-50 text-[#1e3a6e] border border-blue-200 font-semibold">
              Vendas 1:1: Microsoft 365 / Outlook Graph
            </span>
            <span className="px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-800 border border-emerald-200 font-semibold">
              Marketing em Massa: Provedor ESP Dedicado (SPF/DKIM/DMARC)
            </span>
          </div>
        </div>

        {/* 4 TOP KPIs */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
          <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200">
            <span className="text-slate-500 block">E-mails enviados</span>
            <strong className="text-xl font-semibold text-slate-900">
              {totalSent.toLocaleString('pt-BR')}
            </strong>
          </div>
          <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200">
            <span className="text-slate-500 block">Taxa de resposta</span>
            <strong className="text-xl font-semibold text-emerald-700">{replyRatePct}%</strong>
          </div>
          <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200">
            <span className="text-slate-500 block">Contatos engajados</span>
            <strong className="text-xl font-semibold text-[#0091ae]">1.280</strong>
          </div>
          <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200">
            <span className="text-slate-500 block">Descadastros</span>
            <strong className="text-xl font-semibold text-rose-700">{totalUnsubscribes}</strong>
          </div>
        </div>

        {/* FUNIL DE ENGAJAMENTO + CADENCIAS ATIVAS */}
        <div className="grid grid-cols-2 sm:grid-cols-6 gap-2.5 text-xs">
          {[
            { label: 'Enviados', value: totalSent.toLocaleString('pt-BR'), tone: 'text-slate-900' },
            { label: 'Entregues', value: totalDelivered.toLocaleString('pt-BR'), tone: 'text-slate-800' },
            { label: 'Cliques únicos', value: totalUniqueClicks.toLocaleString('pt-BR'), tone: 'text-[#0091ae]' },
            { label: 'Respostas', value: totalReplies.toLocaleString('pt-BR'), tone: 'text-indigo-700' },
            { label: 'Oportunidades', value: totalOpportunities.toLocaleString('pt-BR'), tone: 'text-emerald-700' },
            { label: 'Cadências ativas (Locação/Renovação/Spare Parts)', value: '24', tone: 'text-[#e05835]' },
          ].map((step) => (
            <div key={step.label} className="p-3 rounded-lg border border-slate-200 bg-white">
              <span className="text-[10px] font-semibold uppercase text-slate-500 block truncate">
                {step.label}
              </span>
              <strong className={`text-base font-semibold mt-0.5 block ${step.tone}`}>
                {step.value}
              </strong>
            </div>
          ))}
        </div>
      </div>

      {/* VIEW 1: CAMPAIGNS & MULTI-TOUCH REVENUE ATTRIBUTION */}
      {activeView === 'CAMPAIGNS_ROI' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <span className="text-slate-500 block">Investimento em Campanhas</span>
              <strong className="text-lg font-semibold text-slate-900">
                {formatBRL(campaigns.reduce((s, c) => s + c.budgetBrl, 0))}
              </strong>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <span className="text-slate-500 block">Leads &amp; MQLs Gerados</span>
              <strong className="text-lg font-semibold text-[#0091ae]">
                {campaigns.reduce((s, c) => s + c.contactsGenerated, 0)} Contatos (
                {campaigns.reduce((s, c) => s + c.mqlCount, 0)} MQLs)
              </strong>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <span className="text-slate-500 block">Negócios Influenciados</span>
              <strong className="text-lg font-semibold text-indigo-700">
                {campaigns.reduce((s, c) => s + c.attributedDeals, 0)} Deals B2B
              </strong>
            </div>
            <div className="bg-white rounded-xl border border-emerald-200 p-4">
              <span className="text-emerald-700 font-semibold block">Receita Atribuída (Propostas &amp; Contratos)</span>
              <strong className="text-lg font-semibold text-emerald-700">
                {formatBRL(campaigns.reduce((s, c) => s + c.attributedRevenueBrl, 0))}
              </strong>
            </div>
          </div>

          <form
            onSubmit={handleAddCampaign}
            className="bg-white rounded-xl border border-slate-200 p-4 flex flex-wrap items-center gap-2 text-xs"
          >
            <input
              type="text"
              value={newCmpName}
              onChange={(e) => setNewCmpName(e.target.value)}
              placeholder="Nome da nova campanha (ex: Prospecção Locação de Servidores & PABX Q4)..."
              className="flex-1 min-w-[220px] px-3 py-2 rounded border border-slate-300"
            />
            <input
              type="text"
              value={newCmpUtm}
              onChange={(e) => setNewCmpUtm(e.target.value)}
              placeholder="utm_campaign (ex: locacao-servidores-q4)"
              className="w-48 px-3 py-2 rounded border border-slate-300 font-mono"
            />
            <select
              value={newCmpProvider}
              onChange={(e) => setNewCmpProvider(e.target.value as 'MARKETING_ESP' | 'OUTLOOK_M365')}
              className="px-3 py-2 rounded border border-slate-300 bg-white font-semibold"
            >
              <option value="MARKETING_ESP">Motor: Provedor Marketing ESP</option>
              <option value="OUTLOOK_M365">Motor: Outlook / M365 Vendas 1:1</option>
            </select>
            <input
              type="number"
              value={newCmpBudget}
              onChange={(e) => setNewCmpBudget(e.target.value)}
              placeholder="Orçamento (R$)"
              className="w-32 px-3 py-2 rounded border border-slate-300"
            />
            <button
              type="submit"
              className="px-4 py-2 rounded bg-[#1e3a6e] text-white font-semibold cursor-pointer"
            >
              + Criar Campanha
            </button>
          </form>

          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-500 uppercase text-[10px] border-b">
                <tr>
                  <th className="py-2.5 px-3">Campanha Marketing &amp; Sales Engagement</th>
                  <th className="py-2.5 px-3">Motor / UTM</th>
                  <th className="py-2.5 px-3 text-right">Orçamento</th>
                  <th className="py-2.5 px-3 text-right">Enviados / Respostas</th>
                  <th className="py-2.5 px-3 text-right">Contatos / MQL / SQL</th>
                  <th className="py-2.5 px-3 text-right">Deals</th>
                  <th className="py-2.5 px-3 text-right">Receita Atribuída</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {campaigns.map((c) => (
                  <tr key={c.id} className="hover:bg-slate-50">
                    <td className="py-3 px-3">
                      <div className="font-semibold text-slate-900">{c.name}</div>
                      <div className="text-[11px] text-slate-500">{c.channel}</div>
                    </td>
                    <td className="py-3 px-3">
                      <span
                        className={`inline-block px-2 py-0.5 rounded text-[10px] font-semibold ${
                          c.sendingProvider === 'OUTLOOK_M365'
                            ? 'bg-blue-50 text-[#1e3a6e] border border-blue-200'
                            : 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                        }`}
                      >
                        {c.sendingProvider === 'OUTLOOK_M365' ? 'Outlook M365 (1:1)' : 'Marketing ESP'}
                      </span>
                      <div className="text-[10px] font-mono text-slate-500 mt-0.5">
                        utm_campaign={c.utmCampaign}
                      </div>
                    </td>
                    <td className="py-3 px-3 text-right font-semibold">{formatBRL(c.budgetBrl)}</td>
                    <td className="py-3 px-3 text-right">
                      <strong>{(c.sentCount || 0).toLocaleString('pt-BR')}</strong> env. /{' '}
                      <span className="text-emerald-700 font-semibold">{c.repliesCount || 0} resp.</span>
                    </td>
                    <td className="py-3 px-3 text-right">
                      <strong>{c.contactsGenerated}</strong> ({c.mqlCount} MQL / {c.sqlCount} SQL)
                    </td>
                    <td className="py-3 px-3 text-right font-semibold text-indigo-700">
                      {c.attributedDeals}
                    </td>
                    <td className="py-3 px-3 text-right font-semibold text-emerald-700">
                      {formatBRL(c.attributedRevenueBrl)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* VIEW 2: EMAIL MARKETING & MASS ABM DISPATCH */}
      {activeView === 'EMAIL_MARKETING' && (
        <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-4 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">
                Campanhas de E-mail Marketing B2B &amp; Separação Estrita de Provedores
              </h3>
              <p className="text-slate-500">
                Disparos massivos via Provedor Especializado (SES/SendGrid/Mailgun/Postmark/Resend) com verificação pré-envio de lista de supressão LGPD.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => handleValidatedCampaignDispatch(campaigns[0]?.id || 'cmp-1')}
                className="px-3.5 py-2 rounded-lg bg-[#1e3a6e] hover:bg-[#152a52] text-white font-semibold cursor-pointer inline-flex items-center gap-1.5"
              >
                <ShieldCheck className="w-3.5 h-3.5" /> Validar Supressão &amp; Simular Lote ESP
              </button>
              <button
                type="button"
                onClick={() =>
                  onOpenEmailModal?.({
                    docType: 'PROPOSAL',
                    companyName: 'Base ABM Tier 1 — Seta Telecom',
                    recipientName: 'Diretores de TI & CFOs',
                    documentCode: 'MKT-ABM-2026',
                    amountBrl: 4320,
                  })
                }
                className="px-4 py-2 rounded-lg bg-[#ff7a59] hover:bg-[#e86646] text-white font-semibold cursor-pointer inline-flex items-center gap-1.5"
              >
                <Send className="w-3.5 h-3.5" /> Disparar Novo E-mail Marketing
              </button>
            </div>
          </div>

          {dispatchStatusMsg && (
            <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-900 font-semibold flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
              <span>{dispatchStatusMsg}</span>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {[
              {
                title: 'Informativo Tributário: Locação de TI com 0% ISS (Súmula Vinculante 31 STF)',
                audience: 'Segmento: CFOs & Diretores Financeiros (380 contatos)',
                provider: 'Provedor Marketing ESP (SPF/DKIM/DMARC Alinhado)',
                openRate: '44,8% (Sinal Observado)',
                ctr: '14,2% (Cliques Humanos)',
                replied: '19 respostas comerciais',
              },
              {
                title: 'Upgrade Tecnológico: Licença Cisco ISR 4400 (SL-44-SEC-K9) & SD-WAN',
                audience: 'Segmento: Clientes Recorrentes GestãoClick (720 contatos)',
                provider: 'Provedor Marketing ESP (SPF/DKIM/DMARC Alinhado)',
                openRate: '51,2% (Sinal Observado)',
                ctr: '18,6% (Cliques Humanos)',
                replied: '27 solicitações de orçamento',
              },
              {
                title: 'Cadência Executiva: Locação de Servidores, Renovação & Spare Parts',
                audience: 'Segmento: Contas Alvo ABM Tier 1 (Envio Individual Vendedor)',
                provider: 'Microsoft 365 / Outlook Graph (OAuth 1:1)',
                openRate: '68,4% (Sinal Observado)',
                ctr: '29,1% (Cliques Humanos)',
                replied: '14 reuniões agendadas',
              },
            ].map((em) => (
              <div key={em.title} className="p-4 rounded-xl border border-slate-200 bg-slate-50 space-y-2">
                <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 text-[10px] font-semibold">
                  {em.provider}
                </span>
                <div className="text-sm font-semibold text-slate-900">{em.title}</div>
                <div className="text-[11px] text-slate-500">{em.audience}</div>
                <div className="pt-2 border-t border-slate-200 flex items-center justify-between text-[11px]">
                  <span>
                    Abertura: <strong className="text-emerald-700">{em.openRate}</strong>
                  </span>
                  <span>
                    CTR: <strong className="text-[#0091ae]">{em.ctr}</strong>
                  </span>
                </div>
                <div className="text-[11px] font-semibold text-[#1e3a6e]">{em.replied}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* VIEW 3: DYNAMIC SEGMENTS, ACCOUNT-BASED ENGAGEMENT & LGPD PREFERENCE CENTER */}
      {activeView === 'SEGMENTS_SCORING' && (
        <div className="space-y-4 text-xs">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-3">
              <h3 className="text-sm font-semibold text-slate-900">
                Segmentos Dinâmicos &amp; Listas Inteligentes (Avaliados em Tempo Real)
              </h3>
              <form onSubmit={handleAddSegment} className="flex flex-wrap gap-2">
                <input
                  type="text"
                  value={newSegName}
                  onChange={(e) => setNewSegName(e.target.value)}
                  placeholder="Nome do novo segmento dinâmico..."
                  className="flex-1 px-2.5 py-1.5 rounded border border-slate-300"
                />
                <input
                  type="text"
                  value={newSegFilter}
                  onChange={(e) => setNewSegFilter(e.target.value)}
                  placeholder="Filtro (ex: leadScore >= 80)"
                  className="w-52 px-2.5 py-1.5 rounded border border-slate-300 font-mono text-[11px]"
                />
                <button
                  type="submit"
                  className="px-3 py-1.5 rounded bg-[#1e3a6e] text-white font-semibold cursor-pointer"
                >
                  + Segmento
                </button>
              </form>
              {segments.map((seg) => (
                <div
                  key={seg.id}
                  className="p-3 rounded-lg border border-slate-200 bg-slate-50 flex items-center justify-between gap-2"
                >
                  <div>
                    <div className="font-semibold text-slate-900">{seg.name}</div>
                    <div className="text-[10px] font-mono text-slate-500 mt-0.5">
                      {seg.filterExpression}
                    </div>
                  </div>
                  <span className="px-2.5 py-1 rounded bg-[#1e3a6e] text-white font-semibold shrink-0">
                    {seg.count} reg.
                  </span>
                </div>
              ))}
            </div>

            {/* DIFERENCIAL #2 SETA TELECOM: VISÃO DE ENGAJAMENTO POR EMPRESA (ACCOUNT-BASED ENGAGEMENT) */}
            <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-1.5">
                  <Building2 className="w-4 h-4 text-[#e05835]" />
                  Visão de Engajamento por Empresa (Account-Based Engagement)
                </h3>
                <span className="px-2 py-0.5 rounded bg-orange-50 text-[#e05835] font-semibold text-[10px]">
                  Diferencial Seta Telecom
                </span>
              </div>
              <p className="text-[11px] text-slate-500">
                Identifica contas onde múltiplos decisores/profissionais interagiram com campanhas ou cadências para priorizar a conta inteira.
              </p>
              <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                {(accountEngagement.length > 0
                  ? accountEngagement.slice(0, 5)
                  : [
                      {
                        companyId: 'comp-nubank',
                        companyName: 'Nu Pagamentos S.A. (Nubank)',
                        icpTier: 'TIER_1',
                        isTargetAccount: true,
                        engagedContactsCount: 2,
                        totalContactsCount: 2,
                        engagedContacts: [],
                        activeCadencesCount: 1,
                        openDealsCount: 2,
                        openPipelineValueBrl: 308500,
                        accountHeatLevel: 'HOT_MULTI_THREADED' as const,
                      },
                    ]
                ).map((acc) => (
                  <div
                    key={acc.companyId}
                    className="p-3 rounded-lg border border-slate-200 bg-slate-50 flex items-center justify-between gap-2"
                  >
                    <div>
                      <div className="font-semibold text-slate-900">{acc.companyName}</div>
                      <div className="text-[11px] text-slate-600">
                        Profissionais engajados: <strong>{acc.engagedContactsCount}</strong> | Deals abertos:{' '}
                        <strong>{acc.openDealsCount}</strong> ({formatBRL(acc.openPipelineValueBrl)})
                      </div>
                    </div>
                    <span
                      className={`px-2 py-1 rounded text-[10px] font-semibold shrink-0 ${
                        acc.accountHeatLevel === 'HOT_MULTI_THREADED'
                          ? 'bg-emerald-100 text-emerald-800'
                          : 'bg-blue-100 text-blue-800'
                      }`}
                    >
                      {acc.accountHeatLevel === 'HOT_MULTI_THREADED'
                        ? 'CONTA PRIORITÁRIA'
                        : 'ENGAJADA'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* PREFERENCE CENTER & SUPPRESSION LIST (LGPD / INDEPENDENTE DAS CADÊNCIAS) */}
          <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="font-semibold text-slate-900 flex items-center gap-1.5">
                <ShieldCheck className="w-4 h-4 text-emerald-700" />
                Central de Preferências, Consentimento LGPD &amp; Lista de Supressão ({suppressionList.length} bloqueados)
              </div>
              <span className="text-[11px] font-semibold text-slate-600">
                Regra ativa: Sair de uma cadência comercial não descadastra o contato de comunicações globais.
              </span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 pt-1">
              {suppressionList.map((sup) => (
                <div
                  key={sup.id}
                  className="p-2.5 rounded-lg bg-rose-50 border border-rose-200 flex items-center justify-between gap-2"
                >
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="w-3.5 h-3.5 text-rose-700 shrink-0" />
                    <div>
                      <strong className="text-rose-900 font-mono">{sup.email}</strong>
                      <div className="text-[10px] text-rose-700">{sup.source}</div>
                    </div>
                  </div>
                  <span className="px-2 py-0.5 rounded bg-rose-200 text-rose-900 font-semibold text-[10px]">
                    {sup.reason}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* VIEW 4: LANDING PAGES & UTM ATTRIBUTION */}
      {activeView === 'FORMS_LANDING_PAGES' && (
        <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-4 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-1.5">
                <Globe className="w-4 h-4 text-[#0091ae]" />
                Catálogo de Landing Pages &amp; Rastreamento UTM Conectado aos Formulários Web
              </h3>
              <p className="text-slate-500">
                Cada Landing Page injeta automaticamente parâmetros UTM na submissão do formulário e atribui o Deal à Campanha correspondente.
              </p>
            </div>
          </div>

          <form onSubmit={handleAddLandingPage} className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              value={newLpName}
              onChange={(e) => setNewLpName(e.target.value)}
              placeholder="Título da nova Landing Page (ex: LP Locação Servidores Dell PowerEdge)..."
              className="flex-1 min-w-[220px] px-3 py-2 rounded border border-slate-300"
            />
            <input
              type="text"
              value={newLpUtm}
              onChange={(e) => setNewLpUtm(e.target.value)}
              placeholder="utm_campaign"
              className="w-48 px-3 py-2 rounded border border-slate-300 font-mono"
            />
            <button
              type="submit"
              className="px-4 py-2 rounded bg-[#1e3a6e] text-white font-semibold cursor-pointer"
            >
              + Publicar Landing Page
            </button>
          </form>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {landingPages.map((lp) => (
              <div key={lp.id} className="p-4 rounded-xl border border-slate-200 bg-slate-50 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 text-[10px] font-semibold">
                    {lp.status} • {lp.conversionRate}% CONV.
                  </span>
                  <code className="text-[10px] font-mono text-[#0091ae]">
                    /lp/{lp.slug}?utm_campaign={lp.utmCampaign}
                  </code>
                </div>
                <div className="font-semibold text-slate-900">{lp.name}</div>
                <div className="text-[11px] text-slate-600">{lp.subtitle}</div>
                <div className="text-[11px] font-semibold text-slate-700 pt-1">
                  {lp.submissionsCount} conversões / {lp.viewsCount} visitas • Formulário: <code>{lp.formId}</code>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// 2. SALES HUB PRO SUITE BAR (METAS/QUOTAS, PLAYBOOKS B2B & LINKS DE REUNIÃO)
// ============================================================================

export function SalesHubProToolsStrip({
  onOpenEmailModal,
  onShowToast,
}: {
  onOpenEmailModal?: (payload: ClientEmailInitialPayload) => void;
  onShowToast?: (msg: string) => void;
}) {
  const [activeTool, setActiveTool] = useState<'NONE' | 'QUOTAS' | 'PLAYBOOKS_MEETINGS'>('NONE');

  return (
    <div className="space-y-3">
      <div className="bg-white rounded-lg border border-slate-200 px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="flex items-center gap-2">
          <span className="px-2 py-0.5 rounded bg-[#0d2b4e] text-white text-[10px] font-semibold uppercase">
            Sales Hub Pro
          </span>
          <span className="font-semibold text-slate-700">
            Ferramentas Avançadas de Vendas HubSpot:
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setActiveTool(activeTool === 'QUOTAS' ? 'NONE' : 'QUOTAS')}
            className={`px-3 py-1.5 rounded font-semibold cursor-pointer inline-flex items-center gap-1.5 ${
              activeTool === 'QUOTAS'
                ? 'bg-[#1e3a6e] text-white'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            <Target className="w-3.5 h-3.5" /> Metas Comerciais (Quotas) &amp; Comissões
          </button>
          <button
            type="button"
            onClick={() =>
              setActiveTool(activeTool === 'PLAYBOOKS_MEETINGS' ? 'NONE' : 'PLAYBOOKS_MEETINGS')
            }
            className={`px-3 py-1.5 rounded font-semibold cursor-pointer inline-flex items-center gap-1.5 ${
              activeTool === 'PLAYBOOKS_MEETINGS'
                ? 'bg-[#1e3a6e] text-white'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            <BookOpen className="w-3.5 h-3.5" /> Playbooks B2B &amp; Links de Agenda (Meetings)
          </button>
        </div>
      </div>

      {activeTool === 'QUOTAS' && (
        <div className="bg-white rounded-xl border border-slate-200 p-4 grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
          {[
            { exec: 'Marcelo Lopes Mira', role: 'Diretoria Comercial', quota: 250000, achieved: 242500, mrrAdded: 18600 },
            { exec: 'Evelyn Olivia de Rosa Ternero', role: 'Executiva de Contas B2B', quota: 150000, achieved: 138400, mrrAdded: 11200 },
            { exec: 'Paula Campos', role: 'Vendas Internas Telecom', quota: 90000, achieved: 74800, mrrAdded: 6400 },
          ].map((q) => {
            const pct = Math.min(100, Math.round((q.achieved / q.quota) * 100));
            return (
              <div key={q.exec} className="p-3.5 rounded-lg border border-slate-200 bg-slate-50 space-y-2">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-semibold text-slate-900">{q.exec}</div>
                    <div className="text-[10px] text-slate-500">{q.role}</div>
                  </div>
                  <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 font-semibold">
                    {pct}% da Meta
                  </span>
                </div>
                <div className="w-full h-2.5 bg-slate-200 rounded-full overflow-hidden">
                  <div className="h-full bg-emerald-600 rounded-full" style={{ width: `${pct}%` }} />
                </div>
                <div className="flex justify-between text-[11px]">
                  <span>Realizado: <strong>{formatBRL(q.achieved)}</strong></span>
                  <span>Meta: {formatBRL(q.quota)}</span>
                </div>
                <div className="text-[10px] font-semibold text-[#1e3a6e]">
                  Novo MRR Locação Adicionado: +{formatBRL(q.mrrAdded)}/mês
                </div>
              </div>
            );
          })}
        </div>
      )}

      {activeTool === 'PLAYBOOKS_MEETINGS' && (
        <div className="bg-white rounded-xl border border-slate-200 p-4 grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
          <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200 space-y-2">
            <div className="font-semibold text-[#1e3a6e] flex items-center gap-1.5">
              <BookOpen className="w-4 h-4" />
              Playbook Consultivo Seta Telecom — Locação de Bens Móveis (0% ISS)
            </div>
            <p className="text-slate-600 leading-relaxed">
              1. <strong>Diagnóstico GPCT:</strong> Identificar gasto atual com telefonia legada, links e manutenção avulsa.<br />
              2. <strong>Argumento Tributário (SV 31 STF):</strong> Demonstrar economia imediata de 5% de ISSQN na Fatura de Locação Pura + dedutibilidade OPEX.<br />
              3. <strong>Fechamento:</strong> Gerar Orçamento (#4695) com Link PDF A4 e enviar para assinatura digital.
            </p>
          </div>

          <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200 space-y-2.5">
            <div className="font-semibold text-[#1e3a6e] flex items-center gap-1.5">
              <Calendar className="w-4 h-4" />
              Links de Agendamento Comercial (HubSpot Meetings)
            </div>
            {[
              { name: 'Agenda Executiva — Marcelo Lopes Mira (30 min)', url: 'https://sti-hub.vercel.app/reuniao/marcelo-mira' },
              { name: 'Agenda Comercial & Demo — Evelyn Ternero (30 min)', url: 'https://sti-hub.vercel.app/reuniao/evelyn-ternero' },
            ].map((m) => (
              <div key={m.url} className="p-2 rounded bg-white border border-slate-200 flex items-center justify-between gap-2">
                <div className="truncate">
                  <div className="font-semibold text-slate-800">{m.name}</div>
                  <div className="font-mono text-[10px] text-[#0091ae]">{m.url}</div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard?.writeText(m.url);
                      onShowToast?.('Link de reunião copiado!');
                    }}
                    className="px-2 py-1 rounded border text-[10px] font-semibold hover:bg-slate-50 cursor-pointer"
                  >
                    Copiar
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      onOpenEmailModal?.({
                        docType: 'PROPOSAL',
                        companyName: 'Cliente B2B',
                        customSubject: `[Seta Telecom] Convite para Alinhamento Técnico — ${m.name}`,
                        customBody: `Olá,\n\nPara agilizar nosso alinhamento técnico e comercial, escolha o melhor horário diretamente na minha agenda:\n\n${m.url}\n\nAtenciosamente,\nSeta Telecom LTDA`,
                      })
                    }
                    className="px-2 py-1 rounded bg-[#1e3a6e] text-white text-[10px] font-semibold cursor-pointer"
                  >
                    Enviar Convite
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
