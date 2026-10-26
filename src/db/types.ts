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
  ownerName?: string;
  hubspotOwnerId?: string;
  buyingRole?: BuyingRoleType | null;
  isUnworked?: boolean;
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

export interface ErpProposalInstallment {
  number: number;
  dueDate: string;
  amount: number;
  paymentMethod: string;
  notes?: string;
}

export interface ErpCommercialProposal {
  id: string;
  code: string;
  title: string;
  budgetType?: 'PRODUTOS' | 'SERVICOS' | 'CONJUNTO' | 'LOCACAO';
  storeName?: string;
  salesChannel?: string;
  costCenter?: string;
  proposalDate?: string;
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
  status: ErpProposalStatus;
  modality?: 'RENTAL' | 'SERVICE' | 'HYBRID';
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
  createdAt: string;
  updatedAt: string;
}

export type ErpAssetStatus = 'EM_CLIENTE' | 'MANUTENCAO_RMA' | 'DEVOLVIDO';

export interface ErpRentalEquipmentItem {
  id: string;
  skuGestaoClick: string;
  description: string;
  serialNumber: string;
  assetTag?: string;
  assetStatus?: ErpAssetStatus;
  ncm: string;
  quantity: number;
  unitMonthlyRent: number;
  assetValueBrl: number;
  remessaCfop: '5.908' | '6.908';
  remessaNfeKey: string;
}

export type ErpRentalContractStatus =
  | 'ATIVO'
  | 'EM_IMPLANTACAO'
  | 'RENOVACAO_PROXIMA'
  | 'ENCERRADO';

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

export interface ErpRentalContract {
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
  status: ErpRentalContractStatus;
  equipments: ErpRentalEquipmentItem[];
  remessaNfeNumber: string;
  remessaCfop: '5.908' | '6.908';
  legalBasisNote: string;
  lastBilledCompetence: string | null;
  createdAt: string;
  updatedAt: string;
}

export type ErpFiscalDocumentType =
  | 'FATURA_LOCACAO'
  | 'NFSE_SERVICO'
  | 'NFE_REMESSA_LOCACAO'
  | 'NFE_VENDA_PRODUTO'
  | 'NFCE_CONSUMIDOR'
  | 'NFCOM_TELECOM';

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
  erp?: ErpDatabaseState;
}
