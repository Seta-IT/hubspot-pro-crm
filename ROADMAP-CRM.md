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
  - **Sessão Segura & Resolução Criptográfica de Segredo (`resolveStiHubSigningSecret`)**:
  - Cookie `HttpOnly` assinado via HMAC-SHA256 (`stihub_session`, `SameSite=Lax`, `Path=/`) com `mfaVerified: true`, perfil RBAC, escopo de visibilidade e encerramento imediato em `POST /api/auth/logout`.
  - Eliminação de segredo estático previsível no código-fonte: resolução prioritária via variáveis de ambiente (`STI_HUB_SESSION_SECRET` / `NEXTAUTH_SECRET` / `AUTH_SECRET`), com derivação efêmera CSPRNG por processo/ambiente em dev/test e alerta de segurança em produção (`NODE_ENV === 'production'`).
- **Proteção Total de Rotas via Next.js Edge Middleware (`src/middleware.ts`)**:
  - Bloqueia acessos não autenticados ou sem `mfaVerified` redirecionando páginas para `/login?next=...` e retornando `401 Unauthorized` em rotas `/api/*` protegidas (incluindo `GET /api/erp/proposals` e `/api/erp/daily-sync`, que exigem sessão MFA autenticada e módulo `ERP`).
  - Rotas públicas estritamente controladas: `/login`, `/api/auth/*`, `/portal` + `/api/portal/*`, `/proposta/[id]` + exclusivamente rotas individuais de uma proposta específica (`GET /api/erp/proposals/:id` e `POST /api/erp/proposals/:id/approve` para visualização/assinatura ICP-Brasil pelo cliente externo) e `/api/health`.
- **Subdomínio Oficial em Produção (Vercel)**:
  - Produção ativa e publicada em **`https://sti-hub.vercel.app`**, com suporte a CNAME customizado corporativo (`https://stihub.setatelecom.com.br` e `https://erp.setatelecom.com.br`).

---

## 9. PLATAFORMA ENTERPRISE DE EMAIL MARKETING, CADÊNCIAS E SALES ENGAGEMENT (HUBSPOT PRO + MAILCHIMP — SETA TELECOM)

> Especificação oficial de arquitetura, engenharia reversa funcional, banco de dados, governança, entregabilidade e implementação em fases da plataforma própria de **Email Marketing, Sales Engagement e Automação Comercial** do **STI-hub (Seta Telecom)**, unificando as capacidades do **HubSpot Sales Hub Professional**, **HubSpot Marketing Hub Professional** e **Mailchimp Standard/Premium** com recursos **Enterprise** selecionados.

---

### 9.1. Missão & Escopo do Ciclo Comercial Completo

A plataforma gerencia integralmente o ciclo comercial B2B da Seta Telecom, indo muito além de um simples disparador de e-mails:
- **Fluxo End-to-End**: `Prospecção → Cadências → Engajamento → Qualificação (MQL/SQL) → Oportunidade (Deal/Proposta #4695) → Conversão (Contrato Locação/Venda) → Reativação`.
- **Composição Multidisciplinar de Engenharia**:
  - Product Manager SaaS B2B, Arquiteto Cloud, Engenheiros Backend e Frontend, Especialista em CRM & Sales Ops, Especialista em Automação de Marketing, Especialista em Entregabilidade de E-mails, Engenheiro de Dados & Analytics, Especialista em Segurança/Privacidade/Compliance (LGPD/GDPR/CAN-SPAM), Engenheiro de QA/Automação de Testes e Especialista em UX/UI Corporativo.
- **Referências Funcionais Oficiais**:
  1. HubSpot Sales Hub Professional
  2. HubSpot Marketing Hub Professional
  3. HubSpot Sequences e Dynamic Sequences
  4. HubSpot Workflows
  5. HubSpot Email Marketing Analytics
  6. Mailchimp Email Marketing
  7. Mailchimp Marketing Automation Flows (Customer Journeys)
  8. Mailchimp Audience Management
  9. Mailchimp Advanced Segmentation & Analytics
  10. Funcionalidades Enterprise relevantes dos dois produtos
- **Diretriz Arquitetural Central**:
  - Desenvolvido como módulo desacoplado e resiliente dentro do ecossistema **STI-hub** da Seta Telecom, compartilhando a mesma base única de **Contatos, Empresas e Oportunidades (Deals/Propostas)**.
  - O **motor de cadências comerciais 1:1**, o **envio de campanhas massivas de marketing** e o **processamento de eventos de engajamento** operam como serviços independentes para que falhas, limites de cota ou manutenção em um módulo jamais afetem os demais.

---

### 9.2. Cinco Diferenciais Decisivos para a Seta Telecom

