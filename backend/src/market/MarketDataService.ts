import { MarketProvider } from "./providers/MarketProvider";
import { BitcoinProvider } from "./providers/BitcoinProvider";
import { GoldProvider } from "./providers/GoldProvider";
import { priceStore } from "./MarketPriceStore";
import { env } from "../config/env";

export class MarketDataService {
  private providers: MarketProvider[] = [];
  private staleIntervalId: NodeJS.Timeout | null = null;
  private isRunning: boolean = false;

  // Stale and offline thresholds
  private readonly STALE_THRESHOLD_MS: number;
  private readonly OFFLINE_THRESHOLD_MS: number;

  constructor() {
    this.STALE_THRESHOLD_MS = parseInt(process.env.MARKET_DATA_STALE_AFTER_MS || "10000", 10);
    this.OFFLINE_THRESHOLD_MS = parseInt(process.env.MARKET_DATA_OFFLINE_AFTER_MS || "30000", 10);

    // Initialize providers
    const pollInterval = parseInt(process.env.MARKET_DATA_POLL_INTERVAL_MS || "2000", 10);
    this.providers.push(new BitcoinProvider(pollInterval));
    this.providers.push(new GoldProvider(pollInterval));
  }

  start() {
    if (this.isRunning) return;
    this.isRunning = true;

    this.providers.forEach(provider => {
      provider.onUpdate((price) => {
        priceStore.setPrice(price.instrument, price);
      });
      provider.start();
      
      // Initialize the store with the default OFFLINE price
      const initialPrice = provider.getCurrentPrice();
      priceStore.setPrice(initialPrice.instrument, initialPrice);
    });

    // Start background check for stale/offline statuses
    this.staleIntervalId = setInterval(() => this.checkStaleData(), 5000);
  }

  stop() {
    this.isRunning = false;
    this.providers.forEach(provider => provider.stop());
    if (this.staleIntervalId) {
      clearInterval(this.staleIntervalId);
      this.staleIntervalId = null;
    }
  }

  private checkStaleData() {
    const now = Date.now();
    const prices = priceStore.getAllPrices();
    
    for (const p of prices) {
      if (p.status === "OFFLINE") continue; // Already offline, do nothing
      
      const timeSinceUpdate = now - new Date(p.timestamp).getTime();
      
      if (timeSinceUpdate > this.OFFLINE_THRESHOLD_MS) {
        priceStore.setPrice(p.instrument, { ...p, status: "OFFLINE" });
      } else if (timeSinceUpdate > this.STALE_THRESHOLD_MS) {
        if (p.status !== "STALE") {
          priceStore.setPrice(p.instrument, { ...p, status: "STALE" });
        }
      }
    }
  }
}

export const marketDataService = new MarketDataService();
