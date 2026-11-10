'use client';
// Minha Conta / Configuracoes do CRM: caixas Outlook 365 do proprio usuario e assinatura.
// Conectar abre o login da Microsoft (consentimento do proprio usuario); os tokens ficam
// cifrados no servidor. Sem o app da Microsoft configurado, mostra so um aviso neutro.
import { useCallback, useEffect, useState } from 'react';
import { Loader2, Mail, PenLine, RefreshCw, Unplug } from 'lucide-react';
import {
  BTN_OUTLINE,
  BTN_PRIMARY,
  CARD,
  formatEmailDate,
  INPUT,
  LABEL,
  mailboxApi,
  TAG_GRAY,
  type MailboxStatusView,
} from './mailbox-client';

export default function MailboxConnectionsPanel({ compact = false }: { compact?: boolean }) {
  const [status, setStatus] = useState<MailboxStatusView | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [signature, setSignature] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const r = await mailboxApi<MailboxStatusView>('/status');
    if (r.ok && r.data) {
      setStatus(r.data);
      setSignature(r.data.signature || '');
    } else {
      setNotice(r.error);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const connect = async () => {
    setBusy('connect');
    setNotice(null);
    const r = await mailboxApi<{ authorizeUrl: string }>('/connect', { method: 'POST', body: {} });
    if (r.ok && r.data?.authorizeUrl) {
      window.location.href = r.data.authorizeUrl;
      return;
    }
    setNotice(r.error);
    setBusy(null);
  };

  const disconnect = async (id: string, address: string) => {
    if (!window.confirm(`Desconectar a caixa ${address}? Os e-mails já registrados continuam nas fichas.`)) return;
    setBusy(id);
    const r = await mailboxApi(`/accounts/${encodeURIComponent(id)}`, { method: 'DELETE' });
    setNotice(r.ok ? `Caixa ${address} desconectada.` : r.error);
    setBusy(null);
    void load();
  };

  const sync = async () => {
    setBusy('sync');
    const r = await mailboxApi<{ received: number; sent: number }>('/sync', { method: 'POST', body: {} });
    setNotice(r.ok && r.data ? `Sincronização concluída: ${r.data.received} recebido(s) e ${r.data.sent} enviado(s) registrados.` : r.error);
    setBusy(null);
    void load();
  };

  const saveSignature = async () => {
    setBusy('signature');
    const r = await mailboxApi<{ signature: string }>('/signature', { method: 'PUT', body: { signature } });
    setNotice(r.ok ? 'Assinatura salva.' : r.error);
    setBusy(null);
  };

  if (loading) {
    return (
      <div className={CARD}>
        <div className="flex items-center gap-2 text-xs font-semibold text-slate-500">
          <Loader2 className="w-4 h-4 animate-spin" /> Carregando caixas de e-mail...
        </div>
      </div>
    );
  }

  const enabled = Boolean(status?.enabled);
  const accounts = status?.accounts || [];

  return (
    <div className={compact ? 'space-y-3' : 'grid grid-cols-1 lg:grid-cols-2 gap-4'}>
      <div className={CARD}>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h4 className="text-sm font-semibold text-slate-900 flex items-center gap-1.5">
              <Mail className="w-4 h-4 text-accent" /> Caixas de e-mail conectadas
            </h4>
            <p className="text-[11px] font-semibold text-slate-500">
              Os e-mails enviados pelas fichas do CRM saem pelo seu endereço do Outlook 365 e as respostas entram na linha do tempo.
            </p>
          </div>
          {enabled && (
            <button type="button" onClick={connect} disabled={busy !== null} className={BTN_PRIMARY}>
              {busy === 'connect' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Mail className="w-3.5 h-3.5" />}
              Conectar caixa do Outlook
            </button>
          )}
        </div>

        {!enabled ? (
          <p className="text-xs font-semibold text-slate-600 bg-slate-50 border border-slate-200 rounded-lg p-3">
            {status?.message || 'A conexão de caixas de e-mail ainda não foi liberada pelo administrador.'}
          </p>
        ) : accounts.length === 0 ? (
          <p className="text-xs font-semibold text-slate-500">Nenhuma caixa conectada.</p>
        ) : (
          <ul className="divide-y divide-slate-100 border border-slate-200 rounded-lg">
            {accounts.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-slate-900 truncate">{a.mailboxAddress}</div>
                  <div className="text-[11px] font-semibold text-slate-500">
                    {a.displayName}
                    {a.lastSyncAt ? ` • Última sincronização: ${formatEmailDate(a.lastSyncAt)}` : ''}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={TAG_GRAY}>{a.status === 'ATIVADO' ? 'Ativado' : 'Reconectar'}</span>
                  <button type="button" onClick={() => disconnect(a.id, a.mailboxAddress)} disabled={busy !== null} className={BTN_OUTLINE}>
                    <Unplug className="w-3.5 h-3.5" /> Desconectar
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}

        {enabled && accounts.length > 0 && (
          <div className="flex justify-end">
            <button type="button" onClick={sync} disabled={busy !== null} className={BTN_OUTLINE}>
              <RefreshCw className={`w-3.5 h-3.5 ${busy === 'sync' ? 'animate-spin' : ''}`} /> Sincronizar agora
            </button>
          </div>
        )}
        {notice && <p className="text-[11px] font-semibold text-slate-600">{notice}</p>}
      </div>

      <div className={CARD}>
        <h4 className="text-sm font-semibold text-slate-900 flex items-center gap-1.5">
          <PenLine className="w-4 h-4 text-accent" /> Assinatura de e-mail
        </h4>
        <label className={LABEL} htmlFor="mailbox-signature">
          Incluída no fim de cada e-mail enviado pelo CRM
        </label>
        <textarea
          id="mailbox-signature"
          rows={6}
          maxLength={4000}
          value={signature}
          onChange={(e) => setSignature(e.target.value)}
          placeholder={'Nome Sobrenome\nCargo | Seta Telecom\n(11) 0000-0000'}
          className={INPUT}
        />
        <div className="flex justify-end">
          <button type="button" onClick={saveSignature} disabled={busy !== null} className={BTN_PRIMARY}>
            {busy === 'signature' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null} Salvar assinatura
          </button>
        </div>
      </div>
    </div>
  );
}
