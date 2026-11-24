'use client';

// STI-hub — Assistente de IA interno (etapa 1): botao do cabecalho + painel lateral de chat.
// Toda acao passa por um cartao com Confirmar/Cancelar antes de o servidor executar.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Bot, CheckCircle2, Download, Loader2, Send, ShieldCheck, X, XCircle } from 'lucide-react';

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

interface Resultado {
  ok: boolean;
  mensagem: string;
  tabela?: { colunas: string[]; linhas: string[][] };
  totais?: Array<{ rotulo: string; valor: string }>;
  resumoParaModelo?: string;
}

type Item =
  | { id: string; tipo: 'usuario'; texto: string }
  | { id: string; tipo: 'assistente'; texto: string; erro?: boolean }
  | { id: string; tipo: 'proposta'; texto?: string; proposta: Proposta; estado: 'pendente' | 'executando' | 'confirmada' | 'cancelada' | 'erro' }
  | { id: string; tipo: 'resultado'; resultado: Resultado };

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

export default function AssistenteIaPanel({ system = 'crm', userName }: { system?: HeaderSystem; userName?: string }) {
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
        ? { ok: data?.ok === true, mensagem: String(data?.mensagem || ''), tabela: data?.tabela, totais: data?.totais, resumoParaModelo: data?.resumoParaModelo }
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
          className="fixed top-0 right-0 z-[70] h-screen w-full sm:w-[420px] bg-white border-l border-slate-200 shadow-2xl flex flex-col text-slate-800"
        >
          <div className="flex items-center justify-between px-4 py-3 text-white" style={{ backgroundColor: accent.base }}>
            <div className="flex items-center gap-2">
              <Bot className="w-4 h-4" />
              <div className="leading-tight">
                <p className="text-sm font-semibold">Assistente STI-hub</p>
                <p className="text-[10px] text-white/80">Confirma cada ação antes de executar</p>
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
                  <li>Rascunho de proposta, abertura de chamado e de OS</li>
                </ul>
                <p className="flex items-center gap-1 text-[11px] text-slate-500">
                  <ShieldCheck className="w-3.5 h-3.5" /> Uso só as suas permissões e peço confirmação antes de qualquer ação.
                </p>
              </div>
            )}

            {items.map((it) => {
              if (it.tipo === 'usuario') {
                return (
                  <div key={it.id} className="flex justify-end">
                    <div className="max-w-[85%] rounded-lg px-3 py-2 text-[12.5px] text-white whitespace-pre-wrap" style={{ backgroundColor: accent.base }}>
                      {it.texto}
                    </div>
                  </div>
                );
              }
              if (it.tipo === 'assistente') {
                return (
                  <div key={it.id} className="flex">
                    <div className={`max-w-[90%] rounded-lg px-3 py-2 text-[12.5px] whitespace-pre-wrap border ${it.erro ? 'bg-red-50 border-red-200 text-red-700' : 'bg-white border-slate-200'}`}>
                      {it.texto}
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
                <div key={it.id} className={`rounded-md border p-3 text-[12px] ${r.ok ? 'bg-white border-slate-200' : 'bg-red-50 border-red-200 text-red-700'}`}>
                  <p className="font-semibold">{r.mensagem}</p>
                  {r.totais && r.totais.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {r.totais.map((t) => (
                        <span key={t.rotulo} className="rounded px-2 py-1 font-semibold" style={{ backgroundColor: accent.soft, color: accent.base }}>
                          {t.rotulo}: {t.valor}
                        </span>
                      ))}
                    </div>
                  )}
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
                      <button type="button" onClick={() => download(r.tabela!)} className="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold cursor-pointer" style={{ color: accent.base }}>
                        <Download className="w-3.5 h-3.5" /> Baixar CSV
                      </button>
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
