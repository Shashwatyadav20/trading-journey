import {
  PreservedEvidenceReference,
  UnifiedIntelligenceContext,
} from "./UnifiedContextSchema";
import {
  AlignmentDimensionKey,
  AlignmentStatus,
  BullishBearishEvidenceMatrix,
  CrossAgentAlignmentItem,
  CrossAgentResearchSynthesis,
  DirectionalBalanceSummary,
  HistoricalContextComparison,
  HistoricalMetricDelta,
  MatrixConflictItem,
  MatrixEvidenceItem,
  PillarAssessment,
  RelationshipClassification,
  StructuredResearchConclusion,
  SynthesizedRiskFinding,
} from "./CrossAgentSynthesisSchema";
import { RegisteredAgentId } from "../orchestrator/IntentRouter";

const CAUSATION_DISCLAIMER =
  "Observed alignment reflects concurrent evidence correlation, not proven causation or a guaranteed trading signal.";

const ADVISORY_DISCLAIMER =
  "READ-ONLY RESEARCH SYNTHESIS: Alignment of evidence is not a guaranteed trading signal, price target, or profit prediction.";

interface ClassifiedEvidence {
  ref: PreservedEvidenceReference;
  direction: "BULLISH" | "BEARISH" | "NEUTRAL";
  rationale: string;
}

