import { describe, it, expect, beforeEach } from "vitest";
import { SignalIdempotencyStore } from "../lifecycle/SignalIdempotencyStore";

describe("Phase 17 — Signal Idempotency Store Test Suite", () => {
  let store: SignalIdempotencyStore;

  beforeEach(() => {
    store = new SignalIdempotencyStore();
  });

  it("1. Generates deterministic key for identical parameters", () => {
    const params = {
      underlying: "NIFTY",
      expiry: "2026-09-25",
      sellStrike: 24700,
      buyStrike: 24650,
      strategyType: "BULL_PUT_SPREAD",
      dateStr: "2026-09-19",
    };

    const key1 = store.generateSignalKey(params);
    const key2 = store.generateSignalKey(params);

    expect(key1).toBe(key2);
    expect(key1.length).toBe(16);
  });

  it("2. Registers new signal successfully and flags duplicate on second registration", () => {
    const params = {
      underlying: "NIFTY",
      expiry: "2026-09-25",
      sellStrike: 24700,
      buyStrike: 24650,
      strategyType: "BULL_PUT_SPREAD",
      dateStr: "2026-09-19",
    };

    const key = store.generateSignalKey(params);

    expect(store.isDuplicate(key)).toBe(false);

    const registered1 = store.registerSignal(key);
    expect(registered1).toBe(true);

    expect(store.isDuplicate(key)).toBe(true);

    const registered2 = store.registerSignal(key);
    expect(registered2).toBe(false);
  });

  it("3. Distinguishes signals with different strikes or strategies on the same day", () => {
    const key1 = store.generateSignalKey({
      underlying: "NIFTY",
      expiry: "2026-09-25",
      sellStrike: 24700,
      buyStrike: 24650,
      strategyType: "BULL_PUT_SPREAD",
      dateStr: "2026-09-19",
    });

    const key2 = store.generateSignalKey({
      underlying: "NIFTY",
      expiry: "2026-09-25",
      sellStrike: 24800,
      buyStrike: 24850,
      strategyType: "BEAR_CALL_SPREAD",
      dateStr: "2026-09-19",
    });

    expect(key1).not.toBe(key2);

    store.registerSignal(key1);
    expect(store.isDuplicate(key1)).toBe(true);
    expect(store.isDuplicate(key2)).toBe(false);
  });

  it("4. Clears signal registry when clear() is called", () => {
    const key = store.generateSignalKey({
      underlying: "NIFTY",
      expiry: "2026-09-25",
      sellStrike: 24700,
      buyStrike: 24650,
      strategyType: "BULL_PUT_SPREAD",
      dateStr: "2026-09-19",
    });

    store.registerSignal(key);
    expect(store.isDuplicate(key)).toBe(true);

    store.clear();
    expect(store.isDuplicate(key)).toBe(false);
  });
});
