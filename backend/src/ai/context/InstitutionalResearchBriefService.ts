import {
  CrossAgentResearchSynthesis,
  MatrixEvidenceItem,
} from "./CrossAgentSynthesisSchema";
import {
  CrossAgentResearchSynthesizer,
  crossAgentResearchSynthesizer,
} from "./CrossAgentResearchSynthesizer";
import {
  BriefEvidencePresentationItem,
  BriefPeerComparisonSummary,
  BriefUnresolvedConflictItem,
  InstitutionalResearchBrief,
  ResearchBriefConclusion,
  ResearchBriefConfidence,
} from "./InstitutionalResearchBriefSchema";
import {
  InstitutionalResearchIntelligenceService,
  institutionalResearchIntelligenceService,
} from "./InstitutionalResearchIntelligenceService";
import {
  InstitutionalRiskCategory,
  ResearchIntelligenceScorecard,
  ScorecardPillarKey,
  ScorecardPillarResult,
} from "./ResearchIntelligenceScorecardSchema";
import {
  PreservedEvidenceReference,
  UnifiedIntelligenceContext,
} from "./UnifiedContextSchema";

const BRIEF_ADVISORY_DISCLAIMER =
  "Read-only institutional research brief for analytical decision support only. Confidence and conclusion classifications reflect evidence completeness, verification, and directional alignment — never guaranteed returns, price targets, or trade execution advice.";

const CAUSATION_CORRELATION_LIMITATION =
  "Analytical interpretation reflects observed correlation or alignment with reported disclosures; causal relationship to future price performance is unproven.";

const CORE_FINANCIAL_RISK_CATEGORIES: ReadonlySet<InstitutionalRiskCategory> =
  new Set([
    "EARNINGS_DETERIORATION",
    "DEBT_AND_LEVERAGE",
    "CASH_FLOW_WEAKNESS",
    "INSTITUTIONAL_DISTRIBUTION",
    "PROMOTER_PLEDGE",
    "NEGATIVE_NEWS",
  ]);

function findPillar(
  scorecard: ResearchIntelligenceScorecard,
  key: ScorecardPillarKey
): ScorecardPillarResult {
  const found = scorecard.pillars.find((p) => p.pillar === key);
  if (!found) {
    throw new Error(`Scorecard missing required pillar: ${key}`);
  }
  return found;
}

function buildEvidenceLimitations(
  item: MatrixEvidenceItem,
  ref: PreservedEvidenceReference | undefined,
  conflictedIds: Set<string>
): string[] {
  const limitations: string[] = [CAUSATION_CORRELATION_LIMITATION];

  if (
    item.granularFreshness === "AGING" ||
    item.granularFreshness === "STALE" ||
    item.granularFreshness === "EXPIRED"
  ) {
    limitations.push(
      `Evidence freshness is ${item.granularFreshness} (retrieved at ${item.retrievalTimestamp}).`
    );
  }

  if (item.verificationStatus !== "VERIFIED") {
    limitations.push(
      `Source verification status is ${item.verificationStatus} (${item.sourceName}).`
    );
  }

  if (conflictedIds.has(item.evidenceId)) {
    limitations.push(
      "Evidence item is involved in a cross-source discrepancy or conflict."
    );
  }

  const claimLower = item.claim.toLowerCase();
  if (
    /\b(fii|dii|institutional|mutual fund|promoter)\b/.test(claimLower) &&
    !/\b(flow|change|net|delta|qoq|mom|buying|selling|accumulation|distribution)\b/.test(
      claimLower
    )
  ) {
    limitations.push(
      "Represents a static shareholding percentage snapshot; does not measure active buying or selling flow."
    );
  }

  if (ref && !ref.reportingPeriod && item.agentSource === "company_research") {
    limitations.push("Reporting period was not explicitly tagged on this record.");
  }

  return limitations;
}

