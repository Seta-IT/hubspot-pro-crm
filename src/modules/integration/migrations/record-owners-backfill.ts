// ============================================================================
// STI-hub — carga inicial do registro de donos (api_record_owners) — CISO 26/11/2026, Lote 2 item 5.
// ----------------------------------------------------------------------------
// Resolve o dono de cada registro pelo ID do usuario a partir do responsavel/vendedor ATUAL:
//   proposta: sellerUserId -> e-mail do vendedor -> nome do vendedor
//   contrato: nome do vendedor | OS e pedido de venda: sellerUserId -> nome do vendedor
//   tarefa do CRM: nome do responsavel (assignedTo)
// Nome so vale com UM usuario com aquele nome (comparacao sem caixa/acentos). Homonimos ficam no
// relatorio (`ambiguous`) e NAO sao atribuidos; sem correspondencia => `unresolved`.
// Idempotente: so insere onde ainda nao ha dono (INSERT ... ON CONFLICT DO NOTHING); nunca troca dono.
// Funcoes puras aqui; o CLI (cli-record-owners-backfill.ts) le o banco e grava so com --apply.
// ============================================================================

export type OwnerEntity = 'erp.proposal' | 'erp.contract' | 'erp.service_order' | 'erp.sales_order' | 'crm.task';

export interface BackfillUser {
  id: string;
  name?: string;
  email?: string;
  active?: boolean;
}

export interface BackfillInput {
  users: BackfillUser[];
  proposals?: Array<Record<string, unknown>>;
  contracts?: Array<Record<string, unknown>>;
  serviceOrders?: Array<Record<string, unknown>>;
  salesOrders?: Array<Record<string, unknown>>;
  tasks?: Array<Record<string, unknown>>;
}

export interface BackfillAssignment {
  entity: OwnerEntity;
  recordId: string;
  ownerUserId: string;
  via: 'id' | 'email' | 'name';
}

export interface BackfillPlan {
  assign: BackfillAssignment[];
  ambiguous: Array<{ entity: OwnerEntity; recordId: string; field: string; value: string; candidateUserIds: string[] }>;
  unresolved: Array<{ entity: OwnerEntity; recordId: string; reason: string }>;
  alreadyOwned: number;
  totals: Record<OwnerEntity, number>;
}

export const normName = (v: unknown): string =>
  String(v ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

const ownerKey = (entity: string, recordId: string) => `${entity}\u0000${recordId}`;

export function planRecordOwnerBackfill(input: BackfillInput, existingOwners: Set<string>): BackfillPlan {
  const byId = new Map(input.users.filter((u) => u && u.id).map((u) => [String(u.id), u]));
  const byEmail = new Map<string, string[]>();
  const byName = new Map<string, string[]>();
  for (const u of byId.values()) {
    const e = String(u.email || '').trim().toLowerCase();
    if (e) byEmail.set(e, [...(byEmail.get(e) || []), u.id]);
    const n = normName(u.name);
    if (n) byName.set(n, [...(byName.get(n) || []), u.id]);
  }
  const plan: BackfillPlan = {
    assign: [],
    ambiguous: [],
    unresolved: [],
    alreadyOwned: 0,
    totals: { 'erp.proposal': 0, 'erp.contract': 0, 'erp.service_order': 0, 'erp.sales_order': 0, 'crm.task': 0 },
  };

  type Step = { kind: 'id' | 'email' | 'name'; field: string };
  const visit = (entity: OwnerEntity, list: Array<Record<string, unknown>> | undefined, steps: Step[]) => {
    for (const r of list || []) {
      const recordId = String(r?.id ?? '').trim();
      if (!recordId) continue;
      plan.totals[entity]++;
      if (existingOwners.has(ownerKey(entity, recordId))) {
        plan.alreadyOwned++;
        continue;
      }
      let done = false;
      for (const st of steps) {
        const raw = String(r[st.field] ?? '').trim();
        if (!raw) continue;
        if (st.kind === 'id') {
          if (byId.has(raw)) {
            plan.assign.push({ entity, recordId, ownerUserId: raw, via: 'id' });
            done = true;
            break;
          }
          continue; // ID orfao: tenta o proximo criterio
        }
        const candidates = (st.kind === 'email' ? byEmail.get(raw.toLowerCase()) : byName.get(normName(raw))) || [];
        if (candidates.length === 1) {
          plan.assign.push({ entity, recordId, ownerUserId: candidates[0], via: st.kind });
          done = true;
          break;
        }
        if (candidates.length > 1) {
          // Homonimo (ou e-mail repetido): nunca atribui; vai para o relatorio.
          plan.ambiguous.push({ entity, recordId, field: st.field, value: raw.slice(0, 200), candidateUserIds: [...candidates].sort() });
          done = true;
          break;
        }
      }
      if (!done) plan.unresolved.push({ entity, recordId, reason: 'responsavel/vendedor sem usuario correspondente' });
    }
  };

  visit('erp.proposal', input.proposals, [
    { kind: 'id', field: 'sellerUserId' },
    { kind: 'email', field: 'sellerEmail' },
    { kind: 'name', field: 'sellerName' },
  ]);
  visit('erp.contract', input.contracts, [{ kind: 'name', field: 'sellerName' }]);
  visit('erp.service_order', input.serviceOrders, [
    { kind: 'id', field: 'sellerUserId' },
    { kind: 'name', field: 'sellerName' },
  ]);
  visit('erp.sales_order', input.salesOrders, [
    { kind: 'id', field: 'sellerUserId' },
    { kind: 'name', field: 'sellerName' },
  ]);
  visit('crm.task', input.tasks, [{ kind: 'name', field: 'assignedTo' }]);
  return plan;
}

export interface BackfillQueryable {
  query: (text: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount?: number | null }>;
}

export const BACKFILL_INSERT_SQL = `INSERT INTO api_record_owners (entity, record_id, owner_user_id, created_at) VALUES ($1, $2, $3, $4) ON CONFLICT (entity, record_id) DO NOTHING`;

/** Grava o plano (so insere; ja existente fica intacto). Chamador controla a transacao. */
export async function applyRecordOwnerBackfill(db: BackfillQueryable, plan: BackfillPlan, at: string): Promise<{ inserted: number; skipped: number }> {
  let inserted = 0;
  for (const a of plan.assign) {
    const r = await db.query(BACKFILL_INSERT_SQL, [a.entity, a.recordId, a.ownerUserId, at]);
    inserted += Number(r.rowCount || 0);
  }
  return { inserted, skipped: plan.assign.length - inserted };
}

/** Donos ja registrados (para o plano pular). */
export async function loadExistingOwners(db: BackfillQueryable): Promise<Set<string>> {
  const r = await db.query(`SELECT entity, record_id FROM api_record_owners`);
  return new Set(r.rows.map((x: { entity: string; record_id: string }) => ownerKey(x.entity, x.record_id)));
}
