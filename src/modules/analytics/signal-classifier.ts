// ============================================================================
// STI-hub — Fase 5: classificacao de sinais de engajamento.
// Abertura NUNCA e prova de leitura humana (Apple MPP, proxies de imagem, pre-carregamento).
// Clique de scanner antispam/robo e separado de clique humano provavel. Cada sinal guarda o
// MOTIVO da classificacao (auditavel). Regras conservadoras: na duvida, nao e "humano".
// ============================================================================
import crypto from 'node:crypto';

export type SignalKind = 'OPEN' | 'CLICK';
export type SignalClass = 'OPEN_MACHINE' | 'OPEN_OBSERVED' | 'CLICK_BOT' | 'CLICK_HUMAN';

export const SIGNAL_CLASS_LABELS: Record<SignalClass, string> = {
  OPEN_MACHINE: 'Abertura automática (proxy/MPP)',
  OPEN_OBSERVED: 'Abertura observada',
  CLICK_BOT: 'Clique de robô/scanner',
  CLICK_HUMAN: 'Clique humano provável',
};

/** Faixas de proxies/scanners conhecidos (lista embutida; revisar periodicamente). */
export const BUILTIN_PROXY_CIDRS: Array<{ cidr: string; label: string; kind: 'APPLE_MPP' | 'IMAGE_PROXY' | 'SECURITY_SCANNER' }> = [
  { cidr: '17.0.0.0/8', label: 'Apple (Mail Privacy Protection)', kind: 'APPLE_MPP' },
  { cidr: '66.102.0.0/20', label: 'Google Image Proxy', kind: 'IMAGE_PROXY' },
  { cidr: '66.249.80.0/20', label: 'Google Image Proxy', kind: 'IMAGE_PROXY' },
  { cidr: '40.92.0.0/15', label: 'Microsoft Exchange Online Protection', kind: 'SECURITY_SCANNER' },
  { cidr: '40.107.0.0/16', label: 'Microsoft Exchange Online Protection', kind: 'SECURITY_SCANNER' },
  { cidr: '52.100.0.0/14', label: 'Microsoft Exchange Online Protection', kind: 'SECURITY_SCANNER' },
  { cidr: '104.47.0.0/17', label: 'Microsoft Exchange Online Protection', kind: 'SECURITY_SCANNER' },
];

const IMAGE_PROXY_UA: Array<[RegExp, string]> = [
  [/GoogleImageProxy|ggpht\.com/i, 'Google Image Proxy (Gmail)'],
  [/YahooMailProxy/i, 'Yahoo Mail Proxy'],
  [/Mimecast/i, 'Mimecast (pré-carregamento)'],
];
const BOT_UA: Array<[RegExp, string]> = [
  [/barracuda/i, 'Barracuda'],
  [/proofpoint/i, 'Proofpoint'],
  [/mimecast/i, 'Mimecast'],
  [/symantec|messagelabs/i, 'Symantec/MessageLabs'],
  [/forcepoint|websense/i, 'Forcepoint'],
  [/trend ?micro/i, 'Trend Micro'],
  [/safelinks|ms-office|microsoft office protocol|microsoft-?defender/i, 'Microsoft Safe Links/Defender'],
  [/bingpreview|slackbot|linkedinbot|facebookexternalhit|twitterbot|whatsapp/i, 'Pré-visualização de link'],
  [/headless|phantomjs|puppeteer|playwright|selenium/i, 'Navegador automatizado'],
  [/python-requests|python-urllib|aiohttp|curl\/|wget\/|go-http-client|java\/|okhttp|axios|node-fetch|libwww|httpclient|scrapy/i, 'Biblioteca HTTP'],
  [/\b(bot|crawler|spider|scanner|checker|monitor)\b/i, 'Robô declarado'],
];

