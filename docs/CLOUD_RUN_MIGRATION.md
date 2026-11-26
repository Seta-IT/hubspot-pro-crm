# STI-hub — preparação para Cloud Run (southamerica-east1)

Este documento descreve as flags, o build da imagem, o Job de migração e o
Cloud Scheduler. **Nada aqui aplica deploy, `gcloud` ou migração em produção.**
A publicação continua dependendo do parecer do CISO e do sim direto do Marcéllo.

Região alvo: Cloud Run `southamerica-east1`. Neon: `aws-sa-east-1`.

## Variáveis novas (e compatibilidade)

| Variável | Obrigatória? | Função |
|---|---|---|
| `STI_HUB_PUBLIC_ORIGIN` | **Sim** em produção | Origem `https` canônica (sem caminho). Usada em CORS, links de convite/reset/proposta, OAuth/MCP, rastreio de e-mail e avatars. Ausente ou `http` em produção => falha fechada (CORS sem `Access-Control-Allow-Origin`, reset de senha não envia e-mail, convites e links de proposta não usam o `Host` da requisição, integração 503). |
| `SECURE_COOKIES` | Não | Em **produção** o atributo `Secure` fica **sempre ligado**; `SECURE_COOKIES=0`/`false`/`off` é **ignorado**. Fora de produção: `1`/`true`/`on` liga; `0`/`false`/`off` desliga; sem a variável, desligado. Produção = `NODE_ENV=production`, `VERCEL=1`, `VERCEL_ENV=production\|preview`, `TRUSTED_PROXY_MODE=cloudrun`, `K_SERVICE` ou `CLOUD_RUN_JOB`. |
| `TRUSTED_PROXY_MODE` | Não | `vercel` \| `cloudrun` \| `none`. **Sem a variável:** `vercel` se `VERCEL=1`; `cloudrun` se `K_SERVICE` ou `CLOUD_RUN_JOB`; senão `none`. **Com `K_SERVICE` ou `CLOUD_RUN_JOB`, `vercel` é recusado** (esse modo confia em `X-Real-IP`, forjável no Cloud Run) e o modo é forçado para `cloudrun`. `none` explícito permanece fail-closed. |
| `TRUSTED_PROXY_HOPS` | Não | Quantos proxies contar **a partir da direita** em `X-Forwarded-For` no modo `cloudrun`. Aceita 1–10. Se houver menos entradas do que hops, o IP é recusado (fail-closed). |
| `CRON_OIDC_SERVICE_ACCOUNT` | **Sim** no Cloud Scheduler | E-mail da service account com que o Scheduler assina o token OIDC. Também é o `email` que a rota de cron exige no JWT. |
| `CRON_OIDC_AUDIENCE` | Não (cai para `STI_HUB_PUBLIC_ORIGIN`) | Audience do token OIDC (`aud`). Precisa coincidir com `--oidc-token-audience` do Scheduler. |
| `CRON_SECRET` | Não (compatibilidade) | Bearer legado da migração Vercel, ≥ 16 caracteres. **Não** entra na linha de comando do `apply.sh`. Sem OIDC configurado e sem este segredo, nenhum cron é autorizado (fail-closed). |
| `STI_HUB_ORIGIN_SHARED_SECRET` | **Sim** no Cloud Run | Segredo compartilhado com o Worker `sti-hub-proxy` (≥ 16 caracteres). O Worker envia `X-STI-Origin-Auth`. Sem o cabeçalho válido, o app responde 403. Sem o secret no Cloud Run, falha fechado. **Nunca** registrar o valor. |

O valor de produção de `STI_HUB_PUBLIC_ORIGIN` é `https://sti-hub.setatelecom.com.br`. Ele é configurado por variável de ambiente, **não** está fixo no código.

Compatibilidade: `VERCEL=1` e `VERCEL_ENV=production\|preview` continuam válidos enquanto a migração não termina. `CLOUD_RUN_JOB` (Job de migração, que **não** define `K_SERVICE`) entra no mesmo sinal de produção que `K_SERVICE`.

### IP do cliente no Cloud Run

O Google Front End **acrescenta** o IP do par TCP no **final** de `X-Forwarded-For`. A primeira entrada é controlada pelo cliente e **nunca** é usada. O modo `cloudrun` ignora `X-Real-IP` e `X-Vercel-Forwarded-For`.

