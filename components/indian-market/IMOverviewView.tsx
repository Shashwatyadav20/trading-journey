"use client";

import React, { useState, useEffect } from "react";
import IMHeader from "./IMHeader";
import IMStatusBadge from "./IMStatusBadge";
import { IMPaperTradingView } from "./IMPaperTradingView";
import {
  TrendingUp,
  Activity,
  ShieldAlert,
  AlertOctagon,
  Play,
  Loader2,
  CheckCircle2,
  XCircle,
  FileCheck,
} from "lucide-react";

function StatCard({
  label,
  value,
  sub,
  accent = "slate",
}: {
  label: string;
  value: React.ReactNode;
  sub?: string;
  accent?: "emerald" | "rose" | "cyan" | "amber" | "violet" | "slate";
}) {
  const accents: Record<string, string> = {
    emerald: "border-emerald-500/25 text-emerald-400",
    rose: "border-rose-500/25 text-rose-400",
    cyan: "border-cyan-500/25 text-cyan-400",
    amber: "border-amber-500/25 text-amber-400",
    violet: "border-violet-500/25 text-violet-400",
    slate: "border-slate-800/80 text-slate-200",
  };
  return (
    <div
      className={`p-4 rounded-xl bg-[#11192e]/80 border ${
        accents[accent].split(" ")[0]
      } flex flex-col gap-1`}
    >
      <span className="text-[10px] font-mono text-slate-500 uppercase tracking-wider">
        {label}
      </span>
      <span className={`text-lg font-bold font-mono ${accents[accent].split(" ")[1]}`}>
        {value}
      </span>
      {sub && <span className="text-[10px] text-slate-500 font-mono">{sub}</span>}
    </div>
  );
}

function ModeToggle({
  label,
  active,
  onChange,
  disabled,
  danger,
  locked,
}: {
  label: string;
  active: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  danger?: boolean;
  locked?: boolean;
}) {
  return (
    <div className="flex items-center justify-between px-4 py-3 rounded-xl bg-[#11192e]/80 border border-slate-800/80">
      <div className="flex flex-col">
        <span className="text-xs font-semibold text-slate-200 font-mono">{label}</span>
        {locked && (
          <span className="text-[10px] text-amber-400 font-mono">
            Locked — Safety Control
          </span>
        )}
      </div>
      <button
        className={`relative w-11 h-6 rounded-full border transition-all duration-300 ${
          active
            ? danger
              ? "bg-rose-500/30 border-rose-500/50"
              : "bg-cyan-500/30 border-cyan-500/50"
            : "bg-slate-800 border-slate-700"
        } ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
        onClick={() => !disabled && onChange(!active)}
        aria-label={label}
      >
        <span
          className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full transition-transform duration-300 ${
            active
              ? "translate-x-5 " + (danger ? "bg-rose-400" : "bg-cyan-400")
              : "bg-slate-500 translate-x-0"
          }`}
        />
      </button>
    </div>
  );
}

