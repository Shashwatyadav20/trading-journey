import {
  genuineSampleStore,
  GenuineSampleStore,
  GenuineSessionRecord,
  GenuineTradeRecord,
  ExclusionCounters,
} from "../persistence/GenuineSampleStore";
import {
  genuineDailyLedger,
  GenuineDailyLedger,
  DailyLedgerSummary,
  DailyLedgerEntry,
} from "../persistence/GenuineDailyLedger";
import { strategyFingerprintManager } from "./StrategyFingerprintManager";
import { phase27StatisticalValidationEngine, Phase27CoreStatistics } from "./Phase27StatisticalValidationEngine";
import { reconciliationEngine } from "../reconciliation/ReconciliationEngine";

export type Phase28ValidationStatus = "INSUFFICIENT_SAMPLE" | "SAMPLE_COMPLETE";

export interface Phase28CoreStatistics {
  // P&L
  totalGrossPnL: number;
  totalCharges: number;
  totalSlippage: number;
  totalNetPnL: number;
  averageNetPnL: number;
  medianNetPnL: number;

  // Trade Statistics
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  breakevenTrades: number;
  winRate: number;                                // 0 - 100 %
  lossRate: number;                               // 0 - 100 %
  averageWinner: number;
  averageLoser: number;
  winLossRatio: number | "NOT_AVAILABLE";
  profitFactor: number | "NOT_AVAILABLE";
  expectancy: number;                             // Average net P&L per trade

  // Risk Statistics
  maxDrawdown: number;
  maxDrawdownPercent: number;
  largestWin: number;
  largestLoss: number;
  maxConsecutiveWins: number;
  maxConsecutiveLosses: number;
  recoveryFactor: number | "NOT_AVAILABLE";
}

export interface WilsonConfidenceInterval {
  observedWinRatePct: number;
  sampleSize: number;
  confidenceLevel: 95;
  lowerBoundPct: number;
  upperBoundPct: number;
}

export interface BootstrapExpectancyResult {
  observedExpectancy: number;
  bootstrapMean: number;
  confidenceInterval95: {
    lower: number;
    upper: number;
  };
  iterations: number;
}

export interface TimeBlockStability {
  blockName: string;
  tradeRange: string;
  tradeCount: number;
  netPnL: number;
  expectancy: number;
  winRate: number;
  profitFactor: number | "NOT_AVAILABLE";
  maxDrawdown: number;
}

export interface RollingWindowEvidence {
  windowSize: 10 | 20 | 30;
  windowLabel: string;
  startIndex: number;
  endIndex: number;
  winRate: number;
  expectancy: number;
  profitFactor: number | "NOT_AVAILABLE";
  netPnL: number;
  drawdown: number;
}

export interface Phase28RegimeEvidence {
  regime: "BULLISH" | "BEARISH" | "RANGE" | "NO_TRADE";
  tradeCount: number;
  winRate: number;
  netPnL: number;
  averagePnL: number;
  expectancy: number;
  profitFactor: number | "NOT_AVAILABLE";
  maxDrawdown: number;
  lowSampleWarning: boolean;
}

export interface Phase28StrategyEvidence {
  strategy: "BULL_PUT_SPREAD" | "BEAR_CALL_SPREAD" | "IRON_CONDOR";
  tradeCount: number;
  winRate: number;
  netPnL: number;
  averagePnL: number;
  expectancy: number;
  profitFactor: number | "NOT_AVAILABLE";
  maxDrawdown: number;
}

export interface ConcentrationMetric {
  top1ContributionInr: number;
  top1ContributionPct: number;
  top3ContributionInr: number;
  top3ContributionPct: number;
  top5ContributionInr: number;
  top5ContributionPct: number;
}

export interface PnLConcentrationAnalysis {
  grossProfitTotal: number;
  grossLossTotal: number;
  winnersConcentration: ConcentrationMetric;
  losersConcentration: ConcentrationMetric;
}

