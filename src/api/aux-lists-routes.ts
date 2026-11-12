// Rotas /api/erp/aux-lists — centros de custo e planos de contas no banco.
// O prefixo /api/erp/ já exige o módulo ERP no gate do router.
import type { CrmRepository } from '../db/repository';
import {
  auxUsageTotal,
  countAuxOptionUsage,
  formatAuxOptionUsageText,
  type AuxUsageKind,
  type AuxUsageSources,
} from '../modules/erp/aux-option-usage';
import {
  getDefaultAuxListsStore,
  groupAuxListItems,
  isAuxListKind,
  loadAuxListsOrSeed,
  type AuxListKind,
  type AuxListItem,
  type AuxListsStore,
} from '../modules/erp/aux-lists-store';

export const AUX_LISTS_PATH = '/api/erp/aux-lists';

type Query = Record<string, string | undefined>;
type Ctx = { trustedInternal?: boolean; serviceAccount?: boolean };
type ApiResponse = { status: number; body: unknown; headers?: Record<string, string> };

export function isAuxListsRoute(cleanPath: string): boolean {
  return cleanPath === AUX_LISTS_PATH || cleanPath.startsWith(`${AUX_LISTS_PATH}/`);
}

export function collectAuxUsageSources(repo: CrmRepository): AuxUsageSources {
  const erp = repo.getState().erp;
  return {
    contracts: repo.listRentalContracts(),
    proposals: repo.listProposals(),
    invoices: repo.listInvoices(),
    financialEntries: repo.listFinancialEntries(),
    purchaseOrders: erp?.purchaseOrders || [],
  };
}

function storeError(err: unknown): ApiResponse {
  const code = (err as { code?: string }).code || 'AUX_LIST_ERROR';
  const error = err instanceof Error ? err.message : 'Não foi possível atualizar a lista.';
  const status = code === 'AUX_LIST_DUPLICATE' ? 409 : code === 'AUX_LIST_LABEL_REQUIRED' || code === 'AUX_LIST_LABEL_INVALID' ? 400 : 500;
  return { status, body: { error, code } };
}

function itemPayload(item: AuxListItem) {
  return { id: item.id, kind: item.kind, label: item.label, sortOrder: item.sortOrder };
}

export async function handleAuxListsRoute(
  repo: CrmRepository,
  method: string,
  cleanPath: string,
  _query: Query,
  body: Record<string, unknown>,
  _ctx: Ctx,
  store: AuxListsStore = getDefaultAuxListsStore()
): Promise<ApiResponse> {
  const itemMatch = cleanPath.match(/^\/api\/erp\/aux-lists\/([^/]+)$/);
  const itemId = itemMatch ? decodeURIComponent(itemMatch[1]) : '';

  if (cleanPath === AUX_LISTS_PATH && method === 'GET') {
    const lists = await loadAuxListsOrSeed(store);
    return {
      status: 200,
      body: {
        data: {
          costCenters: lists.costCenters.map(itemPayload),
          chartOfAccountsList: lists.chartOfAccountsList.map(itemPayload),
        },
      },
    };
  }

  if (cleanPath === AUX_LISTS_PATH && method === 'POST') {
    const kindRaw = body.kind;
    const label = body.label;
    if (!isAuxListKind(kindRaw)) {
      return { status: 400, body: { error: 'Informe o tipo da lista (costCenters ou chartOfAccountsList).', code: 'AUX_LIST_KIND_INVALID' } };
    }
    try {
      const created = await store.create(kindRaw, String(label ?? ''));
      return { status: 201, body: { data: itemPayload(created) } };
    } catch (err) {
      return storeError(err);
    }
  }

  if (itemId && (method === 'PATCH' || method === 'PUT')) {
    try {
      const updated = await store.update(itemId, String(body.label ?? ''));
      if (!updated) return { status: 404, body: { error: 'Item não encontrado.', code: 'AUX_LIST_NOT_FOUND' } };
      return { status: 200, body: { data: itemPayload(updated) } };
    } catch (err) {
      return storeError(err);
    }
  }

  if (itemId && method === 'DELETE') {
    const items = await store.list();
    const current = items.find((i) => i.id === itemId);
    if (!current) return { status: 404, body: { error: 'Item não encontrado.', code: 'AUX_LIST_NOT_FOUND' } };
    const usageKind = current.kind as AuxUsageKind;
    const usage = countAuxOptionUsage(usageKind, current.label, collectAuxUsageSources(repo));
    if (auxUsageTotal(usage) > 0) {
      return {
        status: 409,
        body: {
          error: formatAuxOptionUsageText(usageKind, usage),
          code: 'AUX_LIST_IN_USE',
          usage,
        },
      };
    }
    const deleted = await store.delete(itemId);
    if (!deleted) return { status: 404, body: { error: 'Item não encontrado.', code: 'AUX_LIST_NOT_FOUND' } };
    return { status: 200, body: { success: true, deletedId: itemId } };
  }

  return { status: 405, body: { error: 'Método não permitido.', code: 'METHOD_NOT_ALLOWED' } };
}

export function labelsFromAuxLists(kind: AuxListKind, items: AuxListItem[]): string[] {
  return groupAuxListItems(items)[kind].map((i) => i.label);
}
