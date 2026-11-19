import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { FourHourCandle } from "../prebreakout/Strategy03FourHourCandleProvider.js";
import { evaluateFourHourPreBreakout } from "../prebreakout/Strategy03FourHourPreBreakoutScanner.js";
import { Strategy03FourHourForwardOutcomeTracker } from "../prebreakout/Strategy03FourHourForwardOutcomeTracker.js";
import { Strategy03FourHourMonitoringService } from "../prebreakout/Strategy03FourHourMonitoringService.js";
import {
  DEFAULT_STRATEGY03_PAPER_ISOLATION_CONFIG,
  validateStrategy03IsolationGuard,
} from "../Strategy03PaperIsolationConfig.js";

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
  let mode: "ONLINE" | "OUTAGE" = "ONLINE";
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
          if (mode === "OUTAGE") {
            return resolve({
              data: null,
              error: { code: "503", message: "TEMPORARY_OUTAGE" },
            });
          }
          return resolve({ data: [...store.values()], error: null });
        },
        async upsert(rows: any | any[], opts?: { onConflict?: string; ignoreDuplicates?: boolean }) {
          if (mode === "OUTAGE") {
            return {
              data: null,
              error: { code: "503", message: "TEMPORARY_OUTAGE" },
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
      };
      return builder;
    },
  };

  return {
    tables,
    setMode: (m: "ONLINE" | "OUTAGE") => {
      mode = m;
    },
    client: client as SupabaseClient,
  };
}

