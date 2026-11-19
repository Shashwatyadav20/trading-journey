-- Phase 6.3 — Strategy 03 AI Institutional Growth Research Evaluations (RESEARCH_ONLY)
-- Never creates paper or live orders.

CREATE TABLE IF NOT EXISTS strategy03_research_evaluations (
  evaluation_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  symbol TEXT NOT NULL,
  isin TEXT,
  company_name TEXT NOT NULL,
  decision TEXT NOT NULL CHECK (decision IN ('ENTER_CANDIDATE', 'WAIT', 'REJECT')),
  total_score NUMERIC NOT NULL CHECK (total_score >= 0 AND total_score <= 100),
  factor_scores JSONB NOT NULL DEFAULT '{}'::jsonb,
  evidence_summary JSONB NOT NULL DEFAULT '[]'::jsonb,
  positive_factors JSONB NOT NULL DEFAULT '[]'::jsonb,
  negative_factors JSONB NOT NULL DEFAULT '[]'::jsonb,
  missing_data JSONB NOT NULL DEFAULT '[]'::jsonb,
  conflicts JSONB NOT NULL DEFAULT '[]'::jsonb,
  source_references JSONB NOT NULL DEFAULT '[]'::jsonb,
  confidence NUMERIC NOT NULL DEFAULT 0.0,
  decision_explanation TEXT NOT NULL,
  evaluated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_s03_eval_symbol_time
  ON strategy03_research_evaluations (symbol, evaluated_at DESC);

CREATE INDEX IF NOT EXISTS idx_s03_eval_score
  ON strategy03_research_evaluations (decision, total_score DESC);

ALTER TABLE strategy03_research_evaluations ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'strategy03_research_evaluations' AND policyname = 'service_role_all_s03_evals'
  ) THEN
    CREATE POLICY service_role_all_s03_evals
      ON strategy03_research_evaluations
      FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
  END IF;
END $$;

