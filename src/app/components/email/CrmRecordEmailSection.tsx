'use client';
// Ficha de contato, empresa ou negocio: botao "E-mail" (compositor pela caixa Outlook do
// proprio usuario, com assinatura) e a linha do tempo de e-mails enviados e recebidos, com
// aberturas e cliques. Estilo: cartao branco, so o botao principal em azul-marinho.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDownLeft, ArrowUpRight, Bold, Italic, Underline, Link2, Loader2, Mail, Minus, MousePointerClick, RefreshCw, RemoveFormatting, Send, X, Eye, FileText, LayoutTemplate } from 'lucide-react';
import {
  BTN_OUTLINE,
  BTN_PRIMARY,
  CARD,
  formatEmailDate,
  INPUT,
  LABEL,
  mailboxApi,
  mailboxSendDisabledReason,
  recordQuery,
  TAG_GRAY,
  type EmailRecordRef,
  type MailboxStatusView,
  type TimelineEmailView,
} from './mailbox-client';

export interface CrmRecordEmailSectionProps {
  record: EmailRecordRef;
  /** Destinatario sugerido (ex.: e-mail do contato principal). */
  defaultTo?: string | null;
  /** Outros e-mails da ficha (contatos vinculados) para escolher rapidamente. */
  suggestions?: string[];
  /** Nome exibido no titulo do compositor. */
  recordLabel?: string;
}

export default function CrmRecordEmailSection({ record, defaultTo, suggestions = [], recordLabel }: CrmRecordEmailSectionProps) {
  const q = recordQuery(record);
  const [items, setItems] = useState<TimelineEmailView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const load = useCallback(async () => {
    if (!q) return;
    setLoading(true);
    const r = await mailboxApi<TimelineEmailView[]>(`/timeline?${q}`);
    if (r.ok) {
      setItems(r.data || []);
      setError(null);
    } else {
      setError(r.error);
    }
    setLoading(false);
  }, [q]);

  useEffect(() => {
    void load();
  }, [load]);

  const sync = async () => {
    setSyncing(true);
    await mailboxApi('/sync', { method: 'POST', body: {} });
    setSyncing(false);
    void load();
  };

  return (
    <div className={CARD}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-600 flex items-center gap-1.5">
          <Mail className="w-4 h-4 text-accent" /> E-mails ({items.length})
        </h4>
        <div className="flex items-center gap-2">
          <button type="button" onClick={sync} disabled={syncing} className={BTN_OUTLINE} title="Buscar respostas na sua caixa">
            <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} /> Sincronizar
          </button>
          <button type="button" onClick={() => setComposerOpen(true)} className={BTN_PRIMARY}>
            <Mail className="w-3.5 h-3.5" /> E-mail
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-xs font-semibold text-slate-500">
          <Loader2 className="w-4 h-4 animate-spin" /> Carregando e-mails...
        </div>
      ) : error ? (
        <p className="text-xs font-semibold text-slate-500">{error}</p>
      ) : items.length === 0 ? (
        <p className="text-xs font-semibold text-slate-500">Nenhum e-mail registrado nesta ficha.</p>
      ) : (
        <ul className="space-y-2">
          {items.map((m) => (
            <EmailTimelineItem key={m.id} item={m} />
          ))}
        </ul>
      )}

      {composerOpen && (
        <CrmEmailComposerModal
          record={record}
          defaultTo={defaultTo || ''}
          suggestions={suggestions}
          recordLabel={recordLabel}
          onClose={() => setComposerOpen(false)}
          onSent={() => {
            setComposerOpen(false);
            void load();
          }}
        />
      )}
    </div>
  );
}

