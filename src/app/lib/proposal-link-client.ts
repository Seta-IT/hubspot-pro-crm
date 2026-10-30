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
      return { ok: true, url: json.data.url, expiresAt: String(json.data.expiresAt || ''), version: Number(json.data.version || 1) };
    }
    const fallback =
      res.status === 401
        ? 'Sua sessão expirou. Entre novamente no STI-hub para gerar o link.'
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
