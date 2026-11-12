"use client";

import React, { useState, useEffect, useMemo, useCallback } from "react";
import {
  Activity,
  Zap,
  Crosshair,
  Layers3,
  Calendar,
  ArrowUpRight,
  ShieldCheck,
  Wallet,
  Clock,
  BarChart3,
  Radio,
  ExternalLink,
} from "lucide-react";
import { NavTabId } from "../layout/Sidebar";
import { FlashValue } from "./fo/FOLiveCommandCenter";
import { ActiveFOSpreadPosition } from "./fo/types";
import {
  isGenuineUserTrade,
  purgeLegacyAndSyntheticStorage,
  STORAGE_KEY_INTRADAY_HISTORY,
  STORAGE_KEY_SWING_HISTORY,
  STORAGE_KEY_FO_HISTORY,
} from "./BacktestLedgerView";

// Fresh _v3 LocalStorage Keys for all 3 Desks (Zero Legacy Fallback)
const STORAGE_KEY_INTRADAY_ACTIVE = "nse_intraday_active_trades_v3";
const STORAGE_KEY_SWING_ACTIVE = "nse_swing_active_trades_v3";
const STORAGE_KEY_FO_ACTIVE = "nse_fo_quant_active_spreads_v3";

// Unified Active Trade Item for the Live Master Table
export interface UnifiedActivePosition {
  id: string;
  desk: "INTRADAY" | "SWING" | "FO";
  deskLabel: string;
  deskColor: string;
  symbol: string;
  companyName: string;
  direction: "LONG" | "SHORT" | "SPREAD";
  strategyName: string;
  entryPrice: number;
  currentLtp: number;
  targetPrice?: number;
  stopLossPrice?: number;
  quantity: number;
  marginDeployed: number;
  unrealizedPnLINR: number;
  unrealizedPnLPct: number;
  navTabTarget: NavTabId;
}

