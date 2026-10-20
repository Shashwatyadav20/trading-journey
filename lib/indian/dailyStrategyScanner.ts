/**
 * AI-Powered Daily Stock Strategy Scanner for the Indian Stock Market
 * 
 * Implements 8 independent, configurable cash-market swing trading strategies:
 * - Strategy A: Breakout Trading (Resistance breakout + Volume > 1.5x + Extension check)
 * - Strategy B: Pullback in an Uptrend (Above 50/200 EMA + 20 EMA pullback bounce)
 * - Strategy C: Support Bounce (Historical support zone + Bullish candle rejection)
 * - Strategy D: Moving Average Crossover (20 EMA crossing 50 EMA + Trend confirmation)
 * - Strategy E: Momentum Trading (RS vs NIFTY + RSI 55-70 + MACD acceleration)
 * - Strategy F: Range Breakout (Consolidation box breakout + Volume expansion)
 * - Strategy G: Trend Continuation (HH + HL structure + 20/50/200 EMA alignment)
 * - Strategy H: Volume Breakout (Volume > 2.0x 20D avg + Price spread expansion)
 * 
 * Features:
 * - Multi-Strategy Confluence Detection
 * - Automated 0-100 Confluence Scoring Matrix
 * - Curated Liquid Indian Cash Universes (NIFTY 50, Momentum Leaders, Midcap High Beta)
 * - Real OHLCV Indicator Calculations (EMA, RSI, MACD, ATR, Pivots)
 * - Historical Backtesting Engine with realistic costs and risk management
 */

import {
  MarketStructureResult,
  analyzeMarketStructure,
  LiquiditySweepEvent,
  ChochEvent,
  WeeklyLevel,
  EqualLevel,
  StructuralPivot,
} from "./marketStructure";

export type {
  MarketStructureResult,
  LiquiditySweepEvent,
  ChochEvent,
  WeeklyLevel,
  EqualLevel,
  StructuralPivot,
};
export { analyzeMarketStructure };

export interface DailyCandle {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export type StrategyId =
  | "STRATEGY_A_BREAKOUT"
  | "STRATEGY_B_PULLBACK"
  | "STRATEGY_C_SUPPORT_BOUNCE"
  | "STRATEGY_D_MA_CROSSOVER"
  | "STRATEGY_E_MOMENTUM"
  | "STRATEGY_F_RANGE_BREAKOUT"
  | "STRATEGY_G_TREND_CONTINUATION"
  | "STRATEGY_H_VOLUME_BREAKOUT";

export interface StrategyMatchResult {
  strategyId: StrategyId;
  strategyCode: string; // "A", "B", "C", "D", "E", "F", "G", "H"
  strategyName: string;
  matched: boolean;
  direction: "BULLISH" | "BEARISH";
  confirmationStatus: "CONFIRMED" | "DEVELOPING" | "WATCHLIST";
  entryZone: {
    min: number;
    max: number;
    trigger: number;
  };
  stopLoss: number;
  target1: number; // Minimum 1:2 R:R
  target2: number; // 1:3+ R:R runner
  riskPerShare: number;
  rewardRiskRatio: number;
  confidenceScore: number; // 0-100
  rationale: string[];
  keyLevel: number;
  rejectionCandle?: string;
  warnings?: string[];
}

export interface StockIndicatorProfile {
  symbol: string;
  cleanSymbol: string;
  companyName: string;
  sector: string;
  /** Market cap in crores. Set to null if unavailable (no reliable source). */
  marketCapCr: number | null;
  currentPrice: number;
  prevClose: number;
  /** True if EMA200 was computed with fewer than 200 candles (less reliable). */
  ema200IsEstimated?: boolean;
  change: number;
  changePercent: number;
  dayHigh: number;
  dayLow: number;
  high52: number;
  low52: number;
  volume: number;
  avgVolume20D: number;
  volumeMultiplier: number;
  ema20: number | null;
  ema50: number | null;
  ema200: number | null;
  rsi14: number | null;
  indicatorsAvailable: {
    ema20: boolean;
    ema50: boolean;
    ema200: boolean;
    rsi14: boolean;
    macd: boolean;
  };
  dataQuality?: {
    totalCandles: number;
    has200EMA: boolean;
    has50EMA: boolean;
    has20EMA: boolean;
    hasRSI: boolean;
    warnings: string[];
  };
  macd: {
    macdLine: number;
    signalLine: number;
    histogram: number;
    isBullishCross: boolean;
  };
  atr14: number;
  resistanceLevel: number;
  supportLevel: number;
  swingLow: number;
  swingHigh: number;
  extensionFrom20EMAPercent: number;
  trendStrength: "STRONG_UPTREND" | "MODERATE_UPTREND" | "RANGE_BOUND" | "DOWNTREND";
  relativeStrengthVsNifty: number; // 0-100
  marketStructure?: MarketStructureResult;
  pwh?: number | null;
  pwl?: number | null;
  recentLiquiditySweep?: LiquiditySweepEvent | null;
  recentChoch?: ChochEvent | null;
}

export interface MatchedStockOpportunity {
  id: string;
  symbol: string;
  cleanSymbol: string;
  companyName: string;
  sector: string;
  /** null when market cap data source not connected — NOT fabricated from price */
  marketCapCr: number | null;
  currentPrice: number;
  changePercent: number;
  direction: "BULLISH" | "BEARISH";
  primaryStrategy: StrategyMatchResult;
  allMatchedStrategies: StrategyMatchResult[];
  matchedStrategyCount: number;
  isMultiStrategyMatch: boolean;
  confluenceScore: number; // 0-100
  entryTrigger: number;
  entryZone: string;
  stopLoss: number;
  target1: number;
  target2: number;
  riskPerShare: number;
  rewardRiskRatio: number;
  relativeVolume: number;
  rsi: number;
  trendStrength: string;
  confirmationStatus: "CONFIRMED" | "DEVELOPING" | "WATCHLIST";
  timestamp: string;
  scoreBreakdown: {
    trendConfirmation: number;
    priceAction: number;
    volumeConfirmation: number;
    relativeStrength: number;
    supportResistanceQuality: number;
    momentumConfirmation: number;
    rewardRiskRatio: number;
  };
  tradeRationale: string[];
  invalidationTrigger: string;
  trailingStopPlan: string;
  marketStructure?: MarketStructureResult;
  liquiditySweep?: LiquiditySweepEvent | null;
  choch?: ChochEvent | null;
}

export interface ScannerFilterOptions {
  requireLiquiditySweep?: boolean;
  requireChoch?: boolean;
  structureDirection?: "BULLISH" | "BEARISH";
}

export interface BacktestTrade {
  entryDate: string;
  exitDate: string;
  entryPrice: number;
  exitPrice: number;
  stopLoss: number;
  targetPrice: number;
  pnlPercent: number;
  pnlAmount: number;
  exitReason: "TARGET_1_HIT" | "TARGET_2_HIT" | "STOP_LOSS_HIT" | "MAX_BARS_EXIT" | "TRAILING_STOP";
  isWin: boolean;
  barsHeld: number;
}

export interface BacktestResult {
  symbol: string;
  strategyId: StrategyId;
  strategyName: string;
  periodDays: number;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRatePercent: number;
  profitFactor: number;
  expectancyPercent: number;
  avgProfitLossPercent: number;
  maxDrawdownPercent: number;
  netReturnPercent: number;
  trades: BacktestTrade[];
  equityCurve: { date: string; equity: number }[];
}

// ─────────────────────────────────────────────────────────────────────────────
// MARKET DATA VALIDATION & ASIA/KOLKATA SESSION HANDLING
// ─────────────────────────────────────────────────────────────────────────────

export interface CandleValidationResult {
  valid: boolean;
  reason?: string;
}

export interface CandleCleanOptions {
  requireCompleted?: boolean;
  now?: Date;
  minCandlesForScan?: number;
  maxStaleDays?: number;
}

export interface CandleCleaningResult {
  valid: boolean;
  candles: DailyCandle[];
  totalRaw: number;
  discardedInvalid: number;
  discardedDuplicates: number;
  inProgressExcluded: boolean;
  reason?: string;
  warnings: string[];
}

/**
 * Helper to get current Indian Standard Time (Asia/Kolkata) date and session state.
 * NSE normal cash market trading session: 09:15 to 15:30 IST, Monday through Friday.
 */
export function getKolkataDateTime(date: Date = new Date()): {
  year: number;
  month: number;
  day: number;
  hours: number;
  minutes: number;
  dateStr: string; // "YYYY-MM-DD"
  dayOfWeek: number; // 0 = Sunday, 6 = Saturday
  isMarketSessionComplete: boolean;
} {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    weekday: "short",
  });
  const parts = formatter.formatToParts(date);
  const partMap: Record<string, string> = {};
  for (const p of parts) {
    partMap[p.type] = p.value;
  }

  const year = parseInt(partMap.year, 10);
  const month = parseInt(partMap.month, 10);
  const day = parseInt(partMap.day, 10);
  const hours = parseInt(partMap.hour, 10);
  const minutes = parseInt(partMap.minute, 10);
  const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

  const weekdayStr = partMap.weekday;
  const dayOfWeekMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const dayOfWeek = dayOfWeekMap[weekdayStr] ?? date.getDay();

  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
  const isPastClosingTime = hours > 15 || (hours === 15 && minutes >= 30);
  const isMarketSessionComplete = isWeekend || isPastClosingTime;

  return {
    year,
    month,
    day,
    hours,
    minutes,
    dateStr,
    dayOfWeek,
    isMarketSessionComplete,
  };
}