1. **Cadências ligadas às oportunidades comerciais**:
   - Se um cliente responder a uma proposta de locação de servidores, PABX IP, gateways SIP ou conectividade SD-WAN, ou se o negócio mudar de etapa no pipeline, a cadência é encerrada ou transferida automaticamente para a etapa de negociação, conforme a regra configurada.
2. **Visão de engajamento por empresa (Account-Based Engagement), não apenas por contato**:
   - Identificar quando dois, três ou mais profissionais de uma mesma empresa (ex.: CTO, CFO e Compras) interagem com uma campanha ou cadência permite priorizar a conta corporativa inteira no ataque comercial ABM.
3. **Outlook / Microsoft 365 para vendas e provedor especializado para marketing**:
   - Separar cadências comerciais individuais 1:1 (enviadas via caixa postal corporativa Microsoft 365 / Microsoft Graph com OAuth de escopo mínimo) de campanhas massivas de marketing (enviadas por provedores especializados como Amazon SES, SendGrid, Mailgun, Postmark ou Resend) preserva limites de envio e protege a reputação do domínio `@setatelecom.com.br`.
4. **Relatórios que conectam marketing a receita**:
   - Não basta medir aberturas ou cliques: a plataforma relaciona campanhas e cadências diretamente com **Propostas Comerciais (`#4695`), Negociações (Deals), Contratos de Locação (`LOC-...`) e Faturamento Real (MRR / TCV / Notas Fiscais)**.
5. **Base própria, com controle total do histórico**:
   - Preservar contatos, registros de consentimento LGPD por finalidade, listas de supressão, eventos técnicos de envio e histórico de cadências em base PostgreSQL própria reduz a dependência operacional do HubSpot e garante soberania de dados.

---

### 9.3. Matriz Comparativa Baseada em Evidências (`HubSpot` × `Mailchimp` × `STI-hub Seta Telecom`)

| Funcionalidade | HubSpot (Sales/Mkt Pro & Ent) | Mailchimp (Standard/Premium) | Nossa Plataforma (STI-hub) | Prioridade |
| :--- | :--- | :--- | :--- | :--- |
| **Cadências comerciais 1:1 (Sequences)** | Sim (Sales Hub Pro/Ent) | Não (foco em broadcast/journeys) | Implementado / Evolução Fase 2 | **P0** |
| **Desinscrição automática da cadência por resposta ou reunião** | Sim | Parcial (via condição em Journey) | Implementado (`PAUSED_ON_REPLY` + 13 regras) | **P0** |
| **Sequências dinâmicas (passos adaptativos por engajamento)** | Sim (HubSpot Dynamic Sequences) | Parcial (If/Else em Journeys) | Planejado / Fase 2 | **P0** |
| **Separação estrita entre sair da cadência vs descadastro global** | Sim | Não (audiência única por lista) | Implementado (`sequenceStatus` ≠ `subscriptionStatus`) | **P0** |
| **Envio 1:1 via caixa Microsoft 365 / Outlook (Graph OAuth)** | Sim | Não | Implementado (Canal `OUTLOOK_M365`) / OAuth Fase 2 | **P0** |
| **Disparo massivo via ESP dedicado (SES/SendGrid/Mailgun/Postmark/Resend)** | Sim (infra própria HubSpot) | Sim (infra própria Mailchimp) | Implementado (Resend/SMTP + Canal `MARKETING_ESP`) | **P0** |
| **Construtor visual de automações (DAG / Customer Journeys)** | Sim (Workflows Pro/Ent) | Sim (Automation Flows) | Implementado (DAG base) + Expansão Fase 4 | **P0** |
| **Segmentação avançada B2B (ICP, Cargo, CNPJ, Funil, Propostas)** | Sim (Active/Static Lists) | Sim (Advanced Segmentation) | Implementado (`/api/marketing/segments`) | **P0** |
| **Visão de engajamento por Empresa (Account-Based Engagement)** | Parcial (exige ABM/Target Accounts) | Não (centrado em contato) | Implementado (Diferencial Seta Telecom) | **P0** |
| **Cadências vinculadas a propostas de locação/servidores e etapas do Deal** | Parcial (via Workflows adicionais) | Não | Implementado (Diferencial Seta Telecom) | **P0** |
| **Atribuição de Receita fim a fim (Campanha → Proposta → Contrato → Fatura)** | Parcial (Multi-touch no Enterprise) | Parcial (foco em e-commerce B2C) | Implementado (Integrado ao ERP GestãoClick `#118887`) | **P0** |
| **Classificação de sinais (Apple MPP / Bot Click vs Engajamento Humano)** | Parcial (filtro de bot clicks) | Parcial (exclui MPP opcional) | Planejado / Fase 5 | **P1** |
| **Central de Preferências, One-Click Unsubscribe e Consentimento LGPD** | Sim | Sim | Implementado (`/api/marketing/preferences`) | **P0** |
| **Editor de e-mail drag-and-drop + texto puro comercial + variáveis** | Sim | Sim | Implementado (Templates/Snippets) + Visual Fase 3 | **P1** |
| **Testes A/B e Multivariados com cálculo de amostra e significância** | Sim (Pro: A/B, Ent: Adaptativo) | Sim (Multivariado no Standard+) | Planejado / Fase 6 | **P1** |
| **IA Comercial e Marketing Intelligence (com evidência e confiança)** | Sim (Breeze / Content Assistant) | Sim (Intuit Assist) | Implementado (Copiloto IA) + Expansão Fase 6 | **P1** |
| **Governança de entregabilidade (SPF, DKIM, DMARC, Rate Limit, Supressão)** | Sim | Sim | Implementado (Validação + Supressão pré-envio) | **P0** |

