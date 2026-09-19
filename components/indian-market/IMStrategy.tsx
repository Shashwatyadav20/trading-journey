"use client";

import React, { useState } from "react";
import IMHeader from "./IMHeader";
import IMStatusBadge from "./IMStatusBadge";
import IMBacktestView from "./IMBacktestView";

const REGIMES: { id: string; active: boolean }[] = [
  { id: "BULLISH", active: true },
  { id: "BEARISH", active: false },
  { id: "RANGE", active: false },
  { id: "HIGH VOLATILITY", active: false },
  { id: "EVENT RISK", active: false },
  { id: "UNCLEAR", active: false },
];

interface StrategyCardProps {
  name: string;
  type: string;
  legs: { label: string; value: string }[];
  metrics: { label: string; value: string; accent?: string }[];
  score: number;
  confidence: string;
  recommended?: boolean;
}

function StrategyCard({ name, type, legs, metrics, score, confidence, recommended }: StrategyCardProps) {
  return (
    <div
      className={`p-5 rounded-2xl border space-y-4 ${
        recommended
          ? "bg-emerald-500/5 border-emerald-500/30"
          : "bg-[#11192e]/80 border-slate-800/80"
      }`}
    >
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold text-slate-100 font-mono">{name}</span>
            {recommended && (
              <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 font-mono font-bold">
                TOP PICK
              </span>
            )}
          </div>
          <span className="text-[10px] text-slate-500 font-mono">{type}</span>
        </div>
        <div className="text-right">
          <div className="text-lg font-bold text-cyan-400 font-mono">{score}<span className="text-xs text-slate-500">/100</span></div>
          <div className="text-[10px] text-slate-500 font-mono">{confidence}</div>
        </div>
      </div>

      {/* Legs */}
      <div className="space-y-1">
        <div className="text-[9px] text-slate-600 font-mono uppercase tracking-widest">Legs</div>
        {legs.map((l) => (
          <div key={l.label} className="flex justify-between text-[10px] font-mono py-1 border-b border-slate-800/40 last:border-0">
            <span className="text-slate-500">{l.label}</span>
            <span className="text-slate-200 font-semibold">{l.value}</span>
          </div>
        ))}
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-2 gap-2">
        {metrics.map((m) => (
          <div key={m.label} className="px-3 py-2 rounded-lg bg-slate-900/60 border border-slate-800/50">
            <div className="text-[9px] text-slate-600 font-mono uppercase">{m.label}</div>
            <div className={`text-xs font-bold font-mono ${m.accent || "text-slate-200"}`}>{m.value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function IMStrategy() {
  const [activeSubTab, setActiveSubTab] = useState<"strategy" | "backtest">("strategy");

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div>
            <h2 className="text-xl font-bold text-slate-100 tracking-tight">STRATEGY & BACKTEST</h2>
            <p className="text-xs text-slate-400 font-mono">Defined-Risk Option Setups & Historical Validation</p>
          </div>
          <IMStatusBadge status="PAPER MODE" size="sm" />
        </div>

        {/* Sub-tab navigation */}
        <div className="flex items-center p-1 rounded-xl bg-slate-900 border border-slate-800 font-mono text-xs">
          <button
            onClick={() => setActiveSubTab("strategy")}
            className={`px-3 py-1.5 rounded-lg transition-colors font-bold ${
              activeSubTab === "strategy"
                ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/30"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            STRATEGY SETUPS
          </button>
          <button
            onClick={() => setActiveSubTab("backtest")}
            className={`px-3 py-1.5 rounded-lg transition-colors font-bold ${
              activeSubTab === "backtest"
                ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/30"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            WALK-FORWARD BACKTEST
          </button>
        </div>
      </div>

      {activeSubTab === "backtest" ? (
        <IMBacktestView />
      ) : (
        <>
          <IMHeader />

          {/* Market Regime selector */}
          <div className="space-y-3">
            <div className="text-[10px] font-mono font-bold text-slate-500 uppercase tracking-widest">MARKET REGIME</div>
            <div className="flex flex-wrap gap-2">
              {REGIMES.map((r) => (
                <button
                  key={r.id}
                  className={`px-3 py-1.5 rounded-lg text-[10px] font-mono font-bold border transition-all ${
                    r.active
                      ? r.id === "BULLISH"
                        ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
                        : r.id === "BEARISH"
                        ? "bg-rose-500/15 text-rose-400 border-rose-500/30"
                        : "bg-amber-500/15 text-amber-400 border-amber-500/30"
                      : "bg-slate-900 text-slate-600 border-slate-800 hover:text-slate-400"
                  }`}
                >
                  {r.id}
                </button>
              ))}
            </div>
          </div>

          {/* Strategy Cards */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            <StrategyCard
              name="BULL PUT SPREAD"
              type="Credit Spread · Defined Risk"
              recommended
              score={86}
              confidence="HIGH"
              legs={[
                { label: "Sell Put", value: "24,500 PE @ ₹65" },
                { label: "Buy Put (Hedge)", value: "24,300 PE @ ₹20" },
              ]}
              metrics={[
                { label: "Entry", value: "₹45 net credit" },
                { label: "SL", value: "₹67.50 (1.5×)" },
                { label: "Target", value: "₹22.50 (50%)" },
                { label: "Max Profit", value: "₹1,125", accent: "text-emerald-400" },
                { label: "Max Loss", value: "₹3,875", accent: "text-rose-400" },
                { label: "Risk %", value: "0.78%", accent: "text-amber-400" },
                { label: "Reward/Risk", value: "0.29×" },
                { label: "Margin", value: "₹5,000" },
                { label: "Charges", value: "₹204" },
                { label: "Net P&L", value: "+₹921 / −₹4,079", accent: "text-emerald-400" },
              ]}
            />

            <StrategyCard
              name="BEAR CALL SPREAD"
              type="Credit Spread · Defined Risk"
              score={62}
              confidence="MEDIUM"
              legs={[
                { label: "Sell Call", value: "24,900 CE @ ₹55" },
                { label: "Buy Call (Hedge)", value: "25,100 CE @ ₹18" },
              ]}
              metrics={[
                { label: "Entry", value: "₹37 net credit" },
                { label: "SL", value: "₹55.50 (1.5×)" },
                { label: "Target", value: "₹18.50 (50%)" },
                { label: "Max Profit", value: "₹925", accent: "text-emerald-400" },
                { label: "Max Loss", value: "₹4,075", accent: "text-rose-400" },
                { label: "Risk %", value: "0.82%", accent: "text-amber-400" },
                { label: "Reward/Risk", value: "0.23×" },
                { label: "Margin", value: "₹5,000" },
                { label: "Charges", value: "₹204" },
                { label: "Net P&L", value: "+₹721 / −₹4,279", accent: "text-rose-400" },
              ]}
            />

            <StrategyCard
              name="IRON CONDOR"
              type="Neutral · Defined Risk"
              score={54}
              confidence="LOW"
              legs={[
                { label: "Sell Call", value: "24,900 CE @ ₹55" },
                { label: "Buy Call", value: "25,100 CE @ ₹18" },
                { label: "Sell Put", value: "24,500 PE @ ₹65" },
                { label: "Buy Put", value: "24,300 PE @ ₹20" },
              ]}
              metrics={[
                { label: "Entry", value: "₹82 net credit" },
                { label: "SL", value: "₹123 (1.5×)" },
                { label: "Target", value: "₹41 (50%)" },
                { label: "Max Profit", value: "₹2,050", accent: "text-emerald-400" },
                { label: "Max Loss", value: "₹2,950", accent: "text-rose-400" },
                { label: "Risk %", value: "0.59%", accent: "text-amber-400" },
                { label: "Reward/Risk", value: "0.69×" },
                { label: "Margin", value: "₹5,000" },
                { label: "Charges", value: "₹408" },
                { label: "Net P&L", value: "+₹1,642 / −₹3,358", accent: "text-slate-400" },
              ]}
            />
          </div>

          <div className="text-[9px] text-slate-600 font-mono text-center">
            ⚠ PAPER MODE — System evaluates defined-risk option spreads with exact statutory charges and 1% risk sizing.
          </div>
        </>
      )}
    </div>
  );
}
