import fs from "node:fs";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  load4hCacheForSymbol,
  type FourHourCandle,
} from "./Strategy03FourHourCandleProvider.js";
import type { ImmutableReadySignalSnapshot } from "./Strategy03FourHourForwardOutcomeTracker.js";
import { Strategy03ForwardMaturityMonitor } from "./Strategy03ForwardMaturityMonitor.js";
import { Strategy03FourHourMonitoringEngine } from "./Strategy03FourHourMonitoringEngine.js";
import {
  Strategy03FourHourMonitoringPersistence,
  type MonitoringPersistenceStatus,
} from "./Strategy03FourHourMonitoringPersistence.js";
import {
  Strategy03FourHourMonitoringScheduler,
  type FourHourOperationalHealthSnapshot,
} from "./Strategy03FourHourMonitoringScheduler.js";
import {
  DEFAULT_STRATEGY03_PAPER_ISOLATION_CONFIG,
  validateStrategy03IsolationGuard,
} from "../Strategy03PaperIsolationConfig.js";

export type ExecutionEnvironmentClassification =
  | "DEPLOYED_PRODUCTION_RUNTIME"
  | "LOCAL_SERVER_RUNTIME"
  | "LOCAL_CLI_VERIFICATION_HARNESS"
  | "NOT_BOOTSTRAPPED";

export interface FourHourDeploymentRuntimeHealth {
  backendProcessStatus: "ONLINE" | "STOPPED";
  schedulerBootstrapStatus: "BOOTSTRAPPED_ACTIVE" | "STOPPED" | "NOT_BOOTSTRAPPED" | "FAILED_BOOTSTRAP";
  executionEnvironment: ExecutionEnvironmentClassification;
  isActualDeployedProductionEvidence: boolean;
  activeSchedulerInstanceCount: number;
  duplicateBootstrapsPreventedCount: number;
  lastRestartTimestampIso: string | null;
  lastShutdownTimestampIso: string | null;
  lastSuccessfulCycle: {
    cycleId: string | null;
    completedAtIso: string | null;
    executionEnvironment: ExecutionEnvironmentClassification;
  };
  lastProcessedCompleted4hBlockIst: string | null;
  nextEligibleCycleIst: string;
  supabasePersistenceStatus: MonitoringPersistenceStatus;
  remoteTablesAvailable: boolean;
  walPendingCount: number;
  latestSchedulerErrors: string[];
  renderDeploymentConfig: {
    backendRootDir: "backend";
    buildCommand: "npm install && npm run build";
    startCommand: "npm run start (node dist/backend/src/server.js)";
    serverBootstrapStep: "Step 2f in backend/src/server.ts -> strategy03FourHourMonitoringService.start()";
    gracefulShutdownHook: "SIGINT/SIGTERM in backend/src/server.ts -> strategy03FourHourMonitoringService.stop()";
    renderEnvDetected: boolean;
  };
  operationalHealthSnapshot: FourHourOperationalHealthSnapshot | null;
}

export class Strategy03FourHourMonitoringService {
  private static activeInstances = 0;

  private scheduler: Strategy03FourHourMonitoringScheduler | null = null;
  private persistence: Strategy03FourHourMonitoringPersistence | null = null;
  private candidateEngine: Strategy03FourHourMonitoringEngine | null = null;
  private forwardMonitor: Strategy03ForwardMaturityMonitor | null = null;

  private bootstrapped = false;
  private running = false;
  private duplicateBootstrapsPreventedCount = 0;
  private lastRestartTimestampIso: string | null = null;
  private lastShutdownTimestampIso: string | null = null;
  private bootstrapErrors: string[] = [];
  private executionEnvironment: ExecutionEnvironmentClassification = "NOT_BOOTSTRAPPED";

  private readonly storageDir: string;
  private readonly cache4hDir: string;
  private readonly snapshotsPath: string;
  private readonly seedPersistenceDir: string;
  private readonly getAdminClient: () => SupabaseClient | null;
  private readonly loadCandlesFn: (symbol: string) => FourHourCandle[];

  constructor(options?: {
    storageDir?: string;
    cache4hDir?: string;
    snapshotsPath?: string;
    seedPersistenceDir?: string;
    getAdminClient?: () => SupabaseClient | null;
    loadCandlesBySymbol?: (symbol: string) => FourHourCandle[];
  }) {
    const baseDataDir = path.resolve(process.cwd(), "data/research/strategy03");
    this.storageDir =
      options?.storageDir ?? path.join(baseDataDir, "phase6101916/runtime_service");
    this.cache4hDir =
      options?.cache4hDir ?? path.join(baseDataDir, "phase61019/cache4h");
    this.snapshotsPath =
      options?.snapshotsPath ??
      path.join(baseDataDir, "phase6101911/forward_signal_snapshots.json");
    this.seedPersistenceDir =
      options?.seedPersistenceDir ?? path.join(baseDataDir, "phase6101910");

    this.getAdminClient =
      options?.getAdminClient ??
      (() => {
        try {
          const mod = require("../../../../../db/supabaseClient.js");
          return mod.getAdminSupabaseClient();
        } catch {
          return null;
        }
      });

    this.loadCandlesFn =
      options?.loadCandlesBySymbol ??
      ((sym: string) => load4hCacheForSymbol(this.cache4hDir, sym));
  }

