# AGENTS.md — STI-hub | Seta Telecom CRM & ERP (`/workspace/hubspot-pro-crm`)

> Documento oficial de arquitetura, governança multi-agente e contrato de APIs da plataforma **STI-hub (Seta Telecom CRM & ERP — SETA | IT)**, integrando **CRM Enterprise (estilo HubSpot Pro)** e **ERP GestãoClick ao vivo (Locação de Equipamentos Telecom, Propostas PDF, Contratos, Financeiro e Fiscal LC 116/03 + SV 31 STF)**.

---

## 1. Diretório Oficial, Stack & Arquitetura Multi-Camada
- **Caminho Principal**: `/workspace/hubspot-pro-crm` (com symlink compatível em `/workspace/crm-hubspot-pro`).
- **Stack Full-Stack**: TypeScript + Next.js 14 App Router (`src/app/...`) + Tailwind CSS + Lucide Icons + Persistência Híbrida em 3 Camadas:
  1. **Local / Serverless JSON (`src/db/repository.ts`)**: `.data/crm-store.json` (com fallback automático para `/tmp/crm-store.json` em ambientes serverless read-only).
  2. **Reconciliação Durável Cliente-Servidor (`src/app/lib/durable-storage.ts` + `POST /api/bootstrap`)**: Journal local no navegador sincronizado atomicamente com o backend em cada requisição.
  3. **PostgreSQL + Prisma (`src/db/postgres.ts` + `prisma/schema.prisma`)**: Snapshot transacional JSONB (`crm_kv_store`) + sincronização relacional para BI quando `DATABASE_URL` está configurada.

---

## 2. Equipe de Agentes & Matriz de Responsabilidades (Sem Conflito de Arquivos)

A operação do **STI-hub** é coordenada pelo **Supervisor** junto aos líderes de arquitetura e **9 especialistas dedicados** (4 de CRM + 5 de ERP):

### Coordenação & Arquitetura Transversal
- **Supervisor (Coordenador Geral STI-hub)**: Orquestração das frentes, revisão de qualidade, governança de branches/commits e alinhamento executivo com Marcéllo Mira.
- **Nova (Líder Frontend, UX/UI & Shell Global)**:
  - Escopo: Navegação global STI-hub, layout raiz, design system e integração visual entre abas.
  - Arquivos principais: `src/app/layout.tsx`, `src/app/page.tsx`, `src/app/globals.css`, `src/app/components/ui-helpers.tsx`.
- **Atlas (Líder Backend, Persistência, Roteador Unificado & Testes)**:
  - Escopo: Roteador REST central, persistência multi-camada, migrações PostgreSQL e suíte de testes automatizados.
  - Arquivos principais: `src/api/router.ts`, `src/api/server.ts`, `src/app/api/[[...slug]]/route.ts`, `src/app/api/_bridge.ts`, `src/db/repository.ts`, `src/db/types.ts`, `src/db/seed.ts`, `src/db/postgres.ts`, `src/app/lib/durable-storage.ts`, `tests/crm.test.ts`.

### Especialistas CRM (4 Agentes)
1. **Agente CRM 1 — Funil Comercial, Deals & Pipelines**:
   - Escopo: Kanban B2B multi-pipeline, métricas de MRR/TCV no card, *Deal Rotting*, forecast ponderado e conversão rápida de negócio em Proposta Comercial ERP.
   - Arquivos: `src/app/components/DealsKanbanTab.tsx`.
2. **Agente CRM 2 — Contatos, Empresas, Enriquecimento & Data Health**:
   - Escopo: Gestão de Contatos e Empresas, drawers de edição desktop/mobile, enriquecimento por domínio corporativo, score de completude, deduplicação exata/fuzzy (Levenshtein + Jaro-Winkler) e merge inteligente.
   - Arquivos: `src/app/components/ContactsCompaniesTab.tsx`, `src/app/components/ContactDetailDrawer.tsx`, `src/app/components/DataHealthTab.tsx`, `src/modules/data-health/validators.ts`, `src/modules/data-health/completeness.ts`, `src/modules/data-health/deduplication.ts`, `src/modules/data-health/health-service.ts`, `src/modules/enrichment/enrichment-service.ts`.
3. **Agente CRM 3 — Atendimento, Service Desk (JSM), SLA & Web Forms / Migração HubSpot**:
   - Escopo: Fila de tickets estilo Jira Service Management, controle de SLA (`ON_TRACK`, `AT_RISK`, `BREACHED`), notas internas vs. respostas públicas, construtor de formulários web e importador nativo HubSpot CRM v3.
   - Arquivos: `src/app/components/ServiceDeskTab.tsx`, `src/app/components/FormsBuilderTab.tsx`.
