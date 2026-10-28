// ============================================================================
// STI-hub — RBAC (Role-Based Access Control), MFA Auth, Custom Fields & Templates
// Portal HubSpot #4369067 + GestãoClick Loja Matriz #118887 (Seta Telecom LTDA)
// Arquitetura Dual Independente:
//   1. Tipos de Conta & Permissões do CRM (CrmAccountRole / CRM_ROLES_CATALOG / CRM_MODULE_ITEMS_CATALOG)
//   2. Tipos de Conta & Permissões do ERP (ErpAccountRole / ERP_ROLES_CATALOG / ERP_MODULE_ITEMS_CATALOG)
// ============================================================================

export type StiHubRole =
  | 'SUPER_ADMIN'
  | 'SALES_MANAGER'
  | 'SALES_REP'
  | 'MARKETING_SPECIALIST'
  | 'ERP_FINANCE_FISCAL'
  | 'STOCK_MANAGER'
  | 'SUPPORT_NOC_OS'
  | 'PDV_STOCK_OPERATOR';

// 1. TIPOS DE CONTA EXCLUSIVOS DO CRM (Sales Hub, Marketing Hub, Service/NOC & Data Health)
export type CrmAccountRole =
  | 'CRM_ADMIN'
  | 'CRM_SALES_MANAGER'
  | 'CRM_SALES_REP'
  | 'CRM_SDR_PRE_SALES'
  | 'CRM_MARKETING'
  | 'CRM_SERVICE_NOC'
  | 'CRM_NONE';

// 2. TIPOS DE CONTA EXCLUSIVOS DO ERP (Administrador, Comercial, Financeiro, Gerência de Estoque, Contratos/O.S., PDV)
export type ErpAccountRole =
  | 'ERP_ADMIN'
  | 'ERP_COMMERCIAL'
  | 'ERP_FINANCE'
  | 'ERP_STOCK_MANAGER'
  | 'ERP_CONTRACTS_OS'
  | 'ERP_PDV_BALCAO'
  | 'ERP_NONE';

export interface CrudPermissionFlags {
  view: boolean;
  edit: boolean;
  delete: boolean;
}

export interface ModuleItemCrudPermission {
  itemId: string;
  system: 'CRM' | 'ERP';
  module: 'CRM' | 'ERP' | 'CHAMADOS' | 'ADMIN';
  moduleLabel: string;
  itemLabel: string;
  view: boolean;
  edit: boolean;
  delete: boolean;
}

export type CrmModuleItemPermissions = Record<string, CrudPermissionFlags>;
export type ErpModuleItemPermissions = Record<string, CrudPermissionFlags>;

// ============================================================================
// CATÁLOGO 1: MÓDULOS E ITENS DO CRM (EXCLUSIVOS DO CRM & CHAMADOS)
// ============================================================================
export const CRM_MODULE_ITEMS_CATALOG: ModuleItemCrudPermission[] = [
  {
    itemId: 'crm.overview_ai',
    system: 'CRM',
    module: 'CRM',
    moduleLabel: 'Visão Geral & IA (CRM)',
    itemLabel: 'Dashboard Executivo CRM & Copiloto IA de Funil',
    view: true,
    edit: true,
    delete: false,
  },
  {
    itemId: 'crm.contacts',
    system: 'CRM',
    module: 'CRM',
    moduleLabel: 'Contatos & Empresas (CRM)',
    itemLabel: 'Contatos B2B (Ficha 360º, Buying Role & Timeline)',
    view: true,
    edit: true,
    delete: true,
  },
  {
    itemId: 'crm.companies',
    system: 'CRM',
    module: 'CRM',
    moduleLabel: 'Contatos & Empresas (CRM)',
    itemLabel: 'Empresas PJ/PF (Contas ABM, ICP Tier & Receita Federal)',
    view: true,
    edit: true,
    delete: true,
  },
  {
    itemId: 'crm.deals_kanban',
    system: 'CRM',
    module: 'CRM',
    moduleLabel: 'Sales Hub (CRM)',
    itemLabel: 'Funil de Negócios (Deals Kanban — 3 Pipelines Comerciais)',
    view: true,
    edit: true,
    delete: true,
  },
  {
    itemId: 'crm.quotas_commissions',
    system: 'CRM',
    module: 'CRM',
    moduleLabel: 'Sales Hub (CRM)',
    itemLabel: 'Metas Comerciais (Quotas) & Comissões MRR',
    view: true,
    edit: true,
    delete: true,
  },
  {
    itemId: 'crm.playbooks_meetings_sequences',
    system: 'CRM',
    module: 'CRM',
    moduleLabel: 'Sales Hub (CRM)',
    itemLabel: 'Playbooks B2B, Links de Reuniões & Cadências (Sequences)',
    view: true,
    edit: true,
    delete: true,
  },
  {
    itemId: 'crm.marketing_campaigns',
    system: 'CRM',
    module: 'CRM',
    moduleLabel: 'Marketing Hub (CRM)',
    itemLabel: 'Campanhas, Atribuição de ROI & E-mail Marketing ABM',
    view: true,
    edit: true,
    delete: true,
  },
  {
    itemId: 'crm.marketing_lists_scoring_forms',
    system: 'CRM',
    module: 'CRM',
    moduleLabel: 'Marketing Hub (CRM)',
    itemLabel: 'Listas Ativas, Lead Scoring Preditivo & Formulários Web',
    view: true,
    edit: true,
    delete: true,
  },
  {
    itemId: 'crm.automations_dag',
    system: 'CRM',
    module: 'CRM',
    moduleLabel: 'Automações (CRM)',
    itemLabel: 'Construtor Visual de Automações (Workflows DAG)',
    view: true,
    edit: true,
    delete: true,
  },
  {
    itemId: 'crm.data_health',
    system: 'CRM',
    module: 'CRM',
    moduleLabel: 'Governança de Dados (CRM)',
    itemLabel: 'Saúde da Base (Data Health & Trava Fiscal Anti-Merge CNPJ)',
    view: true,
    edit: true,
    delete: true,
  },
  {
    itemId: 'chamados.filas_noc',
    system: 'CRM',
    module: 'CHAMADOS',
    moduleLabel: 'Service Hub & Chamados NOC',
    itemLabel: 'Central de Chamados & Filas NOC (N1, N2, N3, RMA & Faturamento)',
    view: true,
    edit: true,
    delete: true,
  },
  {
    itemId: 'chamados.sla_notas_os',
    system: 'CRM',
    module: 'CHAMADOS',
    moduleLabel: 'Service Hub & Chamados NOC',
    itemLabel: 'Gestão de SLA Dinâmico, Notas Técnicas Internas & Conversão em O.S.',
    view: true,
    edit: true,
    delete: true,
  },
  {
    itemId: 'chamados.portal_csat',
    system: 'CRM',
    module: 'CHAMADOS',
    moduleLabel: 'Service Hub & Chamados NOC',
    itemLabel: 'Portal Externo do Cliente (/portal) & Avaliação CSAT',
    view: true,
    edit: true,
    delete: true,
  },
  {
    itemId: 'admin.usuarios_rbac_mfa',
    system: 'CRM',
    module: 'ADMIN',
    moduleLabel: 'Administração CRM & Plataforma',
    itemLabel: 'Gestão de Usuários CRM, Tipos de Conta & 2FA Google Authenticator',
    view: true,
    edit: true,
    delete: true,
  },
  {
    itemId: 'admin.campos_emails_dominios',
    system: 'CRM',
    module: 'ADMIN',
    moduleLabel: 'Administração CRM & Plataforma',
    itemLabel: 'Campos Customizados (#4369067), Templates, E-mail SPF/DKIM/DMARC & Domínio',
    view: true,
    edit: true,
    delete: true,
  },
];