describe("Strategy 03 Phase 6.10.19.16 — Production Deployment & Runtime Verification", () => {
  const tempDirs: string[] = [];

  function makeTempDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "s03_p6101916_"));
    tempDirs.push(dir);
    return dir;
  }

  afterEach(() => {
    Strategy03FourHourMonitoringService.resetActiveInstanceCountForTesting();
    for (const d of tempDirs.splice(0)) {
      fs.rmSync(d, { recursive: true, force: true });
    }
  });

  it("1-5. verifies startup bootstrap, duplicate initialization prevention, active instance count=1, graceful shutdown, and restart state recovery", async () => {
    const dir = makeTempDir();
    const env = createMockSupabase();
    const s0 = makeReadySeries(7);
    const tracker = new Strategy03FourHourForwardOutcomeTracker(path.join(dir, "snap"));
    const item = evaluateFourHourPreBreakout({
      nseSymbol: "CORALFINAC",
      companyName: "Coral Finance",
      candles: s0,
      dataProvider: "4H",
      sourceReference: "cache4h/CORALFINAC_4h.json",
    });
    const refBar = s0[s0.length - 1];
    tracker.registerReadySignal({
      item,
      referenceCandle: refBar,
      persistenceStatus: "REMOTE_SYNCED",
    });
    await tracker.persistForwardLedger();

    const service = new Strategy03FourHourMonitoringService({
      storageDir: path.join(dir, "runtime"),
      snapshotsPath: path.join(dir, "snap/forward_signal_snapshots.json"),
      seedPersistenceDir: path.join(dir, "seed"),
      getAdminClient: () => env.client,
      loadCandlesBySymbol: () => s0,
    });

    // Before bootstrap
    expect(service.getDeploymentHealth().schedulerBootstrapStatus).toBe("NOT_BOOTSTRAPPED");
    expect(Strategy03FourHourMonitoringService.getActiveInstanceCount()).toBe(0);

    // 1. Startup bootstrap
    const start1 = await service.start({
      pollIntervalMs: 300_000,
      executionEnvironment: "LOCAL_SERVER_RUNTIME",
      now: new Date("2026-10-19T13:25:00+05:30"),
    });
    expect(start1.started).toBe(true);
    expect(start1.duplicatePrevented).toBe(false);
    expect(start1.activeInstanceCount).toBe(1);
    expect(service.getDeploymentHealth().schedulerBootstrapStatus).toBe("BOOTSTRAPPED_ACTIVE");

    // 2. Duplicate initialization prevention
    const start2 = await service.start({
      pollIntervalMs: 300_000,
      executionEnvironment: "LOCAL_SERVER_RUNTIME",
      now: new Date("2026-10-19T13:26:00+05:30"),
    });
    expect(start2.started).toBe(false);
    expect(start2.duplicatePrevented).toBe(true);
    expect(start2.activeInstanceCount).toBe(1);
    expect(service.getDeploymentHealth().duplicateBootstrapsPreventedCount).toBe(1);

    // Execute AM cycle
    const amRes = await service.triggerDueCycleNow(new Date("2026-10-19T13:26:00+05:30"));
    expect(amRes.executed).toBe(true);
    expect(amRes.cycleId).toBe("s03_4h_cycle_2026-10-19_AM_240M");

    // 3. Graceful shutdown
    service.stop(new Date("2026-10-19T14:00:00+05:30"));
    expect(service.getDeploymentHealth().backendProcessStatus).toBe("STOPPED");
    expect(service.getDeploymentHealth().schedulerBootstrapStatus).toBe("STOPPED");
    expect(Strategy03FourHourMonitoringService.getActiveInstanceCount()).toBe(0);

    // 4. Restart recovery
    const startAfterRestart = await service.start({
      pollIntervalMs: 300_000,
      executionEnvironment: "LOCAL_SERVER_RUNTIME",
      now: new Date("2026-10-19T14:10:00+05:30"),
    });
    expect(startAfterRestart.started).toBe(true);
    expect(startAfterRestart.activeInstanceCount).toBe(1);

    // Verify duplicate AM cycle is prevented after restart
    const dupAm = await service.triggerDueCycleNow(new Date("2026-10-19T14:15:00+05:30"));
    expect(dupAm.executed).toBe(false);
    expect(dupAm.skippedReason).toBe("DUPLICATE_CYCLE_PREVENTED");

    service.stop();
  });

  it("6-9. verifies NSE holiday & session timing, Supabase outage recovery, server.ts bootstrap presence, and safety-lock isolation", async () => {
    const dir = makeTempDir();
    const env = createMockSupabase();
    const s0 = makeReadySeries(7);
    const tracker = new Strategy03FourHourForwardOutcomeTracker(path.join(dir, "snap"));
    const item = evaluateFourHourPreBreakout({
      nseSymbol: "SUNPHARMA",
      companyName: "Sun Pharma",
      candles: s0,
      dataProvider: "4H",
      sourceReference: "cache4h/SUNPHARMA_4h.json",
    });
    const refBar = s0[s0.length - 1];
    tracker.registerReadySignal({
      item,
      referenceCandle: refBar,
      persistenceStatus: "REMOTE_SYNCED",
    });
    await tracker.persistForwardLedger();

    const service = new Strategy03FourHourMonitoringService({
      storageDir: path.join(dir, "runtime"),
      snapshotsPath: path.join(dir, "snap/forward_signal_snapshots.json"),
      seedPersistenceDir: path.join(dir, "seed"),
      getAdminClient: () => env.client,
      loadCandlesBySymbol: () => s0,
    });

    await service.start({
      pollIntervalMs: 300_000,
      executionEnvironment: "LOCAL_SERVER_RUNTIME",
      now: new Date("2026-11-24T14:00:00+05:30"),
    });

    // 6. NSE holiday skips execution
    const holCycle = await service.triggerDueCycleNow(
      new Date("2026-11-24T14:00:00+05:30")
    );
    expect(holCycle.executed).toBe(false);
    expect(holCycle.skippedReason).toBe("NON_TRADING_DAY_NSE_HOLIDAY");

    // 8. Supabase outage queues WAL -> recovery syncs WAL to 0
    env.setMode("OUTAGE");
    const outageCycle = await service.triggerDueCycleNow(
      new Date("2026-10-19T13:25:00+05:30")
    );
    expect(outageCycle.executed).toBe(true);
    expect(service.getDeploymentHealth().supabasePersistenceStatus).toBe("SYNC_PENDING");
    expect(service.getDeploymentHealth().walPendingCount).toBeGreaterThan(0);

    env.setMode("ONLINE");
    const recCycle = await service.triggerDueCycleNow(
      new Date("2026-10-19T15:40:00+05:30")
    );
    expect(recCycle.executed).toBe(true);
    expect(service.getDeploymentHealth().supabasePersistenceStatus).toBe("REMOTE_SYNCED");
    expect(service.getDeploymentHealth().walPendingCount).toBe(0);

    service.stop();

    // Verify server.ts contains Step 2f bootstrap and SIGINT/SIGTERM stop()
    const serverSrc = fs.readFileSync(
      path.resolve("D:/Trading/my-app/backend/src/server.ts"),
      "utf8"
    );
    expect(serverSrc).toContain("strategy03FourHourMonitoringService.start");
    expect(serverSrc).toContain("strategy03FourHourMonitoringService.stop");

    // 9. Safety locks remain OFF
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

