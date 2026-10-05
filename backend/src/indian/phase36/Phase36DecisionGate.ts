import { PHASE36_CONFIG, PHASE36_LIVE_EXECUTION_ALLOWED } from "./Phase36Config";
import {
  Phase36State,
  Phase36DecisionOutput,
  Phase36EvidenceInput,
  Phase36DecisionReport,
  SampleSufficiencyResult,
  StatisticalAssessmentResult,
  OOSAssessmentResult,
  StressAssessmentResult,
  DriftAssessmentResult,
  RiskAssessmentResult,
  OperationalAssessmentResult,
  SafetyGateResult,
} from "./Phase36Types";
import { phase36EvidenceLoader, Phase36EvidenceLoader } from "./Phase36EvidenceLoader";
import { phase36EvidenceValidator, Phase36EvidenceValidator } from "./Phase36EvidenceValidator";
import { phase36SampleSufficiency, Phase36SampleSufficiency } from "./Phase36SampleSufficiency";
import { phase36StatisticalAssessment, Phase36StatisticalAssessment } from "./Phase36StatisticalAssessment";
import { phase36OOSAssessment, Phase36OOSAssessment } from "./Phase36OOSAssessment";
import { phase36StressAssessment, Phase36StressAssessment } from "./Phase36StressAssessment";
import { phase36DriftAssessment, Phase36DriftAssessment } from "./Phase36DriftAssessment";
import { phase36RiskAssessment, Phase36RiskAssessment } from "./Phase36RiskAssessment";
import { phase36OperationalAssessment, Phase36OperationalAssessment } from "./Phase36OperationalAssessment";
import { phase36SafetyGate, Phase36SafetyGate } from "./Phase36SafetyGate";
import { phase36DecisionReportBuilder, Phase36DecisionReportBuilder } from "./Phase36DecisionReport";
import { phase36DecisionExporter, Phase36DecisionExporter } from "./Phase36DecisionExporter";

export class Phase36DecisionGate {
  private loader: Phase36EvidenceLoader;
  private validator: Phase36EvidenceValidator;
  private sampleSufficiency: Phase36SampleSufficiency;
  private statisticalAssessment: Phase36StatisticalAssessment;
  private oosAssessment: Phase36OOSAssessment;
  private stressAssessment: Phase36StressAssessment;
  private driftAssessment: Phase36DriftAssessment;
  private riskAssessment: Phase36RiskAssessment;
  private operationalAssessment: Phase36OperationalAssessment;
  private safetyGate: Phase36SafetyGate;
  private reportBuilder: Phase36DecisionReportBuilder;
  private exporter: Phase36DecisionExporter;

  private state: Phase36State = "NOT_STARTED";
  private decision: Phase36DecisionOutput | null = null;
  private report: Phase36DecisionReport | null = null;
  private isFrozen: boolean = false;

  constructor(
    loader?: Phase36EvidenceLoader,
    validator?: Phase36EvidenceValidator,
    sampleSufficiency?: Phase36SampleSufficiency,
    statisticalAssessment?: Phase36StatisticalAssessment,
    oosAssessment?: Phase36OOSAssessment,
    stressAssessment?: Phase36StressAssessment,
    driftAssessment?: Phase36DriftAssessment,
    riskAssessment?: Phase36RiskAssessment,
    operationalAssessment?: Phase36OperationalAssessment,
    safetyGate?: Phase36SafetyGate,
    reportBuilder?: Phase36DecisionReportBuilder,
    exporter?: Phase36DecisionExporter
  ) {
    // Critical Invariant Assertions
    if (PHASE36_CONFIG.LIVE_TRADING !== false) {
      throw new Error("PHASE36_LIVE_TRADING_FORBIDDEN");
    }
    if (PHASE36_CONFIG.BROKER_EXECUTION_ENABLED !== false) {
      throw new Error("PHASE36_BROKER_EXECUTION_FORBIDDEN");
    }

    this.loader = loader || phase36EvidenceLoader;
    this.validator = validator || phase36EvidenceValidator;
    this.sampleSufficiency = sampleSufficiency || phase36SampleSufficiency;
    this.statisticalAssessment = statisticalAssessment || phase36StatisticalAssessment;
    this.oosAssessment = oosAssessment || phase36OOSAssessment;
    this.stressAssessment = stressAssessment || phase36StressAssessment;
    this.driftAssessment = driftAssessment || phase36DriftAssessment;
    this.riskAssessment = riskAssessment || phase36RiskAssessment;
    this.operationalAssessment = operationalAssessment || phase36OperationalAssessment;
    this.safetyGate = safetyGate || phase36SafetyGate;
    this.reportBuilder = reportBuilder || phase36DecisionReportBuilder;
    this.exporter = exporter || phase36DecisionExporter;
  }

