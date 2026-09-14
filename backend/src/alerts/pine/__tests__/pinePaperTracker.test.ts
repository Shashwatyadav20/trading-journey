import { describe, it, expect, beforeEach } from "vitest";
import { PinePaperTracker } from "../PinePaperTracker";
import { PineSignal, Candle } from "../PineTypes";

describe("PinePaperTracker (Shadow Paper Observer)", () => {
  let tracker: PinePaperTracker;

  beforeEach(() => {
    tracker = new PinePaperTracker();
  });

  it("1. Tracks live signal for both Baseline and Variant B in parallel", () => {
    const sig: PineSignal = {
      signalId: "sig_TEST_1",
      instrument: "XAU/USD",
      timestamp: "2026-09-14T10:00:00Z",
      timeframe: "15M",
      direction: "BUY",
      strategy: "SWING",
      signalType: "BUY_SETUP",
      triggerPrice: 4300.0,
      referenceLevel: "15M+ Swing Low 4300.00",
      referenceLevelType: "SWL",
      confidence: 0.85,
      status: "ACTIVE",
    };

    // Bearish HTF trend -> Variant B filters SWL BUY signal
    const record = tracker.trackSignal(sig, 4300.0, "BEARISH");

    expect(record.baselineSignal).toBe(true);
    expect(record.variantBSignal).toBe(false);
    expect(record.isFilteredByVariantB).toBe(true);
    expect(record.entryPrice).toBe(4300.30); // +$0.30 spread
    expect(record.stopLoss).toBe(4295.30);   // -$5.00
    expect(record.takeProfit).toBe(4310.30);  // +$10.00
  });

  it("2. Allows Variant B signal when HTF trend is BULLISH or non-SWL level", () => {
    const sig: PineSignal = {
      signalId: "sig_TEST_2",
      instrument: "XAU/USD",
      timestamp: "2026-09-14T10:15:00Z",
      timeframe: "15M",
      direction: "SELL",
      strategy: "LIQUIDITY_SWEEP",
      signalType: "SELL_SETUP",
      triggerPrice: 4350.0,
      referenceLevel: "15M+ Swing High 4350.00",
      referenceLevelType: "SWH",
      confidence: 0.85,
      status: "ACTIVE",
    };

    const record = tracker.trackSignal(sig, 4350.0, "BEARISH");

    expect(record.baselineSignal).toBe(true);
    expect(record.variantBSignal).toBe(true);
    expect(record.isFilteredByVariantB).toBe(false);
  });

  it("3. Updates pending paper trade status upon subsequent candle movement", () => {
    const sig: PineSignal = {
      signalId: "sig_TEST_3",
      instrument: "XAU/USD",
      timestamp: "2026-09-14T10:30:00Z",
      timeframe: "15M",
      direction: "BUY",
      strategy: "LIQUIDITY_SWEEP",
      signalType: "BUY_SETUP",
      triggerPrice: 4300.0,
      referenceLevel: "Previous Day Low 4300.00",
      referenceLevelType: "PDL",
      confidence: 0.85,
      status: "ACTIVE",
    };

    tracker.trackSignal(sig, 4300.0, "BULLISH");

    // Candle reaches TP target (4310.30)
    const tpCandle: Candle = {
      timestamp: "2026-09-14T10:45:00Z",
      open: 4301.0,
      high: 4312.0,
      low: 4300.0,
      close: 4311.0,
      volume: 100,
    };

    tracker.updatePriceTick(tpCandle);

    const records = tracker.getRecords();
    expect(records[0].status).toBe("TP");
    expect(records[0].pnlDollar).toBe(10.0); // +$10 profit on 2:1 R:R

    const summary = tracker.getSummary();
    expect(summary.totalSignalsTracked).toBe(1);
    expect(summary.baselineTradesCount).toBe(1);
    expect(summary.variantBTradesCount).toBe(1);
    expect(summary.baselineNetPnl).toBe(10.0);
    expect(summary.variantBNetPnl).toBe(10.0);
  });

  it("4. Confirm safety: zero trade execution methods exist on tracker", () => {
    expect(typeof (tracker as any).executeBrokerOrder).toBe("undefined");
    expect(typeof (tracker as any).placeOrder).toBe("undefined");
  });
});
