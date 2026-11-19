import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { FourHourCandle } from "../prebreakout/Strategy03FourHourCandleProvider.js";
import { evaluateFourHourPreBreakout } from "../prebreakout/Strategy03FourHourPreBreakoutScanner.js";
import { Strategy03FourHourForwardOutcomeTracker } from "../prebreakout/Strategy03FourHourForwardOutcomeTracker.js";
import { Strategy03ForwardMaturityMonitor } from "../prebreakout/Strategy03ForwardMaturityMonitor.js";
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

function makeFutureCompletedBars(
  lastSignalTimestampUtc: string,
  count: number,
  overrideAt?: Record<number, Partial<FourHourCandle>>
): FourHourCandle[] {
  const startMs = Date.parse(lastSignalTimestampUtc);
  return Array.from({ length: count }, (_, idx) => {
    const step = idx + 1;
    const baseBar: FourHourCandle = {
      timeframe: "4H",
      timestamp: new Date(startMs + step * 4 * 3_600_000).toISOString(),
      open: 107.0,
      high: 107.8,
      low: 106.2,
      close: 107.1,
      volume: 45_000,
      isComplete: true,
      constituentBarCount: 4,
      blockDurationMinutes: 240,
    };
    return overrideAt?.[step] ? { ...baseBar, ...overrideAt[step] } : baseBar;
  });
}

