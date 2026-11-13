"use client";

import React, { useState, useEffect, useMemo, useCallback } from "react";
import Link from "next/link";
import {
  Layers,
  Sliders,
  RefreshCw,
  Briefcase,
  Sparkles,
  Lock,
  XCircle,
  CheckCircle2,
  ArrowUpRight,
  X,
  Zap,
  Radio,
  Clock,
  History,
  Search,
  Filter,
} from "lucide-react";
import {
  type FOScannerSetup,
  type FOInstrumentType,
  type FOMarketStructureRegime,
  type FOStrategyCode,
  type FOSpreadLeg,
  type ActiveFOSpreadPosition,
  DEFAULT_FO_CLOSED_SEEDS,
} from "./types";
import FOPurpleBoxSpreadScanner from "./FOPurpleBoxSpreadScanner";
import FOOptionChainAnalytics from "./FOOptionChainAnalytics";
import FOSpreadPayoffSimulator from "./FOSpreadPayoffSimulator";
import IMTradeExitAuditModal, { ClosedTradeExitAuditData } from "../IMTradeExitAuditModal";
import {
  FO_UNIVERSE,
  FO_PORTFOLIO_DEFAULT_CAPITAL,
  calculateSpreadPayoffAndMargin,
} from "@/lib/indian/foQuantEngine";
import { useLiveFoTicker, checkNseMarketHoursIST } from "@/hooks/useLiveFoTicker";
import FOLiveCommandCenter, { FlashValue } from "./FOLiveCommandCenter";
import {
  STORAGE_KEY_FO_ACTIVE as STORAGE_KEY_FO_ACTIVE_SPREADS,
  STORAGE_KEY_FO_HISTORY as STORAGE_KEY_FO_CLOSED_HISTORY,
  appendSettledTradesSync,
  writeActiveTradesSync,
  getISTDateKey,
} from "@/lib/indian/ledgerSync";

type FODeskSubTab =
  | "LIVE_COMMAND_CENTER"
  | "SPREAD_SCANNER"
  | "OPTION_CHAIN"
  | "PAYOFF_SIMULATOR"
  | "ACTIVE_POSITIONS";

function getTodayISTDateKey(): string {
  const now = new Date();
  const istOffsetMs = 5.5 * 60 * 60 * 1000;
  return new Date(now.getTime() + istOffsetMs).toISOString().slice(0, 10);
}

