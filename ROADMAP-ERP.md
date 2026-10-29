# ROADMAP-ERP — Matriz Oficial de 10 Pilares do SETA ERP (`SETA | IT`)

> **Documento Oficial de Governança, Arquitetura e Status de Implementação do Módulo ERP**
> - **Empresa:** Seta Telecom LTDA (`SETA | IT`) — **CNPJ Matriz:** `14.806.925/0001-32`
> - **Unidade Operacional:** Loja Matriz `#118887` (Conector Ao Vivo `ERP-GROK` • API REST + MCP)
> - **Plataforma Unificada:** `STI-hub | Seta Telecom CRM & ERP` (`/workspace/hubspot-pro-crm`)
> - **Agente Responsável:** `ERP - Supervisor & Roadmap`
> - **Última Atualização:** Quarta-feira, 28 de Outubro de 2026 (America/New_York / UTC-4)

---

## 1. Diretrizes Globais Obrigatórias (Navegação, UX Clean, Base 100% Real & Compliance Fiscal)

### 1.1. Barra Principal Estrita em 3 Itens de Topo e Política ZERO Emojis nos Menus/Pilares
- **Barra de Navegação Global (`src/app/page.tsx`):** Reorganizada estritamente em **3 itens de topo**:
  1. `CRM`
  2. `ERP`
  3. `Chamados`
- **Política ZERO Emojis nos Menus e nos 10 Pilares do ERP:**
  - Títulos, abas de navegação, itens de menu da barra principal, árvore da Sidebar `SETA | IT` e títulos/subtítulos dos **10 Pilares do ERP** utilizam exclusivamente tipografia corporativa limpa e ícones vetoriais (`lucide-react`), **sem emojis** nos rótulos de navegação ou abas.

### 1.2. Sidebar Esquerda Fixa `SETA | IT` (12 Categorias + Início)
- **Status:** 100% Concluído (`src/app/components/GestaoClickSidebar.tsx` + `src/app/components/ErpGestaoClickTab.tsx`)
- **Estrutura Exata (Sem Emojis):**
  1. **Início (Visão Geral)** (`INICIO`)
  2. **Cadastros** (`CAD_CLIENTES`, `CAD_FORNECEDORES`, `CAD_FUNCIONARIOS`, `CAD_TRANSPORTADORAS`, `CAD_AUXILIARES`)
  3. **Itens** (`ITENS_PRODUTOS`, `ITENS_SERVICOS`, `ITENS_AUXILIARES`)
  4. **Orçamentos** (`ORC_PRODUTOS`, `ORC_SERVICOS`, `ORC_AUXILIARES`)
  5. **Vendas** (`VENDAS_PRODUTOS`, `VENDAS_SERVICOS`, `VENDAS_BALCAO`, `VENDAS_DEVOLUCOES`, `VENDAS_AUXILIARES`)
  6. **Ordens de serviços** (`OS_GERENCIAR`, `OS_PAINEL`, `OS_AUXILIARES`)
  7. **Estoque** (`EST_MOVIMENTACOES`, `EST_AJUSTES`, `EST_TRANSFERENCIAS`, `EST_COTACOES`, `EST_COMPRAS`, `EST_AUXILIARES`)
  8. **Financeiro** (`FIN_PAGAR`, `FIN_RECEBER`, `FIN_DRE`, `FIN_FLUXO`, `FIN_BOLETOS`, `FIN_AUXILIARES`)
  9. **Fiscal** (`FIS_PRODUTOS`, `FIS_SERVICOS`, `FIS_CONSUMIDOR`, `FIS_COMPRAS`, `FIS_AUXILIARES`)
  10. **Contratos** (`CTR_SERVICOS`, `CTR_LOCACOES`, `CTR_ASSINATURAS`, `CTR_AUXILIARES`)
  11. **Atendimentos** (`ATENDIMENTOS`)
  12. **Relatórios** (`REL_CADASTROS`, `REL_VENDAS`, `REL_OS`, `REL_ESTOQUE`, `REL_FINANCEIRO`, `REL_CONTRATOS`, `REL_FISCAL`, `REL_PERSONALIZADOS`, `REL_LOGS`)
  13. **Configurações** (`CFG_GERAIS`, `CFG_PLANO`, `CFG_USUARIOS`, `CFG_EMPRESA`, `CFG_MARCA`, `CFG_LOJAS`, `CFG_CERTIFICADO`, `CFG_EMAILS`, `CFG_AVISOS`)

### 1.3. Ficha Completa de Cadastro de Clientes GestãoClick, Validação Matemática Módulo 11 de CNPJ/CPF, Autoformatação PJ/PF, Novo Cadastro 100% em Branco e Exclusão Segura
- **Status:** 100% Concluído (`src/app/components/GestaoClickEnrichedModals.tsx` + `src/modules/erp/cnpj-lookup-service.ts`)
- **Ficha Expandida de Cadastro de Clientes (`1. Cadastros` — `GestaoClickCustomerEditModal`):**
  - Contempla todos os campos oficiais do GestãoClick: **CNPJ/CPF**, **Razão Social**, **Nome Fantasia**, **Inscrição Estadual (IE)**, **Indicador de IE** (Contribuinte ICMS, Contribuinte Isento, Não Contribuinte), **Inscrição Municipal (IM)**, **Regime Tributário**, **CNAE Principal**, **Endereço Completo com CEP e Código IBGE do Município**, **Contatos Adicionais** e **Limite de Crédito / Condição de Pagamento**.
