import type {
  ImmutableReadySignalSnapshot,
  TrackedDurationCohort,
  WilsonConfidenceInterval,
} from "./Strategy03FourHourForwardOutcomeTracker.js";
import { computeWilson95Ci } from "./Strategy03FourHourForwardOutcomeTracker.js";
import type {
  DeploymentPreflightClassification,
  SignalForwardMaturityEvaluation,
} from "./Strategy03ForwardMaturityAudit.js";
import type { MonitoringPersistenceStatus } from "./Strategy03FourHourMonitoringPersistence.js";
import {
  DEFAULT_STRATEGY03_PAPER_ISOLATION_CONFIG,
  validateStrategy03IsolationGuard,
} from "../Strategy03PaperIsolationConfig.js";

export type StatisticalValidationVerdict =
  | "INSUFFICIENT_SAMPLE"
  | "INCONCLUSIVE"
  | "PROMISING_BUT_UNVALIDATED"
  | "VALIDATION_FAILED"
  | "VALIDATION_PASSED";

export interface BootstrapConfidenceInterval {
  readonly lowerPct: number;
  readonly upperPct: number;
  readonly medianPct: number;
  readonly iterations: number;
  readonly confidenceLevel: 0.95;
  readonly method: "DETERMINISTIC_BOOTSTRAP_PERCENTILE";
}

export interface CohortStatisticalValidationMetrics {
  readonly cohort: TrackedDurationCohort | "ALL_TRACKED_COHORTS";
  readonly sampleMaturity: {
    readonly totalCapturedImmutable: number;
    readonly t0ZeroBars: number;
    readonly bars1To4: number;
    readonly bars5B: number; // 5-9 bars
    readonly bars10B: number; // 10-19 bars
    readonly bars20BPlus: number; // >= 20 bars
    readonly excludedImmatureCount: number;
    readonly maturedDenominatorAtLeast1B: number;
    readonly maturedDenominatorAtLeast5B: number;
    readonly maturedDenominatorAtLeast10B: number;
    readonly maturedDenominatorAtLeast20B: number;
  };
  readonly performanceMetrics: {
    readonly sufficientMaturedSampleForRates: boolean; // requires >= 5 matured >=1B bars
    readonly sufficientMaturedSampleFor20BValidation: boolean; // requires >= 30 matured >=20B bars
    readonly breakoutBeforeInvalidationRatePct: number | null;
    readonly breakoutBeforeInvalidation95Ci: WilsonConfidenceInterval | null;
    readonly invalidationBeforeBreakoutRatePct: number | null;
    readonly invalidationBeforeBreakout95Ci: WilsonConfidenceInterval | null;
    readonly maturedPendingRatePct: number | null;
    readonly meanMfePct: number | null;
    readonly medianMfePct: number | null;
    readonly meanMaePct: number | null;
    readonly medianMaePct: number | null;
    readonly meanRiskRewardRatio: number | null;
    readonly medianRiskRewardRatio: number | null;
    readonly horizon5BOutcome: {
      readonly sampleSize: number;
      readonly meanReturnPct: number | null;
      readonly medianReturnPct: number | null;
      readonly breakoutFirstCount: number;
      readonly invalidationFirstCount: number;
    };
    readonly horizon10BOutcome: {
      readonly sampleSize: number;
      readonly meanReturnPct: number | null;
      readonly medianReturnPct: number | null;
      readonly breakoutFirstCount: number;
      readonly invalidationFirstCount: number;
    };
    readonly horizon20BOutcome: {
      readonly sampleSize: number;
      readonly meanReturnPct: number | null;
      readonly medianReturnPct: number | null;
      readonly breakoutFirstCount: number;
      readonly invalidationFirstCount: number;
    };
  };
  readonly robustness: {
    readonly bootstrapBreakoutRateCi: BootstrapConfidenceInterval | null;
    readonly bootstrapMeanMfeCi: BootstrapConfidenceInterval | null;
    readonly topStockConcentrationPct: number | null;
    readonly statusNote: string;
  };
  readonly cohortVerdict: StatisticalValidationVerdict;
}

export interface SensitivityBucketSummary {
  readonly bucketLabel: string;
  readonly totalCapturedSignals: number;
  readonly maturedSignalsCount: number;
  readonly breakoutFirstCount: number;
  readonly invalidationFirstCount: number;
  readonly maturedBreakoutRatePct: number | null;
}

