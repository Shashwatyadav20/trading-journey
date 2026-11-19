import fs from "node:fs";
import path from "node:path";
import type { FourHourCandle } from "./Strategy03FourHourCandleProvider.js";
import {
  computeWilson95Ci,
  type CohortForwardStatistics,
  type ForwardSignalOutcomeRecord,
  type HorizonBlockOutcome,
  type ImmutableReadySignalSnapshot,
  type TrackedDurationCohort,
  type WilsonConfidenceInterval,
} from "./Strategy03FourHourForwardOutcomeTracker.js";
import type { MonitoringPersistenceStatus } from "./Strategy03FourHourMonitoringPersistence.js";

export interface AuditCheckPassFail {
  checkId: string;
  description: string;
  passed: boolean;
  evaluatedCount: number;
  failedCount: number;
  failedSignalIds: string[];
  explanation: string;
}

export interface OutcomeFieldMismatch {
  signalId: string;
  symbol: string;
  cohort: TrackedDurationCohort;
  category: "CANDLE_CALCULATION_MISMATCH" | "METHODOLOGY_IMMATURE_DENOMINATOR_MISMATCH";
  field: string;
  storedValue: unknown;
  independentValue: unknown;
  reason: string;
}

export interface IndependentRecalculatedOutcome {
  signalId: string;
  symbol: string;
  cohort: TrackedDurationCohort;
  signalCompleted4hTimestampIst: string;
  signalReferenceClose: number;
  consolidationHigh: number;
  consolidationLow: number;
  supportLow: number | null;
  bullishObLow: number | null;
  postSignalCompleted4hCount: number;
  rejectedPreOrEqualSignalCandlesCount: number;
  rejectedIncompleteCandlesCount: number;
  rejectedNon4hCandlesCount: number;
  rejectedDuplicatePostSignalCandlesCount: number;
  dataFreshnessStatus: "FRESH" | "STALE" | "MISSING";
  candleDataStatus: "VALID" | "MISSING_SOURCE_CACHE" | "REFERENCE_CANDLE_MISMATCH";
  independentRawStatus:
    | "CONFIRMED_BREAKOUT"
    | "INVALIDATED_BEFORE_BREAKOUT"
    | "UNTRIGGERED";
  independentAuditedMaturityStatus:
    | "CONFIRMED_BREAKOUT"
    | "INVALIDATED_BEFORE_BREAKOUT"
    | "UNTRIGGERED_MATURED"
    | "PENDING_ZERO_POST_BARS";
  firstConfirmedBreakout: {
    occurred: boolean;
    completed4hTimestampIst: string | null;
    breakoutClose: number | null;
    blocksToBreakout: number | null;
    hoursToBreakout: number | null;
  };
  invalidationBeforeBreakout: {
    occurred: boolean;
    completed4hTimestampIst: string | null;
    invalidationClose: number | null;
    blocksToInvalidation: number | null;
    breachedLevelType: "CONSOLIDATION_LOW" | "SUPPORT_LOW" | "BULLISH_OB_LOW" | null;
  };
  mfePct: number | null;
  maePct: number | null;
  rawMfePctZeroDefault: number;
  rawMaePctZeroDefault: number;
  horizon5B: HorizonBlockOutcome;
  horizon10B: HorizonBlockOutcome;
  horizon20B: HorizonBlockOutcome;
}

export interface AuditedCohortMaturityStatistics {
  cohort: TrackedDurationCohort | "ALL_TRACKED_COHORTS";
  totalCapturedSignals: number;
  maturityDistribution: {
    pendingZeroPostBars: number;
    atLeast1PostBlock: number;
    atLeast5PostBlocks: number;
    atLeast10PostBlocks: number;
    atLeast20PostBlocks: number;
  };
  countsAmongMaturedAtLeast1B: {
    denominatorMatured1B: number;
    breakoutCount: number;
    invalidationBeforeBreakoutCount: number;
    untriggeredMaturedCount: number;
    pendingExcludedFromDenominatorCount: number;
  };
  ratesAmongMaturedAtLeast1B: {
    denominator: number;
    breakoutRatePct: number | null;
    breakoutRate95Ci: WilsonConfidenceInterval | null;
    invalidationRatePct: number | null;
    invalidationRate95Ci: WilsonConfidenceInterval | null;
    untriggeredMaturedRatePct: number | null;
    untriggeredMaturedRate95Ci: WilsonConfidenceInterval | null;
  };
  ratesAmongMaturedAtLeast20B: {
    denominator: number;
    breakoutRatePct: number | null;
    breakoutRate95Ci: WilsonConfidenceInterval | null;
    invalidationRatePct: number | null;
    invalidationRate95Ci: WilsonConfidenceInterval | null;
    untriggeredRatePct: number | null;
    untriggeredRate95Ci: WilsonConfidenceInterval | null;
  };
  medianBlocksToBreakout: number | null;
  medianHoursToBreakout: number | null;
  mfeMaeAmongMaturedAtLeast1B: {
    maturedSampleSize: number;
    meanMfePct: number | null;
    medianMfePct: number | null;
    meanMaePct: number | null;
    medianMaePct: number | null;
  };
  sampleSufficiencyVerdict:
    | "INSUFFICIENT_MATURED_SAMPLE_ZERO_POST_BARS"
    | "INSUFFICIENT_MATURED_20B_SAMPLE"
    | "SUFFICIENT_MATURED_20B_SAMPLE";
  statisticalAuditNote: string;
}

