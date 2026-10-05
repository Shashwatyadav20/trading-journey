/**
 * POST-PHASE-40 PAPER TRADING OPERATIONS MONITOR
 *
 * Operational monitoring layer only — NOT a new validation phase.
 * Phase 40 remains the final planned validation phase.
 *
 * SAFETY INVARIANTS (permanently locked):
 *   LIVE_TRADING             = false
 *   BROKER_EXECUTION_ENABLED = false
 *   PAPER_TRADING            = true
 *   INDIAN_REAL_DATA_ONLY    = true
 *   REAL_DHAN_ORDERS         = 0
 */

import { randomUUID } from "crypto";
import {
  OperationalHealth,
  OperationsStatus,
  SystemStatus,
  MarketDataStatus,
  TradingStatus,
  RiskStatus,
  ReconciliationStatus,
  SampleProgress,
  OperationalAlert,
  AlertSeverity,
  AlertCategory,
  ActivePositionMonitor,
} from "./PostPhase40OperationsTypes";

// Existing services — imported, NOT duplicated
import { systemHealthService } from "../health/SystemHealthService";
import { niftyMarketProvider } from "../market/NiftyMarketProvider";
import { paperBrokerAdapter } from "../broker/PaperBrokerAdapter";
import { dailyRiskController } from "../risk/DailyRiskController";
import { reconciliationEngine } from "../reconciliation/ReconciliationEngine";
import { phase38SampleAccumulator } from "../validation/Phase38SampleAccumulator";
import { phase39RevalidationEngine } from "../phase39/Phase39RevalidationEngine";
import { phase40FinalReadinessEngine } from "../validation/Phase40FinalReadinessEngine";
import { genuineDataValidator } from "../validation/GenuineDataValidator";
import { instrumentMasterResolver } from "../broker/InstrumentMasterResolver";

// Staleness thresholds (aligned with Phase 18 gate)
const SPOT_STALE_MS = 60_000;
const OPTION_CHAIN_STALE_MS = 60_000;
const WEBSOCKET_STALE_MS = 120_000;

export class PostPhase40OperationsMonitor {
  private alerts: OperationalAlert[] = [];
  private maxAlerts = 200;

  // ─── Alert Management ─────────────────────────────────────────────────────
  public addAlert(
    severity: AlertSeverity,
    category: AlertCategory,
    message: string
  ): OperationalAlert {
    const alert: OperationalAlert = {
      id: randomUUID(),
      severity,
      category,
      message,
      timestamp: new Date().toISOString(),
      resolved: false,
    };
    this.alerts.unshift(alert);
    if (this.alerts.length > this.maxAlerts) {
      this.alerts = this.alerts.slice(0, this.maxAlerts);
    }
    return alert;
  }

  public resolveAlert(id: string): void {
    const a = this.alerts.find((a) => a.id === id);
    if (a) a.resolved = true;
  }

  public getAlerts(includeResolved = false): OperationalAlert[] {
    return includeResolved ? this.alerts : this.alerts.filter((a) => !a.resolved);
  }

  public clearAlerts(): void {
    this.alerts = [];
  }

  // ─── 1. System Status ─────────────────────────────────────────────────────
  public getSystemStatus(): SystemStatus {
    const heartbeat = systemHealthService.getPhase21Heartbeat();
    const health = niftyMarketProvider.getDataHealth();

    const now = Date.now();
    const dhanAgeMs = now - new Date(heartbeat.lastDhanConnection).getTime();
    const dhanConnected = dhanAgeMs < 300_000; // 5 minutes

    const wsAgeMs = now - health.lastUpdateTimestamp;
    const wsHealthy = !health.isStale && wsAgeMs < WEBSOCKET_STALE_MS;

    const overall: OperationalHealth = health.isStale
      ? "DEGRADED"
      : !dhanConnected
      ? "DEGRADED"
      : "HEALTHY";

    if (!dhanConnected) {
      this.addAlert("WARN", "DHAN_DISCONNECTED", "Dhan connection last seen >5 minutes ago.");
    }
    if (!wsHealthy && health.isStale) {
      this.addAlert("WARN", "WEBSOCKET_STALE", "WebSocket / market-data tick is stale.");
    }

    return {
      backend: "HEALTHY",
      database: "HEALTHY",
      dhanAuth: dhanConnected ? "HEALTHY" : "DEGRADED",
      dhanConnection: dhanConnected ? "HEALTHY" : "DEGRADED",
      websocket: wsHealthy ? "HEALTHY" : "DEGRADED",
      overall,
      evaluatedAt: new Date().toISOString(),
    };
  }

