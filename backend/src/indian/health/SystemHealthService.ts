import { SystemHealthMetrics, SystemHealthState } from "../types";
import { niftyMarketProvider } from "../market/NiftyMarketProvider";

export class SystemHealthService {
  private lastSpotUpdateIso: string = new Date().toISOString();
  private lastOptionChainUpdateIso: string = new Date().toISOString();
  private lastOptionPriceUpdateIso: string = new Date().toISOString();
  private lastSignalEvalIso: string = new Date().toISOString();
  private lastTradeEventIso: string = new Date().toISOString();
  private lastProviderRequestIso: string = new Date().toISOString();
  private lastPaperOrderIso: string = new Date().toISOString();
  private lastPaperExitIso: string = new Date().toISOString();
  private lastReconciliationIso: string = new Date().toISOString();
  private lastDhanConnectionIso: string = new Date().toISOString();
  private lastDhanQuoteIso: string = new Date().toISOString();
  private lastDhanPositionSyncIso: string = new Date().toISOString();
  private lastDhanOrderSyncIso: string = new Date().toISOString();

  public recordSpotUpdate() {
    this.lastSpotUpdateIso = new Date().toISOString();
  }

  public recordOptionChainUpdate() {
    this.lastOptionChainUpdateIso = new Date().toISOString();
    this.lastOptionPriceUpdateIso = this.lastOptionChainUpdateIso;
  }

  public recordSignalEvaluation() {
    this.lastSignalEvalIso = new Date().toISOString();
  }

  public recordTradeEvent() {
    this.lastTradeEventIso = new Date().toISOString();
  }

  public recordProviderRequest() {
    this.lastProviderRequestIso = new Date().toISOString();
  }

  public recordPaperOrder() {
    this.lastPaperOrderIso = new Date().toISOString();
  }

  public recordPaperExit() {
    this.lastPaperExitIso = new Date().toISOString();
  }

  public recordReconciliation() {
    this.lastReconciliationIso = new Date().toISOString();
  }

  public recordDhanSync(type: "connection" | "quote" | "position" | "order" = "connection") {
    const now = new Date().toISOString();
    if (type === "connection") this.lastDhanConnectionIso = now;
    if (type === "quote") this.lastDhanQuoteIso = now;
    if (type === "position") this.lastDhanPositionSyncIso = now;
    if (type === "order") this.lastDhanOrderSyncIso = now;
  }

  public recordDhanConnection() {
    this.lastDhanConnectionIso = new Date().toISOString();
  }

  public recordDhanQuote() {
    this.lastDhanQuoteIso = new Date().toISOString();
  }

  public recordDhanPositionSync() {
    this.lastDhanPositionSyncIso = new Date().toISOString();
  }

  public recordDhanOrderSync() {
    this.lastDhanOrderSyncIso = new Date().toISOString();
  }

  public getPhase21Heartbeat() {
    const health = niftyMarketProvider.getDataHealth();
    const nowMs = Date.now();
    const latencyMs = Math.max(5, Math.floor(nowMs - health.lastUpdateTimestamp));

    return {
      lastNseSpot: this.lastSpotUpdateIso,
      lastNseOptionChain: this.lastOptionChainUpdateIso,
      lastNseOptionPrice: this.lastOptionPriceUpdateIso,
      lastDhanConnection: this.lastDhanConnectionIso,
      lastDhanQuote: this.lastDhanQuoteIso,
      lastDhanPositionSync: this.lastDhanPositionSyncIso,
      lastDhanOrderSync: this.lastDhanOrderSyncIso,
      lastStrategyEvaluation: this.lastSignalEvalIso,
      lastPaperOrder: this.lastPaperOrderIso,
      lastPaperExit: this.lastPaperExitIso,
      lastReconciliation: this.lastReconciliationIso,
      latencyMs,
      overallState: health.isStale ? "DEGRADED" : "HEALTHY",
      evaluatedAt: new Date().toISOString(),
    };
  }

  public getPhase18Heartbeat() {
    const health = niftyMarketProvider.getDataHealth();
    const nowMs = Date.now();
    const latencyMs = Math.max(5, Math.floor(nowMs - health.lastUpdateTimestamp));

    return {
      lastSpotUpdate: this.lastSpotUpdateIso,
      lastOptionChainUpdate: this.lastOptionChainUpdateIso,
      lastOptionPriceUpdate: this.lastOptionPriceUpdateIso,
      lastSignalEvaluation: this.lastSignalEvalIso,
      lastProviderRequest: this.lastProviderRequestIso,
      lastPaperOrder: this.lastPaperOrderIso,
      lastReconciliation: this.lastReconciliationIso,
      latencyMs,
      overallState: health.isStale ? "DEGRADED" : "HEALTHY",
      evaluatedAt: new Date().toISOString(),
    };
  }

  /**
   * Computes current System Health Status.
   */
  public getSystemHealth(): SystemHealthMetrics {
    const health = niftyMarketProvider.getDataHealth();
    const nowMs = Date.now();
    const lastUpdateMs = health.lastUpdateTimestamp;
    const latencyMs = Math.max(5, Math.floor(nowMs - lastUpdateMs));

    let overallState: SystemHealthState = "HEALTHY";
    let wsStatus: SystemHealthState = "HEALTHY";
    let apiStatus: SystemHealthState = "HEALTHY";
    let dbStatus: SystemHealthState = "HEALTHY";

    if (health.isStale) {
      overallState = "STALE";
      wsStatus = "STALE";
      apiStatus = "DEGRADED";
    } else if (latencyMs > 5000) {
      overallState = "DEGRADED";
      wsStatus = "DEGRADED";
    }

    return {
      marketDataLatencyMs: latencyMs,
      lastSpotUpdate: this.lastSpotUpdateIso,
      lastOptionChainUpdate: this.lastOptionChainUpdateIso,
      lastSignalEvaluation: this.lastSignalEvalIso,
      lastTradeEvent: this.lastTradeEventIso,
      webSocketStatus: wsStatus,
      apiStatus,
      databaseStatus: dbStatus,
      overallHealth: overallState,
    };
  }
}

export const systemHealthService = new SystemHealthService();

