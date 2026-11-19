import {
  EvidenceCategory,
  EvidenceFreshness,
  EvidenceRecord,
  EvidenceValue,
  EvidenceVerificationStatus,
  GranularFreshness,
  SourceCredibilityCategory,
  SourceTier,
  normalizeEvidenceSymbol,
} from "../evidence/EvidenceSchema";
import { ConflictDetail } from "../evidence/ConflictResolver";
import { RegisteredAgentId } from "../orchestrator/IntentRouter";
import { AgentErrorCategory } from "../orchestrator/AgentRegistry";
import { CrossAgentResearchSynthesis } from "./CrossAgentSynthesisSchema";
import { ResearchIntelligenceScorecard } from "./ResearchIntelligenceScorecardSchema";
import { InstitutionalResearchBrief } from "./InstitutionalResearchBriefSchema";

export type UnifiedAgentExecutionStatus =
  | "SUCCESS"
  | "PARTIAL"
  | "NO_DATA"
  | "RATE_LIMITED"
  | "TIMEOUT"
  | "PROVIDER_ERROR"
  | "SKIPPED";

export type UnifiedGenerationMode =
  | "LIVE_AI"
  | "DETERMINISTIC"
  | "CACHED"
  | "NONE";

export type UnifiedContextStatus =
  | "COMPLETE"
  | "PARTIAL"
  | "INSUFFICIENT_DATA";

export type UnifiedExchange = "NSE" | "BSE" | "INDEX" | "UNKNOWN";

export interface UnifiedAgentFreshnessSummary {
  freshCount: number;
  staleCount: number;
  expiredCount: number;
  unknownCount: number;
  label: "FRESH" | "DELAYED" | "STALE_OR_EXPIRED" | "NO_DATA";
}

export interface UnifiedAgentExecutionRecord {
  agentName: RegisteredAgentId;
  executionStatus: UnifiedAgentExecutionStatus;
  startTimestamp: string;
  completionTimestamp: string;
  providerUsed: string | null;
  generationMode: UnifiedGenerationMode;
  cacheHit: boolean;
  errorCategory: AgentErrorCategory | "SKIPPED";
  error: string | null;
  evidenceCount: number;
  freshnessSummary: UnifiedAgentFreshnessSummary;
}

export interface PreservedEvidenceReference {
  evidenceId: string;
  agentSource: RegisteredAgentId;
  provider: string | null;
  sourceName: string;
  sourceUrl: string | null;
  sourceTier: SourceTier;
  sourceClassification: SourceCredibilityCategory | null;
  publicationTimestamp: string | null;
  retrievalTimestamp: string;
  reportingPeriod: string | null;
  verificationStatus: EvidenceVerificationStatus;
  freshnessStatus: EvidenceFreshness;
  granularFreshness: GranularFreshness;
  confidenceLimitations: string[];
  symbol: string;
  category: EvidenceCategory;
  claim: string;
  value: EvidenceValue;
  unit: string | null;
  currency: string | null;
}

export interface SourceProvenanceSummary {
  sourceName: string;
  sourceTier: SourceTier;
  sourceClassification: SourceCredibilityCategory | null;
  sourceUrl: string | null;
  evidenceCount: number;
  agentSources: RegisteredAgentId[];
}

export interface IncompatiblePeriodRejection {
  evidenceId: string;
  agentSource: RegisteredAgentId;
  sourceName: string;
  dataPeriod: string;
  reason: string;
}

export interface UnifiedResearchPeriod {
  requestedPeriod: string | null;
  detectedPeriods: string[];
  incompatiblePeriodsRejected: IncompatiblePeriodRejection[];
}

export interface UnifiedFreshnessSummary {
  freshCount: number;
  agingCount: number;
  staleCount: number;
  expiredCount: number;
  unknownCount: number;
  hasMixedFreshness: boolean;
  explicitWarning: string | null;
}

export interface ContextQualityAssessment {
  availableEvidenceCount: number;
  missingDataCount: number;
  staleEvidenceCount: number;
  expiredEvidenceCount: number;
  conflictedEvidenceCount: number;
  completedAgentsCount: number;
  failedAgentsCount: number;
  skippedAgentsCount: number;
  completedAgents: RegisteredAgentId[];
  failedAgents: RegisteredAgentId[];
  skippedAgents: RegisteredAgentId[];
  qualityClassification: UnifiedContextStatus;
}

