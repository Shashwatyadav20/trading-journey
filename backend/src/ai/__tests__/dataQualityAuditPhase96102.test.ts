import { describe, expect, it } from "vitest";
import { InstitutionalResearchIntelligenceService } from "../context/InstitutionalResearchIntelligenceService";
import { InstitutionalResearchBriefService } from "../context/InstitutionalResearchBriefService";
import {
  EvidenceCollector,
  type ExternalCompanyResearchSnapshot,
} from "../evidence/EvidenceCollector";
import type {
  PreservedEvidenceReference,
  UnifiedIntelligenceContext,
} from "../context/UnifiedContextSchema";

function makeRef(
  overrides: Partial<PreservedEvidenceReference> & { evidenceId: string }
): PreservedEvidenceReference {
  const nowIso = "2026-11-16T03:40:00.000Z";
  return {
    agentSource: "company_research",
    provider: "yahoo",
    sourceName: "Yahoo Finance",
    sourceUrl: "https://finance.yahoo.com",
    sourceTier: "VERIFIED_FINANCIAL_PROVIDER",
    sourceClassification: "VERIFIED_FINANCIAL_PROVIDER",
    publicationTimestamp: null,
    retrievalTimestamp: nowIso,
    reportingPeriod: "Q2FY27",
    verificationStatus: "UNVERIFIED",
    freshnessStatus: "FRESH",
    granularFreshness: "FRESH",
    confidenceLimitations: [],
    symbol: "TCS",
    category: "QUARTERLY_FINANCIALS",
    claim: "return_on_equity",
    value: 51.2,
    unit: "%",
    currency: null,
    ...overrides,
  };
}

function makeBaseContext(
  refs: PreservedEvidenceReference[],
  partial = true
): UnifiedIntelligenceContext {
  const freshCount = refs.filter((r) => r.granularFreshness === "FRESH").length;
  const agingCount = refs.filter((r) => r.granularFreshness === "AGING").length;
  const staleCount = refs.filter((r) => r.granularFreshness === "STALE").length;
  const expiredCount = refs.filter((r) => r.granularFreshness === "EXPIRED").length;
  const unknownCount = refs.filter((r) => r.granularFreshness === "UNKNOWN").length;

  return {
    contextId: "ctx_tcs_audit",
    userId: "user_1",
    symbol: "TCS",
    companyName: "Tata Consultancy Services Ltd",
    exchange: "NSE",
    createdAt: "2026-11-16T03:40:00.000Z",
    marketTimestamp: null,
    contextStatus: partial ? "PARTIAL" : "COMPLETE",
    researchPeriod: {
      requestedPeriod: null,
      normalizedRequestedPeriod: null,
      detectedPeriods: ["Q2FY27"],
      incompatiblePeriodsRejected: [],
    },
    evidenceReferences: refs,
    sourceProvenance: [
      {
        sourceName: "Yahoo Finance",
        sourceTier: "VERIFIED_FINANCIAL_PROVIDER",
        sourceClassification: "VERIFIED_FINANCIAL_PROVIDER",
        sourceUrl: "https://finance.yahoo.com",
        evidenceCount: refs.length,
        agentSources: ["company_research"],
      },
    ],
    freshnessSummary: {
      freshCount,
      agingCount,
      staleCount,
      expiredCount,
      unknownCount,
      hasMixedFreshness: freshCount + agingCount > 0 && (staleCount + expiredCount > 0 || unknownCount > 0),
      explicitWarning: expiredCount > 0 ? "Contains expired evidence" : null,
    },
    conflicts: [],
    missingData: ["Free Cash Flow"],
    agentExecutions: [
      {
        agentName: "company_research",
        executionStatus: partial ? "PARTIAL" : "SUCCESS",
        providerUsed: "deterministic",
        generationMode: partial ? "DETERMINISTIC" : "LIVE_AI",
        cacheHit: false,
        error: partial ? "AI synthesis failed" : null,
        evidenceCount: refs.length,
        freshnessSummary: {
          freshCount,
          staleCount,
          expiredCount,
          unknownCount,
          label: expiredCount > 0 ? "STALE_OR_EXPIRED" : "FRESH",
        },
      },
    ],
    qualityAssessment: {
      availableEvidenceCount: refs.length,
      missingDataCount: 1,
      staleEvidenceCount: staleCount,
      expiredEvidenceCount: expiredCount,
      conflictedEvidenceCount: 0,
      completedAgentsCount: 1,
      failedAgentsCount: partial ? 2 : 0,
      skippedAgentsCount: 0,
      completedAgents: ["company_research"],
      failedAgents: partial ? ["institutional_intelligence", "news_macro"] : [],
      skippedAgents: [],
      qualityClassification: partial ? "PARTIAL" : "COMPLETE",
    },
  };
}

