"use client";

import React from "react";
import IMHeader from "./IMHeader";
import IMStatusBadge from "./IMStatusBadge";

type Decision = "TRADE" | "WAIT" | "NO TRADE" | "BLOCKED";

function InfoRow({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-slate-800/40 last:border-0">
      <span className="text-[10px] text-slate-500 font-mono uppercase tracking-wider">{label}</span>
      <span className={`text-xs font-mono font-semibold ${accent || "text-slate-200"}`}>{value}</span>
    </div>
  );
}

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="p-4 rounded-xl bg-[#11192e]/80 border border-slate-800/80 space-y-1">
      <div className="text-[9px] font-mono font-bold text-slate-600 uppercase tracking-widest pb-2 border-b border-slate-800/60">
        {title}
      </div>
      {children}
    </div>
  );
}

const DECISION: Decision = "TRADE";
const DECISION_REASON = "15M and 1H trends are aligned above VWAP. IV Percentile is below 30th percentile. Liquidity is adequate. Setup is valid.";

const DECISION_STYLES: Record<Decision, string> = {
  TRADE: "bg-emerald-500/15 border-emerald-500/30 text-emerald-400",
  WAIT: "bg-amber-500/15 border-amber-500/30 text-amber-400",
  "NO TRADE": "bg-slate-800/60 border-slate-700/50 text-slate-400",
  BLOCKED: "bg-rose-500/15 border-rose-500/30 text-rose-400",
};

export default function IMMarketAnalysis() {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div>
          <h2 className="text-xl font-bold text-slate-100 tracking-tight">MARKET ANALYSIS</h2>
          <p className="text-xs text-slate-400 font-mono">Multi-timeframe analysis · All values DEMO / MOCK</p>
        </div>
        <IMStatusBadge status="DEMO" size="sm" />
      </div>

      <IMHeader />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Trend Analysis */}
        <SectionCard title="TREND ANALYSIS">
          <InfoRow label="1H Trend" value="UPTREND" accent="text-emerald-400" />
          <InfoRow label="15M Trend" value="UPTREND" accent="text-emerald-400" />
          <InfoRow label="Market Structure" value="HH / HL Sequence" accent="text-emerald-400" />
          <InfoRow label="Momentum" value="BULLISH" accent="text-emerald-400" />
          <InfoRow label="VWAP" value="Price above VWAP" accent="text-emerald-400" />
        </SectionCard>

        {/* Volatility */}
        <SectionCard title="VOLATILITY">
          <InfoRow label="ATR (14)" value="87.40" />
          <InfoRow label="IV" value="13.2%" />
          <InfoRow label="IV Percentile" value="28th" accent="text-emerald-400" />
          <InfoRow label="Expected Move" value="±142 pts (daily)" />
          <InfoRow label="Volatility Regime" value="LOW" accent="text-emerald-400" />
        </SectionCard>

        {/* Support / Resistance */}
        <SectionCard title="SUPPORT / RESISTANCE">
          <InfoRow label="Prev. Day High" value="24,793" accent="text-rose-400" />
          <InfoRow label="Prev. Day Low" value="24,492" accent="text-emerald-400" />
          <InfoRow label="Prev. Close" value="24,576.95" />
          <InfoRow label="Prev. Week High" value="24,890" accent="text-rose-400" />
          <InfoRow label="Prev. Week Low" value="24,210" accent="text-emerald-400" />
          <InfoRow label="1H Swing High" value="24,820" accent="text-rose-400" />
          <InfoRow label="1H Swing Low" value="24,540" accent="text-emerald-400" />
          <InfoRow label="15M Swing High" value="24,742" accent="text-rose-400" />
          <InfoRow label="15M Swing Low" value="24,620" accent="text-emerald-400" />
          <InfoRow label="VWAP" value="24,648.30" accent="text-violet-400" />
        </SectionCard>
      </div>

      {/* Final Market Decision */}
      <div className={`p-6 rounded-2xl border ${DECISION_STYLES[DECISION]} space-y-4`}>
        <div className="flex items-center gap-3">
          <span className="text-[10px] font-mono font-bold uppercase tracking-widest text-slate-500">
            FINAL MARKET DECISION
          </span>
          <span
            className={`px-3 py-1 rounded font-mono font-bold text-sm border ${DECISION_STYLES[DECISION]}`}
          >
            {DECISION}
          </span>
        </div>
        <p className="text-sm text-slate-300 font-mono leading-relaxed">{DECISION_REASON}</p>
        <div className="text-[9px] text-slate-600 font-mono">
          ⚠ DEMO DATA — Decision engine not yet connected to live market data.
        </div>
      </div>
    </div>
  );
}
