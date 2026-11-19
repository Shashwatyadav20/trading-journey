import fs from "node:fs";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  CandidateStateTransitionRecord,
  MonitoringAlertRecord,
} from "./Strategy03FourHourMonitoringEngine.js";

export type MonitoringPersistenceStatus =
  | "REMOTE_SYNCED"
  | "LOCAL_ONLY"
  | "SYNC_PENDING"
  | "SYNC_ERROR";

export interface MonitoringRunSummaryRecord {
  runId: string;
  evaluatedAt: string;
  completed4hTimestampIst: string;
  candidatesEvaluated: number;
  stateCounts: {
    READY: number;
    FORMING: number;
    BREAKOUT: number;
    INVALIDATED: number;
    WAIT: number;
  };
  alertsGenerated: number;
  duplicatesPrevented: number;
}

export interface MonitoringPendingWalItem {
  id: string;
  kind: "RUN" | "STATE" | "ALERT";
  createdAt: string;
  attempts: number;
  lastError: string | null;
  payload: MonitoringRunSummaryRecord | CandidateStateTransitionRecord | MonitoringAlertRecord;
}

export interface MonitoringPersistenceOutcome {
  status: MonitoringPersistenceStatus;
  remoteTablesAvailable: boolean;
  runsPersistedRemotely: number;
  statesPersistedRemotely: number;
  alertsPersistedRemotely: number;
  pendingWalCount: number;
  blockerCode: string | null;
  blockerMessage: string | null;
}

export interface MonitoringReconciliationReport {
  reconciledAt: string;
  persistenceStatus: MonitoringPersistenceStatus;
  remoteTablesAvailable: boolean;
  localCounts: {
    runs: number;
    states: number;
    alerts: number;
    pendingWal: number;
  };
  remoteCounts: {
    runs: number | null;
    states: number | null;
    alerts: number | null;
  };
  missingInRemote: {
    runIds: string[];
    transitionKeysCount: number;
    alertEventIdsCount: number;
  };
  syncedDuringReconciliation: {
    runs: number;
    states: number;
    alerts: number;
  };
  inSync: boolean;
  blockerCode: string | null;
  blockerMessage: string | null;
}

export interface RlsVerificationResult {
  table: string;
  tableExistsRemotely: boolean;
  anonReadBlockedOrEmpty: boolean;
  anonWriteBlocked: boolean;
  anonWriteErrorCode: string | null;
  serviceRoleReadAllowed: boolean;
  verdict: "VERIFIED_REMOTE" | "UNVERIFIED_TABLE_NOT_APPLIED_REMOTELY" | "FAILED";
}

function mapRunToDbRow(run: MonitoringRunSummaryRecord) {
  return {
    run_id: run.runId,
    evaluated_at: run.evaluatedAt,
    completed_4h_timestamp_ist: run.completed4hTimestampIst,
    candidates_evaluated: run.candidatesEvaluated,
    ready_count: run.stateCounts.READY,
    forming_count: run.stateCounts.FORMING,
    breakout_count: run.stateCounts.BREAKOUT,
    invalidated_count: run.stateCounts.INVALIDATED,
    wait_count: run.stateCounts.WAIT,
    alerts_generated: run.alertsGenerated,
    duplicates_prevented: run.duplicatesPrevented,
  };
}

function mapStateToDbRow(s: CandidateStateTransitionRecord) {
  return {
    transition_key: s.transitionKey,
    symbol: s.symbol,
    previous_status: s.previousStatus,
    current_status: s.currentStatus,
    completed_4h_timestamp_ist: s.completed4hTimestampIst,
    close_price: s.closePrice,
    breakout_boundary: s.breakoutBoundary,
    breakout_distance_pct: s.breakoutDistancePct,
    consolidation_low: s.consolidationLow,
    consolidation_high: s.consolidationHigh,
    support_low: s.supportLow,
    support_high: s.supportHigh,
    ob_low: s.obLow,
    ob_high: s.obHigh,
    reason: s.reason,
    data_freshness: s.dataFreshness,
    is_candle_complete: s.isCandleComplete,
  };
}