---

### 9.4. Os 13 Módulos Obrigatórios (Módulos A a M)

#### MÓDULO A — GESTÃO COMPLETA DE CONTATOS E AUDIÊNCIAS
- Cadastro individual e em lote; importação CSV, XLSX e APIs; exportação de dados com controle de permissões RBAC (`canExportData`).
- Deduplicação por e-mail e identificadores do CRM com trava fiscal anti-merge de CNPJs distintos; identificação de contatos duplicados e inativos.
- Histórico completo de relacionamento (timeline unificada com campanhas recebidas, cadências, respostas, links acessados, reuniões, solicitações de descadastro e movimentações comerciais).
- Propriedades personalizadas, campos dinâmicos, tags/categorias, listas estáticas e listas inteligentes/dinâmicas.
- Segmentação multidimensional: por empresa, cargo, setor, localização, proprietário comercial, estágio do funil, histórico de campanhas, engajamento, comportamento, compras e propostas.
- Lead scoring configurável, identificação de leads prioritários, enriquecimento legítimo por domínio/CNPJ, elegibilidade para campanhas, histórico de consentimento por finalidade, listas de supressão permanentes/temporárias e preferências de idioma/fuso horário.

#### MÓDULO B — EDITOR PROFISSIONAL DE E-MAILS
- Editor visual drag-and-drop + Editor HTML + Editor de texto simples (permitindo e-mails com aparência individual e comercial 1:1 sem forçar layout de newsletter).
- Blocos de texto, imagens, botões e colunas; biblioteca compartilhada de templates reutilizáveis (prospecção, follow-up, comerciais, newsletters, promocionais, relacionamento).
- Assinaturas individuais e corporativas; variáveis dinâmicas por contato/empresa/negócio; conteúdo condicional e personalizado por segmento.
- Edição responsiva com preview desktop/mobile, preview de assunto e preheader, envio de teste, validação de links, verificação de imagens e acessibilidade.
- Histórico de versões, fluxo de aprovação antes da publicação, duplicação/organização de templates e assistente de IA para geração/revisão de assunto, CTA e copy.

#### MÓDULO C — CADÊNCIAS COMERCIAIS AVANÇADAS
- Criação de cadências ilimitadas conforme capacidade e infraestrutura; editor visual de passos com e-mails automáticos, e-mails manuais, tarefas comerciais, ligações, lembretes e conexão com calendário.
- Intervalos configuráveis (esperas por dias, horas ou eventos), respeito a horário comercial, dias úteis, feriados e fuso horário do destinatário.
- Personalização por contato, empresa e vendedor; inscrição individual ou em lote com salvaguardas e limites de envio por caixa postal.
- Pausa/retomada, edição de cadências ativas com versionamento, prevenção de cadências conflitantes, controle de reentrada, clonagem e distribuição de leads (round-robin/regras) entre vendedores.
- **Exemplo de Cadência Padrão Seta Telecom (21 Dias)**:
  - **Dia 1**: E-mail de apresentação consultiva.
  - **Dia 3**: Follow-up automático, se não houve resposta.
  - **Dia 5**: Criar tarefa comercial para o vendedor (ligação/WhatsApp).
  - **Dia 7**: Enviar segundo follow-up contextualizado.
  - **Dia 10**: Verificar interesse e criar ramificação condicional.
  - **Dia 14**: Última tentativa comercial (*breakup email*).
  - **Dia 21**: Transferir contato elegível para fluxo de nutrição de marketing.
- **13 Regras Automáticas de Saída Imediata da Cadência**:
  1. O contato responder ao e-mail.
  2. O contato agendar reunião.
  3. O contato solicitar interrupção comercial.
  4. O contato clicar em um link configurado como alta intenção.
  5. Uma oportunidade comercial (Deal) for criada.
  6. Um negócio mudar de etapa no pipeline.
  7. O negócio for fechado como ganho (`WON`) ou perdido (`LOST`).
  8. O contato for desqualificado (`UNQUALIFIED`).
  9. O contato for movido para outra cadência incompatível.
  10. O e-mail apresentar *hard bounce*.
  11. Houver reclamação de spam.
  12. O contato retirar o consentimento aplicável (LGPD).
  13. O contato entrar em lista de supressão.
