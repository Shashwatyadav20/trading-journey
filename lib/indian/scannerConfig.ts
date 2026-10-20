/**
 * NSE Cash-Market Swing Scanner — Configuration
 *
 * All tunable parameters are here. No hardcoded stock lists, prices, or
 * fundamental values. Data-source URLs and safe guards are centralised.
 */

// ─────────────────────────────────────────────────────────────────────────────
// SAFETY: Live Trading Disabled
// ─────────────────────────────────────────────────────────────────────────────

/** MUST remain false. This is a scanner/paper-trading workflow only. */
export const LIVE_TRADING = false as const;
/** Broker execution is disabled. Scanner does not place orders. */
export const BROKER_EXECUTION_ENABLED = false as const;

// ─────────────────────────────────────────────────────────────────────────────
// Data Provider
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Yahoo Finance v8 chart endpoint.
 * Provides daily OHLCV for NSE equities via <SYMBOL>.NS suffix.
 */
export const YAHOO_FINANCE_BASE =
  "https://query2.finance.yahoo.com/v8/finance/chart";

/** Fetch 1 year of daily candles so EMA200 can be computed from real data. */
export const YAHOO_FINANCE_RANGE = "1y";
export const YAHOO_FINANCE_INTERVAL = "1d";

/** Request timeout per symbol (ms). */
export const FETCH_TIMEOUT_MS = 8000;

// ─────────────────────────────────────────────────────────────────────────────
// NSE Universe Source
// ─────────────────────────────────────────────────────────────────────────────

/**
 * NSE India publicly published equity list CSV.
 * Series=EQ rows are regular cash-market equities.
 * Updated daily on NSE working days.
 */
export const NSE_EQUITY_LIST_URL =
  "https://nsearchives.nseindia.com/content/equities/EQUITY_L.csv";

/** Universe cache TTL: refresh once per calendar day (24h). */
export const UNIVERSE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

// ─────────────────────────────────────────────────────────────────────────────
// Eligibility Filters
// ─────────────────────────────────────────────────────────────────────────────

/** Minimum completed daily candles required for indicator calculation.
 *  EMA200 requires ≥200; we use 220 to allow some warmup slack. */
export const MIN_CANDLES_REQUIRED = 220;

/** Minimum number of candles needed for any indicator to be valid. */
export const MIN_CANDLES_BASIC = 25;

/**
 * Minimum average 20-day volume (shares) for a stock to be considered liquid.
 * Stocks below this threshold are excluded with reason INSUFFICIENT_LIQUIDITY.
 */
export const MIN_AVG_VOLUME_20D = 100_000;

// ─────────────────────────────────────────────────────────────────────────────
// Concurrency & Rate Limiting
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Maximum number of parallel Yahoo Finance requests.
 * At 5 concurrent requests + 250ms batch delay the average throughput is
 * ~10–12 req/sec, well within Yahoo Finance's informal limit (~200 req/min).
 * Reduced from 8 to give more breathing room and reduce 429 frequency.
 */
export const CONCURRENCY_LIMIT = 5;

/** Minimum delay between each batch of concurrent requests (ms).
 * Increased from 150ms to 250ms to further reduce 429 frequency. */
export const BATCH_DELAY_MS = 250;

/** Retry configuration for transient errors (429, 5xx).
 * Increased from 2 to 3 to give one additional attempt after a global cooldown. */
export const MAX_RETRIES = 3;
// 800ms base produces the documented jitter ranges in liveSwingScanner.ts:
//   attempt 0: 600–1000ms  (800ms ± 25%)
//   attempt 1: 1200–2000ms (1600ms ± 25%)
//   attempt 2: 2400–4000ms (3200ms ± 25%)
// Previously 1000ms — corrected to match the docstring and test expectation.
export const RETRY_BACKOFF_BASE_MS = 800;

// ─────────────────────────────────────────────────────────────────────────────
// Data Validation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Maximum allowed gap between the last candle date and today (calendar days).
 * If the last candle is older than this, the data is considered stale.
 */
export const MAX_DATA_STALENESS_DAYS = 5;

/** Threshold above which a single candle's price change is flagged as abnormal. */
export const ABNORMAL_PRICE_CHANGE_PERCENT = 50;

/**
 * NSE market close time (Asia/Kolkata, 24h).
 * Only treat data as "end of day" after this hour.
 */
export const NSE_MARKET_CLOSE_HOUR_IST = 15;
export const NSE_MARKET_CLOSE_MINUTE_IST = 30;

// ─────────────────────────────────────────────────────────────────────────────
// In-memory Cache TTL (API endpoint response cache)
// ─────────────────────────────────────────────────────────────────────────────

/** How long the daily-scanner API response is cached in memory (30 seconds). */
export const SCAN_RESPONSE_CACHE_TTL_MS = 30 * 1000;

// ─────────────────────────────────────────────────────────────────────────────
// NSE Holiday Calendar (hard-coded trading holidays for the current year)
// These are static and updated annually. Source: NSE India official calendar.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * NSE trading holidays for 2026 (yyyy-mm-dd, Asia/Kolkata dates).
 * Source: NSE India official holiday list.
 * Note: This list must be updated each year.
 */
