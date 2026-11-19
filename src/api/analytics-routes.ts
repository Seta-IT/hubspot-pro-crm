// ============================================================================
// STI-hub — Fase 5: rotas de Analytics (/api/analytics/*). Somente leitura do CRM/ERP.
//  - Sessao corporativa com 2FA e acesso ao CRM. Escopo PROPRIOS/EQUIPE => so os contatos do
//    usuario (mesma regra das rotas de contato). ERP (contratos) so para quem tem acesso ao ERP.
//  - Drill-down/exportacao: sem telefone; contato suprimido sai com e-mail mascarado e o motivo.
//  - Exportacao registrada na trilha de auditoria (sem dados de contato no registro).
// ============================================================================
import type { CrmRepository } from '../db/repository';
import type { MarketingStore } from '../modules/marketing/marketing-store';
import type { WorkflowStore } from '../modules/workflows/dag/store';
import type { SignalStore } from '../modules/analytics/signal-store';
import { SIGNAL_CLASS_LABELS } from '../modules/analytics/signal-classifier';
import {
  ANALYTICS_QUESTIONS,
  buildDataset,
  cohortReport,
  computeAnswers,
  engagementCounters,
  sequenceStepReport,
  workflowVariantReport,
  type AnalyticsOptions,
  type DrillHit,
} from '../modules/analytics/analytics-engine';
import { renderExport, type ExportFormat, type ExportTable } from '../modules/analytics/export-formats';
import { canSeeRecordInScope, isMailboxScopeRestricted } from './mailbox-routes';

type Query = Record<string, string | undefined>;
type Resp = { status: number; body: unknown };
export interface AnalyticsRouteDeps {
  signals: SignalStore;
  marketing?: MarketingStore | null;
  workflows?: WorkflowStore | null;
  now?: () => Date;
}

export const EXPORT_MAX_ROWS = 20000;
const DAY = 86400000;

interface Actor {
  email: string;
  name: string;
  restricted: boolean;
  erpAllowed: boolean;
  canSee: (contactId: string) => boolean;
}

function resolveActor(repo: CrmRepository, query: Query, ctx: { trustedInternal: boolean }): Actor | Resp {
  if (ctx.trustedInternal) return { status: 403, body: { error: 'Recurso disponível só para usuários.' } };
  const tok = query._sessionToken;
  const sess = tok ? repo.resolveSessionFromToken(tok) : null;
  if (!sess || !sess.authenticated || !sess.user || !sess.mfaVerified) return { status: 401, body: { error: 'Sessão corporativa STI-hub com 2FA obrigatória.' } };
  const modules = sess.moduleAccess;
  if (!modules?.crm) return { status: 403, body: { error: 'Seu perfil não tem acesso ao CRM.' } };
  const perm = (sess.crmPermissions || {}) as unknown as Record<string, string>;
  if (String(perm.contactsAccess || 'NONE') === 'NONE') return { status: 403, body: { error: 'Seu perfil não tem acesso a contatos.' } };
  const isAdmin = sess.effectiveActionGuards?.canManageUsersRbac === true;
  const actor = {
    email: String(sess.user.email || '').toLowerCase(),
    name: String(sess.user.name || sess.user.email || ''),
    roleId: String(sess.user.roleId || ''),
    isAdmin,
    access: { contact: true, company: true, deal: true },
    id: String(sess.user.id || ''),
    scope: String((sess.user as { scope?: string }).scope || 'PROPRIOS'),
  };
  const restricted = isMailboxScopeRestricted(actor);
  return {
    email: actor.email,
    name: actor.name,
    restricted,
    erpAllowed: isAdmin || modules.erp === true,
    canSee: (contactId: string) => canSeeRecordInScope(repo, actor, { contactId }),
  };
}