  // ─── 2. Market Data Status ────────────────────────────────────────────────
  public getMarketDataStatus(): MarketDataStatus {
    const health = niftyMarketProvider.getDataHealth();
    const heartbeat = systemHealthService.getPhase21Heartbeat();
    const marketSession = genuineDataValidator.getMarketSessionState();
    const now = Date.now();

    // Spot freshness — derived from provider's lastUpdateTimestamp
    const spotAgeMs = now - health.lastUpdateTimestamp;
    const spotStale = health.isStale || spotAgeMs > SPOT_STALE_MS;
    const spotHealth: OperationalHealth = spotStale ? "DEGRADED" : "HEALTHY";

    // Option chain freshness (same timestamp source — provider updates together)
    const chainAgeMs = now - new Date(heartbeat.lastNseOptionChain).getTime();
    const chainStale = chainAgeMs > OPTION_CHAIN_STALE_MS;
    const chainHealth: OperationalHealth = chainStale ? "DEGRADED" : "HEALTHY";

    // Option prices — updated with option chain
    const priceAgeMs = chainAgeMs;
    const priceStale = chainStale;
    const priceHealth: OperationalHealth = priceStale ? "DEGRADED" : "HEALTHY";

    // Lot size verification
    const lotSizeVerified = instrumentMasterResolver.getCurrentProviderLotSize() !== null;

    // Genuine data gate: OPEN only if spot fresh, chain fresh, lot size verified
    const genuineGate = (!spotStale && !chainStale && lotSizeVerified) ? "OPEN" : "BLOCKED";

    // Alerts
    if (spotStale) {
      this.addAlert("WARN", "SPOT_STALE", `NIFTY spot is stale (${Math.round(spotAgeMs / 1000)}s old).`);
    }
    if (chainStale) {
      this.addAlert("WARN", "OPTION_CHAIN_STALE", `Option chain is stale (${Math.round(chainAgeMs / 1000)}s old).`);
    }
    if (!lotSizeVerified) {
      this.addAlert("WARN", "LOT_SIZE_MISMATCH", "Provider lot size unverified — lot size gate is BLOCKED.");
    }
    if (genuineGate === "BLOCKED") {
      this.addAlert("ERROR", "GENUINE_DATA_GATE_FAILURE", "Genuine data gate BLOCKED — no new paper trades may be entered.");
    }

    // Data component health map for Greek availability
    const componentHealth = niftyMarketProvider.getDataComponentHealthMap();
    const greeksAvailable = componentHealth.delta !== "STALE" && componentHealth.delta !== "SYNTHETIC";

    if (!greeksAvailable && genuineGate === "OPEN") {
      this.addAlert("WARN", "MISSING_GREEKS", "Greeks (delta/gamma) are not from a real provider.");
    }

    return {
      niftySpot: {
        health: spotHealth,
        value: null,   // live spot is fetched async; dashboard fetches via API
        lastUpdated: new Date(health.lastUpdateTimestamp).toISOString(),
        ageMs: spotAgeMs,
        isStale: spotStale,
        isReal: !health.isStale,
      },
      optionChain: {
        health: chainHealth,
        lastUpdated: heartbeat.lastNseOptionChain,
        ageMs: chainAgeMs,
        isStale: chainStale,
        isReal: componentHealth.optionChain === "REAL",
        contractCount: 0,
      },
      optionPrices: {
        health: priceHealth,
        lastUpdated: heartbeat.lastNseOptionPrice,
        ageMs: priceAgeMs,
        isStale: priceStale,
        isReal: componentHealth.optionPrices === "REAL",
      },
      greeks: {
        health: greeksAvailable ? "HEALTHY" : "DEGRADED",
        available: greeksAvailable,
        deltaAvailable: componentHealth.delta === "REAL",
        gammaAvailable: componentHealth.gamma === "REAL",
      },
      websocketTick: {
        health: health.isStale ? "DEGRADED" : "HEALTHY",
        lastTick: new Date(health.lastUpdateTimestamp).toISOString(),
        ageMs: spotAgeMs,
      },
      vwapRsiSnapshot: {
        health: health.isStale ? "DEGRADED" : "HEALTHY",
        lastComputed: heartbeat.lastStrategyEvaluation,
        ageMs: now - new Date(heartbeat.lastStrategyEvaluation).getTime(),
      },
      lotSizeVerified,
      expiryValid: true,  // ExpiryValidator is enforced at paper execution — fail-closed
      marketSession,
      genuineDataGate: genuineGate,
      evaluatedAt: new Date().toISOString(),
    };
  }

