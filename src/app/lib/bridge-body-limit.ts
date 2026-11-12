// ============================================================================
// STI-hub — Pacote M (3): teto de corpo no bridge Next (/api/[[...slug]] -> _bridge.ts).
// - content-length conferido ANTES de ler (413 imediato);
// - stream lido com teto e cancelamento (sem content-length ou com valor falso);
// - so depois o JSON e interpretado (nunca req.json() sem teto).
// Padrao: 1 MiB. Rotas autenticadas que recebem arquivo ou o journal local tem teto maior
// (lista explicita abaixo), e o teto maior so vale com sessao assinada valida.
// ============================================================================

export const BRIDGE_MAX_BODY_BYTES = 1024 * 1024; // 1 MiB
export const BRIDGE_LARGE_BODY_BYTES = 4 * 1024 * 1024; // 4 MiB (abaixo dos ~4,5 MB da Vercel)

/**
 * Rotas com teto maior (POST, sessao assinada obrigatoria para o teto maior):
 * - /api/bootstrap: envia o journal local do navegador (reconcileJournal), sem limite de tamanho no cliente;
 * - /api/erp/purchases/import-xml e /api/erp/nfe-importacao/emit: XML/TXT de NF-e (NF-e com muitos itens passa de 1 MiB);
 * - /api/erp/financial/reconcile-ofx: extrato OFX (um ano de movimento pode passar de 1 MiB);
 * - /api/erp/financial/import-document: PDF (base64) ou XML de fatura/boleto/NF-e da conciliação (até 3 MB);
 * - /api/mailbox/send: anexos do e-mail do CRM (base64 no JSON). O teto maior só vale com sessão.
 */
export const BRIDGE_LARGE_BODY_ROUTES: ReadonlyArray<{ method: string; path: string }> = Object.freeze([
  { method: 'POST', path: '/api/bootstrap' },
  { method: 'POST', path: '/api/erp/purchases/import-xml' },
  { method: 'POST', path: '/api/erp/nfe-importacao/emit' },
  { method: 'POST', path: '/api/erp/financial/reconcile-ofx' },
  { method: 'POST', path: '/api/erp/financial/import-document' },
  { method: 'POST', path: '/api/mailbox/send' },
]);

export function isLargeBodyRoute(method: string, path: string): boolean {
  const m = String(method || '').toUpperCase();
  const p = String(path || '').replace(/\/+$/, '').toLowerCase();
  return BRIDGE_LARGE_BODY_ROUTES.some((r) => r.method === m && r.path === p);
}

export type CappedBodyResult =
  | { ok: true; text: string; bytes: number }
  | { ok: false; reason: 'TOO_LARGE'; bytes: number };

/** Le o corpo com teto de bytes. Nunca le mais que maxBytes (+1 chunk) e cancela o stream ao estourar. */
export async function readBodyWithCap(req: Request, maxBytes: number): Promise<CappedBodyResult> {
  const declared = req.headers.get('content-length');
  if (declared !== null && declared.trim() !== '') {
    const n = Number(declared);
    if (Number.isFinite(n) && n > maxBytes) return { ok: false, reason: 'TOO_LARGE', bytes: n };
  }
  if (!req.body) return { ok: true, text: '', bytes: 0 };
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        try {
          await reader.cancel('BODY_TOO_LARGE');
        } catch {
          // stream ja encerrado
        }
        return { ok: false, reason: 'TOO_LARGE', bytes: total };
      }
      chunks.push(value);
    }
  } catch {
    // erro de leitura (cliente abortou) => corpo vazio, como o req.json() com catch anterior
    return { ok: true, text: '', bytes: total };
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // ignore
    }
  }
  const buf = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    buf.set(c, off);
    off += c.byteLength;
  }
  return { ok: true, text: new TextDecoder('utf-8').decode(buf), bytes: total };
}

/** Mesmo comportamento do antigo `await req.json()` com catch: vazio ou invalido => {}. */
export function parseJsonBodyLenient(text: string): unknown {
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

export const BODY_TOO_LARGE_RESPONSE_BODY = Object.freeze({
  error: 'Corpo da requisição acima do limite permitido.',
  code: 'BODY_TOO_LARGE',
});
