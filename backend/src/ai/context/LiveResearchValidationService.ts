import { AITaskTier } from "../core/ModelRouter";
import {
  EvidenceRecord,
  EvidenceValue,
  EvidenceVerificationStatus,
  GranularFreshness,
  normalizeEvidenceSymbol,
} from "../evidence/EvidenceSchema";
import {
  BriefPeerComparisonSummary,
  InstitutionalResearchBrief,
  ResearchBriefConclusion,
  ResearchBriefConfidence,
} from "./InstitutionalResearchBriefSchema";
import {
  InstitutionalResearchBriefService,
  institutionalResearchBriefService,
} from "./InstitutionalResearchBriefService";
import {
  InstitutionalResearchIntelligenceService,
  institutionalResearchIntelligenceService,
} from "./InstitutionalResearchIntelligenceService";
import {
  HistoricalEvidenceChangeItem,
  PillarQualitativeAssessment,
  RankedCompanyEntry,
  ResearchRankingTier,
  ScorecardPillarKey,
  UnrankedCompanyEntry,
} from "./ResearchIntelligenceScorecardSchema";
import {
  PreservedEvidenceReference,
  UnifiedContextStatus,
  UnifiedContextValidationError,
  UnifiedExchange,
  UnifiedIntelligenceContext,
  inferExchangeFromSymbol,
} from "./UnifiedContextSchema";
import {
  UnifiedIntelligenceContextBuilder,
  unifiedIntelligenceContextBuilder,
} from "./UnifiedIntelligenceContextBuilder";

export type ValidatedMetricKey =
  | "REVENUE"
  | "NET_PROFIT"
  | "EBITDA"
  | "EBITDA_MARGIN"
  | "DEBT"
  | "CASH_FLOW"
  | "EPS"
  | "ROE_ROCE"
  | "PROMOTER_HOLDING"
  | "PROMOTER_PLEDGE"
  | "FII_DII_ACTIVITY";

export interface LiveValidatedMetricRecord {
  metricKey: ValidatedMetricKey;
  label: string;
  status:
    | "VERIFIED_AVAILABLE"
    | "UNVERIFIED_AVAILABLE"
    | "CONFLICTED"
    | "MISSING_UNAVAILABLE";
  claim: string | null;
  value: EvidenceValue;
  unit: string | null;
  currency: string | null;
  sourceName: string | null;
  sourceUrl: string | null;
  publishedTimestamp: string | null;
  retrievedTimestamp: string | null;
  reportingPeriod: string | null;
  reportingBasis: "CONSOLIDATED" | "STANDALONE" | "UNSPECIFIED";
  verificationStatus: EvidenceVerificationStatus | "UNAVAILABLE";
  freshness: GranularFreshness | "UNAVAILABLE";
  evidenceId: string | null;
  notes: string[];
}

export type InstitutionalDisclosureType =
  | "STATIC_SHAREHOLDING_SNAPSHOT"
  | "PERIOD_OVER_PERIOD_OWNERSHIP_CHANGE"
  | "EXPLICIT_BUYING_SELLING_FLOW";

export interface InstitutionalRecordValidationItem {
  evidenceId: string;
  claim: string;
  value: EvidenceValue;
  unit: string | null;
  disclosureType: InstitutionalDisclosureType;
  directionalTreatment: "BULLISH" | "BEARISH" | "NEUTRAL_STATIC";
  sourceName: string;
  reportingPeriod: string | null;
  freshness: GranularFreshness;
  verificationStatus: EvidenceVerificationStatus;
  explanation: string;
}

export interface InstitutionalDataValidationReport {
  symbol: string;
  staticSnapshotCount: number;
  periodChangeCount: number;
  explicitFlowCount: number;
  hasExplicitFlowDisclosures: boolean;
  staticOwnershipRemainsNeutral: boolean;
  flowLimitationWarning: string | null;
  records: InstitutionalRecordValidationItem[];
}

export interface ResearchBriefQualityAuditReport {
  symbol: string;
  contextId: string;
  conclusion: ResearchBriefConclusion;
  confidenceClassification: ResearchBriefConfidence;
  passed: boolean;
  checks: {
    noUnsupportedPositiveConclusion: boolean;
    noUnsupportedNegativeConclusion: boolean;
    conflictedFundamentalsBlockPositive: boolean;
    staleEvidenceReflectedInConfidence: boolean;
    missingMetricsNeverAssumedZeroOrPositive: boolean;
    incompatiblePeriodsHandledProperly: boolean;
    agentFailuresReflectedInConfidence: boolean;
    evidenceIdIntegrityVerified: boolean;
    staticOwnershipNeverImpliesAccumulation: boolean;
  };
  violations: string[];
}

