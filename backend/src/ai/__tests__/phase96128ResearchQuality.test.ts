import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setSupabaseConfiguredOverride } from "../../db/supabaseClient";
import { computeResearchConfidence } from "../discovery/ConfidenceEngine";
import {
  classifyDataFreshness,
  FundamentalsVerificationService,
} from "../discovery/FundamentalsVerificationService";
import { MarketUniverseService } from "../discovery/MarketUniverseService";
import { Top5DiscoveryEngine } from "../discovery/Top5DiscoveryEngine";
import type { ExternalCompanyResearchSnapshot } from "../evidence/EvidenceCollector";

function makeSnap(symbol: string, publishedAt: string | null = null): ExternalCompanyResearchSnapshot {
  return {
    symbol: `${symbol}.NS`,
    cleanSymbol: symbol,
    companyName: `${symbol} Ltd`,
    fetchedAtIST: "2026-11-16T11:30:00.000Z",
    fundamentals: {
      trailingPE: 18,
      forwardPE: 16,
      priceToBook: 3.5,
      roePct: 22,
      rocePct: 26,
      debtToEquity: 0.1,
      quarterlyRevenueGrowthPct: 16,
      quarterlyEarningsGrowthPct: 20,
      operatingMarginPct: 21,
      ebitdaMarginPct: 24,
      marketCapCr: 8500,
      revenueCr: 2400,
      netProfitCr: 380,
      ebitdaCr: 576,
      totalDebtCr: 80,
      operatingCashFlowCr: 410,
      freeCashFlowCr: 310,
      trailingEps: 42,
      promoterPledgePct: 0,
      publishedAt,
      reportingPeriod: "2026-09-30",
      reportingBasis: "CONSOLIDATED",
    },
    technicals: {
      ltp: 1200,
      vwap: 1185,
      sma20: 1170,
      sma50: 1140,
      rsi14: 58,
      high52w: 1350,
      low52w: 880,
      atr14: 24,
      trend: "BULLISH",
      volumeRatio: 1.3,
    },
    institutionalHoldings: {
      institutionsPercentHeld: 24,
      insidersPromoterPercentHeld: 0.58,
      institutionsCount: 45,
      publishedAt: "2026-09-30",
    },
    newsAndMacro: [
      {
        title: "Strong quarterly earnings",
        source: "Exchange",
        publishedAt: "10:00:00",
        publishedAtIso: "2026-11-10T10:00:00.000Z",
        sentiment: "POSITIVE",
      },
    ],
  } as unknown as ExternalCompanyResearchSnapshot;
}

