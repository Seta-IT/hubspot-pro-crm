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
  - Roteiros interativos de descoberta e fechamento telecom/TI (Substituição CAPEX por Locação SV 31 STF, Qualificação PABX IP Cloud/Yealink, Objeções Jurídicas e SLA NOC) com checklist e geração automática de nota estruturada na timeline do negócio.
- **Agendador Executivo de Reuniões (`MEETINGS_SCHEDULER`)**:
  - Links públicos de agendamento (`/reuniao/marcello-mira`, `/reuniao/engenharia-seta`) sincronizados com a agenda comercial e criação automática de evento `MEETING` na timeline.
- **Cadências Automatizadas (`SequencesSection.tsx` / `/api/sequences`)**:
  - Sequências multi-etapas de prospecção outbound e follow-up de propostas com **pausa automática imediata (`PAUSED_ON_REPLY`)** assim que o cliente responde ao e-mail.

---

## 3. Marketing Hub ABM (`MarketingAndSalesHubSuites.tsx` + `FormsBuilderTab.tsx`)

- **Campanhas & Atribuição de ROI Multi-Touch (`CAMPAIGNS_ROI`)**:
  - Gestão de campanhas B2B (ABM Q4 Locação 0% ISS, Modernização PABX IP & Gateways SIP, Webinar SD-WAN & Segurança) com rastreamento de orçamento, sessões, contatos gerados, MQLs, SQLs, negócios atribuídos e **ROI em R$**.
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
| **Construtor visual de automações (DAG / Customer Journeys)** | Sim (Workflows Pro/Ent) | Sim (Automation Flows) | Fase 4 no ramo `feat/fase4-workflows` (DAG durável, simulação, reentrada) | **P0** |
| **Segmentação avançada B2B (ICP, Cargo, CNPJ, Funil, Propostas)** | Sim (Active/Static Lists) | Sim (Advanced Segmentation) | Implementado (`/api/marketing/segments`) | **P0** |
| **Visão de engajamento por Empresa (Account-Based Engagement)** | Parcial (exige ABM/Target Accounts) | Não (centrado em contato) | Implementado (Diferencial Seta Telecom) | **P0** |
| **Cadências vinculadas a propostas de locação/servidores e etapas do Deal** | Parcial (via Workflows adicionais) | Não | Implementado (Diferencial Seta Telecom) | **P0** |
| **Atribuição de Receita fim a fim (Campanha → Proposta → Contrato → Fatura)** | Parcial (Multi-touch no Enterprise) | Parcial (foco em e-commerce B2C) | Implementado (Integrado ao ERP GestãoClick `#118887`) | **P0** |
| **Classificação de sinais (Apple MPP / Bot Click vs Engajamento Humano)** | Parcial (filtro de bot clicks) | Parcial (exclui MPP opcional) | Fase 5 no ramo `feat/fase5-analytics` (motivo gravado por sinal, contadores separados) | **P1** |
| **Central de Preferências, One-Click Unsubscribe e Consentimento LGPD** | Sim | Sim | Implementado (`/api/marketing/preferences`) | **P0** |
| **Editor de e-mail drag-and-drop + texto puro comercial + variáveis** | Sim | Sim | Implementado (Templates/Snippets) + Visual Fase 3 | **P1** |
| **Testes A/B e Multivariados com cálculo de amostra e significância** | Sim (Pro: A/B, Ent: Adaptativo) | Sim (Multivariado no Standard+) | Fase 6 no ramo `feat/fase6-enterprise` (amostra, qui-quadrado/z, vencedor manual ou automático por clique humano) | **P1** |
| **IA Comercial e Marketing Intelligence (com evidência e confiança)** | Sim (Breeze / Content Assistant) | Sim (Intuit Assist) | Copiloto IA + Fase 6 no ramo `feat/fase6-enterprise` (confiança, evidências, aprovação humana, `AI_MARKETING_ENABLED`) | **P1** |
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
- **13 Tipos de Campanhas**: Individuais, Em massa, Newsletters, Segmentadas, Recorrentes, Automatizadas, Nutrição, Reengajamento, Relacionamento, Eventos, Baseadas em comportamento, Aniversário/datas relevantes e Campanhas comerciais vinculadas a produtos e serviços (ex.: Locação SV 31 STF, PABX IP, SD-WAN).
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
  - **Status real (19/11/2026, ramo `feat/fase2-cadencias-graph`, ainda não publicado)**:
    - Pronto: editor de passos, janela comercial e 13 regras de saída (no ar desde 29/10); conexão OAuth do Outlook (no ar desde 09/11).
    - Pronto no ramo: **envio real dos passos de e-mail automáticos pela caixa Outlook do dono da inscrição** (Microsoft Graph `/me/sendMail`), com pixel e links rastreados (`/api/email-track`), registro do e-mail na linha do tempo do contato e evento na timeline da cadência.
    - Antes de cada envio: supressão/descadastro/hard bounce LGPD (`canSendMarketingEmailToContact`), estado da inscrição, negócio ganho/perdido, allowlist de teste, janela de envio (dias úteis, feriados, fuso `America/Sao_Paulo` ou do destinatário) e limite por caixa por hora e por dia.
    - Idempotência por passo (`<inscrição>:<passo>`): o passo é gravado como "enviando" antes da chamada ao Graph; passo enviado nunca sai de novo; envio interrompido vira erro com tarefa para conferir, sem reenviar.
    - Caixa desconectada, conexão expirada ou integração desligada: o passo fica pendente com o motivo, o vendedor recebe uma tarefa e o envio é tentado de novo no próximo dia útil. Falha do provedor: até 3 tentativas, depois erro + tarefa e a cadência segue.
    - Passo de e-mail manual (ou com aprovação manual) vira tarefa do vendedor no modo real.
    - Respostas: o executor lê a Caixa de Entrada do dono (escopo Mail.Read já concedido) e aplica `PAUSED_ON_REPLY`; resposta pedindo descadastro aplica `STOP_REQUESTED`.
    - Trava global entre instâncias da Vercel: lease com expiração na tabela `crm_distributed_locks` (compare-and-set atômico no Postgres) para a execução do cron e uma reserva por passo antes de cada envio; o estado é relido do banco depois de obter a trava. Banco da trava indisponível = nenhum envio.
    - Executor: `GET /api/cron/sequences` (Vercel Cron a cada 15 min em dias úteis, `Authorization: Bearer CRON_SECRET`), no máximo 25 envios por execução.
    - Interruptores: `SEQUENCES_LIVE_SEND` (desligado por padrão = simulação atual), `SEQUENCES_TEST_RECIPIENTS` (homologação), `SEQUENCES_MAX_PER_MAILBOX_HOUR` (padrão 20) e `SEQUENCES_MAX_PER_MAILBOX_DAY` (padrão 100, limitado ao limite diário da cadência). Inscrições antigas ou simuladas nunca passam a enviar ao ligar a flag.
    - Interface: painel "Envio pelo Outlook" no estúdio de cadências com o modo, aviso de caixa não conectada e o status real de cada passo (agendado, enviado, pendente, erro, bloqueado) com o motivo.
    - Falta: sincronizar aberturas e cliques rastreados com os contadores da cadência; relatórios de conversão por passo; `POST /api/marketing/campaigns/dispatch` continua simulado (é da Fase 3).
