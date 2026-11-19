import OpenAI from "openai";
import type {
  Response as OpenAIResponse,
  ResponseCreateParamsNonStreaming,
  Tool,
} from "openai/resources/responses/responses";
import {
  AIConfigError,
  AIReasoningEffort,
  AITaskTier,
  ModelRouter,
  ModelRouterOverrides,
  createModelRouter,
  modelRouter as defaultModelRouter,
  resolveActiveProvider,
} from "./ModelRouter";
import {
  AIProvider,
  AIProviderError,
  AIProviderName,
  AIProviderResponseFormat,
  redactSecrets,
} from "./AIProvider";
import { GeminiProvider } from "./GeminiProvider";
import { GroqProvider } from "./GroqProvider";
import { OpenAIProvider } from "./OpenAIProvider";
import {
  ProviderRateLimitState,
  RateLimitManager,
  rateLimitManager as defaultRateLimitManager,
} from "./RateLimitManager";
import { AIStagingConfig, getAIStagingConfig } from "./StagingConfig";

export { AIProviderError, redactSecrets };

export interface OpenAIResponseRequest {
  tier?: AITaskTier;
  input: ResponseCreateParamsNonStreaming["input"];
  instructions?: string;
  tools?: Tool[];
  maxOutputTokens?: number;
  reasoningEffort?: AIReasoningEffort;
  maxToolCalls?: number;
  timeoutMs?: number;
  deadlineAtMs?: number;
  queueTimeoutMs?: number;
  responseFormat?: AIProviderResponseFormat;
  metadata?: Record<string, string>;
  signal?: AbortSignal;
}

export interface OpenAIResponseResult {
  id: string;
  provider?: AIProviderName;
  fallbackUsed?: boolean;
  fallbackFrom?: AIProviderName;
  tier: AITaskTier;
  model: string;
  outputText: string;
  output: OpenAIResponse["output"] | unknown[];
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  } | null;
  latencyMs: number;
}

export interface AIHealthCheckResult {
  ok: boolean;
  provider: AIProviderName;
  primaryProvider: AIProviderName;
  primaryModel: string;
  primaryReachable: boolean | null;
  primaryError: string | null;
  fallbackProvider: AIProviderName | null;
  fallbackModel: string | null;
  fallbackReachable: boolean | null;
  fallbackError: string | null;
  fallbackConfigured: boolean;
  configured: boolean;
  apiKeyConfigured: boolean;
  models: Record<AITaskTier, string>;
  missingConfig: string[];
  invalidConfig: string[];
  defaultReasoningEffort: string;
  maxToolCalls: number;
  requestTimeoutMs: number;
  verifiedModels?: string[];
  configuredModelsAvailable?: boolean | null;
  unavailableModels?: string[];
  rateLimitStates?: Record<AIProviderName, ProviderRateLimitState>;
  lastSuccessfulProvider?: AIProviderName | null;
  stagingConfig?: AIStagingConfig;
  livePing?: {
    executed: boolean;
    reachable: boolean;
    provider: AIProviderName;
    fallbackUsed?: boolean;
    fallbackFrom?: AIProviderName;
    tier: AITaskTier;
    model: string;
    latencyMs?: number;
    responseId?: string;
    error?: string;
  };
  timestamp: string;
}

export interface OpenAIClientServiceOptions {
  apiKey?: string;
  router?: ModelRouter;
  routerOverrides?: ModelRouterOverrides;
  clientOverride?: OpenAI;
  provider?: AIProviderName;
  fallbackProvider?: AIProviderName | null;
  providers?: Partial<Record<AIProviderName, AIProvider>>;
  enableFallback?: boolean;
  rateLimitManager?: RateLimitManager;
}

function assertBackendOnly(): void {
  if (typeof window !== "undefined") {
    throw new Error(
      "OpenAIClientService must only be initialized and used on the backend."
    );
  }
}

export class OpenAIClientService {
  private readonly explicitProvider?: AIProviderName;
  private readonly explicitFallbackProvider?: AIProviderName | null;
  private readonly enableFallback: boolean;
  private readonly forceOpenAI: boolean;
  private readonly router: ModelRouter;
  private readonly providerMap: Record<AIProviderName, AIProvider>;
  private readonly rateLimiter: RateLimitManager;

