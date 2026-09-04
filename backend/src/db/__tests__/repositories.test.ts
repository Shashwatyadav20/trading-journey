import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { tradeRepository } from "../TradeRepository";
import { pendingOrderRepository } from "../PendingOrderRepository";
import { Position, PendingOrder } from "../../trading/types";

// Mock the Supabase client
const chainable: any = {
  then: vi.fn((resolve) => resolve({ data: null, error: null }))
};

chainable.select = vi.fn(() => chainable);
chainable.insert = vi.fn(() => chainable);
chainable.update = vi.fn(() => chainable);
chainable.eq = vi.fn(() => chainable);
chainable.maybeSingle = vi.fn(() => chainable);

const mockSupabaseClient = {
  from: vi.fn(() => chainable),
};

vi.mock("../supabaseClient", () => ({
  getAdminSupabaseClient: () => mockSupabaseClient,
}));

describe("Step 3C-2: Repository Layer & Supabase Database Integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const USER_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  const USER_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

  const dummyPosition: Position = {
    id: "pos-1",
    userId: USER_A,
    instrument: "BTC/USD",
    side: "LONG",
    quantity: 1,
    entryPrice: 50000,
    entryTime: "2026-09-01T10:00:00.000Z",
    status: "OPEN",
    unrealizedPnl: 0,
    createdAt: "2026-09-01T10:00:00.000Z",
    updatedAt: "2026-09-01T10:00:00.000Z",
  };

  const dummyPendingOrder: PendingOrder = {
    id: "po-1",
    userId: USER_A,
    instrument: "BTC/USD",
    side: "LONG",
    quantity: 1,
    limitPrice: 49000,
    status: "PENDING",
    createdAt: "2026-09-01T10:00:00.000Z",
    updatedAt: "2026-09-01T10:00:00.000Z",
  };

  // 1. Correct userId is included in SELECT queries.
  it("1. Correct userId is included in SELECT queries", async () => {
    chainable.then.mockImplementationOnce((resolve: any) => resolve({ data: null, error: null }));
    await tradeRepository.findById(USER_A, "pos-1");
    expect(chainable.eq).toHaveBeenCalledWith("user_id", USER_A);
    expect(chainable.eq).toHaveBeenCalledWith("id", "pos-1");

    chainable.then.mockImplementationOnce((resolve: any) => resolve({ data: null, error: null }));
    await pendingOrderRepository.findById(USER_A, "po-1");
    expect(chainable.eq).toHaveBeenCalledWith("user_id", USER_A);
    expect(chainable.eq).toHaveBeenCalledWith("id", "po-1");
  });

  // 2. Correct userId is included in INSERT data.
  it("2. Correct userId is included in INSERT data", async () => {
    chainable.then.mockImplementationOnce((resolve: any) => resolve({ error: null }));
    await tradeRepository.insert(USER_A, dummyPosition);
    expect(chainable.insert).toHaveBeenCalledWith(expect.objectContaining({ user_id: USER_A }));

    chainable.then.mockImplementationOnce((resolve: any) => resolve({ error: null }));
    await pendingOrderRepository.insert(USER_A, dummyPendingOrder);
    expect(chainable.insert).toHaveBeenCalledWith(expect.objectContaining({ user_id: USER_A }));
  });

  // 3. Correct userId ownership is required for UPDATE.
  it("3. Correct userId ownership is required for UPDATE", async () => {
    chainable.then.mockImplementationOnce((resolve: any) => resolve({ error: null }));
    await tradeRepository.update(USER_A, dummyPosition);
    expect(chainable.eq).toHaveBeenCalledWith("user_id", USER_A);

    chainable.then.mockImplementationOnce((resolve: any) => resolve({ error: null }));
    await pendingOrderRepository.update(USER_A, dummyPendingOrder);
    expect(chainable.eq).toHaveBeenCalledWith("user_id", USER_A);
  });

  // 4. Correct userId ownership is required for DELETE/cancel.
  it("4. Correct userId ownership is required for cancel", async () => {
    chainable.then.mockImplementationOnce((resolve: any) => resolve({ error: null }));
    await pendingOrderRepository.cancel(USER_A, dummyPendingOrder);
    expect(chainable.eq).toHaveBeenCalledWith("user_id", USER_A);
    expect(chainable.update).toHaveBeenCalledWith(expect.objectContaining({ status: "CANCELLED" }));
  });

  // 5. Trade status mapping is correct (OPEN -> OPEN).
  it("5. Trade status mapping is correct (OPEN -> OPEN)", () => {
    const row = tradeRepository.constructor.prototype.constructor.mapToRow(dummyPosition);
    expect(row.status).toBe("OPEN");
  });

  // 6. CLOSED + positive P/L → WIN.
  it("6. CLOSED + positive P/L -> WIN", () => {
    const pos = { ...dummyPosition, status: "CLOSED" as const, realizedPnl: 100 };
    const row = tradeRepository.constructor.prototype.constructor.mapToRow(pos);
    expect(row.status).toBe("WIN");
  });

  // 7. CLOSED + negative P/L → LOSS.
  it("7. CLOSED + negative P/L -> LOSS", () => {
    const pos = { ...dummyPosition, status: "CLOSED" as const, realizedPnl: -50 };
    const row = tradeRepository.constructor.prototype.constructor.mapToRow(pos);
    expect(row.status).toBe("LOSS");
  });

  // 8. CLOSED + zero P/L → BREAKEVEN.
  it("8. CLOSED + zero P/L -> BREAKEVEN", () => {
    const pos = { ...dummyPosition, status: "CLOSED" as const, realizedPnl: 0 };
    const row = tradeRepository.constructor.prototype.constructor.mapToRow(pos);
    expect(row.status).toBe("BREAKEVEN");
  });

  // 9. CLOSING is never persisted as a DB status.
  it("9. CLOSING is never persisted as a DB status", () => {
    const pos = { ...dummyPosition, status: "CLOSING" as const };
    const row = tradeRepository.constructor.prototype.constructor.mapToRow(pos);
    expect(row.status).toBe("OPEN");
  });

  // 10. Repository never accepts an arbitrary userId from the frontend request.
  it("10. Repository rejects operation if position userId doesn't match verified userId", async () => {
    await expect(tradeRepository.insert(USER_B, dummyPosition)).rejects.toThrow("Cannot insert trade for a different user.");
    await expect(tradeRepository.update(USER_B, dummyPosition)).rejects.toThrow("Cannot update trade for a different user.");
    await expect(pendingOrderRepository.insert(USER_B, dummyPendingOrder)).rejects.toThrow("Cannot insert order for a different user.");
    await expect(pendingOrderRepository.update(USER_B, dummyPendingOrder)).rejects.toThrow("Cannot update order for a different user.");
  });

  // 11. Pending order strategy field is handled correctly according to the existing DB schema.
  it("11. Pending order strategy field is handled correctly", () => {
    const row = pendingOrderRepository.constructor.prototype.constructor.mapToRow(dummyPendingOrder);
    expect(row.strategy).toBe("Paper Trade");
  });
});