- **Fase 3 — Campanhas de Email Marketing & Editor Visual**:
  - Editor drag-and-drop de templates com versionamento/aprovação, adaptadores multi-ESP (SES/SendGrid/Mailgun/Postmark/Resend), validação SPF/DKIM/DMARC e funil completo de entregabilidade.
  - **Status real (19/11/2026, ramo `feat/fase3-campanhas`, criado a partir de `feat/fase2-cadencias-graph`, ainda não publicado)**:
    - Pronto no ramo: **envio real de campanhas por ESP** com interface comum de adaptadores. Resend (primeiro, homologável) e SMTP (nodemailer) implementados; SendGrid, Mailgun, Postmark e SES plugáveis com testes de contrato e sem credenciais (SES exige assinador SigV4, ainda não incluído). Um único provedor configurado, sem fallback nem rotação de conta, domínio ou provedor.
    - `POST /api/marketing/campaigns/dispatch`: com `MARKETING_LIVE_SEND` desligado (padrão) segue a simulação atual; ligado, exige modelo **aprovado**, alçada (admin ou controle total do CRM com 2FA) e configuração completa, e só **enfileira** (`mkt_sends`, uma linha por campanha+contato = idempotência).
    - Por e-mail: supressão e consentimento LGPD **por finalidade** (`communicationCategories` precisa conter a finalidade do modelo: `NEWSLETTER_TECNICA`, `EVENTOS_ABM` ou `OFERTAS_COMERCIAIS`), allowlist `MARKETING_TEST_RECIPIENTS`, cabeçalhos `List-Unsubscribe` + `List-Unsubscribe-Post: List-Unsubscribe=One-Click` com token HMAC (`/api/marketing/preferences/unsubscribe/<token>`), link visível de descadastro e endereço físico no rodapé, pixel e links rastreados (`/api/email-track`). Consentimento é conferido de novo na hora do envio.
    - Fila: `GET /api/cron/marketing` (Vercel Cron a cada 5 min, `Bearer CRON_SECRET`) e botão "Processar fila agora"; limite global por minuto (`MARKETING_MAX_PER_MINUTE`, padrão 60) e por execução (`MARKETING_MAX_PER_RUN`, padrão 200); mesma trava global da Fase 2 (`marketing:run`) + reserva `mktsend:<campanha>:<contato>` antes de cada envio; chave de idempotência no ESP. 429/5xx: volta para a fila com espera (até 3 tentativas); 401/403 ou 429 pausam a execução; erro permanente vira falha sem reenvio.
    - Webhook `POST /api/marketing/webhooks/resend` com assinatura Svix (`RESEND_WEBHOOK_SECRET`, tolerância 5 min): entregue, bounce, reclamação, abertura e clique. Hard bounce e reclamação de spam = supressão permanente (`HARD_BOUNCE` / `SPAM_COMPLAINT`, escopo `GLOBAL_ALL`; recadastro não remove). Reentrega do mesmo evento é idempotente.
    - Descadastro: GET mostra só a página de confirmação (scanners de link não descadastram); POST one-click remove só a finalidade; opção "nenhum e-mail de marketing" aplica o descadastro total.
    - Modelos: blocos estruturados (título, parágrafo, botão, imagem, divisor, espaço) com arrastar e soltar para reordenar (HTML5) e botões subir/descer; sem HTML livre (texto escapado, links e imagens só https). Versões imutáveis; fluxo rascunho -> em revisão -> aprovado; quem envia para revisão não aprova; editar um aprovado cria nova versão em rascunho e a versão aprovada continua a única enviável. Envio de teste só para a allowlist, assunto com "[TESTE]".
    - Domínio: verificação SPF (host `send.<domínio>` no Resend), DKIM (seletores `MARKETING_DKIM_SELECTORS`) e DMARC (com herança do domínio organizacional; aviso em `p=none`) só por consulta DNS TXT, em tela; envio real e teste bloqueados se não passar.
    - Funil por campanha: enviados, entregues, bounces, reclamações, aberturas, cliques e descadastros (com taxas), na aba "Funil de entregabilidade" do estúdio de campanhas (E-mail Marketing).
    - Dados fora do `crm_state_v1`: tabelas `mkt_templates`, `mkt_template_versions`, `mkt_sends`, `mkt_events` (criadas sob demanda).
    - Envio interrompido no meio (instância caiu entre a reserva e a confirmação do ESP): após 1 h vira **"para revisar"** com tarefa na fila "Campanhas de Marketing" e alerta na aba do funil; nunca reenvia sozinho. A pessoa escolhe: "saiu" (marca como enviado), "não saiu" (libera um único reenvio com nova reserva) ou descartar.
    - SQL validado em Postgres local descartável (PGlite 0.5 / PostgreSQL 18, `scripts/sql-local/validate-marketing-sql.cjs`): tabelas `mkt_*`, trava `crm_distributed_locks` (corrida de 10 => 1 vencedor) e rastreio. A validação achou e corrigiu um erro antigo em `recordOpen` (parâmetros sem tipo: "operator is not unique") que impedia gravar aberturas no Postgres. `next build` completo sem erros.
    - Falta: assinador SigV4 do SES e webhooks dos demais ESPs (só o do Resend), editor de HTML livre, agendamento de campanha por data/hora, testes A/B, central de preferências completa (hoje: descadastro por finalidade ou total). Fechados na Fase 6: agendamento, testes A/B e central de preferências.
