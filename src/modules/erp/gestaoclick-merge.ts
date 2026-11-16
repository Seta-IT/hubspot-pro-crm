// ============================================================================
// GestãoClick -> STI-hub: merge não destrutivo usado pelo syncLiveGestaoClick.
//
// Regras (válidas para clientes/empresas, fornecedores e catálogo):
//  - NUNCA substitui a lista inteira nem apaga registros existentes do STI-hub.
//  - Casa primeiro pelo id do GestãoClick (gestaoClickId / customProperties
//    .gestaoClickClientId / ids comp-gc-N, forn-gc-N, cat-gc-prod-N...).
//  - Fallback por documento (CNPJ/CPF só dígitos).
//  - Trava Fiscal: nunca mescla documentos diferentes. Mesmo id GC com
//    documento diferente => conflito, nada é mesclado nem inserido.
//  - Registro casado: só preenche campos vazios ('' / '—' / null); nunca
//    sobrescreve dado já preenchido (atualizar divergências é Fase 2,
//    com aprovação).
// ============================================================================

import { Company, ErpCatalogItem, ErpRentalContract, ErpSupplierRecord } from '../../db/types';

export interface GcMergeStats {
  inserted: number;
  updated: number;
  unchanged: number;
  conflicts: Array<{ gcId: string; existingId: string; reason: string }>;
}

const emptyStats = (): GcMergeStats => ({ inserted: 0, updated: 0, unchanged: 0, conflicts: [] });

export function onlyDigits(v: unknown): string {
  return String(v ?? '').replace(/\D+/g, '');
}

/** Documento utilizável para casamento (CPF 11 ou CNPJ 14 dígitos). */
export function docKey(v: unknown): string {
  const d = onlyDigits(v);
  return d.length === 11 || d.length === 14 ? d : '';
}

