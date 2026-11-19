import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, beforeEach } from "vitest";
import {
  compileCompanyResearchReport,
  computeInstitutionalConviction,
  synthesizeGroundedResearchAnswer,
  clearCompanyResearchCacheForTest,
  getCompanyResearchCacheStatsForTest,
  type CompanyResearchReport,
} from "../../../../lib/ai/companyResearchEngine";
import { yahooRateLimiter } from "../../../../lib/indian/yahooRateLimiter";
import { AIProviderError, OpenAIClientService } from "../core/OpenAIClient";
import { ResearchCache } from "../core/ResearchCache";
import { CompanyResearchAgent } from "../agents/CompanyResearchAgent";
import { AgentRegistry } from "../orchestrator/AgentRegistry";
import { evidenceCollector, ExternalCompanyResearchSnapshot } from "../evidence/EvidenceCollector";
import { freshnessValidator } from "../evidence/FreshnessValidator";
import { UnifiedIntelligenceContextBuilder } from "../context/UnifiedIntelligenceContextBuilder";
import { InstitutionalTerminalService } from "../context/InstitutionalTerminalService";
import { ConversationService } from "../conversation/ConversationService";

const REF_DATE = new Date("2026-11-13T06:00:00.000Z"); // Friday 11:30 IST (market open)

function buildSampleSnapshot(
  symbol: string = "RELIANCE",
  feedStatus: "LIVE DATA" | "PARTIAL LIVE DATA" | "UNAVAILABLE" = "LIVE DATA"
): CompanyResearchReport {
  const fundamentals = {
    trailingPE: 24.5,
    forwardPE: 21.2,
    priceToBook: 2.15,
    roePct: 16.4,
    roaPct: 6.8,
    rocePct: null,
    debtToEquity: 0.42,
    quarterlyRevenueGrowthPct: 12.4,
    quarterlyEarningsGrowthPct: 14.1,
    operatingMarginPct: 16.2,
    profitMarginPct: 9.8,
    ebitdaMarginPct: 18.5,
    marketCapCr: 1750000,
    revenueCr: 901000,
    netProfitCr: 79000,
    ebitdaCr: 166685,
    totalDebtCr: 315000,
    operatingCashFlowCr: 142000,
    freeCashFlowCr: 54000,
    trailingEps: 104.6,
    promoterPledgePct: null,
    fiftyTwoWeekHigh: 1608,
    fiftyTwoWeekLow: 1210,
    sector: "Energy",
    industry: "Oil & Gas Refining & Marketing",
    publishedAt: "2026-09-30T00:00:00.000Z",
    reportingPeriod: "2026-09-30",
    reportingBasis: null,
  };

  const institutionalHoldings = {
    institutionsPercentHeld: 38.4,
    insidersPromoterPercentHeld: 50.3,
    institutionsFloatPercentHeld: 77.2,
    institutionsCount: 1120,
    topHolders: [],
    trendLabel: "HIGH_INSTITUTIONAL" as const,
    publishedAt: "2026-09-30T00:00:00.000Z",
  };

  const technicals = {
    ltp: 1285.5,
    changePct: 1.25,
    vwap: 1278.0,
    priceVsVwapPct: 0.59,
    vwapAlignment: "ABOVE_VWAP" as const,
    ema20: 1272.0,
    ema20Alignment: "BULLISH" as const,
    orderBlock4H: {
      direction: "BULLISH" as const,
      bottomPrice: 1270,
      topPrice: 1286,
      retestActive: true,
      quality: "STRONG" as const,
      proximityPct: 0.4,
    },
    marketPublishedAt: new Date(REF_DATE.getTime() - 30_000).toISOString(),
  };

  const conviction = computeInstitutionalConviction(
    fundamentals,
    institutionalHoldings,
    technicals,
    25,
    false
  );

  return {
    symbol: `${symbol}.NS`,
    cleanSymbol: symbol,
    companyName: `${symbol} Industries Ltd`,
    fetchedAtIST: "11:30:00 IST",
    fundamentals,
    institutionalHoldings,
    technicals,
    newsAndMacro: [
      {
        title: `${symbol} reports strong quarterly operational momentum`,
        publisher: "Economic Times",
        publishedAt: "11:15:00",
        publishedAtIso: new Date(REF_DATE.getTime() - 15 * 60_000).toISOString(),
        link: "https://economictimes.indiatimes.com/markets/stocks/news/reliance-q2",
        category: "EARNINGS_CATALYST",
        sentiment: "BULLISH",
        impactScore: 28,
      },
    ],
    newsSentimentScore: 28,
    sentimentLabel: "BULLISH",
    catalysts: ["Strong Quarterly Revenue Growth"],
    riskWarnings: [],
    macroFlags: {
      hasRbiMention: false,
      hasCpiInflationMention: false,
      hasSebiRegulatoryMention: false,
    },
    conviction,
    dataTelemetry: {
      fundamentalsSource:
        feedStatus === "LIVE DATA"
          ? "YAHOO_QUOTE_SUMMARY_LIVE"
          : "YAHOO_CHART_ONLY_UNAVAILABLE",
      technicalsSource:
        feedStatus === "UNAVAILABLE" ? "UNAVAILABLE" : "YAHOO_4H_VWAP_LIVE",
      newsSource: "GOOGLE_NEWS_RSS_AND_YAHOO_LIVE",
      feedStatus,
      zeroMockIntegrity: true,
    },
  };
}

