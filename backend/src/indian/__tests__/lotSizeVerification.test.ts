import { describe, it, expect, beforeEach } from "vitest";
import { InstrumentMasterResolver } from "../broker/InstrumentMasterResolver";

describe("Phase 17 — Lot Size Live Verification Test Suite", () => {
  let resolver: InstrumentMasterResolver;

  beforeEach(() => {
    resolver = new InstrumentMasterResolver(65);
  });

  it("1. Fails lot size verification when provider lot size is null (unverified)", () => {
    const res = resolver.verifyLotSizeFromProvider(null);
    expect(res.verified).toBe(false);
    expect(res.reason).toBe("LOT_SIZE_UNVERIFIED");
  });

  it("2. Fails lot size verification when provider lot size is null or invalid", () => {
    const res = resolver.verifyLotSizeFromProvider(null);
    expect(res.verified).toBe(false);
    expect(res.reason).toBe("LOT_SIZE_UNVERIFIED");
    expect(res.currentLotSize).toBeNull();
  });


  it("3. Passes lot size verification when provider lot size matches configured lot size", () => {
    resolver.setLotSize(75); // Updated config to 75
    const res = resolver.verifyLotSizeFromProvider(75);
    expect(res.verified).toBe(true);
    expect(res.reason).toBeNull();
    expect(res.currentLotSize).toBe(75);
  });

  it("4. Ensures NIFTY contract strikes resolve correctly with updated lot size", () => {
    resolver.setLotSize(75);
    const resolved = resolver.resolveInstrument("NIFTY", "2026-09-25T00:00:00.000Z", 24700, "CE");
    expect(resolved.valid).toBe(true);
    expect(resolved.instrument?.lotSize).toBe(75);
  });
});
