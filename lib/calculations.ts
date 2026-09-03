import {
  Trade,
  DashboardMetrics,
  StrategyMetrics,
  EquityPoint,
  PRESET_STRATEGIES,
} from "../types/trade";

export const DEFAULT_STARTING_CAPITAL = 500;

/**
 * Calculates Net PnL for a single trade after deducting fees.
 */
export function getTradeNetPnL(trade: Trade): number {
  return trade.pnl - (trade.fees || 0);
}

/**
 * Returns closed trades (excluding OPEN trades).
 */
export function getClosedTrades(trades: Trade[]): Trade[] {
  return trades.filter((t) => t.status !== "OPEN");
}

/**
 * Returns open trades.
 */
export function getOpenTrades(trades: Trade[]): Trade[] {
  return trades.filter((t) => t.status === "OPEN");
}

/**
 * Calculates today's realized Net PnL (for trades executed on today's date YYYY-MM-DD).
 */
export function calculateTodayPnL(trades: Trade[]): number {
  const todayStr = new Date().toISOString().split("T")[0];
  const closed = getClosedTrades(trades);
  return closed
    .filter((t) => t.date === todayStr)
    .reduce((acc, t) => acc + getTradeNetPnL(t), 0);
}

/**
 * Calculates total Gross Profit (sum of all positive net PnLs).
 */
export function calculateGrossProfit(trades: Trade[]): number {
  const closed = getClosedTrades(trades);
  return closed.reduce((acc, t) => {
    const net = getTradeNetPnL(t);
    return net > 0 ? acc + net : acc;
  }, 0);
}

/**
 * Calculates total Gross Loss (absolute sum of all negative net PnLs).
 */
export function calculateGrossLoss(trades: Trade[]): number {
  const closed = getClosedTrades(trades);
  return closed.reduce((acc, t) => {
    const net = getTradeNetPnL(t);
    return net < 0 ? acc + Math.abs(net) : acc;
  }, 0);
}

/**
 * Calculates total Net PnL (Gross Profit - Gross Loss).
 */
export function calculateNetPnL(trades: Trade[]): number {
  const closed = getClosedTrades(trades);
  return closed.reduce((acc, t) => acc + getTradeNetPnL(t), 0);
}

/**
 * Calculates winning trades count (Net PnL > 0).
 */
export function calculateWinningTrades(trades: Trade[]): number {
  const closed = getClosedTrades(trades);
  return closed.filter((t) => getTradeNetPnL(t) > 0).length;
}

/**
 * Calculates losing trades count (Net PnL < 0).
 */
export function calculateLosingTrades(trades: Trade[]): number {
  const closed = getClosedTrades(trades);
  return closed.filter((t) => getTradeNetPnL(t) < 0).length;
}

/**
 * Calculates Win Rate percentage (Winning Trades / Total Trades * 100).
 */
export function calculateWinRate(trades: Trade[]): number {
  const closed = getClosedTrades(trades);
  if (closed.length === 0) return 0;
  const wins = calculateWinningTrades(closed);
  return (wins / closed.length) * 100;
}

/**
 * Calculates Profit Factor: Gross Profit / Absolute Gross Loss.
 */
export function calculateProfitFactor(trades: Trade[]): {
  profitFactor: number;
  hasLosses: boolean;
} {
  const grossProfit = calculateGrossProfit(trades);
  const grossLoss = calculateGrossLoss(trades);

  if (grossLoss === 0) {
    return { profitFactor: 0, hasLosses: false };
  }

  return { profitFactor: grossProfit / grossLoss, hasLosses: true };
}

/**
 * Calculates Average R-Multiple per trade (Sum of R / Total Trades).
 */
export function calculateAverageR(trades: Trade[]): number {
  const closed = getClosedTrades(trades);
  if (closed.length === 0) return 0;

  const totalR = closed.reduce((acc, t) => acc + (t.rMultiple || 0), 0);
  return totalR / closed.length;
}

/**
 * Calculates Peak-to-Trough Maximum Drawdown in dollars and percentage.
 */
