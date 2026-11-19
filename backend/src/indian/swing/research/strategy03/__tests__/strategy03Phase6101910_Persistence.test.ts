import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { FourHourCandle } from "../prebreakout/Strategy03FourHourCandleProvider.js";
import { Strategy03FourHourMonitoringEngine } from "../prebreakout/Strategy03FourHourMonitoringEngine.js";
import { Strategy03FourHourMonitoringPersistence } from "../prebreakout/Strategy03FourHourMonitoringPersistence.js";

function makeReadySeries(): FourHourCandle[] {
  const base: FourHourCandle[] = Array.from({ length: 18 }, (_, i) => ({
    timeframe: "4H",
    timestamp: new Date(Date.UTC(2026, 9, 10 + Math.floor(i / 2), i % 2 === 0 ? 4 : 8, 15)).toISOString(),
    open: 100,
    high: 100.8,
    low: 99.5,
    close: 100.1,
    volume: 50_000,
    isComplete: true,
    constituentBarCount: 4,
    blockDurationMinutes: 240,
  }));
  base[13] = { ...base[13], low: 99.5, close: 100.3 };
  base[15] = { ...base[15], low: 99.6, close: 100.2 };
  const obBar: FourHourCandle = {
    timeframe: "4H",
    timestamp: "2026-10-22T04:15:00.000Z",
    open: 100.2,
    high: 100.4,
    low: 99.0,
    close: 99.3,
    volume: 65_000,
    isComplete: true,
    constituentBarCount: 4,
    blockDurationMinutes: 240,
  };
  const imp: FourHourCandle[] = [
    { timeframe: "4H", timestamp: "2026-10-22T08:15:00.000Z", open: 99.3, high: 102.5, low: 99.2, close: 102.2, volume: 110_000, isComplete: true, constituentBarCount: 3, blockDurationMinutes: 135 },
    { timeframe: "4H", timestamp: "2026-10-23T04:15:00.000Z", open: 102.2, high: 105.2, low: 102.0, close: 104.8, volume: 120_000, isComplete: true, constituentBarCount: 4, blockDurationMinutes: 240 },
    { timeframe: "4H", timestamp: "2026-10-23T08:15:00.000Z", open: 104.8, high: 107.6, low: 104.5, close: 107.2, volume: 115_000, isComplete: true, constituentBarCount: 3, blockDurationMinutes: 135 },
  ];
  const cons: FourHourCandle[] = Array.from({ length: 7 }, (_, i) => ({
    timeframe: "4H",
    timestamp: new Date(Date.UTC(2026, 9, 26 + Math.floor(i / 2), i % 2 === 0 ? 4 : 8, 15)).toISOString(),
    open: 106.5,
    high: 108.0,
    low: 105.5,
    close: 107.2,
    volume: 42_000,
    isComplete: true,
    constituentBarCount: 4,
    blockDurationMinutes: 240,
  }));
  return [...base, obBar, ...imp, ...cons];
}

function createMockSupabaseEnv() {
  const tables: Record<string, Map<string, any>> = {
    strategy03_monitoring_runs: new Map(),
    strategy03_candidate_state_history: new Map(),
    strategy03_monitoring_alerts: new Map(),
  };
  let mode: "ONLINE" | "OUTAGE" | "SCHEMA_MISSING" = "ONLINE";

  const makeClient = (role: "service_role" | "authenticated" | "anon"): SupabaseClient => {
    const client: any = {
      from(tableName: string) {
        const store = tables[tableName];
        const builder: any = {
          select() {
            return builder;
          },
          order() {
            return builder;
          },
          limit() {
            return builder;
          },
          then(resolve: any) {
            if (mode === "SCHEMA_MISSING") {
              return resolve({
                data: null,
                error: {
                  code: "PGRST205",
                  message: `Could not find the table 'public.${tableName}' in the schema cache`,
                },
              });
            }
            if (mode === "OUTAGE") {
              return resolve({
                data: null,
                error: { code: "503", message: "TEMPORARY_OUTAGE" },
              });
            }
            if (role === "anon") {
              return resolve({ data: [], error: null });
            }
            return resolve({ data: [...store.values()], error: null });
          },
          async upsert(rows: any | any[], opts?: { onConflict?: string; ignoreDuplicates?: boolean }) {
            if (mode === "SCHEMA_MISSING") {
              return {
                data: null,
                error: {
                  code: "PGRST205",
                  message: `Could not find the table 'public.${tableName}' in the schema cache`,
                },
              };
            }
            if (mode === "OUTAGE") {
              return {
                data: null,
                error: { code: "503", message: "TEMPORARY_OUTAGE" },
              };
            }
            if (role !== "service_role") {
              return {
                data: null,
                error: { code: "42501", message: "new row violates row-level security policy" },
              };
            }
            const arr = Array.isArray(rows) ? rows : [rows];
            const keyField = opts?.onConflict ?? "id";
            for (const r of arr) {
              const k = String(r[keyField]);
              if (opts?.ignoreDuplicates && store.has(k)) continue;
              store.set(k, { ...r });
            }
            return { data: arr, error: null };
          },
          async insert(rows: any | any[]) {
            return builder.upsert(rows, { onConflict: "id" });
          },
        };
        return builder;
      },
    };
    return client as SupabaseClient;
  };

  return {
    tables,
    setMode: (m: "ONLINE" | "OUTAGE" | "SCHEMA_MISSING") => {
      mode = m;
    },
    serviceClient: makeClient("service_role"),
    authenticatedClient: makeClient("authenticated"),
    anonClient: makeClient("anon"),
  };
}

