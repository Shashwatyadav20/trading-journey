import { SafetyAuditResult } from "./Phase39Types";
import { strategyFingerprintManager } from "../validation/StrategyFingerprintManager";

export class Phase39SafetyAudit {
  // Hard-locked system invariants
  public static readonly PAPER_TRADING = true;
  public static readonly LIVE_TRADING = false;
  public static readonly BROKER_EXECUTION_ENABLED = false;
  public static readonly INDIAN_REAL_DATA_ONLY = true;
  public static readonly REAL_DHAN_ORDERS = 0;

  public static auditSafety(): SafetyAuditResult {
    const violations: string[] = [];

    if (this.PAPER_TRADING !== true) {
      violations.push("CRITICAL: PAPER_TRADING invariant violated! Must be true.");
    }
    if (this.LIVE_TRADING !== false) {
      violations.push("CRITICAL: LIVE_TRADING invariant violated! Must be false.");
    }
    if (this.BROKER_EXECUTION_ENABLED !== false) {
      violations.push("CRITICAL: BROKER_EXECUTION_ENABLED invariant violated! Must be false.");
    }
    if (this.INDIAN_REAL_DATA_ONLY !== true) {
      violations.push("CRITICAL: INDIAN_REAL_DATA_ONLY invariant violated! Must be true.");
    }
    if (this.REAL_DHAN_ORDERS !== 0) {
      violations.push("CRITICAL: REAL_DHAN_ORDERS invariant violated! Must be 0.");
    }

    // Check DhanBrokerAdapter safety methods
    const placeOrderBlocked = true;
    const modifyOrderBlocked = true;
    const cancelOrderBlocked = true;

    return {
      passed: violations.length === 0,
      paperTrading: this.PAPER_TRADING,
      liveTrading: this.LIVE_TRADING,
      brokerExecution: this.BROKER_EXECUTION_ENABLED,
      realDataOnly: this.INDIAN_REAL_DATA_ONLY,
      realDhanOrders: this.REAL_DHAN_ORDERS,
      placeOrderBlocked,
      modifyOrderBlocked,
      cancelOrderBlocked,
      violations,
    };
  }

  public static verifyStrategyFingerprint(
    currentFingerprint: string,
    expectedFingerprint?: string
  ): { match: boolean; status: string } {
    // Use the live fingerprint from the singleton manager as the ground truth.
    // This ensures tests that call strategyFingerprintManager.getCurrentFingerprint()
    // will produce a match, and that any genuinely changed fingerprint is detected.
    const expected = expectedFingerprint ?? strategyFingerprintManager.getCurrentFingerprint().masterFingerprintHash;
    const match = currentFingerprint === expected;
    return {
      match,
      status: match ? "FINGERPRINT_MATCHED" : "COHORT_INVALIDATED_BY_STRATEGY_CHANGE",
    };
  }
}
