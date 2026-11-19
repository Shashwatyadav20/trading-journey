import fs from "node:fs";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { marketSessionValidator } from "../../../../market/MarketSessionValidator.js";
import type { FourHourCandle } from "./Strategy03FourHourCandleProvider.js";
import type { ImmutableReadySignalSnapshot } from "./Strategy03FourHourForwardOutcomeTracker.js";
import {
  Strategy03ForwardMaturityMonitor,
  type ForwardMonitoringCycleResult,
} from "./Strategy03ForwardMaturityMonitor.js";
import {
  Strategy03FourHourMonitoringEngine,
} from "./Strategy03FourHourMonitoringEngine.js";
import {
  Strategy03FourHourMonitoringPersistence,
  type MonitoringPersistenceOutcome,
  type MonitoringPersistenceStatus,
  type MonitoringReconciliationReport,
  type MonitoringRunSummaryRecord,
} from "./Strategy03FourHourMonitoringPersistence.js";
import {
  DEFAULT_STRATEGY03_PAPER_ISOLATION_CONFIG,
  validateStrategy03IsolationGuard,
} from "../Strategy03PaperIsolationConfig.js";

export type NseFourHourSessionBlockSlot = "AM_240M" | "PM_135M";

export type FourHourSchedulerOperationalStatus =
  | "STOPPED"
  | "SCHEDULED_WAITING_FOR_4H_BLOCK"
  | "RUNNING_CYCLE"
  | "HEALTHY_CYCLE_COMPLETED"
  | "DEGRADED_STALE_OR_MISSING_DATA"
  | "DEGRADED_PERSISTENCE_OUTAGE"
  | "DEGRADED_AUDIT_MISMATCH"
  | "FAILED_LAST_CYCLE";

export type OperationalAlertType =
  | "SCHEDULER_FAILURE"
  | "MISSING_COMPLETED_4H_DATA"
  | "STALE_SOURCE_DATA"
  | "REMOTE_SUPABASE_OUTAGE"
  | "WAL_ACCUMULATION"
  | "DUPLICATE_OR_OVERLAPPING_EXECUTION"
  | "INDEPENDENT_AUDIT_MISMATCH";

export interface OperationalAlertRecord {
  alertId: string;
  alertType: OperationalAlertType;
  cycleId: string;
  timestampIso: string;
  severity: "WARNING" | "ERROR";
  message: string;
  readOnly: true;
}

export interface FourHourSessionWindowEvaluation {
  istDate: string;
  istTime: string;
  isTradingDay: boolean;
  nonTradingReason: "WEEKEND" | "NSE_HOLIDAY" | null;
  eligibleBlockSlot: NseFourHourSessionBlockSlot | null;
  eligibleBlockStartTimestampIst: string | null;
  deterministicCycleId: string | null;
  nextExpectedEligibleWindowIst: string;
  reason: string;
}

export interface FourHourSchedulerAuditSummary {
  existingDailyShadowSchedulerInspected: true;
  existingDailyShadowSchedulerFile: "backend/src/indian/swing/research/strategy03/Strategy03ShadowScheduler.ts";
  existingDailySchedulerTargetIst: "15:45 (once daily EOD fundamental/momentum scan)";
  existing4hMonitoringWasAutomated: false;
  existing4hMonitoringRanAfterEach4hBlock: false;
  newFourHourBlockSchedulerRequired: true;
  auditExplanation: string;
}

export interface FourHourOperationalHealthSnapshot {
  schedulerStatus: FourHourSchedulerOperationalStatus;
  schedulerRunning: boolean;
  isCycleInProgress: boolean;
  timezone: "Asia/Kolkata";
  sessionBlockScheduleIst: {
    AM_240M: "09:15–13:14 IST (eligible trigger >= 13:20 IST)";
    PM_135M: "13:15–15:30 IST (eligible trigger >= 15:35 IST)";
  };
  lastScheduledAttemptTimestampIso: string | null;
  lastSuccessfulMonitoringCycle: {
    cycleId: string | null;
    completedAtIso: string | null;
    blockSlot: NseFourHourSessionBlockSlot | null;
    blockTimestampIst: string | null;
  };
  nextExpectedEligibleMonitoringWindowIst: string;
  lastCompletedNse4hBlockProcessedIst: string | null;
  newlyProcessedBarsInLastCycle: number;
  signalsUpdatedInLastCycle: number;
  duplicateCyclesPreventedCount: number;
  overlappingInvocationsPreventedCount: number;
  failedCycleCount: number;
  remotePersistenceHealth: MonitoringPersistenceStatus;
  remoteTablesAvailable: boolean;
  walPendingCount: number;
  lastReconciliationInSync: boolean;
  independentAuditStatus: {
    allIntegrityChecksPassed: boolean;
    candleCalculationMismatchCount: number;
    auditWarningRaised: boolean;
  };
  operationalAlertsCount: number;
  latestOperationalAlerts: OperationalAlertRecord[];
  latestUnresolvedOperationalErrors: string[];
  schedulerAuditFindings: FourHourSchedulerAuditSummary;
}

