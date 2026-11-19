import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setSupabaseConfiguredOverride } from "../../db/supabaseClient";
import {
  AmfiClassificationService,
  parseAmfiCsvDetailed,
} from "../discovery/AmfiClassificationService";
import { MarketUniverseService } from "../discovery/MarketUniverseService";
import { SectorEnrichmentService } from "../discovery/SectorEnrichmentService";
import { Top5DiscoveryEngine } from "../discovery/Top5DiscoveryEngine";
import type { ExternalCompanyResearchSnapshot } from "../evidence/EvidenceCollector";

function makeSnap(symbol: string): ExternalCompanyResearchSnapshot {
  return {
    symbol: `${symbol}.NS`,
    cleanSymbol: symbol,
    companyName: `${symbol} Ltd`,
    fetchedAtIST: "2026-11-16T05:10:00.000Z",
    fundamentals: {
      trailingPE: 21,
      forwardPE: 19,
      priceToBook: 4,
      roePct: 20,
      rocePct: 22,
      debtToEquity: 0.2,
      quarterlyRevenueGrowthPct: 12,
      quarterlyEarningsGrowthPct: 14,
      operatingMarginPct: 19,
      ebitdaMarginPct: 23,
      marketCapCr: 80000,
      revenueCr: 15000,
      netProfitCr: 2200,
      ebitdaCr: 3450,
      totalDebtCr: 800,
      operatingCashFlowCr: 2500,
      freeCashFlowCr: 1900,
      trailingEps: 50,
      promoterPledgePct: 0,
      publishedAt: "2026-10-20T10:00:00.000Z",
      reportingPeriod: "2026-09-30",
      reportingBasis: "CONSOLIDATED",
    },
    technicals: {
      ltp: 1500,
      changePct: 0.3,
      vwap: 1490,
      ema20: 1470,
      marketPublishedAt: "2026-11-16T05:05:00.000Z",
    },
    institutionalHoldings: {
      institutionsPercentHeld: 25,
      insidersPromoterPercentHeld: 52,
      institutionsCount: 220,
      publishedAt: "2026-10-20T10:00:00.000Z",
    },
    newsAndMacro: [],
  };
}

