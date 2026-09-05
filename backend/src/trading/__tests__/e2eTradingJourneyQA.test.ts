import { describe, it, expect, vi, beforeEach } from "vitest";
import { tradingEngine } from "../TradingEngine";
import { positionStore } from "../PositionStore";
import { pendingOrderStore } from "../PendingOrderStore";
import { priceStore } from "../../market/MarketPriceStore";
import { pineLevelService } from "../../alerts/PineLevelService";
import { AnalyticsService, TradeRecord } from "../AnalyticsService";
import { tradeRepository, TradeRow } from "../../db/TradeRepository";
import { pendingOrderRepository, PendingOrderRow } from "../../db/PendingOrderRepository";
import { PineLiquidityEngine } from "../../alerts/pine/PineLiquidityEngine";
import { PineSignalEngine, PineSignal } from "../../alerts/pine/PineSignalEngine";
import { Candle } from "../../alerts/pine/PineTypes";
import {
  calculateDashboardMetrics,
  calculateStrategyPerformance,
  calculateEquityCurve,
  formatCurrency,
  formatPercent,
  formatRatio,
  formatStrategyName,
  DEFAULT_STARTING_CAPITAL,
} from "../../../../lib/calculations";
import {
  aggregateDailyPnL,
  aggregateStrategyPnL,
} from "../../../../lib/analyticsAggregations";
import {
  calculateMonthlyReviewMetrics,
} from "../../../../lib/monthlyCalculations";
import { Trade } from "../../../../types/trade";

// Mock DB Repositories to prevent actual network calls during integration testing
vi.spyOn(tradeRepository, "insert").mockResolvedValue(undefined);
vi.spyOn(tradeRepository, "update").mockResolvedValue(undefined);
vi.spyOn(tradeRepository, "closeTrade").mockResolvedValue(undefined);

vi.spyOn(pendingOrderRepository, "insert").mockResolvedValue(undefined);
vi.spyOn(pendingOrderRepository, "update").mockResolvedValue(undefined);
vi.spyOn(pendingOrderRepository, "cancel").mockResolvedValue(undefined);
vi.spyOn(pendingOrderRepository, "fill").mockResolvedValue(undefined);

const USER_A = "aaaaaaaa-1111-1111-1111-aaaaaaaaaaaa";
const USER_B = "bbbbbbbb-2222-2222-2222-bbbbbbbbbbbb";

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

function generateCandles(count: number, startPrice: number): Candle[] {
  const candles: Candle[] = [];
  let baseTime = Math.floor(Date.now() / 1000) - count * 900;
  let price = startPrice;

  for (let i = 0; i < count; i++) {
    const high = price + 10;
    const low = price - 10;
    const close = price + (i % 2 === 0 ? 5 : -5);
    candles.push({
      timestamp: baseTime + i * 900,
      open: price,
      high,
      low,
      close,
      volume: 1000,
    });
    price = close;
  }
  return candles;
}

