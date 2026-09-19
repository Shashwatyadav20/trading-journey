import { describe, it, expect, beforeEach, vi } from "vitest";
import { GenuineDataValidator } from "../validation/GenuineDataValidator";
import { niftyMarketProvider } from "../market/NiftyMarketProvider";
import { nseIndiaOptionChainProvider } from "../market/NseIndiaOptionChainProvider";
import { instrumentMasterResolver } from "../broker/InstrumentMasterResolver";

describe("Phase 18 — 7-Criterion Operational Session Gate Test Suite", () => {
  let validator: GenuineDataValidator;

  beforeEach(() => {
    const now = Date.now();
    validator = new GenuineDataValidator(60000);
    validator.setForcedMarketSession("MARKET_OPEN");
    niftyMarketProvider.updateSpotPrice(24700.5, true, now);
    instrumentMasterResolver.verifyLotSizeFromProvider(75);

    vi.spyOn(nseIndiaOptionChainProvider, "getProviderHealth").mockReturnValue({
      isConfigured: true,
      isAuthenticated: true,
      lastFetchMs: now,
      lastSuccessMs: now - 2000,
      consecutiveFailures: 0,
      currentBackoffMs: 0,
      providerName: "NSE_INDIA",
      status: "OK",
    });
  });


  it("1. Evaluates sessionGate as READY when all 7 strict criteria are met", async () => {
    const now = Date.now();
    niftyMarketProvider.updateSpotPrice(24700.5, true, now);

    vi.spyOn(nseIndiaOptionChainProvider, "getProviderHealth").mockReturnValue({
      isConfigured: true,
      isAuthenticated: true,
      lastFetchMs: now,
      lastSuccessMs: now - 2000,
      consecutiveFailures: 0,
      currentBackoffMs: 0,
      providerName: "NSE_INDIA",
      status: "OK",
    });

    const gate = await validator.evaluatePhase18OperationalGate();

    expect(gate.sessionGate).toBe("READY");
    expect(gate.realSpot).toBe(true);
    expect(gate.realOptionChain).toBe(true);
    expect(gate.realOptionPrices).toBe(true);
    expect(gate.dataNotStale).toBe(true);
    expect(gate.lotSizeVerified).toBe(true);
    expect(gate.marketSessionValid).toBe(true);
    expect(gate.safetyLocksValid).toBe(true);
    expect(gate.blockedReason).toBeNull();
  });

  it("2. Blocks sessionGate when spot price is synthetic", async () => {
    niftyMarketProvider.updateSpotPrice(24700.5, false, Date.now());

    const gate = await validator.evaluatePhase18OperationalGate();

    expect(gate.sessionGate).toBe("BLOCKED");
    expect(gate.realSpot).toBe(false);
    expect(gate.blockedReason).toBe("REAL_SPOT_UNAVAILABLE");
  });

  it("3. Blocks sessionGate when market session is closed or pre-market", async () => {
    validator.setForcedMarketSession("MARKET_CLOSED");

    const gate = await validator.evaluatePhase18OperationalGate();

    expect(gate.sessionGate).toBe("BLOCKED");
    expect(gate.marketSessionValid).toBe(false);
    expect(gate.blockedReason).toContain("MARKET_SESSION_INVALID");
  });

  it("4. Blocks sessionGate when lot size is unverified", async () => {
    vi.spyOn(instrumentMasterResolver, "verifyLotSizeFromProvider").mockReturnValue({
      verified: false,
      reason: "LOT_SIZE_UNVERIFIED",
      currentLotSize: null,
    });

    const gate = await validator.evaluatePhase18OperationalGate();

    expect(gate.sessionGate).toBe("BLOCKED");
    expect(gate.lotSizeVerified).toBe(false);
    expect(gate.blockedReason).toBe("LOT_SIZE_UNVERIFIED");
  });
});
