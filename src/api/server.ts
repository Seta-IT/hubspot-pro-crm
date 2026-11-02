// ============================================================================
// HubSpot Pro CRM - Standalone Node.js HTTP Server (Fallback / Direct API Host)
// ============================================================================

import http from 'node:http';
import { BRIDGE_RESERVED_KEYS, CrmApiRouter } from './router';
import { requestBodyCapFor } from '../app/lib/request-body-cap';

const ALLOWED_CORS_ORIGINS = new Set([
  'https://sti-hub.vercel.app',
  'https://stihub.setatelecom.com.br',
  'https://erp.setatelecom.com.br',
  'http://localhost:3000',
  'http://localhost:3001',
  'http://127.0.0.1:3000',
]);

export function createCrmHttpServer(router = new CrmApiRouter()) {
  return http.createServer(async (req, res) => {
    const reqOrigin = req.headers.origin || '';
    const allowedOrigin = ALLOWED_CORS_ORIGINS.has(reqOrigin)
      ? reqOrigin
      : 'https://sti-hub.vercel.app';
    res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-stihub-session');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // Pacote A (29/10): o servidor standalone e um canal HTTP como o bridge do Next. Nada de
    // chaves internas vindas do cliente (query/corpo); sessao so pelo header x-stihub-session.
    const reqUrl = new URL(req.url || '/', 'http://localhost');
    const sessionHeader = req.headers['x-stihub-session'];
    const sessionToken = Array.isArray(sessionHeader) ? sessionHeader[0] : sessionHeader;
    // B-V4-1 + rebase v5 (pacote M): teto pela mesma regra do bridge (4 MiB so nas rotas grandes
    // com sessao assinada valida; 1 MiB no resto) => 413 antes de ler o resto/parsear/redigir.
    const maxBytes = requestBodyCapFor(req.method || 'GET', reqUrl.pathname, sessionToken);
    const tooLarge = () => {
      res.writeHead(413, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'Corpo da requisição acima do limite permitido.', code: 'BODY_TOO_LARGE', maxBytes }));
    };
    const declaredLen = Number(req.headers['content-length'] || '0');
    if (!Number.isFinite(declaredLen) || declaredLen > maxBytes) {
      tooLarge();
      req.destroy();
      return;
    }
    const chunks: Buffer[] = [];
    let readBytes = 0;
    for await (const chunk of req) {
      const b = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      readBytes += b.length;
      if (readBytes > maxBytes) {
        tooLarge();
        req.destroy();
        return;
      }
      chunks.push(b);
    }
    const rawBody = Buffer.concat(chunks).toString('utf-8');
    let parsedBody: unknown = {};
    if (rawBody.trim()) {
      try {
        parsedBody = JSON.parse(rawBody);
      } catch {
        parsedBody = {};
      }
    }

    const query: Record<string, string | undefined> = {};
    reqUrl.searchParams.forEach((v, k) => {
      if (!k.startsWith('_')) query[k] = v;
    });
    if (sessionToken) query._sessionToken = sessionToken;
    query._fromHttpBridge = '1';
    const cleanBody =
      parsedBody && typeof parsedBody === 'object' && !Array.isArray(parsedBody)
        ? Object.fromEntries(
            Object.entries(parsedBody as Record<string, unknown>).filter(
              ([k]) => !(BRIDGE_RESERVED_KEYS as readonly string[]).includes(k)
            )
          )
        : parsedBody;
    const response = await router.dispatch({
      method: req.method || 'GET',
      path: reqUrl.pathname,
      query,
      body: cleanBody,
      bodyBytes: readBytes,
    });

    res.writeHead(response.status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(response.body));
  });
}

if (require.main === module) {
  const port = Number(process.env.PORT || 3001);
  const server = createCrmHttpServer();
  server.listen(port, () => {
    console.log(`[HubSpot Pro CRM API] Rodando em http://localhost:${port}`);
  });
}
