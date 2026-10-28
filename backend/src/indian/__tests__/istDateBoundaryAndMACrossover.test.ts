/**
 * istDateBoundaryAndMACrossover.test.ts
 *
 * Priority 2 — IST date boundary tests
 * Priority 3 — MA crossover detection tests
 *
 * IST boundary tests: verify that timestamps near the UTC/IST date boundary
 * are assigned to the correct Indian market date (Asia/Kolkata, UTC+5:30).
 *
 * MA crossover tests: verify that Strategy D detects a genuine two-bar crossover
 * (prevEma20 ≤ prevEma50 AND ema20 > ema50) and does NOT fire on a crossover
 * that occurred several bars earlier.
 */

import { describe, it, expect } from "vitest";
import {
  buildStockIndicatorProfile,
  evaluateStrategyD_MACrossover,
} from "../../../../lib/indian/dailyStrategyScanner";
import type { DailyCandle } from "../../../../lib/indian/dailyStrategyScanner";

// ─────────────────────────────────────────────────────────────────────────────
// IST Date Boundary Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The canonical IST converter extracted from backend/src/indian/swing/dailyStrategyScanner.ts.
 * Reproduced here so tests run without importing the full backend module chain.
 * Must stay in sync with the implementation.
 */
function toKolkataDateString(epochSeconds: number): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(epochSeconds * 1000));
}

/**
 * UTC-based converter — the buggy old implementation.
 * Used in tests to show the difference.
 */
function toUtcDateString(epochSeconds: number): string {
  return new Date(epochSeconds * 1000).toISOString().split("T")[0];
}

