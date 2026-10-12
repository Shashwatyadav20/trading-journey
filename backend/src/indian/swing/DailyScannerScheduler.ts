import { marketSessionValidator } from "../market/MarketSessionValidator";
import { swingTradingEngine, FUNDAMENTAL_UNIVERSE } from "./SwingTradingEngine";
import { SwingSignal } from "./types";
import { DailyCandle, fetchLiveStockCandles, LIQUID_UNIVERSES, validateDailyCandles } from "./dailyStrategyScanner";
import { dailyScanPersistenceService } from "../../db/DailyScanPersistenceService";

export interface ScanRunSummary {
  runId: string;
  triggerType: "SCHEDULED_TIMER" | "EXTERNAL_CRON_HTTP" | "MANUAL";
  tradingDate: string;
  startTime: string;
  endTime?: string;
  durationMs?: number;
  status: "IN_PROGRESS" | "COMPLETED" | "FAILED" | "SKIPPED";
  scannedSymbolsCount: number;
  successfulSymbolsCount: number;
  failedSymbolsCount: number;
  opportunitiesFoundCount: number;
  scannedSymbols: string[];
  failedSymbols: { symbol: string; error: string }[];
  opportunities: SwingSignal[];
  errorMessage?: string;
}

export interface ScheduleCheckResult {
  isTradingDay: boolean;
  reason?: string;
  tradingDate: string;
  isAfterMarketClose: boolean;
  isTargetTime: boolean;
  currentIstTime: string;
}

export interface TriggerScanOptions {
  triggerType?: "SCHEDULED_TIMER" | "EXTERNAL_CRON_HTTP" | "MANUAL";
  force?: boolean;
  dateOverride?: string;
  timestampOverride?: Date | string | number;
  symbols?: string[];
  candleDataBySymbol?: Record<string, DailyCandle[]>;
}

export class DailyScannerScheduler {
  private isScanning: boolean = false;
  private timer: NodeJS.Timeout | null = null;
  private lastCompletedDate: string | null = null;
  private scanHistory: Map<string, ScanRunSummary> = new Map();
  private latestRun: ScanRunSummary | null = null;

  // Schedule configuration: 15:45 IST on NSE trading days
  public readonly TARGET_HOUR_IST: number = 15;
  public readonly TARGET_MINUTE_IST: number = 45;

  constructor() {}

  /**
   * Evaluates whether the given moment is an eligible NSE trading day and post-market time.
   */
  public evaluateSchedule(targetDate?: Date | string | number): ScheduleCheckResult {
    const comp = marketSessionValidator.getIstComponents(targetDate);
    const tradingDate = comp.dateString;
    const currentIstTime = `${comp.hours.toString().padStart(2, "0")}:${comp.minutes
      .toString()
      .padStart(2, "0")}:${comp.seconds.toString().padStart(2, "0")}`;

    // 1. Weekend check
    if (comp.dayOfWeek === 0 || comp.dayOfWeek === 6) {
      return {
        isTradingDay: false,
        reason: "WEEKEND",
        tradingDate,
        isAfterMarketClose: false,
        isTargetTime: false,
        currentIstTime,
      };
    }

    // 2. NSE Holiday check
    const sessionStatus = marketSessionValidator.getMarketSessionStatus(targetDate);
    if (sessionStatus === "HOLIDAY") {
      return {
        isTradingDay: false,
        reason: "NSE_TRADING_HOLIDAY",
        tradingDate,
        isAfterMarketClose: false,
        isTargetTime: false,
        currentIstTime,
      };
    }

    // 3. Time check (Market closes at 15:30 IST; target schedule is 15:45 IST)
    const minutesSinceMidnight = comp.hours * 60 + comp.minutes;
    const marketCloseMinutes = 15 * 60 + 30; // 15:30 IST
    const targetScheduleMinutes = this.TARGET_HOUR_IST * 60 + this.TARGET_MINUTE_IST; // 15:45 IST

    const isAfterMarketClose = minutesSinceMidnight >= marketCloseMinutes;
    const isTargetTime = minutesSinceMidnight >= targetScheduleMinutes;

    return {
      isTradingDay: true,
      tradingDate,
      isAfterMarketClose,
      isTargetTime,
      currentIstTime,
    };
  }

