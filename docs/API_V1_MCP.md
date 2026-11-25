# STI-hub — API v1, MCP remoto, OAuth 2.1 + DCR e chaves de integração (Fase 1 + Fase 2/Lote 1 — leitura ERP/CRM + Lote 2 — escritas reversíveis)

> Status: Fase 1 em produção. **Fase 2 / Lote 1 (somente leitura do ERP e do CRM restante)** na branch `feat/api-v1-erp-lote1` — aguardando revisão do CISO, não publicado.

## Superfícies
| Caminho | Auth | Observação |
|---|---|---|
| `GET/POST/PATCH /api/v1/*` | `Authorization: Bearer stihub_int_…` (chave IAM) ou `stihub_oat_…` (OAuth) | Sem DELETE. RFC 7807 (`application/problem+json`). |
| `GET /api/v1/openapi.json` | Bearer com `openapi:read` **ou** sessão 2FA | OpenAPI 3.1.0 gerado do catálogo de use-cases (Zod). 401 sem auth. |
| `POST /api/v1/erp/sync/run` | `Authorization: Bearer stihub_sync_…` (chave de serviço da sincronização ERP, env da Vercel) | Só dispara a sincronização GestãoClick → STI-hub já existente. Ver seção **Chave de serviço da sincronização ERP**. |
| `POST /api/mcp` | Bearer (chave ou OAuth) | MCP Streamable HTTP (JSON-RPC 2.0): `initialize`, `ping`, `tools/list` (filtrado por escopo+módulo), `tools/call` (auditado). **Sem batch** (array JSON-RPC → 400 `-32600`). 401 traz `WWW-Authenticate … resource_metadata=`. |
| `/.well-known/oauth-authorization-server`, `/.well-known/oauth-protected-resource` | público | RFC 8414 / RFC 9728. |
| `POST /api/oauth/register` | público (rate-limit por IP) | DCR RFC 7591; `client_secret` exibido uma vez (hash no banco). Em produção, `redirect_uri` não-loopback só se casar com `OAUTH_ALLOWED_REDIRECT_HOSTS`. |
| `GET/POST /api/oauth/authorize` | sessão STI-hub 2FA + usuário **ativo** no cadastro vivo | PKCE **S256 obrigatório**; rate-limit por IP (GET e POST); CSRF HMAC vinculado a sessão + cliente + `redirect_uri` + escopos + `code_challenge`; teto vivo (carteira, módulos, alçada RBAC); carteira só `PROPRIOS` ou `TODOS` (sem `EQUIPE`); tela mostra o host da `redirect_uri`, aviso de cliente dinâmico não verificado e destaca escopos `:write`; CSP `form-action` inclui a origem da `redirect_uri`. |
| `POST /api/oauth/token` | cliente (none / secret_post / secret_basic) | `authorization_code`: valida cliente, validade, `redirect_uri` e PKCE **antes** de consumir o código (sem DoS por código interceptado); reuso com cliente+PKCE válidos revoga a concessão. `refresh_token` com rotação e detecção de reuso. Basic malformado ou cliente `none` com Basic → 401 `invalid_client`. |
| `POST /api/oauth/revoke` | cliente | RFC 7009. |
| `GET/POST /api/iam/integration-keys`, `POST /{id}/revoke` | sessão 2FA + `canManageUsersRbac` (middleware + handler) | Segredo exibido uma única vez; só SHA-256 persistido. Escopos limitados à alçada RBAC do dono. Auditoria registra dono (`target_user_id`) e escopos (`details`), nunca segredo/hash. |

## Endpoints v1 / tools MCP
| operationId | Método e caminho | Tool MCP | Escopo |
|---|---|---|---|
| contacts.list / get / create / update | GET `/contacts`, GET/PATCH `/contacts/{id}`, POST `/contacts` | `crm_contacts_*` | `crm:contacts:read|write` |
| companies.* | idem `/companies` | `crm_companies_*` | `crm:companies:read|write` |
| deals.* | idem `/deals` | `crm_deals_*` | `crm:deals:read|write` |
| activities.list / create | GET/POST `/activities` | `crm_activities_*` | `crm:activities:read|write` |
| pipelines.list | GET `/pipelines` | `crm_pipelines_list` | `crm:pipelines:read` |
| tickets.list / get / create / patch | GET/POST `/tickets`, GET/PATCH `/tickets/{id}` | `tickets_*` | `tickets:read|write` |
| tickets.comments.create | POST `/tickets/{id}/comments` | `tickets_comments_create` | `tickets:write` (+ `tickets:internal_notes:write` p/ `visibility=internal`) |
| tickets.queues.list | GET `/tickets/queues` | `tickets_queues_list` | `tickets:read` |