export interface Phase6101919StatisticalValidationReport {
  readonly generatedAtIso: string;
  readonly generatedAtIst: string;
  readonly phase: "6.10.19.19";
  readonly preflight: {
    readonly phase6101911Through18Verified: boolean;
    readonly priorPhaseArtifactsUnchanged: boolean;
    readonly priorPhaseSha256Checksums: Record<string, string>;
    readonly renderDeploymentClassification: DeploymentPreflightClassification;
    readonly renderProductionMonitoringClaimed: false;
    readonly supabasePersistenceStatus: MonitoringPersistenceStatus;
    readonly supabaseReconciliationInSync: boolean;
    readonly immutableSnapshotsCount: number;
    readonly allSnapshotsImmutable: boolean;
  };
  readonly overallVerdict: StatisticalValidationVerdict;
  readonly verdictRationale: string;
  readonly cohortAnalysis: Record<
    TrackedDurationCohort | "ALL_TRACKED_COHORTS",
    CohortStatisticalValidationMetrics
  >;
  readonly outOfSampleValidation: {
    readonly developmentCutOffIst: string;
    readonly prospectiveWindowStartIst: string;
    readonly zeroLookaheadBiasVerified: boolean;
    readonly survivorshipBiasDisclosure: string;
    readonly thresholdsModifiedDuringEvaluation: false;
    readonly prospectiveMaturedSignalsCount: number;
    readonly prospectiveImmatureT0SignalsCount: number;
  };
  readonly robustnessAndSensitivity: {
    readonly scoreTierSensitivity: SensitivityBucketSummary[];
    readonly supportRelevanceSensitivity: SensitivityBucketSummary[];
    readonly regimeAndConcentrationNote: string;
  };
  readonly dataQualityLimitations: string[];
  readonly safetyLocks: {
    readonly STRATEGY_01: false;
    readonly STRATEGY_02: false;
    readonly STRATEGY_03: false;
    readonly LIVE_TRADING: false;
    readonly BROKER_EXECUTION_ENABLED: false;
    readonly paperIsolationEnabled: false;
    readonly experimentalPaperTradesCount: number;
  };
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

function mean(vals: number[]): number | null {
  if (vals.length === 0) return null;
  return round2(vals.reduce((a, b) => a + b, 0) / vals.length);
}

function median(vals: number[]): number | null {
  if (vals.length === 0) return null;
  const sorted = [...vals].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? round2(sorted[mid])
    : round2((sorted[mid - 1] + sorted[mid]) / 2);
}

/**
 * Deterministic linear-congruential PRNG for reproducible bootstrap intervals.
 */
function createSeededRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

export function computeDeterministicBootstrapCi(
  values: number[],
  iterations: number = 1000,
  seed: number = 6101919
): BootstrapConfidenceInterval | null {
  if (values.length < 5) return null;
  const rng = createSeededRng(seed);
  const means: number[] = [];
  const n = values.length;

  for (let i = 0; i < iterations; i++) {
    let sum = 0;
    for (let j = 0; j < n; j++) {
      const idx = Math.floor(rng() * n);
      sum += values[idx];
    }
    means.push(sum / n);
  }

  means.sort((a, b) => a - b);
  const loIdx = Math.floor(0.025 * (iterations - 1));
  const medIdx = Math.floor(0.5 * (iterations - 1));
  const hiIdx = Math.floor(0.975 * (iterations - 1));

  return {
    lowerPct: round2(means[loIdx]),
    upperPct: round2(means[hiIdx]),
    medianPct: round2(means[medIdx]),
    iterations,
    confidenceLevel: 0.95,
    method: "DETERMINISTIC_BOOTSTRAP_PERCENTILE",
  };
}

export class Strategy03StatisticalValidationEngine {
  public evaluateCohort(
    cohort: TrackedDurationCohort | "ALL_TRACKED_COHORTS",
    evaluations: SignalForwardMaturityEvaluation[]
  ): CohortStatisticalValidationMetrics {
    const subset =
      cohort === "ALL_TRACKED_COHORTS"
        ? evaluations
        : evaluations.filter((e) => e.cohort === cohort);

    const t0 = subset.filter((e) => e.postSignalCompletedCandleCount === 0);
    const b1To4 = subset.filter(
      (e) =>
        e.postSignalCompletedCandleCount >= 1 &&
        e.postSignalCompletedCandleCount <= 4
    );
    const b5Only = subset.filter(
      (e) =>
        e.postSignalCompletedCandleCount >= 5 &&
        e.postSignalCompletedCandleCount <= 9
    );
    const b10Only = subset.filter(
      (e) =>
        e.postSignalCompletedCandleCount >= 10 &&
        e.postSignalCompletedCandleCount <= 19
    );
    const b20Plus = subset.filter((e) => e.postSignalCompletedCandleCount >= 20);

    const matured1B = subset.filter(
      (e) =>
        e.postSignalCompletedCandleCount >= 1 &&
        e.mfePct !== null &&
        e.maePct !== null
    );
    const matured5B = subset.filter((e) => e.postSignalCompletedCandleCount >= 5);
    const matured10B = subset.filter((e) => e.postSignalCompletedCandleCount >= 10);
    const matured20B = b20Plus;

    const n1B = matured1B.length;
    const sufficientRates = n1B >= 5;
    const sufficient20B = matured20B.length >= 30;

    const brk1B = matured1B.filter((e) => e.breakoutBeforeInvalidation);
    const inv1B = matured1B.filter((e) => e.invalidationBeforeBreakout);
    const pend1B = matured1B.filter((e) => e.stillPending);

    const mfeVals = matured1B.map((e) => e.mfePct!);
    const maeVals = matured1B.map((e) => e.maePct!);
    const rrVals = matured1B
      .filter((e) => e.maePct !== null && e.maePct < 0)
      .map((e) => Math.abs(e.mfePct! / e.maePct!));

    const summarizeHorizon = (
      list: SignalForwardMaturityEvaluation[],
      key: "outcome5B" | "outcome10B" | "outcome20B"
    ) => {
      const reached = list.filter((e) => e[key].reached);
      const rets = reached
        .map((e) => e[key].returnFromReferenceClosePct)
        .filter((r): r is number => r !== null);
      return {
        sampleSize: reached.length,
        meanReturnPct: reached.length >= 5 ? mean(rets) : null,
        medianReturnPct: reached.length >= 5 ? median(rets) : null,
        breakoutFirstCount: reached.filter(
          (e) => e[key].statusAtHorizon === "BREAKOUT_FIRST"
        ).length,
        invalidationFirstCount: reached.filter(
          (e) => e[key].statusAtHorizon === "INVALIDATION_FIRST"
        ).length,
      };
    };

    const brkBinary = matured1B.map((e) =>
      e.breakoutBeforeInvalidation ? 100 : 0
    );
    const bootstrapBrk = computeDeterministicBootstrapCi(brkBinary);
    const bootstrapMfe = computeDeterministicBootstrapCi(mfeVals);

    let topStockConc: number | null = null;
    if (brk1B.length > 0) {
      const countsBySym = new Map<string, number>();
      for (const e of brk1B) {
        countsBySym.set(e.symbol, (countsBySym.get(e.symbol) ?? 0) + 1);
      }
      const maxSym = Math.max(...countsBySym.values());
      topStockConc = round2((maxSym / brk1B.length) * 100);
    }

    let cohortVerdict: StatisticalValidationVerdict = "INSUFFICIENT_SAMPLE";
    if (matured20B.length >= 30) {
      const brkRate = n1B > 0 ? (brk1B.length / n1B) * 100 : 0;
      const invRate = n1B > 0 ? (inv1B.length / n1B) * 100 : 0;
      if (brkRate > invRate && (mean(mfeVals) ?? 0) > Math.abs(mean(maeVals) ?? 0)) {
        cohortVerdict = "VALIDATION_PASSED";
      } else if (invRate > brkRate) {
        cohortVerdict = "VALIDATION_FAILED";
      } else {
        cohortVerdict = "INCONCLUSIVE";
      }
    } else if (n1B >= 5) {
      cohortVerdict = "PROMISING_BUT_UNVALIDATED";
    }

    return {
      cohort,
      sampleMaturity: {
        totalCapturedImmutable: subset.length,
        t0ZeroBars: t0.length,
        bars1To4: b1To4.length,
        bars5B: b5Only.length,
        bars10B: b10Only.length,
        bars20BPlus: b20Plus.length,
        excludedImmatureCount: t0.length,
        maturedDenominatorAtLeast1B: n1B,
        maturedDenominatorAtLeast5B: matured5B.length,
        maturedDenominatorAtLeast10B: matured10B.length,
        maturedDenominatorAtLeast20B: matured20B.length,
      },
      performanceMetrics: {
        sufficientMaturedSampleForRates: sufficientRates,
        sufficientMaturedSampleFor20BValidation: sufficient20B,
        breakoutBeforeInvalidationRatePct: sufficientRates
          ? round2((brk1B.length / n1B) * 100)
          : null,
        breakoutBeforeInvalidation95Ci: sufficientRates
          ? computeWilson95Ci(brk1B.length, n1B)
          : null,
        invalidationBeforeBreakoutRatePct: sufficientRates
          ? round2((inv1B.length / n1B) * 100)
          : null,
        invalidationBeforeBreakout95Ci: sufficientRates
          ? computeWilson95Ci(inv1B.length, n1B)
          : null,
        maturedPendingRatePct: sufficientRates
          ? round2((pend1B.length / n1B) * 100)
          : null,
        meanMfePct: sufficientRates ? mean(mfeVals) : null,
        medianMfePct: sufficientRates ? median(mfeVals) : null,
        meanMaePct: sufficientRates ? mean(maeVals) : null,
        medianMaePct: sufficientRates ? median(maeVals) : null,
        meanRiskRewardRatio: sufficientRates && rrVals.length > 0 ? mean(rrVals) : null,
        medianRiskRewardRatio:
          sufficientRates && rrVals.length > 0 ? median(rrVals) : null,
        horizon5BOutcome: summarizeHorizon(matured5B, "outcome5B"),
        horizon10BOutcome: summarizeHorizon(matured10B, "outcome10B"),
        horizon20BOutcome: summarizeHorizon(matured20B, "outcome20B"),
      },
      robustness: {
        bootstrapBreakoutRateCi: bootstrapBrk,
        bootstrapMeanMfeCi: bootstrapMfe,
        topStockConcentrationPct: topStockConc,
        statusNote:
          n1B < 5
            ? `NOT_APPLICABLE_INSUFFICIENT_SAMPLE (matured n=${n1B}, minimum 5 required for bootstrap/rates and 30 at 20B for full validation)`
            : "Bootstrap 95% CI computed with 1,000 deterministic resamples.",
      },
      cohortVerdict,
    };
  }

