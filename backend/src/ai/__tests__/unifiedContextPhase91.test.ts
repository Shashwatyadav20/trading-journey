import { describe, expect, it, vi } from "vitest";
import Fastify from "fastify";
import { EvidenceRecord } from "../evidence/EvidenceSchema";
import { AgentExecutionResult, AgentRegistry } from "../orchestrator/AgentRegistry";
import { ResearchCache } from "../core/ResearchCache";
import { UnifiedContextValidationError } from "../context/UnifiedContextSchema";
import { UnifiedIntelligenceContextBuilder } from "../context/UnifiedIntelligenceContextBuilder";
import { AIOrchestrator } from "../orchestrator/AIOrchestrator";
import { ResponseSynthesizer } from "../orchestrator/ResponseSynthesizer";
import { ConversationService } from "../conversation/ConversationService";
import aiRoutes from "../../routes/ai";

vi.mock("../../auth/middleware", () => {
  async function authenticateRequest(request: any, reply: any): Promise<void> {
    const auth: string | undefined = request.headers["authorization"];
    if (auth === "Bearer token-user-jwt-1") {
      request.verifiedUser = { userId: "user-jwt-1" };
      return;
    }
    reply.status(401).send({ error: "Unauthorized" });
  }

  function getVerifiedUser(request: any) {
    if (!request.verifiedUser) throw new Error("Missing verifiedUser");
    return request.verifiedUser;
  }

  return { authenticateRequest, getVerifiedUser };
});

function makeRecord(overrides: Partial<EvidenceRecord> = {}): EvidenceRecord {
  const nowIso = "2026-11-13T10:00:00.000Z";
  return {
    evidenceId: "ev-1",
    symbol: "RELIANCE",
    category: "INTRADAY_PRICE",
    claim: "RELIANCE Last Traded Price",
    value: 1339.7,
    unit: "INR",
    currency: "INR",
    source: "Yahoo Finance NSE Feed",
    sourceTier: "INSTITUTIONAL_DATA_FEED",
    sourceClassification: "VERIFIED_FINANCIAL_PROVIDER",
    dataPeriod: "2026-11-13",
    sourceUrl: "https://finance.yahoo.com/quote/RELIANCE.NS",
    publishedAt: nowIso,
    retrievedAt: nowIso,
    freshness: "FRESH",
    verificationStatus: "VERIFIED",
    verificationMethod: "MULTI_SOURCE_CORROBORATION",
    confidence: 0.9,
    supportingEvidenceIds: [],
    conflictingEvidenceIds: [],
    untrustedExternal: false,
    ...overrides,
  };
}

function makeExec(overrides: Partial<AgentExecutionResult> = {}): AgentExecutionResult {
  return {
    agentId: "company_research",
    status: "SUCCEEDED",
    errorCategory: "SUCCESS",
    latencyMs: 120,
    startTimestamp: "2026-11-13T09:59:59.880Z",
    completionTimestamp: "2026-11-13T10:00:00.000Z",
    providerUsed: "gemini",
    error: null,
    generatedAt: "2026-11-13T10:00:00.000Z",
    cached: false,
    cacheTimestamp: null,
    freshnessLabel: "FRESH",
    evidenceIds: ["ev-1"],
    evidenceRecords: [makeRecord()],
    missingInformation: [],
    conflictsCount: 0,
    summaryPayload: null,
    ...overrides,
  };
}

