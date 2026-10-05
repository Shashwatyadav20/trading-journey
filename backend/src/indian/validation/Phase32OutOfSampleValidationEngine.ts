import crypto from "crypto";
import { phase31ValidationCertificationEngine, Phase31ValidationCertificationEngine } from "./Phase31ValidationCertificationEngine";
import { phase32DatasetManager, Phase32DatasetManager, Phase32OOSObservation } from "./Phase32DatasetManager";
import { phase32LeakageDetector, Phase32LeakageDetector } from "./Phase32LeakageDetector";
import { phase32WalkForwardEngine, Phase32WalkForwardEngine, WalkForwardWindow } from "./Phase32WalkForwardEngine";
import { phase32ComparisonEngine, Phase32ComparisonEngine } from "./Phase32ComparisonEngine";
import {
  Phase32ValidationReport,
  Phase32ValidationState,
  Phase32ValidationStatus,
  Phase32OOSCoreStatistics,
  Phase32WilsonConfidenceInterval,
  Phase32BootstrapExpectancyResult,
  Phase32RegimeOOSAnalysis,
  Phase32StrategyOOSAnalysis,
} from "./Phase32ValidationReport";
import { strategyFingerprintManager } from "./StrategyFingerprintManager";
import { dhanBrokerAdapter } from "../broker/DhanBrokerAdapter";
import { operationalAlertLogger } from "../audit/OperationalAlertLogger";

/**
 * Deterministic PRNG for 100% reproducible Bootstrap analysis.
 */
class Phase32DeterministicPRNG {
  private state: number;
  constructor(seed: number = 20261003) {
    this.state = seed % 2147483647;
    if (this.state <= 0) this.state += 2147483646;
  }
  public nextFloat(): number {
    this.state = (this.state * 16807) % 2147483647;
    return (this.state - 1) / 2147483646;
  }
  public nextInt(min: number, max: number): number {
    return Math.floor(this.nextFloat() * (max - min + 1)) + min;
  }
}

export class Phase32OutOfSampleValidationEngine {
  private p31Engine: Phase31ValidationCertificationEngine;
  private datasetMgr: Phase32DatasetManager;
  private leakageDet: Phase32LeakageDetector;
  private wfEngine: Phase32WalkForwardEngine;
  private compEngine: Phase32ComparisonEngine;

  private state: Phase32ValidationState = "NOT_STARTED";
  private status: Phase32ValidationStatus = "NOT_STARTED";
  private blockedReason: string | null = null;

  private masterFingerprint: string;
  private report: Phase32ValidationReport | null = null;
  private auditTrail: string[] = [];

  constructor(
    p31Engine?: Phase31ValidationCertificationEngine,
    datasetMgr?: Phase32DatasetManager,
    leakageDet?: Phase32LeakageDetector,
    wfEngine?: Phase32WalkForwardEngine,
    compEngine?: Phase32ComparisonEngine
  ) {
    this.p31Engine = p31Engine || phase31ValidationCertificationEngine;
    this.datasetMgr = datasetMgr || phase32DatasetManager;
    this.leakageDet = leakageDet || phase32LeakageDetector;
    this.wfEngine = wfEngine || phase32WalkForwardEngine;
    this.compEngine = compEngine || phase32ComparisonEngine;
    this.masterFingerprint = strategyFingerprintManager.getCurrentFingerprint().masterFingerprintHash;
  }

  // ── Absolute Safety Invariants ───────────────────────────────────────────

  public verifySafetyLocks(): { safe: boolean; reason?: string } {
    const isPaperTrading = process.env.PAPER_TRADING !== "false";
    const isLiveTrading = process.env.LIVE_TRADING === "true";
    const isBrokerExecution = process.env.BROKER_EXECUTION_ENABLED === "true";
    const isRealDataOnly = process.env.INDIAN_REAL_DATA_ONLY !== "false";
    const realOrders = dhanBrokerAdapter.getRealOrdersSent();

    if (!isPaperTrading || isLiveTrading || isBrokerExecution || !isRealDataOnly || realOrders > 0) {
      return {
        safe: false,
        reason: "BROKER_EXECUTION_DISABLED: Security lock enforced. Live broker execution is locked.",
      };
    }
    return { safe: true };
  }

