// ============================================================================
// STI-hub — Catálogo Completo de Menus, Tabelas (76 Recursos) e Campos da API
// GestãoClick ERP (Loja Matriz #118887) - HubSpot CRM v3 - STI-hub
// ============================================================================

export interface GestaoClickResourceSchema {
  recurso: string;
  modulo: 'core' | 'pedidos' | 'contratos' | 'estoque' | 'financeiro' | 'fiscal' | 'crm' | 'assinatura_digital';
  menuGroup: string;
  menuSubItem: string;
  caminho: string;
  acoes: string[];
  filtros: string[];
  totalRegistrosLoja118887: number;
  fields: string[];
  nestedStructures?: Record<string, string[]>;
  hubspotMapping?: {
    object: string;
    keyFields: Record<string, string>;
  };
  stiHubTarget: {
    collection: string;
    primaryKey: string;
  };
}

export const GESTAOCLICK_STORE_118887_TOTALS = {
  lojas: 1,
  usuarios: 6,
  clientes: 1185,
  fornecedores: 101,
  funcionarios: 14,
  transportadoras: 50,
  produtos: 786,
  servicos: 39,
  grupos_produtos: 47,
  tipos_contatos: 3,
  tipos_enderecos: 2,
  atributos_produtos: 7,
  orcamentos: 2079,
  situacoes_orcamentos: 19,
  atributos_orcamentos: 1,
  vendas: 296,
  situacoes_vendas: 19,
  ordens_servicos: 1378,
  situacoes_ordens_servicos: 19,
  contratos: 344,
  situacoes_contratos: 6,
  atributos_contratos: 5,
  locacoes: 2,
  situacoes_locacoes: 8,
  situacoes_assinaturas: 4,
  compras: 54,
  situacoes_compras: 4,
  recebimentos: 153,
  pagamentos: 41,
  contas_bancarias: 3,
  planos_contas: 100,
  centros_custos: 13,
  formas_pagamentos: 12,
  atributos_financeiros: 2,
  notas_fiscais_produtos: 1664,
  notas_fiscais_servicos: 945,
  notas_fiscais_consumidores: 0,
} as const;

