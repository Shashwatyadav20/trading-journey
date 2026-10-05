import { describe, it, expect, beforeEach } from "vitest";
import { Phase32OutOfSampleValidationEngine } from "../validation/Phase32OutOfSampleValidationEngine";
import { Phase32DatasetManager, Phase32OOSObservation } from "../validation/Phase32DatasetManager";
import { Phase32LeakageDetector } from "../validation/Phase32LeakageDetector";
import { Phase32WalkForwardEngine } from "../validation/Phase32WalkForwardEngine";
import { Phase32ComparisonEngine } from "../validation/Phase32ComparisonEngine";
import { Phase31ValidationCertificationEngine } from "../validation/Phase31ValidationCertificationEngine";
import { GenuineSampleStore } from "../persistence/GenuineSampleStore";
import { GenuineDailyLedger } from "../persistence/GenuineDailyLedger";
import { strategyFingerprintManager } from "../validation/StrategyFingerprintManager";

// Helper to generate Mon-Fri weekday dates
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

function createValidOOSObservation(
  tradeId: string,
  sessionId: string,
  dateStr: string,
  netPnL: number,
  strategy: "BULL_PUT_SPREAD" | "BEAR_CALL_SPREAD" | "IRON_CONDOR" = "IRON_CONDOR",
  regime: "BULLISH" | "BEARISH" | "RANGE" | "NO_TRADE" = "RANGE",
  fpHash?: string
): Phase32OOSObservation {
  const masterFp = fpHash || strategyFingerprintManager.getCurrentFingerprint().masterFingerprintHash;
  return {
    tradeId,
    sessionId,
    strategy,
    regime,
    entryTimestamp: `${dateStr}T04:00:00.000Z`, // 09:30 IST
    exitTimestamp: `${dateStr}T09:00:00.000Z`,  // 14:30 IST
    dataTimestamp: `${dateStr}T03:59:00.000Z`,  // 09:29 IST
    decisionTimestamp: `${dateStr}T03:59:30.000Z`,
    monitoringTimestamp: `${dateStr}T04:30:00.000Z`,
    netPnL,
    grossPnL: netPnL + 50,
    brokerage: 20,
    STT: 15,
    exchangeCharges: 5,
    GST: 5,
    SEBICharges: 1,
    stampDuty: 4,
    slippage: 10,
    lotSize: 65,
    genuineStatus: true,
    validationFlags: {
      realMarketData: true,
      validTimestamp: true,
      validTradingSession: true,
      noHindsight: true,
      noDuplicate: true,
      validOptionData: true,
      validSpotPrice: true,
      validOptionPrice: true,
      validLotSize: true,
      freshData: true,
      correctTimezone: true,
    },
    strategyFingerprint: masterFp,
    createdAt: `${dateStr}T04:00:00.000Z`,
  };
}

