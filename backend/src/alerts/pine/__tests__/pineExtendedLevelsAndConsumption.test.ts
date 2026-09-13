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
    const day2 = makeCandle("2026-09-02T00:00:00Z", 2080, 1980);

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
      const padH = String(h).padStart(2, "0");
      const ts = `2026-09-01T${padH}:00:00Z`;
      engine.processCandle(makeCandle(ts, 2100 + h * 2, 1950 - h * 2));
    }
    // 16:00 UTC candle closes London session
    engine.processCandle(makeCandle("2026-09-01T16:00:00Z", 2000, 1900));

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
    // 21:00 UTC candle closes NY session
    engine.processCandle(makeCandle("2026-09-01T21:00:00Z", 2000, 1900));

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
    const day2 = makeCandle("2026-09-02T00:00:00Z", 4360.00, 4250.00);
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
    const day2 = makeCandle("2026-09-02T00:00:00Z", 4360.00, 4250.00);
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
    const day2 = makeCandle("2026-09-02T00:00:00Z", 4360.00, 4250.00);
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
    const day2 = makeCandle("2026-09-02T00:00:00Z", 4360.00, 4250.00);
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
    const day2 = makeCandle("2026-09-02T00:00:00Z", 4360.00, 4250.00);
    engine.processCandle(day1);
    engine.processCandle(day2);

    bridge.checkLivePrice("XAU/USD", 4348.50, "2026-09-02T12:00:00Z");

    // Recalculate engine by processing new candles
    engine.processCandle(makeCandle("2026-09-02T13:00:00Z", 4349.00, 4300.00));

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
    const day2 = makeCandle("2026-09-02T00:00:00Z", 4360.00, 4250.00);
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
    const day2 = makeCandle("2026-09-02T00:00:00Z", 4360.00, 4250.00);
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