- **Fase 4 — Automações Visuais (Workflows Duráveis)**:
  - Construtor DAG completo com os 20 gatilhos e 17 ações, ramificações condicionais/percentuais, simulação de fluxo, detecção de loops e execução durável idempotente.
  - **Status real (19/11/2026, ramo `feat/fase4-workflows`, criado a partir de `feat/fase3-campanhas`, ainda não publicado)**:
    - Não existiam `WorkflowBuilderTab.tsx` nem `src/app/api/workflows`; o ponto de partida foi `AutomationsSequencesTab.tsx` e as rotas `/api/workflows` do roteador. O motor antigo (linear, síncrono) continua intacto; o novo é um motor DAG separado em `src/modules/workflows/dag/` com tabelas próprias `wf_definitions`, `wf_versions`, `wf_events`, `wf_runs`, `wf_run_steps` (fora do `crm_state_v1`).
    - Construtor visual (aba "Construtor Visual (Fase 4)" em Automações): 20 gatilhos e 17 ações do Módulo D, cartões de passo com arrastar e soltar, ligações Próximo / Sim-Não / caminhos, atrasos, diagrama SVG em camadas, validar, simular, ativar, pausar e histórico de execução por contato. Sem emojis.
    - Validação: ciclos (com o caminho), auto-ligação, nós soltos, saídas desconhecidas, percentuais inteiros somando 100%, propriedades protegidas (LGPD, e-mail, ERP/Chamados não são alteráveis), webhook só https, limites de atraso/espera. Ciclo entre fluxos pela ação de reativação é recusado na ativação; encadeamento limitado a 3 níveis em execução.
    - Ativar exige grafo válido e **simulação da versão atual** com um contato de exemplo (sem efeito; mostra caminho, desvios, esperas com tempo simulado e bloqueios LGPD/flags). Editar cria nova versão; a versão ativa segue até simular e ativar de novo.
    - Reentrada por fluxo: nunca, depois de concluir ou sempre, com intervalo mínimo; nunca duas execuções ativas do mesmo contato no mesmo fluxo.
    - Execução durável: `GET /api/cron/workflows` (Vercel Cron a cada 5 min, `Bearer CRON_SECRET`) com a mesma trava global (`workflows:run`), estado relido do banco, eventos idempotentes por id, execução por evento única (`UNIQUE (fluxo, evento)`), reserva de cada passo (`PK (execução, nó)`) antes de agir. Execução que caiu no meio de uma ação vira **"para revisar"** com tarefa (fila "Automações") e botões "seguir"/"encerrar" no histórico; nunca repete sozinha.
    - Ações de e-mail só pela fila da Fase 3 (modelo aprovado, LGPD por finalidade, `MARKETING_LIVE_SEND`, allowlist, domínio verificado); cadências pela Fase 2. Webhook só para hosts em `WORKFLOWS_WEBHOOK_ALLOWED_HOSTS`, com chave de idempotência e apenas ids no corpo. Nenhuma ação gera fatura/NF nem toca ERP/Chamados.
    - Gatilhos ligados no CRM: contato criado/atualizado, formulário enviado, mudança de etapa, negócio ganho/perdido, e-mail entregue/aberto/clicado (webhook do ESP), tag alterada (pela própria automação), período sem engajamento e data específica (agendados no cron). Demais (lead importado, propostas, resposta, reunião, webhook recebido, evento personalizado) entram por `POST /api/workflows/v2/events` autenticado.
    - Interruptores: `WORKFLOWS_LIVE` (desligado por padrão = só simulação, nenhum evento gravado), `WORKFLOWS_TEST_RECIPIENTS` (homologação), `WORKFLOWS_WEBHOOK_ALLOWED_HOSTS`, `WORKFLOWS_MAX_RUNS_PER_TICK` (200), `WORKFLOWS_MAX_STEPS_PER_RUN` (25), `WORKFLOWS_MAX_EVENTS_PER_TICK` (500).
    - SQL das tabelas `wf_*` validado em Postgres local descartável (PGlite, `scripts/sql-local/validate-workflows-sql.cjs`): 2 execuções simultâneas do cron => 1 execução do fluxo.
    - Falta: gatilhos nativos de propostas/reunião/resposta/importação (hoje via endpoint de eventos), webhook de entrada público assinado, editor de canvas livre (hoje cartões + diagrama), métricas de conversão por caminho do teste A/B, "Aguardar condição" por eventos (hoje por propriedade, conferida a cada 15 min).
