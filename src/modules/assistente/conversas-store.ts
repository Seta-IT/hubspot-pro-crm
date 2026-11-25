// ============================================================================
// STI-hub — Assistente: conversas, memória aprendida e regras de acessórios (25/11/2026).
//
// Pedido do Marcéllo: "conversas na IA separadas e manter o histórico com opção de apagar
// e encerrar a conversa. A IA deve estar em constante aprendizado".
// Tabelas proprias (nada no crm_state_v1), sempre filtradas pelo dono (owner_uid):
//   assistente_conversas, assistente_mensagens, assistente_memorias,
//   assistente_regras_acessorios (editavel, global) e assistente_auditoria.
// Migracoes aditivas, versionadas (assistente_schema_migrations), sob advisory lock.
// Sem banco: MemoryAssistenteStore (dev/testes). Nunca guarda PDF nem token de cartao.
// ============================================================================
import { randomBytes } from 'node:crypto';
import { getPostgresPool, isPostgresEnabled, type PgQueryable, type PgPoolLike } from '../../db/postgres';

export type StatusConversa = 'aberta' | 'encerrada';

export interface ConversaResumo {
  id: string;
  titulo: string;
  status: StatusConversa;
  criadaEm: string;
  atualizadaEm: string;
  encerradaEm: string | null;
  mensagens: number;
}

export interface ItemConversa {
  id: string;
  seq: number;
  /** Item do painel (usuario, assistente, resultado, cartao...), ja saneado. */
  item: Record<string, unknown>;
  feedback: 'positivo' | 'negativo' | null;
  feedbackMotivo: string | null;
}

export interface ConversaCompleta extends ConversaResumo {
  itens: ItemConversa[];
}

export type TipoMemoria = 'preferencia' | 'correcao' | 'feedback' | 'sugestao';

export interface MemoriaAprendida {
  id: string;
  tipo: TipoMemoria;
  texto: string;
  /** Trava Fiscal: licao ligada a UM CNPJ (14 digitos) ou nenhuma. */
  cnpj: string | null;
  /** Sugestao de acessorio: modelo base, item sugerido e se foi aceito. */
  dados: { base?: string; item?: string; aceito?: boolean; aceitos?: number; recusados?: number } | null;
  origemConversaId: string | null;
  ativa: boolean;
  criadaEm: string;
  atualizadaEm: string;
}

export type CategoriaAcessorio = 'fonte' | 'optico' | 'uplink' | 'acessorio';

export interface RegraAcessorio {
  id: string;
  /** Padrao do part number do modelo base, com * (ex.: WS-C3850-*). */
  familia: string;
  categoria: CategoriaAcessorio;
  /** Padrao do part number do acessorio no cadastro, com * (ex.: PWR-C1-*). */
  padrao: string;
  /** Padrao a excluir (ex.: *BLANK*). */
  excluir: string | null;
  observacao: string;
  ativa: boolean;
  ordem: number;
}

export interface EntradaAuditoria {
  ownerUid: string;
  acao: string;
  alvo: string;
  detalhe: string;
}

export const LIMITES_CONVERSA = {
  maxConversasPorUsuario: 500,
  maxItensPorConversa: 400,
  maxBytesItem: 64_000,
  maxTitulo: 120,
  maxMemoriasPorUsuario: 300,
  maxTextoMemoria: 500,
  maxMotivo: 500,
} as const;

export interface AssistenteStore {
  listarConversas(uid: string, opts?: { busca?: string; limite?: number }): Promise<ConversaResumo[]>;
  criarConversa(uid: string, titulo?: string): Promise<ConversaResumo>;
  obterConversa(uid: string, id: string): Promise<ConversaCompleta | null>;
  /** Grava (upsert por id) os itens; devolve null se a conversa nao e do usuario. */
  salvarItens(uid: string, id: string, itens: Array<{ id: string; item: Record<string, unknown> }>): Promise<ConversaResumo | null>;
  atualizarConversa(uid: string, id: string, patch: { titulo?: string; status?: StatusConversa }): Promise<ConversaResumo | null>;
  apagarConversa(uid: string, id: string): Promise<boolean>;
  apagarTodasConversas(uid: string): Promise<number>;
  registrarFeedback(uid: string, conversaId: string, itemId: string, nota: 'positivo' | 'negativo' | null, motivo?: string | null): Promise<ItemConversa | null>;

  listarMemorias(uid: string): Promise<MemoriaAprendida[]>;
  criarMemoria(uid: string, m: { tipo: TipoMemoria; texto: string; cnpj?: string | null; dados?: MemoriaAprendida['dados']; origemConversaId?: string | null }): Promise<MemoriaAprendida>;
  atualizarMemoria(uid: string, id: string, patch: { texto?: string; ativa?: boolean }): Promise<MemoriaAprendida | null>;
  apagarMemoria(uid: string, id: string): Promise<boolean>;

