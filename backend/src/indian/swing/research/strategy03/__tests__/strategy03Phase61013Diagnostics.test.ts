import { describe, expect, it } from "vitest";
import {
  classifyCapSegment,
  classifyNiftyRegime,
  simulateTrade1h,
  summarizeTrades,
} from "../runPhase61013Research.js";
import type { DailyCandleBar } from "../HistoricalValidationEngine.js";
import type { OhlcvCandle } from "../entry/EntrySetupTypes.js";

describe("Strategy 03 Phase 6.10.13 — Mode C & Doji Diagnostics", () => {
  it("classifies market regimes, cap segments, and simulates 1H trade outcomes with realistic costs", () => {
    const bullNifty: DailyCandleBar[] = Array.from({ length: 60 }, (_, i) => ({
      date: `2026-01-${String((i % 28) + 1).padStart(2, "0")}`,
      open: 20000 + i * 20,
      high: 20050 + i * 20,
      low: 19950 + i * 20,
      close: 20020 + i * 20,
      adjClose: 20020 + i * 20,
      volume: 1000000,
    }));
    expect(classifyNiftyRegime(bullNifty)).toBe("BULL");
    expect(classifyCapSegment(25000, null)).toBe("LARGE");
    expect(classifyCapSegment(8000, null)).toBe("MID");
    expect(classifyCapSegment(2000, null)).toBe("SMALL");

    const fut: OhlcvCandle[] = [
      { timestamp: "2026-03-01T09:15:00Z", open: 100, high: 102, low: 99, close: 101, volume: 10000 },
      { timestamp: "2026-03-01T10:15:00Z", open: 101, high: 110, low: 100.5, close: 109, volume: 12000 },
    ];
    const trade = simulateTrade1h({
      symbol: "INFY",
      sector: "IT",
      capSegment: "LARGE",
      regime: "BULL",
      future1h: fut,
      slPrice: 97,
      targetR: 3.0,
    });
    expect(trade).not.toBeNull();
    expect(trade!.exitReason).toBe("TARGET_HIT");
    expect(trade!.netReturnPct).toBeGreaterThan(8);

    const summary = summarizeTrades([trade!]);
    expect(summary.tradeCount).toBe(1);
    expect(summary.winRatePct).toBe(100);
  });
});

