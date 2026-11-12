// ============================================================================
// Navegação única sti-hub no padrão HubSpot.
// Só mapeia telas que já existem (CRM, ERP, Chamados e configurações).
// Itens do HubSpot sem equivalente não entram no menu.
// Nenhuma tela existente fica órfã.
// ============================================================================

export type GestaoClickMenuSection = string;
export type MarketingHubSubView =
  | 'MARKETING_EMAILS'
  | 'CAMPAIGNS_ROI'
  | 'EMAIL_MARKETING'
  | 'SEGMENTS_SCORING'
  | 'FORMS_LANDING_PAGES';
export type AdminSubView = string;

export interface MenuTreeGroup {
  id: string;
  subItems?: Array<{ id: string; label?: string }>;
}
import {
  ERP_HIDDEN_MENU_SUB_ITEMS,
  isErpConfigItemVisible,
  type ErpConfigAccess,
} from './erp-config-access';

export type HubspotNavCategory =
  | 'CRM'
  | 'MARKETING'
  | 'VENDAS'
  | 'RECEITA'
  | 'SERVICO'
  | 'DADOS'
  | 'AUTOMACAO'
  | 'RELATORIOS'
  | 'ERP';

export type RailGroupId = 'MARKETING' | 'VENDAS' | 'PLATAFORMA';

export type SettingsGroupId =
  | 'PREFERENCIAS'
  | 'CONTA'
  | 'DADOS'
  | 'FERRAMENTAS';

export type NavIconId =
  | 'home'
  | 'deals'
  | 'tasks'
  | 'contacts'
  | 'companies'
  | 'segments'
  | 'mail'
  | 'campaigns'
  | 'forms'
  | 'workflow'
  | 'forecast'
  | 'health'
  | 'settings'
  | 'tickets'
  | 'products'
  | 'orders'
  | 'services'
  | 'quotes'
  | 'contracts'
  | 'invoices'
  | 'payments'
  | 'subscriptions'
  | 'helpdesk'
  | 'portal'
  | 'os'
  | 'stock'
  | 'finance'
  | 'fiscal'
  | 'reports'
  | 'users'
  | 'building'
  | 'truck'
  | 'inbox'
  | 'templates'
  | 'dashboard';

export type CrmModuleId =
  | 'OVERVIEW_AI'
  | 'DEALS_KANBAN'
  | 'CONTACTS_COMPANIES'
  | 'MARKETING_FORMS'
  | 'AUTOMATIONS'
  | 'DATA_HEALTH'
  | 'ADMIN_RBAC';

export type NavTarget =
  | {
      type: 'crm';
      module: CrmModuleId;
      contactsSub?: 'CONTACTS' | 'COMPANIES' | 'TASKS';
      marketingSub?: MarketingHubSubView;
      dataHealthScope?: 'CRM' | 'ERP';
      adminSubView?: AdminSubView;
    }
  | { type: 'erp'; section: GestaoClickMenuSection; subId: string }
  | { type: 'service'; tab: 'OPERATIONS' | 'DASHBOARD_CHAMADOS' | 'DATA_HEALTH_CHAMADOS' }
  | { type: 'settings'; itemId: string }
  | { type: 'external'; href: string };

export interface HubspotNavItem {
  id: string;
  label: string;
  category: HubspotNavCategory;
  icon: NavIconId;
  target: NavTarget;
  /** Grupo recolhível da barra esquerda (além dos pins). */
  railGroup?: RailGroupId;
  defaultPinned?: boolean;
  /** Início fica sempre no topo e não entra nos pins. */
  alwaysOnTop?: boolean;
  module: 'crm' | 'erp' | 'chamados' | 'any';
  /** Permissão de item CRM/ERP; se o mapa trouxer view === false, o item some. */
  permissionKey?: string;
  /** Usa as regras atuais de filterErpMenuTree (relatórios / configurações). */
  erpConfigSubId?: string;
  requiresReports?: boolean;
  /** Tela existente, mas ocultada de propósito (ex.: PDV). */
  hiddenOnPurpose?: boolean;
  screenKey: string;
}

export interface SettingsNavItem {
  id: string;
  label: string;
  group: SettingsGroupId;
  groupLabel: string;
  /** Aba de "Geral" (Suas preferências). */
  preferenciasTab?: 'PERFIL' | 'EMAIL' | 'SEGURANCA';
  adminSubView?: AdminSubView;
  erpConfigSubId?: string;
  /** Sempre visível para o usuário autenticado (Minha Conta). */
  alwaysForUser?: boolean;
  requiresAdmin?: boolean;
  requiresCertificate?: boolean;
  screenKey: string;
  keywords: string[];
}

export interface NavAccessContext {
  moduleAccess: { crm: boolean; erp: boolean; chamados: boolean };
  erpConfig: ErpConfigAccess | null;
  /** view por item (crm.* / erp.*). Ausente => vale o acesso ao módulo, como hoje. */
  itemView?: Record<string, { view?: boolean } | undefined>;
}

export interface CurrentNavLocation {
  module: string;
  contactsSub?: 'CONTACTS' | 'COMPANIES' | 'TASKS';
  marketingSub?: MarketingHubSubView;
  dataHealthScope?: 'CRM' | 'ERP';
  erpSection?: string;
  erpSubId?: string;
  serviceTab?: string;
  settingsItemId?: string;
}

export const NAV_PINS_STORAGE_PREFIX = 'stihub_nav_pins_v2:';
export const LEGACY_PINS_STORAGE_KEY = 'stihub_crm_sidebar_pins_v1';

export const DEFAULT_PIN_IDS: string[] = [
  'deals',
  'tasks',
  'contacts',
  'companies',
  'segments',
];

export const RAIL_GROUPS: Array<{ id: RailGroupId; label: string }> = [
  { id: 'MARKETING', label: 'Marketing' },
  { id: 'VENDAS', label: 'Vendas' },
  { id: 'PLATAFORMA', label: 'Plataforma' },
];

export const SETTINGS_GROUPS: Array<{ id: SettingsGroupId; label: string }> = [
  { id: 'PREFERENCIAS', label: 'Suas preferências' },
  { id: 'CONTA', label: 'Gerenciamento de conta' },
  { id: 'DADOS', label: 'Gerenciamento de dados' },
  { id: 'FERRAMENTAS', label: 'Ferramentas' },
];

