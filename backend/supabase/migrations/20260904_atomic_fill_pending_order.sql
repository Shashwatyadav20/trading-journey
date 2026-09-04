-- ============================================================================
-- Step 3C-6 Migration: Atomic Fill Pending Order and Create Trade RPC (Hardened)
-- ============================================================================
--
-- This function executes the pending order state transition (PENDING -> FILLED)
-- and trade creation inside a single PostgreSQL database transaction.
--
-- Security Hardening:
-- 1. SECURITY DEFINER with explicit SET search_path = '' to prevent search path hijacking.
-- 2. Schema-qualified table references (public.pending_orders, public.trades).
-- 3. REVOKE EXECUTE from PUBLIC, anon, and authenticated roles to prevent direct RPC access.
-- 4. GRANT EXECUTE to service_role so only backend service-role API calls can execute it.
--
-- Guarantees:
-- 1. Atomic operation: Either BOTH order status is updated to FILLED AND trade
--    is inserted, OR NEITHER persistent change occurs.
-- 2. Concurrency protection: Conditional WHERE status = 'PENDING' ensures
--    only ONE attempt can fill a pending order. Concurrent fill or cancel
--    attempts for the same order will result in exactly 1 winner.
-- 3. Returns TRUE if the order was transitioned and trade created.
--    Returns FALSE if the order was not in PENDING status (already filled/cancelled)
--    or did not belong to p_user_id.

CREATE OR REPLACE FUNCTION public.fill_pending_order_and_create_trade(
  p_order_id UUID,
  p_user_id UUID,
  p_trade_id UUID,
  p_date TEXT,
  p_time TEXT,
  p_symbol TEXT,
  p_side TEXT,
  p_strategy TEXT,
  p_entry_price NUMERIC,
  p_stop_loss NUMERIC,
  p_target_price NUMERIC,
  p_quantity NUMERIC,
  p_order_type TEXT,
  p_created_at TIMESTAMPTZ,
  p_updated_at TIMESTAMPTZ,
  p_fees NUMERIC DEFAULT 0,
  p_r_multiple NUMERIC DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_rows_updated INTEGER;
BEGIN
  -- 1. Conditionally transition pending order status from PENDING -> FILLED
  UPDATE public.pending_orders
  SET status = 'FILLED',
      updated_at = p_updated_at
  WHERE id = p_order_id
    AND user_id = p_user_id
    AND status = 'PENDING';

  GET DIAGNOSTICS v_rows_updated = ROW_COUNT;

  -- 2. If order was not in PENDING state (or didn't exist/belong to user), return FALSE
  IF v_rows_updated = 0 THEN
    RETURN FALSE;
  END IF;

  -- 3. Insert the newly created OPEN trade
  INSERT INTO public.trades (
    id,
    user_id,
    date,
    time,
    symbol,
    side,
    strategy,
    entry_price,
    stop_loss,
    target_price,
    quantity,
    status,
    order_type,
    fees,
    r_multiple,
    created_at,
    updated_at
  ) VALUES (
    p_trade_id,
    p_user_id,
    p_date,
    p_time,
    p_symbol,
    p_side,
    p_strategy,
    p_entry_price,
    p_stop_loss,
    p_target_price,
    p_quantity,
    'OPEN',
    p_order_type,
    p_fees,
    p_r_multiple,
    p_created_at,
    p_updated_at
  );

  RETURN TRUE;
END;
$$;

-- Explicitly revoke execution from PUBLIC, anon, and authenticated roles
REVOKE EXECUTE ON FUNCTION public.fill_pending_order_and_create_trade(
  UUID,
  UUID,
  UUID,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  NUMERIC,
  NUMERIC,
  NUMERIC,
  NUMERIC,
  TEXT,
  TIMESTAMPTZ,
  TIMESTAMPTZ,
  NUMERIC,
  NUMERIC
) FROM PUBLIC;

REVOKE EXECUTE ON FUNCTION public.fill_pending_order_and_create_trade(
  UUID,
  UUID,
  UUID,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  NUMERIC,
  NUMERIC,
  NUMERIC,
  NUMERIC,
  TEXT,
  TIMESTAMPTZ,
  TIMESTAMPTZ,
  NUMERIC,
  NUMERIC
) FROM anon;

REVOKE EXECUTE ON FUNCTION public.fill_pending_order_and_create_trade(
  UUID,
  UUID,
  UUID,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  NUMERIC,
  NUMERIC,
  NUMERIC,
  NUMERIC,
  TEXT,
  TIMESTAMPTZ,
  TIMESTAMPTZ,
  NUMERIC,
  NUMERIC
) FROM authenticated;

-- Explicitly grant execution ONLY to service_role used by backend service-role Supabase client
GRANT EXECUTE ON FUNCTION public.fill_pending_order_and_create_trade(
  UUID,
  UUID,
  UUID,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  NUMERIC,
  NUMERIC,
  NUMERIC,
  NUMERIC,
  TEXT,
  TIMESTAMPTZ,
  TIMESTAMPTZ,
  NUMERIC,
  NUMERIC
) TO service_role;