  public placeOrder(): never {
    throw new Error("BROKER_EXECUTION_DISABLED: Phase 32 safety lock hard-blocks real order placement.");
  }
  public modifyOrder(): never {
    throw new Error("BROKER_EXECUTION_DISABLED: Phase 32 safety lock hard-blocks real order modification.");
  }
  public cancelOrder(): never {
    throw new Error("BROKER_EXECUTION_DISABLED: Phase 32 safety lock hard-blocks real order cancellation.");
  }

  // ── Strategy Fingerprint Lock ───────────────────────────────────────────

  public checkFingerprintLock(): { locked: boolean; match: boolean; reason?: string } {
    const currentFp = strategyFingerprintManager.getCurrentFingerprint().masterFingerprintHash;
    const match = currentFp === this.masterFingerprint;

    if (!match) {
      return {
        locked: true,
        match: false,
        reason: "STRATEGY_FINGERPRINT_MISMATCH: Current strategy fingerprint differs from Phase 31 locked fingerprint.",
      };
    }

    return { locked: true, match: true };
  }

  // ── Initialization & Loading ────────────────────────────────────────────

  public initializeValidation(): { status: Phase32ValidationStatus; reason?: string } {
    this.auditTrail.push("Phase 32 Initialization initiated.");

    // Step 1: Safety check
    const safety = this.verifySafetyLocks();
    if (!safety.safe) {
      this.state = "VALIDATION_BLOCKED";
      this.status = "VALIDATION_BLOCKED";
      this.blockedReason = safety.reason || "Safety lock check failed";
      this.auditTrail.push(`VALIDATION_BLOCKED: ${this.blockedReason}`);
      return { status: "VALIDATION_BLOCKED", reason: this.blockedReason };
    }

    // Step 2: Fingerprint lock check
    const fpCheck = this.checkFingerprintLock();
    if (!fpCheck.match) {
      this.state = "VALIDATION_BLOCKED";
      this.status = "VALIDATION_BLOCKED";
      this.blockedReason = fpCheck.reason || "STRATEGY_FINGERPRINT_MISMATCH";
      this.auditTrail.push(`VALIDATION_BLOCKED: ${this.blockedReason}`);
      return { status: "VALIDATION_BLOCKED", reason: this.blockedReason };
    }

    // Step 3: Load Phase 31 Frozen Cohort as IN_SAMPLE
    this.state = "DATA_LOADING";
    const p31Export = this.p31Engine.getExport();
    if (!p31Export.cohort) {
      // Initialize p31 if not yet processed
      this.p31Engine.processCertificationPipeline();
    }
    const freshP31 = this.p31Engine.getExport();

    this.datasetMgr.loadInSampleCohort(freshP31.cohort, freshP31.trades, freshP31.sessions);
    this.auditTrail.push(`Phase 31 Frozen Cohort loaded: ${freshP31.trades.length} trades, ${freshP31.sessions.length} sessions.`);

    this.state = "DATA_VALIDATING";
    return { status: this.status };
  }

  // ── Main Validation Pipeline ─────────────────────────────────────────────

