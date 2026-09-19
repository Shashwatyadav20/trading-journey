import { describe, it, expect, beforeEach, vi } from "vitest";
import { Phase18DataFreshnessMonitor } from "../market/Phase18DataFreshnessMonitor";
import { niftyMarketProvider } from "../market/NiftyMarketProvider";
import { nseIndiaOptionChainProvider } from "../market/NseIndiaOptionChainProvider";

describe("Phase 18 — Data Freshness Monitor Test Suite", () => {
  let monitor: Phase18DataFreshnessMonitor;

  beforeEach(() => {
    monitor = new Phase18DataFreshnessMonitor(60000);
  });

  it("1. Evaluates overall status as MISSING when option chain has never been successfully fetched", async () => {
    vi.spyOn(nseIndiaOptionChainProvider, "getProviderHealth").mockReturnValue({
      isConfigured: true,
      isAuthenticated: false,
      lastFetchMs: 0,
      lastSuccessMs: 0,
      consecutiveFailures: 0,
      currentBackoffMs: 0,
      providerName: "NSE_INDIA",
      status: "NOT_CONFIGURED",
    });

    const metrics = await monitor.getFreshnessMetrics();

    expect(metrics.optionChain.status).toBe("MISSING");
    expect(metrics.optionPrices.status).toBe("MISSING");
    expect(metrics.overallStatus).toBe("MISSING");
  });

  it("2. Evaluates overall status as HEALTHY when spot and option chain are fresh and real", async () => {
    const now = Date.now();
    niftyMarketProvider.updateSpotPrice(24700.5, true, now);

    vi.spyOn(nseIndiaOptionChainProvider, "getProviderHealth").mockReturnValue({
      isConfigured: true,
      isAuthenticated: true,
      lastFetchMs: now,
      lastSuccessMs: now - 5000, // 5s ago
      consecutiveFailures: 0,
      currentBackoffMs: 0,
      providerName: "NSE_INDIA",
      status: "OK",
    });

    const metrics = await monitor.getFreshnessMetrics();

    expect(metrics.spot.status).toBe("HEALTHY");
    expect(metrics.optionChain.status).toBe("HEALTHY");
    expect(metrics.optionPrices.status).toBe("HEALTHY");
    expect(metrics.overallStatus).toBe("HEALTHY");
  });

  it("3. Evaluates component status as STALE when age exceeds stale threshold", async () => {
    const now = Date.now();
    const staleTime = now - 70000; // 70s ago (threshold 60s)
    niftyMarketProvider.updateSpotPrice(24700.5, true, staleTime);

    vi.spyOn(nseIndiaOptionChainProvider, "getProviderHealth").mockReturnValue({
      isConfigured: true,
      isAuthenticated: true,
      lastFetchMs: staleTime,
      lastSuccessMs: staleTime,
      consecutiveFailures: 0,
      currentBackoffMs: 0,
      providerName: "NSE_INDIA",
      status: "OK",
    });

    const metrics = await monitor.getFreshnessMetrics();

    expect(metrics.spot.status).toBe("STALE");
    expect(metrics.optionChain.status).toBe("STALE");
    expect(metrics.overallStatus).toBe("STALE");
  });
});
