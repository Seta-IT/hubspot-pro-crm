// Rotas /api/erp/proposal-note-defaults — textos padrão de observações comerciais/fiscais.
// O prefixo /api/erp/ já exige o módulo ERP no gate do router.
import {
  isProposalNoteDefaultTypeKey,
  mergeProposalNoteDefaults,
  PROPOSAL_NOTE_DEFAULT_TYPE_KEYS,
  type ProposalNoteDefaultsMap,
} from '../app/lib/proposal-note-defaults';
import {
  getDefaultProposalNoteDefaultsStore,
  loadProposalNoteDefaults,
  type ProposalNoteDefaultsStore,
} from '../modules/erp/proposal-note-defaults-store';

export const PROPOSAL_NOTE_DEFAULTS_PATH = '/api/erp/proposal-note-defaults';

type ApiResponse = { status: number; body: unknown; headers?: Record<string, string> };

export function isProposalNoteDefaultsRoute(cleanPath: string): boolean {
  return cleanPath === PROPOSAL_NOTE_DEFAULTS_PATH;
}

export async function handleProposalNoteDefaultsRoute(
  method: string,
  body: Record<string, unknown>,
  updatedBy?: string | null,
  store: ProposalNoteDefaultsStore = getDefaultProposalNoteDefaultsStore()
): Promise<ApiResponse> {
  if (method === 'GET') {
    const data = await loadProposalNoteDefaults(store);
    return { status: 200, body: { data } };
  }

  if (method === 'PUT' || method === 'PATCH') {
    const patch: Partial<ProposalNoteDefaultsMap> = {};
    const source = (body.data && typeof body.data === 'object' ? body.data : body) as Record<string, unknown>;
    for (const key of Object.keys(source)) {
      if (!isProposalNoteDefaultTypeKey(key)) {
        return {
          status: 400,
          body: { error: `Tipo inválido: ${key}.`, code: 'PROPOSAL_NOTE_DEFAULT_TYPE_INVALID' },
        };
      }
      if (typeof source[key] !== 'string') {
        return {
          status: 400,
          body: { error: `Informe o texto de ${key} como texto.`, code: 'PROPOSAL_NOTE_DEFAULT_INVALID' },
        };
      }
      patch[key] = source[key] as string;
    }
    if (!PROPOSAL_NOTE_DEFAULT_TYPE_KEYS.some((k) => patch[k] !== undefined)) {
      return {
        status: 400,
        body: { error: 'Informe ao menos um tipo para salvar.', code: 'PROPOSAL_NOTE_DEFAULT_EMPTY' },
      };
    }
    try {
      const data = await store.save(patch, updatedBy);
      return { status: 200, body: { data: mergeProposalNoteDefaults(data) } };
    } catch (err) {
      const code = (err as { code?: string }).code || 'PROPOSAL_NOTE_DEFAULT_ERROR';
      const status = code === 'PROPOSAL_NOTE_DEFAULT_TOO_LONG' ? 400 : 500;
      return {
        status,
        body: {
          error: status === 400 && err instanceof Error ? err.message : 'Não foi possível salvar as observações padrão.',
          code: status === 500 ? 'PROPOSAL_NOTE_DEFAULT_ERROR' : code,
        },
      };
    }
  }

  return { status: 405, body: { error: 'Método não permitido.', code: 'METHOD_NOT_ALLOWED' } };
}
