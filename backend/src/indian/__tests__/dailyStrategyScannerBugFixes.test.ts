/**
 * Regression tests for the four confirmed entry-zone / trigger calculation
 * bugs fixed in lib/indian/dailyStrategyScanner.ts:
 *
 *  BUG 1 — Strategy B: trigger (dayHigh * 1.002) could fall below zone min
 *           (ema20) when dayHigh < ema20. Fixed to Math.max(dayHigh, ema20) * 1.002.
 *
 *  BUG 2 — Strategy G: zone max was currentPrice while trigger is
 *           currentPrice * 1.003, so trigger > max always. Fixed to
 *           entryTrigger * 1.003.
 *
 *  BUG 3 — Strategy H: same pattern as G. Fixed to entryTrigger * 1.003.
 *
 *  BUG 4 — Strategy C: zone max was supportLevel * 1.02 while trigger is
 *           currentPrice * 1.004; trigger exceeded max when
 *           currentPrice > supportLevel * ~1.016. Fixed to
 *           Math.max(supportLevel * 1.02, entryTrigger).
 *
 * Guard rails checked in every test:
 *   1. entryZone.min  ≤ entryZone.trigger
 *   2. entryZone.trigger ≤ entryZone.max
 *   3. stopLoss < entryZone.trigger (bullish: stop is below entry)
 *   4. target1 > entryZone.trigger (bullish: first target is above entry)
 *   5. target1 < target2  (targets are ordered)
 *   6. rewardRiskRatio ≥ 1.8 (minimum meaningful R:R)
 *   7. Rounding to 1 d.p. (trigger / zone bounds must be Number with ≤ 1 dp)
 *
 * LIVE_TRADING and BROKER_EXECUTION_ENABLED remain false — no order flow.
 */

import { describe, it, expect } from "vitest";
import {
  evaluateStrategyB_Pullback,
  evaluateStrategyC_SupportBounce,
  evaluateStrategyG_TrendContinuation,
  evaluateStrategyH_VolumeBreakout,
  StockIndicatorProfile,
  DailyCandle,
  buildStockIndicatorProfile,
} from "../../../../lib/indian/dailyStrategyScanner";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Assert the fundamental zone invariant: min ≤ trigger ≤ max */
function assertZoneInvariant(result: ReturnType<typeof evaluateStrategyB_Pullback>, label: string) {
  const { min, max, trigger } = result.entryZone;
  expect(trigger, `${label}: trigger (${trigger}) must be ≥ zone min (${min})`).toBeGreaterThanOrEqual(min);
  expect(trigger, `${label}: trigger (${trigger}) must be ≤ zone max (${max})`).toBeLessThanOrEqual(max);
}

/** Assert the directional / risk–reward invariants common to all bullish setups */
function assertBullishRR(result: ReturnType<typeof evaluateStrategyB_Pullback>, label: string) {
  const { trigger } = result.entryZone;
  expect(result.stopLoss, `${label}: stopLoss must be below trigger`).toBeLessThan(trigger);
  expect(result.target1, `${label}: target1 must be above trigger`).toBeGreaterThan(trigger);
  expect(result.target2, `${label}: target2 must be above target1`).toBeGreaterThan(result.target1);
  expect(result.rewardRiskRatio, `${label}: R:R must be ≥ 1.8`).toBeGreaterThanOrEqual(1.8);
  expect(result.riskPerShare, `${label}: riskPerShare must be positive`).toBeGreaterThan(0);
}

/** Assert trigger value is rounded to at most 1 decimal place */
function assertRounded(value: number, label: string) {
  const rounded = Number(value.toFixed(1));
  expect(value, `${label}: value ${value} must be rounded to 1 d.p. (expected ${rounded})`).toBeCloseTo(rounded, 5);
}

/** Minimal valid StockIndicatorProfile factory — supply only the fields each
 *  test needs to override; sensible defaults prevent strategy short-circuits. */
