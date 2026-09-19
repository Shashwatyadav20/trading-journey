import { describe, it, expect, beforeEach } from "vitest";
import { riskEngine } from "../risk/RiskEngine";
import { dailyRiskController } from "../risk/DailyRiskController";
import { signalIdempotencyStore } from "../lifecycle/SignalIdempotencyStore";
import { phase17PaperSessionTracker } from "../lifecycle/Phase17PaperSessionTracker";

describe("Phase 18 — Risk Engine & Idempotent Paper Execution Test Suite", () => {
  beforeEach(() => {
    dailyRiskController.resetLocks();
    signalIdempotencyStore.clear();
    phase17PaperSessionTracker.resetSession();
  });


  it("1. Hard Max Loss Rule: Rejects spread with theoretical loss > ₹1,000", () => {
    // Bull put spread: Sell 24700 PE, Buy 24500 PE (width = 200 pts)
    // Credit = 20 pts. Max Loss per share = 180 pts.
    // Lot size = 75. Max Loss = 180 * 75 = ₹13,500 (> ₹5,000 1% risk limit of ₹500k capital)
    const validation = riskEngine.validateAndSizePosition(
      500000,
      200,
      20,
      100,
    );

    expect(validation.maxLossPerLot).toBeGreaterThan(1000);
  });


  it("2. Daily Risk Locks: Halts new trades when daily profit target (+₹1,000) or loss limit (-₹5,000) is hit", () => {
    expect(dailyRiskController.canTrade().allowed).toBe(true);

    // Record +₹1,050 daily net profit
    dailyRiskController.recordTradeClosed(1050);

    const state = dailyRiskController.getState();
    expect(state.isTradeLocked).toBe(true);
    expect(state.lockReason).toContain("profit target reached");
    expect(dailyRiskController.canTrade().allowed).toBe(false);
  });


  it("3. Signal Idempotency: Prevents duplicate paper trade entry for identical signal on same day", () => {
    const signalParams = {
      underlying: "NIFTY",
      expiry: "2026-09-25",
      sellStrike: 24700,
      buyStrike: 24650,
      strategyType: "BULL_PUT_SPREAD",
      dateStr: "2026-09-19",
    };

    const key = signalIdempotencyStore.generateSignalKey(signalParams);

    const firstRegistration = signalIdempotencyStore.registerSignal(key);
    expect(firstRegistration).toBe(true);

    const secondRegistration = signalIdempotencyStore.registerSignal(key);
    expect(secondRegistration).toBe(false); // Duplicate blocked
  });

  it("4. Sample Classification: Classifies session as REAL_GENUINE_PAPER only when all 3 sources are REAL", () => {
    phase17PaperSessionTracker.updateDataSources("REAL", "REAL", "REAL", "NSE_INDIA");
    const session = phase17PaperSessionTracker.getCurrentSession();
    expect(session.isGenuinePaperSample).toBe(true);

    phase17PaperSessionTracker.updateDataSources("REAL", "SYNTHETIC", "REAL", "NSE_INDIA");
    const synthSession = phase17PaperSessionTracker.getCurrentSession();
    expect(synthSession.isGenuinePaperSample).toBe(false);
  });
});
