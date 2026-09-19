import { describe, it, expect, beforeEach } from "vitest";
import { strategyFingerprintManager } from "../validation/StrategyFingerprintManager";
import { extendedStatisticalValidationEngine } from "../validation/ExtendedStatisticalValidationEngine";
import { paperSampleSimulator } from "../validation/PaperSampleSimulator";
import { NiftySpreadPosition, PaperSessionRecord } from "../types";

describe("Phase 14 — Extended Paper Trading & Statistical Validation Test Suite", () => {
  beforeEach(() => {
    // Reset or ensure baseline
  });

  it("1. Configuration Fingerprinting & Cohort Isolation", () => {
    const baselineFp = strategyFingerprintManager.getCurrentFingerprint();
    expect(baselineFp.version).toBe("1.0.0-NIFTY-MASTER");
    expect(baselineFp.masterFingerprintHash).toBeDefined();
    expect(baselineFp.masterFingerprintHash.length).toBe(64); // SHA-256

    const activeCohort = strategyFingerprintManager.getActiveCohort();
    expect(activeCohort.cohortId).toContain("COHORT_A");
    expect(activeCohort.isActive).toBe(true);

    // Modify strategy parameters to trigger new cohort creation
    const updateResult = strategyFingerprintManager.updateConfig({ rsiLowerThreshold: 40 });
    expect(updateResult.configChanged).toBe(true);
    expect(updateResult.activeCohort.cohortId).toContain("COHORT_B");
    expect(updateResult.activeCohort.isActive).toBe(true);

    // Revert config back to baseline
    strategyFingerprintManager.updateConfig({ rsiLowerThreshold: 45 });
  });

  it("2. Validation Gate Evaluation (Sample Requirements Gate)", () => {
    // Test insufficient sample case (e.g. 5 sessions, 8 trades)
    const smallSim = paperSampleSimulator.generateSampleDataset({ sessionsCount: 5, winRatePct: 75, tradesPerSession: 1.6 });
    const smallReport = extendedStatisticalValidationEngine.generateExtendedReport(smallSim.sessions, smallSim.trades);

    expect(smallReport.scorecard.sampleRequirements.sessionsMet).toBe(false);
    expect(smallReport.scorecard.sampleRequirements.tradesMet).toBe(false);
    expect(smallReport.scorecard.validationStatus).toBe("IN PROGRESS");
    expect(smallReport.scorecard.passStatus).toBe("VALIDATION INCOMPLETE");

    // Test sufficient sample case (22 sessions, 33 trades, 18 active sessions)
    const largeSim = paperSampleSimulator.generateSampleDataset({ sessionsCount: 22, winRatePct: 75, tradesPerSession: 1.5 });
    const largeReport = extendedStatisticalValidationEngine.generateExtendedReport(largeSim.sessions, largeSim.trades);

    expect(largeReport.scorecard.sampleRequirements.sessionsMet).toBe(true);
    expect(largeReport.scorecard.sampleRequirements.tradesMet).toBe(true);
    expect(largeReport.scorecard.sampleRequirements.activeSessionsMet).toBe(true);
    expect(largeReport.scorecard.validationStatus).toBe("SAMPLE REQUIREMENTS MET");
    expect(largeReport.scorecard.passStatus).toBe("VALIDATION COMPLETE");
  });

  it("3. Rolling Stability Window Metrics (10, 20, 30 trades)", () => {
    const sim = paperSampleSimulator.generateSampleDataset({ sessionsCount: 25, winRatePct: 80, tradesPerSession: 1.5 });
    const report = extendedStatisticalValidationEngine.generateExtendedReport(sim.sessions, sim.trades);

    const rolling = report.rollingMetrics;
    expect(rolling.length).toBe(3);

    const r10 = rolling.find((r) => r.windowSize === 10);
    const r20 = rolling.find((r) => r.windowSize === 20);
    const r30 = rolling.find((r) => r.windowSize === 30);

    expect(r10).toBeDefined();
    expect(r10?.tradeCount).toBe(10);
    expect(r10?.winRatePct).toBeGreaterThan(0);

    expect(r20).toBeDefined();
    expect(r20?.tradeCount).toBe(20);

    expect(r30).toBeDefined();
    expect(r30?.tradeCount).toBeGreaterThan(0);
  });

  it("4. Max Loss Violations Audit (Max Loss <= ₹1,000)", () => {
    const sim = paperSampleSimulator.generateSampleDataset({ sessionsCount: 20, winRatePct: 70, tradesPerSession: 1.5 });

    // Inject a bad trade violating Max Loss (e.g. ₹1,500 loss)
    const badTrade: NiftySpreadPosition = {
      ...sim.trades[0],
      id: "violating_trade_1",
      realizedNetPnl: -1500,
      maxLoss: 1500,
    };
    sim.trades.push(badTrade);

    const report = extendedStatisticalValidationEngine.generateExtendedReport(sim.sessions, sim.trades);
    expect(report.scorecard.riskViolations.maxLossViolationsCount).toBe(1);
    expect(report.scorecard.validationStatus).toBe("VALIDATION FAILED");
    expect(report.scorecard.passStatus).toBe("VALIDATION INCOMPLETE");
  });

  it("5. ₹1,000 Daily Target & NET P&L Distribution Analysis", () => {
    const sim = paperSampleSimulator.generateSampleDataset({ sessionsCount: 22, winRatePct: 75, tradesPerSession: 1.5 });
    const report = extendedStatisticalValidationEngine.generateExtendedReport(sim.sessions, sim.trades);

    const daily = report.dailyPerformance;
    expect(daily.dailyStats.length).toBe(22);
    expect(daily.averageDailyNet).toBeDefined();
    expect(daily.stdDevDailyNet).toBeGreaterThanOrEqual(0);

    const target = report.targetAnalysis1000;
    expect(target.daysNetAbove1000 + target.daysNetBelow1000 + target.daysNetNegative + target.noTradeDays).toBe(22);
  });

  it("6. Strategy, Market Regime, & Exit Reason Breakdowns", () => {
    const sim = paperSampleSimulator.generateSampleDataset({ sessionsCount: 22, winRatePct: 75, tradesPerSession: 1.5 });
    const report = extendedStatisticalValidationEngine.generateExtendedReport(sim.sessions, sim.trades);

    expect(report.strategyBreakdown.length).toBe(3); // Bull Put, Bear Call, Iron Condor
    expect(report.regimeBreakdown.length).toBe(6); // Bullish, Bearish, Range, High Vol, Event Risk, Unclear
    expect(report.exitAnalysis.length).toBeGreaterThan(0);
  });

  it("7. Zero Duplicate Order / Trade / Exit & Safety Lock Integrity", () => {
    const sim = paperSampleSimulator.generateSampleDataset({ sessionsCount: 22, winRatePct: 75, tradesPerSession: 1.5 });
    const report = extendedStatisticalValidationEngine.generateExtendedReport(sim.sessions, sim.trades);

    const scorecard = report.scorecard;
    expect(scorecard.executionAnomalies.duplicateOrders).toBe(0);
    expect(scorecard.executionAnomalies.duplicateTrades).toBe(0);
    expect(scorecard.executionAnomalies.duplicateExits).toBe(0);

    expect(scorecard.safetyLocks.paperTradingEnabled).toBe(true);
    expect(scorecard.safetyLocks.liveTradingLocked).toBe(true);
    expect(scorecard.safetyLocks.brokerExecutionDisabled).toBe(true);
  });

  it("8. Pass Conditions Evaluator (VALIDATION COMPLETE vs INCOMPLETE)", () => {
    const sim = paperSampleSimulator.generateSampleDataset({ sessionsCount: 22, winRatePct: 75, tradesPerSession: 1.5 });
    const report = extendedStatisticalValidationEngine.generateExtendedReport(sim.sessions, sim.trades);

    expect(report.scorecard.passStatus).toBe("VALIDATION COMPLETE");
    expect(report.scorecard.validationStatus).toBe("SAMPLE REQUIREMENTS MET");
  });
});
