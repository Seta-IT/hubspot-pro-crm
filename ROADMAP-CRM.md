# ROADMAP OFICIAL DE CRM, SEGURANÇA & PLATAFORMA — STI-hub (`SETA | IT` • HubSpot Portal `#4369067`)

> Documento oficial de governança, arquitetura, produto e segurança corporativa do **Domínio CRM & Plataforma STI-hub (`/workspace/hubspot-pro-crm`)**, sob responsabilidade do **Supervisor de CRM & Plataforma** para **Marcéllo Mira (Seta Telecom LTDA — HubSpot Portal `#4369067`)**.
>
> **Nota de Escopo & Integração Nativa**: As diretrizes fiscais, financeiras, patrimoniais e operacionais do ERP (GestãoClick Loja Matriz `#118887` — `ERP-GROK`) são geridas pelo **Supervisor ERP** em `ROADMAP-ERP.md` / `ROADMAP.md`, mantendo **integração nativa bidirecional** no **STI-hub** (conversão de Deals em Propostas `#4695`, abertura de O.S. a partir de Tickets JSM e separação de bases no Data Health).

---

## 1. Contatos & Empresas B2B (HubSpot Portal `#4369067`) + Trava Fiscal Anti-Merge de CNPJ

- **Base Real Sincronizada (`src/db/seed.ts` & `src/app/components/ContactsCompaniesTab.tsx`)**:
  - **23 Contatos B2B** e **22 Empresas Reais** sincronizados do **HubSpot Portal `#4369067`** da Seta Telecom (incluindo contas Enterprise como Nubank, TOTVS, VTEX, RD Station, Creditas, QuintoAndar, iFood, Loggi, Digisystem, Braspress, Kalunga, Hospital Albert Einstein, Grupo Fleury, etc.).
  - **Visão 360º (`ContactDetailDrawer.tsx`)**: Timeline unificada (Notas, E-mails enviados/recebidos, Chamadas, Reuniões, Tarefas, Enriquecimento de Domínio, Propostas ERP e Faturas), disparo de e-mail direto do card (`HubSpotCardEmailComposer`) e fila dedicada de tarefas (`HubSpotTasksQueueView.tsx`).
- **Trava Fiscal Obrigatória Anti-Merge de CNPJs Distintos (`src/modules/data-health/deduplication.ts`)**:
  - **`haveConflictingCnpjs(companyA, companyB)`**: Compara os 14 dígitos numéricos de CNPJ validados em Módulo-11. Se ambas as empresas possuírem CNPJs preenchidos e **diferentes** (ex.: **Matriz `/0001-XX` e Filial `/0002-XX`** ou empresas do mesmo grupo econômico que compartilham o mesmo domínio web corporativo), elas **JAMAIS** são classificadas como duplicadas.
  - **`detectProtectedBranchCompanies(companies)`**: Identifica pares Matriz/Filial ou grupos econômicos com mesmo domínio e CNPJs distintos, exibindo selo de **Proteção Fiscal Matriz/Filial** no painel de Saúde da Base (`DataHealthTab.tsx`).
  - **Bloqueio Hard na API (`POST /api/data-health/merge`)**: Rejeita imediatamente com `400 Bad Request` qualquer tentativa manual ou automática de mesclar empresas com CNPJs conflitantes.

---

## 2. Sales Hub Enterprise (`DealsKanbanTab.tsx` + `MarketingAndSalesHubSuites.tsx`)

- **Funil Kanban Multi-Pipeline de Negócios (`DEALS_KANBAN`)**:
  - **3 Pipelines Comerciais Principais** (+ Pipeline de Cotações/Compras integrado):
    1. `Pipeline 1: Locação & Serviços` (`pipeline-locacao-equipamentos` — Levantamento Técnico, Simulação MRR, Minuta de Locação/Comodato, Remessa NF-e CFOP 5.908, Locação Ativa).
    2. `Pipeline 2: Vendas Enterprise B2B` (`pipe-enterprise-b2b` — Prospecção, SQL, Demonstração, Proposta Comercial, Negociação & Jurídico, Fechado Ganho/Perdido).
    3. `Pipeline 3: Expansão, Aditivos & Renovação` (`pipeline-expansao-renovacao` — Diagnóstico 90d, Proposta de Aditivo/Upgrade, Assinatura & Reajuste IPCA/IGP-M/IST, Renovado/Churn).
  - Cálculo automático de **MRR**, **TCV**, prazo contratual (`contractMonths`), probabilidade ponderada por estágio, **Deal Rotting** (alerta de negócios estagnados acima do SLA da etapa) e **Next Best Action** assistida por IA.
  - Conversão em 1 clique do card do Deal em **Proposta Comercial `#4695`** com link público `/proposta/[id]`.
