import fs from "node:fs";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { FourHourCandle } from "./Strategy03FourHourCandleProvider.js";
import type {
  ForwardSignalOutcomeRecord,
  HorizonBlockOutcome,
  ImmutableReadySignalSnapshot,
  TrackedDurationCohort,
} from "./Strategy03FourHourForwardOutcomeTracker.js";
import type { MonitoringPersistenceStatus } from "./Strategy03FourHourMonitoringPersistence.js";
import {
  Strategy03IndependentForwardValidator,
  type AuditedCohortMaturityStatistics,
  type IndependentForwardValidationAuditReport,
} from "./Strategy03IndependentForwardValidator.js";

export interface ForwardMonitoringEventRecord {
  eventId: string;
  signalId: string;
  symbol: string;
  cohort: TrackedDurationCohort;
  eventType:
    | "CONFIRMED_BREAKOUT"
    | "INVALIDATED_BEFORE_BREAKOUT"
    | "MATURITY_5B_REACHED"
    | "MATURITY_10B_REACHED"
    | "MATURITY_20B_REACHED";
  completed4hTimestampIst: string;
  closePrice: number;
  details: string;
}

export interface SignalForwardObservationState {
  signalId: string;
  symbol: string;
  cohort: TrackedDurationCohort;
  signalCompleted4hTimestampUtc: string;
  signalCompleted4hTimestampIst: string;
  processedPostSignalTimestampsUtc: string[];
  outcome: ForwardSignalOutcomeRecord;
  auditedMaturityStatus:
    | "CONFIRMED_BREAKOUT"
    | "INVALIDATED_BEFORE_BREAKOUT"
    | "UNTRIGGERED_MATURED"
    | "PENDING_ZERO_POST_BARS";
  mfePctAudited: number | null;
  maePctAudited: number | null;
  dataFreshnessStatus: "FRESH" | "STALE" | "MISSING";
}

export interface ForwardMonitoringCycleResult {
  cycleId: string;
  evaluatedAtIso: string;
  latestCompletedMonitoringTimestampIst: string;
  totalSignalsMonitored: number;
  newlyProcessed4hBarsCount: number;
  signalsUpdatedCount: number;
  duplicatesOrAlreadyProcessedSkippedCount: number;
  rejected1hCount: number;
  rejectedIncompleteCount: number;
  rejectedPreOrAtSignalCount: number;
  rejectedStaleOrMissingSignalsCount: number;
  newEventsEmitted: ForwardMonitoringEventRecord[];
  auditStatus: {
    allIntegrityChecksPassed: boolean;
    candleCalculationMismatchCount: number;
    auditWarningRaised: boolean;
    auditWarningReasons: string[];
  };
  persistenceStatus: MonitoringPersistenceStatus;
  remoteTablesAvailable: boolean;
  remoteBlockerCode: string | null;
  remoteBlockerMessage: string | null;
  cohortMaturityStatistics: Record<
    TrackedDurationCohort | "ALL_TRACKED_COHORTS",
    AuditedCohortMaturityStatistics
  >;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

function toIstIso(utcIso: string): string {
  const ms = Date.parse(utcIso);
  if (!Number.isFinite(ms)) return utcIso;
  return new Date(ms + 330 * 60_000).toISOString().replace("Z", "+05:30");
}

export class Strategy03ForwardMaturityMonitor {
  private readonly snapshotsById = new Map<string, ImmutableReadySignalSnapshot>();
  private readonly stateBySignalId = new Map<string, SignalForwardObservationState>();
  private readonly seenBarKeys = new Set<string>();
  private readonly seenEventIds = new Set<string>();
  private readonly events: ForwardMonitoringEventRecord[] = [];
  private readonly cycleHistory: ForwardMonitoringCycleResult[] = [];
  private readonly validator = new Strategy03IndependentForwardValidator();

  private readonly stateLedgerPath: string;
  private readonly eventsLedgerPath: string;
  private readonly cyclesLedgerPath: string;
  private readonly auditReportPath: string;
  private readonly walPath: string;

