import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { FourHourCandle } from "../prebreakout/Strategy03FourHourCandleProvider.js";
import { evaluateFourHourPreBreakout } from "../prebreakout/Strategy03FourHourPreBreakoutScanner.js";
import { Strategy03FourHourForwardOutcomeTracker } from "../prebreakout/Strategy03FourHourForwardOutcomeTracker.js";

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

describe("Strategy 03 Phase 6.10.19.11 — Forward Shadow Testing & Signal Outcome Tracking", () => {
  const tempDirs: string[] = [];

  function makeTempDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "s03_p6101911_"));
    tempDirs.push(dir);
    return dir;
  }

  afterEach(() => {
    for (const d of tempDirs.splice(0)) {
      fs.rmSync(d, { recursive: true, force: true });
    }
  });

  it("1-4. captures immutable READY snapshots across cohorts, never rewrites original snapshot, ignores incomplete/pre-signal bars, and tracks breakout/invalidation/untriggered + 5/10/20 block outcomes + MFE/MAE", () => {
    const dir = makeTempDir();
    const tracker = new Strategy03FourHourForwardOutcomeTracker(dir);

    // Cohort 1: SHORT_HIGH_QUALITY (7 bars) -> confirms breakout at block 4, reaches 20 blocks
    const shortCandles = makeReadySeries(7);
    const shortItem = evaluateFourHourPreBreakout({
      nseSymbol: "CORALFINAC",
      companyName: "Coral Finance",
      candles: shortCandles,
      dataProvider: "4H",
      sourceReference: "cache4h/CORALFINAC_4h.json",
    });
    expect(shortItem.status).toBe("READY");
    expect(shortItem.consolidation.tier).toBe("SHORT_HIGH_QUALITY");

    const shortRefBar = shortCandles[shortCandles.length - 1];
    const regShort = tracker.registerReadySignal({
      item: shortItem,
      referenceCandle: shortRefBar,
      persistenceStatus: "LOCAL_ONLY",
    });
    expect(regShort.captured).toBe(true);
    const shortSnap = regShort.snapshot!;
    expect(shortSnap.immutable).toBe(true);
    expect(shortSnap.originalScore).toBe(shortItem.priorityScore);

    // Attempt to rewrite original snapshot after market movement -> must preserve original verbatim
    const rewriteAttempt = tracker.registerReadySignal({
      item: { ...shortItem, priorityScore: 10, currentPrice: 999 },
      referenceCandle: shortRefBar,
      persistenceStatus: "REMOTE_SYNCED",
    });
    expect(rewriteAttempt.captured).toBe(false);
    expect(rewriteAttempt.alreadyExisted).toBe(true);
    expect(tracker.getSnapshot(shortSnap.signalId)?.originalScore).toBe(shortItem.priorityScore);
    expect(tracker.getSnapshot(shortSnap.signalId)?.reference4hOhlcv.close).toBe(107.2);

    // Incomplete future candle above consolidation high (108.0) must NOT trigger breakout
    const incFuture: FourHourCandle = {
      timeframe: "4H",
      timestamp: new Date(Date.parse(shortRefBar.timestamp) + 4 * 3_600_000).toISOString(),
      open: 107.5,
      high: 115.0,
      low: 107.0,
      close: 114.0,
      volume: 100_000,
      isComplete: false,
      constituentBarCount: 1,
    };
    const outInc = tracker.evaluateForwardOutcomeForSignal({
      signalId: shortSnap.signalId,
      candles: [...shortCandles, incFuture],
    });
    expect(outInc.forwardCompleted4hBlocksObserved).toBe(0);
    expect(outInc.outcomeStatus).toBe("UNTRIGGERED");

    // 20 completed future 4H blocks: dip to 106.0 at block 2, breakout to 110.0 at block 4, peak 115.0 at block 10
    const future20 = makeFutureCompletedBars(shortRefBar.timestamp, 20, {
      2: { low: 105.8, close: 106.5 },
      4: { high: 110.5, close: 110.0 },
      5: { close: 111.0, high: 111.5 },
      10: { close: 114.0, high: 115.0 },
      20: { close: 112.5, high: 113.0 },
    });
    const outShort = tracker.evaluateForwardOutcomeForSignal({
      signalId: shortSnap.signalId,
      candles: [...shortCandles, ...future20],
    });
    expect(outShort.outcomeStatus).toBe("CONFIRMED_BREAKOUT");
    expect(outShort.firstConfirmedBreakout.occurred).toBe(true);
    expect(outShort.firstConfirmedBreakout.blocksToBreakout).toBe(4);
    expect(outShort.firstConfirmedBreakout.hoursToBreakout).toBe(16);
    expect(outShort.invalidationBeforeBreakout.occurred).toBe(false);
    expect(outShort.mfePct).toBeGreaterThan(7); // (115 - 107.2)/107.2 = 7.28%
    expect(outShort.maePct).toBeLessThan(0); // (105.8 - 107.2)/107.2 = -1.31%
    expect(outShort.horizon5B.reached).toBe(true);
    expect(outShort.horizon5B.statusAtHorizon).toBe("BREAKOUT");
    expect(outShort.horizon10B.reached).toBe(true);
    expect(outShort.horizon20B.reached).toBe(true);
    expect(outShort.remainedUntriggered).toBe(false);

    // Cohort 2: MEDIUM_CLEAN (12 bars) -> invalidated before breakout at block 3
    const medCandles = makeReadySeries(12);
    const medItem = evaluateFourHourPreBreakout({
      nseSymbol: "ANANDRATHI",
      companyName: "Anand Rathi",
      candles: medCandles,
      dataProvider: "4H",
      sourceReference: "cache4h/ANANDRATHI_4h.json",
    });
    expect(medItem.status).toBe("READY");
    expect(medItem.consolidation.tier).toBe("MEDIUM_CLEAN");
    const medRefBar = medCandles[medCandles.length - 1];
    const regMed = tracker.registerReadySignal({
      item: medItem,
      referenceCandle: medRefBar,
      persistenceStatus: "LOCAL_ONLY",
    });
    const medFuture6 = makeFutureCompletedBars(medRefBar.timestamp, 6, {
      3: { low: 104.0, close: 104.5 }, // < 105.5 consolidation low
      5: { high: 112.0, close: 111.0 }, // subsequent move above high after invalidation does not count as first breakout
    });
    const outMed = tracker.evaluateForwardOutcomeForSignal({
      signalId: regMed.snapshot!.signalId,
      candles: [...medCandles, ...medFuture6],
    });
    expect(outMed.outcomeStatus).toBe("INVALIDATED_BEFORE_BREAKOUT");
    expect(outMed.invalidationBeforeBreakout.occurred).toBe(true);
    expect(outMed.invalidationBeforeBreakout.blocksToInvalidation).toBe(3);
    expect(outMed.firstConfirmedBreakout.occurred).toBe(false);
    expect(outMed.horizon5B.reached).toBe(true);
    expect(outMed.horizon5B.statusAtHorizon).toBe("INVALIDATED");
    expect(outMed.horizon10B.reached).toBe(false);
  });

  it("5-6. computes separate cohort statistics with 95% Wilson CIs, refuses significance on small samples, and persists LOCAL_ONLY when remote tables are unapplied", async () => {
    const dir = makeTempDir();
    const mockSb: any = {
      from() {
        return {
          select() {
            return {
              limit: async () => ({
                data: null,
                error: {
                  code: "PGRST205",
                  message: "Could not find the table 'public.strategy03_monitoring_runs' in the schema cache",
                },
              }),
            };
          },
        };
      },
    };
    const tracker = new Strategy03FourHourForwardOutcomeTracker(dir, () => mockSb);

    const longCandles = makeReadySeries(18);
    const longItem = evaluateFourHourPreBreakout({
      nseSymbol: "TORNTPHARM",
      companyName: "Torrent",
      candles: longCandles,
      dataProvider: "4H",
      sourceReference: "cache4h/TORNTPHARM_4h.json",
    });
    expect(longItem.consolidation.tier).toBe("LONG_CLEAN");

    tracker.registerReadySignal({
      item: longItem,
      referenceCandle: longCandles[longCandles.length - 1],
      persistenceStatus: "LOCAL_ONLY",
    });

    const stats = tracker.computeCohortStatistics();
    expect(stats.LONG_CLEAN.totalSignals).toBe(1);
    expect(stats.LONG_CLEAN.untriggeredRatePct).toBe(100);
    expect(stats.LONG_CLEAN.sampleSufficiencyVerdict).toBe("INSUFFICIENT_SAMPLE_FOR_SIGNIFICANCE");
    expect(stats.LONG_CLEAN.statisticalDisclaimer).toContain("Do not claim profitability or statistical significance");

    const persistRes = await tracker.persistForwardLedger();
    expect(persistRes.persistenceStatus).toBe("LOCAL_ONLY");
    expect(persistRes.remoteTablesAvailable).toBe(false);
    expect(persistRes.snapshotsSavedLocally).toBe(1);
  });
});

