import { describe, expect, it } from "vitest";
import { Strategy03ShadowService } from "../Strategy03ShadowService.js";
import { DEFAULT_STRATEGY03_PAPER_ISOLATION_CONFIG } from "../Strategy03PaperIsolationConfig.js";

describe("Strategy 03 Phase 6.10.18.1 — Shadow Scheduler Startup Integration", () => {
  it("registers once, enforces Asia/Kolkata 15:45 window, prevents duplicates, and stops gracefully", async () => {
    let runCount = 0;
    const svc = new Strategy03ShadowService({
      liveObservationStartDate: "2026-11-17",
      onRunDue: async (sched, now) => {
        runCount += 1;
        return sched.executeScheduledScan({
          now,
          universeSymbols: ["INFY"],
          dataFreshness: { financialRows: 10, ownershipRows: 5, deliveryRows: 20, announcementRows: 0 },
          evaluateSymbol: async (sym, obsDate) => ({
            idempotencyKey: `${sym}|${obsDate}`,
            symbol: sym,
            sector: "IT",
            signalDate: obsDate,
            marketDataTimestamp: now.toISOString(),
            evaluationTimestamp: now.toISOString(),
            decision: "WATCH",
            score: 72,
            confidence: 0.9,
            verificationStatus: "VERIFIED",
            missingFields: [],
            evidenceSummary: [],
            referencePrice: 1500,
          }),
        });
      },
    });

    expect(svc.getHealthStatus().state).toBe("NOT_REGISTERED");

    const firstStart = svc.start({ intervalMs: 60_000 });
    expect(firstStart.started).toBe(true);
    expect(firstStart.duplicatePrevented).toBe(false);

    // Duplicate registration prevented
    const dupStart = svc.start({ intervalMs: 60_000 });
    expect(dupStart.started).toBe(false);
    expect(dupStart.duplicatePrevented).toBe(true);

    // Before 15:45 IST -> WAITING_FOR_WINDOW, does not execute
    const beforeWindow = new Date("2026-11-17T09:30:00.000Z"); // 15:00 IST
    expect(await svc.tick(beforeWindow)).toBeNull();
    expect(svc.getHealthStatus(beforeWindow).state).toBe("WAITING_FOR_WINDOW");

    // At/after 15:45 IST -> executes once
    const afterWindow = new Date("2026-11-17T10:16:00.000Z"); // 15:46 IST
    const rec = await svc.tick(afterWindow);
    expect(rec).not.toBeNull();
    expect(rec!.status).toBe("SUCCESS");
    expect(runCount).toBe(1);
    expect(svc.getHealthStatus(afterWindow).state).toBe("EXECUTED_SUCCESSFULLY");
    expect(svc.getHealthStatus(afterWindow).checksumVerified).toBe(true);

    // Second tick same day -> duplicate prevented
    expect(await svc.tick(afterWindow)).toBeNull();
    expect(runCount).toBe(1);

    // Weekend / holiday excluded (2026-11-21 Saturday)
    expect(await svc.tick(new Date("2026-11-21T10:30:00.000Z"))).toBeNull();

    // Graceful shutdown
    svc.stop();
    expect(svc.getHealthStatus(afterWindow).backendProcessActive).toBe(false);
  });

  it("blocks execution on safety lock violation or checksum mismatch, and excludes historical backfill on recovery", async () => {
    const blockedSvc = new Strategy03ShadowService({ liveObservationStartDate: "2026-11-17" });
    const startBad = blockedSvc.start({
      safetyLocks: {
        STRATEGY_01: false,
        STRATEGY_02: false,
        STRATEGY_03: true,
        LIVE_TRADING: false,
        BROKER_EXECUTION_ENABLED: false,
        paperIsolationConfig: DEFAULT_STRATEGY03_PAPER_ISOLATION_CONFIG,
      },
    });
    expect(startBad.started).toBe(false);
    expect(blockedSvc.getHealthStatus().state).toBe("SAFETY_BLOCKED");

    const badChecksumSvc = new Strategy03ShadowService({
      liveObservationStartDate: "2026-11-17",
      expectedFrozenChecksum: "0000badchecksum",
    });
    expect(badChecksumSvc.start().started).toBe(false);
    expect(badChecksumSvc.getHealthStatus().checksumVerified).toBe(false);

    // Restart recovery ignores historical dates < 2026-11-17 and tracks missed sessions
    const recSvc = new Strategy03ShadowService({ liveObservationStartDate: "2026-11-17" });
    recSvc.recoverPersistedState(
      [
        {
          runId: "old-1",
          observationDate: "2026-11-10",
          scheduledTimeIst: "2026-11-10T15:45:00+05:30",
          actualStartTime: "2026-11-10T10:15:00Z",
          completionTime: "2026-11-10T10:16:00Z",
          status: "SUCCESS",
          marketDataTimestamp: null,
          evaluationTimestamp: "2026-11-10T10:16:00Z",
          universeCount: 1,
          evaluatedSymbolsCount: 1,
          failedSymbols: [],
          decisionCounts: { BUY_CANDIDATE: 0, WATCH: 1, WAIT: 0, SELL_CANDIDATE: 0 },
          verificationDistribution: { VERIFIED: 1 },
          dataFreshness: { financialRows: 1, ownershipRows: 1, deliveryRows: 1, announcementRows: 0 },
          runChecksum: "abc",
        },
      ],
      []
    );
    expect(recSvc.getScheduler().getSuccessfulObservationDaysCount()).toBe(0);
    await recSvc.recordMissedSession("2026-11-17", "TEST_MISSED");
    expect(recSvc.getHealthStatus().missedSessions).toContain("2026-11-17");
  });
});
