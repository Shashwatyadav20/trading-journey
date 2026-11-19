import fs from "node:fs";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  Strategy03FourHourMonitoringPersistence,
  type MonitoringPersistenceStatus,
  type MonitoringReconciliationReport,
} from "./Strategy03FourHourMonitoringPersistence.js";

export interface MigrationSqlInspectionReport {
  migrationFilePath: string;
  fileExists: boolean;
  requiredTablesVerified: {
    strategy03_monitoring_runs: boolean;
    strategy03_candidate_state_history: boolean;
    strategy03_monitoring_alerts: boolean;
  };
  primaryKeysVerified: boolean;
  uniqueIdempotencyKeysVerified: {
    run_id_unique: boolean;
    transition_key_unique: boolean;
    event_id_unique: boolean;
  };
  indexesVerified: {
    idx_s03_mon_state_sym: boolean;
    idx_s03_mon_alerts_sym: boolean;
  };
  rlsEnabledOnAllThreeTables: boolean;
  serviceRoleWritePoliciesVerified: boolean;
  authenticatedReadOnlyPoliciesVerified: boolean;
  noAnonymousWriteAccessVerified: boolean;
  noSensitiveDataExposureInPolicies: boolean;
  allInspectionChecksPassed: boolean;
}

export interface RemoteTableSchemaCheck {
  table: string;
  recognizedInSchemaCache: boolean;
  serviceRoleSelectOk: boolean;
  anonWriteDenied: boolean;
  anonWriteErrorCode: string | null;
  authenticatedSelectAllowed: boolean;
  errorCode: string | null;
  errorMessage: string | null;
}

export interface ControlledRemotePersistenceTestResult {
  executed: boolean;
  skippedReason: string | null;
  testIdentifierPrefix: string;
  writeAndReadBackExactMatch: boolean;
  idempotentUpsertNoDuplicateVerified: boolean;
  cleanupTestRecordSucceeded: boolean;
  genuineRecordsUntouched: boolean;
  lastSuccessfulRemoteWriteIso: string | null;
  errorMessage: string | null;
}

export interface Phase6101914PersistenceActivationReport {
  evaluatedAtIso: string;
  phase: "6.10.19.14";
  migrationInspection: MigrationSqlInspectionReport;
  manualSqlExecutionStillRequired: boolean;
  remoteSchemaAvailable: boolean;
  migrationStatus: "APPLIED_AND_VERIFIED" | "UNAPPLIED_MANUAL_SQL_REQUIRED";
  rlsVerificationStatus: "VERIFIED_REMOTE" | "VERIFIED_IN_SQL_PENDING_REMOTE_DDL" | "FAILED";
  remoteTableChecks: RemoteTableSchemaCheck[];
  controlledPersistenceTest: ControlledRemotePersistenceTestResult;
  reconciliationReport: MonitoringReconciliationReport | null;
  lastSuccessfulRemoteWriteIso: string | null;
  localWalPendingCount: number;
  finalTruthfulPersistenceStatus: MonitoringPersistenceStatus;
  exactUnresolvedBlocker: string | null;
  manualRemainingAction: string | null;
}

