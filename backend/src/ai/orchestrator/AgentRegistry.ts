import { AITaskTier } from "../core/ModelRouter";
import { AIProviderError, redactSecrets } from "../core/OpenAIClient";
import { EvidenceRecord } from "../evidence/EvidenceSchema";
import { EvidencePackage } from "../services/EvidenceIntelligenceService";
import {
  ResearchCache,
  isPublicCacheableAgent,
  researchCache as defaultResearchCache,
} from "../core/ResearchCache";
import { getAIStagingConfig } from "../core/StagingConfig";
import {
  CompanyResearchAgent,
  companyResearchAgent,
} from "../agents/CompanyResearchAgent";
import {
  MarketIntelligenceAgent,
  marketIntelligenceAgent,
} from "../agents/MarketIntelligenceAgent";
import {
  InstitutionalIntelligenceAgent,
  institutionalIntelligenceAgent,
} from "../agents/InstitutionalIntelligenceAgent";
import {
  NewsMacroIntelligenceAgent,
  newsMacroIntelligenceAgent,
} from "../agents/NewsMacroIntelligenceAgent";
import {
  PortfolioIntelligenceAgent,
  portfolioIntelligenceAgent,
} from "../agents/PortfolioIntelligenceAgent";
import {
  OptionsIntelligenceAgent,
  optionsIntelligenceAgent,
} from "../agents/OptionsIntelligenceAgent";
import {
  RiskIntelligenceAgent,
  riskIntelligenceAgent,
} from "../agents/RiskIntelligenceAgent";
import { RegisteredAgentId } from "./IntentRouter";

export type AgentExecutionStatus = "SUCCEEDED" | "FAILED" | "TIMED_OUT";

export type AgentErrorCategory =
  | "SUCCESS"
  | "NO_DATA"
  | "TIMEOUT"
  | "RATE_LIMITED"
  | "PROVIDER_ERROR";

export interface AgentExecutionInput {
  userId: string;
  query: string;
  symbol: string | null;
  tier: AITaskTier;
  timeoutMs: number;
  dataTimeoutMs?: number;
  deadlineAtMs?: number;
}

export interface AgentExecutionResult {
  agentId: RegisteredAgentId;
  status: AgentExecutionStatus;
  errorCategory: AgentErrorCategory;
  dataCollectionStatus?: "COLLECTED" | "PARTIAL" | "FAILED";
  llmStatus?: "SUCCEEDED" | "FAILED" | "TIMED_OUT";
  latencyMs: number;
  startTimestamp?: string;
  completionTimestamp?: string;
  providerUsed?: string | null;
  error: string | null;
  generatedAt: string | null;
  cached?: boolean;
  cacheTimestamp?: string | null;
  freshnessLabel?: "FRESH" | "DELAYED" | null;
  evidenceIds: string[];
  evidenceRecords?: EvidenceRecord[];
  missingInformation: string[];
  conflictsCount: number;
  summaryPayload: Record<string, unknown> | null;
}

export interface AgentRegistryDeps {
  companyResearch?: CompanyResearchAgent;
  marketIntelligence?: MarketIntelligenceAgent;
  institutionalIntelligence?: InstitutionalIntelligenceAgent;
  newsMacro?: NewsMacroIntelligenceAgent;
  portfolioIntelligence?: PortfolioIntelligenceAgent;
  optionsIntelligence?: OptionsIntelligenceAgent;
  riskIntelligence?: RiskIntelligenceAgent;
  cache?: ResearchCache;
  useCache?: boolean;
}

const ALLOWED_AGENTS: ReadonlySet<string> = new Set<RegisteredAgentId>([
  "company_research",
  "market_intelligence",
  "institutional_intelligence",
  "news_macro",
  "portfolio_intelligence",
  "options_intelligence",
  "risk_intelligence",
]);

class AgentTimeoutError extends Error {
  public constructor(agentId: string, timeoutMs: number) {
    super(`Agent "${agentId}" timed out after ${timeoutMs}ms.`);
    this.name = "AgentTimeoutError";
  }
}

export class AgentRegistry {
  private readonly companyResearch: CompanyResearchAgent;
  private readonly marketIntelligence: MarketIntelligenceAgent;
  private readonly institutionalIntelligence: InstitutionalIntelligenceAgent;
  private readonly newsMacro: NewsMacroIntelligenceAgent;
  private readonly portfolioIntelligence: PortfolioIntelligenceAgent;
  private readonly optionsIntelligence: OptionsIntelligenceAgent;
  private readonly riskIntelligence: RiskIntelligenceAgent;
  private readonly cache: ResearchCache;
  private readonly useCache: boolean;