function toBriefEvidenceItem(
  item: MatrixEvidenceItem,
  refById: Map<string, PreservedEvidenceReference>,
  conflictedIds: Set<string>
): BriefEvidencePresentationItem {
  const ref = refById.get(item.evidenceId);
  const valDisplay =
    item.value === null
      ? "N/A"
      : `${String(item.value)}${item.unit ? " " + item.unit : ""}${
          item.currency ? " (" + item.currency + ")" : ""
        }`;
  const periodDisplay = item.reportingPeriod
    ? ` [Period: ${item.reportingPeriod}]`
    : "";

  return {
    evidenceId: item.evidenceId,
    source: item.sourceName,
    publishedAt: item.publicationTimestamp,
    retrievedAt: item.retrievalTimestamp,
    freshness: item.granularFreshness,
    observedFact: `Observed ${item.claim}: ${valDisplay}${periodDisplay} (Source: ${item.sourceName}).`,
    interpretation: `Analytical interpretation (${item.direction}): ${item.rationale}`,
    limitations: buildEvidenceLimitations(item, ref, conflictedIds),
  };
}

export interface BuildResearchBriefOptions {
  previousContexts?: UnifiedIntelligenceContext[];
  peerContexts?: UnifiedIntelligenceContext[];
}

export class InstitutionalResearchBriefService {
  private readonly synthesizer: CrossAgentResearchSynthesizer;
  private readonly intelligenceService: InstitutionalResearchIntelligenceService;

  public constructor(deps?: {
    synthesizer?: CrossAgentResearchSynthesizer;
    intelligenceService?: InstitutionalResearchIntelligenceService;
  }) {
    this.synthesizer = deps?.synthesizer ?? crossAgentResearchSynthesizer;
    this.intelligenceService =
      deps?.intelligenceService ?? institutionalResearchIntelligenceService;
  }

  public buildBrief(
    context: UnifiedIntelligenceContext,
    options: BuildResearchBriefOptions = {}
  ): InstitutionalResearchBrief {
    // Strictly filter previousContexts to same authenticated user and normalized symbol
    const ownedPreviousContexts = (options.previousContexts ?? []).filter(
      (prev) =>
        prev &&
        prev.userId === context.userId &&
        prev.symbol === context.symbol &&
        prev.contextId !== context.contextId
    );

    const synthesis: CrossAgentResearchSynthesis =
      context.crossAgentSynthesis ??
      this.synthesizer.synthesize(context, ownedPreviousContexts);

    const scorecard: ResearchIntelligenceScorecard =
      context.researchScorecard ??
      this.intelligenceService.buildScorecard(context, ownedPreviousContexts);

    const fundamentalAssessment = findPillar(scorecard, "FUNDAMENTAL_QUALITY");
    const institutionalAssessment = findPillar(
      scorecard,
      "INSTITUTIONAL_ACTIVITY"
    );
    const marketAssessment = findPillar(scorecard, "MARKET_ALIGNMENT");
    const newsAndMacroAssessment = findPillar(
      scorecard,
      "NEWS_AND_MACRO_ENVIRONMENT"
    );
    const financialRiskAssessment = findPillar(scorecard, "FINANCIAL_RISK");
    const evidenceQualityAssessment = findPillar(scorecard, "EVIDENCE_QUALITY");

    // Enforce evidence ID integrity: every referenced evidenceId must exist in context.evidenceReferences
    const refById = new Map<string, PreservedEvidenceReference>();
    for (const ref of context.evidenceReferences) {
      refById.set(ref.evidenceId, ref);
    }

    const conflictedIds = new Set<string>(
      context.conflicts.flatMap((c) => c.evidenceIds)
    );
    for (const ref of context.evidenceReferences) {
      if (ref.verificationStatus === "CONFLICTED") {
        conflictedIds.add(ref.evidenceId);
      }
    }

    const bullishEvidence = synthesis.evidenceMatrix.bullishEvidence
      .filter((e) => refById.has(e.evidenceId))
      .map((e) => toBriefEvidenceItem(e, refById, conflictedIds));

    const bearishEvidence = synthesis.evidenceMatrix.bearishEvidence
      .filter((e) => refById.has(e.evidenceId))
      .map((e) => toBriefEvidenceItem(e, refById, conflictedIds));

    const neutralEvidence = synthesis.evidenceMatrix.neutralEvidence
      .filter((e) => refById.has(e.evidenceId))
      .map((e) => toBriefEvidenceItem(e, refById, conflictedIds));

    const strongestSupportingEvidence = this.selectStrongestEvidence(
      bullishEvidence,
      refById
    );
    const strongestOpposingEvidence = this.selectStrongestEvidence(
      bearishEvidence,
      refById
    );

    const unresolvedConflicts: BriefUnresolvedConflictItem[] =
      context.conflicts.map((c) => ({
        conflictKey: c.conflictKey,
        claim: c.claim,
        evidenceIds: c.evidenceIds.filter((id) => refById.has(id)),
        reason:
          c.resolutionReason ??
          "Unresolved discrepancy across independent data sources.",
      }));

    const { conclusion, conclusionRationale } =
      this.determineConclusionAndRationale({
        context,
        scorecard,
        fundamentalAssessment,
        institutionalAssessment,
        marketAssessment,
        newsAndMacroAssessment,
        financialRiskAssessment,
        evidenceQualityAssessment,
        bullishCount: bullishEvidence.length,
        bearishCount: bearishEvidence.length,
      });

    const { confidenceClassification, confidenceExplanation } =
      this.determineConfidence({
        context,
        conclusion,
        evidenceQualityAssessment,
      });

    const peerComparison = this.buildPeerComparison(
      context,
      options.peerContexts ?? []
    );

    const researchLimitations = this.buildResearchLimitations({
      context,
      scorecard,
      bullishCount: bullishEvidence.length,
      bearishCount: bearishEvidence.length,
    });

    const executiveSummary = this.buildExecutiveSummary({
      context,
      conclusion,
      conclusionRationale,
      confidenceClassification,
      fundamentalAssessment,
      institutionalAssessment,
      marketAssessment,
      financialRiskAssessment,
      bullishCount: bullishEvidence.length,
      bearishCount: bearishEvidence.length,
      neutralCount: neutralEvidence.length,
      unresolvedConflictsCount: unresolvedConflicts.length,
      missingCount: context.missingData.length,
    });

    return {
      symbol: context.symbol,
      contextId: context.contextId,
      generatedAt: context.createdAt,
      readOnly: true,
      conclusion,
      conclusionRationale,
      confidenceClassification,
      confidenceExplanation,
      executiveSummary,
      fundamentalAssessment,
      institutionalAssessment,
      marketAssessment,
      newsAndMacroAssessment,
      financialRiskAssessment,
      evidenceQualityAssessment,
      supportedRisks: scorecard.supportedRisks,
      bullishEvidence,
      bearishEvidence,
      neutralEvidence,
      strongestSupportingEvidence,
      strongestOpposingEvidence,
      unresolvedConflicts,
      missingInformation: [...context.missingData],
      historicalChanges: scorecard.historicalChanges,
      peerComparison,
      researchLimitations,
      advisoryDisclaimer: BRIEF_ADVISORY_DISCLAIMER,
    };
  }