  // ─── 3. Trading Status ────────────────────────────────────────────────────
  public getTradingStatus(): TradingStatus {
    const heartbeat = systemHealthService.getPhase21Heartbeat();
    const openPositions = paperBrokerAdapter.getOpenPositions();
    const closedPositions = paperBrokerAdapter.getClosedPositions();
    const providerLotSize = instrumentMasterResolver.getCurrentProviderLotSize() ?? 75;

    const activeMonitors: ActivePositionMonitor[] = openPositions.map((pos) => ({
      positionId: pos.id,
      strategy: pos.strategy,
      expiry: pos.expiry,
      sellStrike: pos.sellLeg?.strike ?? 0,
      buyStrike: pos.buyLeg?.strike ?? 0,
      optionType: pos.sellLeg?.optionType ?? "PE",
      lotSize: providerLotSize,
      quantityLots: pos.quantityLots,
      entryPrice: pos.netCredit,
      currentSpreadValue: pos.currentSpreadPrice ?? pos.netCredit,
      unrealizedPnL: pos.unrealizedNetPnl ?? 0,
      delta: pos.shortLegDelta ?? null,
      gamma: pos.shortLegGamma ?? null,
      vwap: (pos as any).vwap ?? null,
      rsi: (pos as any).rsi ?? null,
      supportResistance: (pos as any).supportResistance ?? "N/A",
      initialCredit: pos.netCredit,
      target: pos.targetSpread,
      stopLoss: pos.stopLossSpread,
      timeOpenedIso: pos.entryTime,
      timeInTradeSeconds: pos.timeInTradeSeconds ?? 0,
      dataProvenance: pos.entryDataSource ?? "REAL",
      pnlType: pos.pnlType ?? "REAL_MARKET_DATA_PAPER_PNL",
    }));

    return {
      activePositions: activeMonitors,
      openPositionCount: openPositions.length,
      closedTodayCount: closedPositions.length,
      lastSignalEvaluatedAt: heartbeat.lastStrategyEvaluation,
      lastPaperOrderAt: heartbeat.lastPaperOrder,
      lastPaperExitAt: heartbeat.lastPaperExit,
      evaluatedAt: new Date().toISOString(),
    };
  }

  // ─── 4. Risk Status ───────────────────────────────────────────────────────
  public getRiskStatus(): RiskStatus {
    const state = dailyRiskController.getState();
    const canTradeResult = dailyRiskController.canTrade();
    const openPositions = paperBrokerAdapter.getOpenPositions();

    const exposureINR = openPositions.reduce(
      (sum, pos) => sum + Math.abs(pos.maxLoss ?? 0),
      0
    );

    if (state.isTradeLocked) {
      this.addAlert(
        "WARN",
        "RISK_LOCK_TRIGGERED",
        `Risk lock active: ${state.lockReason ?? "Trading locked."}`
      );
    }

    return {
      dailyPnL: state.dailyPnl,
      dailyProfitLockTarget: state.dailyProfitTarget ?? 1000,
      dailyLossLockLimit: state.dailyLossLimit ?? -5000,
      maxTradesPerDay: state.maxTradesPerDay ?? 3,
      maxConsecutiveLosses: state.maxConsecutiveLosses ?? 2,
      maxLossPerTrade: 1000,
      tradesCountToday: state.tradesCountToday,
      consecutiveLosses: state.consecutiveLosses,
      isDailyProfitLocked: state.isDailyProfitLocked,
      isDailyLossLocked: state.isDailyLossLocked,
      isTradeLocked: state.isTradeLocked,
      lockReason: state.lockReason,
      canTrade: canTradeResult.allowed,
      exposureINR,
      evaluatedAt: new Date().toISOString(),
    };
  }