- **10 Estados Diferenciados de Cadência (Separados do Descadastro Global)**:
  - `ACTIVE` (Em cadência), `WAITING_NEXT_STEP` (Aguardando próximo passo), `PAUSED_MANUAL` (Pausado), `COMPLETED` (Concluído), `REPLIED` / `PAUSED_ON_REPLY` (Respondeu), `MEETING_BOOKED` (Reunião agendada), `REMOVED_MANUAL` (Removido manualmente), `REMOVED_AUTOMATIC` (Removido automaticamente por regra comercial), `UNSUBSCRIBED_GLOBAL` (Descadastrado de comunicações) e `BLOCKED_DELIVERABILITY` / `BOUNCED` (Bloqueado por entregabilidade).
  - **Regra de Ouro**: Sair de uma cadência comercial **NÃO** cancela a inscrição do contato em todas as comunicações, e regras de saída podem operar por contato ou por empresa preservando total rastreabilidade.

#### MÓDULO D — CONSTRUTOR VISUAL DE AUTOMAÇÕES (DAG WORKFLOWS)
- **20 Gatilhos Suportados**: Contato criado, Contato atualizado, Lead importado, Formulário enviado, Tag adicionada/removida, Mudança no pipeline, Proposta enviada, Proposta visualizada (evento verificável), Proposta aprovada, Negócio ganho, Negócio perdido, E-mail entregue, E-mail aberto (sinal aproximado), Link clicado, Resposta recebida, Reunião agendada, Período sem engajamento, Data específica, Webhook recebido, Evento comercial personalizado.
- **17 Ações Suportadas**: Enviar e-mail, Inscrever em cadência, Remover de cadência, Adicionar/remover tag, Alterar proprietário, Atualizar propriedades, Criar tarefa, Criar oportunidade, Notificar vendedor, Enviar webhook, Aguardar condição, Dividir fluxo por condição (If/Else), Dividir fluxo por percentual, Executar teste A/B, Aplicar lead scoring, Encerrar fluxo, Iniciar fluxo de reativação com elegibilidade verificada.
- **14 Requisitos Técnicos**: Editor drag-and-drop em nós, condições AND/OR, ramificações aninhadas, execução idempotente, histórico por etapa, modo de simulação, logs de erros, reprocessamento seguro, versionamento, publicação controlada, rollback, detecção de loops, limites de execução por contato e cancelamento imediato de ações agendadas quando ocorrer uma saída obrigatória.

#### MÓDULO E — CAMPANHAS DE EMAIL MARKETING
- **13 Tipos de Campanhas**: Individuais, Em massa, Newsletters, Segmentadas, Recorrentes, Automatizadas, Nutrição, Reengajamento, Relacionamento, Eventos, Baseadas em comportamento, Aniversário/datas relevantes e Campanhas comerciais vinculadas a produtos e serviços (ex.: Locação Pura SV 31 STF, PABX IP, SD-WAN).
- **16 Atributos Obrigatórios por Campanha**: Nome, Objetivo, Público, Critérios de inclusão, Critérios de exclusão, Remetente, Assunto, Preheader, Template, Data de envio, Configuração de rastreamento (UTMs/Clicks), Configuração de descadastro, Status, Resultados (funil completo), Histórico de alterações e Responsável.

#### MÓDULO F — RELATÓRIOS AVANÇADOS E ANALYTICS
- **39 Métricas Obrigatórias**: E-mails programados, enviados, aceitos pelo provedor, entregues, bloqueados, soft bounces, hard bounces, taxa de entrega, aberturas registradas, aberturas únicas, cliques, cliques únicos, CTR, CTOR (click-to-open), respostas, respostas positivas, respostas negativas, reuniões agendadas, leads qualificados, oportunidades criadas, propostas enviadas, conversões, negócios ganhos, receita atribuída, solicitações de descadastro, reclamações de spam, contatos removidos de cadências, contatos que concluíram cadências, tempo médio até resposta, tempo médio até conversão, performance por etapa, por horário, por dia da semana, por segmento, por domínio de destino, por remetente, por template, por link e histórica.
- **Precisão de Sinais (Apple MPP & Anti-Spam Bots)**: Aberturas não são tratadas como prova definitiva de leitura humana (devido ao Apple Mail Privacy Protection e pré-carregamento de imagens), e cliques de scanners antispam são diferenciados de engajamento humano confirmado.
- **As 20 Perguntas de Identificação com Drill-Down Obrigatório**:
  1. Quem recebeu meus e-mails?
  2. Quem abriu, segundo o rastreamento disponível?
  3. Quem clicou?
  4. Em quais links?
  5. Quem respondeu?
  6. Quem respondeu positivamente?
  7. Quem nunca demonstrou engajamento?
  8. Quem está engajando recentemente?
  9. Quem saiu de uma cadência?
  10. Por qual motivo saiu?
  11. Quem solicitou descadastro?
  12. Quem foi bloqueado por bounce?
  13. Quem agendou reunião?
  14. Quais clientes estão mais interessados?
  15. Quais campanhas geraram oportunidades?
  16. Quais campanhas geraram contratos?
  17. Qual vendedor tem maior taxa de resposta?
  18. Qual sequência gera mais oportunidades?
  19. Qual é a receita atribuída a cada campanha?
  20. Quais contatos estão perdendo engajamento?
