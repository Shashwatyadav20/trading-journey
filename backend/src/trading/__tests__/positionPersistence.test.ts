import { describe, it, expect, beforeEach, vi } from "vitest";
import { tradingEngine, TradingError } from "../TradingEngine";
import { positionStore } from "../PositionStore";
import { pendingOrderStore } from "../PendingOrderStore";
import { priceStore } from "../../market/MarketPriceStore";
import { TradeRepository, tradeRepository, TradeRow } from "../../db/TradeRepository";
import { Position } from "../types";

// In-memory store simulating the Supabase trades table for verification
let dbTrades: TradeRow[] = [];
let insertCount = 0;
let updateCount = 0;

// Spy on TradeRepository methods
vi.spyOn(tradeRepository, "insert").mockImplementation(async (userId: string, position: Position) => {
  if (position.userId !== userId) {
    throw new Error("Cannot insert trade for a different user.");
  }
  insertCount++;
  const row = TradeRepository.mapToRow(position) as TradeRow;
  dbTrades.push(row);
});

vi.spyOn(tradeRepository, "update").mockImplementation(async (userId: string, position: Position) => {
  if (position.userId !== userId) {
    throw new Error("Cannot update trade for a different user.");
  }
  updateCount++;
  const index = dbTrades.findIndex((t) => t.id === position.id && t.user_id === userId);
  if (index >= 0) {
    const row = TradeRepository.mapToRow(position) as TradeRow;
    dbTrades[index] = { ...dbTrades[index], ...row };
  } else {
    throw new Error("Trade not found in DB.");
  }
});

vi.spyOn(tradeRepository, "closeTrade").mockImplementation(async (userId: string, position: Position) => {
  return tradeRepository.update(userId, position);
});

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

