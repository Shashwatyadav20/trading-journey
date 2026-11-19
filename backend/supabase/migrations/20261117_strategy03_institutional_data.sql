-- Phase 6.1 — Strategy 03 Institutional & Corporate Data Acquisition Tables
-- Research infrastructure only. Does not activate Strategy 03 or create paper trades.

CREATE TABLE IF NOT EXISTS strategy03_delivery_data (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol TEXT NOT NULL,
  series TEXT NOT NULL,
  trading_date DATE NOT NULL,
  close_price NUMERIC,
  traded_qty BIGINT NOT NULL CHECK (traded_qty >= 0),
  delivery_qty BIGINT CHECK (delivery_qty IS NULL OR delivery_qty >= 0),
  delivery_pct NUMERIC,
  turnover_lacs NUMERIC,
  source_name TEXT NOT NULL,
  source_url TEXT NOT NULL,
  published_at TIMESTAMPTZ,
  retrieved_at TIMESTAMPTZ NOT NULL,
  verification_status TEXT NOT NULL CHECK (verification_status IN ('VERIFIED', 'UNVERIFIED', 'MISSING', 'STALE', 'CONFLICTED')),
  confidence NUMERIC NOT NULL DEFAULT 1.0,
  has_source_conflict BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (symbol, series, trading_date)
);

CREATE INDEX IF NOT EXISTS idx_s03_delivery_symbol_date
  ON strategy03_delivery_data (symbol, trading_date DESC);

CREATE TABLE IF NOT EXISTS strategy03_bulk_block_deals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  exchange TEXT NOT NULL CHECK (exchange IN ('NSE', 'BSE')),
  deal_type TEXT NOT NULL CHECK (deal_type IN ('BULK', 'BLOCK')),
  trading_date DATE NOT NULL,
  symbol TEXT NOT NULL,
  security_name TEXT,
  client_name TEXT NOT NULL,
  client_category TEXT NOT NULL DEFAULT 'UNKNOWN',
  side TEXT NOT NULL CHECK (side IN ('BUY', 'SELL')),
  quantity BIGINT NOT NULL CHECK (quantity > 0),
  price NUMERIC NOT NULL CHECK (price > 0),
  remarks TEXT,
  source_name TEXT NOT NULL,
  source_url TEXT NOT NULL,
  retrieved_at TIMESTAMPTZ NOT NULL,
  verification_status TEXT NOT NULL CHECK (verification_status IN ('VERIFIED', 'UNVERIFIED', 'MISSING', 'STALE', 'CONFLICTED')),
  confidence NUMERIC NOT NULL DEFAULT 1.0,
  has_source_conflict BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (exchange, deal_type, trading_date, symbol, client_name, side, quantity, price)
);

CREATE INDEX IF NOT EXISTS idx_s03_deals_symbol_date
  ON strategy03_bulk_block_deals (symbol, trading_date DESC);

CREATE TABLE IF NOT EXISTS strategy03_shareholding_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol TEXT NOT NULL,
  reporting_quarter TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  promoter_pct NUMERIC,
  fii_pct NUMERIC,
  dii_pct NUMERIC,
  mutual_fund_pct NUMERIC,
  public_pct NUMERIC,
  promoter_pledged_pct NUMERIC,
  total_reported_pct NUMERIC,
  is_plausible_sum BOOLEAN NOT NULL DEFAULT FALSE,
  source_name TEXT NOT NULL,
  source_url TEXT NOT NULL,
  published_at TIMESTAMPTZ,
  retrieved_at TIMESTAMPTZ NOT NULL,
  verification_status TEXT NOT NULL CHECK (verification_status IN ('VERIFIED', 'UNVERIFIED', 'MISSING', 'STALE', 'CONFLICTED')),
  confidence NUMERIC NOT NULL DEFAULT 0.0,
  has_source_conflict BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (symbol, reporting_quarter, version)
);

CREATE INDEX IF NOT EXISTS idx_s03_shareholding_symbol_qtr
  ON strategy03_shareholding_history (symbol, reporting_quarter DESC, version DESC);

CREATE TABLE IF NOT EXISTS strategy03_corporate_announcements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  exchange TEXT NOT NULL CHECK (exchange IN ('NSE', 'BSE')),
  filing_id TEXT NOT NULL,
  symbol TEXT NOT NULL,
  company_name TEXT,
  category TEXT NOT NULL,
  headline TEXT NOT NULL,
  extracted_text TEXT,
  source_url TEXT NOT NULL,
  published_at TIMESTAMPTZ,
  retrieved_at TIMESTAMPTZ NOT NULL,
  verification_status TEXT NOT NULL CHECK (verification_status IN ('VERIFIED', 'UNVERIFIED', 'MISSING', 'STALE', 'CONFLICTED')),
  extraction_confidence NUMERIC NOT NULL DEFAULT 0.0,
  is_ambiguous BOOLEAN NOT NULL DEFAULT FALSE,
  has_source_conflict BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (exchange, filing_id)
);

CREATE INDEX IF NOT EXISTS idx_s03_ann_symbol_pub
  ON strategy03_corporate_announcements (symbol, published_at DESC);

CREATE TABLE IF NOT EXISTS strategy03_data_collection_runs (
  run_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status TEXT NOT NULL CHECK (status IN ('RUNNING', 'COMPLETED', 'PARTIAL', 'FAILED')),
  total_universe_symbols INTEGER NOT NULL DEFAULT 0,
  delivery_symbols_count INTEGER NOT NULL DEFAULT 0,
  shareholding_symbols_count INTEGER NOT NULL DEFAULT 0,
  fii_symbols_count INTEGER NOT NULL DEFAULT 0,
  dii_symbols_count INTEGER NOT NULL DEFAULT 0,
  mf_symbols_count INTEGER NOT NULL DEFAULT 0,
  pledge_symbols_count INTEGER NOT NULL DEFAULT 0,
  bulk_block_symbols_count INTEGER NOT NULL DEFAULT 0,
  announcement_symbols_count INTEGER NOT NULL DEFAULT 0,
  stale_or_missing_count INTEGER NOT NULL DEFAULT 0,
  failures JSONB NOT NULL DEFAULT '[]'::jsonb,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

ALTER TABLE strategy03_delivery_data ENABLE ROW LEVEL SECURITY;
ALTER TABLE strategy03_bulk_block_deals ENABLE ROW LEVEL SECURITY;
ALTER TABLE strategy03_shareholding_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE strategy03_corporate_announcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE strategy03_data_collection_runs ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'strategy03_delivery_data' AND policyname = 'service_role_all_s03_delivery') THEN
    CREATE POLICY service_role_all_s03_delivery ON strategy03_delivery_data FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'strategy03_bulk_block_deals' AND policyname = 'service_role_all_s03_deals') THEN
    CREATE POLICY service_role_all_s03_deals ON strategy03_bulk_block_deals FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'strategy03_shareholding_history' AND policyname = 'service_role_all_s03_shareholding') THEN
    CREATE POLICY service_role_all_s03_shareholding ON strategy03_shareholding_history FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'strategy03_corporate_announcements' AND policyname = 'service_role_all_s03_ann') THEN
    CREATE POLICY service_role_all_s03_ann ON strategy03_corporate_announcements FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'strategy03_data_collection_runs' AND policyname = 'service_role_all_s03_runs') THEN
    CREATE POLICY service_role_all_s03_runs ON strategy03_data_collection_runs FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
  END IF;
END $$;

