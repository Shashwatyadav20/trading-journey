import crypto from "node:crypto";
import { AIConfigError, AITaskTier } from "./ModelRouter";
import {
  AIProvider,
  AIProviderConfigValidation,
  AIProviderError,
  AIProviderRequest,
  AIProviderResponse,
  createCombinedAbortController,
  normalizeInputToMessages,
  redactSecrets,
  shouldUseJsonMode,
} from "./AIProvider";
import { parseRetryAfterMs } from "./RateLimitManager";

const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta";
const DEFAULT_GEMINI_MODEL = "gemini-3.8-flash";

export interface GeminiProviderOptions {
  apiKey?: string;
  model?: string;
  deepModel?: string;
  balancedModel?: string;
  fastModel?: string;
  fetchImpl?: typeof fetch;
}

export class GeminiProvider implements AIProvider {
  public readonly name = "gemini" as const;
  private readonly explicitApiKey?: string;
  private readonly explicitModel?: string;
  private readonly explicitDeepModel?: string;
  private readonly explicitBalancedModel?: string;
  private readonly explicitFastModel?: string;
  private readonly fetchImpl: typeof fetch;

  public constructor(options: GeminiProviderOptions = {}) {
    this.explicitApiKey = options.apiKey;
    this.explicitModel = options.model;
    this.explicitDeepModel = options.deepModel;
    this.explicitBalancedModel = options.balancedModel;
    this.explicitFastModel = options.fastModel;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  private resolveApiKey(): string {
    return (this.explicitApiKey ?? process.env.GEMINI_API_KEY ?? "").trim();
  }

  public isApiKeyConfigured(): boolean {
    return this.resolveApiKey().length > 0;
  }

  private resolveBaseModel(): string {
    return (
      this.explicitModel ??
      process.env.GEMINI_MODEL ??
      DEFAULT_GEMINI_MODEL
    ).trim();
  }

  public resolveModel(tier: AITaskTier): string {
    const base = this.resolveBaseModel();
    if (tier === "deep") {
      return (this.explicitDeepModel ?? process.env.GEMINI_MODEL_DEEP ?? base).trim();
    }
    if (tier === "fast") {
      return (this.explicitFastModel ?? process.env.GEMINI_MODEL_FAST ?? base).trim();
    }
    return (this.explicitBalancedModel ?? process.env.GEMINI_MODEL_BALANCED ?? base).trim();
  }

  public validateConfiguration(): AIProviderConfigValidation {
    const apiKeyConfigured = this.isApiKeyConfigured();
    const models: Record<AITaskTier, string> = {
      deep: this.resolveModel("deep"),
      balanced: this.resolveModel("balanced"),
      fast: this.resolveModel("fast"),
    };
    const missing: string[] = [];
    if (!apiKeyConfigured) {
      missing.push("GEMINI_API_KEY");
    }
    if (!models.deep || !models.balanced || !models.fast) {
      missing.push("GEMINI_MODEL");
    }

    return {
      valid: missing.length === 0,
      apiKeyConfigured,
      missing,
      invalid: [],
      models,
    };
  }

  public async listAvailableModels(timeoutMs = 10_000): Promise<string[]> {
    const apiKey = this.resolveApiKey();
    if (!apiKey) {
      throw new AIConfigError(
        "Missing Gemini API key: GEMINI_API_KEY is not configured on the backend."
      );
    }

    const { controller, cleanup } = createCombinedAbortController(timeoutMs);
    try {
      const res = await this.fetchImpl(`${GEMINI_API_BASE}/models`, {
        method: "GET",
        headers: {
          "x-goog-api-key": apiKey,
        },
        signal: controller.signal,
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`HTTP ${res.status}: ${redactSecrets(text, [apiKey])}`);
      }

      const json = (await res.json()) as {
        models?: Array<{ name?: string; supportedGenerationMethods?: string[] }>;
      };

      return (json.models ?? [])
        .filter((m) =>
          Array.isArray(m.supportedGenerationMethods)
            ? m.supportedGenerationMethods.includes("generateContent")
            : true
        )
        .map((m) => String(m.name ?? "").replace(/^models\//, ""))
        .filter(Boolean);
    } finally {
      cleanup();
    }
  }

  public async generateResponse(
    request: AIProviderRequest
  ): Promise<AIProviderResponse> {
    const apiKey = this.resolveApiKey();
    if (!apiKey) {
      throw new AIConfigError(
        "Missing Gemini API key: GEMINI_API_KEY is not configured on the backend."
      );
    }

    const model = (request.model || this.resolveModel(request.tier)).replace(/^models\//, "");
    const { controller, didTimeout, cleanup } = createCombinedAbortController(
      request.timeoutMs,
      request.signal
    );

    const startedAt = Date.now();
    try {
      const normalized = normalizeInputToMessages(request.input);
      const systemMessages = normalized
        .filter((m) => m.role === "system")
        .map((m) => m.text);
      const combinedInstructions = [request.instructions, ...systemMessages]
        .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
        .join("\n\n");

      const contents = normalized
        .filter((m) => m.role !== "system")
        .map((m) => ({
          role: m.role === "assistant" ? "model" : "user",
          parts: [{ text: m.text }],
        }));

      const generationConfig: Record<string, unknown> = {};
      if (request.maxOutputTokens && request.maxOutputTokens > 0) {
        generationConfig.maxOutputTokens = request.maxOutputTokens;
      }
      if (shouldUseJsonMode(request)) {
        generationConfig.responseMimeType = "application/json";
      }

      const body: Record<string, unknown> = {
        contents: contents.length > 0 ? contents : [{ role: "user", parts: [{ text: "" }] }],
        ...(combinedInstructions
          ? { systemInstruction: { parts: [{ text: combinedInstructions }] } }
          : {}),
        ...(Object.keys(generationConfig).length > 0 ? { generationConfig } : {}),
      };

      const url = `${GEMINI_API_BASE}/models/${encodeURIComponent(model)}:generateContent`;
      const response = await this.fetchImpl(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      const rawText = await response.text();
      if (!response.ok) {
        const retryAfterMs = parseRetryAfterMs(response.headers.get("retry-after"));
        throw this.mapHttpError(response.status, rawText, request.tier, model, apiKey, retryAfterMs);
      }

      let parsed: any;
      try {
        parsed = JSON.parse(rawText);
      } catch {
        throw new AIProviderError({
          message: "Gemini returned an invalid JSON envelope.",
          provider: "gemini",
          statusCode: 502,
          code: "GEMINI_INVALID_ENVELOPE",
          retryable: true,
          tier: request.tier,
          model,
        });
      }

      const candidate = parsed?.candidates?.[0];
      const parts: Array<{ text?: string }> = candidate?.content?.parts ?? [];
      const outputText = parts
        .map((p) => (typeof p?.text === "string" ? p.text : ""))
        .join("")
        .trim();

      const usageMeta = parsed?.usageMetadata;
      const usage = usageMeta
        ? {
            inputTokens: Number(usageMeta.promptTokenCount ?? 0),
            outputTokens: Number(usageMeta.candidatesTokenCount ?? 0),
            totalTokens: Number(usageMeta.totalTokenCount ?? 0),
          }
        : null;

      return {
        id: `gem_${crypto.randomUUID()}`,
        provider: "gemini",
        model: parsed?.modelVersion || model,
        outputText,
        output: candidate ? [candidate] : [],
        usage,
        latencyMs: Date.now() - startedAt,
      };
    } catch (err: unknown) {
      if (err instanceof AIConfigError || err instanceof AIProviderError) {
        throw err;
      }

      if (didTimeout()) {
        throw new AIProviderError({
          message: `Gemini request timed out after ${request.timeoutMs}ms.`,
          provider: "gemini",
          statusCode: 504,
          code: "GEMINI_TIMEOUT",
          retryable: true,
          tier: request.tier,
          model,
        });
      }

      if (err instanceof Error && err.name === "AbortError") {
        throw new AIProviderError({
          message: "Gemini request was cancelled.",
          provider: "gemini",
          statusCode: 499,
          code: "GEMINI_CANCELLED",
          retryable: false,
          tier: request.tier,
          model,
        });
      }

      const safeMsg = redactSecrets(
        err instanceof Error ? err.message : "Gemini request failed.",
        [apiKey]
      );
      throw new AIProviderError({
        message: `Gemini connection error: ${safeMsg}`,
        provider: "gemini",
        statusCode: 502,
        code: "GEMINI_CONNECTION_ERROR",
        retryable: true,
        tier: request.tier,
        model,
      });
    } finally {
      cleanup();
    }
  }

  private mapHttpError(
    status: number,
    rawBody: string,
    tier: AITaskTier,
    model: string,
    apiKey: string,
    retryAfterMs?: number
  ): AIProviderError {
    let providerMessage = rawBody;
    let providerStatus = "";
    try {
      const json = JSON.parse(rawBody);
      providerMessage = json?.error?.message ?? rawBody;
      providerStatus = String(json?.error?.status ?? "");
    } catch {
      // leave rawBody
    }

    const safeMessage = redactSecrets(providerMessage, [apiKey]).slice(0, 300);

    if (
      status === 401 ||
      status === 403 ||
      providerStatus === "PERMISSION_DENIED" ||
      providerStatus === "UNAUTHENTICATED" ||
      /api key not valid|invalid api key/i.test(safeMessage)
    ) {
      return new AIProviderError({
        message: "Gemini authentication failed. Check server-side GEMINI_API_KEY configuration.",
        provider: "gemini",
        statusCode: 502,
        code: "GEMINI_AUTH_ERROR",
        retryable: false,
        tier,
        model,
      });
    }

    if (status === 429 || providerStatus === "RESOURCE_EXHAUSTED") {
      return new AIProviderError({
        message: "Gemini free-tier quota or rate limit exceeded. Please retry shortly or configure Groq fallback.",
        provider: "gemini",
        statusCode: 429,
        code: "GEMINI_QUOTA_EXHAUSTED",
        retryable: true,
        quotaExhausted: true,
        retryAfterMs,
        tier,
        model,
      });
    }

    if (status === 404 || /no longer available|not found|is not supported/i.test(safeMessage)) {
      return new AIProviderError({
        message: `Gemini model "${model}" is unavailable (${status}): ${safeMessage || "model not found"}`,
        provider: "gemini",
        statusCode: 404,
        code: "GEMINI_MODEL_UNAVAILABLE",
        retryable: false,
        tier,
        model,
      });
    }

    if (status === 400 || status === 422) {
      return new AIProviderError({
        message: `Gemini rejected the request (${status}): ${safeMessage || "invalid request"}`,
        provider: "gemini",
        statusCode: 400,
        code: "GEMINI_INVALID_REQUEST",
        retryable: false,
        tier,
        model,
      });
    }

    if (status >= 500) {
      return new AIProviderError({
        message: `Gemini service error (${status}): ${safeMessage || "upstream unavailable"}`,
        provider: "gemini",
        statusCode: 502,
        code: "GEMINI_SERVER_ERROR",
        retryable: true,
        tier,
        model,
      });
    }

    return new AIProviderError({
      message: `Gemini API error (${status}): ${safeMessage || "request failed"}`,
      provider: "gemini",
      statusCode: 502,
      code: "GEMINI_API_ERROR",
      retryable: status === 408,
      tier,
      model,
    });
  }
}

