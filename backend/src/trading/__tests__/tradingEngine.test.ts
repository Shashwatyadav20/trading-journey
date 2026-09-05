import { describe, it, expect, beforeEach, vi } from "vitest";
import { tradingEngine } from "../TradingEngine";
import { positionStore } from "../PositionStore";
import { pendingOrderStore } from "../PendingOrderStore";
import { priceStore } from "../../market/MarketPriceStore";
import { tradingEventBus } from "../../websocket/trading";
import { validateMarketOrder, validateLimitOrder } from "../validation";

import { tradeRepository } from "../../db/TradeRepository";
import { pendingOrderRepository } from "../../db/PendingOrderRepository";

// Spy on TradeRepository and PendingOrderRepository so DB operations don't attempt live network calls in unit tests
vi.spyOn(tradeRepository, "insert").mockResolvedValue(undefined);
vi.spyOn(tradeRepository, "update").mockResolvedValue(undefined);
vi.spyOn(tradeRepository, "closeTrade").mockResolvedValue(undefined);

vi.spyOn(pendingOrderRepository, "insert").mockResolvedValue(undefined);
vi.spyOn(pendingOrderRepository, "update").mockResolvedValue(undefined);
vi.spyOn(pendingOrderRepository, "cancel").mockResolvedValue(undefined);
vi.spyOn(pendingOrderRepository, "fill").mockResolvedValue(undefined);
vi.spyOn(pendingOrderRepository, "atomicFillAndCreateTrade").mockResolvedValue(true);

// Helper to mock the current price
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