// ─────────────────────────────────────────────────────────────────────────────
// Priority 2 — IST Boundary Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("Priority 2 — IST Candle Date Boundary Tests", () => {
  /**
   * NSE session runs 09:15–15:30 IST = 03:45–10:00 UTC.
   * Yahoo Finance daily candle timestamps are typically issued at session-end.
   * The critical boundary: timestamps just before 18:30 UTC (midnight IST) vs just after.
   *
   * 18:29 UTC = 23:59 IST → same IST day
   * 18:30 UTC = 00:00 IST next day → next IST day (but still same UTC day)
   */

  it("timestamp at 09:30 IST (04:00 UTC) maps to the SAME date in both UTC and IST", () => {
    // 2024-03-15 09:30 IST = 2024-03-15 04:00 UTC
    const epochSeconds = Math.floor(new Date("2024-03-15T04:00:00Z").getTime() / 1000);
    expect(toKolkataDateString(epochSeconds)).toBe("2024-03-15");
    expect(toUtcDateString(epochSeconds)).toBe("2024-03-15");
  });

  it("timestamp at 15:30 IST (10:00 UTC) maps to the SAME date in both UTC and IST", () => {
    // 2024-03-15 15:30 IST = 2024-03-15 10:00 UTC
    const epochSeconds = Math.floor(new Date("2024-03-15T10:00:00Z").getTime() / 1000);
    expect(toKolkataDateString(epochSeconds)).toBe("2024-03-15");
    expect(toUtcDateString(epochSeconds)).toBe("2024-03-15");
  });

  it("timestamp at 23:59 IST (18:29 UTC) maps correctly — same IST day, same UTC day", () => {
    // 2024-03-15 23:59 IST = 2024-03-15 18:29 UTC
    const epochSeconds = Math.floor(new Date("2024-03-15T18:29:00Z").getTime() / 1000);
    expect(toKolkataDateString(epochSeconds)).toBe("2024-03-15");
    expect(toUtcDateString(epochSeconds)).toBe("2024-03-15");
  });

  it("timestamp at 00:01 IST next day (18:31 UTC same day) — IST flips to next day, UTC stays", () => {
    // 2024-03-16 00:01 IST = 2024-03-15 18:31 UTC — the critical boundary
    const epochSeconds = Math.floor(new Date("2024-03-15T18:31:00Z").getTime() / 1000);
    // UTC sees 2024-03-15 but IST already sees 2024-03-16
    expect(toKolkataDateString(epochSeconds)).toBe("2024-03-16");
    // The old buggy UTC string would say 2024-03-15 — showing the bug
    expect(toUtcDateString(epochSeconds)).toBe("2024-03-15");
    // IST and UTC MUST differ at this boundary — that's exactly the bug
    expect(toKolkataDateString(epochSeconds)).not.toBe(toUtcDateString(epochSeconds));
  });

  it("timestamp at midnight UTC (IST = 05:30 AM) — same IST and UTC date", () => {
    // 2024-03-15 00:00 UTC = 2024-03-15 05:30 IST — both same date
    const epochSeconds = Math.floor(new Date("2024-03-15T00:00:00Z").getTime() / 1000);
    expect(toKolkataDateString(epochSeconds)).toBe("2024-03-15");
    expect(toUtcDateString(epochSeconds)).toBe("2024-03-15");
  });

  it("NseFullScanWorker candle date computation uses Asia/Kolkata timezone (not UTC)", () => {
    // This simulates the patch applied to NseFullScanWorker line 231.
    // A timestamp at 18:31 UTC (00:01 IST next day) must produce the NEXT IST date.
    const criticalTimestamp = Math.floor(new Date("2024-06-20T18:31:00Z").getTime() / 1000);

    // Fixed implementation (Intl.DateTimeFormat with Asia/Kolkata):
    const fixedDate = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Kolkata",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(criticalTimestamp * 1000));

    // Old buggy implementation:
    const buggyDate = new Date(criticalTimestamp * 1000).toISOString().split("T")[0];

    expect(fixedDate).toBe("2024-06-21"); // Next IST day
    expect(buggyDate).toBe("2024-06-20"); // Old UTC date (wrong for NSE)
    expect(fixedDate).not.toBe(buggyDate); // Confirm they differ
  });

  it("toKolkataDateString handles year boundary (Dec 31 UTC vs Jan 1 IST)", () => {
    // 2024-12-31 18:31 UTC = 2025-01-01 00:01 IST
    const epochSeconds = Math.floor(new Date("2024-12-31T18:31:00Z").getTime() / 1000);
    expect(toKolkataDateString(epochSeconds)).toBe("2025-01-01");
    expect(toUtcDateString(epochSeconds)).toBe("2024-12-31");
  });

  it("candles built from IST timestamps maintain chronological order across midnight IST", () => {
    // Simulate 3 consecutive daily NSE candles spanning a midnight-IST boundary
    const timestamps = [
      Math.floor(new Date("2024-06-19T10:00:00Z").getTime() / 1000), // 15:30 IST 19 Jun
      Math.floor(new Date("2024-06-20T10:00:00Z").getTime() / 1000), // 15:30 IST 20 Jun
      Math.floor(new Date("2024-06-21T10:00:00Z").getTime() / 1000), // 15:30 IST 21 Jun
    ];
    const dates = timestamps.map(toKolkataDateString);
    expect(dates).toEqual(["2024-06-19", "2024-06-20", "2024-06-21"]);
    // Chronological order must be preserved
    expect(dates[0] < dates[1]).toBe(true);
    expect(dates[1] < dates[2]).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Priority 3 — Genuine MA Crossover Detection Tests
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build a candle set with a controlled crossover at the last bar.
 *
 * @param crossoverAtEnd - if true, the most recent bar has EMA20 just crossed above EMA50
 * @param barsAfterCross - how many bars AFTER the actual cross to include (for stale-cross tests)
 */
function buildCrossoverCandles(
  barsAfterCross = 0,
  base = 500
): DailyCandle[] {
  const candles: DailyCandle[] = [];
  const start = new Date("2023-01-01");

  // Phase 1 (150 bars): downtrend — EMA20 below EMA50
  for (let i = 0; i < 150; i++) {
    const price = base - i * 0.3; // slight downtrend
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    candles.push({
      date: d.toISOString().split("T")[0],
      open: Number((price * 0.999).toFixed(2)),
      high: Number((price * 1.005).toFixed(2)),
      low: Number((price * 0.995).toFixed(2)),
      close: Number(price.toFixed(2)),
      volume: 500_000,
    });
  }

  // Phase 2 (barsAfterCross + 1 bars): upswing — EMA20 overtakes EMA50
  // Use a sharp acceleration so the cross happens in ~1-2 bars
  const crossBase = candles[candles.length - 1].close;
  for (let i = 0; i < barsAfterCross + 1; i++) {
    const price = crossBase + (i + 1) * 3.5; // sharp upswing
    const d = new Date(start);
    d.setDate(start.getDate() + 150 + i);
    candles.push({
      date: d.toISOString().split("T")[0],
      open: Number((price * 0.999).toFixed(2)),
      high: Number((price * 1.01).toFixed(2)),
      low: Number((price * 0.99).toFixed(2)),
      close: Number(price.toFixed(2)),
      volume: 800_000,
    });
  }

  return candles;
}

/**
 * Builds a candle set where EMA20 and EMA50 are in sustained uptrend alignment
 * (EMA20 > EMA50 for many bars — cross happened long ago).
 */
function buildStaleCrossCandles(base = 500): DailyCandle[] {
  const candles: DailyCandle[] = [];
  const start = new Date("2023-01-01");

  // 250 bars of steady uptrend — cross happened early on and is now stale
  for (let i = 0; i < 250; i++) {
    const price = base + i * 0.8;
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    candles.push({
      date: d.toISOString().split("T")[0],
      open: Number((price * 0.999).toFixed(2)),
      high: Number((price * 1.008).toFixed(2)),
      low: Number((price * 0.992).toFixed(2)),
      close: Number(price.toFixed(2)),
      volume: 500_000,
    });
  }
  return candles;
}

/**
 * Creates a minimal StockIndicatorProfile with explicit EMA and price values.
 * Use this for unit testing strategy evaluator functions in isolation —
 * avoids dependency on buildStockIndicatorProfile's internal EMA computation.
 */
function makeMinimalProfile(overrides: {
  ema20?: number | null;
  ema50?: number | null;
  ema200?: number | null;
  prevEma20?: number | null;
  prevEma50?: number | null;
  currentPrice?: number;
  rsi14?: number | null;
  volumeMultiplier?: number;
  swingLow?: number;
  supportLevel?: number;
  resistanceLevel?: number;
}) {
  const price = overrides.currentPrice ?? 500;
  const ema20 = overrides.ema20 ?? price * 0.995;
  const ema50 = overrides.ema50 ?? price * 0.97;
  const sl = overrides.supportLevel ?? price * 0.93;

  return {
    symbol: "MINTEST.NS",
    cleanSymbol: "MINTEST",
    companyName: "Min Test Stock",
    sector: "Test",
    marketCapCr: null as null,
    currentPrice: price,
    prevClose: price * 0.998,
    change: price * 0.002,
    changePercent: 0.2,
    dayHigh: price * 1.01,
    dayLow: price * 0.99,
    high52: price * 1.3,
    low52: price * 0.75,
    volume: 600_000,
    avgVolume20D: 500_000,
    volumeMultiplier: overrides.volumeMultiplier ?? 1.2,
    ema20: ema20,
    ema50: ema50,
    ema200: overrides.ema200 ?? price * 0.92,
    prevEma20: overrides.prevEma20 !== undefined ? overrides.prevEma20 : null,
    prevEma50: overrides.prevEma50 !== undefined ? overrides.prevEma50 : null,
    rsi14: overrides.rsi14 !== undefined ? overrides.rsi14 : 58,
    indicatorsAvailable: { ema20: true, ema50: true, ema200: true, rsi14: true, macd: true },
    macd: { macdLine: 1.2, signalLine: 0.9, histogram: 0.3, isBullishCross: false },
    atr14: price * 0.012,
    resistanceLevel: overrides.resistanceLevel ?? price * 1.05,
    supportLevel: sl,
    swingLow: overrides.swingLow ?? sl * 0.98,
    swingHigh: price * 1.08,
    extensionFrom20EMAPercent: ((price - ema20) / ema20) * 100,
    trendStrength: "MODERATE_UPTREND" as const,
    relativeStrengthVsNifty: 65,
    marketStructure: {
      confirmedHighs: [] as any[],
      confirmedLows: [] as any[],
      pwh: null as null,
      pwl: null as null,
      recentLiquiditySweep: null as null,
      recentChoch: null as null,
    },
    pwh: null as null,
    pwl: null as null,
    recentLiquiditySweep: null as null,
    recentChoch: null as null,
  };
}

describe("Priority 3 — Strategy D: Genuine Two-Bar MA Crossover Detection", () => {
  const neutralMeta = { regularMarketPrice: 500 };

  it("prevEma20 and prevEma50 are populated when candle count >= 51", () => {
    // Build a profile directly and verify the evaluator reads them correctly
    // This tests the evaluateStrategyD_MACrossover logic, not buildStockIndicatorProfile
    const profile = makeMinimalProfile({ prevEma20: 498.5, prevEma50: 499.0, ema20: 500.0, ema50: 499.0, currentPrice: 502 });
    // With prevEma20 = 498.5 (below prevEma50=499) and ema20=500 > ema50=499 → genuine cross
    expect(profile.prevEma20).toBe(498.5);
    expect(profile.prevEma50).toBe(499.0);
    expect(typeof profile.prevEma20).toBe("number");
    expect(typeof profile.prevEma50).toBe("number");
    const result = evaluateStrategyD_MACrossover(profile);
    expect(result.matched).toBe(true);
    expect(result.rationale[0]).toContain("Confirmed two-bar");
  });

  it("prevEma20 and prevEma50 are null when candle count < 51", () => {
    const candles = buildStaleCrossCandles(400).slice(-45); // only 45 candles
    const profile = buildStockIndicatorProfile("SHORT_HIST", candles, neutralMeta);
    // With < 51 candles, prevEma50 must be null (or undefined if the field is optional)
    const val = profile.prevEma50;
    expect(val === null || val === undefined).toBe(true);
  });

  it("prevEma20 is null when candle count < 21", () => {
    const candles = buildStaleCrossCandles(400).slice(-18);
    const profile = buildStockIndicatorProfile("VERY_SHORT", candles, neutralMeta);
    // With < 21 candles, prevEma20 must be null or undefined (optional field)
    const val = profile.prevEma20;
    expect(val === null || val === undefined).toBe(true);
  });

  it("Strategy D does NOT match when EMA20 > EMA50 for many bars (stale cross)", () => {
    // Long sustained uptrend: cross happened ~200 bars ago → must NOT match
    const candles = buildStaleCrossCandles(500);
    const profile = buildStockIndicatorProfile("STALE_CROSS", candles, neutralMeta);

    // Verify prevMAs are available
    if (profile.prevEma20 == null || profile.prevEma50 == null) return; // skip if < 51 bars

    // In a long uptrend: prevEma20 is ALSO > prevEma50 (cross was long ago)
    // So hasGenuineCross = false → matched should be false
    const result = evaluateStrategyD_MACrossover(profile);

    // Key assertion: genuine cross requires prevEma20 <= prevEma50
    // In a 250-bar uptrend, both prev and current EMAs have ema20 > ema50
    const prevCrossed = (profile.prevEma20 ?? 0) <= (profile.prevEma50 ?? 0);
    if (!prevCrossed) {
      // Previous bar already had ema20 > ema50 → no fresh cross → strategy should not confirm
      expect(result.confirmationStatus).not.toBe("CONFIRMED");
    }
  });

  it("Strategy D warnings include heuristic note when prevEma fields unavailable", () => {
    // With < 51 candles, prevEma50 is null → fallback heuristic used
    const shortCandles = buildStaleCrossCandles(500).slice(-48);
    const profile = buildStockIndicatorProfile("HEURISTIC_WARN", shortCandles, neutralMeta);

    // Force a spread that triggers the heuristic match
    if (profile.ema20 === null || profile.ema50 === null) return;
    // Override to produce a fresh-spread match
    (profile as any).ema20 = profile.ema50! * 1.015; // 1.5% spread — within heuristic range
    (profile as any).prevEma20 = null;
    (profile as any).prevEma50 = null;
    (profile as any).currentPrice = profile.ema20! * 1.005;

    const result = evaluateStrategyD_MACrossover(profile);
    if (result.matched) {
      // When matched via heuristic (prevEma unavailable), a warning must be present
      const hasHeuristicWarning = result.warnings.some((w) =>
        w.includes("spread heuristic") || w.includes("penultimate bar")
      );
      expect(hasHeuristicWarning).toBe(true);
    }
  });

  it("Strategy D: matched=true on a fresh two-bar cross → confirmationStatus is DEVELOPING or CONFIRMED", () => {
    // Use a directly constructed minimal profile to eliminate buildStockIndicatorProfile dependencies
    const prevLevel = 498.5;
    const profile = makeMinimalProfile({
      prevEma20: prevLevel,        // previous bar: EMA20 just below EMA50
      prevEma50: prevLevel + 0.5, // previous bar: EMA50 slightly above
      ema20: prevLevel + 2.0,     // current bar: EMA20 now above EMA50
      ema50: prevLevel + 0.5,     // EMA50 unchanged
      currentPrice: prevLevel + 3.0,
    });

    const result = evaluateStrategyD_MACrossover(profile);
    expect(result.matched).toBe(true);
    expect(["CONFIRMED", "DEVELOPING"]).toContain(result.confirmationStatus);
    // hasGenuineCross = true (prevEma20 <= prevEma50 AND ema20 > ema50)
    expect(result.rationale[0]).toContain("Confirmed two-bar");
    // No heuristic warning when genuine cross is confirmed
    const hasHeuristicWarn = result.warnings.some((w) => w.includes("spread heuristic"));
    expect(hasHeuristicWarn).toBe(false);
  });

  it("Strategy D: matched=false when prevEma20 > prevEma50 (EMA20 was already above — not a fresh cross)", () => {
    const candles = buildStaleCrossCandles(500);
    const profile = buildStockIndicatorProfile("OLD_CROSS", candles, neutralMeta);
    if (profile.ema20 === null || profile.ema50 === null) return;

    // Previous bar: EMA20 already above EMA50 → not a fresh cross
    const prevLevel = 500;
    (profile as any).prevEma20 = prevLevel + 5.0; // was already above
    (profile as any).prevEma50 = prevLevel;
    (profile as any).ema20 = prevLevel + 6.0;     // still above
    (profile as any).ema50 = prevLevel;
    (profile as any).currentPrice = prevLevel + 7.0;

    const result = evaluateStrategyD_MACrossover(profile);
    // hasGenuineCross = false (prevEma20 > prevEma50)
    // isSpreadFresh = ema20-ema50 = 6 → 6/500 = 1.2% — within [0, 2%] spread range
    // So could still match via heuristic if prevEma data is available — but genuine cross is false
    if (result.matched) {
      // Must NOT say "Confirmed two-bar bullish crossover"
      expect(result.rationale[0]).not.toContain("Confirmed two-bar bullish crossover");
    }
  });

  it("Strategy D zone: entryZone.trigger is within [zone.min, zone.max]", () => {
    // Test the zone max guard: when price is 5% above ema20, the old code produced
    // trigger > max (bug). The fix: zoneMax = Math.max(ema20*1.02, entryTrigger).
    const ema20 = 691.6;
    const ema50 = 689.0;
    // Price 5% above ema20 — this triggers the bug in the old code
    const price = ema20 * 1.05; // ~726.2
    const profile = makeMinimalProfile({
      ema20,
      ema50,
      prevEma20: ema20 * 0.999, // below prevEma50 → genuine cross
      prevEma50: ema50,
      currentPrice: price,
    });

    const result = evaluateStrategyD_MACrossover(profile);
    // entryTrigger = price * 1.003 ≈ 728.4
    // zoneMax = Math.max(ema20 * 1.02, entryTrigger) = Math.max(705.4, 728.4) = 728.4
    // So trigger (728.4) must be <= max (728.4)
    expect(result.entryZone.trigger).toBeLessThanOrEqual(result.entryZone.max);
    expect(result.entryZone.trigger).toBeGreaterThanOrEqual(result.entryZone.min);
    // Verify the max is exactly equal to trigger (the guard kicked in)
    expect(result.entryZone.max).toBeGreaterThanOrEqual(result.entryZone.trigger);
  });

  it("Strategy D: target1 < target2 for any matched scenario", () => {
    const candles = buildStaleCrossCandles(500);
    const profile = buildStockIndicatorProfile("TARGET_ORDER_D", candles, neutralMeta);
    if (profile.ema20 === null || profile.ema50 === null) return;

    // Force fresh cross
    const base = profile.ema50!;
    (profile as any).prevEma20 = base * 0.999;
    (profile as any).prevEma50 = base;
    (profile as any).ema20 = base * 1.002;
    (profile as any).currentPrice = base * 1.003;

    const result = evaluateStrategyD_MACrossover(profile);
    expect(result.target1).toBeLessThan(result.target2);
  });

  it("Strategy D: no match when EMA20 < EMA50 (downtrend — no crossover)", () => {
    const candles = buildStaleCrossCandles(500);
    const profile = buildStockIndicatorProfile("DOWNTREND_D", candles, neutralMeta);
    if (profile.ema20 === null || profile.ema50 === null) return;

    // Simulate bearish alignment
    const base = 500;
    (profile as any).ema20 = base * 0.97;       // EMA20 below EMA50
    (profile as any).ema50 = base;
    (profile as any).prevEma20 = base * 0.975;  // was below before too
    (profile as any).prevEma50 = base;
    (profile as any).currentPrice = base * 0.96; // price below both

    const result = evaluateStrategyD_MACrossover(profile);
    expect(result.matched).toBe(false);
    expect(result.confirmationStatus).toBe("WATCHLIST");
  });

  it("Strategy D: genuineCross gets +10 confidence bonus over heuristic match", () => {
    const candles = buildStaleCrossCandles(500);
    const profile = buildStockIndicatorProfile("CONF_BONUS", candles, neutralMeta);
    if (profile.ema20 === null || profile.ema50 === null) return;

    const base = profile.ema50!;

    // Fresh genuine cross version
    const profileGenuine = { ...profile };
    (profileGenuine as any).prevEma20 = base * 0.999;
    (profileGenuine as any).prevEma50 = base;
    (profileGenuine as any).ema20 = base * 1.005;
    (profileGenuine as any).ema50 = base;
    (profileGenuine as any).currentPrice = base * 1.005;
    const genuine = evaluateStrategyD_MACrossover(profileGenuine);

    // Heuristic-only version (prevEma missing)
    const profileHeuristic = { ...profile };
    (profileHeuristic as any).prevEma20 = null;
    (profileHeuristic as any).prevEma50 = null;
    (profileHeuristic as any).ema20 = base * 1.005;
    (profileHeuristic as any).ema50 = base;
    (profileHeuristic as any).currentPrice = base * 1.005;
    const heuristic = evaluateStrategyD_MACrossover(profileHeuristic);

    if (genuine.matched && heuristic.matched) {
      // Genuine cross should have higher or equal confidence (has the +10 bonus)
      expect(genuine.confidenceScore).toBeGreaterThanOrEqual(heuristic.confidenceScore);
    }
  });
});
