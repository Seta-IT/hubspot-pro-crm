// ============================================================================
// STI-hub — Fase 4: catalogo de gatilhos (20) e acoes (17) do construtor de automacoes (DAG).
// Fonte: ROADMAP-CRM.md, Modulo D. Ids estaveis (gravados nas definicoes); rotulos em portugues.
// ============================================================================

export const WF_TRIGGERS = [
  'CONTACT_CREATED',
  'CONTACT_UPDATED',
  'LEAD_IMPORTED',
  'FORM_SUBMITTED',
  'TAG_CHANGED',
  'PIPELINE_STAGE_CHANGED',
  'PROPOSAL_SENT',
  'PROPOSAL_VIEWED',
  'PROPOSAL_APPROVED',
  'DEAL_WON',
  'DEAL_LOST',
  'EMAIL_DELIVERED',
  'EMAIL_OPENED',
  'LINK_CLICKED',
  'REPLY_RECEIVED',
  'MEETING_SCHEDULED',
  'NO_ENGAGEMENT_PERIOD',
  'SPECIFIC_DATE',
  'WEBHOOK_RECEIVED',
  'CUSTOM_EVENT',
] as const;
export type WfTriggerType = (typeof WF_TRIGGERS)[number];

export const WF_TRIGGER_LABELS: Record<WfTriggerType, string> = {
  CONTACT_CREATED: 'Contato criado',
  CONTACT_UPDATED: 'Contato atualizado',
  LEAD_IMPORTED: 'Lead importado',
  FORM_SUBMITTED: 'Formulário enviado',
  TAG_CHANGED: 'Tag adicionada/removida',
  PIPELINE_STAGE_CHANGED: 'Mudança no pipeline',
  PROPOSAL_SENT: 'Proposta enviada',
  PROPOSAL_VIEWED: 'Proposta visualizada (evento verificável)',
  PROPOSAL_APPROVED: 'Proposta aprovada',
  DEAL_WON: 'Negócio ganho',
  DEAL_LOST: 'Negócio perdido',
  EMAIL_DELIVERED: 'E-mail entregue',
  EMAIL_OPENED: 'E-mail aberto (sinal aproximado)',
  LINK_CLICKED: 'Link clicado',
  REPLY_RECEIVED: 'Resposta recebida',
  MEETING_SCHEDULED: 'Reunião agendada',
  NO_ENGAGEMENT_PERIOD: 'Período sem engajamento',
  SPECIFIC_DATE: 'Data específica',
  WEBHOOK_RECEIVED: 'Webhook recebido',
  CUSTOM_EVENT: 'Evento comercial personalizado',
};

/** Gatilhos avaliados pelo agendador (sem evento externo). */
export const WF_SCHEDULED_TRIGGERS: WfTriggerType[] = ['NO_ENGAGEMENT_PERIOD', 'SPECIFIC_DATE'];

export const WF_ACTIONS = [
  'SEND_EMAIL',
  'ENROLL_SEQUENCE',
  'UNENROLL_SEQUENCE',
  'TAG',
  'CHANGE_OWNER',
  'UPDATE_PROPERTY',
  'CREATE_TASK',
  'CREATE_DEAL',
  'NOTIFY_SELLER',
  'SEND_WEBHOOK',
  'WAIT_CONDITION',
  'IF_ELSE',
  'PERCENT_SPLIT',
  'AB_TEST',
  'APPLY_LEAD_SCORE',
  'END_FLOW',
  'START_REACTIVATION',
] as const;
export type WfActionType = (typeof WF_ACTIONS)[number];

export const WF_ACTION_LABELS: Record<WfActionType, string> = {
  SEND_EMAIL: 'Enviar e-mail',
  ENROLL_SEQUENCE: 'Inscrever em cadência',
  UNENROLL_SEQUENCE: 'Remover de cadência',
  TAG: 'Adicionar/remover tag',
  CHANGE_OWNER: 'Alterar proprietário',
  UPDATE_PROPERTY: 'Atualizar propriedades',
  CREATE_TASK: 'Criar tarefa',
  CREATE_DEAL: 'Criar oportunidade',
  NOTIFY_SELLER: 'Notificar vendedor',
  SEND_WEBHOOK: 'Enviar webhook',
  WAIT_CONDITION: 'Aguardar condição',
  IF_ELSE: 'Dividir fluxo por condição (If/Else)',
  PERCENT_SPLIT: 'Dividir fluxo por percentual',
  AB_TEST: 'Executar teste A/B',
  APPLY_LEAD_SCORE: 'Aplicar lead scoring',
  END_FLOW: 'Encerrar fluxo',
  START_REACTIVATION: 'Iniciar fluxo de reativação (elegibilidade verificada)',
};

/** Nos que ramificam (saidas nomeadas) em vez de uma unica saida "next". */
export const WF_BRANCHING: WfActionType[] = ['IF_ELSE', 'PERCENT_SPLIT', 'AB_TEST', 'WAIT_CONDITION'];

export const WF_CONDITION_OPERATORS = ['EQUALS', 'NOT_EQUALS', 'CONTAINS', 'GREATER_THAN', 'LESS_THAN', 'IS_EMPTY', 'IS_NOT_EMPTY', 'HAS_TAG'] as const;
export type WfConditionOperator = (typeof WF_CONDITION_OPERATORS)[number];
export const WF_OPERATOR_LABELS: Record<WfConditionOperator, string> = {
  EQUALS: 'é igual a',
  NOT_EQUALS: 'é diferente de',
  CONTAINS: 'contém',
  GREATER_THAN: 'maior que',
  LESS_THAN: 'menor que',
  IS_EMPTY: 'está vazio',
  IS_NOT_EMPTY: 'está preenchido',
  HAS_TAG: 'tem a tag',
};

/** Propriedades do contato que condicoes podem ler. */
export const WF_READABLE_FIELDS = [
  'email', 'firstName', 'lastName', 'jobTitle', 'seniority', 'department', 'lifecycleStage', 'leadStatus', 'leadScore',
  'buyingRole', 'ownerId', 'ownerName', 'companyId', 'utmSource', 'utmMedium', 'utmCampaign', 'lastActivityAt', 'subscriptionStatus',
] as const;

/**
 * Propriedades que a acao "Atualizar propriedades" pode gravar. Campos LGPD (consentimento, base
 * legal, status de inscricao, categorias), e-mail, ids e qualquer dado do ERP/Chamados ficam FORA.
 */
export const WF_WRITABLE_FIELDS = ['jobTitle', 'seniority', 'department', 'lifecycleStage', 'leadStatus', 'buyingRole'] as const;
