import { EvidenceClassification, Phase35EvidenceArtifact } from "../validation/Phase35EvidenceRegistry";
import { Phase35EvidenceSnapshot, FinalStatisticsSnapshot, OOSEvidenceSnapshot, StressEvidenceSnapshot, LongHorizonEvidenceSnapshot, RiskSummarySnapshot, OperationalStabilitySnapshot, SafetyAuditSnapshot } from "../validation/Phase35EvidenceSnapshot";
import { Phase35FinalResearchReport } from "../validation/Phase35ResearchReportEngine";

export type Phase36DecisionOutput =
  | "INSUFFICIENT_EVIDENCE"
  | "EVIDENCE_INCONCLUSIVE"
  | "PAPER_VALIDATION_SUPPORTED"
  | "FURTHER_VALIDATION_REQUIRED"
  | "VALIDATION_BLOCKED";

export type Phase36State =
  | "NOT_STARTED"
  | "EVIDENCE_LOADING"
  | "EVIDENCE_VALIDATION"
  | "SAMPLE_ASSESSMENT"
  | "STATISTICAL_ASSESSMENT"
  | "OOS_ASSESSMENT"
  | "STRESS_ASSESSMENT"
  | "DRIFT_ASSESSMENT"
  | "RISK_ASSESSMENT"
  | "OPERATIONAL_ASSESSMENT"
  | "SAFETY_ASSESSMENT"
  | "DECISION_GENERATION"
  | "REPORT_FROZEN"
  | "VALIDATION_BLOCKED"
  | "EVIDENCE_CORRUPTED"
  | "INSUFFICIENT_EVIDENCE";

export interface Phase36EvidenceInput {
  finalResearchReport: Phase35FinalResearchReport;
  evidenceRegistry: readonly Phase35EvidenceArtifact[];
  evidenceManifest: any;
  safetyAudit: SafetyAuditSnapshot;
  reproducibilityManifest: any;
}

export interface SampleSufficiencyResult {
  sufficient: boolean;
  genuineSessions: number;
  genuineTrades: number;
  activeSessions: number;
  oosTrades: number;
  longHorizonSessions: number;
  reasons: string[];
}

export interface MetricAssessment {
  metricName: string;
  value: number | string;
  classification: EvidenceClassification;
  notes: string;
}

export interface ConfidenceIntervalAssessment {
  winRate95CI: { lowerBoundPct: number; upperBoundPct: number };
  bootstrapExpectancy95CI: { lower: number; upper: number };
  ciWidthRatio: number;
  notes: string;
}

export interface StatisticalAssessmentResult {
  winRate: MetricAssessment;
  expectancy: MetricAssessment;
  profitFactor: MetricAssessment;
  drawdown: MetricAssessment;
  confidenceIntervals: ConfidenceIntervalAssessment;
  uncertainty: "LOW" | "MODERATE" | "HIGH";
  notes: string[];
}

export type OOSClassificationState = "STABLE" | "MIXED" | "DEGRADED" | "INSUFFICIENT_DATA";

export interface OOSAssessmentResult {
  classification: OOSClassificationState;
  expectancyDegradationPct: number;
  winRateDifferencePct: number;
  profitFactorDifference: number;
  drawdownDifferenceInr: number;
  walkForwardConsistency: string;
  reasons: string[];
}

export interface StressAssessmentResult {
  scenariosTested: number;
  scenariosPassing: number;
  scenariosDegraded: number;
  dataQualityBlocks: number;
  tailLossExposure: number;
  conclusions: string[];
}

export type DriftClassificationState = "NO_MEASURABLE_DRIFT" | "POSSIBLE_DRIFT" | "MATERIAL_DRIFT" | "INSUFFICIENT_DATA";

export interface DriftAssessmentResult {
  classification: DriftClassificationState;
  winRateDrift: number;
  expectancyDrift: number;
  profitFactorDrift: number;
  drawdownDrift: number;
  reasons: string[];
}

export interface RiskAssessmentResult {
  dailyProfitCapMet: boolean;
  dailyLossCapMet: boolean;
  maxLossPerTradeMet: boolean;
  riskLockEvents: number;
  emergencyExits: number;
  pnlReconciliationStatus: "PASS" | "FAIL";
  historicalViolationsCount: number;
  violationsDetails: string[];
}

export interface OperationalAssessmentResult {
  totalIncidents: number;
  recoverableIncidents: number;
  unresolvedIncidents: number;
  duplicateRiskDetected: boolean;
  reconciliationPassed: boolean;
  overallStatus: "STABLE" | "UNSTABLE";
}

export interface SafetyGateResult {
  safetyPassed: boolean;
  paperTradingEnabled: boolean;
  liveTradingDisabled: boolean;
  brokerExecutionDisabled: boolean;
  realDataOnly: boolean;
  realBrokerOrdersCount: 0;
  placeOrderBlocked: boolean;
  modifyOrderBlocked: boolean;
  cancelOrderBlocked: boolean;
  violations: string[];
}

export interface Phase36DecisionReport {
  reportTitle: "PHASE 36 — EVIDENCE-BASED DECISION GATE REPORT";
  reportId: string;
  state: Phase36State;
  decision: Phase36DecisionOutput;
  masterStrategyFingerprint: string;
  sections: {
    executiveEvidenceSummary: any;
    evidenceIntegrity: any;
    sampleSufficiency: SampleSufficiencyResult;
    statisticalAssessment: StatisticalAssessmentResult;
    confidenceIntervals: ConfidenceIntervalAssessment;
    oosAssessment: OOSAssessmentResult;
    walkForwardAssessment: any;
    stressAssessment: StressAssessmentResult;
    longHorizonDrift: DriftAssessmentResult;
    riskBehaviour: RiskAssessmentResult;
    operationalStability: OperationalAssessmentResult;
    dataQuality: any;
    pnlReconciliation: any;
    strategyFingerprint: any;
    safetyAudit: SafetyGateResult;
    missingEvidence: string[];
    uncertainty: "LOW" | "MODERATE" | "HIGH";
    decisionGate: {
      finalDecision: Phase36DecisionOutput;
      disclaimer: string;
    };
    reproducibility: any;
    immutableHashManifest: any;
  };
  snapshot: Phase35EvidenceSnapshot;
  generatedAt: string;
  disclaimer: string;
}
