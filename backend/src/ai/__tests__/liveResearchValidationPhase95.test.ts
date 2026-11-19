import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import aiRoutes from "../../routes/ai";
import { EvidenceRecord } from "../evidence/EvidenceSchema";
import { AgentExecutionResult, AgentRegistry } from "../orchestrator/AgentRegistry";
import { UnifiedIntelligenceContextBuilder } from "../context/UnifiedIntelligenceContextBuilder";
import { LiveResearchValidationService } from "../context/LiveResearchValidationService";
import { InstitutionalResearchBrief } from "../context/InstitutionalResearchBriefSchema";
import { ConversationService } from "../conversation/ConversationService";

vi.mock("../../auth/middleware", () => {
  async function authenticateRequest(request: any, reply: any): Promise<void> {
    const auth: string | undefined = request.headers["authorization"];
    if (auth === "Bearer token-user-95-api") {
      request.verifiedUser = { userId: "user-95-api" };
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
    sourceUrl:
      overrides.sourceUrl === undefined
        ? "https://www.nseindia.com/filings/tcs"
        : overrides.sourceUrl,
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
  missingInformation: string[] = [],
  status: AgentExecutionResult["status"] = "SUCCEEDED",
  errorCategory: AgentExecutionResult["errorCategory"] = "SUCCESS",
  error: string | null = null
): AgentExecutionResult {
  return {
    agentId,
    status,
    errorCategory,
    latencyMs: 30,
    startTimestamp: "2026-11-14T08:00:00.000Z",
    completionTimestamp: "2026-11-14T08:00:00.030Z",
    providerUsed: status === "SUCCEEDED" ? "gemini" : null,
    error,
    generatedAt: "2026-11-14T08:00:00.030Z",
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

describe("Phase 9.5 — Live Research Validation & Institutional Peer Intelligence", () => {
  const builder = new UnifiedIntelligenceContextBuilder();
  const validationService = new LiveResearchValidationService({
    contextBuilder: builder,
  });
  const refDate = new Date("2026-11-14T08:05:00.000Z");

  it("1. Validates all 11 core financial & institutional metrics with full provenance and preserves null (never 0) for unavailable metrics", () => {
    const ctx = builder.buildFromExecutions({
      userId: "user-95-1",
      symbol: "TCS",
      requestedPeriod: "Q2FY27",
      referenceDate: refDate,
      executions: [
        makeExec("company_research", [
          makeEvidence({
            id: "ev-tcs-rev",
            claim: "Consolidated Quarterly Revenue Growth YoY",
            value: 15.8,
            unit: "%",
          }),
          makeEvidence({
            id: "ev-tcs-pat",
            claim: "Consolidated Net Profit Growth YoY",
            value: 18.4,
            unit: "%",
          }),
          makeEvidence({
            id: "ev-tcs-ebitda",
            claim: "Consolidated EBITDA",
            value: 16400,
            unit: "Cr",
          }),
          makeEvidence({
            id: "ev-tcs-margin",
            claim: "Operating EBITDA Margin",
            value: 25.9,
            unit: "%",
          }),
          makeEvidence({
            id: "ev-tcs-de",
            claim: "Debt to Equity Ratio",
            value: 0.04,
            unit: "x",
          }),
          makeEvidence({
            id: "ev-tcs-roe",
            claim: "Return on Equity (ROE)",
            value: 48.2,
            unit: "%",
          }),
          makeEvidence({
            id: "ev-tcs-eps-unv",
            claim: "Diluted EPS",
            value: 34.5,
            unit: "INR",
            source: "Third-Party Blog",
            sourceTier: "THIRD_PARTY_NEWS",
            sourceClassification: "UNVERIFIED",
            verificationStatus: "UNVERIFIED",
          }),
        ]),
        makeExec("institutional_intelligence", [
          makeEvidence({
            id: "ev-tcs-prom",
            category: "INSTITUTIONAL_HOLDING",
            claim: "Promoter Holding Percentage",
            value: 71.77,
            unit: "%",
          }),
        ]),
      ],
    });

    const metrics = validationService.validateCompanyMetrics(ctx);

    expect(metrics.REVENUE.status).toBe("VERIFIED_AVAILABLE");
    expect(metrics.REVENUE.value).toBe(15.8);
    expect(metrics.REVENUE.evidenceId).toBe("ev-tcs-rev");
    expect(metrics.REVENUE.sourceName).toBe("NSE Official Filing");
    expect(metrics.REVENUE.sourceUrl).toBe("https://www.nseindia.com/filings/tcs");
    expect(metrics.REVENUE.reportingPeriod).toBe("Q2FY27");
    expect(metrics.REVENUE.reportingBasis).toBe("CONSOLIDATED");
    expect(metrics.REVENUE.freshness).toBe("FRESH");

    // Unverified EPS is marked UNVERIFIED_AVAILABLE, never VERIFIED_AVAILABLE
    expect(metrics.EPS.status).toBe("UNVERIFIED_AVAILABLE");
    expect(metrics.EPS.verificationStatus).toBe("UNVERIFIED");
    expect(metrics.EPS.notes.some((n) => n.includes("UNVERIFIED"))).toBe(true);

    // Missing Cash Flow & Promoter Pledge remain null, never 0
    expect(metrics.CASH_FLOW.status).toBe("MISSING_UNAVAILABLE");
    expect(metrics.CASH_FLOW.value).toBeNull();
    expect(metrics.PROMOTER_PLEDGE.status).toBe("MISSING_UNAVAILABLE");
    expect(metrics.PROMOTER_PLEDGE.value).toBeNull();
  });

  it("2. Validates institutional data: distinguishes static snapshots, period changes, and explicit buying/selling flows", () => {
    const staticOnlyCtx = builder.buildFromExecutions({
      userId: "user-95-2",
      symbol: "HDFCBANK",
      referenceDate: refDate,
      executions: [
        makeExec("institutional_intelligence", [
          makeEvidence({
            id: "ev-hdfc-fii-snap",
            symbol: "HDFCBANK",
            category: "INSTITUTIONAL_HOLDING",
            claim: "FII Shareholding Percentage",
            value: 47.2,
          }),
        ]),
      ],
    });

    const staticReport = validationService.validateInstitutionalData(staticOnlyCtx);
    expect(staticReport.staticSnapshotCount).toBe(1);
    expect(staticReport.periodChangeCount).toBe(0);
    expect(staticReport.explicitFlowCount).toBe(0);
    expect(staticReport.hasExplicitFlowDisclosures).toBe(false);
    expect(staticReport.staticOwnershipRemainsNeutral).toBe(true);
    expect(staticReport.flowLimitationWarning).toContain("never imply active accumulation");
    expect(staticReport.records[0].disclosureType).toBe("STATIC_SHAREHOLDING_SNAPSHOT");
    expect(staticReport.records[0].directionalTreatment).toBe("NEUTRAL_STATIC");

    const flowCtx = builder.buildFromExecutions({
      userId: "user-95-2",
      symbol: "ICICIBANK",
      referenceDate: refDate,
      executions: [
        makeExec("institutional_intelligence", [
          makeEvidence({
            id: "ev-icici-snap",
            symbol: "ICICIBANK",
            category: "INSTITUTIONAL_HOLDING",
            claim: "FII Shareholding Percentage",
            value: 44.1,
          }),
          makeEvidence({
            id: "ev-icici-qoq",
            symbol: "ICICIBANK",
            category: "INSTITUTIONAL_HOLDING",
            claim: "DII Holding QoQ Change",
            value: 0.85,
          }),
          makeEvidence({
            id: "ev-icici-flow",
            symbol: "ICICIBANK",
            category: "INSTITUTIONAL_HOLDING",
            claim: "FII Net Buying Flow",
            value: 1250,
            unit: "Cr",
          }),
        ]),
      ],
    });

    const flowReport = validationService.validateInstitutionalData(flowCtx);
    expect(flowReport.staticSnapshotCount).toBe(1);
    expect(flowReport.periodChangeCount).toBe(1);
    expect(flowReport.explicitFlowCount).toBe(1);
    expect(flowReport.hasExplicitFlowDisclosures).toBe(true);
    expect(flowReport.staticOwnershipRemainsNeutral).toBe(true);
    expect(flowReport.flowLimitationWarning).toBeNull();
  });

  it("3. Multi-company peer research workflow: ranks compatible peers, excludes STANDALONE/incompatible-period/insufficient peers, and returns NO_PEER_CONTEXT when peers are absent", async () => {
    const tcsCtx = builder.buildFromExecutions({
      userId: "user-95-3",
      symbol: "TCS",
      requestedPeriod: "Q2FY27",
      referenceDate: refDate,
      executions: [
        makeExec("company_research", [
          makeEvidence({
            id: "ev-tcs-r1",
            symbol: "TCS",
            claim: "Consolidated Quarterly Revenue Growth YoY",
            value: 16.2,
            dataPeriod: "Q2FY27",
            metadata: { basis: "CONSOLIDATED", dataPeriod: "Q2FY27" },
          }),
          makeEvidence({
            id: "ev-tcs-p1",
            symbol: "TCS",
            claim: "Consolidated Net Profit Growth YoY",
            value: 19.0,
            dataPeriod: "Q2FY27",
            metadata: { basis: "CONSOLIDATED", dataPeriod: "Q2FY27" },
          }),
        ]),
        makeExec("institutional_intelligence", [
          makeEvidence({
            id: "ev-tcs-f1",
            symbol: "TCS",
            category: "INSTITUTIONAL_HOLDING",
            claim: "FII Net Buying Flow QoQ",
            value: 1.4,
            dataPeriod: "Q2FY27",
          }),
        ]),
      ],
    });

    const infyComparableCtx = builder.buildFromExecutions({
      userId: "user-95-3",
      symbol: "INFY",
      requestedPeriod: "Q2FY27",
      referenceDate: refDate,
      executions: [
        makeExec("company_research", [
          makeEvidence({
            id: "ev-infy-r1",
            symbol: "INFY",
            claim: "Consolidated Quarterly Revenue Growth YoY",
            value: 12.1,
            dataPeriod: "Q2FY27",
            metadata: { basis: "CONSOLIDATED", dataPeriod: "Q2FY27" },
          }),
          makeEvidence({
            id: "ev-infy-p1",
            symbol: "INFY",
            claim: "Consolidated Net Profit Growth YoY",
            value: 13.0,
            dataPeriod: "Q2FY27",
            metadata: { basis: "CONSOLIDATED", dataPeriod: "Q2FY27" },
          }),
        ]),
      ],
    });

    const techmStandaloneCtx = builder.buildFromExecutions({
      userId: "user-95-3",
      symbol: "TECHM",
      requestedPeriod: "Q2FY27",
      referenceDate: refDate,
      executions: [
        makeExec("company_research", [
          makeEvidence({
            id: "ev-techm-r1",
            symbol: "TECHM",
            claim: "Standalone Quarterly Revenue Growth YoY",
            value: 14.0,
            dataPeriod: "Q2FY27",
            metadata: { basis: "STANDALONE", dataPeriod: "Q2FY27" },
          }),
          makeEvidence({
            id: "ev-techm-p1",
            symbol: "TECHM",
            claim: "Standalone Net Profit Growth YoY",
            value: 15.0,
            dataPeriod: "Q2FY27",
            metadata: { basis: "STANDALONE", dataPeriod: "Q2FY27" },
          }),
        ]),
      ],
    });

    const wiproIncompatiblePeriodCtx = builder.buildFromExecutions({
      userId: "user-95-3",
      symbol: "WIPRO",
      requestedPeriod: "Q4FY26",
      referenceDate: refDate,
      executions: [
        makeExec("company_research", [
          makeEvidence({
            id: "ev-wipro-r1",
            symbol: "WIPRO",
            claim: "Consolidated Quarterly Revenue Growth YoY",
            value: 11.5,
            dataPeriod: "Q4FY26",
            metadata: { basis: "CONSOLIDATED", dataPeriod: "Q4FY26" },
          }),
          makeEvidence({
            id: "ev-wipro-p1",
            symbol: "WIPRO",
            claim: "Consolidated Net Profit Growth YoY",
            value: 11.8,
            dataPeriod: "Q4FY26",
            metadata: { basis: "CONSOLIDATED", dataPeriod: "Q4FY26" },
          }),
        ]),
      ],
    });

    const forcemotMissingCtx = builder.buildFromExecutions({
      userId: "user-95-3",
      symbol: "FORCEMOT",
      requestedPeriod: "Q2FY27",
      referenceDate: refDate,
      executions: [
        makeExec("company_research", [], ["Fundamentals unavailable"]),
      ],
    });

    const res = await validationService.executePeerResearch({
      userId: "user-95-3",
      targetSymbol: "TCS",
      precollectedTargetContext: tcsCtx,
      precollectedPeerContexts: [
        infyComparableCtx,
        techmStandaloneCtx,
        wiproIncompatiblePeriodCtx,
        forcemotMissingCtx,
      ],
    });

    expect(res.peerComparisonStatus).toBe("COMPARED");
    expect(res.rankedCompanies.map((r) => r.symbol)).toEqual(["TCS", "INFY"]);
    expect(res.unrankedCompanies.map((u) => u.symbol)).toEqual(
      expect.arrayContaining(["TECHM", "WIPRO", "FORCEMOT"])
    );
    expect(res.comparisonRows).toHaveLength(5);

    // Also verify NO_PEER_CONTEXT when no peers are supplied
    const noPeersRes = await validationService.executePeerResearch({
      userId: "user-95-3",
      targetSymbol: "TCS",
      precollectedTargetContext: tcsCtx,
      precollectedPeerContexts: [],
    });
    expect(noPeersRes.peerComparisonStatus).toBe("NO_PEER_CONTEXT");
  });

  it("4. Research brief quality audit passes valid briefs and catches unsupported positive/negative conclusions or fabricated evidence IDs", () => {
    const validCtx = builder.buildFromExecutions({
      userId: "user-95-4",
      symbol: "TCS",
      referenceDate: refDate,
      executions: [
        makeExec("company_research", [
          makeEvidence({
            id: "ev-aud-1",
            symbol: "TCS",
            claim: "Consolidated Quarterly Revenue Growth YoY",
            value: 14.2,
          }),
          makeEvidence({
            id: "ev-aud-2",
            symbol: "TCS",
            claim: "Consolidated Net Profit Growth YoY",
            value: 16.0,
          }),
        ]),
      ],
    });

    const passAudit = validationService.auditResearchBriefQuality(validCtx);
    expect(passAudit.passed).toBe(true);
    expect(passAudit.violations).toHaveLength(0);

    // Tamper with brief to simulate an unsupported POSITIVE conclusion with fabricated evidenceId
    const tamperedBrief: InstitutionalResearchBrief = {
      ...validCtx.researchBrief!,
      fundamentalAssessment: {
        ...validCtx.researchBrief!.fundamentalAssessment,
        assessment: "CONFLICTED",
      },
      conclusion: "POSITIVE",
      bullishEvidence: [
        {
          ...validCtx.researchBrief!.bullishEvidence[0],
          evidenceId: "ev-fabricated-999",
        },
      ],
    };

    const failAudit = validationService.auditResearchBriefQuality(
      validCtx,
      tamperedBrief
    );
    expect(failAudit.passed).toBe(false);
    expect(failAudit.checks.conflictedFundamentalsBlockPositive).toBe(false);
    expect(failAudit.checks.evidenceIdIntegrityVerified).toBe(false);
    expect(failAudit.violations.length).toBeGreaterThanOrEqual(2);
  });

  it("5. Historical research summary tracks conclusion & pillar transitions for owned contexts and enforces user ownership isolation", () => {
    const prevOwned = builder.buildFromExecutions({
      userId: "user-owner",
      symbol: "RELIANCE",
      requestedAt: "2026-11-10T08:00:00.000Z",
      referenceDate: new Date("2026-11-10T08:05:00.000Z"),
      executions: [
        makeExec("company_research", [
          makeEvidence({
            id: "ev-rel-old-rev",
            symbol: "RELIANCE",
            claim: "Quarterly Revenue Growth YoY",
            value: -3.5,
          }),
        ]),
      ],
    });

    const prevOtherUser = builder.buildFromExecutions({
      userId: "user-other",
      symbol: "RELIANCE",
      requestedAt: "2026-11-12T08:00:00.000Z",
      referenceDate: new Date("2026-11-12T08:05:00.000Z"),
      executions: [
        makeExec("company_research", [
          makeEvidence({
            id: "ev-rel-other",
            symbol: "RELIANCE",
            claim: "Quarterly Revenue Growth YoY",
            value: 50.0,
          }),
        ]),
      ],
    });

    const currOwned = builder.buildFromExecutions({
      userId: "user-owner",
      symbol: "RELIANCE",
      requestedAt: "2026-11-14T08:00:00.000Z",
      referenceDate: refDate,
      previousContexts: [prevOwned],
      executions: [
        makeExec("company_research", [
          makeEvidence({
            id: "ev-rel-new-rev",
            symbol: "RELIANCE",
            claim: "Quarterly Revenue Growth YoY",
            value: 15.2,
          }),
          makeEvidence({
            id: "ev-rel-new-pat",
            symbol: "RELIANCE",
            claim: "Net Profit Growth YoY",
            value: 17.5,
          }),
        ]),
      ],
    });

    // Rejects other user's context
    const unownedSummary = validationService.buildHistoricalResearchSummary(
      currOwned,
      [prevOtherUser]
    );
    expect(unownedSummary.status).toBe("NO_HISTORICAL_CONTEXT");

    // Compares owned context and detects conclusion + pillar changes
    const ownedSummary = validationService.buildHistoricalResearchSummary(
      currOwned,
      [prevOwned]
    );
    expect(ownedSummary.status).toBe("COMPARED");
    expect(ownedSummary.previousConclusion).toBe("NEGATIVE");
    expect(ownedSummary.currentConclusion).toBe("CAUTIOUSLY_POSITIVE");
    expect(ownedSummary.changedPillarAssessments.length).toBeGreaterThan(0);
    expect(
      ownedSummary.changedPillarAssessments.some(
        (c) =>
          c.pillar === "FUNDAMENTAL_QUALITY" &&
          c.previousAssessment === "WEAK" &&
          c.currentAssessment === "CONSTRUCTIVE"
      )
    ).toBe(true);
  });

  it("6. Enforces JWT authentication and ignores client-supplied financial figures on POST /api/ai/peer-research", async () => {
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
              value: sym === "TCS" ? 16.0 : 12.5,
              dataPeriod: "Q2FY27",
              metadata: { basis: "CONSOLIDATED", dataPeriod: "Q2FY27" },
            }),
            makeEvidence({
              id: `ev-${sym.toLowerCase()}-pat`,
              symbol: sym,
              claim: "Consolidated Net Profit Growth YoY",
              value: sym === "TCS" ? 18.0 : 13.0,
              dataPeriod: "Q2FY27",
              metadata: { basis: "CONSOLIDATED", dataPeriod: "Q2FY27" },
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
    });

    // Unauthenticated request -> 401
    const unauthRes = await app.inject({
      method: "POST",
      url: "/api/ai/peer-research",
      payload: {
        targetSymbol: "TCS",
        peerSymbols: ["INFY"],
      },
    });
    expect(unauthRes.statusCode).toBe(401);

    // Authenticated request with spoofed client-supplied financial figures -> ignored
    const authRes = await app.inject({
      method: "POST",
      url: "/api/ai/peer-research",
      headers: {
        authorization: "Bearer token-user-95-api",
      },
      payload: {
        targetSymbol: "TCS.NS",
        peerSymbols: ["INFY.NS"],
        requestedPeriod: "Q2FY27",
        // Attempt to inject spoofed client figures
        fundamentals: { revenueGrowth: 999.9 },
        evidence: [{ claim: "Fake Revenue", value: 999.9 }],
      },
    });

    expect(authRes.statusCode).toBe(200);
    const body = authRes.json();
    expect(body.ok).toBe(true);
    expect(body.targetSymbol).toBe("TCS");
    expect(body.peerSymbols).toEqual(["INFY"]);
    expect(body.peerComparisonStatus).toBe("COMPARED");
    expect(body.targetValidation.metrics.REVENUE.value).toBe(16.0);
    expect(JSON.stringify(body)).not.toContain("999.9");

    await app.close();
  });
});