// ============================================================================
// CATÁLOGO 2: MÓDULOS E ITENS DO ERP (EXCLUSIVOS DO SETA ERP / GESTÃOCLICK)
// ============================================================================
export const ERP_MODULE_ITEMS_CATALOG: ModuleItemCrudPermission[] = [
  {
    itemId: 'erp.inicio_dashboard',
    system: 'ERP',
    module: 'ERP',
    moduleLabel: '1. Início ERP',
    itemLabel: 'Visão Geral Financeira, Flashcards & Agenda de O.S.',
    view: true,
    edit: true,
    delete: false,
  },
  {
    itemId: 'erp.cadastros_clientes',
    system: 'ERP',
    module: 'ERP',
    moduleLabel: '2. Cadastros ERP',
    itemLabel: 'Cadastros: Clientes PJ/PF (1.184 Clientes • Receita Federal & Serasa)',
    view: true,
    edit: true,
    delete: true,
  },
  {
    itemId: 'erp.cadastros_fornecedores',
    system: 'ERP',
    module: 'ERP',
    moduleLabel: '2. Cadastros ERP',
    itemLabel: 'Cadastros: Fornecedores & Fabricantes Telecom (101 Fornecedores)',
    view: true,
    edit: true,
    delete: true,
  },
  {
    itemId: 'erp.cadastros_funcionarios',
    system: 'ERP',
    module: 'ERP',
    moduleLabel: '2. Cadastros ERP',
    itemLabel: 'Cadastros: Funcionários & Técnicos (14 Colaboradores)',
    view: true,
    edit: true,
    delete: true,
  },
  {
    itemId: 'erp.cadastros_transportadoras',
    system: 'ERP',
    module: 'ERP',
    moduleLabel: '2. Cadastros ERP',
    itemLabel: 'Cadastros: Transportadoras & Logística de Remessa',
    view: true,
    edit: true,
    delete: true,
  },
  {
    itemId: 'erp.itens_produtos',
    system: 'ERP',
    module: 'ERP',
    moduleLabel: '3. Itens & Catálogo ERP',
    itemLabel: 'Itens: Produtos, Equipamentos Telecom & Controle por S/N (786 SKUs)',
    view: true,
    edit: true,
    delete: true,
  },
  {
    itemId: 'erp.itens_servicos',
    system: 'ERP',
    module: 'ERP',
    moduleLabel: '3. Itens & Catálogo ERP',
    itemLabel: 'Itens: Serviços Técnicos & Telecom (39 Serviços • LC 116 01.07)',
    view: true,
    edit: true,
    delete: true,
  },
  {
    itemId: 'erp.orcamentos_propostas',
    system: 'ERP',
    module: 'ERP',
    moduleLabel: '4. Orçamentos & Propostas ERP',
    itemLabel: 'Orçamentos & Propostas Comerciais (#4695, Versionamento & Link Público PDF)',
    view: true,
    edit: true,
    delete: true,
  },
  {
    itemId: 'erp.vendas_pedidos',
    system: 'ERP',
    module: 'ERP',
    moduleLabel: '5. Vendas ERP',
    itemLabel: 'Vendas de Produtos, Serviços & Faturamento de Pedidos',
    view: true,
    edit: true,
    delete: true,
  },
  {
    itemId: 'erp.vendas_pdv_balcao',
    system: 'ERP',
    module: 'ERP',
    moduleLabel: '5. Vendas ERP',
    itemLabel: 'Vendas: PDV / Frente de Caixa Balcão (PIX QR Code & NFC-e Mod. 65)',
    view: true,
    edit: true,
    delete: true,
  },
  {
    itemId: 'erp.vendas_devolucoes',
    system: 'ERP',
    module: 'ERP',
    moduleLabel: '5. Vendas ERP',
    itemLabel: 'Vendas: Devoluções, Trocas RMA & Estornos',
    view: true,
    edit: true,
    delete: true,
  },
  {
    itemId: 'erp.ordens_servico',
    system: 'ERP',
    module: 'ERP',
    moduleLabel: '6. Ordens de Serviço ERP',
    itemLabel: 'Ordens de Serviço: Gerenciar O.S., Painel Técnico & Campo (1.378 O.S.)',
    view: true,
    edit: true,
    delete: true,
  },
  {
    itemId: 'erp.estoque_movimentacoes',
    system: 'ERP',
    module: 'ERP',
    moduleLabel: '7. Estoque & Compras ERP',
    itemLabel: 'Estoque: Movimentações, Ajustes de Inventário & Transferências S/N',
    view: true,
    edit: true,
    delete: true,
  },
  {
    itemId: 'erp.estoque_cotacoes_compras',
    system: 'ERP',
    module: 'ERP',
    moduleLabel: '7. Estoque & Compras ERP',
    itemLabel: 'Estoque: Cotações de Fornecedores, Pedidos de Compra & Importação XML NF-e',
    view: true,
    edit: true,
    delete: true,
  },
  {
    itemId: 'erp.financeiro_pagar_receber',
    system: 'ERP',
    module: 'ERP',
    moduleLabel: '8. Financeiro ERP',
    itemLabel: 'Financeiro: Contas a Pagar, Contas a Receber & Emissão de Boletos/PIX',
    view: true,
    edit: true,
    delete: true,
  },
  {
    itemId: 'erp.financeiro_bancos_dre',
    system: 'ERP',
    module: 'ERP',
    moduleLabel: '8. Financeiro ERP',
    itemLabel: 'Financeiro: Contas Bancárias (Inter/Itaú), Conciliação OFX, Fluxo de Caixa & DRE',
    view: true,
    edit: true,
    delete: true,
  },
  {
    itemId: 'erp.fiscal_notas',
    system: 'ERP',
    module: 'ERP',
    moduleLabel: '9. Fiscal & Tributário ERP',
    itemLabel: 'Fiscal: Fatura Locação 0% ISS (SV 31 STF), NFS-e, NF-e Remessa CFOP 5.908/5.909 & NFCom',
    view: true,
    edit: true,
    delete: true,
  },
  {
    itemId: 'erp.contratos_locacoes',
    system: 'ERP',
    module: 'ERP',
    moduleLabel: '10. Contratos & Locações ERP',
    itemLabel: 'Contratos: Locações, Serviços, Assinaturas, Patrimônio S/N, Devolução Pro-Rata & Reajuste',
    view: true,
    edit: true,
    delete: true,
  },
  {
    itemId: 'erp.relatorios_logs',
    system: 'ERP',
    module: 'ERP',
    moduleLabel: '11. Relatórios & Auditoria ERP',
    itemLabel: 'Relatórios Gerenciais (Vendas, Estoque, Financeiro, Fiscal) & Logs do Sistema',
    view: true,
    edit: true,
    delete: true,
  },
  {
    itemId: 'erp.configuracoes_empresa',
    system: 'ERP',
    module: 'ERP',
    moduleLabel: '12. Configurações ERP',
    itemLabel: 'Configurações ERP: Dados da Empresa, Certificado Digital A1, Séries Fiscais & Usuários ERP',
    view: true,
    edit: true,
    delete: true,
  },
];

