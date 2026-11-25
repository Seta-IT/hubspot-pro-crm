'use client';

// STI-hub — Assistente de IA interno (etapa 1): botao do cabecalho + painel lateral de chat.
// Toda acao que grava passa por um cartao com Confirmar/Cancelar antes de o servidor executar.
// 25/11/2026: conversas separadas e persistentes (historico, encerrar, apagar), aprendizado
// (memoria do usuario, feedback) e rascunho de proposta guiado pelo cadastro de produtos.
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Bot, Brain, Check, CheckCircle2, Copy, Download, ExternalLink, FileDown, FileText, History, Link2, Loader2, Lock, MessageSquarePlus, Search, Send, ShieldCheck, ThumbsDown, ThumbsUp, Trash2, Unlock, X, XCircle } from 'lucide-react';
import TextoMd, { textoSemMarkdown } from './assistente/TextoMd';
import { CartaoAcessorios, CartaoEscolhaCliente, CartaoEscolhaProduto, type GrupoUi, type OpcaoModeloUi, type SelecaoUi } from './assistente/CartoesFluxo';
import TelaAprendizado from './assistente/TelaAprendizado';
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

type Fluxo = Record<string, unknown> | null;
type Nota = 'positivo' | 'negativo' | null;
type EstadoCartao = 'pendente' | 'executando' | 'confirmada' | 'cancelada' | 'erro' | 'expirada';

type Item =
  | { id: string; tipo: 'usuario'; texto: string }
  | { id: string; tipo: 'assistente'; texto: string; erro?: boolean; fluxo?: Fluxo; feedback?: Nota }
  | { id: string; tipo: 'proposta'; texto?: string; proposta: Proposta; estado: EstadoCartao; fluxo?: Fluxo }
  | { id: string; tipo: 'resultado'; resultado: Resultado; consulta?: { titulo: string; linhas: string[] }; fluxo?: Fluxo; feedback?: Nota }
  | { id: string; tipo: 'escolha_produto'; texto: string; opcoes: OpcaoModeloUi[]; quantidade: number; precoRotulo: string; fluxo: Fluxo; escolhido?: string }
  | { id: string; tipo: 'sugestao_acessorios'; texto: string; grupos: GrupoUi[]; fluxo: Fluxo; enviado?: boolean }
  | { id: string; tipo: 'escolha_cliente'; texto: string; opcoes: Array<{ indice: number; nome: string; cnpj: string }>; fluxo: Fluxo; escolhido?: number };

interface ConversaResumo { id: string; titulo: string; status: 'aberta' | 'encerrada'; criadaEm: string; atualizadaEm: string; mensagens: number }

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
      const st = it.estado === 'cancelada' ? 'cancelada pelo usuário' : it.estado === 'confirmada' ? 'confirmada' : it.estado === 'expirada' ? 'expirada' : 'aguardando confirmação';
      out.push({ papel: 'assistente', texto: `Ação preparada: ${it.proposta.titulo} (${st}).` });
    } else if (it.tipo === 'resultado' && it.resultado.resumoParaModelo) {
      out.push({ papel: 'assistente', texto: `Resultado: ${it.resultado.resumoParaModelo}` });
    } else if (it.tipo === 'escolha_produto' || it.tipo === 'sugestao_acessorios' || it.tipo === 'escolha_cliente') {
      out.push({ papel: 'assistente', texto: it.texto });
    }
  }
  return out.slice(-12);
}

/** Estado do rascunho pendente desta conversa: o da última resposta do assistente. */
function fluxoAtual(items: Item[]): Fluxo {
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    if (it.tipo === 'usuario') continue;
    return ('fluxo' in it ? it.fluxo : null) ?? null;
  }
  return null;
}

/** Pergunta do usuário imediatamente antes do item (para o feedback). */
function perguntaAntes(items: Item[], id: string): string {
  const idx = items.findIndex((x) => x.id === id);
  for (let i = idx - 1; i >= 0; i--) {
    const it = items[i];
    if (it.tipo === 'usuario') return it.texto;
  }
  return '';
}