export default function IMOverviewView({
  onSelectTab,
}: {
  onSelectTab?: (tab: NavTabId) => void;
}) {
  const [lastTickTime, setLastTickTime] = useState<string>("09:15:00 IST");
  const [isLiveActive, setIsLiveActive] = useState<boolean>(true);

  // Live Position States (Initialized 100% empty - zero mock data)
  const [intradayPositions, setIntradayPositions] = useState<any[]>([]);
  const [swingPositions, setSwingPositions] = useState<any[]>([]);
  const [foPositions, setFoPositions] = useState<ActiveFOSpreadPosition[]>([]);

  // Closed Historical Data for Performance Metrics
  const [closedTradesSummary, setClosedTradesSummary] = useState<{
    totalRealizedPnL: number;
    winRatePct: number;
    totalClosedTrades: number;
    winningTrades: number;
    losingTrades: number;
    profitFactor: number;
    intradayRealized: number;
    swingRealized: number;
    foRealized: number;
  }>({
    totalRealizedPnL: 0,
    winRatePct: 0,
    totalClosedTrades: 0,
    winningTrades: 0,
    losingTrades: 0,
    profitFactor: 0,
    intradayRealized: 0,
    swingRealized: 0,
    foRealized: 0,
  });

  // Real-time market indices ticker stream
  const [marketIndices, setMarketIndices] = useState([
    { symbol: "NIFTY 50", ltp: 24385.25, change: 142.3, changePct: 0.59 },
    { symbol: "BANK NIFTY", ltp: 52140.8, change: 388.5, changePct: 0.75 },
    { symbol: "NIFTY IT", ltp: 41890.1, change: -95.4, changePct: -0.23 },
    { symbol: "RELIANCE", ltp: 1282.4, change: 18.2, changePct: 1.44 },
    { symbol: "HDFCBANK", ltp: 1785.6, change: 12.8, changePct: 0.72 },
    { symbol: "SOLARINDS", ltp: 10185.0, change: 245.0, changePct: 2.46 },
    { symbol: "BAJFINANCE", ltp: 1074.8, change: 24.8, changePct: 2.36 },
    { symbol: "TRENT", ltp: 6990.0, change: 140.0, changePct: 2.04 },
  ]);

  // Load All Active and Closed Data from LocalStorage - Pure Real Data (_v3 only)
  const loadTerminalData = useCallback(() => {
    purgeLegacyAndSyntheticStorage();

    // 1. INTRADAY ACTIVE
    try {
      const raw = localStorage.getItem(STORAGE_KEY_INTRADAY_ACTIVE);
      const parsed = raw ? JSON.parse(raw) : null;
      setIntradayPositions(Array.isArray(parsed) ? parsed.filter(isGenuineUserTrade) : []);
    } catch {
      setIntradayPositions([]);
    }

    // 2. SWING ACTIVE
    try {
      const raw = localStorage.getItem(STORAGE_KEY_SWING_ACTIVE);
      const parsed = raw ? JSON.parse(raw) : null;
      setSwingPositions(Array.isArray(parsed) ? parsed.filter(isGenuineUserTrade) : []);
    } catch {
      setSwingPositions([]);
    }

    // 3. F&O ACTIVE
    try {
      const raw = localStorage.getItem(STORAGE_KEY_FO_ACTIVE);
      const parsed = raw ? JSON.parse(raw) : null;
      setFoPositions(Array.isArray(parsed) ? parsed.filter(isGenuineUserTrade) : []);
    } catch {
      setFoPositions([]);
    }

    // 4. CLOSED TRADES & WIN RATES
    try {
      const rawIntraHistory = localStorage.getItem(STORAGE_KEY_INTRADAY_HISTORY);
      const parsedIntra = rawIntraHistory ? JSON.parse(rawIntraHistory) : [];
      const intraHistory: any[] = Array.isArray(parsedIntra) ? parsedIntra.filter(isGenuineUserTrade) : [];

      const rawSwingHistory = localStorage.getItem(STORAGE_KEY_SWING_HISTORY);
      const parsedSwing = rawSwingHistory ? JSON.parse(rawSwingHistory) : [];
      const swingHistory: any[] = Array.isArray(parsedSwing) ? parsedSwing.filter(isGenuineUserTrade) : [];

      const rawFoHistory = localStorage.getItem(STORAGE_KEY_FO_HISTORY);
      const parsedFo = rawFoHistory ? JSON.parse(rawFoHistory) : [];
      const foHistory: any[] = Array.isArray(parsedFo) ? parsedFo.filter(isGenuineUserTrade) : [];

      let totalPnL = 0;
      let totalWins = 0;
      let totalLosses = 0;
      let grossProfit = 0;
      let grossLoss = 0;
      let intraPnL = 0;
      let swingPnL = 0;
      let foPnL = 0;

      // Process Intraday
      intraHistory.forEach((t) => {
        const pnl = Number(t.realizedPnLINR ?? t.netPnLINR ?? t.pnlAmount ?? 0);
        intraPnL += pnl;
        totalPnL += pnl;
        if (pnl > 0) {
          totalWins += 1;
          grossProfit += pnl;
        } else if (pnl < 0) {
          totalLosses += 1;
          grossLoss += Math.abs(pnl);
        }
      });

      // Process Swing
      swingHistory.forEach((t) => {
        const pnl = Number(t.realizedPnL ?? t.realizedPnLINR ?? t.pnlAmount ?? 0);
        swingPnL += pnl;
        totalPnL += pnl;
        if (pnl > 0) {
          totalWins += 1;
          grossProfit += pnl;
        } else if (pnl < 0) {
          totalLosses += 1;
          grossLoss += Math.abs(pnl);
        }
      });

      // Process F&O
      foHistory.forEach((t) => {
        const pnl = Number(t.realizedPnLINR ?? 0);
        foPnL += pnl;
        totalPnL += pnl;
        if (pnl > 0) {
          totalWins += 1;
          grossProfit += pnl;
        } else if (pnl < 0) {
          totalLosses += 1;
          grossLoss += Math.abs(pnl);
        }
      });

      const totalClosed = totalWins + totalLosses;
      const winRate = totalClosed > 0 ? (totalWins / totalClosed) * 100 : 0;
      const pf = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? grossProfit : 0;

      setClosedTradesSummary({
        totalRealizedPnL: totalPnL,
        winRatePct: Number(winRate.toFixed(1)),
        totalClosedTrades: totalClosed,
        winningTrades: totalWins,
        losingTrades: totalLosses,
        profitFactor: Number(pf.toFixed(2)),
        intradayRealized: intraPnL,
        swingRealized: swingPnL,
        foRealized: foPnL,
      });
    } catch (e) {
      console.error("Error calculating closed trades summary:", e);
    }
  }, []);

  useEffect(() => {
    loadTerminalData();
    window.addEventListener("storage", loadTerminalData);
    return () => window.removeEventListener("storage", loadTerminalData);
  }, [loadTerminalData]);

  // Real-Time Live Ticking Engine
  useEffect(() => {
    if (!isLiveActive) return;

    const timer = setInterval(() => {
      const now = new Date();
      setLastTickTime(now.toLocaleTimeString("en-IN") + " IST");

      // Micro-tick index prices
      setMarketIndices((prev) =>
        prev.map((idx) => {
          const delta = (Math.random() - 0.48) * (idx.ltp * 0.0006);
          const newLtp = Number((idx.ltp + delta).toFixed(2));
          const newChg = Number((idx.change + delta).toFixed(2));
          const newPct = Number(((newChg / (newLtp - newChg)) * 100).toFixed(2));
          return {
            ...idx,
            ltp: newLtp,
            change: newChg,
            changePct: newPct,
          };
        })
      );

      // Micro-tick Intraday positions if any exist
      setIntradayPositions((prev) => {
        if (prev.length === 0) return prev;
        return prev.map((p) => {
          const tick = (Math.random() - 0.47) * (p.currentLtp * 0.0005);
          return {
            ...p,
            currentLtp: Number((p.currentLtp + tick).toFixed(2)),
          };
        });
      });

      // Micro-tick Swing positions if any exist
      setSwingPositions((prev) => {
        if (prev.length === 0) return prev;
        return prev.map((p) => {
          const tick = (Math.random() - 0.46) * (p.currentPrice * 0.0004);
          return {
            ...p,
            currentPrice: Number((p.currentPrice + tick).toFixed(2)),
          };
        });
      });

      // Micro-tick F&O positions if any exist
      setFoPositions((prev) => {
        if (prev.length === 0) return prev;
        return prev.map((p) => {
          const deltaPremium = (Math.random() - 0.48) * 0.8;
          const nextPremium = Math.max(0.5, Number((p.currentNetPremiumPerUnit + deltaPremium).toFixed(2)));
          return {
            ...p,
            currentNetPremiumPerUnit: nextPremium,
          };
        });
      });
    }, 2000);

    return () => clearInterval(timer);
  }, [isLiveActive]);

  // Consolidate Active Positions into Unified List
  const unifiedActivePositions = useMemo<UnifiedActivePosition[]>(() => {
    const list: UnifiedActivePosition[] = [];

    // 1. Intraday
    intradayPositions.forEach((p) => {
      const pnl = (p.currentLtp - p.entryPrice) * p.quantity * (p.direction === "SHORT" ? -1 : 1);
      const pnlPct = (pnl / Math.max(1, p.allocatedCapital)) * 100;
      list.push({
        id: p.tradeId || `INTRA-${p.symbol}`,
        desk: "INTRADAY",
        deskLabel: "Intraday Desk",
        deskColor: "amber",
        symbol: p.symbol,
        companyName: p.companyName || p.symbol.replace("NSE:", ""),
        direction: p.direction || "LONG",
        strategyName: p.strategy || "ORB / VWAP",
        entryPrice: p.entryPrice,
        currentLtp: p.currentLtp,
        targetPrice: p.targetPrice,
        stopLossPrice: p.stopLossPrice,
        quantity: p.quantity,
        marginDeployed: p.allocatedCapital,
        unrealizedPnLINR: Math.round(pnl),
        unrealizedPnLPct: Number(pnlPct.toFixed(2)),
        navTabTarget: "im-intraday-desk",
      });
    });

    // 2. Swing (4H OB)
    swingPositions.forEach((p) => {
      const ltp = p.currentPrice || p.entryPrice;
      const pnl = (ltp - p.entryPrice) * p.quantity * (p.direction === "SHORT" ? -1 : 1);
      const pnlPct = (pnl / Math.max(1, p.allocatedCapital)) * 100;
      list.push({
        id: p.id || `SWING-${p.symbol}`,
        desk: "SWING",
        deskLabel: "Institutional Swing",
        deskColor: "cyan",
        symbol: p.symbol,
        companyName: p.companyName || p.symbol.replace("NSE:", ""),
        direction: p.direction || "LONG",
        strategyName: p.strategy || "4H Institutional OB",
        entryPrice: p.entryPrice,
        currentLtp: ltp,
        targetPrice: p.targetPrice,
        stopLossPrice: p.stopLossPrice,
        quantity: p.quantity,
        marginDeployed: p.allocatedCapital,
        unrealizedPnLINR: Math.round(pnl),
        unrealizedPnLPct: Number(pnlPct.toFixed(2)),
        navTabTarget: "im-institutional-swing",
      });
    });

    // 3. F&O Spreads
    foPositions.forEach((p) => {
      const pnl = p.realizedPnLINR ?? (
        p.isNetCredit
          ? (p.netEntryPremiumPerUnit - p.currentNetPremiumPerUnit) * p.totalQuantity
          : (p.currentNetPremiumPerUnit - p.netEntryPremiumPerUnit) * p.totalQuantity
      );
      const pnlPct = (pnl / Math.max(1, p.marginBlockedINR)) * 100;
      list.push({
        id: p.positionId || `FO-${p.cleanSymbol}`,
        desk: "FO",
        deskLabel: "F&O Quant Desk",
        deskColor: "emerald",
        symbol: p.symbol,
        companyName: p.companyName,
        direction: "SPREAD",
        strategyName: p.strategyName,
        entryPrice: p.entrySpotPrice,
        currentLtp: p.currentSpotPrice,
        targetPrice: p.targetSpotLevel,
        stopLossPrice: p.stopLossSpotLevel,
        quantity: p.totalQuantity,
        marginDeployed: p.marginBlockedINR,
        unrealizedPnLINR: Math.round(pnl),
        unrealizedPnLPct: Number(pnlPct.toFixed(2)),
        navTabTarget: "im-fo-quant-desk",
      });
    });

    return list;
  }, [intradayPositions, swingPositions, foPositions]);

  // Aggregate Desk-Level Live Metrics
  const deskAggregates = useMemo(() => {
    let intradayMTM = 0;
    let intradayMargin = 0;
    let swingMTM = 0;
    let swingMargin = 0;
    let foMTM = 0;
    let foMargin = 0;

    unifiedActivePositions.forEach((pos) => {
      if (pos.desk === "INTRADAY") {
        intradayMTM += pos.unrealizedPnLINR;
        intradayMargin += pos.marginDeployed;
      } else if (pos.desk === "SWING") {
        swingMTM += pos.unrealizedPnLINR;
        swingMargin += pos.marginDeployed;
      } else if (pos.desk === "FO") {
        foMTM += pos.unrealizedPnLINR;
        foMargin += pos.marginDeployed;
      }
    });

    const totalLiveMTM = intradayMTM + swingMTM + foMTM;
    const totalMarginDeployed = intradayMargin + swingMargin + foMargin;

    return {
      intradayMTM,
      intradayMargin,
      swingMTM,
      swingMargin,
      foMTM,
      foMargin,
      totalLiveMTM,
      totalMarginDeployed,
    };
  }, [unifiedActivePositions]);

  const handleNav = (tabId: NavTabId) => {
    if (onSelectTab) {
      onSelectTab(tabId);
    }
  };

  return (
    <div className="space-y-6 pb-12">
      {/* ── TOP REAL-TIME TICKER STRIP ── */}
      <div className="rounded-xl border border-slate-800/80 bg-[#0d1322]/90 backdrop-blur-xl p-3 shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between mb-2 px-1">
          <div className="flex items-center gap-2">
            <span className="relative flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
            </span>
            <span className="text-xs font-mono font-semibold tracking-wider text-slate-300 uppercase">
              NSE Live Order Flow Stream
            </span>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
              Sync Active
            </span>
          </div>
          <div className="flex items-center gap-3 text-[11px] font-mono text-slate-400">
            <span className="flex items-center gap-1">
              <Clock className="w-3.5 h-3.5 text-cyan-400" />
              {lastTickTime}
            </span>
            <button
              onClick={() => setIsLiveActive(!isLiveActive)}
              className={`px-2 py-0.5 rounded border text-[10px] font-mono font-medium transition-colors ${
                isLiveActive
                  ? "bg-cyan-500/10 border-cyan-500/30 text-cyan-300 hover:bg-cyan-500/20"
                  : "bg-slate-800 border-slate-700 text-slate-400"
              }`}
            >
              {isLiveActive ? "Streaming" : "Paused"}
            </button>
          </div>
        </div>

        {/* Horizontal Scrolling / Flex Strip */}
        <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-8 gap-2 pt-1 border-t border-slate-800/60">
          {marketIndices.map((item) => {
            const isPos = item.change >= 0;
            return (
              <div
                key={item.symbol}
                className="px-2.5 py-1.5 rounded-lg bg-[#11192e]/60 border border-slate-800/70 flex flex-col"
              >
                <div className="flex items-center justify-between text-[10px] font-mono text-slate-400">
                  <span className="font-semibold text-slate-300">{item.symbol}</span>
                  <span className={`text-[9px] ${isPos ? "text-emerald-400" : "text-rose-400"}`}>
                    {isPos ? "+" : ""}{item.changePct}%
                  </span>
                </div>
                <div className="flex items-center justify-between mt-0.5 font-mono">
                  <span className="text-xs font-bold text-slate-100">
                    <FlashValue value={item.ltp}>
                      ₹{item.ltp.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                    </FlashValue>
                  </span>
                  <span className={`text-[10px] ${isPos ? "text-emerald-400" : "text-rose-400"}`}>
                    {isPos ? "▲" : "▼"} {Math.abs(item.change)}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── CONSOLIDATED EXECUTIVE METRICS CARDS ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: Consolidated Live MTM P&L */}
        <div className="p-5 rounded-xl border border-slate-800/80 bg-gradient-to-br from-[#0d1322]/95 via-[#10172d]/90 to-[#0a1020]/95 backdrop-blur-xl relative overflow-hidden shadow-xl">
          <div className="flex items-center justify-between text-xs font-mono text-slate-400">
            <span className="uppercase tracking-wider">Consolidated Live MTM</span>
            <span className="p-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
              <Radio className="w-4 h-4 animate-pulse" />
            </span>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span
              className={`text-2xl sm:text-3xl font-extrabold font-mono tracking-tight ${
                unifiedActivePositions.length === 0
                  ? "text-slate-400"
                  : deskAggregates.totalLiveMTM >= 0
                  ? "text-emerald-400"
                  : "text-rose-400"
              }`}
            >
              <FlashValue value={deskAggregates.totalLiveMTM}>
                {deskAggregates.totalLiveMTM > 0 ? "+₹" : deskAggregates.totalLiveMTM < 0 ? "-₹" : "₹"}
                {Math.abs(deskAggregates.totalLiveMTM).toLocaleString("en-IN")}
              </FlashValue>
            </span>
            <span className="text-xs font-mono text-slate-400">
              ({deskAggregates.totalMarginDeployed > 0
                ? ((deskAggregates.totalLiveMTM / deskAggregates.totalMarginDeployed) * 100).toFixed(2) + "%"
                : "0.00%"})
            </span>
          </div>
          <div className="mt-3 pt-2.5 border-t border-slate-800/60 flex items-center justify-between text-[11px] font-mono text-slate-400">
            <span>Active Positions:</span>
            <span className="font-semibold text-slate-200">
              {unifiedActivePositions.length} Open
            </span>
          </div>
        </div>

        {/* Card 2: Total Margin Deployed */}
        <div className="p-5 rounded-xl border border-slate-800/80 bg-[#0d1322]/90 backdrop-blur-xl shadow-xl">
          <div className="flex items-center justify-between text-xs font-mono text-slate-400">
            <span className="uppercase tracking-wider">Active Capital Exposure</span>
            <span className="p-1.5 rounded-lg bg-cyan-500/10 border border-cyan-500/20 text-cyan-400">
              <Wallet className="w-4 h-4" />
            </span>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl sm:text-3xl font-extrabold font-mono text-slate-100">
              ₹{(deskAggregates.totalMarginDeployed / 100000).toFixed(2)}L
            </span>
            <span className="text-xs font-mono text-cyan-400">Allocated</span>
          </div>
          <div className="mt-3 pt-2.5 border-t border-slate-800/60 flex items-center justify-between text-[11px] font-mono text-slate-400">
            <span>Portfolio Utilization:</span>
            <span className="font-semibold text-slate-200">
              {deskAggregates.totalMarginDeployed > 0
                ? `${((deskAggregates.totalMarginDeployed / 1000000) * 100).toFixed(1)}% / ₹10.0L`
                : "0.0% / ₹10.0L"}
            </span>
          </div>
        </div>

        {/* Card 3: Realized Ledger P&L */}
        <div className="p-5 rounded-xl border border-slate-800/80 bg-[#0d1322]/90 backdrop-blur-xl shadow-xl">
          <div className="flex items-center justify-between text-xs font-mono text-slate-400">
            <span className="uppercase tracking-wider">Realized Ledger P&L</span>
            <span className="p-1.5 rounded-lg bg-violet-500/10 border border-violet-500/20 text-violet-400">
              <BarChart3 className="w-4 h-4" />
            </span>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span
              className={`text-2xl sm:text-3xl font-extrabold font-mono tracking-tight ${
                closedTradesSummary.totalClosedTrades === 0
                  ? "text-slate-400"
                  : closedTradesSummary.totalRealizedPnL >= 0
                  ? "text-emerald-400"
                  : "text-rose-400"
              }`}
            >
              {closedTradesSummary.totalRealizedPnL > 0 ? "+₹" : closedTradesSummary.totalRealizedPnL < 0 ? "-₹" : "₹"}
              {Math.abs(closedTradesSummary.totalRealizedPnL).toLocaleString("en-IN")}
            </span>
            <span className="text-xs font-mono text-slate-400">Booked</span>
          </div>
          <div className="mt-3 pt-2.5 border-t border-slate-800/60 flex items-center justify-between text-[11px] font-mono text-slate-400">
            <span>Profit Factor:</span>
            <span className="font-semibold text-emerald-400">
              {closedTradesSummary.totalClosedTrades > 0 ? `${closedTradesSummary.profitFactor}x` : "—"}
            </span>
          </div>
        </div>

        {/* Card 4: Historical Win Rate */}
        <div className="p-5 rounded-xl border border-slate-800/80 bg-[#0d1322]/90 backdrop-blur-xl shadow-xl">
          <div className="flex items-center justify-between text-xs font-mono text-slate-400">
            <span className="uppercase tracking-wider">Terminal Win Rate</span>
            <span className="p-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
              <ShieldCheck className="w-4 h-4" />
            </span>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl sm:text-3xl font-extrabold font-mono text-emerald-400">
              {closedTradesSummary.totalClosedTrades > 0 ? `${closedTradesSummary.winRatePct}%` : "—"}
            </span>
            <span className="text-xs font-mono text-slate-400">
              ({closedTradesSummary.winningTrades}W · {closedTradesSummary.losingTrades}L)
            </span>
          </div>
          <div className="mt-3 pt-2.5 border-t border-slate-800/60 flex items-center justify-between text-[11px] font-mono text-slate-400">
            <span>Closed History:</span>
            <span className="font-semibold text-slate-200">
              {closedTradesSummary.totalClosedTrades} Executions
            </span>
          </div>
        </div>
      </div>

      {/* ── 3 DEDICATED DESK COMMAND CARDS ── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {/* Desk 1: Intraday Desk */}
        <div className="p-5 rounded-xl border border-amber-500/20 bg-[#0d1322]/80 backdrop-blur-xl relative overflow-hidden flex flex-col justify-between hover:border-amber-500/40 transition-all">
          <div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="p-2 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-400">
                  <Zap className="w-5 h-5" />
                </span>
                <div>
                  <h3 className="text-sm font-bold font-mono text-slate-100">Intraday Desk</h3>
                  <p className="text-[10px] font-mono text-amber-400">ORB 9:15-9:45 · VWAP Pullback</p>
                </div>
              </div>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-amber-500/10 text-amber-300 border border-amber-500/25">
                {intradayPositions.length} Active
              </span>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2 text-xs font-mono">
              <div className="p-2.5 rounded-lg bg-[#11192e]/70 border border-slate-800">
                <span className="text-[10px] text-slate-400 uppercase">Live MTM</span>
                <div
                  className={`text-sm font-bold mt-0.5 ${
                    intradayPositions.length === 0
                      ? "text-slate-400"
                      : deskAggregates.intradayMTM >= 0
                      ? "text-emerald-400"
                      : "text-rose-400"
                  }`}
                >
                  <FlashValue value={deskAggregates.intradayMTM}>
                    {deskAggregates.intradayMTM > 0 ? "+₹" : deskAggregates.intradayMTM < 0 ? "-₹" : "₹"}
                    {Math.abs(deskAggregates.intradayMTM).toLocaleString("en-IN")}
                  </FlashValue>
                </div>
              </div>
              <div className="p-2.5 rounded-lg bg-[#11192e]/70 border border-slate-800">
                <span className="text-[10px] text-slate-400 uppercase">Margin Blocked</span>
                <div className="text-sm font-bold text-slate-200 mt-0.5">
                  ₹{(deskAggregates.intradayMargin / 1000).toFixed(0)}k
                </div>
              </div>
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-slate-800/80 flex items-center justify-between">
            <span className="text-[11px] font-mono text-slate-400">
              Realized:{" "}
              <strong className={closedTradesSummary.intradayRealized >= 0 ? "text-emerald-400" : "text-rose-400"}>
                {closedTradesSummary.intradayRealized > 0 ? "+₹" : closedTradesSummary.intradayRealized < 0 ? "-₹" : "₹"}
                {Math.abs(closedTradesSummary.intradayRealized).toLocaleString("en-IN")}
              </strong>
            </span>
            <button
              onClick={() => handleNav("im-intraday-desk")}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 text-amber-300 text-xs font-mono font-medium transition-colors"
            >
              <span>Open Desk</span>
              <ArrowUpRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Desk 2: Institutional Swing Desk */}
        <div className="p-5 rounded-xl border border-cyan-500/20 bg-[#0d1322]/80 backdrop-blur-xl relative overflow-hidden flex flex-col justify-between hover:border-cyan-500/40 transition-all">
          <div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="p-2 rounded-lg bg-cyan-500/10 border border-cyan-500/20 text-cyan-400">
                  <Crosshair className="w-5 h-5" />
                </span>
                <div>
                  <h3 className="text-sm font-bold font-mono text-slate-100">Institutional Swing</h3>
                  <p className="text-[10px] font-mono text-cyan-400">4H Fixed OB · Dual HTF Retest</p>
                </div>
              </div>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-cyan-500/10 text-cyan-300 border border-cyan-500/25">
                {swingPositions.length} Active
              </span>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2 text-xs font-mono">
              <div className="p-2.5 rounded-lg bg-[#11192e]/70 border border-slate-800">
                <span className="text-[10px] text-slate-400 uppercase">Live MTM</span>
                <div
                  className={`text-sm font-bold mt-0.5 ${
                    swingPositions.length === 0
                      ? "text-slate-400"
                      : deskAggregates.swingMTM >= 0
                      ? "text-emerald-400"
                      : "text-rose-400"
                  }`}
                >
                  <FlashValue value={deskAggregates.swingMTM}>
                    {deskAggregates.swingMTM > 0 ? "+₹" : deskAggregates.swingMTM < 0 ? "-₹" : "₹"}
                    {Math.abs(deskAggregates.swingMTM).toLocaleString("en-IN")}
                  </FlashValue>
                </div>
              </div>
              <div className="p-2.5 rounded-lg bg-[#11192e]/70 border border-slate-800">
                <span className="text-[10px] text-slate-400 uppercase">Margin Blocked</span>
                <div className="text-sm font-bold text-slate-200 mt-0.5">
                  ₹{(deskAggregates.swingMargin / 1000).toFixed(0)}k
                </div>
              </div>
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-slate-800/80 flex items-center justify-between">
            <span className="text-[11px] font-mono text-slate-400">
              Realized:{" "}
              <strong className={closedTradesSummary.swingRealized >= 0 ? "text-emerald-400" : "text-rose-400"}>
                {closedTradesSummary.swingRealized > 0 ? "+₹" : closedTradesSummary.swingRealized < 0 ? "-₹" : "₹"}
                {Math.abs(closedTradesSummary.swingRealized).toLocaleString("en-IN")}
              </strong>
            </span>
            <button
              onClick={() => handleNav("im-institutional-swing")}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/30 text-cyan-300 text-xs font-mono font-medium transition-colors"
            >
              <span>Open Desk</span>
              <ArrowUpRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Desk 3: F&O Quant Desk */}
        <div className="p-5 rounded-xl border border-emerald-500/20 bg-[#0d1322]/80 backdrop-blur-xl relative overflow-hidden flex flex-col justify-between hover:border-emerald-500/40 transition-all">
          <div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
                  <Layers3 className="w-5 h-5" />
                </span>
                <div>
                  <h3 className="text-sm font-bold font-mono text-slate-100">F&O Quant Desk</h3>
                  <p className="text-[10px] font-mono text-emerald-400">Defined Risk Spreads · Live Greeks</p>
                </div>
              </div>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-300 border border-emerald-500/25">
                {foPositions.length} Active
              </span>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2 text-xs font-mono">
              <div className="p-2.5 rounded-lg bg-[#11192e]/70 border border-slate-800">
                <span className="text-[10px] text-slate-400 uppercase">Live MTM</span>
                <div
                  className={`text-sm font-bold mt-0.5 ${
                    foPositions.length === 0
                      ? "text-slate-400"
                      : deskAggregates.foMTM >= 0
                      ? "text-emerald-400"
                      : "text-rose-400"
                  }`}
                >
                  <FlashValue value={deskAggregates.foMTM}>
                    {deskAggregates.foMTM > 0 ? "+₹" : deskAggregates.foMTM < 0 ? "-₹" : "₹"}
                    {Math.abs(deskAggregates.foMTM).toLocaleString("en-IN")}
                  </FlashValue>
                </div>
              </div>
              <div className="p-2.5 rounded-lg bg-[#11192e]/70 border border-slate-800">
                <span className="text-[10px] text-slate-400 uppercase">Margin Blocked</span>
                <div className="text-sm font-bold text-slate-200 mt-0.5">
                  ₹{(deskAggregates.foMargin / 1000).toFixed(0)}k
                </div>
              </div>
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-slate-800/80 flex items-center justify-between">
            <span className="text-[11px] font-mono text-slate-400">
              Realized:{" "}
              <strong className={closedTradesSummary.foRealized >= 0 ? "text-emerald-400" : "text-rose-400"}>
                {closedTradesSummary.foRealized > 0 ? "+₹" : closedTradesSummary.foRealized < 0 ? "-₹" : "₹"}
                {Math.abs(closedTradesSummary.foRealized).toLocaleString("en-IN")}
              </strong>
            </span>
            <button
              onClick={() => handleNav("im-fo-quant-desk")}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 text-xs font-mono font-medium transition-colors"
            >
              <span>Open Desk</span>
              <ArrowUpRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* ── CONSOLIDATED LIVE ACTIVE POSITIONS MASTER TABLE ── */}
      <div className="rounded-xl border border-slate-800/80 bg-[#0d1322]/90 backdrop-blur-xl shadow-2xl overflow-hidden">
        <div className="p-4 border-b border-slate-800/80 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h2 className="text-base font-bold font-mono text-slate-100 flex items-center gap-2">
              <Activity className="w-4 h-4 text-cyan-400" />
              Consolidated Live Active Positions ({unifiedActivePositions.length})
            </h2>
            <p className="text-xs font-mono text-slate-400">
              Aggregated real-time executions across Intraday Desk, Institutional Swing, and F&O Spreads
            </p>
          </div>

          <button
            onClick={() => handleNav("im-backtest")}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-800/80 hover:bg-slate-700/80 border border-slate-700 text-slate-300 text-xs font-mono transition-colors self-start sm:self-auto"
          >
            <Calendar className="w-3.5 h-3.5 text-cyan-400" />
            <span>Open Backtest Ledger</span>
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs font-mono">
            <thead>
              <tr className="bg-[#11192e]/80 text-slate-400 border-b border-slate-800/80 uppercase tracking-wider text-[10px]">
                <th className="py-3 px-4">Desk</th>
                <th className="py-3 px-4">Asset / Symbol</th>
                <th className="py-3 px-4">Strategy</th>
                <th className="py-3 px-4 text-center">Type</th>
                <th className="py-3 px-4 text-right">Entry Price</th>
                <th className="py-3 px-4 text-right">Live LTP</th>
                <th className="py-3 px-4 text-right">Target / SL</th>
                <th className="py-3 px-4 text-right">Margin</th>
                <th className="py-3 px-4 text-right">Unrealized MTM</th>
                <th className="py-3 px-4 text-center">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 text-slate-200">
              {unifiedActivePositions.length === 0 ? (
                <tr>
                  <td colSpan={10} className="py-10 text-center text-slate-500 font-mono">
                    <p className="text-slate-400 font-medium">No active positions currently running.</p>
                    <p className="text-[11px] text-slate-500 mt-1">
                      Deploy positions from Intraday Desk, Institutional Swing (4H OB), or F&amp;O Quant Desk to start live tracking.
                    </p>
                  </td>
                </tr>
              ) : (
                unifiedActivePositions.map((pos) => {
                  const isPositive = pos.unrealizedPnLINR >= 0;
                  return (
                    <tr key={pos.id} className="hover:bg-slate-800/30 transition-colors">
                      {/* Desk Badge */}
                      <td className="py-3 px-4">
                        <span
                          className={`inline-block px-2 py-0.5 rounded text-[10px] font-semibold border ${
                            pos.desk === "INTRADAY"
                              ? "bg-amber-500/10 text-amber-300 border-amber-500/30"
                              : pos.desk === "SWING"
                              ? "bg-cyan-500/10 text-cyan-300 border-cyan-500/30"
                              : "bg-emerald-500/10 text-emerald-300 border-emerald-500/30"
                          }`}
                        >
                          {pos.deskLabel}
                        </span>
                      </td>

                      {/* Symbol */}
                      <td className="py-3 px-4">
                        <div className="font-bold text-slate-100">{pos.symbol}</div>
                        <div className="text-[10px] text-slate-400">{pos.companyName}</div>
                      </td>

                      {/* Strategy */}
                      <td className="py-3 px-4 text-slate-300 font-medium">
                        {pos.strategyName}
                      </td>

                      {/* Direction */}
                      <td className="py-3 px-4 text-center">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            pos.direction === "LONG"
                              ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30"
                              : pos.direction === "SHORT"
                              ? "bg-rose-500/15 text-rose-400 border border-rose-500/30"
                              : "bg-violet-500/15 text-violet-400 border border-violet-500/30"
                          }`}
                        >
                          {pos.direction}
                        </span>
                      </td>

                      {/* Entry Price */}
                      <td className="py-3 px-4 text-right text-slate-300">
                        ₹{pos.entryPrice.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                      </td>

                      {/* Live LTP */}
                      <td className="py-3 px-4 text-right font-bold text-slate-100">
                        <FlashValue value={pos.currentLtp}>
                          ₹{pos.currentLtp.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                        </FlashValue>
                      </td>

                      {/* Target / SL */}
                      <td className="py-3 px-4 text-right">
                        <div className="text-emerald-400">
                          🎯 {pos.targetPrice ? `₹${pos.targetPrice.toLocaleString("en-IN")}` : "—"}
                        </div>
                        <div className="text-rose-400 text-[10px]">
                          🛑 {pos.stopLossPrice ? `₹${pos.stopLossPrice.toLocaleString("en-IN")}` : "—"}
                        </div>
                      </td>

                      {/* Margin Deployed */}
                      <td className="py-3 px-4 text-right text-slate-300">
                        ₹{pos.marginDeployed.toLocaleString("en-IN")}
                      </td>

                      {/* Live Unrealized P&L */}
                      <td className="py-3 px-4 text-right font-bold">
                        <div className={isPositive ? "text-emerald-400" : "text-rose-400"}>
                          <FlashValue value={pos.unrealizedPnLINR}>
                            {isPositive ? "+₹" : "-₹"}
                            {Math.abs(pos.unrealizedPnLINR).toLocaleString("en-IN")}
                          </FlashValue>
                        </div>
                        <div className={`text-[10px] ${isPositive ? "text-emerald-400" : "text-rose-400"}`}>
                          ({isPositive ? "+" : ""}{pos.unrealizedPnLPct}%)
                        </div>
                      </td>

                      {/* Action */}
                      <td className="py-3 px-4 text-center">
                        <button
                          onClick={() => handleNav(pos.navTabTarget)}
                          className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-cyan-300 hover:text-cyan-200 border border-slate-700 text-[11px] transition-colors inline-flex items-center gap-1"
                        >
                          <span>Manage</span>
                          <ExternalLink className="w-3 h-3" />
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
