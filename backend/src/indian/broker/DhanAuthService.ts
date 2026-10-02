import * as crypto from "crypto";

export interface DhanAuthCredentials {
  clientId?: string;
  pin?: string;
  totpSecret?: string;
  apiKey?: string;
  apiSecret?: string;
  tokenId?: string;
  accessToken?: string;
  baseUrl?: string;
  authUrl?: string;
}

export interface DhanAuthVerificationResult {
  provider: "DHAN";
  connected: boolean;
  authentication: "VALID" | "FAILED" | "EXPIRED" | "NOT_CONFIGURED" | "SAFETY_REJECTED";
  dataAccess: boolean;
  executionEnabled: boolean;
  authFlowUsed?: "DIRECT_TOKEN" | "TOTP_PIN" | "CONSENT_TOKEN_ID";
  profileApiStatus?: string;
  tokenConfigured?: boolean;
  tokenLength?: number;
  tokenMasked?: boolean;
  errorCode?: string;
  errorMessage?: string;
}

/**
 * Generates a 6-digit TOTP token according to RFC 6238 using Node.js crypto.
 */
export function generateTOTP(secret: string, timeMs: number = Date.now()): string {
  if (!secret || typeof secret !== "string") return "";
  const cleanSecret = secret.replace(/\s+/g, "").toUpperCase();
  if (!cleanSecret) return "";

  const base32chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (let i = 0; i < cleanSecret.length; i++) {
    const val = base32chars.indexOf(cleanSecret.charAt(i));
    if (val === -1) continue;
    bits += val.toString(2).padStart(5, "0");
  }

  if (bits.length < 8) return "";

  const bytes = new Uint8Array(Math.floor(bits.length / 8));
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(bits.substring(i * 8, i * 8 + 8), 2);
  }

  const timeStep = 30;
  const counter = Math.floor(timeMs / 1000 / timeStep);
  const buf = Buffer.alloc(8);
  buf.writeBigInt64BE(BigInt(counter), 0);

  const hmac = crypto.createHmac("sha1", Buffer.from(bytes));
  hmac.update(buf);
  const digest = hmac.digest();

  const offset = digest[digest.length - 1] & 0x0f;
  const code =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);

  return (code % 1000000).toString().padStart(6, "0");
}

/**
 * Phase 26A — Official DhanHQ API Authentication Manager
 *
 * OFFICIAL DHANHQ AUTHENTICATION FLOWS SUPPORTED:
 * 1. Direct Web Access Token Flow (`DHAN_CLIENT_ID` + `DHAN_ACCESS_TOKEN` with /v2/RenewToken renewal).
 * 2. Documented TOTP + PIN Flow (`DHAN_CLIENT_ID` + `DHAN_PIN` + `DHAN_TOTP_SECRET` via auth.dhan.co).
 * 3. Consent Token ID Flow (`DHAN_CLIENT_ID` + `DHAN_API_KEY` + `DHAN_API_SECRET` + `DHAN_TOKEN_ID`).
 *
 * STRICT SAFETY LOCKS:
 * - PAPER_TRADING = true
 * - LIVE_TRADING = false
 * - BROKER_EXECUTION_ENABLED = false
 * - Tokens stored strictly in server-side runtime memory (never logged, exposed, or written to DB/Git).
 */
export class DhanAuthService {
  private clientId: string = "";
  private pin: string = "";
  private totpSecret: string = "";
  private apiKey: string = "";
  private apiSecret: string = "";
  private tokenId: string = "";
  private baseUrl: string = "https://api.dhan.co/v2";
  private authUrl: string = "https://auth.dhan.co";

  // Runtime In-Memory Token State (NEVER logged or returned to frontend)
  private accessToken: string | null = null;
  private tokenExpiryMs: number = 0;
  private lastAuthTimeMs: number = 0;
  private authStatus: "NOT_CONFIGURED" | "VALID" | "EXPIRED" | "FAILED" | "SAFETY_REJECTED" = "NOT_CONFIGURED";
  private lastAuthFlowUsed?: "DIRECT_TOKEN" | "TOTP_PIN" | "CONSENT_TOKEN_ID";
  private lastErrorMessage: string = "";

  constructor(credentials?: DhanAuthCredentials) {
    this.reloadCredentials(credentials);
  }

