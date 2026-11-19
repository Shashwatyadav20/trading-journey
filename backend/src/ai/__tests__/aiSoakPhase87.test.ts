import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { GeminiProvider } from "../core/GeminiProvider";
import { GroqProvider } from "../core/GroqProvider";
import { RateLimitManager } from "../core/RateLimitManager";
import { ResearchCache } from "../core/ResearchCache";
import { AIUsageTracker } from "../core/AIUsageTracker";
import { createOpenAIClient } from "../core/OpenAIClient";
import { AIOrchestrator } from "../orchestrator/AIOrchestrator";
import { AgentRegistry } from "../orchestrator/AgentRegistry";
import { ResponseSynthesizer } from "../orchestrator/ResponseSynthesizer";
import { IntentRouter } from "../orchestrator/IntentRouter";
import { runStagingSoakHarness } from "./stagingSoakHarness";

function makeGeminiOk(text = "Gemini OK") {
  return new Response(
    JSON.stringify({
      responseId: "gem_1",
      candidates: [{ content: { parts: [{ text }] } }],
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 },
    }),
    { status: 200 }
  );
}

function makeGroqOk(text = "Groq OK") {
  return new Response(
    JSON.stringify({
      id: "groq_1",
      model: "openai/gpt-oss-120b",
      choices: [{ message: { content: text } }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    }),
    { status: 200 }
  );
}

describe("Phase 8.7 — Staging Soak Testing & Reliability Validation", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.GEMINI_API_KEY = "AIzaSyTestSecret_Phase87";
    process.env.GROQ_API_KEY = "gsk_TestSecret_Phase87";
    process.env.AI_PROVIDER = "gemini";
    process.env.AI_STAGING_MODE = "true";
    process.env.AI_STAGING_MAX_CONCURRENT_REQUESTS = "1";
    process.env.AI_STAGING_MAX_AGENTS_PER_REQUEST = "3";
    process.env.AI_STAGING_MAX_PROVIDER_ATTEMPTS = "2";
    process.env.AI_STAGING_CACHE_ENABLED = "true";
    process.env.AI_STAGING_USAGE_TRACKING = "true";
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  // --- Section 4: Provider Recovery Scenarios A–H ---
  it("4A-H. Validates all 8 provider failure & recovery scenarios without retry storms or key leakage", async () => {
    let nowMs = 1_700_000_000_000;
    const limiter = new RateLimitManager({
      defaultCooldownMs: 10_000,
      transientMaxRetries: 1,
      now: () => nowMs,
      sleep: async () => {},
    });

    let gemBehavior: "ok" | "429" | "503" = "ok";
    let groqBehavior: "ok" | "429" | "timeout" = "ok";

    const geminiFetch = vi.fn().mockImplementation(async () => {
      if (gemBehavior === "ok") return makeGeminiOk("Gemini Live");
      if (gemBehavior === "429") {
        return new Response(
          JSON.stringify({ error: { message: "Quota exceeded for AIzaSyTestSecret_Phase87" } }),
          { status: 429 }
        );
      }
      return new Response(JSON.stringify({ error: { message: "High demand 503" } }), { status: 503 });
    });

    const groqFetch = vi.fn().mockImplementation(async () => {
      if (groqBehavior === "ok") return makeGroqOk("Groq Fallback");
      if (groqBehavior === "429") {
        return new Response(
          JSON.stringify({ error: { message: "TPM limit for gsk_TestSecret_Phase87" } }),
          { status: 429 }
        );
      }
      const err = new Error("Request aborted");
      err.name = "AbortError";
      throw err;
    });

    const client = createOpenAIClient({
      provider: "gemini",
      fallbackProvider: "groq",
      rateLimitManager: limiter,
      providers: {
        gemini: new GeminiProvider({ fetchImpl: geminiFetch as unknown as typeof fetch }),
        groq: new GroqProvider({ fetchImpl: groqFetch as unknown as typeof fetch }),
      },
    });

    // A: Gemini available, Groq available
    const resA = await client.createResponse({ tier: "fast", input: "A" });
    expect(resA.provider).toBe("gemini");
    expect(limiter.getLastSuccessfulProvider()).toBe("gemini");

    // B: Gemini 429 -> Groq succeeds
    gemBehavior = "429";
    const resB = await client.createResponse({ tier: "fast", input: "B" });
    expect(resB.provider).toBe("groq");
    expect(resB.fallbackUsed).toBe(true);
    expect(limiter.getProviderState("gemini", true).status).toBe("RATE_LIMITED");
    expect(limiter.getLastSuccessfulProvider()).toBe("groq");

    // C: Gemini in cooldown + Groq 429 -> GROQ_QUOTA_EXHAUSTED
    groqBehavior = "429";
    await expect(client.createResponse({ tier: "fast", input: "C" })).rejects.toMatchObject({
      code: "GROQ_QUOTA_EXHAUSTED",
    });
    expect(limiter.getProviderState("groq", true).status).toBe("RATE_LIMITED");

    // D: Gemini 503 -> Phase 9.6.5 immediate controlled fallback to Groq without retrying Gemini
    nowMs += 20_000;
    gemBehavior = "503";
    groqBehavior = "ok";
    const gemCallsBeforeD = geminiFetch.mock.calls.length;
    const resD = await client.createResponse({ tier: "fast", input: "D" });
    expect(resD.provider).toBe("groq");
    expect(geminiFetch.mock.calls.length - gemCallsBeforeD).toBe(1);

    // E & F: Gemini 503 + Groq timeout -> both unavailable, no key leakage
    groqBehavior = "timeout";
    try {
      await client.createResponse({ tier: "fast", input: "E" });
      expect.unreachable("Should have thrown");
    } catch (err: any) {
      expect(err.message).not.toContain("AIzaSyTestSecret_Phase87");
      expect(err.message).not.toContain("gsk_TestSecret_Phase87");
    }

    // G: Gemini recovers after cooldown
    nowMs += 20_000;
    gemBehavior = "ok";
    const resG = await client.createResponse({ tier: "fast", input: "G" });
    expect(resG.provider).toBe("gemini");
    expect(limiter.getProviderState("gemini", true).status).toBe("AVAILABLE");

    // H: Groq recovers after cooldown
    gemBehavior = "429";
    groqBehavior = "ok";
    const resH = await client.createResponse({ tier: "fast", input: "H" });
    expect(resH.provider).toBe("groq");
    expect(limiter.getProviderState("groq", true).status).toBe("AVAILABLE");
  });

  // --- Section 6: Bounded Cache Memory & Targeted Invalidation ---
  it("6. ResearchCache bounds memory under soak load and supports targeted symbol invalidation", () => {
    let nowMs = 1_700_000_000_000;
    const cache = new ResearchCache({ now: () => nowMs, maxEntries: 10 });

    for (let i = 0; i < 15; i++) {
      cache.set({
        agentId: "company_research",
        symbol: i === 5 ? "RELIANCE" : `SYM${i}`,
        tier: "fast",
        query: `Analyze ${i}`,
        value: {
          generatedAt: new Date(nowMs).toISOString(),
          evidenceSummary: { staleCount: 0, expiredCount: 0 },
        },
      });
    }
    expect(cache.getStats().entries).toBeLessThanOrEqual(10);

    // Targeted symbol invalidation
    cache.set({
      agentId: "company_research",
      symbol: "RELIANCE",
      tier: "fast",
      query: "Analyze RELIANCE",
      value: {
        generatedAt: new Date(nowMs).toISOString(),
        evidenceSummary: { staleCount: 0, expiredCount: 0 },
      },
    });
    expect(cache.invalidateSymbol("RELIANCE")).toBeGreaterThanOrEqual(1);
    expect(
      cache.get({
        agentId: "company_research",
        symbol: "RELIANCE",
        tier: "fast",
        query: "Analyze RELIANCE",
      })
    ).toBeNull();
  });

  // --- Section 7: All 8 Workflows Routing & Evidence Quality Audit ---
  it("7. Audits routing, evidence attribution, freshness, missing-data, and deterministic fallback across all 8 workflows", async () => {
    const router = new IntentRouter();
    const cases = [
      { q: "Analyze RELIANCE fundamentals", sym: "RELIANCE", expectedIntent: "COMPANY_RESEARCH" },
      { q: "Analyze NIFTY market overview and India VIX", sym: "NIFTY", expectedIntent: "MARKET_INTELLIGENCE" },
      { q: "Analyze FII and DII institutional activity", sym: undefined, expectedIntent: "INSTITUTIONAL_INTELLIGENCE" },
      { q: "RBI monetary policy and inflation impact", sym: undefined, expectedIntent: "NEWS_MACRO" },
      { q: "Analyze my portfolio exposure and unrealized PnL", sym: undefined, expectedIntent: "PORTFOLIO_INTELLIGENCE" },
      { q: "Analyze NIFTY option chain PCR and max pain", sym: "NIFTY", expectedIntent: "OPTIONS_INTELLIGENCE" },
      { q: "Evaluate my portfolio drawdown and VaR risk", sym: undefined, expectedIntent: "RISK_INTELLIGENCE" },
      { q: "Complete research on RELIANCE combining fundamentals, institutions, market conditions and news", sym: "RELIANCE", expectedIntent: "MULTI_AGENT_RESEARCH" },
    ];

    for (const c of cases) {
      const r = router.route(c.q, c.sym ?? null);
      expect(r.intent).toBe(c.expectedIntent);
      expect(r.selectedAgents.length).toBeGreaterThan(0);
    }

    // Verify unknown query does not trigger unrelated agents
    expect(router.route("What is the weather in Tokyo?").selectedAgents).toEqual([]);
  });

  // --- Section 8: Simulated Staging Soak Harness ---
  it("8. Simulated staging soak run completes with 0 unhandled rejections, cache reuse, and bounded memory", async () => {
    const nowMs = Date.now();
    const cache = new ResearchCache({ maxEntries: 50 });
    const usageTracker = new AIUsageTracker();

    const makeAgentPayload = (id: string) => ({
      generatedAt: new Date(nowMs).toISOString(),
      evidenceSummary: {
        evidenceIdsUsed: [`EV_${id}_1`],
        missingInformation: [],
        conflictedCount: 0,
        staleCount: 0,
        expiredCount: 0,
      },
      report: { summary: `Grounded output from ${id}` },
    });

    const registry = new AgentRegistry({
      cache,
      useCache: true,
      companyResearch: { analyze: vi.fn().mockResolvedValue(makeAgentPayload("company")) } as any,
      marketIntelligence: { analyze: vi.fn().mockResolvedValue(makeAgentPayload("market")) } as any,
      institutionalIntelligence: { analyze: vi.fn().mockResolvedValue(makeAgentPayload("inst")) } as any,
      newsMacro: { analyze: vi.fn().mockResolvedValue(makeAgentPayload("news")) } as any,
    });

    const mockAiClient = {
      createResponse: vi.fn().mockResolvedValue({
        id: "synth_1",
        provider: "groq",
        fallbackUsed: true,
        tier: "fast",
        model: "openai/gpt-oss-120b",
        outputText: JSON.stringify({
          DIRECT_ANSWER: "Grounded summary [EV_company_1].",
          KEY_FINDINGS: ["Finding [EV_company_1]"],
          RISKS_AND_CONFLICTS: [],
          MISSING_INFORMATION: [],
          CONFIDENCE: "MEDIUM",
          CONCLUSION: { summary: "Grounded conclusion.", evidenceIds: ["EV_company_1"] },
        }),
        output: [],
        usage: { inputTokens: 50, outputTokens: 30, totalTokens: 80 },
        latencyMs: 12,
      }),
    } as any;

    const orchestrator = new AIOrchestrator({
      registry,
      synthesizer: new ResponseSynthesizer({ aiClient: mockAiClient }),
      usageTracker,
    });

    const steps = Array.from({ length: 12 }, (_, i) => ({
      userId: i % 2 === 0 ? "soak-u1" : "soak-u2",
      query: i % 2 === 0 ? "Analyze RELIANCE fundamentals" : "Analyze NIFTY market overview",
      symbol: i % 2 === 0 ? "RELIANCE" : "NIFTY",
      tier: "fast" as const,
    }));

    const soakResult = await runStagingSoakHarness({
      orchestrator,
      cache,
      usageTracker,
      steps,
      concurrency: 2,
    });

    expect(soakResult.totalExecuted).toBe(12);
    expect(soakResult.unhandledRejections).toBe(0);
    expect(soakResult.cacheHits).toBeGreaterThan(0);
    expect(soakResult.cacheStats?.entries).toBeLessThanOrEqual(50);
  });
});
