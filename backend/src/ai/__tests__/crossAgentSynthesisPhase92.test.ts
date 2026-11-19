import { describe, expect, it } from "vitest";
import { EvidenceRecord } from "../evidence/EvidenceSchema";
import { AgentExecutionResult } from "../orchestrator/AgentRegistry";
import { UnifiedIntelligenceContextBuilder } from "../context/UnifiedIntelligenceContextBuilder";
import { ConversationService } from "../conversation/ConversationService";

function makeRecord(overrides: Partial<EvidenceRecord> = {}): EvidenceRecord {
  const nowIso = "2026-11-14T10:00:00.000Z";
  return {
    evidenceId: "ev-default",
    symbol: "RELIANCE",
    category: "QUARTERLY_FINANCIALS",
    claim: "Return on Equity (ROE)",
    value: 18.5,
    unit: "%",
    currency: null,
    source: "NSE Official Filing",
    sourceTier: "OFFICIAL_EXCHANGE_OR_FILING",
    sourceClassification: "OFFICIAL_EXCHANGE",
    dataPeriod: "Q2 FY26",
    sourceUrl: "https://www.nseindia.com/filings/reliance",
    publishedAt: nowIso,
    retrievedAt: nowIso,
    freshness: "FRESH",
    verificationStatus: "VERIFIED",
    verificationMethod: "OFFICIAL_EXCHANGE_SIGNATURE",
    confidence: 0.95,
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
    latencyMs: 80,
    startTimestamp: "2026-11-14T09:59:59.920Z",
    completionTimestamp: "2026-11-14T10:00:00.000Z",
    providerUsed: "gemini",
    error: null,
    generatedAt: "2026-11-14T10:00:00.000Z",
    cached: false,
    cacheTimestamp: null,
    freshnessLabel: "FRESH",
    evidenceIds: ["ev-default"],
    evidenceRecords: [makeRecord()],
    missingInformation: [],
    conflictsCount: 0,
    summaryPayload: null,
    ...overrides,
  };
}

