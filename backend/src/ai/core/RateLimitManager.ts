import type { AIProviderName } from "./AIProvider";
import { AIProviderError } from "./AIProvider";
import { getAIStagingConfig } from "./StagingConfig";

export type ProviderHealthStatus =
  | "AVAILABLE"
  | "COOLDOWN"
  | "RATE_LIMITED"
  | "UNREACHABLE"
  | "NOT_CONFIGURED";

export interface ProviderRateLimitState {
  provider: AIProviderName;
  status: ProviderHealthStatus;
  concurrencyLimit: number;
  activeRequests: number;
  queuedRequests: number;
  inCooldown: boolean;
  cooldownUntil: string | null;
  cooldownRemainingMs: number;
  consecutive429s: number;
  lastErrorCode: string | null;
  lastSuccessAt: string | null;
}

export interface RateLimitManagerOptions {
  concurrency?: Partial<Record<AIProviderName, number>>;
  defaultCooldownMs?: number;
  maxCooldownMs?: number;
  transientMaxRetries?: number;
  backoffBaseMs?: number;
  queueTimeoutMs?: number;
  now?: () => number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

export interface ExecuteWithQueueOptions {
  queueTimeoutMs?: number;
  deadlineAtMs?: number;
  maxRetries?: number;
}

interface QueuedTask<T> {
  run: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (err: unknown) => void;
  signal?: AbortSignal;
  abortHandler?: () => void;
  queueTimer?: NodeJS.Timeout;
}

interface InternalProviderBucket {
  active: number;
  queue: Array<QueuedTask<unknown>>;
  cooldownUntilMs: number;
  consecutive429s: number;
  lastErrorCode: string | null;
  lastSuccessAtMs: number | null;
  lastFailureUnreachable: boolean;
}

function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      const err = new Error("Aborted");
      err.name = "AbortError";
      reject(err);
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      const err = new Error("Aborted");
      err.name = "AbortError";
      reject(err);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function parsePositiveInt(raw: string | undefined, fallback: number, min: number, max: number): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) return fallback;
  return n;
}

export function parseRetryAfterMs(headerValue: string | null | undefined): number | undefined {
  if (!headerValue || !headerValue.trim()) return undefined;
  const trimmed = headerValue.trim();
  const seconds = Number(trimmed);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.round(seconds * 1000);
  }
  const parsedDate = Date.parse(trimmed);
  if (Number.isFinite(parsedDate)) {
    return Math.max(0, parsedDate - Date.now());
  }
  return undefined;
}

export class RateLimitManager {
  private readonly concurrencyLimits: Record<AIProviderName, number>;
  private readonly hasExplicitConcurrency: Partial<Record<AIProviderName, boolean>>;
  private readonly defaultCooldownMs: number;
  private readonly maxCooldownMs: number;
  private readonly transientMaxRetries: number;
  private readonly backoffBaseMs: number;
  private readonly defaultQueueTimeoutMs: number;
  private readonly now: () => number;
  private readonly sleepFn: (ms: number, signal?: AbortSignal) => Promise<void>;
  private readonly buckets: Record<AIProviderName, InternalProviderBucket>;
  private lastSuccessfulProvider: AIProviderName | null = null;

