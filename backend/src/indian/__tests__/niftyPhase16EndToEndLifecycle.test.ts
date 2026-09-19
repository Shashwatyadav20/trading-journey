import { describe, it, expect, beforeEach, vi } from "vitest";
import { SimulatedBrokerAdapter } from "../broker/SimulatedBrokerAdapter";
import { BrokerExecutionPipeline } from "../broker/BrokerExecutionPipeline";
import { BrokerReconciliationEngine } from "../reconciliation/BrokerReconciliationEngine";
import { AutoHedgeSignal } from "../types";
import { brokerSafetyLock } from "../security/BrokerSafetyLock";
import { paperBrokerAdapter } from "../broker/PaperBrokerAdapter";

describe("Phase 16 — Complete End-To-End Execution Simulation & Paper Regression", () => {
  let mockBroker: SimulatedBrokerAdapter;
  let pipeline: BrokerExecutionPipeline;
  let reconciler: BrokerReconciliationEngine;

  beforeEach(() => {
    mockBroker = new SimulatedBrokerAdapter(100000);
    mockBroker.connect();
    pipeline = new BrokerExecutionPipeline(mockBroker);
    pipeline.clearIdempotencyStore();
    reconciler = new BrokerReconciliationEngine();

    vi.spyOn(brokerSafetyLock, "validateExecutionSafety").mockReturnValue({
      allowed: true,
      reason: null,
      errorCode: null,
      dependencies: {
        brokerConnection: true,
        marketData: true,
        database: true,
        riskEngine: true,
        reconciliation: true,
        instrumentResolver: true,
        authentication: true,
      },
    });
  });

  const validSignal: AutoHedgeSignal = {
    symbol: "NIFTY",
    timestamp: "2026-09-19T11:00:00.000Z",
    regime: "BULLISH",
    score: 90,
    action: "BULL_PUT_SPREAD",
    expiry: "2026-09-24T00:00:00.000Z",
    spotPrice: 24500,
    sellLeg: {
      symbol: "NIFTY2692424500PE",
      strike: 24500,
      optionType: "PE",
      ltp: 150,
      bid: 149,
      ask: 151,
      iv: 15,
      delta: -0.30,
    },
    buyLeg: {
      symbol: "NIFTY2692424450PE",
      strike: 24450,
      optionType: "PE",
      ltp: 110,
      bid: 109,
      ask: 111,
      iv: 16,
      delta: -0.20,
    },
    netCredit: 50,
    maxProfit: 3250,
    maxLoss: 500, // ₹500 <= ₹1000 limit
    entryPrice: 50,
    stopLossSpread: 100,
    targetSpread: 10,
    quantityLots: 1,
    totalQuantity: 65,
    marginRequired: 25000,
    charges: {
      grossPnl: 0,
      entryCharges: 40,
      exitCharges: 40,
      brokerage: 40,
      stt: 10,
      exchangeFees: 5,
      gst: 8,
      sebiFees: 1,
      stampDuty: 2,
      estimatedSlippage: 10,
      totalCharges: 76,
      netPnl: 0,
    },
    expectedNetPnl: 3174,
    riskPercentage: 0.5,
    rewardRiskRatio: 6.5,
    status: "READY",
    reasons: ["Strong bullish structure"],
  };

  it("1. COMPLETE FUTURE EXECUTION SIMULATION: Signal -> Risk -> Hedge -> Short -> Reconciliation -> P&L", async () => {
    // 1. Execute Pipeline
    const execResult = await pipeline.executeSignalPipeline(validSignal, "TRADE_E2E_001");

    expect(execResult.success).toBe(true);
    expect(execResult.hedgeLegState).toBe("SHORT_CONFIRMED");
    expect(execResult.totalHedgeQuantity).toBe(65);
    expect(execResult.totalShortQuantity).toBe(65);
    expect(execResult.hedgeResponse?.status).toBe("FILLED");
    expect(execResult.shortResponse?.status).toBe("FILLED");

    // 2. Verify Broker Positions & Orders
    const brokerOrders = await mockBroker.getOrders();
    const brokerPositions = await mockBroker.getPositions();

    expect(brokerOrders.length).toBe(2); // 1 Hedge BUY + 1 Short SELL
    expect(brokerPositions.length).toBe(2);

    // 3. Perform 3-Way Reconciliation Audit
    const internalPosition: NiftySpreadPosition = {
      id: "TRADE_E2E_001",
      userId: "user_test",
      symbol: "NIFTY",
      strategy: "BULL_PUT_SPREAD",
      expiry: "2026-09-24T00:00:00.000Z",
      sellLeg: {
        symbol: "NIFTY2692424500PE",
        strike: 24500,
        optionType: "PE",
        side: "SELL",
        entryPrice: execResult.shortResponse?.averagePrice || 149,
        currentPrice: 149,
        quantity: 65,
        status: "FILLED",
      },
      buyLeg: {
        symbol: "NIFTY2692424450PE",
        strike: 24450,
        optionType: "PE",
        side: "BUY",
        entryPrice: execResult.hedgeResponse?.averagePrice || 111,
        currentPrice: 111,
        quantity: 65,
        status: "FILLED",
      },
      quantityLots: 1,
      totalQuantity: 65,
      netCredit: 38,
      maxLoss: 500,
      stopLossSpread: 100,
      targetSpread: 10,
      status: "OPEN",
      mode: "PAPER",
      entryTime: new Date().toISOString(),
      currentSpreadPrice: 38,
      unrealizedGrossPnl: 0,
      unrealizedNetPnl: 0,
      totalCharges: 76,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const reconReport = await reconciler.reconcile(mockBroker, [internalPosition], []);

    expect(reconReport.isTradingAllowed).toBe(true);
    expect(reconReport.criticalMismatchDetected).toBe(false);
    expect(reconReport.pnlReconciliation.isPnlReconciled).toBe(true);
  });

  it("2. PAPER TRADING REGRESSION: PaperBrokerAdapter executes paper order cleanly with IBrokerAdapter compatibility", () => {
    paperBrokerAdapter.resetAccount();

    const position = paperBrokerAdapter.executePaperOrder("user_demo", validSignal);

    expect(position).toBeDefined();
    expect(position.symbol).toBe("NIFTY");
    expect(position.status).toBe("OPEN");
    expect(position.mode).toBe("PAPER");
    expect(position.sellLeg.status).toBe("FILLED");
    expect(position.buyLeg.status).toBe("FILLED");

    const openPos = paperBrokerAdapter.getOpenPositions("user_demo");
    expect(openPos.length).toBe(1);

    // Close position
    const closed = paperBrokerAdapter.closePosition(position.id, "PROFIT_TARGET_CAPTURED");
    expect(closed.status).toBe("CLOSED");
    expect(closed.exitReason).toBe("PROFIT_TARGET_CAPTURED");
  });
});
