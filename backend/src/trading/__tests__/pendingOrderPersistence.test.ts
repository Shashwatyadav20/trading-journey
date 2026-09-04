import { describe, it, expect, beforeEach, vi } from "vitest";

// ─── vi.mock MUST be at the top level so Vitest hoists it before imports ───
// This ensures these mocks take effect in TradingEngine's module-level singleton
// import, rather than being overwritten by positionPersistence.test.ts's spyOn.
vi.mock("../../db/TradeRepository", () => ({
  TradeRepository: {
    mapToRow: (position: any) => {
      // Real implementation inline so tests can verify mapped values
      const entryDate = new Date(position.entryTime);
      const date = entryDate.toISOString().split("T")[0];
      const time = entryDate.toISOString().split("T")[1].substring(0, 5);

      let exit_time: string | null = null;
      if (position.exitTime) {
        exit_time = new Date(position.exitTime).toISOString().split("T")[1].substring(0, 5);
      }

      let holding_time: string | null = null;
      if (position.status === "CLOSED" && position.exitTime && position.entryTime) {
        const diffMs = Math.max(0, new Date(position.exitTime).getTime() - new Date(position.entryTime).getTime());
        const diffSec = Math.floor(diffMs / 1000);
        const mins = Math.floor(diffSec / 60);
        const secs = diffSec % 60;
        const hours = Math.floor(mins / 60);
        const remMins = mins % 60;
        if (hours > 0) holding_time = `${hours}h ${remMins}m`;
        else if (mins > 0) holding_time = `${mins}m ${secs}s`;
        else holding_time = `${secs}s`;
      }

      let r_multiple: number | null = null;
      if (position.status === "CLOSED" && position.exitPrice != null) {
        if (position.stopLoss != null) {
          const risk = Math.abs(position.entryPrice - position.stopLoss);
          if (risk > 0) {
            const reward = position.side === "LONG"
              ? position.exitPrice - position.entryPrice
              : position.entryPrice - position.exitPrice;
            r_multiple = Number((reward / risk).toFixed(2));
          }
        } else {
          const pnl = position.realizedPnl ?? 0;
          r_multiple = pnl > 0 ? 1 : pnl < 0 ? -1 : 0;
        }
      }

      let status = "OPEN";
      if (position.status === "CLOSED") {
        const pnl = position.realizedPnl || 0;
        if (pnl > 0) status = "WIN";
        else if (pnl < 0) status = "LOSS";
        else status = "BREAKEVEN";
      }

      return {
        id: position.id,
        user_id: position.userId,
        date,
        time,
        exit_time,
        holding_time,
        symbol: position.instrument,
        side: position.side,
        strategy: position.strategy || "Paper Trade",
        entry_price: position.entryPrice,
        stop_loss: position.stopLoss ?? null,
        target_price: position.takeProfit ?? null,
        exit_price: position.exitPrice ?? null,
        quantity: position.quantity,
        pnl: position.realizedPnl ?? null,
        fees: 0,
        r_multiple,
        status,
        order_type: position.orderType || "Market",
        updated_at: position.updatedAt,
        created_at: position.createdAt,
      };
    },
  },
  tradeRepository: {
    insert: vi.fn(),
    update: vi.fn(),
    closeTrade: vi.fn(),
  },
}));

vi.mock("../../db/PendingOrderRepository", () => ({
  PendingOrderRepository: {
    mapToRow: (order: any) => ({
      id: order.id,
      user_id: order.userId,
      instrument: order.instrument,
      side: order.side,
      order_type: "Limit",
      limit_price: order.limitPrice,
      quantity: order.quantity,
      stop_loss: order.stopLoss ?? null,
      take_profit: order.takeProfit ?? null,
      strategy: order.strategy || "Paper Trade",
      status: order.status,
      created_at: order.createdAt,
      updated_at: order.updatedAt,
    }),
    mapToPendingOrder: (row: any) => row,
  },
  pendingOrderRepository: {
    insert: vi.fn(),
    update: vi.fn(),
    cancel: vi.fn(),
    fill: vi.fn(),
    atomicFillAndCreateTrade: vi.fn(async (userId: string, order: any, position: any) => {
      await pendingOrderRepository.fill(userId, { ...order, status: "FILLED" });
      await tradeRepository.insert(userId, position);
      return true;
    }),
  },
}));

