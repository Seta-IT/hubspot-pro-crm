# ROADMAP-ERP — Matriz Oficial de 10 Pilares do SETA ERP (`SETA | IT`)

> **Documento Oficial de Governança, Arquitetura e Status de Implementação do Módulo ERP**
> - **Empresa:** Seta Telecom LTDA (`SETA | IT`) — **CNPJ Matriz:** `14.806.925/0001-32`
> - **Unidade Operacional:** Loja Matriz `#118887` (Conector Ao Vivo `ERP-GROK` • API REST + MCP)
> - **Plataforma Unificada:** `STI-hub | Seta Telecom CRM & ERP` (`/workspace/hubspot-pro-crm`)
> - **Agente Responsável:** `ERP - Supervisor & Roadmap`
> - **Última Atualização:** Segunda-feira, 26 de Outubro de 2026 (America/New_York / UTC-4)

---

## 1. Diretrizes Globais Obrigatórias (Navegação, UX Clean, Segurança de Cadastros & Compliance Fiscal)

### 1.1. Barra Principal Estrita em 3 Itens de Topo e Politica ZERO Emojis nos Menus/Pilares
- **Barra de Navegação Global (`src/app/page.tsx`):** Reorganizada estritamente em **3 itens de topo**:
  1. `CRM`
  2. `ERP`
  3. `Chamados`
- **Política ZERO Emojis nos Menus e nos 10 Pilares do ERP:**
  - Títulos, abas de navegação, itens de menu da barra principal, árvore da Sidebar `SETA | IT` e títulos/subtítulos dos **10 Pilares do ERP** devem utilizar exclusivamente tipografia corporativa limpa e ícones vetoriais (`lucide-react`), **sem emojis** nos rótulos de navegação ou abas.

### 1.2. Sidebar Esquerda Fixa `SETA | IT` (12 Categorias + Início)
- **Status:** Implementado e Operacional (`src/app/components/GestaoClickSidebar.tsx` + `src/app/components/ErpGestaoClickTab.tsx`)
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

### 1.3. Ficha Completa de Cadastro de Clientes GestãoClick, Consulta Pública de CNPJ e Exclusão Segura
- **Ficha Expandida de Cadastro de Clientes (`1. Cadastros` — `GestaoClickCustomerEditModal`):**
  - Contempla todos os campos oficiais do GestãoClick: **CNPJ/CPF**, **Razão Social**, **Nome Fantasia**, **Inscrição Estadual (IE)**, **Indicador de IE** (Contribuinte ICMS, Contribuinte Isento, Não Contribuinte), **Inscrição Municipal (IM)**, **Regime Tributário**, **CNAE Principal**, **Endereço Completo com CEP e Código IBGE do Município**, **Contatos Adicionais** e **Limite de Crédito / Condição de Pagamento**.
- **Consulta Pública Automática de CNPJ nos Órgãos Oficiais (`/api/erp/cnpj/:cnpj`):**
  - Integração direta com bases públicas oficiais (**Receita Federal / BrasilAPI / CNPJ.ws**) preenchendo automaticamente Razão Social, Nome Fantasia, CNAE, Situação Cadastral, Endereço completo, CEP, Município/UF e indicadores de crédito.
- **Proteção contra Exclusão Acidental na Listagem de Clientes:**
  - Na tabela de listagem de Clientes do ERP, **não há botão de deletar direto na linha**.
  - A coluna de ação exibe de forma padronizada e harmoniosa o botão **`Editar / Abrir Cadastro`**. Qualquer exclusão exige abrir a ficha cadastral completa do cliente e confirmar a operação dentro do modal/ficha.

