import { describe, it, expect, vi, beforeEach } from "vitest";
import { PineLiquidityEngine } from "../PineLiquidityEngine";
import { PineAlertBridge, isXauWeekend } from "../PineAlertBridge";
import * as TelegramClient from "../../telegram/TelegramClient";
import { Candle } from "../PineTypes";

function makeCandle(timestamp: string, high: number, low: number, open?: number, close?: number): Candle {
  return {
    timestamp,
    open: open ?? (high + low) / 2,
    high,
    low,
    close: close ?? (high + low) / 2,
    volume: 100,
  };
}

describe("Scalar Level Bootstrap & Live Alert Verification", () => {
  let engine: PineLiquidityEngine;
  let bridge: PineAlertBridge;

  beforeEach(() => {
    vi.restoreAllMocks();
    engine = new PineLiquidityEngine({}, 15);
    bridge = new PineAlertBridge();
    bridge.registerEngine("XAU/USD", engine);
  });

  it("A. Bootstrap regression: Active unbroken PDH/PDL/PWH/PWL remain in getActiveLevels() after bootstrap", () => {
    // Week 1 (Mon 3 Aug - Sun 9 Aug): High=2500, Low=2400
    const baseMs = new Date("2026-08-03T00:00:00Z").getTime();
    for (let d = 0; d < 7; d++) {
      const ts = new Date(baseMs + d * 24 * 60 * 60 * 1000).toISOString();
      engine.processCandle(makeCandle(ts, 2500, 2400));
    }

    // Week 2 (Mon 10 Aug): Day 1 (Mon 10 Aug) High=2480, Low=2420
    const day8Ts = new Date(baseMs + 7 * 24 * 60 * 60 * 1000).toISOString();
    engine.processCandle(makeCandle(day8Ts, 2480, 2420));

    // Week 2: Day 2 (Tue 11 Aug) High=2470, Low=2430 (inside range)
    const day9Ts = new Date(baseMs + 8 * 24 * 60 * 60 * 1000).toISOString();
    engine.processCandle(makeCandle(day9Ts, 2470, 2430));

    const activeLevels = engine.getActiveLevels("XAU/USD");

    // PWH (2500), PWL (2400), PDH (2480), PDL (2420) must all be active!
    expect(activeLevels.some((l) => l.type === "PWH" && l.price === 2500)).toBe(true);
    expect(activeLevels.some((l) => l.type === "PWL" && l.price === 2400)).toBe(true);
    expect(activeLevels.some((l) => l.type === "PDH" && l.price === 2480)).toBe(true);
    expect(activeLevels.some((l) => l.type === "PDL" && l.price === 2420)).toBe(true);
  });

  it("B. Historical cross regression: Historical candle before level formation does not consume it", () => {
    // Day 1: High=2600 (very high spike)
    engine.processCandle(makeCandle("2026-08-03T00:00:00Z", 2600, 2400));

    // Day 2 (2026-08-04): range 2450-2550
    engine.processCandle(makeCandle("2026-08-04T00:00:00Z", 2550, 2450));

    // Day 3 (2026-08-05): starts, setting Day 2 high (2550) as new PDH
    engine.processCandle(makeCandle("2026-08-05T00:00:00Z", 2500, 2400));

    // Day 3 active levels: PDH from Day 2 is 2550
    const activeLevels = engine.getActiveLevels("XAU/USD");
    expect(activeLevels.some((l) => l.type === "PDH" && l.price === 2550)).toBe(true);
  });

  it("C. Live touch: Live price touch generates exactly ONE alert and consumes the level", async () => {
    const telegramSpy = vi.spyOn(TelegramClient, "sendTelegramMessage").mockResolvedValue({ sent: true });

    // Day 1: High=2500, Low=2400 -> PDH=2500
    engine.processCandle(makeCandle("2026-09-01T00:00:00Z", 2500, 2400));
    // Day 2 starts: High=2480 (PDH 2500 is unbroken)
    engine.processCandle(makeCandle("2026-09-02T00:00:00Z", 2480, 2420));

    // Live tick 1: touches PDH (2500)
    const alerts1 = bridge.checkLivePrice("XAU/USD", 2500.00, "2026-09-02T12:00:00Z");
    expect(alerts1.length).toBe(1);
    expect(alerts1[0].event).toBe("LEVEL_TOUCHED");
    expect(alerts1[0].levelPrice).toBe(2500.00);
    expect(telegramSpy).toHaveBeenCalledTimes(1);

    // Live tick 2: same price 5s later -> NO second alert because level was consumed!
    const alerts2 = bridge.checkLivePrice("XAU/USD", 2500.00, "2026-09-02T12:00:05Z");
    expect(alerts2.length).toBe(0);
    expect(telegramSpy).toHaveBeenCalledTimes(1);

    // Level removed from activeLevels
    const levelsAfter = engine.getActiveLevels("XAU/USD");
    expect(levelsAfter.some((l) => l.type === "PDH" && l.price === 2500.00)).toBe(false);
  });

  it("D. Missed wick: Completed 1M candle touching an active scalar level generates exactly ONE alert and consumes level", async () => {
    const telegramSpy = vi.spyOn(TelegramClient, "sendTelegramMessage").mockResolvedValue({ sent: true });

    // Day 1: High=2500, Low=2400 -> PDH=2500
    engine.processCandle(makeCandle("2026-09-01T00:00:00Z", 2500, 2400));
    // Day 2 starts: High=2480 (PDH 2500 is unbroken)
    engine.processCandle(makeCandle("2026-09-02T00:00:00Z", 2480, 2420));

    // Completed 1M candle wicks up to 2501.00
    const missedCandle = makeCandle("2026-09-02T12:00:00Z", 2501.00, 2490.00);
    const alerts = bridge.evaluateCandleWick("XAU/USD", missedCandle, "2026-09-02T12:00:00Z");

    expect(alerts.length).toBe(1);
    expect(alerts[0].event).toBe("LEVEL_TOUCHED");
    expect(alerts[0].levelPrice).toBe(2500.00);
    expect(telegramSpy).toHaveBeenCalledTimes(1);

    // Level is now consumed
    const levelsAfter = engine.getActiveLevels("XAU/USD");
    expect(levelsAfter.some((l) => l.type === "PDH" && l.price === 2500.00)).toBe(false);
  });

  it("E. Duplicate protection: Repeated ticks within same minute do not generate duplicate alerts", async () => {
    const telegramSpy = vi.spyOn(TelegramClient, "sendTelegramMessage").mockResolvedValue({ sent: true });

    // Day 1: High=2500, Low=2400 -> PDH=2500
    engine.processCandle(makeCandle("2026-09-01T00:00:00Z", 2500, 2400));
    engine.processCandle(makeCandle("2026-09-02T00:00:00Z", 2480, 2420));

    // Tick 1
    bridge.checkLivePrice("XAU/USD", 2500.00, "2026-09-02T12:00:00Z");
    // Tick 2 (10s later)
    bridge.checkLivePrice("XAU/USD", 2500.50, "2026-09-02T12:00:10Z");
    // Tick 3 (20s later)
    bridge.checkLivePrice("XAU/USD", 2500.20, "2026-09-02T12:00:20Z");

    expect(telegramSpy).toHaveBeenCalledTimes(1);
  });

  it("F. Subsequent valid rearm: A new scalar level formed on a new day works cleanly", async () => {
    const telegramSpy = vi.spyOn(TelegramClient, "sendTelegramMessage").mockResolvedValue({ sent: true });

    // Day 1: High=2500, Low=2400 -> PDH=2500
    engine.processCandle(makeCandle("2026-09-01T00:00:00Z", 2500, 2400));
    // Day 2: High=2510, Low=2420 -> Day 1 PDH (2500) touched, Day 2 finishes with High=2510
    engine.processCandle(makeCandle("2026-09-02T00:00:00Z", 2510, 2420));
    // Day 3: High=2490 -> Day 2 finishes with High=2510
    engine.processCandle(makeCandle("2026-09-03T00:00:00Z", 2490, 2400));
    // Day 4 starts (2026-09-04): New PDH is 2490 (from Day 3)
    engine.processCandle(makeCandle("2026-09-04T00:00:00Z", 2480, 2400));

    // Day 4 active levels: PDH is 2490
    const levelsDay4 = engine.getActiveLevels("XAU/USD");
    expect(levelsDay4.some((l) => l.type === "PDH" && l.price === 2490)).toBe(true);

    // Live tick on Day 4 touches new PDH (2490)
    const alertsDay4 = bridge.checkLivePrice("XAU/USD", 2490.00, "2026-09-04T12:00:00Z");
    expect(alertsDay4.length).toBe(1);
    expect(alertsDay4[0].levelPrice).toBe(2490.00);
    expect(telegramSpy).toHaveBeenCalledTimes(1);
  });

  it("G. Weekend protection remains passing for XAU/USD", () => {
    // Saturday ISO timestamp
    const saturdayTs = "2026-09-05T12:00:00Z";
    expect(isXauWeekend(saturdayTs)).toBe(true);

    // Monday ISO timestamp
    const mondayTs = "2026-09-07T12:00:00Z";
    expect(isXauWeekend(mondayTs)).toBe(false);

    // Live price check on Saturday produces 0 alerts
    engine.processCandle(makeCandle("2026-09-01T00:00:00Z", 2500, 2400));
    engine.processCandle(makeCandle("2026-09-02T00:00:00Z", 2480, 2420));
    const saturdayAlerts = bridge.checkLivePrice("XAU/USD", 2500.00, saturdayTs);
    expect(saturdayAlerts.length).toBe(0);
  });
});
