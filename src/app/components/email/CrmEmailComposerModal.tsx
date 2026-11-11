'use client';
// Janela flutuante de e-mail no padrão HubSpot, usada nas fichas de negócio, contato e empresa.
// Envio pela caixa Outlook do usuário (Graph). Sem backdrop: fica no canto inferior direito.
import { useEffect, useMemo, useRef, useState, type ClipboardEvent, type ReactNode } from 'react';
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  ChevronDown,
  Italic,
  Underline,
  RemoveFormatting,
  Link2,
  Image as ImageIcon,
  Paperclip,
  Plus,
  List,
  ListOrdered,
  LayoutTemplate,
  FileText,
  Calendar,
  Lock,
  Loader2,
  Mail,
  Minus,
  Maximize2,
  Minimize2,
  Send,
  X,
} from 'lucide-react';
import { requestSignedProposalLink } from '../../lib/proposal-link-client';
import {
  COMPOSER_TIMEZONE,
  FOLLOW_UP_PRESETS,
  NO_SEND_PERMISSION_REASON,
  associationsForMailboxSend,
  countTimelineAssociations,
  defaultRecipientsForRecord,
  defaultTimelineAssociations,
  fillTemplateVars,
  followUpDueYmd,
  formatFollowUpOptionLabel,
  todayYmd,
  type ComposerContactInput,
  type ComposerRecipient,
  type ComposerRecordKind,
  type FollowUpPreset,
  type TemplateVarContext,
  type TimelineAssociations,
} from '../../lib/email-composer';
import {
  BTN_PRIMARY,
  mailboxApi,
  mailboxSendDisabledReason,
  type EmailRecordRef,
  type MailboxStatusView,
} from './mailbox-client';
import { CONFIDENTIALITY_NOTE_1, CONFIDENTIALITY_NOTE_2, DEFAULT_SETA_SIGNATURE, SETA_LOGO_ALT, SETA_LOGO_PUBLIC_PATH } from './email-signature';
import { htmlToPlainText, isEmptyEmailHtml, plainTextToHtml, sanitizeEmailHtml, sanitizeHref } from '../../../modules/email/email-html';
import {
  ALLOWED_ATTACHMENT_TYPES,
  MAILBOX_MAX_ATTACHMENT_BYTES,
  INLINE_IMAGE_TYPES,
  MAILBOX_ATTACHMENT_LIMIT,
  MAILBOX_ATTACHMENT_TOO_LARGE,
  MAILBOX_ATTACHMENT_TYPE_DENIED,
  MAILBOX_MAX_ATTACHMENTS,
  MAILBOX_MAX_ATTACHMENT_TOTAL_BYTES,
  extensionOf,
  sanitizeAttachmentFilename,
} from '../../../modules/email/mailbox-attachments';

export interface CrmEmailComposerModalProps {
  record: EmailRecordRef;
  recordKind?: ComposerRecordKind;
  defaultTo?: string;
  suggestions?: string[];
  recordLabel?: string;
  contact?: ComposerContactInput | null;
  company?: { id: string; name?: string | null; domain?: string | null } | null;
  deal?: { id: string; title?: string | null; value?: number | null } | null;
  associatedContacts?: ComposerContactInput[];
  canSendEmail?: boolean;
  onClose: () => void;
  onSent: () => void;
}

type TabId = 'templates' | 'sequences' | 'documents' | 'meetings' | 'quotes';

interface EmailTemplateView {
  id: string;
  name: string;
  subject: string;
  body: string;
}

interface SequenceView {
  id: string;
  name: string;
  isActive?: boolean;
}

interface ProposalView {
  id: string;
  code: string;
  title: string;
}

interface ComposerAttachment {
  id: string;
  filename: string;
  contentType: string;
  contentBase64: string;
  size: number;
}

/** Troca a prévia blob: por cid:stihub-inline-N e remove qualquer img remota antes do envio. */
function serializeComposerHtml(raw: string): string {
  const replaced = String(raw || '').replace(/<img\b[^>]*>/gi, (tag) => {
    const slot = /data-stihub-inline=["']?(\d{1,2})["']?/i.exec(tag);
    if (!slot) return '';
    const altM = /\balt="([^"]*)"/i.exec(tag);
    const alt = altM ? altM[1] : '';
    return `<img src="cid:stihub-inline-${Number(slot[1])}" alt="${alt}" />`;
  });
  return sanitizeEmailHtml(replaced);
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('read'));
    reader.onload = () => {
      const r = String(reader.result || '');
      const comma = r.indexOf(',');
      resolve(comma >= 0 ? r.slice(comma + 1) : r);
    };
    reader.readAsDataURL(file);
  });
}

function inferKind(record: EmailRecordRef, explicit?: ComposerRecordKind): ComposerRecordKind {
  if (explicit) return explicit;
  if (record.dealId) return 'deal';
  if (record.companyId && !record.contactId) return 'company';
  if (record.contactId) return 'contact';
  if (record.companyId) return 'company';
  return 'deal';
}

function parseEmails(raw: string): string[] {
  return String(raw || '')
    .split(/[;,]/)
    .map((s) => s.trim())
    .filter((s) => s.includes('@'));
}