4. **Agente CRM 4 — Automações, Workflows, Cadências & Copiloto IA / BI**:
   - Escopo: Motor de workflows por gatilho, cadências de e-mail multi-etapas com pausa automática ao responder (`PAUSED_ON_REPLY`) e IA Analista de Funil/Base.
   - Arquivos: `src/app/components/OverviewAiCopilotTab.tsx`, `src/app/components/AutomationsSequencesTab.tsx`, `src/app/components/SequencesSection.tsx`, `src/modules/workflows/workflow-engine.ts`, `src/modules/sequences/sequence-service.ts`, `src/modules/ai-insights/ai-insights-service.ts`.

### Especialistas ERP Seta Telecom / GestãoClick (5 Agentes)
1. **Agente ERP 1 — Orçamentos, Propostas Comerciais & Link Público PDF A4**:
   - Escopo: Criação e edição completa de propostas comerciais, cálculo de MRR/TCV, link público permanente e página de impressão timbrada A4 para o cliente.
   - Arquivos: `src/app/proposta/[id]/page.tsx`, `src/app/lib/proposal-share.ts`, seção `ORCAMENTOS` em `src/app/components/ErpGestaoClickTab.tsx` e `ProposalEditModal` em `src/app/components/ErpEditModals.tsx`.
2. **Agente ERP 2 — Contratos de Locação, Serviços & Assinaturas**:
   - Escopo: Conversão automática de proposta aprovada em contrato de locação (`ErpRentalContract`), gestão de vigência, reajuste IGP-M/IPCA, equipamentos alocados por S/N e faturamento recorrente mensal.
   - Arquivos: seção `CONTRATOS` em `src/app/components/ErpGestaoClickTab.tsx` e `ContractEditModal` em `src/app/components/ErpEditModals.tsx`.
3. **Agente ERP 3 — Financeiro, Contas Bancárias, DRE & Fluxo de Caixa**:
   - Escopo: Dashboard financeiro GestãoClick, 9 contas bancárias da Seta Telecom (`SETA_BANK_BASELINE`), Contas a Pagar/Receber (`ErpFinancialEntry`), baixa de títulos, conciliação PIX/Boleto, Fluxo de Caixa e DRE Gerencial.
   - Arquivos: `src/app/components/GestaoClickDashboard.tsx`, seção `FINANCEIRO` em `src/app/components/ErpGestaoClickTab.tsx`.
4. **Agente ERP 4 — Fiscal & Tributário Brasileiro (LC 116/03 + Súmula Vinculante 31 STF)**:
   - Escopo: Motor fiscal para Locação Pura de Bens Móveis (0% ISS por dispensa constitucional — SV 31 STF + Item 3.01 vetado da LC 116/03), NFS-e de Serviços Técnicos TI/Telecom, NF-e de Remessa em Locação (CFOP 5.908/6.908 e 5.949/6.949), NFCom Modelo 62 e espelho DANFE/Fatura para impressão.
   - Arquivos: `src/modules/erp/erp-tax-engine.ts`, seção `FISCAL` em `src/app/components/ErpGestaoClickTab.tsx` e `InvoiceEditModal` em `src/app/components/ErpEditModals.tsx`.
5. **Agente ERP 5 — Vendas, Ordens de Serviço (O.S.), Estoque, Cadastros & Conector GestãoClick**:
   - Escopo: Árvore de navegação lateral SETA | IT, Catálogo de Produtos/Equipamentos e Serviços, Pedidos de Venda, Ordens de Serviço (O.S.), Movimentações/Compras de Estoque, Cadastros (Clientes, Fornecedores, Funcionários) e sincronização ao vivo com a API GestãoClick (`ERP-GROK`).
   - Arquivos: `src/app/components/GestaoClickSidebar.tsx`, `src/modules/erp/gestaoclick-client.ts`, `src/modules/erp/erp-seed.ts`, `GenericRecordEditModal` em `src/app/components/ErpEditModals.tsx` e seções `CADASTROS`, `ITENS`, `VENDAS`, `ORDENS_SERVICOS`, `ESTOQUE`, `RELATORIOS`, `CONFIGURACOES` em `src/app/components/ErpGestaoClickTab.tsx`.

---