## Fase 2 / Lote 1 — leitura ERP e CRM restante (36 tools, todas `GET`, `readOnlyHint=true`)
Módulo `erp` novo em `moduleAccess` (chave IAM e OAuth; padrão `false`). Toda autorização roda no conector (o `RouterDataPort` usa `TRUSTED_INTERNAL_CONTEXT`, que pula o RBAC de sessão): escopo → módulo do dono → alçada da tela (`erpPermissions`, fallback = preset do papel; valor ausente/desconhecido **nega**) → carteira. Rotas internas lidas só por allowlist (`ALLOWED_READ_PATHS` + chaves de query permitidas).

| Escopo | Alçada exigida do dono | Carteira | Tools (REST `/api/v1/...`) |
|---|---|---|---|
| `erp:dashboard:read` | Propostas VIEW | TODOS | `erp_dashboard_get` (`/erp/dashboard`; KPIs financeiros só com Financeiro VIEW), `erp_sync_status_get` (`/erp/sync-status`; sem credenciais/URL) |
| `erp:proposals:read` | `proposalsQuotesAccess` VIEW | PROPRIOS = vendedor (`sellerUserId`/`sellerEmail`; propostas da conta de serviço visíveis a todos, como no app) | `erp_proposals_list`, `erp_proposals_get`, `erp_proposal_versions_list` (só metadados), `erp_proposal_acceptance_get` |
| `erp:contracts:read` | `rentalContractsAccess` VIEW | PROPRIOS = `sellerName` do dono ou empresa da carteira CRM | `erp_contracts_list`, `erp_contracts_get`, `erp_contract_versions_list` |
| `erp:orders:read` | `stockOsSalesAccess` VIEW | OS/vendas por vendedor/técnico; compras só TODOS | `erp_service_orders_list`, `erp_service_orders_get`, `erp_sales_orders_list`, `erp_purchase_orders_list` |
| `erp:catalog:read` | Propostas, Contratos ou Estoque VIEW | — | `erp_catalog_list`, `erp_catalog_get` (custo/margem `null` sem Financeiro VIEW), `erp_aux_lists_get` |
| `erp:records:read` | Estoque ou Financeiro VIEW | colaboradores: TODOS + SUPER_ADMIN/DIRETORIA | `erp_suppliers_list`, `erp_employees_list` (telefone `phoneMasked` `****1234`) |
| `erp:financial:read` | `financeBanksAccess` VIEW | TODOS | `erp_financial_entries_list`, `erp_financial_dre_get` |
| `erp:banks:read` | Financeiro VIEW **e** `canViewBankBalances=true` | TODOS | `erp_bank_accounts_list` |
| `erp:fiscal:read` | `fiscalIssuanceAccess` VIEW | TODOS | `erp_invoices_list`, `erp_invoices_get` (sem PIX copia-e-cola/linha digitável), `erp_fiscal_settings_get` (DTO allowlist: `cscConfigured` booleano; sem CSC, tokenId, CNPJ do certificado, lista autXML) |
| `crm:tasks:read` | Contatos, Empresas ou Negócios VIEW | responsável ou vínculo na carteira | `crm_tasks_list`, `crm_tasks_get` |
| `crm:automation:read` | Marketing VIEW | execuções filtradas por entidade da carteira | `crm_sequences_list`, `crm_workflows_list`, `crm_workflows_get`, `crm_workflow_runs_list` |
| `crm:marketing:read` | Marketing VIEW | — | `crm_marketing_campaigns_list`, `crm_marketing_forms_list`, `crm_marketing_segments_list` (sem `matchedContactIds`) |
| `crm:analytics:read` | Negócios VIEW | TODOS | `crm_insights_get` (`/analytics/insights`) |
| `crm:data_health:read` | Contatos VIEW | TODOS | `crm_data_health_summary_get`, `crm_data_health_duplicates_list` (só ids, rótulos, score, motivos) |

Erros novos: 403 `OWNER_ACCESS_INSUFFICIENT` (alçada), 403 `PORTFOLIO_ALL_REQUIRED` (exige TODOS), 403 `SENSITIVE_DATA_FORBIDDEN` (colaboradores). Fora da carteira → 404 neutro. PUT/DELETE em `/api/v1/erp/*` → 405 (o Lote 2 libera apenas os POST/PATCH da allowlist abaixo).
EQUIPE no ERP = só o dono (o app trata PROPRIOS/EQUIPE como "só os meus" para não-admin).
Consentimento OAuth: escopos do Lote 1 acima do perfil do usuário são **omitidos** e listados como "Não concedidos (acima do seu perfil)"; se nada sobrar → `invalid_scope`. Clientes DCR já registrados mantêm a lista de escopos do registro — o conector do ChatGPT precisa **reconectar/re-registrar** para receber os novos escopos.
Continua fora do conector: DELETE/merge, escrita no ERP fora da allowlist do Lote 2, emissão/baixa fiscal ou financeira, sincronização/credenciais GestãoClick, certificado A1, IAM/admin/usuários, chaves de integração.

