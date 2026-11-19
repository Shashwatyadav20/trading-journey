import { describe, expect, it, vi } from "vitest";
import { AIProvider, AIProviderError, AIProviderRequest, AIProviderResponse } from "../core/AIProvider";
import { OpenAIClientService } from "../core/OpenAIClient";
import { RateLimitManager } from "../core/RateLimitManager";
import { AgentRegistry } from "../orchestrator/AgentRegistry";
import { UnifiedIntelligenceContextBuilder } from "../context/UnifiedIntelligenceContextBuilder";
import { EvidenceRecord } from "../evidence/EvidenceSchema";

function makeMockProvider(
  name: "gemini" | "groq" | "openai",
  handler: (req: AIProviderRequest) => Promise<AIProviderResponse>,
  configured = true
): AIProvider {
  return {
    name,
    isApiKeyConfigured: () => configured,
    resolveModel: (tier) => `${name}-${tier}-mock`,
    validateConfiguration: () => ({
      valid: configured,
      apiKeyConfigured: configured,
      missing: configured ? [] : [`${name.toUpperCase()}_API_KEY`],
      invalid: [],
      models: {
        deep: `${name}-deep-mock`,
        balanced: `${name}-balanced-mock`,
        fast: `${name}-fast-mock`,
      },
    }),
    listAvailableModels: async () => [`${name}-balanced-mock`],
    generateResponse: handler,
  };
}

function makeEvidence(id: string, symbol = "RELIANCE"): EvidenceRecord {
  const nowIso = new Date().toISOString();
  return {
    evidenceId: id,
    symbol,
    category: "QUARTERLY_FINANCIALS",
    claim: `Verified metric for ${id}`,
    value: 1000,
    unit: "INR_CR",
    currency: "INR",
    source: "NSE_OFFICIAL",
    sourceTier: "OFFICIAL_EXCHANGE_OR_FILING",
    sourceClassification: "OFFICIAL_EXCHANGE",
    dataPeriod: "Q4FY26",
    sourceUrl: "https://www.nseindia.com",
    publishedAt: nowIso,
    retrievedAt: nowIso,
    freshness: "FRESH",
    verificationStatus: "VERIFIED",
    verificationMethod: "OFFICIAL_EXCHANGE_SIGNATURE",
    confidence: 0.9,
    supportingEvidenceIds: [],
    conflictingEvidenceIds: [],
    untrustedExternal: false,
    metadata: { dataPeriod: "Q4FY26", reportingBasis: "CONSOLIDATED" },
  };
}