/** Itens do HubSpot sem tela equivalente no sti-hub — não aparecem no menu. */
export const HUBSPOT_OMITTED_ITEMS: Array<{ category: string; label: string; reason: string }> = [
  { category: 'CRM', label: 'Chamadas', reason: 'Não há tela de chamadas no sti-hub.' },
  { category: 'CRM', label: 'Reuniões', reason: 'Não há tela de reuniões no sti-hub.' },
  { category: 'CRM', label: 'Caixa de entrada', reason: 'Não há inbox operacional; as caixas Outlook ficam em Configurações.' },
  { category: 'CRM', label: 'Snippets', reason: 'Não há tela de snippets.' },
  { category: 'CRM', label: 'Manuais de atividades', reason: 'Não há tela de manuais de atividades.' },
  { category: 'Marketing', label: 'Anúncios', reason: 'Não há módulo de anúncios.' },
  { category: 'Marketing', label: 'Eventos', reason: 'Não há módulo de eventos.' },
  { category: 'Marketing', label: 'Marca', reason: 'Não há kit de marca de marketing; a marca da empresa fica em Configurações.' },
  { category: 'Marketing', label: 'Redes sociais', reason: 'Não há módulo de redes sociais.' },
  { category: 'Marketing', label: 'Pontuação de leads', reason: 'A tela existente já está em Segmentos (Segmentos & Lead Scoring).' },
  { category: 'Marketing', label: 'Análise de marketing', reason: 'A análise existente já está em Campanhas & ROI.' },
  { category: 'Conteúdo', label: 'Conteúdo (categoria)', reason: 'Não há módulo de conteúdo / CMS.' },
  { category: 'Vendas', label: 'Calendar', reason: 'Não há calendário de vendas.' },
  { category: 'Vendas', label: 'Agendador de reuniões', reason: 'Não há agendador de reuniões.' },
  { category: 'Vendas', label: 'Atividades', reason: 'A tela equivalente já está em Tarefas.' },
  { category: 'Vendas', label: 'Documentos', reason: 'A aba Documentos do compositor permanece bloqueada; não há tela.' },
  { category: 'Receita', label: 'Links de pagamento', reason: 'Não há tela de links de pagamento.' },
  { category: 'Serviço', label: 'Pesquisas', reason: 'Não há tela de pesquisas / CSAT além do portal.' },
  { category: 'Gerenciamento de dados', label: 'Modelo de dados', reason: 'Não há tela de modelo de dados.' },
  { category: 'Desenvolvimento', label: 'Desenvolvimento (categoria)', reason: 'Não há área de desenvolvimento no sti-hub.' },
  { category: 'Configurações', label: 'Chamadas / Calendário / Tarefas / Automação (abas de Geral)', reason: 'Não há essas preferências pessoais no sti-hub.' },
  { category: 'Configurações', label: 'Privacidade', reason: 'Não há tela de privacidade.' },
  { category: 'Configurações', label: 'Objetos', reason: 'Não há tela de objetos customizados.' },
  { category: 'Configurações', label: 'Importar e exportar', reason: 'Não há tela dedicada de importação/exportação.' },
  { category: 'Configurações', label: 'Reuniões / Chamadas / Marketing / Conteúdos / Portais (ferramentas)', reason: 'Não há essas telas de ferramenta.' },
];

