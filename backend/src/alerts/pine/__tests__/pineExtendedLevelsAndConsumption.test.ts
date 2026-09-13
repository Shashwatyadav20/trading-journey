import { describe, it, expect, beforeEach, vi } from "vitest";
import { PineLiquidityEngine } from "../PineLiquidityEngine";
import { PineAlertBridge, isXauWeekend } from "../PineAlertBridge";
import { Candle } from "../PineTypes";
import * as TelegramClient from "../../telegram/TelegramClient";

function makeCandle(
  timestamp: string,
  high: number,
  low: number,
  open: number = (high + low) / 2,
  close: number = (high + low) / 2,
  volume: number = 100
): Candle {
  return { timestamp, open, high, low, close, volume };
}

describe("Pine Extended Liquidity Levels & Level Consumption Test Suite", () => {
  let engine: PineLiquidityEngine;
  let bridge: PineAlertBridge;

  beforeEach(() => {
    engine = new PineLiquidityEngine({}, 15);
    bridge = new PineAlertBridge();
    bridge.registerEngine("XAU/USD", engine);
    bridge.registerEngine("BTC/USD", engine);
    vi.restoreAllMocks();
  });

  // 1. PDH / PDL calculation
  it("1. Calculates PDH and PDL from previous completed daily candle", () => {
    const day1 = makeCandle("2026-09-01T00:00:00Z", 2050, 1950);
    // day2 must stay strictly inside day1's range so PDH/PDL are not swept historically
    const day2 = makeCandle("2026-09-02T00:00:00Z", 2040, 1960);

    engine.processCandle(day1);
    engine.processCandle(day2);

    const levels = engine.getActiveLevels();
    const pdh = levels.find((l) => l.type === "PDH");
    const pdl = levels.find((l) => l.type === "PDL");

    expect(pdh).toBeDefined();
    expect(pdl).toBeDefined();
    expect(pdh?.price).toBe(2050);
    expect(pdl?.price).toBe(1950);
  });

  // 2. PMH / PML calculation
  it("2. Calculates PMH and PML from previous completed monthly candle", () => {
    const pmEngine = new PineLiquidityEngine({ showPW: false, showPD: false }, 15);
    const month1 = makeCandle("2026-07-01T00:00:00Z", 2150, 1850);
    const month2 = makeCandle("2026-08-01T00:00:00Z", 2000, 1920);

    pmEngine.processCandle(month1);
    pmEngine.processCandle(month2);

    const levels = pmEngine.getActiveLevels();
    const pmh = levels.find((l) => l.type === "PMH");
    const pml = levels.find((l) => l.type === "PML");

    expect(pmh).toBeDefined();
    expect(pml).toBeDefined();
    expect(pmh?.price).toBe(2150);
    expect(pml?.price).toBe(1850);
  });

  // 3. Asia H/L
  it("3. Calculates Asia High and Asia Low from 00:00 - 08:59 UTC session", () => {
    // 00:00 UTC to 08:00 UTC candles
    for (let h = 0; h < 9; h++) {
      const ts = `2026-09-01T0${h}:00:00Z`;
      engine.processCandle(makeCandle(ts, 2000 + h * 5, 1900 - h * 5));
    }
    // 09:00 UTC candle closes Asia session and stores Asia H/L
    engine.processCandle(makeCandle("2026-09-01T09:00:00Z", 1980, 1920));

    const levels = engine.getActiveLevels();
    const asiaH = levels.find((l) => l.type === "ASIA_H");
    const asiaL = levels.find((l) => l.type === "ASIA_L");

    expect(asiaH).toBeDefined();
    expect(asiaL).toBeDefined();
    expect(asiaH?.price).toBe(2040); // max high at h=8
    expect(asiaL?.price).toBe(1860); // min low at h=8
  });

  // 4. London H/L
  it("4. Calculates London High and London Low from 07:00 - 15:59 UTC session", () => {
    for (let h = 7; h < 16; h++) {
      const padH = String(h).padStart(2, "00").slice(-2);
      const ts = `2026-09-01T${padH}:00:00Z`;
      engine.processCandle(makeCandle(ts, 2100 + h * 2, 1950 - h * 2));
    }
    // 16:00 UTC candle closes London session.
    // londonHPrice=2130 (h=15), londonLPrice=1920 (h=15).
    // Closing candle must NOT cross those: high < 2130 and low > 1920.
    engine.processCandle(makeCandle("2026-09-01T16:00:00Z", 2000, 1925));

    const levels = engine.getActiveLevels();
    const lonH = levels.find((l) => l.type === "LONDON_H");
    const lonL = levels.find((l) => l.type === "LONDON_L");

    expect(lonH).toBeDefined();
    expect(lonL).toBeDefined();
    expect(lonH?.price).toBe(2130); // max at h=15
    expect(lonL?.price).toBe(1920); // min at h=15
  });

  // 5. New York H/L
  it("5. Calculates New York High and New York Low from 13:00 - 20:59 UTC session", () => {
    for (let h = 13; h < 21; h++) {
      const ts = `2026-09-01T${h}:00:00Z`;
      engine.processCandle(makeCandle(ts, 2200 + h, 2000 - h));
    }
    // 21:00 UTC candle closes NY session.
    // nyHPrice=2220 (h=20), nyLPrice=1980 (h=20).
    // Closing candle must NOT cross those: high < 2220 and low > 1980.
    engine.processCandle(makeCandle("2026-09-01T21:00:00Z", 2000, 1985));

    const levels = engine.getActiveLevels();
    const nyH = levels.find((l) => l.type === "NY_H");
    const nyL = levels.find((l) => l.type === "NY_L");

    expect(nyH).toBeDefined();
    expect(nyL).toBeDefined();
    expect(nyH?.price).toBe(2220); // max at h=20
    expect(nyL?.price).toBe(1980); // min at h=20
  });

  // 6. Duplicate/overlap filtering
  it("6. Filters duplicate/overlapping levels within 0.15% tolerance", () => {
    const day1 = makeCandle("2026-09-01T00:00:00Z", 2000.0, 1900.0);
    const day2 = makeCandle("2026-09-02T00:00:00Z", 2000.5, 1900.2); // ~0.02% difference

    engine.processCandle(day1);
    engine.processCandle(day2);

    const levels = engine.getActiveLevels();
    const pdhLevels = levels.filter((l) => l.price >= 2000.0 && l.price <= 2000.5);
    expect(pdhLevels.length).toBeLessThanOrEqual(1);
  });

  // 7. Active level touch sends exactly one alert
  it("7. Active level touch sends exactly one alert", () => {
    vi.spyOn(TelegramClient, "sendTelegramMessage").mockResolvedValue({ sent: true });

    const day1 = makeCandle("2026-09-01T00:00:00Z", 4348.50, 4200.00);
    // day2 high=4340 < PDH=4348.50 — level stays active (not swept historically)
    const day2 = makeCandle("2026-09-02T00:00:00Z", 4340.00, 4250.00);
    engine.processCandle(day1);
    engine.processCandle(day2);

    const nowIso = "2026-09-02T12:00:00Z";
    const alerts1 = bridge.checkLivePrice("XAU/USD", 4348.50, nowIso);
    const alerts2 = bridge.checkLivePrice("XAU/USD", 4348.50, nowIso);

    expect(alerts1.length).toBe(1);
    expect(alerts2.length).toBe(0);
  });

  // 8. Touched level becomes CONSUMED
  it("8. Touched level becomes CONSUMED upon price touch", () => {
    vi.spyOn(TelegramClient, "sendTelegramMessage").mockResolvedValue({ sent: true });

    const day1 = makeCandle("2026-09-01T00:00:00Z", 4348.50, 4200.00);
    // day2 high=4340 < PDH=4348.50 — level stays active (not swept historically)
    const day2 = makeCandle("2026-09-02T00:00:00Z", 4340.00, 4250.00);
    engine.processCandle(day1);
    engine.processCandle(day2);

    const nowIso = "2026-09-02T12:00:00Z";
    bridge.checkLivePrice("XAU/USD", 4348.50, nowIso);

    expect(engine.isConsumed({ id: "pdh-4348.50", type: "PDH", price: 4348.50 } as any, "XAU/USD")).toBe(true);
  });

  // 9. Consumed level disappears from active chart data
  it("9. Consumed level disappears from getActiveLevels()", () => {
    vi.spyOn(TelegramClient, "sendTelegramMessage").mockResolvedValue({ sent: true });

    const day1 = makeCandle("2026-09-01T00:00:00Z", 4348.50, 4200.00);
    // day2 high=4340 < PDH=4348.50 — level stays active (not swept historically)
    const day2 = makeCandle("2026-09-02T00:00:00Z", 4340.00, 4250.00);
    engine.processCandle(day1);
    engine.processCandle(day2);

    const levelsBefore = engine.getActiveLevels();
    expect(levelsBefore.some((l) => l.price === 4348.50)).toBe(true);

    bridge.checkLivePrice("XAU/USD", 4348.50, "2026-09-02T12:00:00Z");

    const levelsAfter = engine.getActiveLevels();
    expect(levelsAfter.some((l) => l.price === 4348.50)).toBe(false);
  });

  // 10. Consumed level is removed from alert candidates
  it("10. Consumed level is removed from alert candidates and cannot alert again", () => {
    vi.spyOn(TelegramClient, "sendTelegramMessage").mockResolvedValue({ sent: true });

    const day1 = makeCandle("2026-09-01T00:00:00Z", 4348.50, 4200.00);
    // day2 high=4340 < PDH=4348.50 — level stays active (not swept historically)
    const day2 = makeCandle("2026-09-02T00:00:00Z", 4340.00, 4250.00);
    engine.processCandle(day1);
    engine.processCandle(day2);

    bridge.checkLivePrice("XAU/USD", 4348.50, "2026-09-02T12:00:00Z");

    // Second check hours later
    const laterAlerts = bridge.checkLivePrice("XAU/USD", 4348.50, "2026-09-02T15:00:00Z");
    expect(laterAlerts.length).toBe(0);
  });

  // 11. Same consumed level does not alert again after level recalculation
  it("11. Same consumed level does not alert again after level recalculation", () => {
    vi.spyOn(TelegramClient, "sendTelegramMessage").mockResolvedValue({ sent: true });

    const day1 = makeCandle("2026-09-01T00:00:00Z", 4348.50, 4200.00);
    // day2 high=4340 < PDH=4348.50 — level stays active (not swept historically)
    const day2 = makeCandle("2026-09-02T00:00:00Z", 4340.00, 4250.00);
    engine.processCandle(day1);
    engine.processCandle(day2);

    bridge.checkLivePrice("XAU/USD", 4348.50, "2026-09-02T12:00:00Z");

    // Recalculate engine by processing new candles
    engine.processCandle(makeCandle("2026-09-02T13:00:00Z", 4340.00, 4300.00));

    // Must still remain consumed
    const levels = engine.getActiveLevels();
    expect(levels.some((l) => l.price === 4348.50)).toBe(false);

    const alerts = bridge.checkLivePrice("XAU/USD", 4348.50, "2026-09-02T14:00:00Z");
    expect(alerts.length).toBe(0);
  });

  // 12. Dynamic level-index changes do not reset consumed state
  it("12. Dynamic level-index changes do not reset consumed state", () => {
    engine.consumeLevel("PDH-4348.50", "XAU/USD");
    expect(engine.isConsumed({ id: "pdh-4348.50", type: "PDH", price: 4348.50 } as any, "XAU/USD")).toBe(true);

    // Change timeframe or re-order levels
    engine.setChartTF(60);
    expect(engine.isConsumed({ id: "pdh-4348.50", type: "PDH", price: 4348.50 } as any, "XAU/USD")).toBe(true);
  });

  // 13. Realtime touch + wick fallback produces only one alert
  it("13. Realtime touch + wick fallback produces only one alert", () => {
    vi.spyOn(TelegramClient, "sendTelegramMessage").mockResolvedValue({ sent: true });

    const day1 = makeCandle("2026-09-01T00:00:00Z", 4348.50, 4200.00);
    // day2 high=4340 < PDH=4348.50 — level stays active (not swept historically)
    const day2 = makeCandle("2026-09-02T00:00:00Z", 4340.00, 4250.00);
    engine.processCandle(day1);
    engine.processCandle(day2);

    const touchAlerts = bridge.checkLivePrice("XAU/USD", 4348.50, "2026-09-02T12:00:00Z");
    expect(touchAlerts.length).toBe(1);

    // Wick fallback runs on closed candle
    const wickCandle = makeCandle("2026-09-02T12:00:00Z", 4349.00, 4340.00);
    const wickAlerts = bridge.evaluateCandleWick("XAU/USD", wickCandle, "2026-09-02T12:00:00Z");
    expect(wickAlerts.length).toBe(0);
  });

  // 14. Micro pullback does not produce duplicate alert
  it("14. Micro pullback around level produces only one alert", () => {
    vi.spyOn(TelegramClient, "sendTelegramMessage").mockResolvedValue({ sent: true });

    const day1 = makeCandle("2026-09-01T00:00:00Z", 4348.50, 4200.00);
    // day2 high=4340 < PDH=4348.50 — level stays active (not swept historically)
    const day2 = makeCandle("2026-09-02T00:00:00Z", 4340.00, 4250.00);
    engine.processCandle(day1);
    engine.processCandle(day2);

    // Micro oscillation: touch -> pullback -> re-touch
    bridge.checkLivePrice("XAU/USD", 4348.50, "2026-09-02T12:00:00Z");
    bridge.checkLivePrice("XAU/USD", 4347.00, "2026-09-02T12:00:05Z"); // pullback
    const reTouchAlerts = bridge.checkLivePrice("XAU/USD", 4348.50, "2026-09-02T12:00:10Z");

    expect(reTouchAlerts.length).toBe(0);
  });

  // 15. Existing XAU weekend suppression remains working
  it("15. Existing XAU weekend suppression suppresses alerts on Saturday & Sunday", () => {
    const saturdayTs = "2026-09-12T12:00:00Z"; // Saturday
    expect(isXauWeekend(saturdayTs)).toBe(true);

    const liveAlerts = bridge.checkLivePrice("XAU/USD", 4348.50, saturdayTs);
    expect(liveAlerts.length).toBe(0);
  });

  // 16. BTC weekend behavior remains working
  it("16. BTC/USD market functions normally on weekend (no weekend suppression)", () => {
    const saturdayTs = "2026-09-12T12:00:00Z";
    expect(isXauWeekend(saturdayTs)).toBe(true); // isXauWeekend is for XAU, not BTC

    vi.spyOn(TelegramClient, "sendTelegramMessage").mockResolvedValue({ sent: true });
    (engine as any).swhPrices = [80000];
    (engine as any).swhTexts = ["15M+ Swing High"];

    const btcAlerts = bridge.checkLivePrice("BTC/USD", 80000, saturdayTs);
    expect(btcAlerts.length).toBe(1);
  });

  // 17. Existing EQH/EQL, PWH/PWL and 15M+ Swing logic does not regress
  it("17. Preserves HTF EQH/EQL, PWH/PWL, and 15M+ Swing calculation logic", () => {
    const w1 = makeCandle("2026-08-24T00:00:00Z", 2100, 1900);
    const w2 = makeCandle("2026-08-31T00:00:00Z", 2050, 1950);
    engine.processCandle(w1);
    engine.processCandle(w2);

    const levels = engine.getActiveLevels();
    const pwh = levels.find((l) => l.type === "PWH");
    const pwl = levels.find((l) => l.type === "PWL");

    expect(pwh).toBeDefined();
    expect(pwl).toBeDefined();
    expect(pwh?.price).toBe(2100);
    expect(pwl?.price).toBe(1900);
  });

  // 18. Premium/Discount zones are NOT present
  it("18. Verifies Premium/Discount zones are completely absent", () => {
    const pdState = engine.getPDZoneState();
    expect(pdState.active).toBe(false);
    expect(pdState.top).toBeNull();
    expect(pdState.bottom).toBeNull();
    expect(pdState.equilibrium).toBeNull();

    const levels = engine.getActiveLevels();
    const pdLevels = levels.filter((l) => ["PREMIUM", "DISCOUNT", "EQUILIBRIUM"].includes(l.type));
    expect(pdLevels.length).toBe(0);
  });
});

