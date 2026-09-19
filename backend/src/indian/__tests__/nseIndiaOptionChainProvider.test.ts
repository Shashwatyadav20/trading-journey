import { describe, it, expect, beforeEach, vi } from "vitest";
import { NseIndiaOptionChainProvider } from "../market/NseIndiaOptionChainProvider";

describe("Phase 17 — NSE India Option Chain Provider Test Suite", () => {
  let provider: NseIndiaOptionChainProvider;

  beforeEach(() => {
    provider = new NseIndiaOptionChainProvider(60000);
  });

  it("1. Provider Configuration & Health Check", () => {
    expect(provider.getProviderName()).toBe("NSE_INDIA");
    expect(provider.isConfigured()).toBe(true);

    const health = provider.getProviderHealth();
    expect(health.providerName).toBe("NSE_INDIA");
    expect(health.isConfigured).toBe(true);
    expect(health.consecutiveFailures).toBe(0);
  });

  it("2. Returns success=false when fetch fails (network timeout or offline)", async () => {
    // Mock global fetch to simulate timeout/error
    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockRejectedValue(new Error("Network connection refused"));

    const result = await provider.fetchOptionChain(24700);

    expect(result.success).toBe(false);
    expect(result.sourceType).toBe("INVALID");
    expect(result.contracts.length).toBe(0);

    expect(result.errorCode).toBe("NETWORK_ERROR");
    expect(result.errorMessage).toBe("Network connection refused");


    const health = provider.getProviderHealth();
    expect(health.consecutiveFailures).toBe(1);

    global.fetch = originalFetch;
  });

  it("3. Parses mock NSE response into CanonicalOptionContracts with explicit labels", async () => {
    const mockNseResponse = {
      records: {
        underlyingValue: 24700.5,
        timestamp: new Date().toISOString(),
        expiryDates: ["2026-09-25"],
        data: [
          {
            strikePrice: 24700,
            expiryDate: "25-Sep-2026",
            CE: {
              strikePrice: 24700,
              expiryDate: "25-Sep-2026",
              identifier: "OPTIDXNIFTY25092026CE24700",
              openInterest: 50000,
              changeinOpenInterest: 1000,
              pchangeinOpenInterest: 2.0,
              totalTradedVolume: 120000,
              impliedVolatility: 14.5,
              lastPrice: 150.0,
              change: 5.0,
              pChange: 3.4,
              totalBuyQuantity: 1000,
              totalSellQuantity: 1000,
              bidQty: 50,
              bidprice: 149.5,
              askQty: 50,
              askPrice: 150.5,
              underlyingValue: 24700.5,
            },
            PE: {
              strikePrice: 24700,
              expiryDate: "25-Sep-2026",
              identifier: "OPTIDXNIFTY25092026PE24700",
              openInterest: 45000,
              changeinOpenInterest: 500,
              pchangeinOpenInterest: 1.1,
              totalTradedVolume: 95000,
              impliedVolatility: 15.0,
              lastPrice: 140.0,
              change: -4.0,
              pChange: -2.7,
              totalBuyQuantity: 800,
              totalSellQuantity: 800,
              bidQty: 40,
              bidprice: 139.5,
              askQty: 40,
              askPrice: 140.5,
              underlyingValue: 24700.5,
            },
          },
        ],
      },
      filtered: {
        data: [{ CE: { lotSize: 75 }, PE: { lotSize: 75 } }],
      },
    };

    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes("option-chain")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockNseResponse),
          headers: new Headers(),
        });
      }
      return Promise.resolve({
        ok: true,
        headers: new Headers({ "set-cookie": "nse_session=abc123xyz; Path=/;" }),
      });
    });

    const result = await provider.fetchOptionChain(24700);

    expect(result.success).toBe(true);
    expect(result.sourceType).toBe("REAL");
    expect(result.contracts.length).toBe(2);
    expect(result.spotPrice).toBe(24700.5);
    expect(result.lotSize).toBe(75);

    const ce = result.contracts.find((c) => c.optionType === "CE");
    expect(ce).toBeDefined();
    expect(ce?.strike).toBe(24700);
    expect(ce?.ltp).toBe(150.0);
    expect(ce?.iv).toBe(14.5);
    expect(ce?.ivSource).toBe("REAL");
    expect(ce?.deltaSource).toBe("PROVIDER_DERIVED");
    expect(ce?.gamma).toBeUndefined(); // Absent (never fabricated)

    global.fetch = originalFetch;
  });

  it("4. Backoff progression on consecutive failures", async () => {
    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockRejectedValue(new Error("Server 500 Error"));

    await provider.fetchOptionChain(24700);
    let health = provider.getProviderHealth();
    expect(health.consecutiveFailures).toBe(1);

    await provider.fetchOptionChain(24700);
    health = provider.getProviderHealth();
    expect(health.consecutiveFailures).toBe(2);

    await provider.fetchOptionChain(24700);
    health = provider.getProviderHealth();
    expect(health.consecutiveFailures).toBe(3);
    expect(health.status).toBe("FAILED");

    global.fetch = originalFetch;
  });
});