  public constructor(options: RateLimitManagerOptions = {}) {
    this.hasExplicitConcurrency = {
      gemini: options.concurrency?.gemini !== undefined,
      groq: options.concurrency?.groq !== undefined,
      openai: options.concurrency?.openai !== undefined,
    };
    this.concurrencyLimits = {
      gemini:
        options.concurrency?.gemini ??
        parsePositiveInt(process.env.AI_GEMINI_CONCURRENCY, 2, 1, 20),
      groq:
        options.concurrency?.groq ??
        parsePositiveInt(process.env.AI_GROQ_CONCURRENCY, 2, 1, 20),
      openai:
        options.concurrency?.openai ??
        parsePositiveInt(process.env.AI_OPENAI_CONCURRENCY, 3, 1, 20),
    };
    this.defaultCooldownMs =
      options.defaultCooldownMs ??
      parsePositiveInt(process.env.AI_429_COOLDOWN_MS, 15_000, 500, 120_000);
    this.maxCooldownMs = options.maxCooldownMs ?? 120_000;
    this.transientMaxRetries =
      options.transientMaxRetries ??
      parsePositiveInt(process.env.AI_TRANSIENT_MAX_RETRIES, 1, 0, 2);
    this.backoffBaseMs = options.backoffBaseMs ?? 250;
    this.defaultQueueTimeoutMs =
      options.queueTimeoutMs ??
      parsePositiveInt(process.env.AI_PROVIDER_QUEUE_TIMEOUT_MS, 5_000, 100, 60_000);
    this.now = options.now ?? (() => Date.now());
    this.sleepFn = options.sleep ?? defaultSleep;

    this.buckets = {
      gemini: { active: 0, queue: [], cooldownUntilMs: 0, consecutive429s: 0, lastErrorCode: null, lastSuccessAtMs: null, lastFailureUnreachable: false },
      groq: { active: 0, queue: [], cooldownUntilMs: 0, consecutive429s: 0, lastErrorCode: null, lastSuccessAtMs: null, lastFailureUnreachable: false },
      openai: { active: 0, queue: [], cooldownUntilMs: 0, consecutive429s: 0, lastErrorCode: null, lastSuccessAtMs: null, lastFailureUnreachable: false },
    };
  }

  public getConcurrencyLimit(provider: AIProviderName): number {
    const base = this.concurrencyLimits[provider];
    if (this.hasExplicitConcurrency[provider]) return base;
    const staging = getAIStagingConfig();
    if (staging.stagingMode) {
      return Math.min(base, staging.maxConcurrentRequests);
    }
    return base;
  }

  public getLastSuccessfulProvider(): AIProviderName | null {
    return this.lastSuccessfulProvider;
  }

  public isInCooldown(provider: AIProviderName): boolean {
    const bucket = this.buckets[provider];
    return bucket.cooldownUntilMs > this.now();
  }

  public getCooldownRemainingMs(provider: AIProviderName): number {
    const remaining = this.buckets[provider].cooldownUntilMs - this.now();
    return remaining > 0 ? remaining : 0;
  }

  public markCooldown(
    provider: AIProviderName,
    retryAfterMs?: number,
    errorCode = "RATE_LIMITED"
  ): number {
    const bucket = this.buckets[provider];
    bucket.consecutive429s += 1;
    bucket.lastErrorCode = errorCode;

    // Escalate modestly on consecutive 429s, bounded by maxCooldownMs, or honor Retry-After.
    const escalated = Math.min(
      this.maxCooldownMs,
      this.defaultCooldownMs * Math.min(4, bucket.consecutive429s)
    );
    const duration =
      typeof retryAfterMs === "number" && Number.isFinite(retryAfterMs) && retryAfterMs > 0
        ? Math.min(this.maxCooldownMs, Math.max(500, retryAfterMs))
        : escalated;

    bucket.cooldownUntilMs = Math.max(bucket.cooldownUntilMs, this.now() + duration);
    return duration;
  }

  public recordSuccess(provider: AIProviderName): void {
    const bucket = this.buckets[provider];
    bucket.consecutive429s = 0;
    bucket.cooldownUntilMs = 0;
    bucket.lastErrorCode = null;
    bucket.lastFailureUnreachable = false;
    bucket.lastSuccessAtMs = this.now();
    this.lastSuccessfulProvider = provider;
  }

  public recordFailure(
    provider: AIProviderName,
    errorCode: string,
    unreachable = true
  ): void {
    const bucket = this.buckets[provider];
    bucket.lastErrorCode = errorCode;
    bucket.lastFailureUnreachable = unreachable;
  }

  public reset(provider?: AIProviderName): void {
    const targets: AIProviderName[] = provider ? [provider] : ["gemini", "groq", "openai"];
    for (const p of targets) {
      this.buckets[p].cooldownUntilMs = 0;
      this.buckets[p].consecutive429s = 0;
      this.buckets[p].lastErrorCode = null;
      this.buckets[p].lastFailureUnreachable = false;
      this.buckets[p].lastSuccessAtMs = null;
    }
    if (!provider) {
      this.lastSuccessfulProvider = null;
    }
  }

