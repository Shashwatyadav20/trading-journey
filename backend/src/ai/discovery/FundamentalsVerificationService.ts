import type { MarketUniverseEquity } from "./MarketUniverseService";
import type { ExternalCompanyResearchSnapshot } from "../evidence/EvidenceCollector";

export type MetricVerificationStatus = "VERIFIED" | "UNVERIFIED" | "MISSING";
export type MetricOriginType =
  | "EXCHANGE_REPORTED"
  | "COMPANY_REPORTED"
  | "PROVIDER_DERIVED"
  | "ESTIMATED"
  | "MISSING";
export type DataFreshnessStatus = "FRESH" | "STALE" | "UNKNOWN";

export interface VerifiedMetricRecord {
  key: string;
  label: string;
  value: number | null;
  unit: string;
  sourceName: string;
  sourceUrl: string | null;
  reportingPeriod: string | null;
  publishedAt: string | null;
  retrievedAt: string;
  verificationStatus: MetricVerificationStatus;
  originType: MetricOriginType;
}

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

export interface VerifiedCompanyFundamentalsResult {
  isin: string;
  symbol: string;
  officialFiling: OfficialFilingMetadata | null;
  screener: ScreenerFundamentalSupplement | null;
  enrichedSnapshot: ExternalCompanyResearchSnapshot;
  reportingPeriod: string | null;
  publishedAt: string | null;
  retrievedAt: string;
  freshnessStatus: DataFreshnessStatus;
  staleWarnings: string[];
  verifiedMetricCount: number;
  unverifiedMetricCount: number;
  missingMetricCount: number;
  metrics: VerifiedMetricRecord[];
  sourceFailures: string[];
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
  const isoPub = rawDt && Number.isFinite(Date.parse(rawDt))
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

export class FundamentalsVerificationService {
  private readonly cacheByIsin = new Map<string, VerifiedCompanyFundamentalsResult>();
  private readonly bseFilingFn: typeof fetchBseOfficialResultFiling;
  private readonly screenerFn: typeof fetchScreenerFundamentals;

  public constructor(deps?: {
    bseFilingFn?: typeof fetchBseOfficialResultFiling;
    screenerFn?: typeof fetchScreenerFundamentals;
  }) {
    this.bseFilingFn = deps?.bseFilingFn ?? fetchBseOfficialResultFiling;
    this.screenerFn = deps?.screenerFn ?? fetchScreenerFundamentals;
  }

