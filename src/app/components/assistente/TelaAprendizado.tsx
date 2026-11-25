'use client';

// STI-hub — Assistente: "O que o assistente aprendeu" (ver, editar, desativar e apagar cada
// lição) + regras de compatibilidade de acessórios (gestores editam).
import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, Loader2, Pencil, Plus, Trash2, Check, X } from 'lucide-react';

interface Memoria { id: string; tipo: 'preferencia' | 'correcao' | 'feedback' | 'sugestao'; texto: string; cnpj: string | null; dados: any; ativa: boolean; atualizadaEm: string }
interface Regra { id: string; familia: string; categoria: string; padrao: string; excluir: string | null; observacao: string; ativa: boolean; ordem: number }

const ROTULO: Record<Memoria['tipo'], string> = { preferencia: 'Preferência', correcao: 'Correção', feedback: 'Feedback', sugestao: 'Acessório' };
const CAT: Record<string, string> = { fonte: 'Fonte', optico: 'Óptico', uplink: 'Uplink', acessorio: 'Acessório' };
const dataBr = (iso: string) => {
  try { return new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch { return ''; }
};
const cnpjFmt = (d: string) => `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;

async function api(method: string, path: string, body?: unknown) {
  const res = await fetch(path, { method, headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', cache: 'no-store', body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

export default function TelaAprendizado({ cor, onVoltar }: { cor: string; onVoltar: () => void }) {
  const [memorias, setMemorias] = useState<Memoria[] | null>(null);
  const [regras, setRegras] = useState<Regra[]>([]);
  const [podeEditar, setPodeEditar] = useState(false);
  const [erro, setErro] = useState('');
  const [editando, setEditando] = useState<string | null>(null);
  const [texto, setTexto] = useState('');
  const [nova, setNova] = useState('');
  const [confirmarApagar, setConfirmarApagar] = useState<string | null>(null);
  const [novaRegra, setNovaRegra] = useState({ familia: '', categoria: 'fonte', padrao: '', excluir: '' });

  const carregar = useCallback(async () => {
    const [m, r] = await Promise.all([api('GET', '/api/assistente/memorias'), api('GET', '/api/assistente/regras')]);
    if (!m.ok) setErro(m.data?.error || 'Não foi possível carregar.');
    setMemorias(Array.isArray(m.data?.data) ? m.data.data : []);
    setRegras(Array.isArray(r.data?.data) ? r.data.data : []);
    setPodeEditar(r.data?.podeEditar === true);
  }, []);
  useEffect(() => { void carregar(); }, [carregar]);

  const salvarTexto = async (id: string) => {
    const r = await api('PATCH', `/api/assistente/memorias/${id}`, { texto });
    if (!r.ok) return setErro(r.data?.error || 'Não foi possível salvar.');
    setEditando(null);
    setErro('');
    void carregar();
  };
  const alternar = async (m: Memoria) => { await api('PATCH', `/api/assistente/memorias/${m.id}`, { ativa: !m.ativa }); void carregar(); };
  const apagar = async (id: string) => { await api('DELETE', `/api/assistente/memorias/${id}`); setConfirmarApagar(null); void carregar(); };
  const adicionar = async () => {
    const r = await api('POST', '/api/assistente/memorias', { texto: nova });
    if (!r.ok) return setErro(r.data?.error || 'Não foi possível adicionar.');
    setNova('');
    setErro('');
    void carregar();
  };
  const salvarRegra = async () => {
    const r = await api('POST', '/api/assistente/regras', { ...novaRegra, excluir: novaRegra.excluir || null });
    if (!r.ok) return setErro(r.data?.error || 'Regra inválida.');
    setNovaRegra({ familia: '', categoria: 'fonte', padrao: '', excluir: '' });
    setErro('');
    void carregar();
  };
  const alternarRegra = async (r: Regra) => { await api('PUT', `/api/assistente/regras/${r.id}`, { ...r, ativa: !r.ativa }); void carregar(); };
  const apagarRegra = async (id: string) => { await api('DELETE', `/api/assistente/regras/${id}`); void carregar(); };

  const licoes = (memorias || []).filter((m) => m.tipo !== 'sugestao');
  const sugestoes = (memorias || []).filter((m) => m.tipo === 'sugestao');

  return (
    <div data-testid="assistente-aprendizado" className="flex-1 overflow-y-auto bg-slate-50 px-4 py-3 text-[12px] space-y-4">
      <div className="flex items-center gap-2">
        <button type="button" onClick={onVoltar} className="inline-flex items-center gap-1 text-[11.5px] font-semibold cursor-pointer" style={{ color: cor }}><ArrowLeft className="w-3.5 h-3.5" /> Voltar à conversa</button>
      </div>
      <div>
        <h3 className="text-[13px] font-semibold text-slate-900">O que o assistente aprendeu</h3>
        <p className="text-[11px] text-slate-500">Preferências, correções e feedback que você ensinou. Só você vê. Senhas, tokens e cartões nunca são guardados; lição de um CNPJ só vale para ele (Trava Fiscal).</p>
      </div>
      {erro ? <p className="rounded border border-red-200 bg-red-50 px-2 py-1 text-red-700">{erro}</p> : null}
      {memorias === null ? (
        <p className="inline-flex items-center gap-2 text-slate-500"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Carregando…</p>
      ) : (
        <ul className="space-y-2">
          {licoes.length === 0 && <li className="text-slate-500">Nada aprendido ainda. Diga, por exemplo: "sempre use frete incluso nas propostas da Foxconn".</li>}
          {licoes.map((m) => (
            <li key={m.id} data-testid="assistente-memoria" className={`rounded-md border bg-white p-2 ${m.ativa ? 'border-slate-200' : 'border-dashed border-slate-300 opacity-70'}`}>
              <div className="flex items-center gap-2 text-[10.5px] text-slate-500">
                <span className="rounded px-1.5 py-0.5 font-semibold text-white" style={{ backgroundColor: cor }}>{ROTULO[m.tipo]}</span>
                {m.cnpj ? <span>CNPJ {cnpjFmt(m.cnpj)}</span> : null}
                <span className="ml-auto">{dataBr(m.atualizadaEm)}</span>
              </div>
              {editando === m.id ? (
                <div className="mt-1 flex items-start gap-1">
                  <textarea value={texto} onChange={(e) => setTexto(e.target.value)} rows={2} maxLength={500} className="flex-1 rounded border border-slate-300 px-2 py-1 text-[12px]" />
                  <button type="button" aria-label="Salvar" onClick={() => salvarTexto(m.id)} className="p-1 rounded text-white cursor-pointer" style={{ backgroundColor: cor }}><Check className="w-3.5 h-3.5" /></button>
                  <button type="button" aria-label="Cancelar" onClick={() => setEditando(null)} className="p-1 rounded border border-slate-300 cursor-pointer"><X className="w-3.5 h-3.5" /></button>
                </div>
              ) : (
                <p className="mt-1 text-slate-800 whitespace-pre-wrap">{m.texto}</p>
              )}
              <div className="mt-1 flex items-center gap-3 text-[11px]">
                <button type="button" onClick={() => { setEditando(m.id); setTexto(m.texto); }} className="inline-flex items-center gap-1 cursor-pointer" style={{ color: cor }}><Pencil className="w-3 h-3" /> Editar</button>
                <button type="button" onClick={() => alternar(m)} className="cursor-pointer text-slate-600">{m.ativa ? 'Desativar' : 'Reativar'}</button>
                {confirmarApagar === m.id ? (
                  <span className="inline-flex items-center gap-2 text-red-700">Apagar esta lição?
                    <button type="button" onClick={() => apagar(m.id)} className="font-semibold underline cursor-pointer">Sim, apagar</button>
                    <button type="button" onClick={() => setConfirmarApagar(null)} className="cursor-pointer text-slate-600">Não</button>
                  </span>
                ) : (
                  <button type="button" onClick={() => setConfirmarApagar(m.id)} className="inline-flex items-center gap-1 text-red-700 cursor-pointer"><Trash2 className="w-3 h-3" /> Apagar</button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-start gap-1">
        <input value={nova} onChange={(e) => setNova(e.target.value)} maxLength={500} placeholder="Ensinar algo novo (ex.: prefiro validade de 10 dias)" className="flex-1 rounded border border-slate-300 px-2 py-1 text-[12px]" />
        <button type="button" disabled={nova.trim().length < 3} onClick={adicionar} className="inline-flex items-center gap-1 px-2 py-1 rounded text-white text-[11.5px] font-semibold cursor-pointer disabled:opacity-50" style={{ backgroundColor: cor }}><Plus className="w-3.5 h-3.5" /> Adicionar</button>
      </div>

      {sugestoes.length > 0 && (
        <div>
          <h4 className="text-[12px] font-semibold text-slate-900">Acessórios que você aceita ou recusa</h4>
          <ul className="mt-1 space-y-1">
            {sugestoes.map((m) => (
              <li key={m.id} className="flex items-center gap-2 rounded border border-slate-200 bg-white px-2 py-1">
                <span className="flex-1"><b>{m.dados?.item}</b> com {m.dados?.base} — aceito {m.dados?.aceitos || 0}x, recusado {m.dados?.recusados || 0}x</span>
                <button type="button" aria-label="Apagar" onClick={() => apagar(m.id)} className="text-red-700 cursor-pointer"><Trash2 className="w-3.5 h-3.5" /></button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <h4 className="text-[12px] font-semibold text-slate-900">Regras de compatibilidade de acessórios</h4>
        <p className="text-[11px] text-slate-500">Família do modelo → padrão do part number no cadastro (com *). {podeEditar ? 'Você pode editar.' : 'Só gestores editam.'}</p>
        <div className="mt-1 max-h-56 overflow-auto rounded border border-slate-200 bg-white">
          <table className="w-full text-[11px]">
            <thead className="bg-slate-50 text-slate-500"><tr><th className="px-2 py-1 text-left">Modelo</th><th className="px-2 py-1 text-left">Tipo</th><th className="px-2 py-1 text-left">Acessório</th><th className="px-2 py-1 text-left">Exceto</th>{podeEditar ? <th /> : null}</tr></thead>
            <tbody>
              {regras.map((r) => (
                <tr key={r.id} className={`border-t border-slate-100 ${r.ativa ? '' : 'opacity-50'}`}>
                  <td className="px-2 py-1 font-mono">{r.familia}</td><td className="px-2 py-1">{CAT[r.categoria] || r.categoria}</td><td className="px-2 py-1 font-mono">{r.padrao}</td><td className="px-2 py-1 font-mono">{r.excluir || ''}</td>
                  {podeEditar ? (
                    <td className="px-2 py-1 whitespace-nowrap">
                      <button type="button" onClick={() => alternarRegra(r)} className="mr-2 cursor-pointer" style={{ color: cor }}>{r.ativa ? 'Desativar' : 'Ativar'}</button>
                      <button type="button" aria-label="Apagar regra" onClick={() => apagarRegra(r.id)} className="text-red-700 cursor-pointer"><Trash2 className="inline w-3 h-3" /></button>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {podeEditar && (
          <div className="mt-1 flex flex-wrap items-center gap-1">
            <input value={novaRegra.familia} onChange={(e) => setNovaRegra({ ...novaRegra, familia: e.target.value })} placeholder="WS-C3850-*" className="w-28 rounded border border-slate-300 px-1.5 py-0.5 text-[11px] font-mono" />
            <select value={novaRegra.categoria} onChange={(e) => setNovaRegra({ ...novaRegra, categoria: e.target.value })} className="rounded border border-slate-300 px-1 py-0.5 text-[11px]">
              {Object.entries(CAT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <input value={novaRegra.padrao} onChange={(e) => setNovaRegra({ ...novaRegra, padrao: e.target.value })} placeholder="PWR-C1-*" className="w-24 rounded border border-slate-300 px-1.5 py-0.5 text-[11px] font-mono" />
            <input value={novaRegra.excluir} onChange={(e) => setNovaRegra({ ...novaRegra, excluir: e.target.value })} placeholder="exceto (opcional)" className="w-28 rounded border border-slate-300 px-1.5 py-0.5 text-[11px] font-mono" />
            <button type="button" disabled={!novaRegra.familia || !novaRegra.padrao} onClick={salvarRegra} className="px-2 py-0.5 rounded text-white text-[11px] font-semibold cursor-pointer disabled:opacity-50" style={{ backgroundColor: cor }}>Adicionar regra</button>
          </div>
        )}
      </div>
    </div>
  );
}
