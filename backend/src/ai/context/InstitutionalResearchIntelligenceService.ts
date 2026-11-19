import {
  PreservedEvidenceReference,
  UnifiedIntelligenceContext,
} from "./UnifiedContextSchema";
import {
  CompanyResearchRankingResult,
  FundamentalQualityBreakdown,
  HistoricalEvidenceChangeItem,
  HistoricalEvidenceChanges,
  InstitutionalActivityBreakdown,
  InstitutionalRiskItem,
  MarketAlignmentBreakdown,
  PillarQualitativeAssessment,
  RankedCompanyEntry,
  ResearchIntelligenceScorecard,
  ResearchRankingTier,
  ScorecardPillarResult,
  UnrankedCompanyEntry,
} from "./ResearchIntelligenceScorecardSchema";

const SCORECARD_ADVISORY_DISCLAIMER =
  "INSTITUTIONAL RESEARCH SCORECARD (READ-ONLY): Assessments and rankings reflect available evidence quality and alignment only. They are not investment advice, price targets, guaranteed returns, or trading execution signals.";

const RANKING_METHODOLOGY_NOTE =
  "Deterministic qualitative evidence tiering: companies require sufficient non-conflicted fundamental evidence and compatible reporting periods/bases to be ranked. Missing data is never treated as zero risk.";

function isFlowClaim(claimLower: string): boolean {
  return /\b(flow|net buying|net selling|inflow|outflow|change|delta|qoq|mom|accumulation|distribution)\b/.test(
    claimLower
  );
}

function getFreshnessLimitations(refs: PreservedEvidenceReference[]): string[] {
  const limitations: string[] = [];
  const stale = refs.filter((r) => r.freshnessStatus === "STALE");
  const expired = refs.filter(
    (r) => r.freshnessStatus === "EXPIRED" && r.granularFreshness !== "UNKNOWN"
  );
  const unknown = refs.filter((r) => r.granularFreshness === "UNKNOWN");

  if (stale.length > 0) {
    limitations.push(
      `${stale.length} evidence item(s) are STALE (${stale.map((r) => r.evidenceId).join(", ")}).`
    );
  }
  if (expired.length > 0) {
    limitations.push(
      `${expired.length} evidence item(s) are EXPIRED (${expired.map((r) => r.evidenceId).join(", ")}).`
    );
  }
  if (unknown.length > 0) {
    limitations.push(
      `${unknown.length} evidence item(s) lack valid publication timestamps (${unknown.map((r) => r.evidenceId).join(", ")}).`
    );
  }
  return limitations;
}

export class InstitutionalResearchIntelligenceService {
  public buildScorecard(
    context: UnifiedIntelligenceContext,
    previousContexts: UnifiedIntelligenceContext[] = []
  ): ResearchIntelligenceScorecard {
    const conflictedIds = new Set<string>(
      context.conflicts.flatMap((c) => c.evidenceIds)
    );
    for (const r of context.evidenceReferences) {
      if (r.verificationStatus === "CONFLICTED") {
        conflictedIds.add(r.evidenceId);
      }
    }

    const fundamentalPillar = this.buildFundamentalQualityPillar(
      context,
      conflictedIds
    );
    const institutionalPillar = this.buildInstitutionalActivityPillar(
      context,
      conflictedIds
    );
    const marketPillar = this.buildMarketAlignmentPillar(context, conflictedIds);
    const newsMacroPillar = this.buildNewsMacroPillar(context, conflictedIds);
    const supportedRisks = this.buildSupportedRisks(
      context,
      fundamentalPillar,
      institutionalPillar,
      marketPillar,
      newsMacroPillar
    );
    const financialRiskPillar = this.buildFinancialRiskPillar(
      context,
      supportedRisks
    );
    const evidenceQualityPillar = this.buildEvidenceQualityPillar(context);

    const pillars: ScorecardPillarResult[] = [
      fundamentalPillar,
      institutionalPillar,
      marketPillar,
      newsMacroPillar,
      financialRiskPillar,
      evidenceQualityPillar,
    ];

    const historicalChanges = this.buildHistoricalChanges(
      context,
      previousContexts
    );

    const researchLimitations: string[] = [SCORECARD_ADVISORY_DISCLAIMER];
    if (context.freshnessSummary.explicitWarning) {
      researchLimitations.push(context.freshnessSummary.explicitWarning);
    }
    if (context.conflicts.length > 0) {
      researchLimitations.push(
        `${context.conflicts.length} unresolved conflict(s) present across sources.`
      );
    }
    if (context.missingData.length > 0) {
      researchLimitations.push(
        `${context.missingData.length} missing data item(s); unavailable metrics are never assumed to be zero risk.`
      );
    }
    if (context.researchPeriod.incompatiblePeriodsRejected.length > 0) {
      researchLimitations.push(
        `${context.researchPeriod.incompatiblePeriodsRejected.length} evidence item(s) rejected due to incompatible reporting period.`
      );
    }
    if (
      institutionalPillar.institutionalBreakdown &&
      !institutionalPillar.institutionalBreakdown.hasExplicitFlowData
    ) {
      researchLimitations.push(
        institutionalPillar.institutionalBreakdown.ownershipVsFlowDistinction
      );
    }

    return {
      symbol: context.symbol,
      contextId: context.contextId,
      generatedAt: context.createdAt,
      readOnly: true,
      overallStatus: context.qualityAssessment.qualityClassification,
      pillars,
      supportedRisks,
      historicalChanges,
      researchLimitations,
      advisoryDisclaimer: SCORECARD_ADVISORY_DISCLAIMER,
    };
  }

