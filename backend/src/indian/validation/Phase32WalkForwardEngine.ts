import { Phase32OOSObservation } from "./Phase32DatasetManager";
import { GenuineTradeRecord } from "../persistence/GenuineSampleStore";

export interface WalkForwardWindowMetrics {
  tradeCount: number;
  netPnL: number;
  expectancy: number;
  winRate: number; // 0 - 100%
  profitFactor: number | "NOT_AVAILABLE";
  maxDrawdown?: number;
}

export interface WalkForwardWindow {
  windowId: string;
  trainingStart: string;
  trainingEnd: string;
  testingStart: string;
  testingEnd: string;
  strategyFingerprint: string;
  status: "VALIDATED" | "INVALID" | "INSUFFICIENT_SAMPLE";
  trainingMetrics: WalkForwardWindowMetrics;
  testingMetrics: WalkForwardWindowMetrics;
}

export interface WalkForwardStabilityDistribution {
  windows: Array<{
    windowId: string;
    testingStart: string;
    testingEnd: string;
    netPnL: number;
    expectancy: number;
    winRate: number;
    profitFactor: number | "NOT_AVAILABLE";
    maxDrawdown: number;
  }>;
  averageTestingExpectancy: number;
  averageTestingWinRate: number;
  expectancyStdDev: number;
  stabilityStatus: "STABLE" | "MODERATE" | "HIGH_VARIANCE" | "INSUFFICIENT_DATA";
}

export class Phase32WalkForwardEngine {
  /**
   * Constructs rolling walk-forward windows from chronological observations.
   * Enforces strict trainingEnd <= testingStart to prevent future data leakage into training.
   * Training period is used for MEASUREMENT ONLY (no automatic parameter fitting).
   */
  public generateWalkForwardWindows(
    allObservations: readonly (Phase32OOSObservation | GenuineTradeRecord)[],
    masterFingerprint: string,
    windowCount: number = 4
  ): WalkForwardWindow[] {
    if (!allObservations || allObservations.length === 0) {
      return [];
    }

    // Sort observations chronologically by entryTimestamp
    const sorted = [...allObservations].sort(
      (a, b) => new Date(a.entryTimestamp).getTime() - new Date(b.entryTimestamp).getTime()
    );

    const totalCount = sorted.length;
    if (totalCount < 4) {
      // Create single minimal window if sample is small
      return [this.createWindow("WF_001", sorted, sorted, sorted, masterFingerprint)];
    }

    const windows: WalkForwardWindow[] = [];
    const stepSize = Math.max(1, Math.floor(totalCount / (windowCount + 1)));

    for (let i = 0; i < windowCount; i++) {
      const trainStartIndex = i * stepSize;
      const trainEndIndex = Math.min(totalCount - 2, trainStartIndex + stepSize * 2);
      const testStartIndex = trainEndIndex;
      const testEndIndex = Math.min(totalCount, testStartIndex + stepSize);

      if (testStartIndex >= totalCount || trainStartIndex >= trainEndIndex) {
        break;
      }

      const trainObs = sorted.slice(trainStartIndex, trainEndIndex);
      const testObs = sorted.slice(testStartIndex, testEndIndex);

      const windowId = `WF_${(i + 1).toString().padStart(3, "0")}`;
      windows.push(this.createWindow(windowId, trainObs, testObs, sorted, masterFingerprint));
    }

    return windows;
  }

  private createWindow(
    windowId: string,
    trainObs: any[],
    testObs: any[],
    sortedAll: any[],
    masterFingerprint: string
  ): WalkForwardWindow {
    const trainingStart = trainObs.length > 0 ? trainObs[0].entryTimestamp : new Date().toISOString();
    const trainingEnd = trainObs.length > 0 ? trainObs[trainObs.length - 1].entryTimestamp : trainingStart;
    const testingStart = testObs.length > 0 ? testObs[0].entryTimestamp : trainingEnd;
    const testingEnd = testObs.length > 0 ? testObs[testObs.length - 1].entryTimestamp : testingStart;

    const trainMetrics = this.calculateMetrics(trainObs);
    const testMetrics = this.calculateMetrics(testObs);

    // Enforce no future leakage: trainingEnd must be <= testingStart
    const trainEndTs = new Date(trainingEnd).getTime();
    const testStartTs = new Date(testingStart).getTime();
    const status = trainEndTs <= testStartTs && testObs.length > 0 ? "VALIDATED" : "INVALID";

    return {
      windowId,
      trainingStart,
      trainingEnd,
      testingStart,
      testingEnd,
      strategyFingerprint: masterFingerprint,
      status,
      trainingMetrics: trainMetrics,
      testingMetrics: testMetrics,
    };
  }

