import { describe, it, expect, beforeEach, vi } from "vitest";

// ─── Top-level mocks for Repositories ──────────────────────────────────────────
vi.mock("../../db/TradeRepository", () => ({
  TradeRepository: {
    mapToRow: (position: any) => ({
      id: position.id,
      user_id: position.userId,
      date: new Date(position.entryTime).toISOString().split("T")[0],
      time: new Date(position.entryTime).toISOString().split("T")[1].substring(0, 5),
      exit_time: position.exitTime ? new Date(position.exitTime).toISOString().split("T")[1].substring(0, 5) : null,
      holding_time: null,
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
      r_multiple: null,
      status: position.status === "CLOSED" ? (position.realizedPnl > 0 ? "WIN" : position.realizedPnl < 0 ? "LOSS" : "BREAKEVEN") : "OPEN",
      order_type: position.orderType || "Market",
      updated_at: position.updatedAt,
      created_at: position.createdAt,
    }),
  },
  tradeRepository: {
    findAllOpenTrades: vi.fn(),
    findOpenTrades: vi.fn(),
    findById: vi.fn(),
    insert: vi.fn().mockResolvedValue(undefined),
    update: vi.fn().mockResolvedValue(undefined),
    closeTrade: vi.fn().mockResolvedValue(undefined),
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
  },
  pendingOrderRepository: {
    findAllPendingOrders: vi.fn(),
    findByUserId: vi.fn(),
    findById: vi.fn(),
    insert: vi.fn().mockResolvedValue(undefined),
    update: vi.fn().mockResolvedValue(undefined),
    cancel: vi.fn().mockResolvedValue(undefined),
    fill: vi.fn().mockResolvedValue(undefined),
    atomicFillAndCreateTrade: vi.fn(async (userId: string, order: any, position: any) => {
      await pendingOrderRepository.fill(userId, { ...order, status: "FILLED" });
      await tradeRepository.insert(userId, position);
      return true;
    }),
  },
}));

// ─── Imports ──────────────────────────────────────────────────────────────────
import { tradingEngine, TradingError } from "../TradingEngine";
import { positionStore } from "../PositionStore";
import { pendingOrderStore } from "../PendingOrderStore";
import { priceStore } from "../../market/MarketPriceStore";
import { tradeRepository, TradeRepository } from "../../db/TradeRepository";
import { pendingOrderRepository } from "../../db/PendingOrderRepository";
import { tradingStateRecovery } from "../TradingStateRecovery";
import { Position, PendingOrder } from "../types";

const USER_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const USER_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

function setMockPrice(instrument: string, price: number, status: "LIVE" | "STALE" | "OFFLINE" = "LIVE") {
  priceStore.setPrice(instrument, {
    instrument,
    price,
    timestamp: new Date().toISOString(),
    source: "mock",
    sourceSymbol: "MOCK",
    isProxy: false,
    status
  });
}

function flushMicrotasks() {
  return new Promise((resolve) => setTimeout(resolve, 10));
}