  private buildFundamentalQualityPillar(
    context: UnifiedIntelligenceContext,
    conflictedIds: Set<string>
  ): ScorecardPillarResult {
    const refs = context.evidenceReferences.filter(
      (r) =>
        r.category === "QUARTERLY_FINANCIALS" ||
        (r.agentSource === "company_research" &&
          !/\b(ltp|last traded price|vwap|order block)\b/i.test(r.claim))
    );

    const supporting: string[] = [];
    const opposing: string[] = [];
    const missing: string[] = [];

    let revenueGrowth = "UNAVAILABLE";
    let profitGrowth = "UNAVAILABLE";
    let ebitdaMargins = "UNAVAILABLE";
    let debt = "UNAVAILABLE";
    let cashFlow = "UNAVAILABLE";
    let earningsConsistency = "UNAVAILABLE";

    let sawConsolidated = false;
    let sawStandalone = false;

    for (const ref of refs) {
      const lower = ref.claim.toLowerCase();
      if (/\bconsolidated\b/.test(lower)) sawConsolidated = true;
      if (/\bstandalone\b/.test(lower)) sawStandalone = true;

      if (conflictedIds.has(ref.evidenceId)) {
        continue;
      }

      const num =
        typeof ref.value === "number" && Number.isFinite(ref.value)
          ? ref.value
          : null;
      const valLabel = `${String(ref.value)}${ref.unit ? " " + ref.unit : ""}`;

      if (/\b(revenue growth|quarterly revenue growth|sales growth)\b/.test(lower)) {
        revenueGrowth = valLabel;
        if (num !== null && num > 10) supporting.push(ref.evidenceId);
        else if (num !== null && num < 0) opposing.push(ref.evidenceId);
      } else if (/\b(profit growth|pat growth|earnings growth|net profit growth)\b/.test(lower)) {
        profitGrowth = valLabel;
        if (num !== null && num > 10) supporting.push(ref.evidenceId);
        else if (num !== null && num < 0) opposing.push(ref.evidenceId);
      } else if (/\b(ebitda margin|operating margin|ebitda)\b/.test(lower)) {
        ebitdaMargins = valLabel;
        if (num !== null && num >= 15) supporting.push(ref.evidenceId);
        else if (num !== null && num < 8) opposing.push(ref.evidenceId);
      } else if (/\b(debt|leverage)\b/.test(lower)) {
        debt = valLabel;
        if (num !== null && num <= 0.5 && num >= 0) supporting.push(ref.evidenceId);
        else if (num !== null && num > 1.5) opposing.push(ref.evidenceId);
      } else if (/\b(cash flow|ocf|fcf)\b/.test(lower)) {
        cashFlow = valLabel;
        if (num !== null && num > 0) supporting.push(ref.evidenceId);
        else if (num !== null && num < 0) opposing.push(ref.evidenceId);
      } else if (/\b(roe|return on equity|roce|earnings consistency|eps)\b/.test(lower)) {
        earningsConsistency = valLabel;
        if (num !== null && num >= 15) supporting.push(ref.evidenceId);
        else if (num !== null && num < 8) opposing.push(ref.evidenceId);
      }
    }

    if (revenueGrowth === "UNAVAILABLE") missing.push("Revenue growth unavailable");
    if (profitGrowth === "UNAVAILABLE") missing.push("Profit growth unavailable");
    if (ebitdaMargins === "UNAVAILABLE") missing.push("EBITDA margin unavailable");
    if (debt === "UNAVAILABLE") missing.push("Debt / leverage metric unavailable");
    if (cashFlow === "UNAVAILABLE") missing.push("Operating/free cash flow unavailable");

    const fundamentalConflicts = context.conflicts
      .filter((c) =>
        c.evidenceIds.some((id) => refs.some((r) => r.evidenceId === id)) ||
        /\b(consolidated|standalone|reporting period|revenue|profit|ebitda|debt|roe)\b/i.test(
          `${c.claim} ${c.resolutionReason ?? ""}`
        )
      )
      .map((c) => `${c.claim}: ${c.resolutionReason ?? "Conflicting values"}`);

    if ( fundamentalConflicts.some((c) => /consolidated and standalone/i.test(c)) ) {
      sawConsolidated = true;
      sawStandalone = true;
    }

    const reportingBasis: FundamentalQualityBreakdown["reportingBasis"] =
      sawConsolidated && sawStandalone
        ? "MIXED_CONFLICT"
        : sawConsolidated
          ? "CONSOLIDATED"
          : sawStandalone
            ? "STANDALONE"
            : "UNSPECIFIED";

    const hasPeriodConflict =
      context.researchPeriod.incompatiblePeriodsRejected.length > 0 ||
      fundamentalConflicts.some((c) => /incompatible reporting periods/i.test(c));

    const reportingPeriodCompatibility: FundamentalQualityBreakdown["reportingPeriodCompatibility"] =
      hasPeriodConflict
        ? "INCOMPATIBLE_PERIODS_DETECTED"
        : context.researchPeriod.detectedPeriods.length > 0
          ? "COMPATIBLE"
          : "UNSPECIFIED";

    let assessment: PillarQualitativeAssessment = "INSUFFICIENT_DATA";
    if (
      fundamentalConflicts.length > 0 ||
      reportingBasis === "MIXED_CONFLICT" ||
      reportingPeriodCompatibility === "INCOMPATIBLE_PERIODS_DETECTED"
    ) {
      assessment = "CONFLICTED";
    } else if (refs.length === 0) {
      assessment = "INSUFFICIENT_DATA";
    } else if (supporting.length >= 2 && opposing.length === 0) {
      assessment = missing.length <= 2 ? "STRONG" : "CONSTRUCTIVE";
    } else if (supporting.length > 0 && opposing.length === 0) {
      assessment = "CONSTRUCTIVE";
    } else if (opposing.length > 0 && supporting.length === 0) {
      assessment = "WEAK";
    } else {
      assessment = "MIXED";
    }

    const freshnessLimitations = getFreshnessLimitations(refs);

    return {
      pillar: "FUNDAMENTAL_QUALITY",
      title: "1. Fundamental Quality",
      assessment,
      supportingEvidenceIds: Array.from(new Set(supporting)),
      opposingEvidenceIds: Array.from(new Set(opposing)),
      missingData: missing,
      conflicts: fundamentalConflicts,
      freshnessLimitations,
      explanation:
        assessment === "CONFLICTED"
          ? `Fundamental assessment is CONFLICTED due to ${fundamentalConflicts.length} discrepancy(ies) or reporting period/basis incompatibility.`
          : refs.length === 0
            ? "No verified fundamental financial records available."
            : `Evaluated ${refs.length} fundamental record(s): ${supporting.length} supporting, ${opposing.length} opposing (${missing.length} sub-metric(s) unavailable).`,
      fundamentalBreakdown: {
        revenueGrowth,
        profitGrowth,
        ebitdaMargins,
        debt,
        cashFlow,
        earningsConsistency,
        reportingBasis,
        reportingPeriodCompatibility,
      },
    };
  }