export function calculateMaxDrawdown(
  trades: Trade[],
  startingCapital: number = DEFAULT_STARTING_CAPITAL
): { maxDrawdown: number; maxDrawdownPercentage: number } {
  const closed = getClosedTrades(trades);
  if (closed.length === 0) {
    return { maxDrawdown: 0, maxDrawdownPercentage: 0 };
  }

  let peakEquity = startingCapital;
  let currentEquity = startingCapital;
  let maxDrawdownDollar = 0;
  let maxDrawdownPercent = 0;

  closed.forEach((t) => {
    currentEquity += getTradeNetPnL(t);
    if (currentEquity > peakEquity) {
      peakEquity = currentEquity;
    }
    const currentDrawdown = peakEquity - currentEquity;
    if (currentDrawdown > maxDrawdownDollar) {
      maxDrawdownDollar = currentDrawdown;
      maxDrawdownPercent = peakEquity > 0 ? (currentDrawdown / peakEquity) * 100 : 0;
    }
  });

  return { maxDrawdown: maxDrawdownDollar, maxDrawdownPercentage: maxDrawdownPercent };
}

/**
 * Calculates peak-to-trough drawdown for a specific strategy's trade sequence.
 */
export function calculateStrategyDrawdown(trades: Trade[]): {
  maxDrawdown: number;
  maxDrawdownPercent: number;
} {
  if (trades.length === 0) return { maxDrawdown: 0, maxDrawdownPercent: 0 };

  let peak = 0;
  let currentCumulative = 0;
  let maxDD = 0;

  trades.forEach((t) => {
    currentCumulative += getTradeNetPnL(t);
    if (currentCumulative > peak) {
      peak = currentCumulative;
    }
    const dd = peak - currentCumulative;
    if (dd > maxDD) {
      maxDD = dd;
    }
  });

  const maxDDPercent = peak > 0 ? (maxDD / peak) * 100 : 0;
  return { maxDrawdown: maxDD, maxDrawdownPercent: maxDDPercent };
}

/**
 * Generates equity curve timeline data points starting at startingCapital.
 */
export function calculateEquityCurve(
  trades: Trade[],
  startingCapital: number = DEFAULT_STARTING_CAPITAL
): EquityPoint[] {
  const closed = getClosedTrades(trades);

  const points: EquityPoint[] = [
    {
      date: "Start",
      tradeIndex: 0,
      label: "Initial Capital",
      tradePnL: 0,
      cumulativePnL: 0,
      capital: startingCapital,
    },
  ];

  let cumulativePnL = 0;
  let currentCapital = startingCapital;

  closed.forEach((t, i) => {
    const net = getTradeNetPnL(t);
    cumulativePnL += net;
    currentCapital += net;

    points.push({
      date: t.date || `Trade #${i + 1}`,
      tradeIndex: i + 1,
      label: `${t.symbol} (${t.side})`,
      tradePnL: net,
      cumulativePnL,
      capital: currentCapital,
    });
  });

  return points;
}

/**
 * Groups metrics by strategy name, including preset strategies, and ranks them using multi-metric composite scoring.
 */