  /**
   * Helper function to sanitize/clean raw tokens & client IDs:
   * - Strips leading/trailing whitespace
   * - Strips surrounding single/double quotes
   * - Strips "Bearer " prefix if present
   * - Strips newlines, carriage returns, and tabs
   */
  public cleanToken(token?: string): string {
    if (!token || typeof token !== "string") return "";
    let clean = token.trim();
    if ((clean.startsWith('"') && clean.endsWith('"')) || (clean.startsWith("'") && clean.endsWith("'"))) {
      clean = clean.substring(1, clean.length - 1).trim();
    }
    if (clean.toLowerCase().startsWith("bearer ")) {
      clean = clean.substring(7).trim();
    }
    return clean.replace(/[\r\n\t]+/g, "").trim();
  }

  public reloadCredentials(credentials?: DhanAuthCredentials): void {
    this.clientId = this.cleanToken(credentials?.clientId ?? process.env.DHAN_CLIENT_ID);
    this.pin = (credentials?.pin ?? process.env.DHAN_PIN ?? "").trim();
    this.totpSecret = (credentials?.totpSecret ?? process.env.DHAN_TOTP_SECRET ?? "").trim();
    this.apiKey = (credentials?.apiKey ?? process.env.DHAN_API_KEY ?? "").trim();
    this.apiSecret = (credentials?.apiSecret ?? process.env.DHAN_API_SECRET ?? "").trim();
    this.tokenId = (credentials?.tokenId ?? process.env.DHAN_TOKEN_ID ?? "").trim();
    this.baseUrl = (credentials?.baseUrl ?? process.env.DHAN_BASE_URL ?? "https://api.dhan.co/v2").trim();
    this.authUrl = (credentials?.authUrl ?? process.env.DHAN_AUTH_URL ?? "https://auth.dhan.co").trim();

    const directToken = this.cleanToken(credentials?.accessToken ?? process.env.DHAN_ACCESS_TOKEN);
    if (directToken) {
      this.accessToken = directToken;
      if (this.tokenExpiryMs === 0) {
        this.tokenExpiryMs = Date.now() + 86400 * 1000; // Default 24-hour validity window
      }
    }
  }

  /**
   * Evaluates if any official DhanHQ authentication flow is configured.
   */
  public getClientId(): string {
    return this.clientId || this.cleanToken(process.env.DHAN_CLIENT_ID) || "";
  }

  public isConfigured(): boolean {
    const activeToken = this.accessToken || this.cleanToken(process.env.DHAN_ACCESS_TOKEN);
    const activeClientId = this.clientId || this.cleanToken(process.env.DHAN_CLIENT_ID);
    const hasTotpPinFlow = !!(activeClientId && this.pin && this.totpSecret);
    const hasDirectToken = !!activeToken;
    const hasConsentFlow = !!(activeClientId && this.apiKey && this.apiSecret && this.tokenId);
    return hasTotpPinFlow || hasDirectToken || hasConsentFlow;
  }

  /**
   * Enforces hard safety locks for paper trading mode.
   */
  public checkSafetyLocks(): { allowed: boolean; reason?: string } {
    const liveTrading = process.env.LIVE_TRADING === "true";
    const brokerExecution = process.env.BROKER_EXECUTION_ENABLED === "true";

    if (liveTrading || brokerExecution) {
      return {
        allowed: false,
        reason: "SAFETY_LOCK_VIOLATION: System is locked to PAPER_TRADING mode. Live broker execution is disabled.",
      };
    }
    return { allowed: true };
  }

  /**
   * Returns current access token from secure server runtime memory.
   * Auto-refreshes or regenerates before expiry.
   */
  public async getValidAccessToken(): Promise<string> {
    const safety = this.checkSafetyLocks();
    if (!safety.allowed) {
      throw new Error(safety.reason);
    }

    if (!this.isConfigured()) {
      throw new Error("DHAN_NOT_CONFIGURED: Dhan credentials missing from environment.");
    }

    if (this.isTokenExpired()) {
      await this.authenticateAndVerify();
    }

    if (!this.accessToken) {
      throw new Error("DHAN_AUTH_FAILED: Failed to acquire valid access token.");
    }

    return this.accessToken;
  }

  /**
   * Returns current access token for READ-ONLY data API calls (option chain, market data).
   * Does NOT enforce safety locks because market data reads never risk live order placement.
   * This is the correct method for DhanBrokerAdapter option chain / expiry requests.
   */
  public getReadOnlyToken(): string {
    const token = this.accessToken || this.cleanToken(process.env.DHAN_ACCESS_TOKEN);
    return token || "";
  }

  public isTokenExpired(): boolean {
    if (!this.accessToken) return true;
    // 5-minute buffer before 24-hour expiration
    return Date.now() >= this.tokenExpiryMs - 300000;
  }