// Catálogo unificado (todos os itens de CRM + todos os itens de ERP)
export const MODULE_ITEMS_CRUD_CATALOG: ModuleItemCrudPermission[] = [
  ...CRM_MODULE_ITEMS_CATALOG,
  ...ERP_MODULE_ITEMS_CATALOG,
];

export function buildDefaultCrmItemPermissions(
  crmRole: CrmAccountRole
): CrmModuleItemPermissions {
  const result: CrmModuleItemPermissions = {};
  for (const item of CRM_MODULE_ITEMS_CATALOG) {
    if (crmRole === 'CRM_ADMIN') {
      result[item.itemId] = { view: true, edit: true, delete: true };
    } else if (crmRole === 'CRM_NONE') {
      result[item.itemId] = { view: false, edit: false, delete: false };
    } else if (crmRole === 'CRM_SALES_MANAGER') {
      const isAdmin = item.module === 'ADMIN';
      result[item.itemId] = {
        view: !isAdmin,
        edit: !isAdmin,
        delete: item.itemId.startsWith('crm.'),
      };
    } else if (crmRole === 'CRM_SALES_REP') {
      const canEdit = [
        'crm.overview_ai',
        'crm.contacts',
        'crm.companies',
        'crm.deals_kanban',
        'crm.quotas_commissions',
        'crm.playbooks_meetings_sequences',
      ].includes(item.itemId);
      const canView = canEdit || item.itemId.startsWith('chamados.');
      result[item.itemId] = { view: canView, edit: canEdit, delete: false };
    } else if (crmRole === 'CRM_SDR_PRE_SALES') {
      const canEdit = [
        'crm.contacts',
        'crm.companies',
        'crm.deals_kanban',
        'crm.playbooks_meetings_sequences',
        'crm.marketing_lists_scoring_forms',
      ].includes(item.itemId);
      const canView = canEdit || item.itemId === 'crm.overview_ai' || item.itemId === 'crm.data_health';
      result[item.itemId] = { view: canView, edit: canEdit, delete: false };
    } else if (crmRole === 'CRM_MARKETING') {
      const canFull = [
        'crm.marketing_campaigns',
        'crm.marketing_lists_scoring_forms',
        'crm.automations_dag',
        'crm.contacts',
        'crm.companies',
        'crm.data_health',
      ].includes(item.itemId);
      const canView = canFull || item.itemId === 'crm.overview_ai' || item.itemId === 'crm.deals_kanban';
      result[item.itemId] = { view: canView, edit: canFull, delete: canFull };
    } else if (crmRole === 'CRM_SERVICE_NOC') {
      const isChamados = item.itemId.startsWith('chamados.');
      const canView = isChamados || ['crm.contacts', 'crm.companies', 'crm.overview_ai'].includes(item.itemId);
      result[item.itemId] = { view: canView, edit: isChamados, delete: isChamados };
    }
  }
  return result;
}

