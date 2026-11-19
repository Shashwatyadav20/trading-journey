import type { StrategyCandle } from "../../strategies/ImpulseConsolidationDojiStrategy";
import {
  cleanAndValidateCandles,
  type DailyCandle,
} from "../../dailyStrategyScanner";

export type DataFreshnessStatus = "FRESH" | "STALE" | "UNKNOWN";

export interface OfficialFilingMetadata {
  sourceName: string;
  sourceUrl: string | null;
  publishedAt: string | null;
  headline: string | null;
  category: string | null;
  verificationStatus: "VERIFIED" | "UNVERIFIED";
}

export interface ScreenerFundamentalSupplement {
  sourceUrl: string;
  retrievedAt: string;
  sector: string | null;
  industry: string | null;
  marketCapCr: number | null;
  trailingPE: number | null;
  priceToBook: number | null;
  rocePct: number | null;
  roePct: number | null;
  promoterHoldingPct: number | null;
}

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

function parseNumberSafe(raw: string | undefined | null): number | null {
  if (!raw) return null;
  const cleaned = raw.replace(/[,₹%\s]/g, "").trim();
  if (!cleaned) return null;
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : null;
}

export function classifyDataFreshness(
  publishedAt: string | null,
  nowMs: number = Date.now()
): { freshnessStatus: DataFreshnessStatus; staleWarnings: string[] } {
  if (!publishedAt) {
    return {
      freshnessStatus: "UNKNOWN",
      staleWarnings: [
        "Official financial result publication timestamp is unavailable; freshness cannot be verified.",
      ],
    };
  }
  const pubMs = Date.parse(publishedAt);
  if (!Number.isFinite(pubMs)) {
    return {
      freshnessStatus: "UNKNOWN",
      staleWarnings: [
        `Publication timestamp "${publishedAt}" could not be parsed.`,
      ],
    };
  }
  const ageDays = (nowMs - pubMs) / (1000 * 60 * 60 * 24);
  if (ageDays > 120) {
    return {
      freshnessStatus: "STALE",
      staleWarnings: [
        `Latest verified financial filing is ${Math.round(ageDays)} days old (>120-day threshold).`,
      ],
    };
  }
  return { freshnessStatus: "FRESH", staleWarnings: [] };
}