export const GESTAOCLICK_FULL_RESOURCE_SCHEMAS: GestaoClickResourceSchema[] = [
  {
    recurso: 'clientes',
    modulo: 'core',
    menuGroup: 'Cadastros',
    menuSubItem: 'Clientes (PJ / PF / ES)',
    caminho: '/clientes',
    acoes: ['listar', 'visualizar', 'cadastrar', 'editar', 'deletar'],
    filtros: ['tipo_pessoa', 'nome', 'cpf_cnpj', 'telefone', 'email', 'situacao', 'cidade_id', 'estado'],
    totalRegistrosLoja118887: 1185,
    fields: [
      'id', 'tipo_pessoa', 'nome', 'razao_social', 'cnpj', 'inscricao_estadual',
      'inscricao_municipal', 'tipo_contribuinte', 'responsavel', 'cpf', 'rg',
      'data_nascimento', 'sexo', 'loja_virtual_ativo', 'email_acesso', 'telefone',
      'celular', 'fax', 'email', 'ativo', 'vendedor_id', 'nome_vendedor',
      'cadastrado_em', 'modificado_em', 'contatos', 'enderecos', 'atributos'
    ],
    nestedStructures: {
      'enderecos[].endereco': ['tipo_id', 'nome_tipo', 'cep', 'logradouro', 'numero', 'complemento', 'bairro', 'pais', 'cidade_id', 'nome_cidade', 'estado'],
      'contatos[].contato': ['tipo_id', 'nome_tipo', 'nome', 'contato', 'cargo', 'observacao'],
      'atributos[].atributo': ['atributo_id', 'nome', 'conteudo']
    },
    hubspotMapping: {
      object: 'companies + contacts',
      keyFields: {
        razao_social: 'company.name',
        nome: 'company.tradeName (sanitized if CNPJ)',
        cnpj: 'company.cnpj',
        email: 'contact.email',
        telefone: 'company.phone / contact.phone',
        responsavel: 'contact.firstname + lastname',
        nome_vendedor: 'hubspot_owner_id'
      }
    },
    stiHubTarget: { collection: 'state.companies + state.contacts', primaryKey: 'comp-gc-{id} / cont-gc-{id}' }
  },
  {
    recurso: 'fornecedores',
    modulo: 'core',
    menuGroup: 'Cadastros',
    menuSubItem: 'Fornecedores',
    caminho: '/fornecedores',
    acoes: ['listar', 'visualizar', 'cadastrar', 'editar', 'deletar'],
    filtros: ['tipo_pessoa', 'nome', 'cpf_cnpj', 'telefone', 'email', 'cidade_id', 'estado'],
    totalRegistrosLoja118887: 101,
    fields: [
      'id', 'tipo_pessoa', 'nome', 'razao_social', 'cnpj', 'inscricao_estadual',
      'inscricao_municipal', 'tipo_contribuinte', 'cpf', 'rg', 'data_nascimento',
      'telefone', 'celular', 'email', 'ativo', 'cadastrado_em', 'modificado_em',
      'contatos', 'enderecos', 'atributos'
    ],
    nestedStructures: {
      'enderecos[].endereco': ['cep', 'logradouro', 'numero', 'complemento', 'bairro', 'cidade_id', 'nome_cidade', 'estado'],
      'contatos[].contato': ['tipo_id', 'nome_tipo', 'nome', 'contato', 'cargo', 'observacao']
    },
    stiHubTarget: { collection: 'state.erp.suppliers', primaryKey: 'id' }
  },
  {
    recurso: 'funcionarios',
    modulo: 'core',
    menuGroup: 'Cadastros',
    menuSubItem: 'Funcionários',
    caminho: '/funcionarios',
    acoes: ['listar'],
    filtros: ['nome', 'cpf', 'telefone', 'email'],
    totalRegistrosLoja118887: 14,
    fields: [
      'id', 'nome', 'email_secundario', 'cpf', 'rg', 'data_nascimento', 'sexo',
      'telefone', 'cep', 'logradouro', 'numero', 'complemento', 'bairro',
      'cidade_id', 'nome_cidade', 'estado', 'comissao', 'ativo', 'atributos'
    ],
    hubspotMapping: {
      object: 'owners',
      keyFields: { nome: 'owner.firstName + lastName', email_secundario: 'owner.email' }
    },
    stiHubTarget: { collection: 'state.erp.employees', primaryKey: 'id' }
  },
  {
    recurso: 'transportadoras',
    modulo: 'core',
    menuGroup: 'Cadastros',
    menuSubItem: 'Transportadoras',
    caminho: '/transportadoras',
    acoes: ['listar', 'visualizar', 'cadastrar', 'editar', 'deletar'],
    filtros: ['tipo_pessoa', 'nome', 'cpf_cnpj', 'telefone', 'email'],
    totalRegistrosLoja118887: 50,
    fields: [
      'id', 'tipo_pessoa', 'nome', 'razao_social', 'cnpj', 'inscricao_estadual',
      'inscricao_municipal', 'cpf', 'rg', 'data_nascimento', 'telefone', 'celular',
      'email', 'observacoes', 'ativo', 'cadastrado_em', 'modificado_em', 'contatos', 'enderecos'
    ],
    nestedStructures: {
      'enderecos[].endereco': ['cep', 'logradouro', 'numero', 'complemento', 'bairro', 'cidade_id', 'nome_cidade', 'estado']
    },
    stiHubTarget: { collection: 'state.erp.suppliers (supplierType=TRANSPORTADORA)', primaryKey: 'id' }
  },
  {
    recurso: 'produtos',
    modulo: 'core',
    menuGroup: 'Itens',
    menuSubItem: 'Produtos & Equipamentos',
    caminho: '/produtos',
    acoes: ['listar', 'visualizar', 'cadastrar', 'editar', 'deletar'],
    filtros: ['nome', 'codigo', 'codigo_barra', 'grupo_id', 'fornecedor_id', 'situacao'],
    totalRegistrosLoja118887: 786,
    fields: [
      'id', 'nome', 'codigo_interno', 'codigo_barra', 'possui_variacao', 'possui_composicao',
      'movimenta_estoque', 'peso', 'largura', 'altura', 'comprimento', 'ativo',
      'grupo_id', 'nome_grupo', 'descricao', 'estoque', 'valor_custo', 'valor_venda',
      'cadastrado_em', 'modificado_em', 'valores', 'variacoes', 'fiscal', 'fotos', 'atributos'
    ],
    nestedStructures: {
      'valores[]': ['tipo_id', 'nome_tipo', 'lucro_utilizado', 'valor_custo', 'valor_venda'],
      'variacoes[].variacao': ['id', 'variacao_api_id', 'codigo', 'nome', 'estoque', 'valores'],
      'fiscal': ['ncm', 'cest', 'peso_liquido', 'peso_bruto', 'valor_aproximado_tributos']
    },
    hubspotMapping: {
      object: 'products (line_items)',
      keyFields: { nome: 'name', codigo_interno: 'hs_sku', valor_venda: 'price' }
    },
    stiHubTarget: { collection: 'state.erp.catalog (EQUIPAMENTO_LOCACAO / VENDA_HARDWARE)', primaryKey: 'cat-gc-prod-{id}' }
  },
  {
    recurso: 'servicos',
    modulo: 'core',
    menuGroup: 'Itens',
    menuSubItem: 'Serviços Técnicos',
    caminho: '/servicos',
    acoes: ['listar', 'visualizar', 'cadastrar', 'editar', 'deletar'],
    filtros: ['nome', 'codigo', 'situacao'],
    totalRegistrosLoja118887: 39,
    fields: ['id', 'codigo', 'nome', 'valor_venda', 'observacoes'],
    stiHubTarget: { collection: 'state.erp.catalog (SERVICO_TECNICO_LC116)', primaryKey: 'cat-gc-srv-{id}' }
  },
  {
    recurso: 'grupos_produtos',
    modulo: 'core',
    menuGroup: 'Itens',
    menuSubItem: 'Grupos de Produtos',
    caminho: '/grupos_produtos',
    acoes: ['listar'],
    filtros: [],
    totalRegistrosLoja118887: 47,
    fields: ['id', 'grupo_pai_id', 'nome', 'url', 'meta_palavras_chaves', 'meta_descricao'],
    stiHubTarget: { collection: 'state.erp.catalog.category', primaryKey: 'id' }
  },
  {
    recurso: 'orcamentos',
    modulo: 'pedidos',
    menuGroup: 'Orçamentos / Propostas',
    menuSubItem: 'Todos os Orçamentos',
    caminho: '/orcamentos',
    acoes: ['listar', 'visualizar', 'cadastrar', 'editar', 'deletar', 'gerar_parcelas', 'listar_anexos', 'anexar', 'deletar_anexo'],
    filtros: ['codigo', 'cliente_id', 'situacao_id', 'vendedor_id', 'data_inicio', 'data_fim', 'centro_custo_id', 'loja_id'],
    totalRegistrosLoja118887: 2079,
    fields: [
      'id', 'codigo', 'cliente_id', 'nome_cliente', 'vendedor_id', 'nome_vendedor',
      'tecnico_id', 'nome_tecnico', 'data', 'previsao_entrega', 'situacao_id', 'nome_situacao',
      'valor_total', 'transportadora_id', 'nome_transportadora', 'centro_custo_id', 'nome_centro_custo',
      'aos_cuidados_de', 'validade', 'introducao', 'observacoes', 'observacoes_interna',
      'desconto_valor', 'desconto_porcentagem', 'valor_frete', 'nome_canal_venda', 'nome_loja',
      'valor_servicos', 'valor_produtos', 'valor_custo', 'condicao_pagamento', 'situacao_financeiro',
      'situacao_estoque', 'forma_pagamento_id', 'data_primeira_parcela', 'numero_parcelas',
      'intervalo_dias', 'nota_fiscal_id', 'nota_fiscal_servico_id', 'hash', 'cadastrado_em',
      'modificado_em', 'exibir_endereco', 'cor_situacao', 'equipamentos', 'pagamentos',
      'enderecos', 'atributos', 'produtos', 'anexos'
    ],
    nestedStructures: {
      'produtos[].produto': [
        'produto_id', 'variacao_id', 'nome_produto', 'detalhes', 'movimenta_estoque',
        'possui_variacao', 'sigla_unidade', 'quantidade', 'tipo_valor_id', 'nome_tipo_valor',
        'valor_custo', 'valor_venda', 'tipo_desconto', 'desconto_valor', 'desconto_porcentagem', 'valor_total'
      ],
      'atributos[].atributo': ['atributo_id', 'nome', 'conteudo']
    },
    hubspotMapping: {
      object: 'deals + quotes',
      keyFields: { codigo: 'deal.customProperties.gcQuoteCode', valor_total: 'deal.amount', nome_situacao: 'deal.dealstage' }
    },
    stiHubTarget: { collection: 'state.erp.proposals + state.deals', primaryKey: 'prop-gc-{id}' }
  },
  {
    recurso: 'vendas',
    modulo: 'pedidos',
    menuGroup: 'Vendas',
    menuSubItem: 'Pedidos de Venda (Produtos, Serviços, Balcão)',
    caminho: '/vendas',
    acoes: ['listar', 'visualizar', 'cadastrar', 'editar', 'deletar', 'gerar_parcelas', 'listar_anexos', 'anexar', 'deletar_anexo'],
    filtros: ['codigo', 'cliente_id', 'situacao_id', 'vendedor_id', 'data_inicio', 'data_fim', 'centro_custo_id', 'loja_id'],
    totalRegistrosLoja118887: 296,
    fields: [
      'id', 'codigo', 'cliente_id', 'nome_cliente', 'vendedor_id', 'nome_vendedor',
      'tecnico_id', 'nome_tecnico', 'data', 'prazo_entrega', 'situacao_id', 'nome_situacao',
      'valor_total', 'transportadora_id', 'nome_transportadora', 'centro_custo_id', 'nome_centro_custo',
      'aos_cuidados_de', 'validade', 'introducao', 'observacoes', 'observacoes_interna',
      'desconto_valor', 'desconto_porcentagem', 'valor_frete', 'nome_canal_venda', 'nome_loja',
      'valor_servicos', 'valor_produtos', 'valor_custo', 'condicao_pagamento', 'situacao_financeiro',
      'situacao_estoque', 'forma_pagamento_id', 'data_primeira_parcela', 'numero_parcelas',
      'intervalo_dias', 'nota_fiscal_id', 'nota_fiscal_servico_id', 'hash', 'cadastrado_em',
      'modificado_em', 'exibir_endereco', 'cor_situacao', 'nome_forma_pagamento', 'equipamentos',
      'pagamentos', 'enderecos', 'atributos', 'produtos', 'anexos'
    ],
    nestedStructures: {
      'pagamentos[].pagamento': ['data_vencimento', 'valor', 'forma_pagamento_id', 'nome_forma_pagamento', 'plano_contas_id', 'nome_plano_conta', 'observacao'],
      'produtos[].produto': ['produto_id', 'variacao_id', 'nome_produto', 'detalhes', 'movimenta_estoque', 'possui_variacao', 'sigla_unidade', 'quantidade', 'tipo_valor_id', 'nome_tipo_valor', 'valor_custo', 'valor_venda', 'tipo_desconto', 'desconto_valor', 'desconto_porcentagem', 'valor_total']
    },
    hubspotMapping: {
      object: 'deals (Closed Won)',
      keyFields: { codigo: 'dealname', valor_total: 'amount', data: 'closedate' }
    },
    stiHubTarget: { collection: 'state.erp.salesOrders', primaryKey: 'id' }
  },
  {
    recurso: 'ordens_servicos',
    modulo: 'pedidos',
    menuGroup: 'Ordens de serviços',
    menuSubItem: 'Gerenciar O.S. & Painel Técnico',
    caminho: '/ordens_servicos',
    acoes: ['listar', 'visualizar', 'cadastrar', 'editar', 'deletar', 'gerar_parcelas', 'listar_anexos', 'anexar', 'deletar_anexo'],
    filtros: ['codigo', 'cliente_id', 'situacao_id', 'tecnico_id', 'vendedor_id', 'data_inicio', 'data_fim', 'loja_id'],
    totalRegistrosLoja118887: 1378,
    fields: [
      'id', 'codigo', 'cliente_id', 'nome_cliente', 'vendedor_id', 'nome_vendedor',
      'tecnico_id', 'nome_tecnico', 'data_entrada', 'data_saida', 'situacao_id', 'nome_situacao',
      'valor_total', 'transportadora_id', 'nome_transportadora', 'centro_custo_id', 'nome_centro_custo',
      'aos_cuidados_de', 'validade', 'introducao', 'observacoes', 'observacoes_interna',
      'desconto_valor', 'desconto_porcentagem', 'valor_frete', 'nome_canal_venda', 'nome_loja',
      'valor_servicos', 'valor_produtos', 'valor_custo', 'condicao_pagamento', 'situacao_financeiro',
      'situacao_estoque', 'forma_pagamento_id', 'data_primeira_parcela', 'numero_parcelas',
      'intervalo_dias', 'nota_fiscal_id', 'nota_fiscal_servico_id', 'hash', 'cadastrado_em',
      'modificado_em', 'exibir_endereco', 'cor_situacao', 'equipamentos', 'pagamentos',
      'enderecos', 'atributos', 'produtos', 'anexos'
    ],
    hubspotMapping: {
      object: 'tickets (Service Hub)',
      keyFields: { codigo: 'subject (OS #codigo)', nome_situacao: 'hs_pipeline_stage', observacoes: 'content', nome_tecnico: 'hubspot_owner_id' }
    },
    stiHubTarget: { collection: 'state.erp.serviceOrders + state.serviceTickets', primaryKey: 'id' }
  },
  {
    recurso: 'contratos',
    modulo: 'contratos',
    menuGroup: 'Contratos',
    menuSubItem: 'Contratos de Locação (Tipo LO) & Serviços',
    caminho: '/contratos',
    acoes: ['listar', 'visualizar', 'cadastrar', 'editar', 'deletar', 'alterar_situacao', 'gerar_parcelas', 'listar_anexos', 'anexar', 'deletar_anexo'],
    filtros: ['codigo', 'cliente_id', 'situacao_id', 'centro_custo_id', 'data_inicio', 'data_fim'],
    totalRegistrosLoja118887: 344,
    fields: [
      'id', 'codigo', 'tipo', 'cliente_id', 'nome_cliente', 'vendedor_id', 'nome_vendedor',
      'canal_venda_id', 'nome_canal_venda', 'loja_id', 'nome_loja', 'situacao_id', 'nome_situacao',
      'centro_custo_id', 'nome_centro_custo', 'plano_contas_id', 'nome_plano_conta',
      'condicao_pagamento', 'forma_pagamento_id', 'nome_forma_pagamento', 'valor_produtos',
      'acrescimo', 'desconto_valor', 'desconto_porcentagem', 'valor_frete', 'valor_total',
      'observacoes', 'observacoes_fatura', 'situacao_financeiro', 'situacao_estoque',
      'cadastrado_em', 'modificado_em', 'data_entrega', 'data_retirada', 'nota_fiscal_servico_id',
      'data', 'periodicidade', 'dia_vencimento', 'proximo_vencimento', 'gerar_recebimento',
      'limite', 'limite_data', 'limite_vezes', 'hora_entrega', 'hora_retirada',
      'valor_frete_retirada', 'retirada_cep', 'retirada_logradouro', 'retirada_numero',
      'retirada_complemento', 'retirada_bairro', 'retirada_cidade_id', 'retirada_nome_cidade',
      'retirada_estado', 'vigencia_locacao', 'tipo_periodo_locacao', 'plano_id', 'nome_plano',
      'produtos', 'pagamentos', 'historico', 'atributos', 'anexos', 'servicos'
    ],
    nestedStructures: {
      'produtos[].produto': ['id', 'produto_id', 'variacao_id', 'nome_produto', 'detalhes', 'possui_variacao', 'movimenta_estoque', 'quantidade', 'unidade', 'valor_venda', 'desconto_valor', 'desconto_porcentagem', 'valor_total'],
      'historico[].situacao': ['situacao_id', 'nome_situacao', 'data', 'observacao', 'nome_usuario', 'cadastrado_em'],
      'atributos[].atributo': ['atributo_id', 'nome (ex: Prazo de locação, Nota Fiscal de Remessa, Proposta nº, Contrato nº)', 'conteudo']
    },
    hubspotMapping: {
      object: 'deals (Pipeline Locação Recorrente MRR)',
      keyFields: { codigo: 'dealname', valor_total: 'hs_mrr', vigencia_locacao: 'contractMonths' }
    },
    stiHubTarget: { collection: 'state.erp.rentalContracts', primaryKey: 'ctr-gc-{id}' }
  },
  {
    recurso: 'locacoes',
    modulo: 'contratos',
    menuGroup: 'Contratos',
    menuSubItem: 'Locações Diretas',
    caminho: '/locacoes',
    acoes: ['listar', 'visualizar', 'cadastrar', 'editar', 'deletar', 'alterar_situacao'],
    filtros: ['codigo', 'cliente_id', 'situacao_id', 'centro_custo_id', 'data_inicio', 'data_fim'],
    totalRegistrosLoja118887: 2,
    fields: [
      'id', 'codigo', 'tipo', 'cliente_id', 'nome_cliente', 'vendedor_id', 'nome_vendedor',
      'canal_venda_id', 'nome_canal_venda', 'loja_id', 'nome_loja', 'data', 'situacao_id',
      'nome_situacao', 'centro_custo_id', 'nome_centro_custo', 'plano_contas_id', 'nome_plano_conta',
      'condicao_pagamento', 'forma_pagamento_id', 'nome_forma_pagamento', 'periodicidade',
      'dia_vencimento', 'proximo_vencimento', 'gerar_recebimento', 'limite', 'limite_data',
      'limite_vezes', 'valor_produtos', 'acrescimo', 'desconto_valor', 'desconto_porcentagem',
      'valor_frete', 'valor_total', 'observacoes', 'observacoes_fatura', 'situacao_financeiro',
      'situacao_estoque', 'cadastrado_em', 'modificado_em', 'data_entrega', 'hora_entrega',
      'data_retirada', 'hora_retirada', 'valor_frete_retirada', 'retirada_cep', 'retirada_logradouro',
      'retirada_numero', 'retirada_complemento', 'retirada_bairro', 'retirada_cidade_id',
      'retirada_nome_cidade', 'retirada_estado', 'vigencia_locacao', 'tipo_periodo_locacao',
      'produtos', 'pagamentos', 'historico', 'atributos', 'anexos'
    ],
    stiHubTarget: { collection: 'state.erp.rentalContracts', primaryKey: 'ctr-loc-{id}' }
  },
  {
    recurso: 'compras',
    modulo: 'estoque',
    menuGroup: 'Estoque',
    menuSubItem: 'Compras & Entrada NF-e (SEFAZ Mod. 55)',
    caminho: '/compras',
    acoes: ['listar', 'visualizar', 'cadastrar', 'editar', 'deletar', 'gerar_parcelas'],
    filtros: ['codigo', 'fornecedor_id', 'situacao_id', 'data_inicio', 'data_fim', 'loja_id'],
    totalRegistrosLoja118887: 54,
    fields: [
      'id', 'codigo', 'fornecedor_id', 'nome_fornecedor', 'data_emissao', 'situacao_id',
      'nome_situacao', 'centro_custo_id', 'nome_centro_custo', 'numero_nfe', 'valor_frete',
      'pagar_frete', 'transportadora_id', 'nome_transportadora', 'valor_produtos',
      'valor_impostos', 'desconto_valor', 'desconto_porcentagem', 'valor_total',
      'condicao_pagamento', 'forma_pagamento_id', 'intervalo_dias', 'numero_parcelas',
      'data_primeira_parcela', 'observacoes', 'observacoes_interna', 'cadastrado_em',
      'modificado_em', 'pagamentos', 'situacoes', 'produtos', 'campos_extras'
    ],
    nestedStructures: {
      'produtos[].produto': ['id', 'produto_id', 'estoque_id', 'nome_produto', 'detalhes', 'possui_variacao', 'unidade', 'quantidade', 'quantidade_saida', 'valor_custo', 'valor_total', 'largura', 'altura'],
      'pagamentos[].pagamento': ['id', 'data_vencimento', 'valor', 'forma_pagamento_id', 'nome_forma_pagamento', 'plano_contas_id', 'nome_plano_conta', 'observacao']
    },
    stiHubTarget: { collection: 'state.erp.purchaseOrders', primaryKey: 'id' }
  },
  {
    recurso: 'recebimentos',
    modulo: 'financeiro',
    menuGroup: 'Financeiro',
    menuSubItem: 'Contas a Receber & Boletos/PIX',
    caminho: '/recebimentos',
    acoes: ['listar', 'visualizar', 'cadastrar', 'editar', 'deletar'],
    filtros: ['data_inicio', 'data_fim', 'liquidado', 'cliente_id', 'conta_bancaria_id', 'plano_contas_id', 'centro_custo_id', 'forma_pagamento_id', 'loja_id'],
    totalRegistrosLoja118887: 153,
    fields: [
      'id', 'codigo', 'descricao', 'valor', 'juros', 'desconto', 'taxa_banco', 'taxa_operadora',
      'valor_total', 'plano_contas_id', 'nome_plano_conta', 'centro_custo_id', 'nome_centro_custo',
      'conta_bancaria_id', 'nome_conta_bancaria', 'forma_pagamento_id', 'nome_forma_pagamento',
      'entidade', 'fornecedor_id', 'nome_fornecedor', 'cliente_id', 'nome_cliente',
      'transportadora_id', 'nome_transportadora', 'funcionario_id', 'nome_funcionario',
      'liquidado', 'data_vencimento', 'data_liquidacao', 'data_competencia', 'usuario_id',
      'nome_usuario', 'loja_id', 'nome_loja', 'cadastrado_em', 'modificado_em', 'atributos'
    ],
    stiHubTarget: { collection: 'state.erp.financialEntries (type=RECEBER) + state.erp.invoices', primaryKey: 'fin-gc-rec-{id}' }
  },
  {
    recurso: 'pagamentos',
    modulo: 'financeiro',
    menuGroup: 'Financeiro',
    menuSubItem: 'Contas a Pagar',
    caminho: '/pagamentos',
    acoes: ['listar', 'visualizar', 'cadastrar', 'editar', 'deletar'],
    filtros: ['data_inicio', 'data_fim', 'liquidado', 'fornecedor_id', 'conta_bancaria_id', 'plano_contas_id', 'centro_custo_id', 'forma_pagamento_id', 'loja_id'],
    totalRegistrosLoja118887: 41,
    fields: [
      'id', 'codigo', 'descricao', 'valor', 'juros', 'desconto', 'taxa_banco', 'taxa_operadora',
      'valor_total', 'plano_contas_id', 'nome_plano_conta', 'centro_custo_id', 'nome_centro_custo',
      'conta_bancaria_id', 'nome_conta_bancaria', 'forma_pagamento_id', 'nome_forma_pagamento',
      'entidade', 'fornecedor_id', 'nome_fornecedor', 'cliente_id', 'nome_cliente',
      'transportadora_id', 'nome_transportadora', 'funcionario_id', 'nome_funcionario',
      'liquidado', 'data_vencimento', 'data_liquidacao', 'data_competencia', 'usuario_id',
      'nome_usuario', 'loja_id', 'nome_loja', 'cadastrado_em', 'modificado_em', 'atributos'
    ],
    stiHubTarget: { collection: 'state.erp.financialEntries (type=PAGAR)', primaryKey: 'fin-gc-pag-{id}' }
  },
  {
    recurso: 'contas_bancarias',
    modulo: 'financeiro',
    menuGroup: 'Financeiro',
    menuSubItem: 'Contas Bancárias (Inter #237906, Itaú #142155, Conta Integrada #710407)',
    caminho: '/contas_bancarias',
    acoes: ['listar'],
    filtros: [],
    totalRegistrosLoja118887: 3,
    fields: ['id', 'nome'],
    stiHubTarget: { collection: 'state.erp.bankAccounts', primaryKey: 'id' }
  },
  {
    recurso: 'planos_contas',
    modulo: 'financeiro',
    menuGroup: 'Financeiro',
    menuSubItem: 'Plano de Contas Contábil/DRE',
    caminho: '/planos_contas',
    acoes: ['listar'],
    filtros: ['tipo'],
    totalRegistrosLoja118887: 100,
    fields: ['id', 'conta_mae_id', 'classificacao', 'tipo', 'nome', 'nome_tipo', 'nome_conta_mae'],
    stiHubTarget: { collection: 'state.erp.financialEntries.category (DRE)', primaryKey: 'id' }
  },
  {
    recurso: 'centros_custos',
    modulo: 'financeiro',
    menuGroup: 'Financeiro',
    menuSubItem: 'Centros de Custo (Locação, Operacional, Vendas)',
    caminho: '/centros_custos',
    acoes: ['listar'],
    filtros: [],
    totalRegistrosLoja118887: 13,
    fields: ['id', 'nome', 'cadastrado_em'],
    stiHubTarget: { collection: 'state.erp.financialEntries.costCenter', primaryKey: 'id' }
  },
  {
    recurso: 'formas_pagamentos',
    modulo: 'financeiro',
    menuGroup: 'Financeiro',
    menuSubItem: 'Formas de Pagamento & Carteiras Boleto/PIX',
    caminho: '/formas_pagamentos',
    acoes: ['listar'],
    filtros: [],
    totalRegistrosLoja118887: 12,
    fields: [
      'id', 'nome', 'conta_bancaria_id', 'nome_conta_bancaria', 'movimentacao', 'confirmar_financeiro',
      'maximo_parcelas', 'intervalo_parcelas', 'intervalo_primeira_parcela', 'disponivel_pdv',
      'tipo', 'bandeira_cartao', 'cnpj_credenciadora', 'taxa_banco', 'taxa_operadora', 'boleto',
      'banco', 'cnab', 'carteira', 'agencia', 'agencia_dv', 'conta', 'conta_dv', 'codigo_cliente',
      'codigo_cliente_dv', 'taxa_multa_atraso', 'taxa_mora_atraso', 'dias_juros', 'aceite',
      'especie_doc', 'protestar', 'dias_protesto', 'ultimo_boleto', 'ultima_remessa',
      'versao_layout_header', 'versao_layout_header_lote', 'ambiente', 'instrucao1', 'instrucao2',
      'instrucao3', 'instrucao4', 'local_pagamento1', 'demonstrativo1', 'demonstrativo2'
    ],
    stiHubTarget: { collection: 'state.erp.financialEntries.paymentMethod', primaryKey: 'id' }
  },
  {
    recurso: 'notas_fiscais_produtos',
    modulo: 'fiscal',
    menuGroup: 'Fiscal',
    menuSubItem: 'Notas de Produtos — NF-e Modelo 55 (Remessa Locação CFOP 5.908/6.908 & Vendas)',
    caminho: '/notas_fiscais_produtos',
    acoes: ['listar', 'visualizar', 'cadastrar', 'editar', 'deletar', 'emitir', 'cancelar'],
    filtros: ['numero', 'chave', 'situacao', 'cliente_id', 'fornecedor_id', 'data_inicio', 'data_fim', 'loja_id'],
    totalRegistrosLoja118887: 1664,
    fields: [
      'id', 'empresa_id', 'loja_id', 'nome_loja', 'pedido_id', 'compra_id', 'chave', 'protocolo',
      'cfop_id', 'codigo_cfop', 'descricao_cfop', 'natureza_operacao', 'indicador_pagamento',
      'modelo', 'serie', 'numero_nf', 'data_emissao', 'hora_emissao', 'tipo_nf',
      'indicador_destinatario', 'cidade_id', 'cidade_nome', 'codigo_uf', 'tipo_emissao',
      'tipo_ambiente', 'finalidade_nf', 'consumidor_final', 'tipo_atendimento',
      'tipo_documento_emitente', 'cnpj_emitente', 'cpf_emitente', 'nome_emitente',
      'fantasia_emitente', 'logradouro_emitente', 'numero_emitente', 'complemento_emitente',
      'bairro_emitente', 'codigo_municipio_emitente', 'municipio_emitente', 'uf_emitente',
      'cep_emitente', 'codigo_pais_emitente', 'pais_emitente', 'telefone_emitente', 'ie_emitente',
      'iest_emitente', 'im_emitente', 'destinatario_id', 'destinatario_nome',
      'destinatario_fornecedor_id', 'destinatario_fornecedor_nome', 'destinatario_tipo_documento',
      'destinatario_cnpj', 'destinatario_cpf', 'destinatario_id_estrangeiro',
      'destinatario_logradouro', 'destinatario_numero', 'destinatario_complemento',
      'destinatario_bairro', 'destinatario_cidade_id', 'destinatario_municipio_codigo',
      'destinatario_municipio_nome', 'destinatario_uf', 'destinatario_cep',
      'destinatario_pais_codigo', 'destinatario_pais_nome', 'destinatario_telefone',
      'destinatario_ie', 'destinatario_im', 'destinatario_email', 'valor_total_nf', 'base_icms',
      'valor_icms', 'valor_fcp', 'base_icms_st', 'valor_icms_st', 'valor_fcp_st',
      'valor_produtos', 'valor_frete', 'valor_seguro', 'valor_desconto', 'valor_outros',
      'valor_imposto_importacao', 'valor_ipi', 'valor_ipi_devolvido', 'valor_pis',
      'valor_cofins', 'valor_icms_desonerado', 'valor_fcp_st_retido', 'valor_fcp_uf_destino',
      'valor_icms_uf_remetente', 'informacoes_complementares', 'situacao_nf', 'cadastrado_em',
      'modificado_em', 'produtos', 'pagamento'
    ],
    nestedStructures: {
      'produtos[]': ['produto_id', 'codigo_produto', 'nome_produto', 'cfop', 'unidade', 'quantidade', 'valor_venda', 'estoque_id', 'ncm_id', 'NCM', 'tipo', 'altura', 'largura', 'codigo_barras'],
      'pagamento[]': ['numero_duplicata', 'forma_pagamento_id', 'data_vencimento', 'valor_pagamento', 'tipo_pagamento', 'codigo_autorizacao', 'cnpj_credenciadora', 'bandeira_cartao', 'valor_troco']
    },
    stiHubTarget: { collection: 'state.erp.invoices (NFE_REMESSA_LOCACAO / NFE_VENDA_PRODUTO)', primaryKey: 'inv-nfe-{id}' }
  },
  {
    recurso: 'notas_fiscais_servicos',
    modulo: 'fiscal',
    menuGroup: 'Fiscal',
    menuSubItem: 'Notas de Serviços — NFS-e Municipal (LC 116/03)',
    caminho: '/notas_fiscais_servicos',
    acoes: ['listar', 'visualizar', 'cadastrar', 'editar', 'deletar', 'emitir', 'cancelar'],
    filtros: ['numero', 'rps', 'situacao', 'cliente_id', 'data_inicio', 'data_fim', 'loja_id'],
    totalRegistrosLoja118887: 945,
    fields: [
      'id', 'empresa_id', 'loja_id', 'nome_loja', 'contrato_id', 'pedido_id', 'codigo', 'rps',
      'numero', 'codigo_verificacao', 'serie', 'data_emissao', 'data_emissao_ano',
      'data_emissao_mes', 'hora_emissao', 'codigo_natureza_operacao', 'nome_natureza_operacao',
      'codigo_incidencia_issqn', 'cidade_incidencia_issqn', 'emitente_cnpj',
      'emitente_inscricao_municipal', 'destinatario_id_cliente', 'destinatario_nome_cliente',
      'destinatario_tipo_pessoa', 'destinatario_razao_social', 'destinatario_cnpj',
      'destinatario_cpf', 'destinatario_inscricao_municipal', 'destinatario_cep',
      'destinatario_logradouro_endereco', 'destinatario_numero_endereco',
      'destinatario_complemento_endereco', 'destinatario_bairro_endereco',
      'destinatario_cidade_id_endereco', 'destinatario_nome_cidade_endereco',
      'destinatario_codigo_cidade_endereco', 'dest_codigo_siafi', 'destinatario_estado_endereco',
      'destinatario_telefone', 'destinatario_email', 'prestador_cep', 'prestador_logradouro',
      'prestador_numero', 'prestador_complemento', 'prestador_bairro', 'prestador_cidade_id',
      'prestador_nome_cidade', 'prestador_codigo_cidade', 'prestador_estado', 'descricao',
      'atividade_id', 'codigo_atividade', 'atividade_descricao', 'atividade_codigo_tributacao',
      'atividade_cnae', 'valor_servico', 'valor_base_calculo', 'valor_iss', 'iss_retido',
      'valor_deducoes', 'valor_aliquota', 'descontos', 'construcao_civil', 'codigo_obra',
      'codigo_art', 'indicador_operacao', 'codigo_indicador_operacao', 'tipo_operacao',
      'aliquota_cofins', 'aliquota_pis', 'aliquota_csll', 'aliquota_ir', 'aliquota_inss',
      'valor_cofins', 'valor_pis', 'valor_csll', 'valor_ir', 'valor_inss', 'cofins_retido',
      'pis_retido', 'csll_retido', 'ir_retido', 'inss_retido', 'valor_total',
      'outras_informacoes', 'situacao', 'hash', 'usuario_id', 'nome_usuario',
      'cadastrado_em', 'modificado_em'
    ],
    stiHubTarget: { collection: 'state.erp.invoices (NFSE_SERVICO)', primaryKey: 'inv-nfse-{id}' }
  },
  {
    recurso: 'funis',
    modulo: 'crm',
    menuGroup: 'Atendimentos & CRM',
    menuSubItem: 'Funis de Vendas',
    caminho: '/funis',
    acoes: ['listar', 'visualizar', 'cadastrar', 'editar', 'deletar', 'atributos'],
    filtros: ['nome'],
    totalRegistrosLoja118887: 3,
    fields: ['id', 'empresa_id', 'nome', 'padrao', 'usuario_id', 'nome_usuario', 'cadastrado_em', 'modificado_em', 'etapas'],
    hubspotMapping: {
      object: 'pipelines (deals)',
      keyFields: { nome: 'label', etapas: 'stages[]' }
    },
    stiHubTarget: { collection: 'state.pipelines', primaryKey: 'id' }
  },
  {
    recurso: 'negocios',
    modulo: 'crm',
    menuGroup: 'Atendimentos & CRM',
    menuSubItem: 'Negócios / Oportunidades no Funil',
    caminho: '/negocios',
    acoes: ['listar', 'visualizar', 'cadastrar', 'editar', 'deletar', 'upload', 'atualiza_etapa', 'atualiza_ordem', 'situacoes', 'atributos', 'configuracoes'],
    filtros: ['modo', 'funil_id', 'etapa_id', 'situacao_id', 'cliente_id', 'vendedor_id', 'loja', 'nome', 'codigo', 'data_inicio', 'data_fim', 'sem_atividade', 'nunca_trabalhados'],
    totalRegistrosLoja118887: 12,
    fields: [
      'id', 'loja_id', 'nome_loja', 'codigo', 'nome', 'cliente_id', 'nome_cliente',
      'vendedor_id', 'nome_vendedor', 'data', 'data_ano', 'data_mes', 'data_fechamento',
      'data_fechamento_ano', 'data_fechamento_mes', 'observacoes', 'ordem', 'valor_servicos',
      'valor_produtos', 'desconto_valor', 'desconto_porcentagem', 'valor_total',
      'proposta_status', 'proposta_url', 'usuario_id', 'nome_usuario', 'hash',
      'situacao_data', 'situacao_id', 'nome_situacao', 'pedido_id', 'previsao_entrega',
      'responsavel_id', 'cadastrado_em', 'modificado_em', 'cliente_tipo'
    ],
    hubspotMapping: {
      object: 'deals',
      keyFields: { nome: 'dealname', valor_total: 'amount', etapa_id: 'dealstage', data_fechamento: 'closedate', vendedor_id: 'hubspot_owner_id' }
    },
    stiHubTarget: { collection: 'state.deals', primaryKey: 'id' }
  },
  {
    recurso: 'prospectos',
    modulo: 'crm',
    menuGroup: 'Atendimentos & CRM',
    menuSubItem: 'Prospectos / Leads Inbound & Outbound',
    caminho: '/prospectos',
    acoes: ['listar', 'visualizar', 'cadastrar', 'editar', 'deletar'],
    filtros: ['nome', 'tipo_pessoa', 'codigo', 'cpf_cnpj', 'telefone', 'email', 'classificacao', 'cidade', 'estado', 'data_inicio', 'data_fim'],
    totalRegistrosLoja118887: 18,
    fields: [
      'id', 'codigo', 'cpf', 'nome_social', 'razao_social', 'cnpj', 'es_documento', 'nome',
      'tipo', 'classificacao', 'tipo_pessoa', 'ativo', 'telefone', 'celular', 'email',
      'loja_virtual_ativo', 'webdesk_ativo', 'cadastrado_em', 'nome_tipo_pessoa',
      'caminho_foto', 'documento', 'telefone_celular'
    ],
    hubspotMapping: {
      object: 'contacts (lifecycleStage = LEAD / MQL)',
      keyFields: { nome: 'firstname + lastname', email: 'email', telefone: 'phone', classificacao: 'hs_lead_status' }
    },
    stiHubTarget: { collection: 'state.contacts', primaryKey: 'id' }
  },
  {
    recurso: 'tarefas',
    modulo: 'crm',
    menuGroup: 'Atendimentos & CRM',
    menuSubItem: 'Tarefas Comerciais & Agenda',
    caminho: '/tarefas',
    acoes: ['listar', 'visualizar', 'cadastrar', 'editar', 'deletar', 'prioridades'],
    filtros: ['nome', 'tipo_id', 'prioridade_id', 'situacao', 'responsavel_id', 'controller', 'registro_id', 'loja', 'data_inicio', 'data_fim'],
    totalRegistrosLoja118887: 8,
    fields: [
      'id', 'empresa_id', 'loja_id', 'nome_loja', 'nome', 'tipo_id', 'nome_tipo',
      'icone_tipo', 'prioridade_id', 'nome_prioridade', 'data', 'hora', 'previsao_data',
      'previsao_hora', 'descricao', 'situacao', 'resultado', 'observacao_resultado',
      'entidade', 'action', 'entidade_id', 'nome_entidade', 'usuario_id', 'nome_usuario',
      'responsavel_id', 'nome_responsavel', 'cadastrado_em', 'modificado_em'
    ],
    hubspotMapping: {
      object: 'tasks (engagements)',
      keyFields: { nome: 'hs_task_subject', descricao: 'hs_task_body', previsao_data: 'hs_timestamp', nome_prioridade: 'hs_task_priority' }
    },
    stiHubTarget: { collection: 'state.tasks + state.timelineEvents', primaryKey: 'id' }
  },
  {
    recurso: 'documentos',
    modulo: 'assinatura_digital',
    menuGroup: 'Contratos',
    menuSubItem: 'Assinatura Digital (ICP-Brasil / Gov.br)',
    caminho: '/documentos',
    acoes: ['listar', 'visualizar', 'cadastrar', 'editar', 'deletar', 'signatarios', 'cancelar', 'enviar'],
    filtros: ['documento', 'contato', 'loja', 'situacao', 'data_inicio', 'data_fim'],
    totalRegistrosLoja118887: 12,
    fields: ['id', 'documento', 'situacao', 'loja_id', 'signatarios', 'hash_sha256', 'cadastrado_em', 'modificado_em'],
    stiHubTarget: { collection: 'state.erp.proposals.digitalSignature', primaryKey: 'id' }
  },
  {
    recurso: 'lojas',
    modulo: 'core',
    menuGroup: 'Configurações',
    menuSubItem: 'Empresas / Lojas (Matriz #118887)',
    caminho: '/lojas',
    acoes: ['listar'],
    filtros: [],
    totalRegistrosLoja118887: 1,
    fields: ['id', 'nome'],
    stiHubTarget: { collection: 'state.erp.gestaoClickConfig.storeId', primaryKey: 'id' }
  },
  {
    recurso: 'usuarios',
    modulo: 'core',
    menuGroup: 'Configurações',
    menuSubItem: 'Usuários & Permissões RBAC',
    caminho: '/usuarios',
    acoes: ['listar'],
    filtros: [],
    totalRegistrosLoja118887: 6,
    fields: [
      'id', 'nome', 'cpf', 'rg', 'data_nascimento', 'sexo', 'grupo_id', 'email',
      'observacoes', 'telefone', 'celular1', 'celular2', 'hora_entrada',
      'hora_almoco_entrada', 'hora_almoco_saida', 'hora_saida', 'ativo'
    ],
    hubspotMapping: {
      object: 'owners',
      keyFields: { id: 'ownerId', nome: 'name', email: 'email' }
    },
    stiHubTarget: { collection: 'state.erp.gestaoClickConfig.users + RBAC', primaryKey: 'id' }
  }
];

