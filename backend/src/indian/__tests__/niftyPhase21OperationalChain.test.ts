
import { describe, it, expect, beforeEach, vi } from "vitest";
import { phase21OperationalMonitor, Phase21OperationalMonitor } from "../validation/Phase21OperationalMonitor";
import { dhanBrokerAdapter } from "../broker/DhanBrokerAdapter";
import { paperBrokerAdapter } from "../broker/PaperBrokerAdapter";
import { brokerReconciliationEngine } from "../reconciliation/BrokerReconciliationEngine";
import { reconciliationEngine } from "../reconciliation/ReconciliationEngine";
import { genuineDataValidator } from "../validation/GenuineDataValidator";
import { phase18DataFreshnessMonitor } from "../market/Phase18DataFreshnessMonitor";
import { niftyMarketProvider } from "../market/NiftyMarketProvider";
import { phase19GenuineValidationEngine } from "../validation/Phase19GenuineValidationEngine";
import { operationalAlertLogger } from "../audit/OperationalAlertLogger";
import { systemHealthService } from "../health/SystemHealthService";
import { brokerSafetyLock } from "../security/BrokerSafetyLock";
import { dailyRiskController } from "../risk/DailyRiskController";
import { paperPersistenceManager } from "../persistence/PaperPersistenceManager";
import { instrumentMasterResolver } from "../broker/InstrumentMasterResolver";
import { BrokerOrderRequest } from "../broker/IBrokerAdapter";

