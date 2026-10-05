import crypto from "crypto";

// ── Safety Invariant State ──────────────────────────────────────────────────

export interface Phase37SafetyStatus {
  paperTrading: boolean;
  liveTrading: boolean;
  brokerExecution: boolean;
  realDataOnly: boolean;
  realDhanOrders: number;
  safetyInvariantPassed: boolean;
  violations: string[];
  verifiedAt: string;
}

// ── Evidence Registry ───────────────────────────────────────────────────────

export type Phase37EvidenceStatus =
  | "PASS"
  | "FAIL"
  | "DATA_UNAVAILABLE"
  | "SIMULATED"
  | "PENDING";

export type Phase37EvidenceCategory =
  | "STRESS_TESTING"
  | "LONG_HORIZON"
  | "EVIDENCE_REGISTRY"
  | "RECONCILIATION"
  | "RESEARCH_REPORT"
  | "DECISION_GATE"
  | "TEST_EVIDENCE"
  | "SAFETY_AUDIT";

export interface Phase37EvidenceItem {
  phase: 33 | 34 | 35 | 36;
  evidenceId: string;
  category: Phase37EvidenceCategory;
  status: Phase37EvidenceStatus;
  timestamp: string;
  source: string;
  immutableHash: string;
  description: string;
}

export interface Phase37PhaseEvidence {
  phase33: {
    testStatus: Phase37EvidenceStatus;
    stressValidationStatus: Phase37EvidenceStatus;
    evidenceStatus: Phase37EvidenceStatus;
  };
  phase34: {
    validationStatus: Phase37EvidenceStatus;
    scenarioResults: Phase37EvidenceStatus;
    evidenceStatus: Phase37EvidenceStatus;
  };
  phase35: {
    evidenceRegistryStatus: Phase37EvidenceStatus;
    reconciliationStatus: Phase37EvidenceStatus;
    researchReportStatus: Phase37EvidenceStatus;
  };
  phase36: {
    testCount: number;
    regressionCount: number;
    fixesApplied: number;
    finalValidationStatus: Phase37EvidenceStatus;
  };
  registry: readonly Phase37EvidenceItem[];
}

// ── Test Evidence ───────────────────────────────────────────────────────────

export interface Phase37TestEvidence {
  phase33Tests: number;
  phase34Tests: number;
  phase35Tests: number;
  phase36Tests: number;
  totalTests: number;
  failedTests: number;
  regressions: number;
  typescriptStatus: "PASS" | "FAIL" | "NOT_RUN";
  productionBuildStatus: "PASS" | "FAIL" | "NOT_RUN";
  recordedAt: string;
}

// ── Genuine Sample Gate ─────────────────────────────────────────────────────

export type Phase37SampleGateStatus = "INSUFFICIENT_SAMPLE" | "SAMPLE_COMPLETE";

export interface Phase37GenuineSampleGateResult {
  genuineSessions: number;
  requiredSessions: number;
  sessionsMet: boolean;

  genuineTrades: number;
  requiredTrades: number;
  tradesMet: boolean;

  activeSessions: number;
  requiredActiveSessions: number;
  activeSessionsMet: boolean;

  validationStatus: Phase37SampleGateStatus;
  evaluatedAt: string;
}

// ── Statistical Evidence Gate ───────────────────────────────────────────────

export interface Phase37StatisticalGateResult {
  sampleCompletionRequired: boolean;
  sampleComplete: boolean;
  gateOpen: boolean;
  metrics: {
    winRateCI: { lowerBoundPct: number; upperBoundPct: number } | null;
    bootstrapExpectancy: { lower: number; upper: number } | null;
    drawdownAnalysis: { maxDrawdown: number } | null;
    profitFactor: number | null;
  } | null;
  disclaimer: string;
  evaluatedAt: string;
}

// ── P&L Reconciliation ──────────────────────────────────────────────────────

export type Phase37ReconciliationStatus = "PASS" | "FAIL" | "DATA_UNAVAILABLE";

export interface Phase37ReconciliationResult {
  tradesPnL: Phase37ReconciliationStatus;
  dailyPnL: Phase37ReconciliationStatus;
  charges: Phase37ReconciliationStatus;
  slippage: Phase37ReconciliationStatus;
  exits: Phase37ReconciliationStatus;
  sessionTotals: Phase37ReconciliationStatus;
  sampleTotals: Phase37ReconciliationStatus;
  overallStatus: Phase37ReconciliationStatus;
  details: string[];
  reconciledAt: string;
}

// ── Strategy Fingerprint ────────────────────────────────────────────────────

export type Phase37FingerprintStatus =
  | "VALID"
  | "COHORT_INVALIDATED_BY_STRATEGY_CHANGE"
  | "FINGERPRINT_MISMATCH"
  | "NOT_ESTABLISHED";

export interface Phase37FingerprintResult {
  masterFingerprintHash: string;
  cohortId: string;
  fingerprintStatus: Phase37FingerprintStatus;
  immutable: boolean;
  verifiedAt: string;
  notes: string;
}

// ── Validation State Machine ────────────────────────────────────────────────

export type Phase37ValidationState =
  | "NOT_STARTED"
  | "INSUFFICIENT_SAMPLE"
  | "SAMPLE_COMPLETE"
  | "EVIDENCE_VALIDATED"
  | "FINAL_AUDIT_READY";

// ── Full Export ─────────────────────────────────────────────────────────────

export interface Phase37ExportPayload {
  exportTitle: "PHASE 37 — FINAL EVIDENCE CONSOLIDATION & VALIDATION CONTROL EXPORT";
  exportId: string;
  generatedAt: string;
  masterStrategyFingerprint: string;
  safetyState: Phase37SafetyStatus;
  phaseEvidence: Phase37PhaseEvidence;
  testEvidence: Phase37TestEvidence;
  genuineSampleGate: Phase37GenuineSampleGateResult;
  statisticalGate: Phase37StatisticalGateResult;
  reconciliation: Phase37ReconciliationResult;
  fingerprint: Phase37FingerprintResult;
  finalValidationState: Phase37ValidationState;
  exportHash: string;
  disclaimer: "PHASE 37 EVIDENCE CONSOLIDATION REPORT. PAPER_TRADING ONLY. DOES NOT AUTHORIZE LIVE TRADING OR BROKER EXECUTION.";
}

/** Computes deterministic SHA-256 hash for any JSON-serializable object. */
export function hashObject(obj: unknown): string {
  return crypto.createHash("sha256").update(JSON.stringify(obj)).digest("hex");
}
