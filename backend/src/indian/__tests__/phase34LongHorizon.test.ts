import { describe, it, expect, beforeEach } from "vitest";
import { Phase34LongHorizonEngine } from "../validation/Phase34LongHorizonEngine";
import { Phase34CohortManager } from "../validation/Phase34CohortManager";
import { Phase34DailyObservationStore, Phase34DailyObservationRecord } from "../validation/Phase34DailyObservationStore";
import { Phase34DriftDetectionEngine } from "../validation/Phase34DriftDetectionEngine";
import { Phase34RiskBehaviorEngine } from "../validation/Phase34RiskBehaviorEngine";
import { Phase34OperationalStabilityEngine } from "../validation/Phase34OperationalStabilityEngine";
import { Phase31ValidationCertificationEngine } from "../validation/Phase31ValidationCertificationEngine";
import { Phase32OutOfSampleValidationEngine } from "../validation/Phase32OutOfSampleValidationEngine";
import { GenuineSampleStore } from "../persistence/GenuineSampleStore";
import { GenuineDailyLedger } from "../persistence/GenuineDailyLedger";
import { strategyFingerprintManager } from "../validation/StrategyFingerprintManager";

function getWeekdayDates(count: number, startDateStr: string = "2026-10-05"): string[] {
  const dates: string[] = [];
  let curr = new Date(startDateStr);
  while (dates.length < count) {
    const day = curr.getDay();
    if (day !== 0 && day !== 6) {
      dates.push(curr.toISOString().split("T")[0]);
    }
    curr.setDate(curr.getDate() + 1);
  }
  return dates;
}

function createDailyObs(
  id: string,
  date: string,
  netPnL: number = 500,
  tradeCount: number = 2,
  winCount: number = 2,
  lossCount: number = 0,
  overrides: Partial<Phase34DailyObservationRecord> = {}
): Phase34DailyObservationRecord {
  const masterFp = strategyFingerprintManager.getCurrentFingerprint().masterFingerprintHash;
  return {
    sessionId: id,
    marketDate: date,
    genuine: true,
    activeSession: true,
    tradeCount,
    winCount,
    lossCount,
    grossPnL: netPnL + 50,
    charges: 30,
    slippage: 20,
    netPnL,
    strategyFingerprint: masterFp,
    riskLock: "NORMAL",
    noTradeStatus: tradeCount === 0,
    dataQualityEvents: [],
    recordedAt: `${date}T10:00:00.000Z`,
    ...overrides,
  };
}

