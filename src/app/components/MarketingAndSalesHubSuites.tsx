'use client';

import React, { useState } from 'react';
import {
  Megaphone,
  Mail,
  Users,
  Sparkles,
  FileCode2,
  Plus,
  Send,
  TrendingUp,
  Target,
  BookOpen,
  Calendar,
  Copy,
  CheckCircle2,
  ExternalLink,
} from 'lucide-react';
import { formatBRL } from './ui-helpers';
import { ClientEmailInitialPayload } from './ClientEmailComposerModal';

// ============================================================================
// 1. MARKETING HUB PRO SUITE (CAMPANHAS, E-MAIL MARKETING, SEGMENTOS & LEAD SCORING)
// ============================================================================

export type MarketingHubSubView =
  | 'CAMPAIGNS_ROI'
  | 'EMAIL_MARKETING'
  | 'SEGMENTS_SCORING'
  | 'FORMS_LANDING_PAGES';

interface MarketingCampaignItem {
  id: string;
  name: string;
  status: 'ACTIVE' | 'IN_PROGRESS' | 'COMPLETED';
  channel: string;
  budgetBrl: number;
  sessions: number;
  contactsGenerated: number;
  mqlCount: number;
  sqlCount: number;
  attributedDeals: number;
  attributedRevenueBrl: number;
}

