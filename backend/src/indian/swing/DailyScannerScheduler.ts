import { marketSessionValidator } from "../market/MarketSessionValidator";
import { swingTradingEngine } from "./SwingTradingEngine";
import { SwingSignal } from "./types";
import {
  DailyCandle,
  fetchLiveStockCandles,
  validateDailyCandles,
  fetchAllNseEquitySymbols,
  scanAllNseStocks,
} from "./dailyStrategyScanner";
import { dailyScanPersistenceService } from "../../db/DailyScanPersistenceService";
import { UniversePreset } from "../market/NSEUniverseService";

export interface ScanRunSummary {
  runId: string;
  triggerType: "SCHEDULED_TIMER" | "EXTERNAL_CRON_HTTP" | "MANUAL";
  tradingDate: string;
  startTime: string;
  endTime?: string;
  durationMs?: number;
  status: "IN_PROGRESS" | "COMPLETED" | "PARTIAL" | "FAILED" | "SKIPPED";
  universePreset?: UniversePreset;
  universeSize?: number;
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
  universePreset?: UniversePreset;
  maxSymbols?: number; // 0 or undefined = Scan ALL ~2,000+ NSE stocks
  offset?: number;
  candleDataBySymbol?: Record<string, DailyCandle[]>;
}

export class DailyScannerScheduler {
  private isScanning: boolean = false;
  private timer: NodeJS.Timeout | null = null;
  private lastCompletedDate: string | null = null;
  private scanHistory: Map<string, ScanRunSummary> = new Map();
  private latestRun: ScanRunSummary | null = null;

  public readonly TARGET_HOUR_IST: number = 15;
  public readonly TARGET_MINUTE_IST: number = 45;

  constructor() { }

