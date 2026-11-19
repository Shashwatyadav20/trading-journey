import { describe, expect, it } from "vitest";
import type { OhlcvCandle } from "../entry/EntrySetupTypes.js";
import { detectBullishImpulse } from "../prebreakout/Strategy03ImpulseDetector.js";
import { detectBullishOrderBlock } from "../prebreakout/Strategy03OrderBlockDetector.js";
import { evaluatePreBreakoutSetup } from "../prebreakout/Strategy03PreBreakoutDetector.js";

function makeBaseHistory(count = 20, price = 100): OhlcvCandle[] {
  return Array.from({ length: count }, (_, i) => ({
    timestamp: `2026-11-01T0${3 + (i % 6)}:15:00.000Z`,
    open: price,
    high: price + 0.6,
    low: price - 0.6,
    close: price + 0.1,
    volume: 10_000,
  }));
}

describe("Strategy 03 Phase 6.10.19 — High-Quality Pre-Breakout Detection", () => {
  it("detects strong impulse, valid OB, tight consolidation, and classifies READY before breakout", () => {
    const base = makeBaseHistory(30, 100);
    // Bearish OB candle just before impulse (liquidity sweep below 99.4)
    const obBar: OhlcvCandle = {
      timestamp: "2026-11-10T03:45:00.000Z",
      open: 100.2,
      high: 100.4,
      low: 99.0,
      close: 99.2,
      volume: 14_000,
    };
    // 3 strong bullish impulse candles
    const imp: OhlcvCandle[] = [
      { timestamp: "2026-11-10T04:45:00.000Z", open: 99.2, high: 101.8, low: 98.8, close: 101.5, volume: 22_000 },
      { timestamp: "2026-11-10T05:45:00.000Z", open: 101.5, high: 104.2, low: 101.3, close: 103.9, volume: 25_000 },
      { timestamp: "2026-11-10T06:45:00.000Z", open: 103.9, high: 106.5, low: 103.7, close: 106.2, volume: 24_000 },
    ];
    // 4 tight consolidation bars below 106.8, price currently 106.0 (pre-breakout!)
    const cons: OhlcvCandle[] = [
      { timestamp: "2026-11-10T07:45:00.000Z", open: 106.1, high: 106.8, low: 105.4, close: 105.8, volume: 9_000 },
      { timestamp: "2026-11-10T08:45:00.000Z", open: 105.8, high: 106.6, low: 105.5, close: 106.0, volume: 8_500 },
      { timestamp: "2026-11-10T09:45:00.000Z", open: 106.0, high: 106.7, low: 105.6, close: 105.9, volume: 8_000 },
      { timestamp: "2026-11-11T03:45:00.000Z", open: 105.9, high: 106.5, low: 105.6, close: 106.0, volume: 8_200 },
    ];

    const series = [...base, obBar, ...imp, ...cons];
    const impulse = detectBullishImpulse(series);
    expect(impulse.detected).toBe(true);
    expect(impulse.candleCount).toBe(3);

    const ob = detectBullishOrderBlock({ completedCandles: series, impulse });
    expect(ob.detected).toBe(true);
    expect(ob.obLow).toBe(99.0);

    const ready = evaluatePreBreakoutSetup({
      nseSymbol: "INFY",
      companyName: "Infosys Ltd",
      completedCandles: series,
      dataProvider: "Yahoo Finance 1H Cache",
      sourceReference: "test",
    });
    expect(ready.status).toBe("READY");
    expect(ready.breakoutDistancePct).toBeGreaterThan(0);
    expect(ready.independentVerificationStatus).toBe("UNVERIFIED");

    // Adding a confirmed breakout bar -> BREAKOUT (not READY)
    const broken = evaluatePreBreakoutSetup({
      nseSymbol: "INFY",
      companyName: "Infosys Ltd",
      completedCandles: [
        ...series,
        { timestamp: "2026-11-11T04:45:00.000Z", open: 106.1, high: 108.5, low: 106.0, close: 108.2, volume: 28_000 },
      ],
      dataProvider: "Yahoo Finance 1H Cache",
      sourceReference: "test",
    });
    expect(broken.status).toBe("BREAKOUT");

    // Breaking consolidation/OB low -> INVALIDATED
    const inv = evaluatePreBreakoutSetup({
      nseSymbol: "INFY",
      companyName: "Infosys Ltd",
      completedCandles: [
        ...series,
        { timestamp: "2026-11-11T04:45:00.000Z", open: 105.5, high: 105.6, low: 98.0, close: 98.5, volume: 20_000 },
      ],
      dataProvider: "Yahoo Finance 1H Cache",
      sourceReference: "test",
    });
    expect(inv.status).toBe("INVALIDATED");
  });

  it("returns WAIT on missing/insufficient/corrupt data and rejects arbitrary OB without impulse", () => {
    const waitRes = evaluatePreBreakoutSetup({
      nseSymbol: "RELIANCE",
      companyName: "Reliance Industries",
      completedCandles: [],
      dataProvider: "Yahoo Finance 1H Cache",
      sourceReference: "missing",
    });
    expect(waitRes.status).toBe("WAIT");
    expect(waitRes.independentVerificationStatus).toBe("MISSING");

    const flat = makeBaseHistory(40, 100);
    const imp = detectBullishImpulse(flat);
    expect(imp.detected).toBe(false);
    const ob = detectBullishOrderBlock({ completedCandles: flat, impulse: imp });
    expect(ob.detected).toBe(false);
  });
});