const INITIAL_CAMPAIGNS: MarketingCampaignItem[] = [
  {
    id: 'cmp-1',
    name: 'Campanha ABM Q4 — Substituição CAPEX por Locação Pura (0% ISS — SV 31 STF)',
    status: 'ACTIVE',
    channel: 'LinkedIn Ads + E-mail ABM + Landing Page',
    budgetBrl: 18500,
    sessions: 4820,
    contactsGenerated: 142,
    mqlCount: 64,
    sqlCount: 28,
    attributedDeals: 9,
    attributedRevenueBrl: 634000,
  },
  {
    id: 'cmp-2',
    name: 'Modernização Telefonia IP & Cluster PABX Cloud High-Availability',
    status: 'ACTIVE',
    channel: 'Google Search + Outbound Cadência + Webinar',
    budgetBrl: 12000,
    sessions: 3190,
    contactsGenerated: 96,
    mqlCount: 41,
    sqlCount: 19,
    attributedDeals: 6,
    attributedRevenueBrl: 412000,
  },
  {
    id: 'cmp-3',
    name: 'SD-WAN FortiGate Dual-WAN & Cibersegurança Corporativa Seta IT',
    status: 'IN_PROGRESS',
    channel: 'E-mail Marketing Base GestãoClick (#118887)',
    budgetBrl: 8500,
    sessions: 2150,
    contactsGenerated: 78,
    mqlCount: 35,
    sqlCount: 14,
    attributedDeals: 5,
    attributedRevenueBrl: 298000,
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
  const [campaigns, setCampaigns] = useState<MarketingCampaignItem[]>(INITIAL_CAMPAIGNS);
  const [newCmpName, setNewCmpName] = useState('');
  const [newCmpBudget, setNewCmpBudget] = useState('15000');

  const handleAddCampaign = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCmpName.trim()) return;
    setCampaigns((prev) => [
      {
        id: `cmp-${Date.now()}`,
        name: newCmpName.trim(),
        status: 'ACTIVE',
        channel: 'Multi-canal HubSpot Marketing Hub',
        budgetBrl: Number(newCmpBudget) || 15000,
        sessions: 450,
        contactsGenerated: 18,
        mqlCount: 9,
        sqlCount: 4,
        attributedDeals: 1,
        attributedRevenueBrl: 72000,
      },
      ...prev,
    ]);
    setNewCmpName('');
  };

  return (
    <div className="space-y-4">
      {/* MARKETING HUB NAVIGATION BAR */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-2xs flex flex-wrap items-center justify-between gap-3">
        <div>
          <span className="text-[10px] font-extrabold uppercase text-[#e05835] block">
            STI-hub • HubSpot Marketing Hub Pro (Portal #4369067)
          </span>
          <h2 className="text-base sm:text-lg font-extrabold text-slate-900">
            📣 Marketing Hub — Campanhas, E-mail Marketing, Segmentos ABM &amp; Formulários
          </h2>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {(
            [
              ['CAMPAIGNS_ROI', '📊 Campanhas & ROI (Attribution)', Megaphone],
              ['EMAIL_MARKETING', '✉️ E-mail Marketing ABM', Mail],
              ['SEGMENTS_SCORING', '🎯 Segmentos (Lists) & Lead Scoring', Users],
              ['FORMS_LANDING_PAGES', '📝 Formulários Web & Migração', FileCode2],
            ] as const
          ).map(([id, label, Icon]) => {
            const on = activeView === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => onSelectView(id)}
                className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-extrabold cursor-pointer transition ${
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

      {/* VIEW 1: CAMPAIGNS & MULTI-TOUCH REVENUE ATTRIBUTION */}
      {activeView === 'CAMPAIGNS_ROI' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <span className="text-slate-500 block">Investimento em Campanhas</span>
              <strong className="text-lg font-black text-slate-900">
                {formatBRL(campaigns.reduce((s, c) => s + c.budgetBrl, 0))}
              </strong>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <span className="text-slate-500 block">Leads &amp; MQLs Gerados</span>
              <strong className="text-lg font-black text-[#0091ae]">
                {campaigns.reduce((s, c) => s + c.contactsGenerated, 0)} Contatos (
                {campaigns.reduce((s, c) => s + c.mqlCount, 0)} MQLs)
              </strong>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <span className="text-slate-500 block">Negócios Influenciados</span>
              <strong className="text-lg font-black text-indigo-700">
                {campaigns.reduce((s, c) => s + c.attributedDeals, 0)} Deals B2B
              </strong>
            </div>
            <div className="bg-white rounded-xl border border-emerald-200 p-4">
              <span className="text-emerald-700 font-bold block">Receita Atribuída (Linear ROI)</span>
              <strong className="text-lg font-black text-emerald-700">
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
              placeholder="Nome da nova campanha de Marketing Hub (ex: Outbound Links Dedicados Q4)..."
              className="flex-1 min-w-[240px] px-3 py-2 rounded border border-slate-300"
            />
            <input
              type="number"
              value={newCmpBudget}
              onChange={(e) => setNewCmpBudget(e.target.value)}
              placeholder="Orçamento (R$)"
              className="w-36 px-3 py-2 rounded border border-slate-300"
            />
            <button
              type="submit"
              className="px-4 py-2 rounded bg-[#1e3a6e] text-white font-extrabold cursor-pointer"
            >
              + Criar Campanha
            </button>
          </form>

          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-500 uppercase text-[10px] border-b">
                <tr>
                  <th className="py-2.5 px-3">Campanha Marketing Hub</th>
                  <th className="py-2.5 px-3">Canais</th>
                  <th className="py-2.5 px-3 text-right">Orçamento</th>
                  <th className="py-2.5 px-3 text-right">Contatos / MQLs</th>
                  <th className="py-2.5 px-3 text-right">Deals</th>
                  <th className="py-2.5 px-3 text-right">Receita Atribuída</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {campaigns.map((c) => (
                  <tr key={c.id} className="hover:bg-slate-50">
                    <td className="py-3 px-3 font-bold text-slate-900">{c.name}</td>
                    <td className="py-3 px-3 text-slate-600">{c.channel}</td>
                    <td className="py-3 px-3 text-right font-semibold">{formatBRL(c.budgetBrl)}</td>
                    <td className="py-3 px-3 text-right">
                      <strong>{c.contactsGenerated}</strong> ({c.mqlCount} MQL / {c.sqlCount} SQL)
                    </td>
                    <td className="py-3 px-3 text-right font-bold text-indigo-700">
                      {c.attributedDeals}
                    </td>
                    <td className="py-3 px-3 text-right font-black text-emerald-700">
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
              <h3 className="text-sm font-extrabold text-slate-900">
                Campanhas de E-mail Marketing B2B &amp; Newsletter Técnica Seta Telecom
              </h3>
              <p className="text-slate-500">
                Disparos segmentados para a base de 1.184 clientes do GestãoClick e leads do HubSpot.
              </p>
            </div>
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
              className="px-4 py-2 rounded-lg bg-[#ff7a59] hover:bg-[#e86646] text-white font-extrabold cursor-pointer inline-flex items-center gap-1.5"
            >
              <Send className="w-3.5 h-3.5" /> 🚀 Disparar Novo E-mail Marketing
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {[
              {
                title: 'Informativo Tributário: Locação de TI com 0% ISS (Súmula Vinculante 31 STF)',
                audience: 'Segmento: CFOs & Diretores Financeiros (380 contatos)',
                openRate: '44,8%',
                ctr: '14,2%',
                replied: '19 respostas comerciais',
              },
              {
                title: 'Upgrade Tecnológico: Licença Cisco ISR 4400 (SL-44-SEC-K9) & SD-WAN',
                audience: 'Segmento: Clientes Recorrentes GestãoClick (720 contatos)',
                openRate: '51,2%',
                ctr: '18,6%',
                replied: '27 solicitações de orçamento',
              },
              {
                title: 'Checklist de Alta Disponibilidade: PABX IP Cloud + Redundância SIP',
                audience: 'Segmento: Leads MQL Telecom & Call Centers (410 contatos)',
                openRate: '39,5%',
                ctr: '11,4%',
                replied: '12 agendamentos técnicos',
              },
            ].map((em) => (
              <div key={em.title} className="p-4 rounded-xl border border-slate-200 bg-slate-50 space-y-2">
                <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 text-[10px] font-extrabold">
                  ENVIADO • ENTREGABILIDADE 99,4%
                </span>
                <div className="text-sm font-extrabold text-slate-900">{em.title}</div>
                <div className="text-[11px] text-slate-500">{em.audience}</div>
                <div className="pt-2 border-t border-slate-200 flex items-center justify-between text-[11px]">
                  <span>
                    Abertura: <strong className="text-emerald-700">{em.openRate}</strong>
                  </span>
                  <span>
                    Cliques (CTR): <strong className="text-[#0091ae]">{em.ctr}</strong>
                  </span>
                </div>
                <div className="text-[11px] font-bold text-[#1e3a6e]">{em.replied}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* VIEW 3: DYNAMIC SEGMENTS (ACTIVE LISTS) & LEAD SCORING */}
      {activeView === 'SEGMENTS_SCORING' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 text-xs">
          <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-3">
            <h3 className="text-sm font-extrabold text-slate-900">
              🎯 Segmentos Dinâmicos (HubSpot Active Lists)
            </h3>
            {[
              { name: 'Contas Alvo ABM Tier 1 (Decisores C-Level)', type: 'DYNAMIC', count: 148, filter: "hs_is_target_account = true AND hs_buying_role = 'DECISOR'" },
              { name: 'Clientes com Contrato de Locação Ativo (#118887)', type: 'DYNAMIC', count: 344, filter: "lifecyclestage = 'customer' AND gestaoclick_contract_active = true" },
              { name: 'SQLs Alto Score (> 80 pts) sem Proposta Emitida', type: 'DYNAMIC', count: 29, filter: 'hs_predictivecontactscore_v2 >= 80 AND num_associated_deals = 0' },
              { name: 'Fornecedores & Parceiros Homologados Telecom', type: 'STATIC', count: 101, filter: 'Sincronizado via API /fornecedores GestãoClick' },
            ].map((seg) => (
              <div key={seg.name} className="p-3 rounded-lg border border-slate-200 bg-slate-50 flex items-center justify-between gap-2">
                <div>
                  <div className="font-bold text-slate-900">{seg.name}</div>
                  <div className="text-[10px] font-mono text-slate-500 mt-0.5">{seg.filter}</div>
                </div>
                <span className="px-2.5 py-1 rounded bg-[#1e3a6e] text-white font-extrabold shrink-0">
                  {seg.count} reg.
                </span>
              </div>
            ))}
          </div>

          <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-3">
            <h3 className="text-sm font-extrabold text-slate-900">
              ⚡ Regras de Lead Scoring Preditivo (0 a 100 pts)
            </h3>
            {[
              { rule: 'CNPJ Corporativo Ativo & Validado (Mod-11)', pts: '+25 pts', tone: 'text-emerald-700' },
              { rule: 'Cargo Decisor (CTO, Diretor de TI, CFO, Compras)', pts: '+30 pts', tone: 'text-emerald-700' },
              { rule: 'Domínio de E-mail Corporativo (Não Gratuito)', pts: '+20 pts', tone: 'text-emerald-700' },
              { rule: 'Submissão de Formulário de Locação / Cotação PABX', pts: '+25 pts', tone: 'text-emerald-700' },
              { rule: 'E-mail Descartável ou Sem Telefone E.164', pts: '-35 pts', tone: 'text-rose-600' },
            ].map((r) => (
              <div key={r.rule} className="p-3 rounded-lg border border-slate-200 flex items-center justify-between">
                <span className="font-semibold text-slate-800">{r.rule}</span>
                <strong className={`font-black ${r.tone}`}>{r.pts}</strong>
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
          <span className="px-2 py-0.5 rounded bg-[#0d2b4e] text-white text-[10px] font-black uppercase">
            Sales Hub Pro
          </span>
          <span className="font-bold text-slate-700">
            Ferramentas Avançadas de Vendas HubSpot:
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setActiveTool(activeTool === 'QUOTAS' ? 'NONE' : 'QUOTAS')}
            className={`px-3 py-1.5 rounded font-extrabold cursor-pointer inline-flex items-center gap-1.5 ${
              activeTool === 'QUOTAS'
                ? 'bg-[#1e3a6e] text-white'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            <Target className="w-3.5 h-3.5" /> 🎯 Metas Comerciais (Quotas) &amp; Comissões
          </button>
          <button
            type="button"
            onClick={() =>
              setActiveTool(activeTool === 'PLAYBOOKS_MEETINGS' ? 'NONE' : 'PLAYBOOKS_MEETINGS')
            }
            className={`px-3 py-1.5 rounded font-extrabold cursor-pointer inline-flex items-center gap-1.5 ${
              activeTool === 'PLAYBOOKS_MEETINGS'
                ? 'bg-[#1e3a6e] text-white'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            <BookOpen className="w-3.5 h-3.5" /> 📚 Playbooks B2B &amp; Links de Agenda (Meetings)
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
                    <div className="font-extrabold text-slate-900">{q.exec}</div>
                    <div className="text-[10px] text-slate-500">{q.role}</div>
                  </div>
                  <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 font-black">
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
                <div className="text-[10px] font-bold text-[#1e3a6e]">
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
            <div className="font-extrabold text-[#1e3a6e] flex items-center gap-1.5">
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
            <div className="font-extrabold text-[#1e3a6e] flex items-center gap-1.5">
              <Calendar className="w-4 h-4" />
              Links de Agendamento Comercial (HubSpot Meetings)
            </div>
            {[
              { name: 'Agenda Executiva — Marcelo Lopes Mira (30 min)', url: 'https://sti-hub.vercel.app/reuniao/marcelo-mira' },
              { name: 'Agenda Comercial & Demo — Evelyn Ternero (30 min)', url: 'https://sti-hub.vercel.app/reuniao/evelyn-ternero' },
            ].map((m) => (
              <div key={m.url} className="p-2 rounded bg-white border border-slate-200 flex items-center justify-between gap-2">
                <div className="truncate">
                  <div className="font-bold text-slate-800">{m.name}</div>
                  <div className="font-mono text-[10px] text-[#0091ae]">{m.url}</div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard?.writeText(m.url);
                      onShowToast?.('Link de reunião copiado!');
                    }}
                    className="px-2 py-1 rounded border text-[10px] font-bold hover:bg-slate-50 cursor-pointer"
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
                        customBody: `Olá,\n\nPara agilizar nosso alinhamento técnico e comercial, escolha o melhor horário diretamente na minha agenda:\n\n📅 ${m.url}\n\nAtenciosamente,\nSeta Telecom LTDA`,
                      })
                    }
                    className="px-2 py-1 rounded bg-[#1e3a6e] text-white text-[10px] font-bold cursor-pointer"
                  >
                    ✉️ Enviar
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