export function CrmEmailComposerModal({
  record,
  recordKind,
  defaultTo = '',
  suggestions = [],
  recordLabel,
  contact,
  company,
  deal,
  associatedContacts = [],
  canSendEmail = false,
  onClose,
  onSent,
}: CrmEmailComposerModalProps) {
  const kind = inferKind(record, recordKind);
  const [status, setStatus] = useState<MailboxStatusView | null>(null);
  const [loading, setLoading] = useState(true);
  const [accountId, setAccountId] = useState('');
  const [recipients, setRecipients] = useState<ComposerRecipient[]>(() => {
    const fromRecord = defaultRecipientsForRecord({ kind, contact, associatedContacts });
    if (fromRecord.length) return fromRecord;
    return parseEmails(defaultTo).map((email) => ({ email, name: '', contactId: null }));
  });
  const [toQuery, setToQuery] = useState('');
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
  const [expanded, setExpanded] = useState(false);
  const [createFollowUp, setCreateFollowUp] = useState(true);
  const [followUpPreset, setFollowUpPreset] = useState<FollowUpPreset>('business_2');
  const [customFollowUpDate, setCustomFollowUpDate] = useState('');
  const [followUpQueue] = useState('Tarefas');
  const [templates, setTemplates] = useState<EmailTemplateView[]>([]);
  const [sequences, setSequences] = useState<SequenceView[]>([]);
  const [proposals, setProposals] = useState<ProposalView[]>([]);
  const [activeTab, setActiveTab] = useState<TabId | null>(null);
  const [showMoreFmt, setShowMoreFmt] = useState(false);
  const [showInsert, setShowInsert] = useState(false);
  const [showAssoc, setShowAssoc] = useState(false);
  const [showSendMenu, setShowSendMenu] = useState(false);
  const [contactHits, setContactHits] = useState<ComposerContactInput[]>([]);
  const [enrolling, setEnrolling] = useState(false);
  const [insertingQuote, setInsertingQuote] = useState(false);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const imageRef = useRef<HTMLInputElement | null>(null);
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  const [inlineImages, setInlineImages] = useState<(ComposerAttachment & { previewUrl: string })[]>([]);
  const [associations, setAssociations] = useState<TimelineAssociations>(() =>
    defaultTimelineAssociations({ kind, deal: deal || (record.dealId ? { id: record.dealId, title: recordLabel } : null), contact, company })
  );

  const varCtx: TemplateVarContext = useMemo(
    () => ({
      contact: contact || (recipients[0] ? { firstName: recipients[0].name.split(' ')[0], email: recipients[0].email, name: recipients[0].name } : null),
      company,
      deal,
    }),
    [contact, company, deal, recipients]
  );

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
          setTemplates((j.data || []).slice(0, 30));
        }
      } catch {
        /* modelos são opcionais */
      }
    })();
    (async () => {
      try {
        const res = await fetch('/api/sequences', { cache: 'no-store' });
        if (res.ok) {
          const j = await res.json();
          setSequences((j.data || []).slice(0, 30));
        }
      } catch {
        /* sequências opcionais */
      }
    })();
    (async () => {
      if (!record.dealId && !record.companyId) return;
      try {
        const qs = record.dealId
          ? `dealId=${encodeURIComponent(record.dealId)}`
          : `companyId=${encodeURIComponent(record.companyId || '')}`;
        const res = await fetch(`/api/erp/proposals?${qs}`, { cache: 'no-store' });
        if (res.ok) {
          const j = await res.json();
          const list = (j.data || j.proposals || []).slice(0, 20).map((p: { id: string; code?: string; proposalNumber?: string; title?: string }) => ({
            id: p.id,
            code: p.code || p.proposalNumber || p.id,
            title: p.title || 'Proposta',
          }));
          setProposals(list);
        }
      } catch {
        /* orçamentos opcionais */
      }
    })();
  }, [record.dealId, record.companyId]);

  useEffect(() => {
    const q = toQuery.trim();
    if (q.length < 2) {
      setContactHits([]);
      return;
    }
    const ctrl = new AbortController();
    const t = window.setTimeout(async () => {
      try {
        const res = await fetch(`/api/contacts?search=${encodeURIComponent(q)}`, { cache: 'no-store', signal: ctrl.signal });
        if (!res.ok) return;
        const j = await res.json();
        const list = (j.data || []) as ComposerContactInput[];
        setContactHits(list.filter((c) => c.email).slice(0, 8));
      } catch {
        /* autocomplete silencioso */
      }
    }, 200);
    return () => {
      window.clearTimeout(t);
      ctrl.abort();
    };
  }, [toQuery]);

  const activeAccounts = useMemo(() => (status?.accounts || []).filter((a) => a.status === 'ATIVADO'), [status]);
  const toLine = recipients.map((r) => r.email).join('; ');
  const today = todayYmd(new Date(), COMPOSER_TIMEZONE);
  const followUpLabel = useMemo(
    () => formatFollowUpOptionLabel(followUpPreset, today, customFollowUpDate || null),
    [followUpPreset, customFollowUpDate, today]
  );

  const permissionBlocked = !canSendEmail;
  const sendDisabledReason = permissionBlocked
    ? NO_SEND_PERMISSION_REASON
    : mailboxSendDisabledReason({
        loading,
        enabled: status?.enabled,
        activeAccountCount: activeAccounts.length,
        to: toLine,
        subject,
        sending,
        statusMessage: status?.message,
      });
  const canSend = !sendDisabledReason;
  const associatedCount = countTimelineAssociations(associations);
  const blockedMailbox = !loading && (!status?.enabled || activeAccounts.length === 0);
  const sequencesLocked = !associations.contactId;
  const quotesLocked = proposals.length === 0;

  const addRecipient = (r: ComposerRecipient) => {
    const key = r.email.trim().toLowerCase();
    setRecipients((cur) => (cur.some((x) => x.email.toLowerCase() === key) ? cur : [...cur, r]));
    setToQuery('');
    setContactHits([]);
    if (r.contactId && !associations.contactId) {
      setAssociations((a) => ({ ...a, contactId: r.contactId, contactLabel: r.name || r.email }));
    }
  };

  const addRecipientFromQuery = () => {
    const emails = parseEmails(toQuery);
    if (!emails.length) return;
    emails.forEach((email) => addRecipient({ email, name: '', contactId: null }));
  };

  const syncBodyFromEditor = () => {
    const el = bodyRef.current;
    if (!el) return;
    setBody(sanitizeEmailHtml(el.innerHTML || ''));
  };

  const focusEditor = () => {
    bodyRef.current?.focus();
  };

  const runFormat = (cmd: string, value?: string) => {
    focusEditor();
    document.execCommand(cmd, false, value);
    syncBodyFromEditor();
  };

  const insertSafeHtml = (html: string) => {
    focusEditor();
    const safe = sanitizeEmailHtml(html);
    if (!safe) return;
    document.execCommand('insertHTML', false, safe);
    syncBodyFromEditor();
  };

  const applyTemplate = (tpl: EmailTemplateView) => {
    setSubject(fillTemplateVars(tpl.subject || subject, varCtx));
    const next = sanitizeEmailHtml(plainTextToHtml(fillTemplateVars(tpl.body || '', varCtx)));
    setBody(next);
    if (bodyRef.current) bodyRef.current.innerHTML = next;
    setActiveTab(null);
  };

  const insertText = (chunk: string) => {
    insertSafeHtml(plainTextToHtml(chunk));
  };

  const insertProposalLink = async (proposalId: string) => {
    setInsertingQuote(true);
    setError(null);
    const r = await requestSignedProposalLink(proposalId);
    setInsertingQuote(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    const href = sanitizeHref(r.url);
    if (!href) {
      setError('O link da proposta é inválido.');
      return;
    }
    insertSafeHtml(`<a href="${href}">${href}</a>`);
    setActiveTab(null);
    setShowInsert(false);
  };

  const onEditorPaste = (e: ClipboardEvent<HTMLDivElement>) => {
    e.preventDefault();
    const html = e.clipboardData.getData('text/html');
    const text = e.clipboardData.getData('text/plain');
    insertSafeHtml(html ? sanitizeEmailHtml(html) : plainTextToHtml(text));
  };

  const addFiles = async (fileList: FileList | null) => {
    if (!fileList || !fileList.length) return;
    setError(null);
    const next = [...attachments];
    for (const file of Array.from(fileList)) {
      if (next.length + inlineImages.length >= MAILBOX_MAX_ATTACHMENTS) {
        setError(MAILBOX_ATTACHMENT_LIMIT);
        break;
      }
      const filename = sanitizeAttachmentFilename(file.name);
      const ext = filename ? extensionOf(filename) : '';
      const mime = ext ? ALLOWED_ATTACHMENT_TYPES[ext] : null;
      if (!filename || !mime) {
        setError(MAILBOX_ATTACHMENT_TYPE_DENIED);
        continue;
      }
      if (file.size > MAILBOX_MAX_ATTACHMENT_BYTES) {
        setError(MAILBOX_ATTACHMENT_TOO_LARGE);
        continue;
      }
      const already = next.reduce((n, a) => n + a.size, 0) + inlineImages.reduce((n, a) => n + a.size, 0);
      if (already + file.size > MAILBOX_MAX_ATTACHMENT_TOTAL_BYTES) {
        setError(MAILBOX_ATTACHMENT_TOO_LARGE);
        break;
      }
      try {
        const contentBase64 = await fileToBase64(file);
        next.push({
          id: `att-${Date.now()}-${next.length}`,
          filename,
          contentType: mime,
          contentBase64,
          size: file.size,
        });
      } catch {
        setError('Não foi possível ler o arquivo.');
      }
    }
    setAttachments(next);
    if (fileRef.current) fileRef.current.value = '';
  };

  const addInlineImage = async (fileList: FileList | null) => {
    const file = fileList && fileList[0];
    if (imageRef.current) imageRef.current.value = '';
    if (!file) return;
    setError(null);
    const used = attachments.length + inlineImages.length;
    if (used >= MAILBOX_MAX_ATTACHMENTS) {
      setError(MAILBOX_ATTACHMENT_LIMIT);
      return;
    }
    const filename = sanitizeAttachmentFilename(file.name);
    const ext = filename ? extensionOf(filename) : '';
    const mime = ext ? ALLOWED_ATTACHMENT_TYPES[ext] : null;
    if (!filename || !mime || !INLINE_IMAGE_TYPES.has(mime)) {
      setError(MAILBOX_ATTACHMENT_TYPE_DENIED);
      return;
    }
    if (file.size > MAILBOX_MAX_ATTACHMENT_BYTES) {
      setError(MAILBOX_ATTACHMENT_TOO_LARGE);
      return;
    }
    const already = attachments.reduce((n, a) => n + a.size, 0) + inlineImages.reduce((n, a) => n + a.size, 0);
    if (already + file.size > MAILBOX_MAX_ATTACHMENT_TOTAL_BYTES) {
      setError(MAILBOX_ATTACHMENT_TOO_LARGE);
      return;
    }
    try {
      const contentBase64 = await fileToBase64(file);
      const previewUrl = URL.createObjectURL(file);
      const slot = inlineImages.length;
      setInlineImages((cur) => [...cur, { id: `img-${Date.now()}`, filename, contentType: mime, contentBase64, size: file.size, previewUrl }]);
      focusEditor();
      document.execCommand(
        'insertHTML',
        false,
        sanitizeEmailHtml(`<img src="${previewUrl}" data-stihub-inline="${slot}" alt="${filename}" />`, { allowComposerPreview: true })
      );
      syncBodyFromEditor();
    } catch {
      setError('Não foi possível ler a imagem.');
    }
  };

  const enrollInSequence = async (sequenceId: string) => {
    if (!associations.contactId) {
      setError('Escolha um contato associado para inscrever na sequência.');
      return;
    }
    setEnrolling(true);
    setError(null);
    try {
      const res = await fetch('/api/sequences/enroll', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sequenceId,
          contactId: associations.contactId,
          dealId: associations.dealId || null,
        }),
      });
      const j = await res.json().catch(() => null);
      if (!res.ok) {
        setError((j && typeof j.error === 'string' && j.error) || 'Não foi possível inscrever o contato na sequência.');
        return;
      }
      setActiveTab(null);
    } finally {
      setEnrolling(false);
    }
  };

  const send = async () => {
    if (!canSend) return;
    setSending(true);
    setError(null);
    if (signature && signature !== (status?.signature || '')) {
      const saved = await mailboxApi('/signature', { method: 'PUT', body: { signature } });
      if (!saved.ok) {
        setSending(false);
        setError(saved.error || 'Não foi possível salvar a assinatura.');
        return;
      }
    }
    const assoc = associationsForMailboxSend(associations);
    if (!assoc.contactId && !assoc.companyId && !assoc.dealId) {
      setSending(false);
      setError('Associe o e-mail a um negócio, contato ou empresa.');
      return;
    }
    const r = await mailboxApi('/send', {
      method: 'POST',
      body: {
        accountId,
        to: toLine,
        cc: showCc ? cc : '',
        bcc: showBcc ? bcc : '',
        subject,
        body: serializeComposerHtml(bodyRef.current?.innerHTML || body),
        bodyFormat: 'html',
        track,
        contactId: assoc.contactId,
        companyId: assoc.companyId,
        dealId: assoc.dealId,
        attachments: attachments.map((a) => ({
          filename: a.filename,
          contentType: a.contentType,
          contentBase64: a.contentBase64,
        })),
        inlineImages: inlineImages.map((a) => ({
          filename: a.filename,
          contentType: a.contentType,
          contentBase64: a.contentBase64,
        })),
      },
    });
    if (!r.ok) {
      setSending(false);
      setError(r.error);
      return;
    }
    try {
      await fetch('/api/timeline', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'EMAIL',
          title: subject.trim(),
          body: htmlToPlainText(bodyRef.current?.innerHTML || body).slice(0, 2000),
          ...assoc,
        }),
      });
    } catch {
      /* a timeline de e-mails do mailbox já registra o envio */
    }
    if (createFollowUp) {
      try {
        const due = followUpDueYmd(followUpPreset, todayYmd(new Date(), COMPOSER_TIMEZONE), customFollowUpDate || null);
        await fetch('/api/tasks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: `Acompanhar e-mail: ${subject.trim()}`,
            type: 'EMAIL',
            priority: 'MEDIUM',
            dueDate: due,
            dueTime: '09:30',
            contactId: assoc.contactId,
            companyId: assoc.companyId,
            dealId: assoc.dealId,
            queueName: followUpQueue,
          }),
        });
      } catch {
        /* a tarefa é complementar ao envio */
      }
    }
    setSending(false);
    onSent();
  };

  const widthClass = expanded ? 'w-[min(920px,calc(100vw-2rem))] h-[min(760px,calc(100vh-2rem))]' : 'w-[min(560px,calc(100vw-1.5rem))]';

  if (minimized) {
    return (
      <div className="fixed bottom-0 right-4 z-[70] w-80 rounded-t-lg border border-slate-200 bg-white shadow-xl">
        <div className="flex items-center justify-between px-3 py-2 bg-slate-800 text-white rounded-t-lg">
          <button type="button" onClick={() => setMinimized(false)} className="text-xs font-semibold truncate cursor-pointer">
            E-mail{subject ? ` — ${subject}` : recordLabel ? ` — ${recordLabel}` : ''}
          </button>
          <div className="flex items-center gap-1">
            <button type="button" onClick={() => setMinimized(false)} className="p-1 hover:bg-white/10 rounded cursor-pointer" aria-label="Expandir">
              <Maximize2 className="w-3.5 h-3.5" />
            </button>
            <button type="button" onClick={onClose} className="p-1 hover:bg-white/10 rounded cursor-pointer" aria-label="Fechar">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    );
  }

  const tabBtn = (id: TabId, label: string, icon: ReactNode, locked?: boolean, testId?: string) => (
    <button
      type="button"
      data-testid={testId}
      disabled={locked}
      title={locked ? 'Indisponível neste momento' : label}
      onClick={() => {
        if (locked) return;
        setActiveTab((cur) => (cur === id ? null : id));
        setShowMoreFmt(false);
        setShowInsert(false);
        setShowAssoc(false);
      }}
      className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-semibold cursor-pointer ${
        locked
          ? 'text-slate-400 cursor-not-allowed'
          : activeTab === id
            ? 'bg-slate-100 text-slate-900'
            : 'text-slate-700 hover:bg-slate-50'
      }`}
    >
      {icon}
      {label}
      {locked ? <Lock className="w-3 h-3" /> : null}
    </button>
  );

  return (
    <div
      className={`fixed bottom-0 right-4 z-[70] ${widthClass} bg-white rounded-t-xl border border-slate-200 shadow-2xl flex flex-col max-h-[min(92vh,840px)]`}
      role="dialog"
      aria-modal="false"
      aria-label="E-mail"
    >
      <div className="flex items-center justify-between px-3 py-2 border-b border-slate-200 bg-slate-800 text-white rounded-t-xl shrink-0">
        <h3 className="text-sm font-semibold truncate">E-mail{recordLabel ? ` — ${recordLabel}` : ''}</h3>
        <div className="flex items-center gap-0.5">
          <button type="button" onClick={() => setMinimized(true)} className="p-1.5 rounded hover:bg-white/10 cursor-pointer" aria-label="Minimizar">
            <Minus className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="p-1.5 rounded hover:bg-white/10 cursor-pointer"
            aria-label="Expandir"
          >
            {expanded ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </button>
          <button type="button" onClick={onClose} className="p-1.5 rounded hover:bg-white/10 cursor-pointer" aria-label="Fechar">
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="px-3 py-1.5 border-b border-slate-100 flex flex-wrap items-center gap-1 shrink-0">
        {tabBtn('templates', 'Modelos', <LayoutTemplate className="w-3.5 h-3.5" />, false, 'composer-tab-templates')}
        {tabBtn('sequences', 'Sequências', <Mail className="w-3.5 h-3.5" />, sequencesLocked, 'composer-tab-sequences')}
        {tabBtn('documents', 'Documentos', <FileText className="w-3.5 h-3.5" />, true, 'composer-tab-documents')}
        {tabBtn('meetings', 'Meetings', <Calendar className="w-3.5 h-3.5" />, true, 'composer-tab-meetings')}
        {tabBtn('quotes', 'Orçamentos', <FileText className="w-3.5 h-3.5" />, quotesLocked, 'composer-tab-quotes')}
      </div>

      {activeTab === 'templates' && (
        <div className="border-b border-slate-100 max-h-44 overflow-y-auto p-2 bg-slate-50">
          {templates.length === 0 ? (
            <p className="px-2 py-2 text-[11px] font-semibold text-slate-500">Nenhum modelo disponível.</p>
          ) : (
            templates.map((tpl) => (
              <button
                key={tpl.id}
                type="button"
                onClick={() => applyTemplate(tpl)}
                className="w-full text-left px-2 py-1.5 rounded hover:bg-white text-xs font-semibold text-slate-700 cursor-pointer"
              >
                {tpl.name}
              </button>
            ))
          )}
        </div>
      )}
      {activeTab === 'sequences' && (
        <div className="border-b border-slate-100 max-h-44 overflow-y-auto p-2 bg-slate-50">
          {sequencesLocked ? (
            <p className="px-2 py-2 text-[11px] font-semibold text-slate-500">Associe um contato para inscrever numa sequência.</p>
          ) : sequences.length === 0 ? (
            <p className="px-2 py-2 text-[11px] font-semibold text-slate-500">Nenhuma sequência disponível.</p>
          ) : (
            sequences.map((seq) => (
              <button
                key={seq.id}
                type="button"
                disabled={enrolling}
                onClick={() => void enrollInSequence(seq.id)}
                className="w-full text-left px-2 py-1.5 rounded hover:bg-white text-xs font-semibold text-slate-700 cursor-pointer disabled:opacity-50"
              >
                Inscrever em {seq.name}
              </button>
            ))
          )}
        </div>
      )}
      {activeTab === 'quotes' && (
        <div className="border-b border-slate-100 max-h-44 overflow-y-auto p-2 bg-slate-50">
          {proposals.length === 0 ? (
            <p className="px-2 py-2 text-[11px] font-semibold text-slate-500">Nenhuma proposta ou orçamento neste registro.</p>
          ) : (
            proposals.map((p) => (
              <button
                key={p.id}
                type="button"
                disabled={insertingQuote}
                onClick={() => void insertProposalLink(p.id)}
                className="w-full text-left px-2 py-1.5 rounded hover:bg-white text-xs font-semibold text-slate-700 cursor-pointer disabled:opacity-50"
              >
                {p.code} — {p.title}
              </button>
            ))
          )}
        </div>
      )}

      <div className="px-3 py-1 flex-1 overflow-y-auto min-h-0">
        {loading ? (
          <div className="flex items-center gap-2 py-3 text-xs font-semibold text-slate-500">
            <Loader2 className="w-4 h-4 animate-spin" /> Carregando...
          </div>
        ) : blockedMailbox ? (
          <p className="text-xs font-semibold text-slate-600 bg-slate-50 border border-slate-200 rounded-lg p-3 my-2">
            Conecte sua caixa do Outlook em Minha Conta para enviar e-mails. Sem caixa conectada, nada é enviado.
          </p>
        ) : null}

        {!loading && (
          <>
            <div className="flex items-start gap-2 border-b border-slate-100 py-1.5">
              <span className="text-xs font-semibold text-slate-500 w-12 shrink-0 pt-1.5">Para</span>
              <div className="flex-1 min-w-0 relative">
                <div className="flex flex-wrap items-center gap-1">
                  {recipients.map((r) => (
                    <span key={r.email} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-slate-100 text-[11px] font-semibold text-slate-700">
                      {r.name ? `${r.name} <${r.email}>` : r.email}
                      <button
                        type="button"
                        className="text-slate-400 hover:text-slate-700 cursor-pointer"
                        aria-label={`Remover ${r.email}`}
                        onClick={() => setRecipients((cur) => cur.filter((x) => x.email !== r.email))}
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  ))}
                  <input
                    value={toQuery}
                    onChange={(e) => setToQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ';' || e.key === ',') {
                        e.preventDefault();
                        addRecipientFromQuery();
                      }
                      if (e.key === 'Backspace' && !toQuery && recipients.length) {
                        setRecipients((cur) => cur.slice(0, -1));
                      }
                    }}
                    onBlur={() => addRecipientFromQuery()}
                    placeholder={recipients.length ? 'Adicionar destinatário' : 'contato@empresa.com.br'}
                    className="flex-1 min-w-[8rem] text-xs border-0 focus:ring-0 p-0"
                  />
                </div>
                {(contactHits.length > 0 || suggestions.length > 0) && (
                  <div className="absolute left-0 right-0 top-full z-10 mt-1 max-h-40 overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-xl">
                    {(contactHits.length ? contactHits : suggestions.filter((s) => s.includes('@')).map((email) => ({ id: email, email, firstName: '', lastName: '' }))).map((c) => (
                      <button
                        key={`${c.id}-${c.email}`}
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() =>
                          addRecipient({
                            email: String(c.email),
                            name: [c.firstName, c.lastName].filter(Boolean).join(' ').trim(),
                            contactId: c.id && !String(c.id).includes('@') ? c.id : null,
                          })
                        }
                        className="w-full text-left px-2 py-1.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
                      >
                        {[c.firstName, c.lastName].filter(Boolean).join(' ')} {c.email}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0 pt-1">
                {!showCc && (
                  <button type="button" onClick={() => setShowCc(true)} className="text-[11px] font-semibold text-slate-500 hover:underline cursor-pointer">
                    Cc
                  </button>
                )}
                {!showBcc && (
                  <button type="button" onClick={() => setShowBcc(true)} className="text-[11px] font-semibold text-slate-500 hover:underline cursor-pointer">
                    Cco
                  </button>
                )}
              </div>
            </div>
            {showCc && (
              <div className="flex items-center gap-2 border-b border-slate-100 py-1.5">
                <span className="text-xs font-semibold text-slate-500 w-12 shrink-0">Cc</span>
                <input value={cc} onChange={(e) => setCc(e.target.value)} className="flex-1 text-xs border-0 focus:ring-0 p-0" />
              </div>
            )}
            {showBcc && (
              <div className="flex items-center gap-2 border-b border-slate-100 py-1.5">
                <span className="text-xs font-semibold text-slate-500 w-12 shrink-0">Cco</span>
                <input value={bcc} onChange={(e) => setBcc(e.target.value)} className="flex-1 text-xs border-0 focus:ring-0 p-0" />
              </div>
            )}
            <div className="flex items-center gap-2 border-b border-slate-100 py-1.5">
              <span className="text-xs font-semibold text-slate-500 w-12 shrink-0">De</span>
              {activeAccounts.length ? (
                <select value={accountId} onChange={(e) => setAccountId(e.target.value)} className="flex-1 text-xs border-0 focus:ring-0 p-0 bg-transparent">
                  {activeAccounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.displayName ? `${a.displayName} <${a.mailboxAddress}>` : a.mailboxAddress}
                    </option>
                  ))}
                </select>
              ) : (
                <span className="text-xs font-semibold text-slate-500">Conecte sua caixa em Minha Conta</span>
              )}
            </div>
            <div className="flex items-center gap-2 border-b border-slate-100 py-1.5">
              <span className="text-xs font-semibold text-slate-500 w-12 shrink-0">Assunto</span>
              <input value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={200} placeholder="Assunto" className="flex-1 text-xs border-0 focus:ring-0 p-0" />
            </div>

            <div className="relative">
              {isEmptyEmailHtml(body) ? (
                <span className="pointer-events-none absolute left-1 top-1 text-sm text-slate-400">Escreva sua mensagem...</span>
              ) : null}
              <div
                ref={bodyRef}
                contentEditable
                role="textbox"
                aria-multiline="true"
                aria-label="Corpo do e-mail"
                data-testid="crm-mail-body-editor"
                suppressContentEditableWarning
                onInput={syncBodyFromEditor}
                onPaste={onEditorPaste}
                className="relative w-full text-sm text-slate-800 border-0 focus:ring-0 p-1 resize-y min-h-[120px] outline-none prose-p:my-1"
                style={{ minHeight: expanded ? 220 : 120 }}
              />
            </div>

            <div className="pt-3 mt-1 border-t border-slate-200 space-y-3 text-sm text-slate-800">
              <img src={SETA_LOGO_PUBLIC_PATH} alt={SETA_LOGO_ALT} width={200} height={64} className="h-12 w-auto" />
              <div className="whitespace-pre-line text-sm text-slate-800">{signature.split('\n\nNota de Confidencialidade')[0]}</div>
              {signature.includes('Nota de Confidencialidade') ? (
                <div className="space-y-2 text-xs text-slate-700">
                  <div>
                    <div className="font-semibold text-slate-900">Nota de Confidencialidade 1</div>
                    <p className="mt-0.5 font-normal leading-relaxed">{CONFIDENTIALITY_NOTE_1}</p>
                  </div>
                  <div>
                    <div className="font-semibold text-slate-900">Nota de Confidencialidade 2</div>
                    <p className="mt-0.5 font-normal leading-relaxed">{CONFIDENTIALITY_NOTE_2}</p>
                  </div>
                </div>
              ) : null}
              <details className="text-[11px] text-slate-500">
                <summary className="cursor-pointer font-semibold">Editar assinatura (salva nas suas configurações)</summary>
                <textarea
                  rows={6}
                  maxLength={4000}
                  value={signature}
                  onChange={(e) => setSignature(e.target.value)}
                  className="mt-2 w-full text-xs text-slate-700 border border-slate-200 rounded-md p-2 font-normal"
                  aria-label="Assinatura"
                />
              </details>
            </div>
            <label className="flex items-center gap-2 text-xs font-semibold text-slate-700 cursor-pointer py-2">
              <input type="checkbox" checked={track} onChange={(e) => setTrack(e.target.checked)} className="accent-accent" />
              Rastrear aberturas e cliques
            </label>
          </>
        )}
        {error && (
          <p role="alert" className="text-xs font-semibold text-slate-800 bg-slate-50 border border-slate-300 rounded-lg p-2.5 mb-2">
            {error}
          </p>
        )}
      </div>

      <div className="px-3 py-2 border-t border-slate-200 shrink-0 space-y-1.5 bg-white">
        <div className="flex flex-wrap items-center gap-0.5 relative">
          <button type="button" onClick={() => runFormat('bold')} className="p-1.5 rounded hover:bg-slate-100 text-slate-600 cursor-pointer" title="Negrito" aria-label="Negrito">
            <Bold className="w-3.5 h-3.5" />
          </button>
          <button type="button" onClick={() => runFormat('italic')} className="p-1.5 rounded hover:bg-slate-100 text-slate-600 cursor-pointer" title="Itálico" aria-label="Itálico">
            <Italic className="w-3.5 h-3.5" />
          </button>
          <button type="button" onClick={() => runFormat('underline')} className="p-1.5 rounded hover:bg-slate-100 text-slate-600 cursor-pointer" title="Sublinhar" aria-label="Sublinhar">
            <Underline className="w-3.5 h-3.5" />
          </button>
          <button type="button" onClick={() => runFormat('removeFormat')} className="p-1.5 rounded hover:bg-slate-100 text-slate-600 cursor-pointer" title="Limpar formatação" aria-label="Limpar formatação">
            <RemoveFormatting className="w-3.5 h-3.5" />
          </button>
          <div className="relative">
            <button type="button" onClick={() => { setShowMoreFmt((v) => !v); setShowInsert(false); setShowAssoc(false); }} className="inline-flex items-center gap-0.5 px-1.5 py-1.5 rounded hover:bg-slate-100 text-[11px] font-semibold text-slate-600 cursor-pointer">
              Mais <ChevronDown className="w-3 h-3" />
            </button>
            {showMoreFmt && (
              <div className="absolute bottom-full left-0 mb-1 z-20 w-44 rounded-lg border border-slate-200 bg-white shadow-xl p-1">
                <button type="button" onClick={() => { runFormat('insertUnorderedList'); setShowMoreFmt(false); }} className="w-full flex items-center gap-2 px-2 py-1.5 text-xs text-slate-700 hover:bg-slate-50 cursor-pointer">
                  <List className="w-3.5 h-3.5" /> Lista
                </button>
                <button type="button" onClick={() => { runFormat('insertOrderedList'); setShowMoreFmt(false); }} className="w-full flex items-center gap-2 px-2 py-1.5 text-xs text-slate-700 hover:bg-slate-50 cursor-pointer">
                  <ListOrdered className="w-3.5 h-3.5" /> Lista numerada
                </button>
                <button type="button" onClick={() => { runFormat('justifyLeft'); setShowMoreFmt(false); }} className="w-full flex items-center gap-2 px-2 py-1.5 text-xs text-slate-700 hover:bg-slate-50 cursor-pointer">
                  <AlignLeft className="w-3.5 h-3.5" /> Alinhar à esquerda
                </button>
                <button type="button" onClick={() => { runFormat('justifyCenter'); setShowMoreFmt(false); }} className="w-full flex items-center gap-2 px-2 py-1.5 text-xs text-slate-700 hover:bg-slate-50 cursor-pointer" title="Centralizar">
                  <AlignCenter className="w-3.5 h-3.5" /> Centralizar
                </button>
                <button type="button" onClick={() => { runFormat('justifyRight'); setShowMoreFmt(false); }} className="w-full flex items-center gap-2 px-2 py-1.5 text-xs text-slate-700 hover:bg-slate-50 cursor-pointer" title="Alinhar à direita">
                  <AlignRight className="w-3.5 h-3.5" /> Alinhar à direita
                </button>
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={() => {
              const raw = window.prompt('Endereço do link:', 'https://');
              if (!raw) return;
              const href = sanitizeHref(raw);
              if (!href) {
                setError('Informe um link http(s) ou mailto válido.');
                return;
              }
              runFormat('createLink', href);
            }}
            className="p-1.5 rounded hover:bg-slate-100 text-slate-600 cursor-pointer"
            title="Link"
            aria-label="Link"
          >
            <Link2 className="w-3.5 h-3.5" />
          </button>
          <input
            ref={imageRef}
            type="file"
            hidden
            accept="image/png,image/jpeg,image/gif,image/webp,.png,.jpg,.jpeg,.gif,.webp"
            onChange={(e) => void addInlineImage(e.target.files)}
          />
          <button
            type="button"
            onClick={() => imageRef.current?.click()}
            className="p-1.5 rounded hover:bg-slate-100 text-slate-600 cursor-pointer"
            title="Inserir imagem (anexo interno, sem endereço remoto)"
            aria-label="Imagem"
            data-testid="crm-mail-insert-image"
          >
            <ImageIcon className="w-3.5 h-3.5" />
          </button>
          <div className="relative">
            <button type="button" onClick={() => { setShowInsert((v) => !v); setShowMoreFmt(false); setShowAssoc(false); }} className="inline-flex items-center gap-0.5 px-1.5 py-1.5 rounded hover:bg-slate-100 text-[11px] font-semibold text-slate-600 cursor-pointer">
              <Plus className="w-3 h-3" /> Inserir
            </button>
            {showInsert && (
              <div className="absolute bottom-full left-0 mb-1 z-20 w-56 max-h-56 overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-xl p-1">
                <p className="px-2 py-1 text-[10px] font-semibold uppercase text-slate-400">Variáveis do registro</p>
                {[
                  ['contact.firstName', 'Nome do contato'],
                  ['contact.email', 'E-mail do contato'],
                  ['company.name', 'Empresa'],
                  ['deal.title', 'Negócio'],
                ].map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => {
                      insertText(fillTemplateVars(`{{${key}}}`, varCtx) || `{{${key}}}`);
                      setShowInsert(false);
                    }}
                    className="w-full text-left px-2 py-1.5 text-xs text-slate-700 hover:bg-slate-50 cursor-pointer"
                  >
                    {label}
                  </button>
                ))}
                <p className="px-2 py-1 text-[10px] font-semibold uppercase text-slate-400">Modelos</p>
                {templates.slice(0, 6).map((tpl) => (
                  <button key={tpl.id} type="button" onClick={() => applyTemplate(tpl)} className="w-full text-left px-2 py-1.5 text-xs text-slate-700 hover:bg-slate-50 cursor-pointer">
                    {tpl.name}
                  </button>
                ))}
                <p className="px-2 py-1 text-[10px] font-semibold uppercase text-slate-400">Link de proposta</p>
                {proposals.length === 0 ? (
                  <p className="px-2 py-1.5 text-[11px] text-slate-400">Nenhuma proposta neste registro.</p>
                ) : (
                  proposals.map((p) => (
                    <button key={p.id} type="button" onClick={() => void insertProposalLink(p.id)} className="w-full text-left px-2 py-1.5 text-xs text-slate-700 hover:bg-slate-50 cursor-pointer">
                      {p.code}
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
          <input
            ref={fileRef}
            type="file"
            multiple
            hidden
            accept=".pdf,.png,.jpg,.jpeg,.gif,.webp,.docx,.xlsx,.pptx,.txt,.csv,application/pdf,image/png,image/jpeg,image/gif,image/webp"
            onChange={(e) => void addFiles(e.target.files)}
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            title="Anexar arquivo (até 2,5 MB no total)"
            className="p-1.5 rounded hover:bg-slate-100 text-slate-600 cursor-pointer"
            aria-label="Anexo"
            data-testid="crm-mail-attach"
          >
            <Paperclip className="w-3.5 h-3.5" />
          </button>
          <div className="relative ml-1">
            <button
              type="button"
              onClick={() => { setShowAssoc((v) => !v); setShowInsert(false); setShowMoreFmt(false); }}
              className="inline-flex items-center gap-1 px-1.5 py-1 text-[11px] font-semibold text-slate-500 hover:bg-slate-50 rounded cursor-pointer"
            >
              Associado a {associatedCount} registro{associatedCount === 1 ? '' : 's'} <ChevronDown className="w-3 h-3" />
            </button>
            {showAssoc && (
              <div className="absolute bottom-full left-0 mb-1 z-20 w-64 rounded-lg border border-slate-200 bg-white shadow-xl p-2 space-y-2">
                <label className="block text-[11px] font-semibold text-slate-600">
                  Negócio
                  <input
                    value={associations.dealId || ''}
                    onChange={(e) => setAssociations((a) => ({ ...a, dealId: e.target.value.trim() || null, dealLabel: e.target.value.trim() || null }))}
                    placeholder="id do negócio"
                    className="mt-0.5 w-full px-2 py-1 rounded border border-slate-200 text-xs"
                  />
                </label>
                <label className="block text-[11px] font-semibold text-slate-600">
                  Contato
                  <input
                    value={associations.contactId || ''}
                    onChange={(e) => setAssociations((a) => ({ ...a, contactId: e.target.value.trim() || null }))}
                    placeholder="id do contato"
                    className="mt-0.5 w-full px-2 py-1 rounded border border-slate-200 text-xs"
                  />
                </label>
                <label className="block text-[11px] font-semibold text-slate-600">
                  Empresa
                  <input
                    value={associations.companyId || ''}
                    onChange={(e) => setAssociations((a) => ({ ...a, companyId: e.target.value.trim() || null }))}
                    placeholder="id da empresa"
                    className="mt-0.5 w-full px-2 py-1 rounded border border-slate-200 text-xs"
                  />
                </label>
                <p className="text-[10px] text-slate-500">
                  {associations.dealLabel || associations.contactLabel || associations.companyLabel
                    ? [associations.dealLabel, associations.contactLabel, associations.companyLabel].filter(Boolean).join(' · ')
                    : 'O e-mail entra na timeline de cada registro preenchido.'}
                </p>
              </div>
            )}
          </div>
        </div>

        {attachments.length ? (
          <ul className="flex flex-wrap gap-1.5" data-testid="crm-mail-attachments">
            {attachments.map((a) => (
              <li key={a.id} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-slate-100 text-[11px] font-semibold text-slate-700">
                <span className="max-w-[12rem] truncate">{a.filename}</span>
                <button
                  type="button"
                  className="text-slate-500 hover:text-slate-800 cursor-pointer"
                  aria-label={`Remover ${a.filename}`}
                  onClick={() => setAttachments((cur) => cur.filter((x) => x.id !== a.id))}
                >
                  <X className="w-3 h-3" />
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <div className="inline-flex rounded-lg overflow-hidden">
              <button
                type="button"
                onClick={() => void send()}
                disabled={!canSend}
                title={sendDisabledReason || undefined}
                aria-disabled={!canSend}
                className={`${BTN_PRIMARY} rounded-r-none`}
              >
                {sending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />} Enviar
              </button>
              <button
                type="button"
                onClick={() => setShowSendMenu((v) => !v)}
                disabled={!canSend && !blockedMailbox && !permissionBlocked}
                className={`${BTN_PRIMARY} rounded-l-none px-2 border-l border-white/30`}
                aria-label="Mais opções de envio"
              >
                <ChevronDown className="w-3.5 h-3.5" />
              </button>
            </div>
            {showSendMenu && (
              <div className="absolute bottom-full left-0 mb-1 z-20 w-52 rounded-lg border border-slate-200 bg-white shadow-xl p-1">
                <button
                  type="button"
                  disabled
                  title="O agendamento de envio pela caixa Outlook ainda não está disponível."
                  className="w-full text-left px-2 py-1.5 text-xs text-slate-400 cursor-not-allowed inline-flex items-center gap-1"
                >
                  <Lock className="w-3 h-3" /> Agendar envio
                </button>
              </div>
            )}
          </div>
          <label className="flex flex-wrap items-center gap-1.5 text-[11px] font-semibold text-slate-600 cursor-pointer flex-1 min-w-[14rem]">
            <input type="checkbox" checked={createFollowUp} onChange={(e) => setCreateFollowUp(e.target.checked)} className="accent-accent" />
            <span>Criar uma tarefa de</span>
            <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-700">{followUpQueue}</span>
            <span>para acompanhar</span>
            {createFollowUp && (
              <>
                <select
                  value={followUpPreset}
                  onChange={(e) => setFollowUpPreset(e.target.value as FollowUpPreset)}
                  className="px-1.5 py-0.5 rounded border border-slate-200 bg-white text-[11px] font-semibold text-slate-700"
                >
                  {FOLLOW_UP_PRESETS.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.id === 'custom' ? p.label : formatFollowUpOptionLabel(p.id, today, customFollowUpDate || null)}
                    </option>
                  ))}
                </select>
                {followUpPreset === 'custom' && (
                  <input type="date" value={customFollowUpDate} onChange={(e) => setCustomFollowUpDate(e.target.value)} className="px-1.5 py-0.5 rounded border border-slate-200 text-[11px]" />
                )}
              </>
            )}
          </label>
        </div>
        {(sendDisabledReason || error) && (
          <p className="text-[11px] font-semibold text-slate-600" data-testid="crm-mail-send-reason">
            {error ? error : sendDisabledReason}
          </p>
        )}
      </div>
    </div>
  );
}

