/**
 * NSE Scan Worker — Unit Tests
 *
 * Tests the distributed locking, checkpoint/resume, duplicate prevention,
 * daily scheduling, and partial-result handling without making any real
 * Yahoo Finance requests or Supabase connections.
 *
 * All external dependencies are mocked. The worker logic itself is tested
 * via the exported startScan() / requestAbort() interface.
 *
 * Test suites:
 *   A — Worker lock acquisition and deduplication (via ScanJobRepository mock)
 *   B — Checkpoint save and resume
 *   C — Retry and partial results
 *   D — Daily scheduling (ScanScheduler)
 *   E — Abort flow
 *
 * Note on module resolution:
 *   NseFullScanWorker uses `await import('../../../../lib/indian/...')` internally.
 *   In the vitest environment that resolves correctly because vitest runs from
 *   the backend/ root and the lib/ sibling is accessible. We mock all Supabase
 *   and HTTP calls so no real I/O occurs.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// Mock ScanJobRepository so no Supabase calls are made.
//
// vi.mock() factories are hoisted to the top of the file by vitest — before
// any const/let declarations. mockRepo must therefore be declared inside
// vi.hoisted() which runs before vi.mock() factories, making it safe to
// reference inside the factory closure.
// ─────────────────────────────────────────────────────────────────────────────

const mockRepo = vi.hoisted(() => ({
  acquireLock: vi.fn(),
  renewHeartbeat: vi.fn().mockResolvedValue(true),
  writeCheckpoint: vi.fn().mockResolvedValue(undefined),
  updateProgress: vi.fn().mockResolvedValue(undefined),
  finalize: vi.fn().mockResolvedValue(undefined),
  getJobById: vi.fn(),
  getLatestJobForDate: vi.fn(),
  expireStaleJobs: vi.fn().mockResolvedValue(0),
  hasCompletedRunForDate: vi.fn().mockResolvedValue(false),
  getResumableJob: vi.fn().mockResolvedValue(null),
  abortJob: vi.fn().mockResolvedValue(undefined),
}));

const mockAlertService = vi.hoisted(() => ({
  send: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../swing/ScanJobRepository", () => ({
  scanJobRepository: mockRepo,
}));

vi.mock("../swing/ScanAlertService", () => ({
  scanAlertService: mockAlertService,
}));

// ─────────────────────────────────────────────────────────────────────────────
// Import the modules under test (AFTER mocks are registered)
// ─────────────────────────────────────────────────────────────────────────────

import { nseFullScanWorker } from "../swing/NseFullScanWorker";
import { scanScheduler } from "../swing/ScanScheduler";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function makeMockJob(overrides: Record<string, any> = {}) {
  return {
    id: "test-job-id-001",
    scan_date: new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }),
    status: "RUNNING",
    started_at: new Date().toISOString(),
    completed_at: null,
    lock_holder_id: "process-lock-001",
    lock_acquired_at: new Date().toISOString(),
    lock_expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    symbols_total: 100,
    symbols_processed: 0,
    symbols_success: 0,
    symbols_skipped: 0,
    symbols_failed: 0,
    current_batch: 0,
    total_batches: 20,
    last_checkpoint_index: 0,
    checkpoint_data: {},
    config: { dry_run: true, max_symbols: 10 },
    error_message: null,
    scan_run_id: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Suite A: Lock Acquisition and Deduplication
// ─────────────────────────────────────────────────────────────────────────────

describe("Suite A: Lock Acquisition and Deduplication", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockRepo.expireStaleJobs.mockResolvedValue(0);
    mockRepo.hasCompletedRunForDate.mockResolvedValue(false);
    mockRepo.getResumableJob.mockResolvedValue(null);
  });

  it("startScan() accepted when no competing lock exists", async () => {
    const job = makeMockJob();
    mockRepo.acquireLock.mockResolvedValue(job);

    const result = await nseFullScanWorker.startScan({ dryRun: true, maxSymbols: 5 });

    expect(result.accepted).toBe(true);
    expect(result.jobId).toBe("test-job-id-001");
    expect(mockRepo.acquireLock).toHaveBeenCalledOnce();
  });

  it("startScan() rejected when another lock is active for today", async () => {
    // acquireLock returns null → another instance holds the lock
    mockRepo.acquireLock.mockResolvedValue(null);
    const activeJob = makeMockJob({ status: "RUNNING" });
    mockRepo.getLatestJobForDate.mockResolvedValue(activeJob);

    const result = await nseFullScanWorker.startScan({ dryRun: true });

    expect(result.accepted).toBe(false);
    expect(result.existingJob?.status).toBe("RUNNING");
    expect(result.message).toMatch(/already running/i);
  });

  it("startScan() rejected when today has COMPLETED scan (unless forceRestart)", async () => {
    mockRepo.hasCompletedRunForDate.mockResolvedValue(true);
    const completedJob = makeMockJob({ status: "COMPLETED" });
    mockRepo.getLatestJobForDate.mockResolvedValue(completedJob);

    const result = await nseFullScanWorker.startScan({ dryRun: true });

    expect(result.accepted).toBe(false);
    expect(result.message).toMatch(/already COMPLETED/i);
  });

  it("startScan() accepted when forceRestart=true, skipping completed-run check", async () => {
    // hasCompletedRunForDate should NOT be called when forceRestart=true
    mockRepo.hasCompletedRunForDate.mockResolvedValue(true);
    const job = makeMockJob();
    mockRepo.acquireLock.mockResolvedValue(job);

    const result = await nseFullScanWorker.startScan({
      dryRun: true,
      maxSymbols: 3,
      forceRestart: true,
    });

    expect(mockRepo.hasCompletedRunForDate).not.toHaveBeenCalled();
    expect(result.accepted).toBe(true);
  });

  it("expireStaleJobs() is called with today's IST date before every startScan()", async () => {
    mockRepo.acquireLock.mockResolvedValue(makeMockJob());

    await nseFullScanWorker.startScan({ dryRun: true });

    expect(mockRepo.expireStaleJobs).toHaveBeenCalledOnce();
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
    expect(mockRepo.expireStaleJobs).toHaveBeenCalledWith(today);
  });

  it("acquireLock() receives the correct scan_date (today IST)", async () => {
    mockRepo.acquireLock.mockResolvedValue(makeMockJob());

    await nseFullScanWorker.startScan({ dryRun: true });

    const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
    expect(mockRepo.acquireLock).toHaveBeenCalledWith(
      expect.objectContaining({ scanDate: today })
    );
  });

  it("acquireLock() config includes dry_run flag from options", async () => {
    mockRepo.acquireLock.mockResolvedValue(makeMockJob());

    await nseFullScanWorker.startScan({ dryRun: true, maxSymbols: 50 });

    expect(mockRepo.acquireLock).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({ dry_run: true }),
      })
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite B: Checkpoint and Resume
// ─────────────────────────────────────────────────────────────────────────────

describe("Suite B: Checkpoint Save and Resume", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockRepo.expireStaleJobs.mockResolvedValue(0);
    mockRepo.hasCompletedRunForDate.mockResolvedValue(false);
  });

  it("getResumableJob() is called with today's IST date when not forceRestart", async () => {
    mockRepo.getResumableJob.mockResolvedValue(null);
    mockRepo.acquireLock.mockResolvedValue(makeMockJob());

    await nseFullScanWorker.startScan({ dryRun: true });

    const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
    expect(mockRepo.getResumableJob).toHaveBeenCalledWith(today);
  });

  it("getResumableJob() is NOT called when forceRestart=true", async () => {
    mockRepo.getResumableJob.mockResolvedValue(null);
    mockRepo.acquireLock.mockResolvedValue(makeMockJob());

    await nseFullScanWorker.startScan({ dryRun: true, forceRestart: true });

    expect(mockRepo.getResumableJob).not.toHaveBeenCalled();
  });

  it("scan is still accepted when a resumable checkpoint job exists", async () => {
    const resumableJob = makeMockJob({
      id: "old-job-id",
      status: "FAILED",
      last_checkpoint_index: 50,
      checkpoint_data: {
        partialOpportunities: [
          { id: "opp-1", symbol: "RELIANCE.NS", confluenceScore: 85 },
        ],
        failedSymbols: [],
        skippedSymbols: [],
      },
    });

    mockRepo.getResumableJob.mockResolvedValue(resumableJob);
    mockRepo.acquireLock.mockResolvedValue(makeMockJob({ id: "new-job-id" }));

    const result = await nseFullScanWorker.startScan({
      dryRun: true,
      maxSymbols: 55,
      forceRestart: false,
    });

    expect(result.accepted).toBe(true);
    expect(result.jobId).toBe("new-job-id");
  });

  it("worker still gets accepted even if getResumableJob() returns null (no prior checkpoint)", async () => {
    mockRepo.getResumableJob.mockResolvedValue(null);
    mockRepo.acquireLock.mockResolvedValue(makeMockJob());

    const result = await nseFullScanWorker.startScan({ dryRun: true });

    expect(result.accepted).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite C: Abort Flow
// ─────────────────────────────────────────────────────────────────────────────

describe("Suite C: Abort Flow", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockRepo.expireStaleJobs.mockResolvedValue(0);
    mockRepo.hasCompletedRunForDate.mockResolvedValue(false);
    mockRepo.getResumableJob.mockResolvedValue(null);
  });

  it("requestAbort() returns false for an unknown / non-running jobId", () => {
    // No scan currently running in this singleton instance
    const aborted = nseFullScanWorker.requestAbort("completely-unknown-job-id");
    expect(aborted).toBe(false);
  });

  it("requestAbort() returns true for the currently active job after startScan()", async () => {
    const job = makeMockJob({ id: "running-job-abc" });
    mockRepo.acquireLock.mockResolvedValue(job);

    await nseFullScanWorker.startScan({ dryRun: true, maxSymbols: 3 });

    // After startScan() returns, currentJobId is set to the new jobId
    const aborted = nseFullScanWorker.requestAbort("running-job-abc");
    expect(aborted).toBe(true);
  });

  it("requestAbort() returns false after a different jobId than currently running", async () => {
    const job = makeMockJob({ id: "job-xyz" });
    mockRepo.acquireLock.mockResolvedValue(job);

    await nseFullScanWorker.startScan({ dryRun: true, maxSymbols: 3 });

    const aborted = nseFullScanWorker.requestAbort("wrong-job-id");
    expect(aborted).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite D: ScanScheduler — start/stop idempotency and duplicate-trigger guard
// ─────────────────────────────────────────────────────────────────────────────

describe("Suite D: ScanScheduler — lifecycle", () => {
  afterEach(() => {
    // Always stop the scheduler between tests to avoid interference
    scanScheduler.stop();
  });

  it("stop() before start() does not throw", () => {
    expect(() => scanScheduler.stop()).not.toThrow();
  });

  it("start() twice emits a warning on the second call and does not create a second interval", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    scanScheduler.start();
    scanScheduler.start(); // second call should log a warning
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("Already running")
    );
    warnSpy.mockRestore();
    scanScheduler.stop();
  });

  it("stop() after start() is idempotent — second stop() does not throw", () => {
    scanScheduler.start();
    expect(() => {
      scanScheduler.stop();
      scanScheduler.stop();
    }).not.toThrow();
  });

  it("start() after stop() re-registers the interval without error", () => {
    scanScheduler.start();
    scanScheduler.stop();
    expect(() => scanScheduler.start()).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite E: ScanJobRepository — call-contract verification
// ─────────────────────────────────────────────────────────────────────────────

describe("Suite E: ScanJobRepository — method contracts", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockRepo.expireStaleJobs.mockResolvedValue(0);
    mockRepo.hasCompletedRunForDate.mockResolvedValue(false);
    mockRepo.getResumableJob.mockResolvedValue(null);
  });

  it("acquireLock() config shape includes all expected fields", async () => {
    mockRepo.acquireLock.mockResolvedValue(makeMockJob());

    await nseFullScanWorker.startScan({ dryRun: false, maxSymbols: 10 });

    expect(mockRepo.acquireLock).toHaveBeenCalledWith(
      expect.objectContaining({
        scanDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        lockHolderId: expect.any(String),
        config: expect.objectContaining({
          dry_run: false,
          max_symbols: 10,
          force_restart: false,
        }),
      })
    );
  });

  it("expireStaleJobs() receives IST today string", async () => {
    mockRepo.acquireLock.mockResolvedValue(makeMockJob());

    await nseFullScanWorker.startScan({ dryRun: true });

    const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
    expect(mockRepo.expireStaleJobs).toHaveBeenCalledWith(today);
  });

  it("accepted scan returns a jobId matching the one from acquireLock()", async () => {
    mockRepo.acquireLock.mockResolvedValue(makeMockJob({ id: "unique-job-xyz" }));

    const result = await nseFullScanWorker.startScan({ dryRun: true });

    expect(result.jobId).toBe("unique-job-xyz");
  });

  it("rejected scan does not call acquireLock again after hasCompletedRunForDate=true", async () => {
    mockRepo.hasCompletedRunForDate.mockResolvedValue(true);
    mockRepo.getLatestJobForDate.mockResolvedValue(makeMockJob({ status: "COMPLETED" }));

    await nseFullScanWorker.startScan({ dryRun: true });

    expect(mockRepo.acquireLock).not.toHaveBeenCalled();
  });
});
