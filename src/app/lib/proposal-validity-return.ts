// ============================================================================
// STI-hub — "Atualizar validade" a partir do modal Enviar por e-mail.
// ----------------------------------------------------------------------------
// Quando POST /api/erp/proposals/:id/public-link responde 409 com
// `code: "PROPOSAL_EXPIRED"`, o aviso do compositor mostra "Atualizar validade".
// O clique NÃO emite link e NÃO grava token. Só navega para a edição da proposta
// com o campo Validade em foco. Depois de salvar, a URL de retorno reabre o
// mesmo modal de envio (contrato ou proposta).
//
// URLs (allowlist; sem URL livre, sem fragmento, sem token de link assinado):
//
//   Edição (foco no campo Validade):
//     /?tela=ERP_PROPOSALS&acao=atualizar-validade&proposta=<id>&foco=validade&voltar=contrato:<contractId>
//     /?tela=ERP_PROPOSALS&acao=atualizar-validade&proposta=<id>&foco=validade&voltar=proposta:<proposalId>
//
//   Retorno ao envio, após salvar a proposta cujo id é o da URL:
//     /?tela=ERP_CONTRACTS&acao=enviar-email&origem=contrato&id=<contractId>
//     /?tela=ERP_PROPOSALS&acao=enviar-email&origem=proposta&id=<proposalId>
//
// `voltar` só aceita o prefixo `contrato:` ou `proposta:` mais um id interno
// (letras, números, `_` e `-`, até 80 caracteres). Qualquer outro valor
// é ignorado. Ids e a URL gerada não são registrados em log.
//
// A regra de emissão do link não muda: sessão com MFA continua obrigatória,
// validade vencida continua bloqueando o link (409 PROPOSAL_EXPIRED) e só um
// RASCUNHO com validade válida passa a ENVIADA na emissão.
// ============================================================================

export const PROPOSAL_VALIDITY_EXPIRED_CODE = 'PROPOSAL_EXPIRED';

const RECORD_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;
const RETURN_TOKEN = /^(contrato|proposta):([A-Za-z0-9][A-Za-z0-9_-]{0,79})$/;

export type ProposalSendOrigin = { kind: 'contrato' | 'proposta'; id: string };

export type ProposalFlowIntent =
  | { kind: 'edit-validity'; proposalId: string; returnTo: ProposalSendOrigin | null }
  | { kind: 'send-email'; origin: ProposalSendOrigin };

export type ProposalFlowNavigation = {
  section: 'ORCAMENTOS' | 'CONTRATOS';
  target: { type: 'PROPOSAL' | 'CONTRACT_EMAIL' | 'PROPOSAL_EMAIL'; id: string; query?: string };
};

export type SignedLinkRecovery =
  | { kind: 'update-validity'; href: string }
  | { kind: 'retry' };

export function isSafeRecordId(value: unknown): value is string {
  return typeof value === 'string' && RECORD_ID.test(value);
}

export function readProposalLinkErrorCode(json: unknown): string | undefined {
  if (!json || typeof json !== 'object') return undefined;
  const code = (json as { code?: unknown }).code;
  return typeof code === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(code) ? code : undefined;
}

function parseReturnToken(raw: string | null): ProposalSendOrigin | null {
  if (!raw) return null;
  const match = RETURN_TOKEN.exec(raw);
  if (!match) return null;
  return { kind: match[1] as ProposalSendOrigin['kind'], id: match[2] };
}

export function sendOriginFromEmailPayload(input: {
  contractId?: string | null;
  proposalId?: string | null;
}): ProposalSendOrigin | null {
  const contractId = String(input.contractId || '').trim();
  if (isSafeRecordId(contractId)) return { kind: 'contrato', id: contractId };
  const proposalId = String(input.proposalId || '').trim();
  if (isSafeRecordId(proposalId)) return { kind: 'proposta', id: proposalId };
  return null;
}

export function buildUpdateValidityHref(proposalId: string, returnTo: ProposalSendOrigin | null): string | null {
  if (!isSafeRecordId(proposalId)) return null;
  if (returnTo && !isSafeRecordId(returnTo.id)) return null;
  const params = new URLSearchParams();
  params.set('tela', 'ERP_PROPOSALS');
  params.set('acao', 'atualizar-validade');
  params.set('proposta', proposalId);
  params.set('foco', 'validade');
  if (returnTo) params.set('voltar', `${returnTo.kind}:${returnTo.id}`);
  const href = `/?${params.toString()}`;
  return isInternalFlowHref(href) ? href : null;
}

export function buildReturnToSendHref(origin: ProposalSendOrigin): string | null {
  if (!isSafeRecordId(origin.id)) return null;
  const params = new URLSearchParams();
  params.set('tela', origin.kind === 'contrato' ? 'ERP_CONTRACTS' : 'ERP_PROPOSALS');
  params.set('acao', 'enviar-email');
  params.set('origem', origin.kind);
  params.set('id', origin.id);
  const href = `/?${params.toString()}`;
  return isInternalFlowHref(href) ? href : null;
}

/** Lê a query da página. Valores fora da allowlist não abrem edição nem envio. */
export function parseProposalFlowIntent(search: string): ProposalFlowIntent | null {
  const raw = String(search || '').replace(/^\?/, '');
  if (!raw || raw.includes('#')) return null;
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(raw);
  } catch {
    return null;
  }
  const acao = params.get('acao');
  if (acao === 'atualizar-validade') {
    const proposalId = params.get('proposta') || '';
    if (!isSafeRecordId(proposalId)) return null;
    if (params.get('foco') !== 'validade') return null;
    return { kind: 'edit-validity', proposalId, returnTo: parseReturnToken(params.get('voltar')) };
  }
  if (acao === 'enviar-email') {
    const origem = params.get('origem');
    const id = params.get('id') || '';
    if (origem !== 'contrato' && origem !== 'proposta') return null;
    if (!isSafeRecordId(id)) return null;
    return { kind: 'send-email', origin: { kind: origem, id } };
  }
  return null;
}

