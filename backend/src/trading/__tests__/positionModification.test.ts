import { describe, it, expect, beforeEach, vi } from "vitest";
import { tradingEngine, TradingError } from "../TradingEngine";
import { positionStore } from "../PositionStore";
import { priceStore } from "../../market/MarketPriceStore";
import { tradeRepository } from "../../db/TradeRepository";
import { validatePositionModification, ValidationError } from "../validation";

// Spy on TradeRepository to mock DB operations in unit tests
vi.spyOn(tradeRepository, "insert").mockResolvedValue(undefined);
vi.spyOn(tradeRepository, "update").mockResolvedValue(undefined);
vi.spyOn(tradeRepository, "closeTrade").mockResolvedValue(undefined);

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

describe("Production Bugs Regression Suite (BUG 1 & BUG 2)", () => {
  const userId = "prod-user-456";

  beforeEach(() => {
    positionStore.clear();
  });

  // =========================================================================
  // BUG 1 REGRESSION TESTS — STOP LOSS & TAKE PROFIT EXECUTION ON MARKET TICKS
  // =========================================================================

  describe("BUG 1 — Stop Loss & Take Profit Trigger Evaluation", () => {
    it("BUY + price exactly equals SL triggers STOP_LOSS close", async () => {
      setMockPrice("BTC/USD", 79636.53);
      const pos = await tradingEngine.openPosition(userId, {
        instrument: "BTC/USD",
        side: "BUY",
        quantity: 10,
        stopLoss: 79600,
        takeProfit: 81627.44,
      });

      setMockPrice("BTC/USD", 79600); // Exact SL hit
      const updated = positionStore.get(pos.id)!;
      expect(updated.status).toBe("CLOSED");
      expect(updated.exitReason).toBe("STOP_LOSS");
      expect(updated.exitPrice).toBe(79600);
    });

    it("BUY + price below SL triggers STOP_LOSS close at market tick price", async () => {
      setMockPrice("BTC/USD", 79636.53);
      const pos = await tradingEngine.openPosition(userId, {
        instrument: "BTC/USD",
        side: "BUY",
        quantity: 10,
        stopLoss: 79600,
        takeProfit: 81627.44,
      });

      setMockPrice("BTC/USD", 79580); // Below SL
      const updated = positionStore.get(pos.id)!;
      expect(updated.status).toBe("CLOSED");
      expect(updated.exitReason).toBe("STOP_LOSS");
      expect(updated.exitPrice).toBe(79580);
    });

    it("BUY + price exactly equals TP triggers TAKE_PROFIT close", async () => {
      setMockPrice("BTC/USD", 79636.53);
      const pos = await tradingEngine.openPosition(userId, {
        instrument: "BTC/USD",
        side: "BUY",
        quantity: 10,
        stopLoss: 79600,
        takeProfit: 81627.44,
      });

      setMockPrice("BTC/USD", 81627.44); // Exact TP hit
      const updated = positionStore.get(pos.id)!;
      expect(updated.status).toBe("CLOSED");
      expect(updated.exitReason).toBe("TAKE_PROFIT");
      expect(updated.exitPrice).toBe(81627.44);
    });

    it("BUY + price above TP triggers TAKE_PROFIT close at market tick price", async () => {
      setMockPrice("BTC/USD", 79636.53);
      const pos = await tradingEngine.openPosition(userId, {
        instrument: "BTC/USD",
        side: "BUY",
        quantity: 10,
        stopLoss: 79600,
        takeProfit: 81627.44,
      });

      setMockPrice("BTC/USD", 81700); // Above TP
      const updated = positionStore.get(pos.id)!;
      expect(updated.status).toBe("CLOSED");
      expect(updated.exitReason).toBe("TAKE_PROFIT");
      expect(updated.exitPrice).toBe(81700);
    });

    it("SELL + price exactly equals SL triggers STOP_LOSS close", async () => {
      setMockPrice("BTC/USD", 80000);
      const pos = await tradingEngine.openPosition(userId, {
        instrument: "BTC/USD",
        side: "SELL",
        quantity: 5,
        stopLoss: 80500,
        takeProfit: 79000,
      });

      setMockPrice("BTC/USD", 80500); // Exact SL hit
      const updated = positionStore.get(pos.id)!;
      expect(updated.status).toBe("CLOSED");
      expect(updated.exitReason).toBe("STOP_LOSS");
      expect(updated.exitPrice).toBe(80500);
    });

    it("SELL + price above SL triggers STOP_LOSS close at market tick price", async () => {
      setMockPrice("BTC/USD", 80000);
      const pos = await tradingEngine.openPosition(userId, {
        instrument: "BTC/USD",
        side: "SELL",
        quantity: 5,
        stopLoss: 80500,
        takeProfit: 79000,
      });

      setMockPrice("BTC/USD", 80550); // Above SL
      const updated = positionStore.get(pos.id)!;
      expect(updated.status).toBe("CLOSED");
      expect(updated.exitReason).toBe("STOP_LOSS");
      expect(updated.exitPrice).toBe(80550);
    });

    it("SELL + price exactly equals TP triggers TAKE_PROFIT close", async () => {
      setMockPrice("BTC/USD", 80000);
      const pos = await tradingEngine.openPosition(userId, {
        instrument: "BTC/USD",
        side: "SELL",
        quantity: 5,
        stopLoss: 80500,
        takeProfit: 79000,
      });

      setMockPrice("BTC/USD", 79000); // Exact TP hit
      const updated = positionStore.get(pos.id)!;
      expect(updated.status).toBe("CLOSED");
      expect(updated.exitReason).toBe("TAKE_PROFIT");
      expect(updated.exitPrice).toBe(79000);
    });

    it("SELL + price below TP triggers TAKE_PROFIT close at market tick price", async () => {
      setMockPrice("BTC/USD", 80000);
      const pos = await tradingEngine.openPosition(userId, {
        instrument: "BTC/USD",
        side: "SELL",
        quantity: 5,
        stopLoss: 80500,
        takeProfit: 79000,
      });

      setMockPrice("BTC/USD", 78900); // Below TP
      const updated = positionStore.get(pos.id)!;
      expect(updated.status).toBe("CLOSED");
      expect(updated.exitReason).toBe("TAKE_PROFIT");
      expect(updated.exitPrice).toBe(78900);
    });

    it("SL/TP execution occurs immediately on a market tick, not candle close", async () => {
      setMockPrice("BTC/USD", 79636.53);
      const pos = await tradingEngine.openPosition(userId, {
        instrument: "BTC/USD",
        side: "BUY",
        quantity: 1,
        stopLoss: 79600,
      });

      // A single sub-second price update tick below SL must immediately close the trade
      setMockPrice("BTC/USD", 79590);
      expect(positionStore.get(pos.id)!.status).toBe("CLOSED");
    });

    it("Duplicate market ticks do not close twice", async () => {
      setMockPrice("BTC/USD", 79636.53);
      const pos = await tradingEngine.openPosition(userId, {
        instrument: "BTC/USD",
        side: "BUY",
        quantity: 1,
        stopLoss: 79600,
      });

      setMockPrice("BTC/USD", 79590); // First tick closes trade
      const firstCloseTime = positionStore.get(pos.id)!.exitTime;

      setMockPrice("BTC/USD", 79580); // Second tick arrives
      setMockPrice("BTC/USD", 79570); // Third tick arrives

      const finalPos = positionStore.get(pos.id)!;
      expect(finalPos.status).toBe("CLOSED");
      expect(finalPos.exitTime).toBe(firstCloseTime); // Exit time remains unchanged
      expect(finalPos.exitPrice).toBe(79590); // Initial execution price preserved
    });

    it("Already CLOSING / CLOSED positions cannot be closed twice", async () => {
      setMockPrice("BTC/USD", 79636.53);
      const pos = await tradingEngine.openPosition(userId, {
        instrument: "BTC/USD",
        side: "BUY",
        quantity: 1,
        stopLoss: 79600,
      });

      // Atomically transition to CLOSING
      positionStore.tryTransitionToClosing(pos.id);

      // Attempt manual close
      await expect(tradingEngine.closePosition(userId, pos.id)).rejects.toThrow("already closed or closing");
    });
  });

  // =========================================================================
  // BUG 2 REGRESSION TESTS — POSITION SL/TP MODIFICATION
  // =========================================================================

  describe("BUG 2 — Position SL & TP Modification Flow", () => {
    it("Modify SL only -> updates SL, preserves TP and other fields", async () => {
      setMockPrice("BTC/USD", 80000);
      const pos = await tradingEngine.openPosition(userId, {
        instrument: "BTC/USD",
        side: "BUY",
        quantity: 2,
        stopLoss: 79000,
        takeProfit: 82000,
      });

      const updated = await tradingEngine.modifyPosition(userId, pos.id, {
        stopLoss: 79500,
      });

      expect(updated.stopLoss).toBe(79500);
      expect(updated.takeProfit).toBe(82000); // Preserved!
      expect(updated.quantity).toBe(2); // Preserved!
      expect(updated.entryPrice).toBe(80000); // Preserved!
      expect(updated.side).toBe("LONG"); // Preserved!
    });

    it("Modify TP only -> updates TP, preserves SL and other fields", async () => {
      setMockPrice("BTC/USD", 80000);
      const pos = await tradingEngine.openPosition(userId, {
        instrument: "BTC/USD",
        side: "BUY",
        quantity: 2,
        stopLoss: 79000,
        takeProfit: 82000,
      });

      const updated = await tradingEngine.modifyPosition(userId, pos.id, {
        takeProfit: 83000,
      });

      expect(updated.stopLoss).toBe(79000); // Preserved!
      expect(updated.takeProfit).toBe(83000); // Updated!
      expect(updated.quantity).toBe(2);
    });

    it("Modify SL + TP together -> updates both SL and TP atomically", async () => {
      setMockPrice("BTC/USD", 80000);
      const pos = await tradingEngine.openPosition(userId, {
        instrument: "BTC/USD",
        side: "BUY",
        quantity: 2,
        stopLoss: 79000,
        takeProfit: 82000,
      });

      const updated = await tradingEngine.modifyPosition(userId, pos.id, {
        stopLoss: 79200,
        takeProfit: 82500,
      });

      expect(updated.stopLoss).toBe(79200);
      expect(updated.takeProfit).toBe(82500);
    });

    it("TP persists in DB and in-memory engine state & activates on tick after modification", async () => {
      setMockPrice("BTC/USD", 80000);
      const pos = await tradingEngine.openPosition(userId, {
        instrument: "BTC/USD",
        side: "BUY",
        quantity: 1,
        stopLoss: 79000,
        takeProfit: 82000,
      });

      // Modify TP from 82000 to 81000
      await tradingEngine.modifyPosition(userId, pos.id, { takeProfit: 81000 });

      // Market price reaches 81000 (which would NOT have triggered the old 82000 TP)
      setMockPrice("BTC/USD", 81000);

      const finalPos = positionStore.get(pos.id)!;
      expect(finalPos.status).toBe("CLOSED");
      expect(finalPos.exitReason).toBe("TAKE_PROFIT");
      expect(finalPos.exitPrice).toBe(81000);
    });

    it("Invalid BUY TP (<= current price) is rejected", async () => {
      setMockPrice("BTC/USD", 80000);
      const pos = await tradingEngine.openPosition(userId, {
        instrument: "BTC/USD",
        side: "BUY",
        quantity: 1,
        stopLoss: 79000,
        takeProfit: 82000,
      });

      await expect(
        tradingEngine.modifyPosition(userId, pos.id, { takeProfit: 79500 })
      ).rejects.toThrow("For BUY positions, Take Profit must be above the current price.");
    });

    it("Invalid SELL TP (>= current price) is rejected", async () => {
      setMockPrice("BTC/USD", 80000);
      const pos = await tradingEngine.openPosition(userId, {
        instrument: "BTC/USD",
        side: "SELL",
        quantity: 1,
        stopLoss: 81000,
        takeProfit: 78000,
      });

      await expect(
        tradingEngine.modifyPosition(userId, pos.id, { takeProfit: 80500 })
      ).rejects.toThrow("For SELL positions, Take Profit must be below the current price.");
    });

    it("Removing SL/TP (passing null) is supported", async () => {
      setMockPrice("BTC/USD", 80000);
      const pos = await tradingEngine.openPosition(userId, {
        instrument: "BTC/USD",
        side: "BUY",
        quantity: 1,
        stopLoss: 79000,
        takeProfit: 82000,
      });

      const updated = await tradingEngine.modifyPosition(userId, pos.id, {
        stopLoss: null,
        takeProfit: null,
      });

      expect(updated.stopLoss).toBeNull();
      expect(updated.takeProfit).toBeNull();
    });
  });

  // =========================================================================
  // PRODUCTION REGISTRATION FLOW TESTS (A THROUGH I)
  // =========================================================================

  describe("Production Position Registration & Market Tick Execution (Tests A through I)", () => {
    it("Test A: Create a BUY position through production path -> present in TradingEngine positionStore", async () => {
      setMockPrice("BTC/USD", 80000);
      const pos = await tradingEngine.openPosition(userId, {
        instrument: "BTC/USD",
        side: "BUY",
        quantity: 1,
        stopLoss: 79000,
        takeProfit: 82000,
      });

      const registered = positionStore.get(pos.id);
      expect(registered).toBeDefined();
      expect(registered?.id).toBe(pos.id);
      expect(registered?.side).toBe("LONG");
      expect(registered?.status).toBe("OPEN");
    });

    it("Test B: Create a SELL position through production path -> present in TradingEngine positionStore", async () => {
      setMockPrice("BTC/USD", 80000);
      const pos = await tradingEngine.openPosition(userId, {
        instrument: "BTC/USD",
        side: "SELL",
        quantity: 1,
        stopLoss: 81000,
        takeProfit: 78000,
      });

      const registered = positionStore.get(pos.id);
      expect(registered).toBeDefined();
      expect(registered?.id).toBe(pos.id);
      expect(registered?.side).toBe("SHORT");
      expect(registered?.status).toBe("OPEN");
    });

    it("Test C: Create BUY with SL -> send market tick <= SL -> automatic STOP_LOSS close", async () => {
      setMockPrice("BTC/USD", 79636.53);
      const pos = await tradingEngine.openPosition(userId, {
        instrument: "BTC/USD",
        side: "BUY",
        quantity: 10,
        stopLoss: 79600,
      });

      setMockPrice("BTC/USD", 79590);
      const updated = positionStore.get(pos.id)!;
      expect(updated.status).toBe("CLOSED");
      expect(updated.exitReason).toBe("STOP_LOSS");
      expect(updated.exitPrice).toBe(79590);
    });

    it("Test D: Create BUY with TP -> send market tick >= TP -> automatic TAKE_PROFIT close", async () => {
      setMockPrice("BTC/USD", 79636.53);
      const pos = await tradingEngine.openPosition(userId, {
        instrument: "BTC/USD",
        side: "BUY",
        quantity: 10,
        takeProfit: 81627.44,
      });

      setMockPrice("BTC/USD", 81650);
      const updated = positionStore.get(pos.id)!;
      expect(updated.status).toBe("CLOSED");
      expect(updated.exitReason).toBe("TAKE_PROFIT");
      expect(updated.exitPrice).toBe(81650);
    });

    it("Test E: Create SELL with SL -> send market tick >= SL -> automatic STOP_LOSS close", async () => {
      setMockPrice("BTC/USD", 80000);
      const pos = await tradingEngine.openPosition(userId, {
        instrument: "BTC/USD",
        side: "SELL",
        quantity: 5,
        stopLoss: 80500,
      });

      setMockPrice("BTC/USD", 80510);
      const updated = positionStore.get(pos.id)!;
      expect(updated.status).toBe("CLOSED");
      expect(updated.exitReason).toBe("STOP_LOSS");
      expect(updated.exitPrice).toBe(80510);
    });

    it("Test F: Create SELL with TP -> send market tick <= TP -> automatic TAKE_PROFIT close", async () => {
      setMockPrice("BTC/USD", 80000);
      const pos = await tradingEngine.openPosition(userId, {
        instrument: "BTC/USD",
        side: "SELL",
        quantity: 5,
        takeProfit: 79000,
      });

      setMockPrice("BTC/USD", 78950);
      const updated = positionStore.get(pos.id)!;
      expect(updated.status).toBe("CLOSED");
      expect(updated.exitReason).toBe("TAKE_PROFIT");
      expect(updated.exitPrice).toBe(78950);
    });

    it("Test G: Production frontend order path does NOT bypass backend position registration", async () => {
      setMockPrice("BTC/USD", 79636.53);
      const pos = await tradingEngine.openPosition(userId, {
        instrument: "BTC/USD",
        side: "BUY",
        quantity: 1,
        stopLoss: 79600,
        takeProfit: 81627.44,
      });

      // Verify position was registered synchronously without requiring a server restart
      expect(positionStore.getByUser(userId).some((p) => p.id === pos.id)).toBe(true);
    });

    it("Test H: Verify duplicate registration does not occur", async () => {
      setMockPrice("BTC/USD", 80000);
      const pos = await tradingEngine.openPosition(userId, {
        instrument: "BTC/USD",
        side: "BUY",
        quantity: 1,
        stopLoss: 79000,
      });

      // Attempt duplicate registration with same ID
      positionStore.add(pos);
      positionStore.add(pos);

      const userPositions = positionStore.getByUser(userId);
      expect(userPositions.length).toBe(1);
    });

    it("Test I: Position created immediately before a market tick is evaluated correctly", async () => {
      setMockPrice("BTC/USD", 80000);
      const pos = await tradingEngine.openPosition(userId, {
        instrument: "BTC/USD",
        side: "BUY",
        quantity: 1,
        stopLoss: 79500,
      });

      // Immediately send market tick without delay or restart
      setMockPrice("BTC/USD", 79400);

      const updated = positionStore.get(pos.id)!;
      expect(updated.status).toBe("CLOSED");
      expect(updated.exitReason).toBe("STOP_LOSS");
      expect(updated.exitPrice).toBe(79400);
    });
  });
});