  constructor(options?: OpenAIClientServiceOptions) {
    assertBackendOnly();
    this.router =
      options?.router ??
      (options?.routerOverrides
        ? createModelRouter(options.routerOverrides)
        : defaultModelRouter);

    this.forceOpenAI =
      options?.clientOverride !== undefined || options?.apiKey !== undefined;
    this.explicitProvider = this.forceOpenAI ? "openai" : options?.provider;
    this.explicitFallbackProvider = this.forceOpenAI
      ? null
      : options?.fallbackProvider;
    this.enableFallback = this.forceOpenAI
      ? false
      : (options?.enableFallback ?? true);

    this.rateLimiter =
      options?.rateLimitManager ??
      (options
        ? new RateLimitManager({
            transientMaxRetries: this.forceOpenAI ? 0 : undefined,
          })
        : defaultRateLimitManager);

    this.providerMap = {
      gemini: options?.providers?.gemini ?? new GeminiProvider(),
      groq: options?.providers?.groq ?? new GroqProvider(),
      openai:
        options?.providers?.openai ??
        new OpenAIProvider({
          apiKey: options?.apiKey,
          router: this.router,
          clientOverride: options?.clientOverride,
        }),
    };
  }

  private getPrimaryProviderName(): AIProviderName {
    return resolveActiveProvider(this.explicitProvider);
  }

  private getFallbackProviderName(primary: AIProviderName): AIProviderName | null {
    if (!this.enableFallback) {
      return null;
    }
    if (this.explicitFallbackProvider !== undefined) {
      return this.explicitFallbackProvider === primary
        ? null
        : this.explicitFallbackProvider;
    }
    // Primary Gemini -> optional Groq fallback when GROQ_API_KEY is configured.
    // Never auto-fallback to paid OpenAI unless explicitly requested.
    if (primary === "gemini" && this.providerMap.groq.isApiKeyConfigured()) {
      return "groq";
    }
    return null;
  }

  public isApiKeyConfigured(): boolean {
    const primary = this.getPrimaryProviderName();
    return this.providerMap[primary].isApiKeyConfigured();
  }

