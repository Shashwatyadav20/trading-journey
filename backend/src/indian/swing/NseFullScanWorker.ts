/**
 * NseFullScanWorker — Async background worker for the full 2,349-symbol scan
 *
 * Architecture:
 *   - Runs as a long-lived async function inside the Fastify (Render) process.
 *   - Started by the POST /api/indian/swing/nse-scanner/start route.
 *   - Does NOT block the HTTP thread — started with setImmediate after the
 *     /start route returns 202.
 *   - Heartbeat renews the Supabase distributed lock every 60 seconds.
 *   - Checkpoint written every CHECKPOINT_EVERY_N_BATCHES batches (~125 symbols).
 *   - On crash/restart: detects last FAILED job with a checkpoint and resumes.
 *
 * Safety invariants (enforced at this level too):
 *   LIVE_TRADING = false (inlined — backend cannot resolve Next.js @/ alias)
 *   BROKER_EXECUTION_ENABLED = false
 *
 * Import note:
 *   The lib/indian/* modules use ES module exports and do NOT depend on
 *   Next.js internals, so they are importable from the backend with tsconfig
 *   path aliases configured correctly. The backend tsconfig must map "../../../../lib"
 *   to resolve these. If path resolution fails, copy the needed functions here.
 *
 *   Relative import path from backend/src/indian/swing/ to lib/indian/:
 *     ../../../../lib/indian/<file>
 */

import { randomUUID } from 'crypto';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { env } from '../../config/env';
import { scanJobRepository, ScanJobRow } from './ScanJobRepository';
import { scanAlertService } from './ScanAlertService';

// ─────────────────────────────────────────────────────────────────────────────
// Safety assertions (inlined — backend tsconfig has no @/ alias)
// ─────────────────────────────────────────────────────────────────────────────

const LIVE_TRADING = false as const;
const BROKER_EXECUTION_ENABLED = false as const;

