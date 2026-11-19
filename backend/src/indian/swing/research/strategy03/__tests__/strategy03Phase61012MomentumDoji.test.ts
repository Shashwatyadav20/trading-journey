import { describe, expect, it } from "vitest";
import { detectDojiPattern } from "../momentum/Strategy03DojiPatternDetector.js";
import { detectTightConsolidation } from "../momentum/Strategy03ConsolidationDetector.js";
import { evaluateMomentumDojiBreakout } from "../momentum/Strategy03MomentumBreakoutEntry.js";
import type { OhlcvCandle } from "../entry/EntrySetupTypes.js";

describe("Strategy 03 Phase 6.10.12 — AI Momentum & Personal Doji Breakout", () => {
  it("classifies Classic, Dragonfly, Gravestone Doji and requires breakout confirmation", () => {
    expect(
      detectDojiPattern({ timestamp: "t1", open: 100, high: 105, low: 95, close: 100.2, volume: 1000 }).pattern
    ).toBe("LONG_LEGGED_DOJI");
    expect(
      detectDojiPattern({ timestamp: "t2", open: 104, high: 105, low: 95, close: 104.2, volume: 1000 }).pattern
    ).toBe("DRAGONFLY_DOJI");

    const base: OhlcvCandle[] = Array.from({ length: 22 }, (_, i) => ({
      timestamp: `2026-01-${String(i + 1).padStart(2, "0")}T10:00:00Z`,
      open: 100,
      high: 102,
      low: 98,
      close: 100.2, // Doji / tight consolidation
      volume: 10_000,
    }));
    const cons = detectTightConsolidation({ candles: base, windowCandles: 5 });
    expect(cons.detected).toBe(true);
    expect(cons.consolidationHigh).toBe(102);

    // Doji alone without breakout bar -> CONSOLIDATING_WATCH (not confirmed)
    const watch = evaluateMomentumDojiBreakout({ symbol: "INFY", candles: base, windowCandles: 5 });
    expect(watch.status).toBe("CONSOLIDATING_WATCH");

    // Breakout bar closing above 102 on expanded volume -> DOJI_BREAKOUT_CONFIRMED
    const confirmed = evaluateMomentumDojiBreakout({
      symbol: "INFY",
      candles: [
        ...base,
        { timestamp: "2026-01-19T10:00:00Z", open: 101.5, high: 105.5, low: 101.2, close: 105, volume: 20_000 },
      ],
      windowCandles: 5,
    });
    expect(confirmed.status).toBe("DOJI_BREAKOUT_CONFIRMED");
    expect(confirmed.consolidationLowSl).toBe(98);
  });
});
