/**
 * NSE Cash-Equity Universe Fetcher
 *
 * Dynamically builds the eligible scanning universe from the NSE India
 * publicly published equities list CSV. Caches results to avoid hammering
 * the NSE servers on every scan request.
 *
 * Source: https://nsearchives.nseindia.com/content/equities/EQUITY_L.csv
 *
 * CSV Columns (as of 2025):
 *   SYMBOL, NAME OF COMPANY, SERIES, DATE OF LISTING, PAID UP VALUE,
 *   MARKET LOT, ISIN NUMBER, FACE VALUE
 *
 * Eligibility criteria:
 *   - SERIES = 'EQ' (regular cash equity; excludes BE, SM, W*, etc.)
 *   - Symbol must be a valid non-empty string
 *   - ETFs, REITs, INVITs are excluded (they don't appear in EQ series)
 *
 * Market cap and volume filters are applied later by the scanner after
 * fetching live candle data for each symbol (we don't have market cap in the
 * NSE CSV).
 */

import {
  NSE_EQUITY_LIST_URL,
  UNIVERSE_CACHE_TTL_MS,
  NIFTY_500_FALLBACK_UNIVERSE,
} from "./scannerConfig";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface NSEEquityRecord {
  symbol: string;
  companyName: string;
  series: string;
  isin: string;
}

export interface NseUniverseResult {
  symbols: string[];
  universeSize: number;
  eligibleCount: number;
  excludedCount: number;
  exclusionReasons: Record<string, number>;
  source: "NSE_CSV" | "FALLBACK_NIFTY_500";
  lastUpdated: string;
  fetchDurationMs: number;
  error?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// In-memory cache
// ─────────────────────────────────────────────────────────────────────────────

interface CacheEntry {
  result: NseUniverseResult;
  timestamp: number;
}

let universeCache: CacheEntry | null = null;

// ─────────────────────────────────────────────────────────────────────────────
// Known exclusion patterns (series / symbol patterns to drop)
// ─────────────────────────────────────────────────────────────────────────────

/** Non-EQ series that appear in the NSE CSV but are not regular equities. */
const EXCLUDED_SERIES = new Set([
  "BE", "BZ", "SM", "ST", "XT", "SS", "IV", "WR", "W1", "W2", "W3", "W4", "W5",
]);

/** Known ETF/index symbols to explicitly skip even if they show as EQ. */
const KNOWN_NON_EQUITIES = new Set([
  "NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY", "NIFTYNXT50",
  "GOLDBEES", "SETFNIF50", "LIQUIDBEES", "CPSEETF", "PSUBNKBEES",
  "MOM100", "JUNIORBEES", "BANKBEES", "LIQUIDCASE", "HDFCNIFTY",
  "MAFANG", "ICICIB22", "SETFNN50",
]);

// ─────────────────────────────────────────────────────────────────────────────
// CSV Parser
// ─────────────────────────────────────────────────────────────────────────────

function parseCsvRow(row: string): string[] {
  // Simple CSV: fields may be quoted, use comma delimiter
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;
  for (const ch of row) {
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      fields.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  fields.push(current.trim());
  return fields;
}

function parseNseCsv(csv: string): {
  records: NSEEquityRecord[];
  exclusionReasons: Record<string, number>;
} {
  const lines = csv.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) {
    return { records: [], exclusionReasons: { EMPTY_FILE: 1 } };
  }

  // Parse header to find column indices
  const header = parseCsvRow(lines[0]).map((h) => h.toUpperCase().trim());
  const symbolIdx = header.findIndex((h) => h === "SYMBOL");
  const nameIdx = header.findIndex((h) => h.includes("NAME") || h.includes("COMPANY"));
  const seriesIdx = header.findIndex((h) => h === "SERIES");
  const isinIdx = header.findIndex((h) => h === "ISIN");

  if (symbolIdx === -1 || seriesIdx === -1) {
    return {
      records: [],
      exclusionReasons: { HEADER_PARSE_FAILED: 1 },
    };
  }

  const records: NSEEquityRecord[] = [];
  const exclusionReasons: Record<string, number> = {};

  const seen = new Set<string>();

  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvRow(lines[i]);
    const symbol = (cols[symbolIdx] || "").trim().toUpperCase();
    const series = (cols[seriesIdx] || "").trim().toUpperCase();
    const companyName = nameIdx >= 0 ? (cols[nameIdx] || symbol).trim() : symbol;
    const isin = isinIdx >= 0 ? (cols[isinIdx] || "").trim() : "";

    // Exclusion checks
    if (!symbol) {
      exclusionReasons.EMPTY_SYMBOL = (exclusionReasons.EMPTY_SYMBOL || 0) + 1;
      continue;
    }
    if (series !== "EQ") {
      const reason = `NON_EQ_SERIES_${series}`;
      exclusionReasons[reason] = (exclusionReasons[reason] || 0) + 1;
      continue;
    }
    if (EXCLUDED_SERIES.has(series)) {
      exclusionReasons.EXCLUDED_SERIES = (exclusionReasons.EXCLUDED_SERIES || 0) + 1;
      continue;
    }
    if (KNOWN_NON_EQUITIES.has(symbol)) {
      exclusionReasons.KNOWN_NON_EQUITY = (exclusionReasons.KNOWN_NON_EQUITY || 0) + 1;
      continue;
    }
    if (symbol.length > 20) {
      exclusionReasons.SYMBOL_TOO_LONG = (exclusionReasons.SYMBOL_TOO_LONG || 0) + 1;
      continue;
    }
    if (seen.has(symbol)) {
      exclusionReasons.DUPLICATE_SYMBOL = (exclusionReasons.DUPLICATE_SYMBOL || 0) + 1;
      continue;
    }

    seen.add(symbol);
    records.push({ symbol, companyName, series, isin });
  }

