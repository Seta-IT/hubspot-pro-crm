'use client';

import React, { useEffect, useState } from 'react';
import type { SequenceEnrollment, SequenceStepDelivery } from '../../db/types';
import { formatDateTimeBR } from './ui-helpers';

// ============================================================================
// Fase 2 (19/11/2026) — Envio real das cadencias pela caixa Outlook do dono.
// Mostra o modo (real ou simulacao), aviso de caixa nao conectada e o status real de cada passo
// (enviado, agendado, pendente, erro, bloqueado) com o motivo. Sem emojis.
// ============================================================================

export interface SequenceLiveStatus {
  enabled: boolean;
  testAllowlistActive: boolean;
  mailboxFeatureEnabled: boolean;
  ownerMailboxes: Record<string, { connected: boolean; status: 'CONECTADA' | 'RECONECTAR' | 'NAO_CONECTADA' | 'RECURSO_DESLIGADO'; mailboxAddress: string | null }>;
}

export const DELIVERY_STATUS_LABELS: Record<SequenceStepDelivery['status'], { label: string; tone: string }> = {
  SCHEDULED: { label: 'Agendado', tone: 'bg-slate-100 text-slate-700 border-slate-200' },
  SENDING: { label: 'Enviando', tone: 'bg-sky-50 text-sky-800 border-sky-200' },
  SENT: { label: 'Enviado', tone: 'bg-emerald-50 text-emerald-800 border-emerald-200' },
  PENDING: { label: 'Pendente', tone: 'bg-amber-50 text-amber-800 border-amber-200' },
  ERROR: { label: 'Erro', tone: 'bg-rose-50 text-rose-800 border-rose-200' },
  BLOCKED: { label: 'Bloqueado', tone: 'bg-rose-50 text-rose-800 border-rose-200' },
  SIMULATED: { label: 'Simulado', tone: 'bg-slate-100 text-slate-600 border-slate-200' },
};

export function deliveryStatusLabel(d: Pick<SequenceStepDelivery, 'status'>): string {
  return DELIVERY_STATUS_LABELS[d.status]?.label || d.status;
}

export const OWNER_MAILBOX_WARNING: Record<string, string> = {
  NAO_CONECTADA: 'Caixa Outlook não conectada. Os passos de e-mail ficam pendentes e uma tarefa é criada para o vendedor.',
  RECONECTAR: 'A conexão da caixa Outlook expirou. Reconecte em Caixas de e-mail conectadas para retomar os envios.',
  RECURSO_DESLIGADO: 'Integração com o Outlook desligada no STI-hub. Nenhum passo sai de verdade.',
};

type EnrollmentRow = SequenceEnrollment & { contact?: { firstName: string; lastName: string; email: string } | null };

export default function SequenceLiveSendPanel({ sequenceId, enrollments }: { sequenceId: string; enrollments: EnrollmentRow[] }) {
  const [status, setStatus] = useState<SequenceLiveStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/sequences/live-status?sequenceId=${encodeURIComponent(sequenceId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!cancelled) setStatus((j && j.data) || null);
      })
      .catch(() => {
        if (!cancelled) setStatus(null);
      });
    return () => {
      cancelled = true;
    };
  }, [sequenceId, enrollments.length]);

  const withDeliveries = enrollments.filter((e) => (e.stepDeliveries || []).length > 0);
  const owners = status ? Object.entries(status.ownerMailboxes || {}).filter(([, v]) => !v.connected) : [];

  return (
    <div className="px-6 py-3 space-y-2 border-t border-slate-100" data-testid="cadence-live-send">
      <div className="flex flex-wrap items-center gap-2 text-[11px]">
        <span className="font-semibold uppercase tracking-wider text-slate-500">Envio pelo Outlook</span>
        {status ? (
          <span
            className={`px-2 py-0.5 rounded border font-semibold ${
              status.enabled ? 'bg-emerald-50 text-emerald-800 border-emerald-200' : 'bg-slate-100 text-slate-600 border-slate-200'
            }`}
          >
            {status.enabled ? 'Envio real ligado' : 'Modo simulação (nenhum e-mail sai)'}
          </span>
        ) : (
          <span className="text-slate-400">Carregando situação do envio...</span>
        )}
        {status?.enabled && status.testAllowlistActive && (
          <span className="px-2 py-0.5 rounded border bg-amber-50 text-amber-800 border-amber-200 font-semibold">
            Homologação: só destinatários de teste
          </span>
        )}
      </div>

      {status?.enabled && owners.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-[11px] text-amber-900 space-y-1" data-testid="cadence-owner-mailbox-warning">
          {owners.map(([owner, v]) => (
            <p key={owner}>
              <span className="font-semibold">{owner}:</span> {OWNER_MAILBOX_WARNING[v.status] || OWNER_MAILBOX_WARNING.NAO_CONECTADA}
            </p>
          ))}
        </div>
      )}

      {withDeliveries.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="text-left text-slate-500">
                <th className="py-1 pr-2 font-semibold">Contato</th>
                <th className="py-1 pr-2 font-semibold">Passo</th>
                <th className="py-1 pr-2 font-semibold">Status</th>
                <th className="py-1 pr-2 font-semibold">Motivo</th>
                <th className="py-1 pr-2 font-semibold">Atualizado</th>
              </tr>
            </thead>
            <tbody>
              {withDeliveries.slice(0, 50).flatMap((e) =>
                (e.stepDeliveries || []).map((d) => {
                  const tone = DELIVERY_STATUS_LABELS[d.status]?.tone || '';
                  const who = e.contact ? `${e.contact.firstName} ${e.contact.lastName}`.trim() || e.contact.email : e.contactId;
                  return (
                    <tr key={`${e.id}-${d.stepOrder}`} className="border-t border-slate-100" data-testid="cadence-step-delivery">
                      <td className="py-1 pr-2 text-slate-700">{who}</td>
                      <td className="py-1 pr-2 text-slate-700">{d.stepOrder}</td>
                      <td className="py-1 pr-2">
                        <span className={`px-1.5 py-0.5 rounded border font-semibold ${tone}`}>{deliveryStatusLabel(d)}</span>
                      </td>
                      <td className="py-1 pr-2 text-slate-600">
                        {d.status === 'SENT' ? `Enviado por ${d.mailboxAddress || 'Outlook'}` : d.reason || '-'}
                      </td>
                      <td className="py-1 pr-2 text-slate-500">{formatDateTimeBR(d.sentAt || d.updatedAt)}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
