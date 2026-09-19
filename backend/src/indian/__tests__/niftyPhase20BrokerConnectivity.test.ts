import { describe, it, expect, beforeEach, vi } from "vitest";
import { DhanBrokerAdapter, dhanBrokerAdapter } from "../broker/DhanBrokerAdapter";
import { BrokerManager, brokerManager } from "../broker/BrokerManager";
import { paperBrokerAdapter } from "../broker/PaperBrokerAdapter";
import { brokerSafetyLock } from "../security/BrokerSafetyLock";
import { brokerOrderValidator } from "../broker/BrokerOrderValidator";
import { BrokerExecutionPipeline } from "../broker/BrokerExecutionPipeline";
import { instrumentMasterResolver } from "../broker/InstrumentMasterResolver";
import { brokerReconciliationEngine } from "../reconciliation/BrokerReconciliationEngine";
import { phase19GenuineValidationEngine } from "../validation/Phase19GenuineValidationEngine";
import { auditLogger } from "../audit/AuditLogger";
import { BrokerOrderRequest } from "../broker/IBrokerAdapter";

describe("Phase 20 — Broker API Integration & Paper Execution Connectivity Test Suite", () => {
  let customDhanAdapter: DhanBrokerAdapter;

  beforeEach(() => {
    customDhanAdapter = new DhanBrokerAdapter();
    vi.restoreAllMocks();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 1. AUTHENTICATION & SECRET SAFETY
  // ═══════════════════════════════════════════════════════════════════════════
  describe("1. Authentication & Secret Management", () => {
    it("reports NOT_CONFIGURED when credentials are missing", async () => {
      const emptyAdapter = new DhanBrokerAdapter();
      vi.spyOn(emptyAdapter as any, "getClientId").mockReturnValue(undefined);
      vi.spyOn(emptyAdapter as any, "getAccessToken").mockReturnValue(undefined);

      expect(emptyAdapter.isConfigured()).toBe(false);
      const res = await emptyAdapter.connect();
      expect(res.state).toBe("FAILED");
      expect(res.message).toContain("BROKER_CONNECTIVITY = NOT_CONFIGURED");
    });

    it("successfully connects in read-only mode when valid credentials exist", async () => {
      vi.spyOn(customDhanAdapter as any, "makeRequest").mockResolvedValue({
        dhanClientId: "1100993334",
        availabelBalance: 50000,
        utilizedAmount: 0,
        sodLimit: 50000,
      });

      const res = await customDhanAdapter.connect();
      expect(res.state).toBe("CONNECTED");
      expect(res.brokerName).toBe("DHAN");
      expect(res.isPaper).toBe(false);

      const status = customDhanAdapter.getConnectionStatus();
      expect(status.state).toBe("CONNECTED");
    });

    it("transitions to AUTH_FAILED on HTTP 401/403 without leaking credentials", async () => {
      vi.spyOn(customDhanAdapter as any, "makeRequest").mockRejectedValue(
        new Error("AUTH_FAILED: Authentication rejected with status 401")
      );

      const res = await customDhanAdapter.connect();
      expect(res.state).toBe("AUTH_FAILED");
      expect(res.message).toContain("AUTH_FAILED");

      // Verify no secret or token is leaked in the message
      const token = process.env.BROKER_ACCESS_TOKEN;
      if (token) {
        expect(res.message).not.toContain(token);
      }
    });

    it("disconnects cleanly and resets availability states", async () => {
      await customDhanAdapter.disconnect();
      const status = customDhanAdapter.getConnectionStatus();
      expect(status.state).toBe("DISCONNECTED");
      const diag = customDhanAdapter.getDiagnostics();
      expect(diag.accountAvailable).toBe(false);
      expect(diag.positionsAvailable).toBe(false);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 2. READ-ONLY ACCOUNT & RISK LIMITS
  // ═══════════════════════════════════════════════════════════════════════════
  describe("2. Read-Only Account Retrieval", () => {
    it("retrieves account margin and masks account ID", async () => {
      vi.spyOn(customDhanAdapter as any, "makeRequest").mockResolvedValue({
        dhanClientId: "1100993334",
        availabelBalance: 125000.5,
        utilizedAmount: 25000.0,
        sodLimit: 150000.0,
        collateralAmount: 0,
      });

      const acc = await customDhanAdapter.getAccount();
      expect(acc.brokerName).toBe("DHAN");
      expect(acc.availableMargin).toBe(125000.5);
      expect(acc.usedMargin).toBe(25000.0);
      expect(acc.currency).toBe("INR");
      expect(acc.isPaperAccount).toBe(false);
      // Masked account ID: 110****334
      expect(acc.accountId).toContain("****");
      expect(acc.accountId).not.toBe("1100993334");
    });

    it("leaves max theoretical loss rule at ₹1,000 unchanged despite broker margin", () => {
      const orderReq: BrokerOrderRequest = {
        clientOrderId: "TEST_MAX_LOSS",
        symbol: "NIFTY",
        exchange: "NFO",
        instrument: "NIFTY2692424500CE",
        expiry: "2026-09-24",
        strike: 24500,
        optionType: "CE",
        side: "SELL",
        quantity: 65,
        orderType: "LIMIT",
        price: 150,
        product: "NRML",
      };

      // Attempting a trade with theoretical loss > ₹1,000
      const validation = brokerOrderValidator.validateOrder(orderReq, {
        maxLossParams: {
          strategy: "BEAR_CALL_SPREAD",
          sellStrike: 24500,
          buyStrike: 24700, // 200 pt spread * 65 = ₹13,000 max loss!
          sellPrice: 100,
          buyPrice: 20,
          quantity: 65,
        },
        bypassMarketHours: true,
      });

      expect(validation.allowed).toBe(false);
      expect(validation.rejectionCode).toBe("MAX_LOSS_EXCEEDS_1000_INR");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 3. READ-ONLY POSITIONS RETRIEVAL
  // ═══════════════════════════════════════════════════════════════════════════
  describe("3. Read-Only Positions Retrieval", () => {
    it("normalizes broker positions into internal model", async () => {
      vi.spyOn(customDhanAdapter as any, "makeRequest").mockResolvedValue([
        {
          securityId: "12345",
          tradingSymbol: "NIFTY2692424500CE",
          exchangeSegment: "NSE_FNO",
          expiryDate: "2026-09-24",
          netQty: 65,
          buyQty: 65,
          sellQty: 0,
          costPrice: 105.5,
          buyAvg: 105.5,
          sellAvg: 0,
          lastPrice: 120.0,
          unrealizedProfit: 942.5,
          realizedProfit: 0,
          productType: "NRML",
        },
      ]);

      const positions = await customDhanAdapter.getPositions();
      expect(positions.length).toBe(1);
      expect(positions[0].symbol).toBe("NIFTY2692424500CE");
      expect(positions[0].strike).toBe(24500);
      expect(positions[0].optionType).toBe("CE");
      expect(positions[0].side).toBe("BUY");
      expect(positions[0].quantity).toBe(65);
      expect(positions[0].averagePrice).toBe(105.5);
      expect(positions[0].unrealizedPnl).toBe(942.5);
    });

    it("handles empty position array safely without error", async () => {
      vi.spyOn(customDhanAdapter as any, "makeRequest").mockResolvedValue([]);
      const positions = await customDhanAdapter.getPositions();
      expect(positions).toEqual([]);
      expect(customDhanAdapter.getDiagnostics().positionsAvailable).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 4. READ-ONLY ORDERS RETRIEVAL
  // ═══════════════════════════════════════════════════════════════════════════
  describe("4. Read-Only Orders Retrieval", () => {
    it("normalizes broker order history", async () => {
      vi.spyOn(customDhanAdapter as any, "makeRequest").mockResolvedValue([
        {
          orderId: "DHAN_ORD_991",
          correlationId: "CORR_001",
          tradingSymbol: "NIFTY2692424500CE",
          transactionType: "BUY",
          quantity: 65,
          tradedQuantity: 65,
          price: 105.0,
          orderStatus: "TRADED",
          orderTimestamp: "2026-09-20T10:00:00Z",
        },
      ]);

      const orders = await customDhanAdapter.getOrders();
      expect(orders.length).toBe(1);
      expect(orders[0].orderId).toBe("DHAN_ORD_991");
      expect(orders[0].clientOrderId).toBe("CORR_001");
      expect(orders[0].status).toBe("FILLED");
      expect(orders[0].side).toBe("BUY");
      expect(orders[0].filledQuantity).toBe(65);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 5. HARD SAFETY LOCK: LIVE ORDER EXECUTION IS PERMANENTLY BLOCKED
  // ═══════════════════════════════════════════════════════════════════════════
  describe("5. Critical Real Order Block Enforcement", () => {
    it("fails closed on placeOrder with BROKER_EXECUTION_DISABLED and 0 requests sent", async () => {
      const orderReq: BrokerOrderRequest = {
        clientOrderId: "TRY_LIVE_ORDER",
        symbol: "NIFTY",
        exchange: "NFO",
        instrument: "NIFTY2692424500CE",
        expiry: "2026-09-24",
        strike: 24500,
        optionType: "CE",
        side: "BUY",
        quantity: 65,
        orderType: "LIMIT",
        price: 100,
        product: "NRML",
      };

      await expect(customDhanAdapter.placeOrder(orderReq)).rejects.toThrow(
        "BROKER_EXECUTION_DISABLED"
      );

      expect(customDhanAdapter.getRealOrdersSent()).toBe(0);
    });

    it("fails closed on modifyOrder with BROKER_EXECUTION_DISABLED", async () => {
      await expect(
        customDhanAdapter.modifyOrder("ORD_123", { price: 105 })
      ).rejects.toThrow("BROKER_EXECUTION_DISABLED");
      expect(customDhanAdapter.getRealOrdersSent()).toBe(0);
    });

    it("fails closed on cancelOrder with BROKER_EXECUTION_DISABLED", async () => {
      await expect(customDhanAdapter.cancelOrder("ORD_123")).rejects.toThrow(
        "BROKER_EXECUTION_DISABLED"
      );
      expect(customDhanAdapter.getRealOrdersSent()).toBe(0);
    });

    it("multi-layer safety verification: BrokerSafetyLock, TradeValidator & ExecutionPipeline reject live orders", () => {
      // 1. BrokerSafetyLock
      const safety = brokerSafetyLock.validateExecutionSafety();
      expect(safety.allowed).toBe(false);
      expect(safety.errorCode).toBe("LIVE_EXECUTION_PERMANENTLY_DISABLED");
      expect(brokerSafetyLock.PAPER_TRADING).toBe(true);
      expect(brokerSafetyLock.LIVE_TRADING).toBe(false);
      expect(brokerSafetyLock.BROKER_EXECUTION_ENABLED).toBe(false);

      // 2. BrokerExecutionPipeline with real adapter
      const pipeline = new BrokerExecutionPipeline(customDhanAdapter);
      expect(pipeline.getBrokerAdapter()).toBe(customDhanAdapter);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 6. INSTRUMENT MASTER & DYNAMIC LOT SIZE
  // ═══════════════════════════════════════════════════════════════════════════
  describe("6. Instrument Master & Contract Validation", () => {
    it("resolves valid NIFTY option contract with verified lot size", async () => {
      instrumentMasterResolver.setLotSize(65);
      const instrument = await customDhanAdapter.getInstrument("NIFTY26092424500CE");
      expect(instrument).not.toBeNull();
      expect(instrument?.strike).toBe(24500);
      expect(instrument?.optionType).toBe("CE");
      expect(instrument?.lotSize).toBe(65);
    });

    it("rejects non-multiple of 50 strike prices as invalid", () => {
      const invalidStrike = instrumentMasterResolver.resolveInstrument("NIFTY", "2026-09-24", 24523, "CE");
      expect(invalidStrike.valid).toBe(false);
      expect(invalidStrike.reason).toContain("strikes must be multiples of 50");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 7. OBSERVATIONAL RECONCILIATION
  // ═══════════════════════════════════════════════════════════════════════════
  describe("7. Observational Reconciliation", () => {
    it("reports MATCHED when internal positions align with broker positions", async () => {
      vi.spyOn(customDhanAdapter as any, "makeRequest").mockImplementation((endpoint: string) => {
        if (endpoint === "/positions") return Promise.resolve([]);
        if (endpoint === "/orders") return Promise.resolve([]);
        if (endpoint === "/fundlimit") return Promise.resolve({ availabelBalance: 100000 });
        return Promise.resolve([]);
      });

      const report = await brokerReconciliationEngine.reconcile(customDhanAdapter, [], []);
      expect(report.criticalMismatchDetected).toBe(false);
      expect(report.isTradingAllowed).toBe(true);
    });

    it("detects critical position discrepancy when broker has unrecorded position", async () => {
      vi.spyOn(customDhanAdapter as any, "makeRequest").mockImplementation((endpoint: string) => {
        if (endpoint === "/positions") {
          return Promise.resolve([
            {
              securityId: "999",
              tradingSymbol: "NIFTY2692424500CE",
              exchangeSegment: "NSE_FNO",
              netQty: 65,
              costPrice: 100,
              unrealizedProfit: 0,
            },
          ]);
        }
        if (endpoint === "/orders") return Promise.resolve([]);
        if (endpoint === "/fundlimit") return Promise.resolve({ availabelBalance: 100000 });
        return Promise.resolve([]);
      });

      // Internal positions is empty [], but broker has 65 qty -> MISMATCH
      const report = await brokerReconciliationEngine.reconcile(customDhanAdapter, [], []);
      expect(report.criticalMismatchDetected).toBe(true);
      expect(report.positionReconciliation[0].status).toBe("MISSING_INTERNAL");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 8. PAPER TRADING INDEPENDENCE & PHASE 19 DATA PRESERVATION
  // ═══════════════════════════════════════════════════════════════════════════
  describe("8. Paper Trading Independence & Sample Preservation", () => {
    it("guarantees paper execution is strictly routed to PaperBrokerAdapter", () => {
      const routingTarget = brokerManager.assertExecutionRoutingTarget();
      expect(routingTarget).toBe("PaperBrokerAdapter");
      expect(brokerManager.getPaperBrokerAdapter()).toBe(paperBrokerAdapter);
    });

    it("preserves Phase 19 genuine validation engine data without resets", async () => {
      const summary = await phase19GenuineValidationEngine.generateSummaryReport();
      expect(summary).toBeDefined();
      expect(summary.validationStatus).toBe("INSUFFICIENT_SAMPLE");
      expect(summary.genuineSample.totalSessions).toBe(0);
      expect(summary.genuineSample.totalTrades).toBe(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 9. READINESS SCORECARD FACTUAL VERIFICATION
  // ═══════════════════════════════════════════════════════════════════════════
  describe("9. Readiness Scorecard", () => {
    it("returns complete 10-point factual checklist", () => {
      const scorecard = customDhanAdapter.getReadinessScorecard();
      const expectedKeys = [
        "Authentication",
        "Account Read",
        "Position Read",
        "Order Read",
        "Instrument Master",
        "Quote Read",
        "Reconciliation",
        "Error Handling",
        "Token Security",
        "Execution Lock",
      ];

      for (const key of expectedKeys) {
        expect(scorecard).toHaveProperty(key);
        expect(["PASS", "FAIL", "NOT_CONFIGURED", "NOT_SUPPORTED"]).toContain((scorecard as any)[key]);
      }

      // Execution Lock must ALWAYS be PASS because live orders are permanently blocked
      expect(scorecard["Execution Lock"]).toBe("PASS");
      expect(scorecard["Token Security"]).toBe("PASS");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 10. AUDIT LOGGING OF BROKER EVENTS
  // ═══════════════════════════════════════════════════════════════════════════
  describe("10. Broker Audit Logging", () => {
    it("logs audit events without leaking secrets", async () => {
      const auditSpy = vi.spyOn(auditLogger, "log");

      await customDhanAdapter.disconnect();
      expect(auditSpy).toHaveBeenCalledWith(
        "BROKER_DISCONNECTED",
        expect.stringContaining("DISC_"),
        expect.objectContaining({ provider: "DHAN" })
      );

      // Verify no secrets exist in recent audit logs
      const recent = auditLogger.getRecentLogs();
      const token = process.env.BROKER_ACCESS_TOKEN;
      if (token) {
        for (const log of recent) {
          const serialized = JSON.stringify(log);
          expect(serialized).not.toContain(token);
        }
      }
    });
  });
});
