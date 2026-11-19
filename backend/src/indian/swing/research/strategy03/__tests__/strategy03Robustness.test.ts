import { describe, expect, it } from "vitest";
import {
  classifyMarketRegimes,
  evaluateEquityByRegime,
  runCircularBlockBootstrap,
  wilsonWinRateCI,
} from "../StatisticalRobustnessEngine.js";
import type { DailyCandleBar, PortfolioEquityPoint } from "../HistoricalValidationEngine.js";

describe("Strategy 03 Phase 6.7 — Statistical Robustness & Stress Testing", () => {
  it("produces bit-for-bit reproducible circular block bootstrap CIs", () => {
    const returns = Array.from({ length: 252 }, (_, i) => (i % 5 === 0 ? -0.012 : 0.004));
    const b1 = runCircularBlockBootstrap({ dailyReturns: returns, iterations: 200, blockSizeDays: 21, seed: 42 });
    const b2 = runCircularBlockBootstrap({ dailyReturns: returns, iterations: 200, blockSizeDays: 21, seed: 42 });
    expect(b1).toEqual(b2);
    expect(b1.cagrPct.p2_5).toBeLessThanOrEqual(b1.cagrPct.median);
    expect(b1.cagrPct.median).toBeLessThanOrEqual(b1.cagrPct.p97_5);
  });

  it("classifies BULL, BEAR, SIDEWAYS, HIGH_VOL, and LOW_VOL market regimes causally", () => {
    const bars: DailyCandleBar[] = [];
    let price = 100;
    for (let i = 0; i < 320; i++) {
      // First 210 days flat/up, next 70 days strong bull, last 40 days sharp bear
      if (i >= 210 && i < 280) price *= 1.003;
      else if (i >= 280) price *= 0.99;
      else price *= i % 2 === 0 ? 1.001 : 0.9995;
      bars.push({
        date: `2024-${String(Math.floor(i / 28) + 1).padStart(2, "0")}-${String((i % 28) + 1).padStart(2, "0")}`,
        open: price,
        high: price,
        low: price,
        close: price,
        adjClose: price,
        volume: 1_000_000,
      });
    }
    const regimes = classifyMarketRegimes(bars);
    const bullCount = [...regimes.values()].filter((r) => r.trendRegime === "BULL").length;
    const bearCount = [...regimes.values()].filter((r) => r.trendRegime === "BEAR").length;
    expect(bullCount).toBeGreaterThan(0);
    expect(bearCount).toBeGreaterThan(0);

    const curve: PortfolioEquityPoint[] = bars.map((b, idx) => ({
      date: b.date,
      equityInr: 1_000_000 + idx * 100,
      cashInr: 500_000,
      investedWeight: 0.5,
      holdingsCount: 5,
      dailyReturn: 0.0005,
    }));
    const regPerf = evaluateEquityByRegime({ equityCurve: curve, regimeMap: regimes });
    expect(regPerf.some((r) => r.regime === "TREND_BULL")).toBe(true);
  });

  it("computes bounded Wilson 95% confidence intervals for win rates", () => {
    const ci = wilsonWinRateCI(55, 100);
    expect(ci.ratePct).toBe(55);
    expect(ci.ciLowPct).toBeGreaterThan(40);
    expect(ci.ciHighPct).toBeLessThan(70);
  });
});

