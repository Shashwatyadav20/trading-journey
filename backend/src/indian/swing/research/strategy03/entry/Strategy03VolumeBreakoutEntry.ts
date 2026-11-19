import {
  computeAtr,
  type EntrySetupSignal,
  type OhlcvCandle,
} from "./EntrySetupTypes.js";

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

/**
 * Evaluates Volume Breakout setup using strictly historical candles up to evaluation time:
 * - Resistance from prior 20 daily highs (excluding current bar)
 * - Confirmed close above resistance
 * - Relative volume >= threshold (1.5x or 2.0x) vs 20-session average
 */
export function evaluateVolumeBreakoutEntry(params: {
  symbol: string;
  dailyCandles: OhlcvCandle[];
  candles4h: OhlcvCandle[];
  candles1h: OhlcvCandle[];
  minRelativeVolume?: number; // 1.5 or 2.0
  nextOpen1h?: number | null;
}): EntrySetupSignal {
  const minRvol = params.minRelativeVolume ?? 1.5;
  const d = params.dailyCandles;
  const h1 = params.candles1h;
  const reasons: string[] = [];

  if (d.length < 25 || h1.length < 25) {
    return {
      symbol: params.symbol,
      setupType: "VOLUME_BREAKOUT",
      classification: "WAIT",
      entrySetupScore: 0,
      confirmationTimestamp: d[d.length - 1]?.timestamp ?? new Date().toISOString(),
      nextExecutableOpen: null,
      structuralStopLoss: null,
      target1: null,
      target2: null,
      riskRewardT1: null,
      riskRewardT2: null,
      atr: null,
      relativeVolume: null,
      breakoutDistancePct: null,
      candleQuality: null,
      reasons: ["INSUFFICIENT_MULTI_TIMEFRAME_CANDLES"],
    };
  }

  const latestDaily = d[d.length - 1];
  const prior20Daily = d.slice(-21, -1);
  const resistance = Math.max(...prior20Daily.map((c) => c.high));
  const avgVol20 = prior20Daily.reduce((a, c) => a + c.volume, 0) / prior20Daily.length;
  const rvol = avgVol20 > 0 ? round2(latestDaily.volume / avgVol20) : 0;

  const range = latestDaily.high - latestDaily.low;
  const candleQuality = range > 0 ? round2((latestDaily.close - latestDaily.open) / range) : 0;
  const breakoutDistancePct = round2(((latestDaily.close - resistance) / resistance) * 100);
  const atr = computeAtr(d, 14);

  const closedAbove = latestDaily.close > resistance * 1.002;
  const strongCandle = candleQuality >= 0.45 && latestDaily.close > latestDaily.open;
  const volConfirmed = rvol >= minRvol;
  const h1Latest = h1[h1.length - 1];
  const h1Confirmed = h1Latest.close > resistance;

  if (!closedAbove) reasons.push("NO_CONFIRMED_CLOSE_ABOVE_RESISTANCE");
  if (!strongCandle) reasons.push("WEAK_BREAKOUT_CANDLE_QUALITY");
  if (!volConfirmed) reasons.push(`RVOL_${rvol}_BELOW_${minRvol}X`);
  if (!h1Confirmed) reasons.push("1H_CLOSE_BELOW_RESISTANCE");

  const confirmed = closedAbove && strongCandle && volConfirmed && h1Confirmed;
  const entryRef = params.nextOpen1h ?? latestDaily.close;
  const sl = round2(Math.min(latestDaily.low, resistance - (atr ?? latestDaily.close * 0.02) * 0.75));
  const risk = entryRef - sl;
  const t1 = risk > 0 ? round2(entryRef + risk * 1.5) : null;
  const t2 = risk > 0 ? round2(entryRef + risk * 3.0) : null;

  let score = 0;
  if (closedAbove) score += 35;
  if (volConfirmed) score += rvol >= 2.0 ? 30 : 22;
  if (strongCandle) score += 20;
  if (h1Confirmed) score += 15;

  const classification = confirmed
    ? "BREAKOUT_CONFIRMED"
    : closedAbove && !volConfirmed
    ? "WATCH"
    : latestDaily.close < resistance * 0.95
    ? "INVALIDATED"
    : "WATCH";

  return {
    symbol: params.symbol,
    setupType: "VOLUME_BREAKOUT",
    classification,
    entrySetupScore: score,
    confirmationTimestamp: h1Latest.timestamp,
    nextExecutableOpen: params.nextOpen1h ?? null,
    structuralStopLoss: sl,
    target1: t1,
    target2: t2,
    riskRewardT1: risk > 0 ? 1.5 : null,
    riskRewardT2: risk > 0 ? 3.0 : null,
    atr,
    relativeVolume: rvol,
    breakoutDistancePct,
    candleQuality,
    reasons,
  };
}