const dataCurta = (iso: string) => {
  try {
    const d = new Date(iso);
    const hoje = new Date();
    const mesmoDia = d.toDateString() === hoje.toDateString();
    return mesmoDia
      ? d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' })
      : d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', timeZone: 'America/Sao_Paulo' });
  } catch {
    return '';
  }
};

async function chamar(method: string, path: string, body?: unknown) {
  const res = await fetch(path, { method, headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', cache: 'no-store', body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

/** Gostei / não gostei com motivo opcional (o motivo vira lição para as próximas conversas). */
function Feedback({ nota, cor, onNota }: { nota?: Nota; cor: string; onNota: (n: Nota, motivo?: string) => void }) {
  const [pedindo, setPedindo] = useState(false);
  const [motivo, setMotivo] = useState('');
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-normal">
      <button type="button" aria-label="Resposta útil" title="Resposta útil" onClick={() => onNota(nota === 'positivo' ? null : 'positivo')} className="cursor-pointer" style={{ color: nota === 'positivo' ? cor : '#94a3b8' }}>
        <ThumbsUp className="w-3.5 h-3.5" />
      </button>
      <button type="button" aria-label="Resposta ruim" title="Resposta ruim (diga o motivo para eu aprender)" onClick={() => (nota === 'negativo' ? onNota(null) : setPedindo(true))} className="cursor-pointer" style={{ color: nota === 'negativo' ? '#b91c1c' : '#94a3b8' }}>
        <ThumbsDown className="w-3.5 h-3.5" />
      </button>
      {pedindo && (
        <span className="inline-flex items-center gap-1">
          <input autoFocus value={motivo} maxLength={300} onChange={(e) => setMotivo(e.target.value)} placeholder="O que faltou? (opcional)" className="w-40 rounded border border-slate-300 px-1.5 py-0.5 text-[11px]" />
          <button type="button" onClick={() => { onNota('negativo', motivo.trim() || undefined); setPedindo(false); setMotivo(''); }} className="text-[11px] font-semibold cursor-pointer" style={{ color: cor }}>Enviar</button>
        </span>
      )}
    </span>
  );
}

function CartaoResultado({ it, accent, onAbrirRegistro, download, rodape }: { it: Extract<Item, { tipo: 'resultado' }>; accent: { base: string; soft: string }; onAbrirRegistro?: (alvo: AlvoRegistroChat) => void; download: (t: { colunas: string[]; linhas: string[][] }) => void; rodape?: ReactNode }) {
  const r = it.resultado;
  return (
    <div data-testid="assistente-resultado" className={`rounded-md border p-3 text-[12px] select-text ${r.ok ? 'bg-white border-slate-200' : 'bg-red-50 border-red-200 text-red-700'}`}>
      {it.consulta && (
        <p className="mb-1 text-[10.5px] text-slate-500" data-testid="assistente-consulta">
          {it.consulta.titulo}
          {it.consulta.linhas.length ? ` · ${it.consulta.linhas.join(' · ')}` : ''}
        </p>
      )}
      <div className="flex items-start gap-2">
        <div className="font-semibold flex-1"><TextoMd texto={r.mensagem} /></div>
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
              <thead className="bg-slate-50 sticky top-0">
                <tr>
                  {r.tabela.colunas.map((c) => (
                    <th key={c} className="text-left font-semibold px-2 py-1 border-b border-slate-200 whitespace-nowrap">{c}</th>
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
      {rodape ? <div className="mt-1 flex justify-end">{rodape}</div> : null}
    </div>
  );
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
  const [conversaId, setConversaId] = useState<string | null>(null);
  const [status, setStatus] = useState<'aberta' | 'encerrada'>('aberta');
  const [titulo, setTitulo] = useState('Nova conversa');
  const [conversas, setConversas] = useState<ConversaResumo[]>([]);
  const [mostrarLista, setMostrarLista] = useState(false);
  const [busca, setBusca] = useState('');
  const [view, setView] = useState<'chat' | 'aprendizado'>('chat');
  const [confirmar, setConfirmar] = useState<null | { tipo: 'apagar'; id: string; titulo: string } | { tipo: 'apagar_todas' }>(null);
  const [aviso, setAviso] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const salvos = useRef<Map<string, string>>(new Map());
  const carregouAtiva = useRef(false);
  const accent = ACCENT[system] || ACCENT.crm;
  const encerrada = status === 'encerrada';

  const carregarLista = useCallback(async (q = '') => {
    const r = await chamar('GET', `/api/assistente/conversas${q ? `?busca=${encodeURIComponent(q)}` : ''}`);
    if (r.ok && Array.isArray(r.data?.data)) setConversas(r.data.data);
  }, []);

  const abrirConversa = useCallback(async (id: string) => {
    const r = await chamar('GET', `/api/assistente/conversas/${encodeURIComponent(id)}`);
    if (!r.ok || !r.data?.data) {
      return false;
    }
    const c = r.data.data;
    const novos: Item[] = (Array.isArray(c.itens) ? c.itens : []).map((x: any) => ({ ...(x.item || {}), id: x.id, ...(x.feedback ? { feedback: x.feedback } : {}) }));
    salvos.current = new Map(novos.map((it) => [it.id, JSON.stringify(it)]));
    setItems(novos);
    setConversaId(c.id);
    setStatus(c.status === 'encerrada' ? 'encerrada' : 'aberta');
    setTitulo(c.titulo || 'Nova conversa');
    setView('chat');
    return true;
  }, []);

  const novaConversa = useCallback(() => {
    salvos.current = new Map();
    setItems([]);
    setConversaId(null);
    setStatus('aberta');
    setTitulo('Nova conversa');
    setView('chat');
    setMostrarLista(false);
    setTimeout(() => inputRef.current?.focus(), 30);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        if (confirmar) setConfirmar(null);
        else setOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    const t = setTimeout(() => inputRef.current?.focus(), 50);
    return () => {
      window.removeEventListener('keydown', onKey);
      clearTimeout(t);
    };
  }, [open, confirmar]);

  // Ao abrir o painel (ou recarregar a página): a última conversa ativa volta aberta, com
  // cartões e botões. "Última ativa" vem do servidor (mais recente do usuário), nada no navegador.
  useEffect(() => {
    if (!open) return;
    void (async () => {
      const r = await chamar('GET', '/api/assistente/conversas');
      const lista: ConversaResumo[] = r.ok && Array.isArray(r.data?.data) ? r.data.data : [];
      setConversas(lista);
      if (carregouAtiva.current) return;
      carregouAtiva.current = true;
      if (lista[0] && !items.length && !conversaId) void abrirConversa(lista[0].id);
    })();
  }, [open, abrirConversa, items.length, conversaId]);

  useEffect(() => {
    if (view === 'chat') listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [items, busy, view]);

  // Persistência: grava os itens novos ou alterados da conversa (sem token, sem PDF).
  useEffect(() => {
    if (!conversaId || busy) return;
    const mudados = items.filter((it) => salvos.current.get(it.id) !== JSON.stringify(it));
    if (!mudados.length) return;
    const t = setTimeout(async () => {
      for (let i = 0; i < mudados.length; i += 40) {
        const lote = mudados.slice(i, i + 40);
        const r = await chamar('POST', `/api/assistente/conversas/${encodeURIComponent(conversaId)}/itens`, { itens: lote.map((it) => ({ id: it.id, item: it })) });
        if (r.ok) {
          for (const it of lote) salvos.current.set(it.id, JSON.stringify(it));
          if (r.data?.data?.titulo) setTitulo(r.data.data.titulo);
        } else if (r.status === 409) {
          setStatus('encerrada');
        }
      }
      void carregarLista(busca);
    }, 400);
    return () => clearTimeout(t);
  }, [items, conversaId, busy, carregarLista, busca]);

  const garantirConversa = useCallback(async (): Promise<string | null> => {
    if (conversaId) return conversaId;
    const r = await chamar('POST', '/api/assistente/conversas');
    if (!r.ok || !r.data?.data?.id) return null;
    setConversaId(r.data.data.id);
    setStatus('aberta');
    return r.data.data.id as string;
  }, [conversaId]);

  const enviar = useCallback(async (texto: string, selecao?: SelecaoUi, fluxoCartao?: Fluxo, marcar?: (cur: Item[]) => Item[]) => {
    if (!texto || busy || encerrada) return;
    void garantirConversa();
    const base = marcar ? marcar(items) : items;
    const next: Item[] = [...base, { id: uid(), tipo: 'usuario', texto }];
    setItems(next);
    setBusy(true);
    try {
      const fluxo = selecao ? fluxoCartao ?? fluxoAtual(base) : fluxoAtual(base);
      const res = await fetch('/api/assistente/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mensagens: historyFrom(next), ...(fluxo ? { fluxo } : {}), ...(selecao ? { selecao } : {}), ...(conversaId ? { conversaId } : {}) }),
      });
      const data = await res.json().catch(() => ({}));
      const fl: Fluxo = data && typeof data.fluxo === 'object' ? data.fluxo : null;
      if (!res.ok) {
        setItems((cur) => [...cur, { id: uid(), tipo: 'assistente', texto: data?.error || 'Não foi possível falar com o assistente.', erro: true, fluxo: fluxoAtual(base) }]);
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
          { id: uid(), tipo: 'resultado' as const, resultado, consulta, fluxo: fl },
        ]);
      } else if (data?.tipo === 'proposta' && data.proposta) {
        setItems((cur) => [...cur, { id: uid(), tipo: 'proposta', texto: data.texto || '', proposta: data.proposta, estado: 'pendente', fluxo: fl }]);
      } else if (data?.tipo === 'escolha_produto' && Array.isArray(data.opcoes)) {
        setItems((cur) => [...cur, { id: uid(), tipo: 'escolha_produto', texto: String(data.texto || ''), opcoes: data.opcoes, quantidade: Number(data.quantidade) || 1, precoRotulo: String(data.precoRotulo || 'Preço'), fluxo: fl }]);
      } else if (data?.tipo === 'sugestao_acessorios' && Array.isArray(data.grupos)) {
        setItems((cur) => [...cur, { id: uid(), tipo: 'sugestao_acessorios', texto: String(data.texto || ''), grupos: data.grupos, fluxo: fl }]);
      } else if (data?.tipo === 'escolha_cliente' && Array.isArray(data.opcoes)) {
        setItems((cur) => [...cur, { id: uid(), tipo: 'escolha_cliente', texto: String(data.texto || ''), opcoes: data.opcoes, fluxo: fl }]);
      } else {
        setItems((cur) => [...cur, { id: uid(), tipo: 'assistente', texto: String(data?.texto || ''), fluxo: fl }]);
      }
    } catch {
      setItems((cur) => [...cur, { id: uid(), tipo: 'assistente', texto: 'Falha de conexão com o assistente.', erro: true, fluxo: fluxoAtual(base) }]);
    } finally {
      setBusy(false);
    }
  }, [busy, encerrada, items, conversaId, garantirConversa]);

  const send = useCallback(() => {
    const texto = input.trim();
    if (!texto) return;
    setInput('');
    void enviar(texto);
  }, [input, enviar]);

  const decide = useCallback(async (id: string, confirmarAcao: boolean) => {
    const it = items.find((x) => x.id === id);
    if (!it || it.tipo !== 'proposta' || it.estado !== 'pendente') return;
    if (!confirmarAcao) {
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

  const darNota = useCallback(async (id: string, nota: Nota, motivo?: string) => {
    setItems((cur) => cur.map((x) => (x.id === id && (x.tipo === 'assistente' || x.tipo === 'resultado') ? { ...x, feedback: nota } : x)));
    if (!conversaId) return;
    // Garante o item gravado antes do feedback.
    const it = items.find((x) => x.id === id);
    if (it && salvos.current.get(id) === undefined) {
      await chamar('POST', `/api/assistente/conversas/${encodeURIComponent(conversaId)}/itens`, { itens: [{ id, item: { ...it, feedback: nota } }] });
    }
    const r = await chamar('POST', `/api/assistente/conversas/${encodeURIComponent(conversaId)}/feedback`, { itemId: id, nota, ...(motivo ? { motivo } : {}), pergunta: perguntaAntes(items, id).slice(0, 2000) });
    if (r.ok && r.data?.memoria) setAviso('Obrigado. Anotei para as próximas respostas (veja em "O que aprendi").');
    else if (!r.ok && r.data?.error) setAviso(String(r.data.error));
    setTimeout(() => setAviso(''), 4000);
  }, [conversaId, items]);

  const mudarStatus = useCallback(async (novo: 'aberta' | 'encerrada') => {
    if (!conversaId) return;
    const r = await chamar('PATCH', `/api/assistente/conversas/${encodeURIComponent(conversaId)}`, { status: novo });
    if (r.ok) {
      setStatus(novo);
      void carregarLista(busca);
    }
  }, [conversaId, carregarLista, busca]);

  const executarApagar = useCallback(async () => {
    if (!confirmar) return;
    if (confirmar.tipo === 'apagar') {
      const r = await chamar('DELETE', `/api/assistente/conversas/${encodeURIComponent(confirmar.id)}`, { confirmar: true });
      if (r.ok && confirmar.id === conversaId) novaConversa();
    } else {
      const r = await chamar('DELETE', '/api/assistente/conversas', { confirmar: 'APAGAR_TODAS' });
      if (r.ok) novaConversa();
    }
    setConfirmar(null);
    void carregarLista(busca);
  }, [confirmar, conversaId, novaConversa, carregarLista, busca]);

  const download = (t: { colunas: string[]; linhas: string[][] }) => {
    const blob = new Blob(['\ufeff' + toCsv(t)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `assistente-sti-hub-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const ultimoInterativo = (() => {
    for (let i = items.length - 1; i >= 0; i--) if (items[i].tipo !== 'usuario') return items[i].id;
    return null;
  })();

  const btnCab = 'p-1.5 rounded hover:bg-white/15 cursor-pointer inline-flex items-center gap-1 text-[11px] font-semibold';

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
          className={`fixed top-0 right-0 z-[70] h-screen w-full bg-white border-l border-slate-200 shadow-2xl flex text-slate-800 select-text ${mostrarLista ? 'sm:w-[700px]' : 'sm:w-[460px]'}`}
          style={{ userSelect: 'text', WebkitUserSelect: 'text' }}
        >
          {mostrarLista && (
            <nav data-testid="assistente-lista-conversas" aria-label="Conversas" className="w-[240px] shrink-0 border-r border-slate-200 bg-white flex flex-col">
              <div className="px-3 py-3 text-white flex items-center justify-between" style={{ backgroundColor: accent.base }}>
                <p className="text-[12.5px] font-semibold">Conversas</p>
                <button type="button" onClick={() => setMostrarLista(false)} aria-label="Fechar lista" className="p-1 rounded hover:bg-white/15 cursor-pointer"><X className="w-3.5 h-3.5" /></button>
              </div>
              <div className="p-2 border-b border-slate-100 space-y-2">
                <button type="button" onClick={novaConversa} className="w-full inline-flex items-center justify-center gap-1 rounded px-2 py-1.5 text-white text-[11.5px] font-semibold cursor-pointer" style={{ backgroundColor: accent.base }}>
                  <MessageSquarePlus className="w-3.5 h-3.5" /> Nova conversa
                </button>
                <label className="flex items-center gap-1 rounded border border-slate-300 px-2 py-1">
                  <Search className="w-3.5 h-3.5 text-slate-400" />
                  <input value={busca} onChange={(e) => { setBusca(e.target.value); void carregarLista(e.target.value); }} placeholder="Buscar conversas" className="flex-1 text-[11.5px] outline-none" />
                </label>
              </div>
              <ul className="flex-1 overflow-y-auto">
                {conversas.length === 0 && <li className="px-3 py-3 text-[11px] text-slate-500">{busca ? 'Nada encontrado.' : 'Nenhuma conversa ainda.'}</li>}
                {conversas.map((c) => (
                  <li key={c.id} className={`group border-b border-slate-100 ${c.id === conversaId ? 'bg-slate-50' : ''}`}>
                    <div className="flex items-start gap-1 px-3 py-2">
                      <button type="button" onClick={() => void abrirConversa(c.id).then(() => setMostrarLista(window.innerWidth >= 640))} className="flex-1 min-w-0 text-left cursor-pointer">
                        <span className="block text-[11.5px] font-semibold text-slate-800 truncate" title={c.titulo}>{c.titulo}</span>
                        <span className="flex items-center gap-1 text-[10px] text-slate-500">
                          {dataCurta(c.atualizadaEm)}
                          {c.status === 'encerrada' ? <span className="inline-flex items-center gap-0.5"><Lock className="w-2.5 h-2.5" /> encerrada</span> : null}
                        </span>
                      </button>
                      <button type="button" aria-label={`Apagar ${c.titulo}`} title="Apagar conversa" onClick={() => setConfirmar({ tipo: 'apagar', id: c.id, titulo: c.titulo })} className="p-1 text-slate-400 hover:text-red-700 cursor-pointer"><Trash2 className="w-3.5 h-3.5" /></button>
                    </div>
                  </li>
                ))}
              </ul>
              <div className="p-2 border-t border-slate-100">
                <button type="button" disabled={!conversas.length} onClick={() => setConfirmar({ tipo: 'apagar_todas' })} className="w-full text-[11px] text-red-700 font-semibold hover:underline cursor-pointer disabled:opacity-40">Apagar todas as minhas conversas</button>
              </div>
            </nav>
          )}

          <div className="flex-1 min-w-0 flex flex-col relative">
            <div className="flex items-center justify-between gap-2 px-3 py-2.5 text-white" style={{ backgroundColor: accent.base }}>
              <div className="flex items-center gap-2 min-w-0">
                {!mostrarLista && (
                  <button type="button" onClick={() => { setMostrarLista(true); void carregarLista(busca); }} aria-label="Conversas" title="Conversas" className={btnCab}><History className="w-4 h-4" /></button>
                )}
                <div className="leading-tight min-w-0">
                  <p className="text-sm font-semibold truncate" title={titulo}>{view === 'aprendizado' ? 'O que o assistente aprendeu' : titulo === 'Nova conversa' ? 'Assistente STI-hub' : titulo}</p>
                  <p className="text-[10px] text-white/80">Consultas são imediatas; alterações pedem confirmação</p>
                </div>
              </div>
              <div className="flex items-center gap-0.5 shrink-0">
                <button type="button" onClick={novaConversa} title="Nova conversa" aria-label="Nova conversa" className={btnCab}><MessageSquarePlus className="w-4 h-4" /></button>
                <button type="button" onClick={() => setView(view === 'aprendizado' ? 'chat' : 'aprendizado')} title="O que o assistente aprendeu" aria-label="O que o assistente aprendeu" className={btnCab}><Brain className="w-4 h-4" /></button>
                {conversaId && view === 'chat' && (
                  encerrada ? (
                    <button type="button" onClick={() => mudarStatus('aberta')} title="Reabrir conversa" aria-label="Reabrir conversa" className={btnCab}><Unlock className="w-4 h-4" /></button>
                  ) : (
                    <button type="button" onClick={() => mudarStatus('encerrada')} title="Encerrar conversa" aria-label="Encerrar conversa" className={btnCab}><Lock className="w-4 h-4" /></button>
                  )
                )}
                {conversaId && view === 'chat' && (
                  <button type="button" onClick={() => setConfirmar({ tipo: 'apagar', id: conversaId, titulo })} title="Apagar conversa" aria-label="Apagar conversa" className={btnCab}><Trash2 className="w-4 h-4" /></button>
                )}
                <button type="button" onClick={() => setOpen(false)} aria-label="Fechar (Esc)" title="Fechar (Esc)" className={btnCab}><X className="w-4 h-4" /></button>
              </div>
            </div>

            {view === 'aprendizado' ? (
              <TelaAprendizado cor={accent.base} onVoltar={() => setView('chat')} />
            ) : (
              <>
                <div ref={listRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3 bg-slate-50">
                  {items.length === 0 && (
                    <div className="rounded-md border border-slate-200 bg-white p-3 text-[12px] text-slate-600 space-y-2">
                      <p className="font-semibold text-slate-800">Olá{userName ? `, ${userName.split(' ')[0]}` : ''}. Posso ajudar com:</p>
                      <ul className="list-disc pl-4 space-y-0.5">
                        <li>Consultas de contratos, vendas, OS, empresas, contatos, faturas e negócios</li>
                        <li>Relatórios simples por situação ou por mês</li>
                        <li>Dados completos do orçamento com link do cliente, Versão contrato e PDF</li>
                        <li>Rascunho de proposta com os produtos do cadastro e acessórios compatíveis</li>
                        <li>Abertura de chamado e de OS</li>
                      </ul>
                      <p className="flex items-center gap-1 text-[11px] text-slate-500">
                        <ShieldCheck className="w-3.5 h-3.5" /> Uso só as suas permissões. Consultas saem na hora; o que grava ou altera dados pede confirmação.
                      </p>
                      <p className="text-[11px] text-slate-500">As conversas ficam salvas no histórico (ícone de relógio). Diga "sempre ..." para eu aprender uma preferência.</p>
                    </div>
                  )}

                  {items.map((it) => {
                    const desabilitado = encerrada || busy || it.id !== ultimoInterativo;
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
                          <div data-testid="assistente-resposta" className={`max-w-[90%] rounded-lg px-3 py-2 text-[12.5px] border select-text ${it.erro ? 'bg-red-50 border-red-200 text-red-700' : 'bg-white border-slate-200'}`}>
                            <TextoMd texto={it.texto} />
                            <div className="mt-1 flex items-center justify-end gap-3 whitespace-normal">
                              {!it.erro && conversaId ? <Feedback nota={it.feedback} cor={accent.base} onNota={(n, m) => void darNota(it.id, n, m)} /> : null}
                              <BotaoCopiar texto={textoSemMarkdown(it.texto)} cor={accent.base} />
                            </div>
                          </div>
                        </div>
                      );
                    }
                    if (it.tipo === 'escolha_produto') {
                      return (
                        <CartaoEscolhaProduto
                          key={it.id}
                          texto={it.texto}
                          opcoes={it.opcoes}
                          quantidade={it.quantidade}
                          precoRotulo={it.precoRotulo}
                          escolhido={it.escolhido}
                          cor={accent.base}
                          desabilitado={desabilitado}
                          onEscolher={(s, rotulo) => void enviar(rotulo, s, it.fluxo, (cur) => cur.map((x) => (x.id === it.id && x.tipo === 'escolha_produto' && s.tipo === 'modelo' ? { ...x, escolhido: s.codigo } : x)))}
                        />
                      );
                    }
                    if (it.tipo === 'sugestao_acessorios') {
                      return (
                        <CartaoAcessorios
                          key={it.id}
                          texto={it.texto}
                          grupos={it.grupos}
                          enviado={it.enviado}
                          cor={accent.base}
                          desabilitado={desabilitado}
                          onEnviar={(s, rotulo) => void enviar(rotulo, s, it.fluxo, (cur) => cur.map((x) => (x.id === it.id && x.tipo === 'sugestao_acessorios' ? { ...x, enviado: true } : x)))}
                        />
                      );
                    }
                    if (it.tipo === 'escolha_cliente') {
                      return (
                        <CartaoEscolhaCliente
                          key={it.id}
                          texto={it.texto}
                          opcoes={it.opcoes}
                          escolhido={it.escolhido}
                          cor={accent.base}
                          desabilitado={desabilitado}
                          onEscolher={(s, rotulo) => void enviar(rotulo, s, it.fluxo, (cur) => cur.map((x) => (x.id === it.id && x.tipo === 'escolha_cliente' && s.tipo === 'cliente' ? { ...x, escolhido: s.indice } : x)))}
                        />
                      );
                    }
                    if (it.tipo === 'proposta') {
                      const p = it.proposta;
                      const leitura = p.acao === 'leitura';
                      return (
                        <div key={it.id} data-testid="assistente-cartao" className="rounded-md border bg-white text-[12px]" style={{ borderColor: accent.base }}>
                          {it.texto ? <div className="px-3 pt-2 text-slate-700"><TextoMd texto={it.texto} /></div> : null}
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
                              <BotaoCopiar texto={textoDoCartao({ texto: it.texto ? textoSemMarkdown(it.texto) : undefined, titulo: p.titulo, linhas: p.linhas })} cor={accent.base} />
                            </span>
                            {it.estado === 'pendente' && !encerrada && (
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
                            {it.estado === 'expirada' && (
                              <span className="inline-flex items-center gap-1 text-slate-500 font-semibold"><XCircle className="w-3.5 h-3.5" /> Expirada — peça de novo para confirmar</span>
                            )}
                            {it.estado === 'erro' && <span className="inline-flex items-center gap-1 text-red-700 font-semibold"><XCircle className="w-3.5 h-3.5" /> Não executada</span>}
                          </div>
                        </div>
                      );
                    }
                    return (
                      <CartaoResultado
                        key={it.id}
                        it={it}
                        accent={accent}
                        onAbrirRegistro={onAbrirRegistro}
                        download={download}
                        rodape={conversaId && it.resultado.ok ? <Feedback nota={it.feedback} cor={accent.base} onNota={(n, m) => void darNota(it.id, n, m)} /> : null}
                      />
                    );
                  })}

                  {busy && (
                    <div className="inline-flex items-center gap-2 text-[12px] text-slate-500">
                      <Loader2 className="w-3.5 h-3.5 animate-spin" /> Pensando…
                    </div>
                  )}
                </div>

                {aviso ? <p className="px-3 py-1 text-[11px] text-emerald-800 bg-emerald-50 border-t border-emerald-100">{aviso}</p> : null}

                {encerrada ? (
                  <div data-testid="assistente-encerrada" className="border-t border-slate-200 p-3 bg-white text-[12px] text-slate-600 flex flex-wrap items-center gap-2">
                    <Lock className="w-3.5 h-3.5" /> Conversa encerrada (somente leitura).
                    <button type="button" onClick={() => mudarStatus('aberta')} className="font-semibold cursor-pointer hover:underline" style={{ color: accent.base }}>Reabrir e continuar</button>
                    <span className="text-slate-300">|</span>
                    <button type="button" onClick={novaConversa} className="font-semibold cursor-pointer hover:underline" style={{ color: accent.base }}>Nova conversa</button>
                  </div>
                ) : (
                  <form
                    className="border-t border-slate-200 p-3 bg-white"
                    onSubmit={(e) => {
                      e.preventDefault();
                      send();
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
                            send();
                          }
                        }}
                        placeholder="Ex.: proposta 4709, gere uma proposta de 1 switch cisco 3850, faturas vencidas"
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
                    <p className="mt-1 text-[10px] text-slate-400 text-right">{input.length}/{MAX_CHARS} • Shift+Enter quebra linha • Esc fecha</p>
                  </form>
                )}
              </>
            )}

            {confirmar && (
              <div role="alertdialog" aria-modal="true" aria-label="Confirmar exclusão" data-testid="assistente-confirmar-apagar" className="absolute inset-0 z-10 bg-slate-900/40 flex items-center justify-center p-4">
                <div className="w-full max-w-sm rounded-md bg-white shadow-xl p-4 text-[12.5px]">
                  <p className="font-semibold text-slate-900">{confirmar.tipo === 'apagar' ? 'Apagar esta conversa?' : 'Apagar todas as suas conversas?'}</p>
                  <p className="mt-1 text-slate-600">
                    {confirmar.tipo === 'apagar' ? `"${confirmar.titulo}" e todo o histórico dela serão apagados.` : 'Todo o seu histórico de conversas com o assistente será apagado.'} Não dá para desfazer. A exclusão fica registrada na auditoria. O que o assistente aprendeu continua (apague em "O que o assistente aprendeu").
                  </p>
                  <div className="mt-3 flex justify-end gap-2">
                    <button type="button" onClick={() => setConfirmar(null)} className="px-3 py-1 rounded-[4px] border border-slate-300 text-slate-700 font-semibold hover:bg-slate-50 cursor-pointer">Cancelar</button>
                    <button type="button" onClick={() => void executarApagar()} className="px-3 py-1 rounded-[4px] bg-red-700 hover:bg-red-800 text-white font-semibold cursor-pointer">{confirmar.tipo === 'apagar' ? 'Apagar conversa' : 'Apagar todas'}</button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </aside>
      )}
    </>
  );
}