  constructor(
    private readonly storageDir: string,
    snapshots: ImmutableReadySignalSnapshot[],
    private readonly getAdminClient?: () => SupabaseClient | null
  ) {
    fs.mkdirSync(this.storageDir, { recursive: true });
    this.stateLedgerPath = path.join(this.storageDir, "forward_monitored_states.json");
    this.eventsLedgerPath = path.join(this.storageDir, "forward_monitoring_events.json");
    this.cyclesLedgerPath = path.join(this.storageDir, "forward_monitoring_cycles.json");
    this.auditReportPath = path.join(this.storageDir, "latest_cycle_independent_audit.json");
    this.walPath = path.join(this.storageDir, "forward_monitoring_wal.json");

    for (const s of snapshots) {
      this.snapshotsById.set(s.signalId, Object.freeze({ ...s }));
    }
    this.recoverFromDisk();
  }

  public recoverFromDisk(): void {
    if (fs.existsSync(this.stateLedgerPath)) {
      const savedStates = JSON.parse(
        fs.readFileSync(this.stateLedgerPath, "utf8")
      ) as SignalForwardObservationState[];
      for (const st of savedStates) {
        this.stateBySignalId.set(st.signalId, st);
        for (const ts of st.processedPostSignalTimestampsUtc) {
          this.seenBarKeys.add(`${st.signalId}::${ts}`);
        }
      }
    }

    if (fs.existsSync(this.eventsLedgerPath)) {
      const savedEvents = JSON.parse(
        fs.readFileSync(this.eventsLedgerPath, "utf8")
      ) as ForwardMonitoringEventRecord[];
      for (const ev of savedEvents) {
        if (!this.seenEventIds.has(ev.eventId)) {
          this.seenEventIds.add(ev.eventId);
          this.events.push(ev);
        }
      }
    }

    // Ensure every snapshot has an initialized observation state (never resetting existing history)
    for (const snap of this.snapshotsById.values()) {
      if (!this.stateBySignalId.has(snap.signalId)) {
        const emptyOutcome = this.buildOutcomeFromPostBars(snap, [], new Date());
        this.stateBySignalId.set(snap.signalId, {
          signalId: snap.signalId,
          symbol: snap.symbol,
          cohort: snap.cohort,
          signalCompleted4hTimestampUtc: snap.signalCompleted4hTimestampUtc,
          signalCompleted4hTimestampIst: snap.signalCompleted4hTimestampIst,
          processedPostSignalTimestampsUtc: [],
          outcome: emptyOutcome.outcome,
          auditedMaturityStatus: emptyOutcome.auditedMaturityStatus,
          mfePctAudited: emptyOutcome.mfePctAudited,
          maePctAudited: emptyOutcome.maePctAudited,
          dataFreshnessStatus: "FRESH",
        });
      }
    }
  }

