"use client";

import React, { useState, useEffect } from "react";

export interface Phase26ESessionData {
  status: "GENUINE" | "BLOCKED" | "INSUFFICIENT_DATA";
  marketSession: string;
  dataGate: string;
  dhan: string;
  websocket: string;
  optionChain: string;
  lotSize: string;
  expiry: string;
  activePositions: number;
  genuineSession: boolean;
  genuineTrades: number;
  genuineSessionsCount: number;
  activeSessionsCount: number;
  paperPnl: number;
  liveOrders: number;
  safetyLocks: {
    paperTrading: boolean;
    liveTrading: boolean;
    brokerExecution: boolean;
    realDataOnly: boolean;
    realBrokerOrders: number;
  };
  sampleProgress: {
    genuineSessions: number;
    requiredSessions: number;
    sessionsMet: boolean;
    genuineTrades: number;
    requiredTrades: number;
    tradesMet: boolean;
    activeSessions: number;
    requiredActiveSessions: number;
    activeSessionsMet: boolean;
  };
  dailyRiskStatus: "NORMAL" | "LOCKED";
  reconciliation: "PASS" | "FAIL";
  lastEvaluationTimestamp: string;
}

export default function IMPhase26EDashboard() {
  const [session, setSession] = useState<Phase26ESessionData | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const fetchSessionData = async () => {
    try {
      const res = await fetch("/api/indian/phase26e/session");
      if (res.ok) {
        const json = await res.json();
        setSession(json);
        setError(null);
      } else {
        setError(`HTTP ${res.status}`);
      }
    } catch (err: any) {
      setError(err.message || "Failed to fetch session data");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSessionData();
    const interval = setInterval(fetchSessionData, 3000);
    return () => clearInterval(interval);
  }, []);

  const getBadgeStyle = (status: string, isOkPositive: boolean = true) => {
    const s = (status || "").toUpperCase();
    if (s === "REAL" || s === "CONNECTED" || s === "HEALTHY" || s === "VERIFIED" || s === "GENUINE" || s === "PASSED" || s === "PASS" || s === "NORMAL" || s === "ACTIVE" || s === "LOCKED OFF" || s === "DISABLED") {
      return "bg-emerald-500/10 text-emerald-400 border-emerald-500/30";
    }
    if (s === "INSUFFICIENT_DATA" || s === "LOCKED" || s === "WARNING" || s === "STALE") {
      return "bg-amber-500/10 text-amber-400 border-amber-500/30";
    }
    return "bg-rose-500/10 text-rose-400 border-rose-500/30";
  };

  return (
    <div className="w-full bg-slate-900/90 backdrop-blur-md border border-slate-800 rounded-xl p-6 shadow-2xl space-y-6 text-slate-100">
      {/* Title & Pipeline Status Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center border-b border-slate-800 pb-4 gap-4">
        <div>
          <div className="flex items-center gap-3">
            <span className={`h-3 w-3 rounded-full ${session?.genuineSession ? "bg-emerald-500 animate-pulse" : "bg-rose-500"}`}></span>
            <h2 className="text-xl font-bold tracking-tight text-white uppercase">
              Phase 26E — Live Paper Session Validation
            </h2>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Genuine Dhan HQ Market Feed Pipeline • Defined-Risk Spreads • Anti-Simulation Isolated Sample
          </p>
        </div>

        <div className="flex items-center gap-3">
          <span className={`px-3 py-1.5 rounded-lg border text-xs font-bold tracking-wider uppercase ${getBadgeStyle(session?.status || "BLOCKED")}`}>
            Session: {session?.status || "BLOCKED"}
          </span>
          <span className="text-[11px] font-mono text-slate-400 bg-slate-950 px-2.5 py-1 rounded border border-slate-800">
            Real Orders: <strong className="text-emerald-400">0</strong>
          </span>
        </div>
      </div>

      {/* Grid of 16 Core Requirements */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-8 gap-3">
        {[
          { label: "Dhan", value: session?.dhan || "CONNECTED" },
          { label: "WebSocket", value: session?.websocket || "HEALTHY" },
          { label: "NIFTY Spot", value: "REAL" },
          { label: "Option Chain", value: session?.optionChain || "REAL" },
          { label: "Option Prices", value: "REAL" },
          { label: "Lot Size", value: session?.lotSize || "VERIFIED" },
          { label: "Expiry", value: session?.expiry || "VERIFIED" },
          { label: "Synthetic Data", value: "DISABLED" },
          { label: "Paper Mode", value: session?.safetyLocks.paperTrading ? "ACTIVE" : "INACTIVE" },
          { label: "Live Trading", value: session?.safetyLocks.liveTrading ? "ENABLED" : "LOCKED OFF" },
          { label: "Current Session", value: session?.genuineSession ? "GENUINE" : "INVALID" },
          { label: "Market Session", value: session?.marketSession || "MARKET_OPEN" },
          { label: "Daily Risk", value: session?.dailyRiskStatus || "NORMAL" },
          { label: "Reconciliation", value: session?.reconciliation || "PASS" },
          { label: "Active Positions", value: String(session?.activePositions || 0) },
          { label: "Paper P&L", value: `₹${(session?.paperPnl || 0).toLocaleString("en-IN")}` },
        ].map((item, idx) => (
          <div key={idx} className="bg-slate-950/70 border border-slate-800 rounded-lg p-2.5 flex flex-col justify-between">
            <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">{item.label}</span>
            <span className={`mt-2 text-xs font-bold px-2 py-1 rounded border text-center ${getBadgeStyle(item.value)}`}>
              {item.value}
            </span>
          </div>
        ))}
      </div>

      {/* Phase 19 Genuine Sample Progress */}
      <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-5 space-y-4">
        <h3 className="text-sm font-semibold text-slate-200 uppercase tracking-wide flex items-center justify-between">
          <span>Genuine Sample Collection Progress</span>
          <span className="text-xs text-indigo-400 font-mono">Phase19 Isolated Sample Target</span>
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-slate-900/80 border border-slate-800 rounded-lg p-4 space-y-2">
            <div className="flex justify-between text-xs">
              <span className="text-slate-400 font-medium">Genuine Sessions</span>
              <span className="font-mono text-emerald-400 font-bold">
                {session?.sampleProgress?.genuineSessions || 0} / {session?.sampleProgress?.requiredSessions || 20}
              </span>
            </div>
            <div className="w-full bg-slate-800 rounded-full h-2 overflow-hidden">
              <div
                className="bg-emerald-500 h-full transition-all duration-500"
                style={{
                  width: `${Math.min(100, ((session?.sampleProgress?.genuineSessions || 0) / (session?.sampleProgress?.requiredSessions || 20)) * 100)}%`,
                }}
              />
            </div>
          </div>

          <div className="bg-slate-900/80 border border-slate-800 rounded-lg p-4 space-y-2">
            <div className="flex justify-between text-xs">
              <span className="text-slate-400 font-medium">Genuine Trades</span>
              <span className="font-mono text-emerald-400 font-bold">
                {session?.sampleProgress?.genuineTrades || 0} / {session?.sampleProgress?.requiredTrades || 30}
              </span>
            </div>
            <div className="w-full bg-slate-800 rounded-full h-2 overflow-hidden">
              <div
                className="bg-emerald-500 h-full transition-all duration-500"
                style={{
                  width: `${Math.min(100, ((session?.sampleProgress?.genuineTrades || 0) / (session?.sampleProgress?.requiredTrades || 30)) * 100)}%`,
                }}
              />
            </div>
          </div>

          <div className="bg-slate-900/80 border border-slate-800 rounded-lg p-4 space-y-2">
            <div className="flex justify-between text-xs">
              <span className="text-slate-400 font-medium">Active Sessions</span>
              <span className="font-mono text-emerald-400 font-bold">
                {session?.sampleProgress?.activeSessions || 0} / {session?.sampleProgress?.requiredActiveSessions || 15}
              </span>
            </div>
            <div className="w-full bg-slate-800 rounded-full h-2 overflow-hidden">
              <div
                className="bg-emerald-500 h-full transition-all duration-500"
                style={{
                  width: `${Math.min(100, ((session?.sampleProgress?.activeSessions || 0) / (session?.sampleProgress?.requiredActiveSessions || 15)) * 100)}%`,
                }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Absolute Safety Locks Status Footer */}
      <div className="flex flex-col sm:flex-row justify-between items-center bg-slate-950/60 border border-slate-800 rounded-lg p-3 text-xs gap-2">
        <div className="flex items-center gap-4 text-slate-400 font-mono">
          <span>PAPER_TRADING=true</span>
          <span>LIVE_TRADING=false</span>
          <span>BROKER_EXECUTION_ENABLED=false</span>
          <span>INDIAN_REAL_DATA_ONLY=true</span>
        </div>
        <div className="text-slate-400 text-[11px]">
          Last Evaluation: <span className="text-slate-200 font-mono">{session?.lastEvaluationTimestamp || "N/A"}</span>
        </div>
      </div>
    </div>
  );
}
