"use client";

import React, { useState } from "react";
import { useTrades } from "../../context/TradeContext";
import {
  calculateDashboardMetrics,
  calculateTodayPnL,
  getOpenTrades,
  formatCurrency,
  formatPercent,
} from "../../lib/calculations";
import {
  Wallet,
  TrendingUp,
  TrendingDown,
  RotateCcw,
  AlertTriangle,
  Clock,
  PieChart,
  ShieldAlert,
  CalendarDays,
  X,
} from "lucide-react";

export default function AccountPanelCard() {
  const { trades, startingCapital, resetAccount } = useTrades();
  const [showResetModal, setShowResetModal] = useState(false);

  // Compute Account Metrics
  const metrics = calculateDashboardMetrics(trades, startingCapital);
  const todayPnL = calculateTodayPnL(trades);
  const openTradesCount = getOpenTrades(trades).length;

  const handleConfirmReset = () => {
    resetAccount();
    setShowResetModal(false);
  };

  return (
    <div className="p-6 rounded-2xl bg-gradient-to-br from-slate-900/90 to-slate-950/90 border border-slate-800/80 shadow-2xl space-y-6 relative overflow-hidden">
      {/* Background Accent Glow */}
      <div className="absolute top-0 right-0 w-64 h-64 bg-cyan-500/5 rounded-full blur-3xl pointer-events-none" />

      {/* Header & Reset Button */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-slate-800/80 pb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center text-cyan-400">
            <Wallet className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-bold text-slate-100 font-sans tracking-tight">
                Simulated Trading Account
              </h2>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-mono font-medium">
                Paper Trading
              </span>
            </div>
            <p className="text-xs text-slate-400 font-mono">
              100% Client-Side LocalStorage Account
            </p>
          </div>
        </div>

        {/* Reset Account Button */}
        <button
          onClick={() => setShowResetModal(true)}
          className="flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-mono font-semibold bg-rose-500/10 text-rose-400 hover:bg-rose-500/20 border border-rose-500/20 transition-all duration-150"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          Reset $500 Account
        </button>
      </div>

      {/* 8 Account Metrics Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
        {/* 1. Starting Balance */}
        <div className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-800/60 space-y-1">
          <span className="text-[11px] text-slate-400 font-mono flex items-center gap-1.5">
            <Wallet className="w-3.5 h-3.5 text-slate-400" />
            Starting Balance
          </span>
          <div className="text-base sm:text-lg font-bold text-slate-200 font-mono">
            {formatCurrency(metrics.startingCapital)}
          </div>
        </div>

        {/* 2. Current Balance */}
        <div className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-800/60 space-y-1">
          <span className="text-[11px] text-slate-400 font-mono flex items-center gap-1.5">
            <TrendingUp className="w-3.5 h-3.5 text-cyan-400" />
            Current Balance
          </span>
          <div className="text-base sm:text-lg font-bold text-cyan-400 font-mono">
            {formatCurrency(metrics.currentCapital)}
          </div>
        </div>

        {/* 3. Total P/L */}
        <div className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-800/60 space-y-1">
          <span className="text-[11px] text-slate-400 font-mono flex items-center gap-1.5">
            {metrics.netPnL >= 0 ? (
              <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
            ) : (
              <TrendingDown className="w-3.5 h-3.5 text-rose-400" />
            )}
            Total P/L
          </span>
          <div
            className={`text-base sm:text-lg font-bold font-mono ${
              metrics.netPnL >= 0 ? "text-emerald-400" : "text-rose-400"
            }`}
          >
            {formatCurrency(metrics.netPnL, true)}
          </div>
        </div>

        {/* 4. Today P/L */}
        <div className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-800/60 space-y-1">
          <span className="text-[11px] text-slate-400 font-mono flex items-center gap-1.5">
            <CalendarDays className="w-3.5 h-3.5 text-amber-400" />
            Today P/L
          </span>
          <div
            className={`text-base sm:text-lg font-bold font-mono ${
              todayPnL >= 0 ? "text-emerald-400" : "text-rose-400"
            }`}
          >
            {formatCurrency(todayPnL, true)}
          </div>
        </div>

        {/* 5. Total Trades */}
        <div className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-800/60 space-y-1">
          <span className="text-[11px] text-slate-400 font-mono flex items-center gap-1.5">
            <PieChart className="w-3.5 h-3.5 text-slate-400" />
            Total Trades
          </span>
          <div className="text-base sm:text-lg font-bold text-slate-200 font-mono">
            {metrics.totalTrades}
          </div>
        </div>

        {/* 6. Open Trades */}
        <div className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-800/60 space-y-1">
          <span className="text-[11px] text-slate-400 font-mono flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5 text-cyan-400" />
            Open Trades
          </span>
          <div className="text-base sm:text-lg font-bold text-cyan-300 font-mono">
            {openTradesCount}
          </div>
        </div>

        {/* 7. Win Rate */}
        <div className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-800/60 space-y-1">
          <span className="text-[11px] text-slate-400 font-mono flex items-center gap-1.5">
            <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
            Win Rate
          </span>
          <div className="text-base sm:text-lg font-bold text-emerald-400 font-mono">
            {formatPercent(metrics.winRate)}
          </div>
        </div>

        {/* 8. Max Drawdown */}
        <div className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-800/60 space-y-1">
          <span className="text-[11px] text-slate-400 font-mono flex items-center gap-1.5">
            <ShieldAlert className="w-3.5 h-3.5 text-rose-400" />
            Max Drawdown
          </span>
          <div className="text-base sm:text-lg font-bold text-rose-400 font-mono">
            {formatCurrency(metrics.maxDrawdown)} ({metrics.maxDrawdownPercentage.toFixed(1)}%)
          </div>
        </div>
      </div>

      {/* Confirmation Dialog Modal for Reset */}
      {showResetModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
          <div className="w-full max-w-md p-6 rounded-2xl bg-[#0d1322] border border-slate-800 shadow-2xl space-y-5">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2 text-rose-400 font-bold text-base font-sans">
                <AlertTriangle className="w-5 h-5" />
                <span>Reset $500 Account?</span>
              </div>
              <button
                onClick={() => setShowResetModal(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-sm text-slate-300 font-sans leading-relaxed">
              Are you sure you want to reset your paper trading account? This action will:
            </p>

            <ul className="text-xs font-mono text-slate-400 space-y-1.5 list-disc pl-5">
              <li>Clear all recorded trade journal history from localStorage</li>
              <li>Reset your account starting balance back to <strong className="text-emerald-400">$500.00</strong></li>
              <li>Reset your Current Balance and P/L back to zero</li>
            </ul>

            <div className="flex items-center justify-end gap-3 pt-3">
              <button
                onClick={() => setShowResetModal(false)}
                className="px-4 py-2 rounded-xl text-xs font-mono font-medium text-slate-300 hover:bg-slate-800 border border-slate-700"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmReset}
                className="px-4 py-2 rounded-xl text-xs font-mono font-bold bg-rose-600 text-white hover:bg-rose-500 shadow-lg shadow-rose-600/20"
              >
                Confirm Reset ($500)
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
