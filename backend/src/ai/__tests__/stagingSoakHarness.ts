import { AIOrchestrator, OrchestratorResponseStatus } from "../orchestrator/AIOrchestrator";
import { AIUsageTracker } from "../core/AIUsageTracker";
import { ResearchCache } from "../core/ResearchCache";

export interface SoakScenarioStep {
  userId: string;
  query: string;
  symbol?: string;
  tier?: "deep" | "balanced" | "fast";
}

export interface SoakHarnessOptions {
  orchestrator: AIOrchestrator;
  cache?: ResearchCache;
  usageTracker?: AIUsageTracker;
  steps: SoakScenarioStep[];
  concurrency?: number;
  maxDurationMs?: number;
}

export interface SoakHarnessResult {
  totalExecuted: number;
  elapsedMs: number;
  statusCounts: Record<OrchestratorResponseStatus, number>;
  cacheHits: number;
  cacheMisses: number;
  latenciesMs: number[];
  p95LatencyMs: number;
  heapDeltaBytes: number;
  unhandledRejections: number;
  cacheStats: { entries: number; inFlightCount: number; maxEntries: number } | null;
}

export async function runStagingSoakHarness(
  options: SoakHarnessOptions
): Promise<SoakHarnessResult> {
  const startedAt = Date.now();
  const concurrency = Math.max(1, options.concurrency ?? 1);
  const maxDurationMs = options.maxDurationMs ?? 30_000;
  const heapBefore = process.memoryUsage().heapUsed;

  let unhandledRejections = 0;
  const onUnhandled = () => {
    unhandledRejections += 1;
  };
  process.on("unhandledRejection", onUnhandled);

  const statusCounts: Record<OrchestratorResponseStatus, number> = {
    LIVE_AI: 0,
    CACHED_EVIDENCE: 0,
    PARTIAL: 0,
    RATE_LIMITED: 0,
    DETERMINISTIC_FALLBACK: 0,
    NO_DATA: 0,
  };
  const latenciesMs: number[] = [];
  let cacheHits = 0;
  let cacheMisses = 0;
  let cursor = 0;

  try {
    const worker = async () => {
      while (cursor < options.steps.length) {
        if (Date.now() - startedAt > maxDurationMs) break;
        const idx = cursor;
        cursor += 1;
        const step = options.steps[idx];
        const res = await options.orchestrator.orchestrate(step.userId, {
          query: step.query,
          symbol: step.symbol,
          tier: step.tier ?? "fast",
        });
        statusCounts[res.responseStatus] = (statusCounts[res.responseStatus] ?? 0) + 1;
        latenciesMs.push(res.totalLatencyMs);
        cacheHits += res.cacheSummary.hits;
        cacheMisses += res.cacheSummary.misses;
      }
    };

    const workers = Array.from(
      { length: Math.min(concurrency, Math.max(1, options.steps.length)) },
      () => worker()
    );
    await Promise.all(workers);
  } finally {
    process.off("unhandledRejection", onUnhandled);
  }

  const sorted = [...latenciesMs].sort((a, b) => a - b);
  const p95Idx = sorted.length > 0 ? Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95)) : 0;

  return {
    totalExecuted: latenciesMs.length,
    elapsedMs: Date.now() - startedAt,
    statusCounts,
    cacheHits,
    cacheMisses,
    latenciesMs,
    p95LatencyMs: sorted[p95Idx] ?? 0,
    heapDeltaBytes: process.memoryUsage().heapUsed - heapBefore,
    unhandledRejections,
    cacheStats: options.cache ? options.cache.getStats() : null,
  };
}

