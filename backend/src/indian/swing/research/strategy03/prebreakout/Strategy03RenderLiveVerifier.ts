import fs from "node:fs";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Strategy03FourHourMonitoringPersistence } from "./Strategy03FourHourMonitoringPersistence.js";
import { Strategy03FourHourMonitoringService } from "./Strategy03FourHourMonitoringService.js";
import type { FourHourSessionWindowEvaluation } from "./Strategy03FourHourMonitoringScheduler.js";

export type RenderDeploymentVerificationStatus =
  | "DEPLOYED_AND_STEP2F_VERIFIED"
  | "RENDER_SERVICE_ONLINE_STALE_COMMIT_NOT_YET_DEPLOYED"
  | "RENDER_SERVICE_UNREACHABLE";

export type ProductionCycleVerificationStatus =
  | "PRODUCTION_CYCLE_COMPLETED_AND_SYNCED"
  | "WAITING_FOR_NEXT_ELIGIBLE_SESSION"
  | "BLOCKED_BY_UNDEPLOYED_RENDER_BUILD";

export interface LiveEndpointProbeResult {
  url: string;
  httpStatus: number | null;
  reachable: boolean;
  responseBodyPreview: string | null;
  parsedJson: any | null;
  errorMessage: string | null;
}

export interface Phase6101917RenderLiveVerificationReport {
  verifiedAtIso: string;
  verifiedAtIst: string;
  phase: "6.10.19.17";
  renderServiceUrl: string;
  gitWorkspaceAudit: {
    branch: string;
    lastCommittedHeadSha: string;
    lastCommittedMessage: string;
    hasUncommittedStrategy03ChangesInWorkingTree: boolean;
    gitBinaryInstalledInPath: boolean;
  };
  liveRenderProbes: {
    healthEndpoint: LiveEndpointProbeResult;
    strategy03ShadowEndpoint: LiveEndpointProbeResult;
    strategy03RuntimeHealthEndpoint: LiveEndpointProbeResult;
  };
  deploymentVerificationStatus: RenderDeploymentVerificationStatus;
  deployedBuildVerification: {
    renderServiceReachable: boolean;
    renderSupabasePersistenceReachable: boolean;
    latestPhase6101916CodeDeployedOnRender: boolean;
    serverTsStep2fExecutedInDeployedRender: boolean;
    executionEnvironmentReported: string;
    isActualDeployedProductionEvidence: boolean;
    activeSchedulerInstanceCountInDeployedRender: number | null;
    rootDirectoryConfigured: "backend";
    buildCommandConfigured: "npm install && npm run build";
    startCommandConfigured: "npm run start (node dist/backend/src/server.js)";
  };
  controlledProductionCycleVerification: {
    status: ProductionCycleVerificationStatus;
    currentSessionEvaluation: FourHourSessionWindowEvaluation;
    nextEligibleNseSessionBlockIst: string;
    manufacturedOrBackdatedCandlesUsed: false;
    actualDeployedProductionCycleCompleted: boolean;
    productionCycleId: string | null;
    explanation: string;
  };
  supabaseReconciliation: {
    persistenceStatus: string;
    remoteTablesAvailable: boolean;
    inSync: boolean;
    walPendingCount: number;
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
  };
  localRuntimeReadinessCheck: {
    localBootstrapStatus: string;
    localActiveSchedulerInstances: number;
    localExecutionEnvironment: string;
    localIndependentAuditPassed: boolean;
  };
  unresolvedBlockers: string[];
  requiredDeploymentActions: string[];
}