export function buildDefaultErpItemPermissions(
  erpRole: ErpAccountRole
): ErpModuleItemPermissions {
  const result: ErpModuleItemPermissions = {};
  for (const item of ERP_MODULE_ITEMS_CATALOG) {
    if (erpRole === 'ERP_ADMIN') {
      result[item.itemId] = { view: true, edit: true, delete: true };
    } else if (erpRole === 'ERP_NONE') {
      result[item.itemId] = { view: false, edit: false, delete: false };
    } else if (erpRole === 'ERP_COMMERCIAL') {
      const canFull = [
        'erp.cadastros_clientes',
        'erp.orcamentos_propostas',
        'erp.vendas_pedidos',
      ].includes(item.itemId);
      const canEdit = canFull || item.itemId === 'erp.contratos_locacoes';
      const canView =
        canEdit ||
        [
          'erp.inicio_dashboard',
          'erp.itens_produtos',
          'erp.itens_servicos',
          'erp.ordens_servico',
          'erp.relatorios_logs',
        ].includes(item.itemId);
      result[item.itemId] = { view: canView, edit: canEdit, delete: canFull };
    } else if (erpRole === 'ERP_FINANCE') {
      const canFull = [
        'erp.financeiro_pagar_receber',
        'erp.financeiro_bancos_dre',
        'erp.fiscal_notas',
        'erp.contratos_locacoes',
        'erp.relatorios_logs',
      ].includes(item.itemId);
      const canEdit =
        canFull ||
        [
          'erp.inicio_dashboard',
          'erp.cadastros_clientes',
          'erp.cadastros_fornecedores',
          'erp.orcamentos_propostas',
          'erp.vendas_pedidos',
        ].includes(item.itemId);
      const canView = canEdit || item.itemId !== 'erp.configuracoes_empresa';
      result[item.itemId] = { view: canView, edit: canEdit, delete: canFull };
    } else if (erpRole === 'ERP_STOCK_MANAGER') {
      const canFull = [
        'erp.estoque_movimentacoes',
        'erp.estoque_cotacoes_compras',
        'erp.itens_produtos',
        'erp.itens_servicos',
        'erp.cadastros_fornecedores',
        'erp.cadastros_transportadoras',
        'erp.vendas_devolucoes',
        'erp.ordens_servico',
      ].includes(item.itemId);
      const canEdit = canFull || item.itemId === 'erp.vendas_pdv_balcao';
      const canView =
        canEdit ||
        [
          'erp.inicio_dashboard',
          'erp.cadastros_clientes',
          'erp.cadastros_funcionarios',
          'erp.orcamentos_propostas',
          'erp.vendas_pedidos',
          'erp.contratos_locacoes',
          'erp.fiscal_notas',
          'erp.relatorios_logs',
        ].includes(item.itemId);
      result[item.itemId] = { view: canView, edit: canEdit, delete: canFull };
    } else if (erpRole === 'ERP_CONTRACTS_OS') {
      const canFull = [
        'erp.contratos_locacoes',
        'erp.ordens_servico',
        'erp.vendas_devolucoes',
      ].includes(item.itemId);
      const canEdit =
        canFull ||
        [
          'erp.cadastros_clientes',
          'erp.itens_produtos',
          'erp.estoque_movimentacoes',
          'erp.orcamentos_propostas',
        ].includes(item.itemId);
      const canView =
        canEdit ||
        ['erp.inicio_dashboard', 'erp.itens_servicos', 'erp.fiscal_notas', 'erp.relatorios_logs'].includes(
          item.itemId
        );
      result[item.itemId] = { view: canView, edit: canEdit, delete: canFull };
    } else if (erpRole === 'ERP_PDV_BALCAO') {
      const canEdit = [
        'erp.vendas_pdv_balcao',
        'erp.vendas_pedidos',
        'erp.estoque_movimentacoes',
        'erp.cadastros_clientes',
      ].includes(item.itemId);
      const canView =
        canEdit ||
        ['erp.itens_produtos', 'erp.itens_servicos', 'erp.vendas_devolucoes'].includes(item.itemId);
      result[item.itemId] = { view: canView, edit: canEdit, delete: false };
    }
  }
  return result;
}

export function inferCrmAndErpRolesFromLegacyRole(role: string): {
  crmRole: CrmAccountRole;
  erpRole: ErpAccountRole;
} {
  switch (role) {
    case 'SUPER_ADMIN':
    case 'DIRETORIA':
      return { crmRole: 'CRM_ADMIN', erpRole: 'ERP_ADMIN' };
    case 'SALES_MANAGER':
    case 'GERENTE_COMERCIAL':
      return { crmRole: 'CRM_SALES_MANAGER', erpRole: 'ERP_COMMERCIAL' };
    case 'SALES_REP':
    case 'VENDEDOR_SALES':
      return { crmRole: 'CRM_SALES_REP', erpRole: 'ERP_COMMERCIAL' };
    case 'MARKETING_SPECIALIST':
    case 'ANALISTA_MARKETING':
      return { crmRole: 'CRM_MARKETING', erpRole: 'ERP_NONE' };
    case 'ERP_FINANCE_FISCAL':
    case 'FINANCEIRO_FATURAMENTO':
    case 'FISCAL_CONTABIL':
      return { crmRole: 'CRM_NONE', erpRole: 'ERP_FINANCE' };
    case 'STOCK_MANAGER':
    case 'GERENCIA_ESTOQUE':
      return { crmRole: 'CRM_NONE', erpRole: 'ERP_STOCK_MANAGER' };
    case 'SUPPORT_NOC_OS':
    case 'TECNICO_NOC_OS':
      return { crmRole: 'CRM_SERVICE_NOC', erpRole: 'ERP_CONTRACTS_OS' };
    case 'PDV_STOCK_OPERATOR':
    case 'OPERADOR_PDV_ESTOQUE':
      return { crmRole: 'CRM_NONE', erpRole: 'ERP_PDV_BALCAO' };
    default:
      return { crmRole: 'CRM_SALES_REP', erpRole: 'ERP_COMMERCIAL' };
  }
}

export function buildDefaultItemPermissionsForRole(
  role: StiHubRole | string
): Record<string, CrudPermissionFlags> {
  const { crmRole, erpRole } = inferCrmAndErpRolesFromLegacyRole(role);
  return {
    ...buildDefaultCrmItemPermissions(crmRole),
    ...buildDefaultErpItemPermissions(erpRole),
  };
}

export interface CrmRoleDefinitionMatrix {
  role: CrmAccountRole;
  label: string;
  badgeColor: string;
  description: string;
  portfolioScope: 'ALL' | 'TEAM' | 'OWN_ONLY';
  itemPermissions: CrmModuleItemPermissions;
}

export interface ErpRoleDefinitionMatrix {
  role: ErpAccountRole;
  label: string;
  badgeColor: string;
  description: string;
  maxDiscountPercent: number;
  canViewBankBalances: boolean;
  canIssueFiscalDocuments: boolean;
  canApproveProposals: boolean;
  itemPermissions: ErpModuleItemPermissions;
}

