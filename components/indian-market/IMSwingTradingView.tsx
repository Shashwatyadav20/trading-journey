"use client";

import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import {
  Layers,
  Crosshair,
  X,
  Briefcase,
  RefreshCw,
  Sparkles,
  Activity,
  History,
  Flame,
  Trash2,
  Lock,
  Edit3,
  BookOpen,
  Zap,
  Shield,
  Search,
  Filter,
} from "lucide-react";
import { evaluateActiveTradeSmartShield } from "../../lib/indian/intradayEngine";
import { useAiNewsReversalWorker } from "../../hooks/useAiNewsReversalWorker";
import IMTradeExitAuditModal, { ClosedTradeExitAuditData } from "./IMTradeExitAuditModal";
import { DEFAULT_CLOSED_TRADE_AUDIT_SEEDS } from "../../lib/indian/backtestSeeds";
import IMLive4HOrderBlockRetestTicker from "./IMLive4HOrderBlockRetestTicker";
import {
  NSERetestAlert,
  DEFAULT_4H_RETEST_ALERTS,
  DEFAULT_NSE_SMC_SYMBOLS,
  evaluateSingleStock4HRetest,
} from "../../lib/indian/institutionalSwingEngine";
import {
  STORAGE_KEY_SWING_ACTIVE as STORAGE_KEY_ACTIVE_TRADES,
  STORAGE_KEY_SWING_HISTORY as STORAGE_KEY_BACKTEST_HISTORY,
  appendSettledTradesSync,
  writeActiveTradesSync,
  getISTDateKey,
} from "../../lib/indian/ledgerSync";

const STORAGE_KEY_DAILY_SIGNAL_LOCK = "nse_swing_daily_signal_lock_v3";
const LEGACY_ACTIVE_KEYS: string[] = [];
const LEGACY_HISTORY_KEYS: string[] = [];

function readPersistedTrades<T>(primaryKey: string, legacyKeys: string[]): T[] | null {
  for (const key of [primaryKey, ...legacyKeys]) {
    const raw = localStorage.getItem(key);
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const clean = parsed.filter(
          (t: any) =>
            t &&
            !String(t.tradeId || "").startsWith("AUDIT-") &&
            !String(t.tradeId || "").startsWith("AUTO-")
        );
        if (clean.length > 0) return clean as T[];
      }
    } catch {
      // skip invalid json
    }
  }
  return null;
}

type InstitutionalStrategyCode =
  | "ALL_STRATEGIES"
  | "RANGE_SUPPORT_BUY"
  | "TRENDLINE_5D_RANGE_DOJI"
  | "RESISTANCE_DOJI_SQUEEZE"
  | "VCP_POCKET_PIVOT";

const STRATEGY_METADATA: Record<
  Exclude<InstitutionalStrategyCode, "ALL_STRATEGIES">,
  { title: string; shortBadge: string; winProbBase: number; logicDesc: string; colorClass: string }
> = {
  RANGE_SUPPORT_BUY: {
    title: "Purple Box Trapped Range (Uptrend or Downtrend): Bull OB / VAL Support Buy → VAH Target",
    shortBadge: "🟣 Purple Box Range (VAL → VAH)",
    winProbBase: 91,
    logicDesc:
      "Works in both uptrend & downtrend! Detects stocks trapped for 1–2 months inside a horizontal Purple Box (3+ Support touches at Bull OB/VAL & 2+ Resistance touches at Bear OB/VAH, oscillating around POC). Buys at Support Floor or Box Breakout.",
    colorClass: "bg-fuchsia-500/20 text-fuchsia-300 border-fuchsia-500/50",
  },
  TRENDLINE_5D_RANGE_DOJI: {
    title: "Support/Trendline Break → 5-6D Upstairs Tight Box → Doji → +7% Breakout",
    shortBadge: "🎯 Trendline + 5-6D Doji",
    winProbBase: 92,
    logicDesc:
      "Bounces >= +3.5% off support, breaks falling trendline, consolidates upstairs for 5–6 days in a tight <= 5.5% box with Doji candle(s), then breaks out for +7% target.",
    colorClass: "bg-emerald-500/20 text-emerald-300 border-emerald-500/50",
  },
  RESISTANCE_DOJI_SQUEEZE: {
    title: "Big Resistance Breakout: 1-2W Heavy Volume + Doji Squeeze",
    shortBadge: "🚨 Resistance Doji Squeeze",
    winProbBase: 88,
    logicDesc:
      "Heavy institutional volume accumulation right below multi-week resistance followed by a tight Doji pause before breakout.",
    colorClass: "bg-orange-500/20 text-orange-300 border-orange-500/50",
  },
  VCP_POCKET_PIVOT: {
    title: "VCP Tight Contraction + Pocket Pivot Volume Expansion",
    shortBadge: "🔥 VCP + Pocket Pivot",
    winProbBase: 86,
    logicDesc:
      "Volatility contracts progressively above 20 & 50 EMA followed by institutional pocket pivot volume.",
    colorClass: "bg-amber-500/20 text-amber-300 border-amber-500/50",
  },
};

function getTodayDateKey(): string {
  const now = new Date();
  const istOffsetMs = 5.5 * 60 * 60 * 1000;
  return new Date(now.getTime() + istOffsetMs).toISOString().slice(0, 10);
}

interface NormalizedRealStock {
  id: string;
  symbol: string;
  cleanSymbol: string;
  companyName: string;
  sector: string;
  lockedDateKey: string;
  currentPrice: number;
  changePercent: number;
  breakoutLevel: number;
  entryPrice: number;
  stopLossPrice: number;
  target1Price: number;
  rewardRiskRatio: number;
  confluenceScore: number;
  volumeMultiplier: number;
  primaryQuantStrategy: Exclude<InstitutionalStrategyCode, "ALL_STRATEGIES">;
  matchedQuantStrategies: Exclude<InstitutionalStrategyCode, "ALL_STRATEGIES">[];
  supportBounceInfo: string;
  fiveDayBoxInfo: string;
  dojiCandleInfo: string;
  realRationale: string[];
}

interface ActivePortfolioTrade {
  tradeId: string;
  symbol: string;
  cleanSymbol: string;
  companyName: string;
  strategyUsed: string;
  lockedDateKey: string;
  confluenceScore: number;
  volumeMultiplier: number;
  supportBounceInfo: string;
  fiveDayBoxInfo: string;
  dojiCandleInfo: string;
  rationale: string;
  breakoutLevel: number;
  entryPrice: number;
  stopLossPrice: number;
  targetPrice: number;
  rewardRiskRatio: number;
  allocatedCapital: number;
  quantity: number;
  executionTime: string;
  exitTime?: string;
  exitPrice?: number;
  status:
    | "ACTIVE"
    | "TARGET_HIT"
    | "STOP_LOSS_HIT"
    | "TSL_HIT"
    | "REVERSAL_EXIT"
    | "NEWS_TRIGGER_EXIT"
    | "MANUAL_EMERGENCY_EXIT"
    | "TSL_COST_BREAKEVEN_EXIT";
  currentMarketPrice: number;
  currentSimulatedPrice?: number;
  peakSimulatedPrice?: number;
  pnlAmount: number;
  pnlPercent: number;
  targetProgressPct?: number;
  isTslCostLocked?: boolean;
  liveSentimentBadge?: string;
  lastLtpSyncAt?: string;
  isLiveTick?: boolean;
  mtfSnapshot?: {
    tf4hConfirmed?: boolean;
    tf15mVwap?: number;
    priceVsVwapPct?: number;
    grade?: string;
    orderBlockQuality?: string;
    confidenceTag?: string;
  };
}

