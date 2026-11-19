/**
 * companyResearchEngine.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Institutional AI Research & Company Intelligence Engine for NSE Equities.
 *
 * ZERO MOCK DATA POLICY:
 *   - Every fundamental metric (P/E, ROE, Debt/Equity, Quarterly Revenue Growth),
 *     institutional holding (FII/DII/Mutual Fund % held), 4H Order Block / VWAP
 *     technical signal, and regulatory/macro news item is fetched LIVE from
 *     Yahoo Finance & Google News RSS.
 *   - Unavailable fields are strictly preserved as `null` (never fabricated).
 *   - Combines Fundamental Health + Institutional Holdings + 4H OB / VWAP +
 *     Live News Sentiment into a unified Institutional Conviction Score (0–100%).
 */

import {
  decodeHtmlEntities,
  NSE_EQUITY_COMPANY_NAMES,
  RawNewsHeadline,
} from "../indian/aiNewsReversalEngine";
import { yahooRateLimiter } from "../indian/yahooRateLimiter";

export interface FundamentalMetrics {
  trailingPE: number | null;
  forwardPE: number | null;
  priceToBook: number | null;
  roePct: number | null;
  roaPct: number | null;
  rocePct?: number | null;
  debtToEquity: number | null;
  quarterlyRevenueGrowthPct: number | null;
  quarterlyEarningsGrowthPct: number | null;
  operatingMarginPct: number | null;
  profitMarginPct: number | null;
  ebitdaMarginPct?: number | null;
  marketCapCr: number | null;
  revenueCr?: number | null;
  netProfitCr?: number | null;
  ebitdaCr?: number | null;
  totalDebtCr?: number | null;
  operatingCashFlowCr?: number | null;
  freeCashFlowCr?: number | null;
  trailingEps?: number | null;
  promoterPledgePct?: number | null;
  fiftyTwoWeekHigh: number | null;
  fiftyTwoWeekLow: number | null;
  sector: string | null;
  industry: string | null;
  publishedAt?: string | null;
  reportingPeriod?: string | null;
  reportingBasis?: "CONSOLIDATED" | "STANDALONE" | null;
}

export interface InstitutionalHoldingTrend {
  institutionsPercentHeld: number | null;
  insidersPromoterPercentHeld: number | null;
  institutionsFloatPercentHeld: number | null;
  institutionsCount: number | null;
  topHolders: Array<{
    organization: string;
    pctHeld: number | null;
    positionShares: number | null;
    reportDate: string | null;
  }>;
  trendLabel: "ACCUMULATING" | "HIGH_INSTITUTIONAL" | "MODERATE" | "LOW_OR_UNAVAILABLE";
  publishedAt?: string | null;
}

export interface TechnicalConfluenceSignal {
  ltp: number | null;
  changePct: number | null;
  vwap: number | null;
  priceVsVwapPct: number | null;
  vwapAlignment: "ABOVE_VWAP" | "BELOW_VWAP" | "UNAVAILABLE";
  ema20: number | null;
  ema20Alignment: "BULLISH" | "BEARISH" | "UNAVAILABLE";
  orderBlock4H: {
    direction: "BULLISH" | "BEARISH" | "NONE";
    bottomPrice: number | null;
    topPrice: number | null;
    retestActive: boolean;
    quality: "STRONG" | "MEDIUM" | "NONE";
    proximityPct: number | null;
  };
  marketPublishedAt?: string | null;
}

export interface MacroAndRegulatoryItem {
  title: string;
  publisher: string;
  publishedAt: string;
  publishedAtIso?: string | null;
  link?: string;
  category: "REGULATORY_SEBI" | "MACRO_RBI_CPI" | "EARNINGS_CATALYST" | "COMPANY_NEWS";
  sentiment: "BULLISH" | "BEARISH" | "NEUTRAL";
  impactScore: number;
}

export type LegacyResearchConclusionLabel =
  | "POSITIVE"
  | "CAUTIOUSLY_POSITIVE"
  | "NEUTRAL"
  | "CAUTIOUSLY_NEGATIVE"
  | "NEGATIVE"
  | "INSUFFICIENT_EVIDENCE";

export type LegacyQualitativeConfidenceLabel =
  | "HIGH"
  | "MODERATE"
  | "LOW"
  | "INSUFFICIENT";

export interface ConvictionBreakdown {
  overallScore: number | null; // Internal heuristic index (not a buy probability), null when INSUFFICIENT_DATA
  grade:
    | "POSITIVE"
    | "ACCUMULATE"
    | "NEUTRAL_WATCH"
    | "CAUTION_AVOID"
    | "INSUFFICIENT_DATA";
  conclusion: LegacyResearchConclusionLabel;
  confidenceClassification: LegacyQualitativeConfidenceLabel;
  isCalculatedHeuristic: true;
  activeCorePillars: number;
  fundamentalScore: number | null;
  institutionalScore: number | null;
  technical4HObVwapScore: number | null;
  sentimentMacroScore: number | null;
}

export interface CompanyResearchReport {
  symbol: string;
  cleanSymbol: string;
  companyName: string;
  fetchedAtIST: string;
  fundamentals: FundamentalMetrics;
  institutionalHoldings: InstitutionalHoldingTrend;
  technicals: TechnicalConfluenceSignal;
  newsAndMacro: MacroAndRegulatoryItem[];
  newsSentimentScore: number; // -100 to +100
  sentimentLabel: "BULLISH" | "NEUTRAL" | "BEARISH";
  catalysts: string[];
  riskWarnings: string[];
  macroFlags: {
    hasRbiMention: boolean;
    hasCpiInflationMention: boolean;
    hasSebiRegulatoryMention: boolean;
  };
  conviction: ConvictionBreakdown;
  dataTelemetry: {
    fundamentalsSource: "YAHOO_QUOTE_SUMMARY_LIVE" | "YAHOO_CHART_ONLY_UNAVAILABLE";
    technicalsSource: "YAHOO_4H_VWAP_LIVE" | "UNAVAILABLE";
    newsSource: "GOOGLE_NEWS_RSS_AND_YAHOO_LIVE" | "NO_HEADLINES_RETURNED";
    feedStatus: "LIVE DATA" | "PARTIAL LIVE DATA" | "CACHED DATA" | "UNAVAILABLE";
    zeroMockIntegrity: true;
  };
}

const YAHOO_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
};

const DEFAULT_HTTP_TIMEOUT_MS = 5_000;
const MAX_YAHOO_COOLDOWN_WAIT_MS = 3_500;
const DEFAULT_RESEARCH_CACHE_TTL_MS = 60_000;
const MAX_RESEARCH_CACHE_ENTRIES = 100;

export interface CompileCompanyResearchOptions {
  forceRefresh?: boolean;
  ttlMs?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  yahooTickerOverride?: string;
  fetcherOverrideForTest?: (symbol: string) => Promise<CompanyResearchReport>;
}

interface CachedResearchEntry {
  report: CompanyResearchReport;
  cachedAt: number;
  expiresAt: number;
}

const inFlightCompanyResearch = new Map<string, Promise<CompanyResearchReport>>();
const companyResearchCache = new Map<string, CachedResearchEntry>();
let totalNetworkFetchCount = 0;

function cloneResearchReport(report: CompanyResearchReport): CompanyResearchReport {
  return JSON.parse(JSON.stringify(report)) as CompanyResearchReport;
}

