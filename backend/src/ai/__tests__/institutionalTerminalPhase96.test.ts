import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import aiRoutes from "../../routes/ai";
import { EvidenceRecord } from "../evidence/EvidenceSchema";
import { AgentExecutionResult, AgentRegistry } from "../orchestrator/AgentRegistry";
import { UnifiedIntelligenceContextBuilder } from "../context/UnifiedIntelligenceContextBuilder";
import { LiveResearchValidationService } from "../context/LiveResearchValidationService";
import { InstitutionalTerminalService } from "../context/InstitutionalTerminalService";
import { ConversationService } from "../conversation/ConversationService";
import { PortfolioPositionRecord } from "../agents/PortfolioIntelligenceSchema";

vi.mock("../../auth/middleware", () => {
  async function authenticateRequest(request: any, reply: any): Promise<void> {
    const auth: string | undefined = request.headers["authorization"];
    if (auth === "Bearer token-user-96-a") {
      request.verifiedUser = { userId: "user-96-a" };
      return;
    }
    if (auth === "Bearer token-user-96-b") {
      request.verifiedUser = { userId: "user-96-b" };
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

function makeEvidence(
  overrides: Partial<EvidenceRecord> & { id: string; claim: string }
): EvidenceRecord {
  const nowIso = "2026-11-14T08:00:00.000Z";
  return {
    evidenceId: overrides.id,
    symbol: overrides.symbol ?? "TCS",
    category: overrides.category ?? "QUARTERLY_FINANCIALS",
    claim: overrides.claim,
    value: overrides.value ?? 18.4,
    unit: overrides.unit === undefined ? "%" : overrides.unit,
    currency: overrides.currency ?? "INR",
    source: overrides.source ?? "NSE Official Filing",
    sourceTier: overrides.sourceTier ?? "OFFICIAL_EXCHANGE_OR_FILING",
    sourceClassification: overrides.sourceClassification ?? "OFFICIAL_EXCHANGE",
    dataPeriod: overrides.dataPeriod ?? "Q2FY27",
    sourceUrl: "https://www.nseindia.com/filings/tcs",
    publishedAt: overrides.publishedAt ?? nowIso,
    retrievedAt: overrides.retrievedAt ?? nowIso,
    freshness: overrides.freshness ?? "FRESH",
    verificationStatus: overrides.verificationStatus ?? "VERIFIED",
    verificationMethod: "OFFICIAL_EXCHANGE_SIGNATURE",
    confidence: 0.95,
    supportingEvidenceIds: [],
    conflictingEvidenceIds: [],
    untrustedExternal: false,
    metadata: overrides.metadata ?? { basis: "CONSOLIDATED", dataPeriod: "Q2FY27" },
  };
}

function makeExec(
  agentId: AgentExecutionResult["agentId"],
  evidence: EvidenceRecord[],
  missingInformation: string[] = []
): AgentExecutionResult {
  return {
    agentId,
    status: "SUCCEEDED",
    errorCategory: "SUCCESS",
    latencyMs: 25,
    startTimestamp: "2026-11-14T08:00:00.000Z",
    completionTimestamp: "2026-11-14T08:00:00.025Z",
    providerUsed: "gemini",
    error: null,
    generatedAt: "2026-11-14T08:00:00.025Z",
    cached: false,
    cacheTimestamp: null,
    freshnessLabel: "FRESH",
    evidenceIds: evidence.map((e) => e.evidenceId),
    evidenceRecords: evidence,
    missingInformation,
    conflictsCount: 0,
    summaryPayload: null,
  };
}

describe("Phase 9.6 — Institutional Research Terminal & Portfolio Intelligence", () => {
  it("1. Portfolio-to-research mapping: shows RESEARCH_UNAVAILABLE when unresearched, maps server-generated brief when available, and never modifies holdings", async () => {
    const convService = new ConversationService({ forceInMemory: true });
    const builder = new UnifiedIntelligenceContextBuilder();

    const userAPositions: PortfolioPositionRecord[] = [
      {
        id: "pos-tcs-1",
        userId: "user-96-a",
        instrument: "TCS.NS",
        sector: "IT",
        side: "BUY",
        quantity: 25,
        entryPrice: 3850,
        currentPrice: 4120,
        realizedPnL: null,
        stopLoss: 3700,
        status: "OPEN",
        updatedAt: "2026-11-14T07:30:00.000Z",
      },
      {
        id: "pos-infy-1",
        userId: "user-96-a",
        instrument: "INFY.NS",
        sector: "IT",
        side: "BUY",
        quantity: 40,
        entryPrice: 1620,
        currentPrice: 1710,
        realizedPnL: null,
        stopLoss: 1550,
        status: "OPEN",
        updatedAt: "2026-11-14T07:30:00.000Z",
      },
    ];

    // Record a persisted research context for TCS owned by user-96-a (INFY remains unresearched)
    const tcsContext = builder.buildFromExecutions({
      userId: "user-96-a",
      symbol: "TCS",
      requestedPeriod: "Q2FY27",
      referenceDate: new Date("2026-11-14T08:05:00.000Z"),
      executions: [
        makeExec("company_research", [
          makeEvidence({
            id: "ev-tcs-rev",
            symbol: "TCS",
            claim: "Consolidated Quarterly Revenue Growth YoY",
            value: 15.6,
          }),
          makeEvidence({
            id: "ev-tcs-pat",
            symbol: "TCS",
            claim: "Consolidated Net Profit Growth YoY",
            value: 18.2,
          }),
        ]),
      ],
    });
    convService.recordUnifiedContext("user-96-a", tcsContext);

    const terminalSvc = new InstitutionalTerminalService({
      positionsLoader: async (uid) =>
        uid === "user-96-a" ? userAPositions.map((p) => ({ ...p })) : [],
      conversations: convService,
      contextBuilder: builder,
    });

    const portfolioRes = await terminalSvc.getPortfolioResearchIntelligence(
      "user-96-a",
      { refreshMissing: false }
    );

    expect(portfolioRes.readOnly).toBe(true);
    expect(portfolioRes.totalHoldings).toBe(2);
    expect(portfolioRes.researchedHoldingsCount).toBe(1);
    expect(portfolioRes.unavailableHoldingsCount).toBe(1);

    const tcsHolding = portfolioRes.holdings.find((h) => h.symbol === "TCS")!;
    expect(tcsHolding.researchStatus).toBe("RESEARCH_AVAILABLE");
    expect(tcsHolding.quantity).toBe(25);
    expect(tcsHolding.researchConclusion).toBe("CAUTIOUSLY_POSITIVE");
    expect(tcsHolding.confidenceClassification).toBe("HIGH");
    expect(tcsHolding.fundamentalAssessment).toBe("CONSTRUCTIVE");
    expect(tcsHolding.lastResearchTimestamp).toBe(tcsContext.createdAt);

    const infyHolding = portfolioRes.holdings.find((h) => h.symbol === "INFY")!;
    expect(infyHolding.researchStatus).toBe("RESEARCH_UNAVAILABLE");
    expect(infyHolding.researchConclusion).toBe("RESEARCH_UNAVAILABLE");
    expect(infyHolding.confidenceClassification).toBe("RESEARCH_UNAVAILABLE");
    expect(infyHolding.fundamentalAssessment).toBe("RESEARCH_UNAVAILABLE");
    expect(infyHolding.lastResearchTimestamp).toBeNull();
  });

  it("2. Authenticated research history tracks conclusion transitions, changed pillars, new financial risks, resolved conflicts, and enforces user isolation + pagination", async () => {
    const convService = new ConversationService({ forceInMemory: true });
    const builder = new UnifiedIntelligenceContextBuilder();

    // Older context for RELIANCE (with conflict and weak revenue)
    const relOld = builder.buildFromExecutions({
      userId: "user-96-a",
      symbol: "RELIANCE",
      requestedAt: "2026-11-10T08:00:00.000Z",
      referenceDate: new Date("2026-11-10T08:05:00.000Z"),
      executions: [
        makeExec("company_research", [
          makeEvidence({
            id: "ev-rel-old-rev",
            symbol: "RELIANCE",
            claim: "Quarterly Revenue Growth YoY",
            value: 6.0,
          }),
          makeEvidence({
            id: "ev-rel-conf-1",
            symbol: "RELIANCE",
            claim: "Operating EBITDA Margin",
            value: 14.0,
            source: "NSE Official Filing",
          }),
          makeEvidence({
            id: "ev-rel-conf-2",
            symbol: "RELIANCE",
            claim: "Operating EBITDA Margin",
            value: 21.0,
            source: "Aggregator",
            sourceTier: "INSTITUTIONAL_DATA_FEED",
            sourceClassification: "VERIFIED_FINANCIAL_PROVIDER",
          }),
        ]),
      ],
    });
    convService.recordUnifiedContext("user-96-a", relOld);

    // Newer context for RELIANCE (conflict resolved, revenue improved, but debt risk added)
    const relNew = builder.buildFromExecutions({
      userId: "user-96-a",
      symbol: "RELIANCE",
      requestedAt: "2026-11-14T08:00:00.000Z",
      referenceDate: new Date("2026-11-14T08:05:00.000Z"),
      previousContexts: [relOld],
      executions: [
        makeExec("company_research", [
          makeEvidence({
            id: "ev-rel-new-rev",
            symbol: "RELIANCE",
            claim: "Quarterly Revenue Growth YoY",
            value: 15.2,
          }),
          makeEvidence({
            id: "ev-rel-new-margin",
            symbol: "RELIANCE",
            claim: "Operating EBITDA Margin",
            value: 18.0,
            source: "NSE Official Filing",
          }),
          makeEvidence({
            id: "ev-rel-new-debt",
            symbol: "RELIANCE",
            claim: "Debt to Equity Ratio",
            value: 2.1,
            unit: "x",
          }),
        ]),
      ],
    });
    convService.recordUnifiedContext("user-96-a", relNew);

    // Context owned by user-96-b (must never leak to user-96-a)
    const userBCtx = builder.buildFromExecutions({
      userId: "user-96-b",
      symbol: "RELIANCE",
      requestedAt: "2026-11-14T09:00:00.000Z",
      referenceDate: new Date("2026-11-14T09:05:00.000Z"),
      executions: [
        makeExec("company_research", [
          makeEvidence({
            id: "ev-b-1",
            symbol: "RELIANCE",
            claim: "Quarterly Revenue Growth YoY",
            value: 99.0,
          }),
        ]),
      ],
    });
    convService.recordUnifiedContext("user-96-b", userBCtx);

    const terminalSvc = new InstitutionalTerminalService({
      conversations: convService,
      contextBuilder: builder,
    });

    const histPage1 = await terminalSvc.getResearchHistory("user-96-a", {
      symbol: "RELIANCE",
      limit: 1,
      offset: 0,
    });

    expect(histPage1.total).toBe(2);
    expect(histPage1.entries).toHaveLength(1);
    const latestEntry = histPage1.entries[0];
    expect(latestEntry.contextId).toBe(relNew.contextId);
    expect(latestEntry.historicalStatus).toBe("COMPARED");
    expect(latestEntry.previousContextId).toBe(relOld.contextId);
    expect(latestEntry.previousConclusion).toBe("NEUTRAL");
    expect(latestEntry.changedPillarAssessments.length).toBeGreaterThan(0);
    expect(
      latestEntry.newFinancialRisks.some((r) => r.category === "DEBT_AND_LEVERAGE")
    ).toBe(true);
    expect(latestEntry.resolvedConflicts.length).toBeGreaterThan(0);
    expect(latestEntry.improvedEvidence.length).toBeGreaterThan(0);
  });

  it("3. API routes: enforces JWT authentication, rate limiting, ownership isolation, and ignores client-supplied portfolio balances on GET /api/ai/portfolio-research and GET /api/ai/research-history", async () => {
    const convService = new ConversationService({ forceInMemory: true });
    const fakeRegistry = {
      execute: async (
        agentId: AgentExecutionResult["agentId"],
        input: { symbol?: string | null }
      ) => {
        if (agentId === "company_research") {
          const sym = input.symbol || "TCS";
          return makeExec("company_research", [
            makeEvidence({
              id: `ev-${sym.toLowerCase()}-rev`,
              symbol: sym,
              claim: "Consolidated Quarterly Revenue Growth YoY",
              value: 14.8,
            }),
            makeEvidence({
              id: `ev-${sym.toLowerCase()}-pat`,
              symbol: sym,
              claim: "Consolidated Net Profit Growth YoY",
              value: 16.5,
            }),
          ]);
        }
        return makeExec(agentId, []);
      },
    } as unknown as AgentRegistry;

    const testBuilder = new UnifiedIntelligenceContextBuilder({
      registry: fakeRegistry,
    });
    const testValidationSvc = new LiveResearchValidationService({
      contextBuilder: testBuilder,
    });

    const app = Fastify();
    await app.register(aiRoutes, {
      conversationService: convService,
      contextBuilder: testBuilder,
      liveValidationService: testValidationSvc,
      positionsLoader: async (uid) =>
        uid === "user-96-a"
          ? [
              {
                id: "pos-1",
                userId: "user-96-a",
                instrument: "TCS",
                sector: "IT",
                side: "BUY",
                quantity: 15,
                entryPrice: 3900,
                currentPrice: 4050,
                realizedPnL: null,
                stopLoss: null,
                status: "OPEN",
                updatedAt: "2026-11-14T08:00:00.000Z",
              },
            ]
          : [],
      rateLimitMaxRequests: 2,
      rateLimitWindowMs: 60_000,
    });

    // Unauthenticated requests -> 401
    const unauthPortfolio = await app.inject({
      method: "GET",
      url: "/api/ai/portfolio-research",
    });
    expect(unauthPortfolio.statusCode).toBe(401);

    const unauthHistory = await app.inject({
      method: "GET",
      url: "/api/ai/research-history",
    });
    expect(unauthHistory.statusCode).toBe(401);

    // Authenticated portfolio-research with refreshMissing=true -> generates research brief and records in history
    const authPortfolio = await app.inject({
      method: "GET",
      url: "/api/ai/portfolio-research?refreshMissing=true&fakeBalance=9999999",
      headers: { authorization: "Bearer token-user-96-a" },
    });
    expect(authPortfolio.statusCode).toBe(200);
    const pBody = authPortfolio.json();
    expect(pBody.ok).toBe(true);
    expect(pBody.holdings).toHaveLength(1);
    expect(pBody.holdings[0].symbol).toBe("TCS");
    expect(pBody.holdings[0].quantity).toBe(15);
    expect(pBody.holdings[0].researchStatus).toBe("RESEARCH_AVAILABLE");
    expect(JSON.stringify(pBody)).not.toContain("9999999");

    // User B cannot see User A's portfolio or research history
    const userBPortfolio = await app.inject({
      method: "GET",
      url: "/api/ai/portfolio-research",
      headers: { authorization: "Bearer token-user-96-b" },
    });
    expect(userBPortfolio.json().holdings).toHaveLength(0);

    const userAHistory = await app.inject({
      method: "GET",
      url: "/api/ai/research-history",
      headers: { authorization: "Bearer token-user-96-a" },
    });
    expect(userAHistory.statusCode).toBe(200);
    expect(userAHistory.json().entries).toHaveLength(1);
    expect(userAHistory.json().entries[0].symbol).toBe("TCS");

    const userBHistory = await app.inject({
      method: "GET",
      url: "/api/ai/research-history",
      headers: { authorization: "Bearer token-user-96-b" },
    });
    expect(userBHistory.json().entries).toHaveLength(0);

    // Rate limiting check (rateLimitMaxRequests: 2)
    await app.inject({
      method: "GET",
      url: "/api/ai/portfolio-research?refreshMissing=true",
      headers: { authorization: "Bearer token-user-96-a" },
    });
    const rateLimitedRes = await app.inject({
      method: "GET",
      url: "/api/ai/portfolio-research?refreshMissing=true",
      headers: { authorization: "Bearer token-user-96-a" },
    });
    expect(rateLimitedRes.statusCode).toBe(429);

    await app.close();
  });
});