- **Consulta Pública Automática de CNPJ nos Órgãos Oficiais (`/api/erp/cnpj/:cnpj`):**
  - Integração direta com bases públicas oficiais (**Receita Federal / BrasilAPI / CNPJ.ws**) preenchendo automaticamente Razão Social, Nome Fantasia, CNAE, Situação Cadastral, Endereço completo, CEP, Código IBGE, Município/UF e indicadores de crédito.
- **Validação Matemática Módulo 11 de CNPJ (14 dígitos) e CPF (11 dígitos) em Tempo Real e na API (`src/modules/data-health/validators.ts` + `src/api/router.ts`):**
  - Rejeita CNPJs/CPFs com todos os dígitos repetidos (ex.: `00.000.000/0000-00`, `111.111.111-11`) e valida matematicamente os 2 dígitos verificadores oficiais (Módulo 11).
  - Feedback visual imediato (borda vermelha + mensagem `"CNPJ inválido (dígitos verificadores incorretos)"` ou `"CPF inválido (dígitos verificadores incorretos)"`; e selo verde `"CNPJ válido"` / `"CPF válido"`), bloqueando o botão de Salvar e de Consultar Receita Federal enquanto inválido, além de retornar `400 Bad Request` no backend.
- **Autoformatação Dinâmica (Máscara em Tempo Real) conforme Pessoa Jurídica (`PJ`) ou Pessoa Física (`PF`):**
  - Quando selecionado **Pessoa Jurídica (`PJ`)**: aplica máscara automática `00.000.000/0000-00` (14 dígitos).
  - Quando selecionado **Pessoa Física (`PF`)**: aplica máscara automática `000.000.000-00` (11 dígitos), reformatando imediatamente ao alternar entre PJ e PF, além de máscaras para CEP (`00000-000`) e Telefone/Celular.
- **Abertura 100% em Branco ao Clicar em "Novo Cadastro" (`+ Novo Cadastro` / `+ Adicionar Cliente`):**
  - Ao abrir o modal em modo de criação (`isNew: true` / `company: null`), um `useEffect` reseta todos os estados para strings vazias (`""`), sem preencher dados de demonstração.
- **Proteção contra Exclusão Acidental na Listagem de Clientes:**
  - Na tabela de listagem de Clientes do ERP, foi removido o botão de deletar direto da linha e padronizado o botão harmonioso **`Editar / Abrir Cadastro`**. A exclusão exige abrir o cadastro do cliente e confirmar dentro da ficha.

### 1.4. Trava Fiscal Obrigatória de CNPJ (Proibição Estrita de Merge entre CNPJs Distintos)
- **Status:** 100% Concluído (`src/modules/data-health/deduplication.ts`, `src/api/router.ts`, `src/app/components/DataHealthTab.tsx`, `tests/crm.test.ts`)
- **Regra de Negócio e Compliance Fiscal:**
  - Funções `haveConflictingCnpjs(cnpjA, cnpjB)` e `detectProtectedBranchCompanies(companies)` garantem que empresas com CNPJs preenchidos e distintos (ex.: Matriz `/0001-XX` e Filial `/0002-XX` ou empresas do mesmo grupo econômico que compartilham domínio corporativo) **JAMAIS** sejam listadas como duplicadas.
  - Bloqueio HTTP `400 Bad Request` no endpoint `POST /api/data-health/merge` e exclusão automática no `POST /api/data-health/auto-clean` caso haja tentativa de mesclar CNPJs distintos.

### 1.5. Limpeza de Dados Fictícios, Base 100% Real da Loja Matriz `#118887` e Sincronização Diária Incremental (`/api/erp/daily-sync`)
- **Status:** 100% Concluído (`src/modules/erp/daily-sync-service.ts`, `src/db/repository.ts`, `src/api/router.ts`)
- **Governança de Dados:**
  - Expurgo integral de mocks fictícios legados (`fictitiousDataPurged: true`) mantendo exclusivamente a base 100% real sincronizada da **Loja Matriz `#118887` (`SETA TELECOM LTDA` — CNPJ `14.806.925/0001-32`)**.
  - Rotas `GET /api/erp/daily-sync` e `POST /api/erp/daily-sync` habilitadas para sincronização diária incremental automatizada (`modificado_em > cursorTimestamp`) com checklist de homologação dos 11 módulos operacionais.

---

## 2. Matriz Oficial dos 10 Pilares do SETA ERP — Estado Real do Código (100% Concluído)

---

### Pilar 1 — Cadastros (`1.184 Clientes • 101 Fornecedores • 14 Funcionários`)
- **Status Geral:** **100% Concluído**
- **Componentes & Arquivos:**
  - `src/app/components/ErpGestaoClickTab.tsx` (Seção `CADASTROS`: sub-abas `Clientes`, `Fornecedores`, `Funcionários`, `Transportadoras` e `Opções auxiliares`)
  - `src/app/components/GestaoClickEnrichedModals.tsx` (`GestaoClickCustomerEditModal`)
  - `src/modules/erp/cnpj-lookup-service.ts` & `src/modules/data-health/deduplication.ts`
- **Rotas de API:**
  - `GET / POST / PATCH / DELETE /api/companies`
  - `GET / POST / PATCH / DELETE /api/erp/records/suppliers`
  - `GET / POST / PATCH / DELETE /api/erp/records/employees`
  - `GET /api/erp/cnpj/:cnpj`
