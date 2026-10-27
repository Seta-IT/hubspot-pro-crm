# 🏛️ Mapeamento Completo da API & MCP GestãoClick ERP (Loja Matriz `#118887`) ↔ HubSpot CRM v3 ↔ STI-hub

- **Links Ativos da Aplicação (STI-hub — Seta Telecom CRM & ERP):**
  - **Produção (Vercel):** `https://sti-hub.vercel.app` (`HTTP 200 OK`)
  - **Servidor Local / Box:** `http://localhost:3000` (`HTTP 200 OK`)
  - **Endpoint de Catálogo Completo (Schema JSON):** `GET /api/erp/gestaoclick/schema`
  - **Endpoint de Sincronização Ao Vivo:** `POST /api/erp/gestaoclick/sync`
  - **Endpoint de Consulta Unificada CNPJ (GestãoClick + Receita Federal):** `GET /api/erp/cnpj/:cnpj` e `GET /api/cnpj/lookup?cnpj=...`

---

## 1. Resumo Executivo da Conta Seta Telecom (Loja Matriz `#118887`)

Conectado via credencial oficial **`ERP-GROK`** na API REST (`https://api.gestaoclick.com/api`) e no servidor MCP (`https://api.gestaoclick.com/v1/mcp`, protocolo `2024-11-05`):

| Módulo / Menu Principal | Recurso Principal (`caminho`) | Total Real na Loja `#118887` | Qtd. Campos Raiz | Objetos Aninhados | Destino no STI-hub & HubSpot v3 |
| :--- | :--- | :---: | :---: | :--- | :--- |
| **Configurações** | `/lojas` | **1** (`Matriz #118887`) | 2 | — | `gestaoClickConfig.storeId` |
| **Configurações** | `/usuarios` | **6** | 17 | — | `gestaoClickConfig.users` ↔ HubSpot `owners` |
| **Cadastros** | `/clientes` | **1.185** | 27 | `enderecos[]`, `contatos[]`, `atributos[]` | `companies` + `contacts` ↔ HubSpot `companies` & `contacts` |
| **Cadastros** | `/fornecedores` | **101** | 20 | `enderecos[]`, `contatos[]`, `atributos[]` | `erp.suppliers` |
| **Cadastros** | `/funcionarios` | **14** | 19 | `atributos[]` | `erp.employees` ↔ HubSpot `owners` |
| **Cadastros** | `/transportadoras` | **50** | 19 | `enderecos[]`, `contatos[]` | `erp.suppliers` (`TRANSPORTADORA`) |
| **Itens** | `/produtos` | **786** | 25 | `valores[]`, `variacoes[]`, `fiscal{}`, `fotos[]`, `atributos[]` | `erp.catalog` (`EQUIPAMENTO_LOCACAO` / `VENDA_HARDWARE`) ↔ HubSpot `products` |
| **Itens** | `/servicos` | **39** | 5 | — | `erp.catalog` (`SERVICO_TECNICO_LC116`) |
| **Itens** | `/grupos_produtos` | **47** | 6 | — | `erp.catalog.category` |
| **Orçamentos / Propostas** | `/orcamentos` | **2.079** | 50 | `produtos[]`, `servicos[]`, `pagamentos[]`, `equipamentos[]`, `atributos[]`, `anexos[]` | `erp.proposals` + `deals` ↔ HubSpot `deals` & `quotes` |
| **Vendas** | `/vendas` | **296** | 51 | `produtos[]`, `servicos[]`, `pagamentos[]`, `equipamentos[]`, `atributos[]`, `anexos[]` | `erp.salesOrders` ↔ HubSpot `deals (Closed Won)` |
| **Ordens de Serviços** | `/ordens_servicos` | **1.378** | 50 | `produtos[]`, `servicos[]`, `equipamentos[]`, `pagamentos[]`, `atributos[]`, `anexos[]` | `erp.serviceOrders` + `serviceTickets` ↔ HubSpot `tickets` |
| **Contratos & Locações** | `/contratos` | **344** | 64 | `produtos[]`, `servicos[]`, `pagamentos[]`, `historico[]`, `atributos[]`, `anexos[]` | `erp.rentalContracts` (0% ISS — SV 31 STF) ↔ HubSpot `deals (MRR)` |
| **Contratos & Locações** | `/locacoes` | **2** | 60 | `produtos[]`, `pagamentos[]`, `historico[]`, `atributos[]`, `anexos[]` | `erp.rentalContracts` |
| **Estoque & Compras** | `/compras` | **54** | 32 | `Compra.{produtos[], pagamentos[], situacoes[], campos_extras[]}` | `erp.purchaseOrders` (Entrada NF-e Mod. 55) |
| **Financeiro** | `/recebimentos` | **153** | 37 | `atributos[]` | `erp.financialEntries (RECEBER)` + `erp.invoices` |
| **Financeiro** | `/pagamentos` | **41** | 37 | `atributos[]` | `erp.financialEntries (PAGAR)` |
| **Financeiro** | `/contas_bancarias` | **3** | 2 | — | `erp.bankAccounts` (Banco Inter `#237906`, Itaú `#142155`, Conta Integrada `#710407`) |
| **Financeiro** | `/planos_contas` | **100** | 7 | — | `erp.financialEntries.category` / DRE Gerencial |
| **Financeiro** | `/centros_custos` | **13** | 3 | — | `erp.financialEntries.costCenter` (`LOCAÇÃO DE EQUIPAMENTO`, `OPERACIONAL`, etc.) |
| **Financeiro** | `/formas_pagamentos` | **12** | 44 | `FormasPagamento.{...}` | `erp.financialEntries.paymentMethod` (Boleto, PIX, TED, Cartão) |
| **Fiscal (NF-e / NFS-e)** | `/notas_fiscais_produtos` | **1.664** | 97 | `produtos[]`, `pagamento[]` | `erp.invoices` (`NFE_REMESSA_LOCACAO` CFOP 5.908/6.908 & `NFE_VENDA_PRODUTO`) |
| **Fiscal (NF-e / NFS-e)** | `/notas_fiscais_servicos` | **945** | 91 | — | `erp.invoices` (`NFSE_SERVICO` LC 116/03) |
| **Fiscal (NFC-e)** | `/notas_fiscais_consumidores` | **0** | 97 | `produtos[]`, `pagamento[]` | `erp.invoices` (`NFCE_CONSUMIDOR`) |