function normName(v: unknown): string {
  return String(v ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function isBlank(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  const s = String(v).trim();
  return s === '' || s === '—' || s === '-';
}

// ---------------------------------------------------------------------------
// Empresas / clientes
// ---------------------------------------------------------------------------

export function companyGcId(c: Partial<Company> & { customProperties?: Record<string, unknown> }): string {
  const cp = c.customProperties?.gestaoClickClientId;
  if (cp !== undefined && cp !== null && String(cp).trim()) return String(cp).trim();
  const m = String(c.id || '').match(/^comp-gc-(\d+)$/);
  return m ? m[1] : '';
}

export type GcIncomingCompany = Partial<Company> & { name: string; gestaoClickClientId: string };

/**
 * Insere empresas do GC que ainda não existem. Casamento: id GC -> documento
 * -> nome (nome só quando não há documentos conflitantes). Não altera nem
 * remove empresas existentes.
 */
export function mergeGcCompanies(
  companies: Company[],
  incoming: GcIncomingCompany[],
  build: (gc: GcIncomingCompany) => Company
): { stats: GcMergeStats; byGcId: Map<string, Company> } {
  const stats = emptyStats();
  const byGcId = new Map<string, Company>();
  const byId = new Map<string, Company>();
  const byDoc = new Map<string, Company>();
  const byName = new Map<string, Company[]>();
  const index = (c: Company) => {
    byId.set(c.id, c);
    const g = companyGcId(c);
    if (g && !byGcId.has(g)) byGcId.set(g, c);
    const d = docKey(c.cnpj);
    if (d && !byDoc.has(d)) byDoc.set(d, c);
    const n = normName(c.name);
    if (n) byName.set(n, [...(byName.get(n) || []), c]);
  };
  companies.forEach(index);

  const resolved = new Map<string, Company>();
  for (const gc of incoming) {
    const gid = String(gc.gestaoClickClientId || '').trim();
    const d = docKey(gc.cnpj);
    let match = (gid && byGcId.get(gid)) || (gc.id ? byId.get(gc.id) : undefined);
    if (match) {
      const md = docKey(match.cnpj);
      if (d && md && d !== md) {
        stats.conflicts.push({ gcId: gid, existingId: match.id, reason: 'MESMO_ID_GC_DOCUMENTO_DIFERENTE' });
        continue;
      }
    }
    if (!match && d) match = byDoc.get(d);
    if (!match) {
      // nome: só casa com quem não tem documento conflitante (Trava Fiscal)
      const cands = byName.get(normName(gc.name)) || [];
      match = cands.find((c) => {
        const cd = docKey(c.cnpj);
        return !(d && cd && cd !== d);
      });
    }
    if (match) {
      stats.unchanged++;
      if (gid) resolved.set(gid, match);
      continue;
    }
    const created = build(gc);
    if (byId.has(created.id)) {
      // id já ocupado por outro cadastro (documento diferente): não mescla
      stats.conflicts.push({ gcId: gid, existingId: created.id, reason: 'ID_OCUPADO_DOCUMENTO_DIFERENTE' });
      continue;
    }
    companies.push(created);
    index(created);
    if (gid) {
      byGcId.set(gid, created);
      resolved.set(gid, created);
    }
    stats.inserted++;
  }
  return { stats, byGcId: resolved };
}

// ---------------------------------------------------------------------------
// Fornecedores (o endpoint /fornecedores do GC; transportadoras nunca são
// tocadas por este merge, pois têm espaço de ids próprio no GC)
// ---------------------------------------------------------------------------

export function supplierGcId(s: Partial<ErpSupplierRecord>): string {
  if (s.gestaoClickId && String(s.gestaoClickId).trim()) return String(s.gestaoClickId).trim();
  const id = String(s.id || '').trim();
  if (/^\d+$/.test(id)) return id; // formato legado do sync ao vivo (id cru do GC)
  const m = id.match(/^(?:forn|transp)-gc-(\d+)$/);
  return m ? m[1] : '';
}

const SUPPLIER_FILLABLE: Array<keyof ErpSupplierRecord> = ['name', 'legalName', 'cnpj', 'phone', 'email', 'cityState'];

export function mergeGcSuppliers(suppliers: ErpSupplierRecord[], incoming: ErpSupplierRecord[]): GcMergeStats {
  const stats = emptyStats();
  const pool = () => suppliers.filter((s) => s.supplierType !== 'TRANSPORTADORA');
  const byGcId = new Map<string, ErpSupplierRecord>();
  const byDoc = new Map<string, ErpSupplierRecord>();
  const ids = new Set(suppliers.map((s) => s.id));
  for (const s of pool()) {
    const g = supplierGcId(s);
    if (g && !byGcId.has(g)) byGcId.set(g, s);
    const d = docKey(s.cnpj);
    if (d && !byDoc.has(d)) byDoc.set(d, s);
  }

  for (const inc of incoming) {
    const gid = supplierGcId(inc);
    const d = docKey(inc.cnpj);
    let match = gid ? byGcId.get(gid) : undefined;
    if (match) {
      const md = docKey(match.cnpj);
      if (d && md && d !== md) {
        stats.conflicts.push({ gcId: gid, existingId: match.id, reason: 'MESMO_ID_GC_DOCUMENTO_DIFERENTE' });
        continue;
      }
    }
    if (!match && d) match = byDoc.get(d);

    if (match) {
      let changed = false;
      for (const f of SUPPLIER_FILLABLE) {
        const nv = (inc as unknown as Record<string, unknown>)[f];
        if (isBlank((match as unknown as Record<string, unknown>)[f]) && !isBlank(nv)) {
          (match as unknown as Record<string, unknown>)[f] = nv;
          changed = true;
        }
      }
      if (gid && !match.gestaoClickId) {
        match.gestaoClickId = gid;
        changed = true;
      }
      if (changed) stats.updated++;
      else stats.unchanged++;
      if (gid && !byGcId.has(gid)) byGcId.set(gid, match);
      continue;
    }

    let newId = gid ? `forn-gc-${gid}` : inc.id;
    if (!newId || ids.has(newId)) newId = `forn-gc-${gid || inc.id || Date.now()}-${suppliers.length}`;
    const created: ErpSupplierRecord = {
      ...inc,
      id: newId,
      supplierType: inc.supplierType || 'FORNECEDOR',
      ...(gid ? { gestaoClickId: gid } : {}),
    };
    suppliers.push(created);
    ids.add(created.id);
    if (gid) byGcId.set(gid, created);
    if (d) byDoc.set(d, created);
    stats.inserted++;
  }
  return stats;
}

// ---------------------------------------------------------------------------
// Catálogo (produtos e serviços): só insere; casa por id, id GC ou código.
// ---------------------------------------------------------------------------

function catalogKind(c: Partial<ErpCatalogItem>): 'srv' | 'prod' {
  return c.category === 'SERVICO_TECNICO_LC116' ? 'srv' : 'prod';
}

export function catalogGcId(c: Partial<ErpCatalogItem>): string {
  if (c.gestaoClickId && String(c.gestaoClickId).trim()) return String(c.gestaoClickId).trim();
  const m = String(c.id || '').match(/^cat-gc-(?:prod|srv)-(\d+)$/);
  return m ? m[1] : '';
}

export function mergeGcCatalog(catalog: ErpCatalogItem[], incoming: ErpCatalogItem[]): GcMergeStats {
  const stats = emptyStats();
  const ids = new Set(catalog.map((c) => c.id));
  const gcKeys = new Set<string>();
  const codeKeys = new Set<string>();
  const add = (c: ErpCatalogItem) => {
    ids.add(c.id);
    const g = catalogGcId(c);
    if (g) gcKeys.add(`${catalogKind(c)}:${g}`);
    const code = normName(c.gestaoClickCode);
    if (code) codeKeys.add(`${catalogKind(c)}:${code}`);
  };
  catalog.forEach(add);
  for (const item of incoming) {
    const kind = catalogKind(item);
    const g = catalogGcId(item);
    const code = normName(item.gestaoClickCode);
    if (ids.has(item.id) || (g && gcKeys.has(`${kind}:${g}`)) || (code && codeKeys.has(`${kind}:${code}`))) {
      stats.unchanged++;
      continue;
    }
    const created = g && !item.gestaoClickId ? { ...item, gestaoClickId: g } : item;
    catalog.push(created);
    add(created);
    stats.inserted++;
  }
  return stats;
}

// ---------------------------------------------------------------------------
// Contratos (locação LO e serviço CO)
// ---------------------------------------------------------------------------

function formatCnpjCpf(digits: string): string {
  if (digits.length === 14) {
    return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12)}`;
  }
  if (digits.length === 11) {
    return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
  }
  return digits;
}

/**
 * Campos do contrato que vêm do GestãoClick e são espelhados (decisão do
 * Marcéllo em 16/11: "deve estar tudo como esta no gestao click").
 * Campos só do STI-hub (índice de reajuste, modelo de contrato, cláusulas,
 * versões, assinatura, faturamento, deal/contato, CFOP de remessa, nota legal
 * etc.) não estão aqui e nunca são tocados.
 */
export const GC_MIRRORED_CONTRACT_FIELDS = [
  'contractNumber',
  'title',
  'modality',
  'gestaoClickCode',
  'nextDueDate',
  'sellerName',
  'proposalId',
  'monthlyValue',
  'dueDay',
  'startDate',
  'endDate',
  'contractMonths',
  'status',
  'remessaNfeNumber',
] as const;

/** Identidade fiscal do cliente: sob conflito de CNPJ (Trava Fiscal) não muda. */
const GC_IDENTITY_CONTRACT_FIELDS = ['companyId', 'companyName'] as const;

/** Campos de equipamento espelhados do GC; serial, patrimônio, NCM, chave NF-e etc. ficam do STI-hub. */
const GC_MIRRORED_EQUIPMENT_FIELDS = ['skuGestaoClick', 'description', 'quantity', 'unitMonthlyRent'] as const;

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

function mirrorEquipments(
  contractGcPrefix: string,
  current: ErpRentalContract['equipments'],
  incoming: ErpRentalContract['equipments']
): { list: ErpRentalContract['equipments']; changed: boolean } {
  const currentList = Array.isArray(current) ? current : [];
  const incomingList = Array.isArray(incoming) ? incoming : [];
  const byId = new Map(currentList.map((e) => [e.id, e]));
  const incomingIds = new Set(incomingList.map((e) => e.id));
  let changed = false;
  const list: ErpRentalContract['equipments'] = [];
  for (const inc of incomingList) {
    const ex = byId.get(inc.id);
    if (!ex) {
      list.push(inc);
      changed = true;
      continue;
    }
    const merged = { ...ex };
    for (const f of GC_MIRRORED_EQUIPMENT_FIELDS) {
      if (!sameValue(ex[f], inc[f])) {
        (merged as Record<string, unknown>)[f] = inc[f];
        changed = true;
      }
    }
    list.push(merged);
  }
  for (const ex of currentList) {
    if (incomingIds.has(ex.id)) continue;
    // Item gerado pelo GC que não existe mais no GC sai; item criado no STI-hub fica.
    if (ex.id.startsWith(contractGcPrefix)) {
      changed = true;
      continue;
    }
    list.push(ex);
  }
  return { list, changed };
}

/**
 * Espelha todos os contratos do GC (chave = id ctr-gc-N, sem duplicar).
 * - Novo: inserido. CNPJ vazio no GC é completado pelo cadastro de empresas
 *   do STI-hub (id GC do cliente, depois companyId, depois nome exato).
 * - Existente: os campos de GC_MIRRORED_CONTRACT_FIELDS e os itens do GC
 *   passam a valer como no GestãoClick (status, valores, datas, tipo...).
 * - Trava Fiscal: CNPJ do STI-hub diferente do CNPJ do GC => conflito; o CNPJ
 *   e a identidade do cliente não mudam (os demais campos são espelhados).
 */
export function mergeGestaoClickContracts(
  contracts: ErpRentalContract[],
  incoming: ErpRentalContract[],
  companies: Array<Partial<Company> & { customProperties?: Record<string, unknown> }> = [],
  nowIso: string = new Date().toISOString()
): GcMergeStats {
  const stats = emptyStats();
  const docByGcClient = new Map<string, string>();
  const docByCompanyId = new Map<string, string>();
  const docByName = new Map<string, string>();
  for (const c of companies) {
    const d = docKey(c.cnpj);
    if (!d) continue;
    const gcId = companyGcId(c);
    if (gcId) docByGcClient.set(gcId, d);
    if (c.id) docByCompanyId.set(String(c.id), d);
    const n = normName(c.name);
    if (n) docByName.set(n, d);
  }
  const resolveDoc = (ctr: ErpRentalContract): string => {
    const own = docKey(ctr.companyCnpj);
    if (own) return own;
    const gcClient = String(ctr.companyId || '').match(/^comp-gc-(\d+)$/)?.[1] || '';
    return (
      (gcClient && docByGcClient.get(gcClient)) ||
      (ctr.companyId && docByCompanyId.get(String(ctr.companyId))) ||
      docByName.get(normName(ctr.companyName)) ||
      ''
    );
  };

  const byId = new Map(contracts.map((c) => [c.id, c]));
  for (const raw of incoming) {
    if (!raw?.id) continue;
    const doc = resolveDoc(raw);
    const next: ErpRentalContract = doc ? { ...raw, companyCnpj: formatCnpjCpf(doc) } : raw;
    const existing = byId.get(raw.id);
    if (!existing) {
      contracts.push(next);
      byId.set(next.id, next);
      stats.inserted++;
      continue;
    }

    const target = existing as unknown as Record<string, unknown>;
    const source = next as unknown as Record<string, unknown>;
    let changed = false;
    const setField = (f: string) => {
      if (!(f in source) || source[f] === undefined) return;
      // proposalId nulo no GC não desfaz vínculo com proposta do STI-hub.
      if (f === 'proposalId' && source[f] === null) return;
      if (!sameValue(target[f], source[f])) {
        target[f] = source[f];
        changed = true;
      }
    };

    const existingDoc = docKey(existing.companyCnpj);
    const conflict = Boolean(existingDoc && doc && existingDoc !== doc);
    if (conflict) {
      stats.conflicts.push({ gcId: raw.id, existingId: existing.id, reason: 'CNPJ divergente (Trava Fiscal)' });
    } else {
      if (isBlank(existing.companyCnpj) && doc) {
        existing.companyCnpj = formatCnpjCpf(doc);
        changed = true;
      }
      for (const f of GC_IDENTITY_CONTRACT_FIELDS) setField(f);
    }
    for (const f of GC_MIRRORED_CONTRACT_FIELDS) setField(f);

    const eq = mirrorEquipments(`eq-gc-${raw.id.replace(/^ctr-gc-/, '')}-`, existing.equipments, next.equipments);
    if (eq.changed) {
      existing.equipments = eq.list;
      changed = true;
    }

    if (changed) {
      existing.updatedAt = nowIso;
      stats.updated++;
    } else {
      stats.unchanged++;
    }
  }
  return stats;
}

// ---------------------------------------------------------------------------
// Vendas e ordens de serviço (espelho somente leitura do GC)
// ---------------------------------------------------------------------------

/**
 * Upsert pelo id do GestãoClick: campos do GC sobrescrevem o espelho, registros
 * novos entram no fim e registros que não vieram nesta leitura são mantidos
 * (uma leitura parcial nunca encolhe a lista). Antes a lista era substituída
 * inteira pelos 15 primeiros registros.
 */
export function upsertRecordsById<T extends { id: string }>(current: T[], incoming: T[]): T[] {
  const result = [...current];
  const index = new Map<string, number>();
  result.forEach((r, i) => {
    if (r?.id) index.set(String(r.id), i);
  });
  for (const rec of incoming) {
    const id = String(rec?.id || '').trim();
    if (!id) continue;
    const at = index.get(id);
    if (at === undefined) {
      index.set(id, result.length);
      result.push(rec);
    } else {
      // Campos do GC sobrescrevem; campos só do STI-hub (ex.: prioridade, laudo,
      // forma de pagamento, comissão) que o GC não envia ficam intactos.
      result[at] = { ...result[at], ...rec };
    }
  }
  return result;
}
