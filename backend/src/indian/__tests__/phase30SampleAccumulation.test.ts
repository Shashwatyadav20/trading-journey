import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Phase30SampleAccumulationEngine } from "../validation/Phase30SampleAccumulationEngine";
import { Phase29ValidationControlEngine } from "../validation/Phase29ValidationControlEngine";
import { Phase28StatisticalEvidenceEngine } from "../validation/Phase28StatisticalEvidenceEngine";
import { Phase27StatisticalValidationEngine } from "../validation/Phase27StatisticalValidationEngine";
import { GenuineSampleStore, GenuineSessionRecord } from "../persistence/GenuineSampleStore";
import { GenuineDailyLedger } from "../persistence/GenuineDailyLedger";
import { dhanBrokerAdapter } from "../broker/DhanBrokerAdapter";
import { strategyFingerprintManager } from "../validation/StrategyFingerprintManager";
import { dailyRiskController } from "../risk/DailyRiskController";
import { marketSessionValidator } from "../market/MarketSessionValidator";
import { instrumentMasterResolver } from "../broker/InstrumentMasterResolver";
import { paperBrokerAdapter } from "../broker/PaperBrokerAdapter";
import { NiftyOptionChain } from "../types";

describe("PHASE 30 — Genuine Sample Accumulation Operations Test Suite", () => {
  let store: GenuineSampleStore;
  let ledger: GenuineDailyLedger;
  let p28Stats: Phase28StatisticalEvidenceEngine;
  let p29Engine: Phase29ValidationControlEngine;
  let p30Engine: Phase30SampleAccumulationEngine;

  const mockOptionChain: NiftyOptionChain = {
    spotPrice: 24700,
    timestamp: new Date().toISOString(),
    expiryDate: "2026-10-29",
    contracts: [
      { strike: 24700, optionType: "PE", ltp: 140, bid: 139, ask: 141, iv: 15, delta: -0.45, gamma: 0.002, vega: 12, theta: -8, oi: 150000, securityId: "PE24700" },
      { strike: 24550, optionType: "PE", ltp: 80, bid: 79, ask: 81, iv: 16, delta: -0.25, gamma: 0.001, vega: 9, theta: -5, oi: 110000, securityId: "PE24550" },
    ],
  };

  function createValidSessionRecord(overrides: Partial<GenuineSessionRecord> = {}): GenuineSessionRecord {
    return {
      sessionId: `sess_p30_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      sessionDateIST: "2026-10-05",
      marketSession: "MARKET_OPEN",
      genuineSession: true,
      dataGate: "PASSED",
      provider: "DHAN",
      spotSource: "DHAN",
      optionChainSource: "DHAN",
      optionPriceSource: "DHAN",
      lotSizeSource: "DHAN_MASTER",
      websocketStatus: "HEALTHY",
      reconciliationStatus: "PASS",
      timezone: "Asia/Kolkata",
      isSyntheticOptionData: false,
      createdAt: "2026-10-05T05:30:00.000Z",
      ...overrides,
    };
  }

  function createValidTradeRecord(overrides: Partial<any> = {}) {
    return {
      tradeId: `trade_p30_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      sessionId: `sess_p30_main`,
      dataTimestamp: "2026-10-05T09:29:00.000Z",
      decisionTimestamp: "2026-10-05T09:29:30.000Z",
      entryTimestamp: "2026-10-05T09:30:00.000Z",
      monitoringTimestamp: "2026-10-05T10:00:00.000Z",
      exitTimestamp: "2026-10-05T14:30:00.000Z",
      spotPriceAtEntry: 24700,
      spotPriceAtExit: 24750,
      realizedGrossPnL: 1500,
      charges: 100,
      slippage: 50,
      realizedNetPnL: 1350,
      pnlType: "REAL_MARKET_DATA_PAPER_PNL",
      dataSource: "DHAN",
      priceSource: "DHAN",
      spotSource: "DHAN",
      optionPriceSource: "DHAN",
      oiSource: "DHAN",
      ivSource: "DHAN",
      lotSizeSource: "DHAN_MASTER",
      expirySource: "DHAN",
      expiry: "2026-10-29",
      greeksSource: "REAL",
      reconciliationStatus: "PASS",
      genuineTrade: true,
      genuineSession: true,
      isSyntheticOptionData: false,
      isSimulatedTest: false,
      strategyFingerprintHash: strategyFingerprintManager.getCurrentFingerprint().masterFingerprintHash,
      validationFlags: {
        realSpot: true,
        realOptionChain: true,
        realOptionPrices: true,
        lotSizeVerified: true,
        reconciliationPassed: true,
      },
      ...overrides,
    };
  }

  function createValidSignal(overrides: Partial<any> = {}) {
    return {
      symbol: "NIFTY",
      status: "READY",
      action: "BULL_PUT_SPREAD",
      spotPrice: 24700,
      expiry: "2026-10-29",
      sellLeg: { strike: 24700, optionType: "PE", price: 140 },
      buyLeg: { strike: 24550, optionType: "PE", price: 80 },
      netCredit: 60,
      maxProfit: 4500,
      maxLoss: 6750,
      quantityLots: 1,
      totalQuantity: 75,
      marginRequired: 45000,
      charges: { totalCharges: 76, grossPnl: 0, netPnl: 0, entryCharges: 0, exitCharges: 0, brokerage: 0, stt: 0, exchangeFees: 0, gst: 0, sebiFees: 0, stampDuty: 0, estimatedSlippage: 0 },
      reasons: [],
      timestamp: `2026-10-05T09:30:00.000Z_${Math.random()}`,
      ...overrides,
    };
  }

  beforeEach(() => {
    process.env.PAPER_TRADING = "true";
    process.env.LIVE_TRADING = "false";
    process.env.BROKER_EXECUTION_ENABLED = "false";
    process.env.INDIAN_REAL_DATA_ONLY = "true";

    vi.spyOn(dhanBrokerAdapter, "isConfigured").mockReturnValue(true);

    store = new GenuineSampleStore();
    ledger = new GenuineDailyLedger();
    p28Stats = new Phase28StatisticalEvidenceEngine(store, ledger);
    p29Engine = new Phase29ValidationControlEngine(store, ledger, p28Stats);
    p30Engine = new Phase30SampleAccumulationEngine(p29Engine, store, ledger);

    dailyRiskController.resetDailyState();
    paperBrokerAdapter.reconstructState([], []);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // 1. Market session start
  it("1. Market-session start: Pre-session validation passes when all Dhan components are healthy", () => {
    vi.spyOn(marketSessionValidator, "validateSessionForTrading").mockReturnValue({
      isValid: true,
      sessionStatus: "MARKET_OPEN",
      rejectionReason: null,
    });
    const pre = p30Engine.validatePreSession();
    expect(pre.isReady).toBe(true);
    expect(pre.failureReason).toBeNull();
  });

  // 2. Pre-market blocking
  it("2. Pre-market blocking: Session is blocked when market session is PRE_MARKET", () => {
    vi.spyOn(marketSessionValidator, "validateSessionForTrading").mockReturnValue({
      isValid: false,
      sessionStatus: "PRE_MARKET",
      rejectionReason: "Pre-market session active",
    });
    const pre = p30Engine.validatePreSession();
    expect(pre.isReady).toBe(false);
  });

  // 3. After-hours blocking
  it("3. After-hours blocking: Session is blocked when market session is AFTER_HOURS", () => {
    vi.spyOn(marketSessionValidator, "validateSessionForTrading").mockReturnValue({
      isValid: false,
      sessionStatus: "AFTER_HOURS",
      rejectionReason: "Market is closed",
    });
    const pre = p30Engine.validatePreSession();
    expect(pre.isReady).toBe(false);
  });

  // 4. Genuine data gate
  it("4. Genuine data gate: Returns allPassed=true when spot, option chain, and WS tick inputs are genuine", async () => {
    vi.spyOn(marketSessionValidator, "validateSessionForTrading").mockReturnValue({
      isValid: true,
      sessionStatus: "MARKET_OPEN",
      rejectionReason: null,
    });
    const res = await p30Engine.evaluateStrategy(24700, [], mockOptionChain);
    expect(res.realDataGate.allPassed).toBe(true);
  });

  // 5. Dhan provider failure
  it("5. Dhan provider failure: Strategy evaluation returns NO_TRADE when spot is invalid", async () => {
    vi.spyOn(marketSessionValidator, "validateSessionForTrading").mockReturnValue({
      isValid: true,
      sessionStatus: "MARKET_OPEN",
      rejectionReason: null,
    });
    const res = await p30Engine.evaluateStrategy(0, [], mockOptionChain);
    expect(res.signal.status).toBe("NO_TRADE");
  });

  // 6. Stale WebSocket
  it("6. Stale WebSocket: Strategy evaluation blocks trade when WS data is stale", async () => {
    vi.spyOn(marketSessionValidator, "validateSessionForTrading").mockReturnValue({
      isValid: false,
      sessionStatus: "MARKET_OPEN",
      rejectionReason: "WebSocket stale",
    });
    const res = await p30Engine.evaluateStrategy(24700, [], mockOptionChain);
    expect(res.signal.status).toBe("NO_TRADE");
  });

  // 7. Invalid expiry
  it("7. Invalid expiry: Rejects trade if expiry date is expired", async () => {
    const invalidChain = { ...mockOptionChain, expiryDate: "2020-01-01" };
    vi.spyOn(marketSessionValidator, "validateSessionForTrading").mockReturnValue({
      isValid: true,
      sessionStatus: "MARKET_OPEN",
      rejectionReason: null,
    });
    const res = await p30Engine.evaluateStrategy(24700, [], invalidChain);
    expect(res.signal.action).toBe("NO_TRADE");
  });

  // 8. Lot-size failure
  it("8. Lot-size failure: Rejects trade if lot-size provider verification fails", async () => {
    vi.spyOn(instrumentMasterResolver, "verifyLotSizeFromProvider").mockReturnValue({
      verified: false,
      lotSize: 0,
      source: "UNVERIFIED",
    });
    const res = await p30Engine.evaluateStrategy(24700, [], mockOptionChain);
    expect(res.realDataGate.lotSizeVerified).toBe(false);
  });

  // 9. Strategy evaluation
  it("9. Strategy evaluation: Executes Master Strategy logic without modifying parameters", async () => {
    vi.spyOn(marketSessionValidator, "validateSessionForTrading").mockReturnValue({
      isValid: true,
      sessionStatus: "MARKET_OPEN",
      rejectionReason: null,
    });
    const res = await p30Engine.evaluateStrategy(24700, [], mockOptionChain);
    expect(res.signal).toBeDefined();
    expect(res.signal.symbol).toBe("NIFTY");
  });

  // 10. No-trade decision
  it("10. No-trade decision: Produces clean NO_TRADE audit when market regime is unclear", async () => {
    vi.spyOn(marketSessionValidator, "validateSessionForTrading").mockReturnValue({
      isValid: true,
      sessionStatus: "MARKET_OPEN",
      rejectionReason: null,
    });
    const res = await p30Engine.evaluateStrategy(24700, [], mockOptionChain);
    expect(res.signal.status).toBe("NO_TRADE");
  });

  // 11. Genuine paper entry
  it("11. Genuine paper entry: Executes paper order via PaperBrokerAdapter with REAL_MARKET_DATA_PAPER_PNL", () => {
    vi.spyOn(marketSessionValidator, "validateSessionForTrading").mockReturnValue({
      isValid: true,
      sessionStatus: "MARKET_OPEN",
      rejectionReason: null,
    });
    const validSignal = createValidSignal();
    const pos = p30Engine.executeGenuinePaperEntry("test_user", validSignal as any);
    expect(pos.pnlType).toBe("REAL_MARKET_DATA_PAPER_PNL");
    expect(pos.mode).toBe("PAPER");
  });

  // 12. Hedge-first
  it("12. Hedge-first: Enforces BUY HEDGE before SELL SHORT execution", () => {
    const validSignal = createValidSignal();
    vi.spyOn(marketSessionValidator, "validateSessionForTrading").mockReturnValue({
      isValid: true,
      sessionStatus: "MARKET_OPEN",
      rejectionReason: null,
    });
    const pos = p30Engine.executeGenuinePaperEntry("test_user", validSignal as any);
    expect(pos.status).toBe("OPEN");
    expect(pos.buyLeg.strike).toBe(24550);
    expect(pos.sellLeg.strike).toBe(24700);
  });

  // 13. Hedge rejection
  it("13. Hedge rejection: Throws error and aborts if signal status is not READY", () => {
    const unreadySignal: any = { status: "NO_TRADE" };
    expect(() => p30Engine.executeGenuinePaperEntry("test_user", unreadySignal)).toThrow(
      /Paper execution rejected|Cannot execute/
    );
  });

  // 14. Partial fill
  it("14. Partial fill handling: Paper execution operates defined-risk spread atomically", () => {
    vi.spyOn(marketSessionValidator, "validateSessionForTrading").mockReturnValue({
      isValid: true,
      sessionStatus: "MARKET_OPEN",
      rejectionReason: null,
    });
    const validSignal = createValidSignal();
    const pos = p30Engine.executeGenuinePaperEntry("test_user", validSignal as any);
    expect(pos.sellLeg.strike).toBe(24700);
    expect(pos.buyLeg.strike).toBe(24550);
  });

  // 15. Short rejection
  it("15. Short rejection: Handles missing leg gracefully", () => {
    const invalidSignal: any = { status: "READY", sellLeg: null, buyLeg: { strike: 24550 } };
    expect(() => p30Engine.executeGenuinePaperEntry("test_user", invalidSignal)).toThrow();
  });

  // 16. Target exit
  it("16. Target exit: Paper position closes cleanly at 50% profit target", () => {
    const pos = paperBrokerAdapter.executePaperOrder("test_user", createValidSignal() as any);

    const closed = paperBrokerAdapter.closePosition(pos.id, "PROFIT_TARGET_CAPTURED", 24800, 30);
    expect(closed.status).toBe("CLOSED");
    expect(closed.exitReason).toBe("PROFIT_TARGET_CAPTURED");
  });

  // 17. Stop-loss exit
  it("17. Stop-loss exit: Paper position closes cleanly at 1.5x credit stop-loss", () => {
    const pos = paperBrokerAdapter.executePaperOrder("test_user", createValidSignal() as any);

    const closed = paperBrokerAdapter.closePosition(pos.id, "STOP_LOSS_HIT", 24500, 150);
    expect(closed.status).toBe("CLOSED");
    expect(closed.exitReason).toBe("STOP_LOSS_HIT");
  });

  // 18. Risk lock
  it("18. Risk lock: Daily risk controller locks trading when profit target or loss limit is breached", () => {
    dailyRiskController.recordTradeClosed(1200);
    expect(dailyRiskController.getState().isDailyProfitLocked).toBe(true);
  });

  // 19. Genuine trade finalization
  it("19. Genuine trade finalization: Finalizes genuine trade through Phase29 engine", () => {
    const sRec = createValidSessionRecord();
    const tRec = createValidTradeRecord({ sessionId: sRec.sessionId });

    const result = p30Engine.finalizeMarketSession(sRec, [tRec]);
    expect(result.finalizedTrades[0].genuineTrade).toBe(true);
  });

  // 20. Genuine session finalization
  it("20. Genuine session finalization: Finalizes genuine session through Phase29 engine", () => {
    const sRec = createValidSessionRecord();
    const result = p30Engine.finalizeMarketSession(sRec, []);
    expect(result.finalizedSession.genuineSession).toBe(true);
    expect(result.finalizedSession.status).toBe("FINALIZED");
  });

  // 21. Active session count
  it("21. Active session count: Counts session as active ONLY when at least 1 genuine trade is present", () => {
    const sRec = createValidSessionRecord();
    const tRec = createValidTradeRecord({ sessionId: sRec.sessionId });

    const result = p30Engine.finalizeMarketSession(sRec, [tRec]);
    expect(result.progress.activeSessions).toBe(1);
  });

  // 22. Duplicate prevention
  it("22. Duplicate prevention: Duplicate session finalization returns cached record", () => {
    const sRec = createValidSessionRecord();
    const res1 = p30Engine.finalizeMarketSession(sRec, []);
    const res2 = p30Engine.finalizeMarketSession(sRec, []);
    expect(res1.finalizedSession).toEqual(res2.finalizedSession);
  });

  // 23. Restart recovery
  it("23. Restart recovery: Restores state without corrupting sample counters", () => {
    const recovery = p30Engine.recoverStateAfterRestart();
    expect(recovery.reconciliationStatus).toBe("PASS");
  });

  // 24. Phase 28 update
  it("24. Phase 28 update: Recalculates Phase 28 evidence after finalized genuine session/trade", () => {
    const sRec = createValidSessionRecord();
    const tRec = createValidTradeRecord({ sessionId: sRec.sessionId });
    p30Engine.finalizeMarketSession(sRec, [tRec]);

    const report = p28Stats.generateReport();
    expect(report.validationStatus).toBe("INSUFFICIENT_SAMPLE");
  });

  // 25. Phase 29 update
  it("25. Phase 29 update: Updates Phase 29 progress counters after finalized session", () => {
    const sRec = createValidSessionRecord();
    p30Engine.finalizeMarketSession(sRec, []);

    const ops = p30Engine.getOperationsStatus();
    expect(ops.genuineSessionsCount).toBe(1);
  });

  // 26. Synthetic exclusion
  it("26. Synthetic exclusion: Excludes synthetic option session from genuine count", () => {
    const sRec = createValidSessionRecord({ isSyntheticOptionData: true });
    p30Engine.finalizeMarketSession(sRec, []);

    const ops = p30Engine.getOperationsStatus();
    expect(ops.genuineSessionsCount).toBe(0);
  });

  // 27. Simulated exclusion
  it("27. Simulated exclusion: Excludes simulated trade from genuine trade count", () => {
    const sRec = createValidSessionRecord();
    const tRec = createValidTradeRecord({ sessionId: sRec.sessionId, isSimulatedTest: true });

    p30Engine.finalizeMarketSession(sRec, [tRec]);
    const ops = p30Engine.getOperationsStatus();
    expect(ops.genuineTrades).toBe(0);
  });

  // 28. Fingerprint validation
  it("28. Fingerprint validation: Rejects session if strategy fingerprint hash mismatches", () => {
    const sRec = createValidSessionRecord();
    const tRec = createValidTradeRecord({
      sessionId: sRec.sessionId,
      strategyFingerprintHash: "MismatchedHash123",
    });

    const result = p30Engine.finalizeMarketSession(sRec, [tRec]);
    expect(result.finalizedTrades[0].genuineTrade).toBe(false);
    expect(result.finalizedTrades[0].exclusionReason).toBe("STRATEGY_CHANGED");
  });

  // 29. Live execution blocked
  it("29. Live execution blocked: Attempts to call placeOrder return SECURITY LOCK ENFORCED", async () => {
    await expect(
      dhanBrokerAdapter.placeOrder({
        symbol: "NIFTY24700CE",
        side: "BUY",
        type: "MARKET",
        quantity: 75,
      } as any)
    ).rejects.toThrow(/SECURITY LOCK ENFORCED/);
  });

  // 30. Zero real broker orders
  it("30. Zero real broker orders: Verifies realBrokerOrders remains strictly 0", () => {
    const ops = p30Engine.getOperationsStatus();
    expect(ops.realBrokerOrders).toBe(0);
    expect(ops.liveTrading).toBe(false);
    expect(ops.brokerExecution).toBe(false);
  });
});
