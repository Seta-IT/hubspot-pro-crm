'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  CONTACT_DEPARTMENT_KIND,
  CONTACT_POSITION_KIND,
  DEFAULT_CONTACT_DEPARTMENTS,
  DEFAULT_CONTACT_POSITIONS,
  optionsWithLegacyValue,
  type ContactFieldListKind,
  type SelectOption,
} from './contact-field-lists';

export type ContactFieldListItem = {
  id: string;
  kind: ContactFieldListKind;
  label: string;
  sortOrder: number;
  active: boolean;
};

type ListsState = {
  contactPosition: ContactFieldListItem[];
  contactDepartment: ContactFieldListItem[];
};

const empty: ListsState = { contactPosition: [], contactDepartment: [] };

async function parseLists(res: Response): Promise<ListsState | null> {
  if (!res.ok) return null;
  const json = (await res.json().catch(() => null)) as { data?: ListsState } | null;
  return json?.data || null;
}

export function useContactFieldOptions() {
  const [items, setItems] = useState<ListsState>(empty);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async (includeInactive = false) => {
    const res = await fetch(
      `/api/crm/contact-field-lists${includeInactive ? '?includeInactive=1' : ''}`
    );
    const lists = await parseLists(res);
    if (lists) setItems(lists);
    setLoading(false);
    return lists;
  }, []);

  useEffect(() => {
    void reload(false);
  }, [reload]);

  const activeLabels = useCallback(
    (kind: ContactFieldListKind) =>
      items[kind].filter((i) => i.active !== false).map((i) => i.label),
    [items]
  );

  const optionsFor = useCallback(
    (kind: ContactFieldListKind, current?: string | null): SelectOption[] => {
      const labels = activeLabels(kind);
      const fallback = kind === CONTACT_POSITION_KIND ? DEFAULT_CONTACT_POSITIONS : DEFAULT_CONTACT_DEPARTMENTS;
      return optionsWithLegacyValue(labels.length ? labels : fallback, current);
    },
    [activeLabels]
  );

  const addItem = useCallback(async (kind: ContactFieldListKind, label: string) => {
    const res = await fetch('/api/crm/contact-field-lists', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind, label }),
    });
    const json = (await res.json().catch(() => null)) as { error?: string } | null;
    if (!res.ok) throw new Error(json?.error || 'Não foi possível adicionar o item.');
    await reload(true);
  }, [reload]);

  const updateItem = useCallback(
    async (id: string, patch: { label?: string; active?: boolean }) => {
      const res = await fetch(`/api/crm/contact-field-lists/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const json = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) throw new Error(json?.error || 'Não foi possível atualizar o item.');
      await reload(true);
    },
    [reload]
  );

  const reorder = useCallback(async (kind: ContactFieldListKind, ids: string[]) => {
    const res = await fetch('/api/crm/contact-field-lists/reorder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind, ids }),
    });
    const json = (await res.json().catch(() => null)) as { error?: string } | null;
    if (!res.ok) throw new Error(json?.error || 'Não foi possível reordenar a lista.');
    await reload(true);
  }, [reload]);

  return { items, loading, reload, optionsFor, activeLabels, addItem, updateItem, reorder };
}