  /**
   * Executes a backend-only AI request via the configured primary provider
   * (`gemini` -> optional `groq` fallback, or optional `openai`), with strict
   * timeout enforcement, secret redaction, and explicit fallback only on
   * retryable failures.
   */
  public async createResponse(
    request: OpenAIResponseRequest
  ): Promise<OpenAIResponseResult> {
    assertBackendOnly();
    const requestStartedAt = Date.now();
    const tier: AITaskTier = request.tier ?? "balanced";
    const primaryName = this.getPrimaryProviderName();
    const primaryProvider = this.providerMap[primaryName];
    const execSettings = this.router.getExecutionSettings(tier, {
      reasoningEffort: request.reasoningEffort,
      maxToolCalls: request.maxToolCalls,
      timeoutMs: request.timeoutMs,
    });

    const effectiveDeadlineAtMs =
      request.deadlineAtMs ?? requestStartedAt + execSettings.timeoutMs;
    const overallBudgetMs = Math.max(0, effectiveDeadlineAtMs - requestStartedAt);
    const primaryModel = primaryProvider.resolveModel(tier);
    if (request.deadlineAtMs !== undefined && overallBudgetMs <= 0) {
      throw new AIProviderError({
        message: "AI request deadline exceeded before provider execution.",
        provider: primaryName,
        statusCode: 504,
        code: "DEADLINE_EXCEEDED",
        retryable: false,
        tier,
        model: primaryModel,
      });
    }
    const fallbackName = this.getFallbackProviderName(primaryName);
    const maxAttempts = getAIStagingConfig().maxProviderAttempts;
    const canFallback = Boolean(
      fallbackName &&
        maxAttempts > 1 &&
        !this.rateLimiter.isInCooldown(fallbackName)
    );

    // Reserve explicit fallback headroom when a healthy fallback provider is available
    // so a hanging primary attempt cannot consume the entire agent deadline.
    const primaryTimeoutMs =
      canFallback && overallBudgetMs >= 5_000
        ? Math.max(2_500, Math.min(execSettings.timeoutMs, Math.floor(overallBudgetMs * 0.55)))
        : Math.min(execSettings.timeoutMs, Math.max(500, overallBudgetMs));
    const primaryDeadlineAtMs = Math.min(
      effectiveDeadlineAtMs,
      Date.now() + primaryTimeoutMs
    );
    const primaryQueueTimeoutMs = Math.min(
      request.queueTimeoutMs ?? 4_000,
      Math.max(400, Math.floor(primaryTimeoutMs * 0.4))
    );

    try {
      if (this.rateLimiter.isInCooldown(primaryName)) {
        const remainingMs = this.rateLimiter.getCooldownRemainingMs(primaryName);
        throw new AIProviderError({
          message: `${primaryName} is in rate-limit cooldown (${Math.ceil(remainingMs / 1000)}s remaining).`,
          provider: primaryName,
          statusCode: 429,
          code: "PROVIDER_COOLDOWN",
          retryable: true,
          quotaExhausted: true,
          retryAfterMs: remainingMs,
          tier,
          model: primaryModel,
        });
      }

      const res = await this.rateLimiter.executeWithQueueAndRetry(
        primaryName,
        () => {
          const attemptRemaining = Math.max(250, primaryDeadlineAtMs - Date.now());
          return primaryProvider.generateResponse({
            tier,
            model: primaryModel,
            input: request.input,
            instructions: request.instructions,
            tools: request.tools,
            maxOutputTokens: request.maxOutputTokens,
            reasoningEffort: execSettings.reasoningEffort,
            maxToolCalls: execSettings.maxToolCalls,
            timeoutMs: Math.min(primaryTimeoutMs, attemptRemaining),
            responseFormat: request.responseFormat,
            metadata: request.metadata,
            signal: request.signal,
          });
        },
        request.signal,
        {
          queueTimeoutMs: primaryQueueTimeoutMs,
          deadlineAtMs: primaryDeadlineAtMs,
          maxRetries: canFallback ? 0 : undefined,
        }
      );

      this.logCompletion(res, tier, false);

      return {
        id: res.id,
        provider: res.provider,
        fallbackUsed: false,
        tier,
        model: res.model,
        outputText: res.outputText,
        output: res.output,
        usage: res.usage,
        latencyMs: res.latencyMs,
      };
    } catch (primaryErr: unknown) {
      const isRetryable =
        primaryErr instanceof AIProviderError && primaryErr.retryable;

      if (primaryErr instanceof AIProviderError) {
        console.warn(
          `[AIClient] provider=${primaryName} model=${primaryModel} tier=${tier} status=${primaryErr.statusCode} code=${primaryErr.code} retryable=${primaryErr.retryable} fallback=${fallbackName ?? "none"} message="${redactSecrets(primaryErr.message)}"`
        );
      }

      if (!fallbackName || !isRetryable || maxAttempts <= 1) {
        throw primaryErr;
      }

      const fallbackProvider = this.providerMap[fallbackName];
      const fallbackModel = fallbackProvider.resolveModel(tier);

      if (this.rateLimiter.isInCooldown(fallbackName)) {
        const remainingMs = this.rateLimiter.getCooldownRemainingMs(fallbackName);
        throw new AIProviderError({
          message: `All AI providers are currently rate-limited (${primaryName}: ${
            primaryErr instanceof Error ? primaryErr.message : "error"
          }; ${fallbackName} in cooldown for ${Math.ceil(remainingMs / 1000)}s).`,
          provider: fallbackName,
          statusCode: 429,
          code: "ALL_PROVIDERS_RATE_LIMITED",
          retryable: false,
          quotaExhausted: true,
          retryAfterMs: remainingMs,
          tier,
          model: fallbackModel,
        });
      }

      const remainingBudgetMs = Math.max(0, effectiveDeadlineAtMs - Date.now());
      if (remainingBudgetMs < 500) {
        throw new AIProviderError({
          message: `Insufficient remaining deadline (${remainingBudgetMs}ms) for fallback provider ${fallbackName}.`,
          provider: fallbackName,
          statusCode: 504,
          code: "DEADLINE_EXCEEDED",
          retryable: false,
          tier,
          model: fallbackModel,
        });
      }

      const fallbackTimeoutMs = Math.min(execSettings.timeoutMs, remainingBudgetMs);
      const fallbackQueueTimeoutMs = Math.min(
        request.queueTimeoutMs ?? 4_000,
        Math.max(400, Math.floor(fallbackTimeoutMs * 0.45))
      );

      const fallbackRes = await this.rateLimiter.executeWithQueueAndRetry(
        fallbackName,
        () => {
          const attemptRemaining = Math.max(250, effectiveDeadlineAtMs - Date.now());
          return fallbackProvider.generateResponse({
            tier,
            model: fallbackModel,
            input: request.input,
            instructions: request.instructions,
            tools: request.tools,
            maxOutputTokens: request.maxOutputTokens,
            reasoningEffort: execSettings.reasoningEffort,
            maxToolCalls: execSettings.maxToolCalls,
            timeoutMs: Math.min(fallbackTimeoutMs, attemptRemaining),
            responseFormat: request.responseFormat,
            metadata: request.metadata,
            signal: request.signal,
          });
        },
        request.signal,
        {
          queueTimeoutMs: fallbackQueueTimeoutMs,
          deadlineAtMs: effectiveDeadlineAtMs,
          maxRetries: 0,
        }
      );

      this.logCompletion(fallbackRes, tier, true, primaryName);

      return {
        id: fallbackRes.id,
        provider: fallbackRes.provider,
        fallbackUsed: true,
        fallbackFrom: primaryName,
        tier,
        model: fallbackRes.model,
        outputText: fallbackRes.outputText,
        output: fallbackRes.output,
        usage: fallbackRes.usage,
        latencyMs: fallbackRes.latencyMs,
      };
    }
  }

