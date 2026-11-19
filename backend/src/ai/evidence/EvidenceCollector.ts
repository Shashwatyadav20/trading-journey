import crypto from "node:crypto";
import {
  EvidenceRecord,
  EvidenceValue,
  RawEvidenceInput,
  normalizeEvidenceSymbol,
  sanitizeUntrustedText,
  validateRawEvidenceInput,
} from "./EvidenceSchema";

export type { RawEvidenceInput };

export interface RejectedEvidenceItem {
  input: unknown;
  reasons: string[];
}

export interface EvidenceCollectionResult {
  records: EvidenceRecord[];
  rejected: RejectedEvidenceItem[];
  duplicatesSkipped: number;
}

function isIsoDateTimeString(val: string | null | undefined): val is string {
  if (!val || typeof val !== "string") return false;
  const trimmed = val.trim();
  if (!trimmed || trimmed === "UNKNOWN") return false;
  if (!/^\d{4}-\d{2}-\d{2}T/.test(trimmed)) return false;
  return !Number.isNaN(Date.parse(trimmed));
}

/**
 * Minimal structural interface matching CompanyResearchReport from
 * lib/ai/companyResearchEngine.ts so EvidenceCollector reuses existing
 * collectors safely without duplicating network/fetch logic.
 */
export interface ExternalCompanyResearchSnapshot {
  symbol: string;
  cleanSymbol: string;
  companyName: string;
  fetchedAtIST?: string;
  fundamentals: {
    trailingPE: number | null;
    forwardPE: number | null;
    priceToBook: number | null;
    roePct: number | null;
    rocePct?: number | null;
    debtToEquity: number | null;
    quarterlyRevenueGrowthPct: number | null;
    quarterlyEarningsGrowthPct: number | null;
    operatingMarginPct: number | null;
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
    publishedAt?: string | null;
    reportingPeriod?: string | null;
    reportingBasis?: "CONSOLIDATED" | "STANDALONE" | null;
  };
  institutionalHoldings: {
    institutionsPercentHeld: number | null;
    insidersPromoterPercentHeld: number | null;
    institutionsCount: number | null;
    publishedAt?: string | null;
  };
  technicals: {
    ltp: number | null;
    changePct: number | null;
    vwap: number | null;
    ema20: number | null;
    marketPublishedAt?: string | null;
  };
  newsAndMacro: Array<{
    title: string;
    publisher: string;
    publishedAt: string;
    publishedAtIso?: string | null;
    link?: string;
    category: string;
    sentiment: string;
  }>;
}

function buildDedupeKey(
  symbol: string,
  category: string,
  claim: string,
  source: string,
  value: EvidenceValue,
  publishedAt: string | null
): string {
  return [
    symbol,
    category,
    claim.trim().toLowerCase(),
    source.trim().toLowerCase(),
    value === null ? "NULL" : String(value),
    publishedAt ?? "NO_PUB",
  ].join("|");
}

function generateDeterministicEvidenceId(dedupeKey: string): string {
  const hash = crypto.createHash("sha256").update(dedupeKey).digest("hex").slice(0, 12);
  return `ev_${hash}`;
}

