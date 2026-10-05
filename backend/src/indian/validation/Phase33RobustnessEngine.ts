import { phase32OutOfSampleValidationEngine, Phase32OutOfSampleValidationEngine } from "./Phase32OutOfSampleValidationEngine";
import { phase33StressScenarioManager, Phase33StressScenarioManager } from "./Phase33StressScenarioManager";
import { phase33ExecutionStressEngine, Phase33ExecutionStressEngine, ExecutionStressResult } from "./Phase33ExecutionStressEngine";
import { phase33SequenceStressEngine, Phase33SequenceStressEngine, SequenceStressResult } from "./Phase33SequenceStressEngine";
import { phase33MarketStressEngine, Phase33MarketStressEngine, TailLossStressResult } from "./Phase33MarketStressEngine";
import { phase33DataQualityStressEngine, Phase33DataQualityStressEngine, DataQualityStressResult } from "./Phase33DataQualityStressEngine";
import { phase33MonteCarloEngine, Phase33MonteCarloEngine } from "./Phase33MonteCarloEngine";
import {
  Phase33RobustnessReport,
  Phase33RobustnessState,
  Phase33RobustnessStatus,
  Phase33RobustnessScorecard,
} from "./Phase33RobustnessReport";
import { strategyFingerprintManager } from "./StrategyFingerprintManager";
import { dhanBrokerAdapter } from "../broker/DhanBrokerAdapter";
import { operationalAlertLogger } from "../audit/OperationalAlertLogger";

export class Phase33RobustnessEngine {
  private p32Engine: Phase32OutOfSampleValidationEngine;
  private scenarioMgr: Phase33StressScenarioManager;
  private execStressEngine: Phase33ExecutionStressEngine;
  private seqStressEngine: Phase33SequenceStressEngine;
  private mktStressEngine: Phase33MarketStressEngine;
  private dqStressEngine: Phase33DataQualityStressEngine;
  private mcEngine: Phase33MonteCarloEngine;

  private state: Phase33RobustnessState = "NOT_STARTED";
  private status: Phase33RobustnessStatus = "NOT_STARTED";
  private blockedReason: string | null = null;
  private masterFingerprint: string;

  private report: Phase33RobustnessReport | null = null;
  private auditTrail: string[] = [];

  constructor(
    p32Engine?: Phase32OutOfSampleValidationEngine,
    scenarioMgr?: Phase33StressScenarioManager,
    execStressEngine?: Phase33ExecutionStressEngine,
    seqStressEngine?: Phase33SequenceStressEngine,
    mktStressEngine?: Phase33MarketStressEngine,
    dqStressEngine?: Phase33DataQualityStressEngine,
    mcEngine?: Phase33MonteCarloEngine
  ) {
    this.p32Engine = p32Engine || phase32OutOfSampleValidationEngine;
    this.scenarioMgr = scenarioMgr || phase33StressScenarioManager;
    this.execStressEngine = execStressEngine || phase33ExecutionStressEngine;
    this.seqStressEngine = seqStressEngine || phase33SequenceStressEngine;
    this.mktStressEngine = mktStressEngine || phase33MarketStressEngine;
    this.dqStressEngine = dqStressEngine || phase33DataQualityStressEngine;
    this.mcEngine = mcEngine || phase33MonteCarloEngine;
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
    throw new Error("BROKER_EXECUTION_DISABLED: Phase 33 safety lock hard-blocks real order placement.");
  }
  public modifyOrder(): never {
    throw new Error("BROKER_EXECUTION_DISABLED: Phase 33 safety lock hard-blocks real order modification.");
  }
  public cancelOrder(): never {
    throw new Error("BROKER_EXECUTION_DISABLED: Phase 33 safety lock hard-blocks real order cancellation.");
  }

  // ── Strategy Fingerprint Lock ───────────────────────────────────────────

  public checkFingerprintLock(): { locked: boolean; match: boolean; reason?: string } {
    const currentFp = strategyFingerprintManager.getCurrentFingerprint().masterFingerprintHash;
    const match = currentFp === this.masterFingerprint;

    if (!match) {
      return {
        locked: true,
        match: false,
        reason: "STRATEGY_FINGERPRINT_MISMATCH: Current strategy fingerprint differs from Phase 31/32 locked fingerprint.",
      };
    }

    return { locked: true, match: true };
  }

  // ── Execution Pipeline ───────────────────────────────────────────────────