export const GESTAOCLICK_ALL_76_ENDPOINTS: Array<{
  recurso: string;
  modulo: string;
  caminho: string;
  acoes: string[];
}> = [
  {
    "recurso": "clientes",
    "modulo": "core",
    "caminho": "/clientes",
    "acoes": [
      "listar",
      "visualizar",
      "cadastrar",
      "editar",
      "deletar"
    ]
  },
  {
    "recurso": "fornecedores",
    "modulo": "core",
    "caminho": "/fornecedores",
    "acoes": [
      "listar",
      "visualizar",
      "cadastrar",
      "editar",
      "deletar"
    ]
  },
  {
    "recurso": "funcionarios",
    "modulo": "core",
    "caminho": "/funcionarios",
    "acoes": [
      "listar"
    ]
  },
  {
    "recurso": "transportadoras",
    "modulo": "core",
    "caminho": "/transportadoras",
    "acoes": [
      "listar",
      "visualizar",
      "cadastrar",
      "editar",
      "deletar"
    ]
  },
  {
    "recurso": "produtos",
    "modulo": "core",
    "caminho": "/produtos",
    "acoes": [
      "listar",
      "visualizar",
      "cadastrar",
      "editar",
      "deletar"
    ]
  },
  {
    "recurso": "servicos",
    "modulo": "core",
    "caminho": "/servicos",
    "acoes": [
      "listar",
      "visualizar",
      "cadastrar",
      "editar",
      "deletar"
    ]
  },
  {
    "recurso": "grupos_produtos",
    "modulo": "core",
    "caminho": "/grupos_produtos",
    "acoes": [
      "listar"
    ]
  },
  {
    "recurso": "orcamentos",
    "modulo": "pedidos",
    "caminho": "/orcamentos",
    "acoes": [
      "listar",
      "visualizar",
      "cadastrar",
      "editar",
      "deletar",
      "gerar_parcelas",
      "listar_anexos",
      "anexar",
      "deletar_anexo"
    ]
  },
  {
    "recurso": "vendas",
    "modulo": "pedidos",
    "caminho": "/vendas",
    "acoes": [
      "listar",
      "visualizar",
      "cadastrar",
      "editar",
      "deletar",
      "gerar_parcelas",
      "listar_anexos",
      "anexar",
      "deletar_anexo"
    ]
  },
  {
    "recurso": "ordens_servicos",
    "modulo": "pedidos",
    "caminho": "/ordens_servicos",
    "acoes": [
      "listar",
      "visualizar",
      "cadastrar",
      "editar",
      "deletar",
      "gerar_parcelas",
      "listar_anexos",
      "anexar",
      "deletar_anexo"
    ]
  },
  {
    "recurso": "contratos",
    "modulo": "contratos",
    "caminho": "/contratos",
    "acoes": [
      "listar",
      "visualizar",
      "cadastrar",
      "editar",
      "deletar",
      "alterar_situacao",
      "gerar_parcelas",
      "listar_anexos",
      "anexar",
      "deletar_anexo"
    ]
  },
  {
    "recurso": "contratos_servicos",
    "modulo": "contratos",
    "caminho": "/contratos_servicos",
    "acoes": [
      "listar",
      "visualizar",
      "cadastrar",
      "editar",
      "deletar",
      "alterar_situacao",
      "gerar_parcelas"
    ]
  },
  {
    "recurso": "locacoes",
    "modulo": "contratos",
    "caminho": "/locacoes",
    "acoes": [
      "listar",
      "visualizar",
      "cadastrar",
      "editar",
      "deletar",
      "alterar_situacao"
    ]
  },
  {
    "recurso": "assinaturas",
    "modulo": "contratos",
    "caminho": "/assinaturas",
    "acoes": [
      "listar",
      "visualizar",
      "cadastrar",
      "editar",
      "deletar",
      "alterar_situacao"
    ]
  },
  {
    "recurso": "compras",
    "modulo": "estoque",
    "caminho": "/compras",
    "acoes": [
      "listar",
      "visualizar",
      "cadastrar",
      "editar",
      "deletar",
      "gerar_parcelas"
    ]
  },
  {
    "recurso": "recebimentos",
    "modulo": "financeiro",
    "caminho": "/recebimentos",
    "acoes": [
      "listar",
      "visualizar",
      "cadastrar",
      "editar",
      "deletar"
    ]
  },
  {
    "recurso": "pagamentos",
    "modulo": "financeiro",
    "caminho": "/pagamentos",
    "acoes": [
      "listar",
      "visualizar",
      "cadastrar",
      "editar",
      "deletar"
    ]
  },
  {
    "recurso": "contas_bancarias",
    "modulo": "financeiro",
    "caminho": "/contas_bancarias",
    "acoes": [
      "listar"
    ]
  },
  {
    "recurso": "planos_contas",
    "modulo": "financeiro",
    "caminho": "/planos_contas",
    "acoes": [
      "listar"
    ]
  },
  {
    "recurso": "centros_custos",
    "modulo": "financeiro",
    "caminho": "/centros_custos",
    "acoes": [
      "listar"
    ]
  },
  {
    "recurso": "formas_pagamentos",
    "modulo": "financeiro",
    "caminho": "/formas_pagamentos",
    "acoes": [
      "listar"
    ]
  },
  {
    "recurso": "notas_fiscais_produtos",
    "modulo": "fiscal",
    "caminho": "/notas_fiscais_produtos",
    "acoes": [
      "listar",
      "visualizar",
      "cadastrar",
      "editar",
      "deletar",
      "emitir",
      "cancelar"
    ]
  },
  {
    "recurso": "notas_fiscais_servicos",
    "modulo": "fiscal",
    "caminho": "/notas_fiscais_servicos",
    "acoes": [
      "listar",
      "visualizar",
      "cadastrar",
      "editar",
      "deletar",
      "emitir",
      "cancelar"
    ]
  },
  {
    "recurso": "notas_fiscais_consumidores",
    "modulo": "fiscal",
    "caminho": "/notas_fiscais_consumidores",
    "acoes": [
      "listar",
      "visualizar",
      "cadastrar",
      "editar",
      "deletar",
      "emitir",
      "cancelar"
    ]
  },
  {
    "recurso": "funis",
    "modulo": "crm",
    "caminho": "/funis",
    "acoes": [
      "listar",
      "visualizar",
      "cadastrar",
      "editar",
      "deletar",
      "atributos"
    ]
  },
  {
    "recurso": "negocios",
    "modulo": "crm",
    "caminho": "/negocios",
    "acoes": [
      "listar",
      "visualizar",
      "cadastrar",
      "editar",
      "deletar",
      "upload",
      "atualiza_etapa",
      "atualiza_ordem",
      "situacoes",
      "atributos",
      "configuracoes"
    ]
  },
  {
    "recurso": "prospectos",
    "modulo": "crm",
    "caminho": "/prospectos",
    "acoes": [
      "listar",
      "visualizar",
      "cadastrar",
      "editar",
      "deletar"
    ]
  },
  {
    "recurso": "tarefas",
    "modulo": "crm",
    "caminho": "/tarefas",
    "acoes": [
      "listar",
      "visualizar",
      "cadastrar",
      "editar",
      "deletar",
      "prioridades"
    ]
  },
  {
    "recurso": "documentos",
    "modulo": "assinatura_digital",
    "caminho": "/documentos",
    "acoes": [
      "listar",
      "visualizar",
      "cadastrar",
      "editar",
      "deletar",
      "signatarios",
      "cancelar",
      "enviar"
    ]
  },
  {
    "recurso": "atributos_cadastros",
    "modulo": "core",
    "caminho": "/atributos_cadastros",
    "acoes": [
      "listar",
      "visualizar",
      "cadastrar",
      "editar",
      "deletar"
    ]
  },
  {
    "recurso": "atributos_contratos",
    "modulo": "contratos",
    "caminho": "/atributos_contratos",
    "acoes": [
      "listar",
      "visualizar"
    ]
  },
  {
    "recurso": "atributos_financeiros",
    "modulo": "financeiro",
    "caminho": "/atributos_financeiros",
    "acoes": [
      "listar",
      "visualizar",
      "cadastrar",
      "editar",
      "deletar"
    ]
  },
  {
    "recurso": "atributos_orcamentos",
    "modulo": "pedidos",
    "caminho": "/atributos_orcamentos",
    "acoes": [
      "listar",
      "visualizar",
      "cadastrar",
      "editar",
      "deletar"
    ]
  },
  {
    "recurso": "atributos_ordens_servicos",
    "modulo": "pedidos",
    "caminho": "/atributos_ordens_servicos",
    "acoes": [
      "listar",
      "visualizar",
      "cadastrar",
      "editar",
      "deletar"
    ]
  },
  {
    "recurso": "atributos_produtos",
    "modulo": "core",
    "caminho": "/atributos_produtos",
    "acoes": [
      "listar",
      "visualizar",
      "cadastrar",
      "editar",
      "deletar"
    ]
  },
  {
    "recurso": "atributos_vendas",
    "modulo": "pedidos",
    "caminho": "/atributos_vendas",
    "acoes": [
      "listar",
      "visualizar",
      "cadastrar",
      "editar",
      "deletar"
    ]
  },
  {
    "recurso": "cidades",
    "modulo": "core",
    "caminho": "/cidades",
    "acoes": [
      "listar"
    ]
  },
  {
    "recurso": "conta_dados_cobranca",
    "modulo": "core",
    "caminho": "/conta/dados_cobranca",
    "acoes": [
      "listar"
    ]
  },
  {
    "recurso": "conta_pagamentos",
    "modulo": "core",
    "caminho": "/conta/pagamentos",
    "acoes": [
      "listar"
    ]
  },
  {
    "recurso": "conta_plano",
    "modulo": "core",
    "caminho": "/conta/plano",
    "acoes": [
      "listar"
    ]
  },
  {
    "recurso": "conta_precos_planos",
    "modulo": "core",
    "caminho": "/conta/precos_planos",
    "acoes": [
      "listar"
    ]
  },
  {
    "recurso": "contatos",
    "modulo": "assinatura_digital",
    "caminho": "/contatos",
    "acoes": [
      "listar",
      "visualizar",
      "cadastrar",
      "editar",
      "deletar",
      "signatarios"
    ]
  },
  {
    "recurso": "estados",
    "modulo": "core",
    "caminho": "/estados",
    "acoes": [
      "listar"
    ]
  },
  {
    "recurso": "lojas",
    "modulo": "core",
    "caminho": "/lojas",
    "acoes": [
      "listar"
    ]
  },
  {
    "recurso": "modelos",
    "modulo": "assinatura_digital",
    "caminho": "/modelos",
    "acoes": [
      "listar",
      "visualizar",
      "deletar",
      "gerar_documento"
    ]
  },
  {
    "recurso": "pastas",
    "modulo": "assinatura_digital",
    "caminho": "/pastas",
    "acoes": [
      "listar",
      "visualizar",
      "cadastrar",
      "editar",
      "deletar",
      "documentos",
      "usuarios"
    ]
  },
  {
    "recurso": "relatorio_centros_custos",
    "modulo": "financeiro",
    "caminho": "/relatorios/centros_custos",
    "acoes": [
      "listar"
    ]
  },
  {
    "recurso": "relatorio_clientes_mais_compram",
    "modulo": "pedidos",
    "caminho": "/relatorios/clientes_mais_compram",
    "acoes": [
      "listar"
    ]
  },
  {
    "recurso": "relatorio_comissao_produto",
    "modulo": "pedidos",
    "caminho": "/relatorios/comissao_produto",
    "acoes": [
      "listar"
    ]
  },
  {
    "recurso": "relatorio_comissao_servico",
    "modulo": "pedidos",
    "caminho": "/relatorios/comissao_servico",
    "acoes": [
      "listar"
    ]
  },
  {
    "recurso": "relatorio_comissao_vendedores",
    "modulo": "pedidos",
    "caminho": "/relatorios/comissao_vendedores",
    "acoes": [
      "listar"
    ]
  },
  {
    "recurso": "relatorio_comissao_vendedores_financeiro",
    "modulo": "financeiro",
    "caminho": "/relatorios/comissao_vendedores_financeiro",
    "acoes": [
      "listar"
    ]
  },
  {
    "recurso": "relatorio_contas_bancarias",
    "modulo": "financeiro",
    "caminho": "/relatorios/contas_bancarias",
    "acoes": [
      "listar"
    ]
  },
  {
    "recurso": "relatorio_contas_pagar",
    "modulo": "financeiro",
    "caminho": "/relatorios/contas_pagar",
    "acoes": [
      "listar"
    ]
  },
  {
    "recurso": "relatorio_contas_receber",
    "modulo": "financeiro",
    "caminho": "/relatorios/contas_receber",
    "acoes": [
      "listar"
    ]
  },
  {
    "recurso": "relatorio_devolucoes",
    "modulo": "pedidos",
    "caminho": "/relatorios/devolucoes",
    "acoes": [
      "listar"
    ]
  },
  {
    "recurso": "relatorio_dre",
    "modulo": "financeiro",
    "caminho": "/relatorios/dre",
    "acoes": [
      "listar"
    ]
  },
  {
    "recurso": "relatorio_extrato",
    "modulo": "financeiro",
    "caminho": "/relatorios/extrato",
    "acoes": [
      "listar"
    ]
  },
  {
    "recurso": "relatorio_fluxo_caixa",
    "modulo": "financeiro",
    "caminho": "/relatorios/fluxo_caixa",
    "acoes": [
      "listar"
    ]
  },
  {
    "recurso": "relatorio_orcamentos",
    "modulo": "pedidos",
    "caminho": "/relatorios/orcamentos",
    "acoes": [
      "listar"
    ]
  },
  {
    "recurso": "relatorio_pesquisa_movimentacoes",
    "modulo": "financeiro",
    "caminho": "/relatorios/pesquisa_movimentacoes",
    "acoes": [
      "listar"
    ]
  },
  {
    "recurso": "relatorio_produtos_vendidos",
    "modulo": "pedidos",
    "caminho": "/relatorios/produtos_vendidos",
    "acoes": [
      "listar"
    ]
  },
  {
    "recurso": "relatorio_servicos_vendidos",
    "modulo": "pedidos",
    "caminho": "/relatorios/servicos_vendidos",
    "acoes": [
      "listar"
    ]
  },
  {
    "recurso": "relatorio_vendas",
    "modulo": "pedidos",
    "caminho": "/relatorios/vendas",
    "acoes": [
      "listar"
    ]
  },
  {
    "recurso": "situacoes_assinaturas",
    "modulo": "contratos",
    "caminho": "/situacoes_assinaturas",
    "acoes": [
      "listar",
      "listar_nome_interno"
    ]
  },
  {
    "recurso": "situacoes_compras",
    "modulo": "estoque",
    "caminho": "/situacoes_compras",
    "acoes": [
      "listar"
    ]
  },
  {
    "recurso": "situacoes_contratos",
    "modulo": "contratos",
    "caminho": "/situacoes_contratos",
    "acoes": [
      "listar"
    ]
  },
  {
    "recurso": "situacoes_locacoes",
    "modulo": "contratos",
    "caminho": "/situacoes_locacoes",
    "acoes": [
      "listar"
    ]
  },
  {
    "recurso": "situacoes_orcamentos",
    "modulo": "pedidos",
    "caminho": "/situacoes_orcamentos",
    "acoes": [
      "listar"
    ]
  },
  {
    "recurso": "situacoes_ordens_servicos",
    "modulo": "pedidos",
    "caminho": "/situacoes_ordens_servicos",
    "acoes": [
      "listar"
    ]
  },
  {
    "recurso": "situacoes_vendas",
    "modulo": "pedidos",
    "caminho": "/situacoes_vendas",
    "acoes": [
      "listar"
    ]
  },
  {
    "recurso": "tipos_contatos",
    "modulo": "core",
    "caminho": "/tipos_contatos",
    "acoes": [
      "listar"
    ]
  },
  {
    "recurso": "tipos_enderecos",
    "modulo": "core",
    "caminho": "/tipos_enderecos",
    "acoes": [
      "listar"
    ]
  },
  {
    "recurso": "tipos_tarefas",
    "modulo": "crm",
    "caminho": "/tipos_tarefas",
    "acoes": [
      "listar",
      "visualizar",
      "cadastrar",
      "editar",
      "deletar"
    ]
  },
  {
    "recurso": "usuarios",
    "modulo": "core",
    "caminho": "/usuarios",
    "acoes": [
      "listar"
    ]
  }
];
