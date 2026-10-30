// ============================================================================
// STI-hub - Cache IAM do navegador: o registro selado mais recente vence
// ----------------------------------------------------------------------------
// Sem Postgres/KV duravel em producao, o navegador guarda registros IAM selados
// (iamSeal) e os reenvia ao servidor. Esta camada impede que uma resposta com
// homeScreen mais antigo (ex.: instancia fria) apague do cache um registro cujo
// homeScreen e mais novo. Nao altera src/app/lib/auth.ts: usa as funcoes dele.
//
// Como o selo e opaco no navegador, quando o registro recebido traz homeScreen
// mais antigo que o do cache, os dois sao mantidos na ordem [anterior, recebido].
// O servidor aplica os selos nessa ordem e, campo a campo, a versao de homeScreen
// mais nova vence (repository.applySealedIamOverrides); a proxima resposta ja vem
// com o registro consolidado e o cache volta a ter uma entrada por usuario.
// ============================================================================
import {
  CLIENT_IAM_CREDENTIAL_KEYS,
  loadClientIamUsersOverride,
  saveClientIamUserOverride,
  STIHUB_IAM_USERS_STORAGE_KEY,
} from './auth';

type IamCacheEntry = Record<string, unknown>;

const NEVER_CACHED_KEYS = CLIENT_IAM_CREDENTIAL_KEYS; // Pacote E: lista unica (auth.ts)

export function homeScreenVersionOf(entry: IamCacheEntry | null | undefined): number {
  if (!entry) return 0;
  return Date.parse(String(entry.homeScreenUpdatedAt || '')) || 0;
}

function sameUser(a: IamCacheEntry, b: IamCacheEntry): boolean {
  const idA = String(a.id || '');
  const idB = String(b.id || '');
  if (idA && idB) return idA === idB;
  const eA = String(a.email || '').toLowerCase();
  const eB = String(b.email || '').toLowerCase();
  return !!eA && eA === eB;
}

function safeEntry(user: IamCacheEntry): IamCacheEntry {
  const out: IamCacheEntry = { ...user };
  for (const k of NEVER_CACHED_KEYS) delete out[k];
  return out;
}

/**
 * Regra pura. Devolve a nova lista do cache e se o recebido substituiu o anterior
 * ('REPLACED') ou se o anterior, com homeScreen mais novo, foi preservado antes dele ('KEPT_NEWER').
 */
export function mergeIamCacheEntries(
  current: IamCacheEntry[],
  incoming: IamCacheEntry
): { entries: IamCacheEntry[]; result: 'REPLACED' | 'KEPT_NEWER' } {
  const mine = current.filter((u) => sameUser(u, incoming));
  const others = current.filter((u) => !sameUser(u, incoming));
  const newest = mine.reduce<IamCacheEntry | null>(
    (best, u) => (!best || homeScreenVersionOf(u) > homeScreenVersionOf(best) ? u : best),
    null
  );
  const inc = safeEntry(incoming);
  if (!newest || homeScreenVersionOf(inc) >= homeScreenVersionOf(newest)) {
    return { entries: [inc, ...others].slice(0, 50), result: 'REPLACED' };
  }
  return { entries: [newest, inc, ...others].slice(0, 50), result: 'KEPT_NEWER' };
}

/** Grava no cache IAM do navegador sem deixar um homeScreen antigo substituir um mais novo. */
export function saveClientIamUserOverrideIfNewer(user: IamCacheEntry | null | undefined): void {
  if (typeof window === 'undefined' || !user || typeof user !== 'object') return;
  try {
    const { entries, result } = mergeIamCacheEntries(loadClientIamUsersOverride(), user);
    if (result === 'REPLACED') {
      saveClientIamUserOverride(safeEntry(user));
      return;
    }
    window.localStorage.setItem(STIHUB_IAM_USERS_STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // armazenamento indisponivel
  }
}
