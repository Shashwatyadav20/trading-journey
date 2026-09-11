import { MarketProvider } from "./providers/MarketProvider";
import { CoinbaseWebSocketProvider } from "./providers/CoinbaseWebSocketProvider";
import { TwelveDataMarketProvider } from "./providers/TwelveDataMarketProvider";
import { isGoldMarketOpen } from "./providers/XausGoldProvider";
import { priceStore } from "./MarketPriceStore";

export class MarketDataService {
  private providers: MarketProvider[] = [];
  private twelveDataProvider: TwelveDataMarketProvider;
  private staleIntervalId: NodeJS.Timeout | null = null;
  private isRunning: boolean = false;

  private readonly STALE_THRESHOLD_MS: number;
  private readonly OFFLINE_THRESHOLD_MS: number;

  constructor() {
    this.STALE_THRESHOLD_MS = parseInt(process.env.MARKET_DATA_STALE_AFTER_MS || "15000", 10);
    this.OFFLINE_THRESHOLD_MS = parseInt(process.env.MARKET_DATA_OFFLINE_AFTER_MS || "45000", 10);

    this.twelveDataProvider = new TwelveDataMarketProvider();

    // Initialize production providers:
    // BTC/USD -> Coinbase WebSocket Provider
    // XAU/USD -> Twelve Data Market Provider
    this.providers.push(new CoinbaseWebSocketProvider());

    if (this.twelveDataProvider.isConfigured()) {
      console.log("[MarketDataService] Initializing Twelve Data as primary XAU/USD market provider.");
      this.providers.push(this.twelveDataProvider);
    } else {
      console.warn("[MarketDataService] TWELVE_DATA_API_KEY credentials not configured. XAU/USD provider running unconfigured.");
      this.providers.push(this.twelveDataProvider);
    }
  }

  public getTwelveDataProvider(): TwelveDataMarketProvider {
    return this.twelveDataProvider;
  }

  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;

    this.providers.forEach((provider) => {
      provider.onUpdate((price) => {
        if (price.instrument === "XAU/USD") {
          console.log(`[MarketDataService] onUpdate received: instrument=${price.instrument} price=${price.price} status=${price.status}`);
        }
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
      if (p.instrument === "XAU/USD") {
        if (!isGoldMarketOpen()) {
          if (p.status !== "MARKET_CLOSED") {
            priceStore.setPrice(p.instrument, { ...p, status: "MARKET_CLOSED" });
          }
          continue;
        }
      }

      if (p.status === "OFFLINE" || p.status === "MARKET_CLOSED") {
        // Safety net: if the XAU/USD provider has fetched a valid live price that
        // never reached priceStore (e.g. onUpdateCallback was null), push it now.
        if (p.instrument === "XAU/USD" && p.status === "OFFLINE" && isGoldMarketOpen()) {
          const providerPrice = this.twelveDataProvider.getCurrentPrice();
          if (
            providerPrice.price > 0 &&
            providerPrice.status === "LIVE" &&
            providerPrice.timestamp !== p.timestamp
          ) {
            console.log(
              `[MarketDataService] XAU/USD safety-net push: ` +
              `stored=${p.price}@${p.timestamp} provider=${providerPrice.price}@${providerPrice.timestamp}`
            );
            priceStore.setPrice(providerPrice.instrument, providerPrice);
          }
        }
        continue;
      }

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
