import { Trade, MistakeTag, MISTAKE_OPTIONS } from "../types/trade";
import {
  getTradeNetPnL,
  getClosedTrades,
  calculateGrossProfit,
  calculateGrossLoss,
  calculateMaxDrawdown,
  calculateStrategyPerformance,
  DEFAULT_STARTING_CAPITAL,
} from "./calculations";

export interface MistakeTagMetrics {
  tag: MistakeTag;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  netPnL: number;
  grossProfit: number;
  grossLoss: number;
  percentageOfTotal: number;
}

export interface MistakeAnalysisResult {
  mostCommonMistake: string;
  costliestMistake: string;
  totalMistakeCost: number;
  items: MistakeTagMetrics[];
}

export interface MonthlyReviewMetrics {
  startingCapital: number;
  endingCapital: number;
  netPnL: number;
  grossProfit: number;
  grossLoss: number;
  returnPercentage: number;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  profitFactor: number;
  hasLosses: boolean;
  averageR: number;
  maxDrawdown: number;
  maxDrawdownPercent: number;
  bestStrategy: string;
  worstStrategy: string;
  bestTrade: Trade | null;
  worstTrade: Trade | null;
  bestTradingDay: { date: string; pnl: number; count: number } | null;
  worstTradingDay: { date: string; pnl: number; count: number } | null;
  longestWinningStreak: number;
  longestLosingStreak: number;
  mistakeAnalysis: MistakeAnalysisResult;
}

/**
 * Calculates mistake tag frequency, Win Rate, and Net PnL breakdown per mistake tag.
 */
export function calculateMistakeAnalysis(trades: Trade[]): MistakeAnalysisResult {
  const closed = getClosedTrades(trades);
  const totalClosedCount = closed.length;

  if (totalClosedCount === 0) {
    return {
      mostCommonMistake: "None",
      costliestMistake: "None",
      totalMistakeCost: 0,
      items: [],
    };
  }

  const tagMap: Record<string, Trade[]> = {};

  closed.forEach((t) => {
    const tag = t.mistakeTag || "No Mistake";
    if (!tagMap[tag]) {
      tagMap[tag] = [];
    }
    tagMap[tag].push(t);
  });

  const items: MistakeTagMetrics[] = [];
  let totalMistakeCost = 0;

  Object.entries(tagMap).forEach(([tag, tagTrades]) => {
    const totalTrades = tagTrades.length;
    const winningTrades = tagTrades.filter((t) => getTradeNetPnL(t) > 0).length;
    const losingTrades = tagTrades.filter((t) => getTradeNetPnL(t) < 0).length;
    const winRate = (winningTrades / totalTrades) * 100;
    const grossProfit = calculateGrossProfit(tagTrades);
    const grossLoss = calculateGrossLoss(tagTrades);
    const netPnL = grossProfit - grossLoss;
    const percentageOfTotal = (totalTrades / totalClosedCount) * 100;

    if (tag !== "No Mistake" && netPnL < 0) {
      totalMistakeCost += Math.abs(netPnL);
    }

    items.push({
      tag: tag as MistakeTag,
      totalTrades,
      winningTrades,
      losingTrades,
      winRate,
      netPnL,
      grossProfit,
      grossLoss,
      percentageOfTotal,
    });
  });

  // Sort mistake items by total trades descending
  const sortedItems = items.sort((a, b) => b.totalTrades - a.totalTrades);

  // Identify Most Common Mistake (excluding "No Mistake")
  const mistakeOnlyItems = sortedItems.filter((i) => i.tag !== "No Mistake");
  const mostCommonMistake =
    mistakeOnlyItems.length > 0 ? mistakeOnlyItems[0].tag : "No Mistakes";

  // Identify Costliest Mistake (lowest Net PnL)
  const costliestMistakeItem = [...mistakeOnlyItems].sort(
    (a, b) => a.netPnL - b.netPnL
  )[0];
  const costliestMistake =
    costliestMistakeItem && costliestMistakeItem.netPnL < 0
      ? costliestMistakeItem.tag
      : "None";

  return {
    mostCommonMistake,
    costliestMistake,
    totalMistakeCost,
    items: sortedItems,
  };
}

