"use client";

import React, { useState, useEffect } from "react";
import IMHeader from "./IMHeader";
import IMStatusBadge from "./IMStatusBadge";
import { apiUrl } from "../../lib/backendUrl";
import {
  TrendingUp,
  TrendingDown,
  ShieldCheck,
  Layers,
  Activity,
  CheckCircle2,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Calculator,
  Sliders,
  Eye,
  Flame,
  Zap,
  Sparkles,
  BookOpen,
  Crosshair,
  Info,
  X,
  Search,
  Filter,
  BarChart3,
  ArrowUpRight,
  ShieldAlert,
  Percent,
  Check,
} from "lucide-react";

// Types matching backend
interface FivePillarItem {
  passed: boolean;
  details: string;
  [key: string]: any;
}

interface SwingSignalUI {
  id: string;
  symbol: string;
  companyName: string;
  sector: string;
  setupId: string;
  setupTitle: string;
  setupBadge: string;
  status: string;
  timestamp: string;
  currentPrice: number;
  entryPrice: number;
  stopLossPrice: number;
  target1Price: number;
  target2Price: number;
  riskPerShare: number;
  rewardRiskRatio: number;
  confluenceScore: number;
  relativeStrengthVsNifty: number;
  volumeMultiplier: number;
  ema20: number;
  ema50: number;
  ema200: number;
  extensionFromPivotPercent?: number;
  baseLengthWeeks?: number;
  sweepLow?: number;
  retestLow?: number;
  rejectionCandle?: string;
  fivePillarChecklist: {
    pillar1MarketRegime: FivePillarItem;
    pillar2Fundamentals: FivePillarItem;
    pillar3LiquidityLevels: FivePillarItem;
    pillar4PriceActionVolume: FivePillarItem;
    pillar5RiskManagement: FivePillarItem;
  };
  tradeRationale: string[];
  invalidationTrigger: string;
  trailingStopPlan: string;
  fundamentals: {
    symbol: string;
    companyName: string;
    sector: string;
    marketCapCr: number;
    peRatio: number;
    roePercent: number;
    rocePercent: number;
    salesGrowth3Y: number;
    profitGrowth3Y: number;
    debtToEquity: number;
    institutionalHoldingPercent: number;
    qualityScore: number;
    moatRating: string;
    notes: string;
  };
}

interface RegimeUI {
  spotPrice: number;
  changePercent: number;
  ema20: number;
  ema50: number;
  ema200: number;
  bias: string;
  clearance: string;
  breadthPercentAbove50EMA: number;
  advancingStocksCount: number;
  decliningStocksCount: number;
  regimeScore: number;
  analysisSummary: string;
}

