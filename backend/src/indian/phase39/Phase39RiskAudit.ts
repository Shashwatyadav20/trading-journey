import { Phase39TradeRecord, Phase39SessionRecord, RiskAuditResult } from "./Phase39Types";

export class Phase39RiskAudit {
  public static auditRisk(
    trades: Phase39TradeRecord[],
    sessions: Phase39SessionRecord[]
  ): RiskAuditResult {
    const maxLossViolations: string[] = [];
    const dailyProfitLockViolations: string[] = [];
    const dailyLossLockViolations: string[] = [];
    const maxTradesViolations: string[] = [];
    const consecutiveLossesViolations: string[] = [];
    const hedgeFirstViolations: string[] = [];
    const nakedShortViolations: string[] = [];
    const duplicateViolations: string[] = [];
    const staleDataViolations: string[] = [];
    const sessionGateViolations: string[] = [];
    const lotSizeViolations: string[] = [];
    const greekGateViolations: string[] = [];

    const tradeIdSet = new Set<string>();

    // 1. Per-trade risk checks
    for (const trade of trades) {
      if (tradeIdSet.has(trade.tradeId)) {
        duplicateViolations.push(`Duplicate trade ID: ${trade.tradeId}`);
      }
      tradeIdSet.add(trade.tradeId);

      // Max Loss <= ₹1,000 / trade
      if (trade.netPnL < -1000) {
        maxLossViolations.push(`Trade ${trade.tradeId}: Net loss ₹${trade.netPnL} exceeded max loss threshold of -₹1,000.`);
      }

      // Check for synthetic / non-genuine data
      if (trade.isSynthetic) {
        staleDataViolations.push(`Trade ${trade.tradeId}: Synthetic data detected in risk audit.`);
      }

      // Greek gate
      if (trade.greeksAtEntry) {
        if (Math.abs(trade.greeksAtEntry.delta || 0) > 0.6) {
          greekGateViolations.push(`Trade ${trade.tradeId}: Delta ${trade.greeksAtEntry.delta} exceeded delta safety gate.`);
        }
      }
    }

    // 2. Daily Session Risk checks
    for (const session of sessions) {
      if (session.totalTrades > 3) {
        maxTradesViolations.push(`Session ${session.sessionId}: Executed ${session.totalTrades} trades (max limit = 3).`);
      }
      if (session.netPnL < -5000) {
        dailyLossLockViolations.push(`Session ${session.sessionId}: Daily loss ₹${session.netPnL} exceeded daily loss lock cap of -₹5,000.`);
      }
      if (session.netPnL > 1000 && session.totalTrades > 3) {
        dailyProfitLockViolations.push(`Session ${session.sessionId}: Traded after daily profit lock target ₹1,000 reached.`);
      }
    }

    const allViolations = [
      ...maxLossViolations,
      ...dailyProfitLockViolations,
      ...dailyLossLockViolations,
      ...maxTradesViolations,
      ...consecutiveLossesViolations,
      ...hedgeFirstViolations,
      ...nakedShortViolations,
      ...duplicateViolations,
      ...staleDataViolations,
      ...sessionGateViolations,
      ...lotSizeViolations,
      ...greekGateViolations,
    ];

    return {
      passed: allViolations.length === 0,
      maxLossViolations,
      dailyProfitLockViolations,
      dailyLossLockViolations,
      maxTradesViolations,
      consecutiveLossesViolations,
      hedgeFirstViolations,
      nakedShortViolations,
      duplicateViolations,
      staleDataViolations,
      sessionGateViolations,
      lotSizeViolations,
      greekGateViolations,
      allViolations,
    };
  }
}
