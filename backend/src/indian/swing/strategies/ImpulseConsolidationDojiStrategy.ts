/**
 * Swing Strategy 01 — High Volume Impulse Consolidation Doji Breakout
 *
 * Independent, additive swing strategy module.
 * Paper-only / research-only: LIVE_TRADING and BROKER_EXECUTION_ENABLED remain hard-locked false.
 */

const LIVE_TRADING = false as const;
const BROKER_EXECUTION_ENABLED = false as const;

if (LIVE_TRADING !== false || BROKER_EXECUTION_ENABLED !== false) {
  throw new Error(
    "SAFETY VIOLATION: LIVE_TRADING and BROKER_EXECUTION_ENABLED must remain false."
  );
}

export interface StrategyCandle {
  /** Unix epoch in milliseconds (or seconds; normalized internally). */
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface ImpulseConsolidationDojiConfig {
  minCandlesRequired: number;
  impulseMinCandles: number;
  impulseMaxCandles: number;
  minImpulseAtrMultiple: number;
  minImpulsePeakVolMultiple: number;
  minImpulseMeanVolMultiple: number;
  minConsolidationCandles: number;
  preferredConsolidationCandles: number;
  maxConsolidationCandles: number;
  maxBoxHeightAtrMultiple: number;
  maxConsolidationMeanVolMultiple: number;
  maxDojiBodyToRangeRatio: number;
  strictDojiBodyToRangeRatio: number;
  minBreakoutVolMultiple: number;
  maxBreakoutExtensionAtrMultiple: number;
  maxAdverseRejectionWickRatio: number;
  minBreakoutCloseInRangePct: number;
  slAtrBufferMultiple: number;
  targetRiskRewardMultiple: number;
  maxGapFromPrevCloseAtrMultiple: number;
  staleDataMaxAgeMs: number;
}

export const DEFAULT_IMPULSE_CONSOLIDATION_DOJI_CONFIG: ImpulseConsolidationDojiConfig =
  {
    minCandlesRequired: 45,
    impulseMinCandles: 1,
    impulseMaxCandles: 5,
    minImpulseAtrMultiple: 1.5,
    minImpulsePeakVolMultiple: 2.0,
    minImpulseMeanVolMultiple: 2.0,
    minConsolidationCandles: 8,
    preferredConsolidationCandles: 10,
    maxConsolidationCandles: 25,
    maxBoxHeightAtrMultiple: 2.0,
    maxConsolidationMeanVolMultiple: 0.8,
    maxDojiBodyToRangeRatio: 0.25,
    strictDojiBodyToRangeRatio: 0.15,
    minBreakoutVolMultiple: 1.5,
    maxBreakoutExtensionAtrMultiple: 1.25,
    maxAdverseRejectionWickRatio: 0.45,
    minBreakoutCloseInRangePct: 0.65,
    slAtrBufferMultiple: 0.15,
    targetRiskRewardMultiple: 2.0,
    maxGapFromPrevCloseAtrMultiple: 1.5,
    staleDataMaxAgeMs: 7 * 24 * 60 * 60 * 1000,
  };

export type StrategyDirection = "LONG" | "SHORT";

export interface ImpulseMetrics {
  candleCount: number;
  startIndex: number;
  endIndex: number;
  movePoints: number;
  moveAtrMultiple: number;
  peakVolumeMultiple: number;
  meanVolumeMultiple: number;
}

export interface ConsolidationBoxMetrics {
  candleCount: number;
  startIndex: number;
  endIndex: number;
  boxHigh: number;
  boxLow: number;
  boxHeight: number;
  boxHeightAtrMultiple: number;
  meanVolumeMultiple: number;
  meetsPreferredLength: boolean;
  priorZoneContext: "NEAR_RESISTANCE" | "NEAR_SUPPORT" | "MID_STRUCTURE";
}

export interface DojiCandleMetrics {
  index: number;
  bodyToRangeRatio: number;
  upperWickRatio: number;
  lowerWickRatio: number;
  isStrictDoji: boolean;
  isValidIndecision: boolean;
}

export interface BreakoutMetrics {
  index: number;
  closePrice: number;
  volumeMultiple: number;
  extensionBeyondBox: number;
  extensionAtrMultiple: number;
  adverseRejectionWickRatio: number;
  gapFromPrevCloseAtrMultiple: number;
  closePositionInRange: number;
}

export interface MarketBenchmarkContext {
  niftyTrend: "BULLISH" | "BEARISH" | "NEUTRAL" | "UNKNOWN";
  stockRelativeStrengthPct: number | null;
  alignedWithNifty: boolean | null;
}

export interface ImpulseConsolidationDojiSignal {
  strategyId: "IMPULSE_CONSOLIDATION_DOJI_V1";
  signalKey: string;
  symbol: string;
  direction: StrategyDirection;
  breakoutDateIso: string;
  entryPrice: number;
  stopLossPrice: number;
  invalidationLevel: number;
  targetPrice: number;
  rewardRiskRatio: number;
  atr14: number;
  volumeSma20: number;
  qualityScore: number;
  impulse: ImpulseMetrics;
  consolidation: ConsolidationBoxMetrics;
  doji: DojiCandleMetrics;
  breakout: BreakoutMetrics;
  marketContext: MarketBenchmarkContext;
  rationale: string[];
}

export interface StrategyDetectionResult {
  status: "SIGNAL" | "NO_SIGNAL" | "INSUFFICIENT_DATA" | "STALE_DATA";
  symbol: string;
  signal: ImpulseConsolidationDojiSignal | null;
  rejectionReasons: string[];
}

function normalizeTimestampMs(ts: number): number {
  return ts < 1e12 ? ts * 1000 : ts;
}

/**
 * Wilder's 14-period Average True Range (ATR14).
 */
export function calculateATR14(candles: StrategyCandle[]): number | null {
  if (candles.length < 15) return null;
  const trs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const curr = candles[i];
    const prev = candles[i - 1];
    const tr = Math.max(
      curr.high - curr.low,
      Math.abs(curr.high - prev.close),
      Math.abs(curr.low - prev.close)
    );
    if (!Number.isFinite(tr) || tr < 0) return null;
    trs.push(tr);
  }
  if (trs.length < 14) return null;
  let atr = trs.slice(0, 14).reduce((a, b) => a + b, 0) / 14;
  for (let i = 14; i < trs.length; i++) {
    atr = (atr * 13 + trs[i]) / 14;
  }
  return Number.isFinite(atr) && atr > 0 ? Math.round(atr * 10000) / 10000 : null;
}