export interface MonteCarloDiagnosticResult {
  iterations: number;
  maxDrawdownDistribution: {
    mean: number;
    p95: number;
    worst: number;
  };
  finalPnlDistribution: {
    mean: number;
    p5: number;
    worst: number;
  };
  longestLosingStreakDistribution: {
    mean: number;
    max: number;
  };
  probabilityOfNegativeEndingPnlPct: number;
  disclaimer: "OBSERVATIONAL / RESAMPLING ANALYSIS - NOT A FUTURE PERFORMANCE FORECAST";
}

export interface Phase28SummaryReport {
  validationStatus: Phase28ValidationStatus;
  gateDetails: {
    genuineSessions: number;
    requiredSessions: 20;
    sessionsMet: boolean;
    genuineTrades: number;
    requiredTrades: 30;
    tradesMet: boolean;
    activeSessions: number;
    requiredActiveSessions: 15;
    activeSessionsMet: boolean;
  };
  coreStatistics: Phase28CoreStatistics;
  winRateConfidence: WilsonConfidenceInterval;
  bootstrapExpectancy: BootstrapExpectancyResult;
  timeStabilityBlocks: TimeBlockStability[];
  rollingWindows: RollingWindowEvidence[];
  regimeEvidence: Phase28RegimeEvidence[];
  strategyEvidence: Phase28StrategyEvidence[];
  concentrationAnalysis: PnLConcentrationAnalysis;
  monteCarloDiagnostic: MonteCarloDiagnosticResult;
  dailyTargetAnalysis: {
    daysAtOrAbove1000: number;
    daysBelow1000: number;
    lossDays: number;
    noTradeDays: number;
    averageDailyNetPnL: number;
    medianDailyNetPnL: number;
    targetAchievementRatePct: number;
  };
  fingerprintStatus: {
    baselineFingerprint: string;
    currentFingerprint: string;
    fingerprintStatus: "VALIDATED" | "STRATEGY_CHANGED";
  };
  exclusions: ExclusionCounters;
  generatedAt: string;
}

/**
 * Deterministic Pseudo-Random Number Generator (PRNG) using LCG algorithm for 100% reproducible Bootstrap/Monte Carlo.
 */
class DeterministicPRNG {
  private state: number;

  constructor(seed: number = 42) {
    this.state = seed % 2147483647;
    if (this.state <= 0) this.state += 2147483646;
  }

  public next(): number {
    this.state = (this.state * 16807) % 2147483647;
    return (this.state - 1) / 2147483646;
  }
}

export class Phase28StatisticalEvidenceEngine {
  private store: GenuineSampleStore;
  private ledger: GenuineDailyLedger;
  private baselineFingerprintHash: string;

  constructor(
    store: GenuineSampleStore = genuineSampleStore,
    ledger: GenuineDailyLedger = genuineDailyLedger
  ) {
    this.store = store;
    this.ledger = ledger;
    this.baselineFingerprintHash = strategyFingerprintManager.getCurrentFingerprint().masterFingerprintHash;
  }

  /**
   * Evaluates Phase 28 Validation Gate (inherited from Phase 27).
   */
  public evaluateGate(): {
    validationStatus: Phase28ValidationStatus;
    genuineSessions: number;
    requiredSessions: 20;
    sessionsMet: boolean;
    genuineTrades: number;
    requiredTrades: 30;
    tradesMet: boolean;
    activeSessions: number;
    requiredActiveSessions: 15;
    activeSessionsMet: boolean;
  } {
    const genuineSessionsList = this.store.getSessions(true);
    const genuineTradesList = this.store.getTrades(true);
    const activeSessionsCount = genuineSessionsList.filter(
      (s: GenuineSessionRecord) => s.dataGate === "PASSED" && s.genuineSession
    ).length;

    const genuineSessions = genuineSessionsList.length;
    const genuineTrades = genuineTradesList.length;

    const sessionsMet = genuineSessions >= 20;
    const tradesMet = genuineTrades >= 30;
    const activeSessionsMet = activeSessionsCount >= 15;

    const isGateMet = sessionsMet && tradesMet && activeSessionsMet;

    return {
      validationStatus: isGateMet ? "SAMPLE_COMPLETE" : "INSUFFICIENT_SAMPLE",
      genuineSessions,
      requiredSessions: 20,
      sessionsMet,
      genuineTrades,
      requiredTrades: 30,
      tradesMet,
      activeSessions: activeSessionsCount,
      requiredActiveSessions: 15,
      activeSessionsMet,
    };
  }

