import { describe, it, expect, beforeEach, vi } from "vitest";
import { tradingEngine, TradingError } from "../TradingEngine";
import { positionStore } from "../PositionStore";
import { priceStore } from "../../market/MarketPriceStore";
import { tradeRepository } from "../../db/TradeRepository";

describe("Partial Position Exit Feature Tests", () => {
  const USER_A = "user-partial-1";
  const USER_B = "user-partial-2";

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(tradeRepository, "insert").mockResolvedValue();
    vi.spyOn(tradeRepository, "update").mockResolvedValue();
    vi.spyOn(tradeRepository, "closeTrade").mockResolvedValue();

    positionStore.clear();
    priceStore.setPrice("BTC/USD", {
      instrument: "BTC/USD",
      price: 80000,
      timestamp: new Date().toISOString(),
      source: "coinbase",
      sourceSymbol: "BTC-USD",
      isProxy: false,
      status: "LIVE",
      expectedUpdateIntervalMs: 1000,
    });
  });

  // A. 10 → close 3 → remaining 7
  it("A: partial close 3 out of 10 leaves remaining open position of 7", async () => {
    const pos = await tradingEngine.openPosition(USER_A, {
      instrument: "BTC/USD",
      side: "BUY",
      quantity: 10,
    });

    priceStore.setPrice("BTC/USD", {
      instrument: "BTC/USD",
      price: 81000,
      timestamp: new Date().toISOString(),
      source: "coinbase",
      sourceSymbol: "BTC-USD",
      isProxy: false,
      status: "LIVE",
      expectedUpdateIntervalMs: 1000,
    });

    const result = await tradingEngine.closePosition(USER_A, pos.id, 3);
    expect(result.quantity).toBe(7);
    expect(result.status).toBe("OPEN");

    const allPositions = positionStore.getByUser(USER_A);
    expect(allPositions.length).toBe(2);

    const closed = allPositions.find((p) => p.status === "CLOSED");
    expect(closed).toBeDefined();
    expect(closed?.quantity).toBe(3);
    expect(closed?.realizedPnl).toBe((81000 - 80000) * 3); // 3000
  });

  // B. 10 → close 10 → fully CLOSED
  it("B: closing 10 out of 10 fully closes the position", async () => {
    const pos = await tradingEngine.openPosition(USER_A, {
      instrument: "BTC/USD",
      side: "BUY",
      quantity: 10,
    });

    const result = await tradingEngine.closePosition(USER_A, pos.id, 10);
    expect(result.status).toBe("CLOSED");
    expect(result.quantity).toBe(10);
  });

  // C. 10 → close 11 → rejected
  it("C: partial close quantity > open quantity is rejected", async () => {
    const pos = await tradingEngine.openPosition(USER_A, {
      instrument: "BTC/USD",
      side: "BUY",
      quantity: 10,
    });

    await expect(tradingEngine.closePosition(USER_A, pos.id, 11)).rejects.toThrow(
      "Partial close quantity (11) cannot exceed open position quantity (10)"
    );
  });

  // D. 10 → close 0 → rejected
  it("D: partial close quantity <= 0 is rejected", async () => {
    const pos = await tradingEngine.openPosition(USER_A, {
      instrument: "BTC/USD",
      side: "BUY",
      quantity: 10,
    });

    await expect(tradingEngine.closePosition(USER_A, pos.id, 0)).rejects.toThrow(
      "Partial close quantity must be greater than 0"
    );
  });

  // E. unauthorized user → rejected
  it("E: partial close from unauthorized user is rejected", async () => {
    const pos = await tradingEngine.openPosition(USER_A, {
      instrument: "BTC/USD",
      side: "BUY",
      quantity: 10,
    });

    await expect(tradingEngine.closePosition(USER_B, pos.id, 3)).rejects.toThrow(
      "Position does not belong to the authenticated user"
    );
  });

  // F. already closed position → rejected
  it("F: partial close on already closed position is rejected", async () => {
    const pos = await tradingEngine.openPosition(USER_A, {
      instrument: "BTC/USD",
      side: "BUY",
      quantity: 10,
    });

    await tradingEngine.closePosition(USER_A, pos.id, 10);
    await expect(tradingEngine.closePosition(USER_A, pos.id, 2)).rejects.toThrow(
      "Position is already closed or closing."
    );
  });

  // G. SL/TP remains on remaining 7
  it("G: SL/TP parameters remain attached to remaining quantity after partial close", async () => {
    const pos = await tradingEngine.openPosition(USER_A, {
      instrument: "BTC/USD",
      side: "BUY",
      quantity: 10,
      stopLoss: 78000,
      takeProfit: 85000,
    });

    const result = await tradingEngine.closePosition(USER_A, pos.id, 3);
    expect(result.quantity).toBe(7);
    expect(result.stopLoss).toBe(78000);
    expect(result.takeProfit).toBe(85000);
  });

  // H. P/L correct for partial quantity
  it("H: P/L is calculated correctly for partial closed portion", async () => {
    const pos = await tradingEngine.openPosition(USER_A, {
      instrument: "BTC/USD",
      side: "BUY",
      quantity: 10,
    });

    priceStore.setPrice("BTC/USD", {
      instrument: "BTC/USD",
      price: 82000,
      timestamp: new Date().toISOString(),
      source: "coinbase",
      sourceSymbol: "BTC-USD",
      isProxy: false,
      status: "LIVE",
      expectedUpdateIntervalMs: 1000,
    });

    await tradingEngine.closePosition(USER_A, pos.id, 4);

    const closed = positionStore.getByUser(USER_A).find((p) => p.status === "CLOSED");
    expect(closed?.realizedPnl).toBe((82000 - 80000) * 4); // 8000
  });

  // I. repeated request does not double-close
  it("I: repeated partial close request operates on updated remaining quantity", async () => {
    const pos = await tradingEngine.openPosition(USER_A, {
      instrument: "BTC/USD",
      side: "BUY",
      quantity: 10,
    });

    const r1 = await tradingEngine.closePosition(USER_A, pos.id, 3);
    expect(r1.quantity).toBe(7);

    const r2 = await tradingEngine.closePosition(USER_A, pos.id, 3);
    expect(r2.quantity).toBe(4);

    await expect(tradingEngine.closePosition(USER_A, pos.id, 5)).rejects.toThrow(
      "Partial close quantity (5) cannot exceed open position quantity (4)"
    );
  });

  // J. restart preserves remaining quantity
  it("J: remaining OPEN quantity is preserved in positionStore", async () => {
    const pos = await tradingEngine.openPosition(USER_A, {
      instrument: "BTC/USD",
      side: "BUY",
      quantity: 10,
    });

    await tradingEngine.closePosition(USER_A, pos.id, 4);

    const openPositions = positionStore.getAllOpen();
    expect(openPositions.length).toBe(1);
    expect(openPositions[0].quantity).toBe(6);
    expect(openPositions[0].entryPrice).toBe(80000);
  });
});