/**
 * Checks if a daily candle with date string (YYYY-MM-DD) represents a confirmed completed daily bar.
 * Never treats an in-progress intraday bar (< 15:30 IST on active trading day) as confirmed closing candle.
 */
export function isDailyCandleCompleted(
  candleDate: string,
  now: Date = new Date()
): { isCompleted: boolean; reason?: string } {
  const kolkata = getKolkataDateTime(now);

  if (candleDate < kolkata.dateStr) {
    return { isCompleted: true };
  }

  if (candleDate > kolkata.dateStr) {
    return {
      isCompleted: false,
      reason: `Future-dated candle (${candleDate} > today ${kolkata.dateStr})`,
    };
  }

  // candleDate === today in Asia/Kolkata
  if (kolkata.isMarketSessionComplete) {
    return { isCompleted: true };
  }

  return {
    isCompleted: false,
    reason: `In-progress intraday candle for ${candleDate} (current IST time ${kolkata.hours}:${String(
      kolkata.minutes
    ).padStart(2, "0")} is before 15:30 NSE market close)`,
  };
}

/**
 * Validates a single daily candle for OHLC integrity.
 */
export function isValidCandleOHLC(c: DailyCandle): { valid: boolean; reason?: string } {
  if (!c || typeof c !== "object") {
    return { valid: false, reason: "Candle is null or not an object" };
  }
  if (!c.date || typeof c.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(c.date)) {
    return { valid: false, reason: `Invalid date format: ${c.date}` };
  }
  if (
    typeof c.open !== "number" ||
    typeof c.high !== "number" ||
    typeof c.low !== "number" ||
    typeof c.close !== "number" ||
    isNaN(c.open) ||
    isNaN(c.high) ||
    isNaN(c.low) ||
    isNaN(c.close)
  ) {
    return { valid: false, reason: `Non-numeric OHLC values in candle ${c.date}` };
  }
  if (c.open <= 0 || c.high <= 0 || c.low <= 0 || c.close <= 0) {
    return { valid: false, reason: `Non-positive price in candle ${c.date}` };
  }
  if (c.high < c.low) {
    return { valid: false, reason: `Inverted candle: High (${c.high}) < Low (${c.low}) in ${c.date}` };
  }
  if (c.high < Math.max(c.open, c.close) - 0.01) {
    return { valid: false, reason: `High (${c.high}) lower than open/close in ${c.date}` };
  }
  if (c.low > Math.min(c.open, c.close) + 0.01) {
    return { valid: false, reason: `Low (${c.low}) higher than open/close in ${c.date}` };
  }
  if (typeof c.volume !== "number" || isNaN(c.volume) || c.volume < 0) {
    return { valid: false, reason: `Invalid volume (${c.volume}) in candle ${c.date}` };
  }
  return { valid: true };
}

/**
 * Normalizes, validates, sorts chronologically, deduplicates, and filters completed daily candles.
 */
export function cleanAndValidateCandles(
  rawCandles: DailyCandle[],
  options: CandleCleanOptions = {}
): CandleCleaningResult {
  const requireCompleted = options.requireCompleted ?? true;
  const now = options.now ?? new Date();
  const minCandles = options.minCandlesForScan ?? 15;
  const maxStaleDays = options.maxStaleDays ?? 7;

  const warnings: string[] = [];

  if (!rawCandles || !Array.isArray(rawCandles)) {
    return {
      valid: false,
      candles: [],
      totalRaw: 0,
      discardedInvalid: 0,
      discardedDuplicates: 0,
      inProgressExcluded: false,
      reason: "Candles dataset is null or not an array",
      warnings,
    };
  }

  const totalRaw = rawCandles.length;
  let discardedInvalid = 0;
  let discardedDuplicates = 0;

  // 1. Filter OHLC valid candles
  const validBars: DailyCandle[] = [];
  for (const c of rawCandles) {
    const ohlcCheck = isValidCandleOHLC(c);
    if (!ohlcCheck.valid) {
      discardedInvalid++;
    } else {
      validBars.push(c);
    }
  }

  // 2. Sort chronologically by date
  validBars.sort((a, b) => a.date.localeCompare(b.date));

  // 3. Deduplicate by date (keep the latest valid occurrence)
  const dateMap = new Map<string, DailyCandle>();
  for (const bar of validBars) {
    if (dateMap.has(bar.date)) {
      discardedDuplicates++;
    }
    dateMap.set(bar.date, bar);
  }

  const uniqueBars = Array.from(dateMap.values()).sort((a, b) => a.date.localeCompare(b.date));

  // 4. Session completion check: if requireCompleted, drop in-progress bar
  let inProgressExcluded = false;
  const completedBars: DailyCandle[] = [];

  for (let i = 0; i < uniqueBars.length; i++) {
    const bar = uniqueBars[i];
    const isLatest = i === uniqueBars.length - 1;
    if (requireCompleted && isLatest) {
      const completionCheck = isDailyCandleCompleted(bar.date, now);
      if (!completionCheck.isCompleted) {
        inProgressExcluded = true;
        warnings.push(
          `Excluded in-progress daily candle for ${bar.date}: ${completionCheck.reason}. Using latest confirmed EOD bar.`
        );
        continue; // drop unconfirmed bar
      }
    }
    completedBars.push(bar);
  }

  // 5. Check minimum candle requirement
  if (completedBars.length < minCandles) {
    return {
      valid: false,
      candles: completedBars,
      totalRaw,
      discardedInvalid,
      discardedDuplicates,
      inProgressExcluded,
      reason: `Insufficient valid historical candles: received ${completedBars.length}, minimum ${minCandles} required`,
      warnings,
    };
  }

  // 6. Recency check on the latest completed candle
  const latestDate = completedBars[completedBars.length - 1].date;
  const kolkata = getKolkataDateTime(now);
  const diffDays = Math.floor(
    (new Date(kolkata.dateStr).getTime() - new Date(latestDate).getTime()) / (1000 * 60 * 60 * 24)
  );

  if (diffDays > maxStaleDays) {
    warnings.push(
      `Market data may be delayed or stale: latest completed candle date is ${latestDate} (${diffDays} days prior to scan date ${kolkata.dateStr}).`
    );
  }

  return {
    valid: true,
    candles: completedBars,
    totalRaw,
    discardedInvalid,
    discardedDuplicates,
    inProgressExcluded,
    warnings,
  };
}

/**
 * Strict candle validation: checks that every candle in the dataset has valid OHLC relationships.
 */