- **Recursos Analíticos**: Dashboard personalizável, comparação entre períodos e campanhas, funis de conversão, gráficos por coorte, relatórios por responsável, filtros avançados, exportação CSV/XLSX/PDF, relatórios programados, modelos de atribuição documentados, metas e alertas de queda de performance/bounces/descadastros.

#### MÓDULO G — CENTRAL DE ENGAJAMENTO
- **10 Classificações Operacionais**: Altamente engajados, Engajamento moderado, Pouco engajados, Sem engajamento observável, Interesse comercial confirmado, Resposta pendente do vendedor, Reunião agendada, Oportunidade aberta, Descadastrados, Suprimidos.
- **Score Configurável Ponderado**: Combina respostas, cliques humanos prováveis, visitas identificadas legitimamente, formulários, agendamentos, interações comerciais, tempo desde o último engajamento, estágio do negócio e perfil ICP do cliente (sem tratar abertura isolada como evidência forte).
- **Fila de Ações Recomendadas**: Exibe o próximo passo comercial sugerido e o motivo auditável da recomendação.

#### MÓDULO H — DESCADASTRO, SUPRESSÃO E PREFERÊNCIAS (LGPD / GDPR / CAN-SPAM)
- Link individual de descadastro, cabeçalho *One-Click Unsubscribe* (`List-Unsubscribe-Post`), Central de Preferências (*Preference Center*) com descadastro por categoria ou global, descadastro manual e automático.
- Registro imutável de data, origem, motivo (quando informado) e histórico de consentimento por finalidade; gestão de *double opt-in* e exportação de comprovantes de consentimento.
- **Independência Estrita e Bloqueio Incondicional**: O mecanismo de descadastro é independente das cadências; nenhuma automação, fila ou reimportação de CRM pode ignorar uma supressão obrigatória. Reinscrição exige nova manifestação legítima do titular.

#### MÓDULO I — TESTES A/B E OTIMIZAÇÃO
- Testes de assunto, preheader, remetente, conteúdo, CTA, layout, horário, frequência e testes multivariados.
- Divisão percentual reprodutível de público, cálculo de tamanho mínimo de amostra, definição de métrica vencedora, avaliação de significância/incerteza estatística e escolha automática da variante vencedora apenas quando houver evidência estatística suficiente.

#### MÓDULO J — IA COMERCIAL E MARKETING INTELLIGENCE
- Geração de e-mails comerciais, personalização de abordagem por conta/cargo, sugestão de assuntos, geração de cadências e workflows por prompt, resumo de respostas, detecção de intenção comercial, classificação de respostas positivas/negativas/pedidos de interrupção, sugestão de próximo passo e melhor horário de envio, detecção de queda de engajamento e resumos gerenciais.
- **Governança de IA**: Toda recomendação apresenta evidências e nível de confiança; escritas comerciais relevantes exigem aprovação humana; nenhuma classificação de IA pode substituir ou ignorar um pedido explícito de descadastro.

#### MÓDULO K — INTEGRAÇÃO COM CRM E VENDAS
- Conectores nativos e API própria para: **CRM Interno STI-hub** (fonte primária), **HubSpot (`#4369067`)** durante migração controlada, **Outlook / Microsoft 365**, **GestãoClick ERP (`#118887`)**, **ClickUp**, **Calendários**, **Webhooks** e **Formulários**.
- **Integração com Pipeline e Propostas**: Mudanças de etapa de Deal ou eventos de Proposta (`Proposta criada`, `enviada`, `visualizada`, `aprovada`, `rejeitada`, `Negócio fechado`, `Renovação contratual`) podem iniciar, pausar ou encerrar cadências, notificar o vendedor, criar tarefas, atualizar lead score e consolidar tudo na timeline única do contato e da empresa.

