import { describe, it, expect, vi, beforeEach } from "vitest";
import { PineLiquidityEngine } from "../PineLiquidityEngine";
import { PineSignalEngine } from "../PineSignalEngine";
import { PineAlertBridge, isXauWeekend } from "../PineAlertBridge";
import { pineAlertPipeline } from "../PineAlertPipeline";
import { telegramDedupeGuard } from "../../telegram/TelegramDedupeGuard";
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

describe("PDH Repeated Alert Deduplication & Level Consumption Test Suite", () => {
  let engine: PineLiquidityEngine;
  let signalEngine: PineSignalEngine;
  let bridge: PineAlertBridge;

  beforeEach(() => {
    vi.restoreAllMocks();
    (telegramDedupeGuard as any).store.clear();
    engine = new PineLiquidityEngine({}, 15);
    signalEngine = new PineSignalEngine();
    bridge = new PineAlertBridge();
    bridge.registerEngine("XAU/USD", engine);
    bridge.registerEngine("BTC/USD", engine);
    pineAlertPipeline.registerEngine("XAU/USD", engine);
    pineAlertPipeline.registerEngine("BTC/USD", engine);
  });

  it("TEST A — SAME PDH REPEATED CANDLES: exactly ONE Liquidity Sweep alert across fluctuating candle highs", async () => {
    const telegramSpy = vi.spyOn(TelegramClient, "sendTelegramMessage").mockResolvedValue({ sent: true });

    // Day 1: High = 4317.60, Low = 4200.00 -> sets PDH = 4317.60 for Day 2
    engine.processCandle(makeCandle("2026-09-01T00:00:00Z", 4317.60, 4200.00));

    // Day 2 Candle 1: High = 4310.00 (below PDH) -> PDH 4317.60 active
    engine.processCandle(makeCandle("2026-09-02T00:00:00Z", 4310.00, 4250.00));

    // Verify PDH 4317.60 is active
    expect(engine.getActiveLevels("XAU/USD").some((l) => l.type === "PDH" && l.price === 4317.60)).toBe(true);

    // Candle 1 sweeps PDH with high = 4317.65
    const c1 = makeCandle("2026-09-02T12:01:00Z", 4317.65, 4310.00);
    const sigs1 = signalEngine.evaluateCandle("XAU/USD", c1, null, engine);
    expect(sigs1.length).toBeGreaterThan(0);

    for (const sig of sigs1) {
      await pineAlertPipeline.dispatchSignal(sig);
    }
    expect(telegramSpy).toHaveBeenCalledTimes(1);

    // Verify PDH 4317.60 is now consumed & absent from active levels
    expect(engine.isConsumed({ id: "pdh-4317.60", type: "PDH", price: 4317.60 }, "XAU/USD")).toBe(true);
    expect(engine.getActiveLevels("XAU/USD").some((l) => l.type === "PDH" && l.price === 4317.60)).toBe(false);

    // Subsequent candles with fluctuating highs touching/sweeping 4317.60
    const fluctuatingHighs = [4317.70, 4317.82, 4317.68, 4317.90];
    for (let i = 0; i < fluctuatingHighs.length; i++) {
      const ts = `2026-09-02T12:0${i + 2}:00Z`;
      const c = makeCandle(ts, fluctuatingHighs[i], 4310.00);
      const sigs = signalEngine.evaluateCandle("XAU/USD", c, c1, engine);
      for (const sig of sigs) {
        await pineAlertPipeline.dispatchSignal(sig);
      }
    }

    // Total Telegram alerts MUST remain exactly 1!
    expect(telegramSpy).toHaveBeenCalledTimes(1);
  });

  it("TEST B — DEDUPE KEY: TelegramDedupeGuard uses level price, ignoring triggerPrice variations", () => {
    const key1 = telegramDedupeGuard.buildKey("XAU/USD", "LIQUIDITY_SWEEP", "PDH", 4317.60, "SELL");
    const key2 = telegramDedupeGuard.buildKey("XAU/USD", "LIQUIDITY_SWEEP", "PDH", 4317.60, "SELL");

    expect(key1).toBe(key2);

    expect(telegramDedupeGuard.shouldSend(key1)).toBe(true);
    // Second call within 15m window must return false (suppressed)
    expect(telegramDedupeGuard.shouldSend(key2)).toBe(false);
  });

  it("TEST C — NEW PDH: A genuinely new day's PDH can alert once after old PDH was consumed", async () => {
    const telegramSpy = vi.spyOn(TelegramClient, "sendTelegramMessage").mockResolvedValue({ sent: true });

    // Day 1: High = 4317.60 -> PDH for Day 2 = 4317.60
    engine.processCandle(makeCandle("2026-09-01T00:00:00Z", 4317.60, 4200.00));

    // Day 2: High = 4350.00 -> sweeps Day 1 PDH (4317.60) & sets Day 2 High = 4350.00
    const day2Sweep = makeCandle("2026-09-02T00:00:00Z", 4350.00, 4250.00);
    engine.processCandle(day2Sweep);
    const sigsDay2 = signalEngine.evaluateCandle("XAU/USD", day2Sweep, null, engine);
    for (const sig of sigsDay2) {
      await pineAlertPipeline.dispatchSignal(sig);
    }
    expect(telegramSpy).toHaveBeenCalledTimes(1);
    expect(engine.isConsumed({ id: "pdh-4317.60", type: "PDH", price: 4317.60 }, "XAU/USD")).toBe(true);

    // Day 3 starts (2026-09-03): New PDH is 4350.00 (from Day 2)
    const day3Candle1 = makeCandle("2026-09-03T00:00:00Z", 4340.00, 4300.00);
    engine.processCandle(day3Candle1);

    // Verify old PDH (4317.60) is NOT active, but new PDH (4350.00) IS active
    const activeDay3 = engine.getActiveLevels("XAU/USD");
    expect(activeDay3.some((l) => l.type === "PDH" && l.price === 4317.60)).toBe(false);
    expect(activeDay3.some((l) => l.type === "PDH" && l.price === 4350.00)).toBe(true);

    // Touch new PDH (4350.00)
    const day3Sweep = makeCandle("2026-09-03T12:00:00Z", 4350.05, 4340.00);
    engine.processCandle(day3Sweep);
    const sigsDay3 = signalEngine.evaluateCandle("XAU/USD", day3Sweep, day3Candle1, engine);
    for (const sig of sigsDay3) {
      await pineAlertPipeline.dispatchSignal(sig);
    }

    // Exactly 2 total alerts (1 for old PDH 4317.60, 1 for new PDH 4350.00)
    expect(telegramSpy).toHaveBeenCalledTimes(2);
  });

  it("TEST D — LIVE TOUCH REGRESSION: PineAlertBridge live touch generates 1 alert & consumes level", async () => {
    const telegramSpy = vi.spyOn(TelegramClient, "sendTelegramMessage").mockResolvedValue({ sent: true });

    engine.processCandle(makeCandle("2026-09-01T00:00:00Z", 4317.60, 4200.00));
    engine.processCandle(makeCandle("2026-09-02T00:00:00Z", 4310.00, 4250.00));

    const alerts1 = bridge.checkLivePrice("XAU/USD", 4317.60, "2026-09-02T12:00:00Z");
    expect(alerts1.length).toBe(1);
    expect(telegramSpy).toHaveBeenCalledTimes(1);

    const alerts2 = bridge.checkLivePrice("XAU/USD", 4317.60, "2026-09-02T12:00:05Z");
    expect(alerts2.length).toBe(0);
    expect(telegramSpy).toHaveBeenCalledTimes(1);

    expect(engine.getActiveLevels("XAU/USD").some((l) => l.price === 4317.60)).toBe(false);
  });

  it("TEST E — MISSED WICK REGRESSION: Completed 1M candle wick touch generates 1 alert & consumes level", async () => {
    const telegramSpy = vi.spyOn(TelegramClient, "sendTelegramMessage").mockResolvedValue({ sent: true });

    engine.processCandle(makeCandle("2026-09-01T00:00:00Z", 4317.60, 4200.00));
    engine.processCandle(makeCandle("2026-09-02T00:00:00Z", 4310.00, 4250.00));

    const missedCandle = makeCandle("2026-09-02T12:00:00Z", 4318.00, 4310.00);
    const alerts = bridge.evaluateCandleWick("XAU/USD", missedCandle, "2026-09-02T12:00:00Z");

    expect(alerts.length).toBe(1);
    expect(telegramSpy).toHaveBeenCalledTimes(1);
    expect(engine.getActiveLevels("XAU/USD").some((l) => l.price === 4317.60)).toBe(false);
  });

  it("TEST F — WEEKEND REGRESSION: XAU weekend suppression suppresses live touch alerts", () => {
    const saturdayTs = "2026-09-12T12:00:00Z";
    expect(isXauWeekend(saturdayTs)).toBe(true);

    engine.processCandle(makeCandle("2026-09-01T00:00:00Z", 4317.60, 4200.00));
    engine.processCandle(makeCandle("2026-09-02T00:00:00Z", 4310.00, 4250.00));

    const alerts = bridge.checkLivePrice("XAU/USD", 4317.60, saturdayTs);
    expect(alerts.length).toBe(0);
  });

  it("TEST G — BTC REGRESSION: BTC/USD alert behavior remains fully functional", async () => {
    const telegramSpy = vi.spyOn(TelegramClient, "sendTelegramMessage").mockResolvedValue({ sent: true });
    (engine as any).swhPrices = [95000];
    (engine as any).swhTexts = ["15M+ Swing High"];

    const btcAlerts = bridge.checkLivePrice("BTC/USD", 95000, "2026-09-12T12:00:00Z");
    expect(btcAlerts.length).toBe(1);
    expect(telegramSpy).toHaveBeenCalledTimes(1);
  });
});
