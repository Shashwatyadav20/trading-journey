import { Phase32OOSObservation } from "./Phase32DatasetManager";
import { GenuineTradeRecord } from "../persistence/GenuineSampleStore";
import { WalkForwardWindow } from "./Phase32WalkForwardEngine";

export interface LeakageViolation {
  type:
    | "FUTURE_TIMESTAMP"
    | "ANTI_HINDSIGHT_VIOLATION"
    | "TRAIN_TEST_OVERLAP"
    | "DUPLICATE_TRADE"
    | "DUPLICATE_SESSION"
    | "PHASE31_TRADE_REUSED"
    | "POST_DECISION_DATA"
    | "FINGERPRINT_MISMATCH"
    | "MANUAL_MODIFICATION";
  tradeId?: string;
  sessionId?: string;
  windowId?: string;
  details: string;
}

export interface Phase32LeakageReport {
  clean: boolean;
  leakageDetected: boolean;
  violations: LeakageViolation[];
  status: "PASS" | "FAIL";
  auditTrail: string[];
  checkedAt: string;
}

export class Phase32LeakageDetector {
  /**
   * Run comprehensive data leakage checks across OOS observations, Phase 31 in-sample cohort, and walk-forward windows.
   */
  public detectLeakage(
    oosObservations: readonly Phase32OOSObservation[],
    inSampleTrades: readonly GenuineTradeRecord[],
    masterFingerprint: string,
    walkForwardWindows: readonly WalkForwardWindow[] = [],
    referenceTimeMs?: number
  ): Phase32LeakageReport {
    const violations: LeakageViolation[] = [];
    const auditTrail: string[] = [];
    
    // Determine cutoff reference time for future timestamp checks
    let now = referenceTimeMs ?? new Date().getTime();
    if (!referenceTimeMs && oosObservations.length > 0) {
      // If referenceTimeMs is not explicitly provided, use max observation timestamp + 1 day
      const maxObsTs = Math.max(
        ...oosObservations.map((o) => new Date(o.exitTimestamp || o.entryTimestamp).getTime())
      );
      if (maxObsTs > now) {
        now = maxObsTs + 86400000;
      }
    }

    // Track Phase 31 trade IDs to detect reuse
    const phase31TradeIds = new Set(inSampleTrades.map((t) => t.tradeId));
    const oosTradeIds = new Set<string>();
    const oosSessionIds = new Set<string>();

    auditTrail.push(`Starting leakage detection across ${oosObservations.length} OOS records and ${inSampleTrades.length} Phase 31 records.`);

    for (const obs of oosObservations) {
      // 1. Check if Phase 31 trade is reused as OOS
      if (phase31TradeIds.has(obs.tradeId)) {
        const v: LeakageViolation = {
          type: "PHASE31_TRADE_REUSED",
          tradeId: obs.tradeId,
          details: `Phase 31 trade ${obs.tradeId} re-used in OOS dataset. In-sample and OOS must be mutually exclusive.`,
        };
        violations.push(v);
        auditTrail.push(`LEAKAGE DETECTED [PHASE31_TRADE_REUSED]: ${v.details}`);
      }

      // 2. Check for duplicate trade ID in OOS
      if (oosTradeIds.has(obs.tradeId)) {
        const v: LeakageViolation = {
          type: "DUPLICATE_TRADE",
          tradeId: obs.tradeId,
          details: `Duplicate OOS trade ID ${obs.tradeId} detected.`,
        };
        violations.push(v);
        auditTrail.push(`LEAKAGE DETECTED [DUPLICATE_TRADE]: ${v.details}`);
      } else {
        oosTradeIds.add(obs.tradeId);
      }

      // 3. Strategy fingerprint mismatch check
      if (obs.strategyFingerprint && obs.strategyFingerprint !== masterFingerprint) {
        const v: LeakageViolation = {
          type: "FINGERPRINT_MISMATCH",
          tradeId: obs.tradeId,
          details: `Observation fingerprint ${obs.strategyFingerprint} does not match master strategy lock ${masterFingerprint}.`,
        };
        violations.push(v);
        auditTrail.push(`LEAKAGE DETECTED [FINGERPRINT_MISMATCH]: ${v.details}`);
      }

      // 4. Timestamp Anti-Hindsight check
      // dataTimestamp <= decisionTimestamp <= entryTimestamp <= monitoringTimestamp <= exitTimestamp
      const dataTs = new Date(obs.dataTimestamp).getTime();
      const decisionTs = new Date(obs.decisionTimestamp).getTime();
      const entryTs = new Date(obs.entryTimestamp).getTime();
      const monitorTs = new Date(obs.monitoringTimestamp).getTime();
      const exitTs = new Date(obs.exitTimestamp).getTime();

      if (dataTs > decisionTs || decisionTs > entryTs || entryTs > monitorTs || monitorTs > exitTs) {
        const v: LeakageViolation = {
          type: "ANTI_HINDSIGHT_VIOLATION",
          tradeId: obs.tradeId,
          details: `Anti-hindsight timestamp sequence violation: data(${obs.dataTimestamp}) <= decision(${obs.decisionTimestamp}) <= entry(${obs.entryTimestamp}) <= monitoring(${obs.monitoringTimestamp}) <= exit(${obs.exitTimestamp}).`,
        };
        violations.push(v);
        auditTrail.push(`LEAKAGE DETECTED [ANTI_HINDSIGHT_VIOLATION]: ${v.details}`);
      }

      // 5. Future timestamp check
      if (dataTs > now + 300000 || entryTs > now + 300000) {
        const v: LeakageViolation = {
          type: "FUTURE_TIMESTAMP",
          tradeId: obs.tradeId,
          details: `Observation timestamp is set in the future relative to execution clock.`,
        };
        violations.push(v);
        auditTrail.push(`LEAKAGE DETECTED [FUTURE_TIMESTAMP]: ${v.details}`);
      }

      // 6. Post-decision data check (if validation flag indicates hindsight)
      if (obs.validationFlags && !obs.validationFlags.noHindsight) {
        const v: LeakageViolation = {
          type: "POST_DECISION_DATA",
          tradeId: obs.tradeId,
          details: `Observation flagged with post-decision data leakage (noHindsight = false).`,
        };
        violations.push(v);
        auditTrail.push(`LEAKAGE DETECTED [POST_DECISION_DATA]: ${v.details}`);
      }
    }

    // 7. Check Walk-Forward Train/Test window chronological overlap
    for (const wf of walkForwardWindows) {
      const trainStart = new Date(wf.trainingStart).getTime();
      const trainEnd = new Date(wf.trainingEnd).getTime();
      const testStart = new Date(wf.testingStart).getTime();
      const testEnd = new Date(wf.testingEnd).getTime();

      if (trainEnd > testStart) {
        const v: LeakageViolation = {
          type: "TRAIN_TEST_OVERLAP",
          windowId: wf.windowId,
          details: `Walk-Forward window ${wf.windowId} training end (${wf.trainingEnd}) exceeds testing start (${wf.testingStart}). Future data leaked into training period.`,
        };
        violations.push(v);
        auditTrail.push(`LEAKAGE DETECTED [TRAIN_TEST_OVERLAP]: ${v.details}`);
      }
    }

    const leakageDetected = violations.length > 0;
    auditTrail.push(`Leakage detection complete. Total violations: ${violations.length}. Status: ${leakageDetected ? "FAIL" : "PASS"}`);

    return {
      clean: !leakageDetected,
      leakageDetected,
      violations,
      status: leakageDetected ? "FAIL" : "PASS",
      auditTrail,
      checkedAt: new Date().toISOString(),
    };
  }
}

export const phase32LeakageDetector = new Phase32LeakageDetector();
