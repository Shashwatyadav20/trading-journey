import { describe, it, expect } from "vitest";
import {
  buildStockIndicatorProfile,
  evaluateStrategyA_Breakout,
  evaluateStrategyB_Pullback,
  evaluateStrategyC_SupportBounce,
  evaluateStrategyD_MACrossover,
  evaluateStrategyE_Momentum,
  evaluateStrategyF_RangeBreakout,
  evaluateStrategyG_TrendContinuation,
  evaluateStrategyH_VolumeBreakout,
  evaluateAllStrategiesForStock,
  runHistoricalBacktest,
  DailyCandle,
} from "../../../../lib/indian/dailyStrategyScanner";

// Generate synthetic realistic daily candles for testing
function generateCandles(
  count: number,
  startPrice: number,
  trendSlope: number = 0.5,
  volatility: number = 2.0
): DailyCandle[] {
  const candles: DailyCandle[] = [];
  let current = startPrice;
  const baseDate = new Date("2026-01-01");

  for (let i = 0; i < count; i++) {
    const date = new Date(baseDate);
    date.setDate(baseDate.getDate() + i);
    const dateStr = date.toISOString().split("T")[0];

    const open = current;
    const change = trendSlope + (Math.sin(i / 3) * volatility);
    const close = Math.max(10, open + change);
    const high = Math.max(open, close) + volatility * 0.8;
    const low = Math.min(open, close) - volatility * 0.8;
    const volume = Math.round(500000 + Math.sin(i / 2) * 100000);

    candles.push({
      date: dateStr,
      open: Number(open.toFixed(2)),
      high: Number(high.toFixed(2)),
      low: Number(low.toFixed(2)),
      close: Number(close.toFixed(2)),
      volume,
    });

    current = close;
  }
  return candles;
}

