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

  // ─── TEST E: Price Moves Away in Subsequent Minute ─────────────────────────
  it("E: re-arms level when price moves clearly away from touched resistance level in a subsequent minute", () => {
    btcEngine.getActiveLevels = () => [swhLevel];

    bridge.checkLivePrice("BTC/USD", 80560, nowIso);
    bridge.checkLivePrice("BTC/USD", 80565, nowIso); // triggered
    expect(bridge.getLevelTouchState("BTC/USD", swhLevel.id)).toBe("triggered");

    // Price moves back down below resistance in next minute (80560 < 80564.24 at 13:16)
    const nextMinIso = "2026-09-07T13:16:00.000Z";
    bridge.checkLivePrice("BTC/USD", 80560, nextMinIso);
    expect(bridge.getLevelTouchState("BTC/USD", swhLevel.id)).toBe("armed");
  });

  // ─── TEST F: Price Returns in Later Minute ─────────────────────────────────
  it("F: allows second LEVEL_TOUCHED event when price moves away and returns to level in a later minute", () => {
    btcEngine.getActiveLevels = () => [swhLevel];

    // First touch (13:15)
    bridge.checkLivePrice("BTC/USD", 80560, nowIso);
    const alert1 = bridge.checkLivePrice("BTC/USD", 80565, nowIso);
    expect(alert1.length).toBe(1);

    // Moves away -> re-arms (13:16)
    const min2Iso = "2026-09-07T13:16:00.000Z";
    bridge.checkLivePrice("BTC/USD", 80560, min2Iso);
    expect(bridge.getLevelTouchState("BTC/USD", swhLevel.id)).toBe("armed");

    // Returns to level -> second alert (13:17)
    const min3Iso = "2026-09-07T13:17:00.000Z";
    const alert2 = bridge.checkLivePrice("BTC/USD", 80565, min3Iso);
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

  // ─── TEST I: Level Touch Retains Active Level ──────────────────────────────────
  it("I: touch detection emits alert while keeping level active in getActiveLevels() for repeated touches", () => {
    const originalEqhPrices = [100.0];
    const originalEqhTexts = ["HTF EQH (15M)"];
    const originalSwhPrices = [105.0];
    const originalSwhTexts = ["15M+ Swing High"];

    (btcEngine as any).eqhPrices = [...originalEqhPrices];
    (btcEngine as any).eqhTexts = [...originalEqhTexts];
    (btcEngine as any).swhPrices = [...originalSwhPrices];
    (btcEngine as any).swhTexts = [...originalSwhTexts];

    const levelsBefore = btcEngine.getActiveLevels();
    expect(levelsBefore.some((l) => l.price === 100.0)).toBe(true);

    bridge.checkLivePrice("BTC/USD", 100.0, nowIso);

    const levelsAfter = btcEngine.getActiveLevels();
    expect(levelsAfter.some((l) => l.price === 100.0)).toBe(true);
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

    // XAU tick touch on weekday
    const weekdayIso = "2026-09-07T13:15:00.000Z";
    bridge.checkLivePrice("XAU/USD", 2490.0, weekdayIso);
    const xauAlerts = bridge.checkLivePrice("XAU/USD", 2501.0, weekdayIso);
    expect(xauAlerts.length).toBe(1);
    expect(xauAlerts[0].instrument).toBe("XAU/USD");
    expect(xauAlerts[0].levelPrice).toBe(2500.00);
  });

  // ─── REGRESSION AUDIT TESTS (Requirements 1 - 6) ─────────────────────────
  describe("Audit Regression Fixes (Weekend XAU + Single Alert Per Level Touch)", () => {
    const pwhXauLevel: ActiveLevel = {
      id: "pwh-2500.00",
      type: "PWH",
      label: "PWH  2500.00",
      price: 2500.00,
      timeframe: "1W",
      color: "#f59e0b",
      lineStyle: "dashed",
      lineWidth: 2,
      createdAtBar: 1,
    };

    // 1. Weekend XAU = no alert
    it("1. Weekend XAU generates zero alerts on Saturday/Sunday", () => {
      xauEngine.getActiveLevels = () => [pwhXauLevel];

      const saturdayIso = "2026-09-12T14:00:00.000Z"; // Sat
      const sundayIso = "2026-09-13T10:00:00.000Z";   // Sun

      bridge.checkLivePrice("XAU/USD", 2495.0, saturdayIso);
      const satAlerts = bridge.checkLivePrice("XAU/USD", 2505.0, saturdayIso);
      expect(satAlerts.length).toBe(0);

      bridge.checkLivePrice("XAU/USD", 2495.0, sundayIso);
      const sunAlerts = bridge.checkLivePrice("XAU/USD", 2505.0, sundayIso);
      expect(sunAlerts.length).toBe(0);
    });

    // 2. Same level remains beyond price = exactly one alert
    it("2. Same level remaining beyond price produces exactly one alert across intra-minute ticks & micro pullbacks", () => {
      xauEngine.getActiveLevels = () => [pwhXauLevel];
      const weekdayIso = "2026-09-07T13:15:05.000Z";

      bridge.checkLivePrice("XAU/USD", 2495.0, weekdayIso);
      const tick1 = bridge.checkLivePrice("XAU/USD", 2502.0, weekdayIso);
      expect(tick1.length).toBe(1);

      // Micro ticks remaining beyond or hovering around level during same minute
      const tick2 = bridge.checkLivePrice("XAU/USD", 2503.0, "2026-09-07T13:15:15.000Z");
      const tick3 = bridge.checkLivePrice("XAU/USD", 2499.8, "2026-09-07T13:15:25.000Z");
      const tick4 = bridge.checkLivePrice("XAU/USD", 2501.5, "2026-09-07T13:15:35.000Z");

      expect(tick2.length).toBe(0);
      expect(tick3.length).toBe(0);
      expect(tick4.length).toBe(0);
      expect(bridge.getLevelTouchState("XAU/USD", pwhXauLevel.id)).toBe("triggered");
    });

    // 3. Level refresh/recalculation does not reset the triggered state
    it("3. Level refresh or index recalculation does not reset triggered state", () => {
      const initialSwh: ActiveLevel = {
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

      btcEngine.getActiveLevels = () => [initialSwh];
      bridge.checkLivePrice("BTC/USD", 80560, nowIso);
      const alert1 = bridge.checkLivePrice("BTC/USD", 80565, nowIso);
      expect(alert1.length).toBe(1);
      expect(bridge.getLevelTouchState("BTC/USD", "swh-0-80564.24")).toBe("triggered");

      // Engine recalculates levels: index shifted to swh-1-80564.24
      const recalculatedSwh: ActiveLevel = {
        ...initialSwh,
        id: "swh-1-80564.24",
      };
      btcEngine.getActiveLevels = () => [recalculatedSwh];

      // Subsequent tick should NOT re-trigger alert
      const tickAfterRecalc = bridge.checkLivePrice("BTC/USD", 80566, nowIso);
      expect(tickAfterRecalc.length).toBe(0);
      expect(bridge.getLevelTouchState("BTC/USD", "swh-1-80564.24")).toBe("triggered");
    });

    // 4. Legitimate later re-arm + new touch = one new alert
    it("4. Legitimate later re-arm in a subsequent minute followed by a new touch produces exactly one new alert", () => {
      xauEngine.getActiveLevels = () => [pwhXauLevel];

      // Minute 1: initial touch
      bridge.checkLivePrice("XAU/USD", 2495.0, "2026-09-07T13:15:05.000Z");
      const alert1 = bridge.checkLivePrice("XAU/USD", 2502.0, "2026-09-07T13:15:15.000Z");
      expect(alert1.length).toBe(1);

      // Minute 2: price moves clearly below resistance -> re-arms
      bridge.checkLivePrice("XAU/USD", 2490.0, "2026-09-07T13:16:10.000Z");
      expect(bridge.getLevelTouchState("XAU/USD", pwhXauLevel.id)).toBe("armed");

      // Minute 3: new touch -> exactly 1 new alert
      const alert2 = bridge.checkLivePrice("XAU/USD", 2503.0, "2026-09-07T13:17:05.000Z");
      expect(alert2.length).toBe(1);
      expect(alert2[0].event).toBe("LEVEL_TOUCHED");
    });

    // 5. Existing XAU missed-wick behavior remains valid
    it("5. XAU missed-wick evaluation on weekdays remains valid and suppresses duplicates", () => {
      xauEngine.getActiveLevels = () => [pwhXauLevel];
      const weekdayMinute = "2026-09-07T13:15:00.000Z";

      // Live tick triggers level
      bridge.checkLivePrice("XAU/USD", 2495.0, "2026-09-07T13:15:10.000Z");
      bridge.checkLivePrice("XAU/USD", 2502.0, "2026-09-07T13:15:20.000Z");

      // Completed candle evaluation for exact same minute bucket
      const candle: Candle = {
        timestamp: weekdayMinute,
        open: 2495.0,
        high: 2503.0,
        low: 2494.0,
        close: 2501.0,
      };

      const wickAlerts = bridge.evaluateCandleWick("XAU/USD", candle, weekdayMinute);
      expect(wickAlerts.length).toBe(0); // Suppressed as expected
    });

    // 6. BTC existing behavior remains unchanged
    it("6. BTC existing behavior (including weekend activity) remains completely unchanged", () => {
      btcEngine.getActiveLevels = () => [swhLevel];
      const satIso = "2026-09-12T14:00:00.000Z";

      bridge.checkLivePrice("BTC/USD", 80560, satIso);
      const btcSatAlerts = bridge.checkLivePrice("BTC/USD", 80565, satIso);
      expect(btcSatAlerts.length).toBe(1);
      expect(btcSatAlerts[0].instrument).toBe("BTC/USD");
    });
  });
});