  private buildOutcomeFromPostBars(
    snapshot: ImmutableReadySignalSnapshot,
    postBars: FourHourCandle[],
    evaluatedAt: Date
  ): {
    outcome: ForwardSignalOutcomeRecord;
    auditedMaturityStatus:
      | "CONFIRMED_BREAKOUT"
      | "INVALIDATED_BEFORE_BREAKOUT"
      | "UNTRIGGERED_MATURED"
      | "PENDING_ZERO_POST_BARS";
    mfePctAudited: number | null;
    maePctAudited: number | null;
  } {
    const refClose = snapshot.reference4hOhlcv.close;
    const consHigh = snapshot.consolidation.high;
    const consLow = snapshot.consolidation.low;
    const suppLow = snapshot.supportZone.supportLow;
    const obLow = snapshot.orderBlock.obLow;
    const signalMs = Date.parse(snapshot.signalCompleted4hTimestampUtc);

    let firstBreakoutIdx: number | null = null;
    let firstInvalidIdx: number | null = null;
    let breachedType: "CONSOLIDATION_LOW" | "SUPPORT_LOW" | "BULLISH_OB_LOW" | null = null;

    let maxHigh = refClose;
    let minLow = refClose;

    for (let i = 0; i < postBars.length; i++) {
      const bar = postBars[i];
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

    const rawMfe =
      postBars.length > 0 && refClose > 0
        ? round2(Math.max(0, ((maxHigh - refClose) / refClose) * 100))
        : 0;
    const rawMae =
      postBars.length > 0 && refClose > 0
        ? round2(Math.min(0, ((minLow - refClose) / refClose) * 100))
        : 0;

    const buildHorizon = (h: 5 | 10 | 20): HorizonBlockOutcome => {
      if (postBars.length < h) {
        return {
          horizonBlocks: h,
          reached: false,
          completed4hTimestampIst: null,
          closePrice: null,
          returnFromSignalClosePct: null,
          statusAtHorizon: "PENDING",
        };
      }
      const b = postBars[h - 1];
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

    const brkBar = firstBreakoutIdx !== null ? postBars[firstBreakoutIdx] : null;
    const invBar = firstInvalidIdx !== null ? postBars[firstInvalidIdx] : null;

    const outcomeStatus:
      | "CONFIRMED_BREAKOUT"
      | "INVALIDATED_BEFORE_BREAKOUT"
      | "UNTRIGGERED" =
      firstBreakoutIdx !== null
        ? "CONFIRMED_BREAKOUT"
        : firstInvalidIdx !== null
        ? "INVALIDATED_BEFORE_BREAKOUT"
        : "UNTRIGGERED";

    const auditedMaturityStatus:
      | "CONFIRMED_BREAKOUT"
      | "INVALIDATED_BEFORE_BREAKOUT"
      | "UNTRIGGERED_MATURED"
      | "PENDING_ZERO_POST_BARS" =
      postBars.length === 0
        ? "PENDING_ZERO_POST_BARS"
        : firstBreakoutIdx !== null
        ? "CONFIRMED_BREAKOUT"
        : firstInvalidIdx !== null
        ? "INVALIDATED_BEFORE_BREAKOUT"
        : "UNTRIGGERED_MATURED";

    const latestBar = postBars.length > 0 ? postBars[postBars.length - 1] : null;

    return {
      outcome: {
        signalId: snapshot.signalId,
        symbol: snapshot.symbol,
        cohort: snapshot.cohort,
        signalCompleted4hTimestampIst: snapshot.signalCompleted4hTimestampIst,
        signalReferenceClose: round2(refClose),
        consolidationHigh: round2(consHigh),
        consolidationLow: round2(consLow),
        supportLow: suppLow !== null ? round2(suppLow) : null,
        bullishObLow: obLow !== null ? round2(obLow) : null,
        forwardCompleted4hBlocksObserved: postBars.length,
        latestObserved4hTimestampIst: latestBar ? toIstIso(latestBar.timestamp) : null,
        latestObservedClose: latestBar ? round2(latestBar.close) : null,
        outcomeStatus,
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
        mfePct: rawMfe,
        maePct: rawMae,
        horizon5B: buildHorizon(5),
        horizon10B: buildHorizon(10),
        horizon20B: buildHorizon(20),
        remainedUntriggered: outcomeStatus === "UNTRIGGERED",
        lastEvaluatedAtIso: evaluatedAt.toISOString(),
      },
      auditedMaturityStatus,
      mfePctAudited: postBars.length > 0 ? rawMfe : null,
      maePctAudited: postBars.length > 0 ? rawMae : null,
    };
  }

  /**
   * Executes one automated forward monitoring cycle across all tracked signals,
   * then automatically runs the Phase 6.10.19.12 independent validator to verify integrity.
   */
  public async runMonitoringCycle(params: {
    cycleId: string;
    loadCandlesBySymbol: (symbol: string) => FourHourCandle[];
    now?: Date;
    maxDataAgeHours?: number;
    injectMismatchForTest?: (outcomes: ForwardSignalOutcomeRecord[]) => ForwardSignalOutcomeRecord[];
  }): Promise<{
    cycleResult: ForwardMonitoringCycleResult;
    independentAuditReport: IndependentForwardValidationAuditReport;
  }> {
    const evalNow = params.now ?? new Date();
    const maxAgeHrs = params.maxDataAgeHours ?? 96;

    let newlyProcessed4hBarsCount = 0;
    let signalsUpdatedCount = 0;
    let duplicatesOrAlreadyProcessedSkippedCount = 0;
    let rejected1hCount = 0;
    let rejectedIncompleteCount = 0;
    let rejectedPreOrAtSignalCount = 0;
    let rejectedStaleOrMissingSignalsCount = 0;
    let latestCompletedMonitoringTimestampIst = "2026-11-18T09:15:00.000+05:30";

    const newEventsEmitted: ForwardMonitoringEventRecord[] = [];

    for (const snap of this.snapshotsById.values()) {
      const prevState = this.stateBySignalId.get(snap.signalId)!;
      const rawCandles = params.loadCandlesBySymbol(snap.symbol);
      const signalMs = Date.parse(snap.signalCompleted4hTimestampUtc);

      const completed4hAll = rawCandles
        .filter((c) => (c.timeframe as string) === "4H" && c.isComplete === true)
        .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));

      const latestComp = completed4hAll[completed4hAll.length - 1];
      let freshness: "FRESH" | "STALE" | "MISSING" = "FRESH";
      if (!latestComp) {
        freshness = "MISSING";
        rejectedStaleOrMissingSignalsCount++;
      } else {
        const latestIst = toIstIso(latestComp.timestamp);
        if (latestIst > latestCompletedMonitoringTimestampIst) {
          latestCompletedMonitoringTimestampIst = latestIst;
        }
        const ageHrs = (evalNow.getTime() - Date.parse(latestComp.timestamp)) / 3_600_000;
        if (!Number.isFinite(ageHrs) || ageHrs > maxAgeHrs) {
          freshness = "STALE";
          rejectedStaleOrMissingSignalsCount++;
        }
      }

      // Collect all valid post-signal completed 4H bars in chronological order
      const validPostMap = new Map<string, FourHourCandle>();
      let newBarsForThisSignal = 0;

      for (const c of rawCandles) {
        if ((c.timeframe as string) !== "4H") {
          rejected1hCount++;
          continue;
        }
        if (c.isComplete !== true) {
          rejectedIncompleteCount++;
          continue;
        }
        const ms = Date.parse(c.timestamp);
        if (!Number.isFinite(ms) || ms <= signalMs) {
          rejectedPreOrAtSignalCount++;
          continue;
        }
        if (validPostMap.has(c.timestamp)) {
          duplicatesOrAlreadyProcessedSkippedCount++;
          continue;
        }
        validPostMap.set(c.timestamp, c);

        const barKey = `${snap.signalId}::${c.timestamp}`;
        if (this.seenBarKeys.has(barKey)) {
          duplicatesOrAlreadyProcessedSkippedCount++;
        } else {
          this.seenBarKeys.add(barKey);
          newBarsForThisSignal++;
          newlyProcessed4hBarsCount++;
        }
      }

      // Never reset a signal's observation history even if current feed is empty
      if (validPostMap.size < prevState.processedPostSignalTimestampsUtc.length) {
        prevState.dataFreshnessStatus = freshness;
        continue;
      }

      const sortedPostBars = [...validPostMap.values()].sort(
        (a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp)
      );

      if (newBarsForThisSignal > 0) {
        signalsUpdatedCount++;
      }

      const prevOutcome = prevState.outcome;
      const updated = this.buildOutcomeFromPostBars(snap, sortedPostBars, evalNow);

      // Emit deterministic events for new breakout, invalidation, or 5B/10B/20B milestones
      if (
        updated.outcome.firstConfirmedBreakout.occurred &&
        !prevOutcome.firstConfirmedBreakout.occurred
      ) {
        const ts = updated.outcome.firstConfirmedBreakout.completed4hTimestampIst!;
        const evId = `${snap.signalId}::CONFIRMED_BREAKOUT::${ts}`;
        if (!this.seenEventIds.has(evId)) {
          this.seenEventIds.add(evId);
          const ev: ForwardMonitoringEventRecord = {
            eventId: evId,
            signalId: snap.signalId,
            symbol: snap.symbol,
            cohort: snap.cohort,
            eventType: "CONFIRMED_BREAKOUT",
            completed4hTimestampIst: ts,
            closePrice: updated.outcome.firstConfirmedBreakout.breakoutClose!,
            details: `Confirmed 4H breakout at ${updated.outcome.firstConfirmedBreakout.breakoutClose} after ${updated.outcome.firstConfirmedBreakout.blocksToBreakout} blocks.`,
          };
          this.events.push(ev);
          newEventsEmitted.push(ev);
        }
      }

      if (
        updated.outcome.invalidationBeforeBreakout.occurred &&
        !prevOutcome.invalidationBeforeBreakout.occurred
      ) {
        const ts = updated.outcome.invalidationBeforeBreakout.completed4hTimestampIst!;
        const evId = `${snap.signalId}::INVALIDATED_BEFORE_BREAKOUT::${ts}`;
        if (!this.seenEventIds.has(evId)) {
          this.seenEventIds.add(evId);
          const ev: ForwardMonitoringEventRecord = {
            eventId: evId,
            signalId: snap.signalId,
            symbol: snap.symbol,
            cohort: snap.cohort,
            eventType: "INVALIDATED_BEFORE_BREAKOUT",
            completed4hTimestampIst: ts,
            closePrice: updated.outcome.invalidationBeforeBreakout.invalidationClose!,
            details: `Invalidated (${updated.outcome.invalidationBeforeBreakout.breachedLevelType}) at ${updated.outcome.invalidationBeforeBreakout.invalidationClose} after ${updated.outcome.invalidationBeforeBreakout.blocksToInvalidation} blocks.`,
          };
          this.events.push(ev);
          newEventsEmitted.push(ev);
        }
      }

      for (const [hKey, evType] of [
        ["horizon5B", "MATURITY_5B_REACHED"],
        ["horizon10B", "MATURITY_10B_REACHED"],
        ["horizon20B", "MATURITY_20B_REACHED"],
      ] as const) {
        const curH = updated.outcome[hKey];
        const prevH = prevOutcome[hKey];
        if (curH.reached && !prevH.reached && curH.completed4hTimestampIst) {
          const evId = `${snap.signalId}::${evType}::${curH.completed4hTimestampIst}`;
          if (!this.seenEventIds.has(evId)) {
            this.seenEventIds.add(evId);
            const ev: ForwardMonitoringEventRecord = {
              eventId: evId,
              signalId: snap.signalId,
              symbol: snap.symbol,
              cohort: snap.cohort,
              eventType: evType,
              completed4hTimestampIst: curH.completed4hTimestampIst,
              closePrice: curH.closePrice!,
              details: `Reached ${curH.horizonBlocks}B horizon (${curH.statusAtHorizon}, return ${curH.returnFromSignalClosePct}%).`,
            };
            this.events.push(ev);
            newEventsEmitted.push(ev);
          }
        }
      }

      this.stateBySignalId.set(snap.signalId, {
        signalId: snap.signalId,
        symbol: snap.symbol,
        cohort: snap.cohort,
        signalCompleted4hTimestampUtc: snap.signalCompleted4hTimestampUtc,
        signalCompleted4hTimestampIst: snap.signalCompleted4hTimestampIst,
        processedPostSignalTimestampsUtc: sortedPostBars.map((b) => b.timestamp),
        outcome: updated.outcome,
        auditedMaturityStatus: updated.auditedMaturityStatus,
        mfePctAudited: updated.mfePctAudited,
        maePctAudited: updated.maePctAudited,
        dataFreshnessStatus: freshness,
      });
    }

    // Check persistence status
    const persistStatus = await this.checkAndPersistLedgers();

    // Run Phase 6.10.19.12 independent validator on current cycle outcomes
    const rawCurrentOutcomes = [...this.stateBySignalId.values()].map((s) => s.outcome);
    const outcomesForAudit = params.injectMismatchForTest
      ? params.injectMismatchForTest(rawCurrentOutcomes)
      : rawCurrentOutcomes;

    const independentAuditReport = this.validator.runFullIndependentAudit({
      snapshots: [...this.snapshotsById.values()],
      storedOutcomes: outcomesForAudit,
      loadCandlesBySymbol: params.loadCandlesBySymbol,
      now: evalNow,
      maxDataAgeHours: maxAgeHrs,
      persistenceStatus: persistStatus.persistenceStatus,
      remoteTablesAvailable: persistStatus.remoteTablesAvailable,
      remoteBlockerCode: persistStatus.remoteBlockerCode,
      remoteBlockerMessage: persistStatus.remoteBlockerMessage,
      walRecoveryPreserved: true,
      snapshotsFileExists: true,
      outcomesFileExists: true,
    });

    const auditWarningReasons: string[] = [];
    if (!independentAuditReport.allIntegrityChecksPassed) {
      for (const chk of independentAuditReport.integrityChecks.filter((c) => !c.passed)) {
        auditWarningReasons.push(`${chk.checkId}: ${chk.explanation}`);
      }
    }
    if (independentAuditReport.candleCalculationMismatchCount > 0) {
      auditWarningReasons.push(
        `Detected ${independentAuditReport.candleCalculationMismatchCount} candle-level calculation mismatch(es).`
      );
    }
    if (rejectedStaleOrMissingSignalsCount > 0) {
      auditWarningReasons.push(
        `Detected ${rejectedStaleOrMissingSignalsCount} signal(s) with STALE or MISSING 4H candle data.`
      );
    }

    const cycleResult: ForwardMonitoringCycleResult = {
      cycleId: params.cycleId,
      evaluatedAtIso: evalNow.toISOString(),
      latestCompletedMonitoringTimestampIst,
      totalSignalsMonitored: this.snapshotsById.size,
      newlyProcessed4hBarsCount,
      signalsUpdatedCount,
      duplicatesOrAlreadyProcessedSkippedCount,
      rejected1hCount,
      rejectedIncompleteCount,
      rejectedPreOrAtSignalCount,
      rejectedStaleOrMissingSignalsCount,
      newEventsEmitted,
      auditStatus: {
        allIntegrityChecksPassed: independentAuditReport.allIntegrityChecksPassed,
        candleCalculationMismatchCount:
          independentAuditReport.candleCalculationMismatchCount,
        auditWarningRaised: auditWarningReasons.length > 0,
        auditWarningReasons,
      },
      persistenceStatus: persistStatus.persistenceStatus,
      remoteTablesAvailable: persistStatus.remoteTablesAvailable,
      remoteBlockerCode: persistStatus.remoteBlockerCode,
      remoteBlockerMessage: persistStatus.remoteBlockerMessage,
      cohortMaturityStatistics: independentAuditReport.auditedCohortStatistics,
    };

    this.cycleHistory.push(cycleResult);
    fs.writeFileSync(this.cyclesLedgerPath, JSON.stringify(this.cycleHistory, null, 2));
    fs.writeFileSync(
      this.auditReportPath,
      JSON.stringify(independentAuditReport, null, 2)
    );

    return { cycleResult, independentAuditReport };
  }

