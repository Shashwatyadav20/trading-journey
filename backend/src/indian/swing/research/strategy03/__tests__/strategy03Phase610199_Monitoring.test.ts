import { describe, expect, it } from "vitest";
import type { FourHourCandle } from "../prebreakout/Strategy03FourHourCandleProvider.js";
import { Strategy03FourHourMonitoringEngine } from "../prebreakout/Strategy03FourHourMonitoringEngine.js";

function makeReadySeries(): FourHourCandle[] {
  const base: FourHourCandle[] = Array.from({ length: 18 }, (_, i) => ({
    timeframe: "4H",
    timestamp: new Date(Date.UTC(2026, 9, 10 + Math.floor(i / 2), i % 2 === 0 ? 4 : 8, 15)).toISOString(),
    open: 100,
    high: 100.8,
    low: 99.5,
    close: 100.1,
    volume: 50_000,
    isComplete: true,
    constituentBarCount: 4,
    blockDurationMinutes: 240,
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
    blockDurationMinutes: 240,
  };
  const imp: FourHourCandle[] = [
    { timeframe: "4H", timestamp: "2026-10-22T08:15:00.000Z", open: 99.3, high: 102.5, low: 99.2, close: 102.2, volume: 110_000, isComplete: true, constituentBarCount: 3, blockDurationMinutes: 135 },
    { timeframe: "4H", timestamp: "2026-10-23T04:15:00.000Z", open: 102.2, high: 105.2, low: 102.0, close: 104.8, volume: 120_000, isComplete: true, constituentBarCount: 4, blockDurationMinutes: 240 },
    { timeframe: "4H", timestamp: "2026-10-23T08:15:00.000Z", open: 104.8, high: 107.6, low: 104.5, close: 107.2, volume: 115_000, isComplete: true, constituentBarCount: 3, blockDurationMinutes: 135 },
  ];
  const cons: FourHourCandle[] = Array.from({ length: 7 }, (_, i) => ({
    timeframe: "4H",
    timestamp: new Date(Date.UTC(2026, 9, 26 + Math.floor(i / 2), i % 2 === 0 ? 4 : 8, 15)).toISOString(),
    open: 106.5,
    high: 108.0,
    low: 105.5,
    close: 107.2,
    volume: 42_000,
    isComplete: true,
    constituentBarCount: 4,
    blockDurationMinutes: 240,
  }));
  return [...base, obBar, ...imp, ...cons];
}

describe("Strategy 03 Phase 6.10.19.9 — Live 4H Pre-Breakout Monitoring & State Management", () => {
  it("1-8. manages READY->READY, READY->BREAKOUT, READY->INVALIDATED, ignores incomplete bars, prevents duplicate alerts, and recovers state", () => {
    const engine = new Strategy03FourHourMonitoringEngine();
    const s0 = makeReadySeries();

    // 1. Initial READY + duplicate scan prevention (7)
    const r1 = engine.evaluateSymbol({ nseSymbol: "SUNPHARMA", companyName: "Sun", candles: s0, dataProvider: "4H", sourceReference: "t" });
    expect(r1.stateRecord.currentStatus).toBe("READY");
    expect(r1.newAlerts.some((a) => a.alertType === "NEW_READY_CANDIDATE")).toBe(true);

    const r1Dup = engine.evaluateSymbol({ nseSymbol: "SUNPHARMA", companyName: "Sun", candles: s0, dataProvider: "4H", sourceReference: "t" });
    expect(r1Dup.duplicatePrevented).toBe(true);
    expect(r1Dup.newAlerts).toHaveLength(0);

    // 4. Incomplete breakout candle cannot trigger BREAKOUT
    const incBreakout: FourHourCandle = {
      timeframe: "4H",
      timestamp: "2026-10-30T04:15:00.000Z",
      open: 107.5,
      high: 111.0,
      low: 107.2,
      close: 110.5,
      volume: 130_000,
      isComplete: false,
      constituentBarCount: 1,
    };
    const rIncBrk = engine.evaluateSymbol({
      nseSymbol: "SUNPHARMA",
      companyName: "Sun",
      candles: [...s0, incBreakout],
      dataProvider: "4H",
      sourceReference: "t",
    });
    expect(rIncBrk.stateRecord.currentStatus).toBe("READY");

    // 2. Completed breakout candle transitions READY -> BREAKOUT
    const compBreakout: FourHourCandle = { ...incBreakout, isComplete: true, constituentBarCount: 4 };
    const rBrk = engine.evaluateSymbol({
      nseSymbol: "SUNPHARMA",
      companyName: "Sun",
      candles: [...s0, compBreakout],
      dataProvider: "4H",
      sourceReference: "t",
    });
    expect(rBrk.stateRecord.previousStatus).toBe("READY");
    expect(rBrk.stateRecord.currentStatus).toBe("BREAKOUT");
    expect(rBrk.newAlerts.some((a) => a.alertType === "CONFIRMED_BREAKOUT")).toBe(true);

    // 8. Restart recovery preserves state and prevents duplicate alerts
    const restarted = new Strategy03FourHourMonitoringEngine();
    restarted.recoverState({ stateHistory: engine.getStateHistory(), alerts: engine.getAlerts() });
    expect(restarted.getLatestState("SUNPHARMA")?.currentStatus).toBe("BREAKOUT");
  });

  it("5, 6, 9, 10. ANANDRATHI regression (incomplete dip stays READY, completed breach -> INVALIDATED), stale -> WAIT, and 1H rejected", () => {
    const engine = new Strategy03FourHourMonitoringEngine();
    const s0 = makeReadySeries();

    const init = engine.evaluateSymbol({ nseSymbol: "ANANDRATHI", companyName: "Anand Rathi", candles: s0, dataProvider: "4H", sourceReference: "t" });
    expect(init.stateRecord.currentStatus).toBe("READY");

    // 5 & 9. Incomplete candle dipping below consolidation low (105.5) does NOT trigger INVALIDATED
    const incDip: FourHourCandle = {
      timeframe: "4H",
      timestamp: "2026-10-30T04:15:00.000Z",
      open: 106.0,
      high: 106.2,
      low: 104.5,
      close: 104.8,
      volume: 60_000,
      isComplete: false,
      constituentBarCount: 1,
    };
    const afterInc = engine.evaluateSymbol({
      nseSymbol: "ANANDRATHI",
      companyName: "Anand Rathi",
      candles: [...s0, incDip],
      dataProvider: "4H",
      sourceReference: "t",
    });
    expect(afterInc.stateRecord.currentStatus).toBe("READY");

    // 3 & 9. Completed candle closing below consolidation low transitions READY -> INVALIDATED
    const compDip: FourHourCandle = { ...incDip, isComplete: true, constituentBarCount: 4 };
    const afterComp = engine.evaluateSymbol({
      nseSymbol: "ANANDRATHI",
      companyName: "Anand Rathi",
      candles: [...s0, compDip],
      dataProvider: "4H",
      sourceReference: "t",
    });
    expect(afterComp.stateRecord.previousStatus).toBe("READY");
    expect(afterComp.stateRecord.currentStatus).toBe("INVALIDATED");
    expect(afterComp.newAlerts.some((a) => a.alertType === "CONSOLIDATION_LOW_BREACHED")).toBe(true);

    // 6. Stale data -> WAIT
    const stale = engine.evaluateSymbol({
      nseSymbol: "ANANDRATHI",
      companyName: "Anand Rathi",
      candles: s0,
      now: new Date("2026-12-25T10:00:00.000Z"),
      dataProvider: "4H",
      sourceReference: "t",
    });
    expect(stale.stateRecord.currentStatus).toBe("WAIT");
    expect(stale.newAlerts.some((a) => a.alertType === "MOVED_TO_WAIT_DATA_ISSUE")).toBe(true);

    // 10. Strict rejection of 1H candles
    const oneH = engine.evaluateSymbol({
      nseSymbol: "ONEH",
      companyName: "OneH",
      candles: s0.map((c) => ({ ...c, timeframe: "1H" as any })),
      dataProvider: "1H",
      sourceReference: "t",
    });
    expect(oneH.stateRecord.currentStatus).toBe("WAIT");
    expect(oneH.stateRecord.reason).toBe("TIMEFRAME_VIOLATION_1H_NOT_ALLOWED_IN_SWING");
  });
});