- **Quotas, Metas & Comissões MRR (`SalesHubProSuite` — `QUOTAS_COMMISSIONS`)**:
  - Acompanhamento individual de metas de MRR Novo e TCV por executivo da Seta Telecom (`Marcéllo Lopes Mira`, `Michelle da Rocha`, `Evelyn Ternero`), aceleradores de comissão para contratos de 24/36 meses e atingimento de quota em tempo real.
- **Playbooks de Vendas B2B (`PLAYBOOKS`)**:
  - Roteiros interativos de descoberta e fechamento telecom/TI (Substituição CAPEX por Locação Pura SV 31 STF, Qualificação PABX IP Cloud/Yealink, Objeções Jurídicas e SLA NOC) com checklist e geração automática de nota estruturada na timeline do negócio.
- **Agendador Executivo de Reuniões (`MEETINGS_SCHEDULER`)**:
  - Links públicos de agendamento (`/reuniao/marcello-mira`, `/reuniao/engenharia-seta`) sincronizados com a agenda comercial e criação automática de evento `MEETING` na timeline.
- **Cadências Automatizadas (`SequencesSection.tsx` / `/api/sequences`)**:
  - Sequências multi-etapas de prospecção outbound e follow-up de propostas com **pausa automática imediata (`PAUSED_ON_REPLY`)** assim que o cliente responde ao e-mail.

---

## 3. Marketing Hub ABM (`MarketingAndSalesHubSuites.tsx` + `FormsBuilderTab.tsx`)

- **Campanhas & Atribuição de ROI Multi-Touch (`CAMPAIGNS_ROI`)**:
  - Gestão de campanhas B2B (ABM Q4 Locação Pura 0% ISS, Modernização PABX IP & Gateways SIP, Webinar SD-WAN & Segurança) com rastreamento de orçamento, sessões, contatos gerados, MQLs, SQLs, negócios atribuídos e **ROI em R$**.
- **E-mail Marketing ABM (`EMAIL_MARKETING`)**:
  - Disparo segmentado de newsletters técnicas e campanhas ABM com métricas de taxa de entrega, abertura (`Open Rate`), cliques (`CTR`) e respostas.
- **Listas Ativas & Lead Scoring Preditivo (`SEGMENTS_SCORING`)**:
  - Segmentos dinâmicos (ex.: *Decisores C-Level em Contas Tier 1*, *Contratos a vencer em 90 dias*, *Leads Quentes Score ≥ 80*) e regras configuráveis de pontuação por perfil (ICP/Cargo/CNPJ) e engajamento.
- **Construtor Dinâmico de Formulários Web (`FormsBuilderTab.tsx` / `/api/forms` e `/api/forms/submit`)**:
  - Criação de formulários de captura de leads e abertura de chamados com campos customizados, código embed JS, simulador executivo em tempo real, exportação CSV e conversão automática em **Contato + Empresa enriquecida + Deal ou Ticket JSM**.

---

## 4. Service Hub & NOC Telecom (`ServiceDeskTab.tsx` + Portal Externo `/portal`)

- **Service Management (JSM) & Filas NOC (`SERVICE_DESK`)**:
  - Filas técnicas escalonadas da Seta Telecom: **NOC N1 (Triagem & Monitoramento)**, **NOC N2 (Engenharia SIP/PABX/Redes)**, **NOC N3 (Core/BGP/Infraestrutura Crítica)**, **Field Service / RMA (Substituição de Equipamentos S/N)** e **Faturamento / Contratos**.
  - **Motor Dinâmico de SLA em Tempo Real**: Cálculo contínuo de `firstResponseDueAt` e `resolutionDueAt` com status `ON_TRACK`, `AT_RISK` e `BREACHED` e recálculo automático ao alterar prioridade (`URGENT`, `HIGH`, `MEDIUM`, `LOW`).
  - **Separação Estrita de Comentários**: Notas Técnicas Internas do NOC (`isInternal: true`) permanecem 100% invisíveis para o cliente externo, enquanto respostas públicas notificam o solicitante.
  - **Integração Nativa NOC → O.S. ERP**: Conversão em 1 clique de qualquer chamado técnico em **Ordem de Serviço (O.S.)** vinculada ao patrimônio `S/N` no módulo ERP.
