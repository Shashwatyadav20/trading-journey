"use client";

import React from "react";
import {
  Target,
  Zap,
  TrendingUp,
  TrendingDown,
  Layers,
  Sparkles,
  ShieldCheck,
  Clock,
  ArrowUpRight,
  ArrowDownRight,
  Activity,
  CheckCircle2,
} from "lucide-react";
import { NSERetestAlert } from "../../lib/indian/institutionalSwingEngine";

interface IMLive4HOrderBlockRetestTickerProps {
  alerts: NSERetestAlert[];
  onDeploy: (alert: NSERetestAlert) => void;
  isScanning?: boolean;
}

export default function IMLive4HOrderBlockRetestTicker({
  alerts,
  onDeploy,
  isScanning = false,
}: IMLive4HOrderBlockRetestTickerProps) {
  if (!alerts || alerts.length === 0) {
    return (
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-[#0d1527] via-[#09101f] to-[#070b16] border border-cyan-500/20 p-4 shadow-xl">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center text-cyan-400">
              <Target className="w-5 h-5 animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold font-mono text-white tracking-wide">
                  🎯 Live 4H Order Block Retest Feed
                </span>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-cyan-500/10 text-cyan-400 border border-cyan-500/30 font-semibold flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-ping" />
                  SMC PRO+ Radar Active
                </span>
              </div>
              <p className="text-xs text-slate-400 font-sans mt-0.5">
                Monitoring liquid NSE universe against fixed 4H institutional Order Block boundaries...
              </p>
            </div>
          </div>

          <div className="text-xs font-mono text-slate-500 flex items-center gap-2">
            <Activity className="w-3.5 h-3.5 text-cyan-400 animate-spin" />
            <span>Scanning 4H Boundaries</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-[#0d162a] via-[#091122] to-[#070b16] border border-cyan-500/40 p-4 sm:p-5 shadow-2xl">
      <div className="absolute top-0 right-0 w-80 h-80 bg-cyan-500/5 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-0 left-1/4 w-72 h-72 bg-violet-500/5 rounded-full blur-3xl pointer-events-none" />

      {/* Header Bar */}
      <div className="relative flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pb-3 border-b border-cyan-500/20">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-cyan-600/30 to-violet-600/30 border border-cyan-400/40 flex items-center justify-center text-cyan-300 shadow-lg shadow-cyan-500/20">
            <Target className="w-5 h-5 text-cyan-300 animate-pulse" />
          </div>
          <div>
            <div className="flex items-center gap-2.5">
              <h2 className="text-sm sm:text-base font-bold font-mono text-white tracking-wide flex items-center gap-2">
                🎯 LIVE 4H ORDER BLOCK RETEST FEED
              </h2>
              <span className="text-[10px] font-mono px-2.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-300 border border-emerald-500/30 font-bold flex items-center gap-1.5 shadow-sm">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
                {alerts.length} Active {alerts.length === 1 ? "Retest" : "Retests"}
              </span>
            </div>
            <p className="text-xs text-slate-400 font-sans mt-0.5">
              TradingView SMC PRO+ Dual-HTF Signal Alert: Price currently mitigating unmitigated 4H Order Blocks
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 text-xs font-mono text-slate-400">
          <span className="hidden md:inline text-slate-500">Auto-Refreshed:</span>
          <span className="text-cyan-400 font-semibold">{alerts[0]?.retestDetectedAt || "Live"}</span>
        </div>
      </div>

      {/* Glowing Retest Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5 mt-4">
        {alerts.map((alert) => {
          const isBullish = alert.direction === "BULLISH";

          return (
            <div
              key={alert.id}
              className="relative rounded-xl bg-[#090f1d]/90 border border-cyan-500/30 hover:border-cyan-400/60 p-4 transition-all duration-200 shadow-xl flex flex-col justify-between group"
            >
              <div>
                {/* Top Strip */}
                <div className="flex items-center justify-between pb-2.5 border-b border-slate-800/80">
                  <div className="flex items-center gap-2.5">
                    <span className="text-base font-bold font-mono text-white tracking-wide">
                      {alert.cleanSymbol}
                    </span>
                    <span
                      className={`text-[10px] font-mono px-2 py-0.5 rounded font-bold uppercase tracking-wider flex items-center gap-1 ${
                        isBullish
                          ? "bg-emerald-500/10 text-emerald-300 border border-emerald-500/30"
                          : "bg-rose-500/10 text-rose-300 border border-rose-500/30"
                      }`}
                    >
                      {isBullish ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
                      4H {alert.direction} OB RETEST
                    </span>
                  </div>

                  <div className="text-right font-mono">
                    <span className="text-[10px] text-slate-400 uppercase block">Live LTP</span>
                    <span className="text-sm font-bold text-white">₹{alert.livePrice.toFixed(2)}</span>
                  </div>
                </div>

                {/* Subtitle & Badges */}
                <div className="flex flex-wrap items-center gap-1.5 my-2.5 text-xs font-mono">
                  <span className="text-slate-400 font-sans text-xs">{alert.companyName}</span>
                  <span className="text-slate-600">·</span>
                  <span className="px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-300 border border-blue-500/20 text-[10px] font-bold">
                    4H Fixed OB
                  </span>
                  <span
                    className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                      alert.quality === "Strong"
                        ? "bg-violet-500/10 text-violet-300 border border-violet-500/20"
                        : "bg-amber-500/10 text-amber-300 border border-amber-500/20"
                    }`}
                  >
                    {alert.quality} Quality
                  </span>
                  <span className="px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-[10px] font-bold flex items-center gap-0.5">
                    <CheckCircle2 className="w-2.5 h-2.5" /> {alert.confidenceTag} EMA20 Aligned
                  </span>
                </div>

                {/* Mitigation Zone & Parameter Grid */}
                <div className="grid grid-cols-3 gap-2 py-2 text-xs font-mono bg-slate-900/60 border border-slate-800/80 rounded-lg p-2.5">
                  <div>
                    <span className="text-[10px] text-slate-500 uppercase block">OB Zone Range</span>
                    <span className="font-bold text-cyan-300 text-xs">
                      ₹{alert.obMitigationRange.bottomPrice.toFixed(0)} – ₹{alert.obMitigationRange.topPrice.toFixed(0)}
                    </span>
                    <span className="text-[9px] text-slate-400 block">
                      Mid: ₹{alert.obMitigationRange.midpoint.toFixed(0)}
                    </span>
                  </div>

                  <div>
                    <span className="text-[10px] text-slate-500 uppercase block">Calculated SL</span>
                    <span className="font-bold text-rose-400 text-xs">
                      ₹{alert.stopLossPrice.toFixed(2)}
                    </span>
                    <span className="text-[9px] text-slate-400 block">
                      Risk: ₹{alert.riskPerShare.toFixed(2)}
                    </span>
                  </div>

                  <div>
                    <span className="text-[10px] text-slate-500 uppercase block">Target (1:2.5+)</span>
                    <span className="font-bold text-emerald-400 text-xs">
                      ₹{alert.targetPrice.toFixed(2)}
                    </span>
                    <span className="text-[9px] text-cyan-400 font-semibold block">
                      1:{alert.rewardRiskRatio} RR
                    </span>
                  </div>
                </div>
              </div>

              {/* Action Button */}
              <div className="pt-3 border-t border-slate-800/80 mt-3 flex items-center justify-between">
                <span className="text-[11px] font-mono text-slate-400">
                  Displacement: <strong className="text-white">{alert.displacementBody.toFixed(1)}</strong> pts · Vol{" "}
                  <strong className="text-cyan-400">{alert.volumeMultiplier}x</strong>
                </span>

                <button
                  onClick={() => onDeploy(alert)}
                  className="px-3.5 py-1.5 rounded-lg bg-gradient-to-r from-cyan-600 to-cyan-500 hover:from-cyan-500 hover:to-cyan-400 text-white font-mono text-xs font-bold transition-all shadow-md shadow-cyan-600/30 flex items-center gap-1.5 group-hover:scale-105"
                >
                  <Zap className="w-3.5 h-3.5 fill-current" />
                  <span>⚡ Deploy Position</span>
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