// Combined union of official 2026 NSE holidays from ScanScheduler & MarketSessionValidator
const NSE_HOLIDAYS_2026: ReadonlySet<string> = new Set([
  "2026-01-26",
  "2026-02-26",
  "2026-03-03",
  "2026-03-20",
  "2026-03-27",
  "2026-03-31",
  "2026-04-02",
  "2026-04-03",
  "2026-04-14",
  "2026-05-01",
  "2026-08-15",
  "2026-10-02",
  "2026-10-20",
  "2026-10-21",
  "2026-10-22",
  "2026-11-05",
  "2026-11-08",
  "2026-11-24",
  "2026-12-25",
]);

export class Strategy03FourHourMonitoringScheduler {
  // AM_240M (09:15–13:14 IST) completes at 13:15 IST -> trigger eligible at 13:20 IST
  public readonly AM_TRIGGER_MINUTES_IST = 13 * 60 + 20; // 13:20 IST
  // PM_135M (13:15–15:30 IST) completes at 15:30 IST -> trigger eligible at 15:35 IST
  public readonly PM_TRIGGER_MINUTES_IST = 15 * 60 + 35; // 15:35 IST
  public readonly TIMEZONE = "Asia/Kolkata" as const;

  private readonly completedCycleIds = new Set<string>();
  private readonly operationalAlertsById = new Map<string, OperationalAlertRecord>();
  private readonly unresolvedErrors: string[] = [];

  private timerHandle: NodeJS.Timeout | null = null;
  private schedulerRunning = false;
  private isCycleInProgress = false;

  private lastScheduledAttemptTimestampIso: string | null = null;
  private lastSuccessfulCycleId: string | null = null;
  private lastSuccessfulCompletedAtIso: string | null = null;
  private lastSuccessfulBlockSlot: NseFourHourSessionBlockSlot | null = null;
  private lastSuccessfulBlockTimestampIst: string | null = null;
  private lastCompletedNse4hBlockProcessedIst: string | null = null;

  private newlyProcessedBarsInLastCycle = 0;
  private signalsUpdatedInLastCycle = 0;
  private duplicateCyclesPreventedCount = 0;
  private overlappingInvocationsPreventedCount = 0;
  private failedCycleCount = 0;

  private lastPersistenceStatus: MonitoringPersistenceStatus = "LOCAL_ONLY";
  private lastRemoteTablesAvailable = false;
  private lastWalPendingCount = 0;
  private lastReconciliationInSync = false;

  private lastAuditPassed = true;
  private lastAuditMismatchCount = 0;
  private lastAuditWarningRaised = false;
  private lastCycleHadStaleOrMissingData = false;
  private lastCycleFailed = false;

  private readonly stateFilePath: string;
  private readonly alertsFilePath: string;
  private readonly healthFilePath: string;

  constructor(
    private readonly storageDir: string,
    private readonly forwardMonitor: Strategy03ForwardMaturityMonitor,
    private readonly candidateEngine: Strategy03FourHourMonitoringEngine,
    private readonly persistence: Strategy03FourHourMonitoringPersistence
  ) {
    fs.mkdirSync(this.storageDir, { recursive: true });
    this.stateFilePath = path.join(this.storageDir, "scheduler_state.json");
    this.alertsFilePath = path.join(this.storageDir, "operational_alerts.json");
    this.healthFilePath = path.join(this.storageDir, "operational_health_dashboard.json");
    this.recoverSchedulerStateFromDisk();
  }

  public getSchedulerAuditFindings(): FourHourSchedulerAuditSummary {
    return {
      existingDailyShadowSchedulerInspected: true,
      existingDailyShadowSchedulerFile:
        "backend/src/indian/swing/research/strategy03/Strategy03ShadowScheduler.ts",
      existingDailySchedulerTargetIst:
        "15:45 (once daily EOD fundamental/momentum scan)",
      existing4hMonitoringWasAutomated: false,
      existing4hMonitoringRanAfterEach4hBlock: false,
      newFourHourBlockSchedulerRequired: true,
      auditExplanation:
        "Strategy03ShadowScheduler and Strategy03ShadowService only run a once-daily 15:45 IST EOD fundamental/momentum scan across 56 stocks. Phase 6.10.19.9–13 4H pre-breakout and forward maturity monitoring existed only as CLI scripts without an automated AM_240M (13:20 IST) / PM_135M (15:35 IST) session-block scheduler. Strategy03FourHourMonitoringScheduler was therefore required and created to orchestrate 4H session-block monitoring without duplicating the daily EOD scheduler.",
    };
  }

