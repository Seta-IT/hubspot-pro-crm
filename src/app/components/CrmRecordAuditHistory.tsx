'use client';

import React, { useCallback, useEffect, useState } from 'react';
import type { CrmRecordAuditEntry } from '../../db/types';

const ACTION_LABEL: Record<string, string> = {
  CREATE: 'Criou',
  UPDATE: 'Editou',
  DELETE: 'Excluiu',
  MERGE: 'Mesclou',
  REASSIGN_OWNER: 'Reatribuiu o dono',
  CLEANUP: 'Higienizou',
};

const fmtValue = (v: unknown): string => {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'object') {
    const s = JSON.stringify(v);
    return s.length > 80 ? `${s.slice(0, 77)}...` : s;
  }
  const s = String(v);
  return s.length > 80 ? `${s.slice(0, 77)}...` : s;
};

/** Histórico de auditoria (quem fez, quando e o quê) de um contato ou empresa. */
export default function CrmRecordAuditHistory({
  entityType,
  entityId,
  refreshKey,
}: {
  entityType: 'CONTACT' | 'COMPANY';
  entityId: string;
  refreshKey?: unknown;
}) {
  const [entries, setEntries] = useState<CrmRecordAuditEntry[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ entityType, entityId, limit: '50' });
      const res = await fetch(`/api/data-health/audit?${qs.toString()}`, { cache: 'no-store' });
      if (res.ok) {
        const j = await res.json();
        setEntries(Array.isArray(j.data) ? j.data : []);
      }
    } catch {
      // histórico é best-effort
    } finally {
      setLoading(false);
    }
  }, [entityType, entityId]);

  useEffect(() => {
    if (open) load();
  }, [open, load, refreshKey]);

  return (
    <div className="rounded-xl border border-slate-200 bg-white" data-testid="crm-record-audit-history">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full px-4 py-2.5 flex items-center justify-between text-xs font-semibold uppercase text-slate-700 cursor-pointer"
      >
        <span>Histórico de alterações (auditoria)</span>
        <span className="text-slate-500">{open ? 'Ocultar' : 'Ver'}</span>
      </button>
      {open && (
        <div className="px-4 pb-3 space-y-2 text-xs">
          {loading && <p className="text-slate-500">Carregando...</p>}
          {!loading && entries.length === 0 && <p className="text-slate-500">Nenhuma ação registrada.</p>}
          {entries.map((e) => (
            <div key={e.id} className="border-t border-slate-100 pt-2">
              <div className="text-slate-800">
                <strong>{e.actorName}</strong>
                {e.actorEmail ? ` (${e.actorEmail})` : ''} {ACTION_LABEL[e.action] || e.action}
                {e.source && e.source !== 'API' ? ` · ${e.source === 'AUTO_CLEAN' ? 'Auto-Clean' : 'script'}` : ''}
              </div>
              <div className="text-slate-500">{new Date(e.timestamp).toLocaleString('pt-BR')}</div>
              {e.details && <div className="text-slate-600">{e.details}</div>}
              {e.action === 'MERGE' && e.metadata && (
                <div className="text-slate-600">
                  {String(e.metadata.duplicateId)} (CNPJ {fmtValue(e.metadata.duplicateCnpj)}) →{' '}
                  {String(e.metadata.primaryId)} (CNPJ {fmtValue(e.metadata.primaryCnpj)})
                  {e.metadata.confirmMissingCnpj ? ' · confirmado sem CNPJ' : ''}
                </div>
              )}
              {e.action !== 'CREATE' && e.action !== 'DELETE' && (e.changes || []).length > 0 && (
                <ul className="mt-1 space-y-0.5">
                  {(e.changes || []).slice(0, 12).map((c) => (
                    <li key={c.field} className="text-slate-600">
                      <span className="font-semibold">{c.field}</span>: {fmtValue(c.before)} → {fmtValue(c.after)}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
