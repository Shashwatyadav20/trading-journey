import { describe, expect, it } from "vitest";
import type { FourHourCandle } from "../prebreakout/Strategy03FourHourCandleProvider.js";
import { evaluateFourHourPreBreakout } from "../prebreakout/Strategy03FourHourPreBreakoutScanner.js";

function make4hBase(count: number, price = 100): FourHourCandle[] {
  return Array.from({ length: count }, (_, i) => ({
    timeframe: "4H",
    timestamp: new Date(Date.UTC(2026, 10, 1 + Math.floor(i / 2), i % 2 === 0 ? 4 : 8, 15)).toISOString(),
    open: price,
    high: price + 0.8,
    low: price - 0.5,
    close: price + 0.1,
    volume: 50_000,
    isComplete: true,
    constituentBarCount: i % 2 === 0 ? 4 : 3,
  }));
}

function makeSetup4h(consCount: number, sweep = false): FourHourCandle[] {
  const base = make4hBase(18, 100);
  // Two support reactions near 99.5
  base[13] = { ...base[13], open: 100.2, high: 100.8, low: 99.5, close: 100.4 };
  base[15] = { ...base[15], open: 100.1, high: 100.7, low: 99.6, close: 100.3 };
  // Bearish OB / optional liquidity sweep below 99.5
  const obBar: FourHourCandle = {
    timeframe: "4H",
    timestamp: "2026-11-10T04:15:00.000Z",
    open: 100.2,
    high: 100.5,
    low: sweep ? 98.4 : 99.55,
    close: 99.6,
    volume: 70_000,
    isComplete: true,
    constituentBarCount: 4,
  };
  const imp: FourHourCandle[] = [
    { timeframe: "4H", timestamp: "2026-11-10T08:15:00.000Z", open: 99.6, high: 102.5, low: 99.5, close: 102.2, volume: 110_000, isComplete: true, constituentBarCount: 3 },
    { timeframe: "4H", timestamp: "2026-11-11T04:15:00.000Z", open: 102.2, high: 105.2, low: 102.0, close: 104.8, volume: 120_000, isComplete: true, constituentBarCount: 4 },
    { timeframe: "4H", timestamp: "2026-11-11T08:15:00.000Z", open: 104.8, high: 107.8, low: 104.5, close: 107.4, volume: 115_000, isComplete: true, constituentBarCount: 3 },
  ];
  const cons: FourHourCandle[] = Array.from({ length: consCount }, (_, i) => ({
    timeframe: "4H",
    timestamp: new Date(Date.UTC(2026, 10, 12 + Math.floor(i / 2), i % 2 === 0 ? 4 : 8, 15)).toISOString(),
    open: 107.2,
    high: 108.0,
    low: 106.0,
    close: 107.1,
    volume: 40_000,
    isComplete: true,
    constituentBarCount: 4,
  }));
  return [...base, obBar, ...imp, ...cons];
}

