import { describe, expect, it } from "vitest";
import { getFrozenSpecChecksum, STRATEGY03_FROZEN_SPEC_V61018 } from "../forward/Strategy03FrozenSpec.js";
import { buildForwardSignalRecord, isStrictlyForwardTimestamp } from "../forward/Strategy03ForwardShadowMonitor.js";
import { reconcileDhanContractNotes } from "../forward/Strategy03DhanContractNoteReconciler.js";

describe("Strategy 03 Phase 6.10.18 — Pure Forward Shadow & Dhan Contract Note Reconciliation", () => {
  it("enforces strictly forward timestamps, freezes spec checksum, and reconciles Dhan contract notes", () => {
    expect(getFrozenSpecChecksum()).toHaveLength(64);
    expect(STRATEGY03_FROZEN_SPEC_V61018.safetyLocks.STRATEGY_03).toBe(false);

    // Historical timestamp must NOT count as forward
    expect(isStrictlyForwardTimestamp("2026-10-15T10:00:00+05:30")).toBe(false);
    // Future timestamp after phaseStartTimestamp counts
    expect(isStrictlyForwardTimestamp("2026-11-18T09:15:00+05:30")).toBe(true);

    const pendingSig = buildForwardSignalRecord({
      id: "sig-1",
      signalTimestamp: "2026-11-18T10:15:00+05:30",
      symbol: "INFY",
      score: 75,
      verificationStatus: "VERIFIED",
      marketRegime: "BULL",
      referenceEntryPrice: 1500,
      nextExecutableCandlePrice: 1502,
      hypotheticalStopPrice: 1455,
      hypotheticalTargetPrice: 1640,
      exitTrigger: null,
      referenceExitPrice: null,
    });
    expect(pendingSig.isMature).toBe(false);
    expect(pendingSig.hypotheticalNetPnlInr).toBeNull();

    // Empty contract notes -> PENDING
    expect(reconcileDhanContractNotes([]).status).toBe("PENDING");

    // Supplied contract note -> RECONCILED
    const recon = reconcileDhanContractNotes([
      {
        contractNoteId: "CN-001",
        tradeDate: "2026-11-18",
        symbol: "INFY",
        segment: "EQUITY_DELIVERY",
        buyPriceInr: 1000,
        sellPriceInr: 1050,
        quantity: 100,
        actualBrokerageInr: 0,
        actualSttInr: 205,
        actualExchangeChargesInr: 6.29,
        actualSebiChargesInr: 0.21,
        actualStampDutyInr: 15,
        actualGstInr: 1.17,
        actualDpChargesInr: 14.75,
        actualOtherChargesInr: 0,
      },
    ]);
    expect(recon.status).toBe("RECONCILED");
    expect(Math.abs(recon.totalVarianceInr)).toBeLessThan(1);
  });
});