// ─── Imports after mocks (Vitest hoisting ensures mocks are applied first) ───
import { tradingEngine, TradingError } from "../TradingEngine";
import { positionStore } from "../PositionStore";
import { pendingOrderStore } from "../PendingOrderStore";
import { priceStore } from "../../market/MarketPriceStore";
import { tradeRepository } from "../../db/TradeRepository";
import { pendingOrderRepository } from "../../db/PendingOrderRepository";

// ─── In-memory DB simulation ──────────────────────────────────────────────────
let dbPendingOrders: any[] = [];
let dbTrades: any[] = [];
let pendingInsertCount = 0;
let pendingUpdateCount = 0;
let tradeInsertCount = 0;

// ─── Helpers ──────────────────────────────────────────────────────────────────
function setMockPrice(instrument: string, price: number, status: "LIVE" | "STALE" | "OFFLINE" = "LIVE") {
  priceStore.setPrice(instrument, {
    instrument,
    price,
    timestamp: new Date().toISOString(),
    source: "mock",
    sourceSymbol: "MOCK",
    isProxy: false,
    status,
  });
}

const flushMicrotasks = () => new Promise(resolve => setTimeout(resolve, 0));

// ─── Inline mapToRow for trades (mirrors real TradeRepository.mapToRow) ───────
function mapPositionToRow(position: any): any {
  const entryDate = new Date(position.entryTime);
  const date = entryDate.toISOString().split("T")[0];
  const time = entryDate.toISOString().split("T")[1].substring(0, 5);

  let exit_time: string | null = null;
  if (position.exitTime) {
    exit_time = new Date(position.exitTime).toISOString().split("T")[1].substring(0, 5);
  }

  let r_multiple: number | null = null;
  if (position.status === "CLOSED" && position.exitPrice != null) {
    if (position.stopLoss != null) {
      const risk = Math.abs(position.entryPrice - position.stopLoss);
      if (risk > 0) {
        const reward = position.side === "LONG"
          ? position.exitPrice - position.entryPrice
          : position.entryPrice - position.exitPrice;
        r_multiple = Number((reward / risk).toFixed(2));
      }
    } else {
      const pnl = position.realizedPnl ?? 0;
      r_multiple = pnl > 0 ? 1 : pnl < 0 ? -1 : 0;
    }
  }

  let status = "OPEN";
  if (position.status === "CLOSED") {
    const pnl = position.realizedPnl || 0;
    if (pnl > 0) status = "WIN";
    else if (pnl < 0) status = "LOSS";
    else status = "BREAKEVEN";
  }

  return {
    id: position.id,
    user_id: position.userId,
    date,
    time,
    exit_time,
    symbol: position.instrument,
    side: position.side,
    strategy: position.strategy || "Paper Trade",
    entry_price: position.entryPrice,
    stop_loss: position.stopLoss ?? null,
    target_price: position.takeProfit ?? null,
    exit_price: position.exitPrice ?? null,
    quantity: position.quantity,
    pnl: position.realizedPnl ?? null,
    fees: 0,
    r_multiple,
    status,
    order_type: position.orderType || "Market",
    updated_at: position.updatedAt,
    created_at: position.createdAt,
  };
}