export interface ChangedPillarAssessmentItem {
  pillar: ScorecardPillarKey;
  title: string;
  previousAssessment: PillarQualitativeAssessment;
  currentAssessment: PillarQualitativeAssessment;
}

export interface HistoricalResearchSummary {
  status: "COMPARED" | "NO_HISTORICAL_CONTEXT";
  previousContextId: string | null;
  previousTimestamp: string | null;
  currentTimestamp: string;
  previousConclusion: ResearchBriefConclusion | null;
  currentConclusion: ResearchBriefConclusion;
  changedPillarAssessments: ChangedPillarAssessmentItem[];
  improvedEvidence: HistoricalEvidenceChangeItem[];
  deterioratedEvidence: HistoricalEvidenceChangeItem[];
  newConflicts: Array<{ conflictKey: string; claim: string; reason: string | null }>;
  resolvedConflicts: Array<{ conflictKey: string; claim: string }>;
  newMissingInformation: string[];
  summary: string;
}

export interface CompanyValidationBundle {
  symbol: string;
  exchange: UnifiedExchange;
  contextId: string;
  metrics: Record<ValidatedMetricKey, LiveValidatedMetricRecord>;
  institutionalValidation: InstitutionalDataValidationReport;
  briefQualityAudit: ResearchBriefQualityAuditReport;
  historicalResearch: HistoricalResearchSummary;
}

export interface PeerCompanyComparisonRow {
  symbol: string;
  exchange: UnifiedExchange;
  contextId: string;
  isTarget: boolean;
  reportingPeriod: string | null;
  reportingBasis: "CONSOLIDATED" | "STANDALONE" | "MIXED_CONFLICT" | "UNSPECIFIED";
  conclusion: ResearchBriefConclusion;
  confidenceClassification: ResearchBriefConfidence;
  evidenceQuality: UnifiedContextStatus;
  availableEvidenceCount: number;
  missingDataCount: number;
  conflictsCount: number;
  pillarAssessments: Record<ScorecardPillarKey, PillarQualitativeAssessment>;
  rank: number | null;
  rankingTier: ResearchRankingTier | null;
  unrankedReasons: string[];
}

export interface MultiCompanyPeerResearchRequest {
  userId: string;
  targetSymbol: string;
  peerSymbols?: string[];
  requestedPeriod?: string | null;
  tier?: AITaskTier;
  referenceDate?: Date;
  previousContextsForTarget?: UnifiedIntelligenceContext[];
  precollectedTargetContext?: UnifiedIntelligenceContext;
  precollectedPeerContexts?: UnifiedIntelligenceContext[];
}

export interface MultiCompanyPeerResearchResponse {
  targetSymbol: string;
  peerSymbols: string[];
  generatedAt: string;
  readOnly: true;
  peerComparisonStatus: "COMPARED" | "NO_PEER_CONTEXT" | "UNRANKED_INCOMPARABLE";
  targetContext: UnifiedIntelligenceContext;
  targetBrief: InstitutionalResearchBrief;
  targetValidation: CompanyValidationBundle;
  peerContexts: UnifiedIntelligenceContext[];
  comparisonRows: PeerCompanyComparisonRow[];
  rankedCompanies: RankedCompanyEntry[];
  unrankedCompanies: UnrankedCompanyEntry[];
  peerComparisonSummary: BriefPeerComparisonSummary;
  advisoryDisclaimer: string;
}

const METRIC_SPECS: Array<{
  key: ValidatedMetricKey;
  label: string;
  pattern: RegExp;
}> = [
  {
    key: "REVENUE",
    label: "Revenue / Revenue Growth",
    pattern: /\b(revenue|quarterly revenue growth|sales growth|top line)\b/i,
  },
  {
    key: "NET_PROFIT",
    label: "Net Profit / Profit Growth",
    pattern: /\b(net profit|profit growth|pat|earnings growth)\b/i,
  },
  {
    key: "EBITDA",
    label: "EBITDA / Operating Profit",
    pattern: /\bebitda\b(?!\s*margin)/i,
  },
  {
    key: "EBITDA_MARGIN",
    label: "EBITDA / Operating Margin",
    pattern: /\b(ebitda margin|operating margin|operating ebitda margin)\b/i,
  },
  {
    key: "DEBT",
    label: "Debt / Leverage",
    pattern: /\b(debt|debt to equity|leverage|net debt)\b/i,
  },
  {
    key: "CASH_FLOW",
    label: "Operating / Free Cash Flow",
    pattern: /\b(cash flow|free cash flow|operating cash flow|ocf|fcf)\b/i,
  },
  {
    key: "EPS",
    label: "Earnings Per Share (EPS)",
    pattern: /\b(eps|earnings per share)\b/i,
  },
  {
    key: "ROE_ROCE",
    label: "ROE / ROCE",
    pattern: /\b(roe|return on equity|roce|return on capital)\b/i,
  },
  {
    key: "PROMOTER_HOLDING",
    label: "Promoter Holding",
    pattern: /\b(promoter holding|promoter ownership|insiders? promoter)\b/i,
  },
  {
    key: "PROMOTER_PLEDGE",
    label: "Promoter Pledge",
    pattern: /\b(promoter pledge|pledged|pledge percentage)\b/i,
  },
  {
    key: "FII_DII_ACTIVITY",
    label: "FII / DII Activity & Holdings",
    pattern: /\b(fii|dii|foreign institutional|institutional|mutual fund)\b/i,
  },
];