  public static getActiveInstanceCount(): number {
    return Strategy03FourHourMonitoringService.activeInstances;
  }

  public static resetActiveInstanceCountForTesting(): void {
    Strategy03FourHourMonitoringService.activeInstances = 0;
  }

  private detectExecutionEnvironment(
    explicitMode?: ExecutionEnvironmentClassification
  ): ExecutionEnvironmentClassification {
    if (explicitMode) return explicitMode;
    const isRenderOrProd =
      Boolean(process.env.RENDER) ||
      Boolean(process.env.RENDER_SERVICE_ID) ||
      process.env.NODE_ENV === "production";
    return isRenderOrProd ? "DEPLOYED_PRODUCTION_RUNTIME" : "LOCAL_SERVER_RUNTIME";
  }

  /**
   * Safe startup bootstrap called from server.ts Step 2f.
   * Recovers persisted state, prevents duplicate scheduler instances, and starts polling.
   */
  public async start(options?: {
    pollIntervalMs?: number;
    executionEnvironment?: ExecutionEnvironmentClassification;
    runImmediateCheckOnStartup?: boolean;
    now?: Date;
    logger?: { info: (msg: string) => void; warn: (msg: string) => void };
  }): Promise<{
    started: boolean;
    duplicatePrevented: boolean;
    activeInstanceCount: number;
    reason: string | null;
  }> {
    if (this.running && this.scheduler !== null) {
      this.duplicateBootstrapsPreventedCount++;
      options?.logger?.warn(
        "[Strategy03FourHourMonitoringService] Duplicate start() prevented — 4H monitoring scheduler already active."
      );
      return {
        started: false,
        duplicatePrevented: true,
        activeInstanceCount: Strategy03FourHourMonitoringService.activeInstances,
        reason: "ALREADY_RUNNING",
      };
    }

    try {
      validateStrategy03IsolationGuard(DEFAULT_STRATEGY03_PAPER_ISOLATION_CONFIG, {
        STRATEGY_01: false,
        STRATEGY_02: false,
        STRATEGY_03: false,
        LIVE_TRADING: false,
        BROKER_EXECUTION_ENABLED: false,
      });

      fs.mkdirSync(this.storageDir, { recursive: true });
      const persistDir = path.join(this.storageDir, "persistence_ledger");
      const fwdDir = path.join(this.storageDir, "forward_monitor");
      const schedDir = path.join(this.storageDir, "scheduler_state");
      fs.mkdirSync(persistDir, { recursive: true });

      // Seed local persistence files from Phase 6.10.19.10 if not already present in runtime_service
      for (const f of [
        "monitoring_runs.json",
        "candidate_state_history.json",
        "monitoring_alerts.json",
      ]) {
        const dst = path.join(persistDir, f);
        const src = path.join(this.seedPersistenceDir, f);
        if (!fs.existsSync(dst) && fs.existsSync(src)) {
          fs.copyFileSync(src, dst);
        }
      }

      const snapshots: ImmutableReadySignalSnapshot[] = fs.existsSync(this.snapshotsPath)
        ? JSON.parse(fs.readFileSync(this.snapshotsPath, "utf8"))
        : [];

      this.persistence = new Strategy03FourHourMonitoringPersistence(
        persistDir,
        this.getAdminClient
      );
      this.candidateEngine = new Strategy03FourHourMonitoringEngine();

      // Recover candidate state history and alerts across restarts
      const recSnap = await this.persistence.loadRecoverySnapshot();
      this.candidateEngine.recoverState({
        stateHistory: recSnap.stateHistory,
        alerts: recSnap.alerts,
      });

      this.forwardMonitor = new Strategy03ForwardMaturityMonitor(
        fwdDir,
        snapshots,
        this.getAdminClient
      );
      this.scheduler = new Strategy03FourHourMonitoringScheduler(
        schedDir,
        this.forwardMonitor,
        this.candidateEngine,
        this.persistence
      );

      const startRes = this.scheduler.start(options?.pollIntervalMs ?? 60_000, {
        loadCandlesBySymbol: this.loadCandlesFn,
      });

      if (startRes.started) {
        Strategy03FourHourMonitoringService.activeInstances++;
      }

      this.bootstrapped = true;
      this.running = true;
      this.lastRestartTimestampIso = (options?.now ?? new Date()).toISOString();
      this.executionEnvironment = this.detectExecutionEnvironment(
        options?.executionEnvironment
      );

      if (options?.runImmediateCheckOnStartup) {
        await this.scheduler.runDueCycle({
          now: options?.now ?? new Date(),
          loadCandlesBySymbol: this.loadCandlesFn,
        });
      }

      this.saveRuntimeDeploymentHealth(options?.now ?? new Date());

      options?.logger?.info(
        `[Strategy03FourHourMonitoringService] Bootstrapped 4H session-block scheduler (env=${this.executionEnvironment}, activeInstances=${Strategy03FourHourMonitoringService.activeInstances}, snapshots=${snapshots.length}).`
      );

      return {
        started: true,
        duplicatePrevented: false,
        activeInstanceCount: Strategy03FourHourMonitoringService.activeInstances,
        reason: null,
      };
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      this.bootstrapErrors.push(msg);
      this.bootstrapped = false;
      this.running = false;
      return {
        started: false,
        duplicatePrevented: false,
        activeInstanceCount: Strategy03FourHourMonitoringService.activeInstances,
        reason: msg,
      };
    }
  }

