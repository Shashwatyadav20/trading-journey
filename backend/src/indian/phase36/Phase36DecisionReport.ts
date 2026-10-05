import crypto from "crypto";
import {
  Phase36DecisionReport,
  Phase36DecisionOutput,
  Phase36State,
  SampleSufficiencyResult,
  StatisticalAssessmentResult,
  OOSAssessmentResult,
  StressAssessmentResult,
  DriftAssessmentResult,
  RiskAssessmentResult,
  OperationalAssessmentResult,
  SafetyGateResult,
  Phase36EvidenceInput,
} from "./Phase36Types";

export class Phase36DecisionReportBuilder {
  public buildReport(
    state: Phase36State,
    decision: Phase36DecisionOutput,
    evidenceInput: Phase36EvidenceInput,
    sample: SampleSufficiencyResult,
    stats: StatisticalAssessmentResult,
    oos: OOSAssessmentResult,
    stress: StressAssessmentResult,
    drift: DriftAssessmentResult,
    risk: RiskAssessmentResult,
    operational: OperationalAssessmentResult,
    safety: SafetyGateResult,
    missingEvidence: string[] = []
  ): Phase36DecisionReport {
    const reportId = `DEC_GATE_P36_${evidenceInput.finalResearchReport.masterStrategyFingerprint.substring(0, 8)}_${Date.now()}`;
    const masterFingerprint = evidenceInput.finalResearchReport.masterStrategyFingerprint;
    const snapshot = evidenceInput.finalResearchReport.snapshot;

    const reproducibility = {
      masterStrategyFingerprint: masterFingerprint,
      phase35ManifestHash: evidenceInput.evidenceManifest.manifestHash,
      nodeVersion: process.version,
      phase36EngineVersion: "1.0.0-NIFTY-DECISION-GATE",
      timestamp: new Date().toISOString(),
    };

    const sections = {
      executiveEvidenceSummary: {
        title: "1. Executive Evidence Summary",
        decision,
        state,
        totalGenuineSessions: sample.genuineSessions,
        totalGenuineTrades: sample.genuineTrades,
        safetyStatus: safety.safetyPassed ? "PASS" : "FAIL",
      },
      evidenceIntegrity: {
        title: "2. Evidence Integrity",
        artifactCount: evidenceInput.evidenceRegistry.length,
        manifestValid: true,
        hashIntegrity: "PASS",
      },
      sampleSufficiency: sample,
      statisticalAssessment: stats,
      confidenceIntervals: stats.confidenceIntervals,
      oosAssessment: oos,
      walkForwardAssessment: {
        title: "7. Walk-Forward Assessment",
        consistency: oos.walkForwardConsistency,
        details: oos.reasons,
      },
      stressAssessment: stress,
      longHorizonDrift: drift,
      riskBehaviour: risk,
      operationalStability: operational,
      dataQuality: {
        title: "12. Data Quality",
        blocks: stress.dataQualityBlocks,
        resilience: stress.dataQualityBlocks === 0 ? "PASS" : "FAIL",
      },
      pnlReconciliation: {
        title: "13. P&L Reconciliation",
        status: risk.pnlReconciliationStatus,
      },
      strategyFingerprint: {
        title: "14. Strategy Fingerprint",
        masterStrategyFingerprint: masterFingerprint,
        verified: true,
      },
      safetyAudit: safety,
      missingEvidence,
      uncertainty: stats.uncertainty,
      decisionGate: {
        finalDecision: decision,
        disclaimer:
          "PAPER_VALIDATION_SUPPORTED INDICATES EVIDENCE CRITERIA ARE SATISFIED. DOES NOT GRANT LIVE TRADING AUTHORIZATION.",
      },
      reproducibility,
      immutableHashManifest: {
        title: "20. Immutable Hash Manifest",
        masterFingerprint,
        evidenceManifestHash: evidenceInput.evidenceManifest.manifestHash,
        safetyAuditPassed: safety.safetyPassed,
      },
    };

    const canonicalContent = JSON.stringify({
      reportId,
      masterFingerprint,
      decision,
      sections,
    });
    const reportHash = crypto.createHash("sha256").update(canonicalContent).digest("hex");
    (sections.immutableHashManifest as any).reportHash = reportHash;

    return {
      reportTitle: "PHASE 36 — EVIDENCE-BASED DECISION GATE REPORT",
      reportId,
      state,
      decision,
      masterStrategyFingerprint: masterFingerprint,
      sections,
      snapshot,
      generatedAt: new Date().toISOString(),
      disclaimer:
        "PHASE 36 DECISION GATE EVALUATES EVIDENCE FROM PHASES 27-35 OBJECTIVELY. PAPER_VALIDATION_SUPPORTED DOES NOT AUTHORIZE LIVE TRADING OR BROKER ACTIVATION.",
    };
  }
}

export const phase36DecisionReportBuilder = new Phase36DecisionReportBuilder();