describe("PHASE 32 — Independent Out-of-Sample & Walk-Forward Validation Engine", () => {
  let masterFp: string;
  let weekdayDates: string[];
  let datasetMgr: Phase32DatasetManager;
  let leakageDet: Phase32LeakageDetector;
  let wfEngine: Phase32WalkForwardEngine;
  let compEngine: Phase32ComparisonEngine;
  let p31Engine: Phase31ValidationCertificationEngine;
  let p32Engine: Phase32OutOfSampleValidationEngine;

  beforeEach(() => {
    masterFp = strategyFingerprintManager.getCurrentFingerprint().masterFingerprintHash;
    weekdayDates = getWeekdayDates(30, "2026-10-05");

    datasetMgr = new Phase32DatasetManager();
    leakageDet = new Phase32LeakageDetector();
    wfEngine = new Phase32WalkForwardEngine();
    compEngine = new Phase32ComparisonEngine();
    p31Engine = new Phase31ValidationCertificationEngine();

    p32Engine = new Phase32OutOfSampleValidationEngine(
      p31Engine,
      datasetMgr,
      leakageDet,
      wfEngine,
      compEngine
    );
  });

  // 1. Phase31 cohort remains immutable
  it("1. Phase31 cohort remains immutable", () => {
    const isCohort = { cohortId: "COHORT_P31_001", status: "FROZEN" };
    const isTrades: any[] = [{ tradeId: "IS_001", netPnL: 500 }];
    const isSessions: any[] = [{ sessionId: "SESS_IS_001" }];

    datasetMgr.loadInSampleCohort(isCohort, isTrades, isSessions);
    const loadedTrades = datasetMgr.getInSampleTrades();

    // Attempting to mutate returned trades array should not modify underlying dataset
    expect(() => {
      (loadedTrades as any)[0].netPnL = 9999;
    }).toThrow();
    expect(datasetMgr.getInSampleTrades()[0].netPnL).toBe(500);
  });

  // 2. OOS dataset creation
  it("2. OOS dataset creation", () => {
    const obs = createValidOOSObservation("OOS_TR_001", "SESS_OOS_001", weekdayDates[0], 500);
    const res = datasetMgr.addOOSObservation(obs);
    expect(res.success).toBe(true);
    expect(datasetMgr.getOOSObservations().length).toBe(1);
  });

  // 3. OOS dataset hashing
  it("3. OOS dataset hashing", () => {
    const obs = createValidOOSObservation("OOS_TR_001", "SESS_OOS_001", weekdayDates[0], 500);
    datasetMgr.addOOSObservation(obs);
    const hash1 = datasetMgr.generateDatasetFingerprint("OOS_001");

    expect(hash1).toBeDefined();
    expect(hash1.length).toBe(64); // SHA-256 hex string

    // Same data produces identical hash
    const hash2 = datasetMgr.generateDatasetFingerprint("OOS_001");
    expect(hash1).toBe(hash2);
  });

  // 4. Dataset freeze
  it("4. Dataset freeze", () => {
    const obs = createValidOOSObservation("OOS_TR_001", "SESS_OOS_001", weekdayDates[0], 500);
    datasetMgr.addOOSObservation(obs);

    const cohort = datasetMgr.freezeCohort(masterFp, "OOS_001");
    expect(cohort.status).toBe("FROZEN");

    // Attempting to add new observation after freeze fails
    const obs2 = createValidOOSObservation("OOS_TR_002", "SESS_OOS_002", weekdayDates[1], 300);
    const res = datasetMgr.addOOSObservation(obs2);
    expect(res.success).toBe(false);
    expect(res.reason).toContain("DATASET_FROZEN");
  });

  // 5. Strategy fingerprint lock
  it("5. Strategy fingerprint lock", () => {
    const fpCheck = p32Engine.checkFingerprintLock();
    expect(fpCheck.locked).toBe(true);
    expect(fpCheck.match).toBe(true);
  });

  // 6. Fingerprint mismatch blocking
  it("6. Fingerprint mismatch blocking", () => {
    // Inject invalid fingerprint observation
    const obs = createValidOOSObservation(
      "OOS_TR_001",
      "SESS_OOS_001",
      weekdayDates[0],
      500,
      "IRON_CONDOR",
      "RANGE",
      "INVALID_FP_HASH_123"
    );
    datasetMgr.addOOSObservation(obs);

    const report = p32Engine.runValidationPipeline();
    expect(report.leakageReport.leakageDetected).toBe(true);
    expect(report.status).toBe("VALIDATION_INVALID");
  });

  // 7. Training/test separation
  it("7. Training/test separation", () => {
    const obsList: Phase32OOSObservation[] = [];
    for (let i = 0; i < 15; i++) {
      obsList.push(createValidOOSObservation(`OOS_TR_${i}`, `SESS_${i}`, weekdayDates[i], 100 * (i + 1)));
    }

    const wfWindows = wfEngine.generateWalkForwardWindows(obsList, masterFp, 3);
    expect(wfWindows.length).toBeGreaterThan(0);

    for (const wf of wfWindows) {
      const trainEnd = new Date(wf.trainingEnd).getTime();
      const testStart = new Date(wf.testingStart).getTime();
      expect(trainEnd).toBeLessThanOrEqual(testStart);
    }
  });

  // 8. Walk-forward chronology
  it("8. Walk-forward chronology", () => {
    const obsList: Phase32OOSObservation[] = [];
    for (let i = 0; i < 12; i++) {
      obsList.push(createValidOOSObservation(`OOS_TR_${i}`, `SESS_${i}`, weekdayDates[i], 200));
    }

    const wfWindows = wfEngine.generateWalkForwardWindows(obsList, masterFp, 3);
    for (let i = 1; i < wfWindows.length; i++) {
      const prevTestStart = new Date(wfWindows[i - 1].testingStart).getTime();
      const currTestStart = new Date(wfWindows[i].testingStart).getTime();
      expect(currTestStart).toBeGreaterThanOrEqual(prevTestStart);
    }
  });

  // 9. No future data leakage
  it("9. No future data leakage", () => {
    const obsList: Phase32OOSObservation[] = [];
    for (let i = 0; i < 10; i++) {
      obsList.push(createValidOOSObservation(`OOS_TR_${i}`, `SESS_${i}`, weekdayDates[i], 150));
    }

    const leakageReport = leakageDet.detectLeakage(obsList, [], masterFp);
    expect(leakageReport.clean).toBe(true);
    expect(leakageReport.status).toBe("PASS");
  });

  // 10. Timestamp ordering
  it("10. Timestamp ordering", () => {
    const badObs = createValidOOSObservation("OOS_BAD_01", "SESS_BAD", weekdayDates[0], 500);
    // Violate dataTimestamp <= decisionTimestamp
    badObs.dataTimestamp = `${weekdayDates[0]}T04:01:00.000Z`; // data timestamp AFTER entry/decision
    badObs.decisionTimestamp = `${weekdayDates[0]}T03:59:00.000Z`;

    const leakageReport = leakageDet.detectLeakage([badObs], [], masterFp);
    expect(leakageReport.leakageDetected).toBe(true);
    expect(leakageReport.violations.some((v) => v.type === "ANTI_HINDSIGHT_VIOLATION")).toBe(true);
  });

  // 11. Duplicate detection
  it("11. Duplicate detection", () => {
    const obs1 = createValidOOSObservation("OOS_DUP_01", "SESS_DUP", weekdayDates[0], 500);
    const obs2 = createValidOOSObservation("OOS_DUP_01", "SESS_DUP", weekdayDates[1], 500); // duplicate trade ID

    const leakageReport = leakageDet.detectLeakage([obs1, obs2], [], masterFp);
    expect(leakageReport.leakageDetected).toBe(true);
    expect(leakageReport.violations.some((v) => v.type === "DUPLICATE_TRADE")).toBe(true);
  });

  // 12. Phase31/OOS overlap detection
  it("12. Phase31/OOS overlap detection", () => {
    const isTrade: any = { tradeId: "REUSED_TRADE_01", entryTimestamp: `${weekdayDates[0]}T04:00:00.000Z` };
    const oosObs = createValidOOSObservation("REUSED_TRADE_01", "SESS_OOS", weekdayDates[1], 300);

    const leakageReport = leakageDet.detectLeakage([oosObs], [isTrade], masterFp);
    expect(leakageReport.leakageDetected).toBe(true);
    expect(leakageReport.violations.some((v) => v.type === "PHASE31_TRADE_REUSED")).toBe(true);
  });

  // 13. Genuine data validation
  it("13. Genuine data validation", () => {
    const obs = createValidOOSObservation("OOS_GEN_01", "SESS_GEN_01", weekdayDates[0], 400);
    expect(obs.validationFlags.correctTimezone).toBe(true);
    expect(obs.validationFlags.realMarketData).toBe(true);

    const res = datasetMgr.addOOSObservation(obs);
    expect(res.success).toBe(true);
  });

  // 14. OOS trade calculation
  it("14. OOS trade calculation", () => {
    const obs1 = createValidOOSObservation("TR_1", "SESS_1", weekdayDates[0], 500);
    const obs2 = createValidOOSObservation("TR_2", "SESS_1", weekdayDates[0], -200);
    const obs3 = createValidOOSObservation("TR_3", "SESS_2", weekdayDates[1], 300);

    const stats = p32Engine.calculateOOSCoreStatistics([obs1, obs2, obs3]);
    expect(stats.totalTrades).toBe(3);
    expect(stats.winningTrades).toBe(2);
    expect(stats.losingTrades).toBe(1);
    expect(stats.netPnL).toBe(600);
  });

  // 15. OOS session calculation
  it("15. OOS session calculation", () => {
    const obs1 = createValidOOSObservation("TR_1", "SESS_1", weekdayDates[0], 500);
    const obs2 = createValidOOSObservation("TR_2", "SESS_2", weekdayDates[1], 300);
    datasetMgr.addOOSObservation(obs1);
    datasetMgr.addOOSObservation(obs2);

    const cohort = datasetMgr.freezeCohort(masterFp);
    expect(cohort.sessionCount).toBe(2);
  });

  // 16. Win rate
  it("16. Win rate", () => {
    const obs1 = createValidOOSObservation("TR_1", "SESS_1", weekdayDates[0], 500);
    const obs2 = createValidOOSObservation("TR_2", "SESS_1", weekdayDates[0], -200);
    const stats = p32Engine.calculateOOSCoreStatistics([obs1, obs2]);
    expect(stats.winRate).toBe(50);
  });

  // 17. Profit factor
  it("17. Profit factor", () => {
    const obs1 = createValidOOSObservation("TR_1", "SESS_1", weekdayDates[0], 600);
    const obs2 = createValidOOSObservation("TR_2", "SESS_1", weekdayDates[0], -300);
    const stats = p32Engine.calculateOOSCoreStatistics([obs1, obs2]);
    expect(stats.profitFactor).toBe(2.0);
  });

  // 18. Expectancy
  it("18. Expectancy", () => {
    const obs1 = createValidOOSObservation("TR_1", "SESS_1", weekdayDates[0], 600);
    const obs2 = createValidOOSObservation("TR_2", "SESS_1", weekdayDates[0], -200);
    const stats = p32Engine.calculateOOSCoreStatistics([obs1, obs2]);
    expect(stats.expectancy).toBe(200);
  });

  // 19. Max drawdown
  it("19. Max drawdown", () => {
    const obs1 = createValidOOSObservation("TR_1", "SESS_1", weekdayDates[0], 1000);
    const obs2 = createValidOOSObservation("TR_2", "SESS_2", weekdayDates[1], -400);
    const obs3 = createValidOOSObservation("TR_3", "SESS_3", weekdayDates[2], -300);
    const obs4 = createValidOOSObservation("TR_4", "SESS_4", weekdayDates[3], 500);

    const stats = p32Engine.calculateOOSCoreStatistics([obs1, obs2, obs3, obs4]);
    expect(stats.maxDrawdown).toBe(700);
  });

  // 20. Confidence interval
  it("20. Confidence interval", () => {
    const wilson = p32Engine.calculateWilsonConfidenceInterval(60, 50);
    expect(wilson.lowerBoundPct).toBeGreaterThan(0);
    expect(wilson.upperBoundPct).toBeLessThanOrEqual(100);
    expect(wilson.lowerBoundPct).toBeLessThan(60);
    expect(wilson.upperBoundPct).toBeGreaterThan(60);
  });

  // 21. Bootstrap analysis
  it("21. Bootstrap analysis", () => {
    const obsList: Phase32OOSObservation[] = [
      createValidOOSObservation("TR_1", "SESS_1", weekdayDates[0], 500),
      createValidOOSObservation("TR_2", "SESS_2", weekdayDates[1], -200),
      createValidOOSObservation("TR_3", "SESS_3", weekdayDates[2], 400),
      createValidOOSObservation("TR_4", "SESS_4", weekdayDates[3], 100),
    ];

    const bs = p32Engine.calculateBootstrapExpectancy(obsList, 500);
    expect(bs.iterations).toBe(500);
    expect(bs.confidenceInterval95.lower).toBeDefined();
    expect(bs.confidenceInterval95.upper).toBeDefined();
    expect(bs.confidenceInterval95.lower).toBeLessThanOrEqual(bs.confidenceInterval95.upper);
  });

  // 22. Strategy breakdown
  it("22. Strategy breakdown", () => {
    const obs1 = createValidOOSObservation("TR_1", "S1", weekdayDates[0], 500, "BULL_PUT_SPREAD");
    const obs2 = createValidOOSObservation("TR_2", "S2", weekdayDates[1], 300, "IRON_CONDOR");

    const breakdown = p32Engine.calculateStrategyOOSAnalysis([obs1, obs2]);
    expect(breakdown.length).toBe(3); // BULL_PUT_SPREAD, BEAR_CALL_SPREAD, IRON_CONDOR
    const bullPut = breakdown.find((b) => b.strategy === "BULL_PUT_SPREAD");
    expect(bullPut?.tradeCount).toBe(1);
    expect(bullPut?.netPnL).toBe(500);
  });

  // 23. Regime breakdown
  it("23. Regime breakdown", () => {
    const obs1 = createValidOOSObservation("TR_1", "S1", weekdayDates[0], 500, "IRON_CONDOR", "BULLISH");
    const obs2 = createValidOOSObservation("TR_2", "S2", weekdayDates[1], 300, "IRON_CONDOR", "RANGE");

    const breakdown = p32Engine.calculateRegimeOOSAnalysis([obs1, obs2]);
    expect(breakdown.length).toBe(4); // BULLISH, BEARISH, RANGE, NO_TRADE
    const bullish = breakdown.find((r) => r.regime === "BULLISH");
    expect(bullish?.tradeCount).toBe(1);
    expect(bullish?.lowSampleWarning).toBe(true); // < 5 trades
  });

  // 24. Rolling OOS metrics
  it("24. Rolling OOS metrics", () => {
    const obsList: Phase32OOSObservation[] = [];
    for (let i = 0; i < 15; i++) {
      obsList.push(createValidOOSObservation(`TR_${i}`, `S_${i}`, weekdayDates[i], 200));
    }

    const windows = wfEngine.generateWalkForwardWindows(obsList, masterFp, 3);
    expect(windows.length).toBeGreaterThan(0);
    expect(windows[0].testingMetrics.tradeCount).toBeGreaterThan(0);
  });

  // 25. Walk-forward metrics
  it("25. Walk-forward metrics", () => {
    const obsList: Phase32OOSObservation[] = [];
    for (let i = 0; i < 15; i++) {
      obsList.push(createValidOOSObservation(`TR_${i}`, `S_${i}`, weekdayDates[i], 200));
    }

    const windows = wfEngine.generateWalkForwardWindows(obsList, masterFp, 3);
    const dist = wfEngine.calculateStabilityDistribution(windows);
    expect(dist.stabilityStatus).toBeDefined();
    expect(dist.averageTestingExpectancy).toBe(200);
  });

  // 26. In-sample/OOS comparison
  it("26. In-sample/OOS comparison", () => {
    const isStats = { trades: 30, winRate: 63.3, netPnL: 15000, expectancy: 500, profitFactor: 2.1, maxDrawdown: 3000 };
    const oosStats = { trades: 20, winRate: 55.0, netPnL: 8000, expectancy: 400, profitFactor: 1.8, maxDrawdown: 2500 };

    const comp = compEngine.compareInSampleVsOOS(isStats, oosStats);
    expect(comp.comparisonTable.length).toBe(7);
    expect(comp.degradation.winRateDifference).toBe(-8.3);
    expect(comp.degradation.expectancyDifference).toBe(-100);
  });

  // 27. Degradation calculation
  it("27. Degradation calculation", () => {
    const isStats = { trades: 30, winRate: 60.0, netPnL: 12000, expectancy: 400, profitFactor: 2.0, maxDrawdown: 2000 };
    const oosStats = { trades: 15, winRate: 50.0, netPnL: 4500, expectancy: 300, profitFactor: 1.5, maxDrawdown: 1500 };

    const comp = compEngine.compareInSampleVsOOS(isStats, oosStats);
    expect(comp.degradation.winRateDifference).toBe(-10.0);
    expect(comp.degradation.expectancyDifference).toBe(-100);
  });

  // 28. Low-sample warnings
  it("28. Low-sample warnings", () => {
    const obs1 = createValidOOSObservation("TR_1", "S1", weekdayDates[0], 500, "IRON_CONDOR", "BULLISH");
    const breakdown = p32Engine.calculateRegimeOOSAnalysis([obs1]);
    const bullish = breakdown.find((r) => r.regime === "BULLISH");
    expect(bullish?.lowSampleWarning).toBe(true);
    expect(bullish?.status).toBe("LOW_SAMPLE");
  });

  // 29. Leakage blocks validation
  it("29. Leakage blocks validation", () => {
    const badObs = createValidOOSObservation("TR_BAD", "S_BAD", weekdayDates[0], 500);
    badObs.validationFlags.noHindsight = false; // Flag hindsight leakage
    datasetMgr.addOOSObservation(badObs);

    const report = p32Engine.runValidationPipeline();
    expect(report.status).toBe("VALIDATION_INVALID");
    expect(report.leakageReport.leakageDetected).toBe(true);
  });

  // 30. Restart recovery
  it("30. Restart recovery", () => {
    const obs = createValidOOSObservation("TR_REC_01", "S_REC_01", weekdayDates[0], 500);
    datasetMgr.addOOSObservation(obs);
    datasetMgr.freezeCohort(masterFp);

    const exportData = p32Engine.getExport();
    expect(exportData.cohort).toBeDefined();
    expect(exportData.cohort.status).toBe("FROZEN");
  });

  // 31. Idempotency
  it("31. Idempotency", () => {
    for (let i = 0; i < 12; i++) {
      datasetMgr.addOOSObservation(createValidOOSObservation(`TR_${i}`, `S_${i}`, weekdayDates[i], 300));
    }

    const report1 = p32Engine.runValidationPipeline();
    const report2 = p32Engine.runValidationPipeline();

    expect(report1.status).toBe(report2.status);
    expect(report1.datasetFingerprint).toBe(report2.datasetFingerprint);
  });

  // 32. No fabricated statistics
  it("32. No fabricated statistics", () => {
    const emptyStats = p32Engine.calculateOOSCoreStatistics([]);
    expect(emptyStats.totalTrades).toBe(0);
    expect(emptyStats.winRate).toBe(0);
    expect(emptyStats.netPnL).toBe(0);
    expect(emptyStats.profitFactor).toBe("NOT_AVAILABLE");
  });

  // 33. Export integrity
  it("33. Export integrity", () => {
    const obs = createValidOOSObservation("TR_EXP_01", "S_EXP_01", weekdayDates[0], 500);
    datasetMgr.addOOSObservation(obs);

    const csv = p32Engine.generateCsvExport();
    expect(csv).toContain("tradeId,sessionId");
    expect(csv).toContain("TR_EXP_01");
    expect(csv).not.toContain("secret");
    expect(csv).not.toContain("token");
  });

  // 34. LIVE_TRADING remains false
  it("34. LIVE_TRADING remains false", () => {
    const safety = p32Engine.verifySafetyLocks();
    expect(safety.safe).toBe(true);
    expect(process.env.LIVE_TRADING).not.toBe("true");
  });

  // 35. BROKER_EXECUTION_ENABLED remains false
  it("35. BROKER_EXECUTION_ENABLED remains false", () => {
    expect(process.env.BROKER_EXECUTION_ENABLED).not.toBe("true");
  });

  // 36. Real broker orders remain zero
  it("36. Real broker orders remain zero", () => {
    const exportData = p32Engine.getExport();
    expect(exportData.report.safetyStatus.realBrokerOrders).toBe(0);
  });

  // 37. Master Strategy remains unchanged
  it("37. Master Strategy remains unchanged", () => {
    const fpCheck = p32Engine.checkFingerprintLock();
    expect(fpCheck.match).toBe(true);
  });

  // 38. No automatic optimization
  it("38. No automatic optimization", () => {
    const obs = createValidOOSObservation("TR_1", "S_1", weekdayDates[0], -500);
    datasetMgr.addOOSObservation(obs);

    const report = p32Engine.runValidationPipeline();
    // Master strategy fingerprint must be identical before and after pipeline run
    expect(report.masterStrategyFingerprint).toBe(masterFp);
  });

  // 39. Audit trail completeness
  it("39. Audit trail completeness", () => {
    const report = p32Engine.runValidationPipeline();
    expect(report.auditTrail.length).toBeGreaterThan(0);
    expect(report.auditTrail.some((a) => a.includes("Phase 32 Initialization"))).toBe(true);
  });

  // 40. Validation state machine
  it("40. Validation state machine", () => {
    expect(p32Engine.getStatus().state).toBe("NOT_STARTED");

    p32Engine.initializeValidation();
    expect(p32Engine.getStatus().state).toBe("DATA_VALIDATING");

    for (let i = 0; i < 12; i++) {
      datasetMgr.addOOSObservation(createValidOOSObservation(`TR_${i}`, `S_${i}`, weekdayDates[i], 300));
    }

    const report = p32Engine.runValidationPipeline();
    expect(report.state).toBe("VALIDATION_COMPLETE");
  });
});