describe("Step 3C-3: Position Persistence & TradeRepository Integration", () => {
  const USER_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  const USER_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

  beforeEach(() => {
    positionStore.clear();
    pendingOrderStore.clear();
    dbTrades = [];
    insertCount = 0;
    updateCount = 0;
    setMockPrice("BTC/USD", 50000);
  });

  // 1. Market BUY creates exactly one database trade.
  it("1. Market BUY creates exactly one database trade", async () => {
    await tradingEngine.openPosition(USER_A, { instrument: "BTC/USD", side: "BUY", quantity: 1 });
    expect(insertCount).toBe(1);
    expect(dbTrades.length).toBe(1);
  });

  // 2. Market SELL creates exactly one database trade.
  it("2. Market SELL creates exactly one database trade", async () => {
    await tradingEngine.openPosition(USER_A, { instrument: "BTC/USD", side: "SELL", quantity: 1 });
    expect(insertCount).toBe(1);
    expect(dbTrades.length).toBe(1);
  });

  // 3. Correct entry price is persisted.
  it("3. Correct entry price is persisted", async () => {
    setMockPrice("BTC/USD", 52345.50);
    await tradingEngine.openPosition(USER_A, { instrument: "BTC/USD", side: "BUY", quantity: 1 });
    expect(dbTrades[0].entry_price).toBe(52345.50);
  });

  // 4. Correct quantity is persisted.
  it("4. Correct quantity is persisted", async () => {
    await tradingEngine.openPosition(USER_A, { instrument: "BTC/USD", side: "BUY", quantity: 2.5 });
    expect(dbTrades[0].quantity).toBe(2.5);
  });

  // 5. Correct side is persisted.
  it("5. Correct side is persisted", async () => {
    await tradingEngine.openPosition(USER_A, { instrument: "BTC/USD", side: "BUY", quantity: 1 });
    expect(dbTrades[0].side).toBe("LONG");

    await tradingEngine.openPosition(USER_A, { instrument: "BTC/USD", side: "SELL", quantity: 1 });
    expect(dbTrades[1].side).toBe("SHORT");
  });

  // 6. Correct symbol is persisted.
  it("6. Correct symbol is persisted", async () => {
    setMockPrice("XAU/USD", 2000);
    await tradingEngine.openPosition(USER_A, { instrument: "XAU/USD", side: "BUY", quantity: 10 });
    expect(dbTrades[0].symbol).toBe("XAU/USD");
  });

  // 7. Correct strategy is persisted.
  it("7. Correct strategy is persisted", async () => {
    await tradingEngine.openPosition(USER_A, {
      instrument: "BTC/USD",
      side: "BUY",
      quantity: 1,
      strategy: "Liquidity Sweep",
    });
    expect(dbTrades[0].strategy).toBe("Liquidity Sweep");
  });

  // 8. New position starts with DB status OPEN.
  it("8. New position starts with DB status OPEN", async () => {
    await tradingEngine.openPosition(USER_A, { instrument: "BTC/USD", side: "BUY", quantity: 1 });
    expect(dbTrades[0].status).toBe("OPEN");
    expect(dbTrades[0].exit_price).toBeNull();
    expect(dbTrades[0].pnl).toBeNull();
  });

  // 9. Manual close updates the existing trade.
  it("9. Manual close updates the existing trade", async () => {
    const pos = await tradingEngine.openPosition(USER_A, { instrument: "BTC/USD", side: "BUY", quantity: 1 });
    expect(dbTrades.length).toBe(1);
    setMockPrice("BTC/USD", 55000);
    await tradingEngine.closePosition(USER_A, pos.id);

    expect(insertCount).toBe(1);
    expect(updateCount).toBe(1);
    expect(dbTrades.length).toBe(1); // Not duplicated
    expect(dbTrades[0].status).toBe("WIN");
    expect(dbTrades[0].exit_price).toBe(55000);
  });

  // 10. Stop Loss updates the existing trade.
  it("10. Stop Loss updates the existing trade", async () => {
    const pos = await tradingEngine.openPosition(USER_A, {
      instrument: "BTC/USD",
      side: "BUY",
      quantity: 1,
      stopLoss: 49000,
    });
    expect(dbTrades.length).toBe(1);

    setMockPrice("BTC/USD", 48500); // Triggers SL
    expect(dbTrades.length).toBe(1);
    expect(dbTrades[0].status).toBe("LOSS");
    expect(dbTrades[0].exit_price).toBe(48500);
  });

  // 11. Take Profit updates the existing trade.
  it("11. Take Profit updates the existing trade", async () => {
    const pos = await tradingEngine.openPosition(USER_A, {
      instrument: "BTC/USD",
      side: "BUY",
      quantity: 1,
      takeProfit: 52000,
    });
    expect(dbTrades.length).toBe(1);

    setMockPrice("BTC/USD", 53000); // Triggers TP
    expect(dbTrades.length).toBe(1);
    expect(dbTrades[0].status).toBe("WIN");
    expect(dbTrades[0].exit_price).toBe(53000);
  });

  // 12. Positive realized P/L → WIN.
  it("12. Positive realized P/L -> WIN", async () => {
    const pos = await tradingEngine.openPosition(USER_A, { instrument: "BTC/USD", side: "BUY", quantity: 1 });
    setMockPrice("BTC/USD", 51000);
    await tradingEngine.closePosition(USER_A, pos.id);
    expect(dbTrades[0].pnl).toBe(1000);
    expect(dbTrades[0].status).toBe("WIN");
  });

  // 13. Negative realized P/L → LOSS.
  it("13. Negative realized P/L -> LOSS", async () => {
    const pos = await tradingEngine.openPosition(USER_A, { instrument: "BTC/USD", side: "BUY", quantity: 1 });
    setMockPrice("BTC/USD", 49000);
    await tradingEngine.closePosition(USER_A, pos.id);
    expect(dbTrades[0].pnl).toBe(-1000);
    expect(dbTrades[0].status).toBe("LOSS");
  });

  // 14. Zero realized P/L → BREAKEVEN.
  it("14. Zero realized P/L -> BREAKEVEN", async () => {
    const pos = await tradingEngine.openPosition(USER_A, { instrument: "BTC/USD", side: "BUY", quantity: 1 });
    setMockPrice("BTC/USD", 50000); // Exit price = Entry price
    await tradingEngine.closePosition(USER_A, pos.id);
    expect(dbTrades[0].pnl).toBe(0);
    expect(dbTrades[0].status).toBe("BREAKEVEN");
  });

  // 15. CLOSING is never persisted.
  it("15. CLOSING is never persisted", () => {
    const pos: Position = {
      id: "pos-closing",
      userId: USER_A,
      instrument: "BTC/USD",
      side: "LONG",
      quantity: 1,
      entryPrice: 50000,
      entryTime: new Date().toISOString(),
      status: "CLOSING",
      unrealizedPnl: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const row = TradeRepository.mapToRow(pos);
    expect(row.status).toBe("OPEN");
    expect(row.status).not.toBe("CLOSING");
  });

  // 16. Correct exit price is persisted.
  it("16. Correct exit price is persisted", async () => {
    const pos = await tradingEngine.openPosition(USER_A, { instrument: "BTC/USD", side: "SELL", quantity: 1 });
    setMockPrice("BTC/USD", 47500);
    await tradingEngine.closePosition(USER_A, pos.id);
    expect(dbTrades[0].exit_price).toBe(47500);
  });

  // 17. Correct holding time is persisted.
  it("17. Correct holding time is persisted", async () => {
    const entryTime = new Date("2026-09-04T12:00:00.000Z").toISOString();
    const exitTime = new Date("2026-09-04T12:25:30.000Z").toISOString();

    const closedPos: Position = {
      id: "pos-time",
      userId: USER_A,
      instrument: "BTC/USD",
      side: "LONG",
      quantity: 1,
      entryPrice: 50000,
      entryTime,
      exitPrice: 51000,
      exitTime,
      realizedPnl: 1000,
      status: "CLOSED",
      unrealizedPnl: 0,
      createdAt: entryTime,
      updatedAt: exitTime,
    };

    const row = TradeRepository.mapToRow(closedPos);
    expect(row.holding_time).toBe("25m 30s");
  });

  // 18. Correct R multiple is persisted.
  it("18. Correct R multiple is persisted", async () => {
    const closedPos: Position = {
      id: "pos-rmult",
      userId: USER_A,
      instrument: "BTC/USD",
      side: "LONG",
      quantity: 1,
      entryPrice: 50000,
      entryTime: new Date().toISOString(),
      stopLoss: 49000, // Risk = 1000
      takeProfit: 53000,
      exitPrice: 53000, // Reward = 3000
      exitTime: new Date().toISOString(),
      realizedPnl: 3000,
      status: "CLOSED",
      unrealizedPnl: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const row = TradeRepository.mapToRow(closedPos);
    expect(row.r_multiple).toBe(3.00);
  });

  // 19. Fees are not hardcoded to $5.
  it("19. Fees are not hardcoded to $5", async () => {
    const pos = await tradingEngine.openPosition(USER_A, { instrument: "BTC/USD", side: "BUY", quantity: 1 });
    setMockPrice("BTC/USD", 51000);
    await tradingEngine.closePosition(USER_A, pos.id);
    expect(dbTrades[0].fees).toBe(0);
  });

  // 20. LONG P/L is correct.
  it("20. LONG P/L is correct: (exitPrice - entryPrice) * quantity", async () => {
    const pos = await tradingEngine.openPosition(USER_A, { instrument: "BTC/USD", side: "BUY", quantity: 2 });
    setMockPrice("BTC/USD", 55000); // (55000 - 50000) * 2 = 10000
    await tradingEngine.closePosition(USER_A, pos.id);
    expect(dbTrades[0].pnl).toBe(10000);
  });

  // 21. SHORT P/L is correct.
  it("21. SHORT P/L is correct: (entryPrice - exitPrice) * quantity", async () => {
    const pos = await tradingEngine.openPosition(USER_A, { instrument: "BTC/USD", side: "SELL", quantity: 2 });
    setMockPrice("BTC/USD", 45000); // (50000 - 45000) * 2 = 10000
    await tradingEngine.closePosition(USER_A, pos.id);
    expect(dbTrades[0].pnl).toBe(10000);
  });

  // 22. Repository failure is handled safely.
  it("22. Repository failure is handled safely when openPosition fails DB insert", async () => {
    vi.spyOn(tradeRepository, "insert").mockRejectedValueOnce(new Error("DB connection timeout"));

    await expect(
      tradingEngine.openPosition(USER_A, { instrument: "BTC/USD", side: "BUY", quantity: 1 })
    ).rejects.toThrow("Failed to persist trade to database");

    // Position was NOT stored in memory
    expect(positionStore.getByUser(USER_A).length).toBe(0);
  });

  // 23. User A cannot update User B's trade.
  it("23. User A cannot update User B's trade", async () => {
    const pos = await tradingEngine.openPosition(USER_B, { instrument: "BTC/USD", side: "BUY", quantity: 1 });

    await expect(tradingEngine.closePosition(USER_A, pos.id)).rejects.toThrow("does not belong");
  });

  // 24. A trade is not duplicated during close.
  it("24. A trade is not duplicated during close", async () => {
    const pos = await tradingEngine.openPosition(USER_A, { instrument: "BTC/USD", side: "BUY", quantity: 1 });
    expect(dbTrades.length).toBe(1);

    await tradingEngine.closePosition(USER_A, pos.id);
    expect(dbTrades.length).toBe(1);
    expect(dbTrades[0].id).toBe(pos.id);
  });

  // 25. Existing atomic close protection remains functional.
  it("25. Existing atomic close protection prevents double close", async () => {
    const pos = await tradingEngine.openPosition(USER_A, { instrument: "BTC/USD", side: "BUY", quantity: 1 });
    await tradingEngine.closePosition(USER_A, pos.id);

    await expect(tradingEngine.closePosition(USER_A, pos.id)).rejects.toThrow("already closed or closing");
  });
});
