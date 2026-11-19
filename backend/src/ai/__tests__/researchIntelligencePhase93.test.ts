import { describe, expect, it } from "vitest";
import { EvidenceRecord } from "../evidence/EvidenceSchema";
import { AgentExecutionResult } from "../orchestrator/AgentRegistry";
import { UnifiedIntelligenceContextBuilder } from "../context/UnifiedIntelligenceContextBuilder";
import { InstitutionalResearchIntelligenceService } from "../context/InstitutionalResearchIntelligenceService";
import {
  ResearchIntelligenceScorecard,
  ScorecardPillarKey,
} from "../context/ResearchIntelligenceScorecardSchema";

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
    currency: overrides.currency ?? null,
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
    latencyMs: 35,
    startTimestamp: "2026-11-14T08:00:00.000Z",
    completionTimestamp: "2026-11-14T08:00:00.035Z",
    providerUsed: "gemini",
    error: null,
    generatedAt: "2026-11-14T08:00:00.035Z",
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

function getPillar(scorecard: ResearchIntelligenceScorecard, key: ScorecardPillarKey) {
  const found = scorecard.pillars.find((p) => p.pillar === key);
  if (!found) throw new Error(`Missing pillar ${key}`);
  return found;
}

describe("Phase 9.3 — Institutional Research Intelligence & Decision Support", () => {
  const builder = new UnifiedIntelligenceContextBuilder();
  const service = new InstitutionalResearchIntelligenceService();
  const refDate = new Date("2026-11-14T08:05:00.000Z");

  it("1. Complete evidence produces a 6-pillar scorecard with evidence IDs and breakdowns", () => {
    const executions: AgentExecutionResult[] = [
      makeExec("company_research", [
        makeEvidence({
          id: "ev-rev",
          category: "QUARTERLY_FINANCIALS",
          claim: "Consolidated Quarterly Revenue Growth YoY",
          value: 15.2,
          unit: "%",
        }),
        makeEvidence({
          id: "ev-pat",
          category: "QUARTERLY_FINANCIALS",
          claim: "Consolidated Net Profit Growth YoY",
          value: 18.1,
          unit: "%",
        }),
        makeEvidence({
          id: "ev-ebitda",
          category: "QUARTERLY_FINANCIALS",
          claim: "Operating EBITDA Margin",
          value: 25.4,
          unit: "%",
        }),
        makeEvidence({
          id: "ev-de",
          category: "QUARTERLY_FINANCIALS",
          claim: "Debt to Equity Ratio",
          value: 0.08,
          unit: "x",
        }),
        makeEvidence({
          id: "ev-fcf",
          category: "QUARTERLY_FINANCIALS",
          claim: "Free Cash Flow",
          value: 11200,
          unit: "Cr",
        }),
      ]),
      makeExec("institutional_intelligence", [
        makeEvidence({
          id: "ev-fii-own",
          category: "INSTITUTIONAL_HOLDING",
          claim: "FII Ownership Holding",
          value: 24.5,
          unit: "%",
        }),
        makeEvidence({
          id: "ev-fii-flow",
          category: "INSTITUTIONAL_HOLDING",
          claim: "FII Net Flow QoQ Change",
          value: 1.3,
          unit: "%",
        }),
        makeEvidence({
          id: "ev-pledge",
          category: "INSTITUTIONAL_HOLDING",
          claim: "Promoter Pledge Percentage",
          value: 0,
          unit: "%",
        }),
      ]),
      makeExec("market_intelligence", [
        makeEvidence({
          id: "ev-mkt-trend",
          category: "DAILY_MARKET_DATA",
          claim: "Nifty 50 Index Trend and Market Regime",
          value: "Bullish expansion above VWAP",
          unit: null,
        }),
        makeEvidence({
          id: "ev-vix",
          category: "DAILY_MARKET_DATA",
          claim: "India VIX Volatility Index",
          value: 12.8,
          unit: "pts",
        }),
      ]),
      makeExec("news_macro", [
        makeEvidence({
          id: "ev-news",
          category: "COMPANY_ANNOUNCEMENT",
          claim: "Order Book Deal Win Announcement",
          value: "Strong multi-year contract upgrade",
          unit: null,
        }),
      ]),
    ];

    const context = builder.buildFromExecutions({
      userId: "user-93-1",
      symbol: "TCS",
      companyName: "Tata Consultancy Services Ltd",
      requestedPeriod: "Q2FY27",
      referenceDate: refDate,
      executions,
    });

    const scorecard = context.researchScorecard!;
    expect(scorecard).toBeDefined();
    expect(scorecard.overallStatus).toBe("COMPLETE");
    expect(scorecard.pillars).toHaveLength(6);

    const fund = getPillar(scorecard, "FUNDAMENTAL_QUALITY");
    expect(fund.assessment).toBe("STRONG");
    expect(fund.supportingEvidenceIds).toContain("ev-rev");
    expect(fund.fundamentalBreakdown?.reportingBasis).toBe("CONSOLIDATED");
    expect(fund.fundamentalBreakdown?.reportingPeriodCompatibility).toBe("COMPATIBLE");

    const inst = getPillar(scorecard, "INSTITUTIONAL_ACTIVITY");
    expect(inst.assessment).toBe("STRONG");
    expect(inst.institutionalBreakdown?.hasExplicitFlowData).toBe(true);

    const mkt = getPillar(scorecard, "MARKET_ALIGNMENT");
    expect(["STRONG", "CONSTRUCTIVE"]).toContain(mkt.assessment);

    const news = getPillar(scorecard, "NEWS_AND_MACRO_ENVIRONMENT");
    expect(["STRONG", "CONSTRUCTIVE"]).toContain(news.assessment);

    const eq = getPillar(scorecard, "EVIDENCE_QUALITY");
    expect(eq.assessment).toBe("STRONG");
  });

  it("2. Partial evidence marks missing pillars as INSUFFICIENT_DATA and overallStatus as PARTIAL", () => {
    const context = builder.buildFromExecutions({
      userId: "user-93-2",
      symbol: "INFY",
      referenceDate: refDate,
      executions: [
        makeExec(
          "company_research",
          [
            makeEvidence({
              id: "ev-infy-rev",
              symbol: "INFY",
              category: "QUARTERLY_FINANCIALS",
              claim: "Quarterly Revenue Growth YoY",
              value: 11.4,
            }),
          ],
          ["Institutional holdings unavailable", "News feed unavailable"]
        ),
      ],
      skippedAgents: ["institutional_intelligence", "news_macro"],
    });

    const scorecard = context.researchScorecard!;
    expect(scorecard.overallStatus).toBe("PARTIAL");
    expect(getPillar(scorecard, "FUNDAMENTAL_QUALITY").assessment).toBe("CONSTRUCTIVE");
    expect(getPillar(scorecard, "INSTITUTIONAL_ACTIVITY").assessment).toBe("INSUFFICIENT_DATA");
    expect(getPillar(scorecard, "NEWS_AND_MACRO_ENVIRONMENT").assessment).toBe(
      "INSUFFICIENT_DATA"
    );
  });

  it("3. Conflicting financial data marks FUNDAMENTAL_QUALITY as CONFLICTED and emits EVIDENCE_CONFLICTS risk", () => {
    const context = builder.buildFromExecutions({
      userId: "user-93-3",
      symbol: "WIPRO",
      referenceDate: refDate,
      executions: [
        makeExec("company_research", [
          makeEvidence({
            id: "ev-wipro-1",
            symbol: "WIPRO",
            category: "QUARTERLY_FINANCIALS",
            claim: "Quarterly Revenue Growth YoY",
            value: 14.0,
            source: "NSE Official Filing",
          }),
          makeEvidence({
            id: "ev-wipro-2",
            symbol: "WIPRO",
            category: "QUARTERLY_FINANCIALS",
            claim: "Quarterly Revenue Growth YoY",
            value: -6.5,
            source: "Secondary Aggregator",
            sourceTier: "INSTITUTIONAL_DATA_FEED",
            sourceClassification: "VERIFIED_FINANCIAL_PROVIDER",
          }),
        ]),
      ],
    });

    const scorecard = context.researchScorecard!;
    const fund = getPillar(scorecard, "FUNDAMENTAL_QUALITY");
    expect(fund.assessment).toBe("CONFLICTED");
    expect(fund.conflicts.length).toBeGreaterThan(0);
    expect(scorecard.supportedRisks.some((r) => r.category === "EVIDENCE_CONFLICTS")).toBe(true);
  });

  it("4. Missing evidence never assumes zero risk and emits MISSING_OR_STALE_INFORMATION risk", () => {
    const context = builder.buildFromExecutions({
      userId: "user-93-4",
      symbol: "FORCEMOT",
      referenceDate: refDate,
      executions: [
        makeExec("company_research", [], ["Fundamentals unavailable", "Cash flow unavailable"]),
      ],
    });

    const scorecard = context.researchScorecard!;
    expect(scorecard.overallStatus).toBe("INSUFFICIENT_DATA");
    expect(getPillar(scorecard, "FUNDAMENTAL_QUALITY").assessment).toBe("INSUFFICIENT_DATA");
    expect(getPillar(scorecard, "FINANCIAL_RISK").assessment).not.toBe("STRONG");
    const missingRisk = scorecard.supportedRisks.find(
      (r) => r.category === "MISSING_OR_STALE_INFORMATION"
    );
    expect(missingRisk).toBeDefined();
    expect(missingRisk?.missingDataNotAssumedZeroRisk).toBe(true);
  });

  it("5. Stale evidence populates pillar freshnessLimitations and degrades EVIDENCE_QUALITY", () => {
    const oldIso = "2025-01-01T00:00:00.000Z";
    const context = builder.buildFromExecutions({
      userId: "user-93-5",
      symbol: "SBIN",
      referenceDate: refDate,
      executions: [
        makeExec("company_research", [
          makeEvidence({
            id: "ev-sbin-stale",
            symbol: "SBIN",
            category: "QUARTERLY_FINANCIALS",
            claim: "Quarterly Revenue Growth YoY",
            value: 12.5,
            publishedAt: oldIso,
            retrievedAt: oldIso,
          }),
        ]),
      ],
    });

    const scorecard = context.researchScorecard!;
    expect(
      getPillar(scorecard, "FUNDAMENTAL_QUALITY").freshnessLimitations.length
    ).toBeGreaterThan(0);
    expect(["WEAK", "MIXED"]).toContain(getPillar(scorecard, "EVIDENCE_QUALITY").assessment);
    expect(
      scorecard.supportedRisks.some((r) => r.category === "MISSING_OR_STALE_INFORMATION")
    ).toBe(true);
  });

  it("6. Incompatible reporting periods are rejected and surfaced in fundamentalBreakdown and limitations", () => {
    const context = builder.buildFromExecutions({
      userId: "user-93-6",
      symbol: "ITC",
      requestedPeriod: "Q2FY27",
      referenceDate: refDate,
      executions: [
        makeExec("company_research", [
          makeEvidence({
            id: "ev-itc-q2",
            symbol: "ITC",
            category: "QUARTERLY_FINANCIALS",
            claim: "Quarterly Revenue Growth YoY",
            value: 11.2,
            dataPeriod: "Q2FY27",
            metadata: { basis: "CONSOLIDATED", dataPeriod: "Q2FY27" },
          }),
          makeEvidence({
            id: "ev-itc-q4-old",
            symbol: "ITC",
            category: "QUARTERLY_FINANCIALS",
            claim: "Operating EBITDA Margin",
            value: 34.0,
            dataPeriod: "Q4FY25",
            metadata: { basis: "CONSOLIDATED", dataPeriod: "Q4FY25" },
          }),
        ]),
      ],
    });

    const scorecard = context.researchScorecard!;
    const fund = getPillar(scorecard, "FUNDAMENTAL_QUALITY");
    expect(fund.fundamentalBreakdown?.reportingPeriodCompatibility).toBe(
      "INCOMPATIBLE_PERIODS_DETECTED"
    );
    expect(
      scorecard.researchLimitations.some((l) => l.includes("incompatible reporting period"))
    ).toBe(true);
  });

  it("7. Institutional flow vs static ownership distinction: static holding % never implies accumulation", () => {
    const staticOnlyContext = builder.buildFromExecutions({
      userId: "user-93-7",
      symbol: "HDFCBANK",
      referenceDate: refDate,
      executions: [
        makeExec("institutional_intelligence", [
          makeEvidence({
            id: "ev-hdfc-fii-static",
            symbol: "HDFCBANK",
            category: "INSTITUTIONAL_HOLDING",
            claim: "FII Shareholding Percentage",
            value: 42.8,
            unit: "%",
          }),
          makeEvidence({
            id: "ev-hdfc-dii-static",
            symbol: "HDFCBANK",
            category: "INSTITUTIONAL_HOLDING",
            claim: "DII Ownership Percentage",
            value: 28.4,
            unit: "%",
          }),
        ]),
      ],
    });

    const staticPillar = getPillar(
      staticOnlyContext.researchScorecard!,
      "INSTITUTIONAL_ACTIVITY"
    );
    expect(staticPillar.institutionalBreakdown?.hasExplicitFlowData).toBe(false);
    expect(staticPillar.supportingEvidenceIds).toHaveLength(0);
    expect(staticPillar.assessment).toBe("MIXED");
    expect(staticPillar.explanation).toContain(
      "active institutional buying/accumulation is NEVER inferred from static ownership levels alone"
    );

    // Also verify CrossAgentResearchSynthesizer does not put static FII % into bullishEvidence
    const bullishIds =
      staticOnlyContext.crossAgentSynthesis!.evidenceMatrix.bullishEvidence.map(
        (b) => b.evidenceId
      );
    expect(bullishIds).not.toContain("ev-hdfc-fii-static");
  });

  it("8. Research ranking ranks comparable companies and refuses to rank incomparable/conflicted/insufficient peers", () => {
    const peerStrong = builder.buildFromExecutions({
      userId: "user-93-8",
      symbol: "TCS",
      requestedPeriod: "Q2FY27",
      referenceDate: refDate,
      executions: [
        makeExec("company_research", [
          makeEvidence({
            id: "ev-tcs-rev",
            symbol: "TCS",
            category: "QUARTERLY_FINANCIALS",
            claim: "Consolidated Revenue Growth YoY",
            value: 16.0,
            dataPeriod: "Q2FY27",
            metadata: { basis: "CONSOLIDATED", dataPeriod: "Q2FY27" },
          }),
          makeEvidence({
            id: "ev-tcs-pat",
            symbol: "TCS",
            category: "QUARTERLY_FINANCIALS",
            claim: "Consolidated Profit Growth YoY",
            value: 19.0,
            dataPeriod: "Q2FY27",
            metadata: { basis: "CONSOLIDATED", dataPeriod: "Q2FY27" },
          }),
        ]),
        makeExec("institutional_intelligence", [
          makeEvidence({
            id: "ev-tcs-flow",
            symbol: "TCS",
            category: "INSTITUTIONAL_HOLDING",
            claim: "FII Net Buying Flow QoQ",
            value: 1.5,
            dataPeriod: "Q2FY27",
          }),
        ]),
      ],
    });

    const peerModerate = builder.buildFromExecutions({
      userId: "user-93-8",
      symbol: "HCLTECH",
      requestedPeriod: "Q2FY27",
      referenceDate: refDate,
      executions: [
        makeExec("company_research", [
          makeEvidence({
            id: "ev-hcl-rev",
            symbol: "HCLTECH",
            category: "QUARTERLY_FINANCIALS",
            claim: "Consolidated Revenue Growth YoY",
            value: 12.0,
            dataPeriod: "Q2FY27",
            metadata: { basis: "CONSOLIDATED", dataPeriod: "Q2FY27" },
          }),
          makeEvidence({
            id: "ev-hcl-pat",
            symbol: "HCLTECH",
            category: "QUARTERLY_FINANCIALS",
            claim: "Consolidated Profit Growth YoY",
            value: 11.5,
            dataPeriod: "Q2FY27",
            metadata: { basis: "CONSOLIDATED", dataPeriod: "Q2FY27" },
          }),
        ]),
      ],
    });

    const peerStandaloneMismatch = builder.buildFromExecutions({
      userId: "user-93-8",
      symbol: "TECHM",
      requestedPeriod: "Q2FY27",
      referenceDate: refDate,
      executions: [
        makeExec("company_research", [
          makeEvidence({
            id: "ev-techm-rev",
            symbol: "TECHM",
            category: "QUARTERLY_FINANCIALS",
            claim: "Standalone Revenue Growth YoY",
            value: 14.0,
            dataPeriod: "Q2FY27",
            metadata: { basis: "STANDALONE", dataPeriod: "Q2FY27" },
          }),
          makeEvidence({
            id: "ev-techm-pat",
            symbol: "TECHM",
            category: "QUARTERLY_FINANCIALS",
            claim: "Standalone Profit Growth YoY",
            value: 13.0,
            dataPeriod: "Q2FY27",
            metadata: { basis: "STANDALONE", dataPeriod: "Q2FY27" },
          }),
        ]),
      ],
    });

    const peerPeriodMismatch = builder.buildFromExecutions({
      userId: "user-93-8",
      symbol: "MPHASIS",
      requestedPeriod: "Q1FY27",
      referenceDate: refDate,
      executions: [
        makeExec("company_research", [
          makeEvidence({
            id: "ev-mphasis-rev",
            symbol: "MPHASIS",
            category: "QUARTERLY_FINANCIALS",
            claim: "Consolidated Revenue Growth YoY",
            value: 13.0,
            dataPeriod: "Q1FY27",
            metadata: { basis: "CONSOLIDATED", dataPeriod: "Q1FY27" },
          }),
          makeEvidence({
            id: "ev-mphasis-pat",
            symbol: "MPHASIS",
            category: "QUARTERLY_FINANCIALS",
            claim: "Consolidated Profit Growth YoY",
            value: 12.0,
            dataPeriod: "Q1FY27",
            metadata: { basis: "CONSOLIDATED", dataPeriod: "Q1FY27" },
          }),
        ]),
      ],
    });

    const peerInsufficient = builder.buildFromExecutions({
      userId: "user-93-8",
      symbol: "LTIM",
      requestedPeriod: "Q2FY27",
      referenceDate: refDate,
      executions: [makeExec("company_research", [], ["No data"])],
    });

    const ranking = service.rankCompanies([
      peerModerate,
      peerStrong,
      peerStandaloneMismatch,
      peerPeriodMismatch,
      peerInsufficient,
    ]);

    expect(ranking.rankedCompanies.map((r) => r.symbol)).toEqual(["TCS", "HCLTECH"]);
    expect(ranking.rankedCompanies[0].rank).toBe(1);
    expect(ranking.rankedCompanies[1].rank).toBe(2);

    const unrankedSymbols = ranking.unrankedCompanies.map((u) => u.symbol);
    expect(unrankedSymbols).toContain("TECHM");
    expect(unrankedSymbols).toContain("MPHASIS");
    expect(unrankedSymbols).toContain("LTIM");
  });

  it("9. Historical context tracks improved/deteriorated evidence and resolved/new conflicts when available, and returns NO_HISTORICAL_CONTEXT when unavailable", () => {
    const previousContext = builder.buildFromExecutions({
      userId: "user-93-9",
      symbol: "RELIANCE",
      requestedAt: "2026-11-10T08:00:00.000Z",
      referenceDate: new Date("2026-11-10T08:05:00.000Z"),
      executions: [
        makeExec("company_research", [
          makeEvidence({
            id: "ev-rel-rev-prev",
            symbol: "RELIANCE",
            category: "QUARTERLY_FINANCIALS",
            claim: "Quarterly Revenue Growth YoY",
            value: 8.0,
            unit: "%",
          }),
          makeEvidence({
            id: "ev-rel-de-prev",
            symbol: "RELIANCE",
            category: "QUARTERLY_FINANCIALS",
            claim: "Debt to Equity Ratio",
            value: 0.4,
            unit: "x",
          }),
          makeEvidence({
            id: "ev-rel-conf-1",
            symbol: "RELIANCE",
            category: "QUARTERLY_FINANCIALS",
            claim: "EBITDA Margin",
            value: 15.0,
            source: "NSE Official Filing",
          }),
          makeEvidence({
            id: "ev-rel-conf-2",
            symbol: "RELIANCE",
            category: "QUARTERLY_FINANCIALS",
            claim: "EBITDA Margin",
            value: 22.0,
            source: "Aggregator",
            sourceTier: "INSTITUTIONAL_DATA_FEED",
            sourceClassification: "VERIFIED_FINANCIAL_PROVIDER",
          }),
        ]),
      ],
    });

    expect(previousContext.researchScorecard!.historicalChanges.status).toBe(
      "NO_HISTORICAL_CONTEXT"
    );

    const currentContext = builder.buildFromExecutions({
      userId: "user-93-9",
      symbol: "RELIANCE",
      requestedAt: "2026-11-14T08:00:00.000Z",
      referenceDate: refDate,
      previousContexts: [previousContext],
      executions: [
        makeExec(
          "company_research",
          [
            makeEvidence({
              id: "ev-rel-rev-curr",
              symbol: "RELIANCE",
              category: "QUARTERLY_FINANCIALS",
              claim: "Quarterly Revenue Growth YoY",
              value: 14.5,
              unit: "%",
            }),
            makeEvidence({
              id: "ev-rel-de-curr",
              symbol: "RELIANCE",
              category: "QUARTERLY_FINANCIALS",
              claim: "Debt to Equity Ratio",
              value: 0.9,
              unit: "x",
            }),
            makeEvidence({
              id: "ev-rel-ebitda-clean",
              symbol: "RELIANCE",
              category: "QUARTERLY_FINANCIALS",
              claim: "EBITDA Margin",
              value: 18.2,
              source: "NSE Official Filing",
            }),
          ],
          ["Quarterly cash flow statement delayed"]
        ),
      ],
    });

    const hist = currentContext.researchScorecard!.historicalChanges;
    expect(hist.status).toBe("COMPARED");
    expect(hist.previousContextId).toBe(previousContext.contextId);
    expect(hist.improvedEvidence.some((e) => e.claim === "Quarterly Revenue Growth YoY")).toBe(
      true
    );
    expect(hist.deterioratedEvidence.some((e) => e.claim === "Debt to Equity Ratio")).toBe(true);
    expect(hist.resolvedConflicts.length).toBeGreaterThan(0);
    expect(hist.newMissingInformation).toContain("Quarterly cash flow statement delayed");
  });

  it("10. No fabricated scoring, arbitrary percentages, price targets, or execution signals", () => {
    const context = builder.buildFromExecutions({
      userId: "user-93-10",
      symbol: "TCS",
      referenceDate: refDate,
      executions: [
        makeExec("company_research", [
          makeEvidence({
            id: "ev-tcs-10",
            symbol: "TCS",
            category: "QUARTERLY_FINANCIALS",
            claim: "Quarterly Revenue Growth YoY",
            value: 13.0,
          }),
        ]),
      ],
    });

    const serialized = JSON.stringify(context.researchScorecard);
    expect(serialized).not.toMatch(/priceTarget|targetPrice|guaranteedReturn|confidenceScore/i);
    for (const pillar of context.researchScorecard!.pillars) {
      expect(pillar).not.toHaveProperty("score");
      expect(pillar).not.toHaveProperty("percentageScore");
      expect(pillar).not.toHaveProperty("confidence");
    }
  });
});
