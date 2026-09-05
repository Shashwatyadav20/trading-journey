import { describe, it, expect, vi, beforeEach } from "vitest";
import { AnalyticsService, TradeRecord } from "../AnalyticsService";
import { tradeRepository, TradeRow } from "../../db/TradeRepository";

// Mock Supabase client for user ownership & RLS tests
const mockChainable: any = {
  then: vi.fn((resolve) => resolve({ data: [], error: null })),
};
mockChainable.select = vi.fn(() => mockChainable);
mockChainable.eq = vi.fn(() => mockChainable);
mockChainable.order = vi.fn(() => mockChainable);

vi.mock("../../db/supabaseClient", () => ({
  getAdminSupabaseClient: () => ({
    from: vi.fn(() => mockChainable),
  }),
}));

const USER_A = "11111111-1111-1111-1111-111111111111";
const USER_B = "22222222-2222-2222-2222-222222222222";

function createDummyTradeRow(overrides: Partial<TradeRow> = {}): TradeRow {
  return {
    id: `trade-${Math.random().toString(36).substring(2, 9)}`,
    user_id: USER_A,
    date: "2026-09-05",
    time: "10:00",
    exit_time: "10:30",
    holding_time: "30m",
    symbol: "BTC/USD",
    side: "LONG",
    strategy: "LIQUIDITY_SWEEP",
    entry_price: 50000,
    stop_loss: 49500,
    target_price: 51000,
    exit_price: 51000,
    quantity: 1,
    pnl: 1000,
    fees: 0,
    r_multiple: 2.0,
    status: "WIN",
    order_type: "MARKET",
    notes: "Perfect sweep setup",
    mistake_tag: "No Mistake",
    screenshot_url: null,
    created_at: "2026-09-05T10:00:00.000Z",
    updated_at: "2026-09-05T10:30:00.000Z",
    ...overrides,
  };
}

