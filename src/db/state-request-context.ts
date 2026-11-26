// CISO 19/11 (lote 1-b, ressalva c): contexto POR REQUISICAO da carga do crm_state_v1.
// Se a carga do Postgres falhou (ou foi pulada), o estado em memoria e um fallback local
// (arquivo/seed/requisicao anterior) e NUNCA pode ser gravado por cima do banco.
// AsyncLocalStorage isola requisicoes concorrentes na mesma instancia (Fluid compute).
import { AsyncLocalStorage } from 'node:async_hooks';

export interface StateRequestContext {
  /** true = estado desta requisicao veio do Postgres (ou nao ha Postgres); false = bloqueia gravacao. */
  stateLoadOk: boolean;
  /**
   * Perf 25/11: impressao digital (kvPersistFingerprint) do crm_state_v1 como foi carregado NESTA
   * requisicao. So e preenchida nas rotas de abertura/login; zerada depois de qualquer gravacao.
   */
  kvBaselineFingerprint?: string;
  /**
   * CISO 26/11 (Lote 2, 3): compare-and-swap de registro do ERP no JSON. A rota confere a versao e
   * registra aqui; a gravacao confere de novo DENTRO da transacao, com a linha do crm_kv_store travada
   * (SELECT ... FOR UPDATE). Versao diferente no banco => KvRecordVersionConflictError (409), nada gravado.
   */
  recordPreconditions?: KvRecordPrecondition[];
}

export interface KvRecordPrecondition {
  collection: 'serviceOrders' | 'salesOrders';
  id: string;
  expectedVersion: string;
}

const storage = new AsyncLocalStorage<StateRequestContext>();

export function runWithStateRequestContext<T>(ctx: StateRequestContext, fn: () => Promise<T>): Promise<T> {
  return storage.run(ctx, fn);
}

export function currentStateRequestContext(): StateRequestContext | undefined {
  return storage.getStore();
}

export class StateWriteBlockedError extends Error {
  constructor() {
    super('CRM_STATE_WRITE_BLOCKED: a carga do estado nesta requisicao falhou; gravacao recusada.');
    this.name = 'StateWriteBlockedError';
  }
}

/** Lanca se a requisicao atual nao carregou o estado do Postgres com sucesso. */
export function assertStateWriteAllowed(): void {
  const ctx = storage.getStore();
  if (ctx && ctx.stateLoadOk === false) throw new StateWriteBlockedError();
}

export class CrmStateMissingError extends Error {
  constructor() {
    super('CRM_STATE_MISSING: crm_state_v1 ausente/vazio; seed automatico desligado (use cli-migrate).');
    this.name = 'CrmStateMissingError';
  }
}
