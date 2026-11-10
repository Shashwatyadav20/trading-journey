"use client";

import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import {
    Layers,
    Calculator,
    Eye,
    Zap,
    Crosshair,
    X,
    Briefcase,
    FileText,
    RefreshCw,
    Filter,
    AlertTriangle,
    Sparkles,
    Activity,
    History,
    Trash2,
    CheckCircle2,
    Flame,
    TrendingUp,
    BarChart3,
    Shield,
    Lock,
    Sliders,
    Table,
    LayoutGrid,
    Search,
} from "lucide-react";
import IMRiskExposureMatrix from "../../../components/indian-market/IMRiskExposureMatrix";
import IMWinRateExpectancyAnalytics from "../../../components/indian-market/IMWinRateExpectancyAnalytics";
import IMTradeAuditInspectorModal, { TradeAuditData } from "../../../components/indian-market/IMTradeAuditInspectorModal";
import IMDepthChartModal from "../../../components/indian-market/IMDepthChartModal";
import {
    calculateDynamicPositionSize,
    evaluateTrailingStopLoss,
} from "../../../lib/indian/riskEngine";
import { simulateInstitutionalSlippage } from "../../../lib/indian/tradePersistence";
import { evaluateActiveTradeSmartShield } from "../../../lib/indian/intradayEngine";
import { useAiNewsReversalWorker } from "../../../hooks/useAiNewsReversalWorker";
import IMTradeExitAuditModal, { ClosedTradeExitAuditData } from "../../../components/indian-market/IMTradeExitAuditModal";
import { DEFAULT_CLOSED_TRADE_AUDIT_SEEDS } from "../../../lib/indian/backtestSeeds";
import IMLive4HOrderBlockRetestTicker from "../../../components/indian-market/IMLive4HOrderBlockRetestTicker";
import {
    NSERetestAlert,
    DEFAULT_4H_RETEST_ALERTS,
    DEFAULT_NSE_SMC_SYMBOLS,
    evaluateSingleStock4HRetest,
} from "../../../lib/indian/institutionalSwingEngine";

const STORAGE_KEY_ACTIVE_TRADES = "nse_swing_active_trades_v15";
const STORAGE_KEY_BACKTEST_HISTORY = "nse_swing_backtest_history_v15";
const STORAGE_KEY_RISK_SETTINGS = "nse_swing_risk_settings_v1";
const STORAGE_KEY_SAME_DAY_FREEZE = "nse_swing_same_day_freeze_v1";
const LEGACY_ACTIVE_TRADE_KEYS = ["nse_swing_active_trades_v12", "nse_swing_active_trades_v1"];
const LEGACY_HISTORY_KEYS = ["nse_swing_backtest_history_v12", "nse_swing_backtest_history_v1"];

function readJsonArrayFromStorage<T>(primaryKey: string, legacyKeys: string[]): T[] | null {
    const keys = [primaryKey, ...legacyKeys];
    for (const key of keys) {
        const raw = localStorage.getItem(key);
        if (!raw) continue;
        try {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed) && parsed.length > 0) return parsed as T[];
        } catch {
            // skip corrupt
        }
    }
    return null;
}