/** Periodo em dias do calendario de Brasilia (UTC-3). Padrao: ultimos 90 dias. Maximo 2 anos. */
export function parsePeriod(query: Query, now: Date): { from: string; to: string } | null {
  const d = /^\d{4}-\d{2}-\d{2}$/;
  const to = query.to && d.test(query.to) ? new Date(`${query.to}T23:59:59.999-03:00`) : now;
  const from = query.from && d.test(query.from) ? new Date(`${query.from}T00:00:00.000-03:00`) : new Date(to.getTime() - 90 * DAY);
  if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || from > to || to.getTime() - from.getTime() > 731 * DAY) return null;
  return { from: from.toISOString(), to: to.toISOString() };
}

export function maskEmail(email: string): string {
  const [user, domain] = String(email || '').split('@');
  if (!domain) return '***';
  return `${user.slice(0, 1)}***@${domain}`;
}

const SUPPRESSION_LABEL: Record<string, string> = {
  UNSUBSCRIBED_MARKETING: 'Descadastrado (marketing)',
  HARD_BOUNCE: 'Hard bounce',
  SPAM_COMPLAINT: 'Reclamação de spam',
  MANUAL_SUPPRESSION: 'Supressão manual',
  LGPD_REVOCATION: 'Revogação LGPD',
};

export interface DrillRow {
  contactId: string;
  name: string;
  company: string;
  email: string;
  owner: string;
  lifecycleStage: string;
  at: string | null;
  detail: string;
  value: number | null;
  suppressed: boolean;
  suppressionReason: string | null;
}

function toRows(repo: CrmRepository, hits: DrillHit[], suppressed: Map<string, string>): DrillRow[] {
  const companies = new Map(repo.listCompanies().map((c) => [c.id, c.name]));
  return hits
    .map((h) => {
      const c = repo.getContactById(h.contactId);
      if (!c) return null;
      const sup = suppressed.get(c.id) || null;
      return {
        contactId: c.id,
        name: `${c.firstName || ''} ${c.lastName || ''}`.trim(),
        company: c.companyId ? companies.get(c.companyId) || '' : '',
        email: sup ? maskEmail(c.email) : c.email,
        owner: c.ownerName || '',
        lifecycleStage: String(c.lifecycleStage || ''),
        at: h.at,
        detail: h.detail,
        value: h.value ?? null,
        suppressed: Boolean(sup),
        suppressionReason: sup ? SUPPRESSION_LABEL[sup] || sup : null,
      } as DrillRow;
    })
    .filter((x): x is DrillRow => Boolean(x))
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0) || String(b.at || '').localeCompare(String(a.at || '')));
}

const fmtDate = (iso: string | null) => (iso ? new Date(Date.parse(iso) - 3 * 3600000).toISOString().slice(0, 16).replace('T', ' ') : '');

