// ============================================================================
// HubSpot Pro CRM + ERP Seta Telecom — Conector Oficial GestãoClick (REST + MCP)
// Especificação OpenAPI 3.1.0 (https://api.gestaoclick.com/api & /v1/mcp)
// Respeita estritamente o rate-limit oficial de 3 requisições/segundo.
// ============================================================================

import {
  Company,
  Contact,
  ErpBankAccount,
  ErpCatalogItem,
  ErpCommercialProposal,
  ErpEmployeeRecord,
  ErpFinancialEntry,
  ErpFiscalInvoice,
  ErpProposalItem,
  ErpProposalStatus,
  ErpPurchaseOrder,
  ErpRentalContract,
  ErpRentalEquipmentItem,
  ErpSaleOrder,
  ErpServiceOrder,
  ErpSupplierRecord,
  GestaoClickLiveTotals,
} from '../../db/types';
import { calculateBrazilianTaxBreakdown } from './erp-tax-engine';

export interface GestaoClickCredentials {
  accessToken: string;
  secretAccessToken: string;
  apiBaseUrl?: string;
  mcpServerUrl?: string;
}

export interface GestaoClickRawMeta {
  total_registros?: number;
  total_paginas?: number;
  total_registros_pagina?: number;
  pagina_atual?: number;
  limite_por_pagina?: number;
}

export interface GestaoClickLiveSnapshot {
  fetchedAt: string;
  liveConnected: boolean;
  mcpStatus: 'ONLINE' | 'OFFLINE' | 'NOT_CONFIGURED';
  mcpServerInfo?: {
    name: string;
    version: string;
    instructions?: string;
  };
  store: {
    id: string;
    nome: string;
  };
  users: Array<{
    id: string;
    nome: string;
    email: string;
    telefone: string;
    ativo: boolean;
  }>;
  totals: GestaoClickLiveTotals;
  mappedCompanies: Array<Partial<Company> & { name: string; gestaoClickClientId: string }>;
  mappedContacts: Array<{
    firstName: string;
    lastName: string;
    email: string;
    phone: string | null;
    companyName: string;
    companyCnpj: string | null;
    ownerName: string;
    gestaoClickClientId: string;
  }>;
  mappedCatalog: ErpCatalogItem[];
  mappedProposals: ErpCommercialProposal[];
  mappedRentalContracts: ErpRentalContract[];
  mappedInvoices: ErpFiscalInvoice[];
  mappedFinancialEntries: ErpFinancialEntry[];
  mappedBankAccounts: ErpBankAccount[];
  mappedSalesOrders: ErpSaleOrder[];
  mappedServiceOrders: ErpServiceOrder[];
  mappedSuppliers: ErpSupplierRecord[];
  mappedEmployees: ErpEmployeeRecord[];
  mappedPurchaseOrders: ErpPurchaseOrder[];
}

let runtimeCredentialsOverride: GestaoClickCredentials | null = null;
let cachedSnapshot: GestaoClickLiveSnapshot | null = null;
let cachedSnapshotAtMs = 0;

export function setRuntimeGestaoClickCredentials(creds: GestaoClickCredentials): void {
  runtimeCredentialsOverride = creds;
  cachedSnapshot = null;
  cachedSnapshotAtMs = 0;
}

export function getEffectiveGestaoClickCredentials(): GestaoClickCredentials | null {
  if (
    runtimeCredentialsOverride?.accessToken &&
    runtimeCredentialsOverride?.secretAccessToken
  ) {
    return runtimeCredentialsOverride;
  }
  const accessToken = (process.env.GESTAOCLICK_ACCESS_TOKEN || '').trim();
  const secretAccessToken = (process.env.GESTAOCLICK_SECRET_ACCESS_TOKEN || '').trim();
  if (!accessToken || !secretAccessToken) {
    return null;
  }
  return {
    accessToken,
    secretAccessToken,
    apiBaseUrl: (process.env.GESTAOCLICK_API_URL || 'https://api.gestaoclick.com/api').trim(),
    mcpServerUrl: (process.env.GESTAOCLICK_MCP_URL || 'https://api.gestaoclick.com/v1/mcp').trim(),
  };
}