  return { records, exclusionReasons };
}

// ─────────────────────────────────────────────────────────────────────────────
// Main fetch function
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fetches the NSE equity universe. Uses a 24-hour in-memory cache.
 * If the NSE CSV is unavailable, falls back to the documented Nifty 500 list.
 *
 * @param forceRefresh - Bypass cache and re-fetch.
 */
export async function getNseEquityUniverse(
  forceRefresh = false
): Promise<NseUniverseResult> {
  const now = Date.now();

  // Return cached if still valid
  if (
    !forceRefresh &&
    universeCache &&
    now - universeCache.timestamp < UNIVERSE_CACHE_TTL_MS
  ) {
    return universeCache.result;
  }

  const startMs = Date.now();

  try {
    const res = await fetch(NSE_EQUITY_LIST_URL, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        Accept: "text/csv,text/plain,*/*",
        Referer: "https://www.nseindia.com/",
      },
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    });

    if (!res.ok) {
      throw new Error(`NSE CSV fetch failed: HTTP ${res.status}`);
    }

    const csvText = await res.text();
    if (!csvText || csvText.length < 500) {
      throw new Error("NSE CSV response too short — likely blocked or redirected");
    }

    const { records, exclusionReasons } = parseNseCsv(csvText);

    if (records.length < 100) {
      throw new Error(
        `NSE CSV parsed only ${records.length} records — minimum 100 expected`
      );
    }

    const symbols = records.map((r) => r.symbol);
    const duration = Date.now() - startMs;

    const result: NseUniverseResult = {
      symbols,
      universeSize: symbols.length,
      eligibleCount: symbols.length,
      excludedCount: Object.values(exclusionReasons).reduce((a, b) => a + b, 0),
      exclusionReasons,
      source: "NSE_CSV",
      lastUpdated: new Date().toISOString(),
      fetchDurationMs: duration,
    };

    universeCache = { result, timestamp: now };
    return result;
  } catch (err: any) {
    // Fall back to documented static list
    const fallback = Array.from(NIFTY_500_FALLBACK_UNIVERSE);
    const duration = Date.now() - startMs;

    const result: NseUniverseResult = {
      symbols: fallback,
      universeSize: fallback.length,
      eligibleCount: fallback.length,
      excludedCount: 0,
      exclusionReasons: {},
      source: "FALLBACK_NIFTY_500",
      lastUpdated: new Date().toISOString(),
      fetchDurationMs: duration,
      error: `NSE CSV unavailable: ${err?.message || "unknown error"}. Using documented Nifty 500 fallback (${fallback.length} symbols). This is NOT full NSE coverage.`,
    };

    // Cache fallback for shorter period (15 minutes) so it retries sooner
    universeCache = {
      result,
      timestamp: now - UNIVERSE_CACHE_TTL_MS + 15 * 60 * 1000,
    };
    return result;
  }
}

/**
 * Invalidates the current universe cache, forcing a fresh fetch on next call.
 */
export function invalidateUniverseCache(): void {
  universeCache = null;
}

/**
 * Returns the cached universe without fetching, or null if not cached.
 */
export function getCachedUniverse(): NseUniverseResult | null {
  if (!universeCache) return null;
  return universeCache.result;
}
