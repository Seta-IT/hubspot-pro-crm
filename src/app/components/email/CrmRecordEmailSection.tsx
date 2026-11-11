'use client';
// Ficha de contato, empresa ou negocio: botao "E-mail" (compositor pela caixa Outlook do
// proprio usuario, com assinatura) e a linha do tempo de e-mails enviados e recebidos, com
// aberturas e cliques. Estilo: cartao branco, so o botao principal em azul-marinho.
import { useCallback, useEffect, useState } from 'react';
import { ArrowDownLeft, ArrowUpRight, Eye, Loader2, Mail, MousePointerClick, RefreshCw } from 'lucide-react';
import {
  BTN_OUTLINE,
  BTN_PRIMARY,
  CARD,
  formatEmailDate,
  mailboxApi,
  recordQuery,
  TAG_GRAY,
  type EmailRecordRef,
  type TimelineEmailView,
} from './mailbox-client';
import { CrmEmailComposerModal } from './CrmEmailComposerModal';
import type { ComposerContactInput, ComposerRecordKind } from '../../lib/email-composer';

export { CrmEmailComposerModal } from './CrmEmailComposerModal';
export { CONFIDENTIALITY_NOTE_1, CONFIDENTIALITY_NOTE_2, DEFAULT_SETA_SIGNATURE } from './email-signature';

export interface CrmRecordEmailSectionProps {
  record: EmailRecordRef;
  recordKind?: ComposerRecordKind;
  /** Destinatario sugerido (ex.: e-mail do contato principal). */
  defaultTo?: string | null;
  /** Outros e-mails da ficha (contatos vinculados) para escolher rapidamente. */
  suggestions?: string[];
  /** Nome exibido no titulo do compositor. */
  recordLabel?: string;
  contact?: ComposerContactInput | null;
  company?: { id: string; name?: string | null; domain?: string | null } | null;
  deal?: { id: string; title?: string | null; value?: number | null } | null;
  associatedContacts?: ComposerContactInput[];
  canSendEmail?: boolean;
}

export default function CrmRecordEmailSection({
  record,
  recordKind,
  defaultTo,
  suggestions = [],
  recordLabel,
  contact,
  company,
  deal,
  associatedContacts,
  canSendEmail = false,
}: CrmRecordEmailSectionProps) {
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
          <button
            type="button"
            onClick={() => setComposerOpen(true)}
            disabled={!canSendEmail}
            title={canSendEmail ? 'Escrever e-mail' : 'Seu perfil não tem permissão para enviar e-mail do CRM.'}
            className={BTN_PRIMARY}
          >
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
          recordKind={recordKind}
          defaultTo={defaultTo || ''}
          suggestions={suggestions}
          recordLabel={recordLabel}
          contact={contact}
          company={company}
          deal={deal}
          associatedContacts={associatedContacts}
          canSendEmail={canSendEmail}
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

