import { describe, it, expect, beforeEach, vi } from "vitest";
import { tradingEngine } from "../TradingEngine";
import { pendingOrderStore } from "../PendingOrderStore";
import { positionStore } from "../PositionStore";
import { priceStore } from "../../market/MarketPriceStore";
import { pendingOrderRepository } from "../../db/PendingOrderRepository";
import { tradeRepository } from "../../db/TradeRepository";

describe("Pending Limit Order Auto-Fill (Feature C Test Suite)", () => {
  const USER_A = "user-limit-1";
  const USER_B = "user-limit-2";

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(pendingOrderRepository, "insert").mockResolvedValue();
    vi.spyOn(pendingOrderRepository, "cancel").mockResolvedValue();
    vi.spyOn(pendingOrderRepository, "atomicFillAndCreateTrade").mockResolvedValue(true);
    vi.spyOn(tradeRepository, "insert").mockResolvedValue();

    pendingOrderStore.clear();
    positionStore.clear();

    priceStore.setPrice("BTC/USD", {
      instrument: "BTC/USD",
      price: 80100,
      timestamp: new Date().toISOString(),
      source: "coinbase",
      sourceSymbol: "BTC-USD",
      isProxy: false,
      status: "LIVE",
      expectedUpdateIntervalMs: 1000,
    });
  });

  // A. BUY LIMIT above current price -> remains pending
  it("A: BUY LIMIT order with limit price below current price remains pending", async () => {
    // Current price 80,100, limit price 79,900
    const order = await tradingEngine.openLimitOrder(USER_A, {
      instrument: "BTC/USD",
      side: "BUY",
      quantity: 1,
      limitPrice: 79900,
    });

    expect(order.status).toBe("PENDING");
    const openPositions = positionStore.getAllOpen();
    expect(openPositions.length).toBe(0);
  });

  // B. BUY LIMIT touched -> fills
  it("B: BUY LIMIT fills automatically when market price reaches limit price (79,900)", async () => {
    const order = await tradingEngine.openLimitOrder(USER_A, {
      instrument: "BTC/USD",
      side: "BUY",
      quantity: 1,
      limitPrice: 79900,
    });

    // Price touches 79,900
    priceStore.setPrice("BTC/USD", {
      instrument: "BTC/USD",
      price: 79900,
      timestamp: new Date().toISOString(),
      source: "coinbase",
      sourceSymbol: "BTC-USD",
      isProxy: false,
      status: "LIVE",
      expectedUpdateIntervalMs: 1000,
    });

    expect(pendingOrderStore.get(order.id)?.status).toBe("FILLED");
    const openPositions = positionStore.getAllOpen();
    expect(openPositions.length).toBe(1);
    expect(openPositions[0].entryPrice).toBe(79900);
    expect(openPositions[0].side).toBe("LONG");
  });

  // C. BUY LIMIT crossed below -> fills
  it("C: BUY LIMIT fills when market price drops below limit price (79,850 < 79,900)", async () => {
    const order = await tradingEngine.openLimitOrder(USER_A, {
      instrument: "BTC/USD",
      side: "BUY",
      quantity: 1,
      limitPrice: 79900,
    });

    priceStore.setPrice("BTC/USD", {
      instrument: "BTC/USD",
      price: 79850,
      timestamp: new Date().toISOString(),
      source: "coinbase",
      sourceSymbol: "BTC-USD",
      isProxy: false,
      status: "LIVE",
      expectedUpdateIntervalMs: 1000,
    });

    expect(pendingOrderStore.get(order.id)?.status).toBe("FILLED");
    expect(positionStore.getAllOpen().length).toBe(1);
  });

  // D. SELL LIMIT below current price -> remains pending
  it("D: SELL LIMIT order with limit price above current price remains pending", async () => {
    // Current price 80,100, limit price 80,500
    const order = await tradingEngine.openLimitOrder(USER_A, {
      instrument: "BTC/USD",
      side: "SELL",
      quantity: 1,
      limitPrice: 80500,
    });

    expect(order.status).toBe("PENDING");
    expect(positionStore.getAllOpen().length).toBe(0);
  });

  // E. SELL LIMIT touched -> fills
  it("E: SELL LIMIT fills automatically when market price reaches/crosses limit price (80,500)", async () => {
    const order = await tradingEngine.openLimitOrder(USER_A, {
      instrument: "BTC/USD",
      side: "SELL",
      quantity: 1,
      limitPrice: 80500,
    });

    priceStore.setPrice("BTC/USD", {
      instrument: "BTC/USD",
      price: 80500,
      timestamp: new Date().toISOString(),
      source: "coinbase",
      sourceSymbol: "BTC-USD",
      isProxy: false,
      status: "LIVE",
      expectedUpdateIntervalMs: 1000,
    });

    expect(pendingOrderStore.get(order.id)?.status).toBe("FILLED");
    const openPositions = positionStore.getAllOpen();
    expect(openPositions.length).toBe(1);
    expect(openPositions[0].side).toBe("SHORT");
    expect(openPositions[0].entryPrice).toBe(80500);
  });

  // F. repeated ticks -> only one fill
  it("F: repeated live ticks at fill price result in exactly ONE fill and position", async () => {
    const order = await tradingEngine.openLimitOrder(USER_A, {
      instrument: "BTC/USD",
      side: "BUY",
      quantity: 1,
      limitPrice: 79900,
    });

    // Tick 1
    priceStore.setPrice("BTC/USD", {
      instrument: "BTC/USD",
      price: 79900,
      timestamp: new Date().toISOString(),
      source: "coinbase",
      sourceSymbol: "BTC-USD",
      isProxy: false,
      status: "LIVE",
      expectedUpdateIntervalMs: 1000,
    });

    // Tick 2 & 3
    priceStore.setPrice("BTC/USD", {
      instrument: "BTC/USD",
      price: 79890,
      timestamp: new Date().toISOString(),
      source: "coinbase",
      sourceSymbol: "BTC-USD",
      isProxy: false,
      status: "LIVE",
      expectedUpdateIntervalMs: 1000,
    });

    priceStore.setPrice("BTC/USD", {
      instrument: "BTC/USD",
      price: 79880,
      timestamp: new Date().toISOString(),
      source: "coinbase",
      sourceSymbol: "BTC-USD",
      isProxy: false,
      status: "LIVE",
      expectedUpdateIntervalMs: 1000,
    });

    expect(positionStore.getAllOpen().length).toBe(1);
  });

  // G. filled order cannot fill again
  it("G: a filled limit order cannot be filled again", async () => {
    const order = await tradingEngine.openLimitOrder(USER_A, {
      instrument: "BTC/USD",
      side: "BUY",
      quantity: 1,
      limitPrice: 79900,
    });

    priceStore.setPrice("BTC/USD", {
      instrument: "BTC/USD",
      price: 79900,
      timestamp: new Date().toISOString(),
      source: "coinbase",
      sourceSymbol: "BTC-USD",
      isProxy: false,
      status: "LIVE",
      expectedUpdateIntervalMs: 1000,
    });

    const filledOrder = pendingOrderStore.get(order.id);
    expect(filledOrder?.status).toBe("FILLED");

    const secondFillAttempt = pendingOrderStore.tryTransitionToFilled(order.id);
    expect(secondFillAttempt).toBe(false);
  });

  // H. SL/TP transferred
  it("H: SL and TP are transferred from limit order to created open position", async () => {
    const order = await tradingEngine.openLimitOrder(USER_A, {
      instrument: "BTC/USD",
      side: "BUY",
      quantity: 1,
      limitPrice: 79900,
      stopLoss: 78000,
      takeProfit: 85000,
    });

    priceStore.setPrice("BTC/USD", {
      instrument: "BTC/USD",
      price: 79900,
      timestamp: new Date().toISOString(),
      source: "coinbase",
      sourceSymbol: "BTC-USD",
      isProxy: false,
      status: "LIVE",
      expectedUpdateIntervalMs: 1000,
    });

    const openPos = positionStore.getAllOpen()[0];
    expect(openPos.stopLoss).toBe(78000);
    expect(openPos.takeProfit).toBe(85000);
  });

  // I. strategy transferred
  it("I: strategy metadata is transferred from limit order to created open position", async () => {
    const order = await tradingEngine.openLimitOrder(USER_A, {
      instrument: "BTC/USD",
      side: "BUY",
      quantity: 1,
      limitPrice: 79900,
      strategy: "LIQUIDITY_SWEEP",
    });

    priceStore.setPrice("BTC/USD", {
      instrument: "BTC/USD",
      price: 79900,
      timestamp: new Date().toISOString(),
      source: "coinbase",
      sourceSymbol: "BTC-USD",
      isProxy: false,
      status: "LIVE",
      expectedUpdateIntervalMs: 1000,
    });

    const openPos = positionStore.getAllOpen()[0];
    expect(openPos.strategy).toBe("LIQUIDITY_SWEEP");
  });

  // J. ownership enforced
  it("J: limit order ownership is enforced per user", async () => {
    const orderA = await tradingEngine.openLimitOrder(USER_A, {
      instrument: "BTC/USD",
      side: "BUY",
      quantity: 1,
      limitPrice: 79900,
    });

    await expect(tradingEngine.cancelLimitOrder(USER_B, orderA.id)).rejects.toThrow(
      "Order does not belong to the authenticated user"
    );
  });

  // K. atomic DB fill rollback on DB error
  it("K: DB error during atomic fill rolls back in-memory order status and removes position", async () => {
    vi.spyOn(pendingOrderRepository, "atomicFillAndCreateTrade").mockRejectedValue(
      new Error("DB connection timeout")
    );

    const order = await tradingEngine.openLimitOrder(USER_A, {
      instrument: "BTC/USD",
      side: "BUY",
      quantity: 1,
      limitPrice: 79900,
    });

    priceStore.setPrice("BTC/USD", {
      instrument: "BTC/USD",
      price: 79900,
      timestamp: new Date().toISOString(),
      source: "coinbase",
      sourceSymbol: "BTC-USD",
      isProxy: false,
      status: "LIVE",
      expectedUpdateIntervalMs: 1000,
    });

    // Allow promise microtask to resolve
    await new Promise((r) => setTimeout(r, 20));

    expect(pendingOrderStore.get(order.id)?.status).toBe("PENDING");
    expect(positionStore.getAllOpen().length).toBe(0);
  });
});
