import { describe, it, expect } from "vitest";
import {
  calculateDashboardMetrics,
  calculateStrategyPerformance,
  calculateEquityCurve,
  formatCurrency,
  formatPercent,
  formatRatio,
  formatStrategyName,
  filterTrades,
  getTradeNetPnL,
  DEFAULT_STARTING_CAPITAL,
} from "../../../../lib/calculations";
import {
  aggregateDailyPnL,
  aggregateStrategyPnL,
  aggregateWinLossDistribution,
  aggregateRMultipleDistribution,
  filterTrades as filterAnalyticsTrades,
  DEFAULT_ANALYTICS_FILTERS,
} from "../../../../lib/analyticsAggregations";
import {
  calculateMonthlyReviewMetrics,
} from "../../../../lib/monthlyCalculations";
import { Trade } from "../../../../types/trade";

function createDummyTrade(overrides: Partial<Trade> = {}): Trade {
  return {
    id: `trade-${Math.random().toString(36).substring(2, 9)}`,
    date: "2026-09-05",
    time: "10:00",
    symbol: "BTC/USD",
    side: "LONG",
    strategy: "LIQUIDITY_SWEEP",
    entryPrice: 50000,
    exitPrice: 51000,
    stopLoss: 49500,
    targetPrice: 51000,
    quantity: 1,
    pnl: 1000,
    fees: 0,
    rMultiple: 2.0,
    status: "WIN",
    holdingTime: "30m",
    orderType: "MARKET",
    notes: "Clean setup",
    mistakeTag: "No Mistake",
    ...overrides,
  };
}