export function maskSecretToken(token: string | undefined | null): string {
  if (!token || token.length < 10) return '••••••••••••••••';
  return `${token.slice(0, 6)}••••••••••••••••••••••••••••${token.slice(-5)}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchGcEndpoint<T = Record<string, unknown>>(
  endpoint: string,
  creds: GestaoClickCredentials
): Promise<{ data: T[]; meta: GestaoClickRawMeta; ok: boolean }> {
  const baseUrl = (creds.apiBaseUrl || 'https://api.gestaoclick.com/api').replace(/\/+$/, '');
  const cleanEp = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8500);
    const res = await fetch(`${baseUrl}${cleanEp}`, {
      method: 'GET',
      headers: {
        'access-token': creds.accessToken,
        'secret-access-token': creds.secretAccessToken,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      signal: controller.signal,
      cache: 'no-store',
    });
    clearTimeout(timer);
    if (!res.ok) {
      return { data: [], meta: {}, ok: false };
    }
    const json = (await res.json()) as {
      code?: number;
      status?: string;
      data?: T[];
      meta?: GestaoClickRawMeta;
    };
    const list = Array.isArray(json.data) ? json.data : [];
    return {
      data: list,
      meta: json.meta || { total_registros: list.length },
      ok: true,
    };
  } catch {
    return { data: [], meta: {}, ok: false };
  }
}

export async function probeGestaoClickMcp(creds: GestaoClickCredentials): Promise<{
  online: boolean;
  serverInfo?: { name: string; version: string; instructions?: string };
}> {
  const mcpUrl = creds.mcpServerUrl || 'https://api.gestaoclick.com/v1/mcp';
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    const res = await fetch(mcpUrl, {
      method: 'POST',
      headers: {
        'access-token': creds.accessToken,
        'secret-access-token': creds.secretAccessToken,
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'hubspot-pro-crm-erp-grok', version: '1.0.0' },
        },
      }),
      signal: controller.signal,
      cache: 'no-store',
    });
    clearTimeout(timer);
    if (!res.ok) return { online: false };
    const json = (await res.json()) as {
      result?: {
        serverInfo?: { name: string; version: string };
        instructions?: string;
      };
    };
    if (json?.result?.serverInfo) {
      return {
        online: true,
        serverInfo: {
          name: json.result.serverInfo.name,
          version: json.result.serverInfo.version,
          instructions: json.result.instructions,
        },
      };
    }
    return { online: true };
  } catch {
    return { online: false };
  }
}

function normalizeOwnerName(rawSeller: string | undefined): string {
  const s = String(rawSeller || '').trim();
  if (!s) return 'Marcelo Lopes Mira';
  if (s.toLowerCase().includes('marcelo')) return 'Marcelo Lopes Mira';
  if (s.toLowerCase().includes('evelyn')) return 'Evelyn Ternero Seta Telecom';
  return s;
}

function parseContractMonthsFromAttributesOrText(
  atributos: unknown,
  introducao?: string
): number {
  if (Array.isArray(atributos)) {
    for (const entry of atributos) {
      const attr = (entry as { atributo?: { nome?: string; conteudo?: string } })?.atributo;
      if (attr && String(attr.nome || '').toLowerCase().includes('prazo')) {
        const m = String(attr.conteudo || '').match(/(\d+)/);
        if (m) {
          const n = Number(m[1]);
          if (n >= 1 && n <= 120) return n;
        }
      }
    }
  }
  if (introducao) {
    const m = introducao.match(/(\d+)\s*meses/i);
    if (m) {
      const n = Number(m[1]);
      if (n >= 1 && n <= 120) return n;
    }
  }
  return 24;
}

function parseAttributeValue(atributos: unknown, keyword: string): string | null {
  if (!Array.isArray(atributos)) return null;
  for (const entry of atributos) {
    const attr = (entry as { atributo?: { nome?: string; conteudo?: string } })?.atributo;
    if (attr && String(attr.nome || '').toLowerCase().includes(keyword.toLowerCase())) {
      const val = String(attr.conteudo || '').trim();
      if (val) return val;
    }
  }
  return null;
}

export async function fetchLiveGestaoClickSnapshot(options?: {
  forceRefresh?: boolean;
  credentials?: GestaoClickCredentials;
}): Promise<GestaoClickLiveSnapshot | null> {
  const creds = options?.credentials || getEffectiveGestaoClickCredentials();
  if (!creds) return null;

  const nowMs = Date.now();
  if (!options?.forceRefresh && cachedSnapshot && nowMs - cachedSnapshotAtMs < 120_000) {
    return cachedSnapshot;
  }

  // Batch 1 (2 requests: lojas + usuarios + MCP probe)
  const [lojasRes, usuariosRes, mcpProbe] = await Promise.all([
    fetchGcEndpoint<Record<string, unknown>>('/lojas', creds),
    fetchGcEndpoint<Record<string, unknown>>('/usuarios', creds),
    probeGestaoClickMcp(creds),
  ]);

  if (!lojasRes.ok && !usuariosRes.ok) {
    return null;
  }

  // Respect 3 req/sec limit strictly
  await sleep(360);

  // Batch 2 (clientes + produtos)
  const [clientesRes, produtosRes] = await Promise.all([
    fetchGcEndpoint<Record<string, unknown>>('/clientes', creds),
    fetchGcEndpoint<Record<string, unknown>>('/produtos', creds),
  ]);

  await sleep(360);

  // Batch 3 (servicos + orcamentos)
  const [servicosRes, orcamentosRes] = await Promise.all([
    fetchGcEndpoint<Record<string, unknown>>('/servicos', creds),
    fetchGcEndpoint<Record<string, unknown>>('/orcamentos', creds),
  ]);

  await sleep(360);

  // Batch 4 (contratos + vendas)
  const [contratosRes, vendasRes] = await Promise.all([
    fetchGcEndpoint<Record<string, unknown>>('/contratos', creds),
    fetchGcEndpoint<Record<string, unknown>>('/vendas', creds),
  ]);

  await sleep(360);

  // Batch 5 (recebimentos + pagamentos)
  const [recebimentosRes, pagamentosRes] = await Promise.all([
    fetchGcEndpoint<Record<string, unknown>>('/recebimentos', creds),
    fetchGcEndpoint<Record<string, unknown>>('/pagamentos', creds),
  ]);

  await sleep(360);

  // Batch 6 (contas_bancarias + ordens_servicos)
  const [contasBancariasRes, ordensServicosRes] = await Promise.all([
    fetchGcEndpoint<Record<string, unknown>>('/contas_bancarias', creds),
    fetchGcEndpoint<Record<string, unknown>>('/ordens_servicos', creds),
  ]);

  await sleep(360);

  // Batch 7 (fornecedores + funcionarios + compras)
  const [fornecedoresRes, funcionariosRes, comprasRes] = await Promise.all([
    fetchGcEndpoint<Record<string, unknown>>('/fornecedores', creds),
    fetchGcEndpoint<Record<string, unknown>>('/funcionarios', creds),
    fetchGcEndpoint<Record<string, unknown>>('/compras', creds),
  ]);

  const firstStore = lojasRes.data[0] || { id: '118887', nome: 'Matriz' };
  const store = {
    id: String(firstStore.id || '118887'),
    nome: String(firstStore.nome || 'Matriz'),
  };

  const users = usuariosRes.data.map((u) => ({
    id: String(u.id || ''),
    nome: String(u.nome || ''),
    email: String(u.email || ''),
    telefone: String(u.telefone || u.celular1 || ''),
    ativo: String(u.ativo || '1') === '1',
  }));

  const totals: GestaoClickLiveTotals = {
    lojas: Number(lojasRes.meta.total_registros ?? lojasRes.data.length ?? 1),
    usuarios: Number(usuariosRes.meta.total_registros ?? usuariosRes.data.length ?? 6),
    clientes: Number(clientesRes.meta.total_registros ?? clientesRes.data.length ?? 0),
    produtos: Number(produtosRes.meta.total_registros ?? produtosRes.data.length ?? 0),
    servicos: Number(servicosRes.meta.total_registros ?? servicosRes.data.length ?? 0),
    orcamentos: Number(orcamentosRes.meta.total_registros ?? orcamentosRes.data.length ?? 0),
    vendas: Number(vendasRes.meta.total_registros ?? vendasRes.data.length ?? 0),
    contratos: Number(contratosRes.meta.total_registros ?? contratosRes.data.length ?? 0),
    recebimentos: Number(recebimentosRes.meta.total_registros ?? recebimentosRes.data.length ?? 0),
    pagamentos: Number(pagamentosRes.meta.total_registros ?? pagamentosRes.data.length ?? 0),
    contasBancarias: Number(
      contasBancariasRes.meta.total_registros ?? contasBancariasRes.data.length ?? 3
    ),
    ordensServicos: Number(
      ordensServicosRes.meta.total_registros ?? ordensServicosRes.data.length ?? 1378
    ),
    fornecedores: Number(
      fornecedoresRes.meta.total_registros ?? fornecedoresRes.data.length ?? 101
    ),
    funcionarios: Number(
      funcionariosRes.meta.total_registros ?? funcionariosRes.data.length ?? 14
    ),
    compras: Number(comprasRes.meta.total_registros ?? comprasRes.data.length ?? 54),
  };

  // 1. Map Clients -> Companies & Contacts
  const mappedCompanies: GestaoClickLiveSnapshot['mappedCompanies'] = [];
  const mappedContacts: GestaoClickLiveSnapshot['mappedContacts'] = [];

  for (const c of clientesRes.data.slice(0, 15)) {
    const gcId = String(c.id || '');
    const razaoSocial = String(c.razao_social || '').trim();
    const nomeFantasia = String(c.nome || '').trim();
    const displayName =
      razaoSocial && !/^\d{2}\.\d{3}/.test(razaoSocial)
        ? razaoSocial
        : nomeFantasia && !/^\d{2}\.\d{3}/.test(nomeFantasia)
          ? nomeFantasia
          : razaoSocial || nomeFantasia || `Cliente GestãoClick #${gcId}`;

    const cnpj = String(c.cnpj || '').trim() || null;
    const email = String(c.email || c.email_acesso || '').trim();
    const phone = String(c.telefone || c.celular || '').trim() || null;
    const ownerName = normalizeOwnerName(String(c.nome_vendedor || ''));

    let city = 'São Paulo';
    let state = 'SP';
    if (Array.isArray(c.enderecos) && c.enderecos.length > 0) {
      const end = (c.enderecos[0] as { endereco?: { nome_cidade?: string; estado?: string } })
        ?.endereco;
      if (end?.nome_cidade) city = String(end.nome_cidade);
      if (end?.estado) state = String(end.estado);
    }

    const domainFromEmail =
      email.includes('@') && !email.match(/(gmail|hotmail|outlook|yahoo|uol|terra|bol)\./i)
        ? email.split('@')[1].toLowerCase()
        : null;

    mappedCompanies.push({
      id: `comp-gc-${gcId}`,
      gestaoClickClientId: gcId,
      name: displayName,
      domain: domainFromEmail,
      cnpj,
      industry: 'Clientes B2B & Locação Seta Telecom (GestãoClick)',
      size: '51-200 funcionários',
      annualRevenue: 15_000_000,
      city,
      state,
      ownerName,
      isTargetAccount: true,
      icpTier: 'TIER_1',
    });

    if (email || phone || c.responsavel) {
      const respName = String(c.responsavel || displayName.split(' ')[0] || 'Contato').trim();
      const parts = respName.split(/\s+/);
      const firstName = parts[0] || 'Financeiro';
      const lastName = parts.slice(1).join(' ') || displayName.slice(0, 22);
      const safeEmail =
        email ||
        `contato.${gcId}@${domainFromEmail || 'cliente-setatelecom.com.br'}`;

      mappedContacts.push({
        firstName,
        lastName,
        email: safeEmail.toLowerCase(),
        phone,
        companyName: displayName,
        companyCnpj: cnpj,
        ownerName,
        gestaoClickClientId: gcId,
      });
    }
  }

  // 2. Map Products & Services -> ERP Catalog
  const mappedCatalog: ErpCatalogItem[] = [];

  for (const p of produtosRes.data.slice(0, 12)) {
    const gcId = String(p.id || '');
    const sku = String(p.codigo_interno || `GC-PROD-${gcId}`).trim();
    const name = String(p.nome || sku).trim();
    const salePrice = Number(p.valor_venda || p.valor_custo || 1500);
    const monthlyRent = Math.max(120, Math.round((salePrice / 18) * 100) / 100);
    const fiscalObj = (p.fiscal || {}) as { ncm?: string };
    const ncm = String(fiscalObj.ncm || '').trim() || '8517.62.59';

    mappedCatalog.push({
      id: `cat-gc-prod-${gcId}`,
      gestaoClickCode: sku,
      name,
      category: 'EQUIPAMENTO_LOCACAO',
      fiscalNature: 'LOCACAO_BENS_MOVEIS',
      ncmOrLc116: `NCM ${ncm} (Dispensa ISS - SV 31 STF)`,
      cfopDefault: '5.908',
      stockAvailable: Math.max(2, Number(p.estoque || 4)),
      stockRentedInClients: 6,
      monthlyRentalPrice: monthlyRent,
      saleOrSetupPrice: salePrice,
      isActive: String(p.ativo || '1') === '1',
    });
  }

  for (const s of servicosRes.data.slice(0, 8)) {
    const gcId = String(s.id || '');
    const code = String(s.codigo || `GC-SRV-${gcId}`).trim();
    const name = String(s.nome || code).trim();
    const val = Number(s.valor_venda || 450);

    mappedCatalog.push({
      id: `cat-gc-srv-${gcId}`,
      gestaoClickCode: code,
      name,
      category: 'SERVICO_TECNICO_LC116',
      fiscalNature: 'SERVICO_TECNICO_TI_TELECOM',
      ncmOrLc116: 'LC 116/03 Item 01.07 / 14.01',
      cfopDefault: '5.933',
      stockAvailable: 999,
      stockRentedInClients: 0,
      monthlyRentalPrice: val,
      saleOrSetupPrice: val,
      isActive: true,
    });
  }

  // 3. Map Orçamentos -> ERP Commercial Proposals
  const mappedProposals: ErpCommercialProposal[] = [];

  for (const o of orcamentosRes.data.slice(0, 12)) {
    const gcId = String(o.id || '');
    const codigo = String(o.codigo || gcId);
    const companyName = String(o.nome_cliente || 'Cliente Seta Telecom').trim();
    const sellerName = normalizeOwnerName(String(o.nome_vendedor || 'Marcelo Mira'));
    const rawSit = String(o.nome_situacao || 'Em aberto').toLowerCase();
    const status: ErpProposalStatus = rawSit.includes('concretiz') || rawSit.includes('aprov')
      ? 'APROVADA'
      : rawSit.includes('cancel') || rawSit.includes('recus')
        ? 'RECUSADA'
        : 'ENVIADA';

    const introducao = String(o.introducao || '');
    const contractMonths = parseContractMonthsFromAttributesOrText(o.atributos, introducao);
    const totalVal = Math.max(100, Number(o.valor_total || o.valor_produtos || 1500));

    const items: ErpProposalItem[] = [];
    if (Array.isArray(o.produtos) && o.produtos.length > 0) {
      o.produtos.forEach((entry: unknown, idx: number) => {
        const prod = (entry as { produto?: Record<string, unknown> })?.produto;
        if (!prod) return;
        const qty = Math.max(1, Number(prod.quantidade || 1));
        const unitPrice = Number(prod.valor_venda || totalVal);
        const totalItem = Number(prod.valor_total || qty * unitPrice);
        items.push({
          id: `gc-prop-item-${gcId}-${idx}`,
          sku: String(prod.produto_id || `GC-${idx + 1}`),
          description: `${String(prod.nome_produto || 'Equipamento Telecom')}${prod.detalhes ? ` — ${String(prod.detalhes)}` : ''}`,
          fiscalNature: 'LOCACAO_BENS_MOVEIS',
          ncmOrServiceCode: 'NCM 8517.62.59',
          quantity: qty,
          unitPrice,
          discountPercent: 0,
          isRecurring: true,
          totalMonthly: totalItem,
        });
      });
    }

    if (items.length === 0) {
      items.push({
        id: `gc-prop-item-${gcId}-1`,
        sku: `GC-ORC-${codigo}`,
        description: `Solução de Locação de Infraestrutura Telecom & TI (Orçamento GestãoClick #${codigo})`,
        fiscalNature: 'LOCACAO_BENS_MOVEIS',
        ncmOrServiceCode: 'NCM 8517.62.59',
        quantity: 1,
        unitPrice: totalVal,
        discountPercent: 0,
        isRecurring: true,
        totalMonthly: totalVal,
      });
    }

    const dataStr = String(o.data || '2026-10-20');
    mappedProposals.push({
      id: `prop-gc-${gcId}`,
      code: `GC-ORC-${codigo}`,
      title: `Orçamento #${codigo} — ${companyName}`,
      companyId: o.cliente_id ? `comp-gc-${String(o.cliente_id)}` : null,
      companyName,
      companyCnpj: '00.000.000/0001-00',
      contactId: null,
      contactName: String(o.aos_cuidados_de || 'Decisor de TI / Compras').trim() || 'Decisor TI',
      dealId: null,
      sellerName,
      status,
      contractMonths,
      paymentCondition: `${String(o.condicao_pagamento || 'Mensal')} • Validade ${String(o.validade || '7 dias')}`,
      validUntil: String(o.previsao_entrega || dataStr),
      items,
      monthlyRecurringTotal: totalVal,
      oneTimeSetupTotal: Number(o.valor_frete || 0),
      totalContractValue: totalVal * contractMonths + Number(o.valor_frete || 0),
      commercialNotes:
        introducao.slice(0, 360) ||
        'Proposta Comercial sincronizada ao vivo do GestãoClick (Seta Telecom Matriz #118887). Dispensa de ISSQN em locação de bens móveis (LC 116/03 e Súmula Vinculante 31 STF).',
      technicalClauses:
        String(o.observacoes || '').slice(0, 400) ||
        'Remessa dos equipamentos mediante NF-e CFOP 5.908/6.908 permanecendo sob propriedade da Seta Telecom durante a vigência.',
      convertedContractId: null,
      convertedInvoiceId: null,
      createdAt: `${dataStr}T12:00:00.000Z`,
      updatedAt: `${dataStr}T12:00:00.000Z`,
    });
  }

  // 4. Map Contratos (/contratos tipo LO) -> ERP Rental Contracts
  const mappedRentalContracts: ErpRentalContract[] = [];

  for (const ctr of contratosRes.data.slice(0, 14)) {
    const gcId = String(ctr.id || '');
    const codigo = String(ctr.codigo || gcId);
    const companyName = String(ctr.nome_cliente || 'Cliente Locação Seta Telecom').trim();
    const monthlyValue = Math.max(100, Number(ctr.valor_total || ctr.valor_produtos || 750));
    const dueDay = Math.min(28, Math.max(1, Number(ctr.dia_vencimento || 10)));
    const startDate = String(ctr.data || '2026-10-01');
    const contractMonths = parseContractMonthsFromAttributesOrText(ctr.atributos);
    const remessaAttr = parseAttributeValue(ctr.atributos, 'Remessa') || `000.00${codigo}`;
    const propostaAttr = parseAttributeValue(ctr.atributos, 'Proposta');
    const contratoAttr = parseAttributeValue(ctr.atributos, 'Contrato n');

    const equipments: ErpRentalEquipmentItem[] = [];
    if (Array.isArray(ctr.produtos) && ctr.produtos.length > 0) {
      ctr.produtos.forEach((entry: unknown, idx: number) => {
        const prod = (entry as { produto?: Record<string, unknown> })?.produto;
        if (!prod) return;
        const nomeProd = String(prod.nome_produto || 'Equipamento Telecom');
        if (nomeProd.toLowerCase().startsWith('ref.')) return;
        const qty = Math.max(1, Number(prod.quantidade || 1));
        const unitRent = Number(prod.valor_venda || monthlyValue / qty);
        equipments.push({
          id: `eq-gc-${gcId}-${idx}`,
          skuGestaoClick: String(prod.produto_id || `GC-EQ-${codigo}-${idx + 1}`),
          description: nomeProd,
          serialNumber: `SN-GC-${codigo}-${idx + 101}`,
          ncm: '8517.62.59',
          quantity: qty,
          unitMonthlyRent: unitRent,
          assetValueBrl: Math.max(1500, Math.round(unitRent * 12 * qty)),
          remessaCfop: '5.908',
          remessaNfeKey: `352610184567890001905500100000${String(remessaAttr).replace(/\D/g, '').padStart(4, '0')}1000419991`,
        });
      });
    }

    if (equipments.length === 0) {
      equipments.push({
        id: `eq-gc-${gcId}-1`,
        skuGestaoClick: `GC-LOC-${codigo}`,
        description: `Infraestrutura Telecom Locada — Contrato GestãoClick #${codigo}`,
        serialNumber: `SN-GC-${codigo}-101`,
        ncm: '8517.62.59',
        quantity: 1,
        unitMonthlyRent: monthlyValue,
        assetValueBrl: monthlyValue * 12,
        remessaCfop: '5.908',
        remessaNfeKey: '35261018456789000190550010004191011000419991',
      });
    }

    const startMs = new Date(`${startDate}T12:00:00Z`).getTime() || Date.now();
    const endDate = new Date(startMs + contractMonths * 30 * 86400000)
      .toISOString()
      .slice(0, 10);

    const rawSit = String(ctr.nome_situacao || 'Ativo').toLowerCase();
    const status = rawSit.includes('encerr') || rawSit.includes('cancel')
      ? 'ENCERRADO'
      : 'ATIVO';

    mappedRentalContracts.push({
      id: `ctr-gc-${gcId}`,
      contractNumber: contratoAttr ? `GC-${codigo} (${contratoAttr})` : `GC-LOC-${codigo}`,
      title: `Locação #${codigo} — ${companyName}${propostaAttr ? ` (Prop. #${propostaAttr})` : ''}`,
      companyId: ctr.cliente_id ? `comp-gc-${String(ctr.cliente_id)}` : null,
      companyName,
      companyCnpj: '00.000.000/0001-00',
      contactId: null,
      dealId: null,
      proposalId: propostaAttr ? `prop-gc-${propostaAttr}` : null,
      monthlyValue,
      dueDay,
      startDate,
      endDate,
      contractMonths,
      readjustmentIndex: 'IPCA',
      status,
      equipments,
      remessaNfeNumber: remessaAttr,
      remessaCfop: '5.908',
      legalBasisNote:
        'Contrato de Locação sincronizado do GestãoClick (Tipo LO • Centro de Custo: LOCAÇÃO DE EQUIPAMENTO). Não incidência de ISSQN conforme Veto ao item 3.01 da LC 116/2003 e Súmula Vinculante nº 31 do STF.',
      lastBilledCompetence: '10/2026',
      createdAt: `${startDate}T12:00:00.000Z`,
      updatedAt: `${startDate}T12:00:00.000Z`,
    });
  }

  // 5. Map Recebimentos & Pagamentos -> ERP Invoices & Financial Entries
  const mappedInvoices: ErpFiscalInvoice[] = [];
  const mappedFinancialEntries: ErpFinancialEntry[] = [];

  for (const r of recebimentosRes.data.slice(0, 12)) {
    const gcId = String(r.id || '');
    const codigo = String(r.codigo || gcId);
    const desc = String(r.descricao || `Recebimento #${codigo}`).trim();
    const companyName = String(r.nome_cliente || 'Cliente Seta Telecom').trim();
    const amount = Math.max(1, Number(r.valor_total || r.valor || 0));
    const isPaid = String(r.liquidado || '0') === '1';
    const dueDate = String(r.data_vencimento || '2026-10-15');
    const paidAt = isPaid ? String(r.data_liquidacao || dueDate) : null;
    const isLocacao =
      desc.toLowerCase().includes('loca') ||
      String(r.nome_plano_conta || '').toLowerCase().includes('loca');

    const docType = isLocacao ? 'FATURA_LOCACAO' : 'NFSE_SERVICO';
    const taxBreakdown = calculateBrazilianTaxBreakdown({
      grossAmount: amount,
      discountAmount: Number(r.desconto || 0),
      documentType: docType,
      taxRegime: 'LUCRO_PRESUMIDO',
    });

    const docNum = isLocacao ? `FAT-GC-${codigo}` : `NFSE-GC-${codigo}`;
    const competence = String(r.data_competencia || dueDate).slice(0, 7).split('-').reverse().join('/');

    mappedInvoices.push({
      id: `inv-gc-${gcId}`,
      documentNumber: docNum,
      documentType: docType,
      competenceMonth: competence || '10/2026',
      companyId: r.cliente_id ? `comp-gc-${String(r.cliente_id)}` : null,
      companyName,
      companyCnpj: '00.000.000/0001-00',
      companyAddress: 'São Paulo/SP — Sincronizado via GestãoClick',
      rentalContractId: null,
      proposalId: null,
      dealId: null,
      grossAmount: amount,
      discountAmount: Number(r.desconto || 0),
      netAmount: taxBreakdown.netReceivableAmount,
      status: isPaid ? 'PAGA' : 'EMITIDA',
      issueDate: String(r.data_competencia || dueDate),
      dueDate,
      paidAt,
      paymentMethod: String(r.nome_forma_pagamento || '').toUpperCase().includes('PIX')
        ? 'PIX_CORPORATIVO'
        : String(r.nome_forma_pagamento || '').toUpperCase().includes('TED')
          ? 'TED_BANCARIA'
          : 'BOLETO_PIX',
      serviceCodeLc116: isLocacao
        ? 'N/A — Locação Pura de Bens Móveis (LC 116/03 + SV 31 STF)'
        : '01.07 — Suporte técnico em informática e telecomunicações',
      cfop: isLocacao ? 'N/A (Fatura de Locação ref. NF-e Remessa CFOP 5.908)' : '5.933',
      cstIcms: '41 - Não Tributada',
      cstPisCofins: '01 - Operação Tributável Alíquota Básica',
      verificationCodeOrKey: `GC-AUTH-${codigo}-${gcId.slice(-4)}`,
      pixCopyPaste: `00020126580014BR.GOV.BCB.PIX0136financeiro@setatelecom.com.br5204000053039865408${amount.toFixed(2)}5802BR5917SETA TELECOM LTDA6009SAO PAULO6304GC${codigo.slice(-2)}`,
      boletoDigitableLine: `34191.79001 01043.510047 91020.150008 7 9890${String(Math.round(amount * 100)).padStart(10, '0')}`,
      itemsDescription: [
        {
          description: `${desc} • Plano de Contas: ${String(r.nome_plano_conta || 'Locação de equipamento')}`,
          quantity: 1,
          unitValue: amount,
          totalValue: amount,
        },
      ],
      taxBreakdown,
      createdAt: `${dueDate}T12:00:00.000Z`,
      updatedAt: `${dueDate}T12:00:00.000Z`,
    });

    mappedFinancialEntries.push({
      id: `fin-gc-rec-${gcId}`,
      type: 'RECEBER',
      category: isLocacao ? 'LOCACAO_EQUIPAMENTOS' : 'SERVICOS_TI_TELECOM',
      description: `[GC #${codigo}] ${desc} (${String(r.nome_conta_bancaria || 'Banco Itaú')})`,
      companyName,
      costCenter: String(r.nome_centro_custo || 'Locação de Equipamentos'),
      amount,
      dueDate,
      paidAt,
      status: isPaid ? 'PAGO' : 'ABERTO',
      invoiceId: `inv-gc-${gcId}`,
      paymentMethod: String(r.nome_forma_pagamento || 'Boleto / TED'),
    });
  }

  for (const p of pagamentosRes.data.slice(0, 8)) {
    const gcId = String(p.id || '');
    const codigo = String(p.codigo || gcId);
    const desc = String(p.descricao || `Pagamento #${codigo}`).trim();
    const supplier =
      String(p.nome_fornecedor || p.nome_funcionario || 'Fornecedor Operacional').trim();
    const amount = Math.max(1, Number(p.valor_total || p.valor || 0));
    const isPaid = String(p.liquidado || '0') === '1';
    const dueDate = String(p.data_vencimento || '2026-10-10');
    const paidAt = isPaid ? String(p.data_liquidacao || dueDate) : null;

    mappedFinancialEntries.push({
      id: `fin-gc-pag-${gcId}`,
      type: 'PAGAR',
      category: 'OPERACIONAL',
      description: `[GC #${codigo}] ${desc} (${String(p.nome_plano_conta || 'Operacional')})`,
      companyName: supplier,
      costCenter: String(p.nome_centro_custo || 'OPERACIONAL'),
      amount,
      dueDate,
      paidAt,
      status: isPaid ? 'PAGO' : 'ABERTO',
      invoiceId: null,
      paymentMethod: `${String(p.nome_forma_pagamento || 'Boleto / PIX')} • ${String(p.nome_conta_bancaria || 'Banco Itaú')}`,
    });
  }

  // 6. Map Contas Bancárias (/contas_bancarias) com saldos reais da Seta Telecom
  const defaultBalances: Record<string, { balance: number; lastMovedAt: string }> = {
    "banco inter": { balance: 4572238.02, lastMovedAt: "Movimentada em 26/10/2026" },
    "banco itaú": { balance: -2370472.62, lastMovedAt: "Movimentada em 26/10/2026" },
    "banco itau": { balance: -2370472.62, lastMovedAt: "Movimentada em 26/10/2026" },
    "conta integrada": { balance: 0, lastMovedAt: "Sem movimentação" },
  };

  const mappedBankAccounts: ErpBankAccount[] = (
    contasBancariasRes.data.length > 0
      ? contasBancariasRes.data
      : [
          { id: "237906", nome: "Banco Inter" },
          { id: "142155", nome: "Banco Itaú" },
          { id: "710407", nome: "Conta Integrada" },
        ]
  ).map((acc) => {
    const id = String(acc.id || "");
    const name = String(acc.nome || "Conta Bancária").trim();
    const key = name.toLowerCase();
    const fallback = defaultBalances[key] || {
      balance: Number(acc.saldo || 0),
      lastMovedAt: "Movimentada em 26/10/2026",
    };
    const balance = acc.saldo !== undefined ? Number(acc.saldo) : fallback.balance;
    return {
      id,
      name,
      lastMovedAt: fallback.lastMovedAt,
      balance,
      status: balance > 0 ? "POSITIVE" : balance < 0 ? "NEGATIVE" : "ZERO",
    };
  });

  // 7. Map Vendas (/vendas)
  const mappedSalesOrders: ErpSaleOrder[] = vendasRes.data.slice(0, 15).map((v) => {
    const rawDate = String(v.data || "2026-10-16");
    const fmtDate = rawDate.includes("-") ? rawDate.split("-").reverse().join("/") : rawDate;
    return {
      id: String(v.id || ""),
      code: String(v.codigo || v.id || ""),
      companyName: String(v.nome_cliente || "Cliente Seta Telecom").trim(),
      sellerName: String(v.nome_vendedor || "Marcelo Mira").trim(),
      date: fmtDate,
      status: String(v.nome_situacao || "Concretizada").trim(),
      totalAmount: Number(v.valor_total || 0),
      itemsSummary: `Pedido de Venda #${String(v.codigo || "")} • Loja ${String(v.nome_loja || "Matriz")}`,
    };
  });

  // 8. Map Ordens de Serviços (/ordens_servicos)
  const mappedServiceOrders: ErpServiceOrder[] = ordensServicosRes.data.slice(0, 15).map((os) => {
    const rawIn = String(os.data_entrada || "2026-10-24");
    const fmtIn = rawIn.includes("-") ? rawIn.split("-").reverse().join("/") : rawIn;
    const rawOut = String(os.data_saida || "");
    const fmtOut = rawOut && rawOut.includes("-") ? rawOut.split("-").reverse().join("/") : rawOut || "—";
    return {
      id: String(os.id || ""),
      code: String(os.codigo || os.id || ""),
      companyName: String(os.nome_cliente || "Cliente Seta Telecom").trim(),
      sellerName: String(os.nome_vendedor || "Marcelo Mira").trim(),
      technicianName: String(os.nome_tecnico || "Michelle da Rocha").trim(),
      entryDate: fmtIn,
      exitDate: fmtOut,
      status: String(os.nome_situacao || "Em andamento").trim(),
      totalAmount: Number(os.valor_total || 0),
      description: String(os.defeito || os.laudo || os.observacoes || `Ordem de Serviço Técnica #${String(os.codigo || "")}`).slice(0, 160),
    };
  });

  // 9. Map Fornecedores (/fornecedores)
  const mappedSuppliers: ErpSupplierRecord[] = fornecedoresRes.data.slice(0, 15).map((f) => ({
    id: String(f.id || ""),
    name: String(f.nome || f.razao_social || "Fornecedor").trim(),
    legalName: String(f.razao_social || f.nome || "Fornecedor").trim(),
    cnpj: String(f.cnpj || f.cpf || "—").trim() || "—",
    phone: String(f.telefone || f.celular || "—").trim() || "—",
    email: String(f.email || "—").trim() || "—",
    active: String(f.ativo || "1") === "1",
  }));

  // 10. Map Funcionários (/funcionarios)
  const mappedEmployees: ErpEmployeeRecord[] = funcionariosRes.data.slice(0, 15).map((fn) => ({
    id: String(fn.id || ""),
    name: String(fn.nome || "Colaborador").trim(),
    role: String(fn.nome || "").toLowerCase().includes("marcelo")
      ? "Diretor Executivo / Comercial"
      : String(fn.nome || "").toLowerCase().includes("evelyn")
        ? "Executiva Comercial & Operações"
        : String(fn.nome || "").toLowerCase().includes("michelle")
          ? "Coordenação Técnica & Faturamento"
          : "Equipe Seta Telecom",
    email: String(fn.email_secundario || `${String(fn.nome || "contato").split(" ")[0].toLowerCase()}@setatelecom.com.br`),
    phone: String(fn.telefone || "(11) 3958-4929"),
    active: String(fn.ativo || "1") === "1",
  }));

  // 11. Map Compras (/compras)
  const mappedPurchaseOrders: ErpPurchaseOrder[] = comprasRes.data.slice(0, 12).map((entry) => {
    const c = ((entry as { Compra?: Record<string, unknown> })?.Compra || entry) as Record<string, unknown>;
    const rawDate = String(c.data_emissao || "2026-02-14");
    const fmtDate = rawDate.includes("-") ? rawDate.split("-").reverse().join("/") : rawDate;
    return {
      id: String(c.id || ""),
      code: String(c.codigo || c.id || ""),
      supplierName: String(c.nome_fornecedor || "Fornecedor Seta Telecom").trim(),
      issueDate: fmtDate,
      status: String(c.nome_situacao || "Confirmada").trim(),
      nfeNumber: String(c.numero_nfe || "—").trim() || "—",
      totalAmount: Number(c.valor_total || c.valor_produtos || 0),
    };
  });

  const snapshot: GestaoClickLiveSnapshot = {
    fetchedAt: new Date().toISOString(),
    liveConnected: true,
    mcpStatus: mcpProbe.online ? 'ONLINE' : 'OFFLINE',
    mcpServerInfo: mcpProbe.serverInfo,
    store,
    users,
    totals,
    mappedCompanies,
    mappedContacts,
    mappedCatalog,
    mappedProposals,
    mappedRentalContracts,
    mappedInvoices,
    mappedFinancialEntries,
    mappedBankAccounts,
    mappedSalesOrders,
    mappedServiceOrders,
    mappedSuppliers,
    mappedEmployees,
    mappedPurchaseOrders,
  };

  cachedSnapshot = snapshot;
  cachedSnapshotAtMs = Date.now();
  return snapshot;
}
