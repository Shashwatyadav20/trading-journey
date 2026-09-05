/**
 * Frontend types mirroring backend PineTypes.ts ActiveLevel & PremiumDiscountZoneState.
 * These must stay in sync with backend/src/alerts/pine/PineTypes.ts.
 * Do NOT add frontend calculations here — all values come from the backend engine.
 */

export type PineLevelType =
  | "EQH"
  | "EQL"
  | "PWH"
  | "PWL"
  | "SWH"
  | "SWL"
  | "PREMIUM"
  | "DISCOUNT"
  | "EQUILIBRIUM";

export type PineLineStyle = "solid" | "dashed" | "dotted";

export interface PineActiveLevel {
  id: string;
  type: PineLevelType;
  label: string;
  price: number;
  timeframe: string;
  color: string;
  lineStyle: PineLineStyle;
  lineWidth: number;
  createdAtBar: number;
}

export interface PinePDZoneState {
  active: boolean;
  top: number | null;
  bottom: number | null;
  equilibrium: number | null;
  lastPH: number | null;
  lastPL: number | null;
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
  referenceLevelType: string;
  confidence?: number;
  status: PineSignalStatus;
  notes?: string;
}

export interface PineLevelsResponse {
  instrument: string;
  levels: PineActiveLevel[];
  timestamp: string;
}

export interface PineZoneResponse {
  instrument: string;
  zone: PinePDZoneState | null;
  timestamp: string;
}
