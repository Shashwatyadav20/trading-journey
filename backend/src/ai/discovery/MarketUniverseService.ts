import {
  getAdminSupabaseClient,
  isSupabaseConfigured,
} from "../../db/supabaseClient";
import {
  AmfiClassificationService,
  amfiClassificationService,
} from "./AmfiClassificationService";
import {
  SectorEnrichmentService,
  SectorEnrichmentSummary,
  sectorEnrichmentService,
} from "./SectorEnrichmentService";

export type MarketCapCategory =
  | "LARGE_CAP"
  | "MID_CAP"
  | "SMALL_CAP"
  | "UNCLASSIFIED";

export type UniverseExchange = "NSE" | "BSE" | "DUAL";

export interface RawExchangeSecurityRow {
  symbol: string;
  companyName: string;
  isin: string | null;
  exchange: "NSE" | "BSE";
  series?: string | null;
  listingStatus?: string | null;
  instrumentType?: string | null;
  bseCode?: string | null;
  sector?: string | null;
  industry?: string | null;
  marketCapCr?: number | null;
  sourceProvenance?: string;
}

export interface MarketUniverseEquity {
  isin: string;
  symbol: string;
  companyName: string;
  nseSymbol: string | null;
  bseCode: string | null;
  exchange: UniverseExchange;
  series: string | null;
  listingStatus: "ACTIVE" | "SUSPENDED" | "EXCLUDED";
  sector: string | null;
  industry: string | null;
  subIndustry?: string | null;
  sectorSource?: string | null;
  sectorVerificationStatus?: "VERIFIED" | "UNVERIFIED" | null;
  sectorRetrievedAt?: string | null;
  marketCapCr: number | null;
  marketCapRank: number | null;
  marketCapCategory: MarketCapCategory;
  amfiMatched?: boolean;
  amfiPeriod?: string | null;
  amfiPublicationDate?: string | null;
  dynamicCapEstimateRank?: number | null;
  dynamicCapEstimateCategory?: MarketCapCategory;
  classificationDate: string | null;
  classificationSource: string | null;
  sourceProvenance: string;
  lastRefreshedAt: string;
}

export interface ExcludedSecurityRecord {
  symbol: string;
  isin: string | null;
  exchange: "NSE" | "BSE";
  series: string | null;
  instrumentType: string;
  exclusionReason:
    | "ETF"
    | "DEBT_SECURITY"
    | "WARRANT"
    | "SUSPENDED"
    | "NON_EQUITY"
    | "MISSING_ISIN";
  rawName: string;
  detectedAt: string;
}

export interface MarketUniverseStats {
  totalEligible: number;
  nseCount: number;
  bseCount: number;
  dualCount: number;
  largeCapCount: number;
  midCapCount: number;
  smallCapCount: number;
  unclassifiedCapCount: number;
  amfiMatchedCount: number;
  amfiClassificationPeriod: string | null;
  amfiPublicationDate: string | null;
  missingSectorCount: number;
  sectorCoveragePct: number;
  excludedCount: number;
  lastUpdatedAt: string | null;
  refreshStatus: "COMPLETED" | "PARTIAL" | "FAILED" | "UNINITIALIZED";
  classificationMethodology: string;
  classificationDate: string | null;
  sourceLimitations: string[];
  sectorDistribution: Array<{ sector: string; count: number }>;
  exclusionBreakdown: Array<{ reason: string; count: number }>;
}

