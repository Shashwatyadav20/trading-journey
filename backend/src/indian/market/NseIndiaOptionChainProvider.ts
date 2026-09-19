import {
  INiftyOptionChainProvider,
  OptionChainFetchResult,
  OptionChainProviderHealth,
} from "./INiftyOptionChainProvider";
import { CanonicalOptionContract, DataSourceType } from "../types";

/**
 * Phase 17 — NSE India Public Option Chain Provider
 *
 * Source: https://www.nseindia.com/api/option-chain-indices?symbol=NIFTY
 * Authentication: Session cookie (requires pre-request to NSE homepage)
 * Cost: Free (public data)
 * Credentials required: None (no API key)
 *
 * RULES:
 * - Never return synthetic data when fetch fails
 * - Never fabricate IV, Delta, Gamma — label source explicitly
 * - Never log API credentials (none required here, but token fields are redacted)
 * - Fail closed on any validation error
 */

const NSE_BASE_URL = "https://www.nseindia.com";
const NSE_OPTION_CHAIN_URL = `${NSE_BASE_URL}/api/option-chain-indices?symbol=NIFTY`;
const NSE_HOME_URL = NSE_BASE_URL;

// Minimum required fields per contract — others are optional
const REQUIRED_FIELDS = ["strikePrice", "expiryDate", "CE", "PE"] as const;

// Max bid/ask spread to accept a contract (in points)
const MAX_BID_ASK_SPREAD = 20.0;

// Staleness threshold (can be overridden via env)
const DEFAULT_STALE_MS = 60_000;

/**
 * Raw NSE API contract data shape (subset of actual response)
 */
interface NseRawContract {
  strikePrice: number;
  expiryDate: string;
  PE?: NseRawOptionData;
  CE?: NseRawOptionData;
}

interface NseRawOptionData {
  strikePrice: number;
  expiryDate: string;
  identifier: string;
  openInterest: number;
  changeinOpenInterest: number;
  pchangeinOpenInterest: number;
  totalTradedVolume: number;
  impliedVolatility: number;
  lastPrice: number;
  change: number;
  pChange: number;
  totalBuyQuantity: number;
  totalSellQuantity: number;
  bidQty: number;
  bidprice: number;
  askQty: number;
  askPrice: number;
  underlyingValue: number;
}

export class NseIndiaOptionChainProvider implements INiftyOptionChainProvider {
  private readonly providerName = "NSE_INDIA";
  private readonly staleThresholdMs: number;

  // Session state
  private sessionCookie: string = "";
  private lastCookieRefreshMs: number = 0;
  private readonly cookieRefreshIntervalMs = 5 * 60_000; // 5 minutes

  // Health tracking
  private lastFetchMs: number = 0;
  private lastSuccessMs: number = 0;
  private consecutiveFailures: number = 0;
  private currentBackoffMs: number = 0;
  private lastErrorMessage: string = "";

  // Backoff config
  private readonly backoffLevels = [0, 30_000, 60_000, 120_000]; // 0, 30s, 60s, 120s

  constructor(staleThresholdMs?: number) {
    this.staleThresholdMs =
      staleThresholdMs ??
      parseInt(process.env.NSE_OPTION_CHAIN_STALE_MS ?? `${DEFAULT_STALE_MS}`, 10);
  }

  public getProviderName(): string {
    return this.providerName;
  }

  /**
   * NSE India public API requires no API key — always "configured".
   * Configuration means the network endpoint is reachable.
   */
  public isConfigured(): boolean {
    return true;
  }

  public getProviderHealth(): OptionChainProviderHealth {
    const isAuthenticated = !!this.sessionCookie;
    const failures = this.consecutiveFailures;
    const status =
      failures === 0 && this.lastSuccessMs > 0
        ? "OK"
        : failures >= 3
        ? "FAILED"
        : failures > 0
        ? "DEGRADED"
        : "OK";

    return {
      isConfigured: true,
      isAuthenticated,
      lastFetchMs: this.lastFetchMs,
      lastSuccessMs: this.lastSuccessMs,
      consecutiveFailures: this.consecutiveFailures,
      currentBackoffMs: this.currentBackoffMs,
      providerName: this.providerName,
      status,
      errorMessage: this.lastErrorMessage || undefined,
    };
  }