## Fase 2 / Lote 2 — escritas reversíveis (31 tools, `POST`/`PATCH`, 9 escopos `:write`)
Branch `feat/api-v1-erp-lote2` (empilhada sobre o Lote 1). Allowlist fechada `LOTE2_WRITE_OPERATIONS` (`use-cases/index.ts`, valida no carregamento) + allowlist de rotas internas `ALLOWED_WRITE_PATHS` e `assertSafeWriteBody` (`data-port.ts`).

| Escopo | Alçada do dono | Tools |
|---|---|---|
| `erp:proposals:write` | Orçamentos EDIÇÃO (não exige `canApproveProposals`) | `erp_proposals_create`, `erp_proposals_update`, `erp_proposal_restore_version` |
| `erp:contracts:write` | Contratos EDIÇÃO | `erp_contracts_create`, `erp_contracts_update`, `erp_contract_restore_version`, `erp_contract_renew` |
| `erp:orders:write` | Estoque/OS/Vendas EDIÇÃO | `erp_service_orders_create`, `erp_service_orders_update`, `erp_service_order_status_change`, `erp_service_order_duplicate`, `erp_service_order_from_ticket` (+ módulo Chamados e `tickets` VIEW), `erp_sales_orders_create/_update`, `erp_purchase_orders_create/_update` (TODOS) |
| `erp:records:write` | Estoque/OS/Vendas ou Financeiro EDIÇÃO + TODOS | `erp_suppliers_create`, `erp_suppliers_update` |
| `erp:catalog:write` | Estoque/OS/Vendas EDIÇÃO + TODOS (custo/margem exigem Financeiro EDIÇÃO) | `erp_catalog_create/_update`, `erp_aux_list_items_create/_update` |
| `erp:financial:write` | Financeiro EDIÇÃO + TODOS | `erp_financial_entries_create/_update` (só ABERTO/ATRASADO) |
| `crm:tasks:write` | Contatos/Empresas/Negócios EDIÇÃO | `crm_tasks_create`, `crm_tasks_update`, `crm_tasks_complete` |
| `crm:automation:write` | Marketing/Automação EDIÇÃO | `crm_sequences_create_draft`, `crm_workflows_create_draft`, `crm_workflows_update_draft` |
| `crm:marketing:write` | Marketing/Automação EDIÇÃO | `crm_marketing_campaigns_create_draft` |

Regras:
- **Idempotency-Key obrigatória** em toda criação (e em `renew`/`duplicate`/`from-ticket`): sem chave → **428** `IDEMPOTENCY_KEY_REQUIRED` (REST) ou `isError` (MCP). OpenAPI: `required: true` + `x-idempotency-key-required`.
- **PATCH strict**: campo fora da allowlist → 400; valor mascarado (`***`, `•••`, `[mascarado]`…) → 422 `MASKED_VALUE_REJECTED`; PATCH vazio → 422; id inexistente → 404 (nunca upsert).
- **Nunca**: aprovar/aceitar/converter orçamento (status só RASCUNHO/EM_NEGOCIACAO/RECUSADA; aprovado/convertido → 409 `PROPOSAL_LOCKED`), link público, envio de e-mail, fatura/NF/remessa (`generateNextInvoiceOnSave`, `autoSendEmailOnBilling`, `dunningRuleEnabled` sempre `false`; revisão que faturaria → 409), baixa/pagamento (lançamento pago/vinculado a nota → 409), importar XML (pedido de compra de XML → 409), excluir, ativar/disparar/inscrever (sequence/workflow sempre `isActive=false`, workflow ativo → 409; campanha sempre `PAUSED` com métricas zeradas).
- **Carteira**: orçamentos/contratos/OS/vendas pelo dono (PROPRIOS/EQUIPE); troca de vendedor só com TODOS (403 `OWNER_IMMUTABLE`); desconto acima de `maxDiscountPercent` → 403 `DISCOUNT_ABOVE_LIMIT`. Entidades sem dono (catálogo, listas, fornecedores, compras, financeiro) exigem TODOS.
- **Auditoria**: `details` = `{entity, entityId, op, changedFields, before, after}` só com os campos alterados; e-mail/telefone/documento/links/notas/corpo → `[omitido]`, textos truncados em 160.
- **Consentimento**: escopos `:write` em vermelho ("⚠ ESCRITA"); acima do perfil → "Não concedidos". Clientes DCR antigos precisam reconectar para receber os escopos novos.
- Efeitos do app a conhecer: o histórico interno registra o ator como `Sistema STI-hub`; `from-ticket` passa o chamado ABERTO → EM_ANDAMENTO e adiciona comentário interno (descrição padrão "Chamado <chave>", sem copiar o texto do cliente); o app permite inscrever contato em sequence inativa pela tela (o conector não inscreve).

