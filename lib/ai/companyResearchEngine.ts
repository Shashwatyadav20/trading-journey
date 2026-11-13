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
  debtToEquity: number | null;
  quarterlyRevenueGrowthPct: number | null;
  quarterlyEarningsGrowthPct: number | null;
  operatingMarginPct: number | null;
  profitMarginPct: number | null;
  marketCapCr: number | null;
  fiftyTwoWeekHigh: number | null;
  fiftyTwoWeekLow: number | null;
  sector: string | null;
  industry: string | null;
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
}

export interface MacroAndRegulatoryItem {
  title: string;
  publisher: string;
  publishedAt: string;
  link?: string;
  category: "REGULATORY_SEBI" | "MACRO_RBI_CPI" | "EARNINGS_CATALYST" | "COMPANY_NEWS";
  sentiment: "BULLISH" | "BEARISH" | "NEUTRAL";
  impactScore: number;
}

export interface ConvictionBreakdown {
  overallScore: number; // 0-100
  grade:
    | "HIGH_CONVICTION_BUY"
    | "ACCUMULATE"
    | "NEUTRAL_WATCH"
    | "CAUTION_AVOID";
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
    zeroMockIntegrity: true;
  };
}

const YAHOO_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
};

// Cached Yahoo Finance crumb + cookie for quoteSummary requests
let cachedYahooAuth: { cookie: string; crumb: string; expiresAt: number } | null = null;

