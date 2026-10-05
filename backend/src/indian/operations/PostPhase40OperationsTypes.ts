/**
 * POST-PHASE-40 PAPER TRADING OPERATIONS & MONITORING — Types
 *
 * This is an operational monitoring layer only.
 * LIVE_TRADING = false, BROKER_EXECUTION_ENABLED = false permanently.
 * Phase 40 remains the final planned validation phase.
 */

export type OperationalHealth = "HEALTHY" | "DEGRADED" | "BLOCKED" | "ERROR" | "MARKET_CLOSED";

// ─── System Status ─────────────────────────────────────────────────────────────
export interface SystemStatus {
  backend: OperationalHealth;
  database: OperationalHealth;
  dhanAuth: OperationalHealth;
  dhanConnection: OperationalHealth;
  websocket: OperationalHealth;
  overall: OperationalHealth;
  evaluatedAt: string;
}

// ─── Market Data Status ────────────────────────────────────────────────────────
export interface MarketDataStatus {
  niftySpot: {
    health: OperationalHealth;
    value: number | null;
    lastUpdated: string;
    ageMs: number;
    isStale: boolean;
    isReal: boolean;
  };
  optionChain: {
    health: OperationalHealth;
    lastUpdated: string;
    ageMs: number;
    isStale: boolean;
    isReal: boolean;
    contractCount: number;
  };
  optionPrices: {
    health: OperationalHealth;
    lastUpdated: string;
    ageMs: number;
    isStale: boolean;
    isReal: boolean;
  };
  greeks: {
    health: OperationalHealth;
    available: boolean;
    deltaAvailable: boolean;
    gammaAvailable: boolean;
  };
  websocketTick: {
    health: OperationalHealth;
    lastTick: string;
    ageMs: number;
  };
  vwapRsiSnapshot: {
    health: OperationalHealth;
    lastComputed: string;
    ageMs: number;
  };
  lotSizeVerified: boolean;
  expiryValid: boolean;
  marketSession: "MARKET_OPEN" | "PRE_MARKET" | "MARKET_CLOSING" | "MARKET_CLOSED";
  genuineDataGate: "OPEN" | "BLOCKED";
  evaluatedAt: string;
}

// ─── Trading Status ────────────────────────────────────────────────────────────
export interface ActivePositionMonitor {
  positionId: string;
  strategy: string;
  expiry: string;
  sellStrike: number;
  buyStrike: number;
  optionType: string;
  lotSize: number;
  quantityLots: number;
  entryPrice: number;          // net credit at entry
  currentSpreadValue: number;
  unrealizedPnL: number;
  delta: number | null;
  gamma: number | null;
  vwap?: number | null;
  rsi?: number | null;
  supportResistance?: string | null;
  initialCredit: number;
  target: number;
  stopLoss: number;
  timeOpenedIso: string;
  timeInTradeSeconds: number;
  dataProvenance: string;
  pnlType: string;
}

export interface TradingStatus {
  activePositions: ActivePositionMonitor[];
  openPositionCount: number;
  closedTodayCount: number;
  lastSignalEvaluatedAt: string;
  lastPaperOrderAt: string;
  lastPaperExitAt: string;
  evaluatedAt: string;
}

// ─── Risk Status ───────────────────────────────────────────────────────────────
export interface RiskStatus {
  dailyPnL: number;
  dailyProfitLockTarget: number;       // ₹1,000
  dailyLossLockLimit: number;          // -₹5,000
  maxTradesPerDay: number;             // 3
  maxConsecutiveLosses: number;        // 2
  maxLossPerTrade: number;             // ₹1,000
  tradesCountToday: number;
  consecutiveLosses: number;
  isDailyProfitLocked: boolean;
  isDailyLossLocked: boolean;
  isTradeLocked: boolean;
  lockReason: string | null;
  canTrade: boolean;
  exposureINR: number;
  evaluatedAt: string;
}

// ─── Reconciliation Status ────────────────────────────────────────────────────
export interface ReconciliationStatus {
  isSafe: boolean;
  blockNewTrades: boolean;
  lastRunAt: string;
  openPositions: number;
  closedPositions: number;
  calculatedDailyPnL: number;
  trackedDailyPnL: number;
  discrepancyCount: number;
  criticalDiscrepancyCount: number;
  discrepancies: Array<{
    type: string;
    entityId: string;
    description: string;
    severity: string;
    timestamp: string;
  }>;
  evaluatedAt: string;
}

// ─── Sample Progress ───────────────────────────────────────────────────────────
export interface SampleProgress {
  genuineSessions: number;
  requiredSessions: number;
  sessionsMet: boolean;
  genuineTrades: number;
  requiredTrades: number;
  tradesMet: boolean;
  activeSessions: number;
  requiredActiveSessions: number;
  activeSessionsMet: boolean;
  validationStatus: "INSUFFICIENT_SAMPLE" | "SAMPLE_COMPLETE";
  phase39CohortId: string;
  phase39State: string;
  phase40FinalState: string;
  evaluatedAt: string;
}

// ─── Operational Alert ────────────────────────────────────────────────────────
export type AlertSeverity = "INFO" | "WARN" | "ERROR" | "CRITICAL";

export interface OperationalAlert {
  id: string;
  severity: AlertSeverity;
  category: string;
  message: string;
  timestamp: string;
  resolved: boolean;
}

export type AlertCategory =
  | "DHAN_DISCONNECTED"
  | "WEBSOCKET_STALE"
  | "OPTION_CHAIN_STALE"
  | "MISSING_GREEKS"
  | "LOT_SIZE_MISMATCH"
  | "EXPIRY_MISMATCH"
  | "RECONCILIATION_FAILURE"
  | "POSITION_MISMATCH"
  | "RISK_LOCK_TRIGGERED"
  | "DUPLICATE_SIGNAL"
  | "INVALID_SESSION"
  | "GENUINE_DATA_GATE_FAILURE"
  | "SPOT_STALE"
  | "SAFETY_LOCK_OK";

// ─── Full Operations Status ───────────────────────────────────────────────────
export interface OperationsStatus {
  system: SystemStatus;
  marketData: MarketDataStatus;
  trading: TradingStatus;
  risk: RiskStatus;
  reconciliation: ReconciliationStatus;
  sample: SampleProgress;
  alerts: OperationalAlert[];
  // Hard-locked safety invariants
  safety: {
    paperTrading: true;
    liveTrading: false;
    brokerExecution: false;
    realDataOnly: true;
    realDhanOrders: 0;
  };
  evaluatedAt: string;
}
