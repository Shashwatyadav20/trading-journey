"use client";

import React from "react";
import Link from "next/link";
import { Layers, Crosshair, LayoutDashboard } from "lucide-react";
import FOQuantDeskView from "@/components/indian-market/fo/FOQuantDeskView";

export default function IndianFOQuantDeskPage() {
  return (
    <div className="min-h-screen bg-[#090d16] text-slate-100 p-4 sm:p-6 max-w-7xl mx-auto space-y-5 font-mono">
      {/* Top-Level Institutional Desk Navigation Switcher */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 rounded-2xl bg-[#0d1322]/95 border border-slate-800/80 shadow-lg">
        <div className="flex items-center gap-2">
          <Link
            href="/"
            className="px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 text-xs font-bold flex items-center gap-1.5 transition-colors"
          >
            <LayoutDashboard className="w-3.5 h-3.5 text-cyan-400" />
            <span>Main Terminal</span>
          </Link>
          <span className="text-slate-700">/</span>
          <Link
            href="/indian/swing"
            className="px-3.5 py-1.5 rounded-xl bg-slate-900/90 hover:bg-slate-800 text-slate-300 border border-slate-800 text-xs font-bold flex items-center gap-1.5 transition-colors"
          >
            <Crosshair className="w-3.5 h-3.5 text-emerald-400" />
            <span>Cash Equity Swing Screener</span>
          </Link>
          <div className="px-3.5 py-1.5 rounded-xl bg-gradient-to-r from-violet-600/30 to-cyan-600/30 text-violet-200 border border-violet-500/50 text-xs font-bold flex items-center gap-1.5 shadow-sm">
            <Layers className="w-3.5 h-3.5 text-violet-300" />
            <span>F&O Quant Desk (Isolated)</span>
          </div>
        </div>

        <div className="text-[11px] text-slate-400">
          Index &amp; Stock Derivatives · Purple Box Spreads · Option Chain &amp; Greeks · Payoff Simulator
        </div>
      </div>

      {/* Main Isolated F&O Quant Desk View */}
      <FOQuantDeskView />
    </div>
  );
}