function classifySingleEvidence(ref: PreservedEvidenceReference): ClassifiedEvidence {
  const claimLower = ref.claim.toLowerCase();
  const val = ref.value;
  const numVal = typeof val === "number" && Number.isFinite(val) ? val : null;
  const strVal = typeof val === "string" ? val.trim().toLowerCase() : "";

  // 1. Fundamental metrics
  if (
    /\b(roe|return on equity|roce|return on capital|ebitda margin|operating margin)\b/.test(
      claimLower
    ) &&
    numVal !== null
  ) {
    if (numVal >= 15) {
      return {
        ref,
        direction: "BULLISH",
        rationale: `${ref.claim} of ${numVal}${ref.unit ?? "%"} indicates strong capital efficiency (>= 15%).`,
      };
    }
    if (numVal < 8) {
      return {
        ref,
        direction: "BEARISH",
        rationale: `${ref.claim} of ${numVal}${ref.unit ?? "%"} indicates weak capital efficiency (< 8%).`,
      };
    }
  }

  if (
    /\b(revenue growth|profit growth|earnings growth|ebitda growth|quarterly revenue growth|sales growth|yoy growth|pat growth)\b/.test(
      claimLower
    ) &&
    numVal !== null
  ) {
    if (numVal > 10) {
      return {
        ref,
        direction: "BULLISH",
        rationale: `${ref.claim} of ${numVal}${ref.unit ?? "%"} shows healthy top/bottom-line expansion (> 10%).`,
      };
    }
    if (numVal < 0) {
      return {
        ref,
        direction: "BEARISH",
        rationale: `${ref.claim} of ${numVal}${ref.unit ?? "%"} reflects contraction (< 0%).`,
      };
    }
  }

  if (/\b(debt\s*\/?\s*equity|debt to equity|leverage|net debt to ebitda)\b/.test(claimLower) && numVal !== null) {
    if (numVal > 1.5) {
      return {
        ref,
        direction: "BEARISH",
        rationale: `${ref.claim} of ${numVal} indicates elevated balance-sheet leverage (> 1.5).`,
      };
    }
    if (numVal <= 0.5 && numVal >= 0) {
      return {
        ref,
        direction: "BULLISH",
        rationale: `${ref.claim} of ${numVal} reflects low balance-sheet leverage (<= 0.5).`,
      };
    }
  }

  if (/\b(cash flow|free cash flow|operating cash flow|ocf|fcf)\b/.test(claimLower)) {
    if ((numVal !== null && numVal < 0) || /\b(negative|weak|outflow|deficit|decline)\b/.test(strVal)) {
      return {
        ref,
        direction: "BEARISH",
        rationale: `${ref.claim} (${String(val)}) indicates cash flow weakness or negative cash generation.`,
      };
    }
    if (numVal !== null && numVal > 0) {
      return {
        ref,
        direction: "BULLISH",
        rationale: `${ref.claim} (${numVal}${ref.unit ? " " + ref.unit : ""}) indicates positive cash generation.`,
      };
    }
  }

  // 2. Institutional & Promoter holdings / flows
  if (/\b(pledge|pledged)\b/.test(claimLower) && numVal !== null) {
    if (numVal > 10) {
      return {
        ref,
        direction: "BEARISH",
        rationale: `${ref.claim} of ${numVal}% indicates elevated promoter share encumbrance (> 10%).`,
      };
    }
    if (numVal === 0) {
      return {
        ref,
        direction: "BULLISH",
        rationale: `${ref.claim} of 0% confirms unencumbered promoter holdings.`,
      };
    }
  }

  if (/\b(fii|dii|institutional|mutual fund|foreign institutional)\b/.test(claimLower)) {
    if (/\b(flow|change|net|delta|mom|qoq|buying|selling)\b/.test(claimLower)) {
      if ((numVal !== null && numVal > 0) || /\b(inflow|accumulation|buying|increase)\b/.test(strVal)) {
        return {
          ref,
          direction: "BULLISH",
          rationale: `${ref.claim} (${String(val)}) indicates net institutional accumulation.`,
        };
      }
      if ((numVal !== null && numVal < 0) || /\b(outflow|selling|distribution|reduction|decrease)\b/.test(strVal)) {
        return {
          ref,
          direction: "BEARISH",
          rationale: `${ref.claim} (${String(val)}) indicates net institutional selling/outflow.`,
        };
      }
    } else if (numVal !== null) {
      return {
        ref,
        direction: "NEUTRAL",
        rationale: `${ref.claim} of ${numVal}% is a static shareholding level (does not indicate active buying or selling flow).`,
      };
    }
  }

  if (/\bpromoter holding\b/.test(claimLower) && numVal !== null) {
    if (numVal >= 50) {
      return {
        ref,
        direction: "BULLISH",
        rationale: `${ref.claim} of ${numVal}% indicates majority promoter ownership (>= 50%).`,
      };
    }
    if (numVal < 25) {
      return {
        ref,
        direction: "BEARISH",
        rationale: `${ref.claim} of ${numVal}% indicates low promoter ownership (< 25%).`,
      };
    }
  }

  // 3. Market & Technical telemetry
  if (/\b(india vix|vix|volatility index)\b/.test(claimLower) && numVal !== null) {
    if (numVal >= 20) {
      return {
        ref,
        direction: "BEARISH",
        rationale: `${ref.claim} at ${numVal} indicates heightened market volatility (>= 20).`,
      };
    }
    if (numVal <= 14) {
      return {
        ref,
        direction: "BULLISH",
        rationale: `${ref.claim} at ${numVal} indicates calm market volatility regime (<= 14).`,
      };
    }
  }

  if (/\b(vwap|order block|regime|trend|momentum|price change|session change)\b/.test(claimLower)) {
    if (
      /\b(above_vwap|above vwap|bullish|bullish_trend|uptrend|accumulation)\b/.test(strVal) ||
      (/\b(change|return)\b/.test(claimLower) && numVal !== null && numVal > 0.5)
    ) {
      return {
        ref,
        direction: "BULLISH",
        rationale: `${ref.claim} (${String(val)}) reflects constructive market/price structure.`,
      };
    }
    if (
      /\b(below_vwap|below vwap|bearish|bearish_correction|downtrend|distribution)\b/.test(strVal) ||
      (/\b(change|return)\b/.test(claimLower) && numVal !== null && numVal < -0.5)
    ) {
      return {
        ref,
        direction: "BEARISH",
        rationale: `${ref.claim} (${String(val)}) reflects weak or bearish market/price structure.`,
      };
    }
  }

  // 4. Options positioning
  if (/\b(pcr|put-call ratio|put call ratio)\b/.test(claimLower) && numVal !== null) {
    if (numVal >= 1.1) {
      return {
        ref,
        direction: "BULLISH",
        rationale: `${ref.claim} of ${numVal} reflects put-writing support skew (PCR >= 1.1).`,
      };
    }
    if (numVal <= 0.75) {
      return {
        ref,
        direction: "BEARISH",
        rationale: `${ref.claim} of ${numVal} reflects call-heavy overhead supply (PCR <= 0.75).`,
      };
    }
  }

  if (ref.agentSource === "options_intelligence") {
    if (/\b(bullish|put_writing|support_hold)\b/.test(strVal)) {
      return {
        ref,
        direction: "BULLISH",
        rationale: `Options positioning (${ref.claim}: ${String(val)}) indicates bullish skew.`,
      };
    }
    if (/\b(bearish|call_writing|resistance_cap)\b/.test(strVal)) {
      return {
        ref,
        direction: "BEARISH",
        rationale: `Options positioning (${ref.claim}: ${String(val)}) indicates bearish skew.`,
      };
    }
  }

  // 5. News, Macro & Announcements
  const combinedText = `${claimLower} ${strVal}`;
  if (
    /\b(order win|contract win|upgrade|beat estimates|margin expansion|record profit|rate cut|approval|dividend hike|positive catalyst|strong demand)\b/.test(
      combinedText
    )
  ) {
    return {
      ref,
      direction: "BULLISH",
      rationale: `${ref.claim} (${String(val)}) represents a constructive news/macro or fundamental catalyst.`,
    };
  }
  if (
    /\b(downgrade|penalty|default|lawsuit|investigation|fraud|margin contraction|net loss|miss estimates|rate hike|inflation spike|headwind|negative|deterioration|weakness|resignation)\b/.test(
      combinedText
    )
  ) {
    return {
      ref,
      direction: "BEARISH",
      rationale: `${ref.claim} (${String(val)}) indicates an adverse news, macro, or operational risk factor.`,
    };
  }

  return {
    ref,
    direction: "NEUTRAL",
    rationale: `${ref.claim} (${String(val)}${ref.unit ? " " + ref.unit : ""}) is informational/neutral without an extreme directional threshold.`,
  };
}