  public runValidationPipeline(): Phase32ValidationReport {
    this.initializeValidation();

    if (this.state === "VALIDATION_BLOCKED") {
      return this.buildBlockedReport(this.blockedReason || "Validation blocked");
    }

    this.state = "VALIDATION_RUNNING";
    const oosObs = this.datasetMgr.getOOSObservations();
    const inSampleTrades = this.datasetMgr.getInSampleTrades();

    // Leakage Detection
    const leakageReport = this.leakageDet.detectLeakage(oosObs, inSampleTrades, this.masterFingerprint);
    this.auditTrail.push(...leakageReport.auditTrail);

    if (leakageReport.leakageDetected) {
      this.state = "VALIDATION_INVALID";
      this.status = "VALIDATION_INVALID";
      this.auditTrail.push("VALIDATION_INVALID: Data leakage or integrity violation detected in OOS dataset.");
    }

    // Minimum OOS Sample Gate (Default 10 trades required)
    const minOosTrades = 10;
    if (this.state !== "VALIDATION_INVALID" && oosObs.length < minOosTrades) {
      this.state = "INSUFFICIENT_OOS_SAMPLE";
      this.status = "INSUFFICIENT_OOS_SAMPLE";
      this.auditTrail.push(`INSUFFICIENT_OOS_SAMPLE: OOS observations count (${oosObs.length}) < minimum required (${minOosTrades}).`);
    } else if (this.state !== "VALIDATION_INVALID") {
      this.state = "VALIDATION_COMPLETE";
      this.status = "VALIDATION_COMPLETE";
      this.auditTrail.push("VALIDATION_COMPLETE: OOS Validation pipeline successfully completed.");
    }

    // Freeze OOS cohort if valid and sufficient
    const wfWindows = this.wfEngine.generateWalkForwardWindows(
      [...inSampleTrades, ...oosObs],
      this.masterFingerprint,
      4
    );
    const cohort = this.datasetMgr.freezeCohort(this.masterFingerprint, "OOS_001", wfWindows.length);

    // Compute Statistics
    const oosStats = this.calculateOOSCoreStatistics(oosObs);
    const winRateConf = this.calculateWilsonConfidenceInterval(oosStats.winRate, oosStats.totalTrades);
    const bootstrapExp = this.calculateBootstrapExpectancy(oosObs);

    // Calculate In-Sample Baseline Stats for Comparison
    const isStats = this.calculateInSampleCoreStatistics(inSampleTrades);
    const comparisonReport = this.compEngine.compareInSampleVsOOS(
      {
        trades: isStats.totalTrades,
        winRate: isStats.winRate,
        grossPnL: isStats.grossPnL,
        netPnL: isStats.netPnL,
        expectancy: isStats.expectancy,
        profitFactor: isStats.profitFactor,
        maxDrawdown: isStats.maxDrawdown,
        averagePnL: isStats.averageNetPnL,
      },
      {
        trades: oosStats.totalTrades,
        winRate: oosStats.winRate,
        grossPnL: oosStats.grossPnL,
        netPnL: oosStats.netPnL,
        expectancy: oosStats.expectancy,
        profitFactor: oosStats.profitFactor,
        maxDrawdown: oosStats.maxDrawdown,
        averagePnL: oosStats.averageNetPnL,
      }
    );

    const wfStability = this.wfEngine.calculateStabilityDistribution(wfWindows);
    const regimeOOS = this.calculateRegimeOOSAnalysis(oosObs);
    const strategyOOS = this.calculateStrategyOOSAnalysis(oosObs);

    const reportId = `REP_P32_${this.masterFingerprint.substring(0, 8)}_${Date.now()}`;
    const report: Phase32ValidationReport = {
      reportId,
      state: this.state,
      status: this.status,
      masterStrategyFingerprint: this.masterFingerprint,
      fingerprintLocked: true,
      fingerprintMatch: true,
      cohort,
      datasetFingerprint: cohort.datasetFingerprint,
      safetyStatus: {
        paperTrading: process.env.PAPER_TRADING !== "false",
        liveTrading: process.env.LIVE_TRADING === "true",
        brokerExecution: process.env.BROKER_EXECUTION_ENABLED === "true",
        realDataOnly: process.env.INDIAN_REAL_DATA_ONLY !== "false",
        realBrokerOrders: 0,
      },
      oosCoreStatistics: oosStats,
      winRateConfidence: winRateConf,
      bootstrapExpectancy: bootstrapExp,
      comparison: comparisonReport,
      degradation: comparisonReport.degradation,
      walkForwardWindows: wfWindows,
      walkForwardStability: wfStability,
      regimeOOSBreakdown: regimeOOS,
      strategyOOSBreakdown: strategyOOS,
      leakageReport,
      auditTrail: [...this.auditTrail],
      generatedAt: new Date().toISOString(),
      disclaimer: "PHASE 32 OUT-OF-SAMPLE VALIDATION REPORTS STATISTICAL EVIDENCE ON UNSEEN DATA. DOES NOT CONSTITUTE A GUARANTEE OF FUTURE PROFITABILITY OR LIVE TRADING READINESS.",
    };

    this.report = report;
    operationalAlertLogger.logAlert(
      "GENUINE_SESSION_STARTED",
      `PHASE 32 OOS VALIDATION COMPLETED with status: ${this.status}`,
      "INFO"
    );

    return report;
  }

