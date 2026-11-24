'use client';

// STI-hub — Assistente de IA interno (etapa 1): botao do cabecalho + painel lateral de chat.
// Toda acao passa por um cartao com Confirmar/Cancelar antes de o servidor executar.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Bot, Check, CheckCircle2, Copy, Download, ExternalLink, FileDown, FileText, Link2, Loader2, Send, ShieldCheck, X, XCircle } from 'lucide-react';
import { requestSignedProposalLink } from '../lib/proposal-link-client';
import { requestSignedInvoiceLink } from '../lib/invoice-link-client';
import { downloadInternalProposalPdf } from '../lib/internal-proposal-pdf';
import type { InternalProposalSummaryModel } from '../lib/internal-proposal-summary';
import { copiarTexto, tabelaParaTsv, textoDoCartao, textoDoResultado, urlAbsoluta } from '../lib/assistente-chat-texto';

type HeaderSystem = 'crm' | 'erp' | 'service';

const ACCENT: Record<HeaderSystem, { base: string; hover: string; soft: string }> = {
  crm: { base: '#D9541E', hover: '#BC4718', soft: '#FDF1EC' },
  erp: { base: '#1E3A6E', hover: '#162C54', soft: '#EEF2F9' },
  service: { base: '#047857', hover: '#065F46', soft: '#ECFDF5' },
};

const MAX_CHARS = 2000;

interface Proposta {
  token: string;
  ferramenta: string;
  acao: 'leitura' | 'gravacao';
  titulo: string;
  linhas: string[];
}

export interface AlvoRegistroChat {
  type: string;
  id: string;
  query?: string;
}

type AcaoRegistro =
  | { tipo: 'abrir'; rotulo: string; alvo: AlvoRegistroChat; href: string }
  | { tipo: 'link_cliente_proposta'; rotulo: string; propostaId: string }
  | { tipo: 'link_cliente_fatura'; rotulo: string; faturaId: string }
  | { tipo: 'versao_contrato'; rotulo: string; href: string }
  | { tipo: 'pdf_proposta'; rotulo: string; propostaId: string }
  | { tipo: 'link_pdf'; rotulo: string; href: string }
  | { tipo: 'aviso'; rotulo: string };

interface Resultado {
  ok: boolean;
  mensagem: string;
  tabela?: { colunas: string[]; linhas: string[][] };
  totais?: Array<{ rotulo: string; valor: string }>;
  detalhes?: Array<{ rotulo: string; valor: string }>;
  acoes?: AcaoRegistro[];
  resumoParaModelo?: string;
}

