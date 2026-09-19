import { describe, it, expect, beforeEach, vi } from "vitest";
import { NseIndiaOptionChainProvider } from "../market/NseIndiaOptionChainProvider";

describe("Phase 18 — Provider Fault Injection & Connection Reliability Test Suite", () => {
  let provider: NseIndiaOptionChainProvider;

  beforeEach(() => {
    provider = new NseIndiaOptionChainProvider(60000);
  });

  it("1. Handles HTTP 503 error cleanly without crash", async () => {
    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes("option-chain")) {
        return Promise.resolve({
          ok: false,
          status: 503,
          statusText: "Service Unavailable",
        });
      }
      return Promise.resolve({ ok: true, headers: new Headers() });
    });

    const result = await provider.fetchOptionChain(24700);

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe("HTTP_503");
    expect(result.contracts.length).toBe(0);

    global.fetch = originalFetch;
  });

  it("2. Handles request timeout gracefully", async () => {
    const originalFetch = global.fetch;
    const timeoutErr = new Error("Request timed out");
    timeoutErr.name = "TimeoutError";
    global.fetch = vi.fn().mockRejectedValue(timeoutErr);

    const result = await provider.fetchOptionChain(24700);

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe("TIMEOUT");

    global.fetch = originalFetch;
  });

  it("3. Increments backoff levels on consecutive failures", async () => {
    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockRejectedValue(new Error("Connection reset"));

    await provider.fetchOptionChain(24700);
    let health = provider.getProviderHealth();
    expect(health.consecutiveFailures).toBe(1);

    await provider.fetchOptionChain(24700);
    health = provider.getProviderHealth();
    expect(health.consecutiveFailures).toBe(2);
    expect(health.currentBackoffMs).toBe(60000);

    global.fetch = originalFetch;
  });
});
