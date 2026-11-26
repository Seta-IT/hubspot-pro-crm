'use client';

/**
 * Painel lateral de associacao (direita): abas "Criar novo" | "Adicionar existente".
 * Busca no servidor (rotas existentes, com RBAC), contador total, ordenacao, paginacao,
 * itens por pagina, selecao multipla, ja associados marcados; rodape fixo Salvar/Cancelar.
 * Criar novo: campos secundarios esmaecidos ate preencher os primarios; "Criar" (cria e
 * associa) e "Criar e adicionar outro". Esc fecha.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Search, X } from 'lucide-react';
import {
  ASSOCIATION_LABELS,
  ASSOCIATION_PAGE_SIZES,
  ASSOCIATION_SORT_OPTIONS,
  CREATE_HINT,
  CREATE_PRIMARY_FIELDS,
  buildAssociationSearchUrl,
  buildCreateBody,
  createSecondaryEnabled,
  createValid,
  looksLikeEmail,
  pageWindow,
  parseAssociationSearchResponse,
  prefillFromQuery,
  totalPages,
  type AssociationKind,
  type AssociationRow,
  type AssociationSort,
} from '../lib/association-panel';

import PhoneInput from './PhoneInput';
type FieldDef = { key: string; label: string; type?: string; options?: Array<{ id: string; label: string }> };

const FIELDS: Record<AssociationKind, FieldDef[]> = {
  contacts: [
    { key: 'email', label: 'E-mail', type: 'email' },
    { key: 'firstName', label: 'Nome' },
    { key: 'lastName', label: 'Sobrenome' },
    { key: 'phone', label: 'Número de telefone' },
    { key: 'mobile', label: 'Número de celular' },
    { key: 'jobTitle', label: 'Posição' },
    { key: 'department', label: 'Área' },
    { key: 'ownerName', label: 'Proprietário do contato' },
    { key: 'website', label: 'URL do site' },
  ],
  companies: [
    { key: 'name', label: 'Nome da empresa' },
    { key: 'domain', label: 'Domínio da empresa' },
    { key: 'cnpj', label: 'CNPJ' },
    { key: 'phone', label: 'Número de telefone' },
    { key: 'city', label: 'Cidade' },
  ],
  deals: [
    { key: 'title', label: 'Nome do negócio' },
    { key: 'value', label: 'Valor (R$)' },
  ],
  tickets: [
    { key: 'subject', label: 'Assunto' },
    { key: 'description', label: 'Descrição' },
    {
      key: 'priority',
      label: 'Prioridade',
      options: [
        { id: 'LOW', label: 'Baixa' },
        { id: 'MEDIUM', label: 'Média' },
        { id: 'HIGH', label: 'Alta' },
        { id: 'CRITICAL', label: 'Crítica' },
      ],
    },
  ],
};

export interface AssociationSidePanelProps {
  kind: AssociationKind;
  /** Ids ja associados ao registro (aparecem marcados e travados). */
  associatedIds: string[];
  /** Grava as associacoes novas (ids marcados que ainda nao estavam associados). */
  onSave: (ids: string[]) => Promise<void>;
  onClose: () => void;
  /** Permissao de criar (RBAC do item); sem ela a aba Criar novo fica desabilitada. */
  canCreate?: boolean;
  /** Valores fixos da criacao (ex.: dealId/companyId do registro de origem). */
  createDefaults?: Record<string, unknown>;
  currentUserName?: string | null;
  initialTab?: 'create' | 'existing';
  /** Para testes/screenshots: fetch injetavel. */
  fetcher?: typeof fetch;
  onToast?: (msg: string) => void;
}

