import { Phase39TradeRecord, DriftAuditResult } from "./Phase39Types";

export class Phase39DriftRevalidator {
  public static auditDrift(trades: Phase39TradeRecord[], requiredMinTrades = 30): DriftAuditResult {
    if (trades.length < requiredMinTrades) {
      return {
        status: "INSUFFICIENT_DATA",
        winRateDriftPct: 0,
        expectancyDriftPct: 0,
        profitFactorDriftPct: 0,
        drawdownDriftPct: 0,
      };
    }

    const firstHalf = trades.slice(0, Math.floor(trades.length / 2));
    const secondHalf = trades.slice(Math.floor(trades.length / 2));

    const winRate1 = firstHalf.filter((t) => t.netPnL > 0).length / firstHalf.length;
    const winRate2 = secondHalf.filter((t) => t.netPnL > 0).length / secondHalf.length;

    const winRateDriftPct = Number((((winRate2 - winRate1) / (winRate1 || 1)) * 100).toFixed(2));

    const exp1 = firstHalf.reduce((a, b) => a + b.netPnL, 0) / firstHalf.length;
    const exp2 = secondHalf.reduce((a, b) => a + b.netPnL, 0) / secondHalf.length;

    const expectancyDriftPct = Number((((exp2 - exp1) / (Math.abs(exp1) || 1)) * 100).toFixed(2));

    const status = Math.abs(winRateDriftPct) > 25 || Math.abs(expectancyDriftPct) > 35 ? "MATERIAL_DRIFT" : "NO_MEASURABLE_DRIFT";

    return {
      status,
      winRateDriftPct,
      expectancyDriftPct,
      profitFactorDriftPct: 0,
      drawdownDriftPct: 0,
    };
  }
}