#### MÓDULO L — INTEGRAÇÃO DE E-MAILS E INFRAESTRUTURA DE ENVIO
- **Separação de Canais**:
  - **Microsoft 365 / Outlook (Microsoft Graph API com OAuth de escopo mínimo)**: dedicado a cadências comerciais 1:1 e correspondências individuais dos vendedores.
  - **Camada de Provedores de Marketing em Massa (Amazon SES, SendGrid, Mailgun, Postmark, Resend)**: adaptadores independentes para campanhas massivas, newsletters e automações de marketing.
- **Entregabilidade & Proteção de Reputação**: Validação de domínio, SPF, DKIM, DMARC, alinhamento de autenticação, domínio próprio de rastreamento, monitoramento de bounces e spam feedback loop, monitoramento por domínio de destino, rate limiting, backoff exponencial, filas persistentes com retries idempotentes, frequência máxima por contato, cota por remetente, verificação de lista de supressão imediatamente antes de cada envio e separação estrita de tráfego comercial, marketing e transacional (sem jamais usar rotação ilícita de domínios/contas para burlar limites).

#### MÓDULO M — SEGURANÇA, GOVERNANÇA E COMPLIANCE
- Arquitetura multiusuário e multiempresa/tenant com isolamento de dados, RBAC granular (administrador, marketing, vendas, gestor, auditor), MFA obrigatório para operações administrativas, OAuth seguro, segredos em Secret Manager, trilha de auditoria encadeada (SHA-256), criptografia em trânsito e em repouso, políticas de retenção/backup/restauração testada, aprovação de campanhas, proteção contra importação de listas sem base legal e conformidade integral com **LGPD, GDPR e CAN-SPAM**.

---

### 9.5. Experiência do Usuário, Menu Principal (16 Módulos) & Dashboard Email & Sales Engagement

- **Menu Principal da Plataforma de Email & Sales Engagement (16 Itens)**:
  1. Dashboard
  2. Contatos
  3. Empresas
  4. Audiências e Segmentos
  5. Campanhas
  6. Cadências
  7. Automações
  8. Templates
  9. Central de Engajamento
  10. Caixa de Entrada Comercial
  11. Relatórios
  12. Lead Scoring
  13. Integrações
  14. Entregabilidade
  15. Administração
  16. Configurações
- **Painel Consolidado `Email & Sales Engagement` (Referência Operacional Seta Telecom — Últimos 30 dias)**:
  - **KPIs de Topo com Drill-Down**: E-mails enviados (`12.450`), Taxa de resposta (`8,4%`), Contatos engajados (`1.280`), Descadastros (`37`).
  - **Funil de Engajamento Conectado ao CRM**: `Enviados (12.450) → Entregues (12.080) → Cliques únicos (1.620) → Respostas (1.046) → Oportunidades (184)`.
  - **Cadências Ativas**: Prospecção de locação, renovação contratual e spare parts (`24 cadências ativas`), além de receita atribuída, reuniões obtidas, alertas operacionais e pendências comerciais.

---

### 9.6. Arquitetura de Software & Schema Completo de Banco de Dados (37 Entidades)

- **Stack Arquitetural**:
  - **Frontend**: React 19, Next.js (App Router), TypeScript, Tailwind CSS, componentes acessíveis e construtor visual de fluxos/templates.
  - **Backend & Processamento**: Serviços modulares em TypeScript, APIs REST + OpenAPI, workers independentes, scheduler persistente (nunca dependente apenas de memória volátil), motor de workflows durável, webhook inbox/outbox com deduplicação de eventos, execução idempotente e Dead-Letter Queues (DLQ).
  - **Dados & Infraestrutura Cloud**: PostgreSQL (Cloud SQL / Neon), Redis para filas/rate-limiting, Object Storage, Secret Manager, Cloud Run stateless + Cloud Tasks/PubSub e ambientes isolados (`dev`, `staging`, `prod`).
- **Schema Relacional Completo (37 Tabelas/Entidades Obrigatórias)**:
  1. `Users`
  2. `Roles`
  3. `Organizations`
  4. `Contacts`
  5. `Companies`
  6. `ContactProperties`
  7. `Audiences`
  8. `Segments`
  9. `Tags`
  10. `ConsentRecords`
  11. `SubscriptionPreferences`
  12. `SuppressionEntries`
  13. `EmailAccounts`
  14. `SendingDomains`
  15. `EmailTemplates`
  16. `TemplateVersions`
  17. `Campaigns`
  18. `CampaignRecipients`
  19. `EmailMessages`
  20. `EmailEvents` (imutáveis / append-only auditáveis)
  21. `MessageLinks`
  22. `Sequences`
  23. `SequenceSteps`
  24. `SequenceEnrollments`
  25. `EnrollmentEvents`
  26. `Workflows`
  27. `WorkflowVersions`
  28. `WorkflowExecutions`
  29. `WorkflowEvents`
  30. `SalesTasks`
  31. `Meetings`
  32. `CRMEvents`
  33. `IntegrationConnections`
  34. `WebhookDeliveries`
  35. `Reports`
  36. `LeadScores`
  37. `AuditLogs`