function ipv4ToInt(ip: string): number | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip.trim());
  if (!m) return null;
  const p = m.slice(1).map(Number);
  if (p.some((x) => x > 255)) return null;
  return ((p[0] << 24) >>> 0) + (p[1] << 16) + (p[2] << 8) + p[3];
}
export function ipInCidr(ip: string, cidr: string): boolean {
  const [base, bitsRaw] = cidr.split('/');
  const a = ipv4ToInt(ip);
  const b = ipv4ToInt(base);
  const bits = Number(bitsRaw);
  if (a === null || b === null || !(bits >= 0 && bits <= 32)) return false;
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (a & mask) >>> 0 === (b & mask) >>> 0;
}

/** Faixas extras via ANALYTICS_PROXY_CIDRS ("1.2.3.0/24,5.6.0.0/16"). */
export function resolveProxyCidrs(env: NodeJS.ProcessEnv = process.env) {
  const extra = String(env.ANALYTICS_PROXY_CIDRS || '')
    .split(/[\s,;]+/)
    .map((s) => s.trim())
    .filter((s) => /^\d{1,3}(\.\d{1,3}){3}\/\d{1,2}$/.test(s))
    .map((cidr) => ({ cidr, label: 'Faixa configurada (ANALYTICS_PROXY_CIDRS)', kind: 'SECURITY_SCANNER' as const }));
  return [...BUILTIN_PROXY_CIDRS, ...extra];
}

/**
 * LGPD: o IP nunca e guardado inteiro. IPv4 vira a rede /24 (ex.: 200.1.2.0/24); IPv6, o /48.
 * Basta para auditoria da classificacao sem identificar o aparelho.
 */
export function truncateIp(ip: string): string | null {
  const v = String(ip || '').trim();
  if (ipv4ToInt(v) !== null) return `${v.split('.').slice(0, 3).join('.')}.0/24`;
  if (/^[0-9a-f:]+$/i.test(v) && v.includes(':')) return `${v.split(':').slice(0, 3).join(':')}::/48`;
  return null;
}

export interface ClassifyInput {
  kind: SignalKind;
  userAgent: string | null;
  ip: string | null;
  /** Momento do envio (ou entrega) da mensagem. */
  sentAt: string | null;
  at: string;
  /** Outros cliques da mesma mensagem (para rajada). */
  priorClickTimes?: string[];
  /** Pedido HEAD (pre-verificacao de link). */
  method?: string;
  env?: NodeJS.ProcessEnv;
}
export interface ClassifyResult {
  classification: SignalClass;
  reasons: string[];
  uaFamily: string;
  ipNetwork: string | null;
  secondsSinceSent: number | null;
}

export const FAST_CLICK_SECONDS = 30;
export const BURST_SECONDS = 2;

function uaFamily(ua: string): string {
  if (!ua) return 'sem user-agent';
  for (const [re, label] of [...IMAGE_PROXY_UA, ...BOT_UA]) if (re.test(ua)) return label;
  if (/^Mozilla\/5\.0$/.test(ua.trim())) return 'Mozilla/5.0 genérico';
  if (/Outlook|Microsoft Outlook/i.test(ua)) return 'Outlook';
  if (/iPhone|iPad/i.test(ua)) return 'iOS';
  if (/Android/i.test(ua)) return 'Android';
  if (/Macintosh/i.test(ua)) return 'macOS';
  if (/Windows/i.test(ua)) return 'Windows';
  return 'outro';
}

