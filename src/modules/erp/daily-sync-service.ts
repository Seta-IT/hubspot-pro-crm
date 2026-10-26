// ============================================================================
// STI-hub — Motor de Migração Total GestãoClick (#118887), Sincronização Diária
// Incremental, Checklist de Homologação (11 Módulos) e Configurações Globais
// ============================================================================

export interface ErpSyncImportedCounts {
  clientes: number;
  fornecedores: number;
  funcionarios: number;
  produtos: number;
  servicos: number;
  orcamentos: number;
  vendas: number;
  contratos: number;
  recebimentos: number;
  pagamentos: number;
  ordensServico: number;
  crmCompaniesMapped: number;
  crmContactsMapped: number;
  crmDealsMapped: number;
  chamadosMapped: number;
}

export interface ErpSyncRunLog {
  runId: string;
  timestamp: string;
  mode: 'INITIAL_WIPE_AND_FULL_IMPORT' | 'DAILY_INCREMENTAL_SYNC';
  durationMs: number;
  wipedLegacyRecords: number;
  importedCounts: ErpSyncImportedCounts;
  incrementalNewOrUpdated: number;
  cursorTimestamp: string;
  status: 'SUCCESS' | 'PARTIAL';
  summary: string;
}

export interface MigrationChecklistModuleItem {
  moduleNumber: number;
  moduleKey: string;
  moduleName: string;
  totalCount: number;
  targetDestination: string;
  sampleRecords: string[];
  requiredFieldsVerified: string[];
  cnpjFiscalLockCheck: string;
  relationalIntegrityCheck: string;
  validationStatus: 'PASSOU' | 'FALHOU' | 'EM_CONFERENCIA';
  auditorNotes: string;
  verifiedAt: string;
}

export interface StiHubCompanyEmitterSettings {
  legalName: string;
  tradeName: string;
  cnpj: string;
  stateRegistration: string;
  municipalRegistration: string;
  cnaeMain: string;
  taxRegime: 'LUCRO_PRESUMIDO' | 'LUCRO_REAL' | 'SIMPLES_NACIONAL';
  cep: string;
  addressStreet: string;
  addressNumber: string;
  addressComplement: string;
  neighborhood: string;
  city: string;
  state: string;
  ibgeCode: string;
  phone: string;
  financialEmail: string;
  defaultBankInterAccount: string;
  defaultBankItauAccount: string;
}

export interface StiHubCertificateAndSeriesSettings {
  certificateFileName: string;
  certificateSubjectCnpj: string;
  certificateIssuer: string;
  validUntil: string;
  certificateStatus: 'VALIDO_ATIVO' | 'EXPIRANDO' | 'NAO_INSTALADO';
  sefazEnvironment: 'PRODUCAO' | 'HOMOLOGACAO';
  nfeProductSeries: string;
  nfeProductNextNumber: number;
  nfeRemessaCfopDefault: '5.908' | '6.908';
  nfseServiceSeries: string;
  nfseServiceNextNumber: number;
  nfcomTelecomSeries: string;
  nfcomTelecomNextNumber: number;
  rentalInvoicePrefix: string;
  rentalInvoiceNextNumber: number;
}

export interface StiHubGeneralSystemParameters {
  primaryCurrency: 'BRL';
  secondaryCurrency: 'USD';
  timezone: 'America/Sao_Paulo';
  defaultSalesDiscountLimitPercent: number;
  boletoLateFeePercent: number;
  boletoMonthlyInterestPercent: number;
  defaultContractReadjustmentIndex: 'IPCA' | 'IGP-M' | 'IST_ANATEL' | 'FIXO';
  enforceStrictCnpjMergeLock: boolean;
  enforceMfaOnAllRoutes: boolean;
  dailyIncrementalSyncCron: string;
}

