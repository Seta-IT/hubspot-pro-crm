// ============================================================================
// STI-hub — Sincronizacao do estado com o PostgreSQL (Neon Free, 01/11/2026)
// ----------------------------------------------------------------------------
// Antes: TODA requisicao lia o snapshot inteiro (crm_kv_store.payload, ~0,7-0,9 MB) e toda
// escrita regravava o snapshot + 10 tabelas-espelho (o ultimo a gravar vencia).
// Agora:
//  - cada instancia guarda o ultimo snapshot "limpo" (igual ao do banco) e a versao dele;
//  - a cada requisicao le SO a versao (alguns bytes). Igual => restaura o snapshot limpo em
//    memoria (mesma semantica de antes: toda requisicao comeca do estado persistido);
//    diferente => le o snapshot inteiro uma vez;
//  - a escrita e um UPDATE condicional (WHERE version = base). Em conflito (outra instancia
//    gravou antes), rele o banco e faz merge em 3 vias (base x minha x deles) por id, sem
//    perder a alteracao de ninguem; repete ate 3 vezes;
//  - producao/preview falham fechado (PersistenceUnavailableError => 503).
// ============================================================================
import { CrmDatabaseState } from './types';
import {
  PersistenceUnavailableError,
  isPersistenceFailClosed,
  loadStateFromPostgres,
  readSegmentHashes,
  readSegments,
  readStateVersion,
  readStateWithVersion,
  SegmentHashes,
  writeStateIfVersion,
} from './postgres';

/** Repositorio minimo usado aqui (CrmRepository satisfaz). */
export interface StateHolder {
  getState(): CrmDatabaseState;
  loadState(state: CrmDatabaseState): void;
}

// ---------------------------------------------------------------------------
// Ordem de chaves igual a do JSONB (comprimento, depois bytes), para que o snapshot limpo
// mantido em memoria seja identico ao que uma releitura do banco devolveria.
// ---------------------------------------------------------------------------
function jsonbKeyCompare(a: string, b: string): number {
  const ba = Buffer.byteLength(a, 'utf8');
  const bb = Buffer.byteLength(b, 'utf8');
  if (ba !== bb) return ba - bb;
  return Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
}

/** JSON.parse(JSON.stringify(v)) com as chaves na ordem do JSONB. */
export function jsonbRoundTrip<T>(value: T): T {
  return jsonbFromJson<T>(JSON.stringify(value));
}

/** JSON.parse(json) com as chaves na ordem do JSONB. */
export function jsonbFromJson<T>(json: string): T {
  const plain = JSON.parse(json);
  const reorder = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(reorder);
    if (v && typeof v === 'object') {
      const src = v as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(src).sort(jsonbKeyCompare)) out[k] = reorder(src[k]);
      return out;
    }
    return v;
  };
  return reorder(plain) as T;
}

// ---------------------------------------------------------------------------
// Merge em 3 vias
// ---------------------------------------------------------------------------
function stableStringify(v: unknown): string {
  if (v === undefined) return 'undefined';
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map((x) => (x === undefined ? 'null' : stableStringify(x))).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`)
    .join(',')}}`;
}
const same = (a: unknown, b: unknown) => stableStringify(a) === stableStringify(b);
const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

function idOf(v: unknown): string | null {
  if (!isPlainObject(v)) return null;
  const id = v.id;
  return typeof id === 'string' || typeof id === 'number' ? String(id) : null;
}
function isIdArray(a: unknown): a is Array<Record<string, unknown>> {
  if (!Array.isArray(a)) return false;
  const seen = new Set<string>();
  for (const el of a) {
    const id = idOf(el);
    if (id === null || seen.has(id)) return false;
    seen.add(id);
  }
  return true;
}

/**
 * base = estado de onde a minha requisicao partiu; mine = como ela deixou; theirs = o que outra
 * instancia gravou nesse meio-tempo. Regras: o que so um lado mudou, prevalece; listas de
 * objetos com `id` sao combinadas item a item (inclusoes dos dois lados ficam); quando os dois
 * mudaram a MESMA folha, vale a minha (a escrita mais recente), como antes, mas so naquela folha.
 */
