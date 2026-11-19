-- Strategy 03 Read-Only Forward Shadow Observation Ledger
-- Safety: No paper trades, no broker orders, research/shadow observation only.

CREATE TABLE IF NOT EXISTS public.strategy03_shadow_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id TEXT NOT NULL,
  observation_date DATE NOT NULL UNIQUE,
  scheduled_time_ist TEXT NOT NULL,
  actual_start_time TIMESTAMPTZ NOT NULL,
  completion_time TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('SUCCESS', 'PARTIAL', 'FAILED', 'MISSED', 'SKIPPED_NON_TRADING_DAY', 'SKIPPED_DUPLICATE')),
  universe_count INTEGER NOT NULL DEFAULT 0,
  evaluated_symbols_count INTEGER NOT NULL DEFAULT 0,
  fresh_signals_count INTEGER NOT NULL DEFAULT 0,
  mature_signals_count INTEGER NOT NULL DEFAULT 0,
  pending_signals_count INTEGER NOT NULL DEFAULT 0,
  data_quality_failures INTEGER NOT NULL DEFAULT 0,
  frozen_spec_checksum TEXT NOT NULL,
  run_checksum TEXT NOT NULL,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.strategy03_shadow_signals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key TEXT NOT NULL UNIQUE,
  signal_date DATE NOT NULL,
  symbol TEXT NOT NULL,
  sector TEXT,
  decision TEXT NOT NULL,
  score NUMERIC(6,2) NOT NULL,
  confidence NUMERIC(5,2) NOT NULL DEFAULT 0,
  verification_status TEXT NOT NULL,
  reference_price NUMERIC(12,2),
  missing_fields JSONB NOT NULL DEFAULT '[]'::jsonb,
  evidence_summary JSONB NOT NULL DEFAULT '[]'::jsonb,
  market_data_timestamp TIMESTAMPTZ,
  evaluation_timestamp TIMESTAMPTZ NOT NULL,
  frozen_spec_checksum TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_s03_shadow_runs_date ON public.strategy03_shadow_runs (observation_date DESC);
CREATE INDEX IF NOT EXISTS idx_s03_shadow_signals_date ON public.strategy03_shadow_signals (signal_date DESC);

ALTER TABLE public.strategy03_shadow_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.strategy03_shadow_signals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "strategy03_shadow_runs_service_role_all" ON public.strategy03_shadow_runs;
CREATE POLICY "strategy03_shadow_runs_service_role_all"
  ON public.strategy03_shadow_runs
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "strategy03_shadow_runs_authenticated_read" ON public.strategy03_shadow_runs;
CREATE POLICY "strategy03_shadow_runs_authenticated_read"
  ON public.strategy03_shadow_runs
  FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "strategy03_shadow_signals_service_role_all" ON public.strategy03_shadow_signals;
CREATE POLICY "strategy03_shadow_signals_service_role_all"
  ON public.strategy03_shadow_signals
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "strategy03_shadow_signals_authenticated_read" ON public.strategy03_shadow_signals;
CREATE POLICY "strategy03_shadow_signals_authenticated_read"
  ON public.strategy03_shadow_signals
  FOR SELECT
  TO authenticated
  USING (true);

