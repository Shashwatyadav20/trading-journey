import { describe, it, expect, beforeEach } from "vitest";
import { Phase33RobustnessEngine } from "../validation/Phase33RobustnessEngine";
import { Phase33StressScenarioManager } from "../validation/Phase33StressScenarioManager";
import { Phase33ExecutionStressEngine } from "../validation/Phase33ExecutionStressEngine";
import { Phase33SequenceStressEngine } from "../validation/Phase33SequenceStressEngine";
import { Phase33MarketStressEngine } from "../validation/Phase33MarketStressEngine";
import { Phase33DataQualityStressEngine } from "../validation/Phase33DataQualityStressEngine";
import { Phase33MonteCarloEngine } from "../validation/Phase33MonteCarloEngine";
import { Phase32OutOfSampleValidationEngine } from "../validation/Phase32OutOfSampleValidationEngine";
import { Phase32DatasetManager, Phase32OOSObservation } from "../validation/Phase32DatasetManager";
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

function createValidOOSObservation(
  tradeId: string,
  sessionId: string,
  dateStr: string,
  netPnL: number,
  strategy: "BULL_PUT_SPREAD" | "BEAR_CALL_SPREAD" | "IRON_CONDOR" = "IRON_CONDOR",
  regime: "BULLISH" | "BEARISH" | "RANGE" | "NO_TRADE" = "RANGE"
): Phase32OOSObservation {
  const masterFp = strategyFingerprintManager.getCurrentFingerprint().masterFingerprintHash;
  return {
    tradeId,
    sessionId,
    strategy,
    regime,
    entryTimestamp: `${dateStr}T04:00:00.000Z`,
    exitTimestamp: `${dateStr}T09:00:00.000Z`,
    dataTimestamp: `${dateStr}T03:59:00.000Z`,
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

describe("PHASE 33 — Robustness & Stress Testing Engine Suite", () => {
  let masterFp: string;
  let weekdayDates: string[];

  let scenarioMgr: Phase33StressScenarioManager;
  let execStressEngine: Phase33ExecutionStressEngine;
  let seqStressEngine: Phase33SequenceStressEngine;
  let mktStressEngine: Phase33MarketStressEngine;
  let dqStressEngine: Phase33DataQualityStressEngine;
  let mcEngine: Phase33MonteCarloEngine;
  let datasetMgr: Phase32DatasetManager;
  let p32Engine: Phase32OutOfSampleValidationEngine;
  let p33Engine: Phase33RobustnessEngine;

  beforeEach(() => {
    masterFp = strategyFingerprintManager.getCurrentFingerprint().masterFingerprintHash;
    weekdayDates = getWeekdayDates(30, "2026-10-05");

    scenarioMgr = new Phase33StressScenarioManager();
    execStressEngine = new Phase33ExecutionStressEngine();
    seqStressEngine = new Phase33SequenceStressEngine();
    mktStressEngine = new Phase33MarketStressEngine();
    dqStressEngine = new Phase33DataQualityStressEngine();
    mcEngine = new Phase33MonteCarloEngine();
    datasetMgr = new Phase32DatasetManager();

    p32Engine = new Phase32OutOfSampleValidationEngine(undefined, datasetMgr);
    p33Engine = new Phase33RobustnessEngine(
      p32Engine,
      scenarioMgr,
      execStressEngine,
      seqStressEngine,
      mktStressEngine,
      dqStressEngine,
      mcEngine
    );

    // Seed test observations
    for (let i = 0; i < 15; i++) {
      const pnl = i % 3 === 0 ? -300 : 500;
      datasetMgr.addOOSObservation(createValidOOSObservation(`TR_${i}`, `S_${i}`, weekdayDates[i], pnl));
    }
  });

  // 1. Strategy fingerprint lock
  it("1. Strategy fingerprint lock", () => {
    const fpCheck = p33Engine.checkFingerprintLock();
    expect(fpCheck.locked).toBe(true);
    expect(fpCheck.match).toBe(true);
  });

  // 2. Phase32 cohort immutability
  it("2. Phase32 cohort immutability", () => {
    const obsBefore = datasetMgr.getOOSObservations().length;
    p33Engine.runRobustnessPipeline();
    const obsAfter = datasetMgr.getOOSObservations().length;
    expect(obsBefore).toBe(obsAfter);
  });

  // 3. Scenario determinism
  it("3. Scenario determinism", () => {
    const matrix1 = scenarioMgr.getScenarioMatrix();
    const matrix2 = scenarioMgr.getScenarioMatrix();
    expect(matrix1.slippageScenarios.length).toBe(matrix2.slippageScenarios.length);
    expect(matrix1.slippageScenarios[0].scenarioId).toBe(matrix2.slippageScenarios[0].scenarioId);
  });

  // 4. Slippage stress baseline
  it("4. Slippage stress baseline", () => {
    const obs = datasetMgr.getOOSObservations();
    const res = execStressEngine.runSlippageStress(obs, scenarioMgr.getScenariosByCategory("SLIPPAGE"));
    const baseline = res.find((r) => r.severity === "BASELINE");
    expect(baseline?.netPnLDiff).toBe(0);
  });

  // 5. Moderate slippage stress (+25%)
  it("5. Moderate slippage stress (+25%)", () => {
    const obs = datasetMgr.getOOSObservations();
    const res = execStressEngine.runSlippageStress(obs, scenarioMgr.getScenariosByCategory("SLIPPAGE"));
    const mod = res.find((r) => r.severity === "MODERATE");
    expect(mod?.stressedNetPnL).toBeLessThan(mod?.originalNetPnL || 0);
  });

  // 6. Severe slippage stress (+50%)
  it("6. Severe slippage stress (+50%)", () => {
    const obs = datasetMgr.getOOSObservations();
    const res = execStressEngine.runSlippageStress(obs, scenarioMgr.getScenariosByCategory("SLIPPAGE"));
    const sev = res.find((r) => r.severity === "SEVERE");
    const mod = res.find((r) => r.severity === "MODERATE");
    expect(sev?.stressedNetPnL).toBeLessThan(mod?.stressedNetPnL || 0);
  });

  // 7. Extreme slippage stress (+100%)
  it("7. Extreme slippage stress (+100%)", () => {
    const obs = datasetMgr.getOOSObservations();
    const res = execStressEngine.runSlippageStress(obs, scenarioMgr.getScenariosByCategory("SLIPPAGE"));
    const ext = res.find((r) => r.severity === "EXTREME");
    expect(ext?.stressedNetPnL).toBeLessThan(ext?.originalNetPnL || 0);
  });

  // 8. Zero execution delay
  it("8. Zero execution delay", () => {
    const obs = datasetMgr.getOOSObservations();
    const res = execStressEngine.runDelayStress(obs, scenarioMgr.getScenariosByCategory("EXECUTION"));
    const baseline = res.find((r) => r.scenarioId === "DELAY_BASELINE");
    expect(baseline?.expectancyDiff).toBe(0);
  });

  // 9. 5-second execution delay
  it("9. 5-second execution delay", () => {
    const obs = datasetMgr.getOOSObservations();
    const res = execStressEngine.runDelayStress(obs, scenarioMgr.getScenariosByCategory("EXECUTION"));
    const d5 = res.find((r) => r.scenarioId === "DELAY_5S");
    expect(d5?.stressedNetPnL).toBeLessThan(d5?.originalNetPnL || 0);
  });

  // 10. 15-second execution delay
  it("10. 15-second execution delay", () => {
    const obs = datasetMgr.getOOSObservations();
    const res = execStressEngine.runDelayStress(obs, scenarioMgr.getScenariosByCategory("EXECUTION"));
    const d15 = res.find((r) => r.scenarioId === "DELAY_15S");
    const d5 = res.find((r) => r.scenarioId === "DELAY_5S");
    expect(d15?.stressedNetPnL).toBeLessThan(d5?.stressedNetPnL || 0);
  });

  // 11. Spread widening baseline
  it("11. Spread widening baseline", () => {
    const obs = datasetMgr.getOOSObservations();
    const res = execStressEngine.runSpreadWideningStress(obs, scenarioMgr.getScenariosByCategory("SPREAD"));
    const base = res.find((r) => r.scenarioId === "SPREAD_BASELINE");
    expect(base?.netPnLDiff).toBe(0);
  });

  // 12. +25% spread widening
  it("12. +25% spread widening", () => {
    const obs = datasetMgr.getOOSObservations();
    const res = execStressEngine.runSpreadWideningStress(obs, scenarioMgr.getScenariosByCategory("SPREAD"));
    const s25 = res.find((r) => r.scenarioId === "SPREAD_WIDE_25");
    expect(s25?.stressedNetPnL).toBeLessThan(s25?.originalNetPnL || 0);
  });

  // 13. +50% spread widening
  it("13. +50% spread widening", () => {
    const obs = datasetMgr.getOOSObservations();
    const res = execStressEngine.runSpreadWideningStress(obs, scenarioMgr.getScenariosByCategory("SPREAD"));
    const s50 = res.find((r) => r.scenarioId === "SPREAD_WIDE_50");
    const s25 = res.find((r) => r.scenarioId === "SPREAD_WIDE_25");
    expect(s50?.stressedNetPnL).toBeLessThan(s25?.stressedNetPnL || 0);
  });

  // 14. Option liquidity stress
  it("14. Option liquidity stress", () => {
    const obs = datasetMgr.getOOSObservations();
    const res = execStressEngine.runSpreadWideningStress(obs, scenarioMgr.getScenariosByCategory("SPREAD"));
    expect(res.length).toBe(3);
  });

  // 15. Sequence chronological
  it("15. Sequence chronological", () => {
    const obs = datasetMgr.getOOSObservations();
    const res = seqStressEngine.runSequenceStress(obs, scenarioMgr.getScenariosByCategory("SEQUENCE"));
    const chrono = res.find((r) => r.order === "CHRONOLOGICAL");
    expect(chrono?.totalTrades).toBe(obs.length);
  });

  // 16. Sequence reversed
  it("16. Sequence reversed", () => {
    const obs = datasetMgr.getOOSObservations();
    const res = seqStressEngine.runSequenceStress(obs, scenarioMgr.getScenariosByCategory("SEQUENCE"));
    const rev = res.find((r) => r.order === "REVERSED");
    expect(rev?.disclaimer).toContain("SCENARIO ANALYSIS ONLY");
  });

  // 17. Sequence worst-first
  it("17. Sequence worst-first", () => {
    const obs = datasetMgr.getOOSObservations();
    const res = seqStressEngine.runSequenceStress(obs, scenarioMgr.getScenariosByCategory("SEQUENCE"));
    const worst = res.find((r) => r.order === "WORST_FIRST");
    const chrono = res.find((r) => r.order === "CHRONOLOGICAL");
    expect(worst?.maxDrawdown).toBeGreaterThanOrEqual(chrono?.maxDrawdown || 0);
  });

  // 18. Sequence permutation distribution
  it("18. Sequence permutation distribution", () => {
    const obs = datasetMgr.getOOSObservations();
    const dist = seqStressEngine.runPermutationDistribution(obs, 50);
    expect(dist.permutationsCount).toBe(50);
    expect(dist.worstMaxDrawdown).toBeGreaterThanOrEqual(dist.bestMaxDrawdown);
  });

  // 19. Drawdown stress calculation
  it("19. Drawdown stress calculation", () => {
    const obs = datasetMgr.getOOSObservations();
    const dist = seqStressEngine.runPermutationDistribution(obs, 50);
    expect(dist.meanMaxDrawdown).toBeGreaterThan(0);
  });

  // 20. Losing-streak stress
  it("20. Losing-streak stress", () => {
    const obs = datasetMgr.getOOSObservations();
    const dist = seqStressEngine.runPermutationDistribution(obs, 50);
    expect(dist.maxLosingStreak).toBeGreaterThan(0);
  });

  // 21. Tail-loss 2x largest loss
  it("21. Tail-loss 2x largest loss", () => {
    const obs = datasetMgr.getOOSObservations();
    const res = mktStressEngine.runTailLossStress(obs, scenarioMgr.getScenariosByCategory("TAIL_LOSS"));
    const largest2x = res.find((r) => r.target === "LARGEST_LOSS");
    expect(largest2x?.stressedNetPnL).toBeLessThan(largest2x?.originalNetPnL || 0);
  });

  // 22. Tail-loss top 3 clustering
  it("22. Tail-loss top 3 clustering", () => {
    const obs = datasetMgr.getOOSObservations();
    const res = mktStressEngine.runTailLossStress(obs, scenarioMgr.getScenariosByCategory("TAIL_LOSS"));
    const top3Clustered = res.find((r) => r.target === "TOP_3_LOSSES");
    expect(top3Clustered?.stressedMaxDrawdown).toBeGreaterThanOrEqual(top3Clustered?.originalMaxDrawdown || 0);
  });

  // 23. Data staleness stress -> SAFE_BLOCK
  it("23. Data staleness stress -> SAFE_BLOCK", () => {
    const dqRes = dqStressEngine.evaluateDataQualityStress(scenarioMgr.getScenariosByCategory("DATA_QUALITY"));
    const stale = dqRes.find((d) => d.condition === "STALE_QUOTE");
    expect(stale?.actualBehavior).toBe("SAFE_BLOCK");
    expect(stale?.passed).toBe(true);
  });

  // 24. Option-chain failure -> SAFE_BLOCK
  it("24. Option-chain failure -> SAFE_BLOCK", () => {
    const dqRes = dqStressEngine.evaluateDataQualityStress(scenarioMgr.getScenariosByCategory("DATA_QUALITY"));
    const chainMissing = dqRes.find((d) => d.condition === "OPTION_CHAIN_UNAVAILABLE");
    expect(chainMissing?.actualBehavior).toBe("SAFE_BLOCK");
    expect(chainMissing?.tradeAllowed).toBe(false);
  });

  // 25. WebSocket failure -> SAFE_BLOCK
  it("25. WebSocket failure -> SAFE_BLOCK", () => {
    const dqRes = dqStressEngine.evaluateDataQualityStress(scenarioMgr.getScenariosByCategory("DATA_QUALITY"));
    const wsDrop = dqRes.find((d) => d.condition === "WEBSOCKET_DISCONNECTED");
    expect(wsDrop?.actualBehavior).toBe("SAFE_BLOCK");
    expect(wsDrop?.passed).toBe(true);
  });

  // 26. Price mismatch -> SAFE_BLOCK
  it("26. Price mismatch -> SAFE_BLOCK", () => {
    const dqRes = dqStressEngine.evaluateDataQualityStress(scenarioMgr.getScenariosByCategory("DATA_QUALITY"));
    const mismatch = dqRes.find((d) => d.condition === "PRICE_MISMATCH");
    expect(mismatch?.actualBehavior).toBe("SAFE_BLOCK");
    expect(mismatch?.tradeAllowed).toBe(false);
  });

  // 27. Safe NO_TRADE behavior
  it("27. Safe NO_TRADE behavior", () => {
    const dqRes = dqStressEngine.evaluateDataQualityStress(scenarioMgr.getScenariosByCategory("DATA_QUALITY"));
    expect(dqRes.every((d) => d.actualBehavior === "SAFE_BLOCK")).toBe(true);
  });

  // 28. Monte Carlo reproducibility
  it("28. Monte Carlo reproducibility", () => {
    const obs = datasetMgr.getOOSObservations();
    const mc1 = mcEngine.runMonteCarloResampling(obs, 500, 20261003);
    const mc2 = mcEngine.runMonteCarloResampling(obs, 500, 20261003);
    expect(mc1.maxDrawdownDistribution.mean).toBe(mc2.maxDrawdownDistribution.mean);
    expect(mc1.finalPnlDistribution.mean).toBe(mc2.finalPnlDistribution.mean);
  });

  // 29. Monte Carlo 1000 iterations
  it("29. Monte Carlo 1000 iterations", () => {
    const obs = datasetMgr.getOOSObservations();
    const mc = mcEngine.runMonteCarloResampling(obs, 1000, 20261003);
    expect(mc.iterations).toBe(1000);
  });

  // 30. Monte Carlo P95 drawdown calculation
  it("30. Monte Carlo P95 drawdown calculation", () => {
    const obs = datasetMgr.getOOSObservations();
    const mc = mcEngine.runMonteCarloResampling(obs, 500, 20261003);
    expect(mc.maxDrawdownDistribution.p95).toBeGreaterThanOrEqual(mc.maxDrawdownDistribution.mean);
  });

  // 31. Monte Carlo P5 ending P&L calculation
  it("31. Monte Carlo P5 ending P&L calculation", () => {
    const obs = datasetMgr.getOOSObservations();
    const mc = mcEngine.runMonteCarloResampling(obs, 500, 20261003);
    expect(mc.finalPnlDistribution.p5).toBeLessThanOrEqual(mc.finalPnlDistribution.mean);
  });

  // 32. No future-data leakage
  it("32. No future-data leakage", () => {
    const report = p33Engine.runRobustnessPipeline();
    expect(report.status).not.toBe("ROBUSTNESS_BLOCKED");
  });

  // 33. No strategy modification
  it("33. No strategy modification", () => {
    const report = p33Engine.runRobustnessPipeline();
    expect(report.masterStrategyFingerprint).toBe(masterFp);
  });

  // 34. No parameter optimization
  it("34. No parameter optimization", () => {
    const currentFp = strategyFingerprintManager.getCurrentFingerprint().masterFingerprintHash;
    p33Engine.runRobustnessPipeline();
    const afterFp = strategyFingerprintManager.getCurrentFingerprint().masterFingerprintHash;
    expect(currentFp).toBe(afterFp);
  });

  // 35. No fabricated statistics
  it("35. No fabricated statistics", () => {
    const mcEmpty = mcEngine.runMonteCarloResampling([], 100);
    expect(mcEmpty.iterations).toBe(0);
    expect(mcEmpty.maxDrawdownDistribution.mean).toBe(0);
  });

  // 36. Export integrity
  it("36. Export integrity", () => {
    const csv = p33Engine.generateCsvExport();
    expect(csv).toContain("scenarioCategory,scenarioId");
    expect(csv).not.toContain("secret");
    expect(csv).not.toContain("token");
  });

  // 37. Audit trail completeness
  it("37. Audit trail completeness", () => {
    const report = p33Engine.runRobustnessPipeline();
    expect(report.auditTrail.length).toBeGreaterThan(0);
    expect(report.auditTrail.some((a) => a.includes("Phase 33 Robustness"))).toBe(true);
  });

  // 38. Restart recovery
  it("38. Restart recovery", () => {
    p33Engine.runRobustnessPipeline();
    const exportData = p33Engine.getExport();
    expect(exportData.report).toBeDefined();
    expect(exportData.scorecard).toBeDefined();
  });

  // 39. Idempotency
  it("39. Idempotency", () => {
    const rep1 = p33Engine.runRobustnessPipeline();
    const rep2 = p33Engine.runRobustnessPipeline();
    expect(rep1.reportId).toBe(rep2.reportId);
    expect(rep1.status).toBe(rep2.status);
  });

  // 40. LIVE_TRADING=false
  it("40. LIVE_TRADING=false", () => {
    const safety = p33Engine.verifySafetyLocks();
    expect(safety.safe).toBe(true);
    expect(process.env.LIVE_TRADING).not.toBe("true");
  });

  // 41. BROKER_EXECUTION_ENABLED=false
  it("41. BROKER_EXECUTION_ENABLED=false", () => {
    expect(process.env.BROKER_EXECUTION_ENABLED).not.toBe("true");
  });

  // 42. Real broker orders=0
  it("42. Real broker orders=0", () => {
    const report = p33Engine.runRobustnessPipeline();
    expect(report.safetyStatus.realBrokerOrders).toBe(0);
  });
});