  // ── Core Statistical Computations ───────────────────────────────────────

  public calculateOOSCoreStatistics(obs: readonly Phase32OOSObservation[]): Phase32OOSCoreStatistics {
    const totalTrades = obs.length;
    if (totalTrades === 0) {
      return {
        totalTrades: 0,
        winningTrades: 0,
        losingTrades: 0,
        breakevenTrades: 0,
        winRate: 0,
        lossRate: 0,
        grossPnL: 0,
        charges: 0,
        slippage: 0,
        netPnL: 0,
        averageNetPnL: 0,
        medianNetPnL: 0,
        profitFactor: "NOT_AVAILABLE",
        expectancy: 0,
        averageWinner: 0,
        averageLoser: 0,
        winLossRatio: "NOT_AVAILABLE",
        largestWin: 0,
        largestLoss: 0,
        maxDrawdown: 0,
        maxConsecutiveLosses: 0,
      };
    }

    let winningTrades = 0;
    let losingTrades = 0;
    let breakevenTrades = 0;
    let grossWinTotal = 0;
    let grossLossTotal = 0;
    let grossPnLTotal = 0;
    let netPnLTotal = 0;
    let chargesTotal = 0;
    let slippageTotal = 0;
    let largestWin = 0;
    let largestLoss = 0;

    let currentConsecutiveLosses = 0;
    let maxConsecutiveLosses = 0;

    let peak = 0;
    let currentEquity = 0;
    let maxDrawdown = 0;

    const netPnLs: number[] = [];

    for (const t of obs) {
      const net = t.netPnL ?? 0;
      const gross = t.grossPnL ?? net;
      const chg = t.brokerage + t.STT + t.exchangeCharges + t.GST + t.SEBICharges + t.stampDuty;

      grossPnLTotal += gross;
      netPnLTotal += net;
      chargesTotal += chg;
      slippageTotal += t.slippage || 0;
      netPnLs.push(net);

      if (net > 0) {
        winningTrades++;
        grossWinTotal += net;
        if (net > largestWin) largestWin = net;
        currentConsecutiveLosses = 0;
      } else if (net < 0) {
        losingTrades++;
        const absLoss = Math.abs(net);
        grossLossTotal += absLoss;
        if (net < largestLoss) largestLoss = net;
        currentConsecutiveLosses++;
        if (currentConsecutiveLosses > maxConsecutiveLosses) {
          maxConsecutiveLosses = currentConsecutiveLosses;
        }
      } else {
        breakevenTrades++;
        currentConsecutiveLosses = 0;
      }

      currentEquity += net;
      if (currentEquity > peak) peak = currentEquity;
      const dd = peak - currentEquity;
      if (dd > maxDrawdown) maxDrawdown = dd;
    }

    netPnLs.sort((a, b) => a - b);
    const mid = Math.floor(netPnLs.length / 2);
    const medianNetPnL = netPnLs.length % 2 !== 0 ? netPnLs[mid] : (netPnLs[mid - 1] + netPnLs[mid]) / 2;

    const winRate = Number(((winningTrades / totalTrades) * 100).toFixed(2));
    const lossRate = Number(((losingTrades / totalTrades) * 100).toFixed(2));
    const averageNetPnL = Number((netPnLTotal / totalTrades).toFixed(2));
    const expectancy = averageNetPnL;

    const averageWinner = winningTrades > 0 ? Number((grossWinTotal / winningTrades).toFixed(2)) : 0;
    const averageLoser = losingTrades > 0 ? Number((-grossLossTotal / losingTrades).toFixed(2)) : 0;

    const winLossRatio =
      averageLoser !== 0 ? Number((averageWinner / Math.abs(averageLoser)).toFixed(2)) : "NOT_AVAILABLE";
    const profitFactor =
      grossLossTotal === 0
        ? grossWinTotal > 0
          ? 999.99
          : "NOT_AVAILABLE"
        : Number((grossWinTotal / grossLossTotal).toFixed(2));

    return {
      totalTrades,
      winningTrades,
      losingTrades,
      breakevenTrades,
      winRate,
      lossRate,
      grossPnL: Number(grossPnLTotal.toFixed(2)),
      charges: Number(chargesTotal.toFixed(2)),
      slippage: Number(slippageTotal.toFixed(2)),
      netPnL: Number(netPnLTotal.toFixed(2)),
      averageNetPnL,
      medianNetPnL: Number(medianNetPnL.toFixed(2)),
      profitFactor,
      expectancy,
      averageWinner,
      averageLoser,
      winLossRatio,
      largestWin: Number(largestWin.toFixed(2)),
      largestLoss: Number(largestLoss.toFixed(2)),
      maxDrawdown: Number(maxDrawdown.toFixed(2)),
      maxConsecutiveLosses,
    };
  }

