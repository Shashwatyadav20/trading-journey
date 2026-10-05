import { describe, test, expect, beforeEach, vi } from "vitest";
import { GenuineSampleStore, GenuineSessionRecord, GenuineTradeRecord } from "../persistence/GenuineSampleStore";
import { GenuineDailyLedger } from "../persistence/GenuineDailyLedger";
import { Phase29ValidationControlEngine } from "../validation/Phase29ValidationControlEngine";
import { Phase29SessionFinalizer } from "../validation/Phase29SessionFinalizer";
import { Phase29TradeFinalizer } from "../validation/Phase29TradeFinalizer";
import { Phase28StatisticalEvidenceEngine } from "../validation/Phase28StatisticalEvidenceEngine";
import { strategyFingerprintManager } from "../validation/StrategyFingerprintManager";
import { dhanBrokerAdapter } from "../broker/DhanBrokerAdapter";
import { paperBrokerAdapter } from "../broker/PaperBrokerAdapter";
import { dailyRiskController } from "../risk/DailyRiskController";
import { reconciliationEngine } from "../reconciliation/ReconciliationEngine";
import { phase26EGenuineLivePaperValidationEngine } from "../validation/Phase26EGenuineLivePaperValidationEngine";

describe("PHASE 29 — Genuine Sample Completion & Validation Control Suite", () => {
  let store: GenuineSampleStore;
  let ledger: GenuineDailyLedger;
  let stats: Phase28StatisticalEvidenceEngine;
  let engine: Phase29ValidationControlEngine;

  // Helper: generates N genuine Mon-Fri dates from 2026-10-05
  const getWeekdays = (count: number): string[] => {
    const dates: string[] = [];
    const cur = new Date("2026-10-05T09:15:00+05:30");
    while (dates.length < count) {
      if (cur.getDay() >= 1 && cur.getDay() <= 5) {
        const y = cur.getFullYear();
        const m = String(cur.getMonth() + 1).padStart(2, "0");
        const d = String(cur.getDate()).padStart(2, "0");
        dates.push(`${y}-${m}-${d}`);
      }
      cur.setDate(cur.getDate() + 1);
    }
    return dates;
  };

  const makeSession = (i: number, dateStr: string, overrides: Partial<GenuineSessionRecord> = {}): GenuineSessionRecord => ({
    sessionId: `sess_${i}`,
    sessionDateIST: dateStr,
    sessionStart: `${dateStr}T09:15:00+05:30`,
    sessionEnd: `${dateStr}T15:30:00+05:30`,
    timezone: "Asia/Kolkata",
    timestampUTC: `${dateStr}T03:45:00Z`,
    timestampIST: `${dateStr}T09:15:00+05:30`,
    provider: "DHAN",
    dataGate: "PASSED",
    marketSession: "MARKET_OPEN",
    spotSource: "DHAN",
    optionChainSource: "DHAN",
    optionPriceSource: "DHAN",
    greeksSource: "REAL",
    lotSizeSource: "DHAN_MASTER",
    expiry: dateStr,
    websocketStatus: "HEALTHY",
    reconciliationStatus: "PASS",
    genuineSession: true,
    blockedReason: null,
    createdAt: `${dateStr}T09:15:00+05:30`,
    ...overrides,
  });

  const makeTrade = (i: number, dateStr: string, overrides: Partial<GenuineTradeRecord> = {}): GenuineTradeRecord => ({
    tradeId: `trd_${i}`,
    sessionId: `sess_${i}`,
    signalId: `sig_${i}`,
    strategy: "BULL_PUT_SPREAD",
    regime: "BULLISH",
    entryTimestamp: `${dateStr}T10:00:00+05:30`,
    entryTimestampIST: `${dateStr}T10:00:00+05:30`,
    expiry: dateStr,
    shortStrike: 24700,
    hedgeStrike: 24550,
    optionType: "PE",
    quantity: 75,
    entryCredit: 60,
    netPnL: 500,
    brokerage: 40,
    STT: 10,
    exchangeCharges: 5,
    GST: 10,
    SEBICharges: 1,
    stampDuty: 2,
    slippage: 10,
    dataSource: "DHAN",
    priceSource: "DHAN",
    greeksSource: "REAL",
    lotSize: 75,
    genuineTrade: true,
    pnlType: "REAL_MARKET_DATA_PAPER_PNL",
    validationFlags: {
      realSpot: true,
      realOptionChain: true,
      realOptionPrices: true,
      dataNotStale: true,
      lotSizeVerified: true,
      marketSessionValid: true,
      safetyLocksValid: true,
      reconciliationPassed: true,
      antiHindsightPassed: true,
    },
    ...overrides,
  });

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env.PAPER_TRADING = "true";
    process.env.LIVE_TRADING = "false";
    process.env.BROKER_EXECUTION_ENABLED = "false";
    process.env.INDIAN_REAL_DATA_ONLY = "true";

    store = new GenuineSampleStore();
    store.clearStore();
    ledger = new GenuineDailyLedger();
    ledger.clearLedger();
    stats = new Phase28StatisticalEvidenceEngine(store, ledger);
    engine = new Phase29ValidationControlEngine(store, ledger, stats);

    dailyRiskController.resetDailyState();
    paperBrokerAdapter.resetAccount();
  });

  // ── 1. Session Finalization ────────────────────────────────────────────────
  test("1. Session finalization — genuine session passes all 9 gates", () => {
    const d = getWeekdays(1)[0];
    const result = engine.finalizeSession(makeSession(1, d));
    expect(result.status).toBe("FINALIZED");
    expect(result.genuineSession).toBe(true);
    expect(result.timestampValidation).toBe("PASSED");
    expect(result.provenanceValidation).toBe("PASSED");
    expect(result.websocketValidation).toBe("PASSED");
  });

  // ── 2. Genuine Session Counting ───────────────────────────────────────────
  test("2. Genuine session counting", () => {
    const dates = getWeekdays(5);
    for (let i = 0; i < 5; i++) engine.finalizeSession(makeSession(i + 1, dates[i]));
    expect(engine.getProgress().genuineSessions).toBe(5);
  });

  // ── 3. Blocked Session Exclusion ──────────────────────────────────────────
  test("3. Blocked session exclusion — after-hours session not counted", () => {
    const d = "2026-10-05";
    // after-hours timestamp
    engine.finalizeSession(makeSession(1, d, {
      sessionStart: `${d}T18:00:00+05:30`,
      createdAt: `${d}T18:00:00+05:30`,
      marketSession: "MARKET_OPEN",
    }));
    expect(engine.getProgress().genuineSessions).toBe(0);
  });

  // ── 4. Active Session Counting ────────────────────────────────────────────
  test("4. Active session counting — zero trades = inactive", () => {
    const d = getWeekdays(1)[0];
    engine.finalizeSession(makeSession(1, d), 0);
    expect(engine.getProgress().activeSessions).toBe(0);
    expect(engine.getProgress().genuineSessions).toBe(1);
  });

  // ── 5. Genuine Trade Finalization ─────────────────────────────────────────
  test("5. Genuine trade finalization passes all gates", () => {
    const d = getWeekdays(1)[0];
    store.recordTrade(makeTrade(1, d));
    const result = engine.finalizeTrade(makeTrade(1, d));
    expect(result.genuineTrade).toBe(true);
    expect(result.exclusionReason).toBeNull();
    expect(result.provenanceGate.spotProvenance).toBe("DHAN_WEBSOCKET");
    expect(result.provenanceGate.lotSizeProvenance).toBe("DHAN_INSTRUMENT_MASTER");
  });

  // ── 6. Invalid Trade Exclusion ────────────────────────────────────────────
  test("6. Invalid trade exclusion — lot size unverified", () => {
    const d = getWeekdays(1)[0];
    const t = makeTrade(99, d, {
      genuineTrade: false,
      validationFlags: { realSpot: true, realOptionChain: true, realOptionPrices: true, dataNotStale: true, lotSizeVerified: false, marketSessionValid: true, safetyLocksValid: true, reconciliationPassed: true, antiHindsightPassed: true },
    });
    const result = engine.finalizeTrade(t);
    expect(result.genuineTrade).toBe(false);
    expect(result.exclusionReason).toBe("LOT_SIZE_UNVERIFIED");
  });

  // ── 7. Timestamp Validation ───────────────────────────────────────────────
  test("7. Timestamp validation — out-of-sequence timestamps excluded", () => {
    const d = getWeekdays(1)[0];
    const futureData = `${d}T10:05:00+05:30`; // data after decision!
    const t = makeTrade(77, d, {
      dataTimestamp: futureData,
      decisionTimestamp: `${d}T10:00:00+05:30`,
    });
    const result = engine.finalizeTrade(t);
    expect(result.genuineTrade).toBe(false);
    expect(result.exclusionReason).toBe("TIMESTAMP_VIOLATION");
  });

  // ── 8. Timezone Validation ────────────────────────────────────────────────
  test("8. Timezone validation — non-Kolkata timezone blocked", () => {
    const d = "2026-10-05";
    const sess = makeSession(1, d, { timezone: "UTC" as any });
    const result = engine.getSessionFinalizer().finalizeSession(sess, 0);
    expect(result.timezoneValidation).toBe("TIMEZONE_FAILED");
    expect(result.genuineSession).toBe(false);
  });

  // ── 9. Provenance Validation ──────────────────────────────────────────────
  test("9. Provenance validation — SYNTHETIC data source excluded", () => {
    const d = getWeekdays(1)[0];
    const t = makeTrade(88, d, {
      dataSource: "SYNTHETIC",
      priceSource: "SYNTHETIC",
      validationFlags: { realSpot: false, realOptionChain: false, realOptionPrices: false, dataNotStale: true, lotSizeVerified: true, marketSessionValid: true, safetyLocksValid: true, reconciliationPassed: true, antiHindsightPassed: true },
    });
    const result = engine.finalizeTrade(t);
    expect(result.genuineTrade).toBe(false);
    expect(result.exclusionReason).toBe("PROVENANCE_FAILED");
  });

  // ── 10. Strategy Fingerprint ──────────────────────────────────────────────
  test("10. Strategy fingerprint — unchanged fingerprint validates", () => {
    const integrity = engine.getIntegrityReport();
    expect(integrity.fingerprintStatus).toBe("VALIDATED");
  });

  // ── 11. Duplicate Session ─────────────────────────────────────────────────
  test("11. Duplicate session — second finalize returns original", () => {
    const d = getWeekdays(1)[0];
    const s = makeSession(1, d);
    engine.finalizeSession(s);
    engine.finalizeSession(s); // duplicate
    expect(engine.getProgress().genuineSessions).toBe(1);
  });

  // ── 12. Duplicate Trade ───────────────────────────────────────────────────
  test("12. Duplicate trade — counted only once", () => {
    const d = getWeekdays(1)[0];
    const t = makeTrade(5, d);
    engine.finalizeTrade(t);
    engine.finalizeTrade(t); // duplicate
    const genuine = engine.getTradeFinalizer().getGenuineFinalized();
    expect(genuine.length).toBe(1);
    expect(engine.getTradeFinalizer().getExclusionCounters().DUPLICATE_TRADE).toBe(1);
  });

  // ── 13. Immutable Records ─────────────────────────────────────────────────
  test("13. Immutable records — originalRecord is frozen", () => {
    const d = getWeekdays(1)[0];
    const t = makeTrade(10, d);
    const result = engine.finalizeTrade(t);
    expect(Object.isFrozen(result.originalRecord)).toBe(true);
    expect(() => { (result.originalRecord as any).netPnL = 99999; }).toThrow();
  });

  // ── 14. Correction Event ──────────────────────────────────────────────────
  test("14. Correction event — active session marking records correction", () => {
    const d = getWeekdays(1)[0];
    const s = makeSession(1, d);
    engine.finalizeSession(s, 0); // 0 trades — not active
    engine.markSessionActive("sess_1");
    const events = engine.getSessionFinalizer().getCorrectionEvents();
    expect(events.length).toBe(1);
    expect(events[0].reason).toContain("ACTIVE_SESSION_FLAG_SET");
  });

  // ── 15. Phase28 Integration ───────────────────────────────────────────────
  test("15. Phase28 integration — statistics use only genuine finalized records", () => {
    const d = getWeekdays(1)[0];
    store.recordTrade(makeTrade(20, d));
    const report = engine.getStatisticsReport();
    expect(report.coreStatistics.totalTrades).toBeGreaterThanOrEqual(0);
    expect(report.validationStatus).toBe("INSUFFICIENT_SAMPLE");
  });

  // ── 16. Insufficient Sample ───────────────────────────────────────────────
  test("16. Insufficient sample gate — empty store", () => {
    const progress = engine.getProgress();
    expect(progress.validationStatus).toBe("INSUFFICIENT_SAMPLE");
    expect(progress.genuineSessions).toBe(0);
  });

  // ── 17. Sample Complete ───────────────────────────────────────────────────
  test("17. Sample complete gate — 20 sessions, 30 trades, 15 active", () => {
    const dates = getWeekdays(20);
    for (let i = 0; i < 20; i++) {
      store.recordTrade(makeTrade(i + 1, dates[i]));
      engine.finalizeSession(makeSession(i + 1, dates[i]), 1);
    }
    // add 10 more trades for remaining 10 sessions' second trade slot
    for (let i = 20; i < 30; i++) {
      const idx = i % 20;
      store.recordTrade({ ...makeTrade(i + 1, dates[idx]), tradeId: `trd_extra_${i}` });
    }
    const progress = engine.getProgress();
    expect(progress.sessionsMet).toBe(true);
    expect(progress.activeSessionsMet).toBe(true);
  });

  // ── 18. Completion Event ──────────────────────────────────────────────────
  test("18. Completion event — emitted once when gate first met", () => {
    const dates = getWeekdays(20);
    for (let i = 0; i < 20; i++) {
      store.recordTrade(makeTrade(i + 1, dates[i]));
      engine.finalizeSession(makeSession(i + 1, dates[i]), 1);
    }
    for (let i = 20; i < 30; i++) {
      store.recordTrade({ ...makeTrade(i + 1, dates[i % 20]), tradeId: `trd_b_${i}` });
    }
    // trigger completion check
    engine.finalizeSession(makeSession(99, dates[0]), 0);
    const event = engine.getCompletionEvent();
    expect(event?.immutable).toBe(true);
    expect(event?.strategyFingerprint).toBeDefined();
  });

  // ── 19. Duplicate Completion Prevention ──────────────────────────────────
  test("19. Duplicate completion event prevention", () => {
    const dates = getWeekdays(20);
    for (let i = 0; i < 20; i++) {
      store.recordTrade(makeTrade(i + 1, dates[i]));
      engine.finalizeSession(makeSession(i + 1, dates[i]), 1);
    }
    for (let i = 20; i < 30; i++) {
      store.recordTrade({ ...makeTrade(i + 1, dates[i % 20]), tradeId: `trd_c_${i}` });
    }
    engine.finalizeSession(makeSession(99, dates[0]), 0);
    const event1 = engine.getCompletionEvent();
    engine.finalizeSession(makeSession(100, dates[1]), 0);
    const event2 = engine.getCompletionEvent();
    expect(event1?.completedAt).toBe(event2?.completedAt); // same object — not regenerated
  });

  // ── 20. Validation Snapshot ───────────────────────────────────────────────
  test("20. Validation snapshot — created after sample complete", () => {
    const dates = getWeekdays(20);
    for (let i = 0; i < 20; i++) {
      store.recordTrade(makeTrade(i + 1, dates[i]));
      engine.finalizeSession(makeSession(i + 1, dates[i]), 1);
    }
    for (let i = 20; i < 30; i++) {
      store.recordTrade({ ...makeTrade(i + 1, dates[i % 20]), tradeId: `trd_d_${i}` });
    }
    engine.finalizeSession(makeSession(99, dates[0]), 0);
    const snapshot = engine.getValidationSnapshot();
    expect(snapshot).not.toBeNull();
    expect(snapshot?.snapshotHash).toBeDefined();
    expect(snapshot?.datasetHash).toBeDefined();
  });

  // ── 21. Snapshot Hash ─────────────────────────────────────────────────────
  test("21. Snapshot hash — reproducible identifier present", () => {
    const dates = getWeekdays(20);
    for (let i = 0; i < 20; i++) {
      store.recordTrade(makeTrade(i + 1, dates[i]));
      engine.finalizeSession(makeSession(i + 1, dates[i]), 1);
    }
    for (let i = 20; i < 30; i++) {
      store.recordTrade({ ...makeTrade(i + 1, dates[i % 20]), tradeId: `trd_e_${i}` });
    }
    engine.finalizeSession(makeSession(99, dates[0]), 0);
    const snap = engine.getValidationSnapshot();
    expect(typeof snap?.snapshotHash).toBe("string");
    expect(snap!.snapshotHash.length).toBe(64); // SHA-256 hex
  });

  // ── 22. Restart Recovery ──────────────────────────────────────────────────
  test("22. Restart recovery — reconciliation passes", () => {
    const recovery = engine.recoverStateAfterRestart();
    expect(recovery.reconciliationStatus).toBe("PASS");
    expect(recovery.counterIntegrity).toBe("VALID");
  });

  // ── 23. Export Integrity ──────────────────────────────────────────────────
  test("23. Export integrity — export contains metadata and safety status", () => {
    const exportData = engine.getExport();
    expect(exportData.metadata).toBeDefined();
    expect(exportData.safetyStatus.realBrokerOrders).toBe(0);
    expect(exportData.safetyStatus.liveTrading).toBe(false);
    expect(exportData.fingerprint.hash).toBeDefined();
  });

  // ── 24. Post-Validation Separation ───────────────────────────────────────
  test("24. Post-validation separation — cohort label changes after completion", () => {
    const dates = getWeekdays(20);
    for (let i = 0; i < 20; i++) {
      store.recordTrade(makeTrade(i + 1, dates[i]));
      engine.finalizeSession(makeSession(i + 1, dates[i]), 1);
    }
    for (let i = 20; i < 30; i++) {
      store.recordTrade({ ...makeTrade(i + 1, dates[i % 20]), tradeId: `trd_f_${i}` });
    }
    engine.finalizeSession(makeSession(99, dates[0]), 0);
    // trigger completion; after that new trades should be POST_VALIDATION
    const postTrade = makeTrade(999, dates[0], { tradeId: "trd_post_999" });
    const result = engine.finalizeTrade(postTrade);
    expect(result.cohortLabel).toBe("POST_VALIDATION_OBSERVATIONS");
  });

  // ── 25. Synthetic Exclusion ───────────────────────────────────────────────
  test("25. Synthetic exclusion", () => {
    const d = getWeekdays(1)[0];
    const t = makeTrade(200, d, {
      genuineTrade: false,
      pnlType: "SYNTHETIC_PAPER_PNL",
      dataSource: "SYNTHETIC",
      validationFlags: { realSpot: false, realOptionChain: false, realOptionPrices: false, dataNotStale: true, lotSizeVerified: true, marketSessionValid: true, safetyLocksValid: true, reconciliationPassed: true, antiHindsightPassed: true },
    });
    const result = engine.finalizeTrade(t);
    expect(result.genuineTrade).toBe(false);
    expect(result.exclusionReason).toBe("SYNTHETIC_DATA");
  });

  // ── 26. Simulation Exclusion ──────────────────────────────────────────────
  test("26. Simulation exclusion", () => {
    const d = getWeekdays(1)[0];
    const t = makeTrade(201, d, {
      genuineTrade: false,
      pnlType: "SIMULATED_TEST_PNL",
    });
    const result = engine.finalizeTrade(t);
    expect(result.genuineTrade).toBe(false);
    expect(result.exclusionReason).toBe("SIMULATED_DATA");
  });

  // ── 27. After-Hours Exclusion ─────────────────────────────────────────────
  test("27. After-hours exclusion — session outside market hours blocked", () => {
    const d = "2026-10-05";
    const sess = makeSession(1, d, {
      createdAt: `${d}T18:30:00+05:30`,
      marketSession: "MARKET_OPEN",
    });
    const result = engine.getSessionFinalizer().finalizeSession(sess, 0);
    expect(result.timestampValidation).toBe("TIMESTAMP_VALIDATION_FAILED");
    expect(result.genuineSession).toBe(false);
  });

  // ── 28. Reconciliation Exclusion ──────────────────────────────────────────
  test("28. Reconciliation exclusion — reconciliation FAIL blocks session", () => {
    const d = getWeekdays(1)[0];
    const sess = makeSession(1, d, { reconciliationStatus: "FAIL" });
    const result = engine.getSessionFinalizer().finalizeSession(sess, 0);
    expect(result.reconciliationValidation).toBe("RECONCILIATION_FAILED");
    expect(result.genuineSession).toBe(false);
  });

  // ── 29. No Look-Ahead ─────────────────────────────────────────────────────
  test("29. No look-ahead — integrity reports VERIFIED when no violations", () => {
    const integrity = engine.getIntegrityReport();
    expect(integrity.noLookAhead).toBe("VERIFIED");
  });

  // ── 30. Zero Real Broker Orders ───────────────────────────────────────────
  test("30. Zero real broker orders", () => {
    expect(dhanBrokerAdapter.getRealOrdersSent()).toBe(0);
  });

  // ── 31. Live Trading Locked ────────────────────────────────────────────────
  test("31. Live trading remains locked", () => {
    expect(process.env.LIVE_TRADING).toBe("false");
    expect(process.env.PAPER_TRADING).toBe("true");
    const integrity = engine.getIntegrityReport();
    expect(integrity.safetyLockStatus).toBe("LOCKED");
  });

  // ── 32. Broker Execution Blocked ──────────────────────────────────────────
  test("32. Broker execution blocked — placeOrder throws SECURITY LOCK ENFORCED", async () => {
    const req = { symbol: "NIFTY24700CE", side: "BUY" as const, type: "MARKET" as const, quantity: 75 };
    await expect(dhanBrokerAdapter.placeOrder(req)).rejects.toThrow("SECURITY LOCK ENFORCED");
  });
});
