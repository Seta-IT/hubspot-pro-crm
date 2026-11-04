'use client';
// Lista "Nunca registrar": e-mails trocados so com estes enderecos/dominios nao entram na
// linha do tempo nem sao rastreados. Leitura para todos; inclusao/remocao so do administrador.
import { useCallback, useEffect, useState } from 'react';
import { Ban, Loader2, Plus, Trash2 } from 'lucide-react';
import { BTN_OUTLINE, BTN_PRIMARY, CARD, formatEmailDate, INPUT, mailboxApi, TAG_GRAY } from './mailbox-client';

interface Entry {
  pattern: string;
  createdBy: string;
  createdAt: string;
}

export default function NeverLogPanel() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [loading, setLoading] = useState(true);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/mailbox/never-log', { cache: 'no-store' });
      const json = await res.json().catch(() => null);
      if (res.ok) {
        setEntries(Array.isArray(json?.data) ? json.data : []);
        setCanManage(json?.canManage === true);
      } else {
        setNotice(json?.error || 'Não foi possível carregar a lista.');
      }
    } catch {
      setNotice('Não foi possível carregar a lista.');
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const add = async () => {
    if (!value.trim()) return;
    setBusy(true);
    const r = await mailboxApi<{ pattern: string; added: boolean }>('/never-log', { method: 'POST', body: { pattern: value.trim() } });
    setNotice(r.ok && r.data ? (r.data.added ? `${r.data.pattern} incluído.` : `${r.data.pattern} já estava na lista.`) : r.error);
    if (r.ok) setValue('');
    setBusy(false);
    void load();
  };

  const remove = async (pattern: string) => {
    if (!window.confirm(`Remover ${pattern} da lista Nunca registrar?`)) return;
    setBusy(true);
    const r = await mailboxApi(`/never-log/${encodeURIComponent(pattern)}`, { method: 'DELETE' });
    setNotice(r.ok ? `${pattern} removido.` : r.error);
    setBusy(false);
    void load();
  };

  return (
    <div className={CARD}>
      <div>
        <h4 className="text-sm font-semibold text-slate-900 flex items-center gap-1.5">
          <Ban className="w-4 h-4 text-accent" /> Nunca registrar
        </h4>
        <p className="text-[11px] font-semibold text-slate-500">
          E-mails trocados apenas com estes domínios ou endereços não entram na linha do tempo e não são rastreados.
        </p>
      </div>

      {canManage && (
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void add();
              }
            }}
            placeholder="*@empresa.com.br ou pessoa@empresa.com.br"
            aria-label="Domínio ou e-mail"
            className={`${INPUT} flex-1 min-w-[200px]`}
          />
          <button type="button" onClick={add} disabled={busy || !value.trim()} className={BTN_PRIMARY}>
            <Plus className="w-3.5 h-3.5" /> Adicionar
          </button>
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-xs font-semibold text-slate-500">
          <Loader2 className="w-4 h-4 animate-spin" /> Carregando...
        </div>
      ) : entries.length === 0 ? (
        <p className="text-xs font-semibold text-slate-500">Lista vazia.</p>
      ) : (
        <ul className="divide-y divide-slate-100 border border-slate-200 rounded-lg">
          {entries.map((e) => (
            <li key={e.pattern} className="flex flex-wrap items-center justify-between gap-2 p-2.5">
              <div className="min-w-0">
                <div className="text-xs font-semibold text-slate-900">{e.pattern}</div>
                <div className="text-[11px] font-semibold text-slate-500">
                  {e.createdBy}
                  {e.createdAt ? ` • ${formatEmailDate(e.createdAt)}` : ''}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className={TAG_GRAY}>{e.pattern.startsWith('*@') ? 'Domínio' : 'Endereço'}</span>
                {canManage && (
                  <button type="button" onClick={() => remove(e.pattern)} disabled={busy} className={BTN_OUTLINE}>
                    <Trash2 className="w-3.5 h-3.5" /> Remover
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {notice && <p className="text-[11px] font-semibold text-slate-600">{notice}</p>}
    </div>
  );
}