function detectReportingBasisFromClaim(
  claim: string,
  contextBasis?: "CONSOLIDATED" | "STANDALONE" | "MIXED_CONFLICT" | "UNSPECIFIED"
): "CONSOLIDATED" | "STANDALONE" | "UNSPECIFIED" {
  const lower = claim.toLowerCase();
  if (/\bconsolidated\b/.test(lower)) return "CONSOLIDATED";
  if (/\bstandalone\b/.test(lower)) return "STANDALONE";
  if (contextBasis === "CONSOLIDATED" || contextBasis === "STANDALONE") {
    return contextBasis;
  }
  return "UNSPECIFIED";
}

function classifyInstitutionalDisclosureType(
  claim: string,
  value: EvidenceValue
): InstitutionalDisclosureType {
  const lower = `${claim} ${String(value ?? "")}`.toLowerCase();
  if (/\b(net buying|net selling|inflow|outflow|net flow|buying flow|selling flow|accumulation|distribution)\b/.test(lower)) {
    return "EXPLICIT_BUYING_SELLING_FLOW";
  }
  if (/\b(qoq|mom|yoy|change|delta|increase|decrease)\b/.test(lower)) {
    return "PERIOD_OVER_PERIOD_OWNERSHIP_CHANGE";
  }
  return "STATIC_SHAREHOLDING_SNAPSHOT";
}

export class LiveResearchValidationService {
  private readonly contextBuilder: UnifiedIntelligenceContextBuilder;
  private readonly intelligenceService: InstitutionalResearchIntelligenceService;
  private readonly briefService: InstitutionalResearchBriefService;

  public constructor(deps?: {
    contextBuilder?: UnifiedIntelligenceContextBuilder;
    intelligenceService?: InstitutionalResearchIntelligenceService;
    briefService?: InstitutionalResearchBriefService;
  }) {
    this.contextBuilder =
      deps?.contextBuilder ?? unifiedIntelligenceContextBuilder;
    this.intelligenceService =
      deps?.intelligenceService ?? institutionalResearchIntelligenceService;
    this.briefService =
      deps?.briefService ?? institutionalResearchBriefService;
  }