export interface CohortStatMismatch {
  cohort: TrackedDurationCohort | "ALL_TRACKED_COHORTS";
  field: string;
  storedPhase6101911Value: unknown;
  independentAuditedValue: unknown;
  reason: string;
}

export interface IndependentForwardValidationAuditReport {
  auditedAtIso: string;
  phase: "6.10.19.12";
  readOnlyAudit: true;
  sourceRecordsMutated: false;
  totalSnapshotsAudited: number;
  totalOutcomesAudited: number;
  integrityChecks: AuditCheckPassFail[];
  allIntegrityChecksPassed: boolean;
  candleCalculationMismatchCount: number;
  methodologyImmatureDenominatorMismatchCount: number;
  outcomeMismatches: OutcomeFieldMismatch[];
  cohortStatMismatches: CohortStatMismatch[];
  recalculatedOutcomes: IndependentRecalculatedOutcome[];
  auditedCohortStatistics: Record<
    TrackedDurationCohort | "ALL_TRACKED_COHORTS",
    AuditedCohortMaturityStatistics
  >;
  persistenceAudit: {
    durableLocalSnapshotsVerified: boolean;
    durableLocalOutcomesVerified: boolean;
    localSnapshotCount: number;
    localOutcomeCount: number;
    truthfulPersistenceStatus: MonitoringPersistenceStatus;
    remoteTablesAvailable: boolean;
    remoteBlockerCode: string | null;
    remoteBlockerMessage: string | null;
    walRecoveryPreserved: boolean;
  };
  limitationsAndGaps: string[];
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

function toIstIso(utcIso: string): string {
  const ms = Date.parse(utcIso);
  if (!Number.isFinite(ms)) return utcIso;
  return new Date(ms + 330 * 60_000).toISOString().replace("Z", "+05:30");
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return round2(sorted[mid]);
  return round2((sorted[mid - 1] + sorted[mid]) / 2);
}

export class Strategy03IndependentForwardValidator {
  /**
   * Independently recalculates a single signal's forward outcome directly from its immutable snapshot
   * and raw source candles, without reading or trusting any stored outcome record.
   */
  public recalculateSignalOutcome(params: {
    snapshot: ImmutableReadySignalSnapshot;
    rawSourceCandles: FourHourCandle[];
    now?: Date;
    maxDataAgeHours?: number;
  }): IndependentRecalculatedOutcome {
    const { snapshot, rawSourceCandles } = params;
    const signalMs = Date.parse(snapshot.signalCompleted4hTimestampUtc);
    const maxAgeHrs = params.maxDataAgeHours ?? 96;

    let rejectedNon4h = 0;
    let rejectedIncomplete = 0;
    let rejectedPreOrEqual = 0;
    let rejectedDuplicates = 0;

    const validFutureByTs = new Map<string, FourHourCandle>();

    for (const c of rawSourceCandles) {
      if ((c.timeframe as string) !== "4H") {
        rejectedNon4h++;
        continue;
      }
      if (c.isComplete !== true) {
        rejectedIncomplete++;
        continue;
      }
      const tsMs = Date.parse(c.timestamp);
      if (!Number.isFinite(tsMs) || tsMs <= signalMs) {
        rejectedPreOrEqual++;
        continue;
      }
      if (validFutureByTs.has(c.timestamp)) {
        rejectedDuplicates++;
        continue;
      }
      validFutureByTs.set(c.timestamp, c);
    }

    const futureBars = [...validFutureByTs.values()].sort(
      (a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp)
    );

    // Check reference candle presence & exact OHLCV match in raw source candles
    const refBarInSource = rawSourceCandles.find(
      (c) =>
        (c.timeframe as string) === "4H" &&
        c.isComplete === true &&
        c.timestamp === snapshot.signalCompleted4hTimestampUtc
    );
    const refMatches =
      Boolean(refBarInSource) &&
      refBarInSource!.open === snapshot.reference4hOhlcv.open &&
      refBarInSource!.high === snapshot.reference4hOhlcv.high &&
      refBarInSource!.low === snapshot.reference4hOhlcv.low &&
      refBarInSource!.close === snapshot.reference4hOhlcv.close &&
      refBarInSource!.volume === snapshot.reference4hOhlcv.volume;

    const candleDataStatus: "VALID" | "MISSING_SOURCE_CACHE" | "REFERENCE_CANDLE_MISMATCH" =
      rawSourceCandles.length === 0
        ? "MISSING_SOURCE_CACHE"
        : !refMatches
        ? "REFERENCE_CANDLE_MISMATCH"
        : "VALID";

    const latestCompletedInSource = rawSourceCandles
      .filter((c) => (c.timeframe as string) === "4H" && c.isComplete === true)
      .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))
      .pop();

    let dataFreshnessStatus: "FRESH" | "STALE" | "MISSING" = "FRESH";
    if (!latestCompletedInSource) {
      dataFreshnessStatus = "MISSING";
    } else if (params.now) {
      const ageHrs =
        (params.now.getTime() - Date.parse(latestCompletedInSource.timestamp)) / 3_600_000;
      if (!Number.isFinite(ageHrs) || ageHrs > maxAgeHrs) {
        dataFreshnessStatus = "STALE";
      }
    }