### 1.4. Trava Fiscal Obrigatória de CNPJ (Proibição Estrita de Merge entre CNPJs Distintos)
- **Status:** Implementado e Testado (`src/modules/data-health/deduplication.ts`, `src/api/router.ts`, `src/app/components/DataHealthTab.tsx`, `tests/crm.test.ts`)
- **Regra de Negócio e Compliance Fiscal:**
  - Funções `haveConflictingCnpjs(cnpjA, cnpjB)` e `detectProtectedBranchCompanies(companies)` garantem que empresas com CNPJs preenchidos e distintos (ex.: Matriz `/0001-XX` e Filial `/0002-XX` ou empresas do mesmo grupo econômico que compartilham domínio corporativo) **JAMAIS** sejam listadas como duplicadas.
  - Bloqueio HTTP `400 Bad Request` no endpoint `POST /api/data-health/merge` e exclusão automática no `POST /api/data-health/auto-clean` caso haja tentativa de mesclar CNPJs distintos.
  - Exibição de painel de **Unidades / CNPJs Distintos Protegidos contra Merge (Trava Fiscal Ativa)** na aba de Saúde da Base (`DataHealthTab.tsx`).

---

## 2. Matriz Oficial dos 10 Pilares do SETA ERP — Estado Real do Código

Abaixo está o mapeamento completo de cada um dos **10 Pilares Oficiais** (`SETA_ERP_TEN_PILLARS` em `src/app/components/SetaErpTenPillarsAndPdv.tsx`), mantendo nomenclatura limpa (sem emojis) e detalhando componentes, rotas de API, entregas prontas e próximos passos:

---

### Pilar 1 — Cadastros (`1.184 Clientes • 101 Fornecedores • 14 Funcionários`)
- **Status Geral:** Implementado (Produção)
- **Componentes & Arquivos:**
  - `src/app/components/ErpGestaoClickTab.tsx` (Seção `CADASTROS`: sub-abas `Clientes`, `Fornecedores`, `Funcionários`, `Transportadoras` e `Opções auxiliares`)
  - `src/app/components/GestaoClickEnrichedModals.tsx` (`GestaoClickCustomerEditModal` com todos os campos fiscais e comerciais do GestãoClick)
  - `src/modules/data-health/validators.ts` & `src/modules/data-health/deduplication.ts` (Validação Módulo-11 de CNPJ e Trava Fiscal de Matriz/Filial)
- **Rotas de API:**
  - `GET / POST / PATCH / DELETE /api/companies`
  - `GET / POST / PATCH / DELETE /api/erp/records/suppliers`
  - `GET / POST / PATCH / DELETE /api/erp/records/employees`
  - `GET /api/erp/cnpj/:cnpj` (Consulta pública automática na Receita Federal / BrasilAPI / CNPJ.ws + análise de crédito)
- **O que está pronto:**
  - Ficha de Clientes PJ/PF expandida com todos os campos do GestãoClick: CNPJ/CPF, Razão Social, Nome Fantasia, IE, Indicador de IE, IM, Regime Tributário, CNAE, Endereço completo com CEP e Código IBGE, Contatos Adicionais e Limite de Crédito/Condição de Pagamento.
  - Preenchimento automático via consulta pública de CNPJ nos órgãos oficiais (Receita Federal / BrasilAPI / CNPJ.ws).
  - Listagem de Clientes higienizada sem botão de exclusão direto na tabela, padronizada com o botão harmonioso `Editar / Abrir Cadastro` (exclusão permitida apenas dentro da ficha com confirmação).
  - Trava Fiscal obrigatória impedindo unificação de CNPJs distintos.
- **Pendente / Próximos Passos:**
  - Paginação server-side direta na listagem bruta de todos os 1.184 clientes da API GestãoClick sem filtro.

---

### Pilar 2 — Produtos e serviços (`786 Produtos • 39 Serviços`)
- **Status Geral:** Implementado (Produção)
- **Componentes & Arquivos:**
  - `src/app/components/ErpGestaoClickTab.tsx` (Seção `ITENS`: sub-abas `ITENS_PRODUTOS`, `ITENS_SERVICOS`, `ITENS_TODOS`)
  - `src/app/components/GestaoClickEnrichedModals.tsx` (`GestaoClickProductEditModal`)
  - `src/app/components/ErpEditModals.tsx` (`CATALOG_ITEM_EDITOR_FIELDS`)
- **Rotas de API:**
  - `GET / POST /api/erp/catalog`
  - `PATCH / PUT / DELETE /api/erp/catalog/:id`