function makeProfile(overrides: Partial<StockIndicatorProfile>): StockIndicatorProfile {
  const base: StockIndicatorProfile = {
    symbol: "TEST.NS",
    cleanSymbol: "TEST",
    companyName: "Test Ltd",
    sector: "Testing",
    marketCapCr: null,
    currentPrice: 1000,
    prevClose: 980,
    change: 20,
    changePercent: 2.04,
    dayHigh: 1010,
    dayLow: 970,
    high52: 1100,
    low52: 800,
    volume: 1_000_000,
    avgVolume20D: 600_000,
    volumeMultiplier: 1.67,
    ema20: 990,
    ema50: 950,
    ema200: 900,
    rsi14: 58,
    macd: { macdLine: 5, signalLine: 3, histogram: 2, isBullishCross: false },
    atr14: 15,
    resistanceLevel: 1050,
    supportLevel: 920,
    swingLow: 940,
    swingHigh: 1060,
    extensionFrom20EMAPercent: 1.0,
    trendStrength: "STRONG_UPTREND",
    relativeStrengthVsNifty: 72,
  };
  return { ...base, ...overrides };
}

// ---------------------------------------------------------------------------
// BUG 1 — Strategy B: AARTIPHARM scenario (dayHigh < ema20)
// ---------------------------------------------------------------------------

describe("BUG 1 — Strategy B: trigger never below zone min when dayHigh < ema20", () => {
  /**
   * AARTIPHARM failure: dayHigh was below ema20.
   * Old code: trigger = dayHigh * 1.002 < ema20 = zone.min  → INVARIANT BROKEN.
   * Fix: trigger = Math.max(dayHigh, ema20) * 1.002 ≥ ema20 → invariant holds.
   */
  it("trigger ≥ zone.min when dayHigh < ema20 (AARTIPHARM reproduction)", () => {
    const profile = makeProfile({
      currentPrice: 980,
      dayHigh: 985,     // strictly below ema20
      dayLow: 965,
      ema20: 1000,      // dayHigh (985) < ema20 (1000)
      ema50: 960,
      ema200: 920,
    });

    const result = evaluateStrategyB_Pullback(profile);
    assertZoneInvariant(result, "StratB AARTIPHARM");
  });

  it("trigger is computed from ema20 (not dayHigh) when dayHigh < ema20", () => {
    const profile = makeProfile({
      currentPrice: 996,
      dayHigh: 998,     // < ema20 = 1005
      dayLow: 985,
      ema20: 1005,
      ema50: 970,
      ema200: 930,
    });

    const result = evaluateStrategyB_Pullback(profile);
    // trigger must be derived from ema20 branch (max(998, 1005) = 1005)
    const expectedTrigger = Number((1005 * 1.002).toFixed(1)); // 1007.0
    expect(result.entryZone.trigger).toBe(expectedTrigger);
    assertZoneInvariant(result, "StratB trigger derived from ema20");
    assertBullishRR(result, "StratB AARTIPHARM RR");
  });

  it("trigger equals dayHigh * 1.002 when dayHigh ≥ ema20 (normal path unchanged)", () => {
    const profile = makeProfile({
      currentPrice: 1005,
      dayHigh: 1010,   // > ema20 = 990
      dayLow: 985,
      ema20: 990,
      ema50: 960,
      ema200: 920,
    });

    const result = evaluateStrategyB_Pullback(profile);
    const expectedTrigger = Number((1010 * 1.002).toFixed(1));
    expect(result.entryZone.trigger).toBe(expectedTrigger);
    assertZoneInvariant(result, "StratB normal path");
    assertBullishRR(result, "StratB normal RR");
  });

  it("trigger equals ema20 * 1.002 exactly at dayHigh == ema20 boundary", () => {
    const ema20 = 1000;
    const profile = makeProfile({
      currentPrice: 1002,
      dayHigh: ema20,  // exactly equal
      dayLow: 985,
      ema20,
      ema50: 960,
      ema200: 910,
    });

    const result = evaluateStrategyB_Pullback(profile);
    const expectedTrigger = Number((ema20 * 1.002).toFixed(1));
    expect(result.entryZone.trigger).toBe(expectedTrigger);
    assertZoneInvariant(result, "StratB boundary equality");
  });

  it("trigger rounds to exactly 1 decimal place", () => {
    const profile = makeProfile({
      currentPrice: 997,
      dayHigh: 993,    // < ema20
      dayLow: 981,
      ema20: 1001,
      ema50: 965,
      ema200: 920,
    });

    const result = evaluateStrategyB_Pullback(profile);
    assertRounded(result.entryZone.trigger, "StratB trigger rounding");
    assertRounded(result.entryZone.min, "StratB zone.min rounding");
    assertRounded(result.entryZone.max, "StratB zone.max rounding");
  });

  it("stopLoss is always below trigger (stop-loss direction unchanged)", () => {
    // Exhaustive across dayHigh < ema20 range
    for (const [dayHigh, ema20] of [[900, 1000], [800, 950], [1200, 1300]] as [number, number][]) {
      const profile = makeProfile({
        currentPrice: ema20 * 1.005,
        dayHigh,
        dayLow: dayHigh * 0.98,
        ema20,
        ema50: ema20 * 0.95,
        ema200: ema20 * 0.90,
      });
      const result = evaluateStrategyB_Pullback(profile);
      expect(result.stopLoss).toBeLessThan(result.entryZone.trigger);
    }
  });
});

