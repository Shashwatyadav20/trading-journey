-- Migration: 20260913_nifty_auto_hedge_tables.sql
-- Description: Creates tables for NIFTY Automated Options Hedging System

-- 1. Strategy Signals Table
CREATE TABLE IF NOT EXISTS nifty_signals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  symbol VARCHAR(20) NOT NULL DEFAULT 'NIFTY',
  regime VARCHAR(30) NOT NULL,
  score INT NOT NULL,
  strategy_type VARCHAR(50) NOT NULL,
  expiry DATE NOT NULL,
  sell_strike NUMERIC NOT NULL,
  buy_strike NUMERIC NOT NULL,
  credit NUMERIC NOT NULL,
  max_risk NUMERIC NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'READY',
  reasons JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_nifty_signals_user_id ON nifty_signals(user_id);
CREATE INDEX IF NOT EXISTS idx_nifty_signals_timestamp ON nifty_signals(timestamp DESC);

-- 2. Spread Positions Table
CREATE TABLE IF NOT EXISTS nifty_positions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  signal_id VARCHAR(100),
  symbol VARCHAR(20) NOT NULL DEFAULT 'NIFTY',
  strategy VARCHAR(50) NOT NULL,
  expiry VARCHAR(20) NOT NULL,
  sell_strike NUMERIC NOT NULL,
  buy_strike NUMERIC NOT NULL,
  quantity_lots INT NOT NULL,
  total_quantity INT NOT NULL,
  net_credit NUMERIC NOT NULL,
  max_loss NUMERIC NOT NULL,
  stop_loss_spread NUMERIC NOT NULL,
  target_spread NUMERIC NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'OPEN', -- OPEN, CLOSED, EMERGENCY_EXIT
  mode VARCHAR(10) NOT NULL DEFAULT 'PAPER', -- PAPER or LIVE
  entry_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  exit_time TIMESTAMPTZ,
  realized_gross_pnl NUMERIC,
  total_charges NUMERIC NOT NULL DEFAULT 0,
  realized_net_pnl NUMERIC,
  exit_reason VARCHAR(100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_nifty_positions_user_id ON nifty_positions(user_id);
CREATE INDEX IF NOT EXISTS idx_nifty_positions_status ON nifty_positions(status);

-- 3. Audit Logs Table
CREATE TABLE IF NOT EXISTS nifty_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  event_type VARCHAR(50) NOT NULL,
  trace_id VARCHAR(100) NOT NULL,
  details JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_nifty_audit_logs_trace_id ON nifty_audit_logs(trace_id);
CREATE INDEX IF NOT EXISTS idx_nifty_audit_logs_event_type ON nifty_audit_logs(event_type);
