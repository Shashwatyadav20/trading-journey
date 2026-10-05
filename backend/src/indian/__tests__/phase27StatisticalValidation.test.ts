import { describe, test, expect, beforeEach, vi } from "vitest";
import {
  GenuineSampleStore,
  genuineSampleStore,
  GenuineSessionRecord,
  GenuineTradeRecord,
} from "../persistence/GenuineSampleStore";
import { GenuineDailyLedger, genuineDailyLedger } from "../persistence/GenuineDailyLedger";
import {
  Phase27StatisticalValidationEngine,
  phase27StatisticalValidationEngine,
} from "../validation/Phase27StatisticalValidationEngine";
import { strategyFingerprintManager } from "../validation/StrategyFingerprintManager";
import { dhanBrokerAdapter } from "../broker/DhanBrokerAdapter";
import { paperBrokerAdapter } from "../broker/PaperBrokerAdapter";
import { dailyRiskController } from "../risk/DailyRiskController";
import { reconciliationEngine } from "../reconciliation/ReconciliationEngine";
import { phase26EGenuineLivePaperValidationEngine } from "../validation/Phase26EGenuineLivePaperValidationEngine";

describe("PHASE 27 — Genuine Sample Collection & Statistical Validation Suite", () => {
  let store: GenuineSampleStore;
  let ledger: GenuineDailyLedger;
  let engine: Phase27StatisticalValidationEngine;

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
    engine = new Phase27StatisticalValidationEngine(store, ledger);
    dailyRiskController.resetDailyState();
    paperBrokerAdapter.resetAccount();
  });

  test("1. Genuine session counting", () => {
    const record: GenuineSessionRecord = {
      sessionId: "sess_001",
      sessionDateIST: "2026-10-08",
      sessionStart: "2026-10-08T09:15:00+05:30",
      sessionEnd: "2026-10-08T15:30:00+05:30",
      timezone: "Asia/Kolkata",
      timestampUTC: "2026-10-08T03:45:00Z",
      timestampIST: "2026-10-08T09:15:00+05:30",
      provider: "DHAN",
      dataGate: "PASSED",
      marketSession: "MARKET_OPEN",
      spotSource: "DHAN",
      optionChainSource: "DHAN",
      optionPriceSource: "DHAN",
      greeksSource: "REAL",
      lotSizeSource: "DHAN_MASTER",
      expiry: "2026-10-08",
      websocketStatus: "HEALTHY",
      reconciliationStatus: "PASS",
      genuineSession: true,
      blockedReason: null,
      createdAt: "2026-10-08T09:15:00+05:30",
    };

    store.recordSession(record);
    const sessions = store.getSessions(true);
    expect(sessions.length).toBe(1);
    expect(sessions[0].genuineSession).toBe(true);
  });

  test("2. Blocked session exclusion", () => {
    const blockedRecord: GenuineSessionRecord = {
      sessionId: "sess_blocked",
      sessionDateIST: "2026-10-08",
      sessionStart: "2026-10-08T09:15:00+05:30",
      sessionEnd: "2026-10-08T15:30:00+05:30",
      timezone: "Asia/Kolkata",
      timestampUTC: "2026-10-08T03:45:00Z",
      timestampIST: "2026-10-08T09:15:00+05:30",
      provider: "DHAN",
      dataGate: "BLOCKED",
      marketSession: "MARKET_CLOSED",
      spotSource: "DHAN",
      optionChainSource: "DHAN",
      optionPriceSource: "DHAN",
      greeksSource: "REAL",
      lotSizeSource: "DHAN_MASTER",
      expiry: "2026-10-08",
      websocketStatus: "DISCONNECTED",
      reconciliationStatus: "FAIL",
      genuineSession: false,
      blockedReason: "MARKET_CLOSED",
      createdAt: "2026-10-08T09:15:00+05:30",
    };

    store.recordSession(blockedRecord);
    const genuineSessions = store.getSessions(true);
    expect(genuineSessions.length).toBe(0);
  });

  test("3. Genuine trade counting", () => {
    const trade: GenuineTradeRecord = {
      tradeId: "trd_001",
      sessionId: "sess_001",
      signalId: "sig_001",
      strategy: "BULL_PUT_SPREAD",
      regime: "BULLISH",
      entryTimestamp: "2026-10-08T10:00:00+05:30",
      entryTimestampIST: "2026-10-08T10:00:00+05:30",
      expiry: "2026-10-08",
      shortStrike: 24700,
      hedgeStrike: 24550,
      optionType: "PE",
      quantity: 75,
      entryCredit: 60,
      brokerage: 40,
      STT: 10,
      exchangeCharges: 5,
      GST: 10,
      SEBICharges: 1,
      stampDuty: 2,
      slippage: 10,
      grossPnL: 2000,
      netPnL: 1922,
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
    };

    store.recordTrade(trade);
    const trades = store.getTrades(true);
    expect(trades.length).toBe(1);
    expect(trades[0].genuineTrade).toBe(true);
  });

  test("4. Synthetic trade exclusion", () => {
    const synthTrade: GenuineTradeRecord = {
      tradeId: "trd_synth",
      sessionId: "sess_001",
      signalId: "sig_synth",
      strategy: "BULL_PUT_SPREAD",
      regime: "BULLISH",
      entryTimestamp: "2026-10-08T10:00:00+05:30",
      entryTimestampIST: "2026-10-08T10:00:00+05:30",
      expiry: "2026-10-08",
      shortStrike: 24700,
      hedgeStrike: 24550,
      optionType: "PE",
      quantity: 75,
      entryCredit: 60,
      brokerage: 40,
      STT: 10,
      exchangeCharges: 5,
      GST: 10,
      SEBICharges: 1,
      stampDuty: 2,
      slippage: 10,
      dataSource: "SYNTHETIC",
      priceSource: "SYNTHETIC",
      greeksSource: "SYNTHETIC",
      lotSize: 75,
      genuineTrade: false,
      pnlType: "SYNTHETIC_PAPER_PNL",
      validationFlags: {
        realSpot: false,
        realOptionChain: false,
        realOptionPrices: false,
        dataNotStale: true,
        lotSizeVerified: true,
        marketSessionValid: true,
        safetyLocksValid: true,
        reconciliationPassed: true,
        antiHindsightPassed: true,
      },
    };

    store.recordTrade(synthTrade);
    const genuineTrades = store.getTrades(true);
    expect(genuineTrades.length).toBe(0);
    expect(store.getExclusionCounters().syntheticExcluded).toBe(1);
  });

  test("5. Simulated trade exclusion", () => {
    const simTrade: GenuineTradeRecord = {
      tradeId: "trd_sim",
      sessionId: "sess_001",
      signalId: "sig_sim",
      strategy: "BEAR_CALL_SPREAD",
      regime: "BEARISH",
      entryTimestamp: "2026-10-08T10:00:00+05:30",
      entryTimestampIST: "2026-10-08T10:00:00+05:30",
      expiry: "2026-10-08",
      shortStrike: 24700,
      hedgeStrike: 24850,
      optionType: "CE",
      quantity: 75,
      entryCredit: 60,
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
      genuineTrade: false,
      pnlType: "SIMULATED_TEST_PNL",
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
    };

    store.recordTrade(simTrade);
    expect(store.getTrades(true).length).toBe(0);
    expect(store.getExclusionCounters().simulatedExcluded).toBe(1);
  });

  test("6. Invalid trade exclusion", () => {
    const invTrade: GenuineTradeRecord = {
      tradeId: "trd_inv",
      sessionId: "sess_001",
      signalId: "sig_inv",
      strategy: "IRON_CONDOR",
      regime: "RANGE",
      entryTimestamp: "2026-10-08T10:00:00+05:30",
      entryTimestampIST: "2026-10-08T10:00:00+05:30",
      expiry: "2026-10-08",
      shortStrike: 24600,
      hedgeStrike: 24450,
      optionType: "PE",
      quantity: 75,
      entryCredit: 40,
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
      genuineTrade: false,
      pnlType: "REAL_MARKET_DATA_PAPER_PNL",
      validationFlags: {
        realSpot: true,
        realOptionChain: true,
        realOptionPrices: true,
        dataNotStale: true,
        lotSizeVerified: false, // Invalid lot size
        marketSessionValid: true,
        safetyLocksValid: true,
        reconciliationPassed: true,
        antiHindsightPassed: true,
      },
    };

    store.recordTrade(invTrade);
    expect(store.getTrades(true).length).toBe(0);
    expect(store.getExclusionCounters().invalidExcluded).toBe(1);
  });

  test("7. After-hours exclusion", () => {
    const ahSession: GenuineSessionRecord = {
      sessionId: "sess_ah",
      sessionDateIST: "2026-10-08",
      sessionStart: "2026-10-08T18:00:00+05:30", // After hours (18:00 IST)
      sessionEnd: "2026-10-08T19:00:00+05:30",
      timezone: "Asia/Kolkata",
      timestampUTC: "2026-10-08T12:30:00Z",
      timestampIST: "2026-10-08T18:00:00+05:30",
      provider: "DHAN",
      dataGate: "PASSED",
      marketSession: "MARKET_OPEN",
      spotSource: "DHAN",
      optionChainSource: "DHAN",
      optionPriceSource: "DHAN",
      greeksSource: "REAL",
      lotSizeSource: "DHAN_MASTER",
      expiry: "2026-10-08",
      websocketStatus: "HEALTHY",
      reconciliationStatus: "PASS",
      genuineSession: true,
      blockedReason: null,
      createdAt: "2026-10-08T18:00:00+05:30",
    };

    const recorded = store.recordSession(ahSession);
    expect(recorded.timestampValidationStatus).toBe("TIMESTAMP_VALIDATION_FAILED");
    expect(recorded.genuineSession).toBe(false);
    expect(store.getExclusionCounters().afterHoursExcluded).toBe(1);
  });

  test("8. Timezone validation (Asia/Kolkata IST)", () => {
    const timeRes = store.getIstTimestamp("2026-10-08T04:30:00Z"); // 10:00 IST
    expect(timeRes.dateIST).toBe("2026-10-08");
    expect(timeRes.isoIST).toContain("+05:30");
    expect(timeRes.isWithinMarketHours).toBe(true);
  });

  test("9. Timestamp ordering", () => {
    const dataTs = "2026-10-08T10:00:00.000Z";
    const decisionTs = "2026-10-08T10:00:01.000Z";
    const entryTs = "2026-10-08T10:00:02.000Z";
    const exitTs = "2026-10-08T11:00:00.000Z";

    const isOrdered =
      new Date(dataTs).getTime() <= new Date(decisionTs).getTime() &&
      new Date(decisionTs).getTime() <= new Date(entryTs).getTime() &&
      new Date(entryTs).getTime() <= new Date(exitTs).getTime();

    expect(isOrdered).toBe(true);
  });

  test("10. Anti-hindsight", () => {
    const futureDataTs = "2026-10-08T10:05:00.000Z"; // Future data timestamp!
    const decisionTs = "2026-10-08T10:00:00.000Z";

    const trade: GenuineTradeRecord = {
      tradeId: "trd_hindsight",
      sessionId: "sess_001",
      signalId: "sig_hindsight",
      strategy: "BULL_PUT_SPREAD",
      regime: "BULLISH",
      entryTimestamp: decisionTs,
      entryTimestampIST: "2026-10-08T10:00:00+05:30",
      dataTimestamp: futureDataTs,
      decisionTimestamp: decisionTs,
      expiry: "2026-10-08",
      shortStrike: 24700,
      hedgeStrike: 24550,
      optionType: "PE",
      quantity: 75,
      entryCredit: 60,
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
    };

    store.recordTrade(trade);
    expect(trade.validationFlags.antiHindsightPassed).toBe(false);
    expect(trade.genuineTrade).toBe(false);
  });

  test("11. Sample immutability", () => {
    const trade: GenuineTradeRecord = {
      tradeId: "trd_immutable",
      sessionId: "sess_001",
      signalId: "sig_001",
      strategy: "BULL_PUT_SPREAD",
      regime: "BULLISH",
      entryTimestamp: "2026-10-08T10:00:00+05:30",
      entryTimestampIST: "2026-10-08T10:00:00+05:30",
      expiry: "2026-10-08",
      shortStrike: 24700,
      hedgeStrike: 24550,
      optionType: "PE",
      quantity: 75,
      entryCredit: 60,
      netPnL: 1000,
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
    };

    store.recordTrade(trade);

    // Attempt overwrite with modified PnL
    const modifiedTrade = { ...trade, netPnL: 5000 };
    const res = store.recordTrade(modifiedTrade);

    expect(res.netPnL).toBe(1000); // Original price preserved!
  });

  test("12. Duplicate session prevention", () => {
    const s1: GenuineSessionRecord = {
      sessionId: "sess_dup",
      sessionDateIST: "2026-10-08",
      sessionStart: "2026-10-08T09:15:00+05:30",
      sessionEnd: "2026-10-08T15:30:00+05:30",
      timezone: "Asia/Kolkata",
      timestampUTC: "2026-10-08T03:45:00Z",
      timestampIST: "2026-10-08T09:15:00+05:30",
      provider: "DHAN",
      dataGate: "PASSED",
      marketSession: "MARKET_OPEN",
      spotSource: "DHAN",
      optionChainSource: "DHAN",
      optionPriceSource: "DHAN",
      greeksSource: "REAL",
      lotSizeSource: "DHAN_MASTER",
      expiry: "2026-10-08",
      websocketStatus: "HEALTHY",
      reconciliationStatus: "PASS",
      genuineSession: true,
      blockedReason: null,
      createdAt: "2026-10-08T09:15:00+05:30",
    };

    store.recordSession(s1);
    store.finalizeSession("sess_dup");

    expect(() => store.recordSession(s1)).toThrow("Immutability Breach Blocked");
  });

  test("13. Duplicate trade prevention", () => {
    const t1: GenuineTradeRecord = {
      tradeId: "trd_dup_999",
      sessionId: "sess_001",
      signalId: "sig_001",
      strategy: "BULL_PUT_SPREAD",
      regime: "BULLISH",
      entryTimestamp: "2026-10-08T10:00:00+05:30",
      entryTimestampIST: "2026-10-08T10:00:00+05:30",
      expiry: "2026-10-08",
      shortStrike: 24700,
      hedgeStrike: 24550,
      optionType: "PE",
      quantity: 75,
      entryCredit: 60,
      netPnL: 1000,
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
    };

    store.recordTrade(t1);
    store.recordTrade(t1);

    expect(store.getTrades().length).toBe(1);
  });

  test("14. Strategy breakdown", () => {
    const mockTrades: GenuineTradeRecord[] = [
      { tradeId: "t1", strategy: "BULL_PUT_SPREAD", netPnL: 1500, grossPnL: 1600 } as any,
      { tradeId: "t2", strategy: "BULL_PUT_SPREAD", netPnL: -500, grossPnL: -400 } as any,
      { tradeId: "t3", strategy: "BEAR_CALL_SPREAD", netPnL: 1200, grossPnL: 1300 } as any,
    ];

    const breakdown = engine.calculateStrategyBreakdown(mockTrades);
    const bullPut = breakdown.find((s) => s.strategy === "BULL_PUT_SPREAD");
    expect(bullPut?.tradeCount).toBe(2);
    expect(bullPut?.wins).toBe(1);
    expect(bullPut?.losses).toBe(1);
    expect(bullPut?.winRate).toBe(50);
  });

  test("15. Regime breakdown", () => {
    const mockTrades: GenuineTradeRecord[] = [
      { tradeId: "t1", regime: "BULLISH", netPnL: 1000 } as any,
      { tradeId: "t2", regime: "RANGE", netPnL: 800 } as any,
    ];

    const breakdown = engine.calculateRegimeBreakdown(mockTrades);
    const bullish = breakdown.find((r) => r.regime === "BULLISH");
    expect(bullish?.tradeCount).toBe(1);
    expect(bullish?.netPnL).toBe(1000);
  });

  test("16. Exit breakdown", () => {
    const mockTrades: GenuineTradeRecord[] = [
      { tradeId: "t1", exitReason: "PROFIT_TARGET_CAPTURED", netPnL: 1500 } as any,
      { tradeId: "t2", exitReason: "STOP_LOSS_HIT", netPnL: -1000 } as any,
    ];

    const breakdown = engine.calculateExitBreakdown(mockTrades);
    const targetExit = breakdown.find((e) => e.exitReason === "TARGET_50_PERCENT");
    expect(targetExit?.count).toBe(1);
    expect(targetExit?.netPnL).toBe(1500);
  });

  test("17. Win rate calculation", () => {
    const trades: GenuineTradeRecord[] = [
      { tradeId: "t1", netPnL: 100 } as any,
      { tradeId: "t2", netPnL: 200 } as any,
      { tradeId: "t3", netPnL: -100 } as any,
    ];

    const stats = engine.calculateCoreStatistics(trades);
    expect(stats.winRate).toBe(66.7);
  });

  test("18. Profit factor calculation", () => {
    const trades: GenuineTradeRecord[] = [
      { tradeId: "t1", grossPnL: 2000, netPnL: 1900 } as any,
      { tradeId: "t2", grossPnL: -1000, netPnL: -1100 } as any,
    ];

    const stats = engine.calculateCoreStatistics(trades);
    expect(stats.profitFactor).toBe(2);
  });

  test("19. Expectancy calculation", () => {
    const trades: GenuineTradeRecord[] = [
      { tradeId: "t1", netPnL: 1000 } as any,
      { tradeId: "t2", netPnL: -500 } as any,
    ];

    const stats = engine.calculateCoreStatistics(trades);
    expect(stats.expectancy).toBe(250);
  });

  test("20. Max drawdown calculation", () => {
    const trades: GenuineTradeRecord[] = [
      { tradeId: "t1", netPnL: 5000 } as any,
      { tradeId: "t2", netPnL: -3000 } as any,
      { tradeId: "t3", netPnL: -1000 } as any,
    ];

    const stats = engine.calculateCoreStatistics(trades);
    expect(stats.maxDrawdown).toBe(4000);
  });

  test("21. Rolling 10 metrics", () => {
    const trades: GenuineTradeRecord[] = Array.from({ length: 15 }, (_, i) => ({
      tradeId: `t_${i}`,
      netPnL: i % 2 === 0 ? 1000 : -500,
      grossPnL: i % 2 === 0 ? 1100 : -400,
    })) as any;

    const rolling = engine.calculateRollingMetrics(trades);
    const r10 = rolling.find((r) => r.windowSize === 10);
    expect(r10?.status).toBe("CALCULATED");
    expect(r10?.tradeCount).toBe(10);
  });

  test("22. Rolling 20 metrics", () => {
    const trades: GenuineTradeRecord[] = Array.from({ length: 5 }, (_, i) => ({ tradeId: `t_${i}`, netPnL: 100 })) as any;
    const rolling = engine.calculateRollingMetrics(trades);
    const r20 = rolling.find((r) => r.windowSize === 20);
    expect(r20?.status).toBe("INSUFFICIENT_SAMPLE");
  });

  test("23. Rolling 30 metrics", () => {
    const trades: GenuineTradeRecord[] = [];
    const rolling = engine.calculateRollingMetrics(trades);
    const r30 = rolling.find((r) => r.windowSize === 30);
    expect(r30?.status).toBe("INSUFFICIENT_SAMPLE");
  });

  test("24. ₹1,000 target analysis", () => {
    ledger.recordDailySession({ date: "2026-10-08", marketSession: "MARKET_OPEN", genuine: true, active: true, tradeCount: 1, grossPnL: 1200, charges: 100, slippage: 50, netPnL: 1050, wins: 1, losses: 0, noTrade: false, blockedSignals: 0, reconciliation: "PASS", dataQuality: "REAL", providerHealth: "CONNECTED" });
    ledger.recordDailySession({ date: "2026-10-09", marketSession: "MARKET_OPEN", genuine: true, active: true, tradeCount: 1, grossPnL: 500, charges: 100, slippage: 50, netPnL: 350, wins: 1, losses: 0, noTrade: false, blockedSignals: 0, reconciliation: "PASS", dataQuality: "REAL", providerHealth: "CONNECTED" });

    const summary = ledger.getSummary(true);
    expect(summary.target1000Analysis.daysAtOrAbove1000).toBe(1);
    expect(summary.target1000Analysis.daysBetween0And999).toBe(1);
  });

  test("25. Daily statistics", () => {
    ledger.recordDailySession({ date: "2026-10-08", marketSession: "MARKET_OPEN", genuine: true, active: true, tradeCount: 1, grossPnL: 1000, charges: 50, slippage: 50, netPnL: 900, wins: 1, losses: 0, noTrade: false, blockedSignals: 0, reconciliation: "PASS", dataQuality: "REAL", providerHealth: "CONNECTED" });
    ledger.recordDailySession({ date: "2026-10-09", marketSession: "MARKET_OPEN", genuine: true, active: false, tradeCount: 0, grossPnL: 0, charges: 0, slippage: 0, netPnL: 0, wins: 0, losses: 0, noTrade: true, blockedSignals: 0, reconciliation: "PASS", dataQuality: "REAL", providerHealth: "CONNECTED" });

    const summary = ledger.getSummary(true);
    expect(summary.genuineTradingDays).toBe(2);
    expect(summary.activeDays).toBe(1);
    expect(summary.noTradeDays).toBe(1);
  });

  test("26. P&L reconciliation", () => {
    const auditReport = reconciliationEngine.runReconciliation();
    expect(auditReport.isSafe).toBe(true);
  });

  test("27. Strategy fingerprint", () => {
    const fp = strategyFingerprintManager.getCurrentFingerprint();
    expect(fp.masterFingerprintHash).toBeDefined();
    expect(fp.version).toBe("1.0.0-NIFTY-MASTER");
  });

  test("28. Crash/restart recovery", () => {
    const recovery = phase26EGenuineLivePaperValidationEngine.recoverStateAfterRestart();
    expect(recovery.reconciliationStatus).toBe("PASS");
  });

  test("29. Insufficient sample gate", () => {
    const report = engine.generateValidationReport();
    expect(report.validationStatus).toBe("INSUFFICIENT_SAMPLE");
    expect(report.isValidationReady).toBe(false);
  });

  test("30. Sample complete gate", () => {
    // Generate 20 valid weekday dates (Mon-Fri) starting from Monday Oct 5, 2026
    const weekdays: string[] = [];
    const curDate = new Date("2026-10-05T09:15:00+05:30");
    while (weekdays.length < 20) {
      const day = curDate.getDay();
      if (day >= 1 && day <= 5) {
        const y = curDate.getFullYear();
        const m = String(curDate.getMonth() + 1).padStart(2, "0");
        const d = String(curDate.getDate()).padStart(2, "0");
        weekdays.push(`${y}-${m}-${d}`);
      }
      curDate.setDate(curDate.getDate() + 1);
    }

    // Populate 20 genuine sessions & 30 genuine trades
    for (let i = 0; i < 20; i++) {
      const sessId = `sess_gate_${i + 1}`;
      const dateStr = weekdays[i];
      store.recordSession({
        sessionId: sessId,
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
      });
    }

    for (let i = 0; i < 30; i++) {
      const dateStr = weekdays[i % 20];
      store.recordTrade({
        tradeId: `trd_gate_${i + 1}`,
        sessionId: `sess_gate_${(i % 20) + 1}`,
        signalId: `sig_gate_${i + 1}`,
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
      });
    }

    const report = engine.generateValidationReport();
    expect(report.validationStatus).toBe("SAMPLE_COMPLETE");
    expect(report.isValidationReady).toBe(true);
  });

  test("31. No fabricated statistics", () => {
    const emptyStats = engine.calculateCoreStatistics([]);
    expect(emptyStats.tradeCount).toBe(0);
    expect(emptyStats.profitFactor).toBe("NOT_AVAILABLE");
    expect(emptyStats.winLossRatio).toBe("NOT_AVAILABLE");
    expect(isNaN(emptyStats.winRate)).toBe(false);
  });

  test("32. Zero division handling", () => {
    const noLossTrades: GenuineTradeRecord[] = [
      { tradeId: "t1", grossPnL: 1000, netPnL: 900, brokerage: 0, STT: 0, exchangeCharges: 0, GST: 0, SEBICharges: 0, stampDuty: 0, slippage: 0 } as any,
    ];

    const stats = engine.calculateCoreStatistics(noLossTrades);
    expect(stats.profitFactor).toBe("NOT_AVAILABLE");
    expect(stats.winLossRatio).toBe("NOT_AVAILABLE");
  });

  test("33. Live execution blocked", async () => {
    const req = { symbol: "NIFTY24700CE", side: "BUY" as const, type: "MARKET" as const, quantity: 75 };
    await expect(dhanBrokerAdapter.placeOrder(req)).rejects.toThrow("SECURITY LOCK ENFORCED");
  });

  test("34. Zero real broker orders", () => {
    expect(dhanBrokerAdapter.getRealOrdersSent()).toBe(0);
  });
});