// ---------------------------------------------------------------------------
// BUG 2 — Strategy G: trigger > zone max (currentPrice)
// ---------------------------------------------------------------------------

describe("BUG 2 — Strategy G: zone max is at least the trigger", () => {
  /**
   * Old code: max = p.currentPrice, trigger = p.currentPrice * 1.003
   * → trigger always > max. Fixed to max = entryTrigger * 1.003.
   */
  it("zone max ≥ trigger on a valid matched signal", () => {
    const profile = makeProfile({
      currentPrice: 4420,
      ema20: 4300,
      ema50: 4150,
      ema200: 3800,
      swingLow: 4000,  // > supportLevel * 1.01
      supportLevel: 3900,
      rsi14: 62,
    });

    const result = evaluateStrategyG_TrendContinuation(profile);
    assertZoneInvariant(result, "StratG valid signal");
  });

  it("zone max ≥ trigger on an unmatched (WATCHLIST) profile", () => {
    const profile = makeProfile({
      currentPrice: 500,
      ema20: 490,
      ema50: 480,
      ema200: 510,  // EMA alignment broken → not matched
      swingLow: 462,
      supportLevel: 450,
      rsi14: 61,
    });

    const result = evaluateStrategyG_TrendContinuation(profile);
    assertZoneInvariant(result, "StratG unmatched");
  });

  it("zone max is entryTrigger * 1.003 (explicit formula check)", () => {
    const cp = 4420;
    const profile = makeProfile({
      currentPrice: cp,
      ema20: 4300,
      ema50: 4150,
      ema200: 3800,
      swingLow: 4000,
      supportLevel: 3900,
      rsi14: 62,
    });

    const result = evaluateStrategyG_TrendContinuation(profile);
    const expectedTrigger = Number((cp * 1.003).toFixed(1));
    const expectedMax    = Number((expectedTrigger * 1.003).toFixed(1));
    expect(result.entryZone.trigger).toBe(expectedTrigger);
    expect(result.entryZone.max).toBe(expectedMax);
  });

  it("stopLoss is below trigger and targets are correctly ordered", () => {
    const profile = makeProfile({
      currentPrice: 4420,
      ema20: 4300,
      ema50: 4150,
      ema200: 3800,
      swingLow: 4000,
      supportLevel: 3900,
      rsi14: 63,
    });

    const result = evaluateStrategyG_TrendContinuation(profile);
    assertBullishRR(result, "StratG");
    assertRounded(result.entryZone.trigger, "StratG trigger");
    assertRounded(result.entryZone.max, "StratG zone.max");
  });

  it("zone invariant holds for a wide range of current prices", () => {
    for (const cp of [100, 500, 1000, 5000, 25000]) {
      const profile = makeProfile({
        currentPrice: cp,
        ema20: cp * 0.97,
        ema50: cp * 0.93,
        ema200: cp * 0.86,
        swingLow: cp * 0.90,
        supportLevel: cp * 0.87,
        rsi14: 60,
      });
      const result = evaluateStrategyG_TrendContinuation(profile);
      assertZoneInvariant(result, `StratG cp=${cp}`);
    }
  });
});

