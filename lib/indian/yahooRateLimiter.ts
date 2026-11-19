// ============================================================================
// Global Yahoo Finance Rate Limiter & 429 Cooldown Circuit Breaker
// ============================================================================

class YahooRateLimiter {
  private cooldownUntil = 0;
  private consecutive429s = 0;

  private readonly BASE_COOLDOWN_MS = 30_000; // 30 seconds initial cooldown
  private readonly MAX_COOLDOWN_MS = 300_000; // 5 minutes max cooldown

  /**
   * Returns true if currently in a 429 cooldown window.
   */
  public isCoolingDown(): boolean {
    return Date.now() < this.cooldownUntil;
  }

  /**
   * Returns remaining cooldown milliseconds, or 0 if not cooling down.
   */
  public getRemainingCooldownMs(): number {
    return Math.max(0, this.cooldownUntil - Date.now());
  }

  /**
   * Waits for an active 429 cooldown to expire before proceeding.
   *
   * When `maxWaitMs` is provided and the remaining cooldown exceeds `maxWaitMs`,
   * or when `signal` is aborted, returns `false` immediately so callers with
   * bounded agent deadlines fail fast to partial/unavailable data instead of
   * blocking until agent timeout.
   *
   * Returns `true` when ready to proceed, or `false` if skipped due to
   * bounded deadline / abort signal.
   */
  public async waitIfCoolingDown(maxWaitMs?: number, signal?: AbortSignal): Promise<boolean> {
    if (signal?.aborted) {
      return false;
    }

    const now = Date.now();
    if (now >= this.cooldownUntil) {
      return true;
    }

    const waitMs = this.cooldownUntil - now;
    if (typeof maxWaitMs === "number" && maxWaitMs >= 0 && waitMs > maxWaitMs) {
      console.warn(
        `[YahooRateLimiter] Active 429 cooldown (${Math.ceil(waitMs / 1000)}s) exceeds maxWaitMs (${maxWaitMs}ms). Failing fast to preserve agent deadline.`
      );
      return false;
    }

    console.warn(`[YahooRateLimiter] Active 429 cooldown. Waiting ${Math.ceil(waitMs / 1000)}s...`);

    return new Promise<boolean>((resolve) => {
      if (signal?.aborted) {
        resolve(false);
        return;
      }

      const timer = setTimeout(() => {
        if (signal && onAbort) {
          signal.removeEventListener("abort", onAbort);
        }
        resolve(true);
      }, waitMs);

      const onAbort = signal
        ? () => {
            clearTimeout(timer);
            resolve(false);
          }
        : null;

      if (signal && onAbort) {
        signal.addEventListener("abort", onAbort, { once: true });
      }
    });
  }

  /**
   * Records an HTTP 429 response and activates exponential cooldown.
   */
  public recordRateLimit(): void {
    this.record429();
  }

  /**
   * Records an HTTP 429 response and activates exponential cooldown.
   */
  public record429(): void {
    this.consecutive429s += 1;
    const backoff = Math.min(
      this.BASE_COOLDOWN_MS * Math.pow(2, this.consecutive429s - 1),
      this.MAX_COOLDOWN_MS
    );
    this.cooldownUntil = Date.now() + backoff;
    console.warn(
      `[YahooRateLimiter] HTTP 429 detected (#${this.consecutive429s}). Cooling down for ${Math.ceil(
        backoff / 1000
      )}s.`
    );
  }

  /**
   * Resets consecutive 429 counter on a successful HTTP response.
   */
  public recordSuccess(): void {
    if (this.consecutive429s > 0) {
      this.consecutive429s = 0;
    }
    this.cooldownUntil = 0;
  }

  /**
   * Resets state for deterministic unit testing.
   */
  public resetForTest(): void {
    this.cooldownUntil = 0;
    this.consecutive429s = 0;
  }
}

export const yahooRateLimiter = new YahooRateLimiter();
