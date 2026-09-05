import WebSocket from "ws";
import { MarketPrice } from "../types";
import { MarketProvider } from "./MarketProvider";

export class CoinbaseWebSocketProvider implements MarketProvider {
  private currentPrice: MarketPrice;
  private ws: WebSocket | null = null;
  private onUpdateCallback: ((price: MarketPrice) => void) | null = null;
  private isRunning: boolean = false;
  private reconnectTimeoutId: NodeJS.Timeout | null = null;
  private reconnectAttempts: number = 0;
  private readonly maxBackoffMs: number = 30000;
  private readonly baseBackoffMs: number = 1000;
  private readonly wsUrl: string = "wss://advanced-trade-ws.coinbase.com";

  private pingIntervalId: NodeJS.Timeout | null = null;

  constructor() {
    this.currentPrice = {
      instrument: "BTC/USD",
      price: 0,
      timestamp: new Date().toISOString(),
      source: "coinbase",
      sourceSymbol: "BTC-USD",
      isProxy: false,
      status: "OFFLINE",
      expectedUpdateIntervalMs: 5000,
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
    this.reconnectAttempts = 0;
    this.connect();
  }

  stop(): void {
    this.isRunning = false;
    this.clearReconnectTimeout();
    this.stopPingInterval();
    if (this.ws) {
      const socket = this.ws;
      this.ws = null;
      try {
        socket.removeAllListeners();
        socket.on("error", () => {});
        socket.terminate();
      } catch {
        // Ignored
      }
    }
  }

  private clearReconnectTimeout(): void {
    if (this.reconnectTimeoutId) {
      clearTimeout(this.reconnectTimeoutId);
      this.reconnectTimeoutId = null;
    }
  }

  private startPingInterval(): void {
    this.stopPingInterval();
    this.pingIntervalId = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        try {
          this.ws.ping();
        } catch {
          // Ignore ping errors
        }
      }
    }, 15000);
  }

  private stopPingInterval(): void {
    if (this.pingIntervalId) {
      clearInterval(this.pingIntervalId);
      this.pingIntervalId = null;
    }
  }

  private connect(): void {
    if (!this.isRunning) return;

    console.log(`[CoinbaseWebSocketProvider] Connecting to ${this.wsUrl}...`);

    try {
      this.ws = new WebSocket(this.wsUrl);

      this.ws.on("open", () => {
        console.log("[CoinbaseWebSocketProvider] Coinbase WebSocket connected. Sending subscriptions for ticker & ticker_batch...");
        this.startPingInterval();
        this.subscribe();
      });

      this.ws.on("message", (data: WebSocket.Data) => {
        this.handleMessage(data);
      });

      this.ws.on("error", (err: Error) => {
        console.error("[CoinbaseWebSocketProvider] WebSocket error:", err.message);
      });

      this.ws.on("close", (code: number, reason: Buffer) => {
        console.warn(`[CoinbaseWebSocketProvider] Connection closed (code: ${code}, reason: ${reason.toString() || "none"}).`);
        this.stopPingInterval();
        this.ws = null;
        this.scheduleReconnect();
      });
    } catch (err: any) {
      console.error("[CoinbaseWebSocketProvider] Connection failed synchronously:", err?.message || String(err));
      this.scheduleReconnect();
    }
  }

  private subscribe(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const subMsgTicker = {
      type: "subscribe",
      channel: "ticker",
      product_ids: ["BTC-USD"],
    };

    const subMsgTickerBatch = {
      type: "subscribe",
      channel: "ticker_batch",
      product_ids: ["BTC-USD"],
    };

    this.ws.send(JSON.stringify(subMsgTicker));
    this.ws.send(JSON.stringify(subMsgTickerBatch));
    console.log("[CoinbaseWebSocketProvider] Coinbase subscription sent for product_ids=['BTC-USD'] on channels=['ticker', 'ticker_batch']");
  }

  private scheduleReconnect(): void {
    if (!this.isRunning) return;
    this.clearReconnectTimeout();

    const backoff = Math.min(
      this.baseBackoffMs * Math.pow(2, this.reconnectAttempts),
      this.maxBackoffMs
    );
    const jitter = Math.floor(Math.random() * 1000);
    const delay = backoff + jitter;

    this.reconnectAttempts++;
    console.log(`[CoinbaseWebSocketProvider] Scheduling reconnect attempt #${this.reconnectAttempts} in ${delay}ms`);

    this.reconnectTimeoutId = setTimeout(() => {
      this.connect();
    }, delay);
  }

  private handleMessage(data: WebSocket.Data): void {
    try {
      const msgStr = data.toString();
      const msg = JSON.parse(msgStr);

      let price: number | null = null;
      let productId: string | null = null;
      const channelType = msg?.channel || msg?.type || (msg?.events ? msg.events[0]?.type : "unknown");

      if (Array.isArray(msg?.events)) {
        for (const evt of msg.events) {
          if (Array.isArray(evt?.tickers)) {
            for (const t of evt.tickers) {
              if (t?.product_id === "BTC-USD" && t?.price) {
                const parsed = parseFloat(t.price);
                if (typeof parsed === "number" && Number.isFinite(parsed) && parsed > 0) {
                  price = parsed;
                  productId = t.product_id;
                  break;
                }
              }
            }
          }
        }
      }

      if (price === null && (msg?.type === "ticker" || msg?.channel === "ticker" || msg?.channel === "ticker_batch")) {
        const rawProd = msg?.product_id || msg?.product_ids?.[0];
        if (rawProd === "BTC-USD" && msg?.price) {
          const parsed = parseFloat(msg.price);
          if (typeof parsed === "number" && Number.isFinite(parsed) && parsed > 0) {
            price = parsed;
            productId = rawProd;
          }
        }
      }

      if (price === null && msg?.price && (msg?.product_id === "BTC-USD" || msg?.symbol === "BTC-USD")) {
        const parsed = parseFloat(msg.price);
        if (typeof parsed === "number" && Number.isFinite(parsed) && parsed > 0) {
          price = parsed;
          productId = msg.product_id || msg.symbol;
        }
      }

      if (price !== null && (productId === "BTC-USD" || productId === "BTC/USD")) {
        this.reconnectAttempts = 0;
        const nowIso = new Date().toISOString();

        console.log(
          `[CoinbaseWebSocketProvider] Coinbase ticker received | instrument=BTC/USD price=${price} timestamp=${nowIso} channel=${channelType}`
        );

        this.currentPrice = {
          instrument: "BTC/USD",
          price,
          timestamp: nowIso,
          source: "coinbase",
          sourceSymbol: "BTC-USD",
          isProxy: false,
          status: "LIVE",
          expectedUpdateIntervalMs: 5000,
        };

        if (this.onUpdateCallback) {
          this.onUpdateCallback(this.currentPrice);
        }
      }
    } catch (err: any) {
      console.error("[CoinbaseWebSocketProvider] Failed to parse message:", err?.message || String(err));
    }
  }
}