---

## 2. Árvore Completa de Menus do GestãoClick (`GestaoClickSidebar.tsx` ↔ 76 Recursos da API)

1. **`INICIO` — Início (Visão Geral & Dashboards)**
   - 5 Flashcards Financeiros (Saldo Disponível Hoje, A Receber Hoje, A Pagar Hoje, Recebido no Mês, Pago no Mês)
   - Gráficos de Fluxo de Caixa Semestral (`/relatorios/fluxo_caixa`) e Vendas (`/relatorios/vendas`)
   - Contas Bancárias (`/contas_bancarias`) + Agenda de O.S. (`/ordens_servicos`)
2. **`CADASTROS` — Cadastros (`modulo: core`)**
   - `CAD_CLIENTES` → `/clientes` (`1.185` registros)
   - `CAD_FORNECEDORES` → `/fornecedores` (`101` registros)
   - `CAD_FUNCIONARIOS` → `/funcionarios` (`14` registros)
   - `CAD_TRANSPORTADORAS` → `/transportadoras` (`50` registros)
   - `CAD_AUXILIARES` → `/tipos_contatos` (`3`), `/tipos_enderecos` (`2`), `/atributos_cadastros` (`0`), `/estados` (`27`), `/cidades` (`5.570`)
3. **`ITENS` — Itens (`modulo: core`)**
   - `ITENS_PRODUTOS` → `/produtos` (`786` registros)
   - `ITENS_SERVICOS` → `/servicos` (`39` registros)
   - `ITENS_TODOS` → Catálogo Unificado (`825` itens)
   - `ITENS_AUXILIARES` → `/grupos_produtos` (`47` grupos), `/atributos_produtos` (`7` atributos)
4. **`ORCAMENTOS` — Orçamentos / Propostas (`modulo: pedidos`)**
   - `ORC_TODOS` / `ORC_PRODUTOS` / `ORC_SERVICOS` → `/orcamentos` (`2.079` registros)
   - `ORC_AUXILIARES` → `/situacoes_orcamentos` (`19` situações), `/atributos_orcamentos` (`1` atributo)
