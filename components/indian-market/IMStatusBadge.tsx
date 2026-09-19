"use client";

import React from "react";

export type IMStatus =
  | "LIVE"
  | "PAPER"
  | "CONNECTED"
  | "DISCONNECTED"
  | "WAIT"
  | "READY"
  | "SIGNAL"
  | "ENTERED"
  | "PROFIT"
  | "LOSS"
  | "EXITED"
  | "NO TRADE"
  | "BLOCKED"
  | "WARNING"
  | "ERROR"
  | "SAFE"
  | "OPEN"
  | "PENDING"
  | "FILLED"
  | "PARTIAL"
  | "CANCELLED"
  | "REJECTED"
  | "BULLISH"
  | "BEARISH"
  | "RANGE"
  | "HIGH VOLATILITY"
  | "EVENT RISK"
  | "UNCLEAR"
  | "MARKET OPEN"
  | "MARKET CLOSED"
  | "PRE-OPEN"
  | "DEMO";

const STATUS_STYLES: Record<string, string> = {
  LIVE: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  PAPER: "bg-cyan-500/15 text-cyan-400 border-cyan-500/30",
  CONNECTED: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  DISCONNECTED: "bg-slate-700/40 text-slate-400 border-slate-600/30",
  WAIT: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  READY: "bg-cyan-500/15 text-cyan-400 border-cyan-500/30",
  SIGNAL: "bg-violet-500/15 text-violet-400 border-violet-500/30",
  ENTERED: "bg-cyan-500/15 text-cyan-400 border-cyan-500/30",
  PROFIT: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  LOSS: "bg-rose-500/15 text-rose-400 border-rose-500/30",
  EXITED: "bg-slate-700/40 text-slate-300 border-slate-600/30",
  "NO TRADE": "bg-slate-700/40 text-slate-400 border-slate-600/30",
  BLOCKED: "bg-rose-500/15 text-rose-400 border-rose-500/30",
  WARNING: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  ERROR: "bg-rose-500/15 text-rose-400 border-rose-500/30",
  SAFE: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  OPEN: "bg-cyan-500/15 text-cyan-400 border-cyan-500/30",
  PENDING: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  FILLED: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  PARTIAL: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  CANCELLED: "bg-slate-700/40 text-slate-400 border-slate-600/30",
  REJECTED: "bg-rose-500/15 text-rose-400 border-rose-500/30",
  BULLISH: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  BEARISH: "bg-rose-500/15 text-rose-400 border-rose-500/30",
  RANGE: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  "HIGH VOLATILITY": "bg-orange-500/15 text-orange-400 border-orange-500/30",
  "EVENT RISK": "bg-violet-500/15 text-violet-400 border-violet-500/30",
  UNCLEAR: "bg-slate-700/40 text-slate-400 border-slate-600/30",
  "MARKET OPEN": "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  "MARKET CLOSED": "bg-slate-700/40 text-slate-400 border-slate-600/30",
  "PRE-OPEN": "bg-amber-500/15 text-amber-400 border-amber-500/30",
  DEMO: "bg-violet-500/15 text-violet-400 border-violet-500/30",
};

const STATUS_PULSE: Record<string, boolean> = {
  LIVE: true,
  CONNECTED: true,
  SIGNAL: true,
  READY: true,
  "MARKET OPEN": true,
};

interface IMStatusBadgeProps {
  status: string;
  size?: "xs" | "sm" | "md";
  pulse?: boolean;
  className?: string;
}

export default function IMStatusBadge({
  status,
  size = "sm",
  pulse,
  className = "",
}: IMStatusBadgeProps) {
  const style = STATUS_STYLES[status] || "bg-slate-700/40 text-slate-400 border-slate-600/30";
  const shouldPulse = pulse ?? STATUS_PULSE[status] ?? false;

  const sizeClass =
    size === "xs"
      ? "text-[9px] px-1.5 py-0.5"
      : size === "md"
      ? "text-xs px-3 py-1"
      : "text-[10px] px-2 py-0.5";

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded font-mono font-bold border tracking-wider uppercase ${sizeClass} ${style} ${className}`}
    >
      {shouldPulse && (
        <span className="w-1.5 h-1.5 rounded-full bg-current opacity-80 animate-pulse" />
      )}
      {status}
    </span>
  );
}
