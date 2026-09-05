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

  // 15M+ Major Swing High/Low
  showSwings: boolean;
  swingPivotLen: number;
  maxSwingLevels: number;

  // Premium/Discount Zone
  showPDZone: boolean;
  pdZoneTF: string;
  pdPivotLen: number;
  pdAtrLen: number;
  pdAtrMult: number;
  showEqLine: boolean;
  colPremium: string;
  colDiscount: string;
  colEqLine: string;

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
}

export const DEFAULT_PINE_INPUTS: PineInputs = {
  showEQ_15: true,
  showEQ_1H: true,
  showEQ_4H: true,
  showEQ_D: true,
  eqPivotLen: 5,
  eqTolPct: 0.05,
  maxEQLevels: 6,

  showPW: true,

  showSwings: true,
  swingPivotLen: 10,
  maxSwingLevels: 6,

  showPDZone: true,
  pdZoneTF: "15",
  pdPivotLen: 10,
  pdAtrLen: 14,
  pdAtrMult: 0.25,
  showEqLine: true,
  colPremium: "#ef4444d9", // red 85%
  colDiscount: "#22c55ed9", // green 85%
  colEqLine: "#808080",

  extendLevels: true,
  labelSize: "small",
  showPriceInLabel: true,
  overlapTolPct: 0.05,

  colEQH: "#d946ef",
  colEQL: "#06b6d4",
  colPWH: "#f97316",
  colPWL: "#eab308",
  colSWH: "#84cc16",
  colSWL: "#ef4444",
};

export interface Candle {
  timestamp: string; // ISO string
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface ActiveLevel {
  id: string;
  type: "EQH" | "EQL" | "PWH" | "PWL" | "SWH" | "SWL" | "PREMIUM" | "DISCOUNT" | "EQUILIBRIUM";
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
  event: "LEVEL_TOUCHED" | "ZONE_ENTERED" | "EQUILIBRIUM_TOUCHED";
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
  referenceLevelType: "EQH" | "EQL" | "PWH" | "PWL" | "SWH" | "SWL" | "ORDER_BLOCK";
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
