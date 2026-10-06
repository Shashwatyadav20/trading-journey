"use client";

import React, { useState, useEffect } from "react";
import IMHeader from "./IMHeader";
import IMStatusBadge from "./IMStatusBadge";
import { CheckCircle2, XCircle, RefreshCw, ShieldAlert, Zap, WifiOff } from "lucide-react";
import { apiUrl } from "../../lib/backendUrl";

export default function IMCurrentSignal() {
  const [signalData, setSignalData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [backendError, setBackendError] = useState<string | null>(null);

  const fetchSignal = async () => {
    try {
      setLoading(true);
      const res = await fetch(apiUrl("/api/indian/signal"), { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        if (data.success && data.signal) {
          setSignalData(data);
          setBackendError(null);
        }
      } else {
        setBackendError(`HTTP ${res.status}: ${res.statusText}`);
      }
    } catch (err: unknown) {
      setBackendError(err instanceof Error ? err.message : "Backend unreachable");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSignal();
    const interval = setInterval(fetchSignal, 15000);
    return () => clearInterval(interval);
  }, []);

  const sig = signalData?.signal;
  const isReady = sig?.status === "READY";

  const getStrategyStatus = () => {
    if (backendError) return "DISCONNECTED";
    if (!sig) return "WAIT";
    if (isReady) return "ACTIVE";
    const reasons = sig.reasons || [];
    if (reasons.some((r: string) => r.includes("Stale") || r.includes("Error") || r.includes("BLOCKED") || r.includes("limit"))) {
      return "BLOCKED";
    }
    return "WAIT";
  };

  const strategyStatus = getStrategyStatus();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div>
            <h2 className="text-xl font-bold text-slate-100 tracking-tight flex items-center gap-2">
              <Zap className="w-5 h-5 text-amber-400" />
              CURRENT SIGNAL & STRATEGY AUDIT
            </h2>
            <p className="text-xs text-slate-400 font-mono">
              NIFTY Hedged Options Engine • Defined-Risk Auto-Hedge
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-900 border border-slate-800 text-xs font-mono">
            <span className="text-slate-500">STRATEGY:</span>
            <span className={
              strategyStatus === "ACTIVE" ? "text-emerald-400 font-bold" :
              strategyStatus === "BLOCKED" ? "text-rose-400 font-bold" :
              strategyStatus === "DISCONNECTED" ? "text-rose-400 font-bold" : "text-amber-400 font-bold"
            }>
              {strategyStatus}
            </span>
          </div>

          <button
            onClick={fetchSignal}
            className="p-2 rounded-xl bg-slate-900 border border-slate-800 text-slate-400 hover:text-slate-100 transition-colors"
            title="Refresh Signal"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin text-cyan-400" : ""}`} />
          </button>
        </div>
      </div>

      <IMHeader />

      {/* Backend disconnected guard — show prominently, never show demo data */}
      {backendError && (
        <div className="p-5 rounded-2xl border border-rose-500/30 bg-rose-500/5 flex items-start gap-3">
          <WifiOff className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <div className="text-sm font-bold text-rose-400 font-mono uppercase tracking-widest">BACKEND DISCONNECTED</div>
            <div className="text-[10px] text-slate-500 font-mono">{backendError}</div>
            <div className="text-[10px] text-slate-600 font-mono">
              Check that <span className="text-amber-400">NEXT_PUBLIC_BACKEND_URL</span> is set and the Render backend is reachable.
            </div>
          </div>
        </div>
      )}

      {/* Main Signal Panel — only render when backend is reachable */}
      {!backendError && isReady && sig ? (
        <div className="p-6 rounded-2xl bg-emerald-500/5 border border-emerald-500/30 space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-emerald-500/20 pb-4">
            <div className="flex items-center gap-3">
              <div className="text-2xl font-black text-slate-100 font-mono tracking-tighter">
                NIFTY Spot @ ₹{sig.spotPrice}
              </div>
              <IMStatusBadge status={sig.regime} size="md" pulse />
            </div>

            <div className="flex items-center gap-3 font-mono text-xs text-slate-400">
              <span>Expiry: <strong className="text-slate-200">{sig.expiry}</strong></span>
              <span>•</span>
              <span>Lots: <strong className="text-cyan-400">{sig.quantityLots}</strong> ({sig.totalQuantity} Qty)</span>
            </div>
          </div>

          {/* Key Metrics Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="px-4 py-3 rounded-xl bg-slate-900/60 border border-slate-800">
              <div className="text-[9px] font-mono text-slate-500 uppercase tracking-wider mb-1">
                Strategy Action
              </div>
              <div className="text-sm font-bold font-mono text-emerald-400">
                {sig.action.replace(/_/g, " ")}
              </div>
            </div>

            <div className="px-4 py-3 rounded-xl bg-slate-900/60 border border-slate-800">
              <div className="text-[9px] font-mono text-slate-500 uppercase tracking-wider mb-1">
                Setup Score
              </div>
              <div className="text-sm font-bold font-mono text-cyan-400">
                {sig.score} / 100
              </div>
            </div>

            <div className="px-4 py-3 rounded-xl bg-slate-900/60 border border-slate-800">
              <div className="text-[9px] font-mono text-slate-500 uppercase tracking-wider mb-1">
                Risk / Reward
              </div>
              <div className="text-sm font-bold font-mono text-emerald-400">
                1 : {sig.rewardRiskRatio}
              </div>
            </div>

            <div className="px-4 py-3 rounded-xl bg-slate-900/60 border border-slate-800">
              <div className="text-[9px] font-mono text-slate-500 uppercase tracking-wider mb-1">
                Margin Required
              </div>
              <div className="text-sm font-bold font-mono text-amber-400">
                ₹{sig.marginRequired?.toLocaleString() || "N/A"}
              </div>
            </div>
          </div>

          {/* Detailed Spread Strike Legs */}
          {sig.sellLeg && sig.buyLeg && (
            <div className="p-5 rounded-xl bg-slate-900/80 border border-slate-800 space-y-4 font-mono text-xs">
              <div className="flex items-center justify-between text-[10px] text-slate-400 uppercase tracking-wider">
                <span>Multi-Leg Spread Structure</span>
                <span className="text-emerald-400 font-bold">DEFINED RISK HEDGE</span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {/* SELL Short Leg */}
                <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 space-y-1">
                  <div className="flex items-center justify-between text-rose-400 font-bold">
                    <span>SELL SHORT LEG</span>
                    <span>{sig.sellLeg.optionType}</span>
                  </div>
                  <div className="text-slate-200">
                    Strike: ₹{sig.sellLeg.strike} @ LTP ₹{sig.sellLeg.ltp}
                  </div>
                  <div className="text-[10px] text-slate-400 flex gap-3">
                    <span>Delta: {sig.sellLeg.delta || "N/A"}</span>
                    <span>IV: {sig.sellLeg.iv ? (sig.sellLeg.iv * 100).toFixed(1) + "%" : "N/A"}</span>
                  </div>
                </div>

                {/* BUY Hedge Leg */}
                <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 space-y-1">
                  <div className="flex items-center justify-between text-emerald-400 font-bold">
                    <span>BUY HEDGE LEG</span>
                    <span>{sig.buyLeg.optionType}</span>
                  </div>
                  <div className="text-slate-200">
                    Strike: ₹{sig.buyLeg.strike} @ LTP ₹{sig.buyLeg.ltp}
                  </div>
                  <div className="text-[10px] text-slate-400 flex gap-3">
                    <span>Delta: {sig.buyLeg.delta || "N/A"}</span>
                    <span>IV: {sig.buyLeg.iv ? (sig.buyLeg.iv * 100).toFixed(1) + "%" : "N/A"}</span>
                  </div>
                </div>
              </div>

              {/* Financial Breakdown Table */}
              <div className="grid grid-cols-2 sm:grid-cols-6 gap-2 text-[11px] text-slate-300 pt-3 border-t border-slate-800">
                <div>
                  <span className="block text-[9px] text-slate-500">Entry Credit</span>
                  <span className="font-bold text-emerald-400">₹{sig.netCredit}</span>
                </div>
                <div>
                  <span className="block text-[9px] text-slate-500">Max Profit</span>
                  <span className="font-bold text-emerald-400">₹{sig.maxProfit}</span>
                </div>
                <div>
                  <span className="block text-[9px] text-slate-500">Max Loss</span>
                  <span className="font-bold text-rose-400">₹{sig.maxLoss}</span>
                </div>
                <div>
                  <span className="block text-[9px] text-slate-500">Stop Loss</span>
                  <span className="font-bold text-slate-200">Spread ₹{sig.stopLossSpread}</span>
                </div>
                <div>
                  <span className="block text-[9px] text-slate-500">Target</span>
                  <span className="font-bold text-slate-200">Spread ₹{sig.targetSpread}</span>
                </div>
                <div>
                  <span className="block text-[9px] text-slate-500">Charges & Tax</span>
                  <span className="font-bold text-amber-400">₹{sig.charges?.totalCharges || 0}</span>
                </div>
              </div>

              <div className="flex items-center justify-between text-xs pt-2 border-t border-slate-800 text-slate-300">
                <span>Expected Net P&L (After Slippage & Taxes):</span>
                <strong className="text-emerald-400 text-sm">₹{sig.expectedNetPnl}</strong>
              </div>
            </div>
          )}

          {/* Rationale & Reasons */}
          <div className="space-y-2">
            <div className="text-[9px] text-slate-500 font-mono uppercase tracking-widest">
              Signal Rationale & System Audits
            </div>
            {sig.reasons.map((r: string, idx: number) => (
              <div key={idx} className="flex items-center gap-2 text-xs font-mono text-emerald-300">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                {r}
              </div>
            ))}
          </div>
        </div>
      ) : (
        /* NO TRADE / WAIT / BLOCKED Panel — only when backend is connected */
        !backendError && (
        <div className="p-6 rounded-2xl bg-slate-900/60 border border-slate-800 space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="text-2xl font-black text-slate-100 font-mono tracking-tighter">
                {sig?.spotPrice ? `NIFTY Spot @ ₹${sig.spotPrice}` : "NO SIGNAL — DATA UNAVAILABLE"}
              </div>
              <IMStatusBadge status={sig?.status || "NO TRADE"} size="md" />
            </div>

            <div className="flex items-center gap-2 text-xs font-mono text-slate-400">
              <ShieldAlert className="w-4 h-4 text-amber-400" />
              Status: <span className="font-bold text-amber-400">{strategyStatus}</span>
            </div>
          </div>

          <div className="space-y-2">
            <div className="text-[9px] text-slate-500 font-mono uppercase tracking-widest">
              System Audit Diagnostics & Block Reasons
            </div>
            {sig?.reasons && sig.reasons.length > 0 ? (
              sig.reasons.map((r: string, idx: number) => (
                <div key={idx} className="flex items-center gap-2 text-xs font-mono text-rose-400">
                  <XCircle className="w-3.5 h-3.5 shrink-0 text-rose-400" />
                  {r}
                </div>
              ))
            ) : (
              <div className="text-xs font-mono text-slate-400">
                {loading ? "Fetching signal from backend…" : "No rejection reasons returned by backend."}
              </div>
            )}
          </div>
        </div>
        )
      )}
    </div>
  );
}

