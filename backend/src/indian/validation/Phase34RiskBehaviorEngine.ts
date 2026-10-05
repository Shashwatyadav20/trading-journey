import { Phase34DailyObservationRecord } from "./Phase34DailyObservationStore";

export interface Phase34RiskBehaviorSummary {
  profitLockEvents: number;
  lossLockEvents: number;
  emergencyLockEvents: number;
  consecutiveLossEvents: number;
  maxConsecutiveLosses: number;
  maxDrawdownInr: number;
  maxDailyLossInr: number;
  maxDailyGainInr: number;
  emergencyExits: number;
  greekRiskExits: number;
  sessionCloseExits: number;
  totalSessionsEvaluated: number;
  riskLockFrequencyPct: number;
}

export class Phase34RiskBehaviorEngine {
  /**
   * Analyzes risk behavior across long-horizon daily observations.
   */
  public analyzeRiskBehavior(records: readonly Phase34DailyObservationRecord[]): Phase34RiskBehaviorSummary {
    const totalSessions = records.length;
    if (totalSessions === 0) {
      return {
        profitLockEvents: 0,
        lossLockEvents: 0,
        emergencyLockEvents: 0,
        consecutiveLossEvents: 0,
        maxConsecutiveLosses: 0,
        maxDrawdownInr: 0,
        maxDailyLossInr: 0,
        maxDailyGainInr: 0,
        emergencyExits: 0,
        greekRiskExits: 0,
        sessionCloseExits: 0,
        totalSessionsEvaluated: 0,
        riskLockFrequencyPct: 0,
      };
    }

    let profitLockEvents = 0;
    let lossLockEvents = 0;
    let emergencyLockEvents = 0;
    let maxDailyLossInr = 0;
    let maxDailyGainInr = 0;

    let peak = 0;
    let currentEquity = 0;
    let maxDrawdownInr = 0;

    let currentConsecutiveLosses = 0;
    let maxConsecutiveLosses = 0;
    let consecutiveLossEvents = 0;

    for (const r of records) {
      if (r.riskLock === "PROFIT_LOCK") profitLockEvents++;
      else if (r.riskLock === "LOSS_LOCK") lossLockEvents++;
      else if (r.riskLock === "EMERGENCY_LOCK") emergencyLockEvents++;

      if (r.netPnL > maxDailyGainInr) maxDailyGainInr = r.netPnL;
      if (r.netPnL < maxDailyLossInr) maxDailyLossInr = r.netPnL;

      if (r.lossCount > 0) {
        currentConsecutiveLosses += r.lossCount;
        consecutiveLossEvents++;
        if (currentConsecutiveLosses > maxConsecutiveLosses) {
          maxConsecutiveLosses = currentConsecutiveLosses;
        }
      } else if (r.winCount > 0) {
        currentConsecutiveLosses = 0;
      }

      currentEquity += r.netPnL;
      if (currentEquity > peak) peak = currentEquity;
      const dd = peak - currentEquity;
      if (dd > maxDrawdownInr) maxDrawdownInr = dd;
    }

    const lockedSessionsCount = profitLockEvents + lossLockEvents + emergencyLockEvents;
    const riskLockFrequencyPct = Number(((lockedSessionsCount / totalSessions) * 100).toFixed(2));

    return {
      profitLockEvents,
      lossLockEvents,
      emergencyLockEvents,
      consecutiveLossEvents,
      maxConsecutiveLosses,
      maxDrawdownInr: Number(maxDrawdownInr.toFixed(2)),
      maxDailyLossInr: Number(maxDailyLossInr.toFixed(2)),
      maxDailyGainInr: Number(maxDailyGainInr.toFixed(2)),
      emergencyExits: emergencyLockEvents,
      greekRiskExits: 0,
      sessionCloseExits: totalSessions,
      totalSessionsEvaluated: totalSessions,
      riskLockFrequencyPct,
    };
  }
}

export const phase34RiskBehaviorEngine = new Phase34RiskBehaviorEngine();
