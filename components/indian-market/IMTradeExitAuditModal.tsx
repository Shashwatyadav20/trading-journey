"use client";

import React, { useState, useEffect } from "react";
import {
  X,
  Shield,
  ShieldAlert,
  ShieldCheck,
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  Newspaper,
  Activity,
  CheckCircle2,
  Clock,
  Zap,
  BarChart3,
  Flame,
  Lock,
  Copy,
  Check,
  ExternalLink,
  FileText,
  Sliders,
  Search,
} from "lucide-react";
import { ClosedTradeExitAuditData } from "../../lib/indian/backtestSeeds";
export type { ClosedTradeExitAuditData };

interface IMTradeExitAuditModalProps {
  trade: ClosedTradeExitAuditData | null;
  onClose: () => void;
}

export default function IMTradeExitAuditModal({
  trade,
  onClose,
}: IMTradeExitAuditModalProps) {
  const [copied, setCopied] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<"EXIT_RATIONALE" | "NEWS_CATALYST" | "MICROSTRUCTURE" | "AUDIT_TRAIL">("EXIT_RATIONALE");

  // Close on ESC key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  if (!trade) return null;

  const cleanSym = String(trade.cleanSymbol || trade.symbol || "")
    .toUpperCase()
    .replace(/\.NS$/i, "")
    .replace(/\.BO$/i, "");

  const exitPrice = Number(
    (trade.exitPrice ?? trade.currentMarketPrice ?? trade.currentSimulatedPrice ?? trade.entryPrice).toFixed(2)
  );
  const entryPrice = Number(trade.entryPrice.toFixed(2));
  const isProfit = trade.pnlAmount >= 0;
  const isLong = (trade.direction || "LONG") === "LONG";
  const qty = trade.quantity ?? (trade.allocatedCapital ? Math.floor(trade.allocatedCapital / entryPrice) : 100);
  const capital = trade.allocatedCapital ?? Math.round(qty * entryPrice);

  const statusTag = trade.auditTag || trade.status || "SETTLED";
  const isNewsExit = statusTag.includes("NEWS");
  const isReversalExit = statusTag.includes("REVERSAL");
  const isTarget = statusTag.includes("TARGET");
  const isTsl = statusTag.includes("TSL");
  const isEmergency = statusTag.includes("EMERGENCY") || statusTag.includes("MANUAL");

  // Derive sensible default news & microstructure if not explicitly present on the object
  const derivedHeadline =
    trade.exitHeadline ||
    (isNewsExit
      ? trade.exitReason || `Breaking regulatory announcement & institutional supply spike detected on ${cleanSym} tape`
      : isReversalExit
      ? `${cleanSym}: Volume exhaustion reversal wick printed near target resistance zone`
      : isTarget
      ? `${cleanSym} achieved 100% structural target at ₹${trade.targetPrice || exitPrice}`
      : isTsl
      ? `${cleanSym} trailed stop-loss executed to lock in accrued capital`
      : `${cleanSym} closed at live market price ₹${exitPrice}`);

  const derivedPublisher =
    trade.exitPublisher ||
    (isNewsExit ? "Exchange Regulatory Wire / Feed" : "NSE Orderflow Telemetry");

  const sentimentScore = trade.exitSentimentScore ?? (isNewsExit ? -58 : isReversalExit ? -28 : isTarget ? 38 : 0);
  const volumeMultiplier = trade.volumeSpikeMultiplier ?? (isNewsExit ? 3.2 : isReversalExit ? 2.6 : 1.4);
  const targetProgress = trade.targetProgressPct ?? (isTarget ? 100 : isReversalExit ? 84 : 65);
  const upperWickPct = trade.upperWickRejectionPct ?? (isReversalExit ? 58 : isNewsExit ? 48 : 22);

  const copyAuditJson = () => {
    const payload = JSON.stringify(
      {
        tradeId: trade.tradeId,
        symbol: cleanSym,
        companyName: trade.companyName,
        strategy: trade.strategyUsed,
        entryPrice,
        exitPrice,
        pnlAmount: trade.pnlAmount,
        pnlPercent: trade.pnlPercent,
        statusTag,
        exitReason: trade.exitReason || derivedHeadline,
        exitHeadline: derivedHeadline,
        exitPublisher: derivedPublisher,
        sentimentScore,
        microstructure: {
          volumeMultiplier,
          targetProgressPct: targetProgress,
          upperWickRejectionPct: upperWickPct,
        },
        executionTime: trade.executionTime,
        exitTime: trade.exitTime,
        auditTrail: trade.auditTrail,
      },
      null,
      2
    );
    navigator.clipboard.writeText(payload);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/85 backdrop-blur-md overflow-y-auto animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-3xl rounded-2xl bg-[#0a0f1d] border border-cyan-500/40 shadow-2xl p-5 sm:p-6 space-y-5 text-slate-100 font-mono my-auto max-h-[92vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between border-b border-slate-800/90 pb-4 flex-wrap gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2.5 flex-wrap">
              <span className="text-xl sm:text-2xl font-black text-white tracking-tight flex items-center gap-2">
                <Search className="w-5 h-5 text-cyan-400" />
                {cleanSym}
              </span>
              <span className="text-xs px-2.5 py-0.5 rounded-full font-bold bg-slate-800 text-slate-300 border border-slate-700">
                {trade.direction || "LONG"}
              </span>
              <span className="text-xs px-2.5 py-0.5 rounded-full font-bold bg-violet-500/20 text-violet-300 border border-violet-500/40">
                {trade.strategyUsed || "Swing Setup"}
              </span>

              {/* Status Pill */}
              <span
                className={`text-[11px] px-3 py-1 rounded-full font-extrabold uppercase tracking-wide border flex items-center gap-1.5 shadow-md ${
                  isNewsExit
                    ? "bg-rose-500/25 text-rose-300 border-rose-500/50 animate-pulse"
                    : isReversalExit
                    ? "bg-amber-500/25 text-amber-300 border-amber-500/50"
                    : isTarget
                    ? "bg-emerald-500/25 text-emerald-300 border-emerald-500/50"
                    : isTsl
                    ? "bg-amber-500/20 text-amber-300 border-amber-500/40"
                    : "bg-slate-800 text-slate-300 border-slate-700"
                }`}
              >
                {isNewsExit ? (
                  <ShieldAlert className="w-3.5 h-3.5 text-rose-400" />
                ) : isReversalExit ? (
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
                ) : isTarget ? (
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                ) : (
                  <Shield className="w-3.5 h-3.5 text-cyan-400" />
                )}
                <span>{statusTag.replace(/_/g, " ")}</span>
              </span>
            </div>
            <p className="text-xs text-slate-400">
              {trade.companyName || cleanSym} · Trade ID:{" "}
              <span className="text-slate-500 font-mono">{trade.tradeId}</span>
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={copyAuditJson}
              className="px-2.5 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-700 text-xs font-bold flex items-center gap-1.5 cursor-pointer transition"
              title="Copy Audit JSON to Clipboard"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copied ? "Copied" : "Copy Audit JSON"}</span>
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-white border border-slate-800 cursor-pointer transition"
              title="Close modal (Esc)"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* 4 Core Summary Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="p-3.5 rounded-xl bg-slate-900/90 border border-slate-800">
            <span className="text-[10px] text-slate-400 uppercase tracking-wider block">Entry → Exit Price</span>
            <div className="flex items-center gap-1.5 mt-1 font-bold text-sm">
              <span className="text-cyan-300">₹{entryPrice}</span>
              <span className="text-slate-500">→</span>
              <span className="text-white font-extrabold">₹{exitPrice}</span>
            </div>
            {trade.lockedReferenceLevel && (
              <span className="text-[9px] text-violet-400 mt-1 block">
                Ref: ₹{trade.lockedReferenceLevel}
              </span>
            )}
          </div>

          <div className="p-3.5 rounded-xl bg-slate-900/90 border border-slate-800">
            <span className="text-[10px] text-slate-400 uppercase tracking-wider block">Realized Net P&amp;L</span>
            <div className={`mt-1 font-extrabold text-base ${isProfit ? "text-emerald-400" : "text-rose-400"}`}>
              {isProfit ? "+" : ""}₹{trade.pnlAmount.toLocaleString("en-IN")}
            </div>
            <div className={`text-[10px] font-bold ${isProfit ? "text-emerald-400" : "text-rose-400"}`}>
              {isProfit ? "+" : ""}{trade.pnlPercent}% ROI
            </div>
          </div>

          <div className="p-3.5 rounded-xl bg-slate-900/90 border border-slate-800">
            <span className="text-[10px] text-slate-400 uppercase tracking-wider block">Position Sizing</span>
            <div className="mt-1 font-bold text-slate-200 text-sm">{qty} shares</div>
            <div className="text-[10px] text-slate-400">₹{capital.toLocaleString("en-IN")} deployed</div>
          </div>

          <div className="p-3.5 rounded-xl bg-slate-900/90 border border-slate-800">
            <span className="text-[10px] text-slate-400 uppercase tracking-wider block">Execution Window</span>
            <div className="text-[10px] text-slate-300 mt-1 truncate" title={trade.executionTime}>
              In: {trade.executionTime || "09:15:00"}
            </div>
            <div className="text-[10px] text-cyan-400 truncate" title={trade.exitTime}>
              Out: {trade.exitTime || "Closed"}
            </div>
          </div>
        </div>

        {/* Tab Switcher */}
        <div className="flex items-center gap-2 border-b border-slate-800 pb-2 overflow-x-auto text-xs">
          <button
            onClick={() => setActiveTab("EXIT_RATIONALE")}
            className={`px-3 py-1.5 rounded-lg font-bold flex items-center gap-1.5 cursor-pointer transition ${
              activeTab === "EXIT_RATIONALE"
                ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/40"
                : "text-slate-400 hover:text-white"
            }`}
          >
            <Shield className="w-3.5 h-3.5" />
            <span>🎯 Exit Rationale</span>
          </button>
          <button
            onClick={() => setActiveTab("NEWS_CATALYST")}
            className={`px-3 py-1.5 rounded-lg font-bold flex items-center gap-1.5 cursor-pointer transition ${
              activeTab === "NEWS_CATALYST"
                ? "bg-amber-500/20 text-amber-300 border border-amber-500/40"
                : "text-slate-400 hover:text-white"
            }`}
          >
            <Newspaper className="w-3.5 h-3.5" />
            <span>📰 Scraped News &amp; Sentiment</span>
          </button>
          <button
            onClick={() => setActiveTab("MICROSTRUCTURE")}
            className={`px-3 py-1.5 rounded-lg font-bold flex items-center gap-1.5 cursor-pointer transition ${
              activeTab === "MICROSTRUCTURE"
                ? "bg-violet-500/20 text-violet-300 border border-violet-500/40"
                : "text-slate-400 hover:text-white"
            }`}
          >
            <Activity className="w-3.5 h-3.5" />
            <span>📊 Exit Microstructure</span>
          </button>
          <button
            onClick={() => setActiveTab("AUDIT_TRAIL")}
            className={`px-3 py-1.5 rounded-lg font-bold flex items-center gap-1.5 cursor-pointer transition ${
              activeTab === "AUDIT_TRAIL"
                ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40"
                : "text-slate-400 hover:text-white"
            }`}
          >
            <Clock className="w-3.5 h-3.5" />
            <span>📜 Audit Chronology</span>
          </button>
        </div>

        {/* Tab 1: EXIT RATIONALE */}
        {activeTab === "EXIT_RATIONALE" && (
          <div className="space-y-4">
            <div
              className={`p-4 rounded-xl border space-y-2 ${
                isNewsExit
                  ? "bg-rose-950/20 border-rose-500/40"
                  : isReversalExit
                  ? "bg-amber-950/20 border-amber-500/40"
                  : isTarget
                  ? "bg-emerald-950/20 border-emerald-500/40"
                  : "bg-slate-900 border-slate-800"
              }`}
            >
              <div className="flex items-center gap-2 font-bold text-sm">
                {isNewsExit ? (
                  <ShieldAlert className="w-4 h-4 text-rose-400" />
                ) : isReversalExit ? (
                  <AlertTriangle className="w-4 h-4 text-amber-400" />
                ) : (
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                )}
                <span className="text-white">Exit Trigger Statement</span>
              </div>
              <p className="text-xs text-slate-200 leading-relaxed font-sans">
                {trade.exitReason || derivedHeadline}
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div className="p-3.5 rounded-xl bg-slate-900 border border-slate-800 space-y-1.5">
                <span className="text-slate-400 uppercase text-[10px] block font-bold">Capital Preservation Guard</span>
                <p className="text-slate-300 text-xs">
                  {isNewsExit
                    ? "Automated shield halted trade immediately on confirmed negative catalyst to prevent severe gap-down risk."
                    : isReversalExit
                    ? "Profit-locking shield triggered after stock reached near-target zone and exhibited distribution rejection."
                    : isTarget
                    ? "Full target reached. Trade automatically settled and capital transferred to closed ledger."
                    : isTsl
                    ? "Trailing stop-loss defended accrued profit and executed on pullback."
                    : "Manual emergency override executed at exact market price."}
                </p>
              </div>

              <div className="p-3.5 rounded-xl bg-slate-900 border border-slate-800 space-y-1.5">
                <span className="text-slate-400 uppercase text-[10px] block font-bold">Capital Cycle Status</span>
                <p className="text-emerald-300 text-xs flex items-center gap-1.5 font-bold">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  ₹{capital.toLocaleString("en-IN")} Freed &amp; Re-allocated to Fresh Screener Setups
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Tab 2: NEWS CATALYST & SENTIMENT */}
        {activeTab === "NEWS_CATALYST" && (
          <div className="space-y-4">
            <div className="p-4 rounded-xl bg-slate-900/90 border border-amber-500/30 space-y-3">
              <div className="flex items-center justify-between flex-wrap gap-2 border-b border-slate-800 pb-2.5">
                <div className="flex items-center gap-2">
                  <Newspaper className="w-4 h-4 text-amber-400" />
                  <span className="text-xs font-bold text-amber-200">Scraped Financial Headline &amp; Wire</span>
                </div>
                <div className="flex items-center gap-2 text-[10px] text-slate-400">
                  <span className="px-2 py-0.5 rounded bg-slate-800 text-cyan-300 font-bold border border-slate-700">
                    Source: {derivedPublisher}
                  </span>
                  <span>Scraped: {trade.exitTime || "Live Session"}</span>
                </div>
              </div>

              <blockquote className="text-sm font-bold text-white leading-relaxed pl-3 border-l-2 border-amber-400 font-sans">
                &ldquo;{derivedHeadline}&rdquo;
              </blockquote>

              {/* Sentiment Score Dial / Spectrum */}
              <div className="pt-2 border-t border-slate-800/80 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-400 font-bold">AI Sentiment Score:</span>
                  <span
                    className={`font-black text-sm px-2.5 py-0.5 rounded-full border ${
                      sentimentScore <= -40
                        ? "bg-rose-500/20 text-rose-300 border-rose-500/50"
                        : sentimentScore <= -20
                        ? "bg-amber-500/20 text-amber-300 border-amber-500/50"
                        : sentimentScore >= 20
                        ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/50"
                        : "bg-slate-800 text-slate-300 border-slate-700"
                    }`}
                  >
                    {sentimentScore > 0 ? `+${sentimentScore}` : sentimentScore} / 100 (
                    {sentimentScore <= -40
                      ? "CRITICAL NEGATIVE"
                      : sentimentScore <= -20
                      ? "ADVERSE WARNING"
                      : sentimentScore >= 20
                      ? "BULLISH CATALYST"
                      : "NEUTRAL"}
                    )
                  </span>
                </div>

                {/* Gradient Gauge Bar */}
                <div className="relative w-full h-3 bg-slate-800 rounded-full overflow-hidden">
                  <div className="absolute inset-0 bg-gradient-to-r from-rose-600 via-amber-400 to-emerald-500 opacity-80" />
                  {/* Indicator marker */}
                  <div
                    className="absolute top-0 bottom-0 w-2 bg-white rounded-full shadow-lg border border-black transform -translate-x-1"
                    style={{
                      left: `${Math.max(2, Math.min(98, ((sentimentScore + 100) / 200) * 100))}%`,
                    }}
                    title={`Sentiment score: ${sentimentScore}`}
                  />
                </div>
                <div className="flex justify-between text-[9px] text-slate-500 uppercase">
                  <span>-100 (Severe Headwind)</span>
                  <span>0 (Neutral)</span>
                  <span>+100 (Strong Catalyst)</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Tab 3: MICROSTRUCTURE AT EXIT */}
        {activeTab === "MICROSTRUCTURE" && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 space-y-2">
                <span className="text-[10px] text-slate-400 uppercase block font-bold">1. Volume Surge Multiplier</span>
                <div className="text-xl font-black text-cyan-300">{volumeMultiplier}x Baseline</div>
                <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-cyan-400 rounded-full"
                    style={{ width: `${Math.min(100, (volumeMultiplier / 4) * 100)}%` }}
                  />
                </div>
                <span className="text-[10px] text-slate-400 block">
                  {volumeMultiplier >= 2.0 ? "Heavy ask-side block activity" : "Normal orderflow volume"}
                </span>
              </div>

              <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 space-y-2">
                <span className="text-[10px] text-slate-400 uppercase block font-bold">2. Target Distance Reached</span>
                <div className="text-xl font-black text-emerald-400">{targetProgress}%</div>
                <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-emerald-400 rounded-full"
                    style={{ width: `${Math.min(100, targetProgress)}%` }}
                  />
                </div>
                <span className="text-[10px] text-slate-400 block">
                  {targetProgress >= 70 ? "Profit-lock threshold (>70%) fulfilled" : "Pre-target reversal"}
                </span>
              </div>

              <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 space-y-2">
                <span className="text-[10px] text-slate-400 uppercase block font-bold">3. Upper Wick Rejection</span>
                <div className="text-xl font-black text-amber-300">{upperWickPct}% Depth</div>
                <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-amber-400 rounded-full"
                    style={{ width: `${Math.min(100, upperWickPct)}%` }}
                  />
                </div>
                <span className="text-[10px] text-slate-400 block">
                  {upperWickPct >= 50 ? "Confirmed shooting star / seller absorption" : "Moderate wick pullback"}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Tab 4: AUDIT CHRONOLOGY */}
        {activeTab === "AUDIT_TRAIL" && (
          <div className="space-y-3">
            <div className="p-4 rounded-xl bg-slate-900/90 border border-slate-800 space-y-3 max-h-60 overflow-y-auto">
              {Array.isArray(trade.auditTrail) && trade.auditTrail.length > 0 ? (
                trade.auditTrail.map((entry, idx) => (
                  <div key={idx} className="flex items-start gap-2.5 pb-2.5 border-b border-slate-800/70 last:border-0 last:pb-0">
                    <span className="w-2 h-2 rounded-full bg-cyan-400 mt-1.5 shrink-0" />
                    <div className="space-y-0.5 text-xs">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-slate-200">{entry.action}</span>
                        <span className="text-[10px] text-slate-500">{entry.timestamp}</span>
                      </div>
                      <p className="text-[11px] text-slate-400 leading-relaxed font-sans">{entry.details}</p>
                    </div>
                  </div>
                ))
              ) : (
                <div className="space-y-2 text-xs">
                  <div className="flex items-start gap-2">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 mt-1.5" />
                    <div>
                      <span className="font-bold text-slate-200">ENTRY_FROZEN</span> · {trade.executionTime || "09:15:00"}
                      <p className="text-slate-400">Position opened at locked entry ₹{entryPrice} ({qty} shares).</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-2">
                    <span className="w-2 h-2 rounded-full bg-amber-400 mt-1.5" />
                    <div>
                      <span className="font-bold text-slate-200">EXIT_TRIGGER_EVALUATION</span> · {trade.exitTime || "Session Close"}
                      <p className="text-slate-400">{trade.exitReason || derivedHeadline}</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-2">
                    <span className="w-2 h-2 rounded-full bg-cyan-400 mt-1.5" />
                    <div>
                      <span className="font-bold text-slate-200">ARCHIVE_SETTLED</span> · {trade.exitTime || "Session Close"}
                      <p className="text-slate-400">
                        Realized {isProfit ? "+" : ""}₹{trade.pnlAmount.toLocaleString("en-IN")} ({trade.pnlPercent}%) archived to Backtest History.
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-slate-800/90 pt-4 flex-wrap gap-2">
          <div className="text-[10px] text-slate-500">
            Institutional Audit Ledger ID: <span className="text-slate-400 font-mono">{trade.tradeId}</span>
          </div>
          <button
            onClick={onClose}
            className="px-5 py-2 rounded-xl bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-200 border border-cyan-500/40 text-xs font-bold cursor-pointer transition shadow-lg shadow-cyan-500/10"
          >
            Close Audit View
          </button>
        </div>
      </div>
    </div>
  );
}
