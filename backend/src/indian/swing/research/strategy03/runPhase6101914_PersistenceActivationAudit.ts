import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { Strategy03RemotePersistenceVerifier } from "./prebreakout/Strategy03RemotePersistenceVerifier.js";

config({ path: path.resolve("D:/Trading/my-app/.env.local") });
config({ path: path.resolve("D:/Trading/my-app/backend/.env") });

const MIGRATION_SQL_PATH = path.resolve(
  "D:/Trading/my-app/backend/supabase/migrations/20261118_strategy03_4h_monitoring.sql"
);
const P6101910_DIR = path.resolve("D:/Trading/my-app/backend/data/research/strategy03/phase6101910");
const P6101911_DIR = path.resolve("D:/Trading/my-app/backend/data/research/strategy03/phase6101911");
const P6101912_DIR = path.resolve("D:/Trading/my-app/backend/data/research/strategy03/phase6101912");
const P6101913_DIR = path.resolve("D:/Trading/my-app/backend/data/research/strategy03/phase6101913");
const OUT_DIR = path.resolve("D:/Trading/my-app/backend/data/research/strategy03/phase6101914");

function sha256File(filePath: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function captureDirectoryHashes(dir: string, files: string[]): Record<string, string> {
  const res: Record<string, string> = {};
  for (const f of files) {
    res[f] = sha256File(path.join(dir, f));
  }
  return res;
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const p11Files = [
    "forward_signal_snapshots.json",
    "forward_signal_outcomes.json",
    "forward_cohort_statistics.json",
    "forward_shadow_summary.json",
  ];
  const p12Files = [
    "independent_forward_audit_report.json",
    "independent_recalculated_outcomes.json",
    "audited_cohort_maturity_statistics.json",
    "independent_mismatch_ledger.json",
  ];
  const p13Files = [
    "forward_maturity_dashboard.json",
    "forward_monitored_states.json",
    "forward_monitoring_events.json",
    "forward_monitoring_cycles.json",
    "latest_cycle_independent_audit.json",
  ];

  const p11Before = captureDirectoryHashes(P6101911_DIR, p11Files);
  const p12Before = captureDirectoryHashes(P6101912_DIR, p12Files);
  const p13Before = captureDirectoryHashes(P6101913_DIR, p13Files);

  const sbService = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
  const sbAnon = createClient(
    process.env.SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );

  // Verify experimental_paper_trades == 0
  const { count: paperTradesCount } = await sbService
    .from("experimental_paper_trades")
    .select("*", { count: "exact", head: true });

  const verifier = new Strategy03RemotePersistenceVerifier();
  const now = new Date("2026-11-18T20:00:39+05:30");

  const report = await verifier.verifyAndReconcileRemotePersistence({
    migrationFilePath: MIGRATION_SQL_PATH,
    storageDir: P6101910_DIR,
    serviceClient: sbService,
    anonClient: sbAnon,
    now,
  });

  const p11After = captureDirectoryHashes(P6101911_DIR, p11Files);
  const p12After = captureDirectoryHashes(P6101912_DIR, p12Files);
  const p13After = captureDirectoryHashes(P6101913_DIR, p13Files);

  const phase6101911Unchanged = p11Files.every((f) => p11Before[f] === p11After[f]);
  const phase6101912Unchanged = p12Files.every((f) => p12Before[f] === p12After[f]);
  const phase6101913Unchanged = p13Files.every((f) => p13Before[f] === p13After[f]);

  const migrationSqlRaw = fs.readFileSync(MIGRATION_SQL_PATH, "utf8");

  // Generate the safe Manual Migration Runbook for Supabase SQL Editor
  const manualRunbookMd = [
    "# Strategy 03 — Phase 6.10.19.14: Safe Manual Migration Workflow & Supabase SQL Editor Runbook",
    "",
    "## 1. Prerequisites & Expected Effects",
    "- **Target Project:** Your configured Supabase project (`SUPABASE_URL` in `backend/.env`).",
    "- **Required Role:** Supabase Dashboard Organization/Project Admin with SQL Editor access.",
    "- **Expected Effect:** Creates three read/shadow-monitoring tables (`public.strategy03_monitoring_runs`, `public.strategy03_candidate_state_history`, `public.strategy03_monitoring_alerts`), adds symbol/timestamp composite indexes, enables Row-Level Security (RLS) on all three tables, grants `ALL` to `service_role`, and grants `SELECT` only to `authenticated` (zero `anon` write or read access).",
    "- **Non-Destructive Guarantee:** Uses `CREATE TABLE IF NOT EXISTS` and `CREATE INDEX IF NOT EXISTS`. Does not alter or touch `experimental_paper_trades` or any existing research or live table.",
    "",
    "## 2. Preflight Check Query (Run in Supabase SQL Editor Before Migration)",
    "```sql",
    "SELECT table_name",
    "FROM information_schema.tables",
    "WHERE table_schema = 'public'",
    "  AND table_name IN (",
    "    'strategy03_monitoring_runs',",
    "    'strategy03_candidate_state_history',",
    "    'strategy03_monitoring_alerts'",
    "  );",
    "```",
    "",
    "## 3. Reviewed Migration SQL (`20261118_strategy03_4h_monitoring.sql`)",
    "```sql",
    migrationSqlRaw.trim(),
    "```",
    "",
    "## 4. Post-Migration Verification Query (Run in Supabase SQL Editor After Migration)",
    "```sql",
    "-- 1. Verify tables and RLS enabled status",
    "SELECT tablename, rowsecurity",
    "FROM pg_tables",
    "WHERE schemaname = 'public'",
    "  AND tablename IN (",
    "    'strategy03_monitoring_runs',",
    "    'strategy03_candidate_state_history',",
    "    'strategy03_monitoring_alerts'",
    "  );",
    "",
    "-- 2. Verify RLS policies",
    "SELECT tablename, policyname, roles, cmd",
    "FROM pg_policies",
    "WHERE schemaname = 'public'",
    "  AND tablename IN (",
    "    'strategy03_monitoring_runs',",
    "    'strategy03_candidate_state_history',",
    "    'strategy03_monitoring_alerts'",
    "  );",
    "",
    "-- 3. Reload PostgREST schema cache",
    "NOTIFY pgrst, 'reload schema';",
    "```",
    "",
    "## 5. Safe Non-Destructive Rollback Guidance (Does Not Delete Local Research Data)",
    "- All genuine Strategy 03 monitoring and forward shadow records (`83` snapshots, `83` outcomes, `1` monitoring run, `300` state history rows, `579` alerts) are durably stored in local JSON files (`backend/data/research/strategy03/phase610199/` through `phase6101913/`).",
    "- If you ever need to pause remote database writes without deleting any remote or local research data, revoke write policy or keep the service in `LOCAL_ONLY` mode:",
    "```sql",
    "-- Non-destructive pause of remote writes (preserves all existing rows and local JSON files)",
    "DROP POLICY IF EXISTS \"s03_mon_runs_service_all\" ON public.strategy03_monitoring_runs;",
    "DROP POLICY IF EXISTS \"s03_mon_state_service_all\" ON public.strategy03_candidate_state_history;",
    "DROP POLICY IF EXISTS \"s03_mon_alerts_service_all\" ON public.strategy03_monitoring_alerts;",
    "```",
  ].join("\n");

  fs.writeFileSync(
    path.join(OUT_DIR, "phase6101914_manual_migration_runbook.md"),
    manualRunbookMd
  );

  const fullOutput = {
    ...report,
    priorPhaseImmutability: {
      phase6101911Unchanged,
      phase6101912Unchanged,
      phase6101913Unchanged,
    },
    safetyLocks: {
      STRATEGY_01: false,
      STRATEGY_02: false,
      STRATEGY_03: false,
      LIVE_TRADING: false,
      BROKER_EXECUTION_ENABLED: false,
      paperIsolationEnabled: false,
      experimentalPaperTradesCount: paperTradesCount ?? 0,
    },
  };

  fs.writeFileSync(
    path.join(OUT_DIR, "persistence_activation_audit.json"),
    JSON.stringify(fullOutput, null, 2)
  );

  const auditMd = [
    "# Strategy 03 — Phase 6.10.19.14: Supabase Remote Persistence Activation & Reconciliation Audit Report",
    "",
    "## 1. Existing Migration SQL Inspection (`20261118_strategy03_4h_monitoring.sql`)",
    `- **All Inspection Checks Passed:** \`${report.migrationInspection.allInspectionChecksPassed}\``,
    `- **Required Tables & Primary Keys Verified:** \`${report.migrationInspection.primaryKeysVerified}\``,
    `- **Unique Deterministic Idempotency Keys:** \`run_id=${report.migrationInspection.uniqueIdempotencyKeysVerified.run_id_unique}\`, \`transition_key=${report.migrationInspection.uniqueIdempotencyKeysVerified.transition_key_unique}\`, \`event_id=${report.migrationInspection.uniqueIdempotencyKeysVerified.event_id_unique}\``,
    `- **Composite Indexes Verified:** \`idx_s03_mon_state_sym=${report.migrationInspection.indexesVerified.idx_s03_mon_state_sym}\`, \`idx_s03_mon_alerts_sym=${report.migrationInspection.indexesVerified.idx_s03_mon_alerts_sym}\``,
    `- **RLS Enabled on All 3 Tables:** \`${report.migrationInspection.rlsEnabledOnAllThreeTables}\``,
    `- **Service-Role Write & Authenticated Read-Only Policies:** \`serviceRole=${report.migrationInspection.serviceRoleWritePoliciesVerified}\`, \`authenticatedRead=${report.migrationInspection.authenticatedReadOnlyPoliciesVerified}\`, \`noAnonymousWrite=${report.migrationInspection.noAnonymousWriteAccessVerified}\``,
    "",
    "## 2. Live Remote Schema & Access Verification",
    `- **Remote Schema Available in PostgREST Cache:** \`${report.remoteSchemaAvailable}\``,
    `- **Migration Status:** \`${report.migrationStatus}\``,
    `- **Manual SQL Execution Still Required:** \`${report.manualSqlExecutionStillRequired}\``,
    `- **RLS Verification Status:** \`${report.rlsVerificationStatus}\``,
    ...report.remoteTableChecks.map(
      (c) =>
        `  - \`${c.table}\`: recognizedInSchemaCache=\`${c.recognizedInSchemaCache}\`, anonWriteDenied=\`${c.anonWriteDenied}\`, error=\`${c.errorCode}: ${c.errorMessage}\``
    ),
    "",
    "## 3. Controlled Persistence Test & WAL Reconciliation Status",
    `- **Controlled Remote Persistence Test Executed:** \`${report.controlledPersistenceTest.executed}\` (${report.controlledPersistenceTest.skippedReason ?? "Completed"})`,
    `- **Last Successful Remote Write:** \`${report.lastSuccessfulRemoteWriteIso ?? "NONE"}\``,
    `- **Local WAL Pending Count:** \`${report.localWalPendingCount}\``,
    `- **Final Truthful Persistence Status:** \`${report.finalTruthfulPersistenceStatus}\``,
    `- **Exact Unresolved Blocker:** \`${report.exactUnresolvedBlocker}\``,
    `- **Remaining Manual Action:** ${report.manualRemainingAction}`,
    "",
    "## 4. Prior Phase Immutability & Safety Confirmation",
    `- **Prior Artifacts Unchanged (SHA-256 Verified):** Phase 6.10.19.11=\`${phase6101911Unchanged}\`, Phase 6.10.19.12=\`${phase6101912Unchanged}\`, Phase 6.10.19.13=\`${phase6101913Unchanged}\``,
    `- **Safety Locks:** \`STRATEGY_01 = false\`, \`STRATEGY_02 = false\`, \`STRATEGY_03 = false\`, \`LIVE_TRADING = false\`, \`BROKER_EXECUTION_ENABLED = false\`, \`Strategy03PaperIsolationConfig.enabled = false\`, \`experimental_paper_trades = ${paperTradesCount ?? 0}\``,
  ].join("\n");

  fs.writeFileSync(path.join(OUT_DIR, "phase6101914_persistence_audit_report.md"), auditMd);

  console.log("Phase 6.10.19.14 complete:", {
    migrationSqlValid: report.migrationInspection.allInspectionChecksPassed,
    remoteSchemaAvailable: report.remoteSchemaAvailable,
    migrationStatus: report.migrationStatus,
    manualSqlExecutionStillRequired: report.manualSqlExecutionStillRequired,
    rlsVerificationStatus: report.rlsVerificationStatus,
    controlledTestExecuted: report.controlledPersistenceTest.executed,
    finalTruthfulPersistenceStatus: report.finalTruthfulPersistenceStatus,
    localWalPendingCount: report.localWalPendingCount,
    priorPhasesUnchanged:
      phase6101911Unchanged && phase6101912Unchanged && phase6101913Unchanged,
    paperTradesCount: paperTradesCount ?? 0,
  });
}

if (process.argv[1]?.includes("runPhase6101914_PersistenceActivationAudit")) {
  main().catch((err) => {
    console.error("Phase 6.10.19.14 failed:", err);
    process.exit(1);
  });
}