function mapOrderToRow(order: any): any {
  return {
    id: order.id,
    user_id: order.userId,
    instrument: order.instrument,
    side: order.side,
    order_type: "Limit",
    limit_price: order.limitPrice,
    quantity: order.quantity,
    stop_loss: order.stopLoss ?? null,
    take_profit: order.takeProfit ?? null,
    strategy: order.strategy || "Paper Trade",
    status: order.status,
    created_at: order.createdAt,
    updated_at: order.updatedAt,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────
describe("Step 3C-4: Pending Order Persistence & PendingOrderRepository Integration", () => {
  const USER_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  const USER_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

  beforeEach(() => {
    positionStore.clear();
    pendingOrderStore.clear();
    dbPendingOrders = [];
    dbTrades = [];
    pendingInsertCount = 0;
    pendingUpdateCount = 0;
    tradeInsertCount = 0;

    // ─── Configure mock implementations fresh for each test ───────────────
    vi.mocked(pendingOrderRepository.insert).mockImplementation((userId: string, order: any) => {
      if (order.userId !== userId) return Promise.reject(new Error("Cannot insert order for a different user."));
      pendingInsertCount++;
      dbPendingOrders.push(mapOrderToRow(order));
      return Promise.resolve();
    });

    vi.mocked(pendingOrderRepository.update).mockImplementation((userId: string, order: any) => {
      if (order.userId !== userId) return Promise.reject(new Error("Cannot update order for a different user."));
      pendingUpdateCount++;
      const idx = dbPendingOrders.findIndex((o: any) => o.id === order.id && o.user_id === userId);
      if (idx >= 0) {
        dbPendingOrders[idx] = { ...dbPendingOrders[idx], ...mapOrderToRow(order) };
      }
      return Promise.resolve();
    });

    vi.mocked(pendingOrderRepository.cancel).mockImplementation((userId: string, order: any) => {
      return vi.mocked(pendingOrderRepository.update)(userId, order);
    });

    vi.mocked(pendingOrderRepository.fill).mockImplementation((userId: string, order: any) => {
      return vi.mocked(pendingOrderRepository.update)(userId, order);
    });

    vi.mocked(tradeRepository.insert).mockImplementation((userId: string, position: any) => {
      if (position.userId !== userId) return Promise.reject(new Error("Cannot insert trade for a different user."));
      tradeInsertCount++;
      dbTrades.push(mapPositionToRow(position));
      return Promise.resolve();
    });

    vi.mocked(tradeRepository.update).mockImplementation((userId: string, position: any) => {
      if (position.userId !== userId) return Promise.reject(new Error("Cannot update trade for a different user."));
      const idx = dbTrades.findIndex((t: any) => t.id === position.id && t.user_id === userId);
      if (idx >= 0) {
        dbTrades[idx] = { ...dbTrades[idx], ...mapPositionToRow(position) };
      }
      return Promise.resolve();
    });

    vi.mocked(tradeRepository.closeTrade).mockImplementation((userId: string, position: any) => {
      return vi.mocked(tradeRepository.update)(userId, position);
    });

    setMockPrice("BTC/USD", 50000);
  });

  // 1. LIMIT BUY creates exactly one DB pending order.
  it("1. LIMIT BUY creates exactly one DB pending order", async () => {
    await tradingEngine.openLimitOrder(USER_A, { instrument: "BTC/USD", side: "BUY", quantity: 1, limitPrice: 49000 });
    expect(pendingInsertCount).toBe(1);
    expect(dbPendingOrders.length).toBe(1);
  });

  // 2. LIMIT SELL creates exactly one DB pending order.
  it("2. LIMIT SELL creates exactly one DB pending order", async () => {
    await tradingEngine.openLimitOrder(USER_A, { instrument: "BTC/USD", side: "SELL", quantity: 1, limitPrice: 51000 });
    expect(pendingInsertCount).toBe(1);
    expect(dbPendingOrders.length).toBe(1);
  });

  // 3. Correct userId is persisted.
  it("3. Correct userId is persisted", async () => {
    await tradingEngine.openLimitOrder(USER_A, { instrument: "BTC/USD", side: "BUY", quantity: 1, limitPrice: 49000 });
    expect(dbPendingOrders[0].user_id).toBe(USER_A);
  });

  // 4. Correct instrument is persisted.
  it("4. Correct instrument is persisted", async () => {
    await tradingEngine.openLimitOrder(USER_A, { instrument: "BTC/USD", side: "BUY", quantity: 1, limitPrice: 49000 });
    expect(dbPendingOrders[0].instrument).toBe("BTC/USD");
  });

  // 5. Correct side is persisted.
  it("5. Correct side is persisted", async () => {
    await tradingEngine.openLimitOrder(USER_A, { instrument: "BTC/USD", side: "BUY", quantity: 1, limitPrice: 49000 });
    expect(dbPendingOrders[0].side).toBe("LONG");

    await tradingEngine.openLimitOrder(USER_A, { instrument: "BTC/USD", side: "SELL", quantity: 1, limitPrice: 51000 });
    expect(dbPendingOrders[1].side).toBe("SHORT");
  });

  // 6. Correct order type is persisted.
  it("6. Correct order type is persisted", async () => {
    await tradingEngine.openLimitOrder(USER_A, { instrument: "BTC/USD", side: "BUY", quantity: 1, limitPrice: 49000 });
    expect(dbPendingOrders[0].order_type).toBe("Limit");
  });

  // 7. Correct limit price is persisted.
  it("7. Correct limit price is persisted", async () => {
    await tradingEngine.openLimitOrder(USER_A, { instrument: "BTC/USD", side: "BUY", quantity: 1, limitPrice: 48750.25 });
    expect(dbPendingOrders[0].limit_price).toBe(48750.25);
  });

  // 8. Correct quantity is persisted.
  it("8. Correct quantity is persisted", async () => {
    await tradingEngine.openLimitOrder(USER_A, { instrument: "BTC/USD", side: "BUY", quantity: 3.5, limitPrice: 49000 });
    expect(dbPendingOrders[0].quantity).toBe(3.5);
  });

  // 9. Correct SL is persisted.
  it("9. Correct SL is persisted", async () => {
    await tradingEngine.openLimitOrder(USER_A, {
      instrument: "BTC/USD",
      side: "BUY",
      quantity: 1,
      limitPrice: 49000,
      stopLoss: 48000,
    });
    expect(dbPendingOrders[0].stop_loss).toBe(48000);
  });

  // 10. Correct TP is persisted.
  it("10. Correct TP is persisted", async () => {
    await tradingEngine.openLimitOrder(USER_A, {
      instrument: "BTC/USD",
      side: "BUY",
      quantity: 1,
      limitPrice: 49000,
      takeProfit: 52000,
    });
    expect(dbPendingOrders[0].take_profit).toBe(52000);
  });

  // 11. Correct strategy is persisted.
  it("11. Correct strategy is persisted", async () => {
    await tradingEngine.openLimitOrder(USER_A, {
      instrument: "BTC/USD",
      side: "BUY",
      quantity: 1,
      limitPrice: 49000,
      strategy: "Liquidity Sweep",
    });
    expect(dbPendingOrders[0].strategy).toBe("Liquidity Sweep");
  });

  // 12. New pending order starts as PENDING.
  it("12. New pending order starts as PENDING", async () => {
    await tradingEngine.openLimitOrder(USER_A, { instrument: "BTC/USD", side: "BUY", quantity: 1, limitPrice: 49000 });
    expect(dbPendingOrders[0].status).toBe("PENDING");
  });

  // 13. Cancel changes DB status to CANCELLED.
  it("13. Cancel changes DB status to CANCELLED", async () => {
    const order = await tradingEngine.openLimitOrder(USER_A, { instrument: "BTC/USD", side: "BUY", quantity: 1, limitPrice: 49000 });
    await tradingEngine.cancelLimitOrder(USER_A, order.id);

    expect(pendingUpdateCount).toBe(1);
    expect(dbPendingOrders[0].status).toBe("CANCELLED");
  });

  // 14. Cancel does not create a trade.
  it("14. Cancel does not create a trade", async () => {
    const order = await tradingEngine.openLimitOrder(USER_A, { instrument: "BTC/USD", side: "BUY", quantity: 1, limitPrice: 49000 });
    await tradingEngine.cancelLimitOrder(USER_A, order.id);

    expect(dbTrades.length).toBe(0);
    expect(tradeInsertCount).toBe(0);
  });

  // 15. Filled LIMIT order changes DB status to FILLED.
  it("15. Filled LIMIT order changes DB status to FILLED", async () => {
    await tradingEngine.openLimitOrder(USER_A, { instrument: "BTC/USD", side: "BUY", quantity: 1, limitPrice: 49000 });
    setMockPrice("BTC/USD", 48500); // Fills order
    await flushMicrotasks();

    expect(dbPendingOrders[0].status).toBe("FILLED");
  });

  // 16. Filled LIMIT order uses configured limitPrice as entry price.
  it("16. Filled LIMIT order uses configured limitPrice as entry price", async () => {
    await tradingEngine.openLimitOrder(USER_A, { instrument: "BTC/USD", side: "BUY", quantity: 1, limitPrice: 49000 });
    setMockPrice("BTC/USD", 47500); // Market price dropped below limit
    await flushMicrotasks();

    expect(dbTrades.length).toBe(1);
    expect(dbTrades[0].entry_price).toBe(49000); // Exact limit price, NOT 47500
  });

  // 17. Filled LIMIT order creates exactly one Position.
  it("17. Filled LIMIT order creates exactly one Position", async () => {
    await tradingEngine.openLimitOrder(USER_A, { instrument: "BTC/USD", side: "BUY", quantity: 1, limitPrice: 49000 });
    setMockPrice("BTC/USD", 48500);
    await flushMicrotasks();

    expect(positionStore.getByUser(USER_A).length).toBe(1);
  });

  // 18. Filled LIMIT order creates exactly one Trade.
  it("18. Filled LIMIT order creates exactly one Trade", async () => {
    await tradingEngine.openLimitOrder(USER_A, { instrument: "BTC/USD", side: "BUY", quantity: 1, limitPrice: 49000 });
    setMockPrice("BTC/USD", 48500);
    await flushMicrotasks();

    expect(tradeInsertCount).toBe(1);
    expect(dbTrades.length).toBe(1);
  });

  // 19. Position preserves SL.
  it("19. Position preserves SL", async () => {
    await tradingEngine.openLimitOrder(USER_A, { instrument: "BTC/USD", side: "BUY", quantity: 1, limitPrice: 49000, stopLoss: 48000 });
    setMockPrice("BTC/USD", 48700);
    await flushMicrotasks();

    expect(positionStore.getByUser(USER_A)[0].stopLoss).toBe(48000);
    expect(dbTrades[0].stop_loss).toBe(48000);
  });

  // 20. Position preserves TP.
  it("20. Position preserves TP", async () => {
    await tradingEngine.openLimitOrder(USER_A, { instrument: "BTC/USD", side: "BUY", quantity: 1, limitPrice: 49000, takeProfit: 52000 });
    setMockPrice("BTC/USD", 48700);
    await flushMicrotasks();

    expect(positionStore.getByUser(USER_A)[0].takeProfit).toBe(52000);
    expect(dbTrades[0].target_price).toBe(52000);
  });

  // 21. Position preserves strategy.
  it("21. Position preserves strategy", async () => {
    await tradingEngine.openLimitOrder(USER_A, {
      instrument: "BTC/USD",
      side: "BUY",
      quantity: 1,
      limitPrice: 49000,
      strategy: "Liquidity Sweep",
    });
    setMockPrice("BTC/USD", 48700);
    await flushMicrotasks();

    expect(positionStore.getByUser(USER_A)[0].strategy).toBe("Liquidity Sweep");
    expect(dbTrades[0].strategy).toBe("Liquidity Sweep");
  });

  // 22. Position preserves quantity.
  it("22. Position preserves quantity", async () => {
    await tradingEngine.openLimitOrder(USER_A, { instrument: "BTC/USD", side: "BUY", quantity: 4.5, limitPrice: 49000 });
    setMockPrice("BTC/USD", 48700);
    await flushMicrotasks();

    expect(positionStore.getByUser(USER_A)[0].quantity).toBe(4.5);
    expect(dbTrades[0].quantity).toBe(4.5);
  });

  // 23. Position preserves side.
  it("23. Position preserves side", async () => {
    await tradingEngine.openLimitOrder(USER_A, { instrument: "BTC/USD", side: "SELL", quantity: 1, limitPrice: 51000 });
    setMockPrice("BTC/USD", 51500);
    await flushMicrotasks();

    expect(positionStore.getByUser(USER_A)[0].side).toBe("SHORT");
    expect(dbTrades[0].side).toBe("SHORT");
  });

  // 24. Position preserves instrument.
  it("24. Position preserves instrument", async () => {
    setMockPrice("XAU/USD", 2000);
    await tradingEngine.openLimitOrder(USER_A, { instrument: "XAU/USD", side: "BUY", quantity: 5, limitPrice: 1980 });
    setMockPrice("XAU/USD", 1970);
    await flushMicrotasks();

    expect(positionStore.getByUser(USER_A)[0].instrument).toBe("XAU/USD");
    expect(dbTrades[0].symbol).toBe("XAU/USD");
  });

  // 25. Position uses LIMIT order type.
  it("25. Position uses LIMIT order type", async () => {
    await tradingEngine.openLimitOrder(USER_A, { instrument: "BTC/USD", side: "BUY", quantity: 1, limitPrice: 49000 });
    setMockPrice("BTC/USD", 48700);
    await flushMicrotasks();

    expect(dbTrades[0].order_type).toBe("LIMIT");
  });

  // 26. Repeated market ticks cannot fill the same order twice.
  it("26. Repeated market ticks cannot fill the same order twice", async () => {
    await tradingEngine.openLimitOrder(USER_A, { instrument: "BTC/USD", side: "BUY", quantity: 1, limitPrice: 49000 });
    setMockPrice("BTC/USD", 48000); // Fill tick 1
    setMockPrice("BTC/USD", 47500); // Fill tick 2
    setMockPrice("BTC/USD", 47000); // Fill tick 3
    await flushMicrotasks();

    expect(positionStore.getByUser(USER_A).length).toBe(1);
    expect(dbTrades.length).toBe(1);
  });

  // 27. Concurrent fill attempts cannot create duplicate positions.
  it("27. Concurrent fill attempts cannot create duplicate positions", async () => {
    const order = await tradingEngine.openLimitOrder(USER_A, { instrument: "BTC/USD", side: "BUY", quantity: 1, limitPrice: 49000 });

    // First fill attempt succeeds
    const t1 = pendingOrderStore.tryTransitionToFilled(order.id);
    // Second fill attempt fails atomically
    const t2 = pendingOrderStore.tryTransitionToFilled(order.id);

    expect(t1).toBe(true);
    expect(t2).toBe(false);
  });

  // 28. User A cannot read User B's pending order.
  it("28. User A cannot read User B's pending order", async () => {
    const orderB = await tradingEngine.openLimitOrder(USER_B, { instrument: "BTC/USD", side: "BUY", quantity: 1, limitPrice: 49000 });

    const userAOrders = pendingOrderStore.getByUser(USER_A);
    expect(userAOrders).toHaveLength(0);
    expect(orderB.userId).toBe(USER_B);
  });

  // 29. User A cannot cancel User B's pending order.
  it("29. User A cannot cancel User B's pending order", async () => {
    const orderB = await tradingEngine.openLimitOrder(USER_B, { instrument: "BTC/USD", side: "BUY", quantity: 1, limitPrice: 49000 });

    await expect(tradingEngine.cancelLimitOrder(USER_A, orderB.id)).rejects.toThrow("does not belong");
  });

  // 30. User A cannot fill User B's pending order for themselves.
  it("30. User A cannot fill User B's pending order for themselves", async () => {
    await tradingEngine.openLimitOrder(USER_B, { instrument: "BTC/USD", side: "BUY", quantity: 1, limitPrice: 49000 });
    setMockPrice("BTC/USD", 48000);
    await flushMicrotasks();

    // Created position belongs to USER_B, not USER_A
    expect(positionStore.getByUser(USER_B).length).toBe(1);
    expect(positionStore.getByUser(USER_A).length).toBe(0);
  });

  // 31. Database failure during creation is handled safely.
  it("31. Database failure during creation is handled safely", async () => {
    vi.mocked(pendingOrderRepository.insert).mockRejectedValueOnce(new Error("DB timeout"));

    await expect(
      tradingEngine.openLimitOrder(USER_A, { instrument: "BTC/USD", side: "BUY", quantity: 1, limitPrice: 49000 })
    ).rejects.toThrow("Failed to persist limit order to database");

    expect(pendingOrderStore.getByUser(USER_A).length).toBe(0);
  });

  // 32. Database failure during cancellation is handled safely.
  it("32. Database failure during cancellation is handled safely", async () => {
    const order = await tradingEngine.openLimitOrder(USER_A, { instrument: "BTC/USD", side: "BUY", quantity: 1, limitPrice: 49000 });

    vi.mocked(pendingOrderRepository.cancel).mockRejectedValueOnce(new Error("DB cancel failure"));

    await expect(tradingEngine.cancelLimitOrder(USER_A, order.id)).rejects.toThrow("Failed to persist order cancellation");

    // In-memory status is reverted to PENDING so it's not lost
    expect(pendingOrderStore.get(order.id)!.status).toBe("PENDING");
  });

  // 33. Database failure during fill is handled safely (rolls back in-memory fill under 3C-6).
  it("33. Database failure during fill is handled safely", async () => {
    const order = await tradingEngine.openLimitOrder(USER_A, { instrument: "BTC/USD", side: "BUY", quantity: 1, limitPrice: 49000 });

    vi.mocked(pendingOrderRepository.atomicFillAndCreateTrade).mockRejectedValueOnce(new Error("DB fill logging error"));

    setMockPrice("BTC/USD", 48000);
    await flushMicrotasks();

    // Under Step 3C-6, DB failure on fill safely rolls back memory fill and leaves no orphan position
    expect(pendingOrderStore.get(order.id)!.status).toBe("PENDING");
    expect(positionStore.getByUser(USER_A).length).toBe(0);
  });

  // 34. Existing SL/TP behavior continues after a LIMIT fill.
  it("34. Existing SL/TP behavior continues after a LIMIT fill", async () => {
    await tradingEngine.openLimitOrder(USER_A, {
      instrument: "BTC/USD",
      side: "BUY",
      quantity: 1,
      limitPrice: 49000,
      stopLoss: 48000,
      takeProfit: 52000,
    });

    setMockPrice("BTC/USD", 48500); // Fills
    await flushMicrotasks();
    const pos = positionStore.getByUser(USER_A)[0];
    expect(pos.status).toBe("OPEN");

    setMockPrice("BTC/USD", 47900); // Hits SL
    await flushMicrotasks();
    expect(positionStore.get(pos.id)!.status).toBe("CLOSED");
    expect(dbTrades[0].status).toBe("LOSS");
  });

  // 35. No $5 hardcoded fee appears.
  it("35. No $5 hardcoded fee appears", async () => {
    await tradingEngine.openLimitOrder(USER_A, {
      instrument: "BTC/USD",
      side: "BUY",
      quantity: 1,
      limitPrice: 49000,
      takeProfit: 51000,
    });

    setMockPrice("BTC/USD", 48500); // Fills
    await flushMicrotasks();
    setMockPrice("BTC/USD", 51500); // Hits TP
    await flushMicrotasks();

    expect(dbTrades[0].fees).toBe(0);
    expect(dbTrades[0].pnl).toBe(2500); // (51500 - 49000) * 1 = 2500
  });

  // 36. Existing atomic pending-order transition remains functional.
  it("36. Existing atomic pending-order transition remains functional", async () => {
    const order = await tradingEngine.openLimitOrder(USER_A, { instrument: "BTC/USD", side: "BUY", quantity: 1, limitPrice: 49000 });

    // Filled orders cannot be cancelled
    setMockPrice("BTC/USD", 48000); // Fills
    await flushMicrotasks();
    await expect(tradingEngine.cancelLimitOrder(USER_A, order.id)).rejects.toThrow("Cannot cancel order in status: FILLED");
  });
});