export const HUBSPOT_NAV_ITEMS: HubspotNavItem[] = [
  {
    id: 'home',
    label: 'Início',
    category: 'CRM',
    icon: 'home',
    alwaysOnTop: true,
    module: 'any',
    target: { type: 'crm', module: 'OVERVIEW_AI' },
    screenKey: 'crm:OVERVIEW_AI',
  },
  {
    id: 'deals',
    label: 'Negócios',
    category: 'CRM',
    icon: 'deals',
    defaultPinned: true,
    module: 'crm',
    permissionKey: 'crm.deals_kanban',
    target: { type: 'crm', module: 'DEALS_KANBAN' },
    screenKey: 'crm:DEALS_KANBAN',
  },
  {
    id: 'tasks',
    label: 'Tarefas',
    category: 'CRM',
    icon: 'tasks',
    defaultPinned: true,
    module: 'crm',
    permissionKey: 'crm.contacts',
    target: { type: 'crm', module: 'CONTACTS_COMPANIES', contactsSub: 'TASKS' },
    screenKey: 'crm:CONTACTS_COMPANIES:TASKS',
  },
  {
    id: 'contacts',
    label: 'Contatos',
    category: 'CRM',
    icon: 'contacts',
    defaultPinned: true,
    module: 'crm',
    permissionKey: 'crm.contacts',
    target: { type: 'crm', module: 'CONTACTS_COMPANIES', contactsSub: 'CONTACTS' },
    screenKey: 'crm:CONTACTS_COMPANIES:CONTACTS',
  },
  {
    id: 'companies',
    label: 'Empresas',
    category: 'CRM',
    icon: 'companies',
    defaultPinned: true,
    module: 'crm',
    permissionKey: 'crm.companies',
    target: { type: 'crm', module: 'CONTACTS_COMPANIES', contactsSub: 'COMPANIES' },
    screenKey: 'crm:CONTACTS_COMPANIES:COMPANIES',
  },
  {
    id: 'segments',
    label: 'Segmentos',
    category: 'CRM',
    icon: 'segments',
    defaultPinned: true,
    module: 'crm',
    permissionKey: 'crm.marketing_lists_scoring_forms',
    target: { type: 'crm', module: 'MARKETING_FORMS', marketingSub: 'SEGMENTS_SCORING' },
    screenKey: 'crm:MARKETING_FORMS:SEGMENTS_SCORING',
  },
  {
    id: 'tickets',
    label: 'Tickets',
    category: 'CRM',
    icon: 'tickets',
    module: 'chamados',
    permissionKey: 'chamados.filas_noc',
    target: { type: 'service', tab: 'OPERATIONS' },
    screenKey: 'service:OPERATIONS',
  },
  {
    id: 'products',
    label: 'Produtos',
    category: 'CRM',
    icon: 'products',
    module: 'erp',
    permissionKey: 'erp.itens_produtos',
    target: { type: 'erp', section: 'ITENS', subId: 'ITENS_PRODUTOS' },
    screenKey: 'erp:ITENS:ITENS_PRODUTOS',
  },
  {
    id: 'services-catalog',
    label: 'Serviços',
    category: 'CRM',
    icon: 'services',
    module: 'erp',
    permissionKey: 'erp.itens_servicos',
    target: { type: 'erp', section: 'ITENS', subId: 'ITENS_SERVICOS' },
    screenKey: 'erp:ITENS:ITENS_SERVICOS',
  },
  {
    id: 'orders',
    label: 'Pedidos',
    category: 'CRM',
    icon: 'orders',
    module: 'erp',
    permissionKey: 'erp.vendas_pedidos',
    target: { type: 'erp', section: 'VENDAS', subId: 'VENDAS_TODAS' },
    screenKey: 'erp:VENDAS:VENDAS_TODAS',
  },
  {
    id: 'templates',
    label: 'Modelos de mensagens',
    category: 'CRM',
    icon: 'templates',
    module: 'any',
    target: { type: 'settings', itemId: 'email-templates' },
    screenKey: 'settings:EMAIL_TEMPLATES',
  },
  {
    id: 'marketing-emails',
    label: 'E-mails de marketing',
    category: 'MARKETING',
    icon: 'mail',
    railGroup: 'MARKETING',
    module: 'crm',
    permissionKey: 'crm.marketing_campaigns',
    target: { type: 'crm', module: 'MARKETING_FORMS', marketingSub: 'MARKETING_EMAILS' },
    screenKey: 'crm:MARKETING_FORMS:MARKETING_EMAILS',
  },
  {
    id: 'campaigns',
    label: 'Campanhas',
    category: 'MARKETING',
    icon: 'campaigns',
    module: 'crm',
    permissionKey: 'crm.marketing_campaigns',
    target: { type: 'crm', module: 'MARKETING_FORMS', marketingSub: 'CAMPAIGNS_ROI' },
    screenKey: 'crm:MARKETING_FORMS:CAMPAIGNS_ROI',
  },
  {
    id: 'forms',
    label: 'Formulários',
    category: 'MARKETING',
    icon: 'forms',
    module: 'crm',
    permissionKey: 'crm.marketing_lists_scoring_forms',
    target: { type: 'crm', module: 'MARKETING_FORMS', marketingSub: 'FORMS_LANDING_PAGES' },
    screenKey: 'crm:MARKETING_FORMS:FORMS_LANDING_PAGES',
  },
  {
    id: 'forecast',
    label: 'Previsão',
    category: 'VENDAS',
    icon: 'forecast',
    railGroup: 'VENDAS',
    module: 'crm',
    permissionKey: 'crm.overview_ai',
    target: { type: 'crm', module: 'OVERVIEW_AI' },
    screenKey: 'crm:OVERVIEW_AI',
  },
  {
    id: 'sales-analytics',
    label: 'Análise de vendas',
    category: 'VENDAS',
    icon: 'dashboard',
    module: 'erp',
    requiresReports: true,
    target: { type: 'erp', section: 'RELATORIOS', subId: 'REL_VENDAS' },
    screenKey: 'erp:RELATORIOS:REL_VENDAS',
  },
  {
    id: 'sequences',
    label: 'Sequências',
    category: 'VENDAS',
    icon: 'workflow',
    module: 'crm',
    permissionKey: 'crm.playbooks_meetings_sequences',
    target: { type: 'crm', module: 'AUTOMATIONS' },
    screenKey: 'crm:AUTOMATIONS',
  },
  {
    id: 'revenue-overview',
    label: 'Visão geral da receita',
    category: 'RECEITA',
    icon: 'dashboard',
    module: 'erp',
    permissionKey: 'erp.inicio_dashboard',
    target: { type: 'erp', section: 'INICIO', subId: 'INICIO' },
    screenKey: 'erp:INICIO:INICIO',
  },
  {
    id: 'quotes',
    label: 'Orçamentos',
    category: 'RECEITA',
    icon: 'quotes',
    module: 'erp',
    permissionKey: 'erp.orcamentos_propostas',
    target: { type: 'erp', section: 'ORCAMENTOS', subId: 'ORC_TODOS' },
    screenKey: 'erp:ORCAMENTOS:ORC_TODOS',
  },
  {
    id: 'quotes-products',
    label: 'Propostas de produtos',
    category: 'RECEITA',
    icon: 'quotes',
    module: 'erp',
    permissionKey: 'erp.orcamentos_propostas',
    target: { type: 'erp', section: 'ORCAMENTOS', subId: 'ORC_PRODUTOS' },
    screenKey: 'erp:ORCAMENTOS:ORC_PRODUTOS',
  },
  {
    id: 'quotes-rental',
    label: 'Propostas de locação',
    category: 'RECEITA',
    icon: 'quotes',
    module: 'erp',
    permissionKey: 'erp.orcamentos_propostas',
    target: { type: 'erp', section: 'ORCAMENTOS', subId: 'ORC_LOCACAO' },
    screenKey: 'erp:ORCAMENTOS:ORC_LOCACAO',
  },
  {
    id: 'quotes-services',
    label: 'Propostas de serviços',
    category: 'RECEITA',
    icon: 'quotes',
    module: 'erp',
    permissionKey: 'erp.orcamentos_propostas',
    target: { type: 'erp', section: 'ORCAMENTOS', subId: 'ORC_SERVICOS' },
    screenKey: 'erp:ORCAMENTOS:ORC_SERVICOS',
  },
  {
    id: 'quotes-aux',
    label: 'Opções auxiliares de orçamentos',
    category: 'RECEITA',
    icon: 'quotes',
    module: 'erp',
    permissionKey: 'erp.orcamentos_propostas',
    target: { type: 'erp', section: 'ORCAMENTOS', subId: 'ORC_AUXILIARES' },
    screenKey: 'erp:ORCAMENTOS:ORC_AUXILIARES',
  },
  {
    id: 'contracts',
    label: 'Contratos',
    category: 'RECEITA',
    icon: 'contracts',
    module: 'erp',
    permissionKey: 'erp.contratos_locacoes',
    target: { type: 'erp', section: 'CONTRATOS', subId: 'CTR_TODOS' },
    screenKey: 'erp:CONTRATOS:CTR_TODOS',
  },
  {
    id: 'contracts-rental',
    label: 'Contratos de locação',
    category: 'RECEITA',
    icon: 'contracts',
    module: 'erp',
    permissionKey: 'erp.contratos_locacoes',
    target: { type: 'erp', section: 'CONTRATOS', subId: 'CTR_LOCACOES' },
    screenKey: 'erp:CONTRATOS:CTR_LOCACOES',
  },
  {
    id: 'contracts-services',
    label: 'Contratos de serviços',
    category: 'RECEITA',
    icon: 'contracts',
    module: 'erp',
    permissionKey: 'erp.contratos_locacoes',
    target: { type: 'erp', section: 'CONTRATOS', subId: 'CTR_SERVICOS' },
    screenKey: 'erp:CONTRATOS:CTR_SERVICOS',
  },
  {
    id: 'subscriptions',
    label: 'Assinaturas',
    category: 'RECEITA',
    icon: 'subscriptions',
    module: 'erp',
    permissionKey: 'erp.contratos_locacoes',
    target: { type: 'erp', section: 'CONTRATOS', subId: 'CTR_ASSINATURAS' },
    screenKey: 'erp:CONTRATOS:CTR_ASSINATURAS',
  },
  {
    id: 'contracts-aux',
    label: 'Opções auxiliares de contratos',
    category: 'RECEITA',
    icon: 'contracts',
    module: 'erp',
    permissionKey: 'erp.contratos_locacoes',
    target: { type: 'erp', section: 'CONTRATOS', subId: 'CTR_AUXILIARES' },
    screenKey: 'erp:CONTRATOS:CTR_AUXILIARES',
  },
  {
    id: 'invoices',
    label: 'Faturas',
    category: 'RECEITA',
    icon: 'invoices',
    module: 'erp',
    permissionKey: 'erp.fiscal_notas',
    target: { type: 'erp', section: 'FISCAL', subId: 'FIS_TODAS' },
    screenKey: 'erp:FISCAL:FIS_TODAS',
  },
  {
    id: 'payments',
    label: 'Pagamentos',
    category: 'RECEITA',
    icon: 'payments',
    module: 'erp',
    permissionKey: 'erp.financeiro_pagar_receber',
    target: { type: 'erp', section: 'FINANCEIRO', subId: 'FIN_RECEBER' },
    screenKey: 'erp:FINANCEIRO:FIN_RECEBER',
  },
  {
    id: 'helpdesk',
    label: 'Help Desk',
    category: 'SERVICO',
    icon: 'helpdesk',
    module: 'chamados',
    permissionKey: 'chamados.filas_noc',
    target: { type: 'service', tab: 'OPERATIONS' },
    screenKey: 'service:OPERATIONS',
  },
  {
    id: 'customer-portal',
    label: 'Portal do cliente',
    category: 'SERVICO',
    icon: 'portal',
    module: 'chamados',
    permissionKey: 'chamados.portal_csat',
    target: { type: 'external', href: '/portal' },
    screenKey: 'service:PORTAL',
  },
  {
    id: 'service-analytics',
    label: 'Análise de serviço',
    category: 'SERVICO',
    icon: 'dashboard',
    module: 'chamados',
    permissionKey: 'chamados.sla_notas_os',
    target: { type: 'service', tab: 'DASHBOARD_CHAMADOS' },
    screenKey: 'service:DASHBOARD_CHAMADOS',
  },
  {
    id: 'service-orders',
    label: 'Ordens de serviços',
    category: 'SERVICO',
    icon: 'os',
    module: 'erp',
    permissionKey: 'erp.ordens_servico',
    target: { type: 'erp', section: 'ORDENS_SERVICOS', subId: 'OS_GERENCIAR' },
    screenKey: 'erp:ORDENS_SERVICOS:OS_GERENCIAR',
  },
  {
    id: 'service-orders-panel',
    label: 'Painel de O.S.',
    category: 'SERVICO',
    icon: 'os',
    module: 'erp',
    permissionKey: 'erp.ordens_servico',
    target: { type: 'erp', section: 'ORDENS_SERVICOS', subId: 'OS_PAINEL' },
    screenKey: 'erp:ORDENS_SERVICOS:OS_PAINEL',
  },
  {
    id: 'service-orders-aux',
    label: 'Opções auxiliares de O.S.',
    category: 'SERVICO',
    icon: 'os',
    module: 'erp',
    permissionKey: 'erp.ordens_servico',
    target: { type: 'erp', section: 'ORDENS_SERVICOS', subId: 'OS_AUXILIARES' },
    screenKey: 'erp:ORDENS_SERVICOS:OS_AUXILIARES',
  },
  {
    id: 'atendimentos',
    label: 'Atendimentos',
    category: 'SERVICO',
    icon: 'helpdesk',
    module: 'erp',
    target: { type: 'erp', section: 'ATENDIMENTOS', subId: 'ATENDIMENTOS' },
    screenKey: 'erp:ATENDIMENTOS:ATENDIMENTOS',
  },
  {
    id: 'data-integration',
    label: 'Integração de dados',
    category: 'DADOS',
    icon: 'settings',
    module: 'any',
    target: { type: 'settings', itemId: 'sync-logs' },
    screenKey: 'settings:DAILY_SYNC_LOGS',
  },
  {
    id: 'data-health-crm',
    label: 'Qualidade de dados',
    category: 'DADOS',
    icon: 'health',
    module: 'crm',
    permissionKey: 'crm.data_health',
    target: { type: 'crm', module: 'DATA_HEALTH', dataHealthScope: 'CRM' },
    screenKey: 'crm:DATA_HEALTH:CRM',
  },
  {
    id: 'workflows',
    label: 'Fluxos de trabalho',
    category: 'AUTOMACAO',
    icon: 'workflow',
    railGroup: 'PLATAFORMA',
    module: 'crm',
    permissionKey: 'crm.automations_dag',
    target: { type: 'crm', module: 'AUTOMATIONS' },
    screenKey: 'crm:AUTOMATIONS',
  },
  {
    id: 'dashboards',
    label: 'Painéis',
    category: 'RELATORIOS',
    icon: 'dashboard',
    module: 'any',
    target: { type: 'crm', module: 'OVERVIEW_AI' },
    screenKey: 'crm:OVERVIEW_AI',
  },
  {
    id: 'erp-cad-clientes',
    label: 'Clientes',
    category: 'ERP',
    icon: 'building',
    module: 'erp',
    permissionKey: 'erp.cadastros_clientes',
    target: { type: 'erp', section: 'CADASTROS', subId: 'CAD_CLIENTES' },
    screenKey: 'erp:CADASTROS:CAD_CLIENTES',
  },
  {
    id: 'erp-cad-fornecedores',
    label: 'Fornecedores',
    category: 'ERP',
    icon: 'building',
    module: 'erp',
    permissionKey: 'erp.cadastros_fornecedores',
    target: { type: 'erp', section: 'CADASTROS', subId: 'CAD_FORNECEDORES' },
    screenKey: 'erp:CADASTROS:CAD_FORNECEDORES',
  },
  {
    id: 'erp-cad-funcionarios',
    label: 'Funcionários',
    category: 'ERP',
    icon: 'users',
    module: 'erp',
    permissionKey: 'erp.cadastros_funcionarios',
    target: { type: 'erp', section: 'CADASTROS', subId: 'CAD_FUNCIONARIOS' },
    screenKey: 'erp:CADASTROS:CAD_FUNCIONARIOS',
  },
  {
    id: 'erp-cad-transportadoras',
    label: 'Transportadoras',
    category: 'ERP',
    icon: 'truck',
    module: 'erp',
    permissionKey: 'erp.cadastros_transportadoras',
    target: { type: 'erp', section: 'CADASTROS', subId: 'CAD_TRANSPORTADORAS' },
    screenKey: 'erp:CADASTROS:CAD_TRANSPORTADORAS',
  },
  {
    id: 'erp-cad-aux',
    label: 'Opções auxiliares de cadastros',
    category: 'ERP',
    icon: 'users',
    module: 'erp',
    permissionKey: 'erp.cadastros_clientes',
    target: { type: 'erp', section: 'CADASTROS', subId: 'CAD_AUXILIARES' },
    screenKey: 'erp:CADASTROS:CAD_AUXILIARES',
  },
  {
    id: 'erp-itens-todos',
    label: 'Todos os itens',
    category: 'ERP',
    icon: 'products',
    module: 'erp',
    permissionKey: 'erp.itens_produtos',
    target: { type: 'erp', section: 'ITENS', subId: 'ITENS_TODOS' },
    screenKey: 'erp:ITENS:ITENS_TODOS',
  },
  {
    id: 'erp-itens-aux',
    label: 'Opções auxiliares de itens',
    category: 'ERP',
    icon: 'products',
    module: 'erp',
    permissionKey: 'erp.itens_produtos',
    target: { type: 'erp', section: 'ITENS', subId: 'ITENS_AUXILIARES' },
    screenKey: 'erp:ITENS:ITENS_AUXILIARES',
  },
  {
    id: 'erp-vendas-produtos',
    label: 'Vendas de produtos',
    category: 'ERP',
    icon: 'orders',
    module: 'erp',
    permissionKey: 'erp.vendas_pedidos',
    target: { type: 'erp', section: 'VENDAS', subId: 'VENDAS_PRODUTOS' },
    screenKey: 'erp:VENDAS:VENDAS_PRODUTOS',
  },
  {
    id: 'erp-vendas-servicos',
    label: 'Vendas de serviços',
    category: 'ERP',
    icon: 'orders',
    module: 'erp',
    permissionKey: 'erp.vendas_pedidos',
    target: { type: 'erp', section: 'VENDAS', subId: 'VENDAS_SERVICOS' },
    screenKey: 'erp:VENDAS:VENDAS_SERVICOS',
  },
  {
    id: 'erp-vendas-pdv',
    label: 'Balcão (PDV)',
    category: 'ERP',
    icon: 'orders',
    module: 'erp',
    permissionKey: 'erp.vendas_pdv_balcao',
    target: { type: 'erp', section: 'VENDAS', subId: 'VENDAS_BALCAO' },
    screenKey: 'erp:VENDAS:VENDAS_BALCAO',
    hiddenOnPurpose: true,
  },
  {
    id: 'erp-vendas-devolucoes',
    label: 'Devoluções',
    category: 'ERP',
    icon: 'orders',
    module: 'erp',
    permissionKey: 'erp.vendas_devolucoes',
    target: { type: 'erp', section: 'VENDAS', subId: 'VENDAS_DEVOLUCOES' },
    screenKey: 'erp:VENDAS:VENDAS_DEVOLUCOES',
  },
  {
    id: 'erp-vendas-aux',
    label: 'Opções auxiliares de vendas',
    category: 'ERP',
    icon: 'orders',
    module: 'erp',
    permissionKey: 'erp.vendas_pedidos',
    target: { type: 'erp', section: 'VENDAS', subId: 'VENDAS_AUXILIARES' },
    screenKey: 'erp:VENDAS:VENDAS_AUXILIARES',
  },
  {
    id: 'erp-est-mov',
    label: 'Movimentações de estoque',
    category: 'ERP',
    icon: 'stock',
    module: 'erp',
    permissionKey: 'erp.estoque_movimentacoes',
    target: { type: 'erp', section: 'ESTOQUE', subId: 'EST_MOVIMENTACOES' },
    screenKey: 'erp:ESTOQUE:EST_MOVIMENTACOES',
  },
  {
    id: 'erp-est-ajustes',
    label: 'Ajustes de estoque',
    category: 'ERP',
    icon: 'stock',
    module: 'erp',
    permissionKey: 'erp.estoque_movimentacoes',
    target: { type: 'erp', section: 'ESTOQUE', subId: 'EST_AJUSTES' },
    screenKey: 'erp:ESTOQUE:EST_AJUSTES',
  },
  {
    id: 'erp-est-transf',
    label: 'Transferências de estoque',
    category: 'ERP',
    icon: 'stock',
    module: 'erp',
    permissionKey: 'erp.estoque_movimentacoes',
    target: { type: 'erp', section: 'ESTOQUE', subId: 'EST_TRANSFERENCIAS' },
    screenKey: 'erp:ESTOQUE:EST_TRANSFERENCIAS',
  },
  {
    id: 'erp-est-cotacoes',
    label: 'Cotações',
    category: 'ERP',
    icon: 'stock',
    module: 'erp',
    permissionKey: 'erp.estoque_cotacoes_compras',
    target: { type: 'erp', section: 'ESTOQUE', subId: 'EST_COTACOES' },
    screenKey: 'erp:ESTOQUE:EST_COTACOES',
  },
  {
    id: 'erp-est-compras',
    label: 'Compras',
    category: 'ERP',
    icon: 'stock',
    module: 'erp',
    permissionKey: 'erp.estoque_cotacoes_compras',
    target: { type: 'erp', section: 'ESTOQUE', subId: 'EST_COMPRAS' },
    screenKey: 'erp:ESTOQUE:EST_COMPRAS',
  },
  {
    id: 'erp-est-aux',
    label: 'Opções auxiliares de estoque',
    category: 'ERP',
    icon: 'stock',
    module: 'erp',
    permissionKey: 'erp.estoque_movimentacoes',
    target: { type: 'erp', section: 'ESTOQUE', subId: 'EST_AUXILIARES' },
    screenKey: 'erp:ESTOQUE:EST_AUXILIARES',
  },
  {
    id: 'erp-fin-pagar',
    label: 'Contas a pagar',
    category: 'ERP',
    icon: 'finance',
    module: 'erp',
    permissionKey: 'erp.financeiro_pagar_receber',
    target: { type: 'erp', section: 'FINANCEIRO', subId: 'FIN_PAGAR' },
    screenKey: 'erp:FINANCEIRO:FIN_PAGAR',
  },
  {
    id: 'erp-fin-dre',
    label: 'DRE gerencial',
    category: 'ERP',
    icon: 'finance',
    module: 'erp',
    permissionKey: 'erp.financeiro_bancos_dre',
    target: { type: 'erp', section: 'FINANCEIRO', subId: 'FIN_DRE' },
    screenKey: 'erp:FINANCEIRO:FIN_DRE',
  },
  {
    id: 'erp-fin-fluxo',
    label: 'Fluxo de caixa',
    category: 'ERP',
    icon: 'finance',
    module: 'erp',
    permissionKey: 'erp.financeiro_bancos_dre',
    target: { type: 'erp', section: 'FINANCEIRO', subId: 'FIN_FLUXO' },
    screenKey: 'erp:FINANCEIRO:FIN_FLUXO',
  },
  {
    id: 'erp-fin-boletos',
    label: 'Boletos bancários',
    category: 'ERP',
    icon: 'finance',
    module: 'erp',
    permissionKey: 'erp.financeiro_pagar_receber',
    target: { type: 'erp', section: 'FINANCEIRO', subId: 'FIN_BOLETOS' },
    screenKey: 'erp:FINANCEIRO:FIN_BOLETOS',
  },
  {
    id: 'erp-fin-aux',
    label: 'Opções auxiliares financeiras',
    category: 'ERP',
    icon: 'finance',
    module: 'erp',
    permissionKey: 'erp.financeiro_pagar_receber',
    target: { type: 'erp', section: 'FINANCEIRO', subId: 'FIN_AUXILIARES' },
    screenKey: 'erp:FINANCEIRO:FIN_AUXILIARES',
  },
  {
    id: 'erp-fis-produtos',
    label: 'Notas de produtos',
    category: 'ERP',
    icon: 'fiscal',
    module: 'erp',
    permissionKey: 'erp.fiscal_notas',
    target: { type: 'erp', section: 'FISCAL', subId: 'FIS_PRODUTOS' },
    screenKey: 'erp:FISCAL:FIS_PRODUTOS',
  },
  {
    id: 'erp-fis-servicos',
    label: 'Notas de serviços',
    category: 'ERP',
    icon: 'fiscal',
    module: 'erp',
    permissionKey: 'erp.fiscal_notas',
    target: { type: 'erp', section: 'FISCAL', subId: 'FIS_SERVICOS' },
    screenKey: 'erp:FISCAL:FIS_SERVICOS',
  },
  {
    id: 'erp-fis-consumidor',
    label: 'Notas do consumidor',
    category: 'ERP',
    icon: 'fiscal',
    module: 'erp',
    permissionKey: 'erp.fiscal_notas',
    target: { type: 'erp', section: 'FISCAL', subId: 'FIS_CONSUMIDOR' },
    screenKey: 'erp:FISCAL:FIS_CONSUMIDOR',
  },
  {
    id: 'erp-fis-importacao',
    label: 'NF-e de importação',
    category: 'ERP',
    icon: 'fiscal',
    module: 'erp',
    permissionKey: 'erp.fiscal_notas',
    target: { type: 'erp', section: 'FISCAL', subId: 'FIS_IMPORTACAO' },
    screenKey: 'erp:FISCAL:FIS_IMPORTACAO',
  },
  {
    id: 'erp-fis-compras',
    label: 'Notas de compras',
    category: 'ERP',
    icon: 'fiscal',
    module: 'erp',
    permissionKey: 'erp.fiscal_notas',
    target: { type: 'erp', section: 'FISCAL', subId: 'FIS_COMPRAS' },
    screenKey: 'erp:FISCAL:FIS_COMPRAS',
  },
  {
    id: 'erp-fis-config',
    label: 'Configurações fiscais',
    category: 'ERP',
    icon: 'fiscal',
    module: 'erp',
    permissionKey: 'erp.fiscal_notas',
    target: { type: 'erp', section: 'FISCAL', subId: 'FIS_CONFIGURACOES' },
    screenKey: 'erp:FISCAL:FIS_CONFIGURACOES',
  },
  {
    id: 'erp-fis-aux',
    label: 'Opções auxiliares fiscais',
    category: 'ERP',
    icon: 'fiscal',
    module: 'erp',
    permissionKey: 'erp.fiscal_notas',
    target: { type: 'erp', section: 'FISCAL', subId: 'FIS_AUXILIARES' },
    screenKey: 'erp:FISCAL:FIS_AUXILIARES',
  },
  {
    id: 'erp-rel-cadastros',
    label: 'Relatórios de cadastros',
    category: 'RELATORIOS',
    icon: 'reports',
    module: 'erp',
    requiresReports: true,
    target: { type: 'erp', section: 'RELATORIOS', subId: 'REL_CADASTROS' },
    screenKey: 'erp:RELATORIOS:REL_CADASTROS',
  },
  {
    id: 'erp-rel-os',
    label: 'Relatórios de ordens de serviços',
    category: 'RELATORIOS',
    icon: 'reports',
    module: 'erp',
    requiresReports: true,
    target: { type: 'erp', section: 'RELATORIOS', subId: 'REL_OS' },
    screenKey: 'erp:RELATORIOS:REL_OS',
  },
  {
    id: 'erp-rel-estoque',
    label: 'Relatórios de estoque',
    category: 'RELATORIOS',
    icon: 'reports',
    module: 'erp',
    requiresReports: true,
    target: { type: 'erp', section: 'RELATORIOS', subId: 'REL_ESTOQUE' },
    screenKey: 'erp:RELATORIOS:REL_ESTOQUE',
  },
  {
    id: 'erp-rel-financeiro',
    label: 'Relatórios financeiros',
    category: 'RELATORIOS',
    icon: 'reports',
    module: 'erp',
    requiresReports: true,
    target: { type: 'erp', section: 'RELATORIOS', subId: 'REL_FINANCEIRO' },
    screenKey: 'erp:RELATORIOS:REL_FINANCEIRO',
  },
  {
    id: 'erp-rel-contratos',
    label: 'Relatórios de contratos',
    category: 'RELATORIOS',
    icon: 'reports',
    module: 'erp',
    requiresReports: true,
    target: { type: 'erp', section: 'RELATORIOS', subId: 'REL_CONTRATOS' },
    screenKey: 'erp:RELATORIOS:REL_CONTRATOS',
  },
  {
    id: 'erp-rel-fiscal',
    label: 'Relatórios fiscais',
    category: 'RELATORIOS',
    icon: 'reports',
    module: 'erp',
    requiresReports: true,
    target: { type: 'erp', section: 'RELATORIOS', subId: 'REL_FISCAL' },
    screenKey: 'erp:RELATORIOS:REL_FISCAL',
  },
  {
    id: 'erp-rel-personalizados',
    label: 'Relatórios personalizados',
    category: 'RELATORIOS',
    icon: 'reports',
    module: 'erp',
    requiresReports: true,
    target: { type: 'erp', section: 'RELATORIOS', subId: 'REL_PERSONALIZADOS' },
    screenKey: 'erp:RELATORIOS:REL_PERSONALIZADOS',
  },
  {
    id: 'erp-rel-logs',
    label: 'Logs do sistema',
    category: 'RELATORIOS',
    icon: 'reports',
    module: 'erp',
    requiresReports: true,
    target: { type: 'erp', section: 'RELATORIOS', subId: 'REL_LOGS' },
    screenKey: 'erp:RELATORIOS:REL_LOGS',
  },
  {
    id: 'data-health-erp',
    label: 'Data Health (ERP)',
    category: 'DADOS',
    icon: 'health',
    module: 'erp',
    target: { type: 'crm', module: 'DATA_HEALTH', dataHealthScope: 'ERP' },
    screenKey: 'erp:DATA_HEALTH_ERP:DATA_HEALTH_ERP',
  },
  {
    id: 'data-health-chamados',
    label: 'Data Health (Chamados)',
    category: 'DADOS',
    icon: 'health',
    module: 'chamados',
    permissionKey: 'chamados.filas_noc',
    target: { type: 'service', tab: 'DATA_HEALTH_CHAMADOS' },
    screenKey: 'service:DATA_HEALTH_CHAMADOS',
  },
];