## 3. Estrutura Completa de Diretórios
```text
/workspace/hubspot-pro-crm/
├── AGENTS.md                                     # Arquitetura STI-hub, equipe de agentes e contratos
├── OPENAPI_CONTRACT.md                           # Especificação OpenAPI/REST completa (Fases 1 a 4)
├── DEPLOY.md                                     # Guia de deploy (Vercel, Railway, Docker + Postgres)
├── prisma/
│   └── schema.prisma                             # Modelagem relacional PostgreSQL/Prisma
├── src/
│   ├── db/
│   │   ├── types.ts                              # Contratos TypeScript (CRM + Service Desk + ERP Brasil)
│   │   ├── seed.ts                               # Seed B2B realista + Seta Telecom
│   │   ├── repository.ts                         # Repositório transacional (JSON local / /tmp + ERP CRUD)
│   │   ├── postgres.ts                           # Camada PostgreSQL (crm_kv_store + tabelas BI)
│   │   └── cli-migrate.ts                        # CLI de migração e seed para produção
│   ├── modules/
│   │   ├── data-health/                          # Validadores (E.164, CNPJ, Email), Completude, Deduplicação e Merge
│   │   ├── enrichment/                           # Enriquecimento por domínio corporativo e Lead Scoring
│   │   ├── workflows/                            # Motor de Workflows e auditoria de execuções
│   │   ├── sequences/                            # Cadências de e-mail com pausa automática (PAUSED_ON_REPLY)
│   │   ├── ai-insights/                          # Copiloto IA Analista de Funil, Risco e Forecast
│   │   └── erp/
│   │       ├── erp-tax-engine.ts                 # Motor Fiscal Brasil (LC 116/03 + SV 31 STF + Lucro Presumido/Real/Simples)
│   │       ├── erp-seed.ts                       # Seed oficial Seta Telecom (Propostas, Contratos, Contas, Catálogo, Faturas)
│   │       └── gestaoclick-client.ts             # Conector ao vivo GestãoClick API / MCP (ERP-GROK)
│   ├── api/
│   │   ├── router.ts                             # Roteador unificado CrmApiRouter (Fases 1 a 4)
│   │   └── server.ts                             # Servidor HTTP standalone opcional
│   └── app/
│       ├── api/
│       │   ├── [[...slug]]/route.ts              # Next.js Catch-All Route Handler unificado
│       │   └── _bridge.ts                        # Ponte Next.js Request/Response <-> CrmApiRouter
│       ├── lib/
│       │   ├── durable-storage.ts                # Journal durável no cliente p/ reconciliação serverless
│       │   └── proposal-share.ts                 # Geração e decodificação de links públicos de propostas PDF
│       ├── proposta/[id]/page.tsx                # Página pública A4 de Proposta Comercial p/ impressão PDF pelo cliente
│       ├── components/
│       │   ├── OverviewAiCopilotTab.tsx          # Aba 1: Visão Geral & Copiloto IA
│       │   ├── DealsKanbanTab.tsx                # Aba 2: Funil Kanban & Seletor de Pipeline
│       │   ├── ErpGestaoClickTab.tsx             # Aba 3: ERP Seta Telecom / GestãoClick Completo
│       │   ├── GestaoClickSidebar.tsx            # Menu lateral árvore exata SETA | IT (13 seções)
│       │   ├── GestaoClickDashboard.tsx          # Dashboard GestãoClick interativo (Cards, Gráficos, Contas e Apps)
│       │   ├── ErpEditModals.tsx                 # Modais CRUD (Propostas, Contratos, Faturas e Tabelas ERP)
│       │   ├── ServiceDeskTab.tsx                # Aba 4: Service Management (JSM) & SLA
│       │   ├── ContactsCompaniesTab.tsx          # Aba 5: Contatos & Empresas
│       │   ├── ContactDetailDrawer.tsx           # Drawer lateral 360º do Contato/Empresa
│       │   ├── FormsBuilderTab.tsx               # Aba 6: Web Forms Builder & Migração Nativa HubSpot v3
│       │   ├── DataHealthTab.tsx                 # Aba 7: Saúde da Base, Duplicados & Auto-Clean
│       │   ├── AutomationsSequencesTab.tsx       # Aba 8: Workflows & Cadências
│       │   ├── SequencesSection.tsx              # Subcomponente de Cadências de E-mail
│       │   └── ui-helpers.tsx                    # Utilitários visuais e formatação BRL
│       ├── layout.tsx                            # Layout raiz STI-hub | Seta Telecom CRM & ERP
│       └── page.tsx                              # Aplicação principal STI-hub
└── tests/
    └── crm.test.ts                               # Suíte automatizada (10 suítes / 20 testes)
```