function mapDbRowToState(row: any): CandidateStateTransitionRecord {
  return {
    transitionKey: String(row.transition_key),
    symbol: String(row.symbol),
    previousStatus: row.previous_status ?? null,
    currentStatus: row.current_status,
    completed4hTimestampIst: String(row.completed_4h_timestamp_ist),
    closePrice: row.close_price !== null ? Number(row.close_price) : null,
    breakoutBoundary: row.breakout_boundary !== null ? Number(row.breakout_boundary) : null,
    breakoutDistancePct: row.breakout_distance_pct !== null ? Number(row.breakout_distance_pct) : null,
    consolidationLow: row.consolidation_low !== null ? Number(row.consolidation_low) : null,
    consolidationHigh: row.consolidation_high !== null ? Number(row.consolidation_high) : null,
    supportLow: row.support_low !== null ? Number(row.support_low) : null,
    supportHigh: row.support_high !== null ? Number(row.support_high) : null,
    obLow: row.ob_low !== null ? Number(row.ob_low) : null,
    obHigh: row.ob_high !== null ? Number(row.ob_high) : null,
    reason: String(row.reason),
    dataFreshness: row.data_freshness,
    isCandleComplete: Boolean(row.is_candle_complete),
  };
}

function mapAlertToDbRow(a: MonitoringAlertRecord) {
  return {
    event_id: a.eventId,
    symbol: a.symbol,
    alert_type: a.alertType,
    previous_status: a.previousStatus,
    new_status: a.newStatus,
    completed_4h_timestamp_ist: a.completed4hTimestampIst,
    price: a.price,
    consolidation_low: a.consolidationLow,
    consolidation_high: a.consolidationHigh,
    support_low: a.supportLow,
    support_high: a.supportHigh,
    ob_low: a.obLow,
    ob_high: a.obHigh,
    reason: a.reason,
    source: a.source,
    data_freshness: a.dataFreshness,
  };
}

function mapDbRowToAlert(row: any): MonitoringAlertRecord {
  return {
    eventId: String(row.event_id),
    symbol: String(row.symbol),
    alertType: row.alert_type,
    previousStatus: row.previous_status ?? null,
    newStatus: row.new_status,
    completed4hTimestampIst: String(row.completed_4h_timestamp_ist),
    price: row.price !== null ? Number(row.price) : null,
    consolidationLow: row.consolidation_low !== null ? Number(row.consolidation_low) : null,
    consolidationHigh: row.consolidation_high !== null ? Number(row.consolidation_high) : null,
    supportLow: row.support_low !== null ? Number(row.support_low) : null,
    supportHigh: row.support_high !== null ? Number(row.support_high) : null,
    obLow: row.ob_low !== null ? Number(row.ob_low) : null,
    obHigh: row.ob_high !== null ? Number(row.ob_high) : null,
    reason: String(row.reason),
    source: String(row.source),
    dataFreshness: row.data_freshness,
  };
}

export class Strategy03FourHourMonitoringPersistence {
  private readonly runsPath: string;
  private readonly statesPath: string;
  private readonly alertsPath: string;
  private readonly walPath: string;
  private readonly statusPath: string;
  private currentStatus: MonitoringPersistenceStatus = "LOCAL_ONLY";
  private lastBlockerCode: string | null = null;
  private lastBlockerMessage: string | null = null;

  constructor(
    private readonly storageDir: string,
    private readonly getAdminClient: () => SupabaseClient | null,
    private readonly maxRetries: number = 2
  ) {
    fs.mkdirSync(this.storageDir, { recursive: true });
    this.runsPath = path.join(this.storageDir, "monitoring_runs.json");
    this.statesPath = path.join(this.storageDir, "candidate_state_history.json");
    this.alertsPath = path.join(this.storageDir, "monitoring_alerts.json");
    this.walPath = path.join(this.storageDir, "pending_sync_wal.json");
    this.statusPath = path.join(this.storageDir, "persistence_status.json");
  }

  public getStatus(): {
    status: MonitoringPersistenceStatus;
    pendingWalCount: number;
    blockerCode: string | null;
    blockerMessage: string | null;
  } {
    const wal = this.readWal();
    return {
      status: this.currentStatus,
      pendingWalCount: wal.length,
      blockerCode: this.lastBlockerCode,
      blockerMessage: this.lastBlockerMessage,
    };
  }

