import { describe, expect, it } from "vitest";
import {
  appendShadowSignalsImmutable,
  loadAllRowsPaginated,
  Strategy03ShadowRunner,
  trackForwardReturns,
} from "../Strategy03ShadowRunner.js";
import type { DailyCandleBar } from "../HistoricalValidationEngine.js";

describe("Strategy 03 Phase 6.9 — Shadow Forward Validation Runner", () => {
  it("paginates beyond 1,000 rows without truncation", async () => {
    const mockRows = Array.from({ length: 1250 }, (_, i) => ({ id: i }));
    const mockSb = {
      from: () => ({
        select: () => ({
          range: async (from: number, to: number) => ({
            data: mockRows.slice(from, to + 1),
            error: null,
          }),
        }),
      }),
    };
    const loaded = await loadAllRowsPaginated(mockSb as any, "test_table", "*", 1000);
    expect(loaded).toHaveLength(1250);
  });

  it("prevents duplicate daily signals and keeps historical ledger immutable", () => {
    const runner = new Strategy03ShadowRunner();
    const s1 = runner.evaluateSymbolAsOf({
      symbol: "INFY",
      sector: "IT",
      signalDate: "2026-11-17",
      financials: [],
      ownership: [],
      announcements: [],
      candles: [],
    });
    expect(s1.decision).toBe("WAIT"); // Missing critical financials -> WAIT
    expect(s1.immutable).toBe(true);

    const r1 = appendShadowSignalsImmutable([], [s1]);
    expect(r1.addedCount).toBe(1);
    const r2 = appendShadowSignalsImmutable(r1.ledger, [{ ...s1, score: 99 }]);
    expect(r2.addedCount).toBe(0);
    expect(r2.skippedDuplicatesCount).toBe(1);
    expect(r2.ledger[0].score).toBe(s1.score); // Original immutable record untouched
  });

  it("computes forward 1D/5D/MFE/MAE returns strictly from post-signal adjusted prices", () => {
    const runner = new Strategy03ShadowRunner();
    const bars: DailyCandleBar[] = [
      { date: "2026-08-18", open: 100, high: 100, low: 100, close: 100, adjClose: 100, volume: 100000 },
      { date: "2026-08-19", open: 100, high: 103, low: 99, close: 102, adjClose: 102, volume: 100000 },
      { date: "2026-08-20", open: 102, high: 106, low: 101, close: 105, adjClose: 105, volume: 100000 },
      { date: "2026-08-21", open: 105, high: 105, low: 97, close: 98, adjClose: 98, volume: 100000 },
      { date: "2026-08-24", open: 98, high: 104, low: 98, close: 104, adjClose: 104, volume: 100000 },
      { date: "2026-08-25", open: 104, high: 108, low: 103, close: 108, adjClose: 108, volume: 100000 },
    ];
    const sig = runner.evaluateSymbolAsOf({
      symbol: "TEST",
      sector: "IT",
      signalDate: "2026-08-18",
      financials: [],
      ownership: [],
      announcements: [],
      candles: bars,
    });
    const obs = trackForwardReturns(sig, bars);
    expect(obs).not.toBeNull();
    expect(obs!.ret1dPct).toBe(2);
    expect(obs!.ret5dPct).toBe(8);
    expect(obs!.mfePct).toBe(8);
    expect(obs!.maePct).toBe(-2);
  });
});