  /**
   * Authenticates using documented DhanHQ API flow and verifies via Profile API.
   */
  public async authenticateAndVerify(): Promise<DhanAuthVerificationResult> {
    // 1. Enforce Safety Locks
    const safety = this.checkSafetyLocks();
    if (!safety.allowed) {
      this.authStatus = "SAFETY_REJECTED";
      this.lastErrorMessage = safety.reason!;
      return {
        provider: "DHAN",
        connected: false,
        authentication: "SAFETY_REJECTED",
        dataAccess: false,
        executionEnabled: false,
        errorCode: "SAFETY_LOCK_VIOLATION",
        errorMessage: safety.reason,
      };
    }

    // 2. Refresh/Clean environment token if available
    const envToken = this.cleanToken(process.env.DHAN_ACCESS_TOKEN);
    if (envToken && (!this.accessToken || envToken !== this.accessToken)) {
      this.accessToken = envToken;
      if (this.tokenExpiryMs === 0) {
        this.tokenExpiryMs = Date.now() + 86400 * 1000;
      }
    }

    const envClientId = this.cleanToken(process.env.DHAN_CLIENT_ID);
    if (envClientId) {
      this.clientId = envClientId;
    }

    // 3. Verify Credential Configuration
    if (!this.isConfigured()) {
      this.authStatus = "NOT_CONFIGURED";
      this.lastErrorMessage = "DHAN_CLIENT_ID or authentication credentials missing from environment.";
      return {
        provider: "DHAN",
        connected: false,
        authentication: "NOT_CONFIGURED",
        dataAccess: false,
        executionEnabled: false,
        errorCode: "DHAN_NOT_CONFIGURED",
        errorMessage: this.lastErrorMessage,
      };
    }

    // 4. EXECUTE OFFICIAL AUTHENTICATION FLOWS

    // FLOW A: Official TOTP + PIN Token Generation (Client ID + PIN + TOTP Secret)
    if (this.clientId && this.pin && this.totpSecret) {
      this.lastAuthFlowUsed = "TOTP_PIN";
      try {
        const totpCode = generateTOTP(this.totpSecret);
        if (!totpCode) {
          throw new Error("Failed to generate TOTP code from secret.");
        }

        const endpoint = `${this.authUrl}/app/generateAccessToken?dhanClientId=${encodeURIComponent(
          this.clientId
        )}&pin=${encodeURIComponent(this.pin)}&totp=${encodeURIComponent(totpCode)}`;

        const resp = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Accept": "application/json",
            "Content-Type": "application/json",
          },
          signal: AbortSignal.timeout(10000),
        });

        if (!resp.ok) {
          this.authStatus = "FAILED";
          this.lastErrorMessage = `Dhan TOTP Auth HTTP ${resp.status}: ${resp.statusText}`;
          return {
            provider: "DHAN",
            connected: false,
            authentication: "FAILED",
            dataAccess: false,
            executionEnabled: false,
            authFlowUsed: "TOTP_PIN",
            profileApiStatus: `HTTP_${resp.status}`,
            errorCode: resp.status === 401 || resp.status === 403 ? "AUTHENTICATION_FAILED" : `HTTP_${resp.status}`,
            errorMessage: this.lastErrorMessage,
          };
        }

        const data = await resp.json();
        const newToken = this.cleanToken(data?.accessToken || data?.access_token || data?.token || data?.data?.accessToken);
        const expiresInSec = data?.expiresIn || data?.expires_in || 86400;

