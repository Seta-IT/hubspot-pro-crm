/**
 * Migracao dos orcamentos para a tabela propria erp_proposals (04/11/2026).
 *
 *   npx tsx scripts/proposals-table/import-proposals.ts --gc-file <gc-orcamentos.json> --out <dir> [--apply]
 *
 * Conexao: DATABASE_URL do ambiente (nunca impressa). Sem --apply = dry-run (le, calcula e grava
 * so os relatorios em --out; nenhuma escrita no banco).
 *
 * Com --apply, numa UNICA transacao:
 *  1. migracao idempotente (CREATE TABLE/INDEX IF NOT EXISTS erp_proposals);
 *  2. le crm_state_v1 e o md5(payload::text) (base do CAS);
 *  3. copia TODAS as propostas atuais do JSON para a tabela preservando id, code, version,
 *     versionHistory e statusHistory (ON CONFLICT DO NOTHING: nunca sobrescreve);
 *  4. insere os orcamentos do GestaoClick que nao existem (id prop-gc-<idGC> e codigo GC),
 *     vinculando companyId pelo id GC do cliente (comp-gc-<id> ou customProperties.gestaoClickClientId)
 *     e cada item ao catalogo pelo id GC do produto/servico (catalogItemId);
 *  5. 4695 (prop-gc-4695, aprovado pelo Marcello): recebe os dados do GC como NOVA versao,
 *     mantendo id, codigo, dono, createdAt e todo o historico de versoes/situacoes;
 *  6. 4704, a duplicata GC-ORC-4695 e qualquer outra proposta ja existente: intocadas (so relatorio);
 *  7. CAS: UPDATE crm_kv_store ... SET erp.proposals=[] + erp.proposalsStorage='table'
 *     WHERE md5(payload::text) = <md5 lido>. 0 linhas (alguem gravou no meio) => ROLLBACK de tudo.
 * Ja em modo tabela => nao faz nada (idempotente).
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { computeProposalTotals } from '../../src/app/lib/proposal-share';
import { extractGcProposalNumber } from '../../src/app/lib/proposal-number';
import {
  applyProposalDiff,
  ensureProposalsTable,
  isProposalsTableState,
  proposalListTotal,
  PROPOSALS_STORAGE_MARKER,
} from '../../src/db/proposal-store';

type Rec = Record<string, any>;
const argv = process.argv.slice(2);
const arg = (k: string): string | undefined => {
  const i = argv.indexOf(k);
  return i >= 0 ? argv[i + 1] : undefined;
};
const APPLY = argv.includes('--apply');
const GC_FILE = arg('--gc-file') || '/workspace/gc-orcamentos-20261104-1047.json';
const OUT = path.resolve(arg('--out') || `/workspace/backups/orc-tabela-${new Date().toISOString().replace(/[:.]/g, '-')}`);
/** Propostas existentes que recebem os dados do GC (aprovacao explicita). */
const OVERWRITE_WITH_GC = new Set((arg('--overwrite-with-gc') || 'prop-gc-4695').split(',').map((s) => s.trim()).filter(Boolean));
fs.mkdirSync(OUT, { recursive: true });

