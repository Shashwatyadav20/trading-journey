import crypto from "node:crypto";
import type { AITaskTier } from "./ModelRouter";

export type CacheableAgentId =
  | "company_research"
  | "market_intelligence"
  | "institutional_intelligence"
  | "news_macro"
  | "options_intelligence";

const PUBLIC_AGENT_TTL_MS: Record<CacheableAgentId, number> = {
  options_intelligence: 60_000, // 1 minute — never cache stale/expired option chains
  market_intelligence: 120_000, // 2 minutes
  institutional_intelligence: 300_000, // 5 minutes
  news_macro: 300_000, // 5 minutes
  company_research: 600_000, // 10 minutes
};

export interface CachedAgentEntry<T = unknown> {
  key: string;
  agentId: CacheableAgentId;
  value: T;
  cachedAtMs: number;
  cachedAtIso: string;
  expiresAtMs: number;
  sourceTimestamp: string | null;
  freshnessLabel: "FRESH" | "DELAYED";
}

export interface ResearchCacheOptions {
  now?: () => number;
  ttlOverridesMs?: Partial<Record<CacheableAgentId, number>>;
  maxEntries?: number;
}

export function isPublicCacheableAgent(agentId: string): agentId is CacheableAgentId {
  return Object.prototype.hasOwnProperty.call(PUBLIC_AGENT_TTL_MS, agentId);
}

export function isUserScopedAgent(agentId: string): boolean {
  return agentId === "portfolio_intelligence" || agentId === "risk_intelligence";
}

function getTodayIsoIST(nowMs: number): string {
  const ist = new Date(nowMs + 5.5 * 60 * 60 * 1000);
  return ist.toISOString().slice(0, 10);
}

/**
 * Validates that a specialist agent payload is still fresh and does not contain
 * expired option chains or stale market data before storing or returning from cache.
 */
export function isPayloadFreshForCache(
  agentId: CacheableAgentId,
  payload: any,
  nowMs: number
): { fresh: boolean; freshnessLabel: "FRESH" | "DELAYED"; reason?: string } {
  if (!payload || typeof payload !== "object") {
    return { fresh: false, freshnessLabel: "DELAYED", reason: "Empty payload" };
  }

  const evSummary = payload.evidenceSummary;
  if (evSummary && typeof evSummary === "object") {
    if (Number(evSummary.expiredCount ?? 0) > 0) {
      return { fresh: false, freshnessLabel: "DELAYED", reason: "Contains expired evidence" };
    }
    if (
      (agentId === "options_intelligence" || agentId === "market_intelligence") &&
      Number(evSummary.staleCount ?? 0) > 0
    ) {
      return { fresh: false, freshnessLabel: "DELAYED", reason: "Contains stale market/options evidence" };
    }
  }

  if (agentId === "options_intelligence") {
    const expiry = payload?.analytics?.expiry ?? payload?.report?.expiry ?? null;
    if (typeof expiry === "string" && /^\d{4}-\d{2}-\d{2}$/.test(expiry)) {
      const todayIst = getTodayIsoIST(nowMs);
      if (expiry < todayIst) {
        return { fresh: false, freshnessLabel: "DELAYED", reason: `Expired option chain (${expiry} < ${todayIst})` };
      }
    }
  }

  return {
    fresh: true,
    freshnessLabel:
      evSummary && Number(evSummary.staleCount ?? 0) > 0 ? "DELAYED" : "FRESH",
  };
}

export class ResearchCache {
  private readonly store = new Map<string, CachedAgentEntry>();
  private readonly inFlight = new Map<string, Promise<unknown>>();
  private readonly now: () => number;
  private readonly ttls: Record<CacheableAgentId, number>;
  private readonly maxEntries: number;

  public constructor(options: ResearchCacheOptions = {}) {
    this.now = options.now ?? (() => Date.now());
    this.ttls = {
      ...PUBLIC_AGENT_TTL_MS,
      ...(options.ttlOverridesMs ?? {}),
    };
    this.maxEntries = Math.max(10, options.maxEntries ?? 200);
  }

