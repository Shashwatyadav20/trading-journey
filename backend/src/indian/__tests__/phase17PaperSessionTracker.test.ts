import { describe, it, expect, beforeEach } from "vitest";
import { Phase17PaperSessionTracker } from "../lifecycle/Phase17PaperSessionTracker";

describe("Phase 17 — Paper Session Tracker Test Suite", () => {
  let tracker: Phase17PaperSessionTracker;

  beforeEach(() => {
    tracker = new Phase17PaperSessionTracker();
  });

  it("1. Initializes with BLOCKED gate and false genuine sample status", () => {
    const session = tracker.getCurrentSession();
    expect(session.dataGate).toBe("BLOCKED");
    expect(session.isGenuinePaperSample).toBe(false);
    expect(session.signals).toBe(0);
    expect(session.entries).toBe(0);
    expect(session.exits).toBe(0);
  });

  it("2. Distinguishes REAL genuine paper sample when all three sources are REAL", () => {
    tracker.updateDataSources("REAL", "REAL", "REAL", "NSE_INDIA");
    const session = tracker.getCurrentSession();
    expect(session.isGenuinePaperSample).toBe(true);
    expect(session.dataGate).toBe("READY");
  });

  it("3. Marks sample as non-genuine if any single source is SYNTHETIC", () => {
    tracker.updateDataSources("REAL", "SYNTHETIC", "REAL", "NSE_INDIA");
    const session = tracker.getCurrentSession();
    expect(session.isGenuinePaperSample).toBe(false);
    expect(session.dataGate).toBe("BLOCKED");
  });

  it("4. Tracks signal evaluations and no-trade reason codes accurately", () => {
    tracker.recordSignal("DATA_STALE");
    tracker.recordSignal("DATA_STALE");
    tracker.recordSignal("LOT_SIZE_UNVERIFIED");
    tracker.recordSignal(null); // Accepted signal

    const session = tracker.getCurrentSession();
    expect(session.signals).toBe(4);
    expect(session.noTradeReasons["DATA_STALE"]).toBe(2);
    expect(session.noTradeReasons["LOT_SIZE_UNVERIFIED"]).toBe(1);
  });

  it("5. Accumulates trades, gross/net PnL, charges, slippage, and max drawdown", () => {
    tracker.recordTradeEntry(20, 50);
    tracker.recordTradeExit(1000, 930, 20, 50); // Winner
    tracker.recordTradeExit(-500, -570, 20, 50); // Loser

    const session = tracker.getCurrentSession();
    expect(session.entries).toBe(1);
    expect(session.exits).toBe(2);
    expect(session.grossPnl).toBe(500); // 1000 - 500
    expect(session.netPnl).toBe(360); // 930 - 570
    expect(session.charges).toBe(60); // 20 entry + 20 + 20 exit
    expect(session.slippage).toBe(150); // 50 entry + 50 + 50 exit
    expect(session.maxDrawdown).toBe(570);
  });
});
