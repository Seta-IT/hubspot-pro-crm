'use client';

import React, { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp } from 'lucide-react';
import {
  CONTACT_DEPARTMENT_KIND,
  CONTACT_POSITION_KIND,
  type ContactFieldListKind,
} from '../lib/contact-field-lists';
import { useContactFieldOptions, type ContactFieldListItem } from '../lib/use-contact-field-options';

const LISTS: Array<{ kind: ContactFieldListKind; title: string; hint: string }> = [
  { kind: CONTACT_POSITION_KIND, title: 'Posição', hint: 'Cargo ou senioridade do contato e do usuário (ex.: Diretor, Gerente).' },
  { kind: CONTACT_DEPARTMENT_KIND, title: 'Área', hint: 'Área ou departamento (ex.: Comercial, TI, Financeiro).' },
];

export default function ContactFieldListsSettings({
  onShowToast,
}: {
  onShowToast?: (msg: string) => void;
}) {
  const { items, loading, reload, addItem, updateItem, reorder } = useContactFieldOptions();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void reload(true);
  }, [reload]);

  const run = async (fn: () => Promise<void>, ok?: string) => {
    setBusy(true);
    try {
      await fn();
      if (ok) onShowToast?.(ok);
    } catch (err) {
      onShowToast?.(err instanceof Error ? err.message : 'Não foi possível atualizar a lista.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div data-testid="contact-field-lists-settings" className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-slate-900">Posição e Área</h2>
        <p className="text-xs text-slate-500 mt-1">
          Estas listas alimentam os campos de Posição e Área nos cadastros de contato e de usuário.
          Você pode adicionar, renomear, reordenar e desativar opções. Valores antigos em texto livre
          continuam visíveis nos registros, mesmo que não estejam mais na lista.
        </p>
      </div>
      {loading && !items.contactPosition.length && !items.contactDepartment.length ? (
        <p className="text-xs text-slate-500">Carregando listas…</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {LISTS.map((list) => {
            const rows: ContactFieldListItem[] = items[list.kind] || [];
            return (
              <div key={list.kind} data-testid={`contact-field-list-${list.kind}`} className="rounded-lg border border-slate-200 p-3 space-y-2">
                <div>
                  <div className="text-sm font-semibold text-slate-800">{list.title}</div>
                  <p className="text-[11px] text-slate-500">{list.hint}</p>
                </div>
                <div className="space-y-1.5">
                  {rows.map((item, idx) => (
                    <div key={item.id} className={`flex items-center gap-1 ${item.active === false ? 'opacity-60' : ''}`}>
                      <div className="flex flex-col">
                        <button
                          type="button"
                          aria-label={`Subir ${item.label}`}
                          disabled={busy || idx === 0}
                          onClick={() => {
                            const next = rows.map((r) => r.id);
                            [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
                            void run(() => reorder(list.kind, next));
                          }}
                          className="p-0.5 text-slate-500 hover:text-slate-800 disabled:opacity-30 cursor-pointer"
                        >
                          <ArrowUp className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          aria-label={`Descer ${item.label}`}
                          disabled={busy || idx === rows.length - 1}
                          onClick={() => {
                            const next = rows.map((r) => r.id);
                            [next[idx + 1], next[idx]] = [next[idx], next[idx + 1]];
                            void run(() => reorder(list.kind, next));
                          }}
                          className="p-0.5 text-slate-500 hover:text-slate-800 disabled:opacity-30 cursor-pointer"
                        >
                          <ArrowDown className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      <input
                        aria-label={`${list.title} ${idx + 1}`}
                        key={`${item.id}:${item.label}`}
                        defaultValue={item.label}
                        disabled={busy || item.active === false}
                        onBlur={(e) => {
                          const nextLabel = e.target.value.trim();
                          if (!nextLabel || nextLabel === item.label) {
                            e.target.value = item.label;
                            return;
                          }
                          void run(() => updateItem(item.id, { label: nextLabel }), `“${nextLabel}” atualizado em ${list.title}.`);
                        }}
                        className="flex-1 px-2 py-1.5 rounded border border-slate-300 bg-white text-xs"
                      />
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          void run(
                            () => updateItem(item.id, { active: item.active === false }),
                            item.active === false
                              ? `“${item.label}” reativado em ${list.title}.`
                              : `“${item.label}” desativado em ${list.title}.`
                          )
                        }
                        className={`px-2 py-1 rounded border text-[11px] font-semibold cursor-pointer ${
                          item.active === false
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                            : 'bg-slate-50 text-slate-600 border-slate-200'
                        }`}
                      >
                        {item.active === false ? 'Reativar' : 'Desativar'}
                      </button>
                    </div>
                  ))}
                </div>
                <div className="flex items-center gap-1 pt-1">
                  <input
                    value={drafts[list.kind] || ''}
                    onChange={(e) => setDrafts((d) => ({ ...d, [list.kind]: e.target.value }))}
                    placeholder={`Nova opção de ${list.title}`}
                    className="flex-1 px-2 py-1.5 rounded border border-slate-300 text-xs"
                  />
                  <button
                    type="button"
                    disabled={busy || !(drafts[list.kind] || '').trim()}
                    onClick={() => {
                      const v = (drafts[list.kind] || '').trim();
                      if (!v) return;
                      void run(async () => {
                        await addItem(list.kind, v);
                        setDrafts((d) => ({ ...d, [list.kind]: '' }));
                      }, `“${v}” cadastrado em ${list.title}.`);
                    }}
                    className="px-2.5 py-1.5 rounded border border-slate-300 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer disabled:opacity-50"
                  >
                    + Adicionar
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