  private calculateMetrics(records: any[]): WalkForwardWindowMetrics {
    const tradeCount = records.length;
    if (tradeCount === 0) {
      return {
        tradeCount: 0,
        netPnL: 0,
        expectancy: 0,
        winRate: 0,
        profitFactor: "NOT_AVAILABLE",
        maxDrawdown: 0,
      };
    }

    let grossWin = 0;
    let grossLoss = 0;
    let netPnL = 0;
    let wins = 0;

    let peak = 0;
    let currentEquity = 0;
    let maxDrawdown = 0;

    for (const r of records) {
      const pnl = r.netPnL ?? 0;
      netPnL += pnl;

      if (pnl > 0) {
        grossWin += pnl;
        wins++;
      } else if (pnl < 0) {
        grossLoss += Math.abs(pnl);
      }

      currentEquity += pnl;
      if (currentEquity > peak) {
        peak = currentEquity;
      }
      const dd = peak - currentEquity;
      if (dd > maxDrawdown) {
        maxDrawdown = dd;
      }
    }

    const winRate = Number(((wins / tradeCount) * 100).toFixed(2));
    const expectancy = Number((netPnL / tradeCount).toFixed(2));
    const profitFactor = grossLoss === 0 ? (grossWin > 0 ? 999.99 : "NOT_AVAILABLE") : Number((grossWin / grossLoss).toFixed(2));

    return {
      tradeCount,
      netPnL: Number(netPnL.toFixed(2)),
      expectancy,
      winRate,
      profitFactor,
      maxDrawdown: Number(maxDrawdown.toFixed(2)),
    };
  }

  /**
   * Generates Walk-Forward stability distribution across testing windows.
   */
  public calculateStabilityDistribution(windows: readonly WalkForwardWindow[]): WalkForwardStabilityDistribution {
    if (!windows || windows.length === 0) {
      return {
        windows: [],
        averageTestingExpectancy: 0,
        averageTestingWinRate: 0,
        expectancyStdDev: 0,
        stabilityStatus: "INSUFFICIENT_DATA",
      };
    }

    const validWindows = windows.filter((w) => w.status === "VALIDATED" && w.testingMetrics.tradeCount > 0);
    if (validWindows.length === 0) {
      return {
        windows: [],
        averageTestingExpectancy: 0,
        averageTestingWinRate: 0,
        expectancyStdDev: 0,
        stabilityStatus: "INSUFFICIENT_DATA",
      };
    }

    const windowList = validWindows.map((w) => ({
      windowId: w.windowId,
      testingStart: w.testingStart,
      testingEnd: w.testingEnd,
      netPnL: w.testingMetrics.netPnL,
      expectancy: w.testingMetrics.expectancy,
      winRate: w.testingMetrics.winRate,
      profitFactor: w.testingMetrics.profitFactor,
      maxDrawdown: w.testingMetrics.maxDrawdown || 0,
    }));

    const expectancies = windowList.map((w) => w.expectancy);
    const winRates = windowList.map((w) => w.winRate);

    const avgExpectancy = Number((expectancies.reduce((a, b) => a + b, 0) / expectancies.length).toFixed(2));
    const avgWinRate = Number((winRates.reduce((a, b) => a + b, 0) / winRates.length).toFixed(2));

    const variance = expectancies.reduce((acc, val) => acc + Math.pow(val - avgExpectancy, 2), 0) / expectancies.length;
    const stdDev = Number(Math.sqrt(variance).toFixed(2));

    let stabilityStatus: "STABLE" | "MODERATE" | "HIGH_VARIANCE" | "INSUFFICIENT_DATA" = "STABLE";
    if (stdDev > Math.abs(avgExpectancy) * 1.5 && Math.abs(avgExpectancy) > 0) {
      stabilityStatus = "HIGH_VARIANCE";
    } else if (stdDev > Math.abs(avgExpectancy) * 0.75) {
      stabilityStatus = "MODERATE";
    }

    return {
      windows: windowList,
      averageTestingExpectancy: avgExpectancy,
      averageTestingWinRate: avgWinRate,
      expectancyStdDev: stdDev,
      stabilityStatus,
    };
  }
}

export const phase32WalkForwardEngine = new Phase32WalkForwardEngine();
