import { describe, it, expect, beforeEach } from "vitest";
import { BrokerReconciliationEngine } from "../reconciliation/BrokerReconciliationEngine";
import { paperBrokerAdapter } from "../broker/PaperBrokerAdapter";

describe("Phase 18 — 3-Way Reconciliation & Restart Recovery Test Suite", () => {
  let reconciler: BrokerReconciliationEngine;

  beforeEach(() => {
    reconciler = new BrokerReconciliationEngine();
    paperBrokerAdapter.resetAccount();
  });

  it("1. Performs 3-way reconciliation cleanly when internal positions match broker adapter", async () => {
    const report = await reconciler.reconcile(paperBrokerAdapter, [], []);

    expect(report.isTradingAllowed).toBe(true);
    expect(report.criticalMismatchDetected).toBe(false);
    expect(report.pnlReconciliation.isPnlReconciled).toBe(true);
  });

  it("2. Detects orphan positions and halts trading when critical mismatch is detected", async () => {
    // Add mock position directly to broker without internal record
    paperBrokerAdapter.executePaperOrder("user_demo", {
      symbol: "NIFTY",
      timestamp: new Date().toISOString(),
      regime: "BULLISH",
      score: 85,
      action: "BULL_PUT_SPREAD",
      expiry: "2026-09-25",
      spotPrice: 24700,
      sellLeg: { symbol: "NIFTY2692524700PE", strike: 24700, optionType: "PE", ltp: 150, bid: 149, ask: 151, iv: 15, delta: -0.3 },
      buyLeg: { symbol: "NIFTY2692524650PE", strike: 24650, optionType: "PE", ltp: 110, bid: 109, ask: 111, iv: 16, delta: -0.2 },
      netCredit: 40,
      maxProfit: 3000,
      maxLoss: 375,
      entryPrice: 40,
      stopLossSpread: 80,
      targetSpread: 10,
      quantityLots: 1,
      totalQuantity: 75,
      marginRequired: 25000,
      charges: { grossPnl: 0, entryCharges: 40, exitCharges: 40, brokerage: 40, stt: 10, exchangeFees: 5, gst: 8, sebiFees: 1, stampDuty: 2, estimatedSlippage: 10, totalCharges: 76, netPnl: 0 },
      expectedNetPnl: 2924,
      riskPercentage: 0.5,
      rewardRiskRatio: 7.5,
      status: "READY",
      reasons: [],
    });

    const report = await reconciler.reconcile(paperBrokerAdapter, [], []);

    const orphanPositions = report.positionReconciliation.filter((p) => p.status === "MISSING_INTERNAL");
    expect(orphanPositions.length).toBeGreaterThanOrEqual(1);
    expect(report.criticalMismatchDetected).toBe(true);
    expect(report.isTradingAllowed).toBe(false);
  });

});