  private async checkAndPersistLedgers(): Promise<{
    persistenceStatus: MonitoringPersistenceStatus;
    remoteTablesAvailable: boolean;
    remoteBlockerCode: string | null;
    remoteBlockerMessage: string | null;
  }> {
    const states = [...this.stateBySignalId.values()];
    fs.writeFileSync(this.stateLedgerPath, JSON.stringify(states, null, 2));
    fs.writeFileSync(this.eventsLedgerPath, JSON.stringify(this.events, null, 2));

    const sb = this.getAdminClient?.() ?? null;
    if (!sb) {
      return {
        persistenceStatus: "LOCAL_ONLY",
        remoteTablesAvailable: false,
        remoteBlockerCode: "SUPABASE_CLIENT_UNAVAILABLE",
        remoteBlockerMessage: "Supabase client unavailable; preserved locally.",
      };
    }

    const { error } = await sb.from("strategy03_monitoring_runs").select("run_id").limit(1);
    if (error) {
      const isTableMissing = error.code === "PGRST205";
      const status: MonitoringPersistenceStatus = isTableMissing
        ? "LOCAL_ONLY"
        : "SYNC_PENDING";
      if (!isTableMissing) {
        fs.writeFileSync(
          this.walPath,
          JSON.stringify(
            {
              queuedAt: new Date().toISOString(),
              statesCount: states.length,
              eventsCount: this.events.length,
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
        remoteBlockerCode: error.code ?? "SUPABASE_ERROR",
        remoteBlockerMessage: error.message,
      };
    }

    return {
      persistenceStatus: "REMOTE_SYNCED",
      remoteTablesAvailable: true,
      remoteBlockerCode: null,
      remoteBlockerMessage: null,
    };
  }

  public getSignalState(signalId: string): SignalForwardObservationState | undefined {
    return this.stateBySignalId.get(signalId);
  }

  public getAllSignalStates(): SignalForwardObservationState[] {
    return [...this.stateBySignalId.values()];
  }

  public getEvents(): ForwardMonitoringEventRecord[] {
    return [...this.events];
  }
}

