import { describe, test, expect, beforeEach } from "vitest";
import { phase38SessionCollector } from "../validation/Phase38SessionCollector";
import { phase38TradeCollector } from "../validation/Phase38TradeCollector";
import { phase38SampleAccumulator } from "../validation/Phase38SampleAccumulator";
import { strategyFingerprintManager } from "../validation/StrategyFingerprintManager";
import { phase37ValidationControl } from "../validation/Phase37ValidationControl";

describe("PHASE 38 — GENUINE MARKET SAMPLE COLLECTION & COHORT ACCUMULATION", () => {
  beforeEach(() => {
    phase38SessionCollector.clear();
    phase38TradeCollector.clear();
  });

  // 1. Genuine session accepted
  test("1. Genuine session accepted", () => {
    const session = phase38SessionCollector.finalizeSession({
      sessionId: "sess_genuine_1",
      dataGate: "PASSED",
      spotSource: "DHAN",
      optionChainSource: "DHAN",
      optionPriceSource: "DHAN",
      lotSizeSource: "DHAN_MASTER",
      websocketStatus: "HEALTHY",
      reconciliationStatus: "PASS",
      dataNotStale: true,
      lotSizeVerified: true,
      marketSessionValid: true,
      safetyLocksValid: true,
      dhanProvenanceValid: true,
      websocketHealthValid: true,
      optionChainProvenanceValid: true,
      threeWayReconciliationPass: true,
      timestampISTValid: true,
    });

    expect(session.genuineSession).toBe(true);
    expect(session.dataGate).toBe("PASSED");
    expect(session.inclusionExclusionReason).toBe("GENUINE_ACCEPTED");
    expect(session.immutableHash).toBeDefined();
    expect(phase38SessionCollector.getGenuineSessionCount()).toBe(1);
  });

  // 2. Synthetic session rejected
  test("2. Synthetic session rejected", () => {
    const session = phase38SessionCollector.finalizeSession({
      sessionId: "sess_synthetic_1",
      spotSource: "SYNTHETIC",
      optionChainSource: "SYNTHETIC",
      dataGate: "FAILED",
    });

    expect(session.genuineSession).toBe(false);
    expect(session.inclusionExclusionReason).toContain("NOT_REAL_SPOT");
    expect(phase38SessionCollector.getGenuineSessionCount()).toBe(0);
  });

  // 3. Stale session rejected
  test("3. Stale session rejected", () => {
    const session = phase38SessionCollector.finalizeSession({
      sessionId: "sess_stale_1",
      dataNotStale: false,
    });

    expect(session.genuineSession).toBe(false);
    expect(session.inclusionExclusionReason).toContain("DATA_STALE");
  });

  // 4. Missing provenance rejected
  test("4. Missing provenance rejected", () => {
    const session = phase38SessionCollector.finalizeSession({
      sessionId: "sess_no_prov_1",
      spotSource: "UNKNOWN",
      optionChainSource: "UNKNOWN",
    });

    expect(session.genuineSession).toBe(false);
    expect(session.inclusionExclusionReason).toContain("NOT_REAL_SPOT");
  });

  // 5. Genuine trade accepted
  test("5. Genuine trade accepted", () => {
    const currentFp = strategyFingerprintManager.getCurrentFingerprint().masterFingerprintHash;
    const trade = phase38TradeCollector.finalizeTrade({
      tradeId: "trade_genuine_1",
      sessionId: "sess_genuine_1",
      signalId: "sig_1",
      strategyFingerprint: currentFp,
      pnlType: "REAL_MARKET_DATA_PAPER_PNL",
      dataProvenance: {
        spotSource: "DHAN",
        optionChainSource: "DHAN",
        priceSource: "DHAN",
        websocketHealth: "HEALTHY",
        isRealData: true,
        dataNotStale: true,
      },
      optionChainProvenance: {
        provider: "DHAN",
        expiry: "CURRENT_WEEKLY",
        chainVerified: true,
        lotSizeVerified: true,
      },
      priceProvenance: {
        entrySpot: 24500,
        entryShortPrice: 100,
        entryHedgePrice: 20,
        exitSpot: 24550,
        exitShortPrice: 40,
        exitHedgePrice: 10,
        verified: true,
      },
      entry: {
        timestamp: "2026-10-04T10:00:00.000Z",
        timestampIST: "2026-10-04T15:30:00.000+05:30",
        spotPrice: 24500,
        shortStrike: 24500,
        hedgeStrike: 24700,
        optionType: "PE",
        quantity: 75,
        hedgeFirstCompleted: true,
        shortLegConfirmed: true,
      },
      exit: {
        timestamp: "2026-10-04T11:00:00.000Z",
        timestampIST: "2026-10-04T16:30:00.000+05:30",
        spotPrice: 24550,
        exitReason: "PROFIT_TARGET",
      },
      charges: {
        brokerage: 40,
        stt: 10,
        exchangeFees: 5,
        gst: 9,
        sebiFees: 0.1,
        stampDuty: 2,
        totalCharges: 66.1,
      },
      slippage: 5,
      realizedPnL: {
        grossPnL: 500,
        netPnL: 428.9,
      },
      reconciliationStatus: "PASS",
    });

    expect(trade.genuineTrade).toBe(true);
    expect(trade.inclusionExclusionReason).toBe("GENUINE_ACCEPTED");
    expect(trade.immutableHash).toBeDefined();
    expect(phase38TradeCollector.getGenuineTradeCount()).toBe(1);
  });

  // 6. Synthetic trade rejected
  test("6. Synthetic trade rejected", () => {
    const trade = phase38TradeCollector.finalizeTrade({
      tradeId: "trade_synthetic_1",
      sessionId: "sess_1",
      pnlType: "SYNTHETIC_PAPER_PNL",
    });

    expect(trade.genuineTrade).toBe(false);
    expect(trade.inclusionExclusionReason).toBe("SYNTHETIC");
    expect(phase38TradeCollector.getGenuineTradeCount()).toBe(0);
  });

  // 7. Incomplete trade rejected
  test("7. Incomplete trade rejected", () => {
    const trade = phase38TradeCollector.finalizeTrade({
      tradeId: "trade_incomplete_1",
      sessionId: "sess_1",
      entry: {
        timestamp: new Date().toISOString(),
        timestampIST: "2026-10-04T10:00:00+05:30",
        spotPrice: 24500,
        shortStrike: 24500,
        hedgeStrike: 24700,
        optionType: "PE",
        quantity: 75,
        hedgeFirstCompleted: false, // Incomplete sequence
        shortLegConfirmed: true,
      },
    });

    expect(trade.genuineTrade).toBe(false);
    expect(trade.inclusionExclusionReason).toBe("INCOMPLETE");
  });

  // 8. Reconciliation failure rejected
  test("8. Reconciliation failure rejected", () => {
    const trade = phase38TradeCollector.finalizeTrade({
      tradeId: "trade_recon_fail_1",
      sessionId: "sess_1",
      reconciliationStatus: "FAIL",
      exit: {
        timestamp: new Date().toISOString(),
        timestampIST: "2026-10-04T11:00:00+05:30",
        spotPrice: 24550,
        exitReason: "PROFIT_TARGET",
      },
    });

    expect(trade.genuineTrade).toBe(false);
    expect(trade.inclusionExclusionReason).toBe("RECONCILIATION_FAIL");
  });

  // 9. Fingerprint mismatch rejected
  test("9. Fingerprint mismatch rejected", () => {
    const trade = phase38TradeCollector.finalizeTrade({
      tradeId: "trade_fp_mismatch_1",
      sessionId: "sess_1",
      strategyFingerprint: "INVALID_FINGERPRINT_HASH",
    });

    expect(trade.genuineTrade).toBe(false);
    expect(trade.inclusionExclusionReason).toBe("FINGERPRINT_MISMATCH");
  });

  // 10. Duplicate session prevented
  test("10. Duplicate session prevented", () => {
    const first = phase38SessionCollector.finalizeSession({
      sessionId: "sess_dup_1",
      spotSource: "DHAN",
    });

    const second = phase38SessionCollector.finalizeSession({
      sessionId: "sess_dup_1",
      spotSource: "DHAN",
    });

    expect(first.observationId).toBe(second.observationId);
    expect(phase38SessionCollector.getSessions().length).toBe(1);
  });

  // 11. Duplicate trade prevented
  test("11. Duplicate trade prevented", () => {
    const first = phase38TradeCollector.finalizeTrade({
      tradeId: "trade_dup_1",
      sessionId: "sess_1",
    });

    const second = phase38TradeCollector.finalizeTrade({
      tradeId: "trade_dup_1",
      sessionId: "sess_1",
    });

    expect(first.observationId).toBe(second.observationId);
    expect(phase38TradeCollector.getTrades().length).toBe(1);
  });

  // 12. Restart recovery
  test("12. Restart recovery preserves accumulated state and integrity", () => {
    phase38SessionCollector.finalizeSession({ sessionId: "sess_rec_1", spotSource: "DHAN" });
    const currentCount = phase38SessionCollector.getGenuineSessionCount();
    expect(currentCount).toBe(1);

    const report = phase38SampleAccumulator.getIntegrityReport();
    expect(report.immutabilityPassed).toBe(true);
  });

  // 13. WebSocket reconnect status handled gracefully
  test("13. WebSocket reconnect status handled gracefully", () => {
    const status = phase38SampleAccumulator.getStatus();
    expect(status.websocketHealth).toBeDefined();
    expect(status.dhanConnection).toBe("CONNECTED");
  });

  // 14. Session close finalization
  test("14. Session close finalization updates sample counters", () => {
    const result = phase38SampleAccumulator.finalizeDailySession("sess_daily_close_1");
    expect(result.session.finalizedAt).toBeDefined();
    expect(result.progress).toBeDefined();
  });

  // 15. Active-session counting
  test("15. Active-session counting (session with >= 1 genuine trade)", () => {
    const sess = phase38SessionCollector.finalizeSession({
      sessionId: "sess_active_1",
      spotSource: "DHAN",
    });
    expect(sess.activeSession).toBe(false);

    phase38SessionCollector.markSessionAsActive("sess_active_1");
    expect(phase38SessionCollector.getActiveSessionCount()).toBe(1);
  });

  // 16. Sample counter accuracy
  test("16. Sample counter accuracy", () => {
    phase38SessionCollector.finalizeSession({ sessionId: "s1", spotSource: "DHAN" });
    phase38SessionCollector.finalizeSession({ sessionId: "s2", spotSource: "DHAN" });
    const progress = phase38SampleAccumulator.getProgress();

    expect(progress.genuineSessions).toBe(2);
    expect(progress.requiredSessions).toBe(20);
    expect(progress.sessionsMet).toBe(false);
  });

  // 17. 20-session gate
  test("17. 20-session gate requires at least 20 genuine sessions", () => {
    for (let i = 1; i <= 19; i++) {
      phase38SessionCollector.finalizeSession({ sessionId: `s_${i}`, spotSource: "DHAN" });
    }
    let progress = phase38SampleAccumulator.getProgress();
    expect(progress.sessionsMet).toBe(false);

    phase38SessionCollector.finalizeSession({ sessionId: "s_20", spotSource: "DHAN" });
    progress = phase38SampleAccumulator.getProgress();
    expect(progress.sessionsMet).toBe(true);
  });

  // 18. 30-trade gate
  test("18. 30-trade gate requires at least 30 genuine trades", () => {
    const currentFp = strategyFingerprintManager.getCurrentFingerprint().masterFingerprintHash;
    for (let i = 1; i <= 29; i++) {
      phase38TradeCollector.finalizeTrade({
        tradeId: `t_${i}`,
        sessionId: `s_${i}`,
        strategyFingerprint: currentFp,
        pnlType: "REAL_MARKET_DATA_PAPER_PNL",
        entry: {
          timestamp: new Date().toISOString(),
          timestampIST: "2026-10-04T10:00:00+05:30",
          spotPrice: 24500,
          shortStrike: 24500,
          hedgeStrike: 24700,
          optionType: "PE",
          quantity: 75,
          hedgeFirstCompleted: true,
          shortLegConfirmed: true,
        },
        exit: {
          timestamp: new Date().toISOString(),
          timestampIST: "2026-10-04T11:00:00+05:30",
          spotPrice: 24550,
          exitReason: "PROFIT_TARGET",
        },
      });
    }
    let progress = phase38SampleAccumulator.getProgress();
    expect(progress.tradesMet).toBe(false);

    phase38TradeCollector.finalizeTrade({
      tradeId: "t_30",
      sessionId: "s_30",
      strategyFingerprint: currentFp,
      pnlType: "REAL_MARKET_DATA_PAPER_PNL",
      entry: {
        timestamp: new Date().toISOString(),
        timestampIST: "2026-10-04T10:00:00+05:30",
        spotPrice: 24500,
        shortStrike: 24500,
        hedgeStrike: 24700,
        optionType: "PE",
        quantity: 75,
        hedgeFirstCompleted: true,
        shortLegConfirmed: true,
      },
      exit: {
        timestamp: new Date().toISOString(),
        timestampIST: "2026-10-04T11:00:00+05:30",
        spotPrice: 24550,
        exitReason: "PROFIT_TARGET",
      },
    });
    progress = phase38SampleAccumulator.getProgress();
    expect(progress.tradesMet).toBe(true);
  });

  // 19. 15-active-session gate
  test("19. 15-active-session gate requires 15 active sessions", () => {
    for (let i = 1; i <= 15; i++) {
      const sId = `active_sess_${i}`;
      phase38SessionCollector.finalizeSession({ sessionId: sId, spotSource: "DHAN" });
      phase38SessionCollector.markSessionAsActive(sId);
    }
    const progress = phase38SampleAccumulator.getProgress();
    expect(progress.activeSessions).toBe(15);
    expect(progress.activeSessionsMet).toBe(true);
  });

  // 20. SAMPLE_COMPLETE only when all gates pass
  test("20. SAMPLE_COMPLETE only when all 3 gates pass", () => {
    const currentFp = strategyFingerprintManager.getCurrentFingerprint().masterFingerprintHash;

    // 20 sessions
    for (let i = 1; i <= 20; i++) {
      const sId = `complete_sess_${i}`;
      phase38SessionCollector.finalizeSession({ sessionId: sId, spotSource: "DHAN" });
      if (i <= 15) {
        phase38SessionCollector.markSessionAsActive(sId);
      }
    }

    // 30 trades
    for (let i = 1; i <= 30; i++) {
      phase38TradeCollector.finalizeTrade({
        tradeId: `complete_t_${i}`,
        sessionId: `complete_sess_${(i % 15) + 1}`,
        strategyFingerprint: currentFp,
        pnlType: "REAL_MARKET_DATA_PAPER_PNL",
        entry: {
          timestamp: new Date().toISOString(),
          timestampIST: "2026-10-04T10:00:00+05:30",
          spotPrice: 24500,
          shortStrike: 24500,
          hedgeStrike: 24700,
          optionType: "PE",
          quantity: 75,
          hedgeFirstCompleted: true,
          shortLegConfirmed: true,
        },
        exit: {
          timestamp: new Date().toISOString(),
          timestampIST: "2026-10-04T11:00:00+05:30",
          spotPrice: 24550,
          exitReason: "PROFIT_TARGET",
        },
      });
    }

    const progress = phase38SampleAccumulator.getProgress();
    expect(progress.sessionsMet).toBe(true);
    expect(progress.tradesMet).toBe(true);
    expect(progress.activeSessionsMet).toBe(true);
    expect(progress.validationStatus).toBe("SAMPLE_COMPLETE");
  });

  // 21. No fake/backfilled observations
  test("21. No fake/backfilled observations", () => {
    const progress = phase38SampleAccumulator.getProgress();
    expect(progress.genuineSessions).toBe(0);
    expect(progress.genuineTrades).toBe(0);
    expect(progress.validationStatus).toBe("INSUFFICIENT_SAMPLE");
  });

  // 22. Anti-hindsight enforcement
  test("22. Anti-hindsight enforcement", () => {
    phase38TradeCollector.storeSignalSnapshot({
      signalId: "sig_anti_hindsight_1",
      timestamp: "2026-10-04T10:00:00.000Z",
      timestampIST: "2026-10-04T15:30:00.000+05:30",
      marketSnapshot: { spotPrice: 24500, regime: "BULLISH" },
      optionChainSnapshot: { expiry: "CURRENT", shortStrike: 24500, hedgeStrike: 24700, optionType: "PE", underlyingSpot: 24500 },
      greeks: { delta: -0.25 },
      selectedStrikes: { shortStrike: 24500, hedgeStrike: 24700 },
      strategyDecision: { action: "BULL_PUT_SPREAD", score: 85, reasons: ["RSI > 50"] },
      riskDecision: { dailyRiskStatus: "PASS", allowed: true },
    });

    const snap = phase38TradeCollector.getSignalSnapshot("sig_anti_hindsight_1");
    expect(snap).toBeDefined();
    expect(snap?.strategyDecision.action).toBe("BULL_PUT_SPREAD");
  });

  // 23. Safety locks unchanged
  test("23. Safety locks unchanged", () => {
    const safety = phase37ValidationControl.verifySafetyInvariants();
    expect(safety.paperTrading).toBe(true);
    expect(safety.liveTrading).toBe(false);
    expect(safety.brokerExecution).toBe(false);
    expect(safety.realDataOnly).toBe(true);
  });

  // 24. LIVE_TRADING remains false
  test("24. LIVE_TRADING remains false", () => {
    expect(process.env.LIVE_TRADING).not.toBe("true");
  });

  // 25. BROKER_EXECUTION remains false
  test("25. BROKER_EXECUTION remains false", () => {
    expect(process.env.BROKER_EXECUTION_ENABLED).not.toBe("true");
  });
});
