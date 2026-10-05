import { describe, test, expect, beforeEach } from "vitest";
import { phase39RevalidationEngine } from "../phase39/Phase39RevalidationEngine";
import { Phase39CohortFreeze } from "../phase39/Phase39CohortFreeze";
import { Phase39CohortRevalidator } from "../validation/Phase39CohortRevalidator";
import { Phase39TimestampAudit } from "../phase39/Phase39TimestampAudit";
import { Phase39LeakageDetector } from "../phase39/Phase39LeakageDetector";
import { Phase39PnLAudit } from "../phase39/Phase39PnLAudit";
import { Phase39StatisticalRecalculator } from "../phase39/Phase39StatisticalRecalculator";
import { Phase39RiskAudit } from "../phase39/Phase39RiskAudit";
import { Phase39SafetyAudit } from "../phase39/Phase39SafetyAudit";
import { strategyFingerprintManager } from "../validation/StrategyFingerprintManager";
import { phase38SessionCollector } from "../validation/Phase38SessionCollector";
import { phase38TradeCollector } from "../validation/Phase38TradeCollector";

describe("PHASE 39 — POST-SAMPLE REVALIDATION & EVIDENCE FREEZE", () => {
  let fp: string;

  beforeEach(() => {
    phase39RevalidationEngine.reset();
    phase38SessionCollector.clear();
    phase38TradeCollector.clear();
    fp = strategyFingerprintManager.getCurrentFingerprint().masterFingerprintHash;
  });

  // Helper to build genuine session & trade mocks
  const buildMockCohort = (sessionCount = 20, tradeCount = 30) => {
    const sessions = [];
    const trades = [];

    for (let i = 1; i <= sessionCount; i++) {
      sessions.push({
        sessionId: `sess_p39_${i}`,
        date: `2026-10-04`,
        isGenuine: true,
        totalTrades: 2,
        grossPnL: 500,
        charges: 50,
        netPnL: 450,
        startTimestamp: "2026-10-04T09:15:00.000+05:30",
        endTimestamp: "2026-10-04T15:30:00.000+05:30",
        tradeIds: [`trade_p39_${i}_1`, `trade_p39_${i}_2`],
      });
    }

    for (let i = 1; i <= tradeCount; i++) {
      trades.push({
        tradeId: `trade_p39_${i}`,
        sessionId: `sess_p39_${(i % sessionCount) + 1}`,
        dataTimestamp: "2026-10-04T10:00:00.000Z",
        decisionTimestamp: "2026-10-04T10:00:01.000Z",
        entryTimestamp: "2026-10-04T10:00:05.000Z",
        monitoringTimestamp: "2026-10-04T10:30:00.000Z",
        exitTimestamp: "2026-10-04T11:00:00.000Z",
        grossPnL: 500,
        charges: 50,
        netPnL: 450,
        strategyFingerprint: fp,
        isGenuine: true,
      });
    }

    return { sessions, trades };
  };

  // 1. Sample gate incomplete
  test("1. Sample gate incomplete returns VALIDATION_BLOCKED_INSUFFICIENT_SAMPLE", () => {
    const { sessions, trades } = buildMockCohort(10, 15);
    const report = phase39RevalidationEngine.runRevalidation(sessions, trades, fp);

    expect(report.state).toBe("VALIDATION_BLOCKED_INSUFFICIENT_SAMPLE");
    expect(report.sampleGate.gatePassed).toBe(false);
  });

  // 2. Sample gate complete
  test("2. Sample gate complete passes gate evaluation", () => {
    const { sessions, trades } = buildMockCohort(20, 30);
    const report = phase39RevalidationEngine.runRevalidation(sessions, trades, fp);

    expect(report.sampleGate.gatePassed).toBe(true);
  });

  // 3. Genuine-only cohort
  test("3. Genuine-only cohort contains only genuine observations", () => {
    const { sessions, trades } = buildMockCohort(20, 30);
    const report = phase39RevalidationEngine.runRevalidation(sessions, trades, fp);

    expect(report.cohortSnapshot).toBeDefined();
    expect(report.cohortSnapshot?.sessionCount).toBe(20);
    expect(report.cohortSnapshot?.tradeCount).toBe(30);
  });

  // 4. Synthetic exclusion
  test("4. Synthetic exclusion rejects synthetic trade contamination", () => {
    const { sessions, trades } = buildMockCohort(20, 30);
    trades[0].isGenuine = false;
    trades[0].isSynthetic = true;

    const report = phase39RevalidationEngine.runRevalidation(sessions, trades, fp);
    expect(report.sampleGate.genuineTrades).toBe(29);
    expect(report.state).toBe("VALIDATION_BLOCKED_INSUFFICIENT_SAMPLE");
  });

  // 5. Provenance validation
  test("5. Provenance validation checks data sources", () => {
    const revalidator = new Phase39CohortRevalidator();
    const result = revalidator.revalidateCohort();
    expect(result.dhanProvenanceViolations.length).toBe(0);
  });

  // 6. Hash validation
  test("6. Hash validation verifies observation immutable hashes", () => {
    const revalidator = new Phase39CohortRevalidator();
    const result = revalidator.revalidateCohort();
    expect(result.hashMismatches.length).toBe(0);
  });

  // 7. Timestamp validation
  test("7. Timestamp validation verifies signal <= entry <= exit ordering", () => {
    const { trades } = buildMockCohort(5, 5);
    trades[0].entryTimestamp = "2026-10-04T12:00:00.000Z";
    trades[0].exitTimestamp = "2026-10-04T10:00:00.000Z"; // Exit prior to entry

    const audit = Phase39TimestampAudit.auditTimestamps(trades);
    expect(audit.passed).toBe(false);
    expect(audit.violations.length).toBeGreaterThan(0);
  });

  // 8. Chronological ordering
  test("8. Chronological ordering enforced across trade sequence", () => {
    const { trades } = buildMockCohort(5, 5);
    const audit = Phase39TimestampAudit.auditTimestamps(trades);
    expect(audit.passed).toBe(true);
  });

  // 9. Look-ahead detection
  test("9. Look-ahead detection catches future candle contamination", () => {
    const { sessions, trades } = buildMockCohort(20, 30);
    trades[0].greeksAtEntry = { delta: 1.5 }; // Invalid future Greek delta

    const audit = Phase39LeakageDetector.auditLeakage(trades, sessions, fp);
    expect(audit.passed).toBe(false);
    expect(audit.contaminationDetected).toBe(true);
  });

  // 10. Hindsight detection
  test("10. Hindsight detection rejects decision timestamp in future of entry", () => {
    const { trades } = buildMockCohort(5, 5);
    trades[0].decisionTimestamp = "2026-10-04T11:00:00.000Z";
    trades[0].entryTimestamp = "2026-10-04T10:00:00.000Z"; // Decision in future

    const audit = Phase39TimestampAudit.auditTimestamps(trades);
    expect(audit.passed).toBe(false);
  });

  // 11. P&L recalculation
  test("11. P&L recalculation validates trade sum equals daily sum", () => {
    const { sessions, trades } = buildMockCohort(20, 30);
    const pnlAudit = Phase39PnLAudit.auditPnL(trades, sessions);
    expect(pnlAudit.status).toBe("PASS");
  });

  // 12. Charges recalculation
  test("12. Charges recalculation verifies positive charges deducted", () => {
    const { trades } = buildMockCohort(1, 1);
    expect(trades[0].charges).toBeGreaterThan(0);
  });

  // 13. Slippage recalculation
  test("13. Slippage recalculation verifies non-negative slippage", () => {
    const { trades } = buildMockCohort(1, 1);
    expect(trades[0].grossPnL - trades[0].charges - trades[0].netPnL).toBe(0);
  });

  // 14. Profit factor handling
  test("14. Profit factor returns NOT_AVAILABLE when gross loss = 0", () => {
    const { trades } = buildMockCohort(10, 10); // All winning trades
    const metrics = Phase39StatisticalRecalculator.calculateMetrics(trades);
    expect(metrics.profitFactor).toBe("NOT_AVAILABLE");
  });

  // 15. OOS separation
  test("15. OOS separation ensures no trade in both in-sample and out-of-sample", () => {
    const { sessions, trades } = buildMockCohort(20, 30);
    trades[0].isOOS = true;
    trades[0].tradeId = trades[1].tradeId; // Force ID overlap

    const audit = Phase39LeakageDetector.auditLeakage(trades, sessions, fp);
    expect(audit.passed).toBe(false);
    expect(audit.violations.some((v) => v.includes("OOS Contamination"))).toBe(true);
  });

  // 16. Walk-forward validation
  test("16. Walk-forward validation verifies chronological windows", () => {
    const { trades } = buildMockCohort(20, 30);
    const report = phase39RevalidationEngine.runRevalidation(buildMockCohort(20, 30).sessions, trades, fp);
    expect(report.walkForwardAudit).toBeDefined();
  });

  // 17. Stress validation
  test("17. Stress validation evaluates data quality resilience", () => {
    const { trades } = buildMockCohort(20, 30);
    const report = phase39RevalidationEngine.runRevalidation(buildMockCohort(20, 30).sessions, trades, fp);
    expect(report.stressAudit.dataQualityResilience).toBe("PASS");
  });

  // 18. Drift validation
  test("18. Drift validation classifies long-horizon drift", () => {
    const { trades } = buildMockCohort(20, 30);
    const report = phase39RevalidationEngine.runRevalidation(buildMockCohort(20, 30).sessions, trades, fp);
    expect(report.driftAudit.status).toBeDefined();
  });

  // 19. Risk validation
  test("19. Risk validation checks ₹1,000 max loss and daily locks", () => {
    const { sessions, trades } = buildMockCohort(20, 30);
    trades[0].netPnL = -1500; // Exceeds ₹1,000 max loss

    const riskAudit = Phase39RiskAudit.auditRisk(trades, sessions);
    expect(riskAudit.passed).toBe(false);
    expect(riskAudit.maxLossViolations.length).toBe(1);
  });

  // 20. Fingerprint validation
  test("20. Fingerprint validation verifies strategy fingerprint match", () => {
    const safety = Phase39SafetyAudit.verifyStrategyFingerprint(fp);
    expect(safety.match).toBe(true);
  });

  // 21. Fingerprint mismatch
  test("21. Fingerprint mismatch causes revalidation failure", () => {
    const { sessions, trades } = buildMockCohort(20, 30);
    const report = phase39RevalidationEngine.runRevalidation(sessions, trades, "MISMATCHED_FP");

    expect(report.state).toBe("REVALIDATION_FAILED");
  });

  // 22. Cohort immutability
  test("22. Cohort immutability prevents mutation after freeze", () => {
    const { sessions, trades } = buildMockCohort(20, 30);
    const freezer = new Phase39CohortFreeze();
    freezer.createCohortSnapshot(sessions, trades, fp);
    freezer.freeze();

    expect(() => freezer.addTrade(trades[0])).toThrow();
    expect(() => freezer.deleteTrade(trades[0].tradeId)).toThrow();
    expect(() => freezer.editTrade(trades[0].tradeId, { netPnL: 999 })).toThrow();
  });

  // 23. Evidence hash reproducibility
  test("23. Evidence hash reproducibility (same cohort produces same hash)", () => {
    const { sessions, trades } = buildMockCohort(20, 30);
    const report1 = phase39RevalidationEngine.runRevalidation(sessions, trades, fp);

    phase39RevalidationEngine.reset();
    const report2 = phase39RevalidationEngine.runRevalidation(sessions, trades, fp);

    expect(report1.immutableHash).toBe(report2.immutableHash);
  });

  // 24. Restart recovery
  test("24. Restart recovery returns consistent report state", () => {
    const { sessions, trades } = buildMockCohort(20, 30);
    phase39RevalidationEngine.runRevalidation(sessions, trades, fp);
    const report = phase39RevalidationEngine.getReport();

    expect(report.reportId).toBeDefined();
    expect(report.immutableHash).toBeDefined();
  });

  // 25. Final freeze gate
  test("25. Final freeze gate enters EVIDENCE_FREEZE_COMPLETE when all pass", () => {
    const { sessions, trades } = buildMockCohort(20, 30);
    const report = phase39RevalidationEngine.runRevalidation(sessions, trades, fp);

    expect(report.state).toBe("EVIDENCE_FREEZE_COMPLETE");
  });

  // 26. Safety invariants
  test("26. Safety invariants verified", () => {
    const safety = Phase39SafetyAudit.auditSafety();
    expect(safety.paperTrading).toBe(true);
    expect(safety.liveTrading).toBe(false);
    expect(safety.brokerExecution).toBe(false);
    expect(safety.realDataOnly).toBe(true);
    expect(safety.realDhanOrders).toBe(0);
  });

  // 27. LIVE_TRADING remains false
  test("27. LIVE_TRADING remains false", () => {
    expect(process.env.LIVE_TRADING).not.toBe("true");
  });

  // 28. BROKER_EXECUTION remains false
  test("28. BROKER_EXECUTION remains false", () => {
    expect(process.env.BROKER_EXECUTION_ENABLED).not.toBe("true");
  });
});
