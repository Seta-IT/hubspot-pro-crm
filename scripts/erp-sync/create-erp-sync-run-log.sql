-- ============================================================================
-- STI-hub — Tabela de log da sincronizacao diaria GestaoClick -> STI-hub
-- ============================================================================
-- PENDENTE: este SQL NAO roda sozinho no deploy. Nao executar em producao
-- sem aprovacao do CISO / Marcéllo. Depois de publicado o codigo, aplicar
-- no Neon de producao (projeto shy-pond-49215669) e conferir se a primeira
-- execucao do cron gravou uma linha.
--
-- O app (persistErpSyncRunLog) escreve nesta tabela se ela existir. Se a
-- tabela ainda nao existir, a sincronizacao segue e o log fica pendente.
-- ============================================================================

CREATE TABLE IF NOT EXISTS erp_sync_run_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  trigger         TEXT NOT NULL CHECK (trigger IN ('vercel_cron', 'service_key', 'admin')),
  status          TEXT NOT NULL CHECK (status IN ('SUCCESS', 'PARTIAL', 'ERROR')),
  error           TEXT,
  duration_ms     INTEGER,
  live_connected  BOOLEAN,
  counts          JSONB NOT NULL DEFAULT '{}'::jsonb,
  previous_run_at TIMESTAMPTZ,
  counts_delta    JSONB,
  source          TEXT
);

CREATE INDEX IF NOT EXISTS erp_sync_run_log_run_at_idx
  ON erp_sync_run_log (run_at DESC);