export function classifySignal(input: ClassifyInput): ClassifyResult {
  const ua = String(input.userAgent || '').trim().slice(0, 400);
  const ip = String(input.ip || '').trim();
  const reasons: string[] = [];
  const at = Date.parse(input.at);
  const sent = input.sentAt ? Date.parse(input.sentAt) : NaN;
  const secondsSinceSent = Number.isFinite(sent) && Number.isFinite(at) ? Math.round((at - sent) / 1000) : null;
  const cidr = resolveProxyCidrs(input.env).find((c) => ip && ipInCidr(ip, c.cidr));
  const base = { uaFamily: uaFamily(ua), ipNetwork: truncateIp(ip), secondsSinceSent };

  if (input.kind === 'OPEN') {
    if (cidr) reasons.push(`IP de ${cidr.label} (${cidr.cidr})`);
    for (const [re, label] of IMAGE_PROXY_UA) if (re.test(ua)) reasons.push(`User-agent de proxy de imagem: ${label}`);
    if (/^Mozilla\/5\.0$/.test(ua)) reasons.push('User-agent genérico "Mozilla/5.0" (padrão do Apple MPP)');
    if (!ua) reasons.push('Sem user-agent');
    if (secondsSinceSent !== null && secondsSinceSent >= 0 && secondsSinceSent < 60) reasons.push(`Aberta ${secondsSinceSent}s após o envio (pré-carregamento)`);
    if (reasons.length) return { ...base, classification: 'OPEN_MACHINE', reasons };
    return { ...base, classification: 'OPEN_OBSERVED', reasons: ['Pixel carregado por cliente de e-mail; abertura não prova leitura humana'] };
  }

  if (String(input.method || 'GET').toUpperCase() === 'HEAD') reasons.push('Pedido HEAD (verificação automática de link)');
  if (!ua) reasons.push('Sem user-agent');
  for (const [re, label] of BOT_UA) if (re.test(ua)) reasons.push(`User-agent de robô/scanner: ${label}`);
  if (cidr && cidr.kind === 'SECURITY_SCANNER') reasons.push(`IP de scanner conhecido: ${cidr.label} (${cidr.cidr})`);
  if (secondsSinceSent !== null && secondsSinceSent >= 0 && secondsSinceSent < FAST_CLICK_SECONDS) reasons.push(`Clique ${secondsSinceSent}s após o envio (rápido demais para leitura)`);
  if (Number.isFinite(at)) {
    const burst = (input.priorClickTimes || []).some((t) => Math.abs(at - Date.parse(t)) <= BURST_SECONDS * 1000);
    if (burst) reasons.push(`Rajada: outro clique da mesma mensagem em até ${BURST_SECONDS}s`);
  }
  if (reasons.length) return { ...base, classification: 'CLICK_BOT', reasons };
  return {
    ...base,
    classification: 'CLICK_HUMAN',
    reasons: [`Navegador comum (${base.uaFamily})${secondsSinceSent !== null ? `, ${secondsSinceSent}s após o envio` : ''}, sem sinal de robô`],
  };
}

export function newSignalId(): string {
  return `sig-${crypto.randomUUID()}`;
}

// ----------------------------------------------------------------------------
// Respostas: classificacao simples por palavras (motivo guardado). Nunca automatiza nada sozinha.
// ----------------------------------------------------------------------------
export type ReplySentiment = 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL';
const NEG: Array<[RegExp, string]> = [
  [/n[aã]o (tenho|temos) interesse|sem interesse|n[aã]o se aplica/i, 'sem interesse'],
  [/remov|descadastr|pare de|parem de|n[aã]o (me )?envie|unsubscribe/i, 'pediu para não receber'],
  [/n[aã]o [eé] o momento|agora n[aã]o|j[aá] (temos|possu[ií]mos) fornecedor/i, 'momento/fornecedor atual'],
];
const POS: Array<[RegExp, string]> = [
  [/tenho interesse|temos interesse|me interessa|interessante/i, 'demonstrou interesse'],
  [/vamos (conversar|marcar|agendar)|podemos (conversar|marcar|agendar)|agendar|reuni[aã]o|call|bate-?papo/i, 'quer conversar/agendar'],
  [/(envie|mande|manda|enviar).{0,20}(proposta|or[cç]amento|valores|pre[cç]o)/i, 'pediu proposta/valores'],
  [/pode (me )?ligar|me liga|meu (telefone|whats)/i, 'pediu contato'],
];
export function classifyReply(text: string | null | undefined): { sentiment: ReplySentiment; reason: string } {
  const t = String(text || '');
  for (const [re, why] of NEG) if (re.test(t)) return { sentiment: 'NEGATIVE', reason: `Negativa: ${why}` };
  for (const [re, why] of POS) if (re.test(t)) return { sentiment: 'POSITIVE', reason: `Positiva: ${why}` };
  return { sentiment: 'NEUTRAL', reason: t ? 'Sem termo de interesse ou recusa' : 'Resposta sem texto registrado' };
}
