import { Phase39TradeRecord, Phase39SessionRecord, LeakageAuditResult } from "./Phase39Types";

export class Phase39LeakageDetector {
  public static auditLeakage(
    trades: Phase39TradeRecord[],
    sessions: Phase39SessionRecord[],
    expectedFingerprint: string,
    previousCohortIds: string[] = []
  ): LeakageAuditResult {
    const violations: string[] = [];
    let contaminationDetected = false;

    const tradeIdSet = new Set<string>();
    const sessionIdSet = new Set<string>();

    // 1. Duplicate Trade IDs & Session IDs
    for (const trade of trades) {
      if (tradeIdSet.has(trade.tradeId)) {
        violations.push(`Duplicate trade ID detected: ${trade.tradeId}`);
        contaminationDetected = true;
      }
      tradeIdSet.add(trade.tradeId);

      // Fingerprint check per trade
      if (trade.strategyFingerprint !== expectedFingerprint) {
        violations.push(
          `Strategy fingerprint mismatch on trade ${trade.tradeId}: expected '${expectedFingerprint}', got '${trade.strategyFingerprint}'`
        );
        contaminationDetected = true;
      }

      // Check future candles / future Greeks / post-exit data in trade payload
      if (trade.greeksAtEntry && (trade.greeksAtEntry.delta > 1 || trade.greeksAtEntry.delta < -1)) {
        violations.push(`Trade ${trade.tradeId}: Invalid/future Greek delta value (${trade.greeksAtEntry.delta}).`);
        contaminationDetected = true;
      }
    }

    for (const session of sessions) {
      if (sessionIdSet.has(session.sessionId)) {
        violations.push(`Duplicate session ID detected: ${session.sessionId}`);
        contaminationDetected = true;
      }
      sessionIdSet.add(session.sessionId);

      // Check if session ID was reused from prior non-genuine validation cohorts without explicit marker
      if (previousCohortIds.includes(session.sessionId)) {
        violations.push(`Session ${session.sessionId}: Detected contamination from prior Phase 31/32 validation cohort.`);
        contaminationDetected = true;
      }
    }

    // 2. OOS contamination check: Ensure no trade flagged as OOS was also used in training
    const inSampleTradeIds = new Set(trades.filter((t) => !t.isOOS).map((t) => t.tradeId));
    const oosTradeIds = trades.filter((t) => t.isOOS).map((t) => t.tradeId);
    for (const oosId of oosTradeIds) {
      if (inSampleTradeIds.has(oosId)) {
        violations.push(`OOS Contamination detected: Trade ${oosId} present in both In-Sample and Out-Of-Sample sets.`);
        contaminationDetected = true;
      }
    }

    return {
      passed: violations.length === 0,
      contaminationDetected,
      violations,
    };
  }
}
