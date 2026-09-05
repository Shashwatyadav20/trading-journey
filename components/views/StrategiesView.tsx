"use client";

import React from "react";
import { useTrades } from "../../context/TradeContext";
import {
  calculateStrategyPerformance,
  formatCurrency,
  formatPercent,
  formatRatio,
  formatStrategyName,
} from "../../lib/calculations";
import StrategyRankingCard from "../strategies/StrategyRankingCard";
import StrategyComparisonTable from "../strategies/StrategyComparisonTable";
import { PRESET_STRATEGIES } from "../../types/trade";
import {
  Zap,
  Trophy,
  CheckCircle2,
  Sparkles,
  Plus,
  Layers,
  FolderOpen,
  ArrowUpRight,
} from "lucide-react";

export default function StrategiesView() {
  const { trades, loadSampleTrades, clearTrades } = useTrades();

  // Calculate dynamic strategy metrics & rankings from localStorage trades
  const strategyMetrics = calculateStrategyPerformance(trades);
  const hasTrades = trades.length > 0;

  return (
    <div className="space-y-8">
      {/* Top Banner Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5 rounded-2xl bg-gradient-to-r from-slate-900/95 via-slate-900/70 to-cyan-950/40 border border-slate-800/80 shadow-xl">
        <div className="space-y-1">
          <div className="flex items-center gap-2.5">
            <Zap className="w-5 h-5 text-cyan-400" />
            <h2 className="text-xl font-bold text-slate-100 tracking-tight">
              Strategy Playbook & Edge Analytics
            </h2>
            <span
              className={`text-[11px] px-2.5 py-0.5 rounded-full font-mono border font-medium ${
                hasTrades
                  ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                  : "bg-cyan-500/10 text-cyan-400 border-cyan-500/20"
              }`}
            >
              {hasTrades
                ? `${strategyMetrics.filter((s) => s.totalTrades > 0).length} Active Setups`
                : "Clean Empty State"}
            </span>
          </div>
          <p className="text-xs text-slate-400 font-mono">
            Strategy-wise profit analytics calculated from <code className="text-cyan-400">localStorage</code> trades.
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

      {/* SECTION 1: MULTI-METRIC STRATEGY RANKING SECTION */}
      <section className="space-y-3">
        <StrategyRankingCard strategies={strategyMetrics} />
      </section>

      {/* SECTION 2: STRATEGY COMPARISON TABLE */}
      <section className="space-y-3">
        <StrategyComparisonTable strategies={strategyMetrics} />
      </section>

      {/* SECTION 3: PRESET STRATEGY PLAYBOOK CARDS */}
      <section className="space-y-4">
        <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
          <div className="flex items-center gap-2">
            <Layers className="w-4 h-4 text-cyan-400" />
            <h3 className="text-sm font-bold text-slate-100 font-sans tracking-tight">
              Preset Strategy Playbook Rules
            </h3>
          </div>
          <span className="text-xs text-slate-500 font-mono">
            5 Core Trading Models
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[
            {
              name: "LIQUIDITY_SWEEP",
              timeframe: "15M / 5M",
              description: "Identifies session high/low liquidity sweeps into key HTF levels.",
              rules: ["Session High/Low swept", "Displacement candle formed", "Entry on FVG or market structure shift"],
            },
            {
              name: "SWING",
              timeframe: "1H / 15M",
              description: "Trades continuation or reversal from major swing high and swing low structure points.",
              rules: ["Identify 4H/1H Swing High/Low", "Wait for lower timeframe breaker", "Stop placed beyond swing point"],
            },
            {
              name: "EQH_EQL",
              timeframe: "15M",
              description: "Target equal highs (EQH) and equal lows (EQL) liquidity pools.",
              rules: ["Mark double tops (EQH) or bottoms (EQL)", "Wait for stop hunt expansion", "Target opposite side liquidity"],
            },
            {
              name: "PWH_PWL",
              timeframe: "Daily / 1H",
              description: "Prior Week Low (PWL) and Prior Week High (PWH) key level trading model.",
              rules: ["Mark Sunday open PWL & PWH levels", "Monitor weekly expansion phase", "Trade rejections off PWL/PWH"],
            },
            {
              name: "SWEEP_ENGULFING",
              timeframe: "15M / 5M",
              description: "Liquidity sweep followed by immediate strong engulfing candle confirmation.",
              rules: ["Liquidity level swept", "Immediate engulfing candle close", "Confirmation entry on body close"],
            },
            {
              name: "Manual Trade",
              timeframe: "Flexible",
              description: "Trades executed manually without explicit Pine signal attribution.",
              rules: ["User manual entry", "Discretionary setup", "Standard risk management"],
            },
          ].map((strat, idx) => {
            const metricsObj = strategyMetrics.find((s) => s.strategy === strat.name);
            const tradesCount = metricsObj ? metricsObj.totalTrades : 0;
            const netPnL = metricsObj ? metricsObj.netPnL : 0;
            const winRate = metricsObj ? metricsObj.winRate : 0;

            return (
              <div
                key={idx}
                className="p-5 rounded-2xl bg-slate-900/60 border border-slate-800/80 space-y-4 flex flex-col justify-between hover:border-slate-700/80 transition-colors"
              >
                <div className="space-y-3 font-mono text-xs">
                  <div className="flex items-start justify-between gap-2">
                    <h4 className="font-bold text-slate-100 text-sm tracking-tight font-sans">
                      {formatStrategyName(strat.name)}
                    </h4>
                    <span className="px-2 py-0.5 rounded text-[10px] bg-slate-800 text-cyan-400 border border-slate-700 font-mono">
                      {strat.timeframe}
                    </span>
                  </div>

                  <p className="text-slate-400 text-[11px] leading-relaxed">
                    {strat.description}
                  </p>

                  <div className="grid grid-cols-3 gap-2 p-2.5 rounded-xl bg-slate-950/80 border border-slate-800/60 text-center">
                    <div>
                      <span className="text-[9px] text-slate-500 block">TRADES</span>
                      <span className="font-bold text-slate-200">{tradesCount}</span>
                    </div>
                    <div>
                      <span className="text-[9px] text-slate-500 block">WIN RATE</span>
                      <span className={`font-bold ${winRate >= 50 ? "text-emerald-400" : "text-slate-400"}`}>
                        {formatPercent(winRate)}
                      </span>
                    </div>
                    <div>
                      <span className="text-[9px] text-slate-500 block">NET PNL</span>
                      <span className={`font-bold ${netPnL >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                        {formatCurrency(netPnL, true)}
                      </span>
                    </div>
                  </div>

                  <div className="space-y-1.5 pt-1">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                      Execution Rules:
                    </span>
                    {strat.rules.map((rule, rIdx) => (
                      <div key={rIdx} className="flex items-center gap-2 text-[11px] text-slate-300">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                        <span>{rule}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
