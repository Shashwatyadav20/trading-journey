import fs from "node:fs";
import path from "node:path";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { Strategy03FourHourMonitoringPersistence } from "./prebreakout/Strategy03FourHourMonitoringPersistence.js";
import { sha256FileHex } from "./prebreakout/Strategy03ForwardMaturityAudit.js";
import { Strategy03RenderLiveVerifier } from "./prebreakout/Strategy03RenderLiveVerifier.js";
import {
  DEFAULT_STRATEGY03_PAPER_ISOLATION_CONFIG,
  validateStrategy03IsolationGuard,
} from "./Strategy03PaperIsolationConfig.js";

config({ path: path.resolve("D:/Trading/my-app/.env.local") });
config({ path: path.resolve("D:/Trading/my-app/backend/.env") });

const BASE_DIR = path.resolve("D:/Trading/my-app/backend/data/research/strategy03");
const OUT_DIR = path.join(BASE_DIR, "phase61019191");

const PRIOR_ARTIFACTS: Array<{ key: string; filePath: string }> = [
  { key: "p11_snapshots", filePath: path.join(BASE_DIR, "phase6101911/forward_signal_snapshots.json") },
  { key: "p11_outcomes", filePath: path.join(BASE_DIR, "phase6101911/forward_signal_outcomes.json") },
  { key: "p11_stats", filePath: path.join(BASE_DIR, "phase6101911/forward_cohort_statistics.json") },
  { key: "p12_audit", filePath: path.join(BASE_DIR, "phase6101912/independent_forward_audit_report.json") },
  { key: "p13_dashboard", filePath: path.join(BASE_DIR, "phase6101913/forward_maturity_dashboard.json") },
  { key: "p14_persistence", filePath: path.join(BASE_DIR, "phase6101914/persistence_activation_audit.json") },
  { key: "p15_operations", filePath: path.join(BASE_DIR, "phase6101915/operational_health_dashboard.json") },
  { key: "p16_deployment", filePath: path.join(BASE_DIR, "phase6101916/deployment_runtime_verification.json") },
  { key: "p17_render", filePath: path.join(BASE_DIR, "phase6101917/render_live_runtime_verification.json") },
  { key: "p18_maturity", filePath: path.join(BASE_DIR, "phase6101918/phase6101918_forward_maturity_audit.json") },
  { key: "p19_validation", filePath: path.join(BASE_DIR, "phase6101919/phase6101919_statistical_validation.json") },
];

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const checksums: Record<string, string> = {};
  for (const item of PRIOR_ARTIFACTS) {
    checksums[item.key] = sha256FileHex(item.filePath);
  }

  // Verify local code integration points
  const healthTs = fs.readFileSync(
    path.resolve("D:/Trading/my-app/backend/src/routes/health.ts"),
    "utf8"
  );
  const serverTs = fs.readFileSync(
    path.resolve("D:/Trading/my-app/backend/src/server.ts"),
    "utf8"
  );
  const serviceTs = fs.readFileSync(
    path.resolve(
      "D:/Trading/my-app/backend/src/indian/swing/research/strategy03/prebreakout/Strategy03FourHourMonitoringService.ts"
    ),
    "utf8"
  );
  const schedulerTs = fs.readFileSync(
    path.resolve(
      "D:/Trading/my-app/backend/src/indian/swing/research/strategy03/prebreakout/Strategy03FourHourMonitoringScheduler.ts"
    ),
    "utf8"
  );
  const pkgJson = JSON.parse(
    fs.readFileSync(path.resolve("D:/Trading/my-app/backend/package.json"), "utf8")
  );

  const localChecks = {
    runtimeHealthEndpointExistsLocally: healthTs.includes("/health/strategy03-4h-runtime"),
    serverStep2fBootstrapExists: serverTs.includes("strategy03FourHourMonitoringService.start"),
    serverGracefulShutdownExists: serverTs.includes("strategy03FourHourMonitoringService.stop"),
    schedulerUsesRealCandleLoader:
      serviceTs.includes("load4hCacheForSymbol") &&
      schedulerTs.includes("loadCandlesBySymbol: loader"),
    duplicateSchedulerGuardInService: serviceTs.includes(
      "if (this.running && this.scheduler !== null)"
    ),
    duplicateSchedulerGuardInScheduler: schedulerTs.includes(
      "if (this.timerHandle !== null)"
    ),
    renderBuildScript: pkgJson.scripts?.build,
    renderStartScript: pkgJson.scripts?.start,
    renderMainEntry: pkgJson.main,
  };

  // Probe live Render endpoints
  const verifier = new Strategy03RenderLiveVerifier();
  const healthProbe = await verifier.probeUrl(
    "https://trading-journey-backend.onrender.com/health"
  );
  const runtimeProbe = await verifier.probeUrl(
    "https://trading-journey-backend.onrender.com/health/strategy03-4h-runtime"
  );

  const isDeployedAndVerified =
    runtimeProbe.httpStatus === 200 &&
    runtimeProbe.parsedJson?.runtimeHealth?.executionEnvironment ===
      "DEPLOYED_PRODUCTION_RUNTIME" &&
    runtimeProbe.parsedJson?.runtimeHealth?.isActualDeployedProductionEvidence === true &&
    runtimeProbe.parsedJson?.runtimeHealth?.activeSchedulerInstanceCount === 1;

  // Verify Supabase reconciliation
  const sb = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
  const { count: paperTradesCount } = await sb
    .from("experimental_paper_trades")
    .select("*", { count: "exact", head: true });

  const persistWorkDir = path.join(OUT_DIR, "persistence_check");
  fs.mkdirSync(persistWorkDir, { recursive: true });
  const p16PersistDir = path.join(BASE_DIR, "phase6101916/runtime_service/persistence_ledger");
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
  const monPersistence = new Strategy03FourHourMonitoringPersistence(
    persistWorkDir,
    () => sb
  );
  const recReport = await monPersistence.reconcileLocalAndRemote();

  validateStrategy03IsolationGuard(DEFAULT_STRATEGY03_PAPER_ISOLATION_CONFIG, {
    STRATEGY_01: false,
    STRATEGY_02: false,
    STRATEGY_03: false,
    LIVE_TRADING: false,
    BROKER_EXECUTION_ENABLED: false,
  });

  const payload = {
    auditedAtIso: new Date().toISOString(),
    phase: "6.10.19.19.1",
    deploymentStatus: isDeployedAndVerified
      ? "DEPLOYED_AND_VERIFIED"
      : "READY_LOCAL_PENDING_GIT_COMMIT_AND_RENDER_DEPLOY",
    localChecks,
    liveRenderProbes: {
      healthHttpStatus: healthProbe.httpStatus,
      runtimeHealthHttpStatus: runtimeProbe.httpStatus,
      isDeployedAndVerified,
    },
    supabaseReconciliation: recReport,
    priorPhaseSha256Checksums: checksums,
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
    path.join(OUT_DIR, "deployment_readiness_audit.json"),
    JSON.stringify(payload, null, 2)
  );

  console.log("Phase 6.10.19.19.1 audit complete:", {
    deploymentStatus: payload.deploymentStatus,
    localChecksAllTrue:
      localChecks.runtimeHealthEndpointExistsLocally &&
      localChecks.serverStep2fBootstrapExists &&
      localChecks.serverGracefulShutdownExists &&
      localChecks.schedulerUsesRealCandleLoader &&
      localChecks.duplicateSchedulerGuardInService &&
      localChecks.duplicateSchedulerGuardInScheduler,
    renderHealthHttpStatus: healthProbe.httpStatus,
    renderRuntimeHealthHttpStatus: runtimeProbe.httpStatus,
    supabasePersistenceStatus: recReport.persistenceStatus,
    supabaseInSync: recReport.inSync,
    walPendingCount: recReport.localCounts.pendingWal,
    hashedArtifactsCount: Object.keys(checksums).length,
    paperTradesCount: paperTradesCount ?? 0,
  });
}

main().catch((err) => {
  console.error("Phase 6.10.19.19.1 audit failed:", err);
  process.exit(1);
});

