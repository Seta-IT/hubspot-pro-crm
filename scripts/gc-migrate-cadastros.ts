/**
 * Migração GestãoClick -> STI-hub (Fase 1: SOMENTE INSERIR) — clientes, fornecedores,
 * transportadoras, produtos e serviços. Gera também os arquivos da Fase 2 (divergentes e
 * só-no-STI-hub / candidatos à limpeza). Nunca atualiza nem apaga registros existentes.
 *
 * Uso:
 *   node scripts/gc-migrate-cadastros.ts --out <dir> [--gc-dir <dir>] [--state-file <arquivo>] [--apply]
 *
 * - Fonte GestãoClick: --gc-dir com gc-<endpoint>.json já exportados, ou API ao vivo
 *   (GESTAOCLICK_ACCESS_TOKEN / GESTAOCLICK_SECRET_ACCESS_TOKEN do ambiente ou .env.local).
 * - Base STI-hub: --state-file (JSON do CrmDatabaseState) ou DATABASE_URL (Postgres de produção:
 *   crm_kv_store['crm_state_v1'], o mesmo snapshot que o router carrega a cada requisição).
 * - Sem --apply = dry-run (só relatórios). Com --apply e DATABASE_URL: faz backup completo de
 *   crm_kv_store + tabelas espelho em <out>/backup antes de escrever; a escrita é feita numa
 *   transação com SELECT ... FOR UPDATE, recalculando o plano sobre o snapshot mais recente.
 * - Trava Fiscal: nunca mescla documentos (CNPJ/CPF) distintos. Chaves: id GestãoClick
 *   (customProperties.gestaoClickClientId / gestaoClickId / ids comp-gc-, cat-gc-prod-, cat-gc-srv-),
 *   depois documento (só dígitos) para cadastros e código interno para produtos/serviços.
 * - Segredos nunca são impressos.
 */
import fs from 'node:fs';
import path from 'node:path';

type Rec = Record<string, any>;
const argv = process.argv.slice(2);
const arg = (k: string): string | undefined => {
  const i = argv.indexOf(k);
  return i >= 0 ? argv[i + 1] : undefined;
};
const APPLY = argv.includes('--apply');
const OUT = path.resolve(arg('--out') || `/workspace/backups/gc-migracao-${new Date().toISOString().replace(/[:.]/g, '-')}`);
const GC_DIR = arg('--gc-dir');
const STATE_FILE = arg('--state-file');
const MIGRATION_TAG = 'GC_MIGRATION_2026_11';
fs.mkdirSync(OUT, { recursive: true });

