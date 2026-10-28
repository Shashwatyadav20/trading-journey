/**
 * SwingBacktestRunner.ts
 *
 * Runs runHistoricalBacktest() across a universe of symbols for each of the 8
 * swing strategies. Produces per-symbol, per-strategy, and aggregate reports.
 *
 * Scope: stock swing validation only.
 * Safety: does not place orders, does not write to Supabase, does not change strategy rules.
 *
 * Assumptions documented (reuses runHistoricalBacktest behaviour):
 *   - Entry:  next-bar open after signal confirmation
 *   - SL:     fill at stopLoss exactly (no gap-through-stop model)
 *   - Target: fill at target1 exactly
 *   - Collision (same-bar SL+T1): stop checked first — pessimistic / conservative
 *   - Cost:   0.1% fixed round-trip (approximate brokerage + STT + exchange charges)
 *   - Slippage: not explicitly modelled on entry (known limitation L4)
 *   - Max hold: 15 trading days before time-based exit at close
 *   - Position: 1% of current equity per trade; stop-distance floor 0.5%
 */

import {
  runHistoricalBacktest,
  BacktestResult,
  StrategyId,
  DailyCandle,
} from "../../../../lib/indian/dailyStrategyScanner";
import { SymbolDataset, SplitDatasets } from "./NseHistoricalCsvImporter";

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

export const ALL_STRATEGY_IDS: StrategyId[] = [
  "STRATEGY_A_BREAKOUT",
  "STRATEGY_B_PULLBACK",
  "STRATEGY_C_SUPPORT_BOUNCE",
  "STRATEGY_D_MA_CROSSOVER",
  "STRATEGY_E_MOMENTUM",
  "STRATEGY_F_RANGE_BREAKOUT",
  "STRATEGY_G_TREND_CONTINUATION",
  "STRATEGY_H_VOLUME_BREAKOUT",
];

const MIN_CANDLES_FOR_BACKTEST = 45;  // matches runHistoricalBacktest guard
const MIN_TRADES_FOR_REPORT = 3;      // suppress metrics for very sparse samples

// ─────────────────────────────────────────────────────────────────────────────
// Output interfaces
// ─────────────────────────────────────────────────────────────────────────────

export interface StrategyAggregateMetrics {
  strategyId: StrategyId;
  symbolsWithTrades: number;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRatePercent: number;
  avgWinPct: number;
  avgLossPct: number;
  /** avgWinPct * winRate - avgLossPct * lossRate */
  expectancyPercent: number;
  profitFactor: number;
  maxDrawdownPercent: number;   // worst single-symbol drawdown
  netReturnPercent: number;     // average across symbols
  avgHoldingBars: number;
  sampleSizeSufficient: boolean;  // false when totalTrades < MIN_TRADES_FOR_REPORT
  warning?: string;
}

export interface SymbolStrategyResult {
  symbol: string;
  strategyId: StrategyId;
  candles: number;
  firstDate: string;
  lastDate: string;
  result: BacktestResult;
}

export interface BacktestRunReport {
  /** "IN_SAMPLE" or "OUT_OF_SAMPLE" */
  period: "IN_SAMPLE" | "OUT_OF_SAMPLE";
  dateRangeStart: string;
  dateRangeEnd: string;
  symbols: string[];
  symbolCount: number;
  strategyResults: StrategyAggregateMetrics[];
  /** Flat list — all (symbol, strategy) results */
  symbolStrategyResults: SymbolStrategyResult[];
  /** Data not genuine? Always "PENDING_REAL_DATA" if no real data loaded */
  dataStatus: "REAL_DATA" | "PENDING_REAL_DATA";
  generatedAt: string;
  knownLimitations: string[];
}

export interface FullBacktestReport {
  inSample: BacktestRunReport;
  outOfSample: BacktestRunReport;
  dataStatus: "REAL_DATA" | "PENDING_REAL_DATA";
  sourceFileName: string;
  contentFingerprint: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// SwingBacktestRunner
// ─────────────────────────────────────────────────────────────────────────────

export class SwingBacktestRunner {

  private readonly KNOWN_LIMITATIONS = [
    "L1: Same-bar SL+T1 collision — stop checked before target (pessimistic/conservative).",
    "L2: Gap-through-stop not modelled — SL fill at stopLoss price, not actual open.",
    "L3: Cost fixed at 0.1% round-trip — does not model STT separately or large-trade impact.",
    "L4: No entry slippage model — entry filled at bar open exactly.",
    "L5: Only target1 used — target2 computed but never triggered.",
    "L6: Max hold 15 trading days — time-exit at close regardless of position state.",
    "L7: Survivorship bias not controlled — universe is the provided file, not the period universe.",
    "L8: Corporate actions not adjusted unless data provider declares ADJUSTED prices.",
    "L9: No benchmark return available unless caller provides Nifty 500 symbol separately.",
  ];

  /**
   * Runs the full backtest across in-sample and out-of-sample datasets.
   * Accepts a SplitDatasets object from NseHistoricalCsvImporter.splitInSampleOutOfSample().
   */
  runFullBacktest(
    split: SplitDatasets,
    sourceFileName: string,
    contentFingerprint: string,
    strategies: StrategyId[] = ALL_STRATEGY_IDS
  ): FullBacktestReport {
    const isReport = this.runPeriod(
      split.inSample,
      "IN_SAMPLE",
      split.config.dataStartDate,
      split.config.inSampleEndDate,
      strategies
    );

    const oosReport = this.runPeriod(
      split.outOfSample,
      "OUT_OF_SAMPLE",
      split.config.outOfSampleStartDate,
      split.config.outOfSampleEndDate,
      strategies
    );

    const dataStatus = isReport.dataStatus === "REAL_DATA" ? "REAL_DATA" : "PENDING_REAL_DATA";

    return {
      inSample: isReport,
      outOfSample: oosReport,
      dataStatus,
      sourceFileName,
      contentFingerprint,
    };
  }

