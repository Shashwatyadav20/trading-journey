import { Phase32OOSObservation } from "./Phase32DatasetManager";
import { GenuineTradeRecord } from "../persistence/GenuineSampleStore";
import { StressScenarioDefinition } from "./Phase33StressScenarioManager";

export interface ExecutionStressResult {
  scenarioId: string;
  name: string;
  severity: string;
  totalTrades: number;
  originalNetPnL: number;
  stressedNetPnL: number;
  netPnLDiff: number;
  originalExpectancy: number;
  stressedExpectancy: number;
  expectancyDiff: number;
  originalWinRate: number;
  stressedWinRate: number;
  originalProfitFactor: number | "NOT_AVAILABLE";
  stressedProfitFactor: number | "NOT_AVAILABLE";
  originalMaxDrawdown: number;
  stressedMaxDrawdown: number;
}

export class Phase33ExecutionStressEngine {
  /**
   * Evaluates slippage stress across progressively larger execution cost assumptions.
   */
  public runSlippageStress(
    observations: readonly (Phase32OOSObservation | GenuineTradeRecord)[],
    scenarios: readonly StressScenarioDefinition[]
  ): ExecutionStressResult[] {
    return scenarios.map((scenario) => {
      const multiplier = scenario.parameters.multiplier ?? 1.0;
      const extraInr = scenario.parameters.extraSlippageInr ?? 0;

      const stressedObs = observations.map((obs) => {
        const origSlippage = obs.slippage || 0;
        const stressedSlippage = origSlippage * multiplier + extraInr;
        const slippageIncrease = stressedSlippage - origSlippage;
        const origNet = obs.netPnL ?? 0;
        const stressedNet = origNet - slippageIncrease;

        return {
          ...obs,
          netPnL: stressedNet,
          slippage: stressedSlippage,
        };
      });

      return this.buildResult(scenario, observations, stressedObs);
    });
  }

  /**
   * Evaluates deterministic execution delay between Signal -> Paper Entry.
   */
  public runDelayStress(
    observations: readonly (Phase32OOSObservation | GenuineTradeRecord)[],
    scenarios: readonly StressScenarioDefinition[]
  ): ExecutionStressResult[] {
    return scenarios.map((scenario) => {
      const delaySeconds = scenario.parameters.delaySeconds ?? 0;
      const adverseImpactPct = scenario.parameters.adverseImpactPct ?? 0;

      const stressedObs = observations.map((obs) => {
        const origNet = obs.netPnL ?? 0;
        // Delay introduces adverse price slippage proportional to delay length
        const delayPenalty = Math.abs(origNet) * (adverseImpactPct * (delaySeconds / 5));
        const stressedNet = origNet - delayPenalty;

        return {
          ...obs,
          netPnL: Number(stressedNet.toFixed(2)),
        };
      });

      return this.buildResult(scenario, observations, stressedObs);
    });
  }

  /**
   * Evaluates spread widening stress on Bull Put, Bear Call, and Iron Condor spreads.
   */
  public runSpreadWideningStress(
    observations: readonly (Phase32OOSObservation | GenuineTradeRecord)[],
    scenarios: readonly StressScenarioDefinition[]
  ): ExecutionStressResult[] {
    return scenarios.map((scenario) => {
      const spreadMultiplier = scenario.parameters.spreadMultiplier ?? 1.0;

      const stressedObs = observations.map((obs) => {
        const origNet = obs.netPnL ?? 0;
        const origCharges = (obs.brokerage || 0) + (obs.STT || 0) + (obs.exchangeCharges || 0);
        // Spread widening increases entry/exit execution friction
        const spreadPenalty = origCharges * (spreadMultiplier - 1.0) + 15 * (spreadMultiplier - 1.0);
        const stressedNet = origNet - spreadPenalty;

        return {
          ...obs,
          netPnL: Number(stressedNet.toFixed(2)),
        };
      });

      return this.buildResult(scenario, observations, stressedObs);
    });
  }

  private buildResult(
    scenario: StressScenarioDefinition,
    originalObs: readonly any[],
    stressedObs: readonly any[]
  ): ExecutionStressResult {
    const origStats = this.computeStats(originalObs);
    const stressedStats = this.computeStats(stressedObs);

    return {
      scenarioId: scenario.scenarioId,
      name: scenario.name,
      severity: scenario.severity,
      totalTrades: originalObs.length,
      originalNetPnL: origStats.netPnL,
      stressedNetPnL: stressedStats.netPnL,
      netPnLDiff: Number((stressedStats.netPnL - origStats.netPnL).toFixed(2)),
      originalExpectancy: origStats.expectancy,
      stressedExpectancy: stressedStats.expectancy,
      expectancyDiff: Number((stressedStats.expectancy - origStats.expectancy).toFixed(2)),
      originalWinRate: origStats.winRate,
      stressedWinRate: stressedStats.winRate,
      originalProfitFactor: origStats.profitFactor,
      stressedProfitFactor: stressedStats.profitFactor,
      originalMaxDrawdown: origStats.maxDrawdown,
      stressedMaxDrawdown: stressedStats.maxDrawdown,
    };
  }

  private computeStats(records: readonly any[]): {
    netPnL: number;
    expectancy: number;
    winRate: number;
    profitFactor: number | "NOT_AVAILABLE";
    maxDrawdown: number;
  } {
    const total = records.length;
    if (total === 0) {
      return { netPnL: 0, expectancy: 0, winRate: 0, profitFactor: "NOT_AVAILABLE", maxDrawdown: 0 };
    }

    let netPnL = 0;
    let wins = 0;
    let grossWin = 0;
    let grossLoss = 0;
    let peak = 0;
    let currentEquity = 0;
    let maxDrawdown = 0;

    for (const r of records) {
      const pnl = r.netPnL ?? 0;
      netPnL += pnl;

      if (pnl > 0) {
        wins++;
        grossWin += pnl;
      } else if (pnl < 0) {
        grossLoss += Math.abs(pnl);
      }

      currentEquity += pnl;
      if (currentEquity > peak) peak = currentEquity;
      const dd = peak - currentEquity;
      if (dd > maxDrawdown) maxDrawdown = dd;
    }

    const winRate = Number(((wins / total) * 100).toFixed(2));
    const expectancy = Number((netPnL / total).toFixed(2));
    const profitFactor = grossLoss === 0 ? (grossWin > 0 ? 999.99 : "NOT_AVAILABLE") : Number((grossWin / grossLoss).toFixed(2));

    return {
      netPnL: Number(netPnL.toFixed(2)),
      expectancy,
      winRate,
      profitFactor,
      maxDrawdown: Number(maxDrawdown.toFixed(2)),
    };
  }
}

export const phase33ExecutionStressEngine = new Phase33ExecutionStressEngine();