describe("Strategy 03 Phase 6.10.19.10 — Supabase Persistence Activation & Recovery Validation", () => {
  const tempDirs: string[] = [];

  function makeTempDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "s03_p6101910_"));
    tempDirs.push(dir);
    return dir;
  }

  afterEach(() => {
    for (const d of tempDirs.splice(0)) {
      fs.rmSync(d, { recursive: true, force: true });
    }
  });

  it("1-6. restores state on backend restart, prevents duplicate alerts across restarts, queues during temporary outage, reconciles local/remote, and persists ANANDRATHI invalidation exactly once", async () => {
    const dir = makeTempDir();
    const env = createMockSupabaseEnv();
    const persistence = new Strategy03FourHourMonitoringPersistence(dir, () => env.serviceClient, 1);

    const s0 = makeReadySeries();
    const engine1 = new Strategy03FourHourMonitoringEngine();
    const init = engine1.evaluateSymbol({
      nseSymbol: "ANANDRATHI",
      companyName: "Anand Rathi Wealth",
      candles: s0,
      dataProvider: "4H",
      sourceReference: "cache4h/ANANDRATHI_4h.json",
    });
    expect(init.stateRecord.currentStatus).toBe("READY");

    const p1 = await persistence.persistMonitoringBatch({
      run: {
        runId: "run_1",
        evaluatedAt: new Date().toISOString(),
        completed4hTimestampIst: init.stateRecord.completed4hTimestampIst,
        candidatesEvaluated: 1,
        stateCounts: { READY: 1, FORMING: 0, BREAKOUT: 0, INVALIDATED: 0, WAIT: 0 },
        alertsGenerated: engine1.getAlerts().length,
        duplicatesPrevented: 0,
      },
      states: engine1.getStateHistory(),
      alerts: engine1.getAlerts(),
    });
    expect(p1.status).toBe("REMOTE_SYNCED");

    // 1. Backend restart restores last candidate states
    const restarted = new Strategy03FourHourMonitoringEngine();
    const snap = await persistence.loadRecoverySnapshot();
    restarted.recoverState({ stateHistory: snap.stateHistory, alerts: snap.alerts });
    expect(restarted.getLatestState("ANANDRATHI")?.currentStatus).toBe("READY");

    // 2. Re-running same completed 4H snapshot creates 0 duplicate alerts
    const dup = restarted.evaluateSymbol({
      nseSymbol: "ANANDRATHI",
      companyName: "Anand Rathi Wealth",
      candles: s0,
      dataProvider: "4H",
      sourceReference: "cache4h/ANANDRATHI_4h.json",
    });
    expect(dup.duplicatePrevented).toBe(true);
    expect(dup.newAlerts).toHaveLength(0);

    // ANANDRATHI incomplete candle below consolidation low (105.5) must NOT invalidate
    const incDip: FourHourCandle = {
      timeframe: "4H",
      timestamp: "2026-10-30T04:15:00.000Z",
      open: 106.0,
      high: 106.2,
      low: 104.5,
      close: 104.8,
      volume: 60_000,
      isComplete: false,
      constituentBarCount: 1,
    };
    const afterInc = restarted.evaluateSymbol({
      nseSymbol: "ANANDRATHI",
      companyName: "Anand Rathi Wealth",
      candles: [...s0, incDip],
      dataProvider: "4H",
      sourceReference: "cache4h/ANANDRATHI_4h.json",
    });
    expect(afterInc.stateRecord.currentStatus).toBe("READY");

    // 3 & 4. Simulate temporary Supabase outage during completed 4H breakdown candle
    env.setMode("OUTAGE");
    const compDip: FourHourCandle = { ...incDip, isComplete: true, constituentBarCount: 4 };
    const afterComp = restarted.evaluateSymbol({
      nseSymbol: "ANANDRATHI",
      companyName: "Anand Rathi Wealth",
      candles: [...s0, compDip],
      dataProvider: "4H",
      sourceReference: "cache4h/ANANDRATHI_4h.json",
    });
    expect(afterComp.stateRecord.currentStatus).toBe("INVALIDATED");

    const outagePersist = await persistence.persistMonitoringBatch({
      states: [afterComp.stateRecord],
      alerts: afterComp.newAlerts,
    });
    expect(outagePersist.status).toBe("SYNC_PENDING");
    expect(outagePersist.pendingWalCount).toBeGreaterThan(0);

    // 5 & 6. Restore Supabase and reconcile pending WAL + local JSON with remote DB
    env.setMode("ONLINE");
    const rec1 = await persistence.reconcileLocalAndRemote();
    expect(rec1.inSync).toBe(true);
    expect(rec1.persistenceStatus).toBe("REMOTE_SYNCED");
    expect(rec1.localCounts.pendingWal).toBe(0);
    expect(rec1.localCounts.states).toBe(rec1.remoteCounts.states);

    // Re-run reconciliation to verify idempotent upsert (persisted remotely exactly once)
    const rec2 = await persistence.reconcileLocalAndRemote();
    expect(rec2.syncedDuringReconciliation.states).toBe(0);
    const remoteInvalidated = [...env.tables.strategy03_candidate_state_history.values()].filter(
      (r) => r.symbol === "ANANDRATHI" && r.current_status === "INVALIDATED"
    );
    expect(remoteInvalidated).toHaveLength(1);
  });

  it("7. stays in LOCAL_ONLY mode when remote tables are not applied (PGRST205) and enforces RLS policies when online", async () => {
    const dir = makeTempDir();
    const env = createMockSupabaseEnv();
    env.setMode("SCHEMA_MISSING");

    const persistence = new Strategy03FourHourMonitoringPersistence(dir, () => env.serviceClient, 1);
    const s0 = makeReadySeries();
    const engine = new Strategy03FourHourMonitoringEngine();
    const r = engine.evaluateSymbol({
      nseSymbol: "SUNPHARMA",
      companyName: "Sun",
      candles: s0,
      dataProvider: "4H",
      sourceReference: "t",
    });

    const pOut = await persistence.persistMonitoringBatch({
      states: [r.stateRecord],
      alerts: r.newAlerts,
    });
    expect(pOut.status).toBe("LOCAL_ONLY");
    expect(pOut.remoteTablesAvailable).toBe(false);
    expect(pOut.blockerCode).toBe("PGRST205");

    // Switch to ONLINE and verify RLS blocks anon/authenticated writes and anon reads
    env.setMode("ONLINE");
    await persistence.reconcileLocalAndRemote();

    const anonWrite = await (env.anonClient.from("strategy03_monitoring_alerts") as any).insert({
      event_id: "bad_1",
    });
    const authWrite = await (env.authenticatedClient.from("strategy03_monitoring_alerts") as any).insert({
      event_id: "bad_2",
    });
    const anonRead = await env.anonClient.from("strategy03_monitoring_alerts").select("*");
    const authRead = await env.authenticatedClient.from("strategy03_monitoring_alerts").select("*");

    expect(anonWrite.error?.code).toBe("42501");
    expect(authWrite.error?.code).toBe("42501");
    expect(anonRead.data).toHaveLength(0);
    expect(authRead.data?.length).toBeGreaterThan(0);
  });
});