5. **`VENDAS` — Vendas (`modulo: pedidos`)**
   - `VENDAS_PRODUTOS` / `VENDAS_SERVICOS` / `VENDAS_BALCAO` / `VENDAS_DEVOLUCOES` → `/vendas` (`296` registros) e `/relatorios/devolucoes`
   - `VENDAS_AUXILIARES` → `/situacoes_vendas` (`19` situações), `/atributos_vendas` (`0`)
6. **`ORDENS_SERVICOS` — Ordens de Serviços (`modulo: pedidos`)**
   - `OS_GERENCIAR` / `OS_PAINEL` → `/ordens_servicos` (`1.378` registros)
   - `OS_AUXILIARES` → `/situacoes_ordens_servicos` (`19` situações), `/atributos_ordens_servicos` (`0`)
7. **`ESTOQUE` — Estoque & Compras (`modulo: estoque`)**
   - `EST_MOVIMENTACOES` / `EST_AJUSTES` / `EST_TRANSFERENCIAS` / `EST_COTACOES` → Controle de Estoque & Números de Série (S/N)
   - `EST_COMPRAS` → `/compras` (`54` pedidos de compra / NF-e de entrada)
   - `EST_AUXILIARES` → `/situacoes_compras` (`4` situações)
8. **`FINANCEIRO` — Financeiro (`modulo: financeiro`)**
   - `FIN_PAGAR` → `/pagamentos` (`41` títulos na listagem atual) + `/relatorios/contas_pagar`
   - `FIN_RECEBER` → `/recebimentos` (`153` títulos na listagem atual) + `/relatorios/contas_receber`
   - `FIN_DRE` → `/relatorios/dre` (DRE Gerencial Vertical e Horizontal)
   - `FIN_FLUXO` → `/relatorios/fluxo_caixa` e `/relatorios/extrato`
   - `FIN_BOLETOS` → `/contas_bancarias` (`3` contas) e `/formas_pagamentos` (`12` carteiras/formas)
   - `FIN_AUXILIARES` → `/planos_contas` (`100` contas), `/centros_custos` (`13` centros), `/atributos_financeiros` (`2` atributos)
9. **`FISCAL` — Fiscal (`modulo: fiscal`)**
   - `FIS_PRODUTOS` → `/notas_fiscais_produtos` (`1.664` NF-e Modelo 55, incluindo Remessa de Locação CFOP `5.908` / `6.908`)
   - `FIS_SERVICOS` → `/notas_fiscais_servicos` (`945` NFS-e Municipais LC 116/03)
   - `FIS_CONSUMIDOR` → `/notas_fiscais_consumidores` (`0` NFC-e)
   - `FIS_COMPRAS` → `/compras` com importação de XML SEFAZ NF-e Mod. 55
10. **`CONTRATOS` — Contratos (`modulo: contratos` + `assinatura_digital`)**
    - `CTR_LOCACOES` → `/contratos` (`344` contratos ativos/encerrados tipo `LO`) e `/locacoes` (`2`)
    - `CTR_SERVICOS` → `/contratos_servicos` (`0`)
    - `CTR_ASSINATURAS` → `/assinaturas` (`0`) + Assinatura Digital (`/documentos`, `/modelos`, `/pastas`, `/contatos`)
    - `CTR_AUXILIARES` → `/situacoes_contratos` (`6`), `/atributos_contratos` (`5`), `/situacoes_locacoes` (`8`), `/situacoes_assinaturas` (`4`)
11. **`ATENDIMENTOS` — Atendimentos, Service Desk & CRM (`modulo: crm`)**
    - `/funis`, `/negocios`, `/prospectos`, `/tarefas`, `/tipos_tarefas` + Fila NOC N1/N2/N3 (JSM)
12. **`RELATORIOS` — Relatórios (`18 endpoints /relatorios/*`)**
    - `/relatorios/dre`, `/relatorios/fluxo_caixa`, `/relatorios/extrato`, `/relatorios/contas_pagar`, `/relatorios/contas_receber`, `/relatorios/vendas`, `/relatorios/orcamentos`, `/relatorios/produtos_vendidos`, `/relatorios/servicos_vendidos`, `/relatorios/clientes_mais_compram`, `/relatorios/centros_custos`, `/relatorios/contas_bancarias`, `/relatorios/comissao_vendedores`, `/relatorios/comissao_vendedores_financeiro`, `/relatorios/comissao_produto`, `/relatorios/comissao_servico`, `/relatorios/devolucoes`, `/relatorios/pesquisa_movimentacoes`