- **O que está pronto:**
  - Catálogo técnico completo de equipamentos Telecom/TI (PABX IP, Gateways E1/SIP, Aparelhos IP Yealink/Intelbras, Switches PoE, Firewalls SD-WAN, Licenças Cisco) e Serviços Técnicos NOC/Engenharia (LC 116/03 Item `01.07`).
  - Modal completo de Produto (`GestaoClickProductEditModal`) com abas de Dados, Valores (Custo, Markup, Venda, Locação Mensal), Estoque (Mínimo, Máximo, Atual, Controle por S/N), Fiscal (NCM, CEST, CFOP padrão `5.908` / `5.102`, Origem ICMS, Pesos/Dimensões) e Fornecedores vinculados.
- **Pendente / Próximos Passos:**
  - Importação em lote de planilha XML/CSV de novos SKUs de fornecedores diretamente pela aba de Itens.

---

### Pilar 3 — Propostas e vendas (`2.077 Orçamentos • 295 Vendas` + Orçamento `#4695` + `/proposta/[id]`)
- **Status Geral:** Implementado (Produção)
- **Componentes & Arquivos:**
  - `src/app/components/ErpGestaoClickTab.tsx` (Seções `ORCAMENTOS` e `VENDAS`)
  - `src/app/components/ErpEditModals.tsx` (`ProposalEditModal` — Editor estruturado em 9 blocos fiel ao orçamento `#4695`)
  - `src/app/proposta/[id]/page.tsx` (Página pública A4 timbrada para visualização, edição autorizada, aprovação em 1 clique e impressão PDF `?print=1`)
  - `src/app/lib/proposal-share.ts` (Codificação resiliente de payload no link público + cálculo de MRR/TCV)
- **Rotas de API:**
  - `GET / POST /api/erp/proposals`
  - `GET / PATCH / PUT / DELETE /api/erp/proposals/:id` (Liberada no `middleware.ts` para leitura pública do cliente)
  - `POST /api/erp/proposals/:id/approve` (Converte automaticamente a Proposta em Contrato de Locação `ErpRentalContract` + Fatura Inicial `ErpFiscalInvoice`)
  - `GET / POST / PATCH / DELETE /api/erp/records/salesOrders`
- **O que está pronto:**
  - Editor de 9 blocos fiel ao Orçamento `#4695` do GestãoClick (Cabeçalho/Status, Cliente/CNPJ, Vigência/Índice de Reajuste, Tabela de Equipamentos/Serviços, Resumo Financeiro MRR/Setup/TCV, Parcelas/Condições de Pagamento, Escopo/SLA, Observações Fiscais SV 31 STF e Ações).
  - Rota pública `/proposta/[id]` acessível sem login para o cliente visualizar/imprimir o PDF A4 timbrado da Seta Telecom e aprovar a proposta.
  - Gestão de Pedidos de Venda de Produtos, Serviços e Devoluções/Estornos (`VENDAS_DEVOLUCOES`).
- **Pendente / Próximos Passos:**
  - Assinatura eletrônica com carimbo ICP-Brasil / Gov.br diretamente no rodapé da página `/proposta/[id]`.

---

### Pilar 4 — Estoque e compras (`S/N Ativos • 54 Pedidos de Compra`)
- **Status Geral:** Implementado (Produção)
- **Componentes & Arquivos:**
  - `src/app/components/SetaErpTenPillarsAndPdv.tsx` (`SetaErpStockAndPurchasesSubbar`)
  - `src/app/components/ErpGestaoClickTab.tsx` (Seção `ESTOQUE`: sub-abas `EST_MOVIMENTACOES`, `EST_AJUSTES`, `EST_TRANSFERENCIAS`, `EST_COTACOES`, `EST_COMPRAS`)
- **Rotas de API:**
  - `GET / POST / PATCH / DELETE /api/erp/records/purchaseOrders`
  - `PATCH /api/erp/catalog/:id` (Atualização automática de saldo de estoque ao receber NF-e de compra)
- **O que está pronto:**
  - Controle de Movimentações por Número de Série (`S/N`), Ajustes de Inventário, Transferências entre Almoxarifado Matriz `#118887` e Clientes, Cotações com Fornecedores e Ordens de Compra (`ErpPurchaseOrder`).
  - Escrituração de NF-e de Entrada (CAPEX Ativo Imobilizado para Parque de Locação CFOP `1.551 / 2.551` e Compra para Revenda CFOP `1.102`), cálculo de crédito de ICMS (CIAP) e PIS/COFINS, espelho de impressão da NF-e de entrada e ação `Receber no Estoque` que incrementa o saldo do item no catálogo.
