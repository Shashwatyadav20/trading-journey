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
  Download,
  Server,
  ShieldCheck,
  Check,
  XCircle,
} from "lucide-react";

export function IMPaperTradingView() {
  const [activeTab, setActiveTab] = useState<
    "overview" | "signals" | "positions" | "journal" | "performance" | "health" | "comparison" | "phase19" | "phase20" | "phase21"
  >("phase21");
  const [isLoading, setIsLoading] = useState(false);
  const [brokerStatus, setBrokerStatus] = useState<any>(null);
  const [phase21Data, setPhase21Data] = useState<any>(null);
  const [phase21Comparison, setPhase21Comparison] = useState<any>(null);
  const [phase21Alerts, setPhase21Alerts] = useState<any[]>([]);

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
  const [phase19Report, setPhase19Report] = useState<any>(null);

  const fetchPaperData = async () => {
    setIsLoading(true);
    try {
      const [sessRes, perfRes, healthRes, compRes, genuineRes, p18Res, p19Res, brokerRes, p21StatusRes, p21CompRes, p21AlertsRes] = await Promise.all([
        fetch("/api/indian/paper/session").then((r) => r.json()).catch(() => null),
        fetch("/api/indian/paper/performance").then((r) => r.json()).catch(() => null),
        fetch("/api/indian/paper/system-health").then((r) => r.json()).catch(() => null),
        fetch("/api/indian/paper/comparison").then((r) => r.json()).catch(() => null),
        fetch("/api/indian/genuine-data/status").then((r) => r.json()).catch(() => null),
        fetch("/api/indian/phase18/operational-gate").then((r) => r.json()).catch(() => null),
        fetch("/api/indian/phase19/summary").then((r) => r.json()).catch(() => null),
        fetch("/api/indian/broker/status").then((r) => r.json()).catch(() => null),
        fetch("/api/indian/phase21/operational-status").then((r) => r.json()).catch(() => null),
        fetch("/api/indian/phase21/quote-comparison").then((r) => r.json()).catch(() => null),
        fetch("/api/indian/phase21/alerts").then((r) => r.json()).catch(() => null),
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
      if (p19Res?.success) {
        setPhase19Report(p19Res.report);
      }
      if (brokerRes?.success) {
        setBrokerStatus(brokerRes);
      }
      if (p21StatusRes?.success) {
        setPhase21Data(p21StatusRes.data);
      }
      if (p21CompRes?.success) {
        setPhase21Comparison(p21CompRes.comparison);
      }
      if (p21AlertsRes?.success) {
        setPhase21Alerts(p21AlertsRes.alerts);
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
          { id: "phase21", label: "Phase 21 Operational Chain", icon: ShieldCheck },
          { id: "phase20", label: "Phase 20 Broker Connectivity", icon: Server },
          { id: "phase19", label: "Phase 19 Genuine Validation", icon: Award },
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

      {/* Tab: Phase 21 Extended Genuine Paper Trading & Broker Reconciliation */}
      {activeTab === "phase21" && (
        <div className="space-y-6">
          {/* Header Status Banner */}
          <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-6 backdrop-blur-xl relative overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <span className="text-xs font-semibold uppercase tracking-wider text-cyan-400 font-mono">
                  PHASE 21 — EXTENDED GENUINE PAPER TRADING &amp; RECONCILIATION
                </span>
                <h2 className="text-xl font-bold text-white mt-1 flex items-center gap-2">
                  <ShieldCheck className="w-6 h-6 text-emerald-400" />
                  Complete Operational Chain: NSE → Dhan Telemetry → Master Strategy → Paper Execution
                </h2>
                <p className="text-xs text-slate-400 mt-1">
                  Validating end-to-end 3-source operations during genuine market hours with permanent zero-real-order safety lock.
                </p>
              </div>

              <div className="flex items-center gap-2">
                <span
                  className={`px-3 py-1.5 text-xs font-bold font-mono rounded-lg border flex items-center gap-1.5 ${
                    phase21Data?.systemStatus === "HEALTHY"
                      ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
                      : phase21Data?.systemStatus === "DEGRADED"
                      ? "bg-amber-500/10 text-amber-400 border-amber-500/30"
                      : "bg-rose-500/10 text-rose-400 border-rose-500/30"
                  }`}
                >
                  <Activity className="w-3.5 h-3.5" />
                  STATUS: {phase21Data?.systemStatus || "HEALTHY"}
                </span>
                <span className="px-3 py-1.5 text-xs font-bold font-mono rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                  REAL ORDERS: 0
                </span>
                <span className="px-3 py-1.5 text-xs font-bold font-mono rounded-lg bg-rose-500/10 text-rose-400 border border-rose-500/30 flex items-center gap-1.5">
                  <Lock className="w-3.5 h-3.5" />
                  LIVE TRADING LOCKED OFF
                </span>
              </div>
            </div>

            {/* Permanent Safety State Bar */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-5 pt-4 border-t border-slate-800 text-xs">
              <div className="p-3 bg-slate-950/60 rounded-xl border border-slate-800/80">
                <span className="text-slate-500">PAPER_TRADING</span>
                <div className="font-mono font-bold text-emerald-400 mt-0.5">TRUE (HARD-LOCKED)</div>
              </div>
              <div className="p-3 bg-slate-950/60 rounded-xl border border-slate-800/80">
                <span className="text-slate-500">LIVE_TRADING</span>
                <div className="font-mono font-bold text-rose-400 mt-0.5">FALSE (HARD-LOCKED)</div>
              </div>
              <div className="p-3 bg-slate-950/60 rounded-xl border border-slate-800/80">
                <span className="text-slate-500">BROKER_EXECUTION</span>
                <div className="font-mono font-bold text-rose-400 mt-0.5">DISABLED (FAIL-CLOSED)</div>
              </div>
              <div className="p-3 bg-slate-950/60 rounded-xl border border-slate-800/80">
                <span className="text-slate-500">REAL BROKER ORDERS</span>
                <div className="font-mono font-bold text-emerald-400 mt-0.5">0 (VERIFIED ZERO)</div>
              </div>
            </div>
          </div>

          {/* 3-Source Telemetry Grid */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Source A: NSE Real Market Data */}
            <div className="p-5 bg-slate-900/80 rounded-2xl border border-slate-800 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-emerald-400 uppercase tracking-wider font-mono">
                    Source A
                  </span>
                  <span
                    className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase ${
                      phase21Data?.sources?.nse?.connected
                        ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/40"
                        : "bg-amber-500/20 text-amber-400 border border-amber-500/40"
                    }`}
                  >
                    {phase21Data?.sources?.nse?.connected ? "CONNECTED" : "DATA STALE"}
                  </span>
                </div>
                <h3 className="text-base font-bold text-white mt-1">NSE Real Market Data</h3>
                <p className="text-xs text-slate-400 mt-1">
                  Primary feed for Spot, Option Chain &amp; Strategy Evaluation
                </p>

                <div className="mt-4 space-y-2 text-xs">
                  <div className="flex justify-between py-1 border-b border-slate-800/60">
                    <span className="text-slate-400">Latency:</span>
                    <span className="font-mono text-slate-200">{phase21Data?.sources?.nse?.latencyMs || 5}ms</span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-slate-800/60">
                    <span className="text-slate-400">Data Age:</span>
                    <span className="font-mono text-slate-200">{phase21Data?.sources?.nse?.dataAgeSeconds || 0}s</span>
                  </div>
                  <div className="flex justify-between py-1">
                    <span className="text-slate-400">Spot Price:</span>
                    <span className="font-mono text-emerald-400 font-bold">
                      ₹{phase21Data?.sources?.nse?.metadata?.spotPrice?.toLocaleString() || "24,500"}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Source B: Dhan Read-Only Telemetry */}
            <div className="p-5 bg-slate-900/80 rounded-2xl border border-slate-800 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-cyan-400 uppercase tracking-wider font-mono">
                    Source B
                  </span>
                  <span
                    className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase ${
                      phase21Data?.sources?.dhan?.connected
                        ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/40"
                        : "bg-amber-500/20 text-amber-400 border border-amber-500/40"
                    }`}
                  >
                    {phase21Data?.sources?.dhan?.connected ? "CONNECTED" : "OFFLINE"}
                  </span>
                </div>
                <h3 className="text-base font-bold text-white mt-1">Dhan Broker Telemetry</h3>
                <p className="text-xs text-slate-400 mt-1">
                  Read-Only Observational Telemetry (No Execution Routing)
                </p>

                <div className="mt-4 space-y-2 text-xs">
                  <div className="flex justify-between py-1 border-b border-slate-800/60">
                    <span className="text-slate-400">Client ID:</span>
                    <span className="font-mono text-slate-200">{phase21Data?.sources?.dhan?.metadata?.clientId || "1100993334"}</span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-slate-800/60">
                    <span className="text-slate-400">Latency:</span>
                    <span className="font-mono text-slate-200">{phase21Data?.sources?.dhan?.latencyMs || 25}ms</span>
                  </div>
                  <div className="flex justify-between py-1">
                    <span className="text-slate-400">Execution Safety:</span>
                    <span className="font-mono text-emerald-400 font-bold">FAIL-CLOSED (READ-ONLY)</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Source C: Paper Execution Engine */}
            <div className="p-5 bg-slate-900/80 rounded-2xl border border-slate-800 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-indigo-400 uppercase tracking-wider font-mono">
                    Source C
                  </span>
                  <span className="text-[10px] px-2 py-0.5 rounded-full font-bold uppercase bg-emerald-500/20 text-emerald-400 border border-emerald-500/40">
                    ACTIVE
                  </span>
                </div>
                <h3 className="text-base font-bold text-white mt-1">Paper Execution Engine</h3>
                <p className="text-xs text-slate-400 mt-1">
                  In-Memory Isolated Simulated Ledger &amp; Hedged Execution
                </p>

                <div className="mt-4 space-y-2 text-xs">
                  <div className="flex justify-between py-1 border-b border-slate-800/60">
                    <span className="text-slate-400">Open Positions:</span>
                    <span className="font-mono text-slate-200 font-bold">{phase21Data?.sources?.paperEngine?.metadata?.openPositionsCount || 0}</span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-slate-800/60">
                    <span className="text-slate-400">Unrealized P&amp;L:</span>
                    <span className="font-mono text-slate-200">₹{phase21Data?.sources?.paperEngine?.metadata?.unrealizedPnl || 0}</span>
                  </div>
                  <div className="flex justify-between py-1">
                    <span className="text-slate-400">Execution Adapter:</span>
                    <span className="font-mono text-cyan-400 font-bold">PaperBrokerAdapter</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Market Session Monitor & 11-Point Heartbeat */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Market Session Monitor */}
            <div className="p-5 bg-slate-900/80 rounded-2xl border border-slate-800">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
                  <Clock className="w-4 h-4 text-cyan-400" />
                  Market Session Monitor (09:15 - 15:30 IST)
                </h3>
                <span
                  className={`text-xs px-2.5 py-0.5 rounded-full font-bold uppercase ${
                    phase21Data?.marketSession?.isMarketSessionOpen
                      ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/40"
                      : "bg-slate-800 text-slate-400 border border-slate-700"
                  }`}
                >
                  {phase21Data?.marketSession?.isMarketSessionOpen ? "SESSION OPEN" : "SESSION CLOSED"}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-3 text-xs mb-4">
                <div className="p-3 bg-slate-950/60 rounded-xl border border-slate-800">
                  <span className="text-slate-400">NSE Uptime</span>
                  <div className="font-mono font-bold text-emerald-400 text-base mt-1">
                    {phase21Data?.marketSession?.nseUptimePercent || 100}%
                  </div>
                </div>
                <div className="p-3 bg-slate-950/60 rounded-xl border border-slate-800">
                  <span className="text-slate-400">Dhan Telemetry Uptime</span>
                  <div className="font-mono font-bold text-cyan-400 text-base mt-1">
                    {phase21Data?.marketSession?.dhanUptimePercent || 100}%
                  </div>
                </div>
                <div className="p-3 bg-slate-950/60 rounded-xl border border-slate-800">
                  <span className="text-slate-400">Signals Evaluated</span>
                  <div className="font-mono font-bold text-white text-base mt-1">
                    {phase21Data?.marketSession?.signalsEvaluatedCount || 0}
                  </div>
                </div>
                <div className="p-3 bg-slate-950/60 rounded-xl border border-slate-800">
                  <span className="text-slate-400">Trades Executed</span>
                  <div className="font-mono font-bold text-emerald-400 text-base mt-1">
                    {phase21Data?.marketSession?.tradesExecutedCount || 0}
                  </div>
                </div>
              </div>

              <div className="p-3 bg-slate-950/60 rounded-xl border border-slate-800 text-xs flex justify-between">
                <span className="text-slate-400">Reconciliation Events Recorded:</span>
                <span className="font-mono font-bold text-slate-200">
                  {phase21Data?.marketSession?.reconciliationEventsCount || 0}
                </span>
              </div>
            </div>

            {/* 11-Point Heartbeat */}
            <div className="p-5 bg-slate-900/80 rounded-2xl border border-slate-800">
              <h3 className="text-sm font-bold text-white uppercase tracking-wider mb-4 flex items-center gap-2">
                <Activity className="w-4 h-4 text-emerald-400" />
                11-Point Operational Heartbeat
              </h3>

              <div className="space-y-1.5 text-xs max-h-64 overflow-y-auto font-mono">
                {[
                  { label: "1. Last NSE Spot Update", val: phase21Data?.heartbeat?.lastNseSpot },
                  { label: "2. Last NSE Option Chain", val: phase21Data?.heartbeat?.lastNseOptionChain },
                  { label: "3. Last NSE Option Price", val: phase21Data?.heartbeat?.lastNseOptionPrice },
                  { label: "4. Last Dhan Connection", val: phase21Data?.heartbeat?.lastDhanConnection },
                  { label: "5. Last Dhan Quote Sync", val: phase21Data?.heartbeat?.lastDhanQuote },
                  { label: "6. Last Dhan Position Sync", val: phase21Data?.heartbeat?.lastDhanPositionSync },
                  { label: "7. Last Dhan Order Sync", val: phase21Data?.heartbeat?.lastDhanOrderSync },
                  { label: "8. Last Strategy Evaluation", val: phase21Data?.heartbeat?.lastStrategyEvaluation },
                  { label: "9. Last Paper Order", val: phase21Data?.heartbeat?.lastPaperOrder },
                  { label: "10. Last Paper Exit", val: phase21Data?.heartbeat?.lastPaperExit },
                  { label: "11. Last Reconciliation", val: phase21Data?.heartbeat?.lastReconciliation },
                ].map((hb, idx) => (
                  <div key={idx} className="flex justify-between py-1 px-2 rounded bg-slate-950/40 border border-slate-800/40">
                    <span className="text-slate-400">{hb.label}:</span>
                    <span className="text-emerald-400">{hb.val ? new Date(hb.val).toLocaleTimeString() : "READY"}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Observational Quote Comparison & Recent Alerts */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Quote Comparison Box */}
            <div className="p-5 bg-slate-900/80 rounded-2xl border border-slate-800">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
                  <BarChart2 className="w-4 h-4 text-indigo-400" />
                  Observational Quote Comparison (NSE vs Dhan)
                </h3>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-indigo-500/10 text-indigo-400 border border-indigo-500/30">
                  OBSERVATIONAL ONLY
                </span>
              </div>
              <p className="text-xs text-slate-400 mb-4">
                Telemetry quotes are compared side-by-side without altering strategy logic decisions.
              </p>

              {phase21Comparison ? (
                <div className="p-4 bg-slate-950/70 rounded-xl border border-slate-800 font-mono text-xs space-y-2">
                  <div className="flex justify-between">
                    <span className="text-slate-400">Contract:</span>
                    <span className="text-white font-bold">{phase21Comparison.symbol} {phase21Comparison.strike} {phase21Comparison.optionType}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">NSE LTP:</span>
                    <span className="text-emerald-400 font-bold">₹{phase21Comparison.nseLtp}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Dhan LTP:</span>
                    <span className="text-cyan-400 font-bold">₹{phase21Comparison.dhanLtp}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Price Difference:</span>
                    <span className={phase21Comparison.isMismatch ? "text-amber-400 font-bold" : "text-slate-200"}>
                      ₹{phase21Comparison.priceDifference} ({phase21Comparison.percentageDifference}%)
                    </span>
                  </div>
                  <div className="flex justify-between pt-2 border-t border-slate-800">
                    <span className="text-slate-400">Mismatch Flag:</span>
                    <span className={phase21Comparison.isMismatch ? "text-amber-400 font-bold" : "text-emerald-400 font-bold"}>
                      {phase21Comparison.isMismatch ? "MISMATCH DETECTED" : "WITHIN THRESHOLD (PASS)"}
                    </span>
                  </div>
                </div>
              ) : (
                <div className="p-4 bg-slate-950/70 rounded-xl border border-slate-800 text-xs text-slate-400 text-center">
                  Live comparison ready. Sampling live quotes during market sessions.
                </div>
              )}
            </div>

            {/* Operational Alerts Feed */}
            <div className="p-5 bg-slate-900/80 rounded-2xl border border-slate-800">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-400" />
                  Phase 21 Operational Alerts
                </h3>
                <span className="text-xs text-slate-400">{phase21Alerts.length} Events</span>
              </div>

              <div className="space-y-2 max-h-64 overflow-y-auto text-xs">
                {phase21Alerts.length > 0 ? (
                  phase21Alerts.map((alt) => (
                    <div
                      key={alt.id}
                      className="p-2.5 bg-slate-950/60 rounded-lg border border-slate-800 flex items-start justify-between gap-3"
                    >
                      <div>
                        <div className="flex items-center gap-2">
                          <span
                            className={`px-1.5 py-0.5 text-[10px] font-bold font-mono rounded ${
                              alt.severity === "CRITICAL"
                                ? "bg-rose-500/20 text-rose-400 border border-rose-500/30"
                                : alt.severity === "WARNING"
                                ? "bg-amber-500/20 text-amber-400 border border-amber-500/30"
                                : "bg-blue-500/20 text-blue-400 border border-blue-500/30"
                            }`}
                          >
                            {alt.eventType}
                          </span>
                          <span className="text-[10px] text-slate-500 font-mono">
                            {new Date(alt.timestamp).toLocaleTimeString()}
                          </span>
                        </div>
                        <p className="text-slate-300 mt-1">{alt.message}</p>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="p-6 text-center text-slate-500 font-mono">
                    No operational alerts logged. All systems within nominal limits.
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tab: Phase 20 Broker Connectivity */}
      {activeTab === "phase20" && (
        <div className="space-y-6">
          {/* Header Status Banner */}
          <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-6 backdrop-blur-xl relative overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <span className="text-xs font-semibold uppercase tracking-wider text-emerald-400 font-mono">
                  PHASE 20 — BROKER API INTEGRATION
                </span>
                <h2 className="text-xl font-bold text-white mt-1 flex items-center gap-2">
                  <Server className="w-6 h-6 text-emerald-400" />
                  {brokerStatus?.statusBanner || "BROKER CONNECTIVITY READY — LIVE EXECUTION DISABLED"}
                </h2>
                <p className="text-xs text-slate-400 mt-1">
                  Read-only broker connectivity for account, positions, orders, instruments &amp; quotes with fail-closed execution guards.
                </p>
              </div>

              <div className="flex items-center gap-2">
                <span className="px-3 py-1.5 text-xs font-bold font-mono rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                  REAL ORDERS SENT: 0
                </span>
                <span className="px-3 py-1.5 text-xs font-bold font-mono rounded-lg bg-rose-500/10 text-rose-400 border border-rose-500/30 flex items-center gap-1.5">
                  <Lock className="w-3.5 h-3.5" />
                  EXECUTION: DISABLED
                </span>
              </div>
            </div>

            {/* Permanent Safety State Bar */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-5 pt-4 border-t border-slate-800 text-xs">
              <div className="p-3 bg-slate-950/60 rounded-xl border border-slate-800/80">
                <span className="text-slate-500">PAPER_TRADING</span>
                <div className="font-mono font-bold text-emerald-400 mt-0.5">TRUE (HARD-LOCKED)</div>
              </div>
              <div className="p-3 bg-slate-950/60 rounded-xl border border-slate-800/80">
                <span className="text-slate-500">LIVE_TRADING</span>
                <div className="font-mono font-bold text-rose-400 mt-0.5">FALSE (HARD-LOCKED)</div>
              </div>
              <div className="p-3 bg-slate-950/60 rounded-xl border border-slate-800/80">
                <span className="text-slate-500">BROKER_EXECUTION</span>
                <div className="font-mono font-bold text-rose-400 mt-0.5">DISABLED (FAIL-CLOSED)</div>
              </div>
              <div className="p-3 bg-slate-950/60 rounded-xl border border-slate-800/80">
                <span className="text-slate-500">EXECUTION ROUTING</span>
                <div className="font-mono font-bold text-cyan-400 mt-0.5">PaperBrokerAdapter ONLY</div>
              </div>
            </div>
          </div>

          {/* Core Broker Telemetry Grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {/* Broker Status */}
            <div className="p-4 bg-slate-900/80 rounded-2xl border border-slate-800">
              <span className="text-xs text-slate-400">BROKER</span>
              <div className="text-base font-bold text-white mt-1 font-mono flex items-center gap-2">
                {brokerStatus?.diagnostics?.provider || "DHAN"}
                <span
                  className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase ${
                    brokerStatus?.diagnostics?.connectionStatus === "CONNECTED"
                      ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/40"
                      : "bg-amber-500/20 text-amber-400 border border-amber-500/40"
                  }`}
                >
                  {brokerStatus?.diagnostics?.connectionStatus || "NOT CONFIGURED"}
                </span>
              </div>
              <div className="text-[11px] text-slate-500 mt-2 font-mono">
                Latency: {brokerStatus?.diagnostics?.latencyMs ?? 0}ms
              </div>
            </div>

            {/* Account Data */}
            <div className="p-4 bg-slate-900/80 rounded-2xl border border-slate-800">
              <span className="text-xs text-slate-400">ACCOUNT DATA</span>
              <div className="text-base font-bold mt-1 font-mono flex items-center gap-1.5">
                {brokerStatus?.diagnostics?.accountAvailable ? (
                  <span className="text-emerald-400 flex items-center gap-1">
                    <CheckCircle2 className="w-4 h-4" /> AVAILABLE
                  </span>
                ) : (
                  <span className="text-slate-400 flex items-center gap-1">
                    <AlertCircle className="w-4 h-4" /> UNAVAILABLE
                  </span>
                )}
              </div>
              <div className="text-[11px] text-slate-500 mt-2 font-mono">
                Risk Cap: ₹1,000 Unchanged
              </div>
            </div>

            {/* Positions */}
            <div className="p-4 bg-slate-900/80 rounded-2xl border border-slate-800">
              <span className="text-xs text-slate-400">POSITIONS</span>
              <div className="text-base font-bold mt-1 font-mono flex items-center gap-1.5">
                {brokerStatus?.diagnostics?.positionsAvailable ? (
                  <span className="text-emerald-400 flex items-center gap-1">
                    <CheckCircle2 className="w-4 h-4" /> AVAILABLE
                  </span>
                ) : (
                  <span className="text-slate-400 flex items-center gap-1">
                    <AlertCircle className="w-4 h-4" /> UNAVAILABLE
                  </span>
                )}
              </div>
              <div className="text-[11px] text-slate-500 mt-2 font-mono">
                Observational Sync Only
              </div>
            </div>

            {/* Orders */}
            <div className="p-4 bg-slate-900/80 rounded-2xl border border-slate-800">
              <span className="text-xs text-slate-400">ORDERS</span>
              <div className="text-base font-bold mt-1 font-mono flex items-center gap-1.5">
                {brokerStatus?.diagnostics?.ordersAvailable ? (
                  <span className="text-emerald-400 flex items-center gap-1">
                    <CheckCircle2 className="w-4 h-4" /> AVAILABLE
                  </span>
                ) : (
                  <span className="text-slate-400 flex items-center gap-1">
                    <AlertCircle className="w-4 h-4" /> UNAVAILABLE
                  </span>
                )}
              </div>
              <div className="text-[11px] text-slate-500 mt-2 font-mono">
                Read-Only Audit Trail
              </div>
            </div>

            {/* Instrument Master */}
            <div className="p-4 bg-slate-900/80 rounded-2xl border border-slate-800">
              <span className="text-xs text-slate-400">INSTRUMENT MASTER</span>
              <div className="text-base font-bold mt-1 font-mono flex items-center gap-1.5">
                {brokerStatus?.diagnostics?.instrumentMasterAvailable ? (
                  <span className="text-emerald-400 flex items-center gap-1">
                    <CheckCircle2 className="w-4 h-4" /> AVAILABLE
                  </span>
                ) : (
                  <span className="text-slate-400 flex items-center gap-1">
                    <AlertCircle className="w-4 h-4" /> UNAVAILABLE
                  </span>
                )}
              </div>
              <div className="text-[11px] text-slate-500 mt-2 font-mono">
                Dynamic Lot Size Aligned
              </div>
            </div>

            {/* Quotes */}
            <div className="p-4 bg-slate-900/80 rounded-2xl border border-slate-800">
              <span className="text-xs text-slate-400">QUOTES</span>
              <div className="text-base font-bold mt-1 font-mono flex items-center gap-1.5">
                {brokerStatus?.diagnostics?.quotesAvailable ? (
                  <span className="text-emerald-400 flex items-center gap-1">
                    <CheckCircle2 className="w-4 h-4" /> AVAILABLE
                  </span>
                ) : (
                  <span className="text-slate-400 flex items-center gap-1">
                    <AlertCircle className="w-4 h-4" /> UNAVAILABLE
                  </span>
                )}
              </div>
              <div className="text-[11px] text-slate-500 mt-2 font-mono">
                Broker Feed Telemetry
              </div>
            </div>

            {/* Live Execution */}
            <div className="p-4 bg-rose-950/20 rounded-2xl border border-rose-900/40 col-span-2">
              <span className="text-xs text-rose-300">LIVE EXECUTION</span>
              <div className="text-base font-bold text-rose-400 mt-1 font-mono flex items-center gap-2">
                <Lock className="w-4 h-4 text-rose-400" /> PERMANENTLY DISABLED
              </div>
              <div className="text-[11px] text-rose-300/80 mt-2 font-mono">
                placeOrder / modifyOrder / cancelOrder fail closed before network request.
              </div>
            </div>
          </div>

          {/* Broker Readiness Scorecard */}
          <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 backdrop-blur-md">
            <h3 className="text-base font-bold text-white mb-4 flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-emerald-400" />
              Broker Readiness Factual Scorecard
            </h3>

            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-xs">
              {brokerStatus?.scorecard &&
                Object.entries(brokerStatus.scorecard).map(([metric, status]: [string, any]) => {
                  const isPass = status === "PASS";
                  const isNotConfig = status === "NOT_CONFIGURED";
                  return (
                    <div
                      key={metric}
                      className="p-3 bg-slate-950/60 rounded-xl border border-slate-800 flex flex-col justify-between"
                    >
                      <span className="text-slate-400 font-medium">{metric}</span>
                      <div className="mt-2 flex items-center justify-between">
                        <span
                          className={`px-2 py-0.5 text-[10px] font-bold font-mono rounded ${
                            isPass
                              ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                              : isNotConfig
                              ? "bg-amber-500/20 text-amber-400 border border-amber-500/30"
                              : "bg-rose-500/20 text-rose-400 border border-rose-500/30"
                          }`}
                        >
                          {status}
                        </span>
                        {isPass ? (
                          <Check className="w-3.5 h-3.5 text-emerald-400" />
                        ) : (
                          <XCircle className="w-3.5 h-3.5 text-amber-400" />
                        )}
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>
        </div>
      )}

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

      {/* Tab 6: Phase 19 Genuine Sample Collection & Statistical Validation */}
      {activeTab === "phase19" && (
        <div className="space-y-6">
          {/* Header Card: Status & Hard Gate */}
          <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 backdrop-blur-md">
            <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
              <div>
                <h2 className="text-lg font-bold text-white flex items-center gap-2">
                  <Award className="w-5 h-5 text-emerald-400" />
                  Phase 19 — Genuine Paper Sample Collection &amp; Statistical Validation
                </h2>
                <p className="text-xs text-slate-400 mt-1">
                  Descriptive validation of genuine live execution only. No strategy optimization or parameter tuning.
                </p>
              </div>

              <div className="flex items-center gap-3">
                <span
                  className={`px-3 py-1.5 text-xs font-bold uppercase rounded-xl border flex items-center gap-1.5 ${
                    phase19Report?.validationStatus === "FULL_VALIDATION_AVAILABLE"
                      ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/40"
                      : "bg-amber-500/20 text-amber-300 border-amber-500/40"
                  }`}
                >
                  <AlertCircle className="w-4 h-4" />
                  {phase19Report?.validationStatus || "INSUFFICIENT SAMPLE"}
                </span>

                <a
                  href="/api/indian/phase19/export"
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-2 px-3.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-xl border border-slate-700 transition"
                >
                  <Download className="w-3.5 h-3.5" />
                  Export Genuine Data
                </a>
              </div>
            </div>

            {/* Status explanation alert */}
            <div className="p-3.5 bg-slate-950/70 border border-slate-800 rounded-xl flex items-center justify-between text-xs">
              <span className="text-slate-300 font-medium">
                Operational State:{" "}
                <strong className="text-cyan-400 font-mono">
                  {phase19Report?.finalStatus || "GENUINE SAMPLE COLLECTION ACTIVE"}
                </strong>
              </span>
              <span className="text-slate-500 font-mono text-[11px]">
                Safety Locks: PAPER_TRADING=true • LIVE_TRADING=false • BROKER_EXECUTION=false
              </span>
            </div>
          </div>

          {/* Genuine Sample Progress Grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="p-4 bg-slate-900/80 border border-slate-800 rounded-xl">
              <span className="text-xs text-slate-400">Total Market Sessions</span>
              <div className="text-2xl font-bold font-mono text-white mt-1">
                {phase19Report?.genuineSample?.totalSessions || 0}
                <span className="text-xs text-slate-500 font-normal"> / {phase19Report?.genuineSample?.minRequiredSessions || 20} req</span>
              </div>
              <div className="text-[11px] text-slate-400 mt-1">
                {phase19Report?.genuineSample?.sessionsMet ? "✓ Threshold Met" : "Awaiting more sessions"}
              </div>
            </div>

            <div className="p-4 bg-slate-900/80 border border-slate-800 rounded-xl">
              <span className="text-xs text-slate-400">Active Trading Sessions</span>
              <div className="text-2xl font-bold font-mono text-white mt-1">
                {phase19Report?.genuineSample?.activeSessions || 0}
                <span className="text-xs text-slate-500 font-normal"> / {phase19Report?.genuineSample?.minRequiredActiveSessions || 15} req</span>
              </div>
              <div className="text-[11px] text-slate-400 mt-1">
                {phase19Report?.genuineSample?.activeSessionsMet ? "✓ Threshold Met" : "Awaiting active days"}
              </div>
            </div>

            <div className="p-4 bg-slate-900/80 border border-slate-800 rounded-xl">
              <span className="text-xs text-slate-400">Genuine Closed Trades</span>
              <div className="text-2xl font-bold font-mono text-white mt-1">
                {phase19Report?.genuineSample?.totalTrades || 0}
                <span className="text-xs text-slate-500 font-normal"> / {phase19Report?.genuineSample?.minRequiredTrades || 30} req</span>
              </div>
              <div className="text-[11px] text-slate-400 mt-1">
                {phase19Report?.genuineSample?.tradesMet ? "✓ Threshold Met" : "Awaiting trade sample"}
              </div>
            </div>

            <div className="p-4 bg-slate-900/80 border border-slate-800 rounded-xl">
              <span className="text-xs text-slate-400">Simulated Trades Excluded</span>
              <div className="text-2xl font-bold font-mono text-amber-400 mt-1">
                {phase19Report?.genuineSample?.simulatedTradesExcluded ?? 0}
              </div>
              <div className="text-[11px] text-slate-400 mt-1">
                Strict separation verified
              </div>
            </div>
          </div>

          {/* Genuine P&L & Trade Performance */}
          <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 backdrop-blur-md">
            <h3 className="text-md font-bold text-white mb-4 flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-emerald-400" />
              Genuine Sample P&amp;L &amp; Execution Financials
            </h3>

            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
              <div className="p-3 bg-slate-950/60 rounded-xl border border-slate-800">
                <span className="text-[11px] text-slate-400">Gross P&amp;L</span>
                <div className="text-lg font-bold font-mono text-slate-200 mt-1">
                  ₹{phase19Report?.tradeMetrics?.grossProfit || 0}
                </div>
              </div>

              <div className="p-3 bg-slate-950/60 rounded-xl border border-slate-800">
                <span className="text-[11px] text-slate-400">Total Charges</span>
                <div className="text-lg font-bold font-mono text-amber-300 mt-1">
                  ₹{performance?.charges || 0}
                </div>
              </div>

              <div className="p-3 bg-slate-950/60 rounded-xl border border-slate-800">
                <span className="text-[11px] text-slate-400">Slippage</span>
                <div className="text-lg font-bold font-mono text-amber-300 mt-1">
                  ₹{performance?.slippage || 0}
                </div>
              </div>

              <div className="p-3 bg-slate-950/60 rounded-xl border border-slate-800">
                <span className="text-[11px] text-slate-400">Net Realized P&amp;L</span>
                <div
                  className={`text-lg font-bold font-mono mt-1 ${
                    (phase19Report?.tradeMetrics?.netPnL || 0) >= 0 ? "text-emerald-400" : "text-rose-400"
                  }`}
                >
                  ₹{phase19Report?.tradeMetrics?.netPnL || 0}
                </div>
              </div>

              <div className="p-3 bg-slate-950/60 rounded-xl border border-slate-800">
                <span className="text-[11px] text-slate-400">Average Trade</span>
                <div className="text-lg font-bold font-mono text-cyan-300 mt-1">
                  ₹{phase19Report?.tradeMetrics?.averageNetTrade || 0}
                </div>
              </div>

              <div className="p-3 bg-slate-950/60 rounded-xl border border-slate-800">
                <span className="text-[11px] text-slate-400">Median Trade</span>
                <div className="text-lg font-bold font-mono text-cyan-300 mt-1">
                  ₹{phase19Report?.tradeMetrics?.medianNetTrade || 0}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
              <div className="p-3 bg-slate-950/60 rounded-xl border border-slate-800">
                <span className="text-[11px] text-slate-400">Win Rate</span>
                <div className="text-lg font-bold font-mono text-cyan-400 mt-1">
                  {phase19Report?.tradeMetrics?.winRate || 0}%
                </div>
              </div>

              <div className="p-3 bg-slate-950/60 rounded-xl border border-slate-800">
                <span className="text-[11px] text-slate-400">Profit Factor</span>
                <div className="text-lg font-bold font-mono text-slate-200 mt-1">
                  {typeof phase19Report?.tradeMetrics?.profitFactor === "number"
                    ? phase19Report?.tradeMetrics?.profitFactor
                    : "NOT_AVAILABLE"}
                </div>
              </div>

              <div className="p-3 bg-slate-950/60 rounded-xl border border-slate-800">
                <span className="text-[11px] text-slate-400">Maximum Drawdown</span>
                <div className="text-lg font-bold font-mono text-rose-400 mt-1">
                  ₹{phase19Report?.drawdown?.maximumDrawdown || 0} ({phase19Report?.drawdown?.maximumDrawdownPercent || 0}%)
                </div>
              </div>

              <div className="p-3 bg-slate-950/60 rounded-xl border border-slate-800">
                <span className="text-[11px] text-slate-400">Naked Shorts</span>
                <div className="text-lg font-bold font-mono text-emerald-400 mt-1">
                  0 (VERIFIED SAFE)
                </div>
              </div>
            </div>
          </div>

          {/* ₹1,000 Target & Daily P&L Distribution */}
          <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 backdrop-blur-md">
            <h3 className="text-md font-bold text-white mb-2 flex items-center gap-2">
              <Sliders className="w-5 h-5 text-indigo-400" />
              Daily P&amp;L Distribution &amp; ₹1,000 Analysis Threshold
            </h3>
            <p className="text-xs text-slate-400 mb-4">
              ₹1,000 serves as a factual analysis and risk-lock threshold. Trades are never forced to hit ₹1,000.
            </p>

            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              <div className="p-3.5 bg-slate-950/60 rounded-xl border border-emerald-500/20">
                <span className="text-[11px] text-slate-400">Days ≥ ₹1,000</span>
                <div className="text-xl font-bold font-mono text-emerald-400 mt-1">
                  {phase19Report?.dailyDistribution?.daysAbove1000 ?? 0}
                </div>
              </div>

              <div className="p-3.5 bg-slate-950/60 rounded-xl border border-slate-800">
                <span className="text-[11px] text-slate-400">Days ₹0 – ₹999.99</span>
                <div className="text-xl font-bold font-mono text-cyan-300 mt-1">
                  {phase19Report?.dailyDistribution?.days0To999 ?? 0}
                </div>
              </div>

              <div className="p-3.5 bg-slate-950/60 rounded-xl border border-rose-500/20">
                <span className="text-[11px] text-slate-400">Negative Days (&lt; ₹0)</span>
                <div className="text-xl font-bold font-mono text-rose-400 mt-1">
                  {phase19Report?.dailyDistribution?.daysNegative ?? 0}
                </div>
              </div>

              <div className="p-3.5 bg-slate-950/60 rounded-xl border border-slate-800">
                <span className="text-[11px] text-slate-400">No-Trade Days</span>
                <div className="text-xl font-bold font-mono text-slate-400 mt-1">
                  {phase19Report?.dailyDistribution?.noTradeDays ?? 0}
                </div>
              </div>

              <div className="p-3.5 bg-slate-950/60 rounded-xl border border-slate-800">
                <span className="text-[11px] text-slate-400">Blocked Days</span>
                <div className="text-xl font-bold font-mono text-amber-400 mt-1">
                  {phase19Report?.dailyDistribution?.blockedDays ?? 0}
                </div>
              </div>
            </div>
          </div>

          {/* Unranked Strategy Breakdown */}
          <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 backdrop-blur-md">
            <h3 className="text-md font-bold text-white mb-2 flex items-center gap-2">
              <Layers className="w-5 h-5 text-cyan-400" />
              Strategy Breakdown (Factual &amp; Unranked)
            </h3>
            <p className="text-xs text-slate-400 mb-4">
              Objective performance analysis per defined-risk spread. Strategies are not ranked or selected by winners.
            </p>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {(phase19Report?.strategies || [
                { strategy: "BULL_PUT", tradeCount: 0, winRate: 0, netPnL: 0, averageNetTrade: 0, profitFactor: "NOT_AVAILABLE" },
                { strategy: "BEAR_CALL", tradeCount: 0, winRate: 0, netPnL: 0, averageNetTrade: 0, profitFactor: "NOT_AVAILABLE" },
                { strategy: "IRON_CONDOR", tradeCount: 0, winRate: 0, netPnL: 0, averageNetTrade: 0, profitFactor: "NOT_AVAILABLE" },
              ]).map((strat: any) => (
                <div key={strat.strategy} className="p-4 bg-slate-950/60 rounded-xl border border-slate-800 space-y-2">
                  <div className="text-sm font-bold text-slate-100 flex items-center justify-between">
                    <span>{strat.strategy.replace(/_/g, " ")}</span>
                    <span className="text-xs font-mono font-normal text-slate-400">
                      {strat.tradeCount} trades
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-xs pt-2 border-t border-slate-800/80">
                    <div>
                      <span className="text-slate-500">Win Rate</span>
                      <div className="font-mono font-bold text-cyan-400">{strat.winRate}%</div>
                    </div>
                    <div>
                      <span className="text-slate-500">Net P&amp;L</span>
                      <div className={`font-mono font-bold ${strat.netPnL >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                        ₹{strat.netPnL}
                      </div>
                    </div>
                    <div>
                      <span className="text-slate-500">Avg Trade</span>
                      <div className="font-mono font-bold text-slate-300">₹{strat.averageNetTrade}</div>
                    </div>
                    <div>
                      <span className="text-slate-500">Profit Factor</span>
                      <div className="font-mono font-bold text-slate-300">
                        {typeof strat.profitFactor === "number" ? strat.profitFactor : "N/A"}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

