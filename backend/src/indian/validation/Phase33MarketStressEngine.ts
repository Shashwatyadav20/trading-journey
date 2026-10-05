import { Phase32OOSObservation } from "./Phase32DatasetManager";
import { GenuineTradeRecord } from "../persistence/GenuineSampleStore";
import { StressScenarioDefinition } from "./Phase33StressScenarioManager";

export interface TailLossStressResult {
  scenarioId: string;
  name: string;
  target: string;
  originalNetPnL: number;
  stressedNetPnL: number;
  originalMaxDrawdown: number;
  stressedMaxDrawdown: number;
  largestLossOriginal: number;
  largestLossStressed: number;
}

export class Phase33MarketStressEngine {
  /**
   * Evaluates tail-loss shock scenarios (e.g. 2x largest loss, top 3 losses clustered).
   */
  public runTailLossStress(
    observations: readonly (Phase32OOSObservation | GenuineTradeRecord)[],
    scenarios: readonly StressScenarioDefinition[]
  ): TailLossStressResult[] {
    return scenarios.map((scenario) => {
      const target = scenario.parameters.target || "LARGEST_LOSS";
      const lossMultiplier = scenario.parameters.lossMultiplier ?? 2.0;

      let stressedObs = [...observations].map((o) => ({ ...o }));

      let origLargestLoss = 0;
      let stressedLargestLoss = 0;

      // Find largest loss
      const losses = stressedObs
        .map((o, idx) => ({ idx, pnl: o.netPnL ?? 0 }))
        .filter((l) => l.pnl < 0)
        .sort((a, b) => a.pnl - b.pnl);

      if (losses.length > 0) {
        origLargestLoss = losses[0].pnl;
      }

      if (target === "LARGEST_LOSS" && losses.length > 0) {
        // Double largest loss
        const targetIdx = losses[0].idx;
        stressedObs[targetIdx].netPnL = Number((losses[0].pnl * lossMultiplier).toFixed(2));
        stressedLargestLoss = stressedObs[targetIdx].netPnL;
      } else if (target === "TOP_3_LOSSES" && losses.length > 0) {
        // Cluster top 3 losses at the beginning of the sequence
        const top3Indices = losses.slice(0, 3).map((l) => l.idx);
        const top3Trades = top3Indices.map((i) => stressedObs[i]);
        const otherTrades = stressedObs.filter((_, idx) => !top3Indices.includes(idx));
        stressedObs = [...top3Trades, ...otherTrades];
        stressedLargestLoss = origLargestLoss;
      }

      const origStats = this.computeNetAndDrawdown(observations);
      const stressedStats = this.computeNetAndDrawdown(stressedObs);

      return {
        scenarioId: scenario.scenarioId,
        name: scenario.name,
        target,
        originalNetPnL: origStats.netPnL,
        stressedNetPnL: stressedStats.netPnL,
        originalMaxDrawdown: origStats.maxDrawdown,
        stressedMaxDrawdown: stressedStats.maxDrawdown,
        largestLossOriginal: origLargestLoss,
        largestLossStressed: stressedLargestLoss !== 0 ? stressedLargestLoss : origLargestLoss,
      };
    });
  }

  private computeNetAndDrawdown(records: readonly any[]): { netPnL: number; maxDrawdown: number } {
    let netPnL = 0;
    let peak = 0;
    let currentEquity = 0;
    let maxDrawdown = 0;

    for (const r of records) {
      const pnl = r.netPnL ?? 0;
      netPnL += pnl;

      currentEquity += pnl;
      if (currentEquity > peak) peak = currentEquity;
      const dd = peak - currentEquity;
      if (dd > maxDrawdown) maxDrawdown = dd;
    }

    return {
      netPnL: Number(netPnL.toFixed(2)),
      maxDrawdown: Number(maxDrawdown.toFixed(2)),
    };
  }
}

export const phase33MarketStressEngine = new Phase33MarketStressEngine();
