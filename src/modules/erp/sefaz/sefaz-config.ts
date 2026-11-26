// ============================================================================
// SEFAZ-SP — NF-e modelo 55: endpoints, trava de ambiente e tabela de cStat.
// ----------------------------------------------------------------------------
//  - SOMENTE HOMOLOGAÇÃO (tpAmb=2). A transmissão em PRODUÇÃO está desligada NO CÓDIGO
//    (SEFAZ_PRODUCTION_TRANSMISSION_ENABLED = false, sem variável de ambiente que a ligue e sem
//    endpoint de produção cadastrado): qualquer tentativa com tpAmb=1 / PRODUCAO lança
//    SefazProductionBlockedError. Ligar produção exige mudança de código revisada (a série de
//    produção ainda é emitida pelo GestaoClick).
//  - Endpoints de homologação da SEFAZ-SP (webservices 4.00).
//  - Inutilização: descontinuada em SP desde 11/11/2026 => função desabilitada com mensagem.
//  - Autorização SÍNCRONA (indSinc=1): o modo assíncrono deixa de ser aceito em 05/04/2027.
// Referência: nfephp-org/sped-nfe (MIT) storage/wsnfe_4.00_mod55.xml e src/Tools.php.
// ============================================================================

export const SEFAZ_PRODUCTION_TRANSMISSION_ENABLED = false as const;

export const NFE_PORTAL_NS = 'http://www.portalfiscal.inf.br/nfe';
export const NFE_VERSION = '4.00';
export const EVENT_VERSION = '1.00';
export const CUF_SP = '35';
export const VER_PROC = 'STI-HUB-ERP-1.0';

export type SefazServiceName =
  | 'NFeStatusServico4'
  | 'NFeAutorizacao4'
  | 'NFeRetAutorizacao4'
  | 'NFeConsultaProtocolo4'
  | 'NFeRecepcaoEvento4';

export interface SefazServiceDef {
  operation: SefazServiceName;
  method: string;
  url: string;
}

/** Webservices SEFAZ-SP — HOMOLOGAÇÃO. Os de produção NÃO existem neste código, de propósito. */
export const SEFAZ_SP_HOMOLOGACAO: Readonly<Record<SefazServiceName, SefazServiceDef>> = Object.freeze({
  NFeStatusServico4: {
    operation: 'NFeStatusServico4',
    method: 'nfeStatusServicoNF',
    url: 'https://homologacao.nfe.fazenda.sp.gov.br/ws/nfestatusservico4.asmx',
  },
  NFeAutorizacao4: {
    operation: 'NFeAutorizacao4',
    method: 'nfeAutorizacaoLote',
    url: 'https://homologacao.nfe.fazenda.sp.gov.br/ws/nfeautorizacao4.asmx',
  },
  NFeRetAutorizacao4: {
    operation: 'NFeRetAutorizacao4',
    method: 'nfeRetAutorizacaoLote',
    url: 'https://homologacao.nfe.fazenda.sp.gov.br/ws/nferetautorizacao4.asmx',
  },
  NFeConsultaProtocolo4: {
    operation: 'NFeConsultaProtocolo4',
    method: 'nfeConsultaNF',
    url: 'https://homologacao.nfe.fazenda.sp.gov.br/ws/nfeconsultaprotocolo4.asmx',
  },
  NFeRecepcaoEvento4: {
    operation: 'NFeRecepcaoEvento4',
    method: 'nfeRecepcaoEvento',
    url: 'https://homologacao.nfe.fazenda.sp.gov.br/ws/nferecepcaoevento4.asmx',
  },
});

export class SefazProductionBlockedError extends Error {
  readonly code = 'SEFAZ_PRODUCTION_BLOCKED';
  constructor(detail = '') {
    super(
      `Transmissão à SEFAZ em PRODUÇÃO (tpAmb=1) está BLOQUEADA no STI-hub: somente homologação (tpAmb=2) é permitida enquanto o GestaoClick emite na série de produção.${
        detail ? ` ${detail}` : ''
      }`
    );
  }
}

/**
 * Trava de ambiente. Aceita só 'HOMOLOGACAO' / '2' / 2; qualquer outra coisa (PRODUCAO, '1', 1,
 * vazio, lixo) é bloqueada com SefazProductionBlockedError. Devolve sempre '2'.
 */
export function assertHomologacao(env: unknown, context = ''): '2' {
  const v = String(env ?? '').trim().toUpperCase();
  if (v === 'HOMOLOGACAO' || v === '2') return '2';
  if (v === 'PRODUCAO' || v === '1') throw new SefazProductionBlockedError(context);
  throw new SefazProductionBlockedError(`Ambiente inválido: "${String(env ?? '').slice(0, 30)}". ${context}`.trim());
}

