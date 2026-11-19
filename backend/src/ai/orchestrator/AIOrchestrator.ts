import { AITaskTier } from "../core/ModelRouter";
import { AIUsageTracker, aiUsageTracker } from "../core/AIUsageTracker";
import { getAIStagingConfig } from "../core/StagingConfig";
import { sanitizeUntrustedText } from "../evidence/EvidenceSchema";
import { UnifiedIntelligenceContext } from "../context/UnifiedContextSchema";
import { CrossAgentResearchSynthesis } from "../context/CrossAgentSynthesisSchema";
import { ResearchIntelligenceScorecard } from "../context/ResearchIntelligenceScorecardSchema";
import { InstitutionalResearchBrief } from "../context/InstitutionalResearchBriefSchema";
import {
  UnifiedIntelligenceContextBuilder,
  unifiedIntelligenceContextBuilder,
} from "../context/UnifiedIntelligenceContextBuilder";
import {
  AgentExecutionResult,
  AgentRegistry,
  agentRegistry,
} from "./AgentRegistry";
import {
  IntentRouter,
  IntentRoutingDecision,
  RegisteredAgentId,
  intentRouter,
} from "./IntentRouter";
import {
  OrchestratedStructuredResponse,
  ResponseSynthesizer,
  responseSynthesizer,
} from "./ResponseSynthesizer";

export class OrchestratorValidationError extends Error {
  public readonly statusCode = 400;
  public readonly code = "AI_ORCHESTRATOR_VALIDATION_ERROR";

  public constructor(message: string) {
    super(message);
    this.name = "OrchestratorValidationError";
  }
}

export interface OrchestratorRequestInput {
  userId: string;
  query: string;
  symbol?: string | null;
  tier: AITaskTier;
}

export interface OrchestratorRunOptions {
  maxConcurrency?: number;
  maxAgents?: number;
  dataTimeoutMs?: number;
  agentTimeoutMs?: number;
  synthesizerTimeoutMs?: number;
  requestTimeoutMs?: number;
  previousContexts?: UnifiedIntelligenceContext[];
  peerContexts?: UnifiedIntelligenceContext[];
}

export type OrchestratorResponseStatus =
  | "LIVE_AI"
  | "CACHED_EVIDENCE"
  | "PARTIAL"
  | "RATE_LIMITED"
  | "DETERMINISTIC_FALLBACK"
  | "NO_DATA";

export interface OrchestratorResponse {
  query: string;
  routing: IntentRoutingDecision;
  skippedAgents?: RegisteredAgentId[];
  agentExecutions: AgentExecutionResult[];
  synthesized: OrchestratedStructuredResponse;
  unifiedContext?: UnifiedIntelligenceContext;
  crossAgentSynthesis?: CrossAgentResearchSynthesis;
  researchScorecard?: ResearchIntelligenceScorecard;
  researchBrief?: InstitutionalResearchBrief;
  responseStatus: OrchestratorResponseStatus;
  cacheSummary: {
    hits: number;
    misses: number;
    total: number;
  };
  evidenceCount: number;
  model: string;
  provider?: string;
  fallbackUsed?: boolean;
  tier: AITaskTier;
  tokenUsage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  totalLatencyMs: number;
  generatedAt: string;
}

const VALID_TIERS: ReadonlySet<string> = new Set(["deep", "balanced", "fast"]);

export function validateOrchestratorInput(
  userId: string,
  rawBody: unknown
): OrchestratorRequestInput {
  if (!userId || typeof userId !== "string") {
    throw new OrchestratorValidationError("Authenticated userId is required.");
  }
  if (!rawBody || typeof rawBody !== "object" || Array.isArray(rawBody)) {
    throw new OrchestratorValidationError("Request body must be a JSON object.");
  }
  const body = rawBody as Record<string, unknown>;
  if (typeof body.query !== "string" || body.query.trim().length === 0) {
    throw new OrchestratorValidationError("Query is required.");
  }
  if (body.query.length > 2000) {
    throw new OrchestratorValidationError(
      "Query exceeds maximum length of 2000 characters."
    );
  }

  const tierRaw =
    typeof body.tier === "string" ? body.tier.trim().toLowerCase() : "balanced";
  if (!VALID_TIERS.has(tierRaw)) {
    throw new OrchestratorValidationError(
      `Invalid AI tier "${tierRaw}". Allowed: deep, balanced, fast.`
    );
  }

  let symbol: string | null = null;
  if (body.symbol !== undefined && body.symbol !== null) {
    if (typeof body.symbol !== "string") {
      throw new OrchestratorValidationError("Symbol must be a string when provided.");
    }
    const trimmedSymbol = body.symbol.trim();
    if (trimmedSymbol.length > 0) {
      const cleanedSymbol = trimmedSymbol
        .toUpperCase()
        .replace(/^NSE:/i, "")
        .replace(/\.NS$/i, "")
        .replace(/\.BO$/i, "");
      if (!/^[A-Z0-9._^&-]{1,24}$/.test(cleanedSymbol)) {
        throw new OrchestratorValidationError(
          `Invalid symbol "${trimmedSymbol}". Expected 1-24 alphanumeric/NSE characters.`
        );
      }
      symbol = cleanedSymbol;
    }
  }

  return {
    userId,
    query: sanitizeUntrustedText(body.query),
    symbol,
    tier: tierRaw as AITaskTier,
  };
}

