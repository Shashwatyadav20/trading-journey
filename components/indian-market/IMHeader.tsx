"use client";

import React, { useEffect, useState } from "react";
import { apiUrl } from "../../lib/backendUrl";

export default function IMHeader() {
  const [dataHealth, setDataHealth] = useState<any>(null);
  const [connected, setConnected] = useState<boolean>(false);

  useEffect(() => {
    const checkHealth = async () => {
      try {
        const res = await fetch(apiUrl("/api/indian/data-health"), { cache: "no-store" });
        if (res.ok) {
          const data = await res.json();
          setDataHealth(data);
          setConnected(true);
        } else {
          setConnected(false);
        }
      } catch {
        // Backend unreachable
        setConnected(false);
        setDataHealth(null);
      }
    };
    checkHealth();
    const interval = setInterval(checkHealth, 5000);
    return () => clearInterval(interval);
  }, []);

  const isReal = dataHealth?.isRealData === true;
  const isHealthy = connected && (dataHealth?.health?.isHealthy ?? false);

  const marketDataLabel = !connected
    ? "BACKEND DISCONNECTED"
    : isReal
    ? "REAL"
    : "DATA UNAVAILABLE";

  const marketDataStyle = !connected
    ? "bg-rose-500/15 text-rose-400 border-rose-500/30"
    : isReal
    ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
    : "bg-amber-500/15 text-amber-400 border-amber-500/30";

  const healthLabel = !connected ? "DISCONNECTED" : isHealthy ? "HEALTHY" : "STALE";
  const healthStyle = !connected || !isHealthy
    ? "bg-amber-500/15 text-amber-400 border-amber-500/30"
    : "bg-emerald-500/15 text-emerald-400 border-emerald-500/30";

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 rounded-xl bg-[#0d1322]/90 border border-slate-800/80 text-xs font-mono">
      {/* Title */}
      <div className="flex items-center gap-2 shrink-0">
        <span className="text-slate-100 font-bold text-sm tracking-tight">NIFTY HEDGE</span>
      </div>

      {/* Badges container */}
      <div className="flex flex-wrap items-center gap-2">
        {/* MARKET DATA BADGE */}
        <span className={`text-[10px] px-2 py-0.5 rounded border font-bold uppercase tracking-wider ${marketDataStyle}`}>
          MARKET DATA: {marketDataLabel}
        </span>

        {/* TRADING MODE BADGE */}
        <span className="text-[10px] px-2 py-0.5 rounded bg-cyan-500/15 text-cyan-400 border border-cyan-500/30 font-bold uppercase tracking-wider">
          TRADING MODE: PAPER
        </span>

        {/* LIVE TRADING BADGE */}
        <span className="text-[10px] px-2 py-0.5 rounded bg-rose-500/15 text-rose-400 border border-rose-500/30 font-bold uppercase tracking-wider">
          LIVE TRADING: LOCKED OFF
        </span>

        {/* DATA HEALTH BADGE */}
        <span className={`text-[10px] px-2 py-0.5 rounded border font-bold uppercase tracking-wider flex items-center gap-1.5 ${healthStyle}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${isHealthy ? "bg-emerald-400 animate-pulse" : "bg-amber-400"}`} />
          DATA HEALTH: {healthLabel}
        </span>
      </div>
    </div>
  );
}