export const NSE_HOLIDAYS_2026: ReadonlySet<string> = new Set([
  "2026-01-26", // Republic Day
  "2026-02-26", // Mahashivratri
  "2026-03-20", // Holi
  "2026-03-31", // Id-Ul-Fitr (Ramzan Id)
  "2026-04-02", // Ram Navami
  "2026-04-03", // Good Friday
  "2026-04-14", // Dr. Baba Saheb Ambedkar Jayanti
  "2026-05-01", // Maharashtra Day
  "2026-08-15", // Independence Day
  "2026-10-02", // Mahatma Gandhi Jayanti/Dussehra
  "2026-10-21", // Diwali Laxmi Pujan
  "2026-10-22", // Diwali Balipratipada
  "2026-11-05", // Guru Nanak Jayanti
  "2026-12-25", // Christmas
]);

export const NSE_HOLIDAYS: ReadonlySet<string> = NSE_HOLIDAYS_2026;

/**
 * Build-time guard: if the current calendar year exceeds the last year covered
 * by the NSE_HOLIDAYS set, throw immediately so the stale calendar is not used
 * silently. Update this constant and add a new NSE_HOLIDAYS_<YEAR> set each December.
 */
const NSE_HOLIDAYS_COVERAGE_THROUGH_YEAR = 2026;
if (typeof process !== 'undefined') {
  const currentYear = new Date().getFullYear();
  if (currentYear > NSE_HOLIDAYS_COVERAGE_THROUGH_YEAR) {
    throw new Error(
      `[scannerConfig] NSE holiday calendar only covers up to ${NSE_HOLIDAYS_COVERAGE_THROUGH_YEAR}. ` +
      `Current year is ${currentYear}. ` +
      `Add NSE_HOLIDAYS_${currentYear} to lib/indian/scannerConfig.ts and update NSE_HOLIDAYS_COVERAGE_THROUGH_YEAR.`
    );
  }
}

/**
 * Returns true if the given date string (yyyy-mm-dd, IST) is a valid NSE
 * trading day (weekday and not a listed holiday).
 */
export function isNSETradingDay(dateStr: string): boolean {
  const d = new Date(dateStr + "T00:00:00+05:30");
  const dow = d.getDay(); // 0=Sun, 6=Sat
  if (dow === 0 || dow === 6) return false;
  return !NSE_HOLIDAYS.has(dateStr);
}

// ─────────────────────────────────────────────────────────────────────────────
// Nifty 500 Expanded Fallback Universe
// This list is used ONLY when the NSE CSV cannot be fetched. It is documented
// as a fallback and the dashboard will report it as such. It is NOT used in
// production scanning when the NSE CSV is available.
// ─────────────────────────────────────────────────────────────────────────────

export const NIFTY_500_FALLBACK_UNIVERSE: readonly string[] = [
  // Nifty 50
  "RELIANCE","TCS","HDFCBANK","BHARTIARTL","ICICIBANK","INFY","SBIN","LT",
  "HINDUNILVR","ITC","BAJFINANCE","KOTAKBANK","AXISBANK","MARUTI","ASIANPAINT",
  "SUNPHARMA","NTPC","ONGC","POWERGRID","TITAN","M&M","BAJAJFINSV","HCLTECH",
  "WIPRO","TECHM","ULTRACEMCO","TATAMOTORS","JSWSTEEL","HINDALCO","TATASTEEL",
  "COALINDIA","ADANIENT","ADANIPORTS","APOLLOHOSP","BPCL","BRITANNIA","CIPLA",
  "DIVISLAB","DRREDDY","EICHERMOT","GRASIM","HDFCLIFE","HEROMOTOCO","INDUSINDBK",
  "NESTLEIND","SBILIFE","SHREECEM","TATACONSUM","TRENT","VEDL",
  // Nifty Next 50 + others
  "ADANIGREEN","ADANITRANS","ABB","AMBUJACEM","BANDHANBNK","BERGEPAINT",
  "BOSCHLTD","CANBK","CHOLAFIN","CUMMINSIND","DABUR","DMART","GAIL","GODREJCP",
  "HAVELLS","ICICIPRULI","IDFCFIRSTB","INDHOTEL","INDUSTOWER","IRCTC","JINDALSTEL",
  "LICI","LUPIN","MCDOWELL-N","MFSL","MUTHOOTFIN","NAUKRI","NMDC","PAGEIND",
  "PETRONET","PIIND","PIDILITIND","PFC","PNB","RECLTD","SAIL","SIEMENS",
  "SOLARINDS","TORNTPHARM","TVSMOTOR","UBL","UNIONBANK","UPL","VOLTAS","ZOMATO",
  // Mid Cap High Beta
  "TATAPOWER","ADANIGAS","HAL","BEL","MPHASIS","PERSISTENT","DIXON","POLYCAB",
  "BSE","CDSL","MCX","ANGELONE","ZYDUSLIFE","IPCALAB","ALKEM","LALPATHLAB",
  "METROPOLIS","KPITTECH","LTTS","COFORGE","HAPPSTMNDS","TANLA","ROUTE",
  "LATENTVIEW","NUVOCO","DEEPAKNTR","NAVINFLUOR","ALKYLAMINE","CLEAN","FINEORG",
  "KALYANKJIL","SENCO","RAJESHEXPO","VBL","BIKAJI","DEVYANI","SAPPHIRE",
  "CAMPUS","MAZDOCK","COCHINSHIP","GRSE","BDL","IRFC",
  "HUDCO","RVNL","NBCC","NLC","SJVN","NHPC","IREDA","CESC","TATACOMM",
  "SUZLON","ORIENTELECTRIC","CROMPTON","VGUARD","AMBER","IFBIND",
  "ELGIEQUIP","THERMAX","BHEL","GMRINFRA","IRB","ASHOKA","HGINFRA",
] as const;
