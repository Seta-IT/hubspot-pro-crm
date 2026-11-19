-- ============================================================================
-- SetaDesk E1 - limpeza das copias antigas dos chamados (NAO EXECUTADO)
-- ----------------------------------------------------------------------------
-- NAO RODAR sem o OK explicito do Marcéllo. Este script apaga dados.
-- Pre-requisitos:
--   1. Deploy da E1 em producao e estavel ha alguns dias (nenhum escritor grava
--      serviceTickets no crm_state_v1 nem alimenta crm_service_tickets).
--   2. Contagem das setadesk_tickets conferida contra a copia antiga (passo 0).
--   3. Backup: branch do Neon criado antes, ou pg_dump de crm_kv_store e
--      crm_service_tickets.
-- Uso (quando aprovado): psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f este_arquivo.sql
-- O psql pede confirmacao no fim (\prompt); qualquer resposta diferente de SIM faz ROLLBACK.
-- ============================================================================

\set ON_ERROR_STOP 1

-- 0. Conferencia (somente leitura)
SELECT
  (SELECT jsonb_array_length(payload->'serviceTickets') FROM crm_kv_store WHERE key = 'crm_state_v1') AS chamados_no_json,
  (SELECT pg_size_pretty(length((payload->'serviceTickets')::text)::bigint) FROM crm_kv_store WHERE key = 'crm_state_v1') AS tamanho_no_json,
  (SELECT pg_size_pretty(length(payload::text)::bigint) FROM crm_kv_store WHERE key = 'crm_state_v1') AS tamanho_total_json,
  (SELECT COUNT(*) FROM crm_service_tickets) AS linhas_espelho,
  (SELECT pg_size_pretty(pg_total_relation_size('crm_service_tickets'))) AS tamanho_espelho,
  (SELECT COUNT(*) FROM setadesk_tickets) AS chamados_setadesk;

-- Chamados que existem so na copia antiga (deveria ser 0, fora os demos JSM-101..105)
SELECT t->>'id' AS id, t->>'key' AS key
  FROM crm_kv_store, jsonb_array_elements(payload->'serviceTickets') t
 WHERE key = 'crm_state_v1'
   AND NOT EXISTS (SELECT 1 FROM setadesk_tickets s WHERE s.id = t->>'id')
   AND NOT EXISTS (SELECT 1 FROM setadesk_ticket_tombstones x WHERE x.id = t->>'id');

BEGIN;

-- 1. Remove a chave serviceTickets do crm_state_v1 (o resto do estado fica igual)
UPDATE crm_kv_store
   SET payload = payload - 'serviceTickets', updated_at = NOW()
 WHERE key = 'crm_state_v1' AND payload ? 'serviceTickets';

-- 2. Esvazia o espelho antigo (a tabela continua existindo; o DDL do app a recria se faltar)
TRUNCATE TABLE crm_service_tickets;

\prompt 'Digite SIM para confirmar o COMMIT: ' confirma
SELECT (:'confirma' = 'SIM') AS confirmado \gset
\if :confirmado
  COMMIT;
  VACUUM (ANALYZE) crm_kv_store;
  VACUUM (ANALYZE) crm_service_tickets;
\else
  ROLLBACK;
\endif