- **Pendente / Próximos Passos:**
  - Importador automático de arquivo `.xml` de NF-e de fornecedor (SEFAZ) para preenchimento automático dos itens da Ordem de Compra.

---

### Pilar 5 — Contratos e locações (`344 Contratos Ativos` • Reajuste IGP-M/IPCA & Recibo 0% ISS SV 31 STF)
- **Status Geral:** Implementado (Produção)
- **Componentes & Arquivos:**
  - `src/app/components/ErpGestaoClickTab.tsx` (Seção `CONTRATOS`: sub-abas `CTR_LOCACOES`, `CTR_SERVICOS`, `CTR_ASSINATURAS`, `CTR_AUXILIARES`)
  - `src/app/components/ErpEditModals.tsx` (`ContractEditModal`)
  - `src/app/components/GestaoClickEnrichedModals.tsx` (`PartialEquipmentReturnProRataModal` e `BatchRentalBillingAndEmailModal`)
- **Rotas de API:**
  - `GET / POST /api/erp/rental-contracts` (e alias `/api/erp/contracts`)
  - `PATCH / PUT / DELETE /api/erp/rental-contracts/:id`
  - `POST /api/erp/rental-contracts/:id/readjust` (Motor de reajuste anual IPCA, IGP-M, IST Anatel ou Fixo com histórico auditado)
  - `POST /api/erp/rental-contracts/:id/renew` (Renovação de vigência contratual `+12m` / `+24m` / `+36m`)
  - `POST /api/erp/rental-contracts/:id/generate-invoice` (Geração de Fatura/Recibo de Locação 0% ISS — SV 31 STF)
  - `POST /api/erp/rental-contracts/:id/generate-remessa` (Geração de NF-e de Remessa em Locação CFOP `5.908`)
  - `POST /api/erp/rental-contracts/:id/partial-return` (Devolução parcial de equipamentos com cálculo automático de Rateio Pro-Rata de dias utilizados, emissão de NF-e de Retorno CFOP `5.909` e manutenção do contrato como `ATIVO` com novo MRR reduzido)
  - `POST /api/erp/rental-contracts/batch-billing` & `POST /api/erp/rental-contracts/batch-email` (Faturamento e envio de boletos/faturas em lote)
- **O que está pronto:**
  - Gestão completa de Contratos de Locação Pura (`0% ISS — SV 31 STF`), Contratos Híbridos, Serviços Técnicos (`LC 116 01.07`) e Assinaturas SCM (`Mod. 62`).
  - Rastreamento individual de patrimônio por `S/N` e Tag (`EM_CLIENTE`, `MANUTENCAO_RMA`, `DEVOLVIDO`), substituição rápida de equipamento (RMA), devolução parcial com cálculo Pro-Rata sem encerrar o contrato, reajuste anual IGP-M/IPCA/IST Anatel e faturamento em lote.
- **Pendente / Próximos Passos:**
  - Régua automatizada via cron job para disparar alerta de reajuste anual 30 dias antes da data de aniversário do contrato.

---

### Pilar 6 — Financeiro (Contas Bancárias Inter/Itaú, Contas a Pagar/Receber, Fluxo de Caixa, DRE e Conciliação OFX)
- **Status Geral:** 90% Implementado (Conciliação de Arquivo OFX Bancário Pendente)
- **Componentes & Arquivos:**
  - `src/app/components/GestaoClickDashboard.tsx` (Painel financeiro executivo com 5 flashcards clicáveis, gráficos SVG de Fluxo de Caixa e Vendas e saldos das contas `Banco Inter`, `Banco Itaú` e `Conta Integrada`)
  - `src/app/components/ErpGestaoClickTab.tsx` (Seção `FINANCEIRO`: sub-abas `FIN_PAGAR`, `FIN_RECEBER`, `FIN_DRE`, `FIN_FLUXO`, `FIN_BOLETOS`)
