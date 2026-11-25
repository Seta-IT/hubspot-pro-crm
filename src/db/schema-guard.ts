// ============================================================================
// STI-hub — DDL idempotente FORA do caminho de bloqueio (perf 25/11/2026).
//
// Incidente 25/11 17:40 BRT: depois de cada deploy, a 1a requisicao de toda instancia nova rodava
// o DDL "IF NOT EXISTS" inteiro. CREATE INDEX IF NOT EXISTS pega SHARE lock na tabela ANTES de ver
// que o indice existe; ALTER TABLE ... ADD COLUMN IF NOT EXISTS pega ACCESS EXCLUSIVE. Com uma
// transacao aberta em erp_proposals, login/sessao/bootstrap esperaram ate 300 s (504).
//
// Agora:
//  1. o DDL e quebrado em comandos; CREATE TABLE/INDEX IF NOT EXISTS e ALTER TABLE ... ADD COLUMN
//     IF NOT EXISTS sao conferidos no catalogo (to_regclass / pg_attribute) em UMA consulta de
//     leitura, sem lock de tabela;
//  2. so o que falta (mais os comandos que nao sao conferiveis, ex.: blocos DO com checagem
//     propria) e executado, numa transacao implicita com lock_timeout (padrao 2 s) e
//     statement_timeout locais: nunca fica na fila de lock;
//  3. o chamador decide: o caminho quente (ensurePostgresSchema) so loga a falha e segue.
// ============================================================================

export interface DdlQueryable {
  query: (text: string, params?: unknown[]) => Promise<{ rows: any[] }>;
}

export type DdlCheck =
  | { kind: 'relation'; name: string }
  | { kind: 'columns'; table: string; columns: string[] }
  | { kind: 'other' };

export interface DdlStatement {
  sql: string;
  check: DdlCheck;
}

export interface GuardedDdlResult {
  /** Comandos considerados (apos dividir o texto). */
  total: number;
  /** Comandos efetivamente executados (0 = esquema ja completo, nenhum lock pedido). */
  executed: number;
  /** Nomes (relacoes/colunas) que faltavam no catalogo. */
  missing: string[];
}

export const DEFAULT_DDL_LOCK_TIMEOUT_MS = 2000;
export const DEFAULT_DDL_STATEMENT_TIMEOUT_MS = 30000;

/** Divide um texto SQL em comandos (respeita aspas, $tag$...$tag$, comentarios e parenteses). */
export function splitSqlStatements(sql: string): string[] {
  const out: string[] = [];
  let cur = '';
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const ch = sql[i];
    const next = sql[i + 1];
    if (ch === '-' && next === '-') {
      const end = sql.indexOf('\n', i);
      const stop = end === -1 ? n : end;
      cur += sql.slice(i, stop);
      i = stop;
      continue;
    }
    if (ch === '/' && next === '*') {
      const end = sql.indexOf('*/', i + 2);
      const stop = end === -1 ? n : end + 2;
      cur += sql.slice(i, stop);
      i = stop;
      continue;
    }
    if (ch === "'" || ch === '"') {
      let j = i + 1;
      while (j < n) {
        if (sql[j] === ch) {
          if (sql[j + 1] === ch) {
            j += 2;
            continue;
          }
          break;
        }
        j++;
      }
      cur += sql.slice(i, Math.min(n, j + 1));
      i = j + 1;
      continue;
    }
    if (ch === '$') {
      const m = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i));
      if (m) {
        const tag = m[0];
        const end = sql.indexOf(tag, i + tag.length);
        const stop = end === -1 ? n : end + tag.length;
        cur += sql.slice(i, stop);
        i = stop;
        continue;
      }
    }
    if (ch === ';') {
      if (cur.trim()) out.push(cur.trim());
      cur = '';
      i++;
      continue;
    }
    cur += ch;
    i++;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

function stripLeadingComments(s: string): string {
  let t = s.trim();
  for (;;) {
    if (t.startsWith('--')) {
      const nl = t.indexOf('\n');
      t = nl === -1 ? '' : t.slice(nl + 1).trim();
      continue;
    }
    if (t.startsWith('/*')) {
      const end = t.indexOf('*/');
      t = end === -1 ? '' : t.slice(end + 2).trim();
      continue;
    }
    return t;
  }
}

const IDENT = '((?:"[^"]+"|[A-Za-z_][A-Za-z0-9_$]*)(?:\\.(?:"[^"]+"|[A-Za-z_][A-Za-z0-9_$]*))?)';

function normIdent(raw: string): string {
  // Mantem a forma aceita por to_regclass ("Nome" com aspas preservado; sem aspas => minusculas).
  return raw
    .split('.')
    .map((p) => (p.startsWith('"') ? p : p.toLowerCase()))
    .join('.');
}

function normColumn(raw: string): string {
  return raw.startsWith('"') ? raw.slice(1, -1) : raw.toLowerCase();
}

/** Divide por virgulas de nivel superior (fora de parenteses/aspas). */
function splitTopLevelCommas(s: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let cur = '';
  let q: string | null = null;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) {
      cur += ch;
      if (ch === q) q = null;
      continue;
    }
    if (ch === "'" || ch === '"') {
      q = ch;
      cur += ch;
      continue;
    }
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      parts.push(cur.trim());
      cur = '';
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}

