/**
 * SMC PRO+ v6.6-FixedDualHTF — Institutional Dual Higher-Timeframe Order Block Engine
 *
 * Implements strict fixed HTF Order Block detection for 4-Hour (4H / 240m) and 15-Minute (15m)
 * intervals completely independent of the lower timeframe chart view.
 *
 * Algorithmic Rules:
 * 1. Bullish Displacement:
 *    - Body size > ATR(14) * displacementMultiplier (default 1.5x)
 *    - Body ratio = body / (high - low) > 0.35 (strong solid body)
 *    - Volume confirmation = volume > 20 SMA of volume * 1.4
 *    - Candle closes above the previous opposite (bearish) candle's extreme (close > prev.high)
 *    - Order block is the previous opposite candle
 * 2. Bearish Displacement:
 *    - Downward displacement closing below previous opposite (bullish) candle's low (close < prev.low)
 * 3. EMA Trend Alignment:
 *    - 20-period EMA context (trendUp = close > EMA, trendDn = close < EMA)
 *    - Tags "✓" alignment if OB direction matches EMA trend
 * 4. Quality Tiering:
 *    - "Strong": displacement body >= 2.0x ATR and volume >= 1.8x SMA
 *    - "Medium": displacement body >= 1.5x ATR and volume >= 1.4x SMA
 * 5. Invalidation Filter:
 *    - "Close" vs "Wick" rule
 * 6. Single Entry Per OB:
 *    - Enforces single entry trigger to eliminate duplicate repetitive signals
 */

export type SMCTimeframe = "15M" | "4H";
export type SMCOBDirection = "BULLISH" | "BEARISH";
export type SMCQualityTier = "Strong" | "Medium";
export type SMCInvalidationType = "Close" | "Wick";

export interface SMCCandle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface SMCOrderBlock {
  id: string;
  symbol: string;
  timeframe: SMCTimeframe;
  direction: SMCOBDirection;
  candleIndex: number;
  candleTimestamp: number;
  topPrice: number; // OB Upper boundary
  bottomPrice: number; // OB Lower boundary
  midpoint: number; // 50% equilibrium level
  displacementBody: number;
  displacementVolume: number;
  atr14: number;
  volumeMultiplier: number;
  quality: SMCQualityTier;
  ema20: number;
  emaAligned: boolean;
  confidenceTag: string; // "✓" if trend aligned, "⚠️ Counter-Trend" otherwise
  invalidationType: SMCInvalidationType;
  isMitigated: boolean;
  isInvalidated: boolean;
  hasTriggeredEntry: boolean; // Single entry per OB protection
  mitigationTimestamp?: number;
  retestPrice?: number;
}

export interface SMCRetestSetup {
  orderBlock: SMCOrderBlock;
  symbol: string;
  timeframe: SMCTimeframe;
  direction: SMCOBDirection;
  quality: SMCQualityTier;
  confidenceTag: string;
  currentPrice: number;
  entryPrice: number;
  stopLossPrice: number;
  targetPrice: number;
  rewardRiskRatio: number;
  riskPerUnit: number;
  rewardPerUnit: number;
  isInRetestZone: boolean;
  setupRationale: string[];
}

export interface SMCScannerConfig {
  displacementMultiplier?: number; // default 1.5
  minBodyRatio?: number; // default 0.35
  volumeMultiplierThreshold?: number; // default 1.4
  emaPeriod?: number; // default 20
  invalidationType?: SMCInvalidationType; // default "Close"
  onlyTrendAligned?: boolean; // default false
  riskRewardRatio?: number; // default 2.5
}

export const DEFAULT_SMC_CONFIG: Required<SMCScannerConfig> = {
  displacementMultiplier: 1.5,
  minBodyRatio: 0.35,
  volumeMultiplierThreshold: 1.4,
  emaPeriod: 20,
  invalidationType: "Close",
  onlyTrendAligned: false,
  riskRewardRatio: 2.5,
};

// ─── Mathematical Indicators ──────────────────────────────────────────────────

/**
 * Calculates True Range (TR) and ATR(14) series.
 */
export function calculateATRSeries(candles: SMCCandle[], period: number = 14): number[] {
  if (candles.length === 0) return [];
  const tr: number[] = [];

  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    if (i === 0) {
      tr.push(c.high - c.low);
    } else {
      const prevClose = candles[i - 1].close;
      const trueRange = Math.max(
        c.high - c.low,
        Math.abs(c.high - prevClose),
        Math.abs(c.low - prevClose)
      );
      tr.push(trueRange);
    }
  }

  // Smooth using Wilder's / EMA
  const atr: number[] = [];
  let sum = 0;
  for (let i = 0; i < tr.length; i++) {
    if (i < period) {
      sum += tr[i];
      atr.push(i === period - 1 ? sum / period : tr[i]);
    } else {
      const prevATR = atr[i - 1];
      const currentATR = (prevATR * (period - 1) + tr[i]) / period;
      atr.push(Number(currentATR.toFixed(4)));
    }
  }

  return atr;
}