  private buildInstitutionalActivityPillar(
    context: UnifiedIntelligenceContext,
    conflictedIds: Set<string>
  ): ScorecardPillarResult {
    const refs = context.evidenceReferences.filter(
      (r) =>
        r.category === "INSTITUTIONAL_HOLDING" ||
        r.agentSource === "institutional_intelligence"
    );

    const supporting: string[] = [];
    const opposing: string[] = [];
    const missing: string[] = [];

    let fiiActivity = "UNAVAILABLE";
    let diiActivity = "UNAVAILABLE";
    let mutualFundOwnership = "UNAVAILABLE";
    let promoterHolding = "UNAVAILABLE";
    let promoterPledge = "UNAVAILABLE";
    let hasExplicitFlowData = false;

    for (const ref of refs) {
      const lower = ref.claim.toLowerCase();
      const num =
        typeof ref.value === "number" && Number.isFinite(ref.value)
          ? ref.value
          : null;
      const valStr = `${String(ref.value)}${ref.unit ? " " + ref.unit : ""}`;
      const isFlow = isFlowClaim(lower);

      if (conflictedIds.has(ref.evidenceId)) {
        continue;
      }

      if (/\bpledge\b/.test(lower)) {
        promoterPledge = valStr;
        if (num !== null && num === 0) supporting.push(ref.evidenceId);
        else if (num !== null && num > 10) opposing.push(ref.evidenceId);
      } else if (/\bpromoter\b/.test(lower)) {
        promoterHolding = isFlow
          ? `${valStr} (Flow/Change)`
          : `${valStr} (Static Ownership — not flow)`;
        if (isFlow && num !== null) {
          hasExplicitFlowData = true;
          if (num > 0) supporting.push(ref.evidenceId);
          else if (num < 0) opposing.push(ref.evidenceId);
        } else if (num !== null && num < 25) {
          opposing.push(ref.evidenceId);
        }
      } else if (/\b(mutual fund|mf)\b/.test(lower)) {
        mutualFundOwnership = isFlow
          ? `${valStr} (Flow/Change)`
          : `${valStr} (Static Ownership — not flow)`;
        if (isFlow && num !== null) {
          hasExplicitFlowData = true;
          if (num > 0) supporting.push(ref.evidenceId);
          else if (num < 0) opposing.push(ref.evidenceId);
        }
      } else if (/\bdii\b/.test(lower)) {
        diiActivity = isFlow
          ? `${valStr} (Explicit Flow)`
          : `${valStr} (Static Ownership — not flow)`;
        if (isFlow) {
          hasExplicitFlowData = true;
          if (num !== null && num > 0) supporting.push(ref.evidenceId);
          else if (num !== null && num < 0) opposing.push(ref.evidenceId);
        }
      } else if (/\b(fii|foreign institutional|institutional)\b/.test(lower)) {
        fiiActivity = isFlow
          ? `${valStr} (Explicit Flow)`
          : `${valStr} (Static Ownership — not flow)`;
        if (isFlow) {
          hasExplicitFlowData = true;
          if (num !== null && num > 0) supporting.push(ref.evidenceId);
          else if (num !== null && num < 0) opposing.push(ref.evidenceId);
        }
      }
    }

    if (fiiActivity === "UNAVAILABLE") missing.push("FII flow/ownership unavailable");
    if (diiActivity === "UNAVAILABLE") missing.push("DII flow/ownership unavailable");
    if (mutualFundOwnership === "UNAVAILABLE")
      missing.push("Mutual fund ownership unavailable");
    if (promoterHolding === "UNAVAILABLE")
      missing.push("Promoter holding unavailable");
    if (promoterPledge === "UNAVAILABLE")
      missing.push("Promoter pledge disclosure unavailable");

    const instConflicts = context.conflicts
      .filter((c) =>
        c.evidenceIds.some((id) => refs.some((r) => r.evidenceId === id))
      )
      .map((c) => `${c.claim}: ${c.resolutionReason ?? "Conflicting values"}`);

    const ownershipVsFlowDistinction = hasExplicitFlowData
      ? "Explicit period-over-period institutional flow/change evidence is present and distinguished from static shareholding percentages."
      : "Only static shareholding percentages are available; active institutional buying/accumulation is NEVER inferred from static ownership levels alone.";

    let assessment: PillarQualitativeAssessment = "INSUFFICIENT_DATA";
    if (instConflicts.length > 0) {
      assessment = "CONFLICTED";
    } else if (refs.length === 0) {
      assessment = "INSUFFICIENT_DATA";
    } else if (opposing.length > 0 && supporting.length === 0) {
      assessment = "WEAK";
    } else if (hasExplicitFlowData && supporting.length > 0 && opposing.length === 0) {
      assessment = supporting.length >= 2 ? "STRONG" : "CONSTRUCTIVE";
    } else {
      // Static shareholding alone (without flow data) is classified as MIXED rather than STRONG/CONSTRUCTIVE accumulation
      assessment = "MIXED";
    }

    return {
      pillar: "INSTITUTIONAL_ACTIVITY",
      title: "2. Institutional Activity",
      assessment,
      supportingEvidenceIds: Array.from(new Set(supporting)),
      opposingEvidenceIds: Array.from(new Set(opposing)),
      missingData: missing,
      conflicts: instConflicts,
      freshnessLimitations: getFreshnessLimitations(refs),
      explanation: `${ownershipVsFlowDistinction} (${supporting.length} flow/governance support item(s), ${opposing.length} opposing/distribution item(s)).`,
      institutionalBreakdown: {
        fiiActivity,
        diiActivity,
        mutualFundOwnership,
        promoterHolding,
        promoterPledge,
        hasExplicitFlowData,
        ownershipVsFlowDistinction,
      },
    };
  }