export function mergeThreeWay(base: unknown, mine: unknown, theirs: unknown): unknown {
  if (same(mine, base)) return theirs;
  if (same(theirs, base)) return mine;
  if (isPlainObject(base) && isPlainObject(mine) && isPlainObject(theirs)) {
    const out: Record<string, unknown> = {};
    const keys = new Set([...Object.keys(theirs), ...Object.keys(mine), ...Object.keys(base)]);
    for (const k of keys) {
      const merged = mergeThreeWay(base[k], mine[k], theirs[k]);
      if (merged !== undefined) out[k] = merged;
    }
    return out;
  }
  if (isIdArray(mine) && isIdArray(theirs) && (base === undefined || isIdArray(base))) {
    const b = new Map((base as Array<Record<string, unknown>> | undefined || []).map((x) => [idOf(x)!, x]));
    const m = new Map(mine.map((x) => [idOf(x)!, x]));
    const t = new Map(theirs.map((x) => [idOf(x)!, x]));
    const result: unknown[] = [];
    for (const el of theirs) {
      const id = idOf(el)!;
      if (b.has(id) && !m.has(id)) continue; // eu apaguei
      if (m.has(id)) {
        const merged = mergeThreeWay(b.get(id), m.get(id), el);
        if (merged !== undefined) result.push(merged);
      } else {
        result.push(el); // incluido por eles
      }
    }
    // Itens que eles apagaram mas eu alterei: ficam (a minha alteracao nao some).
    for (const el of mine) {
      const id = idOf(el)!;
      if (b.has(id) && !t.has(id) && !same(el, b.get(id))) result.push(el);
    }
    // Minhas inclusoes: no inicio se eu as pus antes do primeiro item antigo (ex.: unshift), senao no fim.
    const added = mine.filter((el) => !b.has(idOf(el)!) && !t.has(idOf(el)!));
    if (added.length) {
      const firstOld = mine.findIndex((el) => b.has(idOf(el)!));
      const atFront = firstOld === -1 ? false : mine.indexOf(added[0]) < firstOld;
      return atFront ? [...added, ...result] : [...result, ...added];
    }
    return result;
  }
  return mine;
}

// ---------------------------------------------------------------------------
// Sincronizador por instancia
// ---------------------------------------------------------------------------
export interface PgStateSyncStats {
  versionChecks: number;
  fullLoads: number;
  partialLoads: number;
  segmentsReloaded: number;
  restoresFromMemory: number;
  writes: number;
  conflicts: number;
  merges: number;
}

export class PgStateSync {
  private baseState: CrmDatabaseState | null = null;
  private baseVersion: number | null = null;
  private baseHashes: SegmentHashes | null = null;
  private lastCheckMs = 0;
  readonly stats: PgStateSyncStats = { versionChecks: 0, fullLoads: 0, partialLoads: 0, segmentsReloaded: 0, restoresFromMemory: 0, writes: 0, conflicts: 0, merges: 0 };

  /** Debounce da checagem de versao (ms). Padrao 0 = checa sempre (ler-o-que-gravou entre instancias). */
  private debounceMs(): number {
    const n = Number(process.env.STI_HUB_PG_VERSION_DEBOUNCE_MS || 0);
    return Number.isFinite(n) && n > 0 ? Math.min(n, 2000) : 0;
  }

  /**
   * Inicio de cada requisicao: deixa o repositorio igual ao estado persistido.
   * forceCheck: auth/IAM e toda escrita ignoram o debounce.
   */
  async beginRequest(repo: StateHolder, opts: { forceCheck?: boolean } = {}): Promise<void> {
    const now = Date.now();
    if (this.baseState && this.baseVersion !== null) {
      const debounce = this.debounceMs();
      if (!opts.forceCheck && debounce > 0 && now - this.lastCheckMs < debounce) {
        this.restore(repo);
        return;
      }
      this.stats.versionChecks++;
      const v = await readStateVersion();
      this.lastCheckMs = now;
      if (v === this.baseVersion) {
        this.restore(repo);
        return;
      }
      if (v === null) {
        throw new PersistenceUnavailableError('PG_STATE_MISSING', 'Estado do STI-hub sumiu do PostgreSQL.');
      }
      if (await this.partialLoad(repo)) {
        this.lastCheckMs = now;
        return;
      }
    }
    await this.fullLoad(repo);
    this.lastCheckMs = now;
  }

  private restore(repo: StateHolder): void {
    this.stats.restoresFromMemory++;
    repo.loadState(this.baseState!); // loadState clona: o snapshot limpo continua intacto
  }