- **Rotas de API:**
  - `GET / POST /api/erp/financial`
  - `PATCH / PUT / DELETE /api/erp/financial/:id`
  - `POST /api/erp/financial/:id/pay` (Baixa e conciliação unitária de lançamento financeiro)
  - `POST / PATCH / DELETE /api/erp/records/bankAccounts`
- **O que está pronto:**
  - Gestão das 9 contas bancárias da Seta Telecom (`Banco Inter` R$ 4,57M, `Banco Itaú`, `Conta Integrada`, `Caixinha`, `Seta Imp`, `Inter Aplicações`, etc. — Saldo disponível consolidado R$ 2,20M).
  - Contas a Receber e Contas a Pagar com centro de custo, baixa em 1 clique, disparo de Boleto Registrado + QR Code PIX por e-mail (`ClientEmailComposerModal`) e Fluxo de Caixa mensal.
- **Pendente / Próximos Passos:**
  - **Importador e Conciliador Automático de Extrato `.OFX` (Banco Inter / Itaú):** Criar modal/upload de arquivo `.ofx` (`POST /api/erp/financial/reconcile-ofx`) para parear automaticamente linhas do extrato bancário com títulos em aberto (`ErpFinancialEntry` / `ErpFiscalInvoice`).
  - **Visão Dedicada do DRE Gerencial (`FIN_DRE`):** Expandir a sub-aba `FIN_DRE` na seção `FINANCEIRO` com demonstrativo contábil vertical detalhado (Receita Bruta de Locação SV 31 + Serviços LC 116 + Vendas (-) Impostos (-) Custos Operacionais/CAPEX = EBITDA e Lucro Líquido).

---

### Pilar 7 — Fiscal (NF-e, NFS-e, NFCom Mod. 62, CFOP 5.908/6.908 e Recibo 0% ISS SV 31 STF)
- **Status Geral:** Implementado (Produção)
- **Componentes & Arquivos:**
  - `src/modules/erp/erp-tax-engine.ts` (`calculateBrazilianTaxBreakdown` e `buildDefaultFiscalNatureForType`)
  - `src/app/components/ErpGestaoClickTab.tsx` (Seção `FISCAL`: sub-abas `FIS_PRODUTOS`, `FIS_SERVICOS`, `FIS_CONSUMIDOR`, `FIS_COMPRAS`, `FIS_AUXILIARES` e modal de impressão DANFE/Fatura/NFCom)
  - `src/app/components/ErpEditModals.tsx` (`InvoiceEditModal`)
- **Rotas de API:**
  - `GET / POST /api/erp/invoices` (e alias `/api/erp/fiscal-documents`)
  - `PATCH / PUT / DELETE /api/erp/invoices/:id`
  - `POST /api/erp/invoices/:id/pay`
- **O que está pronto:**
  - Motor Fiscal Brasileiro completo suportando os 3 regimes (`LUCRO_PRESUMIDO`, `LUCRO_REAL`, `SIMPLES_NACIONAL`) e 6 espécies de documentos fiscais:
    1. `FATURA_LOCACAO`: **0% de ISSQN** (Veto Presidencial ao item 3.01 da LC 116/2003 + **Súmula Vinculante nº 31 do STF**), sem retenção de IRRF/CSRF (IN RFB 1.234/12), contabilizando economia fiscal em tempo real (`kpis.issSavedBySv31Stf`).
    2. `NFSE_SERVICO`: Item `01.07` LC 116/2003 com cálculo automático de ISS (2,90%) e retenções federais na fonte (**IRRF 1,5%** + **CSRF 4,65%** = PIS 0,65% + COFINS 3,0% + CSLL 1,0%).
    3. `NFE_REMESSA_LOCACAO` (Modelo 55): **CFOP `5.908` (Estadual) / `6.908` (Interestadual)** (e retorno CFOP `5.909`), CST ICMS `041` não tributado e CST PIS/COFINS `08` sem incidência.
    4. `NFE_VENDA_PRODUTO` (Modelo 55): CFOP `5.102 / 6.102` com destaque de ICMS, PIS, COFINS, IRPJ e CSLL.
    5. `NFCE_CONSUMIDOR` (Modelo 65): Cupom fiscal de venda presencial/balcão (CFOP `5.102`).
    6. `NFCOM_TELECOM` (Modelo 62): Nota Fiscal Fatura de Serviços de Comunicação Multimídia (SCM Anatel — CFOP `5.303`).
  - Espelho impresso A4 para DANFE NF-e, Fatura de Locação SV 31 STF, NFS-e e NFCom Mod. 62.