### Correções do CISO no Lote 2 (25/11/2026)

1. **Situação de pedido de venda/compra**: lista fechada `Em aberto | Em andamento`, comparação sem caixa/acentos (canonicalizada). Faturado/Pago/Aprovado e equivalentes (concretizado, confirmado, concluído, recebido, quitado, emitido…) ⇒ `403 ORDER_STATUS_FORBIDDEN`; outro texto ⇒ `422 ORDER_STATUS_INVALID`; pedido que já saiu das situações iniciais ⇒ `409 ORDER_LOCKED`. A camada de dados recusa de novo (defesa em profundidade).
2. **Posse por ID na escrita**: nome de vendedor/técnico/responsável nunca dá posse para escrever. Vale o ID do dono (campo do registro — `sellerUserId` da proposta/OS/pedido — ou o metadado do conector `api_record_owners`, gravado na criação e na troca de vendedor). ID diferente ⇒ 404 neutro; sem ID ⇒ só carteira TODOS ou controle total do ERP (`403 OWNER_ID_REQUIRED`). Vale para propostas, contratos, OS, pedidos de venda e tarefas do CRM (tarefas: só TODOS).
3. **OS a partir de chamado**: o vendedor é o dono da credencial (ator da integração, `_integrationActorId` só no contexto interno), com `sellerUserId`; a tela continua com o padrão do app. OS já vinculada só é devolvida se estiver na carteira (senão 404).
4. **Marcador da conta de serviço**: texto "Criada por Assistente de Vendas" em qualquer campo ⇒ `422 SERVICE_ACCOUNT_MARKER_FORBIDDEN` (criar/editar/restaurar versão); no conector o marcador em `commercialNotes` não amplia mais a visibilidade (só a flag `createdByServiceAccount`, gravada pelo servidor). Autoria: `sellerUserId` (carteira real) + `api_record_owners` + auditoria.
5. **Contrato** nasce só `EM_IMPLANTACAO` (padrão) ou `PENDENTE_ASSINATURA`.
6. **Idempotência**: a chave é reservada antes de executar (em andamento ⇒ 409). 5xx sem nenhuma escrita interna ⇒ chave liberada (retry retoma); 5xx depois de tentar escrever ⇒ a chave guarda `409 IDEMPOTENCY_PREVIOUS_ATTEMPT_FAILED` (o retry nunca cria um segundo registro).
7. **Update de OS**: `expectedVersion` obrigatória (campo `version` da OS = hash dos campos editáveis); versão diferente ⇒ `409 VERSION_CONFLICT` com `currentVersion`. O corpo enviado ao app leva só os campos alterados.

### Ponto (9) — operações que ampliam o plano (aguardando o ok do Marcéllo)

`erp_service_orders_update` (editar OS), `erp_sales_orders_create` e `erp_sales_orders_update` ficam **desligadas por padrão**: fora do `tools/list`, do OpenAPI e das rotas REST (404/405), e o executor recusa (`404 OPERATION_DISABLED`). Liga com `INTEGRATION_ENABLE_PLAN_EXPANSION_OPS=1`. Para remover de vez: `git revert` do commit do ponto (9) volta a deixá-las ligadas — então, se a resposta for "não", basta **não ligar a flag**, ou apagar as três definições em `use-cases/erp-write.ts` e a lista `PLAN_EXPANSION_OPERATIONS` em `use-cases/index.ts`.

### Correções do CISO no Lote 1 (25/11/2026)

- `erp_dashboard_get`: sem `canViewBankBalances`, `summary.availableBalanceToday` e `summary.bankAccountsSummaryText` saem `null` (`bankBalancesVisible=false`); o restante do financeiro segue a alçada `financeBanksAccess`.
- `crm_insights_get` e `crm_data_health_summary_get`: DTOs fechados (allowlist). Removidos `contactEmail`, `emailOrDomain`, `suggestedMerge`, `description` das issues, `suggestedMessage`/`contactRole`; textos livres passam por máscara de e-mail/telefone (`maskPiiText`). Listas limitadas a 100 itens. `crm_data_health_duplicates_list` não usa mais o e-mail como rótulo.
- `erp_service_orders_list`/`_get` (carteira PROPRIOS/EQUIPE): no máximo 10 páginas (2.000 OS) por chamada; acima disso `422 TOO_MANY_RECORDS` (nunca lista parcial). Cache da varredura por requisição.

