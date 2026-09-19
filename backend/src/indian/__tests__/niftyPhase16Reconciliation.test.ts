import { describe, it, expect, beforeEach } from "vitest";
import { BrokerReconciliationEngine } from "../reconciliation/BrokerReconciliationEngine";
import { SimulatedBrokerAdapter } from "../broker/SimulatedBrokerAdapter";
import { NiftySpreadPosition } from "../types";

describe("Phase 16 — Broker Reconciliation Engine Test Suite", () => {
  let reconciliationEngine: BrokerReconciliationEngine;
  let mockBroker: SimulatedBrokerAdapter;

  beforeEach(() => {
    reconciliationEngine = new BrokerReconciliationEngine();
    mockBroker = new SimulatedBrokerAdapter(100000);
    mockBroker.connect();
  });

  const sampleInternalOpenPosition: NiftySpreadPosition = {
    id: "POS_101",
    userId: "user_1",
    symbol: "NIFTY",
    strategy: "BULL_PUT_SPREAD",
    expiry: "2026-09-24",
    sellLeg: {
      symbol: "NIFTY2692424500PE",
      strike: 24500,
      optionType: "PE",
      side: "SELL",
      entryPrice: 150,
      currentPrice: 140,
      quantity: 65,
      status: "FILLED",
    },
    buyLeg: {
      symbol: "NIFTY2692424400PE",
      strike: 24400,
      optionType: "PE",
      side: "BUY",
      entryPrice: 100,
      currentPrice: 90,
      quantity: 65,
      status: "FILLED",
    },
    quantityLots: 1,
    totalQuantity: 65,
    netCredit: 50,
    maxLoss: 500,
    stopLossSpread: 100,
    targetSpread: 20,
    status: "OPEN",
    mode: "PAPER",
    entryTime: new Date().toISOString(),
    currentSpreadPrice: 50,
    unrealizedGrossPnl: 0,
    unrealizedNetPnl: 0,
    totalCharges: 80,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  it("1. Position Reconciliation MATCHED: Internal open positions match broker positions", async () => {
    // Place matching order in mock broker
    await mockBroker.placeOrder({
      clientOrderId: "CL_MATCH_1",
      symbol: "NIFTY",
      exchange: "NFO",
      instrument: "NIFTY2692424500PE",
      expiry: "2026-09-24",
      strike: 24500,
      optionType: "PE",
      side: "SELL",
      quantity: 65,
      orderType: "LIMIT",
      price: 150,
      product: "NRML",
    });

    await mockBroker.placeOrder({
      clientOrderId: "CL_MATCH_2",
      symbol: "NIFTY",
      exchange: "NFO",
      instrument: "NIFTY2692424400PE",
      expiry: "2026-09-24",
      strike: 24400,
      optionType: "PE",
      side: "BUY",
      quantity: 65,
      orderType: "LIMIT",
      price: 100,
      product: "NRML",
    });

    const report = await reconciliationEngine.reconcile(mockBroker, [sampleInternalOpenPosition], []);

    expect(report.criticalMismatchDetected).toBe(false);
    expect(report.isTradingAllowed).toBe(true);
    expect(report.positionReconciliation.every((p) => p.status === "MATCHED")).toBe(true);
  });

  it("2. Position Reconciliation MISMATCH: Phantom broker position blocks new trades", async () => {
    mockBroker.setForcePositionMismatch(true);

    const report = await reconciliationEngine.reconcile(mockBroker, [sampleInternalOpenPosition], []);

    expect(report.criticalMismatchDetected).toBe(true);
    expect(report.isTradingAllowed).toBe(false);
    expect(report.positionReconciliation.some((p) => p.status === "MISSING_INTERNAL")).toBe(true);
  });

  it("3. Order & P&L Reconciliation: Detects order matches and compares gross/net P&L", async () => {
    const report = await reconciliationEngine.reconcile(mockBroker, [], []);

    expect(report.pnlReconciliation.isPnlReconciled).toBe(true);
    expect(report.pnlReconciliation.unexplainedPnlDiff).toBe(0);
  });
});