export function clearCompanyResearchCacheForTest(): void {
  inFlightCompanyResearch.clear();
  companyResearchCache.clear();
  totalNetworkFetchCount = 0;
}

export function getCompanyResearchCacheStatsForTest(): {
  cacheSize: number;
  inFlightSize: number;
  totalNetworkFetchCount: number;
} {
  return {
    cacheSize: companyResearchCache.size,
    inFlightSize: inFlightCompanyResearch.size,
    totalNetworkFetchCount,
  };
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs: number = DEFAULT_HTTP_TIMEOUT_MS,
  parentSignal?: AbortSignal
): Promise<Response> {
  if (parentSignal?.aborted) {
    throw new Error("Request aborted by caller signal");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(new Error(`External HTTP request timed out after ${timeoutMs}ms`));
  }, timeoutMs);

  const onParentAbort = () => {
    controller.abort(new Error("Request aborted by caller signal"));
  };

  if (parentSignal) {
    parentSignal.addEventListener("abort", onParentAbort, { once: true });
  }

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
    if (parentSignal) {
      parentSignal.removeEventListener("abort", onParentAbort);
    }
  }
}

// Cached Yahoo Finance crumb + cookie for quoteSummary requests
let cachedYahooAuth: { cookie: string; crumb: string; expiresAt: number } | null = null;

async function getYahooAuth(
  timeoutMs: number = DEFAULT_HTTP_TIMEOUT_MS,
  signal?: AbortSignal
): Promise<{ cookie: string; crumb: string } | null> {
  if (cachedYahooAuth && Date.now() < cachedYahooAuth.expiresAt) {
    return { cookie: cachedYahooAuth.cookie, crumb: cachedYahooAuth.crumb };
  }
  try {
    const canProceed = await yahooRateLimiter.waitIfCoolingDown(MAX_YAHOO_COOLDOWN_WAIT_MS, signal);
    if (!canProceed) return null;

    const fcRes = await fetchWithTimeout(
      "https://fc.yahoo.com",
      {
        headers: YAHOO_HEADERS,
        redirect: "manual",
        cache: "no-store",
      },
      timeoutMs,
      signal
    );
    if (fcRes.status === 429) {
      yahooRateLimiter.recordRateLimit();
      return null;
    }
    const setCookie = fcRes.headers.get("set-cookie") || "";
    const cookie = setCookie
      .split(",")
      .map((c) => c.split(";")[0].trim())
      .filter(Boolean)
      .join("; ");

    if (!cookie) return null;

    const crumbRes = await fetchWithTimeout(
      "https://query1.finance.yahoo.com/v1/test/getcrumb",
      {
        headers: { ...YAHOO_HEADERS, Cookie: cookie },
        cache: "no-store",
      },
      timeoutMs,
      signal
    );
    if (crumbRes.status === 429) {
      yahooRateLimiter.recordRateLimit();
      return null;
    }
    if (!crumbRes.ok) return null;
    const crumb = (await crumbRes.text()).trim();
    if (!crumb || crumb.includes("<")) return null;

    cachedYahooAuth = {
      cookie,
      crumb,
      expiresAt: Date.now() + 25 * 60 * 1000,
    };
    return { cookie, crumb };
  } catch {
    return null;
  }
}

function numOrNull(val: unknown): number | null {
  if (val === null || val === undefined) return null;
  if (typeof val === "object" && val !== null && "raw" in val) {
    const raw = (val as { raw?: unknown }).raw;
    return typeof raw === "number" && Number.isFinite(raw) ? raw : null;
  }
  const n = Number(val);
  return Number.isFinite(n) ? n : null;
}

function fmtStringOrNull(val: unknown): string | null {
  if (val === null || val === undefined) return null;
  if (typeof val === "string" && val.trim().length > 0) return val.trim();
  if (typeof val === "object" && val !== null && "fmt" in val) {
    const fmt = (val as { fmt?: unknown }).fmt;
    return typeof fmt === "string" && fmt.trim().length > 0 ? fmt.trim() : null;
  }
  return null;
}

