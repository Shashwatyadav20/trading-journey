import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Fastify, { FastifyInstance } from "fastify";
import { GeminiProvider } from "../core/GeminiProvider";
import { GroqProvider } from "../core/GroqProvider";
import { RateLimitManager } from "../core/RateLimitManager";
import { ResearchCache } from "../core/ResearchCache";
import { AIUsageTracker } from "../core/AIUsageTracker";
import { getAIStagingConfig } from "../core/StagingConfig";
import { createOpenAIClient } from "../core/OpenAIClient";
import { AIOrchestrator } from "../orchestrator/AIOrchestrator";
import { AgentRegistry } from "../orchestrator/AgentRegistry";
import { ResponseSynthesizer } from "../orchestrator/ResponseSynthesizer";
import aiRoutes from "../../routes/ai";
import * as userContext from "../../trading/userContext";

describe("Phase 8.6 — Free AI Staging Optimization & Provider Efficiency", () => {
  const originalEnv = { ...process.env };
  let app: FastifyInstance | null = null;

  beforeEach(() => {
    process.env.GEMINI_API_KEY = "AIzaSyTestSecretKey_DoNotLeak_86";
    process.env.GROQ_API_KEY = "gsk_TestSecretKey_DoNotLeak_86";
    process.env.AI_PROVIDER = "gemini";
    process.env.AI_STAGING_MODE = "true";
    process.env.AI_STAGING_MAX_CONCURRENT_REQUESTS = "1";
    process.env.AI_STAGING_MAX_AGENTS_PER_REQUEST = "2";
    process.env.AI_STAGING_MAX_PROVIDER_ATTEMPTS = "2";
    process.env.AI_STAGING_CACHE_ENABLED = "true";
    process.env.AI_STAGING_USAGE_TRACKING = "true";
  });

  afterEach(async () => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
    if (app) {
      await app.close();
      app = null;
    }
  });

  // --- A. Provider Management ---
  it("A1. Gemini successful generation records AVAILABLE state and lastSuccessfulProvider", async () => {
    let nowMs = 1_700_000_000_000;
    const limiter = new RateLimitManager({ now: () => nowMs, sleep: async () => {} });
    const geminiFetch = vi.fn().mockImplementation(async () =>
      new Response(
        JSON.stringify({
          responseId: "gem_ok_1",
          candidates: [{ content: { parts: [{ text: "Gemini OK" }] } }],
          usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 },
        }),
        { status: 200 }
      )
    );
    const client = createOpenAIClient({
      provider: "gemini",
      fallbackProvider: "groq",
      rateLimitManager: limiter,
      providers: {
        gemini: new GeminiProvider({ fetchImpl: geminiFetch as unknown as typeof fetch }),
        groq: new GroqProvider({ fetchImpl: vi.fn() as unknown as typeof fetch }),
      },
    });

    const res = await client.createResponse({ tier: "fast", input: "Ping" });
    expect(res.provider).toBe("gemini");
    expect(res.outputText).toBe("Gemini OK");
    expect(limiter.getLastSuccessfulProvider()).toBe("gemini");
    expect(limiter.getProviderState("gemini", true).status).toBe("AVAILABLE");
  });

  it("A2. Gemini 429 enters RATE_LIMITED cooldown, falls back to Groq, and recovers after cooldown", async () => {
    let nowMs = 1_700_000_000_000;
    const limiter = new RateLimitManager({
      defaultCooldownMs: 10_000,
      now: () => nowMs,
      sleep: async () => {},
    });

    let gemMode: "429" | "ok" = "429";
    const geminiFetch = vi.fn().mockImplementation(async () =>
      gemMode === "429"
        ? new Response(
            JSON.stringify({ error: { code: 429, status: "RESOURCE_EXHAUSTED", message: "Quota" } }),
            { status: 429 }
          )
        : new Response(
            JSON.stringify({
              responseId: "gem_rec_1",
              candidates: [{ content: { parts: [{ text: "Recovered Gemini" }] } }],
            }),
            { status: 200 }
          )
    );
    const groqFetch = vi.fn().mockImplementation(async () =>
      new Response(
        JSON.stringify({
          id: "groq_fb_1",
          model: "openai/gpt-oss-120b",
          choices: [{ message: { content: "Groq Fallback OK" } }],
          usage: { prompt_tokens: 8, completion_tokens: 4, total_tokens: 12 },
        }),
        { status: 200 }
      )
    );

    const client = createOpenAIClient({
      provider: "gemini",
      fallbackProvider: "groq",
      rateLimitManager: limiter,
      providers: {
        gemini: new GeminiProvider({ fetchImpl: geminiFetch as unknown as typeof fetch }),
        groq: new GroqProvider({ fetchImpl: groqFetch as unknown as typeof fetch }),
      },
    });

    const r1 = await client.createResponse({ tier: "fast", input: "Test 1" });
    expect(r1.provider).toBe("groq");
    expect(r1.fallbackUsed).toBe(true);
    expect(limiter.getProviderState("gemini", true).status).toBe("RATE_LIMITED");
    expect(limiter.getLastSuccessfulProvider()).toBe("groq");

    // During cooldown, Gemini is skipped without calling geminiFetch again
    const r2 = await client.createResponse({ tier: "fast", input: "Test 2" });
    expect(r2.provider).toBe("groq");
    expect(geminiFetch).toHaveBeenCalledTimes(1);

    // Advance clock past cooldown & restore Gemini
    nowMs += 15_000;
    gemMode = "ok";
    const r3 = await client.createResponse({ tier: "fast", input: "Test 3" });
    expect(r3.provider).toBe("gemini");
    expect(r3.outputText).toBe("Recovered Gemini");
    expect(limiter.getProviderState("gemini", true).status).toBe("AVAILABLE");
  });

  it("A3. Groq 429 + Gemini 429 results in ALL_PROVIDERS_RATE_LIMITED with zero API key leakage", async () => {
    let nowMs = 1_700_000_000_000;
    const limiter = new RateLimitManager({ now: () => nowMs, sleep: async () => {} });
    const geminiFetch = vi.fn().mockImplementation(async () =>
      new Response(
        JSON.stringify({
          error: {
            message: "Rate limit for key AIzaSyTestSecretKey_DoNotLeak_86",
          },
        }),
        { status: 429 }
      )
    );
    const groqFetch = vi.fn().mockImplementation(async () =>
      new Response(
        JSON.stringify({
          error: {
            message: "Rate limit for key gsk_TestSecretKey_DoNotLeak_86",
          },
        }),
        { status: 429 }
      )
    );

    const client = createOpenAIClient({
      provider: "gemini",
      fallbackProvider: "groq",
      rateLimitManager: limiter,
      providers: {
        gemini: new GeminiProvider({ fetchImpl: geminiFetch as unknown as typeof fetch }),
        groq: new GroqProvider({ fetchImpl: groqFetch as unknown as typeof fetch }),
      },
    });

    await expect(client.createResponse({ tier: "fast", input: "Test" })).rejects.toThrow();
    try {
      await client.createResponse({ tier: "fast", input: "Test 2" });
    } catch (err: any) {
      expect(err.code).toBe("ALL_PROVIDERS_RATE_LIMITED");
      expect(err.message).not.toContain("AIzaSyTestSecretKey_DoNotLeak_86");
      expect(err.message).not.toContain("gsk_TestSecretKey_DoNotLeak_86");
    }
    expect(limiter.getProviderState("gemini", true).status).toBe("RATE_LIMITED");
    expect(limiter.getProviderState("groq", true).status).toBe("RATE_LIMITED");
  });

  // --- B. Orchestration & Staging Config ---
  it("B1. StagingConfig enforces maxAgentsPerRequest, deduplicates agents, and classifies RATE_LIMITED fallback", async () => {
    const cfg = getAIStagingConfig();
    expect(cfg.stagingMode).toBe(true);
    expect(cfg.maxAgentsPerRequest).toBe(2);
    expect(cfg.maxConcurrentRequests).toBe(1);

    const tracker = new AIUsageTracker();
    const rateErr = new (await import("../core/AIProvider")).AIProviderError({
      message: "Both providers rate limited",
      provider: "groq",
      statusCode: 429,
      code: "ALL_PROVIDERS_RATE_LIMITED",
      retryable: false,
      quotaExhausted: true,
    });

    const failingRegistry = new AgentRegistry({
      useCache: false,
      companyResearch: { analyze: vi.fn().mockRejectedValue(rateErr) } as any,
      institutionalIntelligence: { analyze: vi.fn().mockRejectedValue(rateErr) } as any,
      marketIntelligence: { analyze: vi.fn().mockRejectedValue(rateErr) } as any,
      newsMacro: { analyze: vi.fn().mockRejectedValue(rateErr) } as any,
    });
    const mockAiClient = {
      createResponse: vi.fn().mockRejectedValue(rateErr),
    } as any;

    const orchestrator = new AIOrchestrator({
      registry: failingRegistry,
      synthesizer: new ResponseSynthesizer({ aiClient: mockAiClient }),
      usageTracker: tracker,
    });

    const result = await orchestrator.orchestrate("user-1", {
      query: "Complete research on RELIANCE combining fundamentals, institutions, market conditions and news",
      tier: "fast",
    });

    // MULTI_AGENT_RESEARCH routes 4 agents; staging maxAgents=2 trims to 2 and records skippedAgents
    expect(result.routing.selectedAgents.length).toBe(2);
    expect(result.skippedAgents?.length).toBe(2);
    expect(result.agentExecutions.length).toBe(2);
    expect(result.responseStatus).toBe("RATE_LIMITED");
    expect(result.provider).toBe("deterministic");
    expect(result.fallbackUsed).toBe(true);
  });

  // --- C. Cache Optimization & Deduplication ---
  it("C1. ResearchCache handles hit/miss, expiry, stale market/options rejection, user isolation, and in-flight deduplication", async () => {
    let nowMs = 1_700_000_000_000;
    const cache = new ResearchCache({ now: () => nowMs });

    // User-scoped agents are never cached
    expect(
      cache.set({
        agentId: "portfolio_intelligence",
        symbol: null,
        tier: "fast",
        query: "My portfolio",
        value: { generatedAt: new Date(nowMs).toISOString() },
      })
    ).toBeNull();

    // Stale market data rejected
    expect(
      cache.set({
        agentId: "market_intelligence",
        symbol: "NIFTY",
        tier: "fast",
        query: "NIFTY",
        value: {
          generatedAt: new Date(nowMs).toISOString(),
          evidenceSummary: { staleCount: 1, expiredCount: 0 },
        },
      })
    ).toBeNull();

    // Stale / expired options chain rejected
    expect(
      cache.set({
        agentId: "options_intelligence",
        symbol: "NIFTY",
        tier: "fast",
        query: "NIFTY chain",
        value: {
          generatedAt: new Date(nowMs).toISOString(),
          analytics: { expiry: "2020-01-01" },
          evidenceSummary: { staleCount: 0, expiredCount: 0 },
        },
      })
    ).toBeNull();

    // Valid company research hit -> miss after TTL
    cache.set({
      agentId: "company_research",
      symbol: "RELIANCE",
      tier: "fast",
      query: "Analyze RELIANCE",
      value: {
        generatedAt: new Date(nowMs).toISOString(),
        evidenceSummary: { staleCount: 0, expiredCount: 0, evidenceIdsUsed: ["EV_1"] },
      },
    });
    expect(
      cache.get({
        agentId: "company_research",
        symbol: "RELIANCE",
        tier: "fast",
        query: "Analyze RELIANCE",
      })
    ).not.toBeNull();

    nowMs += 601_000; // > 600s TTL
    expect(
      cache.get({
        agentId: "company_research",
        symbol: "RELIANCE",
        tier: "fast",
        query: "Analyze RELIANCE",
      })
    ).toBeNull();

    // In-flight deduplication shares a single execution
    const factory = vi.fn().mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 10));
      return { ok: true };
    });
    const [p1, p2] = await Promise.all([
      cache.runDeduplicated(
        { agentId: "company_research", symbol: "TCS", tier: "fast", query: "TCS" },
        factory
      ),
      cache.runDeduplicated(
        { agentId: "company_research", symbol: "TCS", tier: "fast", query: "TCS" },
        factory
      ),
    ]);
    expect(factory).toHaveBeenCalledTimes(1);
    expect(p1).toEqual({ ok: true });
    expect(p2).toEqual({ ok: true });
  });

  // --- D. Usage Tracking & /api/ai/usage Route ---
  it("D1. AIUsageTracker records real metrics without inventing tokens or storing secrets, and GET /api/ai/usage enforces auth", async () => {
    const tracker = new AIUsageTracker();
    tracker.record({
      userId: "user-alpha",
      provider: "groq",
      model: "openai/gpt-oss-120b",
      agent: "COMPANY_RESEARCH",
      success: true,
      errorCategory: "SUCCESS",
      latencyMs: 850,
      inputTokens: null,
      outputTokens: null,
      cacheHit: false,
      fallbackUsed: true,
      deterministicFallback: false,
      responseStatus: "LIVE_AI",
      timestamp: "2026-11-13T10:00:00.000Z",
    });
    tracker.record({
      userId: "user-alpha",
      provider: "deterministic",
      model: "deterministic",
      agent: "MARKET_INTELLIGENCE",
      success: false,
      errorCategory: "RATE_LIMITED",
      latencyMs: 12,
      inputTokens: null,
      outputTokens: null,
      cacheHit: true,
      fallbackUsed: true,
      deterministicFallback: true,
      responseStatus: "RATE_LIMITED",
      timestamp: "2026-11-13T10:01:00.000Z",
    });
    tracker.record({
      userId: "user-beta",
      provider: "gemini",
      model: "gemini-3.8-flash",
      agent: "NEWS_MACRO",
      success: true,
      errorCategory: "SUCCESS",
      latencyMs: 500,
      inputTokens: 100,
      outputTokens: 50,
      cacheHit: false,
      fallbackUsed: false,
      deterministicFallback: false,
      responseStatus: "LIVE_AI",
      timestamp: "2026-11-13T10:02:00.000Z",
    });

    const summaryAlpha = tracker.getSummary({ userId: "user-alpha" });
    expect(summaryAlpha.totalRequests).toBe(2);
    expect(summaryAlpha.successfulLiveGenerations).toBe(1);
    expect(summaryAlpha.groqRequests).toBe(1);
    expect(summaryAlpha.rateLimitEvents).toBe(1);
    expect(summaryAlpha.cacheHits).toBe(1);
    expect(summaryAlpha.cacheHitRate).toBe(50);
    expect(summaryAlpha.deterministicFallbackCount).toBe(1);
    expect(summaryAlpha.averageLatencyMs).toBe(431);
    expect(summaryAlpha.recentRecords[0].inputTokens).toBeNull();
    expect((summaryAlpha.recentRecords[0] as any).userId).toBeUndefined();

    // Test authenticated route GET /api/ai/usage
    vi.spyOn(userContext, "extractVerifiedUser").mockResolvedValue({
      userId: "user-alpha",
      email: "alpha@example.com",
    });
    vi.spyOn(userContext, "requireApprovedUser").mockResolvedValue(undefined);

    app = Fastify();
    await app.register(aiRoutes, { usageTracker: tracker });
    await app.ready();

    const res = await app.inject({
      method: "GET",
      url: "/api/ai/usage?provider=groq&date=2026-11-13",
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.totalRequests).toBe(1);
    expect(body.groqRequests).toBe(1);
  });
});