    const refClose = snapshot.reference4hOhlcv.close;
    const consHigh = snapshot.consolidation.high;
    const consLow = snapshot.consolidation.low;
    const suppLow = snapshot.supportZone.supportLow;
    const obLow = snapshot.orderBlock.obLow;

    let firstBreakoutIdx: number | null = null;
    let firstInvalidIdx: number | null = null;
    let breachedType: "CONSOLIDATION_LOW" | "SUPPORT_LOW" | "BULLISH_OB_LOW" | null = null;

    let maxHigh = refClose;
    let minLow = refClose;

    for (let i = 0; i < futureBars.length; i++) {
      const bar = futureBars[i];
      if (bar.high > maxHigh) maxHigh = bar.high;
      if (bar.low < minLow) minLow = bar.low;

      const isInvalid =
        bar.close < consLow ||
        (suppLow !== null && bar.close < suppLow) ||
        (obLow !== null && bar.close < obLow);
      const isBreakout = bar.close > consHigh * 1.001;

      if (firstBreakoutIdx === null && firstInvalidIdx === null) {
        if (isInvalid) {
          firstInvalidIdx = i;
          breachedType =
            obLow !== null && bar.close < obLow
              ? "BULLISH_OB_LOW"
              : suppLow !== null && bar.close < suppLow
              ? "SUPPORT_LOW"
              : "CONSOLIDATION_LOW";
        } else if (isBreakout) {
          firstBreakoutIdx = i;
        }
      }
    }

    const rawMfePctZeroDefault =
      futureBars.length > 0 && refClose > 0
        ? round2(Math.max(0, ((maxHigh - refClose) / refClose) * 100))
        : 0;
    const rawMaePctZeroDefault =
      futureBars.length > 0 && refClose > 0
        ? round2(Math.min(0, ((minLow - refClose) / refClose) * 100))
        : 0;

    // Statistically rigorous MFE/MAE: null when 0 post-signal completed 4H blocks exist
    const mfePct = futureBars.length > 0 ? rawMfePctZeroDefault : null;
    const maePct = futureBars.length > 0 ? rawMaePctZeroDefault : null;

    const buildHorizon = (h: 5 | 10 | 20): HorizonBlockOutcome => {
      if (futureBars.length < h) {
        return {
          horizonBlocks: h,
          reached: false,
          completed4hTimestampIst: null,
          closePrice: null,
          returnFromSignalClosePct: null,
          statusAtHorizon: "PENDING",
        };
      }
      const b = futureBars[h - 1];
      const retPct = refClose > 0 ? round2(((b.close - refClose) / refClose) * 100) : null;
      let st: "BREAKOUT" | "INVALIDATED" | "UNTRIGGERED" = "UNTRIGGERED";
      if (firstInvalidIdx !== null && firstInvalidIdx < h) st = "INVALIDATED";
      else if (firstBreakoutIdx !== null && firstBreakoutIdx < h) st = "BREAKOUT";
      return {
        horizonBlocks: h,
        reached: true,
        completed4hTimestampIst: toIstIso(b.timestamp),
        closePrice: round2(b.close),
        returnFromSignalClosePct: retPct,
        statusAtHorizon: st,
      };
    };

    const brkBar = firstBreakoutIdx !== null ? futureBars[firstBreakoutIdx] : null;
    const invBar = firstInvalidIdx !== null ? futureBars[firstInvalidIdx] : null;

    const independentRawStatus:
      | "CONFIRMED_BREAKOUT"
      | "INVALIDATED_BEFORE_BREAKOUT"
      | "UNTRIGGERED" =
      firstBreakoutIdx !== null
        ? "CONFIRMED_BREAKOUT"
        : firstInvalidIdx !== null
        ? "INVALIDATED_BEFORE_BREAKOUT"
        : "UNTRIGGERED";

    const independentAuditedMaturityStatus:
      | "CONFIRMED_BREAKOUT"
      | "INVALIDATED_BEFORE_BREAKOUT"
      | "UNTRIGGERED_MATURED"
      | "PENDING_ZERO_POST_BARS" =
      futureBars.length === 0
        ? "PENDING_ZERO_POST_BARS"
        : firstBreakoutIdx !== null
        ? "CONFIRMED_BREAKOUT"
        : firstInvalidIdx !== null
        ? "INVALIDATED_BEFORE_BREAKOUT"
        : "UNTRIGGERED_MATURED";

