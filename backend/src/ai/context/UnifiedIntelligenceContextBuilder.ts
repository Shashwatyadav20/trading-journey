import crypto from "node:crypto";
import { AITaskTier } from "../core/ModelRouter";
import { getAIStagingConfig } from "../core/StagingConfig";
import { ConflictDetail, ConflictResolver, conflictResolver } from "../evidence/ConflictResolver";
import {
  EvidenceRecord,
  isValidIsoTimestamp,
  normalizeEvidenceSymbol,
} from "../evidence/EvidenceSchema";
import { FreshnessValidator, freshnessValidator } from "../evidence/FreshnessValidator";
import {
  AgentExecutionResult,
  AgentRegistry,
  agentRegistry,
} from "../orchestrator/AgentRegistry";
import { RegisteredAgentId } from "../orchestrator/IntentRouter";
import {
  ContextQualityAssessment,
  IncompatiblePeriodRejection,
  PreservedEvidenceReference,
  SourceProvenanceSummary,
  UnifiedAgentExecutionRecord,
  UnifiedAgentExecutionStatus,
  UnifiedContextStatus,
  UnifiedContextValidationError,
  UnifiedFreshnessSummary,
  UnifiedGenerationMode,
  UnifiedIntelligenceContext,
  inferExchangeFromSymbol,
  normalizeContextSymbol,
  projectPreservedEvidence,
} from "./UnifiedContextSchema";
import {
  CrossAgentResearchSynthesizer,
  crossAgentResearchSynthesizer,
} from "./CrossAgentResearchSynthesizer";
import {
  InstitutionalResearchIntelligenceService,
  institutionalResearchIntelligenceService,
} from "./InstitutionalResearchIntelligenceService";
import {
  InstitutionalResearchBriefService,
  institutionalResearchBriefService,
} from "./InstitutionalResearchBriefService";

const VALID_TIERS: ReadonlySet<string> = new Set(["deep", "balanced", "fast"]);

const DEFAULT_SYMBOL_AGENTS: RegisteredAgentId[] = [
  "company_research",
  "institutional_intelligence",
  "market_intelligence",
  "news_macro",
];

const AGENT_PRIORITY_ORDER: Record<RegisteredAgentId, number> = {
  company_research: 0,
  institutional_intelligence: 1,
  market_intelligence: 2,
  news_macro: 3,
  portfolio_intelligence: 4,
  options_intelligence: 5,
  risk_intelligence: 6,
};

export interface BuildUnifiedContextRequest {
  symbol: string;
  companyName?: string | null;
  requestedPeriod?: string | null;
  agents?: RegisteredAgentId[];
  tier?: AITaskTier;
  query?: string;
}

export interface BuildFromExecutionsInput {
  userId: string;
  symbol: string;
  rawSymbol?: string;
  companyName?: string | null;
  requestedPeriod?: string | null;
  requestedAt?: string;
  referenceDate?: Date;
  executions: AgentExecutionResult[];
  skippedAgents?: RegisteredAgentId[];
  defaultProvider?: string | null;
  isDeterministicSynthesis?: boolean;
  previousContexts?: UnifiedIntelligenceContext[];
  peerContexts?: UnifiedIntelligenceContext[];
}

export interface BuildForSymbolOptions {
  referenceDate?: Date;
  timeoutMs?: number;
  requestTimeoutMs?: number;
  maxConcurrency?: number;
  previousContexts?: UnifiedIntelligenceContext[];
  peerContexts?: UnifiedIntelligenceContext[];
}

function normalizePeriodToken(period: string | null | undefined): string | null {
  if (!period || typeof period !== "string") return null;
  const cleaned = period.trim().toUpperCase().replace(/\s+/g, " ");
  return cleaned.length > 0 ? cleaned : null;
}