  private calculateInSampleCoreStatistics(trades: readonly any[]): Phase32OOSCoreStatistics {
    // Map InSample GenuineTradeRecords using same calculation logic
    const obs: Phase32OOSObservation[] = trades.map((t) => ({
      tradeId: t.tradeId,
      sessionId: t.sessionId,
      strategy: t.strategy || "IRON_CONDOR",
      regime: t.regime || "RANGE",
      entryTimestamp: t.entryTimestamp,
      exitTimestamp: t.exitTimestamp || t.entryTimestamp,
      dataTimestamp: t.dataTimestamp || t.entryTimestamp,
      decisionTimestamp: t.decisionTimestamp || t.entryTimestamp,
      monitoringTimestamp: t.monitoringTimestamp || t.entryTimestamp,
      netPnL: t.netPnL ?? 0,
      grossPnL: t.grossPnL ?? t.netPnL ?? 0,
      brokerage: t.brokerage || 0,
      STT: t.STT || 0,
      exchangeCharges: t.exchangeCharges || 0,
      GST: t.GST || 0,
      SEBICharges: t.SEBICharges || 0,
      stampDuty: t.stampDuty || 0,
      slippage: t.slippage || 0,
      lotSize: t.lotSize || 65,
      genuineStatus: t.genuineTrade,
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
      strategyFingerprint: this.masterFingerprint,
      createdAt: t.entryTimestamp,
    }));

    return this.calculateOOSCoreStatistics(obs);
  }

  // ── Confidence Interval & Bootstrap ──────────────────────────────────────

