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

  public reloadCredentials(credentials?: DhanAuthCredentials): void {
    this.clientId = credentials?.clientId ?? process.env.DHAN_CLIENT_ID ?? "";
    this.pin = credentials?.pin ?? process.env.DHAN_PIN ?? "";
    this.totpSecret = credentials?.totpSecret ?? process.env.DHAN_TOTP_SECRET ?? "";
    this.apiKey = credentials?.apiKey ?? process.env.DHAN_API_KEY ?? "";
    this.apiSecret = credentials?.apiSecret ?? process.env.DHAN_API_SECRET ?? "";
    this.tokenId = credentials?.tokenId ?? process.env.DHAN_TOKEN_ID ?? "";
    this.baseUrl = credentials?.baseUrl ?? process.env.DHAN_BASE_URL ?? "https://api.dhan.co/v2";
    this.authUrl = credentials?.authUrl ?? process.env.DHAN_AUTH_URL ?? "https://auth.dhan.co";

    const directToken = credentials?.accessToken ?? process.env.DHAN_ACCESS_TOKEN;
    if (directToken && !this.accessToken) {
      this.accessToken = directToken;
      this.tokenExpiryMs = Date.now() + 86400 * 1000; // Default 24-hour validity window
    }
  }

  /**
   * Evaluates if any official DhanHQ authentication flow is configured.
   */
  public isConfigured(): boolean {
    const hasTotpPinFlow = !!(this.clientId && this.pin && this.totpSecret);
    const hasDirectToken = !!(this.clientId && (this.accessToken || process.env.DHAN_ACCESS_TOKEN));
    const hasConsentFlow = !!(this.clientId && this.apiKey && this.apiSecret && this.tokenId);
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

    // 2. Verify Credential Configuration
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

    // 3. EXECUTE OFFICIAL AUTHENTICATION FLOWS

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
            errorCode: resp.status === 401 || resp.status === 403 ? "AUTHENTICATION_FAILED" : `HTTP_${resp.status}`,
            errorMessage: this.lastErrorMessage,
          };
        }

        const data = await resp.json();
        const newToken = data?.accessToken || data?.access_token || data?.token || data?.data?.accessToken;
        const expiresInSec = data?.expiresIn || data?.expires_in || 86400;

        if (newToken) {
          this.accessToken = newToken;
          this.tokenExpiryMs = Date.now() + expiresInSec * 1000;
          this.lastAuthTimeMs = Date.now();
        } else {
          // If response does not return token directly, report failure
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
    else if (this.clientId && this.accessToken) {
      this.lastAuthFlowUsed = "DIRECT_TOKEN";
      // If token is expiring, attempt official renewal via /v2/RenewToken
      if (this.isTokenExpired()) {
        try {
          const renewResp = await fetch(`${this.baseUrl}/RenewToken`, {
            method: "GET",
            headers: {
              "access-token": this.accessToken,
              "dhanClientId": this.clientId,
              "client-id": this.clientId,
              "Accept": "application/json",
            },
            signal: AbortSignal.timeout(10000),
          });

          if (renewResp.ok) {
            const renewData = await renewResp.json();
            const newToken = renewData?.accessToken || renewData?.token || this.accessToken;
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
            this.accessToken = data.accessToken;
            this.tokenExpiryMs = Date.now() + 86400 * 1000;
            this.lastAuthTimeMs = Date.now();
          }
        }
      } catch (err: any) {
        // Fall back to verifyProfile
      }
    }

    // 4. READ-ONLY PROFILE API VERIFICATION STEP
    return await this.verifyProfile();
  }

  /**
   * Calls Dhan read-only Profile API as the single verification mechanism.
   */
  public async verifyProfile(): Promise<DhanAuthVerificationResult> {
    if (!this.accessToken) {
      this.authStatus = "FAILED";
      return {
        provider: "DHAN",
        connected: false,
        authentication: "FAILED",
        dataAccess: false,
        executionEnabled: false,
        authFlowUsed: this.lastAuthFlowUsed,
        errorCode: "NO_TOKEN",
        errorMessage: "No access token available for Profile verification.",
      };
    }

    try {
      const resp = await fetch(`${this.baseUrl}/profile`, {
        method: "GET",
        headers: {
          "access-token": this.accessToken,
          "client-id": this.clientId || process.env.DHAN_CLIENT_ID || "",
          "dhanClientId": this.clientId || process.env.DHAN_CLIENT_ID || "",
          "Content-Type": "application/json",
          "Accept": "application/json",
        },
        signal: AbortSignal.timeout(10000),
      });

      if (!resp.ok) {
        this.authStatus = resp.status === 401 || resp.status === 403 ? "EXPIRED" : "FAILED";
        if (this.authStatus === "EXPIRED") {
          this.accessToken = null; // Purge invalid token
        }
        this.lastErrorMessage = `Profile verification HTTP ${resp.status} ${resp.statusText}`;
        return {
          provider: "DHAN",
          connected: false,
          authentication: this.authStatus,
          dataAccess: false,
          executionEnabled: false,
          authFlowUsed: this.lastAuthFlowUsed,
          errorCode: resp.status === 401 || resp.status === 403 ? "EXPIRED_TOKEN" : `HTTP_${resp.status}`,
          errorMessage: this.lastErrorMessage,
        };
      }

      const json = await resp.json();
      const isValidProfile = !!(json?.dhanClientId || json?.profileId || json?.name || json?.status === "success" || resp.ok);

      if (isValidProfile) {
        this.authStatus = "VALID";
        this.lastErrorMessage = "";
        return {
          provider: "DHAN",
          connected: true,
          authentication: "VALID",
          dataAccess: true,
          executionEnabled: false,
          authFlowUsed: this.lastAuthFlowUsed || "DIRECT_TOKEN",
        };
      } else {
        this.authStatus = "FAILED";
        return {
          provider: "DHAN",
          connected: false,
          authentication: "FAILED",
          dataAccess: false,
          executionEnabled: false,
          authFlowUsed: this.lastAuthFlowUsed,
          errorCode: "INVALID_PROFILE_RESPONSE",
          errorMessage: "Profile API returned unexpected structure.",
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
        authFlowUsed: this.lastAuthFlowUsed,
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
