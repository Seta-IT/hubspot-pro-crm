import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import {
  PgPoolLike,
  resetMirrorSnapshots,
  syncStateToPostgres,
} from '../src/db/postgres';
import type { Company, CrmDatabaseState, Deal } from '../src/db/types';

interface Logged {
  text: string;
  params?: unknown[];
}

function proposalIdFromDealRow(cols: string[], vals: unknown[]): string | null {
  const dataIdx = cols.indexOf('data');
  if (dataIdx < 0) return null;
  const raw = vals[dataIdx];
  if (!raw) return null;
  try {
    const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const direct = typeof data?.proposalId === 'string' ? data.proposalId.trim() : '';
    if (direct) return direct;
    const nested =
      data?.customProperties && typeof data.customProperties.proposalId === 'string'
        ? String(data.customProperties.proposalId).trim()
        : '';
    return nested || null;
  } catch {
    return null;
  }
}

function createFakePool() {
  const tables = new Map<string, Map<string, { row_hash: string | null; values: unknown[]; cols: string[] }>>();
  const log: Logged[] = [];
  const tbl = (n: string) => {
    if (!tables.has(n)) tables.set(n, new Map());
    return tables.get(n)!;
  };
  const query = async (text: string, params?: unknown[]) => {
    log.push({ text, params });
    const t = text.trim();
    let m = t.match(/^SELECT id, row_hash FROM (\w+)$/);
    if (m) return { rows: [...tbl(m[1]).entries()].map(([id, r]) => ({ id, row_hash: r.row_hash })) };
    m = t.match(/^INSERT INTO (crm_\w+) \(([^)]+)\) VALUES ([\s\S]+) ON CONFLICT \(id\) DO UPDATE/);
    if (m && m[1] !== 'crm_kv_store') {
      const table = m[1];
      const cols = m[2].split(',').map((c) => c.trim());
      const n = cols.length;
      const p = params || [];
      const rows: unknown[][] = [];
      for (let i = 0; i < p.length; i += n) rows.push(p.slice(i, i + n));
      if (table === 'crm_deals') {
        for (const vals of rows) {
          const id = String(vals[0]);
          const pid = proposalIdFromDealRow(cols, vals);
          if (!pid) continue;
          for (const [existingId, rec] of tbl(table)) {
            if (existingId === id) continue;
            if (proposalIdFromDealRow(rec.cols, rec.values) === pid) {
              const err = Object.assign(new Error('duplicate key value violates unique constraint "ux_crm_deals_proposal_id"'), {
                code: '23505',
              });
              throw err;
            }
          }
        }
      }
      for (const vals of rows) {
        tbl(table).set(String(vals[0]), { row_hash: String(vals[n - 1]), values: vals, cols });
      }
      return { rows: [], rowCount: rows.length };
    }
    m = t.match(/^DELETE FROM (\w+) WHERE id = ANY/);
    if (m) {
      for (const id of (params?.[0] as string[]) || []) tbl(m[1]).delete(String(id));
      return { rows: [] };
    }
    return { rows: [] };
  };
  const pool: PgPoolLike = { query, connect: async () => ({ query, release: () => {} }) };
  return { pool, log, tables, tbl };
}

const mkCompany = (id: string, name: string): Company =>
  ({
    id,
    name,
    domain: null,
    cnpj: null,
    industry: 'X',
    completenessScore: 50,
    customProperties: {},
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }) as unknown as Company;

const mkDeal = (id: string, title: string, proposalId?: string): Deal =>
  ({
    id,
    title,
    value: 1000,
    currency: 'BRL',
    pipelineId: 'pipe-enterprise-b2b',
    stageId: 'stage-proposal',
    probability: 20,
    expectedCloseDate: null,
    contactId: null,
    companyId: null,
    proposalId: proposalId || null,
    ownerId: 'owner-1',
    ownerName: 'Teste',
    status: 'OPEN',
    stageEnteredAt: '2026-01-01T00:00:00.000Z',
    lastActivityAt: '2026-01-01T00:00:00.000Z',
    closedAt: null,
    lostReason: null,
    nextBestAction: null,
    customProperties: proposalId ? { proposalId } : {},
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }) as Deal;

const mkState = (companies: Company[], deals: Deal[]): CrmDatabaseState =>
  ({
    companies,
    contacts: [],
    pipelines: [],
    deals,
    timelineEvents: [],
    workflows: [],
    sequences: [],
    dataHealthIssues: [],
    webForms: [],
    serviceTickets: [],
  }) as unknown as CrmDatabaseState;

describe('Conflito de proposalId no espelho crm_deals não desfaz o salvamento', () => {
  beforeEach(() => resetMirrorSnapshots());

  it('pula o deal duplicado, grava o restante e faz COMMIT (sem ROLLBACK)', async () => {
    const { pool, log, tbl } = createFakePool();
    const firstDeal = mkDeal('deal-existente', 'Negócio original', 'prop-espelho-1');
    await syncStateToPostgres(mkState([mkCompany('comp-1', 'Empresa 1')], [firstDeal]), { pool });
    assert.equal(tbl('crm_deals').size, 1);
    assert.ok(tbl('crm_companies').has('comp-1'));

    log.length = 0;
    const duplicate = mkDeal('deal-duplicado', 'Tentativa paralela', 'prop-espelho-1');
    const newCompany = mkCompany('comp-2', 'Empresa nova no mesmo save');
    const stats = await syncStateToPostgres(mkState([mkCompany('comp-1', 'Empresa 1'), newCompany], [firstDeal, duplicate]), {
      pool,
    });

    assert.ok(tbl('crm_companies').has('comp-2'), 'a empresa nova deveria ter sido gravada');
    assert.equal(tbl('crm_deals').size, 1);
    assert.ok(tbl('crm_deals').has('deal-existente'));
    assert.ok(!tbl('crm_deals').has('deal-duplicado'));
    assert.equal(stats.find((s) => s.table === 'crm_deals')?.skippedConflicts, 1);
    assert.ok(log.some((q) => /^\s*COMMIT\s*$/i.test(q.text)));
    assert.ok(!log.some((q) => /^\s*ROLLBACK\s*$/i.test(q.text)));
  });
});
