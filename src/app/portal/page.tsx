'use client';

import React, { Suspense, useCallback, useState } from 'react';
import { portalActionErrorMessage } from './portal-feedback';
import { useSearchParams } from 'next/navigation';
import {
  Radio,
  Search,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Send,
  Star,
  Plus,
  ArrowLeft,
  ShieldCheck,
  MessageSquare,
  Phone,
  RefreshCw,
  Mail,
} from 'lucide-react';
import { TicketCategory, TicketPriority, TicketStatus } from '../../db/types';
import { formatDateTimeBR } from '../components/ui-helpers';

/**
 * Contrato publico do portal (HOTFIX 29/10/2026): o servidor so devolve o chamado quando a
 * chave E o e-mail do contato conferem, e so com estes campos (sem CNPJ, contrato, O.S., CC,
 * e-mails de terceiros ou notas internas).
 */
interface PortalTicket {
  key: string;
  subject: string;
  status: TicketStatus;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  comments: Array<{ author: string; authorRole: 'AGENT' | 'CUSTOMER'; body: string; createdAt: string }>;
}

const STATUS_LABEL: Record<string, string> = {
  OPEN: 'Aberto',
  IN_PROGRESS: 'Em atendimento',
  WAITING_CUSTOMER: 'Aguardando cliente',
  RESOLVED: 'Resolvido',
  CLOSED: 'Encerrado',
};

const PROGRESS_STEPS: Array<{ id: TicketStatus; label: string; desc: string }> = [
  { id: 'OPEN', label: '1. Chamado Aberto', desc: 'Protocolo registrado na fila NOC' },
  { id: 'IN_PROGRESS', label: '2. Atendimento NOC / Campo', desc: 'Engenharia atuando no diagnóstico' },
  { id: 'WAITING_CUSTOMER', label: '3. Validação do Cliente', desc: 'Aguardando confirmação ou janela' },
  { id: 'RESOLVED', label: '4. Resolvido & Normalizado', desc: 'Operação restabelecida com SLA' },
];