## Fase 2 / Lote 3 — operações perigosas em duas etapas (41 operações = 82 tools)
Branch `feat/api-v1-erp-lote3` (empilhada sobre o Lote 2). Allowlist fechada `LOTE3_DANGEROUS_OPERATIONS` (`use-cases/index.ts`) + rotas internas `ALLOWED_DANGEROUS` (`data-port.ts`, método + caminho). Arquivos: `use-cases/dangerous.ts` (framework) e `danger-3a.ts` … `danger-3d.ts`.

**Fluxo obrigatório**: `<tool>_prepare` (POST, `readOnlyHint=true`, não grava) confere escopo, alçada de tela, permissão de ação, carteira e estado, e devolve `{preview, effects, confirmationToken, expiresAt, commitTool}`. `<tool>_commit` (POST, `destructiveHint=true`) exige `confirmationToken` + **argumentos idênticos**, reconfere tudo com o estado vivo e executa. Token `stc_…` (32 bytes), só o SHA-256 no Postgres (`api_confirmation_tokens`), **uso único**, **5 min**, preso a operação + hash canônico dos argumentos + credencial/usuário/autorização efetiva. Erros 409: `CONFIRMATION_INVALID` (inexistente/forjado/outra credencial ou usuário — sem oráculo), `CONFIRMATION_USED`, `CONFIRMATION_EXPIRED`, `CONFIRMATION_ARGS_MISMATCH` (o token é queimado). Rate-limit próprio por credencial (`danger:`; padrão 10/min, `INTEGRATION_DANGEROUS_RATE_LIMIT_PER_MINUTE` 1–120) → 429 `DANGEROUS_RATE_LIMITED`. JSON-RPC batch continua 400. Auditoria `details.op` = delete/merge/send/approve/pay/issue/cancel… com antes/depois sanitizados.

| Escopo (perigoso) | Alçada do dono (fail-closed; guards de papel NÃO contam) | Tools (pares `_prepare`/`_commit`) |
|---|---|---|
| `crm:delete` | `canDeleteCrmRecords` + edição | `crm_contacts_delete`, `crm_companies_delete`, `crm_deals_delete`, `crm_tasks_delete` (carteira) |
| `crm:merge` | `canMergeCrmRecords` + edição | `crm_records_merge` (CONTACT/COMPANY; ambos na carteira; CNPJ diferente → 422) |
| `crm:data_health:write` | `canMergeCrmRecords` + edição + TODOS | `crm_data_health_auto_clean`, `crm_data_health_reassign_orphans`, `crm_enrichment_run` |
| `erp:records:delete` | `canDeleteErpRecords` + edição da área | `erp_proposals_delete`, `erp_contracts_delete` (carteira); `erp_financial_entries_delete`, `erp_catalog_items_delete`, `erp_records_delete`, `erp_bank_accounts_delete` (TODOS; banco só saldo 0 e sem uso); `erp_aux_list_items_delete` (TODOS + controle total do ERP) |
| `comms:send` | edição no CRM (cobrança em lote: Contratos EDIÇÃO) | `comms_email_send` (só a caixa Outlook do próprio dono, ≤10 destinatários, sem anexos), `crm_sequences_enroll` (só cadência ATIVA), `crm_proposal_followup_set`, `erp_contracts_batch_email` |
| `erp:proposals:approve` | Orçamentos EDIÇÃO + `canApproveProposals` | `erp_proposals_approve` (aceite com signatário; converte pela regra do app) |
| `erp:public_links:write` | Orçamentos ou Financeiro EDIÇÃO | `erp_proposals_public_link` (carteira), `erp_invoices_public_link` (TODOS + Financeiro) |
| `crm:automation:activate` | Marketing EDIÇÃO | `automation_workflows_activate` (TODOS), `automation_workflows_trigger` (só workflow ativo; registro na carteira) |
| `crm:marketing:dispatch` | Marketing EDIÇÃO + TODOS | `marketing_campaigns_dispatch` |
| `erp:financial:settle` | Financeiro EDIÇÃO + TODOS | `erp_financial_entries_pay`, `erp_invoices_pay`, `erp_financial_reconcile_ofx` (prévia calculada sem gravar), `erp_financial_import_document`, `erp_purchases_import_xml` (+ Estoque EDIÇÃO) |
| `erp:banks:write` | Financeiro EDIÇÃO + ver saldos + TODOS | `erp_bank_accounts_create`, `erp_bank_accounts_update` |
| `erp:fiscal:issue` | Fiscal EDIÇÃO + `canIssueFiscalDocuments` + TODOS | `erp_fiscal_documents_issue`, `erp_contracts_generate_invoice`, `erp_contracts_generate_remessa`, `erp_contracts_batch_billing` (sem e-mail), `erp_contracts_partial_return` (flags de NF explícitas), `erp_nfe_import_emit` |
| `erp:contracts:readjust` | Contratos EDIÇÃO + TODOS | `erp_contracts_readjust` |
| `erp:fiscal:cancel` | Fiscal EDIÇÃO + `canIssueFiscalDocuments` + TODOS | `erp_fiscal_documents_cancel` (só EMITIDA/VENCIDA, justificativa ≥15), `erp_fiscal_documents_delete` (só CANCELADA, não paga, sem lançamento vinculado) |

