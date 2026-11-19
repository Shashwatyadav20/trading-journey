import { describe, expect, it } from "vitest";
import {
  computeHorizonCohortStats,
  computeScoreReturnCorrelation,
  type ForwardReturnObservation,
} from "../Strategy03ShadowRunner.js";

describe("Strategy 03 Phase 6.10.6 — Forward Signal Cohort & Calibration Monitoring", () => {
  it("computes horizon cohort stats without converting incomplete returns to zero", () => {
    const obs: ForwardReturnObservation[] = [
      {
        idempotencyKey: "A|1",
        symbol: "A",
        sector: "IT",
        signalDate: "2026-08-18",
        decision: "BUY_CANDIDATE",
        referencePrice: 100,
        ret1dPct: 2,
        ret5dPct: 5,
        ret10dPct: null,
        ret20dPct: null,
        ret60dPct: null,
        mfePct: 5,
        maePct: -1,
        observationTradingDays: 5,
      },
      {
        idempotencyKey: "B|1",
        symbol: "B",
        sector: "IT",
        signalDate: "2026-08-18",
        decision: "BUY_CANDIDATE",
        referencePrice: 100,
        ret1dPct: -1,
        ret5dPct: null,
        ret10dPct: null,
        ret20dPct: null,
        ret60dPct: null,
        mfePct: 1,
        maePct: -1,
        observationTradingDays: 1,
      },
    ];
    const c1 = computeHorizonCohortStats(obs, 1);
    expect(c1.maturedSignals).toBe(2);
    expect(c1.incompleteSignals).toBe(0);
    expect(c1.avgReturnPct).toBe(0.5);
    expect(c1.winRatePct).toBe(50);

    const c5 = computeHorizonCohortStats(obs, 5);
    expect(c5.maturedSignals).toBe(1);
    expect(c5.incompleteSignals).toBe(1);
    expect(c5.avgReturnPct).toBe(5); // Never averaged with 0 for incomplete B

    const c20 = computeHorizonCohortStats(obs, 20);
    expect(c20.maturedSignals).toBe(0);
    expect(c20.avgReturnPct).toBeNull();
  });

  it("computes score-to-return correlation accurately", () => {
    const corr = computeScoreReturnCorrelation([
      { score: 40, forwardRetPct: -2 },
      { score: 60, forwardRetPct: 4 },
      { score: 80, forwardRetPct: 10 },
    ]);
    expect(corr).toBe(1);
  });
});

