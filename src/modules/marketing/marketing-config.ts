// ============================================================================
// STI-hub — Fase 3 (19/11/2026): configuracao do envio real de campanhas de marketing.
// Isolado do e-mail transacional (ERP/Chamados) e das cadencias 1:1 (Outlook): chaves, remetente e
// dominio PROPRIOS. Nunca ha rotacao de contas, dominios ou provedores: um unico provedor e um
// unico remetente configurados; limite atingido => fila espera, nunca troca de conta.
//
//   MARKETING_LIVE_SEND           desligado por padrao (= simulacao atual do /campaigns/dispatch)
//   MARKETING_TEST_RECIPIENTS     allowlist de homologacao (so esses enderecos recebem)
//   MARKETING_ESP_PROVIDER        resend | smtp | sendgrid | mailgun | postmark | ses
//   MARKETING_FROM_EMAIL          ex.: news@news.setatelecom.com.br (dominio verificado no ESP)
//   MARKETING_FROM_NAME           ex.: Seta Telecom
//   MARKETING_REPLY_TO            opcional
//   MARKETING_POSTAL_ADDRESS      endereco fisico da empresa (rodape obrigatorio)
//   MARKETING_UNSUBSCRIBE_SECRET  segredo do token de descadastro (>= 32 caracteres)
//   MARKETING_MAX_PER_MINUTE      taxa da fila (padrao 60)
//   MARKETING_MAX_PER_RUN         envios por execucao do cron (padrao 200)
//   MARKETING_DKIM_SELECTORS      seletores DKIM a verificar (padrao "resend")
//   MARKETING_SPF_HOST            host do SPF (padrao "send.<dominio>" para resend, senao o dominio)
// ============================================================================

const TRUE_RE = /^(1|true|on|yes|sim)$/i;
const EMAIL_RE = /^[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+$/;

/** Finalidades de marketing (LGPD por finalidade = categoria de comunicacao do contato). */
export const MARKETING_PURPOSES = ['NEWSLETTER_TECNICA', 'EVENTOS_ABM', 'OFERTAS_COMERCIAIS'] as const;
export type MarketingPurpose = (typeof MARKETING_PURPOSES)[number];
export const MARKETING_PURPOSE_LABELS: Record<MarketingPurpose, string> = {
  NEWSLETTER_TECNICA: 'Newsletter técnica',
  EVENTOS_ABM: 'Eventos e convites',
  OFERTAS_COMERCIAIS: 'Ofertas comerciais',
};
export function isMarketingPurpose(v: unknown): v is MarketingPurpose {
  return typeof v === 'string' && (MARKETING_PURPOSES as readonly string[]).includes(v);
}

export function isMarketingLiveSendEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return TRUE_RE.test(String(env.MARKETING_LIVE_SEND || '').trim());
}

export function resolveMarketingTestRecipients(env: NodeJS.ProcessEnv = process.env): Set<string> | null {
  const raw = String(env.MARKETING_TEST_RECIPIENTS || '').trim();
  if (!raw) return null;
  const list = raw.split(/[\s,;]+/).map((s) => s.trim().toLowerCase()).filter((s) => EMAIL_RE.test(s));
  return list.length ? new Set(list) : null;
}

export type MarketingEspProviderId = 'resend' | 'smtp' | 'sendgrid' | 'mailgun' | 'postmark' | 'ses';
export const MARKETING_ESP_PROVIDERS: MarketingEspProviderId[] = ['resend', 'smtp', 'sendgrid', 'mailgun', 'postmark', 'ses'];

export interface MarketingSenderConfig {
  provider: MarketingEspProviderId | null;
  fromEmail: string | null;
  fromName: string;
  replyTo: string | null;
  fromDomain: string | null;
  postalAddress: string | null;
  maxPerMinute: number;
  maxPerRun: number;
  dkimSelectors: string[];
  spfHost: string | null;
}

function posInt(raw: string | undefined, fallback: number, max: number): number {
  const n = Number(String(raw ?? '').trim());
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.floor(n), max);
}

export function resolveMarketingSenderConfig(env: NodeJS.ProcessEnv = process.env): MarketingSenderConfig {
  const p = String(env.MARKETING_ESP_PROVIDER || '').trim().toLowerCase();
  const provider = (MARKETING_ESP_PROVIDERS as string[]).includes(p) ? (p as MarketingEspProviderId) : null;
  const from = String(env.MARKETING_FROM_EMAIL || '').trim().toLowerCase();
  const fromEmail = EMAIL_RE.test(from) ? from : null;
  const fromDomain = fromEmail ? fromEmail.split('@')[1] : null;
  const replyRaw = String(env.MARKETING_REPLY_TO || '').trim().toLowerCase();
  const address = String(env.MARKETING_POSTAL_ADDRESS || '').trim();
  const selectors = String(env.MARKETING_DKIM_SELECTORS || 'resend')
    .split(/[\s,;]+/)
    .map((s) => s.trim().toLowerCase())
    .filter((s) => /^[a-z0-9._-]{1,63}$/.test(s));
  const spfRaw = String(env.MARKETING_SPF_HOST || '').trim().toLowerCase();
  const spfHost = /^[a-z0-9.-]+\.[a-z]{2,}$/.test(spfRaw) ? spfRaw : fromDomain ? (provider === 'resend' ? `send.${fromDomain}` : fromDomain) : null;
  return {
    provider,
    fromEmail,
    fromName: String(env.MARKETING_FROM_NAME || 'Seta Telecom').trim().slice(0, 80) || 'Seta Telecom',
    replyTo: EMAIL_RE.test(replyRaw) ? replyRaw : null,
    fromDomain,
    postalAddress: address.length >= 10 ? address.slice(0, 300) : null,
    maxPerMinute: posInt(env.MARKETING_MAX_PER_MINUTE, 60, 1000),
    maxPerRun: posInt(env.MARKETING_MAX_PER_RUN, 200, 2000),
    dkimSelectors: selectors.length ? selectors : ['resend'],
    spfHost,
  };
}

/** Problemas que impedem o envio real (lista vazia = configuracao completa). */
export function marketingConfigProblems(cfg: MarketingSenderConfig, env: NodeJS.ProcessEnv = process.env): string[] {
  const out: string[] = [];
  if (!cfg.provider) out.push('MARKETING_ESP_PROVIDER não configurado.');
  if (!cfg.fromEmail) out.push('MARKETING_FROM_EMAIL não configurado.');
  if (!cfg.postalAddress) out.push('MARKETING_POSTAL_ADDRESS (endereço físico do rodapé) não configurado.');
  if (String(env.MARKETING_UNSUBSCRIBE_SECRET || '').trim().length < 32) out.push('MARKETING_UNSUBSCRIBE_SECRET ausente ou curto (mínimo 32 caracteres).');
  return out;
}
