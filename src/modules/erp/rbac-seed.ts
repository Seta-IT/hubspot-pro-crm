import {
  buildDefaultCrmItemPermissions,
  buildDefaultErpItemPermissions,
  buildDefaultItemPermissionsForRole,
  CRM_MODULE_ITEMS_CATALOG,
  CRM_ROLES_CATALOG,
  CrmAccountRole,
  ERP_MODULE_ITEMS_CATALOG,
  ERP_ROLES_CATALOG,
  ErpAccountRole,
  inferCrmAndErpRolesFromLegacyRole,
  MODULE_ITEMS_CRUD_CATALOG,
  RBAC_ROLES_CATALOG,
} from '../../app/lib/rbac';
import {
  StiHubCrmPermissions,
  StiHubCustomPropertySpec,
  StiHubErpPermissions,
  StiHubMacroModule,
  StiHubModuleAccessLevel,
  StiHubRbacState,
  StiHubRoleDefinition,
  StiHubRoleId,
  StiHubSecurityAuditLogEntry,
  StiHubUserModuleAccess,
  StiHubUserRecord,
  StiHubVisibilityScope,
} from '../../db/types';
import { generateTotpSecretBase32, sha256Hex } from '../../app/lib/auth';

export function buildDefaultModuleAccessForRole(
  roleId: StiHubRoleId,
  userEmail?: string
): {
  enabledModules: StiHubMacroModule[];
  moduleAccess: StiHubUserModuleAccess;
} {
  const email = String(userEmail || "").toLowerCase().trim();
  if (email === "henrique.noc@setatelecom.com.br") {
    return {
      enabledModules: ["CHAMADOS"],
      moduleAccess: { crm: false, erp: false, chamados: true },
    };
  }
  switch (roleId) {
    case "SUPER_ADMIN":
    case "DIRETORIA":
    case "GERENTE_COMERCIAL":
      return {
        enabledModules: ["CRM", "ERP", "CHAMADOS"],
        moduleAccess: { crm: true, erp: true, chamados: true },
      };
    case "VENDEDOR_SALES":
      return {
        enabledModules: ["CRM", "ERP"],
        moduleAccess: { crm: true, erp: true, chamados: false },
      };
    case "ANALISTA_MARKETING":
      return {
        enabledModules: ["CRM"],
        moduleAccess: { crm: true, erp: false, chamados: false },
      };
    case "FINANCEIRO_FATURAMENTO":
    case "FISCAL_CONTABIL":
    case "OPERADOR_PDV_ESTOQUE":
      return {
        enabledModules: ["ERP"],
        moduleAccess: { crm: false, erp: true, chamados: false },
      };
    case "TECNICO_NOC_OS":
      return {
        enabledModules: ["CHAMADOS", "ERP"],
        moduleAccess: { crm: false, erp: true, chamados: true },
      };
    default:
      return {
        enabledModules: ["CRM", "ERP", "CHAMADOS"],
        moduleAccess: { crm: true, erp: true, chamados: true },
      };
  }
}

export function normalizeUserModuleAccess(input: {
  enabledModules?: StiHubMacroModule[];
  moduleAccess?: Partial<StiHubUserModuleAccess>;
  roleId?: StiHubRoleId;
  email?: string;
}): {
  enabledModules: StiHubMacroModule[];
  moduleAccess: StiHubUserModuleAccess;
} {
  if (input.moduleAccess && typeof input.moduleAccess === "object") {
    const crm = Boolean(input.moduleAccess.crm);
    const erp = Boolean(input.moduleAccess.erp);
    const chamados = Boolean(input.moduleAccess.chamados);
    const enabledModules: StiHubMacroModule[] = [];
    if (crm) enabledModules.push("CRM");
    if (erp) enabledModules.push("ERP");
    if (chamados) enabledModules.push("CHAMADOS");
    if (enabledModules.length > 0) {
      return { enabledModules, moduleAccess: { crm, erp, chamados } };
    }
  }
  if (Array.isArray(input.enabledModules) && input.enabledModules.length > 0) {
    const valid = input.enabledModules.filter(
      (m): m is StiHubMacroModule => m === "CRM" || m === "ERP" || m === "CHAMADOS"
    );
    if (valid.length > 0) {
      return {
        enabledModules: Array.from(new Set(valid)),
        moduleAccess: {
          crm: valid.includes("CRM"),
          erp: valid.includes("ERP"),
          chamados: valid.includes("CHAMADOS"),
        },
      };
    }
  }
  return buildDefaultModuleAccessForRole(input.roleId || "VENDEDOR_SALES", input.email);
}

export function buildDefaultCrmPermissionsForRole(
  roleId: StiHubRoleId,
  scopeOverride?: StiHubVisibilityScope
): StiHubCrmPermissions {
  switch (roleId) {
    case "SUPER_ADMIN":
    case "DIRETORIA":
      return {
        crmRole: roleId,
        portfolioScope: scopeOverride || "TODOS",
        contactsAccess: "FULL",
        companiesAccess: "FULL",
        dealsFunnelAccess: "FULL",
        ticketsServiceDeskAccess: "FULL",
        marketingAutomationAccess: "FULL",
        canExportCrmData: true,
        canMergeCrmRecords: true,
        canDeleteCrmRecords: true,
      };
    case "GERENTE_COMERCIAL":
      return {
        crmRole: "GERENTE_COMERCIAL",
        portfolioScope: scopeOverride || "TODOS",
        contactsAccess: "FULL",
        companiesAccess: "FULL",
        dealsFunnelAccess: "FULL",
        ticketsServiceDeskAccess: "EDIT",
        marketingAutomationAccess: "FULL",
        canExportCrmData: true,
        canMergeCrmRecords: true,
        canDeleteCrmRecords: false,
      };
    case "VENDEDOR_SALES":
      return {
        crmRole: "VENDEDOR_SALES",
        portfolioScope: scopeOverride || "PROPRIOS",
        contactsAccess: "EDIT",
        companiesAccess: "EDIT",
        dealsFunnelAccess: "EDIT",
        ticketsServiceDeskAccess: "VIEW",
        marketingAutomationAccess: "VIEW",
        canExportCrmData: false,
        canMergeCrmRecords: false,
        canDeleteCrmRecords: false,
      };
    case "ANALISTA_MARKETING":
      return {
        crmRole: "ANALISTA_MARKETING",
        portfolioScope: scopeOverride || "EQUIPE",
        contactsAccess: "EDIT",
        companiesAccess: "EDIT",
        dealsFunnelAccess: "VIEW",
        ticketsServiceDeskAccess: "VIEW",
        marketingAutomationAccess: "FULL",
        canExportCrmData: true,
        canMergeCrmRecords: true,
        canDeleteCrmRecords: false,
      };
    case "TECNICO_NOC_OS":
      return {
        crmRole: "TECNICO_NOC_OS",
        portfolioScope: scopeOverride || "EQUIPE",
        contactsAccess: "VIEW",
        companiesAccess: "VIEW",
        dealsFunnelAccess: "NONE",
        ticketsServiceDeskAccess: "FULL",
        marketingAutomationAccess: "NONE",
        canExportCrmData: false,
        canMergeCrmRecords: false,
        canDeleteCrmRecords: false,
      };
    default:
      return {
        crmRole: roleId,
        portfolioScope: scopeOverride || "PROPRIOS",
        contactsAccess: "VIEW",
        companiesAccess: "VIEW",
        dealsFunnelAccess: "NONE",
        ticketsServiceDeskAccess: "NONE",
        marketingAutomationAccess: "NONE",
        canExportCrmData: false,
        canMergeCrmRecords: false,
        canDeleteCrmRecords: false,
      };
  }
}

