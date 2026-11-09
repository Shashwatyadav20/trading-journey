export type FOInstrumentType = "INDEX" | "STOCK";

export type FOMarketStructureRegime =
  | "RANGE_BOUND"
  | "SUPPORT_BOUNCE"
  | "BREAKOUT_DOJI_SQUEEZE";

export type FOStrategyCode =
  | "HEDGED_IRON_CONDOR"
  | "DEFINED_RISK_SHORT_STRADDLE"
  | "BULL_PUT_CREDIT_SPREAD"
  | "BULL_CALL_DEBIT_SPREAD"
  | "CALL_RATIO_BACKSPREAD";

export type OptionRight = "CE" | "PE";
export type LegAction = "BUY" | "SELL";

export interface FOSpreadLeg {
  legId: string;
  action: LegAction;
  right: OptionRight;
  strike: number;
  expiry: string;
  lots: number;
  lotSize: number;
  premium: number; // per unit
  iv: number; // %
  delta: number;
  theta: number; // ₹ per day per unit
  vega: number;
  gamma: number;
  roleLabel: string; // e.g. "Short OTM Put (VAL Defense)", "Long Far-OTM Put Wing"
}

export interface FOPayoffPoint {
  underlyingPrice: number;
  movePct: number;
  netPayoffINR: number;
  netPayoffPerUnit: number;
  isBreakevenZone?: boolean;
  isPurpleBoxZone?: boolean;
}

export interface FOSpreadPayoffMetrics {
  netPremiumPerUnit: number; // Positive = Net Credit, Negative = Net Debit
  netPremiumTotalINR: number;
  isNetCredit: boolean;
  maxProfitINR: number;
  maxLossINR: number; // Positive magnitude of max loss
  maxProfitPctOnMargin: number;
  maxLossPctOnMargin: number;
  rewardToRiskRatio: number;
  lowerBreakeven: number;
  upperBreakeven: number | null;
  probabilityOfProfitPct: number; // PoP %
  estimatedMarginRequiredINR: number; // SPAN + Exposure with hedge benefit
  nakedMarginWithoutHedgeINR: number;
  hedgeMarginBenefitPct: number;
  recommendedLots: number;
  maxAllowedLotsByRisk: number;
  marginUtilizationPct: number; // % of F&O portfolio capital
  isWithinMarginLimit: boolean;
  netGreeks: {
    delta: number;
    gamma: number;
    thetaINRPerDay: number;
    vegaINRPerPct: number;
  };
  payoffCurve: FOPayoffPoint[];
}

export interface FOOptionChainRow {
  strike: number;
  isATM: boolean;
  distanceFromSpotPct: number;
  // Purple Box & Institutional OI Alignment Flags
  alignsWithVALSupport: boolean;
  alignsWithVAHResistance: boolean;
  institutionalZoneTag:
    | "VAL_PUT_WALL_CONFLUENCE"
    | "VAH_CALL_WALL_CONFLUENCE"
    | "ATM_LIQUIDITY_HUB"
    | "HIGH_PUT_WRITING"
    | "HIGH_CALL_WRITING"
    | "NEUTRAL";
  // Call (CE) Metrics
  ceLTP: number;
  ceOI: number; // in contracts/shares
  ceChangeInOI: number;
  ceChangeInOIPct: number;
  ceVolume: number;
  ceIV: number;
  ceDelta: number;
  ceGamma: number;
  ceTheta: number;
  ceVega: number;
  ceBuildupType: "SHORT_BUILDUP" | "LONG_BUILDUP" | "SHORT_COVERING" | "LONG_UNWINDING";
  // Put (PE) Metrics
  peLTP: number;
  peOI: number;
  peChangeInOI: number;
  peChangeInOIPct: number;
  peVolume: number;
  peIV: number;
  peDelta: number;
  peGamma: number;
  peTheta: number;
  peVega: number;
  peBuildupType: "SHORT_BUILDUP" | "LONG_BUILDUP" | "SHORT_COVERING" | "LONG_UNWINDING";
  // Strike-specific PCR
  strikePCR: number;
}

