import {
  computeAtr,
  type EntrySetupSignal,
  type OhlcvCandle,
} from "./EntrySetupTypes.js";

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

/**
 * Evaluates Strong Support Bounce setup:
 * - Daily/weekly demand/support zone from prior 40-day lows (strictly historical)
 * - 4H structure holding demand zone without breakdown
 * - 1H bullish rejection/reversal confirmation (rejects falling-knife entries)
 */
export function evaluateSupportBounceEntry(params: {
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

  if (d.length < 45 || h4.length < 10 || h1.length < 6) {
    return {
      symbol: params.symbol,
      setupType: "SUPPORT_BOUNCE",
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

  // Historical demand/support zone from prior 40 daily bars [-42 .. -2]
  const histWindow = d.slice(-42, -2);
  const supportLevel = Math.min(...histWindow.map((c) => c.low));
  const supportUpper = supportLevel * 1.02;

  const latest4h = h4[h4.length - 1];
  const latest1h = h1[h1.length - 1];
  const prev1h = h1[h1.length - 2];

  const inDemandZone = latest4h.low <= supportUpper && latest4h.close >= supportLevel * 0.99;
  const h1Body = Math.abs(latest1h.close - latest1h.open);
  const h1LowerWick = Math.min(latest1h.open, latest1h.close) - latest1h.low;
  const h1Range = latest1h.high - latest1h.low;
  const bullishRejection =
    latest1h.close > latest1h.open &&
    (h1LowerWick >= h1Body * 1.1 || latest1h.close > prev1h.high);

  if (!inDemandZone) reasons.push("NOT_AT_HISTORICAL_SUPPORT_ZONE");
  if (!bullishRejection) reasons.push("FALLING_PRICE_WITHOUT_REVERSAL_CONFIRMATION");

  const confirmed = inDemandZone && bullishRejection;
  const atr = computeAtr(d, 14);
  const entryRef = params.nextOpen1h ?? latest1h.close;
  const sl = round2(Math.min(latest4h.low, supportLevel) - (atr ?? entryRef * 0.015) * 0.35);
  const risk = entryRef - sl;

  let score = 0;
  if (inDemandZone) score += 45;
  if (bullishRejection) score += 40;
  if (latest1h.close > prev1h.high) score += 15;

  const classification = confirmed
    ? "SUPPORT_BOUNCE_CONFIRMED"
    : latest1h.close < supportLevel * 0.985
    ? "INVALIDATED"
    : "WATCH";

  return {
    symbol: params.symbol,
    setupType: "SUPPORT_BOUNCE",
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
    breakoutDistancePct: round2(((latest1h.close - supportLevel) / supportLevel) * 100),
    candleQuality: h1Range > 0 ? round2((latest1h.close - latest1h.open) / h1Range) : 0,
    reasons,
  };
}

