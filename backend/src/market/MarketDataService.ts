import { MarketProvider } from "./providers/MarketProvider";
import { CoinbaseWebSocketProvider } from "./providers/CoinbaseWebSocketProvider";
import { XausGoldProvider } from "./providers/XausGoldProvider";
import { priceStore } from "./MarketPriceStore";

export class MarketDataService {
  private providers: MarketProvider[] = [];
  private staleIntervalId: NodeJS.Timeout | null = null;
  private isRunning: boolean = false;

  private readonly STALE_THRESHOLD_MS: number;
  private readonly OFFLINE_THRESHOLD_MS: number;

  constructor() {
    this.STALE_THRESHOLD_MS = parseInt(process.env.MARKET_DATA_STALE_AFTER_MS || "15000", 10);
    this.OFFLINE_THRESHOLD_MS = parseInt(process.env.MARKET_DATA_OFFLINE_AFTER_MS || "45000", 10);

    const xausPollInterval = parseInt(process.env.GOLD_POLL_INTERVAL_MS || "30000", 10);

    // Initialize production providers
    this.providers.push(new CoinbaseWebSocketProvider());
    this.providers.push(new XausGoldProvider(xausPollInterval));
  }

  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;

    this.providers.forEach((provider) => {
      provider.onUpdate((price) => {
        priceStore.setPrice(price.instrument, price);
      });
      provider.start();

      // Initialize the store with the default provider price
      const initialPrice = provider.getCurrentPrice();
      priceStore.setPrice(initialPrice.instrument, initialPrice);
    });

    // Start background check for stale/offline statuses
    this.staleIntervalId = setInterval(() => this.checkStaleData(), 5000);
  }

  stop(): void {
    this.isRunning = false;
    this.providers.forEach((provider) => provider.stop());
    if (this.staleIntervalId) {
      clearInterval(this.staleIntervalId);
      this.staleIntervalId = null;
    }
  }

  private checkStaleData(): void {
    const now = Date.now();
    const prices = priceStore.getAllPrices();

    for (const p of prices) {
      if (p.status === "OFFLINE") continue;

      const timeSinceUpdate = now - new Date(p.timestamp).getTime();

      // Calculate provider-aware stale & offline thresholds
      const expectedInterval = p.expectedUpdateIntervalMs || 10000;
      const staleThreshold = Math.max(expectedInterval * 2.5, this.STALE_THRESHOLD_MS);
      const offlineThreshold = Math.max(expectedInterval * 5.0, this.OFFLINE_THRESHOLD_MS);

      if (timeSinceUpdate > offlineThreshold) {
        priceStore.setPrice(p.instrument, { ...p, status: "OFFLINE" });
      } else if (timeSinceUpdate > staleThreshold) {
        if (p.status !== "STALE") {
          priceStore.setPrice(p.instrument, { ...p, status: "STALE" });
        }
      }
    }
  }
}

export const marketDataService = new MarketDataService();