describe("Phase 9.1 — Unified Intelligence Context", () => {
  it("1. creates strongly typed unified context with explicit timestamps and provenance", () => {
    const builder = new UnifiedIntelligenceContextBuilder();
    const refDate = new Date("2026-11-13T10:00:30.000Z");

    const ctx = builder.buildFromExecutions({
      userId: "user-1",
      symbol: "RELIANCE.NS",
      rawSymbol: "RELIANCE.NS",
      companyName: "Reliance Industries Limited",
      referenceDate: refDate,
      executions: [makeExec()],
    });

    expect(ctx.contextId).toBeTruthy();
    expect(ctx.userId).toBe("user-1");
    expect(ctx.symbol).toBe("RELIANCE");
    expect(ctx.companyName).toBe("Reliance Industries Limited");
    expect(ctx.exchange).toBe("NSE");
    expect(ctx.createdAt).toBe(refDate.toISOString());
    expect(ctx.requestedAt).toBe(refDate.toISOString());
    expect(ctx.marketTimestamp).toBe("2026-11-13T10:00:00.000Z");
    expect(ctx.contextStatus).toBe("COMPLETE");
    expect(ctx.sourceProvenance).toHaveLength(1);
    expect(ctx.sourceProvenance[0].sourceName).toBe("Yahoo Finance NSE Feed");
  });

  it("2. preserves all required evidence fields without mutating original EvidenceRecord", () => {
    const builder = new UnifiedIntelligenceContextBuilder();
    const original = makeRecord({
      evidenceId: "ev-preserve-1",
      sourceUrl: null,
      publishedAt: null,
      verificationStatus: "UNVERIFIED",
      dataPeriod: "Q2 FY26",
      untrustedExternal: true,
    });
    const snapshotBefore = JSON.stringify(original);

    const ctx = builder.buildFromExecutions({
      userId: "user-1",
      symbol: "RELIANCE",
      referenceDate: new Date("2026-11-13T10:00:30.000Z"),
      executions: [
        makeExec({
          agentId: "news_macro",
          providerUsed: "groq",
          evidenceIds: ["ev-preserve-1"],
          evidenceRecords: [original],
        }),
      ],
    });

    expect(JSON.stringify(original)).toBe(snapshotBefore);
    expect(ctx.evidenceReferences).toHaveLength(1);
    const preserved = ctx.evidenceReferences[0];
    expect(preserved.evidenceId).toBe("ev-preserve-1");
    expect(preserved.agentSource).toBe("news_macro");
    expect(preserved.provider).toBe("groq");
    expect(preserved.sourceName).toBe("Yahoo Finance NSE Feed");
    expect(preserved.sourceUrl).toBeNull();
    expect(preserved.publicationTimestamp).toBeNull();
    expect(preserved.retrievalTimestamp).toBe("2026-11-13T10:00:00.000Z");
    expect(preserved.reportingPeriod).toBe("Q2 FY26");
    expect(preserved.verificationStatus).toBe("UNVERIFIED");
    expect(preserved.confidenceLimitations.length).toBeGreaterThanOrEqual(3);
  });

  it("3. deduplicates identical evidence by ID and normalized content across agents", () => {
    const builder = new UnifiedIntelligenceContextBuilder();
    const recA = makeRecord({ evidenceId: "ev-dup-1", value: 1339.7 });
    const recB = makeRecord({ evidenceId: "ev-dup-2", value: 1339.7 }); // same content, different ID

    const ctx = builder.buildFromExecutions({
      userId: "user-1",
      symbol: "RELIANCE",
      referenceDate: new Date("2026-11-13T10:00:30.000Z"),
      executions: [
        makeExec({ agentId: "company_research", evidenceRecords: [recA] }),
        makeExec({ agentId: "market_intelligence", evidenceRecords: [recA, recB] }),
      ],
    });

    expect(ctx.evidenceReferences).toHaveLength(1);
    expect(ctx.evidenceReferences[0].evidenceId).toBe("ev-dup-1");
  });

  it("4. preserves conflicting evidence across agents and flags context as PARTIAL", () => {
    const builder = new UnifiedIntelligenceContextBuilder();
    const rec1 = makeRecord({
      evidenceId: "ev-price-1",
      source: "Yahoo Finance",
      value: 1339.7,
    });
    const rec2 = makeRecord({
      evidenceId: "ev-price-2",
      source: "NSE Live Feed",
      value: 1365.0,
    });

    const ctx = builder.buildFromExecutions({
      userId: "user-1",
      symbol: "RELIANCE",
      referenceDate: new Date("2026-11-13T10:00:30.000Z"),
      executions: [
        makeExec({ agentId: "company_research", evidenceRecords: [rec1] }),
        makeExec({ agentId: "market_intelligence", evidenceRecords: [rec2] }),
      ],
    });

    expect(ctx.evidenceReferences).toHaveLength(2);
    expect(ctx.conflicts.length).toBeGreaterThanOrEqual(1);
    expect(ctx.qualityAssessment.conflictedEvidenceCount).toBe(2);
    expect(ctx.contextStatus).toBe("PARTIAL");
  });

  it("5. flags mixed freshness explicitly and never upgrades stale/expired data to fresh", () => {
    const builder = new UnifiedIntelligenceContextBuilder();
    const refDate = new Date("2026-11-13T10:00:30.000Z");
    const freshRec = makeRecord({
      evidenceId: "ev-fresh",
      publishedAt: "2026-11-13T10:00:00.000Z",
      retrievedAt: "2026-11-13T10:00:00.000Z",
    });
    const staleRec = makeRecord({
      evidenceId: "ev-stale",
      claim: "RELIANCE Previous Price",
      value: 1320,
      publishedAt: "2026-11-13T09:50:00.000Z", // > 2 min intraday fresh threshold
      retrievedAt: "2026-11-13T09:50:00.000Z",
      freshness: "STALE",
    });

    const ctx = builder.buildFromExecutions({
      userId: "user-1",
      symbol: "RELIANCE",
      referenceDate: refDate,
      executions: [
        makeExec({ evidenceRecords: [freshRec, staleRec] }),
      ],
    });

    expect(ctx.freshnessSummary.hasMixedFreshness).toBe(true);
    expect(ctx.freshnessSummary.explicitWarning).toContain("Mixed freshness");
    expect(ctx.freshnessSummary.staleCount).toBeGreaterThanOrEqual(1);
    expect(ctx.contextStatus).toBe("PARTIAL");
  });

  it("6. preserves missing data and classifies INSUFFICIENT_DATA when no evidence is available", () => {
    const builder = new UnifiedIntelligenceContextBuilder();
    const ctx = builder.buildFromExecutions({
      userId: "user-1",
      symbol: "FORCEMOT",
      referenceDate: new Date("2026-11-13T10:00:30.000Z"),
      executions: [
        makeExec({
          status: "FAILED",
          errorCategory: "NO_DATA",
          providerUsed: null,
          evidenceIds: [],
          evidenceRecords: [],
          missingInformation: ["Debt / Equity unavailable from upstream feed."],
        }),
      ],
    });

    expect(ctx.qualityAssessment.availableEvidenceCount).toBe(0);
    expect(ctx.qualityAssessment.missingDataCount).toBe(1);
    expect(ctx.qualityAssessment.qualityClassification).toBe("INSUFFICIENT_DATA");
    expect(ctx.contextStatus).toBe("INSUFFICIENT_DATA");
  });

  it("7. rejects incompatible reporting periods when requestedPeriod is specified", () => {
    const builder = new UnifiedIntelligenceContextBuilder();
    const q2Rec = makeRecord({
      evidenceId: "ev-q2",
      category: "QUARTERLY_FINANCIALS",
      claim: "Quarterly Revenue",
      value: 250000,
      dataPeriod: "Q2 FY26",
      publishedAt: "2026-11-01T10:00:00.000Z",
      retrievedAt: "2026-11-13T10:00:00.000Z",
    });
    const q1Rec = makeRecord({
      evidenceId: "ev-q1",
      category: "QUARTERLY_FINANCIALS",
      claim: "Quarterly Revenue",
      value: 230000,
      dataPeriod: "Q1 FY26",
      publishedAt: "2026-08-01T10:00:00.000Z",
      retrievedAt: "2026-11-13T10:00:00.000Z",
    });

    const ctx = builder.buildFromExecutions({
      userId: "user-1",
      symbol: "RELIANCE",
      requestedPeriod: "Q2 FY26",
      referenceDate: new Date("2026-11-13T10:00:30.000Z"),
      executions: [
        makeExec({ evidenceRecords: [q2Rec, q1Rec] }),
      ],
    });

    expect(ctx.evidenceReferences).toHaveLength(1);
    expect(ctx.evidenceReferences[0].evidenceId).toBe("ev-q2");
    expect(ctx.researchPeriod.incompatiblePeriodsRejected).toHaveLength(1);
    expect(ctx.researchPeriod.incompatiblePeriodsRejected[0].evidenceId).toBe("ev-q1");
    expect(ctx.contextStatus).toBe("PARTIAL");
  });

  it("8. records agent execution metadata and never labels deterministic results as LIVE_AI", () => {
    const builder = new UnifiedIntelligenceContextBuilder();
    const ctx = builder.buildFromExecutions({
      userId: "user-1",
      symbol: "RELIANCE",
      referenceDate: new Date("2026-11-13T10:00:30.000Z"),
      executions: [
        makeExec({
          agentId: "company_research",
          providerUsed: "deterministic",
          cached: false,
        }),
        makeExec({
          agentId: "market_intelligence",
          providerUsed: "groq", // e.g. fallback after Gemini 429
          cached: false,
        }),
        makeExec({
          agentId: "news_macro",
          status: "FAILED",
          errorCategory: "RATE_LIMITED",
          providerUsed: null,
          evidenceIds: [],
          evidenceRecords: [],
        }),
      ],
      skippedAgents: ["institutional_intelligence"],
    });

    const companyExec = ctx.agentExecutions.find((a) => a.agentName === "company_research");
    const marketExec = ctx.agentExecutions.find((a) => a.agentName === "market_intelligence");
    const newsExec = ctx.agentExecutions.find((a) => a.agentName === "news_macro");
    const skippedExec = ctx.agentExecutions.find(
      (a) => a.agentName === "institutional_intelligence"
    );

    expect(companyExec?.generationMode).toBe("DETERMINISTIC");
    expect(marketExec?.generationMode).toBe("LIVE_AI");
    expect(marketExec?.providerUsed).toBe("groq");
    expect(newsExec?.executionStatus).toBe("RATE_LIMITED");
    expect(skippedExec?.executionStatus).toBe("SKIPPED");
  });

  it("9. reuses ResearchCache for public agents while enforcing cross-user isolation for portfolio agents", async () => {
    const cache = new ResearchCache();
    let companyCalls = 0;
    let portfolioCalls = 0;

    const registry = new AgentRegistry({
      cache,
      useCache: true,
      companyResearch: {
        research: async () => {
          companyCalls += 1;
          return {
            symbol: "RELIANCE",
            question: null,
            verificationStatus: "LLM_RESEARCH_UNVERIFIED",
            readOnly: true,
            model: "gemini-3.8-flash",
            provider: "gemini",
            tier: "balanced",
            generatedAt: "2026-11-13T10:00:00.000Z",
            evidenceRecords: [makeRecord()],
            report: {},
            unsupportedClaims: [],
            invalidEvidenceIdsCited: [],
            rawResponseInvalid: false,
            evidenceSummary: {
              totalRecords: 1,
              verifiedCount: 1,
              unverifiedCount: 0,
              staleCount: 0,
              expiredCount: 0,
              conflictedCount: 0,
              conflicts: [],
              missingInformation: [],
              evidenceIdsUsed: ["ev-1"],
            },
          } as any;
        },
      } as any,
      portfolioIntelligence: {
        analyze: async (userId: string) => {
          portfolioCalls += 1;
          return {
            userId,
            focus: null,
            verificationStatus: "LLM_PORTFOLIO_INTELLIGENCE_UNVERIFIED",
            readOnly: true,
            model: "gemini-3.8-flash",
            provider: "gemini",
            tier: "balanced",
            generatedAt: "2026-11-13T10:00:00.000Z",
            evidenceRecords: [
              makeRecord({
                evidenceId: `ev-port-${userId}`,
                claim: `Portfolio Exposure for ${userId}`,
                value: userId === "user-a" ? 100000 : 250000,
              }),
            ],
            report: {},
            unsupportedClaims: [],
            invalidEvidenceIdsCited: [],
            rawResponseInvalid: false,
            evidenceSummary: {
              totalRecords: 1,
              verifiedCount: 1,
              unverifiedCount: 0,
              staleCount: 0,
              expiredCount: 0,
              conflictedCount: 0,
              conflicts: [],
              missingInformation: [],
              evidenceIdsUsed: [`ev-port-${userId}`],
            },
          } as any;
        },
      } as any,
    });

    const builder = new UnifiedIntelligenceContextBuilder({ registry });

    const ctxA = await builder.buildForSymbol("user-a", {
      symbol: "RELIANCE",
      agents: ["company_research", "portfolio_intelligence"],
      query: "Unified test",
    });
    const ctxB = await builder.buildForSymbol("user-b", {
      symbol: "RELIANCE",
      agents: ["company_research", "portfolio_intelligence"],
      query: "Unified test",
    });

    expect(companyCalls).toBe(1); // public agent reused from cache
    expect(portfolioCalls).toBe(2); // user-scoped portfolio NEVER shared across users
    expect(ctxA.userId).toBe("user-a");
    expect(ctxB.userId).toBe("user-b");
    expect(
      ctxB.agentExecutions.find((a) => a.agentName === "company_research")?.cacheHit
    ).toBe(true);
    expect(
      ctxB.agentExecutions.find((a) => a.agentName === "company_research")?.generationMode
    ).toBe("CACHED");
    expect(
      ctxB.evidenceReferences.some((e) => e.evidenceId === "ev-port-user-a")
    ).toBe(false);
    expect(
      ctxB.evidenceReferences.some((e) => e.evidenceId === "ev-port-user-b")
    ).toBe(true);
  });

  it("10. enforces JWT authentication and validation on POST /api/ai/context", async () => {
    const app = Fastify();
    const builder = new UnifiedIntelligenceContextBuilder();
    await app.register(aiRoutes, { contextBuilder: builder });

    // Unauthenticated -> 401
    const unauthRes = await app.inject({
      method: "POST",
      url: "/api/ai/context",
      payload: { symbol: "RELIANCE" },
    });
    expect(unauthRes.statusCode).toBe(401);

    // Invalid symbol -> 400
    const badReq = await app.inject({
      method: "POST",
      url: "/api/ai/context",
      headers: { authorization: "Bearer token-user-jwt-1" },
      payload: { symbol: "" },
    });
    expect(badReq.statusCode).toBe(400);

    // Missing userId in direct builder -> UnifiedContextValidationError
    expect(() =>
      builder.validateRequest("", { symbol: "RELIANCE" })
    ).toThrow(UnifiedContextValidationError);

    await app.close();
  });

  it("11. Phase 9.1.1 — Evidence correctness: currencies, units, consolidated vs standalone, reporting periods, and missing timestamps", () => {
    const builder = new UnifiedIntelligenceContextBuilder();
    const refDate = new Date("2026-11-13T10:00:30.000Z");

    // A) Same face value (100) but different units (CR vs LAKH) + different currencies (INR vs USD)
    const unitCr = makeRecord({
      evidenceId: "ev-unit-cr",
      claim: "Quarterly Net Profit",
      value: 100,
      unit: "CR",
      currency: "INR",
      source: "NSE Filing",
      category: "QUARTERLY_FINANCIALS",
    });
    const unitLakh = makeRecord({
      evidenceId: "ev-unit-lakh",
      claim: "Quarterly Net Profit",
      value: 100,
      unit: "LAKH",
      currency: "INR",
      source: "NSE Filing",
      category: "QUARTERLY_FINANCIALS",
    });

    // B) Consolidated vs Standalone in claim text
    const consolClaim = makeRecord({
      evidenceId: "ev-consol-claim",
      claim: "Operating Revenue (Consolidated)",
      value: 240000,
      unit: "CR",
      currency: "INR",
      source: "NSE_OFFICIAL",
      sourceTier: "OFFICIAL_EXCHANGE_OR_FILING",
      category: "QUARTERLY_FINANCIALS",
      dataPeriod: "Q2 FY26",
    });
    const standClaim = makeRecord({
      evidenceId: "ev-stand-claim",
      claim: "Operating Revenue (Standalone)",
      value: 145000,
      unit: "CR",
      currency: "INR",
      source: "BSE_OFFICIAL",
      sourceTier: "OFFICIAL_EXCHANGE_OR_FILING",
      category: "QUARTERLY_FINANCIALS",
      dataPeriod: "Q2 FY26",
    });

    // C) Different reporting periods without requestedPeriod (must conflict and never merge)
    const periodQ1 = makeRecord({
      evidenceId: "ev-ebitda-q1",
      claim: "Quarterly EBITDA",
      value: 41000,
      unit: "CR",
      currency: "INR",
      source: "NSE_OFFICIAL",
      sourceTier: "OFFICIAL_EXCHANGE_OR_FILING",
      category: "QUARTERLY_FINANCIALS",
      dataPeriod: "Q1 FY26",
    });
    const periodQ2 = makeRecord({
      evidenceId: "ev-ebitda-q2",
      claim: "Quarterly EBITDA",
      value: 44500,
      unit: "CR",
      currency: "INR",
      source: "Screener",
      verificationStatus: "UNVERIFIED",
      category: "QUARTERLY_FINANCIALS",
      dataPeriod: "Q2 FY26",
    });

    // D) Missing publication timestamp + null value record
    const missingTsRec = makeRecord({
      evidenceId: "ev-no-pub-ts",
      claim: "Promoter Holding",
      value: 50.3,
      unit: "%",
      publishedAt: null,
      category: "INSTITUTIONAL_HOLDING",
    });
    const nullValRec = makeRecord({
      evidenceId: "ev-null-val",
      claim: "Debt to Equity",
      value: null,
      verificationStatus: "VERIFIED",
      category: "QUARTERLY_FINANCIALS",
    });

    const ctx = builder.buildFromExecutions({
      userId: "user-1",
      symbol: "RELIANCE",
      referenceDate: refDate,
      executions: [
        makeExec({
          evidenceRecords: [
            unitCr,
            unitLakh,
            consolClaim,
            standClaim,
            periodQ1,
            periodQ2,
            missingTsRec,
            nullValRec,
          ],
        }),
      ],
    });

    // Null value record is NEVER in evidenceReferences as verified evidence; recorded in missingData
    expect(ctx.evidenceReferences.some((r) => r.evidenceId === "ev-null-val")).toBe(false);
    expect(ctx.missingData.some((m) => m.includes("Debt to Equity"))).toBe(true);

    // Same face value (100) with different units (CR vs LAKH) was NOT deduplicated; flagged in conflicts
    expect(ctx.evidenceReferences.some((r) => r.evidenceId === "ev-unit-cr")).toBe(true);
    expect(ctx.evidenceReferences.some((r) => r.evidenceId === "ev-unit-lakh")).toBe(true);

    // Consolidated vs standalone in claim text flagged as unresolved conflict
    const basisConflict = ctx.conflicts.find((c) =>
      c.evidenceIds.includes("ev-consol-claim")
    );
    expect(basisConflict).toBeDefined();
    expect(basisConflict?.conflictStatus).toBe("CONFLICT_UNRESOLVED");
    expect(basisConflict?.resolutionReason).toContain("Consolidated and standalone");

    // Different reporting periods (Q1 FY26 vs Q2 FY26) flagged as unresolved conflict (not resolved by hierarchy)
    const periodConflict = ctx.conflicts.find((c) =>
      c.evidenceIds.includes("ev-ebitda-q1")
    );
    expect(periodConflict).toBeDefined();
    expect(periodConflict?.conflictStatus).toBe("CONFLICT_UNRESOLVED");
    expect(periodConflict?.resolutionReason).toContain("Incompatible reporting periods");

    // Missing publication timestamp is UNKNOWN granular freshness and EXPIRED base freshness (never FRESH)
    const noTsRef = ctx.evidenceReferences.find((r) => r.evidenceId === "ev-no-pub-ts");
    expect(noTsRef?.granularFreshness).toBe("UNKNOWN");
    expect(noTsRef?.freshnessStatus).toBe("EXPIRED");
    expect(ctx.freshnessSummary.unknownCount).toBe(1);
    expect(ctx.contextStatus).toBe("PARTIAL");
  });

  it("12. Phase 9.1.1 — Cached evidence preserves original publicationTimestamp and retrievalTimestamp distinctly from cacheTimestamp", async () => {
    let clockMs = Date.parse("2026-11-13T10:00:00.000Z");
    const cache = new ResearchCache({ now: () => clockMs });
    const origPubIso = "2026-11-13T09:59:10.000Z";
    const origRetIso = "2026-11-13T09:59:55.000Z";

    const registry = new AgentRegistry({
      cache,
      useCache: true,
      companyResearch: {
        research: async () => ({
          symbol: "RELIANCE",
          question: null,
          verificationStatus: "LLM_RESEARCH_UNVERIFIED",
          readOnly: true,
          model: "gemini-3.8-flash",
          provider: "gemini",
          tier: "balanced",
          generatedAt: origRetIso,
          evidenceRecords: [
            makeRecord({
              evidenceId: "ev-cache-prov",
              publishedAt: origPubIso,
              retrievedAt: origRetIso,
            }),
          ],
          report: {},
          unsupportedClaims: [],
          invalidEvidenceIdsCited: [],
          rawResponseInvalid: false,
          evidenceSummary: {
            totalRecords: 1,
            verifiedCount: 1,
            unverifiedCount: 0,
            staleCount: 0,
            expiredCount: 0,
            conflictedCount: 0,
            conflicts: [],
            missingInformation: [],
            evidenceIdsUsed: ["ev-cache-prov"],
          },
        }),
      } as any,
    });

    const builder = new UnifiedIntelligenceContextBuilder({ registry });

    // First call at 10:00:00Z -> populates cache
    await builder.buildForSymbol(
      "user-1",
      { symbol: "RELIANCE", agents: ["company_research"], query: "Cache provenance" },
      { referenceDate: new Date(clockMs) }
    );

    // Advance clock by 45 seconds -> cache hit at 10:00:45Z
    clockMs += 45_000;
    const ctxCached = await builder.buildForSymbol(
      "user-1",
      { symbol: "RELIANCE", agents: ["company_research"], query: "Cache provenance" },
      { referenceDate: new Date(clockMs) }
    );

    const ref = ctxCached.evidenceReferences[0];
    expect(ref.evidenceId).toBe("ev-cache-prov");
    expect(ref.publicationTimestamp).toBe(origPubIso);
    expect(ref.retrievalTimestamp).toBe(origRetIso);
    expect(ref.publicationTimestamp).not.toBe(ctxCached.createdAt);
    expect(ctxCached.agentExecutions[0].cacheHit).toBe(true);
    expect(ctxCached.agentExecutions[0].generationMode).toBe("CACHED");
  });

  it("13. Phase 9.1.1 — API contract & persistence across POST /api/ai/chat, POST /api/ai/conversations/:id/messages, GET /api/ai/conversations/:id, and POST /api/ai/context", async () => {
    const convService = new ConversationService({ forceInMemory: true });
    const registry = new AgentRegistry({
      useCache: false,
      companyResearch: {
        research: async () => ({
          symbol: "RELIANCE",
          question: null,
          verificationStatus: "LLM_RESEARCH_UNVERIFIED",
          readOnly: true,
          model: "gemini-3.8-flash",
          provider: "gemini",
          tier: "balanced",
          generatedAt: "2026-11-13T10:00:00.000Z",
          evidenceRecords: [makeRecord({ evidenceId: "ev-chat-persist" })],
          report: { summary: "Reliance report" },
          unsupportedClaims: [],
          invalidEvidenceIdsCited: [],
          rawResponseInvalid: false,
          evidenceSummary: {
            totalRecords: 1,
            verifiedCount: 1,
            unverifiedCount: 0,
            staleCount: 0,
            expiredCount: 0,
            conflictedCount: 0,
            conflicts: [],
            missingInformation: [],
            evidenceIdsUsed: ["ev-chat-persist"],
          },
        }),
      } as any,
    });

    const mockSynthClient = {
      createResponse: async () => ({
        id: "resp-1",
        model: "gemini-3.8-flash",
        provider: "gemini",
        fallbackUsed: false,
        outputText: JSON.stringify({
          VERIFIED_FACTS: [{ statement: "Reliance LTP is 1339.7", evidenceIds: ["ev-chat-persist"] }],
          UNVERIFIED_INFORMATION: [],
          AI_INTERPRETATIONS: [],
          ASSUMPTIONS: [],
          CONFLICTING_EVIDENCE: [],
          MISSING_DATA: [],
          RISK_WARNINGS: ["Market risk applies."],
          CONCLUSION: { summary: "Reliance analysis complete.", evidenceIds: ["ev-chat-persist"] },
        }),
        usage: { inputTokens: 20, outputTokens: 15, totalTokens: 35 },
        latencyMs: 10,
      }),
    } as any;

    const contextBuilder = new UnifiedIntelligenceContextBuilder({ registry });
    const orchestrator = new AIOrchestrator({
      registry,
      synthesizer: new ResponseSynthesizer(mockSynthClient),
      contextBuilder,
    });

    const app = Fastify();
    await app.register(aiRoutes, {
      aiOrchestrator: orchestrator,
      conversationService: convService,
      contextBuilder,
    });

    // 1. Invalid symbol rejected with 400 on both /api/ai/chat and /api/ai/context
    const badChat = await app.inject({
      method: "POST",
      url: "/api/ai/chat",
      headers: { authorization: "Bearer token-user-jwt-1" },
      payload: { query: "Analyze symbol", symbol: "INVALID$$$" },
    });
    expect(badChat.statusCode).toBe(400);

    // 2. Valid POST /api/ai/chat returns unifiedContext and persists it
    const chatRes = await app.inject({
      method: "POST",
      url: "/api/ai/chat",
      headers: { authorization: "Bearer token-user-jwt-1" },
      payload: { query: "Analyze RELIANCE fundamentals", symbol: "RELIANCE" },
    });
    expect(chatRes.statusCode).toBe(200);
    const chatBody = chatRes.json();
    expect(chatBody.unifiedContext).toBeDefined();
    expect(chatBody.unifiedContext.symbol).toBe("RELIANCE");
    expect(chatBody.unifiedContext.evidenceReferences).toHaveLength(1);
    expect(chatBody.unifiedContext.evidenceReferences[0].evidenceId).toBe("ev-chat-persist");

    const convId = chatBody.conversationId;

    // 3. Follow-up POST /api/ai/conversations/:id/messages returns consistent unifiedContext
    const msgRes = await app.inject({
      method: "POST",
      url: `/api/ai/conversations/${convId}/messages`,
      headers: { authorization: "Bearer token-user-jwt-1" },
      payload: { query: "Update on RELIANCE", symbol: "RELIANCE" },
    });
    expect(msgRes.statusCode).toBe(200);
    expect(msgRes.json().unifiedContext.symbol).toBe("RELIANCE");

    // 4. Reload conversation via GET /api/ai/conversations/:id preserves unifiedContext & evidenceReferences
    const reloadRes = await app.inject({
      method: "GET",
      url: `/api/ai/conversations/${convId}`,
      headers: { authorization: "Bearer token-user-jwt-1" },
    });
    expect(reloadRes.statusCode).toBe(200);
    const reloadBody = reloadRes.json();
    const assistantMessages = reloadBody.messages.filter((m: any) => m.role === "assistant");
    expect(assistantMessages.length).toBe(2);
    expect(assistantMessages[0].unifiedContext).toBeDefined();
    expect(assistantMessages[0].unifiedContext.symbol).toBe("RELIANCE");
    expect(assistantMessages[0].unifiedContext.evidenceReferences[0].evidenceId).toBe(
      "ev-chat-persist"
    );

    // 5. POST /api/ai/context returns identical schema under both .context and .unifiedContext
    const ctxRes = await app.inject({
      method: "POST",
      url: "/api/ai/context",
      headers: { authorization: "Bearer token-user-jwt-1" },
      payload: { symbol: "RELIANCE", agents: ["company_research"] },
    });
    expect(ctxRes.statusCode).toBe(200);
    const ctxBody = ctxRes.json();
    expect(ctxBody.unifiedContext).toEqual(ctxBody.context);
    expect(ctxBody.unifiedContext.symbol).toBe("RELIANCE");

    await app.close();
  });
});