  public recoverSchedulerStateFromDisk(): void {
    if (fs.existsSync(this.stateFilePath)) {
      const saved = JSON.parse(fs.readFileSync(this.stateFilePath, "utf8"));
      for (const cid of saved.completedCycleIds ?? []) {
        this.completedCycleIds.add(String(cid));
      }
      this.lastScheduledAttemptTimestampIso = saved.lastScheduledAttemptTimestampIso ?? null;
      this.lastSuccessfulCycleId = saved.lastSuccessfulCycleId ?? null;
      this.lastSuccessfulCompletedAtIso = saved.lastSuccessfulCompletedAtIso ?? null;
      this.lastSuccessfulBlockSlot = saved.lastSuccessfulBlockSlot ?? null;
      this.lastSuccessfulBlockTimestampIst = saved.lastSuccessfulBlockTimestampIst ?? null;
      this.lastCompletedNse4hBlockProcessedIst =
        saved.lastCompletedNse4hBlockProcessedIst ?? null;
      this.newlyProcessedBarsInLastCycle = saved.newlyProcessedBarsInLastCycle ?? 0;
      this.signalsUpdatedInLastCycle = saved.signalsUpdatedInLastCycle ?? 0;
      this.duplicateCyclesPreventedCount = saved.duplicateCyclesPreventedCount ?? 0;
      this.overlappingInvocationsPreventedCount =
        saved.overlappingInvocationsPreventedCount ?? 0;
      this.failedCycleCount = saved.failedCycleCount ?? 0;
      this.lastPersistenceStatus = saved.lastPersistenceStatus ?? "LOCAL_ONLY";
      this.lastRemoteTablesAvailable = Boolean(saved.lastRemoteTablesAvailable);
      this.lastWalPendingCount = saved.lastWalPendingCount ?? 0;
      this.lastReconciliationInSync = Boolean(saved.lastReconciliationInSync);
      this.lastAuditPassed = saved.lastAuditPassed ?? true;
      this.lastAuditMismatchCount = saved.lastAuditMismatchCount ?? 0;
      this.lastAuditWarningRaised = Boolean(saved.lastAuditWarningRaised);
      this.lastCycleHadStaleOrMissingData = Boolean(saved.lastCycleHadStaleOrMissingData);
      this.lastCycleFailed = Boolean(saved.lastCycleFailed);
    }

    if (fs.existsSync(this.alertsFilePath)) {
      const savedAlerts = JSON.parse(
        fs.readFileSync(this.alertsFilePath, "utf8")
      ) as OperationalAlertRecord[];
      for (const a of savedAlerts) {
        this.operationalAlertsById.set(a.alertId, a);
      }
    }
  }

  private persistSchedulerStateToDisk(now: Date = new Date()): void {
    const statePayload = {
      completedCycleIds: [...this.completedCycleIds],
      lastScheduledAttemptTimestampIso: this.lastScheduledAttemptTimestampIso,
      lastSuccessfulCycleId: this.lastSuccessfulCycleId,
      lastSuccessfulCompletedAtIso: this.lastSuccessfulCompletedAtIso,
      lastSuccessfulBlockSlot: this.lastSuccessfulBlockSlot,
      lastSuccessfulBlockTimestampIst: this.lastSuccessfulBlockTimestampIst,
      lastCompletedNse4hBlockProcessedIst: this.lastCompletedNse4hBlockProcessedIst,
      newlyProcessedBarsInLastCycle: this.newlyProcessedBarsInLastCycle,
      signalsUpdatedInLastCycle: this.signalsUpdatedInLastCycle,
      duplicateCyclesPreventedCount: this.duplicateCyclesPreventedCount,
      overlappingInvocationsPreventedCount: this.overlappingInvocationsPreventedCount,
      failedCycleCount: this.failedCycleCount,
      lastPersistenceStatus: this.lastPersistenceStatus,
      lastRemoteTablesAvailable: this.lastRemoteTablesAvailable,
      lastWalPendingCount: this.lastWalPendingCount,
      lastReconciliationInSync: this.lastReconciliationInSync,
      lastAuditPassed: this.lastAuditPassed,
      lastAuditMismatchCount: this.lastAuditMismatchCount,
      lastAuditWarningRaised: this.lastAuditWarningRaised,
      lastCycleHadStaleOrMissingData: this.lastCycleHadStaleOrMissingData,
      lastCycleFailed: this.lastCycleFailed,
    };
    fs.writeFileSync(this.stateFilePath, JSON.stringify(statePayload, null, 2));
    fs.writeFileSync(
      this.alertsFilePath,
      JSON.stringify([...this.operationalAlertsById.values()], null, 2)
    );
    fs.writeFileSync(
      this.healthFilePath,
      JSON.stringify(this.getOperationalHealth(now), null, 2)
    );
  }