// ---------------------------------------------------------------------------
// BUG 3 — Strategy H: trigger > zone max (currentPrice)
// ---------------------------------------------------------------------------

describe("BUG 3 — Strategy H: zone max is at least the trigger", () => {
  /**
   * Old code: max = p.currentPrice, trigger = p.currentPrice * 1.002
   * → trigger always > max. Fixed to max = entryTrigger * 1.003.
   */
  it("zone max ≥ trigger on a valid matched signal", () => {
    const profile = makeProfile({
      currentPrice: 3310,
      dayHigh: 3320,
      dayLow: 3200,
      volumeMultiplier: 2.8,
      changePercent: 3.5,
    });

    const result = evaluateStrategyH_VolumeBreakout(profile);
    assertZoneInvariant(result, "StratH valid signal");
  });

  it("zone max ≥ trigger on an unmatched (WATCHLIST) profile", () => {
    const profile = makeProfile({
      currentPrice: 200,
      dayHigh: 205,
      dayLow: 195,
      volumeMultiplier: 1.0, // below threshold → not matched
      changePercent: 0.2,
    });

    const result = evaluateStrategyH_VolumeBreakout(profile);
    assertZoneInvariant(result, "StratH unmatched");
  });

  it("zone max is entryTrigger * 1.003 (explicit formula check)", () => {
    const cp = 3310;
    const profile = makeProfile({
      currentPrice: cp,
      dayHigh: 3320,
      dayLow: 3200,
      volumeMultiplier: 2.8,
      changePercent: 3.5,
    });

    const result = evaluateStrategyH_VolumeBreakout(profile);
    const expectedTrigger = Number((cp * 1.002).toFixed(1));
    const expectedMax    = Number((expectedTrigger * 1.003).toFixed(1));
    expect(result.entryZone.trigger).toBe(expectedTrigger);
    expect(result.entryZone.max).toBe(expectedMax);
  });

  it("stopLoss is below trigger and targets are correctly ordered", () => {
    const profile = makeProfile({
      currentPrice: 3310,
      dayHigh: 3320,
      dayLow: 3200,
      volumeMultiplier: 2.8,
      changePercent: 3.5,
    });

    const result = evaluateStrategyH_VolumeBreakout(profile);
    assertBullishRR(result, "StratH");
    assertRounded(result.entryZone.trigger, "StratH trigger");
    assertRounded(result.entryZone.max, "StratH zone.max");
  });

  it("confidenceScore ≥ 80 with high-volume matched signal (existing threshold)", () => {
    const profile = makeProfile({
      currentPrice: 3310,
      dayHigh: 3320,
      dayLow: 3200,
      volumeMultiplier: 2.8,
      changePercent: 3.5,
    });

    const result = evaluateStrategyH_VolumeBreakout(profile);
    expect(result.matched).toBe(true);
    expect(result.confidenceScore).toBeGreaterThanOrEqual(80);
  });

  it("zone invariant holds for a wide range of current prices", () => {
    for (const cp of [50, 300, 1500, 8000, 30000]) {
      const profile = makeProfile({
        currentPrice: cp,
        dayHigh: cp * 1.005,
        dayLow: cp * 0.97,
        volumeMultiplier: 2.2,
        changePercent: 2.0,
      });
      const result = evaluateStrategyH_VolumeBreakout(profile);
      assertZoneInvariant(result, `StratH cp=${cp}`);
    }
  });
});

