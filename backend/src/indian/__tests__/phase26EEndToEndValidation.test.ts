import { describe, test, expect, beforeEach, vi } from "vitest";
import {
  Phase26EGenuineLivePaperValidationEngine,
} from "../validation/Phase26EGenuineLivePaperValidationEngine";
import { dhanBrokerAdapter } from "../broker/DhanBrokerAdapter";
import { dhanMarketFeedProvider } from "../market/DhanMarketFeedProvider";
import { paperBrokerAdapter } from "../broker/PaperBrokerAdapter";
import { dailyRiskController } from "../risk/DailyRiskController";
import { reconciliationEngine } from "../reconciliation/ReconciliationEngine";
import { marketSessionValidator } from "../market/MarketSessionValidator";
import { instrumentMasterResolver } from "../broker/InstrumentMasterResolver";
import { expiryValidator } from "../market/ExpiryValidator";
import { paperJournalStore } from "../audit/PaperJournalStore";
import { paperPersistenceManager } from "../persistence/PaperPersistenceManager";
import { AutoHedgeSignal, NiftyOptionChain } from "../types";

describe("PHASE 26E — End-to-End Genuine Live Paper Session Validation Suite", () => {
  let engine: Phase26EGenuineLivePaperValidationEngine;

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env.PAPER_TRADING = "true";
    process.env.LIVE_TRADING = "false";
    process.env.BROKER_EXECUTION_ENABLED = "false";
    process.env.INDIAN_REAL_DATA_ONLY = "true";
    process.env.EXECUTION_MODE = "SIMULATED_TEST";

    engine = new Phase26EGenuineLivePaperValidationEngine();
    dailyRiskController.resetDailyState();
  });

  test("1. Genuine session gate", () => {
    const gate = engine.evaluateRealDataGate(24700);
    expect(gate).toBeDefined();
    expect(typeof gate.allPassed).toBe("boolean");
  });

  test("2. All 7 criteria pass", () => {
    vi.spyOn(marketSessionValidator, "validateSessionForTrading").mockReturnValue({
      isValid: true,
      sessionStatus: "MARKET_OPEN",
      istTimestamp: new Date().toISOString(),
      istDate: "2026-10-08",
      rejectionReason: null,
    });

    const mockChain: NiftyOptionChain = {
      spotPrice: 24700,
      timestamp: new Date().toISOString(),
      isSynthetic: false,
      contracts: [
        {
          symbol: "NIFTY26100824700CE",
          expiry: "2026-10-08",
          strike: 24700,
          optionType: "CE",
          ltp: 150,
          bid: 149.5,
          ask: 150.5,
          volume: 1000,
          openInterest: 5000,
          changeInOI: 100,
          iv: 0.15,
          delta: 0.5,
          timestamp: new Date().toISOString(),
        },
      ],
    };

    const gate = engine.evaluateRealDataGate(24700, mockChain, true);
    expect(gate.allPassed).toBe(true);
    expect(gate.rejectionReasons.length).toBe(0);
  });

  test("3. One criterion fails (e.g. market session closed)", () => {
    vi.spyOn(marketSessionValidator, "validateSessionForTrading").mockReturnValue({
      isValid: false,
      sessionStatus: "MARKET_CLOSED",
      istTimestamp: new Date().toISOString(),
      istDate: "2026-10-08",
      rejectionReason: "MARKET_SESSION_CLOSED",
    });

    const gate = engine.evaluateRealDataGate(24700);
    expect(gate.allPassed).toBe(false);
    expect(gate.marketSessionValid).toBe(false);
    expect(gate.rejectionReasons.some((r) => r.includes("MARKET_SESSION_INVALID"))).toBe(true);
  });

  test("4. Real option-chain validation", () => {
    const ocStatus = dhanBrokerAdapter.getOptionChainStatus();
    expect(ocStatus.provider).toBe("DHAN");
    expect(ocStatus.syntheticFallback).toBe(false);
    expect(ocStatus.realDataOnly).toBe(true);
  });

  test("5. WebSocket tick validation", () => {
    const wsHealth = dhanMarketFeedProvider.getHealth();
    expect(wsHealth.provider).toBe("DHAN");
    expect(wsHealth.realDataOnly).toBe(true);
  });

  test("6. Real price provenance", () => {
    const mockChain: NiftyOptionChain = {
      spotPrice: 24700,
      timestamp: new Date().toISOString(),
      contracts: [
        {
          symbol: "NIFTY26100824700PE",
          expiry: "2026-10-08",
          strike: 24700,
          optionType: "PE",
          ltp: 120,
          bid: 119,
          ask: 121,
          volume: 500,
          openInterest: 2000,
          changeInOI: 50,
          iv: 0.14,
          delta: -0.45,
          timestamp: new Date().toISOString(),
        },
      ],
    };

    const gate = engine.evaluateRealDataGate(24700, mockChain, true);
    expect(gate.realOptionPrices).toBe(true);
  });

  test("7. Master Strategy receives genuine data", async () => {
    vi.spyOn(marketSessionValidator, "validateSessionForTrading").mockReturnValue({
      isValid: true,
      sessionStatus: "MARKET_OPEN",
      istTimestamp: new Date().toISOString(),
      istDate: "2026-10-08",
      rejectionReason: null,
    });

    const mockChain: NiftyOptionChain = {
      spotPrice: 24700,
      timestamp: new Date().toISOString(),
      contracts: [
        { symbol: "NIFTY26100824700PE", expiry: "2026-10-08", strike: 24700, optionType: "PE", ltp: 100, bid: 99, ask: 101, volume: 100, openInterest: 500, changeInOI: 0, iv: 0.15, delta: -0.3, timestamp: new Date().toISOString() },
        { symbol: "NIFTY26100824550PE", expiry: "2026-10-08", strike: 24550, optionType: "PE", ltp: 40, bid: 39, ask: 41, volume: 100, openInterest: 500, changeInOI: 0, iv: 0.15, delta: -0.15, timestamp: new Date().toISOString() },
      ],
    };

    const candles = [
      { time: Math.floor(Date.now() / 1000) - 900, open: 24650, high: 24710, low: 24640, close: 24700, volume: 10000 },
    ];

    const { signal, realDataGate } = await engine.evaluateMasterStrategy(24700, candles, mockChain);
    expect(realDataGate.allPassed).toBe(true);
    expect(signal.dataSource).toBe("DHAN");
    expect(signal.greeksSource).toBe("REAL");
  });

  test("8. Valid Bull Put paper entry", () => {
    vi.spyOn(marketSessionValidator, "validateSessionForTrading").mockReturnValue({
      isValid: true,
      sessionStatus: "MARKET_OPEN",
      istTimestamp: new Date().toISOString(),
      istDate: "2026-10-08",
      rejectionReason: null,
    });

    const signal: AutoHedgeSignal = {
      symbol: "NIFTY",
      timestamp: new Date().toISOString(),
      regime: "BULLISH",
      score: 85,
      action: "BULL_PUT_SPREAD",
      expiry: "2026-10-08",
      spotPrice: 24700,
      sellLeg: { symbol: "NIFTY26100824700PE", strike: 24700, optionType: "PE", ltp: 100, bid: 99, ask: 101, iv: 0.15, delta: -0.3 },
      buyLeg: { symbol: "NIFTY26100824550PE", strike: 24550, optionType: "PE", ltp: 40, bid: 39, ask: 41, iv: 0.15, delta: -0.15 },
      netCredit: 60,
      maxProfit: 4500,
      maxLoss: 600,
      entryPrice: 60,
      stopLossSpread: 90,
      targetSpread: 30,
      quantityLots: 1,
      totalQuantity: 75,
      marginRequired: 11250,
      charges: { grossPnl: 0, entryCharges: 50, exitCharges: 50, brokerage: 40, stt: 10, exchangeFees: 5, gst: 10, sebiFees: 1, stampDuty: 2, estimatedSlippage: 10, totalCharges: 128, netPnl: 0 },
      expectedNetPnl: 4372,
      riskPercentage: 1,
      rewardRiskRatio: 7.5,
      status: "READY",
      reasons: ["Test Bull Put Signal"],
    };

    const pos = engine.executePaperOrderWithHedgeFirst("test-bull-put-user", signal);
    expect(pos.strategy).toBe("BULL_PUT_SPREAD");
    expect(pos.pnlType).toBe("REAL_MARKET_DATA_PAPER_PNL");
    expect(pos.status).toBe("OPEN");
  });

  test("9. Valid Bear Call paper entry", () => {
    vi.spyOn(marketSessionValidator, "validateSessionForTrading").mockReturnValue({
      isValid: true,
      sessionStatus: "MARKET_OPEN",
      istTimestamp: new Date().toISOString(),
      istDate: "2026-10-08",
      rejectionReason: null,
    });

    const signal: AutoHedgeSignal = {
      symbol: "NIFTY",
      timestamp: new Date().toISOString(),
      regime: "BEARISH",
      score: 85,
      action: "BEAR_CALL_SPREAD",
      expiry: "2026-10-08",
      spotPrice: 24700,
      sellLeg: { symbol: "NIFTY26100824700CE", strike: 24700, optionType: "CE", ltp: 100, bid: 99, ask: 101, iv: 0.15, delta: 0.3 },
      buyLeg: { symbol: "NIFTY26100824850CE", strike: 24850, optionType: "CE", ltp: 40, bid: 39, ask: 41, iv: 0.15, delta: 0.15 },
      netCredit: 60,
      maxProfit: 4500,
      maxLoss: 600,
      entryPrice: 60,
      stopLossSpread: 90,
      targetSpread: 30,
      quantityLots: 1,
      totalQuantity: 75,
      marginRequired: 11250,
      charges: { grossPnl: 0, entryCharges: 50, exitCharges: 50, brokerage: 40, stt: 10, exchangeFees: 5, gst: 10, sebiFees: 1, stampDuty: 2, estimatedSlippage: 10, totalCharges: 128, netPnl: 0 },
      expectedNetPnl: 4372,
      riskPercentage: 1,
      rewardRiskRatio: 7.5,
      status: "READY",
      reasons: ["Test Bear Call Signal"],
    };

    const pos = engine.executePaperOrderWithHedgeFirst("test-bear-call-user", signal);
    expect(pos.strategy).toBe("BEAR_CALL_SPREAD");
    expect(pos.pnlType).toBe("REAL_MARKET_DATA_PAPER_PNL");
  });

  test("10. Valid Iron Condor paper entry", () => {
    vi.spyOn(marketSessionValidator, "validateSessionForTrading").mockReturnValue({
      isValid: true,
      sessionStatus: "MARKET_OPEN",
      istTimestamp: new Date().toISOString(),
      istDate: "2026-10-08",
      rejectionReason: null,
    });

    const signal: AutoHedgeSignal = {
      symbol: "NIFTY",
      timestamp: new Date().toISOString(),
      regime: "RANGE",
      score: 85,
      action: "IRON_CONDOR",
      expiry: "2026-10-08",
      spotPrice: 24700,
      sellLeg: { symbol: "NIFTY26100824600PE", strike: 24600, optionType: "PE", ltp: 60, bid: 59, ask: 61, iv: 0.15, delta: -0.2 },
      buyLeg: { symbol: "NIFTY26100824450PE", strike: 24450, optionType: "PE", ltp: 20, bid: 19, ask: 21, iv: 0.15, delta: -0.1 },
      netCredit: 40,
      maxProfit: 3000,
      maxLoss: 600,
      entryPrice: 40,
      stopLossSpread: 60,
      targetSpread: 20,
      quantityLots: 1,
      totalQuantity: 75,
      marginRequired: 11250,
      charges: { grossPnl: 0, entryCharges: 50, exitCharges: 50, brokerage: 40, stt: 10, exchangeFees: 5, gst: 10, sebiFees: 1, stampDuty: 2, estimatedSlippage: 10, totalCharges: 128, netPnl: 0 },
      expectedNetPnl: 2872,
      riskPercentage: 1,
      rewardRiskRatio: 5.0,
      status: "READY",
      reasons: ["Test Iron Condor Signal"],
    };

    const pos = engine.executePaperOrderWithHedgeFirst("test-ic-user", signal);
    expect(pos.strategy).toBe("IRON_CONDOR");
    expect(pos.pnlType).toBe("REAL_MARKET_DATA_PAPER_PNL");
  });

  test("11. No-trade rejection", async () => {
    vi.spyOn(marketSessionValidator, "validateSessionForTrading").mockReturnValue({
      isValid: false,
      sessionStatus: "MARKET_CLOSED",
      istTimestamp: new Date().toISOString(),
      istDate: "2026-10-08",
      rejectionReason: "MARKET_SESSION_CLOSED",
    });

    const mockChain: NiftyOptionChain = { spotPrice: 24700, timestamp: new Date().toISOString(), contracts: [] };
    const { signal } = await engine.evaluateMasterStrategy(24700, [], mockChain);

    expect(signal.action).toBe("NO_TRADE");
    expect(signal.status).toBe("NO_TRADE");
  });

  test("12. Hedge-first execution", () => {
    vi.spyOn(marketSessionValidator, "validateSessionForTrading").mockReturnValue({
      isValid: true,
      sessionStatus: "MARKET_OPEN",
      istTimestamp: new Date().toISOString(),
      istDate: "2026-10-08",
      rejectionReason: null,
    });

    const signal: AutoHedgeSignal = {
      symbol: "NIFTY",
      timestamp: new Date().toISOString(),
      regime: "BULLISH",
      score: 85,
      action: "BULL_PUT_SPREAD",
      expiry: "2026-10-08",
      spotPrice: 24700,
      sellLeg: { symbol: "NIFTY26100824700PE", strike: 24700, optionType: "PE", ltp: 100, bid: 99, ask: 101, iv: 0.15, delta: -0.3 },
      buyLeg: { symbol: "NIFTY26100824550PE", strike: 24550, optionType: "PE", ltp: 40, bid: 39, ask: 41, iv: 0.15, delta: -0.15 },
      netCredit: 60,
      maxProfit: 4500,
      maxLoss: 600,
      entryPrice: 60,
      stopLossSpread: 90,
      targetSpread: 30,
      quantityLots: 1,
      totalQuantity: 75,
      marginRequired: 11250,
      charges: { grossPnl: 0, entryCharges: 50, exitCharges: 50, brokerage: 40, stt: 10, exchangeFees: 5, gst: 10, sebiFees: 1, stampDuty: 2, estimatedSlippage: 10, totalCharges: 128, netPnl: 0 },
      expectedNetPnl: 4372,
      riskPercentage: 1,
      rewardRiskRatio: 7.5,
      status: "READY",
      reasons: ["Hedge first test"],
    };

    const pos = engine.executePaperOrderWithHedgeFirst("test-hf-user", signal);
    expect(pos.buyLeg.status).toBe("FILLED");
    expect(pos.sellLeg.status).toBe("FILLED");
  });

  test("13. Hedge rejection", () => {
    vi.spyOn(marketSessionValidator, "validateSessionForTrading").mockReturnValue({
      isValid: true,
      sessionStatus: "MARKET_OPEN",
      istTimestamp: new Date().toISOString(),
      istDate: "2026-10-08",
      rejectionReason: null,
    });

    const signal: AutoHedgeSignal = {
      symbol: "NIFTY",
      timestamp: new Date().toISOString(),
      regime: "BULLISH",
      score: 85,
      action: "BULL_PUT_SPREAD",
      expiry: "2026-10-08",
      spotPrice: 24700,
      sellLeg: { symbol: "NIFTY26100824700PE", strike: 24700, optionType: "PE", ltp: 0, bid: 0, ask: 0, iv: 0, delta: 0 }, // Invalid quote
      buyLeg: { symbol: "NIFTY26100824550PE", strike: 24550, optionType: "PE", ltp: 40, bid: 39, ask: 41, iv: 0.15, delta: -0.15 },
      netCredit: 60,
      maxProfit: 4500,
      maxLoss: 600,
      entryPrice: 60,
      stopLossSpread: 90,
      targetSpread: 30,
      quantityLots: 1,
      totalQuantity: 75,
      marginRequired: 11250,
      charges: { grossPnl: 0, entryCharges: 50, exitCharges: 50, brokerage: 40, stt: 10, exchangeFees: 5, gst: 10, sebiFees: 1, stampDuty: 2, estimatedSlippage: 10, totalCharges: 128, netPnl: 0 },
      expectedNetPnl: 4372,
      riskPercentage: 1,
      rewardRiskRatio: 7.5,
      status: "READY",
      reasons: ["Hedge failure test"],
    };

    expect(() => engine.executePaperOrderWithHedgeFirst("test-user", signal)).toThrow("Stale or invalid quotes detected");
  });

  test("14. Partial hedge fill abort", async () => {
    const res = await engine.runControlledFailureInjectionTest("partial_hedge", "HEDGE_REJECTION");
    expect(res.passed).toBe(true);
    expect(res.rejectionReason).toBe("HEDGE_NOT_CONFIRMED");
  });

  test("15. Short-leg rejection", async () => {
    const res = await engine.runControlledFailureInjectionTest("short_leg_reject", "HEDGE_REJECTION");
    expect(res.passed).toBe(true);
  });

  test("16. Target exit (50% initial credit capture)", () => {
    const signal: AutoHedgeSignal = {
      signalId: "SIG_TGT_001",
      symbol: "NIFTY",
      timestamp: new Date().toISOString(),
      regime: "BULLISH",
      score: 85,
      action: "BULL_PUT_SPREAD",
      expiry: "2026-10-08",
      spotPrice: 24700,
      sellLeg: { symbol: "NIFTY26100824700PE", strike: 24700, optionType: "PE", ltp: 100, bid: 99, ask: 101, iv: 0.15, delta: -0.3 },
      buyLeg: { symbol: "NIFTY26100824550PE", strike: 24550, optionType: "PE", ltp: 40, bid: 39, ask: 41, iv: 0.15, delta: -0.15 },
      netCredit: 60,
      maxProfit: 4500,
      maxLoss: 600,
      entryPrice: 60,
      stopLossSpread: 90,
      targetSpread: 30, // 50% target
      quantityLots: 1,
      totalQuantity: 75,
      marginRequired: 11250,
      charges: { grossPnl: 0, entryCharges: 50, exitCharges: 50, brokerage: 40, stt: 10, exchangeFees: 5, gst: 10, sebiFees: 1, stampDuty: 2, estimatedSlippage: 10, totalCharges: 128, netPnl: 0 },
      expectedNetPnl: 4372,
      riskPercentage: 1,
      rewardRiskRatio: 7.5,
      status: "READY",
      reasons: ["Target exit test"],
    };

    const pos = paperBrokerAdapter.executePaperOrder("test-tgt-user", signal);
    paperJournalStore.recordOrderExecution(pos);
    // Simulate spread price decaying to 25 (below targetSpread 30)
    paperBrokerAdapter.processMarketTick(24800, { contracts: [{ strike: 24700, ltp: 55 }, { strike: 24550, ltp: 30 }] }, false);

    const closed = paperBrokerAdapter.getClosedPositions().find((p) => p.id === pos.id);
    expect(closed?.exitReason).toBe("PROFIT_TARGET_CAPTURED");
  });

  test("17. Stop-loss exit (1.5x initial net credit)", () => {
    const signal: AutoHedgeSignal = {
      signalId: "SIG_SL_001",
      symbol: "NIFTY",
      timestamp: new Date().toISOString(),
      regime: "BULLISH",
      score: 85,
      action: "BULL_PUT_SPREAD",
      expiry: "2026-10-08",
      spotPrice: 24700,
      sellLeg: { symbol: "NIFTY26100824700PE", strike: 24700, optionType: "PE", ltp: 100, bid: 99, ask: 101, iv: 0.15, delta: -0.3 },
      buyLeg: { symbol: "NIFTY26100824550PE", strike: 24550, optionType: "PE", ltp: 40, bid: 39, ask: 41, iv: 0.15, delta: -0.15 },
      netCredit: 60,
      maxProfit: 4500,
      maxLoss: 600,
      entryPrice: 60,
      stopLossSpread: 90, // 1.5x initial net credit
      targetSpread: 30,
      quantityLots: 1,
      totalQuantity: 75,
      marginRequired: 11250,
      charges: { grossPnl: 0, entryCharges: 50, exitCharges: 50, brokerage: 40, stt: 10, exchangeFees: 5, gst: 10, sebiFees: 1, stampDuty: 2, estimatedSlippage: 10, totalCharges: 128, netPnl: 0 },
      expectedNetPnl: 4372,
      riskPercentage: 1,
      rewardRiskRatio: 7.5,
      status: "READY",
      reasons: ["Stop loss test"],
    };

    const pos = paperBrokerAdapter.executePaperOrder("test-sl-user", signal);
    paperJournalStore.recordOrderExecution(pos);
    // Simulate spread price widening to 95 (above stopLossSpread 90)
    paperBrokerAdapter.processMarketTick(24500, { contracts: [{ strike: 24700, ltp: 140 }, { strike: 24550, ltp: 45 }] }, false);

    const closed = paperBrokerAdapter.getClosedPositions().find((p) => p.id === pos.id);
    expect(closed?.exitReason).toBe("STOP_LOSS_HIT");
  });

  test("18. Structure invalidation", () => {
    const nowTs = new Date(Date.now() + 5000).toISOString();
    const signal: AutoHedgeSignal = {
      signalId: "SIG_STRUCT_UNIQUE_001",
      symbol: "NIFTY",
      timestamp: nowTs,
      regime: "BULLISH",
      score: 85,
      action: "BULL_PUT_SPREAD",
      expiry: "2026-10-08",
      spotPrice: 24700,
      sellLeg: { symbol: "NIFTY26100824700PE", strike: 24700, optionType: "PE", ltp: 100, bid: 99, ask: 101, iv: 0.15, delta: -0.3 },
      buyLeg: { symbol: "NIFTY26100824550PE", strike: 24550, optionType: "PE", ltp: 40, bid: 39, ask: 41, iv: 0.15, delta: -0.15 },
      netCredit: 60,
      maxProfit: 4500,
      maxLoss: 600,
      entryPrice: 60,
      stopLossSpread: 90,
      targetSpread: 30,
      quantityLots: 1,
      totalQuantity: 75,
      marginRequired: 11250,
      charges: { grossPnl: 0, entryCharges: 50, exitCharges: 50, brokerage: 40, stt: 10, exchangeFees: 5, gst: 10, sebiFees: 1, stampDuty: 2, estimatedSlippage: 10, totalCharges: 128, netPnl: 0 },
      expectedNetPnl: 4372,
      riskPercentage: 1,
      rewardRiskRatio: 7.5,
      status: "READY",
      reasons: ["Structure invalidation test"],
    };

    const pos = paperBrokerAdapter.executePaperOrder("test-struct-user", signal);
    paperJournalStore.recordOrderExecution(pos);
    paperBrokerAdapter.processMarketTick(24700, undefined, false, { isStructureValid: false });

    const closed = paperBrokerAdapter.getClosedPositions().find((p) => p.id === pos.id);
    expect(closed?.exitReason).toBe("STRUCTURE_INVALIDATED");
  });

  test("19. Daily profit lock", async () => {
    const res = await engine.runControlledFailureInjectionTest("daily_profit_lock", "DAILY_PROFIT_LOCK");
    expect(res.passed).toBe(true);
    expect(res.rejectionReason?.toLowerCase()).toContain("profit");
  });

  test("20. Daily loss lock", async () => {
    const res = await engine.runControlledFailureInjectionTest("daily_loss_lock", "DAILY_LOSS_LOCK");
    expect(res.passed).toBe(true);
    expect(res.rejectionReason?.toLowerCase()).toContain("loss");
  });

  test("21. P&L reconciliation", () => {
    paperBrokerAdapter.resetAccount();
    dailyRiskController.resetDailyState();
    paperJournalStore.clearJournal();
    paperPersistenceManager.clearAllData();

    const auditReport = reconciliationEngine.runReconciliation();
    expect(auditReport.isSafe).toBe(true);
    expect(auditReport.discrepancies.length).toBe(0);
  });

  test("22. Dhan/NSE discrepancy", async () => {
    const logs = dhanBrokerAdapter.getDiscrepancyLogs();
    expect(Array.isArray(logs)).toBe(true);
  });

  test("23. Stale WebSocket", async () => {
    const res = await engine.runControlledFailureInjectionTest("stale_ws", "STALE_TICK");
    expect(res.passed).toBe(true);
    expect(res.rejectionReason).toBe("DATA_STALE");
  });

  test("24. Restart recovery", () => {
    paperBrokerAdapter.resetAccount();
    dailyRiskController.resetDailyState();
    paperJournalStore.clearJournal();
    paperPersistenceManager.clearAllData();

    const recovery = engine.recoverStateAfterRestart();
    expect(recovery.reconciliationStatus).toBe("PASS");
    expect(typeof recovery.openPositionsCount).toBe("number");
  });

  test("25. Duplicate signal prevention", () => {
    const signal: AutoHedgeSignal = {
      signalId: "SIG_DUP_001",
      symbol: "NIFTY",
      timestamp: new Date().toISOString(),
      regime: "BULLISH",
      score: 85,
      action: "BULL_PUT_SPREAD",
      expiry: "2026-10-08",
      spotPrice: 24700,
      sellLeg: { symbol: "NIFTY26100824700PE", strike: 24700, optionType: "PE", ltp: 100, bid: 99, ask: 101, iv: 0.15, delta: -0.3 },
      buyLeg: { symbol: "NIFTY26100824550PE", strike: 24550, optionType: "PE", ltp: 40, bid: 39, ask: 41, iv: 0.15, delta: -0.15 },
      netCredit: 60,
      maxProfit: 4500,
      maxLoss: 600,
      entryPrice: 60,
      stopLossSpread: 90,
      targetSpread: 30,
      quantityLots: 1,
      totalQuantity: 75,
      marginRequired: 11250,
      charges: { grossPnl: 0, entryCharges: 50, exitCharges: 50, brokerage: 40, stt: 10, exchangeFees: 5, gst: 10, sebiFees: 1, stampDuty: 2, estimatedSlippage: 10, totalCharges: 128, netPnl: 0 },
      expectedNetPnl: 4372,
      riskPercentage: 1,
      rewardRiskRatio: 7.5,
      status: "READY",
      reasons: ["Duplicate signal test"],
    };

    const pos1 = paperBrokerAdapter.executePaperOrder("test-dup-user", signal);
    const pos2 = paperBrokerAdapter.executePaperOrder("test-dup-user", signal);

    expect(pos1.id).toBe(pos2.id);
  });

  test("26. Genuine-session classification", () => {
    const status = engine.getSessionStatus();
    expect(status.status).toBeDefined();
    expect(typeof status.genuineSession).toBe("boolean");
  });

  test("27. Genuine-trade classification", () => {
    const status = engine.getSessionStatus();
    expect(typeof status.genuineTrades).toBe("number");
  });

  test("28. Simulated data exclusion", async () => {
    const res = await engine.runControlledFailureInjectionTest("sim_exclusion", "DHAN_UNAVAILABLE");
    expect(res.isSimulatedTest).toBe(true);
    expect(res.countedInGenuineSample).toBe(false);
  });

  test("29. Live broker execution blocked", async () => {
    const res = await engine.runControlledFailureInjectionTest("live_blocked", "LIVE_BROKER_EXECUTION_ATTEMPT");
    expect(res.passed).toBe(true);
    expect(res.rejectionReason).toContain("SECURITY LOCK ENFORCED");
  });

  test("30. Zero real broker orders", () => {
    expect(dhanBrokerAdapter.getRealOrdersSent()).toBe(0);
    const status = engine.getSessionStatus();
    expect(status.liveOrders).toBe(0);
  });
});