  private selectStrongestEvidence(
    items: BriefEvidencePresentationItem[],
    refById: Map<string, PreservedEvidenceReference>
  ): BriefEvidencePresentationItem[] {
    const rankItem = (item: BriefEvidencePresentationItem): number => {
      const ref = refById.get(item.evidenceId);
      let priority = 0;
      if (ref?.verificationStatus === "VERIFIED") priority += 4;
      if (ref?.sourceTier === "OFFICIAL_EXCHANGE_OR_FILING") priority += 3;
      else if (ref?.sourceTier === "INSTITUTIONAL_DATA_FEED") priority += 2;
      if (item.freshness === "FRESH") priority += 2;
      else if (item.freshness === "AGING") priority += 1;
      return priority;
    };

    return [...items]
      .sort((a, b) => rankItem(b) - rankItem(a))
      .slice(0, 3);
  }

  private determineConclusionAndRationale(params: {
    context: UnifiedIntelligenceContext;
    scorecard: ResearchIntelligenceScorecard;
    fundamentalAssessment: ScorecardPillarResult;
    institutionalAssessment: ScorecardPillarResult;
    marketAssessment: ScorecardPillarResult;
    newsAndMacroAssessment: ScorecardPillarResult;
    financialRiskAssessment: ScorecardPillarResult;
    evidenceQualityAssessment: ScorecardPillarResult;
    bullishCount: number;
    bearishCount: number;
  }): { conclusion: ResearchBriefConclusion; conclusionRationale: string } {
    const {
      context,
      scorecard,
      fundamentalAssessment,
      institutionalAssessment,
      marketAssessment,
      newsAndMacroAssessment,
      financialRiskAssessment,
      evidenceQualityAssessment,
      bullishCount,
      bearishCount,
    } = params;

    const analyticalPillars = [
      fundamentalAssessment,
      institutionalAssessment,
      marketAssessment,
      newsAndMacroAssessment,
    ];
    const allAnalyticalInsufficient = analyticalPillars.every(
      (p) =>
        p.assessment === "INSUFFICIENT_DATA" ||
        p.assessment === "INSUFFICIENT_CURRENT_EVIDENCE"
    );

    // Rule 1: Insufficient evidence must result in INSUFFICIENT_EVIDENCE
    if (
      context.contextStatus === "INSUFFICIENT_DATA" ||
      context.qualityAssessment.availableEvidenceCount === 0 ||
      allAnalyticalInsufficient
    ) {
      return {
        conclusion: "INSUFFICIENT_EVIDENCE",
        conclusionRationale: `Conclusion is INSUFFICIENT_EVIDENCE because available verified evidence (${context.qualityAssessment.availableEvidenceCount} record(s)) is insufficient across core analytical pillars. Missing data (${context.missingData.length} item(s)) is never interpreted as positive evidence.`,
      };
    }

    const highSeverityCoreRisks = scorecard.supportedRisks.filter(
      (r) =>
        r.severity === "HIGH" && CORE_FINANCIAL_RISK_CATEGORIES.has(r.category)
    );

    // Rule 2: Conflicted fundamental evidence must prevent an unsupported positive conclusion
    if (fundamentalAssessment.assessment === "CONFLICTED") {
      if (bearishCount > bullishCount || highSeverityCoreRisks.length >= 1) {
        return {
          conclusion: "CAUTIOUSLY_NEGATIVE",
          conclusionRationale: `Fundamental Quality is CONFLICTED (${fundamentalAssessment.conflicts.length} conflict(s) or incompatible reporting periods/bases), preventing any positive conclusion, while opposing evidence (${bearishCount} bearish vs ${bullishCount} bullish) or high-severity risk (${highSeverityCoreRisks.length}) tilts the profile cautiously negative.`,
        };
      }
      return {
        conclusion: "NEUTRAL",
        conclusionRationale: `Fundamental Quality is CONFLICTED (${fundamentalAssessment.conflicts.length} conflict(s) or reporting period/basis incompatibility). Deterministic rules prohibit a positive conclusion when fundamental evidence is conflicted.`,
      };
    }

    // Rule 3: Serious unresolved financial risks & weak fundamentals
    if (
      fundamentalAssessment.assessment === "WEAK" &&
      (highSeverityCoreRisks.length >= 1 ||
        bearishCount > bullishCount ||
        financialRiskAssessment.assessment === "HIGH_RISK")
    ) {
      return {
        conclusion: "NEGATIVE",
        conclusionRationale: `Conclusion is NEGATIVE due to WEAK Fundamental Quality combined with ${highSeverityCoreRisks.length} high-severity financial risk(s) and ${bearishCount} bearish evidence item(s) vs ${bullishCount} bullish item(s).`,
      };
    }

    if (
      highSeverityCoreRisks.length >= 2 &&
      bearishCount > bullishCount &&
      bullishCount === 0
    ) {
      return {
        conclusion: "NEGATIVE",
        conclusionRationale: `Conclusion is NEGATIVE due to ${highSeverityCoreRisks.length} unresolved high-severity financial risks (${highSeverityCoreRisks.map((r) => r.category).join(", ")}) with ${bearishCount} opposing evidence item(s) and zero supporting bullish evidence.`,
      };
    }

    // Rule 4: Conflicting bullish and bearish evidence must be surfaced, not silently averaged
    if (
      bullishCount > 0 &&
      bearishCount > 0 &&
      bullishCount === bearishCount &&
      fundamentalAssessment.assessment !== "WEAK" &&
      highSeverityCoreRisks.length <= 1
    ) {
      return {
        conclusion: "NEUTRAL",
        conclusionRationale: `Conclusion is NEUTRAL because supporting (${bullishCount} bullish) and opposing (${bearishCount} bearish) evidence are evenly balanced and must not be silently averaged.`,
      };
    }

    if (
      fundamentalAssessment.assessment === "WEAK" ||
      highSeverityCoreRisks.length >= 1 ||
      financialRiskAssessment.assessment === "HIGH_RISK"
    ) {
      if (bullishCount > bearishCount && fundamentalAssessment.assessment !== "WEAK") {
        return {
          conclusion: "CAUTIOUSLY_NEGATIVE",
          conclusionRationale: `Conclusion is CAUTIOUSLY_NEGATIVE because although ${bullishCount} bullish evidence item(s) exist, ${highSeverityCoreRisks.length} high-severity financial risk(s) (${highSeverityCoreRisks.map((r) => r.category).join(", ")}) remain unresolved and prevent a positive or neutral posture.`,
        };
      }
      return {
        conclusion: "CAUTIOUSLY_NEGATIVE",
        conclusionRationale: `Conclusion is CAUTIOUSLY_NEGATIVE due to ${
          fundamentalAssessment.assessment === "WEAK"
            ? "WEAK Fundamental Quality"
            : `${highSeverityCoreRisks.length} high-severity financial risk(s)`
        } (${bearishCount} bearish vs ${bullishCount} bullish evidence item(s)).`,
      };
    }

    // Rule 5: Net bearish skew without high-severity fundamental collapse -> CAUTIOUSLY_NEGATIVE
    if (bearishCount > bullishCount) {
      return {
        conclusion: "CAUTIOUSLY_NEGATIVE",
        conclusionRationale: `Conclusion is CAUTIOUSLY_NEGATIVE because opposing bearish evidence (${bearishCount} item(s)) outweighs supporting bullish evidence (${bullishCount} item(s)).`,
      };
    }

    // Rule 6: Positive and Cautiously Positive rules
    const isFundamentalConstructive =
      fundamentalAssessment.assessment === "STRONG" ||
      fundamentalAssessment.assessment === "CONSTRUCTIVE";
    const supportingNonFundamentalPillars = [
      institutionalAssessment,
      marketAssessment,
      newsAndMacroAssessment,
    ].filter(
      (p) => p.assessment === "STRONG" || p.assessment === "CONSTRUCTIVE"
    ).length;
    const anyConflictedPillar = scorecard.pillars.some(
      (p) => p.assessment === "CONFLICTED"
    );

    if (isFundamentalConstructive && bullishCount > bearishCount) {
      if (
        !anyConflictedPillar &&
        supportingNonFundamentalPillars >= 1 &&
        (financialRiskAssessment.assessment === "STRONG" ||
          financialRiskAssessment.assessment === "CONSTRUCTIVE") &&
        (evidenceQualityAssessment.assessment === "STRONG" ||
          evidenceQualityAssessment.assessment === "CONSTRUCTIVE") &&
        bearishCount === 0
      ) {
        return {
          conclusion: "POSITIVE",
          conclusionRationale: `Conclusion is POSITIVE: Fundamental Quality is ${fundamentalAssessment.assessment}, ${supportingNonFundamentalPillars} additional analytical pillar(s) are constructive/strong, zero unresolved conflicts or high-severity risks exist, and ${bullishCount} verified bullish evidence item(s) support the profile.`,
        };
      }

      return {
        conclusion: "CAUTIOUSLY_POSITIVE",
        conclusionRationale: `Conclusion is CAUTIOUSLY_POSITIVE: Fundamental Quality is ${fundamentalAssessment.assessment} with ${bullishCount} bullish vs ${bearishCount} bearish evidence item(s), tempered by ${
          anyConflictedPillar
            ? "secondary pillar conflict(s)"
            : context.missingData.length > 0
              ? `${context.missingData.length} missing data item(s) (never assumed positive)`
              : "mixed or incomplete secondary pillar coverage"
        }.`,
      };
    }

    // Rule 7: Static institutional ownership alone or missing fundamentals cannot produce a positive conclusion
    return {
      conclusion: "NEUTRAL",
      conclusionRationale: `Conclusion is NEUTRAL: Fundamental Quality is ${fundamentalAssessment.assessment} and Institutional Activity is ${institutionalAssessment.assessment} (${bullishCount} bullish, ${bearishCount} bearish). Static ownership percentages or missing metrics are never interpreted as positive accumulation.`,
    };
  }