- **Portal Externo do Cliente (`/portal` — `src/app/portal/page.tsx` e `/api/portal/tickets`)**:
  - Interface pública dedicada para clientes da Seta Telecom consultarem protocolos por e-mail/ticket, acompanharem o status de SLA em tempo real, abrirem novos chamados técnicos, interagirem com o NOC (sem acesso às notas internas) e registrarem avaliação **CSAT (1 a 5 estrelas)**.

---

## 5. Construtor Visual de Automações (DAG) & Relatórios / Dashboards Clicáveis (UX Clean)

- **Construtor Visual de Automações Baseado em Nós / DAG (`AutomationsSequencesTab.tsx` + `/api/workflows`)**:
  - Editor visual em grafo acíclico direcionado (DAG) com nós de **Gatilho (`Trigger`)**, **Condição (`If/Branch`)** e **Ações (`Action`)**:
    - Gatilhos: `CONTACT_CREATED`, `DEAL_STAGE_CHANGED`, `SCORE_THRESHOLD`, `FORM_SUBMITTED`.
    - Ações: Enriquecer domínio corporativo, criar tarefa de follow-up para o proprietário, enviar e-mail com template dinâmico, inscrever em sequência, atualizar propriedade customizada ou notificar canal executivo.
  - Histórico auditável de execuções (`WorkflowExecution`) com log passo a passo.
- **Relatórios Executivos, Copiloto IA & UX Clean 100% Clicável (`OverviewAiCopilotTab.tsx`)**:
  - Diagnóstico de funil por IA (`/api/ai-insights`) identificando gargalos de conversão por etapa, negócios em risco (*Deal Rotting*), forecast ponderado (MRR/TCV) e oportunidades ocultas de upsell na base.
  - Todos os badges do sub-header (`Contatos`, `Empresas`, `Forecast`, `Saúde da Base`, `Service Desk`), KPIs e gráficos executam **drill-down imediato** para a listagem ou registro correspondente.

---

## 6. Painel de Saúde da Base de Dados (`DataHealthTab.tsx` + `/api/data-health/*`)

- **Governança com Escopo Separado (`Base CRM` vs `Base ERP`)**:
  - Seletor dedicado no topo da aba **Saúde da Base** permitindo auditar separadamente a **Base CRM** (23 Contatos e 22 Empresas com score de completude ponderado, e-mails inválidos/descartáveis, telefones fora do padrão E.164 e duplicidades fuzzy) e a **Base ERP** (compliance de CNPJ Módulo-11, catálogo SKU/NCM/LC 116 e contratos c/ S/N).
- **Merge Inteligente & Auto-Clean Seguro**:
  - Mesclagem assistida (`POST /api/data-health/merge`) e higienização em lote (`POST /api/data-health/auto-clean`) preservando todos os `TimelineEvents`, `Deals` e campos mais completos, respeitando rigorosamente a **Trava Fiscal Anti-Merge de CNPJs distintos**.

---

## 7. Central de Administração (`AdminSettingsCenterTab.tsx` + `StiHubAdminRbacPanel.tsx`)

1. **Campos Customizáveis Oficiais do HubSpot `#4369067` (`CUSTOM_FIELDS` / `/api/admin/custom-fields`)**:
   - **Contatos**: `buyingRole` (`DECISION_MAKER`, `BUDGET_HOLDER`, `CHAMPION`, `TECHNICAL_EVALUATOR`, `INFLUENCER`, `END_USER`, `BLOCKER`), `ownerName`, `isUnworked`, `leadScore`, `completenessScore`, `seniority`, `department`.
   - **Empresas**: `isTargetAccount` (Conta-Alvo ABM), `icpTier` (`TIER_1`, `TIER_2`, `TIER_3`), `cnpj` (Módulo-11), `annualRevenue`, `industry`, `completenessScore`.
   - **Deals**: `dealType` (`NEW_BUSINESS`, `LOCACAO_RECORRENTE`, `UPSELL_RENOVACAO`), `priority` (`ALTA`, `MEDIA`, `BAIXA`), `mrr`, `contractMonths`, `ownerName`.
2. **Modelos de E-mail & Validação SPF / DKIM / DMARC (`EMAIL_CONFIG` + `EMAIL_TEMPLATES`)**:
   - Configuração e verificação de autenticidade do domínio remetente `@setatelecom.com.br` (**SPF**, **DKIM**, **DMARC** e relay transacional SMTP / Resend HTTP API com protocolo `STI-MAIL-...`).
   - Catálogo de modelos dinâmicos com interpolação `{{contact.firstName}}`, `{{company.name}}`, `{{deal.title}}` e snippets rápidos (`#snippet`), além dos 5 templates transacionais integrados (`PROPOSAL`, `TICKET_REPLY`, `BOLETO`, `RENTAL_RECEIPT`, `FISCAL_INVOICE`).