  public runDecisionGate(overrideEvidence?: Phase36EvidenceInput): Phase36DecisionReport {
    if (this.isFrozen && this.report) {
      return this.report; // Report is frozen and immutable
    }

    // Step 1: Safety Check
    this.state = "SAFETY_ASSESSMENT";
    const safetyResult = this.safetyGate.verifySafetyGate();

    // Step 2: Load Evidence
    this.state = "EVIDENCE_LOADING";
    let evidenceInput: Phase36EvidenceInput;
    try {
      evidenceInput = overrideEvidence || this.loader.loadEvidence();
    } catch (err: any) {
      this.state = "VALIDATION_BLOCKED";
      this.decision = "VALIDATION_BLOCKED";
      return this.buildAndFreezeReport(
        this.state,
        this.decision,
        this.createDummyEvidenceInput(err.message),
        this.createDummySample(),
        this.createDummyStats(),
        this.createDummyOOS(),
        this.createDummyStress(),
        this.createDummyDrift(),
        this.createDummyRisk(),
        this.createDummyOps(),
        safetyResult,
        [err.message]
      );
    }

    // Step 3: Validate Evidence Integrity
    this.state = "EVIDENCE_VALIDATION";
    const integrityResult = this.validator.validateEvidence(evidenceInput);
    if (!integrityResult.valid) {
      this.state = integrityResult.reason === "HASH_MISMATCH" || integrityResult.reason === "FINGERPRINT_MISMATCH"
        ? "EVIDENCE_CORRUPTED"
        : "VALIDATION_BLOCKED";
      this.decision = "VALIDATION_BLOCKED";
      return this.buildAndFreezeReport(
        this.state,
        this.decision,
        evidenceInput,
        this.createDummySample(),
        this.createDummyStats(),
        this.createDummyOOS(),
        this.createDummyStress(),
        this.createDummyDrift(),
        this.createDummyRisk(),
        this.createDummyOps(),
        safetyResult,
        integrityResult.details
      );
    }

    // Step 4: Safety Assessment Evaluation
    if (!safetyResult.safetyPassed) {
      this.state = "VALIDATION_BLOCKED";
      this.decision = "VALIDATION_BLOCKED";
      return this.buildAndFreezeReport(
        this.state,
        this.decision,
        evidenceInput,
        this.createDummySample(),
        this.createDummyStats(),
        this.createDummyOOS(),
        this.createDummyStress(),
        this.createDummyDrift(),
        this.createDummyRisk(),
        this.createDummyOps(),
        safetyResult,
        safetyResult.violations
      );
    }

    // Step 5: Sample Sufficiency
    this.state = "SAMPLE_ASSESSMENT";
    const sampleResult = this.sampleSufficiency.evaluate(evidenceInput);
    if (!sampleResult.sufficient) {
      this.state = "INSUFFICIENT_EVIDENCE";
      this.decision = "INSUFFICIENT_EVIDENCE";
      return this.buildAndFreezeReport(
        this.state,
        this.decision,
        evidenceInput,
        sampleResult,
        this.createDummyStats(),
        this.createDummyOOS(),
        this.createDummyStress(),
        this.createDummyDrift(),
        this.createDummyRisk(),
        this.createDummyOps(),
        safetyResult,
        sampleResult.reasons
      );
    }

    // Step 6: Statistical Assessment
    this.state = "STATISTICAL_ASSESSMENT";
    const statsResult = this.statisticalAssessment.evaluate(evidenceInput);

    // Step 7: OOS Assessment
    this.state = "OOS_ASSESSMENT";
    const oosResult = this.oosAssessment.evaluate(evidenceInput);

    // Step 8: Stress Assessment
    this.state = "STRESS_ASSESSMENT";
    const stressResult = this.stressAssessment.evaluate(evidenceInput);

    // Step 9: Drift Assessment
    this.state = "DRIFT_ASSESSMENT";
    const driftResult = this.driftAssessment.evaluate(evidenceInput);

    // Step 10: Risk Assessment
    this.state = "RISK_ASSESSMENT";
    const riskResult = this.riskAssessment.evaluate(evidenceInput);

    // Step 11: Operational Assessment
    this.state = "OPERATIONAL_ASSESSMENT";
    const opsResult = this.operationalAssessment.evaluate(evidenceInput);

    // Step 12: Decision Engine Flowchart Logic
    this.state = "DECISION_GENERATION";

    if (riskResult.historicalViolationsCount > 0 && !riskResult.dailyLossCapMet) {
      this.decision = "VALIDATION_BLOCKED";
    } else if (statsResult.uncertainty === "HIGH") {
      this.decision = "EVIDENCE_INCONCLUSIVE";
    } else if (
      oosResult.classification === "DEGRADED" ||
      oosResult.classification === "INSUFFICIENT_DATA" ||
      driftResult.classification === "MATERIAL_DRIFT" ||
      stressResult.scenariosDegraded > stressResult.scenariosPassing
    ) {
      this.decision = "FURTHER_VALIDATION_REQUIRED";
    } else {
      this.decision = "PAPER_VALIDATION_SUPPORTED";
    }

    return this.buildAndFreezeReport(
      "REPORT_FROZEN",
      this.decision,
      evidenceInput,
      sampleResult,
      statsResult,
      oosResult,
      stressResult,
      driftResult,
      riskResult,
      opsResult,
      safetyResult,
      []
    );
  }

