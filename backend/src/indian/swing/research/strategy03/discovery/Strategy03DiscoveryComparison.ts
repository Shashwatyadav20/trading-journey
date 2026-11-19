export type HypothesisVerdict =
  | "PROMISING_FOR_FURTHER_VALIDATION"
  | "NO_ROBUST_IMPROVEMENT"
  | "INCONCLUSIVE"
  | "BLOCKED";

export function classifyDiscoveryHypothesis(oosSummary: {
  tradeCount: number;
  profitFactor: number;
  expectancyR: number;
  maxDrawdownPct: number;
}): { verdict: HypothesisVerdict; reason: string } {
  if (oosSummary.tradeCount < 15) {
    return {
      verdict: "INCONCLUSIVE",
      reason: `OOS sample size (${oosSummary.tradeCount}) below minimum 15 trades.`,
    };
  }
  if (oosSummary.expectancyR > 0 && oosSummary.profitFactor > 1.0 && oosSummary.maxDrawdownPct <= 35) {
    return {
      verdict: "PROMISING_FOR_FURTHER_VALIDATION",
      reason: `Positive OOS expectancy (${oosSummary.expectancyR}R), PF=${oosSummary.profitFactor}, MaxDD=${oosSummary.maxDrawdownPct}% across ${oosSummary.tradeCount} OOS trades.`,
    };
  }
  return {
    verdict: "NO_ROBUST_IMPROVEMENT",
    reason: `OOS expectancy (${oosSummary.expectancyR}R) or PF (${oosSummary.profitFactor}) failed robustness bar.`,
  };
}