  private buildMarketAlignmentPillar(
    context: UnifiedIntelligenceContext,
    conflictedIds: Set<string>
  ): ScorecardPillarResult {
    const refs = context.evidenceReferences.filter(
      (r) =>
        r.category === "INTRADAY_PRICE" ||
        r.category === "DAILY_MARKET_DATA" ||
        r.agentSource === "market_intelligence"
    );

    const supporting: string[] = [];
    const opposing: string[] = [];
    const missing: string[] = [];

    let marketRegime = "UNAVAILABLE";
    let indexTrend = "UNAVAILABLE";
    let sectorContext = "UNAVAILABLE";
    let volatilityConditions = "UNAVAILABLE";

    for (const ref of refs) {
      if (conflictedIds.has(ref.evidenceId)) continue;
      const lower = ref.claim.toLowerCase();
      const valStr = String(ref.value);
      const num =
        typeof ref.value === "number" && Number.isFinite(ref.value)
          ? ref.value
          : null;

      if (/\b(vix|volatility)\b/.test(lower)) {
        volatilityConditions = `${valStr}${ref.unit ? " " + ref.unit : ""}`;
        if (num !== null && num <= 14) supporting.push(ref.evidenceId);
        else if (num !== null && num >= 20) opposing.push(ref.evidenceId);
      } else if (/\b(nifty|banknifty|sensex|index)\b/.test(lower)) {
        indexTrend = `${ref.claim}: ${valStr}`;
        if (/\b(bullish|uptrend|above)\b/i.test(valStr)) supporting.push(ref.evidenceId);
        else if (/\b(bearish|downtrend|below)\b/i.test(valStr)) opposing.push(ref.evidenceId);
      } else if (/\bsector\b/.test(lower)) {
        sectorContext = `${ref.claim}: ${valStr}`;
      } else if (/\b(vwap|order block|regime|trend)\b/.test(lower)) {
        marketRegime = `${ref.claim}: ${valStr}`;
        if (/\b(above_vwap|bullish)\b/i.test(valStr)) supporting.push(ref.evidenceId);
        else if (/\b(below_vwap|bearish)\b/i.test(valStr)) opposing.push(ref.evidenceId);
      }
    }

    if (marketRegime === "UNAVAILABLE") missing.push("Market regime / structure unavailable");
    if (indexTrend === "UNAVAILABLE") missing.push("Benchmark index trend unavailable");
    if (sectorContext === "UNAVAILABLE") missing.push("Sector context unavailable");
    if (volatilityConditions === "UNAVAILABLE") missing.push("Volatility / India VIX unavailable");

    const alignB = context.crossAgentSynthesis?.alignments.find(
      (a) => a.dimension === "COMPANY_AND_MARKET_BEHAVIOR"
    );
    const companyMarketAlignment = alignB ? `${alignB.status} (${alignB.summary})` : "INSUFFICIENT_EVIDENCE";

    const mktConflicts = context.conflicts
      .filter((c) =>
        c.evidenceIds.some((id) => refs.some((r) => r.evidenceId === id))
      )
      .map((c) => `${c.claim}: ${c.resolutionReason ?? "Conflicting values"}`);

    let assessment: PillarQualitativeAssessment = "INSUFFICIENT_DATA";
    if (mktConflicts.length > 0) {
      assessment = "CONFLICTED";
    } else if (refs.length === 0) {
      assessment = "INSUFFICIENT_DATA";
    } else if (supporting.length > 0 && opposing.length === 0) {
      assessment = supporting.length >= 2 ? "STRONG" : "CONSTRUCTIVE";
    } else if (opposing.length > 0 && supporting.length === 0) {
      assessment = "WEAK";
    } else {
      assessment = "MIXED";
    }

    return {
      pillar: "MARKET_ALIGNMENT",
      title: "3. Market Alignment",
      assessment,
      supportingEvidenceIds: Array.from(new Set(supporting)),
      opposingEvidenceIds: Array.from(new Set(opposing)),
      missingData: missing,
      conflicts: mktConflicts,
      freshnessLimitations: getFreshnessLimitations(refs),
      explanation:
        refs.length === 0
          ? "No market telemetry records available."
          : `Market alignment evaluated across ${refs.length} record(s) (read-only context, not an execution signal).`,
      marketBreakdown: {
        marketRegime,
        indexTrend,
        sectorContext,
        companyMarketAlignment,
        volatilityConditions,
      },
    };
  }

