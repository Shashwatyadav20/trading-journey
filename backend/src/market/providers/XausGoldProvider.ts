import { MarketPrice } from "../types";
import { MarketProvider } from "./MarketProvider";

/**
 * XausGoldProvider fetches actual spot gold (XAU/USD) prices from the XAUS spot API.
 * 
 * NOTE: XAUS provides an official XAU/USD spot reference feed directly representing
 * physical gold in USD per troy ounce. Therefore, XAU/USD is NOT a proxy (isProxy: false).
 * 
 * Documentation & Fair Use:
 * The XAUS API is cached upstream for approximately 30 seconds.
 * Polling is performed at a controlled 30-second interval (30,000ms) to align with provider guidance.
 */
export class XausGoldProvider implements MarketProvider {
  private currentPrice: MarketPrice;
  private intervalId: NodeJS.Timeout | null = null;
  private onUpdateCallback: ((price: MarketPrice) => void) | null = null;
  private pollIntervalMs: number;
  private isRunning: boolean = true;
  private backoffMs: number = 0;
  private backoffUntil: number = 0;
  private readonly apiUrl: string = "https://xaus.com/api/v1/spot";

  constructor(pollIntervalMs: number = 30000) {
    this.pollIntervalMs = pollIntervalMs;
    this.currentPrice = {
      instrument: "XAU/USD",
      price: 0,
      timestamp: new Date().toISOString(),
      source: "xaus",
      sourceSymbol: "XAU/USD",
      isProxy: false, // Actual XAU/USD spot data
      status: "OFFLINE",
      expectedUpdateIntervalMs: 30000,
    };
  }

  onUpdate(callback: (price: MarketPrice) => void): void {
    this.onUpdateCallback = callback;
  }

  getCurrentPrice(): MarketPrice {
    return this.currentPrice;
  }

  start(): void {
    this.isRunning = true;
    if (this.intervalId) return;
    this.poll();
    this.intervalId = setInterval(() => this.poll(), this.pollIntervalMs);
  }

  stop(): void {
    this.isRunning = false;
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  private async poll(): Promise<void> {
    if (!this.isRunning) return;

    const now = Date.now();
    if (now < this.backoffUntil) {
      const remaining = this.backoffUntil - now;
      console.warn(`[XausGoldProvider] Skipping poll during controlled backoff. Retry in ${remaining}ms.`);
      return;
    }

    console.log(`[XausGoldProvider] Request started for ${this.apiUrl} at ${new Date().toISOString()}`);

    try {
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), 8000);
      const res = await fetch(this.apiUrl, {
        signal: controller.signal,
        cache: "no-store",
        headers: {
          "Accept": "application/json",
        },
      });
      clearTimeout(id);

      if (!res.ok) {
        let body = "";
        try {
          body = await res.text();
        } catch {
          body = "<failed to read body>";
        }

        this.backoffMs = Math.min(this.backoffMs ? this.backoffMs * 2 : 10000, 60000);
        this.backoffUntil = Date.now() + this.backoffMs;

        console.error(
          `[XausGoldProvider] Request failed: HTTP error ${res.status} ${res.statusText}. ` +
          `Response body: ${body}. Backing off for ${this.backoffMs}ms.`
        );
        return;
      }

      const data = await res.json();
      const rawPrice = data?.spot_usd_oz;
      const price = typeof rawPrice === "number" ? rawPrice : parseFloat(rawPrice);

      if (typeof price === "number" && Number.isFinite(price) && price > 0) {
        this.backoffMs = 0;
        this.backoffUntil = 0;

        const sourceTimestamp = data?.timestamp || data?.updated_at;
        console.log(
          `[XausGoldProvider] Request succeeded. Valid XAU/USD spot price received: ${price}` +
          (sourceTimestamp ? ` (Source timestamp: ${sourceTimestamp})` : "")
        );

        this.currentPrice = {
          instrument: "XAU/USD",
          price,
          timestamp: new Date().toISOString(),
          source: "xaus",
          sourceSymbol: "XAU/USD",
          isProxy: false,
          status: "LIVE",
          expectedUpdateIntervalMs: 30000,
        };

        if (this.onUpdateCallback) {
          this.onUpdateCallback(this.currentPrice);
        }
        return;
      }

      console.error(`[XausGoldProvider] Invalid spot_usd_oz in response payload: ${JSON.stringify(data)}`);
    } catch (err: any) {
      this.backoffMs = Math.min(this.backoffMs ? this.backoffMs * 2 : 10000, 60000);
      this.backoffUntil = Date.now() + this.backoffMs;

      console.error(
        `[XausGoldProvider] Request failed with network/timeout error: ${err?.name || "Error"} - ${err?.message || String(err)}. ` +
        `Backing off for ${this.backoffMs}ms.`
      );
    }
  }
}
