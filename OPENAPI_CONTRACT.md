# AGENTS.md — HubSpot Pro CRM (`/workspace/hubspot-pro-crm`)

> Documento de sincronização arquitetural entre **Atlas (Backend, Banco de Dados & Motores Inteligentes)** e **Nova (Frontend & UX/UI)** sob coordenação do **Geral**.

---

## 1. Diretório Oficial & Autonomia
- **Caminho Principal**: `/workspace/hubspot-pro-crm` (com symlink compatível em `/workspace/crm-hubspot-pro`).
- **Stack Full-Stack**: TypeScript + Next.js 14 App Router (`src/app/...`) + Tailwind CSS + Lucide Icons + Persistência transacional local em arquivo (`.data/crm-store.json`) + Schema Prisma documentado (`prisma/schema.prisma`) pronto para PostgreSQL.
- **Seed Realista**: O banco inicializa automaticamente populado com empresas B2B reais (Nubank, TOTVS, VTEX, RD Station, Creditas, Asaas, Loggi, Horizon Digital), contatos C-Level/Diretores, casos reais de duplicidade (exata e fuzzy), registros incompletos, e-mails descartáveis, contatos obsoletos (>90 dias), negócios em todos os estágios do funil (incluindo *deal rotting*), workflows ativos e cadências de e-mail multi-etapas.

---

## 2. Estrutura de Diretórios
```text
/workspace/hubspot-pro-crm/
├── prisma/
│   └── schema.prisma                         # Modelagem completa PostgreSQL/Prisma
├── src/
│   ├── db/
│   │   ├── types.ts                          # Interfaces e contratos TypeScript compartilhados
│   │   ├── seed.ts                           # Dataset realista B2B inicializado automaticamente
│   │   └── repository.ts                     # Camada de persistência (getRepository / createInMemoryRepository)
│   ├── modules/
│   │   ├── data-health/
│   │   │   ├── validators.ts                 # E-mail, Telefone E.164 (+55), CNPJ Mod-11 e Domínio Corporativo
│   │   │   ├── completeness.ts               # Score ponderado 0-100 de Contatos e Empresas
│   │   │   ├── deduplication.ts              # Levenshtein + Jaro-Winkler + Correspondência Exata + Plano de Merge
│   │   │   └── health-service.ts             # Diagnóstico Global (0-100), Deal Rotting, Merge & Auto-Clean
│   │   ├── enrichment/
│   │   │   └── enrichment-service.ts         # Enriquecimento por domínio corporativo, Lead Score & Next Best Action
│   │   ├── workflows/
│   │   │   └── workflow-engine.ts            # Gatilhos, condições e ações com auditoria WorkflowExecution
│   │   ├── sequences/
│   │   │   └── sequence-service.ts           # Cadências multi-etapas com pausa automática ao responder (PAUSED_ON_REPLY)
│   │   └── ai-insights/
│   │       └── ai-insights-service.ts        # IA Analista de Funil e Base (Gargalos, Risco, Forecast, Oportunidades)
│   ├── api/
│   │   ├── router.ts                         # Roteador unificado consumido pelo Next.js e testes
│   │   └── server.ts                         # Servidor HTTP standalone opcional
│   └── app/
│       ├── api/                              # Next.js App Router API Routes (/api/*)
│       ├── layout.tsx                        # Layout raiz
│       └── page.tsx                          # Página principal (pronta para a Nova construir a interface completa)
└── tests/
    └── crm.test.ts                           # Suíte de testes automatizados (npm test)
```

---

## 3. Contrato Completo das APIs REST (`/api/*`)

### 3.1 Contatos (`/api/contacts` & `/api/contacts/[id]`)
- `GET /api/contacts?search=&lifecycleStage=&companyId=&minScore=`
  - Retorna `{ data: Contact[], total: number }` (cada contato já traz `company`, `leadScore`, `completenessScore`, `nextBestAction`, `isValidEmail`, `isValidPhone`).
- `POST /api/contacts`
  - Payload: `{ email, firstName, lastName?, phone?, jobTitle?, lifecycleStage?, companyId? }`
  - Calcula completude, Lead Score, `nextBestAction` e dispara automaticamente os workflows `CONTACT_CREATED` e `SCORE_THRESHOLD`.
- `GET /api/contacts/:id`
  - Retorna contato detalhado + `company`, `deals`, `timeline` e `completenessDetail`.
- `PATCH /api/contacts/:id` / `DELETE /api/contacts/:id`

### 3.2 Empresas (`/api/companies` & `/api/companies/[id]`)
- `GET /api/companies?search=&industry=`
  - Retorna `{ data: Company[], total: number }` com `contactsCount`, `dealsCount` e `totalDealValue`.
- `POST /api/companies`
  - Payload: `{ name, domain?, cnpj?, industry?, size?, annualRevenue?, city?, state? }`
- `GET /api/companies/:id` / `PATCH /api/companies/:id` / `DELETE /api/companies/:id`

### 3.3 Funil de Vendas: Negócios & Pipelines (`/api/deals` & `/api/pipelines`)
- `GET /api/deals?pipelineId=&stageId=&status=`
  - Retorna `{ data: Deal[], total: number, forecast: { totalOpenValue, weightedOpenValue, closedWonValue, rottingDealsCount } }`.
  - Cada negócio inclui `stageName`, `daysInactive`, `isRotting`, `weightedValue`, `contact` e `company`.