function epochToIsoOrNull(val: unknown): string | null {
  const num = numOrNull(val);
  if (num === null || num <= 0) return null;
  const ms = num > 1e12 ? num : num * 1000;
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

const COMPANY_NAME_TO_NSE_SYMBOL: Record<string, string> = {
  "FORCE MOTOR": "FORCEMOT",
  "FORCE MOTORS": "FORCEMOT",
  "FORCE MOTORS LTD": "FORCEMOT",
  "FORCE MOTORS LIMITED": "FORCEMOT",
  "RELIANCE INDUSTRIES": "RELIANCE",
  "RELIANCE INDUSTRIES LTD": "RELIANCE",
  "HDFC BANK": "HDFCBANK",
  "HDFC BANK LTD": "HDFCBANK",
  "TATA CONSULTANCY": "TCS",
  "TATA CONSULTANCY SERVICES": "TCS",
  "BAJAJ FINANCE": "BAJFINANCE",
  "ICICI BANK": "ICICIBANK",
  "SOLAR INDUSTRIES": "SOLARINDS",
  "BHARAT ELECTRONICS": "BEL",
};

export function cleanNseSymbol(input: string): string {
  const cleaned = input
    .trim()
    .toUpperCase()
    .replace(/^NSE:/i, "")
    .replace(/\.NS$/i, "")
    .replace(/\.BO$/i, "")
    .replace(/\s+/g, " ");

  if (COMPANY_NAME_TO_NSE_SYMBOL[cleaned]) {
    return COMPANY_NAME_TO_NSE_SYMBOL[cleaned];
  }

  for (const [sym, name] of Object.entries(NSE_EQUITY_COMPANY_NAMES)) {
    if (name.toUpperCase() === cleaned) {
      return sym;
    }
  }

  return cleaned;
}

/**
 * Resolves company names / multi-word inputs to canonical NSE ticker symbols
 * via local alias map + Yahoo Finance search fallback when needed.
 */
export async function resolveCanonicalNseSymbol(
  input: string,
  timeoutMs: number = DEFAULT_HTTP_TIMEOUT_MS,
  signal?: AbortSignal
): Promise<string> {
  const cleaned = cleanNseSymbol(input || "RELIANCE");
  if (!cleaned.includes(" ") && /^[A-Z0-9&-]{1,20}$/.test(cleaned)) {
    return cleaned;
  }

  try {
    const canProceed = await yahooRateLimiter.waitIfCoolingDown(MAX_YAHOO_COOLDOWN_WAIT_MS, signal);
    if (!canProceed) return cleaned;

    const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(
      cleaned
    )}&quotesCount=6&newsCount=0`;
    const res = await fetchWithTimeout(
      url,
      { headers: YAHOO_HEADERS, cache: "no-store" },
      timeoutMs,
      signal
    );
    if (res.status === 429) {
      yahooRateLimiter.recordRateLimit();
      return cleaned;
    }
    if (res.ok) {
      yahooRateLimiter.recordSuccess();
      const json = (await res.json()) as {
        quotes?: Array<{ symbol?: string; quoteType?: string; exchange?: string }>;
      };
      const nseMatch = (json.quotes ?? []).find(
        (q) =>
          typeof q.symbol === "string" &&
          q.symbol.endsWith(".NS") &&
          (q.quoteType === "EQUITY" || !q.quoteType)
      );
      if (nseMatch?.symbol) {
        return nseMatch.symbol.replace(/\.NS$/i, "").toUpperCase();
      }
    }
  } catch {
    // Fall through to cleaned input
  }

  return cleaned;
}

/**
 * Fetches live fundamentals & FII/institutional ownership from Yahoo quoteSummary.
 * Never fabricates missing numbers; returns null fields when unavailable.
 */
async function fetchLiveFundamentals(
  yahooTicker: string,
  timeoutMs: number = DEFAULT_HTTP_TIMEOUT_MS,
  signal?: AbortSignal
): Promise<{
  fundamentals: FundamentalMetrics;
  institutionalHoldings: InstitutionalHoldingTrend;
  longName: string | null;
  liveFromQuoteSummary: boolean;
}> {
  const emptyFundamentals: FundamentalMetrics = {
    trailingPE: null,
    forwardPE: null,
    priceToBook: null,
    roePct: null,
    roaPct: null,
    rocePct: null,
    debtToEquity: null,
    quarterlyRevenueGrowthPct: null,
    quarterlyEarningsGrowthPct: null,
    operatingMarginPct: null,
    profitMarginPct: null,
    ebitdaMarginPct: null,
    marketCapCr: null,
    revenueCr: null,
    netProfitCr: null,
    ebitdaCr: null,
    totalDebtCr: null,
    operatingCashFlowCr: null,
    freeCashFlowCr: null,
    trailingEps: null,
    promoterPledgePct: null,
    fiftyTwoWeekHigh: null,
    fiftyTwoWeekLow: null,
    sector: null,
    industry: null,
    publishedAt: null,
    reportingPeriod: null,
    reportingBasis: null,
  };

  const emptyHoldings: InstitutionalHoldingTrend = {
    institutionsPercentHeld: null,
    insidersPromoterPercentHeld: null,
    institutionsFloatPercentHeld: null,
    institutionsCount: null,
    topHolders: [],
    trendLabel: "LOW_OR_UNAVAILABLE",
    publishedAt: null,
  };

  try {
    const canProceed = await yahooRateLimiter.waitIfCoolingDown(MAX_YAHOO_COOLDOWN_WAIT_MS, signal);
    if (!canProceed) {
      return {
        fundamentals: emptyFundamentals,
        institutionalHoldings: emptyHoldings,
        longName: null,
        liveFromQuoteSummary: false,
      };
    }

    const auth = await getYahooAuth(timeoutMs, signal);
    const modules =
      "summaryDetail,defaultKeyStatistics,financialData,majorHoldersBreakdown,institutionOwnership,assetProfile,price";
    const crumbParam = auth ? `&crumb=${encodeURIComponent(auth.crumb)}` : "";
    const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(
      yahooTicker
    )}?modules=${modules}${crumbParam}`;

    const res = await fetchWithTimeout(
      url,
      {
        headers: auth ? { ...YAHOO_HEADERS, Cookie: auth.cookie } : YAHOO_HEADERS,
        cache: "no-store",
      },
      timeoutMs,
      signal
    );

    if (res.status === 429) {
      yahooRateLimiter.recordRateLimit();
      return {
        fundamentals: emptyFundamentals,
        institutionalHoldings: emptyHoldings,
        longName: null,
        liveFromQuoteSummary: false,
      };
    }

    if (!res.ok) {
      return {
        fundamentals: emptyFundamentals,
        institutionalHoldings: emptyHoldings,
        longName: null,
        liveFromQuoteSummary: false,
      };
    }

    yahooRateLimiter.recordSuccess();
    const json = await res.json();
    const result = json?.quoteSummary?.result?.[0];
    if (!result) {
      return {
        fundamentals: emptyFundamentals,
        institutionalHoldings: emptyHoldings,
        longName: null,
        liveFromQuoteSummary: false,
      };
    }

    const sd = result.summaryDetail || {};
    const ks = result.defaultKeyStatistics || {};
    const fd = result.financialData || {};
    const mh = result.majorHoldersBreakdown || {};
    const io = result.institutionOwnership || {};
    const ap = result.assetProfile || {};
    const pr = result.price || {};

    const rawRoe = numOrNull(fd.returnOnEquity);
    const rawRoa = numOrNull(fd.returnOnAssets);
    const rawRoce = numOrNull((fd as Record<string, unknown>).returnOnCapitalEmployed);
    const rawRevG = numOrNull(fd.revenueGrowth);
    const rawEarnG = numOrNull(fd.earningsGrowth ?? ks.earningsQuarterlyGrowth);
    const rawOpM = numOrNull(fd.operatingMargins);
    const rawProfM = numOrNull(fd.profitMargins);
    const rawEbitdaM = numOrNull(fd.ebitdaMargins);
    const rawDte = numOrNull(fd.debtToEquity);
    const rawMcap = numOrNull(sd.marketCap ?? pr.marketCap);
    const rawRev = numOrNull(fd.totalRevenue);
    const rawNetIncome = numOrNull(ks.netIncomeToCommon ?? fd.netIncomeToCommon);
    const rawEbitda = numOrNull(fd.ebitda);
    const rawDebt = numOrNull(fd.totalDebt);
    const rawOcf = numOrNull(fd.operatingCashflow);
    const rawFcf = numOrNull(fd.freeCashflow);
    const rawEps = numOrNull(ks.trailingEps ?? sd.trailingEps);
    const rawPledge = numOrNull((mh as Record<string, unknown>).promoterPledgePercent);

    // Yahoo quoteSummary provides reporting period end date (ks.mostRecentQuarter),
    // not an explicit filing publication timestamp. Never copy periodEndDate into publishedAt.
    const fundamentalsPublishedAt: string | null = null;
    const reportingPeriod = fmtStringOrNull(ks.mostRecentQuarter);
    const reportingBasis: "CONSOLIDATED" | "STANDALONE" | null = null;

    const fundamentals: FundamentalMetrics = {
      trailingPE: numOrNull(sd.trailingPE) !== null ? round2(numOrNull(sd.trailingPE)!) : null,
      forwardPE: numOrNull(sd.forwardPE ?? ks.forwardPE) !== null ? round2(numOrNull(sd.forwardPE ?? ks.forwardPE)!) : null,
      priceToBook: numOrNull(ks.priceToBook) !== null ? round2(numOrNull(ks.priceToBook)!) : null,
      roePct: rawRoe !== null ? round2(rawRoe * 100) : null,
      roaPct: rawRoa !== null ? round2(rawRoa * 100) : null,
      rocePct: rawRoce !== null ? round2(rawRoce * 100) : null,
      // Yahoo reports debtToEquity as percentage (e.g. 42.5 = 0.425x); normalize > 10 to ratio
      debtToEquity: rawDte !== null ? round2(rawDte > 10 ? rawDte / 100 : rawDte) : null,
      quarterlyRevenueGrowthPct: rawRevG !== null ? round2(rawRevG * 100) : null,
      quarterlyEarningsGrowthPct: rawEarnG !== null ? round2(rawEarnG * 100) : null,
      operatingMarginPct: rawOpM !== null ? round2(rawOpM * 100) : null,
      profitMarginPct: rawProfM !== null ? round2(rawProfM * 100) : null,
      ebitdaMarginPct: rawEbitdaM !== null ? round2(rawEbitdaM * 100) : null,
      marketCapCr: rawMcap !== null ? Math.round(rawMcap / 1e7) : null,
      revenueCr: rawRev !== null ? round2(rawRev / 1e7) : null,
      netProfitCr: rawNetIncome !== null ? round2(rawNetIncome / 1e7) : null,
      ebitdaCr: rawEbitda !== null ? round2(rawEbitda / 1e7) : null,
      totalDebtCr: rawDebt !== null ? round2(rawDebt / 1e7) : null,
      operatingCashFlowCr: rawOcf !== null ? round2(rawOcf / 1e7) : null,
      freeCashFlowCr: rawFcf !== null ? round2(rawFcf / 1e7) : null,
      trailingEps: rawEps !== null ? round2(rawEps) : null,
      promoterPledgePct: rawPledge !== null ? round2(rawPledge * 100) : null,
      fiftyTwoWeekHigh: numOrNull(sd.fiftyTwoWeekHigh),
      fiftyTwoWeekLow: numOrNull(sd.fiftyTwoWeekLow),
      sector: typeof ap.sector === "string" ? ap.sector : null,
      industry: typeof ap.industry === "string" ? ap.industry : null,
      publishedAt: fundamentalsPublishedAt,
      reportingPeriod,
      reportingBasis,
    };

    const instPct = numOrNull(mh.institutionsPercentHeld);
    const insPct = numOrNull(mh.insidersPercentHeld);
    const instFloatPct = numOrNull(mh.institutionsFloatPercentHeld);
    const instCount = numOrNull(mh.institutionsCount);

    const instPctNorm = instPct !== null ? round2(instPct * 100) : null;
    const insPctNorm = insPct !== null ? round2(insPct * 100) : null;
    const instFloatNorm = instFloatPct !== null ? round2(instFloatPct * 100) : null;

    const ownershipList = Array.isArray(io.ownershipList) ? io.ownershipList : [];
    let holdingsPublishedAt = epochToIsoOrNull((mh as Record<string, unknown>).institutionsMostRecentDate);
    const topHolders = ownershipList.slice(0, 5).map((h: any) => {
      if (!holdingsPublishedAt) {
        const holderIso = epochToIsoOrNull(h.reportDate);
        if (holderIso) holdingsPublishedAt = holderIso;
      }
      return {
        organization: String(h.organization || "Institutional Holder"),
        pctHeld: numOrNull(h.pctHeld) !== null ? round2(numOrNull(h.pctHeld)! * 100) : null,
        positionShares: numOrNull(h.position),
        reportDate: typeof h.reportDate?.fmt === "string" ? h.reportDate.fmt : null,
      };
    });

    let trendLabel: InstitutionalHoldingTrend["trendLabel"] = "LOW_OR_UNAVAILABLE";
    if (instPctNorm !== null) {
      if (instPctNorm >= 30) trendLabel = "HIGH_INSTITUTIONAL";
      else if (instPctNorm >= 15) trendLabel = "ACCUMULATING";
      else trendLabel = "MODERATE";
    }

    return {
      fundamentals,
      institutionalHoldings: {
        institutionsPercentHeld: instPctNorm,
        insidersPromoterPercentHeld: insPctNorm,
        institutionsFloatPercentHeld: instFloatNorm,
        institutionsCount: instCount,
        topHolders,
        trendLabel,
        publishedAt: holdingsPublishedAt,
      },
      longName: typeof pr.longName === "string" ? pr.longName : typeof pr.shortName === "string" ? pr.shortName : null,
      liveFromQuoteSummary: true,
    };
  } catch {
    return {
      fundamentals: emptyFundamentals,
      institutionalHoldings: emptyHoldings,
      longName: null,
      liveFromQuoteSummary: false,
    };
  }
}

