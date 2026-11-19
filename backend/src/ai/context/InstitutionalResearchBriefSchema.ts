import { GranularFreshness } from "../evidence/EvidenceSchema";
import {
  CompanyResearchRankingResult,
  HistoricalEvidenceChanges,
  InstitutionalRiskItem,
  RankedCompanyEntry,
  ResearchRankingTier,
  ScorecardPillarResult,
  UnrankedCompanyEntry,
} from "./ResearchIntelligenceScorecardSchema";

export type ResearchBriefConclusion =
  | "POSITIVE"
  | "CAUTIOUSLY_POSITIVE"
  | "NEUTRAL"
  | "CAUTIOUSLY_NEGATIVE"
  | "NEGATIVE"
  | "INSUFFICIENT_EVIDENCE";

export type ResearchBriefConfidence =
  | "HIGH"
  | "MODERATE"
  | "LOW"
  | "INSUFFICIENT";

export interface BriefEvidencePresentationItem {
  evidenceId: string;
  source: string;
  publishedAt: string | null;
  retrievedAt: string;
  freshness: GranularFreshness;
  observedFact: string;
  interpretation: string;
  limitations: string[];
}

export interface BriefUnresolvedConflictItem {
  conflictKey: string;
  claim: string;
  evidenceIds: string[];
  reason: string;
}

export interface BriefPeerComparisonSummary {
  status: "COMPARED" | "NO_PEER_CONTEXT" | "UNRANKED_INCOMPARABLE";
  companyRank: number | null;
  totalRankedPeers: number;
  evidenceTier: ResearchRankingTier | null;
  rankedPeers: RankedCompanyEntry[];
  unrankedPeers: UnrankedCompanyEntry[];
  unrankedReasonsForSymbol: string[];
  methodologyNote: string;
  summary: string;
  rankingResult?: CompanyResearchRankingResult;
}

export interface InstitutionalResearchBrief {
  symbol: string;
  contextId: string;
  generatedAt: string;
  readOnly: true;
  conclusion: ResearchBriefConclusion;
  conclusionRationale: string;
  confidenceClassification: ResearchBriefConfidence;
  confidenceExplanation: string;
  executiveSummary: string;
  fundamentalAssessment: ScorecardPillarResult;
  institutionalAssessment: ScorecardPillarResult;
  marketAssessment: ScorecardPillarResult;
  newsAndMacroAssessment: ScorecardPillarResult;
  financialRiskAssessment: ScorecardPillarResult;
  evidenceQualityAssessment: ScorecardPillarResult;
  supportedRisks: InstitutionalRiskItem[];
  bullishEvidence: BriefEvidencePresentationItem[];
  bearishEvidence: BriefEvidencePresentationItem[];
  neutralEvidence: BriefEvidencePresentationItem[];
  strongestSupportingEvidence: BriefEvidencePresentationItem[];
  strongestOpposingEvidence: BriefEvidencePresentationItem[];
  unresolvedConflicts: BriefUnresolvedConflictItem[];
  missingInformation: string[];
  historicalChanges: HistoricalEvidenceChanges;
  peerComparison: BriefPeerComparisonSummary;
  researchLimitations: string[];
  advisoryDisclaimer: string;
}

