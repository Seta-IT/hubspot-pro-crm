// STI-hub — Sequência automática de follow-up por e-mail após "Proposta Enviada".
// Toda a agenda, as etapas-gatilho, a janela comercial e os modelos padrão ficam neste arquivo.

/** Flag desligada por padrão: nada é inscrito nem enviado até o Marcéllo ligar. */
export const FOLLOWUP_SEQUENCE_FLAG = 'FOLLOWUP_SEQUENCE_ENABLED';

export function isProposalFollowupEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = String(env[FOLLOWUP_SEQUENCE_FLAG] || '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'on' || v === 'yes';
}

export const FOLLOWUP_TIMEZONE = 'America/Sao_Paulo';
export const FOLLOWUP_BUSINESS_START = '08:30';
export const FOLLOWUP_BUSINESS_END = '18:00';
/** Máximo de envios por execução do cron (idempotente: nunca 2 da mesma etapa). */
/** Teto por execução diária (cron 09:00 Brasília, seg–sex). Um envio por inscrição/dia; 50 cobre o lote de segunda e atrasos. */
export const FOLLOWUP_MAX_SENDS_PER_RUN = 50;

/**
 * Dias após a entrada na etapa-gatilho. 9 e-mails em 7 semanas, com o intervalo
 * aumentando (semana 1: D2 e D5; depois 3, 5, 7, 8 e 9 dias).
 */
export const FOLLOWUP_SCHEDULE_OFFSET_DAYS: readonly number[] = [2, 5, 9, 12, 17, 24, 32, 40, 49];

export const FOLLOWUP_TEMPLATE_IDS: readonly string[] = FOLLOWUP_SCHEDULE_OFFSET_DAYS.map(
  (d) => `tpl-proposta-followup-d${String(d).padStart(2, '0')}`
);

/** Feriados nacionais (e SP) usados para pular o envio. */
export const FOLLOWUP_HOLIDAYS: readonly string[] = [
  '2026-01-01', '2026-02-16', '2026-02-17', '2026-04-03', '2026-04-21', '2026-05-01',
  '2026-06-04', '2026-09-07', '2026-10-12', '2026-11-02', '2026-11-15', '2026-11-20', '2026-12-25',
  '2027-01-01', '2027-02-08', '2027-02-09', '2027-03-26', '2027-04-21', '2027-05-01',
  '2027-06-17', '2027-09-07', '2027-10-12', '2027-11-02', '2027-11-15', '2027-11-20', '2027-12-25',
];

export interface FollowupTriggerStage {
  pipelineId: string;
  pipelineName: string;
  stageId: string;
  stageName: string;
  /** 'exact' = o nome pede "Proposta Enviada"; 'equivalent' = etapa equivalente do funil. */
  match: 'exact' | 'equivalent';
}

/**
 * Pipeline 2 tem "Proposta Enviada" (id stage-proposal).
 * Pipelines 1 e 3 não têm esse nome: usamos a etapa equivalente de proposta.
 * Pipeline 4 (Cotações & Compras / fornecedores) não tem etapa de proposta ao cliente — fora da sequência.
 * FUP e Final FuP não inscrevem: só mantêm a sequência já iniciada em Proposta Enviada.
 */
export const FOLLOWUP_TRIGGER_STAGES: readonly FollowupTriggerStage[] = [
  {
    pipelineId: 'pipe-enterprise-b2b',
    pipelineName: 'Pipeline 2: Venda de Equipamentos',
    stageId: 'stage-proposal',
    stageName: 'Proposta Enviada',
    match: 'exact',
  },
  {
    pipelineId: 'pipeline-locacao-equipamentos',
    pipelineName: 'Pipeline 1: Locação & Serviços',
    stageId: 'stage-loc-simulacao',
    stageName: '2. Proposta & Simulação MRR (ERP)',
    match: 'equivalent',
  },
  {
    pipelineId: 'pipeline-expansao-renovacao',
    pipelineName: 'Pipeline 3: Expansão, Aditivos & Renovação',
    stageId: 'stage-exp-proposta',
    stageName: '2. Proposta de Aditivo / Upgrade',
    match: 'equivalent',
  },
];

export interface FollowupTemplateDraft {
  id: string;
  name: string;
  subject: string;
  body: string;
}