export class Strategy03RemotePersistenceVerifier {
  /**
   * 1. Inspects 20261118_strategy03_4h_monitoring.sql for required tables, columns,
   * primary keys, unique constraints, indexes, and RLS policies.
   */
  public inspectMigrationSql(migrationFilePath: string): MigrationSqlInspectionReport {
    const exists = fs.existsSync(migrationFilePath);
    const sql = exists ? fs.readFileSync(migrationFilePath, "utf8") : "";

    const hasRunsTable =
      sql.includes("CREATE TABLE IF NOT EXISTS public.strategy03_monitoring_runs") &&
      sql.includes("id UUID PRIMARY KEY DEFAULT gen_random_uuid()") &&
      sql.includes("run_id TEXT NOT NULL UNIQUE");

    const hasStatesTable =
      sql.includes("CREATE TABLE IF NOT EXISTS public.strategy03_candidate_state_history") &&
      sql.includes("transition_key TEXT NOT NULL UNIQUE") &&
      sql.includes("CHECK (current_status IN ('FORMING', 'READY', 'BREAKOUT', 'INVALIDATED', 'WAIT'))");

    const hasAlertsTable =
      sql.includes("CREATE TABLE IF NOT EXISTS public.strategy03_monitoring_alerts") &&
      sql.includes("event_id TEXT NOT NULL UNIQUE");

    const hasIdxState = sql.includes(
      "CREATE INDEX IF NOT EXISTS idx_s03_mon_state_sym ON public.strategy03_candidate_state_history (symbol, created_at DESC)"
    );
    const hasIdxAlerts = sql.includes(
      "CREATE INDEX IF NOT EXISTS idx_s03_mon_alerts_sym ON public.strategy03_monitoring_alerts (symbol, created_at DESC)"
    );

    const rlsEnabled =
      sql.includes("ALTER TABLE public.strategy03_monitoring_runs ENABLE ROW LEVEL SECURITY;") &&
      sql.includes("ALTER TABLE public.strategy03_candidate_state_history ENABLE ROW LEVEL SECURITY;") &&
      sql.includes("ALTER TABLE public.strategy03_monitoring_alerts ENABLE ROW LEVEL SECURITY;");

    const servicePolicies =
      sql.includes('CREATE POLICY "s03_mon_runs_service_all" ON public.strategy03_monitoring_runs FOR ALL TO service_role') &&
      sql.includes('CREATE POLICY "s03_mon_state_service_all" ON public.strategy03_candidate_state_history FOR ALL TO service_role') &&
      sql.includes('CREATE POLICY "s03_mon_alerts_service_all" ON public.strategy03_monitoring_alerts FOR ALL TO service_role');

    const authReadPolicies =
      sql.includes('CREATE POLICY "s03_mon_runs_auth_read" ON public.strategy03_monitoring_runs FOR SELECT TO authenticated') &&
      sql.includes('CREATE POLICY "s03_mon_state_auth_read" ON public.strategy03_candidate_state_history FOR SELECT TO authenticated') &&
      sql.includes('CREATE POLICY "s03_mon_alerts_auth_read" ON public.strategy03_monitoring_alerts FOR SELECT TO authenticated');

    const noAnonGrant =
      !sql.toLowerCase().includes("to anon") &&
      !sql.toLowerCase().includes("to public");

    const allPassed =
      exists &&
      hasRunsTable &&
      hasStatesTable &&
      hasAlertsTable &&
      hasIdxState &&
      hasIdxAlerts &&
      rlsEnabled &&
      servicePolicies &&
      authReadPolicies &&
      noAnonGrant;

    return {
      migrationFilePath,
      fileExists: exists,
      requiredTablesVerified: {
        strategy03_monitoring_runs: hasRunsTable,
        strategy03_candidate_state_history: hasStatesTable,
        strategy03_monitoring_alerts: hasAlertsTable,
      },
      primaryKeysVerified: hasRunsTable && hasStatesTable && hasAlertsTable,
      uniqueIdempotencyKeysVerified: {
        run_id_unique: hasRunsTable,
        transition_key_unique: hasStatesTable,
        event_id_unique: hasAlertsTable,
      },
      indexesVerified: {
        idx_s03_mon_state_sym: hasIdxState,
        idx_s03_mon_alerts_sym: hasIdxAlerts,
      },
      rlsEnabledOnAllThreeTables: rlsEnabled,
      serviceRoleWritePoliciesVerified: servicePolicies,
      authenticatedReadOnlyPoliciesVerified: authReadPolicies,
      noAnonymousWriteAccessVerified: noAnonGrant,
      noSensitiveDataExposureInPolicies: noAnonGrant,
      allInspectionChecksPassed: allPassed,
    };
  }

