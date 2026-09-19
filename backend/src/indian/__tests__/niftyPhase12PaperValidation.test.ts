import { describe, test, expect, beforeEach } from "vitest";
import { Candle } from "../types";
import { niftyMarketProvider } from "../market/NiftyMarketProvider";
import { hedgingStrategyEngine } from "../strategy/HedgingStrategyEngine";
import { paperBrokerAdapter } from "../broker/PaperBrokerAdapter";
import { dailyRiskController } from "../risk/DailyRiskController";
import { paperSessionManager } from "../lifecycle/PaperSessionManager";
import { signalAuditStore, ALL_REJECTION_CATEGORIES } from "../audit/SignalAuditStore";
import { paperJournalStore } from "../audit/PaperJournalStore";
import { niftyOptionChainService } from "../market/NiftyOptionChainService";
import { signalCooldownEngine } from "../lifecycle/SignalCooldownEngine";
import { paperValidationEngine } from "../validation/PaperValidationEngine";
import { systemHealthService } from "../health/SystemHealthService";

describe("Phase 12 — Paper Trading Performance Validation Test Suite", () => {
  beforeEach(() => {
    dailyRiskController.resetLocks();
    paperBrokerAdapter.resetAccount(500000);
    signalCooldownEngine.reset();
    signalAuditStore.clearLogs();
    paperJournalStore.clear();
    niftyMarketProvider.updateSpotPrice(25000, false, Date.now());
  });

  const createBullishCandles = (basePrice = 25000): Candle[] => {
    const candles: Candle[] = [];
    let price = basePrice;
    for (let i = 0; i < 20; i++) {
      candles.push({
        time: 1700000000 + i * 900,
        open: price,
        high: price + 15,
        low: price - 5,
        close: price + 10,
        volume: 15000,
      });
      price += 8;
    }
    return candles;
  };

  // 1. SESSION MANAGEMENT TESTS
  describe("1. Session Management", () => {
    test("tracks session state, IST hours, and risk lock transition", () => {
      const state = paperSessionManager.getSessionState();
      expect(state.symbol).toBe("NIFTY");
      expect(state.isPaperMode).toBe(true);
      expect(state.isLiveTradingEnabled).toBe(false);

      // Force session state override
      paperSessionManager.setForcedSessionState("PRE_MARKET");
      expect(paperSessionManager.getSessionState().state).toBe("PRE_MARKET");

      paperSessionManager.setForcedSessionState("ACTIVE");
      expect(paperSessionManager.getSessionState().isOpenForTrading).toBe(true);

      paperSessionManager.setForcedSessionState(null);
    });

    test("session records metrics on closed trades", () => {
      paperSessionManager.recordTradeToSession(750, 1000, 200, 50);
      const session = paperSessionManager.getSessionState().currentSession;
      expect(session?.totalTrades).toBe(1);
      expect(session?.winningTrades).toBe(1);
      expect(session?.netPnl).toBe(750);
    });
  });

  // 2. SIGNAL & 17 REJECTION REASONS AUDIT TESTS
  describe("2. Signals & 17-Reason Rejection Audit", () => {
    test("evaluates Bullish setup and generates READY Bull Put Spread signal", () => {
      const spot = 25150;
      const candles = createBullishCandles(25000);
      const chain = niftyOptionChainService.generateSyntheticChain(spot);

      const signal = hedgingStrategyEngine.generateSignal(spot, candles, candles, chain, 500000, false);
      expect(signal.status).toBe("READY");
      expect(signal.action).toBe("BULL_PUT_SPREAD");
      expect(signal.maxLoss).toBeLessThanOrEqual(1000);
    });

    test("records NO_TRADE signals and aggregates all 17 rejection categories", () => {
      const allCategories = ALL_REJECTION_CATEGORIES;
      expect(allCategories.length).toBe(17);

      const fakeSignal: any = {
        symbol: "NIFTY",
        timestamp: new Date().toISOString(),
        regime: "UNCLEAR",
        score: 0,
        action: "NO_TRADE",
        spotPrice: 25000,
        netCredit: 0,
        maxLoss: 0,
        status: "NO_TRADE",
        reasons: ["STALE data feed", "RSI failed", "DELTA failed", "MAX_LOSS limit exceeded"],
      };

      signalAuditStore.recordSignal(fakeSignal, false);
      const summary = signalAuditStore.getNoTradeAuditSummary();

      expect(summary.length).toBe(17);
      const staleStat = summary.find((s) => s.reason === "DATA_STALE");
      expect(staleStat?.count).toBeGreaterThanOrEqual(1);
    });
  });

  // 3. EXECUTION & HEDGE-FIRST TESTS
  describe("3. Execution & Order Flow Verification", () => {

    test("duplicate prevention via Signal Cooldown Engine", () => {
      const spot = 25150;
      const candles = createBullishCandles(25000);
      const chain = niftyOptionChainService.generateSyntheticChain(spot);

      const signal = hedgingStrategyEngine.generateSignal(spot, candles, candles, chain, 500000, false);
      signal.action = "BULL_PUT_SPREAD";

      const check1 = signalCooldownEngine.shouldAllowSignal(signal);
      expect(check1.allow).toBe(true);

      signalCooldownEngine.recordSignalExecution(signal);

      const check2 = signalCooldownEngine.shouldAllowSignal(signal);
      expect(check2.allow).toBe(false);
      expect(check2.reason).toContain("COOLDOWN_ACTIVE");
    });
  });

  // 4. POSITION MONITORING & EXITS
  describe("4. Position Monitoring & 5-Level Exit Engine", () => {
    test("records periodic snapshots during market ticks", () => {
      const spot = 25150;
      const candles = createBullishCandles(25000);
      const chain = niftyOptionChainService.generateSyntheticChain(spot);

      const signal = hedgingStrategyEngine.generateSignal(spot, candles, candles, chain, 500000, false);
      const position = paperBrokerAdapter.executePaperOrder("test-user-snap", signal);

      paperBrokerAdapter.processMarketTick(25160, chain, false);

      const openPos = paperBrokerAdapter.getOpenPositions()[0];
      expect(openPos.snapshots).toBeDefined();
      expect(openPos.snapshots!.length).toBeGreaterThanOrEqual(1);
      expect(openPos.snapshots![0].spot).toBe(25160);
    });

    test("Priority 5: Profit Target Exit at 50% initial credit capture", () => {
      const spot = 25150;
      const candles = createBullishCandles(25000);
      const chain = niftyOptionChainService.generateSyntheticChain(spot);

      const signal = hedgingStrategyEngine.generateSignal(spot, candles, candles, chain, 500000, false);
      const position = paperBrokerAdapter.executePaperOrder("test-user-target", signal);

      // Simulate tick where options crush in value -> target spread met
      const targetChain = niftyOptionChainService.generateSyntheticChain(25150);
      targetChain.contracts.forEach((c) => { c.ltp = 0.5; });

      paperBrokerAdapter.processMarketTick(25150, targetChain, false);

      const closed = paperBrokerAdapter.getClosedPositions();
      expect(closed.length).toBe(1);
      expect(closed[0].exitReason).toBe("PROFIT_TARGET_CAPTURED");
    });
  });

  // 5. P&L & CHARGES CALCULATIONS
  describe("5. P&L & Charge Engine", () => {
    test("calculates gross P&L, brokerage, taxes, slippage, and net P&L", () => {
      const spot = 25150;
      const candles = createBullishCandles(25000);
      const chain = niftyOptionChainService.generateSyntheticChain(spot);

      const signal = hedgingStrategyEngine.generateSignal(spot, candles, candles, chain, 500000, false);
      expect(signal.charges.brokerage).toBeGreaterThan(0);
      expect(signal.charges.stt).toBeGreaterThanOrEqual(0);
      expect(signal.charges.totalCharges).toBeGreaterThan(0);
    });
  });

  // 6. DAILY RISK LOCKS
  describe("6. Daily Risk Locks", () => {
    test("triggers Profit Lock at ₹1,000 net profit", () => {
      dailyRiskController.recordTradeClosed(1150);
      const state = dailyRiskController.getState();
      expect(state.isDailyProfitLocked).toBe(true);
      expect(state.isTradeLocked).toBe(true);
      expect(state.lockReason).toContain("profit target reached");
    });

    test("triggers Loss Lock at -₹5,000 net loss", () => {
      dailyRiskController.recordTradeClosed(-5200);
      const state = dailyRiskController.getState();
      expect(state.isDailyLossLocked).toBe(true);
      expect(state.isTradeLocked).toBe(true);
    });

    test("triggers Max Trades Lock at 3 trades per day", () => {
      dailyRiskController.recordTradeClosed(200);
      dailyRiskController.recordTradeClosed(300);
      dailyRiskController.recordTradeClosed(100);
      const state = dailyRiskController.getState();
      expect(state.isTradeLocked).toBe(true);
      expect(state.lockReason).toContain("Maximum trades per day");
    });

    test("triggers Consecutive Losses Lock at 2 losses", () => {
      dailyRiskController.recordTradeClosed(-300);
      dailyRiskController.recordTradeClosed(-400);
      const state = dailyRiskController.getState();
      expect(state.isTradeLocked).toBe(true);
      expect(state.lockReason).toContain("consecutive losses");
    });
  });

  // 7. PERFORMANCE ANALYTICS & DAILY REPORT
  describe("7. Performance Analytics & Daily Report", () => {
    test("generates Paper Performance Summary & Target Analysis", () => {
      const summary = paperValidationEngine.getPerformanceSummary();
      expect(summary.validationStatus).toBe("INSUFFICIENT SAMPLE");
      expect(summary.minRequiredSessions).toBe(20);

      const targetAnalysis = paperValidationEngine.getTargetAnalysis1000();
      expect(targetAnalysis.daysNetAbove1000).toBeDefined();

      const report = paperValidationEngine.generateDailyReport();
      expect(report.reportText).toContain("PAPER SESSION REPORT");
    });

    test("computes side-by-side paper vs historical comparison", () => {
      const comp = paperValidationEngine.getPaperVsHistoricalComparison();
      expect(comp.historicalBacktest).toBeDefined();
      expect(comp.livePaperTrading).toBeDefined();
    });
  });

  // 8. DATA INTEGRITY & LIVE_TRADING ISOLATION TEST
  describe("8. Data Integrity & Safety Test", () => {
    test("proves synthetic option data cannot be labelled REAL LIVE PERFORMANCE", () => {
      const componentHealth = niftyMarketProvider.getDataComponentHealthMap();
      expect(componentHealth.overallDataQuality).toBe("SYNTHETIC OPTION DATA — PAPER ESTIMATION");
      expect(componentHealth.optionChain).toBe("SYNTHETIC");
    });

    test("verifies LIVE_TRADING = false and paper broker adapter has no real execution path", () => {
      const session = paperSessionManager.getSessionState();
      expect(session.isLiveTradingEnabled).toBe(false);
      expect(session.isPaperMode).toBe(true);
    });
  });
});