// ---------------------------------------------------------------- utilidades
const digits = (v: unknown): string => String(v ?? '').replace(/\D+/g, '');
const norm = (v: unknown): string =>
  String(v ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
const fmtDoc = (d: string): string =>
  d.length === 14
    ? `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`
    : d.length === 11
      ? `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`
      : d;
const maskDoc = (d: string): string => (d.length >= 8 ? `${d.slice(0, 2)}.***.***/${d.slice(-6, -2)}-**` : d ? '***' : '(sem doc)');
function validCnpj(d: string): boolean {
  if (d.length !== 14 || /^(\d)\1+$/.test(d)) return false;
  const calc = (len: number) => {
    const w = len === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    let s = 0;
    for (let i = 0; i < len; i++) s += Number(d[i]) * w[i];
    const r = s % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return calc(12) === Number(d[12]) && calc(13) === Number(d[13]);
}
function validCpf(d: string): boolean {
  if (d.length !== 11 || /^(\d)\1+$/.test(d)) return false;
  for (const len of [9, 10]) {
    let s = 0;
    for (let i = 0; i < len; i++) s += Number(d[i]) * (len + 1 - i);
    const r = ((s * 10) % 11) % 10;
    if (r !== Number(d[len])) return false;
  }
  return true;
}
const validDoc = (d: string) => (d.length === 14 ? validCnpj(d) : d.length === 11 ? validCpf(d) : false);
const TEST_NAME_RE = /\b(teste?s?|test|demo|exemplo|example|ficticio|fict|lorem|ipsum|fulano|ciclano|beltrano|xpto|dummy|mock|sample|acme|placeholder)\b/i;
const isTestEmail = (e: unknown) => /@(example|exemplo|teste?|test)\./i.test(String(e || ''));

function csvEscape(v: unknown): string {
  const s = v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function writeJsonCsv(base: string, rows: Rec[]): void {
  fs.writeFileSync(`${base}.json`, JSON.stringify(rows, null, 1));
  const cols = Array.from(rows.reduce((set: Set<string>, r) => { Object.keys(r).forEach((k) => set.add(k)); return set; }, new Set<string>()));
  fs.writeFileSync(`${base}.csv`, [cols.join(','), ...rows.map((r) => cols.map((c) => csvEscape(r[c])).join(','))].join('\n'));
}

// ---------------------------------------------------------------- GestãoClick
function loadEnvLocal(): void {
  for (const p of [path.join(process.cwd(), '.env.local'), '/workspace/hubspot-pro-crm/.env.local']) {
    if (!fs.existsSync(p)) continue;
    for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
    return;
  }
}
async function fetchAllGc(ep: string): Promise<Rec[]> {
  loadEnvLocal();
  const at = process.env.GESTAOCLICK_ACCESS_TOKEN, st = process.env.GESTAOCLICK_SECRET_ACCESS_TOKEN;
  if (!at || !st) throw new Error('Credenciais do GestãoClick ausentes (GESTAOCLICK_ACCESS_TOKEN / GESTAOCLICK_SECRET_ACCESS_TOKEN).');
  const base = (process.env.GESTAOCLICK_API_URL || 'https://api.gestaoclick.com/api').replace(/\/+$/, '');
  const rows: Rec[] = [];
  for (let page = 1; ; page++) {
    let json: Rec | null = null;
    for (let attempt = 0; attempt < 4 && !json; attempt++) {
      const res = await fetch(`${base}/${ep}?pagina=${page}&limite=100`, {
        headers: { 'access-token': at, 'secret-access-token': st, Accept: 'application/json' },
      });
      if (res.ok) json = (await res.json()) as Rec;
      else await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
    }
    if (!json) throw new Error(`GestãoClick /${ep} página ${page} falhou`);
    const data: Rec[] = Array.isArray(json.data) ? json.data : [];
    rows.push(...data);
    const total = Number(json.meta?.total_paginas || 1);
    if (page >= total || data.length === 0) break;
    await new Promise((r) => setTimeout(r, 400)); // limite oficial: 3 req/s
  }
  return rows;
}
async function loadGc(ep: string): Promise<Rec[]> {
  if (GC_DIR) return JSON.parse(fs.readFileSync(path.join(GC_DIR, `gc-${ep}.json`), 'utf8'));
  const rows = await fetchAllGc(ep);
  fs.writeFileSync(path.join(OUT, `gc-${ep}.json`), JSON.stringify(rows));
  return rows;
}

// ---------------------------------------------------------------- mapeamento GC -> STI-hub
function gcAddress(r: Rec): Rec {
  const e = Array.isArray(r.enderecos) && r.enderecos[0] ? r.enderecos[0].endereco || r.enderecos[0] : {};
  return e || {};
}
const gcDoc = (r: Rec) => digits(r.cnpj || r.cpf || '');
const gcName = (r: Rec) => {
  const razao = String(r.razao_social || '').trim(), nome = String(r.nome || '').trim();
  const cnpjLike = (s: string) => !s || (digits(s).length >= 11 && /^[\d.\/\-\s]+$/.test(s));
  return !cnpjLike(razao) ? razao : !cnpjLike(nome) ? nome : razao || nome || `GestãoClick #${r.id}`;
};
function normalizeOwnerName(raw: unknown): string {
  const s = String(raw || '').trim();
  if (!s) return 'Marcelo Lopes Mira';
  if (s.toLowerCase().includes('marcelo')) return 'Marcelo Lopes Mira';
  if (s.toLowerCase().includes('evelyn')) return 'Evelyn Ternero Seta Telecom';
  return s;
}
function mapCompany(r: Rec, now: string): Rec {
  const d = gcDoc(r), end = gcAddress(r);
  const email = String(r.email || r.email_acesso || '').trim().toLowerCase();
  const domain = email.includes('@') && !/(gmail|hotmail|outlook|yahoo|uol|terra|bol|live|icloud)\./i.test(email) ? email.split('@')[1] : null;
  const filled = [d, end.nome_cidade, end.estado, email, r.telefone || r.celular, r.razao_social].filter(Boolean).length;
  return {
    id: `comp-gc-${r.id}`,
    name: gcName(r),
    domain,
    cnpj: d ? fmtDoc(d) : null,
    industry: null,
    size: null,
    annualRevenue: null,
    city: String(end.nome_cidade || '').trim() || null,
    state: String(end.estado || '').trim() || null,
    country: 'Brasil',
    completenessScore: Math.round((filled / 6) * 100),
    ownerName: normalizeOwnerName(r.nome_vendedor),
    enrichedAt: now,
    enrichmentSource: 'GestãoClick ERP API (migração completa 2026-11-04)',
    customProperties: {
      gestaoClickClientId: String(r.id),
      razaoSocial: String(r.razao_social || '').trim(),
      nomeFantasia: String(r.nome || '').trim(),
      tipoPessoa: String(r.tipo_pessoa || ''),
      inscricaoEstadual: String(r.inscricao_estadual || ''),
      inscricaoMunicipal: String(r.inscricao_municipal || ''),
      email,
      telefone: String(r.telefone || ''),
      celular: String(r.celular || ''),
      endereco: end,
      vendedorGestaoClick: String(r.nome_vendedor || ''),
      origem: MIGRATION_TAG,
    },
    lastActivityAt: null,
    createdAt: now,
    updatedAt: now,
  };
}
function mapSupplier(r: Rec, type: 'FORNECEDOR' | 'TRANSPORTADORA'): Rec {
  const d = gcDoc(r), end = gcAddress(r);
  return {
    id: `${type === 'FORNECEDOR' ? 'forn' : 'transp'}-gc-${r.id}`,
    gestaoClickId: String(r.id),
    name: String(r.nome || r.razao_social || '').trim() || gcName(r),
    legalName: String(r.razao_social || r.nome || '').trim() || gcName(r),
    cnpj: d ? fmtDoc(d) : '—',
    phone: String(r.telefone || r.celular || '').trim() || '—',
    email: String(r.email || '').trim() || '—',
    active: String(r.ativo ?? '1') === '1',
    supplierType: type,
    cityState: end.nome_cidade ? `${end.nome_cidade}${end.estado ? `/${end.estado}` : ''}` : '',
    ...(type === 'TRANSPORTADORA' ? { modalFrete: '' } : {}),
    origem: MIGRATION_TAG,
  };
}
const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
function mapProduct(r: Rec): Rec {
  const ncm = String(r.fiscal?.ncm || '').trim();
  return {
    id: `cat-gc-prod-${r.id}`,
    gestaoClickId: String(r.id),
    gestaoClickCode: String(r.codigo_interno || `GC-PROD-${r.id}`).trim(),
    name: String(r.nome || r.codigo_interno || `Produto GC #${r.id}`).trim(),
    category: 'EQUIPAMENTO_LOCACAO',
    fiscalNature: 'LOCACAO_BENS_MOVEIS',
    ncmOrLc116: ncm ? `NCM ${ncm}` : '',
    cfopDefault: '5.908',
    stockAvailable: num(r.estoque),
    stockRentedInClients: 0,
    monthlyRentalPrice: 0,
    saleOrSetupPrice: num(r.valor_venda),
    costPrice: num(r.valor_custo),
    isActive: String(r.ativo ?? '1') === '1',
    barcodeEan: String(r.codigo_barra || ''),
    productGroup: String(r.nome_grupo || ''),
    movesStock: String(r.movimenta_estoque ?? '1') === '1',
    hasVariations: String(r.possui_variacao ?? '0') === '1',
    hasComposition: String(r.possui_composicao ?? '0') === '1',
    netWeightKg: num(r.peso),
    widthCm: num(r.largura),
    heightCm: num(r.altura),
    lengthCm: num(r.comprimento),
    origem: MIGRATION_TAG,
  };
}
function mapService(r: Rec): Rec {
  return {
    id: `cat-gc-srv-${r.id}`,
    gestaoClickId: String(r.id),
    gestaoClickCode: String(r.codigo || `GC-SRV-${r.id}`).trim(),
    name: String(r.nome || r.codigo || `Serviço GC #${r.id}`).trim(),
    category: 'SERVICO_TECNICO_LC116',
    fiscalNature: 'SERVICO_TECNICO_TI_TELECOM',
    ncmOrLc116: '',
    cfopDefault: '5.933',
    stockAvailable: 0,
    stockRentedInClients: 0,
    monthlyRentalPrice: num(r.valor_venda),
    saleOrSetupPrice: num(r.valor_venda),
    isActive: true,
    origem: MIGRATION_TAG,
  };
}

// ---------------------------------------------------------------- plano
type Entity = 'clientes' | 'fornecedores' | 'transportadoras' | 'produtos' | 'servicos';
interface Plan {
  entity: Entity;
  gcTotal: number;
  stiTotal: number;
  both: Rec[];
  toInsert: Rec[];
  divergent: Rec[];
  conflicts: Rec[];
  gcInternalDuplicates: Rec[];
  stiOnly: Rec[];
}

function stiGcIdOf(entity: Entity, r: Rec): string {
  if (entity === 'clientes') {
    const cp = r.customProperties?.gestaoClickClientId;
    if (cp) return String(cp);
    const m = String(r.id || '').match(/^comp-gc-(\d+)$/);
    return m ? m[1] : '';
  }
  if (r.gestaoClickId) return String(r.gestaoClickId);
  const re = entity === 'produtos' ? /^cat-gc-prod-(\d+)$/ : entity === 'servicos' ? /^cat-gc-srv-(\d+)$/ : entity === 'fornecedores' ? /^forn-gc-(\d+)$/ : /^transp-gc-(\d+)$/;
  const m = String(r.id || '').match(re);
  return m ? m[1] : '';
}
function stiDocOf(entity: Entity, r: Rec): string {
  return entity === 'produtos' || entity === 'servicos' ? '' : digits(r.cnpj);
}
function stiList(state: Rec, entity: Entity): Rec[] {
  const erp = state.erp || {};
  switch (entity) {
    case 'clientes': return state.companies || [];
    case 'fornecedores': return (erp.suppliers || []).filter((s: Rec) => s.supplierType !== 'TRANSPORTADORA');
    case 'transportadoras': return (erp.suppliers || []).filter((s: Rec) => s.supplierType === 'TRANSPORTADORA');
    case 'produtos': return (erp.catalog || []).filter((c: Rec) => c.category !== 'SERVICO_TECNICO_LC116');
    case 'servicos': return (erp.catalog || []).filter((c: Rec) => c.category === 'SERVICO_TECNICO_LC116');
  }
}
function diffFields(entity: Entity, gc: Rec, sti: Rec): Rec[] {
  const out: Rec[] = [];
  const cmp = (campo: string, a: unknown, b: unknown, eq?: (x: unknown, y: unknown) => boolean) => {
    const same = eq ? eq(a, b) : norm(a) === norm(b);
    if (!same) out.push({ campo, gestaoClick: a ?? '', stiHub: b ?? '' });
  };
  const money = (x: unknown, y: unknown) => Math.abs(num(x) - num(y)) < 0.01;
  if (entity === 'clientes') {
    const end = gcAddress(gc);
    cmp('documento', fmtDoc(gcDoc(gc)), sti.cnpj, (x, y) => digits(x) === digits(y));
    const n = norm(sti.name);
    if (n !== norm(gc.razao_social) && n !== norm(gc.nome) && n !== norm(gcName(gc))) out.push({ campo: 'nome', gestaoClick: gcName(gc), stiHub: sti.name });
    if (end.nome_cidade) cmp('cidade', end.nome_cidade, sti.city);
    if (end.estado) cmp('uf', end.estado, sti.state);
  } else if (entity === 'fornecedores' || entity === 'transportadoras') {
    cmp('documento', fmtDoc(gcDoc(gc)), sti.cnpj, (x, y) => digits(x) === digits(y));
    const n = norm(sti.name), l = norm(sti.legalName);
    if (![n, l].some((v) => v && (v === norm(gc.nome) || v === norm(gc.razao_social)))) out.push({ campo: 'nome', gestaoClick: `${gc.nome || ''} / ${gc.razao_social || ''}`, stiHub: `${sti.name || ''} / ${sti.legalName || ''}` });
    if (gc.email) cmp('email', gc.email, sti.email);
    if (gc.telefone || gc.celular) cmp('telefone', digits(gc.telefone || gc.celular), digits(sti.phone));
  } else {
    const m = entity === 'produtos' ? mapProduct(gc) : mapService(gc);
    cmp('nome', m.name, sti.name);
    cmp('codigo', m.gestaoClickCode, sti.gestaoClickCode);
    cmp('preco_venda', m.saleOrSetupPrice, sti.saleOrSetupPrice, money);
    if (entity === 'produtos' && gc.fiscal?.ncm) cmp('ncm', digits(gc.fiscal.ncm), digits(sti.ncmOrLc116).slice(0, 8));
    if (entity === 'produtos') cmp('ativo', m.isActive, sti.isActive, (x, y) => Boolean(x) === Boolean(y));
  }
  return out;
}

function buildPlan(state: Rec, entity: Entity, gcRows: Rec[], now: string): Plan {
  const sti = stiList(state, entity);
  const isCad = entity === 'clientes' || entity === 'fornecedores' || entity === 'transportadoras';
  const byGcId = new Map<string, Rec>(), byDoc = new Map<string, Rec[]>(), byCode = new Map<string, Rec[]>(), byName = new Map<string, Rec[]>();
  for (const r of sti) {
    const g = stiGcIdOf(entity, r); if (g && !byGcId.has(g)) byGcId.set(g, r);
    const d = stiDocOf(entity, r); if (d) byDoc.set(d, [...(byDoc.get(d) || []), r]);
    const c = norm(r.gestaoClickCode); if (!isCad && c) byCode.set(c, [...(byCode.get(c) || []), r]);
    for (const nm of [r.name, r.legalName, r.customProperties?.razaoSocial]) {
      const k = norm(nm); if (k) byName.set(k, [...(byName.get(k) || []), r]);
    }
  }
  const plan: Plan = { entity, gcTotal: gcRows.length, stiTotal: sti.length, both: [], toInsert: [], divergent: [], conflicts: [], gcInternalDuplicates: [], stiOnly: [] };
  const matchedSti = new Set<Rec>();
  const seenGcDoc = new Map<string, Rec>(), seenGcCode = new Map<string, Rec>();
  const sorted = [...gcRows].sort((a, b) => Number(a.id) - Number(b.id));
  for (const gc of sorted) {
    const gid = String(gc.id);
    const d = isCad ? gcDoc(gc) : '';
    const code = !isCad ? norm(entity === 'produtos' ? gc.codigo_interno : gc.codigo) : '';
    let match: Rec | undefined = byGcId.get(gid);
    let via = match ? 'id_gestaoclick' : '';
    if (match && isCad && d && stiDocOf(entity, match) && stiDocOf(entity, match) !== d) {
      // Trava Fiscal: mesmo id GC, documento diferente => não mescla
      plan.conflicts.push({ tipo: 'MESMO_ID_GC_DOCUMENTO_DIFERENTE', gcId: gid, gcNome: gcName(gc), gcDoc: maskDoc(d), stiId: match.id, stiNome: match.name, stiDoc: maskDoc(stiDocOf(entity, match)), acao: 'não inserido, não mesclado' });
      matchedSti.add(match);
      continue;
    }
    if (!match && d) { const c = byDoc.get(d); if (c?.length) { match = c[0]; via = 'documento'; } }
    if (!match && code) { const c = byCode.get(code); if (c?.length) { match = c[0]; via = 'codigo_interno'; } }
    if (match) {
      matchedSti.add(match);
      if (d) for (const r of byDoc.get(d) || []) matchedSti.add(r);
      const diff = diffFields(entity, gc, match);
      plan.both.push({ gcId: gid, stiId: match.id, nome: isCad ? gcName(gc) : gc.nome, via });
      if (diff.length) plan.divergent.push({ entidade: entity, gcId: gid, stiId: match.id, nomeGc: isCad ? gcName(gc) : gc.nome, nomeSti: match.name, via, campos: diff.map((x) => x.campo).join('|'), detalhes: diff });
      continue;
    }
    // duplicados dentro do próprio GestãoClick (mesmo documento / mesmo código) => insere só o primeiro
    const dupKey = d || (code && entity === 'produtos' ? code : '');
    const firstSeen = d ? seenGcDoc.get(d) : dupKey ? seenGcCode.get(dupKey) : undefined;
    if (firstSeen) {
      plan.gcInternalDuplicates.push({ gcId: gid, nome: isCad ? gcName(gc) : gc.nome, chave: d ? maskDoc(d) : gc.codigo_interno, duplicadoDeGcId: String(firstSeen.id), acao: 'não inserido (já coberto pelo primeiro registro)' });
      continue;
    }
    if (d) seenGcDoc.set(d, gc); else if (dupKey) seenGcCode.set(dupKey, gc);
    const mapped = entity === 'clientes' ? mapCompany(gc, now) : entity === 'fornecedores' ? mapSupplier(gc, 'FORNECEDOR') : entity === 'transportadoras' ? mapSupplier(gc, 'TRANSPORTADORA') : entity === 'produtos' ? mapProduct(gc) : mapService(gc);
    // Trava Fiscal: mesmo nome com documento diferente => entidade distinta, inserida separada e listada
    if (isCad) {
      const sameName = (byName.get(norm(gcName(gc))) || []).concat(byName.get(norm(gc.nome)) || []);
      const otherDoc = sameName.find((r) => stiDocOf(entity, r) && stiDocOf(entity, r) !== d);
      const noDoc = sameName.find((r) => !stiDocOf(entity, r));
      if (otherDoc) plan.conflicts.push({ tipo: 'MESMO_NOME_DOCUMENTO_DIFERENTE', gcId: gid, gcNome: gcName(gc), gcDoc: maskDoc(d), stiId: otherDoc.id, stiNome: otherDoc.name, stiDoc: maskDoc(stiDocOf(entity, otherDoc)), acao: 'inserido como registro separado (não mesclado)' });
      else if (noDoc && !d) {
        plan.conflicts.push({ tipo: 'MESMO_NOME_SEM_DOCUMENTO', gcId: gid, gcNome: gcName(gc), gcDoc: '(sem doc)', stiId: noDoc.id, stiNome: noDoc.name, stiDoc: '(sem doc)', acao: 'não inserido: revisar manualmente (possível o mesmo cadastro)' });
        matchedSti.add(noDoc);
        continue;
      }
    }
    plan.toInsert.push(mapped);
  }
  // só no STI-hub
  const docCount = new Map<string, number>();
  for (const r of sti) { const d = stiDocOf(entity, r); if (d) docCount.set(d, (docCount.get(d) || 0) + 1); }
  for (const r of sti) {
    const d = stiDocOf(entity, r);
    const isDup = Boolean(d && (docCount.get(d) || 0) > 1);
    if (matchedSti.has(r) && !isDup) continue;
    const cats: string[] = [];
    const nameBlob = `${r.name || ''} ${r.legalName || ''}`;
    const email = r.email || r.customProperties?.email || '';
    if (TEST_NAME_RE.test(nameBlob) || isTestEmail(email) || (isCad && d && !validDoc(d))) cats.push('TESTE_FICTICIO');
    if (isDup) cats.push('DUPLICADO_MESMO_DOCUMENTO');
    if (!matchedSti.has(r)) cats.push('SEM_CORRESPONDENCIA_GC');
    plan.stiOnly.push({ entidade: entity, stiId: r.id, nome: r.name, documentoMascarado: isCad ? maskDoc(d) : '', codigo: r.gestaoClickCode || '', docValido: isCad ? (d ? validDoc(d) : null) : null, emGestaoClick: matchedSti.has(r), categorias: cats });
  }
  return plan;
}

// vínculos (contratos, faturas, propostas, OS, negócios, contatos, compras)
function linkIndex(state: Rec): { byCompanyId: Set<string>; byDoc: Set<string>; byName: Set<string>; bySku: Set<string> } {
  const erp = state.erp || {};
  const byCompanyId = new Set<string>(), byDoc = new Set<string>(), byName = new Set<string>(), bySku = new Set<string>();
  const add = (o: Rec) => {
    if (o.companyId) byCompanyId.add(String(o.companyId));
    if (o.companyCnpj) byDoc.add(digits(o.companyCnpj));
    for (const k of ['companyName', 'supplierName']) if (o[k]) byName.add(norm(o[k]));
  };
  for (const list of [state.deals, state.contacts, state.serviceTickets, erp.proposals, erp.rentalContracts, erp.invoices, erp.financialEntries, erp.salesOrders, erp.serviceOrders, erp.purchaseOrders]) for (const o of list || []) add(o);
  for (const p of erp.proposals || []) for (const it of p.items || []) { if (it.sku) bySku.add(norm(it.sku)); if (it.catalogItemId) bySku.add(norm(it.catalogItemId)); }
  for (const c of erp.rentalContracts || []) for (const eq of c.equipments || []) if (eq.skuGestaoClick) bySku.add(norm(eq.skuGestaoClick));
  return { byCompanyId, byDoc, byName, bySku };
}
function markLinks(state: Rec, plans: Plan[]): void {
  const L = linkIndex(state);
  for (const p of plans) for (const r of p.stiOnly) {
    const src = stiList(state, p.entity).find((x) => x.id === r.stiId) || {};
    const isCad = !['produtos', 'servicos'].includes(p.entity);
    const linked = isCad
      ? L.byCompanyId.has(String(src.id)) || (digits(src.cnpj) && L.byDoc.has(digits(src.cnpj))) || L.byName.has(norm(src.name)) || (src.legalName && L.byName.has(norm(src.legalName)))
      : L.bySku.has(norm(src.id)) || L.bySku.has(norm(src.gestaoClickCode));
    if (linked) r.categorias.push('TEM_VINCULO_NAO_LIMPAR_SEM_REVISAO');
  }
}

function applyInserts(state: Rec, plans: Plan[]): Rec {
  state.erp = state.erp || {};
  state.erp.suppliers = state.erp.suppliers || [];
  state.erp.catalog = state.erp.catalog || [];
  const ids = { c: new Set((state.companies || []).map((x: Rec) => x.id)), s: new Set(state.erp.suppliers.map((x: Rec) => x.id)), k: new Set(state.erp.catalog.map((x: Rec) => x.id)) };
  const count: Rec = {};
  for (const p of plans) {
    count[p.entity] = 0;
    for (const rec of p.toInsert) {
      const [list, set] = p.entity === 'clientes' ? [state.companies, ids.c] : p.entity === 'produtos' || p.entity === 'servicos' ? [state.erp.catalog, ids.k] : [state.erp.suppliers, ids.s];
      if (set.has(rec.id)) continue; // idempotência por id determinístico
      list.push(rec); set.add(rec.id); count[p.entity]++;
    }
  }
  return count;
}

// ---------------------------------------------------------------- relatórios
function summarize(plans: Plan[]): Rec {
  const ex = <T>(a: T[], n = 5) => a.slice(0, n);
  const out: Rec = {};
  for (const p of plans) {
    const cat = (c: string) => p.stiOnly.filter((r) => r.categorias.includes(c));
    out[p.entity] = {
      gestaoClick: p.gcTotal,
      stiHub: p.stiTotal,
      existemNosDois: p.both.length,
      faltavamNoStiHub: p.toInsert.length,
      comDadosDiferentes: p.divergent.length,
      soNoStiHub: p.stiOnly.filter((r) => !r.emGestaoClick).length,
      duplicadosNoProprioGc: p.gcInternalDuplicates.length,
      conflitosTravaFiscal: p.conflicts.length,
      limpeza: {
        TESTE_FICTICIO: cat('TESTE_FICTICIO').length,
        SEM_CORRESPONDENCIA_GC: cat('SEM_CORRESPONDENCIA_GC').length,
        DUPLICADO_MESMO_DOCUMENTO: cat('DUPLICADO_MESMO_DOCUMENTO').length,
        TEM_VINCULO_NAO_LIMPAR_SEM_REVISAO: cat('TEM_VINCULO_NAO_LIMPAR_SEM_REVISAO').length,
      },
      exemplos: {
        existemNosDois: ex(p.both).map((r) => `${r.nome} (GC ${r.gcId} -> ${r.stiId}, via ${r.via})`),
        faltavam: ex(p.toInsert).map((r) => `${r.name} (${r.cnpj ? maskDoc(digits(r.cnpj)) : r.gestaoClickCode || ''})`),
        divergentes: ex(p.divergent).map((r) => `${r.nomeGc}: ${r.campos}`),
        soNoStiHub: ex(p.stiOnly).map((r) => `${r.nome} ${r.documentoMascarado || r.codigo} [${r.categorias.join(',')}]`),
        conflitos: ex(p.conflicts).map((r) => `${r.tipo}: ${r.gcNome} ${r.gcDoc} x ${r.stiNome} ${r.stiDoc}`),
      },
    };
  }
  return out;
}
function writeReports(plans: Plan[], tag: string): Rec {
  const summary = summarize(plans);
  fs.writeFileSync(path.join(OUT, `resumo-${tag}.json`), JSON.stringify(summary, null, 1));
  writeJsonCsv(path.join(OUT, `fase2-divergentes-${tag}`), plans.flatMap((p) => p.divergent.map((d) => ({ ...d, detalhes: d.detalhes.map((x: Rec) => `${x.campo}: GC="${x.gestaoClick}" | STI="${x.stiHub}"`).join(' ; ') }))));
  writeJsonCsv(path.join(OUT, `fase2-so-no-stihub-limpeza-${tag}`), plans.flatMap((p) => p.stiOnly.map((r) => ({ ...r, categorias: r.categorias.join('|') }))));
  writeJsonCsv(path.join(OUT, `conflitos-trava-fiscal-${tag}`), plans.flatMap((p) => p.conflicts.map((c) => ({ entidade: p.entity, ...c }))));
  writeJsonCsv(path.join(OUT, `duplicados-no-gestaoclick-${tag}`), plans.flatMap((p) => p.gcInternalDuplicates.map((c) => ({ entidade: p.entity, ...c }))));
  writeJsonCsv(path.join(OUT, `insercoes-planejadas-${tag}`), plans.flatMap((p) => p.toInsert.map((r) => ({ entidade: p.entity, id: r.id, nome: r.name, documento: r.cnpj ? maskDoc(digits(r.cnpj)) : '', codigo: r.gestaoClickCode || '' }))));
  return summary;
}

// ---------------------------------------------------------------- main
const ENTITIES: Entity[] = ['clientes', 'fornecedores', 'transportadoras', 'produtos', 'servicos'];
async function main(): Promise<void> {
  const gc: Record<string, Rec[]> = {};
  for (const e of ENTITIES) gc[e] = await loadGc(e);
  const now = new Date().toISOString();
  const plansFor = (state: Rec) => {
    const plans = ENTITIES.map((e) => buildPlan(state, e, gc[e], now));
    markLinks(state, plans);
    return plans;
  };

  if (STATE_FILE) {
    const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    const plans = plansFor(state);
    const summary = writeReports(plans, 'passada1');
    let inserted: Rec = {};
    if (APPLY) {
      fs.copyFileSync(STATE_FILE, path.join(OUT, 'backup-state-file.json'));
      inserted = applyInserts(state, plans);
      fs.writeFileSync(STATE_FILE, JSON.stringify(state));
    }
    const second = plansFor(APPLY ? state : JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')));
    writeReports(second, 'passada2');
    console.log(JSON.stringify({ modo: APPLY ? 'apply(state-file)' : 'dry-run(state-file)', inserted, faltantesSegundaPassada: Object.fromEntries(second.map((p) => [p.entity, p.toInsert.length])), resumo: Object.fromEntries(Object.entries(summary).map(([k, v]) => [k, { gc: v.gestaoClick, sti: v.stiHub, ambos: v.existemNosDois, faltavam: v.faltavamNoStiHub, divergentes: v.comDadosDiferentes, soSti: v.soNoStiHub, conflitos: v.conflitosTravaFiscal }])) }, null, 1));
    return;
  }

  if (!process.env.DATABASE_URL && !process.env.DATABASE_POSTGRES_URL) throw new Error('Sem --state-file e sem DATABASE_URL: nada a comparar.');
  const { Pool } = await import('pg');
  const conn = (process.env.DATABASE_URL || process.env.DATABASE_POSTGRES_URL)!;
  const pool = new Pool({ connectionString: conn, max: 2, ssl: conn.includes('sslmode=require') || process.env.PGSSLMODE === 'require' ? { rejectUnauthorized: false } : undefined });
  try {
    const load = async (client: any, lock = false) => (await client.query(`SELECT payload FROM crm_kv_store WHERE key = 'crm_state_v1'${lock ? ' FOR UPDATE' : ''}`)).rows[0]?.payload;
    const state0 = await load(pool);
    if (!state0) throw new Error('crm_kv_store.crm_state_v1 não encontrado.');
    const plans = plansFor(state0);
    const summary = writeReports(plans, 'passada1');
    let inserted: Rec = {};
    if (APPLY) {
      // BACKUP completo antes de qualquer escrita
      const bdir = path.join(OUT, 'backup');
      fs.mkdirSync(bdir, { recursive: true });
      const tables = (await pool.query(`SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY 1`)).rows.map((r: Rec) => r.tablename);
      const counts: Rec = {};
      for (const t of tables) {
        const rows = (await pool.query(`SELECT * FROM "${t}"`)).rows;
        fs.writeFileSync(path.join(bdir, `${t}.json`), JSON.stringify(rows));
        counts[t] = rows.length;
      }
      const check = JSON.parse(fs.readFileSync(path.join(bdir, 'crm_kv_store.json'), 'utf8'));
      if (!Array.isArray(check) || !check.find((r: Rec) => r.key === 'crm_state_v1')) throw new Error('Backup inválido: abortado sem escrever.');
      fs.writeFileSync(path.join(bdir, 'manifest.json'), JSON.stringify({ at: new Date().toISOString(), counts }, null, 1));
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const fresh = await load(client, true);
        const freshPlans = plansFor(fresh);
        inserted = applyInserts(fresh, freshPlans);
        await client.query(`UPDATE crm_kv_store SET payload = $1::jsonb, updated_at = NOW() WHERE key = 'crm_state_v1'`, [JSON.stringify(fresh)]);
        for (const c of freshPlans.find((p) => p.entity === 'clientes')!.toInsert) {
          await client.query(
            `INSERT INTO crm_companies (id, name, domain, cnpj, industry, completeness_score, data, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::timestamptz) ON CONFLICT (id) DO NOTHING`,
            [c.id, c.name, c.domain, c.cnpj, c.industry, c.completenessScore, JSON.stringify(c), c.updatedAt],
          );
        }
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }
    }
    const second = plansFor(await load(pool));
    writeReports(second, 'passada2');
    console.log(JSON.stringify({ modo: APPLY ? 'apply(postgres)' : 'dry-run(postgres)', inserted, faltantesSegundaPassada: Object.fromEntries(second.map((p) => [p.entity, p.toInsert.length])), resumo: Object.fromEntries(Object.entries(summary).map(([k, v]) => [k, { gc: v.gestaoClick, sti: v.stiHub, ambos: v.existemNosDois, faltavam: v.faltavamNoStiHub, divergentes: v.comDadosDiferentes, soSti: v.soNoStiHub, conflitos: v.conflitosTravaFiscal }])) }, null, 1));
  } finally {
    await pool.end();
  }
}
main().catch((e) => {
  console.error(`ERRO: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