function buildContentDedupeKey(record: EvidenceRecord): string {
  const normClaim = record.claim.trim().toLowerCase().replace(/\s+/g, " ");
  const normSource = record.source.trim().toLowerCase().replace(/\s+/g, " ");
  const rawPeriod =
    record.dataPeriod ??
    (typeof record.metadata?.dataPeriod === "string"
      ? record.metadata.dataPeriod
      : "");
  const normPeriod = rawPeriod.trim().toUpperCase();
  const normUnit = (record.unit ?? "").trim().toUpperCase();
  const normCurrency = (record.currency ?? "").trim().toUpperCase();
  const normBasis = String(record.metadata?.basis ?? "").trim().toLowerCase();
  const normPubAt = (record.publishedAt ?? "").trim();
  const valStr = record.value === null ? "NULL" : String(record.value);
  return `${record.symbol}|${record.category}|${normClaim}|${normSource}|${valStr}|${normUnit}|${normCurrency}|${normBasis}|${normPeriod}|${normPubAt}`;
}

function mapExecutionStatus(
  exec: AgentExecutionResult,
  evidenceCount: number
): UnifiedAgentExecutionStatus {
  if (exec.status === "TIMED_OUT") return "TIMEOUT";
  if (exec.status === "FAILED") {
    if (exec.errorCategory === "RATE_LIMITED") return "RATE_LIMITED";
    if (exec.errorCategory === "NO_DATA") return "NO_DATA";
    if (exec.errorCategory === "TIMEOUT") return "TIMEOUT";
    return "PROVIDER_ERROR";
  }
  if (evidenceCount === 0 && exec.missingInformation.length > 0) {
    return "PARTIAL";
  }
  if (exec.missingInformation.length > 0 || exec.conflictsCount > 0) {
    return "PARTIAL";
  }
  return "SUCCESS";
}

function resolveGenerationMode(params: {
  exec: AgentExecutionResult;
  providerUsed: string | null;
  evidenceCount?: number;
}): UnifiedGenerationMode {
  const { exec, providerUsed, evidenceCount = 0 } = params;
  if (exec.status !== "SUCCEEDED") {
    return evidenceCount > 0 ? "DETERMINISTIC" : "NONE";
  }
  if (providerUsed === "deterministic") return "DETERMINISTIC";
  if (exec.cached === true) return "CACHED";
  if (providerUsed) return "LIVE_AI";
  return "DETERMINISTIC";
}

export class UnifiedIntelligenceContextBuilder {
  private readonly registry: AgentRegistry;
  private readonly freshness: FreshnessValidator;
  private readonly conflicts: ConflictResolver;
  private readonly synthesizer: CrossAgentResearchSynthesizer;
  private readonly researchIntelligence: InstitutionalResearchIntelligenceService;
  private readonly briefService: InstitutionalResearchBriefService;

  public constructor(deps?: {
    registry?: AgentRegistry;
    freshness?: FreshnessValidator;
    conflicts?: ConflictResolver;
    synthesizer?: CrossAgentResearchSynthesizer;
    researchIntelligence?: InstitutionalResearchIntelligenceService;
    briefService?: InstitutionalResearchBriefService;
  }) {
    this.registry = deps?.registry ?? agentRegistry;
    this.freshness = deps?.freshness ?? freshnessValidator;
    this.conflicts = deps?.conflicts ?? conflictResolver;
    this.synthesizer = deps?.synthesizer ?? crossAgentResearchSynthesizer;
    this.researchIntelligence =
      deps?.researchIntelligence ?? institutionalResearchIntelligenceService;
    this.briefService =
      deps?.briefService ?? institutionalResearchBriefService;
  }

