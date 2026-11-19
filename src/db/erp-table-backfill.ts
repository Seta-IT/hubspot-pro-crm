// ============================================================================
// STI-hub — Backfill generico das tabelas proprias do ERP (E0) — 18/11/2026
// ----------------------------------------------------------------------------
// Uma acao por execucao, sempre numa transacao com CAS por md5 do crm_state_v1:
//  - plan (dry-run): le, valida (ids, CNPJ emitente, codigos repetidos) e conta. Nada e gravado.
//  - apply: cria a tabela se faltar, copia/atualiza as linhas pelo id (JSON = fonte; so regrava o que
//    mudou), confere contagem, ids e soma, e liga payload.erp.storage.<recurso>='dual'. O ARRAY DO
//    JSON NAO E TOCADO. Idempotente: rodar de novo so ressincroniza.
//  - cut: (exige OK explicito do usuario: esvazia o array do JSON) so a partir de 'dual' e com a
//    tabela identica ao JSON; liga 'table' e o array vira [] na mesma transacao.
//  - rollback: de 'table' volta para 'dual', copiando a tabela de volta para o array do JSON (a
//    tabela nao e apagada). Desliga a guarda so nesta transacao (SET LOCAL).
// Se o crm_state_v1 mudar entre a leitura e o UPDATE, o CAS falha e tudo e desfeito (ROLLBACK).
// ============================================================================
import { createHash } from 'node:crypto';
import {
  ensureErpTable,
  ensureKvErpStorageGuardTrigger,
  erpRowValues,
  getAllErpRows,
  getErpStorageMode,
  ERP_STORAGE_GUARD_GUC,
  upsertErpRowsById,
  type AnyRec,
  type ErpStorageMode,
  type ErpTableSpec,
  type PgQ,
} from './erp-table-store';

export type BackfillAction = 'plan' | 'apply' | 'cut' | 'rollback';

export interface BackfillReport {
  resource: string;
  table: string;
  action: BackfillAction;
  modeBefore: ErpStorageMode;
  modeAfter: ErpStorageMode;
  jsonCount: number;
  tableCountBefore: number | null;
  tableCountAfter: number | null;
  written: number;
  jsonSum: number | null;
  tableSum: number | null;
  invalid: Array<{ id: string; error: string }>;
  duplicateIds: string[];
  duplicateCodes: string[];
  missingInTable: string[];
  extraInTable: string[];
  stateMd5Before: string;
  stateMd5After: string | null;
  stateBytesBefore: number;
  stateBytesAfter: number | null;
  result: string;
}

export class BackfillAbort extends Error {
  constructor(message: string, public readonly report: BackfillReport) {
    super(message);
    this.name = 'BackfillAbort';
  }
}

const md5 = (s: string) => createHash('md5').update(s).digest('hex');
const r2 = (n: number) => Math.round(n * 100) / 100;

async function tableStats(db: PgQ, spec: ErpTableSpec): Promise<{ count: number; sum: number | null; ids: Set<string> }> {
  const sumSql = spec.sumColumn ? `, coalesce(sum(${spec.sumColumn}), 0)::float8 AS s` : '';
  const agg = await db.query(`SELECT count(*)::int AS n${sumSql} FROM ${spec.table}`);
  const ids = await db.query(`SELECT id FROM ${spec.table}`);
  return {
    count: Number(agg.rows?.[0]?.n) || 0,
    sum: spec.sumColumn ? r2(Number(agg.rows?.[0]?.s) || 0) : null,
    ids: new Set((ids.rows || []).map((r) => String(r.id))),
  };
}

async function tableExists(db: PgQ, table: string): Promise<boolean> {
  const r = await db.query(`SELECT to_regclass($1) IS NOT NULL AS ok`, [table]);
  return Boolean(r.rows?.[0]?.ok);
}

/**
 * Executa a acao. O chamador abre/fecha a transacao (BEGIN antes; COMMIT se voltar sem erro e a
 * acao nao for 'plan'; ROLLBACK em erro ou no plan). Nunca apaga linhas da tabela.
 */
