import React from "react";
import { StrategyMetrics } from "../../types/trade";
import {
  formatCurrency,
  formatPercent,
  formatRatio,
  getMostProfitableStrategy,
  getBestRiskAdjustedStrategy,
} from "../../lib/calculations";
import { Trophy, Award, Zap, TrendingUp, ShieldCheck, Info, DollarSign, Scale, AlertTriangle } from "lucide-react";

interface StrategyRankingCardProps {
  strategies: StrategyMetrics[];
}

export default function StrategyRankingCard({
  strategies,
}: StrategyRankingCardProps) {
  const activeStrategies = strategies.filter((s) => s.totalTrades > 0);
  const hasActive = activeStrategies.length > 0;

  const mostProfitable = getMostProfitableStrategy(strategies);
  const bestRiskAdjusted = getBestRiskAdjustedStrategy(strategies);

  return (
    <div className="p-6 rounded-2xl bg-slate-900/70 border border-slate-800/80 space-y-6 shadow-xl">
      {/* Header & Methodology Note */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800/80 pb-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-amber-500/10 text-amber-400 border border-amber-500/20">
            <Trophy className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-base font-bold text-slate-100 tracking-tight font-sans">
              Live Strategy Profit Leaderboard
            </h3>
            <p className="text-xs text-slate-400 font-mono">
              Evaluates raw P/L alongside risk-adjusted setup edge
            </p>
          </div>
        </div>

        {/* Methodology Explanation Banner */}
        <div className="px-3.5 py-2 rounded-xl bg-slate-950/80 border border-slate-800 text-[11px] font-mono text-slate-400 max-w-md flex items-start gap-2">
          <Info className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />
          <span>
            <strong>Ranking Engine:</strong> Combines Net PnL (35%), Profit Factor (25%), Win Rate (20%), and Avg R (20%) with drawdown penalties.
          </span>
        </div>
      </div>

      {/* Side-by-Side Edge Distinction Cards: Most Profitable vs Best Risk-Adjusted */}
      {hasActive && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Most Profitable Strategy Card */}
          {mostProfitable && (
            <div className="p-4.5 rounded-xl bg-gradient-to-r from-emerald-950/40 to-slate-900/80 border border-emerald-500/30 space-y-2 font-mono">
              <div className="flex items-center justify-between">
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 flex items-center gap-1">
                  <DollarSign className="w-3 h-3" />
                  Most Profitable Strategy
                </span>
                <span className="text-[10px] text-slate-400">
                  {mostProfitable.totalTrades} Trades
                </span>
              </div>
              <div className="flex items-baseline justify-between pt-1">
                <h4 className="text-base font-bold text-slate-100 font-sans tracking-tight">
                  {mostProfitable.strategy}
                </h4>
                <span className="text-lg font-bold text-emerald-400">
                  {formatCurrency(mostProfitable.netPnL, true)}
                </span>
              </div>
              <div className="flex items-center justify-between text-[11px] text-slate-400 border-t border-emerald-900/40 pt-2">
                <span>Win Rate: <strong className="text-slate-200">{formatPercent(mostProfitable.winRate)}</strong></span>
                <span>Avg R: <strong className="text-slate-200">+{mostProfitable.averageR.toFixed(2)}R</strong></span>
              </div>
            </div>
          )}

          {/* Best Risk-Adjusted Strategy Card */}
          {bestRiskAdjusted && (
            <div className="p-4.5 rounded-xl bg-gradient-to-r from-cyan-950/40 to-slate-900/80 border border-cyan-500/30 space-y-2 font-mono">
              <div className="flex items-center justify-between">
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-cyan-500/15 text-cyan-400 border border-cyan-500/30 flex items-center gap-1">
                  <Scale className="w-3 h-3" />
                  Best Risk-Adjusted Strategy
                </span>
                <span className="text-[10px] text-slate-400">
                  Rank #{bestRiskAdjusted.rank}
                </span>
              </div>
              <div className="flex items-baseline justify-between pt-1">
                <h4 className="text-base font-bold text-slate-100 font-sans tracking-tight">
                  {bestRiskAdjusted.strategy}
                </h4>
                <span className="text-lg font-bold text-cyan-300">
                  {formatRatio(bestRiskAdjusted.profitFactor, bestRiskAdjusted.hasLosses)} PF
                </span>
              </div>
              <div className="flex items-center justify-between text-[11px] text-slate-400 border-t border-cyan-900/40 pt-2">
                <span>Drawdown: <strong className="text-rose-400">{formatCurrency(bestRiskAdjusted.maxDrawdown)}</strong></span>
                <span>Avg R: <strong className="text-slate-200">+{bestRiskAdjusted.averageR.toFixed(2)}R</strong></span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Leaderboard Cards */}
      {hasActive ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {activeStrategies.slice(0, 3).map((strat, idx) => {
            const isTop = idx === 0;
            const rankLabel = idx === 0 ? "#1 Top Edge" : idx === 1 ? "#2 Runner Up" : "#3 Contender";
            const badgeColor =
              idx === 0
                ? "bg-amber-500/10 text-amber-400 border-amber-500/30"
                : idx === 1
                ? "bg-slate-300/10 text-slate-300 border-slate-400/30"
                : "bg-orange-500/10 text-orange-400 border-orange-500/30";

            return (
              <div
                key={strat.strategy}
                className={`
                  p-5 rounded-xl border flex flex-col justify-between gap-4 transition-all relative overflow-hidden
                  ${
                    isTop
                      ? "bg-slate-900/90 border-amber-500/40 shadow-lg shadow-amber-950/30"
                      : "bg-slate-950/60 border-slate-800/80"
                  }
                `}
              >
                {/* Badge Header */}
                <div className="flex items-center justify-between">
                  <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold font-mono border ${badgeColor}`}>
                    {rankLabel}
                  </span>
                  <span className="text-[10px] text-slate-500 font-mono">
                    {strat.totalTrades} {strat.totalTrades === 1 ? "trade" : "trades"}
                  </span>
                </div>

                {/* Strategy Title */}
                <div className="space-y-1">
                  <h4 className="text-base font-bold text-slate-100 tracking-tight truncate">
                    {strat.strategy}
                  </h4>
                  <p className="text-[11px] text-slate-400 font-mono">
                    {strat.rankReason}
                  </p>
                </div>

                {/* Key Metrics Grid */}
                <div className="grid grid-cols-2 gap-2 p-3 rounded-lg bg-slate-950/80 border border-slate-800/60 text-xs font-mono">
                  <div>
                    <span className="text-[10px] text-slate-500 block">NET PNL</span>
                    <span className={`font-bold ${strat.netPnL >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                      {formatCurrency(strat.netPnL, true)}
                    </span>
                  </div>

                  <div>
                    <span className="text-[10px] text-slate-500 block">WIN RATE</span>
                    <span className={`font-bold ${strat.winRate >= 50 ? "text-emerald-400" : "text-rose-400"}`}>
                      {formatPercent(strat.winRate)}
                    </span>
                  </div>

                  <div>
                    <span className="text-[10px] text-slate-500 block">PROFIT FACTOR</span>
                    <span className="font-bold text-cyan-300">
                      {formatRatio(strat.profitFactor, strat.hasLosses)}
                    </span>
                  </div>

                  <div>
                    <span className="text-[10px] text-slate-500 block">AVG R</span>
                    <span className="font-bold text-indigo-300">
                      {strat.averageR > 0 ? `+${strat.averageR.toFixed(2)}R` : `${strat.averageR.toFixed(2)}R`}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* Empty State */
        <div className="p-8 rounded-xl bg-slate-950/60 border border-slate-800/60 text-center font-mono text-xs text-slate-500 space-y-1">
          <Trophy className="w-6 h-6 mx-auto text-slate-600 mb-1" />
          <p className="font-semibold text-slate-400">No active strategy trades recorded yet.</p>
          <p className="text-[11px] text-slate-600">
            Log trades in the Trade Journal to activate real-time strategy edge ranking.
          </p>
        </div>
      )}

      {/* Risk Disclaimer Notice Banner */}
      <div className="p-3 rounded-xl bg-slate-950/80 border border-slate-800/80 text-[11px] font-mono text-slate-400 flex items-center gap-2">
        <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
        <span>
          <strong>Performance Disclaimer:</strong> Historical performance is analyzed for trading edge evaluation and does not guarantee future results or profit.
        </span>
      </div>
    </div>
  );
}