Regras:
- **Consentimento OAuth**: escopos perigosos aparecem num bloco "PERIGO" como **caixas desmarcadas** (`grant_<escopo>`); só entram no token se marcados. Só perigosos e nada marcado → `access_denied`. Acima do perfil → "Não concedidos".
- **Chave IAM**: escopo perigoso exige `confirmDangerousScopes: true` (senão 422 `DANGEROUS_SCOPES_CONFIRMATION_REQUIRED`); a tela de IAM precisa enviar esse campo.
- **Ator**: e-mail pela caixa e links públicos usam o dono da credencial como ator (`_integrationActorId`, honrado só no contexto interno; na caixa, só `POST /send`). Demais ações ficam como `Sistema STI-hub` no histórico interno.
- **Fora**: IAM/admin/auth, certificado A1, gravar configurações fiscais, credenciais/config/sincronização GestãoClick, migração HubSpot, cron/portal, conectar caixa, chaves de integração.
- Correção do Lote 2: `erp_aux_list_items_create/_update` agora exigem controle total do ERP (403 `ERP_FULL_CONTROL_REQUIRED`), como a tela.

## Travas
- Catálogo de escopos fechado; bloqueados (rejeitados na criação, ausentes do OpenAPI/MCP): DELETE, merge, escrita de sequências/fiscal/financeiro/ERP, GestãoClick, IAM/admin/RBAC, `*`. Exceção do Lote 1: os 9 escopos `erp:*:read` e `crm:automation:read` (somente GET, allowlist `LOTE1_SENSITIVE_READS` no teste de trava). Exceção do Lote 3: os 14 escopos perigosos, só em pares prepare/commit da allowlist `LOTE3_DANGEROUS_OPERATIONS`.
- `portfolioScope` (PROPRIOS/EQUIPE/TODOS) e `moduleAccess` aplicados no servidor em listagem, busca, GET e mutação; teto = usuário dono ativo (estreitado a cada request). Fora da carteira → 404.
- **Vínculos** (`companyId`, `contactId`, `dealId`) em contatos, negócios e chamados: inexistente **ou** fora da carteira → o mesmo `404` neutro (sem oráculo e sem vínculo cruzado).
- **Alçada RBAC** (`requireOwnerAccess`) por área: contatos, empresas, negócios (inclui pipelines), atividades (por tipo de vínculo, na listagem, no filtro e na criação) e chamados (inclui filas). Alçada ausente → preset restrito do papel; desconhecida → **nega** (fail-closed).
- Chamados: `assignee` no PATCH, com carteira PROPRIOS/EQUIPE, só para usuário ativo da carteira (403 `ASSIGNEE_OUT_OF_PORTFOLIO`).
- SetaDesk: saída via `maskTicketForResponse`; busca via `ticketMatchesSearchServer` (só comentários visíveis); PATCH com allowlist estrita e recusa de valores mascarados (422); comentário interno exige escopo próprio; sem Blob público.
- Rate-limit distribuído em Postgres (`api_rate_limits`): 429 + `X-RateLimit-*` + `Retry-After`. Padrão 120/min por credencial (`INTEGRATION_RATE_LIMIT_PER_MINUTE`), 30/min por IP no OAuth (`INTEGRATION_OAUTH_RATE_LIMIT_PER_MINUTE`), incluindo `authorize`.
- `Idempotency-Key` (REST) / `_meta["stihub/idempotencyKey"]` (MCP): opcional nos POST/PATCH da Fase 1; **obrigatória** nas criações do Lote 2 (428). Replay (`Idempotent-Replayed: true`) e 409 com payload diferente; TTL 24h. Antes de devolver o cache, reautoriza (escopo, dono ativo, teto vivo, alçada). O cache é isolado por credencial + usuário + autorização efetiva (escopos/carteira/módulos), sem replay entre chaves/usuários ou após revogação.
- Sem Postgres **ou com Postgres inacessível** (conexão recusada, DNS, timeout, servidor reiniciando) → **503** `INTEGRATION_STORE_UNAVAILABLE` (problem+json), nunca 500 e sem fallback JSON/tmp. Store em memória só em `NODE_ENV=test` por injeção explícita.
- `/login?next=`: só caminho da mesma origem (`sanitizeLoginNext`): rejeita `//host`, `/\host`, barra invertida, caracteres de controle, URL absoluta e `%2F%2F`; fallback `/`.

