import { describe, it, expect, beforeEach, vi } from "vitest";

// ─── vi.mock MUST be at the top level (Vitest hoisting) ─────────────────────
// All DB calls are mocked so tests never hit a real network.
// Write operations (insert/update/closeTrade) succeed by default.
// Read operations (findAllOpenTrades/findAllPendingOrders) are configured per-test.
vi.mock("../../db/TradeRepository", () => ({
  tradeRepository: {
    findAllOpenTrades: vi.fn(),
    findOpenTrades: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    closeTrade: vi.fn(),
  },
}));

vi.mock("../../db/PendingOrderRepository", () => ({
  pendingOrderRepository: {
    findAllPendingOrders: vi.fn(),
    findByUserId: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    cancel: vi.fn(),
    fill: vi.fn(),
    atomicFillAndCreateTrade: vi.fn().mockResolvedValue(true),
  },
}));

// ─── Imports after mocks ─────────────────────────────────────────────────────
import { tradingStateRecovery } from "../TradingStateRecovery";
import { positionStore } from "../PositionStore";
import { pendingOrderStore } from "../PendingOrderStore";
import { priceStore } from "../../market/MarketPriceStore";
import { tradingEventBus } from "../../websocket/trading";
import { tradeRepository } from "../../db/TradeRepository";
import { pendingOrderRepository } from "../../db/PendingOrderRepository";
import { Position, PendingOrder } from "../types";

// ─── Test fixture data ────────────────────────────────────────────────────────
const USER_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const USER_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

const openPosition: Position = {
  id: "pos-11111111-aaaa-aaaa-aaaa-111111111111",
  userId: USER_A,
  instrument: "BTC/USD",
  side: "LONG",
  quantity: 0.01,
  entryPrice: 100000,
  entryTime: "2026-09-01T10:00:00.000Z",
  status: "OPEN",
  stopLoss: 99000,
  takeProfit: 102000,
  unrealizedPnl: 0,
  strategy: "Trend Follow",
  orderType: "Market",
  createdAt: "2026-09-01T10:00:00.000Z",
  updatedAt: "2026-09-01T10:00:00.000Z",
};

const pendingOrder: PendingOrder = {
  id: "po-22222222-bbbb-bbbb-bbbb-222222222222",
  userId: USER_A,
  instrument: "XAU/USD",
  side: "LONG",
  quantity: 0.01,
  limitPrice: 4400,
  stopLoss: 4380,
  takeProfit: 4440,
  status: "PENDING",
  strategy: "Liquidity Sweep",
  createdAt: "2026-09-01T10:00:00.000Z",
  updatedAt: "2026-09-01T10:00:00.000Z",
};

