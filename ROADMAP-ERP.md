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
  - Consulta pública automática de CNPJ na Receita Federal / BrasilAPI / CNPJ.ws.
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
  - Modal completo de Produto (`GestaoClickProductEditModal`) com abas de Dados, Valores (Custo, Markup, Venda, Locação Mensal), Estoque (Mínimo, Máximo, Atual, Controle por S/N), Fiscal (NCM, CEST, CFOP padrão `5.908` / `5.102`, Origem ICMS) e Fornecedores vinculados.

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

### Pilar 5 — Contratos e locações (`344 Contratos Ativos` • Reajuste IGP-M/IPCA & Recibo 0% ISS SV 31 STF)
- **Status Geral:** **100% Concluído**
- **Componentes & Arquivos:**
  - `src/app/components/ErpGestaoClickTab.tsx` (Seção `CONTRATOS`: sub-abas `CTR_LOCACOES`, `CTR_SERVICOS`, `CTR_ASSINATURAS`, `CTR_AUXILIARES`)
  - `src/app/components/ErpEditModals.tsx` (`ContractEditModal`)
  - `src/app/components/GestaoClickEnrichedModals.tsx` (`PartialEquipmentReturnProRataModal` e `BatchRentalBillingAndEmailModal`)
- **Rotas de API:**
  - `GET / POST / PATCH / DELETE /api/erp/rental-contracts`
  - `POST /api/erp/rental-contracts/:id/readjust`
  - `POST /api/erp/rental-contracts/:id/renew`
  - `POST /api/erp/rental-contracts/:id/generate-invoice`
  - `POST /api/erp/rental-contracts/:id/generate-remessa`
  - `POST /api/erp/rental-contracts/:id/partial-return`
  - `POST /api/erp/rental-contracts/batch-billing` & `POST /api/erp/rental-contracts/batch-email`
- **Entregas Concluídas:**
  - Gestão completa de Contratos de Locação Pura (`0% ISS — SV 31 STF`), Híbridos, Serviços Técnicos (`LC 116 01.07`) e Assinaturas SCM (`Mod. 62`).
  - Rastreamento individual por `S/N` e Tag, RMA, devolução parcial com cálculo Pro-Rata mantendo o contrato `ATIVO`, reajuste anual IGP-M/IPCA/IST Anatel e faturamento em lote.
  - **Layout GestãoClick Padronizado nos 3 Pontos (`Locações`, `Serviços`, `Assinaturas`):** Barra `+ Adicionar`, `Devoluções`, `Mais ações ▾`, seletor de competência, colunas `Nº`, `Tipo` (`Aluguel`, `Serviço`, `Assinatura`), `Cliente`, `Data`, `Próximo vencimento`, `Periodicidade`, `Situação`, `Valor` e botões `Lupa`, `Lápis` e menu `⋮` com as **12 funcionalidades** (`Link de cobrança`, `Imprimir A4`, `Alterar situação`, `Enviar por e-mail`, `Enviar por WhatsApp`, `Gerar próxima fatura`, `Devolução de produtos`, `Renovar locação/contrato`, `Agendar compromisso`, `Ver no financeiro`, `Solicitar assinatura` e `Excluir`).
  - **Minutas Jurídicas Distintas por Tipo (`Opções auxiliares` e `Imprimir A4`):** Modelos editáveis separados para **Contrato de Locação de Equipamentos** (Arts. 565-578 CC, Súmula Vinculante 31 STF, CFOP 5.908/6.908), **Contrato de Prestação de Serviços Técnicos** (LC 116/2003, NFS-e, SLA NOC) e **Termo de Assinatura Recorrente** (SCM/SVA/Cloud).

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