  public validateRequest(
    userId: string,
    rawBody: unknown
  ): {
    userId: string;
    symbol: string;
    rawSymbol: string;
    companyName: string | null;
    requestedPeriod: string | null;
    agents: RegisteredAgentId[];
    tier: AITaskTier;
    query: string;
  } {
    if (!userId || typeof userId !== "string" || !userId.trim()) {
      throw new UnifiedContextValidationError("Authenticated userId is required.");
    }
    if (!rawBody || typeof rawBody !== "object" || Array.isArray(rawBody)) {
      throw new UnifiedContextValidationError("Request body must be a JSON object.");
    }

    const body = rawBody as Record<string, unknown>;
    if (typeof body.symbol !== "string" || !body.symbol.trim()) {
      throw new UnifiedContextValidationError("Symbol is required.");
    }
    const rawSymbol = body.symbol.trim();
    const symbol = normalizeContextSymbol(rawSymbol);

    const companyName =
      typeof body.companyName === "string" && body.companyName.trim()
        ? body.companyName.trim().slice(0, 120)
        : null;

    const requestedPeriod =
      typeof body.requestedPeriod === "string" && body.requestedPeriod.trim()
        ? body.requestedPeriod.trim().slice(0, 40)
        : null;

    const tierRaw =
      typeof body.tier === "string" ? body.tier.trim().toLowerCase() : "balanced";
    if (!VALID_TIERS.has(tierRaw)) {
      throw new UnifiedContextValidationError(
        `Invalid AI tier "${tierRaw}". Allowed: deep, balanced, fast.`
      );
    }

    let agents: RegisteredAgentId[] = [...DEFAULT_SYMBOL_AGENTS];
    if (body.agents !== undefined) {
      if (!Array.isArray(body.agents) || body.agents.length === 0) {
        throw new UnifiedContextValidationError(
          "When provided, agents must be a non-empty array of allowed agent IDs."
        );
      }
      const deduped: RegisteredAgentId[] = [];
      for (const rawAgent of body.agents) {
        if (typeof rawAgent !== "string" || !this.registry.isAllowed(rawAgent)) {
          throw new UnifiedContextValidationError(
            `Invalid or disallowed agent "${String(rawAgent)}".`
          );
        }
        if (!deduped.includes(rawAgent)) {
          deduped.push(rawAgent);
        }
      }
      agents = deduped;
    }

    const query =
      typeof body.query === "string" && body.query.trim()
        ? body.query.trim().slice(0, 500)
        : `Unified intelligence research context for ${symbol}`;

    return {
      userId: userId.trim(),
      symbol,
      rawSymbol,
      companyName,
      requestedPeriod,
      agents,
      tier: tierRaw as AITaskTier,
      query,
    };
  }

  public async buildForSymbol(
    userId: string,
    rawBody: unknown,
    options: BuildForSymbolOptions = {}
  ): Promise<UnifiedIntelligenceContext> {
    const requestedAt = (options.referenceDate ?? new Date()).toISOString();
    const validated = this.validateRequest(userId, rawBody);
    const staging = getAIStagingConfig();
    const maxAgents = staging.maxAgentsPerRequest;
    const prioritizedAgents = [...validated.agents].sort(
      (a, b) => (AGENT_PRIORITY_ORDER[a] ?? 99) - (AGENT_PRIORITY_ORDER[b] ?? 99)
    );
    const selectedAgents = prioritizedAgents.slice(0, Math.max(1, maxAgents));
    const skippedAgents = prioritizedAgents.slice(selectedAgents.length);
    const perAgentTimeoutMs = options.timeoutMs ?? 20_000;
    const totalRequestTimeoutMs =
      options.requestTimeoutMs ?? Math.max(perAgentTimeoutMs, Math.round(perAgentTimeoutMs * 1.5));
    const requestDeadlineAtMs = Date.now() + totalRequestTimeoutMs;
    const maxConcurrency = Math.max(
      1,
      options.maxConcurrency ??
        (staging.stagingMode ? 1 : Math.min(2, staging.maxConcurrentRequests))
    );

    const executions: AgentExecutionResult[] = new Array(selectedAgents.length);
    let nextIndex = 0;
    const runWorker = async () => {
      while (nextIndex < selectedAgents.length) {
        const idx = nextIndex;
        nextIndex += 1;
        const agentId = selectedAgents[idx];
        const remainingMs = Math.max(0, requestDeadlineAtMs - Date.now());
        executions[idx] = await this.registry.execute(agentId, {
          userId: validated.userId,
          query: validated.query,
          symbol: validated.symbol,
          tier: validated.tier,
          timeoutMs: Math.min(perAgentTimeoutMs, remainingMs),
          deadlineAtMs: requestDeadlineAtMs,
        });
      }
    };

    const workerCount = Math.min(maxConcurrency, Math.max(1, selectedAgents.length));
    await Promise.all(Array.from({ length: workerCount }, () => runWorker()));

    return this.buildFromExecutions({
      userId: validated.userId,
      symbol: validated.symbol,
      rawSymbol: validated.rawSymbol,
      companyName: validated.companyName,
      requestedPeriod: validated.requestedPeriod,
      requestedAt,
      referenceDate: options.referenceDate,
      executions,
      skippedAgents,
      previousContexts: options.previousContexts,
      peerContexts: options.peerContexts,
    });
  }

