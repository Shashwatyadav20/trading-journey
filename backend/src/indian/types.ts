export interface Candle {
  time: number; // Unix timestamp in seconds
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export type RegimeType =
  | "BULLISH"
  | "BEARISH"
  | "RANGE"
  | "HIGH_VOLATILITY"
  | "EVENT_RISK"
  | "UNCLEAR";

export type StrategyType =
  | "BULL_PUT_SPREAD"
  | "BEAR_CALL_SPREAD"
  | "IRON_CONDOR"
  | "NO_TRADE";

export type VolatilityState = "LOW" | "NORMAL" | "HIGH" | "EXTREME";

export type StructureState =
  | "BULLISH_STRUCTURE"
  | "BEARISH_STRUCTURE"
  | "SIDEWAYS";

export type SwingStructure =
  | "HH_HL"
  | "LH_LL"
  | "HH_LL"
  | "LH_HL"
  | "UNCLEAR";

export interface TrendAnalysis {
  direction: "BUY" | "SELL" | "NEUTRAL";
  trendScore: number; // 0 - 100
  invalidationLevel: number;
  swingStructure?: SwingStructure;
  rsi?: number;
  vwap?: number;
  isVwapNeutral?: boolean;
  reasons: string[];
}

export interface SupportResistanceLevel {
  price: number;
  type:
    | "PDH"
    | "PDL"
    | "PC"
    | "PWH"
    | "PWL"
    | "SWING_HIGH"
    | "SWING_LOW"
    | "VWAP"
    | "OI_WALL_CALL"
    | "OI_WALL_PUT";
  strengthScore: number; // 1 - 10
  source: string;
  distanceFromSpotPct: number;
  distancePoints: number;
}

export interface OptionContract {
  symbol: string;
  expiry: string;
  strike: number;
  optionType: "CE" | "PE";
  ltp: number;
  bid: number;
  ask: number;
  volume: number;
  openInterest: number;
  changeInOI: number;
  iv: number;
  delta: number;
  gamma?: number;
  timestamp: string;
}

export interface NiftyOptionChain {
  spotPrice: number;
  timestamp: string;
  contracts: OptionContract[];
  /** Whether this chain is synthetic/paper data (not live market data) */
  isSynthetic?: boolean;
}

export interface CandidateSpread {
  strategyType: StrategyType;
  expiry: string;
  sellLeg: OptionContract;
  buyLeg: OptionContract;
  netCredit: number;
  maxLoss: number;
  rewardRiskRatio: number;
  spreadWidth: number;
  score: number;
  gammaRisk?: number;
}

export interface ChargeBreakdown {
  grossPnl: number;
  entryCharges: number;
  exitCharges: number;
  brokerage: number;
  stt: number;
  exchangeFees: number;
  gst: number;
  sebiFees: number;
  stampDuty: number;
  estimatedSlippage: number;
  totalCharges: number;
  netPnl: number;
}

export interface RiskValidation {
  allowed: boolean;
  capital: number;
  allowedRisk: number;
  maxLossPerLot: number;
  lotQuantity: number;
  totalQuantity: number;
  marginRequired: number;
  riskPercentage: number;
  rejectionReason: string | null;
}

export interface StrategyScoreResult {
  score: number; // 0 - 100
  passed: boolean;
  breakdown: {
    trend1H: number;
    trend15M: number;
    structure: number;
    supportResistance: number;
    vwap: number;
    volumeOI: number;
    volatility: number;
    liquidity: number;
    eventRisk: number;
  };
  reasons: string[];
}

export type SignalStatus =
  | "WAIT"
  | "READY"
  | "ENTERED"
  | "PROFIT"
  | "LOSS"
  | "EXITED"
  | "NO_TRADE"
  | "BLOCKED";

export type LifecycleState =
  | "WAITING_FOR_DATA"
  | "DATA_READY"
  | "ANALYZING"
  | "NO_TRADE"
  | "SETUP_READY"
  | "RISK_CHECK"
  | "APPROVED"
  | "PAPER_ENTRY"
  | "POSITION_OPEN"
  | "MONITORING"
  | "EXIT_TRIGGERED"
  | "CLOSING"
  | "CLOSED"
  | "BLOCKED"
  | "ERROR";

export type SessionState =
  | "PRE_MARKET"
  | "MARKET_OPEN"
  | "ACTIVE"
  | "RISK_LOCKED"
  | "MARKET_CLOSED";

export interface AutoHedgeSignal {
  symbol: string;
  timestamp: string;
  regime: RegimeType;
  score: number;
  action: StrategyType;
  expiry: string;
  spotPrice: number;
  sellLeg?: {
    symbol: string;
    strike: number;
    optionType: "CE" | "PE";
    ltp: number;
    bid: number;
    ask: number;
    iv: number;
    delta: number;
  };
  buyLeg?: {
    symbol: string;
    strike: number;
    optionType: "CE" | "PE";
    ltp: number;
    bid: number;
    ask: number;
    iv: number;
    delta: number;
  };
  netCredit: number;
  maxProfit: number;
  maxLoss: number;
  entryPrice: number;
  stopLossSpread: number;
  targetSpread: number;
  quantityLots: number;
  totalQuantity: number;
  marginRequired: number;
  charges: ChargeBreakdown;
  expectedNetPnl: number;
  riskPercentage: number;
  rewardRiskRatio: number;
  status: SignalStatus;
  reasons: string[];
  /** Attached candidate spread for audit store */
  candidateSpread?: CandidateSpread;
  /** Regime details for audit */
  regime_details?: {
    regime: RegimeType;
    trend1H: string;
    trend15M: string;
    vwap: number;
    atr: number;
  };
}

export interface PositionLeg {
  symbol: string;
  strike: number;
  optionType: "CE" | "PE";
  side: "SELL" | "BUY";
  entryPrice: number;
  currentPrice: number;
  quantity: number;
  delta?: number;
  gamma?: number;
  status?: "FILLED" | "PENDING" | "REJECTED";
}

export interface PositionSnapshot {
  timestamp: string;
  spot: number;
  spreadPrice: number;
  unrealizedPnl: number;
  support?: number;
  resistance?: number;
  vwap?: number;
  rsi?: number;
  delta?: number;
  gamma?: number;
  iv?: number;
  distanceToSL?: number;
  distanceToTarget?: number;
}

export interface NiftySpreadPosition {
  id: string;
  userId: string;
  signalId?: string;
  symbol: string;
  strategy: StrategyType;
  expiry: string;
  sellLeg: PositionLeg;
  buyLeg: PositionLeg;
  sellLeg2?: PositionLeg;
  buyLeg2?: PositionLeg;
  quantityLots: number;
  totalQuantity: number;
  netCredit: number;
  maxLoss: number;
  stopLossSpread: number;
  targetSpread: number;
  status: "OPEN" | "CLOSING" | "CLOSED" | "EMERGENCY_EXIT";
  mode: "PAPER" | "LIVE";
  entryTime: string;
  exitTime?: string;
  currentSpreadPrice: number;
  unrealizedGrossPnl: number;
  unrealizedNetPnl: number;
  realizedGrossPnl?: number;
  totalCharges: number;
  realizedNetPnl?: number;
  exitReason?: string;
  spotPriceAtEntry?: number;
  currentSpotPrice?: number;
  vwapAtEntry?: number;
  supportLevel?: number;
  resistanceLevel?: number;
  shortLegDelta?: number;
  shortLegGamma?: number;
  timeInTradeSeconds?: number;
  snapshots?: PositionSnapshot[];
  createdAt: string;
  updatedAt: string;
}

export interface DailyRiskState {
  dailyPnl: number;
  dailyLossLimit: number;
  dailyProfitTarget: number;
  tradesCountToday: number;
  maxTradesPerDay: number;
  consecutiveLosses: number;
  maxConsecutiveLosses: number;
  isDailyLossLocked: boolean;
  isDailyProfitLocked: boolean;
  isTradeLocked: boolean;
  lockReason: string | null;
}

// ── PHASE 12: PAPER TRADING PERFORMANCE VALIDATION TYPES ─────────────────────

export type DataComponentStatus = "REAL" | "SYNTHETIC" | "STALE" | "MISSING" | "INVALID";

export interface DataComponentHealthMap {
  spot: DataComponentStatus;
  candles: DataComponentStatus;
  optionChain: DataComponentStatus;
  optionPrices: DataComponentStatus;
  iv: DataComponentStatus;
  delta: DataComponentStatus;
  gamma: DataComponentStatus;
  oi: DataComponentStatus;
  overallDataQuality: "REAL LIVE PERFORMANCE" | "SYNTHETIC OPTION DATA — PAPER ESTIMATION" | "STALE_DATA" | "INVALID_DATA";
}

export interface PaperSessionRecord {
  sessionId: string;
  date: string;
  marketOpen: string;
  marketClose: string;
  dataSource: string;
  dataQuality: string;
  isSyntheticOptionData: boolean;
  startingEquity: number;
  endingEquity: number;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  grossPnl: number;
  charges: number;
  slippage: number;
  netPnl: number;
  state: SessionState;
}

export type RejectionCategory =
  | "DATA_INVALID"
  | "DATA_STALE"
  | "DATA_INVALID_OR_STALE"
  | "TREND_CONFLICT"
  | "NO_CLEAR_STRUCTURE"
  | "VWAP_INVALID"
  | "RSI_FAILED"
  | "DELTA_FAILED"
  | "GAMMA_FAILED"
  | "S/R_DISTANCE_FAILED"
  | "MAX_LOSS_EXCEEDED"
  | "VOLATILITY_FAILED"
  | "EVENT_RISK"
  | "DAILY_PROFIT_LOCK"
  | "DAILY_LOSS_LOCK"
  | "MAX_TRADES"
  | "CONSECUTIVE_LOSS_LOCK"
  | "NO_VALID_OPTION"
  // Phase 17 — Genuine Data Provider reasons
  | "REAL_OPTION_CHAIN_UNAVAILABLE"
  | "REAL_OPTION_PRICE_UNAVAILABLE"
  | "AUTHENTICATION_FAILURE"
  | "PROVIDER_ERROR"
  | "MARKET_CLOSED"
  | "UNKNOWN_INSTRUMENT"
  | "EXPIRY_INVALID"
  | "STRIKE_INVALID"
  | "LOT_SIZE_UNVERIFIED"
  | "DUPLICATE_SIGNAL"
  | "HEDGE_FAILURE";

export interface NoTradeReasonStat {
  reason: RejectionCategory;
  count: number;
  percentage: number;
  firstOccurrence: string | null;
  lastOccurrence: string | null;
}

export interface PaperPerformanceSummary {
  totalSessions: number;
  activeSessions: number;
  noTradeSessions: number;
  totalSignals: number;
  totalTrades: number;
  bullPutTrades: number;
  bearCallTrades: number;
  ironCondorTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRatePct: number;
  grossPnl: number;
  charges: number;
  slippage: number;
  netPnl: number;
  averageTrade: number;
  averageWinner: number;
  averageLoser: number;
  largestWinner: number;
  largestLoser: number;
  profitFactor: number;
  maxDrawdownPct: number;
  expectancy: number;
  maxConsecutiveWins: number;
  maxConsecutiveLosses: number;
  averageHoldingTimeSeconds: number;
  validationStatus: "INSUFFICIENT SAMPLE" | "VALIDATED";
  minRequiredSessions: number;
  minRequiredTrades: number;
  minRequiredActiveSessions: number;
}

export interface DailyPerformanceStat {
  date: string;
  trades: number;
  grossPnl: number;
  charges: number;
  slippage: number;
  netPnl: number;
  winRatePct: number;
  dailyLockStatus: string;
}

export interface TargetAnalysis1000 {
  daysNetAbove1000: number;
  daysNetBelow1000: number;
  daysNetNegative: number;
  noTradeDays: number;
  averageDailyNet: number;
  medianDailyNet: number;
}

export interface StrategyBreakdownItem {
  strategy: StrategyType;
  signals: number;
  trades: number;
  winRatePct: number;
  netPnl: number;
  avgTradeInr: number;
  profitFactor: number;
  maxDrawdownPct: number;
  avgHoldingTimeSeconds: number;
}

export type SystemHealthState = "HEALTHY" | "DEGRADED" | "STALE" | "ERROR";

export interface SystemHealthMetrics {
  marketDataLatencyMs: number;
  lastSpotUpdate: string;
  lastOptionChainUpdate: string;
  lastSignalEvaluation: string;
  lastTradeEvent: string;
  webSocketStatus: SystemHealthState;
  apiStatus: SystemHealthState;
  databaseStatus: SystemHealthState;
  overallHealth: SystemHealthState;
}

export interface SideBySideMetric {
  tradeFrequency: number;
  winRatePct: number;
  avgTradeInr: number;
  netPnl: number;
  maxDrawdownPct: number;
  noTradeFrequencyPct: number;
  strategyDistribution: Record<string, number>;
  exitDistribution: Record<string, number>;
}

export interface PaperVsHistoricalComparison {
  historicalBacktest: SideBySideMetric;
  livePaperTrading: SideBySideMetric;
}

// ── PHASE 14: EXTENDED PAPER TRADING & STATISTICAL VALIDATION TYPES ───────────

export interface StrategyFingerprint {
  version: string;
  strategyConfigHash: string;
  riskConfigHash: string;
  indicatorConfigHash: string;
  executionConfigHash: string;
  masterFingerprintHash: string;
  timestamp: string;
}

export interface ValidationCohort {
  cohortId: string;
  cohortName: string;
  fingerprint: StrategyFingerprint;
  startDate: string;
  endDate?: string;
  totalSessions: number;
  totalTrades: number;
  activeSessions: number;
  isActive: boolean;
}

export interface RollingMetricWindow {
  windowSize: 10 | 20 | 30;
  tradeCount: number;
  winRatePct: number;
  averageNetPnl: number;
  profitFactor: number;
  maxDrawdownPct: number;
}

export interface ExitAnalysisItem {
  exitReason: string;
  count: number;
  percentage: number;
  netPnl: number;
  averageNetPnl: number;
}

export interface RegimeBreakdownItem {
  regime: RegimeType;
  tradeCount: number;
  winRatePct: number;
  netPnl: number;
  averageTradeInr: number;
  maxDrawdownPct: number;
}

export type ScorecardStatus = "IN PROGRESS" | "SAMPLE REQUIREMENTS MET" | "VALIDATION BLOCKED" | "VALIDATION FAILED";
export type ValidationPassStatus = "VALIDATION COMPLETE" | "VALIDATION INCOMPLETE";

export interface ValidationScorecard {
  validationStatus: ScorecardStatus;
  passStatus: ValidationPassStatus;
  sampleRequirements: {
    sessionsCount: number;
    minSessions: number;
    sessionsMet: boolean;
    tradesCount: number;
    minTrades: number;
    tradesMet: boolean;
    activeSessionsCount: number;
    minActiveSessions: number;
    activeSessionsMet: boolean;
  };
  riskViolations: {
    maxLossViolationsCount: number;
    dailyLockViolationsCount: number;
    consecutiveLossViolationsCount: number;
  };
  executionAnomalies: {
    duplicateOrders: number;
    duplicateTrades: number;
    duplicateExits: number;
    partialFills: number;
    rejectedOrders: number;
  };
  dataQualityAndReliability: {
    realDataSessions: number;
    syntheticDataSessions: number;
    reconciliationFailuresCount: number;
    dataFailuresCount: number;
    systemRestartsCount: number;
  };
  safetyLocks: {
    paperTradingEnabled: boolean;
    liveTradingLocked: boolean;
    brokerExecutionDisabled: boolean;
  };
  fingerprintHash: string;
  cohortId: string;
}

export interface ExtendedValidationReport {
  scorecard: ValidationScorecard;
  cohort: ValidationCohort;
  performanceSummary: PaperPerformanceSummary;
  dailyPerformance: {
    dailyStats: DailyPerformanceStat[];
    averageDailyNet: number;
    medianDailyNet: number;
    stdDevDailyNet: number;
    bestDay: number;
    worstDay: number;
    positiveDays: number;
    negativeDays: number;
    flatDays: number;
    noTradeDays: number;
  };
  targetAnalysis1000: TargetAnalysis1000 & {
    averageWinningDayNet: number;
    averageLosingDayNet: number;
  };
  rollingMetrics: RollingMetricWindow[];
  strategyBreakdown: StrategyBreakdownItem[];
  regimeBreakdown: RegimeBreakdownItem[];
  exitAnalysis: ExitAnalysisItem[];
  historicalVsPaper: PaperVsHistoricalComparison;
  drawdownAnalysis: {
    peakEquity: number;
    troughEquity: number;
    maxDrawdownPct: number;
    maxDrawdownInr: number;
    drawdownDurationSessions: number;
    recoveryDurationSessions: number;
    maxConsecutiveLosses: number;
  };
  executionQuality: {
    signalToEntryLatencyMs: number;
    entryToMonitoringLatencyMs: number;
    exitTriggerToExitLatencyMs: number;
    duplicateOrders: number;
    duplicateTrades: number;
    duplicateExits: number;
  };
}

// ── PHASE 15: GENUINE LIVE PAPER TRADING VALIDATION TYPES ─────────────────────

export type DataSourceLabel = "REAL" | "SYNTHETIC" | "CALCULATED" | "UNAVAILABLE" | "STALE";

export interface ProviderTransparencyRecord {
  spotProvider: string;
  spotLabel: DataSourceLabel;
  candleProvider: string;
  candleLabel: DataSourceLabel;
  optionChainProvider: string;
  optionChainLabel: DataSourceLabel;
  optionPriceProvider: string;
  optionPriceLabel: DataSourceLabel;
  ivSource: string;
  ivLabel: DataSourceLabel;
  deltaSource: string;
  deltaLabel: DataSourceLabel;
  gammaSource: string;
  gammaLabel: DataSourceLabel;
  dataTimestamp: string;
}

export interface GenuineDataGateResult {
  isGenuineSessionValidating: boolean;
  spotReal: boolean;
  optionChainReal: boolean;
  optionPricesReal: boolean;
  rejectionReason: string | null;
  transparency: ProviderTransparencyRecord;
}

export interface Phase14VsPhase15Comparison {
  phase14SimulatedBenchmark: SideBySideMetric;
  phase15GenuineLivePaper: SideBySideMetric;
}

export type Phase15ScorecardStatus =
  | "IN PROGRESS"
  | "SAMPLE REQUIREMENTS MET"
  | "VALIDATION BLOCKED — GENUINE LIVE NIFTY OPTION-CHAIN DATA REQUIRED"
  | "VALIDATION FAILED";

export interface GenuinePaperValidationReport {
  scorecardStatus: Phase15ScorecardStatus;
  isGenuineOptionChainAvailable: boolean;
  genuineSample: {
    genuineSessionsCount: number;
    minGenuineSessions: number;
    genuineSessionsMet: boolean;
    genuineTradesCount: number;
    minGenuineTrades: number;
    genuineTradesMet: boolean;
    genuineActiveSessionsCount: number;
    minGenuineActiveSessions: number;
    genuineActiveSessionsMet: boolean;
  };
  genuinePerformance: PaperPerformanceSummary;
  providerTransparency: ProviderTransparencyRecord;
  phase14VsPhase15: Phase14VsPhase15Comparison;
  safetyLocks: {
    paperTradingEnabled: boolean;
    liveTradingLocked: boolean;
    brokerExecutionDisabled: boolean;
  };
  antiSimulationCheckPassed: boolean;
  antiHindsightCheckPassed: boolean;
  blockedMessage?: string;
}
// ── PHASE 17: GENUINE DATA PROVIDER INTEGRATION TYPES ─────────────────────────

/**
 * Explicit data source type for every market data component.
 * REAL = from genuine live provider, verified and fresh.
 * SYNTHETIC = generated/simulated data.
 * UNKNOWN = source cannot be determined.
 * STALE = real at some point but age > threshold.
 * INVALID = received but failed validation.
 */
export type DataSourceType = "REAL" | "SYNTHETIC" | "UNKNOWN" | "STALE" | "INVALID";

/**
 * Health record for a single data component (spot, option chain, option prices).
 */
export interface ComponentHealth {
  status: "AVAILABLE" | "STALE" | "MISSING" | "INVALID" | "ERROR";
  sourceType: DataSourceType;
  ageMs: number;
  lastUpdateMs: number;
  errorMessage?: string;
}

/**
 * Canonical normalized option contract.
 * Every field has an explicit source label.
 * Missing optional fields are absent (never fabricated).
 */
export interface CanonicalOptionContract {
  // Required fields
  underlying: string;        // "NIFTY"
  expiry: string;            // ISO date string e.g. "2026-09-25"
  strike: number;
  optionType: "CE" | "PE";
  bid: number;
  ask: number;
  ltp: number;
  timestamp: string;         // ISO datetime
  source: string;            // provider name e.g. "NSE_INDIA"
  sourceType: DataSourceType;

  // Optional — absent if provider does not supply
  volume?: number;
  openInterest?: number;

  // IV — must be labelled if present
  iv?: number;
  ivSource?: "REAL" | "PROVIDER_DERIVED" | "UNAVAILABLE";

  // Greeks — must be labelled if present
  delta?: number;
  deltaSource?: "REAL" | "PROVIDER_DERIVED" | "UNAVAILABLE";
  gamma?: number;
  gammaSource?: "REAL" | "PROVIDER_DERIVED" | "UNAVAILABLE";
  theta?: number;
  thetaSource?: "REAL" | "PROVIDER_DERIVED" | "UNAVAILABLE";
  vega?: number;
  vegaSource?: "REAL" | "PROVIDER_DERIVED" | "UNAVAILABLE";
}

/**
 * Full Phase 17 data health status — one record per evaluation cycle.
 */
export interface Phase17DataHealth {
  spot: ComponentHealth;
  optionChain: ComponentHealth;
  optionPrices: ComponentHealth;
  timestamps: {
    spotMs: number;
    optionChainMs: number;
  };
  providerStatus: string;
  authenticationStatus: "OK" | "FAILED" | "NOT_REQUIRED";
  marketStatus: "OPEN" | "CLOSED" | "PRE_MARKET" | "UNKNOWN";
  dataSource: string;
  lastUpdate: string;        // ISO
  ageMs: number;             // age of oldest critical component
  genuineDataReady: boolean; // true only when REAL_SPOT && REAL_CHAIN && REAL_PRICES && NOT_STALE
  blockedReason: string | null;
}

/**
 * Phase 17 paper session record — extended session tracking.
 * Distinguishes REAL_GENUINE_PAPER_SAMPLE from SIMULATED_TEST_SAMPLE.
 */
export interface Phase17PaperSession {
  sessionId: string;
  startTime: string;
  endTime?: string;
  dataSource: string;
  spotSource: DataSourceType;
  optionChainSource: DataSourceType;
  optionPriceSource: DataSourceType;
  dataGate: "READY" | "BLOCKED";
  isGenuinePaperSample: boolean;  // true only when all three are REAL
  signals: number;
  noTradeReasons: Record<string, number>;
  entries: number;
  exits: number;
  charges: number;
  slippage: number;
  grossPnl: number;
  netPnl: number;
  maxDrawdown: number;
  riskViolations: number;
  reconciliationStatus: "OK" | "MISMATCH" | "PENDING";
}

/**
 * Result from the Phase 17 genuine data gate evaluation.
 */
export interface Phase17GenuineGateResult {
  genuineDataReady: boolean;
  spotStatus: ComponentHealth;
  optionChainStatus: ComponentHealth;
  optionPricesStatus: ComponentHealth;
  blockedReason: string | null;
  providerName: string;
  authenticationStatus: "OK" | "FAILED" | "NOT_REQUIRED";
  marketStatus: "OPEN" | "CLOSED" | "PRE_MARKET" | "UNKNOWN";
  evaluatedAt: string;
  lotSizeVerified: boolean;
  currentLotSize: number | null;
}

// ── PHASE 18: GENUINE LIVE PAPER TRADING OPERATIONS & DATA RELIABILITY TYPES ──

export type MarketSessionState = "PRE_MARKET" | "MARKET_OPEN" | "MARKET_CLOSING" | "MARKET_CLOSED";

export type Phase18ComponentStatus = "HEALTHY" | "STALE" | "MISSING" | "ERROR";

export type SampleClassification = "REAL_GENUINE_PAPER" | "SIMULATED_TEST" | "INVALID";

export interface Phase18ComponentFreshness {
  status: Phase18ComponentStatus;
  sourceType: DataSourceType;
  ageMs: number;
  lastSuccessfulUpdateMs: number;
  errorMessage?: string;
}

export interface Phase18FreshnessMetrics {
  spot: Phase18ComponentFreshness;
  optionChain: Phase18ComponentFreshness;
  optionPrices: Phase18ComponentFreshness;
  overallStatus: Phase18ComponentStatus;
  maxAgeMs: number;
  evaluatedAt: string;
}

export interface Phase18OperationalGateResult {
  sessionGate: "READY" | "BLOCKED";
  sessionState: MarketSessionState;
  realSpot: boolean;
  realOptionChain: boolean;
  realOptionPrices: boolean;
  dataNotStale: boolean;
  lotSizeVerified: boolean;
  currentProviderLotSize: number | null;
  marketSessionValid: boolean;
  safetyLocksValid: boolean;
  blockedReason: string | null;
  evaluatedAt: string;
}

