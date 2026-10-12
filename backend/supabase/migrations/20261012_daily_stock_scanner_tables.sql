-- Migration: 20261012_daily_stock_scanner_tables.sql
-- Description: Creates tables, indexes, constraints, and RLS policies for Daily Stock Strategy Scanner runs and opportunities

-- 1. Create daily_scan_runs table
CREATE TABLE IF NOT EXISTS daily_scan_runs (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  scan_date DATE NOT NULL,
  scan_type VARCHAR(50) NOT NULL CHECK (scan_type IN ('scheduled', 'manual')),
  status VARCHAR(20) NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'completed', 'partial', 'failed')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  duration_ms INTEGER,
  universe_size INTEGER NOT NULL DEFAULT 0,
  scanned_count INTEGER NOT NULL DEFAULT 0,
  success_count INTEGER NOT NULL DEFAULT 0,
  failure_count INTEGER NOT NULL DEFAULT 0,
  opportunities_found INTEGER NOT NULL DEFAULT 0,
  market_data_timestamp TIMESTAMPTZ,
  error_summary TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for daily_scan_runs
CREATE INDEX IF NOT EXISTS idx_daily_scan_runs_scan_date ON daily_scan_runs(scan_date DESC);
CREATE INDEX IF NOT EXISTS idx_daily_scan_runs_status ON daily_scan_runs(status);
CREATE INDEX IF NOT EXISTS idx_daily_scan_runs_scan_type ON daily_scan_runs(scan_type);
CREATE INDEX IF NOT EXISTS idx_daily_scan_runs_created_at ON daily_scan_runs(created_at DESC);

-- Unique constraint index: prevent duplicate completed or partial scheduled runs for the same date
CREATE UNIQUE INDEX IF NOT EXISTS uq_daily_scan_runs_scheduled_completed_date
  ON daily_scan_runs(scan_date)
  WHERE scan_type = 'scheduled' AND status IN ('completed', 'partial');

-- 2. Create daily_scan_opportunities table
CREATE TABLE IF NOT EXISTS daily_scan_opportunities (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  scan_run_id TEXT NOT NULL REFERENCES daily_scan_runs(id) ON DELETE CASCADE,
  trading_date DATE NOT NULL,
  symbol VARCHAR(30) NOT NULL,
  exchange VARCHAR(20) NOT NULL DEFAULT 'NSE',
  current_price NUMERIC(12, 2) NOT NULL,
  primary_strategy VARCHAR(100) NOT NULL,
  matched_strategies JSONB NOT NULL DEFAULT '[]'::jsonb,
  signal_direction VARCHAR(10) NOT NULL DEFAULT 'LONG',
  entry_price NUMERIC(12, 2),
  entry_zone JSONB,
  stop_loss NUMERIC(12, 2) NOT NULL,
  target_1 NUMERIC(12, 2) NOT NULL,
  target_2 NUMERIC(12, 2),
  reward_risk_ratio NUMERIC(6, 2) NOT NULL,
  confluence_score NUMERIC(5, 2) NOT NULL,
  indicator_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  signal_status VARCHAR(30) NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for daily_scan_opportunities
CREATE INDEX IF NOT EXISTS idx_daily_scan_opp_scan_run_id ON daily_scan_opportunities(scan_run_id);
CREATE INDEX IF NOT EXISTS idx_daily_scan_opp_trading_date ON daily_scan_opportunities(trading_date DESC);
CREATE INDEX IF NOT EXISTS idx_daily_scan_opp_symbol ON daily_scan_opportunities(symbol);
CREATE INDEX IF NOT EXISTS idx_daily_scan_opp_primary_strategy ON daily_scan_opportunities(primary_strategy);

-- Unique index to prevent duplicate opportunities for the same run, symbol, and strategy
CREATE UNIQUE INDEX IF NOT EXISTS uq_daily_scan_opp_run_sym_strat
  ON daily_scan_opportunities(scan_run_id, symbol, primary_strategy);

-- 3. Row Level Security (RLS) Configuration
ALTER TABLE daily_scan_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_scan_opportunities ENABLE ROW LEVEL SECURITY;

-- Read policies: allow anon and authenticated users to query scan runs and opportunities
DROP POLICY IF EXISTS "Allow public read access to daily_scan_runs" ON daily_scan_runs;
CREATE POLICY "Allow public read access to daily_scan_runs"
  ON daily_scan_runs FOR SELECT
  TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS "Allow public read access to daily_scan_opportunities" ON daily_scan_opportunities;
CREATE POLICY "Allow public read access to daily_scan_opportunities"
  ON daily_scan_opportunities FOR SELECT
  TO anon, authenticated
  USING (true);

-- Write policies: restricted strictly to backend service_role
DROP POLICY IF EXISTS "Allow service_role full access to daily_scan_runs" ON daily_scan_runs;
CREATE POLICY "Allow service_role full access to daily_scan_runs"
  ON daily_scan_runs FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Allow service_role full access to daily_scan_opportunities" ON daily_scan_opportunities;
CREATE POLICY "Allow service_role full access to daily_scan_opportunities"
  ON daily_scan_opportunities FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ─────────────────────────────────────────────────────────────────────────────
-- Down Migration (Rollback Procedure):
-- DROP POLICY IF EXISTS "Allow service_role full access to daily_scan_opportunities" ON daily_scan_opportunities;
-- DROP POLICY IF EXISTS "Allow service_role full access to daily_scan_runs" ON daily_scan_runs;
-- DROP POLICY IF EXISTS "Allow public read access to daily_scan_opportunities" ON daily_scan_opportunities;
-- DROP POLICY IF EXISTS "Allow public read access to daily_scan_runs" ON daily_scan_runs;
-- DROP TABLE IF EXISTS daily_scan_opportunities CASCADE;
-- DROP TABLE IF EXISTS daily_scan_runs CASCADE;
