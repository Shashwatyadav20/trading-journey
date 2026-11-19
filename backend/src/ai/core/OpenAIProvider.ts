import OpenAI from "openai";
import type {
  ResponseCreateParamsNonStreaming,
  Tool,
} from "openai/resources/responses/responses";
import {
  AIConfigError,
  AITaskTier,
  ModelRouter,
  ModelRouterOverrides,
  createModelRouter,
  modelRouter as defaultModelRouter,
} from "./ModelRouter";
import {
  AIProvider,
  AIProviderConfigValidation,
  AIProviderError,
  AIProviderRequest,
  AIProviderResponse,
  createCombinedAbortController,
  redactSecrets,
} from "./AIProvider";

export interface OpenAIProviderOptions {
  apiKey?: string;
  router?: ModelRouter;
  routerOverrides?: ModelRouterOverrides;
  clientOverride?: OpenAI;
}

export class OpenAIProvider implements AIProvider {
  public readonly name = "openai" as const;
  private readonly explicitApiKey?: string;
  private readonly router: ModelRouter;
  private readonly clientOverride?: OpenAI;
  private cachedClient: OpenAI | null = null;
  private cachedApiKey = "";

  public constructor(options: OpenAIProviderOptions = {}) {
    this.explicitApiKey = options.apiKey;
    this.router =
      options.router ??
      (options.routerOverrides
        ? createModelRouter(options.routerOverrides)
        : defaultModelRouter);
    this.clientOverride = options.clientOverride;
  }

  private resolveApiKey(): string {
    return (this.explicitApiKey ?? process.env.OPENAI_API_KEY ?? "").trim();
  }

  public isApiKeyConfigured(): boolean {
    return this.resolveApiKey().length > 0;
  }

  public resolveModel(tier: AITaskTier): string {
    const validation = this.router.validateConfiguration();
    return validation.models[tier];
  }

  public validateConfiguration(): AIProviderConfigValidation {
    const apiKeyConfigured = this.isApiKeyConfigured();
    const modelValidation = this.router.validateConfiguration();
    const missing = [...modelValidation.missing];
    if (!apiKeyConfigured) {
      missing.unshift("OPENAI_API_KEY");
    }

    return {
      valid: apiKeyConfigured && modelValidation.valid,
      apiKeyConfigured,
      missing,
      invalid: modelValidation.invalid,
      models: modelValidation.models,
    };
  }

  private getSDKClient(): OpenAI {
    if (this.clientOverride) {
      return this.clientOverride;
    }

    const apiKey = this.resolveApiKey();
    if (!apiKey) {
      throw new AIConfigError(
        "Missing OpenAI API key: OPENAI_API_KEY is not configured on the backend."
      );
    }

    if (!this.cachedClient || this.cachedApiKey !== apiKey) {
      this.cachedClient = new OpenAI({
        apiKey,
        maxRetries: 1,
      });
      this.cachedApiKey = apiKey;
    }
    return this.cachedClient;
  }

  public async generateResponse(
    request: AIProviderRequest
  ): Promise<AIProviderResponse> {
    const routed = this.router.selectModel(request.tier, {
      reasoningEffort: request.reasoningEffort,
      maxToolCalls: request.maxToolCalls,
      timeoutMs: request.timeoutMs,
    });

    const apiKey = this.resolveApiKey();
    const client = this.getSDKClient();
    const { controller, didTimeout, cleanup } = createCombinedAbortController(
      routed.timeoutMs,
      request.signal
    );

    const startedAt = Date.now();
    try {
      const payload: ResponseCreateParamsNonStreaming = {
        model: request.model || routed.model,
        input: request.input as ResponseCreateParamsNonStreaming["input"],
        ...(request.instructions ? { instructions: request.instructions } : {}),
        ...(request.tools && request.tools.length > 0
          ? { tools: request.tools as Tool[] }
          : {}),
        ...(request.maxOutputTokens
          ? { max_output_tokens: request.maxOutputTokens }
          : {}),
        ...(request.metadata ? { metadata: request.metadata } : {}),
        max_tool_calls: routed.maxToolCalls,
        reasoning: { effort: routed.reasoningEffort },
      };

      const response = await client.responses.create(payload, {
        timeout: routed.timeoutMs,
        signal: controller.signal,
      });

      const latencyMs = Date.now() - startedAt;
      const usage = response.usage
        ? {
            inputTokens: response.usage.input_tokens ?? 0,
            outputTokens: response.usage.output_tokens ?? 0,
            totalTokens: response.usage.total_tokens ?? 0,
          }
        : null;

      return {
        id: response.id,
        provider: "openai",
        model: response.model || routed.model,
        outputText: response.output_text || "",
        output: response.output || [],
        usage,
        latencyMs,
      };
    } catch (err: unknown) {
      throw this.mapProviderError(
        err,
        request.tier,
        routed.model,
        routed.timeoutMs,
        didTimeout(),
        apiKey
      );
    } finally {
      cleanup();
    }
  }

  private mapProviderError(
    err: unknown,
    tier: AITaskTier,
    model: string,
    timeoutMs: number,
    timedOut: boolean,
    apiKey: string
  ): AIProviderError | AIConfigError {
    if (err instanceof AIConfigError || err instanceof AIProviderError) {
      return err;
    }

    const knownSecrets = apiKey ? [apiKey] : [];
    const rawMsg =
      err instanceof Error ? err.message : "OpenAI provider request failed.";
    const safeRawMsg = redactSecrets(rawMsg, knownSecrets);

    if (
      timedOut ||
      err instanceof OpenAI.APIConnectionTimeoutError ||
      (err instanceof Error && err.name === "AbortError")
    ) {
      return new AIProviderError({
        message: `OpenAI request timed out after ${timeoutMs}ms.`,
        provider: "openai",
        statusCode: 504,
        code: "OPENAI_TIMEOUT",
        retryable: true,
        tier,
        model,
      });
    }

    if (err instanceof OpenAI.AuthenticationError) {
      return new AIProviderError({
        message:
          "OpenAI authentication failed. Check server-side OPENAI_API_KEY configuration.",
        provider: "openai",
        statusCode: 502,
        code: "OPENAI_AUTH_ERROR",
        retryable: false,
        tier,
        model,
      });
    }

    if (err instanceof OpenAI.RateLimitError) {
      return new AIProviderError({
        message: "OpenAI rate limit or quota exceeded. Please retry shortly.",
        provider: "openai",
        statusCode: 429,
        code: "OPENAI_RATE_LIMIT",
        retryable: true,
        quotaExhausted: true,
        tier,
        model,
      });
    }

    if (err instanceof OpenAI.APIError) {
      const status = typeof err.status === "number" ? err.status : 502;
      return new AIProviderError({
        message: `OpenAI API error (${status}): ${safeRawMsg}`,
        provider: "openai",
        statusCode: status >= 400 && status < 600 ? status : 502,
        code: err.code ? String(err.code) : "OPENAI_API_ERROR",
        retryable: status >= 500 || status === 429,
        quotaExhausted: status === 429,
        tier,
        model,
      });
    }

    return new AIProviderError({
      message: `OpenAI provider failure: ${safeRawMsg}`,
      provider: "openai",
      statusCode: 502,
      code: "OPENAI_PROVIDER_ERROR",
      retryable: true,
      tier,
      model,
    });
  }
}