export const SETTINGS_NAV_ITEMS: SettingsNavItem[] = [
  {
    id: 'pref-geral',
    label: 'Geral',
    group: 'PREFERENCIAS',
    groupLabel: 'Suas preferências',
    preferenciasTab: 'PERFIL',
    alwaysForUser: true,
    screenKey: 'settings:PREFERENCIAS_PERFIL',
    keywords: ['perfil', 'minha conta', 'nome', 'tela inicial'],
  },
  {
    id: 'pref-email',
    label: 'E-mail',
    group: 'PREFERENCIAS',
    groupLabel: 'Suas preferências',
    preferenciasTab: 'EMAIL',
    alwaysForUser: true,
    screenKey: 'settings:PREFERENCIAS_EMAIL',
    keywords: ['outlook', 'caixa', 'assinatura', 'mailbox'],
  },
  {
    id: 'pref-seguranca',
    label: 'Segurança',
    group: 'PREFERENCIAS',
    groupLabel: 'Suas preferências',
    preferenciasTab: 'SEGURANCA',
    alwaysForUser: true,
    screenKey: 'settings:PREFERENCIAS_SEGURANCA',
    keywords: ['2fa', 'totp', 'senha', 'autenticador'],
  },
  {
    id: 'pref-notificacoes',
    label: 'Notificações',
    group: 'PREFERENCIAS',
    groupLabel: 'Suas preferências',
    adminSubView: 'EMAIL_TEMPLATES',
    erpConfigSubId: 'CFG_AVISOS',
    requiresAdmin: true,
    screenKey: 'settings:EMAIL_TEMPLATES',
    keywords: ['avisos', 'notificações', 'e-mail'],
  },
  {
    id: 'account-defaults',
    label: 'Padrões da conta',
    group: 'CONTA',
    groupLabel: 'Gerenciamento de conta',
    adminSubView: 'ERP_GENERAL_SETTINGS',
    erpConfigSubId: 'CFG_GERAIS',
    requiresAdmin: true,
    screenKey: 'settings:ERP_GENERAL_SETTINGS',
    keywords: ['gerais', 'parâmetros', 'numeração', 'plano'],
  },
  {
    id: 'account-audit',
    label: 'Registro de auditoria',
    group: 'CONTA',
    groupLabel: 'Gerenciamento de conta',
    adminSubView: 'DAILY_SYNC_LOGS',
    erpConfigSubId: 'CFG_LOGS',
    requiresAdmin: true,
    screenKey: 'settings:DAILY_SYNC_LOGS',
    keywords: ['auditoria', 'logs', 'sincronização'],
  },
  {
    id: 'account-users',
    label: 'Usuários e equipes',
    group: 'CONTA',
    groupLabel: 'Gerenciamento de conta',
    adminSubView: 'USERS_RBAC',
    erpConfigSubId: 'CFG_USUARIOS',
    requiresAdmin: true,
    screenKey: 'settings:USERS_RBAC',
    keywords: ['usuários', 'rbac', 'iam', 'permissões', 'equipes'],
  },
  {
    id: 'account-integrations',
    label: 'Integrações',
    group: 'CONTA',
    groupLabel: 'Gerenciamento de conta',
    adminSubView: 'MIGRATION_CHECKLIST',
    erpConfigSubId: 'CFG_CHECKLIST',
    requiresAdmin: true,
    screenKey: 'settings:MIGRATION_CHECKLIST',
    keywords: ['gestaoclick', 'homologação', 'migração', 'integração'],
  },
  {
    id: 'account-security',
    label: 'Segurança',
    group: 'CONTA',
    groupLabel: 'Gerenciamento de conta',
    adminSubView: 'SUBDOMAIN_SECURITY',
    requiresAdmin: true,
    screenKey: 'settings:SUBDOMAIN_SECURITY',
    keywords: ['spf', 'dkim', 'dmarc', 'domínio', 'subdomínio'],
  },
  {
    id: 'data-properties',
    label: 'Propriedades',
    group: 'DADOS',
    groupLabel: 'Gerenciamento de dados',
    adminSubView: 'CUSTOM_PROPERTIES',
    requiresAdmin: true,
    screenKey: 'settings:CUSTOM_PROPERTIES',
    keywords: ['campos', 'customizáveis', 'propriedades'],
  },
  {
    id: 'tools-inbox',
    label: 'Caixa de entrada',
    group: 'FERRAMENTAS',
    groupLabel: 'Ferramentas',
    adminSubView: 'EMAIL_MAILBOXES',
    requiresAdmin: true,
    screenKey: 'settings:EMAIL_MAILBOXES',
    keywords: ['caixas', 'outlook', 'mailbox'],
  },
  {
    id: 'email-templates',
    label: 'Modelos de e-mail',
    group: 'FERRAMENTAS',
    groupLabel: 'Ferramentas',
    adminSubView: 'EMAIL_TEMPLATES',
    erpConfigSubId: 'CFG_EMAILS',
    requiresAdmin: true,
    screenKey: 'settings:EMAIL_TEMPLATES',
    keywords: ['modelos', 'templates', 'e-mail'],
  },
  {
    id: 'tools-revenue-company',
    label: 'Dados da empresa',
    group: 'FERRAMENTAS',
    groupLabel: 'Ferramentas',
    adminSubView: 'COMPANY_EMITTER',
    erpConfigSubId: 'CFG_EMPRESA',
    requiresAdmin: true,
    screenKey: 'settings:COMPANY_EMITTER',
    keywords: ['empresa', 'emitente', 'marca', 'lojas', 'cnpj'],
  },
  {
    id: 'tools-certificate',
    label: 'Certificado digital',
    group: 'FERRAMENTAS',
    groupLabel: 'Ferramentas',
    adminSubView: 'CERTIFICATE_A1',
    erpConfigSubId: 'CFG_CERTIFICADO',
    requiresCertificate: true,
    screenKey: 'settings:CERTIFICATE_A1',
    keywords: ['certificado', 'a1'],
  },
  {
    id: 'tools-series',
    label: 'Séries NF e parâmetros',
    group: 'FERRAMENTAS',
    groupLabel: 'Ferramentas',
    adminSubView: 'CERTIFICATE_SERIES',
    erpConfigSubId: 'CFG_PLANO',
    requiresAdmin: true,
    screenKey: 'settings:CERTIFICATE_SERIES',
    keywords: ['séries', 'nf', 'plano'],
  },
];