// ---------------------------------------------------------------------------
// BUG 4 — Strategy C: trigger above zone max when currentPrice > supportLevel * 1.016
// ---------------------------------------------------------------------------

describe("BUG 4 — Strategy C: zone max covers trigger when currentPrice > supportLevel * 1.016", () => {
  /**
   * Old code: max = supportLevel * 1.02, trigger = currentPrice * 1.004.
   * When currentPrice > supportLevel * ~1.016, trigger > max.
   * Fix: max = Math.max(supportLevel * 1.02, entryTrigger).
   */
  it("zone max ≥ trigger when currentPrice exactly equals supportLevel * 1.016", () => {
    const supportLevel = 1000;
    const currentPrice = Number((supportLevel * 1.016).toFixed(2));
    const profile = makeProfile({
      currentPrice,
      dayHigh: currentPrice * 1.005,
      dayLow: supportLevel,
      supportLevel,
      resistanceLevel: currentPrice * 1.04,
    });

    const result = evaluateStrategyC_SupportBounce(profile);
    assertZoneInvariant(result, "StratC boundary=1.016*support");
  });

  it("zone max ≥ trigger when currentPrice = supportLevel * 1.02 (moderate overshoot)", () => {
    const supportLevel = 2000;
    const currentPrice = Number((supportLevel * 1.02).toFixed(2)); // exactly at old max
    const profile = makeProfile({
      currentPrice,
      dayHigh: currentPrice * 1.003,
      dayLow: supportLevel * 0.99,
      supportLevel,
      resistanceLevel: currentPrice * 1.05,
    });

    const result = evaluateStrategyC_SupportBounce(profile);
    assertZoneInvariant(result, "StratC currentPrice=support*1.02");
  });

  it("zone max ≥ trigger when currentPrice = supportLevel * 1.035 (well above old max)", () => {
    const supportLevel = 500;
    const currentPrice = Number((supportLevel * 1.035).toFixed(2));
    const profile = makeProfile({
      currentPrice,
      dayHigh: currentPrice * 1.003,
      dayLow: supportLevel * 0.995,
      supportLevel,
      resistanceLevel: currentPrice * 1.06,
    });

    const result = evaluateStrategyC_SupportBounce(profile);
    assertZoneInvariant(result, "StratC currentPrice=support*1.035");
  });

  it("zone max stays as supportLevel * 1.02 when currentPrice ≤ support * 1.012 (no-change path)", () => {
    // entryTrigger = currentPrice * 1.004.
    // For max to remain supportLevel * 1.02, we need:
    //   currentPrice * 1.004 ≤ supportLevel * 1.02
    //   → currentPrice ≤ supportLevel * (1.02 / 1.004) ≈ supportLevel * 1.01594
    // Use currentPrice = supportLevel * 1.010 (safely below the crossover).
    const supportLevel = 800;
    const currentPrice = Number((supportLevel * 1.010).toFixed(2));
    const profile = makeProfile({
      currentPrice,
      dayHigh: currentPrice * 1.003,
      dayLow: supportLevel * 0.997,
      supportLevel,
      resistanceLevel: currentPrice * 1.06,
    });

    const result = evaluateStrategyC_SupportBounce(profile);
    const expectedMax = Number((supportLevel * 1.02).toFixed(1));
    expect(result.entryZone.max).toBe(expectedMax);
    assertZoneInvariant(result, "StratC no-change path");
  });

  it("stopLoss is strictly below supportLevel (direction unchanged)", () => {
    const supportLevel = 1200;
    const currentPrice = Number((supportLevel * 1.025).toFixed(2));
    const profile = makeProfile({
      currentPrice,
      dayHigh: currentPrice * 1.003,
      dayLow: supportLevel,
      supportLevel,
      resistanceLevel: currentPrice * 1.06,
    });

    const result = evaluateStrategyC_SupportBounce(profile);
    expect(result.stopLoss).toBeLessThan(supportLevel);
    assertBullishRR(result, "StratC stopLoss below support");
  });

  it("target1 < target2 for all tested inputs (target ordering unchanged)", () => {
    for (const mult of [1.005, 1.016, 1.025, 1.035]) {
      const supportLevel = 1000;
      const currentPrice = Number((supportLevel * mult).toFixed(2));
      const profile = makeProfile({
        currentPrice,
        dayHigh: currentPrice * 1.003,
        dayLow: supportLevel * 0.997,
        supportLevel,
        resistanceLevel: currentPrice * 1.06,
      });
      const result = evaluateStrategyC_SupportBounce(profile);
      expect(result.target1, `target1 < target2 at mult=${mult}`).toBeLessThan(result.target2);
    }
  });

  it("trigger rounds to exactly 1 decimal place", () => {
    const profile = makeProfile({
      currentPrice: 1234.56,
      dayHigh: 1237,
      dayLow: 1200,
      supportLevel: 1210,
      resistanceLevel: 1300,
    });

    const result = evaluateStrategyC_SupportBounce(profile);
    assertRounded(result.entryZone.trigger, "StratC trigger rounding");
    assertRounded(result.entryZone.max, "StratC zone.max rounding");
  });
});

