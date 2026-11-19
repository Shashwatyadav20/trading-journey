import { describe, expect, it } from "vitest";
import { EvidenceRecord } from "../evidence/EvidenceSchema";
import { AgentExecutionResult } from "../orchestrator/AgentRegistry";
import { UnifiedIntelligenceContextBuilder } from "../context/UnifiedIntelligenceContextBuilder";

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
  missingInformation: string[] = [],
  status: AgentExecutionResult["status"] = "SUCCEEDED",
  errorCategory: AgentExecutionResult["errorCategory"] = "SUCCESS",
  error: string | null = null
): AgentExecutionResult {
  return {
    agentId,
    status,
    errorCategory,
    latencyMs: 35,
    startTimestamp: "2026-11-14T08:00:00.000Z",
    completionTimestamp: "2026-11-14T08:00:00.035Z",
    providerUsed: status === "SUCCEEDED" ? "gemini" : null,
    error,
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

describe("Phase 9.4 — Institutional Decision Intelligence & Research Brief", () => {
  const builder = new UnifiedIntelligenceContextBuilder();
  const refDate = new Date("2026-11-14T08:05:00.000Z");

  it("1. Produces all six conclusion classifications deterministically (POSITIVE, CAUTIOUSLY_POSITIVE, NEUTRAL, CAUTIOUSLY_NEGATIVE, NEGATIVE, INSUFFICIENT_EVIDENCE)", () => {
    // 1A: POSITIVE + HIGH confidence
    const positiveCtx = builder.buildFromExecutions({
      userId: "user-94-1",
      symbol: "TCS",
      requestedPeriod: "Q2FY27",
      referenceDate: refDate,
      executions: [
        makeExec("company_research", [
          makeEvidence({
            id: "ev-pos-rev",
            claim: "Consolidated Quarterly Revenue Growth YoY",
            value: 16.5,
          }),
          makeEvidence({
            id: "ev-pos-pat",
            claim: "Consolidated Net Profit Growth YoY",
            value: 19.2,
          }),
          makeEvidence({
            id: "ev-pos-ebitda",
            claim: "Operating EBITDA Margin",
            value: 26.1,
          }),
          makeEvidence({
            id: "ev-pos-de",
            claim: "Debt to Equity Ratio",
            value: 0.05,
            unit: "x",
          }),
          makeEvidence({
            id: "ev-pos-fcf",
            claim: "Free Cash Flow",
            value: 12500,
            unit: "Cr",
          }),
        ]),
        makeExec("institutional_intelligence", [
          makeEvidence({
            id: "ev-pos-fii-flow",
            category: "INSTITUTIONAL_HOLDING",
            claim: "FII Net Flow QoQ Change",
            value: 1.8,
          }),
          makeEvidence({
            id: "ev-pos-pledge",
            category: "INSTITUTIONAL_HOLDING",
            claim: "Promoter Pledge Percentage",
            value: 0,
          }),
        ]),
        makeExec("market_intelligence", [
          makeEvidence({
            id: "ev-pos-mkt",
            category: "DAILY_MARKET_DATA",
            claim: "Nifty 50 Index Trend",
            value: "Bullish expansion above VWAP",
            unit: null,
          }),
        ]),
      ],
    });
    expect(positiveCtx.researchBrief!.conclusion).toBe("POSITIVE");
    expect(positiveCtx.researchBrief!.confidenceClassification).toBe("HIGH");

    // 1B: CAUTIOUSLY_POSITIVE + MODERATE confidence (constructive fundamentals, missing secondary data)
    const cautiouslyPosCtx = builder.buildFromExecutions({
      userId: "user-94-1",
      symbol: "INFY",
      referenceDate: refDate,
      executions: [
        makeExec(
          "company_research",
          [
            makeEvidence({
              id: "ev-cpos-rev",
              symbol: "INFY",
              claim: "Consolidated Quarterly Revenue Growth YoY",
              value: 13.4,
            }),
            makeEvidence({
              id: "ev-cpos-pat",
              symbol: "INFY",
              claim: "Consolidated Net Profit Growth YoY",
              value: 14.1,
            }),
          ],
          ["Institutional flow data unavailable", "Sector news feed delayed"]
        ),
      ],
      skippedAgents: ["institutional_intelligence", "news_macro"],
    });
    expect(cautiouslyPosCtx.researchBrief!.conclusion).toBe("CAUTIOUSLY_POSITIVE");
    expect(cautiouslyPosCtx.researchBrief!.confidenceClassification).toBe("MODERATE");

    // 1C: NEUTRAL (static ownership only / balanced bullish & bearish)
    const neutralCtx = builder.buildFromExecutions({
      userId: "user-94-1",
      symbol: "HDFCBANK",
      referenceDate: refDate,
      executions: [
        makeExec("company_research", [
          makeEvidence({
            id: "ev-neu-rev",
            symbol: "HDFCBANK",
            claim: "Quarterly Revenue Growth YoY",
            value: 12.0,
          }),
          makeEvidence({
            id: "ev-neu-pat",
            symbol: "HDFCBANK",
            claim: "Quarterly Net Profit Growth YoY",
            value: -4.5,
          }),
        ]),
      ],
    });
    expect(neutralCtx.researchBrief!.conclusion).toBe("NEUTRAL");

    // 1D: CAUTIOUSLY_NEGATIVE (bearish skew / elevated risk without full fundamental collapse)
    const cautiouslyNegCtx = builder.buildFromExecutions({
      userId: "user-94-1",
      symbol: "TECHM",
      referenceDate: refDate,
      executions: [
        makeExec("company_research", [
          makeEvidence({
            id: "ev-cneg-rev",
            symbol: "TECHM",
            claim: "Quarterly Revenue Growth YoY",
            value: 11.0,
          }),
          makeEvidence({
            id: "ev-cneg-pat",
            symbol: "TECHM",
            claim: "Quarterly Net Profit Growth YoY",
            value: -3.2,
          }),
        ]),
        makeExec("market_intelligence", [
          makeEvidence({
            id: "ev-cneg-vix",
            symbol: "TECHM",
            category: "DAILY_MARKET_DATA",
            claim: "India VIX Volatility Index",
            value: 24.5,
            unit: "pts",
          }),
        ]),
      ],
    });
    expect(cautiouslyNegCtx.researchBrief!.conclusion).toBe("CAUTIOUSLY_NEGATIVE");

    // 1E: NEGATIVE (weak fundamentals + high-severity financial risk)
    const negativeCtx = builder.buildFromExecutions({
      userId: "user-94-1",
      symbol: "IDEA",
      referenceDate: refDate,
      executions: [
        makeExec("company_research", [
          makeEvidence({
            id: "ev-neg-rev",
            symbol: "IDEA",
            claim: "Quarterly Revenue Growth YoY",
            value: -8.5,
          }),
          makeEvidence({
            id: "ev-neg-de",
            symbol: "IDEA",
            claim: "Debt to Equity Ratio",
            value: 3.4,
            unit: "x",
          }),
          makeEvidence({
            id: "ev-neg-fcf",
            symbol: "IDEA",
            claim: "Operating Cash Flow",
            value: -1400,
            unit: "Cr",
          }),
        ]),
      ],
    });
    expect(negativeCtx.researchBrief!.conclusion).toBe("NEGATIVE");

    // 1F: INSUFFICIENT_EVIDENCE + INSUFFICIENT confidence
    const insufficientCtx = builder.buildFromExecutions({
      userId: "user-94-1",
      symbol: "FORCEMOT",
      referenceDate: refDate,
      executions: [
        makeExec("company_research", [], ["Fundamentals unavailable"]),
      ],
    });
    expect(insufficientCtx.researchBrief!.conclusion).toBe("INSUFFICIENT_EVIDENCE");
    expect(insufficientCtx.researchBrief!.confidenceClassification).toBe("INSUFFICIENT");
  });

  it("2. Conflicted fundamental evidence prevents any positive conclusion and sets LOW confidence", () => {
    const ctx = builder.buildFromExecutions({
      userId: "user-94-2",
      symbol: "WIPRO",
      referenceDate: refDate,
      executions: [
        makeExec("company_research", [
          makeEvidence({
            id: "ev-conf-1",
            symbol: "WIPRO",
            claim: "Quarterly Revenue Growth YoY",
            value: 15.0,
            source: "NSE Official Filing",
          }),
          makeEvidence({
            id: "ev-conf-2",
            symbol: "WIPRO",
            claim: "Quarterly Revenue Growth YoY",
            value: -4.0,
            source: "Secondary Feed",
            sourceTier: "INSTITUTIONAL_DATA_FEED",
            sourceClassification: "VERIFIED_FINANCIAL_PROVIDER",
          }),
          makeEvidence({
            id: "ev-conf-pat",
            symbol: "WIPRO",
            claim: "Net Profit Growth YoY",
            value: 18.0,
          }),
        ]),
      ],
    });

    const brief = ctx.researchBrief!;
    expect(brief.fundamentalAssessment.assessment).toBe("CONFLICTED");
    expect(["POSITIVE", "CAUTIOUSLY_POSITIVE"]).not.toContain(brief.conclusion);
    expect(brief.confidenceClassification).toBe("LOW");
    expect(brief.unresolvedConflicts.length).toBeGreaterThan(0);
  });

  it("3. Missing and stale evidence are never interpreted as positive and degrade confidence to LOW", () => {
    const staleIso = "2025-01-01T00:00:00.000Z";
    const ctx = builder.buildFromExecutions({
      userId: "user-94-3",
      symbol: "SBIN",
      referenceDate: refDate,
      executions: [
        makeExec(
          "company_research",
          [
            makeEvidence({
              id: "ev-stale-1",
              symbol: "SBIN",
              claim: "Quarterly Revenue Growth YoY",
              value: 14.0,
              publishedAt: staleIso,
              retrievedAt: staleIso,
            }),
            makeEvidence({
              id: "ev-stale-2",
              symbol: "SBIN",
              claim: "Net Profit Growth YoY",
              value: 15.0,
              publishedAt: staleIso,
              retrievedAt: staleIso,
            }),
          ],
          ["Cash flow disclosure unavailable"]
        ),
      ],
    });

    const brief = ctx.researchBrief!;
    expect(brief.confidenceClassification).toBe("LOW");
    expect(brief.missingInformation).toContain("Cash flow disclosure unavailable");
    expect(brief.bullishEvidence[0].limitations.some((l) => l.includes("EXPIRED") || l.includes("STALE"))).toBe(true);
  });

  it("4. Bullish/bearish conflicts are surfaced separately with observedFact, interpretation, and correlation/causation limitation", () => {
    const ctx = builder.buildFromExecutions({
      userId: "user-94-4",
      symbol: "MARUTI",
      referenceDate: refDate,
      executions: [
        makeExec("company_research", [
          makeEvidence({
            id: "ev-mar-bull",
            symbol: "MARUTI",
            claim: "Quarterly Revenue Growth YoY",
            value: 16.2,
          }),
          makeEvidence({
            id: "ev-mar-bear",
            symbol: "MARUTI",
            claim: "Operating EBITDA Margin",
            value: 6.1,
          }),
        ]),
      ],
    });

    const brief = ctx.researchBrief!;
    expect(brief.conclusion).toBe("NEUTRAL");
    expect(brief.bullishEvidence).toHaveLength(1);
    expect(brief.bearishEvidence).toHaveLength(1);
    expect(brief.bullishEvidence[0].observedFact).toContain("Observed Quarterly Revenue Growth YoY");
    expect(brief.bullishEvidence[0].interpretation).toContain("Analytical interpretation (BULLISH)");
    expect(
      brief.bullishEvidence[0].limitations.some((l) =>
        l.includes("causal relationship to future price performance is unproven")
      )
    ).toBe(true);
    expect(
      brief.researchLimitations.some((l) =>
        l.includes("Directional divergence present")
      )
    ).toBe(true);
  });

  it("5. Static institutional ownership percentage never implies accumulation or positive conclusion", () => {
    const ctx = builder.buildFromExecutions({
      userId: "user-94-5",
      symbol: "AXISBANK",
      referenceDate: refDate,
      executions: [
        makeExec("institutional_intelligence", [
          makeEvidence({
            id: "ev-axis-fii",
            symbol: "AXISBANK",
            category: "INSTITUTIONAL_HOLDING",
            claim: "FII Shareholding Percentage",
            value: 46.5,
          }),
          makeEvidence({
            id: "ev-axis-dii",
            symbol: "AXISBANK",
            category: "INSTITUTIONAL_HOLDING",
            claim: "DII Ownership Percentage",
            value: 31.2,
          }),
        ]),
      ],
    });

    const brief = ctx.researchBrief!;
    expect(brief.conclusion).toBe("NEUTRAL");
    expect(brief.bullishEvidence).toHaveLength(0);
    expect(brief.neutralEvidence).toHaveLength(2);
    expect(
      brief.neutralEvidence[0].limitations.some((l) =>
        l.includes("static shareholding percentage snapshot")
      )
    ).toBe(true);
  });

  it("6. Agent execution failures degrade confidence to LOW and record agent failure in limitations", () => {
    const ctx = builder.buildFromExecutions({
      userId: "user-94-6",
      symbol: "LT",
      referenceDate: refDate,
      executions: [
        makeExec("company_research", [
          makeEvidence({
            id: "ev-lt-rev",
            symbol: "LT",
            claim: "Quarterly Revenue Growth YoY",
            value: 14.2,
          }),
          makeEvidence({
            id: "ev-lt-pat",
            symbol: "LT",
            claim: "Net Profit Growth YoY",
            value: 16.0,
          }),
        ]),
        makeExec(
          "institutional_intelligence",
          [],
          [],
          "FAILED",
          "PROVIDER_TIMEOUT",
          "Provider timed out"
        ),
      ],
    });

    const brief = ctx.researchBrief!;
    expect(brief.confidenceClassification).toBe("LOW");
    expect(brief.confidenceExplanation).toContain("1 agent execution failure(s)");
    expect(
      brief.researchLimitations.some((l) =>
        l.includes("specialist agent(s) failed during execution")
      )
    ).toBe(true);
  });

  it("7. Historical context availability & strict user ownership isolation", () => {
    const prevOwned = builder.buildFromExecutions({
      userId: "user-owner",
      symbol: "RELIANCE",
      requestedAt: "2026-11-10T08:00:00.000Z",
      referenceDate: new Date("2026-11-10T08:05:00.000Z"),
      executions: [
        makeExec("company_research", [
          makeEvidence({
            id: "ev-rel-prev",
            symbol: "RELIANCE",
            claim: "Quarterly Revenue Growth YoY",
            value: 9.0,
          }),
        ]),
      ],
    });

    const prevOtherUser = builder.buildFromExecutions({
      userId: "user-intruder",
      symbol: "RELIANCE",
      requestedAt: "2026-11-12T08:00:00.000Z",
      referenceDate: new Date("2026-11-12T08:05:00.000Z"),
      executions: [
        makeExec("company_research", [
          makeEvidence({
            id: "ev-rel-intruder",
            symbol: "RELIANCE",
            claim: "Quarterly Revenue Growth YoY",
            value: 99.0,
          }),
        ]),
      ],
    });

    // Passing another user's context must be rejected -> NO_HISTORICAL_CONTEXT
    const isolatedCtx = builder.buildFromExecutions({
      userId: "user-owner",
      symbol: "RELIANCE",
      referenceDate: refDate,
      previousContexts: [prevOtherUser],
      executions: [
        makeExec("company_research", [
          makeEvidence({
            id: "ev-rel-curr",
            symbol: "RELIANCE",
            claim: "Quarterly Revenue Growth YoY",
            value: 14.5,
          }),
        ]),
      ],
    });
    expect(isolatedCtx.researchBrief!.historicalChanges.status).toBe("NO_HISTORICAL_CONTEXT");

    // Passing owned previous context -> COMPARED
    const comparedCtx = builder.buildFromExecutions({
      userId: "user-owner",
      symbol: "RELIANCE",
      referenceDate: refDate,
      previousContexts: [prevOwned],
      executions: [
        makeExec("company_research", [
          makeEvidence({
            id: "ev-rel-curr-2",
            symbol: "RELIANCE",
            claim: "Quarterly Revenue Growth YoY",
            value: 14.5,
          }),
        ]),
      ],
    });
    expect(comparedCtx.researchBrief!.historicalChanges.status).toBe("COMPARED");
    expect(comparedCtx.researchBrief!.historicalChanges.previousContextId).toBe(
      prevOwned.contextId
    );
    expect(comparedCtx.researchBrief!.historicalChanges.improvedEvidence).toHaveLength(1);
  });

  it("8. Peer comparability reuses Phase 9.3 ranking rules and preserves unranked reasons", () => {
    const peerComparable = builder.buildFromExecutions({
      userId: "user-94-8",
      symbol: "HCLTECH",
      requestedPeriod: "Q2FY27",
      referenceDate: refDate,
      executions: [
        makeExec("company_research", [
          makeEvidence({
            id: "ev-hcl-1",
            symbol: "HCLTECH",
            claim: "Consolidated Quarterly Revenue Growth YoY",
            value: 11.5,
            dataPeriod: "Q2FY27",
            metadata: { basis: "CONSOLIDATED", dataPeriod: "Q2FY27" },
          }),
          makeEvidence({
            id: "ev-hcl-2",
            symbol: "HCLTECH",
            claim: "Consolidated Net Profit Growth YoY",
            value: 12.0,
            dataPeriod: "Q2FY27",
            metadata: { basis: "CONSOLIDATED", dataPeriod: "Q2FY27" },
          }),
        ]),
      ],
    });

    const peerStandaloneIncomparable = builder.buildFromExecutions({
      userId: "user-94-8",
      symbol: "TECHM",
      requestedPeriod: "Q2FY27",
      referenceDate: refDate,
      executions: [
        makeExec("company_research", [
          makeEvidence({
            id: "ev-techm-1",
            symbol: "TECHM",
            claim: "Standalone Quarterly Revenue Growth YoY",
            value: 18.0,
            dataPeriod: "Q2FY27",
            metadata: { basis: "STANDALONE", dataPeriod: "Q2FY27" },
          }),
          makeEvidence({
            id: "ev-techm-2",
            symbol: "TECHM",
            claim: "Standalone Net Profit Growth YoY",
            value: 17.0,
            dataPeriod: "Q2FY27",
            metadata: { basis: "STANDALONE", dataPeriod: "Q2FY27" },
          }),
        ]),
      ],
    });

    const targetCtx = builder.buildFromExecutions({
      userId: "user-94-8",
      symbol: "TCS",
      requestedPeriod: "Q2FY27",
      referenceDate: refDate,
      peerContexts: [peerComparable, peerStandaloneIncomparable],
      executions: [
        makeExec("company_research", [
          makeEvidence({
            id: "ev-tcs-1",
            symbol: "TCS",
            claim: "Consolidated Quarterly Revenue Growth YoY",
            value: 16.0,
            dataPeriod: "Q2FY27",
            metadata: { basis: "CONSOLIDATED", dataPeriod: "Q2FY27" },
          }),
          makeEvidence({
            id: "ev-tcs-2",
            symbol: "TCS",
            claim: "Consolidated Net Profit Growth YoY",
            value: 18.5,
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
            value: 1.4,
            dataPeriod: "Q2FY27",
          }),
        ]),
      ],
    });

    const peerComp = targetCtx.researchBrief!.peerComparison;
    expect(peerComp.status).toBe("COMPARED");
    expect(peerComp.companyRank).toBe(1);
    expect(peerComp.totalRankedPeers).toBe(2);
    expect(peerComp.unrankedPeers.map((u) => u.symbol)).toContain("TECHM");
  });

  it("9. Enforces Evidence ID integrity, no fabricated values, and read-only behavior", () => {
    const ctx = builder.buildFromExecutions({
      userId: "user-94-9",
      symbol: "TCS",
      referenceDate: refDate,
      executions: [
        makeExec("company_research", [
          makeEvidence({
            id: "ev-int-1",
            symbol: "TCS",
            claim: "Consolidated Quarterly Revenue Growth YoY",
            value: 15.0,
          }),
          makeEvidence({
            id: "ev-int-2",
            symbol: "TCS",
            claim: "Operating EBITDA Margin",
            value: 6.5,
          }),
        ]),
        makeExec("institutional_intelligence", [
          makeEvidence({
            id: "ev-int-3",
            symbol: "TCS",
            category: "INSTITUTIONAL_HOLDING",
            claim: "FII Ownership Percentage",
            value: 25.0,
          }),
        ]),
      ],
    });

    const brief = ctx.researchBrief!;
    expect(brief.readOnly).toBe(true);

    const validIds = new Set(ctx.evidenceReferences.map((r) => r.evidenceId));
    const allBriefItems = [
      ...brief.bullishEvidence,
      ...brief.bearishEvidence,
      ...brief.neutralEvidence,
      ...brief.strongestSupportingEvidence,
      ...brief.strongestOpposingEvidence,
    ];
    for (const item of allBriefItems) {
      expect(validIds.has(item.evidenceId)).toBe(true);
    }

    const serialized = JSON.stringify(brief);
    expect(serialized).not.toMatch(/priceTarget|targetPrice|guaranteedReturn|buySignal|sellSignal/i);
    expect(brief.confidenceExplanation).toContain(
      "Confidence describes research evidence quality and completeness, not probability of financial returns or trade success."
    );
  });
});

