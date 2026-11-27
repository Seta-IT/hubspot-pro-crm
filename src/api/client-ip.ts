// ============================================================================
// Pacote G (5c) + preparacao Cloud Run: IP do cliente para rate-limit/auditoria.
//
// TRUSTED_PROXY_MODE (ver src/lib/platform.ts):
//   vercel   — x-vercel-forwarded-for, depois x-real-ip. X-Forwarded-For e ignorado
//              (o cliente pode forjar a parte esquerda). Compativel com VERCEL=1.
//   cloudrun — SOMENTE X-Forwarded-For, entrada contada a partir da DIREITA pelo
//              numero de proxies confiaveis (TRUSTED_PROXY_HOPS, padrao 1).
//              O Google Front End acrescenta o IP do par TCP no final. A primeira
//              entrada e controlada pelo cliente e nunca e usada. Nunca confia em
//              X-Real-IP nem em outro cabecalho forjavel.
//   none     — nenhum cabecalho de proxy e confiavel (fail-closed => undefined;
//              o chamador usa o balde 'sem-ip').
// ============================================================================
import { resolveTrustedProxyHops, resolveTrustedProxyMode, type TrustedProxyMode } from '../lib/platform';

type HeaderGetter = { get(name: string): string | null };

const IP_RE = /^[0-9a-fA-F:.]{2,64}$/;

function firstIp(v: string | null | undefined): string | undefined {
  const ip = String(v || '').split(',')[0]?.trim();
  return ip && IP_RE.test(ip) ? ip : undefined;
}

/**
 * IP na posicao `hops` a partir da direita de X-Forwarded-For.
 * Se houver menos entradas do que hops, falha fechado (undefined) — nunca
 * recua para a primeira entrada, que o cliente controla.
 */
export function clientIpFromForwardedFor(xff: string | null | undefined, hops: number): string | undefined {
  const n = Number(hops);
  if (!Number.isFinite(n) || n < 1) return undefined;
  const parts = String(xff || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length < n) return undefined;
  const ip = parts[parts.length - n];
  return ip && IP_RE.test(ip) ? ip : undefined;
}

function normalizeMode(mode?: TrustedProxyMode | boolean): TrustedProxyMode {
  if (mode === true) return 'vercel';
  if (mode === false) return 'none';
  if (mode === 'vercel' || mode === 'cloudrun' || mode === 'none') return mode;
  return resolveTrustedProxyMode();
}

/**
 * @param headers  cabecalhos da requisicao (NextRequest.headers ou equivalente)
 * @param mode     'vercel' | 'cloudrun' | 'none'. `true`/`false` permanecem
 *                 como alias de vercel/none (testes antigos do pacote G).
 *                 Sem argumento, usa TRUSTED_PROXY_MODE / VERCEL=1 / K_SERVICE.
 */
export function resolveTrustedClientIp(
  headers: HeaderGetter,
  mode?: TrustedProxyMode | boolean
): string | undefined {
  const resolved = normalizeMode(mode);
  if (resolved === 'vercel') {
    return firstIp(headers.get('x-vercel-forwarded-for')) || firstIp(headers.get('x-real-ip'));
  }
  if (resolved === 'cloudrun') {
    return clientIpFromForwardedFor(headers.get('x-forwarded-for'), resolveTrustedProxyHops());
  }
  return undefined;
}

/**
 * Pacote J (D-I4): chave de rate-limit por IP. IPv4 => o proprio endereco. IPv6 => o prefixo /64
 * (um cliente recebe normalmente um /64 inteiro; contar cada /128 deixava o atacante trocar de
 * endereco a vontade). IPv4 mapeado (::ffff:a.b.c.d) => o IPv4. Invalido/vazio => 'sem-ip'.
 * So para contagem: a auditoria continua gravando o endereco completo.
 */
export function rateLimitIpKey(ip: string | null | undefined): string {
  const raw = String(ip || '').trim().replace(/^\[|\]$/g, '').split('%')[0];
  if (!raw || raw === 'sem-ip') return 'sem-ip';
  if (!raw.includes(':')) return raw;
  const mapped = raw.match(/^(?:0{0,4}:){0,5}:?ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i);
  if (mapped) return mapped[1];
  let s = raw.toLowerCase();
  // Cauda IPv4 embutida (ex.: 64:ff9b::1.2.3.4) => 2 hextets.
  const v4 = s.match(/(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const n = v4.slice(1).map(Number);
    if (n.some((x) => x > 255)) return raw;
    s = s.slice(0, -v4[0].length) + ((n[0] << 8) | n[1]).toString(16) + ':' + ((n[2] << 8) | n[3]).toString(16);
  }
  const parts = s.split('::');
  if (parts.length > 2) return raw;
  const head = parts[0] ? parts[0].split(':') : [];
  const tail = parts.length === 2 && parts[1] ? parts[1].split(':') : [];
  const fill = parts.length === 2 ? 8 - head.length - tail.length : 0;
  if (fill < 0 || (parts.length === 1 && head.length !== 8)) return raw;
  const hextets = [...head, ...Array(fill).fill('0'), ...tail];
  if (hextets.length !== 8 || hextets.some((h) => !/^[0-9a-f]{1,4}$/.test(h))) return raw;
  return `${hextets.slice(0, 4).map((h) => parseInt(h, 16).toString(16)).join(':')}::/64`;
}