export class EvidenceCollector {
  /**
   * Normalizes, validates, deduplicates, and collects raw evidence inputs.
   * Missing values remain `null` and are NEVER converted to 0.
   */
  public collect(
    inputs: RawEvidenceInput[],
    options?: { retrievedAt?: string }
  ): EvidenceCollectionResult {
    const defaultRetrievedAt = options?.retrievedAt ?? new Date().toISOString();
    const records: EvidenceRecord[] = [];
    const rejected: RejectedEvidenceItem[] = [];
    const seenKeys = new Set<string>();
    let duplicatesSkipped = 0;

    for (const raw of inputs) {
      const validation = validateRawEvidenceInput(raw);
      if (!validation.valid) {
        rejected.push({ input: raw, reasons: validation.errors });
        continue;
      }

      const symbol = validation.normalizedSymbol;
      const sanitizedClaim = sanitizeUntrustedText(raw.claim);
      const sanitizedSource = sanitizeUntrustedText(raw.source);
      const retrievedAt = raw.retrievedAt
        ? new Date(raw.retrievedAt).toISOString()
        : defaultRetrievedAt;
      const publishedAt =
        raw.publishedAt !== undefined && raw.publishedAt !== null
          ? new Date(raw.publishedAt).toISOString()
          : null;

      // Preserve null strictly when value is missing/undefined; sanitize string values
      const normalizedValue: EvidenceValue =
        raw.value === undefined || raw.value === null
          ? null
          : typeof raw.value === "string"
            ? sanitizeUntrustedText(raw.value)
            : raw.value;

      const sourceUrl =
        typeof raw.sourceUrl === "string" && raw.sourceUrl.trim().length > 0
          ? raw.sourceUrl.trim()
          : null;

      const dedupeKey = buildDedupeKey(
        symbol,
        raw.category,
        sanitizedClaim,
        sanitizedSource,
        normalizedValue,
        publishedAt
      );

      if (seenKeys.has(dedupeKey)) {
        duplicatesSkipped++;
        continue;
      }
      seenKeys.add(dedupeKey);

      const unit = raw.unit ? raw.unit.trim().toUpperCase() : null;
      const currency = raw.currency ? raw.currency.trim().toUpperCase() : null;

      const sanitizedMetadata: Record<string, unknown> = {
        ...(raw.metadata ?? {}),
        originalValue: normalizedValue,
        originalUnit: unit,
        originalCurrency: currency,
      };

      if (raw.untrustedText) {
        sanitizedMetadata.untrustedText = sanitizeUntrustedText(raw.untrustedText);
      }

      const dataPeriod =
        typeof raw.metadata?.dataPeriod === "string" && raw.metadata.dataPeriod.trim().length > 0
          ? raw.metadata.dataPeriod.trim()
          : null;

      records.push({
        evidenceId: raw.evidenceId?.trim() || generateDeterministicEvidenceId(dedupeKey),
        symbol,
        category: raw.category,
        claim: sanitizedClaim,
        value: normalizedValue,
        unit,
        currency,
        source: sanitizedSource,
        sourceTier: "UNKNOWN",
        dataPeriod,
        sourceUrl,
        publishedAt,
        retrievedAt,
        freshness: "STALE", // Evaluated by FreshnessValidator
        verificationStatus: "UNVERIFIED", // Evaluated by SourceVerifier & ConflictResolver
        verificationMethod: "NONE",
        confidence: 0,
        supportingEvidenceIds: [],
        conflictingEvidenceIds: [],
        untrustedExternal: true,
        metadata: sanitizedMetadata,
      });
    }

    return { records, rejected, duplicatesSkipped };
  }