function CustomerPortalContent() {
  const searchParams = useSearchParams();
  const initialTicketQuery = (searchParams?.get('ticket') || '').trim().toUpperCase();

  const [activeTab, setActiveTab] = useState<'TRACK' | 'NEW_TICKET'>('TRACK');
  const [ticket, setTicket] = useState<PortalTicket | null>(null);
  const [lookupKey, setLookupKey] = useState<string>(initialTicketQuery);
  const [lookupEmail, setLookupEmail] = useState<string>('');
  // Credenciais da ultima consulta bem-sucedida (usadas em resposta/CSAT/atualizar).
  const [authed, setAuthed] = useState<{ key: string; email: string } | null>(null);
  const [lookupError, setLookupError] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);

  // Reply state
  const [replyText, setReplyText] = useState('');
  const [sendingReply, setSendingReply] = useState(false);
  const [replyError, setReplyError] = useState('');

  // CSAT state
  const [csatRating, setCsatRating] = useState<number>(5);
  const [csatFeedback, setCsatFeedback] = useState('');
  const [submittingCsat, setSubmittingCsat] = useState(false);
  const [csatSubmittedNotice, setCsatSubmittedNotice] = useState(false);
  const [csatError, setCsatError] = useState('');

  // New Ticket Form state
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newCompany, setNewCompany] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [newCategory, setNewCategory] = useState<TicketCategory>('INCIDENT');
  const [newPriority, setNewPriority] = useState<TicketPriority>('HIGH');
  const [newSerial, setNewSerial] = useState('');
  const [newSubject, setNewSubject] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [creatingTicket, setCreatingTicket] = useState(false);
  const [createdProtocol, setCreatedProtocol] = useState<PortalTicket | null>(null);

  const lookupTicket = useCallback(async (key: string, email: string) => {
    const k = key.trim().toUpperCase();
    const e = email.trim().toLowerCase();
    if (!k || !e) {
      setLookupError('Informe a chave do chamado e o e-mail do contato.');
      return;
    }
    setLoading(true);
    setLookupError('');
    try {
      const res = await fetch(
        `/api/portal/tickets?key=${encodeURIComponent(k)}&email=${encodeURIComponent(e)}`,
        { cache: 'no-store' }
      );
      const json = await res.json().catch(() => null);
      if (res.ok && json?.data) {
        setTicket(json.data as PortalTicket);
        setAuthed({ key: k, email: e });
      } else {
        setTicket(null);
        setAuthed(null);
        setLookupError(
          json?.error || 'Não foi possível localizar um chamado com a chave e o e-mail informados.'
        );
      }
    } catch {
      setLookupError('Falha de conexão. Tente novamente.');
    } finally {
      setLoading(false);
    }
  }, []);

  const handleSearchSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await lookupTicket(lookupKey, lookupEmail);
  };

  const handleSendReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ticket || !authed || !replyText.trim()) return;
    setSendingReply(true);
    setReplyError('');
    try {
      const res = await fetch(`/api/portal/tickets/${encodeURIComponent(authed.key)}/reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: authed.email, body: replyText.trim() }),
      });
      const json = await res.json().catch(() => null);
      if (res.ok && json?.data) {
        setReplyText('');
        setTicket(json.data as PortalTicket);
      } else {
        setReplyError(portalActionErrorMessage(res.status, 'REPLY'));
      }
    } catch {
      setReplyError(portalActionErrorMessage(null, 'REPLY'));
    } finally {
      setSendingReply(false);
    }
  };

  const handleSubmitCsat = async (score: number) => {
    if (!ticket || !authed) return;
    setCsatRating(score);
    setSubmittingCsat(true);
    setCsatError('');
    try {
      const res = await fetch(`/api/portal/tickets/${encodeURIComponent(authed.key)}/csat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: authed.email, score, feedback: csatFeedback.trim() || undefined }),
      });
      const json = await res.json().catch(() => null);
      if (res.ok && json?.data) {
        setTicket(json.data as PortalTicket);
        setCsatSubmittedNotice(true);
        setCsatFeedback('');
        setTimeout(() => setCsatSubmittedNotice(false), 3500);
      } else {
        setCsatError(portalActionErrorMessage(res.status, 'CSAT'));
      }
    } catch {
      setCsatError(portalActionErrorMessage(null, 'CSAT'));
    } finally {
      setSubmittingCsat(false);
    }
  };

  const handleCreatePortalTicket = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSubject.trim() || !newEmail.trim()) return;
    setCreatingTicket(true);
    setCreatedProtocol(null);
    try {
      const res = await fetch('/api/portal/tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newName.trim() || 'Cliente Corporativo',
          email: newEmail.trim(),
          companyName: newCompany.trim(),
          phone: newPhone.trim(),
          category: newCategory,
          priority: newPriority,
          equipmentSerial: newSerial.trim() || null,
          subject: newSubject.trim(),
          description: newDescription.trim(),
        }),
      });
      if (res.ok) {
        const json = await res.json();
        if (json.data) {
          const created = json.data as PortalTicket;
          const email = newEmail.trim().toLowerCase();
          setCreatedProtocol(created);
          setTicket(created);
          setAuthed({ key: created.key, email });
          setLookupKey(created.key);
          setLookupEmail(email);
          setNewSubject('');
          setNewDescription('');
          setNewSerial('');
        }
      }
    } finally {
      setCreatingTicket(false);
    }
  };

  const getStepStatusIndex = (status: TicketStatus) => {
    if (status === 'OPEN') return 0;
    if (status === 'IN_PROGRESS') return 1;
    if (status === 'WAITING_CUSTOMER') return 2;
    return 3;
  };

  const activeTicket = ticket;

  return (
    <div className="min-h-screen bg-[#f5f8fa] text-slate-800 flex flex-col">
      {/* HEADER BAR SETA TELECOM */}
      <header className="bg-[#0d2b4e] text-white border-b border-[#1e3a6e] shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="bg-white rounded-lg px-3 py-1.5 flex items-center gap-1.5 shadow-xs">
              <span className="text-lg font-semibold tracking-tight text-[#0d2b4e]">SETA</span>
              <span className="w-[2px] h-4 bg-[#f26522] inline-block" />
              <span className="text-lg font-semibold tracking-tight text-[#f26522]">IT</span>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-base font-semibold tracking-tight">
                  Portal do Cliente &amp; Central NOC 24x7
                </h1>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-400/30">
                  SLA Garantido em Contrato
                </span>
              </div>
              <p className="text-xs text-slate-300">
                SETA TELECOM LTDA • Acompanhamento de Chamados Técnicos, Voz SIP/PABX, SD-WAN e RMA de Locação
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <a
              href="/"
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-semibold border border-white/15 transition"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              Voltar ao Console CRM / NOC
            </a>
          </div>
        </div>
      </header>

      {/* MAIN CONTAINER */}
      <main className="max-w-7xl mx-auto w-full px-4 sm:px-6 py-6 space-y-6 flex-1">
        {/* TOP NAVIGATION PILLS */}
        <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setActiveTab('TRACK')}
              className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold transition cursor-pointer ${
                activeTab === 'TRACK'
                  ? 'bg-[#0d2b4e] text-white shadow-sm'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              <Radio className="w-4 h-4 text-[#ff7a59]" />
              Consultar Protocolo
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('NEW_TICKET')}
              className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold transition cursor-pointer ${
                activeTab === 'NEW_TICKET'
                  ? 'bg-[#ff7a59] text-white shadow-sm'
                  : 'bg-orange-50 text-[#e05835] hover:bg-orange-100 border border-orange-200'
              }`}
            >
              <Plus className="w-4 h-4" />
              Abrir Novo Chamado Técnico ou RMA
            </button>
          </div>

          <div className="flex items-center gap-3 text-xs text-slate-500">
            <span className="inline-flex items-center gap-1 font-semibold text-emerald-700">
              <ShieldCheck className="w-4 h-4 text-emerald-600" />
              Ambiente Seguro • Notas internas ocultas
            </span>
            <span className="hidden sm:inline-flex items-center gap-1">
              <Phone className="w-3.5 h-3.5 text-slate-400" /> Plantão NOC: (11) 3003-SETA
            </span>
          </div>
        </div>

        {activeTab === 'TRACK' ? (
          <div className="space-y-6">
            {/* CONSULTA: chave do chamado + e-mail do contato (ambos obrigatorios) */}
            <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-3">
              <form onSubmit={handleSearchSubmit} className="flex flex-wrap items-center gap-2.5">
                <div className="relative flex-1 min-w-[180px]">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    required
                    value={lookupKey}
                    onChange={(e) => setLookupKey(e.target.value.toUpperCase())}
                    placeholder="Chave do chamado (ex: SD-123)"
                    autoComplete="off"
                    className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 text-xs bg-slate-50 focus:bg-white focus:outline-none focus:border-[#0d2b4e] font-mono"
                  />
                </div>
                <div className="relative flex-1 min-w-[220px]">
                  <Mail className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="email"
                    required
                    value={lookupEmail}
                    onChange={(e) => setLookupEmail(e.target.value)}
                    placeholder="E-mail do contato cadastrado no chamado"
                    autoComplete="email"
                    className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 text-xs bg-slate-50 focus:bg-white focus:outline-none focus:border-[#0d2b4e]"
                  />
                </div>
                <button
                  type="submit"
                  disabled={loading}
                  className="px-5 py-2.5 rounded-xl bg-[#0d2b4e] hover:bg-[#1e3a6e] text-white text-xs font-semibold transition cursor-pointer disabled:opacity-50"
                >
                  Consultar Protocolo
                </button>
                {authed && (
                  <button
                    type="button"
                    onClick={() => lookupTicket(authed.key, authed.email)}
                    className="p-2.5 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-100 cursor-pointer"
                    title="Atualizar status"
                  >
                    <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                  </button>
                )}
              </form>
              <p className="text-[11px] text-slate-500">
                Por segurança, o chamado só é exibido quando a chave e o e-mail do contato conferem.
              </p>
              {lookupError && (
                <div className="text-xs font-semibold text-rose-700 flex items-center gap-1.5">
                  <AlertTriangle className="w-4 h-4" /> {lookupError}
                </div>
              )}
            </div>

            {activeTicket ? (
              <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="p-6 bg-[#0d2b4e] text-white space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="px-3 py-1 rounded-lg bg-[#f26522] text-white font-mono text-sm font-semibold">
                      Protocolo {activeTicket.key}
                    </span>
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-white/10 border border-white/20">
                      {activeTicket.status === 'RESOLVED' || activeTicket.status === 'CLOSED' ? (
                        <CheckCircle2 className="w-3.5 h-3.5" />
                      ) : (
                        <Clock className="w-3.5 h-3.5" />
                      )}
                      {STATUS_LABEL[activeTicket.status] || activeTicket.status}
                    </span>
                  </div>
                  <h2 className="text-lg font-semibold leading-snug">{activeTicket.subject}</h2>
                  <div className="pt-3 border-t border-white/15 grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                    <div className="bg-white/5 rounded-xl p-2.5">
                      <span className="text-[10px] uppercase text-slate-400 block font-semibold">Aberto em</span>
                      <strong>{formatDateTimeBR(activeTicket.createdAt)}</strong>
                    </div>
                    <div className="bg-white/5 rounded-xl p-2.5">
                      <span className="text-[10px] uppercase text-slate-400 block font-semibold">Última atualização</span>
                      <strong>{formatDateTimeBR(activeTicket.updatedAt)}</strong>
                    </div>
                    <div className="bg-white/5 rounded-xl p-2.5">
                      <span className="text-[10px] uppercase text-slate-400 block font-semibold">Resolvido em</span>
                      <strong>{activeTicket.resolvedAt ? formatDateTimeBR(activeTicket.resolvedAt) : '—'}</strong>
                    </div>
                  </div>
                </div>

                {/* Visual Progress Stepper */}
                <div className="p-5 bg-slate-50 border-b border-slate-200">
                  <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                    {PROGRESS_STEPS.map((step, idx) => {
                      const done = idx <= getStepStatusIndex(activeTicket.status);
                      return (
                        <div
                          key={step.id}
                          className={`p-3 rounded-xl border text-xs ${
                            done ? 'bg-emerald-50/80 border-emerald-300 text-emerald-950' : 'bg-white border-slate-200 text-slate-400'
                          }`}
                        >
                          <div className="font-semibold flex items-center justify-between">
                            <span>{step.label}</span>
                            {done && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />}
                          </div>
                          <div className="text-[10px] mt-0.5 opacity-80">{step.desc}</div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {(activeTicket.status === 'RESOLVED' || activeTicket.status === 'CLOSED') && (
                  <div className="p-5 bg-amber-50/70 border-b border-amber-200 space-y-3">
                    <h4 className="text-xs font-semibold text-slate-900 flex items-center gap-1.5">
                      <Star className="w-4 h-4 text-amber-500 fill-amber-400" />
                      Avalie o Atendimento do NOC Seta Telecom (Pesquisa CSAT)
                    </h4>
                    <div className="flex flex-wrap items-center gap-2">
                      {[1, 2, 3, 4, 5].map((star) => (
                        <button
                          key={star}
                          type="button"
                          disabled={submittingCsat}
                          onClick={() => handleSubmitCsat(star)}
                          className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold border transition cursor-pointer ${
                            csatRating >= star
                              ? 'bg-amber-400 text-slate-950 border-amber-500 shadow-2xs'
                              : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-100'
                          }`}
                        >
                          {star}
                        </button>
                      ))}
                      <input
                        type="text"
                        value={csatFeedback}
                        onChange={(e) => setCsatFeedback(e.target.value)}
                        placeholder="Comentário opcional de elogio ou melhoria..."
                        className="flex-1 min-w-[200px] px-3 py-1.5 rounded-xl border border-amber-300 bg-white text-xs"
                      />
                    </div>
                    {csatSubmittedNotice && (
                      <div className="text-xs font-semibold text-emerald-700 flex items-center gap-1">
                        <CheckCircle2 className="w-4 h-4" /> Obrigado! Sua avaliação CSAT foi gravada com sucesso.
                      </div>
                    )}
                    {csatError && (
                      <div role="alert" className="text-xs font-semibold text-rose-700 flex items-center gap-1.5">
                        <AlertTriangle className="w-4 h-4" /> {csatError}
                      </div>
                    )}
                  </div>
                )}

                <div className="p-6 space-y-4">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                    <MessageSquare className="w-3.5 h-3.5 text-[#ff7a59]" />
                    Histórico de Interações Públicas ({activeTicket.comments.length})
                  </h3>
                  <div className="space-y-3">
                    {activeTicket.comments.map((c, idx) => (
                      <div
                        key={`${c.createdAt}-${idx}`}
                        className={`p-4 rounded-2xl border text-xs space-y-1.5 ${
                          c.authorRole === 'CUSTOMER'
                            ? 'bg-slate-50 border-slate-200 text-slate-900'
                            : 'bg-indigo-50/70 border-indigo-200 text-slate-900'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-semibold flex items-center gap-2">
                            {c.author}
                            <span
                              className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                                c.authorRole === 'CUSTOMER' ? 'bg-slate-200 text-slate-700' : 'bg-[#0d2b4e] text-white'
                              }`}
                            >
                              {c.authorRole === 'CUSTOMER' ? 'Cliente' : 'Engenharia NOC Seta'}
                            </span>
                          </span>
                          <span className="text-[11px] text-slate-500">{formatDateTimeBR(c.createdAt)}</span>
                        </div>
                        <p className="leading-relaxed whitespace-pre-wrap">{c.body}</p>
                      </div>
                    ))}
                  </div>

                  <form onSubmit={handleSendReply} className="pt-4 border-t border-slate-200 space-y-3">
                    <textarea
                      rows={3}
                      value={replyText}
                      onChange={(e) => setReplyText(e.target.value)}
                      placeholder="Envie uma nova informação, log ou confirme a normalização do serviço para a equipe NOC..."
                      className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-xs focus:outline-none focus:border-[#0d2b4e]"
                    />
                    {replyError && (
                      <div role="alert" className="text-xs font-semibold text-rose-700 flex items-center gap-1.5">
                        <AlertTriangle className="w-4 h-4" /> {replyError}
                      </div>
                    )}
                    <div className="flex justify-end">
                      <button
                        type="submit"
                        disabled={sendingReply || !replyText.trim()}
                        className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#ff7a59] hover:bg-[#e05835] text-white text-xs font-semibold shadow-sm transition disabled:opacity-40 cursor-pointer"
                      >
                        <Send className="w-3.5 h-3.5" />
                        {sendingReply ? 'Enviando...' : 'Enviar Mensagem ao NOC'}
                      </button>
                    </div>
                  </form>
                </div>
              </div>
            ) : (
              <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center text-sm text-slate-500">
                Informe a chave do chamado e o e-mail do contato para acompanhar o atendimento.
              </div>
            )}
          </div>
        ) : (
          /* TAB 2: OPEN NEW SUPPORT TICKET OR RMA */
          <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm max-w-3xl mx-auto space-y-5">
            <div className="border-b border-slate-100 pb-4">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-[#ff7a59]">
                Abertura Direta com SLA Contratual
              </span>
              <h2 className="text-lg font-semibold text-slate-900 mt-0.5">
                Abrir Novo Chamado Técnico no NOC ou Solicitar RMA de Locação
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Seu chamado cai diretamente na fila de engenharia correspondente (N1/N2/N3 ou Field Service) com número de protocolo imediato.
              </p>
            </div>

            {createdProtocol && (
              <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-300 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-emerald-900 flex items-center gap-1.5">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                    Protocolo {createdProtocol.key} registrado com sucesso!
                  </span>
                  <button
                    type="button"
                    onClick={() => setActiveTab('TRACK')}
                    className="px-3 py-1 rounded-lg bg-emerald-700 text-white text-xs font-semibold cursor-pointer"
                  >
                    Acompanhar Protocolo Agora →
                  </button>
                </div>
                <p className="text-xs text-emerald-800">
                  Guarde a chave <strong className="font-mono">{createdProtocol.key}</strong>: para consultar, informe-a junto com o e-mail usado na abertura.
                </p>
              </div>
            )}

            <form onSubmit={handleCreatePortalTicket} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Seu Nome Completo *
                  </label>
                  <input
                    type="text"
                    required
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="Ex: Ricardo Almeida"
                    className="w-full px-3.5 py-2 rounded-xl border border-slate-200 text-xs"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    E-mail Corporativo *
                  </label>
                  <input
                    type="email"
                    required
                    value={newEmail}
                    onChange={(e) => setNewEmail(e.target.value)}
                    placeholder="voce@suaempresa.com.br"
                    className="w-full px-3.5 py-2 rounded-xl border border-slate-200 text-xs"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Empresa / Razão Social
                  </label>
                  <input
                    type="text"
                    value={newCompany}
                    onChange={(e) => setNewCompany(e.target.value)}
                    placeholder="Ex: Bemisa Participações S.A."
                    className="w-full px-3.5 py-2 rounded-xl border border-slate-200 text-xs"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Telefone / WhatsApp de Contato
                  </label>
                  <input
                    type="text"
                    value={newPhone}
                    onChange={(e) => setNewPhone(e.target.value)}
                    placeholder="(11) 98888-7777"
                    className="w-full px-3.5 py-2 rounded-xl border border-slate-200 text-xs"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Tipo de Solicitação
                  </label>
                  <select
                    value={newCategory}
                    onChange={(e) => setNewCategory(e.target.value as TicketCategory)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs bg-white"
                  >
                    <option value="INCIDENT">Incidente Link / Voz SIP / PABX</option>
                    <option value="SUPPORT">RMA / Equipamento Locado</option>
                    <option value="BUG">Falha Entroncamento E1 / Core</option>
                    <option value="BILLING">2ª Via Fatura Locação / Fiscal</option>
                    <option value="FEATURE_REQUEST">Ampliação de Ramais / Link</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Impacto / Severidade (SLA)
                  </label>
                  <select
                    value={newPriority}
                    onChange={(e) => setNewPriority(e.target.value as TicketPriority)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs bg-white"
                  >
                    <option value="CRITICAL">P1 • Parada Total (SLA 1h / 4h)</option>
                    <option value="HIGH">P2 • Degradação Severa (SLA 2h / 8h)</option>
                    <option value="MEDIUM">P3 • Falha Parcial (SLA 4h / 24h)</option>
                    <option value="LOW">P4 • Dúvida / Agendamento (SLA 8h / 48h)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Serial Number / Circuito (Opcional)
                  </label>
                  <input
                    type="text"
                    value={newSerial}
                    onChange={(e) => setNewSerial(e.target.value)}
                    placeholder="Ex: SN-SETA-PABX-99812A"
                    className="w-full px-3.5 py-2 rounded-xl border border-slate-200 text-xs font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Assunto Resumido *
                </label>
                <input
                  type="text"
                  required
                  value={newSubject}
                  onChange={(e) => setNewSubject(e.target.value)}
                  placeholder="Ex: Perda de registro SIP nos ramais da recepção / Solicitação de troca de aparelho Yealink"
                  className="w-full px-3.5 py-2 rounded-xl border border-slate-200 text-xs"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Descrição Técnica / Sintomas Observados *
                </label>
                <textarea
                  rows={4}
                  required
                  value={newDescription}
                  onChange={(e) => setNewDescription(e.target.value)}
                  placeholder="Informe o horário do início do incidente, ramais ou circuitos afetados e disponibilidade para acesso remoto/visita..."
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-xs"
                />
              </div>

              <div className="flex justify-end pt-2">
                <button
                  type="submit"
                  disabled={creatingTicket}
                  className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-[#ff7a59] hover:bg-[#e05835] text-white text-xs font-semibold shadow-sm transition cursor-pointer disabled:opacity-50"
                >
                  <Send className="w-4 h-4" />
                  {creatingTicket ? 'Gerando Protocolo...' : 'Registrar Chamado com SLA Garantido'}
                </button>
              </div>
            </form>
          </div>
        )}
      </main>
    </div>
  );
}

export default function CustomerPortalPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-[#f5f8fa] flex items-center justify-center text-xs font-semibold text-slate-500">
          Carregando Portal do Cliente Seta Telecom...
        </div>
      }
    >
      <CustomerPortalContent />
    </Suspense>
  );
}
