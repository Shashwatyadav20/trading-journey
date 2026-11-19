import {
  EvidenceFreshness,
  EvidenceValue,
  EvidenceVerificationStatus,
  GranularFreshness,
} from "../evidence/EvidenceSchema";
import { RegisteredAgentId } from "../orchestrator/IntentRouter";
import { UnifiedContextStatus } from "./UnifiedContextSchema";

export type AlignmentDimensionKey =
  | "FUNDAMENTAL_AND_INSTITUTIONAL"
  | "COMPANY_AND_MARKET_BEHAVIOR"
  | "COMPANY_NEWS_AND_FINANCIALS"
  | "MACRO_AND_SECTOR_CONDITIONS"
  | "OPTIONS_AND_MARKET_DIRECTION";

export type AlignmentStatus =
  | "ALIGNED_BULLISH"
  | "ALIGNED_BEARISH"
  | "DIVERGENT"
  | "NEUTRAL"
  | "CONFLICTED"
  | "INSUFFICIENT_EVIDENCE"
  | "NOT_APPLICABLE_NO_OPTIONS_EVIDENCE";

export type RelationshipClassification =
  | "OBSERVED_CORRELATION"
  | "CAUSAL_UNPROVEN"
  | "INSUFFICIENT_EVIDENCE";

export interface CrossAgentAlignmentItem {
  dimension: AlignmentDimensionKey;
  title: string;
  status: AlignmentStatus;
  relationshipType: RelationshipClassification;
  causationDisclaimer: string;
  summary: string;
  evidenceIds: string[];
  agentsInvolved: RegisteredAgentId[];
}

export interface MatrixEvidenceItem {
  evidenceId: string;
  agentSource: RegisteredAgentId;
  claim: string;
  value: EvidenceValue;
  unit: string | null;
  currency: string | null;
  direction: "BULLISH" | "BEARISH" | "NEUTRAL";
  rationale: string;
  sourceName: string;
  sourceUrl: string | null;
  publicationTimestamp: string | null;
  retrievalTimestamp: string;
  reportingPeriod: string | null;
  freshnessStatus: EvidenceFreshness;
  granularFreshness: GranularFreshness;
  verificationStatus: EvidenceVerificationStatus;
}

export interface MatrixConflictItem {
  conflictKey: string;
  claim: string;
  evidenceIds: string[];
  resolutionReason: string | null;
  values: Array<{
    evidenceId: string;
    source: string;
    value: EvidenceValue;
    unit: string | null;
    currency: string | null;
  }>;
}

export type DirectionalBalanceSummary =
  | "BULLISH_SKEW"
  | "BEARISH_SKEW"
  | "BALANCED_OR_MIXED"
  | "CONFLICTED"
  | "INSUFFICIENT_EVIDENCE";

export interface BullishBearishEvidenceMatrix {
  bullishEvidence: MatrixEvidenceItem[];
  bearishEvidence: MatrixEvidenceItem[];
  neutralEvidence: MatrixEvidenceItem[];
  conflictingEvidence: MatrixConflictItem[];
  missingEvidence: string[];
  directionalSummary: DirectionalBalanceSummary;
}

export type SynthesizedRiskCategory =
  | "FINANCIAL_DETERIORATION"
  | "DEBT_AND_LEVERAGE"
  | "CASH_FLOW_WEAKNESS"
  | "INSTITUTIONAL_SELLING"
  | "PROMOTER_PLEDGE"
  | "NEGATIVE_NEWS"
  | "MARKET_VOLATILITY"
  | "OPTIONS_LIQUIDITY_OR_FRESHNESS"
  | "CONFLICTING_OR_MISSING_EVIDENCE";

export interface SynthesizedRiskFinding {
  category: SynthesizedRiskCategory;
  severity: "HIGH" | "MODERATE" | "LOW";
  description: string;
  evidenceIds: string[];
  sources: string[];
}

export interface PillarAssessment {
  summary: string;
  evidenceIds: string[];
  status: "SUPPORTED" | "PARTIAL" | "UNAVAILABLE";
}

export interface StructuredResearchConclusion {
  fundamentalAssessment: PillarAssessment;
  institutionalAssessment: PillarAssessment;
  marketAssessment: PillarAssessment;
  newsAndMacroAssessment: PillarAssessment;
  riskAssessment: {
    summary: string;
    evidenceIds: string[];
    activeRiskCategories: SynthesizedRiskCategory[];
  };
  bullishArguments: Array<{ argument: string; evidenceIds: string[] }>;
  bearishArguments: Array<{ argument: string; evidenceIds: string[] }>;
  unresolvedConflicts: Array<{
    conflictKey: string;
    claim: string;
    evidenceIds: string[];
    reason: string;
  }>;
  missingInformation: string[];
  overallEvidenceQuality: UnifiedContextStatus;
  explicitLimitations: string[];
  advisoryDisclaimer: string;
}

export interface HistoricalMetricDelta {
  claim: string;
  previousValue: EvidenceValue;
  currentValue: EvidenceValue;
  unit: string | null;
  previousEvidenceId: string;
  currentEvidenceId: string;
  previousTimestamp: string | null;
  currentTimestamp: string | null;
  direction: "INCREASED" | "DECREASED" | "UNCHANGED" | "CHANGED";
}

export interface HistoricalContextComparison {
  status: "COMPARED" | "NO_HISTORICAL_CONTEXT";
  previousContextId: string | null;
  previousTimestamp: string | null;
  currentTimestamp: string;
  previousQualityClassification: UnifiedContextStatus | null;
  currentQualityClassification: UnifiedContextStatus;
  metricDeltas: HistoricalMetricDelta[];
  newConflictsCount: number;
  summary: string;
}

export interface CrossAgentResearchSynthesis {
  symbol: string;
  contextId: string;
  synthesizedAt: string;
  readOnly: true;
  alignments: CrossAgentAlignmentItem[];
  evidenceMatrix: BullishBearishEvidenceMatrix;
  riskFindings: SynthesizedRiskFinding[];
  conclusion: StructuredResearchConclusion;
  historicalComparison: HistoricalContextComparison;
}

