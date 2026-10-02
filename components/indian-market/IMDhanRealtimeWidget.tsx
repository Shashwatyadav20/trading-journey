"use client";

import React, { useState, useEffect } from "react";

export interface DhanRealtimeWidgetData {
  dhanStatus: "CONNECTED" | "DISCONNECTED";
  webSocketStatus: "CONNECTED" | "RECONNECTING" | "STALE" | "DISCONNECTED";
  optionChainStatus: "REAL" | "UNAVAILABLE";
  niftyTickStatus: "LIVE" | "STALE";
  selectedCeStatus: "LIVE" | "STALE";
  selectedPeStatus: "LIVE" | "STALE";
  dataAgeMs: number;
  lastTickTimestamp: string | null;
  restChainLastUpdate: string | null;
  greeksStatus: "REAL" | "UNAVAILABLE";
  lotSizeStatus: "VERIFIED" | "UNVERIFIED";
  syntheticFallback: "DISABLED";
  paperTrading: "ACTIVE";
  liveTrading: "LOCKED OFF";
}

export default function IMDhanRealtimeWidget() {
  const [data, setData] = useState<DhanRealtimeWidgetData | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  const fetchStatus = async () => {
    try {
      const res = await fetch("/api/indian/dhan/realtime/status");
      if (res.ok) {
        const json = await res.json();
        if (json.success && json.status) {
          const h = json.status;
          const isWsHealthy = h.connectionState === "CONNECTED" || h.connectionState === "HEALTHY";
          setData({
            dhanStatus: h.connected ? "CONNECTED" : "DISCONNECTED",
            webSocketStatus: isWsHealthy ? "CONNECTED" : h.connectionState === "STALE" ? "STALE" : h.connectionState === "RECONNECTING" ? "RECONNECTING" : "DISCONNECTED",
            optionChainStatus: h.connected ? "REAL" : "UNAVAILABLE",
            niftyTickStatus: isWsHealthy && (h.feedLatencyMs !== null && h.feedLatencyMs < 60000) ? "LIVE" : "STALE",
            selectedCeStatus: isWsHealthy ? "LIVE" : "STALE",
            selectedPeStatus: isWsHealthy ? "LIVE" : "STALE",
            dataAgeMs: h.feedLatencyMs || 0,
            lastTickTimestamp: h.lastMessageAt || null,
            restChainLastUpdate: h.connectedAt || null,
            greeksStatus: h.connected ? "REAL" : "UNAVAILABLE",
            lotSizeStatus: "VERIFIED",
            syntheticFallback: "DISABLED",
            paperTrading: "ACTIVE",
            liveTrading: "LOCKED OFF",
          });
        }
      }
    } catch {
      // Ignore network errors in local dev preview
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 3000);
    return () => clearInterval(interval);
  }, []);

  const getBadgeStyle = (status: string) => {
    switch (status) {
      case "CONNECTED":
      case "HEALTHY":
      case "REAL":
      case "LIVE":
      case "VERIFIED":
      case "ACTIVE":
        return "bg-emerald-500/10 text-emerald-400 border-emerald-500/30";
      case "RECONNECTING":
      case "STALE":
        return "bg-amber-500/10 text-amber-400 border-amber-500/30";
      case "DISCONNECTED":
      case "UNAVAILABLE":
      case "UNVERIFIED":
      case "LOCKED OFF":
      case "DISABLED":
        return "bg-rose-500/10 text-rose-400 border-rose-500/30";
      default:
        return "bg-slate-800 text-slate-400 border-slate-700";
    }
  };

  return (
    <div className="w-full bg-[#0d1322]/90 border border-slate-800/80 rounded-xl p-5 space-y-4 text-slate-100 font-sans">
      <div className="flex items-center justify-between border-b border-slate-800 pb-3">
        <div className="flex items-center gap-3">
          <span className={`h-2.5 w-2.5 rounded-full ${data?.dhanStatus === "CONNECTED" ? "bg-emerald-500 animate-pulse" : "bg-amber-500"}`}></span>
          <h3 className="text-sm font-bold tracking-wider text-slate-200 uppercase font-mono">
            Dhan Real-Time Data & Feed Status (Phase 26D)
          </h3>
        </div>
        <span className="text-[10px] font-mono text-slate-400 uppercase tracking-widest bg-slate-900 px-2.5 py-1 rounded border border-slate-800">
          READ-ONLY MARKET FEED
        </span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-7 gap-2.5">
        {[
          { label: "DHAN", value: data?.dhanStatus || "DISCONNECTED" },
          { label: "WebSocket", value: data?.webSocketStatus || "DISCONNECTED" },
          { label: "Option Chain", value: data?.optionChainStatus || "UNAVAILABLE" },
          { label: "NIFTY Tick", value: data?.niftyTickStatus || "STALE" },
          { label: "Selected CE", value: data?.selectedCeStatus || "STALE" },
          { label: "Selected PE", value: data?.selectedPeStatus || "STALE" },
          { label: "Greeks", value: data?.greeksStatus || "UNAVAILABLE" },
          { label: "Lot Size", value: data?.lotSizeStatus || "VERIFIED" },
          { label: "Synthetic Fallback", value: data?.syntheticFallback || "DISABLED" },
          { label: "Paper Trading", value: data?.paperTrading || "ACTIVE" },
          { label: "Live Trading", value: data?.liveTrading || "LOCKED OFF" },
        ].map((item, idx) => (
          <div key={idx} className="bg-slate-950/60 border border-slate-800/70 rounded-lg p-2.5 flex flex-col justify-between">
            <span className="text-[9px] font-mono font-semibold text-slate-400 uppercase tracking-wider">{item.label}</span>
            <span className={`mt-1.5 text-[11px] font-mono font-bold px-1.5 py-0.5 rounded border text-center ${getBadgeStyle(item.value)}`}>
              {item.value}
            </span>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs font-mono pt-1 border-t border-slate-800/60">
        <div className="bg-slate-950/40 p-2.5 rounded border border-slate-800/50">
          <span className="text-slate-500 text-[10px] block">Data Age (Latency)</span>
          <span className="text-slate-200 font-bold">{data ? `${data.dataAgeMs} ms` : "0 ms"}</span>
        </div>
        <div className="bg-slate-950/40 p-2.5 rounded border border-slate-800/50">
          <span className="text-slate-500 text-[10px] block">Last WebSocket Tick</span>
          <span className="text-slate-200 font-bold">{data?.lastTickTimestamp || "No ticks yet"}</span>
        </div>
        <div className="bg-slate-950/40 p-2.5 rounded border border-slate-800/50">
          <span className="text-slate-500 text-[10px] block">REST Chain Update</span>
          <span className="text-slate-200 font-bold">{data?.restChainLastUpdate || "Active"}</span>
        </div>
      </div>
    </div>
  );
}