- **Entregas Concluídas:**
  - Ficha de Clientes PJ/PF expandida com todos os campos do GestãoClick (CNPJ/CPF, Razão Social, Nome Fantasia, IE, Indicador de IE, IM, Regime Tributário, CNAE, Endereço completo com CEP e Código IBGE, Contatos Adicionais e Limite de Crédito/Condição de Pagamento).
  - Consulta pública automática de CNPJ na Receita Federal / BrasilAPI / CNPJ.ws + Painel **Consulta SERASA** (Score PJ 0–1000, risco, protestos/PEFIN e limite de crédito com trava "Permitir exceder o limite"), incluindo cliente **Digisystem Servicos Especializados LTDA** (`01.936.069/0001-94`, CEP `01311-926`).
  - Botão padronizado `Editar / Abrir Cadastro` na tabela (sem botão de exclusão direto na linha; exclusão protegida dentro da ficha).
  - Trava Fiscal obrigatória impedindo unificação de CNPJs distintos.

---

### Pilar 2 — Produtos e serviços (`786 Produtos • 39 Serviços`)
- **Status Geral:** **100% Concluído**
- **Componentes & Arquivos:**
  - `src/app/components/ErpGestaoClickTab.tsx` (Seção `ITENS`: sub-abas `ITENS_PRODUTOS`, `ITENS_SERVICOS`, `ITENS_TODOS`)
  - `src/app/components/GestaoClickEnrichedModals.tsx` (`GestaoClickProductEditModal`)
- **Rotas de API:**
  - `GET / POST /api/erp/catalog`
  - `PATCH / PUT / DELETE /api/erp/catalog/:id`
- **Entregas Concluídas:**
  - Catálogo técnico completo de equipamentos Telecom/TI (PABX IP, Gateways E1/SIP, Aparelhos IP Yealink/Intelbras, Switches PoE, Firewalls SD-WAN, Licenças Cisco) e Serviços Técnicos NOC/Engenharia (LC 116/03 Item `01.07`).
  - Modal completo de Produto (`GestaoClickProductEditModal`) com as **7 abas laterais verticais** (`Dados`, `Detalhes`, `Valores`, `Estoque`, `Fotos`, `Fiscal` e `Fornecedores`), tabela **Confira as referências de NF-e deste produto** (`KIT1000-ETQTERM-TMT - 1000 Etiquetas Termicas 10x15 / 100x150 Em Resma Serrilhada`), Kardex de entradas/saídas/remessas e item de locação **`WS-C3850-48F-S - Stackable 48 10/100/1000 Ethernet PoE+ port`** (`Estoque: 4,00`, `Vr. unitário: R$ 375,00`).

---

### Pilar 3 — Propostas e vendas (`2.077 Orçamentos • 295 Vendas` + Orçamento `#4695` + Versionamento Automático `v1.0, v2.0...` + `/proposta/[id]` com Assinatura ICP-Brasil / Gov.br)
- **Status Geral:** **100% Concluído**
- **Componentes & Arquivos:**
  - `src/app/components/ErpGestaoClickTab.tsx` (Seções `ORCAMENTOS` e `VENDAS`)
  - `src/app/components/ErpEditModals.tsx` (`ProposalEditModal` — Editor estruturado em 9 blocos fiel ao orçamento `#4695`)
  - `src/app/proposta/[id]/page.tsx` (Página pública A4 timbrada com modal e selo de **Assinatura Eletrônica ICP-Brasil / Gov.br**)
  - `src/app/lib/proposal-share.ts`
- **Rotas de API:**
  - `GET / POST /api/erp/proposals`
  - `GET / PATCH / PUT / DELETE /api/erp/proposals/:id` (Incrementa automaticamente `version` e grava `ErpProposalVersionEntry` com `changedFields` e `snapshot` completo a cada alteração de SLA, Tempo de Contrato, Forma de Pagamento, Valores ou Produtos/Serviços)
  - `GET /api/erp/proposals/:id/versions` & `POST /api/erp/proposals/:id/restore-version` (Consulta e restauração de qualquer versão anterior)
  - `POST /api/erp/proposals/:id/approve` (Registra **Assinatura Eletrônica ICP-Brasil A1/A3 ou Gov.br** com Nome do Signatário, CPF, Cargo, Hash SHA-256 e Carimbo de Tempo ACT/ITI, convertendo em Contrato de Locação + Fatura)
  - `GET / POST / PATCH / DELETE /api/erp/records/salesOrders`
- **Entregas Concluídas:**
  - Editor de 9 blocos fiel ao Orçamento `#4695` do GestãoClick (Mundivox `SL-44-SEC-K9`), com busca autocomplete de clientes (`+ Adicionar novo` inline com consulta Receita Federal) e **Versionamento Automático Completo (`version` + `versionHistory`)** auditando toda alteração de SLA, Tempo de Contrato, Forma de Pagamento, Valores e Produtos/Serviços, com inspeção e restauração em 1 clique.
  - Rota pública `/proposta/[id]` acessível sem login para visualização/impressão A4 (`?print=1`) e **Assinatura Eletrônica Qualificada ICP-Brasil / Gov.br** com selo de autenticidade SHA-256 no rodapé A4.
  - Gestão de Pedidos de Venda de Produtos, Serviços e Devoluções/Estornos (`VENDAS_DEVOLUCOES`).

---

### Pilar 4 — Estoque e compras (`S/N Ativos • 54 Pedidos de Compra` + Importação XML SEFAZ NF-e Mod. 55)
- **Status Geral:** **100% Concluído**
- **Componentes & Arquivos:**
  - `src/app/components/SetaErpTenPillarsAndPdv.tsx` (`SetaErpStockAndPurchasesSubbar` sem emojis nas abas + Modal de Importação de XML SEFAZ NF-e Mod. 55)
  - `src/app/components/ErpGestaoClickTab.tsx` (Seção `ESTOQUE`: sub-abas `EST_MOVIMENTACOES`, `EST_AJUSTES`, `EST_TRANSFERENCIAS`, `EST_COTACOES`, `EST_COMPRAS`)