  public buildKey(params: {
    agentId: string;
    symbol: string | null;
    tier: AITaskTier;
    query: string;
  }): string | null {
    // Strictly never cache user-specific portfolio or risk data
    if (!isPublicCacheableAgent(params.agentId) || isUserScopedAgent(params.agentId)) {
      return null;
    }
    const normalizedSymbol = (params.symbol ?? "NONE").trim().toUpperCase();
    const normalizedQuery = params.query.trim().toLowerCase().replace(/\s+/g, " ");
    const queryHash = crypto
      .createHash("sha256")
      .update(normalizedQuery)
      .digest("hex")
      .slice(0, 16);
    return `${params.agentId}:${normalizedSymbol}:${params.tier}:${queryHash}`;
  }

  public get<T = unknown>(params: {
    agentId: string;
    symbol: string | null;
    tier: AITaskTier;
    query: string;
  }): CachedAgentEntry<T> | null {
    const key = this.buildKey(params);
    if (!key) return null;

    const entry = this.store.get(key);
    if (!entry) return null;

    const nowMs = this.now();
    if (nowMs >= entry.expiresAtMs) {
      this.store.delete(key);
      return null;
    }

    const check = isPayloadFreshForCache(entry.agentId, entry.value, nowMs);
    if (!check.fresh) {
      this.store.delete(key);
      return null;
    }

    return entry as CachedAgentEntry<T>;
  }

  public set<T = unknown>(params: {
    agentId: string;
    symbol: string | null;
    tier: AITaskTier;
    query: string;
    value: T;
    sourceTimestamp?: string | null;
  }): CachedAgentEntry<T> | null {
    const key = this.buildKey(params);
    if (!key || !isPublicCacheableAgent(params.agentId)) {
      return null;
    }

    const nowMs = this.now();
    const check = isPayloadFreshForCache(params.agentId, params.value, nowMs);
    if (!check.fresh) {
      return null;
    }

    const ttlMs = this.ttls[params.agentId];
    if (!this.store.has(key) && this.store.size >= this.maxEntries) {
      // Evict expired entries first, then oldest entry to bound cache memory
      for (const [k, existing] of this.store.entries()) {
        if (nowMs >= existing.expiresAtMs) {
          this.store.delete(k);
        }
      }
      if (this.store.size >= this.maxEntries) {
        const oldestKey = this.store.keys().next().value;
        if (oldestKey !== undefined) {
          this.store.delete(oldestKey);
        }
      }
    }
    const entry: CachedAgentEntry<T> = {
      key,
      agentId: params.agentId,
      value: params.value,
      cachedAtMs: nowMs,
      cachedAtIso: new Date(nowMs).toISOString(),
      expiresAtMs: nowMs + ttlMs,
      sourceTimestamp: params.sourceTimestamp ?? null,
      freshnessLabel: check.freshnessLabel,
    };
    this.store.set(key, entry);
    return entry;
  }

  /**
   * Deduplicates simultaneous in-flight requests for the same public cache key.
   * Never deduplicates user-scoped agents (buildKey returns null).
   */
  public async runDeduplicated<T>(
    params: {
      agentId: string;
      symbol: string | null;
      tier: AITaskTier;
      query: string;
    },
    factory: () => Promise<T>
  ): Promise<T> {
    const key = this.buildKey(params);
    if (!key) {
      return factory();
    }
    const existing = this.inFlight.get(key) as Promise<T> | undefined;
    if (existing) {
      return existing;
    }
    const promise = factory().finally(() => {
      if (this.inFlight.get(key) === promise) {
        this.inFlight.delete(key);
      }
    });
    this.inFlight.set(key, promise);
    return promise;
  }

  public invalidate(params: {
    agentId: string;
    symbol: string | null;
    tier: AITaskTier;
    query: string;
  }): boolean {
    const key = this.buildKey(params);
    if (!key) return false;
    return this.store.delete(key);
  }

  public invalidateSymbol(symbol: string): number {
    const norm = symbol.trim().toUpperCase();
    let removed = 0;
    for (const key of this.store.keys()) {
      if (key.includes(`:${norm}:`)) {
        this.store.delete(key);
        removed += 1;
      }
    }
    return removed;
  }

  public clear(): void {
    this.store.clear();
    this.inFlight.clear();
  }

  public size(): number {
    return this.store.size;
  }

  public getStats(): { entries: number; inFlightCount: number; maxEntries: number } {
    return {
      entries: this.store.size,
      inFlightCount: this.inFlight.size,
      maxEntries: this.maxEntries,
    };
  }
}

export const researchCache = new ResearchCache();

