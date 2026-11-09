/**
 * INSTITUTIONAL QUANTITATIVE RISK MANAGEMENT & VOLATILITY POSITION SIZING ENGINE
 * 
 * 1. Dynamic ATR Volatility Sizing:
 *    Allocates capital using Equal-Risk Volatility Parity based on 14-day Average True Range (ATR)
 *    and distance to structural stop-loss, eliminating fragile static ₹3L sizing.
 * 2. Automated Multi-Tier Trailing Stop-Loss (TSL):
 *    Automatically activates once a trade reaches +3% profit, ratcheting upwards to lock in gains
 *    and prevent winning trades from decaying into drawdowns.
 * 3. Expectancy & Portfolio Heat Metrics:
 *    Calculates mathematical Expectancy ($EV$), Profit Factor, and Kelly Criterion sizing fraction.
 */

export interface OHLCVCandle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface PositionSizingInput {
  accountCapital: number; // e.g. 25,00,000 INR
  riskPercentage: number; // e.g. 1.0% to 1.5%
  entryPrice: number;
  stopLossPrice: number;
  targetPrice?: number;
  atr14?: number;
  candles?: OHLCVCandle[];
  maxPortfolioAllocationPct?: number; // default 20% max per stock
}

export interface PositionSizingResult {
  sizingMethod: "ATR_VOLATILITY_PARITY" | "STRUCTURAL_RISK_PARITY";
  accountCapital: number;
  riskPercentage: number;
  riskAmountRupees: number;
  atr14: number;
  effectiveStopDistance: number;
  atrStopDistance: number;
  recommendedQuantity: number;
  allocatedCapital: number;
  portfolioExposurePercent: number;
  cappedByAllocationLimit: boolean;
  maxRewardPotential: number;
  rewardRiskRatio: number;
  explanation: string;
}

export interface TrailingStopEvaluation {
  isTslActive: boolean;
  status: "INACTIVE_BELOW_TRIGGER" | "ACTIVATED_BREAKEVEN_PLUS" | "RATCHETING_HIGH_WATERMARK" | "STOP_TRIGGERED";
  trailingStopPrice: number;
  originalStopPrice: number;
  peakSimulatedPrice: number;
  currentSimulatedPrice: number;
  unrealizedProfitPercent: number;
  peakProfitPercent: number;
  lockedGainPercent: number;
  lockedGainRupees: number;
  tslTier: string;
  triggerReason: string;
}

export interface ExpectancyMetrics {
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRatePercent: number;
  lossRatePercent: number;
  profitFactor: number;
  totalPnL: number;
  avgWinAmount: number;
  avgLossAmount: number;
  winLossRatio: number;
  expectancyPerTradeRupees: number;
  expectancyPercent: number;
  kellyFractionPercent: number;
  halfKellyPercent: number;
  maxConsecutiveWins: number;
  maxConsecutiveLosses: number;
  largestWin: number;
  largestLoss: number;
}

/**
 * Calculates True Range (TR) and 14-period Average True Range (ATR).
 */
export function calculateATR14(candles: OHLCVCandle[]): number {
  if (candles.length < 2) return 10;

  const trs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const current = candles[i];
    const prev = candles[i - 1];
    const tr = Math.max(
      current.high - current.low,
      Math.abs(current.high - prev.close),
      Math.abs(current.low - prev.close)
    );
    trs.push(tr);
  }

  const period = Math.min(14, trs.length);
  const recentTRs = trs.slice(-period);
  const atr = recentTRs.reduce((sum, v) => sum + v, 0) / period;
  return Number(atr.toFixed(2));
}

/**
 * Calculates dynamic capital allocation based on ATR volatility sizing.
 * Equalizes dollar-volatility risk across all portfolio trades.
 */