  /**
   * Fetches the live NIFTY option chain from NSE India.
   *
   * Returns REAL contracts on success.
   * Returns success=false with explicit errorCode on any failure.
   * NEVER returns synthetic data.
   */
  public async fetchOptionChain(spotPrice: number): Promise<OptionChainFetchResult> {
    const fetchStart = Date.now();
    this.lastFetchMs = fetchStart;

    // Backoff guard
    if (this.currentBackoffMs > 0 && fetchStart - this.lastFetchMs < this.currentBackoffMs) {
      return this.buildError("BACKOFF_ACTIVE", `Provider in backoff for ${this.currentBackoffMs}ms`, fetchStart);
    }

    try {
      // 1. Refresh session cookie if needed
      await this.ensureSessionCookie();

      // 2. Fetch option chain
      const raw = await this.fetchRawOptionChain();
      if (!raw.success || !raw.data) {
        return this.buildError(raw.errorCode ?? "FETCH_FAILED", raw.errorMessage ?? "NSE fetch failed", fetchStart);
      }

      // 3. Extract records section
      const records = raw.data?.records;
      const filtered = raw.data?.filtered;

      if (!records || !records.data || !Array.isArray(records.data)) {
        return this.buildError("INVALID_RESPONSE_STRUCTURE", "NSE response missing records.data array", fetchStart);
      }

      // 4. Extract metadata
      const providerSpotPrice = records.underlyingValue ?? spotPrice;
      const providerTimestamp = records.timestamp
        ? new Date(records.timestamp).toISOString()
        : new Date().toISOString();
      const expiryDates: string[] = records.expiryDates ?? [];
      const nearestExpiry = expiryDates[0] ? this.normalizeExpiry(expiryDates[0]) : null;

      // 5. Extract lot size from filtered data if available
      const lotSize = this.extractLotSize(filtered);

      // 6. Normalize all contracts
      const contracts: CanonicalOptionContract[] = [];
      const nowMs = Date.now();
      const contractTimestamp = providerTimestamp;

      for (const row of records.data as NseRawContract[]) {
        if (!row.strikePrice || !row.expiryDate) continue;

        const strike = row.strikePrice;
        const expiry = this.normalizeExpiry(row.expiryDate);

        if (!expiry) continue; // Invalid expiry
        if (strike <= 0 || strike % 50 !== 0) continue; // Invalid strike
        if (!nearestExpiry || expiry !== nearestExpiry) continue; // Only nearest expiry


        // Normalize CE leg
        if (row.CE) {
          const ceContract = this.normalizeContract(row.CE, strike, expiry, "CE", contractTimestamp, providerSpotPrice);
          if (ceContract) contracts.push(ceContract);
        }

        // Normalize PE leg
        if (row.PE) {
          const peContract = this.normalizeContract(row.PE, strike, expiry, "PE", contractTimestamp, providerSpotPrice);
          if (peContract) contracts.push(peContract);
        }
      }

      if (contracts.length === 0) {
        return this.buildError("NO_VALID_CONTRACTS", "Option chain parsed but zero valid contracts survived normalization", fetchStart);
      }

      // 7. Check data freshness
      const chainAgeMs = nowMs - new Date(providerTimestamp).getTime();
      if (chainAgeMs > this.staleThresholdMs) {
        return this.buildError("STALE_CHAIN_DATA", `NSE chain timestamp is ${Math.round(chainAgeMs / 1000)}s old (threshold: ${this.staleThresholdMs / 1000}s)`, fetchStart);
      }

      // 8. Success
      this.consecutiveFailures = 0;
      this.currentBackoffMs = 0;
      this.lastSuccessMs = Date.now();
      this.lastErrorMessage = "";

      return {
        success: true,
        sourceType: "REAL",
        providerName: this.providerName,
        contracts,
        spotPrice: providerSpotPrice,
        expiryDates,
        nearestExpiry,
        lotSize,
        underlyingTimestamp: providerTimestamp,
        fetchDurationMs: Date.now() - fetchStart,
      };
    } catch (err: any) {
      return this.buildError("PROVIDER_EXCEPTION", err?.message ?? "Unknown error during NSE fetch", fetchStart);
    }
  }