/**
 * 20-period Simple Moving Average of volume ending at `endIndex` (exclusive or inclusive).
 */
export function calculateVolumeSMA20(
  candles: StrategyCandle[],
  endIndexInclusive: number
): number | null {
  const start = endIndexInclusive - 19;
  if (start < 0 || endIndexInclusive >= candles.length) return null;
  let sum = 0;
  for (let i = start; i <= endIndexInclusive; i++) {
    const v = candles[i].volume;
    if (!Number.isFinite(v) || v <= 0) return null;
    sum += v;
  }
  const avg = sum / 20;
  return avg > 0 ? avg : null;
}

function validateCandles(candles: StrategyCandle[]): string | null {
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    if (
      !Number.isFinite(c.open) ||
      !Number.isFinite(c.high) ||
      !Number.isFinite(c.low) ||
      !Number.isFinite(c.close) ||
      !Number.isFinite(c.volume) ||
      c.open <= 0 ||
      c.high <= 0 ||
      c.low <= 0 ||
      c.close <= 0 ||
      c.volume <= 0 ||
      c.high < c.low
    ) {
      return `Invalid OHLCV bar at index ${i}`;
    }
  }
  return null;
}

function computeBenchmarkContext(
  candles: StrategyCandle[],
  niftyCandles: StrategyCandle[] | undefined,
  direction: StrategyDirection
): MarketBenchmarkContext {
  if (!niftyCandles || niftyCandles.length < 21 || candles.length < 21) {
    return {
      niftyTrend: "UNKNOWN",
      stockRelativeStrengthPct: null,
      alignedWithNifty: null,
    };
  }
  const nLast = niftyCandles[niftyCandles.length - 1].close;
  const n20 =
    niftyCandles.slice(-20).reduce((acc, c) => acc + c.close, 0) / 20;
  const niftyRet = (nLast - niftyCandles[niftyCandles.length - 21].close) / niftyCandles[niftyCandles.length - 21].close;
  const stockRet =
    (candles[candles.length - 1].close - candles[candles.length - 21].close) /
    candles[candles.length - 21].close;
  const niftyTrend: MarketBenchmarkContext["niftyTrend"] =
    nLast > n20 * 1.002 ? "BULLISH" : nLast < n20 * 0.998 ? "BEARISH" : "NEUTRAL";
  const rsPct = Math.round((stockRet - niftyRet) * 10000) / 100;
  const alignedWithNifty =
    niftyTrend === "NEUTRAL"
      ? true
      : direction === "LONG"
        ? niftyTrend === "BULLISH"
        : niftyTrend === "BEARISH";
  return {
    niftyTrend,
    stockRelativeStrengthPct: rsPct,
    alignedWithNifty,
  };
}

