import { describe, expect, it, vi } from "vitest";
import { Strategy03ShadowService } from "../Strategy03ShadowService.js";
import { Strategy03ShadowPersistence } from "../Strategy03ShadowPersistence.js";
import { DEFAULT_STRATEGY03_PAPER_ISOLATION_CONFIG } from "../Strategy03PaperIsolationConfig.js";

describe("Strategy 03 Phase 6.10.18.3 — Callback Integration & Persistence", () => {
  it("invokes scan callback with correct session date, persists run+signals, and prevents duplicates", async () => {
    const upsertCalls: Array<{ table: string; rows: any }> = [];
    const mockSb: any = {
      from: (table: string) => ({
        upsert: async (rows: any) => {
          upsertCalls.push({ table, rows });
          return { error: null };
        },
      }),
    };
    const persistence = new Strategy03ShadowPersistence(() => mockSb);
    const seenDates: string[] = [];

    const svc = new Strategy03ShadowService({
      liveObservationStartDate: "2026-11-17",
      persistence,
      onRunDue: async (sched, now) => {
        const { istDate } = sched.evaluateScheduleWindow(now);
        seenDates.push(istDate);
        const rec = await sched.executeScheduledScan({
          now,
          universeSymbols: ["INFY"],
          dataFreshness: { financialRows: 5, ownershipRows: 5, deliveryRows: 5, announcementRows: 0 },
          evaluateSymbol: async (sym, obsDate) => ({
            idempotencyKey: `${sym}|${obsDate}`,
            symbol: sym,
            sector: "IT",
            signalDate: obsDate,
            marketDataTimestamp: now.toISOString(),
            evaluationTimestamp: now.toISOString(),
            decision: "BUY_CANDIDATE",
            score: 80,
            confidence: 1,
            verificationStatus: "VERIFIED",
            missingFields: [],
            evidenceSummary: ["ok"],
            referencePrice: 1500,
          }),
        });
        await persistence.persistRunAndSignals({
          run: rec,
          signals: sched.getSignalLedger().filter((s) => s.signalDate === istDate),
          frozenSpecChecksum: svc.getHealthStatus(now).frozenSpecChecksum,
        });
        return rec;
      },
    });

    svc.start({ intervalMs: 60_000 });
    expect(svc.getHealthStatus().callbackRegistered).toBe(true);

    const runTime = new Date("2026-11-18T10:16:00.000Z"); // 15:46 IST
    const rec = await svc.tick(runTime);
    expect(rec?.status).toBe("SUCCESS");
    expect(seenDates).toEqual(["2026-11-18"]);
    expect(upsertCalls.some((c) => c.table === "strategy03_shadow_runs")).toBe(true);
    expect(upsertCalls.some((c) => c.table === "strategy03_shadow_signals")).toBe(true);

    // Duplicate tick prevented
    expect(await svc.tick(runTime)).toBeNull();
    expect(seenDates).toHaveLength(1);
    svc.stop();
  });

  it("handles missed sessions, DB failures without false success, callback exceptions, checksum/safety blocks", async () => {
    const failingPersistence = new Strategy03ShadowPersistence(() => ({
      from: () => ({
        upsert: async () => ({ error: { message: "relation does not exist" } }),
      }),
    }) as any);

    const svc = new Strategy03ShadowService({
      liveObservationStartDate: "2026-11-17",
      persistence: failingPersistence,
      onRunDue: async () => {
        throw new Error("Simulated callback failure");
      },
    });
    svc.start({ intervalMs: 60_000 });

    // Missed session DB failure must NOT report persisted=true
    const missedRes = await svc.recordMissedSession("2026-11-17", "BACKEND_DOWN");
    expect(missedRes.persisted).toBe(false);
    expect(missedRes.error).toContain("relation does not exist");
    expect(svc.getHealthStatus().lastPersistenceStatus).toBe("FAILED");

    // Callback exception increments failureCount and sets EXECUTION_FAILED
    const runTime = new Date("2026-11-18T10:20:00.000Z");
    expect(await svc.tick(runTime)).toBeNull();
    expect(svc.getHealthStatus(runTime).state).toBe("EXECUTION_FAILED");
    expect(svc.getHealthStatus(runTime).failureCount).toBe(1);
    svc.stop();

    // Checksum mismatch blocks execution
    const badChecksum = new Strategy03ShadowService({ expectedFrozenChecksum: "bad" });
    expect(badChecksum.start().started).toBe(false);
    expect(badChecksum.getHealthStatus().state).toBe("SAFETY_BLOCKED");

    // Safety lock violation blocks execution & never creates paper trades or broker calls
    const brokerSpy = vi.fn();
    const badSafety = new Strategy03ShadowService();
    const res = badSafety.start({
      safetyLocks: {
        STRATEGY_01: false,
        STRATEGY_02: false,
        STRATEGY_03: false,
        LIVE_TRADING: true,
        BROKER_EXECUTION_ENABLED: false,
        paperIsolationConfig: DEFAULT_STRATEGY03_PAPER_ISOLATION_CONFIG,
      },
    });
    expect(res.started).toBe(false);
    expect(badSafety.getHealthStatus().state).toBe("SAFETY_BLOCKED");
    expect(brokerSpy).not.toHaveBeenCalled();
  });
});