export default function IMSwingTradingView() {
  const [stocks, setStocks] = useState<NormalizedRealStock[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [dataSourceStatus, setDataSourceStatus] = useState<string>("Scanning Purple Box Ranges & 5-6D Doji Breakouts...");
  const [mainTab, setMainTab] = useState<"PORTFOLIO" | "SCREENER" | "BACKTEST_HISTORY" | "STRATEGY_GUIDE">("SCREENER");

  const [autoExecuteEnabled, setAutoExecuteEnabled] = useState<boolean>(false);
  const [autoTrades, setAutoTrades] = useState<ActivePortfolioTrade[]>([]);
  const [backtestHistory, setBacktestHistory] = useState<ActivePortfolioTrade[]>([]);
  const [backtestFilter, setBacktestFilter] = useState<"ALL" | "TARGET" | "SL" | "SHIELD">("ALL");
  const [selectedExitAuditTrade, setSelectedExitAuditTrade] = useState<ClosedTradeExitAuditData | null>(null);

  const filteredBacktestHistory = useMemo(() => {
    return backtestHistory.filter((tr) => {
      if (backtestFilter === "ALL") return true;
      const status = String(tr.status || "");
      if (backtestFilter === "TARGET") return status.includes("TARGET");
      if (backtestFilter === "SL") return status.includes("STOP_LOSS") || status.includes("TSL") || status.includes("SL");
      if (backtestFilter === "SHIELD") return status.includes("NEWS") || status.includes("REVERSAL") || status.includes("EMERGENCY");
      return true;
    });
  }, [backtestHistory, backtestFilter]);
  const [isStorageHydrated, setIsStorageHydrated] = useState<boolean>(false);
  const [portfolioNotice, setPortfolioNotice] = useState<string | null>(null);
  const [selectedTradeModal, setSelectedTradeModal] = useState<ActivePortfolioTrade | null>(null);
  const [liveQuotesMap, setLiveQuotesMap] = useState<Record<string, number>>({});
  const [lastLtpSyncTime, setLastLtpSyncTime] = useState<string | null>(null);
  const [retestAlerts, setRetestAlerts] = useState<NSERetestAlert[]>(DEFAULT_4H_RETEST_ALERTS);

  const autoTradesRef = useRef<ActivePortfolioTrade[]>([]);
  useEffect(() => {
    autoTradesRef.current = autoTrades;
  }, [autoTrades]);

  const [strategyFilter, setStrategyFilter] = useState<InstitutionalStrategyCode>("ALL_STRATEGIES");
  const [searchFilter, setSearchFilter] = useState<string>("");

  const [editEntry, setEditEntry] = useState<string>("");
  const [editSL, setEditSL] = useState<string>("");
  const [editTP, setEditTP] = useState<string>("");
  const [unlockOverride, setUnlockOverride] = useState<boolean>(false);

  useEffect(() => {
    try {
      const parsedActive = readPersistedTrades<ActivePortfolioTrade>(STORAGE_KEY_ACTIVE_TRADES, LEGACY_ACTIVE_KEYS);
      if (parsedActive) {
        const sanitized = parsedActive
          .filter((t) => t && typeof t.tradeId === "string" && Number(t.entryPrice) > 0)
          .map((t) => {
            const cleanSym = String(t.cleanSymbol || t.symbol || "")
              .toUpperCase()
              .replace(/\.NS$/i, "")
              .replace(/\.BO$/i, "");
            const entry = Number(t.entryPrice);
            const liveLtp = Number(t.currentMarketPrice ?? t.currentSimulatedPrice ?? entry);
            const qty = Number(t.quantity || Math.floor(300000 / entry));
            return {
              ...t,
              cleanSymbol: cleanSym,
              currentMarketPrice: liveLtp,
              currentSimulatedPrice: liveLtp,
              quantity: qty,
              pnlAmount: Math.round((liveLtp - entry) * qty),
              pnlPercent: Number((((liveLtp - entry) / entry) * 100).toFixed(2)),
              status: "ACTIVE" as const,
            };
          });
        setAutoTrades(sanitized);
        autoTradesRef.current = sanitized;
      }
      const parsedH = readPersistedTrades<ActivePortfolioTrade>(STORAGE_KEY_BACKTEST_HISTORY, LEGACY_HISTORY_KEYS);
      if (parsedH && parsedH.length > 0) {
        setBacktestHistory(parsedH.filter((t: any) => t && t.userExecuted === true));
      } else {
        setBacktestHistory([]);
      }
    } catch { } finally {
      setIsStorageHydrated(true);
    }
  }, []);

  useEffect(() => {
    if (!isStorageHydrated) return;
    localStorage.setItem(STORAGE_KEY_ACTIVE_TRADES, JSON.stringify(autoTrades));
  }, [autoTrades, isStorageHydrated]);

  useEffect(() => {
    if (!isStorageHydrated) return;
    localStorage.setItem(STORAGE_KEY_BACKTEST_HISTORY, JSON.stringify(backtestHistory));
  }, [backtestHistory, isStorageHydrated]);

  useEffect(() => {
    if (selectedTradeModal) {
      setEditEntry(String(selectedTradeModal.entryPrice));
      setEditSL(String(selectedTradeModal.stopLossPrice));
      setEditTP(String(selectedTradeModal.targetPrice));
      setUnlockOverride(false);
    }
  }, [selectedTradeModal?.tradeId]);

  const parseRealStockItem = (
    raw: any,
    idx: number,
    dailyLocks: Record<string, { dateKey: string; entry: number; sl: number; tp: number; breakout: number }>
  ): NormalizedRealStock | null => {
    if (!raw) return null;
    const cleanSymbol = String(raw.cleanSymbol || raw.symbol || "")
      .replace(/\.NS$/i, "")
      .replace(/\.BO$/i, "")
      .toUpperCase();
    if (!cleanSymbol) return null;

    const liveLtp = Number(raw.currentPrice ?? raw.price ?? 0);
    if (!liveLtp || liveLtp <= 0) return null;

    const pat = raw.patternDetails || {};
    const todayKey = getTodayDateKey();
    const existingLock = dailyLocks[cleanSymbol];

    let lockedEntry = Number(raw.entryPrice ?? liveLtp);
    let lockedSL = Number(raw.stopLossPrice ?? Number((lockedEntry * 0.968).toFixed(2)));
    let lockedTP = Number(raw.target1Price ?? Number((lockedEntry * 1.07).toFixed(2)));
    let lockedBreakout = Number(raw.breakoutLevel ?? pat.boxHigh ?? lockedEntry);

    if (existingLock && existingLock.dateKey === todayKey) {
      lockedEntry = existingLock.entry;
      lockedSL = existingLock.sl;
      lockedTP = existingLock.tp;
      lockedBreakout = existingLock.breakout;
    } else {
      dailyLocks[cleanSymbol] = {
        dateKey: todayKey,
        entry: lockedEntry,
        sl: lockedSL,
        tp: lockedTP,
        breakout: lockedBreakout,
      };
    }

    const risk = Math.max(0.5, Math.abs(lockedEntry - lockedSL));
    const rewardRiskRatio = Number(((lockedTP - lockedEntry) / risk).toFixed(2));
    const volumeMultiplier = Number(Number(raw.relativeVolume ?? raw.volumeMultiplier ?? 1.5).toFixed(2));
    const confluenceScore = Number(raw.confluenceScore ?? 86);

    const validCodes: Array<Exclude<InstitutionalStrategyCode, "ALL_STRATEGIES">> = [
      "RANGE_SUPPORT_BUY",
      "TRENDLINE_5D_RANGE_DOJI",
      "RESISTANCE_DOJI_SQUEEZE",
      "VCP_POCKET_PIVOT",
    ];

    const rawPrimary = String(raw.primaryStrategy || "TRENDLINE_5D_RANGE_DOJI") as Exclude<
      InstitutionalStrategyCode,
      "ALL_STRATEGIES"
    >;
    const primary: Exclude<InstitutionalStrategyCode, "ALL_STRATEGIES"> = validCodes.includes(rawPrimary)
      ? rawPrimary
      : "TRENDLINE_5D_RANGE_DOJI";

    const rawMatched: string[] = Array.isArray(raw.matchedStrategies) ? raw.matchedStrategies : [primary];
    const matched = rawMatched.filter((c): c is Exclude<InstitutionalStrategyCode, "ALL_STRATEGIES"> =>
      validCodes.includes(c as any)
    );
    if (matched.length === 0) matched.push(primary);

    const supportLevel = pat.supportZoneLow ?? Number((lockedEntry * 0.92).toFixed(1));
    const rallyPct = pat.rallyFromSupportPct ?? 5.4;
    const boxLow = pat.boxLow ?? Number((lockedEntry * 0.975).toFixed(1));
    const boxWidth = pat.boxRangePct ?? 2.8;
    const dojiCount = pat.dojiCount ?? 1;

    const isPurpleBox = matched.includes("RANGE_SUPPORT_BUY");

    const supportBounceInfo = isPurpleBox
      ? `🟣 Purple Box Trapped Range: VAL Floor ₹${pat.purpleBoxFloorVAL ?? boxLow} | POC ₹${pat.purpleBoxPOC ?? lockedEntry} | VAH Ceiling ₹${pat.purpleBoxCeilingVAH ?? lockedTP}`
      : `Support Bounce from ₹${supportLevel} (+${rallyPct}%) & Falling Trendline Broken`;

    const fiveDayBoxInfo = isPurpleBox
      ? `Box Containment: Tested Support (Bull OB/SSL) ${pat.supportTouches ?? 3}x & Resistance (Bear OB) ${pat.resistanceTouches ?? 2}x (${pat.purpleBoxWidthPct ?? boxWidth}% Box)`
      : `5–6D Tight Box: ₹${boxLow} – ₹${lockedBreakout} (${boxWidth}% Width) · Fixed Breakout: ₹${lockedBreakout}`;

    const dojiCandleInfo = isPurpleBox
      ? pat.purpleBoxMode === "PURPLE_BOX_BREAKOUT"
        ? `🚀 Stepping Out Above Purple Box VAH Ceiling (₹${pat.purpleBoxCeilingVAH}) after 1–2M Consolidation!`
        : `🎯 Bouncing off Bull OB / Support Zone (${pat.positionInBoxPct ?? 20}% height of box) → Target VAH ₹${lockedTP}`
      : `${dojiCount} Doji / Inside-Bar Squeeze Candle(s) inside 5–6D box before +7% breakout`;

    return {
      id: `${cleanSymbol}-${todayKey}`,
      symbol: `${cleanSymbol}.NS`,
      cleanSymbol,
      companyName: raw.companyName || cleanSymbol,
      sector: raw.sector || "NSE Institutional",
      lockedDateKey: todayKey,
      currentPrice: liveLtp,
      changePercent: Number(raw.changePercent ?? 0),
      breakoutLevel: lockedBreakout,
      entryPrice: lockedEntry,
      stopLossPrice: lockedSL,
      target1Price: lockedTP,
      rewardRiskRatio,
      confluenceScore,
      volumeMultiplier,
      primaryQuantStrategy: primary,
      matchedQuantStrategies: matched,
      supportBounceInfo,
      fiveDayBoxInfo,
      dojiCandleInfo,
      realRationale: raw.tradeRationale || [STRATEGY_METADATA[primary].logicDesc],
    };
  };

  // Force-synchronize all active trades with exact live quote snapshot LTP
  const synchronizeActiveTradesWithLiveLtp = useCallback(
    (incomingPrices: Map<string, number>, currentStocks: NormalizedRealStock[]) => {
      const currentActive = autoTradesRef.current;
      if (currentActive.length === 0 && (!autoExecuteEnabled || currentStocks.length === 0)) return;

      const syncStamp = new Date().toLocaleTimeString("en-IN", { hour12: false });
      const updatedActive: ActivePortfolioTrade[] = [];
      const newlyCompleted: ActivePortfolioTrade[] = [];
      const newlyAutoEntered: ActivePortfolioTrade[] = [];

      currentActive.forEach((trade) => {
        const cleanSym = String(trade.cleanSymbol || trade.symbol || "")
          .toUpperCase()
          .replace(/\.NS$/i, "")
          .replace(/\.BO$/i, "");
        const tickPrice = incomingPrices.get(cleanSym);
        const hasTick = typeof tickPrice === "number" && Number.isFinite(tickPrice) && tickPrice > 0;
        const liveLtp = hasTick ? Number(tickPrice.toFixed(2)) : Number(trade.currentMarketPrice ?? trade.entryPrice);
        const entry = Number(trade.entryPrice);
        const qty = Number(trade.quantity);
        const peak = Math.max(liveLtp, trade.peakSimulatedPrice ?? entry);
        const diff = (liveLtp - entry) * qty;
        const pct = Number((((liveLtp - entry) / entry) * 100).toFixed(2));

        // Smart Reversal & News Shield + Automated Profit Locking (TSL to Cost at 70% Target Distance)
        const smartShield = evaluateActiveTradeSmartShield({
          symbol: cleanSym,
          direction: "LONG",
          entryPrice: entry,
          stopLossPrice: trade.stopLossPrice,
          targetPrice: trade.targetPrice,
          currentPrice: liveLtp,
          peakPrice: peak,
          quantity: qty,
          isTslCostLocked: trade.isTslCostLocked,
        });

        const effectiveStop = smartShield.updatedStopLossPrice;

        if (smartShield.shouldAutoExit && smartShield.autoExitTag) {
          newlyCompleted.push({
            ...trade,
            cleanSymbol: cleanSym,
            currentMarketPrice: liveLtp,
            currentSimulatedPrice: liveLtp,
            peakSimulatedPrice: peak,
            stopLossPrice: effectiveStop,
            status: smartShield.autoExitTag as ActivePortfolioTrade["status"],
            exitTime: new Date().toLocaleString("en-IN"),
            pnlAmount: Math.round(diff),
            pnlPercent: pct,
            targetProgressPct: smartShield.targetProgressPct,
            isTslCostLocked: smartShield.isTslCostLocked,
            liveSentimentBadge: smartShield.liveSentimentBadge,
            lastLtpSyncAt: syncStamp,
            isLiveTick: true,
          });
        } else if (liveLtp >= trade.targetPrice) {
          const tDiff = (trade.targetPrice - entry) * qty;
          newlyCompleted.push({
            ...trade,
            cleanSymbol: cleanSym,
            currentMarketPrice: trade.targetPrice,
            currentSimulatedPrice: trade.targetPrice,
            peakSimulatedPrice: peak,
            status: "TARGET_HIT",
            exitTime: new Date().toLocaleString("en-IN"),
            pnlAmount: Math.round(tDiff),
            pnlPercent: Number((((trade.targetPrice - entry) / entry) * 100).toFixed(2)),
            lastLtpSyncAt: syncStamp,
            isLiveTick: true,
          });
        } else if (liveLtp <= effectiveStop) {
          const sDiff = (effectiveStop - entry) * qty;
          newlyCompleted.push({
            ...trade,
            cleanSymbol: cleanSym,
            currentMarketPrice: effectiveStop,
            currentSimulatedPrice: effectiveStop,
            peakSimulatedPrice: peak,
            stopLossPrice: effectiveStop,
            status: smartShield.isTslCostLocked ? "TSL_COST_BREAKEVEN_EXIT" : "STOP_LOSS_HIT",
            exitTime: new Date().toLocaleString("en-IN"),
            pnlAmount: Math.round(sDiff),
            pnlPercent: Number((((effectiveStop - entry) / entry) * 100).toFixed(2)),
            lastLtpSyncAt: syncStamp,
            isLiveTick: true,
          });
        } else {
          updatedActive.push({
            ...trade,
            cleanSymbol: cleanSym,
            currentMarketPrice: liveLtp,
            currentSimulatedPrice: liveLtp,
            peakSimulatedPrice: peak,
            stopLossPrice: effectiveStop,
            pnlAmount: Math.round(diff),
            pnlPercent: pct,
            targetProgressPct: smartShield.targetProgressPct,
            isTslCostLocked: smartShield.isTslCostLocked,
            liveSentimentBadge: smartShield.liveSentimentBadge,
            lastLtpSyncAt: hasTick ? syncStamp : trade.lastLtpSyncAt,
            isLiveTick: hasTick,
          });
        }
      });

      if (autoExecuteEnabled) {
        const todayKey = getTodayDateKey();
        currentStocks.forEach((st) => {
          const cleanSym = st.cleanSymbol.toUpperCase();
          const alreadyActive = updatedActive.some(
            (t) => String(t.cleanSymbol || t.symbol || "").replace(/\.NS$/i, "").replace(/\.BO$/i, "").toUpperCase() === cleanSym
          );
          if (alreadyActive) return;

          const executionEntryPrice = Number(st.currentPrice.toFixed(2));
          const qty = Math.floor(300000 / executionEntryPrice);
          if (qty <= 0) return;

          const lockedSL = Number(Math.min(st.stopLossPrice, executionEntryPrice * 0.968).toFixed(2));
          const risk = Math.max(0.5, executionEntryPrice - lockedSL);
          const lockedTP = Number(Math.max(st.target1Price, executionEntryPrice * 1.06).toFixed(2));
          const rr = Number(((lockedTP - executionEntryPrice) / risk).toFixed(2));

          newlyAutoEntered.push({
            tradeId: `AUTO-${cleanSym}-${Date.now()}`,
            symbol: `${cleanSym}.NS`,
            cleanSymbol: cleanSym,
            companyName: st.companyName,
            strategyUsed: STRATEGY_METADATA[st.primaryQuantStrategy].shortBadge,
            lockedDateKey: todayKey,
            confluenceScore: st.confluenceScore,
            volumeMultiplier: st.volumeMultiplier,
            supportBounceInfo: st.supportBounceInfo,
            fiveDayBoxInfo: st.fiveDayBoxInfo,
            dojiCandleInfo: st.dojiCandleInfo,
            rationale: st.realRationale[0],
            breakoutLevel: st.breakoutLevel,
            entryPrice: executionEntryPrice,
            stopLossPrice: lockedSL,
            targetPrice: lockedTP,
            rewardRiskRatio: rr,
            allocatedCapital: Math.round(qty * executionEntryPrice),
            quantity: qty,
            executionTime: new Date().toLocaleString("en-IN"),
            status: "ACTIVE",
            currentMarketPrice: executionEntryPrice,
            currentSimulatedPrice: executionEntryPrice,
            pnlAmount: 0,
            pnlPercent: 0,
            lastLtpSyncAt: syncStamp,
            isLiveTick: true,
          });
        });
      }

      const finalActive = [...newlyAutoEntered, ...updatedActive];
      autoTradesRef.current = finalActive;
      setAutoTrades(finalActive);
      writeActiveTradesSync(STORAGE_KEY_ACTIVE_TRADES, finalActive, "SWING");

      if (selectedTradeModal) {
        const refreshed = finalActive.find((t) => t.tradeId === selectedTradeModal.tradeId);
        if (refreshed) setSelectedTradeModal(refreshed);
      }

      if (newlyCompleted.length > 0) {
        const todayDateKey = getISTDateKey();
        const stampedCompleted = newlyCompleted.map((t) => ({
          ...t,
          exitPrice: t.currentMarketPrice ?? t.entryPrice,
          dateKey: todayDateKey,
        }));
        const finalHist = appendSettledTradesSync(
          STORAGE_KEY_BACKTEST_HISTORY,
          stampedCompleted,
          "SWING"
        );
        setBacktestHistory(finalHist);
        setPortfolioNotice(
          `🎯 Auto-Closed: ${newlyCompleted.map((t) => `${t.cleanSymbol} (${t.status})`).join(", ")} moved to Backtest History!`
        );
      } else if (newlyAutoEntered.length > 0) {
        setPortfolioNotice(
          `🔒 Auto-Entered ₹3L in ${newlyAutoEntered.map((t) => t.cleanSymbol).join(", ")} — Same-Day Locked Entry (Starts at ₹0 P&L)!`
        );
      }
    },
    [autoExecuteEnabled, selectedTradeModal]
  );

  const deploySingleStockTrade = (st: NormalizedRealStock) => {
    const cleanSym = st.cleanSymbol.toUpperCase();
    const alreadyActive = autoTrades.some(
      (t) =>
        (!t.status || t.status === "ACTIVE") &&
        String(t.cleanSymbol || t.symbol || "").replace(/\.NS$/i, "").replace(/\.BO$/i, "").toUpperCase() === cleanSym
    );
    if (alreadyActive) {
      setPortfolioNotice(`ℹ️ ${cleanSym} is already running in Active Trades!`);
      setMainTab("PORTFOLIO");
      return;
    }

    const exactLiveLtp = Number((liveQuotesMap[cleanSym] ?? st.currentPrice).toFixed(2));
    const qty = Math.floor(300000 / exactLiveLtp);
    if (qty <= 0) return;

    const lockedSL = Number(Math.min(st.stopLossPrice, exactLiveLtp * 0.968).toFixed(2));
    const risk = Math.max(0.5, exactLiveLtp - lockedSL);
    const lockedTP = Number(Math.max(st.target1Price, exactLiveLtp * 1.06).toFixed(2));
    const rr = Number(((lockedTP - exactLiveLtp) / risk).toFixed(2));
    const syncStamp = new Date().toLocaleTimeString("en-IN", { hour12: false });

    const newTrade: ActivePortfolioTrade = {
      tradeId: `TRADE-${cleanSym}-${Date.now()}`,
      symbol: `${cleanSym}.NS`,
      cleanSymbol: cleanSym,
      companyName: st.companyName,
      strategyUsed: STRATEGY_METADATA[st.primaryQuantStrategy].shortBadge,
      lockedDateKey: getTodayDateKey(),
      confluenceScore: st.confluenceScore,
      volumeMultiplier: st.volumeMultiplier,
      supportBounceInfo: st.supportBounceInfo,
      fiveDayBoxInfo: st.fiveDayBoxInfo,
      dojiCandleInfo: st.dojiCandleInfo,
      rationale: st.realRationale[0],
      breakoutLevel: st.breakoutLevel,
      entryPrice: exactLiveLtp,
      stopLossPrice: lockedSL,
      targetPrice: lockedTP,
      rewardRiskRatio: rr,
      allocatedCapital: Math.round(qty * exactLiveLtp),
      quantity: qty,
      executionTime: new Date().toLocaleString("en-IN"),
      status: "ACTIVE",
      currentMarketPrice: exactLiveLtp,
      currentSimulatedPrice: exactLiveLtp,
      pnlAmount: 0,
      pnlPercent: 0,
      lastLtpSyncAt: syncStamp,
      isLiveTick: true,
      userExecuted: true,
    } as ActivePortfolioTrade & { userExecuted: boolean };

    const nextActive = [newTrade, ...autoTrades];
    autoTradesRef.current = nextActive;
    setAutoTrades(nextActive);
    localStorage.setItem(STORAGE_KEY_ACTIVE_TRADES, JSON.stringify(nextActive));
    setPortfolioNotice(`⚡ Deployed ${cleanSym} (${qty} Qty) at exact Live LTP ₹${exactLiveLtp} (Initial P&L: ₹0 / 0%)!`);
    setMainTab("PORTFOLIO");
  };

  const handleDeploy4HRetest = (alert: NSERetestAlert) => {
    const cleanSym = alert.cleanSymbol.toUpperCase();
    const alreadyActive = autoTrades.some(
      (t) =>
        (!t.status || t.status === "ACTIVE") &&
        String(t.cleanSymbol || t.symbol || "")
          .replace(/\.NS$/i, "")
          .replace(/\.BO$/i, "")
          .toUpperCase() === cleanSym
    );
    if (alreadyActive) {
      setPortfolioNotice(`ℹ️ ${cleanSym} is already running in Active Trades!`);
      setMainTab("PORTFOLIO");
      return;
    }

    const exactLiveLtp = Number((liveQuotesMap[cleanSym] ?? alert.livePrice).toFixed(2));
    const qty = Math.max(1, Math.floor(300000 / exactLiveLtp));
    const syncStamp = new Date().toLocaleTimeString("en-IN", { hour12: false });

    const newTrade: ActivePortfolioTrade = {
      tradeId: `TRADE-4H-${cleanSym}-${Date.now()}`,
      symbol: `${cleanSym}.NS`,
      cleanSymbol: cleanSym,
      companyName: alert.companyName,
      strategyUsed: `4H OB Retest · ${alert.quality} ${alert.confidenceTag}`,
      lockedDateKey: getTodayDateKey(),
      confluenceScore: 92,
      volumeMultiplier: alert.volumeMultiplier,
      supportBounceInfo: `4H Order Block Retest active at ₹${alert.obMitigationRange.topPrice}`,
      fiveDayBoxInfo: `4H Fixed Range: ₹${alert.obMitigationRange.bottomPrice} – ₹${alert.obMitigationRange.topPrice}`,
      dojiCandleInfo: "SMC PRO+ 4H Invalidation Protected",
      rationale: alert.rationale[0] || `4H Order Block mitigation at ₹${exactLiveLtp}`,
      breakoutLevel: alert.obMitigationRange.topPrice,
      entryPrice: exactLiveLtp,
      stopLossPrice: alert.stopLossPrice,
      targetPrice: alert.targetPrice,
      rewardRiskRatio: alert.rewardRiskRatio,
      allocatedCapital: Math.round(qty * exactLiveLtp),
      quantity: qty,
      executionTime: new Date().toLocaleString("en-IN"),
      status: "ACTIVE",
      currentMarketPrice: exactLiveLtp,
      currentSimulatedPrice: exactLiveLtp,
      pnlAmount: 0,
      pnlPercent: 0,
      lastLtpSyncAt: syncStamp,
      isLiveTick: true,
      mtfSnapshot: {
        tf4hConfirmed: true,
        tf15mVwap: exactLiveLtp,
        priceVsVwapPct: 0.8,
        grade: "SMC_PRO_4H_CONFIRMED",
        orderBlockQuality: alert.quality,
        confidenceTag: alert.confidenceTag,
      },
      userExecuted: true,
    } as ActivePortfolioTrade & { userExecuted: boolean };

    const updated = [newTrade, ...autoTrades];
    autoTradesRef.current = updated;
    setAutoTrades(updated);
    localStorage.setItem(STORAGE_KEY_ACTIVE_TRADES, JSON.stringify(updated));

    // Remove deployed alert from active feed
    setRetestAlerts((prev) => prev.filter((a) => a.cleanSymbol !== cleanSym));

    setPortfolioNotice(
      `⚡ Deployed 4H OB Retest in ${cleanSym} (${qty} Shares) at exact Live LTP ₹${exactLiveLtp} (Initial P&L: ₹0 / 0%). Target: ₹${alert.targetPrice} (1:${alert.rewardRiskRatio} RR)!`
    );
    setMainTab("PORTFOLIO");
  };

  const fetchLiveApiData = async (forceRefresh = false) => {
    setIsLoading(true);
    try {
      let dailyLocks: Record<string, { dateKey: string; entry: number; sl: number; tp: number; breakout: number }> = {};
      try {
        const rawLocks = localStorage.getItem(STORAGE_KEY_DAILY_SIGNAL_LOCK);
        if (rawLocks) dailyLocks = JSON.parse(rawLocks);
      } catch { }

      // Read active symbols from ref or localStorage so scanner:
      // 1. Always quotes their live LTP in `livePrices`
      // 2. Excludes them from `opportunities` while `status === "ACTIVE"`
      let activeSource = autoTradesRef.current;
      if (activeSource.length === 0 && typeof window !== "undefined") {
        const persisted = readPersistedTrades<ActivePortfolioTrade>(STORAGE_KEY_ACTIVE_TRADES, LEGACY_ACTIVE_KEYS);
        if (persisted) activeSource = persisted;
      }
      const smcMonitoredSymbols = DEFAULT_NSE_SMC_SYMBOLS.map((s) => s.symbol);
      const activeSymbols = Array.from(
        new Set([
          ...activeSource
            .filter((t) => !t.status || t.status === "ACTIVE")
            .map((t) => String(t.cleanSymbol || t.symbol || "").toUpperCase().replace(/\.NS$/i, "").replace(/\.BO$/i, ""))
            .filter(Boolean),
          ...smcMonitoredSymbols,
        ])
      );
      const activeParam =
        activeSymbols.length > 0
          ? `&activeSymbols=${encodeURIComponent(activeSymbols.join(","))}&excludeActive=true`
          : "";

      const incomingPrices = new Map<string, number>();
      const map = new Map<string, NormalizedRealStock>();
      const res = await fetch(
        `/api/indian/swing/daily-scanner?universe=ALL_LIQUID&strategy=ALL${activeParam}&_t=${Date.now()}${forceRefresh ? "&forceRefresh=true" : ""}`,
        { cache: "no-store" }
      );
      if (res.ok) {
        const json = await res.json();

        // 1. Ingest exact livePrices snapshot dictionary
        if (json.livePrices && typeof json.livePrices === "object") {
          Object.entries(json.livePrices).forEach(([sym, obj]: [string, any]) => {
            const clean = sym.toUpperCase().replace(/\.NS$/i, "").replace(/\.BO$/i, "");
            const price = Number(obj?.ltp ?? obj);
            if (Number.isFinite(price) && price > 0) {
              incomingPrices.set(clean, Number(price.toFixed(2)));
            }
          });
        }

        // 2. Ingest opportunities & force-match `currentPrice` with exact snapshot `ltp`
        if (json.success && Array.isArray(json.opportunities)) {
          json.opportunities.forEach((item: any, i: number) => {
            const parsed = parseRealStockItem(item, i, dailyLocks);
            if (parsed) {
              const exactSnapLtp = incomingPrices.get(parsed.cleanSymbol);
              if (typeof exactSnapLtp === "number" && exactSnapLtp > 0) {
                parsed.currentPrice = exactSnapLtp;
              } else {
                incomingPrices.set(parsed.cleanSymbol, parsed.currentPrice);
              }
              map.set(parsed.cleanSymbol, parsed);
            }
          });
        }
      }

      try {
        localStorage.setItem(STORAGE_KEY_DAILY_SIGNAL_LOCK, JSON.stringify(dailyLocks));
      } catch { }

      const list = Array.from(map.values()).sort(
        (a, b) => b.confluenceScore + b.volumeMultiplier * 5 - (a.confluenceScore + a.volumeMultiplier * 5)
      );
      setStocks(list);
      setDataSourceStatus(`Live NSE Feed (${list.length} Verified Setups)`);

      if (incomingPrices.size > 0) {
        const plainObj: Record<string, number> = {};
        incomingPrices.forEach((v, k) => {
          plainObj[k] = v;
        });
        setLiveQuotesMap((prev) => ({ ...prev, ...plainObj }));
        setLastLtpSyncTime(new Date().toLocaleTimeString("en-IN", { hour12: false }));

        // Re-evaluate 4H Order Block Retests across monitored symbols
        const evaluatedAlerts: NSERetestAlert[] = [];
        const activeSymSet = new Set(
          autoTradesRef.current
            .filter((t) => !t.status || t.status === "ACTIVE")
            .map((t) => String(t.cleanSymbol || t.symbol || "").toUpperCase().replace(/\.NS$/i, "").replace(/\.BO$/i, ""))
        );

        for (const item of DEFAULT_NSE_SMC_SYMBOLS) {
          if (activeSymSet.has(item.symbol)) continue;
          const currentPrice = plainObj[item.symbol] ?? liveQuotesMap[item.symbol] ?? item.fallbackLtp;
          const alert = evaluateSingleStock4HRetest({
            symbol: item.symbol,
            companyName: item.companyName,
            sector: item.sector,
            livePrice: currentPrice,
          });
          if (alert) {
            evaluatedAlerts.push(alert);
          }
        }

        if (evaluatedAlerts.length > 0) {
          setRetestAlerts(evaluatedAlerts);
        }
      }

      // Immediately synchronize all active trades with exact live LTP
      synchronizeActiveTradesWithLiveLtp(incomingPrices, list);
    } catch { } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchLiveApiData(false);
    const timer = setInterval(() => fetchLiveApiData(false), 15000);
    return () => clearInterval(timer);
  }, []);

  const handleSaveAdjustedLevels = () => {
    if (!selectedTradeModal) return;
    const newEntry = Number(editEntry);
    const newSL = Number(editSL);
    const newTP = Number(editTP);

    if (!newEntry || !newSL || !newTP || newSL >= newTP) {
      alert("Please enter valid Entry, Stop-Loss, and Target prices (SL must be below Target).");
      return;
    }

    const updatedList = autoTrades.map((t) => {
      if (t.tradeId !== selectedTradeModal.tradeId) return t;
      const qty = Math.floor(300000 / newEntry);
      const liveLtp = t.currentMarketPrice;
      const pnlAmt = Math.round((liveLtp - newEntry) * qty);
      const pnlPct = Number((((liveLtp - newEntry) / newEntry) * 100).toFixed(2));
      const risk = Math.max(0.5, Math.abs(newEntry - newSL));
      const rr = Number(((newTP - newEntry) / risk).toFixed(2));

      const updatedTrade: ActivePortfolioTrade = {
        ...t,
        entryPrice: Number(newEntry.toFixed(2)),
        stopLossPrice: Number(newSL.toFixed(2)),
        targetPrice: Number(newTP.toFixed(2)),
        rewardRiskRatio: rr,
        quantity: qty,
        allocatedCapital: Math.round(qty * newEntry),
        pnlAmount: pnlAmt,
        pnlPercent: pnlPct,
      };
      setSelectedTradeModal(updatedTrade);
      return updatedTrade;
    });

    setAutoTrades(updatedList);
    localStorage.setItem(STORAGE_KEY_ACTIVE_TRADES, JSON.stringify(updatedList));
    setPortfolioNotice(
      `✅ Updated SL/Target for ${selectedTradeModal.cleanSymbol} (Reference Level ₹${selectedTradeModal.breakoutLevel} kept fixed!)`
    );
  };

  const resolveTradeOutcome = (tradeId: string, outcome: "TARGET" | "STOPLOSS", e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    const targetTrade = autoTrades.find((t) => t.tradeId === tradeId);
    if (!targetTrade) return;

    const finalPrice = outcome === "TARGET" ? targetTrade.targetPrice : targetTrade.stopLossPrice;
    const diff = (finalPrice - targetTrade.entryPrice) * targetTrade.quantity;
    const pct = Number((((finalPrice - targetTrade.entryPrice) / targetTrade.entryPrice) * 100).toFixed(2));

    const resolved: ActivePortfolioTrade & { exitPrice?: number; dateKey?: string } = {
      ...targetTrade,
      currentMarketPrice: finalPrice,
      exitPrice: finalPrice,
      dateKey: getISTDateKey(),
      status: outcome === "TARGET" ? "TARGET_HIT" : "STOP_LOSS_HIT",
      exitTime: new Date().toLocaleString("en-IN"),
      pnlAmount: Math.round(diff),
      pnlPercent: pct,
    };

    const rem = autoTrades.filter((t) => t.tradeId !== tradeId);
    autoTradesRef.current = rem;
    setAutoTrades(rem);
    writeActiveTradesSync(STORAGE_KEY_ACTIVE_TRADES, rem, "SWING");
    const hist = appendSettledTradesSync(
      STORAGE_KEY_BACKTEST_HISTORY,
      [resolved],
      "SWING"
    );
    setBacktestHistory(hist);
    if (selectedTradeModal?.tradeId === tradeId) setSelectedTradeModal(null);
  };

  // Manual Override & Emergency Square-Off Now at exact Live LTP
  const handleEmergencySquareOffNow = (tradeId: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    const targetTrade = autoTrades.find((t) => t.tradeId === tradeId);
    if (!targetTrade) return;

    const cleanSym = String(targetTrade.cleanSymbol || targetTrade.symbol || "")
      .toUpperCase()
      .replace(/\.NS$/i, "")
      .replace(/\.BO$/i, "");
    const exactLiveLtp = Number((liveQuotesMap[cleanSym] ?? targetTrade.currentMarketPrice ?? targetTrade.entryPrice).toFixed(2));
    const diff = (exactLiveLtp - targetTrade.entryPrice) * targetTrade.quantity;
    const pct = Number((((exactLiveLtp - targetTrade.entryPrice) / targetTrade.entryPrice) * 100).toFixed(2));

    const squaredOff: ActivePortfolioTrade & { exitPrice?: number; dateKey?: string } = {
      ...targetTrade,
      cleanSymbol: cleanSym,
      currentMarketPrice: exactLiveLtp,
      currentSimulatedPrice: exactLiveLtp,
      exitPrice: exactLiveLtp,
      dateKey: getISTDateKey(),
      status: "MANUAL_EMERGENCY_EXIT",
      exitTime: new Date().toLocaleString("en-IN"),
      pnlAmount: Math.round(diff),
      pnlPercent: pct,
    };

    const rem = autoTrades.filter((t) => t.tradeId !== tradeId);
    autoTradesRef.current = rem;
    setAutoTrades(rem);
    writeActiveTradesSync(STORAGE_KEY_ACTIVE_TRADES, rem, "SWING");
    const hist = appendSettledTradesSync(
      STORAGE_KEY_BACKTEST_HISTORY,
      [squaredOff],
      "SWING"
    );
    setBacktestHistory(hist);
    if (selectedTradeModal?.tradeId === tradeId) setSelectedTradeModal(null);
    setPortfolioNotice(
      `⚡ Emergency Exit Complete: ${cleanSym} squared off at Live LTP ₹${exactLiveLtp} (${diff >= 0 ? "+" : ""}₹${Math.round(diff).toLocaleString("en-IN")} / ${pct >= 0 ? "+" : ""}${pct}%), archived to Backtest History & capital freed!`
    );
  };

  // AI News & Reversal Reader Background Worker Hook
  const {
    aiShieldReports,
    isScanningNews,
    lastNewsScanIst,
    runNewsScan,
  } = useAiNewsReversalWorker({
    activeTrades: autoTrades,
    pollIntervalMs: 45_000,
    enabled: true,
    onAutoExitTriggered: (report) => {
      const exitStamp = new Date().toLocaleString("en-IN");
      setAutoTrades((prev) => {
        const targetTrade = prev.find((t) => {
          const sym = String(t.cleanSymbol || t.symbol || "").toUpperCase().replace(/\.NS$/i, "").replace(/\.BO$/i, "");
          return sym === report.symbol;
        });
        if (!targetTrade) return prev;

        const cleanSym = String(targetTrade.cleanSymbol || targetTrade.symbol || "").toUpperCase().replace(/\.NS$/i, "").replace(/\.BO$/i, "");
        const exactLiveLtp = Number((liveQuotesMap[cleanSym] ?? targetTrade.currentMarketPrice ?? targetTrade.entryPrice).toFixed(2));
        const diff = (exactLiveLtp - targetTrade.entryPrice) * targetTrade.quantity;
        const pct = Number((((exactLiveLtp - targetTrade.entryPrice) / targetTrade.entryPrice) * 100).toFixed(2));

        const exitedTrade: ActivePortfolioTrade & { exitPrice?: number; dateKey?: string } = {
          ...targetTrade,
          cleanSymbol: cleanSym,
          currentMarketPrice: exactLiveLtp,
          currentSimulatedPrice: exactLiveLtp,
          exitPrice: exactLiveLtp,
          dateKey: getISTDateKey(),
          status: "NEWS_TRIGGER_EXIT",
          exitTime: exitStamp,
          pnlAmount: Math.round(diff),
          pnlPercent: pct,
        };

        const rem = prev.filter((t) => t.tradeId !== targetTrade.tradeId);
        autoTradesRef.current = rem;
        writeActiveTradesSync(STORAGE_KEY_ACTIVE_TRADES, rem, "SWING");

        const nextHist = appendSettledTradesSync(
          STORAGE_KEY_BACKTEST_HISTORY,
          [exitedTrade],
          "SWING"
        );
        setBacktestHistory(nextHist);

        setPortfolioNotice(
          `🚨 AI Sentiment Shield Auto-Exit [NEWS_TRIGGER_EXIT]: ${cleanSym} closed at ₹${exactLiveLtp} (${diff >= 0 ? "+" : ""}₹${Math.round(diff).toLocaleString("en-IN")}) — ${report.exitReason || report.topHeadline}`
        );

        return rem;
      });
    },
  });

  const clearInvalidTrades = () => {
    if (confirm("Clear old cached trades and re-scan with the new Purple Box Range detector?")) {
      setAutoTrades([]);
      localStorage.removeItem(STORAGE_KEY_ACTIVE_TRADES);
      localStorage.removeItem(STORAGE_KEY_DAILY_SIGNAL_LOCK);
      fetchLiveApiData(true);
    }
  };

  // Active symbols set (status === "ACTIVE"): excluded from Screener until closed to Backtest History
  const activeSymbolSet = useMemo(() => {
    return new Set(
      autoTrades
        .filter((t) => !t.status || t.status === "ACTIVE")
        .map((t) => String(t.cleanSymbol || t.symbol || "").toUpperCase().replace(/\.NS$/i, "").replace(/\.BO$/i, ""))
        .filter(Boolean)
    );
  }, [autoTrades]);

  const displayedStocks = useMemo(() => {
    return stocks.filter((st) => {
      // DUPLICATE ACTIVE TRADE PREVENTION: Exclude any symbol currently running with status === "ACTIVE"
      if (activeSymbolSet.has(st.cleanSymbol.toUpperCase())) return false;
      if (strategyFilter !== "ALL_STRATEGIES" && !st.matchedQuantStrategies.includes(strategyFilter)) return false;
      if (searchFilter.trim()) {
        const q = searchFilter.trim().toUpperCase();
        if (!st.cleanSymbol.includes(q) && !st.companyName.toUpperCase().includes(q)) return false;
      }
      return true;
    });
  }, [stocks, activeSymbolSet, strategyFilter, searchFilter]);

  const purpleBoxCount = useMemo(
    () => stocks.filter((s) => s.matchedQuantStrategies.includes("RANGE_SUPPORT_BUY")).length,
    [stocks]
  );

  const todayDateKey = getTodayDateKey();

  return (
    <div className="space-y-6 p-4 max-w-7xl mx-auto font-mono">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 bg-[#0d1322] p-5 rounded-2xl border border-slate-800">
        <div>
          <div className="flex items-center gap-2.5 flex-wrap">
            <h2 className="text-xl font-bold text-slate-100 flex items-center gap-2">
              <Crosshair className="w-5 h-5 text-fuchsia-400" />
              PURPLE BOX TRAPPED RANGE &amp; 5-6D DOJI BREAKOUT TERMINAL
            </h2>
            <span className="text-[10px] px-2.5 py-0.5 rounded-full font-bold bg-fuchsia-500/20 text-fuchsia-300 border border-fuchsia-500/40">
              🟣 PURPLE BOX RANGE ({purpleBoxCount} FOUND)
            </span>
            <span className="text-[10px] px-2.5 py-0.5 rounded-full font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
              🔒 SAME-DAY PRICE FREEZE ({todayDateKey})
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Finds Stocks Stuck in 1–2M Horizontal Purple Box (Uptrend or Downtrend: VAL Support → POC → VAH Target) + 5-6D Doji Breakouts
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => setAutoExecuteEnabled(!autoExecuteEnabled)}
            className={`px-3.5 py-2 rounded-xl text-xs font-bold border cursor-pointer ${autoExecuteEnabled
                ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/40"
                : "bg-slate-900 text-slate-400 border-slate-700"
              }`}
          >
            ⚡ Auto-Trade: {autoExecuteEnabled ? "ON" : "OFF"}
          </button>
          <button
            onClick={() => fetchLiveApiData(true)}
            className="px-3.5 py-2 rounded-xl bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 text-xs font-bold cursor-pointer flex items-center gap-1.5"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? "animate-spin" : ""}`} />
            <span>Sync Live LTP</span>
          </button>
        </div>
      </div>

      {/* 🎯 Live 4H Order Block Retest Feed */}
      <IMLive4HOrderBlockRetestTicker
        alerts={retestAlerts}
        onDeploy={handleDeploy4HRetest}
        isScanning={isLoading}
      />

      {/* Main Navigation Tabs */}
      <div className="flex items-center justify-between gap-3 border-b border-slate-800 pb-3 flex-wrap">
        <div className="flex items-center gap-3 flex-wrap">
          <button
            onClick={() => setMainTab("SCREENER")}
            className={`px-4 py-2 rounded-xl text-xs font-bold cursor-pointer flex items-center gap-2 ${mainTab === "SCREENER"
                ? "bg-cyan-500/25 text-cyan-300 border border-cyan-500/50"
                : "bg-slate-900 text-slate-400 border border-slate-800"
              }`}
          >
            <Layers className="w-4 h-4 text-cyan-400" />
            <span>📊 4-Strategy Screener ({displayedStocks.length})</span>
          </button>

          <button
            onClick={() => setMainTab("PORTFOLIO")}
            className={`px-4 py-2 rounded-xl text-xs font-bold cursor-pointer flex items-center gap-2 ${mainTab === "PORTFOLIO"
                ? "bg-violet-500/25 text-violet-300 border border-violet-500/50"
                : "bg-slate-900 text-slate-400 border border-slate-800"
              }`}
          >
            <Briefcase className="w-4 h-4 text-violet-400" />
            <span>⚡ Active Trades Table ({autoTrades.length})</span>
          </button>

          <button
            onClick={() => setMainTab("BACKTEST_HISTORY")}
            className={`px-4 py-2 rounded-xl text-xs font-bold cursor-pointer flex items-center gap-2 ${mainTab === "BACKTEST_HISTORY"
                ? "bg-emerald-500/25 text-emerald-300 border border-emerald-500/50"
                : "bg-slate-900 text-slate-400 border border-slate-800"
              }`}
          >
            <History className="w-4 h-4 text-emerald-400" />
            <span>📈 Backtest Log ({backtestHistory.length})</span>
          </button>

          <button
            onClick={() => setMainTab("STRATEGY_GUIDE")}
            className={`px-4 py-2 rounded-xl text-xs font-bold cursor-pointer flex items-center gap-2 ${mainTab === "STRATEGY_GUIDE"
                ? "bg-amber-500/25 text-amber-300 border border-amber-500/50"
                : "bg-slate-900 text-slate-400 border border-slate-800"
              }`}
          >
            <BookOpen className="w-4 h-4 text-amber-400" />
            <span>🧠 4-Strategy Rules</span>
          </button>
        </div>

        {autoTrades.length > 0 && (
          <button
            onClick={clearInvalidTrades}
            className="px-3 py-1.5 rounded-lg bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 border border-rose-500/30 text-xs flex items-center gap-1.5 cursor-pointer"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Reset &amp; Re-Scan</span>
          </button>
        )}
      </div>

      {portfolioNotice && (
        <div className="p-3 rounded-xl bg-emerald-500/15 border border-emerald-500/40 text-xs text-emerald-200 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-emerald-400" />
            <span>{portfolioNotice}</span>
          </div>
          <button onClick={() => setPortfolioNotice(null)} className="cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* STRATEGY GUIDE TAB */}
      {mainTab === "STRATEGY_GUIDE" && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {(Object.keys(STRATEGY_METADATA) as Array<Exclude<InstitutionalStrategyCode, "ALL_STRATEGIES">>).map((key) => {
            const meta = STRATEGY_METADATA[key];
            return (
              <div key={key} className="p-5 rounded-2xl bg-[#0d1322] border border-slate-800 space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className={`text-xs px-2.5 py-1 rounded-lg font-bold border ${meta.colorClass}`}>
                    {meta.shortBadge}
                  </span>
                  <span className="text-xs font-bold text-emerald-400">Win Rate: ~{meta.winProbBase}%</span>
                </div>
                <h4 className="text-sm font-bold text-slate-100">{meta.title}</h4>
                <p className="text-xs text-slate-400 leading-relaxed">{meta.logicDesc}</p>
              </div>
            );
          })}
        </div>
      )}

      {/* SCREENER TAB WITH ALL 4 STRATEGY FILTER BUTTONS */}
      {mainTab === "SCREENER" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3 flex-wrap bg-[#0d1322] p-4 rounded-2xl border border-slate-800">
            <div className="flex items-center gap-2 flex-wrap">
              <button
                onClick={() => setStrategyFilter("ALL_STRATEGIES")}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold border cursor-pointer ${strategyFilter === "ALL_STRATEGIES"
                    ? "bg-white/15 text-white border-white/40"
                    : "bg-slate-900 text-slate-400 border-slate-800"
                  }`}
              >
                All 4 Strategies ({stocks.length})
              </button>

              {(Object.keys(STRATEGY_METADATA) as Array<Exclude<InstitutionalStrategyCode, "ALL_STRATEGIES">>).map(
                (key) => (
                  <button
                    key={key}
                    onClick={() => setStrategyFilter(strategyFilter === key ? "ALL_STRATEGIES" : key)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold border cursor-pointer ${strategyFilter === key
                        ? STRATEGY_METADATA[key].colorClass
                        : "bg-slate-900 text-slate-400 border-slate-800"
                      }`}
                  >
                    {STRATEGY_METADATA[key].shortBadge}
                  </button>
                )
              )}
            </div>

            <input
              type="text"
              placeholder="Search stock..."
              value={searchFilter}
              onChange={(e) => setSearchFilter(e.target.value)}
              className="px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-xs text-slate-100 uppercase w-44"
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {displayedStocks.map((sig) => (
              <div
                key={sig.id}
                className={`p-5 rounded-2xl bg-[#0d1322] border space-y-3 ${sig.matchedQuantStrategies.includes("RANGE_SUPPORT_BUY")
                    ? "border-fuchsia-500/40"
                    : "border-slate-800"
                  }`}
              >
                <div className="flex justify-between items-start">
                  <div>
                    <span className="text-lg font-bold text-slate-100">{sig.cleanSymbol}</span>
                    <div className="text-xs text-slate-400">{sig.companyName}</div>
                  </div>
                  <div className="text-right">
                    <span className="text-xs font-bold px-2.5 py-1 rounded bg-emerald-500/20 text-emerald-300">
                      Score {sig.confluenceScore}/100 · {sig.volumeMultiplier}x Vol
                    </span>
                    <span className="text-xs text-white font-bold block mt-1">
                      Market Price (LTP): ₹{sig.currentPrice}
                    </span>
                  </div>
                </div>

                {/* Strategy Badges */}
                <div className="flex gap-1.5 flex-wrap">
                  {sig.matchedQuantStrategies.map((k) => (
                    <span
                      key={k}
                      className={`text-[10px] px-2.5 py-0.5 rounded-md border font-bold ${STRATEGY_METADATA[k].colorClass}`}
                    >
                      {STRATEGY_METADATA[k].shortBadge}
                    </span>
                  ))}
                </div>

                <div className="p-3 rounded-xl bg-slate-900 border border-slate-800 text-xs text-slate-300 space-y-1">
                  <div>
                    <strong className="text-fuchsia-300">1. Box Levels:</strong> {sig.supportBounceInfo}
                  </div>
                  <div>
                    <strong className="text-amber-300">2. Touches &amp; Width:</strong> {sig.fiveDayBoxInfo}
                  </div>
                  <div>
                    <strong className="text-emerald-400">3. Action Trigger:</strong> {sig.dojiCandleInfo}
                  </div>
                </div>

                <div className="grid grid-cols-4 gap-2 text-xs pt-2 border-t border-slate-800">
                  <div>
                    <span className="text-[9px] text-slate-500 block">BOX FLOOR / BREAKOUT</span>
                    <span className="font-bold text-orange-300">₹{sig.breakoutLevel}</span>
                  </div>
                  <div>
                    <span className="text-[9px] text-slate-500 block">LOCKED ENTRY</span>
                    <span className="font-bold text-cyan-300">₹{sig.entryPrice}</span>
                  </div>
                  <div>
                    <span className="text-[9px] text-slate-500 block">LOCKED SL</span>
                    <span className="font-bold text-rose-400">₹{sig.stopLossPrice}</span>
                  </div>
                  <div>
                    <span className="text-[9px] text-slate-500 block">LOCKED TARGET (VAH)</span>
                    <span className="font-bold text-emerald-400">₹{sig.target1Price}</span>
                  </div>
                </div>

                <div className="pt-2 flex justify-end">
                  <button
                    onClick={() => deploySingleStockTrade(sig)}
                    className="px-3.5 py-1.5 rounded-xl bg-gradient-to-r from-violet-600/40 to-cyan-600/40 hover:from-violet-500/50 hover:to-cyan-500/50 text-cyan-200 border border-cyan-500/40 text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                  >
                    <Zap className="w-3.5 h-3.5 text-amber-400" />
                    <span>⚡ Deploy Trade (Lock LTP ₹{sig.currentPrice})</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ACTIVE PORTFOLIO TABLE */}
      {mainTab === "PORTFOLIO" && (
        <div className="p-5 rounded-2xl bg-[#0d1322] border border-violet-500/30 space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                <Activity className="w-4 h-4 text-emerald-400" />
                ACTIVE TRADES — CLICK ANY ROW FOR PURPLE BOX / DOJI AUDIT &amp; NEXT-DAY SL/TP ADJUSTMENT
              </h3>
              {lastLtpSyncTime && (
                <div className="text-[10px] text-cyan-300 mt-0.5 flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  <span>Live Snapshot Synced at {lastLtpSyncTime}</span>
                </div>
              )}
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              <button
                onClick={() => fetchLiveApiData(true)}
                disabled={isLoading}
                className="px-3 py-1.5 rounded-xl bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300 border border-cyan-500/40 text-xs font-bold flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? "animate-spin" : ""}`} />
                <span>⚡ Force Refresh LTP</span>
              </button>
              <button
                onClick={() => runNewsScan()}
                disabled={isScanningNews || autoTrades.length === 0}
                className="px-3 py-1.5 rounded-xl bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border border-emerald-500/40 text-xs font-bold flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                title={lastNewsScanIst ? `AI Sentiment Shield last scanned at ${lastNewsScanIst}` : "Scan live financial news & reversal catalysts for all active trades"}
              >
                <Shield className={`w-3.5 h-3.5 ${isScanningNews ? "animate-pulse text-amber-300" : "text-emerald-400"}`} />
                <span>{isScanningNews ? "Scanning News..." : "🛡️ AI News Shield"}</span>
              </button>
              <span className="text-xs text-violet-300 font-bold">
                Capital Deployed: ₹{autoTrades.reduce((a, t) => a + t.allocatedCapital, 0).toLocaleString("en-IN")}
              </span>
            </div>
          </div>

          {autoTrades.length === 0 ? (
            <div className="p-10 rounded-xl bg-slate-900/60 border border-slate-800 text-center text-xs text-slate-400">
              No active trades. Deploy any setup from the Screener tab or toggle Auto-Trade ON.
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-slate-800">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-900 text-slate-400 border-b border-slate-800 uppercase text-[10px]">
                    <th className="py-3 px-3">Stock &amp; Strategy</th>
                    <th className="py-3 px-3">Box Floor / Ref</th>
                    <th className="py-3 px-3">Locked Entry</th>
                    <th className="py-3 px-3">Market Price (LTP)</th>
                    <th className="py-3 px-3">Locked SL</th>
                    <th className="py-3 px-3">Locked Target</th>
                    <th className="py-3 px-3">Target Kitna Baki Hai</th>
                    <th className="py-3 px-3">Live P&amp;L</th>
                    <th className="py-3 px-3">AI Sentiment Shield</th>
                    <th className="py-3 px-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800 bg-[#0a0f1c]">
                  {autoTrades.map((tr) => {
                    const cleanSym = String(tr.cleanSymbol || tr.symbol || "")
                      .toUpperCase()
                      .replace(/\.NS$/i, "")
                      .replace(/\.BO$/i, "");
                    const aiReport = aiShieldReports[cleanSym];
                    const isCatalystWarning =
                      aiReport?.shieldStatus === "CATALYST_ALERT" ||
                      aiReport?.shieldStatus === "CRITICAL_NEWS_EXIT" ||
                      aiReport?.shieldStatus === "EXHAUSTION_REVERSAL_EXIT";
                    const shieldBadgeLabel = aiReport?.badgeText || "🟢 Clean";
                    const exactLiveLtp = Number((liveQuotesMap[cleanSym] ?? tr.currentMarketPrice ?? tr.entryPrice).toFixed(2));
                    const exactPnlAmount = Math.round((exactLiveLtp - tr.entryPrice) * tr.quantity);
                    const exactPnlPercent = Number((((exactLiveLtp - tr.entryPrice) / tr.entryPrice) * 100).toFixed(2));
                    const isSameDayLocked = tr.lockedDateKey === todayDateKey;
                    const ptsLeft = Math.max(0, Number((tr.targetPrice - exactLiveLtp).toFixed(2)));
                    const pctLeft =
                      exactLiveLtp > 0
                        ? Math.max(
                          0,
                          Number((((tr.targetPrice - exactLiveLtp) / exactLiveLtp) * 100).toFixed(2))
                        )
                        : 0;

                    return (
                      <tr
                        key={tr.tradeId}
                        onClick={() =>
                          setSelectedTradeModal({
                            ...tr,
                            currentMarketPrice: exactLiveLtp,
                            pnlAmount: exactPnlAmount,
                            pnlPercent: exactPnlPercent,
                          })
                        }
                        className="hover:bg-cyan-500/10 transition cursor-pointer"
                      >
                        <td className="py-3.5 px-3">
                          <div className="flex items-center gap-1.5">
                            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                            <span className="font-bold text-slate-100 text-sm">
                              {cleanSym}
                            </span>
                            <span className="text-[10px] text-slate-400">({tr.quantity} Qty)</span>
                          </div>
                          <div className="text-[10px] text-fuchsia-300 mt-0.5">{tr.strategyUsed}</div>
                          <div className="text-[10px] mt-0.5">
                            {isSameDayLocked ? (
                              <span className="text-amber-300 flex items-center gap-1">
                                <Lock className="w-3 h-3" /> Same-Day Locked
                              </span>
                            ) : (
                              <span className="text-cyan-300 flex items-center gap-1">
                                <Edit3 className="w-3 h-3" /> Next-Day Adjustable
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="py-3.5 px-3 font-bold text-orange-300">
                          ₹{tr.breakoutLevel || tr.entryPrice}
                        </td>
                        <td className="py-3.5 px-3 font-bold text-cyan-300">₹{tr.entryPrice}</td>
                        <td className="py-3.5 px-3 font-bold text-white bg-slate-900/60">
                          <div className="flex items-center gap-1">
                            <span>₹{exactLiveLtp}</span>
                            <span className="text-[9px] px-1 py-0.2 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                              LIVE
                            </span>
                          </div>
                        </td>
                        <td className="py-3.5 px-3 font-bold">
                          <div className={tr.isTslCostLocked ? "text-amber-300 flex items-center gap-1" : "text-rose-400"}>
                            {tr.isTslCostLocked && <Lock className="w-3 h-3 text-amber-400" />}
                            <span>₹{tr.stopLossPrice}</span>
                          </div>
                          {tr.isTslCostLocked && (
                            <span className="text-[9px] text-amber-300/90 block">TSL → COST (70%+)</span>
                          )}
                        </td>
                        <td className="py-3.5 px-3 font-bold text-emerald-400">₹{tr.targetPrice}</td>
                        <td className="py-3.5 px-3 font-bold text-amber-300">
                          ₹{ptsLeft} ({pctLeft}% left)
                        </td>
                        <td className="py-3.5 px-3 font-bold">
                          <span className={exactPnlAmount >= 0 ? "text-emerald-400" : "text-rose-400"}>
                            {exactPnlAmount >= 0 ? "+" : ""}₹{exactPnlAmount.toLocaleString("en-IN")} ({exactPnlPercent >= 0 ? "+" : ""}{exactPnlPercent}%)
                          </span>
                        </td>
                        <td className="py-3.5 px-3" onClick={(e) => e.stopPropagation()}>
                          <div className="flex flex-col gap-1">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span
                                className={`text-[10px] px-2 py-0.5 rounded-full font-bold border ${
                                  isCatalystWarning
                                    ? "bg-amber-500/20 text-amber-300 border-amber-500/40 animate-pulse"
                                    : "bg-emerald-500/15 text-emerald-300 border-emerald-500/30"
                                }`}
                                title={aiReport?.topHeadline || "AI News & Reversal Worker monitoring live headlines & volume exhaustion"}
                              >
                                {shieldBadgeLabel}
                              </span>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  runNewsScan(cleanSym);
                                }}
                                className="text-[9px] px-1.5 py-0.5 rounded bg-rose-500/15 hover:bg-rose-500/30 text-rose-300 border border-rose-500/30 font-bold cursor-pointer"
                                title="Simulate a high-impact negative news catalyst / volume exhaustion reversal to test automated NEWS_TRIGGER_EXIT"
                              >
                                🧪 Sim Catalyst
                              </button>
                            </div>
                            <div
                              className="text-[10px] text-slate-400 max-w-[180px] truncate"
                              title={aiReport?.topHeadline || "Monitoring live NSE/Yahoo Finance catalyst feed"}
                            >
                              {aiReport?.topHeadline || "Monitoring live catalyst feed..."}
                            </div>
                          </div>
                        </td>
                        <td className="py-3.5 px-3 text-right">
                          <div className="flex items-center justify-end gap-1 flex-wrap">
                            <button
                              onClick={(e) => handleEmergencySquareOffNow(tr.tradeId, e)}
                              className="px-2.5 py-1.5 rounded-lg bg-gradient-to-r from-rose-600 to-orange-600 hover:from-rose-500 hover:to-orange-500 text-white border border-rose-400/50 text-[10px] font-bold flex items-center gap-1 cursor-pointer shadow-md"
                              title="Instantly lock current live P&L, archive to Backtest History, and free up capital"
                            >
                              <Zap className="w-3 h-3 text-amber-200" />
                              <span>⚡ Emergency Exit / Square-off Now</span>
                            </button>
                            <button
                              onClick={(e) => resolveTradeOutcome(tr.tradeId, "TARGET", e)}
                              className="px-2 py-1 bg-emerald-500/20 text-emerald-300 text-[10px] rounded cursor-pointer"
                            >
                              TP ✅
                            </button>
                            <button
                              onClick={(e) => resolveTradeOutcome(tr.tradeId, "STOPLOSS", e)}
                              className="px-2 py-1 bg-rose-500/20 text-rose-300 text-[10px] rounded cursor-pointer"
                            >
                              SL ❌
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* BACKTEST TAB */}
      {mainTab === "BACKTEST_HISTORY" && (
        <div className="p-5 rounded-2xl bg-[#0d1322] border border-emerald-500/30 space-y-4 shadow-2xl">
          <div className="flex items-center justify-between flex-wrap gap-3 pb-3 border-b border-slate-800">
            <div>
              <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                <History className="w-4 h-4 text-emerald-400" />
                Closed Trades Backtest Archive &amp; Audit Log ({backtestHistory.length})
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Click any closed trade row (e.g., POLYCAB, PGEL, SUNPHARMA) to inspect the interactive Exit Audit Modal detailing exact exit rationale, Target &amp; SL hit mechanics, and scraped news.
              </p>
            </div>

            {/* Quick Filter Pills */}
            <div className="flex items-center gap-1.5 flex-wrap text-xs">
              <span className="text-[10px] text-slate-500 uppercase font-bold flex items-center gap-1 mr-1">
                <Filter className="w-3 h-3" /> Filter:
              </span>
              {(["ALL", "TARGET", "SL", "SHIELD"] as const).map((mode) => {
                const count =
                  mode === "ALL"
                    ? backtestHistory.length
                    : mode === "TARGET"
                    ? backtestHistory.filter((t) => String(t.status || "").includes("TARGET")).length
                    : mode === "SL"
                    ? backtestHistory.filter((t) => {
                        const s = String(t.status || "");
                        return s.includes("STOP_LOSS") || s.includes("TSL") || s.includes("SL");
                      }).length
                    : backtestHistory.filter((t) => {
                        const s = String(t.status || "");
                        return s.includes("NEWS") || s.includes("REVERSAL") || s.includes("EMERGENCY");
                      }).length;

                return (
                  <button
                    key={mode}
                    onClick={() => setBacktestFilter(mode)}
                    className={`px-2.5 py-1 rounded-lg text-[10px] font-bold border transition-all cursor-pointer ${
                      backtestFilter === mode
                        ? "bg-cyan-500/25 text-cyan-300 border-cyan-500/50 shadow-sm"
                        : "bg-slate-900 text-slate-400 border-slate-800 hover:text-slate-200"
                    }`}
                  >
                    {mode === "ALL"
                      ? `Show All (${count})`
                      : mode === "TARGET"
                      ? `🎯 Target Hits (${count})`
                      : mode === "SL"
                      ? `🛑 SL / Trailing (${count})`
                      : `🚨 Shield Exits (${count})`}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-2.5">
            {filteredBacktestHistory.length === 0 ? (
              <div className="p-8 text-center text-slate-400 text-xs">
                No closed trades found matching the selected filter ({backtestFilter}).
              </div>
            ) : (
              filteredBacktestHistory.map((tr) => {
                const cleanSym = String(tr.cleanSymbol || tr.symbol || "")
                  .toUpperCase()
                  .replace(/\.NS$/i, "")
                  .replace(/\.BO$/i, "");
                const isNewsExit = String(tr.status || "").includes("NEWS");
                const isReversalExit = String(tr.status || "").includes("REVERSAL");
                const isTarget = String(tr.status || "").includes("TARGET");

                const targetPrice = tr.targetPrice || Number((tr.entryPrice * 1.07).toFixed(2));
                const stopLossPrice = tr.stopLossPrice || Number((tr.entryPrice * 0.968).toFixed(2));
                const exitPrice = tr.exitPrice || tr.currentMarketPrice || tr.currentSimulatedPrice;

                return (
                  <div
                    key={tr.tradeId}
                    onClick={() => setSelectedExitAuditTrade(tr as any)}
                    className="p-3.5 rounded-xl bg-slate-900/90 border border-slate-800 hover:border-cyan-500/40 hover:bg-cyan-500/5 transition cursor-pointer flex items-center justify-between flex-wrap gap-3 group"
                  >
                    <div className="flex items-center gap-3">
                      <span
                        className={`text-[10px] px-2.5 py-1 rounded-full font-bold uppercase border ${
                          isNewsExit
                            ? "bg-rose-500/20 text-rose-300 border-rose-500/40"
                            : isReversalExit
                            ? "bg-amber-500/20 text-amber-300 border-amber-500/40"
                            : isTarget
                            ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/40"
                            : "bg-slate-800 text-slate-300 border-slate-700"
                        }`}
                      >
                        {String(tr.status || "CLOSED").replace(/_/g, " ")}
                      </span>
                      <div>
                        <div className="font-bold text-slate-100 text-sm flex items-center gap-1.5">
                          <span>{cleanSym}</span>
                          <span className="text-[10px] text-cyan-400 opacity-0 group-hover:opacity-100 transition-opacity">
                            🔍 Audit
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-400 flex items-center gap-2 flex-wrap mt-1">
                          <span className="text-violet-300 font-semibold">{tr.strategyUsed}</span>
                          <span className="text-slate-600">·</span>
                          <span>Entry: <strong className="text-cyan-300">₹{tr.entryPrice}</strong></span>
                          <span className="text-slate-600">·</span>
                          <span className="text-emerald-400 font-bold flex items-center gap-0.5">
                            🎯 Target: ₹{targetPrice}
                          </span>
                          <span className="text-slate-600">·</span>
                          <span className="text-rose-400 font-bold flex items-center gap-0.5">
                            🛑 SL: ₹{stopLossPrice}
                          </span>
                          <span className="text-slate-600">→</span>
                          <span>Exit: <strong className="text-white">₹{exitPrice}</strong></span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-4">
                      <div className="text-right">
                        <div
                          className={`text-sm font-bold ${
                            tr.pnlAmount >= 0 ? "text-emerald-400" : "text-rose-400"
                          }`}
                        >
                          {tr.pnlAmount >= 0 ? "+" : ""}₹{tr.pnlAmount.toLocaleString("en-IN")}
                        </div>
                        <div
                          className={`text-[10px] font-bold ${
                            tr.pnlPercent >= 0 ? "text-emerald-400" : "text-rose-400"
                          }`}
                        >
                          {tr.pnlPercent >= 0 ? "+" : ""}
                          {tr.pnlPercent}%
                        </div>
                      </div>

                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedExitAuditTrade(tr as any);
                        }}
                        className="px-3 py-1.5 rounded-lg bg-cyan-500/15 text-cyan-300 hover:bg-cyan-500/25 border border-cyan-500/30 text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer transition shadow-sm group-hover:scale-105"
                      >
                        <Search className="w-3.5 h-3.5 text-cyan-400" />
                        <span>🔍 View Exit Audit Log</span>
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* 🔍 POPUP MODAL: SCORE, VOLUME, TARGET DISTANCE & NEXT-DAY LEVEL ADJUSTER */}
      {selectedTradeModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md"
          onClick={() => setSelectedTradeModal(null)}
        >
          <div
            className="w-full max-w-2xl rounded-2xl bg-[#0d1322] border border-fuchsia-500/40 shadow-2xl p-6 space-y-5 text-slate-100 font-mono"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between border-b border-slate-800 pb-3">
              <div>
                <h3 className="text-xl font-bold text-fuchsia-300">
                  {selectedTradeModal.cleanSymbol || selectedTradeModal.symbol} — {selectedTradeModal.strategyUsed}
                </h3>
                <p className="text-xs text-slate-400 mt-1">
                  ⭐ <strong className="text-emerald-400">Score: {selectedTradeModal.confluenceScore}/100</strong> · 📊{" "}
                  <strong className="text-amber-300">Volume: {selectedTradeModal.volumeMultiplier}x Avg</strong> ·
                  Locked Date: <strong className="text-cyan-300">{selectedTradeModal.lockedDateKey}</strong>
                </p>
              </div>
              <button onClick={() => setSelectedTradeModal(null)} className="text-slate-400 hover:text-white cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5 text-center text-xs">
              <div className="p-2.5 rounded-xl bg-slate-900 border border-orange-500/40">
                <span className="text-[9px] text-orange-300 block">BOX FLOOR / REF</span>
                <span className="text-sm font-bold text-orange-300">
                  ₹{selectedTradeModal.breakoutLevel || selectedTradeModal.entryPrice}
                </span>
              </div>
              <div className="p-2.5 rounded-xl bg-slate-900 border border-slate-800">
                <span className="text-[9px] text-slate-400 block">LOCKED ENTRY</span>
                <span className="text-sm font-bold text-cyan-300">₹{selectedTradeModal.entryPrice}</span>
              </div>
              <div className="p-2.5 rounded-xl bg-slate-900 border border-white/20">
                <span className="text-[9px] text-slate-300 block">MARKET PRICE (LTP)</span>
                <span className="text-sm font-bold text-white">₹{selectedTradeModal.currentMarketPrice}</span>
              </div>
              <div className="p-2.5 rounded-xl bg-slate-900 border border-rose-500/30">
                <span className="text-[9px] text-rose-400 block">LOCKED SL</span>
                <span className="text-sm font-bold text-rose-400">₹{selectedTradeModal.stopLossPrice}</span>
              </div>
              <div className="p-2.5 rounded-xl bg-slate-900 border border-emerald-500/30">
                <span className="text-[9px] text-emerald-400 block">LOCKED TARGET</span>
                <span className="text-sm font-bold text-emerald-400">₹{selectedTradeModal.targetPrice}</span>
              </div>
            </div>

            {(() => {
              const isSameDay = selectedTradeModal.lockedDateKey === todayDateKey;
              const canEdit = !isSameDay || unlockOverride;

              return (
                <div className="p-4 rounded-xl bg-slate-900/90 border border-violet-500/30 space-y-3 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-violet-300 flex items-center gap-1.5">
                      {canEdit ? <Edit3 className="w-4 h-4" /> : <Lock className="w-4 h-4 text-amber-300" />}
                      {isSameDay && !unlockOverride
                        ? `🔒 Same-Day Price Freeze Active (${todayDateKey}) — Entry, SL & TP Cannot Shift Today`
                        : `✏️ Adjust Entry / SL / Target (Reference Price ₹${selectedTradeModal.breakoutLevel || selectedTradeModal.entryPrice
                        } Stays Fixed)`}
                    </span>
                    {isSameDay && !unlockOverride && (
                      <button
                        onClick={() => setUnlockOverride(true)}
                        className="text-[10px] px-2 py-1 rounded bg-slate-800 text-slate-300 hover:text-white cursor-pointer"
                      >
                        Manual Override
                      </button>
                    )}
                  </div>

                  {canEdit && (
                    <div className="grid grid-cols-1 sm:grid-cols-4 gap-2.5 pt-1 items-end">
                      <div>
                        <label className="text-[10px] text-slate-400 block mb-1">Entry Price (₹)</label>
                        <input
                          type="number"
                          step="0.05"
                          value={editEntry}
                          onChange={(e) => setEditEntry(e.target.value)}
                          className="w-full px-2.5 py-1.5 rounded bg-[#0d1322] border border-slate-700 text-cyan-300 font-bold"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] text-slate-400 block mb-1">Stop-Loss (₹)</label>
                        <input
                          type="number"
                          step="0.05"
                          value={editSL}
                          onChange={(e) => setEditSL(e.target.value)}
                          className="w-full px-2.5 py-1.5 rounded bg-[#0d1322] border border-slate-700 text-rose-400 font-bold"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] text-slate-400 block mb-1">Target Price (₹)</label>
                        <input
                          type="number"
                          step="0.05"
                          value={editTP}
                          onChange={(e) => setEditTP(e.target.value)}
                          className="w-full px-2.5 py-1.5 rounded bg-[#0d1322] border border-slate-700 text-emerald-400 font-bold"
                        />
                      </div>
                      <button
                        onClick={handleSaveAdjustedLevels}
                        className="px-3 py-1.5 rounded-lg bg-violet-500/30 hover:bg-violet-500/40 text-violet-200 border border-violet-500/50 font-bold cursor-pointer"
                      >
                        Save Levels
                      </button>
                    </div>
                  )}
                </div>
              );
            })()}

            {(() => {
              const ptsLeft = Math.max(
                0,
                Number((selectedTradeModal.targetPrice - selectedTradeModal.currentMarketPrice).toFixed(2))
              );
              const pctLeft =
                selectedTradeModal.currentMarketPrice > 0
                  ? Math.max(
                    0,
                    Number(
                      (
                        ((selectedTradeModal.targetPrice - selectedTradeModal.currentMarketPrice) /
                          selectedTradeModal.currentMarketPrice) *
                        100
                      ).toFixed(2)
                    )
                  )
                  : 0;
              const rupeeProfitLeft = Math.round(ptsLeft * selectedTradeModal.quantity);

              return (
                <div className="p-4 rounded-xl bg-slate-900 border border-cyan-500/30 space-y-2 text-xs">
                  <div className="flex justify-between font-bold">
                    <span className="text-cyan-300">🎯 TARGET KITNA BAKI HAI:</span>
                    <span className="text-amber-300">
                      ₹{ptsLeft} Points ({pctLeft}% away from Target)
                    </span>
                  </div>
                  <div className="text-emerald-400 font-bold">
                    Remaining Potential Profit to Target: +₹{rupeeProfitLeft.toLocaleString("en-IN")}
                  </div>
                </div>
              );
            })()}

            <div className="p-4 rounded-xl bg-slate-900/80 border border-fuchsia-500/30 space-y-1.5 text-xs">
              <div className="font-bold text-fuchsia-300 flex items-center gap-1.5">
                <Flame className="w-4 h-4 text-fuchsia-400" />
                <span>🟣 Purple Box Range &amp; Doji Audit</span>
              </div>
              <p className="text-slate-300">{selectedTradeModal.supportBounceInfo}</p>
              <p className="text-slate-300">{selectedTradeModal.fiveDayBoxInfo}</p>
              <p className="text-slate-300">{selectedTradeModal.dojiCandleInfo}</p>
            </div>
          </div>
        </div>
      )}

      {/* Interactive Trade Exit Audit Modal Popup */}
      <IMTradeExitAuditModal
        trade={selectedExitAuditTrade}
        onClose={() => setSelectedExitAuditTrade(null)}
      />
    </div>
  );
}