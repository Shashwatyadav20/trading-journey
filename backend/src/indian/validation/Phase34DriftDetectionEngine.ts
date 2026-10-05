import { Phase34DailyObservationRecord } from "./Phase34DailyObservationStore";

export type DriftStatus = "NO_MEASURABLE_DRIFT" | "POSSIBLE_DRIFT" | "MATERIAL_DRIFT" | "INSUFFICIENT_DATA";

export interface Phase34DriftMetrics {
  winRateDifference: number; // percentage points
  expectancyDifference: number; // ₹
  profitFactorDifference: number | "NOT_AVAILABLE";
  averagePnLDifference: number; // ₹
  drawdownDifference: number; // ₹
  tradeFrequencyDifferencePct: number;
  noTradeFrequencyDifferencePct: number;
  driftStatus: DriftStatus;
}

export interface DistributionDriftItem {
  key: string;
  baselinePct: number;
  longHorizonPct: number;
  differencePct: number;
}

export interface Phase34DriftReport {
  metricsDrift: Phase34DriftMetrics;
  regimeDrift: DistributionDriftItem[];
  strategyDrift: DistributionDriftItem[];
  driftStatus: DriftStatus;
  summaryText: string;
  generatedAt: string;
  disclaimer: "DRIFT DETECTION IS AN OPERATIONAL OBSERVATION. IT DOES NOT TRIGGER AUTOMATIC PARAMETER OPTIMIZATION OR STRATEGY ALTERATION.";
}

export class Phase34DriftDetectionEngine {
  /**
   * Compares long-horizon observations against Phase 31/32 baseline to quantify drift.
   */
  public calculateDrift(
    baselineStats: {
      winRate: number;
      expectancy: number;
      profitFactor: number | "NOT_AVAILABLE";
      averagePnL: number;
      maxDrawdown: number;
      tradesPerSession: number;
      noTradeRatioPct: number;
    },
    currentObs: readonly Phase34DailyObservationRecord[],
    baselineRegimes: Record<string, number> = {},
    baselineStrategies: Record<string, number> = {}
  ): Phase34DriftReport {
    const totalSessions = currentObs.length;
    if (totalSessions < 20) {
      return {
        metricsDrift: {
          winRateDifference: 0,
          expectancyDifference: 0,
          profitFactorDifference: "NOT_AVAILABLE",
          averagePnLDifference: 0,
          drawdownDifference: 0,
          tradeFrequencyDifferencePct: 0,
          noTradeFrequencyDifferencePct: 0,
          driftStatus: "INSUFFICIENT_DATA",
        },
        regimeDrift: [],
        strategyDrift: [],
        driftStatus: "INSUFFICIENT_DATA",
        summaryText: `Insufficient long-horizon sample (${totalSessions} sessions < 20 minimum required). Drift detection pending.`,
        generatedAt: new Date().toISOString(),
        disclaimer: "DRIFT DETECTION IS AN OPERATIONAL OBSERVATION. IT DOES NOT TRIGGER AUTOMATIC PARAMETER OPTIMIZATION OR STRATEGY ALTERATION.",
      };
    }

    const currentStats = this.computeLongHorizonStats(currentObs);

    const winRateDiff = Number((currentStats.winRate - baselineStats.winRate).toFixed(2));
    const expectancyDiff = Number((currentStats.expectancy - baselineStats.expectancy).toFixed(2));
    const avgPnLDiff = Number((currentStats.averagePnL - baselineStats.averagePnL).toFixed(2));
    const drawdownDiff = Number((currentStats.maxDrawdown - baselineStats.maxDrawdown).toFixed(2));

    let pfDiff: number | "NOT_AVAILABLE" = "NOT_AVAILABLE";
    if (typeof baselineStats.profitFactor === "number" && typeof currentStats.profitFactor === "number") {
      pfDiff = Number((currentStats.profitFactor - baselineStats.profitFactor).toFixed(2));
    }

    const tradeFreqDiffPct = baselineStats.tradesPerSession > 0
      ? Number((((currentStats.tradesPerSession - baselineStats.tradesPerSession) / baselineStats.tradesPerSession) * 100).toFixed(2))
      : 0;

    const noTradeDiffPct = Number((currentStats.noTradeRatioPct - baselineStats.noTradeRatioPct).toFixed(2));

    // Evaluate Drift Status
    let driftStatus: DriftStatus = "NO_MEASURABLE_DRIFT";
    const absWinDiff = Math.abs(winRateDiff);
    const absExpDiff = Math.abs(expectancyDiff);

    if (absWinDiff > 15 || absExpDiff > 300) {
      driftStatus = "MATERIAL_DRIFT";
    } else if (absWinDiff > 5 || absExpDiff > 100) {
      driftStatus = "POSSIBLE_DRIFT";
    }

    // Distribution Drift calculations
    const regimeDrift = this.calculateDistributionDrift(baselineRegimes, currentStats.regimeCounts, totalSessions);
    const strategyDrift = this.calculateDistributionDrift(baselineStrategies, currentStats.strategyCounts, currentStats.totalTrades);

    return {
      metricsDrift: {
        winRateDifference: winRateDiff,
        expectancyDifference: expectancyDiff,
        profitFactorDifference: pfDiff,
        averagePnLDifference: avgPnLDiff,
        drawdownDifference: drawdownDiff,
        tradeFrequencyDifferencePct: tradeFreqDiffPct,
        noTradeFrequencyDifferencePct: noTradeDiffPct,
        driftStatus,
      },
      regimeDrift,
      strategyDrift,
      driftStatus,
      summaryText: `Drift analysis complete with status: ${driftStatus}. Win rate diff: ${winRateDiff} pp, Expectancy diff: ₹${expectancyDiff}. Recorded for observational monitoring.`,
      generatedAt: new Date().toISOString(),
      disclaimer: "DRIFT DETECTION IS AN OPERATIONAL OBSERVATION. IT DOES NOT TRIGGER AUTOMATIC PARAMETER OPTIMIZATION OR STRATEGY ALTERATION.",
    };
  }