function scoreGroupDirection(items: ClassifiedEvidence[]): {
  bullish: number;
  bearish: number;
  net: "BULLISH" | "BEARISH" | "NEUTRAL" | "MIXED";
} {
  const bullish = items.filter((i) => i.direction === "BULLISH").length;
  const bearish = items.filter((i) => i.direction === "BEARISH").length;
  if (bullish > 0 && bearish === 0) return { bullish, bearish, net: "BULLISH" };
  if (bearish > 0 && bullish === 0) return { bullish, bearish, net: "BEARISH" };
  if (bullish > 0 && bearish > 0) return { bullish, bearish, net: "MIXED" };
  return { bullish, bearish, net: "NEUTRAL" };
}

function evaluatePairAlignment(params: {
  dimension: AlignmentDimensionKey;
  title: string;
  labelA: string;
  labelB: string;
  groupA: ClassifiedEvidence[];
  groupB: ClassifiedEvidence[];
  conflictedIds: Set<string>;
}): CrossAgentAlignmentItem {
  const { dimension, title, labelA, labelB, groupA, groupB, conflictedIds } = params;
  const combined = [...groupA, ...groupB];
  const evidenceIds = Array.from(new Set(combined.map((c) => c.ref.evidenceId)));
  const agentsInvolved = Array.from(
    new Set(combined.map((c) => c.ref.agentSource))
  ) as RegisteredAgentId[];

  if (groupA.length === 0 || groupB.length === 0) {
    return {
      dimension,
      title,
      status: "INSUFFICIENT_EVIDENCE",
      relationshipType: "INSUFFICIENT_EVIDENCE",
      causationDisclaimer: CAUSATION_DISCLAIMER,
      summary: `Insufficient evidence to evaluate alignment between ${labelA} (${groupA.length} item(s)) and ${labelB} (${groupB.length} item(s)).`,
      evidenceIds,
      agentsInvolved,
    };
  }

  const hasConflict = combined.some(
    (c) =>
      c.ref.verificationStatus === "CONFLICTED" ||
      conflictedIds.has(c.ref.evidenceId)
  );
  if (hasConflict) {
    return {
      dimension,
      title,
      status: "CONFLICTED",
      relationshipType: "CAUSAL_UNPROVEN",
      causationDisclaimer: CAUSATION_DISCLAIMER,
      summary: `Conflicting evidence detected across ${labelA} and ${labelB}; alignment cannot be established until source discrepancies are resolved.`,
      evidenceIds,
      agentsInvolved,
    };
  }

  const scoreA = scoreGroupDirection(groupA);
  const scoreB = scoreGroupDirection(groupB);

  let status: AlignmentStatus = "NEUTRAL";
  let relationshipType: RelationshipClassification = "OBSERVED_CORRELATION";
  let summary = `${labelA} and ${labelB} show neutral or balanced readings across ${evidenceIds.length} evidence record(s).`;

  if (scoreA.net === "BULLISH" && scoreB.net === "BULLISH") {
    status = "ALIGNED_BULLISH";
    summary = `Observed positive correlation: both ${labelA} and ${labelB} exhibit constructive/bullish readings (${evidenceIds.length} evidence record(s)).`;
  } else if (scoreA.net === "BEARISH" && scoreB.net === "BEARISH") {
    status = "ALIGNED_BEARISH";
    summary = `Observed negative correlation: both ${labelA} and ${labelB} exhibit weak/bearish readings (${evidenceIds.length} evidence record(s)).`;
  } else if (
    (scoreA.net === "BULLISH" && scoreB.net === "BEARISH") ||
    (scoreA.net === "BEARISH" && scoreB.net === "BULLISH") ||
    scoreA.net === "MIXED" ||
    scoreB.net === "MIXED"
  ) {
    status = "DIVERGENT";
    relationshipType = "CAUSAL_UNPROVEN";
    summary = `Divergence detected between ${labelA} (${scoreA.net}) and ${labelB} (${scoreB.net}); signals do not confirm one another.`;
  }

  return {
    dimension,
    title,
    status,
    relationshipType,
    causationDisclaimer: CAUSATION_DISCLAIMER,
    summary,
    evidenceIds,
    agentsInvolved,
  };
}