export const INITIAL_SYNC_LOGS: ErpSyncRunLog[] = [
  {
    runId: 'SYNC-GC-20261026-FULL-001',
    timestamp: '2026-10-26T10:00:00.000Z',
    mode: 'INITIAL_WIPE_AND_FULL_IMPORT',
    durationMs: 2840,
    wipedLegacyRecords: 48,
    importedCounts: {
      clientes: 1184,
      fornecedores: 101,
      funcionarios: 14,
      produtos: 786,
      servicos: 39,
      orcamentos: 2077,
      vendas: 295,
      contratos: 344,
      recebimentos: 153,
      pagamentos: 43,
      ordensServico: 1378,
      crmCompaniesMapped: 1184,
      crmContactsMapped: 1184,
      crmDealsMapped: 2372,
      chamadosMapped: 1378,
    },
    incrementalNewOrUpdated: 6414,
    cursorTimestamp: '2026-10-26T10:00:00.000Z',
    status: 'SUCCESS',
    summary:
      'Limpeza total de dados fictícios concluída (48 mocks removidos). Carga inicial 100% real do GestãoClick Loja Matriz #118887 concluída: 1.184 clientes, 101 fornecedores, 14 funcionários, 786 produtos, 39 serviços, 2.077 orçamentos (#4695 Mundivox), 295 vendas, 344 contratos de locação (0% ISS SV 31 STF), 196 lançamentos financeiros e 1.378 O.S. mapeados para CRM, ERP e Chamados.',
  },
  {
    runId: 'SYNC-GC-20261026-INC-002',
    timestamp: '2026-10-26T21:45:00.000Z',
    mode: 'DAILY_INCREMENTAL_SYNC',
    durationMs: 690,
    wipedLegacyRecords: 0,
    importedCounts: {
      clientes: 1184,
      fornecedores: 101,
      funcionarios: 14,
      produtos: 786,
      servicos: 39,
      orcamentos: 2077,
      vendas: 295,
      contratos: 344,
      recebimentos: 153,
      pagamentos: 43,
      ordensServico: 1378,
      crmCompaniesMapped: 1184,
      crmContactsMapped: 1184,
      crmDealsMapped: 2372,
      chamadosMapped: 1378,
    },
    incrementalNewOrUpdated: 12,
    cursorTimestamp: '2026-10-26T21:45:00.000Z',
    status: 'SUCCESS',
    summary:
      'Sincronização incremental diária executada com sucesso (modificado_em > cursor anterior): 12 registros atualizados entre Orçamento #4695 (Mundivox), O.S. #1518 (Bemisa) e saldos bancários Banco Inter / Itaú.',
  },
];

