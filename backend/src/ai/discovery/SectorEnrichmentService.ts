import { fetchScreenerFundamentals } from "./FundamentalsVerificationService";
import type { MarketUniverseEquity } from "./MarketUniverseService";

export interface SectorEnrichmentRecord {
  isin: string;
  symbol: string;
  sector: string | null;
  industry: string | null;
  subIndustry: string | null;
  source: string;
  verificationStatus: "VERIFIED" | "UNVERIFIED";
  retrievedAt: string;
  lastSuccessfulEnrichmentAt: string | null;
}

export interface SectorEnrichmentSummary {
  totalEligible: number;
  enrichedCount: number;
  missingSectorCount: number;
  sectorCoveragePct: number;
  verifiedSectorCount: number;
  unverifiedSectorCount: number;
  failedCount: number;
  lastEnrichmentAt: string | null;
  missingSectorSymbolsSample: string[];
  limitations: string[];
}

export type SectorLookupFn = (
  equity: MarketUniverseEquity
) => Promise<{
  sector: string | null;
  industry: string | null;
  subIndustry: string | null;
  source: string;
  verificationStatus: "VERIFIED" | "UNVERIFIED";
} | null>;

const YAHOO_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
};

let cachedYahooSectorAuth: { cookie: string; crumb: string; expiresAt: number } | null =
  null;

async function getYahooSectorAuth(
  fetchImpl: typeof fetch,
  timeoutMs: number
): Promise<{ cookie: string; crumb: string } | null> {
  if (cachedYahooSectorAuth && Date.now() < cachedYahooSectorAuth.expiresAt) {
    return {
      cookie: cachedYahooSectorAuth.cookie,
      crumb: cachedYahooSectorAuth.crumb,
    };
  }
  try {
    const fcRes = await fetchImpl("https://fc.yahoo.com", {
      headers: YAHOO_HEADERS,
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
    });
    const setCookie = fcRes.headers.get("set-cookie") || "";
    const cookie = setCookie
      .split(",")
      .map((c) => c.split(";")[0].trim())
      .filter(Boolean)
      .join("; ");
    if (!cookie) return null;

    const crumbRes = await fetchImpl(
      "https://query1.finance.yahoo.com/v1/test/getcrumb",
      {
        headers: { ...YAHOO_HEADERS, Cookie: cookie },
        signal: AbortSignal.timeout(timeoutMs),
      }
    );
    if (!crumbRes.ok) return null;
    const crumb = (await crumbRes.text()).trim();
    if (!crumb || crumb.includes("<")) return null;

    cachedYahooSectorAuth = {
      cookie,
      crumb,
      expiresAt: Date.now() + 25 * 60 * 1000,
    };
    return { cookie, crumb };
  } catch {
    return null;
  }
}

/**
 * Default supplementary lookup using Yahoo Finance quoteSummary assetProfile
 * (explicitly marked UNVERIFIED supplementary provider; never guesses unknown sectors).
 */