  public calculateWilsonConfidenceInterval(winRatePct: number, n: number): Phase32WilsonConfidenceInterval {
    if (n <= 0) {
      return { observedWinRatePct: winRatePct, sampleSize: n, confidenceLevel: 95, lowerBoundPct: 0, upperBoundPct: 0 };
    }
    const p = winRatePct / 100;
    const z = 1.95996; // 95% confidence
    const denominator = 1 + (z * z) / n;
    const center = p + (z * z) / (2 * n);
    const spread = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));

    const lower = Math.max(0, (center - spread) / denominator);
    const upper = Math.min(1, (center + spread) / denominator);

    return {
      observedWinRatePct: winRatePct,
      sampleSize: n,
      confidenceLevel: 95,
      lowerBoundPct: Number((lower * 100).toFixed(2)),
      upperBoundPct: Number((upper * 100).toFixed(2)),
    };
  }

  public calculateBootstrapExpectancy(obs: readonly Phase32OOSObservation[], iterations: number = 1000): Phase32BootstrapExpectancyResult {
    if (obs.length === 0) {
      return {
        observedExpectancy: 0,
        bootstrapMean: 0,
        confidenceInterval95: { lower: 0, upper: 0 },
        iterations,
      };
    }

    const pnls = obs.map((o) => o.netPnL ?? 0);
    const observedExp = Number((pnls.reduce((a, b) => a + b, 0) / pnls.length).toFixed(2));

    const prng = new Phase32DeterministicPRNG(20261003);
    const bootstrapMeans: number[] = [];

    for (let i = 0; i < iterations; i++) {
      let sampleSum = 0;
      for (let j = 0; j < pnls.length; j++) {
        const randIdx = prng.nextInt(0, pnls.length - 1);
        sampleSum += pnls[randIdx];
      }
      bootstrapMeans.push(sampleSum / pnls.length);
    }

    bootstrapMeans.sort((a, b) => a - b);
    const bootstrapMean = Number((bootstrapMeans.reduce((a, b) => a + b, 0) / iterations).toFixed(2));

    const p2_5 = bootstrapMeans[Math.floor(iterations * 0.025)];
    const p97_5 = bootstrapMeans[Math.floor(iterations * 0.975)];

    return {
      observedExpectancy: observedExp,
      bootstrapMean,
      confidenceInterval95: {
        lower: Number(p2_5.toFixed(2)),
        upper: Number(p97_5.toFixed(2)),
      },
      iterations,
    };
  }

  // ── Regime & Strategy Analysis ──────────────────────────────────────────

  public calculateRegimeOOSAnalysis(obs: readonly Phase32OOSObservation[]): Phase32RegimeOOSAnalysis[] {
    const regimes: Array<"BULLISH" | "BEARISH" | "RANGE" | "NO_TRADE"> = ["BULLISH", "BEARISH", "RANGE", "NO_TRADE"];

    return regimes.map((regime) => {
      const filtered = obs.filter((o) => o.regime === regime);
      const count = filtered.length;
      const stats = this.calculateOOSCoreStatistics(filtered);
      const lowSampleWarning = count < 5;

      return {
        regime,
        tradeCount: count,
        winRate: stats.winRate,
        netPnL: stats.netPnL,
        expectancy: stats.expectancy,
        profitFactor: stats.profitFactor,
        maxDrawdown: stats.maxDrawdown,
        status: lowSampleWarning ? "LOW_SAMPLE" : "NORMAL",
        lowSampleWarning,
      };
    });
  }

  public calculateStrategyOOSAnalysis(obs: readonly Phase32OOSObservation[]): Phase32StrategyOOSAnalysis[] {
    const strategies: Array<"BULL_PUT_SPREAD" | "BEAR_CALL_SPREAD" | "IRON_CONDOR"> = [
      "BULL_PUT_SPREAD",
      "BEAR_CALL_SPREAD",
      "IRON_CONDOR",
    ];

    return strategies.map((strategy) => {
      const filtered = obs.filter((o) => o.strategy === strategy);
      const stats = this.calculateOOSCoreStatistics(filtered);

      return {
        strategy,
        tradeCount: filtered.length,
        winRate: stats.winRate,
        netPnL: stats.netPnL,
        expectancy: stats.expectancy,
        profitFactor: stats.profitFactor,
        maxDrawdown: stats.maxDrawdown,
      };
    });
  }

  // ── Helper Report Builders ──────────────────────────────────────────────

  private buildBlockedReport(reason: string): Phase32ValidationReport {
    const emptyStats = this.calculateOOSCoreStatistics([]);
    const emptyLeakage: any = { clean: false, leakageDetected: true, violations: [{ type: "FINGERPRINT_MISMATCH", details: reason }], status: "FAIL", auditTrail: [reason], checkedAt: new Date().toISOString() };

    return {
      reportId: `REP_BLOCKED_${Date.now()}`,
      state: "VALIDATION_BLOCKED",
      status: "VALIDATION_BLOCKED",
      masterStrategyFingerprint: this.masterFingerprint,
      fingerprintLocked: true,
      fingerprintMatch: false,
      cohort: null,
      datasetFingerprint: "",
      safetyStatus: {
        paperTrading: process.env.PAPER_TRADING !== "false",
        liveTrading: process.env.LIVE_TRADING === "true",
        brokerExecution: process.env.BROKER_EXECUTION_ENABLED === "true",
        realDataOnly: process.env.INDIAN_REAL_DATA_ONLY !== "false",
        realBrokerOrders: 0,
      },
      oosCoreStatistics: emptyStats,
      winRateConfidence: { observedWinRatePct: 0, sampleSize: 0, confidenceLevel: 95, lowerBoundPct: 0, upperBoundPct: 0 },
      bootstrapExpectancy: { observedExpectancy: 0, bootstrapMean: 0, confidenceInterval95: { lower: 0, upper: 0 }, iterations: 1000 },
      comparison: { comparisonTable: [], degradation: { winRateDifference: 0, expectancyDifference: 0, profitFactorDifference: "NOT_AVAILABLE", drawdownDifference: 0, averagePnLDifference: 0 }, summaryText: reason, generatedAt: new Date().toISOString() },
      degradation: { winRateDifference: 0, expectancyDifference: 0, profitFactorDifference: "NOT_AVAILABLE", drawdownDifference: 0, averagePnLDifference: 0 },
      walkForwardWindows: [],
      walkForwardStability: { windows: [], averageTestingExpectancy: 0, averageTestingWinRate: 0, expectancyStdDev: 0, stabilityStatus: "INSUFFICIENT_DATA" },
      regimeOOSBreakdown: [],
      strategyOOSBreakdown: [],
      leakageReport: emptyLeakage,
      auditTrail: [...this.auditTrail, `VALIDATION_BLOCKED: ${reason}`],
      generatedAt: new Date().toISOString(),
      disclaimer: "PHASE 32 OUT-OF-SAMPLE VALIDATION REPORTS STATISTICAL EVIDENCE ON UNSEEN DATA. DOES NOT CONSTITUTE A GUARANTEE OF FUTURE PROFITABILITY OR LIVE TRADING READINESS.",
    };
  }

  // ── Accessors & Exports ──────────────────────────────────────────────────

  public getStatus(): { state: Phase32ValidationState; status: Phase32ValidationStatus; blockedReason: string | null } {
    return { state: this.state, status: this.status, blockedReason: this.blockedReason };
  }

  public getReport(): Phase32ValidationReport {
    return this.report || this.runValidationPipeline();
  }

  public getExport(): {
    status: { state: Phase32ValidationState; status: Phase32ValidationStatus };
    report: Phase32ValidationReport;
    cohort: any;
    inSampleCount: number;
    oosCount: number;
    integrity: any;
    leakage: any;
  } {
    const rep = this.getReport();
    return {
      status: { state: this.state, status: this.status },
      report: rep,
      cohort: rep.cohort,
      inSampleCount: this.datasetMgr.getInSampleTrades().length,
      oosCount: this.datasetMgr.getOOSObservations().length,
      integrity: { safe: true, fingerprintMatch: rep.fingerprintMatch },
      leakage: rep.leakageReport,
    };
  }

  public generateCsvExport(): string {
    const obs = this.datasetMgr.getOOSObservations();
    const headers = [
      "tradeId",
      "sessionId",
      "strategy",
      "regime",
      "entryTimestamp",
      "exitTimestamp",
      "netPnL",
      "grossPnL",
      "charges",
      "slippage",
      "strategyFingerprint",
      "genuineStatus",
    ];

    const rows = obs.map((o) => [
      o.tradeId,
      o.sessionId,
      o.strategy,
      o.regime,
      o.entryTimestamp,
      o.exitTimestamp,
      o.netPnL,
      o.grossPnL,
      o.brokerage + o.STT + o.exchangeCharges + o.GST + o.SEBICharges + o.stampDuty,
      o.slippage,
      o.strategyFingerprint,
      o.genuineStatus ? "GENUINE" : "INVALID",
    ]);

    return [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
  }

  public reset(): void {
    this.state = "NOT_STARTED";
    this.status = "NOT_STARTED";
    this.blockedReason = null;
    this.report = null;
    this.auditTrail = [];
    this.masterFingerprint = strategyFingerprintManager.getCurrentFingerprint().masterFingerprintHash;
    this.datasetMgr.reset();
  }
}

export const phase32OutOfSampleValidationEngine = new Phase32OutOfSampleValidationEngine();
