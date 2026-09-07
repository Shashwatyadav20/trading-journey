import { describe, it, expect, beforeEach, vi } from "vitest";
import { PineLiquidityEngine } from "../PineLiquidityEngine";
import { PineAlertBridge } from "../PineAlertBridge";
import { ActiveLevel, Candle } from "../PineTypes";
import * as TelegramClient from "../../telegram/TelegramClient";

describe("Real-Time Pine Level Touch Alerts (Requirement 10 Test Suite)", () => {
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
  });

  const nowIso = "2026-09-07T13:15:00.000Z";

  const swhLevel: ActiveLevel = {
    id: "swh-0-80564.24",
    type: "SWH",
    label: "15M+ Swing High  80564.24",
    price: 80564.24,
    timeframe: "15M+",
    color: "#84cc16",
    lineStyle: "dotted",
    lineWidth: 2,
    createdAtBar: 1,
  };

  const swlLevel: ActiveLevel = {
    id: "swl-0-78626.00",
    type: "SWL",
    label: "15M+ Swing Low  78626.00",
    price: 78626.00,
    timeframe: "15M+",
    color: "#ef4444",
    lineStyle: "dotted",
    lineWidth: 2,
    createdAtBar: 1,
  };

  // ─── TEST A: Resistance Touch ──────────────────────────────────────────────
  it("A: emits LEVEL_TOUCHED when price crosses resistance level from below (80560 -> 80565 >= 80564.24)", () => {
    btcEngine.getActiveLevels = () => [swhLevel];

    // Tick 1: previous price 80560
    bridge.checkLivePrice("BTC/USD", 80560, nowIso);

    // Tick 2: current price 80565 (touches/crosses 80564.24)
    const alerts = bridge.checkLivePrice("BTC/USD", 80565, nowIso);

    expect(alerts.length).toBe(1);
    expect(alerts[0].event).toBe("LEVEL_TOUCHED");
    expect(alerts[0].levelPrice).toBe(80564.24);
    expect(alerts[0].marketPrice).toBe(80565);
    expect(alerts[0].instrument).toBe("BTC/USD");
  });

  // ─── TEST B: Resistance No Touch ───────────────────────────────────────────
  it("B: does NOT emit LEVEL_TOUCHED when price remains below resistance (80560 -> 80562 < 80564.24)", () => {
    btcEngine.getActiveLevels = () => [swhLevel];

    bridge.checkLivePrice("BTC/USD", 80560, nowIso);
    const alerts = bridge.checkLivePrice("BTC/USD", 80562, nowIso);

    expect(alerts.length).toBe(0);
  });

  // ─── TEST C: Support Touch ─────────────────────────────────────────────────
  it("C: emits LEVEL_TOUCHED when price crosses support level from above (78630 -> 78625 <= 78626.00)", () => {
    btcEngine.getActiveLevels = () => [swlLevel];

    bridge.checkLivePrice("BTC/USD", 78630, nowIso);
    const alerts = bridge.checkLivePrice("BTC/USD", 78625, nowIso);

    expect(alerts.length).toBe(1);
    expect(alerts[0].event).toBe("LEVEL_TOUCHED");
    expect(alerts[0].levelPrice).toBe(78626.00);
    expect(alerts[0].marketPrice).toBe(78625);
    expect(alerts[0].instrument).toBe("BTC/USD");
  });

  // ─── TEST D: Repeated Ticks Around Same Level ──────────────────────────────
  it("D: sends Telegram only once when repeated ticks remain at/around touched level", () => {
    btcEngine.getActiveLevels = () => [swhLevel];

    bridge.checkLivePrice("BTC/USD", 80560, nowIso);
    const alert1 = bridge.checkLivePrice("BTC/USD", 80565, nowIso);
    expect(alert1.length).toBe(1);

    // Further ticks staying above/at level
    const alert2 = bridge.checkLivePrice("BTC/USD", 80566, nowIso);
    const alert3 = bridge.checkLivePrice("BTC/USD", 80564.50, nowIso);
    const alert4 = bridge.checkLivePrice("BTC/USD", 80565.00, nowIso);

    expect(alert2.length).toBe(0);
    expect(alert3.length).toBe(0);
    expect(alert4.length).toBe(0);
    expect(bridge.getLevelTouchState("BTC/USD", swhLevel.id)).toBe("triggered");
  });

  // ─── TEST E: Price Moves Away ──────────────────────────────────────────────
  it("E: re-arms level when price moves clearly away from touched resistance level", () => {
    btcEngine.getActiveLevels = () => [swhLevel];

    bridge.checkLivePrice("BTC/USD", 80560, nowIso);
    bridge.checkLivePrice("BTC/USD", 80565, nowIso); // triggered
    expect(bridge.getLevelTouchState("BTC/USD", swhLevel.id)).toBe("triggered");

    // Price moves back down below resistance (80560 < 80564.24)
    bridge.checkLivePrice("BTC/USD", 80560, nowIso);
    expect(bridge.getLevelTouchState("BTC/USD", swhLevel.id)).toBe("armed");
  });

  // ─── TEST F: Price Returns ─────────────────────────────────────────────────
  it("F: allows second LEVEL_TOUCHED event when price moves away and returns to level", () => {
    btcEngine.getActiveLevels = () => [swhLevel];

    // First touch
    bridge.checkLivePrice("BTC/USD", 80560, nowIso);
    const alert1 = bridge.checkLivePrice("BTC/USD", 80565, nowIso);
    expect(alert1.length).toBe(1);

    // Moves away -> re-arms
    bridge.checkLivePrice("BTC/USD", 80560, nowIso);
    expect(bridge.getLevelTouchState("BTC/USD", swhLevel.id)).toBe("armed");

    // Returns to level -> second alert
    const alert2 = bridge.checkLivePrice("BTC/USD", 80565, nowIso);
    expect(alert2.length).toBe(1);
    expect(alert2[0].event).toBe("LEVEL_TOUCHED");
  });

  // ─── TEST G: Multiple Levels ───────────────────────────────────────────────
  it("G: handles multiple active levels and generates independent events for each touched level", () => {
    const swh2: ActiveLevel = {
      id: "swh-1-80600.00",
      type: "SWH",
      label: "15M+ Swing High  80600.00",
      price: 80600.00,
      timeframe: "15M+",
      color: "#84cc16",
      lineStyle: "dotted",
      lineWidth: 2,
      createdAtBar: 1,
    };

    btcEngine.getActiveLevels = () => [swhLevel, swh2];

    bridge.checkLivePrice("BTC/USD", 80560, nowIso);

    // Crosses swhLevel (80564.24) but not swh2 (80600.00)
    const alert1 = bridge.checkLivePrice("BTC/USD", 80570, nowIso);
    expect(alert1.length).toBe(1);
    expect(alert1[0].levelPrice).toBe(80564.24);

    // Crosses swh2 (80600.00)
    const alert2 = bridge.checkLivePrice("BTC/USD", 80605, nowIso);
    expect(alert2.length).toBe(1);
    expect(alert2[0].levelPrice).toBe(80600.00);
  });

  // ─── TEST H: Active Level Only ─────────────────────────────────────────────
  it("H: produces NO event for inactive or removed levels", () => {
    // Start with swhLevel active
    btcEngine.getActiveLevels = () => [swhLevel];
    bridge.checkLivePrice("BTC/USD", 80560, nowIso);

    // Level is removed/invalidated by Pine engine
    btcEngine.getActiveLevels = () => [];

    const alert = bridge.checkLivePrice("BTC/USD", 80565, nowIso);
    expect(alert.length).toBe(0);
  });

  // ─── TEST I: Pine State Immutability ───────────────────────────────────────
  it("I: touch detection is strictly read-only and does not mutate Pine Liquidity Engine state", () => {
    const originalEqhPrices = [100.0];
    const originalEqhTexts = ["HTF EQH (15M)"];
    const originalSwhPrices = [105.0];
    const originalSwhTexts = ["15M+ Swing High"];

    (btcEngine as any).eqhPrices = [...originalEqhPrices];
    (btcEngine as any).eqhTexts = [...originalEqhTexts];
    (btcEngine as any).swhPrices = [...originalSwhPrices];
    (btcEngine as any).swhTexts = [...originalSwhTexts];

    const snapshotBefore = JSON.stringify(btcEngine.getActiveLevels());

    bridge.checkLivePrice("BTC/USD", 100.0, nowIso);
    bridge.checkLivePrice("BTC/USD", 105.0, nowIso);

    const snapshotAfter = JSON.stringify(btcEngine.getActiveLevels());

    expect((btcEngine as any).eqhPrices).toEqual(originalEqhPrices);
    expect((btcEngine as any).eqhTexts).toEqual(originalEqhTexts);
    expect((btcEngine as any).swhPrices).toEqual(originalSwhPrices);
    expect((btcEngine as any).swhTexts).toEqual(originalSwhTexts);
    expect(snapshotAfter).toEqual(snapshotBefore);
  });

  // ─── TEST J: No Auto Trading ───────────────────────────────────────────────
  it("J: level touch event creates NO trade, order, or position modification", () => {
    const spySendTelegram = vi.spyOn(TelegramClient, "sendTelegramMessage").mockResolvedValue({ sent: true });

    btcEngine.getActiveLevels = () => [swhLevel];

    bridge.checkLivePrice("BTC/USD", 80560, nowIso);
    const alerts = bridge.checkLivePrice("BTC/USD", 80565, nowIso);

    expect(alerts.length).toBe(1);
    expect(spySendTelegram).toHaveBeenCalledTimes(1);

    // Verify message is purely analytical alert format
    const sentMessage = spySendTelegram.mock.calls[0][0];
    expect(sentMessage).toContain("Trading Journey — Pine Level Touched");
    expect(sentMessage).toContain("Instrument: BTC/USD");
    expect(sentMessage).toContain("Event: LEVEL_TOUCHED");
    expect(sentMessage).not.toContain("BUY");
    expect(sentMessage).not.toContain("SELL");
    expect(sentMessage).not.toContain("ORDER");
    expect(sentMessage).not.toContain("POSITION");
  });

  // ─── TEST K: Both Instruments (BTC/USD & XAU/USD) ─────────────────────────
  it("K: supports both BTC/USD and XAU/USD independently", () => {
    const xauSwh: ActiveLevel = {
      id: "swh-xau-2500.00",
      type: "SWH",
      label: "15M+ Swing High  2500.00",
      price: 2500.00,
      timeframe: "15M+",
      color: "#84cc16",
      lineStyle: "dotted",
      lineWidth: 2,
      createdAtBar: 1,
    };

    btcEngine.getActiveLevels = () => [swhLevel];
    xauEngine.getActiveLevels = () => [xauSwh];

    // BTC tick touch
    bridge.checkLivePrice("BTC/USD", 80560, nowIso);
    const btcAlerts = bridge.checkLivePrice("BTC/USD", 80565, nowIso);
    expect(btcAlerts.length).toBe(1);
    expect(btcAlerts[0].instrument).toBe("BTC/USD");

    // XAU tick touch
    bridge.checkLivePrice("XAU/USD", 2490.0, nowIso);
    const xauAlerts = bridge.checkLivePrice("XAU/USD", 2501.0, nowIso);
    expect(xauAlerts.length).toBe(1);
    expect(xauAlerts[0].instrument).toBe("XAU/USD");
    expect(xauAlerts[0].levelPrice).toBe(2500.00);
  });
});