  public runRobustnessPipeline(): Phase33RobustnessReport {
    if (this.state === "COMPLETED" && this.report) {
      return this.report; // Idempotent execution
    }

    this.auditTrail.push("Phase 33 Robustness & Stress Testing Pipeline initiated.");

    // Step 1: Safety Check
    const safety = this.verifySafetyLocks();
    if (!safety.safe) {
      this.state = "BLOCKED";
      this.status = "ROBUSTNESS_BLOCKED";
      this.blockedReason = safety.reason || "Safety lock enforced";
      return this.buildBlockedReport(this.blockedReason);
    }

    // Step 2: Strategy Fingerprint Lock Check
    const fpCheck = this.checkFingerprintLock();
    if (!fpCheck.match) {
      this.state = "BLOCKED";
      this.status = "ROBUSTNESS_BLOCKED";
      this.blockedReason = fpCheck.reason || "STRATEGY_FINGERPRINT_MISMATCH";
      return this.buildBlockedReport(this.blockedReason);
    }

    this.state = "RUNNING";

    // Step 3: Fetch Observations from Phase 32 / Phase 31
    const p32Report = this.p32Engine.getReport();
    const oosExport = this.p32Engine.getExport();
    const inSampleTrades = (this.p32Engine as any).datasetMgr?.getInSampleTrades() || [];
    const oosObs = (this.p32Engine as any).datasetMgr?.getOOSObservations() || [];

    const allObservations = oosObs.length > 0 ? oosObs : inSampleTrades;
    this.auditTrail.push(`Loaded ${allObservations.length} trade observations for stress scenario testing.`);

    // Step 4: Run Execution Stress Scenarios (Slippage, Delay, Spread)
    const matrix = this.scenarioMgr.getScenarioMatrix();
    const slippageStress = this.execStressEngine.runSlippageStress(allObservations, matrix.slippageScenarios);
    const delayStress = this.execStressEngine.runDelayStress(allObservations, matrix.delayScenarios);
    const spreadStress = this.execStressEngine.runSpreadWideningStress(allObservations, matrix.spreadScenarios);

    this.auditTrail.push(`Execution stress scenarios complete (Slippage: ${slippageStress.length}, Delay: ${delayStress.length}, Spread: ${spreadStress.length}).`);

    // Step 5: Run Sequence Stress Scenarios
    const sequenceStress = this.seqStressEngine.runSequenceStress(allObservations, matrix.sequenceScenarios);
    const sequencePermutations = this.seqStressEngine.runPermutationDistribution(allObservations, 100);

    this.auditTrail.push(`Sequence stress scenarios complete (${sequenceStress.length} scenarios, 100 permutations).`);

    // Step 6: Run Market & Tail-Loss Stress Scenarios
    const tailLossStress = this.mktStressEngine.runTailLossStress(allObservations, matrix.tailLossScenarios);

    this.auditTrail.push(`Tail-loss stress scenarios complete (${tailLossStress.length} scenarios).`);

    // Step 7: Run Data-Quality Stress Scenarios
    const dataQualityStress = this.dqStressEngine.evaluateDataQualityStress(matrix.dataQualityScenarios);

    this.auditTrail.push(`Data quality stress scenarios complete (${dataQualityStress.length} scenarios).`);

    // Step 8: Run Monte Carlo Resampling Diagnostic
    const monteCarloDiagnostic = this.mcEngine.runMonteCarloResampling(allObservations, 1000, 20261003);

    this.auditTrail.push(`Monte Carlo 1,000-iteration diagnostic complete.`);

    // Step 9: Compute Scorecard & Grade
    const scorecard = this.calculateScorecard(
      slippageStress,
      delayStress,
      sequenceStress,
      tailLossStress,
      dataQualityStress
    );

    this.state = "COMPLETED";
    this.status = scorecard.overallRobustnessGrade === "SENSITIVE" ? "HIGH_SENSITIVITY_WARNING" : "ROBUSTNESS_PASSED";

    const reportId = `REP_P33_${this.masterFingerprint.substring(0, 8)}_${Date.now()}`;
    const report: Phase33RobustnessReport = {
      reportId,
      state: this.state,
      status: this.status,
      masterStrategyFingerprint: this.masterFingerprint,
      fingerprintLocked: true,
      fingerprintMatch: true,
      scenarioMatrix: matrix,
      slippageStress,
      delayStress,
      spreadStress,
      sequenceStress,
      sequencePermutations,
      tailLossStress,
      dataQualityStress,
      monteCarloDiagnostic,
      scorecard,
      safetyStatus: {
        paperTrading: process.env.PAPER_TRADING !== "false",
        liveTrading: process.env.LIVE_TRADING === "true",
        brokerExecution: process.env.BROKER_EXECUTION_ENABLED === "true",
        realDataOnly: process.env.INDIAN_REAL_DATA_ONLY !== "false",
        realBrokerOrders: 0,
      },
      auditTrail: [...this.auditTrail],
      generatedAt: new Date().toISOString(),
      disclaimer: "PHASE 33 ROBUSTNESS & STRESS TESTING EVALUATES STRATEGY BEHAVIOR UNDER ADVERSE HYPOTHETICAL CONDITIONS. IT DOES NOT CONSTITUTE A FORECAST OR GUARANTEE OF FUTURE TRADING PERFORMANCE.",
    };

    this.report = report;
    operationalAlertLogger.logAlert(
      "GENUINE_SESSION_STARTED",
      `PHASE 33 ROBUSTNESS COMPLETED with status: ${this.status} (Grade: ${scorecard.overallRobustnessGrade})`,
      "INFO"
    );

    return report;
  }