async function runWithConcurrencyLimit<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function runNext(): Promise<void> {
    while (nextIndex < items.length) {
      const idx = nextIndex;
      nextIndex += 1;
      results[idx] = await worker(items[idx]);
    }
  }

  const workers = Array.from(
    { length: Math.min(Math.max(1, limit), items.length) },
    () => runNext()
  );
  await Promise.all(workers);
  return results;
}

export class AIOrchestrator {
  private readonly router: IntentRouter;
  private readonly registry: AgentRegistry;
  private readonly synthesizer: ResponseSynthesizer;
  private readonly usageTracker: AIUsageTracker;
  private readonly contextBuilder: UnifiedIntelligenceContextBuilder;

  public constructor(deps?: {
    router?: IntentRouter;
    registry?: AgentRegistry;
    synthesizer?: ResponseSynthesizer;
    usageTracker?: AIUsageTracker;
    contextBuilder?: UnifiedIntelligenceContextBuilder;
  }) {
    this.router = deps?.router ?? intentRouter;
    this.registry = deps?.registry ?? agentRegistry;
    this.synthesizer = deps?.synthesizer ?? responseSynthesizer;
    this.usageTracker = deps?.usageTracker ?? aiUsageTracker;
    this.contextBuilder = deps?.contextBuilder ?? unifiedIntelligenceContextBuilder;
  }

