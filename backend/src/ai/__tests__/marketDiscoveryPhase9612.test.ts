import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setSupabaseConfiguredOverride } from "../../db/supabaseClient";
import {
  MarketUniverseService,
  parseNseEquityCsv,
} from "../discovery/MarketUniverseService";
import {
  AmfiClassificationService,
  mapAmfiRankToCategory,
} from "../discovery/AmfiClassificationService";
import { AutoPeerComparisonService } from "../discovery/AutoPeerComparisonService";
import { Top5DiscoveryEngine } from "../discovery/Top5DiscoveryEngine";
import type { ExternalCompanyResearchSnapshot } from "../evidence/EvidenceCollector";

function makeSnapshot(
  symbol: string,
  overrides?: Partial<ExternalCompanyResearchSnapshot["fundamentals"]>
): ExternalCompanyResearchSnapshot {
  return {
    symbol: `${symbol}.NS`,
    cleanSymbol: symbol,
    companyName: `${symbol} Ltd`,
    fetchedAtIST: "2026-11-16T04:30:00.000Z",
    fundamentals: {
      trailingPE: 20,
      forwardPE: 18,
      priceToBook: 4.5,
      roePct: 22,
      rocePct: 24,
      debtToEquity: 0.2,
      quarterlyRevenueGrowthPct: 14,
      quarterlyEarningsGrowthPct: 16,
      operatingMarginPct: 21,
      ebitdaMarginPct: 25,
      marketCapCr: 150000,
      revenueCr: 25000,
      netProfitCr: 3750,
      ebitdaCr: 6250,
      totalDebtCr: 1200,
      operatingCashFlowCr: 4100,
      freeCashFlowCr: 3200,
      trailingEps: 85,
      promoterPledgePct: 0,
      publishedAt: "2026-10-15T12:00:00.000Z",
      reportingPeriod: "2026-09-30",
      reportingBasis: "CONSOLIDATED",
      ...overrides,
    },
    technicals: {
      ltp: 2200,
      changePct: 0.4,
      vwap: 2180,
      ema20: 2150,
      marketPublishedAt: "2026-11-16T04:25:00.000Z",
    },
    institutionalHoldings: {
      institutionsPercentHeld: 28,
      insidersPromoterPercentHeld: 55,
      institutionsCount: 350,
      publishedAt: "2026-10-15T12:00:00.000Z",
    },
    newsAndMacro: [],
  };
}

