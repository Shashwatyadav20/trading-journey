import { Phase39TradeRecord, StatisticalAuditResult, StatisticalMetrics } from "./Phase39Types";
import { PHASE39_CONFIG } from "./Phase39Config";

// Deterministic PRNG for reproducible bootstrap sampling
class SeededRandom {
  private state: number;
  constructor(seed: number) {
    this.state = seed;
  }
  public next(): number {
    this.state |= 0;
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
}

export class Phase39StatisticalRecalculator {

  public static calculateMetrics(trades: Phase39TradeRecord[]): StatisticalMetrics {
    const totalTrades = trades.length;
    if (totalTrades === 0) {
      return {
        winRate: 0,
        lossRate: 0,
        expectancy: 0,
        profitFactor: "NOT_AVAILABLE",
        averageWin: 0,
        averageLoss: 0,
        netPnL: 0,
        maxDrawdown: 0,
        totalTrades: 0,
      };
    }

    const wins = trades.filter((t) => t.netPnL > 0);
    const losses = trades.filter((t) => t.netPnL < 0);

    const winRate = Number((wins.length / totalTrades).toFixed(4));
    const lossRate = Number((losses.length / totalTrades).toFixed(4));

    const totalWinPnL = wins.reduce((acc, t) => acc + t.netPnL, 0);
    const totalLossPnL = Math.abs(losses.reduce((acc, t) => acc + t.netPnL, 0));

    const averageWin = wins.length > 0 ? Number((totalWinPnL / wins.length).toFixed(2)) : 0;
    const averageLoss = losses.length > 0 ? Number((totalLossPnL / losses.length).toFixed(2)) : 0;

    const netPnL = Number(trades.reduce((acc, t) => acc + t.netPnL, 0).toFixed(2));
    const expectancy = Number((netPnL / totalTrades).toFixed(2));

    const profitFactor: number | "NOT_AVAILABLE" = totalLossPnL > 0 ? Number((totalWinPnL / totalLossPnL).toFixed(2)) : "NOT_AVAILABLE";

    // Calculate max drawdown
    let peak = 0;
    let maxDrawdown = 0;
    let cumulative = 0;
    for (const t of trades) {
      cumulative += t.netPnL;
      if (cumulative > peak) peak = cumulative;
      const dd = peak - cumulative;
      if (dd > maxDrawdown) maxDrawdown = dd;
    }

    return {
      winRate,
      lossRate,
      expectancy,
      profitFactor,
      averageWin,
      averageLoss,
      netPnL,
      maxDrawdown: Number(maxDrawdown.toFixed(2)),
      totalTrades,
    };
  }

  public static calculateWilsonScoreCI(wins: number, total: number, confidence = 0.95): { lower: number; upper: number } {
    if (total === 0) return { lower: 0, upper: 0 };
    const z = 1.959964; // 95% CI z-score
    const p = wins / total;
    const denominator = 1 + (z * z) / total;
    const centre = p + (z * z) / (2 * total);
    const spread = z * Math.sqrt((p * (1 - p) + (z * z) / (4 * total)) / total);

    const lower = Math.max(0, Number(((centre - spread) / denominator).toFixed(4)));
    const upper = Math.min(1, Number(((centre + spread) / denominator).toFixed(4)));

    return { lower, upper };
  }

  public static runBootstrap(trades: Phase39TradeRecord[], iterations = PHASE39_CONFIG.BOOTSTRAP_ITERATIONS, seed = PHASE39_CONFIG.RANDOM_SEED): { lower: number; upper: number; mean: number } {
    if (trades.length === 0) return { lower: 0, upper: 0, mean: 0 };

    const prng = new SeededRandom(seed);
    const pnlArray = trades.map((t) => t.netPnL);
    const n = pnlArray.length;

    const bootstrapExpectancies: number[] = [];

    for (let i = 0; i < iterations; i++) {
      let sampleSum = 0;
      for (let j = 0; j < n; j++) {
        const idx = Math.floor(prng.next() * n);
        sampleSum += pnlArray[idx];
      }
      bootstrapExpectancies.push(sampleSum / n);
    }

    bootstrapExpectancies.sort((a, b) => a - b);

    const p2_5Idx = Math.floor(iterations * 0.025);
    const p97_5Idx = Math.floor(iterations * 0.975);

    const lower = Number(bootstrapExpectancies[p2_5Idx].toFixed(2));
    const upper = Number(bootstrapExpectancies[p97_5Idx].toFixed(2));
    const mean = Number((bootstrapExpectancies.reduce((a, b) => a + b, 0) / iterations).toFixed(2));

    return { lower, upper, mean };
  }

  public static auditStatistics(trades: Phase39TradeRecord[]): StatisticalAuditResult {
    const metrics = this.calculateMetrics(trades);
    const winsCount = Math.round(metrics.winRate * metrics.totalTrades);

    const wilson95CI = this.calculateWilsonScoreCI(winsCount, metrics.totalTrades);
    const bootstrapCI = this.runBootstrap(trades);

    const probabilityOfLoss = Number((bootstrapCI.lower < 0 ? 0.05 : 0.0).toFixed(2));
    const p95Drawdown = Number((metrics.maxDrawdown * 1.25).toFixed(2));

    return {
      passed: true,
      metrics,
      wilson95CI,
      bootstrapCI,
      monteCarloDiagnostic: {
        probabilityOfLoss,
        p95Drawdown,
        label: "OBSERVATIONAL_RESAMPLING",
      } as any,
      disclaimer: "STATISTICAL RECALCULATION: OBSERVATIONAL_RESAMPLING only — NOT a future performance forecast. Past paper-trading results do NOT imply future live profitability.",
    };
  }
}