const CFG_SCREEN_KEYS: Record<string, string> = {
  CFG_USUARIOS: 'settings:USERS_RBAC',
  CFG_GERAIS: 'settings:ERP_GENERAL_SETTINGS',
  CFG_PLANO: 'settings:CERTIFICATE_SERIES',
  CFG_EMPRESA: 'settings:COMPANY_EMITTER',
  CFG_MARCA: 'settings:COMPANY_EMITTER',
  CFG_LOJAS: 'settings:COMPANY_EMITTER',
  CFG_CERTIFICADO: 'settings:CERTIFICATE_A1',
  CFG_EMAILS: 'settings:EMAIL_TEMPLATES',
  CFG_AVISOS: 'settings:EMAIL_TEMPLATES',
  CFG_CHECKLIST: 'settings:MIGRATION_CHECKLIST',
  CFG_LOGS: 'settings:DAILY_SYNC_LOGS',
};

export function pinsStorageKey(userId: string | null | undefined): string {
  const id = String(userId || '').trim() || 'anon';
  return `${NAV_PINS_STORAGE_PREFIX}${id}`;
}

export function sanitizePinIds(raw: unknown, allowedIds: string[]): string[] {
  if (!Array.isArray(raw)) return DEFAULT_PIN_IDS.filter((id) => allowedIds.includes(id));
  const allowed = new Set(allowedIds);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of raw) {
    if (typeof value !== 'string' || !allowed.has(value) || seen.has(value)) continue;
    // Início não é pin.
    if (value === 'home') continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

export function loadPinnedIds(userId: string | null | undefined, allowedIds: string[]): string[] {
  if (typeof window === 'undefined') {
    return DEFAULT_PIN_IDS.filter((id) => allowedIds.includes(id));
  }
  try {
    const raw = window.localStorage.getItem(pinsStorageKey(userId));
    if (raw) return sanitizePinIds(JSON.parse(raw), allowedIds);
    const legacy = window.localStorage.getItem(LEGACY_PINS_STORAGE_KEY);
    if (legacy) {
      const parsed = JSON.parse(legacy);
      if (Array.isArray(parsed)) {
        const mapped = parsed
          .map((id: string) => {
            const table: Record<string, string> = {
              HOME: 'home',
              DEALS: 'deals',
              TASKS: 'tasks',
              CONTACTS: 'contacts',
              COMPANIES: 'companies',
              SEGMENTS: 'segments',
              MARKETING_EMAILS: 'marketing-emails',
              CAMPAIGNS: 'campaigns',
              FORMS: 'forms',
              AUTOMATIONS: 'workflows',
              DATA_HEALTH: 'data-health-crm',
              ADMIN: 'account-users',
              FORECAST: 'forecast',
            };
            return table[id] || '';
          })
          .filter(Boolean);
        return sanitizePinIds(mapped, allowedIds);
      }
    }
  } catch {
    /* ignore */
  }
  return DEFAULT_PIN_IDS.filter((id) => allowedIds.includes(id));
}

export function persistPinnedIds(userId: string | null | undefined, ids: string[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(pinsStorageKey(userId), JSON.stringify(ids));
  } catch {
    /* ignore */
  }
}

function hasModule(ctx: NavAccessContext, module: HubspotNavItem['module']): boolean {
  if (module === 'any') {
    return ctx.moduleAccess.crm || ctx.moduleAccess.erp || ctx.moduleAccess.chamados;
  }
  return ctx.moduleAccess[module] === true;
}

function itemViewDenied(ctx: NavAccessContext, permissionKey?: string): boolean {
  if (!permissionKey) return false;
  const map = ctx.itemView;
  if (!map) return false;
  const flags = map[permissionKey];
  // Só esconde quando a permissão existe e view é explicitamente falsa.
  if (!flags) return false;
  return flags.view !== true;
}

export function canSeeNavItem(item: HubspotNavItem, ctx: NavAccessContext): boolean {
  if (item.hiddenOnPurpose) return false;
  if (!hasModule(ctx, item.module)) return false;
  if (itemViewDenied(ctx, item.permissionKey)) return false;
  if (item.requiresReports) {
    if (!ctx.erpConfig?.canViewReports) return false;
  }
  if (item.erpConfigSubId) {
    if (!isErpConfigItemVisible(ctx.erpConfig, item.erpConfigSubId)) return false;
  }
  const target = item.target;
  if (target.type === 'settings') {
    const settingsItem = SETTINGS_NAV_ITEMS.find((s) => s.id === target.itemId);
    if (settingsItem && !canSeeSettingsItem(settingsItem, ctx)) return false;
  }
  return true;
}

export function canSeeSettingsItem(item: SettingsNavItem, ctx: NavAccessContext): boolean {
  if (item.alwaysForUser) return true;
  if (item.requiresCertificate) {
    return ctx.erpConfig?.canReadCertificate === true || ctx.erpConfig?.isAdmin === true;
  }
  if (item.requiresAdmin) {
    if (item.erpConfigSubId) return isErpConfigItemVisible(ctx.erpConfig, item.erpConfigSubId);
    return ctx.erpConfig?.isAdmin === true;
  }
  if (item.erpConfigSubId) return isErpConfigItemVisible(ctx.erpConfig, item.erpConfigSubId);
  return true;
}

export function visibleNavItems(ctx: NavAccessContext): HubspotNavItem[] {
  return HUBSPOT_NAV_ITEMS.filter((item) => canSeeNavItem(item, ctx));
}

export function visibleSettingsItems(ctx: NavAccessContext): SettingsNavItem[] {
  return SETTINGS_NAV_ITEMS.filter((item) => canSeeSettingsItem(item, ctx));
}

export function resolveHomeTarget(ctx: NavAccessContext): NavTarget {
  if (ctx.moduleAccess.crm) return { type: 'crm', module: 'OVERVIEW_AI' };
  if (ctx.moduleAccess.erp) return { type: 'erp', section: 'INICIO', subId: 'INICIO' };
  if (ctx.moduleAccess.chamados) return { type: 'service', tab: 'DASHBOARD_CHAMADOS' };
  return { type: 'crm', module: 'OVERVIEW_AI' };
}

export function isTargetActive(target: NavTarget, loc: CurrentNavLocation): boolean {
  if (target.type === 'settings') {
    return loc.module === 'SETTINGS_HUB' && loc.settingsItemId === target.itemId;
  }
  if (target.type === 'external') return false;
  if (target.type === 'service') {
    return loc.module === 'SERVICE_DESK' && loc.serviceTab === target.tab;
  }
  if (target.type === 'erp') {
    if (loc.module !== 'ERP_GESTAOCLICK') return false;
    if (loc.erpSection !== target.section) return false;
    if (!target.subId) return true;
    return !loc.erpSubId || loc.erpSubId === target.subId || loc.erpSubId === target.section;
  }
  if (target.type === 'crm') {
    if (loc.module === 'SETTINGS_HUB' && target.adminSubView && loc.settingsItemId) {
      return false;
    }
    if (loc.module !== target.module) return false;
    if (target.contactsSub) return loc.contactsSub === target.contactsSub;
    if (target.marketingSub) return loc.marketingSub === target.marketingSub;
    if (target.dataHealthScope) return (loc.dataHealthScope || 'CRM') === target.dataHealthScope;
    return true;
  }
  return false;
}

export function filterSettingsItems(items: SettingsNavItem[], query: string): SettingsNavItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return items;
  return items.filter((item) => {
    const blob = `${item.label} ${item.groupLabel} ${item.keywords.join(' ')}`.toLowerCase();
    return blob.includes(q);
  });
}

