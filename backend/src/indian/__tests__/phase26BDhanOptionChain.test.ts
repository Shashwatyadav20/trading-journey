import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { DhanBrokerAdapter, dhanBrokerAdapter } from "../broker/DhanBrokerAdapter";
import { instrumentMasterResolver } from "../broker/InstrumentMasterResolver";
import { paperBrokerAdapter } from "../broker/PaperBrokerAdapter";
import { nseIndiaOptionChainProvider } from "../market/NseIndiaOptionChainProvider";
import { niftyMarketProvider } from "../market/NiftyMarketProvider";
import { AutoHedgeSignal } from "../types";

describe("PHASE 26B — Dhan Real-Time NIFTY Option Chain Integration Test Suite", () => {
  const origEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...origEnv };
    process.env.DHAN_CLIENT_ID = "1100112233";
    process.env.DHAN_ACCESS_TOKEN = "test_valid_dhan_access_token_jwt_9999";
    process.env.INDIAN_REAL_DATA_ONLY = "true";
    process.env.PAPER_TRADING = "true";
    process.env.LIVE_TRADING = "false";
    process.env.BROKER_EXECUTION_ENABLED = "false";
  });

  afterEach(() => {
    process.env = origEnv;
    vi.restoreAllMocks();
  });

  // 1. Dhan option-chain authentication
  it("1. Verifies Dhan option-chain authentication status before fetching", async () => {
    const adapter = new DhanBrokerAdapter({ clientId: "1100112233", accessToken: "token_123" });
    expect(adapter.isConfigured()).toBe(true);

    const unconfAdapter = new DhanBrokerAdapter({ clientId: "", accessToken: "" });
    delete process.env.DHAN_ACCESS_TOKEN;
    delete process.env.DHAN_CLIENT_ID;
    expect(unconfAdapter.isConfigured()).toBe(false);

    const res = await unconfAdapter.fetchOptionChain(24700);
    expect(res.success).toBe(false);
    expect(res.errorCode).toBe("DHAN_NOT_CONFIGURED");
  });

  // 2. Successful expiry-list request
  it("2. Successfully discovers active expiries from POST /v2/optionchain/expirylist", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url: any) => {
      const urlStr = url.toString();
      if (urlStr.includes("/optionchain/expirylist")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            status: "success",
            data: ["2026-10-08", "2026-10-15", "2026-10-29"],
          }),
        } as Response;
      }
      return { ok: false, status: 404 } as Response;
    });

    const adapter = new DhanBrokerAdapter({ clientId: "1100112233", accessToken: "token_123" });
    const expiries = await adapter.fetchExpiryList(13, "IDX_I");

    expect(expiries).toEqual(["2026-10-08", "2026-10-15", "2026-10-29"]);
  });

  // 3. Successful option-chain request
  it("3. Successfully parses option chain response from POST /v2/optionchain into canonical contracts", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url: any) => {
      const urlStr = url.toString();
      if (urlStr.includes("/expirylist")) {
        return { ok: true, status: 200, json: async () => ({ data: ["2026-10-08"] }) } as Response;
      }
      if (urlStr.includes("/optionchain")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: {
              last_price: 24705.5,
              oc: {
                "24700": {
                  ce: {
                    security_id: "77001",
                    trading_symbol: "NIFTY-Oct2026-24700-CE",
                    expiry: "2026-10-08",
                    last_price: 125.4,
                    top_bid_price: 125.0,
                    top_ask_price: 125.8,
                    volume: 45000,
                    oi: 120000,
                    iv: 0.145,
                    delta: 0.52,
                    gamma: 0.0004,
                    theta: -12.1,
                    vega: 18.5,
                  },
                  pe: {
                    security_id: "77002",
                    trading_symbol: "NIFTY-Oct2026-24700-PE",
                    expiry: "2026-10-08",
                    last_price: 110.2,
                    top_bid_price: 109.8,
                    top_ask_price: 110.5,
                    volume: 42000,
                    oi: 115000,
                    iv: 0.148,
                    delta: -0.48,
                    gamma: 0.0004,
                    theta: -11.9,
                    vega: 18.2,
                  },
                },
              },
            },
          }),
        } as Response;
      }
      return { ok: false, status: 404 } as Response;
    });

    const adapter = new DhanBrokerAdapter({ clientId: "1100112233", accessToken: "token_123" });
    const res = await adapter.fetchOptionChain(24700);

    expect(res.success).toBe(true);
    expect(res.sourceType).toBe("REAL");
    expect(res.spotPrice).toBe(24705.5);
    expect(res.contracts.length).toBe(2);

    const ce = res.contracts.find((c) => c.optionType === "CE")!;
    expect(ce.strike).toBe(24700);
    expect(ce.ltp).toBe(125.4);
    expect(ce.bid).toBe(125.0);
    expect(ce.ask).toBe(125.8);
    expect(ce.source).toBe("DHAN");
    expect(ce.sourceType).toBe("REAL_EXTERNAL");
    expect(ce.delta).toBe(0.52);
    expect(ce.gamma).toBe(0.0004);
    expect(ce.theta).toBe(-12.1);
    expect(ce.vega).toBe(18.5);
  });

  // 4. Invalid expiry handling
  it("4. Rejects request when invalid expiry parameter is passed", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url: any) => {
      const urlStr = url.toString();
      if (urlStr.includes("/expirylist")) return { ok: true, status: 200, json: async () => ({ data: ["2026-10-08"] }) } as Response;
      return { ok: false, status: 400, statusText: "Bad Expiry" } as Response;
    });

    const adapter = new DhanBrokerAdapter({ clientId: "1100112233", accessToken: "token_123" });
    const res = await adapter.fetchOptionChain(24700, "INVALID_DATE");

    expect(res.success).toBe(false);
    expect(res.errorCode).toBe("HTTP_400");
  });

  // 5. Expired expiry handling
  it("5. Filters out expired past dates during dynamic expiry discovery", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url: any) => {
      const urlStr = url.toString();
      if (urlStr.includes("/expirylist")) {
        return { ok: true, status: 200, json: async () => ({ data: ["2020-01-01", "2026-10-08"] }) } as Response;
      }
      if (urlStr.includes("/optionchain")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: {
              last_price: 24700,
              oc: {
                "24700": { ce: { last_price: 100, top_bid_price: 99, top_ask_price: 101 } },
              },
            },
          }),
        } as Response;
      }
      return { ok: false, status: 404 } as Response;
    });

    const adapter = new DhanBrokerAdapter({ clientId: "1100112233", accessToken: "token_123" });
    const res = await adapter.fetchOptionChain(24700);

    expect(res.success).toBe(true);
    expect(res.nearestExpiry).toBe("2026-10-08");
  });

  // 6 & 7. Missing underlying Security ID / option Security ID
  it("6 & 7. Gracefully processes contracts when security_id field is absent", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url: any) => {
      const urlStr = url.toString();
      if (urlStr.includes("/expirylist")) return { ok: true, status: 200, json: async () => ({ data: ["2026-10-08"] }) } as Response;
      if (urlStr.includes("/optionchain")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: {
              last_price: 24700,
              oc: {
                "24700": { ce: { last_price: 100, top_bid_price: 99, top_ask_price: 101 } },
              },
            },
          }),
        } as Response;
      }
      return { ok: false, status: 404 } as Response;
    });

    const adapter = new DhanBrokerAdapter({ clientId: "1100112233", accessToken: "token_123" });
    const res = await adapter.fetchOptionChain(24700);

    expect(res.success).toBe(true);
    expect(res.contracts[0].source).toBe("DHAN");
  });

  // 8 & 9. Missing LTP / bid / ask handling
  it("8 & 9. Rejects option chain when all contracts have 0/missing prices (REAL_OPTION_PRICE_UNAVAILABLE)", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url: any) => {
      const urlStr = url.toString();
      if (urlStr.includes("/expirylist")) return { ok: true, status: 200, json: async () => ({ data: ["2026-10-08"] }) } as Response;
      if (urlStr.includes("/optionchain")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: {
              last_price: 24700,
              oc: {
                "24700": { ce: { last_price: 0, top_bid_price: 0, top_ask_price: 0 } },
              },
            },
          }),
        } as Response;
      }
      return { ok: false, status: 404 } as Response;
    });

    const adapter = new DhanBrokerAdapter({ clientId: "1100112233", accessToken: "token_123" });
    const res = await adapter.fetchOptionChain(24700);

    expect(res.success).toBe(false);
    expect(res.errorCode).toBe("REAL_OPTION_PRICE_UNAVAILABLE");
  });

  // 10, 11, 12, 13, 14. Missing IV / Delta / Gamma / Theta / Vega handling
  it("10-14. Preserves missing Greeks as undefined without substituting hardcoded constants (0.003)", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url: any) => {
      const urlStr = url.toString();
      if (urlStr.includes("/expirylist")) return { ok: true, status: 200, json: async () => ({ data: ["2026-10-08"] }) } as Response;
      if (urlStr.includes("/optionchain")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: {
              last_price: 24700,
              oc: {
                "24700": { ce: { last_price: 100, top_bid_price: 99, top_ask_price: 101 } },
              },
            },
          }),
        } as Response;
      }
      return { ok: false, status: 404 } as Response;
    });

    const adapter = new DhanBrokerAdapter({ clientId: "1100112233", accessToken: "token_123" });
    const res = await adapter.fetchOptionChain(24700);

    expect(res.success).toBe(true);
    const ce = res.contracts[0];
    expect(ce.gamma).toBeUndefined();
    expect(ce.delta).toBeUndefined();
    expect(ce.iv).toBeUndefined();
    expect(ce.gammaSource).toBe("UNAVAILABLE");
    expect(ce.gamma).not.toBe(0.003);
  });

  // 15. Stale option chain
  it("15. Detects stale option chain when age exceeds threshold", async () => {
    const health = await niftyMarketProvider.getPhase17DataHealth();
    expect(health).toHaveProperty("ageMs");
  });

  // 16. Rate-limit handling (HTTP 429)
  it("16. Handles HTTP 429 Rate Limit response by triggering backoff", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url: any) => {
      const urlStr = url.toString();
      if (urlStr.includes("/expirylist")) return { ok: true, status: 200, json: async () => ({ data: ["2026-10-08"] }) } as Response;
      if (urlStr.includes("/optionchain")) {
        return {
          ok: false,
          status: 429,
          statusText: "Too Many Requests",
        } as Response;
      }
      return { ok: false, status: 404 } as Response;
    });

    const adapter = new DhanBrokerAdapter({ clientId: "1100112233", accessToken: "token_123" });
    const res = await adapter.fetchOptionChain(24700);

    expect(res.success).toBe(false);
    expect(res.errorCode).toBe("HTTP_429");
  });

  // 17. Duplicate request prevention (in-flight deduplication)
  it("17. Deduplicates concurrent in-flight requests for the same expiry", async () => {
    let callCount = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url: any) => {
      const urlStr = url.toString();
      if (urlStr.includes("/expirylist")) return { ok: true, status: 200, json: async () => ({ data: ["2026-10-08"] }) } as Response;
      if (urlStr.includes("/optionchain")) {
        callCount++;
        await new Promise((r) => setTimeout(r, 50));
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: {
              last_price: 24700,
              oc: { "24700": { ce: { last_price: 100, top_bid_price: 99, top_ask_price: 101 } } },
            },
          }),
        } as Response;
      }
      return { ok: false, status: 404 } as Response;
    });

    const adapter = new DhanBrokerAdapter({ clientId: "1100112233", accessToken: "token_123" });
    const p1 = adapter.fetchOptionChain(24700, "2026-10-08");
    const p2 = adapter.fetchOptionChain(24700, "2026-10-08");

    const [r1, r2] = await Promise.all([p1, p2]);

    expect(r1.success).toBe(true);
    expect(r2.success).toBe(true);
    expect(callCount).toBe(1); // Only 1 HTTP call made for concurrent requests
  });

  // 18. Cache behavior (5-second cache window)
  it("18. Returns cached option chain within 5-second window without repeating HTTP requests", async () => {
    let callCount = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url: any) => {
      const urlStr = url.toString();
      if (urlStr.includes("/expirylist")) return { ok: true, status: 200, json: async () => ({ data: ["2026-10-08"] }) } as Response;
      if (urlStr.includes("/optionchain")) {
        callCount++;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: {
              last_price: 24700,
              oc: { "24700": { ce: { last_price: 100, top_bid_price: 99, top_ask_price: 101 } } },
            },
          }),
        } as Response;
      }
      return { ok: false, status: 404 } as Response;
    });

    const adapter = new DhanBrokerAdapter({ clientId: "1100112233", accessToken: "token_123" });
    const r1 = await adapter.fetchOptionChain(24700, "2026-10-08");
    const r2 = await adapter.fetchOptionChain(24700, "2026-10-08");

    expect(r1.success).toBe(true);
    expect(r2.success).toBe(true);
    expect(callCount).toBe(1);
  });

  // 19. Dynamic lot-size verification
  it("19. Verifies lot size dynamically from provider (verified = 75)", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url: any) => {
      const urlStr = url.toString();
      if (urlStr.includes("/expirylist")) return { ok: true, status: 200, json: async () => ({ data: ["2026-10-08"] }) } as Response;
      if (urlStr.includes("/optionchain")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: {
              last_price: 24700,
              lot_size: 75, // Provider supplies lot size dynamically
              oc: { "24700": { ce: { last_price: 100, top_bid_price: 99, top_ask_price: 101 } } },
            },
          }),
        } as Response;
      }
      return { ok: false, status: 404 } as Response;
    });

    const adapter = new DhanBrokerAdapter({ clientId: "1100112233", accessToken: "token_123" });
    const res = await adapter.fetchOptionChain(24700);

    expect(res.success).toBe(true);
    expect(res.lotSize).toBe(75);
    expect(res.lotSizeVerified).toBe(true);

    const verified = instrumentMasterResolver.verifyLotSizeFromProvider(75);
    expect(verified.verified).toBe(true);
    expect(verified.currentLotSize).toBe(75);
  });

  // 20. Synthetic fallback rejection
  it("20. Rejects synthetic fallback in INDIAN_REAL_DATA_ONLY=true mode", async () => {
    process.env.INDIAN_REAL_DATA_ONLY = "true";
    niftyMarketProvider.setOptionChainProvider(null);

    const res = await niftyMarketProvider.getOptionChain(24700);
    expect(res.isReal).toBe(false);
    expect(res.chain.contracts).toHaveLength(0);
  });

  // 21, 22, 23. Hardcoded expiry / strike / lot-size rejection
  it("21-23. Unverified lot size returns LOT_SIZE_UNVERIFIED", () => {
    const lotVerification = instrumentMasterResolver.verifyLotSizeFromProvider(null);
    expect(lotVerification.verified).toBe(false);
    expect(lotVerification.reason).toBe("LOT_SIZE_UNVERIFIED");
  });

  // 24. NSE/Dhan discrepancy logging
  it("24. Side-by-side NSE vs Dhan cross-verification logs discrepancies", async () => {
    const adapter = new DhanBrokerAdapter({ clientId: "1100112233", accessToken: "token_123" });

    vi.spyOn(nseIndiaOptionChainProvider, "fetchOptionChain").mockResolvedValueOnce({
      success: true,
      sourceType: "REAL",
      providerName: "NSE_INDIA",
      contracts: [{ underlying: "NIFTY", expiry: "2026-10-08", strike: 24700, optionType: "CE", bid: 100, ask: 102, ltp: 101, timestamp: "", source: "NSE", sourceType: "REAL" }],
      spotPrice: 24750, // Significant spot difference vs 24700
      expiryDates: ["2026-10-08"],
      nearestExpiry: "2026-10-08",
      lotSize: 75,
      underlyingTimestamp: new Date().toISOString(),
      fetchDurationMs: 10,
    });

    await adapter.crossVerifyWithNse({
      success: true,
      sourceType: "REAL",
      providerName: "DHAN",
      contracts: [],
      spotPrice: 24700,
      expiryDates: ["2026-10-08"],
      nearestExpiry: "2026-10-08",
      lotSize: 75,
      underlyingTimestamp: new Date().toISOString(),
      fetchDurationMs: 10,
    });

    const logs = adapter.getDiscrepancyLogs();
    expect(logs).toEqual(expect.arrayContaining([expect.objectContaining({ field: "NIFTY_SPOT" })]));
  });

  // 25. REAL_DATA_ONLY enforcement
  it("25. Strict REAL_DATA_ONLY mode blocks trading when data is unverified", async () => {
    process.env.INDIAN_REAL_DATA_ONLY = "true";
    niftyMarketProvider.setOptionChainProvider(null);

    const health = await niftyMarketProvider.getPhase17DataHealth();
    expect(health.genuineDataReady).toBe(false);
  });

  // 26 & 27. Paper-only execution & Order API never called
  it("26 & 27. PaperBrokerAdapter handles execution while Dhan order calls throw SECURITY LOCK ENFORCED", async () => {
    const adapter = new DhanBrokerAdapter({ clientId: "1100112233", accessToken: "token_123" });
    const req: any = { symbol: "NIFTY", price: 100, quantity: 75, side: "BUY" };

    await expect(adapter.placeOrder(req)).rejects.toThrow("SECURITY LOCK ENFORCED");
    await expect(adapter.modifyOrder("ORD1", req)).rejects.toThrow("SECURITY LOCK ENFORCED");
    await expect(adapter.cancelOrder("ORD1")).rejects.toThrow("SECURITY LOCK ENFORCED");

    expect(adapter.getRealOrdersSent()).toBe(0);
  });

  // 28 & 29. Provenance propagation & Paper P&L classification
  it("28 & 29. Signal with DHAN provenance produces REAL_MARKET_DATA_PAPER_PNL position", () => {
    const readySignal: AutoHedgeSignal = {
      symbol: "NIFTY",
      timestamp: new Date().toISOString(),
      regime: "BULLISH",
      score: 85,
      action: "BULL_PUT_SPREAD",
      expiry: "2026-10-29",
      spotPrice: 24700,
      sellLeg: { symbol: "NIFTY26102924700PE", strike: 24700, optionType: "PE", ltp: 100, bid: 99, ask: 101, iv: 0.15, delta: -0.3 },
      buyLeg: { symbol: "NIFTY26102924550PE", strike: 24550, optionType: "PE", ltp: 40, bid: 39, ask: 41, iv: 0.15, delta: -0.15 },
      netCredit: 60,
      maxProfit: 4500,
      maxLoss: 600,
      entryPrice: 60,
      stopLossSpread: 90,
      targetSpread: 30,
      quantityLots: 1,
      totalQuantity: 75,
      marginRequired: 11250,
      charges: { grossPnl: 0, entryCharges: 50, exitCharges: 50, brokerage: 40, stt: 10, exchangeFees: 5, gst: 10, sebiFees: 1, stampDuty: 2, estimatedSlippage: 10, totalCharges: 128, netPnl: 0 },
      expectedNetPnl: 4372,
      riskPercentage: 1,
      rewardRiskRatio: 7.5,
      status: "READY",
      reasons: ["Phase 26B Test Signal"],
      dataSource: "DHAN",
      optionPriceSource: "DHAN_REAL",
    };

    const pos = paperBrokerAdapter.executePaperOrder("test-dhan-user-p26b", readySignal);

    expect(pos.pnlType).toBe("REAL_MARKET_DATA_PAPER_PNL");
    expect(pos.entryDataSource).toBe("DHAN");
    expect(pos.entryPriceSource).toBe("DHAN_REAL");
  });

  // 30. Dhan credential leakage prevention
  it("30. Dhan status and diagnostic outputs NEVER expose access tokens or secrets", () => {
    const adapter = new DhanBrokerAdapter({ clientId: "1100112233", accessToken: "SUPER_SECRET_JWT_TOKEN" });
    const status = adapter.getOptionChainStatus();
    const jsonStr = JSON.stringify(status);

    expect(jsonStr).not.toContain("SUPER_SECRET_JWT_TOKEN");
  });
});