describe("Strategy 03 — 4H Institutional Pre-Breakout Scanner", () => {
  it("1-4. detects support/liquidity sweep, impulse, multi-duration consolidation, and READY state", () => {
    const medSweep = evaluateFourHourPreBreakout({
      nseSymbol: "INFY",
      companyName: "Infosys",
      candles: makeSetup4h(10, true),
      dataProvider: "4H Cache",
      sourceReference: "test",
    });
    expect(medSweep.status).toBe("READY");
    expect(medSweep.supportZone.detected).toBe(true);
    expect(medSweep.supportZone.liquiditySweepDetected).toBe(true);
    expect(medSweep.consolidation.tier).toBe("MEDIUM_CLEAN");
    expect(medSweep.orderBlock.detected).toBe(true);

    const shortCons = evaluateFourHourPreBreakout({
      nseSymbol: "TCS",
      companyName: "TCS",
      candles: makeSetup4h(6, false),
      dataProvider: "4H Cache",
      sourceReference: "test",
    });
    expect(shortCons.status).toBe("READY");
    expect(shortCons.consolidation.tier).toBe("SHORT_HIGH_QUALITY");
    expect(medSweep.priorityScore).toBeGreaterThan(shortCons.priorityScore);
  });

  it("5-7. rejects sideways movement, marks confirmed breakout as BREAKOUT (not READY), and flags INVALIDATED", () => {
    const sideways = evaluateFourHourPreBreakout({
      nseSymbol: "FLAT",
      companyName: "Flat Co",
      candles: make4hBase(30, 100),
      dataProvider: "4H Cache",
      sourceReference: "test",
    });
    expect(sideways.status).not.toBe("READY");
    expect(sideways.impulse.detected).toBe(false);

    const broken = evaluateFourHourPreBreakout({
      nseSymbol: "BRK",
      companyName: "Broken Co",
      candles: [
        ...makeSetup4h(6, false),
        { timeframe: "4H", timestamp: "2026-11-16T04:15:00.000Z", open: 107.5, high: 110.5, low: 107.2, close: 110.0, volume: 130_000, isComplete: true, constituentBarCount: 4 },
      ],
      dataProvider: "4H Cache",
      sourceReference: "test",
    });
    expect(broken.status).toBe("BREAKOUT");

    const inv = evaluateFourHourPreBreakout({
      nseSymbol: "INV",
      companyName: "Inv Co",
      candles: [
        ...makeSetup4h(6, false),
        { timeframe: "4H", timestamp: "2026-11-16T04:15:00.000Z", open: 106.5, high: 106.8, low: 97.0, close: 97.5, volume: 120_000, isComplete: true, constituentBarCount: 4 },
      ],
      dataProvider: "4H Cache",
      sourceReference: "test",
    });
    expect(inv.status).toBe("INVALIDATED");
  });

  it("8-10. returns WAIT on missing/stale 4H data, rejects 1H data, and ignores incomplete 4H candles", () => {
    expect(
      evaluateFourHourPreBreakout({
        nseSymbol: "MISS",
        companyName: "Missing",
        candles: [],
        dataProvider: "4H Cache",
        sourceReference: "test",
      }).status
    ).toBe("WAIT");

    const stale = evaluateFourHourPreBreakout({
      nseSymbol: "STALE",
      companyName: "Stale",
      candles: makeSetup4h(6, false),
      now: new Date("2026-12-15T10:00:00.000Z"),
      dataProvider: "4H Cache",
      sourceReference: "test",
    });
    expect(stale.status).toBe("WAIT");
    expect(stale.reason).toContain("STALE_4H_DATA");

    // 9. 1H data cannot enter Strategy 03 swing pipeline
    const oneHourRejected = evaluateFourHourPreBreakout({
      nseSymbol: "ONEH",
      companyName: "OneHour",
      candles: make4hBase(30, 100).map((c) => ({ ...c, timeframe: "1H" as any })),
      dataProvider: "1H Cache",
      sourceReference: "test",
    });
    expect(oneHourRejected.status).toBe("WAIT");
    expect(oneHourRejected.reason).toBe("TIMEFRAME_VIOLATION_1H_NOT_ALLOWED_IN_SWING");

    // 10. Incomplete 4H breakout candle cannot trigger or alter confirmed state
    const withIncompleteBar = evaluateFourHourPreBreakout({
      nseSymbol: "INC",
      companyName: "Incomplete",
      candles: [
        ...makeSetup4h(6, true),
        { timeframe: "4H", timestamp: "2026-11-16T04:15:00.000Z", open: 107.5, high: 112.0, low: 107.2, close: 111.5, volume: 140_000, isComplete: false, constituentBarCount: 1 },
      ],
      dataProvider: "4H Cache",
      sourceReference: "test",
    });
    expect(withIncompleteBar.status).toBe("READY"); // incomplete breakout bar was excluded
  });
});
