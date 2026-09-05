"use client";

import React from "react";
import { StrategyMetrics } from "../../types/trade";
import { formatCurrency, formatPercent, formatRatio, formatStrategyName } from "../../lib/calculations";
import { Zap, Trophy, TrendingUp, TrendingDown, Layers } from "lucide-react";

interface StrategyComparisonTableProps {
  strategies: StrategyMetrics[];
}

export default function StrategyComparisonTable({
  strategies,
}: StrategyComparisonTableProps) {
  const filteredStrategies = strategies.filter((s) => s.strategy !== "ORDER_BLOCK");
  const hasData = filteredStrategies.some((s) => s.totalTrades > 0);

  return (
    <div className="p-5 rounded-2xl bg-slate-900/70 border border-slate-800/80 space-y-4 shadow-xl">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800/80 pb-3">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-lg bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
            <Zap className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-100 tracking-tight font-sans">
              Strategy Comparison Table
            </h3>
            <p className="text-[11px] text-slate-400 font-mono">
              10 performance metrics calculated per strategy
            </p>
          </div>
        </div>

        <span className="text-xs text-slate-500 font-mono">
          {filteredStrategies.length} strategies evaluated
        </span>
      </div>

      {/* Responsive Table */}
      <div className="overflow-x-auto rounded-xl bg-slate-950/80 border border-slate-800/60">
        <table className="w-full text-left font-mono text-xs">
          <thead className="bg-slate-900/90 text-slate-400 uppercase tracking-wider text-[11px] border-b border-slate-800/80">
            <tr>
              <th className="p-3.5">Rank & Strategy</th>
              <th className="p-3.5 text-center">Trades (W/L)</th>
              <th className="p-3.5 text-right">Win Rate</th>
              <th className="p-3.5 text-right">Gross Profit</th>
              <th className="p-3.5 text-right">Gross Loss</th>
              <th className="p-3.5 text-right">Net P/L</th>
              <th className="p-3.5 text-right">PF</th>
              <th className="p-3.5 text-right">Avg R</th>
              <th className="p-3.5 text-right">Max DD</th>
            </tr>
          </thead>

          <tbody className="divide-y divide-slate-800/40 text-slate-200">
            {hasData ? (
              filteredStrategies.map((row, idx) => {
                const isTop = idx === 0 && row.totalTrades > 0;
                const isWin = row.netPnL > 0;
                const isLoss = row.netPnL < 0;

                return (
                  <tr
                    key={row.strategy}
                    className="hover:bg-slate-800/30 transition-colors group"
                  >
                    {/* Rank & Strategy */}
                    <td className="p-3.5">
                      <div className="flex items-center gap-2">
                        <span className="text-slate-500 font-bold text-[11px] min-w-[20px]">
                          #{idx + 1}
                        </span>
                        <span className="font-bold text-slate-100 group-hover:text-cyan-400 transition-colors">
                          {formatStrategyName(row.strategy)}
                        </span>
                        {isTop && (
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-500/10 text-amber-400 border border-amber-500/20 flex items-center gap-1">
                            <Trophy className="w-3 h-3" /> Top Edge
                          </span>
                        )}
                      </div>
                    </td>

                    {/* Trades Count */}
                    <td className="p-3.5 text-center">
                      <span className="font-bold text-slate-200">{row.totalTrades}</span>{" "}
                      <span className="text-[10px] text-slate-500">
                        ({row.winningTrades}W / {row.losingTrades}L)
                      </span>
                    </td>

                    {/* Win Rate */}
                    <td className="p-3.5 text-right">
                      <span
                        className={`font-semibold ${
                          row.winRate >= 50 ? "text-emerald-400" : "text-rose-400"
                        }`}
                      >
                        {formatPercent(row.winRate)}
                      </span>
                    </td>

                    {/* Gross Profit */}
                    <td className="p-3.5 text-right text-emerald-400 font-medium">
                      {formatCurrency(row.grossProfit)}
                    </td>

                    {/* Gross Loss */}
                    <td className="p-3.5 text-right text-rose-400 font-medium">
                      {row.grossLoss > 0 ? `-${formatCurrency(row.grossLoss)}` : "$0.00"}
                    </td>

                    {/* Net P/L */}
                    <td
                      className={`p-3.5 text-right font-bold ${
                        isWin
                          ? "text-emerald-400"
                          : isLoss
                          ? "text-rose-400"
                          : "text-slate-300"
                      }`}
                    >
                      {formatCurrency(row.netPnL, true)}
                    </td>

                    {/* Profit Factor */}
                    <td className="p-3.5 text-right font-semibold text-cyan-300">
                      {formatRatio(row.profitFactor, row.hasLosses && row.totalTrades > 0)}
                    </td>

                    {/* Average R */}
                    <td className="p-3.5 text-right font-semibold text-indigo-300">
                      {row.averageR > 0 ? `+${row.averageR.toFixed(2)}R` : `${row.averageR.toFixed(2)}R`}
                    </td>

                    {/* Max Drawdown */}
                    <td className="p-3.5 text-right font-semibold text-rose-400">
                      {row.maxDrawdown > 0
                        ? `-${formatCurrency(row.maxDrawdown)}`
                        : "$0.00"}
                    </td>
                  </tr>
                );
              })
            ) : (
              <tr>
                <td
                  colSpan={9}
                  className="p-8 text-center text-slate-500 font-mono text-xs"
                >
                  <p className="font-semibold text-slate-400">No trades recorded yet.</p>
                  <p className="text-[11px] text-slate-600">
                    Strategy comparison metrics will populate dynamically when trades are logged.
                  </p>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
