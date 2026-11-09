"use client";

import React, { useState, useEffect, useMemo, useCallback } from "react";
import {
  Globe2,
  TrendingUp,
  TrendingDown,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Zap,
  Activity,
  Layers,
  Clock,
  RefreshCw,
  Search,
  Filter,
  CheckCircle2,
  AlertTriangle,
  Play,
  RotateCcw,
  Sparkles,
  Lock,
  Flame,
  BarChart3,
  Sliders,
  DollarSign,
  ArrowUpRight,
  ArrowDownRight,
  ChevronRight,
  PieChart,
} from "lucide-react";

import {
  GlobalAssetSymbol,
  GlobalOpportunity,
  ActiveGlobalTrade,
  GLOBAL_ACTIVE_STORAGE_KEY,
  GLOBAL_HISTORY_STORAGE_KEY,
  DEFAULT_GLOBAL_ACTIVE_TRADES,
  DEFAULT_GLOBAL_HISTORY_TRADES,
  DEFAULT_GLOBAL_MACRO_CALENDAR,
  evaluateGlobalSmartShield,
  MacroEventItem,
} from "@/lib/forex/forexEngine";
import GlobalTradeExitAuditModal from "./GlobalTradeExitAuditModal";

export default function GlobalQuantDeskView() {
  // Navigation tabs
  const [activeTab, setActiveTab] = useState<"SIGNALS" | "ACTIVE" | "HISTORY" | "MACRO">("ACTIVE");

  // State
  const [activeTrades, setActiveTrades] = useState<ActiveGlobalTrade[]>([]);
  const [historyTrades, setHistoryTrades] = useState<ActiveGlobalTrade[]>([]);
  const [opportunities, setOpportunities] = useState<GlobalOpportunity[]>([]);
  const [macroCalendar, setMacroCalendar] = useState<MacroEventItem[]>(DEFAULT_GLOBAL_MACRO_CALENDAR);
  const [livePrices, setLivePrices] = useState<Record<string, number>>({});
  const [isScanning, setIsScanning] = useState<boolean>(false);
  const [lastSyncTime, setLastSyncTime] = useState<string>("");
  const [selectedAuditTrade, setSelectedAuditTrade] = useState<ActiveGlobalTrade | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<"ALL" | "METALS" | "CRYPTO">("ALL");

  // ─── 1. Hydrate from LocalStorage ───────────────────────────────────────────
  useEffect(() => {
    try {
      const savedActive = localStorage.getItem(GLOBAL_ACTIVE_STORAGE_KEY);
      if (savedActive) {
        const parsed: ActiveGlobalTrade[] = JSON.parse(savedActive);
        setActiveTrades(parsed.length > 0 ? parsed : DEFAULT_GLOBAL_ACTIVE_TRADES);
      } else {
        setActiveTrades(DEFAULT_GLOBAL_ACTIVE_TRADES);
        localStorage.setItem(GLOBAL_ACTIVE_STORAGE_KEY, JSON.stringify(DEFAULT_GLOBAL_ACTIVE_TRADES));
      }

      const savedHistory = localStorage.getItem(GLOBAL_HISTORY_STORAGE_KEY);
      if (savedHistory) {
        const parsed: ActiveGlobalTrade[] = JSON.parse(savedHistory);
        setHistoryTrades(parsed.length > 0 ? parsed : DEFAULT_GLOBAL_HISTORY_TRADES);
      } else {
        setHistoryTrades(DEFAULT_GLOBAL_HISTORY_TRADES);
        localStorage.setItem(GLOBAL_HISTORY_STORAGE_KEY, JSON.stringify(DEFAULT_GLOBAL_HISTORY_TRADES));
      }
    } catch (err) {
      console.warn("Failed to read global desk trades from localStorage", err);
      setActiveTrades(DEFAULT_GLOBAL_ACTIVE_TRADES);
      setHistoryTrades(DEFAULT_GLOBAL_HISTORY_TRADES);
    }
  }, []);

  // ─── 2. Fetch Scanner Data & Sync Live Prices ──────────────────────────────
  const fetchScannerData = useCallback(async () => {
    setIsScanning(true);
    try {
      const activeSymbols = activeTrades.map((t) => t.symbol).join(",");
      const res = await fetch(`/api/forex/scanner?activeSymbols=${encodeURIComponent(activeSymbols)}`);
      if (!res.ok) throw new Error("Scanner API returned non-OK");
      const data = await res.json();

      if (data.success) {
        setOpportunities(data.opportunities || []);
        if (data.livePrices) {
          setLivePrices(data.livePrices);
        }
        if (data.macroCalendar) {
          setMacroCalendar(data.macroCalendar);
        }
        setLastSyncTime(new Date().toLocaleTimeString("en-GB", { timeZone: "Asia/Kolkata" }) + " IST");
      }
    } catch (err) {
      console.warn("Failed to fetch global scanner data", err);
    } finally {
      setIsScanning(false);
    }
  }, [activeTrades]);

  useEffect(() => {
    fetchScannerData();
    const interval = setInterval(fetchScannerData, 20000); // 20s polling
    return () => clearInterval(interval);
  }, [fetchScannerData]);

  // ─── 3. Recalculate Active Trades against Live LTP ───────────────────────────
  useEffect(() => {
    if (activeTrades.length === 0) return;

    let hasChanges = false;
    const updatedTrades: ActiveGlobalTrade[] = [];
    const closedToHistory: ActiveGlobalTrade[] = [];

    for (const trade of activeTrades) {
      const ltp = livePrices[trade.symbol] || livePrices[trade.ticker] || trade.currentPrice;
      const peak = Math.max(trade.peakPrice || trade.entryPrice, ltp);

      const shield = evaluateGlobalSmartShield({
        trade,
        currentPrice: ltp,
        peakPrice: peak,
      });

      if (shield.shouldAutoExit && shield.exitTag) {
        // Trade closed via TP, SL, TSL Breakeven, or Reversal
        hasChanges = true;
        const closedTrade: ActiveGlobalTrade = {
          ...trade,
          currentPrice: ltp,
          peakPrice: peak,
          pnlAmount: shield.pnlAmount,
          pnlPercent: shield.pnlPercent,
          targetProgressPct: shield.targetProgressPct,
          isTslCostLocked: shield.isTslCostLocked,
          status: "CLOSED",
          exitPrice: ltp,
          exitTag: shield.exitTag,
          exitReason: shield.exitReason ?? undefined,
          exitTimeIst: new Date().toLocaleTimeString("en-GB", { timeZone: "Asia/Kolkata" }) + " IST",
          reversalMetrics: shield.reversalMetrics,
        };
        closedToHistory.push(closedTrade);
      } else {
        const isModified =
          trade.currentPrice !== ltp ||
          trade.isTslCostLocked !== shield.isTslCostLocked ||
          trade.currentStopLoss !== shield.updatedStopLoss ||
          trade.targetProgressPct !== shield.targetProgressPct;

        if (isModified) hasChanges = true;

        updatedTrades.push({
          ...trade,
          currentPrice: ltp,
          peakPrice: peak,
          currentStopLoss: shield.updatedStopLoss,
          isTslCostLocked: shield.isTslCostLocked,
          targetProgressPct: shield.targetProgressPct,
          pnlAmount: shield.pnlAmount,
          pnlPercent: shield.pnlPercent,
          macroShieldHeadline: shield.macroShieldHeadline,
        });
      }
    }

    if (hasChanges) {
      setActiveTrades(updatedTrades);
      localStorage.setItem(GLOBAL_ACTIVE_STORAGE_KEY, JSON.stringify(updatedTrades));

      if (closedToHistory.length > 0) {
        setHistoryTrades((prev) => {
          const next = [...closedToHistory, ...prev];
          localStorage.setItem(GLOBAL_HISTORY_STORAGE_KEY, JSON.stringify(next));
          return next;
        });
      }
    }
  }, [livePrices, activeTrades]);

  // ─── 4. User Actions ────────────────────────────────────────────────────────

  // Deploy Opportunity to Active Portfolio
  const handleDeployOpportunity = (opp: GlobalOpportunity) => {
    const ltp = livePrices[opp.symbol] || opp.entryPrice;
    const newTrade: ActiveGlobalTrade = {
      tradeId: `GLOBAL-ACT-${opp.symbol}-${Date.now().toString().slice(-4)}`,
      symbol: opp.symbol,
      ticker: opp.ticker,
      assetName: opp.assetName,
      category: opp.category,
      direction: opp.direction,
      strategyId: opp.strategyId,
      strategyBadge: opp.strategyBadge,
      entryPrice: ltp,
      currentPrice: ltp,
      initialStopLoss: opp.stopLossPrice,
      currentStopLoss: opp.stopLossPrice,
      targetPrice: opp.targetPrice,
      rewardRiskRatio: opp.rewardRiskRatio,
      units: opp.recommendedLotSize,
      pnlAmount: 0.0,
      pnlPercent: 0.0,
      targetProgressPct: 0.0,
      peakPrice: ltp,
      isTslCostLocked: false,
      status: "ACTIVE",
      macroShieldStatus: opp.macroShield.status,
      macroShieldHeadline: opp.macroShield.notes,
      entryTimestamp: new Date().toISOString(),
      executionTimeIst: new Date().toLocaleTimeString("en-GB", { timeZone: "Asia/Kolkata" }) + " IST",
    };

    const nextActive = [newTrade, ...activeTrades];
    setActiveTrades(nextActive);
    localStorage.setItem(GLOBAL_ACTIVE_STORAGE_KEY, JSON.stringify(nextActive));

    // Remove from screener view
    setOpportunities((prev) => prev.filter((o) => o.id !== opp.id));
    setActiveTab("ACTIVE");
  };

  // Emergency Square-Off
  const handleEmergencyExit = (tradeId: string) => {
    const target = activeTrades.find((t) => t.tradeId === tradeId);
    if (!target) return;

    const remainingActive = activeTrades.filter((t) => t.tradeId !== tradeId);
    setActiveTrades(remainingActive);
    localStorage.setItem(GLOBAL_ACTIVE_STORAGE_KEY, JSON.stringify(remainingActive));

    const ltp = livePrices[target.symbol] || target.currentPrice;
    const priceDiff =
      target.direction === "LONG" ? ltp - target.entryPrice : target.entryPrice - ltp;

    const closedTrade: ActiveGlobalTrade = {
      ...target,
      status: "CLOSED",
      exitPrice: ltp,
      pnlAmount: Number((priceDiff * target.units).toFixed(2)),
      pnlPercent: Number(((priceDiff / target.entryPrice) * 100).toFixed(2)),
      exitTag: "MANUAL_EMERGENCY_EXIT",
      exitReason: `⚡ Manual Emergency Square-Off executed at $${ltp.toFixed(2)}`,
      exitTimeIst: new Date().toLocaleTimeString("en-GB", { timeZone: "Asia/Kolkata" }) + " IST",
      reversalMetrics: {
        wickRejectionPct: 15.0,
        volumeMultiplier: 1.5,
        peakReversalDrawdownPct: 0.5,
        macroHeadline: "Manual Emergency Square-Off Triggered",
      },
    };

    setHistoryTrades((prev) => {
      const next = [closedTrade, ...prev];
      localStorage.setItem(GLOBAL_HISTORY_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  };

  // Simulate Catalyst Test
  const handleSimulateCatalyst = (tradeId: string) => {
    const target = activeTrades.find((t) => t.tradeId === tradeId);
    if (!target) return;

    const simulatedResult = evaluateGlobalSmartShield({
      trade: target,
      currentPrice: target.currentPrice,
      forcedCatalyst: {
        type: "MACRO_SHOCK",
        headline: "US Core CPI 3.5% YoY vs 3.1% exp - Sudden Dollar Index Reversal Surge",
      },
    });

    const remainingActive = activeTrades.filter((t) => t.tradeId !== tradeId);
    setActiveTrades(remainingActive);
    localStorage.setItem(GLOBAL_ACTIVE_STORAGE_KEY, JSON.stringify(remainingActive));

    const closedTrade: ActiveGlobalTrade = {
      ...target,
      status: "CLOSED",
      exitPrice: target.currentPrice,
      pnlAmount: simulatedResult.pnlAmount,
      pnlPercent: simulatedResult.pnlPercent,
      exitTag: simulatedResult.exitTag || "MACRO_CATALYST_EXIT",
      exitReason: simulatedResult.exitReason || "Simulated Macro Catalyst Shock Triggered",
      exitTimeIst: new Date().toLocaleTimeString("en-GB", { timeZone: "Asia/Kolkata" }) + " IST",
      reversalMetrics: simulatedResult.reversalMetrics,
    };

    setHistoryTrades((prev) => {
      const next = [closedTrade, ...prev];
      localStorage.setItem(GLOBAL_HISTORY_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  };

  // Reset to Defaults
  const handleResetDefaults = () => {
    setActiveTrades(DEFAULT_GLOBAL_ACTIVE_TRADES);
    localStorage.setItem(GLOBAL_ACTIVE_STORAGE_KEY, JSON.stringify(DEFAULT_GLOBAL_ACTIVE_TRADES));
    setHistoryTrades(DEFAULT_GLOBAL_HISTORY_TRADES);
    localStorage.setItem(GLOBAL_HISTORY_STORAGE_KEY, JSON.stringify(DEFAULT_GLOBAL_HISTORY_TRADES));
    fetchScannerData();
  };

  // ─── Metrics Computations ───────────────────────────────────────────────────
  const deskMetrics = useMemo(() => {
    const totalActivePnlUsd = activeTrades.reduce((acc, t) => acc + t.pnlAmount, 0);
    const totalClosedPnlUsd = historyTrades.reduce((acc, t) => acc + t.pnlAmount, 0);
    const winningClosedTrades = historyTrades.filter((t) => t.pnlAmount > 0).length;
    const winRatePct =
      historyTrades.length > 0 ? (winningClosedTrades / historyTrades.length) * 100 : 0;
    const tslLockedCount = activeTrades.filter((t) => t.isTslCostLocked).length;

    return {
      totalActivePnlUsd,
      totalClosedPnlUsd,
      totalCombinedPnlUsd: totalActivePnlUsd + totalClosedPnlUsd,
      winRatePct: Number(winRatePct.toFixed(1)),
      activeCount: activeTrades.length,
      closedCount: historyTrades.length,
      tslLockedCount,
    };
  }, [activeTrades, historyTrades]);

  const filteredOpportunities = useMemo(() => {
    if (categoryFilter === "ALL") return opportunities;
    return opportunities.filter((o) => o.category === categoryFilter);
  }, [opportunities, categoryFilter]);

  return (
    <div className="space-y-6">
      {/* ─── Top Desk Header Banner ─── */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-[#0d1424] via-[#091122] to-[#070b14] border border-cyan-500/20 p-6 shadow-2xl">
        <div className="absolute top-0 right-0 w-96 h-96 bg-cyan-500/5 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute bottom-0 left-1/3 w-80 h-80 bg-amber-500/5 rounded-full blur-3xl pointer-events-none" />

        <div className="relative flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-cyan-600/30 to-amber-500/30 border border-cyan-400/40 flex items-center justify-center text-cyan-300 shadow-lg shadow-cyan-500/10">
              <Globe2 className="w-7 h-7 text-cyan-300 animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-2.5">
                <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-white font-mono">
                  GLOBAL & FOREX QUANT DESK
                </h1>
                <span className="text-[11px] font-mono px-2.5 py-0.5 rounded-full bg-cyan-500/10 text-cyan-400 border border-cyan-500/30 font-semibold flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-cyan-400 animate-ping" />
                  Gold · BTC-USD · ETH-USD
                </span>
              </div>
              <p className="text-xs sm:text-sm text-slate-400 mt-1 font-sans">
                Institutional London/NY Liquidity Sweeps, 15M Order Block Mitigation & 2.2x Volume Breakouts
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <div className="text-right hidden sm:block">
              <div className="text-[10px] uppercase font-mono text-slate-400 tracking-wider">
                Live Macro Shield
              </div>
              <div className="text-xs font-mono text-emerald-400 font-semibold flex items-center gap-1">
                <ShieldCheck className="w-3.5 h-3.5" /> 🟢 Clean US Feed
              </div>
            </div>

            <button
              onClick={fetchScannerData}
              disabled={isScanning}
              className="px-3.5 py-2 rounded-xl bg-slate-800/80 hover:bg-slate-700/80 border border-slate-700 text-slate-200 text-xs font-mono flex items-center gap-2 transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 text-cyan-400 ${isScanning ? "animate-spin" : ""}`} />
              <span>{isScanning ? "Scanning..." : "Sync Feeds"}</span>
            </button>

            <button
              onClick={handleResetDefaults}
              className="px-3.5 py-2 rounded-xl bg-slate-800/40 hover:bg-slate-800 border border-slate-700/60 text-slate-400 hover:text-slate-200 text-xs font-mono flex items-center gap-1.5 transition-colors"
              title="Reset Seeds to Default Portfolio"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Reset</span>
            </button>
          </div>
        </div>

        {/* ─── Metric KPI Strip ─── */}
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3 mt-6 pt-5 border-t border-slate-800/70">
          <div className="bg-slate-900/60 border border-slate-800/80 rounded-xl p-3">
            <div className="text-[10px] uppercase font-mono text-slate-400">Active Desk P&L</div>
            <div
              className={`text-lg font-bold font-mono mt-0.5 ${
                deskMetrics.totalActivePnlUsd >= 0 ? "text-emerald-400" : "text-rose-400"
              }`}
            >
              {deskMetrics.totalActivePnlUsd >= 0 ? "+" : ""}${deskMetrics.totalActivePnlUsd.toFixed(2)}
            </div>
            <div className="text-[10px] font-mono text-slate-500">
              {deskMetrics.activeCount} open positions
            </div>
          </div>

          <div className="bg-slate-900/60 border border-slate-800/80 rounded-xl p-3">
            <div className="text-[10px] uppercase font-mono text-slate-400">Total Closed P&L</div>
            <div
              className={`text-lg font-bold font-mono mt-0.5 ${
                deskMetrics.totalClosedPnlUsd >= 0 ? "text-emerald-400" : "text-rose-400"
              }`}
            >
              {deskMetrics.totalClosedPnlUsd >= 0 ? "+" : ""}${deskMetrics.totalClosedPnlUsd.toFixed(2)}
            </div>
            <div className="text-[10px] font-mono text-slate-500">
              {deskMetrics.closedCount} archived trades
            </div>
          </div>

          <div className="bg-slate-900/60 border border-slate-800/80 rounded-xl p-3">
            <div className="text-[10px] uppercase font-mono text-slate-400">Desk Win Rate</div>
            <div className="text-lg font-bold font-mono text-cyan-400 mt-0.5">
              {deskMetrics.winRatePct}%
            </div>
            <div className="text-[10px] font-mono text-slate-500">Strict ≥ 1:2.5 RR</div>
          </div>

          <div className="bg-slate-900/60 border border-slate-800/80 rounded-xl p-3">
            <div className="text-[10px] uppercase font-mono text-slate-400">TSL-to-Cost Locked</div>
            <div className="text-lg font-bold font-mono text-amber-400 mt-0.5 flex items-center gap-1.5">
              <Lock className="w-4 h-4 text-amber-400" />
              {deskMetrics.tslLockedCount} Trades
            </div>
            <div className="text-[10px] font-mono text-slate-500">70% target reached</div>
          </div>

          <div className="bg-slate-900/60 border border-slate-800/80 rounded-xl p-3">
            <div className="text-[10px] uppercase font-mono text-slate-400">Gold Spot (GC=F)</div>
            <div className="text-lg font-bold font-mono text-amber-300 mt-0.5">
              ${(livePrices["XAUUSD"] || livePrices["GC=F"] || 2744.8).toFixed(1)}
            </div>
            <div className="text-[10px] font-mono text-slate-500">London/NY Session</div>
          </div>

          <div className="bg-slate-900/60 border border-slate-800/80 rounded-xl p-3">
            <div className="text-[10px] uppercase font-mono text-slate-400">Bitcoin (BTC-USD)</div>
            <div className="text-lg font-bold font-mono text-emerald-300 mt-0.5">
              ${(livePrices["BTCUSD"] || livePrices["BTC-USD"] || 88450).toLocaleString()}
            </div>
            <div className="text-[10px] font-mono text-slate-500">24/7 Global Orderflow</div>
          </div>
        </div>
      </div>

      {/* ─── Navigation Tabs ─── */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800/80 pb-3">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setActiveTab("ACTIVE")}
            className={`px-4 py-2.5 rounded-xl font-mono text-xs font-semibold flex items-center gap-2 transition-all ${
              activeTab === "ACTIVE"
                ? "bg-cyan-500/10 text-cyan-300 border border-cyan-500/30 shadow-lg shadow-cyan-500/10"
                : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/40 border border-transparent"
            }`}
          >
            <Activity className="w-4 h-4 text-cyan-400" />
            <span>Active Positions ({activeTrades.length})</span>
          </button>

          <button
            onClick={() => setActiveTab("SIGNALS")}
            className={`px-4 py-2.5 rounded-xl font-mono text-xs font-semibold flex items-center gap-2 transition-all ${
              activeTab === "SIGNALS"
                ? "bg-cyan-500/10 text-cyan-300 border border-cyan-500/30 shadow-lg shadow-cyan-500/10"
                : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/40 border border-transparent"
            }`}
          >
            <Zap className="w-4 h-4 text-amber-400" />
            <span>Signals & Screener ({opportunities.length})</span>
          </button>

          <button
            onClick={() => setActiveTab("HISTORY")}
            className={`px-4 py-2.5 rounded-xl font-mono text-xs font-semibold flex items-center gap-2 transition-all ${
              activeTab === "HISTORY"
                ? "bg-cyan-500/10 text-cyan-300 border border-cyan-500/30 shadow-lg shadow-cyan-500/10"
                : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/40 border border-transparent"
            }`}
          >
            <BarChart3 className="w-4 h-4 text-violet-400" />
            <span>Backtest & Audit Ledger ({historyTrades.length})</span>
          </button>

          <button
            onClick={() => setActiveTab("MACRO")}
            className={`px-4 py-2.5 rounded-xl font-mono text-xs font-semibold flex items-center gap-2 transition-all ${
              activeTab === "MACRO"
                ? "bg-cyan-500/10 text-cyan-300 border border-cyan-500/30 shadow-lg shadow-cyan-500/10"
                : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/40 border border-transparent"
            }`}
          >
            <ShieldAlert className="w-4 h-4 text-emerald-400" />
            <span>US Macro Shield</span>
          </button>
        </div>

        {lastSyncTime && (
          <div className="text-xs font-mono text-slate-500 flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5" />
            <span>Last Sync: {lastSyncTime}</span>
          </div>
        )}
      </div>

      {/* ─── TAB 1: ACTIVE POSITIONS ─── */}
      {activeTab === "ACTIVE" && (
        <div className="space-y-4">
          {activeTrades.length === 0 ? (
            <div className="text-center py-16 px-4 rounded-2xl bg-slate-900/40 border border-slate-800/80">
              <Globe2 className="w-12 h-12 text-slate-600 mx-auto mb-3" />
              <h3 className="text-base font-bold text-slate-300 font-mono">No Active Global Positions Running</h3>
              <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto">
                Explore high-confluence London/NY liquidity sweeps and crypto breakouts in the Signals & Screener tab.
              </p>
              <button
                onClick={() => setActiveTab("SIGNALS")}
                className="mt-4 px-4 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-mono text-xs font-medium transition-colors"
              >
                View Live Signals
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              {activeTrades.map((trade) => {
                const isLong = trade.direction === "LONG";
                const isProfit = trade.pnlAmount >= 0;
                const ltp = trade.currentPrice;

                return (
                  <div
                    key={trade.tradeId}
                    className="relative overflow-hidden rounded-2xl bg-gradient-to-b from-[#0d1424] to-[#090e1a] border border-slate-800/80 hover:border-cyan-500/30 p-5 transition-all shadow-xl"
                  >
                    {/* Top Row: Symbol, Direction, Strategy, Badge */}
                    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pb-3 border-b border-slate-800/60">
                      <div className="flex items-center gap-3">
                        <div
                          className={`w-10 h-10 rounded-xl flex items-center justify-center font-mono font-bold text-sm ${
                            trade.category === "METALS"
                              ? "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                              : "bg-cyan-500/10 text-cyan-400 border border-cyan-500/20"
                          }`}
                        >
                          {trade.symbol === "XAUUSD" ? "Au" : trade.symbol === "BTCUSD" ? "₿" : "Ξ"}
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-base font-bold font-mono text-white tracking-wide">
                              {trade.symbol}
                            </span>
                            <span
                              className={`text-[10px] font-mono px-2 py-0.5 rounded font-bold ${
                                isLong
                                  ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                                  : "bg-rose-500/10 text-rose-400 border border-rose-500/20"
                              }`}
                            >
                              {trade.direction}
                            </span>
                            <span className="text-xs text-slate-400 font-mono hidden md:inline">
                              {trade.assetName}
                            </span>
                          </div>
                          <div className="text-xs text-slate-400 font-mono mt-0.5 flex items-center gap-2">
                            <span className="text-cyan-400">{trade.strategyBadge}</span>
                            <span>·</span>
                            <span>Executed: {trade.executionTimeIst}</span>
                            <span>·</span>
                            <span>Units: {trade.units}</span>
                          </div>
                        </div>
                      </div>

                      {/* Live P&L Box */}
                      <div className="flex items-center gap-4">
                        <div className="text-right">
                          <div className="text-[10px] uppercase font-mono text-slate-400">Unrealized P&L</div>
                          <div
                            className={`text-xl font-bold font-mono flex items-center justify-end gap-1 ${
                              isProfit ? "text-emerald-400" : "text-rose-400"
                            }`}
                          >
                            {isProfit ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
                            {isProfit ? "+" : ""}${trade.pnlAmount.toFixed(2)}
                            <span className="text-xs font-normal">
                              ({trade.pnlPercent > 0 ? "+" : ""}{trade.pnlPercent}%)
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Middle Row: Trade Parameters (Entry, SL, TP, Progress) */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 py-4 text-xs font-mono">
                      <div>
                        <span className="text-slate-500 uppercase text-[10px] block">Entry Locked:</span>
                        <span className="font-bold text-white text-sm">${trade.entryPrice.toFixed(2)}</span>
                      </div>

                      <div>
                        <span className="text-slate-500 uppercase text-[10px] block">Live Market LTP:</span>
                        <span className="font-bold text-cyan-300 text-sm">${ltp.toFixed(2)}</span>
                      </div>

                      <div>
                        <span className="text-slate-500 uppercase text-[10px] block">Current Stop Loss:</span>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <span
                            className={`font-bold text-sm ${
                              trade.isTslCostLocked ? "text-amber-400" : "text-rose-400"
                            }`}
                          >
                            ${trade.currentStopLoss.toFixed(2)}
                          </span>
                          {trade.isTslCostLocked && (
                            <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30 flex items-center gap-0.5">
                              <Lock className="w-2.5 h-2.5" /> BE
                            </span>
                          )}
                        </div>
                      </div>

                      <div>
                        <span className="text-slate-500 uppercase text-[10px] block">Target (TP 1:2.5+):</span>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <span className="font-bold text-emerald-400 text-sm">${trade.targetPrice.toFixed(2)}</span>
                          <span className="text-[10px] text-cyan-400 font-semibold">(1:{trade.rewardRiskRatio})</span>
                        </div>
                      </div>
                    </div>

                    {/* Target Progress Bar */}
                    <div className="space-y-1.5 pt-1 pb-3">
                      <div className="flex items-center justify-between text-[11px] font-mono">
                        <span className="text-slate-400 flex items-center gap-1">
                          Target Progress:{" "}
                          <strong className="text-white">{trade.targetProgressPct.toFixed(1)}%</strong>
                        </span>
                        <div className="flex items-center gap-2">
                          {trade.targetProgressPct >= 70 ? (
                            <span className="text-amber-300 text-[10px] font-semibold flex items-center gap-1">
                              <Lock className="w-3 h-3" /> Stop-Loss Shifted to Cost (Breakeven Locked)
                            </span>
                          ) : (
                            <span className="text-slate-500 text-[10px]">
                              TSL locks to Breakeven at 70%
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="relative w-full h-2.5 rounded-full bg-slate-800/80 overflow-hidden">
                        <div
                          className="absolute left-[70%] top-0 bottom-0 w-0.5 bg-amber-400 z-10"
                          title="70% Breakeven Lock Threshold"
                        />
                        <div
                          className={`h-full rounded-full transition-all duration-300 ${
                            trade.targetProgressPct >= 70
                              ? "bg-gradient-to-r from-cyan-500 via-amber-400 to-emerald-400"
                              : "bg-gradient-to-r from-cyan-500 to-cyan-400"
                          }`}
                          style={{ width: `${Math.max(2, Math.min(100, trade.targetProgressPct))}%` }}
                        />
                      </div>
                    </div>

                    {/* Bottom Action Strip */}
                    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pt-3 border-t border-slate-800/60">
                      <div className="flex items-center gap-2 text-xs font-mono">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-semibold flex items-center gap-1 ${
                            trade.macroShieldStatus === "CATALYST_ALERT"
                              ? "bg-rose-500/10 text-rose-300 border border-rose-500/30"
                              : "bg-emerald-500/10 text-emerald-300 border border-emerald-500/30"
                          }`}
                        >
                          {trade.macroShieldStatus === "CATALYST_ALERT" ? (
                            <ShieldAlert className="w-3 h-3 text-rose-400" />
                          ) : (
                            <ShieldCheck className="w-3 h-3 text-emerald-400" />
                          )}
                          {trade.macroShieldHeadline || "🟢 Clean Macro & Reversal Shield"}
                        </span>
                      </div>

                      <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
                        <button
                          onClick={() => handleSimulateCatalyst(trade.tradeId)}
                          className="px-3 py-1.5 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/30 text-xs font-mono flex items-center gap-1.5 transition-colors"
                          title="Simulate sudden adverse macro catalyst (CPI/FOMC shock) to test automated capital protection"
                        >
                          <Flame className="w-3.5 h-3.5 text-amber-400" />
                          <span>🧪 Sim Catalyst Test</span>
                        </button>

                        <button
                          onClick={() => handleEmergencyExit(trade.tradeId)}
                          className="px-3 py-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/30 text-xs font-mono font-semibold flex items-center gap-1.5 transition-colors"
                          title="Immediately square off and archive position into history"
                        >
                          <Zap className="w-3.5 h-3.5 text-rose-400" />
                          <span>⚡ Emergency Square-off Now</span>
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ─── TAB 2: SIGNALS & SCREENER ─── */}
      {activeTab === "SIGNALS" && (
        <div className="space-y-4">
          {/* Filter Bar */}
          <div className="flex items-center justify-between p-3 rounded-xl bg-slate-900/60 border border-slate-800">
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono text-slate-400">Filter Category:</span>
              <button
                onClick={() => setCategoryFilter("ALL")}
                className={`px-3 py-1 rounded-lg text-xs font-mono transition-colors ${
                  categoryFilter === "ALL"
                    ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/40"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                All Assets
              </button>
              <button
                onClick={() => setCategoryFilter("METALS")}
                className={`px-3 py-1 rounded-lg text-xs font-mono transition-colors ${
                  categoryFilter === "METALS"
                    ? "bg-amber-500/20 text-amber-300 border border-amber-500/40"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                Gold (XAUUSD)
              </button>
              <button
                onClick={() => setCategoryFilter("CRYPTO")}
                className={`px-3 py-1 rounded-lg text-xs font-mono transition-colors ${
                  categoryFilter === "CRYPTO"
                    ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/40"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                Crypto-FX (BTC/ETH)
              </button>
            </div>

            <div className="text-xs font-mono text-slate-400">
              Showing {filteredOpportunities.length} setups
            </div>
          </div>

          {filteredOpportunities.length === 0 ? (
            <div className="text-center py-16 px-4 rounded-2xl bg-slate-900/40 border border-slate-800/80">
              <Zap className="w-12 h-12 text-slate-600 mx-auto mb-3" />
              <h3 className="text-base font-bold text-slate-300 font-mono">No New Unallocated Signals</h3>
              <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto">
                Existing high-confluence setups are already deployed in Active Positions. Positions will reappear once closed or when new sweeps/breakouts trigger.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {filteredOpportunities.map((opp) => {
                const isLong = opp.direction === "LONG";
                const isGold = opp.symbol === "XAUUSD";

                return (
                  <div
                    key={opp.id}
                    className="rounded-2xl bg-gradient-to-b from-[#0d1424] to-[#090e1a] border border-slate-800/80 hover:border-cyan-500/40 p-5 transition-all shadow-xl flex flex-col justify-between"
                  >
                    <div>
                      {/* Card Header */}
                      <div className="flex items-center justify-between pb-3 border-b border-slate-800/60">
                        <div className="flex items-center gap-3">
                          <div
                            className={`w-10 h-10 rounded-xl flex items-center justify-center font-mono font-bold text-sm ${
                              isGold
                                ? "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                                : "bg-cyan-500/10 text-cyan-400 border border-cyan-500/20"
                            }`}
                          >
                            {opp.symbol === "XAUUSD" ? "Au" : opp.symbol === "BTCUSD" ? "₿" : "Ξ"}
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="text-base font-bold font-mono text-white tracking-wide">
                                {opp.symbol}
                              </span>
                              <span
                                className={`text-[10px] font-mono px-2 py-0.5 rounded font-bold ${
                                  isLong
                                    ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                                    : "bg-rose-500/10 text-rose-400 border border-rose-500/20"
                                }`}
                              >
                                {opp.direction}
                              </span>
                              <span className="text-xs text-slate-400 font-mono">
                                Confluence: {opp.confluenceScore}/100
                              </span>
                            </div>
                            <div className="text-xs text-cyan-400 font-mono mt-0.5">
                              {opp.strategyBadge}
                            </div>
                          </div>
                        </div>

                        <div className="text-right font-mono">
                          <div className="text-[10px] text-slate-400 uppercase">Live Entry LTP</div>
                          <div className="text-base font-bold text-white">${opp.entryPrice.toFixed(2)}</div>
                        </div>
                      </div>

                      {/* Trade Parameters Strip */}
                      <div className="grid grid-cols-3 gap-2 py-3.5 text-xs font-mono">
                        <div className="p-2.5 rounded-xl bg-slate-900/60 border border-slate-800">
                          <span className="text-[10px] uppercase text-slate-500 block">Stop-Loss (OB)</span>
                          <span className="font-bold text-rose-400 text-sm mt-0.5 block">
                            ${opp.stopLossPrice.toFixed(2)}
                          </span>
                          <span className="text-[10px] text-slate-500">Risk: ${opp.riskPerUnit}</span>
                        </div>

                        <div className="p-2.5 rounded-xl bg-slate-900/60 border border-slate-800">
                          <span className="text-[10px] uppercase text-slate-500 block">Take-Profit (TP)</span>
                          <span className="font-bold text-emerald-400 text-sm mt-0.5 block">
                            ${opp.targetPrice.toFixed(2)}
                          </span>
                          <span className="text-[10px] text-slate-500">Gain: ${opp.rewardPerUnit}</span>
                        </div>

                        <div className="p-2.5 rounded-xl bg-slate-900/60 border border-slate-800">
                          <span className="text-[10px] uppercase text-slate-500 block">Risk:Reward</span>
                          <span className="font-bold text-cyan-300 text-sm mt-0.5 block">
                            1:{opp.rewardRiskRatio}
                          </span>
                          <span className="text-[10px] text-emerald-400 font-semibold">Strict ≥ 2.5 RR</span>
                        </div>
                      </div>

                      {/* Setup Rationale List */}
                      <div className="space-y-1.5 py-2">
                        {opp.rationale.map((r, i) => (
                          <div key={i} className="text-xs font-mono text-slate-300 flex items-start gap-1.5">
                            <span className="text-cyan-400 mt-0.5">▸</span>
                            <span>{r}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Deploy Action */}
                    <div className="pt-4 border-t border-slate-800/60 flex items-center justify-between gap-3 mt-3">
                      <div className="text-[11px] font-mono text-slate-400">
                        Lot: <strong className="text-white">{opp.recommendedLotSize}</strong> · {opp.category}
                      </div>

                      <button
                        onClick={() => handleDeployOpportunity(opp)}
                        className="px-4 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-mono text-xs font-bold transition-all shadow-lg shadow-cyan-600/20 flex items-center gap-1.5"
                      >
                        <Play className="w-3.5 h-3.5 fill-current" />
                        <span>Deploy Position</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ─── TAB 3: BACKTEST & AUDIT LEDGER ─── */}
      {activeTab === "HISTORY" && (
        <div className="space-y-4">
          <div className="rounded-2xl bg-gradient-to-b from-[#0d1424] to-[#090e1a] border border-slate-800/80 p-5 shadow-xl">
            <div className="flex items-center justify-between pb-4 border-b border-slate-800/80">
              <div>
                <h3 className="text-base font-bold font-mono text-white">Closed Trades & Audit Ledger</h3>
                <p className="text-xs text-slate-400 font-mono mt-0.5">
                  Click any row to open the Interactive Exit Audit Modal detailing exact trigger rationale & microstructure.
                </p>
              </div>
              <div className="text-xs font-mono text-cyan-400 font-semibold">
                {historyTrades.length} Total Executions Logged
              </div>
            </div>

            <div className="overflow-x-auto mt-3">
              <table className="w-full text-left font-mono text-xs">
                <thead>
                  <tr className="border-b border-slate-800 text-[11px] uppercase text-slate-400">
                    <th className="py-3 px-3">Symbol</th>
                    <th className="py-3 px-3">Direction</th>
                    <th className="py-3 px-3">Strategy</th>
                    <th className="py-3 px-3">Execution → Exit</th>
                    <th className="py-3 px-3">Risk:Reward</th>
                    <th className="py-3 px-3">Realized P&L</th>
                    <th className="py-3 px-3">Exit Tag & Reason</th>
                    <th className="py-3 px-3 text-right">Audit</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {historyTrades.map((trade) => {
                    const isProfit = trade.pnlAmount >= 0;
                    const isLong = trade.direction === "LONG";
                    const exitTag = trade.exitTag || trade.status;

                    return (
                      <tr
                        key={trade.tradeId}
                        onClick={() => setSelectedAuditTrade(trade)}
                        className="hover:bg-cyan-950/20 cursor-pointer transition-colors group"
                      >
                        <td className="py-3.5 px-3 font-bold text-white flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full bg-cyan-400 group-hover:scale-125 transition-transform" />
                          <span>{trade.symbol}</span>
                        </td>

                        <td className="py-3.5 px-3">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                              isLong
                                ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                                : "bg-rose-500/10 text-rose-400 border border-rose-500/20"
                            }`}
                          >
                            {trade.direction}
                          </span>
                        </td>

                        <td className="py-3.5 px-3 text-slate-300">{trade.strategyBadge}</td>

                        <td className="py-3.5 px-3 text-slate-200">
                          ${trade.entryPrice.toFixed(2)} → ${(trade.exitPrice ?? trade.currentPrice).toFixed(2)}
                        </td>

                        <td className="py-3.5 px-3 text-cyan-400">1:{trade.rewardRiskRatio}</td>

                        <td className="py-3.5 px-3">
                          <span
                            className={`font-bold ${
                              isProfit ? "text-emerald-400" : "text-rose-400"
                            }`}
                          >
                            {isProfit ? "+" : ""}${trade.pnlAmount.toFixed(2)} ({trade.pnlPercent > 0 ? "+" : ""}{trade.pnlPercent}%)
                          </span>
                        </td>

                        <td className="py-3.5 px-3">
                          <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-slate-800 text-slate-300 border border-slate-700">
                            {exitTag.replace(/_/g, " ")}
                          </span>
                        </td>

                        <td className="py-3.5 px-3 text-right">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedAuditTrade(trade);
                            }}
                            className="px-2.5 py-1 rounded-lg bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 text-[11px] font-mono flex items-center gap-1 ml-auto"
                          >
                            <Search className="w-3 h-3" />
                            <span>Audit</span>
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ─── TAB 4: US MACRO SHIELD & CALENDAR ─── */}
      {activeTab === "MACRO" && (
        <div className="space-y-4">
          <div className="rounded-2xl bg-gradient-to-b from-[#0d1424] to-[#090e1a] border border-slate-800/80 p-5 shadow-xl">
            <div className="flex items-center gap-3 pb-4 border-b border-slate-800">
              <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400">
                <ShieldAlert className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold font-mono text-white">US Macroeconomic Catalyst Shield</h3>
                <p className="text-xs text-slate-400 font-mono">
                  Live tracking of High-Impact US Economic Data releases (CPI, FOMC, NFP) to guard Gold and Crypto-FX capital.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
              {macroCalendar.map((event) => (
                <div
                  key={event.id}
                  className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 space-y-2 font-mono text-xs"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] uppercase font-bold text-amber-400 px-2 py-0.5 rounded bg-amber-500/10 border border-amber-500/20">
                      {event.impact} IMPACT
                    </span>
                    <span className="text-slate-400">{event.scheduledTime}</span>
                  </div>

                  <h4 className="text-sm font-bold text-white">{event.name}</h4>

                  <div className="grid grid-cols-2 gap-2 py-2 text-slate-300">
                    <div>
                      <span className="text-[10px] text-slate-500 block">Forecast:</span>
                      <span className="font-semibold">{event.forecast}</span>
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-500 block">Previous:</span>
                      <span className="font-semibold">{event.previous}</span>
                    </div>
                  </div>

                  <p className="text-[11px] text-slate-400 font-sans border-t border-slate-800/60 pt-2">
                    {event.notes}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ─── Interactive Exit Audit Modal Popup ─── */}
      <GlobalTradeExitAuditModal
        trade={selectedAuditTrade}
        onClose={() => setSelectedAuditTrade(null)}
      />
    </div>
  );
}