export function existingScreenKeys(tree: MenuTreeGroup[]): string[] {
  const keys = new Set<string>([
    'crm:OVERVIEW_AI',
    'crm:DEALS_KANBAN',
    'crm:CONTACTS_COMPANIES:CONTACTS',
    'crm:CONTACTS_COMPANIES:COMPANIES',
    'crm:CONTACTS_COMPANIES:TASKS',
    'crm:MARKETING_FORMS:MARKETING_EMAILS',
    'crm:MARKETING_FORMS:CAMPAIGNS_ROI',
    'crm:MARKETING_FORMS:SEGMENTS_SCORING',
    'crm:MARKETING_FORMS:FORMS_LANDING_PAGES',
    'crm:AUTOMATIONS',
    'crm:DATA_HEALTH:CRM',
    'service:OPERATIONS',
    'service:DASHBOARD_CHAMADOS',
    'service:DATA_HEALTH_CHAMADOS',
    'service:PORTAL',
    'settings:PREFERENCIAS_PERFIL',
    'settings:PREFERENCIAS_EMAIL',
    'settings:PREFERENCIAS_SEGURANCA',
    'settings:USERS_RBAC',
    'settings:COMPANY_EMITTER',
    'settings:ERP_GENERAL_SETTINGS',
    'settings:CERTIFICATE_A1',
    'settings:CERTIFICATE_SERIES',
    'settings:EMAIL_TEMPLATES',
    'settings:EMAIL_MAILBOXES',
    'settings:CUSTOM_PROPERTIES',
    'settings:DAILY_SYNC_LOGS',
    'settings:MIGRATION_CHECKLIST',
    'settings:SUBDOMAIN_SECURITY',
  ]);
  for (const group of tree) {
    if (group.id === 'CONFIGURACOES') {
      for (const sub of group.subItems || []) {
        const mapped = CFG_SCREEN_KEYS[sub.id];
        if (mapped) keys.add(mapped);
        keys.add(`erp:${group.id}:${sub.id}`);
      }
      continue;
    }
    if (!group.subItems || group.subItems.length === 0) {
      keys.add(`erp:${group.id}:${group.id}`);
      continue;
    }
    for (const sub of group.subItems) {
      keys.add(`erp:${group.id}:${sub.id}`);
    }
  }
  return [...keys];
}

