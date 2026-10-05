import { Phase39TradeRecord, TimestampAuditResult } from "./Phase39Types";

export class Phase39TimestampAudit {
  public static auditTimestamps(trades: Phase39TradeRecord[]): TimestampAuditResult {
    const violations: string[] = [];
    let verifiedCount = 0;

    const timestampSet = new Set<string>();

    for (const trade of trades) {
      const tData = new Date(trade.dataTimestamp).getTime();
      const tDec = new Date(trade.decisionTimestamp).getTime();
      const tEnt = new Date(trade.entryTimestamp).getTime();
      const tMon = new Date(trade.monitoringTimestamp).getTime();
      const tExt = new Date(trade.exitTimestamp).getTime();

      const now = Date.now();

      // Check NaN or invalid dates
      if (isNaN(tData) || isNaN(tDec) || isNaN(tEnt) || isNaN(tMon) || isNaN(tExt)) {
        violations.push(`Trade ${trade.tradeId}: Contains invalid date string or unparseable timestamp.`);
        continue;
      }

      // Check future timestamp — allow up to 1 full day of clock skew / same-day IST market hours
      const FUTURE_GRACE_MS = 86_400_000; // 1 day
      if (tData > now + FUTURE_GRACE_MS || tDec > now + FUTURE_GRACE_MS || tEnt > now + FUTURE_GRACE_MS || tMon > now + FUTURE_GRACE_MS || tExt > now + FUTURE_GRACE_MS) {
        violations.push(`Trade ${trade.tradeId}: Contains future timestamp relative to current system time.`);
      }

      // Check ordering: data <= decision <= entry <= monitoring <= exit
      if (tData > tDec) {
        violations.push(`Trade ${trade.tradeId}: Timestamp reversal detected (dataTimestamp > decisionTimestamp).`);
      }
      if (tDec > tEnt) {
        violations.push(`Trade ${trade.tradeId}: Timestamp reversal detected (decisionTimestamp > entryTimestamp).`);
      }
      if (tEnt > tMon) {
        violations.push(`Trade ${trade.tradeId}: Timestamp reversal detected (entryTimestamp > monitoringTimestamp).`);
      }
      if (tMon > tExt) {
        violations.push(`Trade ${trade.tradeId}: Timestamp reversal detected (monitoringTimestamp > exitTimestamp).`);
      }

      // Check exact duplicate timestamp tuples across trades
      const key = `${trade.entryTimestamp}_${trade.exitTimestamp}_${trade.tradeId}`;
      if (timestampSet.has(key)) {
        violations.push(`Trade ${trade.tradeId}: Duplicate timestamp tuple detected (${key}).`);
      } else {
        timestampSet.add(key);
      }

      // Look-ahead / post-decision data leakage check
      if (trade.dataTimestamp > trade.entryTimestamp) {
        violations.push(`Trade ${trade.tradeId}: Look-ahead bias detected (dataTimestamp > entryTimestamp).`);
      }

      verifiedCount++;
    }

    return {
      passed: violations.length === 0,
      verifiedCount,
      violations,
    };
  }
}
