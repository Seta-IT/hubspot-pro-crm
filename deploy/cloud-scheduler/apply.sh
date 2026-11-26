#!/usr/bin/env bash
# Cria ou atualiza os 6 jobs do Cloud Scheduler com autenticacao OIDC.
# NAO executar no ciclo de preparacao do codigo (sem gcloud apply neste
# repositorio ate o CISO e o Marcéllo autorizarem a publicacao).
#
# O script NAO recebe e NAO interpola CRON_SECRET na linha de comando.
# O Cloud Scheduler assina um token OIDC com a service account e a audience
# configuradas; a rota de cron valida o JWT (iss Google, aud, email, exp, RS256).
#
# Bearer CRON_SECRET permanece so como compatibilidade da migracao Vercel
# (variavel de ambiente no servico, nunca neste script). Ver
# docs/CLOUD_RUN_MIGRATION.md.
set -euo pipefail

: "${STI_HUB_PUBLIC_ORIGIN:?defina STI_HUB_PUBLIC_ORIGIN (https)}"
: "${GCP_PROJECT:?defina GCP_PROJECT}"
: "${CRON_OIDC_SERVICE_ACCOUNT:?defina CRON_OIDC_SERVICE_ACCOUNT (email da SA)}"
GCP_REGION="${GCP_REGION:-southamerica-east1}"
TIME_ZONE="${TIME_ZONE:-UTC}"

ORIGIN="${STI_HUB_PUBLIC_ORIGIN%/}"
AUDIENCE="${CRON_OIDC_AUDIENCE:-$ORIGIN}"

create_or_update() {
  local name="$1" schedule="$2" path="$3" description="$4"
  local uri="${ORIGIN}${path}"
  if gcloud scheduler jobs describe "${name}" --project="${GCP_PROJECT}" --location="${GCP_REGION}" >/dev/null 2>&1; then
    gcloud scheduler jobs update http "${name}" \
      --project="${GCP_PROJECT}" \
      --location="${GCP_REGION}" \
      --schedule="${schedule}" \
      --time-zone="${TIME_ZONE}" \
      --uri="${uri}" \
      --http-method=GET \
      --oidc-service-account-email="${CRON_OIDC_SERVICE_ACCOUNT}" \
      --oidc-token-audience="${AUDIENCE}" \
      --description="${description}"
  else
    gcloud scheduler jobs create http "${name}" \
      --project="${GCP_PROJECT}" \
      --location="${GCP_REGION}" \
      --schedule="${schedule}" \
      --time-zone="${TIME_ZONE}" \
      --uri="${uri}" \
      --http-method=GET \
      --oidc-service-account-email="${CRON_OIDC_SERVICE_ACCOUNT}" \
      --oidc-token-audience="${AUDIENCE}" \
      --description="${description}"
  fi
}

create_or_update sti-hub-erp-daily-sync            "0 12 * * *"      /api/erp/daily-sync            "Sync diario ERP (GestaoClick)"
create_or_update sti-hub-crm-proposal-followup     "0 12 * * 1-5"    /api/crm/proposal-followup     "Follow-up de propostas (dias uteis)"
create_or_update sti-hub-tickets-email-intake-poll "*/10 * * * *"    /api/tickets/email-intake/poll "Poll de e-mail do Setadesk"
create_or_update sti-hub-cron-sequences            "*/15 * * * 1-5"  /api/cron/sequences            "Executor das cadencias (dias uteis)"
create_or_update sti-hub-cron-marketing            "*/5 * * * *"     /api/cron/marketing            "Fila das campanhas"
create_or_update sti-hub-cron-workflows            "*/5 * * * *"     /api/cron/workflows            "Automacoes (workflows)"
