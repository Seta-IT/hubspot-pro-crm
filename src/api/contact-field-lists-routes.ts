// Rotas /api/crm/contact-field-lists — Posição e Área (listas auxiliares reutilizadas).
import {
  CONTACT_DEPARTMENT_KIND,
  CONTACT_POSITION_KIND,
  DEFAULT_CONTACT_DEPARTMENTS,
  DEFAULT_CONTACT_POSITIONS,
  isContactFieldListKind,
  type ContactFieldListKind,
} from '../app/lib/contact-field-lists';
import {
  AUX_LABEL_MAX_LEN,
  getDefaultAuxListsStore,
  seedItemsForKind,
  type AuxListItem,
  type AuxListsStore,
} from '../modules/erp/aux-lists-store';

export const CONTACT_FIELD_LISTS_PATH = '/api/crm/contact-field-lists';
export const CONTACT_FIELD_LIST_MAX_ITEMS = 300;

type Query = Record<string, string | undefined>;
type Ctx = { trustedInternal?: boolean; serviceAccount?: boolean };
type ApiResponse = { status: number; body: unknown; headers?: Record<string, string> };

export function isContactFieldListsRoute(cleanPath: string): boolean {
  return cleanPath === CONTACT_FIELD_LISTS_PATH || cleanPath.startsWith(`${CONTACT_FIELD_LISTS_PATH}/`);
}

function storeError(err: unknown): ApiResponse {
  const code = (err as { code?: string }).code || 'AUX_LIST_ERROR';
  const status =
    code === 'AUX_LIST_DUPLICATE' || code === 'AUX_LIST_LIMIT'
      ? 409
      : code === 'AUX_LIST_LABEL_REQUIRED' || code === 'AUX_LIST_LABEL_INVALID' || code === 'AUX_LIST_REORDER_INVALID'
        ? 400
        : 500;
  const error = status !== 500 && err instanceof Error ? err.message : 'Não foi possível atualizar a lista.';
  return { status, body: { error, code: status === 500 ? 'AUX_LIST_ERROR' : code } };
}

function itemPayload(item: AuxListItem) {
  return { id: item.id, kind: item.kind, label: item.label, sortOrder: item.sortOrder, active: item.active !== false };
}

async function listsOrSeed(store: AuxListsStore, includeInactive: boolean) {
  const [positions, departments] = await Promise.all([
    store.list(CONTACT_POSITION_KIND, { includeInactive }),
    store.list(CONTACT_DEPARTMENT_KIND, { includeInactive }),
  ]);
  return {
    contactPosition: positions.length ? positions : seedItemsForKind(CONTACT_POSITION_KIND),
    contactDepartment: departments.length ? departments : seedItemsForKind(CONTACT_DEPARTMENT_KIND),
  };
}

export async function handleContactFieldListsRoute(
  method: string,
  cleanPath: string,
  _query: Query,
  body: Record<string, unknown>,
  _ctx: Ctx,
  store: AuxListsStore = getDefaultAuxListsStore()
): Promise<ApiResponse> {
  const itemMatch = cleanPath.match(/^\/api\/crm\/contact-field-lists\/([^/]+)$/);
  const itemId = itemMatch ? decodeURIComponent(itemMatch[1]) : '';

  if (cleanPath === CONTACT_FIELD_LISTS_PATH && method === 'GET') {
    const includeInactive = String(_query.includeInactive || '') === '1' || String(_query.includeInactive || '') === 'true';
    const lists = await listsOrSeed(store, includeInactive);
    const map = (rows: AuxListItem[]) => rows.filter((i) => includeInactive || i.active !== false).map(itemPayload);
    return {
      status: 200,
      body: {
        data: {
          contactPosition: map(lists.contactPosition),
          contactDepartment: map(lists.contactDepartment),
          defaults: {
            contactPosition: [...DEFAULT_CONTACT_POSITIONS],
            contactDepartment: [...DEFAULT_CONTACT_DEPARTMENTS],
          },
        },
      },
    };
  }

  if (cleanPath === `${CONTACT_FIELD_LISTS_PATH}/reorder` && method === 'POST') {
    if (!isContactFieldListKind(body.kind)) {
      return { status: 400, body: { error: 'Informe o tipo da lista (contactPosition ou contactDepartment).', code: 'AUX_LIST_KIND_INVALID' } };
    }
    const ids = Array.isArray(body.ids) ? body.ids.map((id) => String(id)) : [];
    if (!ids.length) {
      return { status: 400, body: { error: 'Informe a nova ordem dos itens.', code: 'AUX_LIST_REORDER_INVALID' } };
    }
    try {
      const rows = await store.reorder(body.kind, ids);
      return { status: 200, body: { data: rows.map(itemPayload) } };
    } catch (err) {
      return storeError(err);
    }
  }

  if (cleanPath === CONTACT_FIELD_LISTS_PATH && method === 'POST') {
    if (!isContactFieldListKind(body.kind)) {
      return { status: 400, body: { error: 'Informe o tipo da lista (contactPosition ou contactDepartment).', code: 'AUX_LIST_KIND_INVALID' } };
    }
    if (typeof body.label !== 'string') {
      return { status: 400, body: { error: 'Informe o nome do item.', code: 'AUX_LIST_LABEL_REQUIRED' } };
    }
    try {
      const existing = await store.list(body.kind as ContactFieldListKind, { includeInactive: true });
      if (existing.length >= CONTACT_FIELD_LIST_MAX_ITEMS) {
        return { status: 409, body: { error: `A lista pode ter no máximo ${CONTACT_FIELD_LIST_MAX_ITEMS} itens.`, code: 'AUX_LIST_LIMIT' } };
      }
      const created = await store.create(body.kind, body.label);
      return { status: 201, body: { data: itemPayload(created) } };
    } catch (err) {
      return storeError(err);
    }
  }

  if (itemId && (method === 'PATCH' || method === 'PUT')) {
    try {
      const patch: { label?: string; active?: boolean } = {};
      if (body.label !== undefined) patch.label = String(body.label);
      if (typeof body.active === 'boolean') patch.active = body.active;
      if (patch.label === undefined && patch.active === undefined) {
        return { status: 400, body: { error: 'Informe o nome ou o status do item.', code: 'AUX_LIST_LABEL_REQUIRED' } };
      }
      const updated = await store.update(itemId, patch);
      if (!updated) return { status: 404, body: { error: 'Item não encontrado.', code: 'AUX_LIST_NOT_FOUND' } };
      if (!isContactFieldListKind(updated.kind)) {
        return { status: 404, body: { error: 'Item não encontrado.', code: 'AUX_LIST_NOT_FOUND' } };
      }
      return { status: 200, body: { data: itemPayload(updated) } };
    } catch (err) {
      return storeError(err);
    }
  }

  return { status: 405, body: { error: 'Método não permitido.', code: 'METHOD_NOT_ALLOWED' } };
}

export const CONTACT_FIELD_LABEL_MAX = AUX_LABEL_MAX_LEN;
