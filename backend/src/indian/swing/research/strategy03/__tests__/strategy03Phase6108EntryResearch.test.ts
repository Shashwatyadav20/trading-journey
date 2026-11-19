import { describe, expect, it } from "vitest";
import { aggregate1hTo4hCandles, type OhlcvCandle } from "../entry/EntrySetupTypes.js";
import { evaluateVolumeBreakoutEntry } from "../entry/Strategy03VolumeBreakoutEntry.js";
import { evaluateBreakoutRetestEntry } from "../entry/Strategy03BreakoutRetestEntry.js";
import { evaluateSupportBounceEntry } from "../entry/Strategy03SupportBounceEntry.js";
import { evaluateStrategy03EntrySetups } from "../entry/Strategy03EntrySetupEvaluator.js";

function mkDaily(n: number, base = 100): OhlcvCandle[] {
  return Array.from({ length: n }, (_, i) => ({
    timestamp: `2025-01-${String((i % 28) + 1).padStart(2, "0")}`,
    open: base,
    high: base + 2,
    low: base - 2,
    close: base + 0.5,
    volume: 100_000,
  }));
}

describe("Strategy 03 Phase 6.10.8 — Entry Strategy Research & Validation", () => {
  it("aggregates 1H candles into 4H candles deterministically", () => {
    const h1: OhlcvCandle[] = [
      { timestamp: "2025-01-02T04:00:00Z", open: 100, high: 103, low: 99, close: 102, volume: 1000 },
      { timestamp: "2025-01-02T05:00:00Z", open: 102, high: 105, low: 101, close: 104, volume: 1500 },
    ];
    const h4 = aggregate1hTo4hCandles(h1);
    expect(h4).toHaveLength(1);
    expect(h4[0].open).toBe(100);
    expect(h4[0].high).toBe(105);
    expect(h4[0].low).toBe(99);
    expect(h4[0].close).toBe(104);
    expect(h4[0].volume).toBe(2500);
  });

  it("confirms Volume Breakout at 1.5x/2.0x RVOL and forces WAIT on stale/missing fundamentals", () => {
    const d = mkDaily(30, 100);
    // Breakout bar on last day: resistance was 102, close 106 on 2.2x volume
    d[d.length - 1] = { timestamp: "2025-02-01", open: 101, high: 106.5, low: 100.5, close: 106, volume: 220_000 };
    const h1: OhlcvCandle[] = Array.from({ length: 30 }, (_, i) => ({
      timestamp: `2025-02-01T0${i % 9}:00:00Z`,
      open: 105,
      high: 106.5,
      low: 104.5,
      close: 106,
      volume: 20_000,
    }));
    const h4 = aggregate1hTo4hCandles(h1);

    const vb = evaluateVolumeBreakoutEntry({
      symbol: "INFY",
      dailyCandles: d,
      candles4h: h4,
      candles1h: h1,
      minRelativeVolume: 2.0,
      nextOpen1h: 106.2,
    });
    expect(vb.classification).toBe("BREAKOUT_CONFIRMED");
    expect(vb.relativeVolume).toBeGreaterThanOrEqual(2.0);

    // Stale fundamental data must force WAIT even with confirmed breakout
    const combinedStale = evaluateStrategy03EntrySetups({
      symbol: "INFY",
      fundamentalScoreUnchanged: 80,
      fundamentalVerificationStatus: "STALE",
      dailyCandles: d,
      candles4h: h4,
      candles1h: h1,
    });
    expect(combinedStale.entryClassification).toBe("WAIT");
    expect(combinedStale.fundamentalScoreUnchanged).toBe(80);
  });

  it("rejects falling-knife Support Bounce without 1H reversal and keeps unconfirmed setups as WATCH", () => {
    const d = mkDaily(50, 100);
    const h1: OhlcvCandle[] = Array.from({ length: 10 }, (_, i) => ({
      timestamp: `2025-02-01T0${i}:00:00Z`,
      open: 100,
      high: 100.5,
      low: 98,
      close: 98.2, // Red falling candle
      volume: 10_000,
    }));
    const h4 = aggregate1hTo4hCandles(h1);
    const bounce = evaluateSupportBounceEntry({ symbol: "TCS", dailyCandles: d, candles4h: h4, candles1h: h1 });
    expect(bounce.classification).not.toBe("SUPPORT_BOUNCE_CONFIRMED");

    const retest = evaluateBreakoutRetestEntry({ symbol: "TCS", dailyCandles: d, candles4h: h4, candles1h: h1 });
    expect(retest.classification).not.toBe("RETEST_CONFIRMED");

    const combined = evaluateStrategy03EntrySetups({
      symbol: "TCS",
      fundamentalScoreUnchanged: 85,
      fundamentalVerificationStatus: "VERIFIED",
      dailyCandles: d,
      candles4h: h4,
      candles1h: h1,
    });
    expect(combined.entryClassification).toBe("WATCH");
  });
});

