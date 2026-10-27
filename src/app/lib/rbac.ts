// ============================================================================
// STI-hub — RBAC (Role-Based Access Control), MFA Auth, Custom Fields & Templates
// Portal HubSpot #4369067 + GestãoClick Loja Matriz #118887 (Seta Telecom LTDA)
// ============================================================================

export type StiHubRole =
  | 'SUPER_ADMIN'
  | 'SALES_MANAGER'
  | 'SALES_REP'
  | 'MARKETING_SPECIALIST'
  | 'ERP_FINANCE_FISCAL'
  | 'SUPPORT_NOC_OS'
  | 'PDV_STOCK_OPERATOR';

export interface CrmHubSpotPanelPermissions {
  portfolioScope: 'ALL' | 'TEAM' | 'OWN_ONLY';
  manageContacts: boolean;
  manageCompanies: boolean;
  manageDealsFunnel: boolean;
  manageTicketsServiceDesk: boolean;
  manageMarketingAndWorkflows: boolean;
  exportCrmData: boolean;
  mergeCrmDuplicates: boolean;
  deleteCrmRecords: boolean;
}

export interface RolePermissionsMatrix {
  role: StiHubRole;
  label: string;
  badgeColor: string;
  description: string;
  portfolioScope: 'ALL' | 'OWN_ONLY';
  maxDiscountPercent: number;
  enabledModules?: Array<'CRM' | 'ERP' | 'CHAMADOS'>;
  moduleAccess?: { crm: boolean; erp: boolean; chamados: boolean };
  crmPermissions?: CrmHubSpotPanelPermissions;
  modules: {
    OVERVIEW_AI: boolean;
    DEALS_KANBAN: boolean; // Sales Hub
    MARKETING_FORMS: boolean; // Marketing Hub
    CONTACTS_COMPANIES: boolean;
    SERVICE_DESK: boolean;
    ERP_GESTAOCLICK: boolean;
    DATA_HEALTH: boolean;
    AUTOMATIONS: boolean;
    ADMIN_SETTINGS: boolean;
  };
  erpPermissions: {
    viewBankBalances: boolean;
    editFinancialEntries: boolean;
    emitFiscalInvoices: boolean;
    editProposalsAndQuotes: boolean;
    manageContracts: boolean;
    operatePdvPos: boolean;
    manageStockAndPurchases: boolean;
    manageServiceOrders: boolean;
    deleteRecords: boolean;
  };
}

