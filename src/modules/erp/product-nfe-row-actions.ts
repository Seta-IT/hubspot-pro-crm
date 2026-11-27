// ============================================================================
// ERP > Fiscal > Notas de produtos — lógica pura da linha da lista (padrão GestãoClick):
//  - Situação (badge) derivada do estado SEFAZ: Aprovada, Corrigida, Cancelada, Rejeitada,
//    Denegada, Em processamento, Rascunho/Pendente;
//  - Quais ações do menu ⋮ ficam habilitadas para cada nota;
//  - Mensagens claras para as respostas das rotas /sefaz (cStat/xMotivo, 409 sem certificado,
//    422 emitente incompleto, 401/403 alçada fiscal + 2FA).
// Sem React: testável em node --test.
// ============================================================================
import type { ErpFiscalInvoice, ErpProductNfeSefazState } from '../../db/types';

export type ProductNfeSituacaoKey =
  | 'APROVADA'
  | 'CORRIGIDA'
  | 'CANCELADA'
  | 'REJEITADA'
  | 'DENEGADA'
  | 'EM_PROCESSAMENTO'
  | 'FALHA_ENVIO'
  | 'RASCUNHO'
  | 'EMITIDA'
  | 'ENTRADA';

export interface ProductNfeSituacao {
  key: ProductNfeSituacaoKey;
  label: string;
  tone: ProductNfeBadgeTone;
  /** Detalhe curto (cStat — xMotivo) para title/linha auxiliar. */
  detail?: string;
}

/**
 * Tom do badge (cores do print: verde, azul/ciano, vermelho...). As classes Tailwind ficam no
 * componente (src/app), que é o que o Tailwind varre; aqui só o tom.
 */
export type ProductNfeBadgeTone = 'green' | 'cyan' | 'red' | 'orange' | 'slateDark' | 'amber' | 'amberLight' | 'slate' | 'emeraldLight';

export function sefazStateOf(inv: ErpFiscalInvoice): ErpProductNfeSefazState | undefined {
  return inv.productNfe?.sefaz;
}

const cstatDetail = (s: ErpProductNfeSefazState | undefined) =>
  s && (s.cStat || s.xMotivo) ? `${s.cStat || '—'} — ${s.xMotivo || ''}`.trim() : undefined;

/** CC-e registradas (evento 110110 com retEvento 135/136). */
export function registeredCceCount(inv: ErpFiscalInvoice): number {
  return (sefazStateOf(inv)?.events || []).filter((e) => e.kind === 'CCE' && e.registered).length;
}

export function productNfeSituacao(inv: ErpFiscalInvoice): ProductNfeSituacao {
  const s = sefazStateOf(inv);
  if (s) {
    switch (s.status) {
      case 'CANCELADA':
        return { key: 'CANCELADA', label: 'Cancelada', tone: 'red', detail: cstatDetail(s) };
      case 'AUTORIZADA':
        return registeredCceCount(inv) > 0
          ? { key: 'CORRIGIDA', label: 'Corrigida', tone: 'cyan', detail: `${registeredCceCount(inv)} carta(s) de correção` }
          : { key: 'APROVADA', label: 'Aprovada', tone: 'green', detail: s.nProt ? `Protocolo ${s.nProt}` : cstatDetail(s) };
      case 'REJEITADA':
        return { key: 'REJEITADA', label: 'Rejeitada', tone: 'orange', detail: cstatDetail(s) };
      case 'DENEGADA':
        return { key: 'DENEGADA', label: 'Denegada', tone: 'slateDark', detail: cstatDetail(s) };
      case 'EM_PROCESSAMENTO':
        return { key: 'EM_PROCESSAMENTO', label: 'Em processamento', tone: 'amber', detail: s.nRec ? `Recibo ${s.nRec}` : cstatDetail(s) };
      case 'ERRO':
        return { key: 'FALHA_ENVIO', label: 'Pendente', tone: 'amberLight', detail: s.message || cstatDetail(s) };
    }
  }
  if (inv.status === 'CANCELADA') return { key: 'CANCELADA', label: 'Cancelada', tone: 'red' };
  if (inv.status === 'ENTRADA_REGISTRADA') return { key: 'ENTRADA', label: 'Entrada', tone: 'slate' };
  if (inv.status === 'RASCUNHO') return { key: 'RASCUNHO', label: 'Rascunho', tone: 'amberLight' };
  return { key: 'EMITIDA', label: 'Emitida', tone: 'emeraldLight' };
}

/** Nota já enviada à SEFAZ com resultado que impede excluir (autorizada, cancelada, denegada ou em processamento). */
export function isSefazTransmitted(inv: ErpFiscalInvoice): boolean {
  const st = sefazStateOf(inv)?.status;
  return st === 'AUTORIZADA' || st === 'CANCELADA' || st === 'DENEGADA' || st === 'EM_PROCESSAMENTO';
}

