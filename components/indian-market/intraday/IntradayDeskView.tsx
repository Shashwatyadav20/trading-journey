"use client";

import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import {
  Zap,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Clock,
  Activity,
  History,
  Newspaper,
  TrendingUp,
  TrendingDown,
  Lock,
  Flame,
  Layers,
  CheckCircle2,
  AlertTriangle,
  Trash2,
  X,
  Search,
} from "lucide-react";
import {
  IntradayScannerOpportunity,
  IntradayDirection,
  IntradayStrategyId,
  NewsCatalystItem,
  SmartExitAuditTag,
  evaluateActiveTradeSmartShield,
  checkIntradaySquareOffWindow,
} from "../../../lib/indian/intradayEngine";
import { useAiNewsReversalWorker } from "../../../hooks/useAiNewsReversalWorker";
import IMTradeExitAuditModal, { ClosedTradeExitAuditData } from "../IMTradeExitAuditModal";
import { DEFAULT_CLOSED_TRADE_AUDIT_SEEDS } from "../../../lib/indian/backtestSeeds";
import {
  STORAGE_KEY_INTRADAY_ACTIVE,
  STORAGE_KEY_INTRADAY_HISTORY,
  appendSettledTradesSync,
  writeActiveTradesSync,
  writeHistoryTradesSync,
  getISTDateKey,
} from "../../../lib/indian/ledgerSync";

export interface ActiveIntradayTrade {
  tradeId: string;
  symbol: string;
  cleanSymbol: string;
  companyName: string;
  sector: string;
  direction: IntradayDirection;
  strategyUsed: string;
  entryPrice: number;
  stopLossPrice: number;
  initialStopLoss: number;
  targetPrice: number;
  quantity: number;
  allocatedCapital: number;
  currentMarketPrice: number;
  peakPrice: number; // Highest for LONG, Lowest for SHORT
  pnlAmount: number;
  pnlPercent: number;
  targetProgressPct: number;
  isTslCostLocked: boolean;
  tslStatusLabel: string;
  liveSentimentBadge: string;
  status: "ACTIVE" | SmartExitAuditTag;
  auditTag?: SmartExitAuditTag;
  exitReason?: string;
  executionTime: string;
  exitTime?: string;
  lastLtpSyncAt?: string;
  orbHigh915_945: number;
  orbLow915_945: number;
  vwap5m: number;
}