  public isNseTradingDay(istDateStr: string, dayOfWeek: number): {
    isTradingDay: boolean;
    nonTradingReason: "WEEKEND" | "NSE_HOLIDAY" | null;
  } {
    if (dayOfWeek === 0 || dayOfWeek === 6) {
      return { isTradingDay: false, nonTradingReason: "WEEKEND" };
    }
    if (
      NSE_HOLIDAYS_2026.has(istDateStr) ||
      marketSessionValidator.getMarketSessionStatus(`${istDateStr}T10:00:00+05:30`) === "HOLIDAY"
    ) {
      return { isTradingDay: false, nonTradingReason: "NSE_HOLIDAY" };
    }
    return { isTradingDay: true, nonTradingReason: null };
  }

  private findNextTradingDate(fromIstDateStr: string): string {
    let cursorMs = Date.parse(`${fromIstDateStr}T12:00:00+05:30`);
    for (let i = 1; i <= 14; i++) {
      const nextMs = cursorMs + i * 86_400_000;
      const comp = marketSessionValidator.getIstComponents(nextMs);
      const chk = this.isNseTradingDay(comp.dateString, comp.dayOfWeek);
      if (chk.isTradingDay) return comp.dateString;
    }
    return fromIstDateStr;
  }

  /**
   * Evaluates whether a completed NSE 4H session block (AM_240M or PM_135M) is eligible
   * to be monitored at `now`.
   */
  public evaluateSessionBlockWindow(now: Date = new Date()): FourHourSessionWindowEvaluation {
    const comp = marketSessionValidator.getIstComponents(now);
    const istDate = comp.dateString;
    const istTime = `${String(comp.hours).padStart(2, "0")}:${String(comp.minutes).padStart(
      2,
      "0"
    )}:${String(comp.seconds).padStart(2, "0")}`;

    const dayCheck = this.isNseTradingDay(istDate, comp.dayOfWeek);
    if (!dayCheck.isTradingDay) {
      const nextDate = this.findNextTradingDate(istDate);
      return {
        istDate,
        istTime,
        isTradingDay: false,
        nonTradingReason: dayCheck.nonTradingReason,
        eligibleBlockSlot: null,
        eligibleBlockStartTimestampIst: null,
        deterministicCycleId: null,
        nextExpectedEligibleWindowIst: `${nextDate}T13:20:00+05:30 (AM_240M)`,
        reason: `NON_TRADING_DAY_${dayCheck.nonTradingReason}`,
      };
    }

    const minutesSinceMidnight = comp.hours * 60 + comp.minutes;

    if (minutesSinceMidnight < this.AM_TRIGGER_MINUTES_IST) {
      return {
        istDate,
        istTime,
        isTradingDay: true,
        nonTradingReason: null,
        eligibleBlockSlot: null,
        eligibleBlockStartTimestampIst: null,
        deterministicCycleId: null,
        nextExpectedEligibleWindowIst: `${istDate}T13:20:00+05:30 (AM_240M)`,
        reason: "BEFORE_AM_4H_BLOCK_COMPLETION_13_20_IST",
      };
    }

    if (minutesSinceMidnight < this.PM_TRIGGER_MINUTES_IST) {
      const amCycleId = `s03_4h_cycle_${istDate}_AM_240M`;
      const amAlreadyDone = this.completedCycleIds.has(amCycleId);
      return {
        istDate,
        istTime,
        isTradingDay: true,
        nonTradingReason: null,
        eligibleBlockSlot: "AM_240M",
        eligibleBlockStartTimestampIst: `${istDate}T09:15:00.000+05:30`,
        deterministicCycleId: amCycleId,
        nextExpectedEligibleWindowIst: amAlreadyDone
          ? `${istDate}T15:35:00+05:30 (PM_135M)`
          : `${istDate}T13:20:00+05:30 (AM_240M)`,
        reason: "ELIGIBLE_AM_240M_BLOCK_COMPLETED",
      };
    }

    // After 15:35 IST: if AM_240M was not yet run today, run AM_240M first, else PM_135M
    const amCycleId = `s03_4h_cycle_${istDate}_AM_240M`;
    const pmCycleId = `s03_4h_cycle_${istDate}_PM_135M`;
    const nextDate = this.findNextTradingDate(istDate);

    if (!this.completedCycleIds.has(amCycleId)) {
      return {
        istDate,
        istTime,
        isTradingDay: true,
        nonTradingReason: null,
        eligibleBlockSlot: "AM_240M",
        eligibleBlockStartTimestampIst: `${istDate}T09:15:00.000+05:30`,
        deterministicCycleId: amCycleId,
        nextExpectedEligibleWindowIst: `${istDate}T15:35:00+05:30 (PM_135M)`,
        reason: "ELIGIBLE_AM_240M_CATCHUP_AFTER_CLOSE",
      };
    }

    return {
      istDate,
      istTime,
      isTradingDay: true,
      nonTradingReason: null,
      eligibleBlockSlot: "PM_135M",
      eligibleBlockStartTimestampIst: `${istDate}T13:15:00.000+05:30`,
      deterministicCycleId: pmCycleId,
      nextExpectedEligibleWindowIst: `${nextDate}T13:20:00+05:30 (AM_240M)`,
      reason: "ELIGIBLE_PM_135M_BLOCK_COMPLETED",
    };
  }