export function calculateStrategyPerformance(trades: Trade[]): StrategyMetrics[] {
  const closed = getClosedTrades(trades);

  // Collect all strategy names from preset list + actual trades
  const strategyMap: Record<string, Trade[]> = {};

  // Initialize with preset strategies
  PRESET_STRATEGIES.forEach((strat) => {
    strategyMap[strat] = [];
  });

  // Populate from trades
  closed.forEach((t) => {
    const stratName = t.strategy?.trim() || "Uncategorized";
    if (!strategyMap[stratName]) {
      strategyMap[stratName] = [];
    }
    strategyMap[stratName].push(t);
  });

  const rawResults: StrategyMetrics[] = [];

  Object.entries(strategyMap).forEach(([strategy, stratTrades]) => {
    const totalTrades = stratTrades.length;
    const winningTrades = stratTrades.filter((t) => getTradeNetPnL(t) > 0).length;
    const losingTrades = stratTrades.filter((t) => getTradeNetPnL(t) < 0).length;
    const winRate = totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0;
    const grossProfit = calculateGrossProfit(stratTrades);
    const grossLoss = calculateGrossLoss(stratTrades);
    const netPnL = grossProfit - grossLoss;

    const hasLosses = grossLoss > 0;
    const profitFactor = hasLosses
      ? grossProfit / grossLoss
      : grossProfit > 0
      ? grossProfit
      : 0;

    const totalR = stratTrades.reduce((acc, t) => acc + (t.rMultiple || 0), 0);
    const averageR = totalTrades > 0 ? totalR / totalTrades : 0;
    const { maxDrawdown, maxDrawdownPercent } = calculateStrategyDrawdown(stratTrades);

    // Multi-Metric Composite Edge Score Calculation:
    // Combines Net PnL (35%), Profit Factor (25%), Win Rate (20%), Avg R (20%) with Drawdown Penalty
    let compositeScore = -99999;

    if (totalTrades > 0) {
      const pnlWeight = netPnL * 0.35;
      const pfValue = hasLosses ? profitFactor : grossProfit > 0 ? 5 : 1;
      const pfWeight = pfValue * 250;
      const winRateWeight = winRate * 15;
      const avgRWeight = averageR * 400;
      const ddPenalty = maxDrawdown * 0.2;

      compositeScore = pnlWeight + pfWeight + winRateWeight + avgRWeight - ddPenalty;
    }

    rawResults.push({
      strategy,
      totalTrades,
      winningTrades,
      losingTrades,
      winRate,
      grossProfit,
      grossLoss,
      netPnL,
      profitFactor,
      hasLosses,
      averageR,
      maxDrawdown,
      maxDrawdownPercent,
      compositeScore,
    });
  });

  // Sort by Composite Edge Score descending
  const sorted = rawResults.sort((a, b) => b.compositeScore - a.compositeScore);

  // Assign ranks and human-readable rank reasons
  return sorted.map((item, index) => {
    const rank = index + 1;
    let rankReason = "Insufficient trade data";

    if (item.totalTrades > 0) {
      if (item.netPnL > 0 && item.winRate >= 50 && item.averageR > 0) {
        rankReason = `High Edge Setup (${item.winRate.toFixed(1)}% WR, ${
          item.hasLosses ? item.profitFactor.toFixed(2) : "High"
        } PF, +${item.averageR.toFixed(2)}R avg payout)`;
      } else if (item.netPnL > 0) {
        rankReason = `Profitable (${formatCurrency(item.netPnL, true)} net gain across ${item.totalTrades} trades)`;
      } else if (item.netPnL < 0) {
        rankReason = `Negative Edge (${formatCurrency(item.netPnL)} drawdown, requires rules refinement)`;
      } else {
        rankReason = `Breakeven performance across ${item.totalTrades} trades`;
      }
    }

    return {
      ...item,
      rank,
      rankReason,
    };
  });
}

/**
 * Returns the Most Profitable Strategy (highest raw Net PnL in dollars).
 */
export function getMostProfitableStrategy(strategyMetrics: StrategyMetrics[]): StrategyMetrics | null {
  const active = strategyMetrics.filter((s) => s.totalTrades > 0);
  if (active.length === 0) return null;
  return [...active].sort((a, b) => b.netPnL - a.netPnL)[0];
}

/**
 * Returns the Best Risk-Adjusted Strategy (highest Composite Edge Score).
 */
export function getBestRiskAdjustedStrategy(strategyMetrics: StrategyMetrics[]): StrategyMetrics | null {
  const active = strategyMetrics.filter((s) => s.totalTrades > 0);
  if (active.length === 0) return null;
  return [...active].sort((a, b) => b.compositeScore - a.compositeScore)[0];
}

/**
 * Calculates Best Strategy based on highest Composite Edge Score.
 */
export function calculateBestStrategy(strategyMetrics: StrategyMetrics[]): string {
  const activeStrategies = strategyMetrics.filter((s) => s.totalTrades > 0);
  if (activeStrategies.length === 0) return "N/A";
  return activeStrategies[0].strategy; // Top composite score
}

/**
 * Calculates Worst Strategy based on lowest Composite Edge Score / lowest Net PnL.
 */
export function calculateWorstStrategy(strategyMetrics: StrategyMetrics[]): string {
  const activeStrategies = strategyMetrics.filter((s) => s.totalTrades > 0);
  if (activeStrategies.length === 0) return "N/A";
  return activeStrategies[activeStrategies.length - 1].strategy; // Lowest composite score
}

/**
 * Aggregates all Dashboard KPIs from trades array.
 */