- **Rotas de API:**
  - `POST /api/erp/purchases/import-xml` (Parser completo de XML SEFAZ NF-e Mod. 55 extraindo emitente, CNPJ, chave de 44 dígitos, itens `<det>`, CFOP `1.551` Ativo Imobilizado / `1.102` Revenda, créditos ICMS/PIS/COFINS e Números de Série `S/N`)
  - `GET / POST / PATCH / DELETE /api/erp/records/purchaseOrders`
  - `PATCH /api/erp/catalog/:id`
- **Entregas Concluídas:**
  - Controle de Movimentações por Número de Série (`S/N`), Ajustes de Inventário, Transferências Matriz `#118887` / Clientes, Cotações com Fornecedores e Ordens de Compra (`ErpPurchaseOrder`).
  - **Importador Automático de XML NF-e (SEFAZ Mod. 55)** com entrada física imediata no estoque, gravação de Números de Série (`S/N`) e geração automática do título em Contas a Pagar.

---

### Pilar 5 — Contratos e locações (`344 Contratos Ativos` • Ficha Completa GestãoClick, Histórico de Faturamentos no Contrato, Recorrência, Regras Customizadas `45 dias + próxima quarta-feira` / `30 dias + próxima quinta-feira`, Versionamento `v1.0/v2.0`, PDFs Sob Demanda 0 MB e Recibo em 1 Página A4)
- **Status Geral:** **100% Concluído**
- **Componentes & Arquivos:**
  - `src/app/components/ErpGestaoClickTab.tsx` (Seção `CONTRATOS`: sub-abas `CTR_LOCACOES`, `CTR_SERVICOS`, `CTR_ASSINATURAS`, `CTR_AUXILIARES`)
  - `src/app/components/ErpEditModals.tsx` (`ContractEditModal` e `InvoiceEditModal`)
  - `src/app/components/ContractBillingPanels.tsx` (`ContractGestaoClickDataPanel`, `ContractBillingHistoryPanel`, `ContractVersionHistoryPanel`, `ContractAuxOptionsManager`, `InvoiceExtraFieldsPanel`)
  - `src/app/lib/contract-billing-utils.ts` (`computeCustomDueDateClient`, `buildStandaloneInvoiceHtml`, `buildPrintableRentalInvoiceHtml`, `downloadInvoicePdfOnDemand`, `downloadContractInvoicesCsvOnDemand`, `downloadContractBillingHistoryReportOnDemand`, `downloadContractVersionPdfOnDemand`)
  - `src/app/components/GestaoClickEnrichedModals.tsx` (`PartialEquipmentReturnProRataModal` e `BatchRentalBillingAndEmailModal`)
- **Rotas de API:**
  - `GET / POST / PATCH / DELETE /api/erp/rental-contracts`
  - `GET /api/erp/rental-contracts/:id/versions` & `POST /api/erp/rental-contracts/:id/restore-version` (Versionamento automático de contratos `v1.0, v2.0...` sem salvar PDFs em disco)
  - `POST /api/erp/rental-contracts/:id/readjust`
  - `POST /api/erp/rental-contracts/:id/renew`
  - `POST /api/erp/rental-contracts/:id/generate-invoice`
  - `POST /api/erp/rental-contracts/:id/generate-remessa`
  - `POST /api/erp/rental-contracts/:id/partial-return`
  - `POST /api/erp/rental-contracts/batch-billing` & `POST /api/erp/rental-contracts/batch-email`