export function EmailTimelineItem({ item }: { item: TimelineEmailView }) {
  const sent = item.direction === 'ENVIADO';
  const Icon = sent ? ArrowUpRight : ArrowDownLeft;
  return (
    <li className="rounded-lg border border-slate-200 p-3 space-y-1.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Icon className="w-3.5 h-3.5 text-slate-500 shrink-0" />
          <span className="text-xs font-semibold text-slate-900 truncate">{item.subject || '(sem assunto)'}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className={TAG_GRAY}>{sent ? 'Enviado' : 'Recebido'}</span>
          {item.source === 'HUBSPOT' && <span className={TAG_GRAY}>HubSpot</span>}
        </div>
      </div>
      <div className="text-[11px] font-semibold text-slate-500">
        {sent ? `De ${item.fromName || item.fromAddress} para ${item.to.join(', ')}` : `De ${item.fromName ? `${item.fromName} (${item.fromAddress})` : item.fromAddress}`}
        {item.cc.length ? ` • Cc: ${item.cc.join(', ')}` : ''} • {formatEmailDate(item.occurredAt)}
      </div>
      {item.bodyPreview && <p className="text-xs text-slate-700 line-clamp-2 whitespace-pre-line">{item.bodyPreview}</p>}
      {sent && (item.tracked || item.openCount > 0 || item.clickCount > 0) && (
        <div className="flex flex-wrap items-center gap-3 text-[11px] font-semibold text-slate-600">
          <span className="inline-flex items-center gap-1" title={item.lastOpenedAt ? `Última abertura: ${formatEmailDate(item.lastOpenedAt)}` : undefined}>
            <Eye className="w-3.5 h-3.5" /> Aberturas: {item.openCount}
          </span>
          <span className="inline-flex items-center gap-1" title={item.lastClickedAt ? `Último clique: ${formatEmailDate(item.lastClickedAt)}` : undefined}>
            <MousePointerClick className="w-3.5 h-3.5" /> Cliques: {item.clickCount}
          </span>
        </div>
      )}
    </li>
  );
}

export const DEFAULT_SETA_SIGNATURE = `Marcéllo MMíra
Business Consultant
WhatsApp
+55 (11) 3958 4929
setatelecom.com.br

Nota de Confidencialidade 1
Esta mensagem e seus anexos são confidenciais e destinados exclusivamente ao(s) destinatário(s) indicado(s). Se você a recebeu por engano, avise o remetente e apague-a imediatamente.

Nota de Confidencialidade 2
A Seta Telecom não se responsabiliza por informações incorretas ou incompletas nesta mensagem. A divulgação, cópia ou uso não autorizado é proibida.`;

