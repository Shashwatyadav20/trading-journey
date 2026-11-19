import {
  DEFAULT_STRATEGY03_PAPER_ISOLATION_CONFIG,
  type Strategy03PaperIsolationConfig,
  validateStrategy03IsolationGuard,
} from "./Strategy03PaperIsolationConfig.js";
import {
  Strategy03ShadowScheduler,
  type DailyObservationRecord,
} from "./Strategy03ShadowScheduler.js";
import {
  evaluatePointInTimeSnapshot,
  filterCandlesAsOf,
  filterFinancialsAsOf,
  filterOwnershipAsOf,
  type DailyCandleBar,
} from "./HistoricalValidationEngine.js";
import {
  loadAllRowsPaginated,
  type ShadowResearchDecision,
  type ShadowSignalRecord,
} from "./Strategy03ShadowRunner.js";
import {
  Strategy03ShadowPersistence,
  type PersistenceOutcome,
} from "./Strategy03ShadowPersistence.js";
import {
  getFrozenSpecChecksum,
  STRATEGY03_FROZEN_SPEC_V61018,
} from "./forward/Strategy03FrozenSpec.js";
import { filterMomentumStock } from "./momentum/Strategy03MomentumStockFilter.js";

export type ShadowSchedulerOperationalState =
  | "NOT_REGISTERED"
  | "BACKEND_NOT_RUNNING"
  | "WAITING_FOR_WINDOW"
  | "EXECUTED_SUCCESSFULLY"
  | "EXECUTION_FAILED"
  | "SAFETY_BLOCKED";

export interface ShadowSafetyLocks {
  STRATEGY_01: boolean;
  STRATEGY_02: boolean;
  STRATEGY_03: boolean;
  LIVE_TRADING: boolean;
  BROKER_EXECUTION_ENABLED: boolean;
  paperIsolationConfig: Strategy03PaperIsolationConfig;
}

export interface ShadowSchedulerHealth {
  state: ShadowSchedulerOperationalState;
  registered: boolean;
  initialized: boolean;
  callbackRegistered: boolean;
  backendProcessActive: boolean;
  timezone: "Asia/Kolkata";
  scheduledTimeIst: "15:45";
  nextScheduledExecution: string;
  lastExecutionTimestamp: string | null;
  lastExecutionResult: string | null;
  lastPersistenceStatus: "NONE" | "PERSISTED" | "FAILED";
  lastPersistenceError: string | null;
  failureCount: number;
  missedSessions: string[];
  duplicatePreventionActive: boolean;
  frozenSpecChecksum: string;
  checksumVerified: boolean;
  validObservedSessions: number;
  safetyBlockReason: string | null;
}

const DEFAULT_FROZEN_CHECKSUM = getFrozenSpecChecksum();

export type ShadowRunCallback = (
  scheduler: Strategy03ShadowScheduler,
  now: Date
) => Promise<DailyObservationRecord | null>;

export class Strategy03ShadowService {
  private readonly scheduler: Strategy03ShadowScheduler;
  private readonly persistence: Strategy03ShadowPersistence;
  private registered = false;
  private initialized = false;
  private backendProcessActive = false;
  private timerHandle: NodeJS.Timeout | null = null;
  private lastExecutionTimestamp: string | null = null;
  private lastExecutionResult: string | null = null;
  private lastPersistenceStatus: "NONE" | "PERSISTED" | "FAILED" = "NONE";
  private lastPersistenceError: string | null = null;
  private failureCount = 0;
  private missedSessions: string[] = [];
  private safetyBlockReason: string | null = null;
  private lastSafetyLocks: ShadowSafetyLocks = {
    STRATEGY_01: false,
    STRATEGY_02: false,
    STRATEGY_03: false,
    LIVE_TRADING: false,
    BROKER_EXECUTION_ENABLED: false,
    paperIsolationConfig: DEFAULT_STRATEGY03_PAPER_ISOLATION_CONFIG,
  };
  private onRunDueCallback: ShadowRunCallback;
  private readonly expectedFrozenChecksum: string;