// ─── Helpers ─────────────────────────────────────────────────────────────────
function setMockPrice(
  instrument: string,
  price: number,
  status: "LIVE" | "STALE" | "OFFLINE" = "LIVE"
) {
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

// ─── Test setup ───────────────────────────────────────────────────────────────
beforeEach(() => {
  positionStore.clear();
  pendingOrderStore.clear();
  vi.clearAllMocks();

  // Reset fixture objects to their initial state so mutations from behavior tests
  // (e.g. engine setting status=CLOSED or status=FILLED) don't leak into subsequent tests.
  openPosition.status = "OPEN";
  openPosition.exitPrice = undefined;
  openPosition.exitTime = undefined;
  openPosition.exitReason = undefined;
  openPosition.realizedPnl = undefined;
  openPosition.unrealizedPnl = 0;
  pendingOrder.status = "PENDING";
  pendingOrder.updatedAt = "2026-09-01T10:00:00.000Z";

  // Default: empty DB state (no positions/orders to recover)
  vi.mocked(tradeRepository.findAllOpenTrades).mockResolvedValue([]);
  vi.mocked(pendingOrderRepository.findAllPendingOrders).mockResolvedValue([]);

  // Default: write operations succeed silently
  vi.mocked(tradeRepository.closeTrade).mockResolvedValue(undefined);
  vi.mocked(tradeRepository.insert).mockResolvedValue(undefined);
  vi.mocked(tradeRepository.update).mockResolvedValue(undefined);
  vi.mocked(pendingOrderRepository.insert).mockResolvedValue(undefined);
  vi.mocked(pendingOrderRepository.update).mockResolvedValue(undefined);
  vi.mocked(pendingOrderRepository.cancel).mockResolvedValue(undefined);
  vi.mocked(pendingOrderRepository.fill).mockResolvedValue(undefined);

  // Set neutral prices (will be overridden per-test as needed)
  setMockPrice("BTC/USD", 100500);
  setMockPrice("XAU/USD", 4500);
});

// ─── Tests ────────────────────────────────────────────────────────────────────
describe("Step 3C-5: Restart Recovery", () => {

  // ────────────────────────────────────────────────────────────────────────────
  // GROUP 1: What gets loaded / ignored
  // ────────────────────────────────────────────────────────────────────────────

  it("1. OPEN trades are loaded into PositionStore during recovery", async () => {
    vi.mocked(tradeRepository.findAllOpenTrades).mockResolvedValueOnce([openPosition]);

    await tradingStateRecovery.recover();

    expect(positionStore.get(openPosition.id)).toBeDefined();
    expect(positionStore.getByUser(USER_A).length).toBe(1);
  });

  it("2. CLOSED (WIN) trades are NOT restored (defensive guard)", async () => {
    const closed: Position = { ...openPosition, id: "pos-win", status: "CLOSED" as any, realizedPnl: 500 };
    vi.mocked(tradeRepository.findAllOpenTrades).mockResolvedValueOnce([closed]);

    await tradingStateRecovery.recover();

    expect(positionStore.get("pos-win")).toBeUndefined();
  });

  it("3. CLOSED (LOSS) trades are NOT restored (defensive guard)", async () => {
    const closed: Position = { ...openPosition, id: "pos-loss", status: "CLOSED" as any, realizedPnl: -200 };
    vi.mocked(tradeRepository.findAllOpenTrades).mockResolvedValueOnce([closed]);

    await tradingStateRecovery.recover();

    expect(positionStore.get("pos-loss")).toBeUndefined();
  });

  it("4. CLOSING positions are NOT restored (defensive guard)", async () => {
    const closing: Position = { ...openPosition, id: "pos-closing", status: "CLOSING" as any };
    vi.mocked(tradeRepository.findAllOpenTrades).mockResolvedValueOnce([closing]);

    await tradingStateRecovery.recover();

    expect(positionStore.get("pos-closing")).toBeUndefined();
  });

  it("5. PENDING orders are loaded into PendingOrderStore during recovery", async () => {
    vi.mocked(pendingOrderRepository.findAllPendingOrders).mockResolvedValueOnce([pendingOrder]);

    await tradingStateRecovery.recover();

    expect(pendingOrderStore.get(pendingOrder.id)).toBeDefined();
    expect(pendingOrderStore.getByUser(USER_A).length).toBe(1);
  });

  it("6. FILLED orders are NOT restored (defensive guard)", async () => {
    const filled: PendingOrder = { ...pendingOrder, id: "po-filled", status: "FILLED" as any };
    vi.mocked(pendingOrderRepository.findAllPendingOrders).mockResolvedValueOnce([filled]);

    await tradingStateRecovery.recover();

    expect(pendingOrderStore.get("po-filled")).toBeUndefined();
  });

  it("7. CANCELLED orders are NOT restored (defensive guard)", async () => {
    const cancelled: PendingOrder = { ...pendingOrder, id: "po-cancelled", status: "CANCELLED" as any };
    vi.mocked(pendingOrderRepository.findAllPendingOrders).mockResolvedValueOnce([cancelled]);

    await tradingStateRecovery.recover();

    expect(pendingOrderStore.get("po-cancelled")).toBeUndefined();
  });

  // ────────────────────────────────────────────────────────────────────────────
  // GROUP 2: Field preservation (positions)
  // ────────────────────────────────────────────────────────────────────────────

  it("8. Recovered position preserves its exact database ID", async () => {
    vi.mocked(tradeRepository.findAllOpenTrades).mockResolvedValueOnce([openPosition]);

    await tradingStateRecovery.recover();

    expect(positionStore.get(openPosition.id)!.id).toBe(openPosition.id);
  });

  it("9. Recovered position preserves SL", async () => {
    vi.mocked(tradeRepository.findAllOpenTrades).mockResolvedValueOnce([openPosition]);

    await tradingStateRecovery.recover();

    expect(positionStore.get(openPosition.id)!.stopLoss).toBe(99000);
  });

  it("10. Recovered position preserves TP", async () => {
    vi.mocked(tradeRepository.findAllOpenTrades).mockResolvedValueOnce([openPosition]);

    await tradingStateRecovery.recover();

    expect(positionStore.get(openPosition.id)!.takeProfit).toBe(102000);
  });

  it("11. Recovered position preserves quantity", async () => {
    vi.mocked(tradeRepository.findAllOpenTrades).mockResolvedValueOnce([openPosition]);

    await tradingStateRecovery.recover();

    expect(positionStore.get(openPosition.id)!.quantity).toBe(0.01);
  });

  it("12. Recovered position preserves strategy", async () => {
    vi.mocked(tradeRepository.findAllOpenTrades).mockResolvedValueOnce([openPosition]);

    await tradingStateRecovery.recover();

    expect(positionStore.get(openPosition.id)!.strategy).toBe("Trend Follow");
  });

  it("13. Recovered position preserves orderType (Market)", async () => {
    vi.mocked(tradeRepository.findAllOpenTrades).mockResolvedValueOnce([openPosition]);

    await tradingStateRecovery.recover();

    expect(positionStore.get(openPosition.id)!.orderType).toBe("Market");
  });

  it("13b. Recovered position preserves orderType (LIMIT)", async () => {
    const limitPos: Position = { ...openPosition, id: "pos-limit", orderType: "LIMIT" };
    vi.mocked(tradeRepository.findAllOpenTrades).mockResolvedValueOnce([limitPos]);

    await tradingStateRecovery.recover();

    expect(positionStore.get("pos-limit")!.orderType).toBe("LIMIT");
  });

  it("14. Recovered position status is OPEN", async () => {
    vi.mocked(tradeRepository.findAllOpenTrades).mockResolvedValueOnce([openPosition]);

    await tradingStateRecovery.recover();

    expect(positionStore.get(openPosition.id)!.status).toBe("OPEN");
  });

  // ────────────────────────────────────────────────────────────────────────────
  // GROUP 3: Field preservation (pending orders)
  // ────────────────────────────────────────────────────────────────────────────

  it("15. Recovered pending order preserves its exact database ID", async () => {
    vi.mocked(pendingOrderRepository.findAllPendingOrders).mockResolvedValueOnce([pendingOrder]);

    await tradingStateRecovery.recover();

    expect(pendingOrderStore.get(pendingOrder.id)!.id).toBe(pendingOrder.id);
  });

  it("16. Recovered pending order preserves SL", async () => {
    vi.mocked(pendingOrderRepository.findAllPendingOrders).mockResolvedValueOnce([pendingOrder]);

    await tradingStateRecovery.recover();

    expect(pendingOrderStore.get(pendingOrder.id)!.stopLoss).toBe(4380);
  });

  it("17. Recovered pending order preserves TP", async () => {
    vi.mocked(pendingOrderRepository.findAllPendingOrders).mockResolvedValueOnce([pendingOrder]);

    await tradingStateRecovery.recover();

    expect(pendingOrderStore.get(pendingOrder.id)!.takeProfit).toBe(4440);
  });

  it("18. Recovered pending order preserves quantity", async () => {
    vi.mocked(pendingOrderRepository.findAllPendingOrders).mockResolvedValueOnce([pendingOrder]);

    await tradingStateRecovery.recover();

    expect(pendingOrderStore.get(pendingOrder.id)!.quantity).toBe(0.01);
  });

  it("19. Recovered pending order preserves strategy", async () => {
    vi.mocked(pendingOrderRepository.findAllPendingOrders).mockResolvedValueOnce([pendingOrder]);

    await tradingStateRecovery.recover();

    expect(pendingOrderStore.get(pendingOrder.id)!.strategy).toBe("Liquidity Sweep");
  });

  it("20. Recovered pending order status is PENDING", async () => {
    vi.mocked(pendingOrderRepository.findAllPendingOrders).mockResolvedValueOnce([pendingOrder]);

    await tradingStateRecovery.recover();

    expect(pendingOrderStore.get(pendingOrder.id)!.status).toBe("PENDING");
  });

  // ────────────────────────────────────────────────────────────────────────────
  // GROUP 4: Recovery is silent (no events, no DB writes)
  // ────────────────────────────────────────────────────────────────────────────

  it("21. Recovery does not create DB writes (no insert/update/delete called)", async () => {
    vi.mocked(tradeRepository.findAllOpenTrades).mockResolvedValueOnce([openPosition]);
    vi.mocked(pendingOrderRepository.findAllPendingOrders).mockResolvedValueOnce([pendingOrder]);

    await tradingStateRecovery.recover();

    expect(vi.mocked(tradeRepository.insert)).not.toHaveBeenCalled();
    expect(vi.mocked(tradeRepository.update)).not.toHaveBeenCalled();
    expect(vi.mocked(tradeRepository.closeTrade)).not.toHaveBeenCalled();
    expect(vi.mocked(pendingOrderRepository.insert)).not.toHaveBeenCalled();
    expect(vi.mocked(pendingOrderRepository.update)).not.toHaveBeenCalled();
    expect(vi.mocked(pendingOrderRepository.cancel)).not.toHaveBeenCalled();
    expect(vi.mocked(pendingOrderRepository.fill)).not.toHaveBeenCalled();
  });

  it("22. Recovery does not emit positionCreated event", async () => {
    vi.mocked(tradeRepository.findAllOpenTrades).mockResolvedValueOnce([openPosition]);
    const emitSpy = vi.spyOn(tradingEventBus, "emit");

    await tradingStateRecovery.recover();

    expect(emitSpy).not.toHaveBeenCalledWith("positionCreated", expect.anything());
  });

  it("23. Recovery does not emit pendingOrderCreated event", async () => {
    vi.mocked(pendingOrderRepository.findAllPendingOrders).mockResolvedValueOnce([pendingOrder]);
    const emitSpy = vi.spyOn(tradingEventBus, "emit");

    await tradingStateRecovery.recover();

    expect(emitSpy).not.toHaveBeenCalledWith("pendingOrderCreated", expect.anything());
  });

  it("24. Recovery emits no trading events at all during restore", async () => {
    vi.mocked(tradeRepository.findAllOpenTrades).mockResolvedValueOnce([openPosition]);
    vi.mocked(pendingOrderRepository.findAllPendingOrders).mockResolvedValueOnce([pendingOrder]);
    const emitSpy = vi.spyOn(tradingEventBus, "emit");

    await tradingStateRecovery.recover();

    // positionUpdated may fire from priceStore ticks in the background — we only
    // check that CREATION events were not emitted during the restore itself.
    expect(emitSpy).not.toHaveBeenCalledWith("positionCreated", expect.anything());
    expect(emitSpy).not.toHaveBeenCalledWith("pendingOrderCreated", expect.anything());
    expect(emitSpy).not.toHaveBeenCalledWith("positionClosed", expect.anything());
    expect(emitSpy).not.toHaveBeenCalledWith("pendingOrderCancelled", expect.anything());
    expect(emitSpy).not.toHaveBeenCalledWith("pendingOrderFilled", expect.anything());
  });

  // ────────────────────────────────────────────────────────────────────────────
  // GROUP 5: Idempotency
  // ────────────────────────────────────────────────────────────────────────────

  it("25. Duplicate recovery does not duplicate positions in the store", async () => {
    vi.mocked(tradeRepository.findAllOpenTrades).mockResolvedValue([openPosition]);
    vi.mocked(pendingOrderRepository.findAllPendingOrders).mockResolvedValue([]);

    await tradingStateRecovery.recover();
    await tradingStateRecovery.recover(); // second call — idempotent

    expect(positionStore.getByUser(USER_A).length).toBe(1);
  });

  it("26. Duplicate recovery does not duplicate pending orders in the store", async () => {
    vi.mocked(tradeRepository.findAllOpenTrades).mockResolvedValue([]);
    vi.mocked(pendingOrderRepository.findAllPendingOrders).mockResolvedValue([pendingOrder]);

    await tradingStateRecovery.recover();
    await tradingStateRecovery.recover(); // second call — idempotent

    expect(pendingOrderStore.getByUser(USER_A).length).toBe(1);
  });

  // ────────────────────────────────────────────────────────────────────────────
  // GROUP 6: Recovery failure handling
  // ────────────────────────────────────────────────────────────────────────────

  it("27. Recovery throws if trade repository query fails", async () => {
    vi.mocked(tradeRepository.findAllOpenTrades).mockRejectedValueOnce(
      new Error("Startup recovery failed — could not load open trades: connection timeout")
    );

    await expect(tradingStateRecovery.recover()).rejects.toThrow("Startup recovery failed");
  });

  it("28. Recovery throws if pending order repository query fails", async () => {
    vi.mocked(tradeRepository.findAllOpenTrades).mockResolvedValueOnce([]);
    vi.mocked(pendingOrderRepository.findAllPendingOrders).mockRejectedValueOnce(
      new Error("Startup recovery failed — could not load pending orders: connection refused")
    );

    await expect(tradingStateRecovery.recover()).rejects.toThrow("Startup recovery failed");
  });

  it("29. When trade query fails, no positions are added to the store", async () => {
    vi.mocked(tradeRepository.findAllOpenTrades).mockRejectedValueOnce(new Error("DB down"));

    try {
      await tradingStateRecovery.recover();
    } catch {
      // expected failure
    }

    expect(positionStore.getByUser(USER_A).length).toBe(0);
  });

  // ────────────────────────────────────────────────────────────────────────────
  // GROUP 7: Post-recovery behavior — SL/TP still works
  // ────────────────────────────────────────────────────────────────────────────

  it("30. Recovered LONG position triggers SL when market falls below stopLoss", async () => {
    // Ensure the engine singleton is imported (it subscribes to priceStore)
    const { tradingEngine } = await import("../TradingEngine");
    void tradingEngine; // satisfy linter — we just need the subscription active

    // Use a fresh copy so mutations by the engine don't pollute the shared fixture
    const pos = { ...openPosition };
    vi.mocked(tradeRepository.findAllOpenTrades).mockResolvedValueOnce([pos]);
    vi.mocked(pendingOrderRepository.findAllPendingOrders).mockResolvedValueOnce([]);

    // Set a neutral price first (above SL=99000), then recover
    setMockPrice("BTC/USD", 100500);
    await tradingStateRecovery.recover();
    expect(positionStore.get(pos.id)!.status).toBe("OPEN");

    // Trigger SL: price drops below 99000
    setMockPrice("BTC/USD", 98500);

    expect(positionStore.get(pos.id)!.status).toBe("CLOSED");
    expect(positionStore.get(pos.id)!.exitReason).toBe("STOP_LOSS");
  });

  it("31. Recovered LONG position triggers TP when market rises to takeProfit", async () => {
    const { tradingEngine } = await import("../TradingEngine");
    void tradingEngine;

    const pos = { ...openPosition };
    vi.mocked(tradeRepository.findAllOpenTrades).mockResolvedValueOnce([pos]);
    vi.mocked(pendingOrderRepository.findAllPendingOrders).mockResolvedValueOnce([]);

    setMockPrice("BTC/USD", 100500);
    await tradingStateRecovery.recover();
    expect(positionStore.get(pos.id)!.status).toBe("OPEN");

    // Trigger TP: price rises to 102000
    setMockPrice("BTC/USD", 102000);

    expect(positionStore.get(pos.id)!.status).toBe("CLOSED");
    expect(positionStore.get(pos.id)!.exitReason).toBe("TAKE_PROFIT");
  });

  it("32. Recovered LONG position computes P&L correctly at TP", async () => {
    const { tradingEngine } = await import("../TradingEngine");
    void tradingEngine;

    const pos: Position = {
      ...openPosition,
      id: "pos-pnl",
      entryPrice: 100000,
      quantity: 0.01,
      takeProfit: 102000,
      stopLoss: 99000,
    };

    vi.mocked(tradeRepository.findAllOpenTrades).mockResolvedValueOnce([pos]);
    vi.mocked(pendingOrderRepository.findAllPendingOrders).mockResolvedValueOnce([]);

    setMockPrice("BTC/USD", 100500);
    await tradingStateRecovery.recover();

    setMockPrice("BTC/USD", 102000); // Hits TP

    const closed = positionStore.get("pos-pnl")!;
    expect(closed.status).toBe("CLOSED");
    // (102000 - 100000) * 0.01 = 20
    expect(closed.realizedPnl).toBeCloseTo(20, 5);
  });

  // ────────────────────────────────────────────────────────────────────────────
  // GROUP 8: Post-recovery behavior — pending order fills
  // ────────────────────────────────────────────────────────────────────────────

  it("33. Recovered PENDING BUY LIMIT order fills when market falls to limitPrice", async () => {
    const { tradingEngine } = await import("../TradingEngine");
    void tradingEngine;

    // Use a fresh copy so engine mutations (status=FILLED) don't pollute shared fixture
    const order = { ...pendingOrder };
    vi.mocked(tradeRepository.findAllOpenTrades).mockResolvedValueOnce([]);
    vi.mocked(pendingOrderRepository.findAllPendingOrders).mockResolvedValueOnce([order]);

    // Neutral price above limit (4400), then recover
    setMockPrice("XAU/USD", 4500);
    await tradingStateRecovery.recover();

    expect(pendingOrderStore.get(order.id)!.status).toBe("PENDING");

    // Market drops to/below limit price — should fill
    setMockPrice("XAU/USD", 4399);

    // Position must be created for USER_A
    const userPositions = positionStore.getByUser(USER_A);
    expect(userPositions.length).toBe(1);
    expect(userPositions[0].entryPrice).toBe(4400); // exact limitPrice, not tick price
    expect(userPositions[0].side).toBe("LONG");
    expect(userPositions[0].userId).toBe(USER_A);
  });

  it("34. Recovered PENDING order fills at exact limitPrice, not tick price", async () => {
    const { tradingEngine } = await import("../TradingEngine");
    void tradingEngine;

    const order = { ...pendingOrder };
    vi.mocked(tradeRepository.findAllOpenTrades).mockResolvedValueOnce([]);
    vi.mocked(pendingOrderRepository.findAllPendingOrders).mockResolvedValueOnce([order]);

    setMockPrice("XAU/USD", 4500);
    await tradingStateRecovery.recover();

    // Market drops WAY below limit
    setMockPrice("XAU/USD", 4200);

    const pos = positionStore.getByUser(USER_A)[0];
    expect(pos.entryPrice).toBe(4400); // Still exact limitPrice
  });

  it("35. Recovered pending order preserves SL/TP on the created position", async () => {
    const { tradingEngine } = await import("../TradingEngine");
    void tradingEngine;

    const order = { ...pendingOrder };
    vi.mocked(tradeRepository.findAllOpenTrades).mockResolvedValueOnce([]);
    vi.mocked(pendingOrderRepository.findAllPendingOrders).mockResolvedValueOnce([order]);

    setMockPrice("XAU/USD", 4500);
    await tradingStateRecovery.recover();

    setMockPrice("XAU/USD", 4399); // Fill

    const pos = positionStore.getByUser(USER_A)[0];
    expect(pos.stopLoss).toBe(4380);
    expect(pos.takeProfit).toBe(4440);
    expect(pos.strategy).toBe("Liquidity Sweep");
  });

  it("36. Recovered pending order cannot fill more than once (atomic guard)", async () => {
    const { tradingEngine } = await import("../TradingEngine");
    void tradingEngine;

    const order = { ...pendingOrder };
    vi.mocked(tradeRepository.findAllOpenTrades).mockResolvedValueOnce([]);
    vi.mocked(pendingOrderRepository.findAllPendingOrders).mockResolvedValueOnce([order]);

    setMockPrice("XAU/USD", 4500);
    await tradingStateRecovery.recover();

    setMockPrice("XAU/USD", 4399); // Fill tick 1
    setMockPrice("XAU/USD", 4350); // Fill tick 2 (should be ignored)
    setMockPrice("XAU/USD", 4300); // Fill tick 3 (should be ignored)

    expect(positionStore.getByUser(USER_A).length).toBe(1);
  });

  // ────────────────────────────────────────────────────────────────────────────
  // GROUP 9: Multi-user isolation
  // ────────────────────────────────────────────────────────────────────────────

  it("37. User isolation is preserved: User B's position is not visible to User A query", async () => {
    // Use fresh copies to prevent cross-test mutation leakage
    const posA = { ...openPosition };
    const posB: Position = { ...openPosition, id: "pos-user-b", userId: USER_B };
    vi.mocked(tradeRepository.findAllOpenTrades).mockResolvedValueOnce([posA, posB]);

    await tradingStateRecovery.recover();

    expect(positionStore.getByUser(USER_A).length).toBe(1);
    expect(positionStore.getByUser(USER_B).length).toBe(1);
    expect(positionStore.getByUser(USER_A)[0].userId).toBe(USER_A);
    expect(positionStore.getByUser(USER_B)[0].userId).toBe(USER_B);
  });

  it("38. Multi-user recovery: all users' orders are independently restored", async () => {
    // Use fresh copies to prevent cross-test mutation leakage
    const orderA = { ...pendingOrder };
    const orderB: PendingOrder = {
      ...pendingOrder,
      id: "po-user-b",
      userId: USER_B,
      instrument: "BTC/USD",
      limitPrice: 98000,
    };
    vi.mocked(pendingOrderRepository.findAllPendingOrders).mockResolvedValueOnce([orderA, orderB]);

    await tradingStateRecovery.recover();

    expect(pendingOrderStore.getByUser(USER_A).length).toBe(1);
    expect(pendingOrderStore.getByUser(USER_B).length).toBe(1);
  });

  // ────────────────────────────────────────────────────────────────────────────
  // GROUP 10: Full restart simulation
  // ────────────────────────────────────────────────────────────────────────────

  it("39. RESTART SIMULATION: full in-memory reset + recovery restores correct state", async () => {
    // ── Phase A: Simulate pre-restart state ───
    // (fixtures represent what would exist in the DB after normal trading)

    // ── Phase B: Simulate server restart (stores are already cleared in beforeEach) ──
    expect(positionStore.getByUser(USER_A).length).toBe(0);
    expect(pendingOrderStore.getByUser(USER_A).length).toBe(0);

    // ── Phase C: Run recovery from mocked DB — use fresh copies ──
    const posSnap = { ...openPosition };
    const orderSnap = { ...pendingOrder };
    vi.mocked(tradeRepository.findAllOpenTrades).mockResolvedValueOnce([posSnap]);
    vi.mocked(pendingOrderRepository.findAllPendingOrders).mockResolvedValueOnce([orderSnap]);

    const result = await tradingStateRecovery.recover();

    // ── Phase D: Verify stores are correctly populated ──
    expect(result.positions).toBe(1);
    expect(result.pendingOrders).toBe(1);

    // Position restored with correct ID
    const restoredPos = positionStore.get(posSnap.id)!;
    expect(restoredPos).toBeDefined();
    expect(restoredPos.id).toBe(openPosition.id);
    expect(restoredPos.instrument).toBe("BTC/USD");
    expect(restoredPos.side).toBe("LONG");
    expect(restoredPos.quantity).toBe(0.01);
    expect(restoredPos.entryPrice).toBe(100000);
    expect(restoredPos.stopLoss).toBe(99000);
    expect(restoredPos.takeProfit).toBe(102000);
    expect(restoredPos.strategy).toBe("Trend Follow");
    expect(restoredPos.orderType).toBe("Market");
    expect(restoredPos.status).toBe("OPEN");
    expect(restoredPos.userId).toBe(USER_A);

    // Pending order restored with correct ID
    const restoredOrder = pendingOrderStore.get(orderSnap.id)!;
    expect(restoredOrder).toBeDefined();
    expect(restoredOrder.id).toBe(pendingOrder.id);
    expect(restoredOrder.instrument).toBe("XAU/USD");
    expect(restoredOrder.side).toBe("LONG");
    expect(restoredOrder.quantity).toBe(0.01);
    expect(restoredOrder.limitPrice).toBe(4400);
    expect(restoredOrder.stopLoss).toBe(4380);
    expect(restoredOrder.takeProfit).toBe(4440);
    expect(restoredOrder.strategy).toBe("Liquidity Sweep");
    expect(restoredOrder.status).toBe("PENDING");
    expect(restoredOrder.userId).toBe(USER_A);
  });
});
