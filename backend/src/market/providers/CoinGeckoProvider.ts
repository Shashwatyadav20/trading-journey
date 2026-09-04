import { MarketPrice } from "../types";
import { MarketProvider } from "./MarketProvider";
import { CoinGeckoClient } from "./CoinGeckoClient";

export interface CoinGeckoConfig {
  instrument: string;
  coinId: string;
  isProxy: boolean;
  logTag?: string;
  pollIntervalMs?: number;
}

export class CoinGeckoProvider implements MarketProvider {
  private currentPrice: MarketPrice;
  private intervalId: NodeJS.Timeout | null = null;
  private onUpdateCallback: ((price: MarketPrice) => void) | null = null;
  private pollIntervalMs: number;
  private readonly instrument: string;
  private readonly coinId: string;
  private readonly isProxy: boolean;
  private readonly logTag: string;

  constructor(config: CoinGeckoConfig) {
    this.pollIntervalMs = config.pollIntervalMs ?? 2000;
    this.instrument = config.instrument;
    this.coinId = config.coinId;
    this.isProxy = config.isProxy;
    this.logTag = config.logTag || "CoinGeckoProvider";

    this.currentPrice = {
      instrument: this.instrument,
      price: 0,
      timestamp: new Date().toISOString(),
      source: "coingecko",
      sourceSymbol: this.coinId,
      isProxy: this.isProxy,
      status: "OFFLINE",
    };
  }

  onUpdate(callback: (price: MarketPrice) => void): void {
    this.onUpdateCallback = callback;
  }

  getCurrentPrice(): MarketPrice {
    return this.currentPrice;
  }

  start(): void {
    if (this.intervalId) return;
    this.poll();
    this.intervalId = setInterval(() => this.poll(), this.pollIntervalMs);
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  private async poll() {
    try {
      const client = CoinGeckoClient.getInstance();
      const pricesMap = await client.fetchPrices([this.coinId]);
      const priceObj = pricesMap.get(this.coinId);

      if (priceObj && typeof priceObj.price === "number" && Number.isFinite(priceObj.price) && priceObj.price > 0) {
        this.currentPrice = {
          ...this.currentPrice,
          price: priceObj.price,
          timestamp: priceObj.fetchedAt,
          status: "LIVE",
        };
        if (this.onUpdateCallback) {
          this.onUpdateCallback(this.currentPrice);
        }
        return;
      }

      console.error(`[${this.logTag}] Invalid price payload for ${this.coinId}`);
    } catch {
      // Diagnostic error logging is handled by CoinGeckoClient
    }
  }
}
