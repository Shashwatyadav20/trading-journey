import { describe, expect, it } from "vitest";
import { Strategy03ShadowScheduler } from "../Strategy03ShadowScheduler.js";
import type { ShadowSignalRecord } from "../Strategy03ShadowRunner.js";

function makeSig(symbol: string, date: string): ShadowSignalRecord {
  return {
    idempotencyKey: `${symbol}|${date}`,
    symbol,
    sector: "IT",
    signalDate: date,
    marketDataTimestamp: `${date}T15:30:00+05:30`,
    evaluationTimestamp: `${date}T15:50:00+05:30`,
    decision: "WATCH",
    score: 42,
    confidence: 0.9,
    verificationStatus: "VERIFIED",
    missingFields: [],
    evidenceSummary: [],
    referencePrice: 1500,
    scoreBreakdown: {} as any,
    immutable: true,
  };
}

describe("Strategy 03 Phase 6.10.7 — Automated Shadow Observation Scheduler", () => {
  it("schedules in Asia/Kolkata, skips weekends, prevents duplicates & historical backfills, and recovers across restarts", async () => {
    const sched = new Strategy03ShadowScheduler({ liveObservationStartDate: "2026-11-17" });

    // Weekend check (2026-11-15 is Sunday)
    const sunEval = sched.evaluateScheduleWindow(new Date("2026-11-15T11:00:00Z"));
    expect(sunEval.isTradingDay).toBe(false);
    expect(sunEval.reason).toBe("WEEKEND");

    // Historical backfill rejection (2026-11-16 < 2026-11-17)
    const histRec = await sched.executeScheduledScan({
      now: new Date("2026-11-16T10:30:00Z"),
      universeSymbols: ["INFY"],
      evaluateSymbol: async (s, d) => makeSig(s, d),
      dataFreshness: { financialRows: 960, ownershipRows: 1297, deliveryRows: 1614, announcementRows: 2354 },
    });
    expect(histRec.status).toBe("FAILED");
    expect(histRec.errorMessage).toContain("HISTORICAL_BACKFILL_FORBIDDEN");

    // Valid live session (2026-11-17 16:00 IST)
    const okRec = await sched.executeScheduledScan({
      now: new Date("2026-11-17T10:30:00Z"),
      universeSymbols: ["INFY"],
      evaluateSymbol: async (s, d) => makeSig(s, d),
      dataFreshness: { financialRows: 960, ownershipRows: 1297, deliveryRows: 1614, announcementRows: 2354 },
    });
    expect(okRec.status).toBe("SUCCESS");
    expect(okRec.runChecksum).toHaveLength(64);
    expect(sched.getSuccessfulObservationDaysCount()).toBe(1);

    // Duplicate same-day scan prevented
    const dupRec = await sched.executeScheduledScan({
      now: new Date("2026-11-17T11:00:00Z"),
      universeSymbols: ["INFY"],
      evaluateSymbol: async (s, d) => makeSig(s, d),
      dataFreshness: okRec.dataFreshness,
    });
    expect(dupRec.status).toBe("SKIPPED_DUPLICATE");

    // Restart recovery preserves completed day and blocks duplicate
    const restarted = new Strategy03ShadowScheduler({ liveObservationStartDate: "2026-11-17" });
    restarted.recoverFromLedgers(sched.getObservationLedger(), sched.getSignalLedger());
    expect(restarted.getSuccessfulObservationDaysCount()).toBe(1);
    const postRestartDup = await restarted.executeScheduledScan({
      now: new Date("2026-11-17T12:00:00Z"),
      universeSymbols: ["INFY"],
      evaluateSymbol: async (s, d) => makeSig(s, d),
      dataFreshness: okRec.dataFreshness,
    });
    expect(postRestartDup.status).toBe("SKIPPED_DUPLICATE");
  });
});

