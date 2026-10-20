-- =============================================================================
-- Migration: 20261020_scan_alerts.sql
-- Description: Scan alert log for success/failure/stall notifications.
--
-- Phase 1: Console + DB log only (no external webhook dependency).
-- Phase 2: Webhook URL can be set in env to dispatch to Telegram/Slack.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.scan_alerts (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Alert classification
  alert_type  VARCHAR(30) NOT NULL
                CHECK (alert_type IN ('SCAN_COMPLETED','SCAN_PARTIAL','SCAN_FAILED','SCAN_STALLED','SCHEDULER_SKIPPED','SCHEDULER_TRIGGERED')),

  -- Context
  scan_date   DATE        NOT NULL,
  job_id      UUID,       -- References swing_scan_jobs.id (soft FK)

  -- Human-readable summary line
  summary     TEXT        NOT NULL,

  -- Structured detail payload (coverage counts, error messages, etc.)
  details     JSONB       NOT NULL DEFAULT '{}',

  -- External delivery status
  webhook_sent      BOOLEAN     NOT NULL DEFAULT false,
  webhook_error     TEXT,

  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.scan_alerts IS
  'Operational alert log for NSE scanner events. Written by ScanAlertService. '
  'External webhook delivery (Telegram/Slack) is tracked via webhook_sent flag.';

CREATE INDEX IF NOT EXISTS idx_scan_alerts_date
  ON public.scan_alerts (scan_date DESC);

CREATE INDEX IF NOT EXISTS idx_scan_alerts_type
  ON public.scan_alerts (alert_type, created_at DESC);

ALTER TABLE public.scan_alerts ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'scan_alerts'
      AND policyname = 'scan_alerts_authenticated_read'
  ) THEN
    CREATE POLICY "scan_alerts_authenticated_read"
      ON public.scan_alerts FOR SELECT TO authenticated USING (true);
  END IF;
END $$;

REVOKE INSERT, UPDATE, DELETE ON public.scan_alerts FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.scan_alerts FROM authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.scan_alerts TO service_role;
GRANT SELECT ON public.scan_alerts TO authenticated;