export const RBAC_ROLES_CATALOG: Record<StiHubRole, RolePermissionsMatrix> = {
  SUPER_ADMIN: {
    role: 'SUPER_ADMIN',
    label: 'Super Admin • Diretoria Seta Telecom',
    badgeColor: 'bg-emerald-500 text-slate-950',
    description:
      'Acesso total irrestrito a todos os módulos de ERP, CRM (Sales, Marketing, Service), Fiscal, Contas Bancárias, RBAC e Administração.',
    portfolioScope: 'ALL',
    maxDiscountPercent: 100,
    modules: {
      OVERVIEW_AI: true,
      DEALS_KANBAN: true,
      MARKETING_FORMS: true,
      CONTACTS_COMPANIES: true,
      SERVICE_DESK: true,
      ERP_GESTAOCLICK: true,
      DATA_HEALTH: true,
      AUTOMATIONS: true,
      ADMIN_SETTINGS: true,
    },
    erpPermissions: {
      viewBankBalances: true,
      editFinancialEntries: true,
      emitFiscalInvoices: true,
      editProposalsAndQuotes: true,
      manageContracts: true,
      operatePdvPos: true,
      manageStockAndPurchases: true,
      manageServiceOrders: true,
      deleteRecords: true,
    },
  },
  SALES_MANAGER: {
    role: 'SALES_MANAGER',
    label: 'Gestor(a) Comercial • Sales Hub Pro',
    badgeColor: 'bg-sky-500 text-white',
    description:
      'Acesso total ao Sales Hub (Deals, Pipelines, Forecast, Metas, Sequências), Contatos & Empresas, Orçamentos e Contratos; leitura em Financeiro; sem exclusão bancária.',
    portfolioScope: 'ALL',
    maxDiscountPercent: 25,
    modules: {
      OVERVIEW_AI: true,
      DEALS_KANBAN: true,
      MARKETING_FORMS: true,
      CONTACTS_COMPANIES: true,
      SERVICE_DESK: true,
      ERP_GESTAOCLICK: true,
      DATA_HEALTH: true,
      AUTOMATIONS: true,
      ADMIN_SETTINGS: false,
    },
    erpPermissions: {
      viewBankBalances: false,
      editFinancialEntries: false,
      emitFiscalInvoices: false,
      editProposalsAndQuotes: true,
      manageContracts: true,
      operatePdvPos: true,
      manageStockAndPurchases: false,
      manageServiceOrders: true,
      deleteRecords: false,
    },
  },
  SALES_REP: {
    role: 'SALES_REP',
    label: 'Executivo(a) de Contas B2B (Própria Carteira)',
    badgeColor: 'bg-blue-600 text-white',
    description:
      'Acesso ao Sales Hub, Contatos & Empresas e Orçamentos restrito à própria carteira; desconto máximo de 10% sem aprovação; sem acesso a Bancos/DRE.',
    portfolioScope: 'OWN_ONLY',
    maxDiscountPercent: 10,
    modules: {
      OVERVIEW_AI: true,
      DEALS_KANBAN: true,
      MARKETING_FORMS: false,
      CONTACTS_COMPANIES: true,
      SERVICE_DESK: false,
      ERP_GESTAOCLICK: true,
      DATA_HEALTH: false,
      AUTOMATIONS: true,
      ADMIN_SETTINGS: false,
    },
    erpPermissions: {
      viewBankBalances: false,
      editFinancialEntries: false,
      emitFiscalInvoices: false,
      editProposalsAndQuotes: true,
      manageContracts: false,
      operatePdvPos: true,
      manageStockAndPurchases: false,
      manageServiceOrders: false,
      deleteRecords: false,
    },
  },
  MARKETING_SPECIALIST: {
    role: 'MARKETING_SPECIALIST',
    label: 'Especialista Marketing Hub & Growth',
    badgeColor: 'bg-orange-500 text-white',
    description:
      'Acesso total ao Marketing Hub (Campanhas, E-mail Marketing, Web Forms, Landing Pages, Segmentos/Listas, Lead Scoring e Workflows) e Contatos.',
    portfolioScope: 'ALL',
    maxDiscountPercent: 0,
    modules: {
      OVERVIEW_AI: true,
      DEALS_KANBAN: false,
      MARKETING_FORMS: true,
      CONTACTS_COMPANIES: true,
      SERVICE_DESK: false,
      ERP_GESTAOCLICK: false,
      DATA_HEALTH: true,
      AUTOMATIONS: true,
      ADMIN_SETTINGS: false,
    },
    erpPermissions: {
      viewBankBalances: false,
      editFinancialEntries: false,
      emitFiscalInvoices: false,
      editProposalsAndQuotes: false,
      manageContracts: false,
      operatePdvPos: false,
      manageStockAndPurchases: false,
      manageServiceOrders: false,
      deleteRecords: false,
    },
  },
  ERP_FINANCE_FISCAL: {
    role: 'ERP_FINANCE_FISCAL',
    label: 'Analista Financeiro & Fiscal (ERP)',
    badgeColor: 'bg-teal-600 text-white',
    description:
      'Acesso total ao ERP Financeiro (Contas a Pagar/Receber, Bancos Inter/Itaú, Boletos, DRE), Contratos de Locação e Fiscal (LC 116/03 + SV 31 STF, NFS-e, NF-e).',
    portfolioScope: 'ALL',
    maxDiscountPercent: 15,
    modules: {
      OVERVIEW_AI: true,
      DEALS_KANBAN: false,
      MARKETING_FORMS: false,
      CONTACTS_COMPANIES: true,
      SERVICE_DESK: false,
      ERP_GESTAOCLICK: true,
      DATA_HEALTH: false,
      AUTOMATIONS: false,
      ADMIN_SETTINGS: false,
    },
    erpPermissions: {
      viewBankBalances: true,
      editFinancialEntries: true,
      emitFiscalInvoices: true,
      editProposalsAndQuotes: true,
      manageContracts: true,
      operatePdvPos: false,
      manageStockAndPurchases: true,
      manageServiceOrders: false,
      deleteRecords: true,
    },
  },
  SUPPORT_NOC_OS: {
    role: 'SUPPORT_NOC_OS',
    label: 'Engenharia NOC & Ordens de Serviço',
    badgeColor: 'bg-purple-600 text-white',
    description:
      'Acesso total ao Service Desk (Tickets/SLA 24x7), ERP Ordens de Serviço (1.378 O.S.) e consulta de Números de Série (S/N) no Estoque.',
    portfolioScope: 'ALL',
    maxDiscountPercent: 0,
    modules: {
      OVERVIEW_AI: true,
      DEALS_KANBAN: false,
      MARKETING_FORMS: false,
      CONTACTS_COMPANIES: true,
      SERVICE_DESK: true,
      ERP_GESTAOCLICK: true,
      DATA_HEALTH: false,
      AUTOMATIONS: false,
      ADMIN_SETTINGS: false,
    },
    erpPermissions: {
      viewBankBalances: false,
      editFinancialEntries: false,
      emitFiscalInvoices: false,
      editProposalsAndQuotes: false,
      manageContracts: false,
      operatePdvPos: false,
      manageStockAndPurchases: true,
      manageServiceOrders: true,
      deleteRecords: false,
    },
  },
  PDV_STOCK_OPERATOR: {
    role: 'PDV_STOCK_OPERATOR',
    label: 'Operador de PDV & Almoxarifado',
    badgeColor: 'bg-amber-600 text-white',
    description:
      'Acesso dedicado ao PDV (Venda Balcão / NFC-e), Catálogo de Itens, Movimentações de Estoque e Ordens de Compra; sem acesso a Bancos/DRE.',
    portfolioScope: 'OWN_ONLY',
    maxDiscountPercent: 5,
    modules: {
      OVERVIEW_AI: false,
      DEALS_KANBAN: false,
      MARKETING_FORMS: false,
      CONTACTS_COMPANIES: false,
      SERVICE_DESK: false,
      ERP_GESTAOCLICK: true,
      DATA_HEALTH: false,
      AUTOMATIONS: false,
      ADMIN_SETTINGS: false,
    },
    erpPermissions: {
      viewBankBalances: false,
      editFinancialEntries: false,
      emitFiscalInvoices: false,
      editProposalsAndQuotes: false,
      manageContracts: false,
      operatePdvPos: true,
      manageStockAndPurchases: true,
      manageServiceOrders: false,
      deleteRecords: false,
    },
  },
};