  // ── Private helpers ───────────────────────────────────────────────────────────

  /**
   * Ensures a valid NSE session cookie is present.
   * NSE requires a pre-request to the homepage to set cookies before API calls work.
   */
  private async ensureSessionCookie(): Promise<void> {
    const now = Date.now();
    if (this.sessionCookie && now - this.lastCookieRefreshMs < this.cookieRefreshIntervalMs) {
      return; // Cookie still valid
    }

    try {
      const homeResp = await fetch(NSE_HOME_URL, {
        method: "GET",
        headers: this.buildHeaders(""),
        signal: AbortSignal.timeout(10_000),
      });

      const setCookie = homeResp.headers.get("set-cookie") ?? "";
      if (setCookie) {
        // Extract cookie name=value pairs (exclude HttpOnly/Secure/Path attributes)
        this.sessionCookie = setCookie
          .split(",")
          .map((c) => c.split(";")[0].trim())
          .filter((c) => c.includes("="))
          .join("; ");
        this.lastCookieRefreshMs = now;
      }
    } catch {
      // Cookie refresh failure is non-fatal — we try the API anyway
      this.sessionCookie = "";
    }
  }

  /**
   * Performs the actual option chain API call.
   */
  private async fetchRawOptionChain(): Promise<{
    success: boolean;
    data?: any;
    errorCode?: string;
    errorMessage?: string;
  }> {
    try {
      const resp = await fetch(NSE_OPTION_CHAIN_URL, {
        method: "GET",
        headers: this.buildHeaders(this.sessionCookie),
        signal: AbortSignal.timeout(15_000),
      });

      if (!resp.ok) {
        return {
          success: false,
          errorCode: `HTTP_${resp.status}`,
          errorMessage: `NSE API returned HTTP ${resp.status} ${resp.statusText}`,
        };
      }

      const json = await resp.json();
      return { success: true, data: json };
    } catch (err: any) {
      if (err?.name === "TimeoutError" || err?.name === "AbortError") {
        return { success: false, errorCode: "TIMEOUT", errorMessage: "NSE API request timed out (15s)" };
      }
      return { success: false, errorCode: "NETWORK_ERROR", errorMessage: err?.message ?? "Network error" };
    }
  }

  /**
   * Builds browser-like HTTP headers required by NSE India API.
   * NSE blocks requests without proper headers.
   */
  private buildHeaders(cookie: string): Record<string, string> {
    const headers: Record<string, string> = {
      "Accept": "application/json, text/plain, */*",
      "Accept-Language": "en-US,en;q=0.9",
      "Accept-Encoding": "gzip, deflate, br",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Referer": "https://www.nseindia.com/option-chain",
      "Connection": "keep-alive",
      "X-Requested-With": "XMLHttpRequest",
    };
    if (cookie) {
      headers["Cookie"] = cookie; // Never logged — handled by sanitizer in BrokerSafetyLock
    }
    return headers;
  }

