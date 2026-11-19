import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { FourHourCandle } from "../prebreakout/Strategy03FourHourCandleProvider.js";
import { evaluateFourHourPreBreakout } from "../prebreakout/Strategy03FourHourPreBreakoutScanner.js";
import { Strategy03FourHourForwardOutcomeTracker } from "../prebreakout/Strategy03FourHourForwardOutcomeTracker.js";
import { Strategy03FourHourMonitoringService } from "../prebreakout/Strategy03FourHourMonitoringService.js";
import { Strategy03RenderLiveVerifier } from "../prebreakout/Strategy03RenderLiveVerifier.js";
import {
  DEFAULT_STRATEGY03_PAPER_ISOLATION_CONFIG,
  validateStrategy03IsolationGuard,
} from "../Strategy03PaperIsolationConfig.js";

const REPO_ROOT = path.resolve("D:/Trading/my-app");

function makeReadySeries(consBars: number = 7): FourHourCandle[] {
  const base: FourHourCandle[] = Array.from({ length: 18 }, (_, i) => ({
    timeframe: "4H",
    timestamp: new Date(Date.UTC(2026, 9, 1 + Math.floor(i / 2), i % 2 === 0 ? 4 : 8, 15)).toISOString(),
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
    timestamp: "2026-10-12T04:15:00.000Z",
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
    { timeframe: "4H", timestamp: "2026-10-12T08:15:00.000Z", open: 99.3, high: 102.5, low: 99.2, close: 102.2, volume: 110_000, isComplete: true, constituentBarCount: 3, blockDurationMinutes: 135 },
    { timeframe: "4H", timestamp: "2026-10-13T04:15:00.000Z", open: 102.2, high: 105.2, low: 102.0, close: 104.8, volume: 120_000, isComplete: true, constituentBarCount: 4, blockDurationMinutes: 240 },
    { timeframe: "4H", timestamp: "2026-10-13T08:15:00.000Z", open: 104.8, high: 107.6, low: 104.5, close: 107.2, volume: 115_000, isComplete: true, constituentBarCount: 3, blockDurationMinutes: 135 },
  ];
  const cons: FourHourCandle[] = Array.from({ length: consBars }, (_, i) => ({
    timeframe: "4H",
    timestamp: new Date(Date.UTC(2026, 9, 14 + Math.floor(i / 2), i % 2 === 0 ? 4 : 8, 15)).toISOString(),
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

function createMockSupabase() {
  const tables: Record<string, Map<string, any>> = {
    strategy03_monitoring_runs: new Map(),
    strategy03_candidate_state_history: new Map(),
    strategy03_monitoring_alerts: new Map(),
  };

  const client: any = {
    from(tableName: string) {
      const store = tables[tableName];
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
        then(resolve: any) {
          return resolve({ data: [...store.values()], error: null });
        },
        async upsert(rows: any | any[], opts?: { onConflict?: string; ignoreDuplicates?: boolean }) {
          const arr = Array.isArray(rows) ? rows : [rows];
          const keyField = opts?.onConflict ?? "id";
          for (const r of arr) {
            const k = String(r[keyField]);
            if (opts?.ignoreDuplicates && store.has(k)) continue;
            store.set(k, { ...r });
          }
          return { data: arr, error: null };
        },
      };
      return builder;
    },
  };

  return client as SupabaseClient;
}

describe("Strategy 03 Phase 6.10.19.17 — Render Production Deployment & Live Runtime Verification", () => {
  const tempDirs: string[] = [];

  function makeTempDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "s03_p6101917_"));
    tempDirs.push(dir);
    return dir;
  }

  afterEach(() => {
    Strategy03FourHourMonitoringService.resetActiveInstanceCountForTesting();
    for (const d of tempDirs.splice(0)) {
      fs.rmSync(d, { recursive: true, force: true });
    }
  });

  it("1. detects when Render is online on an older commit (404 on Strategy 03 endpoints) and reports WAITING_FOR_NEXT_ELIGIBLE_SESSION without claiming production activation", async () => {
    const dir = makeTempDir();
    const sb = createMockSupabase();
    const s0 = makeReadySeries(7);
    const tracker = new Strategy03FourHourForwardOutcomeTracker(path.join(dir, "snap"));
    const item = evaluateFourHourPreBreakout({
      nseSymbol: "CORALFINAC",
      companyName: "Coral Finance",
      candles: s0,
      dataProvider: "4H",
      sourceReference: "cache4h/CORALFINAC_4h.json",
    });
    tracker.registerReadySignal({
      item,
      referenceCandle: s0[s0.length - 1],
      persistenceStatus: "REMOTE_SYNCED",
    });
    await tracker.persistForwardLedger();

    const localService = new Strategy03FourHourMonitoringService({
      storageDir: path.join(dir, "runtime"),
      snapshotsPath: path.join(dir, "snap/forward_signal_snapshots.json"),
      seedPersistenceDir: path.join(dir, "seed"),
      getAdminClient: () => sb,
      loadCandlesBySymbol: () => s0,
    });
    await localService.start({
      pollIntervalMs: 300_000,
      executionEnvironment: "LOCAL_CLI_VERIFICATION_HARNESS",
      now: new Date("2026-11-18T20:47:26+05:30"),
    });

    const mockFetchStaleRender: any = async (url: string) => {
      if (url.endsWith("/health")) {
        return {
          status: 200,
          text: async () =>
            JSON.stringify({
              status: "ok",
              service: "trading-backend",
              persistence: { configured: true, reachable: true, mode: "supabase" },
            }),
        };
      }
      return {
        status: 404,
        text: async () =>
          JSON.stringify({
            message: `Route GET:${url} not found`,
            error: "Not Found",
            statusCode: 404,
          }),
      };
    };

    const verifier = new Strategy03RenderLiveVerifier();
    const rep = await verifier.verifyLiveRenderAndRuntime({
      renderServiceUrl: "https://trading-journey-backend.onrender.com",
      repoRootDir: REPO_ROOT,
      persistenceDir: path.join(dir, "persist"),
      serviceClient: sb,
      localMonitoringService: localService,
      now: new Date("2026-11-18T20:47:26+05:30"),
      fetchFn: mockFetchStaleRender,
    });

    expect(rep.deploymentVerificationStatus).toBe(
      "RENDER_SERVICE_ONLINE_STALE_COMMIT_NOT_YET_DEPLOYED"
    );
    expect(rep.deployedBuildVerification.latestPhase6101916CodeDeployedOnRender).toBe(false);
    expect(rep.deployedBuildVerification.serverTsStep2fExecutedInDeployedRender).toBe(false);
    expect(rep.deployedBuildVerification.isActualDeployedProductionEvidence).toBe(false);
    expect(rep.controlledProductionCycleVerification.status).toBe(
      "WAITING_FOR_NEXT_ELIGIBLE_SESSION"
    );
    expect(
      rep.controlledProductionCycleVerification.manufacturedOrBackdatedCandlesUsed
    ).toBe(false);

    localService.stop();
  });

  it("2. verifies DEPLOYED_AND_STEP2F_VERIFIED when Render returns 200 on /health/strategy03-4h-runtime with DEPLOYED_PRODUCTION_RUNTIME and confirms safety locks", async () => {
    const dir = makeTempDir();
    const sb = createMockSupabase();
    const s0 = makeReadySeries(7);
    const localService = new Strategy03FourHourMonitoringService({
      storageDir: path.join(dir, "runtime"),
      snapshotsPath: path.join(dir, "snap/forward_signal_snapshots.json"),
      seedPersistenceDir: path.join(dir, "seed"),
      getAdminClient: () => sb,
      loadCandlesBySymbol: () => s0,
    });

    const mockFetchDeployedRender: any = async (url: string) => {
      if (url.endsWith("/health")) {
        return {
          status: 200,
          text: async () =>
            JSON.stringify({
              status: "ok",
              service: "trading-backend",
              persistence: { configured: true, reachable: true, mode: "supabase" },
            }),
        };
      }
      if (url.endsWith("/api/indian/strategy03/research/shadow")) {
        return {
          status: 401,
          text: async () => JSON.stringify({ error: "Unauthorized" }),
        };
      }
      if (url.endsWith("/health/strategy03-4h-runtime")) {
        return {
          status: 200,
          text: async () =>
            JSON.stringify({
              status: "ok",
              runtimeHealth: {
                backendProcessStatus: "ONLINE",
                schedulerBootstrapStatus: "BOOTSTRAPPED_ACTIVE",
                executionEnvironment: "DEPLOYED_PRODUCTION_RUNTIME",
                isActualDeployedProductionEvidence: true,
                activeSchedulerInstanceCount: 1,
                lastSuccessfulCycle: {
                  cycleId: "s03_4h_cycle_2026-11-19_AM_240M",
                  completedAtIso: "2026-11-19T07:50:00.000Z",
                  executionEnvironment: "DEPLOYED_PRODUCTION_RUNTIME",
                },
              },
            }),
        };
      }
      return { status: 404, text: async () => "{}" };
    };

    const verifier = new Strategy03RenderLiveVerifier();
    const rep = await verifier.verifyLiveRenderAndRuntime({
      renderServiceUrl: "https://trading-journey-backend.onrender.com",
      repoRootDir: REPO_ROOT,
      persistenceDir: path.join(dir, "persist"),
      serviceClient: sb,
      localMonitoringService: localService,
      now: new Date("2026-11-19T13:25:00+05:30"),
      fetchFn: mockFetchDeployedRender,
    });

    expect(rep.deploymentVerificationStatus).toBe("DEPLOYED_AND_STEP2F_VERIFIED");
    expect(rep.deployedBuildVerification.latestPhase6101916CodeDeployedOnRender).toBe(true);
    expect(rep.deployedBuildVerification.serverTsStep2fExecutedInDeployedRender).toBe(true);
    expect(rep.deployedBuildVerification.isActualDeployedProductionEvidence).toBe(true);
    expect(rep.deployedBuildVerification.activeSchedulerInstanceCountInDeployedRender).toBe(1);
    expect(rep.controlledProductionCycleVerification.status).toBe(
      "PRODUCTION_CYCLE_COMPLETED_AND_SYNCED"
    );

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