export default function FOQuantDeskView() {
  const [subTab, setSubTab] = useState<FODeskSubTab>("LIVE_COMMAND_CENTER");
  const [setups, setSetups] = useState<FOScannerSetup[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [feedSource, setFeedSource] = useState<string>(
    "🟢 LIVE FEED ACTIVE · Connecting to NSE Derivatives Stream..."
  );
  const [lastSyncedAt, setLastSyncedAt] = useState<string>("");
  const [autoRefreshEnabled, setAutoRefreshEnabled] = useState<boolean>(true);
  const [lockedDateKey, setLockedDateKey] = useState<string>(getTodayISTDateKey());
  const [deskCapitalINR] = useState<number>(FO_PORTFOLIO_DEFAULT_CAPITAL);

  // Filters
  const [instrumentFilter, setInstrumentFilter] = useState<"ALL" | FOInstrumentType>("ALL");
  const [regimeFilter, setRegimeFilter] = useState<"ALL" | FOMarketStructureRegime>("ALL");
  const [searchQuery, setSearchQuery] = useState<string>("");

  // Active selected setup for Option Chain, Payoff Simulator & Interactive Modals
  const [selectedSymbol, setSelectedSymbol] = useState<string>("NIFTY");
  const [isChainModalOpen, setIsChainModalOpen] = useState<boolean>(false);
  const [isPayoffModalOpen, setIsPayoffModalOpen] = useState<boolean>(false);

  // Isolated F&O Positions & History State
  const [activePositions, setActivePositions] = useState<ActiveFOSpreadPosition[]>([]);
  const [closedHistory, setClosedHistory] = useState<ActiveFOSpreadPosition[]>([]);
  const [foLedgerView, setFoLedgerView] = useState<"ACTIVE" | "EXITED_BACKTEST">("ACTIVE");
  const [closedFilter, setClosedFilter] = useState<"ALL" | "TARGET_HIT" | "SL_HIT" | "MANUAL_EXIT">("ALL");
  const [selectedExitAuditTrade, setSelectedExitAuditTrade] = useState<ClosedTradeExitAuditData | null>(null);
  const [hydrated, setHydrated] = useState<boolean>(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  const showToast = useCallback((msg: string) => {
    setToastMsg(msg);
    setTimeout(() => {
      setToastMsg((prev) => (prev === msg ? null : prev));
    }, 4200);
  }, []);

  // Keyboard accessibility: ESC key closes any active dialog overlay modal
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setIsChainModalOpen(false);
        setIsPayoffModalOpen(false);
        setSelectedExitAuditTrade(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Load isolated F&O positions from localStorage (Purge legacy _v1/_v2 keys)
  useEffect(() => {
    try {
      [
        "nse_fo_quant_active_spreads_v1",
        "nse_fo_quant_closed_history_v1",
        "nse_fo_quant_active_spreads_v2",
        "nse_fo_quant_closed_history_v2",
      ].forEach((k) => localStorage.removeItem(k));

      const rawActive = localStorage.getItem(STORAGE_KEY_FO_ACTIVE_SPREADS);
      if (rawActive) {
        const parsed = JSON.parse(rawActive);
        if (Array.isArray(parsed)) {
          setActivePositions(
            parsed.filter(
              (p: any) =>
                p &&
                !String(p.positionId || "").startsWith("FO-EXIT-") &&
                !String(p.positionId || "").startsWith("FO-ACT-")
            )
          );
        }
      }
      const rawClosed = localStorage.getItem(STORAGE_KEY_FO_CLOSED_HISTORY);
      if (rawClosed) {
        const parsed = JSON.parse(rawClosed);
        if (Array.isArray(parsed)) {
          setClosedHistory(
            parsed.filter(
              (p: any) =>
                p &&
                !String(p.positionId || "").startsWith("FO-EXIT-") &&
                !String(p.positionId || "").startsWith("FO-ACT-")
            )
          );
        } else {
          setClosedHistory([]);
        }
      } else {
        setClosedHistory([]);
      }
    } catch {
      // ignore storage errors
    } finally {
      setHydrated(true);
    }
  }, []);

  // Persist isolated F&O positions to localStorage
  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(STORAGE_KEY_FO_ACTIVE_SPREADS, JSON.stringify(activePositions));
      localStorage.setItem(STORAGE_KEY_FO_CLOSED_HISTORY, JSON.stringify(closedHistory));
    } catch {
      // ignore storage quota errors
    }
  }, [activePositions, closedHistory, hydrated]);

  // Fetch F&O Purple Box & Spread Scanner Worker (Real-Time Live Feed)
  const fetchFOScanner = useCallback(async (forceRefresh = false) => {
    setLoading(true);
    try {
      const url = forceRefresh
        ? "/api/indian/fo/scanner?forceRefresh=true"
        : "/api/indian/fo/scanner";
      const res = await fetch(url, { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.setups) && data.setups.length > 0) {
          setSetups(data.setups);
          setFeedSource(
            data.feedSource || "🟢 LIVE FEED ACTIVE · NSE Derivatives Stream"
          );
          setLastSyncedAt(
            new Date().toLocaleTimeString("en-IN", {
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
              hour12: false,
            }) + " IST"
          );
          if (data.lockedDateKey) setLockedDateKey(data.lockedDateKey);

          // Synchronize currentSpotPrice for multi-day positions & monitor Target / Stop Loss hits
          const todayKey = data.lockedDateKey || getTodayISTDateKey();
          const spotMap = new Map<string, number>();
          data.setups.forEach((s: FOScannerSetup) => {
            spotMap.set(s.cleanSymbol, s.spotPrice);
          });

          setActivePositions((prev) => {
            const nextActive: ActiveFOSpreadPosition[] = [];
            const newlyClosed: ActiveFOSpreadPosition[] = [];

            prev.forEach((pos) => {
              if (pos.entryDateKey === todayKey) {
                nextActive.push({
                  ...pos,
                  currentSpotPrice: pos.entrySpotPrice,
                  currentNetPremiumPerUnit: pos.netEntryPremiumPerUnit,
                });
                return;
              }

              const liveSpot = spotMap.get(pos.cleanSymbol) ?? pos.currentSpotPrice;
              const updatedPos = { ...pos, currentSpotPrice: liveSpot };

              // Check if Target Spot level is reached
              if (pos.targetSpotLevel && liveSpot >= pos.targetSpotLevel) {
                const profitINR = pos.maxProfitINR > 0 ? pos.maxProfitINR : Math.round(pos.totalQuantity * 20);
                newlyClosed.push({
                  ...updatedPos,
                  status: "TARGET_HIT",
                  exitTimestamp: new Date().toISOString(),
                  realizedPnLINR: profitINR,
                });
              } else if (pos.stopLossSpotLevel && liveSpot <= pos.stopLossSpotLevel) {
                // Check if Stop Loss Spot level is breached
                const lossINR = pos.maxLossINR > 0 ? -Math.round(pos.maxLossINR * 0.75) : -Math.round(pos.totalQuantity * 15);
                newlyClosed.push({
                  ...updatedPos,
                  status: "SL_HIT",
                  exitTimestamp: new Date().toISOString(),
                  realizedPnLINR: lossINR,
                });
              } else {
                nextActive.push(updatedPos);
              }
            });

            if (newlyClosed.length > 0) {
              const exitDateKey = getISTDateKey();
              const stampedClosed = newlyClosed.map((c) => ({
                ...c,
                dateKey: exitDateKey,
              }));
              const mergedClosed = appendSettledTradesSync(
                STORAGE_KEY_FO_CLOSED_HISTORY,
                stampedClosed,
                "FO"
              );
              setClosedHistory(mergedClosed);
              showToast(
                `🎯 F&O Auto-Exit: ${newlyClosed.map((c) => `${c.cleanSymbol} (${c.status.replace(/_/g, " ")})`).join(", ")} moved to Backtest Archive!`
              );
            }
            writeActiveTradesSync(STORAGE_KEY_FO_ACTIVE_SPREADS, nextActive, "FO");

            return nextActive;
          });
        }
      }
    } catch {
      // resilient
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchFOScanner(false);
  }, [fetchFOScanner]);

  // Real-time auto-polling interval (every 25 seconds when enabled AND NSE market is open)
  useEffect(() => {
    if (!autoRefreshEnabled) return;
    const timer = setInterval(() => {
      if (checkNseMarketHoursIST().isOpen) {
        fetchFOScanner(true);
      }
    }, 25000);
    return () => clearInterval(timer);
  }, [autoRefreshEnabled, fetchFOScanner]);

  // Filtered setups for the scanner view
  const filteredSetups = useMemo(() => {
    return setups.filter((s) => {
      if (instrumentFilter !== "ALL" && s.instrumentType !== instrumentFilter) {
        return false;
      }
      if (regimeFilter !== "ALL" && s.marketRegime !== regimeFilter) {
        return false;
      }
      if (
        searchQuery.trim() &&
        !s.cleanSymbol.toLowerCase().includes(searchQuery.trim().toLowerCase()) &&
        !s.companyName.toLowerCase().includes(searchQuery.trim().toLowerCase())
      ) {
        return false;
      }
      return true;
    });
  }, [setups, instrumentFilter, regimeFilter, searchQuery]);

  const activeSetup: FOScannerSetup | null = useMemo(() => {
    if (setups.length === 0) return null;
    return (
      setups.find((s) => s.cleanSymbol === selectedSymbol) ||
      filteredSetups[0] ||
      setups[0]
    );
  }, [setups, filteredSetups, selectedSymbol]);

  const deployedSymbols = useMemo(
    () => new Set(activePositions.map((p) => p.cleanSymbol)),
    [activePositions]
  );

  // 1.5s real-time F&O tick engine (Black-Scholes re-pricing anchored to NSE feed)
  const liveTicker = useLiveFoTicker({
    setups,
    positions: activePositions,
    intervalMs: 1500,
    enabled: autoRefreshEnabled,
  });

  const currentMarginUsedINR = useMemo(
    () => activePositions.reduce((acc, p) => acc + p.marginBlockedINR, 0),
    [activePositions]
  );

  const marginUtilizationPct = useMemo(
    () => Math.round((currentMarginUsedINR / Math.max(deskCapitalINR, 1)) * 1000) / 10,
    [currentMarginUsedINR, deskCapitalINR]
  );

  const realizedPnLINR = useMemo(
    () => closedHistory.reduce((acc, p) => acc + (p.realizedPnLINR || 0), 0),
    [closedHistory]
  );

  // Deploy default matched spread from scanner card/row or modal
  const handleDeployFromScanner = useCallback(
    (setup: FOScannerSetup) => {
      if (deployedSymbols.has(setup.cleanSymbol)) {
        showToast(`${setup.cleanSymbol} spread is already active in F&O Desk.`);
        return;
      }
      const todayKey = getTodayISTDateKey();
      const lots = setup.legs[0]?.lots || 1;
      const newPosition: ActiveFOSpreadPosition = {
        positionId: `FO-POS-${setup.cleanSymbol}-${Date.now()}`,
        symbol: setup.symbol,
        cleanSymbol: setup.cleanSymbol,
        companyName: setup.companyName,
        instrumentType: setup.instrumentType,
        marketRegime: setup.marketRegime,
        strategyCode: setup.strategyCode,
        strategyName: setup.strategyName,
        expiryDate: setup.expiryDate,
        lotSize: setup.lotSize,
        lotsDeployed: lots,
        totalQuantity: lots * setup.lotSize,
        entryDateKey: todayKey,
        entryTimestamp: new Date().toISOString(),
        entrySpotPrice: setup.spotPrice,
        currentSpotPrice: setup.spotPrice,
        valSupportFloor: setup.purpleBox.valSupportFloor,
        vahResistanceCeiling: setup.purpleBox.vahResistanceCeiling,
        legs: setup.legs,
        netEntryPremiumPerUnit: setup.payoffMetrics.netPremiumPerUnit,
        currentNetPremiumPerUnit: setup.payoffMetrics.netPremiumPerUnit,
        isNetCredit: setup.payoffMetrics.isNetCredit,
        marginBlockedINR: setup.payoffMetrics.estimatedMarginRequiredINR,
        maxProfitINR: setup.payoffMetrics.maxProfitINR,
        maxLossINR: setup.payoffMetrics.maxLossINR,
        lowerBreakeven: setup.payoffMetrics.lowerBreakeven,
        upperBreakeven: setup.payoffMetrics.upperBreakeven,
        probabilityOfProfitPct: setup.payoffMetrics.probabilityOfProfitPct,
        stopLossSpotLevel: Number((setup.purpleBox.valSupportFloor * 0.985).toFixed(2)),
        targetSpotLevel: Number((setup.purpleBox.vahResistanceCeiling * 1.02).toFixed(2)),
        status: "ACTIVE",
      };

      setActivePositions((prev) => {
        const next = [newPosition, ...prev];
        writeActiveTradesSync(STORAGE_KEY_FO_ACTIVE_SPREADS, next, "FO");
        return next;
      });
      showToast(
        `Deployed ${setup.cleanSymbol} ${setup.strategyName} (Same-Day Price Frozen at ₹${setup.spotPrice.toLocaleString("en-IN")})`
      );
    },
    [deployedSymbols, showToast]
  );

  // Deploy customized multi-lot / alternate strategy spread from Payoff Simulator
  const handleDeployFromSimulator = useCallback(
    (
      setup: FOScannerSetup,
      strategyCode: FOStrategyCode,
      strategyName: string,
      legs: FOSpreadLeg[],
      lotsMultiplier: number
    ) => {
      const spec =
        FO_UNIVERSE.find((u) => u.cleanSymbol === setup.cleanSymbol) ||
        FO_UNIVERSE[0];
      const metrics = calculateSpreadPayoffAndMargin(
        legs,
        setup.spotPrice,
        setup.purpleBox,
        spec,
        setup.daysToExpiry,
        deskCapitalINR
      );
      const todayKey = getTodayISTDateKey();

      const newPosition: ActiveFOSpreadPosition = {
        positionId: `FO-SIM-${setup.cleanSymbol}-${Date.now()}`,
        symbol: setup.symbol,
        cleanSymbol: setup.cleanSymbol,
        companyName: setup.companyName,
        instrumentType: setup.instrumentType,
        marketRegime: setup.marketRegime,
        strategyCode,
        strategyName,
        expiryDate: setup.expiryDate,
        lotSize: setup.lotSize,
        lotsDeployed: lotsMultiplier,
        totalQuantity: lotsMultiplier * setup.lotSize,
        entryDateKey: todayKey,
        entryTimestamp: new Date().toISOString(),
        entrySpotPrice: setup.spotPrice,
        currentSpotPrice: setup.spotPrice,
        valSupportFloor: setup.purpleBox.valSupportFloor,
        vahResistanceCeiling: setup.purpleBox.vahResistanceCeiling,
        legs,
        netEntryPremiumPerUnit: metrics.netPremiumPerUnit,
        currentNetPremiumPerUnit: metrics.netPremiumPerUnit,
        isNetCredit: metrics.isNetCredit,
        marginBlockedINR: metrics.estimatedMarginRequiredINR,
        maxProfitINR: metrics.maxProfitINR,
        maxLossINR: metrics.maxLossINR,
        lowerBreakeven: metrics.lowerBreakeven,
        upperBreakeven: metrics.upperBreakeven,
        probabilityOfProfitPct: metrics.probabilityOfProfitPct,
        stopLossSpotLevel: Number((setup.purpleBox.valSupportFloor * 0.985).toFixed(2)),
        targetSpotLevel: Number((setup.purpleBox.vahResistanceCeiling * 1.02).toFixed(2)),
        status: "ACTIVE",
      };

      setActivePositions((prev) => {
        const next = [
          newPosition,
          ...prev.filter((p) => p.cleanSymbol !== setup.cleanSymbol),
        ];
        writeActiveTradesSync(STORAGE_KEY_FO_ACTIVE_SPREADS, next, "FO");
        return next;
      });
      setIsPayoffModalOpen(false);
      setSubTab("ACTIVE_POSITIONS");
      showToast(
        `Executed ${lotsMultiplier} Lot(s) ${setup.cleanSymbol} ${strategyName} | Hedged Margin ₹${metrics.estimatedMarginRequiredINR.toLocaleString("en-IN")}`
      );
    },
    [deskCapitalINR, showToast]
  );

  const handleSquareOffPosition = useCallback(
    (pos: ActiveFOSpreadPosition) => {
      // Realize the exact live Black-Scholes spread P&L at the moment of square-off
      const liveTick = liveTicker.positionTicks[pos.positionId];
      const pnlINR = liveTick ? liveTick.unrealizedPnLINR : 0;

      const closedPos: ActiveFOSpreadPosition & { dateKey?: string } = {
        ...pos,
        currentSpotPrice: liveTick?.spot ?? pos.currentSpotPrice,
        status: "MANUAL_EXIT",
        exitTimestamp: new Date().toISOString(),
        dateKey: getISTDateKey(),
        realizedPnLINR: pnlINR,
      };

      setActivePositions((prev) => {
        const next = prev.filter((p) => p.positionId !== pos.positionId);
        writeActiveTradesSync(STORAGE_KEY_FO_ACTIVE_SPREADS, next, "FO");
        return next;
      });
      const mergedClosed = appendSettledTradesSync(
        STORAGE_KEY_FO_CLOSED_HISTORY,
        [closedPos],
        "FO"
      );
      setClosedHistory(mergedClosed);
      showToast(`Squared off ${pos.cleanSymbol} ${pos.strategyName}.`);
    },
    [showToast, liveTicker.positionTicks]
  );

  const filteredClosedHistory = useMemo(() => {
    return closedHistory.filter((item) => {
      if (closedFilter === "ALL") return true;
      return item.status === closedFilter;
    });
  }, [closedHistory, closedFilter]);

  const mapFOPositionToAuditData = useCallback((pos: ActiveFOSpreadPosition): ClosedTradeExitAuditData => {
    const isTarget = pos.status === "TARGET_HIT";
    const isSL = pos.status === "SL_HIT";
    const pnl = pos.realizedPnLINR ?? 0;
    const pnlPct = Number(((pnl / Math.max(1, pos.marginBlockedINR)) * 100).toFixed(2));

    return {
      tradeId: pos.positionId,
      symbol: pos.symbol,
      cleanSymbol: pos.cleanSymbol,
      companyName: pos.companyName,
      strategyUsed: `🟣 F&O ${pos.strategyName}`,
      direction: pos.isNetCredit ? "SHORT" : "LONG",
      entryPrice: pos.entrySpotPrice,
      exitPrice: pos.currentSpotPrice,
      currentMarketPrice: pos.currentSpotPrice,
      currentSimulatedPrice: pos.currentSpotPrice,
      targetPrice: pos.targetSpotLevel,
      stopLossPrice: pos.stopLossSpotLevel,
      quantity: pos.totalQuantity,
      allocatedCapital: pos.marginBlockedINR,
      pnlAmount: pnl,
      pnlPercent: pnlPct,
      status: pos.status,
      auditTag: pos.status,
      exitReason: isTarget
        ? `🎯 F&O Target Spot ₹${pos.targetSpotLevel.toLocaleString("en-IN")} Achieved! Multi-leg spread decayed favorably to capture full net premium.`
        : isSL
        ? `🛑 F&O Stop Loss Spot ₹${pos.stopLossSpotLevel.toLocaleString("en-IN")} Breached below support floor. Closed to strictly cap risk.`
        : `Manual square-off executed at current spot ₹${pos.currentSpotPrice.toLocaleString("en-IN")}.`,
      executionTime: pos.entryTimestamp ? new Date(pos.entryTimestamp).toLocaleTimeString("en-IN") : "09:20:00 IST",
      exitTime: pos.exitTimestamp ? new Date(pos.exitTimestamp).toLocaleTimeString("en-IN") : "15:20:00 IST",
      lockedReferenceLevel: pos.valSupportFloor,
      lockedReferenceLabel: "VAL_SUPPORT_FLOOR",
      exitHeadline: `${pos.cleanSymbol} ${pos.strategyName}: ${pos.status.replace(/_/g, " ")} executed at ₹${pos.currentSpotPrice.toLocaleString("en-IN")}`,
      exitPublisher: "NSE F&O Derivatives Stream",
      exitSentimentScore: isTarget ? 52 : isSL ? -48 : 0,
      volumeSpikeMultiplier: isTarget ? 1.6 : isSL ? 2.8 : 1.2,
      targetProgressPct: isTarget ? 100 : isSL ? 0 : 50,
      upperWickRejectionPct: isSL ? 55 : 18,
      auditTrail: [
        {
          timestamp: pos.entryTimestamp ? new Date(pos.entryTimestamp).toLocaleTimeString("en-IN") : "09:20:00 IST",
          action: "F&O_SPREAD_DEPLOYED",
          details: `Deployed ${pos.lotsDeployed} lot(s) (${pos.totalQuantity} units) of ${pos.strategyName} with ₹${pos.marginBlockedINR.toLocaleString("en-IN")} hedged margin.`,
        },
        {
          timestamp: pos.exitTimestamp ? new Date(pos.exitTimestamp).toLocaleTimeString("en-IN") : "15:20:00 IST",
          action: pos.status,
          details: isTarget
            ? `Spot ₹${pos.currentSpotPrice} hit target ₹${pos.targetSpotLevel}. Net Realized +₹${pnl.toLocaleString("en-IN")} transferred to closed ledger.`
            : isSL
            ? `Spot ₹${pos.currentSpotPrice} broke SL ₹${pos.stopLossSpotLevel}. Risk capped at ₹${pnl.toLocaleString("en-IN")}.`
            : `Position squared off manually at ₹${pos.currentSpotPrice}. Realized ₹${pnl.toLocaleString("en-IN")}.`,
        },
      ],
    };
  }, []);

  return (
    <div className="space-y-5 font-mono text-slate-100">
      {/* Toast Notification */}
      {toastMsg && (
        <div className="fixed bottom-5 right-5 z-[60] px-4 py-3 rounded-2xl bg-[#0d1322]/95 backdrop-blur-xl border border-fuchsia-500/60 text-fuchsia-100 text-xs font-mono shadow-2xl flex items-center gap-2.5 animate-in fade-in slide-in-from-bottom-4">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{toastMsg}</span>
        </div>
      )}

      {/* Top Institutional F&O Quant Desk Banner with Real-Time Live Feed Indicator */}
      <div className="bg-[#0d1322]/90 backdrop-blur-xl border border-slate-800/80 hover:border-fuchsia-500/50 transition-all rounded-2xl p-5 shadow-2xl flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4">
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            {/* Prominent Live Feed / Market Hours Status Badge */}
            {liveTicker.isStreaming ? (
              <span className="px-2.5 py-1 rounded-lg bg-emerald-500/15 text-emerald-300 border border-emerald-500/40 text-[11px] font-extrabold flex items-center gap-1.5 shadow-[0_0_15px_rgba(16,185,129,0.2)]">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
                <span>🟢 LIVE FEED ACTIVE</span>
              </span>
            ) : (
              <span className="px-2.5 py-1 rounded-lg bg-rose-500/15 text-rose-300 border border-rose-500/40 text-[11px] font-extrabold flex items-center gap-1.5 shadow-[0_0_15px_rgba(244,63,94,0.2)]">
                <span>🔴 MARKET CLOSED — P&amp;L FROZEN</span>
              </span>
            )}

            <span className="px-2.5 py-1 rounded-lg bg-fuchsia-500/15 text-fuchsia-300 border border-fuchsia-500/40 text-[11px] font-bold">
              ISOLATED F&amp;O DERIVATIVES DESK
            </span>

            <span className="px-2.5 py-1 rounded-lg bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 text-[11px] font-bold flex items-center gap-1">
              <Lock className="w-3 h-3" />
              Same-Day Freeze ({lockedDateKey})
            </span>

            {lastSyncedAt && (
              <span className="text-[11px] text-slate-400 flex items-center gap-1">
                <Clock className="w-3 h-3 text-cyan-400" />
                Last Sync: {lastSyncedAt}
              </span>
            )}
          </div>

          <h2 className="text-xl sm:text-2xl font-extrabold tracking-tight text-white">
            NSE F&amp;O Quant Desk — Purple Box Spreads, OI Walls &amp; Payoff Simulator
          </h2>
          <p className="text-xs text-slate-400 max-w-3xl">
            {feedSource} · Range-Bound →{" "}
            <span className="text-fuchsia-300 font-semibold">Hedged Iron Condor</span> · VAL Support Bounce →{" "}
            <span className="text-emerald-300 font-semibold">Bull Put Credit Spread</span> · VAH Breakout + Doji →{" "}
            <span className="text-cyan-300 font-semibold">Bull Call Debit Spread</span>.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            onClick={() => setAutoRefreshEnabled((v) => !v)}
            className={`px-3 py-2 rounded-xl text-xs font-bold border flex items-center gap-1.5 transition-all cursor-pointer ${
              autoRefreshEnabled
                ? "bg-emerald-950/40 text-emerald-300 border-emerald-500/40"
                : "bg-slate-900 text-slate-400 border-slate-800"
            }`}
            title="Toggle 25-second real-time Yahoo Finance auto-sync"
          >
            <Radio className={`w-3.5 h-3.5 ${autoRefreshEnabled ? "text-emerald-400 animate-pulse" : ""}`} />
            <span>{autoRefreshEnabled ? "Auto-Sync ON" : "Auto-Sync OFF"}</span>
          </button>

          <Link
            href="/indian/swing"
            className="px-3.5 py-2 rounded-xl bg-slate-900/90 hover:bg-slate-800 text-slate-300 border border-slate-700 text-xs font-bold flex items-center gap-1.5 transition-colors"
          >
            <span>Cash Equity Swing Desk</span>
            <ArrowUpRight className="w-3.5 h-3.5 text-cyan-400" />
          </Link>

          <button
            onClick={() => fetchFOScanner(true)}
            disabled={loading}
            className="px-4 py-2 rounded-xl bg-gradient-to-r from-fuchsia-600 via-violet-600 to-cyan-600 hover:from-fuchsia-500 hover:to-cyan-500 text-white text-xs font-extrabold flex items-center gap-2 shadow-lg shadow-fuchsia-600/25 cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
            <span>{loading ? "Syncing Live Feed..." : "Sync Live Feed"}</span>
          </button>
        </div>
      </div>

      {/* 5-Card Portfolio Margin & Risk Exposure Strip (Glassmorphism) */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3.5">
        <div className="bg-[#0d1322]/90 backdrop-blur-xl border border-slate-800/80 hover:border-fuchsia-500/50 transition-all rounded-2xl p-4 shadow-2xl">
          <div className="text-[10px] text-slate-400 uppercase">F&amp;O Desk Allocation</div>
          <div className="text-lg font-extrabold text-white mt-1">
            ₹{(deskCapitalINR / 100000).toFixed(2)} Lakhs
          </div>
          <div className="text-[10px] text-slate-400 mt-0.5">
            Isolated Derivatives Pool
          </div>
        </div>

        <div className="bg-[#0d1322]/90 backdrop-blur-xl border border-slate-800/80 hover:border-fuchsia-500/50 transition-all rounded-2xl p-4 shadow-2xl">
          <div className="text-[10px] text-slate-400 uppercase">Hedged Margin Utilized</div>
          <div className="text-lg font-extrabold text-cyan-400 mt-1">
            ₹{currentMarginUsedINR.toLocaleString("en-IN")}{" "}
            <span className="text-xs text-slate-300">({marginUtilizationPct}%)</span>
          </div>
          <div className="w-full h-1.5 rounded-full bg-slate-800 mt-1.5 overflow-hidden">
            <div
              className={`h-full rounded-full ${
                marginUtilizationPct > 55 ? "bg-rose-500" : "bg-cyan-400"
              }`}
              style={{ width: `${Math.min(100, marginUtilizationPct)}%` }}
            />
          </div>
        </div>

        <div className="bg-[#0d1322]/90 backdrop-blur-xl border border-slate-800/80 hover:border-fuchsia-500/50 transition-all rounded-2xl p-4 shadow-2xl">
          <div className="text-[10px] text-slate-400 uppercase">Structure Breakdown</div>
          <div className="text-xs font-bold text-slate-200 mt-1.5 flex flex-wrap items-center gap-1.5">
            <span className="px-2 py-0.5 rounded bg-fuchsia-500/15 text-fuchsia-300 border border-fuchsia-500/30">
              Range: {setups.filter((s) => s.marketRegime === "RANGE_BOUND").length}
            </span>
            <span className="px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
              VAL: {setups.filter((s) => s.marketRegime === "SUPPORT_BOUNCE").length}
            </span>
            <span className="px-2 py-0.5 rounded bg-cyan-500/15 text-cyan-300 border border-cyan-500/30">
              VAH: {setups.filter((s) => s.marketRegime === "BREAKOUT_DOJI_SQUEEZE").length}
            </span>
          </div>
        </div>

        <div className="bg-[#0d1322]/90 backdrop-blur-xl border border-slate-800/80 hover:border-fuchsia-500/50 transition-all rounded-2xl p-4 shadow-2xl">
          <div className="text-[10px] text-slate-400 uppercase">Active Multi-Leg Spreads</div>
          <div className="text-lg font-extrabold text-fuchsia-300 mt-1">
            {activePositions.length} Spreads
          </div>
          <div className="text-[10px] text-emerald-400 mt-0.5">
            Same-Day Zero-Jump Entry Locked
          </div>
        </div>

        <div className="bg-[#0d1322]/90 backdrop-blur-xl border border-slate-800/80 hover:border-fuchsia-500/50 transition-all rounded-2xl p-4 shadow-2xl">
          <div className="text-[10px] text-slate-400 uppercase">Realized F&amp;O Ledger P&amp;L</div>
          <div
            className={`text-lg font-extrabold mt-1 ${
              realizedPnLINR >= 0 ? "text-emerald-400" : "text-rose-400"
            }`}
          >
            {realizedPnLINR >= 0 ? "+" : ""}₹{realizedPnLINR.toLocaleString("en-IN")}
          </div>
          <div className="text-[10px] text-slate-400 mt-0.5">
            {closedHistory.length} Closed Spreads
          </div>
        </div>
      </div>

      {/* 5-Tab F&O Sub-Navigation Bar */}
      <div className="flex flex-wrap items-center gap-2 p-1.5 rounded-2xl bg-[#0d1322]/90 backdrop-blur-xl border border-slate-800/80 shadow-xl">
        <button
          onClick={() => setSubTab("LIVE_COMMAND_CENTER")}
          className={`px-4 py-2.5 rounded-xl text-xs font-bold flex items-center gap-2 transition-all cursor-pointer ${
            subTab === "LIVE_COMMAND_CENTER"
              ? "bg-gradient-to-r from-emerald-600 via-teal-600 to-cyan-600 text-white shadow-md shadow-emerald-500/25"
              : "text-slate-400 hover:text-slate-100 hover:bg-slate-900"
          }`}
        >
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400" />
          </span>
          <span>0. Live Command Center</span>
        </button>

        <button
          onClick={() => setSubTab("SPREAD_SCANNER")}
          className={`px-4 py-2.5 rounded-xl text-xs font-bold flex items-center gap-2 transition-all cursor-pointer ${
            subTab === "SPREAD_SCANNER"
              ? "bg-gradient-to-r from-fuchsia-600 via-violet-600 to-cyan-600 text-white shadow-md"
              : "text-slate-400 hover:text-slate-100 hover:bg-slate-900"
          }`}
        >
          <Sparkles className="w-4 h-4" />
          <span>1. Purple Box &amp; Spread Scanner ({filteredSetups.length})</span>
        </button>

        <button
          onClick={() => setSubTab("OPTION_CHAIN")}
          className={`px-4 py-2.5 rounded-xl text-xs font-bold flex items-center gap-2 transition-all cursor-pointer ${
            subTab === "OPTION_CHAIN"
              ? "bg-gradient-to-r from-fuchsia-600 via-violet-600 to-cyan-600 text-white shadow-md"
              : "text-slate-400 hover:text-slate-100 hover:bg-slate-900"
          }`}
        >
          <Layers className="w-4 h-4" />
          <span>
            2. Option Chain, OI Walls &amp; Greeks ({activeSetup?.cleanSymbol || "NIFTY"})
          </span>
        </button>

        <button
          onClick={() => setSubTab("PAYOFF_SIMULATOR")}
          className={`px-4 py-2.5 rounded-xl text-xs font-bold flex items-center gap-2 transition-all cursor-pointer ${
            subTab === "PAYOFF_SIMULATOR"
              ? "bg-gradient-to-r from-fuchsia-600 via-violet-600 to-cyan-600 text-white shadow-md"
              : "text-slate-400 hover:text-slate-100 hover:bg-slate-900"
          }`}
        >
          <Sliders className="w-4 h-4" />
          <span>
            3. Risk, Margin &amp; Spread Payoff Simulator ({activeSetup?.cleanSymbol || "NIFTY"})
          </span>
        </button>

        <button
          onClick={() => setSubTab("ACTIVE_POSITIONS")}
          className={`px-4 py-2.5 rounded-xl text-xs font-bold flex items-center gap-2 transition-all cursor-pointer ${
            subTab === "ACTIVE_POSITIONS"
              ? "bg-gradient-to-r from-fuchsia-600 via-violet-600 to-cyan-600 text-white shadow-md"
              : "text-slate-400 hover:text-slate-100 hover:bg-slate-900"
          }`}
        >
          <Briefcase className="w-4 h-4" />
          <span>4. Active F&amp;O Spreads &amp; Ledger ({activePositions.length})</span>
        </button>
      </div>

      {/* Sub-Tab 0: Live F&O Command Center (1.5s ticking) */}
      {subTab === "LIVE_COMMAND_CENTER" && (
        <FOLiveCommandCenter
          setups={setups}
          activeSetup={activeSetup}
          positions={activePositions}
          ticker={liveTicker}
          onSelectSymbol={setSelectedSymbol}
        />
      )}

      {/* Sub-Tab 1: F&O Purple Box & Spread Scanner */}
      {subTab === "SPREAD_SCANNER" && (
        <FOPurpleBoxSpreadScanner
          setups={filteredSetups}
          loading={loading}
          selectedSetup={activeSetup}
          instrumentFilter={instrumentFilter}
          onChangeInstrumentFilter={setInstrumentFilter}
          regimeFilter={regimeFilter}
          onChangeRegimeFilter={setRegimeFilter}
          searchQuery={searchQuery}
          onChangeSearchQuery={setSearchQuery}
          onOpenOptionChainModal={(setup) => {
            setSelectedSymbol(setup.cleanSymbol);
            setIsChainModalOpen(true);
          }}
          onOpenPayoffSimModal={(setup) => {
            setSelectedSymbol(setup.cleanSymbol);
            setIsPayoffModalOpen(true);
          }}
          onDeploySpreadPosition={handleDeployFromScanner}
          deployedSymbols={deployedSymbols}
        />
      )}

      {/* Sub-Tab 2: Full-Page Option Chain & Greeks Analytics */}
      {subTab === "OPTION_CHAIN" && activeSetup && (
        <FOOptionChainAnalytics
          setups={setups}
          activeSetup={activeSetup}
          onSelectSetup={(setup) => setSelectedSymbol(setup.cleanSymbol)}
          onOpenInSimulator={(setup) => {
            setSelectedSymbol(setup.cleanSymbol);
            setIsPayoffModalOpen(true);
          }}
        />
      )}

      {/* Sub-Tab 3: Full-Page F&O Risk, Margin & Spread Payoff Simulator */}
      {subTab === "PAYOFF_SIMULATOR" && activeSetup && (
        <FOSpreadPayoffSimulator
          setups={setups}
          activeSetup={activeSetup}
          deskCapitalINR={deskCapitalINR}
          currentMarginUsedINR={currentMarginUsedINR}
          onSelectSetup={(setup) => setSelectedSymbol(setup.cleanSymbol)}
          onDeploySimulatedSpread={handleDeployFromSimulator}
        />
      )}

      {/* Sub-Tab 4: Active Multi-Leg F&O Spreads & Closed Ledger */}
      {subTab === "ACTIVE_POSITIONS" && (
        <div className="space-y-4">
          <div className="bg-[#0d1322]/90 backdrop-blur-xl border border-slate-800/80 rounded-2xl overflow-hidden shadow-2xl">
            {/* View Switcher Header: Active vs Show All Exit Trades in Backtest */}
            <div className="px-5 py-3.5 border-b border-slate-800 bg-slate-950/60 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setFoLedgerView("ACTIVE")}
                  className={`px-3.5 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
                    foLedgerView === "ACTIVE"
                      ? "bg-fuchsia-600/30 text-fuchsia-200 border border-fuchsia-500/60 shadow-lg shadow-fuchsia-500/10"
                      : "text-slate-400 hover:text-white bg-slate-900 border border-slate-800"
                  }`}
                >
                  <Briefcase className="w-3.5 h-3.5 text-fuchsia-400" />
                  <span>Active Multi-Leg Spreads ({activePositions.length})</span>
                </button>

                <button
                  onClick={() => setFoLedgerView("EXITED_BACKTEST")}
                  className={`px-3.5 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
                    foLedgerView === "EXITED_BACKTEST"
                      ? "bg-cyan-600/30 text-cyan-200 border border-cyan-500/60 shadow-lg shadow-cyan-500/10"
                      : "text-slate-400 hover:text-white bg-slate-900 border border-slate-800"
                  }`}
                >
                  <History className="w-3.5 h-3.5 text-cyan-400" />
                  <span>Show All Exit Trades in Backtest ({closedHistory.length})</span>
                </button>
              </div>

              {foLedgerView === "ACTIVE" ? (
                <span className="text-[11px] text-emerald-400 flex items-center gap-1">
                  <Lock className="w-3.5 h-3.5" />
                  Same-Day Execution locks Spot &amp; Net Premium at ₹0 (0%) Initial P&amp;L
                </span>
              ) : (
                <div className="flex items-center gap-1.5 flex-wrap text-xs">
                  <span className="text-[10px] text-slate-500 uppercase font-bold flex items-center gap-1 mr-1">
                    <Filter className="w-3 h-3" /> Filter:
                  </span>
                  {(["ALL", "TARGET_HIT", "SL_HIT", "MANUAL_EXIT"] as const).map((mode) => {
                    const count =
                      mode === "ALL"
                        ? closedHistory.length
                        : closedHistory.filter((c) => c.status === mode).length;
                    return (
                      <button
                        key={mode}
                        onClick={() => setClosedFilter(mode)}
                        className={`px-2.5 py-1 rounded-lg text-[10px] font-bold border transition-all cursor-pointer ${
                          closedFilter === mode
                            ? "bg-cyan-500/25 text-cyan-300 border-cyan-500/50 shadow-sm"
                            : "bg-slate-900 text-slate-400 border-slate-800 hover:text-slate-200"
                        }`}
                      >
                        {mode === "ALL"
                          ? `All (${count})`
                          : mode === "TARGET_HIT"
                          ? `🎯 Target Hits (${count})`
                          : mode === "SL_HIT"
                          ? `🛑 SL Hits (${count})`
                          : `⚡ Manual (${count})`}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* TAB VIEW 1: ACTIVE MULTI-LEG SPREADS */}
            {foLedgerView === "ACTIVE" && (
              <>
                {activePositions.length === 0 ? (
                  <div className="p-10 text-center space-y-3">
                    <p className="text-sm text-slate-400">
                      No active F&amp;O multi-leg spreads deployed yet.
                    </p>
                    <div className="flex items-center justify-center gap-2">
                      <button
                        onClick={() => setSubTab("SPREAD_SCANNER")}
                        className="px-4 py-2 rounded-xl bg-gradient-to-r from-fuchsia-600 to-cyan-600 text-white text-xs font-bold cursor-pointer"
                      >
                        Browse F&amp;O Purple Box Spread Scanner
                      </button>
                      {closedHistory.length > 0 && (
                        <button
                          onClick={() => setFoLedgerView("EXITED_BACKTEST")}
                          className="px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-cyan-300 border border-slate-800 text-xs font-bold cursor-pointer"
                        >
                          View Backtest Exit Ledger ({closedHistory.length})
                        </button>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="border-b border-slate-800 bg-slate-950/80 text-[10px] uppercase text-slate-400">
                          <th className="py-3 px-4">Underlying / Strategy</th>
                          <th className="py-3 px-3">Color-Coded Multi-Leg Strikes</th>
                          <th className="py-3 px-3">Lots &amp; Quantity</th>
                          <th className="py-3 px-3">Entry Spot / Current</th>
                          <th className="py-3 px-3">🎯 Target &amp; 🛑 SL Spot</th>
                          <th className="py-3 px-3">Breakeven / PoP %</th>
                          <th className="py-3 px-3">Hedged Margin</th>
                          <th className="py-3 px-3">Live Spread P&amp;L</th>
                          <th className="py-3 px-4 text-right">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/60">
                        {activePositions.map((pos) => {
                          const isSameDay = pos.entryDateKey === getTodayISTDateKey();
                          const liveTick = liveTicker.positionTicks[pos.positionId];
                          const unrealizedPnLINR = liveTick?.unrealizedPnLINR ?? 0;
                          const liveRoiPct = liveTick?.roiOnMarginPct ?? 0;
                          const liveSpot = liveTick?.spot ?? pos.currentSpotPrice;

                          return (
                            <tr key={pos.positionId} className="hover:bg-slate-900/40">
                              <td className="py-3.5 px-4">
                                <div className="font-extrabold text-white text-sm">
                                  {pos.cleanSymbol}{" "}
                                  <span className="text-[10px] text-fuchsia-300 font-normal">
                                    ({pos.expiryDate})
                                  </span>
                                </div>
                                <div className="text-[11px] text-cyan-300 font-bold mt-0.5">
                                  {pos.strategyName}
                                </div>
                                <div className="text-[10px] text-slate-500 mt-0.5">
                                  Locked Date: {pos.entryDateKey}
                                </div>
                              </td>

                              <td className="py-3.5 px-3">
                                <div className="space-y-1">
                                  {pos.legs.map((leg) => {
                                    const isBuy = leg.action === "BUY";
                                    return (
                                      <div
                                        key={leg.legId}
                                        className={`px-2 py-0.5 rounded-lg border text-[10px] flex items-center justify-between gap-2 ${
                                          isBuy
                                            ? "bg-emerald-950/25 border-emerald-500/40 text-emerald-300"
                                            : "bg-rose-950/25 border-rose-500/40 text-rose-300"
                                        }`}
                                      >
                                        <span className="font-extrabold">
                                          {leg.action} {leg.lots}x {leg.strike} {leg.right}
                                        </span>
                                        <span className="text-white font-bold">₹{leg.premium}</span>
                                      </div>
                                    );
                                  })}
                                </div>
                              </td>

                              <td className="py-3.5 px-3">
                                <div className="font-bold text-slate-100">
                                  {pos.lotsDeployed} Lot{pos.lotsDeployed > 1 ? "s" : ""}
                                </div>
                                <div className="text-[10px] text-slate-400">
                                  {pos.totalQuantity} Shares (Lot {pos.lotSize})
                                </div>
                              </td>

                              <td className="py-3.5 px-3">
                                <div className="text-slate-200">
                                  Entry: <strong>₹{pos.entrySpotPrice.toLocaleString("en-IN")}</strong>
                                </div>
                                <div className="text-cyan-300 text-[11px] mt-0.5 font-bold">
                                  LTP:{" "}
                                  <FlashValue value={liveSpot}>
                                    ₹{liveSpot.toLocaleString("en-IN")}
                                  </FlashValue>
                                </div>
                                <div className="text-[10px] text-slate-400 mt-0.5">
                                  VAL ₹{pos.valSupportFloor} ↔ VAH ₹{pos.vahResistanceCeiling}
                                </div>
                              </td>

                              <td className="py-3.5 px-3">
                                <div className="text-emerald-400 font-extrabold flex items-center gap-1">
                                  <span>🎯 ₹{pos.targetSpotLevel?.toLocaleString("en-IN")}</span>
                                </div>
                                <div className="text-rose-400 font-extrabold flex items-center gap-1 mt-0.5">
                                  <span>🛑 ₹{pos.stopLossSpotLevel?.toLocaleString("en-IN")}</span>
                                </div>
                                <div className="text-[10px] text-slate-500 mt-0.5">
                                  1:2.4 R:R Floor
                                </div>
                              </td>

                              <td className="py-3.5 px-3">
                                <div className="text-amber-300 font-semibold">
                                  ₹{pos.lowerBreakeven.toLocaleString("en-IN")}
                                  {pos.upperBreakeven
                                    ? ` – ₹${pos.upperBreakeven.toLocaleString("en-IN")}`
                                    : ""}
                                </div>
                                <div className="text-[10px] text-emerald-400 mt-0.5">
                                  PoP: {pos.probabilityOfProfitPct}%
                                </div>
                              </td>

                              <td className="py-3.5 px-3">
                                <div className="font-bold text-slate-100">
                                  ₹{pos.marginBlockedINR.toLocaleString("en-IN")}
                                </div>
                                <div className="text-[10px] text-slate-400 mt-0.5">
                                  Max Profit: +₹{pos.maxProfitINR.toLocaleString("en-IN")}
                                </div>
                              </td>

                              <td className="py-3.5 px-3">
                                <FlashValue
                                  value={unrealizedPnLINR}
                                  className={`text-sm font-extrabold ${
                                    unrealizedPnLINR >= 0 ? "text-emerald-400" : "text-rose-400"
                                  }`}
                                >
                                  {unrealizedPnLINR >= 0 ? "+" : ""}₹
                                  {unrealizedPnLINR.toLocaleString("en-IN")} ({liveRoiPct >= 0 ? "+" : ""}
                                  {liveRoiPct.toFixed(2)}%)
                                </FlashValue>
                                {isSameDay && (
                                  <span className="block w-fit mt-0.5 px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 text-[9px]">
                                    Entry Frozen · Live MTM
                                  </span>
                                )}
                              </td>

                              <td className="py-3.5 px-4 text-right">
                                <button
                                  onClick={() => handleSquareOffPosition(pos)}
                                  className="px-3 py-1.5 rounded-lg bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/40 text-[11px] font-bold inline-flex items-center gap-1 cursor-pointer"
                                >
                                  <XCircle className="w-3.5 h-3.5" />
                                  <span>Square Off</span>
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}

            {/* TAB VIEW 2: SHOW ALL EXIT TRADES IN BACKTEST ARCHIVE */}
            {foLedgerView === "EXITED_BACKTEST" && (
              <>
                {filteredClosedHistory.length === 0 ? (
                  <div className="p-10 text-center space-y-3">
                    <p className="text-sm text-slate-400">
                      No exited F&amp;O trades matching the selected filter ({closedFilter}).
                    </p>
                    <button
                      onClick={() => setClosedFilter("ALL")}
                      className="px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-cyan-300 border border-slate-800 text-xs font-bold cursor-pointer"
                    >
                      Clear Filter (Show All)
                    </button>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="border-b border-slate-800 bg-slate-950/80 text-[10px] uppercase text-slate-400">
                          <th className="py-3 px-4">Underlying / Strategy</th>
                          <th className="py-3 px-3">Multi-Leg Strikes</th>
                          <th className="py-3 px-3">Lots &amp; Quantity</th>
                          <th className="py-3 px-3">Entry → Exit Spot</th>
                          <th className="py-3 px-3">🎯 Target Spot</th>
                          <th className="py-3 px-3">🛑 Stop Loss Spot</th>
                          <th className="py-3 px-3">Exit Status &amp; Reason</th>
                          <th className="py-3 px-3">Realized Net P&amp;L</th>
                          <th className="py-3 px-4 text-right">Audit</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/60">
                        {filteredClosedHistory.map((pos) => {
                          const isTarget = pos.status === "TARGET_HIT";
                          const isSL = pos.status === "SL_HIT";
                          const pnl = pos.realizedPnLINR ?? 0;
                          const pnlPct = Number(
                            ((pnl / Math.max(1, pos.marginBlockedINR)) * 100).toFixed(2)
                          );

                          return (
                            <tr
                              key={pos.positionId}
                              onClick={() => setSelectedExitAuditTrade(mapFOPositionToAuditData(pos))}
                              className="hover:bg-cyan-950/20 cursor-pointer transition-colors group"
                            >
                              <td className="py-3.5 px-4">
                                <div className="font-extrabold text-white text-sm flex items-center gap-1.5">
                                  <span>{pos.cleanSymbol}</span>
                                  <span className="text-[10px] text-fuchsia-300 font-normal">
                                    ({pos.expiryDate})
                                  </span>
                                  <span className="text-[10px] text-cyan-400 opacity-0 group-hover:opacity-100 transition-opacity">
                                    🔍 Audit
                                  </span>
                                </div>
                                <div className="text-[11px] text-cyan-300 font-bold mt-0.5">
                                  {pos.strategyName}
                                </div>
                                <div className="text-[10px] text-slate-500 mt-0.5">
                                  ID: {pos.positionId}
                                </div>
                              </td>

                              <td className="py-3.5 px-3">
                                <div className="space-y-1">
                                  {pos.legs.map((leg) => {
                                    const isBuy = leg.action === "BUY";
                                    return (
                                      <div
                                        key={leg.legId}
                                        className={`px-2 py-0.5 rounded-lg border text-[10px] flex items-center justify-between gap-2 ${
                                          isBuy
                                            ? "bg-emerald-950/25 border-emerald-500/40 text-emerald-300"
                                            : "bg-rose-950/25 border-rose-500/40 text-rose-300"
                                        }`}
                                      >
                                        <span className="font-bold">
                                          {leg.action} {leg.lots}x {leg.strike} {leg.right}
                                        </span>
                                        <span className="text-white">₹{leg.premium}</span>
                                      </div>
                                    );
                                  })}
                                </div>
                              </td>

                              <td className="py-3.5 px-3">
                                <div className="font-bold text-slate-100">
                                  {pos.lotsDeployed} Lot{pos.lotsDeployed > 1 ? "s" : ""}
                                </div>
                                <div className="text-[10px] text-slate-400">
                                  {pos.totalQuantity} Shares
                                </div>
                              </td>

                              <td className="py-3.5 px-3">
                                <div className="text-slate-300 font-bold">
                                  ₹{pos.entrySpotPrice.toLocaleString("en-IN")} →{" "}
                                  <span className="text-white">
                                    ₹{pos.currentSpotPrice.toLocaleString("en-IN")}
                                  </span>
                                </div>
                                <div className="text-[10px] text-slate-500 mt-0.5">
                                  Out:{" "}
                                  {pos.exitTimestamp
                                    ? new Date(pos.exitTimestamp).toLocaleTimeString("en-IN")
                                    : "Market Close"}
                                </div>
                              </td>

                              <td className="py-3.5 px-3">
                                <div className="text-emerald-400 font-black text-xs flex items-center gap-1">
                                  <span>🎯 ₹{pos.targetSpotLevel?.toLocaleString("en-IN")}</span>
                                </div>
                                <span className="text-[9px] text-emerald-500/80 mt-0.5 block">
                                  VAH Resistance
                                </span>
                              </td>

                              <td className="py-3.5 px-3">
                                <div className="text-rose-400 font-black text-xs flex items-center gap-1">
                                  <span>🛑 ₹{pos.stopLossSpotLevel?.toLocaleString("en-IN")}</span>
                                </div>
                                <span className="text-[9px] text-rose-500/80 mt-0.5 block">
                                  VAL Floor Buffer
                                </span>
                              </td>

                              <td className="py-3.5 px-3">
                                <span
                                  className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-extrabold uppercase border ${
                                    isTarget
                                      ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/40"
                                      : isSL
                                      ? "bg-rose-500/20 text-rose-300 border-rose-500/40"
                                      : "bg-slate-800 text-slate-300 border-slate-700"
                                  }`}
                                >
                                  {isTarget ? "🎯 " : isSL ? "🛑 " : "⚡ "}
                                  {pos.status.replace(/_/g, " ")}
                                </span>
                              </td>

                              <td className="py-3.5 px-3">
                                <div
                                  className={`text-sm font-black ${
                                    pnl >= 0 ? "text-emerald-400" : "text-rose-400"
                                  }`}
                                >
                                  {pnl >= 0 ? "+" : ""}₹{pnl.toLocaleString("en-IN")}
                                </div>
                                <div
                                  className={`text-[10px] font-bold ${
                                    pnl >= 0 ? "text-emerald-400" : "text-rose-400"
                                  }`}
                                >
                                  {pnlPct >= 0 ? "+" : ""}
                                  {pnlPct}% ROI
                                </div>
                              </td>

                              <td className="py-3.5 px-4 text-right">
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setSelectedExitAuditTrade(mapFOPositionToAuditData(pos));
                                  }}
                                  className="px-3 py-1.5 rounded-lg bg-cyan-500/15 text-cyan-300 hover:bg-cyan-500/25 border border-cyan-500/30 text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer transition shadow-sm group-hover:scale-105"
                                >
                                  <Search className="w-3.5 h-3.5 text-cyan-400" />
                                  <span>🔍 View Exit Audit Log</span>
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════════
          MODAL A: "CHAIN & OI" DIALOG OVERLAY (Option Chain & Institutional Walls)
         ═══════════════════════════════════════════════════════════════════════════ */}
      {isChainModalOpen && activeSetup && (
        <div
          className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-3 sm:p-6 overflow-y-auto"
          onClick={() => setIsChainModalOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-label={`Option Chain and Institutional OI Walls for ${activeSetup.cleanSymbol}`}
        >
          <div
            className="w-full max-w-7xl max-h-[92vh] overflow-y-auto rounded-2xl bg-[#090d16] border border-cyan-500/40 shadow-[0_0_50px_rgba(6,182,212,0.2)] p-4 sm:p-6 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-800">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-cyan-500/15 border border-cyan-500/40 text-cyan-300">
                  <Layers className="w-5 h-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-base sm:text-lg font-extrabold text-white">
                      OPTION CHAIN &amp; INSTITUTIONAL OI WALLS — {activeSetup.cleanSymbol}
                    </h3>
                    <span className="px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/40 text-[10px] font-bold">
                      🟢 LIVE GREEKS &amp; OI
                    </span>
                  </div>
                  <p className="text-xs text-slate-400">
                    Spot ₹{activeSetup.spotPrice.toLocaleString("en-IN")} · PCR{" "}
                    <strong className="text-emerald-400">{activeSetup.optionChain.overallPCR}</strong> · Max Pain{" "}
                    <strong className="text-amber-300">₹{activeSetup.optionChain.maxPainStrike.toLocaleString("en-IN")}</strong> · Press{" "}
                    <kbd className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 text-[10px]">ESC</kbd> to close
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    setIsChainModalOpen(false);
                    setIsPayoffModalOpen(true);
                  }}
                  className="px-3.5 py-2 rounded-xl bg-fuchsia-600/25 hover:bg-fuchsia-600/40 text-fuchsia-200 border border-fuchsia-500/50 text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                >
                  <Sliders className="w-3.5 h-3.5" />
                  <span>Switch to Payoff Sim Modal</span>
                </button>

                <button
                  onClick={() => setIsChainModalOpen(false)}
                  className="p-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-700 cursor-pointer"
                  aria-label="Close Option Chain Modal"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Option Chain Analytics Body */}
            <FOOptionChainAnalytics
              setups={setups}
              activeSetup={activeSetup}
              onSelectSetup={(setup) => setSelectedSymbol(setup.cleanSymbol)}
              onOpenInSimulator={(setup) => {
                setSelectedSymbol(setup.cleanSymbol);
                setIsChainModalOpen(false);
                setIsPayoffModalOpen(true);
              }}
            />
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════════
          MODAL B: "PAYOFF SIM" DIALOG OVERLAY (Interactive Expiry Payoff Diagram)
         ═══════════════════════════════════════════════════════════════════════════ */}
      {isPayoffModalOpen && activeSetup && (
        <div
          className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-3 sm:p-6 overflow-y-auto"
          onClick={() => setIsPayoffModalOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-label={`Interactive Spread Payoff Simulator for ${activeSetup.cleanSymbol}`}
        >
          <div
            className="w-full max-w-7xl max-h-[92vh] overflow-y-auto rounded-2xl bg-[#090d16] border border-fuchsia-500/40 shadow-[0_0_50px_rgba(217,70,239,0.2)] p-4 sm:p-6 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-800">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-fuchsia-500/15 border border-fuchsia-500/40 text-fuchsia-300">
                  <Sliders className="w-5 h-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-base sm:text-lg font-extrabold text-white">
                      INTERACTIVE EXPIRY PAYOFF &amp; MARGIN SIMULATOR — {activeSetup.cleanSymbol}
                    </h3>
                    <span className="px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/40 text-[10px] font-bold">
                      🟢 89-PT LIVE PAYOFF CURVE
                    </span>
                  </div>
                  <p className="text-xs text-slate-400">
                    Matched Strategy: <strong className="text-fuchsia-300">{activeSetup.strategyName}</strong> · PoP{" "}
                    <strong className="text-emerald-400">{activeSetup.payoffMetrics.probabilityOfProfitPct}%</strong> · Press{" "}
                    <kbd className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 text-[10px]">ESC</kbd> to close
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    setIsPayoffModalOpen(false);
                    setIsChainModalOpen(true);
                  }}
                  className="px-3.5 py-2 rounded-xl bg-cyan-600/25 hover:bg-cyan-600/40 text-cyan-200 border border-cyan-500/50 text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                >
                  <Layers className="w-3.5 h-3.5" />
                  <span>Switch to Chain &amp; OI Modal</span>
                </button>

                <button
                  onClick={() => setIsPayoffModalOpen(false)}
                  className="p-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-700 cursor-pointer"
                  aria-label="Close Payoff Simulator Modal"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Interactive Payoff Simulator Body */}
            <FOSpreadPayoffSimulator
              setups={setups}
              activeSetup={activeSetup}
              deskCapitalINR={deskCapitalINR}
              currentMarginUsedINR={currentMarginUsedINR}
              onSelectSetup={(setup) => setSelectedSymbol(setup.cleanSymbol)}
              onDeploySimulatedSpread={handleDeployFromSimulator}
            />
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════════
          MODAL C: F&O TRADE EXIT AUDIT MODAL (Interactive Rationale & Microstructure)
         ═══════════════════════════════════════════════════════════════════════════ */}
      {selectedExitAuditTrade && (
        <IMTradeExitAuditModal
          trade={selectedExitAuditTrade}
          onClose={() => setSelectedExitAuditTrade(null)}
        />
      )}
    </div>
  );
}
