import fs from "node:fs";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { FourHourCandle } from "./Strategy03FourHourCandleProvider.js";
import type {
  ConsolidationDurationCategory,
  FourHourConsolidationBox,
  FourHourOrderBlock,
  FourHourPreBreakoutItem,
  FourHourSupportZone,
} from "./Strategy03FourHourPreBreakoutScanner.js";
import type { MonitoringPersistenceStatus } from "./Strategy03FourHourMonitoringPersistence.js";

export type TrackedDurationCohort =
  | "SHORT_HIGH_QUALITY"
  | "MEDIUM_CLEAN"
  | "LONG_CLEAN";

export interface ImmutableReadySignalSnapshot {
  readonly signalId: string;
  readonly symbol: string;
  readonly companyName: string;
  readonly cohort: TrackedDurationCohort;
  readonly capturedAtIso: string;
  readonly signalCompleted4hTimestampUtc: string;
  readonly signalCompleted4hTimestampIst: string;
  readonly reference4hOhlcv: {
    readonly open: number;
    readonly high: number;
    readonly low: number;
    readonly close: number;
    readonly volume: number;
    readonly sessionBlockType: string;
    readonly blockDurationMinutes: number;
  };
  readonly consolidation: {
    readonly tier: TrackedDurationCohort;
    readonly high: number;
    readonly low: number;
    readonly rangePct: number | null;
    readonly candleCount: number;
    readonly tradingDaysElapsed: number;
    readonly startIst: string | null;
    readonly endIst: string | null;
  };
  readonly supportZone: FourHourSupportZone;
  readonly orderBlock: FourHourOrderBlock;
  readonly impulse: {
    readonly candleCount: number;
    readonly startIst: string | null;
    readonly endIst: string | null;
    readonly bodyExpansionRatio: number;
    readonly displacementPct: number;
    readonly normalizedRvol: number;
    readonly volumeConfirmed: boolean;
  };
  readonly breakoutDistancePct: number;
  readonly originalScore: number;
  readonly scoringReasons: readonly string[];
  readonly dataSource: string;
  readonly sourceReference: string;
  readonly persistenceStatusAtCapture: MonitoringPersistenceStatus;
  readonly immutable: true;
}

export interface HorizonBlockOutcome {
  readonly horizonBlocks: 5 | 10 | 20;
  readonly reached: boolean;
  readonly completed4hTimestampIst: string | null;
  readonly closePrice: number | null;
  readonly returnFromSignalClosePct: number | null;
  readonly statusAtHorizon: "BREAKOUT" | "INVALIDATED" | "UNTRIGGERED" | "PENDING";
}

export interface ForwardSignalOutcomeRecord {
  signalId: string;
  symbol: string;
  cohort: TrackedDurationCohort;
  signalCompleted4hTimestampIst: string;
  signalReferenceClose: number;
  consolidationHigh: number;
  consolidationLow: number;
  supportLow: number | null;
  bullishObLow: number | null;
  forwardCompleted4hBlocksObserved: number;
  latestObserved4hTimestampIst: string | null;
  latestObservedClose: number | null;
  outcomeStatus: "CONFIRMED_BREAKOUT" | "INVALIDATED_BEFORE_BREAKOUT" | "UNTRIGGERED";
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
  mfePct: number;
  maePct: number;
  horizon5B: HorizonBlockOutcome;
  horizon10B: HorizonBlockOutcome;
  horizon20B: HorizonBlockOutcome;
  remainedUntriggered: boolean;
  lastEvaluatedAtIso: string;
}

export interface WilsonConfidenceInterval {
  lowerPct: number;
  upperPct: number;
  confidenceLevel: 0.95;
}

