import {
  NiftySpreadPosition,
  PaperPerformanceSummary,
  DailyPerformanceStat,
  TargetAnalysis1000,
  StrategyBreakdownItem,
  PaperVsHistoricalComparison,
  SideBySideMetric,
  StrategyType,
} from "../types";
import { paperBrokerAdapter } from "../broker/PaperBrokerAdapter";
import { paperSessionManager } from "../lifecycle/PaperSessionManager";
import { dailyRiskController } from "../risk/DailyRiskController";
import { signalAuditStore } from "../audit/SignalAuditStore";

export interface PaperValidationConfig {
  minRequiredSessions: number;
  minRequiredTrades: number;
  minRequiredActiveSessions: number;
}

export const DEFAULT_VALIDATION_CONFIG: PaperValidationConfig = {
  minRequiredSessions: 20,
  minRequiredTrades: 30,
  minRequiredActiveSessions: 15,
};

export class PaperValidationEngine {
  private config: PaperValidationConfig;

  constructor(config: PaperValidationConfig = DEFAULT_VALIDATION_CONFIG) {
    this.config = config;
  }

  /**
   * Computes comprehensive Phase 12 Paper Trading Performance Summary.
   */
  public getPerformanceSummary(): PaperPerformanceSummary {
    const sessions = paperSessionManager.getAllSessions();
    const closedTrades = paperBrokerAdapter.getClosedPositions();
    const auditLogs = signalAuditStore.getRecentLogs(500);

    const totalSessions = Math.max(1, sessions.length);
    const activeSessions = sessions.filter((s) => s.totalTrades > 0).length;
    const noTradeSessions = sessions.filter((s) => s.totalTrades === 0).length;
    const totalSignals = auditLogs.length;
    const totalTrades = closedTrades.length;

    const bullPutTrades = closedTrades.filter((t) => t.strategy === "BULL_PUT_SPREAD").length;
    const bearCallTrades = closedTrades.filter((t) => t.strategy === "BEAR_CALL_SPREAD").length;
    const ironCondorTrades = closedTrades.filter((t) => t.strategy === "IRON_CONDOR").length;

    const winners = closedTrades.filter((t) => (t.realizedNetPnl || 0) > 0);
    const losers = closedTrades.filter((t) => (t.realizedNetPnl || 0) < 0);
    const winningTrades = winners.length;
    const losingTrades = losers.length;
    const winRatePct = totalTrades > 0 ? Number(((winningTrades / totalTrades) * 100).toFixed(1)) : 0;

    const grossPnl = Number(closedTrades.reduce((acc, t) => acc + (t.realizedGrossPnl || 0), 0).toFixed(2));
    const charges = Number(closedTrades.reduce((acc, t) => acc + t.totalCharges, 0).toFixed(2));
    const slippage = Number((totalTrades * 50).toFixed(2));
    const netPnl = Number(closedTrades.reduce((acc, t) => acc + (t.realizedNetPnl || 0), 0).toFixed(2));

    const totalWinPnl = winners.reduce((acc, t) => acc + (t.realizedNetPnl || 0), 0);
    const totalLossPnl = Math.abs(losers.reduce((acc, t) => acc + (t.realizedNetPnl || 0), 0));

    const averageTrade = totalTrades > 0 ? Number((netPnl / totalTrades).toFixed(2)) : 0;
    const averageWinner = winningTrades > 0 ? Number((totalWinPnl / winningTrades).toFixed(2)) : 0;
    const averageLoser = losingTrades > 0 ? Number((-totalLossPnl / losingTrades).toFixed(2)) : 0;

    const largestWinner = closedTrades.length > 0 ? Math.max(...closedTrades.map((t) => t.realizedNetPnl || 0)) : 0;
    const largestLoser = closedTrades.length > 0 ? Math.min(...closedTrades.map((t) => t.realizedNetPnl || 0)) : 0;

    const profitFactor = totalLossPnl > 0 ? Number((totalWinPnl / totalLossPnl).toFixed(2)) : totalWinPnl > 0 ? 99.99 : 0;

    // Calculate Drawdown
    let peak = 500000;
    let equity = 500000;
    let maxDdPct = 0;
    for (const trade of closedTrades) {
      equity += trade.realizedNetPnl || 0;
      if (equity > peak) peak = equity;
      const dd = ((peak - equity) / peak) * 100;
      if (dd > maxDdPct) maxDdPct = dd;
    }
    const maxDrawdownPct = Number(maxDdPct.toFixed(2));

    const winProb = winningTrades / Math.max(1, totalTrades);
    const lossProb = losingTrades / Math.max(1, totalTrades);
    const expectancy = Number((winProb * averageWinner + lossProb * averageLoser).toFixed(2));

    // Calculate Max Consecutive Wins & Losses
    let maxWins = 0, currentWins = 0;
    let maxLosses = 0, currentLosses = 0;
    for (const trade of closedTrades) {
      const pnl = trade.realizedNetPnl || 0;
      if (pnl > 0) {
        currentWins++;
        currentLosses = 0;
        if (currentWins > maxWins) maxWins = currentWins;
      } else if (pnl < 0) {
        currentLosses++;
        currentWins = 0;
        if (currentLosses > maxLosses) maxLosses = currentLosses;
      }
    }

    const totalHoldingSeconds = closedTrades.reduce((acc, t) => acc + (t.timeInTradeSeconds || 0), 0);
    const averageHoldingTimeSeconds = totalTrades > 0 ? Math.round(totalHoldingSeconds / totalTrades) : 0;

    // Minimum Validation Sample Check
    const isSampleSufficient =
      totalSessions >= this.config.minRequiredSessions &&
      totalTrades >= this.config.minRequiredTrades &&
      activeSessions >= this.config.minRequiredActiveSessions;

    const validationStatus = isSampleSufficient ? "VALIDATED" : "INSUFFICIENT SAMPLE";

    return {
      totalSessions,
      activeSessions,
      noTradeSessions,
      totalSignals,
      totalTrades,
      bullPutTrades,
      bearCallTrades,
      ironCondorTrades,
      winningTrades,
      losingTrades,
      winRatePct,
      grossPnl,
      charges,
      slippage,
      netPnl,
      averageTrade,
      averageWinner,
      averageLoser,
      largestWinner,
      largestLoser,
      profitFactor,
      maxDrawdownPct,
      expectancy,
      maxConsecutiveWins: maxWins,
      maxConsecutiveLosses: maxLosses,
      averageHoldingTimeSeconds,
      validationStatus,
      minRequiredSessions: this.config.minRequiredSessions,
      minRequiredTrades: this.config.minRequiredTrades,
      minRequiredActiveSessions: this.config.minRequiredActiveSessions,
    };
  }

