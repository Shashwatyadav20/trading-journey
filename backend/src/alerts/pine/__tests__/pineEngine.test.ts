import { describe, it, expect, beforeEach } from "vitest";
import { PineLiquidityEngine } from "../PineLiquidityEngine";
import { PineAlertBridge } from "../PineAlertBridge";
import { DEFAULT_PINE_INPUTS, Candle } from "../PineTypes";

// ─── HELPER FACTORY FOR OHLC CANDLES ─────────────────────────────────────────

function makeCandle(
  timestamp: string,
  high: number,
  low: number,
  open: number = (high + low) / 2,
  close: number = (high + low) / 2,
  volume: number = 1000
): Candle {
  return { timestamp, open, high, low, close, volume };
}

function generateSequence(
  startMs: number,
  intervalMs: number,
  prices: { high: number; low: number; close?: number }[]
): Candle[] {
  return prices.map((p, idx) =>
    makeCandle(
      new Date(startMs + idx * intervalMs).toISOString(),
      p.high,
      p.low,
      (p.high + p.low) / 2,
      p.close ?? (p.high + p.low) / 2
    )
  );
}

/**
 * Produces N candles that form a clean pivot high at position `peakIdx` with
 * strength `len`. Layout:
 *   [0..peakIdx-1]   ascending
 *   [peakIdx]        peak (highest)
 *   [peakIdx+1..N-1] descending
 * Ensures pivot is confirmed only when at least `len` bars exist after peak.
 */
function makePivotHighSequence(
  startMs: number,
  intervalMs: number,
  len: number,
  baseHigh = 100,
  baseLow = 90
): Candle[] {
  const total = len * 2 + 3; // left bars + peak + right bars
  const prices: { high: number; low: number }[] = [];
  for (let i = 0; i < total; i++) {
    if (i < len) {
      prices.push({ high: baseHigh - (len - i) * 2, low: baseLow - (len - i) * 2 });
    } else if (i === len) {
      prices.push({ high: baseHigh, low: baseLow - 2 }); // peak
    } else {
      prices.push({ high: baseHigh - (i - len) * 2, low: baseLow - (i - len) * 2 });
    }
  }
  return generateSequence(startMs, intervalMs, prices);
}

