import { describe, expect, it } from "vitest";
import { evaluateAllDiscoveryHypothesesAsOf } from "../discovery/Strategy03DiscoveryEvaluator.js";
import { classifyDiscoveryHypothesis } from "../discovery/Strategy03DiscoveryComparison.js";

describe("Strategy 03 Phase 6.10.10 — Independent Strategy Discovery", () => {
  it("forces WAIT / ineligible when verified financials or ownership are missing", () => {
    const sigs = evaluateAllDiscoveryHypothesesAsOf({
      symbol: "TEST",
      sector: "IT",
      marketCapCategory: "LARGE_CAP",
      asOfDate: "2025-06-01",
      financials: [],
      ownership: [],
      candles: [],
      benchmarkCandles: [],
    });
    expect(sigs).toHaveLength(3);
    expect(sigs.every((s) => s.eligible === false)).toBe(true);
  });

  it("classifies discovery hypotheses strictly by OOS expectancy, PF, drawdown, and sample size", () => {
    expect(
      classifyDiscoveryHypothesis({ tradeCount: 10, profitFactor: 2.0, expectancyR: 0.5, maxDrawdownPct: 10 }).verdict
    ).toBe("INCONCLUSIVE");
    expect(
      classifyDiscoveryHypothesis({ tradeCount: 25, profitFactor: 1.45, expectancyR: 0.25, maxDrawdownPct: 18 }).verdict
    ).toBe("PROMISING_FOR_FURTHER_VALIDATION");
    expect(
      classifyDiscoveryHypothesis({ tradeCount: 30, profitFactor: 0.85, expectancyR: -0.1, maxDrawdownPct: 22 }).verdict
    ).toBe("NO_ROBUST_IMPROVEMENT");
  });
});