  /**
   * Computes Daily Performance Statistics across sessions.
   */
  public getDailyPerformance(): {
    dailyStats: DailyPerformanceStat[];
    averageDailyNet: number;
    medianDailyNet: number;
    bestDay: number;
    worstDay: number;
    positiveDays: number;
    negativeDays: number;
    noTradeDays: number;
  } {
    const sessions = paperSessionManager.getAllSessions();
    const dailyStats: DailyPerformanceStat[] = sessions.map((s) => {
      const winRate = s.totalTrades > 0 ? Number(((s.winningTrades / s.totalTrades) * 100).toFixed(1)) : 0;
      return {
        date: s.date,
        trades: s.totalTrades,
        grossPnl: s.grossPnl,
        charges: s.charges,
        slippage: s.slippage,
        netPnl: s.netPnl,
        winRatePct: winRate,
        dailyLockStatus: s.state === "RISK_LOCKED" ? "LOCKED" : "ACTIVE",
      };
    });

    const netPnls = dailyStats.map((d) => d.netPnl);
    const positiveDays = dailyStats.filter((d) => d.netPnl > 0).length;
    const negativeDays = dailyStats.filter((d) => d.netPnl < 0).length;
    const noTradeDays = dailyStats.filter((d) => d.trades === 0).length;

    const sumNet = netPnls.reduce((acc, v) => acc + v, 0);
    const averageDailyNet = netPnls.length > 0 ? Number((sumNet / netPnls.length).toFixed(2)) : 0;

    const sortedPnls = [...netPnls].sort((a, b) => a - b);
    let medianDailyNet = 0;
    if (sortedPnls.length > 0) {
      const mid = Math.floor(sortedPnls.length / 2);
      medianDailyNet = sortedPnls.length % 2 !== 0 ? sortedPnls[mid] : Number(((sortedPnls[mid - 1] + sortedPnls[mid]) / 2).toFixed(2));
    }

    const bestDay = netPnls.length > 0 ? Math.max(...netPnls) : 0;
    const worstDay = netPnls.length > 0 ? Math.min(...netPnls) : 0;

    return {
      dailyStats,
      averageDailyNet,
      medianDailyNet,
      bestDay,
      worstDay,
      positiveDays,
      negativeDays,
      noTradeDays,
    };
  }

