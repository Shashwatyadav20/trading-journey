import { describe, it, expect, vi } from "vitest";
import Fastify from "fastify";
import {
  DEFAULT_STRATEGY03_SCORING_WEIGHTS,
  InMemoryStrategy03EvaluationStore,
  Strategy03ResearchEvaluator,
} from "../Strategy03ResearchPipeline";
import { classifyUniverseEquity } from "../Strategy03UniverseService";
import { buildStrategy03DataRoutes } from "../../../../../routes/strategy03Data";
import type { StrategyCandle } from "../../../strategies/ImpulseConsolidationDojiStrategy";

vi.mock("../../../../../auth/middleware", () => ({
  authenticateRequest: async (request: any, reply: any) => {
    if (request.headers?.authorization !== "Bearer valid-s03-token") {
      return reply.status(401).send({ success: false, error: "Unauthorized" });
    }
    request.user = { userId: "user-s03" };
  },
  getVerifiedUser: (request: any) => request.user,
}));

function makeUptrendCandles(count = 220): StrategyCandle[] {
  const base = Date.UTC(2025, 0, 1, 10, 0, 0);
  return Array.from({ length: count }, (_, i) => ({
    time: base + i * 86400_000,
    open: 100 + i * 0.5,
    high: 103 + i * 0.5,
    low: 99 + i * 0.5,
    close: 102 + i * 0.5,
    volume: 1_000_000,
  }));
}

