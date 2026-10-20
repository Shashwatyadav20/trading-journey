-- =============================================================================
-- Migration: 20261020_swing_scan_opportunities.sql
-- Description: Normalized, queryable opportunities table for the NSE swing scanner.
--
-- Rationale:
--   The existing swing_scan_runs.opportunities column stores all opportunities
--   as a single JSONB blob. That makes cross-day queries (e.g. "all RELIANCE
--   signals in the last 30 days") and aggregations very expensive. This table
--   stores each opportunity as a first-class row while keeping a FK back to
--   the parent run for auditing.
--
-- Security model: matches swing_scan_runs (service_role write, read-only for others).
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.swing_scan_opportunities (
  id                  UUID          PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Parent run reference (soft FK — run may not exist if we later add a hard FK)
  run_id              UUID          REFERENCES public.swing_scan_runs(id) ON DELETE CASCADE,

  -- Scan context
  scan_date           DATE          NOT NULL,

  -- Symbol identity
  symbol              VARCHAR(30)   NOT NULL,
  clean_symbol        VARCHAR(30)   NOT NULL,
  company_name        TEXT,

  -- Strategy result
  primary_strategy_id VARCHAR(50)   NOT NULL,
  matched_strategies  JSONB         NOT NULL DEFAULT '[]',
  confluence_score    SMALLINT      NOT NULL CHECK (confluence_score BETWEEN 0 AND 100),
  is_multi_strategy   BOOLEAN       NOT NULL DEFAULT false,
  matched_count       SMALLINT      NOT NULL DEFAULT 1,
  confirmation_status VARCHAR(20)   NOT NULL DEFAULT 'DEVELOPING'
                        CHECK (confirmation_status IN ('CONFIRMED','DEVELOPING','WATCHLIST')),

  -- Pricing (all in INR)
  current_price       NUMERIC(12,2) NOT NULL,
  entry_trigger       NUMERIC(12,2) NOT NULL,
  stop_loss           NUMERIC(12,2) NOT NULL,
  target_1            NUMERIC(12,2) NOT NULL,
  target_2            NUMERIC(12,2),
  risk_per_share      NUMERIC(12,2),
  reward_risk_ratio   NUMERIC(5,2)  NOT NULL,

  -- Trend / momentum context
  rsi                 NUMERIC(5,1),
  trend_strength      VARCHAR(30),

  -- Full opportunity JSONB (for UI rendering — avoids extra roundtrip to run table)
  opportunity_json    JSONB         NOT NULL DEFAULT '{}',

  -- Audit
  created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.swing_scan_opportunities IS
  'Normalized per-opportunity rows from the NSE swing scanner. '
  'Written alongside the parent swing_scan_runs row. Enables cross-day symbol queries.';

-- ─────────────────────────────────────────────────────────────────────────────
-- Indexes
-- ─────────────────────────────────────────────────────────────────────────────

-- Most recent signals for a given symbol (dashboard symbol lookup)
CREATE INDEX IF NOT EXISTS idx_scan_opp_symbol_date
  ON public.swing_scan_opportunities (clean_symbol, scan_date DESC);

-- All opportunities on a given day sorted by score (main dashboard view)
CREATE INDEX IF NOT EXISTS idx_scan_opp_date_score
  ON public.swing_scan_opportunities (scan_date DESC, confluence_score DESC);

-- Filter by strategy across all dates
CREATE INDEX IF NOT EXISTS idx_scan_opp_strategy_date
  ON public.swing_scan_opportunities (primary_strategy_id, scan_date DESC);

-- Multi-strategy filter
CREATE INDEX IF NOT EXISTS idx_scan_opp_multi
  ON public.swing_scan_opportunities (is_multi_strategy, scan_date DESC);

-- Parent run join
CREATE INDEX IF NOT EXISTS idx_scan_opp_run_id
  ON public.swing_scan_opportunities (run_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- Row Level Security
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.swing_scan_opportunities ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'swing_scan_opportunities'
      AND policyname = 'swing_scan_opp_authenticated_read'
  ) THEN
    CREATE POLICY "swing_scan_opp_authenticated_read"
      ON public.swing_scan_opportunities FOR SELECT TO authenticated USING (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'swing_scan_opportunities'
      AND policyname = 'swing_scan_opp_anon_read'
  ) THEN
    CREATE POLICY "swing_scan_opp_anon_read"
      ON public.swing_scan_opportunities FOR SELECT TO anon USING (true);
  END IF;
END $$;

REVOKE INSERT, UPDATE, DELETE ON public.swing_scan_opportunities FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.swing_scan_opportunities FROM authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.swing_scan_opportunities TO service_role;
GRANT SELECT ON public.swing_scan_opportunities TO authenticated;
GRANT SELECT ON public.swing_scan_opportunities TO anon;
