"use client";

import React, { useState } from "react";
import { useTrades } from "../../context/TradeContext";
import {
  calculateDashboardMetrics,
  calculateEquityCurve,
  calculateStrategyPerformance,
  formatCurrency,
  formatPercent,
  formatRatio,
  formatStrategyName,
  DEFAULT_STARTING_CAPITAL,
} from "../../lib/calculations";
import KPICard from "../dashboard/KPICard";
import EquityCurveChart from "../dashboard/EquityCurveChart";
import StrategyPerformanceTable from "../dashboard/StrategyPerformanceTable";
import EmptyState from "../dashboard/EmptyState";
import AccountPanelCard from "../account/AccountPanelCard";
import {
  DollarSign,
  Wallet,
  TrendingUp,
  Percent,
  Hash,
  CheckCircle2,
  XCircle,
  Award,
  Activity,
  Layers,
  TrendingDown,
  Trophy,
  Sparkles,
  FolderOpen,
  Scale,
} from "lucide-react";

export default function DashboardView() {
  const { trades, startingCapital, loadSampleTrades, clearTrades } = useTrades();

  // Dynamic calculations strictly from localStorage trade entries
  const metrics = calculateDashboardMetrics(trades, startingCapital);
  const equityPoints = calculateEquityCurve(trades, startingCapital);
  const strategyMetrics = calculateStrategyPerformance(trades);

  const hasTrades = trades.length > 0;

  return (
    <div className="space-y-8">
      {/* Step 24: $500 Account Panel Card */}
      <AccountPanelCard />

      {/* Top Banner & Interactive State Switcher */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5 rounded-2xl bg-gradient-to-r from-slate-900/95 via-slate-900/70 to-cyan-950/40 border border-slate-800/80 shadow-xl">
        <div className="space-y-1">
          <div className="flex items-center gap-2.5">
            <h2 className="text-xl font-bold text-slate-100 tracking-tight">
              Dashboard Overview
            </h2>
            <span
              className={`text-[11px] px-2.5 py-0.5 rounded-full font-mono border font-medium ${
                hasTrades
                  ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                  : "bg-cyan-500/10 text-cyan-400 border-cyan-500/20"
              }`}
            >
              {hasTrades
                ? `${metrics.totalTrades} Closed Trades Calculated`
                : "Clean Empty State"}
            </span>
          </div>
          <p className="text-xs text-slate-400 font-mono">
            Calculated dynamically from <code className="text-cyan-400">localStorage</code> trades
          </p>
        </div>

        {/* State Toggle Button for Testing */}
        <div className="flex items-center gap-2">
          <button
            onClick={hasTrades ? clearTrades : loadSampleTrades}
            className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-mono border border-slate-700 transition-colors shadow-sm"
            title="Toggle sample trade data"
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

      {/* Empty State Banner if 0 Trades */}
      {!hasTrades && (
        <EmptyState
          onToggleSampleData={loadSampleTrades}
          isSampleDataActive={hasTrades}
        />
      )}

      {/* Gross Profit & Gross Loss Summary Strip if trades exist */}
      {hasTrades && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-4 rounded-xl bg-slate-900/60 border border-slate-800/80 font-mono text-xs">
          <div className="flex items-center justify-between px-2">
            <span className="text-slate-400 flex items-center gap-1.5">
              <TrendingUp className="w-4 h-4 text-emerald-400" />
              Gross Profit (Sum of positive P/L):
            </span>
            <span className="font-bold text-emerald-400 text-sm">
              {formatCurrency(metrics.grossProfit, true)}
            </span>
          </div>
          <div className="flex items-center justify-between px-2 sm:border-l sm:border-slate-800/80">
            <span className="text-slate-400 flex items-center gap-1.5">
              <TrendingDown className="w-4 h-4 text-rose-400" />
              Gross Loss (Sum of negative P/L):
            </span>
            <span className="font-bold text-rose-400 text-sm">
              -{formatCurrency(metrics.grossLoss)}
            </span>
          </div>
        </div>
      )}

      {/* SECTION 1: 12 KPI CARDS GRID */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider font-mono flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-cyan-400" />
            Key Performance Indicators (12 KPIs)
          </h3>
          <span className="text-[11px] text-slate-500 font-mono">
            {hasTrades ? `${metrics.totalTrades} Trades Calculated` : "0 Trades (Baseline)"}
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* 1. Starting Capital */}
          <KPICard
            title="1. Starting Capital"
            value={formatCurrency(metrics.startingCapital)}
            subtext="Baseline Equity"
            icon={Wallet}
            accentColor="slate"
          />

          {/* 2. Current Capital */}
          <KPICard
            title="2. Current Capital"
            value={formatCurrency(metrics.currentCapital)}
            subtext={`Capital + Net PnL (${formatCurrency(metrics.netPnL, true)})`}
            trend={metrics.netPnL > 0 ? "positive" : metrics.netPnL < 0 ? "negative" : "neutral"}
            icon={DollarSign}
            accentColor={metrics.netPnL >= 0 ? "cyan" : "rose"}
          />

          {/* 3. Net P/L */}
          <KPICard
            title="3. Net P/L"
            value={formatCurrency(metrics.netPnL, true)}
            subtext="Gross Profit + Gross Loss"
            trend={metrics.netPnL > 0 ? "positive" : metrics.netPnL < 0 ? "negative" : "neutral"}
            icon={TrendingUp}
            accentColor={metrics.netPnL >= 0 ? "emerald" : "rose"}
          />

          {/* 4. Return % */}
          <KPICard
            title="4. Return %"
            value={formatPercent(metrics.returnPercentage, true)}
            subtext="Net PnL / Starting Capital"
            trend={metrics.returnPercentage > 0 ? "positive" : metrics.returnPercentage < 0 ? "negative" : "neutral"}
            icon={Percent}
            accentColor={metrics.returnPercentage >= 0 ? "emerald" : "rose"}
          />

          {/* 5. Total Trades */}
          <KPICard
            title="5. Total Trades"
            value={metrics.totalTrades.toString()}
            subtext="Closed Executions"
            icon={Hash}
            accentColor="indigo"
          />

          {/* 6. Winning Trades */}
          <KPICard
            title="6. Winning Trades"
            value={metrics.winningTrades.toString()}
            subtext={hasTrades ? `${formatPercent((metrics.winningTrades / (metrics.totalTrades || 1)) * 100)} of total` : "0% of total"}
            trend="positive"
            icon={CheckCircle2}
            accentColor="emerald"
          />

          {/* 7. Losing Trades */}
          <KPICard
            title="7. Losing Trades"
            value={metrics.losingTrades.toString()}
            subtext={hasTrades ? `${formatPercent((metrics.losingTrades / (metrics.totalTrades || 1)) * 100)} of total` : "0% of total"}
            trend={metrics.losingTrades > 0 ? "negative" : "neutral"}
            icon={XCircle}
            accentColor="rose"
          />

          {/* 8. Win Rate */}
          <KPICard
            title="8. Win Rate"
            value={hasTrades ? formatPercent(metrics.winRate) : "—"}
            subtext="Winning / Total Trades * 100"
            trend={hasTrades ? (metrics.winRate >= 50 ? "positive" : "negative") : "neutral"}
            icon={Award}
            accentColor={metrics.winRate >= 50 ? "emerald" : "amber"}
          />

          {/* 9. Profit Factor */}
          <KPICard
            title="9. Profit Factor"
            value={hasTrades ? formatRatio(metrics.profitFactor, metrics.hasLosses) : "—"}
            subtext="Gross Profit / Gross Loss"
            trend={metrics.profitFactor >= 2 ? "positive" : metrics.profitFactor >= 1 ? "neutral" : "negative"}
            icon={Activity}
            accentColor={metrics.profitFactor >= 2 ? "emerald" : "cyan"}
          />

          {/* 10. Average R */}
          <KPICard
            title="10. Average R"
            value={hasTrades ? (metrics.averageR > 0 ? `+${metrics.averageR.toFixed(2)}R` : `${metrics.averageR.toFixed(2)}R`) : "—"}
            subtext="Sum of R / Total Trades"
            trend={metrics.averageR > 0 ? "positive" : "negative"}
            icon={Layers}
            accentColor="indigo"
          />

          {/* 11. Max Drawdown */}
          <KPICard
            title="11. Max Drawdown"
            value={formatCurrency(metrics.maxDrawdown)}
            subtext={metrics.maxDrawdownPercentage > 0 ? `-${formatPercent(metrics.maxDrawdownPercentage)} peak-to-trough` : "No drawdown recorded"}
            trend={metrics.maxDrawdown > 0 ? "negative" : "neutral"}
            icon={TrendingDown}
            accentColor="rose"
          />

          {/* 12. Best Strategy */}
          <KPICard
            title="12. Best Strategy"
            value={hasTrades && metrics.bestStrategy !== "None" ? formatStrategyName(metrics.bestStrategy) : "—"}
            subtext="Top Net PnL Edge"
            icon={Trophy}
            accentColor="amber"
          />
        </div>
      </section>

      {/* SECTION 2: EQUITY CURVE CHART */}
      <section className="space-y-3">
        <EquityCurveChart
          points={equityPoints}
          startingCapital={startingCapital}
        />
      </section>

      {/* SECTION 3: STRATEGY PERFORMANCE TABLE */}
      <section className="space-y-3">
        <StrategyPerformanceTable strategies={strategyMetrics} />
      </section>
    </div>
  );
}
