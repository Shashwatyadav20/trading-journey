export type TradeSide = "LONG" | "SHORT";

export type TradeStatus = "OPEN" | "WIN" | "LOSS" | "BREAKEVEN";

export type OrderType = "MARKET" | "LIMIT";

export type MistakeTag =
  | "No Mistake"
  | "Late Entry"
  | "Early Exit"
  | "Overtrading"
  | "Moved Stop Loss"
  | "Revenge Trade"
  | "FOMO"
  | "Oversized Position"
  | "No Confirmation";

export const MISTAKE_OPTIONS: MistakeTag[] = [
  "No Mistake",
  "Late Entry",
  "Early Exit",
  "Overtrading",
  "Moved Stop Loss",
  "Revenge Trade",
  "FOMO",
  "Oversized Position",
  "No Confirmation",
];

export const PRESET_STRATEGIES: string[] = [
  "Liquidity Sweep",
  "swing high and swing low",
  "EQH AND EQL",
  "PWL AND PWH",
  "OB CREATE AND RETEST THEN ENTRY",
];

export interface Trade {
  id: string;
  date: string; // YYYY-MM-DD
  time?: string; // HH:mm
  exitTime?: string; // HH:mm
  holdingTime?: string; // e.g. "25m", "1h 10m"
  symbol: string;
  side: TradeSide;
  strategy: string;
  entryPrice: number;
  stopLoss?: number;
  targetPrice?: number;
  exitPrice: number;
  quantity: number;
  pnl: number; // Net PnL after fees
  fees: number;
  rMultiple: number;
  status: TradeStatus;
  orderType?: OrderType;
  notes?: string;
  mistakeTag?: MistakeTag;
  screenshotUrl?: string;
}

export type PendingOrderStatus = "PENDING" | "FILLED" | "CANCELLED";

export interface PendingOrder {
  id: string;
  instrument: string;
  side: TradeSide;
  orderType: "LIMIT";
  limitPrice: number;
  quantity: number;
  stopLoss: number;
  takeProfit: number;
  strategy: string;
  createdAt: string; // ISO date string
  status: PendingOrderStatus;
}

export interface EquityPoint {
  date: string;
  tradeIndex: number;
  label: string;
  tradePnL: number;
  cumulativePnL: number;
  capital: number;
}

export interface StrategyMetrics {
  strategy: string;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  grossProfit: number;
  grossLoss: number;
  netPnL: number;
  profitFactor: number;
  hasLosses: boolean;
  averageR: number;
  maxDrawdown: number;
  maxDrawdownPercent: number;
  compositeScore: number;
  rank?: number;
  rankReason?: string;
}

export interface DashboardMetrics {
  startingCapital: number;
  currentCapital: number;
  netPnL: number;
  grossProfit: number;
  grossLoss: number;
  returnPercentage: number;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  profitFactor: number;
  hasLosses: boolean;
  averageR: number;
  maxDrawdown: number;
  maxDrawdownPercentage: number;
  bestStrategy: string;
  worstStrategy: string;
}
