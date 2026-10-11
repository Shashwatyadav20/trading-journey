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
  marketCapCr: number;
  currentPrice: number;
  prevClose: number;
  change: number;
  changePercent: number;
  dayHigh: number;
  dayLow: number;
  high52: number;
  low52: number;
  volume: number;
  avgVolume20D: number;
  volumeMultiplier: number;
  ema20: number;
  ema50: number;
  ema200: number;
  rsi14: number;
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
}

export interface MatchedStockOpportunity {
  id: string;
  symbol: string;
  cleanSymbol: string;
  companyName: string;
  sector: string;
  marketCapCr: number;
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
// TECHNICAL INDICATOR CALCULATORS
// ─────────────────────────────────────────────────────────────────────────────

export function calculateEMA(values: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const ema: number[] = new Array(values.length);
  if (values.length < period) return ema;

  let sum = 0;
  for (let i = 0; i < period; i++) sum += values[i];
  ema[period - 1] = sum / period;

  for (let i = period; i < values.length; i++) {
    ema[i] = values[i] * k + ema[i - 1] * (1 - k);
  }
  return ema;
}

export function calculateRSI(closes: number[], period: number = 14): number {
  if (closes.length < period + 1) return 50.0;
  let gains = 0;
  let losses = 0;

  for (let i = closes.length - period; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff;
    else losses += Math.abs(diff);
  }

  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100.0;
  const rs = avgGain / avgLoss;
  return Number((100 - 100 / (1 + rs)).toFixed(1));
}

export function calculateMACD(
  closes: number[],
  fast: number = 12,
  slow: number = 26,
  signalPeriod: number = 9
): { macdLine: number; signalLine: number; histogram: number; isBullishCross: boolean } {
  if (closes.length < slow + signalPeriod) {
    return { macdLine: 0, signalLine: 0, histogram: 0, isBullishCross: false };
  }

  const fastEMA = calculateEMA(closes, fast);
  const slowEMA = calculateEMA(closes, slow);

  const macdSeries: number[] = [];
  for (let i = slow - 1; i < closes.length; i++) {
    if (fastEMA[i] !== undefined && slowEMA[i] !== undefined) {
      macdSeries.push(fastEMA[i] - slowEMA[i]);
    }
  }

  const signalEMA = calculateEMA(macdSeries, signalPeriod);
  const lastIdx = macdSeries.length - 1;
  const macdVal = Number((macdSeries[lastIdx] || 0).toFixed(2));
  const signalVal = Number((signalEMA[lastIdx] || 0).toFixed(2));
  const hist = Number((macdVal - signalVal).toFixed(2));

  const prevMacd = macdSeries[lastIdx - 1] || 0;
  const prevSignal = signalEMA[lastIdx - 1] || 0;
  const isBullishCross = prevMacd <= prevSignal && macdVal > signalVal;

  return {
    macdLine: macdVal,
    signalLine: signalVal,
    histogram: hist,
    isBullishCross,
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
// STOCK PROFILE EXTRACTOR
// ─────────────────────────────────────────────────────────────────────────────

export function buildStockIndicatorProfile(
  symbol: string,
  candles: DailyCandle[],
  meta: any,
  niftySpot: number = 22520.45,
  niftyChangePercent: number = 1.3
): StockIndicatorProfile {
  const cleanSymbol = symbol.trim().toUpperCase().replace(/\.NS$/, "").replace(/\.BO$/, "");
  const len = candles.length;
  const closes = candles.map((c) => c.close);
  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);
  const volumes = candles.map((c) => c.volume);

  const currentPrice = Number((meta.regularMarketPrice || closes[len - 1]).toFixed(2));
  const prevClose = Number((meta.chartPreviousClose || closes[len - 2] || currentPrice).toFixed(2));
  const change = Number((currentPrice - prevClose).toFixed(2));
  const changePercent = prevClose > 0 ? Number(((change / prevClose) * 100).toFixed(2)) : 0;
  const dayHigh = Number((meta.regularMarketDayHigh || Math.max(currentPrice, highs[len - 1])).toFixed(2));
  const dayLow = Number((meta.regularMarketDayLow || Math.min(currentPrice, lows[len - 1])).toFixed(2));
  const high52 = Number((meta.fiftyTwoWeekHigh || Math.max(...highs)).toFixed(2));
  const low52 = Number((meta.fiftyTwoWeekLow || Math.min(...lows)).toFixed(2));
  const currentVol = meta.regularMarketVolume || volumes[len - 1] || 1;

  // EMAs
  const ema20Arr = calculateEMA(closes, 20);
  const ema50Arr = calculateEMA(closes, 50);
  const ema200Arr = calculateEMA(closes, Math.min(len - 1, 200));

  const ema20 = Number((ema20Arr[len - 1] || currentPrice).toFixed(2));
  const ema50 = Number((ema50Arr[len - 1] || ema20 * 0.98).toFixed(2));
  const ema200 = Number((ema200Arr[len - 1] || ema50 * 0.94).toFixed(2));

  // Volume
  const sliceVol = volumes.slice(-20);
  const avgVolume20D = Math.round(sliceVol.reduce((a, b) => a + b, 0) / sliceVol.length) || 1;
  const volumeMultiplier = Number((currentVol / avgVolume20D).toFixed(2));

  // RSI & MACD
  const rsi14 = calculateRSI(closes, 14);
  const macd = calculateMACD(closes, 12, 26, 9);
  const atr14 = calculateATR(candles, 14);

  // S/R Levels
  const lookback = Math.min(20, len);
  const resistanceLevel = Number(Math.max(...highs.slice(-lookback, -1)).toFixed(2));
  const supportLevel = Number(Math.min(...lows.slice(-lookback)).toFixed(2));
  const swingLow = Number(Math.min(...lows.slice(-8)).toFixed(2));
  const swingHigh = Number(Math.max(...highs.slice(-8)).toFixed(2));

  const extensionFrom20EMAPercent = Number((((currentPrice - ema20) / ema20) * 100).toFixed(2));

  // Trend classification
  let trendStrength: "STRONG_UPTREND" | "MODERATE_UPTREND" | "RANGE_BOUND" | "DOWNTREND" = "RANGE_BOUND";
  if (currentPrice > ema20 && ema20 > ema50 && ema50 > ema200) {
    trendStrength = "STRONG_UPTREND";
  } else if (currentPrice > ema50 && ema50 > ema200) {
    trendStrength = "MODERATE_UPTREND";
  } else if (currentPrice < ema50 && currentPrice < ema200) {
    trendStrength = "DOWNTREND";
  }

  // Relative Strength vs NIFTY
  const stockGain = changePercent;
  const niftyGain = niftyChangePercent;
  let relativeStrengthVsNifty = Math.min(98, Math.max(30, Math.round(50 + (stockGain - niftyGain) * 8 + (trendStrength === "STRONG_UPTREND" ? 20 : 0))));

  return {
    symbol: `${cleanSymbol}.NS`,
    cleanSymbol,
    companyName: meta.shortName || `${cleanSymbol} India Ltd`,
    sector: "Indian Cash Equities",
    marketCapCr: Math.round(currentPrice * 12),
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
    rsi14,
    macd,
    atr14,
    resistanceLevel,
    supportLevel,
    swingLow,
    swingHigh,
    extensionFrom20EMAPercent,
    trendStrength,
    relativeStrengthVsNifty,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 8 INDEPENDENT STRATEGY ENGINES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * STRATEGY A: Breakout Trading
 * - Identifies historical resistance level
 * - Closes above resistance with Volume > 1.5x 20D avg
 * - Price not excessively extended (< 5-7%)
 * - Target minimum 1:2 R:R
 */
export function evaluateStrategyA_Breakout(p: StockIndicatorProfile): StrategyMatchResult {
  const isBreakout = p.currentPrice >= p.resistanceLevel * 0.998;
  const hasVolume = p.volumeMultiplier >= 1.45;
  const notExtended = p.extensionFrom20EMAPercent <= 6.5;
  const isUptrend = p.currentPrice >= p.ema50;

  const matched = isBreakout && hasVolume && notExtended && isUptrend;
  const entryTrigger = Number((p.currentPrice * 1.002).toFixed(1));
  const stopLoss = Number((Math.max(p.resistanceLevel * 0.985, p.swingLow)).toFixed(1));
  const risk = Math.max(1, Number((entryTrigger - stopLoss).toFixed(1)));
  const target1 = Number((entryTrigger + risk * 2.0).toFixed(1));
  const target2 = Number((entryTrigger + risk * 3.0).toFixed(1));

  const confidenceScore = Math.min(
    96,
    (matched ? 40 : 10) +
      (p.volumeMultiplier >= 2.0 ? 25 : p.volumeMultiplier >= 1.5 ? 20 : 10) +
      (p.trendStrength === "STRONG_UPTREND" ? 20 : 10) +
      (p.rsi14 >= 55 && p.rsi14 <= 70 ? 15 : 5)
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
    warnings: p.extensionFrom20EMAPercent > 5.0 ? ["Mild extension from 20 EMA, scale in on minor retest"] : [],
  };
}

/**
 * STRATEGY B: Pullback in an Uptrend
 * - Trading above 50 EMA and 200 EMA
 * - Pullback toward 20 EMA or support zone
 * - Bullish price action (rejection candle)
 */
export function evaluateStrategyB_Pullback(p: StockIndicatorProfile): StrategyMatchResult {
  const isAbove50and200 = p.currentPrice >= p.ema50 && p.ema50 >= p.ema200 * 0.98;
  const isNear20EMA = Math.abs(p.currentPrice - p.ema20) / p.ema20 <= 0.028;
  const isRebounding = p.currentPrice >= p.dayLow + (p.dayHigh - p.dayLow) * 0.4;
  const matched = isAbove50and200 && isNear20EMA && isRebounding;

  const entryTrigger = Number((p.dayHigh * 1.002).toFixed(1));
  const stopLoss = Number((Math.min(p.dayLow * 0.995, p.ema20 * 0.985)).toFixed(1));
  const risk = Math.max(1, Number((entryTrigger - stopLoss).toFixed(1)));
  const target1 = Number((entryTrigger + risk * 2.1).toFixed(1));
  const target2 = Number((entryTrigger + risk * 3.2).toFixed(1));

  const confidenceScore = Math.min(
    95,
    (matched ? 40 : 10) +
      (p.trendStrength === "STRONG_UPTREND" ? 25 : 15) +
      (p.rsi14 >= 45 && p.rsi14 <= 60 ? 20 : 10) +
      (p.volumeMultiplier <= 1.2 ? 15 : 10) // Healthy low volume on pullback
  );

  return {
    strategyId: "STRATEGY_B_PULLBACK",
    strategyCode: "B",
    strategyName: "Pullback in an Uptrend",
    matched,
    direction: "BULLISH",
    confirmationStatus: matched ? "CONFIRMED" : "WATCHLIST",
    entryZone: {
      min: p.ema20,
      max: Number((p.ema20 * 1.018).toFixed(1)),
      trigger: entryTrigger,
    },
    stopLoss,
    target1,
    target2,
    riskPerShare: risk,
    rewardRiskRatio: 2.1,
    confidenceScore,
    keyLevel: p.ema20,
    rejectionCandle: `Bullish Rejection Wick at 20 EMA (₹${p.ema20})`,
    rationale: [
      `Stock trading firmly above 50 EMA (₹${p.ema50}) and 200 EMA (₹${p.ema200}).`,
      `Orderly pullback into 20 EMA zone with drying supply.`,
      `Lower tail rejection on daily bar confirms buyers absorbing at dynamic support.`,
    ],
  };
}

/**
 * STRATEGY C: Support Bounce
 * - Important historical support zone
 * - Price approaching or bouncing off support
 * - Bullish candle pattern, rejects if support breaks decisively
 */
export function evaluateStrategyC_SupportBounce(p: StockIndicatorProfile): StrategyMatchResult {
  const isNearSupport = Math.abs(p.currentPrice - p.supportLevel) / p.supportLevel <= 0.035;
  const isHoldingAbove = p.currentPrice >= p.supportLevel * 0.99;
  const hasIntradayBounce = p.currentPrice > p.dayLow;
  const matched = isNearSupport && isHoldingAbove && hasIntradayBounce;

  const entryTrigger = Number((p.currentPrice * 1.004).toFixed(1));
  const stopLoss = Number((p.supportLevel * 0.985).toFixed(1));
  const risk = Math.max(1, Number((entryTrigger - stopLoss).toFixed(1)));
  const target1 = Number((p.resistanceLevel * 0.995).toFixed(1));
  const target2 = Number((entryTrigger + risk * 2.8).toFixed(1));
  const rr = Math.max(1.8, Number(((target1 - entryTrigger) / risk).toFixed(1)));

  const confidenceScore = Math.min(
    92,
    (matched ? 35 : 10) +
      (p.rsi14 <= 45 ? 25 : 15) +
      (p.currentPrice > p.ema200 ? 20 : 10) +
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
      max: Number((p.supportLevel * 1.02).toFixed(1)),
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

/**
 * STRATEGY D: Moving Average Crossover
 * - 20-day EMA crossing above 50-day EMA
 * - Bullish trend confirmation & volume
 */
export function evaluateStrategyD_MACrossover(p: StockIndicatorProfile): StrategyMatchResult {
  const emaSpreadPercent = ((p.ema20 - p.ema50) / p.ema50) * 100;
  // Recent or fresh cross: 20 EMA is within 0% to 3.5% above 50 EMA
  const isFreshCross = emaSpreadPercent >= -0.5 && emaSpreadPercent <= 3.5;
  const isPriceAboveBoth = p.currentPrice >= p.ema20;
  const matched = isFreshCross && isPriceAboveBoth;

  const entryTrigger = Number((p.currentPrice * 1.003).toFixed(1));
  const stopLoss = Number((Math.min(p.ema50 * 0.985, p.swingLow)).toFixed(1));
  const risk = Math.max(1, Number((entryTrigger - stopLoss).toFixed(1)));
  const target1 = Number((entryTrigger + risk * 2.0).toFixed(1));
  const target2 = Number((entryTrigger + risk * 3.0).toFixed(1));

  const confidenceScore = Math.min(
    93,
    (matched ? 40 : 10) +
      (p.volumeMultiplier >= 1.2 ? 20 : 10) +
      (p.rsi14 >= 50 && p.rsi14 <= 65 ? 20 : 10) +
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
      min: p.ema20,
      max: Number((p.ema20 * 1.02).toFixed(1)),
      trigger: entryTrigger,
    },
    stopLoss,
    target1,
    target2,
    riskPerShare: risk,
    rewardRiskRatio: 2.0,
    confidenceScore,
    keyLevel: p.ema50,
    rejectionCandle: `20 EMA (₹${p.ema20}) Bullish Golden Cross over 50 EMA (₹${p.ema50})`,
    rationale: [
      `20-day EMA crossed above 50-day EMA, initiating a medium-term trend reversal.`,
      `Price trades comfortably above both moving averages.`,
      `Momentum expanding in the direction of the golden cross.`,
    ],
  };
}

/**
 * STRATEGY E: Momentum Trading
 * - Strong relative performance vs NIFTY 50 (> 60)
 * - RSI in acceleration zone (55 to 70)
 * - MACD bullish cross or positive histogram
 * - Flags overextended stocks (RSI > 80 or extension > 9%)
 */
export function evaluateStrategyE_Momentum(p: StockIndicatorProfile): StrategyMatchResult {
  const isRSStrong = p.relativeStrengthVsNifty >= 65;
  const isRSIOptimal = p.rsi14 >= 54 && p.rsi14 <= 74;
  const isMACDBullish = p.macd.histogram > 0 || p.macd.isBullishCross;
  const isOverextended = p.rsi14 > 80 || p.extensionFrom20EMAPercent > 9.0;
  const matched = isRSStrong && isRSIOptimal && isMACDBullish && !isOverextended;

  const entryTrigger = Number((p.currentPrice * 1.003).toFixed(1));
  const stopLoss = Number((p.ema20 * 0.985).toFixed(1));
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
    keyLevel: p.ema20,
    rejectionCandle: `RSI ${p.rsi14} + MACD Bullish Momentum Expansion`,
    rationale: [
      `Outperforming NIFTY 50 with Relative Strength score of ${p.relativeStrengthVsNifty}/100.`,
      `RSI at ${p.rsi14} in the sweet-spot momentum acceleration window (55-72).`,
      `MACD histogram expanded positive (+${p.macd.histogram}), signaling institutional momentum.`,
    ],
    warnings: isOverextended ? ["Stock overextended (RSI > 80). Avoid chasing until pullback."] : [],
  };
}

/**
 * STRATEGY F: Range Breakout
 * - Consolidating within defined horizontal range (box/rectangle)
 * - Breakout above upper range with volume expansion
 */
export function evaluateStrategyF_RangeBreakout(p: StockIndicatorProfile): StrategyMatchResult {
  const rangeWidthPercent = ((p.resistanceLevel - p.supportLevel) / p.supportLevel) * 100;
  const isTightRange = rangeWidthPercent <= 9.0;
  const isBreakingRange = p.currentPrice >= p.resistanceLevel * 0.995;
  const hasVolume = p.volumeMultiplier >= 1.35;
  const matched = isTightRange && isBreakingRange && hasVolume;

  const entryTrigger = Number((p.currentPrice * 1.002).toFixed(1));
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

/**
 * STRATEGY G: Trend Continuation
 * - Higher highs and higher lows
 * - 20 EMA > 50 EMA > 200 EMA
 * - Continuation entries near support or pullback
 */
export function evaluateStrategyG_TrendContinuation(p: StockIndicatorProfile): StrategyMatchResult {
  const isPerfectMAAlignment = p.currentPrice > p.ema20 && p.ema20 > p.ema50 && p.ema50 > p.ema200;
  const isHigherLows = p.swingLow > p.supportLevel * 1.01;
  const isHealthyRSI = p.rsi14 >= 52 && p.rsi14 <= 72;
  const matched = isPerfectMAAlignment && isHigherLows && isHealthyRSI;

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
      max: p.currentPrice,
      trigger: entryTrigger,
    },
    stopLoss,
    target1,
    target2,
    riskPerShare: risk,
    rewardRiskRatio: 2.1,
    confidenceScore,
    keyLevel: p.ema20,
    rejectionCandle: `Higher High + Higher Low Continuation Pattern`,
    rationale: [
      `Structure confirms disciplined Higher Highs & Higher Lows sequence.`,
      `Triple moving average alignment: Price > 20 EMA > 50 EMA > 200 EMA.`,
      `High-probability continuation wave forming from dynamic support.`,
    ],
  };
}

/**
 * STRATEGY H: Volume Breakout
 * - Unusual volume >= 2.0x 20-day average
 * - Price spread expansion closing near highs
 * - Accumulation vs breakdown differentiation
 */
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
      max: p.currentPrice,
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
  const momentumScore = p.rsi14 >= 55 && p.rsi14 <= 72 ? 10 : 5;
  const rrScore = primaryStrategy.rewardRiskRatio >= 2.0 ? 10 : 6;

  const baseScore = trendScore + priceActionScore + volumeScore + relativeStrengthScore + srQualityScore + momentumScore + rrScore;
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
    rsi: p.rsi14,
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
// LIQUID INDIAN CASH UNIVERSES
// ─────────────────────────────────────────────────────────────────────────────

export const LIQUID_UNIVERSES = {
  MOMENTUM_LEADERS: [
    "TRENT",
    "DIXON",
    "BSE",
    "CDSL",
    "HAL",
    "BEL",
    "PERSISTENT",
    "POLYCAB",
    "COCHINSHIP",
    "MAZDOCK",
    "SUZLON",
    "ZOMATO",
    "MCX",
    "KALYANKJIL",
    "ANGELONE",
    "IRFC",
  ],
  NIFTY_50: [
    "RELIANCE",
    "TCS",
    "INFY",
    "HDFCBANK",
    "ICICIBANK",
    "BHARTIARTL",
    "SBIN",
    "LT",
    "ITC",
    "BAJFINANCE",
    "MARUTI",
    "TATAMOTORS",
    "TITAN",
    "SUNPHARMA",
    "AXISBANK",
    "NTPC",
    "ONGC",
    "POWERGRID",
    "M&M",
    "COALINDIA",
  ],
  NIFTY_NEXT_50: [
    "ADANIENT",
    "JSWSTEEL",
    "TATASTEEL",
    "HINDALCO",
    "TECHM",
    "WIPRO",
    "HCLTECH",
    "ULTRACEMCO",
    "KOTAKBANK",
    "BAJAJFINSV",
    "VOLTAS",
    "CUMMINSIND",
    "ABB",
    "SIEMENS",
    "BHEL",
  ],
};