export interface StiHubUserAccount {
  id: string;
  name: string;
  email: string;
  role: StiHubRole;
  department: string;
  phone: string;
  hubspotOwnerId?: string;
  gestaoClickUserId?: string;
  enabledModules?: Array<'CRM' | 'ERP' | 'CHAMADOS'>;
  moduleAccess?: { crm: boolean; erp: boolean; chamados: boolean };
  totpSecret?: string;
  mfaEnabled: boolean;
  mfaMethod: 'TOTP_AUTHENTICATOR' | 'EMAIL_OTP';
  active: boolean;
  lastLoginAt?: string;
}

export const INITIAL_STIHUB_USERS: StiHubUserAccount[] = [
  {
    id: 'usr-marcelo',
    name: 'Marcelo Lopes Mira',
    email: 'marcelo@setatelecom.com.br',
    role: 'SUPER_ADMIN',
    department: 'Diretoria Executiva & Comercial',
    phone: '(11) 3958-4929',
    hubspotOwnerId: '31598215',
    gestaoClickUserId: '203922',
    mfaEnabled: true,
    mfaMethod: 'TOTP_AUTHENTICATOR',
    active: true,
    lastLoginAt: '2026-10-26T15:30:00.000Z',
  },
  {
    id: 'usr-evelyn',
    name: 'Evelyn Olivia de Rosa Ternero',
    email: 'evelyn@setatelecom.com.br',
    role: 'SALES_MANAGER',
    department: 'Gestão Comercial & Operações B2B',
    phone: '(11) 3958-4929',
    hubspotOwnerId: '77388429',
    gestaoClickUserId: '1062504',
    mfaEnabled: true,
    mfaMethod: 'TOTP_AUTHENTICATOR',
    active: true,
    lastLoginAt: '2026-10-26T14:10:00.000Z',
  },
  {
    id: 'usr-michelle',
    name: 'Michelle da Rocha',
    email: 'noc@setatelecom.com.br',
    role: 'SUPPORT_NOC_OS',
    department: 'Coordenação Técnica NOC & O.S.',
    phone: '(11) 3957-0498',
    hubspotOwnerId: '31635147',
    gestaoClickUserId: '206343',
    mfaEnabled: true,
    mfaMethod: 'TOTP_AUTHENTICATOR',
    active: true,
    lastLoginAt: '2026-10-26T13:45:00.000Z',
  },
  {
    id: 'usr-dauana',
    name: 'Dauana Magnavita de Alencar',
    email: 'financeiro@setatelecom.com.br',
    role: 'ERP_FINANCE_FISCAL',
    department: 'Financeiro, Contratos & Faturamento Fiscal',
    phone: '(11) 3958-4929',
    hubspotOwnerId: '1362597717',
    gestaoClickUserId: '1063375',
    mfaEnabled: true,
    mfaMethod: 'EMAIL_OTP',
    active: true,
    lastLoginAt: '2026-10-26T12:20:00.000Z',
  },
  {
    id: 'usr-wesley',
    name: 'Wesley Brito',
    email: 'pdv@setatelecom.com.br',
    role: 'PDV_STOCK_OPERATOR',
    department: 'Almoxarifado, S/N & PDV Balcão',
    phone: '(11) 3958-4929',
    gestaoClickUserId: '1026185',
    mfaEnabled: true,
    mfaMethod: 'TOTP_AUTHENTICATOR',
    active: true,
    lastLoginAt: '2026-10-26T11:05:00.000Z',
  },
  {
    id: 'usr-marketing',
    name: 'Karis & Inbound Marketing Seta',
    email: 'marketing@setatelecom.com.br',
    role: 'MARKETING_SPECIALIST',
    department: 'Marketing Hub, ABM & Geração de Demanda',
    phone: '(11) 3958-4929',
    hubspotOwnerId: '82216682',
    mfaEnabled: true,
    mfaMethod: 'EMAIL_OTP',
    active: true,
    lastLoginAt: '2026-10-26T10:15:00.000Z',
  },
  {
    id: 'usr-vendedor',
    name: 'Paula Campos (Executiva de Contas)',
    email: 'vendedor@setatelecom.com.br',
    role: 'SALES_REP',
    department: 'Vendas Consultivas Telecom',
    phone: '(11) 3958-4929',
    hubspotOwnerId: '91941475',
    gestaoClickUserId: '1349279',
    mfaEnabled: true,
    mfaMethod: 'TOTP_AUTHENTICATOR',
    active: true,
    lastLoginAt: '2026-10-26T09:50:00.000Z',
  },
];