export interface FOOptionChainSummary {
  symbol: string;
  spotPrice: number;
  futuresPrice: number;
  futuresBasisPct: number;
  atmStrike: number;
  strikeStep: number;
  lotSize: number;
  expiryDate: string;
  daysToExpiry: number;
  overallPCR: number;
  pcrSentiment: "BULLISH_PUT_WRITING" | "NEUTRAL_BALANCED" | "BEARISH_CALL_WRITING";
  maxPainStrike: number;
  highestCallOIStrike: number; // Call Resistance Wall
  highestPutOIStrike: number; // Put Support Wall
  atmIV: number;
  ivRank: number;
  ivPercentile: number;
  ivSkew25DeltaPct: number; // 25D Put IV - 25D Call IV
  valAlignedStrike: number;
  vahAlignedStrike: number;
  institutionalAlignmentSummary: string;
  strikes: FOOptionChainRow[];
}

export interface FOPurpleBoxMetadata {
  valSupportFloor: number;
  vahResistanceCeiling: number;
  pocMidpoint: number;
  boxWidthPct: number;
  supportTouches: number;
  resistanceTouches: number;
  consolidationDays: number;
  positionInBoxPct: number; // 0% = at VAL, 100% = at VAH, >100% = Breakout above VAH
  hasDojiCompression: boolean;
  volumeSurgeMultiplier: number;
  fourHourTrendAlignment: "BULLISH" | "RANGE_NEUTRAL" | "BEARISH";
  vwapDistancePct: number;
}

export interface FOScannerSetup {
  id: string;
  symbol: string;
  cleanSymbol: string;
  companyName: string;
  sector: string;
  instrumentType: FOInstrumentType;
  lockedDateKey: string;
  spotPrice: number;
  futuresPrice: number;
  changePercent: number;
  lotSize: number;
  strikeStep: number;
  expiryDate: string;
  daysToExpiry: number;
  // Purple Box & Structure
  marketRegime: FOMarketStructureRegime;
  regimeBadge: string;
  purpleBox: FOPurpleBoxMetadata;
  // Matched F&O Strategy
  strategyCode: FOStrategyCode;
  strategyName: string;
  alternateStrategyCode: FOStrategyCode;
  alternateStrategyName: string;
  strategyCategory: "CREDIT_THETA_DECAY" | "DEBIT_MOMENTUM" | "NEUTRAL_VEGA_THETA";
  strategyThesis: string;
  legs: FOSpreadLeg[];
  payoffMetrics: FOSpreadPayoffMetrics;
  // Option Chain & Greeks Summary
  optionChain: FOOptionChainSummary;
  confluenceScore: number;
  quantRationale: string[];
}

export interface ActiveFOSpreadPosition {
  positionId: string;
  symbol: string;
  cleanSymbol: string;
  companyName: string;
  instrumentType: FOInstrumentType;
  marketRegime: FOMarketStructureRegime;
  strategyCode: FOStrategyCode;
  strategyName: string;
  expiryDate: string;
  lotSize: number;
  lotsDeployed: number;
  totalQuantity: number;
  // Same-day price freeze fields
  entryDateKey: string;
  entryTimestamp: string;
  entrySpotPrice: number;
  currentSpotPrice: number;
  valSupportFloor: number;
  vahResistanceCeiling: number;
  legs: FOSpreadLeg[];
  // Financials
  netEntryPremiumPerUnit: number;
  currentNetPremiumPerUnit: number;
  isNetCredit: boolean;
  marginBlockedINR: number;
  maxProfitINR: number;
  maxLossINR: number;
  lowerBreakeven: number;
  upperBreakeven: number | null;
  probabilityOfProfitPct: number;
  stopLossSpotLevel: number;
  targetSpotLevel: number;
  status: "ACTIVE" | "TARGET_HIT" | "SL_HIT" | "MANUAL_EXIT";
  exitTimestamp?: string;
  realizedPnLINR?: number;
}