describe("Trading Engine Core (Step 3A & 3B)", () => {
  const userId = "test-user-123";

  beforeEach(() => {
    positionStore.clear();
    pendingOrderStore.clear();
  });

  describe("Validation (3A)", () => {
    it("6. Zero quantity rejected", () => {
      expect(() => validateMarketOrder({ instrument: "BTC/USD", side: "BUY", quantity: 0 }, 50000)).toThrow();
    });

    it("7. Negative quantity rejected", () => {
      expect(() => validateMarketOrder({ instrument: "BTC/USD", side: "BUY", quantity: -1 }, 50000)).toThrow();
    });

    it("8. Invalid quantity rejected", () => {
      expect(() => validateMarketOrder({ instrument: "BTC/USD", side: "BUY", quantity: NaN }, 50000)).toThrow();
    });

    it("9. Unsupported instrument rejected", () => {
      expect(() => validateMarketOrder({ instrument: "ETH/USD", side: "BUY", quantity: 1 }, 50000)).toThrow();
    });
  });

  describe("Market Order Execution (3A)", () => {
    it("1. BUY creates LONG position & 3. BUY uses backend current price", async () => {
      setMockPrice("BTC/USD", 50000);
      const pos = await tradingEngine.openPosition(userId, { instrument: "BTC/USD", side: "BUY", quantity: 1 });
      expect(pos.side).toBe("LONG");
      expect(pos.entryPrice).toBe(50000);
      expect(pos.status).toBe("OPEN");
    });

    it("2. SELL creates SHORT position & 4. SELL uses backend current price", async () => {
      setMockPrice("BTC/USD", 50000);
      const pos = await tradingEngine.openPosition(userId, { instrument: "BTC/USD", side: "SELL", quantity: 1 });
      expect(pos.side).toBe("SHORT");
      expect(pos.entryPrice).toBe(50000);
      expect(pos.status).toBe("OPEN");
    });

    it("10. STALE price rejects new market order", async () => {
      setMockPrice("BTC/USD", 50000, "STALE");
      await expect(tradingEngine.openPosition(userId, { instrument: "BTC/USD", side: "BUY", quantity: 1 })).rejects.toThrow("STALE");
    });

    it("11. OFFLINE price rejects new market order", async () => {
      setMockPrice("BTC/USD", 50000, "OFFLINE");
      await expect(tradingEngine.openPosition(userId, { instrument: "BTC/USD", side: "BUY", quantity: 1 })).rejects.toThrow("OFFLINE");
    });
  });

  describe("Unrealized P/L (3A)", () => {
    it("12. LONG unrealized P/L correct", async () => {
      setMockPrice("BTC/USD", 50000);
      const pos = await tradingEngine.openPosition(userId, { instrument: "BTC/USD", side: "BUY", quantity: 2 });
      
      setMockPrice("BTC/USD", 55000); // Trigger update
      expect(positionStore.get(pos.id)?.unrealizedPnl).toBe(10000);

      setMockPrice("BTC/USD", 40000); // Trigger update
      expect(positionStore.get(pos.id)?.unrealizedPnl).toBe(-20000);
    });

    it("13. SHORT unrealized P/L correct", async () => {
      setMockPrice("BTC/USD", 50000);
      const pos = await tradingEngine.openPosition(userId, { instrument: "BTC/USD", side: "SELL", quantity: 2 });
      
      setMockPrice("BTC/USD", 40000); // Trigger update
      expect(positionStore.get(pos.id)?.unrealizedPnl).toBe(20000);

      setMockPrice("BTC/USD", 55000); // Trigger update
      expect(positionStore.get(pos.id)?.unrealizedPnl).toBe(-10000);
    });

    it("26. Multiple open positions calculate independently", async () => {
      setMockPrice("BTC/USD", 50000);
      setMockPrice("XAU/USD", 2000);
      const pos1 = await tradingEngine.openPosition(userId, { instrument: "BTC/USD", side: "BUY", quantity: 1 });
      const pos2 = await tradingEngine.openPosition(userId, { instrument: "XAU/USD", side: "SELL", quantity: 10 });

      setMockPrice("BTC/USD", 51000);
      setMockPrice("XAU/USD", 1950);

      expect(positionStore.get(pos1.id)?.unrealizedPnl).toBe(1000);
      expect(positionStore.get(pos2.id)?.unrealizedPnl).toBe(500);
    });
  });

  describe("Closing & Realized P/L (3A)", () => {
    it("14. LONG profitable close correct", async () => {
      setMockPrice("BTC/USD", 4443.59);
      const pos = await tradingEngine.openPosition(userId, { instrument: "BTC/USD", side: "BUY", quantity: 0.01 });
      setMockPrice("BTC/USD", 4483.59);
      const closed = await tradingEngine.closePosition(userId, pos.id);
      expect(Math.abs(closed.realizedPnl! - 0.40)).toBeLessThan(0.0001);
      expect(closed.status).toBe("CLOSED");
    });

    it("15. LONG losing close correct", async () => {
      setMockPrice("BTC/USD", 4443.59);
      const pos = await tradingEngine.openPosition(userId, { instrument: "BTC/USD", side: "BUY", quantity: 0.01 });
      setMockPrice("BTC/USD", 4400.00);
      const closed = await tradingEngine.closePosition(userId, pos.id);
      expect(Math.abs(closed.realizedPnl! - -0.4359)).toBeLessThan(0.0001);
    });

    it("16. SHORT profitable close correct", async () => {
      setMockPrice("BTC/USD", 4443.59);
      const pos = await tradingEngine.openPosition(userId, { instrument: "BTC/USD", side: "SELL", quantity: 0.01 });
      setMockPrice("BTC/USD", 4400.00);
      const closed = await tradingEngine.closePosition(userId, pos.id);
      expect(Math.abs(closed.realizedPnl! - 0.4359)).toBeLessThan(0.0001);
    });

    it("17. SHORT losing close correct", async () => {
      setMockPrice("BTC/USD", 4443.59);
      const pos = await tradingEngine.openPosition(userId, { instrument: "BTC/USD", side: "SELL", quantity: 0.01 });
      setMockPrice("BTC/USD", 4483.59);
      const closed = await tradingEngine.closePosition(userId, pos.id);
      expect(Math.abs(closed.realizedPnl! - -0.40)).toBeLessThan(0.0001);
    });

    it("18. Manual close uses backend current price", async () => {
      setMockPrice("BTC/USD", 50000);
      const pos = await tradingEngine.openPosition(userId, { instrument: "BTC/USD", side: "BUY", quantity: 1 });
      setMockPrice("BTC/USD", 51000);
      const closed = await tradingEngine.closePosition(userId, pos.id);
      expect(closed.exitPrice).toBe(51000);
    });

    it("20. Closed position cannot be closed again & 21. Duplicate close protection", async () => {
      setMockPrice("BTC/USD", 50000);
      const pos = await tradingEngine.openPosition(userId, { instrument: "BTC/USD", side: "BUY", quantity: 1 });
      await tradingEngine.closePosition(userId, pos.id);
      await expect(tradingEngine.closePosition(userId, pos.id)).rejects.toThrow("already closed");
    });
  });

  describe("Security & User Isolation (3A/3B)", () => {
    it("25. User isolation prevents closing another user's position", async () => {
      setMockPrice("BTC/USD", 50000);
      const pos = await tradingEngine.openPosition(userId, { instrument: "BTC/USD", side: "BUY", quantity: 1 });
      await expect(tradingEngine.closePosition("another-user", pos.id)).rejects.toThrow("does not belong");
    });
    
    it("28. User isolation prevents cancelling another user's pending order", async () => {
      setMockPrice("BTC/USD", 50000);
      const order = await tradingEngine.openLimitOrder(userId, { instrument: "BTC/USD", side: "BUY", quantity: 1, limitPrice: 40000 });
      await expect(tradingEngine.cancelLimitOrder("another-user", order.id)).rejects.toThrow("does not belong");
    });
  });

  // ==========================================
  // STEP 3B TESTS
  // ==========================================

  describe("SL/TP Evaluation (3B)", () => {
    it("1. LONG SL exact hit", async () => {
      setMockPrice("BTC/USD", 50000);
      const pos = await tradingEngine.openPosition(userId, { instrument: "BTC/USD", side: "BUY", quantity: 1, stopLoss: 49000 });
      setMockPrice("BTC/USD", 49000); // Hit SL exactly
      const updated = positionStore.get(pos.id)!;
      expect(updated.status).toBe("CLOSED");
      expect(updated.exitReason).toBe("STOP_LOSS");
    });

    it("2. LONG SL crossed by price jump", async () => {
      setMockPrice("BTC/USD", 50000);
      const pos = await tradingEngine.openPosition(userId, { instrument: "BTC/USD", side: "BUY", quantity: 1, stopLoss: 49000 });
      setMockPrice("BTC/USD", 48000); // Cross SL
      const updated = positionStore.get(pos.id)!;
      expect(updated.status).toBe("CLOSED");
      expect(updated.exitReason).toBe("STOP_LOSS");
      expect(updated.exitPrice).toBe(48000); // 9. SL uses market price
    });

    it("3. SHORT SL exact hit", async () => {
      setMockPrice("BTC/USD", 50000);
      const pos = await tradingEngine.openPosition(userId, { instrument: "BTC/USD", side: "SELL", quantity: 1, stopLoss: 51000 });
      setMockPrice("BTC/USD", 51000);
      const updated = positionStore.get(pos.id)!;
      expect(updated.status).toBe("CLOSED");
      expect(updated.exitReason).toBe("STOP_LOSS");
    });

    it("4. SHORT SL crossed by price jump", async () => {
      setMockPrice("BTC/USD", 50000);
      const pos = await tradingEngine.openPosition(userId, { instrument: "BTC/USD", side: "SELL", quantity: 1, stopLoss: 51000 });
      setMockPrice("BTC/USD", 52000);
      const updated = positionStore.get(pos.id)!;
      expect(updated.status).toBe("CLOSED");
      expect(updated.exitReason).toBe("STOP_LOSS");
      expect(updated.exitPrice).toBe(52000); // 9. SL uses market price
    });

    it("5. LONG TP exact hit", async () => {
      setMockPrice("BTC/USD", 50000);
      const pos = await tradingEngine.openPosition(userId, { instrument: "BTC/USD", side: "BUY", quantity: 1, takeProfit: 51000 });
      setMockPrice("BTC/USD", 51000);
      const updated = positionStore.get(pos.id)!;
      expect(updated.status).toBe("CLOSED");
      expect(updated.exitReason).toBe("TAKE_PROFIT");
    });

    it("6. LONG TP crossed by price jump", async () => {
      setMockPrice("BTC/USD", 50000);
      const pos = await tradingEngine.openPosition(userId, { instrument: "BTC/USD", side: "BUY", quantity: 1, takeProfit: 51000 });
      setMockPrice("BTC/USD", 52000);
      const updated = positionStore.get(pos.id)!;
      expect(updated.status).toBe("CLOSED");
      expect(updated.exitReason).toBe("TAKE_PROFIT");
      expect(updated.exitPrice).toBe(52000); // 10. TP uses market price
    });

    it("7. SHORT TP exact hit", async () => {
      setMockPrice("BTC/USD", 50000);
      const pos = await tradingEngine.openPosition(userId, { instrument: "BTC/USD", side: "SELL", quantity: 1, takeProfit: 49000 });
      setMockPrice("BTC/USD", 49000);
      const updated = positionStore.get(pos.id)!;
      expect(updated.status).toBe("CLOSED");
      expect(updated.exitReason).toBe("TAKE_PROFIT");
    });

    it("8. SHORT TP crossed by price jump", async () => {
      setMockPrice("BTC/USD", 50000);
      const pos = await tradingEngine.openPosition(userId, { instrument: "BTC/USD", side: "SELL", quantity: 1, takeProfit: 49000 });
      setMockPrice("BTC/USD", 48000);
      const updated = positionStore.get(pos.id)!;
      expect(updated.status).toBe("CLOSED");
      expect(updated.exitReason).toBe("TAKE_PROFIT");
      expect(updated.exitPrice).toBe(48000); // 10. TP uses market price
    });

    it("11. Stale price does not trigger SL/TP", async () => {
      setMockPrice("BTC/USD", 50000);
      const pos = await tradingEngine.openPosition(userId, { instrument: "BTC/USD", side: "BUY", quantity: 1, stopLoss: 49000 });
      setMockPrice("BTC/USD", 48000, "STALE");
      expect(positionStore.get(pos.id)!.status).toBe("OPEN");
    });

    it("12. Offline price does not trigger SL/TP", async () => {
      setMockPrice("BTC/USD", 50000);
      const pos = await tradingEngine.openPosition(userId, { instrument: "BTC/USD", side: "BUY", quantity: 1, stopLoss: 49000 });
      setMockPrice("BTC/USD", 0, "OFFLINE");
      expect(positionStore.get(pos.id)!.status).toBe("OPEN");
    });

    it("13 & 14 & 15. Race condition: manual close vs SL/TP prevents double close", async () => {
      setMockPrice("BTC/USD", 50000);
      const pos = await tradingEngine.openPosition(userId, { instrument: "BTC/USD", side: "BUY", quantity: 1, stopLoss: 49000 });
      
      // We simulate a race by calling `tryTransitionToClosing` manually just before the SL tick
      positionStore.tryTransitionToClosing(pos.id); // e.g. manual close API hit
      
      setMockPrice("BTC/USD", 48000); // Tick arrives, should NOT close again or change reason
      
      const updated = positionStore.get(pos.id)!;
      expect(updated.status).toBe("CLOSING"); // It was blocked from processing SL logic
      expect(updated.exitReason).toBeUndefined(); // Because we didn't finish manual close here
    });

    it("16. Correct exitReason (MANUAL vs STOP_LOSS vs TAKE_PROFIT)", async () => {
      setMockPrice("BTC/USD", 50000);
      const pos = await tradingEngine.openPosition(userId, { instrument: "BTC/USD", side: "BUY", quantity: 1 });
      const closed = await tradingEngine.closePosition(userId, pos.id);
      expect(closed.exitReason).toBe("MANUAL");
    });
  });

  describe("Pending Orders (3B)", () => {
    it("17. BUY LIMIT creation", async () => {
      setMockPrice("BTC/USD", 50000);
      const order = await tradingEngine.openLimitOrder(userId, { instrument: "BTC/USD", side: "BUY", quantity: 1, limitPrice: 49000 });
      expect(order.status).toBe("PENDING");
      expect(order.side).toBe("LONG");
      expect(order.limitPrice).toBe(49000);
    });

    it("18. SELL LIMIT creation", async () => {
      setMockPrice("BTC/USD", 50000);
      const order = await tradingEngine.openLimitOrder(userId, { instrument: "BTC/USD", side: "SELL", quantity: 1, limitPrice: 51000 });
      expect(order.status).toBe("PENDING");
      expect(order.side).toBe("SHORT");
      expect(order.limitPrice).toBe(51000);
    });

    it("19. Invalid BUY LIMIT rejected", () => {
      expect(() => validateLimitOrder({ instrument: "BTC/USD", side: "BUY", quantity: 1, limitPrice: 51000 }, 50000)).toThrow();
    });

    it("20. Invalid SELL LIMIT rejected", () => {
      expect(() => validateLimitOrder({ instrument: "BTC/USD", side: "SELL", quantity: 1, limitPrice: 49000 }, 50000)).toThrow();
    });

    it("21. BUY LIMIT fills when price crosses below & 23. uses limitPrice as entry", async () => {
      setMockPrice("BTC/USD", 50000);
      const order = await tradingEngine.openLimitOrder(userId, { instrument: "BTC/USD", side: "BUY", quantity: 1, limitPrice: 49000 });
      setMockPrice("BTC/USD", 48000); // crosses limit
      
      const filledOrder = pendingOrderStore.get(order.id)!;
      expect(filledOrder.status).toBe("FILLED");
      expect(filledOrder.positionId).toBeDefined();

      const pos = positionStore.get(filledOrder.positionId!)!;
      expect(pos.entryPrice).toBe(49000); // 23. limit price
    });

    it("22. SELL LIMIT fills when price crosses above", async () => {
      setMockPrice("BTC/USD", 50000);
      const order = await tradingEngine.openLimitOrder(userId, { instrument: "BTC/USD", side: "SELL", quantity: 1, limitPrice: 51000 });
      setMockPrice("BTC/USD", 52000); // crosses limit
      
      const filledOrder = pendingOrderStore.get(order.id)!;
      expect(filledOrder.status).toBe("FILLED");
    });

    it("24. Pending order cannot fill twice", async () => {
      setMockPrice("BTC/USD", 50000);
      const order = await tradingEngine.openLimitOrder(userId, { instrument: "BTC/USD", side: "BUY", quantity: 1, limitPrice: 49000 });
      setMockPrice("BTC/USD", 48000); // fills
      setMockPrice("BTC/USD", 47000); // ticks again
      
      // Ensure only 1 position exists
      expect(positionStore.getByUser(userId).length).toBe(1);
    });

    it("25. Pending order cancellation", async () => {
      setMockPrice("BTC/USD", 50000);
      const order = await tradingEngine.openLimitOrder(userId, { instrument: "BTC/USD", side: "BUY", quantity: 1, limitPrice: 49000 });
      await tradingEngine.cancelLimitOrder(userId, order.id);
      expect(pendingOrderStore.get(order.id)!.status).toBe("CANCELLED");
    });

    it("26. Filled order cannot cancel", async () => {
      setMockPrice("BTC/USD", 50000);
      const order = await tradingEngine.openLimitOrder(userId, { instrument: "BTC/USD", side: "BUY", quantity: 1, limitPrice: 49000 });
      setMockPrice("BTC/USD", 48000); // fills
      await expect(tradingEngine.cancelLimitOrder(userId, order.id)).rejects.toThrow("Cannot cancel");
    });

    it("27. Cancelled order cannot cancel again", async () => {
      setMockPrice("BTC/USD", 50000);
      const order = await tradingEngine.openLimitOrder(userId, { instrument: "BTC/USD", side: "BUY", quantity: 1, limitPrice: 49000 });
      await tradingEngine.cancelLimitOrder(userId, order.id);
      await expect(tradingEngine.cancelLimitOrder(userId, order.id)).rejects.toThrow("Cannot cancel");
    });

    it("29. Multiple pending orders on same tick", async () => {
      setMockPrice("BTC/USD", 50000);
      await tradingEngine.openLimitOrder(userId, { instrument: "BTC/USD", side: "BUY", quantity: 1, limitPrice: 49000 });
      await tradingEngine.openLimitOrder(userId, { instrument: "BTC/USD", side: "BUY", quantity: 1, limitPrice: 48000 });
      setMockPrice("BTC/USD", 47000); // both fill
      expect(positionStore.getByUser(userId).length).toBe(2);
    });

    it("30 & 31. Pending order with SL/TP participates in engine after fill", async () => {
      setMockPrice("BTC/USD", 50000);
      await tradingEngine.openLimitOrder(userId, { instrument: "BTC/USD", side: "BUY", quantity: 1, limitPrice: 49000, stopLoss: 48000 });
      
      setMockPrice("BTC/USD", 48500); // Fills
      const posId = pendingOrderStore.getByUser(userId)[0].positionId!;
      expect(positionStore.get(posId)!.status).toBe("OPEN");

      setMockPrice("BTC/USD", 47000); // Hits SL
      expect(positionStore.get(posId)!.status).toBe("CLOSED");
      expect(positionStore.get(posId)!.exitReason).toBe("STOP_LOSS");
    });

    it("32 & 33 & 34. Events emitted exactly once", async () => {
      let pendingFills = 0;
      let posCreated = 0;
      let posClosed = 0;
      
      tradingEventBus.on("pendingOrderFilled", () => pendingFills++);
      tradingEventBus.on("positionCreated", () => posCreated++);
      tradingEventBus.on("positionClosed", () => posClosed++);

      setMockPrice("BTC/USD", 50000);
      await tradingEngine.openLimitOrder(userId, { instrument: "BTC/USD", side: "BUY", quantity: 1, limitPrice: 49000, stopLoss: 48000 });
      
      setMockPrice("BTC/USD", 48500); // Fills -> emits pendingOrderFilled + positionCreated
      expect(pendingFills).toBe(1);
      expect(posCreated).toBe(1);
      
      setMockPrice("BTC/USD", 47000); // SL -> emits positionClosed
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(posClosed).toBe(1);

      tradingEventBus.removeAllListeners();
    });
  });
});
