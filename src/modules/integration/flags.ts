// ============================================================================
// STI-hub — API v1/MCP: flags do parecer do CISO de 26/11/2026 (Lote 3). Todas DESLIGADAS por padrao.
//
//  INTEGRATION_ENABLE_DANGEROUS_COMMITS=1  libera os *_commit das operacoes perigosas. Desligada: so os
//                                          *_prepare existem (previa); o commit responde 404 OPERATION_DISABLED.
//  INTEGRATION_ENABLE_FISCAL_OPS=1         libera as operacoes fiscais (emitir, remessa, faturar/reservar
//                                          numeracao, NF-e de importacao, cancelar/excluir documento).
//                                          Desligada: nada fiscal existe (fora do tools/list, OpenAPI, REST,
//                                          escopos anunciados e allowlist interna).
// ============================================================================
import { INTEGRATION_SCOPES, type IntegrationScope } from './scopes';

export const DANGEROUS_COMMITS_FLAG = 'INTEGRATION_ENABLE_DANGEROUS_COMMITS';
export const FISCAL_OPS_FLAG = 'INTEGRATION_ENABLE_FISCAL_OPS';

export function dangerousCommitsEnabled(): boolean {
  return process.env[DANGEROUS_COMMITS_FLAG] === '1';
}
export function fiscalOpsEnabled(): boolean {
  return process.env[FISCAL_OPS_FLAG] === '1';
}

/** Escopos fiscais: toda tool com um deles e operacao fiscal (atras de INTEGRATION_ENABLE_FISCAL_OPS). */
export const FISCAL_SCOPES: ReadonlySet<string> = new Set(['erp:fiscal:issue', 'erp:fiscal:cancel']);
export function isFiscalScope(s: string): boolean {
  return FISCAL_SCOPES.has(s);
}

/** Escopos anunciados (OpenAPI, metadados OAuth, consentimento): sem os fiscais quando a flag esta desligada. */
export function exposedScopes(): IntegrationScope[] {
  return fiscalOpsEnabled() ? [...INTEGRATION_SCOPES] : INTEGRATION_SCOPES.filter((s) => !isFiscalScope(s));
}

const ID = '[A-Za-z0-9._-]{1,80}';
/** Rotas internas fiscais (defesa em profundidade no data-port): desligada => recusadas. */
const FISCAL_ROUTES: Array<{ method: string; re: RegExp }> = [
  { method: 'POST', re: /^\/api\/erp\/invoices$/ },
  { method: 'POST', re: new RegExp(`^/api/erp/rental-contracts/${ID}/(generate-invoice|generate-remessa|partial-return)$`) },
  { method: 'POST', re: /^\/api\/erp\/rental-contracts\/batch-billing$/ },
  { method: 'POST', re: /^\/api\/erp\/nfe-importacao\/(calculate|emit)$/ },
  { method: 'PATCH', re: new RegExp(`^/api/erp/invoices/${ID}$`) },
  { method: 'DELETE', re: new RegExp(`^/api/erp/invoices/${ID}$`) },
];
export function isFiscalRoute(method: string, path: string): boolean {
  return FISCAL_ROUTES.some((r) => r.method === method && r.re.test(path));
}
