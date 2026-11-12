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

export const DEFAULT_FO_CLOSED_SEEDS: ActiveFOSpreadPosition[] = [
  {
    positionId: "FO-EXIT-NIFTY-101",
    symbol: "^NSEI",
    cleanSymbol: "NIFTY",
    companyName: "Nifty 50 Index",
    instrumentType: "INDEX",
    marketRegime: "RANGE_BOUND",
    strategyCode: "HEDGED_IRON_CONDOR",
    strategyName: "🟣 Hedged Iron Condor",
    expiryDate: "28-NOV-2026",
    lotSize: 25,
    lotsDeployed: 2,
    totalQuantity: 50,
    entryDateKey: "2026-11-05",
    entryTimestamp: "2026-11-05T09:25:00.000Z",
    entrySpotPrice: 24150,
    currentSpotPrice: 24180,
    valSupportFloor: 24050,
    vahResistanceCeiling: 24250,
    legs: [
      {
        legId: "LEG-NIFTY-1",
        action: "SELL",
        right: "PE",
        strike: 24000,
        expiry: "28-NOV-2026",
        lots: 2,
        lotSize: 25,
        premium: 85,
        iv: 13.8,
        delta: -0.18,
        theta: 12.4,
        vega: 5.2,
        gamma: 0.001,
        roleLabel: "Short OTM Put (VAL Defense)",
      },
      {
        legId: "LEG-NIFTY-2",
        action: "BUY",
        right: "PE",
        strike: 23800,
        expiry: "28-NOV-2026",
        lots: 2,
        lotSize: 25,
        premium: 32,
        iv: 14.5,
        delta: -0.07,
        theta: 5.8,
        vega: 2.5,
        gamma: 0.0005,
        roleLabel: "Long Far-OTM Put Wing",
      },
      {
        legId: "LEG-NIFTY-3",
        action: "SELL",
        right: "CE",
        strike: 24350,
        expiry: "28-NOV-2026",
        lots: 2,
        lotSize: 25,
        premium: 92,
        iv: 13.5,
        delta: 0.17,
        theta: 13.1,
        vega: 5.4,
        gamma: 0.001,
        roleLabel: "Short OTM Call (VAH Ceiling)",
      },
      {
        legId: "LEG-NIFTY-4",
        action: "BUY",
        right: "CE",
        strike: 24550,
        expiry: "28-NOV-2026",
        lots: 2,
        lotSize: 25,
        premium: 36,
        iv: 14.1,
        delta: 0.06,
        theta: 6.2,
        vega: 2.6,
        gamma: 0.0005,
        roleLabel: "Long Far-OTM Call Wing",
      },
    ],
    netEntryPremiumPerUnit: 109,
    currentNetPremiumPerUnit: 24,
    isNetCredit: true,
    marginBlockedINR: 115000,
    maxProfitINR: 8450,
    maxLossINR: 11550,
    lowerBreakeven: 23891,
    upperBreakeven: 24459,
    probabilityOfProfitPct: 78,
    stopLossSpotLevel: 24020,
    targetSpotLevel: 24280,
    status: "TARGET_HIT",
    exitTimestamp: "2026-11-08T14:40:15.000Z",
    realizedPnLINR: 8450,
  },
  {
    positionId: "FO-EXIT-BANKNIFTY-102",
    symbol: "^NSEBANK",
    cleanSymbol: "BANKNIFTY",
    companyName: "Nifty Bank Index",
    instrumentType: "INDEX",
    marketRegime: "SUPPORT_BOUNCE",
    strategyCode: "BULL_PUT_CREDIT_SPREAD",
    strategyName: "🟣 Bull Put Credit Spread",
    expiryDate: "28-NOV-2026",
    lotSize: 15,
    lotsDeployed: 3,
    totalQuantity: 45,
    entryDateKey: "2026-11-06",
    entryTimestamp: "2026-11-06T09:30:00.000Z",
    entrySpotPrice: 51200,
    currentSpotPrice: 51680,
    valSupportFloor: 51000,
    vahResistanceCeiling: 51650,
    legs: [
      {
        legId: "LEG-BN-1",
        action: "SELL",
        right: "PE",
        strike: 51000,
        expiry: "28-NOV-2026",
        lots: 3,
        lotSize: 15,
        premium: 340,
        iv: 16.5,
        delta: -0.25,
        theta: 45.2,
        vega: 18.5,
        gamma: 0.0008,
        roleLabel: "Short OTM Put (VAL Defense)",
      },
      {
        legId: "LEG-BN-2",
        action: "BUY",
        right: "PE",
        strike: 50400,
        expiry: "28-NOV-2026",
        lots: 3,
        lotSize: 15,
        premium: 120,
        iv: 17.2,
        delta: -0.11,
        theta: 22.1,
        vega: 9.4,
        gamma: 0.0004,
        roleLabel: "Long Far-OTM Put Wing",
      },
    ],
    netEntryPremiumPerUnit: 220,
    currentNetPremiumPerUnit: 15,
    isNetCredit: true,
    marginBlockedINR: 145000,
    maxProfitINR: 11200,
    maxLossINR: 15800,
    lowerBreakeven: 50780,
    upperBreakeven: null,
    probabilityOfProfitPct: 82,
    stopLossSpotLevel: 50850,
    targetSpotLevel: 51750,
    status: "TARGET_HIT",
    exitTimestamp: "2026-11-09T13:15:20.000Z",
    realizedPnLINR: 11200,
  },
  {
    positionId: "FO-EXIT-RELIANCE-103",
    symbol: "RELIANCE.NS",
    cleanSymbol: "RELIANCE",
    companyName: "Reliance Industries Ltd",
    instrumentType: "STOCK",
    marketRegime: "BREAKOUT_DOJI_SQUEEZE",
    strategyCode: "BULL_CALL_DEBIT_SPREAD",
    strategyName: "🟣 Bull Call Debit Spread",
    expiryDate: "28-NOV-2026",
    lotSize: 250,
    lotsDeployed: 1,
    totalQuantity: 250,
    entryDateKey: "2026-11-04",
    entryTimestamp: "2026-11-04T10:15:00.000Z",
    entrySpotPrice: 1310,
    currentSpotPrice: 1282,
    valSupportFloor: 1290,
    vahResistanceCeiling: 1345,
    legs: [
      {
        legId: "LEG-REL-1",
        action: "BUY",
        right: "CE",
        strike: 1300,
        expiry: "28-NOV-2026",
        lots: 1,
        lotSize: 250,
        premium: 38,
        iv: 21.5,
        delta: 0.52,
        theta: -2.8,
        vega: 3.2,
        gamma: 0.005,
        roleLabel: "Long ATM Call",
      },
      {
        legId: "LEG-REL-2",
        action: "SELL",
        right: "CE",
        strike: 1340,
        expiry: "28-NOV-2026",
        lots: 1,
        lotSize: 250,
        premium: 19.5,
        iv: 20.8,
        delta: 0.28,
        theta: 1.9,
        vega: 2.1,
        gamma: 0.004,
        roleLabel: "Short OTM Call (Hedge Cap)",
      },
    ],
    netEntryPremiumPerUnit: 18.5,
    currentNetPremiumPerUnit: 4.2,
    isNetCredit: false,
    marginBlockedINR: 48000,
    maxProfitINR: 5375,
    maxLossINR: 4625,
    lowerBreakeven: 1318.5,
    upperBreakeven: null,
    probabilityOfProfitPct: 54,
    stopLossSpotLevel: 1285,
    targetSpotLevel: 1350,
    status: "SL_HIT",
    exitTimestamp: "2026-11-07T11:20:00.000Z",
    realizedPnLINR: -4600,
  },
];

