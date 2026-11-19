import { describe, expect, it } from "vitest";
import {
  DEFAULT_STRATEGY03_PAPER_ISOLATION_CONFIG,
  validateStrategy03IsolationGuard,
} from "../Strategy03PaperIsolationConfig.js";
import {
  runExpandedGapStressSuite,
  STRATEGY03_FAIL_CLOSED_GAP_CONTROLS,
} from "../Strategy03ReadinessCertifier.js";

describe("Strategy 03 Phase 6.10.4 — Readiness Monitoring & Safety Locks", () => {
  it("keeps all safety locks OFF and high-vol 60% deployment within 12% halt at 20% gap", () => {
    const guard = validateStrategy03IsolationGuard(DEFAULT_STRATEGY03_PAPER_ISOLATION_CONFIG, {
      STRATEGY_01: false,
      STRATEGY_02: false,
      STRATEGY_03: false,
      LIVE_TRADING: false,
      BROKER_EXECUTION_ENABLED: false,
    });
    expect(guard.isolated).toBe(true);
    expect(STRATEGY03_FAIL_CLOSED_GAP_CONTROLS.approvalRequired).toBe(true);
    expect(STRATEGY03_FAIL_CLOSED_GAP_CONTROLS.appliedToProduction).toBe(false);

    const hvPositions = Array.from({ length: 10 }, (_, i) => ({
      symbol: `S${i}`,
      sector: `SEC${i}`,
      notionalWeightPct: 6.0,
      stopLossPct: 10.0,
      openRiskPct: 0.6,
    }));
    const res = runExpandedGapStressSuite({ positions: hvPositions });
    const gap20 = res.find((r) => r.gapPct === 20)!;
    expect(gap20.marketWideGapLossPct).toBe(12.0);
  });
});