  private buildNewsMacroPillar(
    context: UnifiedIntelligenceContext,
    conflictedIds: Set<string>
  ): ScorecardPillarResult {
    const refs = context.evidenceReferences.filter(
      (r) =>
        r.category === "THIRD_PARTY_NEWS" ||
        r.category === "COMPANY_ANNOUNCEMENT" ||
        r.category === "REGULATORY_FILING" ||
        r.agentSource === "news_macro"
    );

    const currentRefs = refs.filter(
      (r) =>
        r.freshnessStatus !== "EXPIRED" &&
        r.granularFreshness !== "EXPIRED"
    );
    const expiredRefsCount = refs.length - currentRefs.length;

    const supporting: string[] = [];
    const opposing: string[] = [];
    const missing: string[] = [];

    // Expired news/macro records are preserved for historical context only
    // and must never be treated as current positive or negative market evidence.
    for (const ref of currentRefs) {
      if (conflictedIds.has(ref.evidenceId)) continue;
      const text = `${ref.claim} ${String(ref.value)}`.toLowerCase();
      if (/\b(order win|contract win|upgrade|expansion|rate cut|approval|positive|dividend)\b/.test(text)) {
        supporting.push(ref.evidenceId);
      } else if (/\b(downgrade|penalty|default|lawsuit|investigation|rate hike|inflation spike|headwind|negative|fraud)\b/.test(text)) {
        opposing.push(ref.evidenceId);
      }
    }

    if (refs.length === 0) {
      missing.push("No verified company announcements, regulatory filings, or macro news available");
    } else if (currentRefs.length === 0) {
      missing.push(
        `All ${refs.length} news/macro record(s) are expired; no current news/macro evidence available (historical records preserved for context)`
      );
    }

    let assessment: PillarQualitativeAssessment = "INSUFFICIENT_DATA";
    if (refs.length === 0) {
      assessment = "INSUFFICIENT_DATA";
    } else if (currentRefs.length === 0) {
      assessment = "INSUFFICIENT_CURRENT_EVIDENCE";
    } else if (supporting.length > 0 && opposing.length === 0) {
      assessment = "CONSTRUCTIVE";
    } else if (opposing.length > 0 && supporting.length === 0) {
      assessment = "WEAK";
    } else {
      assessment = "MIXED";
    }

    return {
      pillar: "NEWS_AND_MACRO_ENVIRONMENT",
      title: "4. News & Macro Environment",
      assessment,
      supportingEvidenceIds: Array.from(new Set(supporting)),
      opposingEvidenceIds: Array.from(new Set(opposing)),
      missingData: missing,
      conflicts: [],
      freshnessLimitations: getFreshnessLimitations(refs),
      explanation:
        refs.length === 0
          ? "No news or macro evidence available."
          : currentRefs.length === 0
            ? `INSUFFICIENT_CURRENT_EVIDENCE: All ${refs.length} news/macro record(s) are expired and retained as historical context only; not treated as current positive or negative market evidence.`
            : `Evaluated ${currentRefs.length} current news/macro/filing record(s)${expiredRefsCount > 0 ? ` (${expiredRefsCount} expired historical record(s) excluded from current signal)` : ""}: ${supporting.length} positive catalyst(s), ${opposing.length} headwind/risk item(s).`,
    };
  }

  private buildSupportedRisks(
    context: UnifiedIntelligenceContext,
    fundamental: ScorecardPillarResult,
    institutional: ScorecardPillarResult,
    market: ScorecardPillarResult,
    newsMacro: ScorecardPillarResult
  ): InstitutionalRiskItem[] {
    const risks: InstitutionalRiskItem[] = [];
    const synthRisks = context.crossAgentSynthesis?.riskFindings ?? [];

    for (const sr of synthRisks) {
      if (sr.category === "FINANCIAL_DETERIORATION") {
        risks.push({
          category: "EARNINGS_DETERIORATION",
          severity: sr.severity,
          summary: sr.description,
          evidenceIds: sr.evidenceIds,
          missingDataNotAssumedZeroRisk: false,
        });
      } else if (sr.category === "DEBT_AND_LEVERAGE") {
        risks.push({
          category: "DEBT_AND_LEVERAGE",
          severity: sr.severity,
          summary: sr.description,
          evidenceIds: sr.evidenceIds,
          missingDataNotAssumedZeroRisk: false,
        });
      } else if (sr.category === "CASH_FLOW_WEAKNESS") {
        risks.push({
          category: "CASH_FLOW_WEAKNESS",
          severity: sr.severity,
          summary: sr.description,
          evidenceIds: sr.evidenceIds,
          missingDataNotAssumedZeroRisk: false,
        });
      } else if (sr.category === "INSTITUTIONAL_SELLING") {
        risks.push({
          category: "INSTITUTIONAL_DISTRIBUTION",
          severity: sr.severity,
          summary: sr.description,
          evidenceIds: sr.evidenceIds,
          missingDataNotAssumedZeroRisk: false,
        });
      } else if (sr.category === "PROMOTER_PLEDGE") {
        risks.push({
          category: "PROMOTER_PLEDGE",
          severity: sr.severity,
          summary: sr.description,
          evidenceIds: sr.evidenceIds,
          missingDataNotAssumedZeroRisk: false,
        });
      } else if (sr.category === "NEGATIVE_NEWS") {
        risks.push({
          category: "NEGATIVE_NEWS",
          severity: sr.severity,
          summary: sr.description,
          evidenceIds: sr.evidenceIds,
          missingDataNotAssumedZeroRisk: false,
        });
      } else if (sr.category === "MARKET_VOLATILITY") {
        risks.push({
          category: "MARKET_VOLATILITY",
          severity: sr.severity,
          summary: sr.description,
          evidenceIds: sr.evidenceIds,
          missingDataNotAssumedZeroRisk: false,
        });
      }
    }

    if (context.conflicts.length > 0) {
      risks.push({
        category: "EVIDENCE_CONFLICTS",
        severity: "HIGH",
        summary: `${context.conflicts.length} unresolved conflict(s) detected across evidence sources.`,
        evidenceIds: Array.from(new Set(context.conflicts.flatMap((c) => c.evidenceIds))),
        missingDataNotAssumedZeroRisk: false,
      });
    }

    const staleOrUnknownIds = context.evidenceReferences
      .filter((r) => r.freshnessStatus !== "FRESH" || r.granularFreshness === "UNKNOWN")
      .map((r) => r.evidenceId);

    const totalMissing =
      context.missingData.length +
      fundamental.missingData.length +
      institutional.missingData.length +
      market.missingData.length +
      newsMacro.missingData.length;

    if (totalMissing > 0 || staleOrUnknownIds.length > 0) {
      risks.push({
        category: "MISSING_OR_STALE_INFORMATION",
        severity: staleOrUnknownIds.length > 0 ? "MODERATE" : "LOW",
        summary: `Unavailable metrics (${context.missingData.length} context-level missing item(s)) and ${staleOrUnknownIds.length} stale/expired/unverified-timestamp record(s) create blind spots; missing data is never treated as zero risk.`,
        evidenceIds: staleOrUnknownIds,
        missingDataNotAssumedZeroRisk: true,
      });
    }

    return risks;
  }