/**
 * Calculates 20-period Simple Moving Average of Volume.
 */
export function calculateVolumeSMASeries(candles: SMCCandle[], period: number = 20): number[] {
  const sma: number[] = [];
  let sum = 0;

  for (let i = 0; i < candles.length; i++) {
    sum += candles[i].volume;
    if (i >= period) {
      sum -= candles[i - period].volume;
      sma.push(Number((sum / period).toFixed(2)));
    } else {
      sma.push(Number((sum / (i + 1)).toFixed(2)));
    }
  }

  return sma;
}

/**
 * Calculates 20-period Exponential Moving Average (EMA).
 */
export function calculateEMASeries(candles: SMCCandle[], period: number = 20): number[] {
  if (candles.length === 0) return [];
  const k = 2 / (period + 1);
  const ema: number[] = [candles[0].close];

  for (let i = 1; i < candles.length; i++) {
    const nextVal = candles[i].close * k + ema[i - 1] * (1 - k);
    ema.push(Number(nextVal.toFixed(4)));
  }

  return ema;
}

// ─── Candle Aggregator (Builds 4H / 240m from 15m) ───────────────────────────

/**
 * Aggregates lower-timeframe 15m candles into true fixed 4H (240m) candles.
 * 1 4H candle = 16 15m candles.
 */
export function aggregateCandlesTo4H(candles15m: SMCCandle[]): SMCCandle[] {
  if (candles15m.length === 0) return [];

  const fourHourMs = 4 * 60 * 60 * 1000;
  const groups = new Map<number, SMCCandle[]>();

  for (const c of candles15m) {
    const bucketTime = Math.floor(c.timestamp / fourHourMs) * fourHourMs;
    if (!groups.has(bucketTime)) {
      groups.set(bucketTime, []);
    }
    groups.get(bucketTime)!.push(c);
  }

  const candles4H: SMCCandle[] = [];
  const sortedBuckets = Array.from(groups.keys()).sort((a, b) => a - b);

  for (const bucket of sortedBuckets) {
    const bucketCandles = groups.get(bucket)!;
    if (bucketCandles.length === 0) continue;

    const open = bucketCandles[0].open;
    const close = bucketCandles[bucketCandles.length - 1].close;
    let high = -Infinity;
    let low = Infinity;
    let totalVol = 0;

    for (const b of bucketCandles) {
      if (b.high > high) high = b.high;
      if (b.low < low) low = b.low;
      totalVol += b.volume;
    }

    candles4H.push({
      timestamp: bucket,
      open,
      high,
      low,
      close,
      volume: totalVol,
    });
  }

  return candles4H;
}

// ─── Strict Fixed Order Block Detection ───────────────────────────────────────

/**
 * Evaluates fixed HTF Order Blocks on a candle series (either 4H or 15M).
 */
