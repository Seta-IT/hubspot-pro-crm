import { SALES_AGENT_CREATED_NOTE } from './service-account';

/** Proposta criada pela conta de serviço, inclusive as já gravadas (nota do sanitizador). */
export function isServiceCreatedProposal(proposal: {
  createdByServiceAccount?: boolean | null;
  commercialNotes?: string | null;
}): boolean {
  if (proposal.createdByServiceAccount === true) return true;
  return String(proposal.commercialNotes || '').includes(SALES_AGENT_CREATED_NOTE);
}

/**
 * Pré-visualização de link e robôs. Não conta como abertura do cliente.
 * User-agent vazio também não conta: vários apps de mensagem buscam o link sem se identificar.
 */
export function isProposalLinkPreviewAgent(userAgent: string | null | undefined): boolean {
  const ua = String(userAgent || '').trim();
  if (!ua) return true;
  return /whatsapp|slackbot|slack-imgproxy|facebookexternalhit|facebot|twitterbot|linkedinbot|telegrambot|discordbot|skypeuripreview|vkshare|pinterest|embedly|quora link preview|redditbot|applebot|googlebot|bingbot|yandex|baiduspider|duckduckbot|ia_archiver|semrush|ahrefs|petalbot|bytespider|iframely|snapchat|viber|kakaotalk|preview/i.test(
    ua
  );
}

export function nextClientProposalView(
  current: { firstViewedAt?: string | null; lastViewedAt?: string | null; viewCount?: number | null },
  atIso: string
): { firstViewedAt: string; lastViewedAt: string; viewCount: number } {
  const count = Math.max(0, Number(current.viewCount || 0)) + 1;
  return {
    firstViewedAt: current.firstViewedAt || atIso,
    lastViewedAt: atIso,
    viewCount: count,
  };
}

export function formatClientProposalViews(proposal: {
  viewCount?: number | null;
  firstViewedAt?: string | null;
  lastViewedAt?: string | null;
}): string | null {
  const count = Math.max(0, Number(proposal.viewCount || 0));
  if (!count || !proposal.firstViewedAt || !proposal.lastViewedAt) return null;
  const vez = count === 1 ? 'vez' : 'vezes';
  return `Aberta pelo cliente: ${count} ${vez}, primeira em ${formatViewedAt(proposal.firstViewedAt)}, última em ${formatViewedAt(proposal.lastViewedAt)}`;
}

function formatViewedAt(iso: string): string {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return iso;
  const parts = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const pick = (type: string) => parts.find((part) => part.type === type)?.value || '';
  return `${pick('day')}/${pick('month')}/${pick('year')} ${pick('hour')}:${pick('minute')}`;
}