function validateDojiCandle(
  candle: StrategyCandle,
  idx: number,
  config: ImpulseConsolidationDojiConfig
): DojiCandleMetrics {
  const range = Math.max(candle.high - candle.low, 1e-6);
  const body = Math.abs(candle.close - candle.open);
  const bodyToRangeRatio = Math.round((body / range) * 10000) / 10000;
  const upperWick = candle.high - Math.max(candle.open, candle.close);
  const lowerWick = Math.min(candle.open, candle.close) - candle.low;
  const upperWickRatio = Math.round((upperWick / range) * 10000) / 10000;
  const lowerWickRatio = Math.round((lowerWick / range) * 10000) / 10000;
  const isStrictDoji = bodyToRangeRatio <= config.strictDojiBodyToRangeRatio;
  const hasBalancedWicks = upperWickRatio > 0.05 && lowerWickRatio > 0.05;
  const isValidIndecision =
    bodyToRangeRatio <= config.maxDojiBodyToRangeRatio && hasBalancedWicks;

  return {
    index: idx,
    bodyToRangeRatio,
    upperWickRatio,
    lowerWickRatio,
    isStrictDoji,
    isValidIndecision,
  };
}

/**
 * Evaluates the latest completed daily candle (`candles[candles.length - 1]`) for a
 * High Volume Impulse Consolidation Doji Breakout (LONG or SHORT).
 */