export function buildDefaultErpPermissionsForRole(roleId: StiHubRoleId): StiHubErpPermissions {
  switch (roleId) {
    case "SUPER_ADMIN":
    case "DIRETORIA":
      return {
        erpRole: roleId,
        financeBanksAccess: "FULL",
        fiscalIssuanceAccess: "FULL",
        proposalsQuotesAccess: "FULL",
        stockOsSalesAccess: "FULL",
        rentalContractsAccess: "FULL",
        maxDiscountPercent: 100,
        canViewBankBalances: true,
        canIssueFiscalDocuments: true,
        canApproveProposals: true,
        canDeleteErpRecords: true,
      };
    case "GERENTE_COMERCIAL":
      return {
        erpRole: "GERENTE_COMERCIAL",
        financeBanksAccess: "VIEW",
        fiscalIssuanceAccess: "VIEW",
        proposalsQuotesAccess: "FULL",
        stockOsSalesAccess: "EDIT",
        rentalContractsAccess: "FULL",
        maxDiscountPercent: 25,
        canViewBankBalances: false,
        canIssueFiscalDocuments: false,
        canApproveProposals: true,
        canDeleteErpRecords: false,
      };
    case "VENDEDOR_SALES":
      return {
        erpRole: "VENDEDOR_SALES",
        financeBanksAccess: "NONE",
        fiscalIssuanceAccess: "NONE",
        proposalsQuotesAccess: "EDIT",
        stockOsSalesAccess: "VIEW",
        rentalContractsAccess: "VIEW",
        maxDiscountPercent: 10,
        canViewBankBalances: false,
        canIssueFiscalDocuments: false,
        canApproveProposals: false,
        canDeleteErpRecords: false,
      };
    case "FINANCEIRO_FATURAMENTO":
      return {
        erpRole: "FINANCEIRO_FATURAMENTO",
        financeBanksAccess: "FULL",
        fiscalIssuanceAccess: "FULL",
        proposalsQuotesAccess: "EDIT",
        stockOsSalesAccess: "VIEW",
        rentalContractsAccess: "FULL",
        maxDiscountPercent: 15,
        canViewBankBalances: true,
        canIssueFiscalDocuments: true,
        canApproveProposals: true,
        canDeleteErpRecords: false,
      };
    case "FISCAL_CONTABIL":
      return {
        erpRole: "FISCAL_CONTABIL",
        financeBanksAccess: "VIEW",
        fiscalIssuanceAccess: "FULL",
        proposalsQuotesAccess: "VIEW",
        stockOsSalesAccess: "VIEW",
        rentalContractsAccess: "EDIT",
        maxDiscountPercent: 0,
        canViewBankBalances: true,
        canIssueFiscalDocuments: true,
        canApproveProposals: false,
        canDeleteErpRecords: false,
      };
    case "TECNICO_NOC_OS":
      return {
        erpRole: "TECNICO_NOC_OS",
        financeBanksAccess: "NONE",
        fiscalIssuanceAccess: "NONE",
        proposalsQuotesAccess: "NONE",
        stockOsSalesAccess: "FULL",
        rentalContractsAccess: "EDIT",
        maxDiscountPercent: 0,
        canViewBankBalances: false,
        canIssueFiscalDocuments: false,
        canApproveProposals: false,
        canDeleteErpRecords: false,
      };
    case "GERENCIA_ESTOQUE":
    case "STOCK_MANAGER":
      return {
        erpRole: "STOCK_MANAGER",
        financeBanksAccess: "NONE",
        fiscalIssuanceAccess: "EDIT",
        proposalsQuotesAccess: "VIEW",
        stockOsSalesAccess: "FULL",
        rentalContractsAccess: "VIEW",
        maxDiscountPercent: 15,
        canViewBankBalances: false,
        canIssueFiscalDocuments: true,
        canApproveProposals: false,
        canDeleteErpRecords: true,
      };
    case "OPERADOR_PDV_ESTOQUE":
      return {
        erpRole: "OPERADOR_PDV_ESTOQUE",
        financeBanksAccess: "NONE",
        fiscalIssuanceAccess: "EDIT",
        proposalsQuotesAccess: "NONE",
        stockOsSalesAccess: "FULL",
        rentalContractsAccess: "NONE",
        maxDiscountPercent: 5,
        canViewBankBalances: false,
        canIssueFiscalDocuments: true,
        canApproveProposals: false,
        canDeleteErpRecords: false,
      };
    default:
      return {
        erpRole: roleId,
        financeBanksAccess: "NONE",
        fiscalIssuanceAccess: "NONE",
        proposalsQuotesAccess: "VIEW",
        stockOsSalesAccess: "NONE",
        rentalContractsAccess: "NONE",
        maxDiscountPercent: 0,
        canViewBankBalances: false,
        canIssueFiscalDocuments: false,
        canApproveProposals: false,
        canDeleteErpRecords: false,
      };
  }
}