  public constructor(deps: AgentRegistryDeps = {}) {
    this.companyResearch = deps.companyResearch ?? companyResearchAgent;
    this.marketIntelligence =
      deps.marketIntelligence ?? marketIntelligenceAgent;
    this.institutionalIntelligence =
      deps.institutionalIntelligence ?? institutionalIntelligenceAgent;
    this.newsMacro = deps.newsMacro ?? newsMacroIntelligenceAgent;
    this.portfolioIntelligence =
      deps.portfolioIntelligence ?? portfolioIntelligenceAgent;
    this.optionsIntelligence =
      deps.optionsIntelligence ?? optionsIntelligenceAgent;
    this.riskIntelligence = deps.riskIntelligence ?? riskIntelligenceAgent;
    this.cache = deps.cache ?? defaultResearchCache;
    // Default cache enabled only when not injecting mock agents, or when explicit cache/useCache is provided.
    this.useCache =
      deps.useCache ??
      (deps.cache !== undefined ||
        (!deps.companyResearch &&
          !deps.marketIntelligence &&
          !deps.institutionalIntelligence &&
          !deps.newsMacro &&
          !deps.portfolioIntelligence &&
          !deps.optionsIntelligence &&
          !deps.riskIntelligence));
  }

  public isAllowed(agentId: string): agentId is RegisteredAgentId {
    return ALLOWED_AGENTS.has(agentId);
  }

