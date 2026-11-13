# STI-hub — API v1, MCP remoto, OAuth 2.1 + DCR e chaves de integração (Fase 1 — backend)

> Status: em revisão do CISO (branch `feat/api-v1-mcp`). Não publicado.

## Superfícies
| Caminho | Auth | Observação |
|---|---|---|
| `GET/POST/PATCH /api/v1/*` | `Authorization: Bearer stihub_int_…` (chave IAM) ou `stihub_oat_…` (OAuth) | Sem DELETE. RFC 7807 (`application/problem+json`). |
| `GET /api/v1/openapi.json` | Bearer com `openapi:read` **ou** sessão 2FA | OpenAPI 3.1.0 gerado do catálogo de use-cases (Zod). 401 sem auth. |
| `POST /api/mcp` | Bearer (chave ou OAuth) | MCP Streamable HTTP (JSON-RPC 2.0): `initialize`, `ping`, `tools/list` (filtrado por escopo+módulo), `tools/call` (auditado). 401 traz `WWW-Authenticate … resource_metadata=`. |
| `/.well-known/oauth-authorization-server`, `/.well-known/oauth-protected-resource` | público | RFC 8414 / RFC 9728. |
| `POST /api/oauth/register` | público (rate-limit por IP) | DCR RFC 7591; `client_secret` exibido uma vez (hash no banco). |
| `GET/POST /api/oauth/authorize` | sessão STI-hub 2FA | PKCE **S256 obrigatório**; consentimento com CSRF HMAC; escolha de carteira ≤ carteira do usuário. |
| `POST /api/oauth/token` | cliente (none / secret_post / secret_basic) | `authorization_code` (+PKCE) e `refresh_token` com rotação e detecção de reuso (revoga a família). |
| `POST /api/oauth/revoke` | cliente | RFC 7009. |
| `GET/POST /api/iam/integration-keys`, `POST /{id}/revoke` | sessão 2FA + `canManageUsersRbac` (middleware + handler) | Segredo exibido uma única vez; só SHA-256 persistido. |

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

## Travas
- Catálogo de escopos fechado; bloqueados (rejeitados na criação, ausentes do OpenAPI/MCP): DELETE, merge, sequências, fiscal/financeiro, GestãoClick/ERP, IAM/admin/RBAC, `*`.
- `portfolioScope` (PROPRIOS/EQUIPE/TODOS) e `moduleAccess` aplicados no servidor em listagem, busca, GET e mutação; teto = usuário dono ativo (estreitado a cada request). Fora da carteira → 404.
- SetaDesk: saída via `maskTicketForResponse`; busca via `ticketMatchesSearchServer` (só comentários visíveis); PATCH com allowlist estrita e recusa de valores mascarados (422); comentário interno exige escopo próprio; sem Blob público.
- Rate-limit distribuído em Postgres (`api_rate_limits`): 429 + `X-RateLimit-*` + `Retry-After`. Padrão 120/min por credencial (`INTEGRATION_RATE_LIMIT_PER_MINUTE`), 30/min por IP no OAuth.
- `Idempotency-Key` (REST) / `_meta["stihub/idempotencyKey"]` (MCP): replay (`Idempotent-Replayed: true`) e 409 com payload diferente; TTL 24h.
- Sem Postgres → **503** `INTEGRATION_STORE_UNAVAILABLE` em todas as rotas (sem fallback JSON/tmp). Store em memória só em `NODE_ENV=test` por injeção explícita.

## Tabelas (criadas por `ensurePostgresSchema` → `ensureIntegrationSchema`)
`integration_api_keys`, `api_idempotency_keys`, `integration_audit_logs`, `api_rate_limits`, `oauth_clients`, `oauth_auth_codes`, `oauth_tokens` — todos os segredos/tokens/códigos somente como SHA-256.

## Decisões pendentes (CISO)
1. OAuth com carteira EQUIPE: o consentimento não carrega lista de equipe → hoje se comporta como PROPRIOS (dono). Definir fonte da equipe.
2. `Idempotency-Key` é opcional nas mutações (recomendado); tornar obrigatório?
3. `/login?next=` — confirmar que a tela de login respeita `next` para retomar o authorize.
4. `STI_HUB_PUBLIC_ORIGIN` deve ser configurado em produção (issuer/resource estáveis).