- **`TRUSTED_PROXY_HOPS=1` (padrão):** só o GFE, típico da URL `*.run.app`. Exemplo:

```
X-Forwarded-For: 8.8.8.8, 203.0.113.10
```

O IP confiável é `203.0.113.10` (direita). `8.8.8.8` é tratado como forjado.

- **`TRUSTED_PROXY_HOPS=2`:** load balancer HTTPS externo ou o Worker `sti-hub-proxy` na frente do Cloud Run. O proxy/LB acrescenta o IP do cliente; o GFE acrescenta o IP do proxy. A entrada correta é a **segunda a partir da direita**. Com hops=1 nesse caso o IP devolvido seria o do proxy/LB, não o do cliente. **Com a trava de origem ativa** (`K_SERVICE` ou `CLOUD_RUN_JOB`) os hops ficam **forçados em 2**.

```
X-Forwarded-For: 8.8.8.8, 198.51.100.4, 203.0.113.10
                 ^forjado  ^cliente      ^IP do LB (anexado pelo GFE)
```

O IP confiável com hops=2 é `198.51.100.4`. O padrão **permanece 1**; não mude automaticamente para 2 — só quando o tráfego passar pelo LB externo.

No modo `vercel` (somente fora do Cloud Run, ou `VERCEL=1` sem `K_SERVICE`/`CLOUD_RUN_JOB`): `x-vercel-forwarded-for`, depois `x-real-ip`; `X-Forwarded-For` é ignorado.

No modo `none`: nenhum cabeçalho de proxy; o chamador usa o balde `sem-ip`.

### Cookies, origem pública e OAuth

Em produção o cookie leva `Secure` **mesmo se** `SECURE_COOKIES=0`. O OAuth exige `OAUTH_ALLOWED_REDIRECT_HOSTS` para redirect URIs que não sejam loopback — o mesmo comportamento seguro de antes, agora também no Cloud Run (`K_SERVICE`, `CLOUD_RUN_JOB` ou `TRUSTED_PROXY_MODE=cloudrun`).

Com `NODE_ENV=production` (o container Cloud Run e a Vercel de produção já definem isso), links de proposta e convite usam **somente** `STI_HUB_PUBLIC_ORIGIN`. Sem essa variável o serviço falha fechado: não cai para o cabeçalho `Host` nem para a origem da requisição (que o cliente pode forjar).

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
  -e CRON_OIDC_SERVICE_ACCOUNT=sti-hub-scheduler@PROJECT.iam.gserviceaccount.com \
  -e CRON_OIDC_AUDIENCE=https://sti-hub.setatelecom.com.br \
  sti-hub:cloudrun