3. **Matriz Granular RBAC (`USERS_RBAC` / `src/app/lib/rbac.ts` / `/api/admin/rbac`)**:
   - **9 Perfis Oficiais de Acesso**:
     1. `SUPER_ADMIN` — Diretoria / Super Admin STI-hub
     2. `DIRETORIA_COMERCIAL` — Diretoria Comercial & Revenue Operations
     3. `EXECUTIVO_VENDAS` — Executivo de Contas / Closer B2B
     4. `SDR_PRE_VENDAS` — Pré-Vendas / SDR & Marketing Hub
     5. `FINANCEIRO_FATURAMENTO` — Financeiro, Faturamento, Contratos & Cobrança
     6. `FISCAL_CONTABIL` — Fiscal, Tributário & Emissão NF-e / NFS-e / Fatura SV 31
     7. `ENGENHARIA_NOC` — Engenharia Telecom, NOC N1/N2/N3 & Service Desk JSM
     8. `TECNICO_CAMPO_OS` — Field Service, O.S., RMA & Almoxarifado
     9. `ATENDIMENTO_PDV` — Operador de Atendimento & Frente de Caixa (PDV Balcão)
   - **22 Usuários Sincronizados da Seta Telecom** (incluindo `Marcéllo Lopes Mira`, `Evelyn Olivia de Rosa Ternero`, `Michelle da Rocha` e toda a equipe técnica/comercial/administrativa).
   - **Escopos de Visibilidade**: `TODOS`, `EQUIPE`, `PROPRIOS`.
   - **7 Action Guards Individuais**: `canViewFinancialBalances`, `canIssueFiscalDocuments`, `canApproveProposals`, `canMergeRecords`, `canDeleteRecords`, `canExportData`, `canManageUsersRbac`.

---

## 8. Segurança Corporativa & Plataforma (`src/app/login/page.tsx` + `src/middleware.ts`)

- **Autenticação em 2 Etapas Obrigatórias com MFA / 2FA (`/login`)**:
  - **Etapa 1**: Validação de credenciais corporativas (`@setatelecom.com.br` + senha) em `POST /api/auth/login` contra os 22 usuários ativos do RBAC.
  - **Etapa 2**: Desafio obrigatório de código **MFA 2FA de 6 dígitos** (TOTP Autenticador / Código Corporativo) em `POST /api/auth/verify-mfa`.
  - **Sessão Segura**: Cookie `HttpOnly` assinado (`stihub_session`, `SameSite=Lax`, `Path=/`) com `mfaVerified: true`, perfil RBAC, escopo de visibilidade e encerramento imediato em `POST /api/auth/logout`.
- **Proteção Total de Rotas via Next.js Edge Middleware (`src/middleware.ts`)**:
  - Bloqueia acessos não autenticados ou sem `mfaVerified` redirecionando páginas para `/login?next=...` e retornando `401 Unauthorized` em rotas `/api/*` protegidas.
  - Rotas públicas estritamente controladas: `/login`, `/api/auth/*`, `/proposta/[id]` + `GET /api/erp/proposals/:id` (visualização/impressão de proposta pelo cliente) e `/api/health`.
- **Subdomínio Oficial em Produção (Vercel)**:
  - Produção ativa e publicada em **`https://sti-hub.vercel.app`**, com suporte a CNAME customizado corporativo (`https://stihub.setatelecom.com.br` e `https://erp.setatelecom.com.br`).

---

## Próxima Etapa Planejada (Backlog de Integração ERP -> CRM)

- [ ] **[AGUARDANDO DEFINIÇÃO DE REGRAS COM O MARCÉLLO ANTES DE IMPLEMENTAR] — Opção de criar/espelhar Negócio (Deal) no CRM ao criar uma Proposta Comercial no ERP:**
  - **Diretriz do Marcéllo (`[t58u]`):** *"Ao criar uma proposta no ERP, ter a opção de criar no CRM, deixe isso no roadmap e me pergunte antes de criar para mais regras."*
  - **Status:** Registrado no Roadmap e **bloqueado para implementação até alinhamento prévio das regras de negócio com o Marcéllo** (ex.: em qual pipeline e etapa o Deal deve nascer, quando criar ou vincular a um Deal já existente, mapeamento de valores/MRR e gatilhos de atualização).
