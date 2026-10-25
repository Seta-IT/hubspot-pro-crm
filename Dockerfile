# ============================================================================
# HubSpot Pro CRM - Production Multi-Stage Dockerfile (Next.js + PostgreSQL)
# ============================================================================

FROM node:20-alpine AS base
WORKDIR /app
RUN apk add --no-cache libc6-compat

# 1. Instalação de dependências
FROM base AS deps
COPY package.json package-lock.json* ./
RUN npm ci

# 2. Compilação TypeScript + Next.js Build
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build && npm run build:web

# 3. Imagem final de produção
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000

COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/package-lock.json* ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/src ./src
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/next.config.mjs ./next.config.mjs

RUN mkdir -p /app/.data && chown -R node:node /app
USER node

EXPOSE 3000

CMD ["sh", "-c", "node dist/src/db/cli-migrate.js && npx next start -p ${PORT:-3000}"]
