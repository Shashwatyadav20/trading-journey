import { MarketPrice } from "../types";
import { MarketProvider } from "./MarketProvider";
import { isGoldMarketOpen } from "./XausGoldProvider";
import { Candle } from "../../alerts/pine/PineTypes";

export interface TwelveDataConfig {
  apiKey?: string;
  pollIntervalMs?: number;
}

/**
 * TwelveDataMarketProvider
 * ========================
 * Backend-only market data provider for Twelve Data API (XAU/USD).
 *
 * Responsibilities:
 *   - Historical MID candles for 15min, 30min, 1h, 4h, 1day
 *   - Live XAU/USD pricing (REST polling with rate-limit protection)
 *   - API Key isolation (server-side only, never logged or exposed)
 *   - Market closure handling (Friday 22:00 UTC - Sunday 22:00 UTC)
 *
 * Security & Rate Limiting:
 *   - TWELVE_DATA_API_KEY is NEVER exposed to the frontend or printed in logs/errors.
 *   - Polling interval defaults to 15,000ms (15s) to safely respect plan limits.
 */
export class TwelveDataMarketProvider implements MarketProvider {
  private apiKey: string;
  private currentPrice: MarketPrice;
  private intervalId: NodeJS.Timeout | null = null;
  private onUpdateCallback: ((price: MarketPrice) => void) | null = null;
  private isRunning: boolean = false;
  private isPollingLive: boolean = false;
  private pollIntervalMs: number;

  constructor(config?: TwelveDataConfig) {
    const rawKey = process.env.TWELVE_DATA_API_KEY;
    console.log(
      `[TwelveDataMarketProvider] API key env diagnostic: configured=${Boolean(rawKey && rawKey.trim().length > 0)} length=${rawKey?.length ?? 0}`
    );

    this.apiKey = config && config.apiKey !== undefined
      ? config.apiKey
      : process.env.TWELVE_DATA_API_KEY || "";
    
    const envPollInterval = parseInt(process.env.TWELVE_DATA_POLL_INTERVAL_MS || "15000", 10);
    let desiredInterval = (config && config.pollIntervalMs !== undefined)
      ? config.pollIntervalMs
      : (!isNaN(envPollInterval) ? envPollInterval : 15000);
    
    // Clamp to minimum 15000ms
    if (desiredInterval < 15000) {
      desiredInterval = 15000;
    }
    this.pollIntervalMs = desiredInterval;

    const initialStatus = this.isConfigured()
      ? isGoldMarketOpen()
        ? "LIVE"
        : "MARKET_CLOSED"
      : "OFFLINE";

    this.currentPrice = {
      instrument: "XAU/USD",
      price: 0,
      timestamp: new Date().toISOString(),
      source: "twelvedata",
      sourceSymbol: "XAU/USD",
      isProxy: false,
      status: initialStatus,
      expectedUpdateIntervalMs: this.pollIntervalMs,
    };
  }

