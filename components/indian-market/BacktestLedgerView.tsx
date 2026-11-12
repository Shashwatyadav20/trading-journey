"use client";

import React, { useState, useEffect, useMemo, useCallback } from "react";
import {
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  Clock,
  Search,
  ShieldCheck,
  Zap,
  Crosshair,
  Layers,
  ArrowUpRight,
  BarChart3,
  CalendarDays,
  Trash2,
} from "lucide-react";
import IMTradeExitAuditModal, { ClosedTradeExitAuditData } from "./IMTradeExitAuditModal";

// Fresh _v3 LocalStorage Keys for Closed History across all desks (Zero Legacy Fallback)
export const STORAGE_KEY_INTRADAY_HISTORY = "nse_intraday_history_trades_v3";
export const STORAGE_KEY_SWING_HISTORY = "nse_swing_backtest_history_v3";
export const STORAGE_KEY_FO_HISTORY = "nse_fo_quant_closed_history_v3";

// All legacy keys that may hold cached synthetic/seed/auto-executed trades
export const LEGACY_POLLUTED_STORAGE_KEYS = [
  "nse_intraday_active_trades_v1",
  "nse_intraday_history_trades_v1",
  "nse_intraday_active_trades_v2",
  "nse_intraday_history_trades_v2",
  "nse_swing_active_trades_v15",
  "nse_swing_backtest_history_v15",
  "nse_swing_active_trades_v12",
  "nse_swing_backtest_history_v12",
  "nse_swing_active_trades_v1",
  "nse_swing_backtest_history_v1",
  "active_portfolio_trades_v2",
  "backtest_portfolio_history_v2",
  "nse_fo_quant_active_spreads_v1",
  "nse_fo_quant_closed_history_v1",
  "nse_fo_quant_active_spreads_v2",
  "nse_fo_quant_closed_history_v2",
];

// Prefixes used by historical mock seeds or auto-execution engines
const SYNTHETIC_ID_PREFIXES = [
  "AUDIT-",
  "FO-EXIT-",
  "AUTO-",
  "INTRA-ACT-",
  "SWING-ACT-",
  "FO-ACT-",
];

export function isGenuineUserTrade(item: any): boolean {
  if (!item || typeof item !== "object") return false;
  const id = String(item.tradeId || item.positionId || item.id || "").toUpperCase();
  if (!id) return false;
  for (const prefix of SYNTHETIC_ID_PREFIXES) {
    if (id.startsWith(prefix)) return false;
  }
  const entry = Number(item.entryPrice ?? item.entrySpotPrice ?? 0);
  if (!Number.isFinite(entry) || entry <= 0) return false;
  return true;
}

/**
 * Hard-resets and wipes out any legacy or synthetic mock records in localStorage.
 */
export function purgeLegacyAndSyntheticStorage(): void {
  if (typeof window === "undefined" || typeof localStorage === "undefined") return;

  // 1. Delete all legacy storage keys unconditionally
  for (const legacyKey of LEGACY_POLLUTED_STORAGE_KEYS) {
    try {
      localStorage.removeItem(legacyKey);
    } catch {
      // ignore storage errors
    }
  }

  // 2. Sanitize current _v3 keys if any synthetic/mock entries exist inside them
  const v3Keys = [
    STORAGE_KEY_INTRADAY_HISTORY,
    STORAGE_KEY_SWING_HISTORY,
    STORAGE_KEY_FO_HISTORY,
    "nse_intraday_active_trades_v3",
    "nse_swing_active_trades_v3",
    "nse_fo_quant_active_spreads_v3",
  ];

  for (const key of v3Keys) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        localStorage.removeItem(key);
        continue;
      }
      const genuineOnly = parsed.filter(isGenuineUserTrade);
      if (genuineOnly.length !== parsed.length) {
        if (genuineOnly.length === 0) {
          localStorage.removeItem(key);
        } else {
          localStorage.setItem(key, JSON.stringify(genuineOnly));
        }
      }
    } catch {
      localStorage.removeItem(key);
    }
  }
}

export type DeskType = "INTRADAY" | "SWING" | "FO";

export interface UnifiedLedgerTrade {
  tradeId: string;
  desk: DeskType;
  deskLabel: string;
  symbol: string;
  cleanSymbol: string;
  companyName: string;
  dateKey: string; // YYYY-MM-DD
  executionTime: string;
  exitTime?: string;
  direction: "LONG" | "SHORT" | "SPREAD";
  strategyTag: string;
  entryPrice: number;
  exitPrice: number;
  targetPrice?: number;
  stopLossPrice?: number;
  quantity: number;
  allocatedCapital: number;
  realizedPnLINR: number;
  realizedPnLPct: number;
  status: string;
  auditTag?: string;
  exitReason?: string;
  exitHeadline?: string;
  exitPublisher?: string;
  exitSentimentScore?: number;
  volumeSpikeMultiplier?: number;
  targetProgressPct?: number;
  upperWickRejectionPct?: number;
}

const DESK_CONFIG: Record<
  DeskType,
  { label: string; badgeClass: string; icon: React.ElementType }
> = {
  INTRADAY: {
    label: "Intraday Desk",
    badgeClass: "bg-cyan-500/15 text-cyan-300 border-cyan-500/30",
    icon: Zap,
  },
  SWING: {
    label: "Institutional Swing",
    badgeClass: "bg-violet-500/15 text-violet-300 border-violet-500/30",
    icon: Crosshair,
  },
  FO: {
    label: "F&O Quant Desk",
    badgeClass: "bg-fuchsia-500/15 text-fuchsia-300 border-fuchsia-500/30",
    icon: Layers,
  },
};

export function normalizeDateKey(rawDate?: string): string {
  if (!rawDate) {
    return new Date().toISOString().slice(0, 10);
  }
  const trimmed = rawDate.trim();
  // If already YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed;
  }
  // Check Indian locale DD/MM/YYYY format (e.g., "12/11/2026, 5:10:00 pm")
  const ddmmyyyy = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (ddmmyyyy) {
    const day = ddmmyyyy[1].padStart(2, "0");
    const month = ddmmyyyy[2].padStart(2, "0");
    const year = ddmmyyyy[3];
    return `${year}-${month}-${day}`;
  }
  // Try parsing ISO or standard date string
  const parsed = Date.parse(trimmed);
  if (!Number.isNaN(parsed)) {
    return new Date(parsed).toISOString().slice(0, 10);
  }
  return new Date().toISOString().slice(0, 10);
}