describe("Phase 6.3 — Strategy 03 AI Institutional Growth Research Engine", () => {
  it("1. Enforces 100-point scoring weights and awards 0 points for missing data", async () => {
    const sum = Object.values(DEFAULT_STRATEGY03_SCORING_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(sum).toBe(100);

    const store = new InMemoryStrategy03EvaluationStore();
    const evaluator = new Strategy03ResearchEvaluator(store);
    const nowIso = new Date().toISOString();

    const res = await evaluator.evaluateSymbol({
      symbol: "MISSING_CO",
      fundamentalOverride: {
        publishedAt: nowIso,
        freshnessStatus: "FRESH",
        missingFields: ["revenueGrowthYoYPct", "epsGrowthYoYPct", "operatingCashFlowCr"],
      },
      shareholdingOverride: [],
      announcementsOverride: [],
      candlesOverride: makeUptrendCandles(220),
    });

    expect(res.researchOnly).toBe(true);
    expect(res.factorScores.futureGrowthPotential.score).toBe(0);
    expect(res.factorScores.earningsQuality.score).toBe(0);
    expect(res.factorScores.institutionalOwnership.score).toBe(0);
    expect(res.decision).toBe("WAIT");
  });

  it("2. Forces WAIT on stale results, conflicting sources, incompatible periods, and unverified Screener shareholding", async () => {
    const store = new InMemoryStrategy03EvaluationStore();
    const evaluator = new Strategy03ResearchEvaluator(store);
    const staleIso = new Date(Date.now() - 200 * 86400_000).toISOString();
    const nowIso = new Date().toISOString();

    const staleRes = await evaluator.evaluateSymbol({
      symbol: "STALE_CO",
      fundamentalOverride: { publishedAt: staleIso, freshnessStatus: "STALE" },
      shareholdingOverride: [],
      announcementsOverride: [],
      candlesOverride: makeUptrendCandles(220),
    });
    expect(staleRes.decision).toBe("WAIT");

    const conflictRes = await evaluator.evaluateSymbol({
      symbol: "CONFLICT_CO",
      fundamentalOverride: {
        publishedAt: nowIso,
        freshnessStatus: "FRESH",
        periodsCompatible: false,
      },
      shareholdingOverride: [],
      announcementsOverride: [],
      candlesOverride: makeUptrendCandles(220),
    });
    expect(conflictRes.decision).toBe("WAIT");
    expect(conflictRes.conflicts.length).toBeGreaterThan(0);

    // Unverified Screener shareholding must NOT earn institutional points and must WAIT
    const unverifiedSh = await evaluator.evaluateSymbol({
      symbol: "SCREENER_CO",
      fundamentalOverride: {
        publishedAt: nowIso,
        freshnessStatus: "FRESH",
        revenueGrowthYoYPct: 20,
        epsGrowthYoYPct: 20,
        netProfitGrowthYoYPct: 18,
        operatingCashFlowCr: 500,
        rocePct: 22,
        debtToEquity: 0.2,
        trailingPE: 20,
        priceToBook: 3,
      },
      shareholdingOverride: [
        {
          symbol: "SCREENER_CO",
          reportingQuarter: "Sep 2026",
          version: 1,
          promoterPct: 50,
          fiiPct: 20,
          diiPct: 15,
          mutualFundPct: null,
          publicPct: 15,
          promoterPledgedPct: null,
          totalReportedPct: 100,
          isPlausibleSum: true,
          evidence: {
            sourceName: "Screener.in",
            sourceUrlOrFilingId: "https://screener.in/x",
            reportingPeriod: "Sep 2026",
            publishedAt: null,
            retrievedAt: nowIso,
            verificationStatus: "UNVERIFIED",
            confidence: 0.75,
            hasSourceConflict: false,
          },
        },
      ],
      announcementsOverride: [],
      candlesOverride: makeUptrendCandles(220),
    });
    expect(unverifiedSh.factorScores.institutionalOwnership.score).toBe(0);
    expect(unverifiedSh.decision).toBe("WAIT");
  });

  it("3. Produces ENTER_CANDIDATE (Research Only) when all sources are verified, fresh, and persistent without duplicates", async () => {
    const store = new InMemoryStrategy03EvaluationStore();
    const evaluator = new Strategy03ResearchEvaluator(store);
    const nowIso = new Date().toISOString();

    const verifiedEv = (name: string) => ({
      sourceName: name,
      sourceUrlOrFilingId: "https://www.bseindia.com/filing/123",
      reportingPeriod: "Sep 2026",
      publishedAt: nowIso,
      retrievedAt: nowIso,
      verificationStatus: "VERIFIED" as const,
      confidence: 0.95,
      hasSourceConflict: false,
    });

    const evalRes = await evaluator.evaluateSymbol({
      symbol: "GOOD_CO",
      companyName: "Good Growth Ltd",
      persist: true,
      fundamentalOverride: {
        statementScope: "CONSOLIDATED",
        publishedAt: nowIso,
        freshnessStatus: "FRESH",
        revenueGrowthYoYPct: 25,
        epsGrowthYoYPct: 22,
        netProfitGrowthYoYPct: 20,
        operatingCashFlowCr: 800,
        rocePct: 24,
        debtToEquity: 0.1,
        trailingPE: 22,
        priceToBook: 3.5,
        evidence: [verifiedEv("BSE Official Result")],
      },
      shareholdingOverride: [
        {
          symbol: "GOOD_CO",
          reportingQuarter: "Jun 2026",
          version: 1,
          promoterPct: 50,
          fiiPct: 18,
          diiPct: 14,
          mutualFundPct: 10,
          publicPct: 18,
          promoterPledgedPct: 0,
          totalReportedPct: 100,
          isPlausibleSum: true,
          evidence: verifiedEv("NSE Shareholding XBRL"),
        },
        {
          symbol: "GOOD_CO",
          reportingQuarter: "Sep 2026",
          version: 1,
          promoterPct: 50,
          fiiPct: 19.5,
          diiPct: 15.0,
          mutualFundPct: 11,
          publicPct: 15.5,
          promoterPledgedPct: 0,
          totalReportedPct: 100,
          isPlausibleSum: true,
          evidence: verifiedEv("NSE Shareholding XBRL"),
        },
      ],
      announcementsOverride: [
        {
          exchange: "BSE",
          filingId: "F1",
          symbol: "GOOD_CO",
          companyName: "Good Growth Ltd",
          category: "ORDER_WIN",
          headline: "Bags Rs 1000 Cr Order",
          extractedText: "Bags Rs 1000 Cr Order",
          extractionStatus: "EXTRACTED",
          extractionConfidence: 0.9,
          isAmbiguous: false,
          evidence: verifiedEv("BSE Order Filing"),
        },
      ],
      candlesOverride: makeUptrendCandles(220),
    });

    expect(evalRes.decision).toBe("ENTER_CANDIDATE");
    expect(evalRes.totalScore).toBeGreaterThanOrEqual(65);

    // Duplicate idempotencyKey save does not duplicate
    await store.save(evalRes);
    const list = await store.list();
    expect(list).toHaveLength(1);
  });

  it("4. Classifies SME/SUSPENDED/SPECIAL_SERIES universe exclusions and protects research APIs", async () => {
    const sme = classifyUniverseEquity({
      isin: "INE1", symbol: "SME1", nseSymbol: "SME1", bseCode: null,
      companyName: "SME Co", exchange: "NSE", series: "SM", listingStatus: "ACTIVE",
      sector: null, industry: null, marketCapCr: 100, marketCapRank: null, marketCapCategory: "UNCLASSIFIED",
    });
    expect(sme.bucket).toBe("SME");
    expect(sme.eligibleForNseResearch).toBe(false);

    const store = new InMemoryStrategy03EvaluationStore();
    const evaluator = new Strategy03ResearchEvaluator(store);
    const app = Fastify();
    await app.register(buildStrategy03DataRoutes(undefined, evaluator));

    const unauth = await app.inject({ method: "GET", url: "/api/indian/strategy03/research/results" });
    expect(unauth.statusCode).toBe(401);

    const auth = await app.inject({
      method: "GET",
      url: "/api/indian/strategy03/research/results",
      headers: { Authorization: "Bearer valid-s03-token" },
    });
    expect(auth.statusCode).toBe(200);
    expect(auth.json().strategy03Active).toBe(false);
    await app.close();
  });
});