## Variáveis de ambiente (produção = `NODE_ENV=production` ou `VERCEL=1`)

- `INTEGRATION_ENABLE_PLAN_EXPANSION_OPS=1`: liga as 3 operações do ponto (9) (padrão: desligadas).
| Variável | Obrigatória | Efeito |
|---|---|---|
| `STI_HUB_PUBLIC_ORIGIN` | **Sim** em produção | Origem https usada como issuer/resource. Ausente ou inválida em produção → rotas de integração respondem 503 `PUBLIC_ORIGIN_NOT_CONFIGURED` (sem confiar no Host). |
| `OAUTH_ALLOWED_REDIRECT_HOSTS` | Recomendada | Lista separada por vírgula de hostnames (`claude.ai`), origens (`https://x:8443`) ou esquemas (`com.app:`) aceitos no DCR em produção. Vazia → só loopback. |
| `OAUTH_ALLOWED_REDIRECT_SCHEMES` | Opcional | Esquemas privados extras aceitos pela validação básica de `redirect_uri`. |
| `ERP_SYNC_SERVICE_KEY` / `ERP_SYNC_SERVICE_KEY_PREVIOUS` | Sim (só production) / opcional | Chave de serviço da sincronização ERP (`stihub_sync_…`). Ausente → `POST /api/v1/erp/sync/run` responde 503. |
| `INTEGRATION_RATE_LIMIT_PER_MINUTE` / `INTEGRATION_OAUTH_RATE_LIMIT_PER_MINUTE` | Opcional | Limites (padrão 120 / 30). |
| `INTEGRATION_DANGEROUS_RATE_LIMIT_PER_MINUTE` | Opcional | Limite das operações perigosas (Lote 3) por credencial (padrão 10, 1–120). |

## Chave de serviço da sincronização ERP (`POST /api/v1/erp/sync/run`)
Uso: rotina diária (Nova) que sincroniza GestãoClick → STI-hub em produção sem sessão humana/MFA.

- **Auth**: somente `Authorization: Bearer stihub_sync_<base64url de ≥32 bytes>`. Cookie/sessão são ignorados. Comparação por SHA-256 + `crypto.timingSafeEqual` nos slots `current` e `previous` (sem curto-circuito).
- **Variáveis**: `ERP_SYNC_SERVICE_KEY` (atual, obrigatória) e `ERP_SYNC_SERVICE_KEY_PREVIOUS` (opcional, só durante a rotação). Tipo *Sensitive*, alvo **production**. Ausente/fora do formato → **503** `ERP_SYNC_KEY_NOT_CONFIGURED` (fail-closed). Em preview não é configurada (503).
- **Escopo mínimo**: a chave **não envia dados de negócio**. Corpo: vazio ou `{ "forceRefresh"?: boolean }` (Zod `.strict()`, padrão `true`); qualquer outro campo → 400. O servidor executa apenas o caso de uso existente `runIncrementalDailySync` (= `POST /api/erp/daily-sync` interno): busca no GestãoClick com as credenciais que já estão no servidor e faz merge não destrutivo/idempotente pelos ids do GestãoClick (empresas/contatos/catálogo/orçamentos/contratos de locação/faturas/lançamentos/fornecedores…), gravando no Postgres pelo pipeline normal do router. Sem leitura de dados (resposta só com contagens), sem IAM/usuários/permissões, sem DELETE. O portador da chave não escolhe rota nem método internos.
  - *Por que não um "ingest" com payload*: aceitar registros prontos permitiria, com uma chave vazada, injetar/alterar cadastros e financeiro em produção. Disparar a coleta no servidor mantém a fonte confiável (GestãoClick) e reduz o raio de dano a "rodar a sync de novo".