describe("Migration Security & Privilege Hardening Verification", () => {
  const migrationPath = path.resolve(__dirname, "../../../supabase/migrations/20260904_atomic_fill_pending_order.sql");
  const sql = fs.readFileSync(migrationPath, "utf8");

  it("1. Function SQL has SECURITY DEFINER and safe search_path", () => {
    expect(sql).toContain("SECURITY DEFINER");
    expect(sql).toMatch(/SET search_path\s*=\s*''/);
  });

  it("2. EXECUTE privilege is explicitly revoked from PUBLIC, anon, and authenticated", () => {
    expect(sql).toMatch(/REVOKE EXECUTE ON FUNCTION public\.fill_pending_order_and_create_trade\(.*?\) FROM PUBLIC;/s);
    expect(sql).toMatch(/REVOKE EXECUTE ON FUNCTION public\.fill_pending_order_and_create_trade\(.*?\) FROM anon;/s);
    expect(sql).toMatch(/REVOKE EXECUTE ON FUNCTION public\.fill_pending_order_and_create_trade\(.*?\) FROM authenticated;/s);
  });

  it("3. EXECUTE privilege is explicitly granted ONLY to service_role", () => {
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.fill_pending_order_and_create_trade\(.*?\) TO service_role;/s);
  });

  it("4. All table references in SQL body are explicitly schema-qualified (public.pending_orders, public.trades)", () => {
    expect(sql).toContain("UPDATE public.pending_orders");
    expect(sql).toContain("INSERT INTO public.trades");
    expect(sql).not.toMatch(/UPDATE\s+pending_orders/i);
    expect(sql).not.toMatch(/INSERT INTO\s+trades/i);
  });
});

