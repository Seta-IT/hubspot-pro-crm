export type SignedInvoiceLinkResult =
  | { ok: true; url: string; expiresAt: string }
  | { ok: false; status: number; error: string };

export async function requestSignedInvoiceLink(invoiceId: string): Promise<SignedInvoiceLinkResult> {
  const id = String(invoiceId || '').trim();
  if (!id) return { ok: false, status: 400, error: 'Fatura sem identificador.' };
  try {
    const res = await fetch(`/api/erp/invoices/${encodeURIComponent(id)}/public-link`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      cache: 'no-store',
      body: '{}',
    });
    const json = await res.json().catch(() => null);
    if (res.ok && typeof json?.data?.url === 'string') {
      const shortUrl = typeof json.data.shortUrl === 'string' && json.data.shortUrl ? json.data.shortUrl : null;
      return { ok: true, url: shortUrl || json.data.url, expiresAt: String(json.data.expiresAt || '') };
    }
    const fallback =
      res.status === 401
        ? 'Entre no STI-hub para gerar o link do cliente.'
        : res.status === 403
          ? 'Seu perfil não tem permissão para gerar o link desta fatura.'
          : res.status === 404
            ? 'Fatura não encontrada.'
            : 'Não foi possível gerar o link para o cliente.';
    return { ok: false, status: res.status, error: (typeof json?.error === 'string' && json.error) || fallback };
  } catch {
    return { ok: false, status: 0, error: 'Falha de conexão ao gerar o link para o cliente.' };
  }
}

export async function copySignedInvoiceLink(invoiceId: string): Promise<SignedInvoiceLinkResult> {
  const r = await requestSignedInvoiceLink(invoiceId);
  if (r.ok) {
    try {
      await navigator.clipboard?.writeText(r.url);
    } catch {
      /* o chamador pode exibir r.url */
    }
  }
  return r;
}