  private emitOperationalAlert(params: {
    alertType: OperationalAlertType;
    cycleId: string;
    severity: "WARNING" | "ERROR";
    message: string;
    now: Date;
  }): OperationalAlertRecord {
    const alertId = `OP_ALERT::${params.alertType}::${params.cycleId}`;
    const existing = this.operationalAlertsById.get(alertId);
    if (existing) return existing;

    const record: OperationalAlertRecord = {
      alertId,
      alertType: params.alertType,
      cycleId: params.cycleId,
      timestampIso: params.now.toISOString(),
      severity: params.severity,
      message: params.message,
      readOnly: true,
    };
    this.operationalAlertsById.set(alertId, record);
    return record;
  }

  public start(
    pollIntervalMs: number = 60_000,
    options?: {
      loadCandlesBySymbol?: (symbol: string) => FourHourCandle[];
      candidateSymbolsToEvaluate?: Array<{ nseSymbol: string; companyName: string }>;
    }
  ): {
    started: boolean;
    duplicateStartPrevented: boolean;
  } {
    if (this.timerHandle !== null) {
      return { started: false, duplicateStartPrevented: true };
    }
    this.schedulerRunning = true;
    const loader = options?.loadCandlesBySymbol ?? (() => []);
    this.timerHandle = setInterval(() => {
      void this.runDueCycle({
        now: new Date(),
        loadCandlesBySymbol: loader,
        candidateSymbolsToEvaluate: options?.candidateSymbolsToEvaluate,
      });
    }, pollIntervalMs);
    this.timerHandle.unref?.();
    return { started: true, duplicateStartPrevented: false };
  }

  public stop(): void {
    if (this.timerHandle !== null) {
      clearInterval(this.timerHandle);
      this.timerHandle = null;
    }
    this.schedulerRunning = false;
  }

  public setRunningStateForObservation(running: boolean): void {
    this.schedulerRunning = running;
  }