  public isConfigured(): boolean {
    return Boolean(this.apiKey && this.apiKey.trim().length > 0);
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
      console.warn("[TwelveDataMarketProvider] TWELVE_DATA_API_KEY is not configured. Provider running in unconfigured state.");
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
   * Polls live XAU/USD pricing from Twelve Data REST price endpoint.
   */
  public async pollLivePrice(): Promise<MarketPrice | null> {
    if (!this.isConfigured()) {
      return null;
    }

    if (this.isPollingLive) {
      return this.currentPrice;
    }

    if (!isGoldMarketOpen()) {
      if (this.currentPrice.status !== "MARKET_CLOSED") {
        this.currentPrice = { ...this.currentPrice, status: "MARKET_CLOSED" };
        if (this.onUpdateCallback) this.onUpdateCallback(this.currentPrice);
      }
      return this.currentPrice;
    }

    this.isPollingLive = true;
    try {
      const url = new URL("https://api.twelvedata.com/price");
      url.searchParams.append("symbol", "XAU/USD");
      url.searchParams.append("apikey", this.apiKey.trim());

      const res = await fetch(url.toString(), {
        headers: { "User-Agent": "TradingApp/1.0" },
      });

      if (!res.ok) {
        console.error(`[TwelveDataMarketProvider] Live pricing request failed with HTTP ${res.status}`);
        return null;
      }

      const data = await res.json();
      if (data && data.price) {
        const parsedPrice = parseFloat(data.price);
        if (Number.isFinite(parsedPrice) && parsedPrice > 0) {
          const midPrice = parseFloat(parsedPrice.toFixed(2));
          this.currentPrice = {
            instrument: "XAU/USD",
            price: midPrice,
            timestamp: new Date().toISOString(),
            source: "twelvedata",
            sourceSymbol: "XAU/USD",
            isProxy: false,
            status: "LIVE",
            expectedUpdateIntervalMs: this.pollIntervalMs,
          };

          if (this.onUpdateCallback) {
            this.onUpdateCallback(this.currentPrice);
          }

          return this.currentPrice;
        }
      } else if (data && data.message) {
        console.error("[TwelveDataMarketProvider] Live pricing API error: Twelve Data reported error response.");
      }

      return null;
    } catch (err: any) {
      console.error("[TwelveDataMarketProvider] Error polling live price: network request failed.");
      return null;
    } finally {
      this.isPollingLive = false;
    }
  }

  /**
   * Fetches historical candles for XAU/USD from Twelve Data REST API.
   * Timeframes: 15min, 30min, 1h, 4h, 1day
   */
  public async fetchHistoricalCandles(
    granularity: "15" | "30" | "60" | "240" | "1440" | "M15" | "M30" | "H1" | "H4" | "D" | string = "M15",
    count: number = 500
  ): Promise<Candle[]> {
    if (!this.isConfigured()) {
      return [];
    }

    try {
      const granMap: Record<string, string> = {
        "15": "15min",
        "30": "30min",
        "60": "1h",
        "240": "4h",
        "1440": "1day",
        M15: "15min",
        M30: "30min",
        H1: "1h",
        H4: "4h",
        D: "1day",
      };

      const interval = granMap[granularity] || "15min";
      const url = new URL("https://api.twelvedata.com/time_series");
      url.searchParams.append("symbol", "XAU/USD");
      url.searchParams.append("interval", interval);
      url.searchParams.append("outputsize", String(count));
      url.searchParams.append("apikey", this.apiKey.trim());

      const res = await fetch(url.toString(), {
        headers: { "User-Agent": "TradingApp/1.0" },
      });

      if (!res.ok) {
        console.error(`[TwelveDataMarketProvider] Historical candles request failed with HTTP ${res.status}`);
        return [];
      }

      const data = await res.json();
      if (data && data.status === "ok" && Array.isArray(data.values)) {
        const candles: Candle[] = data.values
          .filter((c: any) => c && c.datetime && c.open && c.high && c.low && c.close)
          .map((c: any) => ({
            timestamp: new Date(c.datetime.includes("Z") ? c.datetime : `${c.datetime} Z`).toISOString(),
            open: parseFloat(c.open),
            high: parseFloat(c.high),
            low: parseFloat(c.low),
            close: parseFloat(c.close),
            volume: c.volume ? parseFloat(c.volume) : 0,
          }))
          .filter((c: Candle) =>
            Number.isFinite(c.open) &&
            Number.isFinite(c.high) &&
            Number.isFinite(c.low) &&
            Number.isFinite(c.close) &&
            c.open > 0 &&
            c.high > 0 &&
            c.low > 0 &&
            c.close > 0
          );

        // Deduplicate and sort ascending by time
        const timeMap = new Map<string, Candle>();
        candles.forEach((cand) => timeMap.set(cand.timestamp, cand));

        return Array.from(timeMap.values()).sort(
          (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
        );
      } else if (data && data.message) {
        console.error("[TwelveDataMarketProvider] Historical candles API error: Twelve Data reported error response.");
      }

      return [];
    } catch (err: any) {
      console.error("[TwelveDataMarketProvider] Error fetching historical candles: network request failed.");
      return [];
    }
  }
}