  public evaluateSchedule(targetDate?: Date | string | number): ScheduleCheckResult {
    const comp = marketSessionValidator.getIstComponents(targetDate);
    const tradingDate = comp.dateString;
    const currentIstTime = `${comp.hours.toString().padStart(2, "0")}:${comp.minutes
      .toString()
      .padStart(2, "0")}:${comp.seconds.toString().padStart(2, "0")}`;

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

  public stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      console.log("[DailyScannerScheduler] Background scheduler stopped.");
    }
  }

  public async checkAndRunScheduledScan(nowDate?: Date): Promise<ScanRunSummary | null> {
    const schedule = this.evaluateSchedule(nowDate);

    if (!schedule.isTradingDay || !schedule.isTargetTime) {
      return null;
    }

    if (this.lastCompletedDate === schedule.tradingDate) {
      return null;
    }

    try {
      const existingDbRun = await dailyScanPersistenceService.findCompletedScheduledRunByDate(schedule.tradingDate);
      if (existingDbRun) {
        this.lastCompletedDate = schedule.tradingDate;
        return null;
      }
    } catch (dbErr) {
      console.warn("[DailyScannerScheduler] Could not query DB for scheduled run date:", dbErr);
    }

    if (this.isScanning) {
      return null;
    }

    console.log(
      `[DailyScannerScheduler] Triggering scheduled post-market scan for date ${schedule.tradingDate} at ${schedule.currentIstTime} IST`
    );
    return await this.executeDailyScan({
      triggerType: "SCHEDULED_TIMER",
      dateOverride: schedule.tradingDate,
    });
  }

  public async executeDailyScan(options: TriggerScanOptions = {}): Promise<ScanRunSummary> {
    const triggerType = options.triggerType || "MANUAL";
    const targetDateObj = options.timestampOverride
      ? new Date(options.timestampOverride)
      : options.dateOverride
        ? new Date(options.dateOverride + "T16:00:00+05:30")
        : new Date();
    const schedule = this.evaluateSchedule(targetDateObj);
    const tradingDate = options.dateOverride || schedule.tradingDate;

    if (this.isScanning) {
      const err = `Concurrent scan rejected: another scan is already in progress.`;
      console.warn(`[DailyScannerScheduler] ${err}`);
      throw new Error(err);
    }

    if (!options.force && triggerType !== "MANUAL") {
      if (!schedule.isTradingDay) {
        throw new Error(
          `Cannot execute scheduled scan: ${tradingDate} is not an NSE trading day (${schedule.reason}). Pass force=true to override.`
        );
      }
      if (!schedule.isAfterMarketClose) {
        throw new Error(
          `Cannot execute scan: completed daily candles are not yet finalized. Current time is ${schedule.currentIstTime} IST. Pass force=true to override.`
        );
      }
      if (this.lastCompletedDate === tradingDate) {
        throw new Error(
          `Duplicate scan rejected: daily scan for date ${tradingDate} has already completed.`
        );
      }

      const existingDbRun = await dailyScanPersistenceService.findCompletedScheduledRunByDate(tradingDate);
      if (existingDbRun) {
        this.lastCompletedDate = tradingDate;
        throw new Error(
          `Duplicate scan rejected: daily scan for date ${tradingDate} has already completed in database.`
        );
      }
    }

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
      `[DailyScannerScheduler] >>> STARTING FULL NSE SCAN ${runId} (Type: ${triggerType}, Date: ${tradingDate})`
    );

    try {
      const universePreset = options.universePreset || "ALL_NSE_CASH";

      // Fetch ALL live NSE Equity symbols (~2,000+ stocks)
      const allNseList = await fetchAllNseEquitySymbols();
      let targetSymbols = allNseList.map((item) => item.symbol);

      if (options.symbols && options.symbols.length > 0) {
        targetSymbols = options.symbols;
      } else if (options.maxSymbols && options.maxSymbols > 0) {
        const offset = options.offset ?? 0;
        targetSymbols = targetSymbols.slice(offset, offset + options.maxSymbols);
      }

      summary.universePreset = universePreset;
      summary.universeSize = allNseList.length;
      summary.scannedSymbols = targetSymbols;
      summary.scannedSymbolsCount = targetSymbols.length;

      const scanType = triggerType === "MANUAL" ? "manual" : "scheduled";
      await dailyScanPersistenceService.createScanRun({
        id: runId,
        scanDate: tradingDate,
        scanType,
        universeSize: allNseList.length,
        marketDataTimestamp: startTimeIso,
      });

      const matchedSignals: SwingSignal[] = [];

      if (options.candleDataBySymbol) {
        for (const [sym, candles] of Object.entries(options.candleDataBySymbol)) {
          const resolvedSym = sym.trim().toUpperCase().replace(/\.NS$/, "");
          try {
            const sig = swingTradingEngine.evaluateStockCandles(resolvedSym, candles);
            if (sig) {
              summary.successfulSymbolsCount++;
              matchedSignals.push(sig);
            } else {
              const validation = validateDailyCandles(candles);
              if (!validation.valid) {
                summary.failedSymbolsCount++;
                summary.failedSymbols.push({ symbol: resolvedSym, error: validation.reason || "Invalid candle data" });
              } else {
                summary.successfulSymbolsCount++;
              }
            }
          } catch (itemErr: any) {
            summary.failedSymbolsCount++;
            summary.failedSymbols.push({ symbol: resolvedSym, error: itemErr.message || String(itemErr) });
          }
        }
      } else {
        // High-speed concurrent batch fetching for ALL ~2,000+ NSE stocks
        const BATCH_SIZE = 16; // 16 parallel workers for fast scanning
        for (let i = 0; i < targetSymbols.length; i += BATCH_SIZE) {
          const batch = targetSymbols.slice(i, i + BATCH_SIZE);

          const batchPromises = batch.map(async (rawSym) => {
            const sym = rawSym.trim().toUpperCase().replace(/\.NS$/, "");
            try {
              const candleData = await fetchLiveStockCandles(sym);
              if (!candleData || !candleData.candles) {
                return { symbol: sym, success: false, error: "No candle data returned", signal: null };
              }
              const sig = swingTradingEngine.evaluateStockCandles(
                sym,
                candleData.candles,
                22520.45,
                candleData.meta
              );
              return { symbol: sym, success: true, signal: sig };
            } catch (fetchErr: any) {
              return { symbol: sym, success: false, error: fetchErr.message || "Failed to fetch", signal: null };
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
                summary.failedSymbols.push({ symbol: item.symbol, error: item.error || "Unknown error" });
              }
            }
          }

          if (i + BATCH_SIZE < targetSymbols.length) {
            await new Promise((r) => setTimeout(r, 100));
          }
        }
      }

      const durationMs = Date.now() - startTimeMs;
      summary.endTime = new Date().toISOString();
      summary.durationMs = durationMs;

      let finalSummaryStatus: ScanRunSummary["status"] = "COMPLETED";
      if (summary.failedSymbolsCount > 0 && summary.successfulSymbolsCount > 0) {
        finalSummaryStatus = "PARTIAL";
      } else if (summary.failedSymbolsCount > 0 && summary.successfulSymbolsCount === 0) {
        finalSummaryStatus = "FAILED";
      }
      summary.status = finalSummaryStatus;
      summary.opportunities = matchedSignals;
      summary.opportunitiesFoundCount = matchedSignals.length;

      await dailyScanPersistenceService.saveOpportunities(runId, tradingDate, matchedSignals);

      await dailyScanPersistenceService.completeScanRun(runId, {
        durationMs,
        scannedCount: summary.scannedSymbolsCount,
        successCount: summary.successfulSymbolsCount,
        failureCount: summary.failedSymbolsCount,
        opportunitiesFound: matchedSignals.length,
        errorSummary: summary.failedSymbols.length > 0 ? JSON.stringify(summary.failedSymbols) : null,
        marketDataTimestamp: startTimeIso,
      });

      this.lastCompletedDate = tradingDate;
      this.scanHistory.set(tradingDate, summary);
      this.latestRun = summary;

      console.log(
        `[DailyScannerScheduler] <<< COMPLETED FULL NSE SCAN ${runId} in ${durationMs}ms: Scanned ${summary.scannedSymbolsCount}, Successful ${summary.successfulSymbolsCount}, Opportunities ${summary.opportunitiesFoundCount}`
      );

      return summary;
    } catch (scanErr: any) {
      summary.status = "FAILED";
      summary.endTime = new Date().toISOString();
      summary.durationMs = Date.now() - startTimeMs;
      summary.errorMessage = scanErr.message || String(scanErr);
      this.latestRun = summary;

      try {
        await dailyScanPersistenceService.failScanRun(runId, scanErr.message || String(scanErr), Date.now() - startTimeMs);
      } catch (dbFailErr) {
        console.error(`[DailyScannerScheduler] Failed to update DB failure state:`, dbFailErr);
      }

      console.error(`[DailyScannerScheduler] !!! SCAN FAILED ${runId}:`, scanErr);
      throw scanErr;
    } finally {
      this.isScanning = false;
    }
  }

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