  constructor(options?: {
    liveObservationStartDate?: string;
    expectedFrozenChecksum?: string;
    persistence?: Strategy03ShadowPersistence;
    onRunDue?: ShadowRunCallback;
  }) {
    this.scheduler = new Strategy03ShadowScheduler({
      liveObservationStartDate: options?.liveObservationStartDate ?? "2026-11-17",
    });
    this.expectedFrozenChecksum = options?.expectedFrozenChecksum ?? DEFAULT_FROZEN_CHECKSUM;
    this.persistence =
      options?.persistence ??
      new Strategy03ShadowPersistence(() => {
        try {
          // Lazy import avoids requiring env vars during pure unit tests
          const mod = require("../../../../db/supabaseClient.js");
          return mod.getAdminSupabaseClient();
        } catch {
          return null;
        }
      });
    this.onRunDueCallback = options?.onRunDue ?? this.createDefaultRunDueCallback();
  }

  private createDefaultRunDueCallback(): ShadowRunCallback {
    return async (sched, now) => {
      const { getAdminSupabaseClient } = await import("../../../../db/supabaseClient.js");
      const sb = getAdminSupabaseClient();
      const finRows = await loadAllRowsPaginated(sb, "strategy03_financial_facts");
      const ownRows = await loadAllRowsPaginated(sb, "strategy03_institutional_ownership");
      const univRows = await loadAllRowsPaginated(sb, "market_universe_equities", "nse_symbol,sector");

      const sectorBySym = new Map<string, string>();
      for (const u of univRows) {
        if (u.nse_symbol) sectorBySym.set(String(u.nse_symbol).toUpperCase(), u.sector ?? "UNKNOWN");
      }

      const verifiedSyms = [
        ...new Set(finRows.filter((r: any) => r.verification_status === "VERIFIED").map((r: any) => String(r.symbol))),
      ];

      const { istDate } = { istDate: sched.evaluateScheduleWindow(now).istDate };
      const fs = await import("node:fs");
      const path = await import("node:path");
      const loadCandles = (sym: string): DailyCandleBar[] => {
        const safe = `${sym}.NS`.replace(/[^A-Za-z0-9_.-]/g, "_");
        for (const sub of ["phase66/cache", "phase65/cache"]) {
          const p = path.resolve(process.cwd(), "data/research/strategy03", sub, `${safe}_5y.json`);
          if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, "utf8")) as DailyCandleBar[];
        }
        return [];
      };
      const niftyCandles = loadCandles("^NSEI".replace(".NS", ""));

      const rec = await sched.executeScheduledScan({
        now,
        universeSymbols: verifiedSyms,
        dataFreshness: {
          financialRows: finRows.length,
          ownershipRows: ownRows.length,
          deliveryRows: 0,
          announcementRows: 0,
        },
        evaluateSymbol: async (sym, obsDate) => {
          const candles = filterCandlesAsOf(loadCandles(sym), obsDate);
          const pitNifty = filterCandlesAsOf(niftyCandles, obsDate);
          const pitFins = filterFinancialsAsOf(
            finRows.filter((r: any) => r.symbol === sym) as any,
            obsDate
          );
          const pitOwn = filterOwnershipAsOf(
            ownRows.filter((r: any) => r.symbol === sym) as any,
            obsDate
          );
          const sector = sectorBySym.get(sym) ?? "UNKNOWN";
          const snap = evaluatePointInTimeSnapshot({
            symbol: sym,
            sector,
            asOfDate: obsDate,
            financials: pitFins,
            ownership: pitOwn,
            announcements: [],
            candles,
          });
          const mom = filterMomentumStock({ symbol: sym, sector, candles, niftyCandles: pitNifty });
          const decision: ShadowResearchDecision =
            snap.decision === "ENTER_CANDIDATE" && mom.classification === "MOMENTUM_WATCHLIST"
              ? "BUY_CANDIDATE"
              : snap.decision === "WAIT"
              ? "WATCH"
              : "WAIT";
          return {
            idempotencyKey: `${sym}|${obsDate}`,
            symbol: sym,
            sector,
            signalDate: obsDate,
            marketDataTimestamp: candles[candles.length - 1]?.date ?? obsDate,
            evaluationTimestamp: new Date().toISOString(),
            decision,
            score: snap.totalScore,
            confidence: snap.missingData.length === 0 ? 1 : 0.7,
            verificationStatus: snap.missingData.includes("insufficientVerifiedFinancials") ? "MISSING" : "VERIFIED",
            missingFields: snap.missingData,
            evidenceSummary: [`fund=${snap.totalScore}`, `mom=${mom.classification}`],
            referencePrice: candles[candles.length - 1]?.close ?? null,
            scoreBreakdown: snap,
            immutable: true,
          };
        },
      });

