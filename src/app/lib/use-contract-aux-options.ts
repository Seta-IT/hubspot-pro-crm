"use client";

import { useCallback, useEffect, useState } from 'react';
import {
  loadContractAuxiliaryOptions,
  saveContractAuxiliaryOptions,
  type ContractAuxiliaryOptions,
} from './contract-billing-utils';
import type { AuxListItem, AuxListKind } from '../../modules/erp/aux-lists-store';

type DbLists = {
  costCenters: AuxListItem[];
  chartOfAccountsList: AuxListItem[];
};

const EMPTY_DB: DbLists = { costCenters: [], chartOfAccountsList: [] };

async function parseAuxListsResponse(res: Response): Promise<DbLists | null> {
  if (!res.ok) return null;
  const body = (await res.json()) as { data?: Partial<DbLists> };
  const costCenters = Array.isArray(body.data?.costCenters) ? body.data.costCenters : [];
  const chartOfAccountsList = Array.isArray(body.data?.chartOfAccountsList) ? body.data.chartOfAccountsList : [];
  if (!costCenters.length && !chartOfAccountsList.length) return null;
  return { costCenters, chartOfAccountsList };
}

function applyDbLists(prev: ContractAuxiliaryOptions, lists: DbLists): ContractAuxiliaryOptions {
  return {
    ...prev,
    costCenters: lists.costCenters.map((i) => i.label),
    chartOfAccountsList: lists.chartOfAccountsList.map((i) => i.label),
  };
}

/**
 * Carrega formas de pagamento e demais opções do localStorage, e centros de custo /
 * planos de contas da API (banco). Se a API falhar, mantém as listas atuais (seed ou local).
 */
export function useContractAuxiliaryOptions() {
  const [aux, setAuxState] = useState<ContractAuxiliaryOptions>(() => loadContractAuxiliaryOptions());
  const [dbItems, setDbItems] = useState<DbLists>(EMPTY_DB);

  const persistLocal = useCallback((next: ContractAuxiliaryOptions) => {
    setAuxState(next);
    saveContractAuxiliaryOptions(next);
  }, []);

  const reload = useCallback(async () => {
    try {
      const res = await fetch('/api/erp/aux-lists');
      const lists = await parseAuxListsResponse(res);
      if (!lists) return;
      setDbItems(lists);
      setAuxState((prev) => {
        const next = applyDbLists(prev, lists);
        saveContractAuxiliaryOptions(next);
        return next;
      });
    } catch {
      // fallback: listas já carregadas do localStorage / seed
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const addDbItem = useCallback(async (kind: AuxListKind, label: string) => {
    const res = await fetch('/api/erp/aux-lists', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind, label }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error || 'Não foi possível cadastrar o item.');
    }
    await reload();
  }, [reload]);

  const updateDbItem = useCallback(async (id: string, label: string) => {
    const res = await fetch(`/api/erp/aux-lists/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error || 'Não foi possível atualizar o item.');
    }
    await reload();
  }, [reload]);

  const removeDbItem = useCallback(async (id: string) => {
    const res = await fetch(`/api/erp/aux-lists/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
      const err = new Error(body.error || 'Não foi possível excluir o item.') as Error & { code?: string };
      err.code = body.code;
      throw err;
    }
    await reload();
  }, [reload]);

  return { aux, persistLocal, dbItems, reload, addDbItem, updateDbItem, removeDbItem };
}