- **Pendente / Próximos Passos:**
  - Transmissão direta de lote XML assinado com Certificado Digital A1 (`.pfx`) para webservices SEFAZ Estadual / Prefeitura (atualmente gera os documentos validados e espelhos prontos no ERP).

---

### Pilar 8 — OS e suporte (`1.378 O.S. • SLA 94%`)
- **Status Geral:** Implementado (Produção)
- **Componentes & Arquivos:**
  - `src/app/components/ErpGestaoClickTab.tsx` (Seções `ORDENS_SERVICOS` e `ATENDIMENTOS`: alternância entre Lista `OS_GERENCIAR` e Painel Kanban Técnico `OS_PAINEL`)
  - `src/app/components/ServiceDeskTab.tsx` (Service Desk JSM N1/N2/N3 integrado às O.S. do ERP)
  - `src/app/portal/page.tsx` (Portal Externo do Cliente `/portal` para abertura e acompanhamento de chamados/O.S.)
- **Rotas de API:**
  - `GET / POST / PATCH / DELETE /api/erp/records/serviceOrders`
  - `GET / POST / PATCH /api/tickets` & `POST /api/tickets/:id/convert-os`
  - `GET / POST /api/portal/tickets`
- **O que está pronto:**
  - Gestão de Ordens de Serviço em Lista e **Painel Kanban Técnico** (`Em andamento`, `Aguardando peça`, `Concluída`, `Cancelada`).
  - Filtro de carga de trabalho por especialista técnico (`Michelle da Rocha`, `Evelyn Ternero`, `Wesley Brito`), vinculação de equipamento e Número de Série (`S/N`), prioridade SLA, relato de defeito e Laudo Técnico.
  - Conversão em 1 clique de Ticket do Service Desk (NOC) em O.S. no GestãoClick.
- **Pendente / Próximos Passos:**
  - Assinatura digital coletada em tela touch pelo técnico de campo (Field Service) no encerramento presencial da O.S.

---

### Pilar 9 — PDV (Frente de Caixa) (`VENDAS_BALCAO` • Pix/Cartão/Dinheiro/Troco e NFC-e Mod. 65)
- **Status Geral:** Implementado (Produção)
- **Componentes & Arquivos:**
  - `src/app/components/SetaErpTenPillarsAndPdv.tsx` (`SetaErpPdvPosView`)
  - `src/app/components/ErpGestaoClickTab.tsx` (Integrado em `VENDAS > VENDAS_BALCAO` e no card nº 9 da Matriz de 10 Pilares)
- **Rotas de API:**
  - `POST /api/erp/records/salesOrders` (Registra o pedido de venda balcão)
  - `POST /api/erp/financial` (Lança automaticamente a entrada quitada no Caixa / Centro de Custo `CC-PDV • Vendas Balcão Matriz #118887`)
- **O que está pronto:**
  - Frente de Caixa Rápida (PDV) para Loja Matriz `#118887` com busca por código de barras/SKU, chips rápidos de produtos, ajuste de quantidades e descontos por item ou global.
  - Cinco meios de pagamento: **Pix Instantâneo (QR Code)**, **Cartão Crédito/Débito**, **Dinheiro (com cálculo automático de Troco a devolver)**, **Boleto Banco Inter** e **Crédito/Vale-Compras**.
  - Emissão instantânea de **Cupom Fiscal NFC-e (Modelo 65)** imprimível e enviável por e-mail, mais **Conferência e Fechamento de Turno de Caixa** consolidado por forma de pagamento.
- **Pendente / Próximos Passos:**
  - Atalhos de teclado dedicados de operador de caixa (`F2` Buscar SKU, `F4` Quantidade, `F9` Finalizar Pix, `F10` Emitir NFC-e).

---

