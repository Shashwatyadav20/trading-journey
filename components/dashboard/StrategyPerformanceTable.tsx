"use client";

import React from "react";
import { StrategyMetrics } from "../../types/trade";
import { formatCurrency, formatPercent, formatRatio, formatStrategyName } from "../../lib/calculations";
import { Zap, ShieldCheck, Trophy, Layers } from "lucide-react";

interface StrategyPerformanceTableProps {
  strategies: StrategyMetrics[];
}

export default function StrategyPerformanceTable({
  strategies,
}: StrategyPerformanceTableProps) {
  const filteredStrategies = strategies.filter(
    (s) => s.strategy !== "ORDER_BLOCK"
  );
  const hasStrategies = filteredStrategies.length > 0;

  return (
    <div className="p-5 rounded-2xl bg-slate-900/60 border border-slate-800/80 space-y-4 shadow-xl">
      {/* Section Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800/80 pb-3">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-lg bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
            <Zap className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-100 tracking-tight">
              Strategy Performance
            </h3>
            <p className="text-[11px] text-slate-400 font-mono">
              Breakdown of execution edge across setups
            </p>
          </div>
        </div>

        <div className="text-xs text-slate-400 font-mono">
          {hasStrategies ? `${filteredStrategies.length} active strategies` : "0 strategies logged"}
        </div>
      </div>

      {/* Table Container */}
      <div className="overflow-x-auto rounded-xl bg-slate-950/60 border border-slate-800/60">
        <table className="w-full text-left font-mono text-xs">
          <thead className="bg-slate-900/80 text-slate-400 uppercase tracking-wider text-[11px] border-b border-slate-800/80">
            <tr>
              <th className="p-3.5">Strategy</th>
              <th className="p-3.5 text-center">Trades</th>
              <th className="p-3.5 text-right">Win Rate</th>
              <th className="p-3.5 text-right">Net P/L</th>
              <th className="p-3.5 text-right">Profit Factor</th>
              <th className="p-3.5 text-right">Average R</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/40 text-slate-200">
            {hasStrategies ? (
              filteredStrategies.map((row, idx) => {
                const isBest = idx === 0 && row.netPnL > 0;
                return (
                  <tr
                    key={row.strategy}
                    className="hover:bg-slate-800/30 transition-colors group"
                  >
                    <td className="p-3.5">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-slate-100 group-hover:text-cyan-400 transition-colors">
                          {formatStrategyName(row.strategy)}
                        </span>
                        {isBest && (
                          <span className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-bold">
                            <Trophy className="w-3 h-3 text-amber-400" />
                            Best
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="p-3.5 text-center font-bold text-slate-300">
                      {row.totalTrades}
                    </td>
                    <td className="p-3.5 text-right">
                      <span
                        className={`font-semibold ${
                          row.winRate >= 50 ? "text-emerald-400" : "text-rose-400"
                        }`}
                      >
                        {formatPercent(row.winRate)}
                      </span>
                    </td>
                    <td
                      className={`p-3.5 text-right font-bold ${
                        row.netPnL >= 0 ? "text-emerald-400" : "text-rose-400"
                      }`}
                    >
                      {formatCurrency(row.netPnL, true)}
                    </td>
                    <td className="p-3.5 text-right">
                      <span className="text-cyan-300 font-semibold">
                        {formatRatio(row.profitFactor)}
                      </span>
                    </td>
                    <td className="p-3.5 text-right">
                      <span className="text-indigo-300 font-semibold">
                        {row.averageR > 0 ? `+${row.averageR.toFixed(2)}R` : `${row.averageR.toFixed(2)}R`}
                      </span>
                    </td>
                  </tr>
                );
              })
            ) : (
              <tr>
                <td
                  colSpan={6}
                  className="p-8 text-center text-slate-500 font-mono text-xs"
                >
                  <div className="space-y-1">
                    <p className="font-semibold text-slate-400">
                      No trades recorded yet.
                    </p>
                    <p className="text-[11px] text-slate-600">
                      Strategy performance metrics will display here when trades are logged.
                    </p>
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