  private determineConfidence(params: {
    context: UnifiedIntelligenceContext;
    conclusion: ResearchBriefConclusion;
    evidenceQualityAssessment: ScorecardPillarResult;
  }): {
    confidenceClassification: ResearchBriefConfidence;
    confidenceExplanation: string;
  } {
    const { context, conclusion, evidenceQualityAssessment } = params;
    const qa = context.qualityAssessment;
    const fs = context.freshnessSummary;
    const verifiedCount = context.evidenceReferences.filter(
      (r) => r.verificationStatus === "VERIFIED"
    ).length;
    const unverifiedCount =
      qa.availableEvidenceCount - verifiedCount;
    const rejectedPeriodsCount =
      context.researchPeriod.incompatiblePeriodsRejected.length;

    const advisorySuffix =
      "Confidence describes research evidence quality and completeness, not probability of financial returns or trade success.";

    if (
      conclusion === "INSUFFICIENT_EVIDENCE" ||
      context.contextStatus === "INSUFFICIENT_DATA" ||
      qa.availableEvidenceCount === 0
    ) {
      return {
        confidenceClassification: "INSUFFICIENT",
        confidenceExplanation: `Confidence is INSUFFICIENT: ${qa.availableEvidenceCount} available evidence record(s), ${qa.missingDataCount} missing item(s), and context status is ${context.contextStatus}. ${advisorySuffix}`,
      };
    }

    if (
      qa.failedAgentsCount > 0 ||
      qa.conflictedEvidenceCount > 0 ||
      rejectedPeriodsCount > 0 ||
      fs.staleCount + fs.expiredCount > fs.freshCount ||
      unverifiedCount > verifiedCount ||
      evidenceQualityAssessment.assessment === "WEAK"
    ) {
      const reasons: string[] = [];
      if (qa.failedAgentsCount > 0)
        reasons.push(`${qa.failedAgentsCount} agent execution failure(s)`);
      if (qa.conflictedEvidenceCount > 0)
        reasons.push(`${qa.conflictedEvidenceCount} conflicted evidence item(s)`);
      if (rejectedPeriodsCount > 0)
        reasons.push(`${rejectedPeriodsCount} incompatible reporting period(s) rejected`);
      if (fs.staleCount + fs.expiredCount > 0)
        reasons.push(`${fs.staleCount} stale and ${fs.expiredCount} expired record(s)`);
      if (unverifiedCount > 0)
        reasons.push(`${unverifiedCount} unverified record(s)`);

      return {
        confidenceClassification: "LOW",
        confidenceExplanation: `Confidence is LOW due to ${reasons.join(", ") || "evidence quality constraints"}. ${advisorySuffix}`,
      };
    }

    if (
      context.contextStatus === "COMPLETE" &&
      qa.failedAgentsCount === 0 &&
      qa.skippedAgentsCount === 0 &&
      qa.conflictedEvidenceCount === 0 &&
      fs.staleCount === 0 &&
      fs.expiredCount === 0 &&
      rejectedPeriodsCount === 0 &&
      qa.missingDataCount <= 2 &&
      unverifiedCount === 0
    ) {
      return {
        confidenceClassification: "HIGH",
        confidenceExplanation: `Confidence is HIGH: all ${qa.completedAgentsCount} scheduled specialist agent(s) succeeded, all ${verifiedCount} evidence record(s) are verified and fresh/aging with zero conflicts and compatible reporting periods. ${advisorySuffix}`,
      };
    }

    return {
      confidenceClassification: "MODERATE",
      confidenceExplanation: `Confidence is MODERATE: ${verifiedCount}/${qa.availableEvidenceCount} verified evidence record(s) across ${qa.completedAgentsCount} completed agent(s), tempered by ${qa.missingDataCount} missing data item(s), ${qa.skippedAgentsCount} skipped agent(s), or ${fs.agingCount + fs.staleCount} aging/stale record(s). ${advisorySuffix}`,
    };
  }