### Pilar 10 — Integrações e IA (`ERP-GROK #118887` • GestãoClick API / MCP)
- **Status Geral:** Implementado (Produção)
- **Componentes & Arquivos:**
  - `src/modules/erp/gestaoclick-client.ts` (Conector REST OpenAPI 3.1.0 `https://api.gestaoclick.com/api` + Probe JSON-RPC 2.0 MCP `https://api.gestaoclick.com/v1/mcp` com controle de rate-limit de 3 req/s)
  - `src/app/components/ErpGestaoClickTab.tsx` (Seção `CONFIGURACOES` / `RELATORIOS` + Barra de status ao vivo no topo)
  - `src/app/components/OverviewAiCopilotTab.tsx` (Copiloto IA Executivo & Supervisor Multi-Agente)
- **Rotas de API:**
  - `GET /api/erp/gestaoclick/status`
  - `POST /api/erp/gestaoclick/sync`
  - `PATCH /api/erp/gestaoclick/config`
  - `POST /api/ai/copilot`
- **O que está pronto:**
  - Conector bidirecional ao vivo com a Loja Matriz `#118887` da Seta Telecom (`ERP-GROK`), sincronizando clientes, catálogo, orçamentos, vendas, O.S., estoque, compras, contas bancárias e lançamentos financeiros.
  - Verificação de status do servidor MCP (`ONLINE` / `OFFLINE`) e fallback resiliente com baseline real da Seta Telecom quando em modo offline/contingência.
  - RBAC unificado com os 22 usuários reais da Seta Telecom e proteção de rotas com Login + MFA (`src/middleware.ts`).

---

## 3. Resumo Executivo de Status (10 Pilares — Sem Emojis nos Títulos)

| # | Pilar Oficial SETA ERP | Seção / Rota Principal | Status Atual |
|---|---|---|---|
| **1** | **Cadastros** (Ficha completa GestãoClick, RFB/BrasilAPI/CNPJ.ws, botão Editar/Abrir Cadastro sem delete na linha e Trava CNPJ) | `CADASTROS` (`CAD_CLIENTES`) + `/api/erp/cnpj/:cnpj` | **100% Pronto** |
| **2** | **Produtos e serviços** (786 Produtos, 39 Serviços, NCM, S/N, LC 116) | `ITENS` (`ITENS_PRODUTOS` / `ITENS_SERVICOS`) | **100% Pronto** |
| **3** | **Propostas e vendas** (Editor 9 blocos `#4695` + Link Público `/proposta/[id]`) | `ORCAMENTOS` / `VENDAS` + `/proposta/[id]` | **100% Pronto** |
| **4** | **Estoque e compras** (S/N, Ajustes, Transferências, Cotações e OCs CFOP 1.551) | `ESTOQUE` (`EST_MOVIMENTACOES` / `EST_COMPRAS`) | **100% Pronto** |
| **5** | **Contratos e locações** (S/N, Devolução Parcial Pro-Rata, IGP-M/IPCA e SV 31 STF) | `CONTRATOS` (`CTR_LOCACOES`) | **100% Pronto** |
| **6** | **Financeiro** (9 Contas Inter/Itaú, Pagar/Receber, Fluxo de Caixa, DRE e OFX) | `FINANCEIRO` (`FIN_FLUXO` / `FIN_DRE`) | **90% Pronto** *(Pendente upload `.OFX` e tela DRE expandida)* |
| **7** | **Fiscal** (Recibo 0% ISS SV 31 STF, NFS-e LC 116, NF-e 5.908/6.908, NFC-e, NFCom 62) | `FISCAL` (`FIS_SERVICOS` / `FIS_PRODUTOS`) | **100% Pronto** |
| **8** | **OS e suporte** (Lista, Kanban Técnico, S/N, Laudo e JSM) | `ORDENS_SERVICOS` (`OS_GERENCIAR` / `OS_PAINEL`) | **100% Pronto** |
| **9** | **PDV (Frente de Caixa)** (Carrinho SKU, Pix/Cartão/Dinheiro/Troco, NFC-e e Turno) | `VENDAS` (`VENDAS_BALCAO`) | **100% Pronto** |
| **10** | **Integrações e IA** (`ERP-GROK #118887` API/MCP + HubSpot `4369067`) | `CONFIGURACOES` (`CFG_GERAIS`) + `/api/erp/gestaoclick/*` | **100% Pronto** |