- **Fase 5 — Analytics, Engajamento Humano vs MPP & Drill-Down Total**:
  - Resposta direta às 20 perguntas de identificação com drill-down para os contatos, diferenciação entre abertura observada (Apple MPP) e engajamento humano confirmado, coortes e exportação CSV/XLSX/PDF.
  - **Status real (19/11/2026, ramo `feat/fase5-analytics`, criado a partir de `feat/fase4-workflows`, ainda não publicado)**:
    - Aba "Analytics de Engajamento" em Automações (sem emojis): período (horário de Brasília), filtro de registros simulados, cartões com contadores separados (aberturas observadas x automáticas, cliques humanos x de robô, respostas, reuniões/formulários, contatos com engajamento humano confirmado), motivos de classificação, as 20 perguntas com grupos clicáveis e drill-down paginado até a lista de contatos, conversão por passo de cadência, caminhos A/B das automações e coortes.
    - Classificação de cada abertura/clique rastreado (`src/modules/analytics/signal-classifier.ts`), com o motivo gravado em `crm_engagement_signals`: rede Apple (MPP), proxies de imagem (Google/Yahoo/Mimecast), user-agent genérico ou ausente, abertura em menos de 60 s => abertura automática; HEAD, user-agent de scanner/robô, redes de proteção (Microsoft EOP), clique em menos de 30 s após o envio ou rajada em 2 s => clique de robô. Abertura nunca conta como engajamento humano. IP gravado só truncado (/24 ou /48). Faixas extras em `ANALYTICS_PROXY_CIDRS`.
    - Fontes: pixel/links próprios (`/api/email-track`) e cliques do webhook do Resend (user-agent/IP do clique). Clique de robô não dispara mais o gatilho "Link clicado" das automações.
    - Pendências fechadas: Fase 2 — o cron das cadências sincroniza, dentro da mesma trava global, as aberturas observadas e os cliques humanos com os contadores da inscrição e de cada passo (`stepDeliveries[].engagement`); Fase 4 — relatório de conversão por caminho do teste A/B / divisão percentual (execuções, engajamento humano, oportunidades, valor ganho).
    - Receita influenciada somente por leitura: oportunidade criada até 90 dias após um envio (perguntas 15 e 18), contratos de locação ligados ao contato/negócio (pergunta 16, só para quem tem acesso ao ERP) e atribuição linear do valor ganho entre campanhas/cadências dos 90 dias anteriores ao fechamento (pergunta 19). Nada é criado no ERP; sem fatura/NF.
    - RBAC/LGPD: sessão com 2FA, acesso ao CRM e a contatos; escopo Próprios/Equipe vê só os próprios contatos (perguntas, drill-down, relatórios e exportação). Drill-down e exportação sem telefone; contato suprimido sai com e-mail mascarado e o motivo. Exportação CSV (UTF-8, `;`), XLSX e PDF sem dependências novas, com proteção contra fórmulas, limite de 20.000 linhas e registro na auditoria (`ANALYTICS_EXPORT`, sem dados de contato).
    - Rotas: `GET /api/analytics/overview|drill|sequences|workflows|cohorts|contacts/:id/signals`, `POST /api/analytics/export`. Middleware trata `/api/analytics` como módulo CRM.
    - Vercel Cron: verificação somente leitura. O plano não aparece na API, mas a produção já publica com o cron `*/10` (o plano Hobby só aceita crons diários e recusaria a publicação), logo o plano é Pro/Enterprise: limite de 100 crons por projeto e frequência por minuto. Os 6 crons atuais (2 diários, `*/10`, `*/15`, 2 x `*/5`) cabem; não houve consolidação, e as travas globais seguem por cron.
    - SQL validado em Postgres local descartável (PGlite, `scripts/sql-local/validate-analytics-sql.cjs`; o validador aceita vários módulos em `EXTRA`, separados por vírgula).
    - Falta: classificação de aberturas do ESP (o webhook não traz user-agent da abertura), classificação de respostas por IA (hoje por termos, com motivo), cálculo incremental/pré-agregado para volumes grandes (hoje em memória por requisição), lista de faixas de proxies atualizada automaticamente, atribuição por primeiro/último toque.