const num = (v: unknown) => {
  const n = Number(String(v ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
};
const r2 = (n: number) => Math.round(n * 100) / 100;
const norm = (s: unknown) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const md5 = (s: string) => createHash('md5').update(s).digest('hex');

// ------------------------------------------------------------ mapeamento GC -> STI-hub
// Mesmo mapeamento validado em /workspace/gc-import-orcamentos/build-payload.ts (2 divergencias
// de total app x GC em 2069, ambas de dado do GC), agora com vinculos por id GC.
function budgetTypeOf(o: Rec): 'PRODUTOS' | 'SERVICOS' | 'LOCACAO' {
  const cc = norm(o.nome_centro_custo);
  const P = (o.produtos || []).length;
  const S = (o.servicos || []).length;
  if (cc.includes('LOCA')) return 'LOCACAO';
  if (!P && S) return 'SERVICOS';
  if (/SERVICO|SUPORTE|CONSULTORIA/.test(cc) && S && !P) return 'SERVICOS';
  return 'PRODUTOS';
}
function statusOf(sit: string) {
  const s = String(sit || '').toLowerCase();
  if (s.includes('concretiz') || s.includes('aprov')) return 'APROVADA';
  if (s.includes('cancel') || s.includes('recus')) return 'RECUSADA';
  if (s.includes('andamento') || s.includes('negocia')) return 'EM_NEGOCIACAO';
  return 'ENVIADA';
}
function contractMonthsOf(o: Rec): number {
  for (const e of o.atributos || []) {
    const a = e?.atributo;
    if (a && /prazo/i.test(String(a.nome || a.descricao || ''))) {
      const m = String(a.conteudo || '').match(/(\d+)/);
      if (m && +m[1] >= 1 && +m[1] <= 120) return +m[1];
    }
  }
  const m = String(o.introducao || '').match(/(\d+)\s*meses/i);
  if (m && +m[1] >= 1 && +m[1] <= 120) return +m[1];
  return 1;
}

interface Links {
  companyByGcId: Map<string, Rec>;
  catalogByGcProd: Map<string, Rec>;
  catalogByGcSrv: Map<string, Rec>;
  /** Itens avulsos no GC (sem produto_id): fallback pelo codigo GC ou nome exato do catalogo. */
  catalogByCodeOrName: Map<string, Rec>;
}

function buildLinks(state: Rec): Links {
  const companyByGcId = new Map<string, Rec>();
  for (const c of state.companies || []) {
    if (!c || !c.id) continue;
    const m = String(c.id).match(/^comp-gc-(\d+)$/);
    if (m) companyByGcId.set(m[1], c);
  }
  for (const c of state.companies || []) {
    const gid = c?.customProperties?.gestaoClickClientId;
    if (gid && !companyByGcId.has(String(gid))) companyByGcId.set(String(gid), c);
  }
  const catalogByGcProd = new Map<string, Rec>();
  const catalogByGcSrv = new Map<string, Rec>();
  for (const it of state.erp?.catalog || []) {
    if (!it || !it.id) continue;
    const mp = String(it.id).match(/^cat-gc-prod-(\d+)$/);
    const ms = String(it.id).match(/^cat-gc-srv-(\d+)$/);
    if (mp) catalogByGcProd.set(mp[1], it);
    if (ms) catalogByGcSrv.set(ms[1], it);
  }
  for (const it of state.erp?.catalog || []) {
    const gid = it?.gestaoClickId ? String(it.gestaoClickId) : '';
    if (!gid) continue;
    const isSrv = it.itemType === 'SERVICE' || it.type === 'SERVICO' || /^cat-gc-srv-/.test(String(it.id));
    const target = isSrv ? catalogByGcSrv : catalogByGcProd;
    if (!target.has(gid)) target.set(gid, it);
    // id GC sem tipo conhecido: vale para os dois mapas (nao sobrescreve o especifico).
    const other = isSrv ? catalogByGcProd : catalogByGcSrv;
    if (!other.has(gid)) other.set(gid, it);
  }
  const catalogByCodeOrName = new Map<string, Rec>();
  for (const it of state.erp?.catalog || []) {
    for (const k of [it?.gestaoClickCode, it?.name]) {
      const key = norm(k);
      if (key.length >= 4 && !catalogByCodeOrName.has(key)) catalogByCodeOrName.set(key, it);
    }
  }
  return { companyByGcId, catalogByGcProd, catalogByGcSrv, catalogByCodeOrName };
}

interface MapStats {
  itemsTotal: number;
  itemsLinked: number;
  itemsLinkedByName: number;
}

export function mapGcProposal(o: Rec, links: Links, st: MapStats, importedAt: string): Rec {
  const gcId = String(o.id);
  const codigo = String(o.codigo);
  const budgetType = budgetTypeOf(o);
  const nature = budgetType === 'PRODUTOS' ? 'VENDA_EQUIPAMENTO' : 'LOCACAO_BENS_MOVEIS';
  const lines = [
    ...(o.produtos || []).map((x: Rec) => ({ k: 'P', g: x.produto })),
    ...(o.servicos || []).map((x: Rec) => ({ k: 'S', g: x.servico })),
  ].filter((l) => l.g);
  const items = lines.map(({ k, g }, idx) => {
    const qty = num(g.quantidade) || 1;
    const unitPrice = num(g.valor_venda);
    const gross = qty * unitPrice;
    const lineTotal = num(g.valor_total);
    const pct = num(g.desconto_porcentagem);
    const discAmt = pct ? 0 : Math.max(0, r2(gross - lineTotal));
    const name = String(k === 'P' ? g.nome_produto : g.nome_servico || '').trim();
    const gcItemId = String((k === 'P' ? g.produto_id : g.servico_id) || '');
    const byId = gcItemId ? (k === 'P' ? links.catalogByGcProd : links.catalogByGcSrv).get(gcItemId) : undefined;
    const byName = byId ? undefined : links.catalogByCodeOrName.get(norm(name));
    const cat = byId || byName;
    st.itemsTotal++;
    if (cat) st.itemsLinked++;
    if (byName) st.itemsLinkedByName++;
    return {
      id: `gc-prop-item-${gcId}-${idx}`,
      sku: String(cat?.gestaoClickCode || cat?.sku || gcItemId || `GC-${idx + 1}`),
      ...(cat ? { catalogItemId: String(cat.id) } : {}),
      ...(gcItemId ? { gestaoClickItemId: gcItemId } : {}),
      description: name,
      itemType: k === 'P' ? 'PRODUCT' : 'SERVICE',
      unit: String(g.sigla_unidade || (k === 'P' ? 'UN' : 'SV')),
      fiscalNature: nature,
      ncmOrServiceCode: String(g.detalhes || ''),
      quantity: qty,
      unitPrice,
      discountPercent: pct,
      discountAmount: discAmt,
      isRecurring: true,
      totalMonthly: lineTotal,
      ...(k === 'S' && budgetType === 'SERVICOS' ? { serviceKind: name } : {}),
    };
  });
  const date = String(o.data || '').slice(0, 10) || '2026-01-01';
  const createdAt = o.cadastrado_em ? new Date(String(o.cadastrado_em).replace(' ', 'T') + '-03:00').toISOString() : `${date}T12:00:00.000Z`;
  const updatedAt = o.modificado_em ? new Date(String(o.modificado_em).replace(' ', 'T') + '-03:00').toISOString() : createdAt;
  const seller = String(o.nome_vendedor || 'Marcelo Mira');
  const status = statusOf(o.nome_situacao);
  const comp = o.cliente_id ? links.companyByGcId.get(String(o.cliente_id)) : undefined;
  const companyName = String(o.nome_cliente || '').trim() || comp?.name || 'Cliente GestãoClick';
  const base: Rec = {
    id: `prop-gc-${gcId}`,
    code: codigo,
    title: `Orçamento #${codigo} — ${companyName}`,
    budgetType,
    status,
    version: 1,
    companyId: comp ? String(comp.id) : null,
    companyName,
    companyCnpj: String(comp?.cnpj || ''),
    contactId: null,
    contactName: String(o.aos_cuidados_de || '').trim(),
    careOf: String(o.aos_cuidados_de || '').trim(),
    dealId: null,
    sellerName: seller,
    storeName: String(o.nome_loja || ''),
    costCenter: String(o.nome_centro_custo || ''),
    salesChannel: String(o.nome_canal_venda || ''),
    proposalDate: date,
    validUntil: String(o.previsao_entrega || date),
    deliveryForecast: String(o.previsao_entrega || ''),
    deliveryLeadTime: String(o.validade || ''),
    contractMonths: contractMonthsOf(o),
    paymentCondition: [o.condicao_pagamento, o.nome_forma_pagamento].filter(Boolean).join(' • '),
    installments: [],
    shippingCost: num(o.valor_frete),
    shippingCarrier: String(o.nome_transportadora || ''),
    setupFee: 0,
    discountAmount: num(o.desconto_porcentagem) ? 0 : num(o.desconto_valor),
    discountPercentGlobal: num(o.desconto_porcentagem),
    introductionText: String(o.introducao || ''),
    commercialNotes: String(o.introducao || ''),
    technicalClauses: String(o.observacoes || ''),
    internalNotes: String(o.observacoes_interna || ''),
    templateStyle: 'CLEAN_CORPORATE_LIGHT',
    ...(budgetType === 'PRODUTOS' ? { slaTier: 'SEM_SLA_ESPECIFICO' } : {}),
    convertedContractId: null,
    convertedInvoiceId: null,
    items,
    createdAt,
    updatedAt,
    gcSource: {
      id: gcId,
      codigo,
      clienteId: o.cliente_id ? String(o.cliente_id) : null,
      hash: o.hash || null,
      situacao: o.nome_situacao,
      valor_total: num(o.valor_total),
      importadoEm: importedAt,
    },
  };
  const p = computeProposalTotals(base as any) as Rec;
  const { gcSource: _g, id: _i, code: _c, version: _v, createdAt: _ca, updatedAt: _ua, budgetType: _b, ...snap } = p;
  void _g; void _i; void _c; void _v; void _ca; void _ua; void _b;
  p.statusHistory = [
    { id: `sh-prop-gc-${gcId}-1`, date: createdAt, notes: 'Orçamento cadastrado', status: 'RASCUNHO', statusLabel: 'Em aberto', employeeName: seller },
    { id: `sh-prop-gc-${gcId}-2`, date: updatedAt, notes: `Situação no GestãoClick: ${o.nome_situacao || 'Em aberto'}`, status, statusLabel: String(o.nome_situacao || 'Em aberto'), employeeName: seller },
  ];
  p.versionHistory = [
    { savedAt: updatedAt, savedBy: seller, version: 1, versionLabel: 'v1', changeSummary: 'Importado do GestãoClick (migração para a tabela de orçamentos 04/11/2026)', changedFields: ['importacao_gestaoclick'], snapshot: snap },
  ];
  return p;
}

/** 4695: dados do GC como nova versao, preservando id/codigo/dono/createdAt/historico. */
export function overwriteWithGc(existing: Rec, gc: Rec, importedAt: string): Rec {
  const prevVersion = Math.max(1, Number(existing.version || 1), ...(existing.versionHistory || []).map((v: Rec) => Number(v.version) || 0));
  const version = prevVersion + 1;
  const keep = {
    id: existing.id,
    code: existing.code,
    createdAt: existing.createdAt,
    sellerName: existing.sellerName || gc.sellerName,
    sellerEmail: existing.sellerEmail,
    sellerPhone: existing.sellerPhone,
    sellerUserId: existing.sellerUserId,
    dealId: existing.dealId ?? null,
    contactId: existing.contactId ?? null,
    convertedContractId: existing.convertedContractId ?? null,
    convertedInvoiceId: existing.convertedInvoiceId ?? null,
    digitalSignature: existing.digitalSignature ?? null,
    templateStyle: existing.templateStyle || gc.templateStyle,
  };
  const merged: Rec = { ...gc, ...keep, version, updatedAt: importedAt };
  for (const k of Object.keys(merged)) if (merged[k] === undefined) delete merged[k];
  const { gcSource: _g, id: _i, code: _c, version: _v, createdAt: _ca, updatedAt: _ua, budgetType: _b, versionHistory: _vh, statusHistory: _sh, ...snap } = merged;
  void _g; void _i; void _c; void _v; void _ca; void _ua; void _b; void _vh; void _sh;
  merged.versionHistory = [
    ...(Array.isArray(existing.versionHistory) ? existing.versionHistory : []),
    {
      savedAt: importedAt,
      savedBy: 'Migração GestãoClick',
      version,
      versionLabel: `v${version}`,
      changeSummary: 'Dados do GestãoClick aplicados (migração 04/11/2026, aprovada pelo Marcéllo); versões anteriores preservadas',
      changedFields: ['importacao_gestaoclick'],
      snapshot: snap,
    },
  ];
  merged.statusHistory = [
    ...(Array.isArray(existing.statusHistory) ? existing.statusHistory : []),
    ...(existing.status !== merged.status
      ? [{ id: `sh-${existing.id}-gc-${version}`, date: importedAt, notes: `Situação no GestãoClick: ${gc.gcSource?.situacao || merged.status}`, status: merged.status, statusLabel: String(gc.gcSource?.situacao || merged.status), employeeName: 'Migração GestãoClick' }]
      : []),
  ];
  return merged;
}

export interface ImportPlan {
  copied: Rec[];
  gcInserts: Rec[];
  overwrites: Rec[];
  skipped: Array<{ gcCodigo: string; gcId: string; motivo: string; stiId: string; stiCode: string; totalSti: number; totalGc: number; divergeTotal: boolean }>;
  noCompany: string[];
  itemsTotal: number;
  itemsLinked: number;
  itemsLinkedByName: number;
  itemsWithoutGcProductId: number;
  proposalsWithUnlinkedItems: string[];
}

export function planImport(state: Rec, gc: Rec[], importedAt: string): ImportPlan {
  const links = buildLinks(state);
  const current: Rec[] = (state.erp?.proposals || []).filter((p: Rec) => p && p.id);
  const byId = new Map<string, Rec>();
  const byCode = new Map<string, Rec>();
  for (const p of current) {
    byId.set(String(p.id).toLowerCase(), p);
    if (String(p.code || '').trim()) byCode.set(String(p.code).trim().toLowerCase(), p);
  }
  const plan: ImportPlan = { copied: current, gcInserts: [], overwrites: [], skipped: [], noCompany: [], itemsTotal: 0, itemsLinked: 0, itemsLinkedByName: 0, itemsWithoutGcProductId: 0, proposalsWithUnlinkedItems: [] };
  const usedOverwrite = new Set<string>();
  const occupied = new Set<string>([...byId.keys(), ...byCode.keys()]);
  for (const o of gc) {
    const st: MapStats = { itemsTotal: 0, itemsLinked: 0, itemsLinkedByName: 0 };
    const mapped = mapGcProposal(o, links, st, importedAt);
    const codeKey = String(o.codigo).toLowerCase();
    const idKey = mapped.id.toLowerCase();
    // existente pelo id GC (prop-gc-<idGC>) ou pelo numero GC no codigo (4695 / GC-ORC-4695 / #4695)
    const hit =
      byId.get(idKey) ||
      byCode.get(codeKey) ||
      current.find((p) => extractGcProposalNumber(p.code) === Number(o.codigo));
    if (hit) {
      const all = current.filter(
        (p) => String(p.id).toLowerCase() === idKey || String(p.code || '').toLowerCase() === codeKey || extractGcProposalNumber(p.code) === Number(o.codigo)
      );
      for (const ex of all) {
        if (OVERWRITE_WITH_GC.has(ex.id) && !usedOverwrite.has(ex.id)) {
          usedOverwrite.add(ex.id);
          plan.overwrites.push(overwriteWithGc(ex, mapped, importedAt));
          continue;
        }
        const totalSti = proposalListTotal(ex);
        plan.skipped.push({
          gcCodigo: String(o.codigo),
          gcId: String(o.id),
          motivo: ex.id.toLowerCase() === idKey ? 'id ja existe' : 'numero/codigo ja existe',
          stiId: ex.id,
          stiCode: ex.code,
          totalSti,
          totalGc: num(o.valor_total),
          divergeTotal: Math.abs(totalSti - num(o.valor_total)) > 0.01,
        });
      }
      continue;
    }
    if (occupied.has(idKey) || occupied.has(codeKey)) {
      plan.skipped.push({ gcCodigo: String(o.codigo), gcId: String(o.id), motivo: 'id/codigo ocupado por outro orcamento GC', stiId: '', stiCode: '', totalSti: 0, totalGc: num(o.valor_total), divergeTotal: false });
      continue;
    }
    occupied.add(idKey);
    occupied.add(codeKey);
    plan.itemsTotal += st.itemsTotal;
    plan.itemsLinked += st.itemsLinked;
    plan.itemsLinkedByName += st.itemsLinkedByName;
    plan.itemsWithoutGcProductId += [...(o.produtos || []).map((x: Rec) => x?.produto?.produto_id), ...(o.servicos || []).map((x: Rec) => x?.servico?.servico_id)].filter((v) => !v).length;
    if (st.itemsLinked < st.itemsTotal) plan.proposalsWithUnlinkedItems.push(mapped.code);
    if (!mapped.companyId) plan.noCompany.push(mapped.code);
    plan.gcInserts.push(mapped);
  }
  return plan;
}

async function main() {
  const gcRaw = JSON.parse(fs.readFileSync(GC_FILE, 'utf8'));
  const gc: Rec[] = Array.isArray(gcRaw) ? gcRaw : gcRaw.data;
  const conn = process.env.DATABASE_URL || process.env.DATABASE_POSTGRES_URL;
  if (!conn) throw new Error('DATABASE_URL ausente');
  const { Pool } = await import('pg');
  const pool = new Pool({ connectionString: conn, max: 2, ssl: conn.includes('sslmode=require') ? { rejectUnauthorized: false } : undefined });
  const client = await pool.connect();
  const importedAt = new Date().toISOString();
  const report: Rec = { modo: APPLY ? 'APPLY' : 'DRY-RUN', importedAt, gcFile: GC_FILE, gcTotal: gc.length };
  try {
    await client.query('BEGIN');
    if (APPLY) await ensureProposalsTable(client as any);
    const res = await client.query(`SELECT payload, md5(payload::text) AS m, length(payload::text) AS len FROM crm_kv_store WHERE key = 'crm_state_v1'`);
    if (!res.rows.length) throw new Error('crm_state_v1 inexistente');
    const state = res.rows[0].payload;
    const casMd5 = String(res.rows[0].m);
    report.stateMd5Antes = casMd5;
    report.stateBytesAntes = Number(res.rows[0].len);
    if (isProposalsTableState(state)) {
      report.resultado = 'JA_EM_MODO_TABELA (nada feito)';
      await client.query('ROLLBACK');
      return;
    }
    fs.writeFileSync(path.join(OUT, 'backup-proposals-antes.json'), JSON.stringify(state.erp?.proposals || []));
    fs.writeFileSync(path.join(OUT, 'backup-proposalShortLinks-antes.json'), JSON.stringify(state.erp?.proposalShortLinks || []));
    const plan = planImport(state, gc, importedAt);
    const overwriteIds = new Set(plan.overwrites.map((p) => p.id));
    report.contagens = {
      existentesCopiadas: plan.copied.length,
      gcInseridas: plan.gcInserts.length,
      gcSobrescritasComAprovacao: plan.overwrites.map((p) => `${p.code} (${p.id}) -> v${p.version}`),
      puladasPorJaExistir: plan.skipped.length,
      semClienteVinculado: plan.noCompany.length,
      itensGc: plan.itemsTotal,
      itensComProdutoVinculado: plan.itemsLinked,
      itensVinculadosPorCodigoOuNome: plan.itemsLinkedByName,
      itensAvulsosNoGcSemIdDeProduto: plan.itemsWithoutGcProductId,
      itensSemProdutoVinculado: plan.itemsTotal - plan.itemsLinked,
      orcamentosComItemSemProduto: plan.proposalsWithUnlinkedItems.length,
      totalEsperadoNaTabela: plan.copied.length + plan.gcInserts.length,
    };
    report.puladas = plan.skipped;
    report.semClienteVinculado = plan.noCompany;
    report.divergenciasTotalAppVsGc = plan.gcInserts
      .filter((p) => Math.abs(proposalListTotal(p) - num(p.gcSource?.valor_total)) > 0.01)
      .map((p) => ({ codigo: p.code, app: proposalListTotal(p), gc: num(p.gcSource?.valor_total) }));
    if (APPLY) {
      const copiedRows = plan.copied.filter((p) => !overwriteIds.has(p.id)).concat(plan.overwrites);
      const r1 = await applyProposalDiff(client as any, { inserts: copiedRows as any[], updates: [], deletes: [] });
      const r2 = await applyProposalDiff(client as any, { inserts: plan.gcInserts as any[], updates: [], deletes: [] });
      report.gravacao = { existentes: r1, gc: { inserted: r2.inserted, skippedInserts: r2.skippedInserts } };
      if (r1.skippedInserts.length) throw new Error(`propostas existentes nao entraram na tabela (ja havia linha): ${r1.skippedInserts.slice(0, 5).join(', ')}`);
      // CAS por md5: so tira as propostas do JSON se o documento nao mudou desde a leitura.
      const cas = await client.query(
        `UPDATE crm_kv_store
            SET payload = jsonb_set(jsonb_set(payload, '{erp,proposals}', '[]'::jsonb), '{erp,proposalsStorage}', '"${PROPOSALS_STORAGE_MARKER}"'::jsonb),
                updated_at = NOW()
          WHERE key = 'crm_state_v1' AND md5(payload::text) = $1
          RETURNING md5(payload::text) AS m, length(payload::text) AS len`,
        [casMd5]
      );
      if (cas.rows.length !== 1) throw new Error('CAS md5 falhou: crm_state_v1 mudou durante a migracao (ROLLBACK, rode de novo)');
      const cnt = await client.query(`SELECT count(*)::int AS n FROM erp_proposals`);
      report.tabelaTotal = cnt.rows[0].n;
      report.stateMd5Depois = cas.rows[0].m;
      report.stateBytesDepois = Number(cas.rows[0].len);
      await client.query('COMMIT');
      report.resultado = 'COMMIT';
    } else {
      await client.query('ROLLBACK');
      report.resultado = 'DRY-RUN (ROLLBACK, nada gravado)';
    }
  } catch (e) {
    await client.query('ROLLBACK').catch(() => null);
    report.resultado = 'ERRO (ROLLBACK)';
    report.erro = e instanceof Error ? e.message : String(e);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
    fs.writeFileSync(path.join(OUT, 'relatorio.json'), JSON.stringify(report, null, 1));
    const { puladas, semClienteVinculado, divergenciasTotalAppVsGc, ...curto } = report;
    console.log(JSON.stringify({ ...curto, puladas: (puladas || []).map((x: Rec) => `${x.gcCodigo}->${x.stiCode}(${x.motivo}${x.divergeTotal ? ', total diverge' : ''})`), semClienteVinculado: (semClienteVinculado || []).length, divergenciasTotalAppVsGc, relatorio: path.join(OUT, 'relatorio.json') }, null, 1));
  }
}

if (process.argv[1] && /import-proposals\.ts$/.test(process.argv[1])) {
  main();
}