export const STI_HUB_MODULES_LIST: Array<{
  key: string;
  label: string;
  group: 'CRM' | 'ERP';
}> = [
  { key: 'CRM_OVERVIEW_AI', label: 'CRM • Visão Geral & Copiloto IA', group: 'CRM' },
  { key: 'CRM_SALES_HUB', label: 'CRM • Sales Hub (Funil, Deals, Contatos & Tarefas)', group: 'CRM' },
  { key: 'CRM_MARKETING_HUB', label: 'CRM • Marketing Hub (Forms, Cadências & Workflows)', group: 'CRM' },
  { key: 'CRM_SERVICE_HUB', label: 'CRM • Service Hub (Tickets JSM, SLA & Portal)', group: 'CRM' },
  { key: 'CRM_DATA_HEALTH', label: 'CRM • Data Health & Trava Fiscal CNPJ', group: 'CRM' },
  { key: 'ERP_INICIO', label: 'ERP • Início & Dashboard GestãoClick', group: 'ERP' },
  { key: 'ERP_CADASTROS', label: 'ERP • Pilar 1: Cadastros (Clientes, Fornecedores, RH)', group: 'ERP' },
  { key: 'ERP_ITENS', label: 'ERP • Pilar 2: Produtos (786) & Serviços (39)', group: 'ERP' },
  { key: 'ERP_ORCAMENTOS', label: 'ERP • Pilar 3: Propostas (#4695) & Link PDF A4', group: 'ERP' },
  { key: 'ERP_VENDAS', label: 'ERP • Pilar 3: Pedidos de Venda & Faturamento', group: 'ERP' },
  { key: 'ERP_ESTOQUE', label: 'ERP • Pilar 4: Estoque, S/N & Compras', group: 'ERP' },
  { key: 'ERP_CONTRATOS', label: 'ERP • Pilar 5: Contratos de Locação (344) & RMA', group: 'ERP' },
  { key: 'ERP_FINANCEIRO', label: 'ERP • Pilar 6: Financeiro, Bancos Inter/Itaú & DRE', group: 'ERP' },
  { key: 'ERP_FISCAL', label: 'ERP • Pilar 7: Fiscal (0% ISS SV 31 STF, NFS-e, NF-e 5.908)', group: 'ERP' },
  { key: 'ERP_ORDENS_SERVICOS', label: 'ERP • Pilar 8: Ordens de Serviço (1.378 O.S.)', group: 'ERP' },
  { key: 'ERP_CONFIGURACOES', label: 'ERP • Pilar 10: Configurações, RBAC & Integrações', group: 'ERP' },
];

function buildModuleMap(
  defaultLevel: StiHubModuleAccessLevel,
  overrides: Record<string, StiHubModuleAccessLevel> = {}
): Record<string, StiHubModuleAccessLevel> {
  const map: Record<string, StiHubModuleAccessLevel> = {};
  for (const mod of STI_HUB_MODULES_LIST) {
    map[mod.key] = overrides[mod.key] ?? defaultLevel;
  }
  return map;
}