/** Classifica um comando: so os 3 formatos idempotentes conhecidos sao conferidos no catalogo. */
export function classifyDdl(statement: string): DdlCheck {
  const s = stripLeadingComments(statement);
  let m = new RegExp(`^CREATE\\s+(?:UNLOGGED\\s+)?TABLE\\s+IF\\s+NOT\\s+EXISTS\\s+${IDENT}`, 'i').exec(s);
  if (m) return { kind: 'relation', name: normIdent(m[1]) };
  m = new RegExp(`^CREATE\\s+(?:UNIQUE\\s+)?INDEX\\s+IF\\s+NOT\\s+EXISTS\\s+${IDENT}\\s+ON\\s+`, 'i').exec(s);
  if (m) return { kind: 'relation', name: normIdent(m[1]) };
  m = new RegExp(`^ALTER\\s+TABLE\\s+(?:IF\\s+EXISTS\\s+)?(?:ONLY\\s+)?${IDENT}\\s+([\\s\\S]+)$`, 'i').exec(s);
  if (m) {
    const clauses = splitTopLevelCommas(m[2]);
    const cols: string[] = [];
    for (const c of clauses) {
      const cm = /^ADD\s+(?:COLUMN\s+)?IF\s+NOT\s+EXISTS\s+("[^"]+"|[A-Za-z_][A-Za-z0-9_$]*)\s+/i.exec(c + ' ');
      if (!cm) return { kind: 'other' };
      cols.push(normColumn(cm[1]));
    }
    if (cols.length) return { kind: 'columns', table: normIdent(m[1]), columns: cols };
  }
  return { kind: 'other' };
}

export function planDdl(sql: string): DdlStatement[] {
  return splitSqlStatements(sql).map((stmt) => ({ sql: stmt, check: classifyDdl(stmt) }));
}

const CATALOG_SQL = `
SELECT 'r:' || r.name AS missing
  FROM unnest($1::text[]) AS r(name)
 WHERE to_regclass(r.name) IS NULL
UNION ALL
SELECT 'c:' || c.tbl || '.' || c.col
  FROM unnest($2::text[], $3::text[]) AS c(tbl, col)
 WHERE NOT EXISTS (
   SELECT 1 FROM pg_attribute a
    WHERE a.attrelid = to_regclass(c.tbl) AND a.attname = c.col AND a.attnum > 0 AND NOT a.attisdropped
 )`;

/** Quais comandos precisam rodar (pela leitura do catalogo; nenhuma trava de tabela). */
export async function pendingDdl(db: DdlQueryable, plan: DdlStatement[]): Promise<{ pending: DdlStatement[]; missing: string[] }> {
  const rels = new Set<string>();
  const colTables: string[] = [];
  const colNames: string[] = [];
  for (const st of plan) {
    if (st.check.kind === 'relation') rels.add(st.check.name);
    if (st.check.kind === 'columns') {
      for (const c of st.check.columns) {
        colTables.push(st.check.table);
        colNames.push(c);
      }
    }
  }
  let missingSet = new Set<string>();
  if (rels.size || colTables.length) {
    const r = await db.query(CATALOG_SQL, [[...rels], colTables, colNames]);
    missingSet = new Set((r.rows || []).map((row: any) => String(row.missing)));
  }
  const pending = plan.filter((st) => {
    if (st.check.kind === 'other') return true;
    if (st.check.kind === 'relation') return missingSet.has(`r:${st.check.name}`);
    const t = st.check.table;
    return st.check.columns.some((c) => missingSet.has(`c:${t}.${c}`));
  });
  return { pending, missing: [...missingSet].map((x) => x.slice(2)) };
}

/**
 * Executa o DDL idempotente so se faltar algo no catalogo, com lock_timeout/statement_timeout
 * locais a transacao (set_config(..., true)). Lanca o erro do Postgres (ex.: 55P03 lock_not_available)
 * para o chamador decidir; nunca espera mais que o lock_timeout por uma trava.
 */
export async function runGuardedDdl(
  db: DdlQueryable,
  sql: string,
  opts: { lockTimeoutMs?: number; statementTimeoutMs?: number } = {}
): Promise<GuardedDdlResult> {
  const plan = planDdl(sql);
  const { pending, missing } = await pendingDdl(db, plan);
  if (!pending.length) return { total: plan.length, executed: 0, missing };
  const lockMs = Math.max(100, Math.floor(opts.lockTimeoutMs ?? DEFAULT_DDL_LOCK_TIMEOUT_MS));
  const stmtMs = Math.max(1000, Math.floor(opts.statementTimeoutMs ?? DEFAULT_DDL_STATEMENT_TIMEOUT_MS));
  // Texto simples com varios comandos = UMA transacao implicita: os set_config(..., true) valem
  // so para ela (seguro no pgbouncer em modo transacao) e uma falha desfaz o lote inteiro.
  const batch = [
    `SELECT set_config('lock_timeout', '${lockMs}ms', true), set_config('statement_timeout', '${stmtMs}ms', true)`,
    ...pending.map((p) => p.sql),
  ].join(';\n');
  await db.query(batch + ';');
  return { total: plan.length, executed: pending.length, missing };
}