// ============================================================================
// HUBSPOT PORTAL #4369067 + SETA TELECOM CUSTOM FIELDS CATALOG
// ============================================================================

export type CustomFieldObjectType =
  | 'CONTACT'
  | 'COMPANY'
  | 'DEAL'
  | 'TICKET'
  | 'PROPOSAL'
  | 'CONTRACT';

export type CustomFieldDataType =
  | 'TEXT'
  | 'NUMBER'
  | 'CURRENCY_BRL'
  | 'DATE'
  | 'ENUM_SELECT'
  | 'BOOLEAN'
  | 'CNPJ_CPF';

export interface CustomFieldDefinition {
  id: string;
  internalName: string;
  label: string;
  objectType: CustomFieldObjectType;
  groupName: string;
  dataType: CustomFieldDataType;
  options?: string[];
  required: boolean;
  hubspotSynced: boolean;
  gestaoClickSynced: boolean;
  description: string;
}

export const INITIAL_CUSTOM_FIELDS: CustomFieldDefinition[] = [
  // CONTACT PROPERTIES (HubSpot Portal #4369067)
  {
    id: 'cf-cont-buying-role',
    internalName: 'hs_buying_role',
    label: 'Papel no Processo de Compra (Buying Role)',
    objectType: 'CONTACT',
    groupName: 'Inteligência Comercial ABM',
    dataType: 'ENUM_SELECT',
    options: ['DECISOR', 'COMPRADOR_ECONOMICO', 'INFLUENCIADOR_TECNICO', 'CAMPEAO', 'BLOQUEADOR', 'OPERACIONAL'],
    required: false,
    hubspotSynced: true,
    gestaoClickSynced: false,
    description: 'Identifica o papel decisório do contato na conta B2B (sincronizado do HubSpot #4369067).',
  },
  {
    id: 'cf-cont-persona',
    internalName: 'hs_persona',
    label: 'Persona B2B Seta Telecom',
    objectType: 'CONTACT',
    groupName: 'Marketing Hub & Qualificação',
    dataType: 'ENUM_SELECT',
    options: ['Diretor de TI / CTO', 'Gestor de Telecom & Infra', 'CFO / Compras', 'Gerente de Operações'],
    required: false,
    hubspotSynced: true,
    gestaoClickSynced: false,
    description: 'Perfil de comprador para segmentação de campanhas no Marketing Hub.',
  },
  {
    id: 'cf-cont-unworked',
    internalName: 'hs_is_unworked',
    label: 'Lead Intocado (Sem 1º Contato)',
    objectType: 'CONTACT',
    groupName: 'SLA Comercial',
    dataType: 'BOOLEAN',
    required: false,
    hubspotSynced: true,
    gestaoClickSynced: false,
    description: 'Indica se o lead ainda não recebeu abordagem do executivo responsável.',
  },
  {
    id: 'cf-cont-score-v2',
    internalName: 'hs_predictivecontactscore_v2',
    label: 'Lead Score Preditivo (0 a 100)',
    objectType: 'CONTACT',
    groupName: 'Marketing Hub & Qualificação',
    dataType: 'NUMBER',
    required: false,
    hubspotSynced: true,
    gestaoClickSynced: false,
    description: 'Pontuação calculada por engajamento, cargo decisor e fit de ICP.',
  },

  // COMPANY PROPERTIES (HubSpot Portal #4369067 + GestãoClick #118887)
  {
    id: 'cf-comp-cnpj',
    internalName: 'cnpj',
    label: 'CNPJ / Documento Fiscal',
    objectType: 'COMPANY',
    groupName: 'Identificação Fiscal Brasil',
    dataType: 'CNPJ_CPF',
    required: true,
    hubspotSynced: true,
    gestaoClickSynced: true,
    description: 'CNPJ validado (Mod-11). Empresas com CNPJs distintos têm trava contra unificação.',
  },
  {
    id: 'cf-comp-ie',
    internalName: 'inscricao_estadual',
    label: 'Inscrição Estadual (IE)',
    objectType: 'COMPANY',
    groupName: 'Identificação Fiscal Brasil',
    dataType: 'TEXT',
    required: false,
    hubspotSynced: false,
    gestaoClickSynced: true,
    description: 'Inscrição Estadual para emissão de NF-e de Venda e NF-e de Remessa CFOP 5.908.',
  },
  {
    id: 'cf-comp-target-abm',
    internalName: 'hs_is_target_account',
    label: 'Conta Alvo ABM (Target Account)',
    objectType: 'COMPANY',
    groupName: 'Estratégia ABM Enterprise',
    dataType: 'BOOLEAN',
    required: false,
    hubspotSynced: true,
    gestaoClickSynced: false,
    description: 'Marca empresas prioritárias para prospecção executiva da Seta Telecom.',
  },
  {
    id: 'cf-comp-icp-tier',
    internalName: 'hs_ideal_customer_profile',
    label: 'Tier de Perfil de Cliente Ideal (ICP)',
    objectType: 'COMPANY',
    groupName: 'Estratégia ABM Enterprise',
    dataType: 'ENUM_SELECT',
    options: ['TIER_1', 'TIER_2', 'TIER_3'],
    required: false,
    hubspotSynced: true,
    gestaoClickSynced: false,
    description: 'Classificação de potencial de receita recorrente de locação B2B.',
  },
  {
    id: 'cf-comp-gc-id',
    internalName: 'gestaoclick_client_id',
    label: 'ID do Cliente no GestãoClick (#118887)',
    objectType: 'COMPANY',
    groupName: 'Integração ERP-GROK',
    dataType: 'TEXT',
    required: false,
    hubspotSynced: true,
    gestaoClickSynced: true,
    description: 'Chave externa de sincronização bidirecional com o ERP GestãoClick.',
  },

  // DEAL PROPERTIES (Sales Hub Portal #4369067)
  {
    id: 'cf-deal-type',
    internalName: 'dealtype',
    label: 'Modalidade de Negócio (Deal Type)',
    objectType: 'DEAL',
    groupName: 'Sales Hub & Receita',
    dataType: 'ENUM_SELECT',
    options: ['LOCACAO_RECORRENTE', 'NEW_BUSINESS', 'UPSELL_RENOVACAO'],
    required: true,
    hubspotSynced: true,
    gestaoClickSynced: true,
    description: 'Distingue locação pura de bens móveis (0% ISS) de venda ou serviços técnicos.',
  },
  {
    id: 'cf-deal-priority',
    internalName: 'hs_priority',
    label: 'Prioridade da Oportunidade',
    objectType: 'DEAL',
    groupName: 'Sales Hub & Receita',
    dataType: 'ENUM_SELECT',
    options: ['ALTA', 'MEDIA', 'BAIXA'],
    required: true,
    hubspotSynced: true,
    gestaoClickSynced: false,
    description: 'Prioridade comercial exibida no card do Kanban.',
  },
  {
    id: 'cf-deal-mrr',
    internalName: 'hs_mrr',
    label: 'Receita Recorrente Mensal (MRR Locação)',
    objectType: 'DEAL',
    groupName: 'Métricas Recorrentes Telecom',
    dataType: 'CURRENCY_BRL',
    required: false,
    hubspotSynced: true,
    gestaoClickSynced: true,
    description: 'Valor mensal recorrente do contrato de locação de equipamentos.',
  },
  {
    id: 'cf-deal-tcv',
    internalName: 'hs_tcv',
    label: 'Valor Total do Contrato (TCV)',
    objectType: 'DEAL',
    groupName: 'Métricas Recorrentes Telecom',
    dataType: 'CURRENCY_BRL',
    required: false,
    hubspotSynced: true,
    gestaoClickSynced: true,
    description: 'Soma total do contrato (MRR × Prazo em meses + Taxa de Setup).',
  },
  {
    id: 'cf-deal-won-reason',
    internalName: 'closed_won_reason',
    label: 'Motivo de Ganho (Closed Won Reason)',
    objectType: 'DEAL',
    groupName: 'Auditoria de Funil',
    dataType: 'TEXT',
    required: false,
    hubspotSynced: true,
    gestaoClickSynced: false,
    description: 'Justificativa comercial quando o negócio é ganho e convertido em contrato.',
  },
  {
    id: 'cf-deal-lost-reason',
    internalName: 'closed_lost_reason',
    label: 'Motivo de Perda (Closed Lost Reason)',
    objectType: 'DEAL',
    groupName: 'Auditoria de Funil',
    dataType: 'TEXT',
    required: false,
    hubspotSynced: true,
    gestaoClickSynced: false,
    description: 'Motivo registrado quando a oportunidade é perdida.',
  },

  // TICKET PROPERTIES (Service Hub Portal #4369067)
  {
    id: 'cf-tkt-priority',
    internalName: 'hs_ticket_priority',
    label: 'Severidade SLA do Chamado',
    objectType: 'TICKET',
    groupName: 'Service Hub & NOC 24x7',
    dataType: 'ENUM_SELECT',
    options: ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'],
    required: true,
    hubspotSynced: true,
    gestaoClickSynced: true,
    description: 'Define automaticamente o prazo de 1ª resposta e resolução no NOC.',
  },
  {
    id: 'cf-tkt-serial',
    internalName: 'equipment_serial_number',
    label: 'Número de Série (S/N) do Equipamento',
    objectType: 'TICKET',
    groupName: 'Rastreabilidade Patrimonial',
    dataType: 'TEXT',
    required: false,
    hubspotSynced: true,
    gestaoClickSynced: true,
    description: 'Vincula o chamado técnico ao equipamento físico locado no cliente.',
  },
  {
    id: 'cf-tkt-resolution',
    internalName: 'hs_resolution',
    label: 'Laudo Técnico de Resolução',
    objectType: 'TICKET',
    groupName: 'Service Hub & NOC 24x7',
    dataType: 'TEXT',
    required: false,
    hubspotSynced: true,
    gestaoClickSynced: true,
    description: 'Resumo técnico do reparo ou substituição realizada pela engenharia.',
  },

  // PROPOSAL & CONTRACT PROPERTIES (ERP GestãoClick)
  {
    id: 'cf-prop-channel',
    internalName: 'canal_venda_gc',
    label: 'Canal de Venda (GestãoClick)',
    objectType: 'PROPOSAL',
    groupName: 'Orçamentos GestãoClick',
    dataType: 'ENUM_SELECT',
    options: ['Cliente Recorrente', 'Prospecção Ativa B2B', 'Indicação Comercial', 'Licitação'],
    required: true,
    hubspotSynced: false,
    gestaoClickSynced: true,
    description: 'Canal de origem do orçamento comercial (#4695).',
  },
  {
    id: 'cf-ctr-cfop-remessa',
    internalName: 'remessa_cfop',
    label: 'CFOP da NF-e de Remessa em Locação',
    objectType: 'CONTRACT',
    groupName: 'Fiscal LC 116/03 + SV 31 STF',
    dataType: 'ENUM_SELECT',
    options: ['5.908', '6.908'],
    required: true,
    hubspotSynced: false,
    gestaoClickSynced: true,
    description: 'CFOP estadual (5.908) ou interestadual (6.908) de remessa de bem por contrato de locação.',
  },
];

