/**
 * ScanJobRepository — Supabase CRUD for swing_scan_jobs
 *
 * All database interactions for the async NSE scanner worker are
 * funnelled through this class. This keeps SQL concerns out of the
 * worker logic and makes the data layer independently testable.
 *
 * Safety:
 *   - Uses service_role key — NEVER exposed to the browser.
 *   - The distributed lock (lock_holder_id + lock_expires_at) is maintained
 *     here via acquireLock(), renewHeartbeat(), and releaseLock().
 *   - The unique partial index on swing_scan_jobs (scan_date) WHERE status IN
 *     ('QUEUED','RUNNING') provides the atomicity guarantee at the DB level.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { env } from '../../config/env';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type JobStatus =
  | 'QUEUED'
  | 'RUNNING'
  | 'COMPLETED'
  | 'PARTIAL'
  | 'FAILED'
  | 'ABORTED';

export interface ScanJobRow {
  id: string;
  scan_date: string;
  status: JobStatus;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  lock_holder_id: string | null;
  lock_acquired_at: string | null;
  lock_expires_at: string | null;
  symbols_total: number;
  symbols_processed: number;
  symbols_success: number;
  symbols_skipped: number;
  symbols_failed: number;
  current_batch: number;
  total_batches: number;
  last_checkpoint_index: number;
  checkpoint_data: Record<string, any>;
  config: Record<string, any>;
  error_message: string | null;
  scan_run_id: string | null;
}

export interface CreateJobOptions {
  scanDate: string;
  lockHolderId: string;
  config: Record<string, any>;
}

export interface CheckpointUpdate {
  symbolsProcessed: number;
  symbolsSuccess: number;
  symbolsSkipped: number;
  symbolsFailed: number;
  currentBatch: number;
  lastCheckpointIndex: number;
  checkpointData: Record<string, any>;
}

export interface FinalUpdate {
  status: 'COMPLETED' | 'PARTIAL' | 'FAILED';
  symbolsTotal: number;
  symbolsSuccess: number;
  symbolsSkipped: number;
  symbolsFailed: number;
  scanRunId?: string;
  errorMessage?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Repository
// ─────────────────────────────────────────────────────────────────────────────

class ScanJobRepository {
  private supabase: SupabaseClient | null = null;

  private getClient(): SupabaseClient | null {
    if (this.supabase) return this.supabase;
    if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
      console.warn('[ScanJobRepository] Supabase credentials not configured — job persistence disabled.');
      return null;
    }
    this.supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    return this.supabase;
  }

  /**
   * Attempts to create a new RUNNING job for today using the DB-level unique
   * partial index as the atomicity guard.
   *
   * Returns the job row on success, or null if another job is already active
   * for this scan_date (the unique index conflict causes INSERT to return 0 rows).
   */
  async acquireLock(options: CreateJobOptions): Promise<ScanJobRow | null> {
    const client = this.getClient();
    if (!client) return null;

    const lockExpiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

    const { data, error } = await client
      .from('swing_scan_jobs')
      .insert({
        scan_date: options.scanDate,
        status: 'RUNNING',
        started_at: new Date().toISOString(),
        lock_holder_id: options.lockHolderId,
        lock_acquired_at: new Date().toISOString(),
        lock_expires_at: lockExpiresAt,
        config: options.config,
        updated_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) {
      // Unique constraint violation (code 23505) means another job is active
      if (error.code === '23505') return null;
      console.error('[ScanJobRepository] acquireLock error:', error.message);
      return null;
    }

    return data as ScanJobRow;
  }

  /**
   * Renews the lock lease for the given job (heartbeat).
   * Must be called every ~60 seconds by the running worker.
   * Returns false if the lock was stolen by another holder (should not happen
   * with correct usage, but provides a safety net).
   */
  async renewHeartbeat(jobId: string, lockHolderId: string): Promise<boolean> {
    const client = this.getClient();
    if (!client) return false;

    const newExpiry = new Date(Date.now() + 15 * 60 * 1000).toISOString();

    const { data, error } = await client
      .from('swing_scan_jobs')
      .update({
        lock_expires_at: newExpiry,
        updated_at: new Date().toISOString(),
      })
      .eq('id', jobId)
      .eq('lock_holder_id', lockHolderId)   // Only renew if we still own the lock
      .select('id');

    if (error) {
      console.error('[ScanJobRepository] renewHeartbeat error:', error.message);
      return false;
    }
    return (data?.length ?? 0) > 0;
  }

  /**
   * Writes a checkpoint: progress counts and partial results.
   * Called every CHECKPOINT_EVERY_N_BATCHES batches.
   */
  async writeCheckpoint(jobId: string, lockHolderId: string, update: CheckpointUpdate): Promise<void> {
    const client = this.getClient();
    if (!client) return;

    const { error } = await client
      .from('swing_scan_jobs')
      .update({
        symbols_processed: update.symbolsProcessed,
        symbols_success: update.symbolsSuccess,
        symbols_skipped: update.symbolsSkipped,
        symbols_failed: update.symbolsFailed,
        current_batch: update.currentBatch,
        last_checkpoint_index: update.lastCheckpointIndex,
        checkpoint_data: update.checkpointData,
        updated_at: new Date().toISOString(),
      })
      .eq('id', jobId)
      .eq('lock_holder_id', lockHolderId);

    if (error) {
      // Checkpoint failure is non-fatal — log and continue.
      console.error('[ScanJobRepository] writeCheckpoint error (non-fatal):', error.message);
    }
  }

  /**
   * Updates real-time progress (called after each batch, more frequent than checkpoint).
   * Does not write checkpoint_data — just counts and batch number.
   */
  async updateProgress(
    jobId: string,
    lockHolderId: string,
    update: Omit<CheckpointUpdate, 'checkpointData' | 'lastCheckpointIndex'>
  ): Promise<void> {
    const client = this.getClient();
    if (!client) return;

    const { error } = await client
      .from('swing_scan_jobs')
      .update({
        symbols_processed: update.symbolsProcessed,
        symbols_success: update.symbolsSuccess,
        symbols_skipped: update.symbolsSkipped,
        symbols_failed: update.symbolsFailed,
        current_batch: update.currentBatch,
        updated_at: new Date().toISOString(),
      })
      .eq('id', jobId)
      .eq('lock_holder_id', lockHolderId);

    if (error) {
      // Non-fatal — progress display will lag but scan continues.
      console.warn('[ScanJobRepository] updateProgress error (non-fatal):', error.message);
    }
  }

  /**
   * Finalises the job on scan completion (or failure).
   * Writes final counts, status, run reference, and completion time.
   */
  async finalize(jobId: string, lockHolderId: string, update: FinalUpdate): Promise<void> {
    const client = this.getClient();
    if (!client) return;

    const { error } = await client
      .from('swing_scan_jobs')
      .update({
        status: update.status,
        completed_at: new Date().toISOString(),
        symbols_total: update.symbolsTotal,
        symbols_success: update.symbolsSuccess,
        symbols_skipped: update.symbolsSkipped,
        symbols_failed: update.symbolsFailed,
        symbols_processed: update.symbolsTotal,
        scan_run_id: update.scanRunId ?? null,
        error_message: update.errorMessage ?? null,
        // Release the distributed lock
        lock_holder_id: null,
        lock_acquired_at: null,
        lock_expires_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', jobId)
      .eq('lock_holder_id', lockHolderId);

    if (error) {
      console.error('[ScanJobRepository] finalize error:', error.message);
    }
  }

  /**
   * Fetches today's job (any status). Used by /status and /results endpoints.
   */
  async getJobById(jobId: string): Promise<ScanJobRow | null> {
    const client = this.getClient();
    if (!client) return null;

    const { data, error } = await client
      .from('swing_scan_jobs')
      .select('*')
      .eq('id', jobId)
      .single();

    if (error || !data) return null;
    return data as ScanJobRow;
  }

  /**
   * Fetches the most recent job for a given scan date.
   */
  async getLatestJobForDate(scanDate: string): Promise<ScanJobRow | null> {
    const client = this.getClient();
    if (!client) return null;

    const { data, error } = await client
      .from('swing_scan_jobs')
      .select('*')
      .eq('scan_date', scanDate)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (error || !data) return null;
    return data as ScanJobRow;
  }

  /**
   * Detects and expires stale jobs (lock_expires_at < NOW, status = RUNNING).
   * Returns the number of rows marked FAILED.
   */
  async expireStaleJobs(scanDate: string): Promise<number> {
    const client = this.getClient();
    if (!client) return 0;

    const { data, error } = await client
      .from('swing_scan_jobs')
      .update({
        status: 'FAILED',
        error_message: 'Lock lease expired — worker process died mid-scan. Auto-expired by expireStaleJobs().',
        lock_holder_id: null,
        lock_acquired_at: null,
        lock_expires_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq('scan_date', scanDate)
      .eq('status', 'RUNNING')
      .lt('lock_expires_at', new Date().toISOString())
      .select('id');

    if (error) {
      console.error('[ScanJobRepository] expireStaleJobs error:', error.message);
      return 0;
    }

    const count = data?.length ?? 0;
    if (count > 0) {
      console.warn(`[ScanJobRepository] Expired ${count} stale job(s) for ${scanDate}.`);
    }
    return count;
  }

  /**
   * Checks whether a COMPLETED run already exists for today.
   * Used to prevent re-running a successful scan on the same day.
   */
  async hasCompletedRunForDate(scanDate: string): Promise<boolean> {
    const client = this.getClient();
    if (!client) return false;

    const { data } = await client
      .from('swing_scan_jobs')
      .select('id')
      .eq('scan_date', scanDate)
      .eq('status', 'COMPLETED')
      .limit(1);

    return (data?.length ?? 0) > 0;
  }

  /**
   * Returns the last interrupted (FAILED) job that has a checkpoint to resume from.
   */
  async getResumableJob(scanDate: string): Promise<ScanJobRow | null> {
    const client = this.getClient();
    if (!client) return null;

    const { data, error } = await client
      .from('swing_scan_jobs')
      .select('*')
      .eq('scan_date', scanDate)
      .eq('status', 'FAILED')
      .gt('last_checkpoint_index', 0)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (error || !data) return null;
    return data as ScanJobRow;
  }

  /**
   * Sets a job to ABORTED status. Admin use only (abort endpoint).
   */
  async abortJob(jobId: string): Promise<void> {
    const client = this.getClient();
    if (!client) return;

    await client
      .from('swing_scan_jobs')
      .update({
        status: 'ABORTED',
        completed_at: new Date().toISOString(),
        lock_holder_id: null,
        lock_acquired_at: null,
        lock_expires_at: null,
        error_message: 'Aborted by admin via DELETE /api/indian/swing/nse-scanner/abort',
        updated_at: new Date().toISOString(),
      })
      .eq('id', jobId);
  }
}

export const scanJobRepository = new ScanJobRepository();