export function CrmEmailComposerModal({
  record,
  defaultTo,
  suggestions,
  recordLabel,
  onClose,
  onSent,
}: {
  record: EmailRecordRef;
  defaultTo: string;
  suggestions: string[];
  recordLabel?: string;
  onClose: () => void;
  onSent: () => void;
}) {
  const [status, setStatus] = useState<MailboxStatusView | null>(null);
  const [loading, setLoading] = useState(true);
  const [accountId, setAccountId] = useState('');
  const [to, setTo] = useState(defaultTo);
  const [cc, setCc] = useState('');
  const [bcc, setBcc] = useState('');
  const [showCc, setShowCc] = useState(false);
  const [showBcc, setShowBcc] = useState(false);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [track, setTrack] = useState(true);
  const [signature, setSignature] = useState(DEFAULT_SETA_SIGNATURE);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [minimized, setMinimized] = useState(false);
  const [createFollowUp, setCreateFollowUp] = useState(true);
  const [templates, setTemplates] = useState<Array<{ id: string; name: string; subject: string; body: string }>>([]);
  const [proposals, setProposals] = useState<Array<{ id: string; code: string; title: string }>>([]);
  const [showTemplates, setShowTemplates] = useState(false);
  const [showProposals, setShowProposals] = useState(false);
  const bodyRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    (async () => {
      const r = await mailboxApi<MailboxStatusView>('/status');
      if (r.ok && r.data) {
        setStatus(r.data);
        setSignature((r.data.signature && r.data.signature.trim()) || DEFAULT_SETA_SIGNATURE);
        const active = r.data.accounts.filter((a) => a.status === 'ATIVADO');
        if (active[0]) setAccountId(active[0].id);
      } else {
        setError(r.error);
      }
      setLoading(false);
    })();
    (async () => {
      try {
        const res = await fetch('/api/email-templates', { cache: 'no-store' });
        if (res.ok) {
          const j = await res.json();
          setTemplates((j.data || []).slice(0, 20));
        }
      } catch {}
    })();
    (async () => {
      if (!record.dealId && !record.companyId) return;
      try {
        const qs = record.dealId ? `dealId=${encodeURIComponent(record.dealId)}` : `companyId=${encodeURIComponent(record.companyId || '')}`;
        const res = await fetch(`/api/erp/proposals?${qs}`, { cache: 'no-store' });
        if (res.ok) {
          const j = await res.json();
          const list = (j.data || j.proposals || []).slice(0, 12).map((p: any) => ({
            id: p.id,
            code: p.code || p.proposalNumber || p.id,
            title: p.title || 'Proposta',
          }));
          setProposals(list);
        }
      } catch {}
    })();
  }, [record.dealId, record.companyId]);

  const activeAccounts = useMemo(() => (status?.accounts || []).filter((a) => a.status === 'ATIVADO'), [status]);
  const extraSuggestions = useMemo(
    () => [...new Set(suggestions.map((s) => s.trim().toLowerCase()).filter((s) => s.includes('@')))].filter((s) => !to.toLowerCase().includes(s)).slice(0, 6),
    [suggestions, to]
  );
  const sendDisabledReason = mailboxSendDisabledReason({
    loading,
    enabled: status?.enabled,
    activeAccountCount: activeAccounts.length,
    to,
    subject,
    sending,
    statusMessage: status?.message,
  });
  const canSend = !sendDisabledReason;
  const associatedCount = [record.contactId, record.companyId, record.dealId].filter(Boolean).length;
  const blocked = !loading && (!status?.enabled || activeAccounts.length === 0);

  const wrapSelection = (prefix: string, suffix = prefix) => {
    const el = bodyRef.current;
    if (!el) {
      setBody((prev) => `${prefix}${prev}${suffix}`);
      return;
    }
    const start = el.selectionStart ?? 0;
    const end = el.selectionEnd ?? 0;
    const selected = body.slice(start, end) || 'texto';
    const next = body.slice(0, start) + prefix + selected + suffix + body.slice(end);
    setBody(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + prefix.length, start + prefix.length + selected.length);
    });
  };

  const send = async () => {
    if (!canSend) return;
    setSending(true);
    setError(null);
    const fullBody = [body.trim(), '', signature.trim()].filter(Boolean).join('\n');
    // Persist signature if edited from default stored empty
    if (signature && signature !== (status?.signature || '')) {
      await mailboxApi('/signature', { method: 'PUT', body: { signature } });
    }
    const r = await mailboxApi('/send', {
      method: 'POST',
      body: {
        accountId,
        to,
        cc: [showCc ? cc : '', showBcc ? bcc : ''].filter((s) => s && s.trim()).join('; '),
        subject,
        body: fullBody,
        track,
        contactId: record.contactId || null,
        companyId: record.companyId || null,
        dealId: record.dealId || null,
      },
    });
    if (!r.ok) {
      setSending(false);
      setError(r.error);
      return;
    }
    if (createFollowUp) {
      try {
        const due = new Date();
        let added = 0;
        while (added < 2) {
          due.setDate(due.getDate() + 1);
          const day = due.getDay();
          if (day !== 0 && day !== 6) added += 1;
        }
        await fetch('/api/tasks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: `Acompanhar e-mail: ${subject.trim()}`,
            type: 'EMAIL',
            priority: 'MEDIUM',
            dueDate: due.toISOString().slice(0, 10),
            dueTime: '09:30',
            contactId: record.contactId || null,
            companyId: record.companyId || null,
            dealId: record.dealId || null,
            queueName: 'Follow-up Comercial',
          }),
        });
      } catch {}
    }
    setSending(false);
    onSent();
  };

  if (minimized) {
    return (
      <div className="fixed bottom-4 right-4 z-[70] w-80 rounded-lg border border-slate-200 bg-white shadow-xl">
        <div className="flex items-center justify-between px-3 py-2 bg-slate-800 text-white rounded-t-lg">
          <button type="button" onClick={() => setMinimized(false)} className="text-xs font-semibold truncate cursor-pointer">
            E-mail{subject ? ` — ${subject}` : ''}
          </button>
          <div className="flex items-center gap-1">
            <button type="button" onClick={() => setMinimized(false)} className="p-1 hover:bg-white/10 rounded cursor-pointer" aria-label="Expandir">
              <Minus className="w-3.5 h-3.5 rotate-180" />
            </button>
            <button type="button" onClick={onClose} className="p-1 hover:bg-white/10 rounded cursor-pointer" aria-label="Fechar">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[70] bg-slate-900/40 flex items-end sm:items-center justify-center p-3 sm:p-4" role="dialog" aria-modal="true" aria-label="E-mail">
      <div className="w-full max-w-3xl bg-white rounded-xl border border-slate-200 shadow-2xl flex flex-col max-h-[92vh]">
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-200 bg-slate-50 rounded-t-xl">
          <h3 className="text-sm font-semibold text-slate-900">E-mail</h3>
          <div className="flex items-center gap-1">
            <button type="button" onClick={() => setMinimized(true)} className="p-1.5 rounded-lg hover:bg-slate-200 text-slate-500 cursor-pointer" aria-label="Minimizar">
              <Minus className="w-4 h-4" />
            </button>
            <button type="button" onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-200 text-slate-500 cursor-pointer" aria-label="Fechar">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="px-4 py-2 border-b border-slate-100 flex flex-wrap items-center gap-2">
          <div className="relative">
            <button type="button" onClick={() => { setShowTemplates((v) => !v); setShowProposals(false); }} className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer">
              <LayoutTemplate className="w-3.5 h-3.5" /> Modelos
            </button>
            {showTemplates && (
              <div className="absolute left-0 top-full mt-1 z-10 w-64 max-h-56 overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-xl p-1">
                {templates.length === 0 ? (
                  <p className="px-2 py-2 text-[11px] font-semibold text-slate-500">Nenhum modelo disponível.</p>
                ) : (
                  templates.map((tpl) => (
                    <button
                      key={tpl.id}
                      type="button"
                      onClick={() => {
                        setSubject(tpl.subject || subject);
                        setBody(tpl.body || body);
                        setShowTemplates(false);
                      }}
                      className="w-full text-left px-2 py-1.5 rounded hover:bg-slate-50 text-xs font-semibold text-slate-700 cursor-pointer"
                    >
                      {tpl.name}
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
          <div className="relative">
            <button type="button" onClick={() => { setShowProposals((v) => !v); setShowTemplates(false); }} className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer">
              <FileText className="w-3.5 h-3.5" /> Orçamentos/Propostas
            </button>
            {showProposals && (
              <div className="absolute left-0 top-full mt-1 z-10 w-72 max-h-56 overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-xl p-1">
                {proposals.length === 0 ? (
                  <p className="px-2 py-2 text-[11px] font-semibold text-slate-500">Nenhuma proposta vinculada.</p>
                ) : (
                  proposals.map((prop) => (
                    <button
                      key={prop.id}
                      type="button"
                      onClick={() => {
                        const link = `${typeof window !== 'undefined' ? window.location.origin : ''}/proposta/${prop.id}`;
                        setBody((prev) => `${prev.trim() ? `${prev.trim()}\n\n` : ''}Proposta ${prop.code}: ${link}`);
                        setShowProposals(false);
                      }}
                      className="w-full text-left px-2 py-1.5 rounded hover:bg-slate-50 text-xs font-semibold text-slate-700 cursor-pointer"
                    >
                      {prop.code} — {prop.title}
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
          {recordLabel && <span className="text-[11px] font-semibold text-slate-400 ml-auto truncate">Associado a: {recordLabel}</span>}
        </div>

        <div className="p-4 space-y-2 overflow-y-auto flex-1">
          {loading ? (
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-500">
              <Loader2 className="w-4 h-4 animate-spin" /> Carregando...
            </div>
          ) : blocked ? (
            <p className="text-xs font-semibold text-slate-600 bg-slate-50 border border-slate-200 rounded-lg p-3">
              Conecte sua caixa em Minha conta
            </p>
          ) : null}

          {!loading && (
            <>
              <div className="flex items-center gap-2 border-b border-slate-100 py-1.5">
                <span className="text-xs font-semibold text-slate-500 w-12 shrink-0">De</span>
                {activeAccounts.length ? (
                  <select value={accountId} onChange={(e) => setAccountId(e.target.value)} className="flex-1 text-xs font-semibold border-0 focus:ring-0 p-0 bg-transparent">
                    {activeAccounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.displayName ? `${a.displayName} <${a.mailboxAddress}>` : a.mailboxAddress}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="text-xs font-semibold text-slate-500">Conecte sua caixa em Minha conta</span>
                )}
              </div>
              <div className="flex items-start gap-2 border-b border-slate-100 py-1.5">
                <span className="text-xs font-semibold text-slate-500 w-12 shrink-0 pt-1">Para</span>
                <div className="flex-1 min-w-0">
                  <input value={to} onChange={(e) => setTo(e.target.value)} placeholder="contato@empresa.com.br" className="w-full text-xs font-semibold border-0 focus:ring-0 p-0" />
                  {extraSuggestions.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {extraSuggestions.map((s) => (
                        <button key={s} type="button" onClick={() => setTo((cur) => (cur.trim() ? `${cur.trim().replace(/[;,]\s*$/, '')}; ${s}` : s))} className="px-1.5 py-0.5 rounded bg-slate-100 text-[10px] font-semibold text-slate-600 cursor-pointer">
                          + {s}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {!showCc && (
                    <button type="button" onClick={() => setShowCc(true)} className="text-[11px] font-semibold text-slate-500 hover:underline cursor-pointer">Cc</button>
                  )}
                  {!showBcc && (
                    <button type="button" onClick={() => setShowBcc(true)} className="text-[11px] font-semibold text-slate-500 hover:underline cursor-pointer">Cco</button>
                  )}
                </div>
              </div>
              {showCc && (
                <div className="flex items-center gap-2 border-b border-slate-100 py-1.5">
                  <span className="text-xs font-semibold text-slate-500 w-12 shrink-0">Cc</span>
                  <input value={cc} onChange={(e) => setCc(e.target.value)} className="flex-1 text-xs font-semibold border-0 focus:ring-0 p-0" />
                </div>
              )}
              {showBcc && (
                <div className="flex items-center gap-2 border-b border-slate-100 py-1.5">
                  <span className="text-xs font-semibold text-slate-500 w-12 shrink-0">Cco</span>
                  <input value={bcc} onChange={(e) => setBcc(e.target.value)} className="flex-1 text-xs font-semibold border-0 focus:ring-0 p-0" />
                </div>
              )}
              <div className="flex items-center gap-2 border-b border-slate-100 py-1.5">
                <span className="text-xs font-semibold text-slate-500 w-12 shrink-0">Assunto</span>
                <input value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={200} className="flex-1 text-xs font-semibold border-0 focus:ring-0 p-0" />
              </div>

              <textarea
                ref={bodyRef}
                rows={8}
                maxLength={20000}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="Escreva sua mensagem..."
                className="w-full text-sm text-slate-800 border-0 focus:ring-0 p-1 resize-y min-h-[140px]"
              />

              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <textarea
                  rows={7}
                  maxLength={4000}
                  value={signature}
                  onChange={(e) => setSignature(e.target.value)}
                  className="w-full text-xs text-slate-700 bg-transparent border-0 focus:ring-0 p-0 whitespace-pre-line font-semibold"
                  aria-label="Assinatura"
                />
              </div>
              <label className="flex items-center gap-2 text-xs font-semibold text-slate-700 cursor-pointer">
                <input type="checkbox" checked={track} onChange={(e) => setTrack(e.target.checked)} className="accent-accent" />
                Rastrear aberturas e cliques
              </label>
            </>
          )}
          {error && (
            <p role="alert" className="text-xs font-semibold text-slate-800 bg-slate-50 border border-slate-300 rounded-lg p-2.5">
              {error}
            </p>
          )}
        </div>

        <div className="px-4 py-3 border-t border-slate-200 flex flex-col gap-1.5">
          {(sendDisabledReason || error) && (
            <p className="text-[11px] font-semibold text-slate-600 text-right" data-testid="crm-mail-send-reason">
              {error ? error : sendDisabledReason}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1 mr-1">
              <button type="button" onClick={() => wrapSelection('**', '**')} className="p-1.5 rounded hover:bg-slate-100 text-slate-600 cursor-pointer" title="Negrito" aria-label="Negrito"><Bold className="w-3.5 h-3.5" /></button>
              <button type="button" onClick={() => wrapSelection('_', '_')} className="p-1.5 rounded hover:bg-slate-100 text-slate-600 cursor-pointer" title="Itálico" aria-label="Itálico"><Italic className="w-3.5 h-3.5" /></button>
              <button type="button" onClick={() => wrapSelection('__', '__')} className="p-1.5 rounded hover:bg-slate-100 text-slate-600 cursor-pointer" title="Sublinhar" aria-label="Sublinhar"><Underline className="w-3.5 h-3.5" /></button>
              <button type="button" onClick={() => setBody((b) => b.replace(/\*\*|__|_/g, ''))} className="p-1.5 rounded hover:bg-slate-100 text-slate-600 cursor-pointer" title="Limpar formatação" aria-label="Limpar formatação"><RemoveFormatting className="w-3.5 h-3.5" /></button>
              <button type="button" onClick={() => wrapSelection('[', '](https://)')} className="p-1.5 rounded hover:bg-slate-100 text-slate-600 cursor-pointer" title="Link" aria-label="Link"><Link2 className="w-3.5 h-3.5" /></button>
            </div>
            <span className="text-[11px] font-semibold text-slate-500">Associado a {associatedCount} registro{associatedCount === 1 ? '' : 's'}</span>
            <div className="flex-1" />
            <label className="flex items-center gap-2 text-[11px] font-semibold text-slate-600 cursor-pointer mr-2">
              <input type="checkbox" checked={createFollowUp} onChange={(e) => setCreateFollowUp(e.target.checked)} className="accent-accent" />
              Criar uma tarefa para acompanhar em 2 dias úteis
            </label>
            <button type="button" onClick={onClose} className={BTN_OUTLINE}>
              Cancelar
            </button>
            <button
              type="button"
              onClick={send}
              disabled={!canSend}
              title={sendDisabledReason || undefined}
              aria-disabled={!canSend}
              className={BTN_PRIMARY}
            >
              {sending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />} Enviar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
