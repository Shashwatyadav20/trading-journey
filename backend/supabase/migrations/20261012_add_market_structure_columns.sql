-- Migration: 20261012_add_market_structure_columns.sql
-- Description: Extends daily stock scanner persistence with market structure, liquidity sweeps, and CHOCH support.
-- Note: indicator_snapshot JSONB already natively stores market structure objects:
--   - confirmed swing levels
--   - PWH (Previous Week High) and PWL (Previous Week Low)
--   - EQH (Equal Highs) and EQL (Equal Lows)
--   - liquidity sweep events (direction, swept level, type, wick penetration, close confirmation)
--   - CHOCH events (direction, broken level, confirmation price, timestamp)
--
-- This migration optionally adds generated columns and indexes on daily_scan_opportunities for high-performance filtering.

-- 1. Optional indexed expression or column for liquidity sweep presence
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'daily_scan_opportunities' AND column_name = 'liquidity_sweep_direction'
  ) THEN
    ALTER TABLE daily_scan_opportunities
    ADD COLUMN liquidity_sweep_direction VARCHAR(10)
    GENERATED ALWAYS AS (indicator_snapshot->'liquiditySweep'->>'direction') STORED;
  END IF;
END $$;

-- 2. Optional indexed expression or column for CHOCH direction
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'daily_scan_opportunities' AND column_name = 'choch_direction'
  ) THEN
    ALTER TABLE daily_scan_opportunities
    ADD COLUMN choch_direction VARCHAR(10)
    GENERATED ALWAYS AS (indicator_snapshot->'choch'->>'direction') STORED;
  END IF;
END $$;

-- 3. Create indexes for quick structure filtering
CREATE INDEX IF NOT EXISTS idx_daily_scan_opp_sweep_dir
  ON daily_scan_opportunities(liquidity_sweep_direction)
  WHERE liquidity_sweep_direction IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_daily_scan_opp_choch_dir
  ON daily_scan_opportunities(choch_direction)
  WHERE choch_direction IS NOT NULL;

-- 4. GIN Index on indicator_snapshot for rich JSONB queries (e.g. search by PWH/PWL or levelType)
CREATE INDEX IF NOT EXISTS idx_daily_scan_opp_indicator_snapshot_gin
  ON daily_scan_opportunities USING gin(indicator_snapshot);

COMMENT ON COLUMN daily_scan_opportunities.indicator_snapshot IS
'Stores full indicators and market structure snapshot: ema20, ema50, ema200, rsi, macd, pwh, pwl, equalHighs, equalLows, liquiditySweep, choch, and 5-pillar checklist.';
