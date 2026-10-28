import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { dailyScannerScheduler, DailyScannerScheduler } from "../swing/DailyScannerScheduler";
import { DailyCandle } from "../swing/dailyStrategyScanner";
import { brokerSafetyLock } from "../security/BrokerSafetyLock";
import { setSupabaseConfiguredOverride } from "../../db/supabaseClient";

// Helper to make mock daily candles
function makeSampleCandles(count: number, basePrice: number, isBreakout: boolean = false): DailyCandle[] {
  const candles: DailyCandle[] = [];
  let price = basePrice;
  const startDate = new Date("2026-01-01");

  for (let i = 0; i < count; i++) {
    const d = new Date(startDate);
    d.setDate(startDate.getDate() + i);
    const dateStr = d.toISOString().split("T")[0];

    const open = price;
    const close = price + 2.0;
    const high = close + 3.0;
    const low = open - 1.0;
    const volume = 100000;

    candles.push({ date: dateStr, open, high, low, close, volume });
    price = close;
  }

  if (isBreakout && candles.length > 0) {
    const last = candles[candles.length - 1];
    candles.push({
      date: "2026-02-15",
      open: last.close,
      high: last.close + 25,
      low: last.close - 1,
      close: last.close + 20,
      volume: 350000, // 3.5x volume expansion
    });
  }

  return candles;
}