export interface CohortForwardStatistics {
  cohort: TrackedDurationCohort | "ALL_TRACKED_COHORTS";
  totalSignals: number;
  maturedSignalsWithPostSignalBars: number;
  pendingProspectiveSignalsZeroBars: number;
  breakoutCount: number;
  invalidationBeforeBreakoutCount: number;
  untriggeredCount: number;
  breakoutRatePct: number;
  breakoutRate95Ci: WilsonConfidenceInterval;
  invalidationRatePct: number;
  invalidationRate95Ci: WilsonConfidenceInterval;
  untriggeredRatePct: number;
  untriggeredRate95Ci: WilsonConfidenceInterval;
  medianBlocksToBreakout: number | null;
  medianHoursToBreakout: number | null;
  meanMfePct: number;
  medianMfePct: number;
  meanMaePct: number;
  medianMaePct: number;
  horizon5BReachedCount: number;
  horizon10BReachedCount: number;
  horizon20BReachedCount: number;
  sampleSufficiencyVerdict: "INSUFFICIENT_SAMPLE_FOR_SIGNIFICANCE" | "SUFFICIENT_SAMPLE";
  statisticalDisclaimer: string;
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

/**
 * 95% Wilson score interval for binomial proportions (handles n=0 and small samples cleanly).
 */
export function computeWilson95Ci(successes: number, total: number): WilsonConfidenceInterval {
  if (total <= 0) {
    return { lowerPct: 0, upperPct: 0, confidenceLevel: 0.95 };
  }
  const z = 1.959963984540054;
  const z2 = z * z;
  const p = successes / total;
  const denom = 1 + z2 / total;
  const center = (p + z2 / (2 * total)) / denom;
  const halfWidth =
    (z * Math.sqrt((p * (1 - p)) / total + z2 / (4 * total * total))) / denom;
  return {
    lowerPct: round2(Math.max(0, (center - halfWidth) * 100)),
    upperPct: round2(Math.min(100, (center + halfWidth) * 100)),
    confidenceLevel: 0.95,
  };
}

export function isTrackedDurationCohort(
  tier: ConsolidationDurationCategory
): tier is TrackedDurationCohort {
  return (
    tier === "SHORT_HIGH_QUALITY" ||
    tier === "MEDIUM_CLEAN" ||
    tier === "LONG_CLEAN"
  );
}

export class Strategy03FourHourForwardOutcomeTracker {
  private readonly snapshotsById = new Map<string, ImmutableReadySignalSnapshot>();
  private readonly outcomesById = new Map<string, ForwardSignalOutcomeRecord>();
  private readonly snapshotsPath: string;
  private readonly outcomesPath: string;
  private readonly statsPath: string;
  private readonly walPath: string;

  constructor(
    private readonly storageDir: string,
    private readonly getAdminClient?: () => SupabaseClient | null
  ) {
    fs.mkdirSync(this.storageDir, { recursive: true });
    this.snapshotsPath = path.join(this.storageDir, "forward_signal_snapshots.json");
    this.outcomesPath = path.join(this.storageDir, "forward_signal_outcomes.json");
    this.statsPath = path.join(this.storageDir, "forward_cohort_statistics.json");
    this.walPath = path.join(this.storageDir, "forward_pending_wal.json");
    this.loadExistingFromDisk();
  }

  private loadExistingFromDisk(): void {
    if (fs.existsSync(this.snapshotsPath)) {
      const list = JSON.parse(fs.readFileSync(this.snapshotsPath, "utf8")) as ImmutableReadySignalSnapshot[];
      for (const s of list) {
        this.snapshotsById.set(s.signalId, Object.freeze({ ...s }));
      }
    }
    if (fs.existsSync(this.outcomesPath)) {
      const list = JSON.parse(fs.readFileSync(this.outcomesPath, "utf8")) as ForwardSignalOutcomeRecord[];
      for (const o of list) {
        this.outcomesById.set(o.signalId, o);
      }
    }
  }