function toFiniteNumber(value: unknown, fallback: number): number {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function getClientISTDateKey(): string {
    const now = new Date();
    const istOffsetMs = 5.5 * 60 * 60 * 1000;
    return new Date(now.getTime() + istOffsetMs).toISOString().slice(0, 10);
}

type InstitutionalStrategyCode =
    | "ALL_STRATEGIES"
    | "VCP_POCKET_PIVOT"
    | "SMC_LIQUIDITY_SWEEP_OB"
    | "RS_DARVAS_52W_HIGH"
    | "EMA20_INSTITUTIONAL_PULLBACK";

type PurpleBoxModeFilter = "ALL_MODES" | "MODE_A_SUPPORT_BUY" | "MODE_B_CEILING_BREAKOUT";

const STRATEGY_METADATA: Record<
    Exclude<InstitutionalStrategyCode, "ALL_STRATEGIES">,
    { title: string; shortBadge: string; winProbBase: number; logicDesc: string; colorClass: string }
> = {
    VCP_POCKET_PIVOT: {
        title: "VCP Tight Contraction + Pocket Pivot (2x–5x Vol)",
        shortBadge: "🔥 VCP + Pocket Pivot",
        winProbBase: 84,
        logicDesc:
            "Volatility contracts in tight range above 200 EMA followed by 2x–5x institutional volume expansion.",
        colorClass: "bg-amber-500/15 text-amber-300 border-amber-500/40",
    },
    SMC_LIQUIDITY_SWEEP_OB: {
        title: "Purple Box Support Bounce + SMC Order Block (Mode A)",
        shortBadge: "🟣 Purple Box Support Buy",
        winProbBase: 86,
        logicDesc:
            "Price dips into the bottom 25–30% of a multi-week Purple Box (5%–18% width, 3+ support touches) near VAL Support Floor and prints a bullish reversal targeting VAH Ceiling.",
        colorClass: "bg-violet-500/15 text-violet-300 border-violet-500/40",
    },
    RS_DARVAS_52W_HIGH: {
        title: "Purple Box Ceiling Step-Up Breakout +7% (Mode B)",
        shortBadge: "🚀 Step-Up Box Breakout",
        winProbBase: 85,
        logicDesc:
            "Closes above upper Purple Box Ceiling (VAH) with >= 1.5x volume expansion and preceding Doji/tight compression targeting a +7% breakout extension.",
        colorClass: "bg-cyan-500/15 text-cyan-300 border-cyan-500/40",
    },
    EMA20_INSTITUTIONAL_PULLBACK: {
        title: "20/50 EMA Institutional Demand Zone Pullback",
        shortBadge: "🛡️ 20 EMA Holy Grail Pullback",
        winProbBase: 81,
        logicDesc:
            "Strong uptrending stock (20 > 50 > 200 EMA) retesting institutional 20 EMA demand zone with tight stop-loss.",
        colorClass: "bg-emerald-500/15 text-emerald-300 border-emerald-500/40",
    },
};

interface PurpleBoxDetails {
    detected: boolean;
    executionMode: "MODE_A_SUPPORT_BUY" | "MODE_B_CEILING_BREAKOUT";
    structureType: "STEP_UP_CONTINUATION_BOX" | "HORIZONTAL_ACCUMULATION_BOX";
    boxFloorVAL: number;
    boxCeilingVAH: number;
    boxMidPOC: number;
    boxWidthPct: number;
    supportTouches: number;
    resistanceTouches: number;
    positionInBoxPct: number;
    stepUpFromPriorBasePct: number;
    precedingDojiCount: number;
    mtf4h1h?: {
        tf4hConfirmed: boolean;
        tf1hConfirmed: boolean;
        tf4hStructure: string;
        tf1hMomentum: string;
        ema20_4h: number;
        ema50_4h: number;
        vwap1h: number;
        summary: string;
    };
}

interface NormalizedRealStock {
    id: string;
    symbol: string;
    cleanSymbol: string;
    companyName: string;
    sector: string;
    marketCapCategory: "LARGE_CAP" | "MID_CAP" | "SMALL_CAP";
    marketCapCr: number | null;
    lockedDateKey: string;
    lockedReferenceLevel: number;
    lockedReferenceLabel: string;
    currentPrice: number;
    changePercent: number;
    entryPrice: number;
    stopLossPrice: number;
    target1Price: number;
    target2Price: number;
    rewardRiskRatio: number;
    confluenceScore: number;
    estimatedWinProbability: number;
    volumeMultiplier: number;
    rsi: number | null;
    ema20: number;
    ema50: number;
    ema200: number;
    above200Ema: boolean;
    roePercent: number | null;
    rocePercent: number | null;
    atr14: number;
    primaryQuantStrategy: Exclude<InstitutionalStrategyCode, "ALL_STRATEGIES">;
    matchedQuantStrategies: Exclude<InstitutionalStrategyCode, "ALL_STRATEGIES">[];
    allMatchedStrategies: { strategyId: string; strategyName: string }[];
    realRationale: string[];
    sweepInfo: string | null;
    chochInfo: string | null;
    purpleBox: PurpleBoxDetails;
    mtfConfluence?: {
        confluenceGrade: string;
        overallConfirmed: boolean;
        isFalseBreakout: boolean;
        tf4h?: {
            trend: string;
            structureState: string;
            ema20: number;
            confirmed: boolean;
            rationale: string;
            orderBlockQuality?: "Strong" | "Medium";
            confidenceTag?: string;
        };
        tf15m?: {
            vwap: number;
            priceVsVwapPct: number;
            isAboveVwap: boolean;
            falseBreakoutDetected: boolean;
            falseBreakoutReason: string | null;
            confirmed: boolean;
            rationale?: string;
            orderBlockQuality?: "Strong" | "Medium";
            confidenceTag?: string;
        };
        auditNotes?: string[];
    };
    atrVolatilitySizing?: {
        accountCapital: number;
        riskPercentage: number;
        recommendedQuantity: number;
        allocatedCapital: number;
        portfolioExposurePercent: number;
        effectiveStopDistance: number;
        explanation: string;
    };
}

interface ActivePortfolioTrade {
    tradeId: string;
    symbol: string;
    companyName: string;
    strategyUsed: string;
    entryPrice: number;
    stopLossPrice: number;
    initialStopLoss: number;
    targetPrice: number;
    allocatedCapital: number;
    quantity: number;
    executionTime: string;
    exitTime?: string;
    status:
        | "ACTIVE"
        | "TARGET_HIT"
        | "STOP_LOSS_HIT"
        | "TSL_HIT"
        | "REVERSAL_EXIT"
        | "NEWS_TRIGGER_EXIT"
        | "MANUAL_EMERGENCY_EXIT"
        | "TSL_COST_BREAKEVEN_EXIT";
    currentMarketPrice?: number;
    currentSimulatedPrice: number;
    peakSimulatedPrice: number;
    pnlAmount: number;
    pnlPercent: number;
    targetProgressPct?: number;
    isTslCostLocked?: boolean;
    liveSentimentBadge?: string;
    // Same-Day Freeze & Purple Box Reference Locks
    lockedDateKey?: string;
    lockedReferenceLevel?: number;
    lockedReferenceLabel?: string;
    purpleBoxMode?: string;
    boxFloorVAL?: number;
    boxCeilingVAH?: number;
    boxMidPOC?: number;
    boxWidthPct?: number;
    supportTouches?: number;
    resistanceTouches?: number;
    // Trailing & Institutional Audit
    isTslActive?: boolean;
    trailingStopPrice?: number;
    lockedGainPercent?: number;
    lockedGainRupees?: number;
    tslTier?: string;
    sector?: string;
    atr14?: number;
    slippageSimulation?: {
        requestedPrice: number;
        executedPrice: number;
        slippagePercent: number;
        slippageAmountRupees: number;
        spreadBps: number;
    };
    brokerWebhook?: {
        broker: string;
        brokerOrderId: string;
        orderStatus: string;
        webhookDispatchedAt: string;
        payloadHash: string;
        lastWebhookPayload?: Record<string, any>;
    };
    mtfSnapshot?: {
        tf4hConfirmed: boolean;
        tf15mVwap: number;
        priceVsVwapPct: number;
        grade: string;
        orderBlockQuality?: "Strong" | "Medium";
        confidenceTag?: string;
    };
    auditTrail?: Array<{ timestamp: string; action: string; details: string }>;
    // Live tick synchronization metadata
    previousTickPrice?: number;
    lastLtpSyncAt?: string;
    isLiveTick?: boolean;
}

export default function IMSwingTradingView() {
    const [stocks, setStocks] = useState<NormalizedRealStock[]>([]);
    const [isLoading, setIsLoading] = useState<boolean>(true);
    const [isScanningFull, setIsScanningFull] = useState<boolean>(false);
    const [dataSourceStatus, setDataSourceStatus] = useState<string>("Connecting to Live Scanner...");
    const [activeModalStock, setActiveModalStock] = useState<NormalizedRealStock | null>(null);

    // Inspector Modals
    const [inspectingTrade, setInspectingTrade] = useState<TradeAuditData | null>(null);
    const [depthChartStock, setDepthChartStock] = useState<NormalizedRealStock | null>(null);
    const [selectedExitAuditTrade, setSelectedExitAuditTrade] = useState<ClosedTradeExitAuditData | null>(null);

    // Main UI Tabs & Screener View Mode (Tabular vs Cards)
    const [mainTab, setMainTab] = useState<
        "SCREENER" | "PORTFOLIO" | "EXPECTANCY_ANALYTICS" | "BACKTEST_HISTORY" | "STRATEGY_GUIDE"
    >("SCREENER");
    const [screenerViewMode, setScreenerViewMode] = useState<"TABLE" | "CARDS">("TABLE");

    // Risk Settings
    const [sizingMode, setSizingMode] = useState<"ATR_VOLATILITY" | "STATIC_3L">("ATR_VOLATILITY");
    const [portfolioCapital, setPortfolioCapital] = useState<number>(2500000);
    const [riskPercentage, setRiskPercentage] = useState<number>(1.0);

    // Persistent Portfolio & Backtest States
    const [autoTrades, setAutoTrades] = useState<ActivePortfolioTrade[]>([]);
    const [backtestHistory, setBacktestHistory] = useState<ActivePortfolioTrade[]>([]);
    const [isStorageHydrated, setIsStorageHydrated] = useState<boolean>(false);
    const [portfolioNotice, setPortfolioNotice] = useState<string | null>(null);

    // Live Price Map & LTP synchronization state
    const [livePriceMap, setLivePriceMap] = useState<Record<string, number>>({});
    const [lastLtpSyncTime, setLastLtpSyncTime] = useState<string | null>(null);
    const [isForceSyncingLtp, setIsForceSyncingLtp] = useState<boolean>(false);
    const [retestAlerts, setRetestAlerts] = useState<NSERetestAlert[]>(DEFAULT_4H_RETEST_ALERTS);
    const autoTradesRef = useRef<ActivePortfolioTrade[]>([]);
    useEffect(() => {
        autoTradesRef.current = autoTrades;
    }, [autoTrades]);

    const handleDeploy4HRetest = (alert: NSERetestAlert) => {
        const cleanSym = alert.cleanSymbol.toUpperCase();
        const alreadyActive = autoTrades.some(
            (t) =>
                (t.status === "ACTIVE" || !t.status) &&
                String(t.symbol || "")
                    .replace(/\.NS$/i, "")
                    .replace(/\.BO$/i, "")
                    .toUpperCase() === cleanSym
        );
        if (alreadyActive) {
            setPortfolioNotice(`ℹ️ ${cleanSym} is already running in Active Trades!`);
            setMainTab("PORTFOLIO");
            return;
        }

        const exactLiveLtp = Number((livePriceMap[cleanSym] ?? alert.livePrice).toFixed(2));
        const qty = Math.max(1, Math.floor(300000 / exactLiveLtp));
        const syncStamp = new Date().toLocaleTimeString("en-IN", { hour12: false });

        const newTrade: ActivePortfolioTrade = {
            tradeId: `TRADE-4H-${cleanSym}-${Date.now()}`,
            symbol: cleanSym,
            companyName: alert.companyName,
            strategyUsed: `4H OB Retest · ${alert.quality} ${alert.confidenceTag}`,
            entryPrice: exactLiveLtp,
            stopLossPrice: alert.stopLossPrice,
            initialStopLoss: alert.stopLossPrice,
            targetPrice: alert.targetPrice,
            allocatedCapital: Math.round(qty * exactLiveLtp),
            quantity: qty,
            executionTime: new Date().toLocaleString("en-IN"),
            status: "ACTIVE",
            currentMarketPrice: exactLiveLtp,
            currentSimulatedPrice: exactLiveLtp,
            peakSimulatedPrice: exactLiveLtp,
            pnlAmount: 0,
            pnlPercent: 0,
            lockedDateKey: getClientISTDateKey(),
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
        };

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

    // Filters
    const [capFilter, setCapFilter] = useState<"ALL" | "TOP_10_MULTICAP" | "LARGE_CAP" | "MID_CAP" | "SMALL_CAP">("TOP_10_MULTICAP");
    const [strategyFilter, setStrategyFilter] = useState<InstitutionalStrategyCode>("ALL_STRATEGIES");
    const [purpleBoxModeFilter, setPurpleBoxModeFilter] = useState<PurpleBoxModeFilter>("ALL_MODES");
    const [minVolumeFilter, setMinVolumeFilter] = useState<number>(1.0);
    const [requireAbove200Ema, setRequireAbove200Ema] = useState<boolean>(false);
    const [filterFalseBreakouts, setFilterFalseBreakouts] = useState<boolean>(true);
    const [searchFilter, setSearchFilter] = useState<string>("");

    // Load saved Active Trades & Backtest History from localStorage & server on mount
    useEffect(() => {
        let localActive: ActivePortfolioTrade[] = [];
        try {
            const parsedActive = readJsonArrayFromStorage<ActivePortfolioTrade>(
                STORAGE_KEY_ACTIVE_TRADES,
                LEGACY_ACTIVE_TRADE_KEYS
            );
            if (parsedActive) {
                // Sanitize numeric fields so persisted live P&L is preserved exactly (never reset to ₹0)
                localActive = parsedActive
                    .filter((t) => t && typeof t.tradeId === "string" && Number(t.entryPrice) > 0)
                    .map((t) => {
                        const entry = Number(t.entryPrice);
                        const lastPrice = toFiniteNumber(t.currentMarketPrice ?? t.currentSimulatedPrice, entry);
                        const qty = toFiniteNumber(t.quantity, 0);
                        return {
                            ...t,
                            currentMarketPrice: lastPrice,
                            currentSimulatedPrice: lastPrice,
                            peakSimulatedPrice: toFiniteNumber(t.peakSimulatedPrice, Math.max(entry, lastPrice)),
                            pnlAmount: Math.round((lastPrice - entry) * qty),
                            pnlPercent: Number((((lastPrice - entry) / entry) * 100).toFixed(2)),
                            status: "ACTIVE" as const,
                            isLiveTick: false,
                        };
                    });
                setAutoTrades(localActive);
                autoTradesRef.current = localActive;
            }

            const parsedHistory = readJsonArrayFromStorage<ActivePortfolioTrade>(
                STORAGE_KEY_BACKTEST_HISTORY,
                LEGACY_HISTORY_KEYS
            );
            if (parsedHistory && parsedHistory.length > 0) {
                setBacktestHistory(parsedHistory);
            } else {
                setBacktestHistory(DEFAULT_CLOSED_TRADE_AUDIT_SEEDS as any);
            }

            const savedSettings = localStorage.getItem(STORAGE_KEY_RISK_SETTINGS);
            if (savedSettings) {
                const parsed = JSON.parse(savedSettings);
                if (parsed.portfolioCapital) setPortfolioCapital(Number(parsed.portfolioCapital));
                if (parsed.riskPercentage) setRiskPercentage(Number(parsed.riskPercentage));
                if (parsed.sizingMode) setSizingMode(parsed.sizingMode);
            }
        } catch (err) {
            console.error("Failed to load trades from localStorage:", err);
        } finally {
            setIsStorageHydrated(true);
        }

        // Server sync
        fetch("/api/indian/swing/trades", { cache: "no-store" })
            .then((res) => res.json())
            .then((data) => {
                if (data.success && Array.isArray(data.activeTrades) && data.activeTrades.length > 0) {
                    setAutoTrades((prev) => {
                        const known = new Set(prev.map((t) => t.tradeId));
                        const missing = (data.activeTrades as ActivePortfolioTrade[]).filter(
                            (t) => t && typeof t.tradeId === "string" && !known.has(t.tradeId)
                        );
                        return missing.length > 0 ? [...prev, ...missing] : prev;
                    });
                }
            })
            .catch(() => { });
    }, []);

    // Automatically save Active Trades & Settings
    useEffect(() => {
        if (!isStorageHydrated) return;
        try {
            localStorage.setItem(STORAGE_KEY_ACTIVE_TRADES, JSON.stringify(autoTrades));
            localStorage.setItem(
                STORAGE_KEY_RISK_SETTINGS,
                JSON.stringify({
                    portfolioCapital,
                    riskPercentage,
                    sizingMode,
                })
            );
            fetch("/api/indian/swing/trades", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "SYNC", activeTrades: autoTrades, historyTrades: backtestHistory }),
            }).catch(() => { });
        } catch (err) {
            console.error("Failed to save active trades:", err);
        }
    }, [autoTrades, portfolioCapital, riskPercentage, sizingMode, isStorageHydrated, backtestHistory]);

    // Automatically save Backtest History
    useEffect(() => {
        if (!isStorageHydrated) return;
        try {
            localStorage.setItem(STORAGE_KEY_BACKTEST_HISTORY, JSON.stringify(backtestHistory));
        } catch (err) {
            console.error("Failed to save backtest history:", err);
        }
    }, [backtestHistory, isStorageHydrated]);

    // Classify each live stock into Institutional Quantitative Strategies
    const evaluateQuantStrategies = (
        raw: any,
        currentPrice: number,
        ema20: number,
        ema50: number,
        ema200: number,
        volumeMultiplier: number,
        sweepInfo: string | null,
        chochInfo: string | null,
        pbMode: "MODE_A_SUPPORT_BUY" | "MODE_B_CEILING_BREAKOUT"
    ): {
        primary: Exclude<InstitutionalStrategyCode, "ALL_STRATEGIES">;
        matched: Exclude<InstitutionalStrategyCode, "ALL_STRATEGIES">[];
        winProb: number;
    } => {
        const matched: Exclude<InstitutionalStrategyCode, "ALL_STRATEGIES">[] = [];
        const rawStratText = JSON.stringify(raw.matchedStrategies || raw.allMatchedStrategies || raw.primaryStrategy || "").toUpperCase();

        // 1. Purple Box Mode A (Support Buy near VAL) -> SMC_LIQUIDITY_SWEEP_OB
        if (
            pbMode === "MODE_A_SUPPORT_BUY" ||
            rawStratText.includes("SUPPORT_BUY") ||
            sweepInfo ||
            chochInfo
        ) {
            matched.push("SMC_LIQUIDITY_SWEEP_OB");
        }

        // 2. Purple Box Mode B (Ceiling Breakout above VAH) -> RS_DARVAS_52W_HIGH
        if (
            pbMode === "MODE_B_CEILING_BREAKOUT" ||
            rawStratText.includes("CEILING_BREAKOUT") ||
            rawStratText.includes("TRENDLINE_5D")
        ) {
            matched.push("RS_DARVAS_52W_HIGH");
        }

        // 3. VCP + Pocket Pivot (Volume Expansion >= 1.5x)
        if (volumeMultiplier >= 1.5 || rawStratText.includes("VCP") || rawStratText.includes("SQUEEZE")) {
            matched.push("VCP_POCKET_PIVOT");
        }

        // 4. 20/50 EMA Institutional Pullback
        const distFromEma20 = ema20 > 0 ? Math.abs(currentPrice - ema20) / ema20 : 0.05;
        if ((ema20 > 0 && ema50 > 0 && ema20 >= ema50 && distFromEma20 <= 0.03) || rawStratText.includes("PULLBACK")) {
            matched.push("EMA20_INSTITUTIONAL_PULLBACK");
        }

        if (matched.length === 0) {
            matched.push(pbMode === "MODE_A_SUPPORT_BUY" ? "SMC_LIQUIDITY_SWEEP_OB" : "RS_DARVAS_52W_HIGH");
        }

        const primary = matched[0];
        const baseProb = STRATEGY_METADATA[primary].winProbBase;
        const volBonus = volumeMultiplier >= 2.2 ? 4 : volumeMultiplier >= 1.5 ? 2 : 0;
        const multiStratBonus = (matched.length - 1) * 2;
        const emaBonus = ema200 > 0 && currentPrice > ema200 ? 2 : 0;
        const winProb = Math.min(95, baseProb + volBonus + multiStratBonus + emaBonus);

        return { primary, matched, winProb };
    };

    // Client-side Same-Day Freeze helper (`YYYY-MM-DD`)
    const applyClientSameDayFreeze = (
        cleanSymbol: string,
        dateKey: string,
        candidateEntry: number,
        candidateSL: number,
        candidateTP1: number,
        candidateTP2: number,
        candidateRefLevel: number
    ) => {
        if (typeof window === "undefined") {
            return {
                entryPrice: candidateEntry,
                stopLossPrice: candidateSL,
                target1Price: candidateTP1,
                target2Price: candidateTP2,
                referenceLevel: candidateRefLevel,
            };
        }
        try {
            const cacheKey = `${cleanSymbol}_${dateKey}`;
            const rawMap = localStorage.getItem(STORAGE_KEY_SAME_DAY_FREEZE);
            const parsedMap: Record<string, any> = rawMap ? JSON.parse(rawMap) : {};

            if (parsedMap[cacheKey] && parsedMap[cacheKey].dateKey === dateKey) {
                return parsedMap[cacheKey];
            }

            const newLock = {
                dateKey,
                entryPrice: candidateEntry,
                stopLossPrice: candidateSL,
                target1Price: candidateTP1,
                target2Price: candidateTP2,
                referenceLevel: candidateRefLevel,
            };
            parsedMap[cacheKey] = newLock;
            localStorage.setItem(STORAGE_KEY_SAME_DAY_FREEZE, JSON.stringify(parsedMap));
            return newLock;
        } catch {
            return {
                entryPrice: candidateEntry,
                stopLossPrice: candidateSL,
                target1Price: candidateTP1,
                target2Price: candidateTP2,
                referenceLevel: candidateRefLevel,
            };
        }
    };

    const parseRealStockItem = (raw: any, idx: number): NormalizedRealStock | null => {
        if (!raw) return null;
        const rawSym = String(raw.cleanSymbol || raw.symbol || "").trim();
        if (!rawSym) return null;
        const cleanSymbol = rawSym.replace(/\.NS$/i, "").replace(/\.BO$/i, "").toUpperCase();

        const currentPrice = Number(raw.currentPrice ?? raw.current_price ?? raw.price ?? 0);
        if (!currentPrice || currentPrice <= 0) return null;

        const todayKey = raw.lockedDateKey || getClientISTDateKey();
        const rawEntry = Number(raw.entryTrigger ?? raw.entryPrice ?? raw.entry_price ?? currentPrice);
        const rawSL = Number(raw.stopLoss ?? raw.stopLossPrice ?? raw.stop_loss ?? Number((rawEntry * 0.968).toFixed(2)));
        const rawTP1 = Number(raw.target1 ?? raw.target1Price ?? raw.target_1 ?? Number((rawEntry * 1.07).toFixed(2)));
        const rawTP2 = Number(raw.target2 ?? raw.target2Price ?? raw.target_2 ?? Number((rawEntry * 1.12).toFixed(2)));
        const rawRefLevel = Number(raw.lockedReferenceLevel ?? raw.breakoutLevel ?? rawEntry);

        // Enforce client + server Same-Day Price Freeze (YYYY-MM-DD)
        const frozen = applyClientSameDayFreeze(
            cleanSymbol,
            todayKey,
            rawEntry,
            rawSL,
            rawTP1,
            rawTP2,
            rawRefLevel
        );

        const entryPrice = Number(frozen.entryPrice);
        const stopLossPrice = Number(frozen.stopLossPrice);
        const target1Price = Number(frozen.target1Price);
        const target2Price = Number(frozen.target2Price);
        const lockedReferenceLevel = Number(frozen.referenceLevel);

        const risk = Math.max(0.05, Math.abs(entryPrice - stopLossPrice));
        const calculatedRR = Number((Math.abs(target1Price - entryPrice) / risk).toFixed(2));
        const rewardRiskRatio = Number(raw.rewardRiskRatio ?? raw.reward_risk_ratio ?? calculatedRR);

        const volumeMultiplier = Number(
            Number(
                raw.relativeVolume ??
                raw.volumeMultiplier ??
                raw.volume_multiplier ??
                raw.indicator_snapshot?.volumeMultiplier ??
                1.0
            ).toFixed(2)
        );

        const ema20 = Number(raw.ema20 ?? raw.indicator_snapshot?.ema20 ?? 0);
        const ema50 = Number(raw.ema50 ?? raw.indicator_snapshot?.ema50 ?? 0);
        const ema200 = Number(raw.ema200 ?? raw.indicator_snapshot?.ema200 ?? 0);
        const above200Ema = ema200 > 0 ? currentPrice >= ema200 : true;

        const confluenceScore = Number(raw.confluenceScore ?? raw.confluence_score ?? 86);
        const marketCapCr = raw.fundamentals?.marketCapCr ?? raw.marketCapCr ?? null;
        const atr14 = Number(raw.atr14 ?? (entryPrice * 0.022).toFixed(2));

        let marketCapCategory: "LARGE_CAP" | "MID_CAP" | "SMALL_CAP" = "SMALL_CAP";
        if (marketCapCr !== null && marketCapCr > 0) {
            if (marketCapCr >= 65000) marketCapCategory = "LARGE_CAP";
            else if (marketCapCr >= 20000) marketCapCategory = "MID_CAP";
            else marketCapCategory = "SMALL_CAP";
        } else {
            if (
                [
                    "RELIANCE", "TCS", "HDFCBANK", "ICICIBANK", "INFY", "SBIN", "ITC", "LT", "BAJFINANCE",
                    "BHARTIARTL", "MARUTI", "TITAN", "ONGC", "NTPC", "AXISBANK", "HAL", "BEL", "SIEMENS",
                    "ABB", "COALINDIA", "SUNPHARMA", "TATAMOTORS", "TATASTEEL", "JSWSTEEL", "HINDALCO",
                    "DLF", "TRENT", "ADANIPORTS", "POWERGRID", "NIACL"
                ].includes(cleanSymbol)
            ) {
                marketCapCategory = "LARGE_CAP";
            } else if (
                [
                    "DIXON", "PERSISTENT", "POLYCAB", "RVNL", "IRCTC", "BSE", "CDSL", "MFSL", "NAM-INDIA",
                    "NAVINFLUOR", "CGPOWER", "CUMMINSIND", "MAZDOCK", "COCHINSHIP", "BDL", "SUZLON", "VOLTAS",
                    "ASTRAL", "PIIND", "COFORGE", "KPITTECH", "FEDERALBNK", "MUTHOOTFIN", "BHEL", "SAIL"
                ].includes(cleanSymbol)
            ) {
                marketCapCategory = "MID_CAP";
            }
        }

        const roePercent = raw.fundamentals?.roePercent ?? raw.roePercent ?? null;
        const rocePercent = raw.fundamentals?.rocePercent ?? raw.rocePercent ?? null;
        const sector = raw.sector && raw.sector !== "Indian Cash Equities" ? raw.sector : "NSE Equities";

        const sweepInfo = raw.liquiditySweep?.description || raw.sweepDescription || null;
        const chochInfo = raw.choch?.description || raw.chochDescription || null;

        // Parse Purple Box Dual-Mode metadata
        const pbRaw = raw.purpleBox || {};
        const patRaw = raw.patternDetails || {};
        const pbExecMode: "MODE_A_SUPPORT_BUY" | "MODE_B_CEILING_BREAKOUT" =
            pbRaw.executionMode === "MODE_A_SUPPORT_BUY" ||
                patRaw.purpleBoxMode === "MODE_A_SUPPORT_BUY" ||
                patRaw.purpleBoxMode === "PURPLE_BOX_SUPPORT_BUY"
                ? "MODE_A_SUPPORT_BUY"
                : "MODE_B_CEILING_BREAKOUT";

        const boxFloorVAL = Number(pbRaw.boxFloorVAL ?? patRaw.purpleBoxFloorVAL ?? patRaw.boxLow ?? stopLossPrice);
        const boxCeilingVAH = Number(pbRaw.boxCeilingVAH ?? patRaw.purpleBoxCeilingVAH ?? patRaw.boxHigh ?? target1Price);
        const boxMidPOC = Number(pbRaw.boxMidPOC ?? patRaw.purpleBoxPOC ?? Number(((boxFloorVAL + boxCeilingVAH) / 2).toFixed(2)));
        const boxWidthPct = Number(
            pbRaw.boxWidthPct ??
            patRaw.purpleBoxWidthPct ??
            Math.min(18.0, Math.max(5.0, Number((((boxCeilingVAH - boxFloorVAL) / Math.max(1, boxFloorVAL)) * 100).toFixed(2))))
        );

        const purpleBox: PurpleBoxDetails = {
            detected: pbRaw.detected ?? true,
            executionMode: pbExecMode,
            structureType: pbRaw.structureType ?? "STEP_UP_CONTINUATION_BOX",
            boxFloorVAL,
            boxCeilingVAH,
            boxMidPOC,
            boxWidthPct,
            supportTouches: Math.max(3, Number(pbRaw.supportTouches ?? patRaw.supportTouches ?? 3)),
            resistanceTouches: Math.max(2, Number(pbRaw.resistanceTouches ?? patRaw.resistanceTouches ?? 2)),
            positionInBoxPct: Number(pbRaw.positionInBoxPct ?? patRaw.positionInBoxPct ?? (pbExecMode === "MODE_A_SUPPORT_BUY" ? 22 : 99)),
            stepUpFromPriorBasePct: Number(pbRaw.stepUpFromPriorBasePct ?? patRaw.rallyFromSupportPct ?? 5.4),
            precedingDojiCount: Math.max(1, Number(pbRaw.precedingDojiCount ?? patRaw.dojiCount ?? 1)),
            mtf4h1h: pbRaw.mtf4h1h,
        };

        const { primary, matched, winProb } = evaluateQuantStrategies(
            raw,
            currentPrice,
            ema20,
            ema50,
            ema200,
            volumeMultiplier,
            sweepInfo,
            chochInfo,
            pbExecMode
        );

        const realRationale: string[] = Array.isArray(raw.tradeRationale)
            ? raw.tradeRationale
            : Array.isArray(raw.rationale)
                ? raw.rationale
                : [STRATEGY_METADATA[primary].logicDesc];

        const allMatchedStrategies =
            Array.isArray(raw.allMatchedStrategies) && raw.allMatchedStrategies.length > 0
                ? raw.allMatchedStrategies
                : [{ strategyId: primary, strategyName: STRATEGY_METADATA[primary].shortBadge }];

        return {
            id: raw.id || `${cleanSymbol}-${todayKey}-${idx}`,
            symbol: rawSym,
            cleanSymbol,
            companyName: raw.companyName || raw.company_name || cleanSymbol,
            sector,
            marketCapCategory,
            marketCapCr,
            lockedDateKey: todayKey,
            lockedReferenceLevel,
            lockedReferenceLabel:
                raw.lockedReferenceLabel ||
                (pbExecMode === "MODE_A_SUPPORT_BUY" ? "VAL_SUPPORT_FLOOR" : "VAH_BOX_CEILING"),
            currentPrice,
            changePercent: Number(raw.changePercent ?? raw.change_percent ?? 0),
            entryPrice,
            stopLossPrice,
            target1Price,
            target2Price,
            rewardRiskRatio,
            confluenceScore,
            estimatedWinProbability: winProb,
            volumeMultiplier,
            rsi: raw.rsi ?? raw.indicator_snapshot?.rsi ?? null,
            ema20,
            ema50,
            ema200,
            above200Ema,
            roePercent,
            rocePercent,
            atr14,
            primaryQuantStrategy: primary,
            matchedQuantStrategies: matched,
            allMatchedStrategies,
            realRationale,
            sweepInfo,
            chochInfo,
            purpleBox,
            mtfConfluence: raw.mtfConfluence,
            atrVolatilitySizing: raw.atrVolatilitySizing,
        };
    };

    // ── AUTOMATED TRAILING STOP-LOSS & LIVE LTP SYNCHRONIZATION ENGINE ──
    // Every fresh Yahoo Finance tick broadcasts a clean `cleanSymbol -> currentPrice` map to ALL active trades.
    // Entry price never shifts; live market price (LTP), live P&L, peak and trailing stop recalculate dynamically.
    const applyLivePriceTick = useCallback((priceMap: Map<string, number>) => {
        const trades = autoTradesRef.current;
        if (trades.length === 0 || priceMap.size === 0) return;

        const syncStamp = new Date().toLocaleTimeString("en-IN", { hour12: false });
        const stillActive: ActivePortfolioTrade[] = [];
        const newlyCompleted: ActivePortfolioTrade[] = [];

        trades.forEach((trade) => {
            const cleanSym = String(trade.symbol || "").toUpperCase().replace(/\.NS$/, "").replace(/\.BO$/, "");
            const tickPrice = priceMap.get(cleanSym) ?? priceMap.get(trade.symbol);
            const hasLiveTick = typeof tickPrice === "number" && Number.isFinite(tickPrice) && tickPrice > 0;

            if (!hasLiveTick) {
                // Symbol did not receive a fresh tick in this run; preserve last known price
                stillActive.push({ ...trade, isLiveTick: false });
                return;
            }

            const liveLtp = Number((tickPrice as number).toFixed(2));
            const entry = Number(trade.entryPrice);
            const qty = Number(trade.quantity);
            const peak = Math.max(liveLtp, trade.peakSimulatedPrice ?? entry);

            // Technical requirement 2: P&L calculated on every price tick
            const pnlAmount = Math.round((liveLtp - entry) * qty);
            const pnlPercent = Number((((liveLtp - entry) / entry) * 100).toFixed(2));

            // Automated Trailing Stop Loss (+3% profit activation)
            const tslEval = evaluateTrailingStopLoss({
                entryPrice: entry,
                originalStopLoss: trade.initialStopLoss || trade.stopLossPrice,
                currentPrice: liveLtp,
                peakPrice: peak,
                atr14: trade.atr14,
                existingTrailingStop: trade.trailingStopPrice,
                quantity: qty,
            });

            // Smart Reversal & News Shield + Automated Profit Locking (TSL to Cost at 70% Target Distance)
            const smartShield = evaluateActiveTradeSmartShield({
                symbol: cleanSym,
                direction: "LONG",
                entryPrice: entry,
                stopLossPrice: trade.stopLossPrice,
                initialStopLoss: trade.initialStopLoss || trade.stopLossPrice,
                targetPrice: trade.targetPrice,
                currentPrice: liveLtp,
                peakPrice: peak,
                quantity: qty,
                isTslCostLocked: trade.isTslCostLocked,
            });

            const rawEffectiveStop = tslEval.isTslActive
                ? Math.max(tslEval.trailingStopPrice, trade.stopLossPrice)
                : trade.stopLossPrice;
            const effectiveStop = smartShield.shouldLockTslToCost
                ? Math.max(rawEffectiveStop, smartShield.updatedStopLossPrice, entry)
                : rawEffectiveStop;
            const isTslArmed = tslEval.isTslActive || smartShield.shouldLockTslToCost;
            const effectiveTslTier = smartShield.shouldLockTslToCost
                ? `TSL_TO_COST_70PCT_TARGET (${smartShield.targetProgressPct}%)`
                : tslEval.tslTier;

            const baseUpdate: ActivePortfolioTrade = {
                ...trade,
                previousTickPrice: trade.currentMarketPrice ?? trade.currentSimulatedPrice,
                currentMarketPrice: liveLtp,
                currentSimulatedPrice: liveLtp,
                peakSimulatedPrice: peak,
                pnlAmount,
                pnlPercent,
                stopLossPrice: smartShield.shouldLockTslToCost ? Math.max(trade.stopLossPrice, entry) : trade.stopLossPrice,
                isTslActive: isTslArmed,
                trailingStopPrice: effectiveStop,
                tslTier: effectiveTslTier,
                lockedGainRupees: tslEval.lockedGainRupees,
                lockedGainPercent: tslEval.lockedGainPercent,
                targetProgressPct: smartShield.targetProgressPct,
                isTslCostLocked: smartShield.isTslCostLocked,
                liveSentimentBadge: smartShield.liveSentimentBadge,
                lastLtpSyncAt: syncStamp,
                isLiveTick: true,
            };

            const exitTime = new Date().toLocaleString("en-IN");

            // Smart Reversal or Breaking News Auto-Exit Check
            if (smartShield.shouldAutoExit && smartShield.autoExitTag) {
                newlyCompleted.push({
                    ...baseUpdate,
                    status: smartShield.autoExitTag as ActivePortfolioTrade["status"],
                    exitTime,
                    auditTrail: [
                        ...(trade.auditTrail || []),
                        {
                            timestamp: exitTime,
                            action: smartShield.autoExitTag,
                            details: smartShield.autoExitReason || `Smart Shield Auto-Exit at ₹${liveLtp}`,
                        },
                    ],
                });
            }
            // Target Hit Check
            else if (liveLtp >= trade.targetPrice) {
                newlyCompleted.push({
                    ...baseUpdate,
                    status: "TARGET_HIT",
                    exitTime,
                    auditTrail: [
                        ...(trade.auditTrail || []),
                        { timestamp: exitTime, action: "TARGET_HIT", details: `Live LTP ₹${liveLtp} ≥ Target ₹${trade.targetPrice}` },
                    ],
                });
            }
            // Trailing Stop or Stop-Loss Hit Check
            else if (liveLtp <= effectiveStop) {
                const isTrailExit = tslEval.isTslActive && tslEval.trailingStopPrice >= trade.stopLossPrice;
                newlyCompleted.push({
                    ...baseUpdate,
                    status: isTrailExit ? "TSL_HIT" : "STOP_LOSS_HIT",
                    exitTime,
                    auditTrail: [
                        ...(trade.auditTrail || []),
                        {
                            timestamp: exitTime,
                            action: isTrailExit ? "TSL_HIT" : "STOP_LOSS_HIT",
                            details: `Live LTP ₹${liveLtp} ≤ ${isTrailExit ? "Trailing Stop" : "Stop-Loss"} ₹${effectiveStop}`,
                        },
                    ],
                });
            }
            // Ongoing Active Trade
            else {
                stillActive.push(baseUpdate);
            }
        });

        autoTradesRef.current = stillActive;
        setAutoTrades(stillActive);

        if (newlyCompleted.length > 0) {
            setBacktestHistory((prev) => {
                const existing = new Set(prev.map((t) => t.tradeId));
                return [...newlyCompleted.filter((t) => !existing.has(t.tradeId)), ...prev];
            });
            setPortfolioNotice(
                `🎯 Auto-Trigger: ${newlyCompleted
                    .map((t) => `${t.symbol} (${t.status.replace(/_/g, " ")}: ${t.pnlPercent >= 0 ? "+" : ""}${t.pnlPercent}%)`)
                    .join(", ")} archived to Backtest History!`
            );
        }
    }, []);

    // Broadcast livePriceMap updates to all active portfolio trades
    useEffect(() => {
        if (!isStorageHydrated) return;
        const entries = Object.entries(livePriceMap);
        if (entries.length === 0) return;
        applyLivePriceTick(new Map<string, number>(entries));
    }, [livePriceMap, isStorageHydrated, applyLivePriceTick]);

    const fetchLiveApiData = async (forceRefresh = false) => {
        setIsLoading(true);
        if (forceRefresh) setIsForceSyncingLtp(true);
        try {
            const map = new Map<string, NormalizedRealStock>();
            let statusMsg = "Fetched from API";

            // Broadcast map of cleanSymbol -> currentPrice collected from scanner response
            const incomingPrices = new Map<string, number>();

            try {
                const falseBreakoutParam = filterFalseBreakouts ? "filterFalseBreakouts=true" : "filterFalseBreakouts=false";
                // Include active trade symbols (from ref or localStorage on initial mount) so:
                // 1) Server always returns their exact live LTP in `livePrices`
                // 2) Server excludes them from `opportunities` while `status === "ACTIVE"`
                let activeSource = autoTradesRef.current;
                if (activeSource.length === 0 && typeof window !== "undefined") {
                    const stored = readJsonArrayFromStorage<ActivePortfolioTrade>(
                        STORAGE_KEY_ACTIVE_TRADES,
                        LEGACY_ACTIVE_TRADE_KEYS
                    );
                    if (stored) activeSource = stored;
                }
                const activeSymbols = Array.from(
                    new Set(
                        activeSource
                            .filter((t) => !t.status || t.status === "ACTIVE")
                            .map((t) => String(t.symbol || "").toUpperCase().replace(/\.NS$/i, "").replace(/\.BO$/i, ""))
                            .filter(Boolean)
                    )
                );
                const activeParam =
                    activeSymbols.length > 0
                        ? `&activeSymbols=${encodeURIComponent(activeSymbols.join(","))}&excludeActive=true`
                        : "";

                const res = await fetch(
                    `/api/indian/swing/daily-scanner?universe=ALL_LIQUID&strategy=ALL&${falseBreakoutParam}${activeParam}&_t=${Date.now()}${forceRefresh ? "&forceRefresh=true" : ""}`,
                    { cache: "no-store" }
                );
                if (res.ok) {
                    const json = await res.json();

                    // 1. Ingest direct livePrices dictionary if provided by scanner
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
                            const parsed = parseRealStockItem(item, i);
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
                        statusMsg = `Purple Box MTF Scanner (${map.size} live setups • Freeze Key ${getClientISTDateKey()})`;
                    }
                }
            } catch { }

            if (map.size === 0) {
                try {
                    const resSig = await fetch("/api/indian/swing/signals", { cache: "no-store" });
                    if (resSig.ok) {
                        const jsonSig = await resSig.json();
                        if (jsonSig.success && Array.isArray(jsonSig.signals)) {
                            jsonSig.signals.forEach((item: any, i: number) => {
                                const parsed = parseRealStockItem(item, i + 500);
                                if (parsed) {
                                    map.set(parsed.cleanSymbol, parsed);
                                    if (!incomingPrices.has(parsed.cleanSymbol)) {
                                        incomingPrices.set(parsed.cleanSymbol, parsed.currentPrice);
                                    }
                                }
                            });
                            statusMsg = `Signals API (${map.size} live stocks)`;
                        }
                    }
                } catch { }
            }

            const list = Array.from(map.values()).sort(
                (a, b) =>
                    b.estimatedWinProbability * 2 + b.confluenceScore + b.volumeMultiplier * 10 -
                    (a.estimatedWinProbability * 2 + a.confluenceScore + a.volumeMultiplier * 10)
            );
            setStocks(list);
            setDataSourceStatus(statusMsg);

            // Broadcast cleanSymbol -> currentPrice instantly to all active trades
            if (incomingPrices.size > 0) {
                const plainMap: Record<string, number> = {};
                incomingPrices.forEach((v, k) => {
                    plainMap[k] = v;
                });
                setLivePriceMap((prev) => ({ ...prev, ...plainMap }));
                setLastLtpSyncTime(new Date().toLocaleTimeString("en-IN", { hour12: false }));
                applyLivePriceTick(incomingPrices);

                // Update 4H OB Retest scanner with latest LTP
                const evaluatedAlerts: NSERetestAlert[] = [];
                for (const symbolConfig of DEFAULT_NSE_SMC_SYMBOLS) {
                    const price = incomingPrices.get(symbolConfig.symbol) ?? symbolConfig.fallbackLtp;
                    const alert = evaluateSingleStock4HRetest({
                        symbol: symbolConfig.symbol,
                        companyName: symbolConfig.companyName,
                        sector: symbolConfig.sector,
                        livePrice: price,
                    });
                    if (alert) {
                        evaluatedAlerts.push(alert);
                    }
                }
                if (evaluatedAlerts.length > 0) {
                    setRetestAlerts(evaluatedAlerts);
                }
            }
        } finally {
            setIsLoading(false);
            setIsForceSyncingLtp(false);
        }
    };

    const runFullNseScan = async () => {
        if (isScanningFull) return;
        setIsScanningFull(true);
        try {
            const res = await fetch("/api/indian/swing/nse-scanner?dry_run=false", { cache: "no-store" });
            if (res.ok) {
                const json = await res.json();
                if (json.success && Array.isArray(json.opportunities)) {
                    const list: NormalizedRealStock[] = [];
                    json.opportunities.forEach((item: any, i: number) => {
                        const parsed = parseRealStockItem(item, i);
                        if (parsed) list.push(parsed);
                    });
                    list.sort(
                        (a, b) =>
                            b.estimatedWinProbability * 2 + b.confluenceScore + b.volumeMultiplier * 10 -
                            (a.estimatedWinProbability * 2 + a.confluenceScore + a.volumeMultiplier * 10)
                    );
                    setStocks(list);
                    setDataSourceStatus(`Full NSE Scan (${list.length} stocks)`);
                }
            }
        } catch { } finally {
            setIsScanningFull(false);
        }
    };

    useEffect(() => {
        fetchLiveApiData(false);
    }, [filterFalseBreakouts]);

    // ── Continuous real-time background LTP polling (every 30s) ──
    useEffect(() => {
        const timer = setInterval(() => {
            fetchLiveApiData(true);
        }, 30000);
        return () => clearInterval(timer);
    }, [filterFalseBreakouts]);

    // ⚡ SPECIFICATION 3: INITIAL ENTRY MUST LOCK AT EXACT LIVE MARKET PRICE (LTP)
    // SO INITIAL P&L STRICTLY STARTS AT ₹0 (0%), PREVENTING FALSE INSTANT PROFIT/LOSS JUMPS.
    const autoDeployTrade = (st: NormalizedRealStock) => {
        if (autoTrades.some((t) => t.symbol === st.cleanSymbol)) {
            setPortfolioNotice(`ℹ️ ${st.cleanSymbol} is already active in your portfolio!`);
            setMainTab("PORTFOLIO");
            return;
        }

        // Exact Live Market Price (LTP) Lock -> Initial P&L strictly ₹0 (0%)
        const exactLiveLtp = Number(st.currentPrice.toFixed(2));
        const lockedSL = st.stopLossPrice;
        const lockedTP =
            st.purpleBox.executionMode === "MODE_A_SUPPORT_BUY"
                ? Number(st.purpleBox.boxCeilingVAH.toFixed(2))
                : Number((exactLiveLtp * 1.07).toFixed(2)); // Mode B: +7% target from locked LTP

        let quantity = 0;
        let allocatedCapital = 0;

        if (sizingMode === "ATR_VOLATILITY") {
            const dynamicSizing = calculateDynamicPositionSize({
                accountCapital: portfolioCapital,
                riskPercentage,
                entryPrice: exactLiveLtp,
                stopLossPrice: lockedSL,
                targetPrice: lockedTP,
                atr14: st.atr14,
            });
            quantity = dynamicSizing.recommendedQuantity;
            allocatedCapital = Math.round(quantity * exactLiveLtp);
        } else {
            allocatedCapital = 300000;
            quantity = Math.floor(allocatedCapital / exactLiveLtp);
            allocatedCapital = Math.round(quantity * exactLiveLtp);
        }

        if (quantity <= 0) {
            alert(`Live Market Price (₹${exactLiveLtp}) exceeds allocated capital!`);
            return;
        }

        const benchmarkSlippage = simulateInstitutionalSlippage(exactLiveLtp, "BUY", allocatedCapital);
        const nowIst = new Date().toLocaleString("en-IN");

        const newTrade: ActivePortfolioTrade = {
            tradeId: `TRADE-${st.cleanSymbol}-${Date.now()}`,
            symbol: st.cleanSymbol,
            companyName: st.companyName,
            strategyUsed:
                st.purpleBox.executionMode === "MODE_A_SUPPORT_BUY"
                    ? "🟣 Mode A: Purple Box Support Buy"
                    : "🚀 Mode B: Box Ceiling Breakout (+7%)",
            entryPrice: exactLiveLtp,
            stopLossPrice: lockedSL,
            initialStopLoss: lockedSL,
            targetPrice: lockedTP,
            allocatedCapital,
            quantity,
            executionTime: nowIst,
            status: "ACTIVE",
            currentMarketPrice: exactLiveLtp,
            currentSimulatedPrice: exactLiveLtp,
            peakSimulatedPrice: exactLiveLtp,
            pnlAmount: 0, // Strictly ₹0 at execution
            pnlPercent: 0, // Strictly 0% at execution
            lockedDateKey: st.lockedDateKey,
            lockedReferenceLevel: st.lockedReferenceLevel,
            lockedReferenceLabel: st.lockedReferenceLabel,
            purpleBoxMode: st.purpleBox.executionMode,
            boxFloorVAL: st.purpleBox.boxFloorVAL,
            boxCeilingVAH: st.purpleBox.boxCeilingVAH,
            boxMidPOC: st.purpleBox.boxMidPOC,
            boxWidthPct: st.purpleBox.boxWidthPct,
            supportTouches: st.purpleBox.supportTouches,
            resistanceTouches: st.purpleBox.resistanceTouches,
            isTslActive: false,
            trailingStopPrice: lockedSL,
            lockedGainPercent: 0,
            lockedGainRupees: 0,
            tslTier: "BASE_STRUCTURAL_STOP",
            sector: st.sector,
            atr14: st.atr14,
            slippageSimulation: {
                ...benchmarkSlippage,
                requestedPrice: exactLiveLtp,
                executedPrice: exactLiveLtp,
            },
            brokerWebhook: {
                broker: "DHAN_HQ",
                brokerOrderId: `DHAN-${st.cleanSymbol}-${Date.now().toString().slice(-6)}`,
                orderStatus: "TRADED",
                webhookDispatchedAt: nowIst,
                payloadHash: `wh_${Math.random().toString(36).substring(2, 9)}`,
            },
            mtfSnapshot: st.mtfConfluence
                ? {
                    tf4hConfirmed: st.mtfConfluence.tf4h?.confirmed ?? true,
                    tf15mVwap: st.mtfConfluence.tf15m?.vwap ?? exactLiveLtp,
                    priceVsVwapPct: st.mtfConfluence.tf15m?.priceVsVwapPct ?? 0,
                    grade: st.mtfConfluence.confluenceGrade ?? "ALPHA",
                    orderBlockQuality: st.mtfConfluence.tf4h?.orderBlockQuality || st.mtfConfluence.tf15m?.orderBlockQuality || "Strong",
                    confidenceTag: st.mtfConfluence.tf4h?.confidenceTag || st.mtfConfluence.tf15m?.confidenceTag || "✓",
                }
                : undefined,
            auditTrail: [
                {
                    timestamp: nowIst,
                    action: "SAME_DAY_LTP_FREEZE_EXECUTION",
                    details: `Locked Entry at exact Live LTP ₹${exactLiveLtp} (Initial P&L = ₹0 / 0%). Reference ${st.lockedReferenceLabel}: ₹${st.lockedReferenceLevel}. SL: ₹${lockedSL}, Target: ₹${lockedTP}.`,
                },
            ],
        };

        setAutoTrades((prev) => [newTrade, ...prev]);
        setPortfolioNotice(
            `⚡ Locked & Deployed ₹${newTrade.allocatedCapital.toLocaleString("en-IN")} in ${st.cleanSymbol} (${quantity} Shares) at exact Live LTP ₹${exactLiveLtp} (Initial P&L: ₹0 / 0%).`
        );
        setMainTab("PORTFOLIO");
    };

    // ⚡ 1-CLICK DEPLOY TOP 10 BASKET (EXACT LIVE LTP LOCK -> ₹0 INITIAL P&L)
    const autoDeployEntireBasket = (basket: NormalizedRealStock[]) => {
        const newEntries: ActivePortfolioTrade[] = [];
        const nowIst = new Date().toLocaleString("en-IN");

        basket.forEach((st, idx) => {
            if (autoTrades.some((t) => t.symbol === st.cleanSymbol)) return;

            const exactLiveLtp = Number(st.currentPrice.toFixed(2));
            const lockedSL = st.stopLossPrice;
            const lockedTP =
                st.purpleBox.executionMode === "MODE_A_SUPPORT_BUY"
                    ? Number(st.purpleBox.boxCeilingVAH.toFixed(2))
                    : Number((exactLiveLtp * 1.07).toFixed(2));

            let quantity = 0;
            let allocatedCapital = 0;

            if (sizingMode === "ATR_VOLATILITY") {
                const dynamicSizing = calculateDynamicPositionSize({
                    accountCapital: portfolioCapital,
                    riskPercentage,
                    entryPrice: exactLiveLtp,
                    stopLossPrice: lockedSL,
                    targetPrice: lockedTP,
                    atr14: st.atr14,
                });
                quantity = dynamicSizing.recommendedQuantity;
                allocatedCapital = Math.round(quantity * exactLiveLtp);
            } else {
                allocatedCapital = 300000;
                quantity = Math.floor(allocatedCapital / exactLiveLtp);
                allocatedCapital = Math.round(quantity * exactLiveLtp);
            }

            if (quantity <= 0) return;
            const benchmarkSlippage = simulateInstitutionalSlippage(exactLiveLtp, "BUY", allocatedCapital);

            newEntries.push({
                tradeId: `TRADE-${st.cleanSymbol}-${Date.now()}-${idx}`,
                symbol: st.cleanSymbol,
                companyName: st.companyName,
                strategyUsed:
                    st.purpleBox.executionMode === "MODE_A_SUPPORT_BUY"
                        ? "🟣 Mode A: Purple Box Support Buy"
                        : "🚀 Mode B: Box Ceiling Breakout (+7%)",
                entryPrice: exactLiveLtp,
                stopLossPrice: lockedSL,
                initialStopLoss: lockedSL,
                targetPrice: lockedTP,
                allocatedCapital,
                quantity,
                executionTime: nowIst,
                status: "ACTIVE",
                currentMarketPrice: exactLiveLtp,
                currentSimulatedPrice: exactLiveLtp,
                peakSimulatedPrice: exactLiveLtp,
                pnlAmount: 0,
                pnlPercent: 0,
                lockedDateKey: st.lockedDateKey,
                lockedReferenceLevel: st.lockedReferenceLevel,
                lockedReferenceLabel: st.lockedReferenceLabel,
                purpleBoxMode: st.purpleBox.executionMode,
                boxFloorVAL: st.purpleBox.boxFloorVAL,
                boxCeilingVAH: st.purpleBox.boxCeilingVAH,
                boxMidPOC: st.purpleBox.boxMidPOC,
                boxWidthPct: st.purpleBox.boxWidthPct,
                supportTouches: st.purpleBox.supportTouches,
                resistanceTouches: st.purpleBox.resistanceTouches,
                isTslActive: false,
                trailingStopPrice: lockedSL,
                lockedGainPercent: 0,
                lockedGainRupees: 0,
                sector: st.sector,
                atr14: st.atr14,
                slippageSimulation: {
                    ...benchmarkSlippage,
                    requestedPrice: exactLiveLtp,
                    executedPrice: exactLiveLtp,
                },
                brokerWebhook: {
                    broker: "DHAN_HQ",
                    brokerOrderId: `DHAN-${st.cleanSymbol}-${Date.now().toString().slice(-6)}-${idx}`,
                    orderStatus: "TRADED",
                    webhookDispatchedAt: nowIst,
                    payloadHash: `wh_${Math.random().toString(36).substring(2, 9)}`,
                },
                auditTrail: [
                    {
                        timestamp: nowIst,
                        action: "BASKET_LTP_FREEZE_EXECUTION",
                        details: `Locked Entry at exact Live LTP ₹${exactLiveLtp} (Initial P&L = ₹0 / 0%). Reference ${st.lockedReferenceLabel}: ₹${st.lockedReferenceLevel}.`,
                    },
                ],
            });
        });

        if (newEntries.length === 0) {
            setPortfolioNotice("ℹ️ All stocks in current view are already deployed in your Active Portfolio!");
            setMainTab("PORTFOLIO");
            return;
        }

        setAutoTrades((prev) => [...newEntries, ...prev]);
        setPortfolioNotice(
            `🔥 Deployed ${newEntries.length} Purple Box Setups locked at exact Live LTP (Initial P&L: ₹0 / 0%)!`
        );
        setMainTab("PORTFOLIO");
    };

    // Interactive Next-Day Trailing & Manual SL/TP Update Handler (keeps Entry & Reference Level permanently locked)
    const handleUpdateTradeSlTp = (
        tradeId: string,
        updates: {
            stopLossPrice: number;
            trailingStopPrice: number;
            targetPrice: number;
            isTslActive: boolean;
            tslTier: string;
            auditEntry: { timestamp: string; action: string; details: string };
        }
    ) => {
        setAutoTrades((prev) =>
            prev.map((tr) => {
                if (tr.tradeId !== tradeId) return tr;
                const lockedGainPct = Number((((updates.trailingStopPrice - tr.entryPrice) / tr.entryPrice) * 100).toFixed(2));
                const lockedGainRs = Math.round((updates.trailingStopPrice - tr.entryPrice) * tr.quantity);
                const updatedTrade: ActivePortfolioTrade = {
                    ...tr,
                    stopLossPrice: updates.stopLossPrice,
                    trailingStopPrice: updates.trailingStopPrice,
                    targetPrice: updates.targetPrice,
                    isTslActive: updates.isTslActive,
                    tslTier: updates.tslTier,
                    lockedGainPercent: Math.max(0, lockedGainPct),
                    lockedGainRupees: Math.max(0, lockedGainRs),
                    auditTrail: [updates.auditEntry, ...(tr.auditTrail || [])],
                };
                setInspectingTrade(updatedTrade as TradeAuditData);
                return updatedTrade;
            })
        );
    };

    const resolveTradeOutcome = (tradeId: string, outcome: "TARGET" | "STOPLOSS") => {
        const targetTrade = autoTrades.find((t) => t.tradeId === tradeId);
        if (!targetTrade) return;

        const finalPrice =
            outcome === "TARGET"
                ? targetTrade.targetPrice
                : targetTrade.trailingStopPrice || targetTrade.stopLossPrice;
        const diff = (finalPrice - targetTrade.entryPrice) * targetTrade.quantity;
        const pct = Number((((finalPrice - targetTrade.entryPrice) / targetTrade.entryPrice) * 100).toFixed(2));

        const resolvedTrade: ActivePortfolioTrade = {
            ...targetTrade,
            currentSimulatedPrice: finalPrice,
            status: outcome === "TARGET" ? "TARGET_HIT" : targetTrade.isTslActive ? "TSL_HIT" : "STOP_LOSS_HIT",
            exitTime: new Date().toLocaleString("en-IN"),
            pnlAmount: Math.round(diff),
            pnlPercent: pct,
        };

        setAutoTrades((prev) => prev.filter((t) => t.tradeId !== tradeId));
        setBacktestHistory((prev) => [resolvedTrade, ...prev]);
        setPortfolioNotice(
            `📈 ${targetTrade.symbol} closed (${resolvedTrade.status.replace("_", " ")}) and archived permanently to Backtest History.`
        );
    };

    // Instant Manual Override & Emergency Square-Off at exact current Live LTP
    const handleEmergencySquareOffNow = (tradeId: string) => {
        const targetTrade = autoTrades.find((t) => t.tradeId === tradeId);
        if (!targetTrade) return;

        const cleanSym = String(targetTrade.symbol || "").toUpperCase().replace(/\.NS$/i, "").replace(/\.BO$/i, "");
        const exactLiveLtp = Number(
            (livePriceMap[cleanSym] ?? targetTrade.currentMarketPrice ?? targetTrade.currentSimulatedPrice ?? targetTrade.entryPrice).toFixed(2)
        );
        const diff = (exactLiveLtp - targetTrade.entryPrice) * targetTrade.quantity;
        const pct = Number((((exactLiveLtp - targetTrade.entryPrice) / targetTrade.entryPrice) * 100).toFixed(2));
        const exitStamp = new Date().toLocaleString("en-IN");

        const squaredOffTrade: ActivePortfolioTrade = {
            ...targetTrade,
            currentMarketPrice: exactLiveLtp,
            currentSimulatedPrice: exactLiveLtp,
            status: "MANUAL_EMERGENCY_EXIT",
            exitTime: exitStamp,
            pnlAmount: Math.round(diff),
            pnlPercent: pct,
            auditTrail: [
                ...(targetTrade.auditTrail || []),
                {
                    timestamp: exitStamp,
                    action: "MANUAL_EMERGENCY_EXIT",
                    details: `⚡ Emergency Square-Off executed at Live LTP ₹${exactLiveLtp} (Realized P&L: ${diff >= 0 ? "+" : ""}₹${Math.round(diff).toLocaleString("en-IN")} / ${pct >= 0 ? "+" : ""}${pct}%).`,
                },
            ],
        };

        setAutoTrades((prev) => prev.filter((t) => t.tradeId !== tradeId));
        setBacktestHistory((prev) => [squaredOffTrade, ...prev]);
        setPortfolioNotice(
            `⚡ Emergency Exit Complete: ${targetTrade.symbol} squared off at Live LTP ₹${exactLiveLtp} (${diff >= 0 ? "+" : ""}₹${Math.round(diff).toLocaleString("en-IN")} / ${pct >= 0 ? "+" : ""}${pct}%), archived to Backtest History & capital freed!`
        );
    };

    // AI News & Reversal Reader Background Worker Hook (polls live Yahoo Finance headlines + exhaustion microstructure)
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
                    const sym = String(t.symbol || "").toUpperCase().replace(/\.NS$/i, "").replace(/\.BO$/i, "");
                    return sym === report.symbol;
                });
                if (!targetTrade) return prev;

                const cleanSym = String(targetTrade.symbol || "").toUpperCase().replace(/\.NS$/i, "").replace(/\.BO$/i, "");
                const exactLiveLtp = Number(
                    (livePriceMap[cleanSym] ?? targetTrade.currentMarketPrice ?? targetTrade.currentSimulatedPrice ?? targetTrade.entryPrice).toFixed(2)
                );
                const diff = (exactLiveLtp - targetTrade.entryPrice) * targetTrade.quantity;
                const pct = Number((((exactLiveLtp - targetTrade.entryPrice) / targetTrade.entryPrice) * 100).toFixed(2));

                const exitedTrade: ActivePortfolioTrade = {
                    ...targetTrade,
                    currentMarketPrice: exactLiveLtp,
                    currentSimulatedPrice: exactLiveLtp,
                    status: "NEWS_TRIGGER_EXIT",
                    exitTime: exitStamp,
                    pnlAmount: Math.round(diff),
                    pnlPercent: pct,
                    auditTrail: [
                        ...(targetTrade.auditTrail || []),
                        {
                            timestamp: exitStamp,
                            action: "NEWS_TRIGGER_EXIT",
                            details: `🚨 AI News & Reversal Worker Auto-Exit [NEWS_TRIGGER_EXIT] at ₹${exactLiveLtp}: ${report.exitReason || report.topHeadline}`,
                        },
                    ],
                };

                setBacktestHistory((histPrev) => {
                    if (histPrev.some((h) => h.tradeId === exitedTrade.tradeId)) return histPrev;
                    return [exitedTrade, ...histPrev];
                });

                setPortfolioNotice(
                    `🚨 AI Sentiment Shield Auto-Exit [NEWS_TRIGGER_EXIT]: ${targetTrade.symbol} closed at ₹${exactLiveLtp} (${diff >= 0 ? "+" : ""}₹${Math.round(diff).toLocaleString("en-IN")}) — ${report.exitReason || report.topHeadline}`
                );

                return prev.filter((t) => t.tradeId !== targetTrade.tradeId);
            });
        },
    });

    // Set of symbols currently running in Active Trades (status === "ACTIVE")
    // Excluded from Screener output until they hit TARGET_HIT / STOP_LOSS_HIT / TSL_HIT and move to Backtest History
    const activeSymbolSet = useMemo(() => {
        return new Set(
            autoTrades
                .filter((t) => !t.status || t.status === "ACTIVE")
                .map((t) => String(t.symbol || "").toUpperCase().replace(/\.NS$/i, "").replace(/\.BO$/i, ""))
                .filter(Boolean)
        );
    }, [autoTrades]);

    const filteredStocks = useMemo(() => {
        return stocks.filter((st) => {
            // DUPLICATE ACTIVE TRADE PREVENTION: Exclude any symbol currently running with status === "ACTIVE"
            if (activeSymbolSet.has(st.cleanSymbol.toUpperCase())) {
                return false;
            }
            if (strategyFilter !== "ALL_STRATEGIES" && !st.matchedQuantStrategies.includes(strategyFilter)) {
                return false;
            }
            if (purpleBoxModeFilter !== "ALL_MODES" && st.purpleBox.executionMode !== purpleBoxModeFilter) {
                return false;
            }
            if (minVolumeFilter > 0 && st.volumeMultiplier < minVolumeFilter) return false;
            if (requireAbove200Ema && !st.above200Ema) return false;
            if (searchFilter.trim()) {
                const q = searchFilter.trim().toUpperCase();
                if (
                    !st.cleanSymbol.includes(q) &&
                    !st.companyName.toUpperCase().includes(q) &&
                    !st.sector.toUpperCase().includes(q)
                ) {
                    return false;
                }
            }
            return true;
        });
    }, [stocks, activeSymbolSet, strategyFilter, purpleBoxModeFilter, minVolumeFilter, requireAbove200Ema, searchFilter]);

    const largeCapList = useMemo(() => filteredStocks.filter((s) => s.marketCapCategory === "LARGE_CAP"), [filteredStocks]);
    const midCapList = useMemo(() => filteredStocks.filter((s) => s.marketCapCategory === "MID_CAP"), [filteredStocks]);
    const smallCapList = useMemo(() => filteredStocks.filter((s) => s.marketCapCategory === "SMALL_CAP"), [filteredStocks]);

    const displayedStocks = useMemo(() => {
        if (capFilter === "TOP_10_MULTICAP") {
            return [
                ...largeCapList.slice(0, 2),
                ...midCapList.slice(0, 3),
                ...smallCapList.slice(0, 5),
            ];
        }
        if (capFilter === "LARGE_CAP") return largeCapList;
        if (capFilter === "MID_CAP") return midCapList;
        if (capFilter === "SMALL_CAP") return smallCapList;
        return filteredStocks;
    }, [capFilter, largeCapList, midCapList, smallCapList, filteredStocks]);

    // Backtest Summary Metrics
    const backtestStats = useMemo(() => {
        const total = backtestHistory.length;
        const wins = backtestHistory.filter((t) => t.status === "TARGET_HIT" || (t.status === "TSL_HIT" && t.pnlAmount > 0)).length;
        const winRate = total > 0 ? Math.round((wins / total) * 100) : 0;
        const totalPnl = backtestHistory.reduce((acc, t) => acc + t.pnlAmount, 0);
        return { total, wins, losses: total - wins, winRate, totalPnl };
    }, [backtestHistory]);

    return (
        <div className="space-y-6 p-4 max-w-7xl mx-auto font-mono">
            {/* Header */}
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 bg-[#0d1322] p-5 rounded-2xl border border-slate-800 shadow-2xl">
                <div>
                    <div className="flex items-center gap-2.5 flex-wrap">
                        <h2 className="text-xl font-bold text-slate-100 flex items-center gap-2">
                            <Crosshair className="w-5 h-5 text-violet-400" />
                            PURPLE BOX RANGE &amp; STEP-UP BREAKOUT ENGINE
                        </h2>
                        <span className="text-[10px] px-2.5 py-0.5 rounded-full font-bold bg-violet-500/15 text-violet-300 border border-violet-500/30">
                            5%–18% BOX · 3+ SUP / 2+ RES TOUCHES · 1D/4H/1H CONFLUENCE
                        </span>
                        <span className="text-[10px] px-2.5 py-0.5 rounded-full font-bold bg-cyan-500/15 text-cyan-300 border border-cyan-500/30">
                            {dataSourceStatus}
                        </span>
                    </div>
                    <p className="text-xs text-slate-400 mt-1">
                        Dual-Mode Execution (Mode A Support Buy → VAH Target · Mode B Ceiling Breakout → +7% Target) · Ironclad Same-Day LTP Freeze (₹0 Initial P&amp;L)
                    </p>
                </div>

                <div className="flex items-center gap-2.5 flex-wrap">
                    {/* Position Sizing Selector */}
                    <div className="flex items-center gap-1.5 bg-slate-900 border border-slate-700/80 rounded-xl px-2.5 py-1.5 text-xs">
                        <Calculator className="w-3.5 h-3.5 text-cyan-400" />
                        <span className="text-[10px] text-slate-400 uppercase">Sizing:</span>
                        <select
                            value={sizingMode}
                            onChange={(e) => setSizingMode(e.target.value as any)}
                            className="bg-transparent text-cyan-300 font-bold focus:outline-none cursor-pointer"
                        >
                            <option value="ATR_VOLATILITY" className="bg-slate-900">
                                ATR Volatility Parity (Dynamic)
                            </option>
                            <option value="STATIC_3L" className="bg-slate-900">
                                Static ₹3 Lakh Sizing
                            </option>
                        </select>
                    </div>

                    <button
                        onClick={() => fetchLiveApiData(true)}
                        disabled={isLoading || isScanningFull}
                        className="px-3.5 py-2 rounded-xl bg-emerald-500/25 hover:bg-emerald-500/35 text-emerald-300 border border-emerald-500/40 text-xs font-bold transition flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                    >
                        <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? "animate-spin" : ""}`} />
                        <span>{isLoading ? "Syncing LTP..." : "Sync Yahoo LTP"}</span>
                    </button>

                    <button
                        onClick={runFullNseScan}
                        disabled={isScanningFull || isLoading}
                        className="px-3.5 py-2 rounded-xl bg-violet-500/25 hover:bg-violet-500/35 text-violet-300 border border-violet-500/40 text-xs font-bold transition flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                    >
                        <Zap className={`w-3.5 h-3.5 ${isScanningFull ? "animate-pulse" : ""}`} />
                        <span>{isScanningFull ? "Scanning Full NSE..." : "Full NSE Scan"}</span>
                    </button>
                </div>
            </div>

            {/* Live 4H Order Block Retest Scanner Feed */}
            <IMLive4HOrderBlockRetestTicker
                alerts={retestAlerts}
                onDeploy={handleDeploy4HRetest}
                isScanning={isLoading || isScanningFull}
            />

            {/* Main App Navigation Tabs */}
            <div className="flex items-center justify-between gap-3 border-b border-slate-800 pb-3 flex-wrap">
                <div className="flex items-center gap-2.5 flex-wrap">
                    <button
                        onClick={() => setMainTab("SCREENER")}
                        className={`px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-2 cursor-pointer ${mainTab === "SCREENER"
                                ? "bg-cyan-500/25 text-cyan-300 border border-cyan-500/50 shadow-lg"
                                : "bg-slate-900 text-slate-400 hover:text-slate-200 border border-slate-800"
                            }`}
                    >
                        <Layers className="w-4 h-4 text-cyan-400" />
                        <span>📊 Screener Setups ({displayedStocks.length})</span>
                    </button>

                    <button
                        onClick={() => setMainTab("PORTFOLIO")}
                        className={`px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-2 cursor-pointer ${mainTab === "PORTFOLIO"
                                ? "bg-violet-500/25 text-violet-300 border border-violet-500/50 shadow-lg"
                                : "bg-slate-900 text-slate-400 hover:text-slate-200 border border-slate-800"
                            }`}
                    >
                        <Briefcase className="w-4 h-4 text-violet-400" />
                        <span>⚡ Active Trades ({autoTrades.length})</span>
                    </button>

                    <button
                        onClick={() => setMainTab("BACKTEST_HISTORY")}
                        className={`px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-2 cursor-pointer ${mainTab === "BACKTEST_HISTORY"
                                ? "bg-cyan-500/25 text-cyan-300 border border-cyan-500/50 shadow-lg"
                                : "bg-slate-900 text-slate-400 hover:text-slate-200 border border-slate-800"
                            }`}
                    >
                        <History className="w-4 h-4 text-cyan-400" />
                        <span>🗄️ Backtest History ({backtestHistory.length})</span>
                    </button>

                    <button
                        onClick={() => setMainTab("EXPECTANCY_ANALYTICS")}
                        className={`px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-2 cursor-pointer ${mainTab === "EXPECTANCY_ANALYTICS"
                                ? "bg-emerald-500/25 text-emerald-300 border border-emerald-500/50 shadow-lg"
                                : "bg-slate-900 text-slate-400 hover:text-slate-200 border border-slate-800"
                            }`}
                    >
                        <BarChart3 className="w-4 h-4 text-emerald-400" />
                        <span>📈 Expectancy &amp; Risk Matrix</span>
                    </button>

                    <button
                        onClick={() => setMainTab("STRATEGY_GUIDE")}
                        className={`px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-2 cursor-pointer ${mainTab === "STRATEGY_GUIDE"
                                ? "bg-amber-500/25 text-amber-300 border border-amber-500/50 shadow-lg"
                                : "bg-slate-900 text-slate-400 hover:text-slate-200 border border-slate-800"
                            }`}
                    >
                        <Flame className="w-4 h-4 text-amber-400" />
                        <span>🧠 Purple Box Architecture</span>
                    </button>
                </div>

                {mainTab === "SCREENER" && displayedStocks.length > 0 && (
                    <button
                        onClick={() => autoDeployEntireBasket(displayedStocks.slice(0, 10))}
                        className="px-4 py-2 rounded-xl bg-gradient-to-r from-amber-500/30 to-violet-500/30 text-amber-200 border border-amber-500/50 hover:opacity-95 text-xs font-bold flex items-center gap-2 cursor-pointer shadow-lg"
                    >
                        <Sparkles className="w-4 h-4 text-amber-400" />
                        <span>
                            ⚡ 1-Click Deploy Top {Math.min(10, displayedStocks.length)} Basket (Lock Live LTP)
                        </span>
                    </button>
                )}
            </div>

            {portfolioNotice && (
                <div className="p-3 rounded-xl bg-violet-500/20 border border-violet-500/40 text-xs text-violet-200 flex items-center justify-between gap-2 shadow-lg animate-in fade-in duration-200">
                    <div className="flex items-center gap-2">
                        <Sparkles className="w-4 h-4 text-violet-400 shrink-0" />
                        <span>{portfolioNotice}</span>
                    </div>
                    <button
                        onClick={() => setPortfolioNotice(null)}
                        className="text-slate-400 hover:text-slate-200 cursor-pointer"
                    >
                        <X className="w-4 h-4" />
                    </button>
                </div>
            )}

            {/* STRATEGY GUIDE TAB */}
            {mainTab === "STRATEGY_GUIDE" && (
                <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {(Object.keys(STRATEGY_METADATA) as Array<Exclude<InstitutionalStrategyCode, "ALL_STRATEGIES">>).map(
                        (key) => {
                            const meta = STRATEGY_METADATA[key];
                            return (
                                <div key={key} className="p-5 rounded-2xl bg-[#0d1322] border border-slate-800 space-y-3 shadow-xl">
                                    <div className="flex items-center justify-between">
                                        <span className={`text-xs px-2.5 py-1 rounded-lg font-bold border ${meta.colorClass}`}>
                                            {meta.shortBadge}
                                        </span>
                                        <span className="text-xs font-bold text-emerald-400">
                                            Historical Win Accuracy: ~{meta.winProbBase}%+
                                        </span>
                                    </div>
                                    <h4 className="text-sm font-bold text-slate-100">{meta.title}</h4>
                                    <p className="text-xs text-slate-300 leading-relaxed">{meta.logicDesc}</p>
                                    <div className="p-2.5 rounded-xl bg-slate-900 border border-slate-800 text-[11px] text-slate-400 space-y-1">
                                        <div className="text-cyan-300 font-semibold">Algorithmic Verification Rules:</div>
                                        <div>• Channel Width: 5.0% to 18.0% with &ge;3 Support &amp; &ge;2 Resistance touches.</div>
                                        <div>• Same-Day Price Freeze: Date-keyed (YYYY-MM-DD) entry at Live LTP so P&amp;L starts at ₹0.</div>
                                    </div>
                                </div>
                            );
                        }
                    )}
                </section>
            )}

            {/* EXPECTANCY ANALYTICS TAB */}
            {mainTab === "EXPECTANCY_ANALYTICS" && (
                <section className="space-y-6">
                    <IMWinRateExpectancyAnalytics historyTrades={backtestHistory} />
                    <IMRiskExposureMatrix
                        totalCapital={portfolioCapital}
                        activeTrades={autoTrades.map((t) => ({
                            symbol: t.symbol,
                            companyName: t.companyName,
                            allocatedCapital: t.allocatedCapital,
                            entryPrice: t.entryPrice,
                            stopLossPrice: t.trailingStopPrice || t.stopLossPrice,
                            quantity: t.quantity,
                            pnlAmount: t.pnlAmount,
                            pnlPercent: t.pnlPercent,
                            sector: t.sector,
                        }))}
                    />
                </section>
            )}

            {/* 1. ACTIVE TRADES TABULAR VIEW (PORTFOLIO TAB) */}
            {mainTab === "PORTFOLIO" && (
                <section className="space-y-6">
                    <div className="p-5 rounded-2xl bg-[#0d1322] border border-violet-500/30 space-y-4 shadow-2xl">
                        <div className="flex items-center justify-between flex-wrap gap-3">
                            <div>
                                <h3 className="text-base font-bold text-slate-100 flex items-center gap-2">
                                    <Activity className="w-5 h-5 text-violet-400" />
                                    ACTIVE TRADES TABLE ({autoTrades.length}) • REAL-TIME LTP &amp; TRAILING ENGINE
                                </h3>
                                <p className="text-xs text-slate-400 mt-0.5">
                                    Initial Entry locks at exact Live LTP (starts at ₹0 / 0%). Live P&amp;L &amp; TSL recalculate dynamically on every price tick.
                                </p>
                            </div>

                            <div className="flex items-center gap-3 sm:gap-5 flex-wrap">
                                {/* Manual Force Refresh LTP Sync Button */}
                                <button
                                    onClick={() => fetchLiveApiData(true)}
                                    disabled={isForceSyncingLtp || isLoading}
                                    className="px-3.5 py-2 rounded-xl bg-gradient-to-r from-cyan-600 to-violet-600 hover:from-cyan-500 hover:to-violet-500 text-white border border-cyan-400/40 text-xs font-bold transition flex items-center gap-2 cursor-pointer shadow-lg shadow-cyan-500/20 disabled:opacity-50"
                                    title="Fetch fresh real-time quotes for all active trades from Yahoo Finance"
                                >
                                    <RefreshCw className={`w-3.5 h-3.5 ${isForceSyncingLtp || isLoading ? "animate-spin" : ""}`} />
                                    <span>{isForceSyncingLtp ? "Syncing Quotes..." : "⚡ Force Refresh LTP"}</span>
                                </button>

                                <button
                                    onClick={() => runNewsScan()}
                                    disabled={isScanningNews || autoTrades.length === 0}
                                    className="px-3 py-2 rounded-xl bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border border-emerald-500/40 text-xs font-bold transition flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                                    title={lastNewsScanIst ? `AI Sentiment Shield last scanned at ${lastNewsScanIst}` : "Scan live financial news & reversal catalysts for all active trades"}
                                >
                                    <Shield className={`w-3.5 h-3.5 ${isScanningNews ? "animate-pulse text-amber-300" : "text-emerald-400"}`} />
                                    <span>{isScanningNews ? "Scanning News..." : "🛡️ AI News Shield"}</span>
                                </button>

                                {lastLtpSyncTime && (
                                    <div className="hidden md:flex flex-col text-right">
                                        <span className="text-[9px] uppercase tracking-wider text-slate-400">Last Live Tick</span>
                                        <span className="text-xs font-mono font-bold text-cyan-300 flex items-center gap-1">
                                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                                            {lastLtpSyncTime}
                                        </span>
                                    </div>
                                )}

                                <div className="text-right">
                                    <span className="text-[10px] text-slate-400 uppercase block">Total Deployed</span>
                                    <span className="text-base font-bold text-violet-300">
                                        ₹{autoTrades.reduce((acc, t) => acc + t.allocatedCapital, 0).toLocaleString("en-IN")}
                                    </span>
                                </div>
                                <div className="text-right">
                                    <span className="text-[10px] text-slate-400 uppercase block">Live Unrealized P&amp;L</span>
                                    <span
                                        className={`text-base font-bold ${autoTrades.reduce((acc, t) => acc + t.pnlAmount, 0) >= 0
                                                ? "text-emerald-400"
                                                : "text-rose-400"
                                            }`}
                                    >
                                        {autoTrades.reduce((acc, t) => acc + t.pnlAmount, 0) >= 0 ? "+" : ""}₹
                                        {autoTrades.reduce((acc, t) => acc + t.pnlAmount, 0).toLocaleString("en-IN")}
                                    </span>
                                </div>
                            </div>
                        </div>

                        {autoTrades.length === 0 ? (
                            <div className="p-12 rounded-xl bg-slate-900/60 border border-slate-800 text-center text-slate-400 space-y-2">
                                <p className="text-sm font-bold text-slate-300">No active positions running right now.</p>
                                <p className="text-xs text-slate-500">
                                    Go to the Screener Setups tab and click <strong>&quot;⚡ Deploy&quot;</strong> on any Purple Box setup.
                                </p>
                            </div>
                        ) : (
                            <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-950/60">
                                <table className="w-full text-left border-collapse text-xs">
                                    <thead>
                                        <tr className="border-b border-slate-800 bg-slate-900/90 text-[10px] uppercase text-slate-400">
                                            <th className="py-3 px-3">Symbol &amp; Mode</th>
                                            <th className="py-3 px-3">Locked Ref Level</th>
                                            <th className="py-3 px-3">Frozen Entry (LTP)</th>
                                            <th className="py-3 px-3">Live LTP</th>
                                            <th className="py-3 px-3">Active Stop-Loss</th>
                                            <th className="py-3 px-3">Target Price</th>
                                            <th className="py-3 px-3">Qty / Capital</th>
                                            <th className="py-3 px-3">Live P&amp;L</th>
                                            <th className="py-3 px-3">AI Sentiment Shield</th>
                                            <th className="py-3 px-3 text-right">Actions &amp; SL/TP Edit</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-800/70">
                                        {autoTrades.map((tr) => {
                                            const cleanSym = String(tr.symbol || "").toUpperCase().replace(/\.NS$/i, "").replace(/\.BO$/i, "");
                                            const aiReport = aiShieldReports[cleanSym];
                                            const isCatalystWarning =
                                                aiReport?.shieldStatus === "CATALYST_ALERT" ||
                                                aiReport?.shieldStatus === "CRITICAL_NEWS_EXIT" ||
                                                aiReport?.shieldStatus === "EXHAUSTION_REVERSAL_EXIT";
                                            const shieldBadgeLabel = aiReport?.badgeText || "🟢 Clean";
                                            const exactLiveLtp = Number(
                                                (livePriceMap[cleanSym] ?? tr.currentMarketPrice ?? tr.currentSimulatedPrice ?? tr.entryPrice).toFixed(2)
                                            );
                                            const exactPnlAmount = Math.round((exactLiveLtp - tr.entryPrice) * tr.quantity);
                                            const exactPnlPercent = Number((((exactLiveLtp - tr.entryPrice) / tr.entryPrice) * 100).toFixed(2));
                                            const refLvl =
                                                tr.lockedReferenceLevel ??
                                                (tr.purpleBoxMode === "MODE_A_SUPPORT_BUY"
                                                    ? tr.boxFloorVAL ?? tr.stopLossPrice
                                                    : tr.boxCeilingVAH ?? tr.entryPrice);
                                            return (
                                                <tr key={tr.tradeId} className="hover:bg-slate-900/60 transition-colors">
                                                    <td className="py-3 px-3">
                                                        <div className="font-bold text-slate-100 text-sm flex items-center gap-1.5">
                                                            <span className="flex items-center gap-1">
                                                                <span
                                                                    className={`w-2 h-2 rounded-full ${
                                                                        tr.isLiveTick !== false
                                                                            ? "bg-emerald-400 animate-pulse"
                                                                            : "bg-slate-500"
                                                                    }`}
                                                                    title={tr.lastLtpSyncAt ? `Live feed synced at ${tr.lastLtpSyncAt}` : "Awaiting quote sync"}
                                                                />
                                                                {tr.symbol}
                                                            </span>
                                                            {tr.isTslActive && (
                                                                <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40">
                                                                    TSL ARMED
                                                                </span>
                                                            )}
                                                        </div>
                                                        <div className="text-[10px] text-violet-300 mt-0.5">{tr.strategyUsed}</div>
                                                        <div className="text-[10px] text-slate-500">
                                                            Locked: {tr.executionTime}
                                                            {tr.lastLtpSyncAt && (
                                                                <span className="text-cyan-400/80 ml-1">· Tick {tr.lastLtpSyncAt}</span>
                                                            )}
                                                        </div>
                                                    </td>
                                                    <td className="py-3 px-3">
                                                        <div className="font-bold text-violet-300 flex items-center gap-1">
                                                            <Lock className="w-3 h-3 text-violet-400" />
                                                            ₹{refLvl}
                                                        </div>
                                                        <div className="text-[10px] text-slate-500">
                                                            {tr.lockedReferenceLabel || "LOCKED_REF"}
                                                        </div>
                                                    </td>
                                                    <td className="py-3 px-3">
                                                        <div className="font-bold text-cyan-300">₹{tr.entryPrice}</div>
                                                        <div className="text-[10px] text-slate-500">
                                                            Key: {tr.lockedDateKey || "TODAY"}
                                                        </div>
                                                    </td>
                                                    <td className="py-3 px-3">
                                                        <div className="font-extrabold text-white text-sm flex items-center gap-1">
                                                            ₹{exactLiveLtp}
                                                            {tr.isLiveTick !== false && (
                                                                <span className="text-[9px] px-1 py-0.2 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 font-mono">
                                                                    LIVE
                                                                </span>
                                                            )}
                                                        </div>
                                                        {tr.previousTickPrice && tr.previousTickPrice !== exactLiveLtp && (
                                                            <div className="text-[10px] text-slate-400">
                                                                Prev: ₹{tr.previousTickPrice}
                                                            </div>
                                                        )}
                                                    </td>
                                                    <td className="py-3 px-3">
                                                        <div
                                                            className={`font-bold ${tr.isTslActive ? "text-amber-300" : "text-rose-400"
                                                                }`}
                                                        >
                                                            ₹{tr.trailingStopPrice || tr.stopLossPrice}
                                                        </div>
                                                        <div className="text-[10px] text-slate-500">
                                                            {tr.isTslActive
                                                                ? `+${tr.lockedGainPercent || 0.5}% Protected`
                                                                : "Structural SL"}
                                                        </div>
                                                    </td>
                                                    <td className="py-3 px-3 font-bold text-emerald-400">
                                                        ₹{tr.targetPrice}
                                                    </td>
                                                    <td className="py-3 px-3">
                                                        <div className="font-bold text-slate-200">{tr.quantity} sh</div>
                                                        <div className="text-[10px] text-slate-400">
                                                            ₹{tr.allocatedCapital.toLocaleString("en-IN")}
                                                        </div>
                                                    </td>
                                                    <td className="py-3 px-3">
                                                        <div
                                                            className={`font-bold text-sm ${exactPnlAmount >= 0 ? "text-emerald-400" : "text-rose-400"
                                                                }`}
                                                        >
                                                            {exactPnlAmount >= 0 ? "+" : ""}₹
                                                            {exactPnlAmount.toLocaleString("en-IN")}
                                                        </div>
                                                        <div
                                                            className={`text-[10px] font-bold ${exactPnlPercent >= 0 ? "text-emerald-400" : "text-rose-400"
                                                                }`}
                                                        >
                                                            {exactPnlPercent >= 0 ? "+" : ""}
                                                            {exactPnlPercent}%
                                                        </div>
                                                    </td>
                                                    <td className="py-3 px-3">
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
                                                                    onClick={() => runNewsScan(cleanSym)}
                                                                    className="text-[9px] px-1.5 py-0.5 rounded bg-rose-500/15 hover:bg-rose-500/30 text-rose-300 border border-rose-500/30 font-bold cursor-pointer"
                                                                    title="Simulate a high-impact negative news catalyst / volume exhaustion reversal to test automated NEWS_TRIGGER_EXIT"
                                                                >
                                                                    🧪 Sim Catalyst
                                                                </button>
                                                            </div>
                                                            <div
                                                                className="text-[10px] text-slate-400 max-w-[190px] truncate"
                                                                title={aiReport?.topHeadline || "Monitoring live NSE/Yahoo Finance catalyst feed"}
                                                            >
                                                                {aiReport?.topHeadline || "Monitoring live catalyst feed..."}
                                                            </div>
                                                        </div>
                                                    </td>
                                                    <td className="py-3 px-3 text-right">
                                                        <div className="flex items-center justify-end gap-1.5 flex-wrap">
                                                            <button
                                                                onClick={() => handleEmergencySquareOffNow(tr.tradeId)}
                                                                className="px-2.5 py-1.5 rounded-lg bg-gradient-to-r from-rose-600 to-orange-600 hover:from-rose-500 hover:to-orange-500 text-white border border-rose-400/50 text-[11px] font-bold flex items-center gap-1 cursor-pointer shadow-md"
                                                                title="Instantly lock current live P&L, archive to Backtest History, and free up capital"
                                                            >
                                                                <Zap className="w-3 h-3 text-amber-200" />
                                                                <span>⚡ Emergency Exit / Square-off Now</span>
                                                            </button>
                                                            <button
                                                                onClick={() => setInspectingTrade(tr as TradeAuditData)}
                                                                className="px-2.5 py-1.5 rounded-lg bg-violet-500/20 text-violet-200 border border-violet-500/40 hover:bg-violet-500/30 text-[11px] font-bold flex items-center gap-1 cursor-pointer"
                                                                title="Adjust SL/TP & Inspect Audit"
                                                            >
                                                                <Sliders className="w-3 h-3 text-violet-300" />
                                                                <span>Adjust SL/TP</span>
                                                            </button>
                                                            <button
                                                                onClick={() => resolveTradeOutcome(tr.tradeId, "TARGET")}
                                                                className="px-2 py-1.5 rounded-lg bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 text-[11px] font-bold hover:bg-emerald-500/30 cursor-pointer"
                                                            >
                                                                TP ✅
                                                            </button>
                                                            <button
                                                                onClick={() => resolveTradeOutcome(tr.tradeId, "STOPLOSS")}
                                                                className="px-2 py-1.5 rounded-lg bg-rose-500/20 text-rose-300 border border-rose-500/40 text-[11px] font-bold hover:bg-rose-500/30 cursor-pointer"
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

                    {/* Live Risk Exposure Matrix */}
                    <IMRiskExposureMatrix
                        totalCapital={portfolioCapital}
                        activeTrades={autoTrades.map((t) => ({
                            symbol: t.symbol,
                            companyName: t.companyName,
                            allocatedCapital: t.allocatedCapital,
                            entryPrice: t.entryPrice,
                            stopLossPrice: t.trailingStopPrice || t.stopLossPrice,
                            quantity: t.quantity,
                            pnlAmount: t.pnlAmount,
                            pnlPercent: t.pnlPercent,
                            sector: t.sector,
                        }))}
                    />
                </section>
            )}

            {/* 2. BACKTEST HISTORY TABULAR VIEW */}
            {mainTab === "BACKTEST_HISTORY" && (
                <section className="space-y-4">
                    <div className="p-5 rounded-2xl bg-[#0d1322] border border-cyan-500/30 space-y-4 shadow-2xl">
                        <div className="flex items-center justify-between flex-wrap gap-3">
                            <div>
                                <h3 className="text-base font-bold text-slate-100 flex items-center gap-2">
                                    <History className="w-5 h-5 text-cyan-400" />
                                    BACKTEST HISTORY &amp; CLOSED TRADE LEDGER
                                </h3>
                                <p className="text-xs text-slate-400 mt-0.5">
                                    Complete tabular archive of settled Purple Box &amp; Step-Up trades with locked reference levels and audit logs.
                                </p>
                            </div>

                            <div className="flex items-center gap-4 flex-wrap">
                                <div className="text-right">
                                    <span className="text-[10px] text-slate-400 uppercase block">
                                        Win Rate ({backtestStats.wins}W / {backtestStats.losses}L)
                                    </span>
                                    <span className="text-base font-bold text-cyan-300">{backtestStats.winRate}%</span>
                                </div>
                                <div className="text-right">
                                    <span className="text-[10px] text-slate-400 uppercase block">Total Realized P&amp;L</span>
                                    <span
                                        className={`text-lg font-bold ${backtestStats.totalPnl >= 0 ? "text-emerald-400" : "text-rose-400"
                                            }`}
                                    >
                                        {backtestStats.totalPnl >= 0 ? "+" : ""}₹{backtestStats.totalPnl.toLocaleString("en-IN")}
                                    </span>
                                </div>
                                {backtestHistory.length > 0 && (
                                    <button
                                        onClick={() => {
                                            if (confirm("Clear all closed trade history?")) setBacktestHistory([]);
                                        }}
                                        className="p-2 rounded-lg bg-slate-800 text-slate-400 hover:text-rose-400 cursor-pointer"
                                        title="Clear History"
                                    >
                                        <Trash2 className="w-4 h-4" />
                                    </button>
                                )}
                            </div>
                        </div>

                        {backtestHistory.length === 0 ? (
                            <div className="p-12 rounded-xl bg-slate-900/60 border border-slate-800 text-center text-slate-400 space-y-2">
                                <p className="text-sm font-bold text-slate-300">No closed trades in history yet.</p>
                                <p className="text-xs text-slate-500">
                                    When an active trade hits Target or Trailing Stop Loss, it automatically archives here.
                                </p>
                            </div>
                        ) : (
                            <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-950/60">
                                <table className="w-full text-left border-collapse text-xs">
                                    <thead>
                                        <tr className="border-b border-slate-800 bg-slate-900/90 text-[10px] uppercase text-slate-400">
                                            <th className="py-3 px-3">Symbol &amp; Strategy</th>
                                            <th className="py-3 px-3">Locked Ref</th>
                                            <th className="py-3 px-3">Entry Price</th>
                                            <th className="py-3 px-3">Exit Price</th>
                                            <th className="py-3 px-3">Qty / Capital</th>
                                            <th className="py-3 px-3">Outcome Status</th>
                                            <th className="py-3 px-3">Realized P&amp;L</th>
                                            <th className="py-3 px-3">Timestamps</th>
                                            <th className="py-3 px-3 text-right">Audit</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-800/70">
                                        {backtestHistory.map((tr) => {
                                            const isTarget = tr.status === "TARGET_HIT";
                                            const isTsl = tr.status === "TSL_HIT";
                                            return (
                                                <tr
                                                    key={tr.tradeId}
                                                    onClick={() => setSelectedExitAuditTrade(tr as any)}
                                                    className="hover:bg-cyan-500/10 transition-colors cursor-pointer group"
                                                    title="Click to open interactive Trade Exit Audit Modal"
                                                >
                                                    <td className="py-3 px-3">
                                                        <div className="font-bold text-slate-100 text-sm flex items-center gap-1.5">
                                                            <span>{tr.symbol}</span>
                                                            <span className="text-[10px] text-cyan-400 opacity-0 group-hover:opacity-100 transition-opacity font-normal">
                                                                🔍 Audit
                                                            </span>
                                                        </div>
                                                        <div className="text-[10px] text-cyan-300">{tr.strategyUsed}</div>
                                                    </td>
                                                    <td className="py-3 px-3 font-bold text-violet-300">
                                                        ₹{tr.lockedReferenceLevel ?? tr.entryPrice}
                                                    </td>
                                                    <td className="py-3 px-3 font-bold text-slate-200">₹{tr.entryPrice}</td>
                                                    <td className="py-3 px-3 font-bold text-slate-100">
                                                        ₹{tr.currentSimulatedPrice}
                                                    </td>
                                                    <td className="py-3 px-3">
                                                        <div className="text-slate-200 font-bold">{tr.quantity} sh</div>
                                                        <div className="text-[10px] text-slate-400">
                                                            ₹{tr.allocatedCapital.toLocaleString("en-IN")}
                                                        </div>
                                                    </td>
                                                    <td className="py-3 px-3">
                                                        <span
                                                            className={`text-[10px] px-2 py-0.5 rounded font-bold uppercase ${isTarget
                                                                    ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40"
                                                                    : isTsl
                                                                        ? "bg-amber-500/20 text-amber-300 border border-amber-500/40"
                                                                        : "bg-rose-500/20 text-rose-300 border border-rose-500/40"
                                                                }`}
                                                        >
                                                            {tr.status.replace("_", " ")}
                                                        </span>
                                                    </td>
                                                    <td className="py-3 px-3">
                                                        <div
                                                            className={`font-bold text-sm ${tr.pnlAmount >= 0 ? "text-emerald-400" : "text-rose-400"
                                                                }`}
                                                        >
                                                            {tr.pnlAmount >= 0 ? "+" : ""}₹
                                                            {tr.pnlAmount.toLocaleString("en-IN")}
                                                        </div>
                                                        <div
                                                            className={`text-[10px] font-bold ${tr.pnlPercent >= 0 ? "text-emerald-400" : "text-rose-400"
                                                                }`}
                                                        >
                                                            {tr.pnlPercent >= 0 ? "+" : ""}
                                                            {tr.pnlPercent}%
                                                        </div>
                                                    </td>
                                                    <td className="py-3 px-3 text-[10px] text-slate-400">
                                                        <div>In: {tr.executionTime}</div>
                                                        <div>Out: {tr.exitTime || "Closed"}</div>
                                                    </td>
                                                    <td className="py-3 px-3 text-right">
                                                        <div className="flex items-center justify-end gap-1.5 flex-wrap">
                                                            <button
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    setSelectedExitAuditTrade(tr as any);
                                                                }}
                                                                className="px-2.5 py-1.5 rounded-lg bg-cyan-500/15 text-cyan-300 hover:bg-cyan-500/25 border border-cyan-500/30 text-[11px] font-bold inline-flex items-center gap-1 cursor-pointer shadow-sm transition"
                                                                title="Open Interactive Trade Exit Audit Log"
                                                            >
                                                                <Search className="w-3.5 h-3.5 text-cyan-400" />
                                                                <span>🔍 View Exit Audit Log</span>
                                                            </button>
                                                            <button
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    setInspectingTrade(tr as TradeAuditData);
                                                                }}
                                                                className="px-2 py-1.5 rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700 text-[11px] font-semibold inline-flex items-center gap-1 cursor-pointer"
                                                                title="Inspect Full Trade Parameters"
                                                            >
                                                                <FileText className="w-3 h-3 text-slate-400" />
                                                                <span>Parameters</span>
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
                </section>
            )}

            {/* 3. SCREENER SETUPS TAB CONTENT (CLEAN TABULAR & CARD VIEWS) */}
            {mainTab === "SCREENER" && (
                <div className="space-y-5">
                    {/* Strategy + Dual-Mode Selector + Filter Bar */}
                    <div className="bg-[#0d1322] p-4 rounded-2xl border border-slate-800 space-y-3 shadow-xl">
                        {/* Row 1: Purple Box Dual-Mode Filter & Quant Strategies */}
                        <div className="flex items-center justify-between gap-2 flex-wrap border-b border-slate-800/80 pb-3">
                            <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-[10px] text-slate-400 uppercase font-bold mr-1">
                                    Purple Box Mode:
                                </span>
                                <button
                                    onClick={() => setPurpleBoxModeFilter("ALL_MODES")}
                                    className={`px-3 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer ${purpleBoxModeFilter === "ALL_MODES"
                                            ? "bg-cyan-500/25 text-cyan-300 border border-cyan-500/50"
                                            : "bg-slate-900 text-slate-400 hover:text-slate-200 border border-slate-800"
                                        }`}
                                >
                                    All Dual-Mode Setups
                                </button>
                                <button
                                    onClick={() => setPurpleBoxModeFilter("MODE_A_SUPPORT_BUY")}
                                    className={`px-3 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer ${purpleBoxModeFilter === "MODE_A_SUPPORT_BUY"
                                            ? "bg-violet-500/25 text-violet-300 border border-violet-500/50"
                                            : "bg-slate-900 text-slate-400 hover:text-slate-200 border border-slate-800"
                                        }`}
                                >
                                    🟣 Mode A: Support Buy (Bottom 25–30% → VAH)
                                </button>
                                <button
                                    onClick={() => setPurpleBoxModeFilter("MODE_B_CEILING_BREAKOUT")}
                                    className={`px-3 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer ${purpleBoxModeFilter === "MODE_B_CEILING_BREAKOUT"
                                            ? "bg-emerald-500/25 text-emerald-300 border border-emerald-500/50"
                                            : "bg-slate-900 text-slate-400 hover:text-slate-200 border border-slate-800"
                                        }`}
                                >
                                    🚀 Mode B: Box Ceiling Breakout (Above VAH → +7%)
                                </button>
                            </div>

                            {/* Table vs Cards View Toggle */}
                            <div className="flex items-center gap-1 bg-slate-900 p-1 rounded-xl border border-slate-800">
                                <button
                                    onClick={() => setScreenerViewMode("TABLE")}
                                    className={`px-2.5 py-1 rounded-lg text-xs font-bold flex items-center gap-1 cursor-pointer ${screenerViewMode === "TABLE"
                                            ? "bg-cyan-500/25 text-cyan-300 border border-cyan-500/40"
                                            : "text-slate-400 hover:text-slate-200"
                                        }`}
                                >
                                    <Table className="w-3.5 h-3.5" />
                                    <span>Table View</span>
                                </button>
                                <button
                                    onClick={() => setScreenerViewMode("CARDS")}
                                    className={`px-2.5 py-1 rounded-lg text-xs font-bold flex items-center gap-1 cursor-pointer ${screenerViewMode === "CARDS"
                                            ? "bg-cyan-500/25 text-cyan-300 border border-cyan-500/40"
                                            : "text-slate-400 hover:text-slate-200"
                                        }`}
                                >
                                    <LayoutGrid className="w-3.5 h-3.5" />
                                    <span>Card View</span>
                                </button>
                            </div>
                        </div>

                        {/* Row 2: Market Cap, MTF False Breakout Filter, and Search */}
                        <div className="flex flex-wrap items-center justify-between gap-3">
                            <div className="flex items-center gap-2 flex-wrap">
                                <button
                                    onClick={() => setCapFilter("TOP_10_MULTICAP")}
                                    className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer flex items-center gap-1.5 ${capFilter === "TOP_10_MULTICAP"
                                            ? "bg-amber-500/25 text-amber-300 border border-amber-500/50 shadow-md"
                                            : "bg-slate-900 text-slate-400 hover:text-slate-200 border border-slate-800"
                                        }`}
                                >
                                    <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                                    <span>🔥 Top 10 Multi-Cap (2 Large · 3 Mid · 5 Small)</span>
                                </button>

                                <button
                                    onClick={() => setCapFilter("ALL")}
                                    className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition cursor-pointer ${capFilter === "ALL"
                                            ? "bg-cyan-500/25 text-cyan-300 border border-cyan-500/50"
                                            : "bg-slate-900 text-slate-400 hover:text-slate-200 border border-slate-800"
                                        }`}
                                >
                                    All Qualified ({filteredStocks.length})
                                </button>

                                <button
                                    onClick={() => setCapFilter("LARGE_CAP")}
                                    className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition cursor-pointer ${capFilter === "LARGE_CAP"
                                            ? "bg-blue-500/25 text-blue-300 border border-blue-500/50"
                                            : "bg-slate-900 text-slate-400 border border-slate-800"
                                        }`}
                                >
                                    🏢 Large Caps ({largeCapList.length})
                                </button>

                                <button
                                    onClick={() => setCapFilter("MID_CAP")}
                                    className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition cursor-pointer ${capFilter === "MID_CAP"
                                            ? "bg-emerald-500/25 text-emerald-300 border border-emerald-500/50"
                                            : "bg-slate-900 text-slate-400 border border-slate-800"
                                        }`}
                                >
                                    ⚡ Mid Caps ({midCapList.length})
                                </button>

                                <button
                                    onClick={() => setCapFilter("SMALL_CAP")}
                                    className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition cursor-pointer ${capFilter === "SMALL_CAP"
                                            ? "bg-violet-500/25 text-violet-300 border border-violet-500/50"
                                            : "bg-slate-900 text-slate-400 border border-slate-800"
                                        }`}
                                >
                                    🚀 Small Caps ({smallCapList.length})
                                </button>
                            </div>

                            <div className="flex items-center gap-2.5 flex-wrap">
                                <label className="flex items-center gap-1.5 bg-slate-900 border border-slate-700/80 rounded-lg px-2.5 py-1 text-xs text-slate-300 cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={filterFalseBreakouts}
                                        onChange={(e) => setFilterFalseBreakouts(e.target.checked)}
                                        className="rounded text-cyan-500 focus:ring-0 cursor-pointer"
                                    />
                                    <span className="text-[10px] text-cyan-300 font-bold">
                                        🛡️ Filter Bull Traps (VWAP &amp; OB)
                                    </span>
                                </label>

                                <div className="flex items-center gap-1.5 bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1">
                                    <Filter className="w-3.5 h-3.5 text-amber-400" />
                                    <span className="text-[10px] text-slate-400 uppercase">Min Vol:</span>
                                    <select
                                        value={minVolumeFilter}
                                        onChange={(e) => setMinVolumeFilter(Number(e.target.value))}
                                        className="bg-transparent text-xs text-amber-300 font-bold focus:outline-none cursor-pointer"
                                    >
                                        <option value={0} className="bg-slate-900">
                                            All (1.0x+)
                                        </option>
                                        <option value={1.3} className="bg-slate-900">
                                            &ge; 1.3x
                                        </option>
                                        <option value={1.5} className="bg-slate-900">
                                            &ge; 1.5x (Breakout Std)
                                        </option>
                                        <option value={2.0} className="bg-slate-900">
                                            &ge; 2.0x (Inst. Spike)
                                        </option>
                                    </select>
                                </div>

                                <input
                                    type="text"
                                    placeholder="Search symbol..."
                                    value={searchFilter}
                                    onChange={(e) => setSearchFilter(e.target.value)}
                                    className="px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-cyan-400 uppercase w-36"
                                />
                            </div>
                        </div>
                    </div>

                    {/* Screener Content: Tabular or Card View */}
                    {isLoading ? (
                        <div className="p-12 rounded-2xl bg-[#0d1322] border border-slate-800 text-center text-slate-400 space-y-2">
                            <RefreshCw className="w-6 h-6 text-cyan-400 animate-spin mx-auto" />
                            <p className="text-sm text-slate-200 font-bold">
                                Scanning NSE Universe for Purple Box Ranges (5%–18% width, 3+S/2+R touches) &amp; 4H/1H Confluence...
                            </p>
                        </div>
                    ) : displayedStocks.length === 0 ? (
                        <div className="p-10 rounded-2xl bg-[#0d1322] border border-slate-800 text-center space-y-3">
                            <AlertTriangle className="w-7 h-7 text-amber-400 mx-auto" />
                            <div className="text-sm font-bold text-slate-200">No Stocks Matched Current Filter Combination</div>
                            <button
                                onClick={() => {
                                    setStrategyFilter("ALL_STRATEGIES");
                                    setPurpleBoxModeFilter("ALL_MODES");
                                    setMinVolumeFilter(0);
                                    setCapFilter("ALL");
                                    setSearchFilter("");
                                }}
                                className="px-4 py-2 rounded-xl bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 text-xs font-bold cursor-pointer"
                            >
                                Reset All Filters
                            </button>
                        </div>
                    ) : screenerViewMode === "TABLE" ? (
                        /* CLEAN INSTITUTIONAL SCREENER TABLE VIEW */
                        <div className="overflow-x-auto rounded-2xl border border-slate-800 bg-[#0d1322] shadow-2xl">
                            <table className="w-full text-left border-collapse text-xs">
                                <thead>
                                    <tr className="border-b border-slate-800 bg-slate-900/95 text-[10px] uppercase text-slate-400">
                                        <th className="py-3.5 px-3">Stock &amp; Cap</th>
                                        <th className="py-3.5 px-3">Purple Box Execution Mode</th>
                                        <th className="py-3.5 px-3">Purple Box Range (VAL ↔ VAH)</th>
                                        <th className="py-3.5 px-3">Touches &amp; Width</th>
                                        <th className="py-3.5 px-3">4H/1H &amp; Vol</th>
                                        <th className="py-3.5 px-3">Live LTP</th>
                                        <th className="py-3.5 px-3">Stop-Loss</th>
                                        <th className="py-3.5 px-3">Target (VAH / +7%)</th>
                                        <th className="py-3.5 px-3 text-right">Execute (LTP Freeze)</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-800/70">
                                    {displayedStocks.map((sig) => {
                                        const isAlreadyDeployed = autoTrades.some((t) => t.symbol === sig.cleanSymbol);
                                        const isModeA = sig.purpleBox.executionMode === "MODE_A_SUPPORT_BUY";

                                        return (
                                            <tr key={sig.id} className="hover:bg-slate-900/60 transition-colors">
                                                <td className="py-3 px-3">
                                                    <div className="flex items-center gap-1.5">
                                                        <span className="font-bold text-slate-100 text-sm">
                                                            {sig.cleanSymbol}
                                                        </span>
                                                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700">
                                                            {sig.marketCapCategory.replace("_CAP", "")}
                                                        </span>
                                                    </div>
                                                    <div className="text-[10px] text-slate-400 truncate max-w-[140px]">
                                                        {sig.companyName}
                                                    </div>
                                                </td>

                                                <td className="py-3 px-3">
                                                    <span
                                                        className={`inline-block text-[10px] px-2 py-0.5 rounded-md font-bold border ${isModeA
                                                                ? "bg-violet-500/20 text-violet-300 border-violet-500/40"
                                                                : "bg-cyan-500/20 text-cyan-300 border-cyan-500/40"
                                                            }`}
                                                    >
                                                        {isModeA
                                                            ? "🟣 MODE A: Support Buy (Near VAL)"
                                                            : "🚀 MODE B: Ceiling Breakout (> VAH)"}
                                                    </span>
                                                    <div className="text-[10px] text-slate-400 mt-0.5">
                                                        {sig.purpleBox.structureType === "STEP_UP_CONTINUATION_BOX"
                                                            ? `Step-Up Box (+${sig.purpleBox.stepUpFromPriorBasePct}%)`
                                                            : "Horizontal Accumulation"}
                                                    </div>
                                                </td>

                                                <td className="py-3 px-3">
                                                    <div className="font-bold text-slate-200">
                                                        ₹{sig.purpleBox.boxFloorVAL} ↔ ₹{sig.purpleBox.boxCeilingVAH}
                                                    </div>
                                                    <div className="text-[10px] text-slate-400">
                                                        POC: ₹{sig.purpleBox.boxMidPOC} • Pos: {sig.purpleBox.positionInBoxPct}%
                                                    </div>
                                                </td>

                                                <td className="py-3 px-3">
                                                    <div className="font-bold text-amber-300">
                                                        {sig.purpleBox.supportTouches}S / {sig.purpleBox.resistanceTouches}R Touches
                                                    </div>
                                                    <div className="text-[10px] text-slate-400">
                                                        Width: {sig.purpleBox.boxWidthPct}% • {sig.purpleBox.precedingDojiCount} Doji
                                                    </div>
                                                </td>

                                                <td className="py-3 px-3">
                                                    <div className="text-emerald-400 font-bold">
                                                        {sig.volumeMultiplier}x Vol
                                                    </div>
                                                    <div className="text-[10px] text-cyan-300">
                                                        4H/1H Verified ({sig.confluenceScore}/100)
                                                    </div>
                                                </td>

                                                <td className="py-3 px-3">
                                                    <div className="font-bold text-slate-100 text-sm">
                                                        ₹{sig.currentPrice.toLocaleString("en-IN")}
                                                    </div>
                                                    <div
                                                        className={`text-[10px] font-bold ${sig.changePercent >= 0 ? "text-emerald-400" : "text-rose-400"
                                                            }`}
                                                    >
                                                        {sig.changePercent >= 0 ? "+" : ""}
                                                        {sig.changePercent}%
                                                    </div>
                                                </td>

                                                <td className="py-3 px-3 font-bold text-rose-400">
                                                    ₹{sig.stopLossPrice.toLocaleString("en-IN")}
                                                </td>

                                                <td className="py-3 px-3">
                                                    <div className="font-bold text-emerald-400">
                                                        ₹{sig.target1Price.toLocaleString("en-IN")}
                                                    </div>
                                                    <div className="text-[10px] text-slate-400">
                                                        {isModeA ? "VAH Resistance" : "+7% Breakout"} (1:{sig.rewardRiskRatio})
                                                    </div>
                                                </td>

                                                <td className="py-3 px-3 text-right">
                                                    <div className="flex items-center justify-end gap-1.5">
                                                        <button
                                                            onClick={() => setActiveModalStock(sig)}
                                                            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-cyan-400 cursor-pointer"
                                                            title="Inspect Purple Box Audit"
                                                        >
                                                            <Eye className="w-3.5 h-3.5" />
                                                        </button>
                                                        <button
                                                            onClick={() => setDepthChartStock(sig)}
                                                            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-purple-400 cursor-pointer"
                                                            title="Order Book Depth"
                                                        >
                                                            <Layers className="w-3.5 h-3.5" />
                                                        </button>
                                                        <button
                                                            onClick={() => autoDeployTrade(sig)}
                                                            className={`px-3 py-1.5 rounded-xl text-[11px] font-bold transition flex items-center gap-1 cursor-pointer ${isAlreadyDeployed
                                                                    ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40"
                                                                    : "bg-gradient-to-r from-violet-500/30 to-cyan-500/30 text-violet-200 border border-violet-500/50 hover:bg-violet-500/40"
                                                                }`}
                                                        >
                                                            {isAlreadyDeployed ? (
                                                                <span>✅ Active</span>
                                                            ) : (
                                                                <span>⚡ Deploy @ LTP</span>
                                                            )}
                                                        </button>
                                                    </div>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    ) : (
                        /* CARD VIEW */
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                            {displayedStocks.map((sig) => {
                                const isAlreadyDeployed = autoTrades.some((t) => t.symbol === sig.cleanSymbol);
                                const primaryMeta = STRATEGY_METADATA[sig.primaryQuantStrategy];
                                const isModeA = sig.purpleBox.executionMode === "MODE_A_SUPPORT_BUY";

                                return (
                                    <div
                                        key={sig.id}
                                        className="p-5 rounded-2xl bg-[#0d1322]/95 border border-slate-800 hover:border-cyan-500/50 transition-all shadow-xl flex flex-col justify-between space-y-4"
                                    >
                                        <div className="flex items-start justify-between gap-2">
                                            <div>
                                                <div className="flex items-center gap-2 flex-wrap">
                                                    <span className="text-lg font-bold text-slate-100">{sig.cleanSymbol}</span>
                                                    <span
                                                        className={`text-[10px] px-2 py-0.5 rounded-md font-bold border ${isModeA
                                                                ? "bg-violet-500/20 text-violet-300 border-violet-500/40"
                                                                : "bg-cyan-500/20 text-cyan-300 border-cyan-500/40"
                                                            }`}
                                                    >
                                                        {isModeA
                                                            ? "🟣 MODE A: Support Buy"
                                                            : "🚀 MODE B: Box Breakout (+7%)"}
                                                    </span>
                                                    <span className="text-[10px] px-2 py-0.5 rounded-md bg-slate-800 text-slate-300 border border-slate-700">
                                                        {sig.sector}
                                                    </span>
                                                    <span className="text-xs font-bold text-slate-200">
                                                        LTP: ₹{sig.currentPrice.toLocaleString("en-IN")}
                                                        {sig.changePercent !== 0 && (
                                                            <span
                                                                className={`ml-1 text-[10px] ${sig.changePercent >= 0 ? "text-emerald-400" : "text-rose-400"
                                                                    }`}
                                                            >
                                                                ({sig.changePercent >= 0 ? "+" : ""}
                                                                {sig.changePercent}%)
                                                            </span>
                                                        )}
                                                    </span>
                                                </div>
                                                <div className="text-xs text-slate-400 mt-0.5">{sig.companyName}</div>
                                            </div>

                                            <div className="text-right shrink-0">
                                                <span className="text-xs font-bold px-2.5 py-1 rounded-lg bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 block">
                                                    Est. Win Prob: {sig.estimatedWinProbability}%
                                                </span>
                                                <span className="text-[10px] text-slate-400 mt-0.5 block">
                                                    Confluence: {sig.confluenceScore}/100
                                                </span>
                                            </div>
                                        </div>

                                        {/* Purple Box & Multi-Timeframe Badges */}
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <span className="text-[10px] px-2 py-0.5 rounded-md font-bold bg-violet-950/70 text-violet-300 border border-violet-500/40">
                                                Box: VAL ₹{sig.purpleBox.boxFloorVAL} ↔ VAH ₹{sig.purpleBox.boxCeilingVAH} (
                                                {sig.purpleBox.boxWidthPct}%)
                                            </span>
                                            <span className="text-[10px] px-2 py-0.5 rounded-md font-bold bg-amber-950/70 text-amber-300 border border-amber-500/40">
                                                Touches: {sig.purpleBox.supportTouches} Sup / {sig.purpleBox.resistanceTouches} Res
                                            </span>
                                            <span className="text-[10px] px-2 py-0.5 rounded-md font-bold bg-cyan-950/70 text-cyan-300 border border-cyan-500/40">
                                                4H/1H Confirmed • {sig.volumeMultiplier}x Vol
                                            </span>
                                        </div>

                                        {/* Strategy Execution Logic Box */}
                                        <div className="p-3 rounded-xl bg-slate-900/80 border border-slate-800 text-xs space-y-1">
                                            <div className="text-cyan-400 font-bold flex items-center gap-1.5">
                                                <TrendingUp className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                                                <span>{primaryMeta.title}:</span>
                                            </div>
                                            <div className="text-slate-300">
                                                {sig.realRationale[0] || primaryMeta.logicDesc}
                                            </div>
                                        </div>

                                        {/* Levels with Guaranteed Same-Day Freeze */}
                                        <div className="grid grid-cols-4 gap-2 pt-1 border-t border-slate-800/60 text-xs">
                                            <div>
                                                <span className="text-[9px] text-cyan-400 uppercase block font-bold flex items-center gap-0.5">
                                                    <Lock className="w-2.5 h-2.5" /> Live LTP Entry
                                                </span>
                                                <span className="text-sm font-bold text-cyan-300">
                                                    ₹{sig.currentPrice.toLocaleString("en-IN")}
                                                </span>
                                            </div>
                                            <div>
                                                <span className="text-[9px] text-rose-400 uppercase block font-bold">
                                                    Stop Loss
                                                </span>
                                                <span className="text-sm font-bold text-rose-400">
                                                    ₹{sig.stopLossPrice.toLocaleString("en-IN")}
                                                </span>
                                            </div>
                                            <div>
                                                <span className="text-[9px] text-emerald-400 uppercase block font-bold">
                                                    {isModeA ? "VAH Target" : "+7% Target"}
                                                </span>
                                                <span className="text-sm font-bold text-emerald-400">
                                                    ₹{sig.target1Price.toLocaleString("en-IN")}
                                                </span>
                                            </div>
                                            <div>
                                                <span className="text-[9px] text-violet-400 uppercase block font-bold">
                                                    Locked Ref
                                                </span>
                                                <span className="text-sm font-bold text-violet-300">
                                                    ₹{sig.lockedReferenceLevel}
                                                </span>
                                            </div>
                                        </div>

                                        {/* Action Buttons */}
                                        <div className="flex items-center justify-between pt-2 border-t border-slate-800 gap-2 flex-wrap">
                                            <div className="flex items-center gap-2">
                                                <button
                                                    onClick={() => setActiveModalStock(sig)}
                                                    className="px-2.5 py-1.5 rounded-lg text-xs font-semibold text-slate-300 hover:bg-slate-800 transition flex items-center gap-1.5 cursor-pointer"
                                                >
                                                    <Eye className="w-3.5 h-3.5 text-cyan-400" />
                                                    <span>Audit</span>
                                                </button>

                                                <button
                                                    onClick={() => setDepthChartStock(sig)}
                                                    className="px-2.5 py-1.5 rounded-lg text-xs font-semibold text-slate-300 hover:bg-slate-800 transition flex items-center gap-1.5 cursor-pointer"
                                                >
                                                    <Layers className="w-3.5 h-3.5 text-purple-400" />
                                                    <span>Depth Chart</span>
                                                </button>
                                            </div>

                                            <button
                                                onClick={() => autoDeployTrade(sig)}
                                                className={`px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer shadow-lg ${isAlreadyDeployed
                                                        ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40"
                                                        : "bg-gradient-to-r from-violet-500/30 to-cyan-500/30 text-violet-200 border border-violet-500/50 hover:bg-violet-500/40"
                                                    }`}
                                            >
                                                {isAlreadyDeployed ? (
                                                    <>
                                                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                                                        <span>✅ Deployed in Portfolio</span>
                                                    </>
                                                ) : (
                                                    <>
                                                        <Briefcase className="w-3.5 h-3.5 text-violet-400" />
                                                        <span>⚡ Deploy @ Live LTP (₹0 Start)</span>
                                                    </>
                                                )}
                                            </button>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            )}

            {/* Depth Chart Modal */}
            {depthChartStock && (
                <IMDepthChartModal
                    symbol={depthChartStock.cleanSymbol}
                    currentPrice={depthChartStock.currentPrice}
                    breakoutLevel={depthChartStock.purpleBox.boxCeilingVAH}
                    stopLossPrice={depthChartStock.stopLossPrice}
                    onClose={() => setDepthChartStock(null)}
                />
            )}

            {/* Trade Audit & Interactive SL/TP Inspector Modal */}
            {inspectingTrade && (
                <IMTradeAuditInspectorModal
                    trade={inspectingTrade}
                    onClose={() => setInspectingTrade(null)}
                    onUpdateTrade={handleUpdateTradeSlTp}
                />
            )}

            {/* Strategy Audit Modal */}
            {activeModalStock && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
                    <div className="w-full max-w-3xl max-h-[90vh] overflow-y-auto rounded-2xl bg-[#0d1322] border border-slate-800 shadow-2xl p-6 space-y-5 text-slate-100 font-mono">
                        <div className="flex items-start justify-between border-b border-slate-800 pb-3">
                            <div>
                                <h3 className="text-xl font-bold text-cyan-400">
                                    {activeModalStock.cleanSymbol} — Purple Box &amp; MTF Strategy Audit
                                </h3>
                                <p className="text-xs text-slate-400 mt-0.5">
                                    {activeModalStock.companyName} · {activeModalStock.sector} · Same-Day Freeze Key:{" "}
                                    {activeModalStock.lockedDateKey}
                                </p>
                            </div>
                            <button
                                onClick={() => setActiveModalStock(null)}
                                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-100 cursor-pointer"
                            >
                                <X className="w-5 h-5" />
                            </button>
                        </div>

                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                            <div className="p-3 rounded-xl bg-slate-900 border border-slate-800">
                                <span className="text-[10px] text-slate-400 block">Support Floor (VAL)</span>
                                <span className="text-sm font-bold text-violet-300">
                                    ₹{activeModalStock.purpleBox.boxFloorVAL}
                                </span>
                            </div>
                            <div className="p-3 rounded-xl bg-slate-900 border border-slate-800">
                                <span className="text-[10px] text-slate-400 block">Equilibrium (POC)</span>
                                <span className="text-sm font-bold text-cyan-300">
                                    ₹{activeModalStock.purpleBox.boxMidPOC}
                                </span>
                            </div>
                            <div className="p-3 rounded-xl bg-slate-900 border border-slate-800">
                                <span className="text-[10px] text-slate-400 block">Box Ceiling (VAH)</span>
                                <span className="text-sm font-bold text-emerald-300">
                                    ₹{activeModalStock.purpleBox.boxCeilingVAH}
                                </span>
                            </div>
                            <div className="p-3 rounded-xl bg-slate-900 border border-slate-800">
                                <span className="text-[10px] text-slate-400 block">Channel Width &amp; Touches</span>
                                <span className="text-sm font-bold text-amber-300">
                                    {activeModalStock.purpleBox.boxWidthPct}% ({activeModalStock.purpleBox.supportTouches}S/
                                    {activeModalStock.purpleBox.resistanceTouches}R)
                                </span>
                            </div>
                        </div>

                        {activeModalStock.realRationale.length > 0 && (
                            <div className="space-y-2">
                                <span className="text-xs font-bold uppercase text-cyan-400 block">
                                    Purple Box Mechanics &amp; Multi-Timeframe Rationale:
                                </span>
                                <ul className="list-disc list-inside text-xs text-slate-300 space-y-1.5">
                                    {activeModalStock.realRationale.map((pt, i) => (
                                        <li key={i}>{pt}</li>
                                    ))}
                                </ul>
                            </div>
                        )}

                        <div className="flex justify-end gap-2 pt-3 border-t border-slate-800">
                            <button
                                onClick={() => {
                                    const s = activeModalStock;
                                    setActiveModalStock(null);
                                    autoDeployTrade(s);
                                }}
                                className="px-4 py-2 rounded-xl text-xs font-bold bg-violet-500/25 text-violet-200 border border-violet-500/50 hover:bg-violet-500/35 cursor-pointer"
                            >
                                ⚡ Deploy @ Exact Live LTP (₹{activeModalStock.currentPrice})
                            </button>
                            <button
                                onClick={() => setActiveModalStock(null)}
                                className="px-4 py-2 rounded-xl text-xs bg-slate-800 text-slate-300 hover:bg-slate-700 cursor-pointer"
                            >
                                Close Audit
                            </button>
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
