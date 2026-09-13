export interface PineInputs {
  // HTF EQH / EQL
  showEQ_15: boolean;
  showEQ_1H: boolean;
  showEQ_4H: boolean;
  showEQ_D: boolean;
  eqPivotLen: number;
  eqTolPct: number;
  maxEQLevels: number;

  // Previous Week High/Low
  showPW: boolean;

  // Previous Day High/Low
  showPD: boolean;

  // Previous Month High/Low
  showPM: boolean;

  // Session High/Low (Asia, London, New York)
  showSessions: boolean;

  // 15M+ Major Swing High/Low
  showSwings: boolean;
  swingPivotLen: number;
  maxSwingLevels: number;

  // General
  extendLevels: boolean;
  labelSize: "tiny" | "small" | "normal" | "large";
  showPriceInLabel: boolean;
  overlapTolPct: number;

  // Colors
  colEQH: string;
  colEQL: string;
  colPWH: string;
  colPWL: string;
  colSWH: string;
  colSWL: string;
  colPDH: string;
  colPDL: string;
  colPMH: string;
  colPML: string;
  colAsiaH: string;
  colAsiaL: string;
  colLondonH: string;
  colLondonL: string;
  colNYH: string;
  colNYL: string;
}

export const DEFAULT_PINE_INPUTS: PineInputs = {
  showEQ_15: true,
  showEQ_1H: true,
  showEQ_4H: true,
  showEQ_D: true,
  eqPivotLen: 5,
  eqTolPct: 0.05,
  maxEQLevels: 5,

  showPW: true,
  showPD: true,
  showPM: true,
  showSessions: true,

  showSwings: true,
  swingPivotLen: 10,
  maxSwingLevels: 5,

  extendLevels: true,
  labelSize: "small",
  showPriceInLabel: true,
  overlapTolPct: 0.15,

  colEQH: "#d946ef",
  colEQL: "#06b6d4",
  colPWH: "#f97316",
  colPWL: "#eab308",
  colSWH: "#84cc16",
  colSWL: "#ef4444",
  colPDH: "#a855f7",
  colPDL: "#3b82f6",
  colPMH: "#ec4899",
  colPML: "#14b8a6",
  colAsiaH: "#f43f5e",
  colAsiaL: "#10b981",
  colLondonH: "#8b5cf6",
  colLondonL: "#0284c7",
  colNYH: "#d97706",
  colNYL: "#6366f1",
};

export interface Candle {
  timestamp: string; // ISO string
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export type LiquidityLevelType =
  | "EQH"
  | "EQL"
  | "PWH"
  | "PWL"
  | "SWH"
  | "SWL"
  | "PDH"
  | "PDL"
  | "PMH"
  | "PML"
  | "ASIA_H"
  | "ASIA_L"
  | "LONDON_H"
  | "LONDON_L"
  | "NY_H"
  | "NY_L";

export interface ActiveLevel {
  id: string;
  type: LiquidityLevelType;
  label: string;
  price: number;
  timeframe: string;
  color: string;
  lineStyle: "solid" | "dashed" | "dotted";
  lineWidth: number;
  createdAtBar: number;
}

export interface PremiumDiscountZoneState {
  active: boolean;
  top: number | null;
  bottom: number | null;
  equilibrium: number | null;
  lastPH: number | null;
  lastPL: number | null;
}

export interface PineAlertEvent {
  instrument: string;
  levelLabel: string;
  levelPrice: number;
  marketPrice: number;
  timeframe: string;
  event: "LEVEL_TOUCHED";
  timestamp: string;
}

export type PineStrategyCategory =
  | "LIQUIDITY_SWEEP"
  | "SWING"
  | "EQH_EQL"
  | "PWH_PWL"
  | "ORDER_BLOCK"
  | "SWEEP_ENGULFING";

export type PineSignalDirection = "BUY" | "SELL";
export type PineSignalStatus = "NEW" | "ACTIVE" | "EXPIRED" | "INVALIDATED";
export type OrderBlockState = "CREATED" | "RETESTED" | "ACTIVE" | "EXPIRED" | "INVALIDATED";

export interface PineSignal {
  signalId: string;
  instrument: string;
  timestamp: string;
  timeframe: string;
  direction: PineSignalDirection;
  strategy: PineStrategyCategory;
  signalType: "BUY_SETUP" | "SELL_SETUP";
  triggerPrice: number;
  referenceLevel: string;
  referenceLevelType: LiquidityLevelType | "ORDER_BLOCK";
  confidence?: number;
  status: PineSignalStatus;
  orderBlockState?: OrderBlockState;
  candleTimestamp?: string;
  notes?: string;
}

export interface NotificationAlertEvent {
  alertId: string;
  instrument: string;
  timeframe: string;
  strategy: string;
  direction: PineSignalDirection;
  referenceLevel: string;
  levelPrice: number;
  triggerPrice: number;
  timestamp: string;
  message: string;
}