  public stop(now: Date = new Date()): void {
    if (this.scheduler && this.running) {
      this.scheduler.stop();
      Strategy03FourHourMonitoringService.activeInstances = Math.max(
        0,
        Strategy03FourHourMonitoringService.activeInstances - 1
      );
    }
    this.running = false;
    this.lastShutdownTimestampIso = now.toISOString();
    this.saveRuntimeDeploymentHealth(now);
  }

  public async triggerDueCycleNow(now: Date = new Date()) {
    if (!this.scheduler) {
      throw new Error("Strategy03FourHourMonitoringService is not bootstrapped.");
    }
    const res = await this.scheduler.runDueCycle({
      now,
      loadCandlesBySymbol: this.loadCandlesFn,
    });
    this.saveRuntimeDeploymentHealth(now);
    return res;
  }

  public getScheduler(): Strategy03FourHourMonitoringScheduler | null {
    return this.scheduler;
  }

  public getDeploymentHealth(now: Date = new Date()): FourHourDeploymentRuntimeHealth {
    const opHealth = this.scheduler ? this.scheduler.getOperationalHealth(now) : null;
    const renderDetected =
      Boolean(process.env.RENDER) || Boolean(process.env.RENDER_SERVICE_ID);

    const bootstrapStatus: FourHourDeploymentRuntimeHealth["schedulerBootstrapStatus"] =
      this.bootstrapErrors.length > 0 && !this.bootstrapped
        ? "FAILED_BOOTSTRAP"
        : !this.bootstrapped
        ? "NOT_BOOTSTRAPPED"
        : this.running
        ? "BOOTSTRAPPED_ACTIVE"
        : "STOPPED";

    const errors = [
      ...this.bootstrapErrors,
      ...(opHealth?.latestUnresolvedOperationalErrors ?? []),
    ];

    return {
      backendProcessStatus: this.running ? "ONLINE" : "STOPPED",
      schedulerBootstrapStatus: bootstrapStatus,
      executionEnvironment: this.executionEnvironment,
      isActualDeployedProductionEvidence:
        this.executionEnvironment === "DEPLOYED_PRODUCTION_RUNTIME" && renderDetected,
      activeSchedulerInstanceCount:
        Strategy03FourHourMonitoringService.activeInstances,
      duplicateBootstrapsPreventedCount: this.duplicateBootstrapsPreventedCount,
      lastRestartTimestampIso: this.lastRestartTimestampIso,
      lastShutdownTimestampIso: this.lastShutdownTimestampIso,
      lastSuccessfulCycle: {
        cycleId: opHealth?.lastSuccessfulMonitoringCycle.cycleId ?? null,
        completedAtIso: opHealth?.lastSuccessfulMonitoringCycle.completedAtIso ?? null,
        executionEnvironment: this.executionEnvironment,
      },
      lastProcessedCompleted4hBlockIst:
        opHealth?.lastCompletedNse4hBlockProcessedIst ?? null,
      nextEligibleCycleIst:
        opHealth?.nextExpectedEligibleMonitoringWindowIst ??
        "Awaiting scheduler bootstrap",
      supabasePersistenceStatus: opHealth?.remotePersistenceHealth ?? "LOCAL_ONLY",
      remoteTablesAvailable: opHealth?.remoteTablesAvailable ?? false,
      walPendingCount: opHealth?.walPendingCount ?? 0,
      latestSchedulerErrors: errors,
      renderDeploymentConfig: {
        backendRootDir: "backend",
        buildCommand: "npm install && npm run build",
        startCommand: "npm run start (node dist/backend/src/server.js)",
        serverBootstrapStep:
          "Step 2f in backend/src/server.ts -> strategy03FourHourMonitoringService.start()",
        gracefulShutdownHook:
          "SIGINT/SIGTERM in backend/src/server.ts -> strategy03FourHourMonitoringService.stop()",
        renderEnvDetected: renderDetected,
      },
      operationalHealthSnapshot: opHealth,
    };
  }

  private saveRuntimeDeploymentHealth(now: Date = new Date()): void {
    try {
      fs.mkdirSync(this.storageDir, { recursive: true });
      const outPath = path.join(
        path.dirname(this.storageDir),
        "deployment_runtime_verification.json"
      );
      fs.writeFileSync(
        outPath,
        JSON.stringify(this.getDeploymentHealth(now), null, 2)
      );
    } catch {
      // Ignore write error in restricted environments
    }
  }
}

export const strategy03FourHourMonitoringService =
  new Strategy03FourHourMonitoringService();