export const CRM_ROLES_CATALOG: Record<CrmAccountRole, CrmRoleDefinitionMatrix> = {
  CRM_ADMIN: {
    role: 'CRM_ADMIN',
    label: 'Administrador CRM (Acesso Total CRM & Chamados)',
    badgeColor: 'bg-emerald-600 text-white',
    description:
      'Controle total (Visualizar, Editar e Deletar) em todos os módulos e itens do CRM (Sales Hub, Marketing Hub, Workflows DAG, Data Health, Chamados NOC e Administração CRM).',
    portfolioScope: 'ALL',
    itemPermissions: buildDefaultCrmItemPermissions('CRM_ADMIN'),
  },
  CRM_SALES_MANAGER: {
    role: 'CRM_SALES_MANAGER',
    label: 'Comercial — Gestor Sales Hub',
    badgeColor: 'bg-sky-600 text-white',
    description:
      'Gestão completa de Contatos, Empresas, Deals Kanban (3 Pipelines), Quotas & Comissões MRR, Playbooks, Reuniões, Sequências e Data Health em toda a base.',
    portfolioScope: 'ALL',
    itemPermissions: buildDefaultCrmItemPermissions('CRM_SALES_MANAGER'),
  },
  CRM_SALES_REP: {
    role: 'CRM_SALES_REP',
    label: 'Comercial — Executivo de Contas / Closer B2B',
    badgeColor: 'bg-blue-600 text-white',
    description:
      'Atuação nos negócios, contatos, empresas, playbooks, reuniões e cadências da própria carteira comercial.',
    portfolioScope: 'OWN_ONLY',
    itemPermissions: buildDefaultCrmItemPermissions('CRM_SALES_REP'),
  },
  CRM_SDR_PRE_SALES: {
    role: 'CRM_SDR_PRE_SALES',
    label: 'Comercial — SDR & Pré-Vendas Outbound/Inbound',
    badgeColor: 'bg-indigo-600 text-white',
    description:
      'Qualificação de leads, prospecção ABM, cadências de e-mail (Sequences), listas ativas e agendamento de reuniões.',
    portfolioScope: 'TEAM',
    itemPermissions: buildDefaultCrmItemPermissions('CRM_SDR_PRE_SALES'),
  },
  CRM_MARKETING: {
    role: 'CRM_MARKETING',
    label: 'Marketing Hub, Growth ABM & Automação',
    badgeColor: 'bg-orange-500 text-white',
    description:
      'Controle total de Campanhas & ROI, E-mail Marketing ABM, Listas Ativas, Lead Scoring, Formulários Web, Workflows DAG e Higienização Data Health.',
    portfolioScope: 'ALL',
    itemPermissions: buildDefaultCrmItemPermissions('CRM_MARKETING'),
  },
  CRM_SERVICE_NOC: {
    role: 'CRM_SERVICE_NOC',
    label: 'Atendimento, Service Hub & Engenharia NOC',
    badgeColor: 'bg-purple-600 text-white',
    description:
      'Controle total da Central de Chamados JSM (Filas NOC N1/N2/N3, RMA e Faturamento), SLA Dinâmico, Notas Internas e Portal do Cliente (/portal).',
    portfolioScope: 'TEAM',
    itemPermissions: buildDefaultCrmItemPermissions('CRM_SERVICE_NOC'),
  },
  CRM_NONE: {
    role: 'CRM_NONE',
    label: 'Sem Acesso ao CRM (Exclusivo ERP)',
    badgeColor: 'bg-slate-400 text-white',
    description: 'Usuário sem acesso aos módulos do CRM (opera exclusivamente no ERP).',
    portfolioScope: 'OWN_ONLY',
    itemPermissions: buildDefaultCrmItemPermissions('CRM_NONE'),
  },
};