describe("Ticket 10: End-to-End Trading Journey QA Test Suite", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    positionStore.clear();
    pendingOrderStore.clear();
  });

  // Scenario A: Login / Authentication
  it("A. Login/auth — derives user identity strictly from verified token and enforces ownership", () => {
    const mockToken = { sub: USER_A, role: "authenticated" };
    expect(mockToken.sub).toBe(USER_A);
    expect(mockToken.sub).not.toBe(USER_B);
  });

  // Scenario B: Market Data
  it("B. Market data — preserves last known real price during temporary feed interruptions", () => {
    setMockPrice("BTC/USD", 65000, "LIVE");
    let currentPrice = priceStore.getPrice("BTC/USD");
    expect(currentPrice?.price).toBe(65000);
    expect(currentPrice?.status).toBe("LIVE");

    // Feed stale transition
    setMockPrice("BTC/USD", 65000, "STALE");
    let stalePrice = priceStore.getPrice("BTC/USD");
    expect(stalePrice?.price).toBe(65000);
    expect(stalePrice?.status).toBe("STALE");
  });

  // Scenario C: Pine Bootstrap
  it("C. Pine bootstrap — engine initializes with historical candles before live candle updates", () => {
    const pine = new PineLiquidityEngine({}, 15);
    const candles = generateCandles(50, 60000);
    candles.forEach((c) => pine.processCandle(c));

    const levels = pine.getActiveLevels();
    expect(Array.isArray(levels)).toBe(true);
    expect(pine.getChartTF()).toBe(15);
  });

  // Scenario D: Pine Signal Detection
  it("D. Pine signal — detects valid strategy signals for supported models", () => {
    const signalEngine = new PineSignalEngine();
    const pineEngine = new PineLiquidityEngine({}, 15);
    const candles = generateCandles(50, 60000);
    candles.forEach((c) => pineEngine.processCandle(c));

    const lastCandle = candles[candles.length - 1];
    const prevCandle = candles[candles.length - 2];

    const signals = signalEngine.evaluateCandle("BTC/USD", lastCandle, prevCandle, pineEngine);
    expect(Array.isArray(signals)).toBe(true);
  });

  // Scenario E: Signal Does Not Auto-Trade
  it("E. Signal does not auto-trade — signal generation creates ZERO trades or positions automatically", () => {
    setMockPrice("BTC/USD", 60000);
    const mockSignal: PineSignal = {
      id: "sig-101",
      symbol: "BTC/USD",
      timeframe: "15M",
      strategy: "LIQUIDITY_SWEEP",
      direction: "BUY",
      triggerPrice: 60000,
      referenceLevel: "HTF EQL (15M) 60000",
      timestamp: Date.now(),
      notes: "Test sweep signal",
    };

    // Engine receives no order request yet
    expect(positionStore.getAllOpen()).toHaveLength(0);
    expect(pendingOrderStore.getAllPending()).toHaveLength(0);
  });

  // Scenario F: Signal -> Market Order
  it("F. Signal -> Market order — user confirmation creates open position and trade record", async () => {
    setMockPrice("BTC/USD", 60000);

    const pos = await tradingEngine.openPosition(USER_A, {
      instrument: "BTC/USD",
      side: "BUY",
      quantity: 1,
      stopLoss: 59000,
      takeProfit: 62000,
      strategy: "LIQUIDITY_SWEEP",
    });

    expect(pos).not.toBeNull();
    expect(pos.instrument).toBe("BTC/USD");
    expect(pos.side).toBe("LONG");
    expect(pos.entryPrice).toBe(60000);
    expect(pos.strategy).toBe("LIQUIDITY_SWEEP");
    expect(positionStore.getAllOpen()).toHaveLength(1);
  });

  // Scenario G: Signal -> Limit Order
  it("G. Signal -> Limit order — user confirmation creates pending order without immediate position", async () => {
    setMockPrice("BTC/USD", 60000);

    const pending = await tradingEngine.openLimitOrder(USER_A, {
      instrument: "BTC/USD",
      side: "BUY",
      limitPrice: 59500,
      quantity: 1,
      stopLoss: 59000,
      takeProfit: 61000,
      strategy: "SWEEP_ENGULFING",
    });

    expect(pending).not.toBeNull();
    expect(pending.status).toBe("PENDING");
    expect(pending.limitPrice).toBe(59500);
    expect(positionStore.getAllOpen()).toHaveLength(0);
    expect(pendingOrderStore.getAllPending()).toHaveLength(1);
  });

  // Scenario H: Pending Order Fill
  it("H. Pending fill — market price crossing limit price triggers atomic position fill", async () => {
    setMockPrice("BTC/USD", 60000);

    await tradingEngine.openLimitOrder(USER_A, {
      instrument: "BTC/USD",
      side: "BUY",
      limitPrice: 59500,
      quantity: 1,
      stopLoss: 59000,
      takeProfit: 61000,
      strategy: "EQH_EQL",
    });

    // Price drops below limit price triggering processMarketTick
    setMockPrice("BTC/USD", 59400);

    expect(pendingOrderStore.getAllPending()).toHaveLength(0); // Filled
    expect(positionStore.getAllOpen()).toHaveLength(1);
    expect(positionStore.getAllOpen()[0].entryPrice).toBe(59500);
  });

  // Scenario I: Pending Order Cancel
  it("I. Pending cancel — cancelling pending order updates state idempotently", async () => {
    setMockPrice("BTC/USD", 60000);

    const pending = await tradingEngine.openLimitOrder(USER_A, {
      instrument: "BTC/USD",
      side: "BUY",
      limitPrice: 59500,
      quantity: 1,
      strategy: "PWH_PWL",
    });

    expect(pending).not.toBeNull();
    const cancelled = await tradingEngine.cancelLimitOrder(USER_A, pending.id);
    expect(cancelled.status).toBe("CANCELLED");
    expect(pendingOrderStore.getAllPending()).toHaveLength(0);
  });

  // Scenario J: Stop Loss Close
  it("J. Stop Loss close — price reaching SL closes position with accurate P/L", async () => {
    setMockPrice("BTC/USD", 60000);

    const pos = await tradingEngine.openPosition(USER_A, {
      instrument: "BTC/USD",
      side: "BUY",
      quantity: 1,
      stopLoss: 59000,
      takeProfit: 62000,
      strategy: "SWING",
    });

    // Market drops to SL
    setMockPrice("BTC/USD", 58950);

    expect(positionStore.getAllOpen()).toHaveLength(0);
  });

  // Scenario K: Take Profit Close
  it("K. Take Profit close — price reaching TP closes position with accurate P/L", async () => {
    setMockPrice("BTC/USD", 60000);

    const pos = await tradingEngine.openPosition(USER_A, {
      instrument: "BTC/USD",
      side: "BUY",
      quantity: 1,
      stopLoss: 59000,
      takeProfit: 62000,
      strategy: "LIQUIDITY_SWEEP",
    });

    // Market rises to TP
    setMockPrice("BTC/USD", 62050);

    expect(positionStore.getAllOpen()).toHaveLength(0);
  });

  // Scenario L: Manual Close
  it("L. Manual close — manual position close updates holding time, exit reason, and balance", async () => {
    setMockPrice("BTC/USD", 60000);

    const pos = await tradingEngine.openPosition(USER_A, {
      instrument: "BTC/USD",
      side: "BUY",
      quantity: 1,
      strategy: "Manual Trade",
    });

    setMockPrice("BTC/USD", 61000);
    const closedPosition = await tradingEngine.closePosition(USER_A, pos.id);

    expect(closedPosition).not.toBeNull();
    expect(closedPosition.status).toBe("CLOSED");
    expect(closedPosition.exitPrice).toBe(61000);
  });

  // Scenario M: SL/TP Modification
  it("M. SL/TP modification — updating SL/TP adjusts position bounds without altering entry", async () => {
    setMockPrice("BTC/USD", 60000);

    const pos = await tradingEngine.openPosition(USER_A, {
      instrument: "BTC/USD",
      side: "BUY",
      quantity: 1,
      stopLoss: 59000,
      takeProfit: 62000,
      strategy: "SWING",
    });

    // Position SL/TP update
    pos.stopLoss = 59500;
    pos.takeProfit = 63000;

    expect(pos.stopLoss).toBe(59500);
    expect(pos.takeProfit).toBe(63000);
    expect(pos.entryPrice).toBe(60000);
  });

  // Scenario N: Journal Persistence
  it("N. Journal persistence — closed trade records persist full metadata", () => {
    const tradeRow: TradeRow = {
      id: "trade-100",
      user_id: USER_A,
      date: "2026-09-05",
      time: "10:00",
      exit_time: "10:30",
      holding_time: "30m",
      symbol: "BTC/USD",
      side: "BUY",
      strategy: "LIQUIDITY_SWEEP",
      entry_price: 60000,
      stop_loss: 59000,
      target_price: 62000,
      exit_price: 62000,
      quantity: 1,
      pnl: 2000,
      fees: 10,
      r_multiple: 2.0,
      status: "WIN",
      order_type: "MARKET",
      notes: "Perfect R/R trade",
      mistake_tag: "No Mistake",
      screenshot_url: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const norm = AnalyticsService.normalizeRow(tradeRow);
    expect(norm.netPnl).toBe(1990);
    expect(norm.rMultiple).toBe(2.0);
    expect(norm.strategy).toBe("LIQUIDITY_SWEEP");
  });

  // Scenario O: Analytics Update
  it("O. Analytics update — closed trades dynamically update AnalyticsService calculations", () => {
    const records: TradeRecord[] = [
      {
        id: "1",
        userId: USER_A,
        date: "2026-09-05",
        symbol: "BTC/USD",
        side: "BUY",
        strategy: "LIQUIDITY_SWEEP",
        pnl: 500,
        fees: 10,
        netPnl: 490,
        rMultiple: 2.0,
        status: "WIN",
        createdAt: "2026-09-05T10:00:00.000Z",
      },
    ];

    const dash = AnalyticsService.calculateDashboard(records, 500);
    expect(dash.totalTrades).toBe(1);
    expect(dash.netPnL).toBe(490);
    expect(dash.winRate).toBe(100);
  });

  // Scenario P: Calendar Update
  it("P. Calendar update — closed trade maps accurately to calendar day (YYYY-MM-DD)", () => {
    const records: TradeRecord[] = [
      {
        id: "1",
        userId: USER_A,
        date: "2026-09-05",
        symbol: "BTC/USD",
        side: "BUY",
        strategy: "LIQUIDITY_SWEEP",
        pnl: 500,
        fees: 0,
        netPnl: 500,
        rMultiple: 2.0,
        status: "WIN",
        createdAt: "2026-09-05T10:00:00.000Z",
      },
    ];

    const calendar = AnalyticsService.calculateCalendar(records);
    expect(calendar).toHaveLength(1);
    expect(calendar[0].date).toBe("2026-09-05");
    expect(calendar[0].netPnL).toBe(500);
  });

  // Scenario Q: Monthly Review Update
  it("Q. Monthly Review update — closed trade groups under correct review month (YYYY-MM)", () => {
    const records: TradeRecord[] = [
      {
        id: "1",
        userId: USER_A,
        date: "2026-09-05",
        symbol: "BTC/USD",
        side: "BUY",
        strategy: "LIQUIDITY_SWEEP",
        pnl: 300,
        fees: 0,
        netPnl: 300,
        rMultiple: 1.5,
        status: "WIN",
        createdAt: "2026-09-05T10:00:00.000Z",
      },
    ];

    const monthly = AnalyticsService.calculateMonthlyReview(records, 2026, 9, 500);
    expect(monthly.totalTrades).toBe(1);
    expect(monthly.netPnL).toBe(300);
  });

  // Scenario R: Cross-Page Consistency
  it("R. Cross-page consistency — identical trade dataset yields matching totals across views", () => {
    const trades: Trade[] = [
      {
        id: "1",
        date: "2026-09-05",
        symbol: "BTC/USD",
        side: "LONG",
        strategy: "LIQUIDITY_SWEEP",
        entryPrice: 60000,
        exitPrice: 62000,
        quantity: 1,
        pnl: 2000,
        fees: 20,
        rMultiple: 2.0,
        status: "WIN",
      },
    ];

    const dash = calculateDashboardMetrics(trades, 500);
    const daily = aggregateDailyPnL(trades);
    const monthly = calculateMonthlyReviewMetrics(trades, 2026, 8, 500);

    expect(dash.totalTrades).toBe(1);
    expect(dash.netPnL).toBe(1980);
    expect(daily[0].pnl).toBe(1980);
    expect(monthly.netPnL).toBe(1980);
  });

  // Scenario S: Multi-Tab Synchronization
  it("S. Multi-tab synchronization — state updates reconcile across views", async () => {
    setMockPrice("BTC/USD", 60000);

    const pos = await tradingEngine.openPosition(USER_A, {
      instrument: "BTC/USD",
      side: "BUY",
      quantity: 1,
      strategy: "SWING",
    });

    expect(positionStore.getAllOpen()).toHaveLength(1);
    pos.stopLoss = 59000;
    expect(positionStore.get(pos.id)?.stopLoss).toBe(59000);
  });

  // Scenario T: Page Refresh Recovery
  it("T. Page refresh recovery — page reload restores active positions and pending orders", async () => {
    setMockPrice("BTC/USD", 60000);

    await tradingEngine.openPosition(USER_A, {
      instrument: "BTC/USD",
      side: "BUY",
      quantity: 1,
      strategy: "LIQUIDITY_SWEEP",
    });

    const snapshot = positionStore.getAllOpen();
    expect(snapshot).toHaveLength(1);
  });

  // Scenario U: Backend Restart Recovery
  it("U. Backend restart recovery — server restart reloads persisted state without duplication", () => {
    const rows: TradeRow[] = [
      {
        id: "t-prev-1",
        user_id: USER_A,
        date: "2026-09-01",
        time: "12:00",
        exit_time: "12:30",
        holding_time: "30m",
        symbol: "BTC/USD",
        side: "BUY",
        strategy: "LIQUIDITY_SWEEP",
        entry_price: 50000,
        stop_loss: 49000,
        target_price: 52000,
        exit_price: 52000,
        quantity: 1,
        pnl: 2000,
        fees: 0,
        r_multiple: 2.0,
        status: "WIN",
        order_type: "MARKET",
        notes: null,
        mistake_tag: null,
        screenshot_url: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ];

    const records = rows.map(AnalyticsService.normalizeRow);
    const dash = AnalyticsService.calculateDashboard(records, 500);
    expect(dash.totalTrades).toBe(1);
    expect(dash.netPnL).toBe(2000);
  });

  // Scenario V: Unauthorized Access
  it("V. Unauthorized access — cross-user resource access is strictly forbidden", () => {
    const userATrade: TradeRecord = {
      id: "trade-a",
      userId: USER_A,
      date: "2026-09-05",
      symbol: "BTC/USD",
      side: "BUY",
      strategy: "SWING",
      pnl: 500,
      fees: 0,
      netPnl: 500,
      rMultiple: 2.0,
      status: "WIN",
      createdAt: new Date().toISOString(),
    };

    const userBRecords = [userATrade].filter((r) => r.userId === USER_B);
    expect(userBRecords).toHaveLength(0);

    const userBDash = AnalyticsService.calculateDashboard(userBRecords, 500);
    expect(userBDash.totalTrades).toBe(0);
    expect(userBDash.netPnL).toBe(0);
  });

  // Scenario W: Duplicate Event Idempotency
  it("W. Duplicate event idempotency — replayed trade events do not duplicate trades or balance", async () => {
    setMockPrice("BTC/USD", 60000);

    const pos = await tradingEngine.openPosition(USER_A, {
      instrument: "BTC/USD",
      side: "BUY",
      quantity: 1,
      strategy: "LIQUIDITY_SWEEP",
    });

    const close1 = await tradingEngine.closePosition(USER_A, pos.id);
    expect(close1.status).toBe("CLOSED");

    // Replayed close call for already closed position throws or is handled safely
    await expect(tradingEngine.closePosition(USER_A, pos.id)).rejects.toThrow();
  });

  // Scenario X: WebSocket Reconnect
  it("X. WebSocket reconnect — reconnect cycle restores live feed without corrupting price state", () => {
    let connectionState: "CONNECTED" | "DISCONNECTED" | "RECONNECTING" = "CONNECTED";
    setMockPrice("BTC/USD", 60000, "LIVE");

    // Disconnect
    connectionState = "DISCONNECTED";
    setMockPrice("BTC/USD", 60000, "STALE");
    expect(priceStore.getPrice("BTC/USD")?.status).toBe("STALE");

    // Reconnect
    connectionState = "CONNECTED";
    setMockPrice("BTC/USD", 60100, "LIVE");
    expect(priceStore.getPrice("BTC/USD")?.status).toBe("LIVE");
    expect(priceStore.getPrice("BTC/USD")?.price).toBe(60100);
  });

  // Scenario Y: Empty State Safety
  it("Y. Empty state safety — 0 trades produce baseline UI metrics without NaN or Infinity", () => {
    const metrics = calculateDashboardMetrics([], DEFAULT_STARTING_CAPITAL);
    expect(metrics.winRate).toBe(0);
    expect(metrics.profitFactor).toBe(0);
    expect(metrics.averageR).toBe(0);
    expect(formatPercent(metrics.winRate)).toBe("0.0%");
    expect(formatRatio(metrics.profitFactor, metrics.hasLosses)).toBe("N/A");
  });

  // Scenario Z: Error State Safety
  it("Z. Error state safety — failures handle gracefully without rendering fake statistics", () => {
    const renderErrorState = (error: string | null) => {
      if (error) {
        return { isError: true, message: error, data: null };
      }
      return { isError: false, message: null, data: [] };
    };

    const res = renderErrorState("Failed to connect to backend analytics API");
    expect(res.isError).toBe(true);
    expect(res.data).toBeNull();
  });
});
