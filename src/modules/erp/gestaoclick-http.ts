// Cliente HTTP do GestaoClick: somente GET (direcao GC > STI-hub).
// Qualquer POST, PUT, PATCH, DELETE ou outro metodo e recusado com erro
// explicito, sem chamada de rede.

export const GESTAOCLICK_READ_ONLY_CODE = 'GESTAOCLICK_READ_ONLY';

export class GestaoClickReadOnlyError extends Error {
  readonly code = GESTAOCLICK_READ_ONLY_CODE;
  readonly method: string;

  constructor(method: string) {
    const normalized = String(method || '').trim().toUpperCase() || 'UNKNOWN';
    super(
      `GestaoClick e somente leitura no STI-hub (direcao GC > STI-hub). O metodo ${normalized} foi recusado e nenhuma chamada de rede foi feita.`
    );
    this.name = 'GestaoClickReadOnlyError';
    this.method = normalized;
  }
}

export function normalizeHttpMethod(method?: string | null): string {
  const m = String(method || 'GET').trim().toUpperCase();
  return m || 'GET';
}

export function assertGestaoClickReadOnlyMethod(method?: string | null): void {
  const normalized = normalizeHttpMethod(method);
  if (normalized !== 'GET') {
    throw new GestaoClickReadOnlyError(normalized);
  }
}

export function resolveGestaoClickRequestMethod(
  input: RequestInfo | URL,
  init?: RequestInit
): string {
  if (init?.method != null && String(init.method).trim() !== '') {
    return normalizeHttpMethod(init.method);
  }
  if (typeof Request !== 'undefined' && input instanceof Request) {
    return normalizeHttpMethod(input.method);
  }
  return 'GET';
}

export async function gestaoClickFetch(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  assertGestaoClickReadOnlyMethod(resolveGestaoClickRequestMethod(input, init));
  return fetch(input, { ...init, method: 'GET' });
}
