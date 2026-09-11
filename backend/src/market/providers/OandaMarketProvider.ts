import { MarketPrice } from "../types";
import { MarketProvider } from "./MarketProvider";
import { isGoldMarketOpen } from "./XausGoldProvider";
import { Candle } from "../../alerts/pine/PineTypes";

export interface OandaConfig {
  token?: string;
  accountID?: string;
  environment?: "practice" | "live";
}

/**
 * OandaMarketProvider
 * ===================
 * Backend-only market data provider for OANDA v20 API (XAU_USD).
 *
 * Responsibilities:
 *   - Historical MID candles for M15, M30, H1, H4, D
 *   - Live XAU_USD pricing (bid/ask midpoint)
 *   - Authentication and credentials isolation (server-side only)
 *   - Market closure handling (Friday 22:00 UTC - Sunday 22:00 UTC)
 *
 * Security:
 *   - OANDA_API_TOKEN is NEVER exposed to the frontend or printed in logs.
 *   - All HTTP calls execute strictly on the backend Node server.
 */
export class OandaMarketProvider implements MarketProvider {
  private token: string;
  private accountID: string;
  private environment: "practice" | "live";
  private currentPrice: MarketPrice;
  private intervalId: NodeJS.Timeout | null = null;
  private onUpdateCallback: ((price: MarketPrice) => void) | null = null;
  private isRunning: boolean = false;
  private pollIntervalMs: number;

  constructor(config?: OandaConfig, pollIntervalMs: number = 3000) {
    this.token = config && config.token !== undefined ? config.token : process.env.OANDA_API_TOKEN || "";
    this.accountID = config && config.accountID !== undefined ? config.accountID : process.env.OANDA_ACCOUNT_ID || "";
    const envInput = (config && config.environment) || process.env.OANDA_ENVIRONMENT || "practice";
    this.environment = envInput.toLowerCase() === "live" ? "live" : "practice";
    this.pollIntervalMs = pollIntervalMs;

    const initialStatus = this.isConfigured()
      ? isGoldMarketOpen()
        ? "LIVE"
        : "MARKET_CLOSED"
      : "OFFLINE";

    this.currentPrice = {
      instrument: "XAU/USD",
      price: 0,
      timestamp: new Date().toISOString(),
      source: "oanda",
      sourceSymbol: "XAU_USD",
      isProxy: false,
      status: initialStatus,
      expectedUpdateIntervalMs: pollIntervalMs,
    };
  }

  public isConfigured(): boolean {
    return Boolean(this.token && this.token.trim().length > 0 && this.accountID && this.accountID.trim().length > 0);
  }

  public getRestBaseUrl(): string {
    return this.environment === "live"
      ? "https://api-fxtrade.oanda.com"
      : "https://api-fxpractice.oanda.com";
  }

  public getStreamBaseUrl(): string {
    return this.environment === "live"
      ? "https://stream-fxtrade.oanda.com"
      : "https://stream-fxpractice.oanda.com";
  }

