import { describe, it, expect, beforeEach } from "vitest";
import { niftyMarketProvider } from "../market/NiftyMarketProvider";
import { nseIndiaOptionChainProvider } from "../market/NseIndiaOptionChainProvider";
import { phase17PaperSessionTracker } from "../lifecycle/Phase17PaperSessionTracker";
import { genuineDataValidator } from "../validation/GenuineDataValidator";

describe("Phase 17 — API Endpoints & Health Integration Test Suite", () => {
  beforeEach(() => {
    phase17PaperSessionTracker.resetSession();
  });

  it("1. GET /api/indian/genuine-data/status payload validation", async () => {
    const health = await niftyMarketProvider.getPhase17DataHealth();
    const gate = await genuineDataValidator.evaluatePhase17Gate();

    expect(health).toHaveProperty("spot");
    expect(health).toHaveProperty("optionChain");
    expect(health).toHaveProperty("optionPrices");
    expect(health).toHaveProperty("genuineDataReady");

    expect(gate).toHaveProperty("genuineDataReady");
    expect(gate).toHaveProperty("blockedReason");
    expect(gate).toHaveProperty("lotSizeVerified");
  });

  it("2. GET /api/indian/genuine-data/provider payload validation", () => {
    const providerHealth = nseIndiaOptionChainProvider.getProviderHealth();

    expect(providerHealth.providerName).toBe("NSE_INDIA");
    expect(providerHealth.isConfigured).toBe(true);
    expect(providerHealth).toHaveProperty("status");
    expect(providerHealth).toHaveProperty("consecutiveFailures");
  });

  it("3. GET /api/indian/paper/session/phase17 payload validation", () => {
    phase17PaperSessionTracker.updateDataSources("REAL", "REAL", "REAL", "NSE_INDIA");
    phase17PaperSessionTracker.recordSignal("DATA_STALE");

    const session = phase17PaperSessionTracker.getCurrentSession();

    expect(session.dataSource).toBe("NSE_INDIA");
    expect(session.isGenuinePaperSample).toBe(true);
    expect(session.dataGate).toBe("READY");
    expect(session.signals).toBe(1);
    expect(session.noTradeReasons["DATA_STALE"]).toBe(1);
  });

  it("4. GET /api/indian/data-health includes phase17Health payload", async () => {
    const legacyHealth = niftyMarketProvider.getDataHealth();
    const phase17Health = await niftyMarketProvider.getPhase17DataHealth();
    const gate = await genuineDataValidator.evaluatePhase17Gate();

    expect(legacyHealth).toHaveProperty("isHealthy");
    expect(phase17Health).toHaveProperty("genuineDataReady");
    expect(gate).toHaveProperty("lotSizeVerified");
  });
});