export function calculateDynamicPositionSize(input: PositionSizingInput): PositionSizingResult {
  const {
    accountCapital = 2500000,
    riskPercentage = 1.0,
    entryPrice,
    stopLossPrice,
    targetPrice,
    maxPortfolioAllocationPct = 20,
  } = input;

  const validEntry = Math.max(0.1, entryPrice);
  const validSL = Math.max(0.05, stopLossPrice);
  const structuralDistance = Math.max(0.5, Math.abs(validEntry - validSL));

  // Determine ATR14
  let atr14 = input.atr14 ?? 0;
  if (!atr14 && input.candles && input.candles.length >= 2) {
    atr14 = calculateATR14(input.candles);
  }
  if (!atr14 || atr14 <= 0) {
    // Fallback: estimate ATR as 2.2% of entry price
    atr14 = Number((validEntry * 0.022).toFixed(2));
  }

  // Institutional volatility buffer: ensure stop distance accounts for at least 1.25x ATR
  const atrStopDistance = Number((atr14 * 1.25).toFixed(2));
  const effectiveStopDistance = Math.max(structuralDistance, atrStopDistance);

  // Capital at risk budget
  const riskAmountRupees = Math.round(accountCapital * (riskPercentage / 100));

  // Base quantity calculation
  let recommendedQuantity = Math.floor(riskAmountRupees / effectiveStopDistance);
  recommendedQuantity = Math.max(1, recommendedQuantity);

  let allocatedCapital = Math.round(recommendedQuantity * validEntry);
  const maxAllowedCapital = accountCapital * (maxPortfolioAllocationPct / 100);

  let cappedByAllocationLimit = false;
  if (allocatedCapital > maxAllowedCapital) {
    recommendedQuantity = Math.max(1, Math.floor(maxAllowedCapital / validEntry));
    allocatedCapital = Math.round(recommendedQuantity * validEntry);
    cappedByAllocationLimit = true;
  }

  const portfolioExposurePercent = Number(((allocatedCapital / accountCapital) * 100).toFixed(2));
  const validTarget = targetPrice ?? validEntry + structuralDistance * 2.5;
  const rewardRiskRatio = Number((Math.abs(validTarget - validEntry) / effectiveStopDistance).toFixed(2));
  const maxRewardPotential = Math.round(recommendedQuantity * Math.abs(validTarget - validEntry));

  const explanation = cappedByAllocationLimit
    ? `ATR Volatility size ₹${allocatedCapital.toLocaleString("en-IN")} (${recommendedQuantity} shares). Capped at max ${maxPortfolioAllocationPct}% portfolio risk limit.`
    : `Dynamic ATR Volatility allocation: ₹${allocatedCapital.toLocaleString("en-IN")} (${recommendedQuantity} shares) risking ₹${riskAmountRupees.toLocaleString("en-IN")} (ATR14 ₹${atr14}).`;

  return {
    sizingMethod: "ATR_VOLATILITY_PARITY",
    accountCapital,
    riskPercentage,
    riskAmountRupees,
    atr14,
    effectiveStopDistance,
    atrStopDistance,
    recommendedQuantity,
    allocatedCapital,
    portfolioExposurePercent,
    cappedByAllocationLimit,
    maxRewardPotential,
    rewardRiskRatio,
    explanation,
  };
}

/**
 * Evaluates and Ratchets the Automated Trailing Stop-Loss (TSL).
 * 
 * Rules:
 * - Activates once trade reaches +3.0% profit.
 * - Initial lock: Break-Even + 0.5% slippage buffer.
 * - At +4.0% profit: Locks in +1.5% profit.
 * - At +5.0% profit: Locks in +2.5% profit.
 * - Above +6.0%: Trails high-watermark by 1.5x ATR (or locks in >= 65% of peak gains).
 * - Ratchet guarantee: Trailing stop price never moves downwards.
 */