  /**
   * Section 3: Validates the 11 core financial & institutional metrics for a company context.
   * Never replaces unavailable data with zero and never presents unverified figures as verified facts.
   */
  public validateCompanyMetrics(
    context: UnifiedIntelligenceContext
  ): Record<ValidatedMetricKey, LiveValidatedMetricRecord> {
    const conflictedIds = new Set<string>(
      context.conflicts.flatMap((c) => c.evidenceIds)
    );
    for (const r of context.evidenceReferences) {
      if (r.verificationStatus === "CONFLICTED") {
        conflictedIds.add(r.evidenceId);
      }
    }

    const fundPillar = context.researchScorecard?.pillars.find(
      (p) => p.pillar === "FUNDAMENTAL_QUALITY"
    );
    const defaultBasis = fundPillar?.fundamentalBreakdown?.reportingBasis;

    const result = {} as Record<ValidatedMetricKey, LiveValidatedMetricRecord>;

    for (const spec of METRIC_SPECS) {
      const matchingRefs = context.evidenceReferences.filter((r) =>
        spec.pattern.test(r.claim)
      );

      if (matchingRefs.length === 0) {
        result[spec.key] = {
          metricKey: spec.key,
          label: spec.label,
          status: "MISSING_UNAVAILABLE",
          claim: null,
          value: null, // Never replaced with 0
          unit: null,
          currency: null,
          sourceName: null,
          sourceUrl: null,
          publishedTimestamp: null,
          retrievedTimestamp: null,
          reportingPeriod: null,
          reportingBasis: "UNSPECIFIED",
          verificationStatus: "UNAVAILABLE",
          freshness: "UNAVAILABLE",
          evidenceId: null,
          notes: [
            `${spec.label} is unavailable in current verified disclosures; value is preserved as null (never replaced with 0).`,
          ],
        };
        continue;
      }

      // Prefer verified, non-conflicted record if available
      const primary =
        matchingRefs.find(
          (r) =>
            r.verificationStatus === "VERIFIED" &&
            !conflictedIds.has(r.evidenceId)
        ) ?? matchingRefs[0];

      const isConflicted =
        conflictedIds.has(primary.evidenceId) ||
        primary.verificationStatus === "CONFLICTED";
      const isVerified =
        primary.verificationStatus === "VERIFIED" && !isConflicted;

      const status: LiveValidatedMetricRecord["status"] = isConflicted
        ? "CONFLICTED"
        : isVerified
          ? "VERIFIED_AVAILABLE"
          : "UNVERIFIED_AVAILABLE";

      const notes: string[] = [];
      if (!isVerified && !isConflicted) {
        notes.push(
          "Source is UNVERIFIED; figure must not be treated as a verified exchange fact."
        );
      }
      if (isConflicted) {
        notes.push(
          "Metric has unresolved cross-source conflict; conflicting figures are surfaced rather than averaged."
        );
      }
      if (
        primary.granularFreshness === "STALE" ||
        primary.granularFreshness === "EXPIRED"
      ) {
        notes.push(`Metric freshness is ${primary.granularFreshness}.`);
      }

      result[spec.key] = {
        metricKey: spec.key,
        label: spec.label,
        status,
        claim: primary.claim,
        value: primary.value,
        unit: primary.unit,
        currency: primary.currency,
        sourceName: primary.sourceName,
        sourceUrl: primary.sourceUrl,
        publishedTimestamp: primary.publicationTimestamp,
        retrievedTimestamp: primary.retrievalTimestamp,
        reportingPeriod:
          primary.reportingPeriod ??
          context.researchPeriod.requestedPeriod ??
          context.researchPeriod.detectedPeriods[0] ??
          null,
        reportingBasis: detectReportingBasisFromClaim(
          primary.claim,
          defaultBasis
        ),
        verificationStatus: primary.verificationStatus,
        freshness: primary.granularFreshness,
        evidenceId: primary.evidenceId,
        notes,
      };
    }

    return result;
  }

  /**
   * Section 4: Explicitly validates the distinction between static shareholding snapshots,
   * period-over-period ownership changes, and explicit buying/selling flow disclosures.
   */
  public validateInstitutionalData(
    context: UnifiedIntelligenceContext
  ): InstitutionalDataValidationReport {
    const instRefs = context.evidenceReferences.filter(
      (r) =>
        r.category === "INSTITUTIONAL_HOLDING" ||
        r.agentSource === "institutional_intelligence" ||
        /\b(fii|dii|institutional|mutual fund|promoter)\b/i.test(r.claim)
    );

    const matrix = context.crossAgentSynthesis?.evidenceMatrix;
    const bullishIds = new Set(
      (matrix?.bullishEvidence ?? []).map((e) => e.evidenceId)
    );
    const bearishIds = new Set(
      (matrix?.bearishEvidence ?? []).map((e) => e.evidenceId)
    );

    let staticSnapshotCount = 0;
    let periodChangeCount = 0;
    let explicitFlowCount = 0;
    let staticOwnershipRemainsNeutral = true;

    const records: InstitutionalRecordValidationItem[] = instRefs.map((ref) => {
      const disclosureType = classifyInstitutionalDisclosureType(
        ref.claim,
        ref.value
      );
      const isPledge = /\b(pledge|pledged)\b/i.test(ref.claim);

      if (disclosureType === "STATIC_SHAREHOLDING_SNAPSHOT") {
        staticSnapshotCount += 1;
        // Static FII/DII/MF ownership (excluding 0% promoter pledge governance check or <25% low promoter holding risk) must never be classified as bullish accumulation
        if (!isPledge && bullishIds.has(ref.evidenceId)) {
          staticOwnershipRemainsNeutral = false;
        }
      } else if (disclosureType === "PERIOD_OVER_PERIOD_OWNERSHIP_CHANGE") {
        periodChangeCount += 1;
      } else {
        explicitFlowCount += 1;
      }

      const directionalTreatment: InstitutionalRecordValidationItem["directionalTreatment"] =
        bullishIds.has(ref.evidenceId)
          ? "BULLISH"
          : bearishIds.has(ref.evidenceId)
            ? "BEARISH"
            : "NEUTRAL_STATIC";

      return {
        evidenceId: ref.evidenceId,
        claim: ref.claim,
        value: ref.value,
        unit: ref.unit,
        disclosureType,
        directionalTreatment,
        sourceName: ref.sourceName,
        reportingPeriod: ref.reportingPeriod,
        freshness: ref.granularFreshness,
        verificationStatus: ref.verificationStatus,
        explanation:
          disclosureType === "STATIC_SHAREHOLDING_SNAPSHOT"
            ? "Static shareholding snapshot; does not measure active institutional buying or selling flow."
            : disclosureType === "PERIOD_OVER_PERIOD_OWNERSHIP_CHANGE"
              ? "Period-over-period shareholding delta."
              : "Explicit institutional buying/selling flow disclosure.",
      };
    });

    const hasExplicitFlowDisclosures =
      periodChangeCount + explicitFlowCount > 0;
    const instPillar = context.researchScorecard?.pillars.find(
      (p) => p.pillar === "INSTITUTIONAL_ACTIVITY"
    );
    if (
      !hasExplicitFlowDisclosures &&
      instPillar &&
      (instPillar.assessment === "STRONG" ||
        instPillar.assessment === "CONSTRUCTIVE")
    ) {
      staticOwnershipRemainsNeutral = false;
    }

    const flowLimitationWarning = hasExplicitFlowDisclosures
      ? null
      : "Explicit institutional buying/selling flow disclosures are unavailable; only static shareholding snapshots exist, which remain NEUTRAL/MIXED and never imply active accumulation.";

    return {
      symbol: context.symbol,
      staticSnapshotCount,
      periodChangeCount,
      explicitFlowCount,
      hasExplicitFlowDisclosures,
      staticOwnershipRemainsNeutral,
      flowLimitationWarning,
      records,
    };
  }