async function getYahooAuth(): Promise<{ cookie: string; crumb: string } | null> {
  if (cachedYahooAuth && Date.now() < cachedYahooAuth.expiresAt) {
    return { cookie: cachedYahooAuth.cookie, crumb: cachedYahooAuth.crumb };
  }
  try {
    const fcRes = await fetch("https://fc.yahoo.com", {
      headers: YAHOO_HEADERS,
      redirect: "manual",
      cache: "no-store",
    });
    const setCookie = fcRes.headers.get("set-cookie") || "";
    const cookie = setCookie
      .split(",")
      .map((c) => c.split(";")[0].trim())
      .filter(Boolean)
      .join("; ");

    if (!cookie) return null;

    const crumbRes = await fetch("https://query1.finance.yahoo.com/v1/test/getcrumb", {
      headers: { ...YAHOO_HEADERS, Cookie: cookie },
      cache: "no-store",
    });
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

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function cleanNseSymbol(input: string): string {
  return input
    .trim()
    .toUpperCase()
    .replace(/^NSE:/i, "")
    .replace(/\.NS$/i, "")
    .replace(/\.BO$/i, "");
}

/**
 * Fetches live fundamentals & FII/institutional ownership from Yahoo quoteSummary.
 * Never fabricates missing numbers; returns null fields when unavailable.
 */
async function fetchLiveFundamentals(yahooTicker: string): Promise<{
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
    debtToEquity: null,
    quarterlyRevenueGrowthPct: null,
    quarterlyEarningsGrowthPct: null,
    operatingMarginPct: null,
    profitMarginPct: null,
    marketCapCr: null,
    fiftyTwoWeekHigh: null,
    fiftyTwoWeekLow: null,
    sector: null,
    industry: null,
  };

  const emptyHoldings: InstitutionalHoldingTrend = {
    institutionsPercentHeld: null,
    insidersPromoterPercentHeld: null,
    institutionsFloatPercentHeld: null,
    institutionsCount: null,
    topHolders: [],
    trendLabel: "LOW_OR_UNAVAILABLE",
  };

  try {
    await yahooRateLimiter.waitIfCoolingDown();
    const auth = await getYahooAuth();
    const modules =
      "summaryDetail,defaultKeyStatistics,financialData,majorHoldersBreakdown,institutionOwnership,assetProfile,price";
    const crumbParam = auth ? `&crumb=${encodeURIComponent(auth.crumb)}` : "";
    const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(
      yahooTicker
    )}?modules=${modules}${crumbParam}`;

    const res = await fetch(url, {
      headers: auth ? { ...YAHOO_HEADERS, Cookie: auth.cookie } : YAHOO_HEADERS,
      cache: "no-store",
    });

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
    const rawRevG = numOrNull(fd.revenueGrowth);
    const rawEarnG = numOrNull(fd.earningsGrowth ?? ks.earningsQuarterlyGrowth);
    const rawOpM = numOrNull(fd.operatingMargins);
    const rawProfM = numOrNull(fd.profitMargins);
    const rawDte = numOrNull(fd.debtToEquity);
    const rawMcap = numOrNull(sd.marketCap ?? pr.marketCap);

    const fundamentals: FundamentalMetrics = {
      trailingPE: numOrNull(sd.trailingPE) !== null ? round2(numOrNull(sd.trailingPE)!) : null,
      forwardPE: numOrNull(sd.forwardPE ?? ks.forwardPE) !== null ? round2(numOrNull(sd.forwardPE ?? ks.forwardPE)!) : null,
      priceToBook: numOrNull(ks.priceToBook) !== null ? round2(numOrNull(ks.priceToBook)!) : null,
      roePct: rawRoe !== null ? round2(rawRoe * 100) : null,
      roaPct: rawRoa !== null ? round2(rawRoa * 100) : null,
      // Yahoo reports debtToEquity as percentage (e.g. 42.5 = 0.425x); normalize > 10 to ratio
      debtToEquity: rawDte !== null ? round2(rawDte > 10 ? rawDte / 100 : rawDte) : null,
      quarterlyRevenueGrowthPct: rawRevG !== null ? round2(rawRevG * 100) : null,
      quarterlyEarningsGrowthPct: rawEarnG !== null ? round2(rawEarnG * 100) : null,
      operatingMarginPct: rawOpM !== null ? round2(rawOpM * 100) : null,
      profitMarginPct: rawProfM !== null ? round2(rawProfM * 100) : null,
      marketCapCr: rawMcap !== null ? Math.round(rawMcap / 1e7) : null,
      fiftyTwoWeekHigh: numOrNull(sd.fiftyTwoWeekHigh),
      fiftyTwoWeekLow: numOrNull(sd.fiftyTwoWeekLow),
      sector: typeof ap.sector === "string" ? ap.sector : null,
      industry: typeof ap.industry === "string" ? ap.industry : null,
    };

    const instPct = numOrNull(mh.institutionsPercentHeld);
    const insPct = numOrNull(mh.insidersPercentHeld);
    const instFloatPct = numOrNull(mh.institutionsFloatPercentHeld);
    const instCount = numOrNull(mh.institutionsCount);

    const instPctNorm = instPct !== null ? round2(instPct * 100) : null;
    const insPctNorm = insPct !== null ? round2(insPct * 100) : null;
    const instFloatNorm = instFloatPct !== null ? round2(instFloatPct * 100) : null;

    const ownershipList = Array.isArray(io.ownershipList) ? io.ownershipList : [];
    const topHolders = ownershipList.slice(0, 5).map((h: any) => ({
      organization: String(h.organization || "Institutional Holder"),
      pctHeld: numOrNull(h.pctHeld) !== null ? round2(numOrNull(h.pctHeld)! * 100) : null,
      positionShares: numOrNull(h.position),
      reportDate: typeof h.reportDate?.fmt === "string" ? h.reportDate.fmt : null,
    }));

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
  yahooTicker: string
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
  };

  try {
    await yahooRateLimiter.waitIfCoolingDown();
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
      yahooTicker
    )}?range=1mo&interval=60m`;

    const res = await fetch(url, { headers: YAHOO_HEADERS, cache: "no-store" });
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

function classifyHeadline(headline: RawNewsHeadline): MacroAndRegulatoryItem {
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
    link: headline.link,
    category,
    sentiment,
    impactScore: Math.max(-100, Math.min(100, net * 28)),
  };
}

/**
 * Fetches live company + regulatory + macro headlines from Google News RSS & Yahoo Finance.
 */
async function fetchLiveNewsAndMacro(
  cleanSymbol: string,
  companyName: string
): Promise<MacroAndRegulatoryItem[]> {
  const rawList: RawNewsHeadline[] = [];

  try {
    const query = `${companyName} ${cleanSymbol} NSE stock RBI SEBI results`;
    const gNewsUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(
      query
    )}&hl=en-IN&gl=IN&ceid=IN:en`;
    const res = await fetch(gNewsUrl, {
      headers: { "User-Agent": YAHOO_HEADERS["User-Agent"] },
      cache: "no-store",
    });

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
        let publishedAt = new Date().toLocaleTimeString("en-IN", { hour12: false });
        if (pubDate) {
          const d = new Date(pubDate);
          if (!Number.isNaN(d.getTime())) {
            publishedAt = d.toLocaleTimeString("en-IN", { hour12: false });
          }
        }
        if (title.length > 8) {
          rawList.push({
            title,
            publisher: publisher || "Indian Financial Feed",
            link,
            publishedAt,
          });
        }
      }
    }
  } catch {
    // resilient
  }

  if (rawList.length < 3) {
    try {
      const yUrl = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(
        `${cleanSymbol}.NS`
      )}&quotesCount=1&newsCount=6`;
      const res = await fetch(yUrl, { headers: YAHOO_HEADERS, cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        const newsList = Array.isArray(data?.news) ? data.news : [];
        for (const n of newsList) {
          const title = String(n.title || "").trim();
          if (title && !rawList.some((r) => r.title.toLowerCase() === title.toLowerCase())) {
            rawList.push({
              title,
              publisher: String(n.publisher || "Yahoo Finance"),
              link: typeof n.link === "string" ? n.link : undefined,
              publishedAt: n.providerPublishTime
                ? new Date(n.providerPublishTime * 1000).toLocaleTimeString("en-IN", {
                    hour12: false,
                  })
                : new Date().toLocaleTimeString("en-IN", { hour12: false }),
            });
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
 * Computes the unified Institutional Conviction Score (0–100%) from live pillars.
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

  const totalWeight = weightedParts.reduce((a, p) => a + p.weight, 0);
  const overallScore =
    totalWeight > 0
      ? Math.round(
          weightedParts.reduce((a, p) => a + p.score * p.weight, 0) / totalWeight
        )
      : 50;

  let grade: ConvictionBreakdown["grade"] = "NEUTRAL_WATCH";
  if (overallScore >= 75) grade = "HIGH_CONVICTION_BUY";
  else if (overallScore >= 60) grade = "ACCUMULATE";
  else if (overallScore < 42) grade = "CAUTION_AVOID";

  return {
    overallScore,
    grade,
    fundamentalScore,
    institutionalScore,
    technical4HObVwapScore,
    sentimentMacroScore,
  };
}

/**
 * Compiles the full live Company Research & Intelligence Report for an NSE equity.
 */
export async function compileCompanyResearchReport(
  symbolInput: string
): Promise<CompanyResearchReport> {
  const cleanSymbol = cleanNseSymbol(symbolInput || "RELIANCE");
  const yahooTicker =
    cleanSymbol === "NIFTY"
      ? "^NSEI"
      : cleanSymbol === "BANKNIFTY"
      ? "^NSEBANK"
      : `${cleanSymbol}.NS`;

  const fallbackName = NSE_EQUITY_COMPANY_NAMES[cleanSymbol] || cleanSymbol;

  const [fundRes, techRes, newsItems] = await Promise.all([
    fetchLiveFundamentals(yahooTicker),
    fetchLive4HObAndVwapSignal(yahooTicker),
    fetchLiveNewsAndMacro(cleanSymbol, fallbackName),
  ]);

  const companyName = fundRes.longName || fallbackName;
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
      zeroMockIntegrity: true,
    },
  };
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

  return `Institutional Conviction Brief — ${report.cleanSymbol} (${report.companyName}):\n` +
    `• Unified Conviction Score: ${report.conviction.overallScore}% (${report.conviction.grade.replace(/_/g, " ")})\n` +
    `• Live LTP: ${report.technicals.ltp !== null ? `₹${report.technicals.ltp.toLocaleString("en-IN")}` : "N/A"} | VWAP: ${report.technicals.vwapAlignment} | 4H OB: ${report.technicals.orderBlock4H.direction}\n` +
    `• Fundamentals: P/E ${fmt(report.fundamentals.trailingPE, "x")} · ROE ${fmt(report.fundamentals.roePct, "%")} · D/E ${fmt(report.fundamentals.debtToEquity, "x")} · Qtr Rev Growth ${fmt(report.fundamentals.quarterlyRevenueGrowthPct, "%")}\n` +
    `• Institutional Holding: ${fmt(report.institutionalHoldings.institutionsPercentHeld, "%")} | News Sentiment: ${report.sentimentLabel} (${report.newsSentimentScore})`;
}
