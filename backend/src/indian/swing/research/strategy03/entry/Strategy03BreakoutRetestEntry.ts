import {
  computeAtr,
  type EntrySetupSignal,
  type OhlcvCandle,
} from "./EntrySetupTypes.js";

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

/**
 * Evaluates Breakout + Retest setup:
 * - Prior resistance broken on Daily/4H at least 2 bars ago
 * - Price pulls back to retest [resistance * 0.985, resistance * 1.015] and holds above support
 * - 1H bullish reversal candle confirms bounce (never enters merely on touch)
 */
export function evaluateBreakoutRetestEntry(params: {
  symbol: string;
  dailyCandles: OhlcvCandle[];
  candles4h: OhlcvCandle[];
  candles1h: OhlcvCandle[];
  nextOpen1h?: number | null;
}): EntrySetupSignal {
  const d = params.dailyCandles;
  const h4 = params.candles4h;
  const h1 = params.candles1h;
  const reasons: string[] = [];

  if (d.length < 30 || h4.length < 12 || h1.length < 6) {
    return {
      symbol: params.symbol,
      setupType: "BREAKOUT_RETEST",
      classification: "WAIT",
      entrySetupScore: 0,
      confirmationTimestamp: h1[h1.length - 1]?.timestamp ?? new Date().toISOString(),
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

  // Historical resistance from daily candles [-30 .. -6]
  const baseWindow = d.slice(-30, -5);
  const resistance = Math.max(...baseWindow.map((c) => c.high));
  const recent5Daily = d.slice(-5);
  const hadPriorBreakout = recent5Daily.slice(0, 4).some((c) => c.close > resistance * 1.005);

  const latest4h = h4[h4.length - 1];
  const latest1h = h1[h1.length - 1];
  const prev1h = h1[h1.length - 2];

  const retestZoneTouched =
    latest4h.low <= resistance * 1.015 && latest4h.low >= resistance * 0.975;
  const holdingAsSupport = latest4h.close >= resistance * 0.99 && latest1h.close >= resistance * 0.995;

  const h1Range = latest1h.high - latest1h.low;
  const h1BodyRatio = h1Range > 0 ? round2((latest1h.close - latest1h.open) / h1Range) : 0;
  const bullishReversal1h =
    latest1h.close > latest1h.open &&
    latest1h.close > prev1h.high &&
    h1BodyRatio >= 0.4;

  if (!hadPriorBreakout) reasons.push("NO_PRIOR_RESISTANCE_BREAKOUT");
  if (!retestZoneTouched) reasons.push("RETEST_ZONE_NOT_TOUCHED");
  if (!holdingAsSupport) reasons.push("BROKEN_RESISTANCE_NOT_HOLDING");
  if (!bullishReversal1h) reasons.push("MISSING_1H_BULLISH_REVERSAL_CONFIRMATION");

  const confirmed = hadPriorBreakout && retestZoneTouched && holdingAsSupport && bullishReversal1h;
  const atr = computeAtr(d, 14);
  const entryRef = params.nextOpen1h ?? latest1h.close;
  const sl = round2(Math.min(latest4h.low, resistance * 0.985) - (atr ?? entryRef * 0.01) * 0.25);
  const risk = entryRef - sl;

  let score = 0;
  if (hadPriorBreakout) score += 25;
  if (retestZoneTouched) score += 25;
  if (holdingAsSupport) score += 25;
  if (bullishReversal1h) score += 25;

  const classification = confirmed
    ? "RETEST_CONFIRMED"
    : latest1h.close < resistance * 0.97
    ? "INVALIDATED"
    : "WATCH";

  return {
    symbol: params.symbol,
    setupType: "BREAKOUT_RETEST",
    classification,
    entrySetupScore: score,
    confirmationTimestamp: latest1h.timestamp,
    nextExecutableOpen: params.nextOpen1h ?? null,
    structuralStopLoss: sl,
    target1: risk > 0 ? round2(entryRef + risk * 1.5) : null,
    target2: risk > 0 ? round2(entryRef + risk * 3.0) : null,
    riskRewardT1: risk > 0 ? 1.5 : null,
    riskRewardT2: risk > 0 ? 3.0 : null,
    atr,
    relativeVolume: null,
    breakoutDistancePct: round2(((latest1h.close - resistance) / resistance) * 100),
    candleQuality: h1BodyRatio,
    reasons,
  };
}

