import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Strategy03FourHourMonitoringPersistence } from "../prebreakout/Strategy03FourHourMonitoringPersistence.js";
import { Strategy03RemotePersistenceVerifier } from "../prebreakout/Strategy03RemotePersistenceVerifier.js";
import {
  DEFAULT_STRATEGY03_PAPER_ISOLATION_CONFIG,
  validateStrategy03IsolationGuard,
} from "../Strategy03PaperIsolationConfig.js";

const MIGRATION_SQL_PATH = path.resolve(
  "D:/Trading/my-app/backend/supabase/migrations/20261118_strategy03_4h_monitoring.sql"
);

function createMockSupabaseSuite(initialMode: "SCHEMA_MISSING" | "ONLINE") {
  let mode = initialMode;
  const tables: Record<string, Map<string, any>> = {
    strategy03_monitoring_runs: new Map(),
    strategy03_candidate_state_history: new Map(),
    strategy03_monitoring_alerts: new Map(),
  };

  const makeClient = (role: "service_role" | "authenticated" | "anon"): SupabaseClient => {
    const client: any = {
      from(tableName: string) {
        const store = tables[tableName];
        let filterCol: string | null = null;
        let filterVal: string | null = null;
        let isDelete = false;

        const builder: any = {
          select() {
            return builder;
          },
          limit() {
            return builder;
          },
          order() {
            return builder;
          },
          eq(col: string, val: string) {
            filterCol = col;
            filterVal = val;
            return builder;
          },
          delete() {
            isDelete = true;
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
            if (isDelete) {
              if (role !== "service_role") {
                return resolve({
                  data: null,
                  error: { code: "42501", message: "RLS policy violation" },
                });
              }
              if (filterCol && filterVal !== null) {
                for (const [k, v] of store.entries()) {
                  if (String(v[filterCol]) === String(filterVal)) {
                    store.delete(k);
                  }
                }
              }
              return resolve({ data: [], error: null });
            }
            if (role === "anon") {
              return resolve({ data: [], error: null });
            }
            let rows = [...store.values()];
            if (filterCol && filterVal !== null) {
              rows = rows.filter((r) => String(r[filterCol!]) === String(filterVal));
            }
            return resolve({ data: rows, error: null });
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
            if (role !== "service_role") {
              return {
                data: null,
                error: { code: "42501", message: "RLS policy violation" },
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
    setMode: (m: "SCHEMA_MISSING" | "ONLINE") => {
      mode = m;
    },
    serviceClient: makeClient("service_role"),
    authenticatedClient: makeClient("authenticated"),
    anonClient: makeClient("anon"),
  };
}

describe("Strategy 03 Phase 6.10.19.14 — Supabase Remote Persistence Activation & Reconciliation Audit", () => {
  const tempDirs: string[] = [];

  function makeTempDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "s03_p6101914_"));
    tempDirs.push(dir);
    return dir;
  }

  afterEach(() => {
    for (const d of tempDirs.splice(0)) {
      fs.rmSync(d, { recursive: true, force: true });
    }
  });

  it("1-4. inspects 20261118_strategy03_4h_monitoring.sql and stops remote activation cleanly in LOCAL_ONLY mode when remote schema is missing (PGRST205)", async () => {
    const dir = makeTempDir();
    const verifier = new Strategy03RemotePersistenceVerifier();
    const inspection = verifier.inspectMigrationSql(MIGRATION_SQL_PATH);

    expect(inspection.allInspectionChecksPassed).toBe(true);
    expect(inspection.rlsEnabledOnAllThreeTables).toBe(true);
    expect(inspection.serviceRoleWritePoliciesVerified).toBe(true);
    expect(inspection.authenticatedReadOnlyPoliciesVerified).toBe(true);
    expect(inspection.noAnonymousWriteAccessVerified).toBe(true);

    const mockEnv = createMockSupabaseSuite("SCHEMA_MISSING");
    const report = await verifier.verifyAndReconcileRemotePersistence({
      migrationFilePath: MIGRATION_SQL_PATH,
      storageDir: dir,
      serviceClient: mockEnv.serviceClient,
      anonClient: mockEnv.anonClient,
      authenticatedClient: mockEnv.authenticatedClient,
    });

    expect(report.remoteSchemaAvailable).toBe(false);
    expect(report.manualSqlExecutionStillRequired).toBe(true);
    expect(report.migrationStatus).toBe("UNAPPLIED_MANUAL_SQL_REQUIRED");
    expect(report.controlledPersistenceTest.executed).toBe(false);
    expect(report.finalTruthfulPersistenceStatus).toBe("LOCAL_ONLY");
    expect(report.exactUnresolvedBlocker).toContain("PGRST205");
  });

  it("5-8. executes controlled test record write/read/idempotent-upsert/cleanup, reconciles WAL once schema is applied, enforces RLS, and confirms safety locks", async () => {
    const dir = makeTempDir();
    const mockEnv = createMockSupabaseSuite("ONLINE");

    // Seed local ledger with 1 genuine monitoring run before remote verification
    const persistence = new Strategy03FourHourMonitoringPersistence(dir, () => null);
    await persistence.persistMonitoringBatch({
      run: {
        runId: "genuine_run_1",
        evaluatedAt: "2026-11-18T10:00:00.000Z",
        completed4hTimestampIst: "2026-11-18T09:15:00.000+05:30",
        candidatesEvaluated: 83,
        stateCounts: { READY: 83, FORMING: 0, BREAKOUT: 0, INVALIDATED: 0, WAIT: 0 },
        alertsGenerated: 1,
        duplicatesPrevented: 0,
      },
      states: [],
      alerts: [],
    });
    expect(persistence.readWal().length).toBe(1);

    const verifier = new Strategy03RemotePersistenceVerifier();
    const report = await verifier.verifyAndReconcileRemotePersistence({
      migrationFilePath: MIGRATION_SQL_PATH,
      storageDir: dir,
      serviceClient: mockEnv.serviceClient,
      anonClient: mockEnv.anonClient,
      authenticatedClient: mockEnv.authenticatedClient,
    });

    expect(report.remoteSchemaAvailable).toBe(true);
    expect(report.manualSqlExecutionStillRequired).toBe(false);
    expect(report.rlsVerificationStatus).toBe("VERIFIED_REMOTE");
    expect(report.controlledPersistenceTest.executed).toBe(true);
    expect(report.controlledPersistenceTest.writeAndReadBackExactMatch).toBe(true);
    expect(report.controlledPersistenceTest.idempotentUpsertNoDuplicateVerified).toBe(true);
    expect(report.controlledPersistenceTest.cleanupTestRecordSucceeded).toBe(true);
    expect(report.finalTruthfulPersistenceStatus).toBe("REMOTE_SYNCED");
    expect(report.localWalPendingCount).toBe(0);

    // Ensure test record was cleaned up and genuine record was reconciled exactly once
    expect(mockEnv.tables.strategy03_monitoring_runs.has("__PHASE6101914_VERIFY_TEST__RUN_1")).toBe(false);
    expect(mockEnv.tables.strategy03_monitoring_runs.has("genuine_run_1")).toBe(true);

    // Safety locks remain OFF
    expect(DEFAULT_STRATEGY03_PAPER_ISOLATION_CONFIG.enabled).toBe(false);
    expect(() =>
      validateStrategy03IsolationGuard(DEFAULT_STRATEGY03_PAPER_ISOLATION_CONFIG, {
        STRATEGY_01: false,
        STRATEGY_02: false,
        STRATEGY_03: false,
        LIVE_TRADING: false,
        BROKER_EXECUTION_ENABLED: false,
      })
    ).not.toThrow();
  });
});

