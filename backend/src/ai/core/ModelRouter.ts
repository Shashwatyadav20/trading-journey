export type AITaskTier = "deep" | "balanced" | "fast";

export type AIProviderId = "gemini" | "groq" | "openai";

const VALID_PROVIDERS: ReadonlySet<string> = new Set(["gemini", "groq", "openai"]);

export function resolveActiveProvider(explicit?: AIProviderId): AIProviderId {
  if (explicit) {
    return explicit;
  }
  const envProvider = (process.env.AI_PROVIDER ?? "").trim().toLowerCase();
  if (envProvider) {
    if (!VALID_PROVIDERS.has(envProvider)) {
      throw new AIConfigError(
        `Invalid AI_PROVIDER "${envProvider}". Allowed values: gemini, groq, openai.`
      );
    }
    return envProvider as AIProviderId;
  }
  if ((process.env.GEMINI_API_KEY ?? "").trim()) {
    return "gemini";
  }
  if ((process.env.GROQ_API_KEY ?? "").trim()) {
    return "groq";
  }
  return "openai";
}

export type AIReasoningEffort = "none" | "minimal" | "low" | "medium" | "high" | "xhigh";

const VALID_REASONING_EFFORTS: ReadonlySet<string> = new Set([
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
]);

export interface ModelRouterConfig {
  deepModel: string;
  balancedModel: string;
  fastModel: string;
  defaultReasoningEffort: AIReasoningEffort;
  maxToolCalls: number;
  requestTimeoutMs: number;
}

export interface RoutedModelSelection {
  tier: AITaskTier;
  model: string;
  reasoningEffort: AIReasoningEffort;
  maxToolCalls: number;
  timeoutMs: number;
}

export interface ModelConfigValidationResult {
  valid: boolean;
  missing: string[];
  invalid: string[];
  models: Record<AITaskTier, string>;
  defaultReasoningEffort: string;
  maxToolCalls: number;
  requestTimeoutMs: number;
}

export class AIConfigError extends Error {
  public readonly statusCode = 503;
  public readonly code = "AI_CONFIGURATION_ERROR";

  constructor(message: string) {
    super(message);
    this.name = "AIConfigError";
  }
}

export interface ModelRouterOverrides {
  deepModel?: string;
  balancedModel?: string;
  fastModel?: string;
  reasoningEffort?: string;
  maxToolCalls?: number;
  requestTimeoutMs?: number;
}

function readEnvConfig(overrides?: ModelRouterOverrides): {
  deepModel: string;
  balancedModel: string;
  fastModel: string;
  reasoningEffortRaw: string;
  maxToolCallsRaw: number;
  requestTimeoutMsRaw: number;
} {
  const deepModel = (overrides?.deepModel ?? process.env.OPENAI_MODEL_DEEP ?? "").trim();
  const balancedModel = (overrides?.balancedModel ?? process.env.OPENAI_MODEL_BALANCED ?? "").trim();
  const fastModel = (overrides?.fastModel ?? process.env.OPENAI_MODEL_FAST ?? "").trim();
  const reasoningEffortRaw = (
    overrides?.reasoningEffort ??
    process.env.AI_REASONING_EFFORT ??
    "medium"
  )
    .trim()
    .toLowerCase();

  const maxToolCallsRaw =
    overrides?.maxToolCalls !== undefined
      ? overrides.maxToolCalls
      : Number(process.env.AI_MAX_TOOL_CALLS ?? "5");

  const requestTimeoutMsRaw =
    overrides?.requestTimeoutMs !== undefined
      ? overrides.requestTimeoutMs
      : Number(process.env.AI_REQUEST_TIMEOUT_MS ?? "30000");

  return {
    deepModel,
    balancedModel,
    fastModel,
    reasoningEffortRaw,
    maxToolCallsRaw,
    requestTimeoutMsRaw,
  };
}

/**
 * Routes AI tasks to the configured OpenAI model for `deep`, `balanced`, or `fast`
 * workloads and validates model/reasoning/timeout settings without storing secrets.
 */
export class ModelRouter {
  private readonly overrides?: ModelRouterOverrides;

  constructor(overrides?: ModelRouterOverrides) {
    this.overrides = overrides;
  }

  public validateConfiguration(): ModelConfigValidationResult {
    const cfg = readEnvConfig(this.overrides);
    const missing: string[] = [];
    const invalid: string[] = [];

    if (!cfg.deepModel) missing.push("OPENAI_MODEL_DEEP");
    if (!cfg.balancedModel) missing.push("OPENAI_MODEL_BALANCED");
    if (!cfg.fastModel) missing.push("OPENAI_MODEL_FAST");

    if (!VALID_REASONING_EFFORTS.has(cfg.reasoningEffortRaw)) {
      invalid.push("AI_REASONING_EFFORT");
    }

    if (!Number.isInteger(cfg.maxToolCallsRaw) || cfg.maxToolCallsRaw < 1 || cfg.maxToolCallsRaw > 50) {
      invalid.push("AI_MAX_TOOL_CALLS");
    }

    if (
      !Number.isFinite(cfg.requestTimeoutMsRaw) ||
      cfg.requestTimeoutMsRaw < 1000 ||
      cfg.requestTimeoutMsRaw > 300_000
    ) {
      invalid.push("AI_REQUEST_TIMEOUT_MS");
    }

    return {
      valid: missing.length === 0 && invalid.length === 0,
      missing,
      invalid,
      models: {
        deep: cfg.deepModel,
        balanced: cfg.balancedModel,
        fast: cfg.fastModel,
      },
      defaultReasoningEffort: cfg.reasoningEffortRaw,
      maxToolCalls: cfg.maxToolCallsRaw,
      requestTimeoutMs: cfg.requestTimeoutMsRaw,
    };
  }