export interface UniverseQueryOptions {
  marketCap?: MarketCapCategory | "ALL";
  sector?: string;
  industry?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

export interface UniverseQueryResult {
  stats: MarketUniverseStats;
  totalMatching: number;
  limit: number;
  offset: number;
  items: MarketUniverseEquity[];
}

const EXCLUDED_SERIES = new Set([
  "N1", "N2", "N3", "N4", "N5", "N6", "N7", "N8", "N9",
  "NC", "ND", "NE", "NF", "NG", "NH", "NI", "NJ", "NK",
  "W1", "W2", "GB", "GS", "TB", "SG", "IV", "RR", "MF",
]);

function normalizeIsin(isin: string | null | undefined): string | null {
  if (!isin || typeof isin !== "string") return null;
  const clean = isin.trim().toUpperCase();
  return /^IN[E0-9A-Z]{10}$/.test(clean) ? clean : null;
}

export function detectSecurityExclusion(
  row: RawExchangeSecurityRow
): ExcludedSecurityRecord["exclusionReason"] | null {
  const cleanIsin = normalizeIsin(row.isin);
  if (!cleanIsin) return "MISSING_ISIN";

  const status = (row.listingStatus ?? "ACTIVE").trim().toUpperCase();
  if (
    status.includes("SUSPEND") ||
    status.includes("DELIST") ||
    status === "INACTIVE"
  ) {
    return "SUSPENDED";
  }

  const series = (row.series ?? "").trim().toUpperCase();
  const name = (row.companyName ?? "").toUpperCase();
  const sym = (row.symbol ?? "").toUpperCase();
  const inst = (row.instrumentType ?? "").toUpperCase();

  if (
    /\bETF\b/.test(name) ||
    /\bETF\b/.test(inst) ||
    sym.endsWith("ETF") ||
    sym.endsWith("BEES") ||
    cleanIsin.startsWith("INF")
  ) {
    return "ETF";
  }

  if (
    /\bWARRANT\b/.test(name) ||
    /\bWARRANT\b/.test(inst) ||
    series.startsWith("W")
  ) {
    return "WARRANT";
  }

  if (
    /\b(NCD|BOND|DEBENTURE|G-SEC|T-BILL|SOVEREIGN GOLD)\b/.test(name) ||
    /\b(DEBT|BOND|NCD)\b/.test(inst) ||
    EXCLUDED_SERIES.has(series)
  ) {
    return "DEBT_SECURITY";
  }

  if (
    /\b(REIT|INVIT|PREFERENCE|RIGHTS ENTITLEMENT)\b/.test(name) ||
    /\b(REIT|INVIT|PREF)\b/.test(inst) ||
    sym.endsWith("-RE")
  ) {
    return "NON_EQUITY";
  }

  return null;
}

/**
 * Applies Official AMFI categorization by ISIN (6-month avg full market-cap methodology).
 * Never infers official AMFI classification from today's live marketCapCr.
 * Computes a separate dynamicCapEstimateCategory clearly labeled as a live estimate.
 */
export function classifyMarketCaps(
  equities: MarketUniverseEquity[],
  classificationDate: string,
  amfiService: AmfiClassificationService = amfiClassificationService
): MarketUniverseEquity[] {
  const withCap = equities
    .filter(
      (e) => typeof e.marketCapCr === "number" && Number.isFinite(e.marketCapCr) && e.marketCapCr > 0
    )
    .sort((a, b) => (b.marketCapCr ?? 0) - (a.marketCapCr ?? 0));

  const dynamicRankByIsin = new Map<string, { rank: number; category: MarketCapCategory }>();
  withCap.forEach((item, idx) => {
    const rank = idx + 1;
    const category: MarketCapCategory =
      rank <= 100 ? "LARGE_CAP" : rank <= 250 ? "MID_CAP" : "SMALL_CAP";
    dynamicRankByIsin.set(item.isin, { rank, category });
  });

  return equities.map((e) => {
    const dyn = dynamicRankByIsin.get(e.isin);
    const officialAmfi = amfiService.lookupByIsin(e.isin);
    if (!officialAmfi) {
      return {
        ...e,
        marketCapRank: null,
        marketCapCategory: "UNCLASSIFIED",
        amfiMatched: false,
        amfiPeriod: null,
        amfiPublicationDate: null,
        dynamicCapEstimateRank: dyn?.rank ?? null,
        dynamicCapEstimateCategory: dyn?.category ?? "UNCLASSIFIED",
        classificationDate: null,
        classificationSource: null,
      };
    }
    return {
      ...e,
      marketCapRank: officialAmfi.amfiRank,
      marketCapCategory: officialAmfi.amfiCategory,
      amfiMatched: true,
      amfiPeriod: officialAmfi.classificationPeriod,
      amfiPublicationDate: officialAmfi.publicationDate,
      dynamicCapEstimateRank: dyn?.rank ?? null,
      dynamicCapEstimateCategory: dyn?.category ?? "UNCLASSIFIED",
      classificationDate: officialAmfi.publicationDate || classificationDate,
      classificationSource: officialAmfi.source,
    };
  });
}

export function parseNseEquityCsv(csvText: string): RawExchangeSecurityRow[] {
  const lines = csvText.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];
  const rows: RawExchangeSecurityRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    // Simple CSV split handling quoted names
    const cols = lines[i].match(/(".*?"|[^",\s]+)(?=\s*,|\s*$)/g);
    if (!cols || cols.length < 7) continue;
    const clean = (s: string) => s.replace(/^"|"$/g, "").trim();
    const symbol = clean(cols[0]);
    const companyName = clean(cols[1]);
    const series = clean(cols[2]);
    const isin = clean(cols[6]);
    if (!symbol) continue;
    rows.push({
      symbol,
      companyName: companyName || symbol,
      isin,
      exchange: "NSE",
      series,
      listingStatus: "ACTIVE",
      sourceProvenance: "NSE Official Equity Master (EQUITY_L.csv)",
    });
  }
  return rows;
}

export class MarketUniverseService {
  private universeByIsin = new Map<string, MarketUniverseEquity>();
  private excluded: ExcludedSecurityRecord[] = [];
  private lastUpdatedAt: string | null = null;
  private classificationDate: string | null = null;
  private refreshStatus: MarketUniverseStats["refreshStatus"] = "UNINITIALIZED";
  private sourceLimitations: string[] = [
    "Market universe has not been refreshed from official exchange feeds yet.",
  ];
  private schedulerHandle: NodeJS.Timeout | null = null;
  private readonly amfiService: AmfiClassificationService;
  private readonly sectorService: SectorEnrichmentService;

  public constructor(deps?: {
    amfiService?: AmfiClassificationService;
    sectorService?: SectorEnrichmentService;
  }) {
    this.amfiService = deps?.amfiService ?? amfiClassificationService;
    this.sectorService = deps?.sectorService ?? sectorEnrichmentService;
  }

  public ingestFromExchangeRecords(params: {
    nseRows: RawExchangeSecurityRow[];
    bseRows: RawExchangeSecurityRow[];
    nowIso?: string;
    sourceLimitations?: string[];
    replaceOnlyIfNonEmpty?: boolean;
  }): MarketUniverseStats {
    const nowIso = params.nowIso ?? new Date().toISOString();
    const allIncoming = [...params.nseRows, ...params.bseRows];

    if (params.replaceOnlyIfNonEmpty !== false && allIncoming.length === 0) {
      // Never silently replace a valid existing universe with an empty/failed refresh
      this.refreshStatus = this.universeByIsin.size > 0 ? "PARTIAL" : "FAILED";
      this.sourceLimitations = params.sourceLimitations ?? [
        "Exchange refresh returned 0 records; existing universe preserved.",
      ];
      return this.getStats();
    }

    const dedupMap = new Map<string, MarketUniverseEquity>();
    const nextExcluded: ExcludedSecurityRecord[] = [];

    for (const row of allIncoming) {
      const exclusionReason = detectSecurityExclusion(row);
      if (exclusionReason) {
        nextExcluded.push({
          symbol: row.symbol,
          isin: normalizeIsin(row.isin),
          exchange: row.exchange,
          series: row.series ?? null,
          instrumentType: row.instrumentType ?? row.series ?? "UNKNOWN",
          exclusionReason,
          rawName: row.companyName,
          detectedAt: nowIso,
        });
        continue;
      }

      const isin = normalizeIsin(row.isin)!;
      const prevPersisted = this.universeByIsin.get(isin);
      const existing = dedupMap.get(isin);
      if (!existing) {
        dedupMap.set(isin, {
          isin,
          symbol: row.symbol.trim().toUpperCase(),
          companyName: row.companyName.trim(),
          nseSymbol: row.exchange === "NSE" ? row.symbol.trim().toUpperCase() : null,
          bseCode: row.exchange === "BSE" ? (row.bseCode ?? row.symbol).trim().toUpperCase() : null,
          exchange: row.exchange,
          series: row.series ?? null,
          listingStatus: "ACTIVE",
          sector: row.sector?.trim() || prevPersisted?.sector || null,
          industry: row.industry?.trim() || prevPersisted?.industry || null,
          subIndustry: prevPersisted?.subIndustry ?? null,
          sectorSource: prevPersisted?.sectorSource ?? null,
          sectorVerificationStatus: prevPersisted?.sectorVerificationStatus ?? null,
          sectorRetrievedAt: prevPersisted?.sectorRetrievedAt ?? null,
          marketCapCr:
            typeof row.marketCapCr === "number" && Number.isFinite(row.marketCapCr)
              ? row.marketCapCr
              : prevPersisted?.marketCapCr ?? null,
          marketCapRank: null,
          marketCapCategory: "UNCLASSIFIED",
          classificationDate: null,
          classificationSource: null,
          sourceProvenance:
            row.sourceProvenance ??
            (row.exchange === "NSE" ? "NSE Official Listing" : "BSE Official Listing"),
          lastRefreshedAt: nowIso,
        });
      } else {
        // Merge dual-listed NSE + BSE company by ISIN
        const mergedExchange: UniverseExchange =
          existing.exchange !== row.exchange ? "DUAL" : existing.exchange;
        dedupMap.set(isin, {
          ...existing,
          exchange: mergedExchange,
          nseSymbol:
            existing.nseSymbol ??
            (row.exchange === "NSE" ? row.symbol.trim().toUpperCase() : null),
          bseCode:
            existing.bseCode ??
            (row.exchange === "BSE" ? (row.bseCode ?? row.symbol).trim().toUpperCase() : null),
          sector: existing.sector ?? (row.sector?.trim() || null),
          industry: existing.industry ?? (row.industry?.trim() || null),
          marketCapCr:
            existing.marketCapCr ??
            (typeof row.marketCapCr === "number" && Number.isFinite(row.marketCapCr)
              ? row.marketCapCr
              : null),
          sourceProvenance:
            mergedExchange === "DUAL"
              ? `${existing.sourceProvenance} + ${row.sourceProvenance ?? row.exchange}`
              : existing.sourceProvenance,
          lastRefreshedAt: nowIso,
        });
      }
    }

    const classified = classifyMarketCaps(
      Array.from(dedupMap.values()),
      nowIso,
      this.amfiService
    );
    this.universeByIsin = new Map(classified.map((e) => [e.isin, e]));
    this.excluded = nextExcluded;
    this.lastUpdatedAt = nowIso;
    const amfiMeta = this.amfiService.getMetadata();
    this.classificationDate = amfiMeta.publicationDate;
    this.sourceLimitations = [
      ...(params.sourceLimitations ?? []),
      ...amfiMeta.limitations,
    ];
    this.refreshStatus =
      this.sourceLimitations.length > 0 ? "PARTIAL" : "COMPLETED";

    return this.getStats();
  }

  public reapplyAmfiClassification(nowIso = new Date().toISOString()): MarketUniverseStats {
    const classified = classifyMarketCaps(
      Array.from(this.universeByIsin.values()),
      nowIso,
      this.amfiService
    );
    this.universeByIsin = new Map(classified.map((e) => [e.isin, e]));
    const amfiMeta = this.amfiService.getMetadata();
    this.classificationDate = amfiMeta.publicationDate;
    return this.getStats();
  }

  public async enrichSectorsBatch(options?: {
    batchSize?: number;
    cursorOffset?: number;
  }): Promise<{
    summary: SectorEnrichmentSummary;
    nextCursorOffset: number | null;
  }> {
    const all = Array.from(this.universeByIsin.values());
    const res = await this.sectorService.enrichBatch({
      equities: all,
      batchSize: options?.batchSize,
      cursorOffset: options?.cursorOffset,
    });
    this.universeByIsin = new Map(res.updatedEquities.map((e) => [e.isin, e]));
    const batchStart = Math.max(options?.cursorOffset ?? 0, 0);
    const batchSize = Math.min(Math.max(options?.batchSize ?? 25, 1), 100);
    await this.persistUniverseSafe(
      res.updatedEquities.slice(batchStart, batchStart + batchSize)
    );
    return {
      summary: res.summary,
      nextCursorOffset: res.nextCursorOffset,
    };
  }

  public async refreshFromOfficialExchanges(options?: {
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
  }): Promise<MarketUniverseStats> {
    if (this.universeByIsin.size === 0) {
      await this.loadUniverseFromSupabase();
    }
    const fetchFn = options?.fetchImpl ?? fetch;
    const timeoutMs = options?.timeoutMs ?? 20000;
    const limitations: string[] = [];
    let nseRows: RawExchangeSecurityRow[] = [];
    let bseRows: RawExchangeSecurityRow[] = [];

    for (let attempt = 1; attempt <= 2 && nseRows.length === 0; attempt++) {
      try {
        const res = await fetchFn(
          "https://nsearchives.nseindia.com/content/equities/EQUITY_L.csv",
          {
            headers: {
              "User-Agent": "Mozilla/5.0",
              Accept: "text/csv,*/*",
            },
            signal: AbortSignal.timeout(timeoutMs),
          }
        );
        if (res.ok) {
          const csv = await res.text();
          nseRows = parseNseEquityCsv(csv);
          if (nseRows.length === 0 && attempt === 2) {
            limitations.push("NSE EQUITY_L.csv returned 0 parseable equity rows.");
          }
        } else if (attempt === 2) {
          limitations.push(`NSE official listing feed returned HTTP ${res.status}.`);
        }
      } catch (err: unknown) {
        if (attempt === 2) {
          limitations.push(
            `NSE official listing feed unavailable (${err instanceof Error ? err.message : "network error"}).`
          );
        }
      }
      if (nseRows.length === 0 && attempt === 1) {
        await new Promise((r) => setTimeout(r, 1000));
      }
    }

    for (let attempt = 1; attempt <= 2 && bseRows.length === 0; attempt++) {
      try {
        const res = await fetchFn(
          "https://api.bseindia.com/BseIndiaAPI/api/ListofScripData/w?Group=&Scripcode=&industry=&segment=Equity&status=Active",
          {
            headers: {
              "User-Agent": "Mozilla/5.0",
              Referer: "https://www.bseindia.com/",
              Accept: "application/json",
            },
            signal: AbortSignal.timeout(timeoutMs),
          }
        );
        if (res.ok) {
          const json = (await res.json()) as Array<Record<string, unknown>>;
          if (Array.isArray(json)) {
            bseRows = json
              .filter((item) => typeof item?.scrip_id === "string" || typeof item?.SCRIP_CD === "string")
              .map((item) => ({
                symbol: String(item.scrip_id ?? item.SCRIP_CD ?? "").trim(),
                bseCode: String(item.SCRIP_CD ?? "").trim() || null,
                companyName: String(item.Scrip_Name ?? item.scrip_id ?? "").trim(),
                isin: typeof item.ISIN_NUMBER === "string" ? item.ISIN_NUMBER : null,
                exchange: "BSE" as const,
                series: typeof item.GROUP === "string" ? item.GROUP : null,
                listingStatus: typeof item.Status === "string" ? item.Status : "ACTIVE",
                industry: typeof item.INDUSTRY === "string" ? item.INDUSTRY : null,
                marketCapCr:
                  typeof item.Mktcap === "number"
                    ? item.Mktcap
                    : typeof item.Mktcap === "string" && !Number.isNaN(Number(item.Mktcap))
                      ? Number(item.Mktcap)
                      : null,
                sourceProvenance: "BSE Official Active Equity List",
              }));
          }
          if (bseRows.length === 0 && attempt === 2) {
            limitations.push("BSE official listing feed returned 0 equity rows.");
          }
        } else if (attempt === 2) {
          limitations.push(`BSE official listing feed returned HTTP ${res.status}.`);
        }
      } catch (err: unknown) {
        if (attempt === 2) {
          limitations.push(
            `BSE official listing feed unavailable (${err instanceof Error ? err.message : "network error"}).`
          );
        }
      }
      if (bseRows.length === 0 && attempt === 1) {
        await new Promise((r) => setTimeout(r, 1500));
      }
    }

    if (nseRows.length === 0 && bseRows.length === 0) {
      this.refreshStatus = this.universeByIsin.size > 0 ? "PARTIAL" : "FAILED";
      this.sourceLimitations = limitations;
      await this.persistRefreshRunSafe();
      return this.getStats();
    }

    // Never silently drop one exchange's persisted equities if only the other exchange succeeded
    if (nseRows.length === 0 && this.universeByIsin.size > 0) {
      for (const eq of this.universeByIsin.values()) {
        if (eq.exchange === "NSE" || eq.exchange === "DUAL") {
          nseRows.push({
            symbol: eq.nseSymbol ?? eq.symbol,
            companyName: eq.companyName,
            isin: eq.isin,
            exchange: "NSE",
            series: eq.series,
            listingStatus: eq.listingStatus,
            sector: eq.sector,
            industry: eq.industry,
            marketCapCr: eq.marketCapCr,
            sourceProvenance: eq.sourceProvenance,
          });
        }
      }
      limitations.push("Preserved persisted NSE equities after empty NSE feed response.");
    }
    if (bseRows.length === 0 && this.universeByIsin.size > 0) {
      for (const eq of this.universeByIsin.values()) {
        if (eq.exchange === "BSE" || eq.exchange === "DUAL") {
          bseRows.push({
            symbol: eq.bseCode ?? eq.symbol,
            bseCode: eq.bseCode,
            companyName: eq.companyName,
            isin: eq.isin,
            exchange: "BSE",
            series: eq.series,
            listingStatus: eq.listingStatus,
            sector: eq.sector,
            industry: eq.industry,
            marketCapCr: eq.marketCapCr,
            sourceProvenance: eq.sourceProvenance,
          });
        }
      }
      limitations.push("Preserved persisted BSE equities after empty BSE feed response.");
    }

    const stats = this.ingestFromExchangeRecords({
      nseRows,
      bseRows,
      sourceLimitations: limitations,
      replaceOnlyIfNonEmpty: true,
    });
    await this.persistUniverseSafe();
    await this.persistRefreshRunSafe();
    return stats;
  }

  public getStats(): MarketUniverseStats {
    const items = Array.from(this.universeByIsin.values());
    const sectorCounts = new Map<string, number>();
    let nseCount = 0;
    let bseCount = 0;
    let dualCount = 0;
    let largeCapCount = 0;
    let midCapCount = 0;
    let smallCapCount = 0;
    let unclassifiedCapCount = 0;
    let amfiMatchedCount = 0;
    let missingSectorCount = 0;

    for (const item of items) {
      if (item.exchange === "NSE") nseCount += 1;
      else if (item.exchange === "BSE") bseCount += 1;
      else dualCount += 1;

      if (item.amfiMatched) amfiMatchedCount += 1;
      if (item.marketCapCategory === "LARGE_CAP") largeCapCount += 1;
      else if (item.marketCapCategory === "MID_CAP") midCapCount += 1;
      else if (item.marketCapCategory === "SMALL_CAP") smallCapCount += 1;
      else unclassifiedCapCount += 1;

      if (!item.sector) {
        missingSectorCount += 1;
      } else {
        sectorCounts.set(item.sector, (sectorCounts.get(item.sector) ?? 0) + 1);
      }
    }

    const amfiMeta = this.amfiService.getMetadata();
    const sectorCoveragePct =
      items.length > 0
        ? Math.round(((items.length - missingSectorCount) / items.length) * 10000) / 100
        : 0;

    const exclusionCounts = new Map<string, number>();
    for (const ex of this.excluded) {
      exclusionCounts.set(
        ex.exclusionReason,
        (exclusionCounts.get(ex.exclusionReason) ?? 0) + 1
      );
    }

    return {
      totalEligible: items.length,
      nseCount,
      bseCount,
      dualCount,
      largeCapCount,
      midCapCount,
      smallCapCount,
      unclassifiedCapCount,
      amfiMatchedCount,
      amfiClassificationPeriod: amfiMeta.classificationPeriod,
      amfiPublicationDate: amfiMeta.publicationDate,
      missingSectorCount,
      sectorCoveragePct,
      excludedCount: this.excluded.length,
      lastUpdatedAt: this.lastUpdatedAt,
      refreshStatus: this.refreshStatus,
      classificationMethodology:
        "SEBI/AMFI Market-Cap Rank (1–100 Large Cap, 101–250 Mid Cap, 251+ Small Cap)",
      classificationDate: this.classificationDate,
      sourceLimitations: [...this.sourceLimitations],
      sectorDistribution: Array.from(sectorCounts.entries())
        .map(([sector, count]) => ({ sector, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 15),
      exclusionBreakdown: Array.from(exclusionCounts.entries())
        .map(([reason, count]) => ({ reason, count }))
        .sort((a, b) => b.count - a.count),
    };
  }

  public queryUniverse(options: UniverseQueryOptions = {}): UniverseQueryResult {
    const capFilter = options.marketCap ?? "ALL";
    const sectorFilter = options.sector?.trim().toLowerCase() ?? "";
    const industryFilter = options.industry?.trim().toLowerCase() ?? "";
    const search = options.search?.trim().toLowerCase() ?? "";
    const limit = Math.min(Math.max(options.limit ?? 25, 1), 100);
    const offset = Math.max(options.offset ?? 0, 0);

    let filtered = Array.from(this.universeByIsin.values());
    if (capFilter !== "ALL") {
      filtered = filtered.filter((e) => e.marketCapCategory === capFilter);
    }
    if (sectorFilter) {
      filtered = filtered.filter(
        (e) => (e.sector ?? "").toLowerCase() === sectorFilter
      );
    }
    if (industryFilter) {
      filtered = filtered.filter(
        (e) => (e.industry ?? "").toLowerCase() === industryFilter
      );
    }
    if (search) {
      filtered = filtered.filter(
        (e) =>
          e.symbol.toLowerCase().includes(search) ||
          e.companyName.toLowerCase().includes(search) ||
          e.isin.toLowerCase().includes(search)
      );
    }

    filtered.sort((a, b) => {
      if (a.marketCapRank !== null && b.marketCapRank !== null) {
        return a.marketCapRank - b.marketCapRank;
      }
      if (a.marketCapRank !== null) return -1;
      if (b.marketCapRank !== null) return 1;
      return a.symbol.localeCompare(b.symbol);
    });

    return {
      stats: this.getStats(),
      totalMatching: filtered.length,
      limit,
      offset,
      items: filtered.slice(offset, offset + limit),
    };
  }

  public findBySymbol(symbol: string): MarketUniverseEquity | null {
    const clean = symbol
      .trim()
      .toUpperCase()
      .replace(/^NSE:/i, "")
      .replace(/^BSE:/i, "")
      .replace(/\.NS$/i, "")
      .replace(/\.BO$/i, "");
    for (const item of this.universeByIsin.values()) {
      if (
        item.symbol === clean ||
        item.nseSymbol === clean ||
        item.bseCode === clean
      ) {
        return item;
      }
    }
    return null;
  }

  public getAllEligible(): MarketUniverseEquity[] {
    return Array.from(this.universeByIsin.values());
  }

  public getExcludedSecurities(): ExcludedSecurityRecord[] {
    return [...this.excluded];
  }

  public startScheduler(intervalMs = 6 * 60 * 60 * 1000): void {
    if (this.schedulerHandle) return;
    this.schedulerHandle = setInterval(() => {
      void this.refreshFromOfficialExchanges();
    }, intervalMs);
    this.schedulerHandle.unref?.();
  }

  public stopScheduler(): void {
    if (this.schedulerHandle) {
      clearInterval(this.schedulerHandle);
      this.schedulerHandle = null;
    }
  }

  public async loadUniverseFromSupabase(): Promise<number> {
    if (!isSupabaseConfigured()) return 0;
    try {
      const supabase = getAdminSupabaseClient();
      const loaded: MarketUniverseEquity[] = [];
      for (let offset = 0; offset < 20000; offset += 1000) {
        const { data, error } = await (supabase as any)
          .from("market_universe_equities")
          .select("*")
          .range(offset, offset + 999);
        if (error || !Array.isArray(data) || data.length === 0) break;
        for (const row of data) {
          if (!row?.isin) continue;
          loaded.push({
            isin: row.isin,
            symbol: row.symbol,
            companyName: row.company_name,
            nseSymbol: row.nse_symbol ?? null,
            bseCode: row.bse_code ?? null,
            exchange: row.exchange,
            series: row.series ?? null,
            listingStatus: row.listing_status ?? "ACTIVE",
            sector: row.sector ?? null,
            industry: row.industry ?? null,
            subIndustry: row.sub_industry ?? null,
            sectorSource: row.sector_source ?? null,
            sectorVerificationStatus: row.sector_verification_status ?? null,
            sectorRetrievedAt: row.sector_retrieved_at ?? null,
            marketCapCr:
              row.market_cap_cr !== null && row.market_cap_cr !== undefined
                ? Number(row.market_cap_cr)
                : null,
            marketCapRank:
              row.market_cap_rank !== null && row.market_cap_rank !== undefined
                ? Number(row.market_cap_rank)
                : null,
            marketCapCategory: row.market_cap_category ?? "UNCLASSIFIED",
            amfiMatched: Boolean(row.amfi_matched),
            amfiPeriod: row.amfi_period ?? null,
            amfiPublicationDate: row.amfi_publication_date ?? null,
            classificationDate: row.classification_date ?? null,
            classificationSource: row.classification_source ?? null,
            sourceProvenance: row.source_provenance ?? "Supabase Persisted Universe",
            lastRefreshedAt: row.last_refreshed_at ?? new Date().toISOString(),
          });
        }
        if (data.length < 1000) break;
      }
      if (loaded.length > 0) {
        this.universeByIsin = new Map(loaded.map((e) => [e.isin, e]));
        this.lastUpdatedAt = loaded[0].lastRefreshedAt;
        this.refreshStatus = "COMPLETED";
      }
      return loaded.length;
    } catch {
      return 0;
    }
  }

  private async persistUniverseSafe(subset?: MarketUniverseEquity[]): Promise<void> {
    if (!isSupabaseConfigured()) return;
    try {
      const supabase = getAdminSupabaseClient();
      const sourceList = subset ?? Array.from(this.universeByIsin.values());
      const rows = sourceList.map((e) => ({
        isin: e.isin,
        symbol: e.symbol,
        company_name: e.companyName,
        nse_symbol: e.nseSymbol,
        bse_code: e.bseCode,
        exchange: e.exchange,
        series: e.series,
        listing_status: e.listingStatus,
        sector: e.sector,
        industry: e.industry,
        sub_industry: e.subIndustry ?? null,
        sector_source: e.sectorSource ?? null,
        sector_verification_status: e.sectorVerificationStatus ?? null,
        sector_retrieved_at: e.sectorRetrievedAt ?? null,
        market_cap_cr: e.marketCapCr,
        market_cap_rank: e.marketCapRank,
        market_cap_category: e.marketCapCategory,
        amfi_matched: Boolean(e.amfiMatched),
        amfi_period: e.amfiPeriod ?? null,
        amfi_publication_date: e.amfiPublicationDate ?? null,
        classification_date: e.classificationDate,
        classification_source: e.classificationSource,
        source_provenance: e.sourceProvenance,
        last_refreshed_at: e.lastRefreshedAt,
      }));
      for (let i = 0; i < rows.length; i += 500) {
        await (supabase as any)
          .from("market_universe_equities")
          .upsert(rows.slice(i, i + 500), { onConflict: "isin" });
      }
    } catch {
      // Non-fatal in-memory fallback
    }
  }

  private async persistRefreshRunSafe(): Promise<void> {
    if (!isSupabaseConfigured()) return;
    try {
      const supabase = getAdminSupabaseClient();
      const s = this.getStats();
      await (supabase as any).from("market_universe_refresh_runs").insert({
        status: s.refreshStatus === "UNINITIALIZED" ? "FAILED" : s.refreshStatus,
        total_eligible: s.totalEligible,
        nse_count: s.nseCount,
        bse_count: s.bseCount,
        dual_count: s.dualCount,
        excluded_count: s.excludedCount,
        small_cap_count: s.smallCapCount,
        mid_cap_count: s.midCapCount,
        large_cap_count: s.largeCapCount,
        missing_sector_count: s.missingSectorCount,
        source_limitations: s.sourceLimitations,
        completed_at: new Date().toISOString(),
      });
    } catch {
      // Non-fatal
    }
  }
}

export const marketUniverseService = new MarketUniverseService();
