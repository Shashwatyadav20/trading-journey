import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { FourHourCandle } from "../prebreakout/Strategy03FourHourCandleProvider.js";
import { evaluateFourHourPreBreakout } from "../prebreakout/Strategy03FourHourPreBreakoutScanner.js";
import { Strategy03FourHourForwardOutcomeTracker } from "../prebreakout/Strategy03FourHourForwardOutcomeTracker.js";
import {
  classifyMaturityBucket,
  isValidOhlcvGeometry,
  Strategy03ForwardMaturityAudit,
} from "../prebreakout/Strategy03ForwardMaturityAudit.js";
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

describe("Strategy 03 Phase 6.10.19.18 — Forward Data Maturity Monitoring & 12-Point Independent Audit", () => {
  const tempDirs: string[] = [];

  function makeTempDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "s03_p6101918_"));
    tempDirs.push(dir);
    return dir;
  }

  afterEach(() => {
    for (const d of tempDirs.splice(0)) {
      fs.rmSync(d, { recursive: true, force: true });
    }
  });

  it("1-10. tests 0-bar NULL handling, 1-bar, 5B, 10B, and 20B maturity buckets, breakout-before-invalidation, invalidation-before-breakout, pending signal, and cohort separation", () => {
    const dir = makeTempDir();
    const tracker = new Strategy03FourHourForwardOutcomeTracker(path.join(dir, "snap"));
    const audit = new Strategy03ForwardMaturityAudit(path.join(dir, "audit"));

    // Create 3 snapshots across SHORT_HIGH_QUALITY, MEDIUM_CLEAN, LONG_CLEAN
    const sShort = makeReadySeries(7);
    const itemShort = evaluateFourHourPreBreakout({
      nseSymbol: "CORALFINAC",
      companyName: "Coral Finance",
      candles: sShort,
      dataProvider: "4H",
      sourceReference: "cache4h/CORALFINAC_4h.json",
    });
    const snapShort = tracker.registerReadySignal({
      item: itemShort,
      referenceCandle: sShort[sShort.length - 1],
      persistenceStatus: "REMOTE_SYNCED",
    }).snapshot!;

    const sMed = makeReadySeries(12);
    const itemMed = evaluateFourHourPreBreakout({
      nseSymbol: "ANANDRATHI",
      companyName: "Anand Rathi",
      candles: sMed,
      dataProvider: "4H",
      sourceReference: "cache4h/ANANDRATHI_4h.json",
    });
    const snapMed = tracker.registerReadySignal({
      item: itemMed,
      referenceCandle: sMed[sMed.length - 1],
      persistenceStatus: "REMOTE_SYNCED",
    }).snapshot!;

    const sLong = makeReadySeries(18);
    const itemLong = evaluateFourHourPreBreakout({
      nseSymbol: "TORNTPHARM",
      companyName: "Torrent",
      candles: sLong,
      dataProvider: "4H",
      sourceReference: "cache4h/TORNTPHARM_4h.json",
    });
    const snapLong = tracker.registerReadySignal({
      item: itemLong,
      referenceCandle: sLong[sLong.length - 1],
      persistenceStatus: "REMOTE_SYNCED",
    }).snapshot!;

    // 1. Zero post-signal candles (T+0) -> MFE/MAE strictly NULL, STILL_PENDING
    const eval0 = audit.evaluateSignalForwardMaturity({
      snapshot: snapLong,
      rawCandles: sLong,
      evaluationNow: new Date(Date.parse(snapLong.signalCompleted4hTimestampUtc) + 3_600_000),
    });
    expect(eval0.evaluation.postSignalCompletedCandleCount).toBe(0);
    expect(eval0.evaluation.maturityBucket).toBe("T+0");
    expect(eval0.evaluation.mfePct).toBeNull();
    expect(eval0.evaluation.maePct).toBeNull();
    expect(eval0.evaluation.stillPending).toBe(true);
    expect(eval0.evaluation.outcomeClassification).toBe("STILL_PENDING");

    // 2. One valid post-signal candle (T+1_TO_T+4), still pending
    const fut1 = makeFutureCompletedBars(snapShort.signalCompleted4hTimestampUtc, 1);
    const eval1 = audit.evaluateSignalForwardMaturity({
      snapshot: snapShort,
      rawCandles: [...sShort, ...fut1],
      evaluationNow: new Date(Date.parse(fut1[0].timestamp) + 3_600_000),
    });
    expect(eval1.evaluation.postSignalCompletedCandleCount).toBe(1);
    expect(eval1.evaluation.maturityBucket).toBe("T+1_TO_T+4");
    expect(eval1.evaluation.maturedTo1To4Bars).toBe(true);
    expect(eval1.evaluation.mfePct).not.toBeNull();
    expect(eval1.evaluation.maePct).not.toBeNull();

    // 3, 4, 5 & 6. Five-bar, Ten-bar, Twenty-bar maturity + Breakout before invalidation
    const fut20Brk = makeFutureCompletedBars(snapShort.signalCompleted4hTimestampUtc, 20, {
      3: { high: 111.0, close: 110.5 }, // breakout at bar 3 (> 108.0)
      8: { low: 103.0, close: 104.0 }, // later dip below consLow at bar 8 after breakout
      10: { high: 114.0, close: 113.0 },
      20: { high: 116.0, close: 115.0 },
    });
    expect(classifyMaturityBucket(5)).toBe("5B");
    expect(classifyMaturityBucket(10)).toBe("10B");
    expect(classifyMaturityBucket(20)).toBe("20B");

    const eval20Brk = audit.evaluateSignalForwardMaturity({
      snapshot: snapShort,
      rawCandles: [...sShort, ...fut20Brk],
      evaluationNow: new Date(Date.parse(fut20Brk[19].timestamp) + 3_600_000),
    });
    expect(eval20Brk.evaluation.postSignalCompletedCandleCount).toBe(20);
    expect(eval20Brk.evaluation.maturityBucket).toBe("20B");
    expect(eval20Brk.evaluation.maturedTo5B).toBe(true);
    expect(eval20Brk.evaluation.maturedTo10B).toBe(true);
    expect(eval20Brk.evaluation.maturedTo20B).toBe(true);
    expect(eval20Brk.evaluation.breakoutBeforeInvalidation).toBe(true);
    expect(eval20Brk.evaluation.invalidationBeforeBreakout).toBe(false);
    expect(eval20Brk.evaluation.outcomeClassification).toBe("BREAKOUT_FIRST");
    expect(eval20Brk.evaluation.outcome5B.statusAtHorizon).toBe("BREAKOUT_FIRST");
    expect(eval20Brk.evaluation.outcome10B.statusAtHorizon).toBe("BREAKOUT_FIRST");
    expect(eval20Brk.evaluation.outcome20B.statusAtHorizon).toBe("BREAKOUT_FIRST");

    // 7. Invalidation before breakout (MEDIUM_CLEAN)
    const fut6Inv = makeFutureCompletedBars(snapMed.signalCompleted4hTimestampUtc, 6, {
      2: { low: 104.0, close: 104.5 }, // invalidation at bar 2 (< 105.5)
      4: { high: 112.0, close: 111.5 }, // later move above consHigh at bar 4
    });
    const evalInv = audit.evaluateSignalForwardMaturity({
      snapshot: snapMed,
      rawCandles: [...sMed, ...fut6Inv],
      evaluationNow: new Date(Date.parse(fut6Inv[5].timestamp) + 3_600_000),
    });
    expect(evalInv.evaluation.maturityBucket).toBe("5B");
    expect(evalInv.evaluation.invalidationBeforeBreakout).toBe(true);
    expect(evalInv.evaluation.breakoutBeforeInvalidation).toBe(false);
    expect(evalInv.evaluation.outcomeClassification).toBe("INVALIDATION_FIRST");
    expect(evalInv.evaluation.outcome5B.statusAtHorizon).toBe("INVALIDATION_FIRST");
    expect(evalInv.evaluation.outcome10B.reached).toBe(false);

    // 18 & 19. Cohort-specific aggregation & NULL handling for immature LONG_CLEAN cohort
    const dash = audit.buildCohortDashboard([
      eval20Brk.evaluation,
      evalInv.evaluation,
      eval0.evaluation,
    ]);
    expect(dash.SHORT_HIGH_QUALITY.outcomes.breakoutFirstCount).toBe(1);
    expect(dash.MEDIUM_CLEAN.outcomes.invalidationFirstCount).toBe(1);
    expect(dash.LONG_CLEAN.outcomes.stillPendingCount).toBe(1);
    expect(dash.LONG_CLEAN.performance.meanMfePct).toBeNull();
    expect(dash.LONG_CLEAN.performance.breakoutFirstRateAmongMatured1BPct).toBeNull();
  });

  it("11-20. rejects duplicate, incomplete, pre-signal, invalid OHLC, missing volume, and future (look-ahead) candles; handles stale data, Supabase unavailability, WAL & restart recovery, and safety locks", async () => {
    const dir = makeTempDir();
    const tracker = new Strategy03FourHourForwardOutcomeTracker(path.join(dir, "snap"));
    const audit = new Strategy03ForwardMaturityAudit(path.join(dir, "audit"));

    const s0 = makeReadySeries(7);
    const item = evaluateFourHourPreBreakout({
      nseSymbol: "SUNPHARMA",
      companyName: "Sun Pharma",
      candles: s0,
      dataProvider: "4H",
      sourceReference: "cache4h/SUNPHARMA_4h.json",
    });
    const snap = tracker.registerReadySignal({
      item,
      referenceCandle: s0[s0.length - 1],
      persistenceStatus: "LOCAL_ONLY",
    }).snapshot!;

    const baseMs = Date.parse(snap.signalCompleted4hTimestampUtc);
    const evalNow = new Date(baseMs + 10 * 4 * 3_600_000);

    const validBar1: FourHourCandle = {
      timeframe: "4H",
      timestamp: new Date(baseMs + 1 * 4 * 3_600_000).toISOString(),
      open: 107.0,
      high: 108.0,
      low: 106.5,
      close: 107.5,
      volume: 50_000,
      isComplete: true,
      constituentBarCount: 4,
    };
    const duplicateBar1: FourHourCandle = { ...validBar1 };
    const incompleteBar: FourHourCandle = {
      ...validBar1,
      timestamp: new Date(baseMs + 2 * 4 * 3_600_000).toISOString(),
      isComplete: false,
    };
    const invalidOhlcBar: FourHourCandle = {
      ...validBar1,
      timestamp: new Date(baseMs + 3 * 4 * 3_600_000).toISOString(),
      high: 105.0,
      low: 109.0, // low > high
    };
    const missingVolumeBar: FourHourCandle = {
      ...validBar1,
      timestamp: new Date(baseMs + 4 * 4 * 3_600_000).toISOString(),
      volume: 0, // invalid 0 volume
    };
    const futureLookaheadBar: FourHourCandle = {
      ...validBar1,
      timestamp: new Date(evalNow.getTime() + 24 * 3_600_000).toISOString(), // > evalNow
      high: 200,
      close: 195,
    };

    expect(isValidOhlcvGeometry(invalidOhlcBar).reason).toBe("INVALID_OHLC_GEOMETRY");
    expect(isValidOhlcvGeometry(missingVolumeBar).reason).toBe("MISSING_OR_INVALID_VOLUME");

    const res = audit.evaluateSignalForwardMaturity({
      snapshot: snap,
      rawCandles: [
        ...s0, // 29 pre-signal / at-signal candles
        validBar1,
        duplicateBar1,
        incompleteBar,
        invalidOhlcBar,
        missingVolumeBar,
        futureLookaheadBar,
      ],
      evaluationNow: evalNow,
      maxDataAgeHours: 1, // force STALE freshness check
    });

    expect(res.preSignalFilteredCount).toBe(s0.length);
    expect(res.evaluation.postSignalCompletedCandleCount).toBe(1);
    expect(res.duplicatePostSignalCount).toBe(1);
    expect(res.evaluation.dataQuality.freshness).toBe("STALE");

    const reasons = res.rejectedPostSignalCandles.map((r) => r.rejectionReason);
    expect(reasons).toContain("DUPLICATE_TIMESTAMP");
    expect(reasons).toContain("INCOMPLETE_4H_CANDLE");
    expect(reasons).toContain("INVALID_OHLC_GEOMETRY");
    expect(reasons).toContain("MISSING_OR_INVALID_VOLUME");
    expect(reasons).toContain("FUTURE_TIMESTAMP_BEYOND_EVALUATION_NOW");

    // 15 & 16. Supabase unavailable -> writes WAL and returns LOCAL_ONLY
    const persistOffline = await audit.persistAppendOnlyObservations({
      serviceClient: null,
    });
    expect(persistOffline.persistenceStatus).toBe("LOCAL_ONLY");
    expect(persistOffline.walPendingCount).toBe(1);

    // 17. Restart recovery loads append-only observation without duplicating
    const restartedAudit = new Strategy03ForwardMaturityAudit(path.join(dir, "audit"));
    expect(restartedAudit.getAppendOnlyObservations()).toHaveLength(1);

    // Online Supabase client clears WAL and returns REMOTE_SYNCED
    const mockOnlineSb: any = {
      from() {
        return {
          select() {
            return {
              limit: async () => ({ data: [{ run_id: "r1" }], error: null }),
            };
          },
        };
      },
    };
    const persistOnline = await restartedAudit.persistAppendOnlyObservations({
      serviceClient: mockOnlineSb as SupabaseClient,
    });
    expect(persistOnline.persistenceStatus).toBe("REMOTE_SYNCED");
    expect(persistOnline.walPendingCount).toBe(0);

    // Safety locks remain OFF
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