/** Botão "Copiar" com retorno "Copiado". */
function BotaoCopiar({ texto, rotulo = 'Copiar', titulo, cor }: { texto: string | (() => string); rotulo?: string; titulo?: string; cor: string }) {
  const [estado, setEstado] = useState<'idle' | 'ok' | 'erro'>('idle');
  return (
    <button
      type="button"
      title={titulo || rotulo}
      aria-label={titulo || rotulo}
      data-testid="assistente-copiar"
      onClick={async () => {
        const ok = await copiarTexto(typeof texto === 'function' ? texto() : texto);
        setEstado(ok ? 'ok' : 'erro');
        setTimeout(() => setEstado('idle'), 1800);
      }}
      className="inline-flex items-center gap-1 text-[11px] font-semibold cursor-pointer hover:underline"
      style={{ color: estado === 'erro' ? '#b91c1c' : cor }}
    >
      {estado === 'ok' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
      {estado === 'ok' ? 'Copiado' : estado === 'erro' ? 'Não foi possível copiar' : rotulo}
    </button>
  );
}

/** Botões do registro: abrir, link do cliente (gerado no clique), Versão contrato e PDF. */
function AcoesRegistroChat({ acoes, cor, onAbrirRegistro }: { acoes: AcaoRegistro[]; cor: string; onAbrirRegistro?: (alvo: AlvoRegistroChat) => void }) {
  const [status, setStatus] = useState<Record<number, { tipo: 'carregando' | 'ok' | 'erro'; texto: string; url?: string }>>({});
  const set = (i: number, v: { tipo: 'carregando' | 'ok' | 'erro'; texto: string; url?: string }) => setStatus((cur) => ({ ...cur, [i]: v }));
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const btn = 'inline-flex items-center gap-1 rounded-[4px] border px-2 py-1 text-[11px] font-semibold cursor-pointer bg-white hover:bg-slate-50 disabled:opacity-60';
  return (
    <div className="mt-2 space-y-1.5" data-testid="assistente-acoes">
      <div className="flex flex-wrap gap-1.5">
        {acoes.map((a, i) => {
          const st = status[i];
          const carregando = st?.tipo === 'carregando';
          if (a.tipo === 'aviso') return null;
          if (a.tipo === 'abrir') {
            return (
              <button
                key={i}
                type="button"
                className={btn}
                style={{ borderColor: cor, color: cor }}
                onClick={() => {
                  if (onAbrirRegistro) onAbrirRegistro(a.alvo);
                  else window.open(a.href, '_blank', 'noopener,noreferrer');
                }}
              >
                <ExternalLink className="w-3.5 h-3.5" /> {a.rotulo}
              </button>
            );
          }
          if (a.tipo === 'versao_contrato') {
            return (
              <span key={i} className="inline-flex items-center gap-1">
                <a href={a.href} target="_blank" rel="noopener noreferrer" className={btn} style={{ borderColor: cor, color: cor }}>
                  <FileText className="w-3.5 h-3.5" /> {a.rotulo}
                </a>
                <BotaoCopiar texto={() => urlAbsoluta(a.href, origin)} rotulo="" titulo="Copiar link da Versão contrato" cor={cor} />
              </span>
            );
          }
          if (a.tipo === 'link_pdf') {
            return (
              <button
                key={i}
                type="button"
                className={btn}
                style={{ borderColor: cor, color: cor }}
                onClick={async () => {
                  const url = urlAbsoluta(a.href, origin);
                  const ok = await copiarTexto(url);
                  set(i, ok ? { tipo: 'ok', texto: 'Link do PDF copiado (abre para quem tem login no STI-hub).', url } : { tipo: 'erro', texto: 'Não foi possível copiar. Link:', url });
                }}
              >
                <Link2 className="w-3.5 h-3.5" /> {a.rotulo}
              </button>
            );
          }
          if (a.tipo === 'pdf_proposta') {
            return (
              <button
                key={i}
                type="button"
                disabled={carregando}
                className={btn}
                style={{ borderColor: cor, color: cor }}
                onClick={async () => {
                  set(i, { tipo: 'carregando', texto: 'Gerando o PDF…' });
                  try {
                    const res = await fetch(`/api/interno/proposta/${encodeURIComponent(a.propostaId)}`, { credentials: 'same-origin', cache: 'no-store' });
                    const json = await res.json().catch(() => null);
                    if (!res.ok || !json?.data) {
                      set(i, { tipo: 'erro', texto: res.status === 403 ? 'Seu perfil não tem permissão para ver esta proposta.' : res.status === 401 ? 'Entre de novo no STI-hub para baixar o PDF.' : 'Não foi possível gerar o PDF agora.' });
                      return;
                    }
                    const nome = downloadInternalProposalPdf(json.data as InternalProposalSummaryModel);
                    set(i, { tipo: 'ok', texto: `PDF baixado: ${nome}` });
                  } catch {
                    set(i, { tipo: 'erro', texto: 'Falha de conexão ao gerar o PDF.' });
                  }
                }}
              >
                {carregando ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileDown className="w-3.5 h-3.5" />} {a.rotulo}
              </button>
            );
          }
          // Link do cliente: pedido ao servidor no clique (sessão + MFA + RBAC), copiado e mostrado só aqui.
          return (
            <button
              key={i}
              type="button"
              disabled={carregando}
              className={btn}
              style={{ borderColor: cor, color: cor }}
              title="Gera o link assinado para o cliente (cria ou reaproveita o link curto /p/). Só acontece neste clique."
              onClick={async () => {
                set(i, { tipo: 'carregando', texto: 'Gerando o link do cliente…' });
                const r = a.tipo === 'link_cliente_proposta' ? await requestSignedProposalLink(a.propostaId) : await requestSignedInvoiceLink(a.faturaId);
                if (!r.ok) {
                  set(i, { tipo: 'erro', texto: r.error });
                  return;
                }
                const ok = await copiarTexto(r.url);
                set(i, { tipo: 'ok', texto: ok ? 'Link do cliente copiado.' : 'Link do cliente (copie abaixo):', url: r.url });
              }}
            >
              {carregando ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Link2 className="w-3.5 h-3.5" />} {a.rotulo}
            </button>
          );
        })}
      </div>
      {acoes.map((a, i) => (a.tipo === 'aviso' ? <p key={`av-${i}`} className="text-[11px] text-slate-500">{a.rotulo}</p> : null))}
      {Object.entries(status).map(([k, st]) => (
        <p key={`st-${k}`} className={`text-[11px] break-all ${st.tipo === 'erro' ? 'text-red-700' : 'text-slate-600'}`}>
          {st.texto}
          {st.url ? (
            <>
              {' '}
              <span className="font-mono select-all text-slate-800">{st.url}</span>
            </>
          ) : null}
        </p>
      ))}
    </div>
  );
}

type Item =
  | { id: string; tipo: 'usuario'; texto: string }
  | { id: string; tipo: 'assistente'; texto: string; erro?: boolean }
  | { id: string; tipo: 'proposta'; texto?: string; proposta: Proposta; estado: 'pendente' | 'executando' | 'confirmada' | 'cancelada' | 'erro' }
  | { id: string; tipo: 'resultado'; resultado: Resultado; consulta?: { titulo: string; linhas: string[] } };

const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

function toCsv(t: { colunas: string[]; linhas: string[][] }): string {
  const esc = (v: string) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  return [t.colunas, ...t.linhas].map((r) => r.map(esc).join(';')).join('\r\n');
}

/** Historico enviado ao modelo: so texto, sem dados devolvidos pelas ferramentas. */
function historyFrom(items: Item[]): Array<{ papel: 'usuario' | 'assistente'; texto: string }> {
  const out: Array<{ papel: 'usuario' | 'assistente'; texto: string }> = [];
  for (const it of items) {
    if (it.tipo === 'usuario') out.push({ papel: 'usuario', texto: it.texto });
    else if (it.tipo === 'assistente' && !it.erro) out.push({ papel: 'assistente', texto: it.texto });
    else if (it.tipo === 'proposta') {
      const st = it.estado === 'cancelada' ? 'cancelada pelo usuário' : it.estado === 'confirmada' ? 'confirmada' : 'aguardando confirmação';
      out.push({ papel: 'assistente', texto: `Ação preparada: ${it.proposta.titulo} (${st}).` });
    } else if (it.tipo === 'resultado' && it.resultado.resumoParaModelo) {
      out.push({ papel: 'assistente', texto: `Resultado: ${it.resultado.resumoParaModelo}` });
    }
  }
  return out.slice(-12);
}

export default function AssistenteIaPanel({
  system = 'crm',
  userName,
  onAbrirRegistro,
}: {
  system?: HeaderSystem;
  userName?: string;
  /** Abre o registro na tela do sistema (mesma navegação da busca global). */
  onAbrirRegistro?: (alvo: AlvoRegistroChat) => void;
}) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Item[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const accent = ACCENT[system] || ACCENT.crm;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    const t = setTimeout(() => inputRef.current?.focus(), 50);
    return () => {
      window.removeEventListener('keydown', onKey);
      clearTimeout(t);
    };
  }, [open]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [items, busy]);

  const send = useCallback(async () => {
    const texto = input.trim();
    if (!texto || busy) return;
    const next: Item[] = [...items, { id: uid(), tipo: 'usuario', texto }];
    setItems(next);
    setInput('');
    setBusy(true);
    try {
      const res = await fetch('/api/assistente/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mensagens: historyFrom(next) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setItems((cur) => [...cur, { id: uid(), tipo: 'assistente', texto: data?.error || 'Não foi possível falar com o assistente.', erro: true }]);
      } else if (data?.tipo === 'resultado' && data.resultado) {
        // Leitura: executada direto no servidor (sem cartão), com as permissões do usuário.
        const r = data.resultado;
        const resultado: Resultado = {
          ok: r?.ok === true,
          mensagem: String(r?.mensagem || ''),
          tabela: r?.tabela,
          totais: r?.totais,
          detalhes: Array.isArray(r?.detalhes) ? r.detalhes : undefined,
          acoes: Array.isArray(r?.acoes) ? r.acoes : undefined,
          resumoParaModelo: r?.resumoParaModelo,
        };
        const consulta = data.acao && typeof data.acao.titulo === 'string' ? { titulo: String(data.acao.titulo), linhas: Array.isArray(data.acao.linhas) ? data.acao.linhas.map(String) : [] } : undefined;
        setItems((cur) => [
          ...cur,
          ...(data.texto ? [{ id: uid(), tipo: 'assistente' as const, texto: String(data.texto) }] : []),
          { id: uid(), tipo: 'resultado' as const, resultado, consulta },
        ]);
      } else if (data?.tipo === 'proposta' && data.proposta) {
        setItems((cur) => [...cur, { id: uid(), tipo: 'proposta', texto: data.texto || '', proposta: data.proposta, estado: 'pendente' }]);
      } else {
        setItems((cur) => [...cur, { id: uid(), tipo: 'assistente', texto: String(data?.texto || '') }]);
      }
    } catch {
      setItems((cur) => [...cur, { id: uid(), tipo: 'assistente', texto: 'Falha de conexão com o assistente.', erro: true }]);
    } finally {
      setBusy(false);
    }
  }, [input, busy, items]);

  const decide = useCallback(async (id: string, confirmar: boolean) => {
    const it = items.find((x) => x.id === id);
    if (!it || it.tipo !== 'proposta' || it.estado !== 'pendente') return;
    if (!confirmar) {
      setItems((cur) => cur.map((x) => (x.id === id && x.tipo === 'proposta' ? { ...x, estado: 'cancelada' } : x)));
      return;
    }
    setItems((cur) => cur.map((x) => (x.id === id && x.tipo === 'proposta' ? { ...x, estado: 'executando' } : x)));
    try {
      const res = await fetch('/api/assistente/executar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: it.proposta.token, confirmar: true }),
      });
      const data = await res.json().catch(() => ({}));
      const resultado: Resultado = res.ok
        ? {
            ok: data?.ok === true,
            mensagem: String(data?.mensagem || ''),
            tabela: data?.tabela,
            totais: data?.totais,
            detalhes: Array.isArray(data?.detalhes) ? data.detalhes : undefined,
            acoes: Array.isArray(data?.acoes) ? data.acoes : undefined,
            resumoParaModelo: data?.resumoParaModelo,
          }
        : { ok: false, mensagem: String(data?.error || 'Não foi possível executar a ação.') };
      setItems((cur) => [
        ...cur.map((x) => (x.id === id && x.tipo === 'proposta' ? { ...x, estado: resultado.ok ? ('confirmada' as const) : ('erro' as const) } : x)),
        { id: uid(), tipo: 'resultado', resultado },
      ]);
    } catch {
      setItems((cur) => cur.map((x) => (x.id === id && x.tipo === 'proposta' ? { ...x, estado: 'erro' } : x)));
    }
  }, [items]);

  const download = (t: { colunas: string[]; linhas: string[][] }) => {
    const blob = new Blob(['\ufeff' + toCsv(t)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `assistente-sti-hub-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="assistente-ia-painel"
        title="Assistente de IA"
        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[4px] bg-white/10 hover:bg-white/20 text-[11px] font-semibold text-white border border-white/25 transition cursor-pointer"
      >
        <Bot className="w-3.5 h-3.5" />
        <span className="2xl:hidden">IA</span>
        <span className="hidden 2xl:inline">Assistente IA</span>
      </button>

      {open && (
        <aside
          id="assistente-ia-painel"
          role="dialog"
          aria-label="Assistente de IA do STI-hub"
          data-testid="assistente-painel"
          className="fixed top-0 right-0 z-[70] h-screen w-full sm:w-[420px] bg-white border-l border-slate-200 shadow-2xl flex flex-col text-slate-800 select-text"
          style={{ userSelect: 'text', WebkitUserSelect: 'text' }}
        >
          <div className="flex items-center justify-between px-4 py-3 text-white" style={{ backgroundColor: accent.base }}>
            <div className="flex items-center gap-2">
              <Bot className="w-4 h-4" />
              <div className="leading-tight">
                <p className="text-sm font-semibold">Assistente STI-hub</p>
                <p className="text-[10px] text-white/80">Consultas são imediatas; alterações pedem confirmação</p>
              </div>
            </div>
            <button type="button" onClick={() => setOpen(false)} aria-label="Fechar (Esc)" title="Fechar (Esc)" className="p-1 rounded hover:bg-white/15 cursor-pointer">
              <X className="w-4 h-4" />
            </button>
          </div>

          <div ref={listRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3 bg-slate-50">
            {items.length === 0 && (
              <div className="rounded-md border border-slate-200 bg-white p-3 text-[12px] text-slate-600 space-y-2">
                <p className="font-semibold text-slate-800">Olá{userName ? `, ${userName.split(' ')[0]}` : ''}. Posso ajudar com:</p>
                <ul className="list-disc pl-4 space-y-0.5">
                  <li>Consultas de contratos, vendas, OS, empresas, contatos, faturas e negócios</li>
                  <li>Relatórios simples por situação ou por mês</li>
                  <li>Dados completos do orçamento com link do cliente, Versão contrato e PDF</li>
                  <li>Rascunho de proposta, abertura de chamado e de OS</li>
                </ul>
                <p className="flex items-center gap-1 text-[11px] text-slate-500">
                  <ShieldCheck className="w-3.5 h-3.5" /> Uso só as suas permissões. Consultas saem na hora; o que grava ou altera dados pede confirmação.
                </p>
                <p className="text-[11px] text-slate-500">Todo texto do chat pode ser selecionado e copiado; cada resposta tem o botão Copiar.</p>
              </div>
            )}

            {items.map((it) => {
              if (it.tipo === 'usuario') {
                return (
                  <div key={it.id} className="flex justify-end">
                    <div className="max-w-[85%] rounded-lg px-3 py-2 text-[12.5px] text-white whitespace-pre-wrap select-text selection:bg-white selection:text-slate-900" style={{ backgroundColor: accent.base }}>
                      {it.texto}
                    </div>
                  </div>
                );
              }
              if (it.tipo === 'assistente') {
                return (
                  <div key={it.id} className="flex">
                    <div className={`max-w-[90%] rounded-lg px-3 py-2 text-[12.5px] whitespace-pre-wrap border select-text ${it.erro ? 'bg-red-50 border-red-200 text-red-700' : 'bg-white border-slate-200'}`}>
                      {it.texto}
                      <div className="mt-1 flex justify-end whitespace-normal">
                        <BotaoCopiar texto={it.texto} cor={accent.base} />
                      </div>
                    </div>
                  </div>
                );
              }
              if (it.tipo === 'proposta') {
                const p = it.proposta;
                const leitura = p.acao === 'leitura';
                return (
                  <div key={it.id} className="rounded-md border bg-white text-[12px]" style={{ borderColor: accent.base }}>
                    {it.texto ? <p className="px-3 pt-2 text-slate-700 whitespace-pre-wrap">{it.texto}</p> : null}
                    <div className="px-3 py-2">
                      <p className="font-semibold text-slate-900">{leitura ? `Posso ${p.titulo.charAt(0).toLowerCase()}${p.titulo.slice(1)}?` : p.titulo}</p>
                      <ul className={`mt-1 space-y-0.5 text-slate-600 ${leitura ? 'text-[11px]' : ''}`}>
                        {p.linhas.map((l, i) => (
                          <li key={i}>{l}</li>
                        ))}
                      </ul>
                    </div>
                    <div className="flex items-center gap-2 px-3 py-2 border-t border-slate-100">
                      <span className="order-last ml-auto">
                        <BotaoCopiar texto={textoDoCartao({ texto: it.texto, titulo: p.titulo, linhas: p.linhas })} cor={accent.base} />
                      </span>
                      {it.estado === 'pendente' && (
                        <>
                          <button
                            type="button"
                            onClick={() => decide(it.id, true)}
                            className="px-3 py-1 rounded-[4px] text-white text-[12px] font-semibold cursor-pointer"
                            style={{ backgroundColor: accent.base }}
                            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = accent.hover)}
                            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = accent.base)}
                          >
                            Confirmar
                          </button>
                          <button type="button" onClick={() => decide(it.id, false)} className="px-3 py-1 rounded-[4px] border border-slate-300 text-slate-700 text-[12px] font-semibold hover:bg-slate-50 cursor-pointer">
                            Cancelar
                          </button>
                        </>
                      )}
                      {it.estado === 'executando' && (
                        <span className="inline-flex items-center gap-1 text-slate-500"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Executando…</span>
                      )}
                      {it.estado === 'confirmada' && (
                        <span className="inline-flex items-center gap-1 text-emerald-700 font-semibold"><CheckCircle2 className="w-3.5 h-3.5" /> Confirmada</span>
                      )}
                      {it.estado === 'cancelada' && (
                        <span className="inline-flex items-center gap-1 text-slate-500 font-semibold"><XCircle className="w-3.5 h-3.5" /> Cancelada</span>
                      )}
                      {it.estado === 'erro' && <span className="inline-flex items-center gap-1 text-red-700 font-semibold"><XCircle className="w-3.5 h-3.5" /> Não executada</span>}
                    </div>
                  </div>
                );
              }
              const r = it.resultado;
              return (
                <div key={it.id} data-testid="assistente-resultado" className={`rounded-md border p-3 text-[12px] select-text ${r.ok ? 'bg-white border-slate-200' : 'bg-red-50 border-red-200 text-red-700'}`}>
                  {it.consulta && (
                    <p className="mb-1 text-[10.5px] text-slate-500" data-testid="assistente-consulta">
                      {it.consulta.titulo}
                      {it.consulta.linhas.length ? ` · ${it.consulta.linhas.join(' · ')}` : ''}
                    </p>
                  )}
                  <div className="flex items-start gap-2">
                    <p className="font-semibold whitespace-pre-wrap flex-1">{r.mensagem}</p>
                    <span className="shrink-0">
                      <BotaoCopiar texto={textoDoResultado(r)} titulo="Copiar a resposta completa" cor={accent.base} />
                    </span>
                  </div>
                  {r.totais && r.totais.length > 0 && !(r.detalhes && r.detalhes.length > 0) && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {r.totais.map((t) => (
                        <span key={t.rotulo} className="rounded px-2 py-1 font-semibold" style={{ backgroundColor: accent.soft, color: accent.base }}>
                          {t.rotulo}: {t.valor}
                        </span>
                      ))}
                    </div>
                  )}
                  {r.detalhes && r.detalhes.length > 0 && (
                    <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[11.5px]" data-testid="assistente-ficha">
                      {r.detalhes.map((d, i) => (
                        <div key={`${d.rotulo}-${i}`} className="contents">
                          <dt className="text-slate-500 whitespace-nowrap">{d.rotulo}</dt>
                          <dd className="text-slate-800 break-words">{d.valor}</dd>
                        </div>
                      ))}
                    </dl>
                  )}
                  {r.acoes && r.acoes.length > 0 && <AcoesRegistroChat acoes={r.acoes} cor={accent.base} onAbrirRegistro={onAbrirRegistro} />}
                  {r.tabela && r.tabela.linhas.length > 0 && (
                    <>
                      <div className="mt-2 max-h-64 overflow-auto border border-slate-200 rounded">
                        <table className="w-full text-[11px]">
                          <thead className="bg-slate-100 sticky top-0">
                            <tr>
                              {r.tabela.colunas.map((c) => (
                                <th key={c} className="text-left font-semibold px-2 py-1 whitespace-nowrap">{c}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {r.tabela.linhas.map((row, i) => (
                              <tr key={i} className="border-t border-slate-100">
                                {row.map((cell, j) => (
                                  <td key={j} className="px-2 py-1 whitespace-nowrap">{cell}</td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <div className="mt-2 flex items-center gap-3">
                        <BotaoCopiar texto={tabelaParaTsv(r.tabela)} rotulo="Copiar tabela" titulo="Copiar a tabela (texto tabulado, cola no Excel)" cor={accent.base} />
                        <button type="button" onClick={() => download(r.tabela!)} className="inline-flex items-center gap-1 text-[11px] font-semibold cursor-pointer" style={{ color: accent.base }}>
                          <Download className="w-3.5 h-3.5" /> Baixar CSV
                        </button>
                      </div>
                    </>
                  )}
                </div>
              );
            })}

            {busy && (
              <div className="inline-flex items-center gap-2 text-[12px] text-slate-500">
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> Pensando…
              </div>
            )}
          </div>

          <form
            className="border-t border-slate-200 p-3 bg-white"
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
          >
            <div className="flex items-end gap-2">
              <textarea
                ref={inputRef}
                value={input}
                maxLength={MAX_CHARS}
                rows={2}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    void send();
                  }
                }}
                placeholder="Ex.: proposta 4709, faturas vencidas, um CNPJ ou um link colado"
                className="flex-1 resize-none rounded-md border border-slate-300 px-3 py-2 text-[12.5px] focus:outline-none focus:ring-2"
                style={{ ['--tw-ring-color' as string]: accent.base }}
              />
              <button
                type="submit"
                disabled={busy || !input.trim()}
                aria-label="Enviar"
                className="h-9 w-9 inline-flex items-center justify-center rounded-md text-white disabled:opacity-50 cursor-pointer"
                style={{ backgroundColor: accent.base }}
              >
                <Send className="w-4 h-4" />
              </button>
            </div>
            <p className="mt-1 text-[10px] text-slate-400 text-right">{input.length}/{MAX_CHARS} • Esc fecha</p>
          </form>
        </aside>
      )}
    </>
  );
}
