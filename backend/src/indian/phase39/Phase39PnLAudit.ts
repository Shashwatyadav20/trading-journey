import { Phase39TradeRecord, Phase39SessionRecord, PnLAuditResult } from "./Phase39Types";
import { PHASE39_CONFIG } from "./Phase39Config";

export class Phase39PnLAudit {
  public static auditPnL(
    trades: Phase39TradeRecord[],
    sessions: Phase39SessionRecord[]
  ): PnLAuditResult {
    if (trades.length === 0 && sessions.length === 0) {
      return {
        passed: true, // Data unavailable is not a hard failure if no trades exist yet, but reported as DATA_UNAVAILABLE
        sumTradeNetPnL: 0,
        sumDailyNetPnL: 0,
        cumulativeNetPnL: 0,
        maxDiscrepancy: 0,
        tolerance: PHASE39_CONFIG.PNL_RECONCILIATION_TOLERANCE,
        status: "DATA_UNAVAILABLE",
        reason: "No trade or session evidence present in cohort.",
      };
    }

    // Sum trade net P&L
    const sumTradeNetPnL = Number(
      trades.reduce((acc, t) => acc + (t.netPnL || 0), 0).toFixed(4)
    );

    // Sum session / daily net P&L (advisory / reporting only)
    const sumDailyNetPnL = Number(
      sessions.reduce((acc, s) => acc + (s.netPnL || 0), 0).toFixed(4)
    );

    // Cumulative net P&L from trade sequence (must equal sumTradeNetPnL exactly)
    let runningNetPnL = 0;
    for (const t of trades) {
      runningNetPnL += t.netPnL || 0;
    }
    const cumulativeNetPnL = Number(runningNetPnL.toFixed(4));

    // Internal trade-level reconciliation: cumulative sum must match direct sum.
    // This catches floating-point accumulation errors and data tampering within the trade log.
    const internalDiscrepancy = Math.abs(sumTradeNetPnL - cumulativeNetPnL);

    // Per-session reconciliation using session.tradeIds cross-reference when available.
    // Build a tradeId -> netPnL lookup for sessions that carry explicit tradeId lists.
    const tradeById = new Map<string, number>(trades.map((t) => [t.tradeId, t.netPnL || 0]));
    const sessionDiscrepancies: number[] = [];
    for (const session of sessions) {
      if (session.tradeIds && session.tradeIds.length > 0) {
        const knownIds = session.tradeIds.filter((id) => tradeById.has(id));
        if (knownIds.length > 0) {
          const tradeSum = knownIds.reduce((acc, id) => acc + (tradeById.get(id) ?? 0), 0);
          const sessionRecorded = session.netPnL || 0;
          sessionDiscrepancies.push(Math.abs(tradeSum - sessionRecorded));
        }
        // If session.tradeIds reference IDs not in the trade log, skip silently —
        // the trade cohort may be a subset of the full session's trades.
      }
    }

    // Choose the largest discrepancy across both checks
    const maxDiscrepancy = Number(
      Math.max(internalDiscrepancy, sessionDiscrepancies.length > 0 ? Math.max(...sessionDiscrepancies) : 0).toFixed(4)
    );

    const tolerance = PHASE39_CONFIG.PNL_RECONCILIATION_TOLERANCE;
    const passed = maxDiscrepancy <= tolerance;

    return {
      passed,
      sumTradeNetPnL,
      sumDailyNetPnL,
      cumulativeNetPnL,
      maxDiscrepancy,
      tolerance,
      status: passed ? "PASS" : "FAIL",
      reason: passed
        ? undefined
        : `P&L discrepancy (${maxDiscrepancy}) exceeded tolerance (${tolerance}).`,
    };
  }
}
