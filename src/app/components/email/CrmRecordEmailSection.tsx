'use client';
// Ficha de contato, empresa ou negocio: botao "E-mail" (compositor pela caixa Outlook do
// proprio usuario, com assinatura) e a linha do tempo de e-mails enviados e recebidos, com
// aberturas e cliques. Estilo: cartao branco, so o botao principal em azul-marinho.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowDownLeft, ArrowUpRight, Loader2, Mail, MousePointerClick, RefreshCw, Send, X, Eye } from 'lucide-react';
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
  const [showCc, setShowCc] = useState(false);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [track, setTrack] = useState(true);
  const [signature, setSignature] = useState('');
  const [editingSignature, setEditingSignature] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const r = await mailboxApi<MailboxStatusView>('/status');
      if (r.ok && r.data) {
        setStatus(r.data);
        setSignature(r.data.signature || '');
        const active = r.data.accounts.filter((a) => a.status === 'ATIVADO');
        if (active[0]) setAccountId(active[0].id);
      } else {
        setError(r.error);
      }
      setLoading(false);
    })();
  }, []);

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

  const send = async () => {
    if (!canSend) return;
    setSending(true);
    setError(null);
    if (editingSignature) {
      const s = await mailboxApi('/signature', { method: 'PUT', body: { signature } });
      if (!s.ok) {
        setError(s.error);
        setSending(false);
        return;
      }
    }
    const r = await mailboxApi('/send', {
      method: 'POST',
      body: {
        accountId,
        to,
        cc: showCc ? cc : '',
        subject,
        body,
        track,
        contactId: record.contactId || null,
        companyId: record.companyId || null,
        dealId: record.dealId || null,
      },
    });
    setSending(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    onSent();
  };

  const blocked = !loading && (!status?.enabled || activeAccounts.length === 0);

  return (
    <div className="fixed inset-0 z-[70] bg-slate-900/40 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Novo e-mail">
      <div className="w-full max-w-2xl bg-white rounded-xl border border-slate-200 shadow-xl flex flex-col max-h-[92vh]">
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">Novo e-mail</h3>
            {recordLabel && <p className="text-[11px] font-semibold text-slate-500">Registrado em: {recordLabel}</p>}
          </div>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 cursor-pointer" aria-label="Fechar">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-3 overflow-y-auto">
          {loading ? (
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-500">
              <Loader2 className="w-4 h-4 animate-spin" /> Carregando...
            </div>
          ) : blocked ? (
            <p className="text-xs font-semibold text-slate-600 bg-slate-50 border border-slate-200 rounded-lg p-3">
              {!status?.enabled
                ? status?.message || 'A conexão de caixas de e-mail ainda não foi liberada pelo administrador.'
                : 'Conecte sua caixa do Outlook em Minha Conta para enviar e-mails pelo seu endereço.'}
            </p>
          ) : null}

          {!loading && !blocked && (
            <>
              <div>
                <label className={LABEL} htmlFor="crm-mail-from">De</label>
                <select id="crm-mail-from" value={accountId} onChange={(e) => setAccountId(e.target.value)} className={INPUT}>
                  {activeAccounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.displayName ? `${a.displayName} <${a.mailboxAddress}>` : a.mailboxAddress}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <div className="flex items-center justify-between">
                  <label className={LABEL} htmlFor="crm-mail-to">Para</label>
                  {!showCc && (
                    <button type="button" onClick={() => setShowCc(true)} className="text-[11px] font-semibold text-slate-600 hover:underline cursor-pointer">
                      Adicionar Cc
                    </button>
                  )}
                </div>
                <input id="crm-mail-to" type="text" value={to} onChange={(e) => setTo(e.target.value)} placeholder="nome@empresa.com.br; outro@empresa.com.br" className={INPUT} />
                {extraSuggestions.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-1.5">
                    {extraSuggestions.map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => setTo((cur) => (cur.trim() ? `${cur.trim().replace(/[;,]\s*$/, '')}; ${s}` : s))}
                        className={`${TAG_GRAY} normal-case cursor-pointer hover:bg-slate-200`}
                      >
                        + {s}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {showCc && (
                <div>
                  <label className={LABEL} htmlFor="crm-mail-cc">Cc</label>
                  <input id="crm-mail-cc" type="text" value={cc} onChange={(e) => setCc(e.target.value)} className={INPUT} />
                </div>
              )}
              <div>
                <label className={LABEL} htmlFor="crm-mail-subject">Assunto</label>
                <input id="crm-mail-subject" type="text" maxLength={200} value={subject} onChange={(e) => setSubject(e.target.value)} className={INPUT} />
              </div>
              <div>
                <label className={LABEL} htmlFor="crm-mail-body">Mensagem</label>
                <textarea id="crm-mail-body" rows={9} maxLength={20000} value={body} onChange={(e) => setBody(e.target.value)} className={`${INPUT} font-normal`} />
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold text-slate-600">Assinatura</span>
                  <button type="button" onClick={() => setEditingSignature((v) => !v)} className="text-[11px] font-semibold text-slate-600 hover:underline cursor-pointer">
                    {editingSignature ? 'Ocultar edição' : 'Editar assinatura'}
                  </button>
                </div>
                {editingSignature ? (
                  <textarea rows={4} maxLength={4000} value={signature} onChange={(e) => setSignature(e.target.value)} className={INPUT} aria-label="Assinatura" />
                ) : signature ? (
                  <p className="text-xs text-slate-700 whitespace-pre-line">{signature}</p>
                ) : (
                  <p className="text-xs font-semibold text-slate-500">Sem assinatura.</p>
                )}
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

        <div className="flex flex-col items-stretch gap-1.5 px-5 py-3 border-t border-slate-200">
          {(sendDisabledReason || error) && (
            <p className="text-[11px] font-semibold text-slate-600 text-right" data-testid="crm-mail-send-reason">
              {error ? error : sendDisabledReason}
            </p>
          )}
          <div className="flex items-center justify-end gap-2">
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
