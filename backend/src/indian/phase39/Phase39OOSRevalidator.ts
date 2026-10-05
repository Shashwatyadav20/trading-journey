import { Phase39TradeRecord, OOSAuditResult, WalkForwardAuditResult, WalkForwardResult } from "./Phase39Types";
import { Phase39StatisticalRecalculator } from "./Phase39StatisticalRecalculator";
import { PHASE39_CONFIG } from "./Phase39Config";

export class Phase39OOSRevalidator {
  public static auditOOS(trades: Phase39TradeRecord[]): OOSAuditResult {
    const inSampleTrades = trades.filter((t) => !t.isOOS);
    const oosTrades = trades.filter((t) => t.isOOS);

    if (inSampleTrades.length === 0 || oosTrades.length === 0) {
      return {
        passed: true,
        isExpectancy: inSampleTrades.length > 0 ? Phase39StatisticalRecalculator.calculateMetrics(inSampleTrades).expectancy : 0,
        oosExpectancy: 0,
        isWinRate: inSampleTrades.length > 0 ? Phase39StatisticalRecalculator.calculateMetrics(inSampleTrades).winRate : 0,
        oosWinRate: 0,
        isProfitFactor: inSampleTrades.length > 0 ? Phase39StatisticalRecalculator.calculateMetrics(inSampleTrades).profitFactor : 0,
        oosProfitFactor: 0,
        isDrawdown: inSampleTrades.length > 0 ? Phase39StatisticalRecalculator.calculateMetrics(inSampleTrades).maxDrawdown : 0,
        oosDrawdown: 0,
        degradationPct: 0,
        status: "INSUFFICIENT_DATA",
      };
    }

    const isMetrics = Phase39StatisticalRecalculator.calculateMetrics(inSampleTrades);
    const oosMetrics = Phase39StatisticalRecalculator.calculateMetrics(oosTrades);

    let degradationPct = 0;
    if (isMetrics.expectancy > 0) {
      degradationPct = Number(
        (Math.max(0, (isMetrics.expectancy - oosMetrics.expectancy) / isMetrics.expectancy) * 100).toFixed(2)
      );
    }

    const status = degradationPct > PHASE39_CONFIG.MAX_ALLOWED_OOS_DEGRADATION_PCT ? "DEGRADED" : "STABLE";

    return {
      passed: status === "STABLE",
      isExpectancy: isMetrics.expectancy,
      oosExpectancy: oosMetrics.expectancy,
      isWinRate: isMetrics.winRate,
      oosWinRate: oosMetrics.winRate,
      isProfitFactor: isMetrics.profitFactor,
      oosProfitFactor: oosMetrics.profitFactor,
      isDrawdown: isMetrics.maxDrawdown,
      oosDrawdown: oosMetrics.maxDrawdown,
      degradationPct,
      status,
    };
  }

  public static auditWalkForward(trades: Phase39TradeRecord[]): WalkForwardAuditResult {
    const windowMap = new Map<string, Phase39TradeRecord[]>();

    for (const trade of trades) {
      const windowId = trade.windowId || "DEFAULT_WINDOW";
      if (!windowMap.has(windowId)) {
        windowMap.set(windowId, []);
      }
      windowMap.get(windowId)!.push(trade);
    }

    if (windowMap.size === 0 || (windowMap.size === 1 && windowMap.has("DEFAULT_WINDOW"))) {
      return {
        passed: true,
        windows: [],
        overallStatus: "INSUFFICIENT_DATA",
      };
    }

    const windows: WalkForwardResult[] = [];
    let anyDegraded = false;

    for (const [windowId, windowTrades] of windowMap.entries()) {
      const metrics = Phase39StatisticalRecalculator.calculateMetrics(windowTrades);
      const timestamps = windowTrades.map((t) => t.entryTimestamp).sort();

      windows.push({
        windowId,
        trainingStart: timestamps[0] || "N/A",
        trainingEnd: timestamps[Math.floor(timestamps.length / 2)] || "N/A",
        testingStart: timestamps[Math.floor(timestamps.length / 2)] || "N/A",
        testingEnd: timestamps[timestamps.length - 1] || "N/A",
        tradeCount: windowTrades.length,
        expectancy: metrics.expectancy,
        winRate: metrics.winRate,
        profitFactor: metrics.profitFactor,
        maxDrawdown: metrics.maxDrawdown,
      });
    }

    return {
      passed: !anyDegraded,
      windows,
      overallStatus: "PASS",
    };
  }
}
