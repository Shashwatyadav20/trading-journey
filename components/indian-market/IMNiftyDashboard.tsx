"use client";

import React, { useState } from "react";
import IMHeader from "./IMHeader";
import IMStatusBadge from "./IMStatusBadge";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

// MOCK chart data
const MOCK_CANDLES = Array.from({ length: 48 }, (_, i) => {
  const base = 24500 + Math.sin(i / 5) * 150 + i * 4.5;
  return {
    time: `${String(9 + Math.floor(i / 4)).padStart(2, "0")}:${String((i % 4) * 15).padStart(2, "0")}`,
    close: Math.round(base * 100) / 100,
    high: Math.round((base + Math.random() * 30) * 100) / 100,
    low: Math.round((base - Math.random() * 30) * 100) / 100,
  };
});

const TF_OPTIONS = ["5M", "15M", "1H"] as const;

function InfoRow({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-slate-800/40 last:border-0">
      <span className="text-[10px] text-slate-500 font-mono uppercase tracking-wider">{label}</span>
      <span className={`text-xs font-mono font-semibold ${accent || "text-slate-200"}`}>{value}</span>
    </div>
  );
}

function InfoSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="p-4 rounded-xl bg-[#11192e]/80 border border-slate-800/80 space-y-0.5">
      <div className="text-[9px] font-mono font-bold text-slate-600 uppercase tracking-widest pb-2 border-b border-slate-800/60">
        {title}
      </div>
      {children}
    </div>
  );
}

export default function IMNiftyDashboard() {
  const [tf, setTf] = useState<(typeof TF_OPTIONS)[number]>("15M");

  return (
    <div className="space-y-6">
      {/* Page title */}
      <div className="flex items-center gap-3">
        <div>
          <h2 className="text-xl font-bold text-slate-100 tracking-tight">NIFTY DASHBOARD</h2>
          <p className="text-xs text-slate-400 font-mono">Real-time overview · All values DEMO / MOCK</p>
        </div>
        <IMStatusBadge status="DEMO" size="sm" />
      </div>

      <IMHeader />

      {/* Summary strip */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {[
          { l: "NIFTY Spot", v: "24,700.45", c: "text-slate-100" },
          { l: "Change", v: "+123.50 (+0.50%)", c: "text-emerald-400" },
          { l: "Market Status", v: "MARKET OPEN", c: "text-emerald-400" },
          { l: "Expiry", v: "26 Sep 2026", c: "text-amber-300" },
          { l: "Regime", v: "BULLISH", c: "text-emerald-400" },
          { l: "Strategy Score", v: "86 / 100", c: "text-cyan-400" },
        ].map((d) => (
          <div key={d.l} className="p-3 rounded-xl bg-[#11192e]/80 border border-slate-800/80">
            <div className="text-[9px] text-slate-500 font-mono uppercase tracking-wider mb-1">{d.l}</div>
            <div className={`text-sm font-bold font-mono ${d.c}`}>{d.v}</div>
          </div>
        ))}
      </div>

      {/* Chart + TF selector */}
      <div className="p-5 rounded-2xl bg-[#0d1322]/90 border border-slate-800/80 space-y-4">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold text-slate-300 font-mono uppercase tracking-wider">
            NIFTY Price Chart
          </span>
          <div className="flex items-center gap-1.5 bg-slate-900/80 rounded-lg p-1 border border-slate-800/60">
            {TF_OPTIONS.map((t) => (
              <button
                key={t}
                onClick={() => setTf(t)}
                className={`px-3 py-1 rounded text-[10px] font-mono font-bold transition-colors ${
                  tf === t
                    ? "bg-cyan-500/20 text-cyan-400 border border-cyan-500/30"
                    : "text-slate-500 hover:text-slate-300"
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={MOCK_CANDLES} margin={{ left: -10, right: 8, top: 4, bottom: 0 }}>
              <defs>
                <linearGradient id="niftyGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#06b6d4" stopOpacity={0.25} />
                  <stop offset="95%" stopColor="#06b6d4" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis dataKey="time" tick={{ fill: "#64748b", fontSize: 9 }} />
              <YAxis
                domain={["auto", "auto"]}
                tick={{ fill: "#64748b", fontSize: 9 }}
                tickFormatter={(v) => v.toLocaleString("en-IN")}
              />
              <Tooltip
                contentStyle={{ background: "#0d1322", border: "1px solid #1e293b", borderRadius: 8, fontSize: 10, fontFamily: "monospace" }}
                labelStyle={{ color: "#64748b" }}
                itemStyle={{ color: "#06b6d4" }}
              />
              <Area type="monotone" dataKey="close" stroke="#06b6d4" strokeWidth={1.5} fill="url(#niftyGrad)" dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className="text-[9px] text-slate-600 font-mono text-center">
          ⚠ DEMO DATA — Not connected to live market feed
        </div>
      </div>

      {/* Bottom info grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <InfoSection title="MARKET STRUCTURE">
          <InfoRow label="Trend" value="UPTREND" accent="text-emerald-400" />
          <InfoRow label="Higher High" value="24,820" />
          <InfoRow label="Higher Low" value="24,580" />
          <InfoRow label="Lower High" value="—" accent="text-slate-600" />
          <InfoRow label="Lower Low" value="—" accent="text-slate-600" />
        </InfoSection>

        <InfoSection title="INDICATORS">
          <InfoRow label="VWAP" value="24,648.30" accent="text-violet-400" />
          <InfoRow label="ATR (14)" value="87.40" />
          <InfoRow label="ADX (14)" value="32.6" accent="text-cyan-400" />
        </InfoSection>

        <InfoSection title="VOLATILITY">
          <InfoRow label="IV" value="13.2%" />
          <InfoRow label="IV Percentile" value="28th" />
          <InfoRow label="Volatility Regime" value="LOW" accent="text-emerald-400" />
        </InfoSection>

        <InfoSection title="LEVELS">
          <InfoRow label="Support" value="24,580" accent="text-emerald-400" />
          <InfoRow label="Resistance" value="24,850" accent="text-rose-400" />
          <InfoRow label="Prev. Day High" value="24,793" />
          <InfoRow label="Prev. Day Low" value="24,492" />
          <InfoRow label="Prev. Close" value="24,576.95" />
        </InfoSection>

        <InfoSection title="CURRENT SIGNAL">
          <InfoRow label="Action" value="BULL PUT SPREAD" accent="text-emerald-400" />
          <InfoRow label="Strategy" value="HEDGED SPREAD" />
          <InfoRow label="Score" value="86 / 100" accent="text-cyan-400" />
          <InfoRow label="Confidence" value="HIGH" accent="text-emerald-400" />
          <InfoRow label="Reason" value="1H + 15M aligned, above VWAP" accent="text-slate-300" />
        </InfoSection>
      </div>
    </div>
  );
}
