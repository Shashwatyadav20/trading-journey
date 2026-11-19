import type { DailyCandleBar } from "../HistoricalValidationEngine.js";

export interface PriceExpansionMetrics {
  atr14: number | null;
  atrPct: number | null;
  extensionAbove20SmaPct: number | null;
  hasRecentBullishExpansion: boolean;
  isOverextended: boolean;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

export function detectPriceExpansion(candles: DailyCandleBar[]): PriceExpansionMetrics {
  if (candles.length < 21) {
    return {
      atr14: null,
      atrPct: null,
      extensionAbove20SmaPct: null,
      hasRecentBullishExpansion: false,
      isOverextended: false,
    };
  }
  let trSum = 0;
  for (let i = candles.length - 14; i < candles.length; i++) {
    const c = candles[i];
    const p = candles[i - 1].close;
    trSum += Math.max(c.high - c.low, Math.abs(c.high - p), Math.abs(c.low - p));
  }
  const atr14 = round2(trSum / 14);
  const last = candles[candles.length - 1];
  const atrPct = last.close > 0 ? round2((atr14 / last.close) * 100) : null;
  const sma20 = candles.slice(-20).reduce((a, c) => a + c.adjClose, 0) / 20;
  const extPct = sma20 > 0 ? round2(((last.adjClose - sma20) / sma20) * 100) : null;

  const recent10 = candles.slice(-10);
  const hasRecentBullishExpansion = recent10.some((c) => {
    const rng = c.high - c.low;
    return rng >= atr14 * 1.2 && c.close > c.open && (c.close - c.open) / rng >= 0.55;
  });

  return {
    atr14,
    atrPct,
    extensionAbove20SmaPct: extPct,
    hasRecentBullishExpansion,
    isOverextended: extPct !== null && extPct > 8.0,
  };
}

