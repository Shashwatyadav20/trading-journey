import { describe, it, expect, beforeEach } from "vitest";
import { InstrumentMasterResolver } from "../broker/InstrumentMasterResolver";

describe("Phase 18 — Dynamic Provider Lot Size Verification Test Suite", () => {
  let resolver: InstrumentMasterResolver;

  beforeEach(() => {
    resolver = new InstrumentMasterResolver(75);
  });

  it("1. Treats provider-reported lot size as source of truth for contract resolution", () => {
    const verification = resolver.verifyLotSizeFromProvider(75);

    expect(verification.verified).toBe(true);
    expect(verification.currentLotSize).toBe(75);
    expect(resolver.getCurrentProviderLotSize()).toBe(75);

    const resolved = resolver.resolveInstrument("NIFTY", "2026-09-25T00:00:00.000Z", 24700, "CE");
    expect(resolved.valid).toBe(true);
    expect(resolved.instrument?.lotSize).toBe(75);
  });

  it("2. Fails verification and sets LOT_SIZE_UNVERIFIED when provider returns null or zero", () => {
    const verification = resolver.verifyLotSizeFromProvider(null);

    expect(verification.verified).toBe(false);
    expect(verification.reason).toBe("LOT_SIZE_UNVERIFIED");
    expect(verification.currentLotSize).toBeNull();
    expect(resolver.getCurrentProviderLotSize()).toBeNull();
  });

  it("3. Dynamically updates resolver lot size when provider lot size changes", () => {
    resolver.verifyLotSizeFromProvider(75);
    expect(resolver.getLotSize()).toBe(75);

    // If exchange/provider changes lot size
    resolver.verifyLotSizeFromProvider(50);
    expect(resolver.getLotSize()).toBe(50);

    const resolved = resolver.resolveInstrument("NIFTY", "2026-09-25T00:00:00.000Z", 24700, "PE");
    expect(resolved.instrument?.lotSize).toBe(50);
  });
});
