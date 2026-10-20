/**
 * Live Swing Scanner — Candle Fetcher & Data Validator
 *
 * Fetches genuine daily OHLCV candles from Yahoo Finance for any NSE symbol.
 * Validates data quality before returning to the scanner.
 *
 * Key correctness rules:
 *   - prevClose is candles[len-2].close (previous COMPLETED daily candle).
 *     We do NOT use meta.chartPreviousClose which is the chart start anchor.
 *   - EMA200 is computed from actual closes[] when ≥200 candles are available.
 *     It is NEVER fabricated from ema50 * 0.92 or any other formula.
 *   - If fewer than MIN_CANDLES_REQUIRED candles are returned, the symbol is
 *     marked DATA_INSUFFICIENT and not evaluated.
 *   - The last candle is validated: if it is today before 15:30 IST, it may be
 *     an incomplete intraday candle and is flagged accordingly.
 *   - Abnormal price changes (> 50% in one day) are flagged as ABNORMAL_PRICE.
 *   - Duplicate candle dates are deduplicated (last occurrence wins).
 *   - No fundamental data is fabricated. Fundamental fields that cannot be
 *     sourced are returned as undefined/null with an explicit disclaimer.
 */

import {
  YAHOO_FINANCE_BASE,
  YAHOO_FINANCE_RANGE,
  YAHOO_FINANCE_INTERVAL,
  FETCH_TIMEOUT_MS,
  MIN_CANDLES_BASIC,
  MIN_AVG_VOLUME_20D,
  MAX_DATA_STALENESS_DAYS,
  ABNORMAL_PRICE_CHANGE_PERCENT,
  NSE_MARKET_CLOSE_HOUR_IST,
  NSE_MARKET_CLOSE_MINUTE_IST,
  MAX_RETRIES,
  RETRY_BACKOFF_BASE_MS,
} from "./scannerConfig";
import { yahooRateLimiter } from "./yahooRateLimiter";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface DailyCandle {
  date: string;  // yyyy-mm-dd
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export type SymbolSkipReason =
  | "DATA_FETCH_FAILED"
  | "DATA_INSUFFICIENT"
  | "DATA_STALE"
  | "LAST_CANDLE_INCOMPLETE"
  | "INSUFFICIENT_LIQUIDITY"
  | "ABNORMAL_PRICE"
  | "INVALID_SYMBOL"
  | "RATE_LIMITED";

export interface CandleResult {
  success: true;
  symbol: string;
  candles: DailyCandle[];
  meta: YahooMeta;
  warnings: string[];
  /** True if the last candle is potentially incomplete (today before NSE close). */
  lastCandleMayBeIncomplete: boolean;
}

export interface CandleFailure {
  success: false;
  symbol: string;
  reason: SymbolSkipReason;
  detail: string;
}

export type CandleFetchOutcome = CandleResult | CandleFailure;

export interface YahooMeta {
  /** Live market price from Yahoo meta (may differ from last close). */
  regularMarketPrice?: number;
  regularMarketDayHigh?: number;
  regularMarketDayLow?: number;
  regularMarketVolume?: number;
  regularMarketChangePercent?: number;
  fiftyTwoWeekHigh?: number;
  fiftyTwoWeekLow?: number;
  /** Short company name from Yahoo. */
  shortName?: string;
  longName?: string;
  symbol?: string;
  exchangeTimezoneName?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Returns today's date string in yyyy-mm-dd format in Asia/Kolkata timezone.
 */
function todayISTDateStr(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

/**
 * Returns true if the current time in IST is before NSE market close (15:30).
 */
function isBeforeNSEClose(): boolean {
  const now = new Date();
  const istHour = parseInt(
    now.toLocaleString("en-US", { timeZone: "Asia/Kolkata", hour: "numeric", hour12: false })
  );
  const istMinute = parseInt(
    now.toLocaleString("en-US", { timeZone: "Asia/Kolkata", minute: "numeric" })
  );
  return (
    istHour < NSE_MARKET_CLOSE_HOUR_IST ||
    (istHour === NSE_MARKET_CLOSE_HOUR_IST && istMinute < NSE_MARKET_CLOSE_MINUTE_IST)
  );
}

/**
 * Deduplicates candles by date (last occurrence wins, matching Yahoo Finance
 * behavior where the last entry for a date is the final one).
 */
function deduplicateCandles(candles: DailyCandle[]): DailyCandle[] {
  const seen = new Map<string, DailyCandle>();
  for (const c of candles) {
    seen.set(c.date, c);
  }
  // Preserve chronological order
  return candles.filter((c) => seen.get(c.date) === c);
}

/**
 * Validates a sequence of candles for abnormal prices.
 * Returns a list of warning strings (empty if all good).
 */
function validateCandleSequence(candles: DailyCandle[]): string[] {
  const warnings: string[] = [];
  for (let i = 1; i < candles.length; i++) {
    const prev = candles[i - 1].close;
    const curr = candles[i].close;
    if (prev > 0) {
      const changePct = Math.abs((curr - prev) / prev) * 100;
      if (changePct > ABNORMAL_PRICE_CHANGE_PERCENT) {
        warnings.push(
          `Abnormal price on ${candles[i].date}: ${prev} → ${curr} (${changePct.toFixed(1)}%). Possible corporate action or data error.`
        );
      }
    }
    if (candles[i].close <= 0 || candles[i].open <= 0) {
      warnings.push(`Zero/negative price on ${candles[i].date}`);
    }
  }
  return warnings;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main candle fetcher
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Computes the retry backoff duration with ±25% jitter.
 *
 * Without jitter, all N parallel requests that hit HTTP 429 simultaneously
 * would retry at exactly the same offset (1s, 2s, 4s), creating a
 * thundering-herd burst on Yahoo Finance's rate-limit window.
 *
 * With ±25% jitter the N retries spread across:
 *   attempt 0: 600–1000ms  (base 800ms ± 25%)
 *   attempt 1: 1200–2000ms (base 1600ms ± 25%)
 *   attempt 2: 2400–4000ms (base 3200ms ± 25%)
 *
 * Minimum is 200ms regardless of jitter direction.
 */
function jitteredBackoffMs(retryCount: number): number {
  const base = RETRY_BACKOFF_BASE_MS * Math.pow(2, retryCount);
  const jitter = base * 0.25 * (Math.random() * 2 - 1); // ±25% random
  return Math.max(200, Math.round(base + jitter));
}

/**
 * Fetches genuine daily OHLCV candles for an NSE symbol from Yahoo Finance.
 *
 * Requests 1 year of data to ensure EMA200 can be computed from real candles.
 * Returns a validated CandleFetchOutcome: success with candles or failure with reason.
 *
 * @param symbol - NSE symbol WITHOUT .NS suffix (e.g., "RELIANCE", "TRENT")
 * @param retryCount - internal retry counter (do not set externally)
 */
export async function fetchNseDailyCandles(
  symbol: string,
  retryCount = 0
): Promise<CandleFetchOutcome> {
  const clean = symbol.trim().toUpperCase().replace(/\.NS$/, "").replace(/\.BO$/, "");
  if (!clean || clean.length > 20) {
    return {
      success: false,
      symbol: clean || symbol,
      reason: "INVALID_SYMBOL",
      detail: `Symbol "${symbol}" is empty or unusually long`,
    };
  }

  const yahooTicker = `${clean}.NS`;
  const url = `${YAHOO_FINANCE_BASE}/${encodeURIComponent(yahooTicker)}?interval=${YAHOO_FINANCE_INTERVAL}&range=${YAHOO_FINANCE_RANGE}`;

  try {
    // Wait out any active global cooldown before making the request.
    await yahooRateLimiter.waitIfCoolingDown();

    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        Accept: "application/json",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    if (res.status === 429) {
      yahooRateLimiter.recordRateLimit();
      if (retryCount < MAX_RETRIES) {
        await sleep(jitteredBackoffMs(retryCount));
        return fetchNseDailyCandles(symbol, retryCount + 1);
      }
      return {
        success: false,
        symbol: clean,
        reason: "RATE_LIMITED",
        detail: `Yahoo Finance rate limit hit after ${retryCount + 1} attempts`,
      };
    }

    if (!res.ok) {
      if (res.status === 404 || res.status === 400) {
        return {
          success: false,
          symbol: clean,
          reason: "INVALID_SYMBOL",
          detail: `Yahoo Finance returned HTTP ${res.status} for ${yahooTicker}`,
        };
      }
      if (retryCount < MAX_RETRIES) {
        await sleep(jitteredBackoffMs(retryCount));
        return fetchNseDailyCandles(symbol, retryCount + 1);
      }
      return {
        success: false,
        symbol: clean,
        reason: "DATA_FETCH_FAILED",
        detail: `HTTP ${res.status} from Yahoo Finance for ${yahooTicker}`,
      };
    }

    yahooRateLimiter.recordSuccess();

    const data = await res.json();
    const result = data?.chart?.result?.[0];
    if (!result) {
      return {
        success: false,
        symbol: clean,
        reason: "DATA_FETCH_FAILED",
        detail: `No chart result in Yahoo Finance response for ${yahooTicker}`,
      };
    }

    const meta: YahooMeta = result.meta || {};
    const timestamps: number[] = result.timestamp || [];
    const quotes = result.indicators?.quote?.[0] || {};
    const rawOpens: (number | null)[] = quotes.open || [];
    const rawHighs: (number | null)[] = quotes.high || [];
    const rawLows: (number | null)[] = quotes.low || [];
    const rawCloses: (number | null)[] = quotes.close || [];
    const rawVolumes: (number | null)[] = quotes.volume || [];

    const rawCandles: DailyCandle[] = [];
    for (let i = 0; i < timestamps.length; i++) {
      const c = rawCloses[i];
      const o = rawOpens[i];
      if (c == null || o == null || isNaN(c) || isNaN(o)) continue;

      const high = rawHighs[i] ?? c;
      const low = rawLows[i] ?? c;

      rawCandles.push({
        date: new Date(timestamps[i] * 1000).toISOString().split("T")[0],
        open: Number(o.toFixed(2)),
        high: Number(high.toFixed(2)),
        low: Number(low.toFixed(2)),
        close: Number(c.toFixed(2)),
        volume: rawVolumes[i] || 0,
      });
    }

    const candles = deduplicateCandles(rawCandles);

    if (candles.length < MIN_CANDLES_BASIC) {
      return {
        success: false,
        symbol: clean,
        reason: "DATA_INSUFFICIENT",
        detail: `Only ${candles.length} valid candles returned for ${clean}.NS (minimum ${MIN_CANDLES_BASIC} required)`,
      };
    }

    const lastDate = candles[candles.length - 1].date;
    const lastMs = new Date(lastDate + "T00:00:00+05:30").getTime();
    const ageMs = Date.now() - lastMs;
    const ageDays = ageMs / (1000 * 60 * 60 * 24);
    if (ageDays > MAX_DATA_STALENESS_DAYS) {
      return {
        success: false,
        symbol: clean,
        reason: "DATA_STALE",
        detail: `Last candle for ${clean} is from ${lastDate} (${ageDays.toFixed(1)} days ago, max ${MAX_DATA_STALENESS_DAYS})`,
      };
    }

    const recentVols = candles.slice(-20).map((c) => c.volume);
    const avgVol = recentVols.reduce((a, b) => a + b, 0) / recentVols.length;
    if (avgVol < MIN_AVG_VOLUME_20D) {
      return {
        success: false,
        symbol: clean,
        reason: "INSUFFICIENT_LIQUIDITY",
        detail: `Average 20D volume for ${clean} is ${Math.round(avgVol).toLocaleString()} (minimum ${MIN_AVG_VOLUME_20D.toLocaleString()})`,
      };
    }

    const warnings = validateCandleSequence(candles);

    const todayStr = todayISTDateStr();
    const lastCandleMayBeIncomplete =
      lastDate === todayStr && isBeforeNSEClose();

    return {
      success: true,
      symbol: clean,
      candles,
      meta,
      warnings,
      lastCandleMayBeIncomplete,
    };
  } catch (err: any) {
    const msg = err?.message || "unknown error";

    if (msg.includes("timeout") || msg.includes("AbortError")) {
      if (retryCount < MAX_RETRIES) {
        await sleep(jitteredBackoffMs(retryCount));
        return fetchNseDailyCandles(symbol, retryCount + 1);
      }
      return {
        success: false,
        symbol: clean,
        reason: "DATA_FETCH_FAILED",
        detail: `Timeout fetching ${clean}.NS after ${retryCount + 1} attempts`,
      };
    }

    return {
      success: false,
      symbol: clean,
      reason: "DATA_FETCH_FAILED",
      detail: `Exception fetching ${clean}.NS: ${msg}`,
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────

// Legacy compatibility shim
// This export preserves the existing API used by daily-scanner/route.ts.
// It delegates to the new validated fetcher.
// ─────────────────────────────────────────────────────────────────────────────

export async function fetchLiveStockCandles(symbol: string): Promise<{
  candles: DailyCandle[];
  meta: YahooMeta;
} | null> {
  const outcome = await fetchNseDailyCandles(symbol);
  if (!outcome.success) return null;
  return { candles: outcome.candles, meta: outcome.meta };
}