export async function defaultSupplementarySectorLookup(
  equity: MarketUniverseEquity,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 6000
): Promise<{
  sector: string | null;
  industry: string | null;
  subIndustry: string | null;
  source: string;
  verificationStatus: "VERIFIED" | "UNVERIFIED";
} | null> {
  const ticker = equity.nseSymbol
    ? `${equity.nseSymbol}.NS`
    : `${equity.symbol}.BO`;

  // Try NSE official quote-equity first for NSE-listed symbols
  if (equity.nseSymbol) {
    try {
      const nseRes = await fetchImpl(
        `https://www.nseindia.com/api/quote-equity?symbol=${encodeURIComponent(equity.nseSymbol)}`,
        {
          headers: {
            "User-Agent": "Mozilla/5.0",
            Accept: "application/json",
            Referer: "https://www.nseindia.com/",
          },
          signal: AbortSignal.timeout(timeoutMs),
        }
      );
      if (nseRes.ok) {
        const json = (await nseRes.json()) as Record<string, any>;
        const info = json?.industryInfo;
        const sector =
          typeof info?.sector === "string" && info.sector.trim()
            ? info.sector.trim()
            : typeof info?.macro === "string" && info.macro.trim()
              ? info.macro.trim()
              : null;
        const industry =
          typeof info?.industry === "string" && info.industry.trim()
            ? info.industry.trim()
            : null;
        const subIndustry =
          typeof info?.basicIndustry === "string" && info.basicIndustry.trim()
            ? info.basicIndustry.trim()
            : null;
        if (sector || industry) {
          return {
            sector,
            industry,
            subIndustry,
            source: "NSE Official Company Classification (quote-equity)",
            verificationStatus: "VERIFIED",
          };
        }
      }
    } catch {
      // Fall through to supplementary provider
    }
  }

  // Supplementary Yahoo Finance assetProfile with crumb/cookie auth (always UNVERIFIED)
  try {
    const auth = await getYahooSectorAuth(fetchImpl, timeoutMs);
    const url = auth
      ? `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(ticker)}?modules=assetProfile&crumb=${encodeURIComponent(auth.crumb)}`
      : `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(ticker)}?modules=assetProfile`;
    const headers: Record<string, string> = auth
      ? { ...YAHOO_HEADERS, Cookie: auth.cookie }
      : { ...YAHOO_HEADERS };
    const res = await fetchImpl(url, {
      headers,
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as Record<string, any>;
    const profile = json?.quoteSummary?.result?.[0]?.assetProfile;
    if (!profile) return null;
    const sector =
      typeof profile.sector === "string" && profile.sector.trim()
        ? profile.sector.trim()
        : null;
    const industry =
      typeof profile.industry === "string" && profile.industry.trim()
        ? profile.industry.trim()
        : null;
    if (sector || industry) {
      return {
        sector,
        industry,
        subIndustry: industry,
        source: "Yahoo Finance (assetProfile — Supplementary)",
        verificationStatus: "UNVERIFIED",
      };
    }
  } catch {
    // Fall through to Screener.in supplementary lookup
  }

  // Fallback: Screener.in sector/industry classification (supplementary UNVERIFIED)
  try {
    const sc = await fetchScreenerFundamentals(
      equity.nseSymbol ?? equity.symbol,
      fetchImpl,
      timeoutMs
    );
    if (sc && (sc.sector || sc.industry)) {
      return {
        sector: sc.sector,
        industry: sc.industry,
        subIndustry: sc.industry,
        source: "Screener.in (Supplementary Sector Classification)",
        verificationStatus: "UNVERIFIED",
      };
    }
  } catch {
    // Preserve UNKNOWN/null
  }
  return null;
}

export class SectorEnrichmentService {
  private readonly lookupFn: SectorLookupFn;
  private readonly cacheByIsin = new Map<string, SectorEnrichmentRecord>();
  private lastEnrichmentAt: string | null = null;
  private lastFailedCount = 0;
  private lastLimitations: string[] = [];

  public constructor(lookupFn?: SectorLookupFn) {
    this.lookupFn = lookupFn ?? ((eq) => defaultSupplementarySectorLookup(eq));
  }

  public async enrichBatch(params: {
    equities: MarketUniverseEquity[];
    batchSize?: number;
    cursorOffset?: number;
  }): Promise<{
    updatedEquities: MarketUniverseEquity[];
    summary: SectorEnrichmentSummary;
    nextCursorOffset: number | null;
  }> {
    const batchSize = Math.min(Math.max(params.batchSize ?? 25, 1), 100);
    const cursorOffset = Math.max(params.cursorOffset ?? 0, 0);
    const slice = params.equities.slice(cursorOffset, cursorOffset + batchSize);
    const nowIso = new Date().toISOString();
    let failedCount = 0;

    // Bounded concurrency <= 3
    for (let i = 0; i < slice.length; i += 3) {
      const batch = slice.slice(i, i + 3);
      const settled = await Promise.allSettled(
        batch.map(async (eq) => {
          const cached = this.cacheByIsin.get(eq.isin);
          if (cached && cached.sector) return { eq, res: cached };
          if (eq.sector && eq.sectorSource) {
            const restored: SectorEnrichmentRecord = {
              isin: eq.isin,
              symbol: eq.symbol,
              sector: eq.sector,
              industry: eq.industry,
              subIndustry: eq.subIndustry ?? null,
              source: eq.sectorSource,
              verificationStatus: eq.sectorVerificationStatus ?? "UNVERIFIED",
              retrievedAt: eq.sectorRetrievedAt ?? nowIso,
              lastSuccessfulEnrichmentAt: eq.sectorRetrievedAt ?? nowIso,
            };
            this.cacheByIsin.set(eq.isin, restored);
            return { eq, res: restored };
          }
          const found = await this.lookupFn(eq);
          if (!found || (!found.sector && !found.industry)) {
            return { eq, res: null };
          }
          const rec: SectorEnrichmentRecord = {
            isin: eq.isin,
            symbol: eq.symbol,
            sector: found.sector,
            industry: found.industry,
            subIndustry: found.subIndustry,
            source: found.source,
            verificationStatus: found.verificationStatus,
            retrievedAt: nowIso,
            lastSuccessfulEnrichmentAt: nowIso,
          };
          this.cacheByIsin.set(eq.isin, rec);
          return { eq, res: rec };
        })
      );

      for (const item of settled) {
        if (item.status === "rejected" || item.value.res === null) {
          failedCount += 1;
        }
      }
    }

    const updatedEquities = params.equities.map((eq) => {
      const rec = this.cacheByIsin.get(eq.isin);
      if (!rec) return eq;
      return {
        ...eq,
        sector: rec.sector ?? eq.sector,
        industry: rec.industry ?? eq.industry,
        subIndustry: rec.subIndustry ?? eq.subIndustry ?? null,
        sectorSource: rec.source,
        sectorVerificationStatus: rec.verificationStatus,
        sectorRetrievedAt: rec.retrievedAt,
      };
    });

    this.lastEnrichmentAt = nowIso;
    this.lastFailedCount = failedCount;
    this.lastLimitations =
      failedCount > 0
        ? [
            `${failedCount} company sector lookup(s) returned no classification or timed out; left as UNKNOWN.`,
          ]
        : [];

    const nextCursorOffset =
      cursorOffset + slice.length < params.equities.length
        ? cursorOffset + slice.length
        : null;

    return {
      updatedEquities,
      summary: this.computeSummary(updatedEquities),
      nextCursorOffset,
    };
  }

  public computeSummary(
    equities: MarketUniverseEquity[]
  ): SectorEnrichmentSummary {
    const totalEligible = equities.length;
    const enriched = equities.filter((e) => Boolean(e.sector));
    const missing = equities.filter((e) => !e.sector);
    const verifiedCount = enriched.filter(
      (e) => e.sectorVerificationStatus === "VERIFIED"
    ).length;
    const unverifiedCount = enriched.length - verifiedCount;
    const coveragePct =
      totalEligible > 0
        ? Math.round((enriched.length / totalEligible) * 10000) / 100
        : 0;

    return {
      totalEligible,
      enrichedCount: enriched.length,
      missingSectorCount: missing.length,
      sectorCoveragePct: coveragePct,
      verifiedSectorCount: verifiedCount,
      unverifiedSectorCount: unverifiedCount,
      failedCount: this.lastFailedCount,
      lastEnrichmentAt: this.lastEnrichmentAt,
      missingSectorSymbolsSample: missing.slice(0, 25).map((e) => e.symbol),
      limitations: [...this.lastLimitations],
    };
  }
}

export const sectorEnrichmentService = new SectorEnrichmentService();