// ============================================================================
// CRM & ERP EMAIL TEMPLATES CATALOG (EDITABLE IN ADMIN CENTER)
// ============================================================================

export interface EmailTemplateRecord {
  id: string;
  code: string;
  name: string;
  category: 'CRM_SALES' | 'CRM_MARKETING' | 'CRM_SERVICE' | 'ERP_PROPOSAL' | 'ERP_FINANCE_FISCAL';
  subjectTemplate: string;
  bodyTemplate: string;
  variables: string[];
  updatedAt: string;
}

export const INITIAL_EMAIL_TEMPLATES: EmailTemplateRecord[] = [
  {
    id: 'tpl-erp-proposta-pdf',
    code: 'ERP_PROPOSTA_PDF',
    name: 'Envio de Proposta Comercial / Orçamento com Link PDF A4',
    category: 'ERP_PROPOSAL',
    subjectTemplate: '[Seta Telecom] Proposta Comercial #{{proposta.numero}} — {{empresa.razao_social}}',
    bodyTemplate:
      'Olá, {{contato.nome}} ({{empresa.razao_social}}),\n\nSegue para sua avaliação e aprovação a nossa Proposta Comercial Nº #{{proposta.numero}}, elaborada pela SETA TELECOM LTDA (SETA | IT).\n\n• Valor Total: {{proposta.valor_total}}\n• Validade: {{proposta.validade}}\n• Enquadramento Fiscal: Dispensa legal de ISSQN em locação de bens móveis (LC 116/2003 e Súmula Vinculante 31 do STF).\n\n🔗 Link Oficial para Visualizar e Imprimir o PDF (A4):\n{{proposta.link_pdf}}\n\nAtenciosamente,\nMarcelo Lopes Mira — Diretoria Seta Telecom (11) 3958-4929',
    variables: ['{{contato.nome}}', '{{empresa.razao_social}}', '{{proposta.numero}}', '{{proposta.valor_total}}', '{{proposta.validade}}', '{{proposta.link_pdf}}'],
    updatedAt: '2026-10-26T15:00:00.000Z',
  },
  {
    id: 'tpl-erp-boleto-pix',
    code: 'ERP_BOLETO_PIX',
    name: 'Envio de Boleto Bancário (Inter / Itaú) + Código PIX Copia e Cola',
    category: 'ERP_FINANCE_FISCAL',
    subjectTemplate: '[Seta Telecom • Financeiro] Boleto & PIX #{{fatura.numero}} — Vencimento {{fatura.vencimento}}',
    bodyTemplate:
      'Olá, Departamento Financeiro ({{empresa.razao_social}} — CNPJ {{empresa.cnpj}}),\n\nEncaminhamos os dados para liquidação financeira referente ao documento #{{fatura.numero}}:\n\n• Valor: {{fatura.valor}}\n• Vencimento: {{fatura.vencimento}}\n• Linha Digitável do Boleto:\n{{boleto.linha_digitavel}}\n\n• PIX Copia e Cola:\n{{boleto.pix_copia_cola}}\n\nAtenciosamente,\nDepartamento Financeiro • SETA TELECOM LTDA (financeiro@setatelecom.com.br)',
    variables: ['{{empresa.razao_social}}', '{{empresa.cnpj}}', '{{fatura.numero}}', '{{fatura.valor}}', '{{fatura.vencimento}}', '{{boleto.linha_digitavel}}', '{{boleto.pix_copia_cola}}'],
    updatedAt: '2026-10-26T15:00:00.000Z',
  },
  {
    id: 'tpl-erp-recibo-locacao',
    code: 'ERP_RECIBO_LOCACAO_SV31',
    name: 'Fatura / Recibo de Locação de Equipamentos (0% ISS — LC 116/03 + SV 31 STF)',
    category: 'ERP_FINANCE_FISCAL',
    subjectTemplate: '[Seta Telecom] Fatura / Recibo de Locação #{{fatura.numero}} (Isento de ISS — SV 31 STF) — {{empresa.razao_social}}',
    bodyTemplate:
      'Prezado(a) {{contato.nome}} ({{empresa.razao_social}}),\n\nSegue a Fatura / Recibo de Locação de Bens Móveis Nº {{fatura.numero}} referente ao Contrato {{contrato.numero}}.\n\n• Valor Líquido: {{fatura.valor}}\n• Amparo Legal: Operação de Locação Pura de Bens Móveis (Art. 565 do Código Civil) — Não incidência de ISSQN conforme Veto ao item 3.01 da LC 116/2003 e Súmula Vinculante nº 31 do STF, vinculada à NF-e de Remessa CFOP 5.908.\n\nAtenciosamente,\nFaturamento & Contratos • SETA TELECOM LTDA',
    variables: ['{{contato.nome}}', '{{empresa.razao_social}}', '{{fatura.numero}}', '{{contrato.numero}}', '{{fatura.valor}}'],
    updatedAt: '2026-10-26T15:00:00.000Z',
  },
  {
    id: 'tpl-crm-sales-followup',
    code: 'CRM_SALES_FOLLOWUP',
    name: 'Sales Hub — Follow-up Executivo de Proposta B2B & Agendamento Técnico',
    category: 'CRM_SALES',
    subjectTemplate: 'Alinhamento Técnico & Comercial — Projeto Telecom {{empresa.razao_social}}',
    bodyTemplate:
      'Olá, {{contato.nome}},\n\nGostaria de confirmar se conseguiu avaliar o escopo de modernização de PABX IP / SD-WAN que desenhamos para a {{empresa.razao_social}}.\n\nPodemos agendar 15 minutos nesta terça ou quinta-feira para revisar os números e o cronograma de implantação sem impacto na sua operação?\n\nAgenda direta: https://sti-hub.vercel.app/reuniao/marcelo-mira\n\nUm abraço,\nMarcelo Lopes Mira • Seta Telecom',
    variables: ['{{contato.nome}}', '{{empresa.razao_social}}'],
    updatedAt: '2026-10-26T15:00:00.000Z',
  },
  {
    id: 'tpl-crm-service-sla',
    code: 'CRM_SERVICE_SLA_UPDATE',
    name: 'Service Hub — Resposta de Chamado NOC 24x7 & Atualização de O.S.',
    category: 'CRM_SERVICE',
    subjectTemplate: '[Seta Telecom • NOC 24x7] Atualização do Protocolo #{{chamado.protocolo}} — {{empresa.razao_social}}',
    bodyTemplate:
      'Olá, {{contato.nome}},\n\nNossa equipe de Engenharia NOC N2 atualizou o chamado #{{chamado.protocolo}} (O.S. GestãoClick vinculada):\n\n• Equipamento (S/N): {{chamado.serial}}\n• Status SLA: No Prazo (Atendimento Prioritário)\n• Parecer Técnico: {{chamado.resolucao}}\n\nAcompanhe em tempo real no Portal do Cliente: https://sti-hub.vercel.app/portal?ticket={{chamado.protocolo}}\n\nAtenciosamente,\nNOC 24x7 • SETA TELECOM LTDA',
    variables: ['{{contato.nome}}', '{{empresa.razao_social}}', '{{chamado.protocolo}}', '{{chamado.serial}}', '{{chamado.resolucao}}'],
    updatedAt: '2026-10-26T15:00:00.000Z',
  },
  {
    id: 'tpl-crm-mkt-abm',
    code: 'CRM_MKT_ABM_CAMPAIGN',
    name: 'Marketing Hub — Campanha ABM Redução de OPEX com Locação de Infraestrutura (0% ISS)',
    category: 'CRM_MARKETING',
    subjectTemplate: 'Como reduzir em até 28% o OPEX de TI e Telefonia IP na {{empresa.razao_social}}',
    bodyTemplate:
      'Olá, {{contato.nome}},\n\nEmpresas líderes como Nubank, TOTVS e RD Station substituíram a compra imobilizada (CAPEX) de switches, firewalls SD-WAN e centrais PABX IP pelo modelo de Locação Pura da Seta Telecom (100% dedutível e isento de ISS conforme Súmula Vinculante 31 do STF, com SLA 99,95% e substituição expressa de hardware).\n\nSolicite uma simulação tributária e técnica gratuita para a {{empresa.razao_social}}.\n\nEquipe de Growth • SETA TELECOM LTDA (SETA | IT)',
    variables: ['{{contato.nome}}', '{{empresa.razao_social}}'],
    updatedAt: '2026-10-26T15:00:00.000Z',
  },
];