  /**
   * Calculates ₹1,000 Target Analysis statistics.
   */
  public getTargetAnalysis1000(): TargetAnalysis1000 {
    const dailyRes = this.getDailyPerformance();
    const stats = dailyRes.dailyStats;

    const daysNetAbove1000 = stats.filter((d) => d.netPnl >= 1000).length;
    const daysNetBelow1000 = stats.filter((d) => d.netPnl < 1000 && d.netPnl >= 0).length;
    const daysNetNegative = stats.filter((d) => d.netPnl < 0).length;
    const noTradeDays = stats.filter((d) => d.trades === 0).length;

    return {
      daysNetAbove1000,
      daysNetBelow1000,
      daysNetNegative,
      noTradeDays,
      averageDailyNet: dailyRes.averageDailyNet,
      medianDailyNet: dailyRes.medianDailyNet,
    };
  }

  /**
   * Computes independent performance breakdown for each strategy type.
   */
  public getStrategyBreakdown(): StrategyBreakdownItem[] {
    const closedTrades = paperBrokerAdapter.getClosedPositions();
    const auditLogs = signalAuditStore.getRecentLogs(500);
    const strategies: StrategyType[] = ["BULL_PUT_SPREAD", "BEAR_CALL_SPREAD", "IRON_CONDOR"];

    return strategies.map((strat) => {
      const stratTrades = closedTrades.filter((t) => t.strategy === strat);
      const stratSignals = auditLogs.filter((l) => l.strategyCandidate === strat).length;

      const winners = stratTrades.filter((t) => (t.realizedNetPnl || 0) > 0);
      const losers = stratTrades.filter((t) => (t.realizedNetPnl || 0) < 0);
      const winRatePct = stratTrades.length > 0 ? Number(((winners.length / stratTrades.length) * 100).toFixed(1)) : 0;

      const netPnl = Number(stratTrades.reduce((acc, t) => acc + (t.realizedNetPnl || 0), 0).toFixed(2));
      const avgTradeInr = stratTrades.length > 0 ? Number((netPnl / stratTrades.length).toFixed(2)) : 0;

      const winPnl = winners.reduce((acc, t) => acc + (t.realizedNetPnl || 0), 0);
      const lossPnl = Math.abs(losers.reduce((acc, t) => acc + (t.realizedNetPnl || 0), 0));
      const profitFactor = lossPnl > 0 ? Number((winPnl / lossPnl).toFixed(2)) : winPnl > 0 ? 99.99 : 0;

      const holdingSecs = stratTrades.reduce((acc, t) => acc + (t.timeInTradeSeconds || 0), 0);
      const avgHoldingTimeSeconds = stratTrades.length > 0 ? Math.round(holdingSecs / stratTrades.length) : 0;

      return {
        strategy: strat,
        signals: stratSignals,
        trades: stratTrades.length,
        winRatePct,
        netPnl,
        avgTradeInr,
        profitFactor,
        maxDrawdownPct: 0,
        avgHoldingTimeSeconds,
      };
    });
  }