---

## 4. Tabela Resumo de Endpoints REST (`/api/*` — Fases 1 a 4)

| Fase | Módulo | Método & Rota | Descrição |
|---|---|---|---|
| Core | Bootstrap & Sync | `GET, POST /api/bootstrap` (ou `/api/state`) | Retorna payload completo do CRM + ERP em 1 request e reconcilia journal durável do cliente |
| Core | Reconciliação | `POST /api/state/reconcile` | Reconcilia estado durável do cliente (`ClientDurableJournal`) com o servidor |
| Core | Healthcheck | `GET /api/health` | Status do serviço, modo do banco (`file-json` ou `postgresql`) e contadores de entidades |
| Fase 1 | Contatos | `GET, POST /api/contacts` | Lista contatos (busca sem acento/telefone) e cria contato disparando workflows |
| Fase 1 | Contato 360º | `GET, PATCH, PUT, DELETE /api/contacts/:id` | Detalhe 360º, edição cadastral e exclusão de contato |
| Fase 1 | Empresas | `GET, POST /api/companies` | Lista empresas com `contactsCount`/`dealsCount`/`totalDealValue` e cria empresa |
| Fase 1 | Empresa 360º | `GET, PATCH, PUT, DELETE /api/companies/:id` | Detalhe, atualização cadastral e exclusão de empresa |
| Fase 1 | Negócios (Deals) | `GET, POST /api/deals` | Lista negócios com `forecast` e `isRotting`; cria novo negócio no pipeline |
| Fase 1 | Negócio Individual | `GET, PATCH, PUT, DELETE /api/deals/:id` | Atualiza etapa/valor (dispara `DEAL_STAGE_CHANGED`) ou remove negócio |
| Fase 1 | Pipelines | `GET, POST /api/pipelines` | Lista pipelines com colunas do Kanban populadas ou cria novo pipeline |
| Fase 1 | Timeline | `GET, POST /api/timeline` | Lista e registra eventos (`NOTE`, `EMAIL`, `CALL`, `TASK`, `MEETING`, etc.) |
| Fase 2 | Workflows | `GET, POST /api/workflows` | Lista/cria workflows ou dispara execução (`action: 'TRIGGER'`) |
| Fase 2 | Trigger Workflow | `POST /api/workflows/trigger` | Dispara avaliação de workflow por evento (`triggerType`, `entityId`) |
| Fase 2 | Editar Workflow | `PATCH, PUT /api/workflows/:id` | Ativa/desativa (`isActive`) ou atualiza passos do workflow |
| Fase 2 | Cadências (Sequences)| `GET, POST /api/sequences` | Lista/cria cadências, inscreve (`ENROLL`), avança (`ADVANCE_STEP`) e pausa ao responder (`REPLY`) |
| Fase 2 | Atalhos Cadência | `POST /api/sequences/enroll` e `/interaction` | Endpoints dedicados para inscrição e registro de abertura/clique/resposta |
| Fase 2 | Saúde da Base | `GET /api/data-health/summary` | Score Global (0–100), breakdown, deals estagnados e recomendações |
| Fase 2 | Duplicados | `GET /api/data-health/duplicates` | Duplicados de contatos e empresas (exato + fuzzy) com plano `suggestedMerge` |
| Fase 2 | Merge Registros | `POST /api/data-health/merge` | Unifica registros duplicados transferindo Deals e Timeline sem perda |
| Fase 2 | Auto-Clean | `POST /api/data-health/auto-clean` | Higienização em lote (merge de alta confiança + padronização + enriquecimento) |
| Fase 2 | Órfãos | `POST /api/data-health/reassign-orphans` | Reatribui contatos/empresas/deals de proprietários inativos |
| Fase 2 | Enriquecimento | `POST /api/enrichment/run` | Enriquecimento unitário (`contactId`/`companyId`), preview por domínio ou lote |
| Fase 2 | Copiloto IA | `GET, POST /api/ai-insights` | Diagnóstico executivo, gargalos do funil, deals em risco, forecast e perguntas livres |
| Fase 3 | Formulários Web | `GET, POST /api/forms` | Lista formulários web, submissões e métricas de conversão; cria novo formulário |
| Fase 3 | Submissão Form | `POST /api/forms/submit` | Processa envio de formulário: cria/atualiza Contato, enriquece Empresa e abre Deal/Ticket JSM |
| Fase 3 | Service Desk (JSM) | `GET, POST /api/tickets` | Lista chamados com KPIs de SLA/CSAT e abre novo chamado com cálculo de SLA |
| Fase 3 | Ticket Individual | `GET, PATCH, PUT, DELETE /api/tickets/:id` | Consulta, atualiza status/prioridade/responsável ou exclui chamado |
| Fase 3 | Comentários Ticket | `POST /api/tickets/:id/comments` | Registra resposta pública do agente/cliente ou nota técnica interna (`isInternal`) |
| Fase 3 | Migração HubSpot | `POST /api/migration/hubspot` | Importa lote nativo HubSpot CRM v3 (Empresas, Contatos, Deals, Tickets) com Auto-Clean |
| Fase 4 | Visão Geral ERP | `GET /api/erp/overview` | Retorna KPIs de locação/fiscal, propostas, contratos, faturas, catálogo, financeiro e contas |
| Fase 4 | Propostas ERP | `GET, POST /api/erp/proposals` | Lista e cria Propostas Comerciais / Orçamentos (`ErpCommercialProposal`) |
| Fase 4 | Proposta CRUD | `GET, PATCH, PUT, DELETE /api/erp/proposals/:id` | Busca por ID/código, edita itens/valores/cláusulas ou exclui proposta comercial |
| Fase 4 | Aprovar Proposta | `POST /api/erp/proposals/:id/approve` | Aprova proposta, gera Contrato de Locação (`ErpRentalContract`) e 1ª Fatura 0% ISS |
| Fase 4 | Contratos Locação | `GET, POST /api/erp/rental-contracts` (ou `/contracts`) | Lista e cria Contratos de Locação de Equipamentos |
| Fase 4 | Contrato CRUD | `PATCH, PUT, DELETE /api/erp/rental-contracts/:id` | Atualiza vigência, itens, valor mensal, status ou exclui contrato |
| Fase 4 | Gerar Fatura Mensal| `POST /api/erp/rental-contracts/:id/generate-invoice` | Emite fatura mensal de locação (0% ISS — Súmula Vinculante 31 STF) para o contrato |
| Fase 4 | Gerar NF-e Remessa | `POST /api/erp/rental-contracts/:id/generate-remessa` | Emite NF-e de Remessa de Bem para Locação (CFOP 5.908/6.908 / 5.949) sem incidência de ICMS |
| Fase 4 | Documentos Fiscais | `GET, POST /api/erp/invoices` (ou `/fiscal-documents`) | Lista e emite Faturas de Locação, NFS-e de Serviços, NF-e de Remessa e NFCom |
| Fase 4 | Doc. Fiscal CRUD | `PATCH, PUT, DELETE /api/erp/invoices/:id` | Edita dados do documento fiscal ou exclui registro |
| Fase 4 | Liquidar Fatura | `POST /api/erp/invoices/:id/pay` | Marca fatura/nota fiscal como `PAGA` e concilia lançamento financeiro |
| Fase 4 | Catálogo ERP | `GET, POST /api/erp/catalog` e `PATCH, PUT, DELETE /api/erp/catalog/:id` | CRUD completo de Equipamentos Telecom e Serviços (`ErpCatalogItem`) |
| Fase 4 | Lançamentos Fin. | `GET, POST /api/erp/financial` e `PATCH, PUT, DELETE /api/erp/financial/:id` | CRUD de Contas a Pagar e Contas a Receber (`ErpFinancialEntry`) |
| Fase 4 | Baixar Lançamento | `POST /api/erp/financial/:id/pay` | Baixa título financeiro (`status: 'PAGO'`) |
| Fase 4 | Coleções GestãoClick| `POST, PATCH, PUT, DELETE /api/erp/records/:collection(/:id)` | CRUD para `bankAccounts`, `salesOrders`, `serviceOrders`, `suppliers`, `employees`, `purchaseOrders` |
| Fase 4 | Status GestãoClick | `GET /api/erp/gestaoclick/status` | Retorna configuração e status da conexão `ERP-GROK` com o GestãoClick |
| Fase 4 | Sync GestãoClick | `POST /api/erp/gestaoclick/sync` | Sincroniza dados ao vivo com a API GestãoClick e retorna `erp` atualizado |
| Fase 4 | Config GestãoClick | `PATCH, POST /api/erp/gestaoclick/config` | Atualiza Razão Social, CNPJ, Inscrições, Loja e Regime Tributário da Seta Telecom |

