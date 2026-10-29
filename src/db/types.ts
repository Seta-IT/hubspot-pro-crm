// ============================================================================
// HubSpot Pro CRM - Core Domain Types & Contracts (Seta Telecom + ERP Brasil)
// ============================================================================

export type LifecycleStage =
  | 'SUBSCRIBER'
  | 'LEAD'
  | 'MQL'
  | 'SQL'
  | 'OPPORTUNITY'
  | 'CUSTOMER'
  | 'EVANGELIST'
  | 'OTHER';

export type LeadStatus =
  | 'NEW'
  | 'OPEN'
  | 'IN_PROGRESS'
  | 'OPEN_DEAL'
  | 'UNQUALIFIED'
  | 'ATTEMPTED_TO_CONTACT'
  | 'CONNECTED'
  | 'BAD_TIMING';

export type DealStatus = 'OPEN' | 'WON' | 'LOST';

export type DealPriority = 'ALTA' | 'MEDIA' | 'BAIXA';

export type DealBusinessType = 'NEW_BUSINESS' | 'LOCACAO_RECORRENTE' | 'UPSELL_RENOVACAO';

export type BuyingRoleType =
  | 'DECISOR'
  | 'COMPRADOR_ECONOMICO'
  | 'INFLUENCIADOR_TECNICO'
  | 'CAMPEAO'
  | 'BLOQUEADOR'
  | 'OPERACIONAL';

export type ActivityType =
  | 'NOTE'
  | 'EMAIL'
  | 'CALL'
  | 'TASK'
  | 'MEETING'
  | 'STAGE_CHANGE'
  | 'ENRICHMENT'
  | 'HEALTH_ALERT'
  | 'WORKFLOW_ACTION'
  | 'FORM_SUBMITTED'
  | 'TICKET_EVENT';

export type WorkflowTriggerType =
  | 'CONTACT_CREATED'
  | 'DEAL_STAGE_CHANGED'
  | 'SCORE_THRESHOLD'
  | 'FORM_SUBMITTED'
  | 'DATA_HEALTH_ISSUE';

export type WorkflowConditionOperator =
  | 'EQUALS'
  | 'NOT_EQUALS'
  | 'CONTAINS'
  | 'GREATER_THAN'
  | 'LESS_THAN'
  | 'IS_EMPTY'
  | 'IS_NOT_EMPTY';

export type WorkflowActionType =
  | 'UPDATE_PROPERTY'
  | 'SEND_EMAIL'
  | 'CREATE_TASK'
  | 'ENRICH_RECORD'
  | 'NOTIFY_OWNER'
  | 'ASSIGN_OWNER'
  | 'SEND_WEBHOOK'
  | 'ENROLL_SEQUENCE';

export type WorkflowExecutionStatus = 'RUNNING' | 'COMPLETED' | 'FAILED' | 'SKIPPED';

export type DataHealthIssueType =
  | 'DUPLICATE_CONTACT'
  | 'DUPLICATE_COMPANY'
  | 'INVALID_EMAIL'
  | 'INVALID_PHONE'
  | 'MISSING_CRITICAL_FIELDS'
  | 'STALE_RECORD';

export type IssueSeverity = 'HIGH' | 'MEDIUM' | 'LOW';

export type IssueStatus = 'OPEN' | 'MERGED' | 'IGNORED' | 'RESOLVED';

export type CanonicalSequenceEnrollmentState =
  | 'IN_SEQUENCE'
  | 'WAITING_NEXT_STEP'
  | 'PAUSED'
  | 'COMPLETED'
  | 'REPLIED'
  | 'MEETING_SCHEDULED'
  | 'REMOVED_MANUALLY'
  | 'REMOVED_AUTOMATICALLY'
  | 'UNSUBSCRIBED_FROM_COMMUNICATIONS'
  | 'BLOCKED_BY_DELIVERABILITY';

export type SequenceEnrollmentStatus =
  | 'ACTIVE'
  | 'IN_SEQUENCE'
  | 'WAITING_NEXT_STEP'
  | 'PAUSED'
  | 'PAUSED_MANUAL'
  | 'PAUSED_ON_REPLY'
  | 'REPLIED'
  | 'MEETING_BOOKED'
  | 'MEETING_SCHEDULED'
  | 'COMPLETED'
  | 'MANUAL_STOP'
  | 'REMOVED_MANUAL'
  | 'REMOVED_MANUALLY'
  | 'REMOVED_AUTOMATIC'
  | 'REMOVED_AUTOMATICALLY'
  | 'UNSUBSCRIBED'
  | 'UNSUBSCRIBED_GLOBAL'
  | 'UNSUBSCRIBED_FROM_COMMUNICATIONS'
  | 'BLOCKED_DELIVERABILITY'
  | 'BLOCKED_BY_DELIVERABILITY'
  | 'BOUNCED';

export type SequenceStepType =
  | 'AUTO_EMAIL'
  | 'MANUAL_EMAIL'
  | 'SALES_TASK'
  | 'PHONE_CALL'
  | 'REMINDER'
  | 'CALENDAR_MEETING'
  | 'BRANCH_CONDITION'
  | 'TRANSFER_TO_NURTURE'
  | 'EMAIL'
  | 'FOLLOW_UP'
  | 'TASK'
  | 'BREAKUP';

export type SequenceExitRuleTrigger =
  | 'CONTACT_REPLIED'
  | 'MEETING_BOOKED'
  | 'STOP_REQUESTED'
  | 'HIGH_INTENT_LINK_CLICKED'
  | 'OPPORTUNITY_CREATED'
  | 'DEAL_STAGE_CHANGED'
  | 'DEAL_WON_OR_LOST'
  | 'CONTACT_DISQUALIFIED'
  | 'MOVED_TO_INCOMPATIBLE_SEQUENCE'
  | 'HARD_BOUNCE'
  | 'SPAM_COMPLAINT'
  | 'CONSENT_WITHDRAWN'
  | 'ENTERED_SUPPRESSION_LIST';

export interface SendingWindowConfig {
  businessHoursStart: string;
  businessHoursEnd: string;
  businessDaysOnly: boolean;
  skipHolidays: boolean;
  holidayDates: string[];
  respectRecipientTimezone: boolean;
  defaultTimezone: string;
  dailyMailboxSendLimit: number;
  currentTodaySent: number;
  /** Data (YYYY-MM-DD no fuso padrão) a que se refere currentTodaySent; zera o contador na virada do dia. */
  currentTodayDate?: string;
  senderMailbox: string;
  sendingProvider: 'OUTLOOK_M365' | 'MARKETING_ESP';
}

export type SequenceScheduleConfig = SendingWindowConfig;

export interface SequenceExitRuleConfig {
  trigger: SequenceExitRuleTrigger;
  label: string;
  description: string;
  enabled: boolean;
  scope: 'CONTACT_ONLY' | 'ENTIRE_COMPANY';
  preservesGlobalSubscription: boolean;
  targetCanonicalState: CanonicalSequenceEnrollmentState;
}

export type ContactSubscriptionStatus =
  | 'SUBSCRIBED'
  | 'UNSUBSCRIBED_MARKETING'
  | 'SUPPRESSED_BOUNCE'
  | 'SUPPRESSED_SPAM';

export type LgpdLegalBasis =
  | 'CONSENTIMENTO_OPT_IN'
  | 'LEGITIMO_INTERESSE_B2B'
  | 'EXECUCAO_CONTRATO'
  | 'OBRIGACAO_LEGAL';

export interface NextBestAction {
  actionType: 'CALL' | 'EMAIL' | 'MEETING' | 'ENRICH' | 'FOLLOW_UP' | 'PROPOSAL' | 'CLEAN_DATA' | 'CREATE_DEAL';
  title: string;
  reason: string;
  priority: 'HIGH' | 'MEDIUM' | 'LOW';
  suggestedDueInDays: number;
}

