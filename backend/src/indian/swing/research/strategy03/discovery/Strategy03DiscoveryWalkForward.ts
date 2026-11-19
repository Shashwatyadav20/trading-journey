import { wilsonWinRateCI, type RegimeDayLabel } from "../StatisticalRobustnessEngine.js";
import type { DiscoveryTradeOutcome } from "./Strategy03DiscoveryBacktester.js";

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

export function summarizeDiscoveryOutcomes(outcomes: DiscoveryTradeOutcome[]) {
  if (outcomes.length === 0) {
    return {
      tradeCount: 0,
      winRatePct: 0,
      winRateCI95: [0, 0] as [number, number],
      profitFactor: 0,
      expectancyR: 0,
      avgWinPct: 0,
      avgLossPct: 0,
      maxDrawdownPct: 0,
      avgHoldingDays: 0,
      avg5dPct: null as number | null,
      avg10dPct: null as number | null,
      avg20dPct: null as number | null,
      avg60dPct: null as number | null,
      avgMfePct: 0,
      avgMaePct: 0,
    };
  }
  const wins = outcomes.filter((o) => o.netReturnPct > 0);
  const losses = outcomes.filter((o) => o.netReturnPct <= 0);
  const gw = wins.reduce((a, o) => a + o.netReturnPct, 0);
  const gl = Math.abs(losses.reduce((a, o) => a + o.netReturnPct, 0));

  let eq = 1.0;
  let peak = 1.0;
  let maxDd = 0;
  for (const o of outcomes) {
    eq *= 1 + o.netReturnPct / 100;
    if (eq > peak) peak = eq;
    const dd = (peak - eq) / peak;
    if (dd > maxDd) maxDd = dd;
  }

  const avgF = (arr: Array<number | null>) => {
    const v = arr.filter((x): x is number => x !== null);
    return v.length > 0 ? round2(v.reduce((a, b) => a + b, 0) / v.length) : null;
  };
  const ci = wilsonWinRateCI(wins.length, outcomes.length);

  return {
    tradeCount: outcomes.length,
    winRatePct: ci.ratePct,
    winRateCI95: [ci.ciLowPct, ci.ciHighPct] as [number, number],
    profitFactor: gl > 0 ? round2(gw / gl) : wins.length > 0 ? 99 : 0,
    expectancyR: round2(outcomes.reduce((a, o) => a + o.rMultiple, 0) / outcomes.length),
    avgWinPct: wins.length > 0 ? round2(gw / wins.length) : 0,
    avgLossPct: losses.length > 0 ? round2(-gl / losses.length) : 0,
    maxDrawdownPct: round2(maxDd * 100),
    avgHoldingDays: round2(outcomes.reduce((a, o) => a + o.holdingDays, 0) / outcomes.length),
    avg5dPct: avgF(outcomes.map((o) => o.ret5dPct)),
    avg10dPct: avgF(outcomes.map((o) => o.ret10dPct)),
    avg20dPct: avgF(outcomes.map((o) => o.ret20dPct)),
    avg60dPct: avgF(outcomes.map((o) => o.ret60dPct)),
    avgMfePct: round2(outcomes.reduce((a, o) => a + o.mfePct, 0) / outcomes.length),
    avgMaePct: round2(outcomes.reduce((a, o) => a + o.maePct, 0) / outcomes.length),
  };
}

export function buildWalkForwardAndRegimeBreakdown(
  outcomes: DiscoveryTradeOutcome[],
  regimeMap: Map<string, RegimeDayLabel>
) {
  return {
    train_2022_2023: summarizeDiscoveryOutcomes(outcomes.filter((o) => o.entryDate <= "2023-12-31")),
    validation_2024: summarizeDiscoveryOutcomes(
      outcomes.filter((o) => o.entryDate >= "2024-01-01" && o.entryDate <= "2024-12-31")
    ),
    outOfSample_2025_2026: summarizeDiscoveryOutcomes(outcomes.filter((o) => o.entryDate >= "2025-01-01")),
    regimes: {
      BULL: summarizeDiscoveryOutcomes(outcomes.filter((o) => regimeMap.get(o.entryDate)?.trendRegime === "BULL")),
      BEAR: summarizeDiscoveryOutcomes(outcomes.filter((o) => regimeMap.get(o.entryDate)?.trendRegime === "BEAR")),
      SIDEWAYS: summarizeDiscoveryOutcomes(outcomes.filter((o) => regimeMap.get(o.entryDate)?.trendRegime === "SIDEWAYS")),
    },
  };
}

