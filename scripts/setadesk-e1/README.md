# SetaDesk E1 - serviceTickets fora do crm_state_v1

O que mudou no código (sem apagar nada no banco):

- `syncStateToPostgres` grava o `crm_state_v1` **sem** `serviceTickets`. O `KV_STATE_UPSERT_SQL`
  preserva a chave antiga que já está no banco, que fica intacta até a limpeza aprovada.
- `loadStateFromPostgres` lê `payload - 'serviceTickets'`. Os ~3,1 MB não saem mais do Neon a cada
  requisição, e a lista em memória começa vazia.
- O espelho `crm_service_tickets` saiu de `MIRROR_TABLES`. A tabela e os dados antigos continuam.
- Cada rota carrega das `setadesk_*` só o que usa (`src/api/setadesk-route-plan.ts`).
  A reconciliação com o legado do JSON (`reconcileLegacy`) fica desligada no caminho quente.
- `GET /api/tickets` tem paginação: `limit` vai de 1 a 500, com padrão 100. Aceita `offset` ou o
  `cursor` devolvido em `nextCursor`, e a resposta traz `total`, `hasMore` e `nextOffset`.

Limpeza (`cleanup-legacy-service-tickets.sql`): **não foi executada.** Só pode rodar com o OK do
Marcéllo, depois de alguns dias estáveis em produção e com backup ou branch do Neon. O script
remove a chave `serviceTickets` do `crm_state_v1` e esvazia `crm_service_tickets`. Ele pede
confirmação (`SIM`) antes do COMMIT.