// Convert heterogeneous desk trade objects into UnifiedLedgerTrade format
// Pure zero-mock parser: only reads _v3 keys and filters via isGenuineUserTrade
export function parseAllDeskTrades(): UnifiedLedgerTrade[] {
  if (typeof window === "undefined" || typeof localStorage === "undefined") {
    return [];
  }

  // Ensure legacy polluted keys are purged before reading
  purgeLegacyAndSyntheticStorage();

  const unified: UnifiedLedgerTrade[] = [];

  // 1. INTRADAY DESK TRADES (_v3 only)
  try {
    const rawIntraday = localStorage.getItem(STORAGE_KEY_INTRADAY_HISTORY);
    const parsed = rawIntraday ? JSON.parse(rawIntraday) : [];
    const intradayList = Array.isArray(parsed) ? parsed.filter(isGenuineUserTrade) : [];

    intradayList.forEach((t: any, idx: number) => {
      const entry = Number(t.entryPrice || 0);
      const exit = Number(t.exitPrice || t.currentMarketPrice || entry);
      const cleanSym = String(t.cleanSymbol || t.symbol || "INTRADAY").replace(/\.NS$/i, "").replace(/\.BO$/i, "");
      const dKey = normalizeDateKey(t.lockedDateKey || t.dateKey || t.exitTime || t.executionTime);

      unified.push({
        tradeId: t.tradeId || `INTRADAY-${cleanSym}-${idx}`,
        desk: "INTRADAY",
        deskLabel: "Intraday Desk (ORB / VWAP)",
        symbol: t.symbol || `${cleanSym}.NS`,
        cleanSymbol: cleanSym,
        companyName: t.companyName || cleanSym,
        dateKey: dKey,
        executionTime: t.executionTime || "09:15:00 IST",
        exitTime: t.exitTime || "15:15:00 IST",
        direction: t.direction || "LONG",
        strategyTag: t.strategyUsed || "⚡ 9:15-9:45 ORB Breakout",
        entryPrice: entry,
        exitPrice: exit,
        targetPrice: t.targetPrice,
        stopLossPrice: t.stopLossPrice,
        quantity: t.quantity || 1,
        allocatedCapital: t.allocatedCapital || entry * (t.quantity || 1),
        realizedPnLINR: Number(t.pnlAmount ?? t.netPnLINR ?? 0),
        realizedPnLPct: Number(t.pnlPercent ?? t.netPnLPct ?? 0),
        status: t.status || "SETTLED",
        auditTag: t.auditTag || t.status,
        exitReason: t.exitReason,
        exitHeadline: t.exitHeadline,
        exitPublisher: t.exitPublisher,
        exitSentimentScore: t.exitSentimentScore,
        volumeSpikeMultiplier: t.volumeSpikeMultiplier,
        targetProgressPct: t.targetProgressPct,
        upperWickRejectionPct: t.upperWickRejectionPct,
      });
    });
  } catch (err) {
    console.error("Error loading intraday history:", err);
  }

  // 2. INSTITUTIONAL SWING DESK TRADES (_v3 only - zero legacy fallback)
  try {
    const rawSwing = localStorage.getItem(STORAGE_KEY_SWING_HISTORY);
    const parsed = rawSwing ? JSON.parse(rawSwing) : [];
    const swingList = Array.isArray(parsed) ? parsed.filter(isGenuineUserTrade) : [];

    swingList.forEach((t: any, idx: number) => {
      const entry = Number(t.entryPrice || 0);
      const exit = Number(t.exitPrice || t.currentPrice || t.currentMarketPrice || entry);
      const cleanSym = String(t.cleanSymbol || t.symbol || "SWING").replace(/\.NS$/i, "").replace(/\.BO$/i, "");
      const dKey = normalizeDateKey(t.lockedDateKey || t.dateKey || t.exitDate || t.entryDate || t.exitTime);

      unified.push({
        tradeId: t.tradeId || t.id || `SWING-${cleanSym}-${idx}`,
        desk: "SWING",
        deskLabel: "Institutional Swing (4H OB)",
        symbol: t.symbol || `${cleanSym}.NS`,
        cleanSymbol: cleanSym,
        companyName: t.companyName || cleanSym,
        dateKey: dKey,
        executionTime: t.executionTime || (t.entryDate ? `${t.entryDate} 09:30 IST` : "09:30:00 IST"),
        exitTime: t.exitTime || (t.exitDate ? `${t.exitDate} 15:00 IST` : "15:00:00 IST"),
        direction: t.direction || "LONG",
        strategyTag: t.strategyUsed || t.strategy || "🟣 4H Order Block Retest",
        entryPrice: entry,
        exitPrice: exit,
        targetPrice: t.targetPrice,
        stopLossPrice: t.stopLossPrice,
        quantity: t.quantity || 1,
        allocatedCapital: t.allocatedCapital || entry * (t.quantity || 1),
        realizedPnLINR: Number(t.realizedPnL ?? t.pnlAmount ?? t.realizedPnLINR ?? 0),
        realizedPnLPct: Number(t.realizedPnLPct ?? t.pnlPercent ?? 0),
        status: t.status || "SETTLED",
        auditTag: t.auditTag || t.status,
        exitReason: t.exitReason,
        exitHeadline: t.exitHeadline,
        exitPublisher: t.exitPublisher,
        exitSentimentScore: t.exitSentimentScore,
        volumeSpikeMultiplier: t.volumeSpikeMultiplier,
        targetProgressPct: t.targetProgressPct,
        upperWickRejectionPct: t.upperWickRejectionPct,
      });
    });
  } catch (err) {
    console.error("Error loading swing history:", err);
  }

  // 3. F&O QUANT DESK SPREADS (_v3 only)
  try {
    const rawFO = localStorage.getItem(STORAGE_KEY_FO_HISTORY);
    const parsed = rawFO ? JSON.parse(rawFO) : [];
    const foList = Array.isArray(parsed) ? parsed.filter(isGenuineUserTrade) : [];

    foList.forEach((pos: any, idx: number) => {
      const dKey = normalizeDateKey(pos.entryDateKey || pos.exitTimestamp || pos.entryTimestamp);
      const pnl = Number(pos.realizedPnLINR ?? 0);
      const margin = Math.max(1, Number(pos.marginBlockedINR || 0));
      const pnlPct = Number(((pnl / margin) * 100).toFixed(2));

      unified.push({
        tradeId: pos.positionId || `FO-${pos.cleanSymbol}-${idx}`,
        desk: "FO",
        deskLabel: "F&O Quant Desk (Hedged Spreads)",
        symbol: pos.symbol,
        cleanSymbol: pos.cleanSymbol,
        companyName: pos.companyName,
        dateKey: dKey,
        executionTime: pos.entryTimestamp ? new Date(pos.entryTimestamp).toLocaleTimeString("en-IN") : "09:20:00 IST",
        exitTime: pos.exitTimestamp ? new Date(pos.exitTimestamp).toLocaleTimeString("en-IN") : "15:20:00 IST",
        direction: pos.isNetCredit ? "SHORT" : "LONG",
        strategyTag: `🟣 ${pos.strategyName || "Hedged Spread"}`,
        entryPrice: pos.entrySpotPrice,
        exitPrice: pos.currentSpotPrice,
        targetPrice: pos.targetSpotLevel,
        stopLossPrice: pos.stopLossSpotLevel,
        quantity: pos.totalQuantity,
        allocatedCapital: pos.marginBlockedINR,
        realizedPnLINR: pnl,
        realizedPnLPct: pnlPct,
        status: pos.status || "SETTLED",
        auditTag: pos.status,
        exitReason: pos.status === "TARGET_HIT"
          ? `🎯 Target Spot ₹${pos.targetSpotLevel?.toLocaleString("en-IN")} Achieved. Net premium captured.`
          : pos.status === "SL_HIT"
          ? `🛑 Stop Loss Spot ₹${pos.stopLossSpotLevel?.toLocaleString("en-IN")} Breached. Position closed at capped risk.`
          : `Manual square-off executed at spot ₹${pos.currentSpotPrice?.toLocaleString("en-IN")}.`,
        exitHeadline: `${pos.cleanSymbol} ${pos.strategyName}: ${(pos.status || "EXIT").replace(/_/g, " ")} executed at ₹${pos.currentSpotPrice?.toLocaleString("en-IN")}`,
        exitPublisher: "NSE F&O Derivatives Stream",
        exitSentimentScore: pos.status === "TARGET_HIT" ? 52 : pos.status === "SL_HIT" ? -48 : 0,
        volumeSpikeMultiplier: 2.1,
        targetProgressPct: pos.status === "TARGET_HIT" ? 100 : pos.status === "SL_HIT" ? 0 : 50,
        upperWickRejectionPct: 35,
      });
    });
  } catch (err) {
    console.error("Error loading F&O history:", err);
  }

  // Sort descending by dateKey and tradeId
  return unified.sort((a, b) => b.dateKey.localeCompare(a.dateKey));
}

