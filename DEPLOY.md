# Guia de Deploy em Produção — HubSpot Pro CRM (Next.js + PostgreSQL)

O **HubSpot Pro CRM** possui arquitetura híbrida pronta para produção:
- Quando `DATABASE_URL` está configurada (PostgreSQL), o sistema cria automaticamente o schema no banco, mantém snapshot transacional em `crm_kv_store` e sincroniza em tempo real as tabelas relacionais (`crm_companies`, `crm_contacts`, `crm_pipelines`, `crm_deals`, `crm_timeline_events`, `crm_workflows`, `crm_sequences`, `crm_data_health_issues`) para consultas SQL e ferramentas de BI (Metabase, PowerBI, Looker).
- Quando `DATABASE_URL` não está definida (ambiente local ou CI), o sistema opera automaticamente em modo `file-json` (`.data/crm-store.json`).

---

## Opção 1: Vercel + Neon / Supabase (Serverless PostgreSQL)

1. Suba este repositório para sua conta no **GitHub**.
2. Crie um banco PostgreSQL gratuito no **[Neon.tech](https://neon.tech)** ou **[Supabase](https://supabase.com)** e copie a string de conexão (`postgresql://usuario:senha@host/neondb?sslmode=require`).
3. Na **[Vercel](https://vercel.com/new)**, importe o repositório do GitHub.
4. Em **Environment Variables**, adicione:
   - `DATABASE_URL` = `sua_url_do_postgresql_com_sslmode=require`
5. Clique em **Deploy**. Na primeira requisição (ou executando `npm run db:migrate`), o schema e o seed inicial serão criados automaticamente no PostgreSQL.

---

## Opção 2: Railway ou Render (App + PostgreSQL Integrado)

1. No **[Railway](https://railway.app)**, clique em **New Project -> Deploy from GitHub repo**.
2. Clique em **+ New -> Database -> Add PostgreSQL**.
3. No serviço da aplicação CRM, adicione a variável de ambiente referenciando o Postgres do Railway:
   - `DATABASE_URL` = `${{Postgres.DATABASE_URL}}`
4. O arquivo `railway.json` já está configurado para:
   - Compilar o backend e o frontend (`npm run build && npm run build:web`)
   - Rodar a migração automática (`node dist/src/db/cli-migrate.js`)
   - Subir o servidor Next.js e monitorar o healthcheck em `GET /api/health`.

---

## Opção 3: Docker Compose em VPS Própria (1 Comando)

Para rodar tanto o aplicativo quanto o banco **PostgreSQL 16** em qualquer servidor Linux (AWS EC2, DigitalOcean, Hetzner, etc.):

```bash
docker compose up -d --build
```

- **Interface Web & API:** `http://localhost:3000`
- **Healthcheck & Status do Banco:** `http://localhost:3000/api/health`
- **PostgreSQL 16:** porta `5432` (dados persistidos no volume `pgdata`)

---

## Comandos Úteis de Banco de Dados

| Comando | Descrição |
|---|---|
| `npm run db:migrate` | Conecta no `DATABASE_URL`, cria todas as tabelas/índices PostgreSQL e popula o seed inicial caso o banco esteja vazio |
| `npm run db:seed` | Reinicia o banco PostgreSQL (ou JSON local) com os dados de demonstração do seed |
| `npm run prisma:push` | Sincroniza o schema `prisma/schema.prisma` diretamente com o PostgreSQL via Prisma CLI |
| `npm test` | Executa a suíte completa de testes automatizados |
