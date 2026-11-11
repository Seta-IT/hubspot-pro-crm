// Cliente do e-mail individual do CRM (navegador). Tudo passa pelas rotas /api/mailbox/*
// com a sessao do usuario; nenhum token da Microsoft chega ao navegador.

export interface MailboxAccountView {
  id: string;
  mailboxAddress: string;
  displayName: string;
  status: 'ATIVADO' | 'RECONECTAR';
  createdAt: string;
  lastSyncAt: string | null;
}

export interface MailboxStatusView {
  enabled: boolean;
  message: string | null;
  accounts: MailboxAccountView[];
  signature: string;
  canManageNeverLog: boolean;
}

export interface TimelineEmailView {
  id: string;
  ownerEmail: string | null;
  conversationId: string | null;
  direction: 'ENVIADO' | 'RECEBIDO';
  source: 'STI_HUB' | 'OUTLOOK' | 'HUBSPOT';
  fromAddress: string;
  fromName: string;
  to: string[];
  cc: string[];
  subject: string;
  bodyPreview: string;
  occurredAt: string;
  contactId: string | null;
  companyId: string | null;
  dealId: string | null;
  openCount: number;
  clickCount: number;
  lastOpenedAt: string | null;
  lastClickedAt: string | null;
  tracked: boolean;
  attachmentNames?: string[];
}

export interface EmailRecordRef {
  contactId?: string | null;
  companyId?: string | null;
  dealId?: string | null;
}

export const GENERIC_ERROR = 'Não foi possível concluir agora. Tente novamente em instantes.';

export async function mailboxApi<T = unknown>(path: string, init?: { method?: string; body?: unknown }): Promise<{ ok: boolean; data: T | null; error: string | null }> {
  try {
    const res = await fetch(`/api/mailbox${path}`, {
      method: init?.method || 'GET',
      headers: init?.body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
      cache: 'no-store',
    });
    const json = await res.json().catch(() => null);
    if (!res.ok) return { ok: false, data: null, error: (json && typeof json.error === 'string' && json.error) || GENERIC_ERROR };
    return { ok: true, data: (json?.data ?? null) as T, error: null };
  } catch {
    return { ok: false, data: null, error: GENERIC_ERROR };
  }
}

export function recordQuery(ref: EmailRecordRef): string {
  if (ref.dealId) return `dealId=${encodeURIComponent(ref.dealId)}`;
  if (ref.companyId) return `companyId=${encodeURIComponent(ref.companyId)}`;
  if (ref.contactId) return `contactId=${encodeURIComponent(ref.contactId)}`;
  return '';
}

export function formatEmailDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** Classes do padrao visual: so o botao principal do bloco em azul-marinho. */
export const BTN_PRIMARY =
  'inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-accent hover:bg-accent-hover text-white text-xs font-semibold transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed';
export const BTN_OUTLINE =
  'inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed';
export const TAG_GRAY = 'inline-flex items-center px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 text-[10px] font-semibold uppercase tracking-wide';
export const CARD = 'bg-white rounded-xl border border-slate-200 p-4 space-y-3';
export const INPUT = 'w-full px-3 py-2 rounded-lg border border-slate-300 bg-white text-xs text-slate-800 font-semibold focus:outline-none focus:border-accent';
export const LABEL = 'block text-[11px] font-semibold text-slate-600 mb-1';

/** Motivo legível quando o botão Enviar do compositor Outlook deve ficar desabilitado. */
export function mailboxSendDisabledReason(opts: {
  loading?: boolean;
  enabled?: boolean;
  activeAccountCount?: number;
  to?: string;
  subject?: string;
  sending?: boolean;
  statusMessage?: string | null;
}): string | null {
  if (opts.loading) return 'Carregando status da caixa...';
  if (opts.sending) return 'Enviando...';
  if (!opts.enabled) {
    return (opts.statusMessage && opts.statusMessage.trim()) || 'Caixa de e-mail não liberada pelo administrador.';
  }
  if (!opts.activeAccountCount) return 'Conecte sua caixa do Outlook em Minha Conta.';
  if (!String(opts.to || '').trim()) return 'Informe o destinatário (Para).';
  if (!String(opts.subject || '').trim()) return 'Informe o assunto.';
  return null;
}
