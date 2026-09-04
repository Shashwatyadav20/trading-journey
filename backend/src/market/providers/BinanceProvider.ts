import { MarketPrice } from "../types";
import { MarketProvider } from "./MarketProvider";

export class BinanceProvider implements MarketProvider {
  private currentPrice: MarketPrice;
  private intervalId: NodeJS.Timeout | null = null;
  private onUpdateCallback: ((price: MarketPrice) => void) | null = null;
  private pollIntervalMs: number;

  constructor(pollIntervalMs: number = 2000) {
    this.pollIntervalMs = pollIntervalMs;
    this.currentPrice = {
      instrument: "BTC/USD",
      price: 0,
      timestamp: new Date().toISOString(),
      source: "binance",
      sourceSymbol: "BTCUSDT",
      isProxy: false,
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
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), 5000);
      const res = await fetch("https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT", {
        signal: controller.signal,
        cache: "no-store",
      });
      clearTimeout(id);

      if (res.ok) {
        const data = await res.json();
        const price = parseFloat(data.price);
        if (!isNaN(price) && price > 0) {
          this.currentPrice = {
            ...this.currentPrice,
            price,
            timestamp: new Date().toISOString(),
            status: "LIVE",
          };
          if (this.onUpdateCallback) this.onUpdateCallback(this.currentPrice);
          return;
        }
      }
      throw new Error("Invalid response or non-ok status");
    } catch (e) {
      // Leave status unchanged or handled by MarketDataService
      // For now just skip updating timestamp so MarketDataService detects it as STALE/OFFLINE
    }
  }
}