  public selectModel(
    tier: AITaskTier,
    options?: {
      reasoningEffort?: AIReasoningEffort;
      maxToolCalls?: number;
      timeoutMs?: number;
    }
  ): RoutedModelSelection {
    const cfg = readEnvConfig(this.overrides);

    const tierEnvMap: Record<AITaskTier, { envName: string; model: string }> = {
      deep: { envName: "OPENAI_MODEL_DEEP", model: cfg.deepModel },
      balanced: { envName: "OPENAI_MODEL_BALANCED", model: cfg.balancedModel },
      fast: { envName: "OPENAI_MODEL_FAST", model: cfg.fastModel },
    };

    const selected = tierEnvMap[tier];
    if (!selected) {
      throw new AIConfigError(`Unsupported AI task tier: "${String(tier)}"`);
    }
    if (!selected.model) {
      throw new AIConfigError(
        `Missing OpenAI model configuration: ${selected.envName} is not set.`
      );
    }

    const baseEffort: AIReasoningEffort = VALID_REASONING_EFFORTS.has(cfg.reasoningEffortRaw)
      ? (cfg.reasoningEffortRaw as AIReasoningEffort)
      : "medium";

    let resolvedEffort: AIReasoningEffort = options?.reasoningEffort ?? baseEffort;
    if (options?.reasoningEffort && !VALID_REASONING_EFFORTS.has(options.reasoningEffort)) {
      throw new AIConfigError(
        `Invalid reasoning effort "${options.reasoningEffort}".`
      );
    }
    if (!options?.reasoningEffort && tier === "fast" && baseEffort !== "none" && baseEffort !== "minimal") {
      resolvedEffort = "low";
    }

    const maxToolCalls = options?.maxToolCalls ?? cfg.maxToolCallsRaw;
    if (!Number.isInteger(maxToolCalls) || maxToolCalls < 1 || maxToolCalls > 50) {
      throw new AIConfigError(
        "Invalid AI_MAX_TOOL_CALLS configuration: must be an integer between 1 and 50."
      );
    }

    const timeoutMs = options?.timeoutMs ?? cfg.requestTimeoutMsRaw;
    if (!Number.isFinite(timeoutMs) || timeoutMs < 1000 || timeoutMs > 300_000) {
      throw new AIConfigError(
        "Invalid AI_REQUEST_TIMEOUT_MS configuration: must be between 1000 and 300000 ms."
      );
    }

    return {
      tier,
      model: selected.model,
      reasoningEffort: resolvedEffort,
      maxToolCalls,
      timeoutMs,
    };
  }

  public getExecutionSettings(
    tier: AITaskTier,
    options?: {
      reasoningEffort?: AIReasoningEffort;
      maxToolCalls?: number;
      timeoutMs?: number;
    }
  ): {
    reasoningEffort: AIReasoningEffort;
    maxToolCalls: number;
    timeoutMs: number;
    invalid: string[];
  } {
    const cfg = readEnvConfig(this.overrides);
    const invalid: string[] = [];

    if (!VALID_REASONING_EFFORTS.has(cfg.reasoningEffortRaw)) {
      invalid.push("AI_REASONING_EFFORT");
    }
    if (!Number.isInteger(cfg.maxToolCallsRaw) || cfg.maxToolCallsRaw < 1 || cfg.maxToolCallsRaw > 50) {
      invalid.push("AI_MAX_TOOL_CALLS");
    }
    if (!Number.isFinite(cfg.requestTimeoutMsRaw) || cfg.requestTimeoutMsRaw < 1000 || cfg.requestTimeoutMsRaw > 300_000) {
      invalid.push("AI_REQUEST_TIMEOUT_MS");
    }

    const baseEffort: AIReasoningEffort = VALID_REASONING_EFFORTS.has(cfg.reasoningEffortRaw)
      ? (cfg.reasoningEffortRaw as AIReasoningEffort)
      : "medium";
    let resolvedEffort: AIReasoningEffort = options?.reasoningEffort ?? baseEffort;
    if (options?.reasoningEffort && !VALID_REASONING_EFFORTS.has(options.reasoningEffort)) {
      throw new AIConfigError(`Invalid reasoning effort "${options.reasoningEffort}".`);
    }
    if (!options?.reasoningEffort && tier === "fast" && baseEffort !== "none" && baseEffort !== "minimal") {
      resolvedEffort = "low";
    }

    const maxToolCalls = options?.maxToolCalls ?? cfg.maxToolCallsRaw;
    if (!Number.isInteger(maxToolCalls) || maxToolCalls < 1 || maxToolCalls > 50) {
      throw new AIConfigError(
        "Invalid AI_MAX_TOOL_CALLS configuration: must be an integer between 1 and 50."
      );
    }

    const timeoutMs = options?.timeoutMs ?? cfg.requestTimeoutMsRaw;
    if (!Number.isFinite(timeoutMs) || timeoutMs < 1000 || timeoutMs > 300_000) {
      throw new AIConfigError(
        "Invalid AI_REQUEST_TIMEOUT_MS configuration: must be between 1000 and 300000 ms."
      );
    }

    return {
      reasoningEffort: resolvedEffort,
      maxToolCalls,
      timeoutMs,
      invalid,
    };
  }
}

export function createModelRouter(overrides?: ModelRouterOverrides): ModelRouter {
  return new ModelRouter(overrides);
}

export const modelRouter = new ModelRouter();