  /**
   * Adapts a live CompanyResearchReport snapshot into normalized RawEvidenceInput[]
   * and collects them with zero fabricated values (preserving nulls and genuine timestamps).
   * Never substitutes retrievedAt for publishedAt when source publication time is missing.
   */
  public collectFromResearchSnapshot(
    snapshot: ExternalCompanyResearchSnapshot,
    retrievedAt: string = new Date().toISOString()
  ): EvidenceCollectionResult {
    const symbol = normalizeEvidenceSymbol(snapshot.cleanSymbol || snapshot.symbol);
    const yahooQuoteUrl = `https://finance.yahoo.com/quote/${encodeURIComponent(snapshot.symbol)}`;

    const marketPublishedAt = isIsoDateTimeString(snapshot.technicals.marketPublishedAt)
      ? snapshot.technicals.marketPublishedAt
      : null;
    const fundamentalsPublishedAt = isIsoDateTimeString(snapshot.fundamentals.publishedAt)
      ? snapshot.fundamentals.publishedAt
      : null;
    const holdingsPublishedAt = isIsoDateTimeString(snapshot.institutionalHoldings.publishedAt)
      ? snapshot.institutionalHoldings.publishedAt
      : null;

    const reportingPeriod =
      typeof snapshot.fundamentals.reportingPeriod === "string" &&
      snapshot.fundamentals.reportingPeriod.trim().length > 0
        ? snapshot.fundamentals.reportingPeriod.trim()
        : null;
    const reportingBasis = snapshot.fundamentals.reportingBasis ?? null;

    const fundamentalMetadata: Record<string, unknown> = {
      dataPeriod: reportingPeriod,
      basis: reportingBasis,
    };
    const holdingsMetadata: Record<string, unknown> = {
      dataPeriod: reportingPeriod,
      basis: reportingBasis,
    };

    const inputs: RawEvidenceInput[] = [
      {
        symbol,
        category: "INTRADAY_PRICE",
        claim: "Last Traded Price (LTP)",
        value: snapshot.technicals.ltp,
        unit: "INR",
        currency: "INR",
        source: "Yahoo Finance Chart Feed",
        sourceUrl: yahooQuoteUrl,
        publishedAt: marketPublishedAt,
        retrievedAt,
      },
      {
        symbol,
        category: "DAILY_MARKET_DATA",
        claim: "Session VWAP",
        value: snapshot.technicals.vwap,
        unit: "INR",
        currency: "INR",
        source: "Yahoo Finance Chart Feed",
        sourceUrl: yahooQuoteUrl,
        publishedAt: marketPublishedAt,
        retrievedAt,
      },
      {
        symbol,
        category: "QUARTERLY_FINANCIALS",
        claim: "Trailing P/E Ratio",
        value: snapshot.fundamentals.trailingPE,
        unit: "RATIO",
        source: "Yahoo Finance QuoteSummary",
        sourceUrl: yahooQuoteUrl,
        publishedAt: fundamentalsPublishedAt,
        retrievedAt,
        metadata: fundamentalMetadata,
      },
      {
        symbol,
        category: "QUARTERLY_FINANCIALS",
        claim: "Return on Equity (ROE)",
        value: snapshot.fundamentals.roePct,
        unit: "PCT",
        source: "Yahoo Finance QuoteSummary",
        sourceUrl: yahooQuoteUrl,
        publishedAt: fundamentalsPublishedAt,
        retrievedAt,
        metadata: fundamentalMetadata,
      },
      {
        symbol,
        category: "QUARTERLY_FINANCIALS",
        claim: "Return on Capital Employed (ROCE)",
        value: snapshot.fundamentals.rocePct ?? null,
        unit: "PCT",
        source: "Yahoo Finance QuoteSummary",
        sourceUrl: yahooQuoteUrl,
        publishedAt: fundamentalsPublishedAt,
        retrievedAt,
        metadata: fundamentalMetadata,
      },
      {
        symbol,
        category: "QUARTERLY_FINANCIALS",
        claim: "Debt to Equity Ratio",
        value: snapshot.fundamentals.debtToEquity,
        unit: "RATIO",
        source: "Yahoo Finance QuoteSummary",
        sourceUrl: yahooQuoteUrl,
        publishedAt: fundamentalsPublishedAt,
        retrievedAt,
        metadata: fundamentalMetadata,
      },
      {
        symbol,
        category: "QUARTERLY_FINANCIALS",
        claim: "Quarterly Revenue Growth YoY",
        value: snapshot.fundamentals.quarterlyRevenueGrowthPct,
        unit: "PCT",
        source: "Yahoo Finance QuoteSummary",
        sourceUrl: yahooQuoteUrl,
        publishedAt: fundamentalsPublishedAt,
        retrievedAt,
        metadata: fundamentalMetadata,
      },
      {
        symbol,
        category: "QUARTERLY_FINANCIALS",
        claim: "Total Revenue",
        value: snapshot.fundamentals.revenueCr ?? null,
        unit: "CR",
        currency: "INR",
        source: "Yahoo Finance QuoteSummary",
        sourceUrl: yahooQuoteUrl,
        publishedAt: fundamentalsPublishedAt,
        retrievedAt,
        metadata: fundamentalMetadata,
      },
      {
        symbol,
        category: "QUARTERLY_FINANCIALS",
        claim: "Net Profit",
        value: snapshot.fundamentals.netProfitCr ?? null,
        unit: "CR",
        currency: "INR",
        source: "Yahoo Finance QuoteSummary",
        sourceUrl: yahooQuoteUrl,
        publishedAt: fundamentalsPublishedAt,
        retrievedAt,
        metadata: fundamentalMetadata,
      },
      {
        symbol,
        category: "QUARTERLY_FINANCIALS",
        claim: "EBITDA",
        value: snapshot.fundamentals.ebitdaCr ?? null,
        unit: "CR",
        currency: "INR",
        source: "Yahoo Finance QuoteSummary",
        sourceUrl: yahooQuoteUrl,
        publishedAt: fundamentalsPublishedAt,
        retrievedAt,
        metadata: fundamentalMetadata,
      },
      {
        symbol,
        category: "QUARTERLY_FINANCIALS",
        claim: "EBITDA Margin",
        value: snapshot.fundamentals.ebitdaMarginPct ?? null,
        unit: "PCT",
        source: "Yahoo Finance QuoteSummary",
        sourceUrl: yahooQuoteUrl,
        publishedAt: fundamentalsPublishedAt,
        retrievedAt,
        metadata: fundamentalMetadata,
      },
      {
        symbol,
        category: "QUARTERLY_FINANCIALS",
        claim: "Total Debt",
        value: snapshot.fundamentals.totalDebtCr ?? null,
        unit: "CR",
        currency: "INR",
        source: "Yahoo Finance QuoteSummary",
        sourceUrl: yahooQuoteUrl,
        publishedAt: fundamentalsPublishedAt,
        retrievedAt,
        metadata: fundamentalMetadata,
      },
      {
        symbol,
        category: "QUARTERLY_FINANCIALS",
        claim: "Operating Cash Flow",
        value: snapshot.fundamentals.operatingCashFlowCr ?? null,
        unit: "CR",
        currency: "INR",
        source: "Yahoo Finance QuoteSummary",
        sourceUrl: yahooQuoteUrl,
        publishedAt: fundamentalsPublishedAt,
        retrievedAt,
        metadata: fundamentalMetadata,
      },
      {
        symbol,
        category: "QUARTERLY_FINANCIALS",
        claim: "Free Cash Flow",
        value: snapshot.fundamentals.freeCashFlowCr ?? null,
        unit: "CR",
        currency: "INR",
        source: "Yahoo Finance QuoteSummary",
        sourceUrl: yahooQuoteUrl,
        publishedAt: fundamentalsPublishedAt,
        retrievedAt,
        metadata: fundamentalMetadata,
      },
      {
        symbol,
        category: "QUARTERLY_FINANCIALS",
        claim: "Trailing EPS",
        value: snapshot.fundamentals.trailingEps ?? null,
        unit: "INR",
        currency: "INR",
        source: "Yahoo Finance QuoteSummary",
        sourceUrl: yahooQuoteUrl,
        publishedAt: fundamentalsPublishedAt,
        retrievedAt,
        metadata: fundamentalMetadata,
      },
      {
        symbol,
        category: "INSTITUTIONAL_HOLDING",
        claim: "Institutional Ownership Percent Held",
        value: snapshot.institutionalHoldings.institutionsPercentHeld,
        unit: "PCT",
        source: "Yahoo Finance MajorHolders",
        sourceUrl: yahooQuoteUrl,
        publishedAt: holdingsPublishedAt,
        retrievedAt,
        metadata: holdingsMetadata,
      },
      {
        symbol,
        category: "INSTITUTIONAL_HOLDING",
        claim: "Promoter and Insider Percent Held",
        value: snapshot.institutionalHoldings.insidersPromoterPercentHeld,
        unit: "PCT",
        source: "Yahoo Finance MajorHolders",
        sourceUrl: yahooQuoteUrl,
        publishedAt: holdingsPublishedAt,
        retrievedAt,
        metadata: holdingsMetadata,
      },
      {
        symbol,
        category: "INSTITUTIONAL_HOLDING",
        claim: "Promoter Pledge Percent",
        value: snapshot.fundamentals.promoterPledgePct ?? null,
        unit: "PCT",
        source: "Yahoo Finance MajorHolders",
        sourceUrl: yahooQuoteUrl,
        publishedAt: holdingsPublishedAt,
        retrievedAt,
        metadata: holdingsMetadata,
      },
    ];

    for (const news of snapshot.newsAndMacro || []) {
      const newsPublishedAt = isIsoDateTimeString(news.publishedAtIso)
        ? news.publishedAtIso
        : isIsoDateTimeString(news.publishedAt)
        ? news.publishedAt
        : null;

      inputs.push({
        symbol,
        category:
          news.category === "REGULATORY_SEBI"
            ? "REGULATORY_FILING"
            : "THIRD_PARTY_NEWS",
        claim: news.title,
        value: news.sentiment,
        source: news.publisher || "External News Feed",
        sourceUrl: news.link ?? null,
        publishedAt: newsPublishedAt,
        retrievedAt,
        untrustedText: news.title,
        metadata: { newsCategory: news.category },
      });
    }

    return this.collect(inputs, { retrievedAt });
  }
}

export const evidenceCollector = new EvidenceCollector();