export function mappedScreenKeys(): string[] {
  const keys = new Set<string>();
  for (const item of HUBSPOT_NAV_ITEMS) keys.add(item.screenKey);
  for (const item of SETTINGS_NAV_ITEMS) keys.add(item.screenKey);
  for (const mapped of Object.values(CFG_SCREEN_KEYS)) keys.add(mapped);
  return [...keys];
}

export function orphanScreenKeys(tree: MenuTreeGroup[]): string[] {
  const mapped = new Set(mappedScreenKeys());
  // Configurações do ERP passam a viver na tela de configurações unificada.
  const coveredBySettings = new Set(
    Object.keys(CFG_SCREEN_KEYS).map((id) => `erp:CONFIGURACOES:${id}`)
  );
  return existingScreenKeys(tree).filter((key) => {
    if (mapped.has(key) || coveredBySettings.has(key)) return false;
    // PDV continua mapeado, porém oculto de propósito.
    return true;
  });
}

export const CATEGORY_LABELS: Record<HubspotNavCategory, string> = {
  CRM: 'CRM',
  MARKETING: 'Marketing',
  VENDAS: 'Vendas',
  RECEITA: 'Receita',
  SERVICO: 'Serviço',
  DADOS: 'Gerenciamento de dados',
  AUTOMACAO: 'Automação',
  RELATORIOS: 'Relatórios',
  ERP: 'ERP',
};

export const CATEGORY_ORDER: HubspotNavCategory[] = [
  'CRM',
  'MARKETING',
  'VENDAS',
  'RECEITA',
  'SERVICO',
  'DADOS',
  'AUTOMACAO',
  'RELATORIOS',
  'ERP',
];