  public getProviderState(
    provider: AIProviderName,
    configured = true
  ): ProviderRateLimitState {
    const bucket = this.buckets[provider];
    const remaining = this.getCooldownRemainingMs(provider);
    let status: ProviderHealthStatus = "AVAILABLE";
    if (!configured) {
      status = "NOT_CONFIGURED";
    } else if (remaining > 0) {
      status =
        bucket.consecutive429s > 0 ||
        (bucket.lastErrorCode ?? "").includes("QUOTA") ||
        (bucket.lastErrorCode ?? "").includes("RATE_LIMIT")
          ? "RATE_LIMITED"
          : "COOLDOWN";
    } else if (bucket.lastFailureUnreachable) {
      status = "UNREACHABLE";
    }

    return {
      provider,
      status,
      concurrencyLimit: this.getConcurrencyLimit(provider),
      activeRequests: bucket.active,
      queuedRequests: bucket.queue.length,
      inCooldown: remaining > 0,
      cooldownUntil: remaining > 0 ? new Date(bucket.cooldownUntilMs).toISOString() : null,
      cooldownRemainingMs: remaining,
      consecutive429s: bucket.consecutive429s,
      lastErrorCode: bucket.lastErrorCode,
      lastSuccessAt: bucket.lastSuccessAtMs
        ? new Date(bucket.lastSuccessAtMs).toISOString()
        : null,
    };
  }

  public getAllProviderStates(
    configuredMap?: Partial<Record<AIProviderName, boolean>>
  ): Record<AIProviderName, ProviderRateLimitState> {
    return {
      gemini: this.getProviderState("gemini", configuredMap?.gemini ?? true),
      groq: this.getProviderState("groq", configuredMap?.groq ?? true),
      openai: this.getProviderState("openai", configuredMap?.openai ?? true),
    };
  }

  /**
   * Executes a provider call through its per-provider concurrency queue with
   * bounded exponential backoff + jitter for transient 5xx/connection errors.
   * Never retries 429 quota exhaustion or non-retryable 401/403/404/400 errors.
   */
  public async executeWithQueueAndRetry<T>(
    provider: AIProviderName,
    fn: () => Promise<T>,
    signal?: AbortSignal,
    options?: ExecuteWithQueueOptions
  ): Promise<T> {
    const deadlineAtMs = options?.deadlineAtMs;
    if (deadlineAtMs !== undefined && deadlineAtMs - this.now() <= 0) {
      throw new AIProviderError({
        message: `${provider} skipped: request deadline already exceeded.`,
        provider,
        statusCode: 504,
        code: "DEADLINE_EXCEEDED",
        retryable: false,
        tier: "balanced",
        model: provider,
      });
    }

    const effectiveQueueTimeoutMs = (() => {
      const configured = options?.queueTimeoutMs ?? this.defaultQueueTimeoutMs;
      if (deadlineAtMs === undefined) return configured;
      const remaining = Math.max(50, deadlineAtMs - this.now());
      return Math.min(configured, remaining);
    })();

    const maxRetries =
      options?.maxRetries !== undefined
        ? Math.max(0, options.maxRetries)
        : this.transientMaxRetries;

    return this.enqueue(
      provider,
      async () => {
        let attempt = 0;
        while (true) {
          if (deadlineAtMs !== undefined && deadlineAtMs - this.now() <= 0) {
            throw new AIProviderError({
              message: `${provider} skipped after queue wait: request deadline exceeded.`,
              provider,
              statusCode: 504,
              code: "DEADLINE_EXCEEDED",
              retryable: false,
              tier: "balanced",
              model: provider,
            });
          }

          try {
            const result = await fn();
            this.recordSuccess(provider);
            return result;
          } catch (err: unknown) {
            if (err instanceof AIProviderError) {
              this.buckets[provider].lastErrorCode = err.code;

              if (err.quotaExhausted || err.statusCode === 429) {
                this.markCooldown(provider, err.retryAfterMs, err.code);
                throw err;
              }

              // Never retry auth errors (401/403), unavailable models (404), invalid requests (400), or cancellations
              if (!err.retryable || err.statusCode === 499) {
                this.recordFailure(provider, err.code, err.statusCode !== 400 && err.statusCode !== 499);
                throw err;
              }

              const isTimeoutErr =
                err.statusCode === 504 ||
                err.code.endsWith("_TIMEOUT") ||
                err.code === "DEADLINE_EXCEEDED";
              const enoughBudgetForRetry =
                deadlineAtMs === undefined || deadlineAtMs - this.now() >= 1_500;

              // Bounded transient retry (only non-timeout 5xx/connection errors when budget permits)
              if (!isTimeoutErr && enoughBudgetForRetry && attempt < maxRetries) {
                attempt += 1;
                const jitter = Math.floor(Math.random() * 100);
                const delayMs = Math.min(2000, this.backoffBaseMs * Math.pow(2, attempt - 1) + jitter);
                await this.sleepFn(delayMs, signal);
                continue;
              }
              this.recordFailure(provider, err.code, true);
            }
            throw err;
          }
        }
      },
      signal,
      effectiveQueueTimeoutMs
    );
  }

