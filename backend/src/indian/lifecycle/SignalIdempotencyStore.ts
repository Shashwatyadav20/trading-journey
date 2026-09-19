import crypto from "crypto";

export interface SignalKeyParams {
  underlying: string;
  expiry: string;
  sellStrike: number;
  buyStrike: number;
  strategyType: string;
  dateStr?: string; // ISO YYYY-MM-DD, defaults to today
}

export class SignalIdempotencyStore {
  private processedSignals: Map<string, { timestampMs: number; signalId: string }> = new Map();
  private readonly ttlMs: number = 24 * 60 * 60 * 1000; // 24 hours

  /**
   * Computes a deterministic signal key based on key signal parameters.
   */
  public generateSignalKey(params: SignalKeyParams): string {
    const date = params.dateStr ?? new Date().toISOString().slice(0, 10);
    const raw = `${params.underlying.toUpperCase()}_${params.expiry}_${params.sellStrike}_${params.buyStrike}_${params.strategyType}_${date}`;
    return crypto.createHash("sha256").update(raw).digest("hex").slice(0, 16);
  }

  /**
   * Checks if a signal key has already been processed within TTL window.
   */
  public isDuplicate(signalKey: string): boolean {
    this.purgeStale();
    return this.processedSignals.has(signalKey);
  }

  /**
   * Registers a signal key. Returns true if registered successfully (new signal),
   * returns false if it was already processed (duplicate signal).
   */
  public registerSignal(signalKey: string, signalId: string = signalKey): boolean {
    if (this.isDuplicate(signalKey)) {
      return false; // Duplicate
    }

    this.processedSignals.set(signalKey, {
      timestampMs: Date.now(),
      signalId,
    });
    return true; // New signal accepted
  }

  /**
   * Clears all processed signals (for testing isolation).
   */
  public clear(): void {
    this.processedSignals.clear();
  }

  private purgeStale(): void {
    const now = Date.now();
    for (const [key, entry] of this.processedSignals.entries()) {
      if (now - entry.timestampMs > this.ttlMs) {
        this.processedSignals.delete(key);
      }
    }
  }
}

export const signalIdempotencyStore = new SignalIdempotencyStore();