describe("Phase 9.6.12.2 — AMFI Classification, Sector Enrichment & Resumable Complete Scan", () => {
  beforeEach(() => {
    setSupabaseConfiguredOverride(false);
  });
  afterEach(() => {
    setSupabaseConfiguredOverride(null);
  });

  it("1. Official AMFI ISIN match overrides live estimate, while unmatched stays UNCLASSIFIED", () => {
    const amfiSvc = new AmfiClassificationService();
    amfiSvc.ingestOfficialAmfiRecords({
      records: [
        {
          isin: "INE467B01029",
          companyName: "TCS Ltd",
          amfiRank: 2,
          amfiCategory: "LARGE_CAP",
          sixMonthAvgMarketCapCr: 1450000,
          classificationPeriod: "H1-2026 (Jan-Jun 2026)",
          publicationDate: "2026-07-05",
          source: "AMFI Official Categorization",
        },
      ],
      classificationPeriod: "H1-2026 (Jan-Jun 2026)",
      publicationDate: "2026-07-05",
    });

    const svc = new MarketUniverseService({ amfiService: amfiSvc });
    const stats = svc.ingestFromExchangeRecords({
      nseRows: [
        {
          symbol: "TCS",
          companyName: "TCS Ltd",
          isin: "INE467B01029",
          exchange: "NSE",
          marketCapCr: 1400000,
        },
        {
          symbol: "UNMATCHED",
          companyName: "Unmatched Corp",
          isin: "INE999Z01099",
          exchange: "NSE",
          marketCapCr: 999999,
        },
      ],
      bseRows: [
        {
          symbol: "TCS",
          bseCode: "532540",
          companyName: "TCS Ltd",
          isin: "INE467B01029",
          exchange: "BSE",
        },
      ],
    });

    expect(stats.dualCount).toBe(1);
    expect(stats.amfiMatchedCount).toBe(1);
    expect(stats.largeCapCount).toBe(1);
    expect(stats.unclassifiedCapCount).toBe(1);

    const unmatched = svc.findBySymbol("UNMATCHED");
    expect(unmatched?.amfiMatched).toBe(false);
    expect(unmatched?.marketCapCategory).toBe("UNCLASSIFIED");
    // Dynamic live estimate is stored separately and never promoted to official AMFI
    expect(unmatched?.dynamicCapEstimateCategory).toBe("LARGE_CAP");
  });

  it("2. Sector enrichment stores source, verification status & retrievedAt, and leaves unknown as null", async () => {
    const sectorSvc = new SectorEnrichmentService(async (eq) => {
      if (eq.symbol === "TCS") {
        return {
          sector: "Information Technology",
          industry: "Computers - Software & Consulting",
          subIndustry: "IT Services",
          source: "NSE Official Company Classification (quote-equity)",
          verificationStatus: "VERIFIED",
        };
      }
      return null;
    });

    const svc = new MarketUniverseService({ sectorService: sectorSvc });
    svc.ingestFromExchangeRecords({
      nseRows: [
        { symbol: "TCS", companyName: "TCS Ltd", isin: "INE467B01029", exchange: "NSE" },
        { symbol: "UNKNOWNCO", companyName: "Unknown Co", isin: "INE888A01011", exchange: "NSE" },
      ],
      bseRows: [],
    });

    const { summary } = await svc.enrichSectorsBatch({ batchSize: 10, cursorOffset: 0 });
    expect(summary.enrichedCount).toBe(1);
    expect(summary.missingSectorCount).toBe(1);
    expect(summary.sectorCoveragePct).toBe(50);
    expect(summary.verifiedSectorCount).toBe(1);
    expect(summary.missingSectorSymbolsSample).toEqual(["UNKNOWNCO"]);

    const tcs = svc.findBySymbol("TCS");
    expect(tcs?.sector).toBe("Information Technology");
    expect(tcs?.sectorVerificationStatus).toBe("VERIFIED");
    const unk = svc.findBySymbol("UNKNOWNCO");
    expect(unk?.sector).toBeNull();
  });

  it("3. Resumable scan skips succeeded companies, retries failed ones, and publishes final Top 5 only at 100% completion", async () => {
    const amfiSvc = new AmfiClassificationService();
    amfiSvc.ingestOfficialAmfiRecords({
      records: [
        { isin: "INE001A01001", companyName: "Co1", amfiRank: 1, amfiCategory: "LARGE_CAP", sixMonthAvgMarketCapCr: 100000, classificationPeriod: "H1-2026", publicationDate: "2026-07-05", source: "AMFI" },
        { isin: "INE001A01002", companyName: "Co2", amfiRank: 2, amfiCategory: "LARGE_CAP", sixMonthAvgMarketCapCr: 90000, classificationPeriod: "H1-2026", publicationDate: "2026-07-05", source: "AMFI" },
        { isin: "INE001A01003", companyName: "Co3", amfiRank: 3, amfiCategory: "LARGE_CAP", sixMonthAvgMarketCapCr: 80000, classificationPeriod: "H1-2026", publicationDate: "2026-07-05", source: "AMFI" },
      ],
      classificationPeriod: "H1-2026",
      publicationDate: "2026-07-05",
    });

    const svc = new MarketUniverseService({ amfiService: amfiSvc });
    svc.ingestFromExchangeRecords({
      nseRows: [
        { symbol: "CO1", companyName: "Co1", isin: "INE001A01001", exchange: "NSE" },
        { symbol: "CO2", companyName: "Co2", isin: "INE001A01002", exchange: "NSE" },
        { symbol: "CO3", companyName: "Co3", isin: "INE001A01003", exchange: "NSE" },
      ],
      bseRows: [],
    });

    const callsBySymbol = new Map<string, number>();
    let failCo2 = true;
    const engine = new Top5DiscoveryEngine({
      universeService: svc,
      snapshotFetcher: async (sym) => {
        callsBySymbol.set(sym, (callsBySymbol.get(sym) ?? 0) + 1);
        if (sym === "CO2" && failCo2) {
          throw new Error("Transient 429");
        }
        return makeSnap(sym);
      },
    });

    // Batch 1 (2 of 3): CO1 succeeds, CO2 fails -> PARTIAL_SCAN & publishedFinalTop5 = false
    const batch1 = await engine.runDiscoveryScan({
      userId: "u1",
      filters: { marketCap: "LARGE_CAP" },
      batchSize: 2,
      cursorOffset: 0,
    });
    expect(batch1.scanCompleteness).toBe("PARTIAL_SCAN");
    expect(batch1.publishedFinalTop5).toBe(false);
    expect(batch1.failedCount).toBe(1);
    expect(batch1.nextCursorOffset).toBe(2);

    // Resume Batch 2 with retryFailed=true: CO1 is NOT re-fetched; CO2 retries & succeeds; CO3 succeeds -> COMPLETE_SCAN & publishedFinalTop5 = true
    failCo2 = false;
    const batch2 = await engine.resumeDiscoveryScan({
      scanId: batch1.scanId,
      userId: "u1",
      batchSize: 5,
      retryFailed: true,
    });
    expect(batch2.scanCompleteness).toBe("COMPLETE_SCAN");
    expect(batch2.publishedFinalTop5).toBe(true);
    expect(batch2.completionPct).toBe(100);
    expect(batch2.failedCount).toBe(0);
    expect(batch2.succeededCount).toBe(3);
    expect(callsBySymbol.get("CO1")).toBe(1); // Not restarted!
    expect(callsBySymbol.get("CO2")).toBe(2); // Retried once
    expect(callsBySymbol.get("CO3")).toBe(1);
  });

  it("4. parseAmfiCsvDetailed parses official 30 Jun 2026 AMFI CSV format, tracks duplicates/rejections, and preserves existing dataset on failed import", () => {
    const csvText = [
      "Average Market Capitalization of listed companies during the six months ended 30 June 2026,,,,,,,,,,",
      'Sr. No.,Company name,ISIN,BSE Symbol,BSE 6 month Avg Total Market Cap in (Rs. Crs.),NSE Symbol,NSE 6 month Avg Total Market Cap (Rs. Cr.),MSEI Symbol,MSEI 6 month Avg Total Market Cap in (Rs Crs.),Average of All Exchanges (Rs. Cr.),"Categorization as per SEBI Circular dated Oct 6, 2017"',
      '1,"Reliance Industries Ltd.",INE002A01018,500325,2000000,RELIANCE,2001000,,,2000500,Large Cap',
      '101,"Midcap Corp, India",INE101A01022,500101,45000,MIDCAP,45100,,,45050,Mid Cap',
      '251,"Smallcap Ltd",INE251A01033,500251,5000,SMALLCAP,5010,,,5005,Small Cap',
      '252,"Duplicate ISIN Co",INE002A01018,500999,1000,DUP,1000,,,1000,Small Cap',
      '253,"Malformed Row",BADISIN,500888,100,BAD,100,,,100,Small Cap',
    ].join("\n");

    const parsed = parseAmfiCsvDetailed(csvText, {
      classificationPeriod: "Jan–Jun 2026 (ended 30 June 2026)",
      publicationDate: "2026-07-06",
    });

    expect(parsed.totalSourceRows).toBe(5);
    expect(parsed.records.length).toBe(3);
    expect(parsed.duplicateIsinCount).toBe(1);
    expect(parsed.rejectedRowCount).toBe(1);
    expect(parsed.records[0].amfiRank).toBe(1);
    expect(parsed.records[0].amfiCategory).toBe("LARGE_CAP");
    expect(parsed.records[1].amfiCategory).toBe("MID_CAP");
    expect(parsed.records[2].amfiCategory).toBe("SMALL_CAP");

    const amfiSvc = new AmfiClassificationService();
    const meta = amfiSvc.ingestOfficialAmfiRecords({
      records: parsed.records,
      classificationPeriod: "Jan–Jun 2026 (ended 30 June 2026)",
      publicationDate: "2026-07-06",
      totalSourceRows: parsed.totalSourceRows,
      duplicateIsinCount: parsed.duplicateIsinCount,
      rejectedRowCount: parsed.rejectedRowCount,
    });
    expect(meta.officialCategoryCounts).toEqual({ largeCap: 1, midCap: 1, smallCap: 1 });

    // Non-destructive failed import must not wipe valid existing dataset
    const failedMeta = amfiSvc.ingestOfficialAmfiRecords({
      records: [],
      classificationPeriod: "Bad",
      publicationDate: "2026-07-07",
    });
    expect(failedMeta.totalOfficialRecords).toBe(3);
    expect(failedMeta.limitations.some((l) => l.includes("0 valid ISIN"))).toBe(true);
    expect(amfiSvc.lookupByIsin("INE002A01018")?.amfiCategory).toBe("LARGE_CAP");
  });

  it("5. Unified Overall Top 5 allows Small Cap to outrank Large Cap with zero category quotas and single publicationLabel", async () => {
    const amfiSvc = new AmfiClassificationService();
    amfiSvc.ingestOfficialAmfiRecords({
      records: [
        { isin: "INE001A01001", companyName: "Weak Large Cap", amfiRank: 10, amfiCategory: "LARGE_CAP", sixMonthAvgMarketCapCr: 150000, classificationPeriod: "H1-2026", publicationDate: "2026-07-06", source: "AMFI" },
        { isin: "INE001A01002", companyName: "Strong Small Cap", amfiRank: 450, amfiCategory: "SMALL_CAP", sixMonthAvgMarketCapCr: 3500, classificationPeriod: "H1-2026", publicationDate: "2026-07-06", source: "AMFI" },
        { isin: "INE001A01003", companyName: "Solid Mid Cap", amfiRank: 130, amfiCategory: "MID_CAP", sixMonthAvgMarketCapCr: 28000, classificationPeriod: "H1-2026", publicationDate: "2026-07-06", source: "AMFI" },
      ],
      classificationPeriod: "H1-2026",
      publicationDate: "2026-07-06",
    });

    const svc = new MarketUniverseService({ amfiService: amfiSvc });
    svc.ingestFromExchangeRecords({
      nseRows: [
        { symbol: "WEAKLC", companyName: "Weak Large Cap", isin: "INE001A01001", exchange: "NSE" },
        { symbol: "STRONGSC", companyName: "Strong Small Cap", isin: "INE001A01002", exchange: "NSE" },
        { symbol: "SOLIDMC", companyName: "Solid Mid Cap", isin: "INE001A01003", exchange: "NSE" },
      ],
      bseRows: [],
    });

    const engine = new Top5DiscoveryEngine({
      universeService: svc,
      snapshotFetcher: async (sym) => {
        const base = makeSnap(sym);
        if (sym === "WEAKLC") {
          return {
            ...base,
            fundamentals: {
              ...base.fundamentals,
              roePct: 7,
              rocePct: 8,
              debtToEquity: 1.8, // triggers safeguard cap
              trailingPE: 65,
              quarterlyRevenueGrowthPct: -2,
              quarterlyEarningsGrowthPct: -5,
              operatingMarginPct: 6,
              marketCapCr: 150000,
            },
          };
        }
        if (sym === "STRONGSC") {
          return {
            ...base,
            fundamentals: {
              ...base.fundamentals,
              roePct: 28,
              rocePct: 32,
              debtToEquity: 0.05,
              trailingPE: 16,
              quarterlyRevenueGrowthPct: 24,
              quarterlyEarningsGrowthPct: 30,
              operatingMarginPct: 24,
              marketCapCr: 3500,
            },
          };
        }
        return {
          ...base,
          fundamentals: {
            ...base.fundamentals,
            roePct: 15,
            rocePct: 16,
            trailingPE: 30,
            marketCapCr: 28000,
          },
        };
      },
    });

    const res = await engine.runDiscoveryScan({
      userId: "u-unified",
      filters: { marketCap: "ALL" },
      batchSize: 10,
      cursorOffset: 0,
    });

    expect(res.scanCompleteness).toBe("COMPLETE_SCAN");
    expect(res.publishedFinalTop5).toBe(true);
    expect(res.publicationLabel).toBe("OVERALL TOP 5");
    expect((res as any).scopedTopPicks).toBeUndefined();
    expect(res.topPicks[0].symbol).toBe("STRONGSC");
    expect(res.topPicks[0].marketCapCategory).toBe("SMALL_CAP");
    expect(res.topPicks.findIndex((p) => p.symbol === "STRONGSC")).toBeLessThan(
      res.topPicks.findIndex((p) => p.symbol === "WEAKLC")
    );
  });

  it("6. Partial scan never publishes final Overall Top 5 and sets PARTIAL SCAN — PROVISIONAL CANDIDATES ONLY", async () => {
    const amfiSvc = new AmfiClassificationService();
    const svc = new MarketUniverseService({ amfiService: amfiSvc });
    svc.ingestFromExchangeRecords({
      nseRows: [
        { symbol: "S1", companyName: "Stock 1", isin: "INE001A01001", exchange: "NSE" },
        { symbol: "S2", companyName: "Stock 2", isin: "INE001A01002", exchange: "NSE" },
      ],
      bseRows: [],
    });

    const engine = new Top5DiscoveryEngine({
      universeService: svc,
      snapshotFetcher: async (sym) => makeSnap(sym),
    });

    const partial = await engine.runDiscoveryScan({
      userId: "u-partial",
      filters: { marketCap: "ALL" },
      batchSize: 1,
      cursorOffset: 0,
    });

    expect(partial.scanCompleteness).toBe("PARTIAL_SCAN");
    expect(partial.publishedFinalTop5).toBe(false);
    expect(partial.publicationLabel).toBe(
      "PARTIAL SCAN — PROVISIONAL CANDIDATES ONLY"
    );
    expect(partial.remainingCount).toBe(1);
    expect(partial.completionPct).toBe(50);
  });

  it("7. Partial exchange refresh (empty BSE feed) preserves existing BSE and DUAL equities without shrinking universe", async () => {
    const svc = new MarketUniverseService();
    svc.ingestFromExchangeRecords({
      nseRows: [
        { symbol: "RELIANCE", companyName: "Reliance", isin: "INE002A01018", exchange: "NSE" },
        { symbol: "NSEONLY", companyName: "NSE Only", isin: "INE001A01099", exchange: "NSE" },
      ],
      bseRows: [
        { symbol: "RELIANCE", bseCode: "500325", companyName: "Reliance", isin: "INE002A01018", exchange: "BSE" },
        { symbol: "BSEONLY", bseCode: "500999", companyName: "BSE Only", isin: "INE009A01011", exchange: "BSE" },
      ],
    });
    expect(svc.getStats().totalEligible).toBe(3);

    // Simulate NSE succeeding while BSE returns HTTP 503
    const statsAfterPartial = await svc.refreshFromOfficialExchanges({
      fetchImpl: (async (url: string) => {
        if (url.includes("nseindia.com")) {
          return {
            ok: true,
            status: 200,
            text: async () =>
              [
                "SYMBOL,NAME OF COMPANY,SERIES,DATE OF LISTING,PAID UP VALUE,MARKET LOT,ISIN NUMBER,FACE VALUE",
                "RELIANCE,Reliance,EQ,01-JAN-2000,10,1,INE002A01018,10",
                "NSEONLY,NSE Only,EQ,01-JAN-2000,10,1,INE001A01099,10",
              ].join("\n"),
          } as Response;
        }
        return { ok: false, status: 503 } as Response;
      }) as typeof fetch,
      timeoutMs: 2000,
    });

    expect(statsAfterPartial.totalEligible).toBe(3);
    expect(statsAfterPartial.bseCount).toBe(1);
    expect(statsAfterPartial.dualCount).toBe(1);
    expect(statsAfterPartial.refreshStatus).toBe("PARTIAL");
  });

  it("8. Autonomous/resumable scan enforces worker lock and bounded retries without losing succeeded picks", async () => {
    const svc = new MarketUniverseService();
    svc.ingestFromExchangeRecords({
      nseRows: [
        { symbol: "AAA_GOOD", companyName: "Good 1", isin: "INE001A01001", exchange: "NSE" },
        { symbol: "ZZZ_BAD", companyName: "Bad 1", isin: "INE001A01002", exchange: "NSE" },
      ],
      bseRows: [],
    });

    let slowResolve!: () => void;
    const slowGate = new Promise<void>((r) => {
      slowResolve = r;
    });
    const engine = new Top5DiscoveryEngine({
      universeService: svc,
      snapshotFetcher: async (sym) => {
        if (sym === "ZZZ_BAD") {
          await slowGate;
          throw new Error("Persistent API failure");
        }
        return makeSnap(sym);
      },
    });

    // Batch 1 succeeds for GOOD1
    const s1 = await engine.runDiscoveryScan({
      userId: "u-lock",
      batchSize: 1,
      cursorOffset: 0,
    });
    expect(s1.succeededCount).toBe(1);

    // Start resume on BAD1 (blocks on slowResolve), then verify concurrent resume throws worker lock error
    const resumePromise = engine.resumeDiscoveryScan({
      scanId: s1.scanId,
      userId: "u-lock",
      batchSize: 1,
    });
    await new Promise((r) => setTimeout(r, 20));
    await expect(
      engine.resumeDiscoveryScan({
        scanId: s1.scanId,
        userId: "u-lock",
        batchSize: 1,
      })
    ).rejects.toThrow("already active");

    slowResolve();
    const s2 = await resumePromise;
    expect(s2.succeededCount).toBe(1);
    expect(s2.failedCount).toBe(1);
    expect(s2.publishedFinalTop5).toBe(false);
    expect(s2.publicationLabel).toBe("PARTIAL SCAN — PROVISIONAL CANDIDATES ONLY");
  });

  it("9. Explicit exclusion of terminal BSE-only unavailable stocks reconciles completeness without inflating succeededCount", async () => {
    const svc = new MarketUniverseService();
    svc.ingestFromExchangeRecords({
      nseRows: [
        { symbol: "AAA_OK", companyName: "Good NSE", isin: "INE001A01001", exchange: "NSE" },
      ],
      bseRows: [
        { symbol: "ZZZ_BSE", bseCode: "500999", companyName: "Unavailable BSE", isin: "INE001A01002", exchange: "BSE" },
      ],
    });

    const engine = new Top5DiscoveryEngine({
      universeService: svc,
      snapshotFetcher: async (sym) => {
        if (sym === "ZZZ_BSE") {
          throw new Error("FUNDAMENTALS_UNAVAILABLE: live fundamentals not returned for ZZZ_BSE.BO.");
        }
        return makeSnap(sym);
      },
    });

    // Exhaust retries (initial + 3 resumes = MAX_POST_FIX_RETRIES = 2 after resolverFixVersion)
    const s1 = await engine.runDiscoveryScan({ userId: "u-excl", batchSize: 10 });
    expect(s1.publishedFinalTop5).toBe(false);
    await engine.resumeDiscoveryScan({ scanId: s1.scanId, userId: "u-excl", batchSize: 10, retryOnly: true });
    await engine.resumeDiscoveryScan({ scanId: s1.scanId, userId: "u-excl", batchSize: 10, retryOnly: true });
    const s4 = await engine.resumeDiscoveryScan({ scanId: s1.scanId, userId: "u-excl", batchSize: 10, retryOnly: true });
    expect(s4.failedCount).toBe(1);
    expect(s4.retryPendingCount).toBe(0);
    expect(s4.publishedFinalTop5).toBe(false);

    // Apply audited exclusion
    const finalRes = await engine.excludeUnavailableFailedSymbols({
      scanId: s1.scanId,
      userId: "u-excl",
    });
    expect(finalRes.succeededCount).toBe(1);
    expect(finalRes.excludedCount).toBe(1);
    expect(finalRes.failedCount).toBe(0);
    expect(finalRes.scanCompleteness).toBe("COMPLETE_SCAN");
    expect(finalRes.publishedFinalTop5).toBe(true);
    expect(finalRes.publicationLabel).toBe("OVERALL TOP 5");
    expect(finalRes.failedSymbols[0].status).toBe("EXCLUDED_UNAVAILABLE_DATA");
    expect(finalRes.failedSymbols[0].exclusionReason).toBe("BSE_ONLY_FUNDAMENTALS_UNAVAILABLE");
    expect(finalRes.topPicks.map((p) => p.symbol)).toEqual(["AAA_OK"]);
  });
});

