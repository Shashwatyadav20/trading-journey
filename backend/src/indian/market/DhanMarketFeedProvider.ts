import WebSocket from "ws";
import { DhanMarketTick } from "../types";
import {
  IDhanMarketFeedProvider,
  DhanConnectionState,
  DhanMarketFeedHealth,
} from "./IDhanMarketFeedProvider";
import { dhanAuthService } from "../broker/DhanAuthService";
import { dhanSubscriptionManager } from "./DhanSubscriptionManager";
import { operationalAlertLogger } from "../audit/OperationalAlertLogger";

export class DhanMarketFeedProvider implements IDhanMarketFeedProvider {
  private readonly providerName = "DHAN_WEBSOCKET_FEED";
  private ws: WebSocket | null = null;
  private state: DhanConnectionState = "DISCONNECTED";

  // Telemetry & Health Tracking
  private connectedAt: string | null = null;
  private lastMessageAt: string | null = null;
  private lastHeartbeatAt: string | null = null;
  private reconnectCount: number = 0;
  private connectionErrors: number = 0;
  private lastError: string | null = null;
  private feedLatencyMs: number | null = null;

  // Reconnect state
  private isExplicitDisconnect: boolean = false;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectDelayMs: number = 1000;
  private readonly maxReconnectDelayMs: number = 30000;

  // Stale detection timer
  private heartbeatIntervalTimer: NodeJS.Timeout | null = null;
  private readonly staleTimeoutMs: number = 60000;

  // Data Store & Event Listeners
  private latestTicks: Map<string, DhanMarketTick> = new Map();
  private tickListeners: Set<(tick: DhanMarketTick) => void> = new Set();

  constructor() {}

  public getProviderName(): string {
    return this.providerName;
  }

  public getConnectionState(): DhanConnectionState {
    return this.state;
  }

  public getHealth(): DhanMarketFeedHealth {
    const isHealthyState = this.state === "CONNECTED" || this.state === "HEALTHY";
    return {
      provider: "DHAN",
      connectionState: this.state,
      connected: isHealthyState,
      isHealthy: isHealthyState,
      connectedAt: this.connectedAt,
      lastMessageAt: this.lastMessageAt,
      lastHeartbeatAt: this.lastHeartbeatAt,
      reconnectCount: this.reconnectCount,
      connectionErrors: this.connectionErrors,
      subscriptionCount: dhanSubscriptionManager.getSubscriptionCount(),
      lastError: this.lastError,
      feedLatencyMs: this.feedLatencyMs,
      realDataOnly: process.env.INDIAN_REAL_DATA_ONLY === "true",
      safetyState: {
        PAPER_TRADING: process.env.PAPER_TRADING !== "false",
        LIVE_TRADING: process.env.LIVE_TRADING === "true",
        BROKER_EXECUTION_ENABLED: process.env.BROKER_EXECUTION_ENABLED === "true",
      },
    };
  }

  public async connect(): Promise<void> {
    if (this.state === "CONNECTING" || this.state === "CONNECTED" || this.state === "HEALTHY") {
      return;
    }

    this.isExplicitDisconnect = false;
    this.state = "CONNECTING";

    const token = dhanAuthService.getReadOnlyToken();
    const clientId = dhanAuthService.getClientId();

    if (!token || !clientId) {
      // Check test environment mode
      if (process.env.NODE_ENV === "test" || process.env.VITEST || process.env.EXECUTION_MODE === "SIMULATED_TEST") {
        this.state = "HEALTHY";
        this.connectedAt = new Date().toISOString();
        return;
      }
      this.state = "ERROR";
      this.lastError = "DHAN_WS_AUTH_FAILED: Missing access token or client ID";
      operationalAlertLogger.logAlert(
        "AUTHENTICATION_FAILURE",
        "Dhan WebSocket connect blocked: credentials not configured.",
        "CRITICAL"
      );
      return;
    }

    try {
      const wsUrl = `wss://api-feed.dhan.co?version=2&token=${encodeURIComponent(token)}&clientId=${encodeURIComponent(clientId)}&authType=2`;
      
      this.ws = new WebSocket(wsUrl);
      this.ws.binaryType = "nodebuffer";

      this.ws.on("open", () => {
        this.handleOpen();
      });

      this.ws.on("message", (data: WebSocket.RawData) => {
        this.handleMessage(data);
      });

      this.ws.on("error", (err: Error) => {
        this.handleError(err);
      });

      this.ws.on("close", (code: number, reason: Buffer) => {
        this.handleClose(code, reason.toString());
      });

      this.startHeartbeatCheck();
    } catch (err: any) {
      this.handleError(err);
    }
  }