  private buildPeerComparison(
    context: UnifiedIntelligenceContext,
    peerContexts: UnifiedIntelligenceContext[]
  ): BriefPeerComparisonSummary {
    const validPeers = peerContexts.filter(
      (p) => p && p.symbol !== context.symbol
    );

    if (validPeers.length === 0) {
      return {
        status: "NO_PEER_CONTEXT",
        companyRank: null,
        totalRankedPeers: 0,
        evidenceTier: null,
        rankedPeers: [],
        unrankedPeers: [],
        unrankedReasonsForSymbol: [],
        methodologyNote:
          "No comparable peer contexts were supplied for this request. Peer comparison never fabricates peer metrics.",
        summary:
          "No peer contexts provided; comparative ranking skipped.",
      };
    }

    const rankingResult = this.intelligenceService.rankCompanies([
      context,
      ...validPeers,
    ]);

    const rankedEntry = rankingResult.rankedCompanies.find(
      (r) => r.symbol === context.symbol
    );
    const unrankedEntry = rankingResult.unrankedCompanies.find(
      (u) => u.symbol === context.symbol
    );

    if (rankedEntry) {
      return {
        status: "COMPARED",
        companyRank: rankedEntry.rank,
        totalRankedPeers: rankingResult.rankedCompanies.length,
        evidenceTier: rankedEntry.evidenceTier,
        rankedPeers: rankingResult.rankedCompanies,
        unrankedPeers: rankingResult.unrankedCompanies,
        unrankedReasonsForSymbol: [],
        methodologyNote: rankingResult.methodologyNote,
        summary: `${context.symbol} ranked #${rankedEntry.rank} of ${rankingResult.rankedCompanies.length} comparable company(ies) in ${rankedEntry.evidenceTier} (${rankingResult.unrankedCompanies.length} peer(s) excluded as incomparable/insufficient).`,
        rankingResult,
      };
    }

    return {
      status: "UNRANKED_INCOMPARABLE",
      companyRank: null,
      totalRankedPeers: rankingResult.rankedCompanies.length,
      evidenceTier: null,
      rankedPeers: rankingResult.rankedCompanies,
      unrankedPeers: rankingResult.unrankedCompanies,
      unrankedReasonsForSymbol: unrankedEntry?.unrankedReasons ?? [
        "Insufficient or incomparable evidence for peer ranking.",
      ],
      methodologyNote: rankingResult.methodologyNote,
      summary: `${context.symbol} was excluded from peer ranking: ${(unrankedEntry?.unrankedReasons ?? []).join(" ") || "Insufficient comparable evidence."}`,
      rankingResult,
    };
  }

