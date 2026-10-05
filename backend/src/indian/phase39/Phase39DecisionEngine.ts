import {
  Phase39State,
  SampleGateProgress,
  TimestampAuditResult,
  LeakageAuditResult,
  PnLAuditResult,
  StatisticalAuditResult,
  OOSAuditResult,
  WalkForwardAuditResult,
  StressAuditResult,
  DriftAuditResult,
  SafetyAuditResult,
} from "./Phase39Types";

export class Phase39DecisionEngine {
  public static evaluateState(input: {
    sampleGate: SampleGateProgress;
    timestampAudit?: TimestampAuditResult;
    leakageAudit?: LeakageAuditResult;
    pnlAudit?: PnLAuditResult;
    statisticalAudit?: StatisticalAuditResult;
    oosAudit?: OOSAuditResult;
    stressAudit?: StressAuditResult;
    driftAudit?: DriftAuditResult;
    safetyAudit?: SafetyAuditResult;
    strategyFingerprintMatch?: boolean;
    frozen?: boolean;
  }): Phase39State {
    // 1. Sample Gate Check
    if (!input.sampleGate.gatePassed) {
      return "VALIDATION_BLOCKED_INSUFFICIENT_SAMPLE";
    }

    // 2. Integrity Audit Check (Timestamp, Leakage, PnL, Fingerprint)
    if (input.timestampAudit && !input.timestampAudit.passed) {
      return "REVALIDATION_FAILED";
    }
    if (input.leakageAudit && (!input.leakageAudit.passed || input.leakageAudit.contaminationDetected)) {
      return "REVALIDATION_FAILED";
    }
    if (input.pnlAudit && input.pnlAudit.status === "FAIL") {
      return "REVALIDATION_FAILED";
    }
    if (input.strategyFingerprintMatch === false) {
      return "REVALIDATION_FAILED";
    }

    // 3. Safety Audit Check
    if (input.safetyAudit && !input.safetyAudit.passed) {
      return "REVALIDATION_FAILED";
    }

    // 4. Cohort Frozen check
    if (input.frozen) {
      return "EVIDENCE_FREEZE_COMPLETE";
    }

    return "REVALIDATION_COMPLETE";
  }
}
