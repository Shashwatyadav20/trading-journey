"use client";

import React from "react";
import { MistakeAnalysisResult } from "../../lib/monthlyCalculations";
import { formatCurrency, formatPercent } from "../../lib/calculations";
import { Tag, AlertTriangle, Flame, ShieldAlert, Award, AlertCircle } from "lucide-react";

interface TradingMistakeAnalysisCardProps {
  data: MistakeAnalysisResult;
  monthName: string;
}

export default function TradingMistakeAnalysisCard({
  data,
  monthName,
}: TradingMistakeAnalysisCardProps) {
  const hasMistakes = data.items.length > 0;

  return (
    <div className="p-6 rounded-2xl bg-slate-900/70 border border-slate-800/80 space-y-6 shadow-xl font-mono text-xs">
      {/* Section Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800/80 pb-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-amber-500/10 text-amber-400 border border-amber-500/20">
            <AlertTriangle className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-base font-bold text-slate-100 tracking-tight font-sans">
              Trading Mistake Audit ({monthName})
            </h3>
            <p className="text-xs text-slate-400 font-mono">
              Psychological tags, frequency, win rate, and financial impact
            </p>
          </div>
        </div>

        {hasMistakes && (
          <div className="px-3 py-1.5 rounded-xl bg-rose-500/10 text-rose-400 border border-rose-500/20 flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 shrink-0" />
            <span>
              Total Mistake Cost: <strong>{formatCurrency(data.totalMistakeCost)}</strong>
            </span>
          </div>
        )}
      </div>

      {/* Summary Highlights Cards */}
      {hasMistakes ? (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Most Common Mistake */}
            <div className="p-4 rounded-xl bg-slate-950/80 border border-slate-800/80 space-y-1.5">
              <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider block">
                Most Common Mistake
              </span>
              <div className="flex items-center gap-2">
                <Tag className="w-4 h-4 text-amber-400 shrink-0" />
                <span className="text-sm font-bold text-amber-400 font-sans">
                  {data.mostCommonMistake}
                </span>
              </div>
            </div>

            {/* Costliest Mistake */}
            <div className="p-4 rounded-xl bg-slate-950/80 border border-slate-800/80 space-y-1.5">
              <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider block">
                Costliest Execution Error
              </span>
              <div className="flex items-center gap-2">
                <Flame className="w-4 h-4 text-rose-400 shrink-0" />
                <span className="text-sm font-bold text-rose-400 font-sans">
                  {data.costliestMistake}
                </span>
              </div>
            </div>
          </div>

          {/* Detailed Mistake Breakdown Grid */}
          <div className="space-y-3">
            <h4 className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
              Mistake Impact Breakdown
            </h4>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {data.items.map((item) => {
                const isNoMistake = item.tag === "No Mistake";
                const isWin = item.netPnL >= 0;

                return (
                  <div
                    key={item.tag}
                    className={`
                      p-4 rounded-xl border space-y-3 transition-all
                      ${
                        isNoMistake
                          ? "bg-slate-900/90 border-emerald-500/30"
                          : "bg-slate-950/80 border-slate-800 hover:border-slate-700"
                      }
                    `}
                  >
                    {/* Header */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="space-y-0.5">
                        <span
                          className={`font-bold font-sans text-sm ${
                            isNoMistake ? "text-emerald-400" : "text-amber-400"
                          }`}
                        >
                          {item.tag}
                        </span>
                        <span className="text-[10px] text-slate-500 block">
                          {item.totalTrades} {item.totalTrades === 1 ? "trade" : "trades"} ({item.percentageOfTotal.toFixed(1)}% of month)
                        </span>
                      </div>

                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-bold border ${
                          isNoMistake
                            ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                            : "bg-amber-500/10 text-amber-400 border-amber-500/20"
                        }`}
                      >
                        {isNoMistake ? "Disciplined" : "Mistake"}
                      </span>
                    </div>

                    {/* Stats */}
                    <div className="grid grid-cols-2 gap-2 p-2.5 rounded-lg bg-slate-900/60 border border-slate-800/60 text-xs">
                      <div>
                        <span className="text-[9px] text-slate-500 block">WIN RATE</span>
                        <span
                          className={`font-bold ${
                            item.winRate >= 50 ? "text-emerald-400" : "text-rose-400"
                          }`}
                        >
                          {formatPercent(item.winRate)}
                        </span>
                      </div>

                      <div>
                        <span className="text-[9px] text-slate-500 block">ACCUMULATED P/L</span>
                        <span
                          className={`font-bold ${
                            isWin ? "text-emerald-400" : "text-rose-400"
                          }`}
                        >
                          {formatCurrency(item.netPnL, true)}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      ) : (
        /* Empty State */
        <div className="p-8 text-center text-slate-500 space-y-1">
          <AlertCircle className="w-6 h-6 mx-auto text-slate-600 mb-1" />
          <p className="font-semibold text-slate-400">No execution mistakes tagged for this month.</p>
          <p className="text-[11px] text-slate-600">
            Keep logging trade execution tags in the Trade Journal for psychology audit.
          </p>
        </div>
      )}
    </div>
  );
}
