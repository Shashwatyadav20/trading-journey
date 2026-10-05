import { Phase32OOSObservation } from "./Phase32DatasetManager";
import { GenuineTradeRecord } from "../persistence/GenuineSampleStore";

export interface MonteCarloStressDiagnostic {
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
  disclaimer: "RESAMPLING / SCENARIO DIAGNOSTIC ONLY - NOT A FUTURE PERFORMANCE PREDICTION";
}

/**
 * Deterministic PRNG for 100% reproducible Monte Carlo resampling.
 */
class MonteCarloPRNG {
  private state: number;

  constructor(seed: number = 20261003) {
    this.state = seed % 2147483647;
    if (this.state <= 0) this.state += 2147483646;
  }

  public nextFloat(): number {
    this.state = (this.state * 16807) % 2147483647;
    return (this.state - 1) / 2147483646;
  }

  public nextInt(min: number, max: number): number {
    return Math.floor(this.nextFloat() * (max - min + 1)) + min;
  }
}

export class Phase33MonteCarloEngine {
  /**
   * Runs N iterations of bootstrap trade resampling using deterministic LCG PRNG.
   */
  public runMonteCarloResampling(
    observations: readonly (Phase32OOSObservation | GenuineTradeRecord)[],
    iterations: number = 1000,
    seed: number = 20261003
  ): MonteCarloStressDiagnostic {
    if (!observations || observations.length === 0) {
      return {
        iterations: 0,
        maxDrawdownDistribution: { mean: 0, p95: 0, worst: 0 },
        finalPnlDistribution: { mean: 0, p5: 0, worst: 0 },
        longestLosingStreakDistribution: { mean: 0, max: 0 },
        probabilityOfNegativeEndingPnlPct: 0,
        disclaimer: "RESAMPLING / SCENARIO DIAGNOSTIC ONLY - NOT A FUTURE PERFORMANCE PREDICTION",
      };
    }

    const pnls = observations.map((o) => o.netPnL ?? 0);
    const prng = new MonteCarloPRNG(seed);

    const endingPnLs: number[] = [];
    const maxDrawdowns: number[] = [];
    const losingStreaks: number[] = [];

    for (let i = 0; i < iterations; i++) {
      let currentEquity = 0;
      let peak = 0;
      let maxDd = 0;
      let currentStreak = 0;
      let maxStreak = 0;

      for (let j = 0; j < pnls.length; j++) {
        const randIdx = prng.nextInt(0, pnls.length - 1);
        const pnl = pnls[randIdx];

        currentEquity += pnl;
        if (currentEquity > peak) peak = currentEquity;
        const dd = peak - currentEquity;
        if (dd > maxDd) maxDd = dd;

        if (pnl < 0) {
          currentStreak++;
          if (currentStreak > maxStreak) maxStreak = currentStreak;
        } else if (pnl > 0) {
          currentStreak = 0;
        }
      }

      endingPnLs.push(currentEquity);
      maxDrawdowns.push(maxDd);
      losingStreaks.push(maxStreak);
    }

    endingPnLs.sort((a, b) => a - b);
    maxDrawdowns.sort((a, b) => a - b);
    losingStreaks.sort((a, b) => a - b);

    const meanPnl = Number((endingPnLs.reduce((a, b) => a + b, 0) / iterations).toFixed(2));
    const p5Pnl = Number(endingPnLs[Math.floor(iterations * 0.05)].toFixed(2));
    const worstPnl = Number(endingPnLs[0].toFixed(2));

    const meanDd = Number((maxDrawdowns.reduce((a, b) => a + b, 0) / iterations).toFixed(2));
    const p95Dd = Number(maxDrawdowns[Math.floor(iterations * 0.95)].toFixed(2));
    const worstDd = Number(maxDrawdowns[iterations - 1].toFixed(2));

    const meanStreak = Number((losingStreaks.reduce((a, b) => a + b, 0) / iterations).toFixed(2));
    const maxStreak = losingStreaks[iterations - 1];

    const negativeEndingCount = endingPnLs.filter((p) => p < 0).length;
    const probNegativePct = Number(((negativeEndingCount / iterations) * 100).toFixed(2));

    return {
      iterations,
      maxDrawdownDistribution: {
        mean: meanDd,
        p95: p95Dd,
        worst: worstDd,
      },
      finalPnlDistribution: {
        mean: meanPnl,
        p5: p5Pnl,
        worst: worstPnl,
      },
      longestLosingStreakDistribution: {
        mean: meanStreak,
        max: maxStreak,
      },
      probabilityOfNegativeEndingPnlPct: probNegativePct,
      disclaimer: "RESAMPLING / SCENARIO DIAGNOSTIC ONLY - NOT A FUTURE PERFORMANCE PREDICTION",
    };
  }
}

export const phase33MonteCarloEngine = new Phase33MonteCarloEngine();