  /**
   * Runs all strategies across all symbols in a dataset map for one time period.
   */
  runPeriod(
    datasets: Map<string, SymbolDataset>,
    period: "IN_SAMPLE" | "OUT_OF_SAMPLE",
    dateStart: string,
    dateEnd: string,
    strategies: StrategyId[] = ALL_STRATEGY_IDS
  ): BacktestRunReport {
    const symbolStrategyResults: SymbolStrategyResult[] = [];
    const symbols = Array.from(datasets.keys()).sort();

    for (const symbol of symbols) {
      const ds = datasets.get(symbol)!;
      const candles = ds.candles;

      if (candles.length < MIN_CANDLES_FOR_BACKTEST) continue;

      for (const stratId of strategies) {
        try {
          const result = runHistoricalBacktest(symbol, stratId, candles);
          symbolStrategyResults.push({
            symbol,
            strategyId: stratId,
            candles: candles.length,
            firstDate: ds.firstDate,
            lastDate: ds.lastDate,
            result,
          });
        } catch (err) {
          // Do not crash the whole run on a single symbol failure
          console.warn(`[SwingBacktestRunner] ${symbol}/${stratId} failed: ${err}`);
        }
      }
    }

    const strategyResults = strategies.map((stratId) =>
      this.aggregateStrategy(stratId, symbolStrategyResults)
    );

    const dataStatus: "REAL_DATA" | "PENDING_REAL_DATA" =
      datasets.size > 0 ? "REAL_DATA" : "PENDING_REAL_DATA";

    return {
      period,
      dateRangeStart: dateStart,
      dateRangeEnd: dateEnd,
      symbols,
      symbolCount: symbols.length,
      strategyResults,
      symbolStrategyResults,
      dataStatus,
      generatedAt: new Date().toISOString(),
      knownLimitations: this.KNOWN_LIMITATIONS,
    };
  }

  /**
   * Aggregates per-symbol BacktestResults for a single strategy.
   */
  private aggregateStrategy(
    strategyId: StrategyId,
    all: SymbolStrategyResult[]
  ): StrategyAggregateMetrics {
    const rows = all.filter((r) => r.strategyId === strategyId && r.result.totalTrades > 0);

    const totalTrades    = rows.reduce((s, r) => s + r.result.totalTrades, 0);
    const winningTrades  = rows.reduce((s, r) => s + r.result.winningTrades, 0);
    const losingTrades   = rows.reduce((s, r) => s + r.result.losingTrades, 0);

    if (totalTrades < MIN_TRADES_FOR_REPORT) {
      return {
        strategyId,
        symbolsWithTrades: rows.length,
        totalTrades,
        winningTrades,
        losingTrades,
        winRatePercent: 0,
        avgWinPct: 0,
        avgLossPct: 0,
        expectancyPercent: 0,
        profitFactor: 0,
        maxDrawdownPercent: 0,
        netReturnPercent: 0,
        avgHoldingBars: 0,
        sampleSizeSufficient: false,
        warning: `Insufficient sample (${totalTrades} trades). Metrics suppressed.`,
      };
    }

    // Win/loss averages — pool all trade PnL %
    const allTrades = rows.flatMap((r) => r.result.trades);
    const winTrades  = allTrades.filter((t) => t.isWin);
    const lossTrades = allTrades.filter((t) => !t.isWin);

    const avgWinPct  = winTrades.length  > 0 ? winTrades.reduce((s, t) => s + t.pnlPercent, 0) / winTrades.length : 0;
    const avgLossPct = lossTrades.length > 0 ? Math.abs(lossTrades.reduce((s, t) => s + t.pnlPercent, 0) / lossTrades.length) : 0;

    const winRate  = totalTrades > 0 ? winningTrades / totalTrades : 0;
    const lossRate = 1 - winRate;
    const expectancyPercent = Number((winRate * avgWinPct - lossRate * avgLossPct).toFixed(3));

    const totalGainsPct  = winTrades.reduce((s, t) => s + t.pnlPercent, 0);
    const totalLossesPct = Math.abs(lossTrades.reduce((s, t) => s + t.pnlPercent, 0));
    const profitFactor   = totalLossesPct > 0
      ? Number((totalGainsPct / totalLossesPct).toFixed(2))
      : totalGainsPct > 0 ? 5.0 : 0;

    const maxDrawdown = rows.reduce((m, r) => Math.max(m, r.result.maxDrawdownPercent), 0);
    const netReturnPct = rows.length > 0
      ? rows.reduce((s, r) => s + r.result.netReturnPercent, 0) / rows.length
      : 0;

    const avgHoldingBars = allTrades.length > 0
      ? allTrades.reduce((s, t) => s + t.barsHeld, 0) / allTrades.length
      : 0;

    return {
      strategyId,
      symbolsWithTrades: rows.length,
      totalTrades,
      winningTrades,
      losingTrades,
      winRatePercent: Number((winRate * 100).toFixed(1)),
      avgWinPct: Number(avgWinPct.toFixed(2)),
      avgLossPct: Number(avgLossPct.toFixed(2)),
      expectancyPercent,
      profitFactor,
      maxDrawdownPercent: Number(maxDrawdown.toFixed(2)),
      netReturnPercent: Number(netReturnPct.toFixed(2)),
      avgHoldingBars: Number(avgHoldingBars.toFixed(1)),
      sampleSizeSufficient: true,
    };
  }
}

export const swingBacktestRunner = new SwingBacktestRunner();