  private buildFinancialRiskPillar(
    context: UnifiedIntelligenceContext,
    supportedRisks: InstitutionalRiskItem[]
  ): ScorecardPillarResult {
    const highRisks = supportedRisks.filter((r) => r.severity === "HIGH");
    const nonInfoRisks = supportedRisks.filter(
      (r) => r.category !== "MISSING_OR_STALE_INFORMATION"
    );
    const riskEvidenceIds = Array.from(
      new Set(nonInfoRisks.flatMap((r) => r.evidenceIds))
    );

    let assessment: PillarQualitativeAssessment = "MIXED";
    if (context.evidenceReferences.length === 0) {
      assessment = "INSUFFICIENT_DATA";
    } else if (highRisks.some((r) => r.category === "EVIDENCE_CONFLICTS")) {
      assessment = "CONFLICTED";
    } else if (highRisks.length > 0) {
      assessment = "HIGH_RISK";
    } else if (nonInfoRisks.length > 0) {
      assessment = "WEAK";
    } else if (context.missingData.length > 0) {
      // Never treat missing data as zero risk / STRONG
      assessment = "MIXED";
    } else {
      assessment = "CONSTRUCTIVE";
    }

    return {
      pillar: "FINANCIAL_RISK",
      title: "5. Financial & Operational Risk",
      assessment,
      supportingEvidenceIds: [],
      opposingEvidenceIds: riskEvidenceIds,
      missingData: [...context.missingData],
      conflicts: context.conflicts.map(
        (c) => `${c.claim}: ${c.resolutionReason ?? "Unresolved conflict"}`
      ),
      freshnessLimitations: getFreshnessLimitations(context.evidenceReferences),
      explanation:
        nonInfoRisks.length > 0
          ? `${nonInfoRisks.length} active evidence-backed risk category(ies) triggered (${nonInfoRisks.map((r) => r.category).join(", ")}).`
          : context.missingData.length > 0
            ? "No explicit risk threshold breached in available records, but missing data prevents a low-risk classification (missing data is never assumed zero risk)."
            : "No financial, leverage, pledge, or volatility risk thresholds breached across complete evidence.",
    };
  }

  private buildEvidenceQualityPillar(
    context: UnifiedIntelligenceContext
  ): ScorecardPillarResult {
    const qa = context.qualityAssessment;
    const verifiedFreshIds = context.evidenceReferences
      .filter(
        (r) =>
          r.verificationStatus === "VERIFIED" &&
          r.freshnessStatus === "FRESH" &&
          r.granularFreshness !== "UNKNOWN"
      )
      .map((r) => r.evidenceId);
    const problematicIds = context.evidenceReferences
      .filter(
        (r) =>
          r.verificationStatus === "CONFLICTED" ||
          r.freshnessStatus !== "FRESH" ||
          r.granularFreshness === "UNKNOWN"
      )
      .map((r) => r.evidenceId);

    let assessment: PillarQualitativeAssessment = "INSUFFICIENT_DATA";
    if (qa.qualityClassification === "COMPLETE") {
      assessment = "STRONG";
    } else if (qa.qualityClassification === "PARTIAL") {
      assessment = qa.conflictedEvidenceCount > 0 ? "CONFLICTED" : "MIXED";
    } else {
      assessment = "INSUFFICIENT_DATA";
    }

    return {
      pillar: "EVIDENCE_QUALITY",
      title: "6. Evidence Quality",
      assessment,
      supportingEvidenceIds: verifiedFreshIds,
      opposingEvidenceIds: problematicIds,
      missingData: [...context.missingData],
      conflicts: context.conflicts.map(
        (c) => `${c.claim}: ${c.resolutionReason ?? "Unresolved conflict"}`
      ),
      freshnessLimitations: getFreshnessLimitations(context.evidenceReferences),
      explanation: `Context quality is ${qa.qualityClassification}: ${qa.availableEvidenceCount} available record(s), ${qa.staleEvidenceCount} stale, ${qa.expiredEvidenceCount} expired, ${qa.conflictedEvidenceCount} conflicted, ${qa.completedAgentsCount} completed agent(s), ${qa.failedAgentsCount} failed, ${qa.skippedAgentsCount} skipped.`,
    };
  }

  public buildHistoricalChanges(
    current: UnifiedIntelligenceContext,
    previousContexts: UnifiedIntelligenceContext[]
  ): HistoricalEvidenceChanges {
    const validPrevious = previousContexts
      .filter(
        (p) =>
          p &&
          p.userId === current.userId &&
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
        improvedEvidence: [],
        deterioratedEvidence: [],
        newConflicts: [],
        resolvedConflicts: [],
        newMissingInformation: [],
        summary:
          "NO_HISTORICAL_CONTEXT: No previous persisted context exists for this authenticated user and symbol.",
      };
    }

    const prevByClaim = new Map<string, PreservedEvidenceReference>();
    for (const ref of validPrevious.evidenceReferences) {
      const key = ref.claim.trim().toLowerCase().replace(/\s+/g, " ");
      if (!prevByClaim.has(key)) prevByClaim.set(key, ref);
    }

