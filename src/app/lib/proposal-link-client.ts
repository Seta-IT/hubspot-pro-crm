// ============================================================================
// STI-hub — cliente (navegador) do link ASSINADO de proposta (29/10/2026).
// Pede ao servidor, com a sessao MFA do vendedor/admin, o link da versao atual:
// POST /api/erp/proposals/:id/public-link => { url, expiresAt, version }.
// O token fica no fragmento (#t=) da URL; nada aqui o registra.
// ============================================================================

export type SignedProposalLinkResult =
  | { ok: true; url: string; expiresAt: string; version: number }
  | { ok: false; status: number; error: string };

export async function requestSignedProposalLink(proposalId: string): Promise<SignedProposalLinkResult> {
  const id = String(proposalId || '').trim();
  if (!id) return { ok: false, status: 400, error: 'Proposta sem identificador.' };
  try {
    const res = await fetch(`/api/erp/proposals/${encodeURIComponent(id)}/public-link`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      cache: 'no-store',
      body: '{}',
    });
    const json = await res.json().catch(() => null);
    if (res.ok && typeof json?.data?.url === 'string') {
      // t33u: o link enviado ao cliente e o short link opaco /p/<codigo> (o #t= longo fica de reserva).
      const shortUrl = typeof json.data.shortUrl === 'string' && json.data.shortUrl ? json.data.shortUrl : null;
      return { ok: true, url: shortUrl || json.data.url, expiresAt: String(json.data.expiresAt || ''), version: Number(json.data.version || 1) };
    }
    const fallback =
      res.status === 401
        ? 'Entre no STI-hub para gerar o link do cliente.'
        : res.status === 403
          ? 'Seu perfil não tem permissão para gerar o link desta proposta.'
          : res.status === 404
            ? 'Proposta ainda não salva no servidor. Salve a proposta e tente de novo.'
            : 'Não foi possível gerar o link para o cliente.';
    return { ok: false, status: res.status, error: (typeof json?.error === 'string' && json.error) || fallback };
  } catch {
    return { ok: false, status: 0, error: 'Falha de conexão ao gerar o link para o cliente.' };
  }
}

/** Gera o link assinado e copia para a area de transferencia. */
export async function copySignedProposalLink(proposalId: string): Promise<SignedProposalLinkResult> {
  const r = await requestSignedProposalLink(proposalId);
  if (r.ok) {
    try {
      await navigator.clipboard?.writeText(r.url);
    } catch {
      // sem permissao de clipboard: o chamador pode exibir r.url
    }
  }
  return r;
}

/**
 * Abre um app externo (WhatsApp/SMS) com o link assinado. A janela e aberta de imediato
 * (evita bloqueio de pop-up) e redirecionada quando o link chega.
 */
export async function openWithSignedProposalLink(
  proposalId: string,
  buildTarget: (signedUrl: string) => string,
  sameWindow = false
): Promise<SignedProposalLinkResult> {
  const w = !sameWindow && typeof window !== 'undefined' ? window.open('about:blank', '_blank') : null;
  const r = await copySignedProposalLink(proposalId);
  if (!r.ok) {
    w?.close();
    return r;
  }
  const target = buildTarget(r.url);
  if (w) {
    try {
      w.opener = null;
    } catch {
      // ignore
    }
    w.location.href = target;
  } else if (typeof window !== 'undefined') {
    window.location.href = target;
  }
  return r;
}

/** Estado do link assinado no compositor de e-mail de proposta. */
export type SignedLinkState =
  | { status: 'not-needed' }
  | { status: 'loading' }
  | { status: 'ok'; url: string }
  | { status: 'error'; error: string };

/**
 * Checagem final da v4 (01/11/2026): o e-mail de PROPOSTA so sai com o link ASSINADO. Se a
 * emissao falhou (403/503/409/rede) ou ainda nao terminou, o envio (e copiar/abrir no app de
 * e-mail) fica bloqueado com a mensagem de erro, em vez de mandar o link sem token em silencio.
 * Tambem bloqueia se o corpo ainda contem o link interno sem token.
 */
export function proposalEmailLinkGate(input: {
  isProposal: boolean;
  state: SignedLinkState;
  body: string;
  unsignedUrl?: string;
}): { ok: true } | { ok: false; error: string } {
  if (!input.isProposal || input.state.status === 'not-needed') return { ok: true };
  if (input.state.status === 'loading') {
    return { ok: false, error: 'Gerando o link assinado da proposta… aguarde para enviar.' };
  }
  if (input.state.status === 'error') {
    return {
      ok: false,
      error: `Não foi possível gerar o link assinado da proposta (${input.state.error}). O e-mail não foi enviado: sem o link assinado o cliente não consegue abrir a proposta.`,
    };
  }
  const unsigned = String(input.unsignedUrl || '');
  if (unsigned && !unsigned.includes('#t=') && input.body.includes(unsigned) && !input.body.includes(input.state.url)) {
    return { ok: false, error: 'O corpo do e-mail ainda tem o link interno da proposta (sem assinatura). Use o link assinado.' };
  }
  return { ok: true };
}

/**
 * t29u: short link ASSINADO de uma versao: /proposta/<id>/v/<n>#t=<token>. Reusa o mesmo
 * emissor (POST /public-link), que so assina a revisao atual. Pedir o link de uma versao
 * antiga do historico => erro (409 local), sem emitir link novo. Um link ja emitido
 * continua abrindo depois de correcoes: o servidor devolve a proposta atual.
 */
export function toSignedVersionShortUrl(signedUrl: string, proposalId: string, version: number): string {
  const enc = encodeURIComponent(String(proposalId || '').trim());
  const n = Math.max(1, Math.floor(Number(version) || 1));
  const marker = `/proposta/${enc}#t=`;
  const i = signedUrl.indexOf(marker);
  if (i === -1) return signedUrl;
  return `${signedUrl.slice(0, i)}/proposta/${enc}/v/${n}#t=${signedUrl.slice(i + marker.length)}`;
}

export async function copySignedProposalVersionLink(
  proposalId: string,
  version: number
): Promise<SignedProposalLinkResult> {
  const r = await requestSignedProposalLink(proposalId);
  if (!r.ok) return r;
  if (Number(version) !== r.version) {
    return {
      ok: false,
      status: 409,
      error: `Só a versão atual (Versão ${r.version}) pode ser enviada ao cliente. Restaure a Versão ${version} para gerar o link dela.`,
    };
  }
  const url = toSignedVersionShortUrl(r.url, proposalId, r.version);
  try {
    await navigator.clipboard?.writeText(url);
  } catch {
    // sem permissao de clipboard: o chamador pode exibir url
  }
  return { ...r, url };
}
