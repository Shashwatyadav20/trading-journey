import { describe, it, expect, beforeEach, vi } from "vitest";
import { NiftyMarketProvider } from "../market/NiftyMarketProvider";
import { GenuineDataValidator } from "../validation/GenuineDataValidator";
import { INiftyOptionChainProvider, OptionChainFetchResult } from "../market/INiftyOptionChainProvider";

describe("Phase 17 — Genuine Data Integration & Hard Gate Test Suite", () => {
  let mockChainProvider: INiftyOptionChainProvider;
  let marketProvider: NiftyMarketProvider;
  let dataValidator: GenuineDataValidator;

  beforeEach(() => {
    mockChainProvider = {
      getProviderName: () => "MOCK_NSE",
      isConfigured: () => true,
      fetchOptionChain: vi.fn(),
      getProviderHealth: vi.fn(),
    };

    marketProvider = new NiftyMarketProvider(60000, mockChainProvider);
    dataValidator = new GenuineDataValidator(60000);
  });

  it("1. Blocks Phase 17 data gate when option chain is synthetic or missing", async () => {
    vi.spyOn(mockChainProvider, "fetchOptionChain").mockResolvedValue({
      success: false,
      sourceType: "INVALID",

      providerName: "MOCK_NSE",
      contracts: [],
      spotPrice: null,
      expiryDates: [],
      nearestExpiry: null,
      lotSize: null,
      underlyingTimestamp: null,
      fetchDurationMs: 10,
      errorMessage: "NSE offline",
    });

    vi.spyOn(mockChainProvider, "getProviderHealth").mockReturnValue({
      isConfigured: true,
      isAuthenticated: false,
      lastFetchMs: Date.now(),
      lastSuccessMs: 0,
      consecutiveFailures: 1,
      currentBackoffMs: 30000,
      providerName: "MOCK_NSE",
      status: "DEGRADED",
      errorMessage: "NSE offline",
    });

    const chainRes = await marketProvider.getOptionChain(24700);
    expect(chainRes.isReal).toBe(false);
    expect(chainRes.chain.contracts.length).toBe(0);

    const health = await marketProvider.getPhase17DataHealth();
    expect(health.genuineDataReady).toBe(false);
    expect(health.blockedReason).not.toBeNull();
  });

  it("2. Opens Phase 17 data gate when spot and option chain are genuine REAL data", async () => {
    marketProvider.updateSpotPrice(24700.5, true, Date.now());

    vi.spyOn(mockChainProvider, "fetchOptionChain").mockResolvedValue({
      success: true,
      sourceType: "REAL",
      providerName: "MOCK_NSE",
      contracts: [
        {
          underlying: "NIFTY",
          expiry: "2026-09-25",
          strike: 24700,
          optionType: "CE",
          bid: 149.5,
          ask: 150.5,
          ltp: 150.0,
          timestamp: new Date().toISOString(),
          source: "MOCK_NSE",
          sourceType: "REAL",
          iv: 14.5,
          ivSource: "REAL",
        },
      ],
      spotPrice: 24700.5,
      expiryDates: ["2026-09-25"],
      nearestExpiry: "2026-09-25",
      lotSize: 75,
      underlyingTimestamp: new Date().toISOString(),
      fetchDurationMs: 50,
    });

    vi.spyOn(mockChainProvider, "getProviderHealth").mockReturnValue({
      isConfigured: true,
      isAuthenticated: true,
      lastFetchMs: Date.now(),
      lastSuccessMs: Date.now(),
      consecutiveFailures: 0,
      currentBackoffMs: 0,
      providerName: "MOCK_NSE",
      status: "OK",
    });

    const chainRes = await marketProvider.getOptionChain(24700.5);
    expect(chainRes.isReal).toBe(true);
    expect(chainRes.chain.contracts.length).toBe(1);

    const health = await marketProvider.getPhase17DataHealth();
    expect(health.genuineDataReady).toBe(true);
    expect(health.blockedReason).toBeNull();
  });

  it("3. Strict Fail-Closed: Does NOT fall back to synthetic data when real fetch fails", async () => {
    vi.spyOn(mockChainProvider, "fetchOptionChain").mockResolvedValue({
      success: false,
      sourceType: "ERROR",
      providerName: "MOCK_NSE",
      contracts: [],
      spotPrice: null,
      expiryDates: [],
      nearestExpiry: null,
      lotSize: null,
      underlyingTimestamp: null,
      fetchDurationMs: 5,
      errorMessage: "NSE 503 Service Unavailable",
    });

    const chainRes = await marketProvider.getOptionChain(24700);

    // Must be marked isReal: false AND contracts must be empty (NO synthetic chain injected)
    expect(chainRes.isReal).toBe(false);
    expect(chainRes.chain.contracts.length).toBe(0);
  });
});