  /**
   * Outra instancia gravou: rele so os segmentos cujo hash mudou. false => o chamador faz a
   * leitura inteira (sem hashes de base, versao mudou no meio, ou mais da metade mudou).
   */
  private async partialLoad(repo: StateHolder): Promise<boolean> {
    if (!this.baseState || !this.baseHashes) return false;
    const cur = await readSegmentHashes();
    if (!cur) return false;
    const changed = Object.keys(cur.hashes).filter((k) => this.baseHashes![k] !== cur.hashes[k]);
    const removed = Object.keys(this.baseHashes).filter((k) => !(k in cur.hashes));
    if (changed.length > Object.keys(cur.hashes).length / 2) return false;
    const values = changed.length ? await readSegments(changed, cur.version) : {};
    if (!values) return false;
    const next = this.baseState as unknown as Record<string, unknown>;
    const apply = (seg: string, value: unknown, del: boolean) => {
      const dot = seg.indexOf('.');
      if (dot === -1) {
        if (del) delete next[seg];
        else next[seg] = value;
        return;
      }
      const top = seg.slice(0, dot);
      const sub = seg.slice(dot + 1);
      if (!isPlainObject(next[top])) {
        if (del) return;
        next[top] = {};
      }
      const obj = next[top] as Record<string, unknown>;
      if (del) delete obj[sub];
      else obj[sub] = value;
    };
    // 1o nivel antes do 2o (ex.: "erp" deixou de ser objeto ou voltou a ser).
    const order = (a: string, b: string) => Number(a.includes('.')) - Number(b.includes('.'));
    for (const seg of [...removed].sort(order)) apply(seg, undefined, true);
    for (const seg of [...changed].sort(order)) apply(seg, values[seg] ?? null, false);
    this.baseState = jsonbFromJson<CrmDatabaseState>(JSON.stringify(next));
    this.baseVersion = cur.version;
    this.baseHashes = cur.hashes;
    this.stats.partialLoads++;
    this.stats.segmentsReloaded += changed.length;
    repo.loadState(this.baseState);
    return true;
  }

  private async fullLoad(repo: StateHolder): Promise<void> {
    this.stats.fullLoads++;
    const row = await readStateWithVersion();
    if (row) {
      this.baseState = row.state;
      this.baseVersion = row.version;
      this.baseHashes = row.hashes;
      repo.loadState(row.state);
      return;
    }
    // Banco vazio: so fora de producao/preview (loadStateFromPostgres lanca em producao).
    const seeded = await loadStateFromPostgres();
    if (!seeded) throw new PersistenceUnavailableError('PG_READ_FAILED', 'PostgreSQL indisponivel.');
    const again = await readStateWithVersion();
    if (!again) throw new PersistenceUnavailableError('PG_STATE_MISSING', 'Estado do STI-hub ausente no PostgreSQL.');
    this.baseState = again.state;
    this.baseVersion = again.version;
    this.baseHashes = again.hashes;
    repo.loadState(again.state);
  }

  /** Persiste o estado atual do repositorio (escrita bem-sucedida). Lanca em falha. */
  async commit(repo: StateHolder): Promise<void> {
    let mine = repo.getState();
    for (let attempt = 0; attempt < 4; attempt++) {
      const json = JSON.stringify(mine);
      const written = await writeStateIfVersion(json, this.baseVersion, mine);
      if (written !== null) {
        this.stats.writes++;
        this.baseState = jsonbFromJson<CrmDatabaseState>(json);
        this.baseVersion = written.version;
        this.baseHashes = written.hashes;
        return;
      }
      // Conflito: outra instancia gravou depois da minha leitura.
      this.stats.conflicts++;
      const fresh = await readStateWithVersion();
      if (!fresh) throw new PersistenceUnavailableError('PG_STATE_MISSING', 'Estado do STI-hub ausente no PostgreSQL.');
      const base = this.baseState ? jsonbRoundTrip(this.baseState) : undefined;
      const merged = mergeThreeWay(base, jsonbRoundTrip(mine), fresh.state) as CrmDatabaseState;
      this.stats.merges++;
      this.baseState = fresh.state;
      this.baseVersion = fresh.version;
      this.baseHashes = fresh.hashes;
      repo.loadState(merged);
      mine = repo.getState();
    }
    throw new PersistenceUnavailableError('PG_WRITE_CONFLICT', 'Conflito de gravacao persistente no PostgreSQL.');
  }

  /** Descarta o cache (proxima requisicao rele tudo). */
  invalidate(): void {
    this.baseState = null;
    this.baseVersion = null;
    this.baseHashes = null;
  }

  static failClosed(): boolean {
    return isPersistenceFailClosed();
  }
}