  /**
   * Calculates comprehensive Core Statistics.
   */
  public calculateCoreStatistics(trades: GenuineTradeRecord[]): Phase28CoreStatistics {
    const totalTrades = trades.length;
    if (totalTrades === 0) {
      return {
        totalGrossPnL: 0,
        totalCharges: 0,
        totalSlippage: 0,
        totalNetPnL: 0,
        averageNetPnL: 0,
        medianNetPnL: 0,
        totalTrades: 0,
        winningTrades: 0,
        losingTrades: 0,
        breakevenTrades: 0,
        winRate: 0,
        lossRate: 0,
        averageWinner: 0,
        averageLoser: 0,
        winLossRatio: "NOT_AVAILABLE",
        profitFactor: "NOT_AVAILABLE",
        expectancy: 0,
        maxDrawdown: 0,
        maxDrawdownPercent: 0,
        largestWin: 0,
        largestLoss: 0,
        maxConsecutiveWins: 0,
        maxConsecutiveLosses: 0,
        recoveryFactor: "NOT_AVAILABLE",
      };
    }

    const winningList = trades.filter((t) => (t.netPnL ?? 0) > 0);
    const losingList = trades.filter((t) => (t.netPnL ?? 0) < 0);
    const breakevenList = trades.filter((t) => (t.netPnL ?? 0) === 0);

    const winningTrades = winningList.length;
    const losingTrades = losingList.length;
    const breakevenTrades = breakevenList.length;

    const winRate = Number(((winningTrades / totalTrades) * 100).toFixed(2));
    const lossRate = Number(((losingTrades / totalTrades) * 100).toFixed(2));

    const totalGrossPnL = Number(
      trades.reduce((acc, t) => acc + (t.grossPnL ?? t.netPnL ?? 0), 0).toFixed(2)
    );
    const totalCharges = Number(
      trades
        .reduce(
          (acc, t) =>
            acc +
            (t.brokerage + t.STT + t.exchangeCharges + t.GST + t.SEBICharges + t.stampDuty),
          0
        )
        .toFixed(2)
    );
    const totalSlippage = Number(trades.reduce((acc, t) => acc + t.slippage, 0).toFixed(2));
    const totalNetPnL = Number(trades.reduce((acc, t) => acc + (t.netPnL ?? 0), 0).toFixed(2));

    const grossProfitTotal = Number(
      winningList.reduce((acc, t) => acc + (t.grossPnL ?? t.netPnL ?? 0), 0).toFixed(2)
    );
    const grossLossTotal = Number(
      Math.abs(losingList.reduce((acc, t) => acc + (t.grossPnL ?? t.netPnL ?? 0), 0)).toFixed(2)
    );

    const averageNetPnL = Number((totalNetPnL / totalTrades).toFixed(2));
    const expectancy = averageNetPnL;

    const netPnls = trades.map((t) => t.netPnL ?? 0);
    const sortedNetPnls = [...netPnls].sort((a, b) => a - b);
    let medianNetPnL = 0;
    const mid = Math.floor(sortedNetPnls.length / 2);
    if (sortedNetPnls.length % 2 !== 0) {
      medianNetPnL = sortedNetPnls[mid];
    } else {
      medianNetPnL = Number(((sortedNetPnls[mid - 1] + sortedNetPnls[mid]) / 2).toFixed(2));
    }

    const averageWinner =
      winningTrades > 0
        ? Number((winningList.reduce((a, t) => a + (t.netPnL ?? 0), 0) / winningTrades).toFixed(2))
        : 0;
    const averageLoser =
      losingTrades > 0
        ? Number((losingList.reduce((a, t) => a + (t.netPnL ?? 0), 0) / losingTrades).toFixed(2))
        : 0;

    let winLossRatio: number | "NOT_AVAILABLE" = "NOT_AVAILABLE";
    if (Math.abs(averageLoser) > 0) {
      winLossRatio = Number((averageWinner / Math.abs(averageLoser)).toFixed(2));
    }

    let profitFactor: number | "NOT_AVAILABLE" = "NOT_AVAILABLE";
    if (grossLossTotal > 0) {
      profitFactor = Number((grossProfitTotal / grossLossTotal).toFixed(2));
    }

    // Peak Equity Drawdown
    let peak = 500000;
    let currentEquity = 500000;
    let maxDrawdown = 0;
    let maxDrawdownPercent = 0;

    for (const t of trades) {
      currentEquity += t.netPnL ?? 0;
      if (currentEquity > peak) peak = currentEquity;
      const dd = peak - currentEquity;
      if (dd > maxDrawdown) {
        maxDrawdown = dd;
        maxDrawdownPercent = Number(((maxDrawdown / peak) * 100).toFixed(2));
      }
    }

    const largestWin = winningTrades > 0 ? Math.max(...netPnls) : 0;
    const largestLoss = losingTrades > 0 ? Math.min(...netPnls) : 0;

    // Consecutive Wins & Losses
    let maxConsecutiveWins = 0;
    let maxConsecutiveLosses = 0;
    let currentWinStreak = 0;
    let currentLossStreak = 0;

    for (const t of trades) {
      const pnl = t.netPnL ?? 0;
      if (pnl > 0) {
        currentWinStreak++;
        currentLossStreak = 0;
        if (currentWinStreak > maxConsecutiveWins) maxConsecutiveWins = currentWinStreak;
      } else if (pnl < 0) {
        currentLossStreak++;
        currentWinStreak = 0;
        if (currentLossStreak > maxConsecutiveLosses) maxConsecutiveLosses = currentLossStreak;
      } else {
        currentWinStreak = 0;
        currentLossStreak = 0;
      }
    }

    // Recovery Factor
    let recoveryFactor: number | "NOT_AVAILABLE" = "NOT_AVAILABLE";
    if (maxDrawdown > 0) {
      recoveryFactor = Number((totalNetPnL / maxDrawdown).toFixed(2));
    }

    return {
      totalGrossPnL,
      totalCharges,
      totalSlippage,
      totalNetPnL,
      averageNetPnL,
      medianNetPnL,
      totalTrades,
      winningTrades,
      losingTrades,
      breakevenTrades,
      winRate,
      lossRate,
      averageWinner,
      averageLoser,
      winLossRatio,
      profitFactor,
      expectancy,
      maxDrawdown: Number(maxDrawdown.toFixed(2)),
      maxDrawdownPercent,
      largestWin,
      largestLoss,
      maxConsecutiveWins,
      maxConsecutiveLosses,
      recoveryFactor,
    };
  }