  public readLocalRuns(): MonitoringRunSummaryRecord[] {
    if (!fs.existsSync(this.runsPath)) return [];
    const raw = JSON.parse(fs.readFileSync(this.runsPath, "utf8"));
    return Array.isArray(raw) ? raw : raw?.runId ? [raw] : [];
  }

  public readLocalStates(): CandidateStateTransitionRecord[] {
    if (!fs.existsSync(this.statesPath)) return [];
    const raw = JSON.parse(fs.readFileSync(this.statesPath, "utf8"));
    return Array.isArray(raw) ? raw : [];
  }

  public readLocalAlerts(): MonitoringAlertRecord[] {
    if (!fs.existsSync(this.alertsPath)) return [];
    const raw = JSON.parse(fs.readFileSync(this.alertsPath, "utf8"));
    return Array.isArray(raw) ? raw : [];
  }

  public readWal(): MonitoringPendingWalItem[] {
    if (!fs.existsSync(this.walPath)) return [];
    const raw = JSON.parse(fs.readFileSync(this.walPath, "utf8"));
    return Array.isArray(raw) ? raw : [];
  }

  private writeLocalRuns(runs: MonitoringRunSummaryRecord[]): void {
    const byId = new Map<string, MonitoringRunSummaryRecord>();
    for (const r of runs) byId.set(r.runId, r);
    fs.writeFileSync(this.runsPath, JSON.stringify([...byId.values()], null, 2));
  }

  private writeLocalStates(states: CandidateStateTransitionRecord[]): void {
    const byKey = new Map<string, CandidateStateTransitionRecord>();
    for (const s of states) byKey.set(s.transitionKey, s);
    fs.writeFileSync(this.statesPath, JSON.stringify([...byKey.values()], null, 2));
  }

  private writeLocalAlerts(alerts: MonitoringAlertRecord[]): void {
    const byId = new Map<string, MonitoringAlertRecord>();
    for (const a of alerts) byId.set(a.eventId, a);
    fs.writeFileSync(this.alertsPath, JSON.stringify([...byId.values()], null, 2));
  }

  private writeWal(items: MonitoringPendingWalItem[]): void {
    const byId = new Map<string, MonitoringPendingWalItem>();
    for (const item of items) byId.set(item.id, item);
    fs.writeFileSync(this.walPath, JSON.stringify([...byId.values()], null, 2));
  }

  private saveStatusMeta(outcome: MonitoringPersistenceOutcome): void {
    fs.writeFileSync(
      this.statusPath,
      JSON.stringify(
        {
          updatedAt: new Date().toISOString(),
          ...outcome,
        },
        null,
        2
      )
    );
  }

  private enqueueWal(
    runs: MonitoringRunSummaryRecord[],
    states: CandidateStateTransitionRecord[],
    alerts: MonitoringAlertRecord[],
    errMessage: string | null
  ): number {
    const existing = new Map<string, MonitoringPendingWalItem>();
    for (const item of this.readWal()) existing.set(item.id, item);
    const nowIso = new Date().toISOString();

    for (const r of runs) {
      const id = `RUN::${r.runId}`;
      const prev = existing.get(id);
      existing.set(id, {
        id,
        kind: "RUN",
        createdAt: prev?.createdAt ?? nowIso,
        attempts: (prev?.attempts ?? 0) + 1,
        lastError: errMessage,
        payload: r,
      });
    }
    for (const s of states) {
      const id = `STATE::${s.transitionKey}`;
      const prev = existing.get(id);
      existing.set(id, {
        id,
        kind: "STATE",
        createdAt: prev?.createdAt ?? nowIso,
        attempts: (prev?.attempts ?? 0) + 1,
        lastError: errMessage,
        payload: s,
      });
    }
    for (const a of alerts) {
      const id = `ALERT::${a.eventId}`;
      const prev = existing.get(id);
      existing.set(id, {
        id,
        kind: "ALERT",
        createdAt: prev?.createdAt ?? nowIso,
        attempts: (prev?.attempts ?? 0) + 1,
        lastError: errMessage,
        payload: a,
      });
    }
    const list = [...existing.values()];
    this.writeWal(list);
    return list.length;
  }

