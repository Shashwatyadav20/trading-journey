import { describe, expect, it } from "vitest";
import { computeBootstrapStats, maxConsecutiveLosses } from "../runPhase61017Research.js";
import type { TradeCostAttributionRecord } from "../costs/Strategy03CostAttribution.js";

function makeTrade(netPnlInr: number, netRMultiple: number): TradeCostAttributionRecord {
  return {
    symbol: "INFY",
    entryDate: "2025-01-10",
    exitDate: "2025-01-15",
    segment: "EQUITY_DELIVERY",
    quantity: 100,
    rawEntryPrice: 1000,
    rawExitPrice: 1000 + netPnlInr / 100,
    executableEntryPrice: 1000,
    executableExitPrice: 1000 + netPnlInr / 100,
    grossPnlInr: netPnlInr,
    grossReturnPct: netPnlInr / 1000,
    dhanBrokerageInr: 0,
    sttInr: 200,
    exchangeChargesInr: 6,
    sebiChargesInr: 0.2,
    stampDutyInr: 15,
    gstInr: 3.3,
    dpChargesInr: 14.75,
    totalDhanAndStatutoryInr: 239.25,
    bidAskSpreadStatus: "MISSING",
    entrySlippageInr: 0,
    exitSlippageInr: 0,
    totalExecutionSlippageInr: 0,
    marketImpactEstimateInr: 0,
    extraStressCostInr: 0,
    netPnlInr,
    netReturnPct: netPnlInr / 1000,
    riskPct: 3,
    netRMultiple,
  };
}

describe("Strategy 03 Phase 6.10.17 — Independent Statistical Validation", () => {
  it("computes max consecutive losses and deterministic bootstrap CIs", () => {
    const trades = [
      makeTrade(3000, 1.0),
      makeTrade(-1000, -0.33),
      makeTrade(-1200, -0.4),
      makeTrade(-800, -0.27),
      makeTrade(4000, 1.33),
      makeTrade(2500, 0.83),
    ];
    expect(maxConsecutiveLosses(trades)).toBe(3);

    const bs = computeBootstrapStats(trades, 500);
    expect(bs.expectancyR_CI95[0]).toBeLessThanOrEqual(bs.expectancyR_CI95[1]);
    expect(bs.probNegativeExpectancyPct).toBeGreaterThanOrEqual(0);
    expect(bs.probNegativeExpectancyPct).toBeLessThanOrEqual(100);
  });
});

