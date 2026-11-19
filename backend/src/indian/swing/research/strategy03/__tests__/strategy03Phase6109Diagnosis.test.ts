import { describe, expect, it } from "vitest";
import { simulateExitVariant } from "../runPhase6109Diagnosis.js";
import type { EntrySetupSignal, OhlcvCandle } from "../entry/EntrySetupTypes.js";

describe("Strategy 03 Phase 6.10.9 — Exit Ablation & Diagnosis", () => {
  it("handles 2x ATR trailing stop and partial 1.5R/3R exits with realistic costs", () => {
    const sig: EntrySetupSignal = {
      symbol: "TEST",
      setupType: "VOLUME_BREAKOUT",
      classification: "BREAKOUT_CONFIRMED",
      entrySetupScore: 80,
      confirmationTimestamp: "2025-01-01T10:00:00Z",
      nextExecutableOpen: 100,
      structuralStopLoss: 96,
      target1: 106,
      target2: 112,
      riskRewardT1: 1.5,
      riskRewardT2: 3.0,
      atr: 2.0,
      relativeVolume: 2.0,
      breakoutDistancePct: 1.0,
      candleQuality: 0.8,
      reasons: [],
    };
    const fut: OhlcvCandle[] = [
      { timestamp: "2025-01-02T04:00:00Z", open: 100, high: 104, low: 99.5, close: 103, volume: 1000 },
      { timestamp: "2025-01-02T05:00:00Z", open: 103, high: 108, low: 102.5, close: 107, volume: 1000 },
      { timestamp: "2025-01-02T06:00:00Z", open: 107, high: 114, low: 106.5, close: 113, volume: 1000 },
    ];
    const partial = simulateExitVariant({ signal: sig, future1h: fut, atr: 2.0, variant: "PARTIAL_50_AT_1_5R_TRAIL_3R" });
    expect(partial).not.toBeNull();
    expect(partial!.exitReason).toBe("TARGET_3R");
    expect(partial!.netReturnPct).toBeGreaterThan(5);
  });
});