```

- Base: `node:24-alpine`, usuário `node` (não-root).
- O código e o `node_modules` permanecem do `root`, **somente leitura** para o usuário `node`. Só `/tmp` e `/app/.data` são graváveis (`chown` restrito a esses diretórios).
- `.dockerignore` exclui `.git`, `.env*`, testes, worktrees, chaves (`.pem`/`.key`/`.p12`/`.pfx`), `.vercel`, `.secrets` e afins.
- `PORT` e `HOSTNAME=0.0.0.0` vêm do ambiente (Cloud Run injeta `PORT`).
- Comando do serviço: `node server.js` (server standalone do Next). **Não** roda `cli-migrate` na subida.

## Job de migração (Cloud Run Job)

As migrações são um comando separado, no **mesmo** image:

```bash
node dist/src/db/cli-migrate.js
```

Equivalente npm (já com `dist/` compilado): `npm run db:migrate:run`.

O Job define `CLOUD_RUN_JOB` (não `K_SERVICE`). Essa variável entra no sinal de produção, no filesystem efêmero e na recusa do `TRUSTED_PROXY_MODE=vercel`.

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

## Trava de origem, Worker e ingress

O tráfego de produção deve chegar ao Cloud Run **só** pelo Worker `sti-hub-proxy` e/ou por um load balancer HTTPS interno. Recomendação: **ingress interno + LB**, ou **somente o Worker**. Esta unificação **não altera** o ingress — só documenta o alvo.

O Worker envia, em toda requisição, o cabeçalho:

```
X-STI-Origin-Auth: <STI_HUB_ORIGIN_SHARED_SECRET>
```

No Cloud Run (`K_SERVICE` ou `CLOUD_RUN_JOB`) o app:

- compara o cabeçalho em tempo constante;
- responde **403** se estiver ausente ou errado;
- **falha fechado** se `STI_HUB_ORIGIN_SHARED_SECRET` não estiver configurado (ou tiver menos de 16 caracteres);
- não registra o secret nem o valor do cabeçalho;
- força `TRUSTED_PROXY_HOPS=2` (Worker/LB + GFE).

Única exceção: os 6 GET do Cloud Scheduler com Bearer OIDC válido (forma de JWT no Edge; verificação criptográfica no bridge). Além de `/api/cron/*`, isso inclui `/api/erp/daily-sync`, `/api/crm/proposal-followup` e `/api/tickets/email-intake/poll` — os mesmos jobs do Scheduler. Bearer `CRON_SECRET` **não** dispensa a trava.

O probe padrão do Cloud Run é TCP na porta do container e não é afetado pela trava HTTP.

Respostas do middleware incluem `Strict-Transport-Security: max-age=63072000; includeSubDomains`.

## Cloud Scheduler (OIDC)

Os 6 crons de `vercel.json` foram transpostos em `deploy/cloud-scheduler/jobs.yaml`, com **time zone UTC explícito** (o cron da Vercel é UTC).

Autenticação **preferencial:** OIDC do Cloud Scheduler. O `apply.sh` usa `--oidc-service-account-email` e `--oidc-token-audience`. **Não** passa `CRON_SECRET` na linha de comando.

A rota de cron (bridge, Node) valida o JWT:

- `iss` = `https://accounts.google.com` (ou `accounts.google.com`)
- `aud` = `CRON_OIDC_AUDIENCE` ou, na ausência, `STI_HUB_PUBLIC_ORIGIN`
- `email` = `CRON_OIDC_SERVICE_ACCOUNT`, com `email_verified`
- `exp` (e `nbf`/`iat` se presentes), com folga de 60s
- assinatura **RS256** contra o JWKS público do Google (`https://www.googleapis.com/oauth2/v3/certs`)

O middleware Edge (sem `node:crypto`) deixa passar um Bearer em forma de JWT quando o OIDC está configurado; a verificação criptográfica ocorre no bridge **antes** de `_cronAuthorized`.

`Authorization: Bearer ${CRON_SECRET}` permanece apenas como **compatibilidade** da migração Vercel (variável de ambiente no serviço, comparação em tempo constante). Não use esse segredo no Scheduler novo.

| Job | Cron (UTC) | Rota |
|---|---|---|
| `sti-hub-erp-daily-sync` | `0 12 * * *` | `/api/erp/daily-sync` |
| `sti-hub-crm-proposal-followup` | `0 12 * * 1-5` | `/api/crm/proposal-followup` |
| `sti-hub-tickets-email-intake-poll` | `*/10 * * * *` | `/api/tickets/email-intake/poll` |
| `sti-hub-cron-sequences` | `*/15 * * * 1-5` | `/api/cron/sequences` |
| `sti-hub-cron-marketing` | `*/5 * * * *` | `/api/cron/marketing` |
| `sti-hub-cron-workflows` | `*/5 * * * *` | `/api/cron/workflows` |

Script (não executar neste ciclo):

```bash
STI_HUB_PUBLIC_ORIGIN=https://sti-hub.setatelecom.com.br \
CRON_OIDC_SERVICE_ACCOUNT=sti-hub-scheduler@PROJECT.iam.gserviceaccount.com \
CRON_OIDC_AUDIENCE=https://sti-hub.setatelecom.com.br \
GCP_PROJECT=... \
GCP_REGION=southamerica-east1 \
bash deploy/cloud-scheduler/apply.sh
```

## Pendências fora deste lote

- O destino de produção é o Cloud Run em `southamerica-east1`. O arquivo `railway.json` foi mantido apenas como legado: o `startCommand` sobe `npm run start:web` **sem** `cli-migrate`, e não há pre-deploy de migração. **O Railway não será usado.**
- `erp.setatelecom.com.br` saiu da allowlist fixa de CORS; se ainda for origem de chamadas, precisa entrar em `STI_HUB_PUBLIC_ORIGIN` ou numa extensão futura da allowlist.
- Cutover de DNS, mapeamento do domínio no Cloud Run, secrets, VPC/Neon, criação da service account do Scheduler e publicação: somente com o sim do Marcéllo após o parecer do CISO.