      const daySignals = sched.getSignalLedger().filter((s) => s.signalDate === istDate);
      const persistRes = await this.persistence.persistRunAndSignals({
        run: rec,
        signals: daySignals,
        frozenSpecChecksum: this.expectedFrozenChecksum,
      });
      this.lastPersistenceStatus = persistRes.persisted ? "PERSISTED" : "FAILED";
      this.lastPersistenceError = persistRes.error;
      return rec;
    };
  }

  public validateSafetyLocks(locks: ShadowSafetyLocks): { safe: boolean; reason: string | null } {
    this.lastSafetyLocks = locks;
    if (
      locks.STRATEGY_01 ||
      locks.STRATEGY_02 ||
      locks.STRATEGY_03 ||
      locks.LIVE_TRADING ||
      locks.BROKER_EXECUTION_ENABLED
    ) {
      return { safe: false, reason: "SAFETY_LOCK_VIOLATION_STRATEGY_OR_LIVE_FLAG_TRUE" };
    }
    try {
      validateStrategy03IsolationGuard(locks.paperIsolationConfig, {
        STRATEGY_01: locks.STRATEGY_01,
        STRATEGY_02: locks.STRATEGY_02,
        STRATEGY_03: locks.STRATEGY_03,
        LIVE_TRADING: locks.LIVE_TRADING,
        BROKER_EXECUTION_ENABLED: locks.BROKER_EXECUTION_ENABLED,
      });
    } catch (err) {
      return {
        safe: false,
        reason: err instanceof Error ? err.message : "PAPER_ISOLATION_GUARD_FAILED",
      };
    }
    return { safe: true, reason: null };
  }

  public verifyFrozenChecksum(): boolean {
    return getFrozenSpecChecksum() === this.expectedFrozenChecksum;
  }

  public recoverPersistedState(
    observations: DailyObservationRecord[],
    signals: ShadowSignalRecord[]
  ): void {
    const forwardObs = observations.filter(
      (o) => o.observationDate >= this.scheduler.liveObservationStartDate
    );
    const forwardSigs = signals.filter(
      (s) => s.signalDate >= this.scheduler.liveObservationStartDate
    );
    this.scheduler.recoverFromLedgers(forwardObs, forwardSigs);
    const latest = forwardObs[forwardObs.length - 1];
    if (latest) {
      this.lastExecutionTimestamp = latest.completionTime;
      this.lastExecutionResult = latest.status;
    }
  }

  public start(options?: {
    safetyLocks?: ShadowSafetyLocks;
    intervalMs?: number;
    logger?: { info: (msg: string) => void; warn: (msg: string) => void };
    onRunDue?: ShadowRunCallback;
  }): { started: boolean; duplicatePrevented: boolean; reason: string | null } {
    if (this.registered && this.timerHandle !== null) {
      options?.logger?.warn("[Strategy03ShadowService] Duplicate registration prevented.");
      return { started: false, duplicatePrevented: true, reason: "ALREADY_REGISTERED" };
    }

    this.registered = true;
    this.backendProcessActive = true;
    if (options?.onRunDue) {
      this.onRunDueCallback = options.onRunDue;
    }

    if (!this.verifyFrozenChecksum()) {
      this.safetyBlockReason = "FROZEN_SPEC_CHECKSUM_MISMATCH";
      this.initialized = false;
      return { started: false, duplicatePrevented: false, reason: this.safetyBlockReason };
    }

    const lockCheck = this.validateSafetyLocks(options?.safetyLocks ?? this.lastSafetyLocks);
    if (!lockCheck.safe) {
      this.safetyBlockReason = lockCheck.reason;
      this.initialized = false;
      return { started: false, duplicatePrevented: false, reason: lockCheck.reason };
    }

    this.safetyBlockReason = null;
    this.initialized = true;

    const intervalMs = options?.intervalMs ?? 60_000;
    this.timerHandle = setInterval(() => {
      void this.tick(new Date());
    }, intervalMs);
    this.timerHandle.unref?.();

    options?.logger?.info(
      `[Strategy03ShadowService] Registered at 15:45 Asia/Kolkata (callbackRegistered=true, checksum=${this.expectedFrozenChecksum.slice(0, 12)}...)`
    );
    return { started: true, duplicatePrevented: false, reason: null };
  }

  public stop(): void {
    if (this.timerHandle !== null) {
      clearInterval(this.timerHandle);
      this.timerHandle = null;
    }
    this.backendProcessActive = false;
  }

  public async recordMissedSession(istDate: string, reason: string): Promise<PersistenceOutcome> {
    if (istDate < this.scheduler.liveObservationStartDate) {
      return { persisted: false, runsPersisted: 0, signalsPersisted: 0, error: "HISTORICAL_DATE_IGNORED" };
    }
    if (!this.missedSessions.includes(istDate)) {
      this.missedSessions.push(istDate);
    }
    const res = await this.persistence.persistMissedSession({
      observationDate: istDate,
      reason,
      frozenSpecChecksum: this.expectedFrozenChecksum,
    });
    this.lastPersistenceStatus = res.persisted ? "PERSISTED" : "FAILED";
    this.lastPersistenceError = res.error;
    return res;
  }

  public async tick(now: Date = new Date()): Promise<DailyObservationRecord | null> {
    if (!this.registered || !this.initialized || this.safetyBlockReason) {
      return null;
    }
    const lockCheck = this.validateSafetyLocks(this.lastSafetyLocks);
    if (!lockCheck.safe || !this.verifyFrozenChecksum()) {
      this.safetyBlockReason = lockCheck.reason ?? "FROZEN_SPEC_CHECKSUM_MISMATCH";
      return null;
    }

    const sched = this.scheduler.evaluateScheduleWindow(now);
    if (!sched.isTradingDay || !sched.isAfterTargetWindow) {
      return null;
    }

    const alreadyExecuted = this.scheduler
      .getObservationLedger()
      .some((o) => o.observationDate === sched.istDate && (o.status === "SUCCESS" || o.status === "PARTIAL"));
    if (alreadyExecuted) {
      return null;
    }

    try {
      const rec = await this.onRunDueCallback(this.scheduler, now);
      if (rec) {
        this.lastExecutionTimestamp = rec.completionTime;
        this.lastExecutionResult = rec.status;
        if (rec.status === "FAILED") {
          this.failureCount += 1;
        }
      }
      return rec;
    } catch (err) {
      this.failureCount += 1;
      this.lastExecutionTimestamp = new Date().toISOString();
      this.lastExecutionResult = `FAILED: ${err instanceof Error ? err.message : String(err)}`;
      return null;
    }
  }

  public getScheduler(): Strategy03ShadowScheduler {
    return this.scheduler;
  }

  public getHealthStatus(now: Date = new Date()): ShadowSchedulerHealth {
    const sched = this.scheduler.evaluateScheduleWindow(now);
    const nextScheduledExecution = `${sched.istDate}T15:45:00+05:30`;
    let state: ShadowSchedulerOperationalState = "WAITING_FOR_WINDOW";
    if (!this.registered) state = "NOT_REGISTERED";
    else if (this.safetyBlockReason) state = "SAFETY_BLOCKED";
    else if (!this.backendProcessActive) state = "BACKEND_NOT_RUNNING";
    else if (this.lastExecutionResult === "FAILED" || (this.lastExecutionResult ?? "").startsWith("FAILED")) {
      state = "EXECUTION_FAILED";
    } else if (this.lastExecutionResult === "SUCCESS" || this.lastExecutionResult === "PARTIAL") {
      state = "EXECUTED_SUCCESSFULLY";
    }

    return {
      state,
      registered: this.registered,
      initialized: this.initialized,
      callbackRegistered: Boolean(this.onRunDueCallback),
      backendProcessActive: this.backendProcessActive,
      timezone: STRATEGY03_FROZEN_SPEC_V61018.safetyLocks.STRATEGY_03 === false ? "Asia/Kolkata" : "Asia/Kolkata",
      scheduledTimeIst: "15:45",
      nextScheduledExecution,
      lastExecutionTimestamp: this.lastExecutionTimestamp,
      lastExecutionResult: this.lastExecutionResult,
      lastPersistenceStatus: this.lastPersistenceStatus,
      lastPersistenceError: this.lastPersistenceError,
      failureCount: this.failureCount,
      missedSessions: [...this.missedSessions],
      duplicatePreventionActive: true,
      frozenSpecChecksum: this.expectedFrozenChecksum,
      checksumVerified: this.verifyFrozenChecksum(),
      validObservedSessions: this.scheduler.getSuccessfulObservationDaysCount(),
      safetyBlockReason: this.safetyBlockReason,
    };
  }
}

export const strategy03ShadowService = new Strategy03ShadowService({
  liveObservationStartDate: "2026-11-17",
});
