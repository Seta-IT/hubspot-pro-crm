'use client';

import React, { useState, useEffect } from 'react';
import {
  Mail,
  Send,
  FileText,
  Hash,
  CalendarClock,
  CheckSquare,
  Plus,
  CheckCircle2,
  Clock,
  Phone,
  ListTodo,
  Trash2,
  Sparkles,
  UserPlus,
} from 'lucide-react';
import {
  Company,
  Contact,
  CrmEmailTemplate,
  CrmEmailTemplateCategory,
  CrmSnippet,
  CrmTask,
  CrmTaskPriority,
  CrmTaskStatus,
  CrmTaskType,
  Deal,
} from '../../db/types';
import {
  SETA_OWNER_OPTIONS,
  formatDateTimeBR,
} from './ui-helpers';
import {
  recordDeletedTask,
  recordTimelineEvent,
  recordUpsertedEmailTemplate,
  recordUpsertedSnippet,
  recordUpsertedTask,
} from '../lib/durable-storage';

export const HUBSPOT_TASK_QUEUES = [
  'Follow-up Comercial',
  'Prospecção ABM Tier 1',
  'Renovação & CS',
  'Geral',
];

export function interpolateEmailTemplateText(
  rawText: string,
  ctx: {
    contact?: Partial<Contact> | null;
    company?: Partial<Company> | null;
    deal?: Partial<Deal> | null;
    senderName?: string;
  }
): string {
  const firstName = ctx.contact?.firstName || 'Cliente';
  const lastName = ctx.contact?.lastName || '';
  const fullName = `${firstName} ${lastName}`.trim();
  const jobTitle = ctx.contact?.jobTitle || 'Executivo(a)';
  const companyName = ctx.company?.name || 'sua empresa';
  const sender = ctx.senderName || ctx.contact?.ownerName || 'Marcelo Lopes Mira';
  const dealTitle = ctx.deal?.title || 'Proposta Seta Telecom';

  return rawText
    .replace(/\{\{\s*contact\.firstName\s*\}\}/gi, firstName)
    .replace(/\{\{\s*contact\.lastName\s*\}\}/gi, lastName)
    .replace(/\{\{\s*contact\.fullName\s*\}\}/gi, fullName)
    .replace(/\{\{\s*contact\.jobTitle\s*\}\}/gi, jobTitle)
    .replace(/\{\{\s*company\.name\s*\}\}/gi, companyName)
    .replace(/\{\{\s*deal\.title\s*\}\}/gi, dealTitle)
    .replace(/\{\{\s*sender\.name\s*\}\}/gi, sender);
}

interface HubSpotCardEmailComposerProps {
  primaryContact?: Contact | null;
  company?: Company | null;
  deal?: Deal | null;
  linkedContacts?: Contact[];
  allContacts?: Contact[];
  onSent?: () => void;
}