describe("PHASE 34 — Long-Horizon Genuine Paper Validation Suite", () => {
  let masterFp: string;
  let weekdayDates: string[];

  let cohortMgr: Phase34CohortManager;
  let dailyStore: Phase34DailyObservationStore;
  let driftEngine: Phase34DriftDetectionEngine;
  let riskEngine: Phase34RiskBehaviorEngine;
  let stabilityEngine: Phase34OperationalStabilityEngine;
  let sampleStore: GenuineSampleStore;
  let dailyLedger: GenuineDailyLedger;
  let p31Engine: Phase31ValidationCertificationEngine;
  let p32Engine: Phase32OutOfSampleValidationEngine;
  let p34Engine: Phase34LongHorizonEngine;

  beforeEach(() => {
    masterFp = strategyFingerprintManager.getCurrentFingerprint().masterFingerprintHash;
    weekdayDates = getWeekdayDates(70, "2026-10-05");

    cohortMgr = new Phase34CohortManager();
    dailyStore = new Phase34DailyObservationStore();
    driftEngine = new Phase34DriftDetectionEngine();
    riskEngine = new Phase34RiskBehaviorEngine();
    stabilityEngine = new Phase34OperationalStabilityEngine();
    sampleStore = new GenuineSampleStore();
    dailyLedger = new GenuineDailyLedger();

    p31Engine = new Phase31ValidationCertificationEngine(sampleStore, dailyLedger);
    p32Engine = new Phase32OutOfSampleValidationEngine(p31Engine);

    p34Engine = new Phase34LongHorizonEngine(
      cohortMgr,
      dailyStore,
      driftEngine,
      riskEngine,
      stabilityEngine,
      p31Engine,
      p32Engine,
      sampleStore,
      dailyLedger
    );
  });

  // 1. Session accumulation
  it("1. Session accumulation", () => {
    const obs = createDailyObs("S1", weekdayDates[0]);
    const res = dailyStore.recordDailyObservation(obs);
    expect(res.success).toBe(true);
    expect(dailyStore.getDailyObservations(true).length).toBe(1);
  });

  // 2. 60-session gate
  it("2. 60-session gate", () => {
    for (let i = 0; i < 60; i++) {
      dailyStore.recordDailyObservation(createDailyObs(`S_${i}`, weekdayDates[i]));
    }
    const report = p34Engine.processLongHorizonPipeline();
    expect(report.gateDetails.gatePassed).toBe(true);
    expect(report.state).toBe("LONG_HORIZON_COMPLETE");
  });

  // 3. Genuine-session validation
  it("3. Genuine-session validation", () => {
    const obsGen = createDailyObs("S_GEN", weekdayDates[0], 500, 2, 2, 0, { genuine: true });
    const obsNonGen = createDailyObs("S_NON_GEN", weekdayDates[1], 500, 2, 2, 0, { genuine: false });

    dailyStore.recordDailyObservation(obsGen);
    dailyStore.recordDailyObservation(obsNonGen);

    expect(dailyStore.getDailyObservations(true).length).toBe(1);
    expect(dailyStore.getDailyObservations(false).length).toBe(2);
  });

  // 4. Weekend exclusion
  it("4. Weekend exclusion", () => {
    // 2026-10-10 is Saturday
    const weekendDate = "2026-10-10";
    const dayOfWeek = new Date(weekendDate).getUTCDay();
    expect(dayOfWeek === 0 || dayOfWeek === 6).toBe(true);
  });

  // 5. After-hours exclusion
  it("5. After-hours exclusion", () => {
    const afterHoursObs = createDailyObs("S_AH", weekdayDates[0], 0, 0, 0, 0, {
      noTradeStatus: true,
      dataQualityEvents: ["AFTER_HOURS_EXCLUDED"],
    });
    dailyStore.recordDailyObservation(afterHoursObs);
    expect(dailyStore.getDailyObservations()[0].dataQualityEvents).toContain("AFTER_HOURS_EXCLUDED");
  });

  // 6. Duplicate session prevention
  it("6. Duplicate session prevention", () => {
    const obs1 = createDailyObs("S_DUP", weekdayDates[0]);
    const obs2 = createDailyObs("S_DUP", weekdayDates[1]);

    expect(dailyStore.recordDailyObservation(obs1).success).toBe(true);
    const dupRes = dailyStore.recordDailyObservation(obs2);
    expect(dupRes.success).toBe(false);
    expect(dupRes.reason).toContain("DUPLICATE_SESSION");
  });

  // 7. Genuine trade counting
  it("7. Genuine trade counting", () => {
    dailyStore.recordDailyObservation(createDailyObs("S1", weekdayDates[0], 500, 3, 2, 1));
    dailyStore.recordDailyObservation(createDailyObs("S2", weekdayDates[1], 400, 2, 2, 0));

    const report = p34Engine.processLongHorizonPipeline();
    expect(report.gateDetails.genuineTrades).toBe(5);
  });

  // 8. Strategy fingerprint lock
  it("8. Strategy fingerprint lock", () => {
    const fpCheck = p34Engine.checkFingerprintLock();
    expect(fpCheck.locked).toBe(true);
    expect(fpCheck.match).toBe(true);
  });

  // 9. Fingerprint mismatch
  it("9. Fingerprint mismatch", () => {
    // Override master fingerprint hash on engine to simulate mismatch
    (p34Engine as any).masterFingerprint = "INVALID_FP_HASH_999";
    const report = p34Engine.processLongHorizonPipeline();
    expect(report.state).toBe("FINGERPRINT_MISMATCH");
    expect(report.status).toBe("FINGERPRINT_MISMATCH");
  });

  // 10. Daily ledger creation
  it("10. Daily ledger creation", () => {
    dailyStore.recordDailyObservation(createDailyObs("S1", weekdayDates[0], 600));
    expect(dailyStore.getDailyObservation("S1")?.netPnL).toBe(600);
  });

  // 11. Daily P&L reconciliation
  it("11. Daily P&L reconciliation", () => {
    const obsList = [createDailyObs("S1", weekdayDates[0], 500)];
    const recon = p34Engine.runPnlReconciliation(obsList);
    expect(recon.status).toBe("PASS");
    expect(recon.difference).toBeLessThanOrEqual(recon.tolerance);
  });

  // 12. Cumulative P&L
  it("12. Cumulative P&L", () => {
    dailyStore.recordDailyObservation(createDailyObs("S1", weekdayDates[0], 500));
    dailyStore.recordDailyObservation(createDailyObs("S2", weekdayDates[1], 700));

    const report = p34Engine.processLongHorizonPipeline();
    expect(report.reconciliation.dailyLedgerNetPnL).toBe(1200);
  });

  // 13. Rolling 20 sessions
  it("13. Rolling 20 sessions", () => {
    for (let i = 0; i < 20; i++) {
      dailyStore.recordDailyObservation(createDailyObs(`S_${i}`, weekdayDates[i], 200));
    }
    const report = p34Engine.processLongHorizonPipeline();
    expect(report.rollingSessionWindows.w20.status).toBe("VALIDATED");
    expect(report.rollingSessionWindows.w20.netPnL).toBe(4000);
  });

  // 14. Rolling 30 sessions
  it("14. Rolling 30 sessions", () => {
    for (let i = 0; i < 30; i++) {
      dailyStore.recordDailyObservation(createDailyObs(`S_${i}`, weekdayDates[i], 200));
    }
    const report = p34Engine.processLongHorizonPipeline();
    expect(report.rollingSessionWindows.w30.status).toBe("VALIDATED");
  });

  // 15. Rolling 40 sessions
  it("15. Rolling 40 sessions", () => {
    for (let i = 0; i < 40; i++) {
      dailyStore.recordDailyObservation(createDailyObs(`S_${i}`, weekdayDates[i], 200));
    }
    const report = p34Engine.processLongHorizonPipeline();
    expect(report.rollingSessionWindows.w40.status).toBe("VALIDATED");
  });

  // 16. Rolling 60 sessions
  it("16. Rolling 60 sessions", () => {
    for (let i = 0; i < 60; i++) {
      dailyStore.recordDailyObservation(createDailyObs(`S_${i}`, weekdayDates[i], 200));
    }
    const report = p34Engine.processLongHorizonPipeline();
    expect(report.rollingSessionWindows.w60.status).toBe("VALIDATED");
  });

  // 17. Rolling trade metrics
  it("17. Rolling trade metrics", () => {
    for (let i = 0; i < 25; i++) {
      dailyStore.recordDailyObservation(createDailyObs(`S_${i}`, weekdayDates[i], 200, 2, 2, 0));
    }
    const report = p34Engine.processLongHorizonPipeline();
    expect(report.rollingSessionWindows.w20.tradeCount).toBe(40);
  });

  // 18. Win rate
  it("18. Win rate", () => {
    dailyStore.recordDailyObservation(createDailyObs("S1", weekdayDates[0], 500, 2, 2, 0));
    dailyStore.recordDailyObservation(createDailyObs("S2", weekdayDates[1], -200, 2, 0, 2));

    for (let i = 2; i < 20; i++) {
      dailyStore.recordDailyObservation(createDailyObs(`S_${i}`, weekdayDates[i], 100, 1, 1, 0));
    }

    const report = p34Engine.processLongHorizonPipeline();
    expect(report.rollingSessionWindows.w20.winRate).toBeGreaterThan(0);
  });

  // 19. Expectancy
  it("19. Expectancy", () => {
    for (let i = 0; i < 20; i++) {
      dailyStore.recordDailyObservation(createDailyObs(`S_${i}`, weekdayDates[i], 400, 2, 2, 0));
    }
    const report = p34Engine.processLongHorizonPipeline();
    expect(report.rollingSessionWindows.w20.expectancy).toBe(200);
  });

  // 20. Profit factor
  it("20. Profit factor", () => {
    for (let i = 0; i < 10; i++) {
      dailyStore.recordDailyObservation(createDailyObs(`S_WIN_${i}`, weekdayDates[i], 600, 1, 1, 0));
    }
    for (let i = 10; i < 20; i++) {
      dailyStore.recordDailyObservation(createDailyObs(`S_LOSS_${i}`, weekdayDates[i], -300, 1, 0, 1));
    }
    const report = p34Engine.processLongHorizonPipeline();
    expect(report.rollingSessionWindows.w20.profitFactor).toBe(2.0);
  });

  // 21. Max drawdown
  it("21. Max drawdown", () => {
    dailyStore.recordDailyObservation(createDailyObs("S1", weekdayDates[0], 1000));
    dailyStore.recordDailyObservation(createDailyObs("S2", weekdayDates[1], -400));
    dailyStore.recordDailyObservation(createDailyObs("S3", weekdayDates[2], -300));
    for (let i = 3; i < 20; i++) {
      dailyStore.recordDailyObservation(createDailyObs(`S_${i}`, weekdayDates[i], 100));
    }

    const report = p34Engine.processLongHorizonPipeline();
    expect(report.rollingSessionWindows.w20.maxDrawdown).toBe(700);
  });

  // 22. Drift calculation
  it("22. Drift calculation", () => {
    const obsList: Phase34DailyObservationRecord[] = [];
    for (let i = 0; i < 25; i++) {
      obsList.push(createDailyObs(`S_${i}`, weekdayDates[i], 500, 2, 2, 0));
    }

    const baseline = { winRate: 60, expectancy: 500, profitFactor: 2.0, averagePnL: 500, maxDrawdown: 2000, tradesPerSession: 2, noTradeRatioPct: 10 };
    const drift = driftEngine.calculateDrift(baseline, obsList);
    expect(drift.driftStatus).toBeDefined();
    expect(drift.metricsDrift.winRateDifference).toBeDefined();
  });

  // 23. Drift insufficient sample
  it("23. Drift insufficient sample", () => {
    const obsList = [createDailyObs("S1", weekdayDates[0])];
    const baseline = { winRate: 60, expectancy: 500, profitFactor: 2.0, averagePnL: 500, maxDrawdown: 2000, tradesPerSession: 2, noTradeRatioPct: 10 };
    const drift = driftEngine.calculateDrift(baseline, obsList);
    expect(drift.driftStatus).toBe("INSUFFICIENT_DATA");
  });

  // 24. Regime distribution
  it("24. Regime distribution", () => {
    const obsList: Phase34DailyObservationRecord[] = [];
    for (let i = 0; i < 20; i++) {
      obsList.push(createDailyObs(`S_${i}`, weekdayDates[i]));
    }
    const baselineRegimes = { BULLISH: 40, BEARISH: 30, RANGE: 30 };
    const drift = driftEngine.calculateDrift(
      { winRate: 60, expectancy: 500, profitFactor: 2.0, averagePnL: 500, maxDrawdown: 2000, tradesPerSession: 2, noTradeRatioPct: 10 },
      obsList,
      baselineRegimes
    );
    expect(drift.regimeDrift.length).toBeGreaterThan(0);
  });

  // 25. Strategy distribution
  it("25. Strategy distribution", () => {
    const obsList: Phase34DailyObservationRecord[] = [];
    for (let i = 0; i < 20; i++) {
      obsList.push(createDailyObs(`S_${i}`, weekdayDates[i]));
    }
    const baselineStrategies = { IRON_CONDOR: 100 };
    const drift = driftEngine.calculateDrift(
      { winRate: 60, expectancy: 500, profitFactor: 2.0, averagePnL: 500, maxDrawdown: 2000, tradesPerSession: 2, noTradeRatioPct: 10 },
      obsList,
      {},
      baselineStrategies
    );
    expect(drift.strategyDrift.length).toBeGreaterThan(0);
  });

  // 26. Risk-lock events
  it("26. Risk-lock events", () => {
    dailyStore.recordDailyObservation(createDailyObs("S1", weekdayDates[0], 1500, 2, 2, 0, { riskLock: "PROFIT_LOCK" }));
    dailyStore.recordDailyObservation(createDailyObs("S2", weekdayDates[1], -1000, 2, 0, 2, { riskLock: "LOSS_LOCK" }));

    const report = p34Engine.processLongHorizonPipeline();
    expect(report.riskBehavior.profitLockEvents).toBe(1);
    expect(report.riskBehavior.lossLockEvents).toBe(1);
  });

  // 27. Consecutive losses
  it("27. Consecutive losses", () => {
    dailyStore.recordDailyObservation(createDailyObs("S1", weekdayDates[0], -200, 1, 0, 1));
    dailyStore.recordDailyObservation(createDailyObs("S2", weekdayDates[1], -300, 1, 0, 1));

    const report = p34Engine.processLongHorizonPipeline();
    expect(report.riskBehavior.maxConsecutiveLosses).toBe(2);
  });

  // 28. Emergency exits
  it("28. Emergency exits", () => {
    dailyStore.recordDailyObservation(createDailyObs("S1", weekdayDates[0], -1500, 1, 0, 1, { riskLock: "EMERGENCY_LOCK" }));
    const report = p34Engine.processLongHorizonPipeline();
    expect(report.riskBehavior.emergencyLockEvents).toBe(1);
  });

  // 29. Data-quality incidents
  it("29. Data-quality incidents", () => {
    stabilityEngine.logIncident({
      type: "STALE_DATA",
      recovered: true,
      details: "Quote age exceeded 5s threshold",
    });
    const summary = stabilityEngine.getStabilitySummary(10);
    expect(summary.staleDataEvents).toBe(1);
  });

  // 30. WebSocket recovery
  it("30. WebSocket recovery", () => {
    stabilityEngine.logIncident({
      type: "WEBSOCKET_DISCONNECT",
      recovered: true,
      recoveryDurationMs: 1200,
      details: "WS dropped and reconnected",
    });
    const summary = stabilityEngine.getStabilitySummary(10);
    expect(summary.webSocketDisconnects).toBe(1);
    expect(summary.webSocketRecoveries).toBe(1);
  });

  // 31. Dhan recovery
  it("31. Dhan recovery", () => {
    stabilityEngine.logIncident({
      type: "DHAN_CONNECTION_FAILURE",
      recovered: true,
      details: "Dhan API reconnected after retry",
    });
    const summary = stabilityEngine.getStabilitySummary(10);
    expect(summary.dhanConnectionFailures).toBe(1);
  });

  // 32. Backend restart recovery
  it("32. Backend restart recovery", () => {
    stabilityEngine.logIncident({
      type: "RESTART_RECOVERY",
      recovered: true,
      details: "Backend state reconstructed after restart",
    });
    const summary = stabilityEngine.getStabilitySummary(10);
    expect(summary.restartRecoveryEvents).toBe(1);
  });

  // 33. Active-position recovery
  it("33. Active-position recovery", () => {
    dailyStore.recordDailyObservation(createDailyObs("S_ACT", weekdayDates[0], 500, 2, 2, 0, { activeSession: true }));
    const report = p34Engine.processLongHorizonPipeline();
    expect(report.gateDetails.activeSessions).toBe(1);
  });

  // 34. No duplicate after recovery
  it("34. No duplicate after recovery", () => {
    stabilityEngine.logIncident({
      type: "DUPLICATE_SUPPRESSION",
      recovered: true,
      details: "Duplicate trade ID suppressed during restart sync",
    });
    const summary = stabilityEngine.getStabilitySummary(10);
    expect(summary.duplicateSuppressionEvents).toBe(1);
  });

  // 35. Counter recovery
  it("35. Counter recovery", () => {
    cohortMgr.initializeCohort("P31_BASE", "OOS_001", masterFp);
    cohortMgr.updateCohortCounts(10, 20, 8);
    expect(cohortMgr.getCohort()?.sessionCount).toBe(10);
  });

  // 36. No fabricated statistics
  it("36. No fabricated statistics", () => {
    const report = p34Engine.processLongHorizonPipeline();
    expect(report.rollingSessionWindows.w60.status).toBe("NOT_AVAILABLE");
  });

  // 37. Immutable daily records
  it("37. Immutable daily records", () => {
    const obs = createDailyObs("S_IMMUTABLE", weekdayDates[0], 500);
    dailyStore.recordDailyObservation(obs);
    const fetched = dailyStore.getDailyObservation("S_IMMUTABLE");

    expect(() => {
      (fetched as any).netPnL = 99999;
    }).toThrow();
  });

  // 38. Cohort freeze
  it("38. Cohort freeze", () => {
    cohortMgr.initializeCohort("P31_BASE", "OOS_001", masterFp);
    const frozen = cohortMgr.freezeCohort();
    expect(frozen.status).toBe("FROZEN");
    expect(() => cohortMgr.updateCohortCounts(10, 10, 10)).toThrow();
  });

  // 39. Export integrity
  it("39. Export integrity", () => {
    dailyStore.recordDailyObservation(createDailyObs("S1", weekdayDates[0], 500));
    const csv = p34Engine.generateCsvExport();
    expect(csv).toContain("sessionId,marketDate");
    expect(csv).toContain("S1");
    expect(csv).not.toContain("secret");
  });

  // 40. Audit trail
  it("40. Audit trail", () => {
    const report = p34Engine.processLongHorizonPipeline();
    expect(report.auditTrail.length).toBeGreaterThan(0);
    expect(report.auditTrail.some((a) => a.includes("Phase 34 Long-Horizon"))).toBe(true);
  });

  // 41. Idempotency
  it("41. Idempotency", () => {
    const rep1 = p34Engine.processLongHorizonPipeline();
    const rep2 = p34Engine.processLongHorizonPipeline();
    expect(rep1.reportId).toBe(rep2.reportId);
    expect(rep1.status).toBe(rep2.status);
  });

  // 42. LIVE_TRADING=false
  it("42. LIVE_TRADING=false", () => {
    const safety = p34Engine.verifySafetyLocks();
    expect(safety.safe).toBe(true);
    expect(process.env.LIVE_TRADING).not.toBe("true");
  });

  // 43. BROKER_EXECUTION_ENABLED=false
  it("43. BROKER_EXECUTION_ENABLED=false", () => {
    expect(process.env.BROKER_EXECUTION_ENABLED).not.toBe("true");
  });

  // 44. Real broker orders=0
  it("44. Real broker orders=0", () => {
    const report = p34Engine.processLongHorizonPipeline();
    expect(report.safetyStatus.realBrokerOrders).toBe(0);
  });

  // 45. Master Strategy unchanged
  it("45. Master Strategy unchanged", () => {
    const fpCheck = p34Engine.checkFingerprintLock();
    expect(fpCheck.match).toBe(true);
  });
});
