'use client';

// STI-hub — Assistente: markdown simples e seguro no chat (25/11/2026: os **negritos**
// apareciam crus). Só negrito, itálico, código, listas e quebras de linha; vira elementos
// React (nunca HTML do texto), então não há como injetar marcação.
import { Fragment, type ReactNode } from 'react';

const INLINE_RE = /(\*\*[^*\n]+?\*\*|__[^_\n]+?__|`[^`\n]+?`|\*[^*\s][^*\n]*?\*|_[^_\s][^_\n]*?_)/g;

export function renderInline(texto: string, chave = 'i'): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let n = 0;
  for (const m of texto.matchAll(INLINE_RE)) {
    const idx = m.index ?? 0;
    if (idx > last) out.push(texto.slice(last, idx));
    const tok = m[0];
    const k = `${chave}-${n++}`;
    if (tok.startsWith('**') || tok.startsWith('__')) out.push(<strong key={k} className="font-semibold">{tok.slice(2, -2)}</strong>);
    else if (tok.startsWith('`')) out.push(<code key={k} className="px-1 rounded bg-slate-100 text-[11.5px] font-mono">{tok.slice(1, -1)}</code>);
    else out.push(<em key={k}>{tok.slice(1, -1)}</em>);
    last = idx + tok.length;
  }
  if (last < texto.length) out.push(texto.slice(last));
  return out;
}

/** Remove a marcação (para o botão Copiar levar texto limpo). */
export function textoSemMarkdown(texto: string): string {
  return String(texto || '')
    .replace(/\*\*([^*\n]+?)\*\*/g, '$1')
    .replace(/__([^_\n]+?)__/g, '$1')
    .replace(/`([^`\n]+?)`/g, '$1')
    .replace(/^#{1,6}\s+/gm, '');
}

export default function TextoMd({ texto, className = '' }: { texto: string; className?: string }) {
  const linhas = String(texto || '').split('\n');
  const blocos: ReactNode[] = [];
  let lista: { tipo: 'ul' | 'ol'; itens: string[] } | null = null;
  const fecharLista = () => {
    if (!lista) return;
    const l = lista;
    const k = `l-${blocos.length}`;
    blocos.push(
      l.tipo === 'ul' ? (
        <ul key={k} className="list-disc pl-5 space-y-0.5">{l.itens.map((t, i) => <li key={i}>{renderInline(t, `${k}-${i}`)}</li>)}</ul>
      ) : (
        <ol key={k} className="list-decimal pl-5 space-y-0.5">{l.itens.map((t, i) => <li key={i}>{renderInline(t, `${k}-${i}`)}</li>)}</ol>
      ),
    );
    lista = null;
  };
  linhas.forEach((linha, i) => {
    const ul = linha.match(/^\s*[-•*]\s+(.*)$/);
    const ol = linha.match(/^\s*\d{1,2}[.)]\s+(.*)$/);
    if (ul) {
      if (lista?.tipo !== 'ul') fecharLista();
      lista = lista || { tipo: 'ul', itens: [] };
      lista.itens.push(ul[1]);
      return;
    }
    if (ol) {
      if (lista?.tipo !== 'ol') fecharLista();
      lista = lista || { tipo: 'ol', itens: [] };
      lista.itens.push(ol[1]);
      return;
    }
    fecharLista();
    const h = linha.match(/^#{1,6}\s+(.*)$/);
    if (h) blocos.push(<p key={`h-${i}`} className="font-semibold">{renderInline(h[1], `h-${i}`)}</p>);
    else if (!linha.trim()) blocos.push(<div key={`b-${i}`} className="h-2" />);
    else blocos.push(<p key={`p-${i}`}>{renderInline(linha, `p-${i}`)}</p>);
  });
  fecharLista();
  return <div className={`space-y-0.5 whitespace-normal break-words ${className}`}>{blocos.map((b, i) => <Fragment key={i}>{b}</Fragment>)}</div>;
}