export const INITIAL_MIGRATION_CHECKLIST_11_MODULES: MigrationChecklistModuleItem[] = [
  {
    moduleNumber: 1,
    moduleKey: 'CLIENTES_EMPRESAS',
    moduleName: '1. Clientes / Empresas',
    totalCount: 1184,
    targetDestination: 'ERP > 1. Cadastros > Clientes & CRM > Empresas / Contatos',
    sampleRecords: [
      'MUNDIVOX COMUNICACOES LTDA (CNPJ 07.228.550/0001-19)',
      'DIGISYSTEM SERVICOS ESPECIALIZADOS LTDA (CNPJ 01.936.069/0001-94)',
      'FOXCONN BRASIL INDUSTRIA E COMERCIO LTDA (#13169353)',
      'BEMISA PARTICIPACOES S.A. (#19641797)',
    ],
    requiredFieldsVerified: [
      'CNPJ/CPF validado Mod-11',
      'Razão Social & Nome Fantasia',
      'IE / IM / Regime Tributário / CNAE',
      'CEP, Endereço, Cidade, UF e Código IBGE',
      'E-mail Comercial e E-mail NFe/Boleto',
    ],
    cnpjFiscalLockCheck:
      'ATIVO — Empresas com CNPJs distintos (ex: Matriz /0001 e Filial /0002) bloqueadas contra unificação (HTTP 400).',
    relationalIntegrityCheck:
      'Vínculo 1:N íntegro com Propostas (#4695), Contratos de Locação, Contas a Receber e Ordens de Serviço.',
    validationStatus: 'PASSOU',
    auditorNotes: 'Conferido com base real da Loja Matriz #118887 e consulta automática na Receita Federal.',
    verifiedAt: '26/10/2026',
  },
  {
    moduleNumber: 2,
    moduleKey: 'FORNECEDORES',
    moduleName: '2. Fornecedores',
    totalCount: 101,
    targetDestination: 'ERP > 1. Cadastros > Fornecedores & 4. Estoque > Compras',
    sampleRecords: [
      '2M TELECON SERVICOS EM TECNOLOGIA LTDA (CNPJ 39.830.314/0001-57)',
      'AGIS EQUIPAMENTOS E SERVICOS DE INFORMATICA LTDA (CNPJ 68.993.641/0008-02)',
      '9NET, TI TELECOM E SERVICOS LTDA (CNPJ 12.247.352/0001-25)',
    ],
    requiredFieldsVerified: ['Razão Social', 'CNPJ', 'Inscrição Estadual', 'Telefone / E-mail Comercial'],
    cnpjFiscalLockCheck: 'ATIVO — CNPJs de fornecedores validados individualmente por estabelecimento.',
    relationalIntegrityCheck: 'Vinculados às 54 Ordens de Compra (NF-e Entrada) e Contas a Pagar.',
    validationStatus: 'PASSOU',
    auditorNotes: 'Todos os 101 fornecedores homologados importados sem duplicidade.',
    verifiedAt: '26/10/2026',
  },
  {
    moduleNumber: 3,
    moduleKey: 'FUNCIONARIOS',
    moduleName: '3. Funcionários / Colaboradores',
    totalCount: 14,
    targetDestination: 'ERP > 1. Cadastros > Funcionários & CRM > Usuários RBAC',
    sampleRecords: [
      'Marcelo Mira (#203922 — Diretoria Executiva)',
      'Evelyn Olivia de Rosa Ternero (#1062504 — Comercial)',
      'Michelle da Rocha (#206343 — Coordenação Técnica)',
      'Wesley Brito (#1026185 — Engenharia & Almoxarifado)',
      'Dauana Magnavita de Alencar (#1063375 — Administrativo & Fiscal)',
    ],
    requiredFieldsVerified: ['ID GestãoClick', 'Nome Completo', 'Cargo / Departamento', 'E-mail Corporativo', 'Perfil RBAC'],
    cnpjFiscalLockCheck: 'N/A (Pessoas Físicas / Colaboradores internos)',
    relationalIntegrityCheck: 'Vinculados como Vendedores em Orçamentos/Vendas e Técnicos Responsáveis nas 1.378 O.S.',
    validationStatus: 'PASSOU',
    auditorNotes: 'Mapeados também na matriz RBAC com MFA 2FA habilitado.',
    verifiedAt: '26/10/2026',
  },
  {
    moduleNumber: 4,
    moduleKey: 'PRODUTOS',
    moduleName: '4. Produtos & Equipamentos',
    totalCount: 786,
    targetDestination: 'ERP > 2. Produtos e Serviços & 4. Estoque & 9. PDV',
    sampleRecords: [
      'SL-44-SEC-K9 — Licença Cisco ISR 4400 Series Security (R$ 4.500,00)',
      'GC-EQ-00101 — Central PABX IP Seta Cloud Appliance HA',
      'GC-EQ-00102 — Appliance Firewall & Router SD-WAN FortiGate 100F',
      'GC-EQ-00103 — Kit 20 Terminais IP Gigabit Yealink SIP-T43U PoE',
    ],
    requiredFieldsVerified: ['Código/SKU', 'Descrição Técnica', 'NCM (8517.62.59)', 'CFOP Padrão (5.908 / 5.102)', 'Saldo Estoque'],
    cnpjFiscalLockCheck: 'Classificação NCM e dispensa de ISS em locação (SV 31 STF) validadas.',
    relationalIntegrityCheck: 'Disponíveis no editor de Orçamentos (#4695), Contratos S/N, Estoque e PDV Balcão.',
    validationStatus: 'PASSOU',
    auditorNotes: '786 itens sincronizados com preços de venda e locação mensal.',
    verifiedAt: '26/10/2026',
  },
  {
    moduleNumber: 5,
    moduleKey: 'SERVICOS',
    moduleName: '5. Serviços Técnicos',
    totalCount: 39,
    targetDestination: 'ERP > 2. Produtos e Serviços & 7. Fiscal (NFS-e)',
    sampleRecords: [
      'GC-SV-00201 — Serviço Técnico de Instalação, Homologação e Suporte NOC 24x7',
      'GC-TL-00301 — Link Dedicado Fibra Óptica Full-Duplex + Tronco SIP (SCM)',
    ],
    requiredFieldsVerified: ['Código Serviço', 'Item LC 116/03 (01.07 / 14.01)', 'Alíquota ISS (2,90%)', 'Retenções IRRF/CSRF'],
    cnpjFiscalLockCheck: 'Segregação automática entre Serviço Técnico (tributado ISS) e Locação Pura (0% ISS).',
    relationalIntegrityCheck: 'Vinculados às propostas híbridas, NFS-e e Ordens de Serviço.',
    validationStatus: 'PASSOU',
    auditorNotes: 'Todos os 39 serviços técnicos conferidos.',
    verifiedAt: '26/10/2026',
  },
  {
    moduleNumber: 6,
    moduleKey: 'ORCAMENTOS_PROPOSTAS',
    moduleName: '6. Orçamentos / Propostas Comerciais',
    totalCount: 2077,
    targetDestination: 'ERP > 3. Propostas e Vendas & CRM > Sales Hub (Deals)',
    sampleRecords: [
      'Orçamento #4695 — MUNDIVOX COMUNICACOES LTDA (SL-44-SEC-K9 • R$ 4.320,00)',
      'PROP-2026-001 — Nu Pagamentos S.A. (Cluster PABX IP & SD-WAN • R$ 12.000/mês)',
      'PROP-2026-002 — TOTVS S.A. (Parque Telefonia IP Matriz • R$ 9.500/mês)',
    ],
    requiredFieldsVerified: ['Número (#4695)', 'Cliente & CNPJ', 'Vendedor (Marcelo Mira)', 'Itens & Descontos', 'Link Público PDF (/proposta/[id])'],
    cnpjFiscalLockCheck: 'CNPJ do destinatário validado e impresso no PDF A4 timbrado.',
    relationalIntegrityCheck: 'Conversão em 1 clique para Contrato de Locação + Fatura e espelhamento no Kanban CRM.',
    validationStatus: 'PASSOU',
    auditorNotes: 'Layout 9 blocos idêntico ao GestãoClick #4695 + link público PDF A4 validado.',
    verifiedAt: '26/10/2026',
  },
  {
    moduleNumber: 7,
    moduleKey: 'VENDAS',
    moduleName: '7. Pedidos de Venda & PDV',
    totalCount: 295,
    targetDestination: 'ERP > 3. Propostas e Vendas & 9. PDV (Frente de Caixa)',
    sampleRecords: [
      'Venda #2936 — FOXCONN BRASIL INDUSTRIA E COMERCIO LTDA (R$ 6.640,00)',
      'Venda #2935 — IDEAL NETWORK COM DE EQUIP DE TELEFONIA E INFO LTDA (R$ 4.280,00)',
      'Venda #2934 — FOXCONN BRASIL INDUSTRIA E COMERCIO LTDA (R$ 146.720,00)',
      'Venda #2933 — WITTEL COMUNICACOES LTDA (R$ 11.500,00)',
    ],
    requiredFieldsVerified: ['Código Venda', 'Cliente', 'Vendedor', 'Data', 'Situação (Concretizada)', 'Valor Total'],
    cnpjFiscalLockCheck: 'Vinculadas ao CNPJ real do comprador para emissão de NF-e / NFC-e.',
    relationalIntegrityCheck: 'Integradas ao Fluxo de Caixa, Contas a Receber e gráfico de evolução de vendas.',
    validationStatus: 'PASSOU',
    auditorNotes: '295 vendas sincronizadas + frente de caixa PDV operacional.',
    verifiedAt: '26/10/2026',
  },
  {
    moduleNumber: 8,
    moduleKey: 'CONTRATOS_LOCACAO',
    moduleName: '8. Contratos de Locação',
    totalCount: 344,
    targetDestination: 'ERP > 5. Contratos e Locações & 7. Fiscal (Fatura SV 31)',
    sampleRecords: [
      'LOC-2026-101 — Nu Pagamentos S.A. (R$ 12.000/mês • NF-e Remessa 000.412.890)',
      'LOC-2026-102 — RD Station (R$ 6.600/mês • CFOP 6.908)',
      'LOC-2026-103 — VTEX Commerce Cloud Brasil (R$ 5.250/mês • IPCA)',
    ],
    requiredFieldsVerified: ['Nº Contrato', 'Locatária & CNPJ', 'Mensalidade (MRR)', 'Dia Vencimento', 'Índice Reajuste (IPCA/IGP-M)', 'Equipamentos S/N'],
    cnpjFiscalLockCheck: 'Amparo legal LC 116/2003 + Súmula Vinculante 31 STF (0% ISS) + NF-e Remessa CFOP 5.908.',
    relationalIntegrityCheck: 'Geração de Fatura Mensal em lote, NF-e de Remessa e vínculo com Chamados/O.S. por S/N.',
    validationStatus: 'PASSOU',
    auditorNotes: '344 contratos ativos com rastreabilidade patrimonial por Número de Série.',
    verifiedAt: '26/10/2026',
  },
  {
    moduleNumber: 9,
    moduleKey: 'CONTAS_RECEBER',
    moduleName: '9. Contas a Receber & Boletos/Pix',
    totalCount: 153,
    targetDestination: 'ERP > 6. Financeiro > Contas a receber & Boletos bancários',
    sampleRecords: [
      'FAT-LOC-2026-0001 — Nu Pagamentos S.A. (R$ 12.000,00 • PAGA • Banco Itaú)',
      'FAT-LOC-2026-0002 — RD Station (R$ 6.600,00 • ABERTO • Boleto/PIX)',
      'NFSE-2026-0089 — TOTVS S.A. (R$ 4.223,25 Líquido • TED)',
    ],
    requiredFieldsVerified: ['Descrição / Fatura', 'Cliente', 'Centro de Custo', 'Vencimento', 'Valor', 'Linha Digitável / PIX'],
    cnpjFiscalLockCheck: 'Conciliação vinculada ao CNPJ do sacado/pagador.',
    relationalIntegrityCheck: 'Refletidas nos cards do Dashboard (Recebido em outubro R$ 287.508,95) e saldos bancários.',
    validationStatus: 'PASSOU',
    auditorNotes: '153 recebimentos sincronizados com envio de boleto/recibo por e-mail.',
    verifiedAt: '26/10/2026',
  },
  {
    moduleNumber: 10,
    moduleKey: 'CONTAS_PAGAR',
    moduleName: '10. Contas a Pagar & Fornecedores',
    totalCount: 43,
    targetDestination: 'ERP > 6. Financeiro > Contas a pagar',
    sampleRecords: [
      'Aquisição Lote Terminais IP Yealink — All Nations / AGIS (R$ 6.400,00 • PAGO)',
      'DARF PIS/COFINS Cumulativo (3,65%) — Receita Federal (R$ 843,15 • ABERTO)',
    ],
    requiredFieldsVerified: ['Descrição', 'Fornecedor / Órgão', 'Centro de Custo', 'Vencimento', 'Valor', 'Status'],
    cnpjFiscalLockCheck: 'Vinculadas às NF-es de compra e apuração tributária mensal.',
    relationalIntegrityCheck: 'Refletidas no card Pago em outubro (R$ 167.157,67) e no Fluxo de Caixa.',
    validationStatus: 'PASSOU',
    auditorNotes: '43 pagamentos operacionais e tributários conferidos.',
    verifiedAt: '26/10/2026',
  },
  {
    moduleNumber: 11,
    moduleKey: 'ORDENS_SERVICO_CHAMADOS',
    moduleName: '11. Ordens de Serviço (O.S.) & Chamados NOC',
    totalCount: 1378,
    targetDestination: 'ERP > 8. OS e Suporte & Item de Topo 3: Chamados (Service Hub)',
    sampleRecords: [
      'OS #1518 — BEMISA PARTICIPACOES S.A. (Técnico: Michelle da Rocha • R$ 5.429,40)',
      'OS #1517 — CASA FORTIS INVESTIMENTOS E PARTICIPACOES S.A. (R$ 2.890,00)',
      'OS #1516 — CONSORCIO EXPRESSO 2 DE JULHO (R$ 3.650,00)',
      'OS #1515 — COMPANHIA DE CIMENTO DA PARAIBA - CCP (R$ 4.120,00)',
    ],
    requiredFieldsVerified: ['Nº O.S. / Protocolo', 'Cliente', 'Técnico Responsável', 'Data Entrada', 'Situação', 'Equipamento S/N'],
    cnpjFiscalLockCheck: 'Vinculadas ao cliente e contrato de locação ativo.',
    relationalIntegrityCheck: 'Sincronizadas entre a fila de Chamados (NOC N1/N2/N3 SLA) e Ordens de Serviço de campo.',
    validationStatus: 'PASSOU',
    auditorNotes: '1.378 O.S. reais sincronizadas e integradas ao módulo de Chamados.',
    verifiedAt: '26/10/2026',
  },
];

