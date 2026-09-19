import { describe, it, expect, beforeEach, vi } from "vitest";
import { PineLiquidityEngine } from "../PineLiquidityEngine";
import { PineAlertBridge } from "../PineAlertBridge";
import { PineLevelService } from "../../PineLevelService";
import { ActiveLevel, Candle } from "../PineTypes";
import * as TelegramClient from "../../telegram/TelegramClient";

describe("BTC/USD Pine Level Touch & Candle Wick Telegram Alert Verification", () => {
  let bridge: PineAlertBridge;
  let btcEngine: PineLiquidityEngine;

  beforeEach(() => {
    vi.restoreAllMocks();
    bridge = new PineAlertBridge();
    btcEngine = new PineLiquidityEngine({}, 15);

    bridge.registerEngine("BTC/USD", btcEngine);

    vi.stubEnv("TELEGRAM_BOT_TOKEN", "mock_bot_token");
    vi.stubEnv("TELEGRAM_CHAT_ID", "-100123456789");
  });

  const sampleTime = "2026-09-19T14:30:00.000Z";

  const pdhLevel: ActiveLevel = {
    id: "pdh-81388.47",
    type: "PDH",
    label: "PDH  81388.47",
    price: 81388.47,
    timeframe: "1D",
    color: "#3b82f6",
    lineStyle: "solid",
    lineWidth: 2,
    createdAtBar: 1,
  };

  const asiaHighLevel: ActiveLevel = {
    id: "asia_h-81720.00",
    type: "ASIA_H",
    label: "Asia High  81720.00",
    price: 81720.00,
    timeframe: "Session",
    color: "#a855f7",
    lineStyle: "dashed",
    lineWidth: 1,
    createdAtBar: 1,
  };

  it("1. BTC/USD Real-time tick touch on PDH generates Telegram alert and consumes level", async () => {
    const spySend = vi.spyOn(TelegramClient, "sendTelegramMessage").mockResolvedValue({ sent: true });

    btcEngine.getActiveLevels = () => [pdhLevel];

    // Tick below -> above
    bridge.checkLivePrice("BTC/USD", 81350.00, sampleTime);
    const alerts = bridge.checkLivePrice("BTC/USD", 81400.00, sampleTime);

    expect(alerts.length).toBe(1);
    expect(alerts[0].instrument).toBe("BTC/USD");
    expect(alerts[0].levelPrice).toBe(81388.47);
    expect(spySend).toHaveBeenCalledTimes(1);
    expect(spySend.mock.calls[0][0]).toContain("BTC/USD");
    expect(spySend.mock.calls[0][0]).toContain("PDH");
  });

  it("2. BTC/USD 1-minute closed candle wick touch on Asia High generates Telegram alert and consumes level", async () => {
    const spySend = vi.spyOn(TelegramClient, "sendTelegramMessage").mockResolvedValue({ sent: true });

    btcEngine.getActiveLevels = () => [asiaHighLevel];

    const candle: Candle = {
      timestamp: sampleTime,
      open: 81650.00,
      high: 81735.00, // Wicks above 81720.00
      low: 81640.00,
      close: 81710.00,
    };

    const alerts = bridge.evaluateCandleWick("BTC/USD", candle, sampleTime);

    expect(alerts.length).toBe(1);
    expect(alerts[0].instrument).toBe("BTC/USD");
    expect(alerts[0].levelPrice).toBe(81720.00);
    expect(spySend).toHaveBeenCalledTimes(1);
    expect(spySend.mock.calls[0][0]).toContain("BTC/USD");
    expect(spySend.mock.calls[0][0]).toContain("Asia High");
    expect(spySend.mock.calls[0][0]).toContain("LEVEL_TOUCHED_WICK");
  });

  it("3. PineLevelService automatically evaluates BTC/USD candle wick on 1M candle close", async () => {
    const spySend = vi.spyOn(TelegramClient, "sendTelegramMessage").mockResolvedValue({ sent: true });

    const service = new PineLevelService();
    const serviceBridge = service.getAlertBridge();

    // Inject active level into BTC engine
    const btcEng = (service as any).engines.get("BTC/USD");
    btcEng.getActiveLevels = () => [asiaHighLevel];

    // Feed market price ticks that form and close a 1-minute candle
    const t1 = "2026-09-19T15:00:05.000Z";
    const t2 = "2026-09-19T15:00:30.000Z";
    const t3 = "2026-09-19T15:01:05.000Z"; // Closes previous candle

    service.handleMarketPrice({ instrument: "BTC/USD", price: 81600.00, timestamp: t1 });
    service.handleMarketPrice({ instrument: "BTC/USD", price: 81750.00, timestamp: t2 }); // high=81750 (touches Asia High 81720)
    service.handleMarketPrice({ instrument: "BTC/USD", price: 81710.00, timestamp: t3 });

    expect(spySend).toHaveBeenCalled();
    const sentMsg = spySend.mock.calls.find((c) => c[0].includes("BTC/USD") && c[0].includes("Asia High"));
    expect(sentMsg).toBeDefined();
  });
});