describe("Phase 9.2 — Cross-Agent Intelligence & Evidence-Based Research Synthesis", () => {
  const refDate = new Date("2026-11-14T10:00:30.000Z");

  it("1. Complete evidence context: evaluates all 5 alignment dimensions (including valid options), matrix, and conclusion", () => {
    const builder = new UnifiedIntelligenceContextBuilder();
    const ctx = builder.buildFromExecutions({
      userId: "user-1",
      symbol: "RELIANCE",
      referenceDate: refDate,
      executions: [
        makeExec({
          agentId: "company_research",
          evidenceRecords: [
            makeRecord({
              evidenceId: "ev-roe",
              category: "QUARTERLY_FINANCIALS",
              claim: "Return on Equity (ROE)",
              value: 19.2,
              unit: "%",
            }),
            makeRecord({
              evidenceId: "ev-rev-growth",
              category: "QUARTERLY_FINANCIALS",
              claim: "Quarterly Revenue Growth",
              value: 16.4,
              unit: "%",
            }),
          ],
        }),
        makeExec({
          agentId: "institutional_intelligence",
          evidenceRecords: [
            makeRecord({
              evidenceId: "ev-fii-flow",
              category: "INSTITUTIONAL_HOLDING",
              claim: "FII Net Flow Change",
              value: 1250,
              unit: "CR",
            }),
          ],
        }),
        makeExec({
          agentId: "market_intelligence",
          evidenceRecords: [
            makeRecord({
              evidenceId: "ev-vwap",
              category: "INTRADAY_PRICE",
              claim: "VWAP Position",
              value: "ABOVE_VWAP",
              unit: null,
            }),
          ],
        }),
        makeExec({
          agentId: "news_macro",
          evidenceRecords: [
            makeRecord({
              evidenceId: "ev-news-win",
              category: "COMPANY_ANNOUNCEMENT",
              claim: "Major Order Win Announcement",
              value: "Order win of 2500 CR",
              unit: null,
            }),
          ],
        }),
        makeExec({
          agentId: "options_intelligence",
          evidenceRecords: [
            makeRecord({
              evidenceId: "ev-pcr",
              category: "DAILY_MARKET_DATA",
              claim: "NIFTY Put-Call Ratio (PCR)",
              value: 1.22,
              unit: "RATIO",
            }),
          ],
        }),
      ],
    });

    const synth = ctx.crossAgentSynthesis!;
    expect(synth).toBeDefined();
    expect(synth.readOnly).toBe(true);
    expect(synth.alignments).toHaveLength(5);

    const alignA = synth.alignments.find(
      (a) => a.dimension === "FUNDAMENTAL_AND_INSTITUTIONAL"
    );
    const alignE = synth.alignments.find(
      (a) => a.dimension === "OPTIONS_AND_MARKET_DIRECTION"
    );
    expect(alignA?.status).toBe("ALIGNED_BULLISH");
    expect(alignA?.relationshipType).toBe("OBSERVED_CORRELATION");
    expect(alignA?.causationDisclaimer).toContain("not proven causation");
    expect(alignE?.status).toBe("ALIGNED_BULLISH");
    expect(alignE?.evidenceIds).toContain("ev-pcr");

    expect(synth.evidenceMatrix.directionalSummary).toBe("BULLISH_SKEW");
    expect(synth.evidenceMatrix.bullishEvidence.length).toBe(6);
    expect(synth.conclusion.overallEvidenceQuality).toBe("COMPLETE");
    expect(synth.conclusion.advisoryDisclaimer).toContain("READ-ONLY RESEARCH SYNTHESIS");
  });

  it("2. Partial context without options evidence marks Dimension E as NOT_APPLICABLE_NO_OPTIONS_EVIDENCE", () => {
    const builder = new UnifiedIntelligenceContextBuilder();
    const ctx = builder.buildFromExecutions({
      userId: "user-1",
      symbol: "TCS",
      referenceDate: refDate,
      executions: [
        makeExec({
          agentId: "company_research",
          evidenceRecords: [
            makeRecord({
              evidenceId: "ev-tcs-roe",
              symbol: "TCS",
              claim: "ROE",
              value: 45.5,
              unit: "%",
            }),
          ],
        }),
      ],
      skippedAgents: ["market_intelligence"],
    });

    const synth = ctx.crossAgentSynthesis!;
    const alignE = synth.alignments.find(
      (a) => a.dimension === "OPTIONS_AND_MARKET_DIRECTION"
    );
    expect(alignE?.status).toBe("NOT_APPLICABLE_NO_OPTIONS_EVIDENCE");
    expect(alignE?.evidenceIds).toHaveLength(0);
    expect(synth.conclusion.overallEvidenceQuality).toBe("PARTIAL");
    expect(
      synth.conclusion.explicitLimitations.some((l) =>
        l.includes("Skipped agent(s): market_intelligence")
      )
    ).toBe(true);
  });

  it("3. Contradictory bullish and bearish evidence produces DIVERGENT alignment and BALANCED_OR_MIXED matrix", () => {
    const builder = new UnifiedIntelligenceContextBuilder();
    const ctx = builder.buildFromExecutions({
      userId: "user-1",
      symbol: "RELIANCE",
      referenceDate: refDate,
      executions: [
        makeExec({
          agentId: "company_research",
          evidenceRecords: [
            makeRecord({
              evidenceId: "ev-bull-roe",
              claim: "ROE",
              value: 21.0,
              unit: "%",
            }),
          ],
        }),
        makeExec({
          agentId: "institutional_intelligence",
          evidenceRecords: [
            makeRecord({
              evidenceId: "ev-bear-fii",
              category: "INSTITUTIONAL_HOLDING",
              claim: "FII Net Flow",
              value: -850,
              unit: "CR",
            }),
          ],
        }),
      ],
    });

    const synth = ctx.crossAgentSynthesis!;
    const alignA = synth.alignments.find(
      (a) => a.dimension === "FUNDAMENTAL_AND_INSTITUTIONAL"
    );
    expect(alignA?.status).toBe("DIVERGENT");
    expect(alignA?.relationshipType).toBe("CAUSAL_UNPROVEN");
    expect(synth.evidenceMatrix.directionalSummary).toBe("BALANCED_OR_MIXED");
    expect(synth.conclusion.bullishArguments).toHaveLength(1);
    expect(synth.conclusion.bearishArguments).toHaveLength(1);
  });

  it("4. Conflicting financial evidence is isolated in conflictingEvidence and triggers CONFLICTING_OR_MISSING_EVIDENCE risk", () => {
    const builder = new UnifiedIntelligenceContextBuilder();
    const ctx = builder.buildFromExecutions({
      userId: "user-1",
      symbol: "RELIANCE",
      referenceDate: refDate,
      executions: [
        makeExec({
          agentId: "company_research",
          evidenceRecords: [
            makeRecord({
              evidenceId: "ev-rev-1",
              claim: "Quarterly Revenue",
              value: 240000,
              unit: "CR",
              source: "Yahoo Finance",
              verificationStatus: "UNVERIFIED",
            }),
            makeRecord({
              evidenceId: "ev-rev-2",
              claim: "Quarterly Revenue",
              value: 195000,
              unit: "CR",
              source: "Screener",
              verificationStatus: "UNVERIFIED",
            }),
          ],
        }),
      ],
    });

    const synth = ctx.crossAgentSynthesis!;
    expect(synth.evidenceMatrix.conflictingEvidence).toHaveLength(1);
    expect(synth.evidenceMatrix.directionalSummary).toBe("CONFLICTED");
    expect(synth.conclusion.unresolvedConflicts).toHaveLength(1);
    expect(
      synth.riskFindings.some(
        (r) => r.category === "CONFLICTING_OR_MISSING_EVIDENCE"
      )
    ).toBe(true);
  });

  it("5. Identifies all evidence-backed risk categories only when supported by actual evidence", () => {
    const builder = new UnifiedIntelligenceContextBuilder();
    const stalePubIso = "2026-11-10T10:00:00.000Z"; // > 72h old intraday/options -> EXPIRED

    const ctx = builder.buildFromExecutions({
      userId: "user-1",
      symbol: "RELIANCE",
      referenceDate: refDate,
      executions: [
        makeExec({
          agentId: "company_research",
          evidenceRecords: [
            makeRecord({
              evidenceId: "ev-neg-rev",
              claim: "Quarterly Revenue Growth",
              value: -8.5,
              unit: "%",
            }),
            makeRecord({
              evidenceId: "ev-high-debt",
              claim: "Debt to Equity",
              value: 2.4,
              unit: "RATIO",
            }),
            makeRecord({
              evidenceId: "ev-neg-ocf",
              claim: "Operating Cash Flow",
              value: -450,
              unit: "CR",
            }),
          ],
        }),
        makeExec({
          agentId: "institutional_intelligence",
          evidenceRecords: [
            makeRecord({
              evidenceId: "ev-inst-outflow",
              category: "INSTITUTIONAL_HOLDING",
              claim: "FII Net Flow",
              value: -1200,
              unit: "CR",
            }),
            makeRecord({
              evidenceId: "ev-high-pledge",
              category: "INSTITUTIONAL_HOLDING",
              claim: "Promoter Pledge",
              value: 28.5,
              unit: "%",
            }),
          ],
        }),
        makeExec({
          agentId: "news_macro",
          evidenceRecords: [
            makeRecord({
              evidenceId: "ev-neg-news",
              category: "THIRD_PARTY_NEWS",
              claim: "Regulatory penalty notice",
              value: "Penalty imposed by regulator",
              unit: null,
            }),
          ],
        }),
        makeExec({
          agentId: "market_intelligence",
          evidenceRecords: [
            makeRecord({
              evidenceId: "ev-high-vix",
              category: "INTRADAY_PRICE",
              claim: "India VIX",
              value: 23.4,
              unit: null,
            }),
          ],
        }),
        makeExec({
          agentId: "options_intelligence",
          evidenceRecords: [
            makeRecord({
              evidenceId: "ev-stale-opt",
              category: "INTRADAY_PRICE",
              claim: "NIFTY PCR Option Chain",
              value: 0.95,
              publishedAt: stalePubIso,
            }),
          ],
        }),
      ],
    });

    const categories = ctx.crossAgentSynthesis!.riskFindings.map((r) => r.category);
    expect(categories).toContain("FINANCIAL_DETERIORATION");
    expect(categories).toContain("DEBT_AND_LEVERAGE");
    expect(categories).toContain("CASH_FLOW_WEAKNESS");
    expect(categories).toContain("INSTITUTIONAL_SELLING");
    expect(categories).toContain("PROMOTER_PLEDGE");
    expect(categories).toContain("NEGATIVE_NEWS");
    expect(categories).toContain("MARKET_VOLATILITY");
    expect(categories).toContain("OPTIONS_LIQUIDITY_OR_FRESHNESS");
    expect(categories).toContain("CONFLICTING_OR_MISSING_EVIDENCE");
  });

  it("6. Historical comparison returns NO_HISTORICAL_CONTEXT when none exist, and COMPARED with metric deltas when persisted contexts exist", async () => {
    const builder = new UnifiedIntelligenceContextBuilder();
    const convService = new ConversationService({ forceInMemory: true });

    // First context at T1 -> no historical context exists yet
    const ctx1 = builder.buildFromExecutions({
      userId: "user-hist-1",
      symbol: "RELIANCE",
      referenceDate: new Date("2026-11-13T10:00:00.000Z"),
      executions: [
        makeExec({
          evidenceRecords: [
            makeRecord({
              evidenceId: "ev-t1-roe",
              claim: "Return on Equity (ROE)",
              value: 16.0,
              unit: "%",
              publishedAt: "2026-11-13T10:00:00.000Z",
              retrievedAt: "2026-11-13T10:00:00.000Z",
            }),
          ],
        }),
      ],
    });

    expect(ctx1.crossAgentSynthesis?.historicalComparison.status).toBe(
      "NO_HISTORICAL_CONTEXT"
    );

    // Persist ctx1 in ConversationService
    const conv = await convService.createConversation(
      "user-hist-1",
      "Reliance Research",
      "COMPANY_RESEARCH"
    );
    await convService.appendMessage("user-hist-1", conv.id, {
      role: "assistant",
      content: "Initial Reliance analysis",
      structuredResponse: { summary: "Initial" },
      unifiedContext: ctx1 as unknown as Record<string, unknown>,
    });

    // Retrieve previous contexts from ConversationService and build ctx2 at T2
    const previousContexts = await convService.findPreviousUnifiedContexts(
      "user-hist-1",
      "RELIANCE"
    );
    expect(previousContexts).toHaveLength(1);

    const ctx2 = builder.buildFromExecutions({
      userId: "user-hist-1",
      symbol: "RELIANCE",
      referenceDate: refDate,
      previousContexts,
      executions: [
        makeExec({
          evidenceRecords: [
            makeRecord({
              evidenceId: "ev-t2-roe",
              claim: "Return on Equity (ROE)",
              value: 18.5,
              unit: "%",
            }),
          ],
        }),
      ],
    });

    const hist = ctx2.crossAgentSynthesis!.historicalComparison;
    expect(hist.status).toBe("COMPARED");
    expect(hist.previousContextId).toBe(ctx1.contextId);
    expect(hist.metricDeltas).toHaveLength(1);
    expect(hist.metricDeltas[0].previousValue).toBe(16.0);
    expect(hist.metricDeltas[0].currentValue).toBe(18.5);
    expect(hist.metricDeltas[0].direction).toBe("INCREASED");
  });

  it("7. Handles free-tier provider exhaustion (all agents RATE_LIMITED) gracefully without fabricating claims", () => {
    const builder = new UnifiedIntelligenceContextBuilder();
    const ctx = builder.buildFromExecutions({
      userId: "user-1",
      symbol: "RELIANCE",
      referenceDate: refDate,
      executions: [
        makeExec({
          agentId: "company_research",
          status: "FAILED",
          errorCategory: "RATE_LIMITED",
          providerUsed: null,
          error: "Gemini and Groq free-tier rate limits reached.",
          evidenceIds: [],
          evidenceRecords: [],
        }),
      ],
    });

    const synth = ctx.crossAgentSynthesis!;
    expect(synth.evidenceMatrix.directionalSummary).toBe("INSUFFICIENT_EVIDENCE");
    expect(synth.evidenceMatrix.bullishEvidence).toHaveLength(0);
    expect(synth.evidenceMatrix.bearishEvidence).toHaveLength(0);
    expect(synth.conclusion.overallEvidenceQuality).toBe("INSUFFICIENT_DATA");
    expect(
      synth.conclusion.explicitLimitations.some((l) =>
        l.includes("Failed agent(s): company_research")
      )
    ).toBe(true);
  });
});

