"use client";

import React, { useState } from "react";
import { Activity, Bitcoin, Zap } from "lucide-react";
import { TradingViewChart } from "../charts/TradingViewChart";
import { StrategyChart } from "../charts/StrategyChart";

import PaperTradingPanel from "../trading/PaperTradingPanel";
import OpenPositionsTable from "../trading/OpenPositionsTable";
import PendingOrdersPanel from "../trading/PendingOrdersPanel";

type MarketSymbol = "OANDA:XAUUSD" | "BINANCE:BTCUSD";
type ViewMode = "LIVE" | "STRATEGY";

export default function LiveChartsView() {
  const [activeSymbol, setActiveSymbol] = useState<MarketSymbol>("OANDA:XAUUSD");
  const [viewMode, setViewMode] = useState<ViewMode>("LIVE");

  const currentDisplaySymbol = activeSymbol.includes("BTC") ? "BTC/USD" : "XAU/USD";

  return (
    <div className="space-y-6 flex flex-col">
      {/* Header and Toggle Controls */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-100 font-sans tracking-tight flex items-center gap-2">
            {viewMode === "LIVE" ? (
              <Activity className="w-6 h-6 text-cyan-400" />
            ) : (
              <Zap className="w-6 h-6 text-emerald-400" />
            )}
            {viewMode === "LIVE" ? "Live Market Data" : "Strategy Detection Engine"}
          </h2>
          <p className="text-sm text-slate-400">
            {viewMode === "LIVE"
              ? "Real-time frontend market feed. Zero backend dependencies."
              : "Frontend algorithm detecting Liquidity Sweeps on BTC/USD."}
          </p>
        </div>

        <div className="flex flex-col gap-3 items-end">
          {/* Mode Switcher */}
          <div className="flex bg-slate-900/80 p-1 rounded-xl border border-slate-800/80 shadow-inner">
            <button
              onClick={() => setViewMode("LIVE")}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${
                viewMode === "LIVE"
                  ? "bg-cyan-500/10 text-cyan-400 shadow-sm border border-cyan-500/20"
                  : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/50 border border-transparent"
              }`}
            >
              <Activity className="w-4 h-4" />
              Live Feed
            </button>
            <button
              onClick={() => setViewMode("STRATEGY")}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${
                viewMode === "STRATEGY"
                  ? "bg-emerald-500/10 text-emerald-400 shadow-sm border border-emerald-500/20"
                  : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/50 border border-transparent"
              }`}
            >
              <Zap className="w-4 h-4" />
              Strategy Engine
            </button>
          </div>

          {/* Instrument Switcher (Only in Live Mode) */}
          {viewMode === "LIVE" && (
            <div className="flex bg-slate-900/80 p-1 rounded-xl border border-slate-800/80 shadow-inner">
              <button
                onClick={() => setActiveSymbol("OANDA:XAUUSD")}
                className={`flex items-center gap-2 px-4 py-1.5 rounded-lg text-sm font-medium transition-all duration-200 ${
                  activeSymbol === "OANDA:XAUUSD"
                    ? "bg-amber-500/10 text-amber-400 shadow-sm border border-amber-500/20"
                    : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/50 border border-transparent"
                }`}
              >
                <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                XAU/USD
              </button>
              <button
                onClick={() => setActiveSymbol("BINANCE:BTCUSD")}
                className={`flex items-center gap-2 px-4 py-1.5 rounded-lg text-sm font-medium transition-all duration-200 ${
                  activeSymbol === "BINANCE:BTCUSD"
                    ? "bg-orange-500/10 text-orange-400 shadow-sm border border-orange-500/20"
                    : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/50 border border-transparent"
                }`}
              >
                <Bitcoin className="w-4 h-4" />
                BTC/USD
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Chart Area */}
      <div className="w-full relative h-[500px]">
        {viewMode === "LIVE" ? (
          <TradingViewChart symbol={activeSymbol} />
        ) : (
          <StrategyChart />
        )}
      </div>

      {/* Paper Trading Panel — self-contained price fetch via LIVE PRICE button */}
      <PaperTradingPanel
        currentSymbol={currentDisplaySymbol}
      />

      {/* Open Positions */}
      <OpenPositionsTable />

      {/* Pending Limit Orders */}
      <PendingOrdersPanel />
    </div>
  );
}