  public async execute(
    agentId: RegisteredAgentId,
    input: AgentExecutionInput
  ): Promise<AgentExecutionResult> {
    if (!this.isAllowed(agentId)) {
      return {
        agentId,
        status: "FAILED",
        errorCategory: "PROVIDER_ERROR",
        latencyMs: 0,
        error: `Agent "${agentId}" is not in the read-only allowlist.`,
        generatedAt: null,
        evidenceIds: [],
        missingInformation: [],
        conflictsCount: 0,
        summaryPayload: null,
      };
    }

    const startMs = Date.now();
    const startTimestamp = new Date(startMs).toISOString();
    const cacheEnabled = this.useCache && getAIStagingConfig().cacheEnabled;
    const isCacheable = cacheEnabled && isPublicCacheableAgent(agentId);

    if (isCacheable) {
      const hit = this.cache.get<any>({
        agentId,
        symbol: input.symbol,
        tier: input.tier,
        query: input.query,
      });
      if (hit) {
        const raw = hit.value;
        const completionTimestamp = new Date().toISOString();
        return {
          agentId,
          status: "SUCCEEDED",
          errorCategory: "SUCCESS",
          latencyMs: Date.now() - startMs,
          startTimestamp,
          completionTimestamp,
          providerUsed: typeof raw.provider === "string" ? raw.provider : null,
          error: null,
          generatedAt: raw.generatedAt ?? null,
          cached: true,
          cacheTimestamp: hit.cachedAtIso,
          freshnessLabel: hit.freshnessLabel,
          evidenceIds: raw.evidenceSummary?.evidenceIdsUsed ?? [],
          ...(Array.isArray(raw.evidenceRecords)
            ? {
                evidenceRecords: raw.evidenceRecords.map((r: EvidenceRecord) => ({
                  ...r,
                  supportingEvidenceIds: [...(r.supportingEvidenceIds ?? [])],
                  conflictingEvidenceIds: [...(r.conflictingEvidenceIds ?? [])],
                  ...(r.metadata ? { metadata: { ...r.metadata } } : {}),
                })),
              }
            : {}),
          missingInformation: raw.evidenceSummary?.missingInformation ?? [],
          conflictsCount: raw.evidenceSummary?.conflictedCount ?? 0,
          summaryPayload: this.buildSummaryPayload(raw),
        };
      }
    }

    let timer: NodeJS.Timeout | undefined;
    let capturedEvidencePkg: EvidencePackage | undefined;
    let capturedExtraPayload: Record<string, unknown> | undefined;

    const onEvidenceCollected = (
      pkg: EvidencePackage,
      extraPayload?: Record<string, unknown>
    ) => {
      capturedEvidencePkg = pkg;
      capturedExtraPayload = extraPayload;
    };

    const effectiveTimeoutMs =
      input.deadlineAtMs !== undefined
        ? Math.max(0, Math.min(input.timeoutMs, input.deadlineAtMs - Date.now()))
        : input.timeoutMs;

    if (effectiveTimeoutMs <= 0) {
      return {
        agentId,
        status: "TIMED_OUT",
        errorCategory: "TIMEOUT",
        dataCollectionStatus: "FAILED",
        llmStatus: "TIMED_OUT",
        latencyMs: 0,
        startTimestamp,
        completionTimestamp: new Date().toISOString(),
        providerUsed: null,
        error: `Agent ${agentId} skipped: shared request deadline already exceeded.`,
        generatedAt: null,
        evidenceIds: [],
        missingInformation: [`Agent ${agentId} skipped due to shared request deadline.`],
        conflictsCount: 0,
        summaryPayload: null,
      };
    }

    const scopedInput: AgentExecutionInput = {
      ...input,
      timeoutMs: effectiveTimeoutMs,
    };

    try {
      const taskPromise = isCacheable
        ? this.cache.runDeduplicated(
            {
              agentId,
              symbol: input.symbol,
              tier: input.tier,
              query: input.query,
            },
            () => this.runSingleAgent(agentId, scopedInput, onEvidenceCollected)
          )
        : this.runSingleAgent(agentId, scopedInput, onEvidenceCollected);
      const timeoutPromise = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(new AgentTimeoutError(agentId, effectiveTimeoutMs));
        }, effectiveTimeoutMs);
      });

      const raw = await Promise.race([taskPromise, timeoutPromise]);
      const latencyMs = Date.now() - startMs;

      if (isCacheable) {
        this.cache.set({
          agentId,
          symbol: input.symbol,
          tier: input.tier,
          query: input.query,
          value: raw,
          sourceTimestamp: raw.generatedAt ?? null,
        });
      }

      const staleCount = Number(raw?.evidenceSummary?.staleCount ?? 0);

      return {
        agentId,
        status: "SUCCEEDED",
        errorCategory: "SUCCESS",
        dataCollectionStatus: "COLLECTED",
        llmStatus: "SUCCEEDED",
        latencyMs,
        startTimestamp,
        completionTimestamp: new Date().toISOString(),
        providerUsed: typeof raw.provider === "string" ? raw.provider : null,
        error: null,
        generatedAt: raw.generatedAt ?? null,
        cached: false,
        cacheTimestamp: null,
        freshnessLabel: staleCount > 0 ? "DELAYED" : "FRESH",
        evidenceIds: raw.evidenceSummary?.evidenceIdsUsed ?? [],
        ...(Array.isArray(raw.evidenceRecords)
          ? { evidenceRecords: raw.evidenceRecords }
          : {}),
        missingInformation: raw.evidenceSummary?.missingInformation ?? [],
        conflictsCount: raw.evidenceSummary?.conflictedCount ?? 0,
        summaryPayload: this.buildSummaryPayload(raw),
      };
    } catch (err: unknown) {
      const latencyMs = Date.now() - startMs;
      const isTimeout =
        err instanceof AgentTimeoutError ||
        (err instanceof AIProviderError && err.statusCode === 504);
      const isRateLimited =
        err instanceof AIProviderError &&
        (err.statusCode === 429 || err.quotaExhausted);
      const rawMsg =
        err instanceof Error ? err.message : "Unknown agent execution failure";
      const isNoData =
        !isTimeout &&
        !isRateLimited &&
        /no\s+data|unavailable|not\s+found|insufficient/i.test(rawMsg);

      const errorCategory: AgentErrorCategory = isTimeout
        ? "TIMEOUT"
        : isRateLimited
          ? "RATE_LIMITED"
          : isNoData
            ? "NO_DATA"
            : "PROVIDER_ERROR";

      const recoveredPkg: EvidencePackage | undefined =
        capturedEvidencePkg ??
        (err && typeof err === "object" && "collectedEvidencePackage" in err
          ? ((err as Record<string, unknown>).collectedEvidencePackage as EvidencePackage | undefined)
          : undefined);

      const directRecords: EvidenceRecord[] | undefined =
        err &&
        typeof err === "object" &&
        "evidenceRecords" in err &&
        Array.isArray((err as Record<string, unknown>).evidenceRecords)
          ? ((err as Record<string, unknown>).evidenceRecords as EvidenceRecord[])
          : undefined;

      const preservedRecords = recoveredPkg
        ? recoveredPkg.allRecords.map((r) => ({ ...r }))
        : directRecords
          ? directRecords.map((r) => ({ ...r }))
          : undefined;

      const hasPreservedEvidence =
        Array.isArray(preservedRecords) && preservedRecords.length > 0;

      const preservedEvidenceIds = hasPreservedEvidence
        ? preservedRecords
            .filter((r) => r.value !== null && r.value !== undefined)
            .map((r) => r.evidenceId)
        : [];

      const preservedStaleCount = recoveredPkg?.stats?.staleCount ?? 0;
      const llmStatus: "FAILED" | "TIMED_OUT" = isTimeout ? "TIMED_OUT" : "FAILED";
      const dataCollectionStatus: "COLLECTED" | "FAILED" = hasPreservedEvidence
        ? "COLLECTED"
        : "FAILED";

      const failureNotice = hasPreservedEvidence
        ? `Agent ${agentId} LLM synthesis did not complete (${errorCategory}); deterministic evidence preserved.`
        : `Agent ${agentId} did not complete (${errorCategory}).`;

      return {
        agentId,
        status: isTimeout ? "TIMED_OUT" : "FAILED",
        errorCategory,
        dataCollectionStatus,
        llmStatus,
        latencyMs,
        startTimestamp,
        completionTimestamp: new Date().toISOString(),
        providerUsed: null,
        error: redactSecrets(rawMsg),
        generatedAt: recoveredPkg?.generatedAt ?? null,
        cached: false,
        cacheTimestamp: null,
        freshnessLabel: hasPreservedEvidence
          ? preservedStaleCount > 0
            ? "DELAYED"
            : "FRESH"
          : null,
        evidenceIds: preservedEvidenceIds,
        ...(hasPreservedEvidence ? { evidenceRecords: preservedRecords } : {}),
        missingInformation: [
          ...(recoveredPkg?.missingInformation ?? []),
          failureNotice,
        ],
        conflictsCount: recoveredPkg?.stats?.conflictedCount ?? 0,
        summaryPayload: hasPreservedEvidence
          ? {
              verificationStatus: "DETERMINISTIC_EVIDENCE_ONLY_LLM_FAILED",
              dataCollectionStatus,
              llmStatus,
              report: null,
              unsupportedClaims: [],
              invalidEvidenceIdsCited: [],
              evidenceSummary: recoveredPkg
                ? {
                    totalRecords: recoveredPkg.allRecords.length,
                    verifiedCount: recoveredPkg.stats.verifiedCount,
                    unverifiedCount: recoveredPkg.stats.unverifiedCount,
                    staleCount: recoveredPkg.stats.staleCount,
                    expiredCount: recoveredPkg.stats.expiredCount,
                    conflictedCount: recoveredPkg.stats.conflictedCount,
                    conflicts: recoveredPkg.conflicts,
                    missingInformation: recoveredPkg.missingInformation,
                    evidenceIdsUsed: preservedEvidenceIds,
                  }
                : undefined,
              ...(capturedExtraPayload ?? {}),
            }
          : null,
      };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private buildSummaryPayload(raw: any): Record<string, unknown> {
    return {
      verificationStatus: raw.verificationStatus,
      dataCollectionStatus: "COLLECTED",
      llmStatus: "SUCCEEDED",
      report: raw.report,
      unsupportedClaims: raw.unsupportedClaims ?? [],
      invalidEvidenceIdsCited: raw.invalidEvidenceIdsCited ?? [],
      evidenceSummary: raw.evidenceSummary,
      ...(raw.deterministicMetrics
        ? { deterministicMetrics: raw.deterministicMetrics }
        : {}),
      ...(raw.analytics ? { analytics: raw.analytics } : {}),
      ...(raw.deterministicRisk
        ? { deterministicRisk: raw.deterministicRisk }
        : {}),
      ...(raw.regimeAssessment
        ? { regimeAssessment: raw.regimeAssessment }
        : {}),
    };
  }

  private async runSingleAgent(
    agentId: RegisteredAgentId,
    input: AgentExecutionInput,
    onEvidenceCollected?: (
      pkg: EvidencePackage,
      extraPayload?: Record<string, unknown>
    ) => void
  ): Promise<any> {
    switch (agentId) {
      case "company_research":
        return this.companyResearch.research(
          {
            symbol: input.symbol || "RELIANCE",
            question: input.query,
            tier: input.tier,
          },
          { timeoutMs: input.timeoutMs, onEvidenceCollected }
        );

      case "market_intelligence":
        return this.marketIntelligence.analyze(
          {
            focus: input.query,
            tier: input.tier,
          },
          { timeoutMs: input.timeoutMs, onEvidenceCollected }
        );

      case "institutional_intelligence":
        return this.institutionalIntelligence.analyze(
          {
            symbol: input.symbol ?? undefined,
            focus: input.query,
            tier: input.tier,
          },
          { timeoutMs: input.timeoutMs, onEvidenceCollected }
        );

      case "news_macro":
        return this.newsMacro.analyze(
          {
            symbol: input.symbol ?? undefined,
            focus: input.query,
            tier: input.tier,
          },
          { timeoutMs: input.timeoutMs, onEvidenceCollected }
        );

      case "portfolio_intelligence":
        return this.portfolioIntelligence.analyze(
          input.userId,
          {
            focus: input.query,
            tier: input.tier,
          },
          { timeoutMs: input.timeoutMs, onEvidenceCollected }
        );

      case "options_intelligence":
        return this.optionsIntelligence.analyze(
          input.userId,
          {
            symbol: input.symbol || "NIFTY",
            focus: input.query,
            tier: input.tier,
          },
          { timeoutMs: input.timeoutMs, onEvidenceCollected }
        );

      case "risk_intelligence":
        return this.riskIntelligence.analyze(
          input.userId,
          {
            focus: input.query,
            tier: input.tier,
          },
          { timeoutMs: input.timeoutMs, onEvidenceCollected }
        );
    }
  }
}

export const agentRegistry = new AgentRegistry();