interface CandleBar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

function computeEMA(values: number[], period: number): number | null {
  if (values.length < period) return null;
  const k = 2 / (period + 1);
  let ema = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < values.length; i++) {
    ema = values[i] * k + ema * (1 - k);
  }
  return round2(ema);
}

/**
 * Fetches live 60m Yahoo Finance candles to synthesize 4H Order Blocks (SMC PRO+),
 * 20-EMA trend alignment, and live VWAP proximity.
 */
async function fetchLive4HObAndVwapSignal(
  yahooTicker: string,
  timeoutMs: number = DEFAULT_HTTP_TIMEOUT_MS,
  signal?: AbortSignal
): Promise<{ signal: TechnicalConfluenceSignal; live: boolean }> {
  const emptySignal: TechnicalConfluenceSignal = {
    ltp: null,
    changePct: null,
    vwap: null,
    priceVsVwapPct: null,
    vwapAlignment: "UNAVAILABLE",
    ema20: null,
    ema20Alignment: "UNAVAILABLE",
    orderBlock4H: {
      direction: "NONE",
      bottomPrice: null,
      topPrice: null,
      retestActive: false,
      quality: "NONE",
      proximityPct: null,
    },
    marketPublishedAt: null,
  };

  try {
    const canProceed = await yahooRateLimiter.waitIfCoolingDown(MAX_YAHOO_COOLDOWN_WAIT_MS, signal);
    if (!canProceed) {
      return { signal: emptySignal, live: false };
    }
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
      yahooTicker
    )}?range=1mo&interval=60m`;

    const res = await fetchWithTimeout(
      url,
      { headers: YAHOO_HEADERS, cache: "no-store" },
      timeoutMs,
      signal
    );
    if (res.status === 429) {
      yahooRateLimiter.recordRateLimit();
      return { signal: emptySignal, live: false };
    }
    if (!res.ok) return { signal: emptySignal, live: false };

    yahooRateLimiter.recordSuccess();
    const json = await res.json();
    const chartRes = json?.chart?.result?.[0];
    if (!chartRes) return { signal: emptySignal, live: false };

    const meta = chartRes.meta || {};
    const marketPublishedAt = epochToIsoOrNull(meta.regularMarketTime);
    const timestamps: number[] = chartRes.timestamp || [];
    const quote = chartRes.indicators?.quote?.[0] || {};

    const bars60m: CandleBar[] = [];
    for (let i = 0; i < timestamps.length; i++) {
      const o = quote.open?.[i];
      const h = quote.high?.[i];
      const l = quote.low?.[i];
      const c = quote.close?.[i];
      const v = quote.volume?.[i] ?? 0;
      if (
        typeof o === "number" &&
        typeof h === "number" &&
        typeof l === "number" &&
        typeof c === "number" &&
        c > 0
      ) {
        bars60m.push({ time: timestamps[i], open: o, high: h, low: l, close: c, volume: v });
      }
    }

    if (bars60m.length < 8) return { signal: emptySignal, live: false };

    const ltp = round2(
      typeof meta.regularMarketPrice === "number" && meta.regularMarketPrice > 0
        ? meta.regularMarketPrice
        : bars60m[bars60m.length - 1].close
    );
    const prevClose =
      typeof meta.chartPreviousClose === "number" && meta.chartPreviousClose > 0
        ? meta.chartPreviousClose
        : bars60m[Math.max(0, bars60m.length - 8)].close;
    const changePct = round2(((ltp - prevClose) / prevClose) * 100);

    // Compute rolling 20-bar VWAP from recent 60m bars
    const vwapWindow = bars60m.slice(-20);
    let pvSum = 0;
    let volSum = 0;
    for (const b of vwapWindow) {
      const typical = (b.high + b.low + b.close) / 3;
      const vol = Math.max(1, b.volume);
      pvSum += typical * vol;
      volSum += vol;
    }
    const vwap = volSum > 0 ? round2(pvSum / volSum) : null;
    const priceVsVwapPct = vwap ? round2(((ltp - vwap) / vwap) * 100) : null;
    const vwapAlignment: TechnicalConfluenceSignal["vwapAlignment"] =
      vwap === null ? "UNAVAILABLE" : ltp >= vwap ? "ABOVE_VWAP" : "BELOW_VWAP";

    // Synthesize 4H candles (chunks of 4 x 60m)
    const bars4H: CandleBar[] = [];
    for (let i = 0; i < bars60m.length; i += 4) {
      const chunk = bars60m.slice(i, i + 4);
      if (chunk.length === 0) continue;
      bars4H.push({
        time: chunk[0].time,
        open: chunk[0].open,
        high: Math.max(...chunk.map((x) => x.high)),
        low: Math.min(...chunk.map((x) => x.low)),
        close: chunk[chunk.length - 1].close,
        volume: chunk.reduce((a, x) => a + x.volume, 0),
      });
    }

    const ema20 = computeEMA(
      bars4H.map((b) => b.close),
      Math.min(20, bars4H.length)
    );
    const ema20Alignment: TechnicalConfluenceSignal["ema20Alignment"] =
      ema20 === null ? "UNAVAILABLE" : ltp >= ema20 ? "BULLISH" : "BEARISH";

    // Detect nearest active 4H Order Block within +/- 15% of live LTP
    let bestOB: TechnicalConfluenceSignal["orderBlock4H"] = {
      direction: "NONE",
      bottomPrice: null,
      topPrice: null,
      retestActive: false,
      quality: "NONE",
      proximityPct: null,
    };

    const avgBody =
      bars4H.reduce((acc, b) => acc + Math.abs(b.close - b.open), 0) /
      Math.max(1, bars4H.length);

    let minDistance = Infinity;
    for (let i = 1; i < bars4H.length - 1; i++) {
      const ob = bars4H[i];
      const disp = bars4H[i + 1];
      const dispBody = Math.abs(disp.close - disp.open);
      const isStrongDisplacement = dispBody > avgBody * 1.15;
      if (!isStrongDisplacement) continue;

      const isBullishOB = ob.close < ob.open && disp.close > disp.open && disp.close > ob.high;
      const isBearishOB = ob.close > ob.open && disp.close < disp.open && disp.close < ob.low;

      if (!isBullishOB && !isBearishOB) continue;

      const bottom = round2(Math.min(ob.open, ob.close, ob.low));
      const top = round2(Math.max(ob.open, ob.close, ob.high));
      const mid = (bottom + top) / 2;
      const distPct = Math.abs((ltp - mid) / ltp) * 100;

      // Strict +/-15% proximity sanity filter
      if (distPct > 15) continue;

      if (distPct < minDistance) {
        minDistance = distPct;
        const retestActive = ltp >= bottom * 0.995 && ltp <= top * 1.005;
        bestOB = {
          direction: isBullishOB ? "BULLISH" : "BEARISH",
          bottomPrice: bottom,
          topPrice: top,
          retestActive,
          quality: dispBody > avgBody * 1.6 ? "STRONG" : "MEDIUM",
          proximityPct: round2(distPct),
        };
      }
    }

    return {
      signal: {
        ltp,
        changePct,
        vwap,
        priceVsVwapPct,
        vwapAlignment,
        ema20,
        ema20Alignment,
        orderBlock4H: bestOB,
        marketPublishedAt,
      },
      live: true,
    };
  } catch {
    return { signal: emptySignal, live: false };
  }
}

const BULLISH_KEYWORDS = [
  "surge", "rally", "profit", "beat", "growth", "order win", "contract",
  "upgrade", "buy", "outperform", "dividend", "expansion", "record", "approval",
  "fii", "inflow", "rate cut", "cooling inflation", "strong",
];
const BEARISH_KEYWORDS = [
  "fall", "drop", "slump", "loss", "miss", "downgrade", "sell", "penalty",
  "sebi", "probe", "raid", "fraud", "default", "lawsuit", "warning", "debt",
  "outflow", "rate hike", "inflation spike", "weak",
];

function classifyHeadline(
  headline: RawNewsHeadline & { publishedAtIso?: string | null }
): MacroAndRegulatoryItem {
  const lower = headline.title.toLowerCase();
  let bullHits = 0;
  let bearHits = 0;
  for (const w of BULLISH_KEYWORDS) if (lower.includes(w)) bullHits++;
  for (const w of BEARISH_KEYWORDS) if (lower.includes(w)) bearHits++;

  let category: MacroAndRegulatoryItem["category"] = "COMPANY_NEWS";
  if (/\b(sebi|penalty|regulatory|compliance|probe|notice|ban)\b/i.test(lower)) {
    category = "REGULATORY_SEBI";
  } else if (/\b(rbi|cpi|inflation|repo rate|mpc|fed|gdp|fii|dii)\b/i.test(lower)) {
    category = "MACRO_RBI_CPI";
  } else if (/\b(q[1-4]|quarter|results|earnings|ebitda|revenue|order|dividend)\b/i.test(lower)) {
    category = "EARNINGS_CATALYST";
  }

  const net = bullHits - bearHits;
  const sentiment: MacroAndRegulatoryItem["sentiment"] =
    net > 0 ? "BULLISH" : net < 0 ? "BEARISH" : "NEUTRAL";

  return {
    title: headline.title,
    publisher: headline.publisher,
    publishedAt: headline.publishedAt,
    publishedAtIso: headline.publishedAtIso ?? null,
    link: headline.link,
    category,
    sentiment,
    impactScore: Math.max(-100, Math.min(100, net * 28)),
  };
}

/**
 * Fetches live company + regulatory + macro headlines from Google News RSS & Yahoo Finance.
 * Preserves genuine source publication timestamp (publishedAtIso) when present, and never
 * fabricates current retrieval time as publication time when missing.
 */
async function fetchLiveNewsAndMacro(
  cleanSymbol: string,
  companyName: string,
  timeoutMs: number = DEFAULT_HTTP_TIMEOUT_MS,
  signal?: AbortSignal
): Promise<MacroAndRegulatoryItem[]> {
  const rawList: Array<RawNewsHeadline & { publishedAtIso?: string | null }> = [];

  try {
    const query = `${companyName} ${cleanSymbol} NSE stock RBI SEBI results`;
    const gNewsUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(
      query
    )}&hl=en-IN&gl=IN&ceid=IN:en`;
    const res = await fetchWithTimeout(
      gNewsUrl,
      {
        headers: { "User-Agent": YAHOO_HEADERS["User-Agent"] },
        cache: "no-store",
      },
      timeoutMs,
      signal
    );

    if (res.ok) {
      const xml = await res.text();
      const itemRegex =
        /<item>[\s\S]*?<title>(.*?)<\/title>[\s\S]*?<link>(.*?)<\/link>[\s\S]*?<pubDate>(.*?)<\/pubDate>[\s\S]*?(?:<source[^>]*>(.*?)<\/source>)?[\s\S]*?<\/item>/g;
      const matches = [...xml.matchAll(itemRegex)].slice(0, 8);

      for (const m of matches) {
        let title = decodeHtmlEntities(m[1] || "").trim();
        const link = m[2]?.trim();
        const pubDate = m[3]?.trim();
        let publisher = decodeHtmlEntities(m[4] || "").trim();
        if (!publisher && title.includes(" - ")) {
          const parts = title.split(" - ");
          publisher = parts.pop()!.trim();
          title = parts.join(" - ").trim();
        }
        let publishedAt = "UNKNOWN";
        let publishedAtIso: string | null = null;
        if (pubDate) {
          const d = new Date(pubDate);
          if (!Number.isNaN(d.getTime())) {
            publishedAtIso = d.toISOString();
            publishedAt = d.toLocaleTimeString("en-IN", { hour12: false });
          }
        }
        if (title.length > 8) {
          rawList.push({
            title,
            publisher: publisher || "Indian Financial Feed",
            link,
            publishedAt,
            publishedAtIso,
          });
        }
      }
    }
  } catch {
    // resilient
  }

  if (rawList.length < 3) {
    try {
      const canProceed = await yahooRateLimiter.waitIfCoolingDown(MAX_YAHOO_COOLDOWN_WAIT_MS, signal);
      if (canProceed) {
        const yUrl = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(
          `${cleanSymbol}.NS`
        )}&quotesCount=1&newsCount=6`;
        const res = await fetchWithTimeout(
          yUrl,
          { headers: YAHOO_HEADERS, cache: "no-store" },
          timeoutMs,
          signal
        );
        if (res.status === 429) {
          yahooRateLimiter.recordRateLimit();
        } else if (res.ok) {
          yahooRateLimiter.recordSuccess();
          const data = await res.json();
          const newsList = Array.isArray(data?.news) ? data.news : [];
          for (const n of newsList) {
            const title = String(n.title || "").trim();
            if (title && !rawList.some((r) => r.title.toLowerCase() === title.toLowerCase())) {
              const publishedAtIso = epochToIsoOrNull(n.providerPublishTime);
              rawList.push({
                title,
                publisher: String(n.publisher || "Yahoo Finance"),
                link: typeof n.link === "string" ? n.link : undefined,
                publishedAt: publishedAtIso
                  ? new Date(publishedAtIso).toLocaleTimeString("en-IN", {
                      hour12: false,
                    })
                  : "UNKNOWN",
                publishedAtIso,
              });
            }
          }
        }
      }
    } catch {
      // resilient
    }
  }

  return rawList.slice(0, 8).map(classifyHeadline);
}

/**
 * Computes the qualitative Institutional Research Assessment from live pillars.
 * Does not emit a misleading HIGH_CONVICTION_BUY label; maps to qualitative
 * conclusion and confidence classifications aligned with Phase 9.4.
 */
export function computeInstitutionalConviction(
  fundamentals: FundamentalMetrics,
  holdings: InstitutionalHoldingTrend,
  technicals: TechnicalConfluenceSignal,
  newsSentimentScore: number,
  hasRegulatoryRisk: boolean
): ConvictionBreakdown {
  const weightedParts: Array<{ score: number; weight: number }> = [];

  // 1. Fundamental Health (0–100)
  let fundPoints = 50;
  let fundSignals = 0;
  if (fundamentals.roePct !== null) {
    fundSignals++;
    if (fundamentals.roePct >= 20) fundPoints += 18;
    else if (fundamentals.roePct >= 14) fundPoints += 10;
    else if (fundamentals.roePct < 8) fundPoints -= 14;
  }
  if (fundamentals.debtToEquity !== null) {
    fundSignals++;
    if (fundamentals.debtToEquity <= 0.5) fundPoints += 14;
    else if (fundamentals.debtToEquity <= 1.0) fundPoints += 5;
    else if (fundamentals.debtToEquity > 1.8) fundPoints -= 15;
  }
  if (fundamentals.quarterlyRevenueGrowthPct !== null) {
    fundSignals++;
    if (fundamentals.quarterlyRevenueGrowthPct >= 15) fundPoints += 15;
    else if (fundamentals.quarterlyRevenueGrowthPct >= 5) fundPoints += 8;
    else if (fundamentals.quarterlyRevenueGrowthPct < 0) fundPoints -= 15;
  }
  if (fundamentals.trailingPE !== null) {
    fundSignals++;
    if (fundamentals.trailingPE > 0 && fundamentals.trailingPE <= 28) fundPoints += 10;
    else if (fundamentals.trailingPE > 65) fundPoints -= 10;
  }
  const fundamentalScore =
    fundSignals > 0 ? Math.max(0, Math.min(100, Math.round(fundPoints))) : null;
  if (fundamentalScore !== null) weightedParts.push({ score: fundamentalScore, weight: 0.35 });

  // 2. Institutional / FII Holding Score (0–100)
  let institutionalScore: number | null = null;
  if (holdings.institutionsPercentHeld !== null) {
    let instPts = 45;
    if (holdings.institutionsPercentHeld >= 35) instPts += 35;
    else if (holdings.institutionsPercentHeld >= 20) instPts += 25;
    else if (holdings.institutionsPercentHeld >= 10) instPts += 12;
    if ((holdings.insidersPromoterPercentHeld ?? 0) >= 40) instPts += 12;
    institutionalScore = Math.max(0, Math.min(100, Math.round(instPts)));
    weightedParts.push({ score: institutionalScore, weight: 0.2 });
  }

  // 3. 4H Order Block & VWAP Technical Confluence (0–100)
  let technical4HObVwapScore: number | null = null;
  if (technicals.ltp !== null) {
    let techPts = 50;
    if (technicals.vwapAlignment === "ABOVE_VWAP") techPts += 15;
    else if (technicals.vwapAlignment === "BELOW_VWAP") techPts -= 10;

    if (technicals.ema20Alignment === "BULLISH") techPts += 12;
    else if (technicals.ema20Alignment === "BEARISH") techPts -= 10;

    if (technicals.orderBlock4H.direction === "BULLISH") {
      techPts += technicals.orderBlock4H.retestActive ? 22 : 12;
    } else if (technicals.orderBlock4H.direction === "BEARISH") {
      techPts -= technicals.orderBlock4H.retestActive ? 18 : 10;
    }
    technical4HObVwapScore = Math.max(0, Math.min(100, Math.round(techPts)));
    weightedParts.push({ score: technical4HObVwapScore, weight: 0.3 });
  }

  // 4. Live News & Regulatory/Macro Sentiment (0–100)
  let sentimentPts = 50 + newsSentimentScore * 0.4;
  if (hasRegulatoryRisk) sentimentPts -= 15;
  const sentimentMacroScore = Math.max(0, Math.min(100, Math.round(sentimentPts)));
  weightedParts.push({ score: sentimentMacroScore, weight: 0.15 });

  const activeCorePillars = [
    fundamentalScore,
    institutionalScore,
    technical4HObVwapScore,
  ].filter((x) => x !== null).length;

  const totalWeight = weightedParts.reduce((a, p) => a + p.weight, 0);

  if (activeCorePillars < 2 || totalWeight < 0.5) {
    return {
      overallScore: null,
      grade: "INSUFFICIENT_DATA",
      conclusion: "INSUFFICIENT_EVIDENCE",
      confidenceClassification: "INSUFFICIENT",
      isCalculatedHeuristic: true,
      activeCorePillars,
      fundamentalScore,
      institutionalScore,
      technical4HObVwapScore,
      sentimentMacroScore,
    };
  }

  const overallScore = Math.round(
    weightedParts.reduce((a, p) => a + p.score * p.weight, 0) / totalWeight
  );

  let grade: ConvictionBreakdown["grade"] = "NEUTRAL_WATCH";
  let conclusion: LegacyResearchConclusionLabel = "NEUTRAL";
  if (overallScore >= 75) {
    grade = "POSITIVE";
    conclusion = "POSITIVE";
  } else if (overallScore >= 60) {
    grade = "ACCUMULATE";
    conclusion = "CAUTIOUSLY_POSITIVE";
  } else if (overallScore < 42) {
    grade = "CAUTION_AVOID";
    conclusion = "CAUTIOUSLY_NEGATIVE";
  }

  const confidenceClassification: LegacyQualitativeConfidenceLabel =
    activeCorePillars === 3 ? "HIGH" : activeCorePillars === 2 ? "MODERATE" : "LOW";

  return {
    overallScore,
    grade,
    conclusion,
    confidenceClassification,
    isCalculatedHeuristic: true,
    activeCorePillars,
    fundamentalScore,
    institutionalScore,
    technical4HObVwapScore,
    sentimentMacroScore,
  };
}

async function executeUncachedCompanyResearch(
  symbolInput: string,
  timeoutMs: number = DEFAULT_HTTP_TIMEOUT_MS,
  signal?: AbortSignal,
  yahooTickerOverride?: string
): Promise<CompanyResearchReport> {
  totalNetworkFetchCount += 1;
  const cleanSymbol = await resolveCanonicalNseSymbol(symbolInput || "RELIANCE", timeoutMs, signal);
  const yahooTicker =
    yahooTickerOverride ||
    (cleanSymbol === "NIFTY"
      ? "^NSEI"
      : cleanSymbol === "BANKNIFTY"
      ? "^NSEBANK"
      : `${cleanSymbol}.NS`);

  const fallbackName = NSE_EQUITY_COMPANY_NAMES[cleanSymbol] || cleanSymbol;

  const [fundRes, techRes] = await Promise.all([
    fetchLiveFundamentals(yahooTicker, timeoutMs, signal),
    fetchLive4HObAndVwapSignal(yahooTicker, timeoutMs, signal),
  ]);

  const companyName = fundRes.longName || fallbackName;
  const newsItems = await fetchLiveNewsAndMacro(cleanSymbol, companyName, timeoutMs, signal);
  const newsSentimentScore =
    newsItems.length > 0
      ? Math.round(
          newsItems.reduce((acc, n) => acc + n.impactScore, 0) / newsItems.length
        )
      : 0;
  const sentimentLabel: CompanyResearchReport["sentimentLabel"] =
    newsSentimentScore >= 12
      ? "BULLISH"
      : newsSentimentScore <= -12
      ? "BEARISH"
      : "NEUTRAL";

  const hasRbiMention = newsItems.some((n) => /\b(rbi|repo rate|mpc)\b/i.test(n.title));
  const hasCpiInflationMention = newsItems.some((n) =>
    /\b(cpi|inflation)\b/i.test(n.title)
  );
  const hasSebiRegulatoryMention = newsItems.some(
    (n) => n.category === "REGULATORY_SEBI"
  );

  const catalysts: string[] = [];
  const riskWarnings: string[] = [];

  if (fundRes.fundamentals.quarterlyRevenueGrowthPct !== null) {
    if (fundRes.fundamentals.quarterlyRevenueGrowthPct >= 10) {
      catalysts.push(
        `Strong Quarterly Revenue Growth: +${fundRes.fundamentals.quarterlyRevenueGrowthPct}% YoY`
      );
    } else if (fundRes.fundamentals.quarterlyRevenueGrowthPct < 0) {
      riskWarnings.push(
        `Negative Quarterly Revenue Growth: ${fundRes.fundamentals.quarterlyRevenueGrowthPct}% YoY`
      );
    }
  }
  if (fundRes.fundamentals.roePct !== null && fundRes.fundamentals.roePct >= 15) {
    catalysts.push(`High Return on Equity (ROE): ${fundRes.fundamentals.roePct}%`);
  }
  if (fundRes.fundamentals.debtToEquity !== null && fundRes.fundamentals.debtToEquity > 1.5) {
    riskWarnings.push(
      `Elevated Leverage: Debt/Equity at ${fundRes.fundamentals.debtToEquity}x`
    );
  }
  if (techRes.signal.orderBlock4H.direction !== "NONE") {
    catalysts.push(
      `4H ${techRes.signal.orderBlock4H.direction} Order Block (₹${techRes.signal.orderBlock4H.bottomPrice}–₹${techRes.signal.orderBlock4H.topPrice}) · ${
        techRes.signal.orderBlock4H.retestActive ? "RETEST ACTIVE" : `${techRes.signal.orderBlock4H.proximityPct}% away`
      }`
    );
  }
  if (techRes.signal.vwapAlignment === "ABOVE_VWAP") {
    catalysts.push(
      `Trading ${techRes.signal.priceVsVwapPct ?? 0}% above live VWAP (₹${techRes.signal.vwap})`
    );
  } else if (techRes.signal.vwapAlignment === "BELOW_VWAP") {
    riskWarnings.push(
      `Trading ${techRes.signal.priceVsVwapPct ?? 0}% below live VWAP (₹${techRes.signal.vwap})`
    );
  }

  for (const n of newsItems) {
    if (n.sentiment === "BULLISH" && catalysts.length < 5) {
      catalysts.push(`${n.publisher}: ${n.title}`);
    } else if (
      (n.sentiment === "BEARISH" || n.category === "REGULATORY_SEBI") &&
      riskWarnings.length < 5
    ) {
      riskWarnings.push(`[${n.category}] ${n.title}`);
    }
  }

  const conviction = computeInstitutionalConviction(
    fundRes.fundamentals,
    fundRes.institutionalHoldings,
    techRes.signal,
    newsSentimentScore,
    hasSebiRegulatoryMention
  );

  return {
    symbol: yahooTicker,
    cleanSymbol,
    companyName,
    fetchedAtIST:
      new Date().toLocaleTimeString("en-IN", {
        timeZone: "Asia/Kolkata",
        hour12: false,
      }) + " IST",
    fundamentals: fundRes.fundamentals,
    institutionalHoldings: fundRes.institutionalHoldings,
    technicals: techRes.signal,
    newsAndMacro: newsItems,
    newsSentimentScore,
    sentimentLabel,
    catalysts,
    riskWarnings,
    macroFlags: {
      hasRbiMention,
      hasCpiInflationMention,
      hasSebiRegulatoryMention,
    },
    conviction,
    dataTelemetry: {
      fundamentalsSource: fundRes.liveFromQuoteSummary
        ? "YAHOO_QUOTE_SUMMARY_LIVE"
        : "YAHOO_CHART_ONLY_UNAVAILABLE",
      technicalsSource: techRes.live ? "YAHOO_4H_VWAP_LIVE" : "UNAVAILABLE",
      newsSource:
        newsItems.length > 0
          ? "GOOGLE_NEWS_RSS_AND_YAHOO_LIVE"
          : "NO_HEADLINES_RETURNED",
      feedStatus:
        fundRes.liveFromQuoteSummary && techRes.live
          ? "LIVE DATA"
          : fundRes.liveFromQuoteSummary || techRes.live || newsItems.length > 0
            ? "PARTIAL LIVE DATA"
            : "UNAVAILABLE",
      zeroMockIntegrity: true,
    },
  };
}

/**
 * Compiles the full live Company Research & Intelligence Report for an NSE equity.
 * Shares in-flight duplicate requests for the same symbol and caches complete LIVE DATA
 * snapshots for a short bounded TTL (default 60s), returning deep clones to prevent mutation.
 */
export async function compileCompanyResearchReport(
  symbolInput: string,
  options?: CompileCompanyResearchOptions
): Promise<CompanyResearchReport> {
  const normalizedKey = cleanNseSymbol(symbolInput || "RELIANCE");
  const forceRefresh = options?.forceRefresh === true;
  const ttlMs = options?.ttlMs ?? DEFAULT_RESEARCH_CACHE_TTL_MS;
  const timeoutMs = options?.timeoutMs ?? DEFAULT_HTTP_TIMEOUT_MS;

  if (!forceRefresh) {
    const cached = companyResearchCache.get(normalizedKey);
    if (cached) {
      if (Date.now() < cached.expiresAt) {
        return cloneResearchReport(cached.report);
      }
      companyResearchCache.delete(normalizedKey);
    }
  }

  const existingInFlight = inFlightCompanyResearch.get(normalizedKey);
  if (existingInFlight && !forceRefresh) {
    const shared = await existingInFlight;
    return cloneResearchReport(shared);
  }

  const fetchPromise = (async () => {
    try {
      const report = options?.fetcherOverrideForTest
        ? await options.fetcherOverrideForTest(normalizedKey)
        : await executeUncachedCompanyResearch(
            symbolInput,
            timeoutMs,
            options?.signal,
            options?.yahooTickerOverride
          );

      // Only cache complete LIVE DATA results; never cache failed or partial results as successful research
      if (report.dataTelemetry.feedStatus === "LIVE DATA" && ttlMs > 0) {
        if (companyResearchCache.size >= MAX_RESEARCH_CACHE_ENTRIES) {
          const oldestKey = companyResearchCache.keys().next().value;
          if (oldestKey) {
            companyResearchCache.delete(oldestKey);
          }
        }
        companyResearchCache.set(normalizedKey, {
          report: cloneResearchReport(report),
          cachedAt: Date.now(),
          expiresAt: Date.now() + ttlMs,
        });
      }

      return report;
    } finally {
      inFlightCompanyResearch.delete(normalizedKey);
    }
  })();

  inFlightCompanyResearch.set(normalizedKey, fetchPromise);
  const result = await fetchPromise;
  return cloneResearchReport(result);
}

/**
 * Answers a natural-language research query strictly from the live compiled
 * telemetry (Zero Mock Data; never fabricates numbers).
 */
export function synthesizeGroundedResearchAnswer(
  report: CompanyResearchReport,
  question: string
): string {
  const q = question.toLowerCase();
  const fmt = (v: number | null, suffix = "") =>
    v !== null ? `${v}${suffix}` : "N/A (unavailable from live feed)";

  if (/\b(rbi|cpi|macro|sebi|regulat|risk|warning)\b/.test(q)) {
    const macroSummary = [
      `• RBI / Monetary Policy mentions: ${report.macroFlags.hasRbiMention ? "Detected in live headlines" : "None in latest feed"}`,
      `• CPI / Inflation mentions: ${report.macroFlags.hasCpiInflationMention ? "Detected in live headlines" : "None in latest feed"}`,
      `• SEBI / Regulatory alerts: ${report.macroFlags.hasSebiRegulatoryMention ? "Active regulatory mention detected" : "None detected"}`,
    ].join("\n");
    const risks =
      report.riskWarnings.length > 0
        ? report.riskWarnings.map((r) => `  - ${r}`).join("\n")
        : "  - No active bearish or regulatory risk flags in current live telemetry.";
    return `Macro & Regulatory Scan for ${report.cleanSymbol}:\n${macroSummary}\n\nRisk Warnings:\n${risks}`;
  }

  if (/\b(4h|ob|order block|vwap|ema|technical|entry|chart)\b/.test(q)) {
    const t = report.technicals;
    const ob = t.orderBlock4H;
    return `4H Order Block & VWAP Telemetry for ${report.cleanSymbol}:\n` +
      `• Live LTP: ${t.ltp !== null ? `₹${t.ltp.toLocaleString("en-IN")}` : "N/A"} (${fmt(t.changePct, "%")})\n` +
      `• Live VWAP: ${t.vwap !== null ? `₹${t.vwap.toLocaleString("en-IN")}` : "N/A"} (${t.vwapAlignment}, ${fmt(t.priceVsVwapPct, "%")})\n` +
      `• 4H 20-EMA: ${t.ema20 !== null ? `₹${t.ema20.toLocaleString("en-IN")}` : "N/A"} (${t.ema20Alignment})\n` +
      `• Nearest 4H Order Block: ${ob.direction} ${ob.bottomPrice !== null ? `₹${ob.bottomPrice}–₹${ob.topPrice}` : "None within ±15%"} (${ob.retestActive ? "RETEST ACTIVE" : ob.quality})`;
  }

  if (/\b(fii|dii|institution|holding|promoter|fundamental|pe|roe|debt|revenue)\b/.test(q)) {
    const f = report.fundamentals;
    const h = report.institutionalHoldings;
    return `Fundamentals & Institutional Holdings for ${report.cleanSymbol} (${report.companyName}):\n` +
      `• P/E (Trailing / Forward): ${fmt(f.trailingPE, "x")} / ${fmt(f.forwardPE, "x")}\n` +
      `• ROE: ${fmt(f.roePct, "%")} | Debt/Equity: ${fmt(f.debtToEquity, "x")}\n` +
      `• Quarterly Revenue Growth: ${fmt(f.quarterlyRevenueGrowthPct, "%")}\n` +
      `• Institutional (FII/DII/MF) Holding: ${fmt(h.institutionsPercentHeld, "%")} (${h.trendLabel})\n` +
      `• Promoter / Insider Holding: ${fmt(h.insidersPromoterPercentHeld, "%")}`;
  }

  const conclusionLabel =
    report.conviction.conclusion ??
    (report.conviction.grade === "INSUFFICIENT_DATA"
      ? "INSUFFICIENT_EVIDENCE"
      : report.conviction.grade.replace(/_/g, " "));
  const confidenceLabel = report.conviction.confidenceClassification ?? "INSUFFICIENT";

  return `Institutional Research Brief — ${report.cleanSymbol} (${report.companyName}):\n` +
    `• Research Conclusion: ${conclusionLabel} (Evidence Confidence: ${confidenceLabel})\n` +
    `• Live LTP: ${report.technicals.ltp !== null ? `₹${report.technicals.ltp.toLocaleString("en-IN")}` : "N/A"} | VWAP: ${report.technicals.vwapAlignment} | 4H OB: ${report.technicals.orderBlock4H.direction}\n` +
    `• Fundamentals: P/E ${fmt(report.fundamentals.trailingPE, "x")} · ROE ${fmt(report.fundamentals.roePct, "%")} · D/E ${fmt(report.fundamentals.debtToEquity, "x")} · Qtr Rev Growth ${fmt(report.fundamentals.quarterlyRevenueGrowthPct, "%")}\n` +
    `• Institutional Holding: ${fmt(report.institutionalHoldings.institutionsPercentHeld, "%")} | News Sentiment: ${report.sentimentLabel} (${report.newsSentimentScore})`;
}