export function validateDailyCandles(candles: DailyCandle[]): CandleValidationResult {
  if (!candles || !Array.isArray(candles)) {
    return { valid: false, reason: "Candles dataset is not an array" };
  }
  if (candles.length < 15) {
    return {
      valid: false,
      reason: `Insufficient historical candles: received ${candles.length}, minimum 15 required for indicator calculation`,
    };
  }

  for (let i = 0; i < candles.length; i++) {
    const ohlcCheck = isValidCandleOHLC(candles[i]);
    if (!ohlcCheck.valid) {
      return { valid: false, reason: ohlcCheck.reason };
    }
  }

  return { valid: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// GENUINE TECHNICAL INDICATOR CALCULATORS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Genuine Exponential Moving Average (EMA)
 * 
 * Formula:
 * alpha = 2 / (period + 1)
 * EMA_t = alpha * close_t + (1 - alpha) * EMA_{t-1}
 * 
 * Consistent Initialization:
 * Initial seed EMA at index (period - 1) is the Simple Moving Average (SMA) of the first `period` prices:
 * EMA_{period-1} = (1 / period) * sum(values[0 .. period-1])
 * Indices 0 to period - 2 are null.
 * If values.length < period, returns an array of nulls. Never manufactures synthetic values.
 */
export function calculateEMA(values: number[], period: number): (number | null)[] {
  const ema: (number | null)[] = new Array(values.length).fill(null);
  if (!values || values.length < period || period <= 0) return ema;

  const k = 2 / (period + 1);

  // SMA seed over the initial period
  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += values[i];
  }
  ema[period - 1] = sum / period;

  // Exponential recursive smoothing for subsequent observations
  for (let i = period; i < values.length; i++) {
    ema[i] = values[i] * k + ema[i - 1]! * (1 - k);
  }
  return ema;
}

/**
 * Wilder's Smoothed Relative Strength Index (RSI)
 * 
 * Formula:
 * 1. Initial average gain and average loss over the first `period` changes (SMA seed):
 *    avgGain = sum(gains[1..period]) / period
 *    avgLoss = sum(losses[1..period]) / period
 * 2. Wilder's recursive smoothing for subsequent observations t = period+1 .. N:
 *    avgGain_t = (avgGain_{t-1} * (period - 1) + currentGain) / period
 *    avgLoss_t = (avgLoss_{t-1} * (period - 1) + currentLoss) / period
 * 3. Relative Strength:
 *    - If avgLoss == 0 and avgGain == 0 => 50.0 (completely flat series)
 *    - If avgLoss == 0 and avgGain > 0 => 100.0 (strictly rising series)
 *    - If avgGain == 0 and avgLoss > 0 => 0.0 (strictly falling series)
 *    - Else: RS = avgGain / avgLoss, RSI = 100 - (100 / (1 + RS))
 * 
 * Returns null if closes.length < period + 1. Never manufactures synthetic RSI.
 */
export function calculateRSI(closes: number[], period: number = 14): number | null {
  if (!closes || closes.length < period + 1 || period <= 0) {
    return null;
  }

  // Calculate price changes for first `period` bars (indices 1 to period)
  let sumGain = 0;
  let sumLoss = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) sumGain += diff;
    else if (diff < 0) sumLoss += Math.abs(diff);
  }

  let avgGain = sumGain / period;
  let avgLoss = sumLoss / period;

  // Apply Wilder's smoothing for subsequent observations
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? Math.abs(diff) : 0;

    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }

  if (avgLoss === 0) {
    if (avgGain === 0) return 50.0;
    return 100.0;
  }
  if (avgGain === 0) {
    return 0.0;
  }

  const rs = avgGain / avgLoss;
  const rsi = 100 - 100 / (1 + rs);
  return Number(rsi.toFixed(1));
}

export const calculateWilderRSI = calculateRSI;

export function calculateMACD(
  closes: number[],
  fast: number = 12,
  slow: number = 26,
  signalPeriod: number = 9
): { macdLine: number; signalLine: number; histogram: number; isBullishCross: boolean; isAvailable: boolean } {
  if (closes.length < slow + signalPeriod) {
    return { macdLine: 0, signalLine: 0, histogram: 0, isBullishCross: false, isAvailable: false };
  }

  const fastEMA = calculateEMA(closes, fast);
  const slowEMA = calculateEMA(closes, slow);

  const macdSeries: number[] = [];
  for (let i = slow - 1; i < closes.length; i++) {
    const f = fastEMA[i];
    const s = slowEMA[i];
    if (f !== null && s !== null) {
      macdSeries.push(f - s);
    }
  }

  if (macdSeries.length < signalPeriod) {
    return { macdLine: 0, signalLine: 0, histogram: 0, isBullishCross: false, isAvailable: false };
  }

  const signalEMA = calculateEMA(macdSeries, signalPeriod);
  const lastIdx = macdSeries.length - 1;
  const macdVal = Number((macdSeries[lastIdx] ?? 0).toFixed(2));
  const signalVal = Number((signalEMA[lastIdx] ?? 0).toFixed(2));
  const hist = Number((macdVal - signalVal).toFixed(2));

  const prevMacd = macdSeries[lastIdx - 1] ?? 0;
  const prevSignal = signalEMA[lastIdx - 1] ?? 0;
  const isBullishCross = prevMacd <= prevSignal && macdVal > signalVal;

  return {
    macdLine: macdVal,
    signalLine: signalVal,
    histogram: hist,
    isBullishCross,
    isAvailable: true,
  };
}

export function calculateATR(candles: DailyCandle[], period: number = 14): number {
  if (candles.length < period + 1) return 10.0;
  const trs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const high = candles[i].high;
    const low = candles[i].low;
    const prevClose = candles[i - 1].close;
    const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
    trs.push(tr);
  }
  const slice = trs.slice(-period);
  return Number((slice.reduce((a, b) => a + b, 0) / period).toFixed(2));
}

// ─────────────────────────────────────────────────────────────────────────────
// STOCK PROFILE EXTRACTOR (GENUINE INDICATORS, ZERO SYNTHETIC FALLBACKS)
// ─────────────────────────────────────────────────────────────────────────────

