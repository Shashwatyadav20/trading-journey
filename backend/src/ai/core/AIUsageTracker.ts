import crypto from "node:crypto";
import { getAIStagingConfig } from "./StagingConfig";

export interface AIUsageRecord {
  id: string;
  userId: string;
  timestamp: string;
  date: string; // YYYY-MM-DD (UTC)
  provider: string;
  model: string;
  agent: string;
  success: boolean;
  errorCategory: string;
  latencyMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheHit: boolean;
  fallbackUsed: boolean;
  deterministicFallback: boolean;
  responseStatus: string;
}

export interface AIUsageRecordInput {
  userId: string;
  provider: string;
  model: string;
  agent: string;
  success: boolean;
  errorCategory: string;
  latencyMs: number;
  inputTokens?: number | null;
  outputTokens?: number | null;
  cacheHit?: boolean;
  fallbackUsed?: boolean;
  deterministicFallback?: boolean;
  responseStatus: string;
  timestamp?: string;
}

export interface AIUsageSummary {
  totalRequests: number;
  successfulLiveGenerations: number;
  geminiRequests: number;
  groqRequests: number;
  openaiRequests: number;
  providerErrors: number;
  rateLimitEvents: number;
  cacheHits: number;
  cacheHitRate: number;
  deterministicFallbackCount: number;
  averageLatencyMs: number;
  recentRecords: Array<Omit<AIUsageRecord, "userId">>;
}

const MAX_RECORDS = 500;

export class AIUsageTracker {
  private readonly records: AIUsageRecord[] = [];
  private readonly maxRecords: number;

  public constructor(maxRecords = MAX_RECORDS) {
    this.maxRecords = maxRecords;
  }

  public record(input: AIUsageRecordInput): AIUsageRecord | null {
    if (!getAIStagingConfig().usageTrackingEnabled) {
      return null;
    }

    const ts = input.timestamp ?? new Date().toISOString();
    const rec: AIUsageRecord = {
      id: crypto.randomUUID(),
      userId: input.userId,
      timestamp: ts,
      date: ts.slice(0, 10),
      provider: input.provider,
      model: input.model,
      agent: input.agent,
      success: input.success,
      errorCategory: input.errorCategory,
      latencyMs: Math.max(0, Math.round(input.latencyMs)),
      inputTokens:
        typeof input.inputTokens === "number" && Number.isFinite(input.inputTokens)
          ? input.inputTokens
          : null,
      outputTokens:
        typeof input.outputTokens === "number" && Number.isFinite(input.outputTokens)
          ? input.outputTokens
          : null,
      cacheHit: Boolean(input.cacheHit),
      fallbackUsed: Boolean(input.fallbackUsed),
      deterministicFallback: Boolean(input.deterministicFallback),
      responseStatus: input.responseStatus,
    };

    this.records.push(rec);
    if (this.records.length > this.maxRecords) {
      this.records.splice(0, this.records.length - this.maxRecords);
    }
    return rec;
  }

  public getSummary(filter?: {
    userId?: string;
    provider?: string;
    date?: string;
    limit?: number;
  }): AIUsageSummary {
    const providerFilter = filter?.provider?.trim().toLowerCase();
    const dateFilter = filter?.date?.trim();

    const filtered = this.records.filter((r) => {
      if (filter?.userId && r.userId !== filter.userId) return false;
      if (providerFilter && r.provider.toLowerCase() !== providerFilter) return false;
      if (dateFilter && r.date !== dateFilter) return false;
      return true;
    });

    const totalRequests = filtered.length;
    let successfulLiveGenerations = 0;
    let geminiRequests = 0;
    let groqRequests = 0;
    let openaiRequests = 0;
    let providerErrors = 0;
    let rateLimitEvents = 0;
    let cacheHits = 0;
    let deterministicFallbackCount = 0;
    let totalLatency = 0;

    for (const r of filtered) {
      totalLatency += r.latencyMs;
      if (r.success && !r.deterministicFallback && r.provider !== "deterministic") {
        successfulLiveGenerations += 1;
      }
      const p = r.provider.toLowerCase();
      if (p === "gemini") geminiRequests += 1;
      else if (p === "groq") groqRequests += 1;
      else if (p === "openai") openaiRequests += 1;

      if (r.errorCategory === "RATE_LIMITED") {
        rateLimitEvents += 1;
      } else if (
        r.errorCategory === "PROVIDER_ERROR" ||
        r.errorCategory === "TIMEOUT"
      ) {
        providerErrors += 1;
      }

      if (r.cacheHit) cacheHits += 1;
      if (r.deterministicFallback) deterministicFallbackCount += 1;
    }

    const limit = Math.min(50, Math.max(1, filter?.limit ?? 20));
    const recentRecords = filtered
      .slice(-limit)
      .reverse()
      .map(({ userId: _uid, ...rest }) => rest);

    return {
      totalRequests,
      successfulLiveGenerations,
      geminiRequests,
      groqRequests,
      openaiRequests,
      providerErrors,
      rateLimitEvents,
      cacheHits,
      cacheHitRate:
        totalRequests > 0
          ? Number(((cacheHits / totalRequests) * 100).toFixed(1))
          : 0,
      deterministicFallbackCount,
      averageLatencyMs:
        totalRequests > 0 ? Math.round(totalLatency / totalRequests) : 0,
      recentRecords,
    };
  }

  public clear(): void {
    this.records.length = 0;
  }
}

export const aiUsageTracker = new AIUsageTracker();