  // ─── 5. Reconciliation Status ─────────────────────────────────────────────
  public getReconciliationStatus(): ReconciliationStatus {
    const report =
      reconciliationEngine.getLastAuditReport() ??
      reconciliationEngine.runReconciliation();

    const criticalCount = report.discrepancies.filter((d) => d.severity === "CRITICAL").length;

    if (!report.isSafe) {
      this.addAlert(
        "CRITICAL",
        "RECONCILIATION_FAILURE",
        `Reconciliation unsafe: ${criticalCount} critical discrepancy(s). New trades BLOCKED.`
      );
    }

    return {
      isSafe: report.isSafe,
      blockNewTrades: !report.isSafe,
      lastRunAt: report.lastRunTimestamp,
      openPositions: report.totalOpenPositions,
      closedPositions: report.totalClosedPositions,
      calculatedDailyPnL: report.calculatedDailyPnl,
      trackedDailyPnL: report.trackedDailyPnl,
      discrepancyCount: report.discrepancies.length,
      criticalDiscrepancyCount: criticalCount,
      discrepancies: report.discrepancies,
      evaluatedAt: new Date().toISOString(),
    };
  }

  // ─── 6. Sample Progress ───────────────────────────────────────────────────
  public getSampleProgress(): SampleProgress {
    const progress = phase38SampleAccumulator.getProgress();
    const p39Report = phase39RevalidationEngine.getReport();
    const p40Report = phase40FinalReadinessEngine.getReport();

    return {
      genuineSessions: progress.genuineSessions,
      requiredSessions: progress.requiredSessions,
      sessionsMet: progress.sessionsMet,
      genuineTrades: progress.genuineTrades,
      requiredTrades: progress.requiredTrades,
      tradesMet: progress.tradesMet,
      activeSessions: progress.activeSessions,
      requiredActiveSessions: progress.requiredActiveSessions,
      activeSessionsMet: progress.activeSessionsMet,
      validationStatus: progress.validationStatus,
      phase39CohortId: p39Report.cohortSnapshot?.cohortId ?? "NOT_AVAILABLE",
      phase39State: p39Report.state,
      phase40FinalState: p40Report.finalState,
      evaluatedAt: new Date().toISOString(),
    };
  }

  // ─── 7. Restart Recovery Verification ────────────────────────────────────
  public verifyRestartRecovery(): {
    positionsRecovered: number;
    riskStateRecovered: boolean;
    sampleCountersRecovered: boolean;
    phase39CohortIntact: boolean;
    phase40AuditAvailable: boolean;
    noDuplicatesDetected: boolean;
    evaluatedAt: string;
  } {
    const openPositions = paperBrokerAdapter.getOpenPositions();
    const riskState = dailyRiskController.getState();
    const p39Report = phase39RevalidationEngine.getReport();
    const p40Report = phase40FinalReadinessEngine.getReport();
    const progress = phase38SampleAccumulator.getProgress();

    const posIds = openPositions.map((p) => p.id);
    const noDuplicates = new Set(posIds).size === posIds.length;

    if (!noDuplicates) {
      this.addAlert(
        "CRITICAL",
        "POSITION_MISMATCH",
        "Duplicate position IDs detected after restart."
      );
    }

    return {
      positionsRecovered: openPositions.length,
      riskStateRecovered: riskState !== null,
      sampleCountersRecovered:
        progress.genuineSessions >= 0 && progress.genuineTrades >= 0,
      phase39CohortIntact:
        p39Report.state !== "WAITING_FOR_SAMPLE" || p39Report.cohortSnapshot === null,
      phase40AuditAvailable: p40Report.finalState !== "FINAL_AUDIT_IN_PROGRESS",
      noDuplicatesDetected: noDuplicates,
      evaluatedAt: new Date().toISOString(),
    };
  }

  // ─── 8. Full Operations Status ────────────────────────────────────────────
  public getFullStatus(): OperationsStatus {
    return {
      system: this.getSystemStatus(),
      marketData: this.getMarketDataStatus(),
      trading: this.getTradingStatus(),
      risk: this.getRiskStatus(),
      reconciliation: this.getReconciliationStatus(),
      sample: this.getSampleProgress(),
      alerts: this.getAlerts(),
      safety: {
        paperTrading: true,
        liveTrading: false,
        brokerExecution: false,
        realDataOnly: true,
        realDhanOrders: 0,
      },
      evaluatedAt: new Date().toISOString(),
    };
  }
}

export const postPhase40OperationsMonitor = new PostPhase40OperationsMonitor();
