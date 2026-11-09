"use client";

import React from "react";
import { TrendingUp, Target, Award, Percent, Zap, BarChart3, Activity } from "lucide-react";
import { calculateExpectancyMetrics, ExpectancyMetrics } from "../../lib/indian/riskEngine";

interface IMWinRateExpectancyAnalyticsProps {
  historyTrades: Array<{
    tradeId: string;
    symbol: string;
    pnlAmount: number;
    pnlPercent: number;
    status: string;
    executionTime?: string;
  }>;
}

export default function IMWinRateExpectancyAnalytics({
  historyTrades,
}: IMWinRateExpectancyAnalyticsProps) {
  const metrics: ExpectancyMetrics = calculateExpectancyMetrics(historyTrades);

  return (
    <div className="rounded-2xl border border-slate-800 bg-[#0a0f1d] p-5 shadow-2xl backdrop-blur-md">
      <div className="flex items-center justify-between pb-4 border-b border-slate-800/80">
        <div className="flex items-center space-x-3">
          <div className="p-2 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400">
            <TrendingUp className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
              Mathematical Expectancy & Win-Rate Engine
              <span className="text-[10px] px-2 py-0.5 rounded-full font-mono font-medium bg-emerald-950/60 text-emerald-300 border border-emerald-500/30">
                Kelly Criterion $EV$
              </span>
            </h3>
            <p className="text-xs text-slate-400">
              Quantitative statistical edge based on closed portfolio trades
            </p>
          </div>
        </div>
        <div className="text-right">
          <div className="text-xs text-slate-400">Total Closed Sample</div>
          <div className="text-base font-bold font-mono text-slate-100">
            {metrics.totalTrades} Trades
          </div>
        </div>
      </div>

      {metrics.totalTrades === 0 ? (
        <div className="py-8 text-center text-xs text-slate-500 font-mono">
          No closed trades in history yet. As positions hit Target or Trailing Stop-Loss, institutional expectancy will compute automatically.
        </div>
      ) : (
        <div className="space-y-5 my-4">
          {/* Primary Edge Metrics */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="p-3 rounded-xl bg-slate-900/70 border border-slate-800">
              <div className="text-[11px] font-medium text-slate-400 flex items-center justify-between">
                <span>Expected Value (EV/Trade)</span>
                <Zap className="w-3.5 h-3.5 text-emerald-400" />
              </div>
              <div
                className={`text-lg font-bold font-mono mt-1 ${
                  metrics.expectancyPerTradeRupees >= 0 ? "text-emerald-400" : "text-rose-400"
                }`}
              >
                {metrics.expectancyPerTradeRupees >= 0 ? "+" : ""}₹
                {metrics.expectancyPerTradeRupees.toLocaleString("en-IN")}
              </div>
              <div className="text-[10px] text-slate-400 mt-0.5">
                {metrics.expectancyPercent >= 0 ? "+" : ""}
                {metrics.expectancyPercent}% net edge per trade
              </div>
            </div>

            <div className="p-3 rounded-xl bg-slate-900/70 border border-slate-800">
              <div className="text-[11px] font-medium text-slate-400 flex items-center justify-between">
                <span>Profit Factor</span>
                <BarChart3 className="w-3.5 h-3.5 text-cyan-400" />
              </div>
              <div className="text-lg font-bold font-mono text-cyan-300 mt-1">
                {metrics.profitFactor}x
              </div>
              <div className="text-[10px] text-slate-400 mt-0.5">
                Gross Gains vs Gross Losses
              </div>
            </div>

            <div className="p-3 rounded-xl bg-slate-900/70 border border-slate-800">
              <div className="text-[11px] font-medium text-slate-400 flex items-center justify-between">
                <span>Win Rate</span>
                <Award className="w-3.5 h-3.5 text-amber-400" />
              </div>
              <div className="text-lg font-bold font-mono text-amber-300 mt-1">
                {metrics.winRatePercent}%
              </div>
              <div className="text-[10px] text-slate-400 mt-0.5">
                {metrics.winningTrades}W / {metrics.losingTrades}L
              </div>
            </div>

            <div className="p-3 rounded-xl bg-slate-900/70 border border-slate-800">
              <div className="text-[11px] font-medium text-slate-400 flex items-center justify-between">
                <span>Kelly Optimal Sizing</span>
                <Percent className="w-3.5 h-3.5 text-purple-400" />
              </div>
              <div className="text-lg font-bold font-mono text-purple-300 mt-1">
                {metrics.halfKellyPercent}%
              </div>
              <div className="text-[10px] text-slate-400 mt-0.5">
                Half-Kelly allocation (Full: {metrics.kellyFractionPercent}%)
              </div>
            </div>
          </div>

          {/* Secondary Statistical Distributions */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-3 border-t border-slate-800/80">
            <div className="space-y-0.5">
              <div className="text-[11px] text-slate-400">Avg Winner vs Loser</div>
              <div className="text-xs font-mono font-semibold text-slate-200">
                <span className="text-emerald-400">+₹{metrics.avgWinAmount.toLocaleString("en-IN")}</span> /{" "}
                <span className="text-rose-400">-₹{metrics.avgLossAmount.toLocaleString("en-IN")}</span>
              </div>
              <div className="text-[10px] text-slate-500 font-mono">W/L: {metrics.winLossRatio}:1</div>
            </div>

            <div className="space-y-0.5">
              <div className="text-[11px] text-slate-400">Total Closed P&L</div>
              <div
                className={`text-xs font-mono font-semibold ${
                  metrics.totalPnL >= 0 ? "text-emerald-400" : "text-rose-400"
                }`}
              >
                {metrics.totalPnL >= 0 ? "+" : ""}₹{metrics.totalPnL.toLocaleString("en-IN")}
              </div>
              <div className="text-[10px] text-slate-500 font-mono">Across {metrics.totalTrades} settled fills</div>
            </div>

            <div className="space-y-0.5">
              <div className="text-[11px] text-slate-400">Streak Records</div>
              <div className="text-xs font-mono font-semibold text-slate-200">
                <span className="text-emerald-400">{metrics.maxConsecutiveWins}W max</span> •{" "}
                <span className="text-rose-400">{metrics.maxConsecutiveLosses}L max</span>
              </div>
              <div className="text-[10px] text-slate-500 font-mono">Consecutive distribution</div>
            </div>

            <div className="space-y-0.5">
              <div className="text-[11px] text-slate-400">Best vs Worst Fill</div>
              <div className="text-xs font-mono font-semibold text-slate-200">
                <span className="text-emerald-400">+₹{metrics.largestWin.toLocaleString("en-IN")}</span> /{" "}
                <span className="text-rose-400">₹{metrics.largestLoss.toLocaleString("en-IN")}</span>
              </div>
              <div className="text-[10px] text-slate-500 font-mono">Outlier boundary</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