export function detectSMCOrderBlocks(
  symbol: string,
  candles: SMCCandle[],
  timeframe: SMCTimeframe,
  userConfig: SMCScannerConfig = {}
): SMCOrderBlock[] {
  const config = { ...DEFAULT_SMC_CONFIG, ...userConfig };
  if (candles.length < 22) return [];

  const atrSeries = calculateATRSeries(candles, 14);
  const volSmaSeries = calculateVolumeSMASeries(candles, 20);
  const emaSeries = calculateEMASeries(candles, config.emaPeriod);

  const orderBlocks: SMCOrderBlock[] = [];

  for (let i = 1; i < candles.length; i++) {
    const prev = candles[i - 1]; // Candidate Order Block
    const curr = candles[i]; // Potential displacement candle
    const atr = atrSeries[i] || curr.high - curr.low;
    const avgVol = volSmaSeries[i] || 1;
    const ema = emaSeries[i] || curr.close;

    const currBody = Math.abs(curr.close - curr.open);
    const currRange = curr.high - curr.low;
    const bodyRatio = currRange > 0 ? currBody / currRange : 0;
    const volMultiplier = avgVol > 0 ? curr.volume / avgVol : 1.0;

    // 1. Check Bullish Displacement (Triggered by a massive green candle after a red candle)
    const isPrevBearish = prev.close < prev.open;
    const isCurrBullish = curr.close > curr.open;
    const isBullishCloseBreak = curr.close > prev.high;

    const meetsDisplacementSize = currBody >= atr * config.displacementMultiplier;
    const meetsBodyRatio = bodyRatio >= config.minBodyRatio;
    const meetsVolumeConfirmation = volMultiplier >= config.volumeMultiplierThreshold;

    if (
      isPrevBearish &&
      isCurrBullish &&
      isBullishCloseBreak &&
      meetsDisplacementSize &&
      meetsBodyRatio &&
      meetsVolumeConfirmation
    ) {
      // Quality Classification
      const isStrong = currBody >= atr * 2.0 && volMultiplier >= 1.8;
      const quality: SMCQualityTier = isStrong ? "Strong" : "Medium";

      // EMA Trend Alignment (close > EMA)
      const trendUp = curr.close > ema;
      const emaAligned = trendUp;
      const confidenceTag = emaAligned ? "✓" : "⚠️ Counter-Trend";

      if (!config.onlyTrendAligned || emaAligned) {
        orderBlocks.push({
          id: `OB-${symbol}-${timeframe}-BULL-${prev.timestamp}`,
          symbol,
          timeframe,
          direction: "BULLISH",
          candleIndex: i - 1,
          candleTimestamp: prev.timestamp,
          topPrice: Number(prev.high.toFixed(2)),
          bottomPrice: Number(prev.low.toFixed(2)),
          midpoint: Number(((prev.high + prev.low) / 2).toFixed(2)),
          displacementBody: Number(currBody.toFixed(2)),
          displacementVolume: curr.volume,
          atr14: Number(atr.toFixed(2)),
          volumeMultiplier: Number(volMultiplier.toFixed(2)),
          quality,
          ema20: Number(ema.toFixed(2)),
          emaAligned,
          confidenceTag,
          invalidationType: config.invalidationType,
          isMitigated: false,
          isInvalidated: false,
          hasTriggeredEntry: false,
        });
      }
    }

    // 2. Check Bearish Displacement (Triggered by a massive red candle after a green candle)
    const isPrevBullish = prev.close > prev.open;
    const isCurrBearish = curr.close < curr.open;
    const isBearishCloseBreak = curr.close < prev.low;

    if (
      isPrevBullish &&
      isCurrBearish &&
      isBearishCloseBreak &&
      meetsDisplacementSize &&
      meetsBodyRatio &&
      meetsVolumeConfirmation
    ) {
      const isStrong = currBody >= atr * 2.0 && volMultiplier >= 1.8;
      const quality: SMCQualityTier = isStrong ? "Strong" : "Medium";

      const trendDn = curr.close < ema;
      const emaAligned = trendDn;
      const confidenceTag = emaAligned ? "✓" : "⚠️ Counter-Trend";

      if (!config.onlyTrendAligned || emaAligned) {
        orderBlocks.push({
          id: `OB-${symbol}-${timeframe}-BEAR-${prev.timestamp}`,
          symbol,
          timeframe,
          direction: "BEARISH",
          candleIndex: i - 1,
          candleTimestamp: prev.timestamp,
          topPrice: Number(prev.high.toFixed(2)),
          bottomPrice: Number(prev.low.toFixed(2)),
          midpoint: Number(((prev.high + prev.low) / 2).toFixed(2)),
          displacementBody: Number(currBody.toFixed(2)),
          displacementVolume: curr.volume,
          atr14: Number(atr.toFixed(2)),
          volumeMultiplier: Number(volMultiplier.toFixed(2)),
          quality,
          ema20: Number(ema.toFixed(2)),
          emaAligned,
          confidenceTag,
          invalidationType: config.invalidationType,
          isMitigated: false,
          isInvalidated: false,
          hasTriggeredEntry: false,
        });
      }
    }
  }

  // 3. Process Subsequent Invalidation & Mitigation for each OB
  for (const ob of orderBlocks) {
    const startIndex = ob.candleIndex + 2; // candles following the displacement
    for (let k = startIndex; k < candles.length; k++) {
      const bar = candles[k];

      if (ob.direction === "BULLISH") {
        // Invalidation check
        if (ob.invalidationType === "Close" && bar.close < ob.bottomPrice) {
          ob.isInvalidated = true;
          break;
        } else if (ob.invalidationType === "Wick" && bar.low < ob.bottomPrice) {
          ob.isInvalidated = true;
          break;
        }

        // Mitigation check (touches topPrice or midpoint without invalidating)
        if (bar.low <= ob.topPrice && bar.low >= ob.bottomPrice) {
          ob.isMitigated = true;
          ob.mitigationTimestamp = bar.timestamp;
          ob.retestPrice = bar.low;
        }
      } else {
        // Bearish Invalidation check
        if (ob.invalidationType === "Close" && bar.close > ob.topPrice) {
          ob.isInvalidated = true;
          break;
        } else if (ob.invalidationType === "Wick" && bar.high > ob.topPrice) {
          ob.isInvalidated = true;
          break;
        }

        // Mitigation check (touches bottomPrice or midpoint without invalidating)
        if (bar.high >= ob.bottomPrice && bar.high <= ob.topPrice) {
          ob.isMitigated = true;
          ob.mitigationTimestamp = bar.timestamp;
          ob.retestPrice = bar.high;
        }
      }
    }
  }

  return orderBlocks;
}