/** Confere TODOS os tpAmb que estão DENTRO do XML (defesa em profundidade antes de qualquer envio). */
export function assertXmlIsHomologacao(xml: string, context = ''): void {
  const all = Array.from(xml.matchAll(/<tpAmb>\s*([^<]*?)\s*<\/tpAmb>/g)).map((m) => m[1]);
  if (all.length === 0) throw new SefazProductionBlockedError(`XML sem tpAmb. ${context}`.trim());
  const bad = all.find((v) => v !== '2');
  if (bad !== undefined) throw new SefazProductionBlockedError(`XML com tpAmb=${bad.slice(0, 5)}. ${context}`.trim());
}

export function sefazEndpoint(service: SefazServiceName, env: unknown): SefazServiceDef {
  assertHomologacao(env, `Serviço ${service}.`);
  return SEFAZ_SP_HOMOLOGACAO[service];
}

export const SEFAZ_INUTILIZACAO_DISABLED_MESSAGE =
  'A inutilização de numeração da NF-e foi descontinuada pela SEFAZ-SP em 11/11/2026: o STI-hub não chama o NFeInutilizacao4. Números não usados ficam registrados apenas no ERP.';

export class SefazServiceDisabledError extends Error {
  readonly code = 'SEFAZ_SERVICE_DISABLED';
}

/** Inutilização: desabilitada (SP descontinuou em 11/11/2026). Sempre lança. */
export function inutilizarNumeracao(): never {
  throw new SefazServiceDisabledError(SEFAZ_INUTILIZACAO_DISABLED_MESSAGE);
}

// ----------------------------------------------------------------------------
// cStat — classificação e dicas (o xMotivo da SEFAZ é sempre exibido)
// ----------------------------------------------------------------------------
export type SefazOutcome =
  | 'AUTORIZADA'
  | 'DENEGADA'
  | 'REJEITADA'
  | 'EM_PROCESSAMENTO'
  | 'LOTE_RECEBIDO'
  | 'LOTE_PROCESSADO'
  | 'SERVICO_OK'
  | 'SERVICO_INDISPONIVEL'
  | 'EVENTO_REGISTRADO'
  | 'ERRO';

const OUTCOMES: Record<string, SefazOutcome> = {
  '100': 'AUTORIZADA',
  '150': 'AUTORIZADA',
  '110': 'DENEGADA',
  '301': 'DENEGADA',
  '302': 'DENEGADA',
  '303': 'DENEGADA',
  '103': 'LOTE_RECEBIDO',
  '104': 'LOTE_PROCESSADO',
  '105': 'EM_PROCESSAMENTO',
  '107': 'SERVICO_OK',
  '108': 'SERVICO_INDISPONIVEL',
  '109': 'SERVICO_INDISPONIVEL',
  '135': 'EVENTO_REGISTRADO',
  '136': 'EVENTO_REGISTRADO',
  '155': 'EVENTO_REGISTRADO',
};

export function classifyCStat(cStat: string | undefined | null): SefazOutcome {
  const c = String(cStat ?? '').trim();
  if (!/^\d{3}$/.test(c)) return 'ERRO';
  return OUTCOMES[c] || 'REJEITADA';
}

export const CSTAT_HINTS: Readonly<Record<string, string>> = Object.freeze({
  '103': 'Lote recebido no modo assíncrono: consultar o recibo.',
  '104': 'Lote processado: ver o protocolo da nota.',
  '105': 'Lote em processamento: consultar novamente em alguns segundos.',
  '108': 'Serviço paralisado momentaneamente: tentar mais tarde.',
  '109': 'Serviço paralisado sem previsão.',
  '204': 'Duplicidade de NF-e: consultar o protocolo pela chave.',
  '213': 'O CNPJ do emitente difere do CNPJ do certificado digital.',
  '215': 'Falha no schema XML.',
  '225': 'Falha no schema XML da NF-e.',
  '228': 'Data de emissão muito atrasada.',
  '280': 'Certificado transmissor inválido.',
  '297': 'Assinatura difere do calculado.',
  '298': 'Assinatura difere do padrão do sistema.',
  '452': 'Resposta síncrona solicitada para lote com mais de uma NF-e.',
  '539': 'Duplicidade de NF-e com diferença na chave de acesso: consultar o protocolo.',
  '656': 'Consumo indevido: aguardar antes de reenviar.',
  '972': 'Obrigatório informar o responsável técnico (infRespTec).',
});

export function describeCStat(cStat: string, xMotivo: string): string {
  const hint = CSTAT_HINTS[cStat];
  return `${cStat} — ${xMotivo || 'sem motivo informado'}${hint ? ` (${hint})` : ''}`;
}