        if (newToken) {
          this.accessToken = newToken;
          this.tokenExpiryMs = Date.now() + expiresInSec * 1000;
          this.lastAuthTimeMs = Date.now();
        } else {
          this.authStatus = "FAILED";
          this.lastErrorMessage = "Dhan TOTP auth response missing accessToken.";
          return {
            provider: "DHAN",
            connected: false,
            authentication: "FAILED",
            dataAccess: false,
            executionEnabled: false,
            authFlowUsed: "TOTP_PIN",
            errorCode: "TOKEN_PARSING_FAILED",
            errorMessage: this.lastErrorMessage,
          };
        }
      } catch (err: any) {
        if (!this.accessToken) {
          this.authStatus = "FAILED";
          this.lastErrorMessage = err.message || "Dhan TOTP authentication failed.";
          return {
            provider: "DHAN",
            connected: false,
            authentication: "FAILED",
            dataAccess: false,
            executionEnabled: false,
            authFlowUsed: "TOTP_PIN",
            errorCode: "AUTHENTICATION_FAILED",
            errorMessage: this.lastErrorMessage,
          };
        }
      }
    }

    // FLOW B: Direct Access Token + Renewal via GET /v2/RenewToken
    else if (this.accessToken || process.env.DHAN_ACCESS_TOKEN) {
      this.lastAuthFlowUsed = "DIRECT_TOKEN";
      // If token is expiring, attempt official renewal via /v2/RenewToken
      if (this.isTokenExpired() && this.accessToken && this.clientId) {
        try {
          const renewResp = await fetch(`${this.baseUrl}/RenewToken`, {
            method: "GET",
            headers: {
              "access-token": this.accessToken,
              "Accept": "application/json",
            },
            signal: AbortSignal.timeout(10000),
          });

          if (renewResp.ok) {
            const renewData = await renewResp.json();
            const newToken = this.cleanToken(renewData?.accessToken || renewData?.token || this.accessToken);
            this.accessToken = newToken;
            this.tokenExpiryMs = Date.now() + 86400 * 1000;
            this.lastAuthTimeMs = Date.now();
          }
        } catch {
          // Ignore renewal error and fall back to current token for Profile API verification
        }
      }
    }

    // FLOW C: Documented Consent Token ID Exchange
    else if (this.clientId && this.apiKey && this.apiSecret && this.tokenId) {
      this.lastAuthFlowUsed = "CONSENT_TOKEN_ID";
      try {
        const resp = await fetch(`${this.baseUrl}/auth/consumeConsentToken`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "client-id": this.clientId,
            "api-key": this.apiKey,
            "api-secret": this.apiSecret,
          },
          body: JSON.stringify({ tokenId: this.tokenId }),
          signal: AbortSignal.timeout(10000),
        });

        if (resp.ok) {
          const data = await resp.json();
          if (data?.accessToken) {
            this.accessToken = this.cleanToken(data.accessToken);
            this.tokenExpiryMs = Date.now() + 86400 * 1000;
            this.lastAuthTimeMs = Date.now();
          }
        }
      } catch (err: any) {
        // Fall back to verifyProfile
      }
    }

    // 5. READ-ONLY PROFILE API VERIFICATION STEP
    return await this.verifyProfile();
  }

  /**
   * Calls Dhan read-only Profile API as the single verification mechanism.
   * Uses current official DhanHQ v2 Profile API contract:
   * GET https://api.dhan.co/v2/profile
   * Header:
   * access-token: <JWT>
   */
  public async verifyProfile(): Promise<DhanAuthVerificationResult> {
    const rawToken = this.accessToken || process.env.DHAN_ACCESS_TOKEN;
    this.accessToken = this.cleanToken(rawToken);

    if (!this.accessToken) {
      this.authStatus = "FAILED";
      console.log("[DhanAuth] Safe Diagnostics:", {
        tokenConfigured: false,
        tokenLength: 0,
        tokenPrefixMasked: "NONE",
        tokenExpiryKnown: false,
        httpStatus: null,
        dhanErrorCode: "NO_TOKEN",
        dhanErrorMessage: "No access token available for Profile verification.",
      });
      return {
        provider: "DHAN",
        connected: false,
        authentication: "FAILED",
        dataAccess: false,
        executionEnabled: false,
        authFlowUsed: this.lastAuthFlowUsed || "DIRECT_TOKEN",
        profileApiStatus: "NO_TOKEN",
        tokenConfigured: false,
        tokenLength: 0,
        tokenMasked: false,
        errorCode: "NO_TOKEN",
        errorMessage: "No access token available for Profile verification.",
      };
    }

    const tokenLength = this.accessToken.length;
    const tokenPrefixMasked = tokenLength >= 6 ? `${this.accessToken.substring(0, 6)}...` : "****";

    try {
      const headers: Record<string, string> = {
        "access-token": this.accessToken,
        "Accept": "application/json",
      };

      const resp = await fetch(`${this.baseUrl}/profile`, {
        method: "GET",
        headers,
        signal: AbortSignal.timeout(10000),
      });

      const profileApiStatus = `HTTP_${resp.status}`;

      let errJson: any = null;
      try {
        errJson = await resp.json();
      } catch {
        // Body was not JSON
      }

      // Safe console diagnostic logging (DO NOT expose full token)
      console.log("[DhanAuth] Safe Diagnostics:", {
        tokenConfigured: true,
        tokenLength,
        tokenPrefixMasked,
        tokenExpiryKnown: this.tokenExpiryMs > 0,
        httpStatus: resp.status,
        dhanErrorCode: errJson?.errorCode || errJson?.code || errJson?.status || null,
        dhanErrorMessage: errJson?.errorMessage || errJson?.message || errJson?.error || null,
      });

      if (!resp.ok) {
        this.authStatus = resp.status === 401 || resp.status === 403 ? "EXPIRED" : "FAILED";
        if (this.authStatus === "EXPIRED") {
          this.accessToken = null; // Purge invalid token
        }

        const defaultErrorCode = resp.status === 401 || resp.status === 403 ? "EXPIRED_TOKEN" : `HTTP_${resp.status}`;
        const safeErrorCode = (resp.status === 401 || resp.status === 403)
          ? "EXPIRED_TOKEN"
          : (errJson?.errorCode || errJson?.code || errJson?.status || defaultErrorCode);

        const safeErrorMessage = errJson?.errorMessage || errJson?.message || errJson?.error || `Profile verification HTTP ${resp.status}`;

        this.lastErrorMessage = safeErrorMessage;
        return {
          provider: "DHAN",
          connected: false,
          authentication: this.authStatus,
          dataAccess: false,
          executionEnabled: false,
          authFlowUsed: this.lastAuthFlowUsed || "DIRECT_TOKEN",
          profileApiStatus,
          errorCode: safeErrorCode,
          errorMessage: safeErrorMessage,
        };
      }

      const json = errJson;
      const isValidProfile = !!(json?.dhanClientId || json?.profileId || json?.name || json?.status === "success" || resp.ok);

      if (isValidProfile) {
        this.authStatus = "VALID";
        this.lastErrorMessage = "";
        return {
          provider: "DHAN",
          connected: true,
          authentication: "VALID",
          profileApiStatus: "HTTP_200",
          dataAccess: true,
          executionEnabled: false,
          authFlowUsed: this.lastAuthFlowUsed || "DIRECT_TOKEN",
        };
      } else {
        this.authStatus = "FAILED";
        const safeErrorCode = json?.errorCode || json?.code || "INVALID_PROFILE_RESPONSE";
        const safeErrorMessage = json?.errorMessage || json?.message || "Profile API returned unexpected structure.";
        return {
          provider: "DHAN",
          connected: false,
          authentication: "FAILED",
          dataAccess: false,
          executionEnabled: false,
          authFlowUsed: this.lastAuthFlowUsed || "DIRECT_TOKEN",
          profileApiStatus: "HTTP_200",
          errorCode: safeErrorCode,
          errorMessage: safeErrorMessage,
        };
      }
    } catch (err: any) {
      this.authStatus = "FAILED";
      this.lastErrorMessage = err.message || "Profile API verification request failed.";
      return {
        provider: "DHAN",
        connected: false,
        authentication: "FAILED",
        dataAccess: false,
        executionEnabled: false,
        authFlowUsed: this.lastAuthFlowUsed || "DIRECT_TOKEN",
        profileApiStatus: "NETWORK_ERROR",
        tokenConfigured: true,
        tokenLength,
        tokenMasked: true,
        errorCode: "NETWORK_ERROR",
        errorMessage: this.lastErrorMessage,
      };
    }
  }

  /**
   * Handles expired token response, purges token, and triggers regeneration/renewal.
   */
  public async handleExpiredTokenResponse(): Promise<string | null> {
    this.accessToken = null;
    this.authStatus = "EXPIRED";
    const res = await this.authenticateAndVerify();
    if (res.authentication === "VALID" && this.accessToken) {
      return this.accessToken;
    }
    return null;
  }

  public getAuthStatus() {
    return {
      provider: "DHAN" as const,
      isConfigured: this.isConfigured(),
      authStatus: this.authStatus,
      lastAuthTimeMs: this.lastAuthTimeMs,
      tokenExpiryMs: this.tokenExpiryMs,
      isTokenExpired: this.isTokenExpired(),
      lastAuthFlowUsed: this.lastAuthFlowUsed,
      lastErrorMessage: this.lastErrorMessage,
    };
  }

  /**
   * Strips secret fields (PIN, API key, API secret, TOTP secret, access tokens) from outputs.
   */
  public sanitizeOutput(payload: any): any {
    if (!payload || typeof payload !== "object") return payload;
    const clean = Array.isArray(payload) ? [...payload] : { ...payload };
    const SENSITIVE_KEYS = [
      "pin",
      "apiKey",
      "api_key",
      "apiSecret",
      "api_secret",
      "totpSecret",
      "totp_secret",
      "accessToken",
      "access_token",
      "tokenId",
      "token_id",
      "totp",
      "password",
    ];

    for (const key of Object.keys(clean)) {
      if (SENSITIVE_KEYS.some((s) => key.toLowerCase().includes(s.toLowerCase()))) {
        delete clean[key];
      } else if (typeof clean[key] === "object" && clean[key] !== null) {
        clean[key] = this.sanitizeOutput(clean[key]);
      }
    }
    return clean;
  }
}

export const dhanAuthService = new DhanAuthService();
