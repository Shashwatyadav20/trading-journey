import type { OhlcvCandle } from "../entry/EntrySetupTypes.js";
import { detectTightConsolidation, type ConsolidationDetectionResult } from "./Strategy03ConsolidationDetector.js";

export type DojiBreakoutStatus = "DOJI_BREAKOUT_CONFIRMED" | "CONSOLIDATING_WATCH" | "NO_SETUP";

export interface MomentumBreakoutEvaluation {
  symbol: string;
  status: DojiBreakoutStatus;
  consolidation: ConsolidationDetectionResult;
  breakoutCandleTimestamp: string;
  breakoutClose: number | null;
  breakoutCandleQuality: number | null;
  breakoutRvol: number | null;
  consolidationLowSl: number | null;
  target1to3: number | null;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

/**
 * Evaluates User's Personal Doji Consolidation Breakout on completed 1H/Daily candles:
 * - Requires tight consolidation (3/4/5/8 candles) with at least 1 Doji/small-body pause BEFORE breakout bar
 * - A Doji alone is NOT a buy signal; requires confirmed close above consolidationHigh with bullish candle quality
 */
export function evaluateMomentumDojiBreakout(params: {
  symbol: string;
  candles: OhlcvCandle[]; // completed candles including latest bar
  windowCandles: 3 | 4 | 5 | 8;
  minBreakoutRvol?: number;
}): MomentumBreakoutEvaluation {
  if (params.candles.length < params.windowCandles + 15) {
    return {
      symbol: params.symbol,
      status: "NO_SETUP",
      consolidation: detectTightConsolidation({ candles: [], windowCandles: params.windowCandles }),
      breakoutCandleTimestamp: params.candles[params.candles.length - 1]?.timestamp ?? "",
      breakoutClose: null,
      breakoutCandleQuality: null,
      breakoutRvol: null,
      consolidationLowSl: null,
      target1to3: null,
    };
  }

  const latest = params.candles[params.candles.length - 1];
  const priorCompleted = params.candles.slice(0, -1);
  const cons = detectTightConsolidation({
    candles: priorCompleted,
    windowCandles: params.windowCandles,
  });

  const avgVol10 = priorCompleted.slice(-10).reduce((a, c) => a + c.volume, 0) / 10;
  const rvol = avgVol10 > 0 ? round2(latest.volume / avgVol10) : 0;
  const rng = latest.high - latest.low;
  const quality = rng > 0 ? round2((latest.close - latest.open) / rng) : 0;

  const minRvol = params.minBreakoutRvol ?? 1.2;
  const brokeAbove =
    cons.detected &&
    cons.consolidationHigh !== null &&
    latest.close > cons.consolidationHigh * 1.001 &&
    latest.close > latest.open &&
    quality >= 0.45 &&
    rvol >= minRvol;

  const sl = cons.consolidationLow;
  const risk = sl !== null ? latest.close - sl : 0;
  const t3 = risk > 0 ? round2(latest.close + risk * 3.0) : null;

  const status: DojiBreakoutStatus = brokeAbove
    ? "DOJI_BREAKOUT_CONFIRMED"
    : cons.detected
    ? "CONSOLIDATING_WATCH"
    : "NO_SETUP";

  return {
    symbol: params.symbol,
    status,
    consolidation: cons,
    breakoutCandleTimestamp: latest.timestamp,
    breakoutClose: latest.close,
    breakoutCandleQuality: quality,
    breakoutRvol: rvol,
    consolidationLowSl: sl,
    target1to3: t3,
  };
}