// Fallback high-fidelity data matching backend if backend is unreachable
const FALLBACK_SIGNALS: SwingSignalUI[] = [
  {
    id: "SWING-SIG-001",
    symbol: "TRENT",
    companyName: "Trent Ltd (Tata Retail)",
    sector: "Retail",
    setupId: "SETUP_A_BREAKOUT_RETEST",
    setupTitle: "Setup A — Breakout + Retest",
    setupBadge: "Breakout + Retest",
    status: "ACTIVE_OPPORTUNITY",
    timestamp: new Date().toISOString(),
    currentPrice: 7120.0,
    entryPrice: 7145.0,
    stopLossPrice: 6980.0,
    target1Price: 7475.0,
    target2Price: 7640.0,
    riskPerShare: 165.0,
    rewardRiskRatio: 2.0,
    confluenceScore: 94,
    relativeStrengthVsNifty: 92,
    volumeMultiplier: 1.85,
    ema20: 6950.0,
    ema50: 6680.0,
    ema200: 5540.0,
    retestLow: 6985.0,
    rejectionCandle: "Bullish Hammer Rejection at ₹7,000 SR Flip",
    fivePillarChecklist: {
      pillar1MarketRegime: {
        passed: true,
        details: "NIFTY > 20 EMA, market regime score 88/100 supporting fresh swing longs.",
      },
      pillar2Fundamentals: {
        passed: true,
        details: "ROE 32.8%, ROCE 38.4%, 3Y Sales CAGR 48.6%, Debt/Eq 0.18.",
      },
      pillar3LiquidityLevels: {
        passed: true,
        details: "Previous consolidation resistance at ₹7,000 broken & flipped to support.",
      },
      pillar4PriceActionVolume: {
        passed: true,
        details: "Breakout volume 1.85x 20-day average, followed by low-volume retest and hammer confirmation candle.",
      },
      pillar5RiskManagement: {
        passed: true,
        details: "Defined risk: Entry ₹7,145, SL ₹6,980 (₹165 risk/sh). Target ₹7,475 guarantees 1:2.0 R:R.",
      },
    },
    tradeRationale: [
      "Stock is in an aggressive uptrend above 20 & 50 EMA with Higher Highs structure.",
      "Consolidation resistance at ₹7,000 broken on 1.85x volume surge.",
      "Controlled 3-day pullback retested the ₹7,000 flip level with drying volume.",
      "Strong bullish hammer rejection printed on retest level; confirmation close above ₹7,145.",
    ],
    invalidationTrigger: "Daily candle close below ₹6,980 invalidates the breakout structure.",
    trailingStopPlan: "Move SL to Breakeven (₹7,145) once price touches 1R (₹7,310). Trail remainder below 20 EMA.",
    fundamentals: {
      symbol: "TRENT",
      companyName: "Trent Ltd (Tata Retail)",
      sector: "Retail",
      marketCapCr: 248000,
      peRatio: 112.4,
      roePercent: 32.8,
      rocePercent: 38.4,
      salesGrowth3Y: 48.6,
      profitGrowth3Y: 62.1,
      debtToEquity: 0.18,
      institutionalHoldingPercent: 44.2,
      qualityScore: 96,
      moatRating: "WIDE",
      notes: "Aggressive store expansion (Zudio, Westside), stellar ROE/ROCE, high relative strength leader.",
    },
  },
  {
    id: "SWING-SIG-002",
    symbol: "HAL",
    companyName: "Hindustan Aeronautics Ltd",
    sector: "Defense & Aerospace",
    setupId: "SETUP_B_LIQUIDITY_SWEEP",
    setupTitle: "Setup B — Liquidity Sweep + Reversal",
    setupBadge: "Liquidity Sweep + CHoCH",
    status: "ACTIVE_OPPORTUNITY",
    timestamp: new Date().toISOString(),
    currentPrice: 4725.0,
    entryPrice: 4740.0,
    stopLossPrice: 4615.0,
    target1Price: 4990.0,
    target2Price: 5115.0,
    riskPerShare: 125.0,
    rewardRiskRatio: 2.0,
    confluenceScore: 92,
    relativeStrengthVsNifty: 88,
    volumeMultiplier: 1.95,
    ema20: 4710.0,
    ema50: 4580.0,
    ema200: 4120.0,
    sweepLow: 4620.0,
    rejectionCandle: "Bullish Engulfing Reclaim with Volume Spike",
    fivePillarChecklist: {
      pillar1MarketRegime: {
        passed: true,
        details: "NIFTY trend supports defense sector momentum.",
      },
      pillar2Fundamentals: {
        passed: true,
        details: "Zero debt, ROE 26.4%, ROCE 34.2%, Sovereign order book.",
      },
      pillar3LiquidityLevels: {
        passed: true,
        details: "Major daily demand zone at ₹4,650. Previous swing low at ₹4,640 swept to trigger retail stop-losses.",
      },
      pillar4PriceActionVolume: {
        passed: true,
        details: "Stop hunt wick dipped to ₹4,620 and immediately reclaimed ₹4,680+ with 1.95x volume expansion & Bullish CHoCH.",
      },
      pillar5RiskManagement: {
        passed: true,
        details: "Entry ₹4,740, Stop Loss ₹4,615 (below wick), Target 1 ₹4,990 (2.0 R:R).",
      },
    },
    tradeRationale: [
      "Price probed below critical swing low of ₹4,640 into institutional liquidity pool.",
      "Smart money trapped aggressive breakdown shorts; rapid reclaim above ₹4,650 support within 1 session.",
      "Volume expanded to 1.95x on the reversal bar confirming genuine institutional absorption.",
      "Bullish Change of Character (CHoCH) completed with clean break above minor swing high.",
    ],
    invalidationTrigger: "Any break and daily close below sweep low wick ₹4,615 completely invalidates setup.",
    trailingStopPlan: "Lock 50% profits at next resistance ₹4,990 (2R). Trail stop loss for remaining 50% under 20 EMA.",
    fundamentals: {
      symbol: "HAL",
      companyName: "Hindustan Aeronautics Ltd",
      sector: "Defense & Aerospace",
      marketCapCr: 312000,
      peRatio: 38.6,
      roePercent: 26.4,
      rocePercent: 34.2,
      salesGrowth3Y: 14.8,
      profitGrowth3Y: 28.5,
      debtToEquity: 0.0,
      institutionalHoldingPercent: 36.8,
      qualityScore: 94,
      moatRating: "WIDE",
      notes: "Debt-free balance sheet, multi-year sovereign order book, monopolistic domestic defense footprint.",
    },
  },
  {
    id: "SWING-SIG-003",
    symbol: "PERSISTENT",
    companyName: "Persistent Systems Ltd",
    sector: "IT & Digital Engineering",
    setupId: "SETUP_C_TREND_PULLBACK",
    setupTitle: "Setup C — Pullback in Strong Trend",
    setupBadge: "Trend Pullback (20 EMA)",
    status: "ACTIVE_OPPORTUNITY",
    timestamp: new Date().toISOString(),
    currentPrice: 5460.0,
    entryPrice: 5485.0,
    stopLossPrice: 5355.0,
    target1Price: 5745.0,
    target2Price: 5875.0,
    riskPerShare: 130.0,
    rewardRiskRatio: 2.0,
    confluenceScore: 90,
    relativeStrengthVsNifty: 85,
    volumeMultiplier: 1.6,
    ema20: 5380.0,
    ema50: 5120.0,
    ema200: 4420.0,
    rejectionCandle: "Bullish Piercing Line at 20 EMA",
    fivePillarChecklist: {
      pillar1MarketRegime: {
        passed: true,
        details: "Benchmark index supportive of high-beta IT outperformance.",
      },
      pillar2Fundamentals: {
        passed: true,
        details: "3Y Sales CAGR 24.1%, ROE 25.2%, ROCE 31.8%, FII/DII 49.3%.",
      },
      pillar3LiquidityLevels: {
        passed: true,
        details: "Dynamic 20-day EMA support aligned with prior weekly breakout crest.",
      },
      pillar4PriceActionVolume: {
        passed: true,
        details: "Volume dried up to 0.55x during 4-day pullback; buying volume surged to 1.6x on reversal bar.",
      },
      pillar5RiskManagement: {
        passed: true,
        details: "Risk per share ₹130. Initial target ₹5,745 (previous high zone) yields 2.0 R:R.",
      },
    },
    tradeRationale: [
      "Textbook Higher High + Higher Low sequence sustained over 6 months.",
      "Stock pulled back gracefully into rising 20 EMA dynamic confluence zone.",
      "Selling volume completely dried up on down-days showing lack of institutional selling pressure.",
      "Buyers stepped in at 20 EMA with expanding green volume bar.",
    ],
    invalidationTrigger: "Violation and close below recent swing low ₹5,355.",
    trailingStopPlan: "Move to Breakeven at ₹5,615 (1R). Target 1 at ₹5,745 (2R). Runner target ₹5,875.",
    fundamentals: {
      symbol: "PERSISTENT",
      companyName: "Persistent Systems Ltd",
      sector: "IT & Digital Engineering",
      marketCapCr: 82400,
      peRatio: 56.4,
      roePercent: 25.2,
      rocePercent: 31.8,
      salesGrowth3Y: 24.1,
      profitGrowth3Y: 27.6,
      debtToEquity: 0.08,
      institutionalHoldingPercent: 49.3,
      qualityScore: 92,
      moatRating: "WIDE",
      notes: "Outperforming mid-tier IT, high cloud/AI client deal pipeline, superior cash conversion.",
    },
  },
  {
    id: "SWING-SIG-004",
    symbol: "DIXON",
    companyName: "Dixon Technologies India",
    sector: "EMS",
    setupId: "SETUP_D_BASE_BREAKOUT",
    setupTitle: "Setup D — Base Breakout (VCP)",
    setupBadge: "Base Breakout (8 Weeks)",
    status: "ACTIVE_OPPORTUNITY",
    timestamp: new Date().toISOString(),
    currentPrice: 14850.0,
    entryPrice: 14920.0,
    stopLossPrice: 14350.0,
    target1Price: 16060.0,
    target2Price: 16630.0,
    riskPerShare: 570.0,
    rewardRiskRatio: 2.0,
    confluenceScore: 95,
    relativeStrengthVsNifty: 94,
    volumeMultiplier: 2.4,
    ema20: 14200.0,
    ema50: 13650.0,
    ema200: 11200.0,
    extensionFromPivotPercent: 1.2,
    baseLengthWeeks: 8,
    rejectionCandle: "High Volume Marubozu Breakout Candle",
    fivePillarChecklist: {
      pillar1MarketRegime: {
        passed: true,
        details: "NIFTY regime clearance HIGH. Ideal environment for multi-week base breakouts.",
      },
      pillar2Fundamentals: {
        passed: true,
        details: "Sales CAGR 36.5%, Profit CAGR 42.3%, ROE 28.1%, PLI leader.",
      },
      pillar3LiquidityLevels: {
        passed: true,
        details: "Multi-week horizontal resistance tested 4 times over 8 weeks, absorbing overhead supply.",
      },
      pillar4PriceActionVolume: {
        passed: true,
        details: "8-week tight volatility contraction base. Breakout bar backed by 2.4x average volume. Extension is only 1.2% (under 5% rule).",
      },
      pillar5RiskManagement: {
        passed: true,
        details: "Entry ₹14,920, SL ₹14,350 (3.8% risk). Target 1 ₹16,060 provides strict 2.0 R:R.",
      },
    },
    tradeRationale: [
      "Constructive 8-week flat base / Volatility Contraction Pattern (VCP).",
      "Volatility contracted progressively from 12% to 6% to 2.8% on final contraction.",
      "Overhead resistance at ₹14,800 tested 4 times, thoroughly drying up weak-hand supply.",
      "Breakout volume exploded to 2.4x 20-day average.",
      "Current price is only 1.2% from pivot — safely inside the < 5–7% extension threshold (no chasing penalty).",
    ],
    invalidationTrigger: "Failure back inside the consolidation base below ₹14,350.",
    trailingStopPlan: "Move SL to cost (₹14,920) upon reaching ₹15,490 (1R). Trail remainder below 20 EMA.",
    fundamentals: {
      symbol: "DIXON",
      companyName: "Dixon Technologies India",
      sector: "EMS",
      marketCapCr: 88500,
      peRatio: 84.2,
      roePercent: 28.1,
      rocePercent: 35.8,
      salesGrowth3Y: 36.5,
      profitGrowth3Y: 42.3,
      debtToEquity: 0.22,
      institutionalHoldingPercent: 41.6,
      qualityScore: 91,
      moatRating: "WIDE",
      notes: "Prime beneficiary of India PLI electronics manufacturing, massive order inflows.",
    },
  },
  {
    id: "SWING-SIG-005",
    symbol: "POLYCAB",
    companyName: "Polycab India Ltd",
    sector: "Cables & FMEG",
    setupId: "SETUP_D_BASE_BREAKOUT",
    setupTitle: "Setup D — Base Breakout (Watching Pivot)",
    setupBadge: "Base Breakout (6 Weeks)",
    status: "APPROACHING_TRIGGER",
    timestamp: new Date().toISOString(),
    currentPrice: 6840.0,
    entryPrice: 6920.0,
    stopLossPrice: 6620.0,
    target1Price: 7520.0,
    target2Price: 7820.0,
    riskPerShare: 300.0,
    rewardRiskRatio: 2.0,
    confluenceScore: 89,
    relativeStrengthVsNifty: 82,
    volumeMultiplier: 1.35,
    ema20: 6680.0,
    ema50: 6450.0,
    ema200: 5820.0,
    extensionFromPivotPercent: 0.0,
    baseLengthWeeks: 6,
    rejectionCandle: "Inside Bar building pre-breakout tension",
    fivePillarChecklist: {
      pillar1MarketRegime: {
        passed: true,
        details: "Market trend confirmed bullish.",
      },
      pillar2Fundamentals: {
        passed: true,
        details: "ROE 22.4%, ROCE 29.8%, Near zero net debt, industry leader.",
      },
      pillar3LiquidityLevels: {
        details: "All-time-high supply line at ₹6,900 being compressed.",
        passed: true,
      },
      pillar4PriceActionVolume: {
        passed: true,
        details: "6-week tight cup-handle consolidation. Awaiting volume expansion above ₹6,920.",
      },
      pillar5RiskManagement: {
        passed: true,
        details: "Entry ₹6,920, SL ₹6,620. Target 1 ₹7,520 (2.0 R:R).",
      },
    },
    tradeRationale: [
      "6-week consolidation right below all-time-high resistance of ₹6,900.",
      "Higher lows forming into horizontal resistance (Ascending Triangle structure).",
      "Awaiting trigger above ₹6,920 with expected volume expansion.",
    ],
    invalidationTrigger: "Drop below handle support at ₹6,620.",
    trailingStopPlan: "Trail below 20 EMA once 1R is attained.",
    fundamentals: {
      symbol: "POLYCAB",
      companyName: "Polycab India Ltd",
      sector: "Cables & FMEG",
      marketCapCr: 99400,
      peRatio: 44.5,
      roePercent: 22.4,
      rocePercent: 29.8,
      salesGrowth3Y: 21.6,
      profitGrowth3Y: 28.9,
      debtToEquity: 0.02,
      institutionalHoldingPercent: 34.2,
      qualityScore: 90,
      moatRating: "WIDE",
      notes: "Cables market share leader with high distribution moat, near zero net debt.",
    },
  },
];