13. **`CONFIGURACOES` — Configurações (`modulo: core`)**
    - `/lojas`, `/usuarios`, `/conta/plano`, `/conta/dados_cobranca`, `/conta/pagamentos`, `/conta/precos_planos`

---

## 3. Dicionário Completo de Tabelas e Campos do GestãoClick

### 3.1. `/clientes` (27 campos raiz + 3 coleções aninhadas)
- **Campos Raiz:** `id`, `tipo_pessoa` (`PJ` | `PF` | `ES`), `nome` (higienizado quando preenchido com CNPJ), `razao_social`, `cnpj`, `inscricao_estadual`, `inscricao_municipal`, `tipo_contribuinte`, `responsavel`, `cpf`, `rg`, `data_nascimento`, `sexo`, `loja_virtual_ativo`, `email_acesso`, `telefone`, `celular`, `fax`, `email`, `ativo` (`"1"` | `"0"`), `vendedor_id`, `nome_vendedor`, `cadastrado_em`, `modificado_em`, `contatos`, `enderecos`, `atributos`.
- **`enderecos[].endereco` (11 campos):** `tipo_id`, `nome_tipo`, `cep`, `logradouro`, `numero`, `complemento`, `bairro`, `pais`, `cidade_id`, `nome_cidade`, `estado`.
- **`contatos[].contato` (6 campos):** `tipo_id`, `nome_tipo`, `nome`, `contato`, `cargo`, `observacao`.
- **`atributos[].atributo` (3 campos):** `atributo_id`, `nome`, `conteudo`.

### 3.2. `/fornecedores` (20 campos raiz) e `/transportadoras` (19 campos raiz)
- **`/fornecedores`:** `id`, `tipo_pessoa`, `nome`, `razao_social`, `cnpj`, `inscricao_estadual`, `inscricao_municipal`, `tipo_contribuinte`, `cpf`, `rg`, `data_nascimento`, `telefone`, `celular`, `email`, `ativo`, `cadastrado_em`, `modificado_em`, `contatos`, `enderecos`, `atributos`.
- **`/transportadoras`:** `id`, `tipo_pessoa`, `nome`, `razao_social`, `cnpj`, `inscricao_estadual`, `inscricao_municipal`, `cpf`, `rg`, `data_nascimento`, `telefone`, `celular`, `email`, `observacoes`, `ativo`, `cadastrado_em`, `modificado_em`, `contatos`, `enderecos`.

### 3.3. `/funcionarios` (19 campos) e `/usuarios` (17 campos)
- **`/funcionarios`:** `id`, `nome`, `email_secundario`, `cpf`, `rg`, `data_nascimento`, `sexo`, `telefone`, `cep`, `logradouro`, `numero`, `complemento`, `bairro`, `cidade_id`, `nome_cidade`, `estado`, `comissao`, `ativo`, `atributos`.
- **`/usuarios`:** `id`, `nome`, `cpf`, `rg`, `data_nascimento`, `sexo`, `grupo_id`, `email`, `observacoes`, `telefone`, `celular1`, `celular2`, `hora_entrada`, `hora_almoco_entrada`, `hora_almoco_saida`, `hora_saida`, `ativo`.

### 3.4. `/produtos` (25 campos raiz + sub-objetos) e `/servicos` (5 campos)
- **`/produtos`:** `id`, `nome`, `codigo_interno`, `codigo_barra`, `possui_variacao`, `possui_composicao`, `movimenta_estoque`, `peso`, `largura`, `altura`, `comprimento`, `ativo`, `grupo_id`, `nome_grupo`, `descricao`, `estoque`, `valor_custo`, `valor_venda`, `cadastrado_em`, `modificado_em`, `valores`, `variacoes`, `fiscal`, `fotos`, `atributos`.
  - **`valores[]`:** `tipo_id`, `nome_tipo`, `lucro_utilizado`, `valor_custo`, `valor_venda`.
  - **`variacoes[].variacao`:** `id`, `variacao_api_id`, `codigo`, `nome`, `estoque`, `valores`.
  - **`fiscal{}`:** `ncm`, `cest`, `peso_liquido`, `peso_bruto`, `valor_aproximado_tributos`.
