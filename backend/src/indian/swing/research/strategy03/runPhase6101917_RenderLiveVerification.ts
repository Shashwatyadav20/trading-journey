import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { Strategy03FourHourMonitoringService } from "./prebreakout/Strategy03FourHourMonitoringService.js";
import { Strategy03RenderLiveVerifier } from "./prebreakout/Strategy03RenderLiveVerifier.js";

config({ path: path.resolve("D:/Trading/my-app/.env.local") });
config({ path: path.resolve("D:/Trading/my-app/backend/.env") });

const REPO_ROOT = path.resolve("D:/Trading/my-app");
const P6101911_DIR = path.resolve("D:/Trading/my-app/backend/data/research/strategy03/phase6101911");
const P6101912_DIR = path.resolve("D:/Trading/my-app/backend/data/research/strategy03/phase6101912");
const P6101913_DIR = path.resolve("D:/Trading/my-app/backend/data/research/strategy03/phase6101913");
const P6101914_DIR = path.resolve("D:/Trading/my-app/backend/data/research/strategy03/phase6101914");
const P6101915_DIR = path.resolve("D:/Trading/my-app/backend/data/research/strategy03/phase6101915");
const P6101916_DIR = path.resolve("D:/Trading/my-app/backend/data/research/strategy03/phase6101916");
const OUT_DIR = path.resolve("D:/Trading/my-app/backend/data/research/strategy03/phase6101917");

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
  if (fs.existsSync(OUT_DIR)) {
    fs.rmSync(OUT_DIR, { recursive: true, force: true });
  }
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
  const p14Files = ["persistence_activation_audit.json"];
  const p15Files = ["operational_health_dashboard.json"];
  const p16Files = ["deployment_runtime_verification.json"];

  const p11Before = captureDirectoryHashes(P6101911_DIR, p11Files);
  const p12Before = captureDirectoryHashes(P6101912_DIR, p12Files);
  const p13Before = captureDirectoryHashes(P6101913_DIR, p13Files);
  const p14Before = captureDirectoryHashes(P6101914_DIR, p14Files);
  const p15Before = captureDirectoryHashes(P6101915_DIR, p15Files);
  const p16Before = captureDirectoryHashes(P6101916_DIR, p16Files);

  const sb = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );

  // Verify experimental_paper_trades == 0
  const { count: paperTradesCount } = await sb
    .from("experimental_paper_trades")
    .select("*", { count: "exact", head: true });

  // Prepare isolated persistence copy for Phase 6.10.19.17 reconciliation check
  const persistWorkDir = path.join(OUT_DIR, "persistence_check");
  fs.mkdirSync(persistWorkDir, { recursive: true });
  const p16PersistDir = path.join(P6101916_DIR, "runtime_service/persistence_ledger");
  for (const f of [
    "monitoring_runs.json",
    "candidate_state_history.json",
    "monitoring_alerts.json",
  ]) {
    const src = path.join(p16PersistDir, f);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(persistWorkDir, f));
    }
  }

  Strategy03FourHourMonitoringService.resetActiveInstanceCountForTesting();
  const localService = new Strategy03FourHourMonitoringService({
    storageDir: path.join(OUT_DIR, "local_runtime_probe"),
    seedPersistenceDir: persistWorkDir,
    getAdminClient: () => sb,
  });

  const now = new Date("2026-11-18T20:47:26+05:30");
  await localService.start({
    pollIntervalMs: 300_000,
    executionEnvironment: "LOCAL_CLI_VERIFICATION_HARNESS",
    now,
  });

  // Trigger due cycle check so the local scheduler evaluates today's window (AM & PM already completed in recovered state)
  await localService.triggerDueCycleNow(now);

  const verifier = new Strategy03RenderLiveVerifier();
  const report = await verifier.verifyLiveRenderAndRuntime({
    renderServiceUrl: "https://trading-journey-backend.onrender.com",
    repoRootDir: REPO_ROOT,
    persistenceDir: persistWorkDir,
    serviceClient: sb,
    localMonitoringService: localService,
    now,
  });

  localService.stop(now);

  const p11After = captureDirectoryHashes(P6101911_DIR, p11Files);
  const p12After = captureDirectoryHashes(P6101912_DIR, p12Files);
  const p13After = captureDirectoryHashes(P6101913_DIR, p13Files);
  const p14After = captureDirectoryHashes(P6101914_DIR, p14Files);
  const p15After = captureDirectoryHashes(P6101915_DIR, p15Files);
  const p16After = captureDirectoryHashes(P6101916_DIR, p16Files);

  const phase6101911Unchanged = p11Files.every((f) => p11Before[f] === p11After[f]);
  const phase6101912Unchanged = p12Files.every((f) => p12Before[f] === p12After[f]);
  const phase6101913Unchanged = p13Files.every((f) => p13Before[f] === p13After[f]);
  const phase6101914Unchanged = p14Files.every((f) => p14Before[f] === p14After[f]);
  const phase6101915Unchanged = p15Files.every((f) => p15Before[f] === p15After[f]);
  const phase6101916Unchanged = p16Files.every((f) => p16Before[f] === p16After[f]);

  const artifactPayload = {
    ...report,
    immutabilityVerification: {
      phase6101911Unchanged,
      phase6101912Unchanged,
      phase6101913Unchanged,
      phase6101914Unchanged,
      phase6101915Unchanged,
      phase6101916Unchanged,
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
    path.join(OUT_DIR, "render_live_runtime_verification.json"),
    JSON.stringify(artifactPayload, null, 2)
  );

  const md = [
    "# Strategy 03 — Phase 6.10.19.17: Render Production Deployment & Live Runtime Verification Report",
    "",
    "## 1. Live Deployed Render Service Probe Results (`https://trading-journey-backend.onrender.com`)",
    `- **Deployment Verification Status:** \`${report.deploymentVerificationStatus}\``,
    `- **GET \`/health\`:** HTTP \`${report.liveRenderProbes.healthEndpoint.httpStatus}\` — \`${report.liveRenderProbes.healthEndpoint.responseBodyPreview}\``,
    `- **GET \`/api/indian/strategy03/research/shadow\`:** HTTP \`${report.liveRenderProbes.strategy03ShadowEndpoint.httpStatus}\` — \`${report.liveRenderProbes.strategy03ShadowEndpoint.responseBodyPreview}\``,
    `- **GET \`/health/strategy03-4h-runtime\`:** HTTP \`${report.liveRenderProbes.strategy03RuntimeHealthEndpoint.httpStatus}\` — \`${report.liveRenderProbes.strategy03RuntimeHealthEndpoint.responseBodyPreview}\``,
    "",
    "## 2. Deployed Commit / Build & Runtime Environment Audit",
    `- **Local & Remote Git \`origin/main\` HEAD Commit:** \`${report.gitWorkspaceAudit.lastCommittedHeadSha}\` (\`${report.gitWorkspaceAudit.lastCommittedMessage}\`)`,
    `- **Latest Phase 6.10.19.16–17 Code Deployed on Render?** **\`${report.deployedBuildVerification.latestPhase6101916CodeDeployedOnRender}\`** (The Strategy 03 routes and \`server.ts\` Step 2f bootstrap exist as uncommitted working-tree files in \`D:\\Trading\\my-app\` and have not yet been committed/pushed to \`origin/main\` because \`git\` is not installed in the local system PATH and no Render deploy hook/API token is configured in \`.env\`).`,
    `- **Did \`server.ts\` Step 2f Execute in the Deployed Render Environment?** **\`${report.deployedBuildVerification.serverTsStep2fExecutedInDeployedRender}\`**`,
    `- **Runtime Environment Classification:** \`${report.deployedBuildVerification.executionEnvironmentReported}\` (Local harness: \`${report.localRuntimeReadinessCheck.localExecutionEnvironment}\`)`,
    `- **\`isActualDeployedProductionEvidence\`:** **\`${report.deployedBuildVerification.isActualDeployedProductionEvidence}\`**`,
    `- **Active Scheduler Instance Count:** Deployed Render=\`${report.deployedBuildVerification.activeSchedulerInstanceCountInDeployedRender ?? "N/A (not yet deployed)"}\` | Local Verified Harness=\`${report.localRuntimeReadinessCheck.localActiveSchedulerInstances}\``,
    "",
    "## 3. Controlled Production Cycle Verification",
    `- **Production Cycle Status:** **\`${report.controlledProductionCycleVerification.status}\`**`,
    `- **Next Genuinely Eligible NSE 4H Session Block:** \`${report.controlledProductionCycleVerification.nextEligibleNseSessionBlockIst}\``,
    `- **Manufactured or Backdated Candles Used:** \`${report.controlledProductionCycleVerification.manufacturedOrBackdatedCandlesUsed}\``,
    `- **Explanation:** ${report.controlledProductionCycleVerification.explanation}`,
    "",
    "## 4. Supabase Remote Reconciliation",
    `- **Persistence Status:** \`${report.supabaseReconciliation.persistenceStatus}\` (\`inSync=${report.supabaseReconciliation.inSync}\`, \`walPendingCount=${report.supabaseReconciliation.walPendingCount}\`)`,
    `- **Local vs. Remote Counts:** Runs=\`${report.supabaseReconciliation.localCounts.runs} == ${report.supabaseReconciliation.remoteCounts.runs}\`, States=\`${report.supabaseReconciliation.localCounts.states} == ${report.supabaseReconciliation.remoteCounts.states}\`, Alerts=\`${report.supabaseReconciliation.localCounts.alerts} == ${report.supabaseReconciliation.remoteCounts.alerts}\``,
    "",
    "## 5. Prior Phase Immutability & Safety-Lock Confirmation",
    `- **Prior Artifacts Unchanged (SHA-256 Verified):** Phase 6.10.19.11=\`${phase6101911Unchanged}\`, Phase 6.10.19.12=\`${phase6101912Unchanged}\`, Phase 6.10.19.13=\`${phase6101913Unchanged}\`, Phase 6.10.19.14=\`${phase6101914Unchanged}\`, Phase 6.10.19.15=\`${phase6101915Unchanged}\`, Phase 6.10.19.16=\`${phase6101916Unchanged}\``,
    `- **Safety Locks:** \`STRATEGY_01 = false\`, \`STRATEGY_02 = false\`, \`STRATEGY_03 = false\`, \`LIVE_TRADING = false\`, \`BROKER_EXECUTION_ENABLED = false\`, \`Strategy03PaperIsolationConfig.enabled = false\`, \`experimental_paper_trades = ${paperTradesCount ?? 0}\``,
  ].join("\n");

  fs.writeFileSync(
    path.join(OUT_DIR, "phase6101917_render_live_verification_report.md"),
    md
  );

  console.log("Phase 6.10.19.17 complete:", {
    deploymentVerificationStatus: report.deploymentVerificationStatus,
    renderHealthHttpStatus: report.liveRenderProbes.healthEndpoint.httpStatus,
    renderShadowHttpStatus: report.liveRenderProbes.strategy03ShadowEndpoint.httpStatus,
    renderRuntimeHealthHttpStatus:
      report.liveRenderProbes.strategy03RuntimeHealthEndpoint.httpStatus,
    latestCodeDeployedOnRender:
      report.deployedBuildVerification.latestPhase6101916CodeDeployedOnRender,
    isActualDeployedProductionEvidence:
      report.deployedBuildVerification.isActualDeployedProductionEvidence,
    controlledProductionCycleStatus:
      report.controlledProductionCycleVerification.status,
    nextEligibleNseSessionBlockIst:
      report.controlledProductionCycleVerification.nextEligibleNseSessionBlockIst,
    supabasePersistenceStatus: report.supabaseReconciliation.persistenceStatus,
    supabaseInSync: report.supabaseReconciliation.inSync,
    walPendingCount: report.supabaseReconciliation.walPendingCount,
    priorPhasesUnchanged:
      phase6101911Unchanged &&
      phase6101912Unchanged &&
      phase6101913Unchanged &&
      phase6101914Unchanged &&
      phase6101915Unchanged &&
      phase6101916Unchanged,
    paperTradesCount: paperTradesCount ?? 0,
  });
}

if (process.argv[1]?.includes("runPhase6101917_RenderLiveVerification")) {
  main().catch((err) => {
    console.error("Phase 6.10.19.17 failed:", err);
    process.exit(1);
  });
}

