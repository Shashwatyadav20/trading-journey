import type { AIReasoningEffort, AITaskTier } from "./ModelRouter";

export type AIProviderName = "gemini" | "groq" | "openai";

export type AIProviderResponseFormat = "json" | "text";

export interface AIProviderUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface AIProviderRequest {
  tier: AITaskTier;
  model: string;
  input: unknown;
  instructions?: string;
  tools?: unknown[];
  maxOutputTokens?: number;
  reasoningEffort?: AIReasoningEffort;
  maxToolCalls?: number;
  timeoutMs: number;
  responseFormat?: AIProviderResponseFormat;
  metadata?: Record<string, string>;
  signal?: AbortSignal;
}

export interface AIProviderResponse {
  id: string;
  provider: AIProviderName;
  model: string;
  outputText: string;
  output: unknown[];
  usage: AIProviderUsage | null;
  latencyMs: number;
}

export interface AIProviderConfigValidation {
  valid: boolean;
  apiKeyConfigured: boolean;
  missing: string[];
  invalid: string[];
  models: Record<AITaskTier, string>;
}

export interface AIProvider {
  readonly name: AIProviderName;
  isApiKeyConfigured(): boolean;
  validateConfiguration(): AIProviderConfigValidation;
  resolveModel(tier: AITaskTier): string;
  generateResponse(request: AIProviderRequest): Promise<AIProviderResponse>;
  listAvailableModels?(timeoutMs?: number): Promise<string[]>;
}

export class AIProviderError extends Error {
  public readonly provider?: AIProviderName;
  public readonly statusCode: number;
  public readonly code: string;
  public readonly retryable: boolean;
  public readonly quotaExhausted: boolean;
  public readonly retryAfterMs?: number;
  public readonly tier: AITaskTier;
  public readonly model: string;

  constructor(params: {
    message: string;
    provider?: AIProviderName;
    statusCode: number;
    code: string;
    retryable: boolean;
    quotaExhausted?: boolean;
    retryAfterMs?: number;
    tier: AITaskTier;
    model: string;
  }) {
    super(params.message);
    this.name = "AIProviderError";
    this.provider = params.provider;
    this.statusCode = params.statusCode;
    this.code = params.code;
    this.retryable = params.retryable;
    this.quotaExhausted = params.quotaExhausted ?? false;
    this.retryAfterMs = params.retryAfterMs;
    this.tier = params.tier;
    this.model = params.model;
  }
}

/**
 * Redacts OpenAI (`sk-...`), Google Gemini (`AIza...`), Groq (`gsk_...`),
 * Bearer tokens, and exact secret strings from any message before logging or returning.
 */
export function redactSecrets(input: string, knownSecrets: string[] = []): string {
  let sanitized = String(input || "");
  for (const secret of knownSecrets) {
    const trimmed = secret.trim();
    if (trimmed.length >= 6) {
      sanitized = sanitized.split(trimmed).join("[REDACTED_API_KEY]");
    }
  }
  sanitized = sanitized
    .replace(/\bsk-(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{12,}\b/g, "[REDACTED_API_KEY]")
    .replace(/\bAIza[0-9A-Za-z_-]{20,}\b/g, "[REDACTED_API_KEY]")
    .replace(/\bgsk_[0-9A-Za-z_-]{16,}\b/g, "[REDACTED_API_KEY]")
    .replace(/\bBearer\s+[A-Za-z0-9._-]{12,}\b/gi, "Bearer [REDACTED_TOKEN]")
    .replace(/([?&]key=)[^&\s]+/gi, "$1[REDACTED_API_KEY]");
  return sanitized;
}

export interface NormalizedChatMessage {
  role: "user" | "assistant" | "system";
  text: string;
}

export function normalizeInputToMessages(input: unknown): NormalizedChatMessage[] {
  if (typeof input === "string") {
    return [{ role: "user", text: input }];
  }

  if (Array.isArray(input)) {
    const messages: NormalizedChatMessage[] = [];
    for (const item of input) {
      if (typeof item === "string") {
        messages.push({ role: "user", text: item });
        continue;
      }
      if (item && typeof item === "object") {
        const rec = item as Record<string, unknown>;
        const rawRole = typeof rec.role === "string" ? rec.role.toLowerCase() : "user";
        const role: "user" | "assistant" | "system" =
          rawRole === "assistant" || rawRole === "model"
            ? "assistant"
            : rawRole === "system" || rawRole === "developer"
              ? "system"
              : "user";

        if (typeof rec.content === "string") {
          messages.push({ role, text: rec.content });
        } else if (Array.isArray(rec.content)) {
          const joined = rec.content
            .map((part) => {
              if (typeof part === "string") return part;
              if (part && typeof part === "object" && "text" in part) {
                return String((part as { text?: unknown }).text ?? "");
              }
              return JSON.stringify(part);
            })
            .filter(Boolean)
            .join("\n");
          messages.push({ role, text: joined });
        } else {
          messages.push({ role, text: JSON.stringify(rec) });
        }
      }
    }
    return messages.length > 0 ? messages : [{ role: "user", text: "" }];
  }

  if (input && typeof input === "object") {
    return [{ role: "user", text: JSON.stringify(input) }];
  }

  return [{ role: "user", text: String(input ?? "") }];
}

export function shouldUseJsonMode(request: AIProviderRequest): boolean {
  if (request.responseFormat === "json") {
    return true;
  }
  if (request.responseFormat === "text") {
    return false;
  }
  const instructions = request.instructions ?? "";
  return /\bjson\b/i.test(instructions);
}

export function createCombinedAbortController(
  timeoutMs: number,
  externalSignal?: AbortSignal
): {
  controller: AbortController;
  didTimeout: () => boolean;
  cleanup: () => void;
} {
  const controller = new AbortController();
  let timedOut = false;

  const onExternalAbort = () => {
    controller.abort(externalSignal?.reason);
  };

  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort(externalSignal.reason);
    } else {
      externalSignal.addEventListener("abort", onExternalAbort, { once: true });
    }
  }

  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort(new Error(`Request timed out after ${timeoutMs}ms`));
  }, timeoutMs);

  return {
    controller,
    didTimeout: () => timedOut,
    cleanup: () => {
      clearTimeout(timer);
      if (externalSignal) {
        externalSignal.removeEventListener("abort", onExternalAbort);
      }
    },
  };
}

