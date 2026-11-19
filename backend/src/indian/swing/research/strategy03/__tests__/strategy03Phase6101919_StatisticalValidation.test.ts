import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { ImmutableReadySignalSnapshot } from "../prebreakout/Strategy03FourHourForwardOutcomeTracker.js";
import type { SignalForwardMaturityEvaluation } from "../prebreakout/Strategy03ForwardMaturityAudit.js";
import {
  computeDeterministicBootstrapCi,
  Strategy03StatisticalValidationEngine,
} from "../prebreakout/Strategy03StatisticalValidationEngine.js";

const SNAPSHOTS_PATH = path.resolve(
  "D:/Trading/my-app/backend/data/research/strategy03/phase6101911/forward_signal_snapshots.json"
);
const P18_AUDIT_PATH = path.resolve(
  "D:/Trading/my-app/backend/data/research/strategy03/phase6101918/phase6101918_forward_maturity_audit.json"
);

describe("Strategy 03 Phase 6.10.19.19 — Statistical Performance & Out-of-Sample Validation", () => {
  it("1. returns INSUFFICIENT_SAMPLE with NULL performance metrics and NULL CIs on actual T+0 immutable snapshots", () => {
    const snapshots = JSON.parse(
      fs.readFileSync(SNAPSHOTS_PATH, "utf8")
    ) as ImmutableReadySignalSnapshot[];
    const p18 = JSON.parse(fs.readFileSync(P18_AUDIT_PATH, "utf8"));

    const engine = new Strategy03StatisticalValidationEngine();
    const report = engine.runValidation({
      snapshots,
      evaluations: p18.signalEvaluations,
      priorPhaseArtifactsUnchanged: true,
      priorPhaseSha256Checksums: { p18_maturity: "verified" },
      renderDeploymentClassification:
        "RENDER_SERVICE_ONLINE_STALE_COMMIT_NOT_YET_DEPLOYED",
      supabasePersistenceStatus: "REMOTE_SYNCED",
      supabaseReconciliationInSync: true,
      experimentalPaperTradesCount: 0,
      now: new Date("2026-11-19T08:58:23+05:30"),
    });

    expect(report.overallVerdict).toBe("INSUFFICIENT_SAMPLE");
    expect(report.preflight.immutableSnapshotsCount).toBe(83);
    expect(report.preflight.allSnapshotsImmutable).toBe(true);
    expect(report.preflight.renderProductionMonitoringClaimed).toBe(false);

    for (const c of [
      "SHORT_HIGH_QUALITY",
      "MEDIUM_CLEAN",
      "LONG_CLEAN",
      "ALL_TRACKED_COHORTS",
    ] as const) {
      const m = report.cohortAnalysis[c];
      expect(m.sampleMaturity.maturedDenominatorAtLeast1B).toBe(0);
      expect(m.performanceMetrics.breakoutBeforeInvalidationRatePct).toBeNull();
      expect(m.performanceMetrics.breakoutBeforeInvalidation95Ci).toBeNull();
      expect(m.performanceMetrics.meanMfePct).toBeNull();
      expect(m.performanceMetrics.meanMaePct).toBeNull();
      expect(m.robustness.bootstrapMeanMfeCi).toBeNull();
      expect(m.cohortVerdict).toBe("INSUFFICIENT_SAMPLE");
    }

    expect(report.safetyLocks.STRATEGY_01).toBe(false);
    expect(report.safetyLocks.STRATEGY_02).toBe(false);
    expect(report.safetyLocks.STRATEGY_03).toBe(false);
    expect(report.safetyLocks.LIVE_TRADING).toBe(false);
    expect(report.safetyLocks.BROKER_EXECUTION_ENABLED).toBe(false);
    expect(report.safetyLocks.experimentalPaperTradesCount).toBe(0);
  });

  it("2. computes cohort-separated performance metrics, risk/reward, Wilson CIs, and deterministic bootstrap CIs when matured 20B observations exist", () => {
    const snapshots = JSON.parse(
      fs.readFileSync(SNAPSHOTS_PATH, "utf8")
    ) as ImmutableReadySignalSnapshot[];

    // Build synthetic matured 20B evaluations for unit-testing statistical math (isolated in memory)
    const maturedEvals: SignalForwardMaturityEvaluation[] = snapshots.map((s, idx) => {
      const isShort = s.cohort === "SHORT_HIGH_QUALITY";
      const isBrk = isShort ? idx % 4 !== 0 : idx % 3 === 0;
      const mfe = isBrk ? 5.2 : 1.4;
      const mae = isBrk ? -1.1 : -3.2;
      const ret20 = isBrk ? 4.5 : -2.6;
      return {
        signalId: s.signalId,
        symbol: s.symbol,
        cohort: s.cohort,
        snapshotTimestampIst: s.signalCompleted4hTimestampIst,
        referenceClose: s.reference4hOhlcv.close,
        consolidationHigh: s.consolidation.high,
        consolidationLow: s.consolidation.low,
        supportLow: s.supportZone.supportLow,
        bullishObLow: s.orderBlock.obLow,
        postSignalCompletedCandleCount: 20,
        maturityBucket: "20B",
        maturedTo1To4Bars: false,
        maturedTo5B: true,
        maturedTo10B: true,
        maturedTo20B: true,
        firstBreakoutTimestampIst: isBrk ? "2026-11-20T09:15:00.000+05:30" : null,
        firstBreakoutBarSequence: isBrk ? 4 : null,
        firstInvalidationTimestampIst: !isBrk ? "2026-11-20T09:15:00.000+05:30" : null,
        firstInvalidationBarSequence: !isBrk ? 3 : null,
        breakoutBeforeInvalidation: isBrk,
        invalidationBeforeBreakout: !isBrk,
        stillPending: false,
        outcomeClassification: isBrk ? "BREAKOUT_FIRST" : "INVALIDATION_FIRST",
        mfePct: mfe,
        maePct: mae,
        outcome5B: {
          horizonBlocks: 5,
          reached: true,
          sourceCandleTimestampIst: "2026-11-20T13:15:00.000+05:30",
          closePrice: s.reference4hOhlcv.close * 1.02,
          returnFromReferenceClosePct: 2.0,
          statusAtHorizon: isBrk ? "BREAKOUT_FIRST" : "INVALIDATION_FIRST",
        },
        outcome10B: {
          horizonBlocks: 10,
          reached: true,
          sourceCandleTimestampIst: "2026-11-24T09:15:00.000+05:30",
          closePrice: s.reference4hOhlcv.close * 1.03,
          returnFromReferenceClosePct: 3.0,
          statusAtHorizon: isBrk ? "BREAKOUT_FIRST" : "INVALIDATION_FIRST",
        },
        outcome20B: {
          horizonBlocks: 20,
          reached: true,
          sourceCandleTimestampIst: "2026-12-01T09:15:00.000+05:30",
          closePrice: s.reference4hOhlcv.close * (1 + ret20 / 100),
          returnFromReferenceClosePct: ret20,
          statusAtHorizon: isBrk ? "BREAKOUT_FIRST" : "INVALIDATION_FIRST",
        },
        dataQuality: {
          freshness: "FRESH",
          verifiedPostSignalCandlesCount: 20,
          rejectedPostSignalCandlesCount: 0,
          duplicatePostSignalCandlesCount: 0,
        },
      };
    });

    const engine = new Strategy03StatisticalValidationEngine();
    const report = engine.runValidation({
      snapshots,
      evaluations: maturedEvals,
      priorPhaseArtifactsUnchanged: true,
      priorPhaseSha256Checksums: {},
      renderDeploymentClassification:
        "RENDER_SERVICE_ONLINE_STALE_COMMIT_NOT_YET_DEPLOYED",
      supabasePersistenceStatus: "REMOTE_SYNCED",
      supabaseReconciliationInSync: true,
      experimentalPaperTradesCount: 0,
    });

    const shortM = report.cohortAnalysis.SHORT_HIGH_QUALITY;
    const medM = report.cohortAnalysis.MEDIUM_CLEAN;

    // Cohorts are kept strictly separate
    expect(shortM.performanceMetrics.breakoutBeforeInvalidationRatePct).toBeGreaterThan(
      medM.performanceMetrics.breakoutBeforeInvalidationRatePct!
    );
    expect(shortM.performanceMetrics.breakoutBeforeInvalidation95Ci).not.toBeNull();
    expect(shortM.robustness.bootstrapMeanMfeCi).not.toBeNull();
    expect(shortM.performanceMetrics.meanRiskRewardRatio).toBeGreaterThan(1);

    // Deterministic bootstrap reproduces identical bounds
    const b1 = computeDeterministicBootstrapCi([1, 2, 3, 4, 5, 6]);
    const b2 = computeDeterministicBootstrapCi([1, 2, 3, 4, 5, 6]);
    expect(b1).toEqual(b2);
  });
});

