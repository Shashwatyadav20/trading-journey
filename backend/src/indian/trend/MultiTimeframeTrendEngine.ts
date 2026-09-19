import { Candle, SwingStructure, TrendAnalysis } from "../types";

export class MultiTimeframeTrendEngine {
  /**
   * Calculates Exponential Moving Average (EMA).
   */
  public calculateEMA(candles: Candle[], period: number): number {
    if (!candles || candles.length < period) return 0;

    const k = 2 / (period + 1);
    let ema = candles[0].close;

    for (let i = 1; i < candles.length; i++) {
      ema = candles[i].close * k + ema * (1 - k);
    }

    return Number(ema.toFixed(2));
  }

  /**
   * Calculates Relative Strength Index (RSI).
   */
  public calculateRSI(candles: Candle[], period: number = 14): number {
    if (!candles || candles.length < period + 1) return 50;

    let gains = 0;
    let losses = 0;

    for (let i = 1; i <= period; i++) {
      const change = candles[i].close - candles[i - 1].close;
      if (change >= 0) {
        gains += change;
      } else {
        losses += Math.abs(change);
      }
    }

    let avgGain = gains / period;
    let avgLoss = losses / period;

    for (let i = period + 1; i < candles.length; i++) {
      const change = candles[i].close - candles[i - 1].close;
      if (change >= 0) {
        avgGain = (avgGain * (period - 1) + change) / period;
        avgLoss = (avgLoss * (period - 1)) / period;
      } else {
        avgGain = (avgGain * (period - 1)) / period;
        avgLoss = (avgLoss * (period - 1) + Math.abs(change)) / period;
      }
    }

    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    const rsi = 100 - 100 / (1 + rs);
    return Number(rsi.toFixed(2));
  }

  /**
   * Detects swing structure (HH/HL, LH/LL, or UNCLEAR) from candles.
   */
  public detectSwingStructure(candles: Candle[]): SwingStructure {
    if (!candles || candles.length < 4) return "UNCLEAR";

    const highs: number[] = [];
    const lows: number[] = [];

    for (let i = 2; i < candles.length - 2; i++) {
      const c = candles[i];
      if (
        c.high >= candles[i - 1].high &&
        c.high >= candles[i - 2].high &&
        c.high >= candles[i + 1].high &&
        c.high >= candles[i + 2].high
      ) {
        highs.push(c.high);
      }
      if (
        c.low <= candles[i - 1].low &&
        c.low <= candles[i - 2].low &&
        c.low <= candles[i + 1].low &&
        c.low <= candles[i + 2].low
      ) {
        lows.push(c.low);
      }
    }

    if (highs.length < 2 || lows.length < 2) {
      const len = candles.length;
      const mid = Math.floor(len / 2);
      const prevHalf = candles.slice(0, mid);
      const recentHalf = candles.slice(mid);

      const prevHigh = Math.max(...prevHalf.map((c) => c.high));
      const prevLow = Math.min(...prevHalf.map((c) => c.low));
      const recentHigh = Math.max(...recentHalf.map((c) => c.high));
      const recentLow = Math.min(...recentHalf.map((c) => c.low));

      if (recentHigh > prevHigh && recentLow > prevLow) return "HH_HL";
      if (recentHigh < prevHigh && recentLow < prevLow) return "LH_LL";
      return "UNCLEAR";
    }

    const h1 = highs[highs.length - 2];
    const h2 = highs[highs.length - 1];
    const l1 = lows[lows.length - 2];
    const l2 = lows[lows.length - 1];

    if (h2 > h1 && l2 > l1) return "HH_HL";
    if (h2 < h1 && l2 < l1) return "LH_LL";
    if (h2 > h1 && l2 < l1) return "HH_LL";
    if (h2 < h1 && l2 > l1) return "LH_HL";
    return "UNCLEAR";
  }

  /**
   * Calculates Volume Weighted Average Price (VWAP) for intraday candles.
   */
  public calculateVWAP(candles: Candle[]): number {
    if (!candles || candles.length === 0) return 0;

    let cumulativeTPV = 0;
    let cumulativeVolume = 0;

    for (const c of candles) {
      const tp = (c.high + c.low + c.close) / 3;
      const vol = c.volume && c.volume > 0 ? c.volume : 1000;
      cumulativeTPV += tp * vol;
      cumulativeVolume += vol;
    }

    return cumulativeVolume > 0
      ? Number((cumulativeTPV / cumulativeVolume).toFixed(2))
      : 0;
  }

