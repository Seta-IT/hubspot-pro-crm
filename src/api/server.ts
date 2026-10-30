// ============================================================================
// HubSpot Pro CRM - Standalone Node.js HTTP Server (Fallback / Direct API Host)
// ============================================================================

import http from 'node:http';
import { BRIDGE_RESERVED_KEYS, CrmApiRouter } from './router';

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

    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
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

    // Pacote A (29/10): o servidor standalone e um canal HTTP como o bridge do Next. Nada de
    // chaves internas vindas do cliente (query/corpo); sessao so pelo header x-stihub-session.
    const reqUrl = new URL(req.url || '/', 'http://localhost');
    const query: Record<string, string | undefined> = {};
    reqUrl.searchParams.forEach((v, k) => {
      if (!k.startsWith('_')) query[k] = v;
    });
    const sessionHeader = req.headers['x-stihub-session'];
    const sessionToken = Array.isArray(sessionHeader) ? sessionHeader[0] : sessionHeader;
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
