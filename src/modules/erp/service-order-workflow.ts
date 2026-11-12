/**
 * Ordens de servico: situacao, historico de situacao, duplicacao (uso mensal, como no
 * GestaoClick) e colunas do Painel (kanban). Funcoes puras, usadas no servidor e na tela.
 */
import type { ErpServiceOrder, ErpServiceOrderStatusEntry } from '../../db/types';

/** Situacoes padrao da OS (ordem das colunas do Painel). */
export const SERVICE_ORDER_STATUSES = [
  'Em aberto',
  'Em andamento',
  'Aguardando peça',
  'Concluída',
  'Cancelada',
] as const;

export type ServiceOrderStandardStatus = (typeof SERVICE_ORDER_STATUSES)[number];

/** Teto do historico de situacao guardado na OS. */
export const SERVICE_ORDER_STATUS_HISTORY_MAX = 100;

const fold = (v: string) =>
  String(v || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[_\s]+/g, ' ')
    .trim();

const ALIASES: Record<string, ServiceOrderStandardStatus> = {
  aberta: 'Em aberto',
  aberto: 'Em aberto',
  'em aberto': 'Em aberto',
  nova: 'Em aberto',
  'em andamento': 'Em andamento',
  andamento: 'Em andamento',
  'aguardando peca': 'Aguardando peça',
  'aguardando pecas': 'Aguardando peça',
  concluida: 'Concluída',
  concluido: 'Concluída',
  finalizada: 'Concluída',
  finalizado: 'Concluída',
  cancelada: 'Cancelada',
  cancelado: 'Cancelada',
};

/** Situacao padrao equivalente ("Aberta"/"ABERTA" => "Em aberto"); situacao desconhecida volta como veio. */
export function normalizeServiceOrderStatus(status: string | null | undefined): string {
  const raw = String(status || '').trim();
  if (!raw) return 'Em aberto';
  return ALIASES[fold(raw)] || raw;
}

export function isStandardServiceOrderStatus(status: string): status is ServiceOrderStandardStatus {
  return (SERVICE_ORDER_STATUSES as readonly string[]).includes(status);
}

/** Opcoes do seletor: as padrao + qualquer outra situacao ja usada nas OS (ex.: vindas do GestaoClick). */
export function serviceOrderStatusOptions(orders: Array<Pick<ErpServiceOrder, 'status'>> = []): string[] {
  const out: string[] = [...SERVICE_ORDER_STATUSES];
  for (const o of orders) {
    const s = normalizeServiceOrderStatus(o?.status);
    if (s && !out.includes(s)) out.push(s);
  }
  return out;
}

/** Coluna do Painel para a situacao: padrao => a propria; outra => "Em aberto". */
export function kanbanColumnForStatus(status: string | null | undefined): ServiceOrderStandardStatus {
  const s = normalizeServiceOrderStatus(status);
  return isStandardServiceOrderStatus(s) ? s : 'Em aberto';
}

/** Proxima acao rapida do card no Painel. */
export function kanbanQuickAction(
  status: string | null | undefined
): { label: string; nextStatus: ServiceOrderStandardStatus } | null {
  switch (kanbanColumnForStatus(status)) {
    case 'Em aberto':
      return { label: 'Iniciar', nextStatus: 'Em andamento' };
    case 'Em andamento':
      return { label: 'Concluir', nextStatus: 'Concluída' };
    case 'Aguardando peça':
      return { label: 'Retomar', nextStatus: 'Em andamento' };
    default:
      return null;
  }
}

/** Agrupa as OS pelas colunas do Painel (todas as colunas existem, mesmo vazias). */
export function groupServiceOrdersByColumn<T extends Pick<ErpServiceOrder, 'status'>>(
  orders: T[]
): Record<ServiceOrderStandardStatus, T[]> {
  const out = Object.fromEntries(SERVICE_ORDER_STATUSES.map((s) => [s, [] as T[]])) as Record<
    ServiceOrderStandardStatus,
    T[]
  >;
  for (const o of orders) out[kanbanColumnForStatus(o.status)].push(o);
  return out;
}