- **Entregas Concluídas (incluindo todas as evoluções de 28/10/2026):**
  1. **Histórico de Faturamentos Dentro do Contrato (`[t2u]`)**:
     - Exibição direta dentro de cada linha/card de contrato e dentro do `ContractEditModal` (abas `3. Faturamento & Recibos` e `6. Documento PDF & Histórico`) de todas as Faturas de Locação (`FATURA_LOCACAO`), NF-e de Remessa (`CFOP 5.908/6.908`), NF-e de Retorno Parcial (`CFOP 5.909/6.909`) e títulos em Contas a Receber vinculados ao contrato, com botão **`+ Gerar Novo Faturamento`** sem sair do contrato.
  2. **Dados Completos do Contrato GestãoClick Replicados no Contrato e na Fatura (`[t3u]` e `[t4u]`)**:
     - **Bloco `Dados do contrato`**: `Vendedor` (`Marcelo Mira`), `Centro de custo` (`LOCAÇÃO DE EQUIPAMENTO`), `Plano de contas *` (`Locação de equipamento`), `Proposta` (`4654`), `Frete` (`400` / `R$ 400,00`), `Contrato n.` (`LOC-2026-101` / `453`), `Nota Fiscal de Remessa` (`2164`), `Prazo do Contrato` (`2 meses`, `12 meses`, `24 meses`).
     - **Informações Extras na Fatura e no Contrato (`[t4u]`)**: **Número do Pedido do Cliente (PO / Ordem de Compra)** (`customerPurchaseOrderNumber`, ex.: `PO-NUBANK-2026-9910` / `PED-CLI-2026-4654`) e **Medição / Boletim de Medição (BM)** (`measurementNumber`, ex.: `BM-10/2026-101` / `BM-11/2026-453`, e `measurementPeriod`, ex.: `01/10/2026 a 31/10/2026`).
     - **Bloco `Adicione os produtos locados`**: Produto (`WS-C3850-48F-S - Stackable 48 10/100/1000 Ethernet PoE+ port`), Variação / detalhes (S/N, Tag de Patrimônio, NCM, CFOP), Quantidade (`2,00`) com saldo abaixo (`Estoque: 4,00`), Vr. unitário (`R$ 375,00`), Subtotal (`R$ 750,00`), botão excluir e `+ Adicionar outro produto`.
     - **Bloco `Confira o total da locação` (`[t3u]` e `[t6u]`)**: 5 campos lado a lado — `Produtos (R$)` (Soma dos produtos: `R$ 750,00`), `Acréscimo (R$)` (Somado à locação: `R$ 0,00`), `Desconto (R$)` (Em reais: `R$ 0,00`), `Desconto (%)` (Preencha um dos dois, sincronizado bidirecionalmente: `0,00%`) e `Valor total * (R$)` (Valor de cada fatura do aluguel: `R$ 750,00`).
     - **Bloco `Combine a entrega e a retirada` + Controle de Fretes (`[t3u]`, `[t6u]`, `[t10u]`)**: `Cidade` (`São Paulo`), Endereço de Entrega/Retirada, Data de Entrega, Data Prevista de Retirada, Valor do Frete (`R$ 400,00`), Frete de Retirada (`returnFreightValueBrl`), Modalidade de Frete (`CIF_EMITENTE`, `FOB_DESTINATARIO`, `TERCEIROS`, `PROPRIO_SETA`, `SEM_FRETE`), Transportadora, Código de Rastreio/CT-e e opção `Incluir frete na fatura`.
  3. **Download do Histórico de Faturas e Geração de PDFs 100% Sob Demanda (0 MB em Disco) (`[t4u]` e `[t5u]`)**:
     - Botão **`Baixar Fatura (PDF / A4)`** em cada fatura individual e botões **`Baixar Histórico Completo (CSV / Excel)`** (UTF-8 BOM) e **`Baixar / Imprimir Relatório de Faturas (PDF / A4)`**.
     - **Regra de Armazenamento Zero-PDF (`[t5u]`)**: nenhum arquivo PDF ou blob binário é salvo em disco ou banco; apenas metadados JSON leves são persistidos e os PDFs são gerados sob demanda (*on-the-fly*) no momento do download com liberação imediata de memória (`URL.revokeObjectURL`).
  4. **Recorrência da Cobrança, Forma de Pagamento, Múltiplos E-mails e Automações (`[t7u]`, `[t9u]`, `[t10u]`, `[t11u]`)**:
     - **Bloco `Defina a recorrência da cobrança`**: seletor `Sem término` (`SEM_TERMINO`), `Até uma data` (`ATE_UMA_DATA`), `Por vezes` (`POR_VEZES`); `Próximo vencimento *` (`09/12/2026`); `Repetir a cobrança *` (`A cada 1 mês`, `A cada 2 meses`, `A cada 3 meses`, `A cada 6 meses`, `A cada 1 ano`); `Gerar a fatura *` (`21 dias antes do vencimento`, `15`, `10`, `7`, `5`, `No dia do vencimento`).
     - **Bloco `Escolha a cobrança e as automações`**: `Forma de pagamento *` (`Boleto Inter`, `Boleto Itaú Seta`, `Boleto + PIX QR Code`, `PIX Automático Inter`, `Transferência / TED Bancária`, `Cartão de Crédito Recorrente`); `Enviar a fatura por e-mail *` (`Selecione`, `Não enviar e-mail`, `Enviar lembrete de pagamento e boleto`, `Enviar somente o lembrete de pagamento`, `Enviar fatura, boleto, PIX e demonstrativo S/N`); **Múltiplos E-mails Destinatários (`billingRecipientEmails`)** com chips/tags; e switch **`Gerar a próxima fatura agora`**.
     - **Bloco `Insira as informações de observação e anexos`**: observações impressas no contrato/fatura, observações internas e metadados de anexos.
  5. **Gerenciador Dinâmico em `Contratos -> Opções auxiliares` (`[t10u]` e `[t11u]`)**:
     - Cadastro, edição e exclusão de Formas de Pagamento, Centros de Custo, Planos de Contas, Regras de Envio de E-mail, Antecedência de Geração da Fatura e Regras Customizadas de Vencimento, além de atalho `+ Cadastrar em Opções Auxiliares` direto no formulário do contrato.
  6. **Regra Customizável de Vencimento e Geração de Fatura (`X dias + próximo dia da semana`) (`[t12u]` e `[t13u]`)**:
     - Função `computeCustomDueDateFromRule` / `computeCustomDueDateClient` com regras pré-cadastradas **`45 dias + próxima quarta-feira`**, **`30 dias + próxima quinta-feira`**, **`30 dias + próxima quarta-feira`**, **`30 dias + próxima sexta-feira`**, **`60 dias + próxima quarta-feira`** e **`15 dias corridos`**, além de construtor livre para qualquer número de dias `X` + qualquer dia da semana.
  7. **Versionamento Automático de Contratos (`v1.0, v2.0...`) e Impressão do Recibo de Locação em 1 Página A4 Única (`[t14u]`)**:
     - Versionamento automático em JSON leve (`version`, `versionLabel`, `versionHistory` com `changedFields`, restauração em 1 clique e download de PDF da versão sob demanda).
     - Recibo / Fatura de Locação (`FATURA_LOCACAO`) formatado com `@page { size: A4 portrait; margin: 7mm }` e `.page { width: 196mm; max-height: 282mm; overflow: hidden; page-break-after: avoid; page-break-inside: avoid }` para caber **estritamente em 1 única página A4**.
  8. **Botão `Visualizar recibo (rascunho)` antes de finalizar o faturamento (`[t19u]`)**:
     - Botão com ícone de olho na aba `3. Faturamento & Recibos` do `ContractEditModal`, no painel `ContractBillingHistoryPanel` (cabeçalho e formulário `Personalizar competência / valor`, antes de `Emitir Fatura`) e no `+ Faturar` da listagem (que agora abre o rascunho antes de emitir). Gera on-the-fly, no navegador, o mesmo recibo A4 do fluxo final (`buildDraftReceiptHtml` → `buildStandaloneInvoiceHtml`) com os dados atuais do formulário (mesmo não salvos), marca d'água/faixa **`RASCUNHO — NÃO É DOCUMENTO FISCAL / pré-visualização`** e Nº provisório `RASCUNHO-FAT-LOC-AAAA-NNNN`; não cria fatura, título, NF, não envia e-mail e não persiste nada. Ações: `Imprimir / Baixar PDF`, `Voltar e editar` e `Finalizar faturamento` (mesmo fluxo de emissão existente).

