import { describe, expect, it } from "vitest";
import {
  evaluateIntradayEventsForDay,
  sanitizeIntraday1hSeries,
  toIstDateAndTime,
  type IntradayCandleWithMeta,
} from "../momentum/Strategy03IntradayEventEvaluator.js";

describe("Strategy 03 Phase 6.10.14 — Intraday Event-Driven Detection", () => {
  it("converts timestamps to Asia/Kolkata, enforces NSE session bounds, and skips incomplete/duplicate bars", () => {
    const ist = toIstDateAndTime("2026-03-02T03:45:00.000Z"); // 09:15 IST
    expect(ist.istDate).toBe("2026-03-02");
    expect(ist.istTime).toBe("09:15");

    const { candles, integrity } = sanitizeIntraday1hSeries([
      { timestamp: "2026-03-02T03:45:00.000Z", open: 100, high: 101, low: 99, close: 100, volume: 1000 },
      { timestamp: "2026-03-02T03:45:00.000Z", open: 100, high: 101, low: 99, close: 100, volume: 1000 }, // duplicate
      { timestamp: "2026-03-02T12:00:00.000Z", open: 100, high: 101, low: 99, close: 100, volume: 1000 }, // 17:30 IST out-of-session
      { timestamp: "2026-03-02T04:45:00.000Z", open: 100, high: 101, low: 99, close: 100, volume: 1000, isComplete: false },
    ]);
    expect(candles).toHaveLength(1);
    expect(integrity.duplicateTimestampsRemoved).toBe(1);
    expect(integrity.outOfSessionCandles).toBe(1);
    expect(integrity.incompleteCandlesSkipped).toBe(1);
  });

  it("captures first intraday 1H breakout that EOD-only 15:15 IST misses, and prevents duplicate intraday signals", () => {
    const history: IntradayCandleWithMeta[] = Array.from({ length: 22 }, (_, i) => ({
      timestamp: `2026-03-0${Math.floor(i / 6) + 1}T0${4 + (i % 6)}:15:00.000Z`,
      open: 100,
      high: 102,
      low: 98,
      close: 100.1,
      volume: 10_000,
    }));
    // Day 2026-03-10: 09:15, 10:15, 11:15 breakout, 12:15 second breakout, 15:15 quiet EOD bar
    const dayBars: IntradayCandleWithMeta[] = [
      { timestamp: "2026-03-10T03:45:00.000Z", open: 100, high: 101.8, low: 98.5, close: 100.2, volume: 9_000 },
      { timestamp: "2026-03-10T04:45:00.000Z", open: 100.2, high: 105.5, low: 100.0, close: 105.0, volume: 22_000 }, // 10:15 IST breakout #1
      { timestamp: "2026-03-10T09:45:00.000Z", open: 105.0, high: 105.5, low: 104.5, close: 104.8, volume: 8_000 }, // 15:15 IST EOD (no breakout)
    ];

    const { candles } = sanitizeIntraday1hSeries([...history, ...dayBars]);
    const ev = evaluateIntradayEventsForDay({
      symbol: "INFY",
      istDate: "2026-03-10",
      sanitizedCandles: candles,
      windowCandles: 5,
    });

    expect(ev.firstBreakout).not.toBeNull();
    expect(ev.firstBreakout!.istTime).toBe("10:15");
    expect(ev.eodOnlyBreakout).toBeNull();
  });
});