export function calculateDashboardMetrics(
  trades: Trade[],
  startingCapital: number = DEFAULT_STARTING_CAPITAL
): DashboardMetrics {
  const closed = getClosedTrades(trades);
  const totalTrades = closed.length;
  const grossProfit = calculateGrossProfit(closed);
  const grossLoss = calculateGrossLoss(closed);
  const netPnL = calculateNetPnL(closed);
  const currentCapital = startingCapital + netPnL;
  const returnPercentage = startingCapital > 0 ? (netPnL / startingCapital) * 100 : 0;
  const winningTrades = calculateWinningTrades(closed);
  const losingTrades = calculateLosingTrades(closed);
  const winRate = calculateWinRate(closed);
  const { profitFactor, hasLosses } = calculateProfitFactor(closed);
  const averageR = calculateAverageR(closed);
  const { maxDrawdown, maxDrawdownPercentage } = calculateMaxDrawdown(closed, startingCapital);
  const strategyMetrics = calculateStrategyPerformance(closed);
  const bestStrategy = calculateBestStrategy(strategyMetrics);
  const worstStrategy = calculateWorstStrategy(strategyMetrics);

  return {
    startingCapital,
    currentCapital,
    netPnL,
    grossProfit,
    grossLoss,
    returnPercentage,
    totalTrades,
    winningTrades,
    losingTrades,
    winRate,
    profitFactor,
    hasLosses,
    averageR,
    maxDrawdown,
    maxDrawdownPercentage,
    bestStrategy,
    worstStrategy,
  };
}

/**
 * Formatting utilities.
 */
export function formatCurrency(val: number, showSign = false): string {
  const absFormatted = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Math.abs(val));

  if (val < 0) return `-${absFormatted}`;
  if (val > 0 && showSign) return `+${absFormatted}`;
  return absFormatted;
}

export function formatPercent(val: number, showSign = false): string {
  const formatted = `${val.toFixed(1)}%`;
  if (val > 0 && showSign) return `+${formatted}`;
  return formatted;
}

export function formatRatio(val: number, hasLosses = true): string {
  if (!hasLosses) return "N/A";
  if (val === 0) return "0.00";
  return val.toFixed(2);
}

export interface GlobalFilterState {
  datePreset: "ALL" | "THIS_MONTH" | "LAST_30_DAYS" | "CUSTOM";
  startDate: string;
  endDate: string;
  strategy: string;
  symbol: string;
  direction: "ALL" | "LONG" | "SHORT";
  outcome: "ALL" | "WIN" | "LOSS" | "BREAKEVEN";
}

export const DEFAULT_GLOBAL_FILTERS: GlobalFilterState = {
  datePreset: "ALL",
  startDate: "",
  endDate: "",
  strategy: "ALL",
  symbol: "ALL",
  direction: "ALL",
  outcome: "ALL",
};

/**
 * Globally filters closed trades according to Date Range, Strategy, Symbol, Direction, and Outcome.
 */
export function filterTrades(
  trades: Trade[],
  filters: GlobalFilterState
): Trade[] {
  const closed = getClosedTrades(trades);

  const now = new Date();
  const todayStr = now.toISOString().split("T")[0];

  let calculatedStartDate = filters.startDate;
  let calculatedEndDate = filters.endDate;

  if (filters.datePreset === "THIS_MONTH") {
    const firstDay = new Date(now.getFullYear(), now.getMonth(), 1)
      .toISOString()
      .split("T")[0];
    calculatedStartDate = firstDay;
    calculatedEndDate = todayStr;
  } else if (filters.datePreset === "LAST_30_DAYS") {
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
      .toISOString()
      .split("T")[0];
    calculatedStartDate = thirtyDaysAgo;
    calculatedEndDate = todayStr;
  }

  return closed.filter((t) => {
    // 1. Date Range Filter
    if (calculatedStartDate && t.date < calculatedStartDate) return false;
    if (calculatedEndDate && t.date > calculatedEndDate) return false;

    // 2. Strategy Filter
    if (filters.strategy !== "ALL" && t.strategy !== filters.strategy) return false;

    // 3. Symbol Filter
    if (filters.symbol !== "ALL" && t.symbol !== filters.symbol) return false;

    // 4. Direction Filter
    if (filters.direction !== "ALL" && t.side !== filters.direction) return false;

    // 5. Outcome (Profit/Loss) Filter
    if (filters.outcome !== "ALL") {
      const net = getTradeNetPnL(t);
      if (filters.outcome === "WIN" && net <= 0) return false;
      if (filters.outcome === "LOSS" && net >= 0) return false;
      if (filters.outcome === "BREAKEVEN" && net !== 0) return false;
    }

    return true;
  });
}