  /**
   * Section 5: Audits Phase 9.4 InstitutionalResearchBrief conclusions and confidence against source evidence.
   */
  public auditResearchBriefQuality(
    context: UnifiedIntelligenceContext,
    brief?: InstitutionalResearchBrief
  ): ResearchBriefQualityAuditReport {
    const resolvedBrief =
      brief ?? context.researchBrief ?? this.briefService.buildBrief(context);
    const instValidation = this.validateInstitutionalData(context);

    const violations: string[] = [];
    const isPositive =
      resolvedBrief.conclusion === "POSITIVE" ||
      resolvedBrief.conclusion === "CAUTIOUSLY_POSITIVE";
    const isNegative =
      resolvedBrief.conclusion === "NEGATIVE" ||
      resolvedBrief.conclusion === "CAUTIOUSLY_NEGATIVE";

    const fundAssessment = resolvedBrief.fundamentalAssessment.assessment;
    const conflictedFundamentalsBlockPositive = !(
      fundAssessment === "CONFLICTED" && isPositive
    );
    if (!conflictedFundamentalsBlockPositive) {
      violations.push(
        "Unsupported positive conclusion detected while Fundamental Quality is CONFLICTED."
      );
    }

    const noUnsupportedPositiveConclusion = !(
      isPositive &&
      (context.contextStatus === "INSUFFICIENT_DATA" ||
        resolvedBrief.bullishEvidence.length === 0 ||
        (fundAssessment !== "STRONG" && fundAssessment !== "CONSTRUCTIVE"))
    );
    if (!noUnsupportedPositiveConclusion) {
      violations.push(
        `Unsupported positive conclusion (${resolvedBrief.conclusion}) without constructive/strong fundamentals and verified bullish evidence.`
      );
    }

    const noUnsupportedNegativeConclusion = !(
      isNegative &&
      resolvedBrief.bearishEvidence.length === 0 &&
      resolvedBrief.supportedRisks.filter((r) => r.severity === "HIGH")
        .length === 0 &&
      fundAssessment !== "WEAK"
    );
    if (!noUnsupportedNegativeConclusion) {
      violations.push(
        `Unsupported negative conclusion (${resolvedBrief.conclusion}) without bearish evidence, weak fundamentals, or high-severity risks.`
      );
    }

    const fs = context.freshnessSummary;
    const staleDominates =
      context.qualityAssessment.availableEvidenceCount > 0 &&
      fs.staleCount + fs.expiredCount > fs.freshCount;
    const staleEvidenceReflectedInConfidence = !(
      staleDominates &&
      (resolvedBrief.confidenceClassification === "HIGH" ||
        resolvedBrief.confidenceClassification === "MODERATE")
    );
    if (!staleEvidenceReflectedInConfidence) {
      violations.push(
        "Stale/expired evidence dominates without degrading confidenceClassification to LOW."
      );
    }

    const missingMetricsNeverAssumedZeroOrPositive =
      context.evidenceReferences.every((r) => r.value !== undefined) &&
      !(
        context.contextStatus === "INSUFFICIENT_DATA" &&
        resolvedBrief.conclusion !== "INSUFFICIENT_EVIDENCE"
      );
    if (!missingMetricsNeverAssumedZeroOrPositive) {
      violations.push(
        "Insufficient data context did not produce INSUFFICIENT_EVIDENCE conclusion."
      );
    }

    const hasRejectedPeriods =
      context.researchPeriod.incompatiblePeriodsRejected.length > 0;
    const incompatiblePeriodsHandledProperly = !(
      hasRejectedPeriods &&
      resolvedBrief.confidenceClassification === "HIGH"
    );
    if (!incompatiblePeriodsHandledProperly) {
      violations.push(
        "Incompatible reporting periods were rejected but confidenceClassification remained HIGH."
      );
    }

    const hasFailedAgents =
      context.qualityAssessment.failedAgentsCount > 0;
    const agentFailuresReflectedInConfidence = !(
      hasFailedAgents &&
      (resolvedBrief.confidenceClassification === "HIGH" ||
        resolvedBrief.confidenceClassification === "MODERATE")
    );
    if (!agentFailuresReflectedInConfidence) {
      violations.push(
        "Agent execution failure occurred without degrading confidenceClassification to LOW/INSUFFICIENT."
      );
    }

    const validRefIds = new Set(
      context.evidenceReferences.map((r) => r.evidenceId)
    );
    const allBriefEvidenceIds = [
      ...resolvedBrief.bullishEvidence.map((e) => e.evidenceId),
      ...resolvedBrief.bearishEvidence.map((e) => e.evidenceId),
      ...resolvedBrief.neutralEvidence.map((e) => e.evidenceId),
      ...resolvedBrief.strongestSupportingEvidence.map((e) => e.evidenceId),
      ...resolvedBrief.strongestOpposingEvidence.map((e) => e.evidenceId),
      ...resolvedBrief.unresolvedConflicts.flatMap((c) => c.evidenceIds),
    ];
    const evidenceIdIntegrityVerified = allBriefEvidenceIds.every((id) =>
      validRefIds.has(id)
    );
    if (!evidenceIdIntegrityVerified) {
      violations.push(
        "Brief contains an evidenceId that does not exist in context.evidenceReferences."
      );
    }

    const staticOwnershipNeverImpliesAccumulation =
      instValidation.staticOwnershipRemainsNeutral;
    if (!staticOwnershipNeverImpliesAccumulation) {
      violations.push(
        "Static institutional ownership percentage was improperly treated as accumulation flow."
      );
    }

    return {
      symbol: context.symbol,
      contextId: context.contextId,
      conclusion: resolvedBrief.conclusion,
      confidenceClassification: resolvedBrief.confidenceClassification,
      passed: violations.length === 0,
      checks: {
        noUnsupportedPositiveConclusion,
        noUnsupportedNegativeConclusion,
        conflictedFundamentalsBlockPositive,
        staleEvidenceReflectedInConfidence,
        missingMetricsNeverAssumedZeroOrPositive,
        incompatiblePeriodsHandledProperly,
        agentFailuresReflectedInConfidence,
        evidenceIdIntegrityVerified,
        staticOwnershipNeverImpliesAccumulation,
      },
      violations,
    };
  }