export async function runErpTableBackfill(
  db: PgQ,
  spec: ErpTableSpec,
  action: BackfillAction,
  opts: { confirmCut?: boolean } = {}
): Promise<BackfillReport> {
  const res = await db.query(`SELECT payload, md5(payload::text) AS m, length(payload::text) AS len FROM crm_kv_store WHERE key = 'crm_state_v1'`);
  if (!res.rows?.length) throw new Error('crm_state_v1 inexistente');
  const payload = (typeof res.rows[0].payload === 'string' ? JSON.parse(res.rows[0].payload) : res.rows[0].payload) as AnyRec;
  const modeBefore = getErpStorageMode(payload, spec.resource);
  const list: AnyRec[] = Array.isArray(payload?.erp?.[spec.resource]) ? payload.erp[spec.resource] : [];
  const report: BackfillReport = {
    resource: spec.resource,
    table: spec.table,
    action,
    modeBefore,
    modeAfter: modeBefore,
    jsonCount: list.length,
    tableCountBefore: null,
    tableCountAfter: null,
    written: 0,
    jsonSum: spec.sumValue ? r2(list.reduce((s, r) => s + spec.sumValue!(r), 0)) : null,
    tableSum: null,
    invalid: [],
    duplicateIds: [],
    duplicateCodes: [],
    missingInTable: [],
    extraInTable: [],
    stateMd5Before: String(res.rows[0].m),
    stateMd5After: null,
    stateBytesBefore: Number(res.rows[0].len) || 0,
    stateBytesAfter: null,
    result: '',
  };

  // Validacao (todas as acoes): id unico e nao vazio, CNPJ emitente valido.
  const seenIds = new Map<string, number>();
  const seenCodes = new Map<string, number>();
  for (const r of list) {
    const id = String(r?.id ?? '').trim();
    if (!id) {
      report.invalid.push({ id: '(sem id)', error: 'registro sem id' });
      continue;
    }
    seenIds.set(id.toLowerCase(), (seenIds.get(id.toLowerCase()) || 0) + 1);
    const code = String(r?.code ?? '').trim().toLowerCase();
    if (code) seenCodes.set(code, (seenCodes.get(code) || 0) + 1);
    try {
      erpRowValues(spec, r);
    } catch (e) {
      report.invalid.push({ id, error: e instanceof Error ? e.message : String(e) });
    }
  }
  report.duplicateIds = Array.from(seenIds.entries()).filter(([, n]) => n > 1).map(([k]) => k);
  report.duplicateCodes = Array.from(seenCodes.entries()).filter(([, n]) => n > 1).map(([k]) => k);

  const exists = await tableExists(db, spec.table);
  if (exists) {
    const st = await tableStats(db, spec);
    report.tableCountBefore = st.count;
  }

  const fail = (msg: string): never => {
    report.result = `ABORTADO: ${msg}`;
    throw new BackfillAbort(msg, report);
  };

  const cas = async (newPayloadSql: string, params: unknown[]) => {
    const upd = await db.query(
      `UPDATE crm_kv_store SET payload = ${newPayloadSql}, updated_at = NOW()
        WHERE key = 'crm_state_v1' AND md5(payload::text) = $1
        RETURNING md5(payload::text) AS m, length(payload::text) AS len`,
      [report.stateMd5Before, ...params]
    );
    if (!upd.rows || upd.rows.length !== 1) fail('CAS md5 falhou: o crm_state_v1 mudou durante a execucao (nada gravado; rode de novo)');
    report.stateMd5After = String(upd.rows[0].m);
    report.stateBytesAfter = Number(upd.rows[0].len) || 0;
  };

  const verifyEqual = async () => {
    const st = await tableStats(db, spec);
    report.tableCountAfter = st.count;
    report.tableSum = st.sum;
    const jsonIds = new Set(list.map((r) => String(r?.id ?? '')).filter(Boolean));
    report.missingInTable = Array.from(jsonIds).filter((id) => !st.ids.has(id)).slice(0, 50);
    report.extraInTable = Array.from(st.ids).filter((id) => !jsonIds.has(id)).slice(0, 50);
    if (report.missingInTable.length) fail(`${report.missingInTable.length} registro(s) do JSON nao estao na tabela`);
    if (spec.sumColumn && report.jsonSum !== null && st.sum !== null && Math.abs(st.sum - report.jsonSum) > 0.01 && !report.extraInTable.length) {
      fail(`soma de ${spec.sumColumn} diverge (JSON ${report.jsonSum} x tabela ${st.sum})`);
    }
    return st;
  };

  if (action === 'plan') {
    report.result = 'DRY-RUN (nada gravado)';
    return report;
  }

  if (action === 'apply') {
    if (modeBefore === 'table') {
      report.result = 'JA_EM_MODO_TABELA (nada feito)';
      return report;
    }
    if (report.invalid.length) fail(`${report.invalid.length} registro(s) invalido(s) (veja invalid)`);
    if (report.duplicateIds.length) fail(`ids repetidos no JSON: ${report.duplicateIds.slice(0, 5).join(', ')}`);
    await ensureErpTable(db, spec);
    await ensureKvErpStorageGuardTrigger(db);
    report.written = (await upsertErpRowsById(db, spec, list)).written;
    const st = await verifyEqual();
    if (st.count < list.length) fail(`tabela com ${st.count} linhas e JSON com ${list.length}`);
    if (modeBefore !== 'dual') {
      // So o marcador muda: o array do JSON continua inteiro (dupla escrita).
      await cas(
        `jsonb_set(CASE WHEN jsonb_typeof(payload->'erp'->'storage') = 'object' THEN payload ELSE jsonb_set(payload, '{erp,storage}', '{}'::jsonb) END, ARRAY['erp','storage',$2::text], '"dual"'::jsonb)`,
        [spec.resource]
      );
    }
    report.modeAfter = 'dual';
    report.result = modeBefore === 'dual' ? 'RESSINCRONIZADO (ja estava em dual)' : 'DUAL LIGADO (JSON intacto)';
    return report;
  }

  if (action === 'cut') {
    if (!opts.confirmCut) fail('o corte esvazia o array do JSON: exige --confirm-cut (com OK explicito do usuario)');
    if (modeBefore === 'table') {
      report.result = 'JA_EM_MODO_TABELA (nada feito)';
      return report;
    }
    if (modeBefore !== 'dual') fail("o corte so pode partir do modo 'dual' (rode --apply antes)");
    if (!exists) fail('tabela inexistente');
    await ensureKvErpStorageGuardTrigger(db);
    // Garante a tabela identica ao JSON antes do corte (inclui gravacoes feitas desde o apply).
    report.written = (await upsertErpRowsById(db, spec, list)).written;
    const st = await verifyEqual();
    if (report.extraInTable.length) fail(`${report.extraInTable.length} linha(s) na tabela que nao existem no JSON; confira antes do corte`);
    if (st.count !== list.length) fail(`contagem diverge (JSON ${list.length} x tabela ${st.count})`);
    await cas(`jsonb_set(jsonb_set(payload, ARRAY['erp',$2::text], '[]'::jsonb), ARRAY['erp','storage',$2::text], '"table"'::jsonb)`, [spec.resource]);
    report.modeAfter = 'table';
    report.result = 'CORTE FEITO (tabela e a fonte; array do JSON vazio)';
    return report;
  }

  // rollback: tabela -> JSON, modo 'dual'.
  if (modeBefore !== 'table') {
    report.result = 'NADA A DESFAZER (nao esta em modo tabela)';
    return report;
  }
  if (!exists) fail('tabela inexistente');
  const rows = await getAllErpRows(db, spec);
  report.tableCountAfter = rows.length;
  await db.query(`SELECT set_config($1, 'off', true)`, [ERP_STORAGE_GUARD_GUC]);
  await cas(
    `jsonb_set(jsonb_set(payload, ARRAY['erp',$2::text], $3::jsonb), ARRAY['erp','storage',$2::text], '"dual"'::jsonb)`,
    [spec.resource, JSON.stringify(rows.map((r) => r.record))]
  );
  await db.query(`SELECT set_config($1, '', true)`, [ERP_STORAGE_GUARD_GUC]);
  report.modeAfter = 'dual';
  report.result = 'ROLLBACK FEITO (JSON com os registros da tabela; modo dual)';
  return report;
}
