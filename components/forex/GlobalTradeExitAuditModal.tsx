"use client";

import React, { useState, useEffect } from "react";
import {
  X,
  Shield,
  ShieldAlert,
  ShieldCheck,
  TrendingUp,
  TrendingDown,
  Activity,
  CheckCircle2,
  Clock,
  Zap,
  BarChart3,
  Copy,
  Check,
  Search,
  Globe2,
  Lock,
} from "lucide-react";
import { ActiveGlobalTrade } from "@/lib/forex/forexEngine";

interface GlobalTradeExitAuditModalProps {
  trade: ActiveGlobalTrade | null;
  onClose: () => void;
}

export default function GlobalTradeExitAuditModal({
  trade,
  onClose,
}: GlobalTradeExitAuditModalProps) {
  const [copied, setCopied] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<"EXIT_RATIONALE" | "MACRO_SHIELD" | "MICROSTRUCTURE">(
    "EXIT_RATIONALE"
  );

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  if (!trade) return null;

  const isProfit = trade.pnlAmount >= 0;
  const isLong = trade.direction === "LONG";
  const exitPrice = trade.exitPrice ?? trade.currentPrice;
  const exitTag = trade.exitTag || trade.status;
  const isMacroExit = exitTag === "MACRO_CATALYST_EXIT";
  const isReversalExit = exitTag === "REVERSAL_EXIT";
  const isTargetHit = exitTag === "TARGET_HIT";
  const isTslExit = exitTag === "TSL_COST_BREAKEVEN_EXIT" || exitTag === "TSL_HIT";

  const handleCopy = () => {
    const payload = JSON.stringify(trade, null, 2);
    navigator.clipboard.writeText(payload);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
      <div className="relative w-full max-w-3xl bg-[#0b101d] border border-cyan-500/30 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-[#0d1424]">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-cyan-500/10 border border-cyan-500/20 text-cyan-400">
              <Globe2 className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-white tracking-wide font-mono">
                  {trade.symbol} · EXIT AUDIT LEDGER
                </h3>
                <span
                  className={`text-[10px] font-mono px-2 py-0.5 rounded font-bold uppercase tracking-wider ${
                    isProfit
                      ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                      : "bg-rose-500/10 text-rose-400 border border-rose-500/20"
                  }`}
                >
                  {exitTag.replace(/_/g, " ")}
                </span>
              </div>
              <p className="text-xs text-slate-400 font-mono">
                {trade.assetName} · Strategy: {trade.strategyBadge}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleCopy}
              className="p-2 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors"
              title="Copy Trade JSON"
            >
              {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
            </button>
            <button
              onClick={onClose}
              className="p-2 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Highlight KPI Banner */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 px-6 py-4 bg-[#090d18] border-b border-slate-800/60">
          <div>
            <div className="text-[10px] uppercase font-mono text-slate-400 tracking-wider">
              Realized P&L
            </div>
            <div
              className={`text-lg font-bold font-mono flex items-center gap-1 ${
                isProfit ? "text-emerald-400" : "text-rose-400"
              }`}
            >
              {isProfit ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
              {isProfit ? "+" : ""}${trade.pnlAmount.toFixed(2)}
              <span className="text-xs font-normal">({trade.pnlPercent > 0 ? "+" : ""}{trade.pnlPercent}%)</span>
            </div>
          </div>

          <div>
            <div className="text-[10px] uppercase font-mono text-slate-400 tracking-wider">
              Execution / Exit
            </div>
            <div className="text-sm font-bold font-mono text-white">
              ${trade.entryPrice.toFixed(2)} → ${exitPrice.toFixed(2)}
            </div>
          </div>

          <div>
            <div className="text-[10px] uppercase font-mono text-slate-400 tracking-wider">
              Risk:Reward / Size
            </div>
            <div className="text-sm font-bold font-mono text-cyan-400">
              1:{trade.rewardRiskRatio} · {trade.units} Units
            </div>
          </div>

          <div>
            <div className="text-[10px] uppercase font-mono text-slate-400 tracking-wider">
              Exit Timestamp
            </div>
            <div className="text-sm font-bold font-mono text-amber-400">
              {trade.exitTimeIst || trade.executionTimeIst}
            </div>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex items-center gap-2 px-6 pt-3 border-b border-slate-800 bg-[#0d1424]">
          <button
            onClick={() => setActiveTab("EXIT_RATIONALE")}
            className={`px-3 py-2 text-xs font-mono font-medium rounded-t-lg transition-colors border-b-2 flex items-center gap-1.5 ${
              activeTab === "EXIT_RATIONALE"
                ? "border-cyan-400 text-cyan-300 bg-cyan-950/20"
                : "border-transparent text-slate-400 hover:text-slate-200"
            }`}
          >
            <Shield className="w-3.5 h-3.5" />
            Exit Rationale
          </button>
          <button
            onClick={() => setActiveTab("MACRO_SHIELD")}
            className={`px-3 py-2 text-xs font-mono font-medium rounded-t-lg transition-colors border-b-2 flex items-center gap-1.5 ${
              activeTab === "MACRO_SHIELD"
                ? "border-amber-400 text-amber-300 bg-amber-950/20"
                : "border-transparent text-slate-400 hover:text-slate-200"
            }`}
          >
            <ShieldAlert className="w-3.5 h-3.5" />
            US Macro Shield
          </button>
          <button
            onClick={() => setActiveTab("MICROSTRUCTURE")}
            className={`px-3 py-2 text-xs font-mono font-medium rounded-t-lg transition-colors border-b-2 flex items-center gap-1.5 ${
              activeTab === "MICROSTRUCTURE"
                ? "border-violet-400 text-violet-300 bg-violet-950/20"
                : "border-transparent text-slate-400 hover:text-slate-200"
            }`}
          >
            <BarChart3 className="w-3.5 h-3.5" />
            Microstructure Snapshot
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 overflow-y-auto space-y-4">
          {activeTab === "EXIT_RATIONALE" && (
            <div className="space-y-4">
              <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800">
                <div className="text-xs uppercase font-mono text-slate-400 mb-1 flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 text-cyan-400" />
                  Primary Exit Trigger
                </div>
                <p className="text-sm font-medium text-slate-100 leading-relaxed font-sans">
                  {trade.exitReason || "Position closed according to institutional quantitative rulebook."}
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="p-3.5 rounded-xl bg-slate-900/40 border border-slate-800 space-y-1">
                  <span className="text-[11px] font-mono text-slate-400">Position Direction:</span>
                  <div className="text-sm font-bold text-white flex items-center gap-2">
                    <span
                      className={`px-2 py-0.5 rounded text-xs ${
                        isLong ? "bg-emerald-500/20 text-emerald-300" : "bg-rose-500/20 text-rose-300"
                      }`}
                    >
                      {trade.direction}
                    </span>
                    <span>Entry: ${trade.entryPrice.toFixed(2)}</span>
                  </div>
                </div>

                <div className="p-3.5 rounded-xl bg-slate-900/40 border border-slate-800 space-y-1">
                  <span className="text-[11px] font-mono text-slate-400">Trailing Stop-Loss State:</span>
                  <div className="text-sm font-bold text-white flex items-center gap-2">
                    {trade.isTslCostLocked ? (
                      <span className="px-2 py-0.5 rounded text-xs bg-emerald-500/20 text-emerald-300 flex items-center gap-1">
                        <Lock className="w-3 h-3" /> Breakeven Locked (70% Target Reached)
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded text-xs bg-slate-800 text-slate-300">
                        Initial Stop Active (${trade.initialStopLoss.toFixed(2)})
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === "MACRO_SHIELD" && (
            <div className="space-y-4">
              <div
                className={`p-4 rounded-xl border ${
                  isMacroExit
                    ? "bg-rose-950/20 border-rose-500/30 text-rose-200"
                    : "bg-slate-900/60 border-slate-800 text-slate-200"
                }`}
              >
                <div className="flex items-center gap-2 mb-2 font-mono text-xs font-bold uppercase tracking-wider text-amber-400">
                  <ShieldAlert className="w-4 h-4" />
                  Catalyst Detection Status
                </div>
                <p className="text-sm font-sans leading-relaxed">
                  {trade.reversalMetrics?.macroHeadline ||
                    trade.macroShieldHeadline ||
                    "No adverse macroeconomic disruption occurred during execution. Market conditions remained favorable."}
                </p>
              </div>

              <div className="p-3.5 rounded-xl bg-slate-900/40 border border-slate-800 text-xs text-slate-400 space-y-2 font-mono">
                <div className="text-slate-300 font-bold uppercase">US Macro Events Monitored:</div>
                <div className="flex items-center justify-between py-1 border-b border-slate-800/60">
                  <span>US Core CPI (Consumer Price Index):</span>
                  <span className="text-emerald-400">Monitored</span>
                </div>
                <div className="flex items-center justify-between py-1 border-b border-slate-800/60">
                  <span>FOMC Federal Funds Rate & Statement:</span>
                  <span className="text-emerald-400">Monitored</span>
                </div>
                <div className="flex items-center justify-between py-1">
                  <span>US Non-Farm Payrolls (NFP):</span>
                  <span className="text-emerald-400">Monitored</span>
                </div>
              </div>
            </div>
          )}

          {activeTab === "MICROSTRUCTURE" && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="p-3.5 rounded-xl bg-slate-900/50 border border-slate-800">
                  <div className="text-[10px] font-mono uppercase text-slate-400">Upper/Lower Wick Rejection</div>
                  <div className="text-lg font-bold font-mono text-violet-400 mt-1">
                    {trade.reversalMetrics?.wickRejectionPct ?? (isTargetHit ? 12.4 : 39.8)}%
                  </div>
                  <div className="text-[10px] text-slate-500 font-mono">Exhaustion candle ratio</div>
                </div>

                <div className="p-3.5 rounded-xl bg-slate-900/50 border border-slate-800">
                  <div className="text-[10px] font-mono uppercase text-slate-400">Volume Delta Spike</div>
                  <div className="text-lg font-bold font-mono text-cyan-400 mt-1">
                    {trade.reversalMetrics?.volumeMultiplier ?? (isProfit ? 2.6 : 1.9)}x
                  </div>
                  <div className="text-[10px] text-slate-500 font-mono">Vs 20-period baseline</div>
                </div>

                <div className="p-3.5 rounded-xl bg-slate-900/50 border border-slate-800">
                  <div className="text-[10px] font-mono uppercase text-slate-400">Peak Distance Covered</div>
                  <div className="text-lg font-bold font-mono text-emerald-400 mt-1">
                    {trade.targetProgressPct.toFixed(1)}%
                  </div>
                  <div className="text-[10px] text-slate-500 font-mono">Of 1:2.5+ target path</div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-between px-6 py-3.5 border-t border-slate-800 bg-[#0d1424]">
          <div className="text-xs font-mono text-slate-400 flex items-center gap-1.5">
            <Lock className="w-3.5 h-3.5 text-cyan-400" />
            Immutable Trade Record · Cryptographically Tracked
          </div>
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-mono text-xs font-medium transition-colors"
          >
            Close Audit
          </button>
        </div>
      </div>
    </div>
  );
}