  /**
   * Executes an automated 4H monitoring cycle if a completed NSE 4H session block is due.
   */
  public async runDueCycle(params: {
    now?: Date;
    loadCandlesBySymbol: (symbol: string) => FourHourCandle[];
    candidateSymbolsToEvaluate?: Array<{ nseSymbol: string; companyName: string }>;
    maxDataAgeHours?: number;
    injectMismatchForTest?: (outcomes: any[]) => any[];
    simulateRunnerFailure?: boolean;
  }): Promise<{
    executed: boolean;
    skippedReason: string | null;
    cycleId: string | null;
    windowEvaluation: FourHourSessionWindowEvaluation;
    forwardCycleResult: ForwardMonitoringCycleResult | null;
    persistenceOutcome: MonitoringPersistenceOutcome | null;
    reconciliationReport: MonitoringReconciliationReport | null;
    newOperationalAlerts: OperationalAlertRecord[];
  }> {
    const evalNow = params.now ?? new Date();
    this.lastScheduledAttemptTimestampIso = evalNow.toISOString();

    // Enforce strict safety isolation before any work
    validateStrategy03IsolationGuard(DEFAULT_STRATEGY03_PAPER_ISOLATION_CONFIG, {
      STRATEGY_01: false,
      STRATEGY_02: false,
      STRATEGY_03: false,
      LIVE_TRADING: false,
      BROKER_EXECUTION_ENABLED: false,
    });

    const win = this.evaluateSessionBlockWindow(evalNow);
    const newOpAlerts: OperationalAlertRecord[] = [];

    // 1. Overlapping concurrent execution guard
    if (this.isCycleInProgress) {
      this.overlappingInvocationsPreventedCount++;
      const cid = win.deterministicCycleId ?? `concurrent_${win.istDate}`;
      newOpAlerts.push(
        this.emitOperationalAlert({
          alertType: "DUPLICATE_OR_OVERLAPPING_EXECUTION",
          cycleId: cid,
          severity: "WARNING",
          message: `Overlapping monitoring invocation prevented while cycle is already in progress (${cid}).`,
          now: evalNow,
        })
      );
      this.persistSchedulerStateToDisk(evalNow);
      return {
        executed: false,
        skippedReason: "CONCURRENT_CYCLE_IN_PROGRESS",
        cycleId: win.deterministicCycleId,
        windowEvaluation: win,
        forwardCycleResult: null,
        persistenceOutcome: null,
        reconciliationReport: null,
        newOperationalAlerts: newOpAlerts,
      };
    }

    // 2. Non-trading day or before completed 4H block window
    if (!win.isTradingDay || !win.deterministicCycleId || !win.eligibleBlockSlot) {
      this.persistSchedulerStateToDisk(evalNow);
      return {
        executed: false,
        skippedReason: win.reason,
        cycleId: null,
        windowEvaluation: win,
        forwardCycleResult: null,
        persistenceOutcome: null,
        reconciliationReport: null,
        newOperationalAlerts: [],
      };
    }

    const cycleId = win.deterministicCycleId;

    // 3. Duplicate cycle prevention for the same completed 4H block
    if (this.completedCycleIds.has(cycleId)) {
      this.duplicateCyclesPreventedCount++;
      newOpAlerts.push(
        this.emitOperationalAlert({
          alertType: "DUPLICATE_OR_OVERLAPPING_EXECUTION",
          cycleId,
          severity: "WARNING",
          message: `Duplicate scheduled invocation prevented for already-completed 4H session cycle ${cycleId}.`,
          now: evalNow,
        })
      );
      this.persistSchedulerStateToDisk(evalNow);
      return {
        executed: false,
        skippedReason: "DUPLICATE_CYCLE_PREVENTED",
        cycleId,
        windowEvaluation: win,
        forwardCycleResult: null,
        persistenceOutcome: null,
        reconciliationReport: null,
        newOperationalAlerts: newOpAlerts,
      };
    }

    this.isCycleInProgress = true;
    this.unresolvedErrors.length = 0;

    try {
      if (params.simulateRunnerFailure) {
        throw new Error("SIMULATED_SCHEDULER_RUNNER_EXCEPTION");
      }

      // 4. Run Phase 6.10.19.13 Forward Maturity Monitor + Phase 6.10.19.12 Independent Audit
      const fwdRes = await this.forwardMonitor.runMonitoringCycle({
        cycleId,
        loadCandlesBySymbol: params.loadCandlesBySymbol,
        now: evalNow,
        maxDataAgeHours: params.maxDataAgeHours,
        injectMismatchForTest: params.injectMismatchForTest,
      });

      const cycleRes = fwdRes.cycleResult;
      const auditRep = fwdRes.independentAuditReport;

      // Check for missing or stale completed 4H data across monitored snapshots
      let missingCount = 0;
      let staleCount = 0;
      for (const rec of auditRep.recalculatedOutcomes) {
        if (rec.dataFreshnessStatus === "MISSING" || rec.candleDataStatus === "MISSING_SOURCE_CACHE") {
          missingCount++;
        } else if (rec.dataFreshnessStatus === "STALE") {
          staleCount++;
        }
      }

      if (missingCount > 0) {
        const msg = `${missingCount} monitored signal(s) have MISSING completed 4H candle data during ${cycleId}.`;
        this.unresolvedErrors.push(msg);
        newOpAlerts.push(
          this.emitOperationalAlert({
            alertType: "MISSING_COMPLETED_4H_DATA",
            cycleId,
            severity: "ERROR",
            message: msg,
            now: evalNow,
          })
        );
      }

      if (staleCount > 0) {
        const msg = `${staleCount} monitored signal(s) have STALE 4H source data during ${cycleId}.`;
        this.unresolvedErrors.push(msg);
        newOpAlerts.push(
          this.emitOperationalAlert({
            alertType: "STALE_SOURCE_DATA",
            cycleId,
            severity: "WARNING",
            message: msg,
            now: evalNow,
          })
        );
      }

      if (
        cycleRes.auditStatus.auditWarningRaised ||
        cycleRes.auditStatus.candleCalculationMismatchCount > 0
      ) {
        const msg = `Independent audit mismatch/warning in ${cycleId}: ${cycleRes.auditStatus.auditWarningReasons.join("; ")}`;
        this.unresolvedErrors.push(msg);
        newOpAlerts.push(
          this.emitOperationalAlert({
            alertType: "INDEPENDENT_AUDIT_MISMATCH",
            cycleId,
            severity: "ERROR",
            message: msg,
            now: evalNow,
          })
        );
      }

      // 5. Evaluate candidate state transitions for requested symbols (or monitored 83 symbols)
      const symbolsToEval =
        params.candidateSymbolsToEvaluate ??
        this.forwardMonitor.getAllSignalStates().map((s) => ({
          nseSymbol: s.symbol,
          companyName: s.symbol,
        }));

      const newTransitions = [];
      const newCandidateAlerts = [];
      for (const symInfo of symbolsToEval) {
        const candles = params.loadCandlesBySymbol(symInfo.nseSymbol);
        const ev = this.candidateEngine.evaluateSymbol({
          nseSymbol: symInfo.nseSymbol,
          companyName: symInfo.companyName,
          candles,
          now: evalNow,
          dataProvider: "NSE 4H Session Cache",
          sourceReference: `cache4h/${symInfo.nseSymbol}_4h.json`,
        });
        if (!ev.duplicatePrevented) {
          newTransitions.push(ev.stateRecord);
        }
        if (ev.newAlerts.length > 0) {
          newCandidateAlerts.push(...ev.newAlerts);
        }
      }

      const allLatestStates = this.candidateEngine.getAllLatestStates();
      const runSummary: MonitoringRunSummaryRecord = {
        runId: cycleId,
        evaluatedAt: evalNow.toISOString(),
        completed4hTimestampIst: cycleRes.latestCompletedMonitoringTimestampIst,
        candidatesEvaluated: allLatestStates.length,
        stateCounts: {
          READY: allLatestStates.filter((s) => s.currentStatus === "READY").length,
          FORMING: allLatestStates.filter((s) => s.currentStatus === "FORMING").length,
          BREAKOUT: allLatestStates.filter((s) => s.currentStatus === "BREAKOUT").length,
          INVALIDATED: allLatestStates.filter((s) => s.currentStatus === "INVALIDATED").length,
          WAIT: allLatestStates.filter((s) => s.currentStatus === "WAIT").length,
        },
        alertsGenerated: newCandidateAlerts.length,
        duplicatesPrevented: this.candidateEngine.getDuplicatesPrevented(),
      };

      // 6. Persist monitoring run, new state transitions, and new alerts to Supabase + local WAL
      const persistOut = await this.persistence.persistMonitoringBatch({
        run: runSummary,
        states: newTransitions,
        alerts: newCandidateAlerts,
      });

      let reconcileRep: MonitoringReconciliationReport | null = null;
      if (persistOut.remoteTablesAvailable) {
        reconcileRep = await this.persistence.reconcileLocalAndRemote();
      }

      this.lastPersistenceStatus = reconcileRep
        ? reconcileRep.persistenceStatus
        : persistOut.status;
      this.lastRemoteTablesAvailable = persistOut.remoteTablesAvailable;
      this.lastWalPendingCount = reconcileRep
        ? reconcileRep.localCounts.pendingWal
        : persistOut.pendingWalCount;
      this.lastReconciliationInSync = reconcileRep ? reconcileRep.inSync : false;

      if (
        this.lastPersistenceStatus !== "REMOTE_SYNCED" ||
        persistOut.blockerMessage !== null
      ) {
        const msg = `Remote Supabase persistence degraded (${this.lastPersistenceStatus}): ${
          persistOut.blockerMessage ?? "Remote write failed"
        }`;
        this.unresolvedErrors.push(msg);
        newOpAlerts.push(
          this.emitOperationalAlert({
            alertType: "REMOTE_SUPABASE_OUTAGE",
            cycleId,
            severity: "ERROR",
            message: msg,
            now: evalNow,
          })
        );
      }

      if (this.lastWalPendingCount > 0) {
        const msg = `Local WAL has ${this.lastWalPendingCount} pending record(s) awaiting remote reconciliation.`;
        this.unresolvedErrors.push(msg);
        newOpAlerts.push(
          this.emitOperationalAlert({
            alertType: "WAL_ACCUMULATION",
            cycleId,
            severity: "WARNING",
            message: msg,
            now: evalNow,
          })
        );
      }

      this.lastCycleHadStaleOrMissingData = missingCount > 0 || staleCount > 0;
      this.lastAuditPassed = cycleRes.auditStatus.allIntegrityChecksPassed;
      this.lastAuditMismatchCount =
        cycleRes.auditStatus.candleCalculationMismatchCount;
      this.lastAuditWarningRaised = cycleRes.auditStatus.auditWarningRaised;
      this.lastCycleFailed = false;

      this.newlyProcessedBarsInLastCycle = cycleRes.newlyProcessed4hBarsCount;
      this.signalsUpdatedInLastCycle = cycleRes.signalsUpdatedCount;
      this.lastCompletedNse4hBlockProcessedIst =
        cycleRes.latestCompletedMonitoringTimestampIst;

      // Mark cycle completed ONLY when evaluation succeeded without throwing
      this.completedCycleIds.add(cycleId);
      this.lastSuccessfulCycleId = cycleId;
      this.lastSuccessfulCompletedAtIso = evalNow.toISOString();
      this.lastSuccessfulBlockSlot = win.eligibleBlockSlot;
      this.lastSuccessfulBlockTimestampIst = win.eligibleBlockStartTimestampIst;

      this.persistSchedulerStateToDisk(evalNow);

      return {
        executed: true,
        skippedReason: null,
        cycleId,
        windowEvaluation: this.evaluateSessionBlockWindow(evalNow),
        forwardCycleResult: cycleRes,
        persistenceOutcome: persistOut,
        reconciliationReport: reconcileRep,
        newOperationalAlerts: newOpAlerts,
      };
    } catch (err: any) {
      this.failedCycleCount++;
      this.lastCycleFailed = true;
      const errMsg = err?.message ?? String(err);
      this.unresolvedErrors.push(`Cycle ${cycleId} failed: ${errMsg}`);
      newOpAlerts.push(
        this.emitOperationalAlert({
          alertType: "SCHEDULER_FAILURE",
          cycleId,
          severity: "ERROR",
          message: `Monitoring cycle ${cycleId} failed: ${errMsg}`,
          now: evalNow,
        })
      );
      this.persistSchedulerStateToDisk(evalNow);
      return {
        executed: false,
        skippedReason: `CYCLE_FAILED: ${errMsg}`,
        cycleId,
        windowEvaluation: win,
        forwardCycleResult: null,
        persistenceOutcome: null,
        reconciliationReport: null,
        newOperationalAlerts: newOpAlerts,
      };
    } finally {
      this.isCycleInProgress = false;
    }
  }

