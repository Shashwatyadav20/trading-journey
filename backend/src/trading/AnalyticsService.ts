import { TradeRow } from "../db/TradeRepository";

export const SUPPORTED_STRATEGIES = [
  "LIQUIDITY_SWEEP",
  "SWING",
  "EQH_EQL",
  "PWH_PWL",
  "SWEEP_ENGULFING",
  "Manual Trade",
] as const;

export type SupportedStrategy = typeof SUPPORTED_STRATEGIES[number];

export interface TradeRecord {
  id: string;
  userId: string;
  date: string;
  time: string;
  exitTime?: string | null;
  holdingTime?: string | null;
  symbol: string;
  side: "LONG" | "SHORT";
  strategy: string;
  entryPrice: number;
  stopLoss?: number | null;
  targetPrice?: number | null;
  exitPrice?: number | null;
  quantity: number;
  pnl: number; // Gross PnL
  fees: number;
  netPnl: number; // Gross PnL - fees
  rMultiple?: number | null;
  status: "OPEN" | "WIN" | "LOSS" | "BREAKEVEN";
  orderType: string;
  notes?: string | null;
  mistakeTag?: string | null;
  screenshotUrl?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DashboardAnalytics {
  startingCapital: number;
  currentCapital: number;
  netPnL: number;
  grossProfit: number;
  grossLoss: number;
  returnPercentage: number;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  breakevenTrades: number;
  winRate: number;
  profitFactor: number;
  hasLosses: boolean;
  averageR: number;
  totalR: number;
  maxDrawdown: number;
  maxDrawdownPercentage: number;
  bestTrade: TradeRecord | null;
  worstTrade: TradeRecord | null;
  bestStrategy: string;
  worstStrategy: string;
}

export interface StrategyAnalytics {
  strategy: string;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  breakevenTrades: number;
  winRate: number;
  grossProfit: number;
  grossLoss: number;
  netPnL: number;
  averagePnL: number;
  profitFactor: number;
  hasLosses: boolean;
  averageR: number;
  totalR: number;
  bestTrade: number;
  worstTrade: number;
  maxDrawdown: number;
  maxDrawdownPercent: number;
}

export interface DailyAnalytics {
  date: string;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  breakevenTrades: number;
  winRate: number;
  netPnL: number;
}

export interface EquityCurvePoint {
  date: string;
  tradeIndex: number;
  label: string;
  tradePnL: number;
  cumulativePnL: number;
  capital: number;
}

export interface MonthlyReviewAnalytics {
  year: number;
  month: number; // 1-12
  startingCapital: number;
  endingCapital: number;
  netPnL: number;
  grossProfit: number;
  grossLoss: number;
  returnPercentage: number;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  breakevenTrades: number;
  winRate: number;
  profitFactor: number;
  hasLosses: boolean;
  averageR: number;
  totalR: number;
  maxDrawdown: number;
  maxDrawdownPercent: number;
  bestStrategy: string;
  worstStrategy: string;
  bestTrade: TradeRecord | null;
  worstTrade: TradeRecord | null;
  strategyBreakdown: StrategyAnalytics[];
}

export interface AnalyticsSummary {
  userId: string;
  dashboard: DashboardAnalytics;
  strategies: StrategyAnalytics[];
  calendar: DailyAnalytics[];
  equityCurve: EquityCurvePoint[];
}

export class AnalyticsService {
  /**
   * Converts a database TradeRow to a normalized backend TradeRecord.
   */
  static normalizeRow(row: TradeRow): TradeRecord {
    const pnl = row.pnl ?? 0;
    const fees = row.fees ?? 0;
    const netPnl = pnl - fees;

    // Normalize strategy name: empty or Order Block falls back to "Manual Trade"
    let strategy = (row.strategy || "").trim();
    if (!strategy || strategy.toUpperCase().includes("ORDER_BLOCK") || strategy.toUpperCase().includes("OB CREATE")) {
      strategy = "Manual Trade";
    }

    return {
      id: row.id,
      userId: row.user_id,
      date: row.date,
      time: row.time,
      exitTime: row.exit_time,
      holdingTime: row.holding_time,
      symbol: row.symbol,
      side: row.side,
      strategy,
      entryPrice: row.entry_price,
      stopLoss: row.stop_loss,
      targetPrice: row.target_price,
      exitPrice: row.exit_price,
      quantity: row.quantity,
      pnl,
      fees,
      netPnl,
      rMultiple: row.r_multiple,
      status: row.status,
      orderType: row.order_type,
      notes: row.notes,
      mistakeTag: row.mistake_tag,
      screenshotUrl: row.screenshot_url,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /**
   * Filters records to CLOSED historical trades only.
   */
  static getClosedTrades(records: TradeRecord[]): TradeRecord[] {
    return records.filter((r) => r.status !== "OPEN");
  }

  /**
   * Calculates Dashboard Analytics.
   */
  static calculateDashboard(
    allRecords: TradeRecord[],
    startingCapital: number = 500
  ): DashboardAnalytics {
    const closed = this.getClosedTrades(allRecords);
    const totalTrades = closed.length;

    if (totalTrades === 0) {
      return {
        startingCapital,
        currentCapital: startingCapital,
        netPnL: 0,
        grossProfit: 0,
        grossLoss: 0,
        returnPercentage: 0,
        totalTrades: 0,
        winningTrades: 0,
        losingTrades: 0,
        breakevenTrades: 0,
        winRate: 0,
        profitFactor: 0,
        hasLosses: false,
        averageR: 0,
        totalR: 0,
        maxDrawdown: 0,
        maxDrawdownPercentage: 0,
        bestTrade: null,
        worstTrade: null,
        bestStrategy: "N/A",
        worstStrategy: "N/A",
      };
    }

    let grossProfit = 0;
    let grossLoss = 0;
    let netPnL = 0;
    let winningTrades = 0;
    let losingTrades = 0;
    let breakevenTrades = 0;
    let totalR = 0;
    let rCount = 0;
    let bestTrade: TradeRecord | null = null;
    let worstTrade: TradeRecord | null = null;

    closed.forEach((t) => {
      const net = t.netPnl;
      netPnL += net;
      if (net > 0) {
        grossProfit += net;
        winningTrades++;
      } else if (net < 0) {
        grossLoss += Math.abs(net);
        losingTrades++;
      } else {
        breakevenTrades++;
      }

      if (t.rMultiple != null && !isNaN(t.rMultiple)) {
        totalR += t.rMultiple;
        rCount++;
      }

      if (!bestTrade || net > bestTrade.netPnl) bestTrade = t;
      if (!worstTrade || net < worstTrade.netPnl) worstTrade = t;
    });

    const winRate = (winningTrades / totalTrades) * 100;
    const hasLosses = grossLoss > 0;
    const profitFactor = hasLosses ? grossProfit / grossLoss : 0;
    const averageR = totalTrades > 0 ? totalR / totalTrades : 0;
    const currentCapital = startingCapital + netPnL;
    const returnPercentage = startingCapital > 0 ? (netPnL / startingCapital) * 100 : 0;

    const { maxDrawdown, maxDrawdownPercentage } = this.calculateDrawdown(
      closed,
      startingCapital
    );

    const strategyStats = this.calculateStrategies(allRecords);
    const activeStrategies = strategyStats.filter((s) => s.totalTrades > 0);

    let bestStrategy = "N/A";
    let worstStrategy = "N/A";
    if (activeStrategies.length > 0) {
      const sortedByPnL = [...activeStrategies].sort((a, b) => b.netPnL - a.netPnL);
      bestStrategy = sortedByPnL[0].strategy;
      worstStrategy = sortedByPnL[sortedByPnL.length - 1].strategy;
    }

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
      breakevenTrades,
      winRate,
      profitFactor,
      hasLosses,
      averageR,
      totalR,
      maxDrawdown,
      maxDrawdownPercentage,
      bestTrade,
      worstTrade,
      bestStrategy,
      worstStrategy,
    };
  }

  /**
   * Calculates Strategy Analytics.
   */
  static calculateStrategies(allRecords: TradeRecord[]): StrategyAnalytics[] {
    const closed = this.getClosedTrades(allRecords);
    const strategyMap: Record<string, TradeRecord[]> = {};

    // Initialize map with supported strategies
    SUPPORTED_STRATEGIES.forEach((s) => {
      strategyMap[s] = [];
    });

    // Populate from trades
    closed.forEach((t) => {
      let stratName = t.strategy;
      if (!strategyMap[stratName]) {
        strategyMap[stratName] = [];
      }
      strategyMap[stratName].push(t);
    });

    const results: StrategyAnalytics[] = [];

    Object.entries(strategyMap).forEach(([strategy, stratTrades]) => {
      const totalTrades = stratTrades.length;
      if (totalTrades === 0) {
        results.push({
          strategy,
          totalTrades: 0,
          winningTrades: 0,
          losingTrades: 0,
          breakevenTrades: 0,
          winRate: 0,
          grossProfit: 0,
          grossLoss: 0,
          netPnL: 0,
          averagePnL: 0,
          profitFactor: 0,
          hasLosses: false,
          averageR: 0,
          totalR: 0,
          bestTrade: 0,
          worstTrade: 0,
          maxDrawdown: 0,
          maxDrawdownPercent: 0,
        });
        return;
      }

      let winningTrades = 0;
      let losingTrades = 0;
      let breakevenTrades = 0;
      let grossProfit = 0;
      let grossLoss = 0;
      let netPnL = 0;
      let totalR = 0;
      let bestTrade = stratTrades[0].netPnl;
      let worstTrade = stratTrades[0].netPnl;

      stratTrades.forEach((t) => {
        const net = t.netPnl;
        netPnL += net;
        if (net > 0) {
          grossProfit += net;
          winningTrades++;
        } else if (net < 0) {
          grossLoss += Math.abs(net);
          losingTrades++;
        } else {
          breakevenTrades++;
        }

        if (t.rMultiple != null && !isNaN(t.rMultiple)) {
          totalR += t.rMultiple;
        }

        if (net > bestTrade) bestTrade = net;
        if (net < worstTrade) worstTrade = net;
      });

      const winRate = (winningTrades / totalTrades) * 100;
      const hasLosses = grossLoss > 0;
      const profitFactor = hasLosses ? grossProfit / grossLoss : 0;
      const averagePnL = netPnL / totalTrades;
      const averageR = totalR / totalTrades;

      // Strategy Drawdown
      let peak = 0;
      let cum = 0;
      let maxDD = 0;
      stratTrades.forEach((t) => {
        cum += t.netPnl;
        if (cum > peak) peak = cum;
        const dd = peak - cum;
        if (dd > maxDD) maxDD = dd;
      });
      const maxDrawdownPercent = peak > 0 ? (maxDD / peak) * 100 : 0;

      results.push({
        strategy,
        totalTrades,
        winningTrades,
        losingTrades,
        breakevenTrades,
        winRate,
        grossProfit,
        grossLoss,
        netPnL,
        averagePnL,
        profitFactor,
        hasLosses,
        averageR,
        totalR,
        bestTrade,
        worstTrade,
        maxDrawdown: maxDD,
        maxDrawdownPercent,
      });
    });

    return results;
  }

  /**
   * Calculates Peak-to-Trough Drawdown from chronological realized closed trade sequence.
   */
  static calculateDrawdown(
    closedTrades: TradeRecord[],
    startingCapital: number = 500
  ): { maxDrawdown: number; maxDrawdownPercentage: number } {
    if (closedTrades.length === 0) {
      return { maxDrawdown: 0, maxDrawdownPercentage: 0 };
    }

    // Sort by date/created_at chronological ascending
    const sorted = [...closedTrades].sort((a, b) =>
      new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );

    let peakEquity = startingCapital;
    let currentEquity = startingCapital;
    let maxDrawdownDollar = 0;
    let maxDrawdownPercent = 0;

    sorted.forEach((t) => {
      currentEquity += t.netPnl;
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
   * Calculates Equity Curve points starting at startingCapital.
   */
  static calculateEquityCurve(
    closedTrades: TradeRecord[],
    startingCapital: number = 500
  ): EquityCurvePoint[] {
    const sorted = [...closedTrades].sort((a, b) =>
      new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );

    const points: EquityCurvePoint[] = [
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

    sorted.forEach((t, i) => {
      const net = t.netPnl;
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
   * Aggregates Calendar daily performance statistics.
   */
  static calculateCalendar(allRecords: TradeRecord[]): DailyAnalytics[] {
    const closed = this.getClosedTrades(allRecords);
    const dayMap: Record<string, TradeRecord[]> = {};

    closed.forEach((t) => {
      const dayStr = t.date;
      if (!dayMap[dayStr]) dayMap[dayStr] = [];
      dayMap[dayStr].push(t);
    });

    const calendar: DailyAnalytics[] = [];

    Object.entries(dayMap).forEach(([date, dayTrades]) => {
      const totalTrades = dayTrades.length;
      let winningTrades = 0;
      let losingTrades = 0;
      let breakevenTrades = 0;
      let netPnL = 0;

      dayTrades.forEach((t) => {
        netPnL += t.netPnl;
        if (t.netPnl > 0) winningTrades++;
        else if (t.netPnl < 0) losingTrades++;
        else breakevenTrades++;
      });

      const winRate = totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0;

      calendar.push({
        date,
        totalTrades,
        winningTrades,
        losingTrades,
        breakevenTrades,
        winRate,
        netPnL,
      });
    });

    return calendar.sort((a, b) => a.date.localeCompare(b.date));
  }

  /**
   * Calculates Monthly Review metrics for a specific year & month (1-12).
   */
  static calculateMonthlyReview(
    allRecords: TradeRecord[],
    year: number,
    month: number,
    baseCapital: number = 500
  ): MonthlyReviewAnalytics {
    const closed = this.getClosedTrades(allRecords).sort((a, b) =>
      new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );

    const monthStr = String(month).padStart(2, "0");
    const monthPrefix = `${year}-${monthStr}`;

    // Trades prior to this month
    const priorTrades = closed.filter((t) => t.date < `${monthPrefix}-01`);
    const priorPnL = priorTrades.reduce((acc, t) => acc + t.netPnl, 0);
    const startingCapital = baseCapital + priorPnL;

    // Month trades
    const monthTrades = closed.filter((t) => t.date.startsWith(monthPrefix));
    const totalTrades = monthTrades.length;

    if (totalTrades === 0) {
      return {
        year,
        month,
        startingCapital,
        endingCapital: startingCapital,
        netPnL: 0,
        grossProfit: 0,
        grossLoss: 0,
        returnPercentage: 0,
        totalTrades: 0,
        winningTrades: 0,
        losingTrades: 0,
        breakevenTrades: 0,
        winRate: 0,
        profitFactor: 0,
        hasLosses: false,
        averageR: 0,
        totalR: 0,
        maxDrawdown: 0,
        maxDrawdownPercent: 0,
        bestStrategy: "N/A",
        worstStrategy: "N/A",
        bestTrade: null,
        worstTrade: null,
        strategyBreakdown: [],
      };
    }

    let grossProfit = 0;
    let grossLoss = 0;
    let netPnL = 0;
    let winningTrades = 0;
    let losingTrades = 0;
    let breakevenTrades = 0;
    let totalR = 0;
    let bestTrade: TradeRecord | null = null;
    let worstTrade: TradeRecord | null = null;

    monthTrades.forEach((t) => {
      const net = t.netPnl;
      netPnL += net;
      if (net > 0) {
        grossProfit += net;
        winningTrades++;
      } else if (net < 0) {
        grossLoss += Math.abs(net);
        losingTrades++;
      } else {
        breakevenTrades++;
      }

      if (t.rMultiple != null && !isNaN(t.rMultiple)) {
        totalR += t.rMultiple;
      }

      if (!bestTrade || net > bestTrade.netPnl) bestTrade = t;
      if (!worstTrade || net < worstTrade.netPnl) worstTrade = t;
    });

    const winRate = (winningTrades / totalTrades) * 100;
    const hasLosses = grossLoss > 0;
    const profitFactor = hasLosses ? grossProfit / grossLoss : 0;
    const averageR = totalR / totalTrades;
    const endingCapital = startingCapital + netPnL;
    const returnPercentage = startingCapital > 0 ? (netPnL / startingCapital) * 100 : 0;

    const { maxDrawdown, maxDrawdownPercentage: maxDrawdownPercent } =
      this.calculateDrawdown(monthTrades, startingCapital);

    const strategyBreakdown = this.calculateStrategies(monthTrades).filter(
      (s) => s.totalTrades > 0
    );

    let bestStrategy = "N/A";
    let worstStrategy = "N/A";
    if (strategyBreakdown.length > 0) {
      const sortedByPnL = [...strategyBreakdown].sort((a, b) => b.netPnL - a.netPnL);
      bestStrategy = sortedByPnL[0].strategy;
      worstStrategy = sortedByPnL[sortedByPnL.length - 1].strategy;
    }

    return {
      year,
      month,
      startingCapital,
      endingCapital,
      netPnL,
      grossProfit,
      grossLoss,
      returnPercentage,
      totalTrades,
      winningTrades,
      losingTrades,
      breakevenTrades,
      winRate,
      profitFactor,
      hasLosses,
      averageR,
      totalR,
      maxDrawdown,
      maxDrawdownPercent,
      bestStrategy,
      worstStrategy,
      bestTrade,
      worstTrade,
      strategyBreakdown,
    };
  }
}