describe("Phase 9.6.12.8 — Research Quality, Verification, Confidence & Ranking Versioning", () => {
  beforeEach(() => {
    setSupabaseConfiguredOverride(false);
  });
  afterEach(() => {
    setSupabaseConfiguredOverride(null);
  });

  it("1. Classifies publication freshness accurately without confusing reportingPeriod with publishedAt", () => {
    expect(classifyDataFreshness(null).freshnessStatus).toBe("UNKNOWN");
    expect(
      classifyDataFreshness("2026-11-06T18:20:01.000Z", Date.parse("2026-11-16T12:00:00Z"))
        .freshnessStatus
    ).toBe("FRESH");
    expect(
      classifyDataFreshness("2026-01-01T00:00:00.000Z", Date.parse("2026-11-16T12:00:00Z"))
        .freshnessStatus
    ).toBe("STALE");
  });

  it("2. FundamentalsVerificationService merges BSE official filing + Screener cross-verification and handles partial failure", async () => {
    const svc = new FundamentalsVerificationService({
      bseFilingFn: async () => ({
        sourceName: "BSE Official Corporate Filings",
        sourceUrl: "https://www.bseindia.com/xml-data/corpfiling/AttachLive/sample.pdf",
        publishedAt: "2026-11-06T18:20:01.000Z",
        headline: "Financial Results Q2 FY27",
        category: "Financial Results",
        verificationStatus: "VERIFIED",
      }),
      screenerFn: async () => {
        throw new Error("Screener timeout");
      },
    });

    const eq = {
      isin: "INE001A01001",
      symbol: "BANCOINDIA",
      companyName: "Banco Products Ltd",
      nseSymbol: "BANCOINDIA",
      bseCode: "500039",
      exchange: "DUAL" as const,
      series: "EQ",
      listingStatus: "ACTIVE" as const,
      sector: "Consumer Cyclical",
      industry: "Auto Parts",
      marketCapCr: 8500,
      marketCapRank: 450,
      marketCapCategory: "SMALL_CAP" as const,
      classificationDate: "2026-07-06",
      classificationSource: "AMFI",
      sourceProvenance: "NSE + BSE",
      lastRefreshedAt: "2026-11-16T00:00:00.000Z",
    };

    const res = await svc.verifyCompanyEvidence({
      equity: eq,
      snapshot: makeSnap("BANCOINDIA", null),
    });

    expect(res.publishedAt).toBe("2026-11-06T18:20:01.000Z");
    expect(res.reportingPeriod).toBe("2026-09-30");
    expect(res.freshnessStatus).toBe("FRESH");
    expect(res.verifiedMetricCount).toBe(16);
    expect(res.sourceFailures.length).toBe(1);
    expect(res.sourceFailures[0]).toContain("Screener timeout");

    const conf = computeResearchConfidence(res);
    expect(conf.evidenceFreshnessConfidence).toBe("HIGH");
    expect(conf.financialDataConfidence).toBe("HIGH");
    expect(conf.sourceReliabilityConfidence).toBe("MODERATE");
    expect(conf.overallResearchConfidence).toBe("HIGH");
  });

  it("3. Version 2 publication preserves Version 1 in rankingHistory and lifts 78 cap only when verified publishedAt exists", async () => {
    const universe = new MarketUniverseService();
    universe.ingestFromExchangeRecords({
      nseRows: [
        { symbol: "ALPHA", companyName: "Alpha Ltd", isin: "INE001A01001", exchange: "NSE" },
        { symbol: "BETA", companyName: "Beta Ltd", isin: "INE001A01002", exchange: "NSE" },
      ],
      bseRows: [],
    });

    const engine = new Top5DiscoveryEngine({
      universeService: universe,
      snapshotFetcher: async (sym) => makeSnap(sym, null),
    });

    const v1 = await engine.runDiscoveryScan({ userId: "u-v2", batchSize: 10 });
    expect(v1.publishedFinalTop5).toBe(true);
    expect(v1.topPicks[0].compositeResearchScore).toBe(78);

    const mockVerifier = new FundamentalsVerificationService({
      bseFilingFn: async (bseCode) => ({
        sourceName: "BSE Official Corporate Filings",
        sourceUrl: `https://www.bseindia.com/filing/${bseCode ?? "x"}`,
        publishedAt: "2026-11-08T14:00:00.000Z",
        headline: "Q2 Results",
        category: "Financial Results",
        verificationStatus: "VERIFIED",
      }),
      screenerFn: async (sym) => ({
        sourceUrl: `https://www.screener.in/company/${sym}/`,
        retrievedAt: "2026-11-16T11:30:00.000Z",
        sector: "Industrials",
        industry: "Engineering",
        marketCapCr: 8500,
        trailingPE: sym === "BETA" ? 14 : 20,
        priceToBook: 3.2,
        rocePct: sym === "BETA" ? 32 : 24,
        roePct: sym === "BETA" ? 28 : 20,
        promoterHoldingPct: 60,
      }),
    });

    const v2 = await engine.publishVerifiedTop5Version2({
      scanId: v1.scanId,
      userId: "u-v2",
      candidateSymbols: ["ALPHA", "BETA"],
      verifier: mockVerifier,
    });

    expect(v2.version).toBe(2);
    expect(v2.rankingHistory?.length).toBe(2);
    expect(v2.rankingHistory?.[0].version).toBe(1);
    expect(v2.rankingHistory?.[0].topPicks[0].compositeResearchScore).toBe(78);
    expect(v2.topPicks[0].compositeResearchScore).toBeGreaterThan(78);
    expect(v2.topPicks[0].factorBreakdown?.safeguardCapsApplied).toEqual([]);
    expect(v2.topPicks[0].confidenceBreakdown?.overallResearchConfidence).toBe("HIGH");
    expect(v2.rankingHistory?.[1].diffsFromPrevious?.length).toBe(2);
  });
});