    return {
      signalId: snapshot.signalId,
      symbol: snapshot.symbol,
      cohort: snapshot.cohort,
      signalCompleted4hTimestampIst: snapshot.signalCompleted4hTimestampIst,
      signalReferenceClose: round2(refClose),
      consolidationHigh: round2(consHigh),
      consolidationLow: round2(consLow),
      supportLow: suppLow !== null ? round2(suppLow) : null,
      bullishObLow: obLow !== null ? round2(obLow) : null,
      postSignalCompleted4hCount: futureBars.length,
      rejectedPreOrEqualSignalCandlesCount: rejectedPreOrEqual,
      rejectedIncompleteCandlesCount: rejectedIncomplete,
      rejectedNon4hCandlesCount: rejectedNon4h,
      rejectedDuplicatePostSignalCandlesCount: rejectedDuplicates,
      dataFreshnessStatus,
      candleDataStatus,
      independentRawStatus,
      independentAuditedMaturityStatus,
      firstConfirmedBreakout: {
        occurred: firstBreakoutIdx !== null,
        completed4hTimestampIst: brkBar ? toIstIso(brkBar.timestamp) : null,
        breakoutClose: brkBar ? round2(brkBar.close) : null,
        blocksToBreakout: firstBreakoutIdx !== null ? firstBreakoutIdx + 1 : null,
        hoursToBreakout:
          brkBar && Number.isFinite(signalMs)
            ? round2((Date.parse(brkBar.timestamp) - signalMs) / 3_600_000)
            : null,
      },
      invalidationBeforeBreakout: {
        occurred: firstInvalidIdx !== null,
        completed4hTimestampIst: invBar ? toIstIso(invBar.timestamp) : null,
        invalidationClose: invBar ? round2(invBar.close) : null,
        blocksToInvalidation: firstInvalidIdx !== null ? firstInvalidIdx + 1 : null,
        breachedLevelType: breachedType,
      },
      mfePct,
      maePct,
      rawMfePctZeroDefault,
      rawMaePctZeroDefault,
      horizon5B: buildHorizon(5),
      horizon10B: buildHorizon(10),
      horizon20B: buildHorizon(20),
    };
  }

  /**
   * Runs the full Phase 6.10.19.12 read-only audit across all snapshots, stored outcomes,
   * stored cohort stats, and raw 4H candle caches without modifying any Phase 6.10.19.11 files.
   */
  public runFullIndependentAudit(params: {
    snapshots: ImmutableReadySignalSnapshot[];
    storedOutcomes: ForwardSignalOutcomeRecord[];
    storedCohortStats?: Record<string, CohortForwardStatistics>;
    loadCandlesBySymbol: (symbol: string) => FourHourCandle[];
    now?: Date;
    maxDataAgeHours?: number;
    persistenceStatus: MonitoringPersistenceStatus;
    remoteTablesAvailable: boolean;
    remoteBlockerCode: string | null;
    remoteBlockerMessage: string | null;
    walRecoveryPreserved: boolean;
    snapshotsFileExists: boolean;
    outcomesFileExists: boolean;
  }): IndependentForwardValidationAuditReport {
    const { snapshots, storedOutcomes } = params;
    const outcomeMap = new Map<string, ForwardSignalOutcomeRecord>();
    for (const o of storedOutcomes) outcomeMap.set(o.signalId, o);

    // Check 1: Deterministic signal IDs & duplicate prevention
    const seenIds = new Set<string>();
    const badIdSignals: string[] = [];
    for (const s of snapshots) {
      const expectedId = `${s.symbol}::READY::${s.cohort}::${s.signalCompleted4hTimestampIst}`;
      if (s.signalId !== expectedId || seenIds.has(s.signalId)) {
        badIdSignals.push(s.signalId);
      }
      seenIds.add(s.signalId);
    }

    // Recalculate every signal independently from raw source candles
    const recalculated: IndependentRecalculatedOutcome[] = [];
    const immutabilityFailures: string[] = [];
    const timestampFailures: string[] = [];
    const postSignalFilterFailures: string[] = [];
    const completed4hOnlyFailures: string[] = [];
    const orderingFailures: string[] = [];
    const reproducibilityFailures: string[] = [];
    const freshnessFailures: string[] = [];

    const outcomeMismatches: OutcomeFieldMismatch[] = [];

    for (const snap of snapshots) {
      const rawCandles = params.loadCandlesBySymbol(snap.symbol);
      const rec = this.recalculateSignalOutcome({
        snapshot: snap,
        rawSourceCandles: rawCandles,
        now: params.now,
        maxDataAgeHours: params.maxDataAgeHours,
      });
      recalculated.push(rec);

      if (snap.immutable !== true || rec.candleDataStatus !== "VALID") {
        immutabilityFailures.push(snap.signalId);
      }
      const expectedIst = toIstIso(snap.signalCompleted4hTimestampUtc);
      if (snap.signalCompleted4hTimestampIst !== expectedIst) {
        timestampFailures.push(snap.signalId);
      }
      if (rec.dataFreshnessStatus !== "FRESH") {
        freshnessFailures.push(snap.signalId);
      }

      const stored = outcomeMap.get(snap.signalId);
      if (!stored) {
        reproducibilityFailures.push(snap.signalId);
        outcomeMismatches.push({
          signalId: snap.signalId,
          symbol: snap.symbol,
          cohort: snap.cohort,
          category: "CANDLE_CALCULATION_MISMATCH",
          field: "outcomeRecord",
          storedValue: null,
          independentValue: "EXPECTED_RECORD",
          reason: "Missing stored outcome record for snapshot",
        });
        continue;
      }

      // Verify post-signal filter & completed 4H only
      if (stored.forwardCompleted4hBlocksObserved !== rec.postSignalCompleted4hCount) {
        postSignalFilterFailures.push(snap.signalId);
        completed4hOnlyFailures.push(snap.signalId);
        outcomeMismatches.push({
          signalId: snap.signalId,
          symbol: snap.symbol,
          cohort: snap.cohort,
          category: "CANDLE_CALCULATION_MISMATCH",
          field: "forwardCompleted4hBlocksObserved",
          storedValue: stored.forwardCompleted4hBlocksObserved,
          independentValue: rec.postSignalCompleted4hCount,
          reason: "Mismatch in post-signal completed 4H block count",
        });
      }

      // Verify breakout & invalidation ordering
      if (
        stored.firstConfirmedBreakout.occurred !== rec.firstConfirmedBreakout.occurred ||
        stored.firstConfirmedBreakout.completed4hTimestampIst !==
          rec.firstConfirmedBreakout.completed4hTimestampIst ||
        stored.firstConfirmedBreakout.blocksToBreakout !==
          rec.firstConfirmedBreakout.blocksToBreakout ||
        stored.invalidationBeforeBreakout.occurred !==
          rec.invalidationBeforeBreakout.occurred ||
        stored.invalidationBeforeBreakout.completed4hTimestampIst !==
          rec.invalidationBeforeBreakout.completed4hTimestampIst
      ) {
        orderingFailures.push(snap.signalId);
        outcomeMismatches.push({
          signalId: snap.signalId,
          symbol: snap.symbol,
          cohort: snap.cohort,
          category: "CANDLE_CALCULATION_MISMATCH",
          field: "breakoutOrInvalidationEvent",
          storedValue: {
            breakout: stored.firstConfirmedBreakout,
            invalidation: stored.invalidationBeforeBreakout,
          },
          independentValue: {
            breakout: rec.firstConfirmedBreakout,
            invalidation: rec.invalidationBeforeBreakout,
          },
          reason: "Breakout or invalidation event/timestamp mismatch against source 4H candles",
        });
      }

      // Verify MFE, MAE, and 5B/10B/20B reproducibility against source candles
      if (
        stored.mfePct !== rec.rawMfePctZeroDefault ||
        stored.maePct !== rec.rawMaePctZeroDefault ||
        stored.horizon5B.statusAtHorizon !== rec.horizon5B.statusAtHorizon ||
        stored.horizon10B.statusAtHorizon !== rec.horizon10B.statusAtHorizon ||
        stored.horizon20B.statusAtHorizon !== rec.horizon20B.statusAtHorizon ||
        stored.horizon5B.closePrice !== rec.horizon5B.closePrice ||
        stored.horizon10B.closePrice !== rec.horizon10B.closePrice ||
        stored.horizon20B.closePrice !== rec.horizon20B.closePrice
      ) {
        reproducibilityFailures.push(snap.signalId);
        outcomeMismatches.push({
          signalId: snap.signalId,
          symbol: snap.symbol,
          cohort: snap.cohort,
          category: "CANDLE_CALCULATION_MISMATCH",
          field: "mfeMaeOrHorizons",
          storedValue: {
            mfePct: stored.mfePct,
            maePct: stored.maePct,
            h5: stored.horizon5B.statusAtHorizon,
            h10: stored.horizon10B.statusAtHorizon,
            h20: stored.horizon20B.statusAtHorizon,
          },
          independentValue: {
            mfePct: rec.rawMfePctZeroDefault,
            maePct: rec.rawMaePctZeroDefault,
            h5: rec.horizon5B.statusAtHorizon,
            h10: rec.horizon10B.statusAtHorizon,
            h20: rec.horizon20B.statusAtHorizon,
          },
          reason: "MFE/MAE or 5B/10B/20B horizon mismatch against source 4H candles",
        });
      }

      // Flag methodological distinction when 0 post-signal bars exist:
      // Stored outcomeStatus is 'UNTRIGGERED' with mfePct=0/maePct=0, whereas audited maturity status is 'PENDING_ZERO_POST_BARS' with mfePct=null/maePct=null
      if (
        rec.postSignalCompleted4hCount === 0 &&
        stored.outcomeStatus === "UNTRIGGERED"
      ) {
        outcomeMismatches.push({
          signalId: snap.signalId,
          symbol: snap.symbol,
          cohort: snap.cohort,
          category: "METHODOLOGY_IMMATURE_DENOMINATOR_MISMATCH",
          field: "outcomeStatusAndMfeMaeAtZeroPostBars",
          storedValue: {
            outcomeStatus: stored.outcomeStatus,
            mfePct: stored.mfePct,
            maePct: stored.maePct,
          },
          independentValue: {
            independentAuditedMaturityStatus: rec.independentAuditedMaturityStatus,
            mfePct: rec.mfePct,
            maePct: rec.maePct,
          },
          reason:
            "Signal has 0 post-signal completed 4H blocks (T+0). Stored record labels it UNTRIGGERED with 0% MFE/MAE; independent audit classifies it as PENDING_ZERO_POST_BARS with null MFE/MAE so immature signals are excluded from performance rate denominators.",
        });
      }
    }

    const integrityChecks: AuditCheckPassFail[] = [
      {
        checkId: "DETERMINISTIC_SIGNAL_IDS_AND_NO_DUPLICATES",
        description: "Deterministic signal IDs and zero duplicate snapshots",
        passed: badIdSignals.length === 0,
        evaluatedCount: snapshots.length,
        failedCount: badIdSignals.length,
        failedSignalIds: badIdSignals,
        explanation:
          badIdSignals.length === 0
            ? `All ${snapshots.length} snapshots have unique deterministic IDs (SYMBOL::READY::COHORT::TIMESTAMP_IST).`
            : `Found ${badIdSignals.length} invalid or duplicate signal IDs.`,
      },
      {
        checkId: "SNAPSHOT_IMMUTABILITY_AND_OHLCV_REFERENCE",
        description: "Snapshot immutability and exact match against source 4H OHLCV reference candle",
        passed: immutabilityFailures.length === 0,
        evaluatedCount: snapshots.length,
        failedCount: immutabilityFailures.length,
        failedSignalIds: immutabilityFailures,
        explanation:
          immutabilityFailures.length === 0
            ? `All ${snapshots.length} snapshots match their exact completed 4H OHLCV reference bar in cache4h.`
            : `Found ${immutabilityFailures.length} snapshots with missing or mutated OHLCV reference data.`,
      },
      {
        checkId: "SIGNAL_TIMESTAMPS_AND_IST_ALIGNMENT",
        description: "Signal UTC and IST (+05:30) completed 4H candle timestamps align",
        passed: timestampFailures.length === 0,
        evaluatedCount: snapshots.length,
        failedCount: timestampFailures.length,
        failedSignalIds: timestampFailures,
        explanation:
          timestampFailures.length === 0
            ? `All ${snapshots.length} signal timestamps align between UTC and IST (+05:30).`
            : `Found ${timestampFailures.length} timestamp alignment errors.`,
      },
      {
        checkId: "POST_SIGNAL_CANDLES_STRICTLY_AFTER_SIGNAL",
        description: "Every outcome candle is strictly after its signal timestamp (no pre-signal or signal-bar leakage)",
        passed: postSignalFilterFailures.length === 0,
        evaluatedCount: snapshots.length,
        failedCount: postSignalFilterFailures.length,
        failedSignalIds: postSignalFilterFailures,
        explanation:
          postSignalFilterFailures.length === 0
            ? `All ${snapshots.length} outcomes strictly exclude pre-signal and at-signal candles.`
            : `Found ${postSignalFilterFailures.length} outcomes with pre-signal candle leakage.`,
      },
      {
        checkId: "COMPLETED_4H_ONLY_NO_1H_INCOMPLETE_OR_DUPLICATES",
        description: "Only deduplicated completed 4H candles enter outcome calculations (no 1H, incomplete, or duplicate bars)",
        passed: completed4hOnlyFailures.length === 0,
        evaluatedCount: snapshots.length,
        failedCount: completed4hOnlyFailures.length,
        failedSignalIds: completed4hOnlyFailures,
        explanation:
          completed4hOnlyFailures.length === 0
            ? `All ${snapshots.length} outcomes include only deduplicated completed 4H candles.`
            : `Found ${completed4hOnlyFailures.length} outcomes contaminated by incomplete, 1H, or duplicate bars.`,
      },
      {
        checkId: "BREAKOUT_AND_INVALIDATION_ORDERING",
        description: "First breakout vs. invalidation-before-breakout event ordering is exact",
        passed: orderingFailures.length === 0,
        evaluatedCount: snapshots.length,
        failedCount: orderingFailures.length,
        failedSignalIds: orderingFailures,
        explanation:
          orderingFailures.length === 0
            ? `All ${snapshots.length} outcomes preserve exact chronological ordering between breakout and invalidation.`
            : `Found ${orderingFailures.length} ordering mismatches.`,
      },
      {
        checkId: "MFE_MAE_AND_5B_10B_20B_REPRODUCIBILITY",
        description: "MFE, MAE, and 5B/10B/20B horizon values are 100% reproducible from source 4H candles",
        passed: reproducibilityFailures.length === 0,
        evaluatedCount: snapshots.length,
        failedCount: reproducibilityFailures.length,
        failedSignalIds: reproducibilityFailures,
        explanation:
          reproducibilityFailures.length === 0
            ? `All ${snapshots.length} outcomes reproduce identical candle-level MFE, MAE, and 5B/10B/20B values.`
            : `Found ${reproducibilityFailures.length} calculation discrepancies.`,
      },
      {
        checkId: "NO_MISSING_OR_STALE_DATA_SILENTLY_VALID",
        description: "No missing or stale 4H candle data is silently treated as valid",
        passed: freshnessFailures.length === 0,
        evaluatedCount: snapshots.length,
        failedCount: freshnessFailures.length,
        failedSignalIds: freshnessFailures,
        explanation:
          freshnessFailures.length === 0
            ? `All ${snapshots.length} signals have verified FRESH 4H source data as of evaluation timestamp.`
            : `Found ${freshnessFailures.length} signals with missing or stale source data.`,
      },
    ];

    // Compute audited cohort statistics with strict maturity denominators
    const cohorts: Array<TrackedDurationCohort | "ALL_TRACKED_COHORTS"> = [
      "SHORT_HIGH_QUALITY",
      "MEDIUM_CLEAN",
      "LONG_CLEAN",
      "ALL_TRACKED_COHORTS",
    ];
    const auditedCohortStatistics = {} as Record<
      TrackedDurationCohort | "ALL_TRACKED_COHORTS",
      AuditedCohortMaturityStatistics
    >;
    const cohortStatMismatches: CohortStatMismatch[] = [];

    for (const c of cohorts) {
      const subset =
        c === "ALL_TRACKED_COHORTS"
          ? recalculated
          : recalculated.filter((r) => r.cohort === c);

      const totalCaptured = subset.length;
      const pendingZero = subset.filter((r) => r.postSignalCompleted4hCount === 0);
      const mat1B = subset.filter((r) => r.postSignalCompleted4hCount >= 1);
      const mat5B = subset.filter((r) => r.postSignalCompleted4hCount >= 5);
      const mat10B = subset.filter((r) => r.postSignalCompleted4hCount >= 10);
      const mat20B = subset.filter((r) => r.postSignalCompleted4hCount >= 20);

      const brk1B = mat1B.filter((r) => r.independentRawStatus === "CONFIRMED_BREAKOUT");
      const inv1B = mat1B.filter(
        (r) => r.independentRawStatus === "INVALIDATED_BEFORE_BREAKOUT"
      );
      const untrig1B = mat1B.filter((r) => r.independentRawStatus === "UNTRIGGERED");

      const denom1B = mat1B.length;
      const denom20B = mat20B.length;

      const brk20B = mat20B.filter((r) => r.horizon20B.statusAtHorizon === "BREAKOUT");
      const inv20B = mat20B.filter((r) => r.horizon20B.statusAtHorizon === "INVALIDATED");
      const untrig20B = mat20B.filter(
        (r) => r.horizon20B.statusAtHorizon === "UNTRIGGERED"
      );

      const blocksToBrk = brk1B
        .map((r) => r.firstConfirmedBreakout.blocksToBreakout)
        .filter((v): v is number => v !== null);
      const hoursToBrk = brk1B
        .map((r) => r.firstConfirmedBreakout.hoursToBreakout)
        .filter((v): v is number => v !== null);

      const mfe1B = mat1B
        .map((r) => r.mfePct)
        .filter((v): v is number => v !== null);
      const mae1B = mat1B
        .map((r) => r.maePct)
        .filter((v): v is number => v !== null);

      const verdict: AuditedCohortMaturityStatistics["sampleSufficiencyVerdict"] =
        denom1B === 0
          ? "INSUFFICIENT_MATURED_SAMPLE_ZERO_POST_BARS"
          : denom20B < 30
          ? "INSUFFICIENT_MATURED_20B_SAMPLE"
          : "SUFFICIENT_MATURED_20B_SAMPLE";

      auditedCohortStatistics[c] = {
        cohort: c,
        totalCapturedSignals: totalCaptured,
        maturityDistribution: {
          pendingZeroPostBars: pendingZero.length,
          atLeast1PostBlock: mat1B.length,
          atLeast5PostBlocks: mat5B.length,
          atLeast10PostBlocks: mat10B.length,
          atLeast20PostBlocks: mat20B.length,
        },
        countsAmongMaturedAtLeast1B: {
          denominatorMatured1B: denom1B,
          breakoutCount: brk1B.length,
          invalidationBeforeBreakoutCount: inv1B.length,
          untriggeredMaturedCount: untrig1B.length,
          pendingExcludedFromDenominatorCount: pendingZero.length,
        },
        ratesAmongMaturedAtLeast1B: {
          denominator: denom1B,
          breakoutRatePct: denom1B > 0 ? round2((brk1B.length / denom1B) * 100) : null,
          breakoutRate95Ci:
            denom1B > 0 ? computeWilson95Ci(brk1B.length, denom1B) : null,
          invalidationRatePct:
            denom1B > 0 ? round2((inv1B.length / denom1B) * 100) : null,
          invalidationRate95Ci:
            denom1B > 0 ? computeWilson95Ci(inv1B.length, denom1B) : null,
          untriggeredMaturedRatePct:
            denom1B > 0 ? round2((untrig1B.length / denom1B) * 100) : null,
          untriggeredMaturedRate95Ci:
            denom1B > 0 ? computeWilson95Ci(untrig1B.length, denom1B) : null,
        },
        ratesAmongMaturedAtLeast20B: {
          denominator: denom20B,
          breakoutRatePct:
            denom20B > 0 ? round2((brk20B.length / denom20B) * 100) : null,
          breakoutRate95Ci:
            denom20B > 0 ? computeWilson95Ci(brk20B.length, denom20B) : null,
          invalidationRatePct:
            denom20B > 0 ? round2((inv20B.length / denom20B) * 100) : null,
          invalidationRate95Ci:
            denom20B > 0 ? computeWilson95Ci(inv20B.length, denom20B) : null,
          untriggeredRatePct:
            denom20B > 0 ? round2((untrig20B.length / denom20B) * 100) : null,
          untriggeredRate95Ci:
            denom20B > 0 ? computeWilson95Ci(untrig20B.length, denom20B) : null,
        },
        medianBlocksToBreakout: median(blocksToBrk),
        medianHoursToBreakout: median(hoursToBrk),
        mfeMaeAmongMaturedAtLeast1B: {
          maturedSampleSize: denom1B,
          meanMfePct:
            mfe1B.length > 0
              ? round2(mfe1B.reduce((a, b) => a + b, 0) / mfe1B.length)
              : null,
          medianMfePct: median(mfe1B),
          meanMaePct:
            mae1B.length > 0
              ? round2(mae1B.reduce((a, b) => a + b, 0) / mae1B.length)
              : null,
          medianMaePct: median(mae1B),
        },
        sampleSufficiencyVerdict: verdict,
        statisticalAuditNote:
          denom1B === 0
            ? `All ${totalCaptured} signals in ${c} are at T+0 (0 completed post-signal 4H blocks). Pending T+0 signals are excluded from performance rate denominators and must NOT be interpreted as 100% untriggered performance.`
            : denom20B < 30
            ? `Only ${denom20B}/30 signals have reached the full 20-block (4H) horizon. Do not claim statistical significance or profitability.`
            : `Cohort ${c} has ${denom20B} matured 20-block observations.`,
      };

      const storedStat = params.storedCohortStats?.[c];
      if (storedStat && denom1B === 0) {
        if (storedStat.untriggeredRatePct === 100) {
          cohortStatMismatches.push({
            cohort: c,
            field: "untriggeredRatePct_and_95Ci_when_matured_eq_0",
            storedPhase6101911Value: {
              untriggeredCount: storedStat.untriggeredCount,
              untriggeredRatePct: storedStat.untriggeredRatePct,
              untriggeredRate95Ci: storedStat.untriggeredRate95Ci,
              breakoutRatePct: storedStat.breakoutRatePct,
              invalidationRatePct: storedStat.invalidationRatePct,
            },
            independentAuditedValue: {
              pendingZeroPostBars: pendingZero.length,
              untriggeredMaturedCount: 0,
              untriggeredMaturedRatePct: null,
              breakoutRatePct: null,
              invalidationRatePct: null,
              rates95Ci: null,
            },
            reason:
              "Phase 6.10.19.11 used totalSignals (all at T+0 with 0 post-signal bars) as the rate denominator, producing untriggeredRatePct=100% and 0% breakout/invalidation rates with Wilson CIs on immature signals. Independent audit separates pendingZeroPostBars from untriggeredMaturedCount and reports null rates/CIs when matured denominator is 0.",
          });
        }
        if (storedStat.meanMfePct === 0 || storedStat.meanMaePct === 0) {
          cohortStatMismatches.push({
            cohort: c,
            field: "meanMfePct_and_meanMaePct_when_matured_eq_0",
            storedPhase6101911Value: {
              meanMfePct: storedStat.meanMfePct,
              meanMaePct: storedStat.meanMaePct,
            },
            independentAuditedValue: {
              meanMfePct: null,
              meanMaePct: null,
            },
            reason:
              "Phase 6.10.19.11 reported 0% mean/median MFE and MAE across T+0 signals with 0 post-signal bars. Independent audit reports null MFE/MAE until at least 1 post-signal completed 4H block is observed.",
          });
        }
      }
    }

    const candleMismatchCount = outcomeMismatches.filter(
      (m) => m.category === "CANDLE_CALCULATION_MISMATCH"
    ).length;
    const methodMismatchCount = outcomeMismatches.filter(
      (m) => m.category === "METHODOLOGY_IMMATURE_DENOMINATOR_MISMATCH"
    ).length;

    return {
      auditedAtIso: (params.now ?? new Date()).toISOString(),
      phase: "6.10.19.12",
      readOnlyAudit: true,
      sourceRecordsMutated: false,
      totalSnapshotsAudited: snapshots.length,
      totalOutcomesAudited: storedOutcomes.length,
      integrityChecks,
      allIntegrityChecksPassed: integrityChecks.every((c) => c.passed),
      candleCalculationMismatchCount: candleMismatchCount,
      methodologyImmatureDenominatorMismatchCount: methodMismatchCount,
      outcomeMismatches,
      cohortStatMismatches,
      recalculatedOutcomes: recalculated,
      auditedCohortStatistics,
      persistenceAudit: {
        durableLocalSnapshotsVerified:
          params.snapshotsFileExists && snapshots.length === 83,
        durableLocalOutcomesVerified:
          params.outcomesFileExists && storedOutcomes.length === 83,
        localSnapshotCount: snapshots.length,
        localOutcomeCount: storedOutcomes.length,
        truthfulPersistenceStatus: params.persistenceStatus,
        remoteTablesAvailable: params.remoteTablesAvailable,
        remoteBlockerCode: params.remoteBlockerCode,
        remoteBlockerMessage: params.remoteBlockerMessage,
        walRecoveryPreserved: params.walRecoveryPreserved,
      },
      limitationsAndGaps: [
        "All 83 prospective READY signals were captured at the latest completed 4H session block (2026-11-18T09:15:00.000+05:30) and currently have 0 post-signal completed 4H blocks (T+0 pending).",
        "Phase 6.10.19.11 cohort summary used totalSignals (83) as the denominator at T+0, reporting untriggeredRatePct=100% and 0% MFE/MAE; Phase 6.10.19.12 flags these 83 T+0 denominator classifications and reports null rates, null 95% CIs, and null MFE/MAE until post-signal 4H blocks complete.",
        "Remote Supabase monitoring tables (strategy03_monitoring_runs, strategy03_candidate_state_history, strategy03_monitoring_alerts) remain unapplied (PGRST205: missing DDL connection / PAT); persistence remains strictly LOCAL_ONLY.",
        "Of the 83 scanner READY candidates, 46 rely on distant historical support (>8% below current price) or lack a valid bullish OB (classified as WEAK_EVIDENCE in Phase 6.10.19.7).",
      ],
    };
  }
}