  listarRegras(): Promise<RegraAcessorio[]>;
  salvarRegra(r: Omit<RegraAcessorio, 'id'> & { id?: string }): Promise<RegraAcessorio>;
  apagarRegra(id: string): Promise<boolean>;

  auditar(e: EntradaAuditoria): Promise<void>;
}

// ---------------------------------------------------------------------------
// Regras padrao (seed). Familias de part number Cisco conferidas no cadastro de produtos.
// ---------------------------------------------------------------------------
export const REGRAS_ACESSORIOS_PADRAO: Array<Omit<RegraAcessorio, 'id'>> = [
  { familia: 'WS-C3850-*', categoria: 'fonte', padrao: 'PWR-C1-*', excluir: '*BLANK*', observacao: 'Fonte redundante (StackPower / Config 1) do Catalyst 3850', ativa: true, ordem: 10 },
  { familia: 'WS-C3850-*', categoria: 'uplink', padrao: 'C3850-NM-*', excluir: '*BLANK*', observacao: 'Módulo de uplink do Catalyst 3850', ativa: true, ordem: 20 },
  { familia: 'WS-C3850-*', categoria: 'optico', padrao: 'GLC-*', excluir: '*FE-100*', observacao: 'SFP 1G para os uplinks do 3850', ativa: true, ordem: 30 },
  { familia: 'WS-C3850-*', categoria: 'optico', padrao: 'SFP-10G-*', excluir: null, observacao: 'SFP+ 10G (módulos C3850-NM-*-10G)', ativa: true, ordem: 31 },
  { familia: 'WS-C3850-*', categoria: 'acessorio', padrao: 'C3850-4PT-KIT*', excluir: null, observacao: 'Kit de rack do 3850', ativa: true, ordem: 40 },
  { familia: 'WS-C3850-*', categoria: 'acessorio', padrao: 'RCKMNT-T1*', excluir: null, observacao: 'Suporte de rack 1U do 3850/3650', ativa: true, ordem: 41 },
  { familia: 'WS-C3850-*', categoria: 'acessorio', padrao: 'STACK-T1-*', excluir: null, observacao: 'Cabo StackWise-480 do 3850', ativa: true, ordem: 42 },
  { familia: 'WS-C3850-*', categoria: 'acessorio', padrao: 'CAB-SPWR-*', excluir: null, observacao: 'Cabo StackPower do 3850', ativa: true, ordem: 43 },
  { familia: 'WS-C3650-*', categoria: 'fonte', padrao: 'PWR-C2-*', excluir: '*BLANK*', observacao: 'Fonte redundante do Catalyst 3650', ativa: true, ordem: 10 },
  { familia: 'WS-C3650-*', categoria: 'optico', padrao: 'GLC-*', excluir: '*FE-100*', observacao: 'SFP 1G', ativa: true, ordem: 30 },
  { familia: 'WS-C3650-*', categoria: 'optico', padrao: 'SFP-10G-*', excluir: null, observacao: 'SFP+ 10G', ativa: true, ordem: 31 },
  { familia: 'C9300-*', categoria: 'fonte', padrao: 'PWR-C1-*', excluir: '*BLANK*', observacao: 'Fonte redundante (Config 1) do Catalyst 9300', ativa: true, ordem: 10 },
  { familia: 'C9300-*', categoria: 'uplink', padrao: 'C9300-NM-*', excluir: '*BLANK*', observacao: 'Módulo de uplink do Catalyst 9300', ativa: true, ordem: 20 },
  { familia: 'C9300-*', categoria: 'optico', padrao: 'SFP-10G-*', excluir: null, observacao: 'SFP+ 10G', ativa: true, ordem: 31 },
  { familia: 'C9300-*', categoria: 'optico', padrao: 'GLC-*', excluir: '*FE-100*', observacao: 'SFP 1G', ativa: true, ordem: 30 },
  { familia: 'WS-C3750X-*', categoria: 'fonte', padrao: 'C3KX-PWR-*', excluir: null, observacao: 'Fonte do Catalyst 3750-X', ativa: true, ordem: 10 },
  { familia: 'WS-C3750X-*', categoria: 'uplink', padrao: 'C3KX-NM-*', excluir: '*BLANK*', observacao: 'Módulo de uplink do 3750-X', ativa: true, ordem: 20 },
  { familia: 'WS-C3750X-*', categoria: 'optico', padrao: 'GLC-*', excluir: '*FE-100*', observacao: 'SFP 1G', ativa: true, ordem: 30 },
];

export const novoId = (prefixo: string) => `${prefixo}-${Date.now().toString(36)}-${randomBytes(4).toString('hex')}`;
const agoraIso = () => new Date().toISOString();

/** Titulo automatico a partir da 1a pergunta. */
export function tituloAutomatico(texto: string): string {
  const t = String(texto || '').replace(/\s+/g, ' ').trim();
  if (!t) return 'Nova conversa';
  const curto = t.length > 60 ? `${t.slice(0, 57).replace(/\s+\S*$/, '')}…` : t;
  return curto.charAt(0).toUpperCase() + curto.slice(1);
}

