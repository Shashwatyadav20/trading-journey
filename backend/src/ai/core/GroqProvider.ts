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

const GROQ_API_BASE = "https://api.groq.com/openai/v1";
const DEFAULT_GROQ_MODEL = "openai/gpt-oss-120b";

export interface GroqProviderOptions {
  apiKey?: string;
  model?: string;
  deepModel?: string;
  balancedModel?: string;
  fastModel?: string;
  fetchImpl?: typeof fetch;
}

export class GroqProvider implements AIProvider {
  public readonly name = "groq" as const;
  private readonly explicitApiKey?: string;
  private readonly explicitModel?: string;
  private readonly explicitDeepModel?: string;
  private readonly explicitBalancedModel?: string;
  private readonly explicitFastModel?: string;
  private readonly fetchImpl: typeof fetch;

  public constructor(options: GroqProviderOptions = {}) {
    this.explicitApiKey = options.apiKey;
    this.explicitModel = options.model;
    this.explicitDeepModel = options.deepModel;
    this.explicitBalancedModel = options.balancedModel;
    this.explicitFastModel = options.fastModel;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  private resolveApiKey(): string {
    return (this.explicitApiKey ?? process.env.GROQ_API_KEY ?? "").trim();
  }

  public isApiKeyConfigured(): boolean {
    return this.resolveApiKey().length > 0;
  }

  private resolveBaseModel(): string {
    return (
      this.explicitModel ??
      process.env.GROQ_MODEL ??
      DEFAULT_GROQ_MODEL
    ).trim();
  }

  public resolveModel(tier: AITaskTier): string {
    const base = this.resolveBaseModel();
    if (tier === "deep") {
      return (this.explicitDeepModel ?? process.env.GROQ_MODEL_DEEP ?? base).trim();
    }
    if (tier === "fast") {
      return (this.explicitFastModel ?? process.env.GROQ_MODEL_FAST ?? base).trim();
    }
    return (this.explicitBalancedModel ?? process.env.GROQ_MODEL_BALANCED ?? base).trim();
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
      missing.push("GROQ_API_KEY");
    }
    if (!models.deep || !models.balanced || !models.fast) {
      missing.push("GROQ_MODEL");
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
        "Missing Groq API key: GROQ_API_KEY is not configured on the backend."
      );
    }

    const { controller, cleanup } = createCombinedAbortController(timeoutMs);
    try {
      const res = await this.fetchImpl(`${GROQ_API_BASE}/models`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
        signal: controller.signal,
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`HTTP ${res.status}: ${redactSecrets(text, [apiKey])}`);
      }

      const json = (await res.json()) as {
        data?: Array<{ id?: string; active?: boolean }>;
      };

      return (json.data ?? [])
        .filter((m) => m.active !== false)
        .map((m) => String(m.id ?? ""))
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
        "Missing Groq API key: GROQ_API_KEY is not configured on the backend."
      );
    }

    const model = request.model || this.resolveModel(request.tier);
    const { controller, didTimeout, cleanup } = createCombinedAbortController(
      request.timeoutMs,
      request.signal
    );

    const startedAt = Date.now();
    try {
      const normalized = normalizeInputToMessages(request.input);
      const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [];

      if (request.instructions && request.instructions.trim().length > 0) {
        messages.push({ role: "system", content: request.instructions.trim() });
      }
      for (const m of normalized) {
        messages.push({ role: m.role, content: m.text });
      }

      const body: Record<string, unknown> = {
        model,
        messages,
        ...(request.maxOutputTokens && request.maxOutputTokens > 0
          ? { max_tokens: request.maxOutputTokens }
          : {}),
        ...(shouldUseJsonMode(request)
          ? { response_format: { type: "json_object" } }
          : {}),
      };

      const response = await this.fetchImpl(`${GROQ_API_BASE}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
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
          message: "Groq returned an invalid JSON envelope.",
          provider: "groq",
          statusCode: 502,
          code: "GROQ_INVALID_ENVELOPE",
          retryable: true,
          tier: request.tier,
          model,
        });
      }

      const choice = parsed?.choices?.[0];
      const outputText =
        typeof choice?.message?.content === "string"
          ? choice.message.content.trim()
          : "";

      const usageMeta = parsed?.usage;
      const usage = usageMeta
        ? {
            inputTokens: Number(usageMeta.prompt_tokens ?? 0),
            outputTokens: Number(usageMeta.completion_tokens ?? 0),
            totalTokens: Number(usageMeta.total_tokens ?? 0),
          }
        : null;

      return {
        id: parsed?.id || `groq_${crypto.randomUUID()}`,
        provider: "groq",
        model: parsed?.model || model,
        outputText,
        output: choice ? [choice] : [],
        usage,
        latencyMs: Date.now() - startedAt,
      };
    } catch (err: unknown) {
      if (err instanceof AIConfigError || err instanceof AIProviderError) {
        throw err;
      }

      if (didTimeout()) {
        throw new AIProviderError({
          message: `Groq request timed out after ${request.timeoutMs}ms.`,
          provider: "groq",
          statusCode: 504,
          code: "GROQ_TIMEOUT",
          retryable: true,
          tier: request.tier,
          model,
        });
      }

      if (err instanceof Error && err.name === "AbortError") {
        throw new AIProviderError({
          message: "Groq request was cancelled.",
          provider: "groq",
          statusCode: 499,
          code: "GROQ_CANCELLED",
          retryable: false,
          tier: request.tier,
          model,
        });
      }

      const safeMsg = redactSecrets(
        err instanceof Error ? err.message : "Groq request failed.",
        [apiKey]
      );
      throw new AIProviderError({
        message: `Groq connection error: ${safeMsg}`,
        provider: "groq",
        statusCode: 502,
        code: "GROQ_CONNECTION_ERROR",
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
    try {
      const json = JSON.parse(rawBody);
      providerMessage = json?.error?.message ?? rawBody;
    } catch {
      // leave rawBody
    }

    const safeMessage = redactSecrets(providerMessage, [apiKey]).slice(0, 300);

    if (status === 401 || status === 403) {
      return new AIProviderError({
        message: "Groq authentication failed. Check server-side GROQ_API_KEY configuration.",
        provider: "groq",
        statusCode: 502,
        code: "GROQ_AUTH_ERROR",
        retryable: false,
        tier,
        model,
      });
    }

    if (status === 429) {
      return new AIProviderError({
        message: "Groq free-tier rate limit or quota exceeded. Please retry shortly.",
        provider: "groq",
        statusCode: 429,
        code: "GROQ_QUOTA_EXHAUSTED",
        retryable: true,
        quotaExhausted: true,
        retryAfterMs,
        tier,
        model,
      });
    }

    if (status === 400 || status === 404 || status === 422) {
      return new AIProviderError({
        message: `Groq rejected the request (${status}): ${safeMessage || "invalid request"}`,
        provider: "groq",
        statusCode: 400,
        code: "GROQ_INVALID_REQUEST",
        retryable: false,
        tier,
        model,
      });
    }

    if (status >= 500) {
      return new AIProviderError({
        message: `Groq service error (${status}): ${safeMessage || "upstream unavailable"}`,
        provider: "groq",
        statusCode: 502,
        code: "GROQ_SERVER_ERROR",
        retryable: true,
        tier,
        model,
      });
    }

    return new AIProviderError({
      message: `Groq API error (${status}): ${safeMessage || "request failed"}`,
      provider: "groq",
      statusCode: 502,
      code: "GROQ_API_ERROR",
      retryable: status === 408,
      tier,
      model,
    });
  }
}