---

### 9.7. Funcionalidades Complementares Auditadas (Seção 7)

Inclui suporte planejado e auditado para: Formulários de captura, Landing pages, Preference center, Double opt-in, Campanhas RSS, Fluxos de boas-vindas, Fluxos de aniversário, Reativação de clientes, Nutrição de leads, Lead routing, Notificações de engajamento comercial, Sincronização bidirecional de calendários, Tracking de links, UTMs, Conversion tracking, Atribuição de receita, Pesquisa de satisfação (CSAT/NPS), Webhooks públicos, API externa, Templates transacionais, Gerenciamento de anexos permitido, Caixa de entrada compartilhada, Respostas automáticas, Classificação de respostas, Permissões de marca/departamento, Frequência máxima de comunicação (*frequency cap*), Regras de exclusão entre campanhas, Testes de renderização, Análises por cliente de e-mail, Higienização de base, Gestão de contatos inativos, Regras de arquivamento, Monitoramento de custo por envio, Gestão de limites/cotas, Alertas de falha de integração, Webhooks de conversão, Canais adicionais mediante consentimento (SMS/WhatsApp), Gestão de fuso horário, Suporte multilíngue, Campanhas recorrentes, Calendário de campanhas, Aprovação multiusuário e Monitoramento de disponibilidade.

---

### 9.8. Plano de Implementação Progressiva em 6 Fases

- **Fase 1 — Fundação (Implementada & Homologada em Ambiente Isolado)**:
  - Auditoria do repositório, matriz de paridade HubSpot × Mailchimp × STI-hub, arquitetura e modelos de dados, RBAC/MFA, gestão de contatos/empresas, captura web com **rastreamento UTM fim a fim**, **Consentimento LGPD / Preference Center / Supressão independente das cadências**, persistência real de **Campanhas, Segmentos Dinâmicos e Landing Pages** e **Visão de Engajamento por Empresa (ABM)**.
- **Fase 2 — Cadências Comerciais Avançadas**:
  - Editor visual multi-passos, agendamento persistente considerando dias úteis/fuso horário, integração OAuth Microsoft Graph (Outlook 1:1), todas as 13 regras de saída automática (incluindo vínculo com propostas de locação e etapas do Deal) e histórico/relatórios de conversão.
- **Fase 3 — Campanhas de Email Marketing & Editor Visual**:
  - Editor drag-and-drop de templates com versionamento/aprovação, adaptadores multi-ESP (SES/SendGrid/Mailgun/Postmark/Resend), validação SPF/DKIM/DMARC e funil completo de entregabilidade.
- **Fase 4 — Automações Visuais (Workflows Duráveis)**:
  - Construtor DAG completo com os 20 gatilhos e 17 ações, ramificações condicionais/percentuais, simulação de fluxo, detecção de loops e execução durável idempotente.
- **Fase 5 — Analytics, Engajamento Humano vs MPP & Drill-Down Total**:
  - Resposta direta às 20 perguntas de identificação com drill-down para os contatos, diferenciação entre abertura observada (Apple MPP) e engajamento humano confirmado, coortes e exportação CSV/XLSX/PDF.
- **Fase 6 — Recursos Avançados & Enterprise**:
  - IA Comercial e Marketing Intelligence com nível de confiança e aprovação humana, testes A/B/multivariados com significância estatística e otimização preditiva de horário de envio.

---

### 9.9. Critérios de Aceite (12 Requisitos) e 14 Cenários Obrigatórios de Teste

- **12 Requisitos de Conclusão por Funcionalidade**: (1) Interface funcional, (2) Backend implementado, (3) Persistência real, (4) Controle de acesso RBAC, (5) Validação de entrada, (6) Tratamento de erro, (7) Testes unitários, (8) Testes de integração, (9) Testes E2E, (10) Logs e observabilidade, (11) Documentação e (12) Evidência verificável de funcionamento.
- **14 Cenários de Teste Específicos**:
  1. Resposta recebida durante cadência (`PAUSED_ON_REPLY` imediato).
  2. Descadastro antes de disparo (bloqueio pré-envio).
  3. Bounce durante campanha (atualização de entregabilidade e supressão).
  4. Mudança de etapa comercial (saída/transição automática de cadência).
  5. Reprocessamento idempotente de webhooks.
  6. Prevenção de envio duplicado.
  7. Fallback/tratamento em falha de provedor de e-mail.
  8. Recuperação segura em falha de worker.
  9. Retomada de agendamento após reinício de serviço durante espera.
  10. Versionamento seguro na edição de sequência ativa.
  11. Isolamento entre dois workflows concorrentes.
  12. Integridade referencial na exclusão ou alteração de contatos.
  13. Tratamento de falha na sincronização de CRM.
  14. Bloqueio absoluto de tentativa de envio de marketing a contato suprimido/descadastrado.

