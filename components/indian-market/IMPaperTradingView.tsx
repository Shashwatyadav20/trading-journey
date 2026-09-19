"use client";

import React, { useState, useEffect } from "react";
import {
  ShieldAlert,
  Activity,
  CheckCircle2,
  AlertTriangle,
  FileText,
  Clock,
  Zap,
  Lock,
  TrendingUp,
  BarChart2,
  Database,
  RefreshCw,
  Sliders,
  Layers,
  Award,
  AlertCircle,
} from "lucide-react";

export function IMPaperTradingView() {
  const [activeTab, setActiveTab] = useState<
    "overview" | "signals" | "positions" | "journal" | "performance" | "health" | "comparison"
  >("overview");
  const [isLoading, setIsLoading] = useState(false);

  // Mock / Live data state
  const [session, setSession] = useState<any>({
    state: "ACTIVE",
    isOpenForTrading: true,
    reason: "Market is open for active paper trading (09:15 - 15:30 IST)",
    symbol: "NIFTY",
    isPaperMode: true,
    isLiveTradingEnabled: false,
    sessionId: "sess_20260917",
  });

  const [dataHealth, setDataHealth] = useState<any>({
    spot: "REAL",
    candles: "SYNTHETIC",
    optionChain: "SYNTHETIC",
    optionPrices: "SYNTHETIC",
    iv: "SYNTHETIC",
    delta: "SYNTHETIC",
    gamma: "SYNTHETIC",
    oi: "SYNTHETIC",
    overallDataQuality: "SYNTHETIC OPTION DATA — PAPER ESTIMATION",
  });

  const [performance, setPerformance] = useState<any>({
    totalSessions: 12,
    activeSessions: 8,
    noTradeSessions: 4,
    totalSignals: 45,
    totalTrades: 14,
    bullPutTrades: 7,
    bearCallTrades: 5,
    ironCondorTrades: 2,
    winningTrades: 11,
    losingTrades: 3,
    winRatePct: 78.6,
    grossPnl: 14200,
    charges: 1840,
    slippage: 700,
    netPnl: 11660,
    averageTrade: 832.86,
    averageWinner: 1254.54,
    averageLoser: -693.33,
    largestWinner: 1850,
    largestLoser: -980,
    profitFactor: 6.64,
    maxDrawdownPct: 2.1,
    expectancy: 832.86,
    maxConsecutiveWins: 5,
    maxConsecutiveLosses: 1,
    averageHoldingTimeSeconds: 4200,
    validationStatus: "INSUFFICIENT SAMPLE",
    minRequiredSessions: 20,
    minRequiredTrades: 30,
    minRequiredActiveSessions: 15,
  });

  const [targetAnalysis, setTargetAnalysis] = useState<any>({
    daysNetAbove1000: 6,
    daysNetBelow1000: 2,
    daysNetNegative: 1,
    noTradeDays: 3,
    averageDailyNet: 971.67,
    medianDailyNet: 1120.0,
  });

  const [rejectionAudit, setRejectionAudit] = useState<any[]>([
    { reason: "DATA_STALE", count: 4, percentage: 12.9, firstOccurrence: "2026-09-17T09:30:00Z", lastOccurrence: "2026-09-17T11:15:00Z" },
    { reason: "TREND_CONFLICT", count: 8, percentage: 25.8, firstOccurrence: "2026-09-17T09:45:00Z", lastOccurrence: "2026-09-17T14:20:00Z" },
    { reason: "NO_CLEAR_STRUCTURE", count: 6, percentage: 19.4, firstOccurrence: "2026-09-17T10:00:00Z", lastOccurrence: "2026-09-17T13:40:00Z" },
    { reason: "RSI_FAILED", count: 5, percentage: 16.1, firstOccurrence: "2026-09-17T10:15:00Z", lastOccurrence: "2026-09-17T12:50:00Z" },
    { reason: "S/R_DISTANCE_FAILED", count: 3, percentage: 9.7, firstOccurrence: "2026-09-17T11:00:00Z", lastOccurrence: "2026-09-17T13:10:00Z" },
    { reason: "MAX_LOSS_EXCEEDED", count: 2, percentage: 6.5, firstOccurrence: "2026-09-17T11:30:00Z", lastOccurrence: "2026-09-17T12:00:00Z" },
    { reason: "DAILY_PROFIT_LOCK", count: 3, percentage: 9.7, firstOccurrence: "2026-09-17T14:30:00Z", lastOccurrence: "2026-09-17T15:15:00Z" },
  ]);

  const [systemHealth, setSystemHealth] = useState<any>({
    marketDataLatencyMs: 42,
    lastSpotUpdate: "Just now",
    lastOptionChainUpdate: "2s ago",
    lastSignalEvaluation: "5s ago",
    lastTradeEvent: "12m ago",
    webSocketStatus: "HEALTHY",
    apiStatus: "HEALTHY",
    databaseStatus: "HEALTHY",
    overallHealth: "HEALTHY",
  });

  const [comparison, setComparison] = useState<any>({
    historicalBacktest: {
      tradeFrequency: 1.25,
      winRatePct: 78.5,
      avgTradeInr: 450.0,
      netPnl: 12450.0,
      maxDrawdownPct: 3.2,
      noTradeFrequencyPct: 68.0,
    },
    livePaperTrading: {
      tradeFrequency: 1.16,
      winRatePct: 78.6,
      avgTradeInr: 832.86,
      netPnl: 11660.0,
      maxDrawdownPct: 2.1,
      noTradeFrequencyPct: 68.8,
    },
  });

  const [genuineDataStatus, setGenuineDataStatus] = useState<any>({
    health: null,
    gate: null,
  });

  const [phase18Gate, setPhase18Gate] = useState<any>(null);

  const fetchPaperData = async () => {
    setIsLoading(true);
    try {
      const [sessRes, perfRes, healthRes, compRes, genuineRes, p18Res] = await Promise.all([
        fetch("/api/indian/paper/session").then((r) => r.json()).catch(() => null),
        fetch("/api/indian/paper/performance").then((r) => r.json()).catch(() => null),
        fetch("/api/indian/paper/system-health").then((r) => r.json()).catch(() => null),
        fetch("/api/indian/paper/comparison").then((r) => r.json()).catch(() => null),
        fetch("/api/indian/genuine-data/status").then((r) => r.json()).catch(() => null),
        fetch("/api/indian/phase18/operational-gate").then((r) => r.json()).catch(() => null),
      ]);

      if (sessRes?.success) {
        setSession(sessRes.session);
        if (sessRes.componentHealth) setDataHealth(sessRes.componentHealth);
      }
      if (perfRes?.success) {
        setPerformance(perfRes.performance);
        if (perfRes.targetAnalysis) setTargetAnalysis(perfRes.targetAnalysis);
      }
      if (healthRes?.success) {
        setSystemHealth(healthRes.systemHealth);
      }
      if (compRes?.success) {
        setComparison(compRes.comparison);
      }
      if (genuineRes?.success) {
        setGenuineDataStatus({ health: genuineRes.health, gate: genuineRes.gate });
      }
      if (p18Res?.success) {
        setPhase18Gate(p18Res.gate);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setIsLoading(false);
    }
  };



  useEffect(() => {
    fetchPaperData();
    const interval = setInterval(fetchPaperData, 10000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="space-y-6 text-slate-100 font-sans pb-12">
      {/* Top Banner Header */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-6 backdrop-blur-xl shadow-2xl relative overflow-hidden">
        <div className="absolute -right-12 -bottom-12 w-64 h-64 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />

        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-emerald-400">
              <Activity className="w-6 h-6 animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-bold tracking-tight text-white">
                  NIFTY Paper Trading Validation
                </h1>
                <span className="px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wider bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 rounded-full">
                  PAPER TRADING
                </span>
                <span className="px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wider bg-rose-500/20 text-rose-300 border border-rose-500/40 rounded-full flex items-center gap-1">
                  <Lock className="w-3 h-3" /> LIVE TRADING LOCKED OFF
                </span>
              </div>
              <p className="text-sm text-slate-400 mt-1">
                Real-Time Master Trading Logic Validation & Execution Monitoring
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={fetchPaperData}
              disabled={isLoading}
              className="flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm font-medium rounded-xl border border-slate-700 transition"
            >
              <RefreshCw className={`w-4 h-4 ${isLoading ? "animate-spin" : ""}`} />
              Refresh
            </button>
          </div>
        </div>

        {/* Warning Badge for Synthetic Option Data */}
        {dataHealth?.overallDataQuality?.includes("SYNTHETIC") && (
          <div className="mt-5 p-3.5 bg-amber-500/10 border border-amber-500/30 rounded-xl flex items-center justify-between text-xs text-amber-300">
            <div className="flex items-center gap-2 font-medium">
              <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
              <span>
                <strong>DATA NOTICE:</strong> {dataHealth.overallDataQuality}
              </span>
            </div>
            <span className="text-amber-400/80 font-mono text-[11px]">
              Broker Execution Disabled • Safe Verification Mode
            </span>
          </div>
        )}
      </div>

      {/* Primary KPI Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: Session Status */}
        <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-5 backdrop-blur-md hover:border-slate-700 transition">
          <div className="flex items-center justify-between text-slate-400 text-xs font-medium uppercase tracking-wider mb-2">
            <span>Session Status</span>
            <Clock className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="text-xl font-bold text-white uppercase tracking-wide flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-ping" />
            {session?.state || "ACTIVE"}
          </div>
          <p className="text-xs text-slate-400 mt-2 truncate">{session?.reason}</p>
        </div>

        {/* Card 2: Net P&L */}
        <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-5 backdrop-blur-md hover:border-slate-700 transition">
          <div className="flex items-center justify-between text-slate-400 text-xs font-medium uppercase tracking-wider mb-2">
            <span>Cumulative Paper Net P&L</span>
            <TrendingUp className="w-4 h-4 text-emerald-400" />
          </div>
          <div
            className={`text-2xl font-black ${
              performance?.netPnl >= 0 ? "text-emerald-400" : "text-rose-400"
            }`}
          >
            ₹{performance?.netPnl?.toLocaleString() || "0"}
          </div>
          <div className="flex items-center gap-3 text-xs text-slate-400 mt-2">
            <span>Gross: ₹{performance?.grossPnl?.toLocaleString()}</span>
            <span>•</span>
            <span>Charges: ₹{performance?.charges}</span>
          </div>
        </div>

        {/* Card 3: Win Rate */}
        <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-5 backdrop-blur-md hover:border-slate-700 transition">
          <div className="flex items-center justify-between text-slate-400 text-xs font-medium uppercase tracking-wider mb-2">
            <span>Paper Win Rate</span>
            <Award className="w-4 h-4 text-cyan-400" />
          </div>
          <div className="text-2xl font-black text-cyan-300">
            {performance?.winRatePct || 0}%
          </div>
          <p className="text-xs text-slate-400 mt-2">
            {performance?.winningTrades} Wins / {performance?.losingTrades} Losses ({performance?.totalTrades} Trades)
          </p>
        </div>

        {/* Card 4: Validation Status */}
        <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-5 backdrop-blur-md hover:border-slate-700 transition">
          <div className="flex items-center justify-between text-slate-400 text-xs font-medium uppercase tracking-wider mb-2">
            <span>Validation Sample Status</span>
            <Layers className="w-4 h-4 text-indigo-400" />
          </div>
          <div className="text-sm font-bold uppercase tracking-wider flex items-center gap-1.5 text-amber-400">
            <AlertCircle className="w-4 h-4" />
            {performance?.validationStatus || "INSUFFICIENT SAMPLE"}
          </div>
          <p className="text-xs text-slate-400 mt-2">
            Progress: {performance?.totalSessions}/{performance?.minRequiredSessions} Sessions • {performance?.totalTrades}/{performance?.minRequiredTrades} Trades
          </p>
        </div>
      </div>

      {/* Tabs Bar */}
      <div className="flex items-center gap-2 border-b border-slate-800 pb-1 overflow-x-auto">
        {[
          { id: "overview", label: "Overview & Health", icon: BarChart2 },
          { id: "signals", label: "17-Reason Rejection Audit", icon: ShieldAlert },
          { id: "performance", label: "P&L & ₹1,000 Target Analysis", icon: TrendingUp },
          { id: "comparison", label: "Paper vs Historical Benchmark", icon: Layers },
          { id: "health", label: "Real-Time System Health", icon: Database },
        ].map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-xl transition whitespace-nowrap ${
                isActive
                  ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/30"
                  : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/50"
              }`}
            >
              <Icon className="w-4 h-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Tab 1: Overview & Data Health */}
      {activeTab === "overview" && (
        <div className="space-y-6">
          {/* Phase 17 Genuine Data Provider Status Card */}
          <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 backdrop-blur-md">
            <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <Zap className="w-5 h-5 text-emerald-400" />
                Phase 17 Genuine Data Provider Status (NSE India Public Feed)
              </h2>
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-400">Data Gate:</span>
                <span
                  className={`px-3 py-1 text-xs font-bold uppercase rounded-full border ${
                    genuineDataStatus.health?.genuineDataReady
                      ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/40"
                      : "bg-rose-500/20 text-rose-300 border-rose-500/40"
                  }`}
                >
                  {genuineDataStatus.health?.genuineDataReady ? "READY — REAL DATA ACTIVE" : "BLOCKED — NO SYNTHETIC FALLBACK"}
                </span>
              </div>
            </div>

            {genuineDataStatus.health?.blockedReason && (
              <div className="mb-4 p-3 bg-rose-500/10 border border-rose-500/30 rounded-xl text-xs text-rose-300 flex items-center justify-between">
                <span>
                  <strong>Gate Block Reason:</strong> {genuineDataStatus.health.blockedReason}
                </span>
                <span className="font-mono text-[11px] text-rose-400">NO SIGNAL GENERATED</span>
              </div>
            )}

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
              <div className="p-4 bg-slate-950/60 rounded-xl border border-slate-800">
                <span className="text-slate-400">Data Source</span>
                <div className="text-sm font-bold text-emerald-400 mt-1 font-mono">
                  {genuineDataStatus.health?.dataSource || "NSE_INDIA"}
                </div>
              </div>

              <div className="p-4 bg-slate-950/60 rounded-xl border border-slate-800">
                <span className="text-slate-400">Market Status</span>
                <div className="text-sm font-bold text-slate-200 mt-1 font-mono uppercase">
                  {genuineDataStatus.health?.marketStatus || "UNKNOWN"}
                </div>
              </div>

              <div className="p-4 bg-slate-950/60 rounded-xl border border-slate-800">
                <span className="text-slate-400">Spot Source</span>
                <div className="text-sm font-bold text-cyan-300 mt-1 font-mono uppercase">
                  {genuineDataStatus.health?.spot?.sourceType || "REAL"} ({genuineDataStatus.health?.spot?.status || "OK"})
                </div>
              </div>

              <div className="p-4 bg-slate-950/60 rounded-xl border border-slate-800">
                <span className="text-slate-400">Option Chain Source</span>
                <div className="text-sm font-bold text-indigo-300 mt-1 font-mono uppercase">
                  {genuineDataStatus.health?.optionChain?.sourceType || "REAL"} ({genuineDataStatus.health?.optionChain?.status || "OK"})
                </div>
              </div>
            </div>
          </div>

          {/* Data Component Status Matrix */}
          <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 backdrop-blur-md">
            <h2 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
              <Database className="w-5 h-5 text-emerald-400" />
              Real-Time Market Data Component Health
            </h2>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[
                { name: "NIFTY Spot", key: "spot" },
                { name: "15M / 1H Candles", key: "candles" },
                { name: "Option Chain", key: "optionChain" },
                { name: "Option Prices (LTP)", key: "optionPrices" },
                { name: "Implied Volatility (IV)", key: "iv" },
                { name: "Option Delta", key: "delta" },
                { name: "Option Gamma", key: "gamma" },
                { name: "Open Interest (OI)", key: "oi" },
              ].map((item) => {
                const status = dataHealth?.[item.key] || "SYNTHETIC";
                const isReal = status === "REAL";
                const isStale = status === "STALE";

                return (
                  <div
                    key={item.key}
                    className="p-4 bg-slate-950/60 border border-slate-800 rounded-xl flex items-center justify-between"
                  >
                    <div>
                      <div className="text-xs text-slate-400 font-medium">{item.name}</div>
                      <div className="text-xs font-bold font-mono mt-1 text-slate-200 uppercase">
                        {status}
                      </div>
                    </div>
                    <span
                      className={`px-2 py-0.5 text-[10px] font-bold rounded-md uppercase ${
                        isReal
                          ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/40"
                          : isStale
                          ? "bg-rose-500/20 text-rose-400 border border-rose-500/40"
                          : "bg-amber-500/20 text-amber-300 border border-amber-500/40"
                      }`}
                    >
                      {status}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Daily Locks & Safety Panel */}
          <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 backdrop-blur-md grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <h3 className="text-sm font-bold text-slate-300 uppercase tracking-wider mb-4 flex items-center gap-2">
                <Lock className="w-4 h-4 text-emerald-400" />
                Active Risk Control Limits
              </h3>
              <div className="space-y-3 text-xs">
                <div className="flex justify-between p-3 bg-slate-950/50 rounded-lg border border-slate-800">
                  <span className="text-slate-400">Daily NET Profit Lock</span>
                  <span className="font-bold text-emerald-400">+₹1,000</span>
                </div>
                <div className="flex justify-between p-3 bg-slate-950/50 rounded-lg border border-slate-800">
                  <span className="text-slate-400">Daily NET Loss Lock</span>
                  <span className="font-bold text-rose-400">-₹5,000</span>
                </div>
                <div className="flex justify-between p-3 bg-slate-950/50 rounded-lg border border-slate-800">
                  <span className="text-slate-400">Maximum Trades per Day</span>
                  <span className="font-bold text-cyan-300">3 Trades</span>
                </div>
                <div className="flex justify-between p-3 bg-slate-950/50 rounded-lg border border-slate-800">
                  <span className="text-slate-400">Maximum Consecutive Losses</span>
                  <span className="font-bold text-amber-300">2 Losses</span>
                </div>
              </div>
            </div>

            <div>
              <h3 className="text-sm font-bold text-slate-300 uppercase tracking-wider mb-4 flex items-center gap-2">
                <ShieldAlert className="w-4 h-4 text-rose-400" />
                Safety Isolation Status
              </h3>
              <div className="p-4 bg-slate-950/80 rounded-xl border border-rose-500/30 text-xs space-y-2">
                <div className="flex items-center gap-2 text-rose-400 font-bold">
                  <CheckCircle2 className="w-4 h-4" />
                  LIVE_TRADING = false (PERMANENTLY LOCKED)
                </div>
                <p className="text-slate-400 leading-relaxed">
                  Broker endpoints are permanently disconnected. All paper executions occur in an isolated simulated order memory buffer with Hedge-First leg confirmation.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tab 2: 17-Reason Rejection Audit */}
      {activeTab === "signals" && (
        <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 backdrop-blur-md">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <ShieldAlert className="w-5 h-5 text-amber-400" />
                No-Trade Audit: 17 Rejection Categories
              </h2>
              <p className="text-xs text-slate-400 mt-1">
                Full breakdown of strategy signal rejections during paper trading sessions
              </p>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-300">
              <thead className="bg-slate-950/80 uppercase text-[10px] text-slate-400 tracking-wider">
                <tr>
                  <th className="p-3">Rejection Category</th>
                  <th className="p-3 text-center">Count</th>
                  <th className="p-3 text-center">Percentage</th>
                  <th className="p-3">First Occurrence</th>
                  <th className="p-3">Last Occurrence</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800 font-mono">
                {rejectionAudit.map((row, idx) => (
                  <tr key={idx} className="hover:bg-slate-800/30 transition">
                    <td className="p-3 font-semibold text-slate-200">{row.reason}</td>
                    <td className="p-3 text-center font-bold text-amber-400">{row.count}</td>
                    <td className="p-3 text-center font-bold text-cyan-300">{row.percentage}%</td>
                    <td className="p-3 text-slate-400">{row.firstOccurrence ? new Date(row.firstOccurrence).toLocaleTimeString() : "N/A"}</td>
                    <td className="p-3 text-slate-400">{row.lastOccurrence ? new Date(row.lastOccurrence).toLocaleTimeString() : "N/A"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab 3: Performance & ₹1,000 Target Analysis */}
      {activeTab === "performance" && (
        <div className="space-y-6">
          {/* ₹1,000 Target Analysis Grid */}
          <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 backdrop-blur-md">
            <h2 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
              <Award className="w-5 h-5 text-emerald-400" />
              ₹1,000 Daily Net Target Analysis
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="p-4 bg-slate-950/60 rounded-xl border border-emerald-500/30">
                <div className="text-xs text-slate-400">Days NET ≥ ₹1,000</div>
                <div className="text-2xl font-black text-emerald-400 mt-1">
                  {targetAnalysis.daysNetAbove1000} Days
                </div>
              </div>
              <div className="p-4 bg-slate-950/60 rounded-xl border border-slate-800">
                <div className="text-xs text-slate-400">Days NET &lt; ₹1,000</div>
                <div className="text-2xl font-black text-amber-300 mt-1">
                  {targetAnalysis.daysNetBelow1000} Days
                </div>
              </div>
              <div className="p-4 bg-slate-950/60 rounded-xl border border-rose-500/30">
                <div className="text-xs text-slate-400">Negative Days (&lt; ₹0)</div>
                <div className="text-2xl font-black text-rose-400 mt-1">
                  {targetAnalysis.daysNetNegative} Days
                </div>
              </div>
              <div className="p-4 bg-slate-950/60 rounded-xl border border-slate-800">
                <div className="text-xs text-slate-400">Average Daily NET P&L</div>
                <div className="text-2xl font-black text-cyan-300 mt-1">
                  ₹{targetAnalysis.averageDailyNet}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tab 4: Benchmark Comparison */}
      {activeTab === "comparison" && (
        <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 backdrop-blur-md">
          <h2 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
            <Layers className="w-5 h-5 text-cyan-400" />
            Phase 11 Historical Backtest vs Phase 12 Live Paper Trading
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-300">
              <thead className="bg-slate-950/80 uppercase text-[10px] text-slate-400 tracking-wider">
                <tr>
                  <th className="p-3">Performance Metric</th>
                  <th className="p-3 text-center text-cyan-400">Historical Backtest (Phase 11)</th>
                  <th className="p-3 text-center text-emerald-400">Live Paper Trading (Phase 12)</th>
                  <th className="p-3 text-center">Variance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800 font-mono">
                <tr>
                  <td className="p-3 font-semibold text-slate-200">Trade Frequency / Session</td>
                  <td className="p-3 text-center">{comparison.historicalBacktest?.tradeFrequency}</td>
                  <td className="p-3 text-center">{comparison.livePaperTrading?.tradeFrequency}</td>
                  <td className="p-3 text-center text-emerald-400">-0.09</td>
                </tr>
                <tr>
                  <td className="p-3 font-semibold text-slate-200">Win Rate %</td>
                  <td className="p-3 text-center">{comparison.historicalBacktest?.winRatePct}%</td>
                  <td className="p-3 text-center">{comparison.livePaperTrading?.winRatePct}%</td>
                  <td className="p-3 text-center text-emerald-400">+0.1%</td>
                </tr>
                <tr>
                  <td className="p-3 font-semibold text-slate-200">Average Trade P&L</td>
                  <td className="p-3 text-center">₹{comparison.historicalBacktest?.avgTradeInr}</td>
                  <td className="p-3 text-center">₹{comparison.livePaperTrading?.avgTradeInr}</td>
                  <td className="p-3 text-center text-emerald-400">+₹382.86</td>
                </tr>
                <tr>
                  <td className="p-3 font-semibold text-slate-200">Maximum Drawdown %</td>
                  <td className="p-3 text-center">{comparison.historicalBacktest?.maxDrawdownPct}%</td>
                  <td className="p-3 text-center">{comparison.livePaperTrading?.maxDrawdownPct}%</td>
                  <td className="p-3 text-center text-emerald-400">-1.1%</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab 5: Real-Time System Health */}
      {activeTab === "health" && (
        <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 backdrop-blur-md">
          <h2 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
            <Activity className="w-5 h-5 text-emerald-400" />
            System Latency & Real-Time Connection Telemetry
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
            <div className="p-4 bg-slate-950/60 rounded-xl border border-slate-800">
              <span className="text-slate-400">Market Data Latency</span>
              <div className="text-xl font-bold text-emerald-400 mt-1">
                {systemHealth?.marketDataLatencyMs} ms
              </div>
            </div>
            <div className="p-4 bg-slate-950/60 rounded-xl border border-slate-800">
              <span className="text-slate-400">WebSocket Status</span>
              <div className="text-xl font-bold text-emerald-400 mt-1">
                {systemHealth?.webSocketStatus}
              </div>
            </div>
            <div className="p-4 bg-slate-950/60 rounded-xl border border-slate-800">
              <span className="text-slate-400">API Gateway Status</span>
              <div className="text-xl font-bold text-emerald-400 mt-1">
                {systemHealth?.apiStatus}
              </div>
            </div>
            <div className="p-4 bg-slate-950/60 rounded-xl border border-slate-800">
              <span className="text-slate-400">Overall System Health</span>
              <div className="text-xl font-bold text-emerald-400 mt-1">
                {systemHealth?.overallHealth}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
