"use client";

import React, { useState } from "react";
import {
  Layers,
  Sliders,
  Zap,
  Lock,
  CheckCircle2,
  Sparkles,
  LayoutGrid,
  Table2,
  TrendingUp,
  TrendingDown,
  ShieldCheck,
  Activity,
  Search,
} from "lucide-react";
import type {
  FOScannerSetup,
  FOMarketStructureRegime,
  FOInstrumentType,
} from "./types";

interface FOPurpleBoxSpreadScannerProps {
  setups: FOScannerSetup[];
  loading?: boolean;
  selectedSetup: FOScannerSetup | null;
  instrumentFilter: "ALL" | FOInstrumentType;
  onChangeInstrumentFilter: (val: "ALL" | FOInstrumentType) => void;
  regimeFilter: "ALL" | FOMarketStructureRegime;
  onChangeRegimeFilter: (val: "ALL" | FOMarketStructureRegime) => void;
  searchQuery: string;
  onChangeSearchQuery: (q: string) => void;
  onOpenOptionChainModal: (setup: FOScannerSetup) => void;
  onOpenPayoffSimModal: (setup: FOScannerSetup) => void;
  onDeploySpreadPosition: (setup: FOScannerSetup) => void;
  deployedSymbols: Set<string>;
}

export default function FOPurpleBoxSpreadScanner({
  setups,
  loading = false,
  selectedSetup,
  instrumentFilter,
  onChangeInstrumentFilter,
  regimeFilter,
  onChangeRegimeFilter,
  searchQuery,
  onChangeSearchQuery,
  onOpenOptionChainModal,
  onOpenPayoffSimModal,
  onDeploySpreadPosition,
  deployedSymbols,
}: FOPurpleBoxSpreadScannerProps) {
  const [viewMode, setViewMode] = useState<"CARDS" | "TABLE">("CARDS");

  const getRegimeBadgeStyle = (regime: FOMarketStructureRegime) => {
    switch (regime) {
      case "RANGE_BOUND":
        return "bg-fuchsia-500/15 text-fuchsia-300 border-fuchsia-500/40 shadow-[0_0_12px_rgba(217,70,239,0.18)]";
      case "SUPPORT_BOUNCE":
        return "bg-emerald-500/15 text-emerald-300 border-emerald-500/40 shadow-[0_0_12px_rgba(16,185,129,0.18)]";
      case "BREAKOUT_DOJI_SQUEEZE":
        return "bg-cyan-500/15 text-cyan-300 border-cyan-500/40 shadow-[0_0_12px_rgba(6,182,212,0.18)]";
    }
  };

  const getStrategyBadgeStyle = (category: FOScannerSetup["strategyCategory"]) => {
    switch (category) {
      case "NEUTRAL_VEGA_THETA":
        return "bg-purple-500/20 text-purple-200 border-purple-500/50";
      case "CREDIT_THETA_DECAY":
        return "bg-emerald-500/20 text-emerald-200 border-emerald-500/50";
      case "DEBIT_MOMENTUM":
        return "bg-cyan-500/20 text-cyan-200 border-cyan-500/50";
    }
  };

  return (
    <div className="space-y-5 font-mono">
      {/* Filter, Regime Matcher & View Switcher Bar */}
      <div className="p-4 rounded-2xl bg-[#0d1322]/90 backdrop-blur-xl border border-slate-800/80 shadow-2xl flex flex-col xl:flex-row items-stretch xl:items-center justify-between gap-3.5">
        <div className="flex flex-wrap items-center gap-2.5">
          {/* Instrument Type Filter */}
          <div className="flex items-center bg-slate-950/90 p-1 rounded-xl border border-slate-800/90">
            {(["ALL", "INDEX", "STOCK"] as const).map((type) => (
              <button
                key={type}
                onClick={() => onChangeInstrumentFilter(type)}
                className={`px-3 py-1.5 rounded-lg text-xs font-mono font-bold transition-all cursor-pointer ${
                  instrumentFilter === type
                    ? "bg-gradient-to-r from-fuchsia-600 to-violet-600 text-white shadow-md shadow-fuchsia-500/20"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                {type === "ALL"
                  ? "All Derivatives"
                  : type === "INDEX"
                  ? "Indices (Nifty/BNF)"
                  : "Liquid F&O Stocks"}
              </button>
            ))}
          </div>

          {/* Market Structure Regime Filter */}
          <div className="flex flex-wrap items-center gap-1.5 bg-slate-950/90 p-1 rounded-xl border border-slate-800/90">
            {(
              [
                { id: "ALL", label: "All Regimes" },
                { id: "RANGE_BOUND", label: "🟣 Range-Bound (Iron Condor)" },
                { id: "SUPPORT_BOUNCE", label: "🛡️ VAL Bounce (Bull Put)" },
                { id: "BREAKOUT_DOJI_SQUEEZE", label: "🚀 VAH Breakout (Bull Call)" },
              ] as const
            ).map((r) => (
              <button
                key={r.id}
                onClick={() => onChangeRegimeFilter(r.id)}
                className={`px-2.5 py-1.5 rounded-lg text-xs font-mono font-semibold transition-all cursor-pointer ${
                  regimeFilter === r.id
                    ? "bg-fuchsia-500/20 text-fuchsia-200 border border-fuchsia-500/40 shadow-sm"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>

        {/* Search & View Mode Toggle */}
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="relative flex-1 sm:flex-initial">
            <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => onChangeSearchQuery(e.target.value)}
              placeholder="Search NIFTY, BANKNIFTY, HAL..."
              className="w-full sm:w-64 pl-8 pr-3 py-2 rounded-xl bg-slate-950/90 border border-slate-800 text-xs font-mono text-slate-100 placeholder-slate-500 focus:outline-none focus:border-fuchsia-500/60 transition-colors"
            />
          </div>

          <div className="flex items-center bg-slate-950/90 p-1 rounded-xl border border-slate-800">
            <button
              onClick={() => setViewMode("CARDS")}
              className={`px-2.5 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
                viewMode === "CARDS"
                  ? "bg-fuchsia-500/20 text-fuchsia-300 border border-fuchsia-500/40"
                  : "text-slate-400 hover:text-slate-200"
              }`}
              title="Sleek Institutional Glass Cards"
            >
              <LayoutGrid className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Glass Cards</span>
            </button>
            <button
              onClick={() => setViewMode("TABLE")}
              className={`px-2.5 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
                viewMode === "TABLE"
                  ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/40"
                  : "text-slate-400 hover:text-slate-200"
              }`}
              title="Dense Quant Matrix Table"
            >
              <Table2 className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Matrix Table</span>
            </button>
          </div>
        </div>
      </div>

      {/* Loading Skeleton State (Zero Layout Shift) */}
      {loading && setups.length === 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {[1, 2, 3, 4].map((n) => (
            <div
              key={n}
              className="bg-[#0d1322]/90 backdrop-blur-xl border border-slate-800/80 rounded-2xl p-5 shadow-2xl animate-pulse space-y-4"
            >
              <div className="flex items-center justify-between">
                <div className="h-6 w-40 bg-slate-800 rounded-lg" />
                <div className="h-6 w-28 bg-slate-800 rounded-lg" />
              </div>
              <div className="h-14 w-full bg-slate-900/90 rounded-xl" />
              <div className="grid grid-cols-2 gap-2">
                <div className="h-10 bg-slate-900 rounded-lg" />
                <div className="h-10 bg-slate-900 rounded-lg" />
              </div>
              <div className="h-10 w-full bg-slate-800/70 rounded-xl" />
            </div>
          ))}
        </div>
      )}

      {/* VIEW MODE 1: ULTRA-SLEEK INSTITUTIONAL GLASS CARDS */}
      {viewMode === "CARDS" && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {setups.map((setup) => {
            const isSelected = selectedSetup?.cleanSymbol === setup.cleanSymbol;
            const isDeployed = deployedSymbols.has(setup.cleanSymbol);
            const clampedBoxPos = Math.min(100, Math.max(0, setup.purpleBox.positionInBoxPct));

            return (
              <div
                key={setup.id}
                className={`bg-[#0d1322]/90 backdrop-blur-xl border ${
                  isSelected
                    ? "border-fuchsia-500/60 shadow-[0_0_28px_rgba(217,70,239,0.15)]"
                    : "border-slate-800/80 hover:border-fuchsia-500/50"
                } transition-all duration-300 rounded-2xl p-5 shadow-2xl flex flex-col justify-between space-y-4 group`}
              >
                {/* Card Top Header: Symbol, Live Spot/Futures & Strategy Badges */}
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 border-b border-slate-800/70 pb-3.5">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span
                        className={`px-2 py-0.5 rounded-md text-[10px] font-extrabold tracking-wider border ${
                          setup.instrumentType === "INDEX"
                            ? "bg-amber-500/15 text-amber-300 border-amber-500/40"
                            : "bg-cyan-500/15 text-cyan-300 border-cyan-500/30"
                        }`}
                      >
                        {setup.instrumentType}
                      </span>
                      <h3 className="text-lg font-extrabold text-white tracking-tight">
                        {setup.cleanSymbol}
                      </h3>
                      <span className="text-[11px] px-2 py-0.5 rounded bg-slate-900/90 border border-slate-700/80 text-slate-300 font-bold">
                        Lot: {setup.lotSize}
                      </span>
                      <span className="text-[11px] px-2 py-0.5 rounded bg-violet-950/60 border border-violet-500/30 text-violet-300">
                        Exp: {setup.expiryDate} ({setup.daysToExpiry}D)
                      </span>
                    </div>
                    <p className="text-xs text-slate-400 mt-1">
                      {setup.companyName} · <span className="text-slate-500">{setup.sector}</span>
                    </p>
                  </div>

                  {/* Live Spot Price & Change */}
                  <div className="sm:text-right">
                    <div className="flex sm:justify-end items-baseline gap-2">
                      <span className="text-lg font-extrabold text-slate-100 font-mono">
                        ₹{setup.spotPrice.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                      </span>
                      <span
                        className={`inline-flex items-center gap-0.5 text-xs font-bold px-1.5 py-0.5 rounded ${
                          setup.changePercent >= 0
                            ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30"
                            : "bg-rose-500/15 text-rose-400 border border-rose-500/30"
                        }`}
                      >
                        {setup.changePercent >= 0 ? (
                          <TrendingUp className="w-3 h-3" />
                        ) : (
                          <TrendingDown className="w-3 h-3" />
                        )}
                        {setup.changePercent >= 0 ? "+" : ""}
                        {setup.changePercent}%
                      </span>
                    </div>
                    <div className="text-[11px] text-cyan-400/90 font-mono mt-0.5">
                      FUT: ₹{setup.futuresPrice.toLocaleString("en-IN")} · ATM IV: {setup.optionChain.atmIV}%
                    </div>
                  </div>
                </div>

                {/* Active Strategy & Market Regime Badge Pills */}
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border ${getRegimeBadgeStyle(
                        setup.marketRegime
                      )}`}
                    >
                      {setup.regimeBadge}
                    </span>
                    <span
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-extrabold border ${getStrategyBadgeStyle(
                        setup.strategyCategory
                      )}`}
                    >
                      ⚡ {setup.strategyName}
                    </span>
                  </div>
                  <span className="text-[11px] px-2 py-0.5 rounded-md bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 font-bold">
                    Confluence {setup.confluenceScore}%
                  </span>
                </div>

                {/* Compact Progress Bar for "Position in Box %" (VAL Support ↔ VAH Ceiling) */}
                <div className="p-3.5 rounded-xl bg-slate-950/80 border border-slate-800/90 space-y-2">
                  <div className="flex items-center justify-between text-xs font-mono">
                    <span className="text-emerald-400 font-bold flex items-center gap-1">
                      🛡️ VAL Floor: ₹{setup.purpleBox.valSupportFloor.toLocaleString("en-IN")}
                    </span>
                    <span className="text-fuchsia-300 font-extrabold text-[11px]">
                      Position in Box: {setup.purpleBox.positionInBoxPct}%
                    </span>
                    <span className="text-fuchsia-400 font-bold flex items-center gap-1">
                      🧱 VAH Ceiling: ₹{setup.purpleBox.vahResistanceCeiling.toLocaleString("en-IN")}
                    </span>
                  </div>

                  {/* Glowing Progress Bar */}
                  <div className="w-full h-2.5 rounded-full bg-slate-900 border border-slate-700/80 overflow-hidden relative">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-emerald-500 via-fuchsia-500 to-cyan-400 transition-all duration-500"
                      style={{ width: `${clampedBoxPos}%` }}
                    />
                  </div>

                  <div className="flex flex-wrap items-center justify-between text-[10px] text-slate-400 font-mono">
                    <span>
                      Box Width: <strong className="text-slate-200">{setup.purpleBox.boxWidthPct}%</strong> ({setup.purpleBox.consolidationDays}D)
                    </span>
                    <span>
                      Touches: <strong className="text-emerald-300">{setup.purpleBox.supportTouches} VAL</strong> /{" "}
                      <strong className="text-fuchsia-300">{setup.purpleBox.resistanceTouches} VAH</strong>
                    </span>
                    <span>
                      Put Wall: <strong className="text-emerald-300">{setup.optionChain.valAlignedStrike} PE</strong> · Call Wall:{" "}
                      <strong className="text-fuchsia-300">{setup.optionChain.vahAlignedStrike} CE</strong>
                    </span>
                  </div>
                </div>

                {/* Distinctly Color-Coded Option Legs (Green = BUY, Rose/Red = SELL with Strike Pills) */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-slate-400">
                    <span>Multi-Leg Execution Structure ({setup.legs.length} Legs)</span>
                    <span>
                      Net {setup.payoffMetrics.isNetCredit ? "Credit" : "Debit"}:{" "}
                      <strong
                        className={
                          setup.payoffMetrics.isNetCredit ? "text-emerald-400" : "text-amber-300"
                        }
                      >
                        {setup.payoffMetrics.isNetCredit ? "+" : "-"}₹
                        {Math.abs(setup.payoffMetrics.netPremiumTotalINR).toLocaleString("en-IN")}
                      </strong>
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {setup.legs.map((leg) => {
                      const isBuy = leg.action === "BUY";
                      return (
                        <div
                          key={leg.legId}
                          className={`p-2.5 rounded-xl border flex items-center justify-between gap-2 font-mono transition-colors ${
                            isBuy
                              ? "bg-emerald-950/20 border-emerald-500/35 hover:border-emerald-400/60"
                              : "bg-rose-950/20 border-rose-500/35 hover:border-rose-400/60"
                          }`}
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            {/* Green Badge for BUY, Rose/Red Badge for SELL */}
                            <span
                              className={`px-2 py-0.5 rounded-md text-[10px] font-extrabold tracking-wide border shrink-0 ${
                                isBuy
                                  ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/50"
                                  : "bg-rose-500/20 text-rose-300 border-rose-500/50"
                              }`}
                            >
                              {leg.action} {leg.lots}x
                            </span>

                            {/* Strike Price Pill */}
                            <span
                              className={`px-2 py-0.5 rounded-md text-xs font-extrabold border shrink-0 ${
                                isBuy
                                  ? "bg-emerald-950/90 text-emerald-200 border-emerald-500/40"
                                  : "bg-rose-950/90 text-rose-200 border-rose-500/40"
                              }`}
                            >
                              {leg.strike.toLocaleString("en-IN")} {leg.right}
                            </span>
                          </div>

                          <div className="text-right shrink-0">
                            <div className="text-xs font-extrabold text-white">
                              ₹{leg.premium.toFixed(2)}
                            </div>
                            <div className="text-[9px] text-slate-400">
                              Δ {leg.delta.toFixed(2)} · Θ {leg.theta}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* High-Contrast Monospace Financial & Greek Strip */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 pt-1">
                  <div className="p-2.5 rounded-xl bg-slate-950/90 border border-slate-800/90">
                    <div className="text-[9px] uppercase text-slate-400">Max Profit (ROI)</div>
                    <div className="text-xs font-extrabold text-emerald-400 mt-0.5">
                      +₹{setup.payoffMetrics.maxProfitINR.toLocaleString("en-IN")}
                    </div>
                    <div className="text-[10px] text-emerald-500">
                      +{setup.payoffMetrics.maxProfitPctOnMargin}% on Margin
                    </div>
                  </div>

                  <div className="p-2.5 rounded-xl bg-slate-950/90 border border-slate-800/90">
                    <div className="text-[9px] uppercase text-slate-400">Max Defined Loss</div>
                    <div className="text-xs font-extrabold text-rose-400 mt-0.5">
                      -₹{setup.payoffMetrics.maxLossINR.toLocaleString("en-IN")}
                    </div>
                    <div className="text-[10px] text-slate-400 truncate">
                      BE: ₹{setup.payoffMetrics.lowerBreakeven.toLocaleString("en-IN")}
                      {setup.payoffMetrics.upperBreakeven
                        ? `–₹${setup.payoffMetrics.upperBreakeven.toLocaleString("en-IN")}`
                        : ""}
                    </div>
                  </div>

                  <div className="p-2.5 rounded-xl bg-slate-950/90 border border-slate-800/90">
                    <div className="text-[9px] uppercase text-slate-400">PoP % &amp; PCR</div>
                    <div className="text-xs font-extrabold text-cyan-300 mt-0.5">
                      PoP {setup.payoffMetrics.probabilityOfProfitPct}%
                    </div>
                    <div className="text-[10px] text-slate-400">
                      PCR {setup.optionChain.overallPCR} · Θ{" "}
                      <span
                        className={
                          setup.payoffMetrics.netGreeks.thetaINRPerDay >= 0
                            ? "text-emerald-400"
                            : "text-rose-400"
                        }
                      >
                        {setup.payoffMetrics.netGreeks.thetaINRPerDay >= 0 ? "+" : ""}₹
                        {setup.payoffMetrics.netGreeks.thetaINRPerDay}/d
                      </span>
                    </div>
                  </div>

                  <div className="p-2.5 rounded-xl bg-slate-950/90 border border-slate-800/90">
                    <div className="text-[9px] uppercase text-slate-400">Hedged Margin</div>
                    <div className="text-xs font-extrabold text-slate-100 mt-0.5">
                      ₹{setup.payoffMetrics.estimatedMarginRequiredINR.toLocaleString("en-IN")}
                    </div>
                    <div className="text-[10px] text-emerald-400">
                      -{setup.payoffMetrics.hedgeMarginBenefitPct}% Hedge Benefit
                    </div>
                  </div>
                </div>

                {/* Action Footer: Chain & OI Modal, Payoff Sim Modal, Deploy Spread */}
                <div className="pt-2 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => onOpenOptionChainModal(setup)}
                      className="px-3.5 py-2 rounded-xl bg-slate-900 hover:bg-cyan-950/50 text-cyan-300 border border-cyan-500/30 hover:border-cyan-400/70 text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer shadow-sm"
                    >
                      <Layers className="w-3.5 h-3.5 text-cyan-400" />
                      <span>Chain &amp; OI</span>
                    </button>

                    <button
                      onClick={() => onOpenPayoffSimModal(setup)}
                      className="px-3.5 py-2 rounded-xl bg-slate-900 hover:bg-fuchsia-950/50 text-fuchsia-300 border border-fuchsia-500/30 hover:border-fuchsia-400/70 text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer shadow-sm"
                    >
                      <Sliders className="w-3.5 h-3.5 text-fuchsia-400" />
                      <span>Payoff Sim</span>
                    </button>
                  </div>

                  <button
                    onClick={() => onDeploySpreadPosition(setup)}
                    disabled={isDeployed}
                    className={`px-4 py-2 rounded-xl text-xs font-extrabold flex items-center gap-1.5 transition-all cursor-pointer ${
                      isDeployed
                        ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 cursor-default"
                        : "bg-gradient-to-r from-fuchsia-600 via-violet-600 to-cyan-600 hover:from-fuchsia-500 hover:to-cyan-500 text-white shadow-lg shadow-fuchsia-600/25"
                    }`}
                  >
                    {isDeployed ? (
                      <>
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>Spread Deployed</span>
                      </>
                    ) : (
                      <>
                        <Zap className="w-3.5 h-3.5" />
                        <span>Deploy Spread</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* VIEW MODE 2: DENSE QUANT MATRIX TABLE */}
      {viewMode === "TABLE" && (
        <div className="rounded-2xl bg-[#0d1322]/90 backdrop-blur-xl border border-slate-800/80 overflow-hidden shadow-2xl">
          <div className="px-5 py-3.5 border-b border-slate-800/80 bg-slate-950/60 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-fuchsia-400" />
              <h3 className="text-sm font-bold text-slate-100 font-mono">
                F&amp;O PURPLE BOX ACCUMULATION &amp; MULTI-LEG STRATEGY MATRIX ({setups.length} Contracts)
              </h3>
            </div>
            <div className="flex items-center gap-2 text-[11px] font-mono text-emerald-400">
              <Lock className="w-3.5 h-3.5" />
              <span>Same-Day Strike &amp; Premium Freeze Active</span>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-800/80 bg-slate-950/80 text-[11px] font-mono uppercase text-slate-400">
                  <th className="py-3 px-4">Derivative / Lot</th>
                  <th className="py-3 px-3">Spot &amp; Futures</th>
                  <th className="py-3 px-3">Purple Box (VAL ↔ VAH)</th>
                  <th className="py-3 px-3">Structure &amp; Matched Strategy</th>
                  <th className="py-3 px-3">Color-Coded Legs</th>
                  <th className="py-3 px-3">Max Profit / Loss</th>
                  <th className="py-3 px-3">PoP % / Greeks</th>
                  <th className="py-3 px-3">Hedged Margin</th>
                  <th className="py-3 px-4 text-right">Modals &amp; Execution</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 text-xs font-mono">
                {setups.map((setup) => {
                  const isDeployed = deployedSymbols.has(setup.cleanSymbol);
                  const clampedBoxPos = Math.min(
                    100,
                    Math.max(0, setup.purpleBox.positionInBoxPct)
                  );

                  return (
                    <tr
                      key={setup.id}
                      className="hover:bg-fuchsia-950/15 transition-colors"
                    >
                      <td className="py-3.5 px-4">
                        <div className="flex items-center gap-2">
                          <span
                            className={`px-1.5 py-0.5 rounded text-[10px] font-bold border ${
                              setup.instrumentType === "INDEX"
                                ? "bg-amber-500/15 text-amber-300 border-amber-500/30"
                                : "bg-cyan-500/10 text-cyan-300 border-cyan-500/20"
                            }`}
                          >
                            {setup.instrumentType}
                          </span>
                          <span className="font-extrabold text-white text-sm">
                            {setup.cleanSymbol}
                          </span>
                        </div>
                        <div className="text-[10px] text-slate-400 mt-0.5">
                          Lot: <strong className="text-slate-200">{setup.lotSize}</strong> · {setup.expiryDate}
                        </div>
                      </td>

                      <td className="py-3.5 px-3">
                        <div className="font-bold text-slate-100">
                          ₹{setup.spotPrice.toLocaleString("en-IN")}
                        </div>
                        <div
                          className={`text-[11px] font-bold ${
                            setup.changePercent >= 0 ? "text-emerald-400" : "text-rose-400"
                          }`}
                        >
                          {setup.changePercent >= 0 ? "+" : ""}
                          {setup.changePercent}%
                        </div>
                        <div className="text-[10px] text-slate-400">
                          FUT: ₹{setup.futuresPrice.toLocaleString("en-IN")}
                        </div>
                      </td>

                      <td className="py-3.5 px-3 min-w-[190px]">
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="text-emerald-400 font-bold">
                            VAL ₹{setup.purpleBox.valSupportFloor.toLocaleString("en-IN")}
                          </span>
                          <span className="text-fuchsia-400 font-bold">
                            VAH ₹{setup.purpleBox.vahResistanceCeiling.toLocaleString("en-IN")}
                          </span>
                        </div>
                        <div className="w-full h-2 rounded-full bg-slate-900 my-1.5 overflow-hidden border border-slate-700/60">
                          <div
                            className="h-full bg-gradient-to-r from-emerald-500 via-fuchsia-500 to-cyan-400 rounded-full"
                            style={{ width: `${clampedBoxPos}%` }}
                          />
                        </div>
                        <div className="flex items-center justify-between text-[10px] text-slate-400">
                          <span>Width: {setup.purpleBox.boxWidthPct}%</span>
                          <span className="text-fuchsia-300 font-bold">
                            Box Pos: {setup.purpleBox.positionInBoxPct}%
                          </span>
                        </div>
                      </td>

                      <td className="py-3.5 px-3 max-w-[230px]">
                        <div className="flex flex-col gap-1">
                          <span
                            className={`inline-flex w-fit px-2 py-0.5 rounded text-[10px] font-bold border ${getRegimeBadgeStyle(
                              setup.marketRegime
                            )}`}
                          >
                            {setup.regimeBadge}
                          </span>
                          <span
                            className={`inline-flex w-fit px-2 py-0.5 rounded text-[11px] font-bold border ${getStrategyBadgeStyle(
                              setup.strategyCategory
                            )}`}
                          >
                            {setup.strategyName}
                          </span>
                        </div>
                      </td>

                      <td className="py-3.5 px-3 min-w-[200px]">
                        <div className="space-y-1">
                          {setup.legs.map((leg) => {
                            const isBuy = leg.action === "BUY";
                            return (
                              <div
                                key={leg.legId}
                                className={`flex items-center justify-between gap-2 px-2 py-1 rounded-lg border text-[10px] ${
                                  isBuy
                                    ? "bg-emerald-950/25 border-emerald-500/40 text-emerald-300"
                                    : "bg-rose-950/25 border-rose-500/40 text-rose-300"
                                }`}
                              >
                                <span className="font-extrabold">
                                  {leg.action} {leg.lots}x {leg.strike} {leg.right}
                                </span>
                                <span className="text-white font-bold">₹{leg.premium}</span>
                              </div>
                            );
                          })}
                        </div>
                      </td>

                      <td className="py-3.5 px-3">
                        <div className="text-emerald-400 font-extrabold">
                          +₹{setup.payoffMetrics.maxProfitINR.toLocaleString("en-IN")}
                        </div>
                        <div className="text-rose-400 font-bold text-[11px] mt-0.5">
                          -₹{setup.payoffMetrics.maxLossINR.toLocaleString("en-IN")}
                        </div>
                      </td>

                      <td className="py-3.5 px-3">
                        <span className="px-2 py-0.5 rounded bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 font-bold text-xs">
                          PoP {setup.payoffMetrics.probabilityOfProfitPct}%
                        </span>
                        <div className="text-[10px] text-slate-400 mt-1">
                          PCR {setup.optionChain.overallPCR} · IV {setup.optionChain.atmIV}%
                        </div>
                      </td>

                      <td className="py-3.5 px-3">
                        <div className="font-bold text-slate-100">
                          ₹{setup.payoffMetrics.estimatedMarginRequiredINR.toLocaleString("en-IN")}
                        </div>
                        <div className="text-[10px] text-emerald-400">
                          -{setup.payoffMetrics.hedgeMarginBenefitPct}% Hedge
                        </div>
                      </td>

                      <td className="py-3.5 px-4 text-right">
                        <div className="flex flex-col items-end gap-1.5">
                          <div className="flex items-center gap-1.5">
                            <button
                              onClick={() => onOpenOptionChainModal(setup)}
                              className="px-2.5 py-1 rounded-lg bg-slate-900 hover:bg-cyan-950/60 text-cyan-300 border border-cyan-500/30 text-[10px] font-bold flex items-center gap-1 cursor-pointer"
                            >
                              <Layers className="w-3 h-3" />
                              <span>Chain &amp; OI</span>
                            </button>
                            <button
                              onClick={() => onOpenPayoffSimModal(setup)}
                              className="px-2.5 py-1 rounded-lg bg-slate-900 hover:bg-fuchsia-950/60 text-fuchsia-300 border border-fuchsia-500/30 text-[10px] font-bold flex items-center gap-1 cursor-pointer"
                            >
                              <Sliders className="w-3 h-3" />
                              <span>Payoff Sim</span>
                            </button>
                          </div>
                          <button
                            onClick={() => onDeploySpreadPosition(setup)}
                            disabled={isDeployed}
                            className={`px-3 py-1.5 rounded-lg text-[11px] font-bold flex items-center gap-1 cursor-pointer ${
                              isDeployed
                                ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40"
                                : "bg-gradient-to-r from-fuchsia-600 to-cyan-600 text-white"
                            }`}
                          >
                            <Zap className="w-3 h-3" />
                            <span>{isDeployed ? "Deployed" : "Deploy Spread"}</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