  /**
   * Evaluates multi-timeframe trend alignment (1H + 15M + VWAP).
   */
  public analyzeTrend(
    candles15M: Candle[],
    candles1H: Candle[],
    spotPrice: number
  ): TrendAnalysis {
    const reasons: string[] = [];

    const rsi = this.calculateRSI(candles15M);
    const swingStructure = this.detectSwingStructure(candles15M);

    if (!candles15M || candles15M.length < 5 || !candles1H || candles1H.length < 5) {
      return {
        direction: "NEUTRAL",
        trendScore: 50,
        invalidationLevel: spotPrice,
        swingStructure: "UNCLEAR",
        rsi: 50,
        vwap: spotPrice,
        isVwapNeutral: true,
        reasons: ["Insufficient candle data for trend evaluation."],
      };
    }

    const ema20_15M = this.calculateEMA(candles15M, Math.min(20, candles15M.length));
    const ema50_15M = this.calculateEMA(candles15M, Math.min(50, candles15M.length));

    const ema20_1H = this.calculateEMA(candles1H, Math.min(20, candles1H.length));
    const ema50_1H = this.calculateEMA(candles1H, Math.min(50, candles1H.length));

    const vwap = this.calculateVWAP(candles15M);
    const vwapDiff = Math.abs(spotPrice - vwap);
    const isVwapNeutral = vwap > 0 ? vwapDiff / vwap < 0.0006 || vwapDiff <= 5 : true;

    const is15MBullish = spotPrice > ema20_15M && ema20_15M >= ema50_15M;
    const is15MBearish = spotPrice < ema20_15M && ema20_15M <= ema50_15M;

    const is1HBullish = ema20_1H >= ema50_1H;
    const is1HBearish = ema20_1H <= ema50_1H;

    const isAboveVwap = spotPrice > vwap;
    const isBelowVwap = spotPrice < vwap;

    // Calculate Invalidation Levels
    const recentLows = candles15M.slice(-5).map((c) => c.low);
    const recentHighs = candles15M.slice(-5).map((c) => c.high);
    const swingLow15M = Math.min(...recentLows);
    const swingHigh15M = Math.max(...recentHighs);

    if (is1HBullish && is15MBullish && isAboveVwap) {
      reasons.push("1H and 15M trends are aligned BULLISH");
      reasons.push(`Spot price (${spotPrice}) > VWAP (${vwap})`);
      reasons.push(`15M EMA(20) [${ema20_15M}] > EMA(50) [${ema50_15M}]`);

      return {
        direction: "BUY",
        trendScore: 90,
        invalidationLevel: swingLow15M,
        swingStructure,
        rsi,
        vwap,
        isVwapNeutral,
        reasons,
      };
    }

    if (is1HBearish && is15MBearish && isBelowVwap) {
      reasons.push("1H and 15M trends are aligned BEARISH");
      reasons.push(`Spot price (${spotPrice}) < VWAP (${vwap})`);
      reasons.push(`15M EMA(20) [${ema20_15M}] < EMA(50) [${ema50_15M}]`);

      return {
        direction: "SELL",
        trendScore: 90,
        invalidationLevel: swingHigh15M,
        swingStructure,
        rsi,
        vwap,
        isVwapNeutral,
        reasons,
      };
    }

    // Trend Conflict or Neutral
    if (is1HBullish !== is15MBullish) {
      reasons.push(
        `1H trend (${is1HBullish ? "BULLISH" : "BEARISH"}) disagrees with 15M trend (${
          is15MBullish ? "BULLISH" : "BEARISH"
        }).`
      );
    }
    if ((is1HBullish && !isAboveVwap) || (is1HBearish && !isBelowVwap)) {
      reasons.push(`Spot price vs VWAP is conflicted with macro 1H trend.`);
    }

    return {
      direction: "NEUTRAL",
      trendScore: 40,
      invalidationLevel: spotPrice,
      swingStructure,
      rsi,
      vwap,
      isVwapNeutral,
      reasons,
    };
  }
}

export const multiTimeframeTrendEngine = new MultiTimeframeTrendEngine();
