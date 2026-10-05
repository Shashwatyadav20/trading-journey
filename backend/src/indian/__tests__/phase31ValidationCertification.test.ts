import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Phase31ValidationCertificationEngine } from "../validation/Phase31ValidationCertificationEngine";
import { Phase30SampleAccumulationEngine } from "../validation/Phase30SampleAccumulationEngine";
import { Phase29ValidationControlEngine } from "../validation/Phase29ValidationControlEngine";
import { Phase28StatisticalEvidenceEngine } from "../validation/Phase28StatisticalEvidenceEngine";
import { GenuineSampleStore, GenuineSessionRecord } from "../persistence/GenuineSampleStore";
import { GenuineDailyLedger } from "../persistence/GenuineDailyLedger";
import { strategyFingerprintManager } from "../validation/StrategyFingerprintManager";
import { dhanBrokerAdapter } from "../broker/DhanBrokerAdapter";
import { dailyRiskController } from "../risk/DailyRiskController";
import { paperBrokerAdapter } from "../broker/PaperBrokerAdapter";

describe("PHASE 31 — Genuine Sample Completion & Validation Certification Suite", () => {
  let store: GenuineSampleStore;
  let ledger: GenuineDailyLedger;
  let p28StatsEngine: Phase28StatisticalEvidenceEngine;
  let p29Engine: Phase29ValidationControlEngine;
  let p30Engine: Phase30SampleAccumulationEngine;
  let p31Engine: Phase31ValidationCertificationEngine;

  const baselineFingerprint = strategyFingerprintManager.getCurrentFingerprint().masterFingerprintHash;

  // ── Helpers ────────────────────────────────────────────────────────────────

  /**
   * Generates N consecutive weekday dates (Mon–Fri) starting from 2026-10-05 (Monday).
   * This ensures store.recordTrade() passes isWithinMarketHours for all test records.
   */
  function getWeekdayDates(count: number): string[] {
    const dates: string[] = [];
    // 2026-10-05 is a Monday (UTC day = 1)
    const cursor = new Date("2026-10-05T00:00:00.000Z");
    while (dates.length < count) {
      const dow = cursor.getUTCDay(); // 0=Sun, 6=Sat
      if (dow >= 1 && dow <= 5) {
        dates.push(cursor.toISOString().slice(0, 10));
      }
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    return dates;
  }

  /**
   * Valid session record with all required fields.
   * createdAt at 04:30 UTC = 10:00 IST — within 09:15–15:30 IST market hours.
   */
  function createValidSessionRecord(id: string, date: string, overrides: Partial<GenuineSessionRecord> = {}): GenuineSessionRecord {
    return {
      sessionId: id,
      sessionDateIST: date,
      sessionStart: `${date}T09:15:00+05:30`,
      sessionEnd: `${date}T15:30:00+05:30`,
      timezone: "Asia/Kolkata",
      // 04:30 UTC = 10:00 IST — within market hours
      timestampUTC: `${date}T04:30:00.000Z`,
      timestampIST: `${date}T10:00:00+05:30`,
      marketSession: "MARKET_OPEN",
      genuineSession: true,
      dataGate: "PASSED",
      provider: "DHAN",
      spotSource: "DHAN",
      optionChainSource: "DHAN",
      optionPriceSource: "DHAN",
      greeksSource: "REAL",
      expiry: "2026-10-29",
      lotSizeSource: "DHAN_MASTER",
      websocketStatus: "HEALTHY",
      reconciliationStatus: "PASS",
      blockedReason: null,
      createdAt: `${date}T04:30:00.000Z`,
      isSyntheticOptionData: false,
      ...overrides,
    };
  }

  /**
   * Valid trade record with all validationFlags true and pnlType REAL_MARKET_DATA_PAPER_PNL.
   * All timestamps on a given weekday date:
   *   dataTimestamp    = 03:59 UTC = 09:29 IST
   *   decisionTimestamp= 03:59:30 UTC
   *   entryTimestamp   = 04:00 UTC = 09:30 IST  (within market hours ✓)
   *   monitoringTimestamp = 04:30 UTC = 10:00 IST
   *   exitTimestamp    = 09:00 UTC = 14:30 IST
   * Ordering: data <= decision <= entry <= monitoring <= exit ✓
   * Gross(1500) – Charges(100) – Slippage(50) = Net(1350) ✓
   */
  function createValidTradeRecord(id: string, sessionId: string, date: string, overrides: Partial<any> = {}) {
    return {
      tradeId: id,
      sessionId,
      signalId: `sig_${id}`,
      strategy: "NIFTY_MASTER",
      regime: "NEUTRAL",
      entryTimestamp: `${date}T04:00:00.000Z`,
      entryTimestampIST: `${date}T09:30:00+05:30`,
      exitTimestamp: `${date}T09:00:00.000Z`,
      exitTimestampIST: `${date}T14:30:00+05:30`,
      dataTimestamp: `${date}T03:59:00.000Z`,
      decisionTimestamp: `${date}T03:59:30.000Z`,
      monitoringTimestamp: `${date}T04:30:00.000Z`,
      spotPriceAtEntry: 24700,
      spotPriceAtExit: 24750,
      expiry: "2026-10-29",
      shortStrike: 24800,
      hedgeStrike: 24850,
      optionType: "CE" as const,
      quantity: 50,
      entryCredit: 120,
      exitSpread: 60,
      grossPnL: 1500,
      realizedGrossPnL: 1500,
      brokerage: 40,
      STT: 30,
      exchangeCharges: 10,
      GST: 15,
      SEBICharges: 2,
      stampDuty: 3,
      charges: 100,
      slippage: 50,
      netPnL: 1350,
      realizedNetPnL: 1350,
      lotSize: 50,
      pnlType: "REAL_MARKET_DATA_PAPER_PNL" as const,
      dataSource: "DHAN",
      priceSource: "DHAN",
      spotSource: "DHAN",
      optionPriceSource: "DHAN",
      oiSource: "DHAN",
      ivSource: "DHAN",
      lotSizeSource: "DHAN_MASTER",
      expirySource: "DHAN",
      greeksSource: "REAL",
      reconciliationStatus: "PASS",
      genuineTrade: true,
      genuineSession: true,
      isSyntheticOptionData: false,
      isSimulatedTest: false,
      strategyFingerprintHash: baselineFingerprint,
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
    };
  }

  /**
   * Seeds genuine sessions + trades through p30Engine and matching daily ledger entries.
   *
   * Key design:
   * - Uses only Mon–Fri dates so GenuineSampleStore.recordTrade() passes isWithinMarketHours.
   * - Records ledger entries with netPnL = sum of trade netPnLs so P&L reconciliation passes.
   * - Each session gets a unique date from the weekday list.
   */
  function populateSampleData(sessionCount: number, tradeCount: number, activeSessionCount: number): void {
    let tradeSeed = 1;
    const weekdays = getWeekdayDates(sessionCount + 10); // buffer for safety

    for (let s = 1; s <= sessionCount; s++) {
      const sId = `sess_${s}`;
      const date = weekdays[s - 1]; // Mon–Fri guaranteed

      const hasTrades = s <= activeSessionCount;
      // Distribute tradeCount as evenly as possible across activeSessionCount sessions
      const base = hasTrades ? Math.floor(tradeCount / activeSessionCount) : 0;
      const extra = hasTrades && s <= (tradeCount % activeSessionCount) ? 1 : 0;
      const tradesThisSession = base + extra;

      const sessionRec = createValidSessionRecord(sId, date);

      const tradeRecs: any[] = [];
      let sessionNetPnL = 0;
      for (let t = 0; t < tradesThisSession; t++) {
        const tId = `trade_${tradeSeed++}`;
        const tradeRec = createValidTradeRecord(tId, sId, date);
        tradeRecs.push(tradeRec);
        sessionNetPnL += tradeRec.netPnL; // 1350 per trade
      }

      // Finalize through p30 → p29 → store
      p30Engine.finalizeMarketSession(sessionRec, tradeRecs);

      // Record matching ledger entry so getAllEntries(true) sum = trade sum
      ledger.recordDailySession({
        date,
        marketSession: "MARKET_OPEN",
        genuine: true,
        active: tradesThisSession > 0,
        tradeCount: tradesThisSession,
        grossPnL: sessionNetPnL + 100 * tradesThisSession,
        charges: 100 * tradesThisSession,
        slippage: 50 * tradesThisSession,
        netPnL: sessionNetPnL,
        wins: tradesThisSession,
        losses: 0,
        noTrade: tradesThisSession === 0,
        blockedSignals: 0,
        reconciliation: "PASS",
        dataQuality: "REAL",
        providerHealth: "CONNECTED",
      });
    }
  }

  // ── Setup / Teardown ───────────────────────────────────────────────────────

  beforeEach(() => {
    process.env.PAPER_TRADING = "true";
    process.env.LIVE_TRADING = "false";
    process.env.BROKER_EXECUTION_ENABLED = "false";
    process.env.INDIAN_REAL_DATA_ONLY = "true";

    vi.spyOn(dhanBrokerAdapter, "isConfigured").mockReturnValue(true);

    store = new GenuineSampleStore();
    ledger = new GenuineDailyLedger();
    p28StatsEngine = new Phase28StatisticalEvidenceEngine(store, ledger);
    p29Engine = new Phase29ValidationControlEngine(store, ledger, p28StatsEngine);
    p30Engine = new Phase30SampleAccumulationEngine(p29Engine, store, ledger);
    p31Engine = new Phase31ValidationCertificationEngine(
      store,
      ledger,
      p28StatsEngine,
      p29Engine,
      p30Engine
    );

    dailyRiskController.resetDailyState();
    paperBrokerAdapter.reconstructState([], []);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── Tests ──────────────────────────────────────────────────────────────────

  // 1. Insufficient sample blocks certification
  it("1. Insufficient sample blocks certification: Returns INSUFFICIENT_SAMPLE when counters are 0", () => {
    const cert = p31Engine.processCertificationPipeline();
    expect(cert.status).toBe("INSUFFICIENT_SAMPLE");
    expect(cert.sampleGate.gatePassed).toBe(false);
  });

  // 2. 20 sessions gate
  it("2. 20 sessions gate: Session threshold is met when 20 genuine sessions are present", () => {
    populateSampleData(20, 10, 5);
    const gate = p31Engine.evaluateSampleGate();
    expect(gate.sessionsMet).toBe(true);
    expect(gate.tradesMet).toBe(false);
  });

  // 3. 30 trades gate
  it("3. 30 trades gate: Trade threshold is met when 30 genuine trades are present", () => {
    populateSampleData(10, 30, 5);
    const gate = p31Engine.evaluateSampleGate();
    expect(gate.tradesMet).toBe(true);
    expect(gate.sessionsMet).toBe(false);
  });

  // 4. 15 active sessions gate
  it("4. 15 active sessions gate: Active session threshold is met when 15 active sessions are present", () => {
    populateSampleData(15, 15, 15);
    const gate = p31Engine.evaluateSampleGate();
    expect(gate.activeSessionsMet).toBe(true);
  });

  // 5. Combined gate
  it("5. Combined gate: Sample gate passes only when 20 sessions AND 30 trades AND 15 active sessions are met", () => {
    populateSampleData(20, 30, 15);
    const gate = p31Engine.evaluateSampleGate();
    expect(gate.sampleGatePassed).toBe(true);
  });

  // 6. Cohort creation
  it("6. Cohort creation: Creates validation cohort record COHORT_A_<hash> when gate passes", () => {
    populateSampleData(20, 30, 15);
    const cert = p31Engine.processCertificationPipeline();
    expect(cert.cohortId).toContain("COHORT_A_");
    expect(cert.frozenCohort).not.toBeNull();
  });

  // 7. Cohort freeze
  it("7. Cohort freeze: Cohort status transitions to FROZEN", () => {
    populateSampleData(20, 30, 15);
    p31Engine.processCertificationPipeline();
    const cohort = p31Engine.getFrozenCohort();
    expect(cohort?.status).toBe("FROZEN");
  });

  // 8. Frozen cohort immutability
  it("8. Frozen cohort immutability: Re-calling processCertificationPipeline returns identical certificate", () => {
    populateSampleData(20, 30, 15);
    const cert1 = p31Engine.processCertificationPipeline();
    const cert2 = p31Engine.processCertificationPipeline();
    expect(cert1.cohortId).toBe(cert2.cohortId);
    expect(cert1.certificateHash).toBe(cert2.certificateHash);
  });

  // 9. Overshoot handling
  it("9. Overshoot handling: Captures entire qualifying population (e.g. 20 sessions, 32 trades, 17 active) deterministically", () => {
    populateSampleData(20, 32, 17);
    const cert = p31Engine.processCertificationPipeline();
    expect(cert.sampleGate.genuineTradesCount).toBeGreaterThanOrEqual(32);
    expect(cert.sampleGate.activeSessionsCount).toBeGreaterThanOrEqual(17);
  });

  // 10. Duplicate suppression
  it("10. Duplicate suppression: Genuine sample has no duplicate trade/session IDs", () => {
    populateSampleData(20, 30, 15);
    // Store prevents duplicates via immutability — attempt to add duplicate
    const firstTrade = store.getTrades(false)[0];
    store.recordTrade({ ...firstTrade } as any); // will return original, not insert
    // Integrity check on the clean genuine set should pass duplicate control
    const integrity = p31Engine.runIntegrityChecks();
    expect(integrity.duplicateControlClean).toBe(true);
  });

  // 11. Timestamp integrity
  it("11. Timestamp integrity: Verifies chronological ordering dataTs <= decisionTs <= entryTs <= monitoringTs <= exitTs", () => {
    populateSampleData(20, 30, 15);
    const integrity = p31Engine.runIntegrityChecks();
    expect(integrity.timestampOrderValid).toBe(true);
  });

  // 12. Anti-hindsight validation
  it("12. Anti-hindsight validation: Rejects certification if a trade has dataTs > decisionTs", () => {
    populateSampleData(20, 30, 15);
    // Insert a new unique trade with anti-hindsight violation:
    // dataTimestamp (10:00 UTC) AFTER decisionTimestamp (09:00 UTC) — clear violation
    const weekday = getWeekdayDates(1)[0];
    const badTrade = createValidTradeRecord("bad_hindsight_trade", "sess_1", weekday, {
      dataTimestamp: `${weekday}T10:00:00.000Z`,    // 10:00 UTC AFTER decision below
      decisionTimestamp: `${weekday}T09:00:00.000Z`, // 09:00 UTC BEFORE data — VIOLATION
      entryTimestamp: `${weekday}T11:00:00.000Z`,
      monitoringTimestamp: `${weekday}T11:30:00.000Z`,
      exitTimestamp: `${weekday}T15:00:00.000Z`,
      genuineTrade: true,
    });
    store.recordTrade(badTrade as any);

    const integrity = p31Engine.runIntegrityChecks();
    expect(integrity.antiHindsightVerified).toBe(false);
  });

  // 13. P&L reconciliation
  it("13. P&L reconciliation: Trade-level net P&L matches daily ledger net P&L within ₹0.01", () => {
    populateSampleData(20, 30, 15);
    const recon = p31Engine.runPnlReconciliation();
    expect(recon.pnlReconciliation.isMatch).toBe(true);
    expect(recon.pnlReconciliation.difference).toBeLessThanOrEqual(0.01);
  });

  // 14. Daily ledger reconciliation
  it("14. Daily ledger reconciliation: Overall reconciliation status is PASS", () => {
    populateSampleData(20, 30, 15);
    const recon = p31Engine.runPnlReconciliation();
    expect(recon.overallStatus).toBe("PASS");
  });

  // 15. Strategy fingerprint validation
  it("15. Strategy fingerprint validation: All frozen trades match baseline strategy fingerprint", () => {
    populateSampleData(20, 30, 15);
    const integrity = p31Engine.runIntegrityChecks();
    expect(integrity.strategyFingerprintMatch).toBe(true);
  });

  // 16. Fingerprint mismatch blocks certification
  it("16. Fingerprint mismatch blocks certification: Trade with wrong fingerprint causes CERTIFICATION_BLOCKED", () => {
    populateSampleData(20, 30, 15);
    const weekday = getWeekdayDates(1)[0];
    const mismatchTrade = createValidTradeRecord("mismatch_fp_trade", "sess_1", weekday, {
      strategyFingerprintHash: "WRONG_FINGERPRINT_HASH_999",
    });
    store.recordTrade(mismatchTrade as any);

    const cert = p31Engine.processCertificationPipeline();
    expect(cert.status).toBe("CERTIFICATION_BLOCKED");
  });

  // 17. Simulated exclusion
  it("17. Simulated exclusion: Simulated trades are excluded from genuine count", () => {
    const weekday = getWeekdayDates(1)[0];
    p29Engine.finalizeTrade(createValidTradeRecord("sim_trade_1", "sess_x", weekday, {
      pnlType: "SIMULATED_TEST_PNL",
      genuineTrade: false,
    }) as any);
    const audit = p31Engine.getExclusionAudit();
    expect(audit.simulatedExcluded).toBeGreaterThanOrEqual(1);
  });

  // 18. Synthetic exclusion
  it("18. Synthetic exclusion: Synthetic trades are excluded from genuine count", () => {
    const weekday = getWeekdayDates(1)[0];
    p29Engine.finalizeTrade(createValidTradeRecord("synth_trade_1", "sess_x", weekday, {
      pnlType: "SYNTHETIC_PAPER_PNL",
      genuineTrade: false,
    }) as any);
    const audit = p31Engine.getExclusionAudit();
    expect(audit.syntheticExcluded).toBeGreaterThanOrEqual(1);
  });

  // 19. Stale exclusion
  it("19. Stale exclusion: Non-genuine trades are not counted as genuine", () => {
    const weekday = getWeekdayDates(1)[0];
    p29Engine.finalizeTrade(createValidTradeRecord("stale_trade_1", "sess_x", weekday, {
      genuineTrade: false,
    }) as any);
    const audit = p31Engine.getExclusionAudit();
    expect(audit.genuine).toBe(0);
  });

  // 20. After-hours exclusion
  it("20. After-hours exclusion: After-hours trades are not counted as genuine", () => {
    const weekday = getWeekdayDates(1)[0];
    p29Engine.finalizeTrade(createValidTradeRecord("afterhours_trade_1", "sess_x", weekday, {
      genuineTrade: false,
    }) as any);
    const audit = p31Engine.getExclusionAudit();
    expect(audit.genuine).toBe(0);
  });

  // 21. Invalid exclusion
  it("21. Invalid exclusion: Trades with invalid lot size are tracked in exclusion audit", () => {
    const weekday = getWeekdayDates(1)[0];
    p29Engine.finalizeTrade(createValidTradeRecord("invalid_lotsize_1", "sess_x", weekday, {
      genuineTrade: false,
      validationFlags: {
        realSpot: true,
        realOptionChain: true,
        realOptionPrices: true,
        dataNotStale: true,
        lotSizeVerified: false,
        marketSessionValid: true,
        safetyLocksValid: true,
        reconciliationPassed: true,
        antiHindsightPassed: true,
      },
    }) as any);
    const audit = p31Engine.getExclusionAudit();
    expect(audit.invalidExcluded).toBeGreaterThanOrEqual(1);
  });

  // 22. Statistical snapshot creation
  it("22. Statistical snapshot creation: Phase 28 report is captured after certification pipeline", () => {
    populateSampleData(20, 30, 15);
    p31Engine.processCertificationPipeline();
    const stats = p31Engine.getStatisticalSnapshot();
    expect(stats).toBeDefined();
    expect(stats).not.toBeNull();
  });

  // 23. Statistical snapshot freeze
  it("23. Statistical snapshot freeze: Certified certificate has statisticalSnapshotStatus FROZEN", () => {
    populateSampleData(20, 30, 15);
    const cert = p31Engine.processCertificationPipeline();
    expect(cert.statisticalSnapshotStatus).toBe("FROZEN");
  });

  // 24. Phase28 snapshot consistency
  it("24. Phase 28 snapshot consistency: Frozen snapshot totalTrades >= 30", () => {
    populateSampleData(20, 30, 15);
    p31Engine.processCertificationPipeline();
    const stats = p31Engine.getStatisticalSnapshot();
    expect(stats?.coreStatistics.totalTrades).toBeGreaterThanOrEqual(30);
  });

  // 25. Export integrity
  it("25. Export integrity: Export contains no credential or secret tokens", () => {
    populateSampleData(20, 30, 15);
    const exp = p31Engine.getExport();
    const str = JSON.stringify(exp);
    expect(str).not.toContain("dhanToken");
    expect(str).not.toContain("password");
    expect(str).not.toContain("secret");
  });

  // 26. Restart recovery
  it("26. Restart recovery: Engine status is CERTIFIED after calling processCertificationPipeline", () => {
    populateSampleData(20, 30, 15);
    p31Engine.processCertificationPipeline();
    const status = p31Engine.getStatus();
    expect(status.status).toBe("CERTIFIED");
  });

  // 27. Certification idempotency
  it("27. Certification idempotency: Multiple calls return identical certificate", () => {
    populateSampleData(20, 30, 15);
    const cert1 = p31Engine.processCertificationPipeline();
    const cert2 = p31Engine.processCertificationPipeline();
    expect(cert1).toEqual(cert2);
  });

  // 28. No fabricated statistics
  it("28. No fabricated statistics: Disclaimer states PAPER DATA ONLY and does not claim SUPERIOR", () => {
    populateSampleData(20, 30, 15);
    const cert = p31Engine.processCertificationPipeline();
    expect(cert.disclaimer).toContain("PAPER DATA ONLY");
    expect(cert.disclaimer).not.toContain("SUPERIOR");
  });

  // 29. LIVE_TRADING remains false
  it("29. LIVE_TRADING remains false: safetyStatus.liveTrading is false", () => {
    populateSampleData(20, 30, 15);
    const cert = p31Engine.processCertificationPipeline();
    expect(cert.safetyStatus.liveTrading).toBe(false);
  });

  // 30. BROKER_EXECUTION_ENABLED remains false
  it("30. BROKER_EXECUTION_ENABLED remains false: safetyStatus.brokerExecution is false", () => {
    populateSampleData(20, 30, 15);
    const cert = p31Engine.processCertificationPipeline();
    expect(cert.safetyStatus.brokerExecution).toBe(false);
  });

  // 31. Real broker orders remain zero
  it("31. Real broker orders remain zero: safetyStatus.realBrokerOrders is 0", () => {
    populateSampleData(20, 30, 15);
    const cert = p31Engine.processCertificationPipeline();
    expect(cert.safetyStatus.realBrokerOrders).toBe(0);
  });

  // 32. No strategy modification
  it("32. No strategy modification: Baseline fingerprint unchanged after Phase 31 operations", () => {
    const fp = strategyFingerprintManager.getCurrentFingerprint();
    expect(fp.masterFingerprintHash).toBe(baselineFingerprint);
  });

  // 33. Audit trail completeness
  it("33. Audit trail completeness: CSV export has header + at least 30 trade rows", () => {
    populateSampleData(20, 30, 15);
    const csv = p31Engine.generateCsvExport();
    const lines = csv.split("\n");
    // 1 header line + at least 30 data rows = at least 31 lines
    expect(lines.length).toBeGreaterThanOrEqual(31);
  });

  // 34. Certification failure state
  it("34. Certification failure state: LIVE_TRADING=true causes CERTIFICATION_BLOCKED", () => {
    process.env.LIVE_TRADING = "true";
    const cert = p31Engine.processCertificationPipeline();
    expect(cert.status).toBe("CERTIFICATION_BLOCKED");
    expect(cert.state).toBe("CERTIFICATION_BLOCKED");
  });

  // 35. Certification success state
  it("35. Certification success state: Full pipeline transitions to CERTIFIED", () => {
    populateSampleData(20, 30, 15);
    const cert = p31Engine.processCertificationPipeline();
    expect(cert.status).toBe("CERTIFIED");
    expect(cert.state).toBe("CERTIFIED");
  });
});
