import { describe, expect, it } from "vitest";
import {
  stressTestSimultaneousStopsAndGaps,
  validateAggregateOpenRisk,
} from "../Strategy03ReadinessCertifier.js";

describe("Strategy 03 Phase 6.10.2 — Aggregate Open Risk & Gap Stress", () => {
  it("enforces the 10% aggregate open-risk ceiling and 25% sector cap independently of notional", () => {
    const ok = validateAggregateOpenRisk({
      positions: [
        { symbol: "INFY", sector: "IT", notionalWeightPct: 12, stopLossPct: 8, openRiskPct: 0.96 },
        { symbol: "TCS", sector: "IT", notionalWeightPct: 12, stopLossPct: 8, openRiskPct: 0.96 },
        { symbol: "RELIANCE", sector: "Energy", notionalWeightPct: 12, stopLossPct: 8, openRiskPct: 0.96 },
      ],
    });
    expect(ok.allowed).toBe(true);
    expect(ok.totalAggregateOpenRiskPct).toBeLessThanOrEqual(10.0);

    const breach = validateAggregateOpenRisk({
      positions: [
        { symbol: "INFY", sector: "IT", notionalWeightPct: 15, stopLossPct: 40, openRiskPct: 6.0 },
        { symbol: "TCS", sector: "IT", notionalWeightPct: 15, stopLossPct: 40, openRiskPct: 6.0 },
      ],
    });
    expect(breach.allowed).toBe(false);
    expect(breach.violations).toContain("AGGREGATE_OPEN_RISK_EXCEEDS_10_PCT");
    expect(breach.violations).toContain("SECTOR_CONCENTRATION_EXCEEDS_25_PCT");
  });

  it("detects 12% portfolio drawdown breach under severe simultaneous overnight gaps", () => {
    const stress = stressTestSimultaneousStopsAndGaps({
      positions: [
        { symbol: "A", sector: "IT", notionalWeightPct: 50, stopLossPct: 8, openRiskPct: 4.0 },
        { symbol: "B", sector: "FMCG", notionalWeightPct: 50, stopLossPct: 8, openRiskPct: 4.0 },
      ],
      overnightGapPct: 14,
    });
    expect(stress.simultaneousStopLossPct).toBe(8);
    expect(stress.overnightGapLossPct).toBe(14);
    expect(stress.breaches12PctPortfolioDrawdown).toBe(true);
  });
});