describe("AI Daily Stock Strategy Scanner Suite", () => {
  const candles = generateCandles(60, 1000, 1.5, 5.0);

  it("builds comprehensive indicator profile from OHLCV data", () => {
    const profile = buildStockIndicatorProfile("TRENT", candles, {
      regularMarketPrice: candles[candles.length - 1].close,
      shortName: "Trent Ltd",
    });

    expect(profile.cleanSymbol).toBe("TRENT");
    expect(profile.currentPrice).toBe(candles[candles.length - 1].close);
    expect(profile.ema20).toBeGreaterThan(0);
    expect(profile.ema50).toBeGreaterThan(0);
    expect(profile.rsi14).toBeGreaterThanOrEqual(0);
    expect(profile.rsi14).toBeLessThanOrEqual(100);
    expect(profile.macd).toBeDefined();
    expect(profile.resistanceLevel).toBeGreaterThan(0);
    expect(profile.supportLevel).toBeGreaterThan(0);
  });

  // Strategy A: Breakout Trading
  it("Strategy A: evaluates breakout criteria correctly", () => {
    const profile = buildStockIndicatorProfile("DIXON", candles, {
      regularMarketPrice: 12800,
    });
    // Mock breakout state
    profile.currentPrice = profile.resistanceLevel * 1.01;
    profile.volumeMultiplier = 2.2;
    profile.extensionFrom20EMAPercent = 3.0;

    const res = evaluateStrategyA_Breakout(profile);
    expect(res.strategyId).toBe("STRATEGY_A_BREAKOUT");
    expect(res.strategyCode).toBe("A");
    expect(res.matched).toBe(true);
    expect(res.rewardRiskRatio).toBeGreaterThanOrEqual(2.0);
    expect(res.stopLoss).toBeLessThan(res.entryZone.trigger);
  });

  // Strategy B: Pullback in an Uptrend
  it("Strategy B: detects pullback into 20 EMA in uptrend", () => {
    const profile = buildStockIndicatorProfile("HAL", candles, {
      regularMarketPrice: 4600,
    });
    profile.currentPrice = profile.ema20 * 1.005; // touching 20 EMA
    profile.ema50 = profile.ema20 * 0.95;
    profile.ema200 = profile.ema50 * 0.90;
    profile.dayLow = profile.ema20 * 0.995;
    profile.dayHigh = profile.currentPrice * 1.01;

    const res = evaluateStrategyB_Pullback(profile);
    expect(res.strategyId).toBe("STRATEGY_B_PULLBACK");
    expect(res.strategyCode).toBe("B");
    expect(res.matched).toBe(true);
    expect(res.stopLoss).toBeLessThan(res.entryZone.trigger);
  });

  // Strategy C: Support Bounce
  it("Strategy C: verifies support bounce with risk parameters", () => {
    const profile = buildStockIndicatorProfile("CDSL", candles, {
      regularMarketPrice: 1250,
    });
    profile.currentPrice = profile.supportLevel * 1.01; // bouncing off support
    profile.dayLow = profile.supportLevel;

    const res = evaluateStrategyC_SupportBounce(profile);
    expect(res.strategyId).toBe("STRATEGY_C_SUPPORT_BOUNCE");
    expect(res.strategyCode).toBe("C");
    expect(res.matched).toBe(true);
    expect(res.stopLoss).toBeLessThan(profile.supportLevel);
  });

  // Strategy D: Moving Average Crossover
  it("Strategy D: detects 20 EMA crossing above 50 EMA", () => {
    const profile = buildStockIndicatorProfile("BEL", candles, {
      regularMarketPrice: 380,
    });
    profile.ema20 = 370;
    profile.ema50 = 368; // Golden cross by 0.5%
    profile.currentPrice = 380;

    const res = evaluateStrategyD_MACrossover(profile);
    expect(res.strategyId).toBe("STRATEGY_D_MA_CROSSOVER");
    expect(res.strategyCode).toBe("D");
    expect(res.matched).toBe(true);
  });

  // Strategy E: Momentum Trading
  it("Strategy E: identifies strong relative strength and RSI momentum", () => {
    const profile = buildStockIndicatorProfile("PERSISTENT", candles, {
      regularMarketPrice: 5700,
    });
    profile.relativeStrengthVsNifty = 85;
    profile.rsi14 = 64;
    profile.macd.histogram = 5.2;
    profile.extensionFrom20EMAPercent = 4.0;

    const res = evaluateStrategyE_Momentum(profile);
    expect(res.strategyId).toBe("STRATEGY_E_MOMENTUM");
    expect(res.strategyCode).toBe("E");
    expect(res.matched).toBe(true);
  });

  // Strategy F: Range Breakout
  it("Strategy F: detects consolidation range breakout", () => {
    const profile = buildStockIndicatorProfile("POLYCAB", candles, {
      regularMarketPrice: 8300,
    });
    profile.resistanceLevel = 8250;
    profile.supportLevel = 7800; // 5.7% range
    profile.currentPrice = 8290;
    profile.volumeMultiplier = 1.8;

    const res = evaluateStrategyF_RangeBreakout(profile);
    expect(res.strategyId).toBe("STRATEGY_F_RANGE_BREAKOUT");
    expect(res.strategyCode).toBe("F");
    expect(res.matched).toBe(true);
  });

  // Strategy G: Trend Continuation
  it("Strategy G: validates Higher High & Higher Low continuation", () => {
    const profile = buildStockIndicatorProfile("TITAN", candles, {
      regularMarketPrice: 4400,
    });
    profile.ema20 = 4300;
    profile.ema50 = 4150;
    profile.ema200 = 3800;
    profile.currentPrice = 4420;
    profile.swingLow = profile.supportLevel * 1.05;
    profile.rsi14 = 62;

    const res = evaluateStrategyG_TrendContinuation(profile);
    expect(res.strategyId).toBe("STRATEGY_G_TREND_CONTINUATION");
    expect(res.strategyCode).toBe("G");
    expect(res.matched).toBe(true);
  });

  // Strategy H: Volume Breakout
  it("Strategy H: flags institutional volume breakout > 2.0x avg", () => {
    const profile = buildStockIndicatorProfile("BSE", candles, {
      regularMarketPrice: 3300,
    });
    profile.volumeMultiplier = 2.8;
    profile.changePercent = 3.5;
    profile.dayLow = 3200;
    profile.dayHigh = 3320;
    profile.currentPrice = 3310;

    const res = evaluateStrategyH_VolumeBreakout(profile);
    expect(res.strategyId).toBe("STRATEGY_H_VOLUME_BREAKOUT");
    expect(res.strategyCode).toBe("H");
    expect(res.matched).toBe(true);
    expect(res.confidenceScore).toBeGreaterThanOrEqual(80);
  });

  // Multi-Strategy Confluence
  it("detects multi-strategy confluence when multiple strategies trigger", () => {
    const profile = buildStockIndicatorProfile("TRENT", candles, {
      regularMarketPrice: 2950,
    });
    // Trigger Breakout + Volume Breakout + Momentum
    profile.resistanceLevel = 2900;
    profile.currentPrice = 2940;
    profile.volumeMultiplier = 2.4;
    profile.extensionFrom20EMAPercent = 3.2;
    profile.relativeStrengthVsNifty = 88;
    profile.rsi14 = 65;
    profile.changePercent = 2.4;
    profile.dayLow = 2890;
    profile.dayHigh = 2950;
    profile.macd.histogram = 3.5;

    const opp = evaluateAllStrategiesForStock(profile);
    expect(opp).toBeDefined();
    expect(opp!.matchedStrategyCount).toBeGreaterThanOrEqual(2);
    expect(opp!.isMultiStrategyMatch).toBe(true);
    expect(opp!.confluenceScore).toBeGreaterThanOrEqual(80);
    expect(opp!.scoreBreakdown.trendConfirmation).toBeGreaterThan(0);
    expect(opp!.scoreBreakdown.volumeConfirmation).toBeGreaterThan(0);
  });

  // Historical Backtesting Engine
  it("runs historical backtest simulation and computes performance metrics", () => {
    const backtestCandles = generateCandles(80, 500, 2.0, 6.0);
    const result = runHistoricalBacktest("HAL", "STRATEGY_A_BREAKOUT", backtestCandles);

    expect(result.symbol).toBe("HAL");
    expect(result.strategyId).toBe("STRATEGY_A_BREAKOUT");
    expect(result.periodDays).toBe(80);
    expect(result.winRatePercent).toBeGreaterThanOrEqual(0);
    expect(result.winRatePercent).toBeLessThanOrEqual(100);
    expect(result.profitFactor).toBeGreaterThanOrEqual(0);
    expect(result.equityCurve.length).toBeGreaterThan(0);
  });
});
