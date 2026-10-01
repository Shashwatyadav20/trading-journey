import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { DhanAuthService, generateTOTP } from "../broker/DhanAuthService";
import { dhanBrokerAdapter } from "../broker/DhanBrokerAdapter";

describe("PHASE 26A — Official DhanHQ API Authentication & Token Lifecycle Test Suite", () => {
  const origEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...origEnv };
    delete process.env.DHAN_CLIENT_ID;
    delete process.env.DHAN_PIN;
    delete process.env.DHAN_TOTP_SECRET;
    delete process.env.DHAN_API_KEY;
    delete process.env.DHAN_API_SECRET;
    delete process.env.DHAN_TOKEN_ID;
    delete process.env.DHAN_ACCESS_TOKEN;
    delete process.env.LIVE_TRADING;
    delete process.env.BROKER_EXECUTION_ENABLED;
  });

  afterEach(() => {
    process.env = origEnv;
    vi.restoreAllMocks();
  });

  // 1. TOTP Generation Test
  it("1. TOTP RFC 6238 algorithm generates a valid 6-digit numeric string", () => {
    const secret = "JBSWY3DPEHPK3PXP";
    const otp1 = generateTOTP(secret, 1000000);
    const otp2 = generateTOTP(secret, 1000000);

    expect(otp1).toHaveLength(6);
    expect(/^\d{6}$/.test(otp1)).toBe(true);
    expect(otp1).toBe(otp2);
  });

  // 2. Missing credentials test
  it("2. Missing credentials returns DHAN_NOT_CONFIGURED", async () => {
    const authService = new DhanAuthService({});
    const res = await authService.authenticateAndVerify();

    expect(res.provider).toBe("DHAN");
    expect(res.connected).toBe(false);
    expect(res.authentication).toBe("NOT_CONFIGURED");
    expect(res.errorCode).toBe("DHAN_NOT_CONFIGURED");
    expect(res.executionEnabled).toBe(false);
  });

  // 3. Official TOTP + PIN Flow Authentication & Profile Verification
  it("3. Official TOTP + PIN flow (Client ID + PIN + TOTP) authenticates & verifies via Profile API", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (url: any) => {
      const urlStr = url.toString();
      if (urlStr.includes("/app/generateAccessToken")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            accessToken: "mock_dhan_totp_token_9999",
            expiresIn: 86400,
          }),
        } as Response;
      }
      if (urlStr.includes("/profile")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            dhanClientId: "1100112233",
            profileId: "PRF_1100112233",
            name: "Dhan Trader",
          }),
        } as Response;
      }
      return { ok: false, status: 404 } as Response;
    });

    const authService = new DhanAuthService({
      clientId: "1100112233",
      pin: "123456",
      totpSecret: "JBSWY3DPEHPK3PXP",
    });

    const res = await authService.authenticateAndVerify();

    expect(res).toEqual({
      provider: "DHAN",
      connected: true,
      authentication: "VALID",
      dataAccess: true,
      executionEnabled: false,
      authFlowUsed: "TOTP_PIN",
    });
    expect(fetchSpy).toHaveBeenCalled();
  });

  // 4. Official Direct Web Access Token & Renewal Flow
  it("4. Direct Web Access Token flow authenticates and uses Renewal API when expiring", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (url: any) => {
      const urlStr = url.toString();
      if (urlStr.includes("/RenewToken")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            accessToken: "renewed_dhan_access_token_8888",
          }),
        } as Response;
      }
      if (urlStr.includes("/profile")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            dhanClientId: "1100112233",
            name: "Direct Token User",
          }),
        } as Response;
      }
      return { ok: false, status: 404 } as Response;
    });

    const authService = new DhanAuthService({
      clientId: "1100112233",
      accessToken: "existing_web_token_7777",
    });

    const res = await authService.authenticateAndVerify();

    expect(res.connected).toBe(true);
    expect(res.authentication).toBe("VALID");
    expect(res.authFlowUsed).toBe("DIRECT_TOKEN");
    expect(res.executionEnabled).toBe(false);
  });

  // 5. Authentication failure (invalid credentials/PIN/TOTP)
  it("5. Authentication failure (HTTP 401) is handled explicitly", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
    } as Response);

    const authService = new DhanAuthService({
      clientId: "1100112233",
      pin: "000000",
      totpSecret: "JBSWY3DPEHPK3PXP",
    });

    const res = await authService.authenticateAndVerify();

    expect(res.connected).toBe(false);
    expect(res.authentication).toBe("FAILED");
    expect(res.errorCode).toBe("AUTHENTICATION_FAILED");
    expect(res.executionEnabled).toBe(false);
  });

  // 6. Expired token response handling
  it("6. Expired token (Profile API HTTP 401) purges token and sets status EXPIRED", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
    } as Response);

    const authService = new DhanAuthService({
      clientId: "1100112233",
      accessToken: "expired_token_abc",
    });

    const res = await authService.verifyProfile();

    expect(res.connected).toBe(false);
    expect(res.authentication).toBe("EXPIRED");
    expect(res.errorCode).toBe("EXPIRED_TOKEN");
  });

  // 7. Secret masking and token leakage prevention
  it("7. Secret masking ensures PIN, secrets, and tokens are NEVER leaked in response payloads", async () => {
    const authService = new DhanAuthService({
      clientId: "1100112233",
      pin: "123456",
      totpSecret: "SUPER_SECRET_TOTP",
      apiKey: "SUPER_SECRET_KEY",
      apiSecret: "SUPER_SECRET_VALUE",
      accessToken: "SUPER_SECRET_ACCESS_TOKEN",
    });

    const res = await authService.authenticateAndVerify();
    const sanitized = authService.sanitizeOutput(res);
    const jsonStr = JSON.stringify(sanitized);

    expect(jsonStr).not.toContain("123456");
    expect(jsonStr).not.toContain("SUPER_SECRET_TOTP");
    expect(jsonStr).not.toContain("SUPER_SECRET_KEY");
    expect(jsonStr).not.toContain("SUPER_SECRET_VALUE");
    expect(jsonStr).not.toContain("SUPER_SECRET_ACCESS_TOKEN");
  });

  // 8. LIVE_TRADING=true safety rejection
  it("8. LIVE_TRADING=true env override triggers mandatory safety rejection", async () => {
    process.env.LIVE_TRADING = "true";

    const authService = new DhanAuthService({
      clientId: "1100112233",
      pin: "123456",
      totpSecret: "JBSWY3DPEHPK3PXP",
    });

    const res = await authService.authenticateAndVerify();

    expect(res.connected).toBe(false);
    expect(res.authentication).toBe("SAFETY_REJECTED");
    expect(res.errorCode).toBe("SAFETY_LOCK_VIOLATION");
    expect(res.executionEnabled).toBe(false);
  });

  // 9. BROKER_EXECUTION_ENABLED=true safety rejection
  it("9. BROKER_EXECUTION_ENABLED=true env override triggers mandatory safety rejection", async () => {
    process.env.BROKER_EXECUTION_ENABLED = "true";

    const authService = new DhanAuthService({
      clientId: "1100112233",
      pin: "123456",
      totpSecret: "JBSWY3DPEHPK3PXP",
    });

    const res = await authService.authenticateAndVerify();

    expect(res.connected).toBe(false);
    expect(res.authentication).toBe("SAFETY_REJECTED");
    expect(res.errorCode).toBe("SAFETY_LOCK_VIOLATION");
    expect(res.executionEnabled).toBe(false);
  });

  // 10. Profile API verification requirement
  it("10. Dhan is NOT reported connected unless Profile API request succeeds", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url: any) => {
      const urlStr = url.toString();
      if (urlStr.includes("/app/generateAccessToken")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ accessToken: "mock_token" }),
        } as Response;
      }
      // Profile API fails with HTTP 500
      if (urlStr.includes("/profile")) {
        return {
          ok: false,
          status: 500,
          statusText: "Internal Server Error",
        } as Response;
      }
      return { ok: false, status: 404 } as Response;
    });

    const authService = new DhanAuthService({
      clientId: "1100112233",
      pin: "123456",
      totpSecret: "JBSWY3DPEHPK3PXP",
    });

    const res = await authService.authenticateAndVerify();

    expect(res.connected).toBe(false); // MUST BE FALSE because Profile API failed
    expect(res.authentication).toBe("FAILED");
  });

  // 11. Real broker orders sent = 0 confirmation
  it("11. Real order placement, modification, and cancellation remain PERMANENTLY BLOCKED (orders sent = 0)", async () => {
    const req: any = { symbol: "NIFTY", price: 100, quantity: 75, side: "BUY" };
    await expect(dhanBrokerAdapter.placeOrder(req)).rejects.toThrow("SECURITY LOCK ENFORCED");
    await expect(dhanBrokerAdapter.modifyOrder("ORD1", req)).rejects.toThrow("SECURITY LOCK ENFORCED");
    await expect(dhanBrokerAdapter.cancelOrder("ORD1")).rejects.toThrow("SECURITY LOCK ENFORCED");
  });
});