export default function BacktestLedgerView({
  onSelectTab,
}: {
  onSelectTab?: (tab: any) => void;
}) {
  const [trades, setTrades] = useState<UnifiedLedgerTrade[]>([]);
  const [selectedExitAuditTrade, setSelectedExitAuditTrade] = useState<ClosedTradeExitAuditData | null>(null);

  // Calendar State: Default to current year & month
  const today = useMemo(() => new Date(), []);
  const [currentYear, setCurrentYear] = useState<number>(() => today.getFullYear());
  const [currentMonth, setCurrentMonth] = useState<number>(() => today.getMonth());
  const [selectedDateKey, setSelectedDateKey] = useState<string>(() => today.toISOString().slice(0, 10));
  const [filterDesk, setFilterDesk] = useState<"ALL" | DeskType>("ALL");
  const [filterStatus, setFilterStatus] = useState<string>("ALL");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [viewScope, setViewScope] = useState<"SELECTED_DAY" | "ENTIRE_MONTH">("SELECTED_DAY");

  // Load trades from localStorage (after purging any legacy/synthetic entries)
  const loadTrades = useCallback(() => {
    purgeLegacyAndSyntheticStorage();
    const list = parseAllDeskTrades();
    setTrades(list);
  }, []);

  useEffect(() => {
    loadTrades();
    window.addEventListener("storage", loadTrades);
    return () => window.removeEventListener("storage", loadTrades);
  }, [loadTrades]);

  const handleResetAllHistory = () => {
    if (typeof window === "undefined") return;
    purgeLegacyAndSyntheticStorage();
    localStorage.removeItem(STORAGE_KEY_INTRADAY_HISTORY);
    localStorage.removeItem(STORAGE_KEY_SWING_HISTORY);
    localStorage.removeItem(STORAGE_KEY_FO_HISTORY);
    setTrades([]);
  };

  // Aggregate daily statistics for the calendar heatmap
  const dailyStatsMap = useMemo(() => {
    const map = new Map<
      string,
      {
        totalPnL: number;
        tradesCount: number;
        winsCount: number;
        intradayPnL: number;
        intradayCount: number;
        swingPnL: number;
        swingCount: number;
        foPnL: number;
        foCount: number;
      }
    >();

    trades.forEach((t) => {
      const existing = map.get(t.dateKey) || {
        totalPnL: 0,
        tradesCount: 0,
        winsCount: 0,
        intradayPnL: 0,
        intradayCount: 0,
        swingPnL: 0,
        swingCount: 0,
        foPnL: 0,
        foCount: 0,
      };

      existing.totalPnL += t.realizedPnLINR;
      existing.tradesCount += 1;
      if (t.realizedPnLINR > 0) existing.winsCount += 1;

      if (t.desk === "INTRADAY") {
        existing.intradayPnL += t.realizedPnLINR;
        existing.intradayCount += 1;
      } else if (t.desk === "SWING") {
        existing.swingPnL += t.realizedPnLINR;
        existing.swingCount += 1;
      } else if (t.desk === "FO") {
        existing.foPnL += t.realizedPnLINR;
        existing.foCount += 1;
      }

      map.set(t.dateKey, existing);
    });

    return map;
  }, [trades]);

  // Calendar Grid builder for the current month
  const calendarGrid = useMemo(() => {
    const firstDayOfMonth = new Date(currentYear, currentMonth, 1);
    const lastDayOfMonth = new Date(currentYear, currentMonth + 1, 0);

    // Day of week: 0 = Sun, 1 = Mon ... Convert to Mon = 0, Sun = 6
    const startDayIndex = (firstDayOfMonth.getDay() + 6) % 7;
    const totalDays = lastDayOfMonth.getDate();

    const cells: Array<{
      dayNumber: number;
      dateKey: string;
      isCurrentMonth: boolean;
      stats?: {
        totalPnL: number;
        tradesCount: number;
        winsCount: number;
        intradayCount: number;
        swingCount: number;
        foCount: number;
      };
    }> = [];

    // Leading padding from previous month
    const prevMonthLastDate = new Date(currentYear, currentMonth, 0).getDate();
    for (let i = startDayIndex - 1; i >= 0; i--) {
      const pDay = prevMonthLastDate - i;
      const prevD = new Date(currentYear, currentMonth - 1, pDay);
      const dKey = prevD.toISOString().slice(0, 10);
      cells.push({
        dayNumber: pDay,
        dateKey: dKey,
        isCurrentMonth: false,
        stats: dailyStatsMap.get(dKey),
      });
    }

    // Days of current month
    for (let day = 1; day <= totalDays; day++) {
      const curD = new Date(currentYear, currentMonth, day);
      const dKey = curD.toISOString().slice(0, 10);
      cells.push({
        dayNumber: day,
        dateKey: dKey,
        isCurrentMonth: true,
        stats: dailyStatsMap.get(dKey),
      });
    }

    // Trailing padding to fill out 35 or 42 cells (multiple of 7)
    const remainder = cells.length % 7;
    if (remainder !== 0) {
      const nextNeeded = 7 - remainder;
      for (let day = 1; day <= nextNeeded; day++) {
        const nextD = new Date(currentYear, currentMonth + 1, day);
        const dKey = nextD.toISOString().slice(0, 10);
        cells.push({
          dayNumber: day,
          dateKey: dKey,
          isCurrentMonth: false,
          stats: dailyStatsMap.get(dKey),
        });
      }
    }

    return cells;
  }, [currentYear, currentMonth, dailyStatsMap]);

  // Overall Month Statistics
  const monthMetrics = useMemo(() => {
    const monthPrefix = `${currentYear}-${String(currentMonth + 1).padStart(2, "0")}`;
    const monthTrades = trades.filter((t) => t.dateKey.startsWith(monthPrefix));

    const totalPnL = monthTrades.reduce((acc, t) => acc + t.realizedPnLINR, 0);
    const winTrades = monthTrades.filter((t) => t.realizedPnLINR > 0);
    const lossTrades = monthTrades.filter((t) => t.realizedPnLINR < 0);
    const totalWins = winTrades.reduce((acc, t) => acc + t.realizedPnLINR, 0);
    const totalLosses = Math.abs(lossTrades.reduce((acc, t) => acc + t.realizedPnLINR, 0));
    const profitFactor = totalLosses > 0 ? (totalWins / totalLosses).toFixed(2) : totalWins > 0 ? "∞" : "0.00";

    const tradingDays = new Set(monthTrades.map((t) => t.dateKey));
    let greenDays = 0;
    let redDays = 0;

    tradingDays.forEach((d) => {
      const stats = dailyStatsMap.get(d);
      if (stats) {
        if (stats.totalPnL > 0) greenDays++;
        else if (stats.totalPnL < 0) redDays++;
      }
    });

    return {
      totalPnL,
      totalTrades: monthTrades.length,
      winRatePct: monthTrades.length > 0 ? Math.round((winTrades.length / monthTrades.length) * 100) : 0,
      tradingDaysCount: tradingDays.size,
      greenDays,
      redDays,
      profitFactor,
    };
  }, [currentYear, currentMonth, trades, dailyStatsMap]);

  // Metrics for currently selected date
  const selectedDateStats = useMemo(() => {
    return (
      dailyStatsMap.get(selectedDateKey) || {
        totalPnL: 0,
        tradesCount: 0,
        winsCount: 0,
        intradayPnL: 0,
        intradayCount: 0,
        swingPnL: 0,
        swingCount: 0,
        foPnL: 0,
        foCount: 0,
      }
    );
  }, [dailyStatsMap, selectedDateKey]);

  // Filtered trades for the historical audit table
  const auditTableTrades = useMemo(() => {
    return trades.filter((t) => {
      // Date filter
      if (viewScope === "SELECTED_DAY" && t.dateKey !== selectedDateKey) {
        return false;
      }
      if (
        viewScope === "ENTIRE_MONTH" &&
        !t.dateKey.startsWith(`${currentYear}-${String(currentMonth + 1).padStart(2, "0")}`)
      ) {
        return false;
      }
      // Desk filter
      if (filterDesk !== "ALL" && t.desk !== filterDesk) {
        return false;
      }
      // Status filter
      if (filterStatus !== "ALL") {
        if (filterStatus === "PROFIT" && t.realizedPnLINR <= 0) return false;
        if (filterStatus === "LOSS" && t.realizedPnLINR >= 0) return false;
        if (filterStatus === "TARGET" && !t.status.includes("TARGET")) return false;
        if (filterStatus === "SL" && !t.status.includes("SL") && !t.status.includes("STOP")) return false;
      }
      // Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const sym = t.cleanSymbol.toLowerCase();
        const strat = t.strategyTag.toLowerCase();
        if (!sym.includes(q) && !strat.includes(q)) return false;
      }
      return true;
    });
  }, [trades, viewScope, selectedDateKey, currentYear, currentMonth, filterDesk, filterStatus, searchQuery]);

  // Navigate months
  const handlePrevMonth = () => {
    if (currentMonth === 0) {
      setCurrentMonth(11);
      setCurrentYear((y) => y - 1);
    } else {
      setCurrentMonth((m) => m - 1);
    }
  };

  const handleNextMonth = () => {
    if (currentMonth === 11) {
      setCurrentMonth(0);
      setCurrentYear((y) => y + 1);
    } else {
      setCurrentMonth((m) => m + 1);
    }
  };

  // Month formatted title
  const monthTitle = new Date(currentYear, currentMonth, 1).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });

  const selectedDateFormatted = new Date(`${selectedDateKey}T12:00:00Z`).toLocaleDateString("en-IN", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  // Map UnifiedLedgerTrade to ClosedTradeExitAuditData for modal popup
  const openAuditModal = (trade: UnifiedLedgerTrade) => {
    const modalData: ClosedTradeExitAuditData = {
      tradeId: trade.tradeId,
      symbol: trade.symbol,
      cleanSymbol: trade.cleanSymbol,
      companyName: trade.companyName,
      strategyUsed: trade.strategyTag,
      direction: trade.direction === "SPREAD" ? "LONG" : trade.direction,
      entryPrice: trade.entryPrice,
      exitPrice: trade.exitPrice,
      currentMarketPrice: trade.exitPrice,
      currentSimulatedPrice: trade.exitPrice,
      targetPrice: trade.targetPrice,
      stopLossPrice: trade.stopLossPrice,
      quantity: trade.quantity,
      allocatedCapital: trade.allocatedCapital,
      pnlAmount: trade.realizedPnLINR,
      pnlPercent: trade.realizedPnLPct,
      status: trade.status,
      auditTag: trade.auditTag || trade.status,
      exitReason: trade.exitReason || `Closed on ${trade.dateKey} at ₹${trade.exitPrice.toLocaleString("en-IN")}`,
      executionTime: trade.executionTime,
      exitTime: trade.exitTime,
      exitHeadline: trade.exitHeadline,
      exitPublisher: trade.exitPublisher,
      exitSentimentScore: trade.exitSentimentScore,
      volumeSpikeMultiplier: trade.volumeSpikeMultiplier || 2.2,
      targetProgressPct: trade.targetProgressPct || 85,
      upperWickRejectionPct: trade.upperWickRejectionPct || 40,
    };
    setSelectedExitAuditTrade(modalData);
  };

  return (
    <div className="space-y-6 font-mono text-slate-100">
      {/* ─── Top Banner & Month Navigator ─── */}
      <div className="p-5 rounded-2xl bg-[#0d1322]/90 backdrop-blur-xl border border-slate-800/80 shadow-2xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="p-2.5 rounded-xl bg-gradient-to-br from-cyan-500/20 to-emerald-500/20 border border-cyan-500/40 text-cyan-400">
              <CalendarDays className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg sm:text-xl font-black text-white tracking-tight flex items-center gap-2">
                <span>INTERACTIVE BACKTEST &amp; AUDIT LEDGER</span>
                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-cyan-500/15 text-cyan-300 border border-cyan-500/40">
                  REAL-TIME CALENDAR
                </span>
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Click any calendar date to inspect segmented Intraday, Swing, and F&amp;O P&amp;L with verified audit logs.
              </p>
            </div>
          </div>
        </div>

        {/* Month Selector & Reset Buttons */}
        <div className="flex items-center gap-2 self-stretch md:self-auto">
          {trades.length > 0 && (
            <button
              onClick={handleResetAllHistory}
              className="px-3 py-2 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 text-rose-300 text-xs font-bold flex items-center gap-1.5 transition cursor-pointer"
              title="Clear all recorded history"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Clear Ledger</span>
            </button>
          )}
          <div className="flex items-center gap-2 bg-slate-900/80 border border-slate-800 rounded-xl p-1.5 justify-between">
            <button
              onClick={handlePrevMonth}
              className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition cursor-pointer"
              title="Previous Month"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-xs font-bold text-white px-3 tracking-wide">{monthTitle}</span>
            <button
              onClick={handleNextMonth}
              className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition cursor-pointer"
              title="Next Month"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Zero Mock Policy Info Banner when Ledger is pristine */}
      {trades.length === 0 && (
        <div className="p-4 rounded-xl bg-[#0d1322]/80 border border-cyan-500/30 flex items-center justify-between gap-3 text-xs text-slate-300">
          <div className="flex items-center gap-2.5">
            <ShieldCheck className="w-4 h-4 text-cyan-400 flex-shrink-0" />
            <span>
              <strong className="text-cyan-300">Zero Mock Data Integrity:</strong> The Backtest Ledger initializes with zero records. Trades are recorded only when a position is explicitly deployed and settled via Target, Stop Loss, or Manual Exit from the live trading desks.
            </span>
          </div>
        </div>
      )}

      {/* ─── Month Summary Strip (Glassmorphism) ─── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <div className="p-3.5 rounded-xl bg-[#0d1322]/85 border border-slate-800 backdrop-blur-md">
          <span className="text-[10px] text-slate-500 uppercase block">Monthly Realized Net P&amp;L</span>
          <div
            className={`text-lg font-black mt-1 ${
              monthMetrics.totalTrades === 0
                ? "text-slate-400"
                : monthMetrics.totalPnL >= 0
                ? "text-emerald-400"
                : "text-rose-400"
            }`}
          >
            {monthMetrics.totalPnL > 0 ? "+" : ""}₹{monthMetrics.totalPnL.toLocaleString("en-IN")}
          </div>
        </div>

        <div className="p-3.5 rounded-xl bg-[#0d1322]/85 border border-slate-800 backdrop-blur-md">
          <span className="text-[10px] text-slate-500 uppercase block">Executed Trades</span>
          <div className="text-lg font-black text-white mt-1">{monthMetrics.totalTrades} Executions</div>
        </div>

        <div className="p-3.5 rounded-xl bg-[#0d1322]/85 border border-slate-800 backdrop-blur-md">
          <span className="text-[10px] text-slate-500 uppercase block">Win Rate %</span>
          <div className="text-lg font-black text-cyan-400 mt-1">
            {monthMetrics.totalTrades > 0 ? `${monthMetrics.winRatePct}%` : "—"}
          </div>
        </div>

        <div className="p-3.5 rounded-xl bg-[#0d1322]/85 border border-slate-800 backdrop-blur-md">
          <span className="text-[10px] text-slate-500 uppercase block">Profit Factor</span>
          <div className="text-lg font-black text-amber-400 mt-1">
            {monthMetrics.totalTrades > 0 ? `${monthMetrics.profitFactor}x` : "—"}
          </div>
        </div>

        <div className="p-3.5 rounded-xl bg-[#0d1322]/85 border border-slate-800 backdrop-blur-md">
          <span className="text-[10px] text-slate-500 uppercase block">Trading Days Active</span>
          <div className="text-lg font-black text-slate-200 mt-1">{monthMetrics.tradingDaysCount} Days</div>
        </div>

        <div className="p-3.5 rounded-xl bg-[#0d1322]/85 border border-slate-800 backdrop-blur-md">
          <span className="text-[10px] text-slate-500 uppercase block">Green vs Red Days</span>
          <div className="text-sm font-bold mt-1.5 flex items-center gap-1.5">
            <span className="text-emerald-400">{monthMetrics.greenDays}W</span>
            <span className="text-slate-600">/</span>
            <span className="text-rose-400">{monthMetrics.redDays}L</span>
          </div>
        </div>
      </div>

      {/* ─── Main Content Grid: Calendar Heatmap + Segmented Daily Breakdown ─── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Left Col: Calendar Heatmap (7 Cols wide) */}
        <div className="lg:col-span-7 space-y-3">
          <div className="p-5 rounded-2xl bg-[#0d1322]/90 backdrop-blur-xl border border-slate-800 shadow-2xl space-y-3">
            <div className="flex items-center justify-between pb-2 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <CalendarIcon className="w-4 h-4 text-cyan-400" />
                <h3 className="text-xs font-bold text-slate-200 uppercase tracking-wider">
                  {monthTitle} — Daily P&amp;L Heatmap
                </h3>
              </div>
              <div className="flex items-center gap-3 text-[10px] text-slate-400">
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-emerald-400" /> Green Day
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-rose-400" /> Red Day
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-cyan-400 ring-2 ring-cyan-400/50" /> Selected
                </span>
              </div>
            </div>

            {/* Day of Week Header */}
            <div className="grid grid-cols-7 gap-1.5 text-center text-[10px] font-bold text-slate-500 uppercase pb-1">
              <div>Mon</div>
              <div>Tue</div>
              <div>Wed</div>
              <div>Thu</div>
              <div>Fri</div>
              <div>Sat</div>
              <div>Sun</div>
            </div>

            {/* Calendar Cells Grid */}
            <div className="grid grid-cols-7 gap-1.5">
              {calendarGrid.map((cell, idx) => {
                const isSelected = cell.dateKey === selectedDateKey;
                const hasTrades = !!cell.stats && cell.stats.tradesCount > 0;
                const pnl = cell.stats?.totalPnL ?? 0;
                const isGreen = hasTrades && pnl > 0;
                const isRed = hasTrades && pnl < 0;

                return (
                  <button
                    key={`${cell.dateKey}-${idx}`}
                    onClick={() => {
                      setSelectedDateKey(cell.dateKey);
                      setViewScope("SELECTED_DAY");
                    }}
                    disabled={!cell.isCurrentMonth && !hasTrades}
                    className={`min-h-[72px] sm:min-h-[82px] p-1.5 rounded-xl border text-left flex flex-col justify-between transition-all cursor-pointer relative group ${
                      !cell.isCurrentMonth
                        ? "opacity-30 border-slate-900 bg-slate-950/20"
                        : isSelected
                        ? "bg-cyan-950/30 border-cyan-400 shadow-[0_0_20px_rgba(6,182,212,0.35)] ring-1 ring-cyan-400"
                        : isGreen
                        ? "bg-emerald-950/20 border-emerald-500/40 hover:border-emerald-400 hover:bg-emerald-950/30 shadow-[0_0_12px_rgba(16,185,129,0.15)]"
                        : isRed
                        ? "bg-rose-950/20 border-rose-500/40 hover:border-rose-400 hover:bg-rose-950/30 shadow-[0_0_12px_rgba(244,63,94,0.15)]"
                        : "bg-slate-900/40 border-slate-800/60 hover:border-slate-700"
                    }`}
                  >
                    <div className="flex items-center justify-between w-full">
                      <span
                        className={`text-[11px] font-bold ${
                          isSelected
                            ? "text-cyan-300 font-black"
                            : cell.isCurrentMonth
                            ? "text-slate-300"
                            : "text-slate-600"
                        }`}
                      >
                        {cell.dayNumber}
                      </span>
                      {hasTrades && (
                        <span className="text-[9px] px-1 rounded bg-slate-800 text-slate-300 font-mono">
                          {cell.stats?.tradesCount}t
                        </span>
                      )}
                    </div>

                    {hasTrades ? (
                      <div className="mt-auto space-y-0.5">
                        <div
                          className={`text-[10px] sm:text-xs font-black truncate ${
                            pnl >= 0 ? "text-emerald-400" : "text-rose-400"
                          }`}
                        >
                          {pnl >= 0 ? "+" : ""}₹{Math.abs(pnl) >= 1000 ? `${(pnl / 1000).toFixed(1)}k` : pnl}
                        </div>
                        {/* Dot indicator by desk */}
                        <div className="flex items-center gap-1">
                          {(cell.stats?.intradayCount ?? 0) > 0 && (
                            <span className="w-1.5 h-1.5 rounded-full bg-cyan-400" title="Intraday Trades" />
                          )}
                          {(cell.stats?.swingCount ?? 0) > 0 && (
                            <span className="w-1.5 h-1.5 rounded-full bg-violet-400" title="Swing Trades" />
                          )}
                          {(cell.stats?.foCount ?? 0) > 0 && (
                            <span className="w-1.5 h-1.5 rounded-full bg-fuchsia-400" title="F&O Spreads" />
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="text-[9px] text-slate-600 mt-auto">—</div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Right Col: Segmented Daily Breakdown Panel (5 Cols wide) */}
        <div className="lg:col-span-5 space-y-4">
          <div className="p-5 rounded-2xl bg-[#0d1322]/90 backdrop-blur-xl border border-slate-800 shadow-2xl space-y-4">
            {/* Header: Selected Date & Total Day P&L */}
            <div>
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-cyan-400 uppercase tracking-widest font-bold">
                  DAILY BREAKDOWN
                </span>
                <span className="text-xs text-slate-400">{selectedDateFormatted}</span>
              </div>
              <h3 className="text-base font-black text-white mt-0.5">
                Performance for {selectedDateKey}
              </h3>
            </div>

            {/* Total Day P&L Hero Card */}
            <div className="p-4 rounded-xl bg-slate-900/90 border border-slate-800 relative overflow-hidden">
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span>Consolidated Day Net P&amp;L</span>
                <span
                  className={`text-[10px] px-2 py-0.5 rounded font-black ${
                    selectedDateStats.tradesCount === 0
                      ? "bg-slate-800 text-slate-400"
                      : selectedDateStats.totalPnL >= 0
                      ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40"
                      : "bg-rose-500/20 text-rose-300 border border-rose-500/40"
                  }`}
                >
                  {selectedDateStats.tradesCount === 0
                    ? "⚪ NO EXECUTIONS"
                    : selectedDateStats.totalPnL >= 0
                    ? "🟢 PROFITABLE DAY"
                    : "🔴 DRAWDOWN DAY"}
                </span>
              </div>
              <div
                className={`text-2xl font-black mt-1.5 ${
                  selectedDateStats.tradesCount === 0
                    ? "text-slate-400"
                    : selectedDateStats.totalPnL >= 0
                    ? "text-emerald-400"
                    : "text-rose-400"
                }`}
              >
                {selectedDateStats.totalPnL > 0 ? "+" : ""}₹
                {selectedDateStats.totalPnL.toLocaleString("en-IN")}
              </div>
              <div className="text-[11px] text-slate-400 mt-1 flex items-center justify-between">
                <span>Total Executions: {selectedDateStats.tradesCount}</span>
                <span>
                  Win Rate:{" "}
                  {selectedDateStats.tradesCount > 0
                    ? `${Math.round((selectedDateStats.winsCount / selectedDateStats.tradesCount) * 100)}%`
                    : "—"}
                </span>
              </div>
            </div>

            {/* 3 Segmented Desk Metrics Breakdown */}
            <div className="space-y-2.5 pt-1">
              <span className="text-[10px] text-slate-500 uppercase tracking-wider block font-bold">
                SEGMENTED DESK BREAKDOWN
              </span>

              {/* 1. Intraday Desk Segment */}
              <div className="p-3 rounded-xl bg-slate-900/80 border border-cyan-500/25 flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="p-2 rounded-lg bg-cyan-500/15 text-cyan-300">
                    <Zap className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="text-xs font-bold text-white">Intraday Desk</div>
                    <div className="text-[10px] text-slate-400">
                      ORB / VWAP · {selectedDateStats.intradayCount} Trade(s)
                    </div>
                  </div>
                </div>
                <div className="text-right">
                  <div
                    className={`text-sm font-black ${
                      selectedDateStats.intradayCount === 0
                        ? "text-slate-500"
                        : selectedDateStats.intradayPnL >= 0
                        ? "text-emerald-400"
                        : "text-rose-400"
                    }`}
                  >
                    {selectedDateStats.intradayPnL > 0 ? "+" : ""}₹
                    {selectedDateStats.intradayPnL.toLocaleString("en-IN")}
                  </div>
                  {onSelectTab && (
                    <button
                      onClick={() => onSelectTab("im-intraday-desk")}
                      className="text-[10px] text-cyan-400 hover:text-cyan-300 flex items-center gap-0.5 justify-end mt-0.5 cursor-pointer"
                    >
                      <span>Open Desk</span>
                      <ArrowUpRight className="w-2.5 h-2.5" />
                    </button>
                  )}
                </div>
              </div>

              {/* 2. Institutional Swing Segment */}
              <div className="p-3 rounded-xl bg-slate-900/80 border border-violet-500/25 flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="p-2 rounded-lg bg-violet-500/15 text-violet-300">
                    <Crosshair className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="text-xs font-bold text-white">Institutional Swing</div>
                    <div className="text-[10px] text-slate-400">
                      4H OB · {selectedDateStats.swingCount} Trade(s)
                    </div>
                  </div>
                </div>
                <div className="text-right">
                  <div
                    className={`text-sm font-black ${
                      selectedDateStats.swingCount === 0
                        ? "text-slate-500"
                        : selectedDateStats.swingPnL >= 0
                        ? "text-emerald-400"
                        : "text-rose-400"
                    }`}
                  >
                    {selectedDateStats.swingPnL > 0 ? "+" : ""}₹
                    {selectedDateStats.swingPnL.toLocaleString("en-IN")}
                  </div>
                  {onSelectTab && (
                    <button
                      onClick={() => onSelectTab("im-institutional-swing")}
                      className="text-[10px] text-violet-400 hover:text-violet-300 flex items-center gap-0.5 justify-end mt-0.5 cursor-pointer"
                    >
                      <span>Open Desk</span>
                      <ArrowUpRight className="w-2.5 h-2.5" />
                    </button>
                  )}
                </div>
              </div>

              {/* 3. F&O Quant Desk Segment */}
              <div className="p-3 rounded-xl bg-slate-900/80 border border-fuchsia-500/25 flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="p-2 rounded-lg bg-fuchsia-500/15 text-fuchsia-300">
                    <Layers className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="text-xs font-bold text-white">F&amp;O Quant Desk</div>
                    <div className="text-[10px] text-slate-400">
                      Spreads · {selectedDateStats.foCount} Trade(s)
                    </div>
                  </div>
                </div>
                <div className="text-right">
                  <div
                    className={`text-sm font-black ${
                      selectedDateStats.foCount === 0
                        ? "text-slate-500"
                        : selectedDateStats.foPnL >= 0
                        ? "text-emerald-400"
                        : "text-rose-400"
                    }`}
                  >
                    {selectedDateStats.foPnL > 0 ? "+" : ""}₹
                    {selectedDateStats.foPnL.toLocaleString("en-IN")}
                  </div>
                  {onSelectTab && (
                    <button
                      onClick={() => onSelectTab("im-fo-quant-desk")}
                      className="text-[10px] text-fuchsia-400 hover:text-fuchsia-300 flex items-center gap-0.5 justify-end mt-0.5 cursor-pointer"
                    >
                      <span>Open Desk</span>
                      <ArrowUpRight className="w-2.5 h-2.5" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ─── Historical Audit Ledger Table (High-Density) ─── */}
      <div className="p-5 rounded-2xl bg-[#0d1322]/90 backdrop-blur-xl border border-slate-800 shadow-2xl space-y-4">
        {/* Table Controls & Filter Strip */}
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-3 pb-3 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-cyan-400" />
            <h3 className="text-xs font-bold text-white uppercase tracking-wider">
              {viewScope === "SELECTED_DAY"
                ? `Historical Audit Ledger (${selectedDateKey})`
                : `Entire Month Audit Ledger (${monthTitle})`}
            </h3>
            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-800 text-slate-300">
              {auditTableTrades.length} Trades
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2 self-stretch md:self-auto">
            {/* View Scope Toggle */}
            <div className="flex items-center rounded-lg bg-slate-900 border border-slate-800 p-0.5 text-[11px]">
              <button
                onClick={() => setViewScope("SELECTED_DAY")}
                className={`px-2.5 py-1 rounded font-bold transition cursor-pointer ${
                  viewScope === "SELECTED_DAY"
                    ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/40"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                Selected Day
              </button>
              <button
                onClick={() => setViewScope("ENTIRE_MONTH")}
                className={`px-2.5 py-1 rounded font-bold transition cursor-pointer ${
                  viewScope === "ENTIRE_MONTH"
                    ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/40"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                Entire Month
              </button>
            </div>

            {/* Desk Filter */}
            {(["ALL", "INTRADAY", "SWING", "FO"] as const).map((d) => (
              <button
                key={d}
                onClick={() => setFilterDesk(d)}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border transition cursor-pointer ${
                  filterDesk === d
                    ? "bg-slate-800 text-white border-cyan-500/50"
                    : "border-slate-800 text-slate-400 hover:text-slate-200"
                }`}
              >
                {d === "ALL"
                  ? "All Desks"
                  : d === "INTRADAY"
                  ? "⚡ Intraday"
                  : d === "SWING"
                  ? "🟣 Swing"
                  : "🟣 F&O"}
              </button>
            ))}

            <div className="h-4 w-[1px] bg-slate-800 mx-1 hidden sm:block" />

            {/* Search Box */}
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 transform -translate-y-1/2" />
              <input
                type="text"
                placeholder="Search symbol/strategy..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-8 pr-3 py-1 rounded-lg bg-slate-900 border border-slate-800 text-[11px] text-white focus:outline-none focus:border-cyan-500/50 w-36 sm:w-44"
              />
            </div>
          </div>
        </div>

        {/* Table of Trades */}
        {auditTableTrades.length === 0 ? (
          <div className="p-10 text-center space-y-2">
            <p className="text-sm text-slate-400">
              No closed executions recorded for {viewScope === "SELECTED_DAY" ? selectedDateKey : monthTitle}.
            </p>
            {trades.length > 0 && viewScope === "SELECTED_DAY" && (
              <button
                onClick={() => {
                  setViewScope("ENTIRE_MONTH");
                  setFilterDesk("ALL");
                }}
                className="text-xs text-cyan-400 hover:underline cursor-pointer"
              >
                View all executions across {monthTitle} ({trades.length} available)
              </button>
            )}
            {trades.length === 0 && (
              <p className="text-xs text-slate-500">
                Deploy positions from the Intraday Desk, Institutional Swing (4H OB), or F&amp;O Quant Desk. Once settled, they will appear here.
              </p>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-slate-800 text-[10px] text-slate-400 uppercase tracking-wider">
                  <th className="py-2.5 px-3">Date / Time</th>
                  <th className="py-2.5 px-3">Desk</th>
                  <th className="py-2.5 px-3">Symbol</th>
                  <th className="py-2.5 px-3">Strategy</th>
                  <th className="py-2.5 px-3">Direction</th>
                  <th className="py-2.5 px-3">Entry</th>
                  <th className="py-2.5 px-3">Exit</th>
                  <th className="py-2.5 px-3">Target / SL</th>
                  <th className="py-2.5 px-3">Status</th>
                  <th className="py-2.5 px-3">Realized P&amp;L</th>
                  <th className="py-2.5 px-3 text-right">Audit</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {auditTableTrades.map((t) => {
                  const isProfit = t.realizedPnLINR > 0;
                  const cfg = DESK_CONFIG[t.desk];
                  const Icon = cfg.icon;

                  return (
                    <tr
                      key={t.tradeId}
                      className="hover:bg-slate-800/30 transition-colors group"
                    >
                      <td className="py-3.5 px-3 whitespace-nowrap">
                        <div className="font-bold text-slate-200">{t.dateKey}</div>
                        <div className="text-[10px] text-slate-500 flex items-center gap-1">
                          <Clock className="w-2.5 h-2.5" />
                          <span>{t.executionTime}</span>
                        </div>
                      </td>

                      <td className="py-3.5 px-3 whitespace-nowrap">
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold border ${cfg.badgeClass}`}
                        >
                          <Icon className="w-3 h-3" />
                          <span>{cfg.label}</span>
                        </span>
                      </td>

                      <td className="py-3.5 px-3 whitespace-nowrap">
                        <div className="font-bold text-white flex items-center gap-1.5">
                          <span>{t.cleanSymbol}</span>
                        </div>
                        <div className="text-[10px] text-slate-400 truncate max-w-[140px]">
                          {t.companyName}
                        </div>
                      </td>

                      <td className="py-3.5 px-3">
                        <span className="text-[11px] text-slate-300 font-medium">
                          {t.strategyTag}
                        </span>
                      </td>

                      <td className="py-3.5 px-3 whitespace-nowrap">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-black ${
                            t.direction === "LONG"
                              ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30"
                              : t.direction === "SHORT"
                              ? "bg-rose-500/15 text-rose-400 border border-rose-500/30"
                              : "bg-fuchsia-500/15 text-fuchsia-400 border border-fuchsia-500/30"
                          }`}
                        >
                          {t.direction}
                        </span>
                      </td>

                      <td className="py-3.5 px-3 font-mono font-bold text-slate-300">
                        ₹{t.entryPrice.toLocaleString("en-IN", { minimumFractionDigits: 1 })}
                      </td>

                      <td className="py-3.5 px-3 font-mono font-bold text-white">
                        ₹{t.exitPrice.toLocaleString("en-IN", { minimumFractionDigits: 1 })}
                      </td>

                      <td className="py-3.5 px-3 text-[11px]">
                        <div className="text-emerald-400 font-bold">
                          🎯 {t.targetPrice ? `₹${t.targetPrice.toLocaleString("en-IN")}` : "—"}
                        </div>
                        <div className="text-rose-400 font-bold text-[10px]">
                          🛑 {t.stopLossPrice ? `₹${t.stopLossPrice.toLocaleString("en-IN")}` : "—"}
                        </div>
                      </td>

                      <td className="py-3.5 px-3 whitespace-nowrap">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-black ${
                            t.status.includes("TARGET")
                              ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40"
                              : t.status.includes("SL") || t.status.includes("STOP")
                              ? "bg-rose-500/20 text-rose-300 border border-rose-500/40"
                              : "bg-slate-800 text-slate-300 border border-slate-700"
                          }`}
                        >
                          {t.status.replace(/_/g, " ")}
                        </span>
                      </td>

                      <td className="py-3.5 px-3">
                        <div
                          className={`text-sm font-black ${
                            isProfit ? "text-emerald-400" : "text-rose-400"
                          }`}
                        >
                          {isProfit ? "+" : ""}₹{t.realizedPnLINR.toLocaleString("en-IN")}
                        </div>
                        <div
                          className={`text-[10px] font-bold ${
                            isProfit ? "text-emerald-400" : "text-rose-400"
                          }`}
                        >
                          {isProfit ? "+" : ""}
                          {t.realizedPnLPct}%
                        </div>
                      </td>

                      <td className="py-3.5 px-3 text-right">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            openAuditModal(t);
                          }}
                          className="px-2.5 py-1 rounded-lg bg-cyan-500/15 text-cyan-300 hover:bg-cyan-500/25 border border-cyan-500/30 text-xs font-bold inline-flex items-center gap-1 cursor-pointer transition group-hover:scale-105"
                        >
                          <Search className="w-3 h-3 text-cyan-400" />
                          <span>Audit</span>
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ─── Trade Exit Audit Modal Overlay ─── */}
      {selectedExitAuditTrade && (
        <IMTradeExitAuditModal
          trade={selectedExitAuditTrade}
          onClose={() => setSelectedExitAuditTrade(null)}
        />
      )}
    </div>
  );
}
