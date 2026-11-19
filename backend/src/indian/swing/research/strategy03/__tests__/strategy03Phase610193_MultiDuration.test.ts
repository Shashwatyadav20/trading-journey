import { describe, expect, it } from "vitest";
import type { FourHourCandle } from "../prebreakout/Strategy03FourHourCandleProvider.js";
import { evaluateFourHourPreBreakout } from "../prebreakout/Strategy03FourHourPreBreakoutScanner.js";

function buildMultiDuration4h(consBars: number, rangeHigh = 108, rangeLow = 106, withHolidayGap = false): FourHourCandle[] {
  const base: FourHourCandle[] = Array.from({ length: 18 }, (_, i) => ({
    timeframe: "4H",
    timestamp: new Date(Date.UTC(2026, 9, 10 + Math.floor(i / 2), i % 2 === 0 ? 4 : 8, 15)).toISOString(),
    open: 100,
    high: 100.8,
    low: 99.5,
    close: 100.1,
    volume: 50_000,
    isComplete: true,
    constituentBarCount: i % 2 === 0 ? 4 : 3,
  }));
  base[13] = { ...base[13], low: 99.5, close: 100.3 };
  base[15] = { ...base[15], low: 99.6, close: 100.2 };

  const obBar: FourHourCandle = {
    timeframe: "4H",
    timestamp: "2026-10-22T04:15:00.000Z",
    open: 100.2,
    high: 100.4,
    low: 99.0,
    close: 99.3,
    volume: 65_000,
    isComplete: true,
    constituentBarCount: 4,
  };
  const imp: FourHourCandle[] = [
    { timeframe: "4H", timestamp: "2026-10-22T08:15:00.000Z", open: 99.3, high: 102.5, low: 99.2, close: 102.2, volume: 110_000, isComplete: true, constituentBarCount: 3 },
    { timeframe: "4H", timestamp: "2026-10-23T04:15:00.000Z", open: 102.2, high: 105.2, low: 102.0, close: 104.8, volume: 120_000, isComplete: true, constituentBarCount: 4 },
    { timeframe: "4H", timestamp: "2026-10-23T08:15:00.000Z", open: 104.8, high: 107.6, low: 104.5, close: 107.2, volume: 115_000, isComplete: true, constituentBarCount: 3 },
  ];

  const cons: FourHourCandle[] = Array.from({ length: consBars }, (_, i) => {
    const dayOffset = withHolidayGap && i >= 2 ? 4 + Math.floor(i / 2) : Math.floor(i / 2);
    return {
      timeframe: "4H",
      timestamp: new Date(Date.UTC(2026, 9, 26 + dayOffset, i % 2 === 0 ? 4 : 8, 15)).toISOString(),
      open: (rangeHigh + rangeLow) / 2,
      high: rangeHigh,
      low: rangeLow,
      close: rangeHigh - 0.8,
      volume: 42_000,
      isComplete: true,
      constituentBarCount: i % 2 === 0 ? 4 : 3,
    };
  });
  return [...base, obBar, ...imp, ...cons];
}

describe("Strategy 03 Phase 6.10.19.3 — Multi-Duration 4H Consolidation", () => {
  it("qualifies strong 3-4 day (6-8 blocks) and long-duration (17-30 blocks) setups as READY", () => {
    const shortReady = evaluateFourHourPreBreakout({
      nseSymbol: "SHORT4H",
      companyName: "Short Setup",
      candles: buildMultiDuration4h(7, 108, 105.5),
      dataProvider: "4H Cache",
      sourceReference: "test",
    });
    expect(shortReady.status).toBe("READY");
    expect(shortReady.consolidation.tier).toBe("SHORT_HIGH_QUALITY");
    expect(shortReady.consolidation.candleCount).toBe(7);

    const longReady = evaluateFourHourPreBreakout({
      nseSymbol: "LONG4H",
      companyName: "Long Setup",
      candles: buildMultiDuration4h(20, 108, 103.0),
      dataProvider: "4H Cache",
      sourceReference: "test",
    });
    expect(longReady.status).toBe("READY");
    expect(longReady.consolidation.tier).toBe("LONG_CLEAN");
    expect(longReady.consolidation.candleCount).toBe(20);
  });

  it("rejects weak 3-4 day sideways, excessively wide long bases, and does not inflate duration on holidays or incomplete bars", () => {
    // Wide deteriorating long base (> 8% range for LONG_CLEAN) -> not READY
    const wideLong = evaluateFourHourPreBreakout({
      nseSymbol: "WIDELONG",
      companyName: "Wide Base",
      candles: buildMultiDuration4h(20, 115, 100),
      dataProvider: "4H Cache",
      sourceReference: "test",
    });
    expect(wideLong.status).not.toBe("READY");

    // Holidays/missing sessions do NOT inflate candleCount or tradingDaysElapsed
    const withHoliday = evaluateFourHourPreBreakout({
      nseSymbol: "HOLIDAY",
      companyName: "Holiday Gap",
      candles: buildMultiDuration4h(6, 108, 105.5, true),
      dataProvider: "4H Cache",
      sourceReference: "test",
    });
    expect(withHoliday.consolidation.candleCount).toBe(6);
    expect(withHoliday.consolidation.tradingDaysElapsed).toBe(3);

    // Incomplete 4H bar does not count toward duration or trigger breakout
    const withInc = evaluateFourHourPreBreakout({
      nseSymbol: "INCOMPLETE",
      companyName: "Incomplete Bar",
      candles: [
        ...buildMultiDuration4h(6, 108, 105.5),
        {
          timeframe: "4H",
          timestamp: "2026-10-30T04:15:00.000Z",
          open: 107.5,
          high: 112.0,
          low: 107.2,
          close: 111.5,
          volume: 90_000,
          isComplete: false,
          constituentBarCount: 1,
        },
      ],
      dataProvider: "4H Cache",
      sourceReference: "test",
    });
    expect(withInc.consolidation.candleCount).toBe(6);
    expect(withInc.status).toBe("READY");

    // 1H data rejected
    const oneH = evaluateFourHourPreBreakout({
      nseSymbol: "ONEH",
      companyName: "OneHour",
      candles: buildMultiDuration4h(6, 108, 105.5).map((c) => ({ ...c, timeframe: "1H" as any })),
      dataProvider: "1H",
      sourceReference: "test",
    });
    expect(oneH.status).toBe("WAIT");
    expect(oneH.reason).toBe("TIMEFRAME_VIOLATION_1H_NOT_ALLOWED_IN_SWING");
  });
});