export function HubSpotCardEmailComposer({
  primaryContact,
  company,
  deal,
  linkedContacts = [],
  allContacts = [],
  onSent,
}: HubSpotCardEmailComposerProps) {
  const [templates, setTemplates] = useState<CrmEmailTemplate[]>([]);
  const [snippets, setSnippets] = useState<CrmSnippet[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');
  const [usedSnippetIds, setUsedSnippetIds] = useState<string[]>([]);

  const [toEmails, setToEmails] = useState<string>(primaryContact?.email || '');
  const [ccEmails, setCcEmails] = useState<string>('');
  const [bccEmails, setBccEmails] = useState<string>('');
  const [showCcBcc, setShowCcBcc] = useState<boolean>(false);
  const [subject, setSubject] = useState<string>('');
  const [body, setBody] = useState<string>('');
  const [senderName, setSenderName] = useState<string>(
    primaryContact?.ownerName || company?.ownerName || 'Marcelo Lopes Mira'
  );

  // Follow-up Task creation on send (HubSpot style footer)
  const [createFollowUpTask, setCreateFollowUpTask] = useState<boolean>(true);
  const [followUpPreset, setFollowUpPreset] = useState<'1' | '2' | '3' | '7' | 'CUSTOM'>('2');
  const [customFollowUpDate, setCustomFollowUpDate] = useState<string>(() =>
    new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10)
  );
  const [followUpTime, setFollowUpTime] = useState<string>('09:30');
  const [followUpType, setFollowUpType] = useState<CrmTaskType>('EMAIL');
  const [followUpQueue, setFollowUpQueue] = useState<string>('Follow-up Comercial');
  const [followUpPriority, setFollowUpPriority] = useState<CrmTaskPriority>('HIGH');

  // New Template / New Snippet inline creator
  const [showNewTemplateForm, setShowNewTemplateForm] = useState(false);
  const [newTplName, setNewTplName] = useState('');
  const [newTplCategory, setNewTplCategory] = useState<CrmEmailTemplateCategory>('FOLLOW_UP');
  const [savingTpl, setSavingTpl] = useState(false);

  const [showNewSnippetForm, setShowNewSnippetForm] = useState(false);
  const [newSnipShortcut, setNewSnipShortcut] = useState('');
  const [newSnipName, setNewSnipName] = useState('');
  const [newSnipContent, setNewSnipContent] = useState('');
  const [savingSnip, setSavingSnip] = useState(false);

  const [sending, setSending] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const fetchTemplatesAndSnippets = async () => {
    try {
      const [tplRes, snipRes] = await Promise.all([
        fetch('/api/email-templates', { cache: 'no-store' }),
        fetch('/api/snippets', { cache: 'no-store' }),
      ]);
      if (tplRes.ok) {
        const j = await tplRes.json();
        setTemplates(j.data || []);
      }
      if (snipRes.ok) {
        const j = await snipRes.json();
        setSnippets(j.data || []);
      }
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    fetchTemplatesAndSnippets();
  }, []);

  useEffect(() => {
    if (primaryContact?.email) {
      setToEmails(primaryContact.email);
    } else if (linkedContacts.length > 0 && linkedContacts[0].email) {
      setToEmails(linkedContacts[0].email);
    }
  }, [primaryContact?.id, company?.id]);

  const handleApplyTemplate = (tplId: string) => {
    setSelectedTemplateId(tplId);
    const tpl = templates.find((t) => t.id === tplId);
    if (!tpl) return;
    const ctx = {
      contact: primaryContact || linkedContacts[0] || null,
      company: company || null,
      deal: deal || null,
      senderName,
    };
    setSubject(interpolateEmailTemplateText(tpl.subject, ctx));
    setBody(interpolateEmailTemplateText(tpl.body, ctx));
  };

  const handleInsertSnippet = (snippet: CrmSnippet) => {
    setBody((prev) => (prev.trim() ? `${prev}\n\n${snippet.content}` : snippet.content));
    setUsedSnippetIds((prev) => (prev.includes(snippet.id) ? prev : [...prev, snippet.id]));
  };

  const handleBodyChange = (val: string) => {
    // Support typing #shortcut + space/enter to auto-expand snippet
    let expanded = val;
    for (const snip of snippets) {
      if (snip.shortcut && expanded.includes(`${snip.shortcut} `)) {
        expanded = expanded.replace(`${snip.shortcut} `, `${snip.content} `);
        if (!usedSnippetIds.includes(snip.id)) {
          setUsedSnippetIds((prev) => [...prev, snip.id]);
        }
      }
    }
    setBody(expanded);
  };

  const toggleRecipientEmail = (emailAddr: string, target: 'TO' | 'CC') => {
    if (!emailAddr) return;
    const clean = emailAddr.trim().toLowerCase();
    if (target === 'TO') {
      const list = toEmails
        .split(/[,;]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      if (list.some((x) => x.toLowerCase() === clean)) {
        setToEmails(list.filter((x) => x.toLowerCase() !== clean).join(', '));
      } else {
        setToEmails([...list, emailAddr.trim()].join(', '));
      }
    } else {
      setShowCcBcc(true);
      const list = ccEmails
        .split(/[,;]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      if (list.some((x) => x.toLowerCase() === clean)) {
        setCcEmails(list.filter((x) => x.toLowerCase() !== clean).join(', '));
      } else {
        setCcEmails([...list, emailAddr.trim()].join(', '));
      }
    }
  };

  const handleSaveCurrentAsTemplate = async () => {
    if (!newTplName.trim() || !subject.trim() || !body.trim()) return;
    setSavingTpl(true);
    try {
      const res = await fetch('/api/email-templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newTplName.trim(),
          category: newTplCategory,
          subject: subject.trim(),
          body,
          createdBy: senderName,
        }),
      });
      if (res.ok) {
        const j = await res.json();
        if (j.data) {
          recordUpsertedEmailTemplate(j.data);
          setTemplates((prev) => [j.data, ...prev]);
          setSelectedTemplateId(j.data.id);
        }
        setNewTplName('');
        setShowNewTemplateForm(false);
        setFeedback(`Template "${j.data?.name}" salvo na biblioteca HubSpot!`);
      }
    } finally {
      setSavingTpl(false);
    }
  };

  const handleCreateNewSnippet = async () => {
    if (!newSnipShortcut.trim() || !newSnipName.trim() || !newSnipContent.trim()) return;
    setSavingSnip(true);
    try {
      const res = await fetch('/api/snippets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shortcut: newSnipShortcut.trim(),
          name: newSnipName.trim(),
          content: newSnipContent.trim(),
          category: 'Customizado Seta',
        }),
      });
      if (res.ok) {
        const j = await res.json();
        if (j.data) {
          recordUpsertedSnippet(j.data);
          setSnippets((prev) => [j.data, ...prev]);
          handleInsertSnippet(j.data);
        }
        setNewSnipShortcut('');
        setNewSnipName('');
        setNewSnipContent('');
        setShowNewSnippetForm(false);
        setFeedback(`Snippet "${j.data?.shortcut}" criado e inserido no e-mail!`);
      }
    } finally {
      setSavingSnip(false);
    }
  };

  const handleSendEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!toEmails.trim() || !subject.trim() || !body.trim()) return;
    setSending(true);
    setFeedback(null);
    try {
      const followUpDays = followUpPreset === 'CUSTOM' ? undefined : Number(followUpPreset);
      const followUpDueDate =
        followUpPreset === 'CUSTOM'
          ? customFollowUpDate
          : new Date(Date.now() + Number(followUpPreset) * 86400000).toISOString().slice(0, 10);

      const res = await fetch('/api/emails/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: toEmails.trim(),
          cc: ccEmails.trim() || undefined,
          bcc: bccEmails.trim() || undefined,
          subject: subject.trim(),
          body,
          senderName,
          contactId: primaryContact?.id || null,
          companyId: company?.id || primaryContact?.companyId || null,
          dealId: deal?.id || null,
          templateId: selectedTemplateId || null,
          snippetIds: usedSnippetIds,
          createFollowUpTask,
          followUpDays,
          followUpDueDate,
          followUpDueTime: followUpTime,
          followUpType,
          followUpPriority,
          followUpQueueName: followUpQueue,
          followUpAssignedTo: senderName,
        }),
      });

      if (res.ok) {
        const j = await res.json();
        const data = j.data;
        if (data?.timelineEvent) {
          recordTimelineEvent(data.timelineEvent);
        }
        if (data?.followUpTask) {
          recordUpsertedTask(data.followUpTask);
        }
        const taskMsg = data?.followUpTask
          ? ` + Tarefa de Follow-up agendada para ${data.followUpTask.dueDate} às ${data.followUpTask.dueTime} (${data.followUpTask.queueName})!`
          : '!';
        setFeedback(
          `E-mail enviado para ${toEmails} (Protocolo ${data?.protocol})${taskMsg}`
        );
        setSubject('');
        setBody('');
        setUsedSnippetIds([]);
        onSent?.();
      }
    } finally {
      setSending(false);
    }
  };

  // Combine linked contacts + other CRM contacts for quick selection
  const quickSelectableContacts = [
    ...(primaryContact ? [primaryContact] : []),
    ...linkedContacts.filter((c) => c.id !== primaryContact?.id),
    ...allContacts
      .filter(
        (c) =>
          c.id !== primaryContact?.id &&
          !linkedContacts.some((lc) => lc.id === c.id) &&
          c.isValidEmail
      )
      .slice(0, 6),
  ];

  return (
    <div className="p-4 rounded-2xl border-2 border-[#0091ae]/40 bg-[#f5f8fa] space-y-3.5 shadow-xs">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#cbd6e2] pb-2.5">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-[#0091ae] text-white flex items-center justify-center">
            <Mail className="w-4 h-4" />
          </div>
          <div>
            <h4 className="text-xs font-semibold text-[#33475b] uppercase tracking-wider">
              Composer de E-mail HubSpot (Contatos Vinculados, Templates &amp; Snippets)
            </h4>
            <p className="text-[11px] text-[#516f90]">
              Dispare para o contato do card ou outros executivos, insira templates/snippets (`#atalho`) e agende tarefa de follow-up.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setShowCcBcc((v) => !v)}
            className="px-2.5 py-1 rounded border border-[#cbd6e2] bg-white hover:bg-slate-50 text-[11px] font-normal text-[#33475b] cursor-pointer"
          >
            {showCcBcc ? 'Ocultar CC/CCO' : '+ CC / CCO'}
          </button>
        </div>
      </div>

      {feedback && (
        <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-300 text-xs text-emerald-900 font-normal flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          <span>{feedback}</span>
        </div>
      )}

      {/* Quick Linked & Other Contacts Selector */}
      {quickSelectableContacts.length > 0 && (
        <div className="space-y-1">
          <span className="text-[10px] font-normal uppercase text-[#516f90] flex items-center gap-1">
            <UserPlus className="w-3 h-3 text-[#0091ae]" />
            Destinatários Rápidos (Vinculados ao Card &amp; Outros Contatos da Base):
          </span>
          <div className="flex flex-wrap gap-1.5">
            {quickSelectableContacts.map((c) => {
              const inTo = toEmails.toLowerCase().includes(c.email.toLowerCase());
              const inCc = ccEmails.toLowerCase().includes(c.email.toLowerCase());
              const isLinked =
                c.id === primaryContact?.id || linkedContacts.some((lc) => lc.id === c.id);
              return (
                <div
                  key={c.id}
                  className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg border text-[11px] ${
                    inTo
                      ? 'bg-[#e5f8f6] border-[#00bda5] text-[#007a6c] font-normal'
                      : inCc
                        ? 'bg-sky-50 border-sky-300 text-sky-900 font-normal'
                        : 'bg-white border-[#cbd6e2] text-[#33475b]'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => toggleRecipientEmail(c.email, 'TO')}
                    title="Clique para adicionar/remover em Para (To)"
                    className="cursor-pointer hover:underline text-left"
                  >
                    {isLinked ? '[Vinculado] ' : ''}
                    {c.firstName} {c.lastName} &lt;{c.email}&gt;
                  </button>
                  <button
                    type="button"
                    onClick={() => toggleRecipientEmail(c.email, 'CC')}
                    title="Adicionar/remover em Cópia (CC)"
                    className="ml-1 px-1.5 py-0.5 rounded bg-slate-100 hover:bg-slate-200 text-[9px] font-normal text-slate-700 cursor-pointer"
                  >
                    CC
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Templates & Snippets Toolbar */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 bg-white p-3 rounded-xl border border-[#cbd6e2]">
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label className="text-[10px] font-normal uppercase text-[#516f90] flex items-center gap-1">
              <FileText className="w-3 h-3 text-[#ff7a59]" />
              Templates de E-mail HubSpot ({templates.length})
            </label>
            <button
              type="button"
              onClick={() => setShowNewTemplateForm((v) => !v)}
              className="text-[10px] font-normal text-[#0091ae] hover:underline cursor-pointer"
            >
              {showNewTemplateForm ? 'Cancelar' : '+ Salvar atual como Template'}
            </button>
          </div>
          <select
            value={selectedTemplateId}
            onChange={(e) => handleApplyTemplate(e.target.value)}
            className="w-full px-2.5 py-1.5 rounded-lg border border-[#cbd6e2] bg-[#f5f8fa] text-xs font-normal text-[#33475b]"
          >
            <option value="">Selecionar template pré-pronto...</option>
            {templates.map((tpl) => (
              <option key={tpl.id} value={tpl.id}>
                [{tpl.category}] {tpl.name}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label className="text-[10px] font-normal uppercase text-[#516f90] flex items-center gap-1">
              <Hash className="w-3 h-3 text-indigo-600" />
              Snippets Rápidos ({snippets.length})
            </label>
            <button
              type="button"
              onClick={() => setShowNewSnippetForm((v) => !v)}
              className="text-[10px] font-normal text-[#0091ae] hover:underline cursor-pointer"
            >
              {showNewSnippetForm ? 'Cancelar' : '+ Novo Snippet'}
            </button>
          </div>
          <div className="flex flex-wrap gap-1">
            {snippets.map((sn) => (
              <button
                key={sn.id}
                type="button"
                onClick={() => handleInsertSnippet(sn)}
                title={sn.content}
                className="px-2 py-1 rounded-md bg-indigo-50 hover:bg-indigo-100 text-indigo-800 border border-indigo-200 text-[10px] font-normal transition cursor-pointer"
              >
                {sn.shortcut} • {sn.name.slice(0, 22)}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Inline Save as Template Form */}
      {showNewTemplateForm && (
        <div className="p-3 rounded-xl bg-orange-50/70 border border-orange-200 space-y-2 text-xs">
          <div className="font-normal text-slate-800">
            Salvar Assunto e Corpo atuais como Novo Template HubSpot
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <input
              type="text"
              value={newTplName}
              onChange={(e) => setNewTplName(e.target.value)}
              placeholder="Nome do Template (ex: Abordagem C-Level)"
              className="sm:col-span-2 px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white text-xs"
            />
            <select
              value={newTplCategory}
              onChange={(e) => setNewTplCategory(e.target.value as CrmEmailTemplateCategory)}
              className="px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-normal"
            >
              <option value="PROSPECCAO">PROSPECÇÃO</option>
              <option value="FOLLOW_UP">FOLLOW_UP</option>
              <option value="PROPOSTA">PROPOSTA</option>
              <option value="DIAGNOSTICO">DIAGNÓSTICO</option>
              <option value="RENOVACAO">RENOVAÇÃO</option>
            </select>
          </div>
          <div className="flex justify-end">
            <button
              type="button"
              disabled={savingTpl}
              onClick={handleSaveCurrentAsTemplate}
              className="px-3 py-1.5 rounded-lg bg-[#ff7a59] text-white font-normal text-xs cursor-pointer"
            >
              {savingTpl ? 'Salvando...' : 'Salvar Template'}
            </button>
          </div>
        </div>
      )}

      {/* Inline Create Snippet Form */}
      {showNewSnippetForm && (
        <div className="p-3 rounded-xl bg-indigo-50/70 border border-indigo-200 space-y-2 text-xs">
          <div className="font-normal text-indigo-950">Criar Novo Snippet Reutilizável</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <input
              type="text"
              value={newSnipShortcut}
              onChange={(e) => setNewSnipShortcut(e.target.value)}
              placeholder="Atalho (ex: #garantia-seta)"
              className="px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white text-xs"
            />
            <input
              type="text"
              value={newSnipName}
              onChange={(e) => setNewSnipName(e.target.value)}
              placeholder="Título curto do Snippet"
              className="px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white text-xs"
            />
          </div>
          <textarea
            rows={2}
            value={newSnipContent}
            onChange={(e) => setNewSnipContent(e.target.value)}
            placeholder="Texto completo que será inserido..."
            className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white text-xs"
          />
          <div className="flex justify-end">
            <button
              type="button"
              disabled={savingSnip}
              onClick={handleCreateNewSnippet}
              className="px-3 py-1.5 rounded-lg bg-indigo-600 text-white font-normal text-xs cursor-pointer"
            >
              {savingSnip ? 'Salvando...' : 'Criar & Inserir Snippet'}
            </button>
          </div>
        </div>
      )}

      <form onSubmit={handleSendEmailSubmit} className="space-y-3 text-xs">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
          <div className="sm:col-span-2">
            <label className="block text-[10px] font-normal uppercase text-[#516f90] mb-1">
              Para (Destinatários — separe múltiplos por vírgula) *
            </label>
            <input
              type="text"
              required
              value={toEmails}
              onChange={(e) => setToEmails(e.target.value)}
              placeholder="executivo@empresa.com.br, compras@empresa.com.br"
              className="w-full px-3 py-1.5 rounded-lg border border-[#cbd6e2] bg-white text-xs font-normal text-[#33475b]"
            />
          </div>
          <div>
            <label className="block text-[10px] font-normal uppercase text-[#516f90] mb-1">
              Remetente (Proprietário)
            </label>
            <select
              value={senderName}
              onChange={(e) => setSenderName(e.target.value)}
              className="w-full px-2.5 py-1.5 rounded-lg border border-[#cbd6e2] bg-white text-xs font-normal text-[#33475b]"
            >
              {SETA_OWNER_OPTIONS.filter((o) => !o.includes('Inativo')).map((ow) => (
                <option key={ow} value={ow}>
                  {ow}
                </option>
              ))}
            </select>
          </div>
        </div>

        {showCcBcc && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <div>
              <label className="block text-[10px] font-normal uppercase text-[#516f90] mb-1">
                CC (Em Cópia)
              </label>
              <input
                type="text"
                value={ccEmails}
                onChange={(e) => setCcEmails(e.target.value)}
                placeholder="comercial@setatelecom.com.br"
                className="w-full px-3 py-1.5 rounded-lg border border-[#cbd6e2] bg-white text-xs"
              />
            </div>
            <div>
              <label className="block text-[10px] font-normal uppercase text-[#516f90] mb-1">
                CCO / Bcc (Cópia Oculta)
              </label>
              <input
                type="text"
                value={bccEmails}
                onChange={(e) => setBccEmails(e.target.value)}
                placeholder="diretoria@setatelecom.com.br"
                className="w-full px-3 py-1.5 rounded-lg border border-[#cbd6e2] bg-white text-xs"
              />
            </div>
          </div>
        )}

        <div>
          <label className="block text-[10px] font-normal uppercase text-[#516f90] mb-1">
            Assunto do E-mail *
          </label>
          <input
            type="text"
            required
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Ex: [Seta Telecom] Proposta Comercial & SLA Dedicado"
            className="w-full px-3 py-1.5 rounded-lg border border-[#cbd6e2] bg-white text-xs font-normal text-[#33475b]"
          />
        </div>

        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-[10px] font-normal uppercase text-[#516f90]">
              Mensagem (Suporta Snippets digitando #atalho + espaço) *
            </label>
            <span className="text-[10px] text-[#516f90]">
              Variáveis: {'{{contact.firstName}}'}, {'{{company.name}}'}, {'{{sender.name}}'}
            </span>
          </div>
          <textarea
            rows={6}
            required
            value={body}
            onChange={(e) => handleBodyChange(e.target.value)}
            placeholder="Escreva a mensagem ou selecione um Template / Snippet acima..."
            className="w-full px-3 py-2 rounded-lg border border-[#cbd6e2] bg-white text-xs text-[#33475b] leading-relaxed"
          />
        </div>

        {/* HUBSPOT FOOTER: CREATE FOLLOW-UP TASK AUTOMATICALLY */}
        <div className="p-3 rounded-xl bg-white border border-[#cbd6e2] space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label className="inline-flex items-center gap-2 font-normal text-[#33475b] cursor-pointer">
              <input
                type="checkbox"
                checked={createFollowUpTask}
                onChange={(e) => setCreateFollowUpTask(e.target.checked)}
                className="rounded border-slate-300 text-[#ff7a59] focus:ring-[#ff7a59]"
              />
              <CalendarClock className="w-4 h-4 text-[#ff7a59]" />
              <span>Criar uma tarefa de follow-up se não houver resposta</span>
            </label>

            {createFollowUpTask && (
              <div className="flex flex-wrap items-center gap-1.5">
                <select
                  value={followUpPreset}
                  onChange={(e) =>
                    setFollowUpPreset(e.target.value as '1' | '2' | '3' | '7' | 'CUSTOM')
                  }
                  className="px-2 py-1 rounded border border-[#cbd6e2] bg-[#f5f8fa] text-[11px] font-normal text-[#0091ae]"
                >
                  <option value="1">Amanhã (1 dia)</option>
                  <option value="2">Em 2 dias úteis</option>
                  <option value="3">Em 3 dias úteis</option>
                  <option value="7">Em 1 semana (7 dias)</option>
                  <option value="CUSTOM">Data personalizada...</option>
                </select>
                {followUpPreset === 'CUSTOM' && (
                  <input
                    type="date"
                    value={customFollowUpDate}
                    onChange={(e) => setCustomFollowUpDate(e.target.value)}
                    className="px-2 py-1 rounded border border-[#cbd6e2] bg-white text-[11px] font-normal"
                  />
                )}
                <input
                  type="time"
                  value={followUpTime}
                  onChange={(e) => setFollowUpTime(e.target.value)}
                  className="px-2 py-1 rounded border border-[#cbd6e2] bg-white text-[11px] font-normal"
                />
              </div>
            )}
          </div>

          {createFollowUpTask && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-2 border-t border-slate-100 text-[11px]">
              <div>
                <span className="text-slate-500 block mb-0.5">Tipo de Follow-up</span>
                <select
                  value={followUpType}
                  onChange={(e) => setFollowUpType(e.target.value as CrmTaskType)}
                  className="w-full px-2 py-1 rounded border border-slate-200 bg-slate-50 font-normal"
                >
                  <option value="EMAIL">E-mail de Follow-up</option>
                  <option value="CALL">Ligação Telefônica</option>
                  <option value="TODO">A fazer (To-do)</option>
                </select>
              </div>
              <div>
                <span className="text-slate-500 block mb-0.5">Fila HubSpot (Queue)</span>
                <select
                  value={followUpQueue}
                  onChange={(e) => setFollowUpQueue(e.target.value)}
                  className="w-full px-2 py-1 rounded border border-slate-200 bg-slate-50 font-normal"
                >
                  {HUBSPOT_TASK_QUEUES.map((q) => (
                    <option key={q} value={q}>
                      {q}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <span className="text-slate-500 block mb-0.5">Prioridade</span>
                <select
                  value={followUpPriority}
                  onChange={(e) => setFollowUpPriority(e.target.value as CrmTaskPriority)}
                  className="w-full px-2 py-1 rounded border border-slate-200 bg-slate-50 font-normal"
                >
                  <option value="HIGH">Alta</option>
                  <option value="MEDIUM">Média</option>
                  <option value="LOW">Baixa</option>
                </select>
              </div>
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="submit"
              disabled={sending}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#ff7a59] hover:bg-[#e86646] text-white text-xs font-normal shadow-xs transition cursor-pointer disabled:opacity-50"
            >
              <Send className="w-3.5 h-3.5" />
              {sending
                ? 'Enviando...'
                : createFollowUpTask
                  ? 'Enviar E-mail & Agendar Follow-up'
                  : 'Enviar E-mail Agora'}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

interface HubSpotRecordTasksSectionProps {
  contactId?: string | null;
  companyId?: string | null;
  dealId?: string | null;
  defaultAssignee?: string;
  initialTasks?: CrmTask[];
  onTasksChanged?: () => void;
}

export function HubSpotRecordTasksSection({
  contactId,
  companyId,
  dealId,
  defaultAssignee = 'Marcelo Lopes Mira',
  initialTasks,
  onTasksChanged,
}: HubSpotRecordTasksSectionProps) {
  const [tasks, setTasks] = useState<CrmTask[]>(initialTasks || []);
  const [loading, setLoading] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);

  // Create form fields
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [type, setType] = useState<CrmTaskType>('CALL');
  const [priority, setPriority] = useState<CrmTaskPriority>('HIGH');
  const [queueName, setQueueName] = useState<string>('Follow-up Comercial');
  const [dueDate, setDueDate] = useState<string>(() =>
    new Date(Date.now() + 86400000).toISOString().slice(0, 10)
  );
  const [dueTime, setDueTime] = useState<string>('09:30');
  const [reminderMinutesBefore, setReminderMinutesBefore] = useState<number>(15);
  const [assignedTo, setAssignedTo] = useState<string>(defaultAssignee);
  const [saving, setSaving] = useState(false);

  const fetchRecordTasks = async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (contactId) qs.set('contactId', contactId);
      else if (companyId) qs.set('companyId', companyId);
      else if (dealId) qs.set('dealId', dealId);
      const res = await fetch(`/api/tasks?${qs.toString()}`, { cache: 'no-store' });
      if (res.ok) {
        const j = await res.json();
        setTasks(j.data || []);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (initialTasks) {
      setTasks(initialTasks);
    } else {
      fetchRecordTasks();
    }
  }, [contactId, companyId, dealId, initialTasks]);

  const handleCreateTaskSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    setSaving(true);
    try {
      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          notes: notes.trim(),
          type,
          priority,
          status: 'NOT_STARTED',
          queueName,
          dueDate,
          dueTime,
          reminderMinutesBefore,
          assignedTo,
          contactId: contactId || null,
          companyId: companyId || null,
          dealId: dealId || null,
        }),
      });
      if (res.ok) {
        const j = await res.json();
        if (j.data) {
          recordUpsertedTask(j.data);
          setTasks((prev) => [j.data, ...prev]);
        }
        setTitle('');
        setNotes('');
        setShowCreateForm(false);
        onTasksChanged?.();
      }
    } finally {
      setSaving(false);
    }
  };

  const handleToggleComplete = async (task: CrmTask) => {
    const isCompleted = task.status === 'COMPLETED';
    const url = isCompleted ? `/api/tasks/${task.id}` : `/api/tasks/${task.id}/complete`;
    const res = await fetch(url, {
      method: isCompleted ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: isCompleted ? JSON.stringify({ status: 'NOT_STARTED' }) : JSON.stringify({}),
    });
    if (res.ok) {
      const j = await res.json();
      if (j.data) {
        recordUpsertedTask(j.data);
        setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, ...j.data } : t)));
      }
      onTasksChanged?.();
    }
  };

  const handlePostponeTask = async (task: CrmTask, addDays: number) => {
    const baseMs = task.dueDate ? new Date(`${task.dueDate}T12:00:00`).getTime() : Date.now();
    const nextDate = new Date(Math.max(Date.now(), baseMs) + addDays * 86400000)
      .toISOString()
      .slice(0, 10);
    const res = await fetch(`/api/tasks/${task.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dueDate: nextDate, status: 'IN_PROGRESS' }),
    });
    if (res.ok) {
      const j = await res.json();
      if (j.data) {
        recordUpsertedTask(j.data);
        setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, ...j.data } : t)));
      }
      onTasksChanged?.();
    }
  };

  const handleDeleteTask = async (taskId: string) => {
    recordDeletedTask(taskId);
    setTasks((prev) => prev.filter((t) => t.id !== taskId));
    await fetch(`/api/tasks/${taskId}`, { method: 'DELETE' });
    onTasksChanged?.();
  };

  const todayYmd = new Date().toISOString().slice(0, 10);
  const openTasks = tasks.filter((t) => t.status !== 'COMPLETED');
  const completedTasks = tasks.filter((t) => t.status === 'COMPLETED');

  return (
    <div className="p-4 rounded-2xl border border-[#cbd6e2] bg-white space-y-3 shadow-2xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <CheckSquare className="w-4 h-4 text-[#0091ae]" />
          <h4 className="text-xs font-semibold uppercase tracking-wider text-[#33475b]">
            Tarefas &amp; Follow-ups HubSpot ({openTasks.length} abertas • {completedTasks.length} concluídas)
          </h4>
        </div>
        <button
          type="button"
          onClick={() => setShowCreateForm((v) => !v)}
          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-[#ff7a59] hover:bg-[#e86646] text-white text-xs font-normal shadow-2xs transition cursor-pointer"
        >
          <Plus className="w-3.5 h-3.5" />
          {showCreateForm ? 'Fechar' : 'Criar Tarefa'}
        </button>
      </div>

      {showCreateForm && (
        <form
          onSubmit={handleCreateTaskSubmit}
          className="p-3.5 rounded-xl bg-[#f5f8fa] border border-[#cbd6e2] space-y-3 text-xs"
        >
          <div>
            <label className="block text-[10px] font-normal uppercase text-[#516f90] mb-1">
              Título da Tarefa de Follow-up *
            </label>
            <input
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Ex: Ligar para validar proposta de locação PABX IP"
              className="w-full px-3 py-1.5 rounded-lg border border-[#cbd6e2] bg-white text-xs font-normal text-[#33475b]"
            />
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <div>
              <label className="block text-[10px] font-normal uppercase text-[#516f90] mb-1">
                Tipo
              </label>
              <select
                value={type}
                onChange={(e) => setType(e.target.value as CrmTaskType)}
                className="w-full px-2 py-1.5 rounded-lg border border-[#cbd6e2] bg-white text-xs font-normal"
              >
                <option value="CALL">Ligação</option>
                <option value="EMAIL">E-mail</option>
                <option value="TODO">A fazer</option>
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-normal uppercase text-[#516f90] mb-1">
                Prioridade
              </label>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value as CrmTaskPriority)}
                className="w-full px-2 py-1.5 rounded-lg border border-[#cbd6e2] bg-white text-xs font-normal"
              >
                <option value="HIGH">Alta</option>
                <option value="MEDIUM">Média</option>
                <option value="LOW">Baixa</option>
                <option value="NONE">Sem prioridade</option>
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-normal uppercase text-[#516f90] mb-1">
                Data Vencimento
              </label>
              <input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="w-full px-2 py-1.5 rounded-lg border border-[#cbd6e2] bg-white text-xs font-normal"
              />
            </div>
            <div>
              <label className="block text-[10px] font-normal uppercase text-[#516f90] mb-1">
                Horário
              </label>
              <input
                type="time"
                value={dueTime}
                onChange={(e) => setDueTime(e.target.value)}
                className="w-full px-2 py-1.5 rounded-lg border border-[#cbd6e2] bg-white text-xs font-normal"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <div>
              <label className="block text-[10px] font-normal uppercase text-[#516f90] mb-1">
                Fila de Tarefas (Queue)
              </label>
              <select
                value={queueName}
                onChange={(e) => setQueueName(e.target.value)}
                className="w-full px-2 py-1.5 rounded-lg border border-[#cbd6e2] bg-white text-xs font-normal"
              >
                {HUBSPOT_TASK_QUEUES.map((q) => (
                  <option key={q} value={q}>
                    {q}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-normal uppercase text-[#516f90] mb-1">
                Lembrete HubSpot
              </label>
              <select
                value={reminderMinutesBefore}
                onChange={(e) => setReminderMinutesBefore(Number(e.target.value))}
                className="w-full px-2 py-1.5 rounded-lg border border-[#cbd6e2] bg-white text-xs font-normal"
              >
                <option value={0}>No horário do vencimento</option>
                <option value={15}>15 minutos antes</option>
                <option value={30}>30 minutos antes</option>
                <option value={60}>1 hora antes</option>
                <option value={1440}>1 dia antes</option>
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-normal uppercase text-[#516f90] mb-1">
                Atribuído a
              </label>
              <select
                value={assignedTo}
                onChange={(e) => setAssignedTo(e.target.value)}
                className="w-full px-2 py-1.5 rounded-lg border border-[#cbd6e2] bg-white text-xs font-normal"
              >
                {SETA_OWNER_OPTIONS.filter((o) => !o.includes('Inativo')).map((ow) => (
                  <option key={ow} value={ow}>
                    {ow}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-[10px] font-normal uppercase text-[#516f90] mb-1">
              Notas / Roteiro do Follow-up
            </label>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Observações, pontos de pauta ou links..."
              className="w-full px-3 py-1.5 rounded-lg border border-[#cbd6e2] bg-white text-xs"
            />
          </div>

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowCreateForm(false)}
              className="px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-normal text-slate-700"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-1.5 rounded-lg bg-[#0091ae] hover:bg-[#007a94] text-white text-xs font-normal cursor-pointer"
            >
              {saving ? 'Agendando...' : 'Salvar Tarefa'}
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <div className="text-xs text-slate-400 py-3">Carregando tarefas...</div>
      ) : tasks.length === 0 ? (
        <p className="text-xs text-slate-400">
          Nenhuma tarefa agendada para este registro. Clique em &ldquo;Criar Tarefa&rdquo; ou envie um e-mail com follow-up automático.
        </p>
      ) : (
        <div className="space-y-2">
          {tasks.map((task) => {
            const isDone = task.status === 'COMPLETED';
            const isOverdue = !isDone && task.dueDate < todayYmd;
            const isToday = !isDone && task.dueDate === todayYmd;
            return (
              <div
                key={task.id}
                className={`p-3 rounded-xl border transition flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 text-xs ${
                  isDone
                    ? 'bg-slate-50 border-slate-200 opacity-75'
                    : isOverdue
                      ? 'bg-rose-50/40 border-rose-200'
                      : isToday
                        ? 'bg-amber-50/40 border-amber-200'
                        : 'bg-white border-slate-200'
                }`}
              >
                <div className="flex items-start gap-2.5 min-w-0">
                  <input
                    type="checkbox"
                    checked={isDone}
                    onChange={() => handleToggleComplete(task)}
                    title={isDone ? 'Reabrir tarefa' : 'Concluir tarefa em 1 clique'}
                    className="mt-0.5 w-4 h-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500 cursor-pointer"
                  />
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 text-[10px] font-normal">
                        {task.type === 'CALL'
                          ? 'Ligação'
                          : task.type === 'EMAIL'
                            ? 'E-mail'
                            : 'A fazer'}
                      </span>
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] font-normal ${
                          task.priority === 'HIGH'
                            ? 'bg-rose-100 text-rose-800'
                            : task.priority === 'MEDIUM'
                              ? 'bg-amber-100 text-amber-800'
                              : 'bg-slate-100 text-slate-600'
                        }`}
                      >
                        {task.priority === 'HIGH'
                          ? 'Prioridade Alta'
                          : task.priority === 'MEDIUM'
                            ? 'Média'
                            : 'Baixa'}
                      </span>
                      <span className="px-2 py-0.5 rounded bg-[#eaf0f6] text-[#0091ae] text-[10px] font-normal">
                        Fila: {task.queueName}
                      </span>
                      {isOverdue && (
                        <span className="px-1.5 py-0.5 rounded bg-rose-600 text-white text-[10px] font-normal">
                          Atrasada ({task.dueDate})
                        </span>
                      )}
                      {isToday && (
                        <span className="px-1.5 py-0.5 rounded bg-amber-500 text-white text-[10px] font-normal">
                          Vence Hoje às {task.dueTime}
                        </span>
                      )}
                      {!isOverdue && !isToday && (
                        <span className="text-[11px] text-slate-500 font-medium">
                          {task.dueDate} às {task.dueTime}
                        </span>
                      )}
                    </div>
                    <div
                      className={`font-normal text-slate-900 ${
                        isDone ? 'line-through text-slate-500' : ''
                      }`}
                    >
                      {task.title}
                    </div>
                    {task.notes && <p className="text-[11px] text-slate-600">{task.notes}</p>}
                    <div className="text-[10px] text-slate-400">
                      Responsável: <span>{task.assignedTo}</span>
                      {task.completedAt ? ` • Concluída em ${formatDateTimeBR(task.completedAt)}` : ''}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 self-end sm:self-center shrink-0">
                  {!isDone && (
                    <>
                      <button
                        type="button"
                        onClick={() => handlePostponeTask(task, 1)}
                        className="px-2 py-1 rounded border border-slate-200 bg-white hover:bg-slate-50 text-[10px] font-normal text-slate-700 cursor-pointer"
                        title="Adiar para amanhã (+1 dia)"
                      >
                        +1d
                      </button>
                      <button
                        type="button"
                        onClick={() => handlePostponeTask(task, 7)}
                        className="px-2 py-1 rounded border border-slate-200 bg-white hover:bg-slate-50 text-[10px] font-normal text-slate-700 cursor-pointer"
                        title="Adiar em 1 semana (+7 dias)"
                      >
                        +1 sem
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    onClick={() => handleDeleteTask(task.id)}
                    className="p-1.5 rounded text-slate-400 hover:text-rose-600 hover:bg-rose-50 cursor-pointer"
                    title="Excluir tarefa"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
