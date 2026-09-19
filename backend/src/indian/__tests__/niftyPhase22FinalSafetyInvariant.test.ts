/**
 * Phase 22 — Final Safety Invariant Test
 * 
 * Asserts the immutable safety invariants across all layers of the Indian Trading System:
 * 1. PAPER_TRADING === true (permanent hard lock)
 * 2. LIVE_TRADING === false (permanent hard lock)
 * 3. BROKER_EXECUTION_ENABLED === false (permanent hard lock)
 * 4. REAL_ORDERS_SENT === 0 (zero real orders ever sent)
 * 5. DhanBrokerAdapter.placeOrder() is fail-closed (BROKER_EXECUTION_DISABLED)
 * 6. DhanBrokerAdapter.modifyOrder() is fail-closed (BROKER_EXECUTION_DISABLED)
 * 7. DhanBrokerAdapter.cancelOrder() is fail-closed (BROKER_EXECUTION_DISABLED)
 * 8. PaperBrokerAdapter is the execution adapter (Dhan adapter is strictly read-only telemetry)
 * 9. validateExecutionSafety() always returns allowed=false
 */

import { describe, it, expect } from "vitest";
import { brokerSafetyLock } from "../security/BrokerSafetyLock";
import { dhanBrokerAdapter } from "../broker/DhanBrokerAdapter";
import { paperBrokerAdapter } from "../broker/PaperBrokerAdapter";

describe("Phase 22 — Final Safety Invariant Audit & Verification", () => {
  it("PAPER_TRADING === true (permanent hard lock)", () => {
    expect(brokerSafetyLock.PAPER_TRADING).toBe(true);
  });

  it("LIVE_TRADING === false (permanent hard lock)", () => {
    expect(brokerSafetyLock.LIVE_TRADING).toBe(false);
  });

  it("BROKER_EXECUTION_ENABLED === false (permanent hard lock)", () => {
    expect(brokerSafetyLock.BROKER_EXECUTION_ENABLED).toBe(false);
  });

  it("REAL_ORDERS_SENT === 0 (never incremented, zero broker orders sent)", () => {
    expect(dhanBrokerAdapter.getRealOrdersSent()).toBe(0);
  });

  it("DhanBrokerAdapter.placeOrder() is fail-closed with BROKER_EXECUTION_DISABLED", async () => {
    await expect(
      dhanBrokerAdapter.placeOrder({
        dhanClientId: "1100993334",
        transactionType: "BUY",
        exchangeSegment: "NSE_FNO",
        productType: "INTRADAY",
        orderType: "MARKET",
        validity: "DAY",
        securityId: "12345",
        quantity: 50,
      })
    ).rejects.toThrow("BROKER_EXECUTION_DISABLED");

    // Re-verify counter remains zero
    expect(dhanBrokerAdapter.getRealOrdersSent()).toBe(0);
  });

  it("DhanBrokerAdapter.modifyOrder() is fail-closed with BROKER_EXECUTION_DISABLED", async () => {
    await expect(
      dhanBrokerAdapter.modifyOrder("test-order-id", {
        orderType: "LIMIT",
        price: 100,
      })
    ).rejects.toThrow("BROKER_EXECUTION_DISABLED");
  });

  it("DhanBrokerAdapter.cancelOrder() is fail-closed with BROKER_EXECUTION_DISABLED", async () => {
    await expect(
      dhanBrokerAdapter.cancelOrder("test-order-id")
    ).rejects.toThrow("BROKER_EXECUTION_DISABLED");
  });

  it("PaperBrokerAdapter is the active paper execution adapter", () => {
    expect(typeof paperBrokerAdapter.executePaperOrder).toBe("function");
    expect(typeof (dhanBrokerAdapter as any).executePaperOrder).toBe("undefined");
  });

  it("BrokerSafetyLock.validateExecutionSafety() always returns allowed=false with LIVE_EXECUTION_PERMANENTLY_DISABLED", () => {
    const check = brokerSafetyLock.validateExecutionSafety();
    expect(check.allowed).toBe(false);
    expect(check.errorCode).toBe("LIVE_EXECUTION_PERMANENTLY_DISABLED");
  });
});