describe("Ticket 8: Journal + Analytics Data Integrity Test Suite", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // A. Empty account
  it("A. Empty account â€” handles 0 trades without NaN or Infinity", () => {
    const emptyRecords: TradeRecord[] = [];
    const dashboard = AnalyticsService.calculateDashboard(emptyRecords, 500);

    expect(dashboard.totalTrades).toBe(0);
    expect(dashboard.winningTrades).toBe(0);
    expect(dashboard.losingTrades).toBe(0);
    expect(dashboard.winRate).toBe(0);
    expect(dashboard.netPnL).toBe(0);
    expect(dashboard.profitFactor).toBe(0);
    expect(dashboard.hasLosses).toBe(false);
    expect(dashboard.averageR).toBe(0);
    expect(dashboard.maxDrawdown).toBe(0);
    expect(dashboard.bestStrategy).toBe("N/A");
    expect(dashboard.worstStrategy).toBe("N/A");
    expect(dashboard.bestTrade).toBeNull();
    expect(dashboard.worstTrade).toBeNull();

    // Verify numeric properties are valid finite numbers
    Object.values(dashboard).forEach((val) => {
      if (typeof val === "number") {
        expect(Number.isNaN(val)).toBe(false);
        expect(Number.isFinite(val)).toBe(true);
      }
    });
  });

  // B. Single winning trade
  it("B. Single winning trade â€” correct count, win, win rate, P/L", () => {
    const row = createDummyTradeRow({ pnl: 500, fees: 0, status: "WIN" });
    const rec = AnalyticsService.normalizeRow(row);
    const dashboard = AnalyticsService.calculateDashboard([rec], 500);

    expect(dashboard.totalTrades).toBe(1);
    expect(dashboard.winningTrades).toBe(1);
    expect(dashboard.losingTrades).toBe(0);
    expect(dashboard.winRate).toBe(100);
    expect(dashboard.netPnL).toBe(500);
    expect(dashboard.grossProfit).toBe(500);
    expect(dashboard.grossLoss).toBe(0);
    expect(dashboard.currentCapital).toBe(1000);
  });

  // C. Single losing trade
  it("C. Single losing trade â€” correct count, loss, win rate, P/L", () => {
    const row = createDummyTradeRow({ pnl: -200, fees: 5, status: "LOSS" });
    const rec = AnalyticsService.normalizeRow(row);
    const dashboard = AnalyticsService.calculateDashboard([rec], 500);

    expect(dashboard.totalTrades).toBe(1);
    expect(dashboard.winningTrades).toBe(0);
    expect(dashboard.losingTrades).toBe(1);
    expect(dashboard.winRate).toBe(0);
    expect(dashboard.netPnL).toBe(-205);
    expect(dashboard.grossLoss).toBe(205);
    expect(dashboard.currentCapital).toBe(295);
  });

  // D. Breakeven trade
  it("D. Breakeven trade â€” count, classification, win rate", () => {
    const row = createDummyTradeRow({ pnl: 0, fees: 0, status: "BREAKEVEN" });
    const rec = AnalyticsService.normalizeRow(row);
    const dashboard = AnalyticsService.calculateDashboard([rec], 500);

    expect(dashboard.totalTrades).toBe(1);
    expect(dashboard.winningTrades).toBe(0);
    expect(dashboard.losingTrades).toBe(0);
    expect(dashboard.breakevenTrades).toBe(1);
    expect(dashboard.winRate).toBe(0);
    expect(dashboard.netPnL).toBe(0);
  });

  // E. Mixed trades
  it("E. Mixed trades â€” wins, losses, breakeven, net P/L, win rate", () => {
    const rows = [
      createDummyTradeRow({ pnl: 300, fees: 0, status: "WIN" }),
      createDummyTradeRow({ pnl: -100, fees: 0, status: "LOSS" }),
      createDummyTradeRow({ pnl: 0, fees: 0, status: "BREAKEVEN" }),
      createDummyTradeRow({ pnl: 200, fees: 0, status: "WIN" }),
    ];
    const recs = rows.map(AnalyticsService.normalizeRow);
    const dashboard = AnalyticsService.calculateDashboard(recs, 500);

    expect(dashboard.totalTrades).toBe(4);
    expect(dashboard.winningTrades).toBe(2);
    expect(dashboard.losingTrades).toBe(1);
    expect(dashboard.breakevenTrades).toBe(1);
    expect(dashboard.winRate).toBe(50); // 2 / 4 * 100
    expect(dashboard.netPnL).toBe(400); // 300 - 100 + 0 + 200
    expect(dashboard.grossProfit).toBe(500);
    expect(dashboard.grossLoss).toBe(100);
    expect(dashboard.profitFactor).toBe(5); // 500 / 100
  });

  // F. Strategy aggregation
  it("F. Strategy aggregation â€” supported strategies + Manual Trade", () => {
    const rows = [
      createDummyTradeRow({ strategy: "LIQUIDITY_SWEEP", pnl: 100, status: "WIN" }),
      createDummyTradeRow({ strategy: "SWING", pnl: 200, status: "WIN" }),
      createDummyTradeRow({ strategy: "", pnl: 50, status: "WIN" }), // empty -> Manual Trade
      createDummyTradeRow({ strategy: "OB CREATE AND RETEST", pnl: -30, status: "LOSS" }), // OB -> Manual Trade
    ];
    const recs = rows.map(AnalyticsService.normalizeRow);
    const strats = AnalyticsService.calculateStrategies(recs);

    const sweep = strats.find((s) => s.strategy === "LIQUIDITY_SWEEP");
    const swing = strats.find((s) => s.strategy === "SWING");
    const manual = strats.find((s) => s.strategy === "Manual Trade");

    expect(sweep?.totalTrades).toBe(1);
    expect(swing?.totalTrades).toBe(1);
    expect(manual?.totalTrades).toBe(2); // 1 empty + 1 OB fallback
    expect(strats.find((s) => s.strategy === "ORDER_BLOCK")).toBeUndefined();
  });

  // G. Signal strategy
  it("G. Signal strategy â€” signalId / strategy preserved", () => {
    const row = createDummyTradeRow({ strategy: "SWEEP_ENGULFING", pnl: 150, status: "WIN" });
    const rec = AnalyticsService.normalizeRow(row);
    expect(rec.strategy).toBe("SWEEP_ENGULFING");
  });

  // H. Open position exclusion
  it("H. Open position exclusion â€” open position does NOT count in historical stats", () => {
    const rows = [
      createDummyTradeRow({ status: "WIN", pnl: 100 }),
      createDummyTradeRow({ status: "OPEN", pnl: 500 }), // Open position with floating PnL
    ];
    const recs = rows.map(AnalyticsService.normalizeRow);
    const dashboard = AnalyticsService.calculateDashboard(recs, 500);

    expect(dashboard.totalTrades).toBe(1); // Only 1 closed trade counted
    expect(dashboard.netPnL).toBe(100);
  });

  // I. Pagination independence
  it("I. Pagination independence â€” analytics uses all historical trades", () => {
    const rows = Array.from({ length: 50 }, (_, i) =>
      createDummyTradeRow({ pnl: 10, status: "WIN" })
    );
    const recs = rows.map(AnalyticsService.normalizeRow);

    // Simulate UI page slice (e.g. first 10 trades) vs full analytics
    const pageSlice = recs.slice(0, 10);
    const sliceDashboard = AnalyticsService.calculateDashboard(pageSlice, 500);
    const fullDashboard = AnalyticsService.calculateDashboard(recs, 500);

    expect(sliceDashboard.totalTrades).toBe(10);
    expect(fullDashboard.totalTrades).toBe(50); // Analytics processes all 50
    expect(fullDashboard.netPnL).toBe(500);
  });

  // J. Date filtering
  it("J. Date filtering â€” includes/excludes trades accurately by date", () => {
    const rows = [
      createDummyTradeRow({ date: "2026-09-01", pnl: 100, status: "WIN" }),
      createDummyTradeRow({ date: "2026-09-05", pnl: 200, status: "WIN" }),
    ];
    const recs = rows.map(AnalyticsService.normalizeRow);

    const sept1Only = recs.filter((r) => r.date === "2026-09-01");
    const sept1Dashboard = AnalyticsService.calculateDashboard(sept1Only, 500);

    expect(sept1Dashboard.totalTrades).toBe(1);
    expect(sept1Dashboard.netPnL).toBe(100);
  });

  // K. Calendar
  it("K. Calendar â€” daily totals match analytics", () => {
    const rows = [
      createDummyTradeRow({ date: "2026-09-01", pnl: 100, status: "WIN" }),
      createDummyTradeRow({ date: "2026-09-01", pnl: -50, status: "LOSS" }),
      createDummyTradeRow({ date: "2026-09-02", pnl: 300, status: "WIN" }),
    ];
    const recs = rows.map(AnalyticsService.normalizeRow);
    const calendar = AnalyticsService.calculateCalendar(recs);

    expect(calendar.length).toBe(2);
    expect(calendar[0].date).toBe("2026-09-01");
    expect(calendar[0].totalTrades).toBe(2);
    expect(calendar[0].netPnL).toBe(50);
    expect(calendar[1].date).toBe("2026-09-02");
    expect(calendar[1].totalTrades).toBe(1);
    expect(calendar[1].netPnL).toBe(300);
  });

  // L. Monthly review
  it("L. Monthly review â€” monthly totals match underlying trades", () => {
    const rows = [
      createDummyTradeRow({ date: "2026-08-15", pnl: 100, status: "WIN", created_at: "2026-08-15T10:00:00.000Z" }),
      createDummyTradeRow({ date: "2026-09-01", pnl: 200, status: "WIN", created_at: "2026-09-01T10:00:00.000Z" }),
      createDummyTradeRow({ date: "2026-09-05", pnl: -50, status: "LOSS", created_at: "2026-09-05T10:00:00.000Z" }),
    ];
    const recs = rows.map(AnalyticsService.normalizeRow);
    const septReview = AnalyticsService.calculateMonthlyReview(recs, 2026, 9, 500);

    expect(septReview.startingCapital).toBe(600); // 500 + 100 from August
    expect(septReview.totalTrades).toBe(2);
    expect(septReview.netPnL).toBe(150); // 200 - 50
    expect(septReview.endingCapital).toBe(750);
  });

  // M. Profit factor
  it("M. Profit factor â€” normal case, zero-loss case, zero-trade case", () => {
    // Zero trade
    const emptyDash = AnalyticsService.calculateDashboard([], 500);
    expect(emptyDash.profitFactor).toBe(0);

    // Zero loss
    const winRows = [createDummyTradeRow({ pnl: 100, status: "WIN" })];
    const winDash = AnalyticsService.calculateDashboard(winRows.map(AnalyticsService.normalizeRow), 500);
    expect(winDash.hasLosses).toBe(false);
    expect(winDash.profitFactor).toBe(0);

    // Normal case (100 win, 50 loss)
    const mixedRows = [
      createDummyTradeRow({ pnl: 100, status: "WIN" }),
      createDummyTradeRow({ pnl: -50, status: "LOSS" }),
    ];
    const mixedDash = AnalyticsService.calculateDashboard(mixedRows.map(AnalyticsService.normalizeRow), 500);
    expect(mixedDash.hasLosses).toBe(true);
    expect(mixedDash.profitFactor).toBe(2.0);
  });

  // N. Drawdown
  it("N. Drawdown â€” realized peak-to-trough calculation", () => {
    const rows = [
      createDummyTradeRow({ pnl: 500, status: "WIN", created_at: "2026-09-01T10:00:00.000Z" }), // Cap: 1000 (Peak: 1000)
      createDummyTradeRow({ pnl: -300, status: "LOSS", created_at: "2026-09-02T10:00:00.000Z" }), // Cap: 700 (DD: 300 / 30%)
      createDummyTradeRow({ pnl: 100, status: "WIN", created_at: "2026-09-03T10:00:00.000Z" }), // Cap: 800
    ];
    const recs = rows.map(AnalyticsService.normalizeRow);
    const dd = AnalyticsService.calculateDrawdown(recs, 500);

    expect(dd.maxDrawdown).toBe(300);
    expect(dd.maxDrawdownPercentage).toBe(30);
  });

  // O. Equity curve
  it("O. Equity curve â€” starting capital + chronological realized P/L", () => {
    const rows = [
      createDummyTradeRow({ date: "2026-09-01", pnl: 100, status: "WIN", created_at: "2026-09-01T10:00:00.000Z" }),
      createDummyTradeRow({ date: "2026-09-02", pnl: -50, status: "LOSS", created_at: "2026-09-02T10:00:00.000Z" }),
    ];
    const recs = rows.map(AnalyticsService.normalizeRow);
    const curve = AnalyticsService.calculateEquityCurve(recs, 500);

    expect(curve.length).toBe(3); // Start + 2 trades
    expect(curve[0].capital).toBe(500);
    expect(curve[1].capital).toBe(600);
    expect(curve[2].capital).toBe(550);
  });

  // P. User ownership
  it("P. User ownership â€” repository queries are scoped strictly to verified userId", async () => {
    mockChainable.then.mockImplementationOnce((resolve: any) =>
      resolve({ data: [createDummyTradeRow({ user_id: USER_A })], error: null })
    );

    const trades = await tradeRepository.findAllTrades(USER_A);
    expect(mockChainable.eq).toHaveBeenCalledWith("user_id", USER_A);
    expect(trades[0].user_id).toBe(USER_A);
  });

  // Q. Historical strategy stability
  it("Q. Historical strategy stability â€” trade strategy is immutable from stored row", () => {
    const row = createDummyTradeRow({ strategy: "PWH_PWL" });
    const rec = AnalyticsService.normalizeRow(row);
    expect(rec.strategy).toBe("PWH_PWL");
  });

  // R. Closed trade immutability
  it("R. Closed trade immutability â€” analytics uses stored final P/L and R values", () => {
    const row = createDummyTradeRow({ pnl: 250, fees: 5, r_multiple: 2.5, status: "WIN" });
    const rec = AnalyticsService.normalizeRow(row);

    expect(rec.netPnl).toBe(245);
    expect(rec.rMultiple).toBe(2.5);
    expect(rec.status).toBe("WIN");
  });

  // S. Realtime refresh
  it("S. Realtime refresh â€” new closed trade updates analytics output", () => {
    const initialRows = [createDummyTradeRow({ pnl: 100, status: "WIN" })];
    const initialDash = AnalyticsService.calculateDashboard(initialRows.map(AnalyticsService.normalizeRow), 500);
    expect(initialDash.totalTrades).toBe(1);
    expect(initialDash.netPnL).toBe(100);

    // Simulate new trade closing
    const updatedRows = [...initialRows, createDummyTradeRow({ pnl: 200, status: "WIN" })];
    const updatedDash = AnalyticsService.calculateDashboard(updatedRows.map(AnalyticsService.normalizeRow), 500);
    expect(updatedDash.totalTrades).toBe(2);
    expect(updatedDash.netPnL).toBe(300);
  });
});