const limparTitulo = (t: unknown) => String(t ?? '').replace(/[\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, LIMITES_CONVERSA.maxTitulo);

/**
 * Saneia o item antes de gravar: tira o token assinado do cartao (uso unico, nunca vai
 * para o banco), tira campos binarios/PDF e limita o tamanho.
 */
export function sanearItem(item: unknown): Record<string, unknown> | null {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
  const copia = JSON.parse(JSON.stringify(item)) as Record<string, any>;
  const remover = (o: any, profundidade = 0) => {
    if (!o || typeof o !== 'object' || profundidade > 8) return;
    for (const k of Object.keys(o)) {
      if (/^(token|recibo|pdf|pdfBase64|arquivo|blob|base64|senha|password)$/i.test(k)) delete o[k];
      else if (typeof o[k] === 'string' && /^data:[a-z]+\/[a-z0-9.+-]+;base64,/i.test(o[k])) delete o[k];
      else remover(o[k], profundidade + 1);
    }
  };
  remover(copia);
  // Cartao pendente sem token nao executa mais: reabre como expirado.
  if (copia.tipo === 'proposta' && (copia.estado === 'pendente' || copia.estado === 'executando')) copia.estado = 'expirada';
  const txt = JSON.stringify(copia);
  if (txt.length > LIMITES_CONVERSA.maxBytesItem) return null;
  return copia;
}

function tituloDoPrimeiroUsuario(itens: Array<{ item: Record<string, unknown> }>): string | null {
  const u = itens.find((i) => i.item?.tipo === 'usuario' && typeof i.item.texto === 'string' && String(i.item.texto).trim());
  return u ? tituloAutomatico(String(u.item.texto)) : null;
}

const casa = (texto: string, busca: string) =>
  String(texto || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().includes(busca);
const dobrar = (v: string) => String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

// ---------------------------------------------------------------------------
// Memoria (dev e testes)
// ---------------------------------------------------------------------------
interface ConversaMem {
  ownerUid: string;
  r: ConversaResumo;
  itens: ItemConversa[];
  tituloManual: boolean;
}

export class MemoryAssistenteStore implements AssistenteStore {
  conversas = new Map<string, ConversaMem>();
  memorias = new Map<string, MemoriaAprendida & { ownerUid: string }>();
  regras: RegraAcessorio[] = REGRAS_ACESSORIOS_PADRAO.map((r, i) => ({ ...r, id: `regra-padrao-${i + 1}` }));
  auditoria: Array<EntradaAuditoria & { em: string }> = [];

  private dono(uid: string, id: string): ConversaMem | null {
    const c = this.conversas.get(id);
    return c && c.ownerUid === uid ? c : null;
  }

  async listarConversas(uid: string, opts: { busca?: string; limite?: number } = {}) {
    const b = dobrar(opts.busca || '');
    return [...this.conversas.values()]
      .filter((c) => c.ownerUid === uid)
      .filter((c) => !b || casa(c.r.titulo, b) || c.itens.some((i) => casa(String(i.item.texto || ''), b)))
      .map((c) => ({ ...c.r, mensagens: c.itens.length }))
      .sort((a, z) => z.atualizadaEm.localeCompare(a.atualizadaEm))
      .slice(0, Math.min(200, opts.limite || 100));
  }

  async criarConversa(uid: string, titulo?: string) {
    const agora = agoraIso();
    const r: ConversaResumo = { id: novoId('conv'), titulo: limparTitulo(titulo) || 'Nova conversa', status: 'aberta', criadaEm: agora, atualizadaEm: agora, encerradaEm: null, mensagens: 0 };
    this.conversas.set(r.id, { ownerUid: uid, r, itens: [], tituloManual: !!limparTitulo(titulo) });
    return { ...r };
  }

  async obterConversa(uid: string, id: string) {
    const c = this.dono(uid, id);
    if (!c) return null;
    return { ...c.r, mensagens: c.itens.length, itens: c.itens.map((i) => ({ ...i, item: JSON.parse(JSON.stringify(i.item)) })) };
  }

  async salvarItens(uid: string, id: string, itens: Array<{ id: string; item: Record<string, unknown> }>) {
    const c = this.dono(uid, id);
    if (!c) return null;
    for (const novo of itens) {
      const atual = c.itens.find((i) => i.id === novo.id);
      if (atual) atual.item = novo.item;
      else {
        if (c.itens.length >= LIMITES_CONVERSA.maxItensPorConversa) break;
        c.itens.push({ id: novo.id, seq: c.itens.length + 1, item: novo.item, feedback: null, feedbackMotivo: null });
      }
    }
    if (!c.tituloManual && c.r.titulo === 'Nova conversa') c.r.titulo = tituloDoPrimeiroUsuario(c.itens) || c.r.titulo;
    c.r.atualizadaEm = agoraIso();
    return { ...c.r, mensagens: c.itens.length };
  }

  async atualizarConversa(uid: string, id: string, patch: { titulo?: string; status?: StatusConversa }) {
    const c = this.dono(uid, id);
    if (!c) return null;
    if (patch.titulo !== undefined && limparTitulo(patch.titulo)) {
      c.r.titulo = limparTitulo(patch.titulo);
      c.tituloManual = true;
    }
    if (patch.status) {
      c.r.status = patch.status;
      c.r.encerradaEm = patch.status === 'encerrada' ? agoraIso() : null;
    }
    c.r.atualizadaEm = agoraIso();
    return { ...c.r, mensagens: c.itens.length };
  }

  async apagarConversa(uid: string, id: string) {
    if (!this.dono(uid, id)) return false;
    return this.conversas.delete(id);
  }

  async apagarTodasConversas(uid: string) {
    let n = 0;
    for (const [id, c] of this.conversas) if (c.ownerUid === uid) {
      this.conversas.delete(id);
      n++;
    }
    return n;
  }

  async registrarFeedback(uid: string, conversaId: string, itemId: string, nota: 'positivo' | 'negativo' | null, motivo?: string | null) {
    const c = this.dono(uid, conversaId);
    const it = c?.itens.find((i) => i.id === itemId);
    if (!it) return null;
    it.feedback = nota;
    it.feedbackMotivo = motivo ? String(motivo).slice(0, LIMITES_CONVERSA.maxMotivo) : null;
    return { ...it };
  }

  async listarMemorias(uid: string) {
    return [...this.memorias.values()].filter((m) => m.ownerUid === uid).map(({ ownerUid: _o, ...m }) => ({ ...m })).sort((a, z) => z.atualizadaEm.localeCompare(a.atualizadaEm));
  }

  async criarMemoria(uid: string, m: { tipo: TipoMemoria; texto: string; cnpj?: string | null; dados?: MemoriaAprendida['dados']; origemConversaId?: string | null }) {
    const agora = agoraIso();
    // Mesma licao de novo: atualiza a data em vez de duplicar.
    const igual = [...this.memorias.values()].find((x) => x.ownerUid === uid && dobrar(x.texto) === dobrar(m.texto) && (x.cnpj || null) === (m.cnpj || null));
    if (igual) {
      igual.atualizadaEm = agora;
      igual.ativa = true;
      if (m.dados) igual.dados = m.dados;
      const { ownerUid: _o, ...r } = igual;
      return { ...r };
    }
    const nova = { id: novoId('mem'), tipo: m.tipo, texto: String(m.texto).slice(0, LIMITES_CONVERSA.maxTextoMemoria), cnpj: m.cnpj || null, dados: m.dados || null, origemConversaId: m.origemConversaId || null, ativa: true, criadaEm: agora, atualizadaEm: agora, ownerUid: uid };
    this.memorias.set(nova.id, nova);
    const { ownerUid: _o, ...r } = nova;
    return { ...r };
  }

  async atualizarMemoria(uid: string, id: string, patch: { texto?: string; ativa?: boolean }) {
    const m = this.memorias.get(id);
    if (!m || m.ownerUid !== uid) return null;
    if (patch.texto !== undefined) m.texto = String(patch.texto).slice(0, LIMITES_CONVERSA.maxTextoMemoria);
    if (patch.ativa !== undefined) m.ativa = patch.ativa;
    m.atualizadaEm = agoraIso();
    const { ownerUid: _o, ...r } = m;
    return { ...r };
  }

  async apagarMemoria(uid: string, id: string) {
    const m = this.memorias.get(id);
    if (!m || m.ownerUid !== uid) return false;
    return this.memorias.delete(id);
  }

  async listarRegras() {
    return [...this.regras].sort((a, z) => a.familia.localeCompare(z.familia) || a.ordem - z.ordem);
  }

  async salvarRegra(r: Omit<RegraAcessorio, 'id'> & { id?: string }) {
    const id = r.id || novoId('regra');
    const nova: RegraAcessorio = { ...r, id };
    const idx = this.regras.findIndex((x) => x.id === id);
    if (idx >= 0) this.regras[idx] = nova;
    else this.regras.push(nova);
    return { ...nova };
  }

  async apagarRegra(id: string) {
    const n = this.regras.length;
    this.regras = this.regras.filter((r) => r.id !== id);
    return this.regras.length < n;
  }

  async auditar(e: EntradaAuditoria) {
    this.auditoria.push({ ...e, em: agoraIso() });
  }
}

// ---------------------------------------------------------------------------
// Postgres
// ---------------------------------------------------------------------------
const MIGRATION_LOCK_KEY = 794301120261125;

export const ASSISTENTE_MIGRATIONS: Array<{ id: string; description: string; sql: string }> = [
  {
    id: '2026-11-25-001-conversas-memoria',
    description: 'Conversas, itens, memória aprendida, regras de acessórios e auditoria do assistente',
    sql: `
CREATE TABLE IF NOT EXISTS assistente_conversas (
  id TEXT PRIMARY KEY,
  owner_uid TEXT NOT NULL,
  titulo TEXT NOT NULL DEFAULT 'Nova conversa',
  titulo_manual BOOLEAN NOT NULL DEFAULT FALSE,
  status TEXT NOT NULL DEFAULT 'aberta' CHECK (status IN ('aberta', 'encerrada')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  encerrada_em TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_assistente_conversas_owner ON assistente_conversas (owner_uid, updated_at DESC);

CREATE TABLE IF NOT EXISTS assistente_mensagens (
  conversa_id TEXT NOT NULL REFERENCES assistente_conversas(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  owner_uid TEXT NOT NULL,
  seq INT NOT NULL,
  item JSONB NOT NULL,
  texto_busca TEXT NOT NULL DEFAULT '',
  feedback TEXT CHECK (feedback IN ('positivo', 'negativo')),
  feedback_motivo TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (conversa_id, id)
);
CREATE INDEX IF NOT EXISTS idx_assistente_mensagens_owner ON assistente_mensagens (owner_uid);
CREATE INDEX IF NOT EXISTS idx_assistente_mensagens_seq ON assistente_mensagens (conversa_id, seq);

CREATE TABLE IF NOT EXISTS assistente_memorias (
  id TEXT PRIMARY KEY,
  owner_uid TEXT NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('preferencia', 'correcao', 'feedback', 'sugestao')),
  texto TEXT NOT NULL,
  cnpj TEXT CHECK (cnpj IS NULL OR cnpj ~ '^[0-9]{14}$'),
  dados JSONB,
  origem_conversa_id TEXT,
  ativa BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_assistente_memorias_owner ON assistente_memorias (owner_uid, updated_at DESC);

CREATE TABLE IF NOT EXISTS assistente_regras_acessorios (
  id TEXT PRIMARY KEY,
  familia TEXT NOT NULL,
  categoria TEXT NOT NULL CHECK (categoria IN ('fonte', 'optico', 'uplink', 'acessorio')),
  padrao TEXT NOT NULL,
  excluir TEXT,
  observacao TEXT NOT NULL DEFAULT '',
  ativa BOOLEAN NOT NULL DEFAULT TRUE,
  ordem INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS assistente_auditoria (
  id BIGSERIAL PRIMARY KEY,
  owner_uid TEXT NOT NULL,
  acao TEXT NOT NULL,
  alvo TEXT NOT NULL DEFAULT '',
  detalhe TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_assistente_auditoria_owner ON assistente_auditoria (owner_uid, created_at DESC);
`,
  },
];

/** SQL do seed das regras padrao (so quando a tabela esta vazia). */
export function seedRegrasSql(): { sql: string; params: unknown[] } {
  const values: string[] = [];
  const params: unknown[] = [];
  REGRAS_ACESSORIOS_PADRAO.forEach((r, i) => {
    const b = i * 8;
    values.push(`($${b + 1}::text, $${b + 2}::text, $${b + 3}::text, $${b + 4}::text, $${b + 5}::text, $${b + 6}::text, $${b + 7}::boolean, $${b + 8}::int)`);
    params.push(`regra-padrao-${i + 1}`, r.familia, r.categoria, r.padrao, r.excluir, r.observacao, r.ativa, r.ordem);
  });
  return {
    sql: `INSERT INTO assistente_regras_acessorios (id, familia, categoria, padrao, excluir, observacao, ativa, ordem)
SELECT * FROM (VALUES ${values.join(', ')}) AS v(id, familia, categoria, padrao, excluir, observacao, ativa, ordem)
WHERE NOT EXISTS (SELECT 1 FROM assistente_regras_acessorios)`,
    params,
  };
}

export async function applyAssistenteMigrations(pool: PgPoolLike): Promise<string[]> {
  const client = await pool.connect();
  const applied: string[] = [];
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [MIGRATION_LOCK_KEY]);
    await client.query(`CREATE TABLE IF NOT EXISTS assistente_schema_migrations (
      id TEXT PRIMARY KEY, description TEXT, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
    const done = await client.query('SELECT id FROM assistente_schema_migrations');
    const ids = new Set(done.rows.map((r: { id: string }) => r.id));
    for (const m of ASSISTENTE_MIGRATIONS) {
      if (ids.has(m.id)) continue;
      await client.query(m.sql);
      await client.query('INSERT INTO assistente_schema_migrations (id, description) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING', [m.id, m.description]);
      applied.push(m.id);
    }
    const seed = seedRegrasSql();
    await client.query(seed.sql, seed.params);
    await client.query('COMMIT');
    return applied;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // conexao perdida
    }
    throw err;
  } finally {
    client.release();
  }
}

let schemaPronto: Promise<string[]> | null = null;
export async function ensureAssistenteSchema(pool: PgPoolLike): Promise<void> {
  if (!schemaPronto) {
    schemaPronto = applyAssistenteMigrations(pool).catch((e) => {
      schemaPronto = null;
      throw e;
    });
  }
  await schemaPronto;
}

const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : v ? new Date(String(v)).toISOString() : null);

function rowConversa(r: any): ConversaResumo {
  return {
    id: r.id,
    titulo: r.titulo,
    status: r.status,
    criadaEm: iso(r.created_at)!,
    atualizadaEm: iso(r.updated_at)!,
    encerradaEm: iso(r.encerrada_em),
    mensagens: Number(r.mensagens || 0),
  };
}

function rowMemoria(r: any): MemoriaAprendida {
  return {
    id: r.id,
    tipo: r.tipo,
    texto: r.texto,
    cnpj: r.cnpj || null,
    dados: r.dados || null,
    origemConversaId: r.origem_conversa_id || null,
    ativa: r.ativa !== false,
    criadaEm: iso(r.created_at)!,
    atualizadaEm: iso(r.updated_at)!,
  };
}

function rowRegra(r: any): RegraAcessorio {
  return { id: r.id, familia: r.familia, categoria: r.categoria, padrao: r.padrao, excluir: r.excluir || null, observacao: r.observacao || '', ativa: r.ativa !== false, ordem: Number(r.ordem || 0) };
}

const textoBusca = (item: Record<string, unknown>) =>
  [item.texto, (item as any).resultado?.mensagem, (item as any).proposta?.titulo].filter((v) => typeof v === 'string').join(' ').slice(0, 4000);

const SELECT_CONVERSA = `SELECT c.id, c.titulo, c.status, c.created_at, c.updated_at, c.encerrada_em,
  (SELECT COUNT(*) FROM assistente_mensagens m WHERE m.conversa_id = c.id) AS mensagens
  FROM assistente_conversas c`;

export class PostgresAssistenteStore implements AssistenteStore {
  constructor(private readonly pool: PgPoolLike) {}

  private async db(): Promise<PgQueryable> {
    await ensureAssistenteSchema(this.pool);
    return this.pool;
  }

  async listarConversas(uid: string, opts: { busca?: string; limite?: number } = {}) {
    const db = await this.db();
    const limite = Math.max(1, Math.min(200, opts.limite || 100));
    const busca = String(opts.busca || '').trim().slice(0, 100);
    if (busca) {
      const r = await db.query(
        `${SELECT_CONVERSA} WHERE c.owner_uid = $1 AND (c.titulo ILIKE $2 OR EXISTS (
           SELECT 1 FROM assistente_mensagens m WHERE m.conversa_id = c.id AND m.owner_uid = $1 AND m.texto_busca ILIKE $2))
         ORDER BY c.updated_at DESC LIMIT $3`,
        [uid, `%${busca.replace(/[\\%_]/g, (s) => `\\${s}`)}%`, limite],
      );
      return r.rows.map(rowConversa);
    }
    const r = await db.query(`${SELECT_CONVERSA} WHERE c.owner_uid = $1 ORDER BY c.updated_at DESC LIMIT $2`, [uid, limite]);
    return r.rows.map(rowConversa);
  }

  async criarConversa(uid: string, titulo?: string) {
    const db = await this.db();
    const t = limparTitulo(titulo);
    const r = await db.query(
      `INSERT INTO assistente_conversas (id, owner_uid, titulo, titulo_manual) VALUES ($1, $2, $3, $4)
       RETURNING id, titulo, status, created_at, updated_at, encerrada_em, 0 AS mensagens`,
      [novoId('conv'), uid, t || 'Nova conversa', !!t],
    );
    // Teto por usuario: apaga as mais antigas alem do limite (so do proprio usuario).
    await db.query(
      `DELETE FROM assistente_conversas WHERE owner_uid = $1 AND id IN (
         SELECT id FROM assistente_conversas WHERE owner_uid = $1 ORDER BY updated_at DESC OFFSET $2)`,
      [uid, LIMITES_CONVERSA.maxConversasPorUsuario],
    );
    return rowConversa(r.rows[0]);
  }

  async obterConversa(uid: string, id: string) {
    const db = await this.db();
    const c = await db.query(`${SELECT_CONVERSA} WHERE c.id = $1 AND c.owner_uid = $2`, [id, uid]);
    if (!c.rows[0]) return null;
    const m = await db.query(
      `SELECT id, seq, item, feedback, feedback_motivo FROM assistente_mensagens WHERE conversa_id = $1 AND owner_uid = $2 ORDER BY seq ASC`,
      [id, uid],
    );
    return {
      ...rowConversa(c.rows[0]),
      itens: m.rows.map((r: any) => ({ id: r.id, seq: Number(r.seq), item: r.item, feedback: r.feedback || null, feedbackMotivo: r.feedback_motivo || null })),
    };
  }

  async salvarItens(uid: string, id: string, itens: Array<{ id: string; item: Record<string, unknown> }>) {
    const db = await this.db();
    const own = await db.query(`SELECT titulo, titulo_manual FROM assistente_conversas WHERE id = $1 AND owner_uid = $2`, [id, uid]);
    const conv = own.rows[0];
    if (!conv) return null;
    const cnt = await db.query(`SELECT COALESCE(MAX(seq), 0) AS s, COUNT(*) AS n FROM assistente_mensagens WHERE conversa_id = $1`, [id]);
    let seq = Number(cnt.rows[0]?.s || 0);
    let n = Number(cnt.rows[0]?.n || 0);
    for (const it of itens) {
      const existe = await db.query(`UPDATE assistente_mensagens SET item = $3, texto_busca = $4, updated_at = NOW() WHERE conversa_id = $1 AND id = $2 AND owner_uid = $5`, [id, it.id, JSON.stringify(it.item), textoBusca(it.item), uid]);
      if (existe.rowCount) continue;
      if (n >= LIMITES_CONVERSA.maxItensPorConversa) break;
      seq += 1;
      n += 1;
      await db.query(
        `INSERT INTO assistente_mensagens (conversa_id, id, owner_uid, seq, item, texto_busca) VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (conversa_id, id) DO NOTHING`,
        [id, it.id, uid, seq, JSON.stringify(it.item), textoBusca(it.item)],
      );
    }
    const titulo = !conv.titulo_manual && conv.titulo === 'Nova conversa' ? tituloDoPrimeiroUsuario(itens) : null;
    const r = await db.query(
      `UPDATE assistente_conversas SET updated_at = NOW()${titulo ? ', titulo = $3' : ''} WHERE id = $1 AND owner_uid = $2
       RETURNING id, titulo, status, created_at, updated_at, encerrada_em, (SELECT COUNT(*) FROM assistente_mensagens m WHERE m.conversa_id = $1) AS mensagens`,
      titulo ? [id, uid, titulo] : [id, uid],
    );
    return r.rows[0] ? rowConversa(r.rows[0]) : null;
  }

  async atualizarConversa(uid: string, id: string, patch: { titulo?: string; status?: StatusConversa }) {
    const db = await this.db();
    const sets: string[] = ['updated_at = NOW()'];
    const params: unknown[] = [id, uid];
    const t = patch.titulo !== undefined ? limparTitulo(patch.titulo) : '';
    if (t) {
      params.push(t);
      sets.push(`titulo = $${params.length}`, 'titulo_manual = TRUE');
    }
    if (patch.status) {
      params.push(patch.status);
      sets.push(`status = $${params.length}`, `encerrada_em = ${patch.status === 'encerrada' ? 'NOW()' : 'NULL'}`);
    }
    const r = await db.query(
      `UPDATE assistente_conversas SET ${sets.join(', ')} WHERE id = $1 AND owner_uid = $2
       RETURNING id, titulo, status, created_at, updated_at, encerrada_em, (SELECT COUNT(*) FROM assistente_mensagens m WHERE m.conversa_id = $1) AS mensagens`,
      params,
    );
    return r.rows[0] ? rowConversa(r.rows[0]) : null;
  }

  async apagarConversa(uid: string, id: string) {
    const db = await this.db();
    const r = await db.query(`DELETE FROM assistente_conversas WHERE id = $1 AND owner_uid = $2`, [id, uid]);
    return Number(r.rowCount || 0) > 0;
  }

  async apagarTodasConversas(uid: string) {
    const db = await this.db();
    const r = await db.query(`DELETE FROM assistente_conversas WHERE owner_uid = $1`, [uid]);
    return Number(r.rowCount || 0);
  }

  async registrarFeedback(uid: string, conversaId: string, itemId: string, nota: 'positivo' | 'negativo' | null, motivo?: string | null) {
    const db = await this.db();
    const r = await db.query(
      `UPDATE assistente_mensagens SET feedback = $4, feedback_motivo = $5, updated_at = NOW()
       WHERE conversa_id = $1 AND id = $2 AND owner_uid = $3 RETURNING id, seq, item, feedback, feedback_motivo`,
      [conversaId, itemId, uid, nota, motivo ? String(motivo).slice(0, LIMITES_CONVERSA.maxMotivo) : null],
    );
    const x = r.rows[0];
    return x ? { id: x.id, seq: Number(x.seq), item: x.item, feedback: x.feedback || null, feedbackMotivo: x.feedback_motivo || null } : null;
  }

  async listarMemorias(uid: string) {
    const db = await this.db();
    const r = await db.query(
      `SELECT * FROM assistente_memorias WHERE owner_uid = $1 ORDER BY updated_at DESC LIMIT $2`,
      [uid, LIMITES_CONVERSA.maxMemoriasPorUsuario],
    );
    return r.rows.map(rowMemoria);
  }

  async criarMemoria(uid: string, m: { tipo: TipoMemoria; texto: string; cnpj?: string | null; dados?: MemoriaAprendida['dados']; origemConversaId?: string | null }) {
    const db = await this.db();
    const texto = String(m.texto).slice(0, LIMITES_CONVERSA.maxTextoMemoria);
    const igual = await db.query(
      `UPDATE assistente_memorias SET updated_at = NOW(), ativa = TRUE, dados = COALESCE($4::jsonb, dados)
       WHERE owner_uid = $1 AND lower(texto) = lower($2) AND cnpj IS NOT DISTINCT FROM $3 RETURNING *`,
      [uid, texto, m.cnpj || null, m.dados ? JSON.stringify(m.dados) : null],
    );
    if (igual.rows[0]) return rowMemoria(igual.rows[0]);
    const r = await db.query(
      `INSERT INTO assistente_memorias (id, owner_uid, tipo, texto, cnpj, dados, origem_conversa_id) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [novoId('mem'), uid, m.tipo, texto, m.cnpj || null, m.dados ? JSON.stringify(m.dados) : null, m.origemConversaId || null],
    );
    await db.query(
      `DELETE FROM assistente_memorias WHERE owner_uid = $1 AND id IN (
         SELECT id FROM assistente_memorias WHERE owner_uid = $1 ORDER BY updated_at DESC OFFSET $2)`,
      [uid, LIMITES_CONVERSA.maxMemoriasPorUsuario],
    );
    return rowMemoria(r.rows[0]);
  }

  async atualizarMemoria(uid: string, id: string, patch: { texto?: string; ativa?: boolean }) {
    const db = await this.db();
    const sets = ['updated_at = NOW()'];
    const params: unknown[] = [id, uid];
    if (patch.texto !== undefined) {
      params.push(String(patch.texto).slice(0, LIMITES_CONVERSA.maxTextoMemoria));
      sets.push(`texto = $${params.length}`);
    }
    if (patch.ativa !== undefined) {
      params.push(patch.ativa);
      sets.push(`ativa = $${params.length}`);
    }
    const r = await db.query(`UPDATE assistente_memorias SET ${sets.join(', ')} WHERE id = $1 AND owner_uid = $2 RETURNING *`, params);
    return r.rows[0] ? rowMemoria(r.rows[0]) : null;
  }

  async apagarMemoria(uid: string, id: string) {
    const db = await this.db();
    const r = await db.query(`DELETE FROM assistente_memorias WHERE id = $1 AND owner_uid = $2`, [id, uid]);
    return Number(r.rowCount || 0) > 0;
  }

  async listarRegras() {
    const db = await this.db();
    const r = await db.query(`SELECT * FROM assistente_regras_acessorios ORDER BY familia ASC, ordem ASC, id ASC`);
    return r.rows.map(rowRegra);
  }

  async salvarRegra(x: Omit<RegraAcessorio, 'id'> & { id?: string }) {
    const db = await this.db();
    const id = x.id || novoId('regra');
    const r = await db.query(
      `INSERT INTO assistente_regras_acessorios (id, familia, categoria, padrao, excluir, observacao, ativa, ordem)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (id) DO UPDATE SET familia = EXCLUDED.familia, categoria = EXCLUDED.categoria, padrao = EXCLUDED.padrao,
         excluir = EXCLUDED.excluir, observacao = EXCLUDED.observacao, ativa = EXCLUDED.ativa, ordem = EXCLUDED.ordem, updated_at = NOW()
       RETURNING *`,
      [id, x.familia, x.categoria, x.padrao, x.excluir, x.observacao, x.ativa, x.ordem],
    );
    return rowRegra(r.rows[0]);
  }

  async apagarRegra(id: string) {
    const db = await this.db();
    const r = await db.query(`DELETE FROM assistente_regras_acessorios WHERE id = $1`, [id]);
    return Number(r.rowCount || 0) > 0;
  }

  async auditar(e: EntradaAuditoria) {
    const db = await this.db();
    await db.query(`INSERT INTO assistente_auditoria (owner_uid, acao, alvo, detalhe) VALUES ($1, $2, $3, $4)`, [
      e.ownerUid,
      e.acao.slice(0, 80),
      e.alvo.slice(0, 200),
      e.detalhe.slice(0, 1000),
    ]);
  }
}

let padrao: AssistenteStore | null = null;
/** Store do processo: Postgres quando ha DATABASE_URL; memoria em dev/testes. */
export function getAssistenteStore(): AssistenteStore {
  if (!padrao) {
    const pool = isPostgresEnabled() ? getPostgresPool() : null;
    padrao = pool ? new PostgresAssistenteStore(pool as unknown as PgPoolLike) : new MemoryAssistenteStore();
  }
  return padrao;
}
