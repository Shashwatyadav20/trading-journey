import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { FourHourCandle } from "../prebreakout/Strategy03FourHourCandleProvider.js";
import { evaluateFourHourPreBreakout } from "../prebreakout/Strategy03FourHourPreBreakoutScanner.js";
import { Strategy03FourHourForwardOutcomeTracker } from "../prebreakout/Strategy03FourHourForwardOutcomeTracker.js";
import { Strategy03ForwardMaturityMonitor } from "../prebreakout/Strategy03ForwardMaturityMonitor.js";
import { Strategy03FourHourMonitoringEngine } from "../prebreakout/Strategy03FourHourMonitoringEngine.js";
import { Strategy03FourHourMonitoringPersistence } from "../prebreakout/Strategy03FourHourMonitoringPersistence.js";
import { Strategy03FourHourMonitoringScheduler } from "../prebreakout/Strategy03FourHourMonitoringScheduler.js";
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

function createControllableSupabase() {
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
              error: { code: "503", message: "TEMPORARY_SUPABASE_OUTAGE" },
            });
          }
          return resolve({ data: [...store.values()], error: null });
        },
        async upsert(rows: any | any[], opts?: { onConflict?: string; ignoreDuplicates?: boolean }) {
          if (mode === "OUTAGE") {
            return {
              data: null,
              error: { code: "503", message: "TEMPORARY_SUPABASE_OUTAGE" },
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

describe("Strategy 03 Phase 6.10.19.15 — Automated Shadow Operations & Monitoring Reliability", () => {
  const tempDirs: string[] = [];

  function makeTempDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "s03_p6101915_"));
    tempDirs.push(dir);
    return dir;
  }

  afterEach(() => {
    for (const d of tempDirs.splice(0)) {
      fs.rmSync(d, { recursive: true, force: true });
    }
  });

  it("1-5. handles NSE trading days, weekends, and holidays; schedules AM_240M (>=13:20 IST) and PM_135M (>=15:35 IST) blocks; survives restart; prevents duplicate and concurrent runs", async () => {
    const dir = makeTempDir();
    const env = createControllableSupabase();
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
    const snap = tracker.registerReadySignal({
      item,
      referenceCandle: refBar,
      persistenceStatus: "REMOTE_SYNCED",
    }).snapshot!;

    const buildScheduler = () => {
      const fwd = new Strategy03ForwardMaturityMonitor(
        path.join(dir, "fwd"),
        [snap],
        () => env.client
      );
      const eng = new Strategy03FourHourMonitoringEngine();
      const per = new Strategy03FourHourMonitoringPersistence(
        path.join(dir, "per"),
        () => env.client,
        1
      );
      const sch = new Strategy03FourHourMonitoringScheduler(
        path.join(dir, "sch"),
        fwd,
        eng,
        per
      );
      sch.setRunningStateForObservation(true);
      return sch;
    };

    const scheduler = buildScheduler();

    // 1. Weekend check (Saturday 2026-10-17)
    const satWin = scheduler.evaluateSessionBlockWindow(new Date("2026-10-17T14:00:00+05:30"));
    expect(satWin.isTradingDay).toBe(false);
    expect(satWin.nonTradingReason).toBe("WEEKEND");

    // 1b. NSE Holiday check (Guru Nanak Jayanti 2026-11-24 / 2026-11-05)
    const holWin = scheduler.evaluateSessionBlockWindow(new Date("2026-11-24T14:00:00+05:30"));
    expect(holWin.isTradingDay).toBe(false);
    expect(holWin.nonTradingReason).toBe("NSE_HOLIDAY");

    // 2. Before AM_240M completion (11:00 IST on trading day 2026-10-19) -> not eligible yet
    const preAm = await scheduler.runDueCycle({
      now: new Date("2026-10-19T11:00:00+05:30"),
      loadCandlesBySymbol: () => s0,
    });
    expect(preAm.executed).toBe(false);
    expect(preAm.skippedReason).toBe("BEFORE_AM_4H_BLOCK_COMPLETION_13_20_IST");
    // Health distinguishes scheduled waiting state from completed healthy cycle
    expect(scheduler.getOperationalHealth(new Date("2026-10-19T11:00:00+05:30")).schedulerStatus).toBe(
      "SCHEDULED_WAITING_FOR_4H_BLOCK"
    );

    // 2b. Eligible AM_240M block at 13:25 IST -> executes
    const amRun = await scheduler.runDueCycle({
      now: new Date("2026-10-19T13:25:00+05:30"),
      loadCandlesBySymbol: () => s0,
    });
    expect(amRun.executed).toBe(true);
    expect(amRun.cycleId).toBe("s03_4h_cycle_2026-10-19_AM_240M");

    // 4. Duplicate AM_240M invocation at 13:40 IST -> prevented and emits operational alert
    const amDup = await scheduler.runDueCycle({
      now: new Date("2026-10-19T13:40:00+05:30"),
      loadCandlesBySymbol: () => s0,
    });
    expect(amDup.executed).toBe(false);
    expect(amDup.skippedReason).toBe("DUPLICATE_CYCLE_PREVENTED");
    expect(
      amDup.newOperationalAlerts.some(
        (a) => a.alertType === "DUPLICATE_OR_OVERLAPPING_EXECUTION"
      )
    ).toBe(true);

    // 3. Restart recovery before PM_135M window
    const restarted = buildScheduler();
    const amDupAfterRestart = await restarted.runDueCycle({
      now: new Date("2026-10-19T14:00:00+05:30"),
      loadCandlesBySymbol: () => s0,
    });
    expect(amDupAfterRestart.executed).toBe(false);
    expect(amDupAfterRestart.skippedReason).toBe("DUPLICATE_CYCLE_PREVENTED");

    // 5. Concurrent overlapping invocation prevention
    (restarted as any).isCycleInProgress = true;
    const overlapping = await restarted.runDueCycle({
      now: new Date("2026-10-19T15:40:00+05:30"),
      loadCandlesBySymbol: () => s0,
    });
    expect(overlapping.executed).toBe(false);
    expect(overlapping.skippedReason).toBe("CONCURRENT_CYCLE_IN_PROGRESS");
    (restarted as any).isCycleInProgress = false;

    // 2c. Eligible PM_135M block at 15:40 IST -> executes
    const pmRun = await restarted.runDueCycle({
      now: new Date("2026-10-19T15:40:00+05:30"),
      loadCandlesBySymbol: () => s0,
    });
    expect(pmRun.executed).toBe(true);
    expect(pmRun.cycleId).toBe("s03_4h_cycle_2026-10-19_PM_135M");
  });

  it("6-11. emits alerts and degrades health on missing/stale data, Supabase outage, WAL accumulation, runner failure, or audit mismatch; reconciles after outage; preserves signal immutability and safety locks", async () => {
    const dir = makeTempDir();
    const env = createControllableSupabase();
    const s0 = makeReadySeries(12);
    const tracker = new Strategy03FourHourForwardOutcomeTracker(path.join(dir, "snap"));
    const item = evaluateFourHourPreBreakout({
      nseSymbol: "ANANDRATHI",
      companyName: "Anand Rathi",
      candles: s0,
      dataProvider: "4H",
      sourceReference: "cache4h/ANANDRATHI_4h.json",
    });
    const refBar = s0[s0.length - 1];
    const snap = tracker.registerReadySignal({
      item,
      referenceCandle: refBar,
      persistenceStatus: "REMOTE_SYNCED",
    }).snapshot!;

    const fwd = new Strategy03ForwardMaturityMonitor(
      path.join(dir, "fwd"),
      [snap],
      () => env.client
    );
    const eng = new Strategy03FourHourMonitoringEngine();
    const per = new Strategy03FourHourMonitoringPersistence(
      path.join(dir, "per"),
      () => env.client,
      1
    );
    const scheduler = new Strategy03FourHourMonitoringScheduler(
      path.join(dir, "sch"),
      fwd,
      eng,
      per
    );

    // 9. When scheduler is stopped, status is STOPPED (no false healthy status)
    expect(scheduler.getOperationalHealth().schedulerStatus).toBe("STOPPED");
    scheduler.setRunningStateForObservation(true);

    // 6a. Runner failure does not mark cycle completed and sets status to FAILED_LAST_CYCLE
    const failRun = await scheduler.runDueCycle({
      now: new Date("2026-10-19T13:25:00+05:30"),
      loadCandlesBySymbol: () => s0,
      simulateRunnerFailure: true,
    });
    expect(failRun.executed).toBe(false);
    expect(
      failRun.newOperationalAlerts.some((a) => a.alertType === "SCHEDULER_FAILURE")
    ).toBe(true);
    expect(scheduler.getOperationalHealth(new Date("2026-10-19T13:25:00+05:30")).schedulerStatus).toBe(
      "FAILED_LAST_CYCLE"
    );

    // 7 & 8. Simulate Supabase outage on AM retry -> queues in WAL and reports DEGRADED_PERSISTENCE_OUTAGE
    env.setMode("OUTAGE");
    const outageRun = await scheduler.runDueCycle({
      now: new Date("2026-10-19T13:26:00+05:30"),
      loadCandlesBySymbol: () => s0,
    });
    expect(outageRun.executed).toBe(true);
    expect(
      outageRun.newOperationalAlerts.some(
        (a) => a.alertType === "REMOTE_SUPABASE_OUTAGE"
      )
    ).toBe(true);
    expect(
      outageRun.newOperationalAlerts.some((a) => a.alertType === "WAL_ACCUMULATION")
    ).toBe(true);
    const healthDuringOutage = scheduler.getOperationalHealth(
      new Date("2026-10-19T13:26:00+05:30")
    );
    expect(healthDuringOutage.schedulerStatus).toBe("DEGRADED_PERSISTENCE_OUTAGE");
    expect(healthDuringOutage.walPendingCount).toBeGreaterThan(0);

    // Restore Supabase on PM cycle -> reconciles WAL to 0 and reports HEALTHY_CYCLE_COMPLETED
    env.setMode("ONLINE");
    const recoveredPm = await scheduler.runDueCycle({
      now: new Date("2026-10-19T15:40:00+05:30"),
      loadCandlesBySymbol: () => s0,
    });
    expect(recoveredPm.executed).toBe(true);
    const healthAfterRecovery = scheduler.getOperationalHealth(
      new Date("2026-10-19T15:40:00+05:30")
    );
    expect(healthAfterRecovery.schedulerStatus).toBe("HEALTHY_CYCLE_COMPLETED");
    expect(healthAfterRecovery.remotePersistenceHealth).toBe("REMOTE_SYNCED");
    expect(healthAfterRecovery.walPendingCount).toBe(0);

    // 6b. Stale data & audit mismatch on next trading day (2026-10-23) -> reports degraded status (never false healthy)
    const staleAndMismatch = await scheduler.runDueCycle({
      now: new Date("2026-10-23T13:25:00+05:30"),
      loadCandlesBySymbol: () => s0,
      maxDataAgeHours: 1, // force stale
      injectMismatchForTest: (outcomes) =>
        outcomes.map((o) => ({ ...o, forwardCompleted4hBlocksObserved: 77 })),
    });
    expect(staleAndMismatch.executed).toBe(true);
    expect(
      staleAndMismatch.newOperationalAlerts.some(
        (a) => a.alertType === "STALE_SOURCE_DATA"
      )
    ).toBe(true);
    expect(
      staleAndMismatch.newOperationalAlerts.some(
        (a) => a.alertType === "INDEPENDENT_AUDIT_MISMATCH"
      )
    ).toBe(true);
    expect(
      scheduler.getOperationalHealth(new Date("2026-10-23T13:25:00+05:30")).schedulerStatus
    ).toBe("DEGRADED_AUDIT_MISMATCH");

    // 10 & 11. Historical snapshot immutable and safety locks OFF
    expect(snap.immutable).toBe(true);
    expect(snap.originalScore).toBe(item.priorityScore);
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