export interface UnifiedIntelligenceContext {
  contextId: string;
  userId: string;
  symbol: string;
  companyName: string | null;
  exchange: UnifiedExchange;
  createdAt: string;
  requestedAt: string;
  marketTimestamp: string | null;
  researchPeriod: UnifiedResearchPeriod;
  agentExecutions: UnifiedAgentExecutionRecord[];
  evidenceReferences: PreservedEvidenceReference[];
  sourceProvenance: SourceProvenanceSummary[];
  freshnessSummary: UnifiedFreshnessSummary;
  conflicts: ConflictDetail[];
  missingData: string[];
  qualityAssessment: ContextQualityAssessment;
  contextStatus: UnifiedContextStatus;
  crossAgentSynthesis?: CrossAgentResearchSynthesis;
  researchScorecard?: ResearchIntelligenceScorecard;
  researchBrief?: InstitutionalResearchBrief;
}

export class UnifiedContextValidationError extends Error {
  public readonly statusCode = 400;
  public readonly code = "UNIFIED_CONTEXT_VALIDATION_ERROR";

  public constructor(message: string) {
    super(message);
    this.name = "UnifiedContextValidationError";
  }
}

const INDEX_SYMBOLS = new Set(["NIFTY", "BANKNIFTY", "FINNIFTY", "SENSEX", "MARKET"]);
const VALID_SYMBOL_REGEX = /^[A-Z0-9._^-]{1,24}$/;

export function inferExchangeFromSymbol(
  rawSymbol: string,
  normalizedSymbol: string
): UnifiedExchange {
  const upper = rawSymbol.trim().toUpperCase();
  if (INDEX_SYMBOLS.has(normalizedSymbol)) return "INDEX";
  if (upper.endsWith(".BO")) return "BSE";
  if (upper.endsWith(".NS") || upper.startsWith("NSE:") || VALID_SYMBOL_REGEX.test(normalizedSymbol)) {
    return "NSE";
  }
  return "UNKNOWN";
}

export function normalizeContextSymbol(rawSymbol: string): string {
  const cleaned = normalizeEvidenceSymbol(rawSymbol);
  if (!cleaned || !VALID_SYMBOL_REGEX.test(cleaned)) {
    throw new UnifiedContextValidationError(
      `Invalid symbol "${rawSymbol}". Expected 1-24 alphanumeric/NSE characters.`
    );
  }
  return cleaned;
}

/**
 * Derives explicit, non-fabricated confidence limitations for a preserved evidence record.
 */
export function buildConfidenceLimitations(
  record: EvidenceRecord,
  granularFreshness: GranularFreshness
): string[] {
  const limitations: string[] = [];

  if (record.verificationStatus === "UNVERIFIED") {
    limitations.push("Unverified single-source or external feed claim.");
  } else if (record.verificationStatus === "CONFLICTED") {
    limitations.push("Conflicted against one or more competing evidence records.");
  }

  if (granularFreshness === "AGING") {
    limitations.push("Evidence is aging and approaching staleness threshold.");
  } else if (granularFreshness === "STALE" || record.freshness === "STALE") {
    limitations.push("Evidence is stale and must not be treated as live market data.");
  } else if (granularFreshness === "EXPIRED" || record.freshness === "EXPIRED") {
    limitations.push("Evidence is expired and unreliable for current decisions.");
  } else if (granularFreshness === "UNKNOWN") {
    limitations.push("Publication timestamp missing or invalid; freshness cannot be verified.");
  }

  if (!record.sourceUrl) {
    limitations.push("No direct source URL available for primary verification.");
  }
  if (!record.publishedAt) {
    limitations.push("Original publication timestamp not provided.");
  }
  if (record.untrustedExternal) {
    limitations.push("External third-party text sanitized for prompt safety.");
  }

  return limitations;
}

/**
 * Projects an EvidenceRecord into a read-only PreservedEvidenceReference
 * without mutating the original EvidenceRecord.
 */
export function projectPreservedEvidence(params: {
  record: EvidenceRecord;
  agentSource: RegisteredAgentId;
  provider: string | null;
  granularFreshness: GranularFreshness;
}): PreservedEvidenceReference {
  const { record, agentSource, provider, granularFreshness } = params;
  return {
    evidenceId: record.evidenceId,
    agentSource,
    provider,
    sourceName: record.source,
    sourceUrl: record.sourceUrl ?? null,
    sourceTier: record.sourceTier,
    sourceClassification: record.sourceClassification ?? null,
    publicationTimestamp: record.publishedAt ?? null,
    retrievalTimestamp: record.retrievedAt,
    reportingPeriod: record.dataPeriod ?? null,
    verificationStatus: record.verificationStatus,
    freshnessStatus: record.freshness,
    granularFreshness,
    confidenceLimitations: buildConfidenceLimitations(record, granularFreshness),
    symbol: record.symbol,
    category: record.category,
    claim: record.claim,
    value: record.value,
    unit: record.unit ?? null,
    currency: record.currency ?? null,
  };
}