  public buildFromExecutions(
    input: BuildFromExecutionsInput
  ): UnifiedIntelligenceContext {
    if (!input.userId || typeof input.userId !== "string" || !input.userId.trim()) {
      throw new UnifiedContextValidationError("Authenticated userId is required.");
    }

    const referenceDate = input.referenceDate ?? new Date();
    const createdAt = referenceDate.toISOString();
    const requestedAt = isValidIsoTimestamp(input.requestedAt)
      ? input.requestedAt!
      : createdAt;
    const normalizedSymbol = normalizeEvidenceSymbol(input.symbol || "MARKET") || "MARKET";
    const exchange = inferExchangeFromSymbol(
      input.rawSymbol ?? input.symbol ?? normalizedSymbol,
      normalizedSymbol
    );
    const requestedPeriodNorm = normalizePeriodToken(input.requestedPeriod);

    // 1. Collect raw evidence records without mutating originals, tracking origin agent/provider.
    const seenEvidenceIds = new Set<string>();
    const seenContentKeys = new Set<string>();
    const rawCandidateEntries: Array<{
      record: EvidenceRecord;
      agentSource: RegisteredAgentId;
      provider: string | null;
    }> = [];
    const incompatiblePeriodsRejected: IncompatiblePeriodRejection[] = [];
    const detectedPeriods = new Set<string>();
    const missingDataSet = new Set<string>();

    for (const exec of input.executions) {
      for (const missing of exec.missingInformation ?? []) {
        if (missing && missing.trim()) {
          missingDataSet.add(missing.trim());
        }
      }

      if (exec.status !== "SUCCEEDED") {
        if ((exec.missingInformation ?? []).length === 0) {
          missingDataSet.add(
            `Agent ${exec.agentId} did not succeed (${exec.errorCategory}${
              exec.error ? `: ${exec.error}` : ""
            }).`
          );
        }
        if (!Array.isArray(exec.evidenceRecords) || exec.evidenceRecords.length === 0) {
          continue;
        }
      }

      const providerForExec =
        exec.providerUsed ?? (input.defaultProvider ?? null);

      const records = exec.evidenceRecords ?? [];
      for (const orig of records) {
        const effectivePeriod =
          orig.dataPeriod ??
          (typeof orig.metadata?.dataPeriod === "string"
            ? orig.metadata.dataPeriod
            : null);

        // Clone shallowly so we never mutate caller's EvidenceRecord instances.
        const record: EvidenceRecord = {
          ...orig,
          dataPeriod: effectivePeriod,
          supportingEvidenceIds: [...(orig.supportingEvidenceIds ?? [])],
          conflictingEvidenceIds: [...(orig.conflictingEvidenceIds ?? [])],
          ...(orig.metadata ? { metadata: { ...orig.metadata } } : {}),
        };

        const periodNorm = normalizePeriodToken(record.dataPeriod);
        if (periodNorm) {
          detectedPeriods.add(periodNorm);
        }

        // Reject incompatible reporting periods when a specific period is requested.
        if (
          requestedPeriodNorm &&
          periodNorm &&
          (record.category === "QUARTERLY_FINANCIALS" ||
            record.category === "INSTITUTIONAL_HOLDING") &&
          periodNorm !== requestedPeriodNorm
        ) {
          incompatiblePeriodsRejected.push({
            evidenceId: record.evidenceId,
            agentSource: exec.agentId,
            sourceName: record.source,
            dataPeriod: record.dataPeriod ?? periodNorm,
            reason: `Reporting period "${record.dataPeriod}" does not match requested period "${input.requestedPeriod}".`,
          });
          missingDataSet.add(
            `Rejected ${record.claim} from ${record.source}: reporting period "${record.dataPeriod}" incompatible with "${input.requestedPeriod}".`
          );
          continue;
        }

        // Missing values must never be represented as verified evidence.
        if (record.value === null) {
          missingDataSet.add(
            `Missing value for ${record.claim} (source: ${record.source})`
          );
          continue;
        }

        if (seenEvidenceIds.has(record.evidenceId)) {
          continue;
        }
        const contentKey = buildContentDedupeKey(record);
        if (seenContentKeys.has(contentKey)) {
          continue;
        }

        seenEvidenceIds.add(record.evidenceId);
        seenContentKeys.add(contentKey);
        rawCandidateEntries.push({
          record,
          agentSource: exec.agentId,
          provider: providerForExec,
        });
      }
    }

    // 2. Run ConflictResolver across all combined deduplicated evidence records.
    const conflictResolution = this.conflicts.resolve(
      rawCandidateEntries.map((e) => e.record)
    );
    const resolvedById = new Map<string, EvidenceRecord>();
    for (const rec of conflictResolution.records) {
      resolvedById.set(rec.evidenceId, rec);
    }

    // 3. Project into PreservedEvidenceReference with granular freshness and limitations.
    const evidenceReferences: PreservedEvidenceReference[] = [];
    const agentEvidenceMap = new Map<RegisteredAgentId, PreservedEvidenceReference[]>();
    let freshCount = 0;
    let agingCount = 0;
    let staleCount = 0;
    let expiredCount = 0;
    let unknownCount = 0;
    let newestMarketTsMs = -1;
    let newestMarketTsIso: string | null = null;

    for (const entry of rawCandidateEntries) {
      const resolved = resolvedById.get(entry.record.evidenceId) ?? entry.record;
      const baseFreshness = this.freshness.evaluateFreshness(
        resolved,
        referenceDate
      );
      const granular = this.freshness.evaluateGranularFreshness(
        resolved,
        referenceDate
      );
      const recordWithEvaluatedFreshness: EvidenceRecord = {
        ...resolved,
        freshness: baseFreshness.freshness,
      };

      if (granular.freshness === "FRESH") freshCount += 1;
      else if (granular.freshness === "AGING") agingCount += 1;
      else if (granular.freshness === "STALE") staleCount += 1;
      else if (granular.freshness === "EXPIRED") expiredCount += 1;
      else unknownCount += 1;

      if (
        resolved.category === "INTRADAY_PRICE" ||
        resolved.category === "DAILY_MARKET_DATA"
      ) {
        const tsCandidate = resolved.publishedAt ?? resolved.retrievedAt;
        const parsedMs = Date.parse(tsCandidate);
        if (!Number.isNaN(parsedMs) && parsedMs > newestMarketTsMs) {
          newestMarketTsMs = parsedMs;
          newestMarketTsIso = new Date(parsedMs).toISOString();
        }
      }

      const projected = projectPreservedEvidence({
        record: recordWithEvaluatedFreshness,
        agentSource: entry.agentSource,
        provider: entry.provider,
        granularFreshness: granular.freshness,
      });
      evidenceReferences.push(projected);

      const list = agentEvidenceMap.get(entry.agentSource) ?? [];
      list.push(projected);
      agentEvidenceMap.set(entry.agentSource, list);
    }

    // 4. Build Source Provenance Summary
    const provenanceMap = new Map<
      string,
      {
        sourceName: string;
        sourceTier: SourceProvenanceSummary["sourceTier"];
        sourceClassification: SourceProvenanceSummary["sourceClassification"];
        sourceUrl: string | null;
        evidenceCount: number;
        agentSources: Set<RegisteredAgentId>;
      }
    >();
    for (const ref of evidenceReferences) {
      const key = `${ref.sourceName}|${ref.sourceTier}`;
      const existing = provenanceMap.get(key);
      if (existing) {
        existing.evidenceCount += 1;
        existing.agentSources.add(ref.agentSource);
        if (!existing.sourceUrl && ref.sourceUrl) existing.sourceUrl = ref.sourceUrl;
      } else {
        provenanceMap.set(key, {
          sourceName: ref.sourceName,
          sourceTier: ref.sourceTier,
          sourceClassification: ref.sourceClassification,
          sourceUrl: ref.sourceUrl,
          evidenceCount: 1,
          agentSources: new Set([ref.agentSource]),
        });
      }
    }

    const sourceProvenance: SourceProvenanceSummary[] = Array.from(
      provenanceMap.values()
    ).map((p) => ({
      sourceName: p.sourceName,
      sourceTier: p.sourceTier,
      sourceClassification: p.sourceClassification,
      sourceUrl: p.sourceUrl,
      evidenceCount: p.evidenceCount,
      agentSources: Array.from(p.agentSources),
    }));

    // 5. Build Agent Execution Metadata
    const agentExecutions: UnifiedAgentExecutionRecord[] = input.executions.map(
      (exec) => {
        const agentRefs = agentEvidenceMap.get(exec.agentId) ?? [];
        const hasExplicitRecords = Array.isArray(exec.evidenceRecords);
        const evidenceCount = hasExplicitRecords
          ? agentRefs.length
          : exec.status !== "SUCCEEDED"
            ? 0
            : exec.evidenceIds.length;
        const aFresh = agentRefs.filter(
          (r) => r.granularFreshness === "FRESH" || r.granularFreshness === "AGING"
        ).length;
        const aStale = agentRefs.filter((r) => r.freshnessStatus === "STALE").length;
        const aExpired = agentRefs.filter(
          (r) => r.freshnessStatus === "EXPIRED" && r.granularFreshness !== "UNKNOWN"
        ).length;
        const aUnknown = agentRefs.filter((r) => r.granularFreshness === "UNKNOWN").length;

        const label: UnifiedAgentExecutionRecord["freshnessSummary"]["label"] =
          evidenceCount === 0
            ? "NO_DATA"
            : aStale > 0 || aExpired > 0 || aUnknown > 0
              ? "STALE_OR_EXPIRED"
              : exec.freshnessLabel === "DELAYED"
                ? "DELAYED"
                : "FRESH";

        const providerUsed =
          exec.providerUsed ??
          (exec.status === "SUCCEEDED" ? (input.defaultProvider ?? null) : null);

        const completionTimestamp = isValidIsoTimestamp(exec.completionTimestamp)
          ? exec.completionTimestamp!
          : isValidIsoTimestamp(exec.generatedAt)
            ? exec.generatedAt!
            : createdAt;
        const startTimestamp = isValidIsoTimestamp(exec.startTimestamp)
          ? exec.startTimestamp!
          : new Date(
              Math.max(0, Date.parse(completionTimestamp) - Math.max(0, exec.latencyMs))
            ).toISOString();

        return {
          agentName: exec.agentId,
          executionStatus: mapExecutionStatus(exec, evidenceCount),
          startTimestamp,
          completionTimestamp,
          providerUsed,
          generationMode: resolveGenerationMode({ exec, providerUsed, evidenceCount }),
          cacheHit: Boolean(exec.cached),
          errorCategory: exec.errorCategory,
          error: exec.error ?? null,
          evidenceCount,
          freshnessSummary: {
            freshCount: aFresh,
            staleCount: aStale,
            expiredCount: aExpired,
            unknownCount: aUnknown,
            label,
          },
        };
      }
    );

    const skippedAgents = input.skippedAgents ?? [];
    for (const skippedId of skippedAgents) {
      agentExecutions.push({
        agentName: skippedId,
        executionStatus: "SKIPPED",
        startTimestamp: createdAt,
        completionTimestamp: createdAt,
        providerUsed: null,
        generationMode: "NONE",
        cacheHit: false,
        errorCategory: "SKIPPED",
        error: "Skipped due to staging maxAgentsPerRequest limit.",
        evidenceCount: 0,
        freshnessSummary: {
          freshCount: 0,
          staleCount: 0,
          expiredCount: 0,
          unknownCount: 0,
          label: "NO_DATA",
        },
      });
    }

    // 6. Freshness Summary (never silently combine stale and fresh data)
    const hasFresh = freshCount + agingCount > 0;
    const hasStaleOrExpired = staleCount + expiredCount > 0;
    const hasMixedFreshness = hasFresh && (hasStaleOrExpired || unknownCount > 0);
    const explicitWarning = hasMixedFreshness
      ? `Mixed freshness detected (${freshCount + agingCount} fresh/aging, ${staleCount} stale, ${expiredCount} expired, ${unknownCount} unknown timestamp). Stale/expired/unverified-timestamp items must not be treated as live data.`
      : hasStaleOrExpired
        ? `Contains ${staleCount} stale and ${expiredCount} expired evidence items; verify live market feed before relying on figures.`
        : unknownCount > 0
          ? `Contains ${unknownCount} evidence item(s) with missing or invalid publication timestamps; freshness cannot be verified.`
          : null;

    const freshnessSummary: UnifiedFreshnessSummary = {
      freshCount,
      agingCount,
      staleCount,
      expiredCount,
      unknownCount,
      hasMixedFreshness,
      explicitWarning,
    };

    // 7. Context Quality Assessment (no fabricated confidence scores or percentages)
    const completedAgents = agentExecutions
      .filter((a) => a.executionStatus === "SUCCESS" || a.executionStatus === "PARTIAL")
      .map((a) => a.agentName);
    const failedAgents = agentExecutions
      .filter(
        (a) =>
          a.executionStatus === "NO_DATA" ||
          a.executionStatus === "RATE_LIMITED" ||
          a.executionStatus === "TIMEOUT" ||
          a.executionStatus === "PROVIDER_ERROR"
      )
      .map((a) => a.agentName);

    const availableEvidenceCount =
      evidenceReferences.length > 0
        ? evidenceReferences.filter((r) => r.value !== null).length
        : agentExecutions.reduce((sum, a) => sum + a.evidenceCount, 0);

    const conflictedEvidenceCount = evidenceReferences.filter(
      (r) => r.verificationStatus === "CONFLICTED"
    ).length;

    const missingData = Array.from(missingDataSet);

    let qualityClassification: UnifiedContextStatus = "COMPLETE";
    if (availableEvidenceCount === 0) {
      qualityClassification = "INSUFFICIENT_DATA";
    } else if (
      completedAgents.length === 0 ||
      failedAgents.length > 0 ||
      skippedAgents.length > 0 ||
      missingData.length > 0 ||
      conflictResolution.conflicts.length > 0 ||
      staleCount > 0 ||
      expiredCount > 0 ||
      unknownCount > 0 ||
      incompatiblePeriodsRejected.length > 0
    ) {
      qualityClassification = "PARTIAL";
    }

    const qualityAssessment: ContextQualityAssessment = {
      availableEvidenceCount,
      missingDataCount: missingData.length,
      staleEvidenceCount: staleCount,
      expiredEvidenceCount: expiredCount,
      conflictedEvidenceCount,
      completedAgentsCount: completedAgents.length,
      failedAgentsCount: failedAgents.length,
      skippedAgentsCount: skippedAgents.length,
      completedAgents,
      failedAgents,
      skippedAgents,
      qualityClassification,
    };

    const baseContext: UnifiedIntelligenceContext = {
      contextId: crypto.randomUUID(),
      userId: input.userId.trim(),
      symbol: normalizedSymbol,
      companyName: input.companyName ?? null,
      exchange,
      createdAt,
      requestedAt,
      marketTimestamp: newestMarketTsIso,
      researchPeriod: {
        requestedPeriod: input.requestedPeriod ?? null,
        detectedPeriods: Array.from(detectedPeriods),
        incompatiblePeriodsRejected,
      },
      agentExecutions,
      evidenceReferences,
      sourceProvenance,
      freshnessSummary,
      conflicts: conflictResolution.conflicts,
      missingData,
      qualityAssessment,
      contextStatus: qualityClassification,
    };

    const crossAgentSynthesis = this.synthesizer.synthesize(
      baseContext,
      input.previousContexts ?? []
    );

    const contextWithSynthesis: UnifiedIntelligenceContext = {
      ...baseContext,
      crossAgentSynthesis,
    };

    const researchScorecard = this.researchIntelligence.buildScorecard(
      contextWithSynthesis,
      input.previousContexts ?? []
    );

    const contextWithScorecard: UnifiedIntelligenceContext = {
      ...contextWithSynthesis,
      researchScorecard,
    };

    const researchBrief = this.briefService.buildBrief(contextWithScorecard, {
      previousContexts: input.previousContexts ?? [],
      peerContexts: input.peerContexts ?? [],
    });

    return {
      ...contextWithScorecard,
      researchBrief,
    };
  }
}

export const unifiedIntelligenceContextBuilder =
  new UnifiedIntelligenceContextBuilder();