  /**
   * Section 6: Builds historical research summary using only persisted contexts owned by the same userId and symbol.
   */
  public buildHistoricalResearchSummary(
    current: UnifiedIntelligenceContext,
    previousContexts: UnifiedIntelligenceContext[] = []
  ): HistoricalResearchSummary {
    const ownedPrev = previousContexts
      .filter(
        (p) =>
          p &&
          p.userId === current.userId &&
          p.symbol === current.symbol &&
          p.contextId !== current.contextId &&
          Array.isArray(p.evidenceReferences)
      )
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0];

    const currentBrief =
      current.researchBrief ?? this.briefService.buildBrief(current);
    const currentScorecard =
      current.researchScorecard ??
      this.intelligenceService.buildScorecard(current, previousContexts);

    if (!ownedPrev) {
      return {
        status: "NO_HISTORICAL_CONTEXT",
        previousContextId: null,
        previousTimestamp: null,
        currentTimestamp: current.createdAt,
        previousConclusion: null,
        currentConclusion: currentBrief.conclusion,
        changedPillarAssessments: [],
        improvedEvidence: [],
        deterioratedEvidence: [],
        newConflicts: [],
        resolvedConflicts: [],
        newMissingInformation: [],
        summary:
          "NO_HISTORICAL_CONTEXT: No previous persisted context exists for this authenticated user and symbol.",
      };
    }