  public async orchestrate(
    userId: string,
    rawBody: unknown,
    options: OrchestratorRunOptions = {}
  ): Promise<OrchestratorResponse> {
    const startMs = Date.now();
    const validated = validateOrchestratorInput(userId, rawBody);
    const staging = getAIStagingConfig();
    const maxConcurrency =
      options.maxConcurrency ?? (staging.stagingMode ? staging.maxConcurrentRequests : 2);
    const maxAgents = options.maxAgents ?? staging.maxAgentsPerRequest;
    const dataTimeoutMs = options.dataTimeoutMs ?? 12_000;
    const agentTimeoutMs = options.agentTimeoutMs ?? 25_000;
    const synthesizerTimeoutMs = options.synthesizerTimeoutMs ?? 20_000;
    const requestTimeoutMs =
      options.requestTimeoutMs ?? Math.max(agentTimeoutMs + synthesizerTimeoutMs, 45_000);
    const requestDeadlineAtMs = startMs + requestTimeoutMs;
    const agentBudgetDeadlineAtMs =
      startMs + Math.max(agentTimeoutMs, requestTimeoutMs - Math.min(10_000, synthesizerTimeoutMs));

    const PRIORITY_ORDER: Record<RegisteredAgentId, number> = {
      company_research: 0,
      institutional_intelligence: 1,
      market_intelligence: 2,
      news_macro: 3,
      portfolio_intelligence: 4,
      options_intelligence: 5,
      risk_intelligence: 6,
    };

    const rawRouting = this.router.route(validated.query, validated.symbol);
    const dedupedAgents = Array.from(new Set(rawRouting.selectedAgents)).sort(
      (a, b) => (PRIORITY_ORDER[a] ?? 99) - (PRIORITY_ORDER[b] ?? 99)
    );
    const selectedAgents = dedupedAgents.slice(0, Math.max(1, maxAgents));
    const skippedAgents = dedupedAgents.slice(selectedAgents.length);
    const routing: IntentRoutingDecision = {
      ...rawRouting,
      selectedAgents,
    };

    const executions: AgentExecutionResult[] =
      selectedAgents.length > 0
        ? await runWithConcurrencyLimit(
            selectedAgents,
            maxConcurrency,
            (agentId: RegisteredAgentId) =>
              this.registry.execute(agentId, {
                userId: validated.userId,
                query: validated.query,
                symbol: routing.extractedSymbol,
                tier: validated.tier,
                timeoutMs: agentTimeoutMs,
                dataTimeoutMs,
                deadlineAtMs: agentBudgetDeadlineAtMs,
              })
          )
        : [];

    const remainingForSynth = Math.max(1_500, requestDeadlineAtMs - Date.now());
    const synthResult = await this.synthesizer.synthesize({
      query: validated.query,
      routing,
      executions,
      tier: validated.tier,
      timeoutMs: Math.min(synthesizerTimeoutMs, remainingForSynth),
    });

    const succeeded = executions.filter((e) => e.status === "SUCCEEDED");
    const failed = executions.filter((e) => e.status !== "SUCCEEDED");
    const cacheHits = executions.filter((e) => e.cached === true).length;
    const cacheMisses = executions.length - cacheHits;
    const allEvidenceIds = new Set<string>();
    for (const ex of executions) {
      for (const id of ex.evidenceIds) allEvidenceIds.add(id);
    }

    const synthProvider = (synthResult as { provider?: string }).provider ?? "unknown";
    const synthFallbackUsed = Boolean(
      (synthResult as { fallbackUsed?: boolean }).fallbackUsed
    );
    const isDeterministicSynth = synthProvider === "deterministic";

    let responseStatus: OrchestratorResponseStatus = "LIVE_AI";
    if (executions.length === 0) {
      responseStatus = isDeterministicSynth
        ? "DETERMINISTIC_FALLBACK"
        : "LIVE_AI";
    } else if (succeeded.length === 0) {
      if (failed.some((e) => e.errorCategory === "RATE_LIMITED")) {
        responseStatus = "RATE_LIMITED";
      } else if (failed.every((e) => e.errorCategory === "NO_DATA")) {
        responseStatus = "NO_DATA";
      } else {
        responseStatus = "DETERMINISTIC_FALLBACK";
      }
    } else if (failed.length > 0) {
      responseStatus = "PARTIAL";
    } else if (cacheHits === executions.length && isDeterministicSynth) {
      responseStatus = "CACHED_EVIDENCE";
    } else if (cacheHits === executions.length && cacheHits > 0) {
      responseStatus = "CACHED_EVIDENCE";
    } else if (isDeterministicSynth) {
      responseStatus = "DETERMINISTIC_FALLBACK";
    }

    const totalLatencyMs = Date.now() - startMs;
    const hasTokens =
      synthResult.tokenUsage &&
      (synthResult.tokenUsage.inputTokens > 0 || synthResult.tokenUsage.outputTokens > 0);

    this.usageTracker.record({
      userId: validated.userId,
      provider: synthProvider,
      model: synthResult.model,
      agent: routing.intent,
      success: responseStatus === "LIVE_AI" || responseStatus === "CACHED_EVIDENCE" || responseStatus === "PARTIAL",
      errorCategory:
        responseStatus === "RATE_LIMITED"
          ? "RATE_LIMITED"
          : responseStatus === "NO_DATA"
            ? "NO_DATA"
            : responseStatus === "DETERMINISTIC_FALLBACK"
              ? "PROVIDER_ERROR"
              : "SUCCESS",
      latencyMs: totalLatencyMs,
      inputTokens: hasTokens ? synthResult.tokenUsage.inputTokens : null,
      outputTokens: hasTokens ? synthResult.tokenUsage.outputTokens : null,
      cacheHit: cacheHits > 0,
      fallbackUsed: synthFallbackUsed,
      deterministicFallback: isDeterministicSynth,
      responseStatus,
    });

    const unifiedContext = this.contextBuilder.buildFromExecutions({
      userId: validated.userId,
      symbol: routing.extractedSymbol ?? "MARKET",
      executions,
      skippedAgents,
      defaultProvider: synthProvider,
      isDeterministicSynthesis: isDeterministicSynth,
      previousContexts: options.previousContexts,
      peerContexts: options.peerContexts,
    });

    return {
      query: validated.query,
      routing,
      ...(skippedAgents.length > 0 ? { skippedAgents } : {}),
      agentExecutions: executions,
      synthesized: synthResult.structured,
      unifiedContext,
      crossAgentSynthesis: unifiedContext.crossAgentSynthesis,
      researchScorecard: unifiedContext.researchScorecard,
      researchBrief: unifiedContext.researchBrief,
      responseStatus,
      cacheSummary: {
        hits: cacheHits,
        misses: cacheMisses,
        total: executions.length,
      },
      evidenceCount: allEvidenceIds.size,
      model: synthResult.model,
      provider: synthProvider,
      fallbackUsed: synthFallbackUsed,
      tier: validated.tier,
      tokenUsage: synthResult.tokenUsage,
      totalLatencyMs,
      generatedAt: new Date().toISOString(),
    };
  }
}

export const aiOrchestrator = new AIOrchestrator();