- **Fase 6 — Recursos Avançados & Enterprise**:
  - IA Comercial e Marketing Intelligence com nível de confiança e aprovação humana, testes A/B/multivariados com significância estatística e otimização preditiva de horário de envio.
  - **Status real (19/11/2026, ramo `feat/fase6-enterprise`, criado a partir de `feat/fase5-analytics`, ainda não publicado)**:
    - Testes A/B e multivariados em campanhas reais (E-mail Marketing > Recursos avançados): variantes de modelo aprovado e/ou assunto (multivariado = assuntos x modelos, até 6 combinações, mesma finalidade LGPD), grupo de teste por percentual com sorteio determinístico, cálculo de amostra mínima (taxa de base histórica de clique humano ou informada; correção de Bonferroni), qui-quadrado entre todas as variantes + teste z da líder contra a segunda. Métrica padrão: clique humano confirmado da Fase 5 (aberturas automáticas/MPP e cliques de robô aparecem só como contadores). Vencedor automático só com amostra mínima e significância, após o prazo mínimo; manual sem significância exige confirmação explícita; prazo máximo sem significância => "aguardando decisão" + tarefa na fila de revisão. O restante da audiência recebe o vencedor pela fila da Fase 3 (consentimento/supressão/allowlist conferidos de novo). Transições por CAS (`mkt_experiments`): um único vencedor e um único envio ao restante mesmo com crons simultâneos. Avaliação no cron de marketing, dentro da trava.
    - Otimização de horário de envio (`src/modules/enterprise/send-time.ts`): melhor horário por contato a partir do engajamento humano dos últimos 180 dias (cliques humanos, respostas, formulários; aberturas nunca contam), com fallback segmento -> base -> padrão (10h em dia útil), sempre dentro da janela comercial em America/Sao_Paulo (`SEND_TIME_WINDOW`, `SEND_TIME_WEEKDAYS`, `SEND_TIME_HOLIDAYS`), com nível de confiança. Opcional no disparo da campanha, no teste A/B e na cadência (envio real da Fase 2: adia uma vez por passo, no máximo 24 h).
    - Agendamento de campanha por data/hora (horário de Brasília, até 180 dias) e cancelamento dos envios agendados ainda não iniciados.
    - IA comercial e de marketing reaproveitando o provedor do Assistente (OmniRoute, `OMNIROUTE_BASE_URL`/`OMNIROUTE_API_KEY`), atrás de `AI_MARKETING_ENABLED` (desligada por padrão): sugestões de assunto, texto, próximo passo e resumo de engajamento da conta, sempre com confiança (mínimo entre a do modelo e a dos dados), evidências determinísticas e limitações. Só dados agregados vão ao provedor (sem nome, e-mail, telefone, empresa ou textos de resposta; e-mail/telefone/CPF/CNPJ removidos de briefings e da resposta); contato suprimido manda só o fato da supressão; resumo da conta exclui o engajamento de suprimidos. Toda sugestão nasce "aguardando aprovação"; nada é enviado, agendado ou alterado pela IA (aprovada, só libera a cópia manual). Auditoria sem conteúdo (`AI_MARKETING_SUGGEST`/`_APPROVE`/`_REJECT`), limite de 20 sugestões por hora por usuário, escopo do vendedor respeitado.
    - Central de preferências completa por finalidade no link assinado do e-mail: caixas por finalidade (e-mail mascarado), salvar remove e adiciona; adicionar registra consentimento (`CONSENTIMENTO_OPT_IN`) e evento na linha do tempo; quem pediu descadastro total não volta pelo link. Descadastro em um clique inalterado.
    - Rotas: `/api/marketing/experiments[/:id[/start|winner|cancel]]`, `/api/marketing/experiments/sample-size`, `/api/marketing/send-time/contact/:id|segment|sequence/:id`, `/api/marketing/campaigns/:id/cancel-scheduled`, `/api/marketing/ai/suggest|suggestions[/:id/approve|reject]`, `/api/marketing/enterprise/status`; disparo real aceita `scheduleAt` e `sendTimeOptimization`. Criar/iniciar/decidir teste, cancelar agendamento e ligar a opção na cadência: admin ou controle total do CRM com 2FA.
    - Testes com provedor de IA simulado (sob `NODE_ENV=test` o cliente real nunca é criado). SQL validado em PGlite (`scripts/sql-local/validate-enterprise-sql.cjs`).
    - Falta: teste adaptativo (bandit), testes A/B dentro das cadências, horário por dia da semana com feriados nacionais automáticos, IA para classificação de respostas e geração de modelos completos em blocos, métricas de custo da IA por usuário.

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

