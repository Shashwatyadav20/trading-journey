import { Phase32OOSObservation } from "./Phase32DatasetManager";
import { GenuineTradeRecord } from "../persistence/GenuineSampleStore";
import { StressScenarioDefinition } from "./Phase33StressScenarioManager";

export interface SequenceStressResult {
  scenarioId: string;
  name: string;
  order: string;
  totalTrades: number;
  netPnL: number;
  maxDrawdown: number;
  longestLosingStreak: number;
  recoveryFactor: number | "NOT_AVAILABLE";
  disclaimer: "SCENARIO ANALYSIS ONLY - NOT A FUTURE PERFORMANCE PREDICTION";
}

export interface SequencePermutationDistribution {
  permutationsCount: number;
  meanMaxDrawdown: number;
  worstMaxDrawdown: number;
  bestMaxDrawdown: number;
  p95MaxDrawdown: number;
  meanLosingStreak: number;
  maxLosingStreak: number;
}

/**
 * Deterministic PRNG for 100% reproducible sequence permutations.
 */
class SequencePRNG {
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

export class Phase33SequenceStressEngine {
  /**
   * Evaluates P&L sequence stress across explicit orderings (Reverse, Worst-First, Best-First).
   */
  public runSequenceStress(
    observations: readonly (Phase32OOSObservation | GenuineTradeRecord)[],
    scenarios: readonly StressScenarioDefinition[]
  ): SequenceStressResult[] {
    return scenarios.map((scenario) => {
      const order = scenario.parameters.order || "CHRONOLOGICAL";
      let ordered = [...observations];

      if (order === "REVERSED") {
        ordered.reverse();
      } else if (order === "WORST_FIRST") {
        ordered.sort((a, b) => (a.netPnL ?? 0) - (b.netPnL ?? 0));
      } else if (order === "BEST_FIRST") {
        ordered.sort((a, b) => (b.netPnL ?? 0) - (a.netPnL ?? 0));
      }

      const metrics = this.calculateSequenceMetrics(ordered);

      return {
        scenarioId: scenario.scenarioId,
        name: scenario.name,
        order,
        totalTrades: ordered.length,
        netPnL: metrics.netPnL,
        maxDrawdown: metrics.maxDrawdown,
        longestLosingStreak: metrics.longestLosingStreak,
        recoveryFactor: metrics.recoveryFactor,
        disclaimer: "SCENARIO ANALYSIS ONLY - NOT A FUTURE PERFORMANCE PREDICTION",
      };
    });
  }

  /**
   * Generates distribution across N random permutations of trade order.
   */
  public runPermutationDistribution(
    observations: readonly (Phase32OOSObservation | GenuineTradeRecord)[],
    permutationsCount: number = 100
  ): SequencePermutationDistribution {
    if (!observations || observations.length === 0) {
      return {
        permutationsCount: 0,
        meanMaxDrawdown: 0,
        worstMaxDrawdown: 0,
        bestMaxDrawdown: 0,
        p95MaxDrawdown: 0,
        meanLosingStreak: 0,
        maxLosingStreak: 0,
      };
    }

    const prng = new SequencePRNG(20261003);
    const drawdowns: number[] = [];
    const losingStreaks: number[] = [];

    for (let i = 0; i < permutationsCount; i++) {
      // Fisher-Yates shuffle with deterministic PRNG
      const shuffled = [...observations];
      for (let j = shuffled.length - 1; j > 0; j--) {
        const k = prng.nextInt(0, j);
        const temp = shuffled[j];
        shuffled[j] = shuffled[k];
        shuffled[k] = temp;
      }

      const metrics = this.calculateSequenceMetrics(shuffled);
      drawdowns.push(metrics.maxDrawdown);
      losingStreaks.push(metrics.longestLosingStreak);
    }

    drawdowns.sort((a, b) => a - b);
    losingStreaks.sort((a, b) => a - b);

    const meanDd = Number((drawdowns.reduce((a, b) => a + b, 0) / drawdowns.length).toFixed(2));
    const worstDd = Number(drawdowns[drawdowns.length - 1].toFixed(2));
    const bestDd = Number(drawdowns[0].toFixed(2));
    const p95Dd = Number(drawdowns[Math.floor(drawdowns.length * 0.95)].toFixed(2));

    const meanStreak = Number((losingStreaks.reduce((a, b) => a + b, 0) / losingStreaks.length).toFixed(2));
    const maxStreak = losingStreaks[losingStreaks.length - 1];

    return {
      permutationsCount,
      meanMaxDrawdown: meanDd,
      worstMaxDrawdown: worstDd,
      bestMaxDrawdown: bestDd,
      p95MaxDrawdown: p95Dd,
      meanLosingStreak: meanStreak,
      maxLosingStreak: maxStreak,
    };
  }

  private calculateSequenceMetrics(records: readonly any[]): {
    netPnL: number;
    maxDrawdown: number;
    longestLosingStreak: number;
    recoveryFactor: number | "NOT_AVAILABLE";
  } {
    let netPnL = 0;
    let peak = 0;
    let currentEquity = 0;
    let maxDrawdown = 0;

    let currentLosingStreak = 0;
    let longestLosingStreak = 0;

    for (const r of records) {
      const pnl = r.netPnL ?? 0;
      netPnL += pnl;

      if (pnl < 0) {
        currentLosingStreak++;
        if (currentLosingStreak > longestLosingStreak) {
          longestLosingStreak = currentLosingStreak;
        }
      } else if (pnl > 0) {
        currentLosingStreak = 0;
      }

      currentEquity += pnl;
      if (currentEquity > peak) peak = currentEquity;
      const dd = peak - currentEquity;
      if (dd > maxDrawdown) maxDrawdown = dd;
    }

    const recoveryFactor =
      maxDrawdown > 0 ? Number((netPnL / maxDrawdown).toFixed(2)) : netPnL > 0 ? 999.99 : "NOT_AVAILABLE";

    return {
      netPnL: Number(netPnL.toFixed(2)),
      maxDrawdown: Number(maxDrawdown.toFixed(2)),
      longestLosingStreak,
      recoveryFactor,
    };
  }
}

export const phase33SequenceStressEngine = new Phase33SequenceStressEngine();