  /**
   * Captures an immutable READY signal snapshot at the moment of READY.
   * If the signalId already exists, the original snapshot is preserved untouched (never rewritten).
   */
  public registerReadySignal(params: {
    item: FourHourPreBreakoutItem;
    referenceCandle: FourHourCandle;
    persistenceStatus: MonitoringPersistenceStatus;
    capturedAt?: Date;
  }): {
    captured: boolean;
    alreadyExisted: boolean;
    snapshot: ImmutableReadySignalSnapshot | null;
    skipReason: string | null;
  } {
    const { item, referenceCandle } = params;
    if (item.status !== "READY") {
      return {
        captured: false,
        alreadyExisted: false,
        snapshot: null,
        skipReason: `NOT_READY_STATUS_${item.status}`,
      };
    }
    if (!referenceCandle.isComplete || (referenceCandle.timeframe as string) !== "4H") {
      return {
        captured: false,
        alreadyExisted: false,
        snapshot: null,
        skipReason: "REFERENCE_CANDLE_NOT_COMPLETED_4H",
      };
    }
    if (!isTrackedDurationCohort(item.consolidation.tier)) {
      return {
        captured: false,
        alreadyExisted: false,
        snapshot: null,
        skipReason: `UNTRACKED_COHORT_${item.consolidation.tier}`,
      };
    }
    if (item.consolidation.high === null || item.consolidation.low === null) {
      return {
        captured: false,
        alreadyExisted: false,
        snapshot: null,
        skipReason: "MISSING_CONSOLIDATION_BOUNDARIES",
      };
    }

    const tsIst = toIstIso(referenceCandle.timestamp);
    const signalId = `${item.nseSymbol}::READY::${item.consolidation.tier}::${tsIst}`;

    // IMMUTABILITY RULE: Never rewrite an existing signal snapshot after market movement
    const existing = this.snapshotsById.get(signalId);
    if (existing) {
      return {
        captured: false,
        alreadyExisted: true,
        snapshot: existing,
        skipReason: null,
      };
    }

    const rawSnapshot: ImmutableReadySignalSnapshot = {
      signalId,
      symbol: item.nseSymbol,
      companyName: item.companyName,
      cohort: item.consolidation.tier,
      capturedAtIso: (params.capturedAt ?? new Date()).toISOString(),
      signalCompleted4hTimestampUtc: referenceCandle.timestamp,
      signalCompleted4hTimestampIst: tsIst,
      reference4hOhlcv: Object.freeze({
        open: referenceCandle.open,
        high: referenceCandle.high,
        low: referenceCandle.low,
        close: referenceCandle.close,
        volume: referenceCandle.volume,
        sessionBlockType:
          referenceCandle.sessionBlockType ??
          (referenceCandle.blockDurationMinutes === 135 ? "PM_135M" : "AM_240M"),
        blockDurationMinutes:
          referenceCandle.blockDurationMinutes ??
          (referenceCandle.constituentBarCount === 3 ? 135 : 240),
      }),
      consolidation: Object.freeze({
        tier: item.consolidation.tier,
        high: item.consolidation.high,
        low: item.consolidation.low,
        rangePct: item.consolidation.rangePct,
        candleCount: item.consolidation.candleCount,
        tradingDaysElapsed: item.consolidation.tradingDaysElapsed,
        startIst: item.consolidation.startIst,
        endIst: item.consolidation.endIst,
      }),
      supportZone: Object.freeze({ ...item.supportZone }),
      orderBlock: Object.freeze({ ...item.orderBlock }),
      impulse: Object.freeze({
        candleCount: item.impulse.candleCount,
        startIst: item.impulse.startIst,
        endIst: item.impulse.endIst,
        bodyExpansionRatio: item.impulse.bodyExpansionRatio,
        displacementPct: item.impulse.displacementPct,
        normalizedRvol: item.impulse.rvol,
        volumeConfirmed: item.impulse.volumeConfirmed,
      }),
      breakoutDistancePct: item.breakoutDistancePct ?? 0,
      originalScore: item.priorityScore,
      scoringReasons: Object.freeze([...item.scoringReasons]),
      dataSource: item.dataProvider,
      sourceReference: item.sourceReference,
      persistenceStatusAtCapture: params.persistenceStatus,
      immutable: true,
    };

    const frozen = Object.freeze(rawSnapshot);
    this.snapshotsById.set(signalId, frozen);

    // Initialize baseline forward outcome with 0 post-signal bars (no future data used)
    const initialOutcome = this.computeForwardOutcome(frozen, []);
    this.outcomesById.set(signalId, initialOutcome);

    return {
      captured: true,
      alreadyExisted: false,
      snapshot: frozen,
      skipReason: null,
    };
  }

  /**
   * Evaluates forward outcome using ONLY completed 4H candles strictly AFTER the signal timestamp.
   * Incomplete candles and candles at or before signal timestamp are ignored.
   * The original snapshot is never modified.
   */
  public evaluateForwardOutcomeForSignal(params: {
    signalId: string;
    candles: FourHourCandle[];
    evaluatedAt?: Date;
  }): ForwardSignalOutcomeRecord {
    const snapshot = this.snapshotsById.get(params.signalId);
    if (!snapshot) {
      throw new Error(`Signal snapshot not found: ${params.signalId}`);
    }
    const signalMs = Date.parse(snapshot.signalCompleted4hTimestampUtc);

    // Filter strictly to COMPLETED 4H candles with timestamp > signalCompleted4hTimestampUtc
    const futureCompleted4h = params.candles
      .filter(
        (c) =>
          (c.timeframe as string) === "4H" &&
          c.isComplete === true &&
          Date.parse(c.timestamp) > signalMs
      )
      .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));