export const ERP_ROLES_CATALOG: Record<ErpAccountRole, ErpRoleDefinitionMatrix> = {
  ERP_ADMIN: {
    role: 'ERP_ADMIN',
    label: 'Administrador ERP (Acesso Total SETA ERP)',
    badgeColor: 'bg-emerald-600 text-white',
    description:
      'Controle total (Visualizar, Editar e Deletar) em todas as 12 categorias e 20 itens do ERP (Cadastros, Produtos/S/N, Orçamentos #4695, Vendas, O.S., Estoque/Compras, Financeiro/Bancos/DRE, Fiscal SV 31, Contratos e Configurações).',
    maxDiscountPercent: 100,
    canViewBankBalances: true,
    canIssueFiscalDocuments: true,
    canApproveProposals: true,
    itemPermissions: buildDefaultErpItemPermissions('ERP_ADMIN'),
  },
  ERP_COMMERCIAL: {
    role: 'ERP_COMMERCIAL',
    label: 'Comercial ERP (Orçamentos #4695, Clientes & Vendas)',
    badgeColor: 'bg-sky-600 text-white',
    description:
      'Elaboração, versionamento e aprovação de Propostas Comerciais (#4695), Cadastro de Clientes PJ/PF, Pedidos de Venda e geração de Contratos de Locação.',
    maxDiscountPercent: 20,
    canViewBankBalances: false,
    canIssueFiscalDocuments: false,
    canApproveProposals: true,
    itemPermissions: buildDefaultErpItemPermissions('ERP_COMMERCIAL'),
  },
  ERP_FINANCE: {
    role: 'ERP_FINANCE',
    label: 'Financeiro & Fiscal ERP (Bancos, DRE, Contratos & NF-e/SV 31)',
    badgeColor: 'bg-teal-600 text-white',
    description:
      'Gestão completa de Contas a Pagar/Receber, Contas Bancárias (Inter/Itaú), Conciliação OFX, Boletos/PIX, DRE, Contratos de Locação e Emissão Fiscal (Fatura 0% ISS SV 31 STF, NFS-e e NF-e).',
    maxDiscountPercent: 15,
    canViewBankBalances: true,
    canIssueFiscalDocuments: true,
    canApproveProposals: true,
    itemPermissions: buildDefaultErpItemPermissions('ERP_FINANCE'),
  },
  ERP_STOCK_MANAGER: {
    role: 'ERP_STOCK_MANAGER',
    label: 'Gerência de Estoque & Compras (S/N, Movimentações, Cotações & XML)',
    badgeColor: 'bg-indigo-600 text-white',
    description:
      'Controle total (Visualizar, Editar e Deletar) em Estoque, Movimentações, Ajustes, Transferências, Cotações de Fornecedores, Pedidos de Compra (Importação XML NF-e), Catálogo de Produtos/S/N, Fornecedores, Transportadoras e O.S.',
    maxDiscountPercent: 15,
    canViewBankBalances: false,
    canIssueFiscalDocuments: true,
    canApproveProposals: false,
    itemPermissions: buildDefaultErpItemPermissions('ERP_STOCK_MANAGER'),
  },
  ERP_CONTRACTS_OS: {
    role: 'ERP_CONTRACTS_OS',
    label: 'Gestão de Contratos, Patrimônio S/N & Ordens de Serviço (O.S.)',
    badgeColor: 'bg-purple-600 text-white',
    description:
      'Gestão de Contratos de Locação, controle de equipamentos por Número de Série (S/N), devoluções parciais Pro-Rata, RMA e execução de Ordens de Serviço (1.378 O.S.).',
    maxDiscountPercent: 10,
    canViewBankBalances: false,
    canIssueFiscalDocuments: false,
    canApproveProposals: false,
    itemPermissions: buildDefaultErpItemPermissions('ERP_CONTRACTS_OS'),
  },
  ERP_PDV_BALCAO: {
    role: 'ERP_PDV_BALCAO',
    label: 'Operador de PDV / Frente de Caixa & Expedição',
    badgeColor: 'bg-amber-600 text-white',
    description:
      'Operação de Vendas de Balcão (PDV), recebimento PIX/Cartão, emissão de NFC-e Mod. 65 e consulta de produtos/estoque.',
    maxDiscountPercent: 5,
    canViewBankBalances: false,
    canIssueFiscalDocuments: true,
    canApproveProposals: false,
    itemPermissions: buildDefaultErpItemPermissions('ERP_PDV_BALCAO'),
  },
  ERP_NONE: {
    role: 'ERP_NONE',
    label: 'Sem Acesso ao ERP (Exclusivo CRM)',
    badgeColor: 'bg-slate-400 text-white',
    description: 'Usuário sem acesso aos módulos do ERP (opera exclusivamente no CRM).',
    maxDiscountPercent: 0,
    canViewBankBalances: false,
    canIssueFiscalDocuments: false,
    canApproveProposals: false,
    itemPermissions: buildDefaultErpItemPermissions('ERP_NONE'),
  },
};

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
  itemPermissions: Record<string, CrudPermissionFlags>;
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
    label: 'Administrador Geral • Diretoria Seta Telecom',
    badgeColor: 'bg-emerald-500 text-slate-950',
    description:
      'Acesso total irrestrito (Visualizar, Editar e Deletar) a todos os módulos e itens de CRM e ERP, Fiscal, Contas Bancárias, RBAC e 2FA Google Authenticator.',
    portfolioScope: 'ALL',
    maxDiscountPercent: 100,
    itemPermissions: buildDefaultItemPermissionsForRole('SUPER_ADMIN'),
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
    label: 'Comercial (Gestor) • Sales Hub Pro & Propostas',
    badgeColor: 'bg-sky-500 text-white',
    description:
      'Acesso total ao Sales Hub (Deals, Pipelines, Forecast, Metas, Sequências), Contatos & Empresas, Orçamentos e Contratos; leitura em Financeiro; sem exclusão bancária.',
    portfolioScope: 'ALL',
    maxDiscountPercent: 25,
    itemPermissions: buildDefaultItemPermissionsForRole('SALES_MANAGER'),
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
    label: 'Comercial (Executivo) • Contas B2B (Própria Carteira)',
    badgeColor: 'bg-blue-600 text-white',
    description:
      'Acesso ao Sales Hub, Contatos & Empresas e Orçamentos restrito à própria carteira; desconto máximo de 10% sem aprovação; sem acesso a Bancos/DRE.',
    portfolioScope: 'OWN_ONLY',
    maxDiscountPercent: 10,
    itemPermissions: buildDefaultItemPermissionsForRole('SALES_REP'),
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
    label: 'Marketing Hub & Growth ABM',
    badgeColor: 'bg-orange-500 text-white',
    description:
      'Acesso total ao Marketing Hub (Campanhas, E-mail Marketing, Web Forms, Landing Pages, Segmentos/Listas, Lead Scoring e Workflows) e Contatos.',
    portfolioScope: 'ALL',
    maxDiscountPercent: 0,
    itemPermissions: buildDefaultItemPermissionsForRole('MARKETING_SPECIALIST'),
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
    label: 'Financeiro & Fiscal (Contas, Bancos, DRE & Notas)',
    badgeColor: 'bg-teal-600 text-white',
    description:
      'Acesso total ao ERP Financeiro (Contas a Pagar/Receber, Bancos Inter/Itaú, Boletos, DRE), Contratos de Locação e Fiscal (LC 116/03 + SV 31 STF, NFS-e, NF-e).',
    portfolioScope: 'ALL',
    maxDiscountPercent: 15,
    itemPermissions: buildDefaultItemPermissionsForRole('ERP_FINANCE_FISCAL'),
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
  STOCK_MANAGER: {
    role: 'STOCK_MANAGER',
    label: 'Gerência de Estoque & Compras (S/N, Movimentações & Cotações)',
    badgeColor: 'bg-indigo-600 text-white',
    description:
      'Controle completo (Visualizar, Editar e Deletar) de Estoque, Movimentações, Transferências, Cotações, Pedidos de Compra XML, Catálogo de Produtos/S/N, Fornecedores e Ordens de Serviço.',
    portfolioScope: 'ALL',
    maxDiscountPercent: 15,
    itemPermissions: buildDefaultItemPermissionsForRole('STOCK_MANAGER'),
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
      emitFiscalInvoices: true,
      editProposalsAndQuotes: false,
      manageContracts: true,
      operatePdvPos: true,
      manageStockAndPurchases: true,
      manageServiceOrders: true,
      deleteRecords: true,
    },
  },
  SUPPORT_NOC_OS: {
    role: 'SUPPORT_NOC_OS',
    label: 'Engenharia NOC, Chamados & Ordens de Serviço',
    badgeColor: 'bg-purple-600 text-white',
    description:
      'Acesso total ao Service Desk (Tickets/SLA 24x7), ERP Ordens de Serviço (1.378 O.S.) e consulta de Números de Série (S/N) no Estoque.',
    portfolioScope: 'ALL',
    maxDiscountPercent: 0,
    itemPermissions: buildDefaultItemPermissionsForRole('SUPPORT_NOC_OS'),
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
      'Acesso dedicado ao PDV Balcão, Catálogo de Itens, Movimentações de Estoque e Controle de S/N; sem acesso a Bancos/DRE.',
    portfolioScope: 'OWN_ONLY',
    maxDiscountPercent: 5,
    itemPermissions: buildDefaultItemPermissionsForRole('PDV_STOCK_OPERATOR'),
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
  crmRole?: CrmAccountRole;
  erpRole?: ErpAccountRole;
  crmItemPermissions?: CrmModuleItemPermissions;
  erpItemPermissions?: ErpModuleItemPermissions;
  itemPermissions?: Record<string, CrudPermissionFlags>;
  department: string;
  jobTitle?: string;
  phone: string;
  portfolioScope?: 'ALL' | 'TEAM' | 'OWN_ONLY';
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
    crmRole: 'CRM_ADMIN',
    erpRole: 'ERP_ADMIN',
    crmItemPermissions: buildDefaultCrmItemPermissions('CRM_ADMIN'),
    erpItemPermissions: buildDefaultErpItemPermissions('ERP_ADMIN'),
    itemPermissions: buildDefaultItemPermissionsForRole('SUPER_ADMIN'),
    department: 'Diretoria Executiva & Comercial',
    jobTitle: 'CEO & Diretor Executivo (Super Admin)',
    phone: '(11) 3958-4929',
    portfolioScope: 'ALL',
    hubspotOwnerId: '31598215',
    gestaoClickUserId: '203922',
    enabledModules: ['CRM', 'ERP', 'CHAMADOS'],
    totpSecret: 'JBSWY3DPEHPK3PXPSETA4369067MARCE',
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
    crmRole: 'CRM_SALES_MANAGER',
    erpRole: 'ERP_COMMERCIAL',
    crmItemPermissions: buildDefaultCrmItemPermissions('CRM_SALES_MANAGER'),
    erpItemPermissions: buildDefaultErpItemPermissions('ERP_COMMERCIAL'),
    itemPermissions: buildDefaultItemPermissionsForRole('SALES_MANAGER'),
    department: 'Gestão Comercial & Operações B2B',
    jobTitle: 'Gerente Comercial & RevOps',
    phone: '(11) 3958-4929',
    portfolioScope: 'ALL',
    hubspotOwnerId: '77388429',
    gestaoClickUserId: '1062504',
    enabledModules: ['CRM', 'ERP', 'CHAMADOS'],
    totpSecret: 'JBSWY3DPEHPK3PXPSETA4369067EVELY',
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
    crmRole: 'CRM_SERVICE_NOC',
    erpRole: 'ERP_CONTRACTS_OS',
    crmItemPermissions: buildDefaultCrmItemPermissions('CRM_SERVICE_NOC'),
    erpItemPermissions: buildDefaultErpItemPermissions('ERP_CONTRACTS_OS'),
    itemPermissions: buildDefaultItemPermissionsForRole('SUPPORT_NOC_OS'),
    department: 'Coordenação Técnica NOC & O.S.',
    jobTitle: 'Coordenadora NOC & Contratos',
    phone: '(11) 3957-0498',
    portfolioScope: 'TEAM',
    hubspotOwnerId: '31635147',
    gestaoClickUserId: '206343',
    enabledModules: ['CHAMADOS', 'ERP'],
    totpSecret: 'JBSWY3DPEHPK3PXPSETA4369067MICHE',
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
    crmRole: 'CRM_NONE',
    erpRole: 'ERP_FINANCE',
    crmItemPermissions: buildDefaultCrmItemPermissions('CRM_NONE'),
    erpItemPermissions: buildDefaultErpItemPermissions('ERP_FINANCE'),
    itemPermissions: buildDefaultItemPermissionsForRole('ERP_FINANCE_FISCAL'),
    department: 'Financeiro, Contratos & Faturamento Fiscal',
    jobTitle: 'Gestora Financeira & Fiscal',
    phone: '(11) 3958-4929',
    portfolioScope: 'ALL',
    hubspotOwnerId: '1362597717',
    gestaoClickUserId: '1063375',
    enabledModules: ['ERP'],
    totpSecret: 'JBSWY3DPEHPK3PXPSETA4369067DAUAN',
    mfaEnabled: true,
    mfaMethod: 'EMAIL_OTP',
    active: true,
    lastLoginAt: '2026-10-26T12:20:00.000Z',
  },
  {
    id: 'usr-estoque',
    name: 'Ricardo Mendes (Gerência de Estoque)',
    email: 'estoque@setatelecom.com.br',
    role: 'STOCK_MANAGER',
    crmRole: 'CRM_NONE',
    erpRole: 'ERP_STOCK_MANAGER',
    crmItemPermissions: buildDefaultCrmItemPermissions('CRM_NONE'),
    erpItemPermissions: buildDefaultErpItemPermissions('ERP_STOCK_MANAGER'),
    itemPermissions: buildDefaultItemPermissionsForRole('STOCK_MANAGER'),
    department: 'Gerência de Estoque, Compras & Patrimônio S/N',
    jobTitle: 'Gerente de Estoque & Suprimentos Telecom',
    phone: '(11) 3958-4929',
    portfolioScope: 'ALL',
    gestaoClickUserId: '1026190',
    enabledModules: ['ERP'],
    totpSecret: 'JBSWY3DPEHPK3PXPSETA4369067ESTOQ',
    mfaEnabled: true,
    mfaMethod: 'TOTP_AUTHENTICATOR',
    active: true,
    lastLoginAt: '2026-10-26T11:40:00.000Z',
  },
  {
    id: 'usr-wesley',
    name: 'Wesley Brito',
    email: 'pdv@setatelecom.com.br',
    role: 'PDV_STOCK_OPERATOR',
    crmRole: 'CRM_NONE',
    erpRole: 'ERP_PDV_BALCAO',
    crmItemPermissions: buildDefaultCrmItemPermissions('CRM_NONE'),
    erpItemPermissions: buildDefaultErpItemPermissions('ERP_PDV_BALCAO'),
    itemPermissions: buildDefaultItemPermissionsForRole('PDV_STOCK_OPERATOR'),
    department: 'Almoxarifado, Estoque & Expedição S/N',
    jobTitle: 'Operador de Almoxarifado & PDV',
    phone: '(11) 3958-4929',
    portfolioScope: 'OWN_ONLY',
    gestaoClickUserId: '1026185',
    enabledModules: ['ERP'],
    totpSecret: 'JBSWY3DPEHPK3PXPSETA4369067WESLE',
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
    crmRole: 'CRM_MARKETING',
    erpRole: 'ERP_NONE',
    crmItemPermissions: buildDefaultCrmItemPermissions('CRM_MARKETING'),
    erpItemPermissions: buildDefaultErpItemPermissions('ERP_NONE'),
    itemPermissions: buildDefaultItemPermissionsForRole('MARKETING_SPECIALIST'),
    department: 'Marketing Hub, ABM & Geração de Demanda',
    jobTitle: 'Especialista Marketing Hub & ABM',
    phone: '(11) 3958-4929',
    portfolioScope: 'ALL',
    hubspotOwnerId: '82216682',
    enabledModules: ['CRM'],
    totpSecret: 'JBSWY3DPEHPK3PXPSETA4369067KARIS',
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
    crmRole: 'CRM_SALES_REP',
    erpRole: 'ERP_COMMERCIAL',
    crmItemPermissions: buildDefaultCrmItemPermissions('CRM_SALES_REP'),
    erpItemPermissions: buildDefaultErpItemPermissions('ERP_COMMERCIAL'),
    itemPermissions: buildDefaultItemPermissionsForRole('SALES_REP'),
    department: 'Vendas Consultivas Telecom',
    jobTitle: 'Executiva de Contas B2B',
    phone: '(11) 3958-4929',
    portfolioScope: 'OWN_ONLY',
    hubspotOwnerId: '91941475',
    gestaoClickUserId: '1349279',
    enabledModules: ['CRM', 'ERP'],
    totpSecret: 'JBSWY3DPEHPK3PXPSETA4369067PAULA',
    mfaEnabled: true,
    mfaMethod: 'TOTP_AUTHENTICATOR',
    active: true,
    lastLoginAt: '2026-10-26T09:50:00.000Z',
  },
  {
    id: 'usr-inativo-diego',
    name: 'Diego Batista (Ex-Técnico de Campo)',
    email: 'diego.batista@setatelecom.com.br',
    role: 'SUPPORT_NOC_OS',
    crmRole: 'CRM_SERVICE_NOC',
    erpRole: 'ERP_CONTRACTS_OS',
    crmItemPermissions: buildDefaultCrmItemPermissions('CRM_SERVICE_NOC'),
    erpItemPermissions: buildDefaultErpItemPermissions('ERP_CONTRACTS_OS'),
    itemPermissions: buildDefaultItemPermissionsForRole('SUPPORT_NOC_OS'),
    department: 'Field Service & O.S. (Histórico)',
    jobTitle: 'Ex-Técnico de Campo Telecom',
    phone: '(11) 91111-0003',
    portfolioScope: 'OWN_ONLY',
    gestaoClickUserId: '198003',
    enabledModules: ['CHAMADOS', 'ERP'],
    totpSecret: 'JBSWY3DPEHPK3PXPSETA4369067DIEGO',
    mfaEnabled: false,
    mfaMethod: 'EMAIL_OTP',
    active: false,
    lastLoginAt: '2025-11-14T18:00:00.000Z',
  },
  {
    id: 'usr-inativo-priscila',
    name: 'Priscila Monteiro (Ex-Financeiro)',
    email: 'priscila.monteiro@setatelecom.com.br',
    role: 'ERP_FINANCE_FISCAL',
    crmRole: 'CRM_NONE',
    erpRole: 'ERP_FINANCE',
    crmItemPermissions: buildDefaultCrmItemPermissions('CRM_NONE'),
    erpItemPermissions: buildDefaultErpItemPermissions('ERP_FINANCE'),
    itemPermissions: buildDefaultItemPermissionsForRole('ERP_FINANCE_FISCAL'),
    department: 'Financeiro & Faturamento (Histórico)',
    jobTitle: 'Ex-Assistente Financeiro',
    phone: '(11) 91111-0004',
    portfolioScope: 'OWN_ONLY',
    gestaoClickUserId: '198004',
    enabledModules: ['ERP'],
    totpSecret: 'JBSWY3DPEHPK3PXPSETA4369067PRISC',
    mfaEnabled: false,
    mfaMethod: 'EMAIL_OTP',
    active: false,
    lastLoginAt: '2025-09-20T17:30:00.000Z',
  },
  {
    id: 'usr-inativo-fabio',
    name: 'Fábio Santana (Ex-Consultor Comercial)',
    email: 'fabio.santana@setatelecom.com.br',
    role: 'SALES_REP',
    crmRole: 'CRM_SALES_REP',
    erpRole: 'ERP_COMMERCIAL',
    crmItemPermissions: buildDefaultCrmItemPermissions('CRM_SALES_REP'),
    erpItemPermissions: buildDefaultErpItemPermissions('ERP_COMMERCIAL'),
    itemPermissions: buildDefaultItemPermissionsForRole('SALES_REP'),
    department: 'Comercial B2B (Histórico)',
    jobTitle: 'Ex-Consultor Comercial',
    phone: '(11) 91111-0005',
    portfolioScope: 'OWN_ONLY',
    gestaoClickUserId: '198005',
    enabledModules: ['CRM', 'ERP'],
    totpSecret: 'JBSWY3DPEHPK3PXPSETA4369067FABIO',
    mfaEnabled: false,
    mfaMethod: 'EMAIL_OTP',
    active: false,
    lastLoginAt: '2025-10-10T16:15:00.000Z',
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
      'Olá, {{contato.nome}} ({{empresa.razao_social}}),\n\nSegue para sua avaliação e aprovação a nossa Proposta Comercial Nº #{{proposta.numero}}, elaborada pela SETA TELECOM LTDA (SETA | IT).\n\n• Valor Total: {{proposta.valor_total}}\n• Validade: {{proposta.validade}}\n• Enquadramento Fiscal: Dispensa legal de ISSQN em locação de bens móveis (LC 116/2003 e Súmula Vinculante 31 do STF).\n\nLink Oficial para Visualizar e Imprimir o PDF (A4):\n{{proposta.link_pdf}}\n\nAtenciosamente,\nMarcelo Lopes Mira — Diretoria Seta Telecom (11) 3958-4929',
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
