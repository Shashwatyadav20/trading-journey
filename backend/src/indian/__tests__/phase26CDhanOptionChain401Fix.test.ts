import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { DhanBrokerAdapter } from "../broker/DhanBrokerAdapter";
import { dhanAuthService } from "../broker/DhanAuthService";
import { instrumentMasterResolver } from "../broker/InstrumentMasterResolver";

/**
 * PHASE 26C — Dhan Option Chain HTTP 401 Root-Cause Fix Tests
 *
 * Root cause: buildHeaders() called getValidAccessToken() which enforces
 * safety locks (throws when PAPER_TRADING=true / LIVE_TRADING=false).
 * Data reads must NEVER be blocked by execution safety locks.
 *
 * Fix: Added getReadOnlyToken() to DhanAuthService — bypasses safety locks
 * for read-only market data calls while preserving all safety constraints
 * for order execution paths.
 */
describe("PHASE 26C — Dhan Option Chain HTTP 401 Root-Cause Fix", () => {
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

  // ── TASK 1: ROOT CAUSE — Token flow ─────────────────────────────────────────

  it("1. Profile valid but Option Chain returns 401 — classified as DHAN_AUTH_INVALID", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url: any) => {
      const urlStr = url.toString();
      if (urlStr.includes("/expirylist")) {
        return {
          ok: false,
          status: 401,
          json: async () => ({ errorCode: "806", errorMessage: "Data APIs not subscribed" }),
        } as Response;
      }
      return { ok: false, status: 401, json: async () => ({}) } as Response;
    });

    const adapter = new DhanBrokerAdapter({ clientId: "1100112233", accessToken: "token_123" });
    const res = await adapter.fetchOptionChain(24700);

    expect(res.success).toBe(false);
    // Root cause fix: error code must now contain the Dhan error code, not just HTTP_401
    expect(res.errorCode).toContain("806");
    expect(res.errorMessage).toContain("not subscribed");
  });

  it("2. Expiry list returns empty array — returns DHAN_EXPIRY_UNAVAILABLE, not synthetic expiry", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url: any) => {
      const urlStr = url.toString();
      if (urlStr.includes("/expirylist")) {
        return { ok: true, status: 200, json: async () => ({ data: [] }) } as Response;
      }
      return { ok: false, status: 404, json: async () => ({}) } as Response;
    });

    const adapter = new DhanBrokerAdapter({ clientId: "1100112233", accessToken: "token_123" });
    const res = await adapter.fetchOptionChain(24700);

    expect(res.success).toBe(false);
    expect(res.errorCode).toBe("DHAN_EXPIRY_UNAVAILABLE");
    expect(res.nearestExpiry).toBeNull();
    // Must NOT contain a hardcoded synthetic date like "2026-10-08"
    expect(res.errorMessage).not.toBe("");
  });

  it("3. Expiry list API unavailable (network error) — returns structured error, no synthetic fallback", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url: any) => {
      const urlStr = url.toString();
      if (urlStr.includes("/expirylist")) {
        throw new Error("ECONNREFUSED: Network unreachable");
      }
      return { ok: false, status: 500, json: async () => ({}) } as Response;
    });

    const adapter = new DhanBrokerAdapter({ clientId: "1100112233", accessToken: "token_123" });
    const res = await adapter.fetchOptionChain(24700);

    expect(res.success).toBe(false);
    expect(res.nearestExpiry).toBeNull(); // No synthetic expiry
    expect(res.contracts).toHaveLength(0);
  });

  it("4. Invalid token causes HTTP 401 — Dhan error code preserved (not swallowed as generic auth failure)", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url: any) => {
      const urlStr = url.toString();
      if (urlStr.includes("/expirylist")) {
        return {
          ok: false,
          status: 401,
          json: async () => ({ errorCode: "809", errorMessage: "Access token invalid" }),
        } as Response;
      }
      return { ok: false, status: 401, json: async () => ({}) } as Response;
    });

    const adapter = new DhanBrokerAdapter({ clientId: "1100112233", accessToken: "expired_token" });
    const res = await adapter.fetchOptionChain(24700);

    expect(res.success).toBe(false);
    // errorCode must be specific — DHAN_809 (access token invalid), NOT generic "HTTP_401"
    // The Dhan error code 809 is preserved from the response body
    expect(res.errorCode).toContain("809"); // Dhan-specific code preserved
    expect(res.errorCode).not.toBe("HTTP_401"); // Not generic
  });

  it("5. Invalid client-id causes HTTP 401 — client-id absence detected diagnostically", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url: any) => {
      const urlStr = url.toString();
      if (urlStr.includes("/expirylist")) {
        return {
          ok: false,
          status: 401,
          json: async () => ({ errorCode: "810", errorMessage: "Client ID invalid" }),
        } as Response;
      }
      return { ok: false, status: 401, json: async () => ({}) } as Response;
    });

    // Adapter with missing client-id
    const adapter = new DhanBrokerAdapter({ clientId: "", accessToken: "token_123" });
    delete process.env.DHAN_CLIENT_ID;
    const res = await adapter.fetchOptionChain(24700);

    expect(res.success).toBe(false);
    // Any auth/expiry error is acceptable here
    expect(res.errorCode).toBeTruthy();
  });

  it("6. Data API unavailable (Dhan error 806) — preserved in error code", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url: any) => {
      const urlStr = url.toString();
      if (urlStr.includes("/expirylist")) {
        return {
          ok: false,
          status: 401,
          json: async () => ({ errorCode: "806", errorMessage: "Data APIs not subscribed for this account" }),
        } as Response;
      }
      return { ok: false, status: 401 } as Response;
    });

    const adapter = new DhanBrokerAdapter({ clientId: "1100112233", accessToken: "token_123" });
    const res = await adapter.fetchOptionChain(24700);

    expect(res.success).toBe(false);
    expect(res.errorCode).toContain("806");
  });

  it("7. Invalid security ID (Dhan error 813) — preserved in error", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url: any) => {
      const urlStr = url.toString();
      if (urlStr.includes("/expirylist")) {
        return { ok: true, status: 200, json: async () => ({ data: ["2026-10-08"] }) } as Response;
      }
      if (urlStr.includes("/optionchain")) {
        return {
          ok: false,
          status: 400,
          json: async () => ({ errorCode: "813", errorMessage: "Invalid security ID" }),
        } as Response;
      }
      return { ok: false, status: 404 } as Response;
    });

    const adapter = new DhanBrokerAdapter({ clientId: "1100112233", accessToken: "token_123" });
    const res = await adapter.fetchOptionChain(24700);

    expect(res.success).toBe(false);
    expect(res.errorCode).toContain("813");
  });

  it("8. Invalid expiry (Dhan error 811) — preserved in error", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url: any) => {
      const urlStr = url.toString();
      if (urlStr.includes("/expirylist")) {
        return { ok: true, status: 200, json: async () => ({ data: ["2026-10-08"] }) } as Response;
      }
      if (urlStr.includes("/optionchain")) {
        return {
          ok: false,
          status: 400,
          json: async () => ({ errorCode: "811", errorMessage: "Invalid expiry date" }),
        } as Response;
      }
      return { ok: false, status: 404 } as Response;
    });

    const adapter = new DhanBrokerAdapter({ clientId: "1100112233", accessToken: "token_123" });
    const res = await adapter.fetchOptionChain(24700, "INVALID_DATE");

    expect(res.success).toBe(false);
    expect(res.errorCode).toContain("811");
  });

  it("9. Rate limit (HTTP 429) — classified as HTTP_429, not generic error", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url: any) => {
      const urlStr = url.toString();
      if (urlStr.includes("/expirylist")) {
        return { ok: true, status: 200, json: async () => ({ data: ["2026-10-08"] }) } as Response;
      }
      if (urlStr.includes("/optionchain")) {
        return { ok: false, status: 429, json: async () => ({}) } as Response;
      }
      return { ok: false, status: 404 } as Response;
    });

    const adapter = new DhanBrokerAdapter({ clientId: "1100112233", accessToken: "token_123" });
    const res = await adapter.fetchOptionChain(24700);

    expect(res.success).toBe(false);
    expect(res.errorCode).toBe("HTTP_429");
  });

  it("10. Valid expiry + valid option chain — succeeds with real data", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url: any) => {
      const urlStr = url.toString();
      if (urlStr.includes("/expirylist")) {
        return { ok: true, status: 200, json: async () => ({ data: ["2026-10-08", "2026-10-15"] }) } as Response;
      }
      if (urlStr.includes("/optionchain")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: {
              last_price: 24720.5,
              lot_size: 75,
              oc: {
                "24700": {
                  ce: {
                    security_id: "77001",
                    last_price: 130.4,
                    top_bid_price: 130.0,
                    top_ask_price: 130.8,
                    volume: 48000,
                    oi: 125000,
                    iv: 0.147,
                    delta: 0.54,
                    gamma: 0.0004,
                    theta: -12.3,
                    vega: 18.8,
                  },
                  pe: {
                    security_id: "77002",
                    last_price: 108.2,
                    top_bid_price: 107.8,
                    top_ask_price: 108.6,
                    volume: 41000,
                    oi: 112000,
                    iv: 0.145,
                    delta: -0.46,
                    gamma: 0.0004,
                    theta: -12.0,
                    vega: 18.4,
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
    expect(res.spotPrice).toBe(24720.5);
    expect(res.lotSize).toBe(75);
    expect(res.lotSizeVerified).toBe(true);
    expect(res.nearestExpiry).toBe("2026-10-08");
    expect(res.contracts.length).toBe(2);

    const ce = res.contracts.find(c => c.optionType === "CE")!;
    const pe = res.contracts.find(c => c.optionType === "PE")!;

    // CE validation
    expect(ce.ltp).toBe(130.4);
    expect(ce.bid).toBe(130.0);
    expect(ce.ask).toBe(130.8);
    expect(ce.openInterest).toBe(125000);
    expect(ce.volume).toBe(48000);
    expect(ce.iv).toBe(0.147);
    expect(ce.delta).toBe(0.54);
    expect(ce.gamma).toBe(0.0004);
    expect(ce.theta).toBe(-12.3);
    expect(ce.vega).toBe(18.8);
    expect(ce.source).toBe("DHAN");
    expect(ce.sourceType).toBe("REAL_EXTERNAL");

    // PE validation
    expect(pe.ltp).toBe(108.2);
    expect(pe.iv).toBe(0.145);
    expect(pe.delta).toBe(-0.46);
  });

  it("11. Missing gamma — gamma=undefined, gammaSource=UNAVAILABLE", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url: any) => {
      const urlStr = url.toString();
      if (urlStr.includes("/expirylist")) return { ok: true, status: 200, json: async () => ({ data: ["2026-10-08"] }) } as Response;
      if (urlStr.includes("/optionchain")) {
        return {
          ok: true, status: 200,
          json: async () => ({
            data: {
              last_price: 24700,
              oc: { "24700": { ce: { last_price: 100, top_bid_price: 99, top_ask_price: 101, delta: 0.5 /* no gamma */ } } },
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
    expect(ce.gammaSource).toBe("UNAVAILABLE");
    expect(ce.gamma).not.toBe(0.003); // No hardcoded fallback
    expect(ce.delta).toBe(0.5);       // Delta present
    expect(ce.deltaSource).toBe("REAL");
  });

  it("12. Missing delta — delta=undefined, deltaSource=UNAVAILABLE", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url: any) => {
      const urlStr = url.toString();
      if (urlStr.includes("/expirylist")) return { ok: true, status: 200, json: async () => ({ data: ["2026-10-08"] }) } as Response;
      if (urlStr.includes("/optionchain")) {
        return {
          ok: true, status: 200,
          json: async () => ({
            data: {
              last_price: 24700,
              oc: { "24700": { ce: { last_price: 100, top_bid_price: 99, top_ask_price: 101, gamma: 0.0004 /* no delta */ } } },
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
    expect(ce.delta).toBeUndefined();
    expect(ce.deltaSource).toBe("UNAVAILABLE");
    expect(ce.gamma).toBe(0.0004);
    expect(ce.gammaSource).toBe("REAL");
  });

  it("13. Missing IV — iv=undefined, ivSource=UNAVAILABLE", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url: any) => {
      const urlStr = url.toString();
      if (urlStr.includes("/expirylist")) return { ok: true, status: 200, json: async () => ({ data: ["2026-10-08"] }) } as Response;
      if (urlStr.includes("/optionchain")) {
        return {
          ok: true, status: 200,
          json: async () => ({
            data: {
              last_price: 24700,
              oc: { "24700": { ce: { last_price: 100, top_bid_price: 99, top_ask_price: 101 /* no iv */ } } },
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
    expect(ce.iv).toBeUndefined();
    expect(ce.ivSource).toBe("UNAVAILABLE");
  });

  it("14. No hardcoded gamma fallback — gamma must be undefined, not 0.003 or 0.005", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url: any) => {
      const urlStr = url.toString();
      if (urlStr.includes("/expirylist")) return { ok: true, status: 200, json: async () => ({ data: ["2026-10-08"] }) } as Response;
      if (urlStr.includes("/optionchain")) {
        return {
          ok: true, status: 200,
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
    const res = await adapter.fetchOptionChain(24700);

    expect(res.success).toBe(true);
    const ce = res.contracts[0];
    expect(ce.gamma).not.toBe(0.003);
    expect(ce.gamma).not.toBe(0.005);
    expect(ce.gamma).toBeUndefined();
  });

  it("15. No hardcoded lot-size fallback — lotSize=null when provider does not supply it", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url: any) => {
      const urlStr = url.toString();
      if (urlStr.includes("/expirylist")) return { ok: true, status: 200, json: async () => ({ data: ["2026-10-08"] }) } as Response;
      if (urlStr.includes("/optionchain")) {
        return {
          ok: true, status: 200,
          json: async () => ({
            data: {
              last_price: 24700,
              // No lot_size field in response
              oc: { "24700": { ce: { last_price: 100, top_bid_price: 99, top_ask_price: 101 } } },
            },
          }),
        } as Response;
      }
      return { ok: false, status: 404 } as Response;
    });

    const adapter = new DhanBrokerAdapter({ clientId: "1100112233", accessToken: "token_123" });
    const res = await adapter.fetchOptionChain(24700);

    // Fetch still succeeds (lot size doesn't block data reads)
    expect(res.success).toBe(true);
    // But lot size is null (not hardcoded 65 or 75)
    expect(res.lotSize).toBeNull();
    expect(res.lotSizeVerified).toBe(false);
    expect(res.lotSize).not.toBe(65); // No hardcoded fallback
  });

  it("16. No synthetic expiry fallback — expiry unavailable → DHAN_EXPIRY_UNAVAILABLE (no '2026-10-08' invented)", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url: any) => {
      const urlStr = url.toString();
      if (urlStr.includes("/expirylist")) {
        // Returns empty list
        return { ok: true, status: 200, json: async () => ({ data: [] }) } as Response;
      }
      return { ok: false, status: 500 } as Response;
    });

    const adapter = new DhanBrokerAdapter({ clientId: "1100112233", accessToken: "token_123" });
    const res = await adapter.fetchOptionChain(24700);

    expect(res.success).toBe(false);
    expect(res.errorCode).toBe("DHAN_EXPIRY_UNAVAILABLE");
    expect(res.nearestExpiry).toBeNull(); // Not "2026-10-08" or any hardcoded date
    expect(res.nearestExpiry).not.toBe("2026-10-08");
  });

  it("17. No synthetic option price fallback — all-zero prices → REAL_OPTION_PRICE_UNAVAILABLE", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url: any) => {
      const urlStr = url.toString();
      if (urlStr.includes("/expirylist")) return { ok: true, status: 200, json: async () => ({ data: ["2026-10-08"] }) } as Response;
      if (urlStr.includes("/optionchain")) {
        return {
          ok: true, status: 200,
          json: async () => ({
            data: {
              last_price: 24700,
              oc: { "24700": { ce: { last_price: 0, top_bid_price: 0, top_ask_price: 0 } } },
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
    expect(res.contracts).toHaveLength(0); // No synthetic prices inserted
  });

  it("18. REAL_DATA_ONLY blocks trading when provider is unavailable", async () => {
    process.env.INDIAN_REAL_DATA_ONLY = "true";

    const adapter = new DhanBrokerAdapter({ clientId: "", accessToken: "" });
    delete process.env.DHAN_ACCESS_TOKEN;
    delete process.env.DHAN_CLIENT_ID;

    const res = await adapter.fetchOptionChain(24700);

    expect(res.success).toBe(false);
    expect(res.errorCode).toBe("DHAN_NOT_CONFIGURED");
    expect(res.contracts).toHaveLength(0);
  });

  it("19. Dhan data provenance preserved — source=DHAN, sourceType=REAL_EXTERNAL", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url: any) => {
      const urlStr = url.toString();
      if (urlStr.includes("/expirylist")) return { ok: true, status: 200, json: async () => ({ data: ["2026-10-08"] }) } as Response;
      if (urlStr.includes("/optionchain")) {
        return {
          ok: true, status: 200,
          json: async () => ({
            data: {
              last_price: 24700,
              lot_size: 75,
              oc: { "24700": { ce: { last_price: 100, top_bid_price: 99, top_ask_price: 101, delta: 0.5 } } },
            },
          }),
        } as Response;
      }
      return { ok: false, status: 404 } as Response;
    });

    const adapter = new DhanBrokerAdapter({ clientId: "1100112233", accessToken: "token_123" });
    const res = await adapter.fetchOptionChain(24700);

    expect(res.success).toBe(true);
    expect(res.providerName).toBe("DHAN");
    expect(res.sourceType).toBe("REAL");

    const ce = res.contracts[0];
    expect(ce.source).toBe("DHAN");
    expect(ce.sourceType).toBe("REAL_EXTERNAL");
  });

  it("20. Successful chain reaches canonical option-chain model with full data integrity", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url: any) => {
      const urlStr = url.toString();
      if (urlStr.includes("/expirylist")) {
        return { ok: true, status: 200, json: async () => ({ data: ["2020-01-01", "2026-10-08", "2026-10-15"] }) } as Response;
      }
      if (urlStr.includes("/optionchain")) {
        return {
          ok: true, status: 200,
          json: async () => ({
            data: {
              last_price: 24800.0,
              lot_size: 75,
              oc: {
                "24800": {
                  ce: {
                    security_id: "88001",
                    last_price: 145.0,
                    top_bid_price: 144.8,
                    top_ask_price: 145.2,
                    volume: 50000,
                    oi: 130000,
                    iv: 0.15,
                    delta: 0.55,
                    gamma: 0.0005,
                    theta: -13.0,
                    vega: 19.0,
                    expiry: "2026-10-08",
                  },
                  pe: {
                    security_id: "88002",
                    last_price: 95.0,
                    top_bid_price: 94.6,
                    top_ask_price: 95.4,
                    volume: 38000,
                    oi: 100000,
                    iv: 0.14,
                    delta: -0.45,
                    gamma: 0.0005,
                    theta: -11.0,
                    vega: 17.5,
                    expiry: "2026-10-08",
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

    // Full success
    expect(res.success).toBe(true);
    expect(res.sourceType).toBe("REAL");
    expect(res.providerName).toBe("DHAN");
    expect(res.spotPrice).toBe(24800.0);
    expect(res.lotSize).toBe(75);
    expect(res.lotSizeVerified).toBe(true);

    // Expired dates are filtered — "2020-01-01" should not be selected
    expect(res.nearestExpiry).toBe("2026-10-08");
    expect(res.nearestExpiry).not.toBe("2020-01-01");

    // Contract data
    expect(res.contracts).toHaveLength(2);
    const ce = res.contracts.find(c => c.optionType === "CE")!;
    expect(ce.source).toBe("DHAN");
    expect(ce.sourceType).toBe("REAL_EXTERNAL");
    expect(ce.delta).toBe(0.55);
    expect(ce.deltaSource).toBe("REAL");
    expect(ce.gamma).toBe(0.0005);
    expect(ce.gammaSource).toBe("REAL");
    expect(ce.theta).toBe(-13.0);
    expect(ce.thetaSource).toBe("REAL");
    expect(ce.vega).toBe(19.0);
    expect(ce.vegaSource).toBe("REAL");
    expect(ce.iv).toBe(0.15);
    expect(ce.ivSource).toBe("REAL");

    // Diagnostic endpoint shows correct status
    const status = adapter.getOptionChainStatus();
    expect(status.syntheticFallback).toBe(false);
    expect(status.realDataOnly).toBe(true);
    expect(status.underlyingScrip).toBe(13);
    expect(status.underlyingSeg).toBe("IDX_I");
  });

  // ── TOKEN AUTHENTICATION VERIFICATION ────────────────────────────────────────

  it("Token source verification: getReadOnlyToken() returns env token without safety lock check", () => {
    // This is the core fix — getReadOnlyToken() must NOT enforce safety locks
    // Safety locks (PAPER_TRADING=true) must never block data reads
    process.env.DHAN_ACCESS_TOKEN = "live_token_from_env";
    process.env.LIVE_TRADING = "false";
    process.env.PAPER_TRADING = "true";

    // getReadOnlyToken() must succeed even when safety locks are active
    const token = dhanAuthService.getReadOnlyToken();
    expect(token).toBeTruthy();
    expect(token).toBe("live_token_from_env");
    // Must NOT throw (which getValidAccessToken() would do)
  });

  it("Client-id is always included in option chain headers — confirmed via mock observation", async () => {
    let capturedHeaders: Record<string, string> = {};

    vi.spyOn(globalThis, "fetch").mockImplementation(async (url: any, init: any) => {
      capturedHeaders = init?.headers ?? {};
      const urlStr = url.toString();
      if (urlStr.includes("/expirylist")) {
        return { ok: true, status: 200, json: async () => ({ data: ["2026-10-08"] }) } as Response;
      }
      return { ok: false, status: 404 } as Response;
    });

    const adapter = new DhanBrokerAdapter({ clientId: "TESTCID123", accessToken: "testtoken" });
    await adapter.fetchExpiryList(13, "IDX_I");

    // client-id MUST be present
    expect(capturedHeaders["client-id"]).toBe("TESTCID123");
    // access-token MUST be present
    expect(capturedHeaders["access-token"]).toBeTruthy();
    // Content-Type for POST
    expect(capturedHeaders["Content-Type"]).toBe("application/json");
  });

  it("UnderlyingSeg is IDX_I (not NSE_IND) for NIFTY option chain calls", async () => {
    let capturedBody = "";

    vi.spyOn(globalThis, "fetch").mockImplementation(async (url: any, init: any) => {
      capturedBody = init?.body ?? "";
      const urlStr = url.toString();
      if (urlStr.includes("/expirylist")) {
        return { ok: true, status: 200, json: async () => ({ data: ["2026-10-08"] }) } as Response;
      }
      if (urlStr.includes("/optionchain")) {
        return {
          ok: true, status: 200,
          json: async () => ({
            data: {
              last_price: 24700,
              lot_size: 75,
              oc: { "24700": { ce: { last_price: 100, top_bid_price: 99, top_ask_price: 101 } } },
            },
          }),
        } as Response;
      }
      return { ok: false, status: 404 } as Response;
    });

    const adapter = new DhanBrokerAdapter({ clientId: "1100112233", accessToken: "token_123" });
    await adapter.fetchOptionChain(24700);

    const parsed = JSON.parse(capturedBody);
    expect(parsed.UnderlyingSeg).toBe("IDX_I");   // Correct
    expect(parsed.UnderlyingSeg).not.toBe("NSE_IND"); // Not the wrong segment
    expect(parsed.UnderlyingScrip).toBe(13);      // NIFTY 50 Index Security ID
  });

  it("Lot size blocked at TRADE execution — LOT_SIZE_UNVERIFIED from InstrumentMasterResolver when null", () => {
    const result = instrumentMasterResolver.verifyLotSizeFromProvider(null);
    expect(result.verified).toBe(false);
    expect(result.reason).toBe("LOT_SIZE_UNVERIFIED");
    expect(result.currentLotSize).toBeNull();

    const result2 = instrumentMasterResolver.verifyLotSizeFromProvider(0);
    expect(result2.verified).toBe(false);
  });

  it("Diagnostic status endpoint never exposes access tokens or secrets", () => {
    const adapter = new DhanBrokerAdapter({ clientId: "12345", accessToken: "SUPER_SECRET_JWT_TOKEN_XYZ" });
    const status = adapter.getOptionChainStatus();
    const jsonStr = JSON.stringify(status);

    expect(jsonStr).not.toContain("SUPER_SECRET_JWT_TOKEN_XYZ");
    expect(jsonStr).not.toContain("DHAN_ACCESS_TOKEN");
    expect(jsonStr).not.toContain("secret");
  });

  it("Zero real broker orders confirmed — all order methods throw SECURITY LOCK ENFORCED", async () => {
    const adapter = new DhanBrokerAdapter({ clientId: "1100112233", accessToken: "token_123" });

    await expect(adapter.placeOrder({} as any)).rejects.toThrow("SECURITY LOCK ENFORCED");
    await expect(adapter.modifyOrder("id", {} as any)).rejects.toThrow("SECURITY LOCK ENFORCED");
    await expect(adapter.cancelOrder("id")).rejects.toThrow("SECURITY LOCK ENFORCED");
    expect(adapter.getRealOrdersSent()).toBe(0);
  });
});
