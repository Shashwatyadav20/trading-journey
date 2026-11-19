import { describe, expect, it } from "vitest";
import {
  runExpandedGapStressSuite,
  STRATEGY03_FAIL_CLOSED_GAP_CONTROLS,
  type ProposedOpenPositionRisk,
} from "../Strategy03ReadinessCertifier.js";

describe("Strategy 03 Phase 6.10.3 — Overnight Gap-Risk Remediation", () => {
  it("evaluates 5-20% market-wide, correlated sector, and illiquid single-stock gap scenarios", () => {
    const uncapped: ProposedOpenPositionRisk[] = Array.from({ length: 10 }, (_, i) => ({
      symbol: `SYM${i}`,
      sector: i < 2 ? "IT" : `SEC${i}`,
      notionalWeightPct: 10,
      stopLossPct: 10,
      openRiskPct: 1.0,
    }));
    const uncappedRes = runExpandedGapStressSuite({ positions: uncapped });
    const gap15Uncapped = uncappedRes.find((r) => r.gapPct === 15)!;
    expect(gap15Uncapped.marketWideGapLossPct).toBe(15);
    expect(gap15Uncapped.breaches12PctHaltMarketWide).toBe(true);
    expect(gap15Uncapped.singleStockIlliquidCircuitLossPct).toBe(1.8); // 10% * (15% + 3%) = 1.8%

    const remediated75: ProposedOpenPositionRisk[] = Array.from({ length: 10 }, (_, i) => ({
      symbol: `SYM${i}`,
      sector: i < 2 ? "IT" : `SEC${i}`,
      notionalWeightPct: 7.5,
      stopLossPct: 10,
      openRiskPct: 0.75,
    }));
    const remRes = runExpandedGapStressSuite({ positions: remediated75 });
    const gap15Rem = remRes.find((r) => r.gapPct === 15)!;
    expect(gap15Rem.marketWideGapLossPct).toBe(11.25);
    expect(gap15Rem.breaches12PctHaltMarketWide).toBe(false);
    expect(STRATEGY03_FAIL_CLOSED_GAP_CONTROLS.approvalRequired).toBe(true);
    expect(STRATEGY03_FAIL_CLOSED_GAP_CONTROLS.appliedToProduction).toBe(false);
  });
});