export const FOLLOWUP_DEFAULT_TEMPLATES: readonly FollowupTemplateDraft[] = [
  {
    id: 'tpl-proposta-followup-d02',
    name: 'Follow-up proposta — D2 (1ª semana)',
    subject: 'Proposta comercial — {empresa}',
    body: `Olá, {contato}. Tudo bem?

Enviei há pouco a proposta comercial da Seta Telecom referente a {negocio}. Queremos só confirmar se chegou bem e se podemos ajudar em alguma dúvida.

A proposta está neste link: {link_proposta}

Fico à disposição.

Abraço,
{vendedor}`,
  },
  {
    id: 'tpl-proposta-followup-d05',
    name: 'Follow-up proposta — D5 (1ª semana)',
    subject: 'Re: Proposta comercial — {empresa}',
    body: `Olá, {contato}.

Passando para saber se você ou o time já tiveram a chance de olhar a proposta de {negocio}.

Se quiser, posso esclarecer algum ponto ou ajustar o escopo. Link: {link_proposta}

Abraço,
{vendedor}`,
  },
  {
    id: 'tpl-proposta-followup-d09',
    name: 'Follow-up proposta — D9 (2ª semana)',
    subject: 'Posso ajudar com a proposta da {empresa}?',
    body: `Olá, {contato}.

Imaginei que a rotina esteja corrida, então deixo de novo o link da proposta de {negocio}: {link_proposta}

Se preferir, marcamos 15 minutos para revisar juntos.

Abraço,
{vendedor}`,
  },
  {
    id: 'tpl-proposta-followup-d12',
    name: 'Follow-up proposta — D12 (2ª semana)',
    subject: 'Re: Proposta Seta Telecom — {empresa}',
    body: `Olá, {contato}.

Só confirmando se a proposta de {negocio} segue em avaliação. Há algum ponto técnico ou comercial em que eu possa ajudar?

Link: {link_proposta}

Abraço,
{vendedor}`,
  },
  {
    id: 'tpl-proposta-followup-d17',
    name: 'Follow-up proposta — D17 (3ª semana)',
    subject: 'Atualização da proposta — {empresa}',
    body: `Olá, {contato}.

A proposta de {negocio} continua válida. Se o contexto mudou, podemos revisar valores, prazo ou escopo sem compromisso.

Link: {link_proposta}

Abraço,
{vendedor}`,
  },
  {
    id: 'tpl-proposta-followup-d24',
    name: 'Follow-up proposta — D24 (4ª semana)',
    subject: 'Ainda faz sentido seguirmos com {negocio}?',
    body: `Olá, {contato}.

Queria saber se {negocio} ainda está no radar da {empresa}. Se sim, sigo à disposição para os próximos passos. Se não for o momento, também agradeço o retorno.

Link: {link_proposta}

Abraço,
{vendedor}`,
  },
  {
    id: 'tpl-proposta-followup-d32',
    name: 'Follow-up proposta — D32 (5ª semana)',
    subject: 'Proposta Seta Telecom — {empresa}',
    body: `Olá, {contato}.

Deixo este recado curto: a proposta de {negocio} segue disponível em {link_proposta}. Quando fizer sentido retomar, é só responder este e-mail.

Abraço,
{vendedor}`,
  },
  {
    id: 'tpl-proposta-followup-d40',
    name: 'Follow-up proposta — D40 (6ª semana)',
    subject: 'Re: {negocio}',
    body: `Olá, {contato}.

Passando só para não deixar a conversa sem um fechamento. Se a {empresa} quiser retomar {negocio}, estou à disposição.

Link: {link_proposta}

Abraço,
{vendedor}`,
  },
  {
    id: 'tpl-proposta-followup-d49',
    name: 'Follow-up proposta — D49 (encerramento)',
    subject: 'Último contato sobre a proposta — {empresa}',
    body: `Olá, {contato}.

Este é o último e-mail automático sobre a proposta de {negocio}. Não quero insistir: se o tema voltar à pauta, pode me escrever quando quiser.

Link: {link_proposta}

Obrigado pelo tempo e um abraço,
{vendedor}`,
  },
];

export type FollowupStopReason =
  | 'EMAIL_REPLY'
  | 'EMAIL_CLICK'
  | 'PROPOSAL_VIEW'
  | 'PROPOSAL_ACCEPT'
  | 'STAGE_CHANGED'
  | 'DEAL_WON'
  | 'DEAL_LOST'
  | 'MANUAL_PAUSE'
  | 'UNSUBSCRIBED'
  | 'NO_VALID_EMAIL'
  | 'OWNER_MAILBOX_UNAVAILABLE'
  | 'COMPLETED';

export const FOLLOWUP_STOP_LABEL: Record<FollowupStopReason, string> = {
  EMAIL_REPLY: 'O cliente respondeu ao e-mail',
  EMAIL_CLICK: 'O cliente clicou em um link do e-mail',
  PROPOSAL_VIEW: 'O cliente visualizou a proposta pelo link',
  PROPOSAL_ACCEPT: 'O cliente aceitou a proposta',
  STAGE_CHANGED: 'O negócio mudou de etapa',
  DEAL_WON: 'O negócio foi ganho',
  DEAL_LOST: 'O negócio foi perdido',
  MANUAL_PAUSE: 'O vendedor pausou a sequência',
  UNSUBSCRIBED: 'O contato cancelou a inscrição ou o consentimento LGPD',
  NO_VALID_EMAIL: 'Contato sem e-mail válido',
  OWNER_MAILBOX_UNAVAILABLE: 'Dono sem caixa conectada ou não identificado',
  COMPLETED: 'A sequência de 9 e-mails foi concluída',
};