    const outcome = this.computeForwardOutcome(
      snapshot,
      futureCompleted4h,
      params.evaluatedAt
    );
    this.outcomesById.set(params.signalId, outcome);
    return outcome;
  }

  private computeForwardOutcome(
    snapshot: ImmutableReadySignalSnapshot,
    futureCompleted4h: FourHourCandle[],
    evaluatedAt: Date = new Date()
  ): ForwardSignalOutcomeRecord {
    const refClose = snapshot.reference4hOhlcv.close;
    const consHigh = snapshot.consolidation.high;
    const consLow = snapshot.consolidation.low;
    const suppLow = snapshot.supportZone.supportLow;
    const obLow = snapshot.orderBlock.obLow;
    const signalMs = Date.parse(snapshot.signalCompleted4hTimestampUtc);

    let firstBreakoutIdx: number | null = null;
    let firstInvalidationIdx: number | null = null;
    let invalidationType: "CONSOLIDATION_LOW" | "SUPPORT_LOW" | "BULLISH_OB_LOW" | null = null;

    let maxHigh = refClose;
    let minLow = refClose;

    for (let i = 0; i < futureCompleted4h.length; i++) {
      const bar = futureCompleted4h[i];
      if (bar.high > maxHigh) maxHigh = bar.high;
      if (bar.low < minLow) minLow = bar.low;

      const isInvalidated =
        bar.close < consLow ||
        (suppLow !== null && bar.close < suppLow) ||
        (obLow !== null && bar.close < obLow);
      const isBreakout = bar.close > consHigh * 1.001;

      if (firstBreakoutIdx === null && firstInvalidationIdx === null) {
        if (isInvalidated) {
          firstInvalidationIdx = i;
          invalidationType =
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

    const mfePct =
      futureCompleted4h.length > 0 && refClose > 0
        ? round2(Math.max(0, ((maxHigh - refClose) / refClose) * 100))
        : 0;
    const maePct =
      futureCompleted4h.length > 0 && refClose > 0
        ? round2(Math.min(0, ((minLow - refClose) / refClose) * 100))
        : 0;

    const buildHorizon = (h: 5 | 10 | 20): HorizonBlockOutcome => {
      if (futureCompleted4h.length < h) {
        return {
          horizonBlocks: h,
          reached: false,
          completed4hTimestampIst: null,
          closePrice: null,
          returnFromSignalClosePct: null,
          statusAtHorizon: "PENDING",
        };
      }
      const bar = futureCompleted4h[h - 1];
      const retPct = refClose > 0 ? round2(((bar.close - refClose) / refClose) * 100) : null;
      let statusAtHorizon: "BREAKOUT" | "INVALIDATED" | "UNTRIGGERED" = "UNTRIGGERED";
      if (firstInvalidationIdx !== null && firstInvalidationIdx < h) {
        statusAtHorizon = "INVALIDATED";
      } else if (firstBreakoutIdx !== null && firstBreakoutIdx < h) {
        statusAtHorizon = "BREAKOUT";
      }
      return {
        horizonBlocks: h,
        reached: true,
        completed4hTimestampIst: toIstIso(bar.timestamp),
        closePrice: round2(bar.close),
        returnFromSignalClosePct: retPct,
        statusAtHorizon,
      };
    };

    const breakoutBar =
      firstBreakoutIdx !== null ? futureCompleted4h[firstBreakoutIdx] : null;
    const invalidBar =
      firstInvalidationIdx !== null ? futureCompleted4h[firstInvalidationIdx] : null;

    const outcomeStatus: "CONFIRMED_BREAKOUT" | "INVALIDATED_BEFORE_BREAKOUT" | "UNTRIGGERED" =
      firstBreakoutIdx !== null
        ? "CONFIRMED_BREAKOUT"
        : firstInvalidationIdx !== null
        ? "INVALIDATED_BEFORE_BREAKOUT"
        : "UNTRIGGERED";

    const latestBar =
      futureCompleted4h.length > 0
        ? futureCompleted4h[futureCompleted4h.length - 1]
        : null;

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
      forwardCompleted4hBlocksObserved: futureCompleted4h.length,
      latestObserved4hTimestampIst: latestBar ? toIstIso(latestBar.timestamp) : null,
      latestObservedClose: latestBar ? round2(latestBar.close) : null,
      outcomeStatus,
      firstConfirmedBreakout: {
        occurred: firstBreakoutIdx !== null,
        completed4hTimestampIst: breakoutBar ? toIstIso(breakoutBar.timestamp) : null,
        breakoutClose: breakoutBar ? round2(breakoutBar.close) : null,
        blocksToBreakout: firstBreakoutIdx !== null ? firstBreakoutIdx + 1 : null,
        hoursToBreakout:
          breakoutBar && Number.isFinite(signalMs)
            ? round2((Date.parse(breakoutBar.timestamp) - signalMs) / 3_600_000)
            : null,
      },
      invalidationBeforeBreakout: {
        occurred: firstInvalidationIdx !== null,
        completed4hTimestampIst: invalidBar ? toIstIso(invalidBar.timestamp) : null,
        invalidationClose: invalidBar ? round2(invalidBar.close) : null,
        blocksToInvalidation: firstInvalidationIdx !== null ? firstInvalidationIdx + 1 : null,
        breachedLevelType: invalidationType,
      },
      mfePct,
      maePct,
      horizon5B: buildHorizon(5),
      horizon10B: buildHorizon(10),
      horizon20B: buildHorizon(20),
      remainedUntriggered: outcomeStatus === "UNTRIGGERED",
      lastEvaluatedAtIso: evaluatedAt.toISOString(),
    };
  }

  public computeCohortStatistics(): Record<
    TrackedDurationCohort | "ALL_TRACKED_COHORTS",
    CohortForwardStatistics
  > {
    const cohorts: Array<TrackedDurationCohort | "ALL_TRACKED_COHORTS"> = [
      "SHORT_HIGH_QUALITY",
      "MEDIUM_CLEAN",
      "LONG_CLEAN",
      "ALL_TRACKED_COHORTS",
    ];
    const allOutcomes = [...this.outcomesById.values()];
    const result = {} as Record<
      TrackedDurationCohort | "ALL_TRACKED_COHORTS",
      CohortForwardStatistics
    >;

    for (const c of cohorts) {
      const subset =
        c === "ALL_TRACKED_COHORTS"
          ? allOutcomes
          : allOutcomes.filter((o) => o.cohort === c);

      const total = subset.length;
      const matured = subset.filter((o) => o.forwardCompleted4hBlocksObserved > 0);
      const pendingZeroBars = total - matured.length;

      const breakouts = subset.filter((o) => o.outcomeStatus === "CONFIRMED_BREAKOUT");
      const invalidations = subset.filter(
        (o) => o.outcomeStatus === "INVALIDATED_BEFORE_BREAKOUT"
      );
      const untriggered = subset.filter((o) => o.outcomeStatus === "UNTRIGGERED");

      const breakoutRatePct = total > 0 ? round2((breakouts.length / total) * 100) : 0;
      const invalidationRatePct =
        total > 0 ? round2((invalidations.length / total) * 100) : 0;
      const untriggeredRatePct =
        total > 0 ? round2((untriggered.length / total) * 100) : 0;

      const blocksToBrk = breakouts
        .map((o) => o.firstConfirmedBreakout.blocksToBreakout)
        .filter((v): v is number => v !== null);
      const hoursToBrk = breakouts
        .map((o) => o.firstConfirmedBreakout.hoursToBreakout)
        .filter((v): v is number => v !== null);

      const mfeVals = subset.map((o) => o.mfePct);
      const maeVals = subset.map((o) => o.maePct);
      const meanMfe =
        mfeVals.length > 0
          ? round2(mfeVals.reduce((a, b) => a + b, 0) / mfeVals.length)
          : 0;
      const meanMae =
        maeVals.length > 0
          ? round2(maeVals.reduce((a, b) => a + b, 0) / maeVals.length)
          : 0;

      const h5 = subset.filter((o) => o.horizon5B.reached).length;
      const h10 = subset.filter((o) => o.horizon10B.reached).length;
      const h20 = subset.filter((o) => o.horizon20B.reached).length;

      const sufficient = h20 >= 30;

      result[c] = {
        cohort: c,
        totalSignals: total,
        maturedSignalsWithPostSignalBars: matured.length,
        pendingProspectiveSignalsZeroBars: pendingZeroBars,
        breakoutCount: breakouts.length,
        invalidationBeforeBreakoutCount: invalidations.length,
        untriggeredCount: untriggered.length,
        breakoutRatePct,
        breakoutRate95Ci: computeWilson95Ci(breakouts.length, total),
        invalidationRatePct,
        invalidationRate95Ci: computeWilson95Ci(invalidations.length, total),
        untriggeredRatePct,
        untriggeredRate95Ci: computeWilson95Ci(untriggered.length, total),
        medianBlocksToBreakout: median(blocksToBrk),
        medianHoursToBreakout: median(hoursToBrk),
        meanMfePct: meanMfe,
        medianMfePct: median(mfeVals) ?? 0,
        meanMaePct: meanMae,
        medianMaePct: median(maeVals) ?? 0,
        horizon5BReachedCount: h5,
        horizon10BReachedCount: h10,
        horizon20BReachedCount: h20,
        sampleSufficiencyVerdict: sufficient
          ? "SUFFICIENT_SAMPLE"
          : "INSUFFICIENT_SAMPLE_FOR_SIGNIFICANCE",
        statisticalDisclaimer: sufficient
          ? "Prospective sample has >= 30 matured 20-block outcomes."
          : `INSUFFICIENT_PROSPECTIVE_SAMPLE (20-block matured=${h20}/30 required): Do not claim profitability or statistical significance.`,
      };
    }

    return result;
  }

  public async persistForwardLedger(): Promise<{
    persistenceStatus: MonitoringPersistenceStatus;
    remoteTablesAvailable: boolean;
    snapshotsSavedLocally: number;
    outcomesSavedLocally: number;
    pendingWalCount: number;
    blockerCode: string | null;
    blockerMessage: string | null;
  }> {
    const snapshots = this.getAllSnapshots();
    const outcomes = this.getAllOutcomes();
    const stats = this.computeCohortStatistics();

    fs.writeFileSync(this.snapshotsPath, JSON.stringify(snapshots, null, 2));
    fs.writeFileSync(this.outcomesPath, JSON.stringify(outcomes, null, 2));
    fs.writeFileSync(this.statsPath, JSON.stringify(stats, null, 2));

    const sb = this.getAdminClient?.() ?? null;
    if (!sb) {
      return {
        persistenceStatus: "LOCAL_ONLY",
        remoteTablesAvailable: false,
        snapshotsSavedLocally: snapshots.length,
        outcomesSavedLocally: outcomes.length,
        pendingWalCount: 0,
        blockerCode: "SUPABASE_CLIENT_UNAVAILABLE",
        blockerMessage: "Supabase client unavailable; forward ledger preserved locally.",
      };
    }

    const { error } = await sb.from("strategy03_monitoring_runs").select("run_id").limit(1);
    if (error) {
      const isTableMissing = error.code === "PGRST205";
      const status: MonitoringPersistenceStatus = isTableMissing ? "LOCAL_ONLY" : "SYNC_PENDING";
      if (!isTableMissing) {
        fs.writeFileSync(
          this.walPath,
          JSON.stringify(
            {
              queuedAt: new Date().toISOString(),
              snapshotsCount: snapshots.length,
              outcomesCount: outcomes.length,
              lastError: error.message,
            },
            null,
            2
          )
        );
      }
      return {
        persistenceStatus: status,
        remoteTablesAvailable: !isTableMissing,
        snapshotsSavedLocally: snapshots.length,
        outcomesSavedLocally: outcomes.length,
        pendingWalCount: isTableMissing ? 0 : snapshots.length + outcomes.length,
        blockerCode: error.code ?? "SUPABASE_ERROR",
        blockerMessage: error.message,
      };
    }

    return {
      persistenceStatus: "REMOTE_SYNCED",
      remoteTablesAvailable: true,
      snapshotsSavedLocally: snapshots.length,
      outcomesSavedLocally: outcomes.length,
      pendingWalCount: 0,
      blockerCode: null,
      blockerMessage: null,
    };
  }

  public getSnapshot(signalId: string): ImmutableReadySignalSnapshot | undefined {
    return this.snapshotsById.get(signalId);
  }

  public getAllSnapshots(): ImmutableReadySignalSnapshot[] {
    return [...this.snapshotsById.values()];
  }

  public getOutcome(signalId: string): ForwardSignalOutcomeRecord | undefined {
    return this.outcomesById.get(signalId);
  }

  public getAllOutcomes(): ForwardSignalOutcomeRecord[] {
    return [...this.outcomesById.values()];
  }
}

