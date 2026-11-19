import { describe, expect, it } from "vitest";
import { calculateDhanDeliveryCost } from "../costs/Strategy03DhanDeliveryCostCalculator.js";
import { calculateDhanIntradayCost } from "../costs/Strategy03DhanIntradayCostCalculator.js";
import { buildTradeCostAttribution } from "../costs/Strategy03CostAttribution.js";
import { evaluateExecutionFeasibility } from "../costs/Strategy03ExecutionFeasibility.js";

describe("Strategy 03 Phase 6.10.16 — Dhan Cost Model & Execution Feasibility", () => {
  it("calculates exact Dhan NSE Equity Delivery charges including ₹0 brokerage and ₹14.75 flat DP per sell ISIN", () => {
    const del = calculateDhanDeliveryCost({
      buyPriceInr: 1000,
      sellPriceInr: 1050,
      quantity: 100, // ₹1,00,000 buy, ₹1,05,000 sell
    });
    expect(del.brokerageInr).toBe(0);
    expect(del.sttBuyInr).toBe(100);
    expect(del.sttSellInr).toBe(105);
    expect(del.stampDutyInr).toBe(15);
    expect(del.dpChargeBaseInr).toBe(12.5);
    expect(del.dpChargeGstInr).toBe(2.25);
    expect(del.dpTotalInr).toBe(14.75);
    expect(del.totalChargesInr).toBeGreaterThan(235);
    expect(del.totalChargesInr).toBeLessThan(255);
  });

  it("separates Dhan Equity Intraday charges and keeps execution slippage separate from broker fees", () => {
    const intra = calculateDhanIntradayCost({
      buyPriceInr: 1000,
      sellPriceInr: 1020,
      quantity: 100,
    });
    expect(intra.brokerageInr).toBe(40); // ₹20 buy + ₹20 sell
    expect(intra.dpTotalInr).toBe(0);
    expect(intra.sttBuyInr).toBe(0);

    const attr = buildTradeCostAttribution({
      symbol: "INFY",
      entryDate: "2026-03-02",
      exitDate: "2026-03-05",
      quantity: 100,
      rawEntryPrice: 1000,
      rawExitPrice: 1050,
      slPrice: 970,
      slippageBps: 8,
      costBreakdown: calculateDhanDeliveryCost({ buyPriceInr: 1000.8, sellPriceInr: 1049.16, quantity: 100 }),
    });
    expect(attr.bidAskSpreadStatus).toBe("MISSING");
    expect(attr.grossPnlInr).toBe(5000);
    expect(attr.netPnlInr).toBeLessThan(5000);

    const feas = evaluateExecutionFeasibility({
      symbol: "INFY",
      entryDate: "2026-03-02",
      stockDayTurnoverCr: 200,
      avg20dTurnoverCr: 180,
      assumedOrderValueInr: 100_000,
      nextExecutableEntryPrice: 1000.8,
      nextExecutableExitPrice: 1049.16,
      gapThroughStop: false,
    });
    expect(feas.marketImpactRisk).toBe("LOW");
    expect(feas.historicalBidAskAvailability).toBe("MISSING");
  });
});

