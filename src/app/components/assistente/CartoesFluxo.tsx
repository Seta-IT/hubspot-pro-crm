'use client';

// STI-hub — Assistente: cartões do rascunho de proposta guiado (lista de modelos do cadastro,
// acessórios compatíveis com caixas de seleção e quantidade, escolha da empresa).
import { useState } from 'react';
import { Check, PackageSearch, Plug, Building2 } from 'lucide-react';
import TextoMd from './TextoMd';

export interface OpcaoModeloUi { codigo: string; descricao: string; preco: number | null; estoque: number }
export interface SugestaoUi { codigo: string; descricao: string; preco: number | null; estoque: number; categoria: string; observacao: string; marcado: boolean; quantidade: number }
export interface GrupoUi { categoria: string; rotulo: string; itens: SugestaoUi[] }

export type SelecaoUi =
  | { tipo: 'modelo'; codigo: string; quantidade?: number; valor?: number }
  | { tipo: 'acessorios'; itens: Array<{ codigo: string; quantidade: number }> }
  | { tipo: 'cliente'; indice: number };

const brl = (n: number | null | undefined) => (n && n > 0 ? n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : 'a definir');
const parseValor = (v: string): number | undefined => {
  const t = v.trim().replace(/[R$\s]/g, '');
  if (!t) return undefined;
  const n = Number(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
};

function Estoque({ n }: { n: number }) {
  const cls = n > 0 ? 'text-emerald-700 bg-emerald-50' : 'text-amber-700 bg-amber-50';
  return <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10.5px] font-semibold ${cls}`}>estoque {n}</span>;
}

export function CartaoEscolhaProduto({
  texto, opcoes, quantidade, precoRotulo, escolhido, cor, desabilitado, onEscolher,
}: {
  texto: string; opcoes: OpcaoModeloUi[]; quantidade: number; precoRotulo: string; escolhido?: string; cor: string; desabilitado?: boolean;
  onEscolher: (s: SelecaoUi, rotulo: string) => void;
}) {
  const [qtd, setQtd] = useState(String(quantidade || 1));
  const [valor, setValor] = useState('');
  const travado = !!escolhido || desabilitado;
  return (
    <div data-testid="assistente-escolha-produto" className="rounded-md border bg-white text-[12px]" style={{ borderColor: cor }}>
      <div className="px-3 pt-2 flex items-start gap-2 text-slate-700">
        <PackageSearch className="w-4 h-4 mt-0.5 shrink-0" style={{ color: cor }} />
        <TextoMd texto={texto} />
      </div>
      <div className="px-3 pt-2 flex flex-wrap items-center gap-3 text-[11px] text-slate-600">
        <label className="inline-flex items-center gap-1">Quantidade
          <input type="number" min={1} value={qtd} disabled={travado} onChange={(e) => setQtd(e.target.value)} className="w-16 rounded border border-slate-300 px-1.5 py-0.5 text-[12px]" />
        </label>
        <label className="inline-flex items-center gap-1">Valor unitário
          <input type="text" inputMode="decimal" placeholder="do cadastro" value={valor} disabled={travado} onChange={(e) => setValor(e.target.value)} className="w-24 rounded border border-slate-300 px-1.5 py-0.5 text-[12px]" />
        </label>
      </div>
      <ul className="mt-2 divide-y divide-slate-100 border-t border-slate-100">
        {opcoes.map((o) => {
          const sel = escolhido === o.codigo;
          return (
            <li key={o.codigo}>
              <button
                type="button"
                disabled={travado}
                data-testid="assistente-opcao-modelo"
                onClick={() => {
                  const q = Math.max(1, Math.round(Number(qtd) || 1));
                  const v = parseValor(valor);
                  onEscolher({ tipo: 'modelo', codigo: o.codigo, quantidade: q, ...(v !== undefined ? { valor: v } : {}) }, `Modelo: ${o.codigo} (${q} un.${v !== undefined ? `, ${brl(v)}` : ''})`);
                }}
                className={`w-full text-left px-3 py-2 flex items-start gap-2 ${travado ? 'cursor-default' : 'hover:bg-slate-50 cursor-pointer'} ${sel ? 'bg-slate-50' : ''} ${travado && !sel ? 'opacity-60' : ''}`}
              >
                <span className="flex-1 min-w-0">
                  <span className="block font-semibold text-slate-900">{sel ? <Check className="inline w-3.5 h-3.5 mr-1" style={{ color: cor }} /> : null}{o.codigo}</span>
                  <span className="block text-[11px] text-slate-500 truncate" title={o.descricao}>{o.descricao}</span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="block text-[11.5px] font-semibold" style={{ color: cor }}>{brl(o.preco)}</span>
                  <span className="block text-[10px] text-slate-400">{precoRotulo}</span>
                </span>
                <Estoque n={o.estoque} />
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function CartaoAcessorios({
  texto, grupos, enviado, cor, desabilitado, onEnviar,
}: {
  texto: string; grupos: GrupoUi[]; enviado?: boolean; cor: string; desabilitado?: boolean;
  onEnviar: (s: SelecaoUi, rotulo: string) => void;
}) {
  const todos = grupos.flatMap((g) => g.itens);
  const [marcados, setMarcados] = useState<Record<string, boolean>>(() => Object.fromEntries(todos.map((i) => [i.codigo, i.marcado])));
  const [qtds, setQtds] = useState<Record<string, string>>(() => Object.fromEntries(todos.map((i) => [i.codigo, String(i.quantidade || 1)])));
  const travado = !!enviado || desabilitado;
  const escolhidos = todos.filter((i) => marcados[i.codigo]).map((i) => ({ codigo: i.codigo, quantidade: Math.max(1, Math.round(Number(qtds[i.codigo]) || 1)) }));
  return (
    <div data-testid="assistente-acessorios" className="rounded-md border bg-white text-[12px]" style={{ borderColor: cor }}>
      <div className="px-3 pt-2 flex items-start gap-2 text-slate-700">
        <Plug className="w-4 h-4 mt-0.5 shrink-0" style={{ color: cor }} />
        <TextoMd texto={texto} />
      </div>
      {grupos.map((g) => (
        <div key={g.categoria} className="mt-2">
          <p className="px-3 py-1 text-[10.5px] font-semibold uppercase tracking-wide text-slate-500 bg-slate-50 border-y border-slate-100">{g.rotulo}</p>
          <ul className="divide-y divide-slate-100">
            {g.itens.map((i) => (
              <li key={i.codigo} className="px-3 py-1.5 flex items-start gap-2">
                <input
                  type="checkbox"
                  aria-label={`Incluir ${i.codigo}`}
                  checked={!!marcados[i.codigo]}
                  disabled={travado}
                  onChange={(e) => setMarcados((m) => ({ ...m, [i.codigo]: e.target.checked }))}
                  className="mt-0.5 h-4 w-4 cursor-pointer"
                  style={{ accentColor: cor }}
                />
                <span className="flex-1 min-w-0">
                  <span className="block font-semibold text-slate-900">{i.codigo}{i.marcado ? <span className="ml-1 text-[10px] font-normal text-emerald-700">(você costuma incluir)</span> : null}</span>
                  <span className="block text-[11px] text-slate-500 truncate" title={i.descricao}>{i.descricao}</span>
                </span>
                <span className="shrink-0 text-[11px] font-semibold" style={{ color: cor }}>{brl(i.preco)}</span>
                <Estoque n={i.estoque} />
                <input
                  type="number"
                  min={1}
                  aria-label={`Quantidade de ${i.codigo}`}
                  value={qtds[i.codigo]}
                  disabled={travado || !marcados[i.codigo]}
                  onChange={(e) => setQtds((q) => ({ ...q, [i.codigo]: e.target.value }))}
                  className="w-12 rounded border border-slate-300 px-1 py-0.5 text-[11.5px] disabled:opacity-40"
                />
              </li>
            ))}
          </ul>
        </div>
      ))}
      <div className="flex items-center gap-2 px-3 py-2 border-t border-slate-100">
        {travado ? (
          <span className="text-[11px] text-slate-500">{enviado ? 'Escolha enviada.' : ''}</span>
        ) : (
          <>
            <button
              type="button"
              disabled={!escolhidos.length}
              onClick={() => onEnviar({ tipo: 'acessorios', itens: escolhidos }, `Acessórios: ${escolhidos.map((e) => `${e.quantidade}x ${e.codigo}`).join(', ')}`)}
              className="px-3 py-1 rounded-[4px] text-white text-[12px] font-semibold cursor-pointer disabled:opacity-50"
              style={{ backgroundColor: cor }}
            >
              Adicionar selecionados ({escolhidos.length})
            </button>
            <button type="button" onClick={() => onEnviar({ tipo: 'acessorios', itens: [] }, 'Seguir sem acessórios')} className="px-3 py-1 rounded-[4px] border border-slate-300 text-slate-700 text-[12px] font-semibold hover:bg-slate-50 cursor-pointer">
              Seguir sem acessórios
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export function CartaoEscolhaCliente({
  texto, opcoes, escolhido, cor, desabilitado, onEscolher,
}: {
  texto: string; opcoes: Array<{ indice: number; nome: string; cnpj: string }>; escolhido?: number; cor: string; desabilitado?: boolean;
  onEscolher: (s: SelecaoUi, rotulo: string) => void;
}) {
  const travado = escolhido !== undefined || desabilitado;
  return (
    <div className="rounded-md border bg-white text-[12px]" style={{ borderColor: cor }}>
      <div className="px-3 pt-2 flex items-start gap-2 text-slate-700">
        <Building2 className="w-4 h-4 mt-0.5 shrink-0" style={{ color: cor }} />
        <TextoMd texto={texto} />
      </div>
      <ul className="mt-2 divide-y divide-slate-100 border-t border-slate-100">
        {opcoes.map((o) => (
          <li key={o.indice}>
            <button
              type="button"
              disabled={travado}
              onClick={() => onEscolher({ tipo: 'cliente', indice: o.indice }, `Empresa: ${o.nome}${o.cnpj ? ` (CNPJ ${o.cnpj})` : ''}`)}
              className={`w-full text-left px-3 py-2 ${travado ? 'cursor-default' : 'hover:bg-slate-50 cursor-pointer'} ${escolhido === o.indice ? 'bg-slate-50 font-semibold' : ''} ${travado && escolhido !== o.indice ? 'opacity-60' : ''}`}
            >
              <span className="block text-slate-900">{o.nome}</span>
              {o.cnpj ? <span className="block text-[11px] text-slate-500">CNPJ {o.cnpj}</span> : null}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