export function createSeedRbacState(): StiHubRbacState {
  const nowIso = new Date().toISOString();

  const roles: StiHubRoleDefinition[] = [
    {
      id: 'SUPER_ADMIN',
      name: 'Super Admin STI-hub (Diretoria Executiva)',
      description:
        'Acesso total e irrestrito a todos os módulos do CRM (Sales, Marketing, Service, Data Health) e aos 10 Pilares do SETA ERP, incluindo configurações de segurança, MFA e RBAC.',
      hubCategory: 'GLOBAL_DIRETORIA',
      defaultScope: 'TODOS',
      modulePermissions: buildModuleMap('FULL'),
      actionGuards: {
        canViewFinancialBalances: true,
        canIssueFiscalDocuments: true,
        canApproveProposals: true,
        canMergeRecords: true,
        canDeleteRecords: true,
        canExportData: true,
        canManageUsersRbac: true,
      },
      updatedAt: nowIso,
    },
    {
      id: 'DIRETORIA',
      name: 'Diretoria Corporativa & Sócios Seta Telecom',
      description:
        'Visão executiva completa de todos os indicadores financeiros, DRE, Contratos, Fiscal, Funil Comercial e Copiloto IA com alçada de aprovação.',
      hubCategory: 'GLOBAL_DIRETORIA',
      defaultScope: 'TODOS',
      modulePermissions: buildModuleMap('FULL'),
      actionGuards: {
        canViewFinancialBalances: true,
        canIssueFiscalDocuments: true,
        canApproveProposals: true,
        canMergeRecords: true,
        canDeleteRecords: true,
        canExportData: true,
        canManageUsersRbac: true,
      },
      updatedAt: nowIso,
    },
    {
      id: 'GERENTE_COMERCIAL',
      name: 'Gerente Comercial & Revenue Operations',
      description:
        'Gestão completa da equipe comercial (Sales Hub + Propostas ERP + Contratos), aprovação de descontos e propostas, higienização da base e relatórios de forecast.',
      hubCategory: 'CRM_SALES',
      defaultScope: 'TODOS',
      modulePermissions: buildModuleMap('EDIT', {
        CRM_OVERVIEW_AI: 'FULL',
        CRM_SALES_HUB: 'FULL',
        CRM_MARKETING_HUB: 'FULL',
        CRM_DATA_HEALTH: 'FULL',
        ERP_CADASTROS: 'FULL',
        ERP_ORCAMENTOS: 'FULL',
        ERP_VENDAS: 'FULL',
        ERP_CONTRATOS: 'FULL',
        ERP_FINANCEIRO: 'VIEW',
        ERP_FISCAL: 'VIEW',
        ERP_CONFIGURACOES: 'VIEW',
      }),
      actionGuards: {
        canViewFinancialBalances: false,
        canIssueFiscalDocuments: false,
        canApproveProposals: true,
        canMergeRecords: true,
        canDeleteRecords: false,
        canExportData: true,
        canManageUsersRbac: false,
      },
      updatedAt: nowIso,
    },
    {
      id: 'VENDEDOR_SALES',
      name: 'Executivo de Contas B2B (Sales Hub & Propostas)',
      description:
        'Atuação focada em prospecção, gestão da própria carteira de Contatos/Empresas/Deals, elaboração de Orçamentos (#4695) e envio de link PDF A4 ao cliente.',
      hubCategory: 'CRM_SALES',
      defaultScope: 'PROPRIOS',
      modulePermissions: buildModuleMap('VIEW', {
        CRM_OVERVIEW_AI: 'VIEW',
        CRM_SALES_HUB: 'EDIT',
        CRM_MARKETING_HUB: 'VIEW',
        CRM_SERVICE_HUB: 'VIEW',
        CRM_DATA_HEALTH: 'NONE',
        ERP_INICIO: 'VIEW',
        ERP_CADASTROS: 'EDIT',
        ERP_ITENS: 'VIEW',
        ERP_ORCAMENTOS: 'EDIT',
        ERP_VENDAS: 'EDIT',
        ERP_CONTRATOS: 'VIEW',
        ERP_FINANCEIRO: 'NONE',
        ERP_FISCAL: 'NONE',
        ERP_CONFIGURACOES: 'NONE',
      }),
      actionGuards: {
        canViewFinancialBalances: false,
        canIssueFiscalDocuments: false,
        canApproveProposals: false,
        canMergeRecords: false,
        canDeleteRecords: false,
        canExportData: false,
        canManageUsersRbac: false,
      },
      updatedAt: nowIso,
    },
    {
      id: 'ANALISTA_MARKETING',
      name: 'Analista de Marketing Hub, SDR & Growth ABM',
      description:
        'Gestão de Formulários Web, Cadências de E-mail (Sequences), Workflows de Automação, Enriquecimento de Leads Inbound e qualificação MQL/SQL.',
      hubCategory: 'CRM_MARKETING',
      defaultScope: 'EQUIPE',
      modulePermissions: buildModuleMap('NONE', {
        CRM_OVERVIEW_AI: 'VIEW',
        CRM_SALES_HUB: 'EDIT',
        CRM_MARKETING_HUB: 'FULL',
        CRM_SERVICE_HUB: 'VIEW',
        CRM_DATA_HEALTH: 'EDIT',
        ERP_CADASTROS: 'VIEW',
        ERP_ITENS: 'VIEW',
        ERP_ORCAMENTOS: 'VIEW',
      }),
      actionGuards: {
        canViewFinancialBalances: false,
        canIssueFiscalDocuments: false,
        canApproveProposals: false,
        canMergeRecords: true,
        canDeleteRecords: false,
        canExportData: true,
        canManageUsersRbac: false,
      },
      updatedAt: nowIso,
    },
    {
      id: 'FINANCEIRO_FATURAMENTO',
      name: 'Gestor Financeiro, Faturamento & Cobrança',
      description:
        'Controle das 9 contas bancárias (Inter, Itaú, Conta Integrada), Contas a Pagar e Receber, conciliação de Boletos/PIX, Fluxo de Caixa, DRE e faturamento mensal de Contratos.',
      hubCategory: 'ERP_FINANCEIRO_FISCAL',
      defaultScope: 'TODOS',
      modulePermissions: buildModuleMap('VIEW', {
        ERP_INICIO: 'FULL',
        ERP_CADASTROS: 'EDIT',
        ERP_ORCAMENTOS: 'EDIT',
        ERP_VENDAS: 'EDIT',
        ERP_CONTRATOS: 'FULL',
        ERP_FINANCEIRO: 'FULL',
        ERP_FISCAL: 'FULL',
        ERP_ESTOQUE: 'VIEW',
      }),
      actionGuards: {
        canViewFinancialBalances: true,
        canIssueFiscalDocuments: true,
        canApproveProposals: true,
        canMergeRecords: false,
        canDeleteRecords: false,
        canExportData: true,
        canManageUsersRbac: false,
      },
      updatedAt: nowIso,
    },
    {
      id: 'FISCAL_CONTABIL',
      name: 'Especialista Fiscal & Tributário (LC 116 / SV 31 STF)',
      description:
        'Emissão e auditoria de Faturas de Locação (0% ISS — Súmula Vinculante 31 STF), NFS-e de Serviços (IRRF 1,5% + CSRF 4,65%), NF-e de Remessa CFOP 5.908 e NFC-e.',
      hubCategory: 'ERP_FINANCEIRO_FISCAL',
      defaultScope: 'TODOS',
      modulePermissions: buildModuleMap('VIEW', {
        CRM_DATA_HEALTH: 'VIEW',
        ERP_CADASTROS: 'EDIT',
        ERP_ITENS: 'EDIT',
        ERP_CONTRATOS: 'EDIT',
        ERP_FINANCEIRO: 'VIEW',
        ERP_FISCAL: 'FULL',
      }),
      actionGuards: {
        canViewFinancialBalances: true,
        canIssueFiscalDocuments: true,
        canApproveProposals: false,
        canMergeRecords: false,
        canDeleteRecords: false,
        canExportData: true,
        canManageUsersRbac: false,
      },
      updatedAt: nowIso,
    },
    {
      id: 'TECNICO_NOC_OS',
      name: 'Engenharia Telecom, NOC 24x7 & Ordens de Serviço',
      description:
        'Atendimento de chamados críticos no Service Desk (JSM Filas N1/N2/N3), cumprimento de SLA, execução de Ordens de Serviço (O.S.) e controle de RMA / Serial Number (S/N).',
      hubCategory: 'ERP_NOC_OPERACOES',
      defaultScope: 'EQUIPE',
      modulePermissions: buildModuleMap('NONE', {
        CRM_OVERVIEW_AI: 'VIEW',
        CRM_SERVICE_HUB: 'FULL',
        CRM_SALES_HUB: 'VIEW',
        ERP_CADASTROS: 'VIEW',
        ERP_ITENS: 'VIEW',
        ERP_ESTOQUE: 'EDIT',
        ERP_CONTRATOS: 'EDIT',
        ERP_ORDENS_SERVICOS: 'FULL',
      }),
      actionGuards: {
        canViewFinancialBalances: false,
        canIssueFiscalDocuments: false,
        canApproveProposals: false,
        canMergeRecords: false,
        canDeleteRecords: false,
        canExportData: false,
        canManageUsersRbac: false,
      },
      updatedAt: nowIso,
    },
    {
      id: 'OPERADOR_PDV_ESTOQUE',
      name: 'Operador de Almoxarifado, Estoque & Expedição S/N',
      description:
        'Gestão de estoque, expedição de equipamentos telecom, controle patrimonial por Número de Série (S/N) e ordens de compra.',
      hubCategory: 'ERP_NOC_OPERACOES',
      defaultScope: 'EQUIPE',
      modulePermissions: buildModuleMap('NONE', {
        ERP_CADASTROS: 'VIEW',
        ERP_ITENS: 'EDIT',
        ERP_VENDAS: 'FULL',
        ERP_ESTOQUE: 'FULL',
        ERP_ORDENS_SERVICOS: 'VIEW',
      }),
      actionGuards: {
        canViewFinancialBalances: false,
        canIssueFiscalDocuments: true,
        canApproveProposals: false,
        canMergeRecords: false,
        canDeleteRecords: false,
        canExportData: false,
        canManageUsersRbac: false,
      },
      updatedAt: nowIso,
    },
  ];

  // 22 Seta Telecom Users (6 Active Core GestãoClick/HubSpot + 16 Specialized/Historical Staff)
  const users: StiHubUserRecord[] = [
    {
      id: 'usr-seta-01',
      gestaoClickId: '203922',
      hubspotOwnerId: 'owner-marcello',
      name: 'Marcelo Lopes Mira',
      email: 'marcelo.mira@setatelecom.com.br',
      phone: '(11) 3958-4929',
      department: 'Diretoria Executiva & TI',
      jobTitle: 'CEO & Diretor Executivo (Super Admin)',
      roleId: 'SUPER_ADMIN',
      scope: 'TODOS',
      active: true,
      mfaEnabled: true,
      mfaMethod: 'TOTP_AUTHENTICATOR',
      lastLoginAt: nowIso,
      createdAt: '2024-01-10T10:00:00.000Z',
      updatedAt: nowIso,
    },
    {
      id: 'usr-seta-02',
      gestaoClickId: '1062504',
      hubspotOwnerId: 'owner-evelyn',
      name: 'Evelyn Olivia de Rosa Ternero',
      email: 'evelyn@setatelecom.com.br',
      phone: '(11) 3958-4929',
      department: 'Diretoria & Gestão Comercial',
      jobTitle: 'Gerente Comercial & Operações B2B',
      roleId: 'GERENTE_COMERCIAL',
      scope: 'TODOS',
      active: true,
      mfaEnabled: true,
      mfaMethod: 'TOTP_AUTHENTICATOR',
      lastLoginAt: nowIso,
      createdAt: '2024-02-15T10:00:00.000Z',
      updatedAt: nowIso,
    },
    {
      id: 'usr-seta-03',
      gestaoClickId: '1084110',
      hubspotOwnerId: 'owner-marialuiza',
      name: 'Maria Luiza',
      email: 'marialuiza@setatelecom.com.br',
      phone: '(11) 3958-4929',
      department: 'Comercial B2B & Locação',
      jobTitle: 'Executiva de Contas Enterprise (Sales Hub)',
      roleId: 'VENDEDOR_SALES',
      scope: 'PROPRIOS',
      active: true,
      mfaEnabled: true,
      mfaMethod: 'TOTP_AUTHENTICATOR',
      lastLoginAt: nowIso,
      createdAt: '2024-03-01T10:00:00.000Z',
      updatedAt: nowIso,
    },
    {
      id: 'usr-seta-04',
      gestaoClickId: '206343',
      hubspotOwnerId: 'owner-michelle',
      name: 'Michelle da Rocha',
      email: 'michelle.rocha@setatelecom.com.br',
      phone: '(11) 3957-0498',
      department: 'Financeiro, Contratos & Fiscal',
      jobTitle: 'Coordenadora Financeira & Faturamento',
      roleId: 'FINANCEIRO_FATURAMENTO',
      scope: 'TODOS',
      active: true,
      mfaEnabled: true,
      mfaMethod: 'TOTP_AUTHENTICATOR',
      lastLoginAt: nowIso,
      createdAt: '2024-01-20T10:00:00.000Z',
      updatedAt: nowIso,
    },
    {
      id: 'usr-seta-05',
      gestaoClickId: '310901',
      hubspotOwnerId: 'owner-noc-n2',
      name: 'Carlos Eduardo Martins',
      email: 'carlos.noc@setatelecom.com.br',
      phone: '(11) 98821-4010',
      department: 'Engenharia Telecom & NOC 24x7',
      jobTitle: 'Engenheiro Telecom Sênior (NOC N2/N3)',
      roleId: 'TECNICO_NOC_OS',
      scope: 'EQUIPE',
      active: true,
      mfaEnabled: true,
      mfaMethod: 'TOTP_AUTHENTICATOR',
      lastLoginAt: nowIso,
      createdAt: '2024-04-12T10:00:00.000Z',
      updatedAt: nowIso,
    },
    {
      id: 'usr-seta-06',
      gestaoClickId: '310902',
      hubspotOwnerId: 'owner-fiscal',
      name: 'Beatriz Nogueira',
      email: 'fiscal@setatelecom.com.br',
      phone: '(11) 3958-4930',
      department: 'Fiscal & Contábil',
      jobTitle: 'Especialista Tributária (LC 116 / SV 31 STF)',
      roleId: 'FISCAL_CONTABIL',
      scope: 'TODOS',
      active: true,
      mfaEnabled: true,
      mfaMethod: 'EMAIL_OTP',
      lastLoginAt: nowIso,
      createdAt: '2024-05-02T10:00:00.000Z',
      updatedAt: nowIso,
    },
    {
      id: 'usr-seta-07',
      gestaoClickId: '310903',
      name: 'Lucas Ferreira',
      email: 'pdv.matriz@setatelecom.com.br',
      phone: '(11) 3958-4931',
      department: 'Operações & Frente de Caixa',
      jobTitle: 'Operador de Almoxarifado & Expedição S/N',
      roleId: 'OPERADOR_PDV_ESTOQUE',
      scope: 'EQUIPE',
      active: true,
      mfaEnabled: true,
      mfaMethod: 'EMAIL_OTP',
      lastLoginAt: nowIso,
      createdAt: '2024-06-15T10:00:00.000Z',
      updatedAt: nowIso,
    },
    {
      id: 'usr-seta-08',
      gestaoClickId: '310904',
      name: 'Amanda Ribeiro',
      email: 'marketing@setatelecom.com.br',
      phone: '(11) 97712-3390',
      department: 'Marketing Hub & Inbound ABM',
      jobTitle: 'Analista de Growth, Forms & Automação',
      roleId: 'ANALISTA_MARKETING',
      scope: 'EQUIPE',
      active: true,
      mfaEnabled: true,
      mfaMethod: 'TOTP_AUTHENTICATOR',
      lastLoginAt: nowIso,
      createdAt: '2024-07-01T10:00:00.000Z',
      updatedAt: nowIso,
    },
    {
      id: 'usr-seta-09',
      gestaoClickId: '310905',
      name: 'Rafael Souza',
      email: 'rafael.campo@setatelecom.com.br',
      phone: '(11) 96543-1122',
      department: 'Field Service & Instalações',
      jobTitle: 'Técnico de Campo PABX IP & Cabeamento (O.S.)',
      roleId: 'TECNICO_NOC_OS',
      scope: 'PROPRIOS',
      active: true,
      mfaEnabled: true,
      mfaMethod: 'EMAIL_OTP',
      lastLoginAt: nowIso,
      createdAt: '2024-08-10T10:00:00.000Z',
      updatedAt: nowIso,
    },
    {
      id: 'usr-seta-10',
      gestaoClickId: '310906',
      name: 'Henrique Dias',
      email: 'henrique.noc@setatelecom.com.br',
      phone: '(11) 96111-2299',
      department: 'NOC N1 & Atendimento SLA',
      jobTitle: 'Analista de Suporte N1 (Service Desk JSM)',
      roleId: 'TECNICO_NOC_OS',
      scope: 'EQUIPE',
      active: true,
      mfaEnabled: true,
      mfaMethod: 'EMAIL_OTP',
      lastLoginAt: nowIso,
      createdAt: '2024-09-01T10:00:00.000Z',
      updatedAt: nowIso,
    },
    {
      id: 'usr-seta-11',
      gestaoClickId: '310907',
      name: 'Patrícia Gomes',
      email: 'patricia.compras@setatelecom.com.br',
      phone: '(11) 3958-4935',
      department: ' Suprimentos, Compras & Estoque',
      jobTitle: 'Compradora Técnica Telecom & Almoxarifado',
      roleId: 'OPERADOR_PDV_ESTOQUE',
      scope: 'TODOS',
      active: true,
      mfaEnabled: true,
      mfaMethod: 'EMAIL_OTP',
      lastLoginAt: nowIso,
      createdAt: '2024-10-01T10:00:00.000Z',
      updatedAt: nowIso,
    },
    {
      id: 'usr-seta-12',
      gestaoClickId: '310908',
      name: 'Gabriel Vasconcelos',
      email: 'gabriel.sdr@setatelecom.com.br',
      phone: '(11) 95544-8877',
      department: 'Pré-Vendas B2B (SDR)',
      jobTitle: 'SDR Enterprise — Qualificação MQL/SQL',
      roleId: 'ANALISTA_MARKETING',
      scope: 'PROPRIOS',
      active: true,
      mfaEnabled: true,
      mfaMethod: 'EMAIL_OTP',
      lastLoginAt: nowIso,
      createdAt: '2025-01-12T10:00:00.000Z',
      updatedAt: nowIso,
    },
    {
      id: 'usr-seta-13',
      gestaoClickId: '310909',
      name: 'Renata Camargo',
      email: 'renata.cobranca@setatelecom.com.br',
      phone: '(11) 3958-4936',
      department: 'Financeiro & Contas a Receber',
      jobTitle: 'Analista de Faturamento e Régua de Cobrança',
      roleId: 'FINANCEIRO_FATURAMENTO',
      scope: 'TODOS',
      active: true,
      mfaEnabled: true,
      mfaMethod: 'EMAIL_OTP',
      lastLoginAt: nowIso,
      createdAt: '2025-02-01T10:00:00.000Z',
      updatedAt: nowIso,
    },
    {
      id: 'usr-seta-14',
      gestaoClickId: '310910',
      name: 'Thiago Mendes',
      email: 'thiago.redes@setatelecom.com.br',
      phone: '(11) 94433-2211',
      department: 'Engenharia SD-WAN & Segurança',
      jobTitle: 'Arquiteto de Redes Cisco / Fortinet (NOC N3)',
      roleId: 'TECNICO_NOC_OS',
      scope: 'TODOS',
      active: true,
      mfaEnabled: true,
      mfaMethod: 'TOTP_AUTHENTICATOR',
      lastLoginAt: nowIso,
      createdAt: '2025-03-10T10:00:00.000Z',
      updatedAt: nowIso,
    },
    {
      id: 'usr-seta-15',
      gestaoClickId: '310911',
      name: 'Camila Azevedo',
      email: 'camila.cs@setatelecom.com.br',
      phone: '(11) 93322-1100',
      department: 'Customer Success & Renovações',
      jobTitle: 'Especialista em Renovação de Contratos & Upsell',
      roleId: 'VENDEDOR_SALES',
      scope: 'EQUIPE',
      active: true,
      mfaEnabled: true,
      mfaMethod: 'EMAIL_OTP',
      lastLoginAt: nowIso,
      createdAt: '2025-04-05T10:00:00.000Z',
      updatedAt: nowIso,
    },
    {
      id: 'usr-seta-16',
      gestaoClickId: '310912',
      name: 'André Luiz Rocha',
      email: 'andre.diretoria@setatelecom.com.br',
      phone: '(11) 3958-4929',
      department: 'Conselho & Diretoria',
      jobTitle: 'Diretor de Operações & Infraestrutura',
      roleId: 'DIRETORIA',
      scope: 'TODOS',
      active: true,
      mfaEnabled: true,
      mfaMethod: 'TOTP_AUTHENTICATOR',
      lastLoginAt: nowIso,
      createdAt: '2024-01-10T10:00:00.000Z',
      updatedAt: nowIso,
    },
    // 6 Historical / Inactive GestureClick & HubSpot Owners (Preserved for Audit & Reassignment)
    {
      id: 'usr-seta-17',
      gestaoClickId: '198001',
      hubspotOwnerId: 'owner-inactive-1',
      name: 'Bruno Carvalho (Ex-Executivo)',
      email: 'bruno.carvalho@setatelecom.com.br',
      phone: '(11) 91111-0001',
      department: 'Comercial B2B (Histórico)',
      jobTitle: 'Ex-Vendedor (Carteira migrada p/ Marcelo Mira)',
      roleId: 'VENDEDOR_SALES',
      scope: 'PROPRIOS',
      active: false,
      mfaEnabled: false,
      mfaMethod: 'EMAIL_OTP',
      lastLoginAt: null,
      createdAt: '2023-05-10T10:00:00.000Z',
      updatedAt: nowIso,
    },
    {
      id: 'usr-seta-18',
      gestaoClickId: '198002',
      hubspotOwnerId: 'owner-inactive-2',
      name: 'Vanessa Lima (Ex-SDR)',
      email: 'vanessa.lima@setatelecom.com.br',
      phone: '(11) 91111-0002',
      department: 'Pré-Vendas (Histórico)',
      jobTitle: 'Ex-SDR (Carteira migrada p/ Evelyn Ternero)',
      roleId: 'ANALISTA_MARKETING',
      scope: 'PROPRIOS',
      active: false,
      mfaEnabled: false,
      mfaMethod: 'EMAIL_OTP',
      lastLoginAt: null,
      createdAt: '2023-06-15T10:00:00.000Z',
      updatedAt: nowIso,
    },
    {
      id: 'usr-seta-19',
      gestaoClickId: '198003',
      name: 'Diego Batista (Ex-Técnico)',
      email: 'diego.batista@setatelecom.com.br',
      phone: '(11) 91111-0003',
      department: 'Field Service (Histórico)',
      jobTitle: 'Ex-Técnico de Campo',
      roleId: 'TECNICO_NOC_OS',
      scope: 'PROPRIOS',
      active: false,
      mfaEnabled: false,
      mfaMethod: 'EMAIL_OTP',
      lastLoginAt: null,
      createdAt: '2023-08-01T10:00:00.000Z',
      updatedAt: nowIso,
    },
    {
      id: 'usr-seta-20',
      gestaoClickId: '198004',
      name: 'Priscila Monteiro (Ex-Financeiro)',
      email: 'priscila.monteiro@setatelecom.com.br',
      phone: '(11) 91111-0004',
      department: 'Financeiro (Histórico)',
      jobTitle: 'Ex-Assistente Financeiro',
      roleId: 'FINANCEIRO_FATURAMENTO',
      scope: 'PROPRIOS',
      active: false,
      mfaEnabled: false,
      mfaMethod: 'EMAIL_OTP',
      lastLoginAt: null,
      createdAt: '2023-09-12T10:00:00.000Z',
      updatedAt: nowIso,
    },
    {
      id: 'usr-seta-21',
      gestaoClickId: '198005',
      name: 'Fábio Santana (Ex-Vendas)',
      email: 'fabio.santana@setatelecom.com.br',
      phone: '(11) 91111-0005',
      department: 'Comercial (Histórico)',
      jobTitle: 'Ex-Consultor Comercial',
      roleId: 'VENDEDOR_SALES',
      scope: 'PROPRIOS',
      active: false,
      mfaEnabled: false,
      mfaMethod: 'EMAIL_OTP',
      lastLoginAt: null,
      createdAt: '2023-10-20T10:00:00.000Z',
      updatedAt: nowIso,
    },
    {
      id: 'usr-seta-22',
      gestaoClickId: '198006',
      name: 'Auditoria Externa Contábil Seta',
      email: 'auditoria@setatelecom.com.br',
      phone: '(11) 3958-4999',
      department: 'Contabilidade & Compliance',
      jobTitle: 'Auditor Fiscal Externo (Somente Leitura)',
      roleId: 'FISCAL_CONTABIL',
      scope: 'TODOS',
      active: true,
      mfaEnabled: true,
      mfaMethod: 'EMAIL_OTP',
      actionGuardsOverride: {
        canIssueFiscalDocuments: false,
        canDeleteRecords: false,
      },
      lastLoginAt: nowIso,
      createdAt: '2025-01-05T10:00:00.000Z',
      updatedAt: nowIso,
    },
  ];

  const customProperties: StiHubCustomPropertySpec[] = [
    {
      id: 'prop-hs-buying-role',
      objectType: 'CONTACT',
      internalName: 'hs_buying_role',
      label: 'Papel no Comitê de Compras (Buying Role)',
      fieldType: 'ENUMERATION',
      hubspotGroup: 'sales_properties',
      options: ['DECISOR', 'COMPRADOR_ECONOMICO', 'CAMPEAO_INTERNO', 'AVALIADOR_TECNICO', 'INFLUENCIADOR', 'BLOQUEADOR'],
      description: 'Identifica decisores C-Level, compradores econômicos e avaliadores técnicos em vendas complexas B2B.',
      syncedWithPortal4369067: true,
    },
    {
      id: 'prop-hs-is-unworked',
      objectType: 'CONTACT',
      internalName: 'seta_is_unworked',
      label: 'Lead Não Trabalhado (Alerta SLA Comercial)',
      fieldType: 'BOOLEAN',
      hubspotGroup: 'contactinformation',
      description: 'Sinaliza contatos sem abordagem humana para priorização imediata na fila de tarefas.',
      syncedWithPortal4369067: true,
    },
    {
      id: 'prop-hs-target-account',
      objectType: 'COMPANY',
      internalName: 'hs_is_target_account',
      label: 'Conta-Alvo ABM (Target Account)',
      fieldType: 'BOOLEAN',
      hubspotGroup: 'abm_properties',
      description: 'Marca empresas estratégicas de médio/grande porte para prospecção coordenada ABM.',
      syncedWithPortal4369067: true,
    },
    {
      id: 'prop-hs-icp-tier',
      objectType: 'COMPANY',
      internalName: 'seta_icp_tier',
      label: 'Classificação ICP Tier (Potencial de Locação)',
      fieldType: 'ENUMERATION',
      hubspotGroup: 'abm_properties',
      options: ['TIER_1_ENTERPRISE', 'TIER_2_MID_MARKET', 'TIER_3_SMB'],
      description: 'Segmenta contas pelo volume potencial de ramais IP, links SD-WAN e MRR de locação.',
      syncedWithPortal4369067: true,
    },
    {
      id: 'prop-hs-cnpj-lock',
      objectType: 'COMPANY',
      internalName: 'cnpj_receita_federal',
      label: 'CNPJ Oficial (Trava Fiscal Matriz/Filial)',
      fieldType: 'TEXT',
      hubspotGroup: 'companyinformation',
      description: 'Chave fiscal imutável que impede fusão acidental entre Matriz e Filiais com mesmo domínio.',
      syncedWithPortal4369067: true,
    },
    {
      id: 'prop-hs-deal-modality',
      objectType: 'DEAL',
      internalName: 'seta_deal_modality',
      label: 'Modalidade Comercial (Locação SV 31 vs Venda/Serviço)',
      fieldType: 'ENUMERATION',
      hubspotGroup: 'dealinformation',
      options: ['LOCACAO_RECORRENTE', 'NEW_BUSINESS', 'UPSELL_RENOVACAO'],
      description: 'Define se o negócio gera Contrato de Locação (0% ISS — SV 31 STF) ou faturamento de venda/serviço.',
      syncedWithPortal4369067: true,
    },
    {
      id: 'prop-hs-deal-mrr',
      objectType: 'DEAL',
      internalName: 'hs_mrr_brl',
      label: 'Receita Mensal Recorrente (MRR R$)',
      fieldType: 'NUMBER',
      hubspotGroup: 'deal_revenue',
      description: 'Valor mensal recorrente calculado automaticamente na Proposta #4695 e no Contrato de Locação.',
      syncedWithPortal4369067: true,
    },
    {
      id: 'prop-hs-ticket-noc-queue',
      objectType: 'TICKET',
      internalName: 'seta_noc_queue_tier',
      label: 'Fila Técnica NOC (N1 / N2 / N3 / RMA)',
      fieldType: 'ENUMERATION',
      hubspotGroup: 'ticket_sla',
      options: ['NOC_N1_TRIAGEM', 'NOC_N2_ENGENHARIA_VOIP', 'NOC_N3_CORE_SDWAN', 'FIELD_SERVICE_RMA', 'FINANCEIRO_FATURAMENTO'],
      description: 'Roteia o chamado técnico JSM e vincula automaticamente à Ordem de Serviço (O.S.) no GestãoClick.',
      syncedWithPortal4369067: true,
    },
  ];

  const enrichedRoles: StiHubRoleDefinition[] = roles.map((r) => {
    const modAcc = buildDefaultModuleAccessForRole(r.id);
    const { crmRole, erpRole } = inferCrmAndErpRolesFromLegacyRole(r.id);
    const crmItemPermissions = buildDefaultCrmItemPermissions(crmRole);
    const erpItemPermissions = buildDefaultErpItemPermissions(erpRole);
    return {
      ...r,
      crmRole,
      erpRole,
      enabledModules: modAcc.enabledModules,
      moduleAccess: modAcc.moduleAccess,
      crmPermissions: buildDefaultCrmPermissionsForRole(r.id, r.defaultScope),
      erpPermissions: buildDefaultErpPermissionsForRole(r.id),
      crmItemPermissions,
      erpItemPermissions,
      itemPermissions: { ...crmItemPermissions, ...erpItemPermissions },
    };
  });

  const enrichedUsers: StiHubUserRecord[] = users.map((u) => {
    const modAcc = buildDefaultModuleAccessForRole(u.roleId, u.email);
    const crmPerms = buildDefaultCrmPermissionsForRole(u.roleId, u.scope);
    const erpPerms = buildDefaultErpPermissionsForRole(u.roleId);
    if (u.actionGuardsOverride?.canIssueFiscalDocuments !== undefined) {
      erpPerms.canIssueFiscalDocuments = u.actionGuardsOverride.canIssueFiscalDocuments;
    }
    if (u.actionGuardsOverride?.canDeleteRecords !== undefined) {
      crmPerms.canDeleteCrmRecords = u.actionGuardsOverride.canDeleteRecords;
      erpPerms.canDeleteErpRecords = u.actionGuardsOverride.canDeleteRecords;
    }
    const { crmRole, erpRole } = inferCrmAndErpRolesFromLegacyRole(u.roleId);
    const crmItemPermissions = buildDefaultCrmItemPermissions(crmRole);
    const erpItemPermissions = buildDefaultErpItemPermissions(erpRole);
    return {
      ...u,
      role: u.roleId,
      crmRole,
      erpRole,
      enabledModules: modAcc.enabledModules,
      moduleAccess: modAcc.moduleAccess,
      crmPermissions: crmPerms,
      erpPermissions: erpPerms,
      crmItemPermissions,
      erpItemPermissions,
      itemPermissions: { ...crmItemPermissions, ...erpItemPermissions },
      totpSecret: generateTotpSecretBase32(u.email),
      totpConfigured: Boolean(u.mfaEnabled && u.active),
      totpConfiguredAt: u.mfaEnabled ? u.createdAt : null,
      lastUsedTotpTimeStep: null,
    };
  });

  const genesisHash = "0000000000000000000000000000000000000000000000000000000000000000";
  const audit1Hash = sha256Hex(`${genesisHash}|AUDIT-001|marcelo.mira@setatelecom.com.br|IAM_RBAC_INITIALIZED`);
  const audit2Hash = sha256Hex(`${audit1Hash}|AUDIT-002|marcelo.mira@setatelecom.com.br|MFA_RFC6238_ENFORCED`);
  const initialAuditLogs: StiHubSecurityAuditLogEntry[] = [
    {
      id: "AUDIT-002",
      timestamp: nowIso,
      actorEmail: "marcelo.mira@setatelecom.com.br",
      actorName: "Marcelo Lopes Mira",
      actorRole: "SUPER_ADMIN",
      action: "MFA_2FA_POLICY_ENFORCED",
      module: "AUTH_MFA",
      resource: "/api/auth/*",
      status: "SUCCESS",
      ipAddress: "189.112.44.18",
      details: "Política obrigatória de 2FA (Google Authenticator RFC 6238 TOTP + E-mail OTP) e assinatura HMAC-SHA256 de sessão ativada.",
      prevHashSha256: audit1Hash,
      integrityHashSha256: audit2Hash,
    },
    {
      id: "AUDIT-001",
      timestamp: nowIso,
      actorEmail: "marcelo.mira@setatelecom.com.br",
      actorName: "Marcelo Lopes Mira",
      actorRole: "SUPER_ADMIN",
      action: "IAM_DUAL_PANEL_SEEDED",
      module: "IAM_RBAC",
      resource: "/api/admin/rbac",
      status: "SUCCESS",
      ipAddress: "189.112.44.18",
      details: "Matriz IAM com 2 painéis separados (Permissões CRM/HubSpot + Permissões ERP) e escopo modular (CRM, ERP, Chamados) inicializada.",
      prevHashSha256: genesisHash,
      integrityHashSha256: audit1Hash,
    },
  ];

  return {
    roles: enrichedRoles,
    users: enrichedUsers,
    auditLogs: initialAuditLogs,
    securityConfig: {
      enforceMfaOnAllLogins: true,
      sessionTtlHours: 24,
      defaultTotpDemoCode: '436906',
      smtpProvider: 'RESEND_HTTP_API',
      smtpHost: 'smtp.setatelecom.com.br',
      smtpPort: 587,
      fromName: 'STI-hub • Seta Telecom (SETA | IT)',
      fromEmail: 'comercial@setatelecom.com.br',
      replyToEmail: 'marcelo.mira@setatelecom.com.br',
      dkimSpfDmarcVerified: true,
      subdomains: [
        {
          domain: 'sti-hub.vercel.app',
          type: 'PRIMARY_VERCEL',
          cnameTarget: 'cname.vercel-dns.com',
          sslStatus: 'ACTIVE_TLS_1_3',
          isDefaultPublicProposalDomain: true,
          verifiedAt: nowIso,
        },
        {
          domain: 'stihub.setatelecom.com.br',
          type: 'CORPORATE_CNAME',
          cnameTarget: 'cname.vercel-dns.com',
          sslStatus: 'ACTIVE_TLS_1_3',
          isDefaultPublicProposalDomain: false,
          verifiedAt: nowIso,
        },
        {
          domain: 'erp.setatelecom.com.br',
          type: 'ERP_ALIAS',
          cnameTarget: 'cname.vercel-dns.com',
          sslStatus: 'ACTIVE_TLS_1_3',
          isDefaultPublicProposalDomain: false,
          verifiedAt: nowIso,
        },
      ],
      customProperties,
      updatedAt: nowIso,
    },
  };
}