describe("Phase 9.6.10.2 — Institutional Research Data Quality Audit", () => {
  const scorecardService = new InstitutionalResearchIntelligenceService();
  const briefService = new InstitutionalResearchBriefService();

  it("1. Marks News & Macro as INSUFFICIENT_CURRENT_EVIDENCE when all 8 news records are EXPIRED (never CONSTRUCTIVE)", () => {
    const expiredNewsRefs: PreservedEvidenceReference[] = Array.from(
      { length: 8 },
      (_, idx) =>
        makeRef({
          evidenceId: `ev_news_${idx}`,
          agentSource: "news_macro",
          sourceName: "News Feed",
          category: "THIRD_PARTY_NEWS",
          claim: `TCS wins major order win contract #${idx + 1}`,
          value: "positive catalyst",
          freshnessStatus: "EXPIRED",
          granularFreshness: "EXPIRED",
          publicationTimestamp: "2026-01-10T10:00:00.000Z",
          reportingPeriod: null,
        })
    );
    const finRef = makeRef({
      evidenceId: "ev_fin_roe",
      claim: "return_on_equity",
      value: 51.2,
      verificationStatus: "UNVERIFIED",
    });

    const ctx = makeBaseContext([finRef, ...expiredNewsRefs], true);
    const scorecard = scorecardService.buildScorecard(ctx, []);
    const newsPillar = scorecard.pillars.find(
      (p) => p.pillar === "NEWS_AND_MACRO_ENVIRONMENT"
    );

    expect(newsPillar).toBeDefined();
    expect(newsPillar?.assessment).toBe("INSUFFICIENT_CURRENT_EVIDENCE");
    expect(newsPillar?.supportingEvidenceIds).toEqual([]);
    expect(newsPillar?.opposingEvidenceIds).toEqual([]);
    expect(newsPillar?.explanation).toContain("INSUFFICIENT_CURRENT_EVIDENCE");
    // Historical news records remain preserved on the context
    expect(
      ctx.evidenceReferences.filter((r) => r.agentSource === "news_macro")
    ).toHaveLength(8);
  });

  it("2. Handles mixed freshness news by excluding EXPIRED items from current signal", () => {
    const freshNews = makeRef({
      evidenceId: "ev_news_fresh",
      agentSource: "news_macro",
      category: "THIRD_PARTY_NEWS",
      claim: "TCS announces Q2 dividend and contract win",
      value: "positive",
      freshnessStatus: "FRESH",
      granularFreshness: "FRESH",
      publicationTimestamp: "2026-11-15T10:00:00.000Z",
    });
    const expiredNegative = makeRef({
      evidenceId: "ev_news_expired_neg",
      agentSource: "news_macro",
      category: "THIRD_PARTY_NEWS",
      claim: "Historical downgrade headwind",
      value: "negative",
      freshnessStatus: "EXPIRED",
      granularFreshness: "EXPIRED",
      publicationTimestamp: "2025-11-15T10:00:00.000Z",
    });

    const ctx = makeBaseContext([freshNews, expiredNegative], false);
    const scorecard = scorecardService.buildScorecard(ctx, []);
    const newsPillar = scorecard.pillars.find(
      (p) => p.pillar === "NEWS_AND_MACRO_ENVIRONMENT"
    );

    expect(newsPillar?.assessment).toBe("CONSTRUCTIVE");
    expect(newsPillar?.supportingEvidenceIds).toEqual(["ev_news_fresh"]);
    expect(newsPillar?.opposingEvidenceIds).toEqual([]);
  });

  it("3. Preserves UNVERIFIED metric status even from VERIFIED_FINANCIAL_PROVIDER and reflects incomplete synthesis", () => {
    const unverifiedMetrics = [
      makeRef({ evidenceId: "ev_roe", claim: "return_on_equity", value: 51.2, verificationStatus: "UNVERIFIED" }),
      makeRef({ evidenceId: "ev_de", claim: "debt_to_equity", value: 0.08, verificationStatus: "UNVERIFIED" }),
      makeRef({ evidenceId: "ev_rev", claim: "revenue", value: 64000, verificationStatus: "UNVERIFIED" }),
    ];

    const ctx = makeBaseContext(unverifiedMetrics, true);
    const scorecard = scorecardService.buildScorecard(ctx, []);
    const brief = briefService.buildBrief(ctx);

    expect(ctx.evidenceReferences.every((r) => r.verificationStatus === "UNVERIFIED")).toBe(true);
    expect(scorecard.overallStatus).toBe("PARTIAL");
    expect(brief.confidenceClassification).not.toBe("HIGH");
  });

  it("4. Preserves reportingPeriod separately from publishedAt and keeps missing publishedAt as null", () => {
    const collector = new EvidenceCollector();
    const baseSnapshot: ExternalCompanyResearchSnapshot = {
      symbol: "TCS.NS",
      cleanSymbol: "TCS",
      companyName: "Tata Consultancy Services Limited",
      generatedAt: "2026-11-16T04:00:00.000Z",
      liveFromQuoteSummary: true,
      fundamentals: {
        trailingPE: 28.5,
        forwardPE: 26.1,
        priceToBook: 12.4,
        roePct: 51.2,
        roaPct: 30.1,
        rocePct: null,
        debtToEquity: 0.08,
        quarterlyRevenueGrowthPct: 6.5,
        quarterlyEarningsGrowthPct: 8.1,
        operatingMarginPct: 24.5,
        profitMarginPct: 19.2,
        ebitdaMarginPct: 26.8,
        marketCapCr: 1450000,
        revenueCr: 64000,
        netProfitCr: 12300,
        ebitdaCr: 17150,
        totalDebtCr: 8200,
        operatingCashFlowCr: 45000,
        freeCashFlowCr: 41000,
        trailingEps: 132.4,
        promoterPledgePct: null,
        fiftyTwoWeekHigh: 4592,
        fiftyTwoWeekLow: 3591,
        sector: "Technology",
        industry: "IT Services",
        publishedAt: null,
        reportingPeriod: "2026-09-30",
        reportingBasis: null,
      },
      technicals: {
        ltp: 4100,
        changePct: 0.5,
        rsi14: 54,
        sma20: 4050,
        sma50: 3980,
        ema200: 3900,
        aboveSma20: true,
        aboveSma50: true,
        aboveEma200: true,
        trendSummary: "Bullish",
        marketPublishedAt: "2026-11-16T03:55:00.000Z",
      },
      institutionalHoldings: {
        institutionsPercentHeld: 12.5,
        insidersPromoterPercentHeld: 71.7,
        institutionsFloatPercentHeld: 44.1,
        institutionsCount: 420,
        topHolders: [],
        trendLabel: "LOW_OR_UNAVAILABLE",
        publishedAt: null,
      },
      newsHeadlines: [],
      dataSources: ["Yahoo Finance"],
    };

    const missingPubRes = collector.collectFromResearchSnapshot(
      baseSnapshot,
      "2026-11-16T04:00:00.000Z"
    );
    const roeMissingPub = missingPubRes.records.find(
      (r) => r.claim.includes("ROE")
    );
    expect(roeMissingPub?.dataPeriod).toBe("2026-09-30");
    expect(roeMissingPub?.publishedAt).toBeNull();

    // When an explicit source publication timestamp IS provided and differs from reportingPeriod
    const withPubSnapshot: ExternalCompanyResearchSnapshot = {
      ...baseSnapshot,
      fundamentals: {
        ...baseSnapshot.fundamentals,
        publishedAt: "2026-10-15T12:00:00.000Z",
        reportingPeriod: "2026-09-30",
      },
    };
    const withPubRes = collector.collectFromResearchSnapshot(
      withPubSnapshot,
      "2026-11-16T04:00:00.000Z"
    );
    const roeWithPub = withPubRes.records.find(
      (r) => r.claim.includes("ROE")
    );
    expect(roeWithPub?.dataPeriod).toBe("2026-09-30");
    expect(roeWithPub?.publishedAt).toBe("2026-10-15T12:00:00.000Z");
  });
});
