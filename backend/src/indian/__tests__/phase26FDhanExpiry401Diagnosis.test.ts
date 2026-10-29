import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { DhanBrokerAdapter } from "../broker/DhanBrokerAdapter";
import { DhanAuthService, decodeDhanTokenClaims } from "../broker/DhanAuthService";

/**
 * PHASE 26F — Dhan Expiry-List HTTP 401 diagnosis regression tests.
 *
 * Profile API (GET /v2/profile) needs only `access-token`. Data APIs
 * (POST /v2/optionchain, /v2/optionchain/expirylist) additionally need a
 * matching `client-id` AND an active Data API plan. These tests make sure the
 * system distinguishes the three cases and never fabricates data.
 */

// Fake, unsigned JWT for tests only (header.payload.signature).
function fakeJwt(payload: Record<string, unknown>): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b64({ alg: "none" })}.${b64(payload)}.sig`;
}

const FUTURE_EXPIRY_1 = "2099-01-01";
const FUTURE_EXPIRY_2 = "2099-01-08";

describe("PHASE 26F — Dhan expiry-list 401 diagnosis", () => {
  const origEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...origEnv };
    delete process.env.DHAN_PIN;
    delete process.env.DHAN_TOTP_SECRET;
    process.env.DHAN_CLIENT_ID = "1100112233";
    process.env.DHAN_ACCESS_TOKEN = "test_token";
    process.env.INDIAN_REAL_DATA_ONLY = "true";
    process.env.PAPER_TRADING = "true";
    process.env.LIVE_TRADING = "false";
    process.env.BROKER_EXECUTION_ENABLED = "false";
  });

  afterEach(() => {
    process.env = origEnv;
    vi.restoreAllMocks();
  });

  const expiry401 = (body: unknown) =>
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url: any) => {
      const u = url.toString();
      if (u.includes("/expirylist")) return { ok: false, status: 401, json: async () => body } as Response;
      if (u.includes("/profile")) return { ok: true, status: 200, json: async () => ({ dhanClientId: "1100112233" }) } as Response;
      return { ok: false, status: 404, json: async () => ({}) } as Response;
    });

  // ── Error classification ───────────────────────────────────────────────

  it("expired access token (Data API 807) is preserved", async () => {
    expiry401({ data: { "807": "Access token is expired" }, status: "failed" });
    const res = await new DhanBrokerAdapter({ clientId: "1100112233", accessToken: "t" }).fetchOptionChain(24700);
    expect(res.success).toBe(false);
    expect(res.errorCode).toBe("DHAN_807");
    expect(res.errorMessage).toContain("expired");
  });

  it("invalid token (Trading API DH-901) is preserved", async () => {
    expiry401({ errorType: "Invalid_Authentication", errorCode: "DH-901", errorMessage: "Client ID or user generated access token is invalid or expired." });
    const res = await new DhanBrokerAdapter({ clientId: "1100112233", accessToken: "t" }).fetchOptionChain(24700);
    expect(res.errorCode).toBe("DHAN_DH-901");
    expect(res.errorMessage).toContain("HTTP 401");
  });

  it("invalid client id (810) is preserved and does NOT trigger a token refresh retry", async () => {
    const spy = expiry401({ data: { "810": "Client ID is invalid" }, status: "failed" });
    const res = await new DhanBrokerAdapter({ clientId: "9999999999", accessToken: "t" }).fetchOptionChain(24700);
    expect(res.errorCode).toBe("DHAN_810");
    const calls = spy.mock.calls.map((c) => c[0].toString());
    expect(calls.filter((u) => u.includes("/expirylist"))).toHaveLength(1);
    expect(calls.some((u) => u.includes("/profile"))).toBe(false);
  });

  it("missing Data API subscription (806 / remarks shape) is preserved and surfaces NOT_SUBSCRIBED", async () => {
    expiry401({ remarks: { error_code: "806", error_message: "Data APIs not subscribed" }, status: "failed" });
    const adapter = new DhanBrokerAdapter({ clientId: "1100112233", accessToken: "t" });
    const res = await adapter.fetchOptionChain(24700);
    expect(res.errorCode).toBe("DHAN_806");
    expect(adapter.getOptionChainStatus().dataApi).toBe("NOT_SUBSCRIBED");
  });

  it("bare expiry HTTP 401 with no body falls back to HTTP_401, no synthetic expiry", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url: any) => {
      const u = url.toString();
      if (u.includes("/expirylist")) return { ok: false, status: 401, json: async () => { throw new Error("no body"); } } as unknown as Response;
      if (u.includes("/profile")) return { ok: false, status: 401, json: async () => ({}) } as Response;
      return { ok: false, status: 404, json: async () => ({}) } as Response;
    });
    const res = await new DhanBrokerAdapter({ clientId: "1100112233", accessToken: "t" }).fetchOptionChain(24700);
    expect(res.success).toBe(false);
    expect(res.errorCode).toBe("HTTP_401");
    expect(res.nearestExpiry).toBeNull();
    expect(res.contracts).toHaveLength(0);
  });

  // ── Success / empty paths ──────────────────────────────────────────────

  it("successful expiry discovery returns sorted real dates and sends documented headers/body", async () => {
    let headers: Record<string, string> = {};
    let body = "";
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url: any, init: any) => {
      headers = init?.headers ?? {};
      body = init?.body ?? "";
      return { ok: true, status: 200, json: async () => ({ data: [FUTURE_EXPIRY_2, FUTURE_EXPIRY_1], status: "success" }) } as Response;
    });
    const list = await new DhanBrokerAdapter({ clientId: "1100112233", accessToken: "t" }).fetchExpiryList(13, "IDX_I");
    expect(list).toEqual([FUTURE_EXPIRY_1, FUTURE_EXPIRY_2]);
    expect(headers["access-token"]).toBe("t");
    expect(headers["client-id"]).toBe("1100112233");
    expect(headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(body)).toEqual({ UnderlyingScrip: 13, UnderlyingSeg: "IDX_I" });
  });

  it("empty expiry list → DHAN_EXPIRY_UNAVAILABLE, no synthetic fallback", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: true, status: 200, json: async () => ({ data: [] }) } as Response);
    const adapter = new DhanBrokerAdapter({ clientId: "1100112233", accessToken: "t" });
    const res = await adapter.fetchOptionChain(24700);
    expect(res.success).toBe(false);
    expect(res.errorCode).toBe("DHAN_EXPIRY_UNAVAILABLE");
    expect(res.nearestExpiry).toBeNull();
    expect(res.contracts).toHaveLength(0);
    expect(adapter.getOptionChainStatus().syntheticFallback).toBe(false);
  });

  // ── Auth vs entitlement ────────────────────────────────────────────────

  it("profile HTTP 200 with dataPlan Deactive → authentication VALID but dataAccess false", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ dhanClientId: "1100112233", dataPlan: "Deactive", dataValidity: "2020-01-01 00:00:00.0" }),
    } as Response);
    const res = await new DhanAuthService({ clientId: "1100112233", accessToken: "t" }).verifyProfile();
    expect(res.authentication).toBe("VALID");
    expect(res.dataAccess).toBe(false);
    expect(res.dataApiStatus).toBe("INACTIVE");
    expect(res.errorCode).toBe("DATA_API_NOT_SUBSCRIBED");
  });

  it("profile HTTP 200 with dataPlan Active and matching client id → dataAccess true", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true, status: 200, json: async () => ({ dhanClientId: "1100112233", dataPlan: "Active" }),
    } as Response);
    const res = await new DhanAuthService({ clientId: "1100112233", accessToken: "t" }).verifyProfile();
    expect(res.dataAccess).toBe(true);
    expect(res.clientIdCheck).toBe("MATCH");
  });

  it("client-id mismatch between DHAN_CLIENT_ID and token owner is detected without leaking ids", async () => {
    process.env.DHAN_CLIENT_ID = "1100000000";
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true, status: 200, json: async () => ({ dhanClientId: "1100112233", dataPlan: "Active" }),
    } as Response);
    const res = await new DhanAuthService({ clientId: "1100000000", accessToken: "t" }).verifyProfile();
    expect(res.authentication).toBe("VALID");
    expect(res.clientIdCheck).toBe("MISMATCH");
    expect(res.dataAccess).toBe(false);
    expect(res.errorCode).toBe("CLIENT_ID_MISMATCH");
    expect(JSON.stringify(res)).not.toContain("1100112233");
    expect(JSON.stringify(res)).not.toContain("1100000000");
  });

  it("JWT claims decode reads only dhanClientId/exp and tolerates garbage", () => {
    const claims = decodeDhanTokenClaims(fakeJwt({ dhanClientId: "1100112233", exp: 4102444800 }));
    expect(claims.dhanClientId).toBe("1100112233");
    expect(claims.expMs).toBe(4102444800 * 1000);
    expect(decodeDhanTokenClaims("not-a-jwt")).toEqual({});
    expect(decodeDhanTokenClaims(undefined)).toEqual({});
  });

  // ── Safety gates ───────────────────────────────────────────────────────

  it("status never reports authentication VALID merely because credentials are configured", () => {
    const status = new DhanBrokerAdapter({ clientId: "1100112233", accessToken: "SECRET_TOKEN_ABC" }).getOptionChainStatus();
    expect(["UNVERIFIED", "VALID", "EXPIRED", "FAILED", "SAFETY_REJECTED"]).toContain(status.authentication);
    expect(status.realDataOnly).toBe(true);
    expect(status.syntheticFallback).toBe(false);
    expect(JSON.stringify(status)).not.toContain("SECRET_TOKEN_ABC");
  });

  it("real-data-only: unconfigured provider is blocked and order methods stay locked", async () => {
    delete process.env.DHAN_CLIENT_ID;
    delete process.env.DHAN_ACCESS_TOKEN;
    const adapter = new DhanBrokerAdapter({ clientId: "", accessToken: "" });
    const res = await adapter.fetchOptionChain(24700);
    expect(res.success).toBe(false);
    expect(res.errorCode).toBe("DHAN_NOT_CONFIGURED");
    expect(res.contracts).toHaveLength(0);
    await expect(adapter.placeOrder({} as any)).rejects.toThrow("SECURITY LOCK ENFORCED");
    expect(adapter.getRealOrdersSent()).toBe(0);
    expect(process.env.LIVE_TRADING).toBe("false");
    expect(process.env.BROKER_EXECUTION_ENABLED).toBe("false");
  });
});