export interface Contact {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  normalizedPhone?: string | null;
  jobTitle: string | null;
  seniority?: string | null;
  department?: string | null;
  lifecycleStage: LifecycleStage;
  leadStatus: LeadStatus;
  leadScore: number;
  completenessScore: number;
  isValidEmail: boolean;
  isDisposableEmail?: boolean;
  isCorporateEmail?: boolean;
  isValidPhone: boolean;
  ownerId: string | null;
  ownerName?: string;
  hubspotOwnerId?: string;
  buyingRole?: BuyingRoleType | null;
  isUnworked?: boolean;
  companyId: string | null;
  enrichedAt: string | null;
  enrichmentSource: string | null;
  nextBestAction: NextBestAction | null;
  lgpdConsent?: boolean;
  lgpdConsentAt?: string | null;
  lgpdLegalBasis?: LgpdLegalBasis;
  subscriptionStatus?: ContactSubscriptionStatus;
  unsubscribedAt?: string | null;
  unsubscribeReason?: string | null;
  communicationCategories?: string[];
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  utmTerm?: string | null;
  utmContent?: string | null;
  customProperties: Record<string, unknown>;
  lastActivityAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Company {
  id: string;
  name: string;
  domain: string | null;
  cnpj: string | null;
  industry: string | null;
  size: string | null;
  annualRevenue: number | null;
  city: string | null;
  state: string | null;
  country: string | null;
  completenessScore: number;
  isTargetAccount?: boolean;
  icpTier?: 'TIER_1' | 'TIER_2' | 'TIER_3' | null;
  ownerName?: string;
  hubspotOwnerId?: string;
  enrichedAt: string | null;
  enrichmentSource: string | null;
  customProperties: Record<string, unknown>;
  lastActivityAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PipelineStage {
  id: string;
  pipelineId: string;
  name: string;
  order: number;
  defaultProbability: number;
  dealRottingDays: number;
  isClosed?: boolean;
  isWon?: boolean;
}

export interface Pipeline {
  id: string;
  name: string;
  isDefault: boolean;
  currency: string;
  stages: PipelineStage[];
  createdAt: string;
  updatedAt: string;
}

export interface Deal {
  id: string;
  title: string;
  value: number;
  currency: string;
  mrr?: number;
  contractMonths?: number;
  tcv?: number;
  priority?: DealPriority;
  dealType?: DealBusinessType;
  pipelineId: string;
  stageId: string;
  probability: number;
  expectedCloseDate: string | null;
  contactId: string | null;
  companyId: string | null;
  ownerId: string | null;
  ownerName?: string;
  status: DealStatus;
  stageEnteredAt: string;
  lastActivityAt: string | null;
  closedAt: string | null;
  lostReason: string | null;
  wonReason?: string | null;
  nextBestAction: NextBestAction | null;
  customProperties: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface TimelineEvent {
  id: string;
  type: ActivityType;
  title: string;
  body: string | null;
  metadata: Record<string, unknown>;
  contactId: string | null;
  companyId: string | null;
  dealId: string | null;
  actor: string;
  createdAt: string;
}

export interface WorkflowCondition {
  field: string;
  operator: WorkflowConditionOperator;
  value?: unknown;
}

export interface WorkflowStep {
  id: string;
  type: 'DELAY' | 'CONDITION' | 'ACTION';
  delayMinutes?: number;
  condition?: WorkflowCondition;
  actionType?: WorkflowActionType;
  actionConfig?: Record<string, unknown>;
}

export interface Workflow {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  triggerType: WorkflowTriggerType;
  triggerConfig: Record<string, unknown>;
  steps: WorkflowStep[];
  enrolledCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowStepLog {
  stepId: string;
  stepType: string;
  actionType?: string;
  status: 'SUCCESS' | 'SKIPPED' | 'FAILED';
  message: string;
  timestamp: string;
  details?: Record<string, unknown>;
}

export interface WorkflowExecution {
  id: string;
  workflowId: string;
  workflowName?: string;
  entityType: 'CONTACT' | 'COMPANY' | 'DEAL';
  entityId: string;
  status: WorkflowExecutionStatus;
  logs: WorkflowStepLog[];
  startedAt: string;
  completedAt: string | null;
}

export interface SequenceStep {
  id: string;
  stepOrder: number;
  dayOffset: number;
  delayDays: number;
  delayHours?: number;
  waitForEvent?: 'NONE' | 'EMAIL_OPENED' | 'LINK_CLICKED' | 'PROPOSAL_VIEWED';
  subject: string;
  bodyTemplate: string;
  stepType: SequenceStepType;
  condition: 'ALWAYS' | 'IF_NO_REPLY' | 'IF_OPENED' | 'IF_HIGH_ENGAGEMENT';
  taskTitle?: string;
  callScript?: string;
  meetingCalendarUrl?: string;
  branchConfig?: {
    conditionField: string;
    ifTrueNextStepOrder: number;
    ifFalseNextStepOrder: number;
  };
  nurtureCampaignId?: string;
  highIntentLinks?: string[];
  requiresManualApproval?: boolean;
  sentCount: number;
  openCount: number;
  clickCount: number;
  replyCount: number;
}

export interface SequenceStepExecutionLog {
  stepOrder: number;
  stepType?: SequenceStepType;
  dayOffset?: number;
  subject: string;
  action:
    | 'SENT'
    | 'OPENED'
    | 'CLICKED'
    | 'REPLIED'
    | 'PAUSED_ON_REPLY'
    | 'COMPLETED'
    | 'TASK_CREATED'
    | 'CALL_LOGGED'
    | 'REMINDER_TRIGGERED'
    | 'MEETING_INVITED'
    | 'BRANCH_EVALUATED'
    | 'TRANSFERRED_TO_NURTURE'
    | 'PAUSED'
    | 'RESUMED'
    | 'EXITED_RULE'
    | 'DEFERRED_MAILBOX_LIMIT';
  timestamp: string;
  details?: string;
  exitTrigger?: SequenceExitRuleTrigger;
  executedByMailbox?: string;
}

export type SequenceEnrollmentStepLog = SequenceStepExecutionLog;

export interface SequenceEnrollment {
  id: string;
  sequenceId: string;
  contactId: string;
  dealId: string | null;
  status: SequenceEnrollmentStatus;
  canonicalEnrollmentState?: CanonicalSequenceEnrollmentState;
  enrolledVersion?: number;
  assignedSeller?: string;
  recipientTimezone?: string;
  currentStepOrder: number;
  stepsCompleted: number;
  sentCount: number;
  openCount: number;
  clickCount: number;
  repliedAt: string | null;
  replySnippet: string | null;
  nextStepDueAt: string | null;
  nextScheduledExecutionAt?: string | null;
  exitReasonTrigger?: SequenceExitRuleTrigger | null;
  exitReasonDetail?: string | null;
  exitedAt?: string | null;
  exitedByScope?: 'CONTACT_ONLY' | 'ENTIRE_COMPANY' | null;
  transferredToNurtureCampaignId?: string | null;
  history: SequenceStepExecutionLog[];
  stepHistory?: SequenceEnrollmentStepLog[];
  enrolledAt: string;
  updatedAt: string;
}

export interface EmailSequenceVersionSnapshot {
  version: number;
  savedAt: string;
  changedFields: string[];
  steps: SequenceStep[];
  sendingWindow?: SendingWindowConfig;
  exitRules?: SequenceExitRuleConfig[];
  exitScope?: 'CONTACT_ONLY' | 'ENTIRE_COMPANY';
  reentryPolicy?: 'NEVER' | 'AFTER_DAYS' | 'ALLOW_IF_COMPLETED';
}

export interface EmailSequence {
  id: string;
  name: string;
  description: string;
  category: 'OUTBOUND' | 'INBOUND_NURTURE' | 'FOLLOW_UP' | 'REENGAGEMENT';
  isActive: boolean;
  version?: number;
  sendingWindow?: SendingWindowConfig;
  preventConflictingEnrollments?: boolean;
  reentryPolicy?: 'NEVER' | 'AFTER_DAYS' | 'ALLOW_IF_COMPLETED';
  reentryCooldownDays?: number;
  exitScope?: 'CONTACT_ONLY' | 'ENTIRE_COMPANY';
  exitRules?: SequenceExitRuleConfig[];
  leadRoutingMode?: 'FIXED_OWNER' | 'ROUND_ROBIN';
  assignedSellers?: string[];
  lastAssignedSellerIndex?: number;
  nurtureTargetCampaignId?: string | null;
  highIntentUrls?: string[];
  /** Histórico auditável de versões (snapshot da configuração anterior a cada alteração estrutural). */
  versionHistory?: EmailSequenceVersionSnapshot[];
  steps: SequenceStep[];
  enrolledCount: number;
  activeCount: number;
  completedCount: number;
  repliedCount: number;
  sentCount: number;
  openCount: number;
  clickCount: number;
  replyCount: number;
  openRate: number;
  clickRate: number;
  replyRate: number;
  createdAt: string;
  updatedAt: string;
}

export interface SuggestedMergePlan {
  entityType: 'CONTACT' | 'COMPANY';
  primaryId: string;
  duplicateId: string;
  matchReasons: string[];
  confidenceScore: number;
  mergedFields: Record<string, unknown>;
  fieldResolution: Record<
    string,
    {
      chosenValue: unknown;
      source: 'PRIMARY' | 'DUPLICATE' | 'COMBINED';
      primaryValue: unknown;
      duplicateValue: unknown;
    }
  >;
  timelineEventsToMove: number;
  dealsToMove: number;
  contactsToMove?: number;
}

export interface DataHealthIssue {
  id: string;
  issueType: DataHealthIssueType;
  severity: IssueSeverity;
  entityType: 'CONTACT' | 'COMPANY' | 'DEAL';
  primaryEntityId: string;
  duplicateEntityId: string | null;
  confidenceScore: number;
  title: string;
  description: string;
  suggestedMerge: SuggestedMergePlan | null;
  status: IssueStatus;
  detectedAt: string;
  resolvedAt?: string | null;
}

// ============================================================================
// Phase 3: Marketing Hub (Web Forms) & Service Hub (Jira-style Service Desk)
// ============================================================================

export type WebFormTargetType = 'LEAD_CAPTURE' | 'DEMO_REQUEST' | 'SUPPORT_TICKET' | 'NEWSLETTER';

export type WebFormFieldType = 'TEXT' | 'EMAIL' | 'PHONE' | 'COMPANY' | 'SELECT' | 'TEXTAREA';

export interface WebFormField {
  name: string;
  label: string;
  type: WebFormFieldType;
  required: boolean;
  placeholder?: string;
  options?: string[];
}

export interface WebForm {
  id: string;
  name: string;
  slug: string;
  title: string;
  description: string;
  targetType: WebFormTargetType;
  fields: WebFormField[];
  submitButtonText: string;
  redirectUrl: string | null;
  lifecycleStageOnSubmit: LifecycleStage;
  autoCreateDeal: boolean;
  autoCreateTicket: boolean;
  viewsCount: number;
  submissionsCount: number;
  conversionRate: number;
  requireLgpdConsent?: boolean;
  lgpdConsentText?: string;
  defaultCampaignId?: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface FormSubmission {
  id: string;
  formId: string;
  formName: string;
  values: Record<string, string>;
  contactId: string | null;
  companyId: string | null;
  dealId: string | null;
  ticketId: string | null;
  lgpdConsent?: boolean;
  lgpdConsentAt?: string | null;
  lgpdLegalBasis?: LgpdLegalBasis;
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  utmTerm?: string | null;
  utmContent?: string | null;
  campaignId?: string | null;
  submittedAt: string;
}

export type MarketingSendingProvider = 'MARKETING_ESP' | 'OUTLOOK_M365';

export interface MarketingEmailBroadcast {
  id: string;
  name: string;
  subject: string;
  preheader?: string;
  status: 'SENT' | 'DRAFT' | 'SCHEDULED' | 'ARCHIVED';
  emailType: 'REGULAR' | 'AUTOMATED' | 'FOLLOW_UP' | 'ABM_CAMPAIGN';
  sendingProvider: MarketingSendingProvider;
  deliveredCount: number;
  openRatePercent: number;
  clickRatePercent: number;
  updatedAtDisplay: string;
  updatedBy: string;
  publishedAtDisplay: string;
  campaignId?: string | null;
  segmentId?: string | null;
  bodyPreview?: string;
  createdAt: string;
  updatedAt: string;
}

export interface MarketingCampaign {
  id: string;
  name: string;
  objective: string;
  status: 'ACTIVE' | 'IN_PROGRESS' | 'SCHEDULED' | 'COMPLETED' | 'PAUSED';
  channel: string;
  sendingProvider: MarketingSendingProvider;
  utmCampaign: string;
  budgetBrl: number;
  sessions: number;
  sentCount: number;
  deliveredCount: number;
  uniqueClicksCount: number;
  repliesCount: number;
  unsubscribesCount: number;
  bouncesCount: number;
  contactsGenerated: number;
  mqlCount: number;
  sqlCount: number;
  opportunitiesCount: number;
  attributedDeals: number;
  wonDealsCount: number;
  attributedRevenueBrl: number;
  ownerName: string;
  createdAt: string;
  updatedAt: string;
}

export interface MarketingSegmentCriteria {
  icpTier?: 'TIER_1' | 'TIER_2' | 'TIER_3';
  minLeadScore?: number;
  buyingRole?: string;
  lifecycleStage?: LifecycleStage;
  targetAccountOnly?: boolean;
  onlySubscribedEligible?: boolean;
  minCompanyEngagedContacts?: number;
}

export interface MarketingSegment {
  id: string;
  name: string;
  description: string;
  type: 'DYNAMIC' | 'STATIC';
  filterExpression: string;
  criteria: MarketingSegmentCriteria;
  matchedContactIds?: string[];
  count: number;
  createdAt: string;
  updatedAt: string;
}

export interface MarketingLandingPage {
  id: string;
  name: string;
  slug: string;
  title: string;
  subtitle: string;
  formId: string;
  campaignId: string | null;
  utmCampaign: string;
  status: 'PUBLISHED' | 'DRAFT';
  viewsCount: number;
  submissionsCount: number;
  conversionRate: number;
  createdAt: string;
  updatedAt: string;
}

export interface SuppressionEntry {
  id: string;
  email: string;
  contactId: string | null;
  reason:
    | 'UNSUBSCRIBED_MARKETING'
    | 'HARD_BOUNCE'
    | 'SPAM_COMPLAINT'
    | 'MANUAL_SUPPRESSION'
    | 'LGPD_REVOCATION';
  scope: 'MARKETING_ONLY' | 'GLOBAL_ALL';
  source: string;
  createdAt: string;
}

export interface AccountEngagementSummary {
  companyId: string;
  companyName: string;
  icpTier: 'TIER_1' | 'TIER_2' | 'TIER_3' | null;
  isTargetAccount: boolean;
  engagedContactsCount: number;
  totalContactsCount: number;
  engagedContacts: Array<{
    id: string;
    name: string;
    email: string;
    jobTitle: string | null;
    leadScore: number;
    buyingRole?: BuyingRoleType | null;
  }>;
  activeCadencesCount: number;
  openDealsCount: number;
  openPipelineValueBrl: number;
  accountHeatLevel: 'HOT_MULTI_THREADED' | 'WARM_ENGAGED' | 'COLD';
}

export type TicketCategory = 'INCIDENT' | 'SUPPORT' | 'BILLING' | 'BUG' | 'FEATURE_REQUEST';
export type TicketPriority = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
export type TicketStatus = 'OPEN' | 'IN_PROGRESS' | 'WAITING_CUSTOMER' | 'RESOLVED' | 'CLOSED';
export type TicketChannel = 'WEB_PORTAL' | 'EMAIL' | 'WHATSAPP' | 'PHONE' | 'CHAT';
export type TicketSlaStatus = 'ON_TRACK' | 'AT_RISK' | 'BREACHED';

export interface TicketComment {
  id: string;
  author: string;
  authorRole: 'AGENT' | 'CUSTOMER';
  isInternal: boolean;
  body: string;
  createdAt: string;
}

export interface ServiceTicket {
  id: string;
  key: string;
  subject: string;
  description: string;
  category: TicketCategory;
  priority: TicketPriority;
  status: TicketStatus;
  channel: TicketChannel;
  contactId: string | null;
  companyId: string | null;
  dealId: string | null;
  assignee: string;
  contractId?: string | null;
  serviceOrderId?: string | null;
  equipmentSerial?: string | null;
  slaPausedAt?: string | null;
  totalPausedMinutes?: number;
  resolution?: string | null;
  slaFirstResponseDueAt: string;
  slaResolutionDueAt: string;
  firstRespondedAt: string | null;
  resolvedAt: string | null;
  slaStatus: TicketSlaStatus;
  csatScore: number | null;
  tags: string[];
  comments: TicketComment[];
  createdAt: string;
  updatedAt: string;
}

// ============================================================================
// Phase 4: ERP Brasil, Propostas Comerciais, Contratos de Locação & Fiscal
// (Padrão GestãoClick + Legislação Tributária Brasileira LC 116/03 + STF SV 31)
// ============================================================================

export type ErpFiscalNature =
  | 'LOCACAO_BENS_MOVEIS'
  | 'SERVICO_TECNICO_TI_TELECOM'
  | 'SERVICO_COMUNICACAO_SCM_SVA'
  | 'VENDA_EQUIPAMENTO';

export type ErpTaxRegime = 'LUCRO_PRESUMIDO' | 'LUCRO_REAL' | 'SIMPLES_NACIONAL';

export type ErpProposalStatus =
  | 'RASCUNHO'
  | 'ENVIADA'
  | 'EM_NEGOCIACAO'
  | 'APROVADA'
  | 'CONVERTIDA_CONTRATO'
  | 'RECUSADA';

export interface ErpProposalItem {
  id: string;
  sku: string;
  description: string;
  itemType?: 'PRODUCT' | 'SERVICE';
  unit?: string;
  fiscalNature: ErpFiscalNature;
  ncmOrServiceCode: string;
  serialNumber?: string;
  quantity: number;
  unitPrice: number;
  discountPercent: number;
  discountAmount?: number;
  subtotal?: number;
  isRecurring: boolean;
  totalMonthly: number;
}

export interface ErpProposalDigitalSignature {
  signerName: string;
  signerCpf: string;
  signerRole: string;
  signerEmail?: string;
  modality: "ICP_BRASIL_A1" | "ICP_BRASIL_A3" | "GOV_BR_OURO";
  certificateIssuer: string;
  certificateSerial: string;
  signatureHashSha256: string;
  timestampToken: string;
  signedAt: string;
  ipAddress?: string;
}

export interface ErpProposalInstallment {
  number: number;
  dueDate: string;
  amount: number;
  paymentMethod: string;
  notes?: string;
}

export interface ErpProposalVersionSnapshot {
  title: string;
  status: ErpProposalStatus;
  budgetType?: 'PRODUTOS' | 'SERVICOS' | 'CONJUNTO' | 'LOCACAO';
  serviceType?: string;
  companyId: string | null;
  companyName: string;
  companyCnpj: string;
  contactId: string | null;
  contactName: string;
  careOf?: string;
  contactEmail?: string;
  sellerName: string;
  sellerEmail?: string;
  sellerPhone?: string;
  contractMonths: number;
  readjustmentIndex?: 'IPCA' | 'IGP-M' | 'FIXO' | 'IST_ANATEL';
  paymentCondition: string;
  validUntil: string;
  deliveryLeadTime?: string;
  deliveryForecast?: string;
  shippingCarrier?: string;
  shippingCost?: number;
  setupFee?: number;
  templateStyle?:
    | "CLEAN_CORPORATE_LIGHT"
    | "MINIMAL_SWISS_PAPER"
    | "EXECUTIVE_SOFT_INDIGO"
    | "FOLHA_ORCAMENTO"
    | "EXECUTIVO_CORPORATIVO"
    | "DESIGN_CONSULTORIA"
    | "INSTITUCIONAL_SETA_TELECOM"
    | "SETA_PREMIUM_TELECOM"
    | "LOCACAO_DETALHADA_SLA";
  slaTier?: string;
  slaResponseHours?: number;
  slaAvailabilityPercent?: string;
  deliveryAddress?: string;
  discountAmount?: number;
  discountPercentGlobal?: number;
  productsSubtotal?: number;
  servicesSubtotal?: number;
  monthlyRecurringTotal: number;
  oneTimeSetupTotal: number;
  totalContractValue: number;
  commercialNotes: string;
  technicalClauses: string;
  internalNotes?: string;
  installments?: ErpProposalInstallment[];
  items: ErpProposalItem[];
}

export interface ErpProposalStatusHistoryEntry {
  id: string;
  date: string;
  notes: string;
  status: ErpProposalStatus;
  statusLabel: string;
  employeeName: string;
}

export interface ErpProposalVersionEntry {
  version: number;
  versionLabel: string;
  savedAt: string;
  savedBy: string;
  changedFields: string[];
  changeSummary: string;
  snapshot: ErpProposalVersionSnapshot;
}

export interface ErpCommercialProposal {
  id: string;
  code: string;
  title: string;
  serviceType?: string;
  budgetType?: 'PRODUTOS' | 'SERVICOS' | 'CONJUNTO' | 'LOCACAO';
  storeName?: string;
  salesChannel?: string;
  costCenter?: string;
  proposalDate?: string;
  deliveryLeadTime?: string;
  deliveryForecast?: string;
  careOf?: string;
  introductionText?: string;
  internalNotes?: string;
  shippingCost?: number;
  shippingCarrier?: string;
  deliveryAddress?: string;
  discountPercentGlobal?: number;
  productsSubtotal?: number;
  servicesSubtotal?: number;
  installments?: ErpProposalInstallment[];
  companyId: string | null;
  companyName: string;
  companyCnpj: string;
  contactId: string | null;
  contactName: string;
  contactEmail?: string;
  dealId: string | null;
  sellerName: string;
  sellerEmail?: string;
  sellerPhone?: string;
  status: ErpProposalStatus;
  modality?: 'RENTAL' | 'SERVICE' | 'HYBRID';
  templateStyle?:
    | 'CLEAN_CORPORATE_LIGHT'
    | 'MINIMAL_SWISS_PAPER'
    | 'EXECUTIVE_SOFT_INDIGO'
    | 'FOLHA_ORCAMENTO'
    | 'EXECUTIVO_CORPORATIVO'
    | 'DESIGN_CONSULTORIA'
    | 'INSTITUCIONAL_SETA_TELECOM'
    | 'SETA_PREMIUM_TELECOM'
    | 'LOCACAO_DETALHADA_SLA';
  setupFee?: number;
  slaTier?: string;
  slaResponseHours?: number;
  slaAvailabilityPercent?: string;
  deliveryDays?: number;
  warrantyTerms?: string;
  technicalScopeNotes?: string;
  readjustmentIndex?: 'IPCA' | 'IGP-M' | 'FIXO' | 'IST_ANATEL';
  discountAmount?: number;
  contractMonths: number;
  paymentCondition: string;
  validUntil: string;
  items: ErpProposalItem[];
  monthlyRecurringTotal: number;
  oneTimeSetupTotal: number;
  totalContractValue: number;
  commercialNotes: string;
  technicalClauses: string;
  convertedContractId?: string | null;
  convertedInvoiceId?: string | null;
  digitalSignature?: ErpProposalDigitalSignature | null;
  version?: number;
  versionHistory?: ErpProposalVersionEntry[];
  statusHistory?: ErpProposalStatusHistoryEntry[];
  createdAt: string;
  updatedAt: string;
}

export type ErpAssetStatus = 'EM_CLIENTE' | 'MANUTENCAO_RMA' | 'DEVOLVIDO';

export interface ErpRentalEquipmentItem {
  id: string;
  skuGestaoClick: string;
  description: string;
  variationDetails?: string;
  serialNumber: string;
  assetTag?: string;
  assetStatus?: ErpAssetStatus;
  ncm: string;
  quantity: number;
  stockAvailable?: number;
  unitMonthlyRent: number;
  assetValueBrl: number;
  remessaCfop: '5.908' | '6.908';
  remessaNfeKey: string;
}

export type ErpRentalContractStatus =
  | 'ATIVO'
  | 'FATURAMENTO'
  | 'EM_IMPLANTACAO'
  | 'RENOVACAO_PROXIMA'
  | 'PENDENTE_ASSINATURA'
  | 'SUSPENSO'
  | 'ENCERRADO';

export type ErpContractTemplateModel =
  | 'MODELO_LOCACAO_BENS_MOVEIS'
  | 'MODELO_PRESTACAO_SERVICOS_TI'
  | 'MODELO_TERMO_ASSINATURA_CLOUD';

export type ErpContractModality = 'LOCACAO' | 'SERVICO' | 'ASSINATURA' | 'HIBRIDO';

export interface ErpReadjustmentHistoryEntry {
  id: string;
  appliedAt: string;
  index: 'IPCA' | 'IGP-M' | 'FIXO' | 'IST_ANATEL';
  percentage: number;
  previousMonthlyValue: number;
  newMonthlyValue: number;
  note?: string;
}

export interface ErpContractPartialReturnItem {
  skuGestaoClick: string;
  description: string;
  serialNumber: string;
  quantityReturned: number;
  unitMonthlyRent: number;
  proRataBilledBrl: number;
  monthlyReductionBrl: number;
  returnNfeCfop?: '5.909' | '6.909';
  returnNfeNumber?: string;
}

export interface ErpContractPartialReturnEntry {
  id: string;
  returnedAt: string;
  cycleDaysUsed: number;
  returnedItems: ErpContractPartialReturnItem[];
  previousMonthlyValue: number;
  newRecurringMonthlyValue: number;
  currentCycleProRataTotalBrl: number;
  returnNfeNumber?: string;
  reason?: string;
  generatedProRataInvoiceId?: string;
}

export interface ErpContractVersionEntry {
  versionNumber: number;
  versionLabel: string;
  savedAt: string;
  savedBy: string;
  changeSummary: string;
  changedFields: string[];
  snapshot: Omit<ErpRentalContract, 'versionHistory'>;
}

export interface ErpRentalContract {
  version?: number;
  versionLabel?: string;
  versionHistory?: ErpContractVersionEntry[];
  id: string;
  contractNumber: string;
  title: string;
  modality?: ErpContractModality;
  companyId: string | null;
  companyName: string;
  companyCnpj: string;
  contactId: string | null;
  dealId: string | null;
  proposalId: string | null;
  monthlyValue: number;
  dueDay: number;
  startDate: string;
  endDate: string;
  contractMonths: number;
  readjustmentIndex: 'IGP-M' | 'IPCA' | 'FIXO' | 'IST_ANATEL';
  lastReadjustmentDate?: string | null;
  lastReadjustmentPercent?: number | null;
  readjustmentHistory?: ErpReadjustmentHistoryEntry[];
  partialReturns?: ErpContractPartialReturnEntry[];
  lastEmailSentAt?: string | null;
  lastEmailRecipient?: string | null;
  status: ErpRentalContractStatus;
  equipments: ErpRentalEquipmentItem[];
  remessaNfeNumber: string;
  remessaCfop: '5.908' | '6.908';
  legalBasisNote: string;
  lastBilledCompetence: string | null;
  gestaoClickCode?: string;
  nextDueDate?: string;
  periodicityLabel?: string;
  contractTemplateModel?: ErpContractTemplateModel;
  customClausesText?: string;
  paymentLinkUrl?: string;
  digitalSignature?: ErpProposalDigitalSignature | null;
  // Campos GestaoClick - Dados do Contrato, Total da Locacao, Entrega/Retirada e Medicao/PO
  sellerName?: string;
  costCenter?: string;
  chartOfAccounts?: string;
  proposalNumber?: string;
  freightValueBrl?: number;
  returnFreightValueBrl?: number;
  freightModality?: "CIF_EMITENTE" | "FOB_DESTINATARIO" | "TERCEIROS" | "PROPRIO_SETA" | "SEM_FRETE";
  freightTrackingCode?: string;
  includeFreightInInvoice?: boolean;
  externalContractNumber?: string;
  contractTermLabel?: string;
  productsSubtotalBrl?: number;
  additionValueBrl?: number;
  discountValueBrl?: number;
  discountPercent?: number;
  deliveryDate?: string;
  pickupDate?: string;
  deliveryCarrier?: string;
  deliveryCity?: string;
  deliveryAddress?: string;
  deliveryNotes?: string;
  customerPurchaseOrderNumber?: string;
  measurementNumber?: string;
  measurementPeriod?: string;
  measurementNotes?: string;
  // Motor de Recorrencia de Cobranca & Automacoes GestaoClick
  recurrenceEndMode?: "SEM_TERMINO" | "ATE_UMA_DATA" | "POR_VEZES";
  recurrenceOccurrencesLimit?: number;
  billingRecurrence?: "MENSAL" | "BIMESTRAL" | "TRIMESTRAL" | "SEMESTRAL" | "ANUAL";
  paymentMethod?: string;
  emailAutomationMode?: "NAO_ENVIAR" | "ENVIAR_AO_GERAR" | "ENVIAR_D_MENOS_5" | "ENVIAR_EMISSAO_E_VENCIMENTO" | string;
  billingRecipientEmails?: string[];
  generateNextInvoiceOnSave?: boolean;
  autoGenerateInvoiceDaysBeforeDue?: number;
  autoSendEmailOnBilling?: boolean;
  dunningRuleEnabled?: boolean;
  nextBillingDate?: string;
  customDueRuleEnabled?: boolean;
  customDueOffsetDays?: number;
  customDueTargetWeekday?: "NONE" | "MONDAY" | "TUESDAY" | "WEDNESDAY" | "THURSDAY" | "FRIDAY";
  customDueRuleLabel?: string;
  totalInstallmentsCount?: number;
  billedInstallmentsCount?: number;
  contractNotes?: string;
  internalNotes?: string;
  contractAttachments?: Array<{ id: string; fileName: string; fileType: string; addedAt: string; notes?: string }>;
  createdAt: string;
  updatedAt: string;
}

export type ErpFiscalDocumentType =
  | 'FATURA_LOCACAO'
  | 'NFSE_SERVICO'
  | 'NFE_REMESSA_LOCACAO'
  | 'NFE_VENDA_PRODUTO'
  | 'NFCE_CONSUMIDOR'
  | 'NFCOM_TELECOM'
  | 'NFE_IMPORTACAO';

export interface ErpImportDeclarationAddition {
  nAdicao: string;
  nSeqAdic: string;
  cFabricante: string;
  vDescDI: number;
  nDraw?: string;
}

export interface ErpImportDeclarationInfo {
  nDI: string;
  dDI: string;
  xLocDesemb: string;
  UFDesemb: string;
  dDesemb: string;
  tpViaTransp: "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "10" | "11" | "12";
  vAFRMM: number;
  tpIntermedio: "1" | "2" | "3";
  cExportador: string;
  currency: "USD" | "EUR" | "CNY";
  exchangeRatePtax: number;
  fobTotalForeign: number;
  freteInternacionalBrl: number;
  seguroInternacionalBrl: number;
  taxaSiscomexTotalBrl: number;
  outrasDespesasAduaneirasBrl: number;
  somarTributosEmVOutroSimples: boolean;
  exporterIdEstrangeiro: string;
  exporterName: string;
  exporterAddress: string;
  exporterCountryCodeBacen: string;
  exporterCountryName: string;
  additions: ErpImportDeclarationAddition[];
}

export interface ErpImportNfeItem {
  id: string;
  nItem: number;
  cProd: string;
  cEAN: string;
  xProd: string;
  ncm: string;
  cfop: "3.101" | "3.102" | "3.551" | "3.949";
  uCom: string;
  qCom: number;
  fobUnitForeign: number;
  vUnComBrl: number;
  vProdBrl: number;
  vFreteShareBrl: number;
  vSegShareBrl: number;
  valorAduaneiroBrl: number;
  orig: "1" | "2" | "6" | "7";
  csosn: "900" | "101" | "102" | "400";
  cstIpi: "49" | "99" | "00" | "01";
  cstPisCofins: "70" | "98" | "99" | "50";
  iiRatePercent: number;
  iiAmountBrl: number;
  ipiRatePercent: number;
  ipiAmountBrl: number;
  pisRatePercent: number;
  pisAmountBrl: number;
  cofinsRatePercent: number;
  cofinsAmountBrl: number;
  siscomexShareBrl: number;
  afrmmShareBrl: number;
  despAduaneirasShareBrl: number;
  icmsRatePercent: number;
  icmsReductionPercent: number;
  icmsBaseCalculoPorDentroBrl: number;
  icmsAmountBrl: number;
  vOutroItemBrl: number;
  totalItemNfeBrl: number;
  nAdicao: string;
  nSeqAdic: string;
  cFabricante: string;
}

export interface ErpImportNfeMetadata {
  sebraeVersion: string;
  crt: "1" | "2" | "3";
  natOp: string;
  serie: string;
  nNF: string;
  tpNF: "0";
  idDest: "3";
  finNFe: "1" | "2";
  indFinal: "0" | "1";
  indPres: "0" | "9";
  indIntermed: "0" | "1";
  di: ErpImportDeclarationInfo;
  items: ErpImportNfeItem[];
  totals: {
    vProd: number;
    vFrete: number;
    vSeg: number;
    vAduaneiro: number;
    vII: number;
    vIPI: number;
    vPIS: number;
    vCOFINS: number;
    vSiscomex: number;
    vAFRMM: number;
    vDespAduaneiras: number;
    vBC_ICMS: number;
    vICMS: number;
    vOutro: number;
    vNF: number;
    vTotTrib: number;
  };
  infCpl: string;
  sebraeTxtContent?: string;
  sefazXmlContent?: string;
}

export interface ErpTaxBreakdown {
  taxRegime: ErpTaxRegime;
  issRatePercent: number;
  issAmount: number;
  issWithheld: boolean;
  pisRatePercent: number;
  pisAmount: number;
  cofinsRatePercent: number;
  cofinsAmount: number;
  irpjEstimatedAmount: number;
  csllEstimatedAmount: number;
  irrfWithheldRatePercent: number;
  irrfWithheldAmount: number;
  csrfWithheldRatePercent: number;
  csrfWithheldAmount: number;
  icmsRatePercent: number;
  icmsAmount: number;
  totalTaxesEstimated: number;
  totalWithheld: number;
  netReceivableAmount: number;
  legalExemptionNotice: string;
}

export interface ErpFiscalInvoice {
  id: string;
  documentNumber: string;
  documentType: ErpFiscalDocumentType;
  competenceMonth: string;
  companyId: string | null;
  companyName: string;
  companyCnpj: string;
  companyAddress: string;
  rentalContractId: string | null;
  proposalId: string | null;
  dealId: string | null;
  grossAmount: number;
  discountAmount: number;
  netAmount: number;
  status: 'EMITIDA' | 'PAGA' | 'VENCIDA' | 'CANCELADA';
  issueDate: string;
  dueDate: string;
  paidAt: string | null;
  paymentMethod: 'BOLETO_PIX' | 'PIX_CORPORATIVO' | 'TED_BANCARIA';
  serviceCodeLc116: string | null;
  cfop: string | null;
  cstIcms: string | null;
  cstPisCofins: string | null;
  verificationCodeOrKey: string;
  pixCopyPaste: string;
  boletoDigitableLine: string;
  itemsDescription: Array<{
    description: string;
    serialNumber?: string;
    quantity: number;
    unitValue: number;
    totalValue: number;
  }>;
  taxBreakdown: ErpTaxBreakdown;
  importMetadata?: ErpImportNfeMetadata;
  // Campos propagados do Contrato GestaoClick, Pedido do Cliente (PO) e Medicao (BM)
  contractNumber?: string | null;
  externalContractNumber?: string | null;
  proposalNumber?: string | null;
  remessaNfeNumber?: string | null;
  contractTermLabel?: string | null;
  sellerName?: string | null;
  costCenter?: string | null;
  chartOfAccounts?: string | null;
  productsSubtotalBrl?: number;
  freightValueBrl?: number;
  returnFreightValueBrl?: number;
  freightModality?: "CIF_EMITENTE" | "FOB_DESTINATARIO" | "TERCEIROS" | "PROPRIO_SETA" | "SEM_FRETE" | null;
  freightTrackingCode?: string | null;
  includeFreightInInvoice?: boolean;
  additionValueBrl?: number;
  discountPercent?: number;
  deliveryDate?: string | null;
  pickupDate?: string | null;
  deliveryCarrier?: string | null;
  deliveryCity?: string | null;
  deliveryAddress?: string | null;
  deliveryNotes?: string | null;
  customerPurchaseOrderNumber?: string | null;
  measurementNumber?: string | null;
  measurementPeriod?: string | null;
  measurementNotes?: string | null;
  billingRecurrence?: "MENSAL" | "BIMESTRAL" | "TRIMESTRAL" | "SEMESTRAL" | "ANUAL" | null;
  installmentLabel?: string | null;
  paymentMethodLabel?: string | null;
  billingRecipientEmails?: string[];
  contractNotes?: string | null;
  customDueRuleLabel?: string | null;
  customDueOffsetDays?: number;
  customDueTargetWeekday?: "NONE" | "MONDAY" | "TUESDAY" | "WEDNESDAY" | "THURSDAY" | "FRIDAY" | null;
  createdAt: string;
  updatedAt: string;
}

export interface ErpCatalogItem {
  id: string;
  gestaoClickCode: string;
  name: string;
  category: 'EQUIPAMENTO_LOCACAO' | 'SERVICO_TECNICO_LC116' | 'TELECOM_SCM_SVA' | 'VENDA_HARDWARE';
  fiscalNature: ErpFiscalNature;
  ncmOrLc116: string;
  cfopDefault: string;
  stockAvailable: number;
  stockRentedInClients: number;
  monthlyRentalPrice: number;
  saleOrSetupPrice: number;
  isActive: boolean;
  // Aba 1: Dados
  barcodeEan?: string;
  productGroup?: string;
  movesStock?: boolean;
  enableNfe?: boolean;
  hasVariations?: boolean;
  hasComposition?: boolean;
  unitOfMeasure?: string;
  unitConversionToggle?: boolean;
  nfeReferences?: string[];
  // Aba 2: Detalhes
  netWeightKg?: number;
  grossWeightKg?: number;
  widthCm?: number;
  heightCm?: number;
  lengthCm?: number;
  brand?: string;
  modelName?: string;
  warrantyMonths?: number;
  controlsSerialNumber?: boolean;
  // Aba 3: Valores
  costPrice?: number;
  accessoryExpenses?: number;
  profitMarginPercent?: number;
  wholesalePrice?: number;
  assetValueBrl?: number;
  // Aba 4: Estoque
  minStock?: number;
  maxStock?: number;
  warehouseLocation?: string;
  stockMovements?: Array<{
    id: string;
    date: string;
    type: 'ENTRADA' | 'SAIDA' | 'REMESSA_LOCACAO' | 'RETORNO_LOCACAO';
    quantity: number;
    documentRef: string;
    notes: string;
  }>;
  // Aba 6: Fiscal
  cest?: string;
  merchandiseOrigin?: string;
  cfopRemessaLocacao?: string;
  cfopRetornoLocacao?: string;
  cstIcms?: string;
  cstPisCofins?: string;
  ipiRatePercent?: number;
  // Aba 7: Fornecedores
  suppliersList?: Array<{
    supplierName: string;
    supplierCnpj: string;
    supplierSku: string;
    lastPurchaseCost: number;
  }>;
}

export interface ErpFinancialEntry {
  id: string;
  type: 'RECEBER' | 'PAGAR';
  category:
    | 'LOCACAO_EQUIPAMENTOS'
    | 'SERVICOS_TI_TELECOM'
    | 'FORNECEDOR_LINK_HARDWARE'
    | 'IMPOSTOS_TRIBUTOS'
    | 'OPERACIONAL';
  description: string;
  companyName: string;
  costCenter: string;
  amount: number;
  dueDate: string;
  paidAt: string | null;
  status: 'ABERTO' | 'PAGO' | 'ATRASADO';
  invoiceId: string | null;
  paymentMethod: string;
}

export interface ErpBankAccount {
  id: string;
  name: string;
  lastMovedAt: string;
  balance: number;
  status: "POSITIVE" | "NEGATIVE" | "ZERO";
}

export interface ErpDashboardSummary {
  availableBalanceToday: number;
  bankAccountsSummaryText: string;
  receivableToday: number;
  receivableTodaySubtitle: string;
  payableToday: number;
  payableTodaySubtitle: string;
  receivedMonth: number;
  receivedMonthPlanned: number;
  receivedMonthPercent: number;
  paidMonth: number;
  paidMonthPlanned: number;
  paidMonthPercent: number;
  cashFlowPeriodBalance: number;
  cashFlowBestMonth: string;
  cashFlowWorstMonth: string;
  cashFlowMonthly: Array<{
    month: string;
    recebimentos: number;
    pagamentos: number;
    saldo: number;
  }>;
  salesPeriodTotal: number;
  salesMonthlyAverage: number;
  salesCurrentMonthToDate: number;
  salesMonthly: Array<{
    month: string;
    vendas: number;
    media: number;
  }>;
}

export interface ErpSaleOrder {
  id: string;
  code: string;
  companyName: string;
  sellerName: string;
  date: string;
  status: string;
  totalAmount: number;
  itemsSummary: string;
  paymentMethod?: string;
  saleType?: 'PRODUTO' | 'SERVICO' | 'BALCAO' | 'DEVOLUCAO';
  commissionAmount?: number;
}

export interface ErpServiceOrder {
  id: string;
  code: string;
  companyName: string;
  sellerName: string;
  technicianName: string;
  entryDate: string;
  exitDate: string;
  status: string;
  totalAmount: number;
  description: string;
  equipmentName?: string;
  serialNumber?: string;
  technicalReport?: string;
  priority?: 'BAIXA' | 'NORMAL' | 'ALTA' | 'CRITICA';
}

export interface ErpSupplierRecord {
  id: string;
  name: string;
  legalName: string;
  cnpj: string;
  phone: string;
  email: string;
  active: boolean;
  supplierType?: 'FORNECEDOR' | 'TRANSPORTADORA';
  cityState?: string;
  modalFrete?: string;
}

export interface ErpEmployeeRecord {
  id: string;
  name: string;
  role: string;
  email: string;
  phone: string;
  active: boolean;
}

export interface ErpOfxTransactionItem {
  fitId: string;
  trnType: "CREDIT" | "DEBIT";
  dtPosted: string;
  amount: number;
  memo: string;
  bankCode: "077" | "341";
  bankName: string;
  matchedFinancialEntryId?: string | null;
  matchedInvoiceId?: string | null;
  matchedCompanyName?: string | null;
  status: "CONCILIADO_BAIXADO" | "NOVO_LANCAMENTO_CRIADO" | "JA_CONCILIADO";
}

export interface ErpOfxReconciliationResult {
  reconciledAt: string;
  bankCode: "077" | "341";
  bankName: string;
  companyCnpj: string;
  totalTransactionsParsed: number;
  reconciledEntriesCount: number;
  createdEntriesCount: number;
  totalCreditsBrl: number;
  totalDebitsBrl: number;
  netStatementDeltaBrl: number;
  updatedBankBalanceBrl: number;
  transactions: ErpOfxTransactionItem[];
}

export interface ErpDreLineItem {
  code: string;
  label: string;
  level: "GROUP" | "SUBITEM" | "TOTAL";
  monthlyBrl: number;
  ytdBrl: number;
  verticalPct: number;
  highlight?: "SV31_SAVINGS" | "EBITDA" | "NET_PROFIT";
}

export interface ErpDreReport {
  companyLegalName: string;
  companyCnpj: string;
  storeId: string;
  taxRegime: ErpTaxRegime;
  competenceMonth: string;
  grossRevenueRentalSv31: number;
  grossRevenueServicesLc116: number;
  grossRevenueHardwareSales: number;
  grossRevenueTotal: number;
  deductionsPisCofins: number;
  deductionsIssLc116: number;
  deductionsIcmsSales: number;
  deductionsReturns: number;
  deductionsTotal: number;
  issSavedBySv31Stf: number;
  netOperatingRevenue: number;
  costCogsAndCapexDepreciation: number;
  costFieldServiceAndNoc: number;
  costTotal: number;
  grossProfit: number;
  grossMarginPercent: number;
  expensesCommercialAndMarketing: number;
  expensesAdminAndPersonnel: number;
  expensesTotal: number;
  ebitda: number;
  ebitdaMarginPercent: number;
  financialResultNet: number;
  irpjCsllProvision: number;
  netProfit: number;
  netMarginPercent: number;
  lines: ErpDreLineItem[];
}

export interface ErpNfeXmlParsedItem {
  sku: string;
  description: string;
  ncm: string;
  cfop: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  serialNumbers: string[];
}

export interface ErpPurchaseOrder {
  id: string;
  code: string;
  supplierName: string;
  supplierCnpj?: string;
  issueDate: string;
  status: string;
  nfeNumber: string;
  nfeAccessKey?: string;
  cfopEntrada?: string;
  fiscalNature?: string;
  itemsSummary?: string;
  costCenter?: string;
  icmsCreditAmount?: number;
  pisCofinsCreditAmount?: number;
  serialNumbers?: string[];
  parsedItems?: ErpNfeXmlParsedItem[];
  totalAmount: number;
}

export interface GestaoClickLiveTotals {
  lojas: number;
  usuarios: number;
  clientes: number;
  produtos: number;
  servicos: number;
  orcamentos: number;
  vendas: number;
  contratos: number;
  recebimentos: number;
  pagamentos: number;
  contasBancarias?: number;
  ordensServicos?: number;
  fornecedores?: number;
  funcionarios?: number;
  compras?: number;
}

export interface GestaoClickConfig {
  connected: boolean;
  apiBaseUrl: string;
  mcpServerUrl?: string;
  credentialName?: string;
  storeId?: string;
  storeName?: string;
  mcpStatus?: 'ONLINE' | 'OFFLINE' | 'NOT_CONFIGURED';
  liveTotals?: GestaoClickLiveTotals;
  users?: Array<{ id: string; nome: string; email: string; telefone: string; ativo: boolean }>;
  accessTokenMasked: string;
  secretTokenMasked: string;
  companyLegalName: string;
  companyCnpj: string;
  municipalRegistration: string;
  stateRegistration: string;
  taxRegime: ErpTaxRegime;
  defaultIssRatePercent: number;
  autoGenerateMonthlyRentalInvoices: boolean;
  lastSyncAt: string;
  syncHistory: Array<{
    id: string;
    timestamp: string;
    status: 'SUCCESS' | 'PARTIAL';
    summary: string;
    recordsSynced: number;
  }>;
}

export interface ErpDatabaseState {
  proposals: ErpCommercialProposal[];
  rentalContracts: ErpRentalContract[];
  invoices: ErpFiscalInvoice[];
  catalog: ErpCatalogItem[];
  financialEntries: ErpFinancialEntry[];
  gestaoClickConfig: GestaoClickConfig;
  bankAccounts?: ErpBankAccount[];
  dashboardSummary?: ErpDashboardSummary;
  salesOrders?: ErpSaleOrder[];
  serviceOrders?: ErpServiceOrder[];
  suppliers?: ErpSupplierRecord[];
  employees?: ErpEmployeeRecord[];
  purchaseOrders?: ErpPurchaseOrder[];
}

// ============================================================================
// HubSpot-Style Tasks (Follow-up & Queues), Email Templates & Snippets
// ============================================================================

export type CrmTaskType = "EMAIL" | "CALL" | "TODO";
export type CrmTaskPriority = "HIGH" | "MEDIUM" | "LOW" | "NONE";
export type CrmTaskStatus =
  | "NOT_STARTED"
  | "IN_PROGRESS"
  | "WAITING"
  | "COMPLETED"
  | "DEFERRED";

export interface CrmTask {
  id: string;
  title: string;
  notes: string;
  type: CrmTaskType;
  priority: CrmTaskPriority;
  status: CrmTaskStatus;
  queueName: string;
  dueDate: string; // YYYY-MM-DD
  dueTime: string; // HH:mm
  reminderMinutesBefore: number | null; // 0, 15, 30, 60, 1440 or null
  assignedTo: string;
  contactId: string | null;
  companyId: string | null;
  dealId: string | null;
  createdByEmailSend?: boolean;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type CrmEmailTemplateCategory =
  | "PROSPECCAO"
  | "FOLLOW_UP"
  | "PROPOSTA"
  | "DIAGNOSTICO"
  | "RENOVACAO";

export interface CrmEmailTemplate {
  id: string;
  name: string;
  category: CrmEmailTemplateCategory;
  subject: string;
  body: string;
  createdBy: string;
  usageCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface CrmSnippet {
  id: string;
  shortcut: string; // e.g. "#sla-seta"
  name: string;
  category: string;
  content: string;
  usageCount: number;
  createdAt: string;
  updatedAt: string;
}


// ============================================================================
// STI-hub Corporate RBAC (9 Roles + 22 Seta Telecom Users), MFA Auth & Subdomain
// ============================================================================

export type StiHubRoleId =
  | "SUPER_ADMIN"
  | "DIRETORIA"
  | "GERENTE_COMERCIAL"
  | "VENDEDOR_SALES"
  | "ANALISTA_MARKETING"
  | "FINANCEIRO_FATURAMENTO"
  | "FISCAL_CONTABIL"
  | "GERENCIA_ESTOQUE"
  | "STOCK_MANAGER"
  | "TECNICO_NOC_OS"
  | "OPERADOR_PDV_ESTOQUE";

export type StiHubVisibilityScope = "TODOS" | "EQUIPE" | "PROPRIOS";

export type StiHubModuleAccessLevel = "FULL" | "EDIT" | "VIEW" | "NONE";

export type StiHubMacroModule = "CRM" | "ERP" | "CHAMADOS";

export interface StiHubUserModuleAccess {
  crm: boolean;
  erp: boolean;
  chamados: boolean;
}

export interface StiHubCrmPermissions {
  crmRole: string;
  portfolioScope: StiHubVisibilityScope;
  contactsAccess: StiHubModuleAccessLevel;
  companiesAccess: StiHubModuleAccessLevel;
  dealsFunnelAccess: StiHubModuleAccessLevel;
  ticketsServiceDeskAccess: StiHubModuleAccessLevel;
  marketingAutomationAccess: StiHubModuleAccessLevel;
  canExportCrmData: boolean;
  canMergeCrmRecords: boolean;
  canDeleteCrmRecords: boolean;
}

export interface StiHubErpPermissions {
  erpRole: string;
  financeBanksAccess: StiHubModuleAccessLevel;
  fiscalIssuanceAccess: StiHubModuleAccessLevel;
  proposalsQuotesAccess: StiHubModuleAccessLevel;
  stockOsSalesAccess: StiHubModuleAccessLevel;
  rentalContractsAccess: StiHubModuleAccessLevel;
  maxDiscountPercent: number;
  canViewBankBalances: boolean;
  canIssueFiscalDocuments: boolean;
  canApproveProposals: boolean;
  canDeleteErpRecords: boolean;
}

export interface StiHubSecurityAuditLogEntry {
  id: string;
  timestamp: string;
  actorEmail: string;
  actorName: string;
  actorRole: string;
  action: string;
  module: "AUTH_MFA" | "IAM_RBAC" | "CRM" | "ERP" | "CHAMADOS" | "FISCAL_A1" | "LGPD";
  resource: string;
  status: "SUCCESS" | "BLOCKED" | "WARNING";
  ipAddress: string;
  details: string;
  integrityHashSha256: string;
  prevHashSha256: string;
}

export interface StiHubActionGuards {
  canViewFinancialBalances: boolean;
  canIssueFiscalDocuments: boolean;
  canApproveProposals: boolean;
  canMergeRecords: boolean;
  canDeleteRecords: boolean;
  canExportData: boolean;
  canManageUsersRbac: boolean;
}

export interface StiHubRoleDefinition {
  id: StiHubRoleId;
  name: string;
  description: string;
  hubCategory:
    | "GLOBAL_DIRETORIA"
    | "CRM_SALES"
    | "CRM_MARKETING"
    | "ERP_FINANCEIRO_FISCAL"
    | "ERP_NOC_OPERACOES";
  defaultScope: StiHubVisibilityScope;
  enabledModules?: StiHubMacroModule[];
  moduleAccess?: StiHubUserModuleAccess;
  crmRole?: string;
  erpRole?: string;
  crmPermissions?: StiHubCrmPermissions;
  erpPermissions?: StiHubErpPermissions;
  crmItemPermissions?: Record<string, { view: boolean; edit: boolean; delete: boolean }>;
  erpItemPermissions?: Record<string, { view: boolean; edit: boolean; delete: boolean }>;
  itemPermissions?: Record<string, { view: boolean; edit: boolean; delete: boolean }>;
  modulePermissions: Record<string, StiHubModuleAccessLevel>;
  actionGuards: StiHubActionGuards;
  updatedAt: string;
}

export interface StiHubUserRecord {
  id: string;
  gestaoClickId?: string;
  hubspotOwnerId?: string;
  name: string;
  email: string;
  phone: string;
  department: string;
  jobTitle: string;
  roleId: StiHubRoleId;
  role?: string;
  crmRole?: string;
  erpRole?: string;
  scope: StiHubVisibilityScope;
  enabledModules?: StiHubMacroModule[];
  moduleAccess?: StiHubUserModuleAccess;
  crmPermissions?: StiHubCrmPermissions;
  erpPermissions?: StiHubErpPermissions;
  crmItemPermissions?: Record<string, { view: boolean; edit: boolean; delete: boolean }>;
  erpItemPermissions?: Record<string, { view: boolean; edit: boolean; delete: boolean }>;
  itemPermissions?: Record<string, { view: boolean; edit: boolean; delete: boolean }>;
  active: boolean;
  mfaEnabled: boolean;
  mfaMethod: "TOTP_AUTHENTICATOR" | "EMAIL_OTP";
  totpSecret?: string;
  totpConfigured?: boolean;
  totpConfiguredAt?: string | null;
  /** Epoca de rotacao em que o pareamento TOTP foi concluido (ver STIHUB_TOTP_ROTATION_EPOCH). */
  totpEpoch?: string | null;
  lastUsedTotpTimeStep?: number | null;
  passwordHash?: string;
  inviteStatus?: "PENDING_INVITE" | "ACTIVE";
  invitedAt?: string | null;
  actionGuardsOverride?: Partial<StiHubActionGuards>;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StiHubSubdomainRecord {
  domain: string;
  type: "PRIMARY_VERCEL" | "CORPORATE_CNAME" | "ERP_ALIAS";
  cnameTarget: string;
  sslStatus: "ACTIVE_TLS_1_3" | "PENDING_DNS";
  isDefaultPublicProposalDomain: boolean;
  verifiedAt: string;
}

export interface StiHubCustomPropertySpec {
  id: string;
  objectType: "CONTACT" | "COMPANY" | "DEAL" | "TICKET";
  internalName: string;
  label: string;
  fieldType: "ENUMERATION" | "TEXT" | "NUMBER" | "BOOLEAN";
  hubspotGroup: string;
  options?: string[];
  description: string;
  syncedWithPortal4369067: boolean;
}

export interface StiHubSecurityAndMailerConfig {
  enforceMfaOnAllLogins: boolean;
  sessionTtlHours: number;
  defaultTotpDemoCode: string;
  smtpProvider: "RESEND_HTTP_API" | "SMTP_SETA_TELECOM" | "GMAIL_CORPORATE_RELAY";
  smtpHost: string;
  smtpPort: number;
  smtpUser?: string;
  smtpPass?: string;
  resendApiKey?: string;
  fromName: string;
  fromEmail: string;
  replyToEmail: string;
  dkimSpfDmarcVerified: boolean;
  subdomains: StiHubSubdomainRecord[];
  customProperties: StiHubCustomPropertySpec[];
  updatedAt: string;
}

export interface StiHubRbacState {
  roles: StiHubRoleDefinition[];
  users: StiHubUserRecord[];
  securityConfig: StiHubSecurityAndMailerConfig;
  auditLogs?: StiHubSecurityAuditLogEntry[];
}

export interface CrmDatabaseState {
  contacts: Contact[];
  companies: Company[];
  pipelines: Pipeline[];
  deals: Deal[];
  timelineEvents: TimelineEvent[];
  workflows: Workflow[];
  workflowExecutions: WorkflowExecution[];
  sequences: EmailSequence[];
  sequenceEnrollments: SequenceEnrollment[];
  dataHealthIssues: DataHealthIssue[];
  webForms: WebForm[];
  formSubmissions: FormSubmission[];
  serviceTickets: ServiceTicket[];
  tasks?: CrmTask[];
  emailTemplates?: CrmEmailTemplate[];
  snippets?: CrmSnippet[];
  marketingEmails?: MarketingEmailBroadcast[];
  marketingCampaigns?: MarketingCampaign[];
  marketingSegments?: MarketingSegment[];
  marketingLandingPages?: MarketingLandingPage[];
  suppressionList?: SuppressionEntry[];
  erp?: ErpDatabaseState;
  rbac?: StiHubRbacState;
}
