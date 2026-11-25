# STI-hub — preparação para Cloud Run (southamerica-east1)

Este documento descreve as flags, o build da imagem, o Job de migração e o
Cloud Scheduler. **Nada aqui aplica deploy, `gcloud` ou migração em produção.**
A publicação continua dependendo do parecer do CISO e do sim direto do Marcéllo.

Região alvo: Cloud Run `southamerica-east1`. Neon: `aws-sa-east-1`.

## Variáveis novas (e compatibilidade)

| Variável | Obrigatória? | Função |
|---|---|---|
| `STI_HUB_PUBLIC_ORIGIN` | **Sim** em produção | Origem `https` canônica (sem caminho). Usada em CORS, links de convite/reset, OAuth/MCP, rastreio de e-mail e avatars. Ausente ou `http` em produção => falha fechada (CORS sem `Access-Control-Allow-Origin`, reset de senha não envia e-mail, integração 503). |
| `SECURE_COOKIES` | Não | `1`/`true`/`on` liga o atributo `Secure` dos cookies; `0`/`false`/`off` desliga. **Sem a variável:** ligado em produção (`NODE_ENV=production`, `VERCEL=1`, `VERCEL_ENV=production\|preview` ou Cloud Run). |
| `TRUSTED_PROXY_MODE` | Não | `vercel` \| `cloudrun` \| `none`. **Sem a variável:** `vercel` se `VERCEL=1`; `cloudrun` se `K_SERVICE` (Cloud Run); senão `none` (nenhum cabeçalho de proxy é confiável). |
| `TRUSTED_PROXY_HOPS` | Não | Quantos proxies contar **a partir da direita** em `X-Forwarded-For` no modo `cloudrun`. Padrão `1` (Google Front End). Aceita 1–10. Se houver menos entradas do que hops, o IP é recusado (fail-closed). |

Compatibilidade: `VERCEL=1` e `VERCEL_ENV=production\|preview` continuam válidos enquanto a migração não termina. `CRON_SECRET` (já existente, ≥ 16 caracteres) é o Bearer dos crons; sem ele, nenhum cron é autorizado.

### IP do cliente no Cloud Run

O Google Front End **acrescenta** o IP do par TCP no **final** de `X-Forwarded-For`. A primeira entrada é controlada pelo cliente e **nunca** é usada. O modo `cloudrun` ignora `X-Real-IP` e `X-Vercel-Forwarded-For`. Exemplo com `TRUSTED_PROXY_HOPS=1`:

```
X-Forwarded-For: 8.8.8.8, 203.0.113.10
```

O IP confiável é `203.0.113.10` (direita). `8.8.8.8` é tratado como forjado.

No modo `vercel` (ou `VERCEL=1`): `x-vercel-forwarded-for`, depois `x-real-ip`; `X-Forwarded-For` é ignorado.

No modo `none`: nenhum cabeçalho de proxy; o chamador usa o balde `sem-ip`.

### Cookies e OAuth

Sem variáveis, em produção o cookie leva `Secure` e o OAuth exige `OAUTH_ALLOWED_REDIRECT_HOSTS` para redirect URIs que não sejam loopback — o mesmo comportamento seguro de antes, agora também no Cloud Run (`K_SERVICE` ou `TRUSTED_PROXY_MODE=cloudrun`).

## Build da imagem

O projeto é Next.js (App Router) + `tsc` (`dist/`). `next.config.mjs` usa `output: 'standalone'`.

```bash
docker build -t sti-hub:cloudrun .
docker run --rm -p 8080:8080 \
  -e PORT=8080 \
  -e NODE_ENV=production \
  -e TRUSTED_PROXY_MODE=cloudrun \
  -e STI_HUB_PUBLIC_ORIGIN=https://sti-hub.setatelecom.com.br \
  -e DATABASE_URL=... \
  -e STI_HUB_SESSION_SECRET=... \
  -e CRON_SECRET=... \
  sti-hub:cloudrun
```

- Base: `node:24-alpine`, usuário `node` (não-root).
- `PORT` e `HOSTNAME=0.0.0.0` vêm do ambiente (Cloud Run injeta `PORT`).
- Comando do serviço: `node server.js` (server standalone do Next). **Não** roda `cli-migrate` na subida.

## Job de migração (Cloud Run Job)

As migrações são um comando separado, no **mesmo** image:

```bash
node dist/src/db/cli-migrate.js
```

Equivalente npm (já com `dist/` compilado): `npm run db:migrate:run`.

Rodar **antes** de apontar o tráfego para uma revisão cujo esquema mudou. Nunca no `CMD` do serviço. Não executar contra o banco de produção a partir deste repositório de preparação.

Exemplo (quando autorizado):

```bash
gcloud run jobs create sti-hub-migrate \
  --image=... \
  --region=southamerica-east1 \
  --command=node \
  --args=dist/src/db/cli-migrate.js \
  --set-secrets=DATABASE_URL=...
```

## Cloud Scheduler

Os 6 crons de `vercel.json` foram transpostos em `deploy/cloud-scheduler/jobs.yaml`, com **time zone UTC explícito** (o cron da Vercel é UTC). Autenticação: `Authorization: Bearer ${CRON_SECRET}`.

| Job | Cron (UTC) | Rota |
|---|---|---|
| `sti-hub-erp-daily-sync` | `0 12 * * *` | `/api/erp/daily-sync` |
| `sti-hub-crm-proposal-followup` | `0 12 * * 1-5` | `/api/crm/proposal-followup` |
| `sti-hub-tickets-email-intake-poll` | `*/10 * * * *` | `/api/tickets/email-intake/poll` |
| `sti-hub-cron-sequences` | `*/15 * * * 1-5` | `/api/cron/sequences` |
| `sti-hub-cron-marketing` | `*/5 * * * *` | `/api/cron/marketing` |
| `sti-hub-cron-workflows` | `*/5 * * * *` | `/api/cron/workflows` |

Script (não executar neste ciclo): `deploy/cloud-scheduler/apply.sh`.

As rotas validam o Bearer com comparação em tempo constante (`SHA-256` + `timingSafeEqual` no bridge; comparação constante no middleware Edge) e **falham fechadas** se `CRON_SECRET` estiver ausente ou com menos de 16 caracteres.

## Pendências fora deste lote

- `railway.json` ainda roda `cli-migrate` na inicialização. Fora do escopo Cloud Run.
- Alguns textos e seeds de demonstração ainda citam `sti-hub.vercel.app` (RBAC/seed, e-mails de exemplo). Não foram reescritos para não misturar dado histórico com a troca de plataforma.
- `erp.setatelecom.com.br` saiu da allowlist fixa de CORS; se ainda for origem de chamadas, precisa entrar em `STI_HUB_PUBLIC_ORIGIN` ou numa extensão futura da allowlist.
- Cutover de DNS, mapeamento do domínio no Cloud Run, secrets, VPC/Neon e publicação: somente com o sim do Marcéllo após o parecer do CISO.