  public getOperationalHealth(now: Date = new Date()): FourHourOperationalHealthSnapshot {
    const win = this.evaluateSessionBlockWindow(now);

    let status: FourHourSchedulerOperationalStatus = "STOPPED";
    if (this.isCycleInProgress) {
      status = "RUNNING_CYCLE";
    } else if (!this.schedulerRunning) {
      status = "STOPPED";
    } else if (this.lastCycleFailed) {
      status = "FAILED_LAST_CYCLE";
    } else if (this.lastAuditWarningRaised || !this.lastAuditPassed) {
      status = "DEGRADED_AUDIT_MISMATCH";
    } else if (this.lastCycleHadStaleOrMissingData) {
      status = "DEGRADED_STALE_OR_MISSING_DATA";
    } else if (
      this.lastSuccessfulCycleId !== null &&
      (this.lastPersistenceStatus !== "REMOTE_SYNCED" || this.lastWalPendingCount > 0)
    ) {
      status = "DEGRADED_PERSISTENCE_OUTAGE";
    } else if (this.lastSuccessfulCycleId !== null) {
      status = "HEALTHY_CYCLE_COMPLETED";
    } else {
      status = "SCHEDULED_WAITING_FOR_4H_BLOCK";
    }

    const alertsList = [...this.operationalAlertsById.values()];

    return {
      schedulerStatus: status,
      schedulerRunning: this.schedulerRunning,
      isCycleInProgress: this.isCycleInProgress,
      timezone: "Asia/Kolkata",
      sessionBlockScheduleIst: {
        AM_240M: "09:15–13:14 IST (eligible trigger >= 13:20 IST)",
        PM_135M: "13:15–15:30 IST (eligible trigger >= 15:35 IST)",
      },
      lastScheduledAttemptTimestampIso: this.lastScheduledAttemptTimestampIso,
      lastSuccessfulMonitoringCycle: {
        cycleId: this.lastSuccessfulCycleId,
        completedAtIso: this.lastSuccessfulCompletedAtIso,
        blockSlot: this.lastSuccessfulBlockSlot,
        blockTimestampIst: this.lastSuccessfulBlockTimestampIst,
      },
      nextExpectedEligibleMonitoringWindowIst: win.nextExpectedEligibleWindowIst,
      lastCompletedNse4hBlockProcessedIst: this.lastCompletedNse4hBlockProcessedIst,
      newlyProcessedBarsInLastCycle: this.newlyProcessedBarsInLastCycle,
      signalsUpdatedInLastCycle: this.signalsUpdatedInLastCycle,
      duplicateCyclesPreventedCount: this.duplicateCyclesPreventedCount,
      overlappingInvocationsPreventedCount: this.overlappingInvocationsPreventedCount,
      failedCycleCount: this.failedCycleCount,
      remotePersistenceHealth: this.lastPersistenceStatus,
      remoteTablesAvailable: this.lastRemoteTablesAvailable,
      walPendingCount: this.lastWalPendingCount,
      lastReconciliationInSync: this.lastReconciliationInSync,
      independentAuditStatus: {
        allIntegrityChecksPassed: this.lastAuditPassed,
        candleCalculationMismatchCount: this.lastAuditMismatchCount,
        auditWarningRaised: this.lastAuditWarningRaised,
      },
      operationalAlertsCount: alertsList.length,
      latestOperationalAlerts: alertsList.slice(-10),
      latestUnresolvedOperationalErrors: [...this.unresolvedErrors],
      schedulerAuditFindings: this.getSchedulerAuditFindings(),
    };
  }
}