export function detectImpulseConsolidationDojiSetup(params: {
  symbol: string;
  candles: StrategyCandle[];
  niftyCandles?: StrategyCandle[];
  nowMs?: number;
  config?: Partial<ImpulseConsolidationDojiConfig>;
}): StrategyDetectionResult {
  const config: ImpulseConsolidationDojiConfig = {
    ...DEFAULT_IMPULSE_CONSOLIDATION_DOJI_CONFIG,
    ...params.config,
  };
  const symbol = params.symbol.trim().toUpperCase();
  const candles = params.candles;

  if (!Array.isArray(candles) || candles.length < config.minCandlesRequired) {
    return {
      status: "INSUFFICIENT_DATA",
      symbol,
      signal: null,
      rejectionReasons: [
        `Need at least ${config.minCandlesRequired} valid candles; received ${candles?.length ?? 0}.`,
      ],
    };
  }

  const invalidReason = validateCandles(candles);
  if (invalidReason) {
    return {
      status: "INSUFFICIENT_DATA",
      symbol,
      signal: null,
      rejectionReasons: [invalidReason],
    };
  }

  const breakoutIdx = candles.length - 1;
  const breakoutCandle = candles[breakoutIdx];
  const breakoutTsMs = normalizeTimestampMs(breakoutCandle.time);
  const nowMs = params.nowMs ?? Date.now();
  if (nowMs - breakoutTsMs > config.staleDataMaxAgeMs) {
    return {
      status: "STALE_DATA",
      symbol,
      signal: null,
      rejectionReasons: [
        `Latest candle timestamp (${new Date(breakoutTsMs).toISOString()}) exceeds max age (${config.staleDataMaxAgeMs} ms).`,
      ],
    };
  }

  // Compute ATR14 up to prior candle (pre-breakout volatility) and Vol SMA20 prior to breakout
  const atr14 = calculateATR14(candles.slice(0, breakoutIdx));
  const volSma20 = calculateVolumeSMA20(candles, breakoutIdx - 1);
  if (atr14 === null || volSma20 === null) {
    return {
      status: "INSUFFICIENT_DATA",
      symbol,
      signal: null,
      rejectionReasons: ["Unable to compute ATR14 or Volume SMA20."],
    };
  }

  const rejectionReasons = new Set<string>();
  const dojiIdx = breakoutIdx - 1;
  const dojiMetrics = validateDojiCandle(candles[dojiIdx], dojiIdx, config);
  if (!dojiMetrics.isValidIndecision) {
    rejectionReasons.add(
      `Final consolidation candle is not a valid Doji/indecision candle (body/range=${dojiMetrics.bodyToRangeRatio}, upperWick=${dojiMetrics.upperWickRatio}, lowerWick=${dojiMetrics.lowerWickRatio}).`
    );
  }

  // Search consolidation lengths from preferred/longest down to minimum
  const maxLen = Math.min(config.maxConsolidationCandles, breakoutIdx - 22);
  let bestSignal: ImpulseConsolidationDojiSignal | null = null;

  for (let boxLen = maxLen; boxLen >= config.minConsolidationCandles; boxLen--) {
    const boxStart = breakoutIdx - boxLen;
    const boxEnd = breakoutIdx - 1;
    const boxCandles = candles.slice(boxStart, boxEnd + 1);

    const boxHigh = Math.max(...boxCandles.map((c) => c.high));
    const boxLow = Math.min(...boxCandles.map((c) => c.low));
    const boxHeight = boxHigh - boxLow;
    const boxHeightAtrMultiple = Math.round((boxHeight / atr14) * 100) / 100;
    const boxMeanVol =
      boxCandles.reduce((acc, c) => acc + c.volume, 0) / boxCandles.length;
    const boxMeanVolMultiple = Math.round((boxMeanVol / volSma20) * 100) / 100;

    if (boxHeightAtrMultiple > config.maxBoxHeightAtrMultiple) {
      rejectionReasons.add(
        `Consolidation box height (${boxHeightAtrMultiple}x ATR14) exceeds ${config.maxBoxHeightAtrMultiple}x ATR14.`
      );
      continue;
    }
    if (boxMeanVolMultiple >= config.maxConsolidationMeanVolMultiple) {
      rejectionReasons.add(
        `Consolidation volume did not contract (${boxMeanVolMultiple}x VolSMA20 >= ${config.maxConsolidationMeanVolMultiple}x).`
      );
      continue;
    }

    // Determine breakout direction from strict close outside box
    let direction: StrategyDirection | null = null;
    if (breakoutCandle.close > boxHigh) direction = "LONG";
    else if (breakoutCandle.close < boxLow) direction = "SHORT";
    else {
      rejectionReasons.add(
        `Breakout candle close (${breakoutCandle.close}) did not close outside box [${boxLow}, ${boxHigh}].`
      );
      continue;
    }

    // Validate prior consolidation candles didn't already suffer a failed breakout back inside
    const priorFailedBreakout = boxCandles.slice(0, -1).some((c) =>
      direction === "LONG" ? c.close > boxHigh : c.close < boxLow
    );
    if (priorFailedBreakout) {
      rejectionReasons.add("Prior failed breakout detected inside consolidation window.");
      continue;
    }

    // Breakout volume, close position, rejection wick, extension & gap filters
    const breakoutVolMultiple =
      Math.round((breakoutCandle.volume / volSma20) * 100) / 100;
    if (breakoutVolMultiple < config.minBreakoutVolMultiple) {
      rejectionReasons.add(
        `Weak breakout volume (${breakoutVolMultiple}x VolSMA20 < ${config.minBreakoutVolMultiple}x).`
      );
      continue;
    }

    const bRange = Math.max(breakoutCandle.high - breakoutCandle.low, 1e-6);
    const closePositionInRange =
      direction === "LONG"
        ? (breakoutCandle.close - breakoutCandle.low) / bRange
        : (breakoutCandle.high - breakoutCandle.close) / bRange;
    if (closePositionInRange < config.minBreakoutCloseInRangePct) {
      rejectionReasons.add(
        `Breakout close lacks directional conviction (closePosition=${Math.round(closePositionInRange * 100)}%).`
      );
      continue;
    }

    const adverseRejectionWickRatio =
      direction === "LONG"
        ? (breakoutCandle.high - Math.max(breakoutCandle.open, breakoutCandle.close)) / bRange
        : (Math.min(breakoutCandle.open, breakoutCandle.close) - breakoutCandle.low) / bRange;
    if (adverseRejectionWickRatio > config.maxAdverseRejectionWickRatio) {
      rejectionReasons.add(
        `False breakout rejection wick (${Math.round(adverseRejectionWickRatio * 100)}% > ${Math.round(config.maxAdverseRejectionWickRatio * 100)}%).`
      );
      continue;
    }

    const extensionBeyondBox =
      direction === "LONG"
        ? breakoutCandle.close - boxHigh
        : boxLow - breakoutCandle.close;
    const extensionAtrMultiple =
      Math.round((extensionBeyondBox / atr14) * 100) / 100;
    if (extensionAtrMultiple > config.maxBreakoutExtensionAtrMultiple) {
      rejectionReasons.add(
        `Overextended breakout (${extensionAtrMultiple}x ATR14 > ${config.maxBreakoutExtensionAtrMultiple}x ATR14).`
      );
      continue;
    }

    const prevClose = candles[breakoutIdx - 1].close;
    const gapFromPrevCloseAtrMultiple =
      Math.round((Math.abs(breakoutCandle.open - prevClose) / atr14) * 100) / 100;
    if (gapFromPrevCloseAtrMultiple > config.maxGapFromPrevCloseAtrMultiple) {
      rejectionReasons.add(
        `Excessive open gap (${gapFromPrevCloseAtrMultiple}x ATR14 > ${config.maxGapFromPrevCloseAtrMultiple}x ATR14).`
      );
      continue;
    }

    if (!dojiMetrics.isValidIndecision) {
      continue;
    }

    // Evaluate 1–5 candle impulse immediately preceding boxStart
    let matchedImpulse: ImpulseMetrics | null = null;
    for (
      let impLen = config.impulseMinCandles;
      impLen <= config.impulseMaxCandles;
      impLen++
    ) {
      const impEnd = boxStart - 1;
      const impStart = impEnd - impLen + 1;
      if (impStart < 20) continue;
      const impVolSma20 = calculateVolumeSMA20(candles, impStart - 1);
      if (impVolSma20 === null) continue;

      const impCandles = candles.slice(impStart, impEnd + 1);
      const netMove =
        direction === "LONG"
          ? impCandles[impCandles.length - 1].close - impCandles[0].open
          : impCandles[0].open - impCandles[impCandles.length - 1].close;
      const moveAtrMultiple = Math.round((netMove / atr14) * 100) / 100;
      const peakVol = Math.max(...impCandles.map((c) => c.volume));
      const meanVol =
        impCandles.reduce((acc, c) => acc + c.volume, 0) / impCandles.length;
      const peakVolumeMultiple = Math.round((peakVol / impVolSma20) * 100) / 100;
      const meanVolumeMultiple = Math.round((meanVol / impVolSma20) * 100) / 100;

      if (
        moveAtrMultiple >= config.minImpulseAtrMultiple &&
        peakVolumeMultiple >= config.minImpulsePeakVolMultiple &&
        meanVolumeMultiple >= config.minImpulseMeanVolMultiple
      ) {
        matchedImpulse = {
          candleCount: impLen,
          startIndex: impStart,
          endIndex: impEnd,
          movePoints: Math.round(netMove * 100) / 100,
          moveAtrMultiple,
          peakVolumeMultiple,
          meanVolumeMultiple,
        };
        break;
      } else {
        if (moveAtrMultiple < config.minImpulseAtrMultiple) {
          rejectionReasons.add(
            `Impulse size (${moveAtrMultiple}x ATR14) below ${config.minImpulseAtrMultiple}x ATR14.`
          );
        }
        if (
          peakVolumeMultiple < config.minImpulsePeakVolMultiple ||
          meanVolumeMultiple < config.minImpulseMeanVolMultiple
        ) {
          rejectionReasons.add(
            `Insufficient impulse volume (peak=${peakVolumeMultiple}x, mean=${meanVolumeMultiple}x < 2.0x VolSMA20).`
          );
        }
      }
    }

    if (!matchedImpulse) continue;

    // Context vs prior 20 candles before impulse
    const preLookback = candles.slice(Math.max(0, matchedImpulse.startIndex - 20), matchedImpulse.startIndex);
    const priorHigh = preLookback.length > 0 ? Math.max(...preLookback.map((c) => c.high)) : boxHigh;
    const priorLow = preLookback.length > 0 ? Math.min(...preLookback.map((c) => c.low)) : boxLow;
    const priorZoneContext: ConsolidationBoxMetrics["priorZoneContext"] =
      Math.abs(boxHigh - priorHigh) <= atr14
        ? "NEAR_RESISTANCE"
        : Math.abs(boxLow - priorLow) <= atr14
          ? "NEAR_SUPPORT"
          : "MID_STRUCTURE";

    const entryPrice = Math.round(breakoutCandle.close * 100) / 100;
    const invalidationLevel =
      direction === "LONG"
        ? Math.min(boxLow, candles[dojiIdx].low)
        : Math.max(boxHigh, candles[dojiIdx].high);
    const stopLossPrice =
      direction === "LONG"
        ? Math.round((invalidationLevel - config.slAtrBufferMultiple * atr14) * 100) / 100
        : Math.round((invalidationLevel + config.slAtrBufferMultiple * atr14) * 100) / 100;
    const riskDist = Math.abs(entryPrice - stopLossPrice);
    const targetPrice =
      direction === "LONG"
        ? Math.round((entryPrice + riskDist * config.targetRiskRewardMultiple) * 100) / 100
        : Math.round((entryPrice - riskDist * config.targetRiskRewardMultiple) * 100) / 100;

    const marketContext = computeBenchmarkContext(
      candles,
      params.niftyCandles,
      direction
    );

    const qualityScore = Math.min(
      100,
      Math.round(
        50 +
          (boxLen >= config.preferredConsolidationCandles ? 12 : 6) +
          (dojiMetrics.isStrictDoji ? 10 : 5) +
          Math.min(15, breakoutVolMultiple * 5) +
          (marketContext.alignedWithNifty ? 8 : 0) +
          (boxHeightAtrMultiple <= 1.5 ? 5 : 0)
      )
    );

    const breakoutDateIso = new Date(breakoutTsMs).toISOString();
    const dateKey = breakoutDateIso.slice(0, 10);

    bestSignal = {
      strategyId: "IMPULSE_CONSOLIDATION_DOJI_V1",
      signalKey: `${symbol}:${direction}:${dateKey}`,
      symbol,
      direction,
      breakoutDateIso,
      entryPrice,
      stopLossPrice,
      invalidationLevel: Math.round(invalidationLevel * 100) / 100,
      targetPrice,
      rewardRiskRatio: config.targetRiskRewardMultiple,
      atr14,
      volumeSma20: Math.round(volSma20),
      qualityScore,
      impulse: matchedImpulse,
      consolidation: {
        candleCount: boxLen,
        startIndex: boxStart,
        endIndex: boxEnd,
        boxHigh: Math.round(boxHigh * 100) / 100,
        boxLow: Math.round(boxLow * 100) / 100,
        boxHeight: Math.round(boxHeight * 100) / 100,
        boxHeightAtrMultiple,
        meanVolumeMultiple: boxMeanVolMultiple,
        meetsPreferredLength: boxLen >= config.preferredConsolidationCandles,
        priorZoneContext,
      },
      doji: dojiMetrics,
      breakout: {
        index: breakoutIdx,
        closePrice: entryPrice,
        volumeMultiple: breakoutVolMultiple,
        extensionBeyondBox: Math.round(extensionBeyondBox * 100) / 100,
        extensionAtrMultiple,
        adverseRejectionWickRatio,
        gapFromPrevCloseAtrMultiple,
        closePositionInRange: Math.round(closePositionInRange * 10000) / 10000,
      },
      marketContext,
      rationale: [
        `${direction} ${matchedImpulse.candleCount}-candle impulse (${matchedImpulse.moveAtrMultiple}x ATR14) at ${matchedImpulse.peakVolumeMultiple}x peak / ${matchedImpulse.meanVolumeMultiple}x mean VolSMA20.`,
        `${boxLen}-candle tight consolidation box (${boxHeightAtrMultiple}x ATR14) with volume contraction (${boxMeanVolMultiple}x VolSMA20).`,
        `Final consolidation candle Doji/indecision (body/range=${dojiMetrics.bodyToRangeRatio}).`,
        `Breakout close at ₹${entryPrice} with ${breakoutVolMultiple}x VolSMA20 expansion.`,
      ],
    };
    break;
  }

  if (!bestSignal) {
    return {
      status: "NO_SIGNAL",
      symbol,
      signal: null,
      rejectionReasons: Array.from(rejectionReasons),
    };
  }

  return {
    status: "SIGNAL",
    symbol,
    signal: bestSignal,
    rejectionReasons: [],
  };
}