export function evaluateTrailingStopLoss(params: {
  entryPrice: number;
  originalStopLoss: number;
  currentPrice: number;
  peakPrice?: number;
  atr14?: number;
  existingTrailingStop?: number;
  quantity: number;
}): TrailingStopEvaluation {
  const {
    entryPrice,
    originalStopLoss,
    currentPrice,
    existingTrailingStop,
    quantity,
  } = params;

  const peakPrice = Math.max(currentPrice, params.peakPrice ?? entryPrice);
  const atr = params.atr14 ?? entryPrice * 0.022;

  const unrealizedProfitPercent = Number((((currentPrice - entryPrice) / entryPrice) * 100).toFixed(2));
  const peakProfitPercent = Number((((peakPrice - entryPrice) / entryPrice) * 100).toFixed(2));

  let trailingStopPrice = existingTrailingStop ?? originalStopLoss;
  let status: TrailingStopEvaluation["status"] = "INACTIVE_BELOW_TRIGGER";
  let tslTier = "BASE_STRUCTURAL_STOP";
  let triggerReason = `Unrealized gain ${unrealizedProfitPercent}% is below the +3.0% TSL activation threshold.`;
  let isTslActive = false;

  // Activation threshold: +3.0% gain
  if (peakProfitPercent >= 3.0) {
    isTslActive = true;

    if (peakProfitPercent >= 6.0) {
      // Tier 4: Peak high-watermark trail (Peak - 1.5 ATR or 65% locked)
      const atrTrailLevel = Number((peakPrice - atr * 1.5).toFixed(2));
      const percentageTrailLevel = Number((entryPrice * (1 + (peakProfitPercent * 0.65) / 100)).toFixed(2));
      const candidateStop = Math.max(atrTrailLevel, percentageTrailLevel);

      trailingStopPrice = Math.max(trailingStopPrice, candidateStop);
      status = "RATCHETING_HIGH_WATERMARK";
      tslTier = "TIER_4_RUNNER_RATCHET";
      triggerReason = `High-watermark lock: Peak +${peakProfitPercent}%. Locked trailing stop at ₹${trailingStopPrice}.`;
    } else if (peakProfitPercent >= 5.0) {
      // Tier 3: Lock in +2.5%
      const candidateStop = Number((entryPrice * 1.025).toFixed(2));
      trailingStopPrice = Math.max(trailingStopPrice, candidateStop);
      status = "RATCHETING_HIGH_WATERMARK";
      tslTier = "TIER_3_LOCK_PLUS_2_5PCT";
      triggerReason = `Gain exceeded +5%: Ratcheted stop-loss to ₹${trailingStopPrice} (guaranteeing +2.5% profit).`;
    } else if (peakProfitPercent >= 4.0) {
      // Tier 2: Lock in +1.5%
      const candidateStop = Number((entryPrice * 1.015).toFixed(2));
      trailingStopPrice = Math.max(trailingStopPrice, candidateStop);
      status = "RATCHETING_HIGH_WATERMARK";
      tslTier = "TIER_2_LOCK_PLUS_1_5PCT";
      triggerReason = `Gain exceeded +4%: Ratcheted stop-loss to ₹${trailingStopPrice} (guaranteeing +1.5% profit).`;
    } else {
      // Tier 1: Break-even + buffer (+0.5%)
      const candidateStop = Number((entryPrice * 1.005).toFixed(2));
      trailingStopPrice = Math.max(trailingStopPrice, candidateStop);
      status = "ACTIVATED_BREAKEVEN_PLUS";
      tslTier = "TIER_1_BREAKEVEN_PLUS";
      triggerReason = `+3.0% Profit Activated: Trailing stop locked at ₹${trailingStopPrice} (+0.5% profit protected).`;
    }
  }

  // Check if price fell below trailing stop
  if (currentPrice <= trailingStopPrice) {
    status = "STOP_TRIGGERED";
    triggerReason = `Trailing stop hit at ₹${trailingStopPrice}. Trade locked.`;
  }

  const lockedGainPercent = Number((((trailingStopPrice - entryPrice) / entryPrice) * 100).toFixed(2));
  const lockedGainRupees = Math.round((trailingStopPrice - entryPrice) * quantity);

  return {
    isTslActive,
    status,
    trailingStopPrice,
    originalStopPrice: originalStopLoss,
    peakSimulatedPrice: peakPrice,
    currentSimulatedPrice: currentPrice,
    unrealizedProfitPercent,
    peakProfitPercent,
    lockedGainPercent: Math.max(0, lockedGainPercent),
    lockedGainRupees: Math.max(0, lockedGainRupees),
    tslTier,
    triggerReason,
  };
}

/**
 * Computes institutional Expectancy ($EV$), Profit Factor, and Kelly sizing metrics
 * from historical / backtest trade outcomes.
 */