export default function AssociationSidePanel({
  kind,
  associatedIds,
  onSave,
  onClose,
  canCreate = true,
  createDefaults,
  currentUserName,
  initialTab = 'existing',
  fetcher,
  onToast,
}: AssociationSidePanelProps) {
  // Estavel entre renders: um fetch novo a cada render reiniciava a busca em laco.
  const f = useMemo(
    () => fetcher || (typeof fetch !== 'undefined' ? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init)) as typeof fetch : undefined),
    [fetcher]
  );
  const L = ASSOCIATION_LABELS[kind];
  const [tab, setTab] = useState<'create' | 'existing'>(canCreate ? initialTab : 'existing');
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<AssociationSort>('recent');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [rows, setRows] = useState<AssociationRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<Record<string, AssociationRow>>({});
  const [saving, setSaving] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({ ownerName: currentUserName || '' });
  const reqSeq = useRef(0);
  const already = useMemo(() => new Set(associatedIds), [associatedIds]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    if (tab !== 'existing' || !f) return;
    const seq = ++reqSeq.current;
    const t = setTimeout(async () => {
      setLoading(true);
      setError('');
      try {
        const res = await f(buildAssociationSearchUrl(kind, { q, sort, page, pageSize }), { cache: 'no-store' });
        const json = await res.json().catch(() => ({}));
        if (seq !== reqSeq.current) return;
        if (!res.ok) {
          setRows([]);
          setTotal(0);
          setError((json as { error?: string }).error || 'Não foi possível buscar agora.');
          return;
        }
        const parsed = parseAssociationSearchResponse(kind, json);
        setRows(parsed.rows);
        setTotal(parsed.total);
      } catch {
        if (seq === reqSeq.current) setError('Não foi possível buscar agora.');
      } finally {
        if (seq === reqSeq.current) setLoading(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [f, kind, q, sort, page, pageSize, tab]);

  const newIds = Object.keys(selected).filter((id) => !already.has(id));
  const pages = totalPages(total, pageSize);

  const save = async () => {
    if (!newIds.length) return;
    setSaving(true);
    try {
      await onSave(newIds);
      onClose();
    } catch (err) {
      onToast?.(err instanceof Error ? err.message : 'Não foi possível salvar a associação.');
    } finally {
      setSaving(false);
    }
  };

  const create = async (another: boolean) => {
    if (!f || !createValid(kind, values)) return;
    setSaving(true);
    try {
      const route = kind === 'contacts' ? '/api/contacts' : kind === 'companies' ? '/api/companies' : kind === 'deals' ? '/api/deals' : '/api/tickets';
      const res = await f(route, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...buildCreateBody(kind, values, { ownerName: currentUserName }), ...(createDefaults || {}) }),
      });
      const json = (await res.json().catch(() => ({}))) as { data?: { id?: string }; error?: string };
      if (!res.ok || !json.data?.id) {
        onToast?.(json.error || `Não foi possível criar o(a) ${L.singular.toLowerCase()}.`);
        return;
      }
      await onSave([json.data.id]);
      onToast?.(`${L.singular} criado(a) e associado(a).`);
      if (another) setValues({ ownerName: currentUserName || '' });
      else onClose();
    } catch (err) {
      onToast?.(err instanceof Error ? err.message : `Não foi possível criar o(a) ${L.singular.toLowerCase()}.`);
    } finally {
      setSaving(false);
    }
  };

  const toggle = (r: AssociationRow) => {
    if (already.has(r.id)) return;
    setSelected((p) => {
      const n = { ...p };
      if (n[r.id]) delete n[r.id];
      else n[r.id] = r;
      return n;
    });
  };

  const secondaryOn = createSecondaryEnabled(kind, values);
  const primary = CREATE_PRIMARY_FIELDS[kind];
  const offerCreate = canCreate && kind === 'contacts' && looksLikeEmail(q) && !loading && total === 0;

  return (
    <div className="fixed inset-0 z-[70] bg-slate-900/30 flex justify-end" data-testid={`assoc-panel-${kind}`} data-assoc-panel-open="1" onClick={onClose}>
      <aside
        role="dialog"
        aria-label={tab === 'create' ? L.createTitle : L.addTitle}
        className="h-full w-full max-w-[560px] bg-white shadow-2xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="px-5 py-3 bg-[#0b6b7a] text-white flex items-center justify-between">
          <h2 className="text-base font-semibold">{tab === 'create' ? L.createTitle : L.addTitle}</h2>
          <button type="button" onClick={onClose} aria-label="Fechar" className="p-1 rounded hover:bg-white/15 cursor-pointer">
            <X className="w-5 h-5" />
          </button>
        </header>
        <div className="px-5 border-b border-slate-200 flex gap-6 text-sm font-semibold" role="tablist">
          {(['create', 'existing'] as const).map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={tab === t}
              disabled={t === 'create' && !canCreate}
              title={t === 'create' && !canCreate ? 'Seu perfil não tem permissão para criar.' : undefined}
              onClick={() => setTab(t)}
              className={`py-3 border-b-2 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${tab === t ? 'border-slate-800 text-slate-900' : 'border-transparent text-slate-500'}`}
            >
              {t === 'create' ? 'Criar novo' : 'Adicionar existente'}
            </button>
          ))}
        </div>

        {tab === 'existing' ? (
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
            <label className="relative block">
              <input
                autoFocus
                value={q}
                onChange={(e) => {
                  setQ(e.target.value);
                  setPage(1);
                }}
                placeholder={L.searchPlaceholder}
                data-testid={`assoc-search-${kind}`}
                className="w-full pl-3 pr-9 py-2 rounded-md border border-slate-300 text-sm focus:outline-none focus:border-[#0b6b7a]"
              />
              <Search className="w-4 h-4 text-slate-500 absolute right-3 top-1/2 -translate-y-1/2" />
            </label>
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-slate-800" data-testid={`assoc-total-${kind}`}>
                {total.toLocaleString('pt-BR')} {L.plural}
              </span>
              <select
                value={sort}
                onChange={(e) => {
                  setSort(e.target.value as AssociationSort);
                  setPage(1);
                }}
                disabled={kind === 'tickets'}
                className="text-[#0b6b7a] font-semibold bg-transparent cursor-pointer"
                aria-label="Ordenação"
              >
                {ASSOCIATION_SORT_OPTIONS.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            {error ? <p className="text-xs text-rose-700 font-semibold">{error}</p> : null}
            <ul className="divide-y divide-slate-100 border-t border-b border-slate-100">
              {rows.map((r) => {
                const isAlready = already.has(r.id);
                const checked = isAlready || Boolean(selected[r.id]);
                return (
                  <li key={r.id}>
                    <label className={`flex items-start gap-3 py-2.5 text-sm ${isAlready ? 'opacity-70' : 'cursor-pointer'}`}>
                      <input type="checkbox" checked={checked} disabled={isAlready} onChange={() => toggle(r)} className="mt-0.5 w-4 h-4 accent-[#0b6b7a]" />
                      <span className="min-w-0">
                        <span className="block text-slate-900 break-all">{r.label}</span>
                        {r.hint ? <span className="block text-[11px] text-slate-500">{r.hint}</span> : null}
                        {isAlready ? <span className="block text-[11px] font-semibold text-[#0b6b7a]">Já associado</span> : null}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
            {!loading && rows.length === 0 && !error ? (
              <div className="text-sm text-slate-600 space-y-2" data-testid={`assoc-empty-${kind}`}>
                <p>Nenhum(a) {L.singular.toLowerCase()} encontrado(a){q.trim() ? ` para "${q.trim()}"` : ''}.</p>
                {offerCreate ? (
                  <button
                    type="button"
                    onClick={() => {
                      setValues((v) => ({ ...v, ...prefillFromQuery(kind, q) }));
                      setTab('create');
                    }}
                    className="text-[#0b6b7a] font-semibold hover:underline cursor-pointer"
                    data-testid="assoc-offer-create"
                  >
                    Criar contato com {q.trim()}
                  </button>
                ) : canCreate && q.trim() ? (
                  <button
                    type="button"
                    onClick={() => {
                      setValues((v) => ({ ...v, ...prefillFromQuery(kind, q) }));
                      setTab('create');
                    }}
                    className="text-[#0b6b7a] font-semibold hover:underline cursor-pointer"
                  >
                    Criar novo(a) {L.singular.toLowerCase()} "{q.trim()}"
                  </button>
                ) : null}
              </div>
            ) : null}
            {loading ? <p className="text-xs text-slate-500">Buscando…</p> : null}
            <div className="flex items-center justify-center gap-1 text-sm pt-1" aria-label="Paginação">
              <button type="button" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="p-1 disabled:opacity-30 cursor-pointer" aria-label="Página anterior">
                <ChevronLeft className="w-4 h-4" />
              </button>
              {pageWindow(page, pages).map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setPage(n)}
                  className={`min-w-7 px-1.5 py-0.5 rounded cursor-pointer ${n === page ? 'border border-slate-400 font-semibold' : 'text-[#0b6b7a]'}`}
                >
                  {n}
                </button>
              ))}
              <button type="button" disabled={page >= pages} onClick={() => setPage((p) => p + 1)} className="p-1 disabled:opacity-30 cursor-pointer" aria-label="Próxima página">
                <ChevronRight className="w-4 h-4" />
              </button>
              <select
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value));
                  setPage(1);
                }}
                className="ml-3 text-[#0b6b7a] font-semibold bg-transparent cursor-pointer"
                aria-label="Itens por página"
              >
                {ASSOCIATION_PAGE_SIZES.map((n) => (
                  <option key={n} value={n}>
                    {n} itens
                  </option>
                ))}
              </select>
            </div>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
            <div className="text-right">
              <span className="text-xs font-semibold text-slate-400" title="Em breve">Editar este formulário</span>
            </div>
            {FIELDS[kind].map((fd) => {
              const enabled = primary.includes(fd.key) || secondaryOn;
              return (
                <label key={fd.key} className={`block ${enabled ? '' : 'opacity-40'}`}>
                  <span className="block text-sm font-semibold text-slate-800 mb-1">{fd.label}</span>
                  {fd.options ? (
                    <select
                      disabled={!enabled}
                      value={values[fd.key] || ''}
                      onChange={(e) => setValues((v) => ({ ...v, [fd.key]: e.target.value }))}
                      className="w-full px-3 py-2 rounded-md border border-slate-300 text-sm"
                    >
                      <option value="">Selecionar</option>
                      {fd.options.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  ) : fd.key === 'phone' || fd.key === 'mobile' ? (
                    <PhoneInput
                      kind={fd.key === 'mobile' ? 'mobile' : 'phone'}
                      disabled={!enabled}
                      value={values[fd.key] || ''}
                      onChange={(v) => setValues((vals) => ({ ...vals, [fd.key]: v }))}
                      data-testid={`assoc-create-${kind}-${fd.key}`}
                    />
                  ) : (
                    <input
                      type={fd.type || 'text'}
                      disabled={!enabled}
                      value={values[fd.key] || ''}
                      onChange={(e) => setValues((v) => ({ ...v, [fd.key]: e.target.value }))}
                      data-testid={`assoc-create-${kind}-${fd.key}`}
                      className="w-full px-3 py-2 rounded-md border border-slate-300 text-sm disabled:bg-slate-50"
                    />
                  )}
                  {fd.key === primary[primary.length - 1] && !secondaryOn ? (
                    <span className="block mt-3 text-xs text-slate-500">{CREATE_HINT[kind]}</span>
                  ) : null}
                </label>
              );
            })}
          </div>
        )}

        <footer className="px-5 py-3 border-t border-slate-200 bg-slate-50 flex items-center gap-2">
          {tab === 'existing' ? (
            <>
              <button
                type="button"
                disabled={!newIds.length || saving}
                onClick={() => void save()}
                data-testid={`assoc-save-${kind}`}
                className="px-4 py-2 rounded-md bg-[#ff5c35] text-white text-sm font-semibold cursor-pointer disabled:bg-slate-200 disabled:text-slate-500 disabled:cursor-not-allowed"
              >
                {saving ? 'Salvando…' : newIds.length > 1 ? `Salvar (${newIds.length})` : 'Salvar'}
              </button>
              <button type="button" onClick={onClose} className="px-4 py-2 rounded-md border border-[#ff5c35] text-[#ff5c35] text-sm font-semibold cursor-pointer">
                Cancelar
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                disabled={!createValid(kind, values) || saving}
                onClick={() => void create(false)}
                data-testid={`assoc-create-${kind}`}
                className="px-4 py-2 rounded-md bg-[#ff5c35] text-white text-sm font-semibold cursor-pointer disabled:bg-slate-200 disabled:text-slate-500 disabled:cursor-not-allowed"
              >
                Criar
              </button>
              <button
                type="button"
                disabled={!createValid(kind, values) || saving}
                onClick={() => void create(true)}
                className="px-4 py-2 rounded-md border border-[#ff5c35] text-[#ff5c35] text-sm font-semibold cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Criar e adicionar outro
              </button>
              <button type="button" onClick={onClose} className="px-4 py-2 rounded-md border border-[#ff5c35] text-[#ff5c35] text-sm font-semibold cursor-pointer">
                Cancelar
              </button>
            </>
          )}
        </footer>
      </aside>
    </div>
  );
}