  private enqueue<T>(
    provider: AIProviderName,
    run: () => Promise<T>,
    signal?: AbortSignal,
    queueTimeoutMs?: number
  ): Promise<T> {
    if (signal?.aborted) {
      const err = new Error("Aborted");
      err.name = "AbortError";
      return Promise.reject(err);
    }

    const bucket = this.buckets[provider];
    const limit = this.getConcurrencyLimit(provider);

    if (bucket.active < limit) {
      return this.runImmediately(provider, run);
    }

    return new Promise<T>((resolve, reject) => {
      const task: QueuedTask<T> = { run, resolve, reject, signal };
      const cleanupTask = () => {
        if (task.queueTimer) {
          clearTimeout(task.queueTimer);
          task.queueTimer = undefined;
        }
        if (signal && task.abortHandler) {
          signal.removeEventListener("abort", task.abortHandler);
          task.abortHandler = undefined;
        }
      };

      if (signal) {
        const onAbort = () => {
          const idx = bucket.queue.indexOf(task as QueuedTask<unknown>);
          if (idx !== -1) {
            bucket.queue.splice(idx, 1);
          }
          cleanupTask();
          const err = new Error("Aborted");
          err.name = "AbortError";
          reject(err);
        };
        task.abortHandler = onAbort;
        signal.addEventListener("abort", onAbort, { once: true });
      }

      if (typeof queueTimeoutMs === "number" && Number.isFinite(queueTimeoutMs) && queueTimeoutMs > 0) {
        task.queueTimer = setTimeout(() => {
          const idx = bucket.queue.indexOf(task as QueuedTask<unknown>);
          if (idx !== -1) {
            bucket.queue.splice(idx, 1);
          }
          cleanupTask();
          reject(
            new AIProviderError({
              message: `${provider} queue wait timed out after ${queueTimeoutMs}ms.`,
              provider,
              statusCode: 504,
              code: "PROVIDER_QUEUE_TIMEOUT",
              retryable: true,
              tier: "balanced",
              model: provider,
            })
          );
        }, queueTimeoutMs);
        if (typeof task.queueTimer.unref === "function") {
          task.queueTimer.unref();
        }
      }

      bucket.queue.push(task as QueuedTask<unknown>);
    });
  }

  private async runImmediately<T>(
    provider: AIProviderName,
    run: () => Promise<T>
  ): Promise<T> {
    const bucket = this.buckets[provider];
    bucket.active += 1;
    try {
      return await run();
    } finally {
      bucket.active -= 1;
      this.drainQueue(provider);
    }
  }

  private drainQueue(provider: AIProviderName): void {
    const bucket = this.buckets[provider];
    const limit = this.getConcurrencyLimit(provider);
    while (bucket.active < limit && bucket.queue.length > 0) {
      const next = bucket.queue.shift()!;
      if (next.queueTimer) {
        clearTimeout(next.queueTimer);
        next.queueTimer = undefined;
      }
      if (next.signal && next.abortHandler) {
        next.signal.removeEventListener("abort", next.abortHandler);
        next.abortHandler = undefined;
      }
      if (next.signal?.aborted) {
        const err = new Error("Aborted");
        err.name = "AbortError";
        next.reject(err);
        continue;
      }
      void this.runImmediately(provider, next.run).then(next.resolve, next.reject);
    }
  }
}

export const rateLimitManager = new RateLimitManager();