---

### 9.10. Regras de Execução (17 Diretrizes) e Entrega Inicial Obrigatória

- **Regras de Execução**: (1) Inspecionar código existente antes de criar estruturas novas; (2) Reutilizar componentes/serviços; (3) Evitar duplicação; (4) Mudanças modulares; (5) Preservar dados existentes; (6) Não alterar produção sem autorização; (7) Não reutilizar credenciais revogadas; (8) Usar ambientes isolados para testes; (9) Nunca enviar campanhas reais durante homologação; (10) Usar contatos sintéticos/autorizados; (11) Registrar decisões arquiteturais; (12) Criar testes automatizados; (13) Gerar documentação técnica; (14) Informar bloqueios reais; (15) Não declarar concluído sem evidência; (16) Implementar progressivamente as fases aprovadas; (17) Exigir autorização para operações externas ou disparos reais.
- **10 Entregáveis da Entrega Inicial Obrigatória**: (1) Auditoria do repositório e infraestrutura; (2) Matriz detalhada HubSpot × Mailchimp × STI-hub; (3) Lista de funcionalidades ausentes; (4) Arquitetura proposta; (5) Modelo inicial de banco de dados; (6) Backlog priorizado por dependência e valor comercial; (7) Critérios de aceite da Fase 1; (8) Plano de migração sem perda de histórico; (9) Riscos e dependências; (10) Primeira implementação funcional em ambiente isolado.

---

## 10. Infraestrutura de E-mail: Resend (Transacional) + Provedor Próprio de E-mail Marketing (aprovado por Marcéllo em 29/10/2026)

> Item solicitado pelo Marcéllo via CISO em 29/10/2026. Regra de roteamento: **transacional sempre pela Resend; marketing sempre pelo servidor próprio**, para que a reputação de campanhas nunca afete o 2FA, convites, boletos e NF.

### 10.1. Curto prazo (agora) — Resend como provedor transacional
- [ ] Resend para convites, OTP 2FA, boletos e NF.
- [ ] Subdomínio dedicado `notificacoes.setatelecom.com.br` com SPF, DKIM e DMARC.
- [ ] Variável `RESEND_API_KEY` na Vercel (em configuração pelo CISO em 29/10) e `RESEND_FROM_EMAIL` apontando para o subdomínio.
- [ ] Plano Free agora; migrar para o Pro (US$ 20/mês) quando o faturamento (boletos/NF) começar.

### 10.2. Médio prazo — Provedor PRÓPRIO de e-mail marketing (substitui o HubSpot, que será aposentado)
- [ ] MTA open-source (**Postal** ou **Mailcow**) em IP próprio da Seta, com rDNS, SPF, DKIM e DMARC.
- [ ] Subdomínio separado `news.setatelecom.com.br`.
- [ ] Aquecimento gradual do IP e monitoramento de blocklists.
- [ ] Tratamento de bounces e reclamações (FBL).
- [ ] Descadastro com `List-Unsubscribe` (e one-click), com consentimento e opt-out registrados conforme a LGPD.
- [ ] No STI-hub: módulo de campanhas e roteamento por tipo de envio (transacional → Resend; marketing → servidor próprio).
- [ ] Responsáveis: campanhas e listas com **CRM - Marketing & Leads**; revisão de segurança e LGPD obrigatória com o **CISO** antes de iniciar.
- [ ] Plano de saída do HubSpot (Portal `#4369067`): migração de contatos, listas, consentimentos e histórico de envios.

## Próxima Etapa Planejada (Backlog de Integração ERP -> CRM)

- [ ] **[AGUARDANDO DEFINIÇÃO DE REGRAS COM O MARCÉLLO ANTES DE IMPLEMENTAR] — Opção de criar/espelhar Negócio (Deal) no CRM ao criar uma Proposta Comercial no ERP:**
  - **Diretriz do Marcéllo (`[t58u]`):** *"Ao criar uma proposta no ERP, ter a opção de criar no CRM, deixe isso no roadmap e me pergunte antes de criar para mais regras."*
  - **Status:** Registrado no Roadmap e **bloqueado para implementação até alinhamento prévio das regras de negócio com o Marcéllo** (ex.: em qual pipeline e etapa o Deal deve nascer, quando criar ou vincular a um Deal já existente, mapeamento de valores/MRR e gatilhos de atualização).