describe("Phase 9.6.12 — Full NSE/BSE Universe, Auto Peer Comparison & Top 5 Discovery", () => {
  beforeEach(() => {
    setSupabaseConfiguredOverride(false);
  });
  afterEach(() => {
    setSupabaseConfiguredOverride(null);
  });
  it("1. Ingests NSE/BSE, deduplicates dual-listed by ISIN, excludes ETFs/debt/warrants/suspended, and preserves universe on empty refresh", () => {
    const svc = new MarketUniverseService();
    const csv = [
      "SYMBOL,NAME OF COMPANY, SERIES, DATE OF LISTING, PAID UP VALUE, MARKET LOT, ISIN NUMBER, FACE VALUE",
      "TCS,Tata Consultancy Services Limited,EQ,25-AUG-2004,1,1,INE467B01029,1",
      "NIFTYBEES,Nippon India ETF Nifty 50 BeES,EQ,08-JAN-2002,1,1,INF204KB14I2,1",
      "RELIANCE,Reliance Industries Limited,EQ,29-NOV-1977,10,1,INE002A01018,10",
    ].join("\n");

    const parsedNse = parseNseEquityCsv(csv);
    expect(parsedNse).toHaveLength(3);

    const stats = svc.ingestFromExchangeRecords({
      nseRows: parsedNse.map((r) => ({
        ...r,
        sector: "Technology",
        industry: "IT Services",
        marketCapCr: r.symbol === "TCS" ? 1400000 : 1800000,
      })),
      bseRows: [
        // Dual listed TCS by ISIN
        {
          symbol: "TCS",
          bseCode: "532540",
          companyName: "Tata Consultancy Services Limited",
          isin: "INE467B01029",
          exchange: "BSE",
          series: "A",
          listingStatus: "ACTIVE",
        },
        // BSE-only active equity
        {
          symbol: "BSEONLY",
          bseCode: "500999",
          companyName: "BSE Only Engineering Ltd",
          isin: "INE999A01011",
          exchange: "BSE",
          series: "B",
          listingStatus: "ACTIVE",
          marketCapCr: 5000,
          sector: "Industrials",
        },
        // Excluded debt security & suspended security & warrant
        {
          symbol: "BOND26",
          companyName: "Test NCD Bond 2026",
          isin: "INE111A07011",
          exchange: "BSE",
          series: "N1",
          listingStatus: "ACTIVE",
        },
        {
          symbol: "SUSP1",
          companyName: "Suspended Co Ltd",
          isin: "INE222A01011",
          exchange: "BSE",
          series: "X",
          listingStatus: "SUSPENDED",
        },
        {
          symbol: "WARR1",
          companyName: "Test Warrant",
          isin: "INE333A01011",
          exchange: "BSE",
          series: "W1",
          listingStatus: "ACTIVE",
        },
      ],
    });

    expect(stats.totalEligible).toBe(3); // TCS (DUAL), RELIANCE (NSE), BSEONLY (BSE)
    expect(stats.dualCount).toBe(1);
    expect(stats.nseCount).toBe(1);
    expect(stats.bseCount).toBe(1);
    expect(stats.excludedCount).toBe(4); // NIFTYBEES ETF, BOND26, SUSP1, WARR1

    // Empty refresh must NOT wipe out valid universe
    const afterEmpty = svc.ingestFromExchangeRecords({
      nseRows: [],
      bseRows: [],
      sourceLimitations: ["Exchange unavailable"],
    });
    expect(afterEmpty.totalEligible).toBe(3);
    expect(afterEmpty.refreshStatus).toBe("PARTIAL");
  });

  it("2. Classifies Large (1-100), Mid (101-250), Small (251+) by official AMFI ISIN match and leaves unmatched UNCLASSIFIED", () => {
    const amfiSvc = new AmfiClassificationService();
    const amfiRecords = Array.from({ length: 259 }, (_, idx) => ({
      isin: `INE000A${String(idx + 1).padStart(5, "0")}`,
      companyName: `Equity ${idx + 1} Ltd`,
      amfiRank: idx + 1,
      amfiCategory: mapAmfiRankToCategory(idx + 1),
      sixMonthAvgMarketCapCr: 500000 - idx * 1000,
      classificationPeriod: "H1-2026 (Jan-Jun 2026)",
      publicationDate: "2026-07-05",
      source: "AMFI Official Categorization",
    }));
    amfiSvc.ingestOfficialAmfiRecords({
      records: amfiRecords,
      classificationPeriod: "H1-2026 (Jan-Jun 2026)",
      publicationDate: "2026-07-05",
    });

    const svc = new MarketUniverseService({ amfiService: amfiSvc });
    const nseRows = Array.from({ length: 260 }, (_, idx) => ({
      symbol: `EQ${idx + 1}`,
      companyName: `Equity ${idx + 1} Ltd`,
      isin: `INE000A${String(idx + 1).padStart(5, "0")}`,
      exchange: "NSE" as const,
      series: "EQ",
      listingStatus: "ACTIVE",
      marketCapCr: idx === 259 ? 900000 : 500000 - idx * 1000,
    }));

    const stats = svc.ingestFromExchangeRecords({ nseRows, bseRows: [] });
    expect(stats.largeCapCount).toBe(100);
    expect(stats.midCapCount).toBe(150);
    expect(stats.smallCapCount).toBe(9);
    // EQ260 has live marketCapCr=900000 but NO official AMFI match -> must stay UNCLASSIFIED!
    expect(stats.unclassifiedCapCount).toBe(1);
    expect(stats.amfiMatchedCount).toBe(259);

    const midPage = svc.queryUniverse({ marketCap: "MID_CAP", limit: 10, offset: 0 });
    expect(midPage.totalMatching).toBe(150);
    expect(midPage.items).toHaveLength(10);
  });

  it("3. Automatically discovers industry peers and blocks rankings on incompatible reporting periods or Consolidated/Standalone mix", async () => {
    const amfiSvc = new AmfiClassificationService();
    amfiSvc.ingestOfficialAmfiRecords({
      records: [
        { isin: "INE467B01029", companyName: "TCS Ltd", amfiRank: 2, amfiCategory: "LARGE_CAP", sixMonthAvgMarketCapCr: 1400000, classificationPeriod: "H1-2026", publicationDate: "2026-07-05", source: "AMFI" },
        { isin: "INE009A01021", companyName: "Infosys Ltd", amfiRank: 5, amfiCategory: "LARGE_CAP", sixMonthAvgMarketCapCr: 750000, classificationPeriod: "H1-2026", publicationDate: "2026-07-05", source: "AMFI" },
        { isin: "INE075A01022", companyName: "Wipro Ltd", amfiRank: 15, amfiCategory: "LARGE_CAP", sixMonthAvgMarketCapCr: 300000, classificationPeriod: "H1-2026", publicationDate: "2026-07-05", source: "AMFI" },
      ],
      classificationPeriod: "H1-2026",
      publicationDate: "2026-07-05",
    });
    const svc = new MarketUniverseService({ amfiService: amfiSvc });
    svc.ingestFromExchangeRecords({
      nseRows: [
        { symbol: "TCS", companyName: "TCS Ltd", isin: "INE467B01029", exchange: "NSE", sector: "Technology", industry: "IT Services", marketCapCr: 1400000 },
        { symbol: "INFY", companyName: "Infosys Ltd", isin: "INE009A01021", exchange: "NSE", sector: "Technology", industry: "IT Services", marketCapCr: 750000 },
        { symbol: "WIPRO", companyName: "Wipro Ltd", isin: "INE075A01022", exchange: "NSE", sector: "Technology", industry: "IT Services", marketCapCr: 300000 },
      ],
      bseRows: [],
    });

    const compatiblePeerSvc = new AutoPeerComparisonService({
      universeService: svc,
      snapshotFetcher: async (sym) =>
        makeSnapshot(sym, { roePct: sym === "TCS" ? 50 : sym === "INFY" ? 31 : 17 }),
    });
    const okRes = await compatiblePeerSvc.compareWithAutoPeers({ targetSymbol: "TCS" });
    expect(okRes.selectionMode).toBe("AUTO_INDUSTRY_CAP");
    expect(okRes.selectedPeerSymbols).toEqual(["INFY", "WIPRO"]);
    expect(okRes.comparablePeriodValid).toBe(true);
    expect(okRes.comparableBasisValid).toBe(true);
    expect(okRes.metricRankings[0].strongestSymbol).toBe("TCS");

    // Incompatible Consolidated vs Standalone & different reporting period
    const mixedPeerSvc = new AutoPeerComparisonService({
      universeService: svc,
      snapshotFetcher: async (sym) =>
        makeSnapshot(sym, {
          reportingBasis: sym === "WIPRO" ? "STANDALONE" : "CONSOLIDATED",
          reportingPeriod: sym === "WIPRO" ? "2026-06-30" : "2026-09-30",
        }),
    });
    const badRes = await mixedPeerSvc.compareWithAutoPeers({ targetSymbol: "TCS" });
    expect(badRes.comparablePeriodValid).toBe(false);
    expect(badRes.comparableBasisValid).toBe(false);
    expect(badRes.compatibilityWarnings.length).toBe(2);
    expect(badRes.metricRankings[0].comparable).toBe(false);
    expect(badRes.metricRankings[0].rankings).toEqual([]);
  });

  it("4. Top 5 Discovery enforces risk/missing-data caps, reproducibility, partial-scan disclosure, and user isolation", async () => {
    const amfiSvc = new AmfiClassificationService();
    amfiSvc.ingestOfficialAmfiRecords({
      records: [
        { isin: "INE001A01001", companyName: "Strong One Ltd", amfiRank: 10, amfiCategory: "LARGE_CAP", sixMonthAvgMarketCapCr: 200000, classificationPeriod: "H1-2026", publicationDate: "2026-07-05", source: "AMFI" },
        { isin: "INE001A01002", companyName: "High Pledge Ltd", amfiRank: 12, amfiCategory: "LARGE_CAP", sixMonthAvgMarketCapCr: 180000, classificationPeriod: "H1-2026", publicationDate: "2026-07-05", source: "AMFI" },
        { isin: "INE001A01003", companyName: "Missing Data Ltd", amfiRank: 14, amfiCategory: "LARGE_CAP", sixMonthAvgMarketCapCr: 160000, classificationPeriod: "H1-2026", publicationDate: "2026-07-05", source: "AMFI" },
        { isin: "INE001A01004", companyName: "Fail Fetch Ltd", amfiRank: 16, amfiCategory: "LARGE_CAP", sixMonthAvgMarketCapCr: 140000, classificationPeriod: "H1-2026", publicationDate: "2026-07-05", source: "AMFI" },
      ],
      classificationPeriod: "H1-2026",
      publicationDate: "2026-07-05",
    });
    const svc = new MarketUniverseService({ amfiService: amfiSvc });
    svc.ingestFromExchangeRecords({
      nseRows: [
        { symbol: "STRONG1", companyName: "Strong One Ltd", isin: "INE001A01001", exchange: "NSE", sector: "Technology", industry: "IT Services", marketCapCr: 200000 },
        { symbol: "HIGHPLEDGE", companyName: "High Pledge Ltd", isin: "INE001A01002", exchange: "NSE", sector: "Technology", industry: "IT Services", marketCapCr: 180000 },
        { symbol: "MISSINGDATA", companyName: "Missing Data Ltd", isin: "INE001A01003", exchange: "NSE", sector: "Technology", industry: "IT Services", marketCapCr: 160000 },
        { symbol: "FAILFETCH", companyName: "Fail Fetch Ltd", isin: "INE001A01004", exchange: "NSE", sector: "Technology", industry: "IT Services", marketCapCr: 140000 },
      ],
      bseRows: [],
    });

    const engine = new Top5DiscoveryEngine({
      universeService: svc,
      snapshotFetcher: async (sym) => {
        if (sym === "FAILFETCH") throw new Error("Provider timeout");
        if (sym === "HIGHPLEDGE") {
          return makeSnapshot(sym, { promoterPledgePct: 35, roePct: 28 });
        }
        if (sym === "MISSINGDATA") {
          return makeSnapshot(sym, {
            revenueCr: null,
            netProfitCr: null,
            operatingCashFlowCr: null,
            publishedAt: null,
          });
        }
        return makeSnapshot(sym);
      },
    });

    const scan1 = await engine.runDiscoveryScan({
      userId: "user-alpha",
      filters: { marketCap: "LARGE_CAP", riskProfile: "BALANCED" },
      batchSize: 10,
      cursorOffset: 0,
    });
    const scan2 = await engine.runDiscoveryScan({
      userId: "user-alpha",
      filters: { marketCap: "LARGE_CAP", riskProfile: "BALANCED" },
      batchSize: 10,
      cursorOffset: 0,
    });

    expect(scan1.scanCompleteness).toBe("PARTIAL_SCAN"); // FAILFETCH failed
    expect(scan1.failedCount).toBe(1);
    expect(scan1.topPicks[0].symbol).toBe("STRONG1");
    expect(scan1.topPicks.map((p) => p.symbol)).toEqual(
      scan2.topPicks.map((p) => p.symbol)
    );

    const pledgePick = scan1.topPicks.find((p) => p.symbol === "HIGHPLEDGE");
    const missingPick = scan1.topPicks.find((p) => p.symbol === "MISSINGDATA");
    expect(pledgePick!.compositeResearchScore).toBeLessThanOrEqual(52);
    expect(missingPick!.compositeResearchScore).toBeLessThanOrEqual(55);

    // User isolation: user-beta must not see user-alpha's scan history
    const alphaHist = await engine.listUserScanHistory("user-alpha", 10, 0);
    const betaHist = await engine.listUserScanHistory("user-beta", 10, 0);
    expect(alphaHist.total).toBe(2);
    expect(betaHist.total).toBe(0);
  });
});