    const improvedEvidence: HistoricalEvidenceChangeItem[] = [];
    const deterioratedEvidence: HistoricalEvidenceChangeItem[] = [];

    for (const currRef of current.evidenceReferences) {
      const key = currRef.claim.trim().toLowerCase().replace(/\s+/g, " ");
      const prevRef = prevByClaim.get(key);
      if (!prevRef) continue;

      if (typeof prevRef.value === "number" && typeof currRef.value === "number") {
        if (currRef.value === prevRef.value) continue;
        const lowerIsBetter = /\b(debt|leverage|pledge|vix|volatility)\b/.test(key);
        const isImproved = lowerIsBetter
          ? currRef.value < prevRef.value
          : currRef.value > prevRef.value;
        const item: HistoricalEvidenceChangeItem = {
          claim: currRef.claim,
          previousValue: prevRef.value,
          currentValue: currRef.value,
          unit: currRef.unit ?? prevRef.unit ?? null,
          previousEvidenceId: prevRef.evidenceId,
          currentEvidenceId: currRef.evidenceId,
          previousTimestamp: prevRef.publicationTimestamp ?? prevRef.retrievalTimestamp,
          currentTimestamp: currRef.publicationTimestamp ?? currRef.retrievalTimestamp,
          explanation: `${currRef.claim} moved from ${prevRef.value} to ${currRef.value}${currRef.unit ? " " + currRef.unit : ""}.`,
        };
        if (isImproved) improvedEvidence.push(item);
        else deterioratedEvidence.push(item);
      }
    }

    const prevConflictsMap = new Map(
      (validPrevious.conflicts ?? []).map((c) => [c.conflictKey, c])
    );
    const currConflictsMap = new Map(
      current.conflicts.map((c) => [c.conflictKey, c])
    );

    const newConflicts = current.conflicts
      .filter((c) => !prevConflictsMap.has(c.conflictKey))
      .map((c) => ({
        conflictKey: c.conflictKey,
        claim: c.claim,
        reason: c.resolutionReason,
      }));

    const resolvedConflicts = Array.from(prevConflictsMap.values())
      .filter((c) => !currConflictsMap.has(c.conflictKey))
      .map((c) => ({
        conflictKey: c.conflictKey,
        claim: c.claim,
      }));

    const prevMissingSet = new Set(validPrevious.missingData ?? []);
    const newMissingInformation = current.missingData.filter(
      (m) => !prevMissingSet.has(m)
    );

