export type EntrySetupType = "VOLUME_BREAKOUT" | "BREAKOUT_RETEST" | "SUPPORT_BOUNCE";

export type EntryClassification =
  | "BREAKOUT_CONFIRMED"
  | "RETEST_CONFIRMED"
  | "SUPPORT_BOUNCE_CONFIRMED"
  | "WATCH"
  | "WAIT"
  | "INVALIDATED";

export interface OhlcvCandle {
  timestamp: string; // ISO UTC or YYYY-MM-DD
  open: number;
  high: number;
  low: number;
  close: number;
  adjClose?: number;
  volume: number;
}

export interface EntrySetupSignal {
  symbol: string;
  setupType: EntrySetupType;
  classification: EntryClassification;
  entrySetupScore: number; // 0..100 independent of 100-pt fundamental score
  confirmationTimestamp: string;
  nextExecutableOpen: number | null;
  structuralStopLoss: number | null;
  target1: number | null;
  target2: number | null;
  riskRewardT1: number | null;
  riskRewardT2: number | null;
  atr: number | null;
  relativeVolume: number | null;
  breakoutDistancePct: number | null;
  candleQuality: number | null;
  reasons: string[];
}

export interface EntryTradeOutcome {
  symbol: string;
  setupType: EntrySetupType;
  signalTimestamp: string;
  entryTimestamp: string;
  entryPrice: number;
  stopLoss: number;
  target1: number;
  target2: number;
  exitTimestamp: string;
  exitPrice: number;
  exitReason: "GAP_THROUGH_SL" | "SL_HIT" | "TARGET_1" | "TARGET_2" | "TIME_EXIT";
  grossReturnPct: number;
  netReturnPct: number;
  rMultiple: number;
  holdingBars1h: number;
  isFalseBreakout: boolean;
  fwd1dPct: number | null;
  fwd5dPct: number | null;
  fwd10dPct: number | null;
  fwd20dPct: number | null;
  fwd60dPct: number | null;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

/**
 * Deterministically aggregates 1H candles into 4H candles (grouped by date + 4-hour IST/UTC bucket).
 */
export function aggregate1hTo4hCandles(candles1h: OhlcvCandle[]): OhlcvCandle[] {
  const buckets = new Map<string, OhlcvCandle[]>();
  for (const c of candles1h) {
    const dt = new Date(c.timestamp);
    if (!Number.isFinite(dt.getTime())) continue;
    const day = dt.toISOString().slice(0, 10);
    const bucket = Math.floor(dt.getUTCHours() / 4);
    const key = `${day}#${bucket}`;
    const arr = buckets.get(key) ?? [];
    arr.push(c);
    buckets.set(key, arr);
  }
  const out: OhlcvCandle[] = [];
  for (const bars of buckets.values()) {
    bars.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    out.push({
      timestamp: bars[bars.length - 1].timestamp,
      open: bars[0].open,
      high: Math.max(...bars.map((b) => b.high)),
      low: Math.min(...bars.map((b) => b.low)),
      close: bars[bars.length - 1].close,
      volume: bars.reduce((a, b) => a + b.volume, 0),
    });
  }
  return out.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

export function computeAtr(candles: OhlcvCandle[], period = 14): number | null {
  if (candles.length < period + 1) return null;
  let sum = 0;
  const start = candles.length - period;
  for (let i = start; i < candles.length; i++) {
    const cur = candles[i];
    const prevClose = candles[i - 1].close;
    const tr = Math.max(cur.high - cur.low, Math.abs(cur.high - prevClose), Math.abs(cur.low - prevClose));
    sum += tr;
  }
  return round2(sum / period);
}

/**
 * Simulates an entry using the NEXT executable 1H candle open after confirmation,
 * gap-through-SL at open, conservative SL-before-target ordering, and realistic slippage/costs.
 */
export function simulateEntryTradeOutcome(params: {
  signal: EntrySetupSignal;
  futureCandles1h: OhlcvCandle[];
  futureCandlesDaily: OhlcvCandle[];
  oneWayCostBps?: number;
  slippageBps?: number;
  maxHoldingBars1h?: number;
}): EntryTradeOutcome | null {
  const { signal, futureCandles1h, futureCandlesDaily } = params;
  if (
    futureCandles1h.length === 0 ||
    signal.structuralStopLoss === null ||
    signal.target1 === null ||
    signal.target2 === null
  ) {
    return null;
  }

  const slippage = (params.slippageBps ?? 8) / 10_000;
  const cost = (params.oneWayCostBps ?? 25) / 10_000;
  const maxBars = params.maxHoldingBars1h ?? 140; // ~20 trading days

  const entryBar = futureCandles1h[0];
  const entryPrice = round2(entryBar.open * (1 + slippage));
  const sl = signal.structuralStopLoss;
  const t1 = signal.target1;
  const t2 = signal.target2;
  const risk = entryPrice - sl;
  if (risk <= 0) return null;

  let exitPrice = futureCandles1h[Math.min(futureCandles1h.length - 1, maxBars - 1)].close;
  let exitTs = futureCandles1h[Math.min(futureCandles1h.length - 1, maxBars - 1)].timestamp;
  let exitReason: EntryTradeOutcome["exitReason"] = "TIME_EXIT";
  let holdingBars = Math.min(futureCandles1h.length, maxBars);

  for (let i = 0; i < Math.min(futureCandles1h.length, maxBars); i++) {
    const bar = futureCandles1h[i];
    if (bar.open <= sl) {
      exitPrice = round2(bar.open * (1 - slippage));
      exitTs = bar.timestamp;
      exitReason = "GAP_THROUGH_SL";
      holdingBars = i + 1;
      break;
    }
    if (bar.low <= sl) {
      exitPrice = round2(sl * (1 - slippage));
      exitTs = bar.timestamp;
      exitReason = "SL_HIT";
      holdingBars = i + 1;
      break;
    }
    if (bar.high >= t2) {
      exitPrice = round2(t2 * (1 - slippage));
      exitTs = bar.timestamp;
      exitReason = "TARGET_2";
      holdingBars = i + 1;
      break;
    }
    if (bar.high >= t1 && i >= 3) {
      // Partial / conservative T1 exit check if T2 not reached later
      exitPrice = round2(t1 * (1 - slippage));
      exitTs = bar.timestamp;
      exitReason = "TARGET_1";
      holdingBars = i + 1;
      break;
    }
  }

  const grossRet = ((exitPrice - entryPrice) / entryPrice) * 100;
  const netRet = grossRet - cost * 2 * 100;
  const rMult = (exitPrice - entryPrice) / risk;

  const fwd = (days: number) =>
    futureCandlesDaily.length >= days
      ? round2(((futureCandlesDaily[days - 1].close - entryPrice) / entryPrice) * 100)
      : null;

  return {
    symbol: signal.symbol,
    setupType: signal.setupType,
    signalTimestamp: signal.confirmationTimestamp,
    entryTimestamp: entryBar.timestamp,
    entryPrice,
    stopLoss: sl,
    target1: t1,
    target2: t2,
    exitTimestamp: exitTs,
    exitPrice,
    exitReason,
    grossReturnPct: round2(grossRet),
    netReturnPct: round2(netRet),
    rMultiple: round2(rMult),
    holdingBars1h: holdingBars,
    isFalseBreakout: exitReason === "SL_HIT" || exitReason === "GAP_THROUGH_SL",
    fwd1dPct: fwd(1),
    fwd5dPct: fwd(5),
    fwd10dPct: fwd(10),
    fwd20dPct: fwd(20),
    fwd60dPct: fwd(60),
  };
}