export class CrossAgentResearchSynthesizer {
  public synthesize(
    context: UnifiedIntelligenceContext,
    previousContexts: UnifiedIntelligenceContext[] = []
  ): CrossAgentResearchSynthesis {
    const conflictedIdSet = new Set<string>();
    for (const conflict of context.conflicts) {
      for (const id of conflict.evidenceIds) {
        conflictedIdSet.add(id);
      }
    }
    for (const ref of context.evidenceReferences) {
      if (ref.verificationStatus === "CONFLICTED") {
        conflictedIdSet.add(ref.evidenceId);
      }
    }

    const classifiedAll = context.evidenceReferences.map(classifySingleEvidence);
    const nonConflictedClassified = classifiedAll.filter(
      (c) => !conflictedIdSet.has(c.ref.evidenceId)
    );

    // 1. Build Bullish vs Bearish Evidence Matrix
    const toMatrixItem = (c: ClassifiedEvidence): MatrixEvidenceItem => ({
      evidenceId: c.ref.evidenceId,
      agentSource: c.ref.agentSource,
      claim: c.ref.claim,
      value: c.ref.value,
      unit: c.ref.unit,
      currency: c.ref.currency,
      direction: c.direction,
      rationale: c.rationale,
      sourceName: c.ref.sourceName,
      sourceUrl: c.ref.sourceUrl,
      publicationTimestamp: c.ref.publicationTimestamp,
      retrievalTimestamp: c.ref.retrievalTimestamp,
      reportingPeriod: c.ref.reportingPeriod,
      freshnessStatus: c.ref.freshnessStatus,
      granularFreshness: c.ref.granularFreshness,
      verificationStatus: c.ref.verificationStatus,
    });

    const bullishEvidence = nonConflictedClassified
      .filter((c) => c.direction === "BULLISH")
      .map(toMatrixItem);
    const bearishEvidence = nonConflictedClassified
      .filter((c) => c.direction === "BEARISH")
      .map(toMatrixItem);
    const neutralEvidence = nonConflictedClassified
      .filter((c) => c.direction === "NEUTRAL")
      .map(toMatrixItem);

    const conflictingEvidence: MatrixConflictItem[] = context.conflicts.map((c) => ({
      conflictKey: c.conflictKey,
      claim: c.claim,
      evidenceIds: [...c.evidenceIds],
      resolutionReason: c.resolutionReason,
      values: c.values.map((v) => ({
        evidenceId: v.evidenceId,
        source: v.source,
        value: v.value,
        unit: v.unit,
        currency: v.currency,
      })),
    }));

    let directionalSummary: DirectionalBalanceSummary = "INSUFFICIENT_EVIDENCE";
    if (context.evidenceReferences.length === 0) {
      directionalSummary = "INSUFFICIENT_EVIDENCE";
    } else if (conflictingEvidence.length > 0 && nonConflictedClassified.length === 0) {
      directionalSummary = "CONFLICTED";
    } else if (conflictingEvidence.length > 0 && bullishEvidence.length > 0 && bearishEvidence.length > 0) {
      directionalSummary = "CONFLICTED";
    } else if (bullishEvidence.length > 0 && bearishEvidence.length === 0 && conflictingEvidence.length === 0) {
      directionalSummary = "BULLISH_SKEW";
    } else if (bearishEvidence.length > 0 && bullishEvidence.length === 0 && conflictingEvidence.length === 0) {
      directionalSummary = "BEARISH_SKEW";
    } else if (bullishEvidence.length > 0 || bearishEvidence.length > 0 || neutralEvidence.length > 0) {
      directionalSummary = "BALANCED_OR_MIXED";
    }

    const evidenceMatrix: BullishBearishEvidenceMatrix = {
      bullishEvidence,
      bearishEvidence,
      neutralEvidence,
      conflictingEvidence,
      missingEvidence: [...context.missingData],
      directionalSummary,
    };

    // 2. Build 5 Cross-Agent Alignment Dimensions
    const fundamentalGroup = classifiedAll.filter(
      (c) =>
        c.ref.category === "QUARTERLY_FINANCIALS" ||
        c.ref.agentSource === "company_research"
    );
    const institutionalGroup = classifiedAll.filter(
      (c) =>
        c.ref.category === "INSTITUTIONAL_HOLDING" ||
        c.ref.agentSource === "institutional_intelligence"
    );
    const marketGroup = classifiedAll.filter(
      (c) =>
        c.ref.category === "INTRADAY_PRICE" ||
        c.ref.category === "DAILY_MARKET_DATA" ||
        c.ref.agentSource === "market_intelligence"
    );
    const companyNewsGroup = classifiedAll.filter(
      (c) =>
        c.ref.category === "COMPANY_ANNOUNCEMENT" ||
        c.ref.category === "THIRD_PARTY_NEWS" ||
        c.ref.agentSource === "news_macro"
    );
    const macroGroup = classifiedAll.filter(
      (c) =>
        c.ref.category === "REGULATORY_FILING" ||
        c.ref.category === "THIRD_PARTY_NEWS" ||
        c.ref.agentSource === "news_macro"
    );
    const validOptionsGroup = classifiedAll.filter(
      (c) =>
        (c.ref.agentSource === "options_intelligence" ||
          /\b(pcr|put-call ratio|option chain|max pain|call oi|put oi|implied volatility)\b/i.test(
            c.ref.claim
          )) &&
        c.ref.freshnessStatus !== "EXPIRED"
    );

    const alignA = evaluatePairAlignment({
      dimension: "FUNDAMENTAL_AND_INSTITUTIONAL",
      title: "A. Fundamental & Institutional Alignment",
      labelA: "Fundamental performance",
      labelB: "Institutional ownership/flows",
      groupA: fundamentalGroup,
      groupB: institutionalGroup,
      conflictedIds: conflictedIdSet,
    });

    const alignB = evaluatePairAlignment({
      dimension: "COMPANY_AND_MARKET_BEHAVIOR",
      title: "B. Company Performance & Market Behavior",
      labelA: "Company fundamentals",
      labelB: "Market price behavior",
      groupA: fundamentalGroup,
      groupB: marketGroup,
      conflictedIds: conflictedIdSet,
    });

    const alignC = evaluatePairAlignment({
      dimension: "COMPANY_NEWS_AND_FINANCIALS",
      title: "C. Company News & Financial Performance",
      labelA: "Company news/announcements",
      labelB: "Reported financials",
      groupA: companyNewsGroup,
      groupB: fundamentalGroup.filter((c) => c.ref.category === "QUARTERLY_FINANCIALS"),
      conflictedIds: conflictedIdSet,
    });

    const alignD = evaluatePairAlignment({
      dimension: "MACRO_AND_SECTOR_CONDITIONS",
      title: "D. Macro Environment & Sector/Market Conditions",
      labelA: "Macro/news environment",
      labelB: "Market/sector conditions",
      groupA: macroGroup,
      groupB: marketGroup,
      conflictedIds: conflictedIdSet,
    });

    const alignE: CrossAgentAlignmentItem =
      validOptionsGroup.length === 0
        ? {
            dimension: "OPTIONS_AND_MARKET_DIRECTION",
            title: "E. Options Positioning & Market Direction",
            status: "NOT_APPLICABLE_NO_OPTIONS_EVIDENCE",
            relationshipType: "INSUFFICIENT_EVIDENCE",
            causationDisclaimer: CAUSATION_DISCLAIMER,
            summary:
              "No valid non-expired options positioning evidence is present in this context; options alignment is not evaluated.",
            evidenceIds: [],
            agentsInvolved: [],
          }
        : evaluatePairAlignment({
            dimension: "OPTIONS_AND_MARKET_DIRECTION",
            title: "E. Options Positioning & Market Direction",
            labelA: "Options chain positioning",
            labelB: "Underlying market direction",
            groupA: validOptionsGroup,
            groupB: marketGroup,
            conflictedIds: conflictedIdSet,
          });

    const alignments: CrossAgentAlignmentItem[] = [
      alignA,
      alignB,
      alignC,
      alignD,
      alignE,
    ];

    // 3. Risk Intelligence Synthesis (strictly evidence-backed categories only)
    const riskFindings = this.buildRiskFindings(context, classifiedAll);

    // 4. Structured Research Conclusion
    const conclusion = this.buildConclusion(
      context,
      evidenceMatrix,
      riskFindings,
      fundamentalGroup,
      institutionalGroup,
      marketGroup,
      macroGroup
    );

    // 5. Historical Comparison
    const historicalComparison = this.buildHistoricalComparison(
      context,
      previousContexts
    );

    return {
      symbol: context.symbol,
      contextId: context.contextId,
      synthesizedAt: context.createdAt,
      readOnly: true,
      alignments,
      evidenceMatrix,
      riskFindings,
      conclusion,
      historicalComparison,
    };
  }