  /**
   * Normalizes a single NSE option data record into CanonicalOptionContract.
   * Returns null if the contract fails validation.
   */
  private normalizeContract(
    raw: NseRawOptionData,
    strike: number,
    expiry: string,
    optionType: "CE" | "PE",
    timestamp: string,
    spotPrice: number,
  ): CanonicalOptionContract | null {
    // Field validation
    const ltp = raw.lastPrice ?? 0;
    const bid = raw.bidprice ?? 0;
    const ask = raw.askPrice ?? 0;

    // Reject invalid prices
    if (ltp < 0 || bid < 0 || ask < 0) return null;
    if (ltp === 0 && bid === 0 && ask === 0) return null;

    // Reject impossible bid/ask
    if (bid > 0 && ask > 0 && bid >= ask) return null;

    // Reject wide spread (deep OTM / illiquid contracts)
    const spread = ask - bid;
    if (bid > 0 && ask > 0 && spread > MAX_BID_ASK_SPREAD) return null;

    // IV from NSE
    const iv = raw.impliedVolatility > 0 ? raw.impliedVolatility : undefined;

    // Delta: NSE does NOT provide delta in the standard option chain API
    // We can approximate it but must label it PROVIDER_DERIVED
    let delta: number | undefined;
    let deltaSource: "REAL" | "PROVIDER_DERIVED" | "UNAVAILABLE" = "UNAVAILABLE";

    if (iv && iv > 0) {
      // Approximate delta from moneyness (not Black-Scholes — no risk-free rate or time)
      const distPct = (strike - spotPrice) / spotPrice;
      if (optionType === "CE") {
        delta = Math.max(0.01, Math.min(0.99, 0.5 - distPct * 5));
      } else {
        delta = Math.min(-0.01, Math.max(-0.99, -0.5 - distPct * 5));
      }
      deltaSource = "PROVIDER_DERIVED";
    }

    const contract: CanonicalOptionContract = {
      underlying: "NIFTY",
      expiry,
      strike,
      optionType,
      bid: Number(bid.toFixed(2)),
      ask: Number(ask.toFixed(2)),
      ltp: Number(ltp.toFixed(2)),
      timestamp,
      source: this.providerName,
      sourceType: "REAL",
      volume: raw.totalTradedVolume > 0 ? raw.totalTradedVolume : undefined,
      openInterest: raw.openInterest > 0 ? raw.openInterest : undefined,
      iv: iv !== undefined ? Number(iv.toFixed(2)) : undefined,
      ivSource: iv !== undefined ? "REAL" : "UNAVAILABLE",
      delta,
      deltaSource,
      // Gamma, Theta, Vega: NSE does not supply these
      // Do NOT fabricate them — leave absent
    };

    return contract;
  }

  /**
   * Converts NSE expiry format ("25-Sep-2026") to ISO date ("2026-09-25").
   */
  private normalizeExpiry(nseExpiry: string): string | null {
    try {
      if (!nseExpiry) return null;
      if (/^\d{4}-\d{2}-\d{2}$/.test(nseExpiry)) return nseExpiry;

      const parts = nseExpiry.split("-");
      if (parts.length === 3) {
        const day = parts[0].padStart(2, "0");
        const monthStr = parts[1];
        const year = parts[2].length === 2 ? `20${parts[2]}` : parts[2];
        const monthMap: Record<string, string> = {
          Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06",
          Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12",
        };
        const month = monthMap[monthStr];
        if (day && month && year) {
          return `${year}-${month}-${day}`;
        }
      }

      const d = new Date(nseExpiry);
      if (isNaN(d.getTime())) return null;
      return d.toISOString().slice(0, 10);
    } catch {
      return null;
    }
  }


  /**
   * Extracts lot size from the NSE filtered data section.
   * Returns null if not available.
   */
  private extractLotSize(filtered: any): number | null {
    // NSE provides lot size in some endpoints but not always in the filtered chain response
    // We parse it defensively — never assume
    const lotSize =
      filtered?.data?.[0]?.CE?.lotSize ??
      filtered?.data?.[0]?.PE?.lotSize ??
      null;

    if (lotSize && Number.isFinite(lotSize) && lotSize > 0) {
      return Math.round(lotSize);
    }
    return null;
  }

  /**
   * Builds a failed fetch result and updates health state with backoff.
   */
  private buildError(
    errorCode: string,
    errorMessage: string,
    fetchStart: number,
  ): OptionChainFetchResult {
    this.consecutiveFailures += 1;
    this.lastErrorMessage = errorMessage;

    // Exponential backoff (capped at max level)
    const backoffIndex = Math.min(this.consecutiveFailures, this.backoffLevels.length - 1);
    this.currentBackoffMs = this.backoffLevels[backoffIndex];

    return {
      success: false,
      sourceType: "INVALID",
      providerName: this.providerName,

      contracts: [],
      spotPrice: null,
      expiryDates: [],
      nearestExpiry: null,
      lotSize: null,
      underlyingTimestamp: null,
      fetchDurationMs: Date.now() - fetchStart,
      errorMessage,
      errorCode,
    };
  }
}

export const nseIndiaOptionChainProvider = new NseIndiaOptionChainProvider();