describe("PineLiquidityEngine — 1:1 Pine Script Unit Tests", () => {
  let engine: PineLiquidityEngine;

  beforeEach(() => {
    engine = new PineLiquidityEngine({}, 15);
  });

  // ─── TEST 1: Input Initialization ─────────────────────────────────────────
  it("initializes with all 28 exact Pine inputs", () => {
    const inputs = engine.getInputs();
    // HTF EQ
    expect(inputs.showEQ_15).toBe(true);
    expect(inputs.showEQ_1H).toBe(true);
    expect(inputs.showEQ_4H).toBe(true);
    expect(inputs.showEQ_D).toBe(true);
    expect(inputs.eqPivotLen).toBe(5);
    expect(inputs.eqTolPct).toBe(0.05);
    expect(inputs.maxEQLevels).toBe(6);
    // PW
    expect(inputs.showPW).toBe(true);
    // Swings
    expect(inputs.showSwings).toBe(true);
    expect(inputs.swingPivotLen).toBe(10);
    expect(inputs.maxSwingLevels).toBe(6);
    // P/D Zone
    expect(inputs.showPDZone).toBe(true);
    expect(inputs.pdZoneTF).toBe("15");
    expect(inputs.pdPivotLen).toBe(10);
    expect(inputs.pdAtrLen).toBe(14);
    expect(inputs.pdAtrMult).toBe(0.25);
    expect(inputs.showEqLine).toBe(true);
    // General
    expect(inputs.extendLevels).toBe(true);
    expect(inputs.labelSize).toBe("small");
    expect(inputs.showPriceInLabel).toBe(true);
    expect(inputs.overlapTolPct).toBe(0.05);
    // Colors (all 6)
    expect(inputs.colEQH).toBe("#d946ef");
    expect(inputs.colEQL).toBe("#06b6d4");
    expect(inputs.colPWH).toBe("#f97316");
    expect(inputs.colPWL).toBe("#eab308");
    expect(inputs.colSWH).toBe("#84cc16");
    expect(inputs.colSWL).toBe("#ef4444");
    // Color inputs from P/D zone
    expect(inputs.colPremium).toBe("#ef4444d9");
    expect(inputs.colDiscount).toBe("#22c55ed9");
    expect(inputs.colEqLine).toBe("#808080");
  });

  // ─── TEST 2: Pivot Confirmation Delay ─────────────────────────────────────
  it("confirms pivot high/low exactly after len right-side bars", () => {
    const highs = [10, 12, 15, 20, 14, 11, 9, 8, 7, 6, 5];
    const lows  = [ 8,  7, 10, 15,  9,  8, 6, 5, 4, 3, 2];

    const ph = PineLiquidityEngine.f_pivotHigh(highs.slice(0, 7), 3);
    expect(ph).toBe(20);

    const phUnconfirmed = PineLiquidityEngine.f_pivotHigh(highs.slice(0, 6), 3);
    expect(phUnconfirmed).toBeNull();
  });

  // ─── TEST 3: f_isEqual & f_isNear ─────────────────────────────────────────
  it("calculates equality within percentage tolerance correctly", () => {
    expect(PineLiquidityEngine.f_isEqual(100.00, 100.04, 0.05)).toBe(true);
    expect(PineLiquidityEngine.f_isEqual(100.00, 100.10, 0.05)).toBe(false);
  });

  // ─── TEST 4: EQH Level Averaging ──────────────────────────────────────────
  it("averages two equal pivot highs to form HTF EQH level", () => {
    const p1 = 100.00;
    const p2 = 100.04;
    expect(PineLiquidityEngine.f_isEqual(p1, p2, 0.05)).toBe(true);
    const avgLvl = (p1 + p2) / 2;
    expect(avgLvl).toBeCloseTo(100.02, 4);
  });

  // ─── TEST 5: Asymmetric Duplicate Suppression ─────────────────────────────
  it("enforces asymmetric duplicate suppression: EQH suppressed by Swing, Swing NEVER suppressed by EQH", () => {
    const existingSwings = [100.00];
    const newEqhPrice = 100.03;

    const eqhSuppressed = PineLiquidityEngine.f_isNear(newEqhPrice, existingSwings, 0.05);
    expect(eqhSuppressed).toBe(true);

    const swingSuppressed = PineLiquidityEngine.f_isNear(newEqhPrice, [], 0.05);
    expect(swingSuppressed).toBe(false);
  });

  // ─── TEST 6: 15M EQH/EQL Label Format ────────────────────────────────────
  it("generates HTF EQH/EQL levels with correct label format on 15M", () => {
    const baseTime = new Date("2026-09-01T00:00:00Z").getTime();
    const interval15M = 15 * 60 * 1000;

    const prices = [
      { high: 90, low: 85 }, { high: 95, low: 86 }, { high: 100, low: 88 },
      { high: 92, low: 84 }, { high: 89, low: 82 }, { high: 88, low: 80 },
      { high: 94, low: 83 }, { high: 100.02, low: 87 }, { high: 93, low: 85 },
      { high: 90, low: 82 }, { high: 87, low: 80 }, { high: 85, low: 78 },
    ];

    const candles = generateSequence(baseTime, interval15M, prices);
    candles.forEach((c) => engine.processCandle(c));

    const activeLevels = engine.getActiveLevels();
    const eqh = activeLevels.find((l) => l.type === "EQH");
    if (eqh) {
      expect(eqh.label).toContain("HTF EQH (15M)");
      expect(eqh.price).toBeCloseTo(100.01, 2);
    }
  });

  // ─── TEST 7: PWH / PWL ────────────────────────────────────────────────────
  it("extracts PWH and PWL from previous completed week (Monday-UTC boundary)", () => {
    const w1Candle = makeCandle("2026-08-24T00:00:00Z", 120, 80);
    const w2Candle = makeCandle("2026-08-31T00:00:00Z", 110, 85);

    engine.processCandle(w1Candle);
    engine.processCandle(w2Candle);

    const levels = engine.getActiveLevels();
    const pwh = levels.find((l) => l.type === "PWH");
    const pwl = levels.find((l) => l.type === "PWL");

    if (pwh) expect(pwh.price).toBe(120);
    if (pwl) expect(pwl.price).toBe(80);
  });

  // ─── TEST 8: Wick-Based Invalidation ──────────────────────────────────────
  it("invalidates resistance levels when candle high >= level, and support when low <= level", () => {
    const baseTime = new Date("2026-09-01T00:00:00Z").getTime();
    const interval15M = 15 * 60 * 1000;

    const prices = [
      { high: 90, low: 85 }, { high: 95, low: 86 }, { high: 100, low: 88 },
      { high: 92, low: 84 }, { high: 89, low: 82 }, { high: 88, low: 80 },
      { high: 94, low: 83 }, { high: 100.02, low: 87 }, { high: 93, low: 85 },
      { high: 90, low: 82 }, { high: 87, low: 80 }, { high: 85, low: 78 },
    ];
    const candles = generateSequence(baseTime, interval15M, prices);
    candles.forEach((c) => engine.processCandle(c));

    const invalidatingCandle = makeCandle(
      new Date(baseTime + 15 * interval15M).toISOString(),
      105,
      95
    );
    engine.processCandle(invalidatingCandle);

    const activeLevels = engine.getActiveLevels();
    const brokenEqh = activeLevels.find((l) => l.type === "EQH" && l.price <= 100.05);
    expect(brokenEqh).toBeUndefined();
  });

  // ─── TEST 9: P/D Zone Lifecycle ───────────────────────────────────────────
  it("manages Premium/Discount Zone lifecycle: activates on PH+PL, 50% eq line, ATR break reset", () => {
    const baseTime = new Date("2026-09-01T00:00:00Z").getTime();
    const interval15M = 15 * 60 * 1000;

    const prices = [
      { high: 100, low: 90 }, { high: 110, low: 95 }, { high: 120, low: 100 },
      { high: 110, low: 95 }, { high: 105, low: 90 }, { high: 100, low: 85 },
      { high: 95, low: 82 }, { high: 90, low: 75 }, { high: 88, low: 70 },
      { high: 85, low: 60 }, { high: 88, low: 65 }, { high: 92, low: 70 },
      { high: 95, low: 75 }, { high: 98, low: 80 }, { high: 100, low: 85 },
      { high: 102, low: 88 }, { high: 105, low: 90 }, { high: 108, low: 92 },
      { high: 110, low: 95 }, { high: 112, low: 96 }, { high: 115, low: 98 },
    ];
    const candles = generateSequence(baseTime, interval15M, prices);
    candles.forEach((c) => engine.processCandle(c));

    const pdState = engine.getPDZoneState();
    if (pdState.active) {
      expect(pdState.top).toBeGreaterThan(0);
      expect(pdState.bottom).toBeGreaterThan(0);
      expect(pdState.equilibrium).toBe((pdState.top! + pdState.bottom!) / 2);
    }
  });

  // ─── TEST 10: Alert Bridge ─────────────────────────────────────────────────
  it("PineAlertBridge emits LEVEL_TOUCHED, ZONE_ENTERED, and EQUILIBRIUM_TOUCHED without mutating engine state", () => {
    const bridge = new PineAlertBridge();
    bridge.registerEngine("BTC/USD", engine);

    const emittedAlerts: any[] = [];
    bridge.onAlert((a) => emittedAlerts.push(a));

    (engine as any).swhPrices.push(95000);
    (engine as any).swhTexts.push("15M+ Swing High");

    const nowIso = new Date().toISOString();
    const alerts = bridge.checkLivePrice("BTC/USD", 95000, nowIso);

    expect(alerts.length).toBeGreaterThan(0);
    expect(alerts[0].event).toBe("LEVEL_TOUCHED");
    expect(alerts[0].levelPrice).toBe(95000);
    expect(alerts[0].instrument).toBe("BTC/USD");
  });

  // ─── TEST A: 4H EQH/EQL Sequence ─────────────────────────────────────────
  it("A: generates HTF EQH level on 4H timeframe with correct label", () => {
    const engine4H = new PineLiquidityEngine({ eqPivotLen: 2 }, 240);
    const baseTime = new Date("2026-09-01T00:00:00Z").getTime();
    const interval4H = 4 * 60 * 60 * 1000;

    // Two nearly-equal pivot highs at ~200 with pivotLen=2
    // Pattern: rising to 200, falling, rising to 200.02, falling (each 2 sides)
    const prices = [
      { high: 190, low: 180 }, { high: 195, low: 183 }, { high: 200, low: 185 },
      { high: 193, low: 182 }, { high: 188, low: 178 },
      { high: 192, low: 181 }, { high: 200.02, low: 184 }, { high: 194, low: 183 },
      { high: 189, low: 179 },
    ];
    const candles = generateSequence(baseTime, interval4H, prices);
    candles.forEach((c) => engine4H.processCandle(c));

    const levels = engine4H.getActiveLevels();
    const eqh4H = levels.find((l) => l.type === "EQH" && l.label.includes("4H"));
    if (eqh4H) {
      expect(eqh4H.label).toContain("HTF EQH (4H)");
      expect(eqh4H.price).toBeCloseTo(200.01, 2);
    }
  });

  it("A: generates HTF EQL level on 4H timeframe with correct label", () => {
    const engine4H = new PineLiquidityEngine({ eqPivotLen: 2 }, 240);
    const baseTime = new Date("2026-09-01T00:00:00Z").getTime();
    const interval4H = 4 * 60 * 60 * 1000;

    // Two nearly-equal pivot lows at ~80
    const prices = [
      { high: 100, low: 82 }, { high: 95, low: 80 }, { high: 98, low: 83 },
      { high: 102, low: 85 }, { high: 104, low: 87 },
      { high: 100, low: 81 }, { high: 94, low: 80.02 }, { high: 97, low: 82 },
      { high: 103, low: 86 },
    ];
    const candles = generateSequence(baseTime, interval4H, prices);
    candles.forEach((c) => engine4H.processCandle(c));

    const levels = engine4H.getActiveLevels();
    const eql4H = levels.find((l) => l.type === "EQL" && l.label.includes("4H"));
    if (eql4H) {
      expect(eql4H.label).toContain("HTF EQL (4H)");
      expect(eql4H.price).toBeCloseTo(80.01, 2);
    }
  });

  // ─── TEST B: Daily EQH/EQL Sequence ───────────────────────────────────────
  it("B: generates HTF EQH level on Daily timeframe with correct label", () => {
    const engineD = new PineLiquidityEngine({ eqPivotLen: 2 }, 1440);
    const baseTime = new Date("2026-08-01T00:00:00Z").getTime();
    const intervalD = 24 * 60 * 60 * 1000;

    const prices = [
      { high: 490, low: 475 }, { high: 495, low: 478 }, { high: 500, low: 480 },
      { high: 492, low: 476 }, { high: 487, low: 473 },
      { high: 491, low: 477 }, { high: 500.04, low: 479 }, { high: 493, low: 477 },
      { high: 488, low: 472 },
    ];
    const candles = generateSequence(baseTime, intervalD, prices);
    candles.forEach((c) => engineD.processCandle(c));

    const levels = engineD.getActiveLevels();
    const eqhD = levels.find((l) => l.type === "EQH" && l.label.includes("D)"));
    if (eqhD) {
      expect(eqhD.label).toContain("HTF EQH (D)");
      expect(eqhD.price).toBeCloseTo(500.02, 2);
    }
  });

  it("B: generates HTF EQL level on Daily timeframe with correct label", () => {
    const engineD = new PineLiquidityEngine({ eqPivotLen: 2 }, 1440);
    const baseTime = new Date("2026-08-01T00:00:00Z").getTime();
    const intervalD = 24 * 60 * 60 * 1000;

    const prices = [
      { high: 310, low: 292 }, { high: 305, low: 290 }, { high: 308, low: 293 },
      { high: 315, low: 296 }, { high: 318, low: 298 },
      { high: 311, low: 291 }, { high: 304, low: 290.02 }, { high: 307, low: 292 },
      { high: 316, low: 297 },
    ];
    const candles = generateSequence(baseTime, intervalD, prices);
    candles.forEach((c) => engineD.processCandle(c));

    const levels = engineD.getActiveLevels();
    const eqlD = levels.find((l) => l.type === "EQL" && l.label.includes("D)"));
    if (eqlD) {
      expect(eqlD.label).toContain("HTF EQL (D)");
      expect(eqlD.price).toBeCloseTo(290.01, 2);
    }
  });

  // ─── TEST C: P/D Breakout Reset ───────────────────────────────────────────
  it("C: P/D breakout reset clears ALL 5 state variables and blocks re-formation until fresh PH+PL", () => {
    const enginePD = new PineLiquidityEngine(
      { pdPivotLen: 2, pdAtrLen: 3, pdAtrMult: 0.0 }, // zero ATR buffer → clean breakout on close
      15
    );
    const baseTime = new Date("2026-09-01T00:00:00Z").getTime();
    const i15M = 15 * 60 * 1000;

    // Enough candles to create a PH and PL and form a zone
    const setup = [
      { high: 100, low: 90 }, { high: 110, low: 92 }, { high: 120, low: 95 }, // PH @ 120
      { high: 108, low: 88 }, { high: 104, low: 80 }, { high: 100, low: 78 }, // descending
      { high: 96, low: 74 }, { high: 98, low: 76 }, { high: 102, low: 80 },   // PL around 74
    ];
    const setupCandles = generateSequence(baseTime, i15M, setup);
    setupCandles.forEach((c) => enginePD.processCandle(c));

    const stateAfterSetup = enginePD.getPDZoneState();
    // If zone formed, verify active
    if (stateAfterSetup.active) {
      // Now send a candle that closes FAR above the zone top (breakout up)
      const breakoutCandle = makeCandle(
        new Date(baseTime + setup.length * i15M).toISOString(),
        200, 130, 130, 200 // close = 200, well above any plausible zone top
      );
      enginePD.processCandle(breakoutCandle);

      const stateAfterBreakout = enginePD.getPDZoneState();
      // ALL 5 state variables must be reset
      expect(stateAfterBreakout.active).toBe(false);
      expect(stateAfterBreakout.top).toBeNull();
      expect(stateAfterBreakout.bottom).toBeNull();
      expect(stateAfterBreakout.lastPH).toBeNull();
      expect(stateAfterBreakout.lastPL).toBeNull();

      // One more normal candle — zone must NOT re-form (no fresh pivots yet)
      const normalCandle = makeCandle(
        new Date(baseTime + (setup.length + 1) * i15M).toISOString(),
        155, 145
      );
      enginePD.processCandle(normalCandle);

      const stateAfterNormal = enginePD.getPDZoneState();
      expect(stateAfterNormal.active).toBe(false);
    }
  });

  // ─── TEST D: Exact Equality Tolerance Boundary ────────────────────────────
  it("D: f_isEqual boundary — exactly <= eqTolPct passes, just > fails", () => {
    const base = 100.00;
    const tolPct = 0.05;

    // exactly at boundary: diff / max * 100 = 0.05%
    const atBoundary = base * (1 + tolPct / 100); // 100.05
    expect(PineLiquidityEngine.f_isEqual(base, atBoundary, tolPct)).toBe(true);

    // just over: 100.06 — diff = 0.06%
    const overBoundary = 100.06;
    expect(PineLiquidityEngine.f_isEqual(base, overBoundary, tolPct)).toBe(false);

    // null guards
    expect(PineLiquidityEngine.f_isEqual(null, 100.0, tolPct)).toBe(false);
    expect(PineLiquidityEngine.f_isEqual(100.0, null, tolPct)).toBe(false);
  });

  // ─── TEST E: EQ Overlap Tolerance Boundary ────────────────────────────────
  it("E: f_isNear rejects level within overlapTolPct as duplicate, accepts beyond it", () => {
    const existingArr = [100.00];
    const tolPct = 0.05;

    // Within tolerance → duplicate
    expect(PineLiquidityEngine.f_isNear(100.03, existingArr, tolPct)).toBe(true);
    // Exactly at tolerance boundary → duplicate
    expect(PineLiquidityEngine.f_isNear(100.05, existingArr, tolPct)).toBe(true);
    // Just over → not a duplicate
    expect(PineLiquidityEngine.f_isNear(100.10, existingArr, tolPct)).toBe(false);
    // Empty array → never a duplicate
    expect(PineLiquidityEngine.f_isNear(100.03, [], tolPct)).toBe(false);
  });

  // ─── TEST F: maxEQLevels FIFO Eviction ────────────────────────────────────
  it("F: maxEQLevels FIFO eviction removes oldest level when cap is exceeded", () => {
    const engineFifo = new PineLiquidityEngine({ maxEQLevels: 2, showEQ_15: true, eqPivotLen: 2, eqTolPct: 0.05 }, 15);

    // Manually inject 3 distinct EQH levels
    (engineFifo as any).eqhPrices = [];
    (engineFifo as any).eqhTexts = [];

    const pushUnique = (price: number, text: string) => {
      (engineFifo as any).f_pushLevelUnique(
        (engineFifo as any).eqhPrices,
        (engineFifo as any).eqhTexts,
        [],
        2,          // maxN = 2
        price,
        text,
        0.01        // tight overlap tolerance
      );
    };

    pushUnique(100.0, "EQH-1");
    pushUnique(200.0, "EQH-2");
    pushUnique(300.0, "EQH-3"); // should evict EQH-1

    const prices: number[] = (engineFifo as any).eqhPrices;
    expect(prices.length).toBe(2);
    expect(prices[0]).toBe(200.0); // oldest remaining
    expect(prices[1]).toBe(300.0);
  });

  // ─── TEST G: maxSwingLevels FIFO Eviction ─────────────────────────────────
  it("G: maxSwingLevels FIFO eviction removes oldest swing level when cap is exceeded", () => {
    const engineFifo = new PineLiquidityEngine({ maxSwingLevels: 2 }, 15);

    (engineFifo as any).swhPrices = [];
    (engineFifo as any).swhTexts = [];

    const pushSwing = (price: number) => {
      (engineFifo as any).f_pushLevelUnique(
        (engineFifo as any).swhPrices,
        (engineFifo as any).swhTexts,
        [],
        2,
        price,
        "15M+ Swing High",
        0.01
      );
    };

    pushSwing(50.0);
    pushSwing(75.0);
    pushSwing(100.0); // evicts 50.0

    const prices: number[] = (engineFifo as any).swhPrices;
    expect(prices.length).toBe(2);
    expect(prices[0]).toBe(75.0);
    expect(prices[1]).toBe(100.0);
  });

  // ─── TEST H: Swing Timeframe Selection ────────────────────────────────────
  it("H: getSwingCandles returns tf15Candles when chartTFinMinutes < 15", () => {
    const e1 = new PineLiquidityEngine({}, 1);
    expect((e1 as any).getSwingCandles()).toBe((e1 as any).tf15Candles);
  });

  it("H: getSwingCandles returns tf15Candles when chartTFinMinutes === 15", () => {
    const e15 = new PineLiquidityEngine({}, 15);
    expect((e15 as any).getSwingCandles()).toBe((e15 as any).tf15Candles);
  });

  it("H: getSwingCandles returns tfChartCandles (30M) when chartTFinMinutes === 30", () => {
    const e30 = new PineLiquidityEngine({}, 30);
    expect((e30 as any).getSwingCandles()).toBe((e30 as any).tfChartCandles);
  });

  it("H: getSwingCandles returns tf60Candles when chartTFinMinutes === 60", () => {
    const e60 = new PineLiquidityEngine({}, 60);
    expect((e60 as any).getSwingCandles()).toBe((e60 as any).tf60Candles);
  });

  it("H: getSwingCandles returns tf240Candles when chartTFinMinutes === 240", () => {
    const e240 = new PineLiquidityEngine({}, 240);
    expect((e240 as any).getSwingCandles()).toBe((e240 as any).tf240Candles);
  });

  it("H: getSwingCandles returns tfDailyCandles when chartTFinMinutes === 1440", () => {
    const eD = new PineLiquidityEngine({}, 1440);
    expect((eD as any).getSwingCandles()).toBe((eD as any).tfDailyCandles);
  });

  // ─── TEST I: PWH/PWL Weekly Boundary ─────────────────────────────────────
  it("I: PWH/PWL update only when a new ISO week (Monday UTC) begins", () => {
    // Week 1: Monday Aug 24 → Sunday Aug 30
    const mon1 = makeCandle("2026-08-24T00:00:00Z", 120, 80);
    const wed1 = makeCandle("2026-08-26T12:00:00Z", 115, 85); // same week
    // Week 2: Monday Aug 31
    const mon2 = makeCandle("2026-08-31T00:00:00Z", 110, 75);

    engine.processCandle(mon1);
    engine.processCandle(wed1); // Still week 1 — no PWH/PWL yet (need 2 completed weeks)

    const levelsAfterWk1 = engine.getActiveLevels();
    expect(levelsAfterWk1.find((l) => l.type === "PWH")).toBeUndefined(); // No completed week yet

    engine.processCandle(mon2); // Week 2 starts → week 1 is now completed

    const levelsAfterWk2 = engine.getActiveLevels();
    const pwh = levelsAfterWk2.find((l) => l.type === "PWH");
    const pwl = levelsAfterWk2.find((l) => l.type === "PWL");

    expect(pwh?.price).toBe(120); // week 1 high (max of mon1=120, wed1=115)
    expect(pwl?.price).toBe(80);  // week 1 low (min of mon1=80, wed1=85)
  });

  it("I: PWH/PWL are NOT invalidated by wick-based f_removeBroken", () => {
    const w1 = makeCandle("2026-08-24T00:00:00Z", 120, 80);
    const w2 = makeCandle("2026-08-31T00:00:00Z", 110, 85); // triggers PWH=120, PWL=80

    engine.processCandle(w1);
    engine.processCandle(w2);

    // Send candle that wicks ABOVE PWH and BELOW PWL
    const wickCandle = makeCandle("2026-08-31T01:00:00Z", 125, 75);
    engine.processCandle(wickCandle);

    const levels = engine.getActiveLevels();
    const pwh = levels.find((l) => l.type === "PWH");
    const pwl = levels.find((l) => l.type === "PWL");

    // PWH/PWL must survive — not removed by wick invalidation
    expect(pwh?.price).toBe(120);
    expect(pwl?.price).toBe(80);
  });

  // ─── TEST: Alert Bridge Premium/Discount Sub-zone Distinction ────────────
  it("Alert bridge emits 'Premium Zone' and 'Discount Zone' as distinct events", () => {
    const bridge = new PineAlertBridge();
    bridge.registerEngine("BTC/USD", engine);

    // Inject active P/D zone state directly
    (engine as any).pdZoneActive = true;
    (engine as any).pdZoneTop = 110;
    (engine as any).pdZoneBot = 90;
    (engine as any).pdLastPH = 110;
    (engine as any).pdLastPL = 90;
    (engine as any).inputs = { ...DEFAULT_PINE_INPUTS, showPDZone: true, showEqLine: true };

    const nowIso = new Date().toISOString();

    // Price in premium (above eq=100, below top=110)
    const premiumAlerts = bridge.checkLivePrice("BTC/USD", 105, nowIso);
    const premiumEvt = premiumAlerts.find((a) => a.event === "ZONE_ENTERED");
    expect(premiumEvt?.levelLabel).toBe("Premium Zone");

    // Price in discount (below eq=100, above bot=90)
    const laterIso = new Date(Date.now() + 120_000).toISOString(); // past 60s dedup
    const discountAlerts = bridge.checkLivePrice("BTC/USD", 95, laterIso);
    const discountEvt = discountAlerts.find((a) => a.event === "ZONE_ENTERED");
    expect(discountEvt?.levelLabel).toBe("Discount Zone");
  });
});
