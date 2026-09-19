import {
  BacktestEngine,
  BacktestMetrics,
  HistoricalDataPoint,
  backtestEngine,
} from "./BacktestEngine";
import { NiftySpreadPosition } from "../types";

export interface WalkForwardWindowResult {
  windowId: number;
  startDate: string;
  endDate: string;
  trainStartDate: string;
  trainEndDate: string;
  testStartDate: string;
  testEndDate: string;
  inSampleMetrics: BacktestMetrics;
  outOfSampleMetrics: BacktestMetrics;
  isProfitableOOS: boolean;
}

export interface WalkForwardAnalysisResult {
  totalWindows: number;
  profitableOOSWindows: number;
  stabilityScorePct: number; // 0 - 100%
  isStable: boolean;
  windows: WalkForwardWindowResult[];
  aggregateOOSMetrics: BacktestMetrics;
  summaryNotes: string[];
}

export class WalkForwardValidator {
  /**
   * Performs rolling sliding-window walk-forward analysis.
   * Ensures zero parameter leak between In-Sample and Out-Of-Sample sections.
   */
  public runWalkForwardAnalysis(
    dataset: HistoricalDataPoint[],
    windowCount: number = 3,
    inSampleRatio: number = 0.7,
    initialCapital: number = 500000,
    engine: BacktestEngine = backtestEngine
  ): WalkForwardAnalysisResult {
    if (!dataset || dataset.length < 10) {
      const emptyMetrics = (engine as any).getEmptyMetrics(
        false,
        "Insufficient data points for walk-forward validation."
      );
      return {
        totalWindows: 0,
        profitableOOSWindows: 0,
        stabilityScorePct: 0,
        isStable: false,
        windows: [],
        aggregateOOSMetrics: emptyMetrics,
        summaryNotes: ["Dataset contains insufficient timestamp points for walk-forward analysis."],
      };
    }

    const totalPoints = dataset.length;
    // Calculate sliding window size and step
    const minPointsPerWindow = Math.max(4, Math.floor(totalPoints / Math.max(1, windowCount)));
    const windows: WalkForwardWindowResult[] = [];
    const allOOSTrades: NiftySpreadPosition[] = [];

    let profitableOOSCount = 0;

    for (let w = 0; w < windowCount; w++) {
      const windowStart = Math.floor((w * (totalPoints - minPointsPerWindow)) / Math.max(1, windowCount - 1));
      const windowEnd = Math.min(totalPoints, windowStart + minPointsPerWindow);
      const windowSeries = dataset.slice(windowStart, windowEnd);

      if (windowSeries.length < 4) continue;

      const splitIndex = Math.floor(windowSeries.length * inSampleRatio);
      const trainSeries = windowSeries.slice(0, splitIndex);
      const testSeries = windowSeries.slice(splitIndex);

      if (trainSeries.length === 0 || testSeries.length === 0) continue;

      const trainTrades = engine.simulateDataSeries(trainSeries, initialCapital, "REGIME");
      const testTrades = engine.simulateDataSeries(testSeries, initialCapital, "REGIME");

      const hasRealOptionData = windowSeries.some(
        (d) => d.optionChain && d.optionChain.contracts && d.optionChain.contracts.length > 0 && !d.optionChain.isSynthetic
      );

      const disclosure = hasRealOptionData
        ? `Walk-Forward Window ${w + 1} (Real Historical Option Data)`
        : `Walk-Forward Window ${w + 1} (Paper Estimation Model)`;

      const inSampleMetrics = (engine as any).computeMetrics(
        trainTrades,
        initialCapital,
        hasRealOptionData,
        disclosure,
        trainSeries
      );
      const outOfSampleMetrics = (engine as any).computeMetrics(
        testTrades,
        initialCapital,
        hasRealOptionData,
        disclosure,
        testSeries
      );

      const isProfitableOOS = outOfSampleMetrics.netPnl >= 0;
      if (isProfitableOOS) profitableOOSCount++;

      allOOSTrades.push(...testTrades);

      windows.push({
        windowId: w + 1,
        startDate: windowSeries[0].timestamp,
        endDate: windowSeries[windowSeries.length - 1].timestamp,
        trainStartDate: trainSeries[0].timestamp,
        trainEndDate: trainSeries[trainSeries.length - 1].timestamp,
        testStartDate: testSeries[0].timestamp,
        testEndDate: testSeries[testSeries.length - 1].timestamp,
        inSampleMetrics,
        outOfSampleMetrics,
        isProfitableOOS,
      });
    }

    const totalValidWindows = windows.length;
    const stabilityScorePct = totalValidWindows > 0
      ? Number(((profitableOOSCount / totalValidWindows) * 100).toFixed(2))
      : 0;

    const hasRealData = dataset.some(
      (d) => d.optionChain && d.optionChain.contracts && d.optionChain.contracts.length > 0 && !d.optionChain.isSynthetic
    );

    const aggregateOOSMetrics = (engine as any).computeMetrics(
      allOOSTrades,
      initialCapital,
      hasRealData,
      "Aggregate Walk-Forward Out-Of-Sample Performance",
      dataset
    );

    const summaryNotes: string[] = [
      `Evaluated ${totalValidWindows} sliding walk-forward windows.`,
      `${profitableOOSCount} out of ${totalValidWindows} windows (${stabilityScorePct}%) achieved positive OOS Net P&L.`,
      stabilityScorePct >= 60
        ? "Walk-forward stability score is STRONG (>= 60%). Low overfit risk."
        : "Walk-forward stability score is WEAK (< 60%). High parameter sensitivity / overfit risk.",
    ];

    return {
      totalWindows: totalValidWindows,
      profitableOOSWindows: profitableOOSCount,
      stabilityScorePct,
      isStable: stabilityScorePct >= 60,
      windows,
      aggregateOOSMetrics,
      summaryNotes,
    };
  }
}

export const walkForwardValidator = new WalkForwardValidator();