---

### Pilar 6 — Financeiro (Conciliação Bancária OFX Banco Inter `077` / Itaú `341`, Fluxo de Caixa e DRE Gerencial Vertical `FIN_DRE`)
- **Status Geral:** **100% Concluído**
- **Componentes & Arquivos:**
  - `src/app/components/ErpFinanceiroAndBanksView.tsx` (Visão dedicada de Contas a Pagar, Contas a Receber, Fluxo de Caixa, **DRE Gerencial Vertical `FIN_DRE`**, Boletos/PIX e **Importador/Conciliador de Extrato `.OFX` Banco Inter `077` / Banco Itaú `341`**)
  - `src/app/components/GestaoClickDashboard.tsx`
  - `src/app/components/ErpGestaoClickTab.tsx`
- **Rotas de API:**
  - `POST /api/erp/financial/reconcile-ofx` (Parseia blocos `<STMTTRN>` de arquivos `.OFX` do Banco Inter `077` e Banco Itaú `341`, concilia e baixa títulos em aberto da Seta Telecom LTDA CNPJ `14.806.925/0001-32` e atualiza o saldo bancário)
  - `GET /api/erp/financial/dre` (Demonstrativo de Resultado do Exercício vertical completo com Receita Bruta separada em Locação Pura SV 31 STF 0% ISS, Serviços LC 116 01.07 e Vendas Hardware, Deduções, Economia Tributária SV 31 STF, Custos, Margem Bruta, Despesas, EBITDA e Lucro Líquido — Mensal e Acumulado)
  - `GET / POST / PATCH / DELETE /api/erp/financial` & `POST /api/erp/financial/:id/pay`
