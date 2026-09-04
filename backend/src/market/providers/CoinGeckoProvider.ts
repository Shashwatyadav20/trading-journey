import { MarketPrice } from "../types";
import { MarketProvider } from "./MarketProvider";

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
  private backoffMs: number = 0;
  private backoffUntil: number = 0;

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
    const now = Date.now();
    if (now < this.backoffUntil) {
      return;
    }

    const url = `https://api.coingecko.com/api/v3/simple/price?ids=${this.coinId}&vs_currencies=usd`;
    try {
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(url, {
        signal: controller.signal,
        cache: "no-store",
        headers: {
          "Accept": "application/json",
        },
      });
      clearTimeout(id);

      if (res.status === 429) {
        this.backoffMs = Math.min(this.backoffMs ? this.backoffMs * 2 : 10000, 60000);
        this.backoffUntil = Date.now() + this.backoffMs;
      }

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
      const rawPrice = data?.[this.coinId]?.usd;
      const price = typeof rawPrice === "number" ? rawPrice : parseFloat(rawPrice);

      if (typeof price === "number" && Number.isFinite(price) && price > 0) {
        this.backoffMs = 0;
        this.backoffUntil = 0;
        this.currentPrice = {
          ...this.currentPrice,
          price,
          timestamp: new Date().toISOString(),
          status: "LIVE",
        };
        if (this.onUpdateCallback) this.onUpdateCallback(this.currentPrice);
        return;
      }

      const invalidErr = new Error(`Invalid price payload for ${this.coinId}: ${JSON.stringify(data)}`);
      throw invalidErr;
    } catch (e: any) {
      const statusInfo = e?.status ? ` HTTP status: ${e.status}.` : "";
      const bodyInfo = e?.responseBody ? ` Response body: ${e.responseBody}.` : "";
      console.error(
        `[${this.logTag}] Error fetching ${this.coinId} (${this.instrument}) from ${url}:` +
        ` provider=coingecko instrument=${this.instrument} symbol=${this.coinId} url=${url}.` +
        `${statusInfo}${bodyInfo} errorName=${e?.name || "Error"} errorMessage=${e?.message || String(e)}`
      );
    }
  }
}