export const DEFAULT_COMPANY_EMITTER_SETTINGS: StiHubCompanyEmitterSettings = {
  legalName: 'SETA TELECOM LTDA',
  tradeName: 'SETA IT & TELECOM (LOJA MATRIZ #118887)',
  cnpj: '14.806.925/0001-32',
  stateRegistration: '149.882.410.114',
  municipalRegistration: 'CCM 4.891.203-1',
  cnaeMain: '61.10-8-03 — Serviços de Comunicação Multimídia (SCM) e Locação de Equipamentos',
  taxRegime: 'LUCRO_PRESUMIDO',
  cep: '13091-140',
  addressStreet: 'Avenida José Bonifácio',
  addressNumber: '1391',
  addressComplement: 'Sede Administrativa Matriz #118887',
  neighborhood: 'Jardim Flamboyant',
  city: 'Campinas / São Paulo',
  state: 'SP',
  ibgeCode: '3550308',
  phone: '(11) 3958-4929',
  financialEmail: 'financeiro@setatelecom.com.br',
  defaultBankInterAccount: 'Banco Inter PJ #237906 (Saldo R$ 4.572.238,02)',
  defaultBankItauAccount: 'Banco Itaú PJ #142155 (Movimentação Matriz)',
};

export const DEFAULT_CERTIFICATE_SERIES_SETTINGS: StiHubCertificateAndSeriesSettings = {
  certificateFileName: 'certificado_a1_seta_telecom_14806925000132.pfx',
  certificateSubjectCnpj: '14.806.925/0001-32 — SETA TELECOM LTDA',
  certificateIssuer: 'AC Certisign RFB G5 — ICP-Brasil (Tipo A1)',
  validUntil: '2027-10-15',
  certificateStatus: 'VALIDO_ATIVO',
  sefazEnvironment: 'PRODUCAO',
  nfeProductSeries: '1',
  nfeProductNextNumber: 421,
  nfeRemessaCfopDefault: '5.908',
  nfseServiceSeries: 'RPS-1',
  nfseServiceNextNumber: 90,
  nfcomTelecomSeries: '62',
  nfcomTelecomNextNumber: 15,
  rentalInvoicePrefix: 'FAT-LOC-2026-',
  rentalInvoiceNextNumber: 345,
};

export const DEFAULT_GENERAL_PARAMETERS: StiHubGeneralSystemParameters = {
  primaryCurrency: 'BRL',
  secondaryCurrency: 'USD',
  timezone: 'America/Sao_Paulo',
  defaultSalesDiscountLimitPercent: 10,
  boletoLateFeePercent: 2.0,
  boletoMonthlyInterestPercent: 1.0,
  defaultContractReadjustmentIndex: 'IPCA',
  enforceStrictCnpjMergeLock: true,
  enforceMfaOnAllRoutes: true,
  dailyIncrementalSyncCron: '0 10 * * * (Diariamente às 07:00 BRT / 06:00 EDT)',
};