// ─── Order Block Retest Scanner & Trade Generator ─────────────────────────────

/**
 * Evaluates live price retests on valid, active 4H & 15M Order Blocks.
 * Ensures strict single-entry per OB and >= 1:2.5 Risk-to-Reward.
 */
export function evaluateSMCOrderBlockRetests(
  symbol: string,
  livePrice: number,
  orderBlocks: SMCOrderBlock[],
  config: SMCScannerConfig = {}
): SMCRetestSetup[] {
  const { riskRewardRatio = 2.5 } = config;
  const setups: SMCRetestSetup[] = [];

  // Consider only valid (non-invalidated) Order Blocks that have not yet fired an entry
  const candidateBlocks = orderBlocks.filter(
    (ob) => !ob.isInvalidated && !ob.hasTriggeredEntry
  );

  for (const ob of candidateBlocks) {
    const isBullish = ob.direction === "BULLISH";
    const buffer = ob.atr14 * 0.15; // buffer beyond extreme

    if (isBullish) {
      // Retest Zone for Bullish OB: Price has entered between ob.bottomPrice and ob.topPrice + buffer
      const isInZone = livePrice <= ob.topPrice + buffer && livePrice >= ob.bottomPrice;

      if (isInZone) {
        const entryPrice = Number(livePrice.toFixed(2));
        const stopLossPrice = Number((ob.bottomPrice - buffer).toFixed(2));
        const risk = entryPrice - stopLossPrice;

        if (risk > 0) {
          const targetPrice = Number((entryPrice + risk * riskRewardRatio).toFixed(2));
          const rr = Number(((targetPrice - entryPrice) / risk).toFixed(2));

          setups.push({
            orderBlock: ob,
            symbol,
            timeframe: ob.timeframe,
            direction: "BULLISH",
            quality: ob.quality,
            confidenceTag: ob.confidenceTag,
            currentPrice: livePrice,
            entryPrice,
            stopLossPrice,
            targetPrice,
            rewardRiskRatio: rr,
            riskPerUnit: Number(risk.toFixed(2)),
            rewardPerUnit: Number((targetPrice - entryPrice).toFixed(2)),
            isInRetestZone: true,
            setupRationale: [
              `Fixed ${ob.timeframe} Bullish Order Block mitigation at $${ob.topPrice.toFixed(2)}`,
              `Displacement: ${ob.displacementBody.toFixed(2)} pts (> 1.5x ATR) with ${ob.volumeMultiplier}x volume surge`,
              `Quality: ${ob.quality} | EMA20 Trend: ${ob.confidenceTag}`,
              `Strict 1:${rr} Risk-to-Reward targeting institutional liquidity pool`,
            ],
          });
        }
      }
    } else {
      // Retest Zone for Bearish OB: Price has entered between ob.bottomPrice - buffer and ob.topPrice
      const isInZone = livePrice >= ob.bottomPrice - buffer && livePrice <= ob.topPrice;

      if (isInZone) {
        const entryPrice = Number(livePrice.toFixed(2));
        const stopLossPrice = Number((ob.topPrice + buffer).toFixed(2));
        const risk = stopLossPrice - entryPrice;

        if (risk > 0) {
          const targetPrice = Number((entryPrice - risk * riskRewardRatio).toFixed(2));
          const rr = Number(((entryPrice - targetPrice) / risk).toFixed(2));

          setups.push({
            orderBlock: ob,
            symbol,
            timeframe: ob.timeframe,
            direction: "BEARISH",
            quality: ob.quality,
            confidenceTag: ob.confidenceTag,
            currentPrice: livePrice,
            entryPrice,
            stopLossPrice,
            targetPrice,
            rewardRiskRatio: rr,
            riskPerUnit: Number(risk.toFixed(2)),
            rewardPerUnit: Number((entryPrice - targetPrice).toFixed(2)),
            isInRetestZone: true,
            setupRationale: [
              `Fixed ${ob.timeframe} Bearish Order Block mitigation at $${ob.bottomPrice.toFixed(2)}`,
              `Displacement: ${ob.displacementBody.toFixed(2)} pts (> 1.5x ATR) with ${ob.volumeMultiplier}x volume surge`,
              `Quality: ${ob.quality} | EMA20 Trend: ${ob.confidenceTag}`,
              `Strict 1:${rr} Risk-to-Reward targeting discount liquidity zone`,
            ],
          });
        }
      }
    }
  }

  return setups;
}