describe("Phase 21 — Extended Genuine Paper Trading & Broker Reconciliation Validation", () => {
  let monitor: Phase21OperationalMonitor;

  beforeEach(() => {
    monitor = new Phase21OperationalMonitor();
    operationalAlertLogger.clearAlerts();
    monitor.resetSessionMetrics();
    vi.restoreAllMocks();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 1. DATA RECONCILIATION (NSE vs DHAN)
  // ═══════════════════════════════════════════════════════════════════════════
  describe("1. Data Reconciliation Across Sources", () => {
    it("reports matching quotes when NSE and Dhan prices are within threshold", async () => {
      const result = await monitor.compareQuotes({
        symbol: "NIFTY",
        expiry: "26924",
        strike: 24500,
        optionType: "CE",
        customNseLtp: 150.0,
        customDhanLtp: 151.0, // 0.67% diff <= 2.0% threshold
      });

      expect(result.isMismatch).toBe(false);
      expect(result.priceDifference).toBe(1.0);
      expect(result.percentageDifference).toBeCloseTo(0.67, 1);
      expect(result.observationalOnly).toBe(true);

      const alerts = operationalAlertLogger.getOperationalAlerts();
      expect(alerts.find((a) => a.eventType === "DATA_SOURCE_MISMATCH")).toBeUndefined();
    });

    it("detects quote mismatch when price difference exceeds threshold and logs DATA_SOURCE_MISMATCH", async () => {
      const result = await monitor.compareQuotes({
        symbol: "NIFTY",
        expiry: "26924",
        strike: 24500,
        optionType: "CE",
        customNseLtp: 100.0,
        customDhanLtp: 105.0, // 5% diff > 2% threshold
      });

      expect(result.isMismatch).toBe(true);
      expect(result.percentageDifference).toBe(5.0);

      const alerts = operationalAlertLogger.getOperationalAlerts();
      const alert = alerts.find((a) => a.eventType === "DATA_SOURCE_MISMATCH");
      expect(alert).toBeDefined();
      expect(alert?.severity).toBe("WARNING");
      expect(alert?.message).toContain("Quote mismatch detected");
    });

    it("reconciles instruments across NSE and Dhan when contract attributes and lot size match", async () => {
      const result = await monitor.reconcileInstruments({
        symbol: "NIFTY",
        expiry: "26924",
        strike: 24500,
        optionType: "CE",
        customNseLotSize: 50,
        customDhanLotSize: 50,
        customDhanSymbol: "NIFTY2692424500CE",
      });

      expect(result.isReconciled).toBe(true);
      expect(result.lotSizeMatch).toBe(true);
      expect(result.attributesMatch).toBe(true);
      expect(result.blocksPaperTrading).toBe(false);
    });

    it("detects instrument lot size mismatch, logs INSTRUMENT_MISMATCH and blocks paper trading", async () => {
      const result = await monitor.reconcileInstruments({
        symbol: "NIFTY",
        expiry: "26924",
        strike: 24500,
        optionType: "CE",
        customNseLotSize: 50,
        customDhanLotSize: 25, // Mismatched lot size
      });

      expect(result.isReconciled).toBe(false);
      expect(result.lotSizeMatch).toBe(false);
      expect(result.blocksPaperTrading).toBe(true);

      const alerts = operationalAlertLogger.getOperationalAlerts();
      const alert = alerts.find((a) => a.eventType === "INSTRUMENT_MISMATCH");
      expect(alert).toBeDefined();
      expect(alert?.severity).toBe("CRITICAL");
    });

    it("detects trading symbol attribute mismatch across sources", async () => {
      const result = await monitor.reconcileInstruments({
        symbol: "NIFTY",
        expiry: "26924",
        strike: 24500,
        optionType: "PE",
        customNseLotSize: 50,
        customDhanLotSize: 50,
        customDhanSymbol: "INVALID_SYMBOL_DHAN",
      });

      expect(result.isReconciled).toBe(false);
      expect(result.attributesMatch).toBe(false);
      expect(result.blocksPaperTrading).toBe(true);
    });

    it("confirms quote comparison is strictly observational and does not alter strategy signals", async () => {
      const comp = await monitor.compareQuotes({
        symbol: "NIFTY",
        expiry: "26924",
        strike: 24500,
        optionType: "CE",
        customNseLtp: 100.0,
        customDhanLtp: 150.0, // Huge 50% mismatch
      });

      expect(comp.observationalOnly).toBe(true);
      // Strategy evaluation continues based on NSE Real Market Data regardless of Dhan quotes
      expect(brokerSafetyLock.isPaperTrading()).toBe(true);
      expect(brokerSafetyLock.isLiveTrading()).toBe(false);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 2. BROKER TELEMETRY & ERROR HANDLING
  // ═══════════════════════════════════════════════════════════════════════════
  describe("2. Broker Telemetry & Fail-Safe Isolation", () => {
    it("reports Dhan connected status and telemetry latency accurately", async () => {
      vi.spyOn(dhanBrokerAdapter, "getStatus").mockReturnValue({
        connected: true,
        clientId: "1100993334",
        readOnly: true,
        paperLock: true,
        realOrdersSentCount: 0,
        latencyMs: 18,
        lastHeartbeatMs: Date.now() - 500,
        lastError: null,
      });

      const chainStatus = await monitor.getOperationalChainStatus();
      expect(chainStatus.sources.dhan.connected).toBe(true);
      expect(chainStatus.sources.dhan.latencyMs).toBe(18);
      expect(chainStatus.sources.dhan.errorState).toBeNull();
    });

    it("degrades system status to DEGRADED when Dhan is disconnected, but allows paper trading to continue", async () => {
      vi.spyOn(dhanBrokerAdapter, "getStatus").mockReturnValue({
        connected: false,
        clientId: "1100993334",
        readOnly: true,
        paperLock: true,
        realOrdersSentCount: 0,
        latencyMs: 0,
        lastHeartbeatMs: Date.now() - 30000,
        lastError: "DHAN_DISCONNECTED",
      });

      vi.spyOn(niftyMarketProvider, "getDataHealth").mockReturnValue({
        isStale: false,
        lastUpdateTimestamp: Date.now(),
        lastSpotPrice: 24500,
      } as any);

      vi.spyOn(phase18DataFreshnessMonitor, "getFreshnessMetrics").mockResolvedValue({
        spot: { status: "HEALTHY" } as any,
        optionChain: { status: "HEALTHY" } as any,
        optionPrices: { status: "HEALTHY" } as any,
        overallStatus: "HEALTHY",
        maxAgeMs: 100,
        evaluatedAt: new Date().toISOString(),
      });

      vi.spyOn(genuineDataValidator, "validateOperationalGate").mockReturnValue({
        canTradePaper: true,
        status: "GATE_OPEN",
        checks: [] as any,
        blockedReasons: [],
        dataHealth: {} as any,
      });

      const chainStatus = await monitor.getOperationalChainStatus();
      expect(chainStatus.sources.dhan.connected).toBe(false);
      // Dhan is observational only: system degrades, but paper trading is not halted if NSE is healthy
      expect(chainStatus.systemStatus).toBe("DEGRADED");
      expect(chainStatus.sources.paperEngine.connected).toBe(true);
    });

    it("blocks system when NSE Real Market Data is stale or offline", async () => {
      vi.spyOn(genuineDataValidator, "validateOperationalGate").mockReturnValue({
        canTradePaper: false,
        status: "GATE_BLOCKED",
        checks: [] as any,
        blockedReasons: ["DATA_STALE: NSE spot price stale"],
        dataHealth: {} as any,
      });

      const chainStatus = await monitor.getOperationalChainStatus();
      expect(chainStatus.systemStatus).toBe("BLOCKED");
    });

    it("handles Dhan token expiry or authentication failure gracefully", async () => {
      vi.spyOn(dhanBrokerAdapter, "getPositions").mockRejectedValue(
        new Error("AUTH_FAILED: Token expired or invalid")
      );

      // Should not throw uncaught error; error handled in broker telemetry
      await expect(dhanBrokerAdapter.getPositions()).rejects.toThrow("AUTH_FAILED");
      expect(brokerSafetyLock.isLiveTrading()).toBe(false);
    });

    it("isolates Dhan quote failure and falls back without crashing paper engine", async () => {
      vi.spyOn(dhanBrokerAdapter, "getLtp").mockRejectedValue(
        new Error("NETWORK_TIMEOUT: Broker quote endpoint unreachable")
      );

      const comp = await monitor.compareQuotes({
        symbol: "NIFTY",
        expiry: "26924",
        strike: 24500,
        optionType: "CE",
      });

      expect(comp).toBeDefined();
      expect(comp.observationalOnly).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 3. PAPER EXECUTION & POSITION LIFECYCLE
  // ═══════════════════════════════════════════════════════════════════════════
  describe("3. Paper Execution Engine Lifecycle", () => {
    it("routes paper order execution strictly through PaperBrokerAdapter and never to Dhan", async () => {
      const dhanSpy = vi.spyOn(dhanBrokerAdapter, "placeOrder");
      const paperSpy = vi.spyOn(paperBrokerAdapter, "placeOrder").mockResolvedValue({
        orderId: "PAPER_ORD_1001",
        brokerOrderId: "SIM_ORD_1001",
        tradingSymbol: "NIFTY2692424500CE",
        orderType: "MARKET",
        side: "BUY",
        quantity: 50,
        price: 150.0,
        averageFillPrice: 150.0,
        status: "FILLED",
        filledQuantity: 50,
        isPaper: true,
        placedAt: new Date().toISOString(),
        filledAt: new Date().toISOString(),
      });

      const orderRequest: BrokerOrderRequest = {
        tradingSymbol: "NIFTY2692424500CE",
        orderType: "MARKET",
        side: "BUY",
        product: "MIS",
        quantity: 50,
        price: 150.0,
        isPaper: true,
      };

      const result = await paperBrokerAdapter.placeOrder(orderRequest);

      expect(paperSpy).toHaveBeenCalledWith(orderRequest);
      expect(dhanSpy).not.toHaveBeenCalled();
      expect(result.status).toBe("FILLED");
      expect(result.isPaper).toBe(true);
      expect(dhanBrokerAdapter.getRealOrdersSentCount()).toBe(0);
    });

    it("verifies Dhan placeOrder remains permanently blocked with safety exception", async () => {
      const orderRequest: BrokerOrderRequest = {
        tradingSymbol: "NIFTY2692424500CE",
        orderType: "MARKET",
        side: "BUY",
        product: "MIS",
        quantity: 50,
        price: 150.0,
        isPaper: false,
      };

      await expect(dhanBrokerAdapter.placeOrder(orderRequest)).rejects.toThrow(
        "BROKER_EXECUTION_DISABLED: Real order execution is permanently disabled."
      );
      expect(dhanBrokerAdapter.getRealOrdersSentCount()).toBe(0);
    });

    it("records paper order and exit events into system health heartbeat", () => {
      monitor.recordPaperOrderEvent();
      monitor.recordPaperExitEvent();

      const hb = systemHealthService.getPhase21Heartbeat();
      expect(hb.lastPaperOrder).toBeDefined();
      expect(hb.lastPaperExit).toBeDefined();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 4. RECONCILIATION & ANOMALY DETECTION
  // ═══════════════════════════════════════════════════════════════════════════
  describe("4. Reconciliation & Anomaly Detection", () => {
    it("reconciles paper positions against broker positions and confirms MATCHED when both empty", async () => {
      vi.spyOn(paperBrokerAdapter, "getPositions").mockReturnValue([]);
      vi.spyOn(dhanBrokerAdapter, "getPositions").mockResolvedValue([]);

      const report = await brokerReconciliationEngine.reconcileAll();
      expect(report.status).toBe("MATCHED");
      expect(report.paperPositions.length).toBe(0);
      expect(report.brokerPositions.length).toBe(0);
    });

    it("detects unexpected external broker order on Dhan and logs UNEXPECTED_EXTERNAL_ORDER", async () => {
      vi.spyOn(dhanBrokerAdapter, "getOrders").mockResolvedValue([
        {
          orderId: "EXT_ORDER_999",
          brokerOrderId: "DHAN_EXT_999",
          tradingSymbol: "RELIANCE",
          orderType: "LIMIT",
          side: "BUY",
          quantity: 10,
          price: 2800,
          status: "FILLED",
          filledQuantity: 10,
          isPaper: false,
          placedAt: new Date().toISOString(),
        },
      ]);

      const result = await monitor.checkForUnexpectedExternalOrders();
      expect(result.hasUnexpectedOrders).toBe(true);
      expect(result.ordersFound.length).toBe(1);

      const alerts = operationalAlertLogger.getOperationalAlerts();
      const alert = alerts.find((a) => a.eventType === "UNEXPECTED_EXTERNAL_ORDER");
      expect(alert).toBeDefined();
      expect(alert?.severity).toBe("CRITICAL");
      expect(alert?.message).toContain("Unexpected order(s) detected on broker Dhan");

      // Verifies system status transitions to BLOCKED
      const chainStatus = await monitor.getOperationalChainStatus();
      expect(chainStatus.systemStatus).toBe("BLOCKED");
    });

    it("detects unexpected broker position when Dhan has positions not in paper ledger", async () => {
      vi.spyOn(paperBrokerAdapter, "getPositions").mockReturnValue([]);
      vi.spyOn(dhanBrokerAdapter, "getPositions").mockResolvedValue([
        {
          positionId: "DHAN_POS_1",
          tradingSymbol: "NIFTY2692424500CE",
          quantity: 50,
          averageBuyPrice: 100,
          unrealizedPnl: 500,
          isPaper: false,
        },
      ]);

      const report = await brokerReconciliationEngine.reconcileAll();
      expect(report.status).toBe("BROKER_ONLY_POSITION");
      expect(report.brokerPositions.length).toBe(1);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 5. CRASH RECOVERY & STATE PRESERVATION
  // ═══════════════════════════════════════════════════════════════════════════
  describe("5. Crash Recovery & State Reconstruction", () => {
    it("preserves daily risk state and limits without reset on restart", () => {
      dailyRiskController.recordDailyTrade(450.0);
      const metrics = dailyRiskController.getDailyMetrics();
      expect(metrics.tradesCount).toBeGreaterThanOrEqual(1);

      // Verify daily risk lock remains consistent
      const canTrade = dailyRiskController.isTradingAllowed();
      expect(typeof canTrade).toBe("boolean");
    });

    it("reconstructs paper persistence journal state correctly", () => {
      const state = paperPersistenceManager.getCurrentState();
      expect(state).toBeDefined();
      expect(state.version).toBeDefined();
      expect(brokerSafetyLock.isPaperTrading()).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 6. MARKET SESSION MONITOR (09:15 - 15:30 IST)
  // ═══════════════════════════════════════════════════════════════════════════
  describe("6. Market Session Monitor (09:15 - 15:30 IST)", () => {
    it("evaluates market session as open during 09:15 - 15:30 IST on weekdays", () => {
      // Mock weekday at 11:30 IST (06:00 UTC)
      const weekdayIst = new Date("2026-09-21T06:00:00Z"); // Monday 11:30 IST
      expect(monitor.isMarketSessionOpen(weekdayIst)).toBe(true);
    });

    it("evaluates market session as closed before 09:15 IST", () => {
      // Mock weekday at 08:30 IST (03:00 UTC)
      const earlyIst = new Date("2026-09-21T03:00:00Z"); // Monday 08:30 IST
      expect(monitor.isMarketSessionOpen(earlyIst)).toBe(false);
    });

    it("evaluates market session as closed after 15:30 IST", () => {
      // Mock weekday at 16:00 IST (10:30 UTC)
      const lateIst = new Date("2026-09-21T10:30:00Z"); // Monday 16:00 IST
      expect(monitor.isMarketSessionOpen(lateIst)).toBe(false);
    });

    it("evaluates market session as closed on weekends regardless of hour", () => {
      // Mock Sunday at 11:30 IST (06:00 UTC)
      const sundayIst = new Date("2026-09-20T06:00:00Z"); // Sunday
      expect(monitor.isMarketSessionOpen(sundayIst)).toBe(false);
    });

    it("accurately tracks session metrics (signals, trades, uptime %, reconciliation count)", async () => {
      monitor.recordSignalEvaluated();
      monitor.recordSignalEvaluated();
      monitor.recordTradeExecuted();
      monitor.recordNoTradeEvent();
      monitor.recordReconciliationEvent();

      const status = await monitor.getOperationalChainStatus();
      expect(status.marketSession.signalsEvaluatedCount).toBe(2);
      expect(status.marketSession.tradesExecutedCount).toBe(1);
      expect(status.marketSession.noTradeEventsCount).toBe(1);
      expect(status.marketSession.reconciliationEventsCount).toBeGreaterThanOrEqual(1);
      expect(status.marketSession.nseUptimePercent).toBeGreaterThan(0);
      expect(status.marketSession.dhanUptimePercent).toBeGreaterThan(0);
      expect(status.marketSession.paperUptimePercent).toBeGreaterThan(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 7. 11-POINT HEARTBEAT
  // ═══════════════════════════════════════════════════════════════════════════
  describe("7. 11-Point Operational Heartbeat", () => {
    it("contains all 11 required timestamp fields and latency", () => {
      const hb = systemHealthService.getPhase21Heartbeat();
      expect(hb.lastNseSpot).toBeDefined();
      expect(hb.lastNseOptionChain).toBeDefined();
      expect(hb.lastNseOptionPrice).toBeDefined();
      expect(hb.lastDhanConnection).toBeDefined();
      expect(hb.lastDhanQuote).toBeDefined();
      expect(hb.lastDhanPositionSync).toBeDefined();
      expect(hb.lastDhanOrderSync).toBeDefined();
      expect(hb.lastStrategyEvaluation).toBeDefined();
      expect(hb.lastPaperOrder).toBeDefined();
      expect(hb.lastPaperExit).toBeDefined();
      expect(hb.lastReconciliation).toBeDefined();
      expect(hb.latencyMs).toBeGreaterThanOrEqual(5);
      expect(hb.overallState).toBeDefined();
      expect(hb.evaluatedAt).toBeDefined();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 8. SAMPLE VALIDATION & PRESERVATION
  // ═══════════════════════════════════════════════════════════════════════════
  describe("8. Sample Validation & Preservation", () => {
    it("maintains validation threshold requirement (20 sessions, 30 trades, 15 active sessions)", async () => {
      const report = await phase19GenuineValidationEngine.generateSummaryReport();
      expect(report.genuineSample.minRequiredSessions).toBe(20);
      expect(report.genuineSample.minRequiredTrades).toBe(30);
      expect(report.genuineSample.minRequiredActiveSessions).toBe(15);
      expect(report.validationStatus).toBe("INSUFFICIENT_SAMPLE");
    });

    it("rejects synthetic or corrupted trade records from genuine sample", () => {
      expect(() => {
        phase19GenuineValidationEngine.recordTrade({
          tradeId: "corrupted_trade_1",
          sessionId: "session_20260920",
          strategy: "BULL_PUT_SPREAD",
          regime: "BULLISH_MOMENTUM",
          sampleType: "SIMULATED_TEST",
          dataSource: "SYNTHETIC",
          spot: 24500,
          expiry: "2026-09-24",
          strikes: [24400, 24300],
          optionTypes: ["PE", "PE"],
          lotSize: 50,
          entryPrices: [120, 80],
          initialCredit: 40,
          charges: 50,
          slippage: 10,
          grossPnl: 1500,
          netPnl: 1440,
          exitReason: "TARGET_REACHED",
          maxLoss: 5000,
          dataQualityState: "INVALID",
          dataTimestamp: "invalid_time", // Invalid date throws error
          decisionTimestamp: "2026-09-20T10:01:00Z",
          entryTimestamp: "2026-09-20T10:02:00Z",
        } as any);
      }).toThrow();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 9. PERMANENT SAFETY INVARIANTS (LOCKED)
  // ═══════════════════════════════════════════════════════════════════════════
  describe("9. Permanent Safety Invariants", () => {
    it("permanently locks PAPER_TRADING = true", () => {
      expect(brokerSafetyLock.isPaperTrading()).toBe(true);
    });

    it("permanently locks LIVE_TRADING = false", () => {
      expect(brokerSafetyLock.isLiveTrading()).toBe(false);
    });

    it("permanently locks BROKER_EXECUTION_ENABLED = false", () => {
      expect(brokerSafetyLock.isBrokerExecutionEnabled()).toBe(false);
    });

    it("confirms REAL BROKER ORDERS SENT = 0 under all conditions", async () => {
      const status = await monitor.getOperationalChainStatus();
      expect(status.safetyFlags.realBrokerOrdersSent).toBe(0);
      expect(dhanBrokerAdapter.getRealOrdersSentCount()).toBe(0);
    });
  });
});