    const prevScorecard =
      ownedPrev.researchScorecard ??
      this.intelligenceService.buildScorecard(ownedPrev, []);
    const prevBrief =
      ownedPrev.researchBrief ??
      this.briefService.buildBrief({
        ...ownedPrev,
        researchScorecard: prevScorecard,
      });

    const changedPillarAssessments: ChangedPillarAssessmentItem[] = [];
    for (const currPillar of currentScorecard.pillars) {
      const prevPillar = prevScorecard.pillars.find(
        (p) => p.pillar === currPillar.pillar
      );
      if (prevPillar && prevPillar.assessment !== currPillar.assessment) {
        changedPillarAssessments.push({
          pillar: currPillar.pillar,
          title: currPillar.title,
          previousAssessment: prevPillar.assessment,
          currentAssessment: currPillar.assessment,
        });
      }
    }

    const histChanges = currentScorecard.historicalChanges;

    return {
      status: "COMPARED",
      previousContextId: ownedPrev.contextId,
      previousTimestamp: ownedPrev.createdAt,
      currentTimestamp: current.createdAt,
      previousConclusion: prevBrief.conclusion,
      currentConclusion: currentBrief.conclusion,
      changedPillarAssessments,
      improvedEvidence: histChanges.improvedEvidence,
      deterioratedEvidence: histChanges.deterioratedEvidence,
      newConflicts: histChanges.newConflicts,
      resolvedConflicts: histChanges.resolvedConflicts,
      newMissingInformation: histChanges.newMissingInformation,
      summary: `Historical research comparison (${ownedPrev.contextId} → ${current.contextId}): Conclusion ${prevBrief.conclusion} → ${currentBrief.conclusion}, ${changedPillarAssessments.length} pillar assessment change(s), ${histChanges.improvedEvidence.length} improved metric(s), ${histChanges.deterioratedEvidence.length} deteriorated metric(s).`,
    };
  }

  public validateCompanyBundle(
    context: UnifiedIntelligenceContext,
    previousContexts: UnifiedIntelligenceContext[] = []
  ): CompanyValidationBundle {
    return {
      symbol: context.symbol,
      exchange: context.exchange,
      contextId: context.contextId,
      metrics: this.validateCompanyMetrics(context),
      institutionalValidation: this.validateInstitutionalData(context),
      briefQualityAudit: this.auditResearchBriefQuality(
        context,
        context.researchBrief
      ),
      historicalResearch: this.buildHistoricalResearchSummary(
        context,
        previousContexts
      ),
    };
  }

  /**
   * Section 2: Executes an authenticated multi-company peer research workflow.
   * Collects target and peer contexts, normalizes symbols/exchanges, enforces period & basis comparability,
   * reuses Phase 9.3 rankCompanies(), and preserves unranked reasons.
   */
  public async executePeerResearch(
    req: MultiCompanyPeerResearchRequest
  ): Promise<MultiCompanyPeerResearchResponse> {
    if (!req.userId || typeof req.userId !== "string" || !req.userId.trim()) {
      throw new UnifiedContextValidationError("Authenticated userId is required.");
    }
    const userId = req.userId.trim();

    const normTarget = normalizeEvidenceSymbol(req.targetSymbol || "");
    if (!normTarget || normTarget === "MARKET") {
      throw new UnifiedContextValidationError(
        "A valid target NSE company symbol is required for peer research."
      );
    }

    const rawPeers = Array.isArray(req.peerSymbols) ? req.peerSymbols : [];
    const normalizedPeers: string[] = [];
    const seenSymbols = new Set<string>([normTarget]);

    for (const rawPeer of rawPeers) {
      if (typeof rawPeer !== "string") continue;
      const clean = normalizeEvidenceSymbol(rawPeer);
      if (clean && clean !== "MARKET" && !seenSymbols.has(clean)) {
        seenSymbols.add(clean);
        normalizedPeers.push(clean);
      }
      if (normalizedPeers.length >= 6) break;
    }

    const tier: AITaskTier = req.tier ?? "balanced";
    const requestedPeriod = req.requestedPeriod ?? null;
    const previousContexts = req.previousContextsForTarget ?? [];

    // 1. Collect or use precollected peer contexts
    let peerContexts: UnifiedIntelligenceContext[] = [];
    if (req.precollectedPeerContexts) {
      peerContexts = req.precollectedPeerContexts.filter(
        (p) => p && p.symbol !== normTarget
      );
    } else if (normalizedPeers.length > 0) {
      peerContexts = await Promise.all(
        normalizedPeers.map((peerSym) =>
          this.contextBuilder.buildForSymbol(
            userId,
            {
              symbol: peerSym,
              requestedPeriod,
              tier,
            },
            {
              referenceDate: req.referenceDate,
            }
          )
        )
      );
    }

    // 2. Collect or rebuild target context with peerContexts & previousContexts
    let targetContext: UnifiedIntelligenceContext;
    if (req.precollectedTargetContext) {
      const baseTarget = req.precollectedTargetContext;
      const targetScorecard =
        baseTarget.researchScorecard ??
        this.intelligenceService.buildScorecard(baseTarget, previousContexts);
      const targetWithScorecard: UnifiedIntelligenceContext = {
        ...baseTarget,
        researchScorecard: targetScorecard,
      };
      const targetBrief = this.briefService.buildBrief(targetWithScorecard, {
        previousContexts,
        peerContexts,
      });
      targetContext = {
        ...targetWithScorecard,
        researchBrief: targetBrief,
      };
    } else {
      targetContext = await this.contextBuilder.buildForSymbol(
        userId,
        {
          symbol: normTarget,
          requestedPeriod,
          tier,
        },
        {
          referenceDate: req.referenceDate,
          previousContexts,
          peerContexts,
        }
      );
    }

    const targetBrief =
      targetContext.researchBrief ??
      this.briefService.buildBrief(targetContext, {
        previousContexts,
        peerContexts,
      });

    const targetValidation = this.validateCompanyBundle(
      targetContext,
      previousContexts
    );

    const peerComparisonSummary = targetBrief.peerComparison;
    const allContexts = [targetContext, ...peerContexts];

    const comparisonRows: PeerCompanyComparisonRow[] = allContexts.map((ctx) => {
      const scorecard =
        ctx.researchScorecard ??
        this.intelligenceService.buildScorecard(ctx, []);
      const brief =
        ctx.symbol === targetContext.symbol
          ? targetBrief
          : ctx.researchBrief ??
            this.briefService.buildBrief(ctx, { peerContexts: [] });

      const pillarAssessments = {} as Record<
        ScorecardPillarKey,
        PillarQualitativeAssessment
      >;
      for (const p of scorecard.pillars) {
        pillarAssessments[p.pillar] = p.assessment;
      }

      const fundPillar = scorecard.pillars.find(
        (p) => p.pillar === "FUNDAMENTAL_QUALITY"
      );
      const rankedEntry = peerComparisonSummary.rankedPeers.find(
        (r) => r.symbol === ctx.symbol
      );
      const unrankedEntry = peerComparisonSummary.unrankedPeers.find(
        (u) => u.symbol === ctx.symbol
      );

      return {
        symbol: ctx.symbol,
        exchange:
          ctx.exchange ?? inferExchangeFromSymbol(ctx.symbol, ctx.symbol),
        contextId: ctx.contextId,
        isTarget: ctx.symbol === targetContext.symbol,
        reportingPeriod:
          ctx.researchPeriod.requestedPeriod ??
          ctx.researchPeriod.detectedPeriods[0] ??
          null,
        reportingBasis:
          fundPillar?.fundamentalBreakdown?.reportingBasis ?? "UNSPECIFIED",
        conclusion: brief.conclusion,
        confidenceClassification: brief.confidenceClassification,
        evidenceQuality: ctx.contextStatus,
        availableEvidenceCount:
          ctx.qualityAssessment.availableEvidenceCount,
        missingDataCount: ctx.qualityAssessment.missingDataCount,
        conflictsCount: ctx.conflicts.length,
        pillarAssessments,
        rank: rankedEntry ? rankedEntry.rank : null,
        rankingTier: rankedEntry ? rankedEntry.evidenceTier : null,
        unrankedReasons: unrankedEntry ? unrankedEntry.unrankedReasons : [],
      };
    });

    return {
      targetSymbol: targetContext.symbol,
      peerSymbols: peerContexts.map((p) => p.symbol),
      generatedAt: targetContext.createdAt,
      readOnly: true,
      peerComparisonStatus: peerComparisonSummary.status,
      targetContext,
      targetBrief,
      targetValidation,
      peerContexts,
      comparisonRows,
      rankedCompanies: peerComparisonSummary.rankedPeers,
      unrankedCompanies: peerComparisonSummary.unrankedPeers,
      peerComparisonSummary,
      advisoryDisclaimer: targetBrief.advisoryDisclaimer,
    };
  }
}

export const liveResearchValidationService =
  new LiveResearchValidationService();