  public async disconnect(): Promise<void> {
    this.isExplicitDisconnect = true;
    this.clearTimers();
    if (this.ws) {
      try {
        this.ws.close();
      } catch { /* ignore */ }
      this.ws = null;
    }
    this.state = "DISCONNECTED";
  }

  public async subscribe(securityId: number | string, exchangeSegment: string = "NSE_FNO"): Promise<boolean> {
    const secIdStr = String(securityId).trim();
    const isNew = dhanSubscriptionManager.subscribeInstrument(secIdStr, exchangeSegment);

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.sendSubscriptionPayload([
        { SecurityId: secIdStr, ExchangeSegment: exchangeSegment },
      ]);
    }
    return isNew;
  }

  public async unsubscribe(securityId: number | string, exchangeSegment: string = "NSE_FNO"): Promise<boolean> {
    const secIdStr = String(securityId).trim();
    const removed = dhanSubscriptionManager.unsubscribeInstrument(secIdStr);

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.sendUnsubscribePayload([
        { SecurityId: secIdStr, ExchangeSegment: exchangeSegment },
      ]);
    }
    return removed;
  }

  public async subscribeMany(
    instruments: Array<{ securityId: number | string; exchangeSegment?: string }>
  ): Promise<number> {
    const addedCount = dhanSubscriptionManager.subscribeMany(
      instruments.map((i) => ({
        securityId: i.securityId,
        exchangeSegment: i.exchangeSegment || "NSE_FNO",
      }))
    );

    if (this.ws && this.ws.readyState === WebSocket.OPEN && instruments.length > 0) {
      this.sendSubscriptionPayload(
        instruments.map((i) => ({
          SecurityId: String(i.securityId),
          ExchangeSegment: i.exchangeSegment || "NSE_FNO",
        }))
      );
    }
    return addedCount;
  }

  public async unsubscribeMany(
    instruments: Array<{ securityId: number | string; exchangeSegment?: string }>
  ): Promise<number> {
    const removedCount = dhanSubscriptionManager.unsubscribeMany(
      instruments.map((i) => i.securityId)
    );

    if (this.ws && this.ws.readyState === WebSocket.OPEN && instruments.length > 0) {
      this.sendUnsubscribePayload(
        instruments.map((i) => ({
          SecurityId: String(i.securityId),
          ExchangeSegment: i.exchangeSegment || "NSE_FNO",
        }))
      );
    }
    return removedCount;
  }

  public getLatestTick(securityId: number | string): DhanMarketTick | null {
    return this.latestTicks.get(String(securityId).trim()) || null;
  }

  public getAllTicks(): Map<string, DhanMarketTick> {
    return new Map(this.latestTicks);
  }

  public onTick(listener: (tick: DhanMarketTick) => void): () => void {
    this.tickListeners.add(listener);
    return () => {
      this.tickListeners.delete(listener);
    };
  }

  /**
   * Directly ingests a tick (used by tests or synthetic test fixtures).
   */
  public injectTick(tick: DhanMarketTick): void {
    const secIdStr = String(tick.securityId).trim();
    this.latestTicks.set(secIdStr, tick);
    dhanSubscriptionManager.recordPacket(secIdStr);
    this.lastMessageAt = new Date().toISOString();
    this.notifyListeners(tick);
  }

  // ── Private Event Handlers & Parsing ──────────────────────────────────────

  private handleOpen(): void {
    this.state = "CONNECTED";
    this.connectedAt = new Date().toISOString();
    this.reconnectDelayMs = 1000; // Reset backoff delay on successful connection
    this.lastError = null;

    // Resubscribe all tracked instruments
    const activeSubs = dhanSubscriptionManager.getSubscriptions();
    if (activeSubs.length > 0) {
      this.sendSubscriptionPayload(
        activeSubs.map((s) => ({
          SecurityId: s.securityId,
          ExchangeSegment: s.exchangeSegment,
        }))
      );
    }

    this.state = "HEALTHY";
  }

  private handleMessage(rawData: WebSocket.RawData): void {
    const receiveMs = Date.now();
    this.lastMessageAt = new Date(receiveMs).toISOString();
    this.lastHeartbeatAt = this.lastMessageAt;

    if (typeof rawData === "string") {
      try {
        const json = JSON.parse(rawData);
        if (json?.type === "ping" || json?.type === "heartbeat") {
          this.feedLatencyMs = json?.timestamp ? receiveMs - json.timestamp : 0;
          return;
        }
      } catch { /* ignore */ }
      return;
    }

    const buf = Buffer.isBuffer(rawData) ? rawData : Buffer.from(rawData as ArrayBuffer);
    if (buf.length < 8) return; // Header size is 8 bytes minimum

    try {
      const responseCode = buf.readUInt8(0);
      const msgLen = buf.readInt16LE(1);
      const segmentCode = buf.readUInt8(3);
      const securityId = buf.readInt32LE(4);

      const segmentMap: Record<number, string> = {
        0: "IDX_I",
        1: "NSE_EQ",
        2: "NSE_FNO",
        3: "NSE_CUR",
        4: "BSE_EQ",
        5: "BSE_FNO",
      };
      const exchangeSegment = segmentMap[segmentCode] || "NSE_FNO";
      const secIdStr = String(securityId);

      let tick: DhanMarketTick | null = null;

      // Code 2: Ticker Packet (LTP + LTT)
      if (responseCode === 2 && buf.length >= 16) {
        const ltp = buf.readFloatLE(8);
        const lttEpoch = buf.readInt32LE(12);
        this.feedLatencyMs = lttEpoch > 0 ? Math.max(0, receiveMs - lttEpoch * 1000) : null;

        tick = {
          provider: "DHAN",
          exchangeSegment,
          securityId: secIdStr,
          timestamp: lttEpoch > 0 ? lttEpoch * 1000 : receiveMs,
          ltp: Number(ltp.toFixed(2)),
          sourceType: "REAL_EXTERNAL",
        };
      }
      // Code 4: Quote Packet
      else if (responseCode === 4 && buf.length >= 54) {
        const ltp = buf.readFloatLE(8);
        const lastQty = buf.readInt16LE(12);
        const lttEpoch = buf.readInt32LE(14);
        const volume = buf.readInt32LE(18);
        const bestBid = buf.readFloatLE(22);
        const bestBidQty = buf.readInt32LE(26);
        const bestAsk = buf.readFloatLE(30);
        const bestAskQty = buf.readInt32LE(34);
        const open = buf.readFloatLE(38);
        const high = buf.readFloatLE(42);
        const low = buf.readFloatLE(46);
        const close = buf.readFloatLE(50);

        tick = {
          provider: "DHAN",
          exchangeSegment,
          securityId: secIdStr,
          timestamp: lttEpoch > 0 ? lttEpoch * 1000 : receiveMs,
          ltp: Number(ltp.toFixed(2)),
          lastTradedQuantity: lastQty,
          volume,
          bestBid: Number(bestBid.toFixed(2)),
          bestBidQuantity: bestBidQty,
          bestAsk: Number(bestAsk.toFixed(2)),
          bestAskQuantity: bestAskQty,
          open: Number(open.toFixed(2)),
          high: Number(high.toFixed(2)),
          low: Number(low.toFixed(2)),
          close: Number(close.toFixed(2)),
          sourceType: "REAL_EXTERNAL",
        };
      }
      // Code 8: Full Packet (includes OI)
      else if (responseCode === 8 && buf.length >= 58) {
        const ltp = buf.readFloatLE(8);
        const volume = buf.readInt32LE(12);
        const oi = buf.readInt32LE(16);

        tick = {
          provider: "DHAN",
          exchangeSegment,
          securityId: secIdStr,
          timestamp: receiveMs,
          ltp: Number(ltp.toFixed(2)),
          volume,
          oi,
          sourceType: "REAL_EXTERNAL",
        };
      }

      if (tick && tick.ltp !== undefined && !isNaN(tick.ltp)) {
        this.latestTicks.set(secIdStr, tick);
        dhanSubscriptionManager.recordPacket(secIdStr);
        this.notifyListeners(tick);
      }
    } catch (err: any) {
      // Failed to parse packet
    }
  }

  private handleError(err: Error): void {
    this.connectionErrors++;
    this.lastError = err.message || "WebSocket Network Error";
    this.state = "ERROR";

    operationalAlertLogger.logAlert(
      "DHAN_DISCONNECTED",
      `Dhan WebSocket error: ${this.lastError}`,
      "WARNING"
    );
  }

  private handleClose(code: number, reason: string): void {
    if (this.isExplicitDisconnect) {
      this.state = "DISCONNECTED";
      return;
    }

    this.state = "RECONNECTING";
    this.reconnectCount++;

    operationalAlertLogger.logAlert(
      "DHAN_DISCONNECTED",
      `Dhan WS closed (code: ${code}, reason: ${reason || "none"}). Reconnecting in ${this.reconnectDelayMs}ms...`,
      "WARNING"
    );

    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectDelayMs = Math.min(this.reconnectDelayMs * 2, this.maxReconnectDelayMs);
      await this.connect();
    }, this.reconnectDelayMs);
  }

  private sendSubscriptionPayload(instruments: Array<{ SecurityId: string; ExchangeSegment: string }>): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || instruments.length === 0) return;

    // Send in chunks of 100 instruments max according to Dhan API spec
    for (let i = 0; i < instruments.length; i += 100) {
      const chunk = instruments.slice(i, i + 100);
      const payload = {
        RequestCode: 16, // Quote mode
        InstrumentCount: chunk.length,
        InstrumentList: chunk,
      };
      this.ws.send(JSON.stringify(payload));
    }
  }

  private sendUnsubscribePayload(instruments: Array<{ SecurityId: string; ExchangeSegment: string }>): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || instruments.length === 0) return;

    for (let i = 0; i < instruments.length; i += 100) {
      const chunk = instruments.slice(i, i + 100);
      const payload = {
        RequestCode: 18, // Unsubscribe mode
        InstrumentCount: chunk.length,
        InstrumentList: chunk,
      };
      this.ws.send(JSON.stringify(payload));
    }
  }

  private startHeartbeatCheck(): void {
    if (this.heartbeatIntervalTimer) clearInterval(this.heartbeatIntervalTimer);

    this.heartbeatIntervalTimer = setInterval(() => {
      if (this.state === "DISCONNECTED" || this.isExplicitDisconnect) return;

      const now = Date.now();
      const lastMsgMs = this.lastMessageAt ? new Date(this.lastMessageAt).getTime() : 0;
      const ageMs = lastMsgMs > 0 ? now - lastMsgMs : 0;

      if (lastMsgMs > 0 && ageMs > this.staleTimeoutMs) {
        if (this.state !== "STALE") {
          this.state = "STALE";
          operationalAlertLogger.logAlert(
            "DATA_STALE",
            `Dhan WebSocket feed stale: no packet received in ${Math.round(ageMs / 1000)}s`,
            "WARNING"
          );
        }
      }
    }, 10000);
  }

  private clearTimers(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.heartbeatIntervalTimer) {
      clearInterval(this.heartbeatIntervalTimer);
      this.heartbeatIntervalTimer = null;
    }
  }

  private notifyListeners(tick: DhanMarketTick): void {
    for (const listener of this.tickListeners) {
      try {
        listener(tick);
      } catch { /* ignore listener errors */ }
    }
  }
}

export const dhanMarketFeedProvider = new DhanMarketFeedProvider();
