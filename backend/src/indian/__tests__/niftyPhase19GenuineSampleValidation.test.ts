import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  Phase19GenuineValidationEngine,
  DEFAULT_PHASE19_CONFIG,
} from "../validation/Phase19GenuineValidationEngine";
import {
  Phase19ImmutableTrade,
  Phase19DailySession,
} from "../types";
import { genuineDataValidator } from "../validation/GenuineDataValidator";
import { niftyMarketProvider } from "../market/NiftyMarketProvider";
import { nseIndiaOptionChainProvider } from "../market/NseIndiaOptionChainProvider";
import { instrumentMasterResolver } from "../broker/InstrumentMasterResolver";
import { reconciliationEngine } from "../reconciliation/ReconciliationEngine";

describe("Phase 19 — Genuine Paper Trading Sample Collection & Statistical Validation Test Suite", () => {
  let engine: Phase19GenuineValidationEngine;

  beforeEach(() => {
    engine = new Phase19GenuineValidationEngine(DEFAULT_PHASE19_CONFIG);
    engine.resetState();

    const now = Date.now();
    niftyMarketProvider.updateSpotPrice(24700.5, true, now);
    instrumentMasterResolver.verifyLotSizeFromProvider(75);

    vi.spyOn(nseIndiaOptionChainProvider, "getProviderHealth").mockReturnValue({
      isConfigured: true,
      isAuthenticated: true,
      lastFetchMs: now,
      lastSuccessMs: now - 1000,
      consecutiveFailures: 0,
      currentBackoffMs: 0,
      providerName: "NSE_INDIA",
      status: "OK",
    });
  });

  // Helper to generate a valid genuine trade
  const createMockTrade = (
    id: string,
    netPnl: number,
    strategy: "BULL_PUT_SPREAD" | "BEAR_CALL_SPREAD" | "IRON_CONDOR" = "BULL_PUT_SPREAD",
    sampleType: "REAL_GENUINE_PAPER" | "SIMULATED_TEST" | "INVALID" = "REAL_GENUINE_PAPER",
    exitReason: string = netPnl > 0 ? "PROFIT_TARGET_CAPTURED" : "STOP_LOSS_HIT",
    grossPnl: number = netPnl > 0 ? netPnl + 100 : netPnl - 100
  ): Phase19ImmutableTrade => {
    const baseTime = 1726700000000;
    return {
      tradeId: id,
      sessionId: "sess_20260919",
      timestamp: new Date(baseTime).toISOString(),
      dataTimestamp: new Date(baseTime).toISOString(),
      decisionTimestamp: new Date(baseTime + 1000).toISOString(),
      entryTimestamp: new Date(baseTime + 2000).toISOString(),
      exitTimestamp: new Date(baseTime + 1800000).toISOString(),
      dataSource: "NSE_INDIA",
      spot: 24700,
      expiry: "2026-09-25",
      strikes: { sellStrike: 24600, buyStrike: 24550 },
      optionTypes: { sellType: "PE", buyType: "PE" },
      lotSize: 75,
      entryPrices: { buyPrice: 15, sellPrice: 40 },
      exitPrices: { buyExitPrice: 5, sellExitPrice: 15 },
      initialCredit: 25,
      finalDebitCredit: 10,
      charges: 80,
      slippage: 20,
      grossPnl,
      netPnl,
      strategy,
      regime: strategy === "BULL_PUT_SPREAD" ? "BULLISH" : strategy === "BEAR_CALL_SPREAD" ? "BEARISH" : "RANGE",
      exitReason,
      maxLoss: 1000,
      dataQualityState: "REAL_DATA_VALIDATED",
      sampleType,
    };
  };

  // Helper to generate mock daily session
  const createMockSession = (
    date: string,
    tradesCount: number,
    netPnl: number,
    sampleType: "REAL_GENUINE_PAPER" | "SIMULATED_TEST" | "INVALID" = "REAL_GENUINE_PAPER",
    classification: "ACTIVE" | "NO_TRADE" | "BLOCKED" = tradesCount > 0 ? "ACTIVE" : "NO_TRADE"
  ): Phase19DailySession => {
    return {
      sessionDate: date,
      sessionStart: `${date}T09:15:00.000Z`,
      sessionEnd: `${date}T15:30:00.000Z`,
      marketSessionValid: true,
      dataGateReadyDurationSeconds: 22500,
      numberOfSignals: tradesCount + 2,
      numberOfTrades: tradesCount,
      numberOfNoTrades: tradesCount === 0 ? 1 : 0,
      numberOfBlockedSignals: classification === "BLOCKED" ? 2 : 0,
      grossPnL: netPnl + tradesCount * 50,
      charges: tradesCount * 80,
      slippage: tradesCount * 20,
      netPnL: netPnl,
      maxDrawdown: netPnl < 0 ? Math.abs(netPnl) : 0,
      riskViolations: 0,
      reconciliationStatus: "OK",
      classification,
      sampleType,
    };
  };

  // ── 1. GENUINE SAMPLE HARD GATE & SEPARATION (Section 2 & 17) ────────────────
  describe("1. Genuine Sample Hard Gate & Strict Separation", () => {
    it("accepts genuine trade marked REAL_GENUINE_PAPER into genuine dataset", () => {
      const trade = createMockTrade("trade_01", 450, "BULL_PUT_SPREAD", "REAL_GENUINE_PAPER");
      engine.recordTrade(trade);

      const genuineTrades = engine.getGenuineTrades();
      expect(genuineTrades.length).toBe(1);
      expect(genuineTrades[0].tradeId).toBe("trade_01");
      expect(genuineTrades[0].sampleType).toBe("REAL_GENUINE_PAPER");
    });

    it("strictly excludes simulated and invalid trades from genuine metrics", async () => {
      // Record 2 genuine trades
      engine.recordTrade(createMockTrade("gen_01", 500, "BULL_PUT_SPREAD", "REAL_GENUINE_PAPER"));
      engine.recordTrade(createMockTrade("gen_02", 300, "BEAR_CALL_SPREAD", "REAL_GENUINE_PAPER"));

      // Record simulated and invalid trades
      engine.recordTrade(createMockTrade("sim_01", 10000, "IRON_CONDOR", "SIMULATED_TEST"));
      engine.recordTrade(createMockTrade("inv_01", -5000, "BULL_PUT_SPREAD", "INVALID"));

      const genuineTrades = engine.getGenuineTrades();
      const simTrades = engine.getSimulatedTrades();

      expect(genuineTrades.length).toBe(2);
      expect(simTrades.length).toBe(1);

      const report = await engine.generateSummaryReport();
      expect(report.genuineSample.totalTrades).toBe(2);
      expect(report.genuineSample.simulatedTradesExcluded).toBe(2);
      // Net PnL must strictly be sum of genuine trades only: 500 + 300 = 800
      expect(report.tradeMetrics.netPnL).toBe(800);
    });
  });

  // ── 2. SAMPLE IMMUTABILITY & ANTI-HINDSIGHT PROTECTION (Section 4 & 5) ───────
  describe("2. Sample Immutability & Anti-Hindsight Protection", () => {
    it("rejects trade with future data timestamp relative to decision timestamp", () => {
      const invalidTrade: Phase19ImmutableTrade = {
        ...createMockTrade("hind_01", 400),
        dataTimestamp: "2026-09-19T10:05:00.000Z", // Future
        decisionTimestamp: "2026-09-19T10:00:00.000Z", // Past relative to data!
      };

      expect(() => engine.recordTrade(invalidTrade)).toThrow(/Anti-Hindsight Violation/);
    });

    it("rejects trade with entry timestamp earlier than decision timestamp", () => {
      const invalidTrade: Phase19ImmutableTrade = {
        ...createMockTrade("hind_02", 400),
        decisionTimestamp: "2026-09-19T10:05:00.000Z",
        entryTimestamp: "2026-09-19T10:01:00.000Z", // Before decision!
      };

      expect(() => engine.recordTrade(invalidTrade)).toThrow(/Anti-Hindsight Violation/);
    });

    it("guarantees sample immutability once a trade is recorded", () => {
      const trade = createMockTrade("immut_01", 600);
      engine.recordTrade(trade);

      const stored = engine.getGenuineTrades()[0];
      expect(Object.isFrozen(stored)).toBe(true);

      expect(() => {
        (stored as any).netPnl = 9999;
      }).toThrow();
    });
  });

  // ── 3. METRICS & P&L CALCULATIONS (Section 7, 8 & 9) ─────────────────────────
  describe("3. Factual Trade Metrics, Profit Factor & Drawdown", () => {
    it("computes win rate, average trade, median trade, and gross profit/loss accurately", () => {
      const trades: Phase19ImmutableTrade[] = [
        createMockTrade("t1", 500, "BULL_PUT_SPREAD", "REAL_GENUINE_PAPER", "PROFIT_TARGET_CAPTURED", 600),
        createMockTrade("t2", 300, "BULL_PUT_SPREAD", "REAL_GENUINE_PAPER", "PROFIT_TARGET_CAPTURED", 400),
        createMockTrade("t3", -200, "BEAR_CALL_SPREAD", "REAL_GENUINE_PAPER", "STOP_LOSS_HIT", -100),
        createMockTrade("t4", 0, "IRON_CONDOR", "REAL_GENUINE_PAPER", "STRUCTURE_EXIT", 100),
      ];

      const metrics = engine.computeTradeMetrics(trades);
      expect(metrics.totalTrades).toBe(4);
      expect(metrics.winningTrades).toBe(2);
      expect(metrics.losingTrades).toBe(1);
      expect(metrics.breakevenTrades).toBe(1);
      expect(metrics.winRate).toBe(50.0);
      expect(metrics.lossRate).toBe(25.0);
      expect(metrics.netPnL).toBe(600);
      expect(metrics.averageNetTrade).toBe(150);
      expect(metrics.largestWin).toBe(500);
      expect(metrics.largestLoss).toBe(-200);
    });

    it("reports Profit Factor as NOT_AVAILABLE when gross loss is 0 (Section 7)", () => {
      const trades: Phase19ImmutableTrade[] = [
        createMockTrade("t1", 500, "BULL_PUT_SPREAD", "REAL_GENUINE_PAPER", "PROFIT_TARGET_CAPTURED", 600),
        createMockTrade("t2", 400, "BEAR_CALL_SPREAD", "REAL_GENUINE_PAPER", "PROFIT_TARGET_CAPTURED", 500),
      ];

      const metrics = engine.computeTradeMetrics(trades);
      expect(metrics.grossLoss).toBe(0);
      expect(metrics.profitFactor).toBe("NOT_AVAILABLE");
    });

    it("computes Profit Factor correctly as Gross Profit / Absolute Gross Loss when losses exist", () => {
      const trades: Phase19ImmutableTrade[] = [
        createMockTrade("t1", 500, "BULL_PUT_SPREAD", "REAL_GENUINE_PAPER", "PROFIT_TARGET_CAPTURED", 1000),
        createMockTrade("t2", -400, "BEAR_CALL_SPREAD", "REAL_GENUINE_PAPER", "STOP_LOSS_HIT", -500),
      ];

      const metrics = engine.computeTradeMetrics(trades);
      expect(metrics.grossProfit).toBe(1000);
      expect(metrics.grossLoss).toBe(500);
      expect(metrics.profitFactor).toBe(2.0);
    });

    it("computes equity curve and maximum drawdown without future data or simulated trades", () => {
      const trades: Phase19ImmutableTrade[] = [
        createMockTrade("t1", 1000),
        createMockTrade("t2", -3000),
        createMockTrade("t3", 500),
        createMockTrade("t4", -1000),
      ];

      const dd = engine.computeDrawdown(trades);
      expect(dd.peakEquity).toBe(501000);
      expect(dd.currentEquity).toBe(497500);
      expect(dd.maximumDrawdown).toBe(3500);
      expect(dd.maximumDrawdownPercent).toBeGreaterThan(0);
      expect(dd.drawdownDuration).toBeGreaterThan(0);
    });

    it("computes daily P&L distribution and ₹1,000 threshold categories accurately", () => {
      const sessions: Phase19DailySession[] = [
        createMockSession("2026-09-01", 2, 1250), // >= 1000
        createMockSession("2026-09-02", 1, 450),  // 0 to 999.99
        createMockSession("2026-09-03", 2, -600), // Negative
        createMockSession("2026-09-04", 0, 0, "REAL_GENUINE_PAPER", "NO_TRADE"), // No trade
        createMockSession("2026-09-05", 0, 0, "REAL_GENUINE_PAPER", "BLOCKED"),  // Blocked
      ];

      const dist = engine.computeDailyDistribution(sessions);
      expect(dist.daysAbove1000).toBe(1);
      expect(dist.days0To999).toBe(1);
      expect(dist.daysNegative).toBe(1);
      expect(dist.noTradeDays).toBe(1);
      expect(dist.blockedDays).toBe(1);
      expect(dist.profitableDays).toBe(2);
      expect(dist.losingDays).toBe(1);
      expect(dist.dailyStandardDeviation).toBeGreaterThan(0);
    });
  });

  // ── 4. VALIDATION LOCK THRESHOLDS (Section 3 & 25) ───────────────────────────
  describe("4. Validation Lock Thresholds (20 Sessions, 30 Trades, 15 Active)", () => {
    it("reports INSUFFICIENT_SAMPLE when below 20 sessions", async () => {
      const sessions: Phase19DailySession[] = [];
      for (let i = 1; i <= 18; i++) {
        sessions.push(createMockSession(`2026-09-${String(i).padStart(2, "0")}`, 2, 400));
      }

      const trades: Phase19ImmutableTrade[] = [];
      for (let i = 1; i <= 36; i++) {
        trades.push(createMockTrade(`t_${i}`, 400));
      }

      const report = await engine.generateSummaryReport(sessions, trades);
      expect(report.genuineSample.sessionsMet).toBe(false);
      expect(report.validationStatus).toBe("INSUFFICIENT_SAMPLE");
      expect(report.finalStatus).toBe("GENUINE SAMPLE COLLECTION ACTIVE");
    });

    it("reports INSUFFICIENT_SAMPLE when below 30 trades", async () => {
      const sessions: Phase19DailySession[] = [];
      for (let i = 1; i <= 22; i++) {
        sessions.push(createMockSession(`2026-09-${String(i).padStart(2, "0")}`, 1, 400));
      }

      const trades: Phase19ImmutableTrade[] = [];
      for (let i = 1; i <= 22; i++) {
        trades.push(createMockTrade(`t_${i}`, 400));
      }

      const report = await engine.generateSummaryReport(sessions, trades);
      expect(report.genuineSample.tradesMet).toBe(false);
      expect(report.validationStatus).toBe("INSUFFICIENT_SAMPLE");
    });

    it("reports INSUFFICIENT_SAMPLE when below 15 active sessions", async () => {
      const sessions: Phase19DailySession[] = [];
      for (let i = 1; i <= 22; i++) {
        // Only 12 active sessions, 10 no-trade sessions
        const isActive = i <= 12;
        sessions.push(
          createMockSession(
            `2026-09-${String(i).padStart(2, "0")}`,
            isActive ? 3 : 0,
            isActive ? 500 : 0,
            "REAL_GENUINE_PAPER",
            isActive ? "ACTIVE" : "NO_TRADE"
          )
        );
      }

      const trades: Phase19ImmutableTrade[] = [];
      for (let i = 1; i <= 36; i++) {
        trades.push(createMockTrade(`t_${i}`, 400));
      }

      const report = await engine.generateSummaryReport(sessions, trades);
      expect(report.genuineSample.activeSessionsMet).toBe(false);
      expect(report.validationStatus).toBe("INSUFFICIENT_SAMPLE");
    });

    it("reports FULL_VALIDATION_AVAILABLE when exactly at 20 sessions, 30 trades, 15 active sessions", async () => {
      const sessions: Phase19DailySession[] = [];
      for (let i = 1; i <= 20; i++) {
        const isActive = i <= 15;
        sessions.push(
          createMockSession(
            `2026-09-${String(i).padStart(2, "0")}`,
            isActive ? 2 : 0,
            isActive ? 400 : 0,
            "REAL_GENUINE_PAPER",
            isActive ? "ACTIVE" : "NO_TRADE"
          )
        );
      }

      const trades: Phase19ImmutableTrade[] = [];
      for (let i = 1; i <= 30; i++) {
        trades.push(createMockTrade(`t_${i}`, 350));
      }

      const report = await engine.generateSummaryReport(sessions, trades);
      expect(report.genuineSample.sessionsMet).toBe(true);
      expect(report.genuineSample.tradesMet).toBe(true);
      expect(report.genuineSample.activeSessionsMet).toBe(true);
      expect(report.validationStatus).toBe("FULL_VALIDATION_AVAILABLE");
      expect(report.finalStatus).toBe("FULL STATISTICAL VALIDATION AVAILABLE");
    });
  });

  // ── 5. STRATEGY BREAKDOWN (Section 10) ───────────────────────────────────────
  describe("5. Unranked Strategy Breakdown", () => {
    it("computes separate factual metrics for Bull Put, Bear Call, and Iron Condor without ranking", () => {
      const trades: Phase19ImmutableTrade[] = [
        createMockTrade("bp1", 400, "BULL_PUT_SPREAD"),
        createMockTrade("bp2", -200, "BULL_PUT_SPREAD"),
        createMockTrade("bc1", 300, "BEAR_CALL_SPREAD"),
        createMockTrade("ic1", 500, "IRON_CONDOR"),
      ];

      const breakdown = engine.computeStrategyBreakdown(trades);
      expect(breakdown.length).toBe(3);

      const bp = breakdown.find((b) => b.strategy === "BULL_PUT");
      const bc = breakdown.find((b) => b.strategy === "BEAR_CALL");
      const ic = breakdown.find((b) => b.strategy === "IRON_CONDOR");

      expect(bp?.tradeCount).toBe(2);
      expect(bp?.winRate).toBe(50.0);
      expect(bc?.tradeCount).toBe(1);
      expect(bc?.winRate).toBe(100.0);
      expect(ic?.tradeCount).toBe(1);
      expect(ic?.winRate).toBe(100.0);

      // Verify unranked: No rank, score, or "best" field exists
      expect((bp as any).rank).toBeUndefined();
      expect((bp as any).isBest).toBeUndefined();
    });
  });

  // ── 6. RISK AUDIT & BLOCKED VIOLATIONS (Section 13 & 14) ────────────────────
  describe("6. Risk Audit & Execution Quality", () => {
    it("records blocked risk events without executing them as trades", () => {
      engine.recordBlockedRiskEvent("maxLossViolations", "Spread max loss > 1000 INR");
      engine.recordBlockedRiskEvent("dailyLossViolations", "Daily loss limit reached");
      engine.recordBlockedRiskEvent("duplicateTradeAttempts", "Duplicate order blocked by idempotency");
      engine.recordBlockedRiskEvent("staleDataTradeAttempts", "Option chain age > 60s");

      // Verify genuine trades remain 0
      expect(engine.getGenuineTrades().length).toBe(0);
    });

    it("verifies NO_NAKED_SHORT invariant across execution quality", async () => {
      const report = await engine.generateSummaryReport();
      expect(report.executionQuality.nakedShortCount).toBe(0);
      expect(report.riskAudit.executedViolations).toBe(0);
    });
  });

  // ── 7. ROLLING METRICS & HISTORICAL COMPARISON (Section 18 & 19) ─────────────
  describe("7. Rolling Metrics & Phase 11 Historical Comparison", () => {
    it("reports INSUFFICIENT_ROLLING_SAMPLE when fewer trades exist than window size", () => {
      const trades = [createMockTrade("t1", 300), createMockTrade("t2", 400)];
      const rolling = engine.computeRollingMetrics(trades);

      expect(rolling.find((r) => r.windowSize === 10)?.status).toBe("INSUFFICIENT_ROLLING_SAMPLE");
      expect(rolling.find((r) => r.windowSize === 20)?.status).toBe("INSUFFICIENT_ROLLING_SAMPLE");
      expect(rolling.find((r) => r.windowSize === 30)?.status).toBe("INSUFFICIENT_ROLLING_SAMPLE");
    });

    it("computes side-by-side historical backtest vs genuine paper trading without combining datasets", () => {
      const trades = [
        createMockTrade("t1", 500, "BULL_PUT_SPREAD"),
        createMockTrade("t2", 400, "BEAR_CALL_SPREAD"),
      ];
      const sessions = [createMockSession("2026-09-01", 2, 900)];

      const comp = engine.computeHistoricalComparison(trades, sessions);
      expect(comp.historicalBacktest.winRatePct).toBe(78.5);
      expect(comp.genuinePaperTrading.winRatePct).toBe(100.0);
      expect(comp.genuinePaperTrading.netPnl).toBe(900);
    });
  });

  // ── 8. DATA EXPORT SANITIZATION (Section 22) ────────────────────────────────
  describe("8. Data Export Sanitization", () => {
    it("exports only genuine records without exposing credentials or secrets", () => {
      engine.recordTrade(createMockTrade("exp_01", 500));
      engine.recordDailySession(createMockSession("2026-09-01", 1, 500));

      const exported: any = engine.exportGenuineValidationData();
      expect(exported.sampleClassification).toBe("REAL_GENUINE_PAPER");
      expect(exported.totalTradesCount).toBe(1);
      expect(exported.trades[0].tradeId).toBe("exp_01");

      // Verify no API keys or secrets in export
      const jsonStr = JSON.stringify(exported);
      expect(jsonStr).not.toContain("API_KEY");
      expect(jsonStr).not.toContain("SECRET");
      expect(jsonStr).not.toContain("PASSWORD");
    });
  });

  // ── 9. PERMANENT SAFETY LOCKS (Section 26) ──────────────────────────────────
  describe("9. Permanent Safety Locks Verification", () => {
    it("confirms PAPER_TRADING=true, LIVE_TRADING=false, and BROKER_EXECUTION=false", () => {
      const locks = engine.assertSafetyLocks();
      expect(locks.paperTrading).toBe(true);
      expect(locks.liveTrading).toBe(false);
      expect(locks.brokerExecutionEnabled).toBe(false);
    });
  });
});
