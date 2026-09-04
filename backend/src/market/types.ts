export type PriceStatus = "LIVE" | "STALE" | "OFFLINE";

export interface MarketPrice {
  instrument: string; // e.g. "BTC/USD"
  price: number;
  timestamp: string; // ISO string
  source: string; // e.g. "binance"
  sourceSymbol: string; // e.g. "BTCUSDT"
  isProxy: boolean;
  status: PriceStatus;
}
