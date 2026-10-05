import { describe, test, expect, beforeEach, vi } from "vitest";
import {
  GenuineSampleStore,
  GenuineSessionRecord,
  GenuineTradeRecord,
} from "../persistence/GenuineSampleStore";
import { GenuineDailyLedger } from "../persistence/GenuineDailyLedger";
import {
  Phase28StatisticalEvidenceEngine,
} from "../validation/Phase28StatisticalEvidenceEngine";
import { strategyFingerprintManager } from "../validation/StrategyFingerprintManager";
import { dhanBrokerAdapter } from "../broker/DhanBrokerAdapter";
import { paperBrokerAdapter } from "../broker/PaperBrokerAdapter";
import { dailyRiskController } from "../risk/DailyRiskController";
import { reconciliationEngine } from "../reconciliation/ReconciliationEngine";
import { phase26EGenuineLivePaperValidationEngine } from "../validation/Phase26EGenuineLivePaperValidationEngine";

describe("PHASE 28 — Statistical Evidence & Robustness Validation Suite", () => {
  let store: GenuineSampleStore;
  let ledger: GenuineDailyLedger;
  let engine: Phase28StatisticalEvidenceEngine;

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env.PAPER_TRADING = "true";
    process.env.LIVE_TRADING = "false";
    process.env.BROKER_EXECUTION_ENABLED = "false";
    process.env.INDIAN_REAL_DATA_ONLY = "true";

    store = new GenuineSampleStore();
    store.clearStore();
    ledger = new GenuineDailyLedger();
    ledger.clearLedger();
    engine = new Phase28StatisticalEvidenceEngine(store, ledger);
    dailyRiskController.resetDailyState();
    paperBrokerAdapter.resetAccount();
  });

  // Helper to generate N genuine weekday dates starting Oct 5, 2026 (Monday)
  const getWeekdays = (count: number): string[] => {
    const dates: string[] = [];
    const cur = new Date("2026-10-05T09:15:00+05:30");
    while (dates.length < count) {
      if (cur.getDay() >= 1 && cur.getDay() <= 5) {
        const y = cur.getFullYear();
        const m = String(cur.getMonth() + 1).padStart(2, "0");
        const d = String(cur.getDate()).padStart(2, "0");
        dates.push(`${y}-${m}-${d}`);
      }
      cur.setDate(cur.getDate() + 1);
    }
    return dates;
  };

  test("1. Insufficient sample gate", () => {
    const report = engine.generateReport();
    expect(report.validationStatus).toBe("INSUFFICIENT_SAMPLE");
    expect(report.gateDetails.sessionsMet).toBe(false);
  });

  test("2. Complete sample gate", () => {
    const weekdays = getWeekdays(20);
    for (let i = 0; i < 20; i++) {
      const d = weekdays[i];
      store.recordSession({
        sessionId: `sess_${i + 1}`,
        sessionDateIST: d,
        sessionStart: `${d}T09:15:00+05:30`,
        sessionEnd: `${d}T15:30:00+05:30`,
        timezone: "Asia/Kolkata",
        timestampUTC: `${d}T03:45:00Z`,
        timestampIST: `${d}T09:15:00+05:30`,
        provider: "DHAN",
        dataGate: "PASSED",
        marketSession: "MARKET_OPEN",
        spotSource: "DHAN",
        optionChainSource: "DHAN",
        optionPriceSource: "DHAN",
        greeksSource: "REAL",
        lotSizeSource: "DHAN_MASTER",
        expiry: d,
        websocketStatus: "HEALTHY",
        reconciliationStatus: "PASS",
        genuineSession: true,
        blockedReason: null,
        createdAt: `${d}T09:15:00+05:30`,
      });
    }

    for (let i = 0; i < 30; i++) {
      const d = weekdays[i % 20];
      store.recordTrade({
        tradeId: `trd_${i + 1}`,
        sessionId: `sess_${(i % 20) + 1}`,
        signalId: `sig_${i + 1}`,
        strategy: "BULL_PUT_SPREAD",
        regime: "BULLISH",
        entryTimestamp: `${d}T10:00:00+05:30`,
        entryTimestampIST: `${d}T10:00:00+05:30`,
        expiry: d,
        shortStrike: 24700,
        hedgeStrike: 24550,
        optionType: "PE",
        quantity: 75,
        entryCredit: 60,
        netPnL: 500,
        brokerage: 40,
        STT: 10,
        exchangeCharges: 5,
        GST: 10,
        SEBICharges: 1,
        stampDuty: 2,
        slippage: 10,
        dataSource: "DHAN",
        priceSource: "DHAN",
        greeksSource: "REAL",
        lotSize: 75,
        genuineTrade: true,
        pnlType: "REAL_MARKET_DATA_PAPER_PNL",
        validationFlags: {
          realSpot: true,
          realOptionChain: true,
          realOptionPrices: true,
          dataNotStale: true,
          lotSizeVerified: true,
          marketSessionValid: true,
          safetyLocksValid: true,
          reconciliationPassed: true,
          antiHindsightPassed: true,
        },
      });
    }

    const report = engine.generateReport();
    expect(report.validationStatus).toBe("SAMPLE_COMPLETE");
    expect(report.gateDetails.sessionsMet).toBe(true);
    expect(report.gateDetails.tradesMet).toBe(true);
    expect(report.gateDetails.activeSessionsMet).toBe(true);
  });

  test("3. Win-rate calculation", () => {
    const mockTrades: GenuineTradeRecord[] = [
      { tradeId: "t1", netPnL: 1000 } as any,
      { tradeId: "t2", netPnL: 500 } as any,
      { tradeId: "t3", netPnL: -400 } as any,
    ];
    const stats = engine.calculateCoreStatistics(mockTrades);
    expect(stats.totalTrades).toBe(3);
    expect(stats.winningTrades).toBe(2);
    expect(stats.losingTrades).toBe(1);
    expect(stats.winRate).toBe(66.67);
  });

  test("4. Wilson confidence interval", () => {
    const ci = engine.calculateWilsonConfidenceInterval(19, 30);
    expect(ci.observedWinRatePct).toBe(63.33);
    expect(ci.lowerBoundPct).toBeGreaterThan(45);
    expect(ci.upperBoundPct).toBeLessThan(80);
    expect(ci.lowerBoundPct).toBeLessThan(ci.observedWinRatePct);
    expect(ci.upperBoundPct).toBeGreaterThan(ci.observedWinRatePct);
  });

  test("5. Profit factor", () => {
    const trades: GenuineTradeRecord[] = [
      { tradeId: "t1", grossPnL: 3000, netPnL: 2900 } as any,
      { tradeId: "t2", grossPnL: -1500, netPnL: -1600 } as any,
    ];
    const stats = engine.calculateCoreStatistics(trades);
    expect(stats.profitFactor).toBe(2);
  });

  test("6. Expectancy", () => {
    const trades: GenuineTradeRecord[] = [
      { tradeId: "t1", netPnL: 1500 } as any,
      { tradeId: "t2", netPnL: -500 } as any,
    ];
    const stats = engine.calculateCoreStatistics(trades);
    expect(stats.expectancy).toBe(500);
  });

  test("7. Bootstrap reproducibility", () => {
    const trades: GenuineTradeRecord[] = Array.from({ length: 30 }, (_, i) => ({
      tradeId: `t_${i}`,
      netPnL: i % 2 === 0 ? 1000 : -600,
    })) as any;

    const b1 = engine.calculateBootstrapExpectancy(trades, 10000, 42);
    const b2 = engine.calculateBootstrapExpectancy(trades, 10000, 42);

    expect(b1.bootstrapMean).toBe(b2.bootstrapMean);
    expect(b1.confidenceInterval95.lower).toBe(b2.confidenceInterval95.lower);
    expect(b1.confidenceInterval95.upper).toBe(b2.confidenceInterval95.upper);
  });

  test("8. Bootstrap confidence interval", () => {
    const trades: GenuineTradeRecord[] = Array.from({ length: 30 }, (_, i) => ({
      tradeId: `t_${i}`,
      netPnL: i % 3 === 0 ? -1000 : 800,
    })) as any;

    const b = engine.calculateBootstrapExpectancy(trades, 10000, 42);
    expect(b.confidenceInterval95.lower).toBeLessThan(b.observedExpectancy);
    expect(b.confidenceInterval95.upper).toBeGreaterThan(b.observedExpectancy);
  });

  test("9. Rolling statistics", () => {
    const trades: GenuineTradeRecord[] = Array.from({ length: 25 }, (_, i) => ({
      tradeId: `t_${i}`,
      netPnL: 500,
      grossPnL: 600,
      brokerage: 10,
      STT: 5,
      exchangeCharges: 2,
      GST: 2,
      SEBICharges: 1,
      stampDuty: 1,
      slippage: 5,
    })) as any;

    const rolling = engine.calculateRollingWindows(trades);
    expect(rolling.length).toBeGreaterThan(0);
    const r10 = rolling.filter((r) => r.windowSize === 10);
    expect(r10.length).toBe(16); // 25 - 10 + 1 = 16
  });

  test("10. Regime statistics", () => {
    const trades: GenuineTradeRecord[] = [
      { tradeId: "t1", regime: "BULLISH", netPnL: 1000 } as any,
      { tradeId: "t2", regime: "RANGE", netPnL: -200 } as any,
    ];

    const reg = engine.calculateRegimeEvidence(trades);
    const bullish = reg.find((r) => r.regime === "BULLISH");
    expect(bullish?.tradeCount).toBe(1);
    expect(bullish?.netPnL).toBe(1000);
  });

  test("11. Strategy statistics", () => {
    const trades: GenuineTradeRecord[] = [
      { tradeId: "t1", strategy: "IRON_CONDOR", netPnL: 1200 } as any,
    ];

    const strats = engine.calculateStrategyEvidence(trades);
    const ic = strats.find((s) => s.strategy === "IRON_CONDOR");
    expect(ic?.tradeCount).toBe(1);
    expect(ic?.netPnL).toBe(1200);
  });

  test("12. Low subgroup warning", () => {
    const trades: GenuineTradeRecord[] = [
      { tradeId: "t1", regime: "BULLISH", netPnL: 1000 } as any,
      { tradeId: "t2", regime: "BULLISH", netPnL: 800 } as any,
    ];

    const reg = engine.calculateRegimeEvidence(trades);
    const bullish = reg.find((r) => r.regime === "BULLISH");
    expect(bullish?.lowSampleWarning).toBe(true);
  });

  test("13. Maximum drawdown", () => {
    const trades: GenuineTradeRecord[] = [
      { tradeId: "t1", netPnL: 10000 } as any,
      { tradeId: "t2", netPnL: -6000 } as any,
      { tradeId: "t3", netPnL: -2000 } as any,
    ];
    const stats = engine.calculateCoreStatistics(trades);
    expect(stats.maxDrawdown).toBe(8000);
  });

  test("14. Drawdown recovery", () => {
    const trades: GenuineTradeRecord[] = [
      { tradeId: "t1", netPnL: 10000 } as any,
      { tradeId: "t2", netPnL: -5000 } as any,
      { tradeId: "t3", netPnL: 10000 } as any,
    ];
    const stats = engine.calculateCoreStatistics(trades);
    expect(stats.recoveryFactor).toBe(3); // 15000 / 5000 = 3
  });

  test("15. Consecutive losses", () => {
    const trades: GenuineTradeRecord[] = [
      { tradeId: "t1", netPnL: 1000 } as any,
      { tradeId: "t2", netPnL: -500 } as any,
      { tradeId: "t3", netPnL: -400 } as any,
      { tradeId: "t4", netPnL: -300 } as any,
      { tradeId: "t5", netPnL: 1200 } as any,
    ];
    const stats = engine.calculateCoreStatistics(trades);
    expect(stats.maxConsecutiveLosses).toBe(3);
    expect(stats.maxConsecutiveWins).toBe(1);
  });

  test("16. P&L concentration", () => {
    const trades: GenuineTradeRecord[] = [
      { tradeId: "t1", netPnL: 5000 } as any,
      { tradeId: "t2", netPnL: 3000 } as any,
      { tradeId: "t3", netPnL: 2000 } as any,
    ];
    const conc = engine.calculateConcentrationAnalysis(trades);
    expect(conc.winnersConcentration.top1ContributionInr).toBe(5000);
    expect(conc.winnersConcentration.top1ContributionPct).toBe(50);
    expect(conc.winnersConcentration.top3ContributionPct).toBe(100);
  });

  test("17. Loss concentration", () => {
    const trades: GenuineTradeRecord[] = [
      { tradeId: "t1", netPnL: -4000 } as any,
      { tradeId: "t2", netPnL: -1000 } as any,
    ];
    const conc = engine.calculateConcentrationAnalysis(trades);
    expect(conc.losersConcentration.top1ContributionInr).toBe(4000);
    expect(conc.losersConcentration.top1ContributionPct).toBe(80);
  });

  test("18. Monte Carlo reproducibility", () => {
    const trades: GenuineTradeRecord[] = Array.from({ length: 30 }, (_, i) => ({
      tradeId: `t_${i}`,
      netPnL: i % 2 === 0 ? 1000 : -700,
    })) as any;

    const mc1 = engine.calculateMonteCarloDiagnostic(trades, 10000, 99);
    const mc2 = engine.calculateMonteCarloDiagnostic(trades, 10000, 99);

    expect(mc1.maxDrawdownDistribution.mean).toBe(mc2.maxDrawdownDistribution.mean);
    expect(mc1.finalPnlDistribution.mean).toBe(mc2.finalPnlDistribution.mean);
    expect(mc1.probabilityOfNegativeEndingPnlPct).toBe(mc2.probabilityOfNegativeEndingPnlPct);
  });

  test("19. Strategy fingerprint mismatch", () => {
    const engineWithOldFp = new Phase28StatisticalEvidenceEngine(store, ledger);
    // Simulate fingerprint change
    vi.spyOn(strategyFingerprintManager, "getCurrentFingerprint").mockReturnValue({
      masterFingerprintHash: "MODIFIED_HASH_999",
      version: "2.0.0-MODIFIED",
      parameters: {} as any,
      timestamp: new Date().toISOString(),
    });

    const report = engineWithOldFp.generateReport();
    expect(report.fingerprintStatus.fingerprintStatus).toBe("STRATEGY_CHANGED");
  });

  test("20. Strategy fingerprint unchanged", () => {
    const report = engine.generateReport();
    expect(report.fingerprintStatus.fingerprintStatus).toBe("VALIDATED");
  });

  test("21. Immutable source verification", () => {
    const t: GenuineTradeRecord = {
      tradeId: "trd_imm",
      sessionId: "sess_1",
      signalId: "sig_1",
      strategy: "BULL_PUT_SPREAD",
      regime: "BULLISH",
      entryTimestamp: "2026-10-05T10:00:00+05:30",
      entryTimestampIST: "2026-10-05T10:00:00+05:30",
      expiry: "2026-10-05",
      shortStrike: 24700,
      hedgeStrike: 24550,
      optionType: "PE",
      quantity: 75,
      entryCredit: 60,
      netPnL: 1000,
      brokerage: 40,
      STT: 10,
      exchangeCharges: 5,
      GST: 10,
      SEBICharges: 1,
      stampDuty: 2,
      slippage: 10,
      dataSource: "DHAN",
      priceSource: "DHAN",
      greeksSource: "REAL",
      lotSize: 75,
      genuineTrade: true,
      pnlType: "REAL_MARKET_DATA_PAPER_PNL",
      validationFlags: {
        realSpot: true,
        realOptionChain: true,
        realOptionPrices: true,
        dataNotStale: true,
        lotSizeVerified: true,
        marketSessionValid: true,
        safetyLocksValid: true,
        reconciliationPassed: true,
        antiHindsightPassed: true,
      },
    };

    store.recordTrade(t);
    const updated = { ...t, netPnL: 99999 };
    const res = store.recordTrade(updated);
    expect(res.netPnL).toBe(1000); // Immutable source protected
  });

  test("22. No simulated data contamination", () => {
    const sim: GenuineTradeRecord = {
      tradeId: "trd_sim",
      sessionId: "sess_1",
      signalId: "sig_sim",
      strategy: "BULL_PUT_SPREAD",
      regime: "BULLISH",
      entryTimestamp: "2026-10-05T10:00:00+05:30",
      entryTimestampIST: "2026-10-05T10:00:00+05:30",
      expiry: "2026-10-05",
      shortStrike: 24700,
      hedgeStrike: 24550,
      optionType: "PE",
      quantity: 75,
      entryCredit: 60,
      netPnL: 1000,
      brokerage: 0,
      STT: 0,
      exchangeCharges: 0,
      GST: 0,
      SEBICharges: 0,
      stampDuty: 0,
      slippage: 0,
      dataSource: "DHAN",
      priceSource: "DHAN",
      greeksSource: "REAL",
      lotSize: 75,
      genuineTrade: false,
      pnlType: "SIMULATED_TEST_PNL",
      validationFlags: {
        realSpot: true,
        realOptionChain: true,
        realOptionPrices: true,
        dataNotStale: true,
        lotSizeVerified: true,
        marketSessionValid: true,
        safetyLocksValid: true,
        reconciliationPassed: true,
        antiHindsightPassed: true,
      },
    };

    store.recordTrade(sim);
    const report = engine.generateReport();
    expect(report.coreStatistics.totalTrades).toBe(0);
    expect(report.exclusions.simulatedExcluded).toBe(1);
  });

  test("23. No synthetic data contamination", () => {
    const synth: GenuineTradeRecord = {
      tradeId: "trd_synth",
      sessionId: "sess_1",
      signalId: "sig_synth",
      strategy: "BULL_PUT_SPREAD",
      regime: "BULLISH",
      entryTimestamp: "2026-10-05T10:00:00+05:30",
      entryTimestampIST: "2026-10-05T10:00:00+05:30",
      expiry: "2026-10-05",
      shortStrike: 24700,
      hedgeStrike: 24550,
      optionType: "PE",
      quantity: 75,
      entryCredit: 60,
      netPnL: 1000,
      brokerage: 0,
      STT: 0,
      exchangeCharges: 0,
      GST: 0,
      SEBICharges: 0,
      stampDuty: 0,
      slippage: 0,
      dataSource: "SYNTHETIC",
      priceSource: "SYNTHETIC",
      greeksSource: "SYNTHETIC",
      lotSize: 75,
      genuineTrade: false,
      pnlType: "SYNTHETIC_PAPER_PNL",
      validationFlags: {
        realSpot: false,
        realOptionChain: false,
        realOptionPrices: false,
        dataNotStale: true,
        lotSizeVerified: true,
        marketSessionValid: true,
        safetyLocksValid: true,
        reconciliationPassed: true,
        antiHindsightPassed: true,
      },
    };

    store.recordTrade(synth);
    const report = engine.generateReport();
    expect(report.coreStatistics.totalTrades).toBe(0);
    expect(report.exclusions.syntheticExcluded).toBe(1);
  });

  test("24. No after-hours data contamination", () => {
    const ah: GenuineSessionRecord = {
      sessionId: "sess_ah",
      sessionDateIST: "2026-10-05",
      sessionStart: "2026-10-05T18:00:00+05:30",
      sessionEnd: "2026-10-05T19:00:00+05:30",
      timezone: "Asia/Kolkata",
      timestampUTC: "2026-10-05T12:30:00Z",
      timestampIST: "2026-10-05T18:00:00+05:30",
      provider: "DHAN",
      dataGate: "PASSED",
      marketSession: "MARKET_OPEN",
      spotSource: "DHAN",
      optionChainSource: "DHAN",
      optionPriceSource: "DHAN",
      greeksSource: "REAL",
      lotSizeSource: "DHAN_MASTER",
      expiry: "2026-10-05",
      websocketStatus: "HEALTHY",
      reconciliationStatus: "PASS",
      genuineSession: true,
      blockedReason: null,
      createdAt: "2026-10-05T18:00:00+05:30",
    };

    store.recordSession(ah);
    const report = engine.generateReport();
    expect(report.gateDetails.genuineSessions).toBe(0);
    expect(report.exclusions.afterHoursExcluded).toBe(1);
  });

  test("25. No fabricated statistics", () => {
    const report = engine.generateReport();
    expect(report.coreStatistics.totalTrades).toBe(0);
    expect(report.coreStatistics.winRate).toBe(0);
    expect(report.coreStatistics.profitFactor).toBe("NOT_AVAILABLE");
    expect(isNaN(report.coreStatistics.expectancy)).toBe(false);
  });

  test("26. Zero division handling", () => {
    const noLoss: GenuineTradeRecord[] = [
      { tradeId: "t1", grossPnL: 1000, netPnL: 900, brokerage: 0, STT: 0, exchangeCharges: 0, GST: 0, SEBICharges: 0, stampDuty: 0, slippage: 0 } as any,
    ];
    const stats = engine.calculateCoreStatistics(noLoss);
    expect(stats.profitFactor).toBe("NOT_AVAILABLE");
    expect(stats.winLossRatio).toBe("NOT_AVAILABLE");
  });

  test("27. Daily target analysis", () => {
    ledger.recordDailySession({ date: "2026-10-05", marketSession: "MARKET_OPEN", genuine: true, active: true, tradeCount: 1, grossPnL: 1200, charges: 100, slippage: 50, netPnL: 1050, wins: 1, losses: 0, noTrade: false, blockedSignals: 0, reconciliation: "PASS", dataQuality: "REAL", providerHealth: "CONNECTED" });
    const report = engine.generateReport();
    expect(report.dailyTargetAnalysis.daysAtOrAbove1000).toBe(1);
  });

  test("28. P&L reconciliation", () => {
    const auditReport = reconciliationEngine.runReconciliation();
    expect(auditReport.isSafe).toBe(true);
  });

  test("29. Crash/restart recovery", () => {
    const recovery = phase26EGenuineLivePaperValidationEngine.recoverStateAfterRestart();
    expect(recovery.reconciliationStatus).toBe("PASS");
  });

  test("30. LIVE_TRADING remains false", () => {
    expect(process.env.LIVE_TRADING).toBe("false");
    expect(process.env.PAPER_TRADING).toBe("true");
  });

  test("31. Broker execution remains blocked", async () => {
    const req = { symbol: "NIFTY24700CE", side: "BUY" as const, type: "MARKET" as const, quantity: 75 };
    await expect(dhanBrokerAdapter.placeOrder(req)).rejects.toThrow("SECURITY LOCK ENFORCED");
  });

  test("32. Zero real broker orders", () => {
    expect(dhanBrokerAdapter.getRealOrdersSent()).toBe(0);
  });
});
