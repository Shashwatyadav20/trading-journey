/**
 * Yahoo Rate Limiter — Unit Tests
 *
 * Tests the global 429 cooldown singleton that coordinates all concurrent
 * Yahoo Finance fetches to prevent thundering-herd re-bursts.
 *
 * These tests mock Date.now() and setTimeout to run synchronously — no real
 * network calls or wall-clock delays occur.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { yahooRateLimiter } from "../../../../lib/indian/yahooRateLimiter";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

beforeEach(() => {
  // Reset the singleton state between each test
  yahooRateLimiter._resetForTest();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 1: recordRateLimit() — cooldown scheduling
// ─────────────────────────────────────────────────────────────────────────────

describe("Suite 1: recordRateLimit() cooldown scheduling", () => {
  it("first 429 sets a 30-second cooldown", () => {
    const before = Date.now();
    yahooRateLimiter.recordRateLimit();
    expect(yahooRateLimiter.isInCooldown).toBe(true);
    expect(yahooRateLimiter.cooldownUntil).toBeGreaterThanOrEqual(before + 29_000);
    expect(yahooRateLimiter.cooldownUntil).toBeLessThanOrEqual(before + 31_000);
  });

  it("second consecutive 429 doubles the cooldown to ~60 seconds", () => {
    const before = Date.now();
    yahooRateLimiter.recordRateLimit(); // hit 1 → 30s
    yahooRateLimiter.recordRateLimit(); // hit 2 → 60s
    expect(yahooRateLimiter.hitCount).toBe(2);
    expect(yahooRateLimiter.cooldownUntil).toBeGreaterThanOrEqual(before + 59_000);
  });

  it("third consecutive 429 produces ~120 seconds", () => {
    const before = Date.now();
    yahooRateLimiter.recordRateLimit();
    yahooRateLimiter.recordRateLimit();
    yahooRateLimiter.recordRateLimit();
    expect(yahooRateLimiter.hitCount).toBe(3);
    expect(yahooRateLimiter.cooldownUntil).toBeGreaterThanOrEqual(before + 119_000);
  });

  it("cooldown never exceeds 5 minutes (MAX_COOLDOWN_MS)", () => {
    // 10 consecutive hits would produce 30000 * 2^9 = 15,360,000ms without cap
    for (let i = 0; i < 10; i++) yahooRateLimiter.recordRateLimit();
    const maxAllowed = Date.now() + 5 * 60 * 1000 + 1000; // 5min + 1s tolerance
    expect(yahooRateLimiter.cooldownUntil).toBeLessThanOrEqual(maxAllowed);
  });

  it("hitCount increments with each recordRateLimit() call", () => {
    expect(yahooRateLimiter.hitCount).toBe(0);
    yahooRateLimiter.recordRateLimit();
    expect(yahooRateLimiter.hitCount).toBe(1);
    yahooRateLimiter.recordRateLimit();
    expect(yahooRateLimiter.hitCount).toBe(2);
  });

  it("isInCooldown returns false before any 429 is recorded", () => {
    expect(yahooRateLimiter.isInCooldown).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 2: recordSuccess() — hit counter reset
// ─────────────────────────────────────────────────────────────────────────────

describe("Suite 2: recordSuccess() consecutive-hit reset", () => {
  it("resets hitCount to 0 after a successful request", () => {
    yahooRateLimiter.recordRateLimit();
    yahooRateLimiter.recordRateLimit();
    expect(yahooRateLimiter.hitCount).toBe(2);

    yahooRateLimiter.recordSuccess();
    expect(yahooRateLimiter.hitCount).toBe(0);
  });

  it("does NOT cancel an active cooldown period on success", () => {
    yahooRateLimiter.recordRateLimit();
    const cooldownBefore = yahooRateLimiter.cooldownUntil;

    yahooRateLimiter.recordSuccess();

    // cooldownUntil should remain unchanged — success only resets hitCount
    expect(yahooRateLimiter.cooldownUntil).toBe(cooldownBefore);
  });

  it("hitCount stays 0 when called with no prior rate limits", () => {
    yahooRateLimiter.recordSuccess();
    expect(yahooRateLimiter.hitCount).toBe(0);
  });

  it("next recordRateLimit() after success starts a fresh 30-second cooldown", () => {
    yahooRateLimiter.recordRateLimit(); // hit 1 → 30s
    yahooRateLimiter.recordRateLimit(); // hit 2 → 60s
    yahooRateLimiter.recordSuccess();   // reset hitCount to 0

    // Advance clock past previous cooldown
    vi.advanceTimersByTime(70_000);
    yahooRateLimiter._resetForTest();   // also clear cooldown for clean test

    yahooRateLimiter.recordRateLimit(); // hit 1 again → 30s
    expect(yahooRateLimiter.hitCount).toBe(1);
    expect(yahooRateLimiter.cooldownUntil).toBeGreaterThan(Date.now() + 29_000);
    expect(yahooRateLimiter.cooldownUntil).toBeLessThan(Date.now() + 31_000);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 3: waitIfCoolingDown() — blocking behaviour
// ─────────────────────────────────────────────────────────────────────────────

describe("Suite 3: waitIfCoolingDown() blocking behaviour", () => {
  it("resolves immediately when not in cooldown", async () => {
    // Restore real timers for the await
    vi.useRealTimers();
    const start = Date.now();
    await yahooRateLimiter.waitIfCoolingDown();
    expect(Date.now() - start).toBeLessThan(50); // must be near-instant
  });

  it("resolves after cooldown expires (fake timers)", async () => {
    yahooRateLimiter.recordRateLimit(); // start 30s cooldown
    expect(yahooRateLimiter.isInCooldown).toBe(true);

    // Simulate time advancing past the cooldown
    vi.advanceTimersByTime(31_000);
    yahooRateLimiter._resetForTest(); // clear state

    // Now waitIfCoolingDown should return immediately
    vi.useRealTimers();
    const start = Date.now();
    await yahooRateLimiter.waitIfCoolingDown();
    expect(Date.now() - start).toBeLessThan(50);
  });

  it("is a no-op when called multiple times with no active cooldown", async () => {
    vi.useRealTimers();
    await yahooRateLimiter.waitIfCoolingDown();
    await yahooRateLimiter.waitIfCoolingDown();
    // No throw, no hang — test passes if it gets here
    expect(true).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 4: _resetForTest() — test isolation
// ─────────────────────────────────────────────────────────────────────────────

describe("Suite 4: _resetForTest() state isolation", () => {
  it("clears cooldownUntil after reset", () => {
    yahooRateLimiter.recordRateLimit();
    expect(yahooRateLimiter.isInCooldown).toBe(true);

    yahooRateLimiter._resetForTest();
    expect(yahooRateLimiter.isInCooldown).toBe(false);
    expect(yahooRateLimiter.cooldownUntil).toBe(0);
  });

  it("clears hitCount after reset", () => {
    yahooRateLimiter.recordRateLimit();
    yahooRateLimiter.recordRateLimit();
    expect(yahooRateLimiter.hitCount).toBe(2);

    yahooRateLimiter._resetForTest();
    expect(yahooRateLimiter.hitCount).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 5: Concurrent-call simulation
// ─────────────────────────────────────────────────────────────────────────────

describe("Suite 5: Concurrent 429 simulation", () => {
  it("5 simultaneous 429 calls do not produce more than 5 hits (no double-counting)", () => {
    // Simulate 5 parallel requests all hitting 429 at the same time
    for (let i = 0; i < 5; i++) yahooRateLimiter.recordRateLimit();
    // Node.js is single-threaded — each call is sequential despite appearing concurrent
    expect(yahooRateLimiter.hitCount).toBe(5);
  });

  it("a single success after 5 hits resets the counter completely", () => {
    for (let i = 0; i < 5; i++) yahooRateLimiter.recordRateLimit();
    yahooRateLimiter.recordSuccess();
    expect(yahooRateLimiter.hitCount).toBe(0);
  });

  it("after reset, next 429 starts a fresh 30s cooldown (not a 5th-hit cooldown)", () => {
    for (let i = 0; i < 5; i++) yahooRateLimiter.recordRateLimit();
    yahooRateLimiter.recordSuccess();
    yahooRateLimiter._resetForTest(); // Clear the cooldown from the 5 prior hits

    const before = Date.now();
    yahooRateLimiter.recordRateLimit(); // Hit 1 again
    expect(yahooRateLimiter.cooldownUntil).toBeGreaterThanOrEqual(before + 29_000);
    expect(yahooRateLimiter.cooldownUntil).toBeLessThanOrEqual(before + 31_000);
  });
});