  private getHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.token}`,
      "Accept-Datetime-Format": "RFC3339",
      "Content-Type": "application/json",
      "User-Agent": "TradingApp/1.0",
    };
  }

  onUpdate(callback: (price: MarketPrice) => void): void {
    this.onUpdateCallback = callback;
  }

  getCurrentPrice(): MarketPrice {
    return this.currentPrice;
  }

  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;

    if (!this.isConfigured()) {
      console.warn("[OandaMarketProvider] OANDA credentials are not configured. Provider running in unconfigured state.");
      return;
    }

    this.pollLivePrice();
    this.intervalId = setInterval(() => this.pollLivePrice(), this.pollIntervalMs);
  }

  stop(): void {
    this.isRunning = false;
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  /**
   * Polls live XAU_USD pricing from OANDA v20 REST pricing endpoint.
   */
  public async pollLivePrice(): Promise<MarketPrice | null> {
    if (!this.isConfigured()) {
      return null;
    }

    if (!isGoldMarketOpen()) {
      if (this.currentPrice.status !== "MARKET_CLOSED") {
        this.currentPrice = { ...this.currentPrice, status: "MARKET_CLOSED" };
        if (this.onUpdateCallback) this.onUpdateCallback(this.currentPrice);
      }
      return this.currentPrice;
    }

    try {
      const url = `${this.getRestBaseUrl()}/v3/accounts/${this.accountID}/pricing?instruments=XAU_USD`;
      const res = await fetch(url, {
        headers: this.getHeaders(),
      });

      if (!res.ok) {
        console.error(`[OandaMarketProvider] Live pricing request failed with HTTP ${res.status}`);
        return null;
      }

      const data = await res.json();
      const prices = data?.prices;

      if (Array.isArray(prices) && prices.length > 0) {
        const item = prices[0];
        const bids = item?.bids;
        const asks = item?.asks;

        if (Array.isArray(bids) && bids.length > 0 && Array.isArray(asks) && asks.length > 0) {
          const bidPrice = parseFloat(bids[0].price);
          const askPrice = parseFloat(asks[0].price);

          if (Number.isFinite(bidPrice) && Number.isFinite(askPrice) && bidPrice > 0 && askPrice > 0) {
            const midPrice = parseFloat(((bidPrice + askPrice) / 2).toFixed(2));

            this.currentPrice = {
              instrument: "XAU/USD",
              price: midPrice,
              timestamp: item.time ? new Date(item.time).toISOString() : new Date().toISOString(),
              source: "oanda",
              sourceSymbol: "XAU_USD",
              isProxy: false,
              status: "LIVE",
              expectedUpdateIntervalMs: this.pollIntervalMs,
            };

            if (this.onUpdateCallback) {
              this.onUpdateCallback(this.currentPrice);
            }

            return this.currentPrice;
          }
        }
      }

      return null;
    } catch (err: any) {
      console.error(`[OandaMarketProvider] Error polling live price: ${err?.message || String(err)}`);
      return null;
    }
  }

  /**
   * Fetches historical MID candles for XAU_USD from OANDA v20 REST API.
   * Granularities: M15, M30, H1, H4, D
   */
  public async fetchHistoricalCandles(
    granularity: "M15" | "M30" | "H1" | "H4" | "D" | string = "M15",
    count: number = 500
  ): Promise<Candle[]> {
    if (!this.isConfigured()) {
      return [];
    }

    try {
      const granMap: Record<string, string> = {
        "15": "M15",
        "30": "M30",
        "60": "H1",
        "240": "H4",
        "1440": "D",
        M15: "M15",
        M30: "M30",
        H1: "H1",
        H4: "H4",
        D: "D",
      };

      const oandaGran = granMap[granularity] || "M15";
      const url = `${this.getRestBaseUrl()}/v3/instruments/XAU_USD/candles?granularity=${oandaGran}&count=${count}&price=M`;

      const res = await fetch(url, {
        headers: this.getHeaders(),
      });

      if (!res.ok) {
        console.error(`[OandaMarketProvider] Historical candles request failed with HTTP ${res.status}`);
        return [];
      }

      const data = await res.json();
      if (Array.isArray(data?.candles)) {
        const candles: Candle[] = data.candles
          .filter((c: any) => c && c.mid && c.complete !== false)
          .map((c: any) => ({
            timestamp: new Date(c.time).toISOString(),
            open: parseFloat(c.mid.o),
            high: parseFloat(c.mid.h),
            low: parseFloat(c.mid.l),
            close: parseFloat(c.mid.c),
            volume: typeof c.volume === "number" ? c.volume : parseFloat(c.volume || "0"),
          }));

        // Deduplicate and sort ascending by time
        const timeMap = new Map<string, Candle>();
        candles.forEach((cand) => timeMap.set(cand.timestamp, cand));

        return Array.from(timeMap.values()).sort(
          (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
        );
      }

      return [];
    } catch (err: any) {
      console.error(`[OandaMarketProvider] Error fetching historical candles: ${err?.message || String(err)}`);
      return [];
    }
  }
}
