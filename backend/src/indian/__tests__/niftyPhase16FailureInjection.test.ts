import { describe, it, expect, beforeEach, vi } from "vitest";
import { SimulatedBrokerAdapter } from "../broker/SimulatedBrokerAdapter";
import { BrokerExecutionPipeline } from "../broker/BrokerExecutionPipeline";
import { brokerOrderValidator } from "../broker/BrokerOrderValidator";
import { AutoHedgeSignal } from "../types";
import { brokerSafetyLock } from "../security/BrokerSafetyLock";

describe("Phase 16 — Failure Injection & Edge-Case Audit Test Suite", () => {
  let mockBroker: SimulatedBrokerAdapter;
  let pipeline: BrokerExecutionPipeline;

  beforeEach(() => {
    mockBroker = new SimulatedBrokerAdapter(100000);
    mockBroker.connect();
    pipeline = new BrokerExecutionPipeline(mockBroker);
    pipeline.clearIdempotencyStore();

    // Mock validateExecutionSafety to pass in testing pipeline
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

  const sampleSignal: AutoHedgeSignal = {
    symbol: "NIFTY",
    timestamp: "2026-09-19T10:00:00.000Z",
    regime: "BULLISH",
    score: 85,
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
      symbol: "NIFTY2692424400PE",
      strike: 24400,
      optionType: "PE",
      ltp: 100,
      bid: 99,
      ask: 101,
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
    reasons: ["Valid signal setup"],
  };

  it("1. Hedge Rejected: Short order is NEVER submitted if buy leg hedge fails or is rejected", async () => {
    mockBroker.setForceReject("INSUFFICIENT_MARGIN", "Insufficient broker margin for hedge order");

    const result = await pipeline.executeSignalPipeline(sampleSignal);

    expect(result.success).toBe(false);
    expect(result.hedgeLegState).toBe("HEDGE_REQUIRED");
    expect(result.totalHedgeQuantity).toBe(0);
    expect(result.totalShortQuantity).toBe(0);
    expect(result.shortResponse).toBeUndefined();
    expect(result.rejectionCode).toBe("INSUFFICIENT_MARGIN");
  });

  it("2. Hedge Partial Fill: Short order quantity is strictly capped to confirmed protective hedge quantity", async () => {
    // Force partial fill of 65 requested shares down to 0 lots (e.g. 0 shares filled) or partial fill
    mockBroker.setForcePartialFill(0); // 0 filled

    const result = await pipeline.executeSignalPipeline(sampleSignal);

    expect(result.success).toBe(false);
    expect(result.totalHedgeQuantity).toBe(0);
    expect(result.totalShortQuantity).toBe(0);
  });

  it("3. Short Rejected Without Hedge Confirmation: BrokerOrderValidator rejects naked short order", () => {
    const nakedShortRequest = {
      clientOrderId: "NAKED_SHORT_01",
      symbol: "NIFTY",
      exchange: "NFO" as const,
      instrument: "NIFTY2692424500PE",
      expiry: "2026-09-24T00:00:00.000Z",
      strike: 24500,
      optionType: "PE" as const,
      side: "SELL" as const,
      quantity: 65,
      orderType: "LIMIT" as const,
      price: 150,
      product: "NRML" as const,
      isHedgeLeg: false,
    };

    const valResult = brokerOrderValidator.validateOrder(nakedShortRequest, {
      isHedgeConfirmed: false,
      bypassMarketHours: true,
    });

    expect(valResult.allowed).toBe(false);
    expect(valResult.rejectionCode).toBe("HEDGE_NOT_CONFIRMED");
  });

  it("4. Max Loss Breach Rejection: Recalculates risk and rejects order exceeding ₹1,000 INR limit", () => {
    const highRiskParams = {
      strategy: "BULL_PUT_SPREAD",
      sellStrike: 24500,
      buyStrike: 24000, // 500 points width!
      sellPrice: 100,
      buyPrice: 50,     // Net credit = 50. Max loss = (500 - 50) * 65 = ₹29,250!
      quantity: 65,
    };

    const recalculated = brokerOrderValidator.calculateMaxLoss(highRiskParams);
    expect(recalculated).toBe(29250);

    const valResult = brokerOrderValidator.validateOrder({
      clientOrderId: "HIGH_RISK_01",
      symbol: "NIFTY",
      exchange: "NFO",
      instrument: "NIFTY2692424500PE",
      expiry: "2026-09-24T00:00:00.000Z",
      strike: 24500,
      optionType: "PE",
      side: "SELL",
      quantity: 65,
      orderType: "LIMIT",
      price: 100,
      product: "NRML",
    }, {
      maxLossParams: highRiskParams,
      isHedgeConfirmed: true,
      bypassMarketHours: true,
    });

    expect(valResult.allowed).toBe(false);
    expect(valResult.rejectionCode).toBe("MAX_LOSS_EXCEEDS_1000_INR");
  });

  it("5. Timeout & Idempotency: Timed-out order is reconciled cleanly without submitting duplicates", async () => {
    mockBroker.setForceTimeout(true);

    const req = {
      clientOrderId: "TIMEOUT_IDEM_100",
      symbol: "NIFTY",
      exchange: "NFO" as const,
      instrument: "NIFTY2692424400PE",
      expiry: "2026-09-24T00:00:00.000Z",
      strike: 24400,
      optionType: "PE" as const,
      side: "BUY" as const,
      quantity: 65,
      orderType: "LIMIT" as const,
      price: 100,
      product: "NRML" as const,
      isHedgeLeg: true,
    };

    const res = await pipeline.placeOrderSafely(req, true);

    expect(res.status).toBe("UNKNOWN");
    expect(res.rejectionCode).toBe("TIMEOUT");

    // Second call with same clientOrderId returns stored idempotency record without crashing
    mockBroker.setForceTimeout(false);
    const res2 = await pipeline.placeOrderSafely(req, true);
    expect(res2.clientOrderId).toBe("TIMEOUT_IDEM_100");
  });
});