---

## 5. Detalhamento dos Contratos das Fases 3 e 4

### 5.1 Bootstrap Atômico & Reconciliação (`GET | POST /api/bootstrap`)
- Consolida em uma única chamada todos os estados necessários para a UI (`aiReport`, `pipelines`, `deals`, `dealsForecast`, `contacts`, `companies`, `healthSummary`, `duplicates`, `workflows`, `workflowExecutions`, `sequences`, `enrollments`, `webForms`, `formSubmissions`, `formsSummary`, `tickets`, `ticketKpis`, `erp`, `serverTimestamp`).
- Quando chamado via `POST` com `{ reconcileJournal, question? }`, aplica todas as mutações recentes do cliente antes de montar o snapshot.

### 5.2 Marketing Hub — Formulários Web (`/api/forms` & `/api/forms/submit`)
- `GET /api/forms`: Retorna `{ data: WebForm[], submissions: FormSubmission[], summary: { totalForms, activeForms, totalViews, totalSubmissions, avgConversionRate } }`.
- `POST /api/forms/submit`: Recebe `{ formId, values: { email, firstName, lastName, phone, companyName, subject, description, priority, ... } }`. Cria ou atualiza o contato, executa enriquecimento por domínio corporativo, cria Deal automaticamente (`autoCreateDeal`) e/ou abre chamado no Service Desk (`autoCreateTicket` / `SUPPORT_TICKET`), registrando evento `FORM_SUBMITTED` na Timeline.