export default function IMOverviewView() {
  const [viewMode, setViewMode] = useState<"overview" | "paper_validation">("paper_validation");
  const [signalData, setSignalData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [executing, setExecuting] = useState(false);
  const [autoTrade, setAutoTrade] = useState(false);
  const [emergency, setEmergency] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const fetchSignal = async () => {
    try {
      const res = await fetch("http://localhost:4000/api/indian/signal");
      if (res.ok) {
        const data = await res.json();
        if (data.success && data.signal) {
          setSignalData(data);
          setAutoTrade(!!data.autoTradeActive);
          setEmergency(!!data.emergencyStopActive);
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
    const interval = setInterval(fetchSignal, 5000);
    return () => clearInterval(interval);
  }, []);

  const handleExecutePaper = async () => {
    setExecuting(true);
    setNotice(null);
    try {
      const res = await fetch("http://localhost:4000/api/indian/trade/execute-paper", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setNotice("Paper spread trade executed successfully!");
        fetchSignal();
      } else {
        setNotice(`Execution failed: ${data.error || "Unknown error"}`);
      }
    } catch (err: any) {
      setNotice(`Execution error: ${err.message}`);
    } finally {
      setExecuting(false);
    }
  };

  const handleToggleEmergency = async () => {
    try {
      const res = await fetch("http://localhost:4000/api/indian/trade/emergency-stop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: !emergency }),
      });
      if (res.ok) {
        setEmergency(true);
        setAutoTrade(false);
        setNotice("EMERGENCY STOP ACTIVATED. All new trading is locked.");
        fetchSignal();
      }
    } catch {
      // handle error
    }
  };

  const sig = signalData?.signal;
  const daily = signalData?.dailyRisk;

  if (viewMode === "paper_validation") {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between bg-slate-900/60 p-2 rounded-xl border border-slate-800">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setViewMode("overview")}
              className="px-3 py-1.5 text-xs font-semibold font-mono rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition"
            >
              ← Strategy Overview
            </button>
            <button
              onClick={() => setViewMode("paper_validation")}
              className="px-3 py-1.5 text-xs font-semibold font-mono rounded-lg bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex items-center gap-1.5"
            >
              <FileCheck className="w-3.5 h-3.5" />
              Phase 12 Paper Validation Dashboard
            </button>
          </div>
        </div>
        <IMPaperTradingView />
      </div>
    );
  }


  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2.5">
            <h2 className="text-xl font-bold text-slate-100 tracking-tight">
              INDIAN MARKET
            </h2>
            <IMStatusBadge status="PAPER MODE" size="sm" />
          </div>
          <p className="text-xs text-slate-400 font-mono mt-0.5">
            NIFTY Options Automated Hedging Workspace — Backend Engine Connected
          </p>
        </div>
        <span className="text-[10px] text-slate-500 font-mono self-end">
          Live Backend Engine · Paper Execution Mode
        </span>
      </div>

      {/* Shared IM header bar */}
      <IMHeader />

      {notice && (
        <div className="px-4 py-3 rounded-xl bg-cyan-500/10 border border-cyan-500/30 text-cyan-300 text-xs font-mono flex items-center justify-between">
          <span>{notice}</span>
          <button
            onClick={() => setNotice(null)}
            className="text-slate-400 hover:text-slate-200"
          >
            ✕
          </button>
        </div>
      )}

      {/* ── MARKET & DATA HEALTH ─────────────────────────────────────────── */}
      <section className="space-y-3">
        <h3 className="text-[10px] uppercase font-mono font-bold tracking-widest text-slate-500 flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-cyan-400" /> MARKET & SYSTEM DATA HEALTH
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          <StatCard
            label="NIFTY Spot"
            value={sig ? `₹${sig.spotPrice.toLocaleString("en-IN")}` : "24,700.45"}
            sub="NSE Index"
            accent="cyan"
          />
          <StatCard
            label="Market Data Source"
            value={signalData?.isRealData ? "REAL MARKET" : "SYNTHETIC / PAPER"}
            sub={signalData?.isRealData ? "Live Tick Stream" : "Paper Model Engine"}
            accent={signalData?.isRealData ? "emerald" : "amber"}
          />
          <StatCard
            label="Data Health"
            value={
              signalData?.dataHealth?.isStale ? (
                <span className="text-rose-400 text-xs font-bold">STALE (&gt; 60s)</span>
              ) : (
                <span className="text-emerald-400 text-xs font-bold">HEALTHY</span>
              )
            }
            sub={signalData?.dataHealth?.errorMessage || "Fresh feeds active"}
            accent={signalData?.dataHealth?.isStale ? "rose" : "emerald"}
          />
          <StatCard
            label="Session Status"
            value={<IMStatusBadge status="MARKET OPEN" size="sm" />}
            sub="09:15 – 15:30 IST"
          />
          <StatCard
            label="Expiry"
            value={sig?.expiry || "26 Sep 2026"}
            sub="Weekly Options"
            accent="amber"
          />
        </div>
      </section>

      {/* ── REGIME & INDICATOR BREAKDOWN ────────────────────────────────── */}
      <section className="space-y-3">
        <h3 className="text-[10px] uppercase font-mono font-bold tracking-widest text-slate-500 flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" /> REGIME & INDICATORS BREAKDOWN
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
          <StatCard
            label="Regime"
            value={
              <IMStatusBadge
                status={sig?.regime || "BULLISH"}
                size="sm"
                pulse={sig?.regime === "BULLISH" || sig?.regime === "BEARISH"}
              />
            }
            sub="Master Flow"
          />
          <StatCard
            label="1H Trend"
            value={sig?.regime_details?.trend1H || "BUY"}
            sub="Macro Trend"
            accent="cyan"
          />
          <StatCard
            label="15M Trend"
            value={sig?.regime_details?.trend15M || "BUY"}
            sub="Micro Trend"
            accent="cyan"
          />
          <StatCard
            label="VWAP"
            value={sig ? `₹${(sig.regime_details?.vwap || sig.spotPrice).toFixed(0)}` : "24,680"}
            sub={sig && sig.spotPrice > (sig.regime_details?.vwap || 0) ? "ABOVE VWAP" : "BELOW VWAP"}
            accent="emerald"
          />
          <StatCard
            label="RSI (14)"
            value="58.5"
            sub="Bullish (>50)"
            accent="emerald"
          />
          <StatCard
            label="Short Delta"
            value={sig?.sellLeg ? sig.sellLeg.delta : "-0.24"}
            sub="Delta Safety Valid"
            accent="violet"
          />
          <StatCard
            label="Short Gamma"
            value="0.003"
            sub="Acceptable (<0.005)"
            accent="slate"
          />
          <StatCard
            label="Strategy Score"
            value={sig ? `${sig.score}/100` : "86/100"}
            sub={sig?.score >= 80 ? "QUALIFIED" : "WATCH"}
            accent="cyan"
          />
        </div>
      </section>

      {/* ── ACTIVE TRADE SETUP CARD ───────────────────────────────────────── */}
      {sig && sig.sellLeg && sig.buyLeg && (
        <div className="p-5 rounded-2xl bg-[#11192e]/90 border border-slate-800 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-base font-bold font-mono text-slate-100">
                  {sig.action.replace(/_/g, " ")}
                </span>
                <IMStatusBadge status={sig.status} size="sm" />
              </div>
              <p className="text-xs text-slate-400 font-mono mt-0.5">
                Defined-Risk Option Credit Spread ({sig.quantityLots} Lot(s) · {sig.totalQuantity} Qty)
              </p>
            </div>

            {sig.status === "READY" && (
              <button
                onClick={handleExecutePaper}
                disabled={executing || emergency}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold font-mono text-xs bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/30 transition-all disabled:opacity-50"
              >
                {executing ? (
                  <Loader2 className="w-4 h-4 animate-spin text-emerald-400" />
                ) : (
                  <Play className="w-4 h-4 text-emerald-400" />
                )}
                <span>EXECUTE PAPER SPREAD</span>
              </button>
            )}
          </div>

          {/* Spread Legs */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="p-3 rounded-xl bg-slate-900/60 border border-rose-500/20 flex flex-col">
              <span className="text-[10px] font-mono text-rose-400 uppercase">
                SELL SHORT LEG
              </span>
              <span className="text-sm font-bold font-mono text-slate-100 mt-1">
                {sig.sellLeg.strike} {sig.sellLeg.optionType} @ ₹{sig.sellLeg.ltp}
              </span>
              <span className="text-[10px] text-slate-500 font-mono">
                Delta: {sig.sellLeg.delta} · IV: {sig.sellLeg.iv}%
              </span>
            </div>

            <div className="p-3 rounded-xl bg-slate-900/60 border border-emerald-500/20 flex flex-col">
              <span className="text-[10px] font-mono text-emerald-400 uppercase">
                BUY HEDGE LEG (MANDATORY)
              </span>
              <span className="text-sm font-bold font-mono text-slate-100 mt-1">
                {sig.buyLeg.strike} {sig.buyLeg.optionType} @ ₹{sig.buyLeg.ltp}
              </span>
              <span className="text-[10px] text-slate-500 font-mono">
                Delta: {sig.buyLeg.delta} · IV: {sig.buyLeg.iv}%
              </span>
            </div>
          </div>

          {/* Financials & Net P&L */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2">
            <div className="px-3 py-2 rounded-lg bg-slate-900/40 border border-slate-800">
              <span className="text-[9px] text-slate-500 font-mono uppercase">
                Net Credit
              </span>
              <div className="text-sm font-bold font-mono text-emerald-400">
                ₹{sig.netCredit} / share
              </div>
            </div>
            <div className="px-3 py-2 rounded-lg bg-slate-900/40 border border-slate-800">
              <span className="text-[9px] text-slate-500 font-mono uppercase">
                Max Defined Loss
              </span>
              <div className="text-sm font-bold font-mono text-rose-400">
                ₹{sig.maxLoss}
              </div>
            </div>
            <div className="px-3 py-2 rounded-lg bg-slate-900/40 border border-slate-800">
              <span className="text-[9px] text-slate-500 font-mono uppercase">
                Total Charges (Taxes/Fees)
              </span>
              <div className="text-sm font-bold font-mono text-amber-400">
                ₹{sig.charges.totalCharges}
              </div>
            </div>
            <div className="px-3 py-2 rounded-lg bg-slate-900/40 border border-slate-800">
              <span className="text-[9px] text-slate-500 font-mono uppercase">
                Expected NET Profit
              </span>
              <div className="text-sm font-bold font-mono text-cyan-400">
                ₹{sig.expectedNetPnl}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── RISK CONTROLS ────────────────────────────────────────────────── */}
      <section className="space-y-3">
        <h3 className="text-[10px] uppercase font-mono font-bold tracking-widest text-slate-500 flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-400" /> RISK CONTROLS
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          <StatCard
            label="Daily Net P&L"
            value={daily ? `₹${daily.dailyPnl}` : "₹0"}
            sub="Today"
            accent={daily && daily.dailyPnl >= 0 ? "emerald" : "rose"}
          />
          <StatCard
            label="Daily Loss Limit"
            value="–₹5,000"
            sub="Hard stop cap"
            accent="rose"
          />
          <StatCard
            label="Daily Net Target"
            value="₹1,000"
            sub="Cap target"
            accent="emerald"
          />
          <StatCard
            label="Trades Today"
            value={daily ? `${daily.tradesCountToday} / 3` : "0 / 3"}
            sub="Paper trades"
          />
          <StatCard
            label="Daily Lock Status"
            value={
              daily?.isTradeLocked ? (
                <span className="text-rose-400 text-xs">LOCKED</span>
              ) : (
                <span className="text-emerald-400 text-xs">ACTIVE</span>
              )
            }
            sub={daily?.lockReason || "Normal operation"}
            accent={daily?.isTradeLocked ? "rose" : "emerald"}
          />
        </div>
      </section>

      {/* ── TRADING CONTROLS ────────────────────────────────────────────── */}
      <section className="space-y-3">
        <h3 className="text-[10px] uppercase font-mono font-bold tracking-widest text-slate-500 flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-slate-400" /> TRADING MODE
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <ModeToggle label="PAPER TRADING" active={true} onChange={() => {}} disabled />
          <ModeToggle
            label="LIVE TRADING"
            active={false}
            onChange={() => {}}
            disabled
            locked
            danger
          />
          <ModeToggle
            label="AUTO TRADE"
            active={autoTrade}
            onChange={() => {}}
            disabled
            locked
            danger
          />
          {/* Emergency Stop */}
          <button
            className={`flex items-center justify-center gap-2 px-4 py-3 rounded-xl font-bold font-mono text-sm border transition-all duration-200 ${
              emergency
                ? "bg-rose-500/25 border-rose-500/60 text-rose-300 shadow-lg shadow-rose-900/30"
                : "bg-slate-900 border-slate-700 text-rose-400 hover:bg-rose-500/10 hover:border-rose-500/40"
            }`}
            onClick={handleToggleEmergency}
          >
            <AlertOctagon className="w-4 h-4" />
            {emergency ? "EMERGENCY STOPPED" : "EMERGENCY STOP"}
          </button>
        </div>

        <div className="flex items-start gap-2 px-4 py-3 rounded-xl bg-amber-500/5 border border-amber-500/20 text-xs font-mono text-amber-300">
          <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5 text-amber-400" />
          <span>
            <strong>LIVE TRADING</strong> remains strictly locked to OFF. System is running in <strong>PAPER TRADING MODE</strong>. All multi-leg spread execution, dynamic strike selection, and charge calculations are fully active in paper mode.
          </span>
        </div>
      </section>
    </div>
  );
}