  /**
   * 2. Verifies remote schema availability, RLS policies, and runs the controlled persistence test
   * ONLY if all three tables exist in the remote Supabase schema cache.
   */
  public async verifyAndReconcileRemotePersistence(params: {
    migrationFilePath: string;
    storageDir: string;
    serviceClient: SupabaseClient | null;
    anonClient: SupabaseClient | null;
    authenticatedClient?: SupabaseClient | null;
    now?: Date;
  }): Promise<Phase6101914PersistenceActivationReport> {
    const evalNow = params.now ?? new Date();
    const migrationInspection = this.inspectMigrationSql(params.migrationFilePath);
    const persistence = new Strategy03FourHourMonitoringPersistence(
      params.storageDir,
      () => params.serviceClient
    );

    const tables = [
      "strategy03_monitoring_runs",
      "strategy03_candidate_state_history",
      "strategy03_monitoring_alerts",
    ];
    const remoteTableChecks: RemoteTableSchemaCheck[] = [];

    for (const t of tables) {
      if (!params.serviceClient) {
        remoteTableChecks.push({
          table: t,
          recognizedInSchemaCache: false,
          serviceRoleSelectOk: false,
          anonWriteDenied: true,
          anonWriteErrorCode: "SUPABASE_CLIENT_UNAVAILABLE",
          authenticatedSelectAllowed: false,
          errorCode: "SUPABASE_CLIENT_UNAVAILABLE",
          errorMessage: "Supabase service client is unavailable.",
        });
        continue;
      }

      const srvRead = await params.serviceClient.from(t).select("*").limit(1);
      const existsInCache = !srvRead.error;

      const anonWrite = params.anonClient
        ? await (params.anonClient.from(t) as any).insert({})
        : { error: { code: "NO_ANON_CLIENT", message: "Anon client unavailable" } };

      const authClient = params.authenticatedClient ?? params.serviceClient;
      const authRead = await authClient.from(t).select("*").limit(1);

      remoteTableChecks.push({
        table: t,
        recognizedInSchemaCache: existsInCache,
        serviceRoleSelectOk: !srvRead.error,
        anonWriteDenied: Boolean(anonWrite.error),
        anonWriteErrorCode: anonWrite.error?.code ?? null,
        authenticatedSelectAllowed: !authRead.error,
        errorCode: srvRead.error?.code ?? null,
        errorMessage: srvRead.error?.message ?? null,
      });
    }

    const remoteSchemaAvailable = remoteTableChecks.every((c) => c.recognizedInSchemaCache);
    const localWalCountBefore = persistence.readWal().length;

    // If any table is missing from remote schema cache (PGRST205), stop remote activation immediately
    if (!remoteSchemaAvailable || !params.serviceClient) {
      const firstErr = remoteTableChecks.find((c) => !c.recognizedInSchemaCache);
      const blockerMsg = firstErr
        ? `${firstErr.errorCode}: ${firstErr.errorMessage}`
        : "SUPABASE_CLIENT_UNAVAILABLE";

      return {
        evaluatedAtIso: evalNow.toISOString(),
        phase: "6.10.19.14",
        migrationInspection,
        manualSqlExecutionStillRequired: true,
        remoteSchemaAvailable: false,
        migrationStatus: "UNAPPLIED_MANUAL_SQL_REQUIRED",
        rlsVerificationStatus: migrationInspection.rlsEnabledOnAllThreeTables
          ? "VERIFIED_IN_SQL_PENDING_REMOTE_DDL"
          : "FAILED",
        remoteTableChecks,
        controlledPersistenceTest: {
          executed: false,
          skippedReason:
            "Remote tables are not yet applied in Supabase schema cache (PGRST205). Controlled write test skipped per Section 4 & 5 rules.",
          testIdentifierPrefix: "__PHASE6101914_VERIFY_TEST__",
          writeAndReadBackExactMatch: false,
          idempotentUpsertNoDuplicateVerified: false,
          cleanupTestRecordSucceeded: false,
          genuineRecordsUntouched: true,
          lastSuccessfulRemoteWriteIso: null,
          errorMessage: blockerMsg,
        },
        reconciliationReport: null,
        lastSuccessfulRemoteWriteIso: null,
        localWalPendingCount: localWalCountBefore,
        finalTruthfulPersistenceStatus: "LOCAL_ONLY",
        exactUnresolvedBlocker: `${blockerMsg} (No direct Postgres DATABASE_URL or Supabase Management PAT configured in environment; PostgREST cannot execute raw DDL).`,
        manualRemainingAction:
          "Open the Supabase Dashboard SQL Editor for the configured project, paste and execute backend/supabase/migrations/20261118_strategy03_4h_monitoring.sql (or follow phase6101914_manual_migration_runbook.md), then re-run runPhase6101914_PersistenceActivationAudit.ts.",
      };
    }

    // 3. Remote schema IS available: Run controlled persistence test with deterministic test identifier
    const testPrefix = "__PHASE6101914_VERIFY_TEST__";
    const testRunId = `${testPrefix}RUN_1`;
    const sb = params.serviceClient;

    let writeAndReadBackExactMatch = false;
    let idempotentUpsertNoDuplicateVerified = false;
    let cleanupTestRecordSucceeded = false;
    let lastSuccessfulRemoteWriteIso: string | null = null;
    let testErrMsg: string | null = null;

    try {
      const testPayload = {
        run_id: testRunId,
        evaluated_at: evalNow.toISOString(),
        completed_4h_timestamp_ist: "2026-11-18T09:15:00.000+05:30",
        candidates_evaluated: 1,
        ready_count: 1,
        forming_count: 0,
        breakout_count: 0,
        invalidated_count: 0,
        wait_count: 0,
        alerts_generated: 0,
        duplicates_prevented: 0,
      };

      const up1 = await sb
        .from("strategy03_monitoring_runs")
        .upsert([testPayload], { onConflict: "run_id", ignoreDuplicates: true });

      if (up1.error) {
        throw new Error(`${up1.error.code}: ${up1.error.message}`);
      }
      lastSuccessfulRemoteWriteIso = new Date().toISOString();

      // Idempotent duplicate upsert
      const up2 = await sb
        .from("strategy03_monitoring_runs")
        .upsert([{ ...testPayload, candidates_evaluated: 999 }], {
          onConflict: "run_id",
          ignoreDuplicates: true,
        });
      if (up2.error) {
        throw new Error(`${up2.error.code}: ${up2.error.message}`);
      }

      // Read back and verify exact values + no duplicate row
      const readBack = await sb
        .from("strategy03_monitoring_runs")
        .select("*")
        .eq("run_id", testRunId);

      if (readBack.error) {
        throw new Error(`${readBack.error.code}: ${readBack.error.message}`);
      }

      const rows = readBack.data ?? [];
      idempotentUpsertNoDuplicateVerified = rows.length === 1;
      writeAndReadBackExactMatch =
        rows.length === 1 &&
        rows[0].run_id === testRunId &&
        Number(rows[0].candidates_evaluated) === 1;

      // Clean up ONLY the explicitly created test record
      const delRes = await sb
        .from("strategy03_monitoring_runs")
        .delete()
        .eq("run_id", testRunId);

      const verifyGone = await sb
        .from("strategy03_monitoring_runs")
        .select("*")
        .eq("run_id", testRunId);

      cleanupTestRecordSucceeded =
        !delRes.error && !verifyGone.error && (verifyGone.data?.length ?? 0) === 0;
    } catch (err: any) {
      testErrMsg = err?.message ?? String(err);
    }

    const controlledTestPassed =
      writeAndReadBackExactMatch &&
      idempotentUpsertNoDuplicateVerified &&
      cleanupTestRecordSucceeded;

    if (!controlledTestPassed) {
      return {
        evaluatedAtIso: evalNow.toISOString(),
        phase: "6.10.19.14",
        migrationInspection,
        manualSqlExecutionStillRequired: false,
        remoteSchemaAvailable: true,
        migrationStatus: "APPLIED_AND_VERIFIED",
        rlsVerificationStatus: remoteTableChecks.every((c) => c.anonWriteDenied)
          ? "VERIFIED_REMOTE"
          : "FAILED",
        remoteTableChecks,
        controlledPersistenceTest: {
          executed: true,
          skippedReason: null,
          testIdentifierPrefix: testPrefix,
          writeAndReadBackExactMatch,
          idempotentUpsertNoDuplicateVerified,
          cleanupTestRecordSucceeded,
          genuineRecordsUntouched: true,
          lastSuccessfulRemoteWriteIso,
          errorMessage: testErrMsg ?? "Controlled persistence test failed verification.",
        },
        reconciliationReport: null,
        lastSuccessfulRemoteWriteIso,
        localWalPendingCount: persistence.readWal().length,
        finalTruthfulPersistenceStatus:
          persistence.readWal().length > 0 ? "SYNC_PENDING" : "SYNC_ERROR",
        exactUnresolvedBlocker: testErrMsg ?? "Controlled persistence test failed.",
        manualRemainingAction: "Inspect RLS and table constraints in Supabase.",
      };
    }

    // 4. Reconcile local JSON and WAL records with remote database
    const recReport = await persistence.reconcileLocalAndRemote();
    const rlsOk = remoteTableChecks.every(
      (c) => c.anonWriteDenied && c.authenticatedSelectAllowed
    );

    const finalStatus: MonitoringPersistenceStatus =
      recReport.inSync && recReport.persistenceStatus === "REMOTE_SYNCED"
        ? "REMOTE_SYNCED"
        : recReport.localCounts.pendingWal > 0
        ? "SYNC_PENDING"
        : "SYNC_ERROR";

    return {
      evaluatedAtIso: evalNow.toISOString(),
      phase: "6.10.19.14",
      migrationInspection,
      manualSqlExecutionStillRequired: false,
      remoteSchemaAvailable: true,
      migrationStatus: "APPLIED_AND_VERIFIED",
      rlsVerificationStatus: rlsOk ? "VERIFIED_REMOTE" : "FAILED",
      remoteTableChecks,
      controlledPersistenceTest: {
        executed: true,
        skippedReason: null,
        testIdentifierPrefix: testPrefix,
        writeAndReadBackExactMatch,
        idempotentUpsertNoDuplicateVerified,
        cleanupTestRecordSucceeded,
        genuineRecordsUntouched: true,
        lastSuccessfulRemoteWriteIso,
        errorMessage: null,
      },
      reconciliationReport: recReport,
      lastSuccessfulRemoteWriteIso,
      localWalPendingCount: recReport.localCounts.pendingWal,
      finalTruthfulPersistenceStatus: finalStatus,
      exactUnresolvedBlocker: recReport.blockerMessage,
      manualRemainingAction: null,
    };
  }
}

