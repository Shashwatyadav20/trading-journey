import { Candle, VolatilityState } from "../types";

export class VolatilityEngine {
  /**
   * Calculates Average True Range (ATR) over period (default 14).
   */
  public calculateATR(candles: Candle[], period: number = 14): number {
    if (!candles || candles.length < period + 1) return 0;

    let trSum = 0;
    for (let i = candles.length - period; i < candles.length; i++) {
      const current = candles[i];
      const prev = candles[i - 1];

      const tr1 = current.high - current.low;
      const tr2 = Math.abs(current.high - prev.close);
      const tr3 = Math.abs(current.low - prev.close);

      const tr = Math.max(tr1, tr2, tr3);
      trSum += tr;
    }

    return Number((trSum / period).toFixed(2));
  }

  /**
   * Evaluates volatility state based on ATR relative to spot price and option IV.
   *
   * LOW: ATR/Spot < 0.8% or IV < 12%
   * NORMAL: ATR/Spot 0.8% - 1.5% and IV 12% - 18%
   * HIGH: ATR/Spot 1.5% - 2.2% or IV 18% - 25%
   * EXTREME: ATR/Spot > 2.2% or IV > 25%
   */
  public evaluateVolatility(
    spotPrice: number,
    atr14: number,
    avgIv: number = 14
  ): { state: VolatilityState; atrPct: number; iv: number } {
    if (spotPrice <= 0) {
      return { state: "NORMAL", atrPct: 1.0, iv: avgIv };
    }

    const atrPct = Number(((atr14 / spotPrice) * 100).toFixed(2));

    let state: VolatilityState = "NORMAL";

    if (atrPct > 2.2 || avgIv > 25) {
      state = "EXTREME";
    } else if (atrPct > 1.5 || avgIv > 18) {
      state = "HIGH";
    } else if (atrPct < 0.8 || avgIv < 12) {
      state = "LOW";
    } else {
      state = "NORMAL";
    }

    return { state, atrPct, iv: avgIv };
  }
}

export const volatilityEngine = new VolatilityEngine();