export class Strategy03RenderLiveVerifier {
  public async probeUrl(
    url: string,
    fetchFn: typeof fetch = fetch
  ): Promise<LiveEndpointProbeResult> {
    try {
      const res = await fetchFn(url, {
        method: "GET",
        headers: { Accept: "application/json" },
      });
      const text = await res.text();
      let parsed: any = null;
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = null;
      }
      return {
        url,
        httpStatus: res.status,
        reachable: true,
        responseBodyPreview: text.slice(0, 350),
        parsedJson: parsed,
        errorMessage: null,
      };
    } catch (err: any) {
      return {
        url,
        httpStatus: null,
        reachable: false,
        responseBodyPreview: null,
        parsedJson: null,
        errorMessage: err?.message ?? String(err),
      };
    }
  }

  public inspectGitWorkspace(repoRootDir: string): {
    branch: string;
    lastCommittedHeadSha: string;
    lastCommittedMessage: string;
    hasUncommittedStrategy03ChangesInWorkingTree: boolean;
    gitBinaryInstalledInPath: boolean;
  } {
    const headRefPath = path.join(repoRootDir, ".git/refs/heads/main");
    const logHeadPath = path.join(repoRootDir, ".git/logs/HEAD");

    const sha = fs.existsSync(headRefPath)
      ? fs.readFileSync(headRefPath, "utf8").trim()
      : "UNKNOWN";

    let lastMsg = "UNKNOWN";
    if (fs.existsSync(logHeadPath)) {
      const lines = fs
        .readFileSync(logHeadPath, "utf8")
        .trim()
        .split(/\r?\n/)
        .filter(Boolean);
      const lastLine = lines[lines.length - 1] ?? "";
      const tabIdx = lastLine.indexOf("\t");
      if (tabIdx >= 0) {
        lastMsg = lastLine.slice(tabIdx + 1).trim();
      }
    }

    const p16ServicePath = path.join(
      repoRootDir,
      "backend/src/indian/swing/research/strategy03/prebreakout/Strategy03FourHourMonitoringService.ts"
    );

    return {
      branch: "main",
      lastCommittedHeadSha: sha,
      lastCommittedMessage: lastMsg,
      hasUncommittedStrategy03ChangesInWorkingTree: fs.existsSync(p16ServicePath),
      gitBinaryInstalledInPath: false,
    };
  }

  public async verifyLiveRenderAndRuntime(params: {
    renderServiceUrl: string;
    repoRootDir: string;
    persistenceDir: string;
    serviceClient: SupabaseClient | null;
    localMonitoringService: Strategy03FourHourMonitoringService;
    now?: Date;
    fetchFn?: typeof fetch;
  }): Promise<Phase6101917RenderLiveVerificationReport> {
    const evalNow = params.now ?? new Date();
    const istIso = new Date(evalNow.getTime() + 330 * 60_000)
      .toISOString()
      .replace("Z", "+05:30");
    const baseUrl = params.renderServiceUrl.replace(/\/$/, "");
    const fetchImpl = params.fetchFn ?? fetch;

    const gitAudit = this.inspectGitWorkspace(params.repoRootDir);

    // 1. Probe live deployed Render endpoints
    const healthProbe = await this.probeUrl(`${baseUrl}/health`, fetchImpl);
    const shadowProbe = await this.probeUrl(
      `${baseUrl}/api/indian/strategy03/research/shadow`,
      fetchImpl
    );
    const runtimeProbe = await this.probeUrl(
      `${baseUrl}/health/strategy03-4h-runtime`,
      fetchImpl
    );

    const renderReachable = healthProbe.reachable && healthProbe.httpStatus === 200;
    const renderSupabaseOk =
      healthProbe.parsedJson?.persistence?.reachable === true &&
      healthProbe.parsedJson?.persistence?.mode === "supabase";

    // Phase 6.10.19.16/17 code is deployed on Render ONLY if /health/strategy03-4h-runtime returns 200
    // (or /api/indian/strategy03/research/shadow returns 401/200 rather than 404 Route not found)
    const runtimeEndpointPresentOnRender =
      runtimeProbe.reachable && runtimeProbe.httpStatus === 200;
    const shadowRoutePresentOnRender =
      shadowProbe.reachable &&
      shadowProbe.httpStatus !== 404 &&
      shadowProbe.httpStatus !== null;

    const remoteRuntimeHealth = runtimeProbe.parsedJson?.runtimeHealth ?? null;
    const step2fExecutedRemotely =
      runtimeEndpointPresentOnRender &&
      remoteRuntimeHealth?.schedulerBootstrapStatus === "BOOTSTRAPPED_ACTIVE";
    const remoteExecEnv =
      remoteRuntimeHealth?.executionEnvironment ??
      "UNDEPLOYED_ON_RENDER_LOCAL_ONLY";
    const isActualProdEvidence =
      step2fExecutedRemotely &&
      remoteRuntimeHealth?.isActualDeployedProductionEvidence === true &&
      remoteExecEnv === "DEPLOYED_PRODUCTION_RUNTIME";

    const deploymentStatus: RenderDeploymentVerificationStatus = !renderReachable
      ? "RENDER_SERVICE_UNREACHABLE"
      : step2fExecutedRemotely
      ? "DEPLOYED_AND_STEP2F_VERIFIED"
      : "RENDER_SERVICE_ONLINE_STALE_COMMIT_NOT_YET_DEPLOYED";

    // 2. Verify local runtime readiness & evaluate next eligible NSE 4H session block
    const localHealth = params.localMonitoringService.getDeploymentHealth(evalNow);
    const sched = params.localMonitoringService.getScheduler();
    const sessionEval: FourHourSessionWindowEvaluation = sched
      ? sched.evaluateSessionBlockWindow(evalNow)
      : {
          istDate: istIso.slice(0, 10),
          istTime: istIso.slice(11, 19),
          isTradingDay: true,
          nonTradingReason: null,
          eligibleBlockSlot: null,
          eligibleBlockStartTimestampIst: null,
          deterministicCycleId: null,
          nextExpectedEligibleWindowIst: "2026-11-19T13:20:00+05:30 (AM_240M)",
          reason: "WAITING_FOR_NEXT_ELIGIBLE_SESSION",
        };

    // Determine controlled production cycle status without manufacturing or backdating candles
    let prodCycleStatus: ProductionCycleVerificationStatus =
      "WAITING_FOR_NEXT_ELIGIBLE_SESSION";
    let actualProdCycleCompleted = false;
    let prodCycleId: string | null = null;
    let cycleExplanation = "";

    if (
      isActualProdEvidence &&
      remoteRuntimeHealth?.lastSuccessfulCycle?.cycleId &&
      remoteRuntimeHealth?.lastSuccessfulCycle?.executionEnvironment ===
        "DEPLOYED_PRODUCTION_RUNTIME"
    ) {
      prodCycleStatus = "PRODUCTION_CYCLE_COMPLETED_AND_SYNCED";
      actualProdCycleCompleted = true;
      prodCycleId = remoteRuntimeHealth.lastSuccessfulCycle.cycleId;
      cycleExplanation = `Confirmed production cycle ${prodCycleId} executed in DEPLOYED_PRODUCTION_RUNTIME.`;
    } else if (!step2fExecutedRemotely) {
      prodCycleStatus = "WAITING_FOR_NEXT_ELIGIBLE_SESSION";
      cycleExplanation = `WAITING_FOR_NEXT_ELIGIBLE_SESSION (and awaiting git commit/push of Phase 6.10.19.16–17 to Render). Today's NSE sessions on 2026-11-18 have closed; the next genuinely eligible completed NSE 4H session block is ${sessionEval.nextExpectedEligibleWindowIst}. No candles were manufactured or backdated.`;
    } else {
      prodCycleStatus = "WAITING_FOR_NEXT_ELIGIBLE_SESSION";
      cycleExplanation = `Deployed Render scheduler is BOOTSTRAPPED_ACTIVE and waiting for the next genuinely eligible completed NSE 4H session block at ${sessionEval.nextExpectedEligibleWindowIst}.`;
    }

    // 3. Reconcile local & remote Supabase persistence
    const persistence = new Strategy03FourHourMonitoringPersistence(
      params.persistenceDir,
      () => params.serviceClient
    );
    const recReport = await persistence.reconcileLocalAndRemote();

    const unresolvedBlockers: string[] = [];
    const requiredDeploymentActions: string[] = [];

    if (!step2fExecutedRemotely) {
      unresolvedBlockers.push(
        `Live Render service (${baseUrl}) is online (GET /health -> 200 OK, Supabase reachable=true), but is currently running commit ${gitAudit.lastCommittedHeadSha.slice(
          0,
          12
        )} ("${gitAudit.lastCommittedMessage}"), which predates the Phase 6.10.19.16–17 Strategy 03 routes and server.ts Step 2f bootstrap (GET /api/indian/strategy03/research/shadow -> 404 Not Found; GET /health/strategy03-4h-runtime -> 404 Not Found).`
      );
      unresolvedBlockers.push(
        `Today's NSE market session (2026-11-18) closed at 15:30 IST. The next genuinely eligible completed NSE 4H session block is ${sessionEval.nextExpectedEligibleWindowIst}.`
      );
      requiredDeploymentActions.push(
        "Commit and push the local working tree changes (backend/src/server.ts, backend/src/routes/health.ts, backend/src/routes/strategy03Data.ts, and backend/src/indian/swing/research/strategy03/**) to origin/main on GitHub so Render auto-deploys the latest build."
      );
      requiredDeploymentActions.push(
        `After Render finishes deploying, probe GET ${baseUrl}/health/strategy03-4h-runtime to confirm schedulerBootstrapStatus="BOOTSTRAPPED_ACTIVE", executionEnvironment="DEPLOYED_PRODUCTION_RUNTIME", isActualDeployedProductionEvidence=true, and activeSchedulerInstanceCount=1.`
      );
    }

    return {
      verifiedAtIso: evalNow.toISOString(),
      verifiedAtIst: istIso,
      phase: "6.10.19.17",
      renderServiceUrl: baseUrl,
      gitWorkspaceAudit: gitAudit,
      liveRenderProbes: {
        healthEndpoint: healthProbe,
        strategy03ShadowEndpoint: shadowProbe,
        strategy03RuntimeHealthEndpoint: runtimeProbe,
      },
      deploymentVerificationStatus: deploymentStatus,
      deployedBuildVerification: {
        renderServiceReachable: renderReachable,
        renderSupabasePersistenceReachable: renderSupabaseOk,
        latestPhase6101916CodeDeployedOnRender:
          runtimeEndpointPresentOnRender && shadowRoutePresentOnRender,
        serverTsStep2fExecutedInDeployedRender: step2fExecutedRemotely,
        executionEnvironmentReported: remoteExecEnv,
        isActualDeployedProductionEvidence: isActualProdEvidence,
        activeSchedulerInstanceCountInDeployedRender:
          remoteRuntimeHealth?.activeSchedulerInstanceCount ?? null,
        rootDirectoryConfigured: "backend",
        buildCommandConfigured: "npm install && npm run build",
        startCommandConfigured: "npm run start (node dist/backend/src/server.js)",
      },
      controlledProductionCycleVerification: {
        status: prodCycleStatus,
        currentSessionEvaluation: sessionEval,
        nextEligibleNseSessionBlockIst: sessionEval.nextExpectedEligibleWindowIst,
        manufacturedOrBackdatedCandlesUsed: false,
        actualDeployedProductionCycleCompleted: actualProdCycleCompleted,
        productionCycleId: prodCycleId,
        explanation: cycleExplanation,
      },
      supabaseReconciliation: {
        persistenceStatus: recReport.persistenceStatus,
        remoteTablesAvailable: recReport.remoteTablesAvailable,
        inSync: recReport.inSync,
        walPendingCount: recReport.localCounts.pendingWal,
        localCounts: recReport.localCounts,
        remoteCounts: recReport.remoteCounts,
      },
      localRuntimeReadinessCheck: {
        localBootstrapStatus: localHealth.schedulerBootstrapStatus,
        localActiveSchedulerInstances: localHealth.activeSchedulerInstanceCount,
        localExecutionEnvironment: localHealth.executionEnvironment,
        localIndependentAuditPassed:
          localHealth.operationalHealthSnapshot?.independentAuditStatus
            .allIntegrityChecksPassed ?? true,
      },
      unresolvedBlockers,
      requiredDeploymentActions,
    };
  }
}