export function todayBr(now: Date = new Date()): string {
  const d = String(now.getDate()).padStart(2, '0');
  const m = String(now.getMonth() + 1).padStart(2, '0');
  return `${d}/${m}/${now.getFullYear()}`;
}

function appendStatusEntry(
  history: ErpServiceOrderStatusEntry[] | undefined,
  entry: ErpServiceOrderStatusEntry
): ErpServiceOrderStatusEntry[] {
  const list = Array.isArray(history) ? history.filter((h) => h && typeof h === 'object') : [];
  return [...list, entry].slice(-SERVICE_ORDER_STATUS_HISTORY_MAX);
}

function entryId(at: string): string {
  return `osst-${Date.parse(at).toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * Troca a situacao e registra no historico. Mesma situacao => nada muda (changed=false).
 * Ao concluir sem data de saida, a data de saida passa a ser hoje.
 */
export function applyServiceOrderStatusChange(
  os: ErpServiceOrder,
  newStatus: string,
  opts: { by: string; at?: string; note?: string }
): { changed: boolean; order: ErpServiceOrder } {
  const to = normalizeServiceOrderStatus(newStatus);
  const from = normalizeServiceOrderStatus(os.status);
  if (!String(newStatus || '').trim() || (to === from && os.status === to)) {
    return { changed: false, order: os };
  }
  const at = opts.at || new Date().toISOString();
  const order: ErpServiceOrder = {
    ...os,
    status: to,
    statusHistory: appendStatusEntry(os.statusHistory, {
      id: entryId(at),
      at,
      by: String(opts.by || 'Sistema STI-hub').slice(0, 120),
      from: String(os.status || ''),
      to,
      ...(opts.note ? { note: String(opts.note).slice(0, 300) } : {}),
    }),
  };
  if (to === 'Concluída' && (!os.exitDate || os.exitDate.trim() === '' || os.exitDate.trim() === '—')) {
    order.exitDate = todayBr(new Date(at));
  }
  return { changed: true, order };
}

/** Proximo numero de OS (maior numero + 1; base igual a do chamado => 1519). */
export function nextServiceOrderCode(orders: Array<Pick<ErpServiceOrder, 'code'>> = []): string {
  const max = orders.reduce((acc, o) => {
    const n = Number(String(o?.code || '').replace(/\D+/g, ''));
    return Number.isFinite(n) && n < 1e9 ? Math.max(acc, n) : acc;
  }, 1518);
  return String(max + 1);
}

export interface DuplicateServiceOrderInput {
  entryDate: string;
  measurementPeriodStart?: string;
  measurementPeriodEnd?: string;
}

/** Valida a entrada da duplicacao: data de emissao obrigatoria; periodo coerente. */
export function validateDuplicateServiceOrderInput(input: Partial<DuplicateServiceOrderInput>): string | null {
  if (!String(input.entryDate || '').trim()) return 'Informe a data de emissão da nova O.S.';
  const s = String(input.measurementPeriodStart || '').trim();
  const e = String(input.measurementPeriodEnd || '').trim();
  if ((s && !e) || (!s && e)) return 'Informe o início e o fim do período da medição.';
  const toKey = (v: string) => {
    const br = v.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (br) return `${br[3]}-${br[2]}-${br[1]}`;
    return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
  };
  if (s && e) {
    const ks = toKey(s);
    const ke = toKey(e);
    if (!ks || !ke) return 'Período da medição inválido (use DD/MM/AAAA).';
    if (ks > ke) return 'O início do período da medição é depois do fim.';
  }
  return null;
}

/**
 * Nova OS copiando tudo da origem (cliente, itens, servicos, valores, observacoes e laudo),
 * com numero novo, situacao inicial "Em aberto", data de emissao e periodo informados.
 * Historicos (situacao e documentos/PDF) NAO sao copiados.
 */
export function duplicateServiceOrder(
  source: ErpServiceOrder,
  input: DuplicateServiceOrderInput & { id: string; code: string; by: string; at?: string }
): ErpServiceOrder {
  const at = input.at || new Date().toISOString();
  const copy = structuredClone(source) as ErpServiceOrder & Record<string, unknown>;
  delete copy.documentHistory;
  delete copy.statusHistory;
  delete copy.gestaoClickId;
  const order: ErpServiceOrder = {
    ...copy,
    id: input.id,
    code: input.code,
    status: 'Em aberto',
    entryDate: String(input.entryDate).trim(),
    exitDate: '',
    measurementPeriodStart: String(input.measurementPeriodStart || '').trim() || undefined,
    measurementPeriodEnd: String(input.measurementPeriodEnd || '').trim() || undefined,
    duplicatedFromId: source.id,
    duplicatedFromCode: source.code,
    statusHistory: [
      {
        id: entryId(at),
        at,
        by: String(input.by || 'Sistema STI-hub').slice(0, 120),
        from: '',
        to: 'Em aberto',
        note: `Criada por duplicação da O.S. #${source.code}`,
      },
    ],
  };
  if (!order.measurementPeriodStart) delete order.measurementPeriodStart;
  if (!order.measurementPeriodEnd) delete order.measurementPeriodEnd;
  return order;
}