### 5.3 Service Desk (JSM) & SLA (`/api/tickets`, `/api/tickets/:id`, `/api/tickets/:id/comments`)
- `GET /api/tickets`: Retorna `{ data: EnrichedServiceTicket[], total, kpis: { totalTickets, openCount, criticalCount, onTrackCount, atRiskCount, breachedCount, slaComplianceRate, avgFirstResponseMinutes, avgCsat } }`.
- `POST /api/tickets`: Abre chamado com chave sequencial (`JSM-101`, etc.) e prazos de SLA calculados conforme a prioridade (`CRITICAL`, `HIGH`, `MEDIUM`, `LOW`).
- `POST /api/tickets/:id/comments`: Adiciona comentário público (`isInternal: false`) ou nota técnica interna (`isInternal: true`) e atualiza opcionalmente `newStatus` (`IN_PROGRESS`, `WAITING_CUSTOMER`, `RESOLVED`, `CLOSED`).

### 5.4 Migração Nativa HubSpot CRM v3 (`POST /api/migration/hubspot`)
- Aceita `{ accessToken?, autoClean?: true, companies?: [], contacts?: [], deals?: [], tickets?: [] }`. Se enviado sem arrays customizados, executa lote de demonstração realista do HubSpot v3 (iFood, WEG, etc.), vincula contatos às empresas por domínio, enriquece dados e roda higienização automática (`autoCleanDatabase`).

### 5.5 ERP Seta Telecom / GestãoClick (`/api/erp/*` e `/proposta/[id]`)
- **Motor Tributário (`src/modules/erp/erp-tax-engine.ts`)**:
  - **Locação de Bens Móveis (`FATURA_LOCACAO`)**: Aplica alíquota **0% de ISS** com fundamentação legal expressa na **Súmula Vinculante nº 31 do STF** e **veto ao item 3.01 da Lei Complementar nº 116/2003**, calculando PIS/COFINS conforme o regime (`LUCRO_PRESUMIDO`, `LUCRO_REAL` ou `SIMPLES_NACIONAL`) e contabilizando a economia de ISS em `kpis.issSavedBySv31Stf`.
  - **Serviços Técnicos (`NFSE_SERVICO`)**: Calcula ISS (ex.: 2% a 5%) e retenções federais na fonte (IRRF 1,5% e CSRF 4,65% — PIS/COFINS/CSLL).
  - **Remessa em Locação (`NFE_REMESSA_LOCACAO`)**: Emite NF-e com CFOP `5.908` / `6.908` (ou `5.949`) com não incidência de ICMS/IPI na saída de ativo imobilizado para locação.
- **Link Público de Proposta (`/proposta/[id]`)**:
  - Permite compartilhar qualquer proposta comercial com o cliente via URL pública contendo snapshot autossuficiente (`?d=...`) ou consulta direta à API `/api/erp/proposals/:id`, com layout A4 pronto para impressão/salvamento em PDF (`?print=1`).
