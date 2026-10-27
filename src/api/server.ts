// ============================================================================
// HubSpot Pro CRM - Standalone Node.js HTTP Server (Fallback / Direct API Host)
// ============================================================================

import http from 'node:http';
import { CrmApiRouter } from './router';

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

    const response = await router.dispatch({
      method: req.method || 'GET',
      path: req.url || '/',
      body: parsedBody,
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
