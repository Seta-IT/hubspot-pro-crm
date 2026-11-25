# ============================================================================
# STI-hub — imagem de producao para Cloud Run (Next.js standalone + dist/).
# Multi-stage, Node 24, usuario nao-root. PORT vem do ambiente (Cloud Run).
# Migracoes NAO rodam na inicializacao: use o mesmo image como Cloud Run Job
#   com o comando `node dist/src/db/cli-migrate.js` (ver docs/CLOUD_RUN_MIGRATION.md).
# ============================================================================

FROM node:24-alpine AS base
WORKDIR /app
RUN apk add --no-cache libc6-compat

FROM base AS deps
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

FROM base AS builder
COPY package.json package-lock.json* ./
RUN npm ci
COPY . .
RUN mkdir -p public
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
RUN npm run build && npm run build:web

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV PORT=8080

COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/package-lock.json* ./
COPY --from=builder /app/next.config.mjs ./next.config.mjs
# Sobrepoe o node_modules minimo do standalone com o de producao completo
# (necessario para o Cloud Run Job `node dist/src/db/cli-migrate.js`).
COPY --from=deps /app/node_modules ./node_modules

RUN mkdir -p /app/.data /tmp && chown -R node:node /app /tmp
USER node

EXPOSE 8080

# Cloud Run injeta PORT. O server.js do Next standalone respeita PORT e HOSTNAME.
CMD ["node", "server.js"]