- **Entregas Concluídas:**
  - Gestão das 9 contas bancárias da Seta Telecom (`Banco Inter` #237906, `Banco Itaú` #142155, `Conta Integrada` #710407, etc. — Saldo disponível R$ 2,20M).
  - **Conciliação Bancária `.OFX` (Banco Inter `077` e Itaú `341`)** com upload de arquivo `.ofx`, pareamento automático e baixa em 1 clique.
  - **DRE Gerencial Vertical (`FIN_DRE`)** completo com análise vertical (`AV %`), breakdown por centro de custo e destaque da economia fiscal de ISS pela Súmula Vinculante 31 do STF.

---

### Pilar 7 — Fiscal (NF-e, NFS-e, NFCom Mod. 62, CFOP 5.908/6.908 e Recibo 0% ISS SV 31 STF)
- **Status Geral:** **100% Concluído**
- **Componentes & Arquivos:**
  - `src/modules/erp/erp-tax-engine.ts` (`calculateBrazilianTaxBreakdown`)
  - `src/app/components/ErpGestaoClickTab.tsx` (Seção `FISCAL`)
  - `src/app/components/ErpEditModals.tsx` (`InvoiceEditModal`)
- **Rotas de API:**
  - `GET / POST / PATCH / DELETE /api/erp/invoices`
  - `POST /api/erp/invoices/:id/pay`
- **Entregas Concluídas:**
  - Motor Fiscal Brasileiro completo para `FATURA_LOCACAO` (**0% ISS — LC 116/03 + Súmula Vinculante 31 STF**), `NFSE_SERVICO` (Item `01.07` LC 116 com ISS + IRRF 1,5% + CSRF 4,65%), `NFE_REMESSA_LOCACAO` (**CFOP `5.908 / 6.908`** e retorno `5.909`), `NFE_VENDA_PRODUTO` (`5.102`), `NFCE_CONSUMIDOR` (`Mod. 65`) e `NFCOM_TELECOM` (`Mod. 62` — SCM Anatel CFOP `5.303`), com espelho A4 imprimível.

---

### Pilar 8 — OS e suporte (`1.378 O.S. • SLA 94%`)
- **Status Geral:** **100% Concluído**
- **Componentes & Arquivos:**
  - `src/app/components/ErpGestaoClickTab.tsx` (Seções `ORDENS_SERVICOS` e `ATENDIMENTOS`: Lista `OS_GERENCIAR` e Painel Kanban Técnico `OS_PAINEL`)
  - `src/app/components/ServiceDeskTab.tsx` & `src/app/portal/page.tsx`
- **Rotas de API:**
  - `GET / POST / PATCH / DELETE /api/erp/records/serviceOrders`
  - `GET / POST / PATCH /api/tickets` & `POST /api/tickets/:id/convert-os`
- **Entregas Concluídas:**
  - Gestão de Ordens de Serviço em Lista e Painel Kanban Técnico (`Em andamento`, `Aguardando peça`, `Concluída`, `Cancelada`), carga por técnico (`Michelle da Rocha`, `Evelyn Ternero`, `Wesley Brito`), rastreio por `S/N`, Laudo Técnico e integração bidirecional com o módulo de Chamados (NOC Service Desk).

---

### Pilar 9 — PDV (Frente de Caixa) (`VENDAS_BALCAO` • Pix/Cartão/Dinheiro/Troco e NFC-e Mod. 65)
- **Status Geral:** **100% Concluído**
- **Componentes & Arquivos:**
  - `src/app/components/SetaErpTenPillarsAndPdv.tsx` (`SetaErpPdvPosView`)
- **Rotas de API:**
  - `POST /api/erp/records/salesOrders`
  - `POST /api/erp/financial`
- **Entregas Concluídas:**
  - Frente de Caixa Rápida (PDV) para Loja Matriz `#118887` com busca por SKU/código de barras, 5 formas de pagamento (Pix QR Code, Cartão, Dinheiro com cálculo automático de Troco, Boleto Inter e Crédito Cliente), emissão de Cupom NFC-e (Mod. 65) e Conferência de Turno de Caixa.

---

### Pilar 10 — Integrações e IA (`ERP-GROK #118887` • GestãoClick API / MCP + `/api/erp/daily-sync`)
- **Status Geral:** **100% Concluído**
- **Componentes & Arquivos:**
  - `src/modules/erp/gestaoclick-client.ts` & `src/modules/erp/daily-sync-service.ts`
  - `src/app/components/ErpGestaoClickTab.tsx` (Seção `CONFIGURACOES` / `RELATORIOS`)
- **Rotas de API:**
  - `GET /api/erp/gestaoclick/status`
  - `POST /api/erp/gestaoclick/sync`
  - `PATCH /api/erp/gestaoclick/config`
  - `GET / POST /api/erp/daily-sync` (Sincronização diária incremental automatizada com a Loja Matriz `#118887`)
- **Entregas Concluídas:**
  - Conector bidirecional REST OpenAPI 3.1.0 + JSON-RPC 2.0 MCP (`ERP-GROK #118887`) com rate-limit de 3 req/s, base 100% real sem mocks fictícios, sincronização diária incremental (`/api/erp/daily-sync`), RBAC com 22 colaboradores e proteção MFA 2FA.

---

## 3. Resumo Executivo de Status (10 Pilares — 100% Concluído)

| # | Pilar Oficial SETA ERP | Seção / Rota Principal | Status Atual |
|---|---|---|---|
| **1** | **Cadastros** (Ficha completa GestãoClick, RFB/BrasilAPI/CNPJ.ws, botão Editar/Abrir Cadastro e Trava CNPJ) | `CADASTROS` (`CAD_CLIENTES`) + `/api/erp/cnpj/:cnpj` | **100% Concluído** |
| **2** | **Produtos e serviços** (786 Produtos, 39 Serviços, NCM, S/N, LC 116) | `ITENS` (`ITENS_PRODUTOS` / `ITENS_SERVICOS`) | **100% Concluído** |
| **3** | **Propostas e vendas** (Editor 9 blocos `#4695` + `/proposta/[id]` + Assinatura ICP-Brasil / Gov.br) | `ORCAMENTOS` / `VENDAS` + `/proposta/[id]` + `/api/erp/proposals/:id/approve` | **100% Concluído** |
| **4** | **Estoque e compras** (S/N, Transferências, Cotações, OCs CFOP 1.551 + Importação XML NF-e SEFAZ) | `ESTOQUE` (`EST_COMPRAS`) + `POST /api/erp/purchases/import-xml` | **100% Concluído** |
| **5** | **Contratos e locações** (S/N, Devolução Parcial Pro-Rata, IGP-M/IPCA e SV 31 STF) | `CONTRATOS` (`CTR_LOCACOES`) | **100% Concluído** |
| **6** | **Financeiro** (9 Contas Inter/Itaú, Pagar/Receber, Fluxo, Conciliação OFX `077`/`341` e DRE Vertical `FIN_DRE`) | `FINANCEIRO` (`FIN_DRE` / `FIN_AUXILIARES`) + `/api/erp/financial/reconcile-ofx` + `/api/erp/financial/dre` | **100% Concluído** |
| **7** | **Fiscal** (Recibo 0% ISS SV 31 STF, NFS-e LC 116, NF-e 5.908/6.908, NFC-e, NFCom 62) | `FISCAL` (`FIS_SERVICOS` / `FIS_PRODUTOS`) | **100% Concluído** |
| **8** | **OS e suporte** (Lista, Kanban Técnico, S/N, Laudo e JSM) | `ORDENS_SERVICOS` (`OS_GERENCIAR` / `OS_PAINEL`) | **100% Concluído** |
| **9** | **PDV (Frente de Caixa)** (Carrinho SKU, Pix/Cartão/Dinheiro/Troco, NFC-e e Turno) | `VENDAS` (`VENDAS_BALCAO`) | **100% Concluído** |
| **10** | **Integrações e IA** (`ERP-GROK #118887` API/MCP + Base 100% Real + `/api/erp/daily-sync`) | `CONFIGURACOES` (`CFG_GERAIS`) + `/api/erp/daily-sync` | **100% Concluído** |

---

## 4. Próxima Etapa Planejada (Backlog de Integração ERP -> CRM — `[AGUARDANDO REGRAS DO USUÁRIO ANTES DE IMPLEMENTAR]`)

- [ ] **[AGUARDANDO DEFINIÇÃO DE REGRAS COM O MARCÉLLO ANTES DE IMPLEMENTAR] — Opção de criar/espelhar Negócio (Deal) no CRM ao criar uma Proposta Comercial no ERP:**
  - **Diretriz do Marcéllo (`[t58u]`):** *"Ao criar uma proposta no ERP, ter a opção de criar no CRM, deixe isso no roadmap e me pergunte antes de criar para mais regras."*
  - **Status:** Registrado no Roadmap e **bloqueado para implementação até alinhamento prévio das regras de negócio com o Marcéllo** (ex.: em qual pipeline e etapa o Deal deve nascer, quando criar ou vincular a um Deal já existente, mapeamento de valores/MRR e gatilhos de atualização).


---

## 5. Registro Detalhado das Entregas de 28/10/2026 (Contratos, Faturamento, Recorrência, Regras Customizadas, Versionamento e PDF 1 Página A4)

- **`[t1u]` — Devolução Parcial com Rateio Pro-Rata sem pausar contrato, Faturamento/E-mails em Massa e Cadastros GestãoClick + RFB/Serasa:**
  - Endpoint `POST /api/erp/rental-contracts/:id/partial-return`: devolução parcial de equipamentos (ex.: 2 de 10 unidades) calculando pro-rata dos dias utilizados, emitindo NF-e de Retorno Parcial (`CFOP 5.909/6.909`) e Fatura Pro-Rata, mantendo o contrato `ATIVO`.
  - Endpoints `POST /api/erp/rental-contracts/batch-billing` e `POST /api/erp/rental-contracts/batch-email`.
  - Consulta CNPJ na Receita Federal + Serasa (`GET /api/erp/cnpj/:cnpj`, cliente `Digisystem Servicos Especializados LTDA` — `01.936.069/0001-94`) e Produto com 7 abas laterais + referências NF-e (`KIT1000-ETQTERM-TMT`).
- **`[t2u]` — Histórico de Faturamentos Dentro do Contrato:**
  - Painel `ContractBillingHistoryPanel` exibido diretamente dentro do Contrato (na listagem e no `ContractEditModal`) com acesso imediato à visualização, edição, envio por e-mail e geração de nova fatura sem sair do contrato.
- **`[t3u]` e `[t4u]` — Todos os Blocos de Dados do Contrato GestãoClick + Propagação para a Fatura + PO / Medição + Download do Histórico:**
  - Campos `Vendedor` (`Marcelo Mira`), `Centro de custo` (`LOCAÇÃO DE EQUIPAMENTO`), `Plano de contas *` (`Locação de equipamento`), `Proposta` (`4654`), `Frete` (`R$ 400,00`), `Contrato n.` (`453` / `LOC-2026-101`), `Nota Fiscal de Remessa` (`2164`), `Prazo do Contrato` (`2 meses`), `Número do Pedido do Cliente (PO)` (`PED-CLI-2026-4654`), `Boletim de Medição (BM)` (`BM-11/2026-453`) e produto `WS-C3850-48F-S - Stackable 48 10/100/1000 Ethernet PoE+ port` (`Qtd: 2,00`, `Estoque: 4,00`, `Vr. unitário: R$ 375,00`, `Subtotal: R$ 750,00`).
- **`[t5u]` — Geração de PDFs 100% Sob Demanda (0 MB em Disco):**
  - Nenhum PDF é armazenado em disco/banco para histórico de faturas ou versões de propostas/contratos; todos os PDFs e CSVs são gerados em memória no ato do clique.
- **`[t6u]` — Controle Completo de Fretes e Campos de Acréscimo (R$) / Desconto (R$ e %):**
  - Seção `Confira o total da locação` com `Produtos (R$)`, `Acréscimo (R$)`, `Desconto (R$)`, `Desconto (%)` e `Valor total (R$)`, mais modalidade de frete CIF/FOB/Terceiros/Próprio, transportadora, rastreio CT-e e cidade de entrega (`São Paulo`).
- **`[t7u]`, `[t9u]`, `[t10u]`, `[t11u]` — Recorrência da Cobrança, Forma de Pagamento, Múltiplos E-mails e Opções Auxiliares:**
  - Seções `Defina a recorrência da cobrança` (`Sem término`, `Até uma data`, `Por vezes`, `Próximo vencimento 09/12/2026`, `A cada 1 mês`, `21 dias antes do vencimento`) e `Escolha a cobrança e as automações` (`Forma de pagamento: Boleto Inter`, opções exatas de envio de e-mail, múltiplos e-mails destinatários e switch `Gerar a próxima fatura agora`), além do gerenciador `ContractAuxOptionsManager` em `Contratos -> Opções auxiliares`.
- **`[t12u]` e `[t13u]` — Regra Customizável de Vencimento (`45 dias + próxima quarta-feira` e `30 dias + próxima quinta-feira`):**
  - Calculadora `computeCustomDueDateFromRule` / `computeCustomDueDateClient` com presets e construtor customizável para qualquer quantidade de dias + dia da semana alvo.
- **`[t14u]` — Versionamento Automático de Contratos (`v1.0, v2.0...`) e Impressão do Recibo de Locação em 1 Página A4 Única:**
  - Rotas `GET /api/erp/rental-contracts/:id/versions` e `POST /api/erp/rental-contracts/:id/restore-version` + painel `ContractVersionHistoryPanel` e formatação compacta A4 de página única (`@page { size: A4 portrait; margin: 7mm }`, `max-height: 282mm`).
- **`[t19u]` — Botão `Visualizar recibo (rascunho)` na aba de faturamento:**
  - Pré-visualização client-side do recibo A4 (mesmo template do recibo final) com marca d'água `RASCUNHO — NÃO É DOCUMENTO FISCAL`, Nº provisório e botões `Imprimir / Baixar PDF`, `Voltar e editar` e `Finalizar faturamento`; zero efeitos colaterais (sem fatura, título, NF, e-mail ou arquivo salvo). Teste automatizado garante que vencimento e valores do rascunho batem com a fatura final.