export function calculateExpectancyMetrics(
  trades: { pnlAmount: number; pnlPercent: number; isWin?: boolean }[]
): ExpectancyMetrics {
  const totalTrades = trades.length;
  if (totalTrades === 0) {
    return {
      totalTrades: 0,
      winningTrades: 0,
      losingTrades: 0,
      winRatePercent: 0,
      lossRatePercent: 0,
      profitFactor: 0,
      totalPnL: 0,
      avgWinAmount: 0,
      avgLossAmount: 0,
      winLossRatio: 0,
      expectancyPerTradeRupees: 0,
      expectancyPercent: 0,
      kellyFractionPercent: 0,
      halfKellyPercent: 0,
      maxConsecutiveWins: 0,
      maxConsecutiveLosses: 0,
      largestWin: 0,
      largestLoss: 0,
    };
  }

  const winners = trades.filter((t) => t.pnlAmount > 0);
  const losers = trades.filter((t) => t.pnlAmount <= 0);

  const winningTrades = winners.length;
  const losingTrades = losers.length;
  const winRate = winningTrades / totalTrades;
  const lossRate = losingTrades / totalTrades;

  const totalGrossProfit = winners.reduce((sum, t) => sum + t.pnlAmount, 0);
  const totalGrossLoss = Math.abs(losers.reduce((sum, t) => sum + t.pnlAmount, 0));
  const totalPnL = totalGrossProfit - totalGrossLoss;

  const avgWinAmount = winningTrades > 0 ? Math.round(totalGrossProfit / winningTrades) : 0;
  const avgLossAmount = losingTrades > 0 ? Math.round(totalGrossLoss / losingTrades) : 0;

  const avgWinPct = winners.length > 0 ? winners.reduce((s, t) => s + t.pnlPercent, 0) / winners.length : 0;
  const avgLossPct = losers.length > 0 ? Math.abs(losers.reduce((s, t) => s + t.pnlPercent, 0) / losers.length) : 0;

  const winLossRatio = avgLossAmount > 0 ? Number((avgWinAmount / avgLossAmount).toFixed(2)) : 2.5;
  const profitFactor = totalGrossLoss > 0 ? Number((totalGrossProfit / totalGrossLoss).toFixed(2)) : totalGrossProfit > 0 ? 99 : 0;

  // Mathematical Expectancy ($EV$ per trade)
  const expectancyPerTradeRupees = Math.round(winRate * avgWinAmount - lossRate * avgLossAmount);
  const expectancyPercent = Number((winRate * avgWinPct - lossRate * avgLossPct).toFixed(2));

  // Kelly Criterion Fraction: K% = W - (1 - W) / R
  let kellyFractionPercent = 0;
  if (winLossRatio > 0) {
    const rawKelly = winRate - (1 - winRate) / winLossRatio;
    kellyFractionPercent = Number(Math.max(0, Math.min(0.25, rawKelly) * 100).toFixed(1));
  }
  const halfKellyPercent = Number((kellyFractionPercent / 2).toFixed(1));

  // Consecutive Streaks
  let currentWins = 0;
  let maxConsecutiveWins = 0;
  let currentLosses = 0;
  let maxConsecutiveLosses = 0;

  trades.forEach((t) => {
    if (t.pnlAmount > 0) {
      currentWins++;
      currentLosses = 0;
      if (currentWins > maxConsecutiveWins) maxConsecutiveWins = currentWins;
    } else {
      currentLosses++;
      currentWins = 0;
      if (currentLosses > maxConsecutiveLosses) maxConsecutiveLosses = currentLosses;
    }
  });

  const largestWin = winners.length > 0 ? Math.max(...winners.map((t) => t.pnlAmount)) : 0;
  const largestLoss = losers.length > 0 ? Math.min(...losers.map((t) => t.pnlAmount)) : 0;

  return {
    totalTrades,
    winningTrades,
    losingTrades,
    winRatePercent: Number((winRate * 100).toFixed(1)),
    lossRatePercent: Number((lossRate * 100).toFixed(1)),
    profitFactor,
    totalPnL,
    avgWinAmount,
    avgLossAmount,
    winLossRatio,
    expectancyPerTradeRupees,
    expectancyPercent,
    kellyFractionPercent,
    halfKellyPercent,
    maxConsecutiveWins,
    maxConsecutiveLosses,
    largestWin,
    largestLoss,
  };
}