    return {
      status: "COMPARED",
      previousContextId: validPrevious.contextId,
      previousTimestamp: validPrevious.createdAt,
      currentTimestamp: current.createdAt,
      improvedEvidence,
      deterioratedEvidence,
      newConflicts,
      resolvedConflicts,
      newMissingInformation,
      summary: `Historical comparison vs ${validPrevious.contextId}: ${improvedEvidence.length} improved, ${deterioratedEvidence.length} deteriorated, ${newConflicts.length} new conflict(s), ${resolvedConflicts.length} resolved conflict(s), ${newMissingInformation.length} new missing item(s).`,
    };
  }

  /**
   * Ranks companies with sufficient comparable evidence only.
   * Never fabricates numeric scores or treats missing data as zero risk.
   */
  public rankCompanies(
    contexts: UnifiedIntelligenceContext[]
  ): CompanyResearchRankingResult {
    const scorecards = contexts.map((ctx) => ({
      ctx,
      scorecard: ctx.researchScorecard ?? this.buildScorecard(ctx),
    }));

    // Check if peer group has an explicit dominant reporting basis (e.g. CONSOLIDATED)
    const explicitBases = scorecards
      .map(
        (s) =>
          s.scorecard.pillars.find((p) => p.pillar === "FUNDAMENTAL_QUALITY")
            ?.fundamentalBreakdown?.reportingBasis
      )
      .filter((b) => b === "CONSOLIDATED" || b === "STANDALONE");
    const hasConsolidatedPeer = explicitBases.includes("CONSOLIDATED");
    const hasStandalonePeer = explicitBases.includes("STANDALONE");
    const mixedPeerBases = hasConsolidatedPeer && hasStandalonePeer;

    // Determine dominant reporting period across peers if specified
    const periodCounts = new Map<string, number>();
    for (const { ctx } of scorecards) {
      const p =
        ctx.researchPeriod.requestedPeriod ??
        ctx.researchPeriod.detectedPeriods[0] ??
        null;
      if (p) {
        periodCounts.set(p, (periodCounts.get(p) ?? 0) + 1);
      }
    }
    let dominantPeerPeriod: string | null = null;
    let dominantPeriodCount = 0;
    for (const [period, count] of periodCounts.entries()) {
      if (count > dominantPeriodCount) {
        dominantPeerPeriod = period;
        dominantPeriodCount = count;
      }
    }

    const eligible: Array<{
      ctx: UnifiedIntelligenceContext;
      scorecard: ResearchIntelligenceScorecard;
      supportingPillarCount: number;
      weakOrRiskPillarCount: number;
      evidenceTier: ResearchRankingTier;
      reasons: string[];
    }> = [];
    const unrankedCompanies: UnrankedCompanyEntry[] = [];

    for (const { ctx, scorecard } of scorecards) {
      const unrankedReasons: string[] = [];
      const fundPillar = scorecard.pillars.find(
        (p) => p.pillar === "FUNDAMENTAL_QUALITY"
      )!;

      if (ctx.contextStatus === "INSUFFICIENT_DATA" || ctx.qualityAssessment.availableEvidenceCount < 2) {
        unrankedReasons.push(
          `Insufficient available evidence (${ctx.qualityAssessment.availableEvidenceCount} record(s); minimum 2 comparable records required).`
        );
      }
      if (fundPillar.assessment === "INSUFFICIENT_DATA") {
        unrankedReasons.push("Missing Fundamental Quality evidence.");
      }
      if (fundPillar.assessment === "CONFLICTED") {
        unrankedReasons.push(
          "Unresolved conflict or incompatible reporting period/basis in Fundamental Quality."
        );
      }
      if (
        fundPillar.fundamentalBreakdown?.reportingPeriodCompatibility ===
        "INCOMPATIBLE_PERIODS_DETECTED"
      ) {
        unrankedReasons.push("Incompatible financial reporting periods detected.");
      }
      if (
        mixedPeerBases &&
        fundPillar.fundamentalBreakdown?.reportingBasis === "STANDALONE"
      ) {
        unrankedReasons.push(
          "Incomparable financial reporting basis: STANDALONE statements cannot be ranked directly against CONSOLIDATED peers."
        );
      }
      const companyPeriod =
        ctx.researchPeriod.requestedPeriod ??
        ctx.researchPeriod.detectedPeriods[0] ??
        null;
      if (
        dominantPeerPeriod &&
        dominantPeriodCount >= 2 &&
        companyPeriod &&
        companyPeriod !== dominantPeerPeriod
      ) {
        unrankedReasons.push(
          `Incomparable reporting period (${companyPeriod}) vs peer group reference period (${dominantPeerPeriod}).`
        );
      }

      const conflictsList = ctx.conflicts.map(
        (c) => `${c.claim}: ${c.resolutionReason ?? "Unresolved conflict"}`
      );

      if (unrankedReasons.length > 0) {
        unrankedCompanies.push({
          symbol: ctx.symbol,
          contextId: ctx.contextId,
          unrankedReasons,
          missingData: [...ctx.missingData],
          conflicts: conflictsList,
          note: "Excluded from comparative ranking due to insufficient or incomparable evidence; unavailable data is not assumed to be zero risk.",
        });
        continue;
      }

      const supportingPillarCount = scorecard.pillars.filter(
        (p) => p.assessment === "STRONG" || p.assessment === "CONSTRUCTIVE"
      ).length;
      const weakOrRiskPillarCount = scorecard.pillars.filter(
        (p) =>
          p.assessment === "WEAK" ||
          p.assessment === "HIGH_RISK" ||
          p.assessment === "CONFLICTED"
      ).length;

      let evidenceTier: ResearchRankingTier = "TIER_3_MIXED_OR_CAUTIOUS";
      if (
        supportingPillarCount >= 4 &&
        weakOrRiskPillarCount === 0 &&
        ctx.conflicts.length === 0
      ) {
        evidenceTier = "TIER_1_STRONG_EVIDENCE";
      } else if (
        supportingPillarCount >= 2 &&
        weakOrRiskPillarCount === 0 &&
        ctx.conflicts.length === 0
      ) {
        evidenceTier = "TIER_2_CONSTRUCTIVE_EVIDENCE";
      } else if (weakOrRiskPillarCount >= 2 || ctx.conflicts.length > 0) {
        evidenceTier = "TIER_4_ELEVATED_RISK";
      }

      const reasons: string[] = [
        `Classified in ${evidenceTier} (${supportingPillarCount} constructive/strong pillar(s), ${weakOrRiskPillarCount} weak/risk pillar(s)).`,
        `Fundamental Quality: ${fundPillar.assessment}; Evidence Quality: ${ctx.qualityAssessment.qualityClassification}.`,
      ];
      if (ctx.missingData.length > 0) {
        reasons.push(
          `Includes ${ctx.missingData.length} missing data item(s) explicitly factored as uncertainty.`
        );
      }

      eligible.push({
        ctx,
        scorecard,
        supportingPillarCount,
        weakOrRiskPillarCount,
        evidenceTier,
        reasons,
      });
    }

    const tierOrder: Record<ResearchRankingTier, number> = {
      TIER_1_STRONG_EVIDENCE: 1,
      TIER_2_CONSTRUCTIVE_EVIDENCE: 2,
      TIER_3_MIXED_OR_CAUTIOUS: 3,
      TIER_4_ELEVATED_RISK: 4,
    };

    eligible.sort((a, b) => {
      const tierDiff = tierOrder[a.evidenceTier] - tierOrder[b.evidenceTier];
      if (tierDiff !== 0) return tierDiff;
      const netA = a.supportingPillarCount - a.weakOrRiskPillarCount;
      const netB = b.supportingPillarCount - b.weakOrRiskPillarCount;
      if (netB !== netA) return netB - netA;
      return (
        b.ctx.qualityAssessment.availableEvidenceCount -
        a.ctx.qualityAssessment.availableEvidenceCount
      );
    });

    const rankedCompanies: RankedCompanyEntry[] = eligible.map((item, idx) => ({
      rank: idx + 1,
      symbol: item.ctx.symbol,
      contextId: item.ctx.contextId,
      evidenceTier: item.evidenceTier,
      supportingPillarCount: item.supportingPillarCount,
      weakOrRiskPillarCount: item.weakOrRiskPillarCount,
      availableEvidenceCount: item.ctx.qualityAssessment.availableEvidenceCount,
      rankingReasons: item.reasons,
      missingData: [...item.ctx.missingData],
      conflicts: item.ctx.conflicts.map(
        (c) => `${c.claim}: ${c.resolutionReason ?? "Unresolved conflict"}`
      ),
      advisoryNote: SCORECARD_ADVISORY_DISCLAIMER,
    }));

    return {
      generatedAt: new Date().toISOString(),
      readOnly: true,
      methodologyNote: RANKING_METHODOLOGY_NOTE,
      advisoryDisclaimer: SCORECARD_ADVISORY_DISCLAIMER,
      rankedCompanies,
      unrankedCompanies,
    };
  }
}

export const institutionalResearchIntelligenceService =
  new InstitutionalResearchIntelligenceService();