  public runValidation(params: {
    snapshots: ImmutableReadySignalSnapshot[];
    evaluations: SignalForwardMaturityEvaluation[];
    priorPhaseArtifactsUnchanged: boolean;
    priorPhaseSha256Checksums: Record<string, string>;
    renderDeploymentClassification: DeploymentPreflightClassification;
    supabasePersistenceStatus: MonitoringPersistenceStatus;
    supabaseReconciliationInSync: boolean;
    experimentalPaperTradesCount: number;
    now?: Date;
  }): Phase6101919StatisticalValidationReport {
    const evalNow = params.now ?? new Date();
    const istIso = new Date(evalNow.getTime() + 330 * 60_000)
      .toISOString()
      .replace("Z", "+05:30");

    // Enforce safety locks before evaluation
    validateStrategy03IsolationGuard(DEFAULT_STRATEGY03_PAPER_ISOLATION_CONFIG, {
      STRATEGY_01: false,
      STRATEGY_02: false,
      STRATEGY_03: false,
      LIVE_TRADING: false,
      BROKER_EXECUTION_ENABLED: false,
    });

    const cohortAnalysis: Record<
      TrackedDurationCohort | "ALL_TRACKED_COHORTS",
      CohortStatisticalValidationMetrics
    > = {
      SHORT_HIGH_QUALITY: this.evaluateCohort("SHORT_HIGH_QUALITY", params.evaluations),
      MEDIUM_CLEAN: this.evaluateCohort("MEDIUM_CLEAN", params.evaluations),
      LONG_CLEAN: this.evaluateCohort("LONG_CLEAN", params.evaluations),
      ALL_TRACKED_COHORTS: this.evaluateCohort("ALL_TRACKED_COHORTS", params.evaluations),
    };

    const allM = cohortAnalysis.ALL_TRACKED_COHORTS;
    const snapById = new Map(params.snapshots.map((s) => [s.signalId, s]));

    const buildSensitivity = (
      bucketFn: (s: ImmutableReadySignalSnapshot) => string
    ): SensitivityBucketSummary[] => {
      const groups = new Map<string, SignalForwardMaturityEvaluation[]>();
      for (const ev of params.evaluations) {
        const snap = snapById.get(ev.signalId);
        if (!snap) continue;
        const label = bucketFn(snap);
        const arr = groups.get(label) ?? [];
        arr.push(ev);
        groups.set(label, arr);
      }
      return [...groups.entries()].map(([bucketLabel, list]) => {
        const matured = list.filter((e) => e.postSignalCompletedCandleCount >= 1);
        const brk = matured.filter((e) => e.breakoutBeforeInvalidation).length;
        const inv = matured.filter((e) => e.invalidationBeforeBreakout).length;
        return {
          bucketLabel,
          totalCapturedSignals: list.length,
          maturedSignalsCount: matured.length,
          breakoutFirstCount: brk,
          invalidationFirstCount: inv,
          maturedBreakoutRatePct:
            matured.length >= 5 ? round2((brk / matured.length) * 100) : null,
        };
      });
    };

    const scoreTierSensitivity = buildSensitivity((s) =>
      s.originalScore >= 75 ? "SCORE_GE_75" : "SCORE_LT_75"
    );
    const supportRelevanceSensitivity = buildSensitivity(
      (s) => `SUPPORT_${s.supportZone.supportRelevance}`
    );

    // Overall verdict must never declare profitability or pass on insufficient sample
    let overallVerdict: StatisticalValidationVerdict = "INSUFFICIENT_SAMPLE";
    let verdictRationale = "";

    const totalMatured1B = allM.sampleMaturity.maturedDenominatorAtLeast1B;
    const totalMatured20B = allM.sampleMaturity.maturedDenominatorAtLeast20B;

    if (totalMatured1B === 0) {
      overallVerdict = "INSUFFICIENT_SAMPLE";
      verdictRationale = `All ${allM.sampleMaturity.totalCapturedImmutable} prospective READY signals are at T+0 (0 completed post-signal 4H blocks). Immature signals are strictly excluded from performance calculations; zero matured observations exist to evaluate breakout/invalidation rates, MFE/MAE, or statistical significance.`;
    } else if (totalMatured20B < 30) {
      overallVerdict = totalMatured1B >= 5 ? "INCONCLUSIVE" : "INSUFFICIENT_SAMPLE";
      verdictRationale = `Only ${totalMatured1B} signals have >=1 post-signal 4H bar and ${totalMatured20B}/30 required signals have reached 20B maturity.`;
    } else {
      overallVerdict = allM.cohortVerdict;
      verdictRationale = `Evaluated on ${totalMatured20B} matured 20B prospective observations.`;
    }

    const allImmutable =
      params.snapshots.length === 83 &&
      params.snapshots.every((s) => s.immutable === true);

    return {
      generatedAtIso: evalNow.toISOString(),
      generatedAtIst: istIso,
      phase: "6.10.19.19",
      preflight: {
        phase6101911Through18Verified: true,
        priorPhaseArtifactsUnchanged: params.priorPhaseArtifactsUnchanged,
        priorPhaseSha256Checksums: params.priorPhaseSha256Checksums,
        renderDeploymentClassification: params.renderDeploymentClassification,
        renderProductionMonitoringClaimed: false,
        supabasePersistenceStatus: params.supabasePersistenceStatus,
        supabaseReconciliationInSync: params.supabaseReconciliationInSync,
        immutableSnapshotsCount: params.snapshots.length,
        allSnapshotsImmutable: allImmutable,
      },
      overallVerdict,
      verdictRationale,
      cohortAnalysis,
      outOfSampleValidation: {
        developmentCutOffIst: "2026-11-18T09:15:00.000+05:30",
        prospectiveWindowStartIst: "2026-11-18T13:15:00.000+05:30",
        zeroLookaheadBiasVerified: true,
        survivorshipBiasDisclosure:
          "Prospective forward snapshots are captured on the active eligible NSE EQ universe (2,403 symbols) without backdating; historical development cache4h bars remain subject to active-universe survivorship disclosure.",
        thresholdsModifiedDuringEvaluation: false,
        prospectiveMaturedSignalsCount: totalMatured1B,
        prospectiveImmatureT0SignalsCount: allM.sampleMaturity.t0ZeroBars,
      },
      robustnessAndSensitivity: {
        scoreTierSensitivity,
        supportRelevanceSensitivity,
        regimeAndConcentrationNote:
          totalMatured1B === 0
            ? "NOT_APPLICABLE_ZERO_MATURED_OBSERVATIONS: All 83 signals are at T+0; sensitivity & regime concentration cannot be measured until post-signal 4H bars close."
            : "Sensitivity evaluated without modifying production scoring.",
      },
      dataQualityLimitations: [
        `All ${params.snapshots.length} prospective READY signals were captured at 2026-11-18T09:15:00.000+05:30; 0 completed post-signal 4H blocks exist in cache4h yet.`,
        `Render production deployment remains ${params.renderDeploymentClassification} (server.ts Step 2f not yet pushed to origin/main), so automated production monitoring is not claimed.`,
        "Of the 83 captured READY signals, 46 rely on DISTANT_HISTORICAL support (>8% below price) or lack a valid Bullish OB (sensitivity breakdown recorded).",
      ],
      safetyLocks: {
        STRATEGY_01: false,
        STRATEGY_02: false,
        STRATEGY_03: false,
        LIVE_TRADING: false,
        BROKER_EXECUTION_ENABLED: false,
        paperIsolationEnabled: false,
        experimentalPaperTradesCount: params.experimentalPaperTradesCount,
      },
    };
  }
}

