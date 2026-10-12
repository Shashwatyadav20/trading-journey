/**
 * 5-Pillar Swing Trading Framework Types
 * 1. Market Regime (NIFTY Trend / Range)
 * 2. Fundamentally Strong Stocks Universe
 * 3. Liquidity Sweep / Support-Resistance & CHoCH
 * 4. Price Action + Volume Confirmation (Setups A, B, C, D)
 * 5. Strict Risk Management & Position Sizing
 */

export type MarketRegimeBias = "BULLISH_TREND" | "RANGE_BOUND" | "BEARISH_CORRECTION";
export type SwingClearance = "HIGH_CONVICTION" | "SELECTIVE_OPPORTUNITIES" | "DEFENSIVE_CASH";

export interface NiftyMarketRegime {
  spotPrice: number;
  changePercent: number;
  ema20: number;
  ema50: number;
  ema200: number;
  bias: MarketRegimeBias;
  clearance: SwingClearance;
  breadthPercentAbove50EMA: number;
  advancingStocksCount: number;
  decliningStocksCount: number;
  regimeScore: number; // 0-100
  analysisSummary: string;
}

export interface StockFundamentals {
  symbol: string;
  companyName: string;
  sector: string;
  marketCapCr: number | null;
  peRatio: number | null;
  roePercent: number | null;
  rocePercent: number | null;
  salesGrowth3Y: number | null;
  profitGrowth3Y: number | null;
  debtToEquity: number | null;
  institutionalHoldingPercent: number | null;
  qualityScore: number | null;
  moatRating: "WIDE" | "NARROW" | "MODERATE" | null;
  isQualified: boolean;
  isAvailable: boolean;
  dataSource: "LIVE_MARKET_META" | "MANUAL_CURATED" | "UNAVAILABLE";
  asOfTimestamp?: string;
  notes: string;
}

export type SwingSetupId = 
  | "SETUP_A_BREAKOUT_RETEST"
  | "SETUP_B_LIQUIDITY_SWEEP"
  | "SETUP_C_TREND_PULLBACK"
  | "SETUP_D_BASE_BREAKOUT"
  | "STRATEGY_A_BREAKOUT"
  | "STRATEGY_B_PULLBACK"
  | "STRATEGY_C_SUPPORT_BOUNCE"
  | "STRATEGY_D_MA_CROSSOVER"
  | "STRATEGY_E_MOMENTUM"
  | "STRATEGY_F_RANGE_BREAKOUT"
  | "STRATEGY_G_TREND_CONTINUATION"
  | "STRATEGY_H_VOLUME_BREAKOUT";

import {
  MarketStructureResult,
  LiquiditySweepEvent,
  ChochEvent,
} from "./marketStructure";

export type SignalLifecycleState = "ACTIVE_OPPORTUNITY" | "APPROACHING_TRIGGER" | "TRIGGERED" | "WATCHLIST";

export interface FivePillarChecklist {
  pillar1MarketRegime: {
    passed: boolean;
    niftyAlignment: string;
    details: string;
  };
  pillar2Fundamentals: {
    passed: boolean;
    qualityScore: number | null;
    isAvailable?: boolean;
    details: string;
  };
  pillar3LiquidityLevels: {
    passed: boolean;
    keyLevel: number;
    details: string;
    sweep?: LiquiditySweepEvent | null;
    choch?: ChochEvent | null;
    pwh?: number | null;
    pwl?: number | null;
  };
  pillar4PriceActionVolume: {
    passed: boolean;
    setupName: string;
    volumeMultiplier: number;
    details: string;
  };
  pillar5RiskManagement: {
    passed: boolean;
    rewardRiskRatio: number;
    riskPercent: number;
    details: string;
  };
}

export interface SwingSignal {
  id: string;
  symbol: string;
  companyName: string;
  sector: string;
  setupId: SwingSetupId;
  setupTitle: string;
  setupBadge: string;
  status: SignalLifecycleState;
  timestamp: string;
  currentPrice: number;
  entryPrice: number;
  stopLossPrice: number;
  target1Price: number; // Minimum 1:2 R:R
  target2Price: number; // 1:3+ R:R runner
  riskPerShare: number;
  rewardRiskRatio: number;
  confluenceScore: number; // 0-100 composite 5-pillar score
  relativeStrengthVsNifty: number; // 0-100 (Outperforming > 70)
  volumeMultiplier: number; // relative to 20-day avg volume (e.g. 1.8x)
  ema20: number | null; // null when < 20 completed daily candles available
  ema50: number | null; // null when < 50 completed daily candles available
  ema200: number | null; // null when < 200 completed daily candles available
  extensionFromPivotPercent?: number; // Setup D check (< 5-7%)
  baseLengthWeeks?: number; // Setup D consolidation duration
  sweepLow?: number; // Setup B liquidity sweep wick price
  retestLow?: number; // Setup A retest level
  rejectionCandle?: string; // e.g. "Bullish Hammer / Pin Bar"
  // Dashboard display metadata
  marketCapCr?: number;
  changePercent?: number;
  rsi14?: number | null;
  trendStrength?: string;
  scoreBreakdown?: {
    trendConfirmation: number;
    priceAction: number;
    volumeConfirmation: number;
    relativeStrength: number;
    supportResistanceQuality: number;
    momentumConfirmation: number;
    rewardRiskRatio: number;
  };
  marketStructure?: MarketStructureResult;
  liquiditySweep?: LiquiditySweepEvent | null;
  choch?: ChochEvent | null;
  pwh?: number | null;
  pwl?: number | null;
  fivePillarChecklist: FivePillarChecklist;
  tradeRationale: string[];
  invalidationTrigger: string;
  trailingStopPlan: string;
  fundamentals: StockFundamentals;
}

export interface PositionSizeCalcInput {
  accountCapital: number;
  riskPercent: number; // e.g. 1.0 = 1%
  entryPrice: number;
  stopLossPrice: number;
  targetPrice?: number;
}

export interface PositionSizeCalcResult {
  maxRiskAmount: number;
  riskPerShare: number;
  recommendedQuantity: number;
  totalCapitalRequired: number;
  portfolioCapitalExposurePercent: number;
  potentialRewardAmount: number;
  rewardRiskRatio: number;
  isRiskValid: boolean;
  validationWarnings: string[];
}
