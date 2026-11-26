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

## Travas
- Catálogo de escopos fechado; bloqueados (rejeitados na criação, ausentes do OpenAPI/MCP): DELETE, merge, escrita de sequências/fiscal/financeiro/ERP, GestãoClick, IAM/admin/RBAC, `*`. Exceção do Lote 1: os 9 escopos `erp:*:read` e `crm:automation:read` (somente GET, allowlist `LOTE1_SENSITIVE_READS` no teste de trava).
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
`integration_api_keys`, `api_idempotency_keys`, `integration_audit_logs` (+ `target_user_id`, `details` via `ADD COLUMN IF NOT EXISTS`), `api_rate_limits`, `oauth_clients`, `oauth_auth_codes`, `oauth_tokens`. **Fora do boot (migração manual, ver abaixo):** `api_record_owners`. Todos os segredos/tokens/códigos somente como SHA-256.

## Decisões do CISO (fechadas)
1. OAuth não oferece `EQUIPE` (não há lista de equipe no cadastro): teto `TODOS` → `PROPRIOS` ou `TODOS`; teto `EQUIPE`/`PROPRIOS` → só `PROPRIOS`.
2. `Idempotency-Key` permanece **opcional** em POST/PATCH (recomendado para retries).
3. `/login?next=` é respeitado para retomar o `authorize`, com validação estrita de mesma origem.
4. `STI_HUB_PUBLIC_ORIGIN` é obrigatória em produção (falha fechado com 503).

### Parecer do CISO de 26/11 — Lote 1

- `erp_dashboard_get` deixa de usar lista negra: a resposta é o DTO fechado `ErpDashboardDto` (allowlist estrita). Campo novo do painel do app não aparece no conector até ser incluído no DTO. Sem alçada Financeiro, faturado/recebido/pago/fluxo saem `null`; sem `canViewBankBalances`, saldo e texto das contas saem `null`. A série `cashFlowMonthly`/`salesMonthly` do resumo antigo não é exposta (a série mensal vem em `monthly`).
- Leituras fiscais (`erp_invoices_list`, `erp_invoices_get`, `erp_fiscal_settings_get`): exigem alçada Fiscal (VIEW+) do dono **e** carteira TODOS, conferidas a cada chamada (alçada ausente/desconhecida → 403 `OWNER_ACCESS_INSUFFICIENT`; carteira → 403 `PORTFOLIO_ALL_REQUIRED`).
- `erp_fiscal_settings_get` em DTO fechado (`FiscalSettingsDto`, `.strict()`): só ambiente, DANFE simplificado, `cscConfigured` (booleano), padrão NFS-e, quantidade de autorizados do XML, situação do certificado e validade (AAAA-MM-DD). Saíram as séries (NF-e, NFC-e, RPS). Nunca saem certificado A1 (conteúdo/PFX/base64/senha/CNPJ), CSC/ID do token, numeração/próximo número nem credenciais.

### Parecer do CISO de 26/11 — Lote 2
1. **Contrato nunca chega a ATIVO/SUSPENSO pelo conector.** `status` aceito só `EM_IMPLANTACAO`/`PENDENTE_ASSINATURA`; PATCH de status em contrato fora de rascunho → 403 `CONTRACT_STATUS_FORBIDDEN` (também barrado no data-port); `restore_version` que mudaria o status para/de não-rascunho → 403; `renew` só em `ATIVO`/`RENOVACAO_PROXIMA` (não ativa `PENDENTE_ASSINATURA`) → 409 `CONTRACT_RENEW_WOULD_ACTIVATE`.
2. **OS a partir de chamado (tela)** grava o usuário da sessão (`sellerName` + `sellerUserId`); sem sessão, `Sistema STI-hub`. Nome fixo removido do repositório.
3. **CAS atômico.** OS em tabela: `UPDATE … WHERE row_version = $n`. Modo JSON (OS e pedido de venda): a rota confere `_expectedVersion` e grava no mesmo passo síncrono e registra uma pré-condição; dentro da transação do persist, `SELECT payload->'erp'->… FOR UPDATE` reconfere a versão — diferente → ROLLBACK e 409 (`VERSION_CONFLICT` no conector). Pedido de venda: `expectedVersion` obrigatória e `version` exposta na leitura.
4. **Dono imutável.** O gravador de dono só insere (`ON CONFLICT DO NOTHING`; já existe → 409 `OWNER_ALREADY_SET`). Troca só pela mudança de responsável (`owners.transfer`, CAS no dono atual) e exige carteira `TODOS` (senão 403 `OWNER_TRANSFER_FORBIDDEN`).
5. **Tabelas fora do boot.** `api_record_owners` saiu do `INTEGRATION_SCHEMA_SQL`; vive em `src/modules/integration/migrations/api-v1-manual-migration.ts`. Sem a tabela, toda escrita do conector → 503 `MIGRATION_REQUIRED` (falha fechada; leituras seguem).
   - Migração (manual): `npm run db:migrate:api-v1` (dry-run, mostra o que falta) → `npm run db:migrate:api-v1 -- --apply` (transação).
   - Carga inicial de donos: `npm run api-v1:backfill-owners` (dry-run; relatórios em `./backups/api-v1-owners-<data>/`: `plano.json`, `ambiguos-homonimos.json`, `resumo.json`) → revisar → `npm run api-v1:backfill-owners -- --apply`. Idempotente (`DO NOTHING`, pula quem já tem dono). Resolve por ID (sellerUserId/assignedTo) e, na falta, por e-mail/nome **único**; homônimos e não resolvidos vão para o relatório e **não** são atribuídos. Exige a migração aplicada e recusa produção sem `--allow-production` — **não rodar em produção** sem o ok do CISO.
6. **Ponto (9)** segue atrás de `INTEGRATION_ENABLE_PLAN_EXPANSION_OPS` (desligada). Para quando ligar: versão no pedido de venda; OS `Concluída`/`Cancelada` (e finalizada/encerrada/faturada) → 409 `SERVICE_ORDER_LOCKED`; técnico por `technicianUserId`, só usuário ativo, na carteira, com módulo ERP e permissão de OS (422 `TECHNICIAN_INVALID`/`TECHNICIAN_NOT_AUTHORIZED`/`TECHNICIAN_AMBIGUOUS`).
- Risco residual: a troca de dono no registro acontece depois da gravação no app; se a gravação falhar por CAS, o registro não muda (o app também não).