export async function handleAnalyticsRoute(
  repo: CrmRepository,
  method: string,
  cleanPath: string,
  query: Query,
  body: Record<string, unknown>,
  ctx: { trustedInternal: boolean },
  deps: AnalyticsRouteDeps
): Promise<Resp> {
  const actor = resolveActor(repo, query, ctx);
  if ('status' in actor) return actor;
  const now = (deps.now || (() => new Date()))();
  const src = method === 'POST' ? { ...query, ...(Object.fromEntries(Object.entries(body || {}).map(([k, v]) => [k, v === undefined || v === null ? undefined : String(v)])) as Query) } : query;
  const period = parsePeriod(src, now);
  if (!period) return { status: 400, body: { error: 'Período inválido (use AAAA-MM-DD; máximo de 2 anos).' } };
  const opts: AnalyticsOptions = { ...period, includeSimulated: src.includeSimulated === '1' || src.includeSimulated === 'true', canSee: actor.canSee, erpAllowed: actor.erpAllowed };
  const dataset = () => buildDataset(repo, { signals: deps.signals, marketing: deps.marketing, workflows: deps.workflows }, opts);
  const scope = { restricted: actor.restricted, erpAllowed: actor.erpAllowed, includeSimulated: opts.includeSimulated, from: opts.from, to: opts.to };

  if (cleanPath === '/api/analytics/overview' && method === 'GET') {
    const ds = await dataset();
    return { status: 200, body: { data: { scope, counters: engagementCounters(ds), questions: computeAnswers(repo, ds).map((c) => c.answer), classLabels: SIGNAL_CLASS_LABELS } } };
  }
  if (cleanPath === '/api/analytics/drill' && method === 'GET') {
    const q = Number(src.q);
    if (!(q >= 1 && q <= 20)) return { status: 400, body: { error: 'Pergunta inválida (1 a 20).' } };
    const ds = await dataset();
    const c = computeAnswers(repo, ds).find((x) => x.answer.id === q)!;
    const hits = c.drill.get(String(src.group || '')) || [];
    const rows = toRows(repo, hits, ds.suppressed);
    const pageSize = Math.min(200, Math.max(10, Number(src.pageSize) || 50));
    const page = Math.max(1, Number(src.page) || 1);
    return { status: 200, body: { data: { scope, question: c.answer.question, group: c.answer.groups.find((g) => g.key === src.group) || null, total: rows.length, page, pageSize, rows: rows.slice((page - 1) * pageSize, page * pageSize) } } };
  }
  if (cleanPath === '/api/analytics/sequences' && method === 'GET') {
    return { status: 200, body: { data: { scope, sequences: sequenceStepReport(repo, await dataset()) } } };
  }
  if (cleanPath === '/api/analytics/workflows' && method === 'GET') {
    return { status: 200, body: { data: { scope, splits: await workflowVariantReport(await dataset(), deps.workflows) } } };
  }
  if (cleanPath === '/api/analytics/cohorts' && method === 'GET') {
    return { status: 200, body: { data: { scope, cohorts: cohortReport(await dataset()) } } };
  }
  const sig = cleanPath.match(/^\/api\/analytics\/contacts\/([^/]+)\/signals$/);
  if (sig && method === 'GET') {
    const id = decodeURIComponent(sig[1]);
    if (!repo.getContactById(id) || !actor.canSee(id)) return { status: 404, body: { error: 'Contato não encontrado.' } };
    const list = await deps.signals.listByContact(id, 200);
    return { status: 200, body: { data: list.map((s) => ({ at: s.at, kind: s.kind, classification: s.classification, label: SIGNAL_CLASS_LABELS[s.classification], reasons: s.reasons, url: s.url, uaFamily: s.uaFamily, ipNetwork: s.ipNetwork, secondsSinceSent: s.secondsSinceSent, source: s.source })) } };
  }
  if (cleanPath === '/api/analytics/export' && method === 'POST') {
    const format = (['csv', 'xlsx', 'pdf'].includes(String(src.format)) ? src.format : null) as ExportFormat | null;
    if (!format) return { status: 400, body: { error: 'Formato inválido (csv, xlsx ou pdf).' } };
    const report = String(src.report || 'questions');
    const ds = await dataset();
    const sub = `Período ${fmtDate(opts.from).slice(0, 10)} a ${fmtDate(opts.to).slice(0, 10)} (horário de Brasília)${actor.restricted ? ' - somente seus contatos' : ''}${opts.includeSimulated ? ' - inclui registros simulados' : ''}`;
    let table: ExportTable;
    if (report === 'questions') {
      const answers = computeAnswers(repo, ds).map((c) => c.answer);
      table = { title: 'STI-hub - 20 perguntas de engajamento', subtitle: sub, columns: ['Nº', 'Pergunta', 'Resposta', 'Grupo', 'Contatos', 'Valor', 'Detalhe'], rows: answers.flatMap((a) => (a.groups.length ? a.groups : [{ key: '', label: '-', count: 0 }]).map((g) => [a.id, a.question, a.headline, g.label, g.count, g.value ?? null, g.detail || ''])) };
    } else if (report === 'drill') {
      const q = Number(src.q);
      if (!(q >= 1 && q <= 20)) return { status: 400, body: { error: 'Pergunta inválida (1 a 20).' } };
      const c = computeAnswers(repo, ds).find((x) => x.answer.id === q)!;
      const rows = toRows(repo, c.drill.get(String(src.group || '')) || [], ds.suppressed).slice(0, EXPORT_MAX_ROWS);
      table = { title: `STI-hub - ${c.answer.question}`, subtitle: `${sub} - ${c.answer.groups.find((g) => g.key === src.group)?.label || ''}`, columns: ['Contato', 'Empresa', 'E-mail', 'Proprietário', 'Etapa', 'Quando', 'Detalhe', 'Valor', 'Suprimido'], rows: rows.map((r) => [r.name, r.company, r.email, r.owner, r.lifecycleStage, fmtDate(r.at), r.detail, r.value, r.suppressionReason || '']) };
    } else if (report === 'sequences') {
      table = { title: 'STI-hub - Conversão por passo de cadência', subtitle: sub, columns: ['Cadência', 'Passo', 'Assunto', 'Enviados', 'Abert. observadas', 'Abert. automáticas', 'Cliques humanos', 'Cliques robô', 'Respostas', 'Saídas', 'Oportunidades', 'Taxa resposta %', 'Taxa clique humano %'], rows: sequenceStepReport(repo, ds).flatMap((s) => s.steps.map((p) => [s.sequenceName, p.stepOrder, p.subject, p.sent, p.opensObserved, p.opensMachine, p.clicksHuman, p.clicksBot, p.replies, p.exits, p.opportunities, p.replyRate, p.humanClickRate])) };
    } else if (report === 'workflows') {
      table = { title: 'STI-hub - Caminhos A/B das automações', subtitle: sub, columns: ['Fluxo', 'Nó', 'Caminho', '%', 'Execuções', 'Concluídas', 'Engajamento humano', 'Oportunidades', 'Ganho (R$)', 'Taxa humano %', 'Taxa oportunidade %'], rows: (await workflowVariantReport(ds, deps.workflows)).flatMap((w) => w.variants.map((v) => [w.workflowName, w.nodeLabel, v.label, v.percent, v.runs, v.completed, v.humanEngaged, v.opportunities, v.wonValue, v.humanRate, v.opportunityRate])) };
    } else if (report === 'cohorts') {
      const cs = cohortReport(ds);
      table = { title: 'STI-hub - Coortes por mês do primeiro envio', subtitle: sub, columns: ['Coorte', 'Contatos', ...[0, 1, 2, 3, 4, 5].map((m) => `Engaj. M${m} %`), ...[0, 1, 2, 3, 4, 5].map((m) => `Oport. M${m} %`)], rows: cs.map((c) => [c.cohort, c.size, ...c.humanEngagedPct, ...c.opportunityPct]) };
    } else {
      return { status: 400, body: { error: 'Relatório inválido.' } };
    }
    const file = renderExport(format, table);
    const stamp = now.toISOString().slice(0, 10);
    repo.appendSecurityAuditLog({
      actorEmail: actor.email,
      actorName: actor.name,
      action: 'ANALYTICS_EXPORT',
      module: 'CRM',
      resource: `analytics:${report}${report === 'drill' ? `:${src.q}:${String(src.group || '').slice(0, 60)}` : ''}`,
      status: "SUCCESS",
      details: `Exportação ${format.toUpperCase()} com ${table.rows.length} linha(s); escopo ${actor.restricted ? 'próprios' : 'todos'}.`,
    });
    return { status: 200, body: { data: { fileName: `sti-hub-analytics-${report}-${stamp}.${file.extension}`, mimeType: file.mimeType, rows: table.rows.length, base64: file.data.toString('base64') } } };
  }
  if (cleanPath === '/api/analytics/questions' && method === 'GET') {
    return { status: 200, body: { data: ANALYTICS_QUESTIONS } };
  }
  return { status: 404, body: { error: 'Not found' } };
}