  private buildAndFreezeReport(
    state: Phase36State,
    decision: Phase36DecisionOutput,
    evidenceInput: Phase36EvidenceInput,
    sample: SampleSufficiencyResult,
    stats: StatisticalAssessmentResult,
    oos: OOSAssessmentResult,
    stress: StressAssessmentResult,
    drift: DriftAssessmentResult,
    risk: RiskAssessmentResult,
    ops: OperationalAssessmentResult,
    safety: SafetyGateResult,
    missingEvidence: string[]
  ): Phase36DecisionReport {
    this.state = state;
    this.decision = decision;

    const rep = this.reportBuilder.buildReport(
      state,
      decision,
      evidenceInput,
      sample,
      stats,
      oos,
      stress,
      drift,
      risk,
      ops,
      safety,
      missingEvidence
    );

    this.report = Object.freeze(rep);
    this.isFrozen = true;
    return this.report;
  }

  public getStatus(): { state: Phase36State; decision: Phase36DecisionOutput | null; isFrozen: boolean } {
    return { state: this.state, decision: this.decision, isFrozen: this.isFrozen };
  }

  public getReport(): Phase36DecisionReport {
    return this.report || this.runDecisionGate();
  }

  public getExports(): { json: string; csv: string; manifestJson: string } {
    const rep = this.getReport();
    return {
      json: this.exporter.exportJson(rep),
      csv: this.exporter.exportCsv(rep),
      manifestJson: this.exporter.exportManifestJson(rep),
    };
  }

  public resetForTesting(): void {
    this.state = "NOT_STARTED";
    this.decision = null;
    this.report = null;
    this.isFrozen = false;
  }

  // Helper dummy builders for blocked or insufficient states
  private createDummyEvidenceInput(reason: string): Phase36EvidenceInput {
    return {
      finalResearchReport: {
        reportTitle: "PHASE 35 — FINAL RESEARCH & EVIDENCE REPORT",
        reportId: "REP_DUMMY",
        state: "NOT_STARTED",
        status: "NOT_STARTED",
        masterStrategyFingerprint: "FP_UNKNOWN",
        sections: {} as any,
        snapshot: {} as any,
        manifest: { manifestHash: "HASH_UNKNOWN" } as any,
        reconciliation: {} as any,
        auditTrail: [reason],
        generatedAt: new Date().toISOString(),
        disclaimer: "FINAL RESEARCH EVIDENCE REPORT CONSOLIDATES OBSERVED PAPER DATA, OUT-OF-SAMPLE EVIDENCE, AND STRESS TESTING. DOES NOT GUARANTEE FUTURE LIVE TRADING PROFITABILITY.",
      },
      evidenceRegistry: [],
      evidenceManifest: { manifestHash: "HASH_UNKNOWN" },
      safetyAudit: {} as any,
      reproducibilityManifest: {},
    };
  }

  private createDummySample(): SampleSufficiencyResult {
    return { sufficient: false, genuineSessions: 0, genuineTrades: 0, activeSessions: 0, oosTrades: 0, longHorizonSessions: 0, reasons: ["Evidence missing or invalid."] };
  }
  private createDummyStats(): StatisticalAssessmentResult {
    return { winRate: {} as any, expectancy: {} as any, profitFactor: {} as any, drawdown: {} as any, confidenceIntervals: {} as any, uncertainty: "HIGH", notes: ["Missing statistics."] };
  }
  private createDummyOOS(): OOSAssessmentResult {
    return { classification: "INSUFFICIENT_DATA", expectancyDegradationPct: 0, winRateDifferencePct: 0, profitFactorDifference: 0, drawdownDifferenceInr: 0, walkForwardConsistency: "NONE", reasons: ["Missing OOS evidence."] };
  }
  private createDummyStress(): StressAssessmentResult {
    return { scenariosTested: 0, scenariosPassing: 0, scenariosDegraded: 0, dataQualityBlocks: 0, tailLossExposure: 0, conclusions: ["Missing stress evidence."] };
  }
  private createDummyDrift(): DriftAssessmentResult {
    return { classification: "INSUFFICIENT_DATA", winRateDrift: 0, expectancyDrift: 0, profitFactorDrift: 0, drawdownDrift: 0, reasons: ["Missing drift evidence."] };
  }
  private createDummyRisk(): RiskAssessmentResult {
    return { dailyProfitCapMet: false, dailyLossCapMet: false, maxLossPerTradeMet: false, riskLockEvents: 0, emergencyExits: 0, pnlReconciliationStatus: "FAIL", historicalViolationsCount: 1, violationsDetails: ["Missing risk evidence."] };
  }
  private createDummyOps(): OperationalAssessmentResult {
    return { totalIncidents: 0, recoverableIncidents: 0, unresolvedIncidents: 1, duplicateRiskDetected: true, reconciliationPassed: false, overallStatus: "UNSTABLE" };
  }
}

export const phase36DecisionGate = new Phase36DecisionGate();
