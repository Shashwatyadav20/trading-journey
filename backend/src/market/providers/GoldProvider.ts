import { MarketPrice } from "../types";
import { MarketProvider } from "./MarketProvider";

export class GoldProvider implements MarketProvider {
  private currentPrice: MarketPrice;
  private intervalId: NodeJS.Timeout | null = null;
  private onUpdateCallback: ((price: MarketPrice) => void) | null = null;
  private pollIntervalMs: number;

  constructor(pollIntervalMs: number = 3000) {
    this.pollIntervalMs = pollIntervalMs;
    this.currentPrice = {
      instrument: "XAU/USD",
      price: 0,
      timestamp: new Date().toISOString(),
      source: "binance",
      sourceSymbol: "PAXGUSDT",
      isProxy: true, // IMPORTANT: Marked as proxy
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
    const url = "https://api.binance.com/api/v3/ticker/price?symbol=PAXGUSDT";
    try {
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(url, {
        signal: controller.signal,
        cache: "no-store",
      });
      clearTimeout(id);

      if (!res.ok) {
        let body = "";
        try {
          body = await res.text();
        } catch {
          body = "<failed to read response body>";
        }
        const errorMsg = `HTTP error ${res.status} ${res.statusText}. Response body: ${body}`;
        const err = new Error(errorMsg);
        (err as any).status = res.status;
        (err as any).responseBody = body;
        throw err;
      }

      const data = await res.json();
      const price = parseFloat(data?.price);
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

      const invalidErr = new Error(`Invalid price payload: ${JSON.stringify(data)}`);
      throw invalidErr;
    } catch (e: any) {
      const statusInfo = e?.status ? ` HTTP status: ${e.status}.` : "";
      const bodyInfo = e?.responseBody ? ` Response body: ${e.responseBody}.` : "";
      console.error(
        `[GoldProvider] Error fetching ${this.currentPrice.sourceSymbol} (${this.currentPrice.instrument}) from ${url}:` +
        ` provider=binance instrument=${this.currentPrice.instrument} symbol=${this.currentPrice.sourceSymbol} url=${url}.` +
        `${statusInfo}${bodyInfo} errorName=${e?.name || "Error"} errorMessage=${e?.message || String(e)}`
      );
    }
  }
}