  /**
   * Calculates Wilson Score 95% Confidence Interval for Binomial Win Rate.
   */
  public calculateWilsonConfidenceInterval(
    winningTrades: number,
    totalTrades: number
  ): WilsonConfidenceInterval {
    if (totalTrades === 0) {
      return {
        observedWinRatePct: 0,
        sampleSize: 0,
        confidenceLevel: 95,
        lowerBoundPct: 0,
        upperBoundPct: 0,
      };
    }

    const p = winningTrades / totalTrades;
    const z = 1.96; // 95% confidence level
    const z2 = z * z;
    const n = totalTrades;

    const denominator = 1 + z2 / n;
    const center = (p + z2 / (2 * n)) / denominator;
    const stdErr = Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));
    const margin = (z * stdErr) / denominator;

    const lowerBound = Math.max(0, center - margin);
    const upperBound = Math.min(1, center + margin);

    return {
      observedWinRatePct: Number((p * 100).toFixed(2)),
      sampleSize: totalTrades,
      confidenceLevel: 95,
      lowerBoundPct: Number((lowerBound * 100).toFixed(2)),
      upperBoundPct: Number((upperBound * 100).toFixed(2)),
    };
  }

  /**
   * Performs Bootstrap Expectancy Analysis (10,000 resamples).
   */
  public calculateBootstrapExpectancy(
    trades: GenuineTradeRecord[],
    iterations: number = 10000,
    seed: number = 42
  ): BootstrapExpectancyResult {
    const totalTrades = trades.length;
    if (totalTrades === 0) {
      return {
        observedExpectancy: 0,
        bootstrapMean: 0,
        confidenceInterval95: { lower: 0, upper: 0 },
        iterations,
      };
    }

    const netPnls = trades.map((t) => t.netPnL ?? 0);
    const observedExpectancy = Number(
      (netPnls.reduce((a, b) => a + b, 0) / totalTrades).toFixed(2)
    );

    const prng = new DeterministicPRNG(seed);
    const bootstrapExpectancies: number[] = new Array(iterations);

    for (let i = 0; i < iterations; i++) {
      let sum = 0;
      for (let j = 0; j < totalTrades; j++) {
        const randIndex = Math.floor(prng.next() * totalTrades);
        sum += netPnls[randIndex];
      }
      bootstrapExpectancies[i] = sum / totalTrades;
    }

    bootstrapExpectancies.sort((a, b) => a - b);

    const lowerIndex = Math.floor(iterations * 0.025);
    const upperIndex = Math.floor(iterations * 0.975);

    const bootstrapMean = Number(
      (bootstrapExpectancies.reduce((a, b) => a + b, 0) / iterations).toFixed(2)
    );

    return {
      observedExpectancy,
      bootstrapMean,
      confidenceInterval95: {
        lower: Number(bootstrapExpectancies[lowerIndex].toFixed(2)),
        upper: Number(bootstrapExpectancies[upperIndex].toFixed(2)),
      },
      iterations,
    };
  }

  /**
   * Chronological Time Block Stability Analysis.
   */
  public calculateTimeBlockStability(trades: GenuineTradeRecord[]): TimeBlockStability[] {
    if (trades.length === 0) return [];

    const blockSize = Math.max(1, Math.floor(trades.length / 3));
    const blocks: TimeBlockStability[] = [];

    for (let b = 0; b < 3; b++) {
      const start = b * blockSize;
      const end = b === 2 ? trades.length : (b + 1) * blockSize;
      const blockTrades = trades.slice(start, end);

      if (blockTrades.length === 0) continue;

      const stats = this.calculateCoreStatistics(blockTrades);
      blocks.push({
        blockName: `Block ${b + 1}`,
        tradeRange: `Trades ${start + 1}–${end}`,
        tradeCount: blockTrades.length,
        netPnL: stats.totalNetPnL,
        expectancy: stats.expectancy,
        winRate: stats.winRate,
        profitFactor: stats.profitFactor,
        maxDrawdown: stats.maxDrawdown,
      });
    }

    return blocks;
  }

  /**
   * Extended Rolling Window Analysis (10, 20, 30 trade windows).
   */
  public calculateRollingWindows(trades: GenuineTradeRecord[]): RollingWindowEvidence[] {
    const windowSizes: Array<10 | 20 | 30> = [10, 20, 30];
    const results: RollingWindowEvidence[] = [];

    for (const size of windowSizes) {
      if (trades.length < size) continue;

      for (let i = 0; i <= trades.length - size; i++) {
        const windowTrades = trades.slice(i, i + size);
        const stats = this.calculateCoreStatistics(windowTrades);

        results.push({
          windowSize: size,
          windowLabel: `Trades ${i + 1}–${i + size}`,
          startIndex: i + 1,
          endIndex: i + size,
          winRate: stats.winRate,
          expectancy: stats.expectancy,
          profitFactor: stats.profitFactor,
          netPnL: stats.totalNetPnL,
          drawdown: stats.maxDrawdown,
        });
      }
    }

    return results;
  }

  /**
   * Regime Breakdown with Low Subgroup Warning (< 5 trades).
   */
  public calculateRegimeEvidence(trades: GenuineTradeRecord[]): Phase28RegimeEvidence[] {
    const regimes: Array<"BULLISH" | "BEARISH" | "RANGE" | "NO_TRADE"> = [
      "BULLISH",
      "BEARISH",
      "RANGE",
      "NO_TRADE",
    ];

    return regimes.map((reg) => {
      const regTrades = trades.filter((t) => t.regime === reg);
      const stats = this.calculateCoreStatistics(regTrades);
      const lowSampleWarning = regTrades.length < 5;

      return {
        regime: reg,
        tradeCount: regTrades.length,
        winRate: stats.winRate,
        netPnL: stats.totalNetPnL,
        averagePnL: stats.averageNetPnL,
        expectancy: stats.expectancy,
        profitFactor: stats.profitFactor,
        maxDrawdown: stats.maxDrawdown,
        lowSampleWarning,
      };
    });
  }

  /**
   * Strategy Breakdown (Factual, Independent, Non-ranking).
   */
  public calculateStrategyEvidence(trades: GenuineTradeRecord[]): Phase28StrategyEvidence[] {
    const strategies: Array<"BULL_PUT_SPREAD" | "BEAR_CALL_SPREAD" | "IRON_CONDOR"> = [
      "BULL_PUT_SPREAD",
      "BEAR_CALL_SPREAD",
      "IRON_CONDOR",
    ];

    return strategies.map((strat) => {
      const stratTrades = trades.filter((t) => t.strategy === strat);
      const stats = this.calculateCoreStatistics(stratTrades);

      return {
        strategy: strat,
        tradeCount: stratTrades.length,
        winRate: stats.winRate,
        netPnL: stats.totalNetPnL,
        averagePnL: stats.averageNetPnL,
        expectancy: stats.expectancy,
        profitFactor: stats.profitFactor,
        maxDrawdown: stats.maxDrawdown,
      };
    });
  }

  /**
   * P&L & Loss Concentration Analysis (Top-1, Top-3, Top-5).
   */
  public calculateConcentrationAnalysis(trades: GenuineTradeRecord[]): PnLConcentrationAnalysis {
    const winners = trades.filter((t) => (t.netPnL ?? 0) > 0).sort((a, b) => (b.netPnL ?? 0) - (a.netPnL ?? 0));
    const losers = trades.filter((t) => (t.netPnL ?? 0) < 0).sort((a, b) => (a.netPnL ?? 0) - (b.netPnL ?? 0)); // Most negative first

    const grossProfitTotal = Number(winners.reduce((acc, t) => acc + (t.netPnL ?? 0), 0).toFixed(2));
    const grossLossTotal = Number(Math.abs(losers.reduce((acc, t) => acc + (t.netPnL ?? 0), 0)).toFixed(2));

    const calcMetric = (list: GenuineTradeRecord[], count: number, total: number): { inr: number; pct: number } => {
      if (list.length === 0 || total === 0) return { inr: 0, pct: 0 };
      const sum = Math.abs(list.slice(0, count).reduce((acc, t) => acc + (t.netPnL ?? 0), 0));
      return {
        inr: Number(sum.toFixed(2)),
        pct: Number(((sum / total) * 100).toFixed(2)),
      };
    };

    const top1Win = calcMetric(winners, 1, grossProfitTotal);
    const top3Win = calcMetric(winners, 3, grossProfitTotal);
    const top5Win = calcMetric(winners, 5, grossProfitTotal);

    const top1Loss = calcMetric(losers, 1, grossLossTotal);
    const top3Loss = calcMetric(losers, 3, grossLossTotal);
    const top5Loss = calcMetric(losers, 5, grossLossTotal);

    return {
      grossProfitTotal,
      grossLossTotal,
      winnersConcentration: {
        top1ContributionInr: top1Win.inr,
        top1ContributionPct: top1Win.pct,
        top3ContributionInr: top3Win.inr,
        top3ContributionPct: top3Win.pct,
        top5ContributionInr: top5Win.inr,
        top5ContributionPct: top5Win.pct,
      },
      losersConcentration: {
        top1ContributionInr: top1Loss.inr,
        top1ContributionPct: top1Loss.pct,
        top3ContributionInr: top3Loss.inr,
        top3ContributionPct: top3Loss.pct,
        top5ContributionInr: top5Loss.inr,
        top5ContributionPct: top5Loss.pct,
      },
    };
  }

  /**
   * Diagnostic Monte Carlo Resampling Risk Analysis (10,000 iterations).
   */
  public calculateMonteCarloDiagnostic(
    trades: GenuineTradeRecord[],
    iterations: number = 10000,
    seed: number = 99
  ): MonteCarloDiagnosticResult {
    const totalTrades = trades.length;
    if (totalTrades === 0) {
      return {
        iterations,
        maxDrawdownDistribution: { mean: 0, p95: 0, worst: 0 },
        finalPnlDistribution: { mean: 0, p5: 0, worst: 0 },
        longestLosingStreakDistribution: { mean: 0, max: 0 },
        probabilityOfNegativeEndingPnlPct: 0,
        disclaimer: "OBSERVATIONAL / RESAMPLING ANALYSIS - NOT A FUTURE PERFORMANCE FORECAST",
      };
    }

    const netPnls = trades.map((t) => t.netPnL ?? 0);
    const prng = new DeterministicPRNG(seed);

    const drawdowns: number[] = new Array(iterations);
    const finalPnls: number[] = new Array(iterations);
    const losingStreaks: number[] = new Array(iterations);
    let negativeEndingCount = 0;

    for (let i = 0; i < iterations; i++) {
      let currentEquity = 500000;
      let peak = 500000;
      let maxDd = 0;
      let currentLossStreak = 0;
      let maxLossStreak = 0;

      for (let j = 0; j < totalTrades; j++) {
        const randIndex = Math.floor(prng.next() * totalTrades);
        const pnl = netPnls[randIndex];

        currentEquity += pnl;
        if (currentEquity > peak) peak = currentEquity;
        const dd = peak - currentEquity;
        if (dd > maxDd) maxDd = dd;

        if (pnl < 0) {
          currentLossStreak++;
          if (currentLossStreak > maxLossStreak) maxLossStreak = currentLossStreak;
        } else {
          currentLossStreak = 0;
        }
      }

      const finalNet = currentEquity - 500000;
      drawdowns[i] = maxDd;
      finalPnls[i] = finalNet;
      losingStreaks[i] = maxLossStreak;

      if (finalNet < 0) negativeEndingCount++;
    }

    drawdowns.sort((a, b) => a - b);
    finalPnls.sort((a, b) => a - b);
    losingStreaks.sort((a, b) => a - b);

    const meanDd = Number((drawdowns.reduce((a, b) => a + b, 0) / iterations).toFixed(2));
    const p95Dd = Number(drawdowns[Math.floor(iterations * 0.95)].toFixed(2));
    const worstDd = Number(drawdowns[iterations - 1].toFixed(2));

    const meanFinalPnl = Number((finalPnls.reduce((a, b) => a + b, 0) / iterations).toFixed(2));
    const p5FinalPnl = Number(finalPnls[Math.floor(iterations * 0.05)].toFixed(2));
    const worstFinalPnl = Number(finalPnls[0].toFixed(2));

    const meanLosingStreak = Number(
      (losingStreaks.reduce((a, b) => a + b, 0) / iterations).toFixed(1)
    );
    const maxLosingStreak = losingStreaks[iterations - 1];

    const probNeg = Number(((negativeEndingCount / iterations) * 100).toFixed(2));

    return {
      iterations,
      maxDrawdownDistribution: { mean: meanDd, p95: p95Dd, worst: worstDd },
      finalPnlDistribution: { mean: meanFinalPnl, p5: p5FinalPnl, worst: worstFinalPnl },
      longestLosingStreakDistribution: { mean: meanLosingStreak, max: maxLosingStreak },
      probabilityOfNegativeEndingPnlPct: probNeg,
      disclaimer: "OBSERVATIONAL / RESAMPLING ANALYSIS - NOT A FUTURE PERFORMANCE FORECAST",
    };
  }

  /**
   * Generates the complete Phase 28 Statistical Evidence Report.
   */
  public generateReport(): Phase28SummaryReport {
    const gateDetails = this.evaluateGate();
    const genuineTrades = this.store.getTrades(true);
    const dailySummary = this.ledger.getSummary(true);

    const coreStats = this.calculateCoreStatistics(genuineTrades);
    const wilsonCI = this.calculateWilsonConfidenceInterval(
      coreStats.winningTrades,
      coreStats.totalTrades
    );
    const bootstrapExpectancy = this.calculateBootstrapExpectancy(genuineTrades);

    const timeBlockStability = this.calculateTimeBlockStability(genuineTrades);
    const rollingWindows = this.calculateRollingWindows(genuineTrades);
    const regimeEvidence = this.calculateRegimeEvidence(genuineTrades);
    const strategyEvidence = this.calculateStrategyEvidence(genuineTrades);
    const concentrationAnalysis = this.calculateConcentrationAnalysis(genuineTrades);
    const monteCarloDiagnostic = this.calculateMonteCarloDiagnostic(genuineTrades);

    const target1000 = dailySummary.target1000Analysis;
    const activeDaysCount = dailySummary.activeDays || 1;
    const targetAchievementRatePct = Number(
      ((target1000.daysAtOrAbove1000 / activeDaysCount) * 100).toFixed(2)
    );

    // Fingerprint verification
    const currentFp = strategyFingerprintManager.getCurrentFingerprint();
    const fingerprintStatus =
      currentFp.masterFingerprintHash === this.baselineFingerprintHash
        ? "VALIDATED"
        : "STRATEGY_CHANGED";

    const exclusions = this.store.getExclusionCounters();

    return {
      validationStatus: gateDetails.validationStatus,
      gateDetails,
      coreStatistics: coreStats,
      winRateConfidence: wilsonCI,
      bootstrapExpectancy,
      timeStabilityBlocks: timeBlockStability,
      rollingWindows,
      regimeEvidence,
      strategyEvidence,
      concentrationAnalysis,
      monteCarloDiagnostic,
      dailyTargetAnalysis: {
        daysAtOrAbove1000: target1000.daysAtOrAbove1000,
        daysBelow1000: target1000.daysBetween0And999,
        lossDays: dailySummary.negativeDays,
        noTradeDays: dailySummary.noTradeDays,
        averageDailyNetPnL: dailySummary.averageNetPnL,
        medianDailyNetPnL: dailySummary.medianNetPnL,
        targetAchievementRatePct,
      },
      fingerprintStatus: {
        baselineFingerprint: this.baselineFingerprintHash,
        currentFingerprint: currentFp.masterFingerprintHash,
        fingerprintStatus,
      },
      exclusions,
      generatedAt: new Date().toISOString(),
    };
  }

  public recalculate(_sessions?: GenuineSessionRecord[], _trades?: GenuineTradeRecord[]): Phase28SummaryReport {
    return this.generateReport();
  }
}

export const phase28StatisticalEvidenceEngine = new Phase28StatisticalEvidenceEngine();