/** Substitui a OS na lista local (mesmo id); OS nova entra no topo. */
export function replaceServiceOrderInList(list: ErpServiceOrder[], updated: ErpServiceOrder): ErpServiceOrder[] {
  const idx = list.findIndex((o) => o.id === updated.id);
  if (idx < 0) return [updated, ...list];
  const next = list.slice();
  next[idx] = updated;
  return next;
}

function parseBr(v: string | undefined): Date | null {
  const m = String(v || '').trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Sugestao do proximo periodo de medicao (uso mensal): periodo da OS de origem + 1 mes
 * (mes cheio quando a origem era mes cheio); sem periodo na origem => mes corrente.
 */
export function suggestNextMeasurementPeriod(
  source: Pick<ErpServiceOrder, 'measurementPeriodStart' | 'measurementPeriodEnd'>,
  now: Date = new Date()
): { start: string; end: string } {
  const s = parseBr(source.measurementPeriodStart);
  const e = parseBr(source.measurementPeriodEnd);
  const monthStart = (y: number, m: number) => new Date(y, m, 1);
  const monthEnd = (y: number, m: number) => new Date(y, m + 1, 0);
  if (s && e) {
    const fullMonth = s.getDate() === 1 && e.getDate() === monthEnd(e.getFullYear(), e.getMonth()).getDate();
    if (fullMonth) {
      return { start: todayBr(monthStart(s.getFullYear(), s.getMonth() + 1)), end: todayBr(monthEnd(e.getFullYear(), e.getMonth() + 1)) };
    }
    const shift = (d: Date) => {
      const last = monthEnd(d.getFullYear(), d.getMonth() + 1).getDate();
      return new Date(d.getFullYear(), d.getMonth() + 1, Math.min(d.getDate(), last));
    };
    return { start: todayBr(shift(s)), end: todayBr(shift(e)) };
  }
  return { start: todayBr(monthStart(now.getFullYear(), now.getMonth())), end: todayBr(monthEnd(now.getFullYear(), now.getMonth())) };
}

/**
 * Lista exibida = lista do servidor + gravacoes locais recentes (troca de situacao, nova OS,
 * duplicacao) ainda nao refletidas no recarregamento. A versao do servidor volta a valer
 * assim que tiver o mesmo historico de situacao (ou mais novo).
 */
export function mergeServiceOrderOverrides(
  server: ErpServiceOrder[],
  overrides: Record<string, ErpServiceOrder>
): ErpServiceOrder[] {
  const ids = Object.keys(overrides || {});
  if (ids.length === 0) return server;
  const seen = new Set<string>();
  const merged = server.map((os) => {
    seen.add(os.id);
    const local = overrides[os.id];
    if (!local) return os;
    const serverLen = Array.isArray(os.statusHistory) ? os.statusHistory.length : 0;
    const localLen = Array.isArray(local.statusHistory) ? local.statusHistory.length : 0;
    return serverLen >= localLen && os.status === local.status ? os : local;
  });
  const added = ids.filter((id) => !seen.has(id)).map((id) => overrides[id]);
  return [...added, ...merged];
}