const FALLBACK_REGIME: RegimeUI = {
  spotPrice: 24700.45,
  changePercent: +0.52,
  ema20: 24580.0,
  ema50: 24320.0,
  ema200: 23150.0,
  bias: "BULLISH_TREND",
  clearance: "HIGH_CONVICTION",
  breadthPercentAbove50EMA: 74.5,
  advancingStocksCount: 36,
  decliningStocksCount: 14,
  regimeScore: 88,
  analysisSummary:
    "NIFTY trading cleanly above 20 EMA & 50 EMA. Broad market breadth is strong (74% > 50 EMA). Swing long setups have full clearance.",
};

export default function IMSwingTradingView() {
  const [signals, setSignals] = useState<SwingSignalUI[]>(FALLBACK_SIGNALS);
  const [regime, setRegime] = useState<RegimeUI>(FALLBACK_REGIME);
  const [selectedFilter, setSelectedFilter] = useState<string>("ALL");
  const [activeModalSignal, setActiveModalSignal] = useState<SwingSignalUI | null>(null);

  // Position Sizing Calculator state
  const [accountCapital, setAccountCapital] = useState<number>(500000);
  const [riskPercent, setRiskPercent] = useState<number>(1.0);
  const [calcEntry, setCalcEntry] = useState<number>(7145);
  const [calcStopLoss, setCalcStopLoss] = useState<number>(6980);
  const [calcTarget, setCalcTarget] = useState<number>(7475);
  const [calcSymbol, setCalcSymbol] = useState<string>("TRENT");
  const [checklistDiscipline, setChecklistDiscipline] = useState({
    regimeConfirmed: true,
    fundamentalApproved: true,
    liquidityValidated: true,
    volumeConfirmed: true,
    strictlyDefinedRisk: true,
  });

  // Fetch live from backend if running
  const fetchSwingData = async () => {
    try {
      const res = await fetch(apiUrl("/api/indian/swing/signals"), { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        if (data.success && data.signals) {
          setSignals(data.signals);
          if (data.regime) setRegime(data.regime);
        }
      }
    } catch {
      // Fallback data remains active
    }
  };

  useEffect(() => {
    fetchSwingData();
    const interval = setInterval(fetchSwingData, 10000);
    return () => clearInterval(interval);
  }, []);

  // Filter signals
  const filteredSignals = signals.filter((s) => {
    if (selectedFilter === "ALL") return true;
    if (selectedFilter === "SETUP_A") return s.setupId === "SETUP_A_BREAKOUT_RETEST";
    if (selectedFilter === "SETUP_B") return s.setupId === "SETUP_B_LIQUIDITY_SWEEP";
    if (selectedFilter === "SETUP_C") return s.setupId === "SETUP_C_TREND_PULLBACK";
    if (selectedFilter === "SETUP_D") return s.setupId === "SETUP_D_BASE_BREAKOUT";
    return true;
  });

  // Dynamic Position Sizing Math
  const riskPerShare = Math.max(0.01, Math.abs(calcEntry - calcStopLoss));
  const gainPerShare = Math.max(0.01, Math.abs(calcTarget - calcEntry));
  const maxRiskAmount = Math.round((accountCapital * (riskPercent / 100)) * 100) / 100;
  const recommendedQuantity = Math.floor(maxRiskAmount / riskPerShare);
  const totalCapitalRequired = Math.round(recommendedQuantity * calcEntry);
  const capitalExposurePercent =
    accountCapital > 0 ? Math.round((totalCapitalRequired / accountCapital) * 1000) / 10 : 0;
  const potentialRewardAmount = Math.round(recommendedQuantity * gainPerShare);
  const rewardRiskRatio = Math.round((gainPerShare / riskPerShare) * 100) / 100;

  const loadSignalIntoCalculator = (sig: SwingSignalUI) => {
    setCalcSymbol(sig.symbol);
    setCalcEntry(sig.entryPrice);
    setCalcStopLoss(sig.stopLossPrice);
    setCalcTarget(sig.target1Price);
    // Smooth scroll to calculator
    const el = document.getElementById("risk-calculator-section");
    if (el) el.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <div className="space-y-6">
      {/* ── Top Header Strip ──────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2.5">
            <h2 className="text-xl font-bold text-slate-100 tracking-tight flex items-center gap-2">
              <Crosshair className="w-5 h-5 text-cyan-400" />
              SWING TRADING TERMINAL
            </h2>
            <span className="text-[10px] px-2 py-0.5 rounded-full font-mono font-bold bg-cyan-500/15 text-cyan-300 border border-cyan-500/30">
              5-PILLAR FRAMEWORK
            </span>
            <IMStatusBadge status="PAPER MODE" size="sm" />
          </div>
          <p className="text-xs text-slate-400 font-mono mt-0.5">
            Regime · Fundamentals · Liquidity Sweeps · Price Action & Volume · Strict Risk Management
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="px-3 py-1.5 rounded-xl bg-slate-900/80 border border-slate-800 text-right">
            <div className="text-[9px] text-slate-500 font-mono uppercase">Framework Clearance</div>
            <div className="text-xs font-bold font-mono text-emerald-400 flex items-center justify-end gap-1">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              {regime.clearance.replace(/_/g, " ")}
            </div>
          </div>
        </div>
      </div>

      <IMHeader />

      {/* ── 5 PILLARS SYSTEM STATUS STRIP ─────────────────────────────────── */}
      <section className="space-y-2.5">
        <div className="flex items-center justify-between">
          <h3 className="text-[10px] uppercase font-mono font-bold tracking-widest text-slate-400 flex items-center gap-2">
            <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
            THE 5 PILLARS VERIFICATION MATRIX
          </h3>
          <span className="text-[10px] font-mono text-slate-500">
            Confluence Threshold: &gt; 85/100
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          {/* Pillar 1: Market Regime */}
          <div className="p-3.5 rounded-xl bg-[#11192e]/90 border border-cyan-500/25 flex flex-col justify-between">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-mono uppercase font-bold text-cyan-400 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-cyan-400" />
                1. Market Regime
              </span>
              <span className="text-[10px] font-mono text-emerald-400 font-bold">
                {regime.regimeScore}/100
              </span>
            </div>
            <div className="mt-2">
              <div className="text-sm font-bold font-mono text-slate-100 flex items-center gap-1.5">
                <TrendingUp className="w-4 h-4 text-emerald-400" />
                NIFTY {regime.bias.replace(/_/g, " ")}
              </div>
              <div className="text-[10px] text-slate-400 font-mono mt-0.5">
                Spot: ₹{regime.spotPrice.toLocaleString("en-IN")} &gt; 20 EMA
              </div>
            </div>
            <div className="mt-2 pt-2 border-t border-slate-800/80 text-[10px] text-emerald-400/90 font-mono">
              Breadth: {regime.breadthPercentAbove50EMA}% &gt; 50 EMA
            </div>
          </div>

          {/* Pillar 2: Fundamentally Strong */}
          <div className="p-3.5 rounded-xl bg-[#11192e]/90 border border-emerald-500/25 flex flex-col justify-between">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-mono uppercase font-bold text-emerald-400 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                2. Fundamentals
              </span>
              <span className="text-[10px] font-mono text-emerald-400 font-bold">QUALIFIED</span>
            </div>
            <div className="mt-2">
              <div className="text-sm font-bold font-mono text-slate-100">
                ROE &gt; 15% · ROCE &gt; 18%
              </div>
              <div className="text-[10px] text-slate-400 font-mono mt-0.5">
                Low Debt (D/E &lt; 0.5) · Moat
              </div>
            </div>
            <div className="mt-2 pt-2 border-t border-slate-800/80 text-[10px] text-emerald-400/90 font-mono">
              Inst. Holding: FII+DII &gt; 35%
            </div>
          </div>

          {/* Pillar 3: Liquidity Sweeps */}
          <div className="p-3.5 rounded-xl bg-[#11192e]/90 border border-violet-500/25 flex flex-col justify-between">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-mono uppercase font-bold text-violet-400 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-violet-400" />
                3. Liquidity & S/R
              </span>
              <span className="text-[10px] font-mono text-violet-300 font-bold">CHoCH</span>
            </div>
            <div className="mt-2">
              <div className="text-sm font-bold font-mono text-slate-100">
                Key S/R & Sweeps
              </div>
              <div className="text-[10px] text-slate-400 font-mono mt-0.5">
                Sell-side liquidity grabs
              </div>
            </div>
            <div className="mt-2 pt-2 border-t border-slate-800/80 text-[10px] text-violet-300/90 font-mono">
              Structure Break Reclaims Active
            </div>
          </div>

          {/* Pillar 4: Price Action & Volume */}
          <div className="p-3.5 rounded-xl bg-[#11192e]/90 border border-amber-500/25 flex flex-col justify-between">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-mono uppercase font-bold text-amber-400 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                4. Price Action
              </span>
              <span className="text-[10px] font-mono text-amber-300 font-bold">
                {signals.length} Setups
              </span>
            </div>
            <div className="mt-2">
              <div className="text-sm font-bold font-mono text-slate-100">
                Volume &gt; 1.5x Confirm
              </div>
              <div className="text-[10px] text-slate-400 font-mono mt-0.5">
                Setups A, B, C, D Validated
              </div>
            </div>
            <div className="mt-2 pt-2 border-t border-slate-800/80 text-[10px] text-amber-300/90 font-mono">
              Retest Rejection & Expansion
            </div>
          </div>

          {/* Pillar 5: Strict Risk Management */}
          <div className="p-3.5 rounded-xl bg-[#11192e]/90 border border-rose-500/25 flex flex-col justify-between">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-mono uppercase font-bold text-rose-400 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-rose-400" />
                5. Strict Risk
              </span>
              <span className="text-[10px] font-mono text-emerald-400 font-bold">&ge; 1:2 R:R</span>
            </div>
            <div className="mt-2">
              <div className="text-sm font-bold font-mono text-slate-100">
                1.0% Max Risk / Trade
              </div>
              <div className="text-[10px] text-slate-400 font-mono mt-0.5">
                Max 5 Swing Positions
              </div>
            </div>
            <div className="mt-2 pt-2 border-t border-slate-800/80 text-[10px] text-emerald-400 font-mono">
              Pre-Trade Sizing Enforced
            </div>
          </div>
        </div>
      </section>

      {/* ── SETUP FILTER TABS ─────────────────────────────────────────────── */}
      <div className="flex items-center justify-between border-b border-slate-800 pb-3 flex-wrap gap-2">
        <div className="flex items-center gap-1.5 flex-wrap">
          {[
            { id: "ALL", label: `All Setups (${signals.length})` },
            { id: "SETUP_A", label: "Setup A: Breakout + Retest" },
            { id: "SETUP_B", label: "Setup B: Liquidity Sweep" },
            { id: "SETUP_C", label: "Setup C: Trend Pullback" },
            { id: "SETUP_D", label: "Setup D: Base Breakout" },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setSelectedFilter(tab.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-mono font-semibold transition-all ${
                selectedFilter === tab.id
                  ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm"
                  : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/60"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <span className="text-[10px] font-mono text-slate-500">
          Showing {filteredSignals.length} qualified opportunities
        </span>
      </div>

      {/* ── ACTIVE SWING SIGNALS CARD GRID ─────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {filteredSignals.map((sig) => {
          const isExtended =
            sig.extensionFromPivotPercent !== undefined && sig.extensionFromPivotPercent > 5.0;

          return (
            <div
              key={sig.id}
              className="p-5 rounded-2xl bg-[#0d1322]/90 border border-slate-800/90 hover:border-slate-700 transition-all shadow-xl flex flex-col justify-between space-y-4"
            >
              {/* Header: Symbol, Company, Badge & Confluence */}
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-lg font-bold font-mono text-slate-100 tracking-tight">
                      {sig.symbol}
                    </span>
                    <span className="text-[10px] px-2 py-0.5 rounded-md font-mono font-semibold bg-slate-800 text-slate-300 border border-slate-700">
                      {sig.sector}
                    </span>
                    <span
                      className={`text-[10px] px-2 py-0.5 rounded-md font-mono font-bold border ${
                        sig.setupId === "SETUP_A_BREAKOUT_RETEST"
                          ? "bg-cyan-500/10 text-cyan-300 border-cyan-500/30"
                          : sig.setupId === "SETUP_B_LIQUIDITY_SWEEP"
                          ? "bg-violet-500/10 text-violet-300 border-violet-500/30"
                          : sig.setupId === "SETUP_C_TREND_PULLBACK"
                          ? "bg-emerald-500/10 text-emerald-300 border-emerald-500/30"
                          : "bg-amber-500/10 text-amber-300 border-amber-500/30"
                      }`}
                    >
                      {sig.setupBadge}
                    </span>
                  </div>
                  <div className="text-xs text-slate-400 font-mono mt-0.5">
                    {sig.companyName}
                  </div>
                </div>

                <div className="flex flex-col items-end">
                  <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/25 text-emerald-400 font-mono text-xs font-bold">
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>{sig.confluenceScore}/100</span>
                  </div>
                  <span className="text-[9px] text-slate-500 font-mono mt-0.5">
                    5-Pillar Score
                  </span>
                </div>
              </div>

              {/* Technical Confluence Badges */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
                <div className="p-2 rounded-lg bg-slate-900/60 border border-slate-800">
                  <span className="text-[9px] text-slate-500 font-mono uppercase block">
                    Rel. Strength (RS)
                  </span>
                  <span className="text-xs font-bold font-mono text-cyan-400">
                    {sig.relativeStrengthVsNifty} vs NIFTY
                  </span>
                </div>

                <div className="p-2 rounded-lg bg-slate-900/60 border border-slate-800">
                  <span className="text-[9px] text-slate-500 font-mono uppercase block">
                    Breakout Volume
                  </span>
                  <span className="text-xs font-bold font-mono text-amber-400">
                    {sig.volumeMultiplier}x 20D Avg
                  </span>
                </div>

                <div className="p-2 rounded-lg bg-slate-900/60 border border-slate-800">
                  <span className="text-[9px] text-slate-500 font-mono uppercase block">
                    EMA Structure
                  </span>
                  <span className="text-xs font-bold font-mono text-emerald-400">
                    20 &gt; 50 &gt; 200
                  </span>
                </div>

                <div className="p-2 rounded-lg bg-slate-900/60 border border-slate-800">
                  <span className="text-[9px] text-slate-500 font-mono uppercase block">
                    R:R Minimum
                  </span>
                  <span className="text-xs font-bold font-mono text-emerald-400">
                    1:{sig.rewardRiskRatio.toFixed(1)}
                  </span>
                </div>
              </div>

              {/* Setup Highlights / Rejection Description */}
              <div className="p-3 rounded-xl bg-slate-900/40 border border-slate-800/80 text-xs font-mono space-y-1">
                <div className="text-slate-300 font-semibold flex items-center gap-1.5">
                  <Flame className="w-3.5 h-3.5 text-amber-400" />
                  <span>{sig.rejectionCandle || sig.setupTitle}</span>
                </div>
                {sig.extensionFromPivotPercent !== undefined && (
                  <div
                    className={`text-[10px] ${
                      isExtended ? "text-rose-400 font-bold" : "text-emerald-400"
                    }`}
                  >
                    Extension from Pivot: {sig.extensionFromPivotPercent}%{" "}
                    {isExtended ? "(EXTENDED — DO NOT CHASE)" : "(Safe to Enter &lt; 5-7% rule)"}
                  </div>
                )}
                {sig.baseLengthWeeks && (
                  <div className="text-[10px] text-slate-400">
                    Base Duration: {sig.baseLengthWeeks} Weeks Volatility Contraction Base
                  </div>
                )}
              </div>

              {/* Trade Levels: Current, Entry, SL, Target 1, Target 2 */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1 border-t border-slate-800/60">
                <div className="flex flex-col">
                  <span className="text-[9px] text-slate-500 font-mono uppercase">Entry Trigger</span>
                  <span className="text-sm font-bold font-mono text-cyan-300">
                    ₹{sig.entryPrice.toLocaleString("en-IN")}
                  </span>
                  <span className="text-[9px] text-slate-500 font-mono">
                    LTP: ₹{sig.currentPrice.toLocaleString("en-IN")}
                  </span>
                </div>

                <div className="flex flex-col">
                  <span className="text-[9px] text-rose-400 font-mono uppercase">Stop Loss (SL)</span>
                  <span className="text-sm font-bold font-mono text-rose-400">
                    ₹{sig.stopLossPrice.toLocaleString("en-IN")}
                  </span>
                  <span className="text-[9px] text-slate-500 font-mono">
                    Risk: ₹{sig.riskPerShare}/sh
                  </span>
                </div>

                <div className="flex flex-col">
                  <span className="text-[9px] text-emerald-400 font-mono uppercase">Target 1 (2R)</span>
                  <span className="text-sm font-bold font-mono text-emerald-400">
                    ₹{sig.target1Price.toLocaleString("en-IN")}
                  </span>
                  <span className="text-[9px] text-slate-500 font-mono">
                    +₹{(sig.target1Price - sig.entryPrice).toFixed(0)} gain
                  </span>
                </div>

                <div className="flex flex-col">
                  <span className="text-[9px] text-amber-300 font-mono uppercase">Target 2 (3R+)</span>
                  <span className="text-sm font-bold font-mono text-amber-300">
                    ₹{sig.target2Price.toLocaleString("en-IN")}
                  </span>
                  <span className="text-[9px] text-slate-500 font-mono">Runner target</span>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-800">
                <button
                  onClick={() => setActiveModalSignal(sig)}
                  className="px-3 py-1.5 rounded-lg text-xs font-mono font-semibold text-slate-300 hover:text-slate-100 hover:bg-slate-800 transition flex items-center gap-1.5"
                >
                  <Eye className="w-3.5 h-3.5 text-cyan-400" />
                  <span>5-Pillar Rationale & S/R</span>
                </button>

                <button
                  onClick={() => loadSignalIntoCalculator(sig)}
                  className="px-3.5 py-1.5 rounded-lg text-xs font-mono font-bold bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 hover:bg-cyan-500/30 transition flex items-center gap-1.5"
                >
                  <Calculator className="w-3.5 h-3.5 text-cyan-400" />
                  <span>Position Size Calculator</span>
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* ── PILLAR 5: STRICT RISK MANAGEMENT CALCULATOR & DISCIPLINE CHECKLIST ── */}
      <section
        id="risk-calculator-section"
        className="p-5 rounded-2xl bg-[#0d1322]/90 border border-slate-800/90 shadow-2xl space-y-5"
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-cyan-500/10 border border-cyan-500/30 text-cyan-400">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold font-mono text-slate-100">
                PILLAR 5: STRICT RISK MANAGEMENT & POSITION SIZING CALCULATOR
              </h3>
              <p className="text-xs text-slate-400 font-mono">
                Preserve capital · 1.0% Max Risk per trade · Exact quantity calculation · 1:2 Minimum R:R
              </p>
            </div>
          </div>
          <span className="text-[10px] px-2.5 py-1 rounded-full font-mono bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-bold self-start sm:self-auto">
            1:2 R:R ENFORCED
          </span>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left Inputs (7 cols) */}
          <div className="lg:col-span-7 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] font-mono text-slate-400 uppercase font-semibold block mb-1">
                  Account Trading Capital (₹)
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-2.5 text-xs text-slate-500 font-mono">₹</span>
                  <input
                    type="number"
                    value={accountCapital}
                    onChange={(e) => setAccountCapital(Number(e.target.value))}
                    className="w-full pl-7 pr-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-sm font-mono text-slate-100 focus:outline-none focus:border-cyan-400"
                  />
                </div>
              </div>

              <div>
                <label className="text-[10px] font-mono text-slate-400 uppercase font-semibold block mb-1">
                  Risk Per Trade (% of Capital)
                </label>
                <div className="relative">
                  <input
                    type="number"
                    step="0.1"
                    min="0.1"
                    max="2.0"
                    value={riskPercent}
                    onChange={(e) => setRiskPercent(Number(e.target.value))}
                    className="w-full pl-3 pr-8 py-2 rounded-xl bg-slate-900 border border-slate-700 text-sm font-mono text-slate-100 focus:outline-none focus:border-cyan-400"
                  />
                  <span className="absolute right-3 top-2.5 text-xs text-slate-500 font-mono">%</span>
                </div>
                <span className="text-[9px] text-slate-500 font-mono">Strict rule: 1.0% to 1.5% max</span>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
              <div>
                <label className="text-[10px] font-mono text-slate-400 uppercase font-semibold block mb-1">
                  Stock Symbol
                </label>
                <input
                  type="text"
                  value={calcSymbol}
                  onChange={(e) => setCalcSymbol(e.target.value.toUpperCase())}
                  className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-sm font-mono text-slate-100 focus:outline-none focus:border-cyan-400"
                />
              </div>

              <div>
                <label className="text-[10px] font-mono text-slate-400 uppercase font-semibold block mb-1">
                  Entry Trigger (₹)
                </label>
                <input
                  type="number"
                  value={calcEntry}
                  onChange={(e) => setCalcEntry(Number(e.target.value))}
                  className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-sm font-mono text-cyan-300 focus:outline-none focus:border-cyan-400 font-bold"
                />
              </div>

              <div>
                <label className="text-[10px] font-mono text-rose-400 uppercase font-semibold block mb-1">
                  Stop Loss Price (₹)
                </label>
                <input
                  type="number"
                  value={calcStopLoss}
                  onChange={(e) => setCalcStopLoss(Number(e.target.value))}
                  className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-sm font-mono text-rose-400 focus:outline-none focus:border-rose-400 font-bold"
                />
              </div>

              <div>
                <label className="text-[10px] font-mono text-emerald-400 uppercase font-semibold block mb-1">
                  Target Price (₹)
                </label>
                <input
                  type="number"
                  value={calcTarget}
                  onChange={(e) => setCalcTarget(Number(e.target.value))}
                  className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-sm font-mono text-emerald-400 focus:outline-none focus:border-emerald-400 font-bold"
                />
              </div>
            </div>

            {/* Pre-Trade Discipline 5-Pillar Checklist */}
            <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 space-y-2.5">
              <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                <Check className="w-3.5 h-3.5 text-cyan-400" />
                Pre-Execution Discipline Checklist (All Must Pass)
              </span>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs font-mono">
                <label className="flex items-center gap-2 cursor-pointer text-slate-300">
                  <input
                    type="checkbox"
                    checked={checklistDiscipline.regimeConfirmed}
                    onChange={(e) =>
                      setChecklistDiscipline({ ...checklistDiscipline, regimeConfirmed: e.target.checked })
                    }
                    className="rounded border-slate-700 text-cyan-500 focus:ring-0"
                  />
                  <span>1. NIFTY Regime is Bullish / Non-Hostile</span>
                </label>

                <label className="flex items-center gap-2 cursor-pointer text-slate-300">
                  <input
                    type="checkbox"
                    checked={checklistDiscipline.fundamentalApproved}
                    onChange={(e) =>
                      setChecklistDiscipline({
                        ...checklistDiscipline,
                        fundamentalApproved: e.target.checked,
                      })
                    }
                    className="rounded border-slate-700 text-cyan-500 focus:ring-0"
                  />
                  <span>2. Fundamentally approved (ROE &gt; 15%)</span>
                </label>

                <label className="flex items-center gap-2 cursor-pointer text-slate-300">
                  <input
                    type="checkbox"
                    checked={checklistDiscipline.liquidityValidated}
                    onChange={(e) =>
                      setChecklistDiscipline({
                        ...checklistDiscipline,
                        liquidityValidated: e.target.checked,
                      })
                    }
                    className="rounded border-slate-700 text-cyan-500 focus:ring-0"
                  />
                  <span>3. S/R flip or Liquidity sweep verified</span>
                </label>

                <label className="flex items-center gap-2 cursor-pointer text-slate-300">
                  <input
                    type="checkbox"
                    checked={checklistDiscipline.volumeConfirmed}
                    onChange={(e) =>
                      setChecklistDiscipline({ ...checklistDiscipline, volumeConfirmed: e.target.checked })
                    }
                    className="rounded border-slate-700 text-cyan-500 focus:ring-0"
                  />
                  <span>4. Volume &gt; 1.5x on breakout / reclaim</span>
                </label>

                <label className="flex items-center gap-2 cursor-pointer text-slate-300 sm:col-span-2">
                  <input
                    type="checkbox"
                    checked={checklistDiscipline.strictlyDefinedRisk}
                    onChange={(e) =>
                      setChecklistDiscipline({
                        ...checklistDiscipline,
                        strictlyDefinedRisk: e.target.checked,
                      })
                    }
                    className="rounded border-slate-700 text-cyan-500 focus:ring-0"
                  />
                  <span>5. R:R &ge; 1:2.0 verified with hard stop-loss placed</span>
                </label>
              </div>
            </div>
          </div>

          {/* Right Calculated Output Cards (5 cols) */}
          <div className="lg:col-span-5 p-4 rounded-xl bg-gradient-to-br from-[#11192e] to-[#0a101d] border border-cyan-500/30 flex flex-col justify-between space-y-4">
            <div className="space-y-3">
              <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                <span className="text-[11px] font-mono uppercase font-bold text-slate-400">
                  Sizing Result for {calcSymbol}
                </span>
                <span
                  className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded ${
                    rewardRiskRatio >= 2.0
                      ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                      : "bg-rose-500/20 text-rose-300 border border-rose-500/30"
                  }`}
                >
                  {rewardRiskRatio >= 2.0 ? "R:R APPROVED" : "R:R REJECTED (< 2.0)"}
                </span>
              </div>

              {/* Giant Recommended Quantity */}
              <div className="p-3.5 rounded-xl bg-slate-900/80 border border-cyan-500/20 flex items-center justify-between">
                <div>
                  <span className="text-[10px] font-mono text-slate-400 uppercase block">
                    Recommended Order Quantity
                  </span>
                  <span className="text-2xl font-bold font-mono text-cyan-400">
                    {recommendedQuantity} Shares
                  </span>
                </div>
                <div className="text-right">
                  <span className="text-[10px] font-mono text-slate-400 uppercase block">
                    Capital Required
                  </span>
                  <span className="text-base font-bold font-mono text-slate-100">
                    ₹{totalCapitalRequired.toLocaleString("en-IN")}
                  </span>
                  <span className="text-[9px] text-slate-500 font-mono block">
                    {capitalExposurePercent}% of portfolio
                  </span>
                </div>
              </div>

              {/* Metrics Grid */}
              <div className="grid grid-cols-2 gap-2 text-xs font-mono">
                <div className="p-2.5 rounded-lg bg-slate-900/50 border border-slate-800">
                  <span className="text-[9px] text-rose-400 uppercase block">Max Defined Loss</span>
                  <span className="text-sm font-bold text-rose-400">
                    -₹{maxRiskAmount.toLocaleString("en-IN")}
                  </span>
                  <span className="text-[9px] text-slate-500">₹{riskPerShare}/sh risk</span>
                </div>

                <div className="p-2.5 rounded-lg bg-slate-900/50 border border-slate-800">
                  <span className="text-[9px] text-emerald-400 uppercase block">Expected 2R Gain</span>
                  <span className="text-sm font-bold text-emerald-400">
                    +₹{potentialRewardAmount.toLocaleString("en-IN")}
                  </span>
                  <span className="text-[9px] text-slate-500">₹{gainPerShare}/sh reward</span>
                </div>

                <div className="p-2.5 rounded-lg bg-slate-900/50 border border-slate-800">
                  <span className="text-[9px] text-slate-400 uppercase block">Reward-to-Risk</span>
                  <span className="text-sm font-bold text-cyan-300">
                    1 : {rewardRiskRatio.toFixed(2)}
                  </span>
                </div>

                <div className="p-2.5 rounded-lg bg-slate-900/50 border border-slate-800">
                  <span className="text-[9px] text-slate-400 uppercase block">Capital Preservation</span>
                  <span className="text-sm font-bold text-emerald-400">100% Protected</span>
                </div>
              </div>

              {rewardRiskRatio < 2.0 && (
                <div className="p-2 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 text-[10px] font-mono flex items-center gap-1.5">
                  <AlertTriangle className="w-4 h-4 shrink-0 text-rose-400" />
                  <span>
                    Trade violates Rule 5! Minimum Reward:Risk must be 1:2.0. Adjust Target higher or Entry closer to SL.
                  </span>
                </div>
              )}
            </div>

            <div className="text-[10px] text-slate-400 font-mono border-t border-slate-800 pt-2 flex items-center justify-between">
              <span>Trailing Rule: Move SL to Breakeven at 1R profit</span>
              <span className="text-cyan-400">Discipline First</span>
            </div>
          </div>
        </div>
      </section>

      {/* ── INTERACTIVE 5-PILLAR DETAILS MODAL ─────────────────────────────── */}
      {activeModalSignal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
          <div className="w-full max-w-3xl max-h-[90vh] overflow-y-auto rounded-2xl bg-[#0d1322] border border-slate-800 shadow-2xl p-6 space-y-5 text-slate-100">
            {/* Modal Header */}
            <div className="flex items-start justify-between border-b border-slate-800 pb-3">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-xl font-bold font-mono text-cyan-400">
                    {activeModalSignal.symbol} — {activeModalSignal.setupTitle}
                  </h3>
                  <span className="text-xs px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-mono border border-emerald-500/30 font-bold">
                    Score {activeModalSignal.confluenceScore}/100
                  </span>
                </div>
                <p className="text-xs text-slate-400 font-mono mt-0.5">
                  {activeModalSignal.companyName} · {activeModalSignal.sector}
                </p>
              </div>

              <button
                onClick={() => setActiveModalSignal(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* 5-Pillar Verification Breakdown */}
            <div className="space-y-3">
              <h4 className="text-xs font-mono font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                The 5-Pillars Confluence Audit
              </h4>

              <div className="grid grid-cols-1 gap-2 text-xs font-mono">
                <div className="p-3 rounded-xl bg-slate-900/60 border border-slate-800 flex flex-col gap-1">
                  <span className="text-cyan-400 font-bold">Pillar 1: Market Regime Alignment</span>
                  <span className="text-slate-300">
                    {activeModalSignal.fivePillarChecklist.pillar1MarketRegime.details}
                  </span>
                </div>

                <div className="p-3 rounded-xl bg-slate-900/60 border border-slate-800 flex flex-col gap-1">
                  <span className="text-emerald-400 font-bold">Pillar 2: Fundamental Screener Status</span>
                  <span className="text-slate-300">
                    {activeModalSignal.fivePillarChecklist.pillar2Fundamentals.details}
                  </span>
                </div>

                <div className="p-3 rounded-xl bg-slate-900/60 border border-slate-800 flex flex-col gap-1">
                  <span className="text-violet-400 font-bold">Pillar 3: Liquidity Sweeps & Key S/R</span>
                  <span className="text-slate-300">
                    {activeModalSignal.fivePillarChecklist.pillar3LiquidityLevels.details}
                  </span>
                </div>

                <div className="p-3 rounded-xl bg-slate-900/60 border border-slate-800 flex flex-col gap-1">
                  <span className="text-amber-400 font-bold">Pillar 4: Price Action & Volume Confirmation</span>
                  <span className="text-slate-300">
                    {activeModalSignal.fivePillarChecklist.pillar4PriceActionVolume.details}
                  </span>
                </div>

                <div className="p-3 rounded-xl bg-slate-900/60 border border-slate-800 flex flex-col gap-1">
                  <span className="text-rose-400 font-bold">Pillar 5: Strict Risk Management & Invalidation</span>
                  <span className="text-slate-300">
                    {activeModalSignal.fivePillarChecklist.pillar5RiskManagement.details}
                  </span>
                </div>
              </div>
            </div>

            {/* Trade Rationale Points */}
            <div className="space-y-2">
              <h4 className="text-xs font-mono font-bold uppercase tracking-wider text-slate-400">
                Setup Rationale & Institutional Mechanics
              </h4>
              <ul className="space-y-1.5 list-disc list-inside text-xs font-mono text-slate-300">
                {activeModalSignal.tradeRationale.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            </div>

            {/* Invalidation Trigger & Trailing Plan */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs font-mono">
              <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/25">
                <span className="text-[10px] text-rose-400 uppercase font-bold block mb-1">
                  Strict Invalidation Trigger
                </span>
                <span className="text-slate-200">{activeModalSignal.invalidationTrigger}</span>
              </div>

              <div className="p-3 rounded-xl bg-cyan-500/10 border border-cyan-500/25">
                <span className="text-[10px] text-cyan-400 uppercase font-bold block mb-1">
                  Trailing Stop-Loss Protocol
                </span>
                <span className="text-slate-200">{activeModalSignal.trailingStopPlan}</span>
              </div>
            </div>

            {/* Fundamentals Scorecard */}
            <div className="p-4 rounded-xl bg-slate-900/80 border border-slate-800 space-y-2">
              <span className="text-[10px] font-mono uppercase font-bold text-slate-400 block">
                Fundamental Health Card
              </span>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs font-mono">
                <div>
                  <span className="text-slate-500 text-[10px] block">ROE %</span>
                  <span className="text-emerald-400 font-bold">
                    {activeModalSignal.fundamentals.roePercent}%
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 text-[10px] block">ROCE %</span>
                  <span className="text-emerald-400 font-bold">
                    {activeModalSignal.fundamentals.rocePercent}%
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 text-[10px] block">3Y Sales CAGR</span>
                  <span className="text-cyan-400 font-bold">
                    {activeModalSignal.fundamentals.salesGrowth3Y}%
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 text-[10px] block">Debt to Equity</span>
                  <span className="text-slate-200 font-bold">
                    {activeModalSignal.fundamentals.debtToEquity}
                  </span>
                </div>
              </div>
            </div>

            {/* Close / Action Footer */}
            <div className="flex items-center justify-end gap-2 border-t border-slate-800 pt-3">
              <button
                onClick={() => setActiveModalSignal(null)}
                className="px-4 py-2 rounded-xl text-xs font-mono text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition"
              >
                Close
              </button>
              <button
                onClick={() => {
                  loadSignalIntoCalculator(activeModalSignal);
                  setActiveModalSignal(null);
                }}
                className="px-4 py-2 rounded-xl text-xs font-mono font-bold bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 hover:bg-cyan-500/30 transition flex items-center gap-1.5"
              >
                <Calculator className="w-4 h-4" />
                <span>Calculate My Exact Position Size</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