  private calculateScorecard(
    slippage: ExecutionStressResult[],
    delay: ExecutionStressResult[],
    sequence: SequenceStressResult[],
    tailLoss: TailLossStressResult[],
    dataQuality: DataQualityStressResult[]
  ): Phase33RobustnessScorecard {
    // Slippage sensitivity
    const extremeSlippage = slippage.find((s) => s.severity === "EXTREME");
    let slippageSens: "LOW" | "MODERATE" | "HIGH" = "LOW";
    if (extremeSlippage && extremeSlippage.stressedExpectancy < 0) {
      slippageSens = "HIGH";
    } else if (extremeSlippage && extremeSlippage.expectancyDiff < -150) {
      slippageSens = "MODERATE";
    }

    // Delay sensitivity
    const severeDelay = delay.find((d) => d.severity === "SEVERE");
    let delaySens: "LOW" | "MODERATE" | "HIGH" = "LOW";
    if (severeDelay && severeDelay.stressedExpectancy < 0) {
      delaySens = "HIGH";
    } else if (severeDelay && severeDelay.expectancyDiff < -100) {
      delaySens = "MODERATE";
    }

    // Sequence sensitivity
    const worstSeq = sequence.find((s) => s.order === "WORST_FIRST");
    let seqSens: "LOW" | "MODERATE" | "HIGH" = "LOW";
    if (worstSeq && worstSeq.maxDrawdown > (sequence[0]?.maxDrawdown || 1) * 2.5) {
      seqSens = "HIGH";
    } else if (worstSeq && worstSeq.maxDrawdown > (sequence[0]?.maxDrawdown || 1) * 1.5) {
      seqSens = "MODERATE";
    }

    // Tail loss sensitivity
    const extremeTail = tailLoss.find((t) => t.target === "TOP_3_LOSSES");
    let tailSens: "LOW" | "MODERATE" | "HIGH" = "LOW";
    if (extremeTail && extremeTail.stressedNetPnL < 0) {
      tailSens = "HIGH";
    } else if (extremeTail && extremeTail.stressedMaxDrawdown > extremeTail.originalMaxDrawdown * 1.5) {
      tailSens = "MODERATE";
    }

    // Data quality resilience
    const dqAllPassed = dataQuality.every((d) => d.passed && d.actualBehavior === "SAFE_BLOCK");

    let overallGrade: "ROBUST" | "MODERATE" | "SENSITIVE" = "ROBUST";
    if (!dqAllPassed || slippageSens === "HIGH" || delaySens === "HIGH" || tailSens === "HIGH") {
      overallGrade = "SENSITIVE";
    } else if (slippageSens === "MODERATE" || delaySens === "MODERATE" || seqSens === "MODERATE") {
      overallGrade = "MODERATE";
    }

    return {
      slippageSensitivity: slippageSens,
      delaySensitivity: delaySens,
      sequenceSensitivity: seqSens,
      tailLossSensitivity: tailSens,
      dataQualityResilience: dqAllPassed ? "PASS" : "FAIL",
      overallRobustnessGrade: overallGrade,
    };
  }