  public async verifyCompanyEvidence(params: {
    equity: MarketUniverseEquity;
    snapshot: ExternalCompanyResearchSnapshot;
    useCache?: boolean;
  }): Promise<VerifiedCompanyFundamentalsResult> {
    const { equity, snapshot } = params;
    if (params.useCache !== false) {
      const cached = this.cacheByIsin.get(equity.isin);
      if (cached) return cached;
    }

    const retrievedAt = new Date().toISOString();
    const sourceFailures: string[] = [];

    const [filingSettled, screenerSettled] = await Promise.allSettled([
      this.bseFilingFn(equity.bseCode),
      this.screenerFn(equity.nseSymbol ?? equity.symbol),
    ]);

    const officialFiling =
      filingSettled.status === "fulfilled" ? filingSettled.value : null;
    if (filingSettled.status === "rejected") {
      sourceFailures.push(
        `BSE filings lookup failed: ${filingSettled.reason instanceof Error ? filingSettled.reason.message : "unknown"}`
      );
    }

    const screener =
      screenerSettled.status === "fulfilled" ? screenerSettled.value : null;
    if (screenerSettled.status === "rejected") {
      sourceFailures.push(
        `Screener supplement lookup failed: ${screenerSettled.reason instanceof Error ? screenerSettled.reason.message : "unknown"}`
      );
    }

    const f = snapshot.fundamentals;
    const h = snapshot.institutionalHoldings;
    const publishedAt = officialFiling?.publishedAt ?? f.publishedAt ?? null;
    const reportingPeriod = f.reportingPeriod ?? null;
    const { freshnessStatus, staleWarnings } = classifyDataFreshness(publishedAt);

    // Enrich snapshot fundamentals only where missing or cross-verified, never inventing values
    const mergedRoce = f.rocePct ?? screener?.rocePct ?? null;
    const mergedRoe = f.roePct ?? screener?.roePct ?? null;
    const mergedPe = f.trailingPE ?? screener?.trailingPE ?? null;
    const mergedPb = f.priceToBook ?? screener?.priceToBook ?? null;
    const mergedMcap = f.marketCapCr ?? screener?.marketCapCr ?? equity.marketCapCr ?? null;

    const enrichedSnapshot: ExternalCompanyResearchSnapshot = {
      ...snapshot,
      fundamentals: {
        ...f,
        rocePct: mergedRoce,
        roePct: mergedRoe,
        trailingPE: mergedPe,
        priceToBook: mergedPb,
        marketCapCr: mergedMcap,
        publishedAt,
      },
      institutionalHoldings: {
        ...h,
        insidersPromoterPercentHeld:
          h.insidersPromoterPercentHeld ??
          (screener?.promoterHoldingPct !== null &&
          screener?.promoterHoldingPct !== undefined
            ? screener.promoterHoldingPct / 100
            : null),
      },
    };

    const ebitdaMarginPct =
      f.ebitdaMarginPct ??
      (f.ebitdaCr !== null &&
      f.ebitdaCr !== undefined &&
      f.revenueCr !== null &&
      f.revenueCr !== undefined &&
      f.revenueCr > 0
        ? Math.round((f.ebitdaCr / f.revenueCr) * 10000) / 100
        : null);

    const promoterPct =
      screener?.promoterHoldingPct ??
      (h.insidersPromoterPercentHeld !== null &&
      h.insidersPromoterPercentHeld !== undefined
        ? Math.round(h.insidersPromoterPercentHeld * 10000) / 100
        : null);

    const hasOfficialFiling = Boolean(officialFiling?.publishedAt);
    const yahooUrl = `https://finance.yahoo.com/quote/${encodeURIComponent(
      equity.nseSymbol ? `${equity.nseSymbol}.NS` : `${equity.symbol}.BO`
    )}`;

    const buildMetric = (
      key: string,
      label: string,
      value: number | null | undefined,
      unit: string,
      opts?: { screenerCrossVerified?: boolean; derived?: boolean }
    ): VerifiedMetricRecord => {
      if (value === null || value === undefined || !Number.isFinite(value)) {
        return {
          key,
          label,
          value: null,
          unit,
          sourceName: "Unavailable",
          sourceUrl: null,
          reportingPeriod,
          publishedAt,
          retrievedAt,
          verificationStatus: "MISSING",
          originType: "MISSING",
        };
      }
      const isVerified = hasOfficialFiling || Boolean(opts?.screenerCrossVerified);
      return {
        key,
        label,
        value,
        unit,
        sourceName: hasOfficialFiling
          ? `${officialFiling!.sourceName} + ${opts?.screenerCrossVerified ? "Screener.in" : "Yahoo Finance"}`
          : opts?.screenerCrossVerified
            ? "Screener.in (Supplementary)"
            : "Yahoo Finance (Supplementary)",
        sourceUrl: officialFiling?.sourceUrl ?? screener?.sourceUrl ?? yahooUrl,
        reportingPeriod,
        publishedAt,
        retrievedAt,
        verificationStatus: isVerified ? "VERIFIED" : "UNVERIFIED",
        originType: opts?.derived
          ? "PROVIDER_DERIVED"
          : hasOfficialFiling
            ? "EXCHANGE_REPORTED"
            : "PROVIDER_DERIVED",
      };
    };

    const metrics: VerifiedMetricRecord[] = [
      buildMetric("revenueCr", "Revenue", f.revenueCr, "Cr"),
      buildMetric("revenueGrowthYoY", "Revenue Growth (YoY/Latest)", f.quarterlyRevenueGrowthPct, "%"),
      buildMetric("revenueGrowthQoQ", "Earnings Growth (QoQ/Latest)", f.quarterlyEarningsGrowthPct, "%"),
      buildMetric("ebitdaCr", "EBITDA", f.ebitdaCr, "Cr"),
      buildMetric("ebitdaMarginPct", "EBITDA Margin", ebitdaMarginPct, "%", { derived: true }),
      buildMetric("netProfitCr", "Net Profit", f.netProfitCr, "Cr"),
      buildMetric("trailingEps", "EPS (TTM)", f.trailingEps, "INR"),
      buildMetric("roePct", "ROE", mergedRoe, "%", {
        screenerCrossVerified: screener?.roePct !== null && screener?.roePct !== undefined,
      }),
      buildMetric("rocePct", "ROCE", mergedRoce, "%", {
        screenerCrossVerified: screener?.rocePct !== null && screener?.rocePct !== undefined,
      }),
      buildMetric("debtToEquity", "Debt-to-Equity", f.debtToEquity, "x"),
      buildMetric("operatingCashFlowCr", "Operating Cash Flow", f.operatingCashFlowCr, "Cr"),
      buildMetric("freeCashFlowCr", "Free Cash Flow", f.freeCashFlowCr, "Cr"),
      buildMetric("promoterHoldingPct", "Promoter Holding", promoterPct, "%", {
        screenerCrossVerified:
          screener?.promoterHoldingPct !== null && screener?.promoterHoldingPct !== undefined,
      }),
      buildMetric("trailingPE", "P/E Ratio", mergedPe, "x", {
        screenerCrossVerified: screener?.trailingPE !== null && screener?.trailingPE !== undefined,
      }),
      buildMetric("priceToBook", "P/B Ratio", mergedPb, "x", {
        screenerCrossVerified: screener?.priceToBook !== null && screener?.priceToBook !== undefined,
      }),
      buildMetric("marketCapCr", "Market Cap", mergedMcap, "Cr", {
        screenerCrossVerified: screener?.marketCapCr !== null && screener?.marketCapCr !== undefined,
      }),
    ];

    const verifiedMetricCount = metrics.filter(
      (m) => m.verificationStatus === "VERIFIED"
    ).length;
    const unverifiedMetricCount = metrics.filter(
      (m) => m.verificationStatus === "UNVERIFIED"
    ).length;
    const missingMetricCount = metrics.filter(
      (m) => m.verificationStatus === "MISSING"
    ).length;

    const result: VerifiedCompanyFundamentalsResult = {
      isin: equity.isin,
      symbol: equity.symbol,
      officialFiling,
      screener,
      enrichedSnapshot,
      reportingPeriod,
      publishedAt,
      retrievedAt,
      freshnessStatus,
      staleWarnings,
      verifiedMetricCount,
      unverifiedMetricCount,
      missingMetricCount,
      metrics,
      sourceFailures,
    };

    this.cacheByIsin.set(equity.isin, result);
    return result;
  }
}

export const fundamentalsVerificationService = new FundamentalsVerificationService();