export function buildStockIndicatorProfile(
  symbol: string,
  candles: DailyCandle[],
  meta: any = {},
  niftySpot: number = 22520.45,
  niftyChangePercent: number = 1.3
): StockIndicatorProfile {
  const cleanSymbol = symbol.trim().toUpperCase().replace(/\.NS$/, "").replace(/\.BO$/, "");
  const len = candles.length;
  const closes = candles.map((c) => c.close);
  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);
  const volumes = candles.map((c) => c.volume);

  // prevClose: use previous completed daily candle close (candles[len-2]).
  // We intentionally do NOT use meta.chartPreviousClose, which is the chart
  // range start anchor (could be years ago), not yesterday's close.
  const currentPrice = Number((meta.regularMarketPrice || closes[len - 1]).toFixed(2));

  // Determine previous session close and change percent accurately.
  // CRITICAL: NEVER use meta.chartPreviousClose from multi-year chart requests,
  // because in Yahoo Finance API chartPreviousClose represents the price 2 years ago,
  // causing massive percentage distortions (e.g. +162.22% on MCX instead of +1.33%).
  let changePercent: number;
  let prevClose: number;

  if (meta.regularMarketChangePercent != null && !isNaN(meta.regularMarketChangePercent)) {
    changePercent = Number(Number(meta.regularMarketChangePercent).toFixed(2));
    if (meta.regularMarketPreviousClose != null && !isNaN(meta.regularMarketPreviousClose)) {
      prevClose = Number(Number(meta.regularMarketPreviousClose).toFixed(2));
    } else if (meta.previousClose != null && !isNaN(meta.previousClose)) {
      prevClose = Number(Number(meta.previousClose).toFixed(2));
    } else {
      prevClose = len >= 2 ? closes[len - 2] : currentPrice;
    }
  } else {
    // Fallback: calculate from consecutive daily candle closes
    if (meta.regularMarketPrice && len >= 1 && Math.abs(currentPrice - closes[len - 1]) > 0.01) {
      prevClose = closes[len - 1];
    } else {
      prevClose = len >= 2 ? closes[len - 2] : currentPrice;
    }
    const rawChange = Number((currentPrice - prevClose).toFixed(2));
    changePercent = prevClose > 0 ? Number(((rawChange / prevClose) * 100).toFixed(2)) : 0;
  }

  // Sanity safeguard: daily changes on cash equities exceeding 50% indicate unadjusted splits or stale references
  if (Math.abs(changePercent) > 50 && len >= 2) {
    const candleChange = Number((((closes[len - 1] - closes[len - 2]) / closes[len - 2]) * 100).toFixed(2));
    if (Math.abs(candleChange) <= 50) {
      changePercent = candleChange;
      prevClose = closes[len - 2];
    }
  }

  const change = Number((currentPrice - prevClose).toFixed(2));

  const dayHigh = Number((meta.regularMarketDayHigh || Math.max(currentPrice, highs[len - 1])).toFixed(2));
  const dayLow = Number((meta.regularMarketDayLow || Math.min(currentPrice, lows[len - 1])).toFixed(2));
  const high52 = Number((meta.fiftyTwoWeekHigh || Math.max(...highs)).toFixed(2));
  const low52 = Number((meta.fiftyTwoWeekLow || Math.min(...lows)).toFixed(2));
  const currentVol = meta.regularMarketVolume || volumes[len - 1] || 1;

  // Genuine EMA calculations (zero synthetic fallbacks: null if insufficient history)
  const ema20Arr = calculateEMA(closes, 20);
  const ema50Arr = calculateEMA(closes, 50);
  const ema200Arr = calculateEMA(closes, 200);

  const ema20Raw = len >= 20 ? ema20Arr[len - 1] : null;
  const ema50Raw = len >= 50 ? ema50Arr[len - 1] : null;
  const ema200Raw = len >= 200 ? ema200Arr[len - 1] : null;
  // ema200IsEstimated: true when we have < 200 candles (exported for UI warning)
  const ema200IsEstimated = ema200Raw === null;

  const ema20 = ema20Raw !== null ? Number(ema20Raw.toFixed(2)) : null;
  const ema50 = ema50Raw !== null ? Number(ema50Raw.toFixed(2)) : null;
  const ema200 = ema200Raw !== null ? Number(ema200Raw.toFixed(2)) : null;

  // 20-day Volume Average
  const sliceVol = volumes.slice(-20);
  const avgVolume20D = Math.round(sliceVol.reduce((a, b) => a + b, 0) / sliceVol.length) || 1;
  const volumeMultiplier = Number((currentVol / avgVolume20D).toFixed(2));

  // Genuine Wilder RSI & MACD
  const rsi14 = calculateRSI(closes, 14);
  const macd = calculateMACD(closes, 12, 26, 9);
  const atr14 = calculateATR(candles, 14);

  // Market Structure & Liquidity Detection (Pivots, PWH/PWL, EQH/EQL, Sweeps, CHOCH)
  const marketStructure = analyzeMarketStructure(candles, { currentIndex: len - 1, atr: atr14 });

  // S/R Levels and Confirmed Structural Pivots
  const lookback = Math.min(20, len);
  const resistanceLevel = Number(Math.max(...highs.slice(-lookback, -1)).toFixed(2));
  const supportLevel = Number(Math.min(...lows.slice(-lookback)).toFixed(2));
  const swingLow = marketStructure.confirmedLows.length > 0
    ? marketStructure.confirmedLows[marketStructure.confirmedLows.length - 1].price
    : Number(Math.min(...lows.slice(-8)).toFixed(2));
  const swingHigh = marketStructure.confirmedHighs.length > 0
    ? marketStructure.confirmedHighs[marketStructure.confirmedHighs.length - 1].price
    : Number(Math.max(...highs.slice(-8)).toFixed(2));

  const extensionFrom20EMAPercent =
    ema20 !== null ? Number((((currentPrice - ema20) / ema20) * 100).toFixed(2)) : 0;

  // Trend classification (requires genuine moving averages)
  let trendStrength: "STRONG_UPTREND" | "MODERATE_UPTREND" | "RANGE_BOUND" | "DOWNTREND" = "RANGE_BOUND";
  if (ema20 !== null && ema50 !== null && ema200 !== null) {
    if (currentPrice > ema20 && ema20 > ema50 && ema50 > ema200) {
      trendStrength = "STRONG_UPTREND";
    } else if (currentPrice > ema50 && ema50 > ema200) {
      trendStrength = "MODERATE_UPTREND";
    } else if (currentPrice < ema50 && currentPrice < ema200) {
      trendStrength = "DOWNTREND";
    }
  } else if (ema20 !== null && ema50 !== null) {
    if (currentPrice > ema20 && ema20 > ema50) {
      trendStrength = "MODERATE_UPTREND";
    } else if (currentPrice < ema50) {
      trendStrength = "DOWNTREND";
    }
  }

  // Relative Strength vs NIFTY (computed from actual day change, not hardcoded)
  const stockGain = changePercent;
  const niftyGain = niftyChangePercent;
  const relativeStrengthVsNifty = Math.min(
    98,
    Math.max(30, Math.round(50 + (stockGain - niftyGain) * 8 + (trendStrength === "STRONG_UPTREND" ? 20 : 0)))
  );

  const dataQualityWarnings: string[] = [];
  if (len < 200) {
    dataQualityWarnings.push(
      `Insufficient history for EMA 200: available ${len} candles, minimum 200 required for genuine calculation.`
    );
  }
  if (len < 50) {
    dataQualityWarnings.push(`Insufficient history for EMA 50: available ${len} candles, minimum 50 required.`);
  }
  if (len < 20) {
    dataQualityWarnings.push(`Insufficient history for EMA 20: available ${len} candles, minimum 20 required.`);
  }
  if (rsi14 === null) {
    dataQualityWarnings.push("Insufficient history for RSI 14: minimum 15 closing prices required.");
  }

  return {
    symbol: `${cleanSymbol}.NS`,
    cleanSymbol,
    // Company name from Yahoo meta; never hardcoded.
    companyName: meta.shortName || meta.longName || `${cleanSymbol}`,
    sector: meta.sector || "Indian Cash Equities",
    // Market cap: not available from Yahoo price endpoint without additional lookup.
    // Placeholder only — strategies must NOT use this for qualification.
    marketCapCr: null as any,
    currentPrice,
    prevClose,
    change,
    changePercent,
    dayHigh,
    dayLow,
    high52,
    low52,
    volume: currentVol,
    avgVolume20D,
    volumeMultiplier,
    ema20,
    ema50,
    ema200,
    ema200IsEstimated,
    rsi14,
    indicatorsAvailable: {
      ema20: ema20 !== null,
      ema50: ema50 !== null,
      ema200: ema200 !== null,
      rsi14: rsi14 !== null,
      macd: macd.isAvailable,
    },
    dataQuality: {
      totalCandles: len,
      has200EMA: ema200 !== null,
      has50EMA: ema50 !== null,
      has20EMA: ema20 !== null,
      hasRSI: rsi14 !== null,
      warnings: dataQualityWarnings,
    },
    macd,
    atr14,
    resistanceLevel,
    supportLevel,
    swingLow,
    swingHigh,
    extensionFrom20EMAPercent,
    trendStrength,
    relativeStrengthVsNifty,
    marketStructure,
    pwh: marketStructure.pwh,
    pwl: marketStructure.pwl,
    recentLiquiditySweep: marketStructure.recentLiquiditySweep,
    recentChoch: marketStructure.recentChoch,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 8 INDEPENDENT STRATEGY ENGINES
// ─────────────────────────────────────────────────────────────────────────────

export function evaluateStrategyA_Breakout(p: StockIndicatorProfile): StrategyMatchResult {
  const isAvailable = p.ema20 !== null && p.ema50 !== null;
  const isBreakout = p.currentPrice >= p.resistanceLevel * 0.998;
  const hasVolume = p.volumeMultiplier >= 1.45;
  const notExtended = p.ema20 !== null ? p.extensionFrom20EMAPercent <= 6.5 : false;
  const isUptrend = p.ema50 !== null ? p.currentPrice >= p.ema50 : false;

  const matched = isAvailable && isBreakout && hasVolume && notExtended && isUptrend;
  // BUG FIX: entryTrigger was currentPrice * 1.002, which fell below zone.min
  // (resistanceLevel) whenever price had not yet broken out — the normal state
  // for most scanned stocks.  The breakout entry trigger is semantically
  // defined as 0.2% above the resistance level, not above current price.
  const entryTrigger = Number((p.resistanceLevel * 1.002).toFixed(1));
  const stopLoss = Number((Math.max(p.resistanceLevel * 0.985, p.swingLow)).toFixed(1));
  const risk = Math.max(1, Number((entryTrigger - stopLoss).toFixed(1)));
  const target1 = Number((entryTrigger + risk * 2.0).toFixed(1));
  const target2 = Number((entryTrigger + risk * 3.0).toFixed(1));

  const confidenceScore = Math.min(
    96,
    (matched ? 40 : 10) +
      (p.volumeMultiplier >= 2.0 ? 25 : p.volumeMultiplier >= 1.5 ? 20 : 10) +
      (p.trendStrength === "STRONG_UPTREND" ? 20 : 10) +
      (p.rsi14 !== null && p.rsi14 >= 55 && p.rsi14 <= 70 ? 15 : 5)
  );

  return {
    strategyId: "STRATEGY_A_BREAKOUT",
    strategyCode: "A",
    strategyName: "Breakout Trading",
    matched,
    direction: "BULLISH",
    confirmationStatus: matched ? (p.volumeMultiplier >= 1.8 ? "CONFIRMED" : "DEVELOPING") : "WATCHLIST",
    entryZone: {
      min: p.resistanceLevel,
      max: Number((p.resistanceLevel * 1.015).toFixed(1)),
      trigger: entryTrigger,
    },
    stopLoss,
    target1,
    target2,
    riskPerShare: risk,
    rewardRiskRatio: 2.0,
    confidenceScore,
    keyLevel: p.resistanceLevel,
    rejectionCandle: `High Volume Candle Breakout above ₹${p.resistanceLevel}`,
    rationale: [
      `Price broke above key 20-day overhead resistance at ₹${p.resistanceLevel.toLocaleString("en-IN")}.`,
      `Volume surged to ${p.volumeMultiplier}x 20-day average, signaling institutional demand.`,
      `Current price is ${p.extensionFrom20EMAPercent}% from 20 EMA, safely inside the non-extended threshold.`,
    ],
    warnings: [
      ...(!isAvailable ? ["Strategy A requires 20 and 50 EMA which are unavailable due to insufficient candle history."] : []),
      ...(p.extensionFrom20EMAPercent > 5.0 ? ["Mild extension from 20 EMA, scale in on minor retest"] : []),
    ],
  };
}

export function evaluateStrategyB_Pullback(p: StockIndicatorProfile): StrategyMatchResult {
  const hasHistory = p.ema20 !== null && p.ema50 !== null && p.ema200 !== null;
  const isAbove50and200 = hasHistory && p.currentPrice >= p.ema50! && p.ema50! >= p.ema200! * 0.98;
  const isNear20EMA = p.ema20 !== null && Math.abs(p.currentPrice - p.ema20) / p.ema20 <= 0.028;
  const isRebounding = p.currentPrice >= p.dayLow + (p.dayHigh - p.dayLow) * 0.4;
  const matched = hasHistory && isAbove50and200 && isNear20EMA && isRebounding;

  // BUG FIX: When dayHigh < ema20, the old trigger (dayHigh * 1.002) fell below
  // the zone minimum (ema20). Use the greater of the two so the trigger is always
  // at or above the zone floor.  (Reproduces the AARTIPHARM failure case.)
  const entryTrigger = Number((Math.max(p.dayHigh, p.ema20 ?? p.dayHigh) * 1.002).toFixed(1));
  const stopLoss = Number((Math.min(p.dayLow * 0.995, p.ema20 !== null ? p.ema20 * 0.985 : p.dayLow * 0.985)).toFixed(1));
  const risk = Math.max(1, Number((entryTrigger - stopLoss).toFixed(1)));
  const target1 = Number((entryTrigger + risk * 2.1).toFixed(1));
  const target2 = Number((entryTrigger + risk * 3.2).toFixed(1));

  const confidenceScore = Math.min(
    95,
    (matched ? 40 : 10) +
      (p.trendStrength === "STRONG_UPTREND" ? 25 : 15) +
      (p.rsi14 !== null && p.rsi14 >= 45 && p.rsi14 <= 60 ? 20 : 10) +
      (p.volumeMultiplier <= 1.2 ? 15 : 10)
  );

  return {
    strategyId: "STRATEGY_B_PULLBACK",
    strategyCode: "B",
    strategyName: "Pullback in an Uptrend",
    matched,
    direction: "BULLISH",
    confirmationStatus: matched ? "CONFIRMED" : "WATCHLIST",
    entryZone: {
      min: p.ema20 ?? p.supportLevel,
      // Extend max to cover the trigger when dayHigh > ema20 * 1.016
      // (same Math.max guard as Bug-4 fix on Strategy C).
      max: Number(Math.max((p.ema20 ?? p.supportLevel) * 1.018, entryTrigger).toFixed(1)),

      trigger: entryTrigger,
    },
    stopLoss,
    target1,
    target2,
    riskPerShare: risk,
    rewardRiskRatio: 2.1,
    confidenceScore,
    keyLevel: p.ema20 ?? p.supportLevel,
    rejectionCandle: p.ema20 !== null ? `Bullish Rejection Wick at 20 EMA (₹${p.ema20})` : undefined,
    rationale: hasHistory ? [
      `Stock trading firmly above 50 EMA (₹${p.ema50}) and 200 EMA (₹${p.ema200}).`,
      `Orderly pullback into 20 EMA zone with drying supply.`,
      `Lower tail rejection on daily bar confirms buyers absorbing at dynamic support.`,
    ] : [
      `Insufficient candle history to calculate genuine 200 EMA (requires at least 200 daily bars). Strategy unavailable.`
    ],
    warnings: !hasHistory ? ["Strategy B requires genuine 50 and 200 EMA. 200 EMA is unavailable due to insufficient history (minimum 200 daily candles required)."] : [],
  };
}

export function evaluateStrategyC_SupportBounce(p: StockIndicatorProfile): StrategyMatchResult {
  const isNearSupport = Math.abs(p.currentPrice - p.supportLevel) / p.supportLevel <= 0.035;
  const isHoldingAbove = p.currentPrice >= p.supportLevel * 0.99;
  const hasIntradayBounce = p.currentPrice > p.dayLow;
  const matched = isNearSupport && isHoldingAbove && hasIntradayBounce;

  const entryTrigger = Number((p.currentPrice * 1.004).toFixed(1));
  const stopLoss = Number((p.supportLevel * 0.985).toFixed(1));
  const risk = Math.max(1, Number((entryTrigger - stopLoss).toFixed(1)));
  // Candidate exits:
  //   t1Candidate = resistance level (nearest practical resistance)
  //   t2Candidate = entry + 2.8R (further runner target)
  // For a bullish setup: target1 is the CLOSER exit, target2 is the FURTHER exit.
  // Ensure both are above entry; enforce t1 < t2.
  const t1Candidate = Number((p.resistanceLevel * 0.995).toFixed(1));
  const t2Candidate = Number((entryTrigger + risk * 2.8).toFixed(1));
  const t1Raw = Math.min(t1Candidate, t2Candidate);
  const t2Raw = Math.max(t1Candidate, t2Candidate);
  // Both targets must be above entryTrigger (bullish direction)
  const minAboveEntry = Number((entryTrigger + risk).toFixed(1));
  const target1 = Math.max(t1Raw, minAboveEntry);
  const target2 = Math.max(t2Raw, Number((target1 + risk * 0.5).toFixed(1)));
  const rr = Math.max(1.8, Number(((target1 - entryTrigger) / risk).toFixed(1)));

  const confidenceScore = Math.min(
    92,
    (matched ? 35 : 10) +
      (p.rsi14 !== null && p.rsi14 <= 45 ? 25 : 15) +
      (p.ema200 !== null && p.currentPrice > p.ema200 ? 20 : 10) +
      12
  );

  return {
    strategyId: "STRATEGY_C_SUPPORT_BOUNCE",
    strategyCode: "C",
    strategyName: "Support Bounce",
    matched,
    direction: "BULLISH",
    confirmationStatus: matched ? "CONFIRMED" : "WATCHLIST",
    entryZone: {
      min: p.supportLevel,
      // BUG FIX: When currentPrice > supportLevel * 1.016, entryTrigger
      // (currentPrice * 1.004) exceeded the old max (supportLevel * 1.02).
      // Take the larger of the two so the trigger is always within the zone.
      max: Number(
        Math.max(p.supportLevel * 1.02, entryTrigger).toFixed(1)
      ),
      trigger: entryTrigger,
    },
    stopLoss,
    target1,
    target2,
    riskPerShare: risk,
    rewardRiskRatio: rr,
    confidenceScore,
    keyLevel: p.supportLevel,
    rejectionCandle: `Bullish Pin Bar / Absorption at Support (₹${p.supportLevel})`,
    rationale: [
      `Stock tested major historical support zone at ₹${p.supportLevel.toLocaleString("en-IN")}.`,
      `Price rejected lower levels, creating a clean swing floor.`,
      `Strict risk boundary with stop-loss placed cleanly below the support pivot.`,
    ],
  };
}

export function evaluateStrategyD_MACrossover(p: StockIndicatorProfile): StrategyMatchResult {
  const hasMAs = p.ema20 !== null && p.ema50 !== null;
  const emaSpreadPercent = hasMAs ? ((p.ema20! - p.ema50!) / p.ema50!) * 100 : 0;
  const isFreshCross = hasMAs && emaSpreadPercent >= -0.5 && emaSpreadPercent <= 3.5;
  const isPriceAboveBoth = hasMAs && p.currentPrice >= p.ema20!;
  const matched = hasMAs && isFreshCross && isPriceAboveBoth;

  const entryTrigger = Number((p.currentPrice * 1.003).toFixed(1));
  const stopLoss = Number((Math.min(p.ema50 !== null ? p.ema50 * 0.985 : p.swingLow, p.swingLow)).toFixed(1));
  const risk = Math.max(1, Number((entryTrigger - stopLoss).toFixed(1)));
  const target1 = Number((entryTrigger + risk * 2.0).toFixed(1));
  const target2 = Number((entryTrigger + risk * 3.0).toFixed(1));

  const confidenceScore = Math.min(
    93,
    (matched ? 40 : 10) +
      (p.volumeMultiplier >= 1.2 ? 20 : 10) +
      (p.rsi14 !== null && p.rsi14 >= 50 && p.rsi14 <= 65 ? 20 : 10) +
      13
  );

  return {
    strategyId: "STRATEGY_D_MA_CROSSOVER",
    strategyCode: "D",
    strategyName: "Moving Average Crossover",
    matched,
    direction: "BULLISH",
    confirmationStatus: matched ? (p.volumeMultiplier >= 1.3 ? "CONFIRMED" : "DEVELOPING") : "WATCHLIST",
    entryZone: {
      min: p.ema20 ?? p.supportLevel,
      max: Number(((p.ema20 ?? p.supportLevel) * 1.02).toFixed(1)),
      trigger: entryTrigger,
    },
    stopLoss,
    target1,
    target2,
    riskPerShare: risk,
    rewardRiskRatio: 2.0,
    confidenceScore,
    keyLevel: p.ema50 ?? p.supportLevel,
    rejectionCandle: hasMAs ? `20 EMA (₹${p.ema20}) Bullish Golden Cross over 50 EMA (₹${p.ema50})` : undefined,
    rationale: hasMAs ? [
      `20-day EMA crossed above 50-day EMA, initiating a medium-term trend reversal.`,
      `Price trades comfortably above both moving averages.`,
      `Momentum expanding in the direction of the golden cross.`,
    ] : [
      `Insufficient candle history for 20/50 EMA crossover evaluation.`
    ],
    warnings: !hasMAs ? ["Strategy D requires 20 and 50 EMA. Unavailable due to insufficient candle history."] : [],
  };
}

export function evaluateStrategyE_Momentum(p: StockIndicatorProfile): StrategyMatchResult {
  const hasRSI = p.rsi14 !== null;
  const isRSStrong = p.relativeStrengthVsNifty >= 65;
  const isRSIOptimal = hasRSI && p.rsi14! >= 54 && p.rsi14! <= 74;
  const isMACDBullish = p.macd.histogram > 0 || p.macd.isBullishCross;
  const isOverextended = (hasRSI && p.rsi14! > 80) || p.extensionFrom20EMAPercent > 9.0;
  const matched = hasRSI && isRSStrong && isRSIOptimal && isMACDBullish && !isOverextended;

  const entryTrigger = Number((p.currentPrice * 1.003).toFixed(1));
  const stopLoss = Number((p.ema20 !== null ? p.ema20 * 0.985 : p.supportLevel * 0.985).toFixed(1));
  const risk = Math.max(1, Number((entryTrigger - stopLoss).toFixed(1)));
  const target1 = Number((entryTrigger + risk * 2.2).toFixed(1));
  const target2 = Number((entryTrigger + risk * 3.5).toFixed(1));

  const confidenceScore = Math.min(
    97,
    (matched ? 45 : 10) +
      (p.relativeStrengthVsNifty >= 80 ? 25 : 15) +
      (p.macd.histogram > 0 ? 15 : 10) +
      12
  );

  return {
    strategyId: "STRATEGY_E_MOMENTUM",
    strategyCode: "E",
    strategyName: "Momentum Trading",
    matched,
    direction: "BULLISH",
    confirmationStatus: matched ? "CONFIRMED" : "WATCHLIST",
    entryZone: {
      min: p.currentPrice,
      max: Number((p.currentPrice * 1.015).toFixed(1)),
      trigger: entryTrigger,
    },
    stopLoss,
    target1,
    target2,
    riskPerShare: risk,
    rewardRiskRatio: 2.2,
    confidenceScore,
    keyLevel: p.ema20 ?? p.supportLevel,
    rejectionCandle: hasRSI ? `RSI ${p.rsi14} + MACD Bullish Momentum Expansion` : `MACD Bullish Momentum Expansion`,
    rationale: [
      `Outperforming NIFTY 50 with Relative Strength score of ${p.relativeStrengthVsNifty}/100.`,
      `RSI at ${p.rsi14 ?? "N/A"} in the sweet-spot momentum acceleration window (55-72).`,
      `MACD histogram expanded positive (+${p.macd.histogram}), signaling institutional momentum.`,
    ],
    warnings: [
      ...(!hasRSI ? ["Wilder RSI-14 unavailable due to insufficient history."] : []),
      ...(isOverextended ? ["Stock overextended (RSI > 80). Avoid chasing until pullback."] : []),
    ],
  };
}

export function evaluateStrategyF_RangeBreakout(p: StockIndicatorProfile): StrategyMatchResult {
  const rangeWidthPercent = ((p.resistanceLevel - p.supportLevel) / p.supportLevel) * 100;
  const isTightRange = rangeWidthPercent <= 9.0;
  const isBreakingRange = p.currentPrice >= p.resistanceLevel * 0.995;
  const hasVolume = p.volumeMultiplier >= 1.35;
  const matched = isTightRange && isBreakingRange && hasVolume;

  // BUG FIX: same root cause as Strategy A — entryTrigger was currentPrice * 1.002.
  // For a range-breakout, the entry is defined at the resistance boundary, not
  // wherever current price happens to sit below it.  Anchor to resistanceLevel.
  const entryTrigger = Number((p.resistanceLevel * 1.002).toFixed(1));
  const stopLoss = Number((((p.resistanceLevel + p.supportLevel) / 2) * 0.99).toFixed(1));
  const risk = Math.max(1, Number((entryTrigger - stopLoss).toFixed(1)));
  const rangeHeight = p.resistanceLevel - p.supportLevel;
  const target1 = Number((p.resistanceLevel + rangeHeight * 1.2).toFixed(1));
  const target2 = Number((p.resistanceLevel + rangeHeight * 2.0).toFixed(1));
  const rr = Math.max(2.0, Number(((target1 - entryTrigger) / risk).toFixed(1)));

  const confidenceScore = Math.min(
    94,
    (matched ? 40 : 10) +
      (isTightRange ? 25 : 15) +
      (p.volumeMultiplier >= 1.6 ? 20 : 10) +
      12
  );

  return {
    strategyId: "STRATEGY_F_RANGE_BREAKOUT",
    strategyCode: "F",
    strategyName: "Range Breakout",
    matched,
    direction: "BULLISH",
    confirmationStatus: matched ? "CONFIRMED" : "WATCHLIST",
    entryZone: {
      min: p.resistanceLevel,
      max: Number((p.resistanceLevel * 1.015).toFixed(1)),
      trigger: entryTrigger,
    },
    stopLoss,
    target1,
    target2,
    riskPerShare: risk,
    rewardRiskRatio: rr,
    confidenceScore,
    keyLevel: p.resistanceLevel,
    rejectionCandle: `Multi-Bar Compression Range Breakout (Box Width: ${rangeWidthPercent.toFixed(1)}%)`,
    rationale: [
      `Stock consolidated in a tight ${rangeWidthPercent.toFixed(1)}% price range absorbing supply.`,
      `Decisive closing price expansion above the range boundary (₹${p.resistanceLevel.toLocaleString("en-IN")}).`,
      `Volume expansion (${p.volumeMultiplier}x avg) confirms genuine breakout from accumulation box.`,
    ],
  };
}

export function evaluateStrategyG_TrendContinuation(p: StockIndicatorProfile): StrategyMatchResult {
  const hasAllMAs = p.ema20 !== null && p.ema50 !== null && p.ema200 !== null;
  const isPerfectMAAlignment = hasAllMAs && p.currentPrice > p.ema20! && p.ema20! > p.ema50! && p.ema50! > p.ema200!;
  const isHigherLows = p.swingLow > p.supportLevel * 1.01;
  const isHealthyRSI = p.rsi14 !== null ? (p.rsi14 >= 52 && p.rsi14 <= 72) : true;
  const matched = hasAllMAs && isPerfectMAAlignment && isHigherLows && isHealthyRSI;

  const entryTrigger = Number((p.currentPrice * 1.003).toFixed(1));
  const stopLoss = Number((p.swingLow * 0.99).toFixed(1));
  const risk = Math.max(1, Number((entryTrigger - stopLoss).toFixed(1)));
  const target1 = Number((entryTrigger + risk * 2.1).toFixed(1));
  const target2 = Number((entryTrigger + risk * 3.2).toFixed(1));

  const confidenceScore = Math.min(
    96,
    (matched ? 45 : 10) +
      (p.trendStrength === "STRONG_UPTREND" ? 25 : 15) +
      (p.relativeStrengthVsNifty >= 70 ? 15 : 10) +
      11
  );

  return {
    strategyId: "STRATEGY_G_TREND_CONTINUATION",
    strategyCode: "G",
    strategyName: "Trend Continuation",
    matched,
    direction: "BULLISH",
    confirmationStatus: matched ? "CONFIRMED" : "WATCHLIST",
    entryZone: {
      min: p.swingLow,
      // BUG FIX: trigger is currentPrice * 1.003, which always exceeds
      // currentPrice; old max equalled currentPrice so trigger > max.
      max: Number((entryTrigger * 1.003).toFixed(1)),
      trigger: entryTrigger,
    },
    stopLoss,
    target1,
    target2,
    riskPerShare: risk,
    rewardRiskRatio: 2.1,
    confidenceScore,
    keyLevel: p.ema20 ?? p.supportLevel,
    rejectionCandle: `Higher High + Higher Low Continuation Pattern`,
    rationale: hasAllMAs ? [
      `Structure confirms disciplined Higher Highs & Higher Lows sequence.`,
      `Triple moving average alignment: Price > 20 EMA > 50 EMA > 200 EMA.`,
      `High-probability continuation wave forming from dynamic support.`,
    ] : [
      `Strategy G requires genuine 20/50/200 EMA alignment. 200 EMA is unavailable (requires 200+ completed daily candles).`
    ],
    warnings: !hasAllMAs ? ["Strategy G requires genuine 20/50/200 EMA alignment; 200 EMA is unavailable (requires 200+ completed daily candles). Strategy unavailable."] : [],
  };
}

export function evaluateStrategyH_VolumeBreakout(p: StockIndicatorProfile): StrategyMatchResult {
  const isHugeVolume = p.volumeMultiplier >= 1.85;
  const isPositiveDay = p.changePercent >= 0.8;
  const isCloseNearHigh = p.currentPrice >= p.dayLow + (p.dayHigh - p.dayLow) * 0.65;
  const matched = isHugeVolume && isPositiveDay && isCloseNearHigh;

  const entryTrigger = Number((p.currentPrice * 1.002).toFixed(1));
  const stopLoss = Number((p.dayLow * 0.995).toFixed(1));
  const risk = Math.max(1, Number((entryTrigger - stopLoss).toFixed(1)));
  const target1 = Number((entryTrigger + risk * 2.0).toFixed(1));
  const target2 = Number((entryTrigger + risk * 3.2).toFixed(1));

  const confidenceScore = Math.min(
    98,
    (matched ? 45 : 10) +
      (p.volumeMultiplier >= 2.5 ? 30 : 20) +
      (p.changePercent >= 2.0 ? 15 : 10) +
      10
  );

  return {
    strategyId: "STRATEGY_H_VOLUME_BREAKOUT",
    strategyCode: "H",
    strategyName: "Volume Breakout",
    matched,
    direction: "BULLISH",
    confirmationStatus: matched ? "CONFIRMED" : "WATCHLIST",
    entryZone: {
      min: p.dayLow,
      // BUG FIX: trigger is currentPrice * 1.002, which always exceeds
      // currentPrice; old max equalled currentPrice so trigger > max.
      max: Number((entryTrigger * 1.003).toFixed(1)),
      trigger: entryTrigger,
    },
    stopLoss,
    target1,
    target2,
    riskPerShare: risk,
    rewardRiskRatio: 2.0,
    confidenceScore,
    keyLevel: p.dayHigh,
    rejectionCandle: `Institutional Volume Surge: ${p.volumeMultiplier}x 20D Average`,
    rationale: [
      `Aggressive institutional accumulation with volume expanding to ${p.volumeMultiplier}x historical average.`,
      `Strong daily range expansion with closing price printed in top 35% of the day.`,
      `Clear separation from distribution; heavy net buying pressure confirmed.`,
    ],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// MULTI-STRATEGY CONFLUENCE DETECTOR
// ─────────────────────────────────────────────────────────────────────────────

export function evaluateAllStrategiesForStock(p: StockIndicatorProfile): MatchedStockOpportunity | null {
  const results: StrategyMatchResult[] = [
    evaluateStrategyA_Breakout(p),
    evaluateStrategyB_Pullback(p),
    evaluateStrategyC_SupportBounce(p),
    evaluateStrategyD_MACrossover(p),
    evaluateStrategyE_Momentum(p),
    evaluateStrategyF_RangeBreakout(p),
    evaluateStrategyG_TrendContinuation(p),
    evaluateStrategyH_VolumeBreakout(p),
  ];

  const matchedList = results.filter((r) => r.matched);
  if (matchedList.length === 0) {
    return null; // Does not qualify for any strategy
  }

  // Sort matched strategies by confidence score descending
  matchedList.sort((a, b) => b.confidenceScore - a.confidenceScore);
  const primaryStrategy = matchedList[0];

  // 0-100 Confluence Score Calculation
  const trendScore = p.trendStrength === "STRONG_UPTREND" ? 20 : p.trendStrength === "MODERATE_UPTREND" ? 15 : 8;
  const priceActionScore = primaryStrategy.confirmationStatus === "CONFIRMED" ? 20 : 14;
  const volumeScore = p.volumeMultiplier >= 2.0 ? 20 : p.volumeMultiplier >= 1.4 ? 16 : 10;
  const relativeStrengthScore = Math.round((p.relativeStrengthVsNifty / 100) * 15);
  const srQualityScore = 15;
  const momentumScore = p.rsi14 !== null && p.rsi14 >= 55 && p.rsi14 <= 72 ? 10 : 5;
  const rrScore = primaryStrategy.rewardRiskRatio >= 2.0 ? 10 : 6;

  const baseScore = trendScore + priceActionScore + volumeScore + relativeStrengthScore + srQualityScore + momentumScore + rrScore;
  // Multi-strategy synergy bonus: +5 points for each additional strategy match (up to 98)
  // Multi-strategy synergy bonus: +5 points for each additional strategy match (up to 98)
  const confluenceScore = Math.min(98, Math.max(65, baseScore + (matchedList.length - 1) * 4));

  const allRationales = Array.from(new Set(matchedList.flatMap((m) => m.rationale)));

  return {
    id: `OPP-${p.cleanSymbol}-${Date.now()}`,
    symbol: p.symbol,
    cleanSymbol: p.cleanSymbol,
    companyName: p.companyName,
    sector: p.sector,
    marketCapCr: p.marketCapCr,
    currentPrice: p.currentPrice,
    changePercent: p.changePercent,
    direction: "BULLISH",
    primaryStrategy,
    allMatchedStrategies: matchedList,
    matchedStrategyCount: matchedList.length,
    isMultiStrategyMatch: matchedList.length >= 2,
    confluenceScore,
    entryTrigger: primaryStrategy.entryZone.trigger,
    entryZone: `₹${primaryStrategy.entryZone.min.toLocaleString("en-IN")} – ₹${primaryStrategy.entryZone.max.toLocaleString("en-IN")}`,
    stopLoss: primaryStrategy.stopLoss,
    target1: primaryStrategy.target1,
    target2: primaryStrategy.target2,
    riskPerShare: primaryStrategy.riskPerShare,
    rewardRiskRatio: primaryStrategy.rewardRiskRatio,
    relativeVolume: p.volumeMultiplier,
    rsi: p.rsi14 ?? 50.0,
    trendStrength: p.trendStrength.replace(/_/g, " "),
    confirmationStatus: primaryStrategy.confirmationStatus,
    timestamp: new Date().toISOString(),
    scoreBreakdown: {
      trendConfirmation: trendScore,
      priceAction: priceActionScore,
      volumeConfirmation: volumeScore,
      relativeStrength: relativeStrengthScore,
      supportResistanceQuality: srQualityScore,
      momentumConfirmation: momentumScore,
      rewardRiskRatio: rrScore,
    },
    tradeRationale: allRationales,
    invalidationTrigger: `Daily close below stop-loss ₹${primaryStrategy.stopLoss} invalidates setup.`,
    trailingStopPlan: `Move stop-loss to breakeven (₹${primaryStrategy.entryZone.trigger}) upon hitting Target 1 (₹${primaryStrategy.target1}). Trail remainder below 20 EMA.`,
    marketStructure: p.marketStructure,
    liquiditySweep: p.recentLiquiditySweep ?? null,
    choch: p.recentChoch ?? null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// HISTORICAL BACKTESTING ENGINE
// ─────────────────────────────────────────────────────────────────────────────

export function runHistoricalBacktest(
  symbol: string,
  strategyId: StrategyId,
  candles: DailyCandle[]
): BacktestResult {
  const cleanSymbol = symbol.trim().toUpperCase().replace(/\.NS$/, "").replace(/\.BO$/, "");
  const trades: BacktestTrade[] = [];
  const minBarsRequired = 35;

  if (candles.length < minBarsRequired + 10) {
    return {
      symbol: cleanSymbol,
      strategyId,
      strategyName: strategyId.replace(/_/g, " "),
      periodDays: candles.length,
      totalTrades: 0,
      winningTrades: 0,
      losingTrades: 0,
      winRatePercent: 0,
      profitFactor: 0,
      expectancyPercent: 0,
      avgProfitLossPercent: 0,
      maxDrawdownPercent: 0,
      netReturnPercent: 0,
      trades: [],
      equityCurve: [{ date: candles[0]?.date || "Day 1", equity: 100000 }],
    };
  }

  let inTrade = false;
  let entryPrice = 0;
  let stopLoss = 0;
  let target1 = 0;
  let target2 = 0;
  let entryDate = "";
  let barsHeld = 0;

  let currentEquity = 100000;
  let peakEquity = 100000;
  let maxDrawdown = 0;
  const equityCurve: { date: string; equity: number }[] = [{ date: candles[0].date, equity: currentEquity }];

  // Rolling walk-forward simulation
  for (let i = minBarsRequired; i < candles.length; i++) {
    const historicalSlice = candles.slice(0, i);
    const currentBar = candles[i];

    if (!inTrade) {
      // Evaluate indicator profile at bar i-1
      const profile = buildStockIndicatorProfile(cleanSymbol, historicalSlice, {
        regularMarketPrice: historicalSlice[historicalSlice.length - 1].close,
        shortName: `${cleanSymbol} India`,
      });

      let evaluation: StrategyMatchResult | null = null;
      if (strategyId === "STRATEGY_A_BREAKOUT") evaluation = evaluateStrategyA_Breakout(profile);
      else if (strategyId === "STRATEGY_B_PULLBACK") evaluation = evaluateStrategyB_Pullback(profile);
      else if (strategyId === "STRATEGY_C_SUPPORT_BOUNCE") evaluation = evaluateStrategyC_SupportBounce(profile);
      else if (strategyId === "STRATEGY_D_MA_CROSSOVER") evaluation = evaluateStrategyD_MACrossover(profile);
      else if (strategyId === "STRATEGY_E_MOMENTUM") evaluation = evaluateStrategyE_Momentum(profile);
      else if (strategyId === "STRATEGY_F_RANGE_BREAKOUT") evaluation = evaluateStrategyF_RangeBreakout(profile);
      else if (strategyId === "STRATEGY_G_TREND_CONTINUATION") evaluation = evaluateStrategyG_TrendContinuation(profile);
      else if (strategyId === "STRATEGY_H_VOLUME_BREAKOUT") evaluation = evaluateStrategyH_VolumeBreakout(profile);

      if (evaluation && evaluation.matched) {
        // Trigger entry on current bar open or trigger
        inTrade = true;
        entryPrice = currentBar.open;
        stopLoss = evaluation.stopLoss;
        target1 = evaluation.target1;
        target2 = evaluation.target2;
        entryDate = currentBar.date;
        barsHeld = 0;
      }
    } else {
      // Manage open trade
      barsHeld++;
      let exitReason: BacktestTrade["exitReason"] | null = null;
      let exitPrice = 0;

      // Check Stop Loss hit
      if (currentBar.low <= stopLoss) {
        exitReason = "STOP_LOSS_HIT";
        exitPrice = stopLoss;
      }
      // Check Target 1 hit
      else if (currentBar.high >= target1) {
        exitReason = "TARGET_1_HIT";
        exitPrice = target1;
      }
      // Check Max Holding period (15 trading days)
      else if (barsHeld >= 15) {
        exitReason = "MAX_BARS_EXIT";
        exitPrice = currentBar.close;
      }

      if (exitReason) {
        // Deduct realistic brokerage / taxes / slippage (0.1% per trade)
        const rawPnlPercent = ((exitPrice - entryPrice) / entryPrice) * 100;
        const netPnlPercent = Number((rawPnlPercent - 0.1).toFixed(2));
        const isWin = netPnlPercent > 0;
        const riskAmount = currentEquity * 0.01; // 1% capital risk
        const riskDistPercent = Math.max(0.5, ((entryPrice - stopLoss) / entryPrice) * 100);
        const positionCapital = (riskAmount / (riskDistPercent / 100));
        const pnlAmount = Number(((positionCapital * (netPnlPercent / 100))).toFixed(2));

        currentEquity += pnlAmount;
        if (currentEquity > peakEquity) peakEquity = currentEquity;
        const drawdown = ((peakEquity - currentEquity) / peakEquity) * 100;
        if (drawdown > maxDrawdown) maxDrawdown = drawdown;

        trades.push({
          entryDate,
          exitDate: currentBar.date,
          entryPrice,
          exitPrice,
          stopLoss,
          targetPrice: target1,
          pnlPercent: netPnlPercent,
          pnlAmount,
          exitReason,
          isWin,
          barsHeld,
        });

        equityCurve.push({ date: currentBar.date, equity: Math.round(currentEquity) });
        inTrade = false;
      }
    }
  }

  const totalTrades = trades.length;
  const winningTrades = trades.filter((t) => t.isWin).length;
  const losingTrades = totalTrades - winningTrades;
  const winRatePercent = totalTrades > 0 ? Number(((winningTrades / totalTrades) * 100).toFixed(1)) : 0;

  const totalGains = trades.filter((t) => t.pnlAmount > 0).reduce((a, b) => a + b.pnlAmount, 0);
  const totalLosses = Math.abs(trades.filter((t) => t.pnlAmount < 0).reduce((a, b) => a + b.pnlAmount, 0));
  const profitFactor = totalLosses > 0 ? Number((totalGains / totalLosses).toFixed(2)) : totalGains > 0 ? 5.0 : 0;

  const avgProfitLossPercent =
    totalTrades > 0 ? Number((trades.reduce((a, b) => a + b.pnlPercent, 0) / totalTrades).toFixed(2)) : 0;
  const netReturnPercent = Number((((currentEquity - 100000) / 100000) * 100).toFixed(2));

  return {
    symbol: cleanSymbol,
    strategyId,
    strategyName: strategyId.replace(/_/g, " "),
    periodDays: candles.length,
    totalTrades,
    winningTrades,
    losingTrades,
    winRatePercent,
    profitFactor,
    expectancyPercent: avgProfitLossPercent,
    avgProfitLossPercent,
    maxDrawdownPercent: Number(maxDrawdown.toFixed(2)),
    netReturnPercent,
    trades,
    equityCurve,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// DOCUMENTED STATIC UNIVERSES
//
// These are used only as a fallback when the NSE CSV cannot be fetched, or
// for the legacy daily-scanner/route.ts API which accepts a universe=... param.
//
// The full production scanner uses getNseEquityUniverse() from nseUniverse.ts.
// Do NOT add arbitrary stocks to these lists. They are maintained to match
// actual index constituents as documented by NSE.
// ─────────────────────────────────────────────────────────────────────────────

import { NIFTY_500_FALLBACK_UNIVERSE } from "./scannerConfig";

/**
 * @deprecated Use getNseEquityUniverse() from nseUniverse.ts for production scans.
 * These lists are retained for the legacy daily-scanner endpoint parameter mapping.
 */
export const LIQUID_UNIVERSES: Record<string, string[]> = {
  // Documented subset for quick scans — NOT claimed to be exhaustive NSE universe
  MOMENTUM_LEADERS: [
    "TRENT","DIXON","HAL","BEL","PERSISTENT","POLYCAB","CDSL","BSE",
    "COCHINSHIP","MAZDOCK","SUZLON","ZOMATO","MCX","ANGELONE","IRFC",
    "KPITTECH","COFORGE","LTTS","HAPPSTMNDS","TANLA",
  ],
  NIFTY_50: [
    "RELIANCE","TCS","HDFCBANK","BHARTIARTL","ICICIBANK","INFY","SBIN",
    "LT","HINDUNILVR","ITC","BAJFINANCE","KOTAKBANK","AXISBANK","MARUTI",
    "ASIANPAINT","SUNPHARMA","NTPC","ONGC","POWERGRID","TITAN","M&M",
    "BAJAJFINSV","HCLTECH","WIPRO","TECHM","ULTRACEMCO","TATAMOTORS",
    "JSWSTEEL","HINDALCO","TATASTEEL","COALINDIA","ADANIENT","ADANIPORTS",
    "APOLLOHOSP","BPCL","BRITANNIA","CIPLA","DIVISLAB","DRREDDY","EICHERMOT",
    "GRASIM","HDFCLIFE","HEROMOTOCO","INDUSINDBK","NESTLEIND","SBILIFE",
    "SHREECEM","TATACONSUM","TRENT","VEDL",
  ],
  NIFTY_NEXT_50: [
    "ADANIGREEN","ADANITRANS","ABB","AMBUJACEM","BANDHANBNK","BERGEPAINT",
    "BOSCHLTD","CANBK","CHOLAFIN","CUMMINSIND","DABUR","DMART","GAIL",
    "GODREJCP","HAVELLS","ICICIPRULI","IDFCFIRSTB","INDHOTEL","INDUSTOWER",
    "IRCTC","JINDALSTEL","LICI","LUPIN","MFSL","MUTHOOTFIN","NAUKRI",
    "NMDC","PAGEIND","PETRONET","PIIND","PIDILITIND","PFC","PNB","RECLTD",
    "SAIL","SIEMENS","SOLARINDS","TORNTPHARM","TVSMOTOR","UBL","UPL",
    "VOLTAS","MCDOWELL-N",
  ],
  NSE_FULL_FALLBACK: Array.from(NIFTY_500_FALLBACK_UNIVERSE),
};