- `POST /api/deals`
  - Payload: `{ title, value, stageId?, contactId?, companyId?, expectedCloseDate? }`
- `PATCH /api/deals/:id`
  - Ao alterar `stageId`, atualiza automaticamente a probabilidade padrão da etapa, registra `STAGE_CHANGE` na Timeline e aciona workflows `DEAL_STAGE_CHANGED`.
- `GET /api/pipelines`
  - Retorna os pipelines com seus `stages` ordenados e os negócios agrupados por coluna do Kanban (`dealsCount`, `totalValue`, `weightedValue`, `deals`).

### 3.4 Timeline & Atividades (`/api/timeline`)
- `GET /api/timeline?contactId=&companyId=&dealId=&type=`
- `POST /api/timeline`
  - Payload: `{ type: 'NOTE' | 'EMAIL' | 'CALL' | 'TASK' | 'MEETING', title, body?, contactId?, companyId?, dealId?, actor? }`

### 3.5 Workflows de Automação (`/api/workflows` & `/api/workflows/trigger`)
- `GET /api/workflows` -> Retorna `{ data: Workflow[], executions: WorkflowExecution[], total: number }`.
- `POST /api/workflows` -> Cria novo workflow ou dispara execução se enviado `{ action: 'TRIGGER', triggerType, entityType, entityId }`.
- `PATCH /api/workflows/:id` -> Ativa/desativa (`isActive`) ou edita passos do workflow.
- `POST /api/workflows/trigger` -> Dispara avaliação manual/evento `{ triggerType, entityType, entityId }`.

### 3.6 Cadências de E-mail Marketing & Follow-up (`/api/sequences`)
- `GET /api/sequences`
  - Retorna `{ data: EmailSequence[], enrollments: SequenceEnrollment[], total: number }` com métricas de `sentCount`, `openCount`, `clickCount`, `replyCount`, `openRate`, `clickRate`, `replyRate`.
- `POST /api/sequences`
  - Criar cadência: `{ name, description, category, steps: [...] }`
  - Inscrever contato: `{ action: 'ENROLL', sequenceId, contactId, dealId? }`
  - Avançar etapa: `{ action: 'ADVANCE_STEP', enrollmentId }`
  - Registrar abertura/clique/resposta: `{ action: 'REPLY' | 'OPEN' | 'CLICK', enrollmentId, replySnippet? }`
  - **Regra Crítica**: Quando `action: 'REPLY'`, a inscrição muda imediatamente para `PAUSED_ON_REPLY`, limpa `nextStepDueAt = null`, eleva o Lead Score do contato e registra a resposta na Timeline!

### 3.7 Saúde e Higienização da Base (`/api/data-health/*`)
- `GET /api/data-health/summary`
  - Retorna `DataHealthSummaryReport`: `globalHealthScore` (0-100), `statusLabel`, `breakdown` (`completenessHealth`, `validityHealth`, `deduplicationHealth`, `freshnessHealth`), `counts`, `rottingDeals`, `staleRecords` (>90 dias sem atividade), `issues` e `recommendations`.
- `GET /api/data-health/duplicates`
  - Retorna `{ data: { contactDuplicates, companyDuplicates, totalDuplicates } }` com `confidenceScore` (0-100), `matchReasons` e plano completo `suggestedMerge`.
- `POST /api/data-health/merge`
  - Payload: `{ entityType: 'CONTACT' | 'COMPANY', primaryId, duplicateId, fieldOverrides? }`
  - Unifica os registros preservando os campos mais completos, transfere `TimelineEvent` e `Deal` sem perda de histórico e remove a duplicata.
- `POST /api/data-health/auto-clean`
  - Payload opcional: `{ minConfidence?: 80, autoEnrich?: true }`
  - Executa higienização em lote (merge automático de duplicados de alta confiança + padronização E.164/domínio + enriquecimento de incompletos).

### 3.8 Enriquecimento & Smart Data (`/api/enrichment/run`)
- `POST /api/enrichment/run`
  - Payload: `{ contactId?: string, companyId?: string, email?: string, domain?: string, overwrite?: boolean }`
  - Identifica domínio corporativo vs. provedor gratuito, popula dados da empresa e do cargo sem sobrescrever campos manuais, recalcula `completenessScore`, `leadScore` e `nextBestAction`, e grava evento `ENRICHMENT` na Timeline.

### 3.9 IA Analista de Funil e Base (`/api/ai-insights`)
- `GET /api/ai-insights` ou `POST /api/ai-insights` (com `{ question?: string }`)
  - Retorna `AiInsightsReport`:
    - `executiveSummary` (`headline`, `aiConfidenceScore`, `revenueAtRisk`, `unlockableRevenue`, `keyTakeaways`)
    - `funnelBottlenecks` (conversão por etapa, tempo médio, valor estagnado, diagnóstico e recomendação)
    - `atRiskDeals` (`riskScore` 0-100, `riskLevel`, dias sem interação, motivos e ação recomendada)
    - `revenueForecast` (`totalOpenPipelineValue`, `weightedPipelineValue`, `closedWonValue`, `committedForecast`, `optimisticForecast`, `conservativeForecast`, `winRate`, `byStage`)
    - `priorityFollowUps` (contatos e deals priorizados para abordar hoje com sugestão de canal e mensagem)
    - `hiddenOpportunities` (SQLs de alto score ou empresas enriquecidas sem negócio aberto)
    - `analystAnswer` (resposta em linguagem natural à pergunta enviada).
