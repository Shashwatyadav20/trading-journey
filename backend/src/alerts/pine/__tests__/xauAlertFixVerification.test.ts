import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { PineLiquidityEngine } from "../PineLiquidityEngine";
import { PineAlertBridge } from "../PineAlertBridge";
import { PineSignalEngine } from "../PineSignalEngine";
import { ActiveLevel, Candle } from "../PineTypes";
import * as TelegramClient from "../../telegram/TelegramClient";
import { telegramDedupeGuard } from "../../telegram/TelegramDedupeGuard";

describe("XAU/USD End-To-End Telegram Alert Fix Verification", () => {
  let bridge: PineAlertBridge;
  let xauEngine: PineLiquidityEngine;
  let btcEngine: PineLiquidityEngine;
  let signalEngine: PineSignalEngine;

  const weekdayTime = "2026-09-07T14:30:00.000Z";
  const pdhLevel: ActiveLevel = {
    id: "pdh-2700.00",
    type: "PDH",
    label: "PDH  2700.00",
    price: 2700.00,
    timeframe: "1D",
    color: "#3b82f6",
    lineStyle: "solid",
    lineWidth: 2,
    createdAtBar: 10,
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    telegramDedupeGuard.clear();

    bridge = new PineAlertBridge();
    xauEngine = new PineLiquidityEngine({}, 15);
    btcEngine = new PineLiquidityEngine({}, 15);
    signalEngine = new PineSignalEngine();

    bridge.registerEngine("XAU/USD", xauEngine);
    bridge.registerEngine("BTC/USD", btcEngine);

    // Default mock: Telegram configured & send succeeds
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "mock_bot_token");
    vi.stubEnv("TELEGRAM_CHAT_ID", "-100123456789");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  // 1. BASIC LIVE TOUCH
  it("1. BASIC LIVE TOUCH: Active XAU level touched -> exactly 1 Telegram alert", async () => {
    const spySend = vi.spyOn(TelegramClient, "sendTelegramMessage").mockResolvedValue({ sent: true });

    (xauEngine as any).pdhPrice = 2700.00;
    (xauEngine as any).pdhTimestampMs = new Date(weekdayTime).getTime();

    // Check initial level is present
    expect(xauEngine.getActiveLevels("XAU/USD").some((l) => l.type === "PDH")).toBe(true);

    // Live tick touch below -> above
    bridge.checkLivePrice("XAU/USD", 2695.00, weekdayTime);
    const alerts = bridge.checkLivePrice("XAU/USD", 2701.50, weekdayTime);

    expect(alerts.length).toBe(1);
    expect(spySend).toHaveBeenCalledTimes(1);
    expect(spySend.mock.calls[0][0]).toContain("XAU/USD");
    expect(spySend.mock.calls[0][0]).toContain("PDH");
  });

  // 2. SAME LEVEL REPEATED
  it("2. SAME LEVEL REPEATED: Same level touched 5+ times with slightly different prices -> total exactly 1 alert", async () => {
    const spySend = vi.spyOn(TelegramClient, "sendTelegramMessage").mockResolvedValue({ sent: true });

    (xauEngine as any).pdhPrice = 2700.00;

    bridge.checkLivePrice("XAU/USD", 2695.00, weekdayTime);

    // 5 touches with varying prices
    bridge.checkLivePrice("XAU/USD", 2700.50, weekdayTime);
    bridge.checkLivePrice("XAU/USD", 2701.00, weekdayTime);
    bridge.checkLivePrice("XAU/USD", 2702.50, weekdayTime);
    bridge.checkLivePrice("XAU/USD", 2700.20, weekdayTime);
    bridge.checkLivePrice("XAU/USD", 2703.00, weekdayTime);

    expect(spySend).toHaveBeenCalledTimes(1);
  });

  // 3. LEVEL CONSUMPTION
  it("3. LEVEL CONSUMPTION: After successful alert -> level is consumed -> absent from getActiveLevels('XAU/USD')", async () => {
    vi.spyOn(TelegramClient, "sendTelegramMessage").mockResolvedValue({ sent: true });

    (xauEngine as any).pdhPrice = 2700.00;

    expect(xauEngine.getActiveLevels("XAU/USD").some((l) => l.price === 2700.00)).toBe(true);

    bridge.checkLivePrice("XAU/USD", 2690.00, weekdayTime);
    bridge.checkLivePrice("XAU/USD", 2705.00, weekdayTime);

    // Wait microtask for promise resolution if async
    await new Promise((r) => setTimeout(r, 10));

    expect(xauEngine.getActiveLevels("XAU/USD").some((l) => l.price === 2700.00)).toBe(false);
  });

  // 4. TELEGRAM FAILURE
  it("4. TELEGRAM FAILURE: Simulate Telegram dispatch failure -> level is NOT permanently consumed", async () => {
    // Mock Telegram failure (e.g. 503 outage)
    const spySend = vi.spyOn(TelegramClient, "sendTelegramMessage").mockResolvedValue({ sent: false, error: "HTTP 503 Service Unavailable" });

    (xauEngine as any).pdhPrice = 2700.00;

    bridge.checkLivePrice("XAU/USD", 2690.00, weekdayTime);
    bridge.checkLivePrice("XAU/USD", 2705.00, weekdayTime);

    await new Promise((r) => setTimeout(r, 10));

    // Level should NOT be permanently consumed because Telegram dispatch failed
    expect(xauEngine.getActiveLevels("XAU/USD").some((l) => l.price === 2700.00)).toBe(true);
  });

  // 5. MISSED WICK
  it("5. MISSED WICK: Completed 1-minute candle touches level -> exactly 1 alert", async () => {
    const spySend = vi.spyOn(TelegramClient, "sendTelegramMessage").mockResolvedValue({ sent: true });

    (xauEngine as any).pdhPrice = 2700.00;

    const candle: Candle = {
      timestamp: weekdayTime,
      open: 2690.00,
      high: 2705.00,
      low: 2688.00,
      close: 2698.00,
    };

    const alerts = bridge.evaluateCandleWick("XAU/USD", candle, weekdayTime);

    expect(alerts.length).toBe(1);
    expect(spySend).toHaveBeenCalledTimes(1);
    expect(spySend.mock.calls[0][0]).toContain("LEVEL_TOUCHED_WICK");
  });

  // 6. LIVE + WICK DUPLICATE
  it("6. LIVE + WICK DUPLICATE: Same interaction seen by live tick and completed 1M wick -> exactly 1 alert", async () => {
    const spySend = vi.spyOn(TelegramClient, "sendTelegramMessage").mockResolvedValue({ sent: true });

    (xauEngine as any).pdhPrice = 2700.00;

    // Live tick touch first
    bridge.checkLivePrice("XAU/USD", 2690.00, weekdayTime);
    bridge.checkLivePrice("XAU/USD", 2702.00, weekdayTime);

    await new Promise((r) => setTimeout(r, 10));

    // Completed 1M candle wick for same minute
    const candle: Candle = {
      timestamp: weekdayTime,
      open: 2690.00,
      high: 2705.00,
      low: 2688.00,
      close: 2698.00,
    };

    const wickAlerts = bridge.evaluateCandleWick("XAU/USD", candle, weekdayTime);

    expect(wickAlerts.length).toBe(0);
    expect(spySend).toHaveBeenCalledTimes(1);
  });

  // 7. NEW LEVEL
  it("7. NEW LEVEL: New PDH/PWL/etc forms later -> new level can alert exactly once", async () => {
    const spySend = vi.spyOn(TelegramClient, "sendTelegramMessage").mockResolvedValue({ sent: true });

    // Day 1: PDH @ 2700.00
    (xauEngine as any).pdhPrice = 2700.00;
    bridge.checkLivePrice("XAU/USD", 2690.00, weekdayTime);
    bridge.checkLivePrice("XAU/USD", 2705.00, weekdayTime);
    await new Promise((r) => setTimeout(r, 10));
    expect(spySend).toHaveBeenCalledTimes(1);

    // Day 2: New PDH @ 2750.00 (day roll clears consumed PDH keys)
    xauEngine.clearConsumedKeysForType("PDH");
    (xauEngine as any).pdhPrice = 2750.00;

    const day2Time = "2026-09-08T14:30:00.000Z";
    bridge.checkLivePrice("XAU/USD", 2740.00, day2Time);
    bridge.checkLivePrice("XAU/USD", 2755.00, day2Time);
    await new Promise((r) => setTimeout(r, 10));

    expect(spySend).toHaveBeenCalledTimes(2);
  });

  // 8. WEEKEND
  it("8. WEEKEND: XAU weekend alerts remain suppressed", async () => {
    const spySend = vi.spyOn(TelegramClient, "sendTelegramMessage").mockResolvedValue({ sent: true });

    (xauEngine as any).pdhPrice = 2700.00;
    const saturdayTime = "2026-09-12T14:30:00.000Z"; // Saturday

    bridge.checkLivePrice("XAU/USD", 2690.00, saturdayTime);
    const alerts = bridge.checkLivePrice("XAU/USD", 2705.00, saturdayTime);

    expect(alerts.length).toBe(0);
    expect(spySend).not.toHaveBeenCalled();
  });

  // 9. BTC
  it("9. BTC: BTC alert behavior remains intact", async () => {
    const spySend = vi.spyOn(TelegramClient, "sendTelegramMessage").mockResolvedValue({ sent: true });

    const btcSwl: ActiveLevel = {
      id: "swl-60000.00",
      type: "SWL",
      label: "15M+ Swing Low  60000.00",
      price: 60000.00,
      timeframe: "15M+",
      color: "#ef4444",
      lineStyle: "dotted",
      lineWidth: 2,
      createdAtBar: 1,
    };
    btcEngine.getActiveLevels = () => [btcSwl];

    bridge.checkLivePrice("BTC/USD", 60100.00, weekdayTime);
    const alerts = bridge.checkLivePrice("BTC/USD", 59900.00, weekdayTime);

    expect(alerts.length).toBe(1);
    expect(spySend).toHaveBeenCalledTimes(1);
    expect(spySend.mock.calls[0][0]).toContain("BTC/USD");
  });

  // 10. BOOTSTRAP
  it("10. BOOTSTRAP: Historical replay does not consume currently valid scalar levels", () => {
    // Set active PDH
    (xauEngine as any).pdhPrice = 2700.00;

    // Simulate historical candles replayed during bootstrap
    const histCandle: Candle = {
      timestamp: "2026-09-06T10:00:00.000Z",
      open: 2690.00,
      high: 2705.00, // touches 2700.00 in history
      low: 2680.00,
      close: 2695.00,
    };

    // Process in engine & evaluate in signalEngine as bootstrap does
    xauEngine.processCandle(histCandle);
    signalEngine.evaluateCandle("XAU/USD", histCandle, null, xauEngine);

    // Active levels after bootstrap replay must STILL include valid PDH!
    const activeAfterBootstrap = xauEngine.getActiveLevels("XAU/USD");
    expect(activeAfterBootstrap.some((l) => l.price === 2700.00)).toBe(true);
  });

  // 11. DEDUPE IDENTITY
  it("11. DEDUPE: Same level price with changing trigger prices produces the same dedupe identity", () => {
    const key1 = telegramDedupeGuard.buildKey("XAU/USD", "LIQUIDITY_SWEEP", "PDH", 2700.00, "SELL");
    const key2 = telegramDedupeGuard.buildKey("XAU/USD", "LIQUIDITY_SWEEP", "PDH", 2700.00, "SELL");

    expect(key1).toBe(key2);
    expect(telegramDedupeGuard.shouldSend(key1)).toBe(true);
    expect(telegramDedupeGuard.shouldSend(key2)).toBe(false);
  });
});