  private computeLongHorizonStats(records: readonly Phase34DailyObservationRecord[]) {
    const totalSessions = records.length;
    let totalTrades = 0;
    let wins = 0;
    let grossWin = 0;
    let grossLoss = 0;
    let netPnL = 0;
    let noTradeCount = 0;

    let peak = 0;
    let currentEquity = 0;
    let maxDrawdown = 0;

    const regimeCounts: Record<string, number> = {};
    const strategyCounts: Record<string, number> = {};

    for (const r of records) {
      totalTrades += r.tradeCount;
      wins += r.winCount;
      const net = r.netPnL;
      netPnL += net;

      if (r.noTradeStatus) noTradeCount++;
      if (net > 0) grossWin += net;
      else if (net < 0) grossLoss += Math.abs(net);

      currentEquity += net;
      if (currentEquity > peak) peak = currentEquity;
      const dd = peak - currentEquity;
      if (dd > maxDrawdown) maxDrawdown = dd;
    }

    const winRate = totalTrades > 0 ? Number(((wins / totalTrades) * 100).toFixed(2)) : 0;
    const expectancy = totalTrades > 0 ? Number((netPnL / totalTrades).toFixed(2)) : 0;
    const averagePnL = totalSessions > 0 ? Number((netPnL / totalSessions).toFixed(2)) : 0;
    const profitFactor = grossLoss === 0 ? (grossWin > 0 ? 999.99 : "NOT_AVAILABLE") : Number((grossWin / grossLoss).toFixed(2));
    const tradesPerSession = Number((totalTrades / totalSessions).toFixed(2));
    const noTradeRatioPct = Number(((noTradeCount / totalSessions) * 100).toFixed(2));

    return {
      totalSessions,
      totalTrades,
      winRate,
      expectancy,
      averagePnL,
      profitFactor,
      maxDrawdown: Number(maxDrawdown.toFixed(2)),
      tradesPerSession,
      noTradeRatioPct,
      regimeCounts,
      strategyCounts,
    };
  }

  private calculateDistributionDrift(
    baseline: Record<string, number>,
    current: Record<string, number>,
    totalCount: number
  ): DistributionDriftItem[] {
    const keys = Array.from(new Set([...Object.keys(baseline), ...Object.keys(current)]));
    return keys.map((key) => {
      const basePct = baseline[key] ?? 0;
      const currentCount = current[key] ?? 0;
      const currPct = totalCount > 0 ? Number(((currentCount / totalCount) * 100).toFixed(2)) : 0;
      return {
        key,
        baselinePct: basePct,
        longHorizonPct: currPct,
        differencePct: Number((currPct - basePct).toFixed(2)),
      };
    });
  }
}

export const phase34DriftDetectionEngine = new Phase34DriftDetectionEngine();