- **`/servicos`:** `id`, `codigo`, `nome`, `valor_venda`, `observacoes`.

### 3.5. `/orcamentos` (50 campos), `/vendas` (51 campos) e `/ordens_servicos` (50 campos)
- **Campos Comuns:** `id`, `codigo`, `cliente_id`, `nome_cliente`, `vendedor_id`, `nome_vendedor`, `tecnico_id`, `nome_tecnico`, `situacao_id`, `nome_situacao`, `valor_total`, `transportadora_id`, `nome_transportadora`, `centro_custo_id`, `nome_centro_custo`, `aos_cuidados_de`, `validade`, `introducao`, `observacoes`, `observacoes_interna`, `desconto_valor`, `desconto_porcentagem`, `valor_frete`, `nome_canal_venda`, `nome_loja`, `valor_servicos`, `valor_produtos`, `valor_custo`, `condicao_pagamento`, `situacao_financeiro`, `situacao_estoque`, `forma_pagamento_id`, `data_primeira_parcela`, `numero_parcelas`, `intervalo_dias`, `nota_fiscal_id`, `nota_fiscal_servico_id`, `hash`, `cadastrado_em`, `modificado_em`, `exibir_endereco`, `cor_situacao`, `equipamentos`, `pagamentos`, `enderecos`, `atributos`, `produtos`, `anexos`.
- **Específicos:**
  - `/orcamentos`: `data`, `previsao_entrega`.
  - `/vendas`: `data`, `prazo_entrega`, `nome_forma_pagamento`.
  - `/ordens_servicos`: `data_entrada`, `data_saida`.
- **`produtos[].produto` (16 campos):** `produto_id`, `variacao_id`, `nome_produto`, `detalhes`, `movimenta_estoque`, `possui_variacao`, `sigla_unidade`, `quantidade`, `tipo_valor_id`, `nome_tipo_valor`, `valor_custo`, `valor_venda`, `tipo_desconto`, `desconto_valor`, `desconto_porcentagem`, `valor_total`.

### 3.6. `/contratos` (64 campos) e `/locacoes` (60 campos)
- **Campos Raiz:** `id`, `codigo`, `tipo` (`LO` = Locação), `cliente_id`, `nome_cliente`, `vendedor_id`, `nome_vendedor`, `canal_venda_id`, `nome_canal_venda`, `loja_id`, `nome_loja`, `situacao_id`, `nome_situacao`, `centro_custo_id`, `nome_centro_custo`, `plano_contas_id`, `nome_plano_conta`, `condicao_pagamento`, `forma_pagamento_id`, `nome_forma_pagamento`, `valor_produtos`, `acrescimo`, `desconto_valor`, `desconto_porcentagem`, `valor_frete`, `valor_total`, `observacoes`, `observacoes_fatura`, `situacao_financeiro`, `situacao_estoque`, `cadastrado_em`, `modificado_em`, `data_entrega`, `data_retirada`, `nota_fiscal_servico_id`, `data`, `periodicidade`, `dia_vencimento`, `proximo_vencimento`, `gerar_recebimento`, `limite`, `limite_data`, `limite_vezes`, `hora_entrega`, `hora_retirada`, `valor_frete_retirada`, `retirada_cep`, `retirada_logradouro`, `retirada_numero`, `retirada_complemento`, `retirada_bairro`, `retirada_cidade_id`, `retirada_nome_cidade`, `retirada_estado`, `vigencia_locacao`, `tipo_periodo_locacao`, `plano_id`, `nome_plano`, `produtos`, `pagamentos`, `historico`, `atributos`, `anexos`, `servicos`.
- **`atributos[].atributo` da Seta Telecom em `/atributos_contratos`:**
  1. `Prazo de locação` (ex: `24 meses`, `36 meses`)
  2. `Nota Fiscal de Remessa` (ex: `000.419.101` — CFOP `5.908` / `6.908`)
  3. `Proposta nº`
  4. `Contrato nº`
  5. `Índice de Reajuste` (`IPCA` / `IGP-M`)