  private buildBlockedReport(reason: string): Phase33RobustnessReport {
    const emptyMatrix = this.scenarioMgr.getScenarioMatrix();
    return {
      reportId: `REP_BLOCKED_${Date.now()}`,
      state: "BLOCKED",
      status: "ROBUSTNESS_BLOCKED",
      masterStrategyFingerprint: this.masterFingerprint,
      fingerprintLocked: true,
      fingerprintMatch: false,
      scenarioMatrix: emptyMatrix,
      slippageStress: [],
      delayStress: [],
      spreadStress: [],
      sequenceStress: [],
      sequencePermutations: { permutationsCount: 0, meanMaxDrawdown: 0, worstMaxDrawdown: 0, bestMaxDrawdown: 0, p95MaxDrawdown: 0, meanLosingStreak: 0, maxLosingStreak: 0 },
      tailLossStress: [],
      dataQualityStress: [],
      monteCarloDiagnostic: { iterations: 0, maxDrawdownDistribution: { mean: 0, p95: 0, worst: 0 }, finalPnlDistribution: { mean: 0, p5: 0, worst: 0 }, longestLosingStreakDistribution: { mean: 0, max: 0 }, probabilityOfNegativeEndingPnlPct: 0, disclaimer: "RESAMPLING / SCENARIO DIAGNOSTIC ONLY - NOT A FUTURE PERFORMANCE PREDICTION" },
      scorecard: { slippageSensitivity: "HIGH", delaySensitivity: "HIGH", sequenceSensitivity: "HIGH", tailLossSensitivity: "HIGH", dataQualityResilience: "FAIL", overallRobustnessGrade: "SENSITIVE" },
      safetyStatus: {
        paperTrading: process.env.PAPER_TRADING !== "false",
        liveTrading: process.env.LIVE_TRADING === "true",
        brokerExecution: process.env.BROKER_EXECUTION_ENABLED === "true",
        realDataOnly: process.env.INDIAN_REAL_DATA_ONLY !== "false",
        realBrokerOrders: 0,
      },
      auditTrail: [...this.auditTrail, `ROBUSTNESS_BLOCKED: ${reason}`],
      generatedAt: new Date().toISOString(),
      disclaimer: "PHASE 33 ROBUSTNESS & STRESS TESTING EVALUATES STRATEGY BEHAVIOR UNDER ADVERSE HYPOTHETICAL CONDITIONS. IT DOES NOT CONSTITUTE A FORECAST OR GUARANTEE OF FUTURE TRADING PERFORMANCE.",
    };
  }

  // ── Accessors & Exports ──────────────────────────────────────────────────

  public getStatus(): { state: Phase33RobustnessState; status: Phase33RobustnessStatus; blockedReason: string | null } {
    return { state: this.state, status: this.status, blockedReason: this.blockedReason };
  }

  public getReport(): Phase33RobustnessReport {
    return this.report || this.runRobustnessPipeline();
  }

  public getExport(): {
    status: { state: Phase33RobustnessState; status: Phase33RobustnessStatus };
    report: Phase33RobustnessReport;
    scorecard: Phase33RobustnessScorecard;
    safetyStatus: any;
  } {
    const rep = this.getReport();
    return {
      status: { state: this.state, status: this.status },
      report: rep,
      scorecard: rep.scorecard,
      safetyStatus: rep.safetyStatus,
    };
  }

  public generateCsvExport(): string {
    const rep = this.getReport();
    const headers = [
      "scenarioCategory",
      "scenarioId",
      "scenarioName",
      "originalNetPnL",
      "stressedNetPnL",
      "netPnLDiff",
      "originalExpectancy",
      "stressedExpectancy",
      "expectancyDiff",
      "originalMaxDrawdown",
      "stressedMaxDrawdown",
    ];

    const rows: string[][] = [];

    rep.slippageStress.forEach((s) => {
      rows.push([
        "SLIPPAGE",
        s.scenarioId,
        s.name,
        String(s.originalNetPnL),
        String(s.stressedNetPnL),
        String(s.netPnLDiff),
        String(s.originalExpectancy),
        String(s.stressedExpectancy),
        String(s.expectancyDiff),
        String(s.originalMaxDrawdown),
        String(s.stressedMaxDrawdown),
      ]);
    });

    rep.delayStress.forEach((d) => {
      rows.push([
        "DELAY",
        d.scenarioId,
        d.name,
        String(d.originalNetPnL),
        String(d.stressedNetPnL),
        String(d.netPnLDiff),
        String(d.originalExpectancy),
        String(d.stressedExpectancy),
        String(d.expectancyDiff),
        String(d.originalMaxDrawdown),
        String(d.stressedMaxDrawdown),
      ]);
    });

    return [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
  }

  public reset(): void {
    this.state = "NOT_STARTED";
    this.status = "NOT_STARTED";
    this.blockedReason = null;
    this.report = null;
    this.auditTrail = [];
    this.masterFingerprint = strategyFingerprintManager.getCurrentFingerprint().masterFingerprintHash;
  }
}

export const phase33RobustnessEngine = new Phase33RobustnessEngine();
