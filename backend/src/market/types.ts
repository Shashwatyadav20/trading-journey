export type PriceStatus = "LIVE" | "STALE" | "OFFLINE";

export interface MarketPrice {
  instrument: string; // e.g. "BTC/USD"
  price: number;
  timestamp: string; // ISO string
  source: string; // e.g. "coinbase" or "xaus"
  sourceSymbol: string; // e.g. "BTC-USD" or "XAU/USD"
  isProxy: boolean;
  status: PriceStatus;
  expectedUpdateIntervalMs?: number;
}