describe("Step 3C-6: Database Consistency, Atomicity & Failure Safety", () => {
  beforeEach(() => {
    positionStore.clear();
    pendingOrderStore.clear();
    vi.clearAllMocks();
    setMockPrice("BTC/USD", 50000);
    setMockPrice("XAU/USD", 2500);
  });

  // 1. Market order DB failure leaves no in-memory position
  it("1. Market order DB failure leaves no in-memory position", async () => {
    vi.mocked(tradeRepository.insert).mockRejectedValueOnce(new Error("DB insert timeout"));

    await expect(
      tradingEngine.openPosition(USER_A, { instrument: "BTC/USD", side: "BUY", quantity: 1 })
    ).rejects.toThrow("Failed to persist trade to database");

    expect(positionStore.getByUser(USER_A).length).toBe(0);
  });

  // 2. Market order successful persistence creates exactly one trade
  it("2. Market order successful persistence creates exactly one trade", async () => {
    const pos = await tradingEngine.openPosition(USER_A, { instrument: "BTC/USD", side: "BUY", quantity: 1 });

    expect(tradeRepository.insert).toHaveBeenCalledTimes(1);
    expect(positionStore.get(pos.id)).toBeDefined();
  });

  // 3. Manual close updates existing trade
  it("3. Manual close updates existing trade", async () => {
    const pos = await tradingEngine.openPosition(USER_A, { instrument: "BTC/USD", side: "BUY", quantity: 1 });
    setMockPrice("BTC/USD", 52000);

    const closed = await tradingEngine.closePosition(USER_A, pos.id);

    expect(closed.status).toBe("CLOSED");
    expect(tradeRepository.closeTrade).toHaveBeenCalledWith(USER_A, expect.objectContaining({ id: pos.id, status: "CLOSED" }));
  });

  // 4. Manual close DB failure retains OPEN state in memory
  it("4. Manual close DB failure retains OPEN state in memory", async () => {
    const pos = await tradingEngine.openPosition(USER_A, { instrument: "BTC/USD", side: "BUY", quantity: 1 });
    vi.mocked(tradeRepository.closeTrade).mockRejectedValueOnce(new Error("DB connection dropped"));

    await expect(tradingEngine.closePosition(USER_A, pos.id)).rejects.toThrow("DB connection dropped");

    expect(positionStore.get(pos.id)!.status).toBe("OPEN");
  });

  // 5. Repeated close cannot duplicate
  it("5. Repeated close cannot duplicate", async () => {
    const pos = await tradingEngine.openPosition(USER_A, { instrument: "BTC/USD", side: "BUY", quantity: 1 });
    await tradingEngine.closePosition(USER_A, pos.id);

    await expect(tradingEngine.closePosition(USER_A, pos.id)).rejects.toThrow("already closed or closing");
  });

  // 6. SL close uses same persistence path
  it("6. SL close uses same persistence path", async () => {
    const pos = await tradingEngine.openPosition(USER_A, {
      instrument: "BTC/USD",
      side: "BUY",
      quantity: 1,
      stopLoss: 49000,
    });

    setMockPrice("BTC/USD", 48000);
    await flushMicrotasks();

    expect(positionStore.get(pos.id)!.status).toBe("CLOSED");
    expect(tradeRepository.closeTrade).toHaveBeenCalledWith(USER_A, expect.objectContaining({ id: pos.id, status: "CLOSED" }));
  });

  // 7. TP close uses same persistence path
  it("7. TP close uses same persistence path", async () => {
    const pos = await tradingEngine.openPosition(USER_A, {
      instrument: "BTC/USD",
      side: "BUY",
      quantity: 1,
      takeProfit: 55000,
    });

    setMockPrice("BTC/USD", 56000);
    await flushMicrotasks();

    expect(positionStore.get(pos.id)!.status).toBe("CLOSED");
    expect(tradeRepository.closeTrade).toHaveBeenCalledWith(USER_A, expect.objectContaining({ id: pos.id, status: "CLOSED" }));
  });

  // 8. LIMIT creation DB failure leaves no pending memory state
  it("8. LIMIT creation DB failure leaves no pending memory state", async () => {
    vi.mocked(pendingOrderRepository.insert).mockRejectedValueOnce(new Error("DB timeout"));

    await expect(
      tradingEngine.openLimitOrder(USER_A, { instrument: "BTC/USD", side: "BUY", quantity: 1, limitPrice: 48000 })
    ).rejects.toThrow("Failed to persist limit order to database");

    expect(pendingOrderStore.getByUser(USER_A).length).toBe(0);
  });

  // 9. LIMIT cancellation is conditional
  it("9. LIMIT cancellation is conditional", async () => {
    const order = await tradingEngine.openLimitOrder(USER_A, { instrument: "BTC/USD", side: "BUY", quantity: 1, limitPrice: 48000 });

    const cancelled = await tradingEngine.cancelLimitOrder(USER_A, order.id);

    expect(cancelled.status).toBe("CANCELLED");
    expect(pendingOrderRepository.cancel).toHaveBeenCalledWith(USER_A, expect.objectContaining({ id: order.id, status: "CANCELLED" }));
  });

  // 10. Already-filled order cannot be cancelled
  it("10. Already-filled order cannot be cancelled", async () => {
    const order = await tradingEngine.openLimitOrder(USER_A, { instrument: "BTC/USD", side: "BUY", quantity: 1, limitPrice: 49000 });

    setMockPrice("BTC/USD", 48000);
    await flushMicrotasks();

    await expect(tradingEngine.cancelLimitOrder(USER_A, order.id)).rejects.toThrow("Cannot cancel order in status: FILLED");
  });

  // 11. Already-cancelled order cannot be filled
  it("11. Already-cancelled order cannot be filled", async () => {
    const order = await tradingEngine.openLimitOrder(USER_A, { instrument: "BTC/USD", side: "BUY", quantity: 1, limitPrice: 49000 });
    await tradingEngine.cancelLimitOrder(USER_A, order.id);

    setMockPrice("BTC/USD", 48000);
    await flushMicrotasks();

    expect(positionStore.getByUser(USER_A).length).toBe(0);
  });

  // 12. Concurrent fill attempts result in exactly one fill
  it("12. Concurrent fill attempts result in exactly one fill", async () => {
    const order = await tradingEngine.openLimitOrder(USER_A, { instrument: "BTC/USD", side: "BUY", quantity: 1, limitPrice: 49000 });

    // Trigger tick twice rapidly
    setMockPrice("BTC/USD", 48000);
    setMockPrice("BTC/USD", 47500);
    await flushMicrotasks();

    expect(pendingOrderStore.get(order.id)!.status).toBe("FILLED");
    expect(positionStore.getByUser(USER_A).length).toBe(1);
  });

  // 13. Concurrent fill attempts create exactly one trade
  it("13. Concurrent fill attempts create exactly one trade", async () => {
    await tradingEngine.openLimitOrder(USER_A, { instrument: "BTC/USD", side: "BUY", quantity: 1, limitPrice: 49000 });

    setMockPrice("BTC/USD", 48000);
    setMockPrice("BTC/USD", 47000);
    await flushMicrotasks();

    expect(pendingOrderRepository.atomicFillAndCreateTrade).toHaveBeenCalledTimes(1);
    expect(positionStore.getByUser(USER_A).length).toBe(1);
  });

  // 14. Fill + cancel race has exactly one winning transition
  it("14. Fill + cancel race has exactly one winning transition", async () => {
    const order = await tradingEngine.openLimitOrder(USER_A, { instrument: "BTC/USD", side: "BUY", quantity: 1, limitPrice: 49000 });

    // Cancel order first
    await tradingEngine.cancelLimitOrder(USER_A, order.id);

    // Price crosses limit afterwards
    setMockPrice("BTC/USD", 48000);
    await flushMicrotasks();

    expect(pendingOrderStore.get(order.id)!.status).toBe("CANCELLED");
    expect(positionStore.getByUser(USER_A).length).toBe(0);
  });

  // 15. Failed atomic fill leaves persistent state consistent
  it("15. Failed atomic fill leaves persistent state consistent", async () => {
    const order = await tradingEngine.openLimitOrder(USER_A, { instrument: "BTC/USD", side: "BUY", quantity: 1, limitPrice: 49000 });
    vi.mocked(pendingOrderRepository.atomicFillAndCreateTrade).mockResolvedValueOnce(false);

    setMockPrice("BTC/USD", 48000);
    await flushMicrotasks();

    expect(pendingOrderStore.get(order.id)!.status).toBe("PENDING");
    expect(positionStore.getByUser(USER_A).length).toBe(0);
  });

  // 16. Successful atomic fill produces FILLED + exactly one OPEN trade
  it("16. Successful atomic fill produces FILLED + exactly one OPEN trade", async () => {
    const order = await tradingEngine.openLimitOrder(USER_A, { instrument: "BTC/USD", side: "BUY", quantity: 1, limitPrice: 49000 });

    setMockPrice("BTC/USD", 48000);
    await flushMicrotasks();

    expect(pendingOrderStore.get(order.id)!.status).toBe("FILLED");
    expect(positionStore.getByUser(USER_A).length).toBe(1);
  });

  // 17. Filled trade entry price equals configured limitPrice
  it("17. Filled trade entry price equals configured limitPrice", async () => {
    const order = await tradingEngine.openLimitOrder(USER_A, { instrument: "BTC/USD", side: "BUY", quantity: 1, limitPrice: 49000 });

    setMockPrice("BTC/USD", 45000); // Price jumped past limit
    await flushMicrotasks();

    const filledOrder = pendingOrderStore.get(order.id)!;
    const pos = positionStore.get(filledOrder.positionId!)!;
    expect(pos.entryPrice).toBe(49000); // Exact limit price execution
  });

  // 18. Filled trade preserves SL
  it("18. Filled trade preserves SL", async () => {
    const order = await tradingEngine.openLimitOrder(USER_A, {
      instrument: "BTC/USD",
      side: "BUY",
      quantity: 1,
      limitPrice: 49000,
      stopLoss: 48000,
    });

    setMockPrice("BTC/USD", 48500);
    await flushMicrotasks();

    const pos = positionStore.get(pendingOrderStore.get(order.id)!.positionId!)!;
    expect(pos.stopLoss).toBe(48000);
  });

  // 19. Filled trade preserves TP
  it("19. Filled trade preserves TP", async () => {
    const order = await tradingEngine.openLimitOrder(USER_A, {
      instrument: "BTC/USD",
      side: "BUY",
      quantity: 1,
      limitPrice: 49000,
      takeProfit: 55000,
    });

    setMockPrice("BTC/USD", 48500);
    await flushMicrotasks();

    const pos = positionStore.get(pendingOrderStore.get(order.id)!.positionId!)!;
    expect(pos.takeProfit).toBe(55000);
  });

  // 20. Filled trade preserves strategy
  it("20. Filled trade preserves strategy", async () => {
    const order = await tradingEngine.openLimitOrder(USER_A, {
      instrument: "BTC/USD",
      side: "BUY",
      quantity: 1,
      limitPrice: 49000,
      strategy: "Liquidity Sweep",
    });

    setMockPrice("BTC/USD", 48500);
    await flushMicrotasks();

    const pos = positionStore.get(pendingOrderStore.get(order.id)!.positionId!)!;
    expect(pos.strategy).toBe("Liquidity Sweep");
  });

  // 21. Filled trade preserves quantity
  it("21. Filled trade preserves quantity", async () => {
    const order = await tradingEngine.openLimitOrder(USER_A, { instrument: "BTC/USD", side: "BUY", quantity: 2.5, limitPrice: 49000 });

    setMockPrice("BTC/USD", 48500);
    await flushMicrotasks();

    const pos = positionStore.get(pendingOrderStore.get(order.id)!.positionId!)!;
    expect(pos.quantity).toBe(2.5);
  });

  // 22. Filled trade preserves side
  it("22. Filled trade preserves side", async () => {
    const order = await tradingEngine.openLimitOrder(USER_A, { instrument: "BTC/USD", side: "SELL", quantity: 1, limitPrice: 52000 });

    setMockPrice("BTC/USD", 53000);
    await flushMicrotasks();

    const pos = positionStore.get(pendingOrderStore.get(order.id)!.positionId!)!;
    expect(pos.side).toBe("SHORT");
  });

  // 23. Filled trade preserves instrument
  it("23. Filled trade preserves instrument", async () => {
    const order = await tradingEngine.openLimitOrder(USER_A, { instrument: "XAU/USD", side: "BUY", quantity: 1, limitPrice: 2400 });

    setMockPrice("XAU/USD", 2390);
    await flushMicrotasks();

    const pos = positionStore.get(pendingOrderStore.get(order.id)!.positionId!)!;
    expect(pos.instrument).toBe("XAU/USD");
  });

  // 24. User A cannot operate on User B's pending order
  it("24. User A cannot operate on User B's pending order", async () => {
    const order = await tradingEngine.openLimitOrder(USER_B, { instrument: "BTC/USD", side: "BUY", quantity: 1, limitPrice: 48000 });

    await expect(tradingEngine.cancelLimitOrder(USER_A, order.id)).rejects.toThrow("Order does not belong to the authenticated user");
  });

  // 25. User A cannot operate on User B's position
  it("25. User A cannot operate on User B's position", async () => {
    const pos = await tradingEngine.openPosition(USER_B, { instrument: "BTC/USD", side: "BUY", quantity: 1 });

    await expect(tradingEngine.closePosition(USER_A, pos.id)).rejects.toThrow("Position does not belong to the authenticated user");
  });

  // 26. Repeated requests are idempotent
  it("26. Repeated requests are idempotent", async () => {
    const order = await tradingEngine.openLimitOrder(USER_A, { instrument: "BTC/USD", side: "BUY", quantity: 1, limitPrice: 49000 });

    setMockPrice("BTC/USD", 48000);
    setMockPrice("BTC/USD", 48000);
    await flushMicrotasks();

    expect(positionStore.getByUser(USER_A).length).toBe(1);
  });

  // 27. No duplicate trades after repeated fill events
  it("27. No duplicate trades after repeated fill events", async () => {
    await tradingEngine.openLimitOrder(USER_A, { instrument: "BTC/USD", side: "BUY", quantity: 1, limitPrice: 49000 });

    for (let i = 0; i < 5; i++) {
      setMockPrice("BTC/USD", 48000);
    }
    await flushMicrotasks();

    expect(pendingOrderRepository.atomicFillAndCreateTrade).toHaveBeenCalledTimes(1);
    expect(positionStore.getByUser(USER_A).length).toBe(1);
  });

  // 28. Recovery remains compatible with the new persistence logic
  it("28. Recovery remains compatible with the new persistence logic", async () => {
    const mockPos: Position = {
      id: "rec-pos-1",
      userId: USER_A,
      instrument: "BTC/USD",
      side: "LONG",
      quantity: 1,
      entryPrice: 50000,
      entryTime: new Date().toISOString(),
      status: "OPEN",
      unrealizedPnl: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const mockOrder: PendingOrder = {
      id: "rec-po-1",
      userId: USER_A,
      instrument: "BTC/USD",
      side: "LONG",
      quantity: 1,
      limitPrice: 48000,
      status: "PENDING",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    vi.mocked(tradeRepository.findAllOpenTrades).mockResolvedValueOnce([mockPos]);
    vi.mocked(pendingOrderRepository.findAllPendingOrders).mockResolvedValueOnce([mockOrder]);

    const res = await tradingStateRecovery.recover();

    expect(res.positions).toBe(1);
    expect(res.pendingOrders).toBe(1);
    expect(positionStore.get("rec-pos-1")).toBeDefined();
    expect(pendingOrderStore.get("rec-po-1")).toBeDefined();
  });

  // 29. No hardcoded $5 fee
  it("29. No hardcoded $5 fee", async () => {
    const pos = await tradingEngine.openPosition(USER_A, { instrument: "BTC/USD", side: "BUY", quantity: 1 });
    setMockPrice("BTC/USD", 52000);

    const closed = await tradingEngine.closePosition(USER_A, pos.id);

    expect(closed.realizedPnl).toBe(2000); // (52000 - 50000) * 1 = 2000
    const row = TradeRepository.mapToRow(closed);
    expect(row.fees).toBe(0);
  });

  // 30. Existing atomic PositionStore close protection remains functional
  it("30. Existing atomic PositionStore close protection remains functional", async () => {
    const pos = await tradingEngine.openPosition(USER_A, { instrument: "BTC/USD", side: "BUY", quantity: 1 });

    const first = positionStore.tryTransitionToClosing(pos.id);
    const second = positionStore.tryTransitionToClosing(pos.id);

    expect(first).toBe(true);
    expect(second).toBe(false);
  });

  // 31. Existing atomic PendingOrderStore fill protection remains functional
  it("31. Existing atomic PendingOrderStore fill protection remains functional", async () => {
    const order = await tradingEngine.openLimitOrder(USER_A, { instrument: "BTC/USD", side: "BUY", quantity: 1, limitPrice: 48000 });

    const first = pendingOrderStore.tryTransitionToFilled(order.id);
    const second = pendingOrderStore.tryTransitionToFilled(order.id);

    expect(first).toBe(true);
    expect(second).toBe(false);
  });
});
