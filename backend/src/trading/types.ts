export type PositionSide = "LONG" | "SHORT";
export type PositionStatus = "OPEN" | "CLOSING" | "CLOSED";
export type ExitReason = "MANUAL" | "STOP_LOSS" | "TAKE_PROFIT";
export type PendingOrderStatus = "PENDING" | "FILLED" | "CANCELLED";

export const SUPPORTED_INSTRUMENTS = ["BTC/USD", "XAU/USD"] as const;
export type SupportedInstrument = typeof SUPPORTED_INSTRUMENTS[number];

export interface Position {
  id: string;
  userId: string;
  instrument: SupportedInstrument;
  side: PositionSide;
  quantity: number;
  entryPrice: number;
  entryTime: string; // ISO String
  status: PositionStatus;
  stopLoss?: number | null;
  takeProfit?: number | null;
  exitPrice?: number;
  exitTime?: string; // ISO String
  exitReason?: ExitReason;
  realizedPnl?: number;
  unrealizedPnl: number;
  strategy?: string;
  signalId?: string;
  orderType?: "Market" | "LIMIT";
  createdAt: string; // ISO String
  updatedAt: string; // ISO String
}

export interface MarketOrderRequest {
  instrument: SupportedInstrument;
  side: "BUY" | "SELL";
  quantity: number;
  stopLoss?: number | null;
  takeProfit?: number | null;
  strategy?: string;
  signalId?: string;
  idempotencyKey?: string;
}

export interface LimitOrderRequest {
  instrument: SupportedInstrument;
  side: "BUY" | "SELL";
  quantity: number;
  limitPrice: number;
  stopLoss?: number | null;
  takeProfit?: number | null;
  strategy?: string;
  signalId?: string;
  idempotencyKey?: string;
}

export interface PendingOrder {
  id: string;
  userId: string;
  instrument: SupportedInstrument;
  side: PositionSide;
  quantity: number;
  limitPrice: number;
  stopLoss?: number | null;
  takeProfit?: number | null;
  status: PendingOrderStatus;
  strategy?: string;
  signalId?: string;
  createdAt: string; // ISO String
  updatedAt: string; // ISO String
  filledAt?: string; // ISO String
  positionId?: string;
}