- **Métodos**: só `POST`; `GET/PUT/PATCH/DELETE` → 405 (`Allow: POST`).
- **Limites**: corpo ≤ 4 KiB (413); 30 req/min por IP (conta também tentativas sem chave/chave errada, antes da auth) e 6 req/min por chave → 429 + `Retry-After` + `X-RateLimit-*` (tabela `api_rate_limits`). `maxDuration` 60 s.
- **Respostas** (`application/problem+json` nos erros): 200 `{ data: { status, source: "gestaoclick_live", syncedAt, storeId, recordsSynced, counts{…}, durationMs, requestId } }`; 401 (sem/errada); 400; 405; 413; 429; 502 `GESTAOCLICK_UNAVAILABLE` (sem snapshot ao vivo: nada novo importado) ou `ERP_SYNC_FAILED`; 503 (chave não configurada ou Postgres indisponível).
- **Auditoria** (`integration_audit_logs`, `channel=rest_v1`, `auth_type=service_key`, `action=erp_sync.ingest`): IP, status, latência, `error_code`; com auth válida, `key_id=erp_sync:<slot>:<fingerprint>` e `details` com `fingerprint` (8 primeiros hex do SHA-256), `slot`, contagens por entidade, `recordsSynced`, `durationMs`. Falhas de auth também são auditadas (sem fingerprint do valor tentado). Nunca grava a chave, o hash completo, o corpo ou PII.
- **Exemplo**: `curl -X POST https://sti-hub.setatelecom.com.br/api/v1/erp/sync/run -H @<(printf 'Authorization: Bearer %s' "$(cat /home/box/.secrets/erp-sync-service-key)") -H 'Content-Type: application/json' -d '{}'`

### Rotação (sem janela de indisponibilidade)
1. Gerar a nova chave: `node -e "console.log('stihub_sync_'+require('crypto').randomBytes(32).toString('base64url'))" > novo && chmod 600 novo` (não imprimir no terminal compartilhado).
2. Na Vercel (production, Sensitive): copiar o valor **atual** para `ERP_SYNC_SERVICE_KEY_PREVIOUS` e gravar a nova em `ERP_SYNC_SERVICE_KEY`; fazer deploy (env só vale no próximo deploy).
3. Atualizar o cliente (rotina) para a nova chave; conferir na auditoria `slot=current` com o novo fingerprint.
4. Remover `ERP_SYNC_SERVICE_KEY_PREVIOUS` e fazer deploy. Chamadas com a antiga passam a 401.
- Vazamento: trocar `ERP_SYNC_SERVICE_KEY` **sem** preencher `_PREVIOUS` e fazer deploy imediato; revisar `integration_audit_logs` por `action='erp_sync.ingest'`.
- OpenAPI: a rota **não** entra no `openapi.json` (documento é para chaves IAM/OAuth de integração; esta é credencial interna de serviço).

## Tabelas (criadas por `ensurePostgresSchema` → `ensureIntegrationSchema`)
`integration_api_keys`, `api_idempotency_keys`, `integration_audit_logs` (+ `target_user_id`, `details` via `ADD COLUMN IF NOT EXISTS`), `api_rate_limits`, `oauth_clients`, `oauth_auth_codes`, `oauth_tokens`, `api_record_owners` (posse por ID dos registros criados pelo conector). Todos os segredos/tokens/códigos somente como SHA-256.

`integration_api_keys`, `api_idempotency_keys`, `integration_audit_logs` (+ `target_user_id`, `details` via `ADD COLUMN IF NOT EXISTS`), `api_rate_limits`, `oauth_clients`, `oauth_auth_codes`, `oauth_tokens`, `api_confirmation_tokens` (Lote 3). Todos os segredos/tokens/códigos somente como SHA-256.

## Decisões do CISO (fechadas)
1. OAuth não oferece `EQUIPE` (não há lista de equipe no cadastro): teto `TODOS` → `PROPRIOS` ou `TODOS`; teto `EQUIPE`/`PROPRIOS` → só `PROPRIOS`.
2. `Idempotency-Key` permanece **opcional** em POST/PATCH (recomendado para retries).
3. `/login?next=` é respeitado para retomar o `authorize`, com validação estrita de mesma origem.
4. `STI_HUB_PUBLIC_ORIGIN` é obrigatória em produção (falha fechado com 503).

### Lote 3 alinhado à correção CISO do Lote 2 (item 2: posse por ID)

As ações perigosas do Lote 3 que atuam sobre um registro da carteira (excluir tarefa, proposta e contrato; aceite e link público de proposta; cobrança em lote; fatura mensal, remessa, faturamento em lote, devolução e reajuste de contrato) passam a exigir posse por **ID** do usuário dono, como as escritas do Lote 2: carteira `TODOS` segue livre; ID de outro usuário ⇒ 404; registro sem ID dono ⇒ 403 `OWNER_ID_REQUIRED` (contratos/propostas: exceto controle total do ERP). O contrato criado pelo aceite de proposta via conector fica registrado em `api_record_owners` com o ID de quem aceitou.