  private buildResearchLimitations(params: {
    context: UnifiedIntelligenceContext;
    scorecard: ResearchIntelligenceScorecard;
    bullishCount: number;
    bearishCount: number;
  }): string[] {
    const { context, scorecard, bullishCount, bearishCount } = params;
    const limitations = new Set<string>(scorecard.researchLimitations);
    limitations.add(CAUSATION_CORRELATION_LIMITATION);

    if (bullishCount > 0 && bearishCount > 0) {
      limitations.add(
        `Directional divergence present: ${bullishCount} bullish and ${bearishCount} bearish evidence item(s) coexist and are presented separately without silent averaging.`
      );
    }

    if (context.qualityAssessment.failedAgentsCount > 0) {
      limitations.add(
        `${context.qualityAssessment.failedAgentsCount} specialist agent(s) failed during execution (${context.qualityAssessment.failedAgents.join(", ")}).`
      );
    }

    if (context.qualityAssessment.skippedAgentsCount > 0) {
      limitations.add(
        `${context.qualityAssessment.skippedAgentsCount} specialist agent(s) were skipped (${context.qualityAssessment.skippedAgents.join(", ")}).`
      );
    }

    return Array.from(limitations);
  }

  private buildExecutiveSummary(params: {
    context: UnifiedIntelligenceContext;
    conclusion: ResearchBriefConclusion;
    conclusionRationale: string;
    confidenceClassification: ResearchBriefConfidence;
    fundamentalAssessment: ScorecardPillarResult;
    institutionalAssessment: ScorecardPillarResult;
    marketAssessment: ScorecardPillarResult;
    financialRiskAssessment: ScorecardPillarResult;
    bullishCount: number;
    bearishCount: number;
    neutralCount: number;
    unresolvedConflictsCount: number;
    missingCount: number;
  }): string {
    const {
      context,
      conclusion,
      conclusionRationale,
      confidenceClassification,
      fundamentalAssessment,
      institutionalAssessment,
      marketAssessment,
      financialRiskAssessment,
      bullishCount,
      bearishCount,
      neutralCount,
      unresolvedConflictsCount,
      missingCount,
    } = params;

    return `${context.symbol} Institutional Research Brief — Conclusion: ${conclusion} (Evidence Confidence: ${confidenceClassification}). ${conclusionRationale} Pillar overview: Fundamentals=${fundamentalAssessment.assessment}, Institutional=${institutionalAssessment.assessment}, Market=${marketAssessment.assessment}, Financial Risk=${financialRiskAssessment.assessment}. Evidence distribution: ${bullishCount} bullish, ${bearishCount} bearish, ${neutralCount} neutral, ${unresolvedConflictsCount} unresolved conflict(s), and ${missingCount} missing data item(s).`;
  }
}

export const institutionalResearchBriefService =
  new InstitutionalResearchBriefService();
