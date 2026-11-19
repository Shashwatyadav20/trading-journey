import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { FourHourCandle } from "../prebreakout/Strategy03FourHourCandleProvider.js";
import { evaluateFourHourPreBreakout } from "../prebreakout/Strategy03FourHourPreBreakoutScanner.js";
import { Strategy03FourHourForwardOutcomeTracker } from "../prebreakout/Strategy03FourHourForwardOutcomeTracker.js";
import { Strategy03FourHourMonitoringPersistence } from "../prebreakout/Strategy03FourHourMonitoringPersistence.js";
import { Strategy03IndependentForwardValidator } from "../prebreakout/Strategy03IndependentForwardValidator.js";
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

describe("Strategy 03 Phase 6.10.19.12 — Independent Forward Validation & Statistical Audit", () => {
  const tempDirs: string[] = [];

  function makeTempDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "s03_p6101912_"));
    tempDirs.push(dir);
    return dir;
  }

  afterEach(() => {
    for (const d of tempDirs.splice(0)) {
      fs.rmSync(d, { recursive: true, force: true });
    }
  });

  it("1-6. rejects pre-signal, incomplete, 1H, and duplicate candles; detects snapshot mutation; verifies breakout/invalidation ordering and independent MFE/MAE + 5B/10B/20B recalculation", () => {
    const dir = makeTempDir();
    const tracker = new Strategy03FourHourForwardOutcomeTracker(dir);
    const validator = new Strategy03IndependentForwardValidator();

    const s0 = makeReadySeries(7);
    const item = evaluateFourHourPreBreakout({
      nseSymbol: "SUNPHARMA",
      companyName: "Sun Pharma",
      candles: s0,
      dataProvider: "4H",
      sourceReference: "cache4h/SUNPHARMA_4h.json",
    });
    const refBar = s0[s0.length - 1];
    const reg = tracker.registerReadySignal({
      item,
      referenceCandle: refBar,
      persistenceStatus: "LOCAL_ONLY",
    });
    const snap = reg.snapshot!;

    // Inject 1H candle, incomplete candle, and duplicate post-signal candle
    const future20 = makeFutureCompletedBars(refBar.timestamp, 20, {
      3: { low: 105.9, close: 106.4 },
      6: { high: 112.0, close: 111.5 }, // first confirmed breakout at block 6
      10: { high: 115.0, close: 114.2 },
    });
    const oneHourFake: FourHourCandle = {
      ...future20[0],
      timeframe: "1H" as any,
      high: 200,
      close: 199,
    };
    const incompleteFake: FourHourCandle = {
      ...future20[1],
      timestamp: new Date(Date.parse(refBar.timestamp) + 21 * 4 * 3_600_000).toISOString(),
      isComplete: false,
      low: 50,
      close: 55,
    };
    const duplicatePostBar: FourHourCandle = {
      ...future20[5], // duplicate of block 6 timestamp
      high: 300,
    };

    const rec = validator.recalculateSignalOutcome({
      snapshot: snap,
      rawSourceCandles: [...s0, oneHourFake, incompleteFake, ...future20, duplicatePostBar],
    });

    // 1. Pre-signal candles rejected (all 29 candles in s0 are <= signal timestamp)
    expect(rec.rejectedPreOrEqualSignalCandlesCount).toBe(s0.length);
    // 2. Incomplete and 1H candles rejected
    expect(rec.rejectedNon4hCandlesCount).toBe(1);
    expect(rec.rejectedIncompleteCandlesCount).toBe(1);
    // 3. Duplicate post-signal candle rejected
    expect(rec.rejectedDuplicatePostSignalCandlesCount).toBe(1);
    expect(rec.postSignalCompleted4hCount).toBe(20);

    // 5 & 6. Breakout ordering + MFE/MAE + 5B/10B/20B horizon recalculation
    expect(rec.independentRawStatus).toBe("CONFIRMED_BREAKOUT");
    expect(rec.firstConfirmedBreakout.occurred).toBe(true);
    expect(rec.firstConfirmedBreakout.blocksToBreakout).toBe(6);
    expect(rec.invalidationBeforeBreakout.occurred).toBe(false);
    expect(rec.horizon5B.statusAtHorizon).toBe("UNTRIGGERED");
    expect(rec.horizon10B.statusAtHorizon).toBe("BREAKOUT");
    expect(rec.horizon20B.statusAtHorizon).toBe("BREAKOUT");
    expect(rec.mfePct).toBeCloseTo(7.28, 2); // (115 - 107.2)/107.2
    expect(rec.maePct).toBeCloseTo(-1.21, 2); // (105.9 - 107.2)/107.2

    // 4. Snapshot mutation detection when reference OHLCV does not match raw source candle
    const mutatedSnap = {
      ...snap,
      reference4hOhlcv: { ...snap.reference4hOhlcv, close: 999.99 },
    };
    const recMutated = validator.recalculateSignalOutcome({
      snapshot: mutatedSnap,
      rawSourceCandles: s0,
    });
    expect(recMutated.candleDataStatus).toBe("REFERENCE_CANDLE_MISMATCH");
  });

  it("7-10. excludes immature T+0 signals from rate denominators, enforces CI & sample-sufficiency guards, preserves LOCAL_ONLY & WAL recovery, and confirms safety locks", async () => {
    const dir = makeTempDir();
    const tracker = new Strategy03FourHourForwardOutcomeTracker(dir);
    const validator = new Strategy03IndependentForwardValidator();

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
    tracker.evaluateForwardOutcomeForSignal({
      signalId: reg.snapshot!.signalId,
      candles: s0, // 0 post-signal bars (T+0)
    });
    await tracker.persistForwardLedger();

    // 7 & 8. Audit flags T+0 immature denominator and sets audited rates/CIs/MFE/MAE to null
    const report = validator.runFullIndependentAudit({
      snapshots: tracker.getAllSnapshots(),
      storedOutcomes: tracker.getAllOutcomes(),
      storedCohortStats: tracker.computeCohortStatistics(),
      loadCandlesBySymbol: () => s0,
      now: new Date(Date.parse(refBar.timestamp) + 3_600_000),
      persistenceStatus: "LOCAL_ONLY",
      remoteTablesAvailable: false,
      remoteBlockerCode: "PGRST205",
      remoteBlockerMessage: "Table not in schema cache",
      walRecoveryPreserved: true,
      snapshotsFileExists: true,
      outcomesFileExists: true,
    });

    expect(report.allIntegrityChecksPassed).toBe(true);
    expect(report.candleCalculationMismatchCount).toBe(0);
    expect(report.methodologyImmatureDenominatorMismatchCount).toBe(1);

    const medAudit = report.auditedCohortStatistics.MEDIUM_CLEAN;
    expect(medAudit.totalCapturedSignals).toBe(1);
    expect(medAudit.maturityDistribution.pendingZeroPostBars).toBe(1);
    expect(medAudit.maturityDistribution.atLeast1PostBlock).toBe(0);
    expect(medAudit.ratesAmongMaturedAtLeast1B.denominator).toBe(0);
    expect(medAudit.ratesAmongMaturedAtLeast1B.breakoutRatePct).toBeNull();
    expect(medAudit.ratesAmongMaturedAtLeast1B.breakoutRate95Ci).toBeNull();
    expect(medAudit.ratesAmongMaturedAtLeast1B.untriggeredMaturedRatePct).toBeNull();
    expect(medAudit.mfeMaeAmongMaturedAtLeast1B.meanMfePct).toBeNull();
    expect(medAudit.sampleSufficiencyVerdict).toBe("INSUFFICIENT_MATURED_SAMPLE_ZERO_POST_BARS");

    // 9. LOCAL_ONLY and WAL recovery behavior preserved
    const monPersistence = new Strategy03FourHourMonitoringPersistence(dir, () => null);
    const pStatus = await monPersistence.reconcileLocalAndRemote();
    expect(pStatus.persistenceStatus).toBe("LOCAL_ONLY");
    expect(pStatus.remoteTablesAvailable).toBe(false);

    // 10. No execution path or safety-lock regression
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