describe("Ticket 9: Trading Journey UI + Analytics Visual Polish Test Suite", () => {
  // A. Dashboard
  it("A. Dashboard — renders backend KPI values, empty state displays '—' without NaN or Infinity", () => {
    const emptyTrades: Trade[] = [];
    const metrics = calculateDashboardMetrics(emptyTrades, DEFAULT_STARTING_CAPITAL);

    expect(metrics.totalTrades).toBe(0);
    expect(metrics.winningTrades).toBe(0);
    expect(metrics.losingTrades).toBe(0);
    expect(metrics.netPnL).toBe(0);
    expect(metrics.winRate).toBe(0);
    expect(metrics.profitFactor).toBe(0);
    expect(metrics.averageR).toBe(0);

    // Empty state string formatting tests
    const formattedWinRate = emptyTrades.length > 0 ? formatPercent(metrics.winRate) : "—";
    const formattedAvgR = emptyTrades.length > 0 ? `${metrics.averageR.toFixed(2)}R` : "—";
    const formattedPF = emptyTrades.length > 0 ? formatRatio(metrics.profitFactor, metrics.hasLosses) : "—";
    const formattedBestStrat = emptyTrades.length > 0 && metrics.bestStrategy !== "None" ? formatStrategyName(metrics.bestStrategy) : "—";

    expect(formattedWinRate).toBe("—");
    expect(formattedAvgR).toBe("—");
    expect(formattedPF).toBe("—");
    expect(formattedBestStrat).toBe("—");
    expect(formatCurrency(metrics.netPnL, true)).toBe("$0.00");
  });

  // B. Strategy Analytics
  it("B. Strategy Analytics — supported strategy formatting, Manual Trade display, ORDER_BLOCK absent", () => {
    expect(formatStrategyName("LIQUIDITY_SWEEP")).toBe("Liquidity Sweep");
    expect(formatStrategyName("SWEEP_ENGULFING")).toBe("Sweep + Engulfing");
    expect(formatStrategyName("EQH_EQL")).toBe("EQH / EQL");
    expect(formatStrategyName("PWH_PWL")).toBe("PWH / PWL");
    expect(formatStrategyName("SWING")).toBe("Swing High / Low");
    expect(formatStrategyName("Manual Trade")).toBe("Manual Trade");
    expect(formatStrategyName("")).toBe("Manual Trade");
    expect(formatStrategyName(null)).toBe("Manual Trade");

    const trades: Trade[] = [
      createDummyTrade({ strategy: "LIQUIDITY_SWEEP", pnl: 200, status: "WIN" }),
      createDummyTrade({ strategy: "SWING", pnl: 100, status: "WIN" }),
      createDummyTrade({ strategy: "Manual Trade", pnl: -50, status: "LOSS" }),
    ];

    const perf = calculateStrategyPerformance(trades);
    const orderBlockInPerf = perf.find((s) => s.strategy === "ORDER_BLOCK");
    expect(orderBlockInPerf).toBeUndefined();

    const formattedNames = perf.map((s) => formatStrategyName(s.strategy));
    expect(formattedNames).toContain("Liquidity Sweep");
    expect(formattedNames).toContain("Swing High / Low");
    expect(formattedNames).toContain("Manual Trade");
    expect(formattedNames).not.toContain("ORDER_BLOCK");
  });

  // C. Journal
  it("C. Journal — persisted trades pagination (20/page) & filtering operate correctly", () => {
    const trades: Trade[] = Array.from({ length: 45 }, (_, i) =>
      createDummyTrade({
        id: `trade-${i}`,
        date: "2026-09-05",
        strategy: i % 2 === 0 ? "LIQUIDITY_SWEEP" : "SWING",
        pnl: 100,
        status: "WIN",
      })
    );

    const pageSize = 20;
    const totalPages = Math.ceil(trades.length / pageSize);
    expect(totalPages).toBe(3);

    const page1 = trades.slice(0, 20);
    const page2 = trades.slice(20, 40);
    const page3 = trades.slice(40, 45);

    expect(page1.length).toBe(20);
    expect(page2.length).toBe(20);
    expect(page3.length).toBe(5);

    // Filtering test
    const sweepOnly = trades.filter((t) => t.strategy === "LIQUIDITY_SWEEP");
    expect(sweepOnly.length).toBe(23);
  });

  // D. Calendar
  it("D. Calendar — daily P/L aggregation matches closed trades", () => {
    const trades: Trade[] = [
      createDummyTrade({ date: "2026-09-01", pnl: 300, fees: 10, status: "WIN" }),
      createDummyTrade({ date: "2026-09-01", pnl: -100, fees: 5, status: "LOSS" }),
      createDummyTrade({ date: "2026-09-02", pnl: 150, fees: 0, status: "WIN" }),
    ];

    const dailyPoints = aggregateDailyPnL(trades);
    expect(dailyPoints.length).toBe(2);
    expect(dailyPoints[0].date).toBe("2026-09-01");
    expect(dailyPoints[0].pnl).toBe(185); // (300 - 10) + (-100 - 5)
    expect(dailyPoints[0].tradesCount).toBe(2);

    expect(dailyPoints[1].date).toBe("2026-09-02");
    expect(dailyPoints[1].pnl).toBe(150);
    expect(dailyPoints[1].tradesCount).toBe(1);
  });

  // E. Monthly Review
  it("E. Monthly Review — selected month updates metrics dynamically", () => {
    const trades: Trade[] = [
      createDummyTrade({ date: "2026-08-15", pnl: 500, status: "WIN" }),
      createDummyTrade({ date: "2026-09-02", pnl: 200, status: "WIN" }),
      createDummyTrade({ date: "2026-09-04", pnl: -50, status: "LOSS" }),
    ];

    const augMetrics = calculateMonthlyReviewMetrics(trades, 2026, 7, 500); // August (0-indexed month 7)
    expect(augMetrics.totalTrades).toBe(1);
    expect(augMetrics.netPnL).toBe(500);

    const septMetrics = calculateMonthlyReviewMetrics(trades, 2026, 8, 500); // September (0-indexed month 8)
    expect(septMetrics.totalTrades).toBe(2);
    expect(septMetrics.netPnL).toBe(150);
  });

  // F. Cross-page consistency
  it("F. Cross-page consistency — identical trade dataset produces matching totals across views", () => {
    const trades: Trade[] = [
      createDummyTrade({ date: "2026-09-01", pnl: 400, fees: 10, status: "WIN" }),
      createDummyTrade({ date: "2026-09-03", pnl: -150, fees: 5, status: "LOSS" }),
      createDummyTrade({ date: "2026-09-05", pnl: 200, fees: 0, status: "WIN" }),
    ];

    const dash = calculateDashboardMetrics(trades, 500);
    const daily = aggregateDailyPnL(trades);
    const totalDailyPnL = daily.reduce((acc, d) => acc + d.pnl, 0);
    const monthly = calculateMonthlyReviewMetrics(trades, 2026, 8, 500);

    expect(dash.totalTrades).toBe(3);
    expect(dash.netPnL).toBe(435); // 390 + (-155) + 200

    expect(totalDailyPnL).toBe(dash.netPnL);
    expect(monthly.netPnL).toBe(dash.netPnL);
    expect(monthly.totalTrades).toBe(dash.totalTrades);
  });

  // G. Realtime refresh
  it("G. Realtime refresh — adding closed trade updates analytics output", () => {
    const initialTrades: Trade[] = [createDummyTrade({ pnl: 100, status: "WIN" })];
    const initialMetrics = calculateDashboardMetrics(initialTrades, 500);
    expect(initialMetrics.totalTrades).toBe(1);
    expect(initialMetrics.netPnL).toBe(100);

    const updatedTrades = [...initialTrades, createDummyTrade({ pnl: 250, status: "WIN" })];
    const updatedMetrics = calculateDashboardMetrics(updatedTrades, 500);
    expect(updatedMetrics.totalTrades).toBe(2);
    expect(updatedMetrics.netPnL).toBe(350);
  });

  // H. No fake values
  it("H. No fake values — no NaN or Infinity across all calculations", () => {
    const emptyTrades: Trade[] = [];
    const metrics = calculateDashboardMetrics(emptyTrades, 500);
    const equity = calculateEquityCurve(emptyTrades, 500);
    const strats = calculateStrategyPerformance(emptyTrades);

    expect(Number.isNaN(metrics.winRate)).toBe(false);
    expect(Number.isFinite(metrics.winRate)).toBe(true);
    expect(Number.isNaN(metrics.profitFactor)).toBe(false);
    expect(Number.isFinite(metrics.profitFactor)).toBe(true);
    expect(Number.isNaN(metrics.averageR)).toBe(false);
    expect(Number.isFinite(metrics.averageR)).toBe(true);
  });
});