describe("Phase 9.6.5 — AI Agent Execution Optimization", () => {
  it("1. Gemini 503 triggers immediate controlled fallback to Groq without retrying Gemini", async () => {
    const rateLimiter = new RateLimitManager({
      concurrency: { gemini: 2, groq: 2 },
      transientMaxRetries: 1,
    });
    const geminiCalls: number[] = [];
    const groqCalls: number[] = [];

    const gemini = makeMockProvider("gemini", async () => {
      geminiCalls.push(Date.now());
      throw new AIProviderError({
        message: "Gemini 503 high demand",
        provider: "gemini",
        statusCode: 503,
        code: "GEMINI_OVERLOADED",
        retryable: true,
      });
    });

    const groq = makeMockProvider("groq", async (req) => {
      groqCalls.push(Date.now());
      return {
        id: "groq-ok-1",
        provider: "groq",
        model: req.model || "groq-balanced-mock",
        outputText: '{"ok":true}',
        output: [],
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
        latencyMs: 20,
      };
    });

    const client = new OpenAIClientService({
      provider: "gemini",
      fallbackProvider: "groq",
      enableFallback: true,
      rateLimitManager: rateLimiter,
      providers: { gemini, groq },
    });

    const res = await client.createResponse({
      tier: "balanced",
      input: "Analyze RELIANCE",
      timeoutMs: 10_000,
    });

    expect(res.provider).toBe("groq");
    expect(res.fallbackUsed).toBe(true);
    expect(res.fallbackFrom).toBe("gemini");
    expect(geminiCalls.length).toBe(1);
    expect(groqCalls.length).toBe(1);
  });

  it("2. Gemini 429 enters cooldown and subsequent calls skip Gemini immediately", async () => {
    const rateLimiter = new RateLimitManager({
      concurrency: { gemini: 2, groq: 2 },
      defaultCooldownMs: 10_000,
      transientMaxRetries: 1,
    });
    let geminiCount = 0;
    let groqCount = 0;

    const gemini = makeMockProvider("gemini", async () => {
      geminiCount += 1;
      throw new AIProviderError({
        message: "Quota exhausted",
        provider: "gemini",
        statusCode: 429,
        code: "GEMINI_RATE_LIMITED",
        retryable: true,
        quotaExhausted: true,
        retryAfterMs: 10_000,
      });
    });

    const groq = makeMockProvider("groq", async () => {
      groqCount += 1;
      return {
        id: `groq-${groqCount}`,
        provider: "groq",
        model: "groq-balanced-mock",
        outputText: "ok",
        output: [],
        usage: null,
        latencyMs: 10,
      };
    });

    const client = new OpenAIClientService({
      provider: "gemini",
      fallbackProvider: "groq",
      enableFallback: true,
      rateLimitManager: rateLimiter,
      providers: { gemini, groq },
    });

    const first = await client.createResponse({ tier: "balanced", input: "First", timeoutMs: 8_000 });
    const second = await client.createResponse({ tier: "balanced", input: "Second", timeoutMs: 8_000 });

    expect(first.provider).toBe("groq");
    expect(second.provider).toBe("groq");
    // First call hits Gemini once (no retry on 429), second call skips Gemini completely due to cooldown
    expect(geminiCount).toBe(1);
    expect(groqCount).toBe(2);
    expect(rateLimiter.isInCooldown("gemini")).toBe(true);
  });

  it("3. Respects Groq concurrency limits during parallel fallback", async () => {
    const rateLimiter = new RateLimitManager({
      concurrency: { gemini: 2, groq: 1 },
    });
    let activeGroq = 0;
    let maxObservedGroq = 0;

    const gemini = makeMockProvider("gemini", async () => {
      throw new AIProviderError({
        message: "503",
        provider: "gemini",
        statusCode: 503,
        code: "GEMINI_503",
        retryable: true,
      });
    });

    const groq = makeMockProvider("groq", async () => {
      activeGroq += 1;
      maxObservedGroq = Math.max(maxObservedGroq, activeGroq);
      await new Promise((r) => setTimeout(r, 40));
      activeGroq -= 1;
      return {
        id: "groq-conc",
        provider: "groq",
        model: "groq-balanced-mock",
        outputText: "ok",
        output: [],
        usage: null,
        latencyMs: 40,
      };
    });

    const client = new OpenAIClientService({
      provider: "gemini",
      fallbackProvider: "groq",
      enableFallback: true,
      rateLimitManager: rateLimiter,
      providers: { gemini, groq },
    });

    const results = await Promise.all([
      client.createResponse({ tier: "balanced", input: "1", timeoutMs: 5_000 }),
      client.createResponse({ tier: "balanced", input: "2", timeoutMs: 5_000 }),
      client.createResponse({ tier: "balanced", input: "3", timeoutMs: 5_000 }),
    ]);

    expect(results).toHaveLength(3);
    expect(maxObservedGroq).toBe(1);
  });

  it("4. Enforces provider queue timeout when queue wait exceeds budget", async () => {
    const rateLimiter = new RateLimitManager({
      concurrency: { gemini: 1, groq: 1 },
      queueTimeoutMs: 80,
    });

    const slowTask = rateLimiter.executeWithQueueAndRetry("groq", async () => {
      await new Promise((r) => setTimeout(r, 250));
      return "done";
    });

    await expect(
      rateLimiter.executeWithQueueAndRetry(
        "groq",
        async () => "never-runs",
        undefined,
        { queueTimeoutMs: 60 }
      )
    ).rejects.toMatchObject({
      code: "PROVIDER_QUEUE_TIMEOUT",
      statusCode: 504,
    });

    await slowTask;
  });

  it("5. Shared deadline reserves fallback headroom so primary timeout still leaves time for Groq", async () => {
    const rateLimiter = new RateLimitManager({
      concurrency: { gemini: 2, groq: 2 },
      transientMaxRetries: 1,
    });
    let observedPrimaryTimeout = 0;
    let observedFallbackTimeout = 0;

    const gemini = makeMockProvider("gemini", async (req) => {
      observedPrimaryTimeout = req.timeoutMs;
      // Simulate primary hitting its bounded timeout
      await new Promise((r) => setTimeout(r, 50));
      throw new AIProviderError({
        message: `Gemini timed out after ${req.timeoutMs}ms`,
        provider: "gemini",
        statusCode: 504,
        code: "GEMINI_TIMEOUT",
        retryable: true,
      });
    });

    const groq = makeMockProvider("groq", async (req) => {
      observedFallbackTimeout = req.timeoutMs;
      return {
        id: "groq-fast",
        provider: "groq",
        model: "groq-balanced-mock",
        outputText: "fallback-ok",
        output: [],
        usage: null,
        latencyMs: 15,
      };
    });

    const client = new OpenAIClientService({
      provider: "gemini",
      fallbackProvider: "groq",
      enableFallback: true,
      rateLimitManager: rateLimiter,
      providers: { gemini, groq },
    });

    const start = Date.now();
    const res = await client.createResponse({
      tier: "balanced",
      input: "Test deadline",
      timeoutMs: 6_000,
      deadlineAtMs: start + 6_000,
    });

    expect(res.provider).toBe("groq");
    expect(res.fallbackUsed).toBe(true);
    // Primary gets ~55% (<= 3300ms), leaving substantial headroom for fallback
    expect(observedPrimaryTimeout).toBeLessThanOrEqual(3_400);
    expect(observedFallbackTimeout).toBeGreaterThanOrEqual(2_000);
    expect(Date.now() - start).toBeLessThan(6_000);
  });

  it("6 & 7 & 8. Prioritizes agents with bounded concurrency, preserves evidence on timeout/failure, and never fabricates success", async () => {
    const executionOrder: string[] = [];
    let activeAgents = 0;
    let maxConcurrentAgents = 0;

    const companyResearch = {
      research: vi.fn(async () => {
        executionOrder.push("company_research");
        activeAgents += 1;
        maxConcurrentAgents = Math.max(maxConcurrentAgents, activeAgents);
        try {
          await new Promise((r) => setTimeout(r, 30));
          const rec = makeEvidence("ev-company-1");
          return {
            provider: "groq",
            generatedAt: new Date().toISOString(),
            verificationStatus: "VERIFIED",
            report: { executiveSummary: "Summary [ev-company-1]" },
            evidenceRecords: [rec],
            evidenceSummary: {
              evidenceIdsUsed: [rec.evidenceId],
              missingInformation: [],
              conflictedCount: 0,
              staleCount: 0,
            },
          };
        } finally {
          activeAgents -= 1;
        }
      }),
    };

    const institutionalIntelligence = {
      analyze: vi.fn(async (_req: any, opts: any) => {
        executionOrder.push("institutional_intelligence");
        activeAgents += 1;
        maxConcurrentAgents = Math.max(maxConcurrentAgents, activeAgents);
        try {
          const rec = makeEvidence("ev-inst-1");
          opts?.onEvidenceCollected?.({
            allRecords: [rec],
            generatedAt: new Date().toISOString(),
            missingInformation: [],
            stats: { staleCount: 0, conflictedCount: 0 },
          });
          // Simulate LLM hang beyond deadline
          await new Promise((r) => setTimeout(r, 250));
          return {};
        } finally {
          activeAgents -= 1;
        }
      }),
    };

    const marketIntelligence = {
      analyze: vi.fn(async (_req: any, opts: any) => {
        executionOrder.push("market_intelligence");
        activeAgents += 1;
        maxConcurrentAgents = Math.max(maxConcurrentAgents, activeAgents);
        try {
          const rec = makeEvidence("ev-mkt-1");
          opts?.onEvidenceCollected?.({
            allRecords: [rec],
            generatedAt: new Date().toISOString(),
            missingInformation: [],
            stats: { staleCount: 0, conflictedCount: 0 },
          });
          throw new Error("Groq fallback rate-limited");
        } finally {
          activeAgents -= 1;
        }
      }),
    };

    const newsMacro = {
      analyze: vi.fn(async () => {
        executionOrder.push("news_macro");
        activeAgents += 1;
        maxConcurrentAgents = Math.max(maxConcurrentAgents, activeAgents);
        try {
          await new Promise((r) => setTimeout(r, 20));
          const rec = makeEvidence("ev-news-1");
          return {
            provider: "gemini",
            generatedAt: new Date().toISOString(),
            verificationStatus: "VERIFIED",
            report: { executiveSummary: "News [ev-news-1]" },
            evidenceRecords: [rec],
            evidenceSummary: {
              evidenceIdsUsed: [rec.evidenceId],
              missingInformation: [],
              conflictedCount: 0,
              staleCount: 0,
            },
          };
        } finally {
          activeAgents -= 1;
        }
      }),
    };

    const registry = new AgentRegistry({
      useCache: false,
      companyResearch: companyResearch as any,
      institutionalIntelligence: institutionalIntelligence as any,
      marketIntelligence: marketIntelligence as any,
      newsMacro: newsMacro as any,
    });

    const builder = new UnifiedIntelligenceContextBuilder({ registry });

    // Pass agents in reverse order to verify priority sorting puts company_research first
    const ctx = await builder.buildForSymbol(
      "user-1",
      {
        symbol: "RELIANCE",
        agents: ["news_macro", "market_intelligence", "institutional_intelligence", "company_research"],
        tier: "balanced",
      },
      {
        timeoutMs: 180,
        requestTimeoutMs: 450,
        maxConcurrency: 2,
      }
    );

    expect(executionOrder[0]).toBe("company_research");
    expect(maxConcurrentAgents).toBeLessThanOrEqual(2);
    expect(["PARTIAL", "INSUFFICIENT_DATA"]).toContain(ctx.contextStatus);
    expect(ctx.qualityAssessment.completedAgentsCount).toBe(2);
    expect(ctx.qualityAssessment.failedAgentsCount).toBe(2);

    const instExec = ctx.agentExecutions.find((e) => e.agentName === "institutional_intelligence");
    const mktExec = ctx.agentExecutions.find((e) => e.agentName === "market_intelligence");
    const compExec = ctx.agentExecutions.find((e) => e.agentName === "company_research");

    expect(compExec?.executionStatus).toBe("SUCCESS");
    expect(compExec?.generationMode).toBe("LIVE_AI");
    expect(instExec?.executionStatus).toBe("TIMEOUT");
    expect(instExec?.generationMode).toBe("DETERMINISTIC");
    expect(mktExec?.executionStatus).toBe("PROVIDER_ERROR");
    expect(mktExec?.generationMode).toBe("DETERMINISTIC");

    // Preserved evidence from timed-out/failed agents must still be in context
    const allIds = ctx.evidenceReferences.map((e) => e.evidenceId);
    expect(allIds).toEqual(
      expect.arrayContaining(["ev-company-1", "ev-inst-1", "ev-mkt-1", "ev-news-1"])
    );
  });
});