export async function fetchBseOfficialResultFiling(
  bseCode: string | null,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 7000
): Promise<OfficialFilingMetadata | null> {
  if (!bseCode || !/^\d+$/.test(bseCode.trim())) return null;
  const now = new Date();
  const toDate = now.toISOString().slice(0, 10).replace(/-/g, "");
  const from = new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000);
  const prevDate = from.toISOString().slice(0, 10).replace(/-/g, "");

  const url =
    `https://api.bseindia.com/BseIndiaAPI/api/AnnSubCategoryGetData/w` +
    `?pageno=1&strCat=Result&strPrevDate=${prevDate}&strScrip=${encodeURIComponent(bseCode.trim())}` +
    `&strSearch=P&strToDate=${toDate}&strType=C&subcategory=-1`;

  const res = await fetchImpl(url, {
    headers: {
      "User-Agent": BROWSER_UA,
      Referer: "https://www.bseindia.com/",
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) return null;
  const json = (await res.json()) as { Table?: Array<Record<string, unknown>> };
  const rows = Array.isArray(json?.Table) ? json.Table : [];
  if (rows.length === 0) return null;

  const first = rows[0];
  const rawDt =
    (typeof first.DissemDT === "string" && first.DissemDT) ||
    (typeof first.News_submission_dt === "string" && first.News_submission_dt) ||
    (typeof first.DT_TM === "string" && first.DT_TM) ||
    null;
  const isoPub =
    rawDt && Number.isFinite(Date.parse(rawDt))
      ? new Date(rawDt).toISOString()
      : null;
  const attach =
    typeof first.ATTACHMENTNAME === "string" && first.ATTACHMENTNAME.trim()
      ? `https://www.bseindia.com/xml-data/corpfiling/AttachLive/${first.ATTACHMENTNAME.trim()}`
      : typeof first.NSURL === "string" && first.NSURL.trim()
        ? first.NSURL.trim()
        : `https://www.bseindia.com/stock-share-price/x/x/${bseCode.trim()}/`;

  return {
    sourceName: "BSE Official Corporate Filings",
    sourceUrl: attach,
    publishedAt: isoPub,
    headline:
      typeof first.HEADLINE === "string"
        ? first.HEADLINE.trim()
        : typeof first.NEWSSUB === "string"
          ? first.NEWSSUB.trim()
          : null,
    category:
      typeof first.SUBCATNAME === "string"
        ? first.SUBCATNAME.trim()
        : "Financial Results",
    verificationStatus: isoPub ? "VERIFIED" : "UNVERIFIED",
  };
}

export async function fetchScreenerFundamentals(
  symbol: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 7000
): Promise<ScreenerFundamentalSupplement | null> {
  const clean = symbol.trim().toUpperCase();
  if (!clean) return null;
  const urls = [
    `https://www.screener.in/company/${encodeURIComponent(clean)}/consolidated/`,
    `https://www.screener.in/company/${encodeURIComponent(clean)}/`,
  ];

  for (const url of urls) {
    try {
      const res = await fetchImpl(url, {
        headers: { "User-Agent": BROWSER_UA, Accept: "text/html" },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) continue;
      const html = await res.text();
      if (!html.includes("top-ratios")) continue;

      const extractRatio = (label: string): number | null => {
        const re = new RegExp(
          `<span class="name">\\s*${label}\\s*<\\/span>[\\s\\S]*?<span class="number">([^<]+)<\\/span>`,
          "i"
        );
        const m = html.match(re);
        return parseNumberSafe(m?.[1]);
      };

      const sectorMatch = html.match(/title="Broad Sector"[^>]*>([^<]+)<\/a>/i);
      const industryMatch = html.match(/title="Industry"[^>]*>([^<]+)<\/a>/i);
      const promoterMatch = html.match(
        /Promoters[\s\S]*?<td[^>]*>\s*([\d.]+)%?\s*<\/td>/i
      );

      const rocePct = extractRatio("ROCE");
      const roePct = extractRatio("ROE");
      const trailingPE = extractRatio("Stock P/E");
      const marketCapCr = extractRatio("Market Cap");
      const currentPrice = extractRatio("Current Price");
      const bookValue = extractRatio("Book Value");
      const priceToBook =
        currentPrice !== null && bookValue !== null && bookValue > 0
          ? Math.round((currentPrice / bookValue) * 100) / 100
          : null;

      return {
        sourceUrl: url,
        retrievedAt: new Date().toISOString(),
        sector: sectorMatch?.[1]?.trim() || null,
        industry: industryMatch?.[1]?.trim() || null,
        marketCapCr,
        trailingPE,
        priceToBook,
        rocePct,
        roePct,
        promoterHoldingPct: parseNumberSafe(promoterMatch?.[1]),
      };
    } catch {
      // Try standalone fallback
    }
  }
  return null;
}

/**
 * Read-only NSE daily OHLCV fetcher reusing Yahoo Finance v8/finance/chart (.NS).
 * Never fabricates candles; returns empty array on provider error.
 */
export async function fetchReadOnlyNseDailyCandles(
  symbol: string,
  range: string = "5y"
): Promise<{
  ok: boolean;
  provider: string;
  fetchedAtIso: string;
  candles: StrategyCandle[];
  error?: string;
}> {
  const ticker = symbol.startsWith("^") ? symbol : `${symbol.toUpperCase()}.NS`;
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=${range}&interval=1d`;
  const fetchedAtIso = new Date().toISOString();
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      return {
        ok: false,
        provider: "YAHOO_FINANCE_V8",
        fetchedAtIso,
        candles: [],
        error: `HTTP ${res.status}`,
      };
    }
    const json = (await res.json()) as any;
    const r = json?.chart?.result?.[0];
    if (!r) {
      return {
        ok: false,
        provider: "YAHOO_FINANCE_V8",
        fetchedAtIso,
        candles: [],
        error: "Empty chart result",
      };
    }
    const ts: number[] = r.timestamp || [];
    const q = r.indicators?.quote?.[0] || {};
    const dailyRaw: DailyCandle[] = [];
    for (let i = 0; i < ts.length; i++) {
      const o = q.open?.[i],
        h = q.high?.[i],
        l = q.low?.[i],
        c = q.close?.[i],
        v = q.volume?.[i];
      if (
        typeof o === "number" &&
        o > 0 &&
        typeof h === "number" &&
        h > 0 &&
        typeof l === "number" &&
        l > 0 &&
        typeof c === "number" &&
        c > 0 &&
        typeof v === "number" &&
        v > 0 &&
        h >= l
      ) {
        dailyRaw.push({
          date: new Date(ts[i] * 1000).toISOString().slice(0, 10),
          open: o,
          high: h,
          low: l,
          close: c,
          volume: v,
        });
      }
    }
    const cleaned = cleanAndValidateCandles(dailyRaw, {
      requireCompleted: true,
      minCandlesForScan: 45,
      maxStaleDays: 14,
    });
    if (!cleaned.valid) {
      return {
        ok: false,
        provider: "YAHOO_FINANCE_V8",
        fetchedAtIso,
        candles: [],
        error: cleaned.reason,
      };
    }
    const candles: StrategyCandle[] = cleaned.candles.map((d) => ({
      time: Date.parse(`${d.date}T10:00:00.000Z`),
      open: d.open,
      high: d.high,
      low: d.low,
      close: d.close,
      volume: d.volume,
    }));
    return { ok: true, provider: "YAHOO_FINANCE_V8", fetchedAtIso, candles };
  } catch (err: any) {
    return {
      ok: false,
      provider: "YAHOO_FINANCE_V8",
      fetchedAtIso,
      candles: [],
      error: err?.message ?? "Fetch error",
    };
  }
}
