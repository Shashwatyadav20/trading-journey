import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Fastify, { FastifyInstance } from "fastify";
import OpenAI from "openai";
import { AIConfigError, createModelRouter } from "../core/ModelRouter";
import {
  AIProviderError,
  createOpenAIClient,
  redactSecrets,
} from "../core/OpenAIClient";
import aiRoutes from "../../routes/ai";
import * as userContext from "../../trading/userContext";

describe("Phase 1: Centralized OpenAI Client, ModelRouter & Protected AI Routes", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env = {
      ...originalEnv,
      OPENAI_API_KEY: "sk-proj-test-secret-key-1234567890abcdef",
      OPENAI_MODEL_DEEP: "gpt-5.4",
      OPENAI_MODEL_BALANCED: "gpt-5-mini",
      OPENAI_MODEL_FAST: "gpt-5-nano",
      AI_REASONING_EFFORT: "medium",
      AI_MAX_TOOL_CALLS: "5",
      AI_REQUEST_TIMEOUT_MS: "15000",
    };
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  describe("1. Configuration & ModelRouter", () => {
    it("routes deep, balanced, and fast tiers to configured models", () => {
      const router = createModelRouter();
      const deep = router.selectModel("deep");
      const balanced = router.selectModel("balanced");
      const fast = router.selectModel("fast");

      expect(deep.model).toBe("gpt-5.4");
      expect(deep.reasoningEffort).toBe("medium");
      expect(deep.maxToolCalls).toBe(5);
      expect(deep.timeoutMs).toBe(15000);

      expect(balanced.model).toBe("gpt-5-mini");
      expect(balanced.reasoningEffort).toBe("medium");

      expect(fast.model).toBe("gpt-5-nano");
      // fast tier automatically dials reasoning down to low unless explicitly overridden
      expect(fast.reasoningEffort).toBe("low");
    });

    it("throws AIConfigError when a tier model is missing", () => {
      delete process.env.OPENAI_MODEL_DEEP;
      const router = createModelRouter();

      expect(() => router.selectModel("deep")).toThrow(AIConfigError);
      expect(() => router.selectModel("deep")).toThrow(/OPENAI_MODEL_DEEP/);
    });

    it("detects invalid AI_REASONING_EFFORT, AI_MAX_TOOL_CALLS, and AI_REQUEST_TIMEOUT_MS", () => {
      process.env.AI_REASONING_EFFORT = "extreme_invalid";
      process.env.AI_MAX_TOOL_CALLS = "0";
      process.env.AI_REQUEST_TIMEOUT_MS = "100";

      const router = createModelRouter();
      const validation = router.validateConfiguration();

      expect(validation.valid).toBe(false);
      expect(validation.invalid).toContain("AI_REASONING_EFFORT");
      expect(validation.invalid).toContain("AI_MAX_TOOL_CALLS");
      expect(validation.invalid).toContain("AI_REQUEST_TIMEOUT_MS");
    });

    it("throws AIConfigError when OPENAI_API_KEY is missing on createResponse", async () => {
      process.env.OPENAI_API_KEY = "";
      const client = createOpenAIClient({ apiKey: "" });

      await expect(
        client.createResponse({ tier: "fast", input: "Hello" })
      ).rejects.toThrow(AIConfigError);
    });
  });

  describe("2. Responses API, Timeout & Provider Failure Handling", () => {
    it("calls official Responses API (responses.create) and returns normalized output", async () => {
      const mockCreate = vi.fn().mockResolvedValue({
        id: "resp_test_123",
        model: "gpt-5-mini",
        output_text: "Institutional market structure is bullish above VWAP.",
        output: [],
        usage: {
          input_tokens: 42,
          output_tokens: 18,
          total_tokens: 60,
        },
      });

      const mockSdk = {
        responses: { create: mockCreate },
      } as unknown as OpenAI;

      const client = createOpenAIClient({ clientOverride: mockSdk });
      const res = await client.createResponse({
        tier: "balanced",
        input: "Analyze RELIANCE",
        instructions: "Read-only research.",
        maxOutputTokens: 200,
      });

      expect(mockCreate).toHaveBeenCalledTimes(1);
      const [payload, reqOpts] = mockCreate.mock.calls[0];
      expect(payload.model).toBe("gpt-5-mini");
      expect(payload.input).toBe("Analyze RELIANCE");
      expect(payload.max_tool_calls).toBe(5);
      expect(payload.reasoning).toEqual({ effort: "medium" });
      expect(reqOpts.timeout).toBe(15000);
      expect(reqOpts.signal).toBeDefined();

      expect(res.id).toBe("resp_test_123");
      expect(res.tier).toBe("balanced");
      expect(res.outputText).toBe("Institutional market structure is bullish above VWAP.");
      expect(res.usage?.totalTokens).toBe(60);
    });

    it("enforces request timeout and maps abort/timeout to 504 AIProviderError", async () => {
      const mockCreate = vi.fn((_payload: unknown, opts: { signal?: AbortSignal }) => {
        return new Promise((_resolve, reject) => {
          opts?.signal?.addEventListener("abort", () => {
            const abortErr = new Error("Request aborted");
            abortErr.name = "AbortError";
            reject(abortErr);
          });
        });
      });

      const mockSdk = {
        responses: { create: mockCreate },
      } as unknown as OpenAI;

      const client = createOpenAIClient({
        clientOverride: mockSdk,
        routerOverrides: { requestTimeoutMs: 1000 },
      });

      await expect(
        client.createResponse({ tier: "fast", input: "Ping", timeoutMs: 1000 })
      ).rejects.toMatchObject({
        name: "AIProviderError",
        statusCode: 504,
        code: "OPENAI_TIMEOUT",
        retryable: true,
      });
    }, 5000);

    it("redacts API keys and Bearer tokens from provider error messages", async () => {
      const secretKey = "sk-proj-superSecretKeyValue9988776655";
      process.env.OPENAI_API_KEY = secretKey;

      const leakedErr = new Error(
        `Upstream failure with key ${secretKey} and header Bearer ${secretKey}`
      );

      const mockSdk = {
        responses: {
          create: vi.fn().mockRejectedValue(leakedErr),
        },
      } as unknown as OpenAI;

      const client = createOpenAIClient({
        apiKey: secretKey,
        clientOverride: mockSdk,
      });

      let caught: AIProviderError | null = null;
      try {
        await client.createResponse({ tier: "deep", input: "Test" });
      } catch (e) {
        caught = e as AIProviderError;
      }

      expect(caught).toBeInstanceOf(AIProviderError);
      expect(caught!.message).not.toContain(secretKey);
      expect(caught!.message).toContain("[REDACTED_API_KEY]");
      expect(redactSecrets(`Bearer ${secretKey}`, [secretKey])).not.toContain(secretKey);
    });

    it("maps OpenAI AuthenticationError and RateLimitError safely", async () => {
      const authErr = new OpenAI.AuthenticationError(
        401,
        { error: { message: "Incorrect API key provided: sk-proj-1234567890123456" } },
        "Incorrect API key provided: sk-proj-1234567890123456",
        new Headers()
      );

      const clientAuth = createOpenAIClient({
        clientOverride: {
          responses: { create: vi.fn().mockRejectedValue(authErr) },
        } as unknown as OpenAI,
      });

      await expect(
        clientAuth.createResponse({ tier: "fast", input: "Ping" })
      ).rejects.toMatchObject({
        statusCode: 502,
        code: "OPENAI_AUTH_ERROR",
        retryable: false,
      });

      const rateErr = new OpenAI.RateLimitError(
        429,
        { error: { message: "Rate limit reached" } },
        "Rate limit reached",
        new Headers()
      );

      const clientRate = createOpenAIClient({
        clientOverride: {
          responses: { create: vi.fn().mockRejectedValue(rateErr) },
        } as unknown as OpenAI,
      });

      await expect(
        clientRate.createResponse({ tier: "fast", input: "Ping" })
      ).rejects.toMatchObject({
        statusCode: 429,
        code: "OPENAI_RATE_LIMIT",
        retryable: true,
      });
    });
  });

  describe("3. Protected /api/ai/health & /api/ai/test Endpoints", () => {
    let app: FastifyInstance;

    const createTestApp = async (mockSdk?: OpenAI) => {
      const instance = Fastify({ logger: false });
      const aiClient = createOpenAIClient({ clientOverride: mockSdk });
      await instance.register(aiRoutes, { aiClient });
      return instance;
    };

    afterEach(async () => {
      if (app) await app.close();
    });

    it("rejects unauthenticated requests to GET /api/ai/health with 401", async () => {
      app = await createTestApp();
      const res = await app.inject({ method: "GET", url: "/api/ai/health" });
      expect(res.statusCode).toBe(401);
    });

    it("rejects unapproved users with 403", async () => {
      vi.spyOn(userContext, "extractVerifiedUser").mockResolvedValue({
        userId: "user-123",
        email: "trader@example.com",
      });
      vi.spyOn(userContext, "requireApprovedUser").mockRejectedValue(
        new userContext.AuthorizationError("Account pending approval")
      );

      app = await createTestApp();
      const res = await app.inject({
        method: "GET",
        url: "/api/ai/health",
        headers: { authorization: "Bearer valid.jwt.token" },
      });
      expect(res.statusCode).toBe(403);
    });

    it("returns 200 config health & live ping without exposing API key for approved users", async () => {
      vi.spyOn(userContext, "extractVerifiedUser").mockResolvedValue({
        userId: "user-approved-1",
        email: "quant@example.com",
      });
      vi.spyOn(userContext, "requireApprovedUser").mockResolvedValue();

      const mockSdk = {
        responses: {
          create: vi.fn().mockResolvedValue({
            id: "resp_ping_1",
            model: "gpt-5-nano",
            output_text: "OK",
            output: [],
            usage: { input_tokens: 5, output_tokens: 1, total_tokens: 6 },
          }),
        },
      } as unknown as OpenAI;

      app = await createTestApp(mockSdk);
      const res = await app.inject({
        method: "GET",
        url: "/api/ai/health?ping=true",
        headers: { authorization: "Bearer valid.jwt.token" },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.ok).toBe(true);
      expect(body.apiKeyConfigured).toBe(true);
      expect(body.livePing?.reachable).toBe(true);
      expect(body.livePing?.model).toBe("gpt-5-nano");
      expect(JSON.stringify(body)).not.toContain(process.env.OPENAI_API_KEY!);
    });

    it("executes POST /api/ai/test for approved users and rejects invalid tiers with 400", async () => {
      vi.spyOn(userContext, "extractVerifiedUser").mockResolvedValue({
        userId: "user-approved-1",
        email: "quant@example.com",
      });
      vi.spyOn(userContext, "requireApprovedUser").mockResolvedValue();

      const mockSdk = {
        responses: {
          create: vi.fn().mockResolvedValue({
            id: "resp_test_ok",
            model: "gpt-5.4",
            output_text: "AI engine operational.",
            output: [],
            usage: { input_tokens: 10, output_tokens: 4, total_tokens: 14 },
          }),
        },
      } as unknown as OpenAI;

      app = await createTestApp(mockSdk);

      const badRes = await app.inject({
        method: "POST",
        url: "/api/ai/test",
        headers: { authorization: "Bearer valid.jwt.token" },
        payload: { tier: "invalid_tier" },
      });
      expect(badRes.statusCode).toBe(400);

      const okRes = await app.inject({
        method: "POST",
        url: "/api/ai/test",
        headers: { authorization: "Bearer valid.jwt.token" },
        payload: { tier: "deep", prompt: "Verify readiness" },
      });
      expect(okRes.statusCode).toBe(200);
      const body = okRes.json();
      expect(body.ok).toBe(true);
      expect(body.tier).toBe("deep");
      expect(body.model).toBe("gpt-5.4");
      expect(body.outputText).toBe("AI engine operational.");
    });
  });
});

