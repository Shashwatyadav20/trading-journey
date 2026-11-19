import { describe, expect, it } from "vitest";
import {
  compute1hAtr14,
  simulateManagedTrade,
  summarizeManagedTrades,
} from "../momentum/Strategy03TradeManagementEvaluator.js";
import type { OhlcvCandle } from "../entry/EntrySetupTypes.js";

describe("Strategy 03 Phase 6.10.15 — Trade Management & Profit Protection", () => {
  it("tracks MFE/MAE, +1R/+2R excursion milestones, profit giveback, and trailing/partial exits", () => {
    const hist: OhlcvCandle[] = Array.from({ length: 16 }, (_, i) => ({
      timestamp: `2026-03-01T0${i % 6}:15:00Z`,
      open: 100,
      high: 102,
      low: 98,
      close: 100,
      volume: 10_000,
    }));
    const atr = compute1hAtr14(hist);
    expect(atr).toBeGreaterThan(0);

    // Entry ~100, SL 97 (risk ~3). Reaches +1.5R (104.5) on bar 2, then reverses to 98.
    const fut: OhlcvCandle[] = [
      { timestamp: "2026-03-02T03:45:00Z", open: 100, high: 102, low: 99.5, close: 101.5, volume: 12000 },
      { timestamp: "2026-03-02T04:45:00Z", open: 101.5, high: 105.0, low: 101, close: 104, volume: 15000 },
      { timestamp: "2026-03-02T05:45:00Z", open: 104, high: 104, low: 96.5, close: 97, volume: 14000 },
    ];

    const fixed = simulateManagedTrade({
      symbol: "INFY",
      sector: "IT",
      capSegment: "LARGE",
      regime: "BULL",
      volRegime: "LOW_VOL",
      entryDate: "2026-03-02",
      future1h: fut,
      slPrice: 97,
      atr14: atr,
      config: { mode: "A_FIXED_1TO3_BASELINE", targetR: 3.0 },
    });
    expect(fixed).not.toBeNull();
    expect(fixed!.reached1RBeforeSL).toBe(true);
    expect(fixed!.barsTo1R).toBe(2);
    expect(fixed!.profitGivebackPct).toBeGreaterThan(5);

    const partial = simulateManagedTrade({
      symbol: "INFY",
      sector: "IT",
      capSegment: "LARGE",
      regime: "BULL",
      volRegime: "LOW_VOL",
      entryDate: "2026-03-02",
      future1h: fut,
      slPrice: 97,
      atr14: atr,
      config: { mode: "E_PARTIAL_50_AT_1R_TRAIL", partialAt1RPct: 0.5, trailAfter1RRiskMult: 1.0 },
    });
    expect(partial).not.toBeNull();
    expect(partial!.netReturnPct).toBeGreaterThan(fixed!.netReturnPct);

    const sum = summarizeManagedTrades([partial!]);
    expect(sum.tradeCount).toBe(1);
  });
});

