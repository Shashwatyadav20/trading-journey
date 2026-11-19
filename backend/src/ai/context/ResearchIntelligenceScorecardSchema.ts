import { EvidenceValue } from "../evidence/EvidenceSchema";
import { UnifiedContextStatus } from "./UnifiedContextSchema";

export type ScorecardPillarKey =
  | "FUNDAMENTAL_QUALITY"
  | "INSTITUTIONAL_ACTIVITY"
  | "MARKET_ALIGNMENT"
  | "NEWS_AND_MACRO_ENVIRONMENT"
  | "FINANCIAL_RISK"
  | "EVIDENCE_QUALITY";

export type PillarQualitativeAssessment =
  | "STRONG"
  | "CONSTRUCTIVE"
  | "MIXED"
  | "WEAK"
  | "HIGH_RISK"
  | "CONFLICTED"
  | "INSUFFICIENT_DATA"
  | "INSUFFICIENT_CURRENT_EVIDENCE";

export interface FundamentalQualityBreakdown {
  revenueGrowth: string;
  profitGrowth: string;
  ebitdaMargins: string;
  debt: string;
  cashFlow: string;
  earningsConsistency: string;
  reportingBasis: "CONSOLIDATED" | "STANDALONE" | "MIXED_CONFLICT" | "UNSPECIFIED";
  reportingPeriodCompatibility:
    | "COMPATIBLE"
    | "INCOMPATIBLE_PERIODS_DETECTED"
    | "UNSPECIFIED";
}

export interface InstitutionalActivityBreakdown {
  fiiActivity: string;
  diiActivity: string;
  mutualFundOwnership: string;
  promoterHolding: string;
  promoterPledge: string;
  hasExplicitFlowData: boolean;
  ownershipVsFlowDistinction: string;
}

export interface MarketAlignmentBreakdown {
  marketRegime: string;
  indexTrend: string;
  sectorContext: string;
  companyMarketAlignment: string;
  volatilityConditions: string;
}

export interface ScorecardPillarResult {
  pillar: ScorecardPillarKey;
  title: string;
  assessment: PillarQualitativeAssessment;
  supportingEvidenceIds: string[];
  opposingEvidenceIds: string[];
  missingData: string[];
  conflicts: string[];
  freshnessLimitations: string[];
  explanation: string;
  fundamentalBreakdown?: FundamentalQualityBreakdown;
  institutionalBreakdown?: InstitutionalActivityBreakdown;
  marketBreakdown?: MarketAlignmentBreakdown;
}

export type InstitutionalRiskCategory =
  | "EARNINGS_DETERIORATION"
  | "DEBT_AND_LEVERAGE"
  | "CASH_FLOW_WEAKNESS"
  | "INSTITUTIONAL_DISTRIBUTION"
  | "PROMOTER_PLEDGE"
  | "NEGATIVE_NEWS"
  | "MARKET_VOLATILITY"
  | "EVIDENCE_CONFLICTS"
  | "MISSING_OR_STALE_INFORMATION";

export interface InstitutionalRiskItem {
  category: InstitutionalRiskCategory;
  severity: "HIGH" | "MODERATE" | "LOW";
  summary: string;
  evidenceIds: string[];
  missingDataNotAssumedZeroRisk: boolean;
}

export interface HistoricalEvidenceChangeItem {
  claim: string;
  previousValue: EvidenceValue;
  currentValue: EvidenceValue;
  unit: string | null;
  previousEvidenceId: string;
  currentEvidenceId: string;
  previousTimestamp: string | null;
  currentTimestamp: string | null;
  explanation: string;
}

export interface HistoricalEvidenceChanges {
  status: "COMPARED" | "NO_HISTORICAL_CONTEXT";
  previousContextId: string | null;
  previousTimestamp: string | null;
  currentTimestamp: string;
  improvedEvidence: HistoricalEvidenceChangeItem[];
  deterioratedEvidence: HistoricalEvidenceChangeItem[];
  newConflicts: Array<{ conflictKey: string; claim: string; reason: string | null }>;
  resolvedConflicts: Array<{ conflictKey: string; claim: string }>;
  newMissingInformation: string[];
  summary: string;
}

export interface ResearchIntelligenceScorecard {
  symbol: string;
  contextId: string;
  generatedAt: string;
  readOnly: true;
  overallStatus: UnifiedContextStatus;
  pillars: ScorecardPillarResult[];
  supportedRisks: InstitutionalRiskItem[];
  historicalChanges: HistoricalEvidenceChanges;
  researchLimitations: string[];
  advisoryDisclaimer: string;
}

export type ResearchRankingTier =
  | "TIER_1_STRONG_EVIDENCE"
  | "TIER_2_CONSTRUCTIVE_EVIDENCE"
  | "TIER_3_MIXED_OR_CAUTIOUS"
  | "TIER_4_ELEVATED_RISK";

export interface RankedCompanyEntry {
  rank: number;
  symbol: string;
  contextId: string;
  evidenceTier: ResearchRankingTier;
  supportingPillarCount: number;
  weakOrRiskPillarCount: number;
  availableEvidenceCount: number;
  rankingReasons: string[];
  missingData: string[];
  conflicts: string[];
  advisoryNote: string;
}

export interface UnrankedCompanyEntry {
  symbol: string;
  contextId: string;
  unrankedReasons: string[];
  missingData: string[];
  conflicts: string[];
  note: string;
}

export interface CompanyResearchRankingResult {
  generatedAt: string;
  readOnly: true;
  methodologyNote: string;
  advisoryDisclaimer: string;
  rankedCompanies: RankedCompanyEntry[];
  unrankedCompanies: UnrankedCompanyEntry[];
}

