import type { DailyCandleBar } from "../HistoricalValidationEngine.js";

export interface RelativeStrengthMetrics {
  ret20dPct: number | null;
  ret50dPct: number | null;
  ret100dPct: number | null;
  rsVsNifty20dPp: number | null;
  rsVsNifty50dPp: number | null;
  rsVsNifty100dPp: number | null;
  dailyTrendAligned: boolean;
  weeklyTrendAligned: boolean;
  distanceFrom20dHighPct: number | null;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

export function analyzeRelativeStrength(params: {
  candles: DailyCandleBar[];
  niftyCandles: DailyCandleBar[];
}): RelativeStrengthMetrics {
  const c = params.candles;
  const b = params.niftyCandles;
  const calcRet = (arr: DailyCandleBar[], d: number) =>
    arr.length > d && arr[arr.length - 1 - d].adjClose > 0
      ? ((arr[arr.length - 1].adjClose / arr[arr.length - 1 - d].adjClose) - 1) * 100
      : null;

  const r20 = calcRet(c, 20);
  const r50 = calcRet(c, 50);
  const r100 = calcRet(c, 100);
  const b20 = calcRet(b, 20);
  const b50 = calcRet(b, 50);
  const b100 = calcRet(b, 100);

  const last = c[c.length - 1];
  const sma20 = c.length >= 20 ? c.slice(-20).reduce((a, x) => a + x.adjClose, 0) / 20 : null;
  const sma50 = c.length >= 50 ? c.slice(-50).reduce((a, x) => a + x.adjClose, 0) / 50 : null;
  const sma200 = c.length >= 200 ? c.slice(-200).reduce((a, x) => a + x.adjClose, 0) / 200 : sma50;

  const dailyTrendAligned = Boolean(
    last && sma20 && sma50 && last.adjClose > sma20 && sma20 > sma50
  );
  const weeklyTrendAligned = Boolean(
    last && sma50 && sma200 && last.adjClose > sma50 && sma50 >= sma200
  );
  const high20 = c.length >= 20 ? Math.max(...c.slice(-20).map((x) => x.high)) : null;
  const dist20 = last && high20 && high20 > 0 ? round2(((last.close - high20) / high20) * 100) : null;

  return {
    ret20dPct: r20 !== null ? round2(r20) : null,
    ret50dPct: r50 !== null ? round2(r50) : null,
    ret100dPct: r100 !== null ? round2(r100) : null,
    rsVsNifty20dPp: r20 !== null && b20 !== null ? round2(r20 - b20) : null,
    rsVsNifty50dPp: r50 !== null && b50 !== null ? round2(r50 - b50) : null,
    rsVsNifty100dPp: r100 !== null && b100 !== null ? round2(r100 - b100) : null,
    dailyTrendAligned,
    weeklyTrendAligned,
    distanceFrom20dHighPct: dist20,
  };
}