### 3.7. `/recebimentos` (37 campos) e `/pagamentos` (37 campos)
- **Campos Raiz:** `id`, `codigo`, `descricao`, `valor`, `juros`, `desconto`, `taxa_banco`, `taxa_operadora`, `valor_total`, `plano_contas_id`, `nome_plano_conta`, `centro_custo_id`, `nome_centro_custo`, `conta_bancaria_id`, `nome_conta_bancaria`, `forma_pagamento_id`, `nome_forma_pagamento`, `entidade`, `fornecedor_id`, `nome_fornecedor`, `cliente_id`, `nome_cliente`, `transportadora_id`, `nome_transportadora`, `funcionario_id`, `nome_funcionario`, `liquidado` (`"1"` | `"0"`), `data_vencimento`, `data_liquidacao`, `data_competencia`, `usuario_id`, `nome_usuario`, `loja_id`, `nome_loja`, `cadastrado_em`, `modificado_em`, `atributos`.

### 3.8. `/notas_fiscais_produtos` (97 campos — NF-e Mod. 55) e `/notas_fiscais_servicos` (91 campos — NFS-e)
- **`/notas_fiscais_produtos`:** Inclui `chave` (44 dígitos SEFAZ), `protocolo`, `codigo_cfop`, `descricao_cfop`, `natureza_operacao`, `modelo` (`55`), `serie`, `numero_nf`, dados completos do emitente (`cnpj_emitente`, `ie_emitente`, endereço), dados completos do destinatário (`destinatario_id`, `destinatario_cnpj`, `destinatario_ie`, endereço), totais de impostos (`valor_total_nf`, `base_icms`, `valor_icms`, `valor_ipi`, `valor_pis`, `valor_cofins`), `informacoes_complementares`, `situacao_nf`, `produtos[]` (com `cfop`, `NCM`, `quantidade`, `valor_venda`) e `pagamento[]`.
- **`/notas_fiscais_servicos`:** Inclui `rps`, `numero`, `codigo_verificacao`, `codigo_natureza_operacao`, `codigo_incidencia_issqn`, `emitente_cnpj`, `destinatario_cnpj`, `atividade_cnae`, `valor_servico`, `valor_base_calculo`, `valor_iss`, `iss_retido`, retenções federais (`valor_pis`, `valor_cofins`, `valor_csll`, `valor_ir`, `valor_inss`), `valor_total` e `situacao`.

---

## 4. Matriz de Sincronização Bidirecional: HubSpot CRM v3 ↔ STI-hub ↔ GestãoClick ERP

| Entidade HubSpot CRM v3 | Propriedades HubSpot v3 | Entidade STI-hub (`src/db/types.ts`) | Recurso GestãoClick (`#118887`) | Regra de Negócio / Higienização |
| :--- | :--- | :--- | :--- | :--- |
| **Companies** | `name`, `domain`, `cnpj`, `phone`, `city`, `state`, `industry`, `annualrevenue` | `Company` (`comp-gc-{id}`) | `/clientes` (`PJ`) | Trava fiscal de Matriz/Filial por CNPJ; se `nome` for CNPJ (ex: Digisystem), usa `razao_social`. |
| **Contacts** | `firstname`, `lastname`, `email`, `phone`, `jobtitle`, `lifecyclestage`, `hs_lead_status` | `Contact` (`cont-gc-{id}`) | `/clientes` (`responsavel`, `contatos[]`) + `/prospectos` | Validação E.164 (`+55`), cálculo de `leadScore` (0–100) e enriquecimento por domínio/CNPJ. |
| **Deals** | `dealname`, `amount`, `dealstage`, `pipeline`, `closedate`, `hs_mrr` | `Deal` + `ErpCommercialProposal` + `ErpRentalContract` | `/orcamentos` (`2.079`), `/contratos` (`344`), `/vendas` (`296`) | 3 Funis B2B (Vendas Enterprise, Locação de Equipamentos MRR, Expansão & Renovação). |
| **Tickets** | `subject`, `content`, `hs_ticket_priority`, `hs_pipeline_stage` | `ServiceTicket` + `ErpServiceOrder` | `/ordens_servicos` (`1.378` O.S.) | SLA dinâmico por prioridade (`CRITICAL`, `HIGH`, `MEDIUM`, `LOW`) e conversão 1-clique Ticket → O.S. |
| **Owners** | `id`, `email`, `firstName`, `lastName` | `ownerId` / `ownerName` / `ErpEmployeeRecord` | `/usuarios` (`6`) + `/funcionarios` (`14`) | Reatribuição automática de proprietários inativos para `Marcelo Lopes Mira` / `Evelyn Ternero`. |