if (LIVE_TRADING !== false || BROKER_EXECUTION_ENABLED !== false) {
  throw new Error(
    'SAFETY VIOLATION: LIVE_TRADING or BROKER_EXECUTION_ENABLED must be false in NseFullScanWorker.'
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Dynamic imports of lib/indian modules
//
// Using dynamic require() because:
//   1. The backend tsconfig may not have paths configured for "../../../../lib".
//   2. These modules use Next.js-compatible ESM syntax but are plain TS — they
//      compile fine under tsx/ts-node.
//   3. Dynamic import avoids a hard build-time dependency that could fail if
//      the path alias is not set up.
//
// If the backend tsconfig is extended to include paths, these can be converted
// to static imports. See backend/tsconfig.json paths documentation.
// ─────────────────────────────────────────────────────────────────────────────

// Types re-declared here to avoid the import chain — keeps the worker self-contained.
// These must match the actual types in lib/indian/dailyStrategyScanner.ts.

export interface DailyCandle {
  date: string; open: number; high: number; low: number; close: number; volume: number;
}
export interface MatchedStockOpportunity { [key: string]: any; }
export interface CandleFetchOutcome {
  success: boolean; symbol: string; reason?: string; detail?: string;
  candles?: DailyCandle[]; meta?: any; warnings?: string[]; lastCandleMayBeIncomplete?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Configuration (mirrors lib/indian/scannerConfig.ts — keep in sync)
// ─────────────────────────────────────────────────────────────────────────────

const CONCURRENCY_LIMIT = 5;
const BATCH_DELAY_MS = 250;
const MAX_RETRIES = 3;
const FETCH_TIMEOUT_MS = 8000;
const RETRY_BACKOFF_BASE_MS = 800;
const MIN_CANDLES_BASIC = 25;
const MIN_AVG_VOLUME_20D = 100_000;
const MAX_DATA_STALENESS_DAYS = 5;
const ABNORMAL_PRICE_CHANGE_PERCENT = 50;
const NSE_MARKET_CLOSE_HOUR_IST = 15;
const NSE_MARKET_CLOSE_MINUTE_IST = 30;
const YAHOO_FINANCE_BASE = 'https://query2.finance.yahoo.com/v8/finance/chart';
const YAHOO_FINANCE_INTERVAL = '1d';
const YAHOO_FINANCE_RANGE = '1y';

const CHECKPOINT_EVERY_N_BATCHES = 25;   // ~125 symbols per checkpoint
const HEARTBEAT_INTERVAL_MS = 60_000;    // 60 seconds

// ─────────────────────────────────────────────────────────────────────────────
// Worker options
// ─────────────────────────────────────────────────────────────────────────────

export interface ScanWorkerOptions {
  dryRun?: boolean;
  maxSymbols?: number | null;
  forceUniverse?: boolean;
  forceRestart?: boolean;  // If true: ignore any resumable checkpoint for today
}

export interface ScanWorkerStartResult {
  accepted: boolean;
  jobId?: string;
  message: string;
  existingJob?: Partial<ScanJobRow>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Global rate limiter (inline — mirrors lib/indian/yahooRateLimiter.ts)
// ─────────────────────────────────────────────────────────────────────────────

const rateLimiterState = { cooldownUntilMs: 0, consecutiveHits: 0 };

async function waitIfCoolingDown(): Promise<void> {
  const remaining = rateLimiterState.cooldownUntilMs - Date.now();
  if (remaining > 0) {
    console.info(`[YahooRL] Cooling down ${(remaining / 1000).toFixed(1)}s before fetch.`);
    await sleep(remaining);
  }
}

function recordRateLimit(): void {
  rateLimiterState.consecutiveHits++;
  const cooldown = Math.min(30_000 * Math.pow(2, rateLimiterState.consecutiveHits - 1), 5 * 60 * 1000);
  rateLimiterState.cooldownUntilMs = Date.now() + cooldown;
  console.warn(`[YahooRL] 429 hit #${rateLimiterState.consecutiveHits}. Cooldown: ${cooldown / 1000}s`);
}

function recordSuccess(): void {
  if (rateLimiterState.consecutiveHits > 0) rateLimiterState.consecutiveHits = 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function todayIST(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
}

function isBeforeNSEClose(): boolean {
  const now = new Date();
  const h = parseInt(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata', hour: 'numeric', hour12: false }));
  const m = parseInt(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata', minute: 'numeric' }));
  return h < NSE_MARKET_CLOSE_HOUR_IST || (h === NSE_MARKET_CLOSE_HOUR_IST && m < NSE_MARKET_CLOSE_MINUTE_IST);
}

function jitteredBackoffMs(retryCount: number): number {
  const base = RETRY_BACKOFF_BASE_MS * Math.pow(2, retryCount);
  const jitter = base * 0.25 * (Math.random() * 2 - 1);
  return Math.max(200, Math.round(base + jitter));
}

/** A unique ID generated once per process startup — used as the lock_holder_id. */
const PROCESS_LOCK_HOLDER_ID = randomUUID();

// ─────────────────────────────────────────────────────────────────────────────
// Yahoo Finance fetcher (self-contained — no @/ imports)
// ─────────────────────────────────────────────────────────────────────────────

async function fetchSymbolCandles(symbol: string, retryCount = 0): Promise<CandleFetchOutcome> {
  const clean = symbol.trim().toUpperCase().replace(/\.NS$/, '').replace(/\.BO$/, '');
  if (!clean || clean.length > 20) {
    return { success: false, symbol: clean || symbol, reason: 'INVALID_SYMBOL', detail: `Symbol "${symbol}" invalid` };
  }

  const yahooTicker = `${clean}.NS`;
  const url = `${YAHOO_FINANCE_BASE}/${encodeURIComponent(yahooTicker)}?interval=${YAHOO_FINANCE_INTERVAL}&range=${YAHOO_FINANCE_RANGE}`;

  try {
    await waitIfCoolingDown();

    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        Accept: 'application/json',
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    if (res.status === 429) {
      recordRateLimit();
      if (retryCount < MAX_RETRIES) {
        await sleep(jitteredBackoffMs(retryCount));
        return fetchSymbolCandles(symbol, retryCount + 1);
      }
      return { success: false, symbol: clean, reason: 'RATE_LIMITED', detail: `429 after ${retryCount + 1} attempts` };
    }

    if (!res.ok) {
      if (res.status === 404 || res.status === 400) {
        return { success: false, symbol: clean, reason: 'INVALID_SYMBOL', detail: `HTTP ${res.status} for ${yahooTicker}` };
      }
      if (retryCount < MAX_RETRIES) {
        await sleep(jitteredBackoffMs(retryCount));
        return fetchSymbolCandles(symbol, retryCount + 1);
      }
      return { success: false, symbol: clean, reason: 'DATA_FETCH_FAILED', detail: `HTTP ${res.status}` };
    }

    recordSuccess();
    const data = await res.json();
    const result = data?.chart?.result?.[0];
    if (!result) {
      return { success: false, symbol: clean, reason: 'DATA_FETCH_FAILED', detail: 'No chart result' };
    }

    const meta: any = result.meta || {};
    const timestamps: number[] = result.timestamp || [];
    const quotes = result.indicators?.quote?.[0] || {};
    const rawOpens: (number | null)[] = quotes.open || [];
    const rawHighs: (number | null)[] = quotes.high || [];
    const rawLows: (number | null)[] = quotes.low || [];
    const rawCloses: (number | null)[] = quotes.close || [];
    const rawVolumes: (number | null)[] = quotes.volume || [];

    const rawCandles: DailyCandle[] = [];
    for (let i = 0; i < timestamps.length; i++) {
      const c = rawCloses[i]; const o = rawOpens[i];
      if (c == null || o == null || isNaN(c) || isNaN(o)) continue;
      rawCandles.push({
        date: new Intl.DateTimeFormat('en-CA', {
          timeZone: 'Asia/Kolkata',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
        }).format(new Date(timestamps[i] * 1000)),
        open: Number(o.toFixed(2)),
        high: Number((rawHighs[i] ?? c).toFixed(2)),
        low: Number((rawLows[i] ?? c).toFixed(2)),
        close: Number(c.toFixed(2)),
        volume: rawVolumes[i] || 0,
      });
    }

    // Deduplicate by date (last occurrence wins)
    const seen = new Map<string, DailyCandle>();
    for (const c of rawCandles) seen.set(c.date, c);
    const candles = rawCandles.filter((c) => seen.get(c.date) === c);

    if (candles.length < MIN_CANDLES_BASIC) {
      return { success: false, symbol: clean, reason: 'DATA_INSUFFICIENT', detail: `Only ${candles.length} candles` };
    }

    // Staleness check
    const lastDate = candles[candles.length - 1].date;
    const ageDays = (Date.now() - new Date(lastDate + 'T00:00:00+05:30').getTime()) / 86_400_000;
    if (ageDays > MAX_DATA_STALENESS_DAYS) {
      return { success: false, symbol: clean, reason: 'DATA_STALE', detail: `Last candle ${lastDate} (${ageDays.toFixed(1)}d ago)` };
    }

    // Liquidity check (20D avg volume)
    const avgVol = candles.slice(-20).reduce((s, c) => s + c.volume, 0) / 20;
    if (avgVol < MIN_AVG_VOLUME_20D) {
      return { success: false, symbol: clean, reason: 'INSUFFICIENT_LIQUIDITY', detail: `Avg vol ${Math.round(avgVol).toLocaleString()}` };
    }

    // Abnormal price check
    const warnings: string[] = [];
    for (let i = 1; i < candles.length; i++) {
      const prev = candles[i - 1].close;
      if (prev > 0 && Math.abs((candles[i].close - prev) / prev) * 100 > ABNORMAL_PRICE_CHANGE_PERCENT) {
        warnings.push(`Abnormal price on ${candles[i].date}: ${prev} → ${candles[i].close}`);
      }
    }

    const todayStr = todayIST();
    const lastCandleMayBeIncomplete = lastDate === todayStr && isBeforeNSEClose();

    return { success: true, symbol: clean, candles, meta, warnings, lastCandleMayBeIncomplete };
  } catch (err: any) {
    const msg = err?.message || 'unknown';
    if ((msg.includes('timeout') || msg.includes('AbortError')) && retryCount < MAX_RETRIES) {
      await sleep(jitteredBackoffMs(retryCount));
      return fetchSymbolCandles(symbol, retryCount + 1);
    }
    return { success: false, symbol: clean, reason: 'DATA_FETCH_FAILED', detail: `Exception: ${msg}` };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Supabase client for run persistence (swing_scan_runs + swing_scan_opportunities)
// ─────────────────────────────────────────────────────────────────────────────

function getSupabase(): SupabaseClient | null {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return null;
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Main worker class
// ─────────────────────────────────────────────────────────────────────────────

class NseFullScanWorker {
  /** Active abort flag. Set to true by the abort endpoint to stop the running scan. */
  private abortRequested = false;
  private currentJobId: string | null = null;

  /**
   * Called by the POST /start route.
   * Returns immediately with a 202 response; actual scanning happens asynchronously.
   */
  async startScan(options: ScanWorkerOptions): Promise<ScanWorkerStartResult> {
    const today = todayIST();

    // ── Step 1: Expire any stale jobs from today ─────────────────────────
    await scanJobRepository.expireStaleJobs(today);

    // ── Step 2: Check for an already-COMPLETED run today ─────────────────
    if (!options.forceRestart) {
      const alreadyCompleted = await scanJobRepository.hasCompletedRunForDate(today);
      if (alreadyCompleted) {
        const job = await scanJobRepository.getLatestJobForDate(today);
        return {
          accepted: false,
          message: `Today's scan (${today}) is already COMPLETED. Use forceRestart=true to re-run.`,
          existingJob: job ? { id: job.id, status: job.status, completed_at: job.completed_at } : undefined,
        };
      }
    }

    // ── Step 3: Acquire distributed lock ──────────────────────────────────
    const config = {
      dry_run: options.dryRun ?? false,
      max_symbols: options.maxSymbols ?? null,
      force_universe: options.forceUniverse ?? false,
      force_restart: options.forceRestart ?? false,
    };

    const job = await scanJobRepository.acquireLock({
      scanDate: today,
      lockHolderId: PROCESS_LOCK_HOLDER_ID,
      config,
    });

    if (!job) {
      // Another instance holds the lock
      const activeJob = await scanJobRepository.getLatestJobForDate(today);
      return {
        accepted: false,
        message: 'A scan is already running for today. Wait for it to complete or it will auto-expire if the process died.',
        existingJob: activeJob
          ? { id: activeJob.id, status: activeJob.status, lock_expires_at: activeJob.lock_expires_at }
          : undefined,
      };
    }

    this.abortRequested = false;
    this.currentJobId = job.id;

    // ── Step 4: Check for resumable checkpoint ────────────────────────────
    let resumeFromIndex = 0;
    let priorOpportunities: MatchedStockOpportunity[] = [];
    let priorFailed: any[] = [];
    let priorSkipped: any[] = [];

    if (!options.forceRestart) {
      const resumable = await scanJobRepository.getResumableJob(today);
      if (resumable && resumable.last_checkpoint_index > 0) {
        resumeFromIndex = resumable.last_checkpoint_index;
        const cp = resumable.checkpoint_data as any;
        priorOpportunities = cp?.partialOpportunities ?? [];
        priorFailed = cp?.failedSymbols ?? [];
        priorSkipped = cp?.skippedSymbols ?? [];
        console.log(`[NseFullScanWorker] Resuming from checkpoint at index ${resumeFromIndex} (${priorOpportunities.length} prior opportunities).`);
      }
    }

    // ── Step 5: Launch async worker (non-blocking) ────────────────────────
    setImmediate(() => {
      this._runScan(job.id, today, options, resumeFromIndex, priorOpportunities, priorFailed, priorSkipped)
        .catch((err) => {
          console.error('[NseFullScanWorker] Unhandled worker error:', err);
        });
    });

    return { accepted: true, jobId: job.id, message: `Scan accepted. Job ID: ${job.id}. Universe: full NSE EQ.` };
  }

  /**
   * Signals the running scan to stop after the current batch completes.
   */
  requestAbort(jobId: string): boolean {
    if (this.currentJobId !== jobId) return false;
    this.abortRequested = true;
    return true;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Internal: actual scan execution
  // ─────────────────────────────────────────────────────────────────────────

  private async _runScan(
    jobId: string,
    today: string,
    options: ScanWorkerOptions,
    resumeFromIndex: number,
    priorOpportunities: MatchedStockOpportunity[],
    priorFailed: any[],
    priorSkipped: any[]
  ): Promise<void> {
    const startMs = Date.now();
    console.log(`[NseFullScanWorker][${jobId}] Starting full scan for ${today}.`);

    // ── Heartbeat: renew lock every 60 seconds ────────────────────────────
    const heartbeatHandle = setInterval(async () => {
      const ok = await scanJobRepository.renewHeartbeat(jobId, PROCESS_LOCK_HOLDER_ID);
      if (!ok) console.warn(`[NseFullScanWorker][${jobId}] Heartbeat renewal failed — lock may have been stolen.`);
    }, HEARTBEAT_INTERVAL_MS);

    try {
      // ── 1. Fetch NSE universe ───────────────────────────────────────────
      let symbols: string[];
      let universeSource = 'FALLBACK_NIFTY_500';
      let universeSize = 0;

      try {
        const res = await fetch('https://nsearchives.nseindia.com/content/equities/EQUITY_L.csv', {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            Accept: 'text/csv,text/plain,*/*',
            Referer: 'https://www.nseindia.com/',
          },
          signal: AbortSignal.timeout(15_000),
          cache: 'no-store',
        });

        if (!res.ok) throw new Error(`NSE CSV HTTP ${res.status}`);
        const csv = await res.text();
        if (!csv || csv.length < 500) throw new Error('NSE CSV too short');

        symbols = this._parseNseCsv(csv);
        if (symbols.length < 100) throw new Error(`Only ${symbols.length} parsed`);
        universeSource = 'NSE_CSV';
        universeSize = symbols.length;
        console.log(`[NseFullScanWorker][${jobId}] Universe: ${symbols.length} symbols from NSE CSV.`);
      } catch (csvErr: any) {
        // ── FALLBACK UNIVERSE DIAGNOSTIC ─────────────────────────────────────
        // NSE CSV is unavailable. The scan will proceed on the documented Nifty
        // 500 fallback list (~130 symbols) instead of the full ~2,349-symbol EQ
        // universe. This MUST NOT be reported as a full NSE scan.
        // universe_source in the DB row will reflect 'FALLBACK_NIFTY_500'.
        // ─────────────────────────────────────────────────────────────────────
        symbols = this._getFallbackUniverse();
        universeSource = 'FALLBACK_NIFTY_500';
        universeSize = symbols.length;
        console.warn(
          `[NseFullScanWorker][${jobId}] ⚠ FALLBACK UNIVERSE ACTIVE ⚠\n` +
          `  Reason: ${csvErr?.message ?? 'unknown'}\n` +
          `  Coverage: ${symbols.length} symbols (Nifty 500 subset) — NOT full NSE coverage.\n` +
          `  This scan result is marked universe_source='FALLBACK_NIFTY_500' in the database.\n` +
          `  The full universe (~2,349 EQ symbols) will resume on next successful NSE CSV fetch.`
        );
      }

      // ── 2. Apply max_symbols cap ────────────────────────────────────────
      if (options.maxSymbols && options.maxSymbols > 0 && options.maxSymbols < symbols.length) {
        symbols = symbols.slice(0, options.maxSymbols);
        console.log(`[NseFullScanWorker][${jobId}] max_symbols=${options.maxSymbols} applied.`);
      }

      // ── 3. Apply resume offset ──────────────────────────────────────────
      const symbolsToScan = symbols.slice(resumeFromIndex);
      const totalBatches = Math.ceil(symbols.length / CONCURRENCY_LIMIT);
      const startBatch = Math.floor(resumeFromIndex / CONCURRENCY_LIMIT);

      await scanJobRepository.updateProgress(jobId, PROCESS_LOCK_HOLDER_ID, {
        symbolsProcessed: resumeFromIndex,
        symbolsSuccess: priorOpportunities.length,
        symbolsSkipped: priorSkipped.length,
        symbolsFailed: priorFailed.length,
        currentBatch: startBatch,
      });

      // ── 4. Fetch NIFTY benchmark ────────────────────────────────────────
      let niftySpot = 0;
      let niftyChangePercent = 0;
      let niftyEma20 = 0;
      let niftyFetchError: string | null = null;

      try {
        const niftyUrl = `${YAHOO_FINANCE_BASE}/%5ENSEI?interval=${YAHOO_FINANCE_INTERVAL}&range=${YAHOO_FINANCE_RANGE}`;
        const nr = await fetch(niftyUrl, {
          headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' },
          cache: 'no-store',
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        });
        if (!nr.ok) throw new Error(`HTTP ${nr.status}`);
        const nd = await nr.json();
        const nResult = nd?.chart?.result?.[0];
        if (!nResult) throw new Error('No chart result for ^NSEI');
        const nMeta = nResult.meta || {};
        const nCloses: number[] = (nResult.indicators?.quote?.[0]?.close || []).filter((v: any) => v !== null && v > 0);
        if (nCloses.length < 25) throw new Error(`Only ${nCloses.length} NIFTY closes`);
        const len = nCloses.length;
        niftySpot = Number((nMeta.regularMarketPrice ?? nCloses[len - 1]).toFixed(2));
        const niftyPrev = nCloses[len - 2];
        niftyChangePercent = niftyPrev > 0 ? Number((((niftySpot - niftyPrev) / niftyPrev) * 100).toFixed(2)) : 0;
        // EMA20 of NIFTY
        const k = 2 / 21;
        let e = nCloses.slice(0, 20).reduce((a, b) => a + b, 0) / 20;
        for (let i = 20; i < len; i++) e = nCloses[i] * k + e * (1 - k);
        niftyEma20 = Number(e.toFixed(2));
      } catch (err: any) {
        niftyFetchError = err?.message;
        console.warn(`[NseFullScanWorker][${jobId}] NIFTY benchmark unavailable: ${niftyFetchError}`);
      }

      // ── 5. Main scan loop ───────────────────────────────────────────────
      const opportunities: MatchedStockOpportunity[] = [...priorOpportunities];
      const failedSymbols: any[] = [...priorFailed];
      const skippedSymbols: any[] = [...priorSkipped];
      let successCount = resumeFromIndex > 0 ? priorOpportunities.length : 0;

      let processed = resumeFromIndex;

      // Pre-scan warm-up (500ms) — lets the event loop settle after the universe fetch
      await sleep(500);

      for (let i = 0; i < symbolsToScan.length; i += CONCURRENCY_LIMIT) {
        // Abort check (set by DELETE /abort endpoint)
        if (this.abortRequested) {
          console.warn(`[NseFullScanWorker][${jobId}] Abort requested. Stopping after ${processed} symbols.`);
          await scanJobRepository.finalize(jobId, PROCESS_LOCK_HOLDER_ID, {
            status: 'FAILED',
            symbolsTotal: symbols.length,
            symbolsSuccess: successCount,
            symbolsSkipped: skippedSymbols.length,
            symbolsFailed: failedSymbols.length,
            errorMessage: 'Aborted by admin request.',
          });
          await scanJobRepository.abortJob(jobId);
          await scanAlertService.send({ type: 'SCAN_FAILED', scanDate: today, jobId, summary: 'Scan aborted by admin.', details: { aborted: true } });
          return;
        }

        const batch = symbolsToScan.slice(i, i + CONCURRENCY_LIMIT);
        const batchNum = startBatch + Math.floor(i / CONCURRENCY_LIMIT) + 1;

        // Run batch in parallel
        const batchResults = await Promise.allSettled(
          batch.map((symbol) => fetchSymbolCandles(symbol))
        );

        // Process batch results
        for (let bi = 0; bi < batchResults.length; bi++) {
          const symbol = batch[bi];
          const res = batchResults[bi];

          if (res.status === 'rejected') {
            failedSymbols.push({ symbol, reason: 'DATA_FETCH_FAILED', detail: res.reason?.message || 'Promise rejected' });
            processed++;
            continue;
          }

          const outcome = res.value as CandleFetchOutcome;

          if (!outcome.success) {
            const skipReasons = ['INVALID_SYMBOL', 'DATA_INSUFFICIENT', 'INSUFFICIENT_LIQUIDITY', 'DATA_STALE'];
            if (skipReasons.includes(outcome.reason!)) {
              skippedSymbols.push({ symbol, reason: `${outcome.reason}: ${outcome.detail}` });
            } else {
              failedSymbols.push({ symbol, reason: outcome.reason, detail: outcome.detail });
            }
            processed++;
            continue;
          }

          if (outcome.lastCandleMayBeIncomplete) {
            skippedSymbols.push({ symbol, reason: 'LAST_CANDLE_INCOMPLETE: Market not yet closed.' });
            processed++;
            continue;
          }

          successCount++;
          processed++;

          // Build indicator profile + evaluate strategies
          // These are dynamically loaded to avoid @/ resolution issues in backend.
          // We call the actual lib functions via dynamic require.
          try {
            const { buildStockIndicatorProfile, evaluateAllStrategiesForStock } =
              await import('../../../../lib/indian/dailyStrategyScanner');

            const profile = buildStockIndicatorProfile(
              outcome.symbol!,
              outcome.candles!,
              outcome.meta,
              niftySpot || 24000,
              niftyChangePercent
            );

            const opp = evaluateAllStrategiesForStock(profile);
            if (opp) {
              const lastCandle = outcome.candles![outcome.candles!.length - 1];
              (opp as any).scanDate = today;
              (opp as any).lastCandleDate = lastCandle.date;
              (opp as any).dataSource = 'Yahoo Finance (.NS)';
              (opp as any).dataWarnings = outcome.warnings;
              (opp as any).ema200IsEstimated = profile.ema200IsEstimated;
              opportunities.push(opp);
            }
          } catch (stratErr: any) {
            console.warn(`[NseFullScanWorker][${jobId}] Strategy eval failed for ${symbol}: ${stratErr.message}`);
          }
        }

        // ── Progress update (every batch) ──────────────────────────────────
        await scanJobRepository.updateProgress(jobId, PROCESS_LOCK_HOLDER_ID, {
          symbolsProcessed: processed,
          symbolsSuccess: successCount,
          symbolsSkipped: skippedSymbols.length,
          symbolsFailed: failedSymbols.length,
          currentBatch: batchNum,
        });

        // ── Checkpoint (every CHECKPOINT_EVERY_N_BATCHES) ──────────────────
        const batchIndex = Math.floor(i / CONCURRENCY_LIMIT);
        if ((batchIndex + 1) % CHECKPOINT_EVERY_N_BATCHES === 0) {
          await scanJobRepository.writeCheckpoint(jobId, PROCESS_LOCK_HOLDER_ID, {
            symbolsProcessed: processed,
            symbolsSuccess: successCount,
            symbolsSkipped: skippedSymbols.length,
            symbolsFailed: failedSymbols.length,
            currentBatch: batchNum,
            lastCheckpointIndex: processed,
            checkpointData: {
              partialOpportunities: opportunities.slice(0, 500),
              failedSymbols: failedSymbols.slice(0, 200),
              skippedSymbols: skippedSymbols.slice(0, 200),
              niftyBenchmark: { niftySpot, niftyChangePercent, niftyEma20, niftyFetchError },
            },
          });
          console.log(`[NseFullScanWorker][${jobId}] Checkpoint at ${processed}/${symbols.length} (${opportunities.length} opportunities so far).`);
        }

        // ── Batch delay ─────────────────────────────────────────────────────
        if (i + CONCURRENCY_LIMIT < symbolsToScan.length) {
          await sleep(BATCH_DELAY_MS);
        }
      }

      // ── 6. Sort opportunities by confluence score ───────────────────────
      opportunities.sort((a, b) => (b.confluenceScore ?? 0) - (a.confluenceScore ?? 0));

      const scanStatus: 'COMPLETED' | 'PARTIAL' =
        failedSymbols.length > 0 ? 'PARTIAL' : 'COMPLETED';

      const scanDurationMs = Date.now() - startMs;

      console.log(
        `[NseFullScanWorker][${jobId}] Scan ${scanStatus}: ${successCount} success, ` +
        `${skippedSymbols.length} skipped, ${failedSymbols.length} failed, ` +
        `${opportunities.length} opportunities. Duration: ${(scanDurationMs / 1000).toFixed(0)}s`
      );

      // ── 7. Persist to swing_scan_runs ───────────────────────────────────
      let scanRunId: string | undefined;
      let persistenceError: string | undefined;

      if (!options.dryRun) {
        const supabase = getSupabase();
        if (supabase) {
          try {
            // Deduplication: skip if COMPLETED run already exists for today
            const { data: existing } = await supabase
              .from('swing_scan_runs')
              .select('id')
              .eq('scan_date', today)
              .eq('status', 'COMPLETED')
              .limit(1);

            if (existing && existing.length > 0 && scanStatus === 'COMPLETED') {
              scanRunId = existing[0].id;
              console.log(`[NseFullScanWorker][${jobId}] COMPLETED run already exists for ${today}. Skipping duplicate insert.`);
            } else {
              const { data: runData, error: runErr } = await supabase
                .from('swing_scan_runs')
                .insert({
                  scan_date: today,
                  run_at: new Date().toISOString(),
                  status: scanStatus,
                  universe_source: universeSource,
                  universe_size: universeSize,
                  scanned_count: successCount,
                  skipped_count: skippedSymbols.length,
                  failed_count: failedSymbols.length,
                  opportunities_count: opportunities.length,
                  opportunities,
                  diagnostics: {
                    failedSymbols: failedSymbols.slice(0, 50),
                    skippedSymbols: skippedSymbols.slice(0, 50),
                    warnings: niftyFetchError ? [`NIFTY fetch error: ${niftyFetchError}`] : [],
                  },
                  metadata: {
                    scanDurationMs,
                    dataProvider: 'Yahoo Finance v8',
                    niftyBenchmark: { niftySpot, niftyChangePercent, niftyEma20 },
                  },
                })
                .select('id')
                .single();

              if (runErr) {
                persistenceError = runErr.message;
                console.error(`[NseFullScanWorker][${jobId}] swing_scan_runs insert error: ${runErr.message}`);
              } else {
                scanRunId = runData?.id;

                // ── Write normalized opportunities ──────────────────────────
                if (opportunities.length > 0 && scanRunId) {
                  const oppRows = opportunities.map((opp) => ({
                    run_id: scanRunId,
                    scan_date: today,
                    symbol: (opp as any).symbol || opp.cleanSymbol,
                    clean_symbol: opp.cleanSymbol,
                    company_name: opp.companyName,
                    primary_strategy_id: opp.primaryStrategy?.strategyId,
                    matched_strategies: opp.allMatchedStrategies ?? [],
                    confluence_score: opp.confluenceScore ?? 0,
                    is_multi_strategy: opp.isMultiStrategyMatch ?? false,
                    matched_count: opp.matchedStrategyCount ?? 1,
                    confirmation_status: opp.confirmationStatus ?? 'DEVELOPING',
                    current_price: opp.currentPrice,
                    entry_trigger: opp.entryTrigger,
                    stop_loss: opp.stopLoss,
                    target_1: opp.target1,
                    target_2: opp.target2,
                    risk_per_share: opp.riskPerShare,
                    reward_risk_ratio: opp.rewardRiskRatio,
                    rsi: opp.rsi,
                    trend_strength: opp.trendStrength,
                    opportunity_json: opp,
                  }));

                  const BATCH_SIZE = 100;
                  for (let k = 0; k < oppRows.length; k += BATCH_SIZE) {
                    const { error: oppErr } = await supabase
                      .from('swing_scan_opportunities')
                      .insert(oppRows.slice(k, k + BATCH_SIZE));
                    if (oppErr) {
                      console.error(`[NseFullScanWorker][${jobId}] swing_scan_opportunities batch ${k} error: ${oppErr.message}`);
                    }
                  }
                }
              }
            }
          } catch (dbErr: any) {
            persistenceError = dbErr?.message;
            console.error(`[NseFullScanWorker][${jobId}] Persistence exception: ${dbErr?.message}`);
          }
        } else {
          persistenceError = 'Supabase credentials not configured.';
          console.warn(`[NseFullScanWorker][${jobId}] ${persistenceError}`);
        }
      }

      // ── 8. Finalize job row ─────────────────────────────────────────────
      await scanJobRepository.finalize(jobId, PROCESS_LOCK_HOLDER_ID, {
        status: scanStatus,
        symbolsTotal: symbols.length,
        symbolsSuccess: successCount,
        symbolsSkipped: skippedSymbols.length,
        symbolsFailed: failedSymbols.length,
        scanRunId,
        errorMessage: persistenceError,
      });

      this.currentJobId = null;

      // ── 9. Send alert ───────────────────────────────────────────────────
      const alertType = scanStatus === 'COMPLETED' ? 'SCAN_COMPLETED' : 'SCAN_PARTIAL';
      await scanAlertService.send({
        type: alertType,
        scanDate: today,
        jobId,
        summary: `${scanStatus}: ${symbols.length} symbols, ${opportunities.length} opportunities, ${(scanDurationMs / 1000).toFixed(0)}s`,
        details: {
          universeSize: symbols.length,
          successCount,
          skippedCount: skippedSymbols.length,
          failedCount: failedSymbols.length,
          opportunitiesCount: opportunities.length,
          scanDurationMs,
          scanRunId,
          persistenceError,
        },
      });

    } catch (fatalErr: any) {
      console.error(`[NseFullScanWorker][${jobId}] Fatal error:`, fatalErr);

      await scanJobRepository.finalize(jobId, PROCESS_LOCK_HOLDER_ID, {
        status: 'FAILED',
        symbolsTotal: 0,
        symbolsSuccess: 0,
        symbolsSkipped: 0,
        symbolsFailed: 0,
        errorMessage: fatalErr?.message || 'Unknown fatal error',
      });

      this.currentJobId = null;

      await scanAlertService.send({
        type: 'SCAN_FAILED',
        scanDate: today,
        jobId,
        summary: `FAILED: ${fatalErr?.message || 'Unknown error'}`,
        details: { error: fatalErr?.message, stack: fatalErr?.stack?.substring(0, 500) },
      });
    } finally {
      clearInterval(heartbeatHandle);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Universe helpers (self-contained — no @/ imports)
  // ─────────────────────────────────────────────────────────────────────────

  private _parseNseCsv(csv: string): string[] {
    const lines = csv.split('\n').map((l) => l.trim()).filter(Boolean);
    if (lines.length < 2) return [];

    const header = lines[0].split(',').map((h) => h.trim().toUpperCase().replace(/"/g, ''));
    const symbolIdx = header.findIndex((h) => h === 'SYMBOL');
    const seriesIdx = header.findIndex((h) => h === 'SERIES');
    if (symbolIdx === -1 || seriesIdx === -1) return [];

    const EXCLUDED = new Set(['BE','BZ','SM','ST','XT','SS','IV','WR','W1','W2','W3','W4','W5']);
    const KNOWN_NON_EQUITY = new Set([
      'NIFTY','BANKNIFTY','FINNIFTY','MIDCPNIFTY','NIFTYNXT50',
      'GOLDBEES','SETFNIF50','LIQUIDBEES','CPSEETF','PSUBNKBEES',
    ]);
    const seen = new Set<string>();
    const symbols: string[] = [];

    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(',').map((c) => c.trim().replace(/"/g, ''));
      const sym = (cols[symbolIdx] || '').toUpperCase();
      const series = (cols[seriesIdx] || '').toUpperCase();
      if (!sym || sym.length > 20) continue;
      if (series !== 'EQ' || EXCLUDED.has(series) || KNOWN_NON_EQUITY.has(sym)) continue;
      if (seen.has(sym)) continue;
      seen.add(sym);
      symbols.push(sym);
    }
    return symbols;
  }

  private _getFallbackUniverse(): string[] {
    // Minimal fallback — same as NIFTY_500_FALLBACK_UNIVERSE in scannerConfig.ts
    return [
      'RELIANCE','TCS','HDFCBANK','BHARTIARTL','ICICIBANK','INFY','SBIN','LT',
      'HINDUNILVR','ITC','BAJFINANCE','KOTAKBANK','AXISBANK','MARUTI','ASIANPAINT',
      'SUNPHARMA','NTPC','ONGC','POWERGRID','TITAN','M&M','BAJAJFINSV','HCLTECH',
      'WIPRO','TECHM','ULTRACEMCO','TATAMOTORS','JSWSTEEL','HINDALCO','TATASTEEL',
      'COALINDIA','ADANIENT','ADANIPORTS','APOLLOHOSP','BPCL','BRITANNIA','CIPLA',
      'DIVISLAB','DRREDDY','EICHERMOT','GRASIM','HDFCLIFE','HEROMOTOCO','INDUSINDBK',
      'NESTLEIND','SBILIFE','SHREECEM','TATACONSUM','TRENT','VEDL',
    ];
  }
}

export const nseFullScanWorker = new NseFullScanWorker();
