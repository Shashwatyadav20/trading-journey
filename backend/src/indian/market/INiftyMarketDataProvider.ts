import { Candle, NiftyOptionChain } from "../types";

export interface NiftyDataHealth {
  isHealthy: boolean;
  isStale: boolean;
  lastUpdateTimestamp: number; // Unix ms
  providerName: string;
  errorMessage?: string;
}

export interface SpotPriceResult {
  spotPrice: number;
  timestamp: number; // Unix ms
  isReal: boolean;
}

export interface CandlesResult {
  candles: Candle[];
  isReal: boolean;
}

export interface OptionChainResult {
  chain: NiftyOptionChain;
  isReal: boolean;
}

export interface INiftyMarketDataProvider {
  getProviderName(): string;
  getSpotPrice(): Promise<SpotPriceResult>;
  getCandles(timeframe: "15M" | "1H", limit?: number): Promise<CandlesResult>;
  getOptionChain(spotPrice: number): Promise<OptionChainResult>;
  getDataHealth(): NiftyDataHealth;
}
