import { Trade, TradeSide } from "../types/trade";
import { getTradeNetPnL, getClosedTrades } from "./calculations";

export interface AnalyticsFilterState {
  datePreset: "ALL" | "THIS_MONTH" | "LAST_30_DAYS" | "CUSTOM";
  startDate: string;
  endDate: string;
  strategy: string;
  symbol: string;
  direction: "ALL" | "LONG" | "SHORT";
}

export const DEFAULT_ANALYTICS_FILTERS: AnalyticsFilterState = {
  datePreset: "ALL",
  startDate: "",
  endDate: "",
  strategy: "ALL",
  symbol: "ALL",
  direction: "ALL",
};

/**
 * Filters closed trades according to Date Range, Strategy, Symbol, and Direction filters.
 */
export function filterTrades(
  trades: Trade[],
  filters: AnalyticsFilterState
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

    return true;
  });
}

/**
 * Aggregates Net PnL grouped by trading date (Daily P/L Bar Chart).
 */
export interface DailyPnLPoint {
  date: string;
  pnl: number;
  tradesCount: number;
  isPositive: boolean;
}

export function aggregateDailyPnL(trades: Trade[]): DailyPnLPoint[] {
  if (trades.length === 0) return [];

  const dateMap: Record<string, { pnl: number; count: number }> = {};

  trades.forEach((t) => {
    const dateKey = t.date || "Unknown";
    const net = getTradeNetPnL(t);
    if (!dateMap[dateKey]) {
      dateMap[dateKey] = { pnl: 0, count: 0 };
    }
    dateMap[dateKey].pnl += net;
    dateMap[dateKey].count += 1;
  });

  const sortedDates = Object.keys(dateMap).sort();

  return sortedDates.map((date) => ({
    date,
    pnl: dateMap[date].pnl,
    tradesCount: dateMap[date].count,
    isPositive: dateMap[date].pnl >= 0,
  }));
}

/**
 * Aggregates Net PnL grouped by Strategy (Strategy-wise P/L Bar Chart).
 */
export interface StrategyPnLPoint {
  strategy: string;
  pnl: number;
  tradesCount: number;
  isPositive: boolean;
}

export function aggregateStrategyPnL(trades: Trade[]): StrategyPnLPoint[] {
  if (trades.length === 0) return [];

  const stratMap: Record<string, { pnl: number; count: number }> = {};

  trades.forEach((t) => {
    const stratName = t.strategy?.trim() || "Uncategorized";
    const net = getTradeNetPnL(t);
    if (!stratMap[stratName]) {
      stratMap[stratName] = { pnl: 0, count: 0 };
    }
    stratMap[stratName].pnl += net;
    stratMap[stratName].count += 1;
  });

  return Object.entries(stratMap)
    .map(([strategy, data]) => ({
      strategy,
      pnl: data.pnl,
      tradesCount: data.count,
      isPositive: data.pnl >= 0,
    }))
    .sort((a, b) => b.pnl - a.pnl);
}

/**
 * Aggregates Win / Loss / Breakeven counts (Winning vs Losing Trades Pie Chart).
 */
export interface WinLossPiePoint {
  name: string;
  value: number;
  color: string;
  percentage: number;
}

export function aggregateWinLossDistribution(trades: Trade[]): WinLossPiePoint[] {
  const total = trades.length;
  if (total === 0) {
    return [
      { name: "Winning Trades", value: 0, color: "#10b981", percentage: 0 },
      { name: "Losing Trades", value: 0, color: "#f43f5e", percentage: 0 },
      { name: "Breakeven Trades", value: 0, color: "#64748b", percentage: 0 },
    ];
  }

  let wins = 0;
  let losses = 0;
  let breakevens = 0;

  trades.forEach((t) => {
    const net = getTradeNetPnL(t);
    if (net > 0) wins += 1;
    else if (net < 0) losses += 1;
    else breakevens += 1;
  });

  return [
    {
      name: "Winning Trades",
      value: wins,
      color: "#10b981",
      percentage: (wins / total) * 100,
    },
    {
      name: "Losing Trades",
      value: losses,
      color: "#f43f5e",
      percentage: (losses / total) * 100,
    },
    {
      name: "Breakeven Trades",
      value: breakevens,
      color: "#64748b",
      percentage: (breakevens / total) * 100,
    },
  ];
}

/**
 * Aggregates R-Multiple Distribution into histogram buckets.
 */
export interface RDistributionPoint {
  range: string;
  count: number;
  color: string;
}

export function aggregateRMultipleDistribution(trades: Trade[]): RDistributionPoint[] {
  const buckets = [
    { range: "<-1.0R", min: -Infinity, max: -1.01, count: 0, color: "#e11d48" },
    { range: "-1.0R to 0R", min: -1.0, max: -0.01, count: 0, color: "#f43f5e" },
    { range: "0R to 1.0R", min: 0, max: 0.99, count: 0, color: "#38bdf8" },
    { range: "1.0R to 2.0R", min: 1.0, max: 1.99, count: 0, color: "#34d399" },
    { range: "2.0R to 3.0R", min: 2.0, max: 2.99, count: 0, color: "#10b981" },
    { range: "> 3.0R", min: 3.0, max: Infinity, count: 0, color: "#059669" },
  ];

  trades.forEach((t) => {
    const r = t.rMultiple || 0;
    for (const b of buckets) {
      if (r >= b.min && r <= b.max) {
        b.count += 1;
        break;
      }
    }
  });

  return buckets.map((b) => ({
    range: b.range,
    count: b.count,
    color: b.color,
  }));
}