  private logCompletion(
    res: {
      provider: AIProviderName;
      model: string;
      latencyMs: number;
      usage: { inputTokens: number; outputTokens: number; totalTokens: number } | null;
    },
    tier: AITaskTier,
    fallbackUsed: boolean,
    fallbackFrom?: AIProviderName
  ): void {
    const tokens = res.usage ? res.usage.totalTokens : "n/a";
    console.info(
      `[AIClient] provider=${res.provider} model=${res.model} tier=${tier} latencyMs=${res.latencyMs} totalTokens=${tokens} fallbackUsed=${fallbackUsed}${fallbackFrom ? ` fallbackFrom=${fallbackFrom}` : ""}`
    );
  }

  /**
   * Checks active AI provider configuration and optionally executes a lightweight
   * `fast`-tier ping. Never exposes API keys in output.
   */
  public async checkHealth(options?: {
    runLivePing?: boolean;
    verifyModels?: boolean;
  }): Promise<AIHealthCheckResult> {
    let primaryName: AIProviderName = "gemini";
    let configError: string | null = null;
    try {
      primaryName = this.getPrimaryProviderName();
    } catch (err) {
      configError = err instanceof Error ? err.message : "Invalid AI_PROVIDER";
    }

    const primaryProvider = this.providerMap[primaryName];
    const fallbackName = this.getFallbackProviderName(primaryName);
    const providerValidation = primaryProvider.validateConfiguration();
    const routerValidation = this.router.validateConfiguration();

    const invalidConfig = [...providerValidation.invalid];
    if (configError) {
      invalidConfig.push("AI_PROVIDER");
    }
    for (const inv of routerValidation.invalid) {
      if (!invalidConfig.includes(inv)) {
        invalidConfig.push(inv);
      }
    }

    const configured =
      !configError &&
      providerValidation.valid &&
      invalidConfig.length === 0;

    const shouldVerifyModels =
      options?.verifyModels === true ||
      (options?.runLivePing === true && options?.verifyModels !== false);

    let verifiedModels: string[] | undefined;
    let configuredModelsAvailable: boolean | null | undefined;
    let unavailableModels: string[] | undefined;

    if (shouldVerifyModels && configured && primaryProvider.listAvailableModels) {
      try {
        verifiedModels = await primaryProvider.listAvailableModels(8000);
        const availableSet = new Set(verifiedModels);
        const configuredUnique = Array.from(
          new Set(Object.values(providerValidation.models).filter(Boolean))
        );
        unavailableModels = configuredUnique.filter((m) => !availableSet.has(m));
        configuredModelsAvailable =
          verifiedModels.length > 0 && unavailableModels.length === 0;
      } catch {
        verifiedModels = [];
        configuredModelsAvailable = false;
        unavailableModels = Array.from(
          new Set(Object.values(providerValidation.models).filter(Boolean))
        );
      }
    }

    const fallbackModel = fallbackName
      ? this.providerMap[fallbackName].resolveModel("fast")
      : null;
    const fallbackConfigured = Boolean(
      fallbackName && this.providerMap[fallbackName].isApiKeyConfigured()
    );

    const configuredMap: Partial<Record<AIProviderName, boolean>> = {
      gemini: this.providerMap.gemini.isApiKeyConfigured(),
      groq: this.providerMap.groq.isApiKeyConfigured(),
      openai: this.providerMap.openai.isApiKeyConfigured(),
    };

    const base: AIHealthCheckResult = {
      ok: configured,
      provider: primaryName,
      primaryProvider: primaryName,
      primaryModel: providerValidation.models.fast,
      primaryReachable: null,
      primaryError: null,
      fallbackProvider: fallbackName,
      fallbackModel,
      fallbackReachable: null,
      fallbackError: null,
      fallbackConfigured,
      configured,
      apiKeyConfigured: providerValidation.apiKeyConfigured,
      models: providerValidation.models,
      missingConfig: providerValidation.missing,
      invalidConfig,
      defaultReasoningEffort: routerValidation.defaultReasoningEffort,
      maxToolCalls: routerValidation.maxToolCalls,
      requestTimeoutMs: routerValidation.requestTimeoutMs,
      ...(verifiedModels !== undefined ? { verifiedModels } : {}),
      ...(configuredModelsAvailable !== undefined
        ? { configuredModelsAvailable }
        : { configuredModelsAvailable: null }),
      ...(unavailableModels !== undefined ? { unavailableModels } : {}),
      rateLimitStates: this.rateLimiter.getAllProviderStates(configuredMap),
      lastSuccessfulProvider: this.rateLimiter.getLastSuccessfulProvider(),
      stagingConfig: getAIStagingConfig(),
      timestamp: new Date().toISOString(),
    };

    if (!options?.runLivePing) {
      return base;
    }

    if (!configured) {
      const configErrMsg =
        configError ??
        `AI client is not fully configured. Missing: ${providerValidation.missing.join(", ") || "none"}.`;
      return {
        ...base,
        ok: false,
        primaryReachable: false,
        primaryError: configErrMsg,
        livePing: {
          executed: false,
          reachable: false,
          provider: primaryName,
          tier: "fast",
          model: providerValidation.models.fast,
          error: configErrMsg,
        },
      };
    }

    const execSettings = this.router.getExecutionSettings("fast");
    let primaryReachable = false;
    let primaryError: string | null = null;
    let primaryRetryable = false;

    try {
      if (this.rateLimiter.isInCooldown(primaryName)) {
        const remainingMs = this.rateLimiter.getCooldownRemainingMs(primaryName);
        throw new AIProviderError({
          message: `${primaryName} is in rate-limit cooldown (${Math.ceil(remainingMs / 1000)}s remaining).`,
          provider: primaryName,
          statusCode: 429,
          code: "PROVIDER_COOLDOWN",
          retryable: true,
          quotaExhausted: true,
          retryAfterMs: remainingMs,
          tier: "fast",
          model: providerValidation.models.fast,
        });
      }

      const primaryRes = await this.rateLimiter.executeWithQueueAndRetry(
        primaryName,
        () =>
          primaryProvider.generateResponse({
            tier: "fast",
            model: providerValidation.models.fast,
            input: "Respond with OK.",
            responseFormat: "text",
            maxOutputTokens: 128,
            reasoningEffort: execSettings.reasoningEffort,
            maxToolCalls: execSettings.maxToolCalls,
            timeoutMs: execSettings.timeoutMs,
          })
      );

      if (!primaryRes.outputText || primaryRes.outputText.trim().length === 0) {
        primaryReachable = false;
        primaryError = `${primaryName} returned an empty text-generation response.`;
        primaryRetryable = true;
      } else {
        primaryReachable = true;
        return {
          ...base,
          ok: true,
          primaryReachable: true,
          primaryError: null,
          rateLimitStates: this.rateLimiter.getAllProviderStates(configuredMap),
          lastSuccessfulProvider: this.rateLimiter.getLastSuccessfulProvider(),
          livePing: {
            executed: true,
            reachable: true,
            provider: primaryRes.provider,
            fallbackUsed: false,
            tier: "fast",
            model: primaryRes.model,
            latencyMs: primaryRes.latencyMs,
            responseId: primaryRes.id,
          },
        };
      }
    } catch (err: unknown) {
      primaryReachable = false;
      primaryRetryable = err instanceof AIProviderError && err.retryable;
      primaryError =
        err instanceof AIProviderError || err instanceof AIConfigError
          ? err.message
          : redactSecrets(
              err instanceof Error ? err.message : "Unknown provider error"
            );
    }

    // Primary failed; preserve primaryError and probe fallback separately if configured & retryable.
    let fallbackReachable: boolean | null = null;
    let fallbackError: string | null = null;

    if (fallbackName && fallbackConfigured && primaryRetryable) {
      const fallbackProvider = this.providerMap[fallbackName];
      const fbModel = fallbackProvider.resolveModel("fast");
      try {
        if (this.rateLimiter.isInCooldown(fallbackName)) {
          const remainingMs = this.rateLimiter.getCooldownRemainingMs(fallbackName);
          throw new AIProviderError({
            message: `${fallbackName} is in rate-limit cooldown (${Math.ceil(remainingMs / 1000)}s remaining).`,
            provider: fallbackName,
            statusCode: 429,
            code: "PROVIDER_COOLDOWN",
            retryable: false,
            quotaExhausted: true,
            retryAfterMs: remainingMs,
            tier: "fast",
            model: fbModel,
          });
        }

        const fbRes = await this.rateLimiter.executeWithQueueAndRetry(
          fallbackName,
          () =>
            fallbackProvider.generateResponse({
              tier: "fast",
              model: fbModel,
              input: "Respond with OK.",
              responseFormat: "text",
              maxOutputTokens: 128,
              reasoningEffort: execSettings.reasoningEffort,
              maxToolCalls: execSettings.maxToolCalls,
              timeoutMs: execSettings.timeoutMs,
            })
        );

        if (!fbRes.outputText || fbRes.outputText.trim().length === 0) {
          fallbackReachable = false;
          fallbackError = `${fallbackName} returned an empty text-generation response.`;
        } else {
          fallbackReachable = true;
          return {
            ...base,
            ok: true,
            primaryReachable,
            primaryError,
            fallbackReachable: true,
            fallbackError: null,
            rateLimitStates: this.rateLimiter.getAllProviderStates(configuredMap),
            lastSuccessfulProvider: this.rateLimiter.getLastSuccessfulProvider(),
            livePing: {
              executed: true,
              reachable: true,
              provider: fbRes.provider,
              fallbackUsed: true,
              fallbackFrom: primaryName,
              tier: "fast",
              model: fbRes.model,
              latencyMs: fbRes.latencyMs,
              responseId: fbRes.id,
            },
          };
        }
      } catch (fbErr: unknown) {
        fallbackReachable = false;
        fallbackError =
          fbErr instanceof AIProviderError || fbErr instanceof AIConfigError
            ? fbErr.message
            : redactSecrets(
                fbErr instanceof Error ? fbErr.message : "Unknown fallback error"
              );
      }
    }

    return {
      ...base,
      ok: false,
      primaryReachable,
      primaryError,
      fallbackReachable,
      fallbackError,
      rateLimitStates: this.rateLimiter.getAllProviderStates(configuredMap),
      lastSuccessfulProvider: this.rateLimiter.getLastSuccessfulProvider(),
      livePing: {
        executed: true,
        reachable: false,
        provider: primaryName,
        fallbackUsed: fallbackReachable !== null,
        tier: "fast",
        model: providerValidation.models.fast,
        error: primaryError ?? "Primary provider unreachable.",
      },
    };
  }
}

export function createOpenAIClient(
  options?: OpenAIClientServiceOptions
): OpenAIClientService {
  return new OpenAIClientService(options);
}

export const openAIClient = new OpenAIClientService();
