/**
 * TelegramDedupeGuard
 * ===================
 * Bounded in-memory deduplication store with TTL for Telegram alerts.
 *
 * Purpose:
 *   Prevents the same Pine signal event from being re-delivered on every
 *   price tick while the price remains near the same liquidity level.
 *
 * Deduplication key format:
 *   {instrument}|{strategy}|{referenceLevelType}|{priceRoundedX100}|{direction}
 *
 *   Example: "BTC/USD|LIQUIDITY_SWEEP|EQL|190000|BUY"
 *
 *   - instrument        → differentiates BTC/USD from XAU/USD
 *   - strategy          → differentiates LIQUIDITY_SWEEP from SWING etc.
 *   - referenceLevelType→ differentiates EQL from EQH, PWH from PWL, etc.
 *   - priceRoundedX100  → exact level price * 100 rounded to int (no fuzzy match)
 *   - direction         → differentiates BUY from SELL on the same level
 *
 * Guarantees:
 *   1. Same event/level sends only once during the dedup window.
 *   2. A different liquidity level (different type or price) alerts separately.
 *   3. A new event on the same level after TTL expiry alerts again.
 *   4. Different instruments, strategies, or directions each alert separately.
 *
 * ⚠ Restart limitation:
 *   This store is purely in-memory. Restarting the backend process clears all
 *   deduplication state. After a restart, previously-sent alerts for levels
 *   that are still active may be re-sent once. This is an acceptable trade-off
 *   that avoids persistent secrets or database writes for notification state.
 *
 * Capacity:
 *   MAX_ENTRIES (2 000) entries. When full, the oldest 10% of entries are
 *   evicted to stay bounded without per-entry overhead of a full LRU.
 */

export const DEDUPE_TTL_MS = 15 * 60 * 1_000; // 15 minutes
const MAX_ENTRIES = 2_000;
const EVICT_COUNT = 200; // evict oldest 10% when full

interface DedupeEntry {
  sentAtMs: number;
}

export class TelegramDedupeGuard {
  private readonly store = new Map<string, DedupeEntry>();

  /**
   * Builds the deterministic deduplication key for a Pine signal.
   *
   * @param instrument        e.g. "BTC/USD"
   * @param strategy          e.g. "LIQUIDITY_SWEEP"
   * @param referenceLevelType e.g. "EQL"
   * @param levelPrice        exact level price (from signal triggerPrice or level)
   * @param direction         "BUY" | "SELL"
   */
  public buildKey(
    instrument: string,
    strategy: string,
    referenceLevelType: string,
    levelPrice: number,
    direction: string
  ): string {
    const priceKey = Math.round(levelPrice * 100);
    return `${instrument}|${strategy}|${referenceLevelType}|${priceKey}|${direction}`;
  }

  /**
   * Returns true if the alert should be sent (outside dedup window),
   * and records the key so subsequent calls within TTL return false.
   *
   * Returns false (suppress) if the same key was recorded within TTL.
   */
  public shouldSend(key: string): boolean {
    const now = Date.now();
    const existing = this.store.get(key);

    if (existing && now - existing.sentAtMs < DEDUPE_TTL_MS) {
      return false; // within dedup window — suppress
    }

    // Evict oldest entries when store is full
    if (this.store.size >= MAX_ENTRIES) {
      this.evictOldest();
    }

    this.store.set(key, { sentAtMs: now });
    return true;
  }

  /**
   * Evicts the oldest EVICT_COUNT entries by insertion order.
   * Map preserves insertion order, so the first N entries are the oldest.
   */
  private evictOldest(): void {
    let evicted = 0;
    for (const key of this.store.keys()) {
      this.store.delete(key);
      evicted++;
      if (evicted >= EVICT_COUNT) break;
    }
  }

  /**
   * Returns the current number of tracked dedup keys.
   */
  public size(): number {
    return this.store.size;
  }

  /**
   * Clears all dedup state. Used in tests to reset between cases.
   */
  public clear(): void {
    this.store.clear();
  }
}

/** Module-level singleton used by PineAlertPipeline. */
export const telegramDedupeGuard = new TelegramDedupeGuard();
