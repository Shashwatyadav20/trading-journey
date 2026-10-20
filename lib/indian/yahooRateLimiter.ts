/**
 * Yahoo Finance Global Rate Limiter
 *
 * Singleton that enforces a global cooldown across ALL concurrent symbol fetches
 * when Yahoo Finance returns HTTP 429 (Too Many Requests).
 *
 * Problem this solves:
 *   The per-symbol jittered backoff in fetchNseDailyCandles handles individual
 *   retries, but when 5–8 parallel requests all hit 429 simultaneously, they
 *   all retry at independently chosen times — producing a thundering-herd reburst
 *   that hits Yahoo Finance again in the same rate-limit window.
 *
 *   A shared global cooldown means: the first 429 pauses ALL pending and future
 *   requests for a cooldown period before any retry attempt.
 *
 * Cooldown schedule (exponential, capped at 5 minutes):
 *   Hit #1:  30 s
 *   Hit #2:  60 s
 *   Hit #3: 120 s
 *   Hit #4: 240 s
 *   Hit #5+: 300 s (MAX_COOLDOWN_MS)
 *
 * Thread safety:
 *   Node.js is single-threaded; no mutex is needed. The in-memory state is safe.
 *
 * Usage:
 *   await yahooRateLimiter.waitIfCoolingDown();   // before each fetch
 *   yahooRateLimiter.recordRateLimit();            // on HTTP 429
 *   yahooRateLimiter.recordSuccess();              // on HTTP 200
 */

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class YahooRateLimiter {
  /** Epoch ms when the cooldown period ends. 0 = not in cooldown. */
  private cooldownUntilMs = 0;

  /** Number of consecutive 429 responses (resets on success). */
  private consecutiveHits = 0;

  /** Minimum initial cooldown after the first 429 (30 seconds). */
  private readonly BASE_COOLDOWN_MS = 30_000;

  /** Maximum cooldown regardless of consecutive hits (5 minutes). */
  private readonly MAX_COOLDOWN_MS = 5 * 60 * 1000;

  /**
   * Call this when Yahoo Finance returns HTTP 429.
   * Sets a global cooldown for all subsequent requests.
   */
  recordRateLimit(): void {
    this.consecutiveHits++;
    const cooldown = Math.min(
      this.BASE_COOLDOWN_MS * Math.pow(2, this.consecutiveHits - 1),
      this.MAX_COOLDOWN_MS
    );
    this.cooldownUntilMs = Date.now() + cooldown;
    console.warn(
      `[YahooRateLimiter] 429 received (hit #${this.consecutiveHits}). ` +
      `Global cooldown: ${(cooldown / 1000).toFixed(0)}s until ` +
      `${new Date(this.cooldownUntilMs).toISOString()}`
    );
  }

  /**
   * Call this when any Yahoo Finance request returns HTTP 200.
   * Resets the consecutive-hit counter (but does not cancel an active cooldown).
   */
  recordSuccess(): void {
    if (this.consecutiveHits > 0) {
      console.info('[YahooRateLimiter] Successful fetch — resetting consecutive-hit counter.');
      this.consecutiveHits = 0;
    }
  }

  /**
   * Awaits the remaining cooldown before returning, if one is active.
   * This is a no-op if no cooldown is in effect.
   *
   * Call this at the start of every fetch before making the HTTP request.
   */
  async waitIfCoolingDown(): Promise<void> {
    const remainingMs = this.cooldownUntilMs - Date.now();
    if (remainingMs > 0) {
      console.info(
        `[YahooRateLimiter] Cooling down — waiting ${(remainingMs / 1000).toFixed(1)}s before fetch.`
      );
      await sleep(remainingMs);
    }
  }

  /** Returns true if a cooldown is currently active. */
  get isInCooldown(): boolean {
    return Date.now() < this.cooldownUntilMs;
  }

  /** Returns the epoch ms when the current cooldown ends, or 0 if none. */
  get cooldownUntil(): number {
    return this.cooldownUntilMs;
  }

  /** Returns the current consecutive 429-hit count. */
  get hitCount(): number {
    return this.consecutiveHits;
  }

  /**
   * Resets all state. Only for use in tests.
   * @internal
   */
  _resetForTest(): void {
    this.cooldownUntilMs = 0;
    this.consecutiveHits = 0;
  }
}

/** Singleton — shared across the entire process. */
export const yahooRateLimiter = new YahooRateLimiter();