// ---------------------------------------------------------------------------
// Cross-strategy: all four affected strategies satisfy the invariant together
// ---------------------------------------------------------------------------

describe("Cross-strategy: zone invariant for all four fixed strategies simultaneously", () => {
  /**
   * Use a single profile where all four strategies can be evaluated.
   * We do not require all to be matched — just that the invariant holds.
   */
  function assertAllFourInvariant(profile: StockIndicatorProfile) {
    const resB = evaluateStrategyB_Pullback(profile);
    const resC = evaluateStrategyC_SupportBounce(profile);
    const resG = evaluateStrategyG_TrendContinuation(profile);
    const resH = evaluateStrategyH_VolumeBreakout(profile);

    assertZoneInvariant(resB, "CrossStrat StratB");
    assertZoneInvariant(resC, "CrossStrat StratC");
    assertZoneInvariant(resG, "CrossStrat StratG");
    assertZoneInvariant(resH, "CrossStrat StratH");
  }

  it("zone invariant holds for a strong-uptrend profile", () => {
    assertAllFourInvariant(makeProfile({
      currentPrice: 2000,
      dayHigh: 2010,
      dayLow: 1970,
      ema20: 1950,
      ema50: 1880,
      ema200: 1750,
      swingLow: 1900,
      supportLevel: 1860,
      resistanceLevel: 2050,
      rsi14: 63,
      volumeMultiplier: 2.3,
      changePercent: 2.1,
    }));
  });

  it("zone invariant holds when dayHigh < ema20 (AARTIPHARM-like profile)", () => {
    assertAllFourInvariant(makeProfile({
      currentPrice: 980,
      dayHigh: 985,
      dayLow: 960,
      ema20: 1005,  // dayHigh (985) < ema20 (1005)
      ema50: 970,
      ema200: 920,
      swingLow: 950,
      supportLevel: 940,
      resistanceLevel: 1050,
      rsi14: 58,
      volumeMultiplier: 2.5,
      changePercent: 2.0,
    }));
  });

  it("zone invariant holds for a very low-price stock (₹10)", () => {
    assertAllFourInvariant(makeProfile({
      currentPrice: 10,
      dayHigh: 10.2,
      dayLow: 9.7,
      ema20: 9.9,
      ema50: 9.5,
      ema200: 9.0,
      swingLow: 9.3,
      supportLevel: 9.1,
      resistanceLevel: 10.8,
      rsi14: 60,
      volumeMultiplier: 2.0,
      changePercent: 2.5,
    }));
  });

  it("zone invariant holds for a high-price stock (₹50,000)", () => {
    assertAllFourInvariant(makeProfile({
      currentPrice: 50000,
      dayHigh: 50200,
      dayLow: 49500,
      ema20: 49800,
      ema50: 48000,
      ema200: 45000,
      swingLow: 47500,
      supportLevel: 46000,
      resistanceLevel: 52000,
      rsi14: 62,
      volumeMultiplier: 2.1,
      changePercent: 2.2,
    }));
  });

  it("all strategies produce positive riskPerShare", () => {
    const profile = makeProfile({
      currentPrice: 1000,
      dayHigh: 1010,
      dayLow: 975,
      ema20: 990,
      ema50: 960,
      ema200: 920,
      swingLow: 955,
      supportLevel: 940,
      resistanceLevel: 1050,
      rsi14: 60,
      volumeMultiplier: 2.0,
      changePercent: 2.0,
    });

    for (const fn of [
      evaluateStrategyB_Pullback,
      evaluateStrategyC_SupportBounce,
      evaluateStrategyG_TrendContinuation,
      evaluateStrategyH_VolumeBreakout,
    ]) {
      const result = fn(profile);
      expect(result.riskPerShare, `riskPerShare must be > 0 in ${result.strategyId}`).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// buildStockIndicatorProfile smoke-test: zone invariant via full profile build
// ---------------------------------------------------------------------------

describe("Zone invariant via buildStockIndicatorProfile (integration smoke test)", () => {
  function generateCandles(count: number, startPrice: number): DailyCandle[] {
    const candles: DailyCandle[] = [];
    let cur = startPrice;
    const base = new Date("2026-01-01");
    for (let i = 0; i < count; i++) {
      const d = new Date(base);
      d.setDate(base.getDate() + i);
      const close = Math.max(1, cur + 1.2 + Math.sin(i / 3) * 4);
      const high = close + 3;
      const low = Math.max(1, close - 3);
      candles.push({
        date: d.toISOString().split("T")[0],
        open: Number(cur.toFixed(2)),
        high: Number(high.toFixed(2)),
        low: Number(low.toFixed(2)),
        close: Number(close.toFixed(2)),
        volume: 500_000 + Math.round(Math.sin(i / 2) * 100_000),
      });
      cur = close;
    }
    return candles;
  }

  it("Strategy B zone invariant holds after building a real indicator profile (dayHigh < ema20 forced)", () => {
    const candles = generateCandles(60, 1000);
    const meta = {
      regularMarketPrice: 1050,
      regularMarketDayHigh: 1020, // force dayHigh < ema20 artificially
      regularMarketDayLow: 1010,
    };
    const profile = buildStockIndicatorProfile("AARTIPHARM", candles, meta);

    // Force dayHigh < ema20 to repro the bug scenario
    const forcedProfile = { ...profile, dayHigh: profile.ema20 * 0.98 };

    const result = evaluateStrategyB_Pullback(forcedProfile);
    assertZoneInvariant(result, "Integration StratB dayHigh<ema20");
  });

  it("Strategy C zone invariant holds after buildStockIndicatorProfile (currentPrice high above support)", () => {
    const candles = generateCandles(60, 500);
    const meta = { regularMarketPrice: 540 };
    const profile = buildStockIndicatorProfile("CDSL", candles, meta);

    // Push currentPrice well above supportLevel (≥ 1.035 × support) to trigger old bug
    const forcedProfile = { ...profile, currentPrice: profile.supportLevel * 1.04 };

    const result = evaluateStrategyC_SupportBounce(forcedProfile);
    assertZoneInvariant(result, "Integration StratC high currentPrice");
  });
});