export default function IntradayDeskView() {
  const [opportunities, setOpportunities] = useState<IntradayScannerOpportunity[]>([]);
  const [newsFeed, setNewsFeed] = useState<NewsCatalystItem[]>([]);
  const [activeTrades, setActiveTrades] = useState<ActiveIntradayTrade[]>([]);
  const [historyTrades, setHistoryTrades] = useState<ActiveIntradayTrade[]>([]);
  const [selectedExitAuditTrade, setSelectedExitAuditTrade] = useState<ClosedTradeExitAuditData | null>(null);
  const [livePrices, setLivePrices] = useState<Record<string, number>>({});
  const [isHydrated, setIsHydrated] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [lastSyncIst, setLastSyncIst] = useState<string | null>(null);
  const [deskNotice, setDeskNotice] = useState<string | null>(null);
  const [autoExecuteIntraday, setAutoExecuteIntraday] = useState<boolean>(false);
  const [autoSquareOff315Enabled, setAutoSquareOff315Enabled] = useState<boolean>(true);
  const [istClockInfo, setIstClockInfo] = useState(() => checkIntradaySquareOffWindow());

  // Sub-tabs inside Intraday Desk
  const [activeSubTab, setActiveSubTab] = useState<
    "SCANNER" | "ACTIVE_TRADES" | "NEWS_REVERSAL_READER" | "HISTORY"
  >("SCANNER");

  // Filters
  const [strategyFilter, setStrategyFilter] = useState<"ALL" | IntradayStrategyId>("ALL");
  const [directionFilter, setDirectionFilter] = useState<"ALL" | IntradayDirection>("ALL");
  const [searchQuery, setSearchQuery] = useState<string>("");

  const activeTradesRef = useRef<ActiveIntradayTrade[]>([]);
  const historyTradesRef = useRef<ActiveIntradayTrade[]>([]);
  useEffect(() => {
    activeTradesRef.current = activeTrades;
  }, [activeTrades]);
  useEffect(() => {
    historyTradesRef.current = historyTrades;
  }, [historyTrades]);

  // 1. Hydrate isolated Intraday localStorage state (Purge legacy _v1/_v2 keys)
  useEffect(() => {
    try {
      ["nse_intraday_active_trades_v1", "nse_intraday_history_trades_v1", "nse_intraday_active_trades_v2", "nse_intraday_history_trades_v2"].forEach((k) =>
        localStorage.removeItem(k)
      );
      const savedActive = localStorage.getItem(STORAGE_KEY_INTRADAY_ACTIVE);
      if (savedActive) {
        const parsed = JSON.parse(savedActive);
        if (Array.isArray(parsed)) {
          const clean = parsed.filter(
            (t: any) => t && !String(t.tradeId || "").startsWith("AUDIT-") && !String(t.tradeId || "").startsWith("AUTO-")
          );
          setActiveTrades(clean);
          activeTradesRef.current = clean;
        }
      }
      const savedHistory = localStorage.getItem(STORAGE_KEY_INTRADAY_HISTORY);
      if (savedHistory) {
        const parsedH = JSON.parse(savedHistory);
        if (Array.isArray(parsedH)) {
          const cleanH = parsedH.filter(
            (t: any) => t && !String(t.tradeId || "").startsWith("AUDIT-") && !String(t.tradeId || "").startsWith("AUTO-")
          );
          setHistoryTrades(cleanH);
          historyTradesRef.current = cleanH;
        } else {
          setHistoryTrades([]);
          historyTradesRef.current = [];
        }
      } else {
        setHistoryTrades([]);
        historyTradesRef.current = [];
      }
    } catch (e) {
      console.error("Failed to hydrate intraday trades:", e);
    } finally {
      setIsHydrated(true);
    }
  }, []);

  // Persist active & history trades
  useEffect(() => {
    if (!isHydrated) return;
    try {
      localStorage.setItem(STORAGE_KEY_INTRADAY_ACTIVE, JSON.stringify(activeTrades));
    } catch { }
  }, [activeTrades, isHydrated]);

  useEffect(() => {
    if (!isHydrated) return;
    try {
      localStorage.setItem(STORAGE_KEY_INTRADAY_HISTORY, JSON.stringify(historyTrades));
    } catch { }
  }, [historyTrades, isHydrated]);

  // 2. Synchronize Active Intraday Trades with Live LTP, Auto-Activate Qualified Setups, Smart Shield & 3:15 PM Auto-Square-Off
  const syncActiveIntradayTrades = useCallback(
    (
      priceMap: Map<string, number>,
      forcedCatalystForTrade?: {
        tradeId: string;
        type: "REVERSAL_EXHAUSTION" | "NEGATIVE_NEWS";
        headline: string;
      },
      incomingOpportunities?: IntradayScannerOpportunity[],
      forceSquareOff315Now = false
    ) => {
      const currentList = activeTradesRef.current;
      const clock = checkIntradaySquareOffWindow();
      const is315SquareOffTriggered =
        forceSquareOff315Now || (autoSquareOff315Enabled && clock.isAutoSquareOffWindow);

      const syncStamp = new Date().toLocaleTimeString("en-IN", { hour12: false });
      const nowFullIst = new Date().toLocaleString("en-IN");
      const todayDateKey = getISTDateKey();

      const stillActive: ActiveIntradayTrade[] = [];
      const newlyClosed: ActiveIntradayTrade[] = [];
      const newlyAutoActivated: ActiveIntradayTrade[] = [];

      currentList.forEach((tr) => {
        const cleanSym = tr.cleanSymbol.toUpperCase();
        const tickPrice = priceMap.get(cleanSym);
        const liveLtp =
          typeof tickPrice === "number" && Number.isFinite(tickPrice) && tickPrice > 0
            ? Number(tickPrice.toFixed(2))
            : Number(tr.currentMarketPrice || tr.entryPrice);

        const isLong = tr.direction === "LONG";
        const entry = Number(tr.entryPrice);
        const qty = Number(tr.quantity);

        const updatedPeak = isLong
          ? Math.max(liveLtp, tr.peakPrice || entry)
          : Math.min(liveLtp, tr.peakPrice || entry);

        const rawPnl = isLong ? (liveLtp - entry) * qty : (entry - liveLtp) * qty;
        const pnlAmount = Math.round(rawPnl);
        const pnlPercent = Number(
          (((isLong ? liveLtp - entry : entry - liveLtp) / Math.max(1, entry)) * 100).toFixed(2)
        );

        const forcedCat =
          forcedCatalystForTrade && forcedCatalystForTrade.tradeId === tr.tradeId
            ? {
                type: forcedCatalystForTrade.type,
                headline: forcedCatalystForTrade.headline,
              }
            : null;

        // Evaluate Smart Reversal & News Shield + 70% Target TSL-to-Cost
        const shield = evaluateActiveTradeSmartShield({
          symbol: cleanSym,
          direction: tr.direction,
          entryPrice: entry,
          stopLossPrice: tr.stopLossPrice,
          initialStopLoss: tr.initialStopLoss,
          targetPrice: tr.targetPrice,
          currentPrice: liveLtp,
          peakPrice: updatedPeak,
          quantity: qty,
          isTslCostLocked: tr.isTslCostLocked,
          vwapPrice: tr.vwap5m,
          forcedCatalyst: forcedCat,
        });

        const effectiveStop = shield.updatedStopLossPrice;

        const updatedTrade: ActiveIntradayTrade = {
          ...tr,
          currentMarketPrice: liveLtp,
          peakPrice: updatedPeak,
          stopLossPrice: effectiveStop,
          pnlAmount,
          pnlPercent,
          targetProgressPct: shield.targetProgressPct,
          isTslCostLocked: shield.isTslCostLocked,
          tslStatusLabel: shield.tslStatusLabel,
          liveSentimentBadge: shield.liveSentimentBadge,
          lastLtpSyncAt: syncStamp,
        };

        // Check 1: Mandatory 3:15 PM IST Auto-Square-Off
        if (is315SquareOffTriggered) {
          newlyClosed.push({
            ...updatedTrade,
            exitPrice: liveLtp,
            dateKey: todayDateKey,
            status: "AUTO_SQUARE_OFF_315PM",
            auditTag: "AUTO_SQUARE_OFF_315PM",
            exitReason: `🕒 Mandatory 3:15 PM IST Intraday Auto-Square-Off executed automatically at Live LTP ₹${liveLtp}.`,
            exitTime: nowFullIst,
          } as ActiveIntradayTrade);
          return;
        }

        // Check 2: Smart Shield Reversal or Breaking News Exit
        if (shield.shouldAutoExit && shield.autoExitTag) {
          newlyClosed.push({
            ...updatedTrade,
            exitPrice: liveLtp,
            dateKey: todayDateKey,
            status: shield.autoExitTag,
            auditTag: shield.autoExitTag,
            exitReason: shield.autoExitReason || `Smart Shield Auto-Exit (${shield.autoExitTag}) at ₹${liveLtp}`,
            exitTime: nowFullIst,
          } as ActiveIntradayTrade);
          return;
        }

        // Check 3: Target Hit
        const isTargetHit = isLong ? liveLtp >= tr.targetPrice : liveLtp <= tr.targetPrice;
        if (isTargetHit) {
          newlyClosed.push({
            ...updatedTrade,
            exitPrice: liveLtp,
            dateKey: todayDateKey,
            status: "TARGET_HIT",
            auditTag: "TARGET_HIT",
            exitReason: `Intraday Target ₹${tr.targetPrice} achieved at Live LTP ₹${liveLtp}.`,
            exitTime: nowFullIst,
          } as ActiveIntradayTrade);
          return;
        }

        // Check 4: Stop-Loss or TSL-to-Cost Breakeven Hit
        const isStopHit = isLong ? liveLtp <= effectiveStop : liveLtp >= effectiveStop;
        if (isStopHit) {
          const tag: SmartExitAuditTag = shield.isTslCostLocked ? "TSL_COST_BREAKEVEN_EXIT" : "STOP_LOSS_HIT";
          newlyClosed.push({
            ...updatedTrade,
            exitPrice: liveLtp,
            dateKey: todayDateKey,
            status: tag,
            auditTag: tag,
            exitReason: shield.isTslCostLocked
              ? `Protected Breakeven Stop (TSL to Cost ₹${effectiveStop}) triggered at ₹${liveLtp}. Principal 100% preserved.`
              : `Intraday Stop-Loss ₹${effectiveStop} hit at ₹${liveLtp}.`,
            exitTime: nowFullIst,
          } as ActiveIntradayTrade);
          return;
        }

        stillActive.push(updatedTrade);
      });

      // AUTOMATIC INTRADAY SHARE ACTIVATION (Before 3:15 PM IST)
      // Automatically activates top qualified ORB / VWAP setups into Active Trades (up to 8 positions)
      if (
        autoExecuteIntraday &&
        !is315SquareOffTriggered &&
        Array.isArray(incomingOpportunities) &&
        incomingOpportunities.length > 0 &&
        stillActive.length < 8
      ) {
        const activeSymSet = new Set(stillActive.map((t) => t.cleanSymbol.toUpperCase()));
        const closedSymSet = new Set(
          [...newlyClosed, ...historyTradesRef.current].map((t) => t.cleanSymbol.toUpperCase())
        );

        const slotsRemaining = 8 - stillActive.length;
        const candidates = incomingOpportunities
          .filter(
            (op) =>
              !activeSymSet.has(op.cleanSymbol.toUpperCase()) &&
              !closedSymSet.has(op.cleanSymbol.toUpperCase())
          )
          .slice(0, slotsRemaining);

        candidates.forEach((op, idx) => {
          const cleanSym = op.cleanSymbol.toUpperCase();
          const exactLtp = Number((priceMap.get(cleanSym) ?? op.currentPrice).toFixed(2));
          if (!exactLtp || exactLtp <= 0) return;

          newlyAutoActivated.push({
            tradeId: `AUTO-INTRA-${cleanSym}-${Date.now()}-${idx}`,
            symbol: op.symbol,
            cleanSymbol: cleanSym,
            companyName: op.companyName,
            sector: op.sector,
            direction: op.direction,
            strategyUsed: op.strategyBadge,
            entryPrice: exactLtp,
            stopLossPrice: op.stopLossPrice,
            initialStopLoss: op.stopLossPrice,
            targetPrice: op.targetPrice,
            quantity: op.recommendedQuantity,
            allocatedCapital: Math.round(op.recommendedQuantity * exactLtp),
            currentMarketPrice: exactLtp,
            peakPrice: exactLtp,
            pnlAmount: 0,
            pnlPercent: 0,
            targetProgressPct: 0,
            isTslCostLocked: false,
            tslStatusLabel: `SL ₹${op.stopLossPrice} (0%/70% to Cost Lock)`,
            liveSentimentBadge: "🟢 AUTO-ACTIVE · 3:15 PM SQ-OFF ARMED",
            status: "ACTIVE",
            executionTime: nowFullIst,
            lastLtpSyncAt: syncStamp,
            orbHigh915_945: op.orbHigh915_945,
            orbLow915_945: op.orbLow915_945,
            vwap5m: op.vwap5m,
          });
        });
      }

      const finalActive = [...newlyAutoActivated, ...stillActive];
      activeTradesRef.current = finalActive;
      setActiveTrades(finalActive);
      writeActiveTradesSync(STORAGE_KEY_INTRADAY_ACTIVE, finalActive, "INTRADAY");

      if (newlyClosed.length > 0) {
        const mergedHistory = appendSettledTradesSync(
          STORAGE_KEY_INTRADAY_HISTORY,
          newlyClosed,
          "INTRADAY"
        );
        historyTradesRef.current = mergedHistory;
        setHistoryTrades(mergedHistory);
        const is315Batch = newlyClosed.some((c) => c.auditTag === "AUTO_SQUARE_OFF_315PM");
        setDeskNotice(
          is315Batch
            ? `🕒 3:15 PM IST Automatic Square-Off Executed: ${newlyClosed
                .map(
                  (c) =>
                    `${c.cleanSymbol} (${c.pnlAmount >= 0 ? "+" : ""}₹${c.pnlAmount.toLocaleString("en-IN")})`
                )
                .join(" · ")} automatically squared off and archived to Intraday History!`
            : `🛡️ Smart Shield Executed: ${newlyClosed
                .map(
                  (c) =>
                    `${c.cleanSymbol} [${c.auditTag || c.status}] (${c.pnlAmount >= 0 ? "+" : ""}₹${c.pnlAmount.toLocaleString("en-IN")})`
                )
                .join(" · ")} archived to Intraday History!`
        );
      } else if (newlyAutoActivated.length > 0) {
        setDeskNotice(
          `⚡ Auto-Activated ${newlyAutoActivated.length} Intraday Shares (${newlyAutoActivated
            .map((t) => `${t.cleanSymbol} ${t.direction}`)
            .join(", ")}) at exact Live LTP! Automatic Square-Off armed for 3:15 PM IST.`
        );
      }
    },
    [autoExecuteIntraday, autoSquareOff315Enabled]
  );

  // 3. Fetch Live Intraday Scanner & Broadcast LTP
  const fetchIntradayScanner = useCallback(
    async (forceRefresh = false) => {
      setIsLoading(true);
      try {
        let activeSource = activeTradesRef.current;
        if (activeSource.length === 0 && typeof window !== "undefined") {
          const raw = localStorage.getItem(STORAGE_KEY_INTRADAY_ACTIVE);
          if (raw) {
            try {
              const parsed = JSON.parse(raw);
              if (Array.isArray(parsed)) activeSource = parsed;
            } catch { }
          }
        }

        const activeSyms = Array.from(
          new Set(
            activeSource
              .filter((t) => t.status === "ACTIVE")
              .map((t) => t.cleanSymbol.toUpperCase())
              .filter(Boolean)
          )
        );
        const activeParam =
          activeSyms.length > 0
            ? `&activeSymbols=${encodeURIComponent(activeSyms.join(","))}&excludeActive=true`
            : "";

        const res = await fetch(
          `/api/indian/intraday/scanner?excludeActive=true${activeParam}&_t=${Date.now()}${
            forceRefresh ? "&forceRefresh=true" : ""
          }`,
          { cache: "no-store" }
        );
        if (!res.ok) return;
        const json = await res.json();

        const incomingPrices = new Map<string, number>();
        if (json.livePrices && typeof json.livePrices === "object") {
          Object.entries(json.livePrices).forEach(([sym, obj]: [string, any]) => {
            const clean = sym.toUpperCase().replace(/\.NS$/i, "").replace(/\.BO$/i, "");
            const ltp = Number(obj?.ltp ?? obj);
            if (Number.isFinite(ltp) && ltp > 0) {
              incomingPrices.set(clean, Number(ltp.toFixed(2)));
            }
          });
        }

        let syncedOps: IntradayScannerOpportunity[] = [];
        if (Array.isArray(json.opportunities)) {
          syncedOps = json.opportunities.map((op: IntradayScannerOpportunity) => {
            const snapLtp = incomingPrices.get(op.cleanSymbol.toUpperCase());
            if (typeof snapLtp === "number" && snapLtp > 0) {
              return { ...op, currentPrice: snapLtp, entryPrice: snapLtp };
            }
            incomingPrices.set(op.cleanSymbol.toUpperCase(), op.currentPrice);
            return op;
          });
          setOpportunities(syncedOps);
        }

        if (Array.isArray(json.newsFeed)) {
          setNewsFeed(json.newsFeed);
        }

        if (incomingPrices.size > 0) {
          const plain: Record<string, number> = {};
          incomingPrices.forEach((v, k) => {
            plain[k] = v;
          });
          setLivePrices((prev) => ({ ...prev, ...plain }));
          setLastSyncIst(new Date().toLocaleTimeString("en-IN", { hour12: false }));
          syncActiveIntradayTrades(incomingPrices, undefined, syncedOps);
        }
      } catch (e) {
        console.error("Intraday scanner fetch error:", e);
      } finally {
        setIsLoading(false);
      }
    },
    [syncActiveIntradayTrades]
  );

  // Initial fetch + 15s live intraday polling + 1s IST clock watcher for 3:15 PM auto-square-off
  useEffect(() => {
    fetchIntradayScanner(false);
    const pollTimer = setInterval(() => fetchIntradayScanner(false), 15000);
    return () => clearInterval(pollTimer);
  }, [fetchIntradayScanner]);

  useEffect(() => {
    const clockTimer = setInterval(() => {
      const info = checkIntradaySquareOffWindow();
      setIstClockInfo(info);
      if (autoSquareOff315Enabled && info.isAutoSquareOffWindow && activeTradesRef.current.length > 0) {
        const currentPriceMap = new Map<string, number>(Object.entries(livePrices));
        syncActiveIntradayTrades(currentPriceMap, undefined, undefined, true);
      }
    }, 1000);
    return () => clearInterval(clockTimer);
  }, [autoSquareOff315Enabled, livePrices, syncActiveIntradayTrades]);

  // 4. Deploy Intraday Trade (LONG or SHORT) locked at exact Live LTP (initial P&L = ₹0 / 0%)
  const deployIntradayTrade = (op: IntradayScannerOpportunity) => {
    const cleanSym = op.cleanSymbol.toUpperCase();
    if (activeTrades.some((t) => t.cleanSymbol.toUpperCase() === cleanSym && t.status === "ACTIVE")) {
      setDeskNotice(`ℹ️ ${cleanSym} is already running in Active Intraday Trades!`);
      setActiveSubTab("ACTIVE_TRADES");
      return;
    }

    const exactLtp = Number((livePrices[cleanSym] ?? op.currentPrice).toFixed(2));
    const nowIst = new Date().toLocaleString("en-IN");
    const syncStamp = new Date().toLocaleTimeString("en-IN", { hour12: false });

    const newTrade: ActiveIntradayTrade = {
      tradeId: `INTRA-${cleanSym}-${Date.now()}`,
      symbol: op.symbol,
      cleanSymbol: cleanSym,
      companyName: op.companyName,
      sector: op.sector,
      direction: op.direction,
      strategyUsed: op.strategyBadge,
      entryPrice: exactLtp,
      stopLossPrice: op.stopLossPrice,
      initialStopLoss: op.stopLossPrice,
      targetPrice: op.targetPrice,
      quantity: op.recommendedQuantity,
      allocatedCapital: Math.round(op.recommendedQuantity * exactLtp),
      currentMarketPrice: exactLtp,
      peakPrice: exactLtp,
      pnlAmount: 0,
      pnlPercent: 0,
      targetProgressPct: 0,
      isTslCostLocked: false,
      tslStatusLabel: `SL ₹${op.stopLossPrice} (0%/70% to Cost Lock)`,
      liveSentimentBadge: "🟢 FLOW HEALTHY · SHIELD ARMED",
      status: "ACTIVE",
      executionTime: nowIst,
      lastLtpSyncAt: syncStamp,
      orbHigh915_945: op.orbHigh915_945,
      orbLow915_945: op.orbLow915_945,
      vwap5m: op.vwap5m,
    };

    const nextList = [newTrade, ...activeTrades];
    activeTradesRef.current = nextList;
    setActiveTrades(nextList);
    setDeskNotice(
      `⚡ Deployed Intraday ${op.direction} on ${cleanSym} (${op.recommendedQuantity} Qty @ ₹${exactLtp} · Initial P&L: ₹0). Smart Exit Shield & 3:15 PM Auto-Square-Off Armed!`
    );
    setActiveSubTab("ACTIVE_TRADES");
  };

  // 5. Manual Emergency Exit / Square-Off Now handler (Single Trade or Entire Desk)
  const handleEmergencySquareOffNow = (
    tradeId: string,
    customTag: SmartExitAuditTag = "MANUAL_EMERGENCY_EXIT",
    customReason?: string
  ) => {
    const target = activeTrades.find((t) => t.tradeId === tradeId);
    if (!target) return;

    const cleanSym = target.cleanSymbol.toUpperCase();
    const liveLtp = Number((livePrices[cleanSym] ?? target.currentMarketPrice ?? target.entryPrice).toFixed(2));
    const isLong = target.direction === "LONG";
    const rawPnl = isLong
      ? (liveLtp - target.entryPrice) * target.quantity
      : (target.entryPrice - liveLtp) * target.quantity;
    const pnlAmount = Math.round(rawPnl);
    const pnlPercent = Number(
      (((isLong ? liveLtp - target.entryPrice : target.entryPrice - liveLtp) / Math.max(1, target.entryPrice)) * 100).toFixed(2)
    );
    const nowFullIst = new Date().toLocaleString("en-IN");

    const closedTrade: ActiveIntradayTrade = {
      ...target,
      currentMarketPrice: liveLtp,
      exitPrice: liveLtp,
      dateKey: getISTDateKey(),
      pnlAmount,
      pnlPercent,
      status: customTag,
      auditTag: customTag,
      exitReason:
        customReason ||
        `⚡ Emergency Manual Square-Off executed at Live LTP ₹${liveLtp}. Realized P&L: ${
          pnlAmount >= 0 ? "+" : ""
        }₹${pnlAmount.toLocaleString("en-IN")} (${pnlPercent >= 0 ? "+" : ""}${pnlPercent}%).`,
      exitTime: nowFullIst,
    } as ActiveIntradayTrade;

    const remaining = activeTrades.filter((t) => t.tradeId !== tradeId);
    activeTradesRef.current = remaining;
    setActiveTrades(remaining);
    writeActiveTradesSync(STORAGE_KEY_INTRADAY_ACTIVE, remaining, "INTRADAY");
    const mergedHistory = appendSettledTradesSync(
      STORAGE_KEY_INTRADAY_HISTORY,
      [closedTrade],
      "INTRADAY"
    );
    historyTradesRef.current = mergedHistory;
    setHistoryTrades(mergedHistory);
    setDeskNotice(
      `⚡ Square-Off Complete: ${cleanSym} closed at Live LTP ₹${liveLtp} [${customTag}] (${
        pnlAmount >= 0 ? "+" : ""
      }₹${pnlAmount.toLocaleString("en-IN")} / ${pnlPercent >= 0 ? "+" : ""}${pnlPercent}%) & archived to History!`
    );
  };

  const handleSquareOffAllActive = () => {
    if (activeTrades.length === 0) return;
    const nowFullIst = new Date().toLocaleString("en-IN");
    const closedBatch: ActiveIntradayTrade[] = activeTrades.map((t) => {
      const cleanSym = t.cleanSymbol.toUpperCase();
      const liveLtp = Number((livePrices[cleanSym] ?? t.currentMarketPrice ?? t.entryPrice).toFixed(2));
      const isLong = t.direction === "LONG";
      const pnlAmount = Math.round(
        isLong ? (liveLtp - t.entryPrice) * t.quantity : (t.entryPrice - liveLtp) * t.quantity
      );
      const pnlPercent = Number(
        (((isLong ? liveLtp - t.entryPrice : t.entryPrice - liveLtp) / Math.max(1, t.entryPrice)) * 100).toFixed(2)
      );
      return {
        ...t,
        currentMarketPrice: liveLtp,
        exitPrice: liveLtp,
        dateKey: getISTDateKey(),
        pnlAmount,
        pnlPercent,
        status: "MANUAL_EMERGENCY_EXIT",
        auditTag: "MANUAL_EMERGENCY_EXIT",
        exitReason: `⚡ Desk-Wide Emergency Square-Off at Live LTP ₹${liveLtp}.`,
        exitTime: nowFullIst,
      } as ActiveIntradayTrade;
    });

    activeTradesRef.current = [];
    setActiveTrades([]);
    writeActiveTradesSync(STORAGE_KEY_INTRADAY_ACTIVE, [], "INTRADAY");
    const mergedHistory = appendSettledTradesSync(
      STORAGE_KEY_INTRADAY_HISTORY,
      closedBatch,
      "INTRADAY"
    );
    historyTradesRef.current = mergedHistory;
    setHistoryTrades(mergedHistory);
    setDeskNotice(`⚡ Squared off all ${closedBatch.length} active intraday positions at live market price!`);
  };

  // AI News & Reversal Reader Background Worker Hook (polls /api/indian/news-reader for all active intraday symbols)
  const {
    aiShieldReports,
    isScanningNews,
    lastNewsScanIst,
    runNewsScan,
  } = useAiNewsReversalWorker({
    activeTrades,
    pollIntervalMs: 45_000,
    enabled: true,
    onAutoExitTriggered: (report) => {
      const target = activeTradesRef.current.find(
        (t) => t.cleanSymbol.toUpperCase() === report.symbol
      );
      if (!target) return;
      handleEmergencySquareOffNow(
        target.tradeId,
        "NEWS_TRIGGER_EXIT",
        report.exitReason || `🚨 AI Sentiment Shield Auto-Exit [NEWS_TRIGGER_EXIT]: ${report.topHeadline}`
      );
    },
  });

  // Simulate Smart Shield 70% TSL-to-Cost or Reversal/News Exit on an active trade
  const triggerSmartShieldTest = (
    trade: ActiveIntradayTrade,
    mode: "LOCK_70_COST" | "REVERSAL_EXIT" | "NEWS_TRIGGER_EXIT"
  ) => {
    const isLong = trade.direction === "LONG";
    const dist = Math.abs(trade.targetPrice - trade.entryPrice);

    if (mode === "LOCK_70_COST") {
      // Simulate price reaching 75% of target distance so TSL automatically locks to Entry Price (Cost)
      const simLtp = isLong
        ? Number((trade.entryPrice + dist * 0.75).toFixed(2))
        : Number((trade.entryPrice - dist * 0.75).toFixed(2));
      const map = new Map<string, number>(Object.entries(livePrices));
      map.set(trade.cleanSymbol.toUpperCase(), simLtp);
      setLivePrices((prev) => ({ ...prev, [trade.cleanSymbol.toUpperCase()]: simLtp }));
      syncActiveIntradayTrades(map);
      setDeskNotice(
        `🛡️ Smart Shield Milestone: ${trade.cleanSymbol} reached 75% of target distance (₹${simLtp}) — Stop-Loss automatically trailed to Cost/Breakeven (₹${trade.entryPrice})!`
      );
      return;
    }

    if (mode === "REVERSAL_EXIT") {
      const map = new Map<string, number>(Object.entries(livePrices));
      syncActiveIntradayTrades(map, {
        tradeId: trade.tradeId,
        type: "REVERSAL_EXHAUSTION",
        headline: `${trade.cleanSymbol} printed a 5m Volume Exhaustion Shooting Star near target zone with institutional ask-wall absorption.`,
      });
      return;
    }

    if (mode === "NEWS_TRIGGER_EXIT") {
      const map = new Map<string, number>(Object.entries(livePrices));
      syncActiveIntradayTrades(map, {
        tradeId: trade.tradeId,
        type: "NEGATIVE_NEWS",
        headline: `Breaking Catalyst Alert on ${trade.cleanSymbol}: Sudden regulatory/sector headwind headline detected on exchange feed.`,
      });
    }
  };

  // Active symbols exclusion set
  const activeSymbolSet = useMemo(() => {
    return new Set(
      activeTrades
        .filter((t) => t.status === "ACTIVE")
        .map((t) => t.cleanSymbol.toUpperCase())
    );
  }, [activeTrades]);

  const displayedOpportunities = useMemo(() => {
    return opportunities.filter((op) => {
      // Exclude symbols currently running in Active Intraday Trades
      if (activeSymbolSet.has(op.cleanSymbol.toUpperCase())) return false;
      if (strategyFilter !== "ALL" && !op.matchedStrategies.includes(strategyFilter)) return false;
      if (directionFilter !== "ALL" && op.direction !== directionFilter) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.trim().toUpperCase();
        if (!op.cleanSymbol.includes(q) && !op.companyName.toUpperCase().includes(q)) return false;
      }
      return true;
    });
  }, [opportunities, activeSymbolSet, strategyFilter, directionFilter, searchQuery]);

  // Live Unrealized & Realized P&L summary
  const activeSummary = useMemo(() => {
    let deployed = 0;
    let unrealizedPnl = 0;
    activeTrades.forEach((tr) => {
      const cleanSym = tr.cleanSymbol.toUpperCase();
      const liveLtp = livePrices[cleanSym] ?? tr.currentMarketPrice ?? tr.entryPrice;
      const isLong = tr.direction === "LONG";
      const pnl = Math.round(
        isLong ? (liveLtp - tr.entryPrice) * tr.quantity : (tr.entryPrice - liveLtp) * tr.quantity
      );
      deployed += tr.allocatedCapital;
      unrealizedPnl += pnl;
    });
    return { deployed, unrealizedPnl };
  }, [activeTrades, livePrices]);

  const historySummary = useMemo(() => {
    const total = historyTrades.length;
    const wins = historyTrades.filter((t) => t.pnlAmount >= 0).length;
    const realizedPnl = historyTrades.reduce((acc, t) => acc + t.pnlAmount, 0);
    return {
      total,
      wins,
      winRate: total > 0 ? Math.round((wins / total) * 100) : 0,
      realizedPnl,
    };
  }, [historyTrades]);

  return (
    <div className="space-y-6 p-4 max-w-7xl mx-auto font-mono text-slate-100">
      {/* Top Institutional Intraday Desk Header */}
      <div className="bg-[#0d1322]/95 backdrop-blur-xl border border-cyan-500/30 rounded-2xl p-5 shadow-2xl space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5 flex-wrap">
              <span className="px-2.5 py-1 rounded-lg bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 text-xs font-bold flex items-center gap-1.5">
                <Zap className="w-3.5 h-3.5 text-amber-400" />
                INTRADAY QUANT DESK
              </span>
              <h1 className="text-xl font-bold tracking-tight text-white">
                9:15–9:45 ORB · 5m VWAP SURGE · SMART REVERSAL &amp; NEWS SHIELD
              </h1>
              <span className="text-[10px] px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 font-bold flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                LIVE FEED {lastSyncIst ? `(${lastSyncIst})` : "ACTIVE"}
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-1">
              Isolated Intraday Execution Engine · Auto-TSL to Cost at 70% Target Distance · Real-Time Exhaustion/News Auto-Exit · Mandatory 3:15 PM IST Square-Off
            </p>
          </div>

          <div className="flex items-center gap-2.5 flex-wrap">
            {/* Automatic Intraday Share Activation Toggle (ON by default) */}
            <button
              onClick={() => setAutoExecuteIntraday((v) => !v)}
              className={`px-3 py-2 rounded-xl text-xs font-bold border flex items-center gap-1.5 cursor-pointer transition ${
                autoExecuteIntraday
                  ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/40"
                  : "bg-slate-900 text-slate-400 border-slate-800"
              }`}
              title="Automatically activate qualified intraday shares into Active Trades"
            >
              <Zap className="w-3.5 h-3.5 text-emerald-400" />
              <span>Auto-Active Intraday: {autoExecuteIntraday ? "ON" : "OFF"}</span>
            </button>

            {/* Mandatory 3:15 PM IST Auto-Square-Off Status Pill */}
            <button
              onClick={() => setAutoSquareOff315Enabled((v) => !v)}
              className={`px-3 py-2 rounded-xl text-xs font-bold border flex items-center gap-1.5 cursor-pointer transition ${
                autoSquareOff315Enabled
                  ? "bg-amber-500/20 text-amber-300 border-amber-500/40"
                  : "bg-slate-900 text-slate-400 border-slate-800"
              }`}
              title="Toggle mandatory 3:15 PM IST intraday auto-square-off"
            >
              <Clock className="w-3.5 h-3.5 text-amber-400" />
              <span>3:15 PM Auto-SqOff: {autoSquareOff315Enabled ? "ARMED" : "OFF"}</span>
              <span className="text-[10px] text-slate-300 ml-1">({istClockInfo.istTimeString})</span>
            </button>

            {activeTrades.length > 0 && (
              <button
                onClick={() => {
                  const currentPriceMap = new Map<string, number>(Object.entries(livePrices));
                  syncActiveIntradayTrades(currentPriceMap, undefined, undefined, true);
                }}
                className="px-3 py-2 rounded-xl bg-violet-500/20 hover:bg-violet-500/30 text-violet-300 border border-violet-500/40 text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                title="Trigger the 3:15 PM IST automatic square-off immediately for testing"
              >
                <Clock className="w-3.5 h-3.5 text-violet-300" />
                <span>🕒 Test 3:15 PM Auto-SqOff</span>
              </button>
            )}

            <button
              onClick={() => fetchIntradayScanner(true)}
              disabled={isLoading}
              className="px-3.5 py-2 rounded-xl bg-gradient-to-r from-cyan-600 to-emerald-600 hover:from-cyan-500 hover:to-emerald-500 text-white border border-cyan-400/40 text-xs font-bold flex items-center gap-1.5 cursor-pointer shadow-lg disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? "animate-spin" : ""}`} />
              <span>{isLoading ? "Syncing Intraday..." : "⚡ Force Refresh LTP"}</span>
            </button>
          </div>
        </div>

        {/* Desk Metrics Strip */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2 border-t border-slate-800/80 text-xs">
          <div className="p-3 rounded-xl bg-slate-900/80 border border-slate-800">
            <span className="text-[10px] text-slate-400 uppercase block">Qualified ORB / VWAP Setups</span>
            <span className="text-base font-bold text-cyan-300">{displayedOpportunities.length} Live Signals</span>
          </div>
          <div className="p-3 rounded-xl bg-slate-900/80 border border-slate-800">
            <span className="text-[10px] text-slate-400 uppercase block">Active Intraday Exposure</span>
            <span className="text-base font-bold text-violet-300">
              {activeTrades.length} Trades (₹{activeSummary.deployed.toLocaleString("en-IN")})
            </span>
          </div>
          <div className="p-3 rounded-xl bg-slate-900/80 border border-slate-800">
            <span className="text-[10px] text-slate-400 uppercase block">Live Intraday Unrealized P&amp;L</span>
            <span
              className={`text-base font-bold ${
                activeSummary.unrealizedPnl >= 0 ? "text-emerald-400" : "text-rose-400"
              }`}
            >
              {activeSummary.unrealizedPnl >= 0 ? "+" : ""}₹{activeSummary.unrealizedPnl.toLocaleString("en-IN")}
            </span>
          </div>
          <div className="p-3 rounded-xl bg-slate-900/80 border border-slate-800">
            <span className="text-[10px] text-slate-400 uppercase block">
              Realized Intraday P&amp;L ({historySummary.winRate}% Win)
            </span>
            <span
              className={`text-base font-bold ${
                historySummary.realizedPnl >= 0 ? "text-emerald-400" : "text-rose-400"
              }`}
            >
              {historySummary.realizedPnl >= 0 ? "+" : ""}₹{historySummary.realizedPnl.toLocaleString("en-IN")}
            </span>
          </div>
        </div>
      </div>

      {/* Notice Banner */}
      {deskNotice && (
        <div className="p-3.5 rounded-xl bg-cyan-500/15 border border-cyan-500/40 text-xs text-cyan-200 flex items-center justify-between gap-3 shadow-lg">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>{deskNotice}</span>
          </div>
          <button onClick={() => setDeskNotice(null)} className="text-slate-400 hover:text-white cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Navigation Sub-Tabs */}
      <div className="flex items-center justify-between gap-3 border-b border-slate-800 pb-3 flex-wrap">
        <div className="flex items-center gap-2.5 flex-wrap">
          <button
            onClick={() => setActiveSubTab("SCANNER")}
            className={`px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-2 cursor-pointer transition ${
              activeSubTab === "SCANNER"
                ? "bg-cyan-500/25 text-cyan-300 border border-cyan-500/50 shadow-lg"
                : "bg-slate-900 text-slate-400 hover:text-slate-200 border border-slate-800"
            }`}
          >
            <Layers className="w-4 h-4 text-cyan-400" />
            <span>⚡ ORB &amp; VWAP Scanner ({displayedOpportunities.length})</span>
          </button>

          <button
            onClick={() => setActiveSubTab("ACTIVE_TRADES")}
            className={`px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-2 cursor-pointer transition ${
              activeSubTab === "ACTIVE_TRADES"
                ? "bg-violet-500/25 text-violet-300 border border-violet-500/50 shadow-lg"
                : "bg-slate-900 text-slate-400 hover:text-slate-200 border border-slate-800"
            }`}
          >
            <Activity className="w-4 h-4 text-violet-400" />
            <span>🛡️ Active Trades &amp; Smart Shield ({activeTrades.length})</span>
          </button>

          <button
            onClick={() => setActiveSubTab("NEWS_REVERSAL_READER")}
            className={`px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-2 cursor-pointer transition ${
              activeSubTab === "NEWS_REVERSAL_READER"
                ? "bg-amber-500/25 text-amber-300 border border-amber-500/50 shadow-lg"
                : "bg-slate-900 text-slate-400 hover:text-slate-200 border border-slate-800"
            }`}
          >
            <Newspaper className="w-4 h-4 text-amber-400" />
            <span>📡 Live News &amp; Reversal Reader ({newsFeed.length})</span>
          </button>

          <button
            onClick={() => setActiveSubTab("HISTORY")}
            className={`px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-2 cursor-pointer transition ${
              activeSubTab === "HISTORY"
                ? "bg-emerald-500/25 text-emerald-300 border border-emerald-500/50 shadow-lg"
                : "bg-slate-900 text-slate-400 hover:text-slate-200 border border-slate-800"
            }`}
          >
            <History className="w-4 h-4 text-emerald-400" />
            <span>🗄️ Intraday Backtest History ({historyTrades.length})</span>
          </button>
        </div>

        {activeTrades.length > 0 && (
          <button
            onClick={handleSquareOffAllActive}
            className="px-4 py-2 rounded-xl bg-rose-500/25 hover:bg-rose-500/35 text-rose-200 border border-rose-500/50 text-xs font-bold flex items-center gap-2 cursor-pointer shadow-lg"
          >
            <ShieldAlert className="w-4 h-4 text-rose-400" />
            <span>⚡ Emergency Square-Off All ({activeTrades.length})</span>
          </button>
        )}
      </div>

      {/* TAB 1: INTRADAY MOMENTUM SCANNER */}
      {activeSubTab === "SCANNER" && (
        <div className="space-y-4">
          {/* Filter Bar */}
          <div className="bg-[#0d1322] p-4 rounded-2xl border border-slate-800 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 flex-wrap">
              <button
                onClick={() => setStrategyFilter("ALL")}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold border cursor-pointer ${
                  strategyFilter === "ALL"
                    ? "bg-cyan-500/25 text-cyan-300 border-cyan-500/50"
                    : "bg-slate-900 text-slate-400 border-slate-800"
                }`}
              >
                All Intraday Setups
              </button>
              <button
                onClick={() => setStrategyFilter("ORB_915_945_BREAKOUT")}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold border cursor-pointer ${
                  strategyFilter === "ORB_915_945_BREAKOUT"
                    ? "bg-amber-500/25 text-amber-300 border-amber-500/50"
                    : "bg-slate-900 text-slate-400 border-slate-800"
                }`}
              >
                ⚡ 9:15–9:45 ORB Breakout
              </button>
              <button
                onClick={() => setStrategyFilter("VWAP_VOLUME_SURGE")}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold border cursor-pointer ${
                  strategyFilter === "VWAP_VOLUME_SURGE"
                    ? "bg-emerald-500/25 text-emerald-300 border-emerald-500/50"
                    : "bg-slate-900 text-slate-400 border-slate-800"
                }`}
              >
                🌊 VWAP Volume Surge
              </button>
              <button
                onClick={() => setStrategyFilter("DOJI_5M_SQUEEZE")}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold border cursor-pointer ${
                  strategyFilter === "DOJI_5M_SQUEEZE"
                    ? "bg-violet-500/25 text-violet-300 border-violet-500/50"
                    : "bg-slate-900 text-slate-400 border-slate-800"
                }`}
              >
                🎯 5m Doji Squeeze
              </button>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <button
                onClick={() => setDirectionFilter("ALL")}
                className={`px-2.5 py-1.5 rounded-lg text-xs font-bold border cursor-pointer ${
                  directionFilter === "ALL"
                    ? "bg-slate-800 text-white border-slate-600"
                    : "bg-slate-900 text-slate-400 border-slate-800"
                }`}
              >
                LONG &amp; SHORT
              </button>
              <button
                onClick={() => setDirectionFilter("LONG")}
                className={`px-2.5 py-1.5 rounded-lg text-xs font-bold border cursor-pointer ${
                  directionFilter === "LONG"
                    ? "bg-emerald-500/25 text-emerald-300 border-emerald-500/50"
                    : "bg-slate-900 text-slate-400 border-slate-800"
                }`}
              >
                🟢 LONG ONLY
              </button>
              <button
                onClick={() => setDirectionFilter("SHORT")}
                className={`px-2.5 py-1.5 rounded-lg text-xs font-bold border cursor-pointer ${
                  directionFilter === "SHORT"
                    ? "bg-rose-500/25 text-rose-300 border-rose-500/50"
                    : "bg-slate-900 text-slate-400 border-slate-800"
                }`}
              >
                🔴 SHORT ONLY
              </button>
              <input
                type="text"
                placeholder="Search symbol..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="px-3 py-1.5 rounded-xl bg-slate-900 border border-slate-700 text-xs text-slate-100 uppercase w-40"
              />
            </div>
          </div>

          {/* Intraday Opportunities Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {displayedOpportunities.map((op) => {
              const isLong = op.direction === "LONG";
              const exactLtp = livePrices[op.cleanSymbol.toUpperCase()] ?? op.currentPrice;
              return (
                <div
                  key={op.id}
                  className="bg-[#0d1322]/90 backdrop-blur-xl border border-slate-800/90 hover:border-cyan-500/50 transition-all rounded-2xl p-5 shadow-2xl space-y-3.5"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-lg font-bold text-white">{op.cleanSymbol}</span>
                        <span
                          className={`text-[10px] px-2 py-0.5 rounded font-bold border ${
                            isLong
                              ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/40"
                              : "bg-rose-500/20 text-rose-300 border-rose-500/40"
                          }`}
                        >
                          {isLong ? "🟢 INTRADAY LONG" : "🔴 INTRADAY SHORT"}
                        </span>
                        <span className="text-[10px] px-2 py-0.5 rounded bg-slate-800 text-slate-300">
                          {op.sector}
                        </span>
                      </div>
                      <div className="text-xs text-slate-400 mt-0.5">{op.companyName}</div>
                    </div>

                    <div className="text-right">
                      <div className="text-base font-extrabold text-white flex items-center justify-end gap-1.5">
                        <span>₹{exactLtp}</span>
                        <span
                          className={`text-xs font-bold ${
                            op.changePercent >= 0 ? "text-emerald-400" : "text-rose-400"
                          }`}
                        >
                          ({op.changePercent >= 0 ? "+" : ""}
                          {op.changePercent}%)
                        </span>
                      </div>
                      <div className="text-[10px] text-cyan-300 font-bold">
                        Score {op.confluenceScore}/100 · {op.volumeMultiplier}x Vol · {op.winProbability}% Win Prob
                      </div>
                    </div>
                  </div>

                  {/* Strategy & ORB/VWAP Telemetry */}
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-[10px] px-2.5 py-0.5 rounded-md bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 font-bold">
                      {op.strategyBadge}
                    </span>
                    <span className="text-[10px] px-2 py-0.5 rounded-md bg-amber-500/15 text-amber-300 border border-amber-500/30">
                      ORB: ₹{op.orbLow915_945} – ₹{op.orbHigh915_945} ({op.orbWidthPct}%)
                    </span>
                    <span className="text-[10px] px-2 py-0.5 rounded-md bg-violet-500/15 text-violet-300 border border-violet-500/30">
                      5m VWAP: ₹{op.vwap5m} ({op.priceVsVwapPct >= 0 ? "+" : ""}
                      {op.priceVsVwapPct}%)
                    </span>
                    <span className="text-[10px] px-2 py-0.5 rounded-md bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                      5m Dojis: {op.doji5mCount}
                    </span>
                  </div>

                  {/* Rationale & Live News Catalyst */}
                  <div className="p-3 rounded-xl bg-slate-900/90 border border-slate-800/90 text-xs text-slate-300 space-y-1">
                    <div>{op.rationale[0]}</div>
                    <div>{op.rationale[1]}</div>
                    <div className="text-[11px] text-amber-300 pt-1 border-t border-slate-800/80 flex items-center gap-1.5">
                      <Newspaper className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                      <span className="truncate">{op.newsCatalyst.headline}</span>
                    </div>
                  </div>

                  {/* Levels & 1-Click Deploy */}
                  <div className="grid grid-cols-4 gap-2 text-xs pt-1">
                    <div className="p-2 rounded-lg bg-slate-900 border border-slate-800">
                      <span className="text-[9px] text-slate-400 block">ENTRY (LIVE LTP)</span>
                      <span className="font-bold text-cyan-300">₹{exactLtp}</span>
                    </div>
                    <div className="p-2 rounded-lg bg-slate-900 border border-slate-800">
                      <span className="text-[9px] text-slate-400 block">STOP-LOSS</span>
                      <span className="font-bold text-rose-400">₹{op.stopLossPrice}</span>
                    </div>
                    <div className="p-2 rounded-lg bg-slate-900 border border-slate-800">
                      <span className="text-[9px] text-slate-400 block">TARGET ({op.rewardRiskRatio}R)</span>
                      <span className="font-bold text-emerald-400">₹{op.targetPrice}</span>
                    </div>
                    <div className="p-2 rounded-lg bg-slate-900 border border-slate-800">
                      <span className="text-[9px] text-slate-400 block">QTY / AUTO-SQOFF</span>
                      <span className="font-bold text-amber-300">{op.recommendedQuantity} sh · 3:15 PM</span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-2 border-t border-slate-800/80">
                    <span className="text-[10px] text-slate-400">
                      🛡️ Auto-TSL to Cost at 70% Target · Reversal Shield Active
                    </span>
                    <button
                      onClick={() => deployIntradayTrade(op)}
                      className={`px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer shadow-lg transition ${
                        isLong
                          ? "bg-emerald-500/25 hover:bg-emerald-500/35 text-emerald-200 border border-emerald-500/50"
                          : "bg-rose-500/25 hover:bg-rose-500/35 text-rose-200 border border-rose-500/50"
                      }`}
                    >
                      <Zap className="w-3.5 h-3.5" />
                      <span>
                        ⚡ Deploy Intraday {op.direction} (@ ₹{exactLtp})
                      </span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* TAB 2: ACTIVE INTRADAY TRADES & SMART EXIT SHIELD */}
      {activeSubTab === "ACTIVE_TRADES" && (
        <div className="space-y-4">
          <div className="bg-[#0d1322] border border-violet-500/30 rounded-2xl p-5 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div>
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  <ShieldCheck className="w-5 h-5 text-emerald-400" />
                  ACTIVE INTRADAY POSITIONS ({activeTrades.length}) • SMART REVERSAL &amp; 70% TSL-TO-COST SHIELD
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Automatically locks Stop-Loss to Cost (Breakeven) at 70% target distance and auto-exits on confirmed volume exhaustion reversals or breaking negative news.
                </p>
              </div>
              <div className="flex items-center gap-2.5">
                <button
                  onClick={() => runNewsScan()}
                  disabled={isScanningNews || activeTrades.length === 0}
                  className="px-3 py-1.5 rounded-xl bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border border-emerald-500/40 text-xs font-bold flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                  title={lastNewsScanIst ? `AI Sentiment Shield last scanned at ${lastNewsScanIst}` : "Scan live financial news & reversal catalysts for all active intraday trades"}
                >
                  <ShieldCheck className={`w-3.5 h-3.5 ${isScanningNews ? "animate-pulse text-amber-300" : "text-emerald-400"}`} />
                  <span>{isScanningNews ? "Scanning News..." : "🛡️ AI News Shield"}</span>
                </button>
                <button
                  onClick={() => fetchIntradayScanner(true)}
                  className="px-3 py-1.5 rounded-xl bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? "animate-spin" : ""}`} />
                  <span>Sync Live LTP</span>
                </button>
              </div>
            </div>

            {activeTrades.length === 0 ? (
              <div className="p-12 rounded-xl bg-slate-900/60 border border-slate-800 text-center text-slate-400 space-y-2">
                <p className="text-sm font-bold text-slate-200">No active intraday trades running.</p>
                <p className="text-xs text-slate-500">
                  Switch to the <strong>⚡ ORB &amp; VWAP Scanner</strong> tab and deploy any Intraday LONG or SHORT setup.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-950/70">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-slate-800 bg-slate-900/90 text-[10px] uppercase text-slate-400">
                      <th className="py-3 px-3">Symbol &amp; Side</th>
                      <th className="py-3 px-3">Locked Entry</th>
                      <th className="py-3 px-3">Live LTP</th>
                      <th className="py-3 px-3">Smart Stop-Loss (70% Cost Lock)</th>
                      <th className="py-3 px-3">Target &amp; Progress</th>
                      <th className="py-3 px-3">Live P&amp;L</th>
                      <th className="py-3 px-3">Smart Reversal / News Shield</th>
                      <th className="py-3 px-3 text-right">Emergency Exit &amp; Shield Sim</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/70">
                    {activeTrades.map((tr) => {
                      const cleanSym = tr.cleanSymbol.toUpperCase();
                      const exactLtp = Number(
                        (livePrices[cleanSym] ?? tr.currentMarketPrice ?? tr.entryPrice).toFixed(2)
                      );
                      const isLong = tr.direction === "LONG";
                      const exactPnlAmount = Math.round(
                        isLong
                          ? (exactLtp - tr.entryPrice) * tr.quantity
                          : (tr.entryPrice - exactLtp) * tr.quantity
                      );
                      const exactPnlPercent = Number(
                        (((isLong ? exactLtp - tr.entryPrice : tr.entryPrice - exactLtp) /
                          Math.max(1, tr.entryPrice)) *
                          100).toFixed(2)
                      );
                      const progressClamped = Math.max(0, Math.min(100, tr.targetProgressPct));

                      return (
                        <tr key={tr.tradeId} className="hover:bg-slate-900/60 transition-colors">
                          <td className="py-3.5 px-3">
                            <div className="flex items-center gap-1.5 font-bold text-white text-sm">
                              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                              <span>{cleanSym}</span>
                              <span
                                className={`text-[9px] px-1.5 py-0.5 rounded font-bold ${
                                  isLong
                                    ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40"
                                    : "bg-rose-500/20 text-rose-300 border border-rose-500/40"
                                }`}
                              >
                                {tr.direction}
                              </span>
                            </div>
                            <div className="text-[10px] text-cyan-300 mt-0.5">{tr.strategyUsed}</div>
                            <div className="text-[10px] text-slate-500">
                              {tr.quantity} sh · ₹{tr.allocatedCapital.toLocaleString("en-IN")} · SqOff 3:15 PM
                            </div>
                          </td>

                          <td className="py-3.5 px-3 font-bold text-cyan-300">₹{tr.entryPrice}</td>

                          <td className="py-3.5 px-3">
                            <div className="font-extrabold text-white text-sm flex items-center gap-1">
                              <span>₹{exactLtp}</span>
                              <span className="text-[9px] px-1 py-0.2 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                                LIVE
                              </span>
                            </div>
                            {tr.lastLtpSyncAt && (
                              <div className="text-[10px] text-slate-500">Tick {tr.lastLtpSyncAt}</div>
                            )}
                          </td>

                          <td className="py-3.5 px-3">
                            <div
                              className={`font-bold flex items-center gap-1 ${
                                tr.isTslCostLocked ? "text-amber-300" : "text-rose-400"
                              }`}
                            >
                              {tr.isTslCostLocked && <Lock className="w-3 h-3 text-amber-400" />}
                              <span>₹{tr.stopLossPrice}</span>
                            </div>
                            <div className="text-[10px] text-slate-400">{tr.tslStatusLabel}</div>
                          </td>

                          <td className="py-3.5 px-3">
                            <div className="font-bold text-emerald-400">₹{tr.targetPrice}</div>
                            <div className="w-28 h-1.5 bg-slate-800 rounded-full overflow-hidden mt-1">
                              <div
                                className={`h-full transition-all ${
                                  tr.isTslCostLocked ? "bg-amber-400" : "bg-emerald-400"
                                }`}
                                style={{ width: `${progressClamped}%` }}
                              />
                            </div>
                            <div className="text-[10px] text-slate-400 mt-0.5">
                              {tr.targetProgressPct}% to Target (70% = Cost Lock)
                            </div>
                          </td>

                          <td className="py-3.5 px-3">
                            <div
                              className={`font-bold text-sm ${
                                exactPnlAmount >= 0 ? "text-emerald-400" : "text-rose-400"
                              }`}
                            >
                              {exactPnlAmount >= 0 ? "+" : ""}₹{exactPnlAmount.toLocaleString("en-IN")}
                            </div>
                            <div
                              className={`text-[10px] font-bold ${
                                exactPnlPercent >= 0 ? "text-emerald-400" : "text-rose-400"
                              }`}
                            >
                              {exactPnlPercent >= 0 ? "+" : ""}
                              {exactPnlPercent}%
                            </div>
                          </td>

                          <td className="py-3.5 px-3">
                            <div className="flex items-center gap-1.5 flex-wrap mb-1">
                              <span
                                className={`text-[10px] px-2 py-0.5 rounded-full font-bold border ${
                                  aiShieldReports[cleanSym]?.shieldStatus === "CATALYST_ALERT" ||
                                  aiShieldReports[cleanSym]?.shieldStatus === "CRITICAL_NEWS_EXIT" ||
                                  aiShieldReports[cleanSym]?.shieldStatus === "EXHAUSTION_REVERSAL_EXIT"
                                    ? "bg-amber-500/20 text-amber-300 border-amber-500/40 animate-pulse"
                                    : "bg-emerald-500/15 text-emerald-300 border-emerald-500/30"
                                }`}
                                title={aiShieldReports[cleanSym]?.topHeadline || "AI Sentiment Shield status"}
                              >
                                AI Shield: {aiShieldReports[cleanSym]?.badgeText || "🟢 Clean"}
                              </span>
                            </div>
                            <span className="text-[10px] px-2 py-1 rounded-lg bg-slate-900 border border-slate-700 text-cyan-300 font-bold block">
                              {tr.liveSentimentBadge}
                            </span>
                            {aiShieldReports[cleanSym]?.topHeadline && (
                              <div
                                className="text-[10px] text-slate-400 max-w-[210px] truncate mt-1"
                                title={aiShieldReports[cleanSym]?.topHeadline}
                              >
                                {aiShieldReports[cleanSym]?.topHeadline}
                              </div>
                            )}
                            <div className="flex items-center gap-1 mt-1.5 flex-wrap">
                              <button
                                onClick={() => triggerSmartShieldTest(tr, "LOCK_70_COST")}
                                className="text-[9px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40 hover:bg-amber-500/30 cursor-pointer"
                                title="Simulate price reaching >=70% of target distance to verify automatic TSL-to-Cost (Breakeven)"
                              >
                                Sim 70% TSL→Cost
                              </button>
                              <button
                                onClick={() => triggerSmartShieldTest(tr, "REVERSAL_EXIT")}
                                className="text-[9px] px-1.5 py-0.5 rounded bg-violet-500/20 text-violet-300 border border-violet-500/40 hover:bg-violet-500/30 cursor-pointer"
                                title="Simulate near-target volume exhaustion reversal auto-exit"
                              >
                                Sim Reversal Exit
                              </button>
                              <button
                                onClick={() => triggerSmartShieldTest(tr, "NEWS_TRIGGER_EXIT")}
                                className="text-[9px] px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-300 border border-rose-500/40 hover:bg-rose-500/30 cursor-pointer"
                                title="Simulate breaking negative news auto-exit"
                              >
                                Sim News Exit
                              </button>
                            </div>
                          </td>

                          <td className="py-3.5 px-3 text-right">
                            <button
                              onClick={() => handleEmergencySquareOffNow(tr.tradeId, "MANUAL_EMERGENCY_EXIT")}
                              className="px-3 py-2 rounded-xl bg-gradient-to-r from-rose-600 to-orange-600 hover:from-rose-500 hover:to-orange-500 text-white border border-rose-400/50 text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer shadow-lg shadow-rose-600/20"
                              title="Instantly lock current live P&L, archive to Backtest History, and free up capital"
                            >
                              <Zap className="w-3.5 h-3.5 text-amber-200" />
                              <span>⚡ Emergency Exit / Square-off Now</span>
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
        </div>
      )}

      {/* TAB 3: LIVE NEWS & REVERSAL READER */}
      {activeSubTab === "NEWS_REVERSAL_READER" && (
        <div className="bg-[#0d1322] border border-amber-500/30 rounded-2xl p-5 space-y-4 shadow-2xl">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Newspaper className="w-5 h-5 text-amber-400" />
                REAL-TIME NEWS, ORDERFLOW &amp; VOLUME EXHAUSTION REVERSAL READER
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Continuously monitors NSE orderflow delta, near-target exhaustion wicks (e.g., SOLARINDS), and breaking headlines for active trades.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
            {newsFeed.map((item) => {
              const cleanSym = item.symbol.toUpperCase().replace(/\.NS$/i, "").replace(/\.BO$/i, "");
              const aiReport = aiShieldReports[cleanSym];
              const headlineText = aiReport?.topHeadline || item.headline;
              const sourceText = aiReport?.topPublisher || item.source;
              const timestampText = aiReport?.lastContentChangeIst || aiReport?.evaluatedAtIst || item.publishedAtIst;
              const isAlert =
                aiReport?.shieldStatus === "CATALYST_ALERT" ||
                aiReport?.shieldStatus === "CRITICAL_NEWS_EXIT" ||
                aiReport?.shieldStatus === "EXHAUSTION_REVERSAL_EXIT" ||
                item.sentiment === "EXHAUSTION_ALERT" ||
                item.sentiment === "NEGATIVE_CATALYST";

              return (
                <div
                  key={item.id}
                  className={`p-4 rounded-xl bg-slate-900/90 border space-y-2 transition-all ${
                    isAlert
                      ? "border-rose-500/50 shadow-lg shadow-rose-950/20"
                      : "border-slate-800 hover:border-slate-700"
                  }`}
                >
                  <div className="flex items-center justify-between flex-wrap gap-1.5">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-white">{cleanSym}</span>
                      {aiReport && (
                        <span
                          className={`text-[9px] px-2 py-0.5 rounded-full font-bold border ${
                            isAlert
                              ? "bg-amber-500/20 text-amber-300 border-amber-500/40"
                              : "bg-emerald-500/15 text-emerald-300 border-emerald-500/30"
                          }`}
                        >
                          {aiReport.badgeText}
                        </span>
                      )}
                    </div>
                    <span
                      className={`text-[10px] px-2 py-0.5 rounded font-bold border ${
                        item.sentiment === "BULLISH"
                          ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/40"
                          : item.sentiment === "EXHAUSTION_ALERT"
                          ? "bg-amber-500/20 text-amber-300 border-amber-500/40"
                          : "bg-rose-500/20 text-rose-300 border-rose-500/40"
                      }`}
                    >
                      {item.sentiment} · Impact {item.impactScore}/100
                    </span>
                  </div>
                  <p className="text-xs font-bold text-slate-100 leading-snug">{headlineText}</p>
                  <p className="text-[11px] text-slate-400">{item.summary}</p>
                  <div className="text-[10px] text-slate-500 flex justify-between pt-1 border-t border-slate-800/80">
                    <span className="text-cyan-400/90 font-medium">{sourceText}</span>
                    <span>{timestampText} IST</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* TAB 4: INTRADAY BACKTEST & AUDIT HISTORY */}
      {activeSubTab === "HISTORY" && (
        <div className="bg-[#0d1322] border border-emerald-500/30 rounded-2xl p-5 space-y-4 shadow-2xl">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <History className="w-5 h-5 text-emerald-400" />
                INTRADAY BACKTEST HISTORY &amp; SMART EXIT AUDIT LEDGER ({historyTrades.length})
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Complete audit trail of closed intraday trades including REVERSAL_EXIT, NEWS_TRIGGER_EXIT, TSL_COST_BREAKEVEN_EXIT, and MANUAL_EMERGENCY_EXIT.
              </p>
            </div>
            {historyTrades.length > 0 && (
              <button
                onClick={() => {
                  if (confirm("Clear intraday backtest history?")) setHistoryTrades([]);
                }}
                className="px-3 py-1.5 rounded-lg bg-slate-800 text-slate-400 hover:text-rose-400 text-xs flex items-center gap-1.5 cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Clear History</span>
              </button>
            )}
          </div>

          {historyTrades.length === 0 ? (
            <div className="p-10 rounded-xl bg-slate-900/60 border border-slate-800 text-center text-xs text-slate-400">
              No closed intraday trades yet.
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-950/60">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-800 bg-slate-900/90 text-[10px] uppercase text-slate-400">
                    <th className="py-3 px-3">Symbol &amp; Side</th>
                    <th className="py-3 px-3">Entry → Exit</th>
                    <th className="py-3 px-3">Qty / Capital</th>
                    <th className="py-3 px-3">Audit Exit Tag</th>
                    <th className="py-3 px-3">Smart Shield Reason</th>
                    <th className="py-3 px-3">Realized P&amp;L</th>
                    <th className="py-3 px-3">Timestamps</th>
                    <th className="py-3 px-3 text-right">Exit Audit</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/70">
                  {historyTrades.map((tr) => (
                    <tr
                      key={tr.tradeId}
                      onClick={() => setSelectedExitAuditTrade(tr as any)}
                      className="hover:bg-cyan-500/10 cursor-pointer group transition-colors"
                      title="Click to view interactive Trade Exit Audit Modal"
                    >
                      <td className="py-3 px-3">
                        <div className="font-bold text-white flex items-center gap-1.5">
                          <span>{tr.cleanSymbol}</span>
                          <span className="text-[10px] text-cyan-400 opacity-0 group-hover:opacity-100 transition-opacity">
                            🔍 Audit
                          </span>
                        </div>
                        <div className="text-[10px] text-cyan-300">
                          {tr.direction} · {tr.strategyUsed}
                        </div>
                      </td>
                      <td className="py-3 px-3 font-bold text-slate-200">
                        ₹{tr.entryPrice} → ₹{tr.currentMarketPrice}
                      </td>
                      <td className="py-3 px-3">
                        <div className="font-bold text-slate-200">{tr.quantity} sh</div>
                        <div className="text-[10px] text-slate-400">
                          ₹{tr.allocatedCapital.toLocaleString("en-IN")}
                        </div>
                      </td>
                      <td className="py-3 px-3">
                        <span
                          className={`text-[10px] px-2 py-0.5 rounded font-bold border ${
                            tr.auditTag === "REVERSAL_EXIT" || tr.auditTag === "NEWS_TRIGGER_EXIT"
                              ? "bg-amber-500/20 text-amber-300 border-amber-500/40"
                              : tr.pnlAmount >= 0
                              ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/40"
                              : "bg-rose-500/20 text-rose-300 border-rose-500/40"
                          }`}
                        >
                          {tr.auditTag || tr.status}
                        </span>
                      </td>
                      <td className="py-3 px-3 text-[11px] text-slate-300 max-w-xs">
                        {tr.exitReason || "Settled"}
                      </td>
                      <td className="py-3 px-3">
                        <div
                          className={`font-bold text-sm ${
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
                      </td>
                      <td className="py-3 px-3 text-[10px] text-slate-400">
                        <div>In: {tr.executionTime}</div>
                        <div>Out: {tr.exitTime}</div>
                      </td>
                      <td className="py-3 px-3 text-right">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedExitAuditTrade(tr as any);
                          }}
                          className="px-2.5 py-1.5 rounded-lg bg-cyan-500/15 text-cyan-300 hover:bg-cyan-500/25 border border-cyan-500/30 text-[11px] font-bold inline-flex items-center gap-1 cursor-pointer shadow-sm transition group-hover:scale-105"
                          title="Open Interactive Trade Exit Audit Log"
                        >
                          <Search className="w-3.5 h-3.5 text-cyan-400" />
                          <span>🔍 View Exit Audit Log</span>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
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

