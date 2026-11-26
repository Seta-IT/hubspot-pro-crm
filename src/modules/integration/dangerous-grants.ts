// ============================================================================
// CISO 26/11 (Lote 3, item 2): escopo PERIGOSO via OAuth so com confirmacao do IAM
// (confirmDangerousScopes) para o cliente ou para o usuario — e NUNCA para cliente DCR nao verificado.
//  - cliente verificado = registro subject_type='client' ativo com client_verified=true;
//  - escopos liberados = escopos confirmados do cliente UNIAO escopos confirmados do usuario;
//  - tabela ausente (migracao manual nao aplicada) ou erro => nada liberado (falha fechada).
// Conferido no consentimento E a cada chamada perigosa (revogacao no IAM vale na hora).
// ============================================================================
import { LOTE3_DANGEROUS_SCOPES } from './scopes';
import type { IntegrationStore } from './store';

export async function iamConfirmedDangerousScopes(store: IntegrationStore | null | undefined, clientId: string | null | undefined, userId: string): Promise<Set<string>> {
  const out = new Set<string>();
  if (!store || !clientId) return out;
  try {
    const c = await store.getDangerousScopeConfirmation('client', clientId);
    if (!c || c.revokedAt || !c.clientVerified) return out; // DCR nao verificado => sempre nega
    for (const s of c.scopes) if (LOTE3_DANGEROUS_SCOPES.has(s)) out.add(s);
    const u = await store.getDangerousScopeConfirmation('user', userId);
    if (u && !u.revokedAt) for (const s of u.scopes) if (LOTE3_DANGEROUS_SCOPES.has(s)) out.add(s);
    return out;
  } catch {
    return new Set();
  }
}