## 11. Lacunas em relação ao HubSpot (registrado em 12/11/2026, pedido do Marcéllo)

Contexto: na reorganização do menu e das configurações no padrão HubSpot (commit bc64740), cada tela existente do sti-hub (CRM e ERP) foi mapeada para o item equivalente do HubSpot. Nenhuma tela existente ficou sem acesso e as permissões (RBAC) não mudaram. Os itens abaixo existem no HubSpot, mas ainda não têm tela no sti-hub, por isso ficaram fora do menu. Status de todos: **Backlog**, cada um depende de pedido do Marcéllo para virar frente de trabalho.

| Área (menu "Mais") | Item do HubSpot | Status |
|---|---|---|
| CRM | Chamadas | Backlog |
| CRM | Reuniões | Backlog |
| CRM | Caixa de entrada (operacional) | Backlog |
| CRM | Snippets | Backlog |
| CRM | Manuais de atividades | Backlog |
| Marketing | Anúncios | Backlog |
| Marketing | Eventos | Backlog |
| Marketing | Marca | Backlog |
| Marketing | Redes sociais | Backlog |
| Conteúdo | Páginas, landing pages, blog e demais itens | Backlog |
| Vendas | Calendar | Backlog |
| Vendas | Agendador de reuniões | Backlog |
| Vendas | Documentos | Backlog |
| Receita | Links de pagamento | Backlog |
| Serviço | Pesquisas de feedback | Backlog |
| Gerenciamento de dados | Modelo de dados | Backlog |
| Desenvolvimento | Desenvolvimento | Backlog |
| Configurações | Privacidade e consentimento, Objetos, Importar e exportar | Backlog |

