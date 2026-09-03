"use client";

import React, { useState } from "react";
import { useTrades } from "../../context/TradeContext";
import {
  filterTrades,
  aggregateDailyPnL,
  aggregateStrategyPnL,
  aggregateWinLossDistribution,
  aggregateRMultipleDistribution,
  DEFAULT_ANALYTICS_FILTERS,
  AnalyticsFilterState,
} from "../../lib/analyticsAggregations";
import {
  calculateEquityCurve,
  calculateDashboardMetrics,
  formatCurrency,
  formatPercent,
  DEFAULT_STARTING_CAPITAL,
} from "../../lib/calculations";
import AnalyticsFilterBar from "../analytics/AnalyticsFilterBar";
import EquityCurveAnalyticsChart from "../analytics/EquityCurveAnalyticsChart";
import DailyPnLChart from "../analytics/DailyPnLChart";
import StrategyPnLChart from "../analytics/StrategyPnLChart";
import WinLossPieChart from "../analytics/WinLossPieChart";
import RDistributionChart from "../analytics/RDistributionChart";
import { PRESET_STRATEGIES } from "../../types/trade";
import {
  BarChart3,
  DollarSign,
  Award,
  Hash,
  Layers,
  Sparkles,
  FolderOpen,
  TrendingUp,
  Activity,
} from "lucide-react";

export default function AnalyticsView() {
  const { trades, loadSampleTrades, clearTrades } = useTrades();
  const [startingCapital] = useState<number>(DEFAULT_STARTING_CAPITAL);

  // Filter State
  const [filters, setFilters] = useState<AnalyticsFilterState>(
    DEFAULT_ANALYTICS_FILTERS
  );

  // Filter Trades
  const filteredTrades = filterTrades(trades, filters);

  // Derived Filter Options
  const uniqueStrategiesInTrades = Array.from(
    new Set(trades.map((t) => t.strategy).filter(Boolean))
  );
  const availableStrategies = Array.from(
    new Set([...PRESET_STRATEGIES, ...uniqueStrategiesInTrades])
  );
  const availableSymbols = Array.from(
    new Set(trades.map((t) => t.symbol).filter(Boolean))
  );

  // Calculated Aggregations for the 5 Charts
  const metrics = calculateDashboardMetrics(filteredTrades, startingCapital);
  const equityPoints = calculateEquityCurve(filteredTrades, startingCapital);
  const dailyPnLData = aggregateDailyPnL(filteredTrades);
  const strategyPnLData = aggregateStrategyPnL(filteredTrades);
  const winLossData = aggregateWinLossDistribution(filteredTrades);
  const rDistributionData = aggregateRMultipleDistribution(filteredTrades);

  const hasTrades = trades.length > 0;
  const hasFilteredTrades = filteredTrades.length > 0;

  return (
    <div className="space-y-8">
      {/* Top Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5 rounded-2xl bg-gradient-to-r from-slate-900/95 via-slate-900/70 to-cyan-950/40 border border-slate-800/80 shadow-xl">
        <div className="space-y-1">
          <div className="flex items-center gap-2.5">
            <BarChart3 className="w-5 h-5 text-cyan-400" />
            <h2 className="text-xl font-bold text-slate-100 tracking-tight">
              Advanced Performance Analytics
            </h2>
            <span
              className={`text-[11px] px-2.5 py-0.5 rounded-full font-mono border font-medium ${
                hasTrades
                  ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                  : "bg-cyan-500/10 text-cyan-400 border-cyan-500/20"
              }`}
            >
              {hasTrades
                ? `${filteredTrades.length} Filtered / ${trades.length} Total Trades`
                : "Clean Empty State"}
            </span>
          </div>
          <p className="text-xs text-slate-400 font-mono">
            Interactive multi-chart performance engine powered strictly by <code className="text-cyan-400">localStorage</code> trades.
          </p>
        </div>

        <div className="flex items-center gap-2 font-mono">
          <button
            onClick={hasTrades ? clearTrades : loadSampleTrades}
            className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs border border-slate-700 transition-colors shadow-sm"
          >
            {hasTrades ? (
              <>
                <FolderOpen className="w-3.5 h-3.5 text-cyan-400" />
                <span>Show Empty State</span>
              </>
            ) : (
              <>
                <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
                <span>Preview Sample Trades</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* FILTER BAR SECTION */}
      <section>
        <AnalyticsFilterBar
          filters={filters}
          onChange={setFilters}
          onReset={() => setFilters(DEFAULT_ANALYTICS_FILTERS)}
          availableStrategies={availableStrategies}
          availableSymbols={availableSymbols}
          filteredCount={filteredTrades.length}
          totalCount={trades.length}
        />
      </section>

      {/* FILTERED QUICK METRICS SUMMARY */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 font-mono">
        <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800/80 space-y-1">
          <span className="text-[10px] text-slate-400 uppercase font-bold block">
            Filtered Trades
          </span>
          <div className="text-xl font-bold text-slate-100 flex items-center gap-2">
            <Hash className="w-4 h-4 text-cyan-400" />
            <span>{metrics.totalTrades}</span>
          </div>
        </div>

        <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800/80 space-y-1">
          <span className="text-[10px] text-slate-400 uppercase font-bold block">
            Filtered Net P/L
          </span>
          <div
            className={`text-xl font-bold flex items-center gap-2 ${
              metrics.netPnL >= 0 ? "text-emerald-400" : "text-rose-400"
            }`}
          >
            <DollarSign className="w-4 h-4" />
            <span>{formatCurrency(metrics.netPnL, true)}</span>
          </div>
        </div>

        <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800/80 space-y-1">
          <span className="text-[10px] text-slate-400 uppercase font-bold block">
            Filtered Win Rate
          </span>
          <div
            className={`text-xl font-bold flex items-center gap-2 ${
              metrics.winRate >= 50 ? "text-emerald-400" : "text-amber-400"
            }`}
          >
            <Award className="w-4 h-4" />
            <span>{formatPercent(metrics.winRate)}</span>
          </div>
        </div>

        <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800/80 space-y-1">
          <span className="text-[10px] text-slate-400 uppercase font-bold block">
            Filtered Average R
          </span>
          <div className="text-xl font-bold text-indigo-300 flex items-center gap-2">
            <Layers className="w-4 h-4" />
            <span>
              {metrics.averageR > 0
                ? `+${metrics.averageR.toFixed(2)}R`
                : `${metrics.averageR.toFixed(2)}R`}
            </span>
          </div>
        </div>
      </section>

      {/* CHART 1: EQUITY CURVE (FULL WIDTH) */}
      <section>
        <EquityCurveAnalyticsChart points={equityPoints} />
      </section>

      {/* CHARTS 2 & 3: DAILY PNL & STRATEGY PNL (2 COLUMNS) */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <DailyPnLChart data={dailyPnLData} />
        <StrategyPnLChart data={strategyPnLData} />
      </section>

      {/* CHARTS 4 & 5: WIN/LOSS PIE & R-DISTRIBUTION (2 COLUMNS) */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <WinLossPieChart data={winLossData} />
        <RDistributionChart data={rDistributionData} />
      </section>
    </div>
  );
}
