"use client";

import React, { useState } from "react";
import { useTrades } from "../../context/TradeContext";
import {
  calculateMonthlyReviewMetrics,
  MonthlyReviewMetrics,
} from "../../lib/monthlyCalculations";
import {
  formatCurrency,
  formatPercent,
  formatRatio,
  DEFAULT_STARTING_CAPITAL,
} from "../../lib/calculations";
import KPICard from "../dashboard/KPICard";
import TradingMistakeAnalysisCard from "../monthly/TradingMistakeAnalysisCard";
import {
  PieChart,
  Calendar,
  ChevronLeft,
  ChevronRight,
  Trophy,
  AlertTriangle,
  Award,
  Flame,
  TrendingUp,
  TrendingDown,
  Sparkles,
  FolderOpen,
  DollarSign,
  Wallet,
  Percent,
  Hash,
  CheckCircle2,
  XCircle,
  Activity,
  Layers,
  Skull,
} from "lucide-react";

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export default function MonthlyReviewView() {
  const { trades, loadSampleTrades, clearTrades } = useTrades();

  // Selected Month & Year State
  const [currentDate, setCurrentDate] = useState<Date>(new Date(2026, 8, 1)); // September 2026

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  const handlePrevMonth = () => {
    setCurrentDate(new Date(year, month - 1, 1));
  };

  const handleNextMonth = () => {
    setCurrentDate(new Date(year, month + 1, 1));
  };

  // Dynamic calculations from localStorage trades for selected month
  const metrics: MonthlyReviewMetrics = calculateMonthlyReviewMetrics(
    trades,
    year,
    month,
    DEFAULT_STARTING_CAPITAL
  );

  const hasTrades = trades.length > 0;
  const hasMonthTrades = metrics.totalTrades > 0;

  return (
    <div className="space-y-8">
      {/* Top Banner Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5 rounded-2xl bg-gradient-to-r from-slate-900/95 via-slate-900/70 to-cyan-950/40 border border-slate-800/80 shadow-xl">
        <div className="space-y-1">
          <div className="flex items-center gap-2.5">
            <PieChart className="w-5 h-5 text-cyan-400" />
            <h2 className="text-xl font-bold text-slate-100 tracking-tight">
              Monthly Audit & Performance Review
            </h2>
            <span
              className={`text-[11px] px-2.5 py-0.5 rounded-full font-mono border font-medium ${
                hasMonthTrades
                  ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                  : "bg-cyan-500/10 text-cyan-400 border-cyan-500/20"
              }`}
            >
              {hasMonthTrades
                ? `${metrics.totalTrades} Trades in ${MONTH_NAMES[month]}`
                : "Clean Empty State"}
            </span>
          </div>
          <p className="text-xs text-slate-400 font-mono">
            Audit monthly execution, streaks, best/worst trades, and setup edge from <code className="text-cyan-400">localStorage</code>.
          </p>
        </div>

        {/* Month Selector Controls */}
        <div className="flex items-center gap-2 font-mono">
          <button
            onClick={hasTrades ? clearTrades : loadSampleTrades}
            className="flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs border border-slate-700 transition-colors shadow-sm mr-2"
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

      {/* MONTH & YEAR PICKER HEADER */}
      <section className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-xl bg-slate-900/70 border border-slate-800/80 font-mono text-xs shadow-xl">
        <div className="flex items-center gap-2">
          <Calendar className="w-4 h-4 text-cyan-400" />
          <span className="text-slate-400">Review Period:</span>
          <span className="font-bold text-slate-100 text-sm">
            {MONTH_NAMES[month]} {year}
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            onClick={handlePrevMonth}
            className="p-1.5 px-3 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 flex items-center gap-1 transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
            <span>Prev Month</span>
          </button>

          <button
            onClick={() => setCurrentDate(new Date(2026, 8, 1))}
            className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-cyan-400 border border-slate-700 transition-colors"
          >
            Sept 2026
          </button>

          <button
            onClick={handleNextMonth}
            className="p-1.5 px-3 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 flex items-center gap-1 transition-colors"
          >
            <span>Next Month</span>
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </section>

      {/* SECTION 1: 13 CORE MONTHLY KPI CARDS GRID */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider font-mono flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-cyan-400" />
            13 Core Monthly KPIs ({MONTH_NAMES[month]} {year})
          </h3>
          <span className="text-[11px] text-slate-500 font-mono">
            {hasMonthTrades ? `${metrics.totalTrades} Trades Calculated` : "0 Trades (Baseline)"}
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* 1. Starting Capital */}
          <KPICard
            title="1. Starting Capital"
            value={formatCurrency(metrics.startingCapital)}
            subtext={`Balance prior to ${MONTH_NAMES[month]}`}
            icon={Wallet}
            accentColor="slate"
          />

          {/* 2. Ending Capital */}
          <KPICard
            title="2. Ending Capital"
            value={formatCurrency(metrics.endingCapital)}
            subtext={`Starting + ${MONTH_NAMES[month]} P/L`}
            trend={metrics.netPnL > 0 ? "positive" : metrics.netPnL < 0 ? "negative" : "neutral"}
            icon={DollarSign}
            accentColor={metrics.netPnL >= 0 ? "cyan" : "rose"}
          />

          {/* 3. Net P/L */}
          <KPICard
            title="3. Monthly Net P/L"
            value={formatCurrency(metrics.netPnL, true)}
            subtext={`${MONTH_NAMES[month]} Gross Profit + Loss`}
            trend={metrics.netPnL > 0 ? "positive" : metrics.netPnL < 0 ? "negative" : "neutral"}
            icon={TrendingUp}
            accentColor={metrics.netPnL >= 0 ? "emerald" : "rose"}
          />

          {/* 4. Return % */}
          <KPICard
            title="4. Monthly Return %"
            value={formatPercent(metrics.returnPercentage, true)}
            subtext={`On ${MONTH_NAMES[month]} Starting Equity`}
            trend={metrics.returnPercentage > 0 ? "positive" : metrics.returnPercentage < 0 ? "negative" : "neutral"}
            icon={Percent}
            accentColor={metrics.returnPercentage >= 0 ? "emerald" : "rose"}
          />

          {/* 5. Total Trades */}
          <KPICard
            title="5. Monthly Trades"
            value={metrics.totalTrades.toString()}
            subtext={`Closed in ${MONTH_NAMES[month]}`}
            icon={Hash}
            accentColor="indigo"
          />

          {/* 6. Winning Trades */}
          <KPICard
            title="6. Winning Trades"
            value={metrics.winningTrades.toString()}
            subtext={hasMonthTrades ? `${formatPercent((metrics.winningTrades / (metrics.totalTrades || 1)) * 100)} of month` : "0% of month"}
            trend="positive"
            icon={CheckCircle2}
            accentColor="emerald"
          />

          {/* 7. Losing Trades */}
          <KPICard
            title="7. Losing Trades"
            value={metrics.losingTrades.toString()}
            subtext={hasMonthTrades ? `${formatPercent((metrics.losingTrades / (metrics.totalTrades || 1)) * 100)} of month` : "0% of month"}
            trend={metrics.losingTrades > 0 ? "negative" : "neutral"}
            icon={XCircle}
            accentColor="rose"
          />

          {/* 8. Win Rate */}
          <KPICard
            title="8. Monthly Win Rate"
            value={formatPercent(metrics.winRate)}
            subtext={metrics.winRate >= 50 ? "Positive Monthly Edge" : "Below 50% target"}
            trend={metrics.winRate >= 50 ? "positive" : "negative"}
            icon={Award}
            accentColor={metrics.winRate >= 50 ? "emerald" : "amber"}
          />

          {/* 9. Profit Factor */}
          <KPICard
            title="9. Profit Factor"
            value={formatRatio(metrics.profitFactor, metrics.hasLosses && hasMonthTrades)}
            subtext="Monthly Gross Profit / Gross Loss"
            trend={metrics.profitFactor >= 2 ? "positive" : metrics.profitFactor >= 1 ? "neutral" : "negative"}
            icon={Activity}
            accentColor={metrics.profitFactor >= 2 ? "emerald" : "cyan"}
          />

          {/* 10. Average R */}
          <KPICard
            title="10. Average R"
            value={metrics.averageR > 0 ? `+${metrics.averageR.toFixed(2)}R` : `${metrics.averageR.toFixed(2)}R`}
            subtext="Monthly Avg R-Multiple / trade"
            trend={metrics.averageR > 0 ? "positive" : "negative"}
            icon={Layers}
            accentColor="indigo"
          />

          {/* 11. Max Drawdown */}
          <KPICard
            title="11. Max Drawdown"
            value={formatCurrency(metrics.maxDrawdown)}
            subtext={metrics.maxDrawdownPercent > 0 ? `-${formatPercent(metrics.maxDrawdownPercent)} peak-to-trough` : "No drawdown"}
            trend={metrics.maxDrawdown > 0 ? "negative" : "neutral"}
            icon={TrendingDown}
            accentColor="rose"
          />

          {/* 12. Best Strategy */}
          <KPICard
            title="12. Best Strategy"
            value={metrics.bestStrategy}
            subtext="Top Net PnL Model"
            icon={Trophy}
            accentColor="amber"
          />

          {/* 13. Worst Strategy */}
          <KPICard
            title="13. Worst Strategy"
            value={metrics.worstStrategy}
            subtext="Lowest Net PnL Model"
            icon={Skull}
            accentColor="rose"
          />
        </div>
      </section>

      {/* SECTION 2: AUDIT BREAKDOWN (BEST/WORST TRADES & DAYS) */}
      <section className="space-y-4 font-mono">
        <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider font-mono flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-cyan-400" />
          Execution Audit: Best/Worst Trades & Days ({MONTH_NAMES[month]} {year})
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Best Trade Card */}
          <div className="p-4 rounded-xl bg-slate-900/70 border border-emerald-500/30 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold text-emerald-400 uppercase tracking-wider flex items-center gap-1">
                <Trophy className="w-3.5 h-3.5 text-amber-400" />
                Best Trade
              </span>
              <span className="text-[10px] text-slate-500">{metrics.bestTrade?.date || "N/A"}</span>
            </div>

            {metrics.bestTrade ? (
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-100 text-sm">{metrics.bestTrade.symbol}</span>
                  <span className="text-emerald-400 font-bold text-sm">
                    {formatCurrency(metrics.bestTrade.pnl, true)}
                  </span>
                </div>
                <div className="flex items-center justify-between text-[11px] text-slate-400">
                  <span>{metrics.bestTrade.side} ({metrics.bestTrade.strategy})</span>
                  <span className="text-cyan-400 font-bold">
                    +{metrics.bestTrade.rMultiple.toFixed(2)}R
                  </span>
                </div>
              </div>
            ) : (
              <p className="text-xs text-slate-500 py-2">No trade recorded</p>
            )}
          </div>

          {/* Worst Trade Card */}
          <div className="p-4 rounded-xl bg-slate-900/70 border border-rose-500/30 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold text-rose-400 uppercase tracking-wider flex items-center gap-1">
                <AlertTriangle className="w-3.5 h-3.5 text-rose-400" />
                Worst Trade
              </span>
              <span className="text-[10px] text-slate-500">{metrics.worstTrade?.date || "N/A"}</span>
            </div>

            {metrics.worstTrade ? (
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-100 text-sm">{metrics.worstTrade.symbol}</span>
                  <span className="text-rose-400 font-bold text-sm">
                    {formatCurrency(metrics.worstTrade.pnl, true)}
                  </span>
                </div>
                <div className="flex items-center justify-between text-[11px] text-slate-400">
                  <span>{metrics.worstTrade.side} ({metrics.worstTrade.strategy})</span>
                  <span className="text-amber-400 font-bold">
                    {metrics.worstTrade.mistakeTag || "No Mistake"}
                  </span>
                </div>
              </div>
            ) : (
              <p className="text-xs text-slate-500 py-2">No trade recorded</p>
            )}
          </div>

          {/* Best Trading Day Card */}
          <div className="p-4 rounded-xl bg-slate-900/70 border border-emerald-500/30 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold text-emerald-400 uppercase tracking-wider flex items-center gap-1">
                <Calendar className="w-3.5 h-3.5 text-emerald-400" />
                Best Trading Day
              </span>
              <span className="text-[10px] text-slate-500">
                {metrics.bestTradingDay?.count || 0} Trades
              </span>
            </div>

            {metrics.bestTradingDay ? (
              <div className="space-y-1">
                <div className="text-sm font-bold text-slate-100">{metrics.bestTradingDay.date}</div>
                <div className="text-emerald-400 font-bold text-sm">
                  {formatCurrency(metrics.bestTradingDay.pnl, true)}
                </div>
              </div>
            ) : (
              <p className="text-xs text-slate-500 py-2">No day recorded</p>
            )}
          </div>

          {/* Worst Trading Day Card */}
          <div className="p-4 rounded-xl bg-slate-900/70 border border-rose-500/30 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold text-rose-400 uppercase tracking-wider flex items-center gap-1">
                <Calendar className="w-3.5 h-3.5 text-rose-400" />
                Worst Trading Day
              </span>
              <span className="text-[10px] text-slate-500">
                {metrics.worstTradingDay?.count || 0} Trades
              </span>
            </div>

            {metrics.worstTradingDay ? (
              <div className="space-y-1">
                <div className="text-sm font-bold text-slate-100">{metrics.worstTradingDay.date}</div>
                <div className="text-rose-400 font-bold text-sm">
                  {formatCurrency(metrics.worstTradingDay.pnl, true)}
                </div>
              </div>
            ) : (
              <p className="text-xs text-slate-500 py-2">No day recorded</p>
            )}
          </div>
        </div>
      </section>

      {/* SECTION 3: STREAKS & DISCIPLINE AUDIT */}
      <section className="p-5 rounded-2xl bg-slate-900/70 border border-slate-800/80 space-y-4 font-mono text-xs shadow-xl">
        <h3 className="text-xs font-bold text-slate-200 uppercase tracking-wider flex items-center gap-2">
          <Flame className="w-4 h-4 text-amber-400" />
          Streaks & Discipline Analysis
        </h3>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="p-4 rounded-xl bg-slate-950/80 border border-slate-800/80 flex items-center justify-between">
            <div className="space-y-0.5">
              <span className="text-slate-400 block text-[11px]">Longest Winning Streak</span>
              <span className="text-slate-500 text-[10px]">Consecutive profitable trades</span>
            </div>
            <span className="text-2xl font-bold text-emerald-400 font-mono">
              {metrics.longestWinningStreak} <span className="text-xs text-slate-500">wins</span>
            </span>
          </div>

          <div className="p-4 rounded-xl bg-slate-950/80 border border-slate-800/80 flex items-center justify-between">
            <div className="space-y-0.5">
              <span className="text-slate-400 block text-[11px]">Longest Losing Streak</span>
              <span className="text-slate-500 text-[10px]">Consecutive loss trades</span>
            </div>
            <span className="text-2xl font-bold text-rose-400 font-mono">
              {metrics.longestLosingStreak} <span className="text-xs text-slate-500">losses</span>
            </span>
          </div>
        </div>
      </section>

      {/* SECTION 4: TRADING MISTAKE ANALYSIS */}
      <section>
        <TradingMistakeAnalysisCard
          data={metrics.mistakeAnalysis}
          monthName={`${MONTH_NAMES[month]} ${year}`}
        />
      </section>
    </div>
  );
}