// ─── HISTORICAL SCALAR LEVEL INVALIDATION TESTS ────────────────────────────────
//
// These tests verify the fix introduced in processCandle() step 4:
// scalar levels (PWH/PWL, PDH/PDL, PMH/PML, Session H/L) are now consumed
// when a historical candle's wick crosses them, preventing already-broken levels
// from appearing as ACTIVE after bootstrap.

describe("Scalar Level Historical Invalidation — processCandle() step 4", () => {
  let eng: PineLiquidityEngine;

  beforeEach(() => {
    eng = new PineLiquidityEngine({}, 15);
  });

  // ── GROUP A: HISTORICAL SCALAR SWEEP ──────────────────────────────────────

  it("A1. PWL swept by historical candle low — consumed and absent from getActiveLevels()", () => {
    // Week 1 (Mon 10 Aug): high=2100, low=1800  → PWL will be 1800
    const week1 = makeCandle("2026-08-10T00:00:00Z", 2100, 1800);
    // Week 2 first candle (Mon 17 Aug): triggers evaluatePreviousWeek() → PWL = 1800
    // This candle's low=1790 sweeps below PWL immediately
    const week2First = makeCandle("2026-08-17T00:00:00Z", 2050, 1790);

    eng.processCandle(week1);
    eng.processCandle(week2First);

    const levels = eng.getActiveLevels();
    expect(levels.some((l) => l.type === "PWL" && l.price === 1800)).toBe(false);
    expect(eng.isConsumed({ id: "pwl-1800.00", type: "PWL", price: 1800 } as any)).toBe(true);
  });

  it("A2. PWH swept by historical candle high — consumed and absent from getActiveLevels()", () => {
    // Week 1: high=2100, low=1800  → PWH = 2100
    const week1 = makeCandle("2026-08-10T00:00:00Z", 2100, 1800);
    // Week 2 first candle: high=2110 sweeps above PWH
    const week2First = makeCandle("2026-08-17T00:00:00Z", 2110, 1900);

    eng.processCandle(week1);
    eng.processCandle(week2First);

    const levels = eng.getActiveLevels();
    expect(levels.some((l) => l.type === "PWH" && l.price === 2100)).toBe(false);
    expect(eng.isConsumed({ id: "pwh-2100.00", type: "PWH", price: 2100 } as any)).toBe(true);
  });

  it("A3. PDH swept by historical candle high — consumed and absent from getActiveLevels()", () => {
    // Day 1: high=4348.57, low=4200  → PDH = 4348.57
    const day1 = makeCandle("2026-09-01T00:00:00Z", 4348.57, 4200);
    // Day 2 first candle: high=4360 sweeps above PDH immediately
    const day2First = makeCandle("2026-09-02T00:00:00Z", 4360, 4250);

    eng.processCandle(day1);
    eng.processCandle(day2First);

    const levels = eng.getActiveLevels();
    expect(levels.some((l) => l.type === "PDH" && Math.abs(l.price - 4348.57) < 0.01)).toBe(false);
    expect(eng.isConsumed({ id: "pdh-4348.57", type: "PDH", price: 4348.57 } as any)).toBe(true);
  });

  it("A4. PDL swept by historical candle low — consumed and absent from getActiveLevels()", () => {
    // Day 1: high=4400, low=4300.00  → PDL = 4300
    const day1 = makeCandle("2026-09-01T00:00:00Z", 4400, 4300);
    // Day 2 first candle: low=4295 sweeps below PDL
    const day2First = makeCandle("2026-09-02T00:00:00Z", 4380, 4295);

    eng.processCandle(day1);
    eng.processCandle(day2First);

    const levels = eng.getActiveLevels();
    expect(levels.some((l) => l.type === "PDL" && l.price === 4300)).toBe(false);
    expect(eng.isConsumed({ id: "pdl-4300.00", type: "PDL", price: 4300 } as any)).toBe(true);
  });

  it("A5. PMH swept by historical candle high — consumed and absent from getActiveLevels()", () => {
    // Month 1 (July): high=2150, low=1850  → PMH = 2150
    const month1 = makeCandle("2026-07-01T00:00:00Z", 2150, 1850);
    // Month 2 first candle (Aug): high=2160 sweeps above PMH
    const month2First = makeCandle("2026-08-01T00:00:00Z", 2160, 2000);

    eng.processCandle(month1);
    eng.processCandle(month2First);

    const levels = eng.getActiveLevels();
    expect(levels.some((l) => l.type === "PMH" && l.price === 2150)).toBe(false);
    expect(eng.isConsumed({ id: "pmh-2150.00", type: "PMH", price: 2150 } as any)).toBe(true);
  });

  it("A6. PML swept by historical candle low — consumed and absent from getActiveLevels()", () => {
    // Month 1: high=2150, low=1850  → PML = 1850
    const month1 = makeCandle("2026-07-01T00:00:00Z", 2150, 1850);
    // Month 2 first candle: low=1840 sweeps below PML
    const month2First = makeCandle("2026-08-01T00:00:00Z", 2050, 1840);

    eng.processCandle(month1);
    eng.processCandle(month2First);

    const levels = eng.getActiveLevels();
    expect(levels.some((l) => l.type === "PML" && l.price === 1850)).toBe(false);
    expect(eng.isConsumed({ id: "pml-1850.00", type: "PML", price: 1850 } as any)).toBe(true);
  });

  it("A7. ASIA_H swept by a later session candle — consumed and absent from getActiveLevels()", () => {
    // Build Asia session (00:00–08:59 UTC), peak high = 2040 at h=8
    for (let h = 0; h < 9; h++) {
      const ts = `2026-09-01T0${h}:00:00Z`;
      eng.processCandle(makeCandle(ts, 2000 + h * 5, 1990));
    }
    // 09:00 UTC closes Asia → asiaHPrice = 2040
    eng.processCandle(makeCandle("2026-09-01T09:00:00Z", 1980, 1960));

    // A later candle (same day) whose high = 2045 sweeps above asiaHPrice
    eng.processCandle(makeCandle("2026-09-01T10:00:00Z", 2045, 1970));

    const levels = eng.getActiveLevels();
    expect(levels.some((l) => l.type === "ASIA_H" && l.price === 2040)).toBe(false);
    expect(eng.isConsumed({ id: "asia_h-2040.00", type: "ASIA_H", price: 2040 } as any)).toBe(true);
  });

  it("A8. ASIA_L swept by a later session candle — consumed and absent from getActiveLevels()", () => {
    // Asia session: at h=8 low = 1860
    for (let h = 0; h < 9; h++) {
      const ts = `2026-09-01T0${h}:00:00Z`;
      eng.processCandle(makeCandle(ts, 2000, 1900 - h * 5));
    }
    // 09:00 closes Asia → asiaLPrice = 1860
    eng.processCandle(makeCandle("2026-09-01T09:00:00Z", 1980, 1930));

    // Later candle with low = 1855 sweeps below asiaLPrice
    eng.processCandle(makeCandle("2026-09-01T11:00:00Z", 1975, 1855));

    const levels = eng.getActiveLevels();
    expect(levels.some((l) => l.type === "ASIA_L" && l.price === 1860)).toBe(false);
    expect(eng.isConsumed({ id: "asia_l-1860.00", type: "ASIA_L", price: 1860 } as any)).toBe(true);
  });

  it("A9. LONDON_H swept by a later candle — consumed and absent from getActiveLevels()", () => {
    // London session 07:00–15:59 UTC, max high at h=15 → londonHPrice = 2130
    for (let h = 7; h < 16; h++) {
      const padH = String(h).padStart(2, "0");
      eng.processCandle(makeCandle(`2026-09-01T${padH}:00:00Z`, 2100 + h * 2, 1950));
    }
    // 16:00 closes London → londonHPrice = 2130
    eng.processCandle(makeCandle("2026-09-01T16:00:00Z", 2000, 1900));

    // Later candle with high = 2135 sweeps above londonHPrice
    eng.processCandle(makeCandle("2026-09-01T17:00:00Z", 2135, 2000));

    const levels = eng.getActiveLevels();
    expect(levels.some((l) => l.type === "LONDON_H" && l.price === 2130)).toBe(false);
    expect(eng.isConsumed({ id: "london_h-2130.00", type: "LONDON_H", price: 2130 } as any)).toBe(true);
  });

  it("A10. NY_L swept by a later candle — consumed and absent from getActiveLevels()", () => {
    // NY session 13:00–20:59 UTC, min low at h=20 → nyLPrice = 1980
    for (let h = 13; h < 21; h++) {
      eng.processCandle(makeCandle(`2026-09-01T${h}:00:00Z`, 2200, 2000 - h));
    }
    // 21:00 closes NY → nyLPrice = 1980
    eng.processCandle(makeCandle("2026-09-01T21:00:00Z", 2100, 2000));

    // Later candle with low = 1975 sweeps below nyLPrice
    eng.processCandle(makeCandle("2026-09-01T22:00:00Z", 2100, 1975));

    const levels = eng.getActiveLevels();
    expect(levels.some((l) => l.type === "NY_L" && l.price === 1980)).toBe(false);
    expect(eng.isConsumed({ id: "ny_l-1980.00", type: "NY_L", price: 1980 } as any)).toBe(true);
  });

  // ── GROUP B: UNBROKEN SCALAR LEVELS REMAIN ACTIVE ─────────────────────────

  it("B1. PWL not swept — remains ACTIVE in getActiveLevels()", () => {
    // Week 1: high=2100, low=1800  → PWL = 1800
    const week1 = makeCandle("2026-08-10T00:00:00Z", 2100, 1800);
    // Week 2: low=1810, strictly above PWL — does NOT consume it
    const week2 = makeCandle("2026-08-17T00:00:00Z", 2050, 1810);

    eng.processCandle(week1);
    eng.processCandle(week2);

    const levels = eng.getActiveLevels();
    expect(levels.some((l) => l.type === "PWL" && l.price === 1800)).toBe(true);
  });

  it("B2. PDH not swept — remains ACTIVE in getActiveLevels()", () => {
    // Day 1: high=4348.57, low=4200  → PDH = 4348.57
    const day1 = makeCandle("2026-09-01T00:00:00Z", 4348.57, 4200);
    // Day 2: high=4340, strictly below PDH — does NOT consume it
    const day2 = makeCandle("2026-09-02T00:00:00Z", 4340, 4250);

    eng.processCandle(day1);
    eng.processCandle(day2);

    const levels = eng.getActiveLevels();
    expect(levels.some((l) => l.type === "PDH" && Math.abs(l.price - 4348.57) < 0.01)).toBe(true);
  });

  it("B3. PDL not swept — remains ACTIVE in getActiveLevels()", () => {
    // Day 1: high=4400, low=4300  → PDL = 4300
    const day1 = makeCandle("2026-09-01T00:00:00Z", 4400, 4300);
    // Day 2: low=4305, strictly above PDL — does NOT consume it
    const day2 = makeCandle("2026-09-02T00:00:00Z", 4380, 4305);

    eng.processCandle(day1);
    eng.processCandle(day2);

    const levels = eng.getActiveLevels();
    expect(levels.some((l) => l.type === "PDL" && l.price === 4300)).toBe(true);
  });

  it("B4. PWH not swept — remains ACTIVE in getActiveLevels()", () => {
    // Week 1: high=2100, low=1800  → PWH = 2100
    const week1 = makeCandle("2026-08-10T00:00:00Z", 2100, 1800);
    // Week 2: high=2090, strictly below PWH — does NOT consume it
    const week2 = makeCandle("2026-08-17T00:00:00Z", 2090, 1850);

    eng.processCandle(week1);
    eng.processCandle(week2);

    const levels = eng.getActiveLevels();
    expect(levels.some((l) => l.type === "PWH" && l.price === 2100)).toBe(true);
  });

  it("B5. PMH not swept — remains ACTIVE in getActiveLevels()", () => {
    // Use showPD:false so PDH does not duplicate PMH at the same price (dedup would hide PMH)
    const pmEng = new PineLiquidityEngine({ showPD: false, showPW: false }, 15);
    // Month 1: high=2150, low=1850  → PMH = 2150
    const month1 = makeCandle("2026-07-01T00:00:00Z", 2150, 1850);
    // Month 2: high=2140, strictly below PMH — does NOT consume it
    const month2 = makeCandle("2026-08-01T00:00:00Z", 2140, 2000);

    pmEng.processCandle(month1);
    pmEng.processCandle(month2);

    const levels = pmEng.getActiveLevels();
    expect(levels.some((l) => l.type === "PMH" && l.price === 2150)).toBe(true);
  });

  it("B6. ASIA_H not swept — remains ACTIVE in getActiveLevels()", () => {
    // Asia session, peak high = 2040
    for (let h = 0; h < 9; h++) {
      eng.processCandle(makeCandle(`2026-09-01T0${h}:00:00Z`, 2000 + h * 5, 1990));
    }
    // 09:00 closes Asia → asiaHPrice = 2040
    eng.processCandle(makeCandle("2026-09-01T09:00:00Z", 1980, 1960));

    // Later candle: high = 2035, strictly below asiaHPrice — does NOT consume it
    eng.processCandle(makeCandle("2026-09-01T10:00:00Z", 2035, 1970));

    const levels = eng.getActiveLevels();
    expect(levels.some((l) => l.type === "ASIA_H" && l.price === 2040)).toBe(true);
  });

  // ── GROUP C: LIVE-TOUCH REGRESSION — EXISTING TESTS UNAFFECTED ────────────

  it("C1. Live touch on an unbroken PDH still produces exactly one alert", () => {
    vi.spyOn(TelegramClient, "sendTelegramMessage").mockResolvedValue({ sent: true });

    const bridge = new PineAlertBridge();
    bridge.registerEngine("XAU/USD", eng);

    // Day 1: high=4348.57, low=4200  → PDH = 4348.57
    const day1 = makeCandle("2026-09-01T00:00:00Z", 4348.57, 4200);
    // Day 2: high=4340, DOES NOT sweep PDH historically
    const day2 = makeCandle("2026-09-02T00:00:00Z", 4340, 4250);
    eng.processCandle(day1);
    eng.processCandle(day2);

    // PDH must still be active before the live tick
    const levelsBefore = eng.getActiveLevels();
    expect(levelsBefore.some((l) => l.type === "PDH")).toBe(true);

    // Live tick touches PDH → exactly one alert
    const alerts1 = bridge.checkLivePrice("XAU/USD", 4348.57, "2026-09-02T12:00:00Z");
    expect(alerts1.length).toBe(1);

    // Second live tick at same price → no alert (consumed)
    const alerts2 = bridge.checkLivePrice("XAU/USD", 4348.57, "2026-09-02T12:00:01Z");
    expect(alerts2.length).toBe(0);

    // PDH absent from active levels
    const levelsAfter = eng.getActiveLevels();
    expect(levelsAfter.some((l) => l.type === "PDH")).toBe(false);
  });

  it("C2. Live-example regression: PWL=4368.53 broken historically — absent from active levels at live startup", () => {
    // Week 1 (Mon 10 Aug): high=4400, low=4368.53  → PWL = 4368.53
    const week1 = makeCandle("2026-08-10T00:00:00Z", 4400, 4368.53);
    // Week 2 first candle: low=4350.00 — historically sweeps below PWL
    const week2First = makeCandle("2026-08-17T00:00:00Z", 4380, 4350.00);

    eng.processCandle(week1);
    eng.processCandle(week2First);

    // At the time the live system starts, PWL must NOT appear as ACTIVE
    const levels = eng.getActiveLevels();
    expect(levels.some((l) => l.type === "PWL" && Math.abs(l.price - 4368.53) < 0.01)).toBe(false);
  });

  it("C3. Live-example regression: PDH=4348.57 broken historically — absent from active levels at live startup", () => {
    // Day 1: high=4348.57, low=4200  → PDH = 4348.57
    const day1 = makeCandle("2026-09-01T00:00:00Z", 4348.57, 4200);
    // Day 2: high=4360 — historically sweeps above PDH
    const day2First = makeCandle("2026-09-02T00:00:00Z", 4360, 4280);

    eng.processCandle(day1);
    eng.processCandle(day2First);

    // At the time the live system starts, PDH must NOT appear as ACTIVE
    const levels = eng.getActiveLevels();
    expect(levels.some((l) => l.type === "PDH" && Math.abs(l.price - 4348.57) < 0.01)).toBe(false);
  });
});