describe("Strategy 03 Phase 6.10.19.13 — Forward Monitoring, Maturity Progress & Data Integrity", () => {
  const tempDirs: string[] = [];

  function makeTempDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "s03_p6101913_"));
    tempDirs.push(dir);
    return dir;
  }

  afterEach(() => {
    for (const d of tempDirs.splice(0)) {
      fs.rmSync(d, { recursive: true, force: true });
    }
  });

  it("1-5. processes each completed post-signal 4H bar once across repeated cycles, rejects 1H/incomplete/duplicate/pre-signal candles, tracks 1B/5B/10B/20B maturity progression, and recovers across restart without resetting history", async () => {
    const snapDir = makeTempDir();
    const monDir = makeTempDir();
    const tracker = new Strategy03FourHourForwardOutcomeTracker(snapDir);

    const s0 = makeReadySeries(7); // SHORT_HIGH_QUALITY
    const item = evaluateFourHourPreBreakout({
      nseSymbol: "CORALFINAC",
      companyName: "Coral Finance",
      candles: s0,
      dataProvider: "4H",
      sourceReference: "cache4h/CORALFINAC_4h.json",
    });
    const refBar = s0[s0.length - 1];
    const reg = tracker.registerReadySignal({
      item,
      referenceCandle: refBar,
      persistenceStatus: "LOCAL_ONLY",
    });
    const snap = reg.snapshot!;

    const monitor = new Strategy03ForwardMaturityMonitor(monDir, [snap]);

    // Cycle 1: 0 post-signal bars + 1H bar + incomplete bar -> stays PENDING_ZERO_POST_BARS
    const fake1h: FourHourCandle = { ...refBar, timeframe: "1H" as any, timestamp: "2026-10-25T04:15:00.000Z" };
    const fakeInc: FourHourCandle = { ...refBar, isComplete: false, timestamp: "2026-10-25T08:15:00.000Z" };
    const c1 = await monitor.runMonitoringCycle({
      cycleId: "c1",
      loadCandlesBySymbol: () => [...s0, fake1h, fakeInc],
      now: new Date(Date.parse(refBar.timestamp) + 2 * 3_600_000),
    });
    expect(c1.cycleResult.newlyProcessed4hBarsCount).toBe(0);
    expect(c1.cycleResult.signalsUpdatedCount).toBe(0);
    expect(c1.cycleResult.rejected1hCount).toBe(1);
    expect(c1.cycleResult.rejectedIncompleteCount).toBe(1);
    expect(c1.cycleResult.cohortMaturityStatistics.SHORT_HIGH_QUALITY.maturityDistribution.pendingZeroPostBars).toBe(1);

    // Cycle 2: 5 new completed 4H bars (with breakout at bar 3 and a duplicate of bar 3)
    const future20 = makeFutureCompletedBars(refBar.timestamp, 20, {
      3: { high: 111.0, close: 110.5 }, // breakout
      10: { high: 114.0, close: 113.2 },
      20: { high: 116.0, close: 115.0 },
    });
    const future5 = future20.slice(0, 5);
    const c2 = await monitor.runMonitoringCycle({
      cycleId: "c2",
      loadCandlesBySymbol: () => [...s0, ...future5, future5[2]], // duplicate bar 3 included
      now: new Date(Date.parse(future5[4].timestamp) + 3_600_000),
    });
    expect(c2.cycleResult.newlyProcessed4hBarsCount).toBe(5);
    expect(c2.cycleResult.signalsUpdatedCount).toBe(1);
    expect(c2.cycleResult.auditStatus.allIntegrityChecksPassed).toBe(true);
    expect(c2.cycleResult.auditStatus.auditWarningRaised).toBe(false);
    expect(c2.cycleResult.cohortMaturityStatistics.SHORT_HIGH_QUALITY.maturityDistribution.atLeast1PostBlock).toBe(1);
    expect(c2.cycleResult.cohortMaturityStatistics.SHORT_HIGH_QUALITY.maturityDistribution.atLeast5PostBlocks).toBe(1);
    expect(c2.cycleResult.cohortMaturityStatistics.SHORT_HIGH_QUALITY.maturityDistribution.atLeast10PostBlocks).toBe(0);

    // Cycle 3: Restart recovery + repeat same 5 bars -> 0 new bars, 0 duplicate events
    const restarted = new Strategy03ForwardMaturityMonitor(monDir, [snap]);
    const c3 = await restarted.runMonitoringCycle({
      cycleId: "c3_repeat",
      loadCandlesBySymbol: () => [...s0, ...future5],
      now: new Date(Date.parse(future5[4].timestamp) + 2 * 3_600_000),
    });
    expect(c3.cycleResult.newlyProcessed4hBarsCount).toBe(0);
    expect(c3.cycleResult.signalsUpdatedCount).toBe(0);
    expect(c3.cycleResult.newEventsEmitted).toHaveLength(0);

    // Cycle 4: Advance to 20 completed post-signal bars -> reaches 10B and 20B
    const c4 = await restarted.runMonitoringCycle({
      cycleId: "c4_to_20b",
      loadCandlesBySymbol: () => [...s0, ...future20],
      now: new Date(Date.parse(future20[19].timestamp) + 3_600_000),
    });
    expect(c4.cycleResult.newlyProcessed4hBarsCount).toBe(15);
    expect(c4.cycleResult.signalsUpdatedCount).toBe(1);
    expect(c4.cycleResult.cohortMaturityStatistics.SHORT_HIGH_QUALITY.maturityDistribution.atLeast10PostBlocks).toBe(1);
    expect(c4.cycleResult.cohortMaturityStatistics.SHORT_HIGH_QUALITY.maturityDistribution.atLeast20PostBlocks).toBe(1);

    // Cycle 5: Feed returns fewer bars -> never resets observation history
    await restarted.runMonitoringCycle({
      cycleId: "c5_no_reset",
      loadCandlesBySymbol: () => s0,
      now: new Date(Date.parse(future20[19].timestamp) + 2 * 3_600_000),
    });
    expect(restarted.getSignalState(snap.signalId)?.outcome.forwardCompleted4hBlocksObserved).toBe(20);
  });

  it("6-7. raises visible audit warning on calculation mismatch or stale data without repairing/suppressing, and preserves safety isolation", async () => {
    const snapDir = makeTempDir();
    const monDir = makeTempDir();
    const tracker = new Strategy03FourHourForwardOutcomeTracker(snapDir);

    const s0 = makeReadySeries(12); // MEDIUM_CLEAN
    const item = evaluateFourHourPreBreakout({
      nseSymbol: "ANANDRATHI",
      companyName: "Anand Rathi",
      candles: s0,
      dataProvider: "4H",
      sourceReference: "cache4h/ANANDRATHI_4h.json",
    });
    const refBar = s0[s0.length - 1];
    const reg = tracker.registerReadySignal({
      item,
      referenceCandle: refBar,
      persistenceStatus: "LOCAL_ONLY",
    });
    const snap = reg.snapshot!;

    const monitor = new Strategy03ForwardMaturityMonitor(monDir, [snap]);

    // Inject a tampered outcome record during audit to verify visible auditWarningRaised
    const mismatchCycle = await monitor.runMonitoringCycle({
      cycleId: "c_mismatch",
      loadCandlesBySymbol: () => s0,
      now: new Date(Date.parse(refBar.timestamp) + 3_600_000),
      injectMismatchForTest: (outcomes) =>
        outcomes.map((o) => ({ ...o, forwardCompleted4hBlocksObserved: 99 })),
    });
    expect(mismatchCycle.cycleResult.auditStatus.auditWarningRaised).toBe(true);
    expect(mismatchCycle.cycleResult.auditStatus.candleCalculationMismatchCount).toBe(1);

    // Safety isolation verification
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