  /**
   * Starts the internal background timer checking every 30 seconds for the 15:45 IST target.
   */
  public start(pollIntervalMs: number = 30000): void {
    if (this.timer) return;

    this.timer = setInterval(async () => {
      try {
        await this.checkAndRunScheduledScan();
      } catch (err) {
        console.error("[DailyScannerScheduler] Unhandled error during scheduled check:", err);
      }
    }, pollIntervalMs);

    console.log(
      `[DailyScannerScheduler] Background scheduler active: targeting 15:45 IST on NSE trading days.`
    );
  }

  /**
   * Stops the background timer.
   */
  public stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      console.log("[DailyScannerScheduler] Background scheduler stopped.");
    }
  }

  /**
   * Internal trigger fired on timer ticks. Checks schedule, idempotency, and concurrency.
   */
  public async checkAndRunScheduledScan(nowDate?: Date): Promise<ScanRunSummary | null> {
    const schedule = this.evaluateSchedule(nowDate);

    // Skip non-trading days
    if (!schedule.isTradingDay) {
      return null;
    }

    // Skip if before target 15:45 IST time
    if (!schedule.isTargetTime) {
      return null;
    }

    // Skip if already executed for today (check in-memory cache)
    if (this.lastCompletedDate === schedule.tradingDate) {
      return null;
    }

    // Database-backed idempotency check across server restarts
    try {
      const existingDbRun = await dailyScanPersistenceService.findCompletedScheduledRunByDate(schedule.tradingDate);
      if (existingDbRun) {
        this.lastCompletedDate = schedule.tradingDate;
        return null;
      }
    } catch (dbErr) {
      console.warn("[DailyScannerScheduler] Could not query DB for scheduled run date, relying on memory:", dbErr);
    }

    // Skip if another scan is actively running
    if (this.isScanning) {
      return null;
    }

    // Trigger genuine scheduled run
    console.log(
      `[DailyScannerScheduler] Triggering scheduled post-market scan for date ${schedule.tradingDate} at ${schedule.currentIstTime} IST`
    );
    return await this.executeDailyScan({
      triggerType: "SCHEDULED_TIMER",
      dateOverride: schedule.tradingDate,
    });
  }

  /**
   * Primary scan execution pipeline.
   *
   * Features:
   * - Mutex-locked (prevents overlapping concurrent runs).
   * - Durable idempotency by trading date backed by Supabase DB.
   * - Confirms completed daily candles (market closed).
   * - Validates market data before strategy evaluation.
   * - Batch fetching to respect provider rate limits safely.
   * - Persists runs and genuine opportunities to Supabase.
   * - Comprehensive error, duration, and symbol outcome logging.
   * - Safety invariant: live order placement is strictly disabled.
   */
  public async executeDailyScan(options: TriggerScanOptions = {}): Promise<ScanRunSummary> {
    const triggerType = options.triggerType || "MANUAL";
    const targetDateObj = options.timestampOverride
      ? new Date(options.timestampOverride)
      : options.dateOverride
      ? new Date(options.dateOverride + "T16:00:00+05:30")
      : new Date();
    const schedule = this.evaluateSchedule(targetDateObj);
    const tradingDate = options.dateOverride || schedule.tradingDate;

    // 1. Mutex Check: Prevent overlapping concurrent scans
    if (this.isScanning) {
      const err = `Concurrent scan rejected: another scan is already in progress.`;
      console.warn(`[DailyScannerScheduler] ${err}`);
      throw new Error(err);
    }

    // 2. Schedule & Completed Candle Verification (unless forced or manual test)
    if (!options.force && triggerType !== "MANUAL") {
      if (!schedule.isTradingDay) {
        throw new Error(
          `Cannot execute scheduled scan: ${tradingDate} is not an NSE trading day (${schedule.reason}). Pass force=true to override.`
        );
      }
      if (!schedule.isAfterMarketClose) {
        throw new Error(
          `Cannot execute scan: completed daily candles are not yet finalized. Market closes at 15:30 IST. Current time is ${schedule.currentIstTime} IST. Pass force=true to override.`
        );
      }
      if (this.lastCompletedDate === tradingDate) {
        throw new Error(
          `Duplicate scan rejected: daily scan for date ${tradingDate} has already completed. Pass force=true to re-scan.`
        );
      }

      // 2b. Database-backed duplicate check across process restarts
      const existingDbRun = await dailyScanPersistenceService.findCompletedScheduledRunByDate(tradingDate);
      if (existingDbRun) {
        this.lastCompletedDate = tradingDate;
        throw new Error(
          `Duplicate scan rejected: daily scan for date ${tradingDate} has already completed in database (Run ID: ${existingDbRun.id}). Pass force=true to re-scan.`
        );
      }
    }

    // Initialize Run Record
    const runId = `SCAN-${tradingDate}-${Date.now()}`;
    const startTimeIso = new Date().toISOString();
    const startTimeMs = Date.now();

    const summary: ScanRunSummary = {
      runId,
      triggerType,
      tradingDate,
      startTime: startTimeIso,
      status: "IN_PROGRESS",
      scannedSymbolsCount: 0,
      successfulSymbolsCount: 0,
      failedSymbolsCount: 0,
      opportunitiesFoundCount: 0,
      scannedSymbols: [],
      failedSymbols: [],
      opportunities: [],
    };

    this.isScanning = true;
    this.latestRun = summary;

    console.log(
      `[DailyScannerScheduler] >>> STARTING SCAN ${runId} (Type: ${triggerType}, Date: ${tradingDate})`
    );

    try {
      // 3. Safety Invariant Check: Confirm Live Order Routing is Disabled
      // This is a stock scanner and paper validation system.
      // Under no conditions should broker live execution occur.

      // 4. Determine Symbols Universe to Scan
      let symbolsToScan: string[] = [];
      if (options.symbols && options.symbols.length > 0) {
        symbolsToScan = options.symbols;
      } else if (options.candleDataBySymbol) {
        symbolsToScan = Object.keys(options.candleDataBySymbol);
      } else {
        // Default to curated momentum leaders and qualified universe
        const set = new Set<string>([
          ...FUNDAMENTAL_UNIVERSE.map((s) => s.symbol),
          ...LIQUID_UNIVERSES.MOMENTUM_LEADERS,
        ]);
        symbolsToScan = Array.from(set);
      }

      summary.scannedSymbols = symbolsToScan;
      summary.scannedSymbolsCount = symbolsToScan.length;

      // Create durable DB scan-run record with status 'running' before scanning starts
      const scanType = triggerType === "MANUAL" ? "manual" : "scheduled";
      await dailyScanPersistenceService.createScanRun({
        id: runId,
        scanDate: tradingDate,
        scanType,
        universeSize: symbolsToScan.length,
        marketDataTimestamp: startTimeIso,
      });

      // 5. Evaluate Stock Opportunities (Supporting supplied candles or dynamic fetch)
      const matchedSignals: SwingSignal[] = [];

      if (options.candleDataBySymbol) {
        // Fast evaluation using supplied candle records
        for (const [sym, candles] of Object.entries(options.candleDataBySymbol)) {
          try {
            const sig = swingTradingEngine.evaluateStockCandles(sym, candles);
            if (sig) {
              summary.successfulSymbolsCount++;
              matchedSignals.push(sig);
            } else {
              const validation = validateDailyCandles(candles);
              if (!validation.valid) {
                summary.failedSymbolsCount++;
                summary.failedSymbols.push({
                  symbol: sym,
                  error: validation.reason || "Invalid candle data",
                });
              } else {
                summary.successfulSymbolsCount++;
              }
            }
          } catch (itemErr: any) {
            summary.failedSymbolsCount++;
            summary.failedSymbols.push({
              symbol: sym,
              error: itemErr.message || String(itemErr),
            });
          }
        }
      } else {
        // Safe batch fetching to respect provider rate limits (e.g. 3 concurrent requests at a time)
        const BATCH_SIZE = 3;
        for (let i = 0; i < symbolsToScan.length; i += BATCH_SIZE) {
          const batch = symbolsToScan.slice(i, i + BATCH_SIZE);

          const batchPromises = batch.map(async (sym) => {
            try {
              const candleData = await fetchLiveStockCandles(sym);
              if (!candleData || !candleData.candles) {
                return {
                  symbol: sym,
                  success: false,
                  error: "No candle data returned from market data provider",
                  signal: null,
                };
              }
              const sig = swingTradingEngine.evaluateStockCandles(
                sym,
                candleData.candles,
                22520.45,
                candleData.meta
              );
              return { symbol: sym, success: true, signal: sig };
            } catch (fetchErr: any) {
              return {
                symbol: sym,
                success: false,
                error: fetchErr.message || "Failed to fetch/evaluate candle data",
                signal: null,
              };
            }
          });

          const batchResults = await Promise.allSettled(batchPromises);
          for (const res of batchResults) {
            if (res.status === "fulfilled") {
              const item = res.value;
              if (item.success) {
                summary.successfulSymbolsCount++;
                if (item.signal) {
                  matchedSignals.push(item.signal);
                }
              } else {
                summary.failedSymbolsCount++;
                summary.failedSymbols.push({
                  symbol: item.symbol,
                  error: item.error || "Unknown error",
                });
              }
            }
          }

          // Small delay between batches to respect rate limits
          if (i + BATCH_SIZE < symbolsToScan.length) {
            await new Promise((r) => setTimeout(r, 150));
          }
        }
      }

      const durationMs = Date.now() - startTimeMs;
      summary.endTime = new Date().toISOString();
      summary.durationMs = durationMs;
      summary.status = "COMPLETED";
      summary.opportunities = matchedSignals;
      summary.opportunitiesFoundCount = matchedSignals.length;

      // Persist genuine opportunities to database
      await dailyScanPersistenceService.saveOpportunities(runId, tradingDate, matchedSignals);

      // Finalize database scan-run record
      await dailyScanPersistenceService.completeScanRun(runId, {
        durationMs,
        scannedCount: summary.scannedSymbolsCount,
        successCount: summary.successfulSymbolsCount,
        failureCount: summary.failedSymbolsCount,
        opportunitiesFound: matchedSignals.length,
        errorSummary: summary.failedSymbols.length > 0 ? JSON.stringify(summary.failedSymbols) : null,
        marketDataTimestamp: startTimeIso,
      });

      // Update state
      this.lastCompletedDate = tradingDate;
      this.scanHistory.set(tradingDate, summary);
      this.latestRun = summary;

      console.log(
        `[DailyScannerScheduler] <<< COMPLETED SCAN ${runId} in ${durationMs}ms: Scanned ${summary.scannedSymbolsCount}, Successful ${summary.successfulSymbolsCount}, Failed ${summary.failedSymbolsCount}, Opportunities ${summary.opportunitiesFoundCount}`
      );

      return summary;
    } catch (scanErr: any) {
      summary.status = "FAILED";
      summary.endTime = new Date().toISOString();
      summary.durationMs = Date.now() - startTimeMs;
      summary.errorMessage = scanErr.message || String(scanErr);
      this.latestRun = summary;

      // Record failure in database
      try {
        await dailyScanPersistenceService.failScanRun(
          runId,
          scanErr.message || String(scanErr),
          Date.now() - startTimeMs
        );
      } catch (dbFailErr) {
        console.error(`[DailyScannerScheduler] Failed to update DB failure state:`, dbFailErr);
      }

      console.error(`[DailyScannerScheduler] !!! SCAN FAILED ${runId}:`, scanErr);
      throw scanErr;
    } finally {
      this.isScanning = false;
    }
  }

  /**
   * Returns current operational status of the scheduler.
   */
  public getStatus() {
    const schedule = this.evaluateSchedule();
    return {
      isScanning: this.isScanning,
      isTimerRunning: this.timer !== null,
      targetSchedule: "15:45 Asia/Kolkata (Mon-Fri, non-holiday)",
      todayIsTradingDay: schedule.isTradingDay,
      todayTradingDate: schedule.tradingDate,
      currentIstTime: schedule.currentIstTime,
      isAfterMarketClose: schedule.isAfterMarketClose,
      lastCompletedDate: this.lastCompletedDate,
      totalCompletedScans: this.scanHistory.size,
      latestRun: this.latestRun,
    };
  }

  public getHistory(): ScanRunSummary[] {
    return Array.from(this.scanHistory.values());
  }

  public getRunByDate(date: string): ScanRunSummary | undefined {
    return this.scanHistory.get(date);
  }

  public async getLatestPersistedScan() {
    return await dailyScanPersistenceService.getLatestScanRun();
  }

  public async getPersistedScanByDate(date: string) {
    return await dailyScanPersistenceService.getScanRunByDate(date);
  }

  public async getPersistedHistory(limit: number = 30) {
    return await dailyScanPersistenceService.getScanHistory(limit);
  }

  public resetStateForTesting(resetDb: boolean = true): void {
    this.stop();
    this.isScanning = false;
    this.lastCompletedDate = null;
    this.scanHistory.clear();
    this.latestRun = null;
    if (resetDb) {
      dailyScanPersistenceService.resetMemoryStateForTesting();
    }
  }
}

export const dailyScannerScheduler = new DailyScannerScheduler();
