export type BrokerConnectionState =
  | "DISCONNECTED"
  | "CONNECTING"
  | "CONNECTED"
  | "DEGRADED"
  | "RECONNECTING"
  | "FAILED";

export type OrderStatus =
  | "CREATED"
  | "SUBMITTED"
  | "ACKNOWLEDGED"
  | "PARTIALLY_FILLED"
  | "FILLED"
  | "REJECTED"
  | "CANCEL_PENDING"
  | "CANCELLED"
  | "UNKNOWN";

export type HedgeLegState =
  | "HEDGE_REQUIRED"
  | "HEDGE_PENDING"
  | "HEDGE_CONFIRMED"
  | "SHORT_ALLOWED"
  | "SHORT_PENDING"
  | "SHORT_CONFIRMED";

export type BrokerRejectionCode =
  | "BROKER_REJECTED"
  | "INVALID_INSTRUMENT"
  | "INSUFFICIENT_MARGIN"
  | "MARKET_CLOSED"
  | "PRICE_OUT_OF_RANGE"
  | "RATE_LIMIT"
  | "TIMEOUT"
  | "UNKNOWN_ERROR"
  | "MAX_LOSS_EXCEEDS_1000_INR"
  | "HEDGE_NOT_CONFIRMED"
  | "KILL_SWITCH_HALTED"
  | "FAIL_CLOSED_LOCK";

export type PositionReconciliationStatus =
  | "MATCHED"
  | "MISMATCH"
  | "MISSING_INTERNAL"
  | "MISSING_BROKER"
  | "UNKNOWN";

export type KillSwitchState = "ENABLED" | "DISABLED" | "TRADING_HALTED";

export interface BrokerOrderRequest {
  clientOrderId: string;
  signalId?: string;
  tradeId?: string;
  symbol: string;
  exchange: "NSE" | "NFO" | "BSE" | "MCX";
  instrument: string;
  expiry: string;
  strike: number;
  optionType: "CE" | "PE";
  side: "BUY" | "SELL";
  quantity: number;
  orderType: "LIMIT" | "MARKET" | "SL" | "SL-M";
  price: number;
  product: "MIS" | "NRML" | "CNC";
  isHedgeLeg?: boolean;
}

export interface BrokerOrderResponse {
  orderId: string;
  clientOrderId: string;
  status: OrderStatus;
  symbol: string;
  side: "BUY" | "SELL";
  requestedQuantity: number;
  filledQuantity: number;
  averagePrice: number;
  rejectionCode?: BrokerRejectionCode;
  rejectionReason?: string;
  timestamp: string;
  brokerCode?: string;
}

export interface BrokerOrder extends BrokerOrderResponse {
  exchange: "NSE" | "NFO" | "BSE" | "MCX";
  instrument: string;
  expiry: string;
  strike: number;
  optionType: "CE" | "PE";
  orderType: "LIMIT" | "MARKET" | "SL" | "SL-M";
  product: "MIS" | "NRML" | "CNC";
  placedTime: string;
  updatedTime: string;
}

export interface BrokerPosition {
  positionId: string;
  symbol: string;
  exchange: "NSE" | "NFO" | "BSE" | "MCX";
  expiry: string;
  strike: number;
  optionType: "CE" | "PE";
  side: "BUY" | "SELL";
  quantity: number;
  buyQuantity: number;
  sellQuantity: number;
  averagePrice: number;
  buyPrice: number;
  sellPrice: number;
  lastPrice: number;
  unrealizedPnl: number;
  realizedPnl: number;
  product: "MIS" | "NRML" | "CNC";
}

export interface BrokerAccount {
  accountId: string;
  brokerName: string;
  cashBalance: number;
  usedMargin: number;
  availableMargin: number;
  collateralMargin: number;
  currency: "INR";
  isPaperAccount: boolean;
}

export interface BrokerQuote {
  symbol: string;
  lastPrice: number;
  bidPrice: number;
  askPrice: number;
  bidQty: number;
  askQty: number;
  volume: number;
  openInterest: number;
  timestamp: string;
}

export interface BrokerInstrument {
  symbol: string;
  tradingSymbol: string;
  instrumentToken: string;
  exchange: "NSE" | "NFO" | "BSE" | "MCX";
  strike: number;
  optionType: "CE" | "PE";
  expiry: string;
  lotSize: number;
  tickSize: number;
}

export interface BrokerConnectionStatus {
  state: BrokerConnectionState;
  connectedAt?: string;
  brokerName: string;
  isPaper: boolean;
  message?: string;
}

export interface IdempotencyRecord {
  clientOrderId: string;
  internalOrderId: string;
  tradeId: string;
  signalId: string;
  timestamp: string;
  strategy: string;
  side: "BUY" | "SELL";
  quantity: number;
  orderResponse: BrokerOrderResponse;
}

export interface IBrokerAdapter {
  connect(): Promise<BrokerConnectionStatus>;
  disconnect(): Promise<void>;
  getConnectionStatus(): BrokerConnectionStatus;
  getAccount(): Promise<BrokerAccount>;
  getPositions(): Promise<BrokerPosition[]>;
  getOrders(): Promise<BrokerOrder[]>;
  getOrder(orderId: string): Promise<BrokerOrder | null>;
  placeOrder(request: BrokerOrderRequest): Promise<BrokerOrderResponse>;
  cancelOrder(orderId: string): Promise<BrokerOrderResponse>;
  modifyOrder(orderId: string, params: Partial<BrokerOrderRequest>): Promise<BrokerOrderResponse>;
  getQuote(symbol: string): Promise<BrokerQuote>;
  getInstrument(symbol: string): Promise<BrokerInstrument | null>;
}