export function calculateMonthlyReviewMetrics(
  allTrades: Trade[],
  year: number,
  month: number, // 0-indexed (0 = Jan, 8 = Sept)
  baseCapital: number = DEFAULT_STARTING_CAPITAL
): MonthlyReviewMetrics {
  const closedAll = getClosedTrades(allTrades).sort((a, b) => {
    return new Date(a.date).getTime() - new Date(b.date).getTime();
  });

  const monthPrefix = `${year}-${String(month + 1).padStart(2, "0")}`;

  // Trades before selected month (to compute starting capital)
  const priorTrades = closedAll.filter((t) => t.date < `${monthPrefix}-01`);
  const priorPnL = priorTrades.reduce((acc, t) => acc + getTradeNetPnL(t), 0);
  const startingCapital = baseCapital + priorPnL;

  // Selected Month Trades
  const monthTrades = closedAll.filter((t) => t.date.startsWith(monthPrefix));
  const totalTrades = monthTrades.length;

  const emptyMistakeAnalysis: MistakeAnalysisResult = {
    mostCommonMistake: "None",
    costliestMistake: "None",
    totalMistakeCost: 0,
    items: [],
  };

  if (totalTrades === 0) {
    return {
      startingCapital,
      endingCapital: startingCapital,
      netPnL: 0,
      grossProfit: 0,
      grossLoss: 0,
      returnPercentage: 0,
      totalTrades: 0,
      winningTrades: 0,
      losingTrades: 0,
      winRate: 0,
      profitFactor: 0,
      hasLosses: false,
      averageR: 0,
      maxDrawdown: 0,
      maxDrawdownPercent: 0,
      bestStrategy: "N/A",
      worstStrategy: "N/A",
      bestTrade: null,
      worstTrade: null,
      bestTradingDay: null,
      worstTradingDay: null,
      longestWinningStreak: 0,
      longestLosingStreak: 0,
      mistakeAnalysis: emptyMistakeAnalysis,
    };
  }

  // 1. Basic Counts & PnL
  const grossProfit = calculateGrossProfit(monthTrades);
  const grossLoss = calculateGrossLoss(monthTrades);
  const netPnL = grossProfit - grossLoss;
  const endingCapital = startingCapital + netPnL;
  const returnPercentage = (netPnL / startingCapital) * 100;

  const winningTrades = monthTrades.filter((t) => getTradeNetPnL(t) > 0).length;
  const losingTrades = monthTrades.filter((t) => getTradeNetPnL(t) < 0).length;
  const winRate = (winningTrades / totalTrades) * 100;

  const hasLosses = grossLoss > 0;
  const profitFactor = hasLosses
    ? grossProfit / grossLoss
    : grossProfit > 0
    ? grossProfit
    : 0;

  const totalR = monthTrades.reduce((acc, t) => acc + (t.rMultiple || 0), 0);
  const averageR = totalR / totalTrades;

  const { maxDrawdown, maxDrawdownPercentage: maxDrawdownPercent } =
    calculateMaxDrawdown(monthTrades, startingCapital);

  // 2. Best & Worst Strategy
  const stratPerformance = calculateStrategyPerformance(monthTrades).filter(
    (s) => s.totalTrades > 0
  );
  const bestStrategy =
    stratPerformance.length > 0 ? stratPerformance[0].strategy : "N/A";
  const worstStrategy =
    stratPerformance.length > 0
      ? stratPerformance[stratPerformance.length - 1].strategy
      : "N/A";

  // 3. Best Trade & Worst Trade
  let bestTrade: Trade | null = null;
  let worstTrade: Trade | null = null;

  monthTrades.forEach((t) => {
    const net = getTradeNetPnL(t);
    if (!bestTrade || net > getTradeNetPnL(bestTrade)) {
      bestTrade = t;
    }
    if (!worstTrade || net < getTradeNetPnL(worstTrade)) {
      worstTrade = t;
    }
  });

  // 4. Best & Worst Trading Day
  const dayMap: Record<string, { pnl: number; count: number }> = {};
  monthTrades.forEach((t) => {
    const d = t.date;
    const net = getTradeNetPnL(t);
    if (!dayMap[d]) {
      dayMap[d] = { pnl: 0, count: 0 };
    }
    dayMap[d].pnl += net;
    dayMap[d].count += 1;
  });

  let bestTradingDay: { date: string; pnl: number; count: number } | null = null;
  let worstTradingDay: { date: string; pnl: number; count: number } | null = null;

  Object.entries(dayMap).forEach(([date, data]) => {
    if (!bestTradingDay || data.pnl > bestTradingDay.pnl) {
      bestTradingDay = { date, pnl: data.pnl, count: data.count };
    }
    if (!worstTradingDay || data.pnl < worstTradingDay.pnl) {
      worstTradingDay = { date, pnl: data.pnl, count: data.count };
    }
  });

  // 5. Longest Winning & Losing Streaks
  let longestWinningStreak = 0;
  let longestLosingStreak = 0;
  let currentWinStreak = 0;
  let currentLossStreak = 0;

  monthTrades.forEach((t) => {
    const net = getTradeNetPnL(t);
    if (net > 0) {
      currentWinStreak += 1;
      currentLossStreak = 0;
      if (currentWinStreak > longestWinningStreak) {
        longestWinningStreak = currentWinStreak;
      }
    } else if (net < 0) {
      currentLossStreak += 1;
      currentWinStreak = 0;
      if (currentLossStreak > longestLosingStreak) {
        longestLosingStreak = currentLossStreak;
      }
    } else {
      currentWinStreak = 0;
      currentLossStreak = 0;
    }
  });

  // 6. Mistake Tag Analysis
  const mistakeAnalysis = calculateMistakeAnalysis(monthTrades);

  return {
    startingCapital,
    endingCapital,
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
    maxDrawdownPercent,
    bestStrategy,
    worstStrategy,
    bestTrade,
    worstTrade,
    bestTradingDay,
    worstTradingDay,
    longestWinningStreak,
    longestLosingStreak,
    mistakeAnalysis,
  };
}
