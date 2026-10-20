/**
 * ScanScheduler — Daily NSE swing scan trigger at 15:45 IST
 *
 * Runs a 60-second polling loop inside the Fastify process.
 * Triggers the full NSE scanner exactly once per trading day at 15:45 IST
 * (15 minutes after NSE market close at 15:30 IST).
 *
 * Holiday handling:
 *   Uses the same isNSETradingDay() logic as the Next.js scanner config.
 *   The NSE_HOLIDAYS_2026 set is inlined here (backend cannot use @/ alias).
 *   Update the HOLIDAYS set and COVERAGE_YEAR constant each December.
 *
 * Duplicate protection:
 *   Before triggering, checks swing_scan_jobs for an existing job today.
 *   Does not trigger if a QUEUED, RUNNING, or COMPLETED job already exists.
 *
 * Timezone:
 *   All time comparisons use Asia/Kolkata (IST = UTC+5:30).
 *   The trigger fires when IST hour = 15 and IST minute is in [45, 46].
 *   The 2-minute window prevents a missed tick if the interval fires at 59.5s.
 */

import { nseFullScanWorker } from './NseFullScanWorker';
import { scanJobRepository } from './ScanJobRepository';
import { scanAlertService } from './ScanAlertService';

// ─────────────────────────────────────────────────────────────────────────────
// NSE Holiday Calendar (inlined — backend cannot resolve @/ alias)
// Update annually. Last updated: 2026.
// ─────────────────────────────────────────────────────────────────────────────

const NSE_HOLIDAYS_2026: ReadonlySet<string> = new Set([
  '2026-01-26', // Republic Day
  '2026-02-26', // Mahashivratri
  '2026-03-20', // Holi
  '2026-03-31', // Id-Ul-Fitr (Ramzan Id)
  '2026-04-02', // Ram Navami
  '2026-04-03', // Good Friday
  '2026-04-14', // Dr. Baba Saheb Ambedkar Jayanti
  '2026-05-01', // Maharashtra Day
  '2026-08-15', // Independence Day
  '2026-10-02', // Mahatma Gandhi Jayanti / Dussehra
  '2026-10-21', // Diwali Laxmi Pujan
  '2026-10-22', // Diwali Balipratipada
  '2026-11-05', // Guru Nanak Jayanti
  '2026-12-25', // Christmas
]);

/** Must match the year of the last NSE_HOLIDAYS_<YEAR> set above. */
const NSE_HOLIDAYS_COVERAGE_THROUGH_YEAR = 2026;

const NSE_HOLIDAYS = NSE_HOLIDAYS_2026;

function isNSETradingDay(dateStr: string): boolean {
  const d = new Date(dateStr + 'T00:00:00+05:30');
  const dow = d.getDay(); // 0=Sun, 6=Sat
  if (dow === 0 || dow === 6) return false;
  return !NSE_HOLIDAYS.has(dateStr);
}

// ─────────────────────────────────────────────────────────────────────────────
// IST time helpers
// ─────────────────────────────────────────────────────────────────────────────

function nowIST(): { date: string; hour: number; minute: number } {
  const now = new Date();
  return {
    date: now.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }),
    hour: parseInt(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata', hour: 'numeric', hour12: false })),
    minute: parseInt(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata', minute: 'numeric' })),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Scheduler
// ─────────────────────────────────────────────────────────────────────────────

class ScanScheduler {
  private intervalHandle: NodeJS.Timeout | null = null;
  private lastTriggerDate: string | null = null;

  /**
   * Starts the 60-second polling loop.
   * Call once from server.ts after market data starts.
   */
  start(): void {
    if (this.intervalHandle) {
      console.warn('[ScanScheduler] Already running — ignoring duplicate start().');
      return;
    }

    // Build-time holiday coverage guard
    const currentYear = new Date().getFullYear();
    if (currentYear > NSE_HOLIDAYS_COVERAGE_THROUGH_YEAR) {
      console.error(
        `[ScanScheduler] CRITICAL: NSE holiday calendar only covers up to ` +
        `${NSE_HOLIDAYS_COVERAGE_THROUGH_YEAR}. Current year is ${currentYear}. ` +
        `Update ScanScheduler.ts with NSE holidays for ${currentYear}.`
      );
      // Do not throw — scheduler still runs but will always trigger (treating all weekdays as trading days).
      // This is safer than silently not scheduling.
    }

    this.intervalHandle = setInterval(() => {
      this._tick().catch((err) => {
        console.error('[ScanScheduler] Tick error:', err?.message);
      });
    }, 60_000);

    console.log('[ScanScheduler] Started — will trigger at 15:45 IST on NSE trading days.');
  }

  /**
   * Stops the polling loop. Call on graceful shutdown.
   */
  stop(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
      console.log('[ScanScheduler] Stopped.');
    }
  }

  private async _tick(): Promise<void> {
    const { date, hour, minute } = nowIST();

    // Trigger window: 15:45 to 15:46 IST (2-minute window to survive a missed tick)
    if (hour !== 15 || minute < 45 || minute > 46) return;

    // Already triggered today
    if (this.lastTriggerDate === date) return;

    if (!isNSETradingDay(date)) {
      if (minute === 45) {
        console.log(`[ScanScheduler] ${date} is not an NSE trading day — skipping scan.`);
        await scanAlertService.send({
          type: 'SCHEDULER_SKIPPED',
          scanDate: date,
          summary: `${date} is not an NSE trading day (weekend or holiday).`,
          details: { date, hour, minute },
        });
      }
      this.lastTriggerDate = date; // Mark as handled to avoid repeated alerts
      return;
    }

    // Mark triggered now (before async work) to prevent double-fire within the 2-min window
    this.lastTriggerDate = date;
    console.log(`[ScanScheduler] Triggering daily scan for ${date} at ${hour}:${String(minute).padStart(2, '0')} IST.`);

    await scanAlertService.send({
      type: 'SCHEDULER_TRIGGERED',
      scanDate: date,
      summary: `Daily scan triggered for ${date} at IST ${hour}:${String(minute).padStart(2, '0')}.`,
      details: { date, hour, minute },
    });

    // Attempt to start scan (worker handles deduplication and locking)
    try {
      const result = await nseFullScanWorker.startScan({ dryRun: false });
      if (result.accepted) {
        console.log(`[ScanScheduler] Scan accepted. Job ID: ${result.jobId}`);
      } else {
        console.log(`[ScanScheduler] Scan not accepted: ${result.message}`);
      }
    } catch (err: any) {
      console.error(`[ScanScheduler] Failed to start scan: ${err?.message}`);
      await scanAlertService.send({
        type: 'SCAN_FAILED',
        scanDate: date,
        summary: `Scheduler failed to start scan: ${err?.message}`,
        details: { error: err?.message },
      });
    }
  }
}

export const scanScheduler = new ScanScheduler();