Já cobertos por telas existentes (não são lacunas): Pontuação de leads (em Segmentos & Lead Scoring), Análise de marketing (em Campanhas), Atividades (em Tarefas).

## 11. Padrão de Interface HubSpot para Registros, Atividades e Configurações (pedido do Marcéllo em 19/11/2026)

Diretrizes do Marcéllo: *"nao tem o botão salvar, veja como funciona no hubspot, usar esse mesmo pardrao para adição de novos itens"* (`[t287u]`), *"ao clicar em notas, tarefas, reunião, mais"* (`[t288u]`), *"veja a tela ao clicar na engrenagem do lado direito superior"* (`[t290u]`) e *"coloque tudo isso no roadmap"* (`[t289u]`).

### 11.1. Painel de associação (Criar novo / Adicionar existente) — em andamento
- [ ] Painel lateral reutilizável para associar Contatos, Empresas, Negócios e Chamados, no lugar dos modais antigos ("Associar contato" sem botão Salvar).
- [ ] Aba **Adicionar existente**: busca no servidor (nome, e-mail, telefone, CNPJ, sem acentos), contador total, ordenação (recentemente adicionados), lista com caixas de seleção "Nome (e-mail)", já associados indicados, paginação com itens por página, rodapé **Salvar** (desabilitado até marcar) e **Cancelar**.
- [ ] Aba **Criar novo**: E-mail, Nome e Sobrenome primeiro; demais campos (telefone, celular, cargo, área, proprietário, site) liberados após nome ou e-mail; botões **Criar**, **Criar e adicionar outro** e **Cancelar**. Se o e-mail buscado não existir, oferecer criar com ele preenchido.
- [ ] Corrigir a busca que não encontrou `valmir.deus@la.nec.com`.

### 11.2. Botões de atividade da ficha (Observação, E-mail, Chamada, Tarefa, Reunião, Mais) — em andamento
- [ ] Janela flutuante base (minimizar, expandir, fechar, Esc fecha, uma aberta por vez, rascunho preservado ao minimizar), ancorada sobre a linha do tempo.
- [ ] **Observação**: "Para" com o registro, editor com formatação, "Associado a N registros", opção "Criar uma tarefa para acompanhar em 2 dias úteis", botão **Criar observação**.
- [ ] **Tarefa**: título, vencimento (padrão 2 dias úteis, 10:00), lembrete, repetição, tipo, prioridade, fila, atribuído a, observações, associações, botão **Criar tarefa**.
- [ ] **Reunião (Programação)**: modal em duas colunas — à esquerda host, título, data, início e fim, participantes, local, lembretes por e-mail, descrição, associações e observação interna; à direita a agenda semanal do usuário (Hoje, setas, ocultar fins de semana, fuso de Brasília). Botões **Agendar reunião** e **Cancelar**.
- [ ] **Mais**: menu com busca e registros manuais — SMS, correio postal, e-mail, chamada, mensagem do LinkedIn, mensagem do WhatsApp e reunião. Avaliar "Reordenar botões de atividade".
- [ ] **E-mail** e **Chamada** no mesmo estilo de janela flutuante.

