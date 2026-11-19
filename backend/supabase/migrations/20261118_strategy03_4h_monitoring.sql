-- Strategy 03 Phase 6.10.19.9 — Live 4H Pre-Breakout Monitoring & State Management
-- Safety: Research/shadow monitoring only. No paper trades or broker execution.

CREATE TABLE IF NOT EXISTS public.strategy03_monitoring_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id TEXT NOT NULL UNIQUE,
  evaluated_at TIMESTAMPTZ NOT NULL,
  completed_4h_timestamp_ist TEXT NOT NULL,
  candidates_evaluated INTEGER NOT NULL DEFAULT 0,
  ready_count INTEGER NOT NULL DEFAULT 0,
  forming_count INTEGER NOT NULL DEFAULT 0,
  breakout_count INTEGER NOT NULL DEFAULT 0,
  invalidated_count INTEGER NOT NULL DEFAULT 0,
  wait_count INTEGER NOT NULL DEFAULT 0,
  alerts_generated INTEGER NOT NULL DEFAULT 0,
  duplicates_prevented INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.strategy03_candidate_state_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transition_key TEXT NOT NULL UNIQUE,
  symbol TEXT NOT NULL,
  previous_status TEXT,
  current_status TEXT NOT NULL CHECK (current_status IN ('FORMING', 'READY', 'BREAKOUT', 'INVALIDATED', 'WAIT')),
  completed_4h_timestamp_ist TEXT NOT NULL,
  close_price NUMERIC(12,2),
  breakout_boundary NUMERIC(12,2),
  breakout_distance_pct NUMERIC(8,2),
  consolidation_low NUMERIC(12,2),
  consolidation_high NUMERIC(12,2),
  support_low NUMERIC(12,2),
  support_high NUMERIC(12,2),
  ob_low NUMERIC(12,2),
  ob_high NUMERIC(12,2),
  reason TEXT NOT NULL,
  data_freshness TEXT NOT NULL,
  is_candle_complete BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.strategy03_monitoring_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id TEXT NOT NULL UNIQUE,
  symbol TEXT NOT NULL,
  alert_type TEXT NOT NULL,
  previous_status TEXT,
  new_status TEXT NOT NULL,
  completed_4h_timestamp_ist TEXT NOT NULL,
  price NUMERIC(12,2),
  consolidation_low NUMERIC(12,2),
  consolidation_high NUMERIC(12,2),
  support_low NUMERIC(12,2),
  support_high NUMERIC(12,2),
  ob_low NUMERIC(12,2),
  ob_high NUMERIC(12,2),
  reason TEXT NOT NULL,
  source TEXT NOT NULL,
  data_freshness TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_s03_mon_state_sym ON public.strategy03_candidate_state_history (symbol, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_s03_mon_alerts_sym ON public.strategy03_monitoring_alerts (symbol, created_at DESC);

ALTER TABLE public.strategy03_monitoring_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.strategy03_candidate_state_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.strategy03_monitoring_alerts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "s03_mon_runs_service_all" ON public.strategy03_monitoring_runs;
CREATE POLICY "s03_mon_runs_service_all" ON public.strategy03_monitoring_runs FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "s03_mon_runs_auth_read" ON public.strategy03_monitoring_runs;
CREATE POLICY "s03_mon_runs_auth_read" ON public.strategy03_monitoring_runs FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "s03_mon_state_service_all" ON public.strategy03_candidate_state_history;
CREATE POLICY "s03_mon_state_service_all" ON public.strategy03_candidate_state_history FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "s03_mon_state_auth_read" ON public.strategy03_candidate_state_history;
CREATE POLICY "s03_mon_state_auth_read" ON public.strategy03_candidate_state_history FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "s03_mon_alerts_service_all" ON public.strategy03_monitoring_alerts;
CREATE POLICY "s03_mon_alerts_service_all" ON public.strategy03_monitoring_alerts FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "s03_mon_alerts_auth_read" ON public.strategy03_monitoring_alerts;
CREATE POLICY "s03_mon_alerts_auth_read" ON public.strategy03_monitoring_alerts FOR SELECT TO authenticated USING (true);