  private buildRiskFindings(
    context: UnifiedIntelligenceContext,
    classified: ClassifiedEvidence[]
  ): SynthesizedRiskFinding[] {
    const findings: SynthesizedRiskFinding[] = [];

    // 1. FINANCIAL_DETERIORATION
    const finDeterioration = classified.filter(
      (c) =>
        c.direction === "BEARISH" &&
        c.ref.category === "QUARTERLY_FINANCIALS" &&
        !/\b(debt|leverage|cash flow|ocf|fcf)\b/i.test(c.ref.claim)
    );
    if (finDeterioration.length > 0) {
      findings.push({
        category: "FINANCIAL_DETERIORATION",
        severity: "HIGH",
        description: finDeterioration.map((c) => c.rationale).join(" "),
        evidenceIds: finDeterioration.map((c) => c.ref.evidenceId),
        sources: Array.from(new Set(finDeterioration.map((c) => c.ref.sourceName))),
      });
    }

    // 2. DEBT_AND_LEVERAGE
    const debtRisks = classified.filter(
      (c) =>
        c.direction === "BEARISH" &&
        /\b(debt|leverage)\b/i.test(c.ref.claim)
    );
    if (debtRisks.length > 0) {
      findings.push({
        category: "DEBT_AND_LEVERAGE",
        severity: "HIGH",
        description: debtRisks.map((c) => c.rationale).join(" "),
        evidenceIds: debtRisks.map((c) => c.ref.evidenceId),
        sources: Array.from(new Set(debtRisks.map((c) => c.ref.sourceName))),
      });
    }

    // 3. CASH_FLOW_WEAKNESS
    const cashFlowRisks = classified.filter(
      (c) =>
        c.direction === "BEARISH" &&
        /\b(cash flow|ocf|fcf)\b/i.test(c.ref.claim)
    );
    if (cashFlowRisks.length > 0) {
      findings.push({
        category: "CASH_FLOW_WEAKNESS",
        severity: "MODERATE",
        description: cashFlowRisks.map((c) => c.rationale).join(" "),
        evidenceIds: cashFlowRisks.map((c) => c.ref.evidenceId),
        sources: Array.from(new Set(cashFlowRisks.map((c) => c.ref.sourceName))),
      });
    }

    // 4. INSTITUTIONAL_SELLING
    const instSelling = classified.filter(
      (c) =>
        c.direction === "BEARISH" &&
        (c.ref.category === "INSTITUTIONAL_HOLDING" ||
          c.ref.agentSource === "institutional_intelligence") &&
        !/\bpledge\b/i.test(c.ref.claim)
    );
    if (instSelling.length > 0) {
      findings.push({
        category: "INSTITUTIONAL_SELLING",
        severity: "MODERATE",
        description: instSelling.map((c) => c.rationale).join(" "),
        evidenceIds: instSelling.map((c) => c.ref.evidenceId),
        sources: Array.from(new Set(instSelling.map((c) => c.ref.sourceName))),
      });
    }

    // 5. PROMOTER_PLEDGE
    const pledgeRisks = classified.filter(
      (c) => c.direction === "BEARISH" && /\bpledge\b/i.test(c.ref.claim)
    );
    if (pledgeRisks.length > 0) {
      findings.push({
        category: "PROMOTER_PLEDGE",
        severity: "HIGH",
        description: pledgeRisks.map((c) => c.rationale).join(" "),
        evidenceIds: pledgeRisks.map((c) => c.ref.evidenceId),
        sources: Array.from(new Set(pledgeRisks.map((c) => c.ref.sourceName))),
      });
    }

    // 6. NEGATIVE_NEWS
    const negNews = classified.filter(
      (c) =>
        c.direction === "BEARISH" &&
        (c.ref.category === "THIRD_PARTY_NEWS" ||
          c.ref.category === "COMPANY_ANNOUNCEMENT" ||
          c.ref.category === "REGULATORY_FILING")
    );
    if (negNews.length > 0) {
      findings.push({
        category: "NEGATIVE_NEWS",
        severity: "MODERATE",
        description: negNews.map((c) => c.rationale).join(" "),
        evidenceIds: negNews.map((c) => c.ref.evidenceId),
        sources: Array.from(new Set(negNews.map((c) => c.ref.sourceName))),
      });
    }

    // 7. MARKET_VOLATILITY
    const volRisks = classified.filter(
      (c) =>
        c.direction === "BEARISH" &&
        (c.ref.category === "INTRADAY_PRICE" ||
          c.ref.category === "DAILY_MARKET_DATA" ||
          /\bvix|volatility\b/i.test(c.ref.claim))
    );
    if (volRisks.length > 0) {
      findings.push({
        category: "MARKET_VOLATILITY",
        severity: "MODERATE",
        description: volRisks.map((c) => c.rationale).join(" "),
        evidenceIds: volRisks.map((c) => c.ref.evidenceId),
        sources: Array.from(new Set(volRisks.map((c) => c.ref.sourceName))),
      });
    }

    // 8. OPTIONS_LIQUIDITY_OR_FRESHNESS
    const staleOrIlliquidOptions = context.evidenceReferences.filter(
      (r) =>
        (r.agentSource === "options_intelligence" ||
          /\b(option|pcr|max pain|oi)\b/i.test(r.claim)) &&
        (r.freshnessStatus !== "FRESH" ||
          r.granularFreshness === "STALE" ||
          r.granularFreshness === "EXPIRED" ||
          /\b(illiquid|wide spread)\b/i.test(String(r.value)))
    );
    if (staleOrIlliquidOptions.length > 0) {
      findings.push({
        category: "OPTIONS_LIQUIDITY_OR_FRESHNESS",
        severity: "MODERATE",
        description: `Options evidence contains ${staleOrIlliquidOptions.length} stale/expired or liquidity-constrained record(s).`,
        evidenceIds: staleOrIlliquidOptions.map((r) => r.evidenceId),
        sources: Array.from(new Set(staleOrIlliquidOptions.map((r) => r.sourceName))),
      });
    }

    // 9. CONFLICTING_OR_MISSING_EVIDENCE
    const staleOrExpiredRefs = context.evidenceReferences.filter(
      (r) => r.freshnessStatus !== "FRESH" || r.granularFreshness === "UNKNOWN"
    );
    if (
      context.conflicts.length > 0 ||
      context.missingData.length > 0 ||
      staleOrExpiredRefs.length > 0
    ) {
      const conflictIds = context.conflicts.flatMap((c) => c.evidenceIds);
      const staleIds = staleOrExpiredRefs.map((r) => r.evidenceId);
      const allIds = Array.from(new Set([...conflictIds, ...staleIds]));
      findings.push({
        category: "CONFLICTING_OR_MISSING_EVIDENCE",
        severity: context.conflicts.length > 0 ? "HIGH" : "MODERATE",
        description: `Context has ${context.conflicts.length} conflict(s), ${context.missingData.length} missing data item(s), and ${staleOrExpiredRefs.length} stale/expired/unverified-timestamp evidence item(s).`,
        evidenceIds: allIds,
        sources: Array.from(
          new Set(
            context.evidenceReferences
              .filter((r) => allIds.includes(r.evidenceId))
              .map((r) => r.sourceName)
          )
        ),
      });
    }

    return findings;
  }