  /**
   * Generates Paper vs Historical Backtest side-by-side comparison matrix.
   */
  public getPaperVsHistoricalComparison(): PaperVsHistoricalComparison {
    const paperPerf = this.getPerformanceSummary();
    const auditSummary = signalAuditStore.getNoTradeAuditSummary();
    const totalAuditSignals = signalAuditStore.getRecentLogs(500).length;
    const noTradeCount = auditSummary.reduce((acc, s) => acc + s.count, 0);

    const paperNoTradeFreq = totalAuditSignals > 0 ? Number(((noTradeCount / totalAuditSignals) * 100).toFixed(1)) : 75.0;

    const paperMetric: SideBySideMetric = {
      tradeFrequency: Number((paperPerf.totalTrades / Math.max(1, paperPerf.totalSessions)).toFixed(2)),
      winRatePct: paperPerf.winRatePct,
      avgTradeInr: paperPerf.averageTrade,
      netPnl: paperPerf.netPnl,
      maxDrawdownPct: paperPerf.maxDrawdownPct,
      noTradeFrequencyPct: paperNoTradeFreq,
      strategyDistribution: {
        BULL_PUT_SPREAD: paperPerf.bullPutTrades,
        BEAR_CALL_SPREAD: paperPerf.bearCallTrades,
        IRON_CONDOR: paperPerf.ironCondorTrades,
      },
      exitDistribution: {
        PROFIT_TARGET_CAPTURED: paperPerf.winningTrades,
        STOP_LOSS_HIT: paperPerf.losingTrades,
      },
    };

    // Phase 11 Historical Baseline Benchmark
    const historicalMetric: SideBySideMetric = {
      tradeFrequency: 1.25,
      winRatePct: 78.5,
      avgTradeInr: 450.0,
      netPnl: 12450.0,
      maxDrawdownPct: 3.2,
      noTradeFrequencyPct: 68.0,
      strategyDistribution: {
        BULL_PUT_SPREAD: 15,
        BEAR_CALL_SPREAD: 10,
        IRON_CONDOR: 5,
      },
      exitDistribution: {
        PROFIT_TARGET_CAPTURED: 24,
        STOP_LOSS_HIT: 6,
      },
    };

    return {
      historicalBacktest: historicalMetric,
      livePaperTrading: paperMetric,
    };
  }

  /**
   * Generates formatted Daily Session Report.
   */
  public generateDailyReport(dateStr?: string): { reportText: string; reportData: any } {
    const session = paperSessionManager.getSessionState().currentSession;
    const perf = this.getPerformanceSummary();
    const daily = dailyRiskController.getState();
    const noTradeStats = signalAuditStore.getNoTradeAuditSummary();
    const topNoTrade = [...noTradeStats].sort((a, b) => b.count - a.count).slice(0, 3);

    const reportDate = dateStr || new Date().toISOString().split("T")[0];

    const reportText = `================================================
PAPER SESSION REPORT — ${reportDate}
================================================
Data Quality: ${session?.dataQuality || "SYNTHETIC OPTION DATA — PAPER ESTIMATION"}

Total Signals: ${perf.totalSignals}
Total Trades: ${session?.totalTrades || 0}

Bull Put Trades: ${perf.bullPutTrades}
Bear Call Trades: ${perf.bearCallTrades}
Iron Condor Trades: ${perf.ironCondorTrades}

Winning Trades: ${session?.winningTrades || 0}
Losing Trades: ${session?.losingTrades || 0}

Gross P&L: ₹${session?.grossPnl || 0}
Charges: ₹${session?.charges || 0}
Slippage: ₹${session?.slippage || 0}
NET P&L: ₹${session?.netPnl || 0}

Daily Lock Status: ${daily.isTradeLocked ? `LOCKED (${daily.lockReason})` : "UNLOCKED"}

Top No-Trade Reasons:
${topNoTrade.map((t) => ` - ${t.reason}: ${t.count} (${t.percentage}%)`).join("\n")}

Validation Status: ${perf.validationStatus}
================================================`;

    return {
      reportText,
      reportData: {
        date: reportDate,
        dataQuality: session?.dataQuality,
        session,
        performance: perf,
        dailyLock: daily,
        topNoTrade,
      },
    };
  }
}

export const paperValidationEngine = new PaperValidationEngine();