describe("Phase 9.6.3 — Institutional AI Evidence & Reliability Fix", () => {
  beforeEach(() => {
    clearCompanyResearchCacheForTest();
    yahooRateLimiter.resetForTest();
  });

  it("1. preserves collected evidenceRecords after LLM timeout and marks agent TIMED_OUT with PARTIAL context", async () => {
    const slowAiClient = {
      createResponse: async () => {
        await new Promise((resolve) => setTimeout(resolve, 250));
        throw new AIProviderError({
          message: "Provider timed out",
          code: "PROVIDER_TIMEOUT",
          statusCode: 504,
          retryable: false,
          quotaExhausted: false,
          tier: "balanced",
          model: "gemini-2.5-flash",
        });
      },
    } as unknown as OpenAIClientService;

    const agent = new CompanyResearchAgent({
      aiClient: slowAiClient,
      researchCollector: async (sym) => buildSampleSnapshot(sym, "LIVE DATA"),
    });

    const registry = new AgentRegistry({
      companyResearch: agent,
      useCache: false,
    });

    const exec = await registry.execute("company_research", {
      userId: "user-963-timeout",
      query: "Analyze RELIANCE",
      symbol: "RELIANCE",
      tier: "balanced",
      timeoutMs: 60, // Triggers outer AgentTimeoutError while evidence is already collected
    });

    expect(exec.status).toBe("TIMED_OUT");
    expect(exec.errorCategory).toBe("TIMEOUT");
    expect(exec.dataCollectionStatus).toBe("COLLECTED");
    expect(exec.llmStatus).toBe("TIMED_OUT");
    expect(Array.isArray(exec.evidenceRecords)).toBe(true);
    expect(exec.evidenceRecords!.length).toBeGreaterThan(5);
    expect(exec.evidenceIds.length).toBeGreaterThan(5);

    // Verify UnifiedIntelligenceContextBuilder ingests the preserved evidence while keeping agent in failedAgents
    const builder = new UnifiedIntelligenceContextBuilder({ registry });
    const ctx = builder.buildFromExecutions({
      userId: "user-963-timeout",
      symbol: "RELIANCE",
      referenceDate: REF_DATE,
      executions: [exec],
    });

    expect(ctx.evidenceReferences.length).toBeGreaterThan(5);
    expect(ctx.qualityAssessment.availableEvidenceCount).toBeGreaterThan(5);
    expect(ctx.qualityAssessment.failedAgents).toContain("company_research");
    expect(ctx.qualityAssessment.completedAgents).not.toContain("company_research");
    expect(ctx.contextStatus).toBe("PARTIAL");
    expect(ctx.agentExecutions[0].executionStatus).toBe("TIMEOUT");
    expect(ctx.agentExecutions[0].generationMode).toBe("DETERMINISTIC");
  });

  it("2. preserves collected evidenceRecords after provider HTTP 429 and never classifies LLM failure as SUCCEEDED", async () => {
    const rateLimitedAiClient = {
      createResponse: async () => {
        throw new AIProviderError({
          message: "429 Too Many Requests from Gemini/Groq",
          code: "RATE_LIMITED",
          statusCode: 429,
          retryable: false,
          quotaExhausted: true,
          tier: "balanced",
          model: "gemini-2.5-flash",
        });
      },
    } as unknown as OpenAIClientService;

    const agent = new CompanyResearchAgent({
      aiClient: rateLimitedAiClient,
      researchCollector: async (sym) => buildSampleSnapshot(sym, "LIVE DATA"),
    });

    const cache = new ResearchCache();
    const registry = new AgentRegistry({
      companyResearch: agent,
      cache,
      useCache: true,
    });

    const exec = await registry.execute("company_research", {
      userId: "user-963-429",
      query: "Analyze RELIANCE",
      symbol: "RELIANCE",
      tier: "balanced",
      timeoutMs: 5000,
    });

    expect(exec.status).toBe("FAILED");
    expect(exec.status).not.toBe("SUCCEEDED");
    expect(exec.errorCategory).toBe("RATE_LIMITED");
    expect(exec.dataCollectionStatus).toBe("COLLECTED");
    expect(exec.llmStatus).toBe("FAILED");
    expect(exec.evidenceRecords).toBeDefined();
    expect(exec.evidenceRecords!.some((r) => r.claim === "Total Revenue" && r.value === 901000)).toBe(true);

    // Failed LLM runs must not be cached as successful agent responses
    const cachedHit = cache.get({
      agentId: "company_research",
      symbol: "RELIANCE",
      tier: "balanced",
      query: "Analyze RELIANCE",
    });
    expect(cachedHit).toBeNull();
  });

  it("3. deduplicates concurrent duplicate research requests and deep-clones returned snapshots", async () => {
    let underlyingFetchCalls = 0;
    const customFetcher = async (sym: string): Promise<CompanyResearchReport> => {
      underlyingFetchCalls += 1;
      await new Promise((resolve) => setTimeout(resolve, 40));
      return buildSampleSnapshot(sym, "LIVE DATA");
    };

    const [rep1, rep2, rep3] = await Promise.all([
      compileCompanyResearchReport("RELIANCE", { fetcherOverrideForTest: customFetcher }),
      compileCompanyResearchReport("NSE:reliance.ns", { fetcherOverrideForTest: customFetcher }),
      compileCompanyResearchReport("RELIANCE", { fetcherOverrideForTest: customFetcher }),
    ]);

    expect(underlyingFetchCalls).toBe(1);
    expect(getCompanyResearchCacheStatsForTest().cacheSize).toBe(1);

    // Mutating one caller's snapshot must never corrupt another caller's snapshot or the cache
    rep1.fundamentals.revenueCr = 999999999;
    expect(rep2.fundamentals.revenueCr).toBe(901000);
    expect(rep3.fundamentals.revenueCr).toBe(901000);

    const cachedRep = await compileCompanyResearchReport("RELIANCE", {
      fetcherOverrideForTest: customFetcher,
    });
    expect(underlyingFetchCalls).toBe(1);
    expect(cachedRep.fundamentals.revenueCr).toBe(901000);
  });

  it("4. expires bounded cache after TTL, refuses to cache incomplete/failed results, and bounds Yahoo 429 cooldown wait", async () => {
    let calls = 0;

    // 4a. Partial/failed result is NOT cached
    await compileCompanyResearchReport("TCS", {
      ttlMs: 10_000,
      fetcherOverrideForTest: async (sym) => {
        calls += 1;
        return buildSampleSnapshot(sym, "PARTIAL LIVE DATA");
      },
    });
    expect(getCompanyResearchCacheStatsForTest().cacheSize).toBe(0);

    await compileCompanyResearchReport("TCS", {
      ttlMs: 10_000,
      fetcherOverrideForTest: async (sym) => {
        calls += 1;
        return buildSampleSnapshot(sym, "LIVE DATA");
      },
    });
    expect(calls).toBe(2);
    expect(getCompanyResearchCacheStatsForTest().cacheSize).toBe(1);

    // 4b. Cache expiry after short TTL
    clearCompanyResearchCacheForTest();
    let expiryCalls = 0;
    await compileCompanyResearchReport("INFY", {
      ttlMs: 25,
      fetcherOverrideForTest: async (sym) => {
        expiryCalls += 1;
        return buildSampleSnapshot(sym, "LIVE DATA");
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 40));
    await compileCompanyResearchReport("INFY", {
      ttlMs: 25,
      fetcherOverrideForTest: async (sym) => {
        expiryCalls += 1;
        return buildSampleSnapshot(sym, "LIVE DATA");
      },
    });
    expect(expiryCalls).toBe(2);

    // 4c. Yahoo 429 cooldown (30s) fails fast when maxWaitMs is 50ms
    yahooRateLimiter.recordRateLimit();
    expect(yahooRateLimiter.isCoolingDown()).toBe(true);
    const startMs = Date.now();
    const canProceed = await yahooRateLimiter.waitIfCoolingDown(50);
    const elapsedMs = Date.now() - startMs;
    expect(canProceed).toBe(false);
    expect(elapsedMs).toBeLessThan(200);
  });

  it("5. keeps missing publishedAt as null (UNKNOWN / EXPIRED) and never substitutes retrievedAt for publishedAt", () => {
    const snapWithoutTimestamps: ExternalCompanyResearchSnapshot = {
      symbol: "RELIANCE.NS",
      cleanSymbol: "RELIANCE",
      companyName: "Reliance Industries Ltd",
      fundamentals: {
        trailingPE: 24.5,
        forwardPE: 21.2,
        priceToBook: 2.1,
        roePct: 15.8,
        debtToEquity: 0.4,
        quarterlyRevenueGrowthPct: 11.2,
        quarterlyEarningsGrowthPct: 13.0,
        operatingMarginPct: 15.5,
        marketCapCr: 1750000,
        publishedAt: null,
        reportingPeriod: null,
        reportingBasis: null,
      },
      institutionalHoldings: {
        institutionsPercentHeld: 38.0,
        insidersPromoterPercentHeld: 50.3,
        institutionsCount: 1100,
        publishedAt: null,
      },
      technicals: {
        ltp: 1285,
        changePct: 1.1,
        vwap: 1278,
        ema20: 1270,
        marketPublishedAt: null,
      },
      newsAndMacro: [
        {
          title: "Reliance expands new energy gigafactory complex",
          publisher: "Mint",
          publishedAt: "UNKNOWN",
          publishedAtIso: null,
          category: "COMPANY_NEWS",
          sentiment: "BULLISH",
        },
      ],
    };

    const retrievedAt = REF_DATE.toISOString();
    const collected = evidenceCollector.collectFromResearchSnapshot(
      snapWithoutTimestamps,
      retrievedAt
    );

    for (const rec of collected.records) {
      expect(rec.retrievedAt).toBe(retrievedAt);
      expect(rec.publishedAt).toBeNull();

      const granular = freshnessValidator.evaluateGranularFreshness(rec, REF_DATE);
      expect(granular.freshness).toBe("UNKNOWN");

      const base = freshnessValidator.evaluateFreshness(rec, REF_DATE);
      expect(base.freshness).toBe("EXPIRED");
    }
  });

  it("6. preserves null for unavailable financial period, reportingBasis, ROCE, and promoter pledge while extracting genuine financial fields", () => {
    const sample = buildSampleSnapshot("RELIANCE", "LIVE DATA");
    const collected = evidenceCollector.collectFromResearchSnapshot(
      sample,
      REF_DATE.toISOString()
    );

    const byClaim = new Map(collected.records.map((r) => [r.claim, r]));

    expect(byClaim.get("Total Revenue")?.value).toBe(901000);
    expect(byClaim.get("Net Profit")?.value).toBe(79000);
    expect(byClaim.get("EBITDA")?.value).toBe(166685);
    expect(byClaim.get("EBITDA Margin")?.value).toBe(18.5);
    expect(byClaim.get("Total Debt")?.value).toBe(315000);
    expect(byClaim.get("Operating Cash Flow")?.value).toBe(142000);
    expect(byClaim.get("Free Cash Flow")?.value).toBe(54000);
    expect(byClaim.get("Trailing EPS")?.value).toBe(104.6);
    expect(byClaim.get("Return on Equity (ROE)")?.value).toBe(16.4);
    expect(byClaim.get("Promoter and Insider Percent Held")?.value).toBe(50.3);

    // Unavailable fields must remain strictly null
    expect(byClaim.get("Return on Capital Employed (ROCE)")?.value).toBeNull();
    expect(byClaim.get("Promoter Pledge Percent")?.value).toBeNull();

    // Genuine reporting period is preserved; unavailable reportingBasis remains null
    expect(byClaim.get("Total Revenue")?.dataPeriod).toBe("2026-09-30");
    expect(byClaim.get("Total Revenue")?.metadata?.basis).toBeNull();
  });

  it("7. removes legacy 79% HIGH CONVICTION BUY presentation and uses qualitative research conclusions", () => {
    const sample = buildSampleSnapshot("RELIANCE", "LIVE DATA");
    expect(sample.conviction.grade).not.toBe("HIGH_CONVICTION_BUY");
    expect(sample.conviction.conclusion).toBe("POSITIVE");
    expect(sample.conviction.confidenceClassification).toBe("HIGH");

    const groundedText = synthesizeGroundedResearchAnswer(
      sample,
      "Summarize institutional research"
    );
    expect(groundedText).not.toContain("HIGH CONVICTION BUY");
    expect(groundedText).not.toContain("Unified Conviction Score");
    expect(groundedText.split("\n")[1]).not.toMatch(/\d+%/); // No misleading buy percentage in conclusion line
    expect(groundedText).toContain("Research Conclusion: POSITIVE");

    const uiPath = path.resolve(
      __dirname,
      "../../../../components/ai/AIResearchCommandCenter.tsx"
    );
    const uiSource = fs.readFileSync(uiPath, "utf8");
    expect(uiSource).not.toContain("Conviction (Calculated Heuristic)");
    expect(uiSource).not.toContain("HIGH_CONVICTION_BUY");
    expect(uiSource).toContain("Research Conclusion");
    expect(uiSource).toContain("INSUFFICIENT_EVIDENCE");
  });

  it("8. keeps Phase 9.3 scorecard and Phase 9.4 research brief conclusions deterministic", () => {
    const sample = buildSampleSnapshot("RELIANCE", "LIVE DATA");
    const collected = evidenceCollector.collectFromResearchSnapshot(
      sample,
      REF_DATE.toISOString()
    );
    const verifiedRecords = freshnessValidator.validateAll(
      collected.records.map((r) => ({
        ...r,
        sourceTier: "INSTITUTIONAL_DATA_FEED" as const,
        sourceClassification: "VERIFIED_FINANCIAL_PROVIDER" as const,
        verificationStatus: "VERIFIED" as const,
      })),
      REF_DATE
    ).records;

    const builder = new UnifiedIntelligenceContextBuilder();
    const execInput = {
      userId: "user-963-det",
      symbol: "RELIANCE",
      referenceDate: REF_DATE,
      executions: [
        {
          agentId: "company_research" as const,
          status: "TIMED_OUT" as const,
          errorCategory: "TIMEOUT" as const,
          dataCollectionStatus: "COLLECTED" as const,
          llmStatus: "TIMED_OUT" as const,
          latencyMs: 5000,
          error: "LLM timed out",
          generatedAt: REF_DATE.toISOString(),
          evidenceIds: verifiedRecords.filter((r) => r.value !== null).map((r) => r.evidenceId),
          evidenceRecords: verifiedRecords,
          missingInformation: [],
          conflictsCount: 0,
          summaryPayload: null,
        },
      ],
    };

    const ctx1 = builder.buildFromExecutions(execInput);
    const ctx2 = builder.buildFromExecutions(execInput);

    expect(ctx1.researchScorecard?.overallConclusion).toBe(
      ctx2.researchScorecard?.overallConclusion
    );
    expect(ctx1.researchBrief?.finalConclusion).toBe(
      ctx2.researchBrief?.finalConclusion
    );
    expect(ctx1.researchBrief?.confidenceClassification).toBe(
      ctx2.researchBrief?.confidenceClassification
    );
    expect(ctx1.researchBrief?.supportingEvidenceIds).toEqual(
      ctx2.researchBrief?.supportingEvidenceIds
    );
  });

  it("9. enforces strict authentication and user isolation across context and terminal history", async () => {
    const builder = new UnifiedIntelligenceContextBuilder();
    expect(() =>
      builder.buildFromExecutions({
        userId: "",
        symbol: "RELIANCE",
        executions: [],
      })
    ).toThrow(/Authenticated userId is required/i);

    const convService = new ConversationService({ forceInMemory: true });
    const ctxAlpha = builder.buildFromExecutions({
      userId: "user-alpha",
      symbol: "RELIANCE",
      referenceDate: REF_DATE,
      executions: [],
    });
    const ctxBeta = builder.buildFromExecutions({
      userId: "user-beta",
      symbol: "TCS",
      referenceDate: REF_DATE,
      executions: [],
    });

    convService.recordUnifiedContext("user-alpha", ctxAlpha);
    convService.recordUnifiedContext("user-beta", ctxBeta);

    const terminalService = new InstitutionalTerminalService({
      conversations: convService,
      contextBuilder: builder,
    });

    const alphaHistory = await terminalService.getResearchHistory("user-alpha");
    const betaHistory = await terminalService.getResearchHistory("user-beta");

    expect(alphaHistory.entries.length).toBe(1);
    expect(alphaHistory.entries.every((h) => h.symbol === "RELIANCE")).toBe(true);
    expect(betaHistory.entries.length).toBe(1);
    expect(betaHistory.entries.every((h) => h.symbol === "TCS")).toBe(true);
  });
});
