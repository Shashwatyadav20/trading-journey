import { describe, it, expect, beforeEach, vi } from "vitest";
import { PineLiquidityEngine } from "../PineLiquidityEngine";
import { PineAlertBridge } from "../PineAlertBridge";
import { PineLevelService } from "../../PineLevelService";
import { ActiveLevel, Candle } from "../PineTypes";
import * as TelegramClient from "../../telegram/TelegramClient";
import { marketDataService } from "../../../market/MarketDataService";

describe("XAU/USD Missed-Wick Fallback Alert Test Suite (Requirements Audit Fixes)", () => {
  let bridge: PineAlertBridge;
  let btcEngine: PineLiquidityEngine;
  let xauEngine: PineLiquidityEngine;

  beforeEach(() => {
    vi.restoreAllMocks();
    bridge = new PineAlertBridge();
    btcEngine = new PineLiquidityEngine({}, 15);
    xauEngine = new PineLiquidityEngine({}, 15);

    bridge.registerEngine("BTC/USD", btcEngine);
    bridge.registerEngine("XAU/USD", xauEngine);

    const tdProvider = marketDataService.getTwelveDataProvider();
    (tdProvider as any).apiKey = "mock_api_key";
  });

  const minute1Iso = "2026-09-07T13:15:00.000Z"; // Closed minute 1
  const minute2Iso = "2026-09-07T13:16:00.000Z"; // Closed minute 2

  const xauResistanceLevel: ActiveLevel = {
    id: "eqh-0-4348.57",
    type: "EQH",
    label: "HTF EQH (15M)  4348.57",
    price: 4348.57,
    timeframe: "15M",
    color: "#84cc16",
    lineStyle: "solid",
    lineWidth: 2,
    createdAtBar: 1,
  };

  const xauSupportLevel: ActiveLevel = {
    id: "swl-0-4348.30",
    type: "SWL",
    label: "15M+ Swing Low  4348.30",
    price: 4348.30,
    timeframe: "15M+",
    color: "#ef4444",
    lineStyle: "dotted",
    lineWidth: 2,
    createdAtBar: 1,
  };

  // ─── TEST A: Twelve Data values[0] forming vs values[1] completed candle selection ─
  it("A: selects values[1] (completed candle) when targetTimestamp matches values[1] and NOT values[0] (forming)", async () => {
    const tdProvider = marketDataService.getTwelveDataProvider();

    // Mock fetch response returning values[0] (forming minute 13:16) and values[1] (completed minute 13:15)
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        status: "ok",
        values: [
          {
            datetime: "2026-09-07 13:16:00", // values[0]: forming bar for 13:16
            open: "4348.40",
            high: "4348.99",
            low: "4348.30",
            close: "4348.80",
            volume: "100",
          },
          {
            datetime: "2026-09-07 13:15:00", // values[1]: completed bar for 13:15
            open: "4348.30",
            high: "4348.60",
            low: "4348.20",
            close: "4348.50",
            volume: "150",
          },
        ],
      }),
    } as any);

    // Reset 50s rate limit guard for unit test execution
    (tdProvider as any).last1MinFetchMs = 0;

    // Request the completed minute 13:15 timestamp
    const candle = await tdProvider.fetchLatestOneMinuteCandle(minute1Iso);

    expect(candle).not.toBeNull();
    expect(candle?.timestamp).toBe(minute1Iso);
    expect(candle?.high).toBe(4348.60); // Selected values[1], NOT values[0] (4348.99)
  });

  // ─── TEST B: Exact target timestamp match ────────────────────────────────────
  it("B: exact target timestamp match selects matching candle from returned series", async () => {
    const tdProvider = marketDataService.getTwelveDataProvider();

    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        status: "ok",
        values: [
          {
            datetime: "2026-09-07 13:16:00",
            open: "4348.40",
            high: "4348.50",
            low: "4348.30",
            close: "4348.45",
          },
          {
            datetime: "2026-09-07 13:15:00",
            open: "4348.20",
            high: "4348.65",
            low: "4348.10",
            close: "4348.30",
          },
        ],
      }),
    } as any);

    (tdProvider as any).last1MinFetchMs = 0;
    const candle = await tdProvider.fetchLatestOneMinuteCandle(minute1Iso);
    expect(candle).not.toBeNull();
    expect(candle?.timestamp).toBe(minute1Iso);
    expect(candle?.high).toBe(4348.65);
  });

  // ─── TEST C: Timestamp mismatch -> produces NO candle & NO wick alert ───────
  it("C: timestamp mismatch produces NO candle and NO wick alert", async () => {
    const tdProvider = marketDataService.getTwelveDataProvider();

    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        status: "ok",
        values: [
          {
            datetime: "2026-09-07 13:16:00",
            open: "4348.40",
            high: "4348.90",
            low: "4348.30",
            close: "4348.45",
          },
        ],
      }),
    } as any);

    // Reset 50s rate limit guard for unit test execution
    (tdProvider as any).last1MinFetchMs = 0;

    // Target minute 13:15 is not present in response
    const candle = await tdProvider.fetchLatestOneMinuteCandle(minute1Iso);
    expect(candle).toBeNull(); // Strictly returned null, did NOT fall back to forming candle

    // Evaluating null produces 0 alerts
    const spyTelegram = vi.spyOn(TelegramClient, "sendTelegramMessage").mockResolvedValue({ sent: true });
    xauEngine.getActiveLevels = () => [xauResistanceLevel];
    if (candle) {
      bridge.evaluateCandleWick("XAU/USD", candle, minute1Iso);
    }
    expect(spyTelegram).not.toHaveBeenCalled();
  });

  // ─── TEST D: Intra-minute live tick + pullback/re-arm -> NO duplicate wick alert ──
  it("D: live tick triggers level, price pulls back and re-arms in same minute -> candle wick produces NO duplicate alert", () => {
    const spyTelegram = vi.spyOn(TelegramClient, "sendTelegramMessage").mockResolvedValue({ sent: true });
    xauEngine.getActiveLevels = () => [xauResistanceLevel];

    // 12:00:15 tick: Live tick touches resistance (4348.40 -> 4348.60 >= 4348.57)
    const tick1Ts = "2026-09-07T13:15:15.000Z";
    bridge.checkLivePrice("XAU/USD", 4348.40, tick1Ts);
    const liveAlerts = bridge.checkLivePrice("XAU/USD", 4348.60, tick1Ts);
    expect(liveAlerts.length).toBe(1);
    expect(spyTelegram).toHaveBeenCalledTimes(1);

    // 12:00:45 tick: Price pulls back below resistance (4348.40 < 4348.57) -> re-arms level!
    const tick2Ts = "2026-09-07T13:15:45.000Z";
    bridge.checkLivePrice("XAU/USD", 4348.40, tick2Ts);
    expect(bridge.getLevelTouchState("XAU/USD", xauResistanceLevel.id)).toBe("armed"); // Re-armed!

    // 12:01:05 (minute close): Candle-wick evaluation runs for 13:15 candle (high = 4348.60)
    const candle1315: Candle = {
      timestamp: minute1Iso,
      open: 4348.40,
      high: 4348.60,
      low: 4348.35,
      close: 4348.40,
    };

    const wickAlerts = bridge.evaluateCandleWick("XAU/USD", candle1315, minute1Iso);

    // Duplicate alert MUST be suppressed because minute 13:15 already triggered a live alert!
    expect(wickAlerts.length).toBe(0);
    expect(spyTelegram).toHaveBeenCalledTimes(1); // Still only 1 call!
  });

  // ─── TEST E: Later minute with legitimate new touch -> alert IS allowed ───────
  it("E: later minute with legitimate new touch AFTER re-arm IS allowed", () => {
    const spyTelegram = vi.spyOn(TelegramClient, "sendTelegramMessage").mockResolvedValue({ sent: true });
    xauEngine.getActiveLevels = () => [xauResistanceLevel];

    // Minute 1 live alert
    bridge.checkLivePrice("XAU/USD", 4348.40, "2026-09-07T13:15:15.000Z");
    bridge.checkLivePrice("XAU/USD", 4348.60, "2026-09-07T13:15:15.000Z");
    expect(spyTelegram).toHaveBeenCalledTimes(1);

    // Re-arm on pullback
    bridge.checkLivePrice("XAU/USD", 4348.40, "2026-09-07T13:15:45.000Z");

    // Minute 2 candle (13:16) arrives with a new wick touch (4348.65 >= 4348.57)
    const candle1316: Candle = {
      timestamp: minute2Iso,
      open: 4348.40,
      high: 4348.65,
      low: 4348.35,
      close: 4348.45,
    };

    const wickAlerts = bridge.evaluateCandleWick("XAU/USD", candle1316, minute2Iso);

    expect(wickAlerts.length).toBe(1);
    expect(spyTelegram).toHaveBeenCalledTimes(2); // Second alert for minute 2 allowed!
  });

  // ─── TEST F: Existing basic wick tests pass ──────────────────────────────────
  it("F: basic missed-wick alert (no prior live tick) triggers correctly for resistance and support", () => {
    const spyTelegram = vi.spyOn(TelegramClient, "sendTelegramMessage").mockResolvedValue({ sent: true });

    // Resistance missed-wick
    xauEngine.getActiveLevels = () => [xauResistanceLevel];
    const resCandle: Candle = {
      timestamp: minute1Iso,
      open: 4348.40,
      high: 4348.70,
      low: 4348.35,
      close: 4348.45,
    };
    const resAlerts = bridge.evaluateCandleWick("XAU/USD", resCandle, minute1Iso);
    expect(resAlerts.length).toBe(1);
    expect(resAlerts[0].marketPrice).toBe(4348.70);

    // Support missed-wick
    bridge.resetState();
    xauEngine.getActiveLevels = () => [xauSupportLevel];
    const supCandle: Candle = {
      timestamp: minute1Iso,
      open: 4348.40,
      high: 4348.50,
      low: 4348.20,
      close: 4348.35,
    };
    const supAlerts = bridge.evaluateCandleWick("XAU/USD", supCandle, minute1Iso);
    expect(supAlerts.length).toBe(1);
    expect(supAlerts[0].marketPrice).toBe(4348.20);
  });
});
