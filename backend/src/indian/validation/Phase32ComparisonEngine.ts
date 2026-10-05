export interface Phase32ComparisonRow {
  metric: string;
  phase31InSample: string | number;
  phase32OOS: string | number;
  difference: string | number;
}

export interface Phase32PerformanceDegradation {
  winRateDifference: number; // percentage points (OOS - IS)
  expectancyDifference: number; // ₹ (OOS - IS)
  profitFactorDifference: number | "NOT_AVAILABLE";
  drawdownDifference: number; // ₹ (OOS - IS)
  averagePnLDifference: number; // ₹ (OOS - IS)
}

export interface Phase32ComparisonReport {
  comparisonTable: Phase32ComparisonRow[];
  degradation: Phase32PerformanceDegradation;
  summaryText: string;
  generatedAt: string;
}

export class Phase32ComparisonEngine {
  /**
   * Generates side-by-side comparison table between Phase 31 In-Sample baseline and Phase 32 OOS statistics.
   * Reports factual numerical differences ONLY.
   * NEVER labels metrics as BEST, WORST, WINNER, or FAILED STRATEGY.
   */
  public compareInSampleVsOOS(
    inSampleStats: {
      trades: number;
      winRate: number;
      grossPnL?: number;
      netPnL: number;
      expectancy: number;
      profitFactor: number | "NOT_AVAILABLE";
      maxDrawdown: number;
      averagePnL?: number;
    },
    oosStats: {
      trades: number;
      winRate: number;
      grossPnL?: number;
      netPnL: number;
      expectancy: number;
      profitFactor: number | "NOT_AVAILABLE";
      maxDrawdown: number;
      averagePnL?: number;
    }
  ): Phase32ComparisonReport {
    const isWinRate = inSampleStats.winRate;
    const oosWinRate = oosStats.winRate;
    const winRateDiff = Number((oosWinRate - isWinRate).toFixed(2));

    const isExpectancy = inSampleStats.expectancy;
    const oosExpectancy = oosStats.expectancy;
    const expectancyDiff = Number((oosExpectancy - isExpectancy).toFixed(2));

    const isNetPnL = inSampleStats.netPnL;
    const oosNetPnL = oosStats.netPnL;
    const netPnLDiff = Number((oosNetPnL - isNetPnL).toFixed(2));

    const isDrawdown = inSampleStats.maxDrawdown;
    const oosDrawdown = oosStats.maxDrawdown;
    const drawdownDiff = Number((oosDrawdown - isDrawdown).toFixed(2));

    const isAvgPnL = inSampleStats.averagePnL ?? (inSampleStats.trades > 0 ? isNetPnL / inSampleStats.trades : 0);
    const oosAvgPnL = oosStats.averagePnL ?? (oosStats.trades > 0 ? oosNetPnL / oosStats.trades : 0);
    const avgPnLDiff = Number((oosAvgPnL - isAvgPnL).toFixed(2));

    let pfDiff: number | "NOT_AVAILABLE" = "NOT_AVAILABLE";
    if (typeof inSampleStats.profitFactor === "number" && typeof oosStats.profitFactor === "number") {
      pfDiff = Number((oosStats.profitFactor - inSampleStats.profitFactor).toFixed(2));
    }

    const comparisonTable: Phase32ComparisonRow[] = [
      {
        metric: "Trades",
        phase31InSample: inSampleStats.trades,
        phase32OOS: oosStats.trades,
        difference: oosStats.trades - inSampleStats.trades,
      },
      {
        metric: "Win Rate (%)",
        phase31InSample: `${isWinRate.toFixed(1)}%`,
        phase32OOS: `${oosWinRate.toFixed(1)}%`,
        difference: `${winRateDiff >= 0 ? "+" : ""}${winRateDiff.toFixed(1)} pp`,
      },
      {
        metric: "Net P&L (₹)",
        phase31InSample: `₹${isNetPnL.toFixed(2)}`,
        phase32OOS: `₹${oosNetPnL.toFixed(2)}`,
        difference: `₹${netPnLDiff >= 0 ? "+" : ""}${netPnLDiff.toFixed(2)}`,
      },
      {
        metric: "Expectancy (₹)",
        phase31InSample: `₹${isExpectancy.toFixed(2)}`,
        phase32OOS: `₹${oosExpectancy.toFixed(2)}`,
        difference: `₹${expectancyDiff >= 0 ? "+" : ""}${expectancyDiff.toFixed(2)}`,
      },
      {
        metric: "Profit Factor",
        phase31InSample: typeof inSampleStats.profitFactor === "number" ? inSampleStats.profitFactor.toFixed(2) : "N/A",
        phase32OOS: typeof oosStats.profitFactor === "number" ? oosStats.profitFactor.toFixed(2) : "N/A",
        difference: typeof pfDiff === "number" ? `${pfDiff >= 0 ? "+" : ""}${pfDiff.toFixed(2)}` : "N/A",
      },
      {
        metric: "Max Drawdown (₹)",
        phase31InSample: `₹${isDrawdown.toFixed(2)}`,
        phase32OOS: `₹${oosDrawdown.toFixed(2)}`,
        difference: `₹${drawdownDiff >= 0 ? "+" : ""}${drawdownDiff.toFixed(2)}`,
      },
      {
        metric: "Average P&L (₹)",
        phase31InSample: `₹${isAvgPnL.toFixed(2)}`,
        phase32OOS: `₹${oosAvgPnL.toFixed(2)}`,
        difference: `₹${avgPnLDiff >= 0 ? "+" : ""}${avgPnLDiff.toFixed(2)}`,
      },
    ];

    const degradation: Phase32PerformanceDegradation = {
      winRateDifference: winRateDiff,
      expectancyDifference: expectancyDiff,
      profitFactorDifference: pfDiff,
      drawdownDifference: drawdownDiff,
      averagePnLDifference: avgPnLDiff,
    };

    return {
      comparisonTable,
      degradation,
      summaryText: `Descriptive comparison complete. Win rate diff: ${winRateDiff} pp, Expectancy diff: ₹${expectancyDiff}. Numerical differences reported without automatic quality classification.`,
      generatedAt: new Date().toISOString(),
    };
  }
}

export const phase32ComparisonEngine = new Phase32ComparisonEngine();
