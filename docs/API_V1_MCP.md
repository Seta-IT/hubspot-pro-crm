# STI-hub — API v1, MCP remoto, OAuth 2.1 + DCR e chaves de integração (Fase 1 — backend)

> Status: correções do parecer técnico do CISO aplicadas (branch `feat/api-v1-mcp`). Não publicado.

## Superfícies
| Caminho | Auth | Observação |
|---|---|---|
| `GET/POST/PATCH /api/v1/*` | `Authorization: Bearer stihub_int_…` (chave IAM) ou `stihub_oat_…` (OAuth) | Sem DELETE. RFC 7807 (`application/problem+json`). |
| `GET /api/v1/openapi.json` | Bearer com `openapi:read` **ou** sessão 2FA | OpenAPI 3.1.0 gerado do catálogo de use-cases (Zod). 401 sem auth. |
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

## Travas
- Catálogo de escopos fechado; bloqueados (rejeitados na criação, ausentes do OpenAPI/MCP): DELETE, merge, sequências, fiscal/financeiro, GestãoClick/ERP, IAM/admin/RBAC, `*`.
- `portfolioScope` (PROPRIOS/EQUIPE/TODOS) e `moduleAccess` aplicados no servidor em listagem, busca, GET e mutação; teto = usuário dono ativo (estreitado a cada request). Fora da carteira → 404.
- **Vínculos** (`companyId`, `contactId`, `dealId`) em contatos, negócios e chamados: inexistente **ou** fora da carteira → o mesmo `404` neutro (sem oráculo e sem vínculo cruzado).
- **Alçada RBAC** (`requireOwnerAccess`) por área: contatos, empresas, negócios (inclui pipelines), atividades (por tipo de vínculo, na listagem, no filtro e na criação) e chamados (inclui filas). Alçada ausente → preset restrito do papel; desconhecida → **nega** (fail-closed).
- Chamados: `assignee` no PATCH, com carteira PROPRIOS/EQUIPE, só para usuário ativo da carteira (403 `ASSIGNEE_OUT_OF_PORTFOLIO`).
- SetaDesk: saída via `maskTicketForResponse`; busca via `ticketMatchesSearchServer` (só comentários visíveis); PATCH com allowlist estrita e recusa de valores mascarados (422); comentário interno exige escopo próprio; sem Blob público.
- Rate-limit distribuído em Postgres (`api_rate_limits`): 429 + `X-RateLimit-*` + `Retry-After`. Padrão 120/min por credencial (`INTEGRATION_RATE_LIMIT_PER_MINUTE`), 30/min por IP no OAuth (`INTEGRATION_OAUTH_RATE_LIMIT_PER_MINUTE`), incluindo `authorize`.
- `Idempotency-Key` (REST) / `_meta["stihub/idempotencyKey"]` (MCP): **opcional** nos POST/PATCH. Replay (`Idempotent-Replayed: true`) e 409 com payload diferente; TTL 24h. Antes de devolver o cache, reautoriza (escopo, dono ativo, teto vivo, alçada). O cache é isolado por credencial + usuário + autorização efetiva (escopos/carteira/módulos), sem replay entre chaves/usuários ou após revogação.
- Sem Postgres **ou com Postgres inacessível** (conexão recusada, DNS, timeout, servidor reiniciando) → **503** `INTEGRATION_STORE_UNAVAILABLE` (problem+json), nunca 500 e sem fallback JSON/tmp. Store em memória só em `NODE_ENV=test` por injeção explícita.
- `/login?next=`: só caminho da mesma origem (`sanitizeLoginNext`): rejeita `//host`, `/\host`, barra invertida, caracteres de controle, URL absoluta e `%2F%2F`; fallback `/`.

## Variáveis de ambiente (produção = `NODE_ENV=production` ou `VERCEL=1`)
| Variável | Obrigatória | Efeito |
|---|---|---|
| `STI_HUB_PUBLIC_ORIGIN` | **Sim** em produção | Origem https usada como issuer/resource. Ausente ou inválida em produção → rotas de integração respondem 503 `PUBLIC_ORIGIN_NOT_CONFIGURED` (sem confiar no Host). |
| `OAUTH_ALLOWED_REDIRECT_HOSTS` | Recomendada | Lista separada por vírgula de hostnames (`claude.ai`), origens (`https://x:8443`) ou esquemas (`com.app:`) aceitos no DCR em produção. Vazia → só loopback. |
| `OAUTH_ALLOWED_REDIRECT_SCHEMES` | Opcional | Esquemas privados extras aceitos pela validação básica de `redirect_uri`. |
| `INTEGRATION_RATE_LIMIT_PER_MINUTE` / `INTEGRATION_OAUTH_RATE_LIMIT_PER_MINUTE` | Opcional | Limites (padrão 120 / 30). |

## Tabelas (criadas por `ensurePostgresSchema` → `ensureIntegrationSchema`)
`integration_api_keys`, `api_idempotency_keys`, `integration_audit_logs` (+ `target_user_id`, `details` via `ADD COLUMN IF NOT EXISTS`), `api_rate_limits`, `oauth_clients`, `oauth_auth_codes`, `oauth_tokens`. Todos os segredos/tokens/códigos somente como SHA-256.

## Decisões do CISO (fechadas)
1. OAuth não oferece `EQUIPE` (não há lista de equipe no cadastro): teto `TODOS` → `PROPRIOS` ou `TODOS`; teto `EQUIPE`/`PROPRIOS` → só `PROPRIOS`.
2. `Idempotency-Key` permanece **opcional** em POST/PATCH (recomendado para retries).
3. `/login?next=` é respeitado para retomar o `authorize`, com validação estrita de mesma origem.
4. `STI_HUB_PUBLIC_ORIGIN` é obrigatória em produção (falha fechado com 503).