### 11.3. Central de Configurações pela engrenagem (canto superior direito) — próxima rodada
- [ ] Tela de configurações no padrão HubSpot: menu lateral com busca ("Pesquisar configurações") e grupos **Suas preferências** (Geral, Notificações) e **Gerenciamento de conta** (padrões da conta, usuários e equipes, registro de auditoria, integrações, privacidade e consentimento, segurança, IA, entre outros).
- [ ] **Geral** com abas Perfil, E-mail, Chamadas, Calendário, Tarefas, Segurança e Automação. Perfil: foto, nome, sobrenome, idioma, formato de data/hora/número (Brasil) e telefone, valendo só para o usuário.
- [ ] Reaproveitar a Central de Administração existente (seção 7) e o RBAC; nada de "Upgrade".

### 11.4. Assistente de IA — próximas funcionalidades (etapa 2)
- [x] Consultar e editar propostas pelo número (no ar em 19/11/2026, main 1805460), incluindo as importadas do ERP de origem, com alteração só no STI-hub.
- [ ] Propostas: gerar PDF, enviar, aprovar e converter.
- [ ] Contratos e vendas: criar, editar e encerrar.
- [ ] Faturas: lançar, dar baixa e cobrar; nota fiscal e recibo (NF depende da homologação do Fiscal).
- [ ] CRM: empresas, contatos, negócios e etapas.
- [ ] Chamados e OS: atualizar, comentar, atribuir e fechar.
- [ ] Responder clientes (e-mail e WhatsApp) e relatórios avançados.
- [ ] **Próxima rodada** (Marcéllo, `[t291u]`: *"A IA funcionou, mas precisa aprimorar, pedir detalhes de configurações para adiconar no campo detalhes"*): ao montar proposta ou item, perguntar os detalhes de configuração que faltarem (ex.: processador, memória, discos, RAID, fonte, garantia, sistema operacional) e gravá-los no campo **Detalhes** do item.
- [ ] **Próxima rodada** (Marcéllo, `[t291u]`: *"manter um historico das conversas assim posso continuar em determinda conversa e ter mais de uma conversa em andamento, isso deve ser separado por USER"*): histórico de conversas salvo no banco, separado por usuário (cada um vê só as suas), lista de conversas com título e data, nova conversa, retomar qualquer uma, várias em andamento; respeitar LGPD (retenção e exclusão pelo próprio usuário).

### 11.5. Ressalvas do CISO (19/11/2026)
- [ ] PATCH geral de propostas: bloquear edição de campos em Aprovada, Convertida e Recusada (incluir RECUSADA em `PROPOSAL_LOCKED_STATUSES`).
- [ ] Allowlist do PATCH: não aceitar `code`, `companyCnpj` nem totais vindos do cliente.
- [ ] Pílulas da busca global respeitarem `moduleAccess`.
- [ ] Remanescentes da troca de nomes: "GestãoClick" no painel em tempo real do ERP e parêntese faltando em Contatos & Empresas (em andamento); confirmar SKU de fallback `ITEM-n` na proposta pública.

## Próxima Etapa Planejada (Backlog de Integração ERP -> CRM)

- [ ] **[AGUARDANDO DEFINIÇÃO DE REGRAS COM O MARCÉLLO ANTES DE IMPLEMENTAR] — Opção de criar/espelhar Negócio (Deal) no CRM ao criar uma Proposta Comercial no ERP:**
  - **Diretriz do Marcéllo (`[t58u]`):** *"Ao criar uma proposta no ERP, ter a opção de criar no CRM, deixe isso no roadmap e me pergunte antes de criar para mais regras."*
  - **Status:** Registrado no Roadmap e **bloqueado para implementação até alinhamento prévio das regras de negócio com o Marcéllo** (ex.: em qual pipeline e etapa o Deal deve nascer, quando criar ou vincular a um Deal já existente, mapeamento de valores/MRR e gatilhos de atualização).
