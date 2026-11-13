// ============================================================================
// STI-hub — destino pos-login (?next=) restrito a MESMA ORIGEM (anti open redirect).
// Rejeita: protocol-relative (//evil.com), barra invertida (/\evil.com, \\evil.com),
// caracteres de controle/espaco (/\t/evil.com), URLs absolutas, e as proprias telas de
// login/convite (loop). Qualquer rejeicao cai no fallback seguro "/".
// ============================================================================

const SAFE_PATH_START = /^\/(?:[^/\\]|$)/;
// eslint-disable-next-line no-control-regex
const CONTROL_OR_SPACE = /[\u0000-\u0020\u007f-\u009f\u2028\u2029]/;
const DUMMY_ORIGIN = 'https://dummy.local';

export function sanitizeLoginNext(raw: string | null | undefined, fallback = '/'): string {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 2048) return fallback;
  if (!SAFE_PATH_START.test(raw)) return fallback;
  if (raw.includes('\\') || CONTROL_OR_SPACE.test(raw)) return fallback;
  let resolved: URL;
  try {
    resolved = new URL(raw, DUMMY_ORIGIN);
  } catch {
    return fallback;
  }
  if (resolved.origin !== DUMMY_ORIGIN) return fallback;
  // Protocol-relative escondido por percent-encoding (/%2F%2Fevil.com, /%5Cevil.com) tambem sai.
  let decodedPath = resolved.pathname;
  try {
    decodedPath = decodeURIComponent(resolved.pathname);
  } catch {
    return fallback;
  }
  if (decodedPath.startsWith('//') || decodedPath.includes('\\')) return fallback;
  const path = resolved.pathname.toLowerCase();
  if (path === '/login' || path.startsWith('/login/') || path === '/convite' || path.startsWith('/convite/')) return fallback;
  return `${resolved.pathname}${resolved.search}${resolved.hash}`;
}
