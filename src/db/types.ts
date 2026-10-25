// ============================================================================
// HubSpot Pro CRM - Core Domain Types & Contracts
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

export type SequenceEnrollmentStatus =
  | 'ACTIVE'
  | 'PAUSED_ON_REPLY'
  | 'REPLIED'
  | 'COMPLETED'
  | 'PAUSED_MANUAL'
  | 'BOUNCED';

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
  companyId: string | null;
  enrichedAt: string | null;
  enrichmentSource: string | null;
  nextBestAction: NextBestAction | null;
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
  pipelineId: string;
  stageId: string;
  probability: number;
  expectedCloseDate: string | null;
  contactId: string | null;
  companyId: string | null;
  ownerId: string | null;
  status: DealStatus;
  stageEnteredAt: string;
  lastActivityAt: string | null;
  closedAt: string | null;
  lostReason: string | null;
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
  subject: string;
  bodyTemplate: string;
  stepType: 'EMAIL' | 'FOLLOW_UP' | 'TASK' | 'BREAKUP';
  condition: 'ALWAYS' | 'IF_NO_REPLY' | 'IF_OPENED';
  sentCount: number;
  openCount: number;
  clickCount: number;
  replyCount: number;
}

export interface SequenceStepExecutionLog {
  stepOrder: number;
  subject: string;
  action: 'SENT' | 'OPENED' | 'CLICKED' | 'REPLIED' | 'PAUSED_ON_REPLY' | 'COMPLETED';
  timestamp: string;
  details?: string;
}

export interface SequenceEnrollment {
  id: string;
  sequenceId: string;
  contactId: string;
  dealId: string | null;
  status: SequenceEnrollmentStatus;
  currentStepOrder: number;
  stepsCompleted: number;
  sentCount: number;
  openCount: number;
  clickCount: number;
  repliedAt: string | null;
  replySnippet: string | null;
  nextStepDueAt: string | null;
  history: SequenceStepExecutionLog[];
  enrolledAt: string;
  updatedAt: string;
}

export interface EmailSequence {
  id: string;
  name: string;
  description: string;
  category: 'OUTBOUND' | 'INBOUND_NURTURE' | 'FOLLOW_UP' | 'REENGAGEMENT';
  isActive: boolean;
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
  submittedAt: string;
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
}
