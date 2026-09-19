"use client";

import React, { useState, useEffect } from "react";
import IMHeader from "./IMHeader";
import IMStatusBadge from "./IMStatusBadge";
import { CheckCircle2, XCircle, RefreshCw, ShieldAlert, Zap } from "lucide-react";

export default function IMCurrentSignal() {
  const [signalData, setSignalData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const fetchSignal = async () => {
    try {
      setLoading(true);
      const res = await fetch("http://localhost:4000/api/indian/signal");
      if (res.ok) {
        const data = await res.json();
        if (data.success && data.signal) {
          setSignalData(data.signal);
        }
      }
    } catch {
      // API fallback
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSignal();
  }, []);

  const isReady = signalData?.status === "READY";
  
  const getStrategyStatus = () => {
    if (!signalData) return "WAIT";
    if (isReady) return "ACTIVE";
    const reasons = signalData.reasons || [];
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
              strategyStatus === "BLOCKED" ? "text-rose-400 font-bold" : "text-amber-400 font-bold"
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

      {/* Main Signal Panel */}
      {isReady && signalData ? (
        <div className="p-6 rounded-2xl bg-emerald-500/5 border border-emerald-500/30 space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-emerald-500/20 pb-4">
            <div className="flex items-center gap-3">
              <div className="text-2xl font-black text-slate-100 font-mono tracking-tighter">
                NIFTY Spot @ ₹{signalData.spotPrice}
              </div>
              <IMStatusBadge status={signalData.regime} size="md" pulse />
            </div>

            <div className="flex items-center gap-3 font-mono text-xs text-slate-400">
              <span>Expiry: <strong className="text-slate-200">{signalData.expiry}</strong></span>
              <span>•</span>
              <span>Lots: <strong className="text-cyan-400">{signalData.quantityLots}</strong> ({signalData.totalQuantity} Qty)</span>
            </div>
          </div>

          {/* Key Metrics Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="px-4 py-3 rounded-xl bg-slate-900/60 border border-slate-800">
              <div className="text-[9px] font-mono text-slate-500 uppercase tracking-wider mb-1">
                Strategy Action
              </div>
              <div className="text-sm font-bold font-mono text-emerald-400">
                {signalData.action.replace(/_/g, " ")}
              </div>
            </div>

            <div className="px-4 py-3 rounded-xl bg-slate-900/60 border border-slate-800">
              <div className="text-[9px] font-mono text-slate-500 uppercase tracking-wider mb-1">
                Setup Score
              </div>
              <div className="text-sm font-bold font-mono text-cyan-400">
                {signalData.score} / 100
              </div>
            </div>

            <div className="px-4 py-3 rounded-xl bg-slate-900/60 border border-slate-800">
              <div className="text-[9px] font-mono text-slate-500 uppercase tracking-wider mb-1">
                Risk / Reward
              </div>
              <div className="text-sm font-bold font-mono text-emerald-400">
                1 : {signalData.rewardRiskRatio}
              </div>
            </div>

            <div className="px-4 py-3 rounded-xl bg-slate-900/60 border border-slate-800">
              <div className="text-[9px] font-mono text-slate-500 uppercase tracking-wider mb-1">
                Margin Required
              </div>
              <div className="text-sm font-bold font-mono text-amber-400">
                ₹{signalData.marginRequired?.toLocaleString() || "N/A"}
              </div>
            </div>
          </div>

          {/* Detailed Spread Strike Legs */}
          {signalData.sellLeg && signalData.buyLeg && (
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
                    <span>{signalData.sellLeg.optionType}</span>
                  </div>
                  <div className="text-slate-200">
                    Strike: ₹{signalData.sellLeg.strike} @ LTP ₹{signalData.sellLeg.ltp}
                  </div>
                  <div className="text-[10px] text-slate-400 flex gap-3">
                    <span>Delta: {signalData.sellLeg.delta || "N/A"}</span>
                    <span>IV: {signalData.sellLeg.iv ? (signalData.sellLeg.iv * 100).toFixed(1) + "%" : "N/A"}</span>
                  </div>
                </div>

                {/* BUY Hedge Leg */}
                <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 space-y-1">
                  <div className="flex items-center justify-between text-emerald-400 font-bold">
                    <span>BUY HEDGE LEG</span>
                    <span>{signalData.buyLeg.optionType}</span>
                  </div>
                  <div className="text-slate-200">
                    Strike: ₹{signalData.buyLeg.strike} @ LTP ₹{signalData.buyLeg.ltp}
                  </div>
                  <div className="text-[10px] text-slate-400 flex gap-3">
                    <span>Delta: {signalData.buyLeg.delta || "N/A"}</span>
                    <span>IV: {signalData.buyLeg.iv ? (signalData.buyLeg.iv * 100).toFixed(1) + "%" : "N/A"}</span>
                  </div>
                </div>
              </div>

              {/* Financial Breakdown Table */}
              <div className="grid grid-cols-2 sm:grid-cols-6 gap-2 text-[11px] text-slate-300 pt-3 border-t border-slate-800">
                <div>
                  <span className="block text-[9px] text-slate-500">Entry Credit</span>
                  <span className="font-bold text-emerald-400">₹{signalData.entryCredit}</span>
                </div>
                <div>
                  <span className="block text-[9px] text-slate-500">Max Profit</span>
                  <span className="font-bold text-emerald-400">₹{signalData.maxProfit}</span>
                </div>
                <div>
                  <span className="block text-[9px] text-slate-500">Max Loss</span>
                  <span className="font-bold text-rose-400">₹{signalData.maxLoss}</span>
                </div>
                <div>
                  <span className="block text-[9px] text-slate-500">Stop Loss</span>
                  <span className="font-bold text-slate-200">Spread ₹{signalData.stopLossSpread}</span>
                </div>
                <div>
                  <span className="block text-[9px] text-slate-500">Target</span>
                  <span className="font-bold text-slate-200">Spread ₹{signalData.targetSpread}</span>
                </div>
                <div>
                  <span className="block text-[9px] text-slate-500">Charges & Tax</span>
                  <span className="font-bold text-amber-400">₹{signalData.charges?.totalCharges || 0}</span>
                </div>
              </div>

              <div className="flex items-center justify-between text-xs pt-2 border-t border-slate-800 text-slate-300">
                <span>Expected Net P&L (After Slippage & Taxes):</span>
                <strong className="text-emerald-400 text-sm">₹{signalData.expectedNetPnl}</strong>
              </div>
            </div>
          )}

          {/* Rationale & Reasons */}
          <div className="space-y-2">
            <div className="text-[9px] text-slate-500 font-mono uppercase tracking-widest">
              Signal Rationale & System Audits
            </div>
            {signalData.reasons.map((r: string, idx: number) => (
              <div key={idx} className="flex items-center gap-2 text-xs font-mono text-emerald-300">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                {r}
              </div>
            ))}
          </div>
        </div>
      ) : (
        /* NO TRADE / WAIT / BLOCKED Panel */
        <div className="p-6 rounded-2xl bg-slate-900/60 border border-slate-800 space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="text-2xl font-black text-slate-100 font-mono tracking-tighter">
                NIFTY Spot @ ₹{signalData?.spotPrice || "24,700"}
              </div>
              <IMStatusBadge status={signalData?.status || "NO TRADE"} size="md" />
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
            {signalData?.reasons && signalData.reasons.length > 0 ? (
              signalData.reasons.map((r: string, idx: number) => (
                <div key={idx} className="flex items-center gap-2 text-xs font-mono text-rose-400">
                  <XCircle className="w-3.5 h-3.5 shrink-0 text-rose-400" />
                  {r}
                </div>
              ))
            ) : (
              <div className="text-xs font-mono text-slate-400">
                Market conditions do not fulfill defined-risk entry criteria. Stale data or regime filter active.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