  private buildConclusion(
    context: UnifiedIntelligenceContext,
    matrix: BullishBearishEvidenceMatrix,
    riskFindings: SynthesizedRiskFinding[],
    fundamentalGroup: ClassifiedEvidence[],
    institutionalGroup: ClassifiedEvidence[],
    marketGroup: ClassifiedEvidence[],
    macroGroup: ClassifiedEvidence[]
  ): StructuredResearchConclusion {
    const buildPillar = (
      label: string,
      group: ClassifiedEvidence[]
    ): PillarAssessment => {
      if (group.length === 0) {
        return {
          summary: `${label} assessment unavailable due to missing evidence in current context.`,
          evidenceIds: [],
          status: "UNAVAILABLE",
        };
      }
      const ids = group.map((g) => g.ref.evidenceId);
      const hasStaleOrConflict = group.some(
        (g) =>
          g.ref.freshnessStatus !== "FRESH" ||
          g.ref.verificationStatus === "CONFLICTED"
      );
      const details = group
        .map(
          (g) =>
            `${g.ref.claim}: ${String(g.ref.value)}${g.ref.unit ? " " + g.ref.unit : ""} (${g.direction})`
        )
        .join("; ");
      return {
        summary: `${label} based on ${group.length} record(s): ${details}.`,
        evidenceIds: ids,
        status: hasStaleOrConflict ? "PARTIAL" : "SUPPORTED",
      };
    };

    const explicitLimitations: string[] = [
      ADVISORY_DISCLAIMER,
      CAUSATION_DISCLAIMER,
    ];
    if (context.freshnessSummary.explicitWarning) {
      explicitLimitations.push(context.freshnessSummary.explicitWarning);
    }
    if (context.conflicts.length > 0) {
      explicitLimitations.push(
        `${context.conflicts.length} unresolved evidence conflict(s) limit conclusion certainty.`
      );
    }
    if (context.missingData.length > 0) {
      explicitLimitations.push(
        `${context.missingData.length} missing data item(s) prevent complete coverage.`
      );
    }
    if (context.qualityAssessment.failedAgentsCount > 0) {
      explicitLimitations.push(
        `Failed agent(s): ${context.qualityAssessment.failedAgents.join(", ")}.`
      );
    }
    if (context.qualityAssessment.skippedAgentsCount > 0) {
      explicitLimitations.push(
        `Skipped agent(s): ${context.qualityAssessment.skippedAgents.join(", ")}.`
      );
    }

    const riskEvidenceIds = Array.from(
      new Set(riskFindings.flatMap((r) => r.evidenceIds))
    );

    return {
      fundamentalAssessment: buildPillar("Fundamental assessment", fundamentalGroup),
      institutionalAssessment: buildPillar(
        "Institutional assessment",
        institutionalGroup
      ),
      marketAssessment: buildPillar("Market assessment", marketGroup),
      newsAndMacroAssessment: buildPillar(
        "News & macro assessment",
        macroGroup
      ),
      riskAssessment: {
        summary:
          riskFindings.length > 0
            ? `${riskFindings.length} evidence-backed risk category(ies) identified: ${riskFindings
                .map((r) => r.category)
                .join(", ")}.`
            : "No specific financial, institutional, or volatility risk thresholds were triggered in available evidence.",
        evidenceIds: riskEvidenceIds,
        activeRiskCategories: riskFindings.map((r) => r.category),
      },
      bullishArguments: matrix.bullishEvidence.map((item) => ({
        argument: item.rationale,
        evidenceIds: [item.evidenceId],
      })),
      bearishArguments: matrix.bearishEvidence.map((item) => ({
        argument: item.rationale,
        evidenceIds: [item.evidenceId],
      })),
      unresolvedConflicts: context.conflicts.map((c) => ({
        conflictKey: c.conflictKey,
        claim: c.claim,
        evidenceIds: [...c.evidenceIds],
        reason: c.resolutionReason ?? "Unresolved source discrepancy.",
      })),
      missingInformation: [...context.missingData],
      overallEvidenceQuality: context.qualityAssessment.qualityClassification,
      explicitLimitations,
      advisoryDisclaimer: ADVISORY_DISCLAIMER,
    };
  }

