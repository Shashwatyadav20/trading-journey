-- =============================================================================
-- Migration: 20261013_swing_scan_runs.sql
-- Description: Creates the swing scanner run-log table for the NSE cash-market
--              swing scanner (nse-scanner endpoint).
--
-- Security model (matches existing project pattern):
--   - RLS enabled: anon and authenticated roles have NO access.
--   - service_role bypasses RLS and is the only write path (server-side only).
--   - A read-only SELECT policy is granted to authenticated users on their own
--     data (scanner results are not user-scoped, so a broad SELECT on service
--     role is the right choice for a scanner dashboard).
--   - The browser never receives the service_role key; writes go through the
--     Next.js API route only.
--
-- Columns match exactly what nse-scanner/route.ts inserts:
--   scan_date, run_at, status, universe_source, universe_size,
--   scanned_count, skipped_count, failed_count, opportunities_count,
--   opportunities (JSONB), diagnostics (JSONB), metadata (JSONB)
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- Table
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.swing_scan_runs (
  -- Surrogate primary key
  id                  UUID          PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Scan identity
  scan_date           DATE          NOT NULL,
  run_at              TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  -- Run status: COMPLETED | PARTIAL | FAILED
  -- PARTIAL = at least one symbol fetch failed; results still written.
  -- FAILED  = scanner could not complete (universe fetch failure, etc.)
  status              VARCHAR(20)   NOT NULL
                        CHECK (status IN ('COMPLETED', 'PARTIAL', 'FAILED')),

  -- Universe source: NSE_CSV | FALLBACK_NIFTY_500
  universe_source     VARCHAR(30)   NOT NULL
                        CHECK (universe_source IN ('NSE_CSV', 'FALLBACK_NIFTY_500')),

  -- Coverage counts (never NULL; 0 is valid)
  universe_size       INT           NOT NULL DEFAULT 0,
  scanned_count       INT           NOT NULL DEFAULT 0,
  skipped_count       INT           NOT NULL DEFAULT 0,
  failed_count        INT           NOT NULL DEFAULT 0,
  opportunities_count INT           NOT NULL DEFAULT 0,

  -- Full opportunity list as JSONB (each element matches MatchedStockOpportunity)
  opportunities       JSONB         NOT NULL DEFAULT '[]'::jsonb,

  -- Diagnostics: { failedSymbols[], skippedSymbols[], warnings[] }
  diagnostics         JSONB         NOT NULL DEFAULT '{}'::jsonb,

  -- Run metadata: { scanDurationMs, dataProvider, universeMetadata, marketRegime }
  metadata            JSONB         NOT NULL DEFAULT '{}'::jsonb,

  -- Audit timestamps
  created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- COMMENT ON is idempotent (replaces any existing comment). Safe to re-run.
COMMENT ON TABLE public.swing_scan_runs IS
  'Append-only log of every NSE cash-market swing scanner run. '
  'Written server-side via service_role key only. Browser has no write access.';

COMMENT ON COLUMN public.swing_scan_runs.status IS
  'COMPLETED = all symbols scanned. PARTIAL = some failed. FAILED = scan did not complete.';

COMMENT ON COLUMN public.swing_scan_runs.opportunities IS
  'Array of MatchedStockOpportunity objects. Empty array when no stocks qualify.';

COMMENT ON COLUMN public.swing_scan_runs.diagnostics IS
  'Scanner diagnostics: failed symbols, skipped symbols, warnings.';

-- ─────────────────────────────────────────────────────────────────────────────
-- Indexes
-- ─────────────────────────────────────────────────────────────────────────────

-- Most dashboard queries sort by most recent run
CREATE INDEX IF NOT EXISTS idx_swing_scan_runs_run_at
  ON public.swing_scan_runs (run_at DESC);

-- Deduplication guard: check if today already has a completed scan
CREATE INDEX IF NOT EXISTS idx_swing_scan_runs_scan_date
  ON public.swing_scan_runs (scan_date DESC);

-- Filter by status (PARTIAL vs COMPLETED)
CREATE INDEX IF NOT EXISTS idx_swing_scan_runs_status
  ON public.swing_scan_runs (status);

-- GIN index for JSONB opportunity search (symbol lookups, strategy filter)
CREATE INDEX IF NOT EXISTS idx_swing_scan_runs_opportunities_gin
  ON public.swing_scan_runs USING gin (opportunities);

-- ─────────────────────────────────────────────────────────────────────────────
-- Row Level Security
-- ─────────────────────────────────────────────────────────────────────────────

-- Note: ALTER TABLE ... ENABLE ROW LEVEL SECURITY is idempotent (no-op if already enabled).
ALTER TABLE public.swing_scan_runs ENABLE ROW LEVEL SECURITY;

-- Deny all access by default (RLS with no permissive policies = deny-all)
-- service_role bypasses RLS automatically in Supabase — no explicit policy needed for writes.

-- Idempotent policy creation: check pg_policies before creating each policy.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'swing_scan_runs'
      AND policyname = 'swing_scan_runs_authenticated_read'
  ) THEN
    CREATE POLICY "swing_scan_runs_authenticated_read"
      ON public.swing_scan_runs
      FOR SELECT
      TO authenticated
      USING (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'swing_scan_runs'
      AND policyname = 'swing_scan_runs_anon_read'
  ) THEN
    CREATE POLICY "swing_scan_runs_anon_read"
      ON public.swing_scan_runs
      FOR SELECT
      TO anon
      USING (true);
  END IF;
END $$;

-- No INSERT / UPDATE / DELETE policies for authenticated or anon roles.
-- All writes go through service_role from the server-side Next.js route.

-- ─────────────────────────────────────────────────────────────────────────────
-- Explicit permission grants (belt-and-suspenders)
-- ─────────────────────────────────────────────────────────────────────────────

-- Revoke all write permissions from non-service roles
REVOKE INSERT, UPDATE, DELETE ON public.swing_scan_runs FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.swing_scan_runs FROM authenticated;

-- Grant service_role full access (it bypasses RLS anyway, but be explicit)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.swing_scan_runs TO service_role;

-- Grant read access to authenticated and anon (controlled by RLS above)
GRANT SELECT ON public.swing_scan_runs TO authenticated;
GRANT SELECT ON public.swing_scan_runs TO anon;

-- ─────────────────────────────────────────────────────────────────────────────
-- Verification query (run after applying migration to confirm)
-- ─────────────────────────────────────────────────────────────────────────────
-- SELECT table_name, column_name, data_type, is_nullable
-- FROM information_schema.columns
-- WHERE table_name = 'swing_scan_runs'
-- ORDER BY ordinal_position;
