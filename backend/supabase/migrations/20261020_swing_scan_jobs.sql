-- =============================================================================
-- Migration: 20261020_swing_scan_jobs.sql
-- Description: Async worker job control-plane table for the NSE full-universe
--              swing scanner. Each scan run is represented by a row here.
--
-- Design:
--   - A UNIQUE INDEX prevents two QUEUED/RUNNING jobs on the same scan_date.
--   - The distributed lock (lock_holder_id + lock_expires_at) is renewed every
--     60 s by the worker heartbeat. A stale job (lock expired, status=RUNNING)
--     is auto-detected by the /start handler and marked FAILED before a new
--     run is allowed.
--   - Checkpoint fields allow resume after an interrupted scan.
--
-- Security model (matches existing project pattern):
--   - RLS enabled; anon/authenticated roles can SELECT (dashboard reads).
--   - service_role is the only write path (scanner worker, server-side only).
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- Table
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.swing_scan_jobs (
  -- Surrogate primary key
  id                        UUID          PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Scan identity
  scan_date                 DATE          NOT NULL,

  -- Lifecycle status
  status                    VARCHAR(20)   NOT NULL
                              CHECK (status IN ('QUEUED','RUNNING','COMPLETED','PARTIAL','FAILED','ABORTED')),

  -- Timestamps
  started_at                TIMESTAMPTZ,
  completed_at              TIMESTAMPTZ,
  created_at                TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  -- Distributed lock (heartbeat-renewed every 60 s)
  lock_holder_id            UUID,         -- Unique ID per backend process instance
  lock_acquired_at          TIMESTAMPTZ,
  lock_expires_at           TIMESTAMPTZ,  -- Extended by heartbeat; NOW() + 15min

  -- Real-time progress (updated with each checkpoint)
  symbols_total             INT           NOT NULL DEFAULT 0,
  symbols_processed         INT           NOT NULL DEFAULT 0,
  symbols_success           INT           NOT NULL DEFAULT 0,
  symbols_skipped           INT           NOT NULL DEFAULT 0,
  symbols_failed            INT           NOT NULL DEFAULT 0,
  current_batch             INT           NOT NULL DEFAULT 0,
  total_batches             INT           NOT NULL DEFAULT 0,

  -- Checkpoint: index of last successfully processed symbol (0-indexed into universe array).
  -- Used to skip already-scanned symbols on resume.
  last_checkpoint_index     INT           NOT NULL DEFAULT 0,

  -- Checkpoint payload: partial opportunities + failure lists collected so far.
  -- Written every 25 batches. Allows merging into final result on resume.
  checkpoint_data           JSONB         NOT NULL DEFAULT '{}',

  -- Job configuration (dry_run, max_symbols, force_universe, etc.)
  config                    JSONB         NOT NULL DEFAULT '{}',

  -- Error details (for FAILED status)
  error_message             TEXT,

  -- Which run record was written to swing_scan_runs (FK is soft — run may not exist if failed before writing)
  scan_run_id               UUID
);

COMMENT ON TABLE public.swing_scan_jobs IS
  'Control-plane table for the async NSE full-universe swing scanner worker. '
  'One row per scan attempt. Manages distributed locking, live progress, and checkpoint/resume.';

COMMENT ON COLUMN public.swing_scan_jobs.lock_holder_id IS
  'Unique UUID generated per backend process at startup. Used to verify heartbeat ownership.';

COMMENT ON COLUMN public.swing_scan_jobs.lock_expires_at IS
  'Renewed every 60s by the running worker. A job whose lock_expires_at < NOW() and status=RUNNING is considered stale.';

COMMENT ON COLUMN public.swing_scan_jobs.last_checkpoint_index IS
  'Index (0-based) into the ordered symbol universe array. Resume starts from this index.';

COMMENT ON COLUMN public.swing_scan_jobs.checkpoint_data IS
  'Partial scan results saved every 25 batches. Schema: { partialOpportunities[], failedSymbols[], skippedSymbols[], niftyBenchmark{} }';

-- ─────────────────────────────────────────────────────────────────────────────
-- Unique constraint: only one QUEUED or RUNNING job per day
-- (Prevents duplicate scans across multiple backend instances)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE UNIQUE INDEX IF NOT EXISTS idx_swing_scan_jobs_one_active_per_day
  ON public.swing_scan_jobs (scan_date)
  WHERE status IN ('QUEUED', 'RUNNING');

-- ─────────────────────────────────────────────────────────────────────────────
-- Supporting indexes
-- ─────────────────────────────────────────────────────────────────────────────

-- Dashboard: most recent runs first
CREATE INDEX IF NOT EXISTS idx_swing_scan_jobs_created_at
  ON public.swing_scan_jobs (created_at DESC);

-- /start: find today's jobs quickly
CREATE INDEX IF NOT EXISTS idx_swing_scan_jobs_scan_date
  ON public.swing_scan_jobs (scan_date DESC);

-- Status filter
CREATE INDEX IF NOT EXISTS idx_swing_scan_jobs_status
  ON public.swing_scan_jobs (status, scan_date DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- Row Level Security
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.swing_scan_jobs ENABLE ROW LEVEL SECURITY;

-- service_role bypasses RLS — all writes go through service_role only.

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'swing_scan_jobs'
      AND policyname = 'swing_scan_jobs_authenticated_read'
  ) THEN
    CREATE POLICY "swing_scan_jobs_authenticated_read"
      ON public.swing_scan_jobs FOR SELECT TO authenticated USING (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'swing_scan_jobs'
      AND policyname = 'swing_scan_jobs_anon_read'
  ) THEN
    CREATE POLICY "swing_scan_jobs_anon_read"
      ON public.swing_scan_jobs FOR SELECT TO anon USING (true);
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Explicit grants
-- ─────────────────────────────────────────────────────────────────────────────

REVOKE INSERT, UPDATE, DELETE ON public.swing_scan_jobs FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.swing_scan_jobs FROM authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.swing_scan_jobs TO service_role;
GRANT SELECT ON public.swing_scan_jobs TO authenticated;
GRANT SELECT ON public.swing_scan_jobs TO anon;
