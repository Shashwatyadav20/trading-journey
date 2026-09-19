import { describe, test, expect, beforeEach } from "vitest";
import { Candle } from "../types";
import { niftyMarketProvider } from "../market/NiftyMarketProvider";
import { hedgingStrategyEngine } from "../strategy/HedgingStrategyEngine";
import { paperBrokerAdapter } from "../broker/PaperBrokerAdapter";
import { dailyRiskController } from "../risk/DailyRiskController";
import { paperSessionManager } from "../lifecycle/PaperSessionManager";
import { signalLifecycleEngine } from "../lifecycle/SignalLifecycleEngine";
import { niftyOptionChainService } from "../market/NiftyOptionChainService";
import { paperPersistenceManager } from "../persistence/PaperPersistenceManager";
import { reconciliationEngine } from "../reconciliation/ReconciliationEngine";
import { healthCheckService } from "../health/HealthCheckService";
import { securityValidator } from "../security/SecurityValidator";
import { envValidator } from "../config/EnvValidator";

describe("Phase 13 — Production Hardening & Deployment Validation Test Suite", () => {
  beforeEach(() => {
    dailyRiskController.resetLocks();
    paperBrokerAdapter.resetAccount(500000);
    signalLifecycleEngine.resetState();
    paperPersistenceManager.clearAllData();
    niftyMarketProvider.updateSpotPrice(25000, false, Date.now());
  });

  const createBullishCandles = (basePrice = 25000): Candle[] => {
    const candles: Candle[] = [];
    let price = basePrice;
    for (let i = 0; i < 20; i++) {
      candles.push({
        time: 1700000000 + i * 900,
        open: price,
        high: price + 15,
        low: price - 5,
        close: price + 10,
        volume: 15000,
      });
      price += 8;
    }
    return candles;
  };

  // 1. SAFETY LOCK & ISOLATION
  describe("1. Live Trading Safety & Broker Isolation", () => {
    test("guarantees LIVE_TRADING = false and environment validator rejects live overrides", () => {
      const session = paperSessionManager.getSessionState();
      expect(session.isLiveTradingEnabled).toBe(false);
      expect(session.isPaperMode).toBe(true);

      const envRes = envValidator.validateEnvironment();
      expect(envRes.liveTradingLocked).toBe(true);
      expect(envRes.paperModeActive).toBe(true);
      expect(envRes.configSummary.maxLossPerTrade).toBe(1000);
    });
  });

  // 2. IDEMPOTENCY
  describe("2. Idempotency & Duplicate Order Prevention", () => {
    test("deduplicates repeated paper order execution requests for identical signal", () => {
      const spot = 25150;
      const candles = createBullishCandles(25000);
      const chain = niftyOptionChainService.generateSyntheticChain(spot);
      const signal = hedgingStrategyEngine.generateSignal(spot, candles, candles, chain, 500000, false);

      const pos1 = paperBrokerAdapter.executePaperOrder("test-user-idempotent", signal);
      expect(pos1.status).toBe("OPEN");

      // Repeated execution call returns existing position instead of creating duplicate
      const pos2 = paperBrokerAdapter.executePaperOrder("test-user-idempotent", signal);
      expect(pos2.id).toBe(pos1.id);
      expect(paperBrokerAdapter.getOpenPositions().length).toBe(1);
    });
  });

  // 3. STATE MACHINE STRICTNESS
  describe("3. State Machine Transition Strictness", () => {
    test("accepts valid transitions and explicitly rejects invalid transitions (e.g. CLOSED -> OPEN)", () => {
      expect(signalLifecycleEngine.getCurrentState()).toBe("WAITING_FOR_DATA");

      const t1 = signalLifecycleEngine.transitionTo("DATA_READY", "Data ready");
      expect(t1.success).toBe(true);

      const t2 = signalLifecycleEngine.transitionTo("ANALYZING", "Analyzing");
      expect(t2.success).toBe(true);

      const t3 = signalLifecycleEngine.transitionTo("CLOSED", "Closed");
      expect(t3.success).toBe(true);
      expect(signalLifecycleEngine.getCurrentState()).toBe("CLOSED");

      // Attempt invalid transition from terminal CLOSED state back to OPEN
      const invalidT = signalLifecycleEngine.transitionTo("POSITION_OPEN", "Illegal re-opening");
      expect(invalidT.success).toBe(false);
      expect(invalidT.reason).toContain("INVALID TRANSITION REJECTED");
      expect(signalLifecycleEngine.getCurrentState()).toBe("CLOSED");
    });
  });

  // 4. RESTART RECOVERY & DAILY RISK PERSISTENCE
  describe("4. Restart Recovery & Daily Risk Persistence", () => {
    test("reconstructs open positions and daily risk locks across backend restart simulation", () => {
      const spot = 25150;
      const candles = createBullishCandles(25000);
      const chain = niftyOptionChainService.generateSyntheticChain(spot);

      const signal = hedgingStrategyEngine.generateSignal(spot, candles, candles, chain, 500000, false);
      const position = paperBrokerAdapter.executePaperOrder("restart-user", signal);

      // Record trade and lock daily risk
      dailyRiskController.recordTradeClosed(-5200);
      expect(dailyRiskController.getState().isDailyLossLocked).toBe(true);

      // Get full snapshot from persistence manager
      const savedSnapshot = paperPersistenceManager.getFullSnapshot();
      expect(savedSnapshot.openPositions.length).toBe(1);
      expect(savedSnapshot.dailyRisk?.isDailyLossLocked).toBe(true);

      // Simulate backend process restart (resetting memory instances)
      paperBrokerAdapter.resetAccount();
      dailyRiskController.resetLocks();
      expect(paperBrokerAdapter.getOpenPositions().length).toBe(0);
      expect(dailyRiskController.getState().isDailyLossLocked).toBe(false);

      // Reconstruct state from persistent store
      paperBrokerAdapter.reconstructState(savedSnapshot.openPositions, savedSnapshot.closedPositions);
      dailyRiskController.reconstructState(savedSnapshot.dailyRisk!);

      expect(paperBrokerAdapter.getOpenPositions().length).toBe(1);
      expect(paperBrokerAdapter.getOpenPositions()[0].id).toBe(position.id);
      expect(dailyRiskController.getState().isDailyLossLocked).toBe(true);
    });
  });

  // 5. RECONCILIATION ENGINE
  describe("5. Reconciliation Engine & Discrepancy Auditing", () => {
    test("audits state cleanly when aligned and detects P&L mismatch", () => {
      const report1 = reconciliationEngine.runReconciliation();
      expect(report1.isSafe).toBe(true);
      expect(report1.discrepancies.length).toBe(0);

      // Artificially inject P&L mismatch into DailyRiskController without corresponding closed position
      dailyRiskController.recordTradeClosed(2500);

      const report2 = reconciliationEngine.runReconciliation();
      expect(report2.isSafe).toBe(false);
      expect(report2.discrepancies.some((d) => d.type === "PNL_MISMATCH")).toBe(true);
    });
  });

  // 6. SECURITY & INPUT VALIDATION
  describe("6. Security Validator & Parameter Lock Enforcement", () => {
    test("rejects live-trading bypass attempts and illegal order payloads", () => {
      const bypassAttempt = securityValidator.validateTradeExecutionPayload({
        liveTrading: true,
        mode: "LIVE",
      });
      expect(bypassAttempt.allowed).toBe(false);
      expect(bypassAttempt.errorCode).toBe("SECURITY_LIVE_TRADING_BLOCKED");

      const invalidLotsAttempt = securityValidator.validateTradeExecutionPayload({
        quantityLots: 25,
      });
      expect(invalidLotsAttempt.allowed).toBe(false);

      const validPayload = securityValidator.validateTradeExecutionPayload({
        quantityLots: 2,
        spotPrice: 25000,
      });
      expect(validPayload.allowed).toBe(true);
    });
  });

  // 7. HEALTH CHECK AGGREGATOR
  describe("7. Health Check Aggregator Service", () => {
    test("evaluates subsystem health report and trading readiness", () => {
      const report = healthCheckService.getHealthCheckReport();
      expect(report.overallStatus).toBe("HEALTHY");
      expect(report.isTradingAllowed).toBe(true);
      expect(report.components.length).toBeGreaterThanOrEqual(5);
    });
  });

  // 8. END-TO-END FAILURE RECOVERY
  describe("8. End-to-End Complete Failure Recovery Scenario", () => {
    test("runs full workflow: SIGNAL -> ENTRY -> RESTART -> RESUME -> EXIT -> P&L with exactly 1 trade result", () => {
      const spot = 25150;
      const candles = createBullishCandles(25000);
      const chain = niftyOptionChainService.generateSyntheticChain(spot);

      // Step A: Signal
      const signal = hedgingStrategyEngine.generateSignal(spot, candles, candles, chain, 500000, false);
      expect(signal.status).toBe("READY");

      // Step B: Paper Entry
      const position = paperBrokerAdapter.executePaperOrder("e2e-user", signal);
      expect(position.status).toBe("OPEN");

      // Step C: Mid-trade backend crash & restart
      const savedSnapshot = paperPersistenceManager.getFullSnapshot();
      paperBrokerAdapter.resetAccount();

      // Step D: Recovery
      paperBrokerAdapter.reconstructState(savedSnapshot.openPositions, savedSnapshot.closedPositions);
      expect(paperBrokerAdapter.getOpenPositions().length).toBe(1);

      // Step E: Resume Monitoring & Exit
      const targetChain = niftyOptionChainService.generateSyntheticChain(25150);
      targetChain.contracts.forEach((c) => { c.ltp = 0.5; });
      paperBrokerAdapter.processMarketTick(25150, targetChain, false);

      // Step F: Verification
      const closed = paperBrokerAdapter.getClosedPositions();
      expect(closed.length).toBe(1);
      expect(closed[0].exitReason).toBe("PROFIT_TARGET_CAPTURED");

      const recon = reconciliationEngine.runReconciliation();
      expect(recon.isSafe).toBe(true);
    });
  });
});