/** O que a home deve abrir ao carregar a URL. Null se a query não for deste fluxo. */
export function proposalFlowNavigation(search: string): ProposalFlowNavigation | null {
  const intent = parseProposalFlowIntent(search);
  if (!intent) return null;
  if (intent.kind === 'edit-validity') {
    return {
      section: 'ORCAMENTOS',
      target: { type: 'PROPOSAL', id: intent.proposalId, query: 'validade' },
    };
  }
  if (intent.origin.kind === 'contrato') {
    return { section: 'CONTRATOS', target: { type: 'CONTRACT_EMAIL', id: intent.origin.id } };
  }
  return { section: 'ORCAMENTOS', target: { type: 'PROPOSAL_EMAIL', id: intent.origin.id } };
}

/**
 * Depois de salvar: só volta ao envio se a URL ainda é a edição desta proposta
 * e o retorno passou na allowlist. Salvar outro orçamento não redireciona.
 */
export function hrefAfterProposalSave(search: string, savedProposalId: string): string | null {
  const intent = parseProposalFlowIntent(search);
  if (!intent || intent.kind !== 'edit-validity' || !intent.returnTo) return null;
  if (intent.proposalId !== String(savedProposalId || '').trim()) return null;
  return buildReturnToSendHref(intent.returnTo);
}

/**
 * Botão do aviso do link assinado. Só `code === PROPOSAL_EXPIRED` (não o texto)
 * troca "Tentar de novo" por "Atualizar validade". Sem id seguro, permanece o retry.
 */
export function signedLinkRecovery(input: {
  code?: string | null;
  proposalId?: string | null;
  contractId?: string | null;
}): SignedLinkRecovery {
  if (input.code !== PROPOSAL_VALIDITY_EXPIRED_CODE) return { kind: 'retry' };
  const href = buildUpdateValidityHref(
    String(input.proposalId || '').trim(),
    sendOriginFromEmailPayload({ contractId: input.contractId, proposalId: input.proposalId })
  );
  return href ? { kind: 'update-validity', href } : { kind: 'retry' };
}

/** Só os hrefs gerados por este módulo. Recusa fragmento, esquema e parâmetro extra. */
export function isInternalFlowHref(href: string): boolean {
  if (typeof href !== 'string' || !href.startsWith('/?') || href.includes('#') || href.includes('\\')) return false;
  if (/^[a-z]+:/i.test(href) || href.includes('//')) return false;
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(href.slice(2));
  } catch {
    return false;
  }
  const acao = params.get('acao');
  const tela = params.get('tela');
  if (acao !== 'atualizar-validade' && acao !== 'enviar-email') return false;
  if (tela !== 'ERP_PROPOSALS' && tela !== 'ERP_CONTRACTS') return false;
  for (const [key, value] of params.entries()) {
    if (value.includes('#') || value.includes('://') || value.includes('//')) return false;
    if (key === 'tela' || key === 'acao') continue;
    if (key === 'foco') {
      if (acao !== 'atualizar-validade' || value !== 'validade') return false;
      continue;
    }
    if (key === 'origem') {
      if (acao !== 'enviar-email' || (value !== 'contrato' && value !== 'proposta')) return false;
      continue;
    }
    if (key === 'voltar') {
      if (acao !== 'atualizar-validade' || !parseReturnToken(value)) return false;
      continue;
    }
    if (key === 'proposta') {
      if (acao !== 'atualizar-validade' || !isSafeRecordId(value)) return false;
      continue;
    }
    if (key === 'id') {
      if (acao !== 'enviar-email' || !isSafeRecordId(value)) return false;
      continue;
    }
    return false;
  }
  if (acao === 'atualizar-validade') {
    return params.get('foco') === 'validade' && isSafeRecordId(params.get('proposta') || '');
  }
  const origem = params.get('origem');
  return (origem === 'contrato' || origem === 'proposta') && isSafeRecordId(params.get('id') || '');
}

export function assignInternalFlowHref(href: string): boolean {
  if (!isInternalFlowHref(href) || typeof window === 'undefined') return false;
  window.location.assign(href);
  return true;
}

/** Tira acao/origem/id depois de reabrir o envio, para um refresh não reabrir o modal. Mantém ?tela=. */
export function stripConsumedSendParams(href: string): string {
  let url: URL;
  try {
    url = new URL(href, 'https://sti-hub.local');
  } catch {
    return href;
  }
  if (url.searchParams.get('acao') !== 'enviar-email') return href;
  url.searchParams.delete('acao');
  url.searchParams.delete('origem');
  url.searchParams.delete('id');
  const search = url.searchParams.toString();
  return `${url.pathname}${search ? `?${search}` : ''}${url.hash}`;
}

/** Rola até o campo Validade e foca. O destaque visual fica no componente. */
export function focusProposalValidityField(
  el: {
    scrollIntoView?: (arg?: ScrollIntoViewOptions | boolean) => void;
    focus?: (opts?: { preventScroll?: boolean }) => void;
  } | null
): boolean {
  if (!el || typeof el.focus !== 'function') return false;
  try {
    el.scrollIntoView?.({ block: 'center', inline: 'nearest' });
  } catch {
    // o campo ainda foca mesmo se o container não rolar
  }
  try {
    el.focus({ preventScroll: false });
  } catch {
    try {
      el.focus();
    } catch {
      return false;
    }
  }
  return true;
}