export function isSefazAuthorized(inv: ErpFiscalInvoice): boolean {
  return sefazStateOf(inv)?.status === 'AUTORIZADA';
}

export type ProductNfeRowActionId =
  | 'TRANSMITIR'
  | 'CONSULTAR'
  | 'IMPRIMIR_DANFE'
  | 'ENVIAR_EMAIL'
  | 'ENVIAR_WHATSAPP'
  | 'GERAR_FINANCEIRO'
  | 'BAIXAR_XML'
  | 'CARTA_CORRECAO'
  | 'DUPLICAR'
  | 'CANCELAR'
  | 'EXCLUIR';

export interface ProductNfeRowAction {
  id: ProductNfeRowActionId;
  label: string;
  /** Quando preenchido, a ação aparece desabilitada com este motivo. */
  disabledHint?: string;
  danger?: boolean;
}

export const SEFAZ_AUTHORIZED_ONLY_HINT = 'Só para NF-e autorizada na SEFAZ';
export const NOT_YET_AVAILABLE_HINT = 'Em breve';

/**
 * Itens do menu ⋮ da linha (ordem do GestãoClick, com "Assinar / Transmitir" no topo).
 * "Assinar / Transmitir" só aparece para nota de produtos ainda não autorizada (rascunho, rejeitada
 * ou com falha de envio); "Consultar na SEFAZ" só para lote em processamento ou falha com chave.
 */
export function productNfeRowActions(inv: ErpFiscalInvoice): ProductNfeRowAction[] {
  const pn = inv.productNfe;
  const s = pn?.sefaz;
  const st = s?.status;
  const out: ProductNfeRowAction[] = [];
  const canTransmitState = Boolean(pn) && inv.status === 'RASCUNHO' && (!st || st === 'REJEITADA' || st === 'ERRO');
  if (canTransmitState) {
    out.push({
      id: 'TRANSMITIR',
      label: 'Assinar / Transmitir',
      disabledHint: pn!.environment !== 'HOMOLOGACAO' ? 'Nota em PRODUÇÃO: transmissão bloqueada (somente homologação)' : undefined,
    });
  }
  if (s?.accessKey && (st === 'EM_PROCESSAMENTO' || st === 'ERRO')) {
    out.push({ id: 'CONSULTAR', label: 'Consultar na SEFAZ' });
  }
  const authorized = st === 'AUTORIZADA';
  const hasDraftXml = Boolean(pn?.xmlContent || inv.importMetadata?.sefazXmlContent);
  const transmitted = isSefazTransmitted(inv);
  out.push(
    { id: 'IMPRIMIR_DANFE', label: 'Imprimir DANFE' },
    { id: 'ENVIAR_EMAIL', label: 'Enviar por e-mail', disabledHint: NOT_YET_AVAILABLE_HINT },
    { id: 'ENVIAR_WHATSAPP', label: 'Enviar por WhatsApp', disabledHint: NOT_YET_AVAILABLE_HINT },
    { id: 'GERAR_FINANCEIRO', label: 'Gerar financeiro', disabledHint: NOT_YET_AVAILABLE_HINT },
    {
      id: 'BAIXAR_XML',
      label: 'Baixar XML',
      disabledHint: authorized || s?.signedXml || s?.nfeProcXml || hasDraftXml ? undefined : 'Nota sem XML',
    },
    { id: 'CARTA_CORRECAO', label: 'Carta de correção', disabledHint: authorized ? undefined : SEFAZ_AUTHORIZED_ONLY_HINT },
    { id: 'DUPLICAR', label: 'Duplicar NF-e', disabledHint: NOT_YET_AVAILABLE_HINT },
    { id: 'CANCELAR', label: 'Cancelar NF-e', danger: true, disabledHint: authorized ? undefined : SEFAZ_AUTHORIZED_ONLY_HINT },
    {
      id: 'EXCLUIR',
      label: 'Excluir',
      danger: true,
      disabledHint: transmitted
        ? 'NF-e transmitida à SEFAZ não pode ser excluída'
        : inv.status !== 'RASCUNHO' || !pn
          ? 'Só é possível excluir NF-e em rascunho'
          : undefined,
    }
  );
  return out;
}

/** "Baixar XML": autorizada/transmitida usa a rota SEFAZ (nfeProc); demais mantêm o XML de rascunho local. */
export function xmlDownloadSource(inv: ErpFiscalInvoice): 'SEFAZ' | 'RASCUNHO' | null {
  const s = sefazStateOf(inv);
  if (s && (s.nfeProcXml || s.signedXml)) return 'SEFAZ';
  if (inv.productNfe?.xmlContent || inv.importMetadata?.sefazXmlContent) return 'RASCUNHO';
  return null;
}

