import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { RateLimitManager, parseRetryAfterMs } from "../core/RateLimitManager";
import { ResearchCache } from "../core/ResearchCache";
import { GeminiProvider } from "../core/GeminiProvider";
import { GroqProvider } from "../core/GroqProvider";
import { AIProviderError } from "../core/AIProvider";
import { createOpenAIClient } from "../core/OpenAIClient";
import { IntentRouter, extractNseSymbolFromQuery } from "../orchestrator/IntentRouter";
import { AgentRegistry } from "../orchestrator/AgentRegistry";
import { ResponseSynthesizer } from "../orchestrator/ResponseSynthesizer";
import { PortfolioIntelligenceAgent } from "../agents/PortfolioIntelligenceAgent";
import { EvidenceIntelligenceService } from "../services/EvidenceIntelligenceService";

describe("Phase 8.4 — AI Reliability, Rate-Limit Optimization & Routing Fixes", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env = {
      ...originalEnv,
      AI_PROVIDER: "gemini",
      GEMINI_API_KEY: "AIzaSyTestFakeGeminiKey1234567890abcdef",
      GEMINI_MODEL: "gemini-3.8-flash",
      GROQ_API_KEY: "gsk_test_fake_groq_key_1234567890abcdef",
      GROQ_MODEL: "openai/gpt-oss-120b",
      AI_REQUEST_TIMEOUT_MS: "10000",
    };
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it("1. 429 cooldown skips exhausted primary provider immediately on subsequent calls", async () => {
    let currentTime = 1_000_000;
    const limiter = new RateLimitManager({
      defaultCooldownMs: 15_000,
      now: () => currentTime,
      sleep: async () => {},
    });

    const geminiFetch = vi.fn().mockImplementation(async () =>
      new Response(
        JSON.stringify({ error: { code: 429, status: "RESOURCE_EXHAUSTED", message: "Quota" } }),
        { status: 429 }
      )
    );
    const groqFetch = vi.fn().mockImplementation(async () =>
      new Response(
        JSON.stringify({
          id: "groq_1",
          model: "openai/gpt-oss-120b",
          choices: [{ message: { content: "Groq OK" } }],
          usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
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

    // Call 1: Gemini returns 429 -> enters cooldown -> falls back to Groq
    const res1 = await client.createResponse({ tier: "fast", input: "Ping 1" });
    expect(res1.provider).toBe("groq");
    expect(res1.fallbackUsed).toBe(true);
    expect(geminiFetch).toHaveBeenCalledTimes(1);
    expect(limiter.isInCooldown("gemini")).toBe(true);

    // Call 2 (during cooldown): Gemini is NOT called at all; routes directly to Groq
    const res2 = await client.createResponse({ tier: "fast", input: "Ping 2" });
    expect(res2.provider).toBe("groq");
    expect(res2.fallbackUsed).toBe(true);
    expect(geminiFetch).toHaveBeenCalledTimes(1);
    expect(groqFetch).toHaveBeenCalledTimes(2);
  });

  it("2. Retry-After header sets exact cooldown duration", async () => {
    let currentTime = 2_000_000;
    const limiter = new RateLimitManager({
      defaultCooldownMs: 5_000,
      now: () => currentTime,
      sleep: async () => {},
    });

    expect(parseRetryAfterMs("42")).toBe(42_000);

    const geminiFetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ error: { code: 429, status: "RESOURCE_EXHAUSTED", message: "Slow down" } }),
        { status: 429, headers: { "retry-after": "30" } }
      )
    );
    const groqFetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ error: { message: "Groq also 429" } }),
        { status: 429, headers: { "retry-after": "10" } }
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

    await expect(client.createResponse({ tier: "fast", input: "Ping" })).rejects.toMatchObject({
      statusCode: 429,
    });
    expect(limiter.getCooldownRemainingMs("gemini")).toBe(30_000);
    expect(limiter.getCooldownRemainingMs("groq")).toBe(10_000);

    // When both are in cooldown, next call fails immediately with ALL_PROVIDERS_RATE_LIMITED
    await expect(client.createResponse({ tier: "fast", input: "Ping 2" })).rejects.toMatchObject({
      statusCode: 429,
      code: "ALL_PROVIDERS_RATE_LIMITED",
    });
    expect(geminiFetch).toHaveBeenCalledTimes(1);
    expect(groqFetch).toHaveBeenCalledTimes(1);
  });

  it("3. Bounded transient retries on 5xx, zero retries on 401/404", async () => {
    const limiter = new RateLimitManager({
      transientMaxRetries: 1,
      backoffBaseMs: 10,
      sleep: async () => {},
    });

    let calls503 = 0;
    const recovered = await limiter.executeWithQueueAndRetry("gemini", async () => {
      calls503 += 1;
      if (calls503 === 1) {
        throw new AIProviderError({
          message: "Temporary 503",
          provider: "gemini",
          statusCode: 502,
          code: "GEMINI_SERVER_ERROR",
          retryable: true,
          tier: "fast",
          model: "gemini-3.8-flash",
        });
      }
      return "ok";
    });
    expect(recovered).toBe("ok");
    expect(calls503).toBe(2);

    let calls401 = 0;
    await expect(
      limiter.executeWithQueueAndRetry("gemini", async () => {
        calls401 += 1;
        throw new AIProviderError({
          message: "Bad key",
          provider: "gemini",
          statusCode: 502,
          code: "GEMINI_AUTH_ERROR",
          retryable: false,
          tier: "fast",
          model: "gemini-3.8-flash",
        });
      })
    ).rejects.toMatchObject({ code: "GEMINI_AUTH_ERROR" });
    expect(calls401).toBe(1);
  });

  it("4. Provider queue enforces bounded concurrency", async () => {
    const limiter = new RateLimitManager({ concurrency: { groq: 2 } });
    let active = 0;
    let peak = 0;

    await Promise.all(
      Array.from({ length: 6 }, () =>
        limiter.executeWithQueueAndRetry("groq", async () => {
          active += 1;
          peak = Math.max(peak, active);
          await new Promise((r) => setTimeout(r, 15));
          active -= 1;
          return true;
        })
      )
    );

    expect(peak).toBeLessThanOrEqual(2);
    expect(limiter.getProviderState("groq").activeRequests).toBe(0);
    expect(limiter.getProviderState("groq").queuedRequests).toBe(0);
  });

  it("5 & 6. Cache isolates public vs user-scoped agents and rejects stale/expired payloads", () => {
    let nowMs = new Date("2026-11-13T10:00:00.000Z").getTime();
    const cache = new ResearchCache({
      now: () => nowMs,
      ttlOverridesMs: { company_research: 60_000, options_intelligence: 30_000 },
    });

    // User-specific portfolio & risk agents must NEVER be cached
    expect(
      cache.set({
        agentId: "portfolio_intelligence",
        symbol: null,
        tier: "fast",
        query: "my portfolio",
        value: { ok: true },
      })
    ).toBeNull();
    expect(
      cache.set({
        agentId: "risk_intelligence",
        symbol: null,
        tier: "fast",
        query: "my risk",
        value: { ok: true },
      })
    ).toBeNull();
    expect(cache.size()).toBe(0);

    // Expired option chain must NEVER be cached
    expect(
      cache.set({
        agentId: "options_intelligence",
        symbol: "NIFTY",
        tier: "fast",
        query: "Analyze NIFTY option chain",
        value: {
          analytics: { expiry: "2026-11-06" },
          evidenceSummary: { expiredCount: 0, staleCount: 0 },
        },
      })
    ).toBeNull();

    // Fresh public company research caches with timestamp & freshnessLabel
    const stored = cache.set({
      agentId: "company_research",
      symbol: "RELIANCE",
      tier: "fast",
      query: "Analyze RELIANCE fundamentals",
      value: {
        generatedAt: "2026-11-13T10:00:00.000Z",
        evidenceSummary: { expiredCount: 0, staleCount: 0 },
      },
      sourceTimestamp: "2026-11-13T10:00:00.000Z",
    });
    expect(stored?.freshnessLabel).toBe("FRESH");
    expect(
      cache.get({
        agentId: "company_research",
        symbol: "RELIANCE",
        tier: "fast",
        query: "Analyze RELIANCE fundamentals",
      })
    ).not.toBeNull();

    // Advance past TTL -> stale cache rejected
    nowMs += 61_000;
    expect(
      cache.get({
        agentId: "company_research",
        symbol: "RELIANCE",
        tier: "fast",
        query: "Analyze RELIANCE fundamentals",
      })
    ).toBeNull();
  });

  it("7 & 8. Deterministic intent routing & non-ambiguous symbol extraction", () => {
    const router = new IntentRouter();

    expect(router.route("Indian macroeconomic developments").intent).toBe("NEWS_MACRO");
    expect(router.route("RBI policy and inflation impact").intent).toBe("NEWS_MACRO");
    expect(router.route("Analyze RELIANCE fundamentals").intent).toBe("COMPANY_RESEARCH");
    expect(router.route("FII DII buying and selling").intent).toBe("INSTITUTIONAL_INTELLIGENCE");

    const multi = router.route(
      "Complete research on RELIANCE combining fundamentals, institutions, market conditions and news"
    );
    expect(multi.intent).toBe("MULTI_AGENT_RESEARCH");
    expect(multi.selectedAgents).toEqual([
      "company_research",
      "institutional_intelligence",
      "market_intelligence",
      "news_macro",
    ]);

    const portRisk = router.route("Analyze my portfolio risk");
    expect(portRisk.selectedAgents).toEqual(
      expect.arrayContaining(["portfolio_intelligence", "risk_intelligence"])
    );

    expect(router.route("Analyze NIFTY option chain").intent).toBe("OPTIONS_INTELLIGENCE");
    expect(router.route("Analyze market regime").intent).toBe("MARKET_INTELLIGENCE");

    // Ordinary English words must not be confused with NSE symbols
    expect(
      extractNseSymbolFromQuery("Analyze market regime in India for inflation and growth")
    ).toBeNull();
    expect(extractNseSymbolFromQuery("Analyze NSE:TCS")).toBe("TCS");
  });

  it("9. Partial agent failures distinguish TIMEOUT, RATE_LIMITED, NO_DATA, PROVIDER_ERROR and skip redundant synthesis when all fail", async () => {
    const registry = new AgentRegistry({
      useCache: false,
      companyResearch: {
        research: async () => {
          throw new AIProviderError({
            message: "429 quota",
            provider: "groq",
            statusCode: 429,
            code: "GROQ_QUOTA_EXHAUSTED",
            retryable: true,
            quotaExhausted: true,
            tier: "fast",
            model: "openai/gpt-oss-120b",
          });
        },
      } as any,
      institutionalIntelligence: {
        analyze: async () => {
          throw new Error("No data available for symbol");
        },
      } as any,
      newsMacro: {
        analyze: async () => {
          await new Promise((r) => setTimeout(r, 150));
          return {};
        },
      } as any,
    });

    const r1 = await registry.execute("company_research", {
      userId: "u1",
      query: "Analyze RELIANCE",
      symbol: "RELIANCE",
      tier: "fast",
      timeoutMs: 100,
    });
    expect(r1.status).toBe("FAILED");
    expect(r1.errorCategory).toBe("RATE_LIMITED");

    const r2 = await registry.execute("institutional_intelligence", {
      userId: "u1",
      query: "FII DII",
      symbol: null,
      tier: "fast",
      timeoutMs: 100,
    });
    expect(r2.status).toBe("FAILED");
    expect(r2.errorCategory).toBe("NO_DATA");

    const r3 = await registry.execute("news_macro", {
      userId: "u1",
      query: "Macro",
      symbol: null,
      tier: "fast",
      timeoutMs: 30,
    });
    expect(r3.status).toBe("TIMED_OUT");
    expect(r3.errorCategory).toBe("TIMEOUT");

    const mockCreate = vi.fn();
    const synth = new ResponseSynthesizer({ createResponse: mockCreate } as any);
    const out = await synth.synthesize({
      query: "Analyze RELIANCE",
      routing: new IntentRouter().route("Analyze RELIANCE fundamentals"),
      executions: [r1, r2, r3],
      tier: "fast",
    });
    expect(mockCreate).not.toHaveBeenCalled();
    expect(out.model).toBe("fallback");
    expect(out.structured.CONCLUSION.partialFailureDisclosed).toBe(true);
  });

  it("10. Provider recovers after cooldown expires and resets consecutive429s on success", () => {
    let currentTime = 5_000_000;
    const limiter = new RateLimitManager({
      defaultCooldownMs: 10_000,
      now: () => currentTime,
    });

    limiter.markCooldown("gemini", 10_000, "GEMINI_QUOTA_EXHAUSTED");
    expect(limiter.isInCooldown("gemini")).toBe(true);
    expect(limiter.getProviderState("gemini").consecutive429s).toBe(1);

    currentTime += 10_001;
    expect(limiter.isInCooldown("gemini")).toBe(false);

    limiter.recordSuccess("gemini");
    expect(limiter.getProviderState("gemini").consecutive429s).toBe(0);
    expect(limiter.getProviderState("gemini").lastErrorCode).toBeNull();
  });

  it("11. Cross-user portfolio isolation ensures User A data is never leaked to User B", async () => {
    const loader = vi.fn(async (userId: string) =>
      userId === "user-a"
        ? [
            {
              id: "pos-a-1",
              userId: "user-a",
              instrument: "RELIANCE",
              sector: "Energy",
              side: "BUY" as const,
              quantity: 10,
              entryPrice: 2800,
              currentPrice: 2900,
              realizedPnL: 0,
              stopLoss: 2700,
              status: "OPEN",
              updatedAt: "2026-11-13T10:00:00.000Z",
            },
          ]
        : []
    );

    const mockClient = {
      createResponse: vi.fn(async () => ({
        id: "resp_port",
        provider: "groq",
        model: "openai/gpt-oss-120b",
        outputText: JSON.stringify({
          portfolioSummary: { summary: "Summary", evidenceIds: [] },
          allocationAnalysis: { summary: "Alloc", concentrationFlags: [], evidenceIds: [] },
          pnlBreakdown: { summary: "PnL", evidenceIds: [] },
          missingPricesAndData: [],
          keyObservations: [],
          keyRisks: [],
          conclusion: { summary: "Done", stance: "NEUTRAL", evidenceIds: [] },
        }),
        output: [],
        usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20 },
        latencyMs: 5,
      })),
    } as any;

    const portAgent = new PortfolioIntelligenceAgent({
      aiClient: mockClient,
      evidenceService: new EvidenceIntelligenceService(),
      positionsLoader: loader,
    });

    const resA = await portAgent.analyze("user-a", { tier: "fast" });
    const resB = await portAgent.analyze("user-b", { tier: "fast" });

    expect(resA.deterministicMetrics.openPositionCount).toBe(1);
    expect(resB.deterministicMetrics.openPositionCount).toBe(0);
    expect(resB.deterministicMetrics.totalExposure).toBe(0);
  });
});