  private async upsertWithRetry(
    sb: SupabaseClient,
    table: string,
    rows: any[],
    onConflict: string
  ): Promise<{ ok: boolean; code: string | null; message: string | null }> {
    if (rows.length === 0) return { ok: true, code: null, message: null };
    const BATCH_SIZE = 250;
    for (let offset = 0; offset < rows.length; offset += BATCH_SIZE) {
      const chunk = rows.slice(offset, offset + BATCH_SIZE);
      let lastCode: string | null = null;
      let lastMessage: string | null = null;
      let chunkOk = false;

      for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
        try {
          const { error } = await sb
            .from(table)
            .upsert(chunk, { onConflict, ignoreDuplicates: true });
          if (!error) {
            chunkOk = true;
            break;
          }
          lastCode = error.code ?? "SUPABASE_ERROR";
          lastMessage = error.message;
          // Do not retry schema-missing error PGRST205
          if (error.code === "PGRST205") {
            return { ok: false, code: error.code, message: error.message };
          }
        } catch (err: any) {
          lastCode = "NETWORK_OR_CLIENT_EXCEPTION";
          lastMessage = err?.message ?? String(err);
        }
      }
      if (!chunkOk) {
        return { ok: false, code: lastCode, message: lastMessage };
      }
    }
    return { ok: true, code: null, message: null };
  }

  public async persistMonitoringBatch(params: {
    run?: MonitoringRunSummaryRecord;
    states: CandidateStateTransitionRecord[];
    alerts: MonitoringAlertRecord[];
  }): Promise<MonitoringPersistenceOutcome> {
    // 1. Always durably persist to local JSON ledgers first so zero events are ever lost
    const localRuns = this.readLocalRuns();
    if (params.run) localRuns.push(params.run);
    this.writeLocalRuns(localRuns);

    const localStates = this.readLocalStates();
    localStates.push(...params.states);
    this.writeLocalStates(localStates);

    const localAlerts = this.readLocalAlerts();
    localAlerts.push(...params.alerts);
    this.writeLocalAlerts(localAlerts);

    const sb = this.getAdminClient();
    const runsToSync = params.run ? [params.run] : [];

    if (!sb) {
      const pending = this.enqueueWal(
        runsToSync,
        params.states,
        params.alerts,
        "SUPABASE_CLIENT_UNAVAILABLE"
      );
      this.currentStatus = "LOCAL_ONLY";
      this.lastBlockerCode = "SUPABASE_CLIENT_UNAVAILABLE";
      this.lastBlockerMessage = "Supabase client is not configured or unavailable.";
      const outcome: MonitoringPersistenceOutcome = {
        status: this.currentStatus,
        remoteTablesAvailable: false,
        runsPersistedRemotely: 0,
        statesPersistedRemotely: 0,
        alertsPersistedRemotely: 0,
        pendingWalCount: pending,
        blockerCode: this.lastBlockerCode,
        blockerMessage: this.lastBlockerMessage,
      };
      this.saveStatusMeta(outcome);
      return outcome;
    }

    // 2. Attempt remote persistence with deterministic conflict keys
    const runRes = await this.upsertWithRetry(
      sb,
      "strategy03_monitoring_runs",
      runsToSync.map(mapRunToDbRow),
      "run_id"
    );
    if (!runRes.ok) {
      const pending = this.enqueueWal(runsToSync, params.states, params.alerts, runRes.message);
      const isTableMissing = runRes.code === "PGRST205";
      this.currentStatus = isTableMissing ? "LOCAL_ONLY" : pending > 0 ? "SYNC_PENDING" : "SYNC_ERROR";
      this.lastBlockerCode = runRes.code;
      this.lastBlockerMessage = runRes.message;
      const outcome: MonitoringPersistenceOutcome = {
        status: this.currentStatus,
        remoteTablesAvailable: !isTableMissing,
        runsPersistedRemotely: 0,
        statesPersistedRemotely: 0,
        alertsPersistedRemotely: 0,
        pendingWalCount: pending,
        blockerCode: this.lastBlockerCode,
        blockerMessage: this.lastBlockerMessage,
      };
      this.saveStatusMeta(outcome);
      return outcome;
    }

    const stateRes = await this.upsertWithRetry(
      sb,
      "strategy03_candidate_state_history",
      params.states.map(mapStateToDbRow),
      "transition_key"
    );
    if (!stateRes.ok) {
      const pending = this.enqueueWal([], params.states, params.alerts, stateRes.message);
      const isTableMissing = stateRes.code === "PGRST205";
      this.currentStatus = isTableMissing ? "LOCAL_ONLY" : "SYNC_PENDING";
      this.lastBlockerCode = stateRes.code;
      this.lastBlockerMessage = stateRes.message;
      const outcome: MonitoringPersistenceOutcome = {
        status: this.currentStatus,
        remoteTablesAvailable: !isTableMissing,
        runsPersistedRemotely: runsToSync.length,
        statesPersistedRemotely: 0,
        alertsPersistedRemotely: 0,
        pendingWalCount: pending,
        blockerCode: this.lastBlockerCode,
        blockerMessage: this.lastBlockerMessage,
      };
      this.saveStatusMeta(outcome);
      return outcome;
    }

    const alertRes = await this.upsertWithRetry(
      sb,
      "strategy03_monitoring_alerts",
      params.alerts.map(mapAlertToDbRow),
      "event_id"
    );
    if (!alertRes.ok) {
      const pending = this.enqueueWal([], [], params.alerts, alertRes.message);
      const isTableMissing = alertRes.code === "PGRST205";
      this.currentStatus = isTableMissing ? "LOCAL_ONLY" : "SYNC_PENDING";
      this.lastBlockerCode = alertRes.code;
      this.lastBlockerMessage = alertRes.message;
      const outcome: MonitoringPersistenceOutcome = {
        status: this.currentStatus,
        remoteTablesAvailable: !isTableMissing,
        runsPersistedRemotely: runsToSync.length,
        statesPersistedRemotely: params.states.length,
        alertsPersistedRemotely: 0,
        pendingWalCount: pending,
        blockerCode: this.lastBlockerCode,
        blockerMessage: this.lastBlockerMessage,
      };
      this.saveStatusMeta(outcome);
      return outcome;
    }

    // Remove synced items from WAL if present
    const syncedIds = new Set<string>([
      ...runsToSync.map((r) => `RUN::${r.runId}`),
      ...params.states.map((s) => `STATE::${s.transitionKey}`),
      ...params.alerts.map((a) => `ALERT::${a.eventId}`),
    ]);
    const remainingWal = this.readWal().filter((w) => !syncedIds.has(w.id));
    this.writeWal(remainingWal);

    this.currentStatus = remainingWal.length === 0 ? "REMOTE_SYNCED" : "SYNC_PENDING";
    this.lastBlockerCode = null;
    this.lastBlockerMessage = null;
    const outcome: MonitoringPersistenceOutcome = {
      status: this.currentStatus,
      remoteTablesAvailable: true,
      runsPersistedRemotely: runsToSync.length,
      statesPersistedRemotely: params.states.length,
      alertsPersistedRemotely: params.alerts.length,
      pendingWalCount: remainingWal.length,
      blockerCode: null,
      blockerMessage: null,
    };
    this.saveStatusMeta(outcome);
    return outcome;
  }

  public async loadRecoverySnapshot(): Promise<{
    stateHistory: CandidateStateTransitionRecord[];
    alerts: MonitoringAlertRecord[];
    source: "REMOTE_AND_LOCAL_MERGED" | "LOCAL_ONLY";
  }> {
    const localStates = this.readLocalStates();
    const localAlerts = this.readLocalAlerts();
    const sb = this.getAdminClient();
    if (!sb) {
      return { stateHistory: localStates, alerts: localAlerts, source: "LOCAL_ONLY" };
    }

    try {
      const { data: remStateRows, error: stErr } = await sb
        .from("strategy03_candidate_state_history")
        .select("*")
        .order("created_at", { ascending: true })
        .limit(5000);
      const { data: remAlertRows, error: alErr } = await sb
        .from("strategy03_monitoring_alerts")
        .select("*")
        .order("created_at", { ascending: true })
        .limit(5000);

      if (stErr || alErr) {
        return { stateHistory: localStates, alerts: localAlerts, source: "LOCAL_ONLY" };
      }

      const mergedStates = new Map<string, CandidateStateTransitionRecord>();
      for (const s of localStates) mergedStates.set(s.transitionKey, s);
      for (const r of remStateRows ?? []) {
        const s = mapDbRowToState(r);
        mergedStates.set(s.transitionKey, s);
      }

      const mergedAlerts = new Map<string, MonitoringAlertRecord>();
      for (const a of localAlerts) mergedAlerts.set(a.eventId, a);
      for (const r of remAlertRows ?? []) {
        const a = mapDbRowToAlert(r);
        mergedAlerts.set(a.eventId, a);
      }

      this.writeLocalStates([...mergedStates.values()]);
      this.writeLocalAlerts([...mergedAlerts.values()]);

      return {
        stateHistory: [...mergedStates.values()],
        alerts: [...mergedAlerts.values()],
        source: "REMOTE_AND_LOCAL_MERGED",
      };
    } catch {
      return { stateHistory: localStates, alerts: localAlerts, source: "LOCAL_ONLY" };
    }
  }

  public async reconcileLocalAndRemote(): Promise<MonitoringReconciliationReport> {
    const localRuns = this.readLocalRuns();
    const localStates = this.readLocalStates();
    const localAlerts = this.readLocalAlerts();
    const wal = this.readWal();
    const sb = this.getAdminClient();

    if (!sb) {
      this.currentStatus = "LOCAL_ONLY";
      return {
        reconciledAt: new Date().toISOString(),
        persistenceStatus: "LOCAL_ONLY",
        remoteTablesAvailable: false,
        localCounts: {
          runs: localRuns.length,
          states: localStates.length,
          alerts: localAlerts.length,
          pendingWal: wal.length,
        },
        remoteCounts: { runs: null, states: null, alerts: null },
        missingInRemote: {
          runIds: localRuns.map((r) => r.runId),
          transitionKeysCount: localStates.length,
          alertEventIdsCount: localAlerts.length,
        },
        syncedDuringReconciliation: { runs: 0, states: 0, alerts: 0 },
        inSync: false,
        blockerCode: "SUPABASE_CLIENT_UNAVAILABLE",
        blockerMessage: "Supabase client unavailable.",
      };
    }

    // Probe remote tables
    const { data: remRuns, error: rErr } = await sb
      .from("strategy03_monitoring_runs")
      .select("run_id");
    if (rErr) {
      const isMissing = rErr.code === "PGRST205";
      this.currentStatus = isMissing
        ? "LOCAL_ONLY"
        : wal.length > 0
        ? "SYNC_PENDING"
        : "SYNC_ERROR";
      this.lastBlockerCode = rErr.code ?? "SUPABASE_ERROR";
      this.lastBlockerMessage = rErr.message;
      const report: MonitoringReconciliationReport = {
        reconciledAt: new Date().toISOString(),
        persistenceStatus: this.currentStatus,
        remoteTablesAvailable: !isMissing,
        localCounts: {
          runs: localRuns.length,
          states: localStates.length,
          alerts: localAlerts.length,
          pendingWal: wal.length,
        },
        remoteCounts: { runs: null, states: null, alerts: null },
        missingInRemote: {
          runIds: localRuns.map((r) => r.runId),
          transitionKeysCount: localStates.length,
          alertEventIdsCount: localAlerts.length,
        },
        syncedDuringReconciliation: { runs: 0, states: 0, alerts: 0 },
        inSync: false,
        blockerCode: this.lastBlockerCode,
        blockerMessage: this.lastBlockerMessage,
      };
      this.saveStatusMeta({
        status: this.currentStatus,
        remoteTablesAvailable: !isMissing,
        runsPersistedRemotely: 0,
        statesPersistedRemotely: 0,
        alertsPersistedRemotely: 0,
        pendingWalCount: wal.length,
        blockerCode: this.lastBlockerCode,
        blockerMessage: this.lastBlockerMessage,
      });
      return report;
    }

    const { data: remStates, error: sErr } = await sb
      .from("strategy03_candidate_state_history")
      .select("transition_key")
      .limit(10000);
    const { data: remAlerts, error: aErr } = await sb
      .from("strategy03_monitoring_alerts")
      .select("event_id")
      .limit(10000);

    if (sErr || aErr) {
      const err = sErr ?? aErr!;
      const isMissing = err.code === "PGRST205";
      this.currentStatus = isMissing ? "LOCAL_ONLY" : "SYNC_ERROR";
      this.lastBlockerCode = err.code ?? "SUPABASE_ERROR";
      this.lastBlockerMessage = err.message;
      return {
        reconciledAt: new Date().toISOString(),
        persistenceStatus: this.currentStatus,
        remoteTablesAvailable: !isMissing,
        localCounts: {
          runs: localRuns.length,
          states: localStates.length,
          alerts: localAlerts.length,
          pendingWal: wal.length,
        },
        remoteCounts: { runs: remRuns?.length ?? null, states: null, alerts: null },
        missingInRemote: {
          runIds: localRuns.map((r) => r.runId),
          transitionKeysCount: localStates.length,
          alertEventIdsCount: localAlerts.length,
        },
        syncedDuringReconciliation: { runs: 0, states: 0, alerts: 0 },
        inSync: false,
        blockerCode: this.lastBlockerCode,
        blockerMessage: this.lastBlockerMessage,
      };
    }

    const remRunSet = new Set((remRuns ?? []).map((r: any) => String(r.run_id)));
    const remStateSet = new Set((remStates ?? []).map((s: any) => String(s.transition_key)));
    const remAlertSet = new Set((remAlerts ?? []).map((a: any) => String(a.event_id)));

    const missingRuns = localRuns.filter((r) => !remRunSet.has(r.runId));
    const missingStates = localStates.filter((s) => !remStateSet.has(s.transitionKey));
    const missingAlerts = localAlerts.filter((a) => !remAlertSet.has(a.eventId));

    const upRun = await this.upsertWithRetry(
      sb,
      "strategy03_monitoring_runs",
      missingRuns.map(mapRunToDbRow),
      "run_id"
    );
    const upState = await this.upsertWithRetry(
      sb,
      "strategy03_candidate_state_history",
      missingStates.map(mapStateToDbRow),
      "transition_key"
    );
    const upAlert = await this.upsertWithRetry(
      sb,
      "strategy03_monitoring_alerts",
      missingAlerts.map(mapAlertToDbRow),
      "event_id"
    );

    const allOk = upRun.ok && upState.ok && upAlert.ok;
    if (allOk) {
      this.writeWal([]);
      this.currentStatus = "REMOTE_SYNCED";
      this.lastBlockerCode = null;
      this.lastBlockerMessage = null;
    } else {
      this.currentStatus = "SYNC_PENDING";
      this.lastBlockerCode = upRun.code ?? upState.code ?? upAlert.code;
      this.lastBlockerMessage = upRun.message ?? upState.message ?? upAlert.message;
    }

    const finalRemoteRuns = remRunSet.size + (upRun.ok ? missingRuns.length : 0);
    const finalRemoteStates = remStateSet.size + (upState.ok ? missingStates.length : 0);
    const finalRemoteAlerts = remAlertSet.size + (upAlert.ok ? missingAlerts.length : 0);

    this.saveStatusMeta({
      status: this.currentStatus,
      remoteTablesAvailable: true,
      runsPersistedRemotely: upRun.ok ? missingRuns.length : 0,
      statesPersistedRemotely: upState.ok ? missingStates.length : 0,
      alertsPersistedRemotely: upAlert.ok ? missingAlerts.length : 0,
      pendingWalCount: this.readWal().length,
      blockerCode: this.lastBlockerCode,
      blockerMessage: this.lastBlockerMessage,
    });

    return {
      reconciledAt: new Date().toISOString(),
      persistenceStatus: this.currentStatus,
      remoteTablesAvailable: true,
      localCounts: {
        runs: localRuns.length,
        states: localStates.length,
        alerts: localAlerts.length,
        pendingWal: this.readWal().length,
      },
      remoteCounts: {
        runs: finalRemoteRuns,
        states: finalRemoteStates,
        alerts: finalRemoteAlerts,
      },
      missingInRemote: {
        runIds: missingRuns.map((r) => r.runId),
        transitionKeysCount: missingStates.length,
        alertEventIdsCount: missingAlerts.length,
      },
      syncedDuringReconciliation: {
        runs: upRun.ok ? missingRuns.length : 0,
        states: upState.ok ? missingStates.length : 0,
        alerts: upAlert.ok ? missingAlerts.length : 0,
      },
      inSync: allOk,
      blockerCode: this.lastBlockerCode,
      blockerMessage: this.lastBlockerMessage,
    };
  }
}