  private buildHistoricalComparison(
    current: UnifiedIntelligenceContext,
    previousContexts: UnifiedIntelligenceContext[]
  ): HistoricalContextComparison {
    const validPrevious = previousContexts
      .filter(
        (p) =>
          p &&
          p.symbol === current.symbol &&
          p.contextId !== current.contextId &&
          Array.isArray(p.evidenceReferences)
      )
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0];

    if (!validPrevious) {
      return {
        status: "NO_HISTORICAL_CONTEXT",
        previousContextId: null,
        previousTimestamp: null,
        currentTimestamp: current.createdAt,
        previousQualityClassification: null,
        currentQualityClassification: current.qualityAssessment.qualityClassification,
        metricDeltas: [],
        newConflictsCount: 0,
        summary:
          "NO_HISTORICAL_CONTEXT: No previous persisted research context is available for this user and symbol.",
      };
    }

    const prevByClaim = new Map<string, PreservedEvidenceReference>();
    for (const ref of validPrevious.evidenceReferences) {
      const normClaim = ref.claim.trim().toLowerCase().replace(/\s+/g, " ");
      if (!prevByClaim.has(normClaim)) {
        prevByClaim.set(normClaim, ref);
      }
    }

    const metricDeltas: HistoricalMetricDelta[] = [];
    for (const currRef of current.evidenceReferences) {
      const normClaim = currRef.claim.trim().toLowerCase().replace(/\s+/g, " ");
      const prevRef = prevByClaim.get(normClaim);
      if (!prevRef) continue;

      let direction: HistoricalMetricDelta["direction"] = "UNCHANGED";
      if (typeof prevRef.value === "number" && typeof currRef.value === "number") {
        if (currRef.value > prevRef.value) direction = "INCREASED";
        else if (currRef.value < prevRef.value) direction = "DECREASED";
      } else if (prevRef.value !== currRef.value) {
        direction = "CHANGED";
      }

      metricDeltas.push({
        claim: currRef.claim,
        previousValue: prevRef.value,
        currentValue: currRef.value,
        unit: currRef.unit ?? prevRef.unit ?? null,
        previousEvidenceId: prevRef.evidenceId,
        currentEvidenceId: currRef.evidenceId,
        previousTimestamp: prevRef.publicationTimestamp ?? prevRef.retrievalTimestamp,
        currentTimestamp: currRef.publicationTimestamp ?? currRef.retrievalTimestamp,
        direction,
      });
    }

    const prevConflictKeys = new Set(
      (validPrevious.conflicts ?? []).map((c) => c.conflictKey)
    );
    const newConflictsCount = current.conflicts.filter(
      (c) => !prevConflictKeys.has(c.conflictKey)
    ).length;

    return {
      status: "COMPARED",
      previousContextId: validPrevious.contextId,
      previousTimestamp: validPrevious.createdAt,
      currentTimestamp: current.createdAt,
      previousQualityClassification:
        validPrevious.qualityAssessment?.qualityClassification ??
        validPrevious.contextStatus,
      currentQualityClassification: current.qualityAssessment.qualityClassification,
      metricDeltas,
      newConflictsCount,
      summary: `Compared against previous persisted context (${validPrevious.contextId} at ${validPrevious.createdAt}): ${metricDeltas.length} overlapping metric(s) evaluated, ${newConflictsCount} new conflict(s).`,
    };
  }
}

export const crossAgentResearchSynthesizer =
  new CrossAgentResearchSynthesizer();