describe("Task 2: Daily Stock Scanner Scheduler Suite", () => {
  beforeEach(() => {
    // Force in-memory mode: ensures tests never contact the real Supabase database.
    setSupabaseConfiguredOverride(false);
    dailyScannerScheduler.resetStateForTesting();
  });

  afterEach(() => {
    // Restore real env-var check so other test files are not affected.
    setSupabaseConfiguredOverride(null);
    dailyScannerScheduler.resetStateForTesting();
  });

  // 1. Invokes the existing dynamic scanner
  it("invokes the existing dynamic scanner and returns a complete ScanRunSummary", async () => {
    const breakoutCandles = makeSampleCandles(30, 2000, true);
    const summary = await dailyScannerScheduler.executeDailyScan({
      triggerType: "MANUAL",
      force: true,
      candleDataBySymbol: {
        TRENT: breakoutCandles,
      },
    });

    expect(summary.status).toBe("COMPLETED");
    expect(summary.runId).toContain("SCAN-");
    expect(summary.triggerType).toBe("MANUAL");
    expect(summary.scannedSymbolsCount).toBe(1);
    expect(summary.successfulSymbolsCount).toBe(1);
    expect(summary.failedSymbolsCount).toBe(0);
    expect(summary.opportunitiesFoundCount).toBe(1);
    expect(summary.opportunities[0].symbol).toBe("TRENT");
    expect(summary.durationMs).toBeGreaterThanOrEqual(0);
  });

  // 2. No scan runs on configured non-trading days
  describe("Calendar & Non-Trading Day Enforcement", () => {
    it("identifies weekends as non-trading days and rejects scheduled scans", async () => {
      // 2026-10-18 is a Sunday
      const sundayDate = new Date("2026-10-18T16:00:00+05:30");
      const sched = dailyScannerScheduler.evaluateSchedule(sundayDate);

      expect(sched.isTradingDay).toBe(false);
      expect(sched.reason).toBe("WEEKEND");

      // Attempting scheduled scan on weekend without force throws an error
      await expect(
        dailyScannerScheduler.executeDailyScan({
          triggerType: "SCHEDULED_TIMER",
          dateOverride: "2026-10-18",
          force: false,
        })
      ).rejects.toThrow(/not an NSE trading day \(WEEKEND\)/);
    });

    it("identifies official NSE trading holidays and rejects scheduled scans", async () => {
      // 2026-01-26 is Republic Day (official NSE holiday)
      const holidayDate = new Date("2026-01-26T16:00:00+05:30");
      const sched = dailyScannerScheduler.evaluateSchedule(holidayDate);

      expect(sched.isTradingDay).toBe(false);
      expect(sched.reason).toBe("NSE_TRADING_HOLIDAY");

      // Attempting scheduled scan on holiday without force throws an error
      await expect(
        dailyScannerScheduler.executeDailyScan({
          triggerType: "SCHEDULED_TIMER",
          dateOverride: "2026-01-26",
          force: false,
        })
      ).rejects.toThrow(/not an NSE trading day/);
    });

    it("identifies an active weekday post-market time as eligible for scanning", () => {
      // 2026-10-14 is Wednesday at 15:45 IST (target schedule time)
      const targetTime = new Date("2026-10-14T15:45:00+05:30");
      const sched = dailyScannerScheduler.evaluateSchedule(targetTime);

      expect(sched.isTradingDay).toBe(true);
      expect(sched.isAfterMarketClose).toBe(true);
      expect(sched.isTargetTime).toBe(true);
      expect(sched.tradingDate).toBe("2026-10-14");
    });
  });

  // 3. Duplicate execution for the same trading date is prevented
  it("prevents duplicate execution for the same trading date unless force=true is passed", async () => {
    const candles = makeSampleCandles(25, 1000);

    // First scan for 2026-10-14 succeeds
    const firstRun = await dailyScannerScheduler.executeDailyScan({
      triggerType: "EXTERNAL_CRON_HTTP",
      force: true,
      dateOverride: "2026-10-14",
      candleDataBySymbol: { STOCK1: candles },
    });
    expect(firstRun.status).toBe("COMPLETED");

    // Second scan without force is rejected
    await expect(
      dailyScannerScheduler.executeDailyScan({
        triggerType: "EXTERNAL_CRON_HTTP",
        force: false,
        dateOverride: "2026-10-14",
        candleDataBySymbol: { STOCK1: candles },
      })
    ).rejects.toThrow(/Duplicate scan rejected: daily scan for date 2026-10-14 has already completed/);

    // Second scan with force=true succeeds
    const forcedRun = await dailyScannerScheduler.executeDailyScan({
      triggerType: "EXTERNAL_CRON_HTTP",
      force: true,
      dateOverride: "2026-10-14",
      candleDataBySymbol: { STOCK1: candles },
    });
    expect(forcedRun.status).toBe("COMPLETED");
  });

  // 4. Concurrent requests cannot launch overlapping scans
  it("prevents overlapping scans via atomic concurrency mutex", async () => {
    const candles = makeSampleCandles(25, 1000);

    // Create a scheduler instance
    const scheduler = new DailyScannerScheduler();

    // Trigger an asynchronous scan that holds the lock
    const run1Promise = scheduler.executeDailyScan({
      triggerType: "MANUAL",
      force: true,
      candleDataBySymbol: { STOCK1: candles },
    });

    // Attempting a second concurrent scan immediately while first is running
    // We simulate isScanning = true
    (scheduler as any).isScanning = true;

    await expect(
      scheduler.executeDailyScan({
        triggerType: "MANUAL",
        force: true,
        candleDataBySymbol: { STOCK2: candles },
      })
    ).rejects.toThrow(/Concurrent scan rejected: another scan is already in progress/);

    // Reset lock and ensure run1 completes
    (scheduler as any).isScanning = false;
    await run1Promise;
  });

  // 5. Scanner failures are logged and reported correctly
  it("safely captures and reports individual stock failures without halting the overall scan", async () => {
    const validCandles = makeSampleCandles(25, 1500, true);
    const corruptCandles: DailyCandle[] = [{ date: "2026-01-01", open: -10, high: 0, low: 0, close: 0, volume: 0 }];

    const summary = await dailyScannerScheduler.executeDailyScan({
      triggerType: "MANUAL",
      force: true,
      candleDataBySymbol: {
        GOOD_STOCK: validCandles,
        BAD_STOCK: corruptCandles,
      },
    });

    expect(summary.status).toBe("PARTIAL");
    expect(summary.scannedSymbolsCount).toBe(2);
    expect(summary.successfulSymbolsCount).toBe(1);
    expect(summary.failedSymbolsCount).toBe(1);
    expect(summary.failedSymbols[0].symbol).toBe("BAD_STOCK");
  });

  // 6. Manual scanning still works
  it("allows manual scanning on-demand regardless of schedule timing", async () => {
    const candles = makeSampleCandles(25, 800);
    const summary = await dailyScannerScheduler.executeDailyScan({
      triggerType: "MANUAL",
      force: true,
      symbols: ["RELIANCE"],
      candleDataBySymbol: { RELIANCE: candles },
    });

    expect(summary.triggerType).toBe("MANUAL");
    expect(summary.status).toBe("COMPLETED");
    expect(summary.scannedSymbols).toContain("RELIANCE");
  });

  // 7. No live trades are submitted
  it("guarantees live order placement remains strictly disabled (0 live orders)", () => {
    // Assert broker safety lock is permanently engaged
    expect(brokerSafetyLock.isPaperTrading()).toBe(true);
    expect(brokerSafetyLock.isLiveTrading()).toBe(false);
    expect(brokerSafetyLock.isBrokerExecutionEnabled()).toBe(false);
    expect(brokerSafetyLock.getLiveBrokerOrderCount()).toBe(0);

    const status = dailyScannerScheduler.getStatus();
    expect(status.targetSchedule).toContain("15:45 Asia/Kolkata");
  });

  // 8. Completed Daily Candle Availability Check
  it("rejects scheduled scans if market is still open (before 15:30 IST)", async () => {
    // 12:00 PM IST is during active market hours
    const midMarketTime = new Date("2026-10-14T12:00:00+05:30");
    const sched = dailyScannerScheduler.evaluateSchedule(midMarketTime);

    expect(sched.isTradingDay).toBe(true);
    expect(sched.isAfterMarketClose).toBe(false);

    // Scheduled scan without force throws
    await expect(
      dailyScannerScheduler.executeDailyScan({
        triggerType: "SCHEDULED_TIMER",
        timestampOverride: "2026-10-14T12:00:00+05:30",
        force: false,
      })
    ).rejects.toThrow(/completed daily candles are not yet finalized/);
  });
});