export const TRANSMIT_CONFIRMATION_TEXT = (label: string) =>
  `Assinar e transmitir a ${label} para a SEFAZ-SP em HOMOLOGAÇÃO (tpAmb=2, sem valor fiscal)?\n\n` +
  'A nota será assinada com o certificado A1 e enviada ao ambiente de testes da SEFAZ. Produção continua bloqueada.';

export interface SefazRouteData {
  environment?: string;
  status?: string;
  cStat?: string;
  xMotivo?: string;
  message?: string;
  accessKey?: string;
  nProt?: string;
  nRec?: string;
  event?: { cStat?: string; xMotivo?: string; registered?: boolean };
}

export type SefazFeedbackTone = 'success' | 'warning' | 'error';
export interface SefazFeedback {
  tone: SefazFeedbackTone;
  message: string;
  /** Erro de certificado: a tela oferece abrir Configurações > Certificado digital. */
  openCertificate?: boolean;
}

/** Mensagem da resposta 200 das rotas /sefaz. */
export function describeSefazSuccess(action: 'transmitir' | 'consultar' | 'cancelar' | 'carta-correcao', d: SefazRouteData): SefazFeedback {
  const code = d.cStat ? `cStat ${d.cStat} — ${d.xMotivo || ''}`.trim() : d.message || '';
  if (action === 'cancelar' || action === 'carta-correcao') {
    const ev = d.event;
    const what = action === 'cancelar' ? 'Cancelamento' : 'Carta de correção';
    if (ev?.registered) return { tone: 'success', message: `${what} registrado(a) na SEFAZ (homologação): ${ev.cStat} — ${ev.xMotivo}.` };
    return { tone: 'error', message: `${what} rejeitado(a) pela SEFAZ: ${ev?.cStat || '—'} — ${ev?.xMotivo || d.message || ''}`.trim() };
  }
  switch (d.status) {
    case 'AUTORIZADA':
      return { tone: 'success', message: `NF-e autorizada em HOMOLOGAÇÃO (${code})${d.nProt ? ` — protocolo ${d.nProt}` : ''}.` };
    case 'CANCELADA':
      return { tone: 'warning', message: `NF-e consta como CANCELADA na SEFAZ (${code}).` };
    case 'REJEITADA':
      return { tone: 'error', message: `NF-e rejeitada pela SEFAZ: ${code}. Corrija a nota e transmita de novo.` };
    case 'DENEGADA':
      return { tone: 'error', message: `Uso denegado pela SEFAZ: ${code}.` };
    case 'EM_PROCESSAMENTO':
      return { tone: 'warning', message: `Lote em processamento na SEFAZ${d.nRec ? ` (recibo ${d.nRec})` : ''}. Use "Consultar na SEFAZ" em instantes.` };
    default:
      return { tone: 'error', message: d.message || code || 'Resposta da SEFAZ sem protocolo para esta NF-e.' };
  }
}

/** Mensagem dos erros (não-2xx) das rotas /sefaz, no padrão das outras ações fiscais. */
export function describeSefazError(httpStatus: number, body: { error?: string; code?: string; details?: string[] } | null): SefazFeedback {
  const code = body?.code || '';
  const err = body?.error || '';
  if (httpStatus === 401) return { tone: 'error', message: 'Sessão expirada ou sem 2FA: entre de novo para usar as ações fiscais.' };
  if (httpStatus === 403 && code === 'SEFAZ_PRODUCTION_BLOCKED') return { tone: 'error', message: err || 'Transmissão em PRODUÇÃO bloqueada: somente homologação.' };
  if (httpStatus === 403) {
    return { tone: 'error', message: 'Sem permissão: transmitir NF-e exige a alçada fiscal (emitir documentos fiscais) e sessão com 2FA.' };
  }
  if (httpStatus === 409 && /^CERT_/.test(code)) {
    return {
      tone: 'error',
      openCertificate: true,
      message: `${err || 'Certificado digital A1 não configurado.'} Envie o certificado em Configurações > Certificado digital.`,
    };
  }
  if (httpStatus === 503 && code === 'CERT_ENC_KEY_MISSING') {
    return { tone: 'error', message: 'Chave de cifragem do certificado (STI_HUB_CERT_ENC_KEY) não configurada no servidor.' };
  }
  if (httpStatus === 422 && code === 'NFE_EMITTER_DATA_INCOMPLETE') {
    const det = body?.details?.length ? body.details.join('; ') : err;
    return { tone: 'error', message: `Dados do emitente incompletos (Configurações > Empresa / Fiscal): ${det}.` };
  }
  if (httpStatus === 504) return { tone: 'error', message: 'A SEFAZ não respondeu a tempo. Use "Consultar na SEFAZ" antes de reenviar.' };
  return { tone: 'error', message: err || `Falha na operação SEFAZ (${httpStatus}).` };
}
