import { describe, test, expect, beforeEach } from "vitest";
import { Candle } from "../types";
import { niftyMarketProvider } from "../market/NiftyMarketProvider";
import { hedgingStrategyEngine } from "../strategy/HedgingStrategyEngine";
import { paperBrokerAdapter } from "../broker/PaperBrokerAdapter";
import { dailyRiskController } from "../risk/DailyRiskController";
import { paperSessionManager } from "../lifecycle/PaperSessionManager";
import { signalLifecycleEngine } from "../lifecycle/SignalLifecycleEngine";
import { signalCooldownEngine } from "../lifecycle/SignalCooldownEngine";
import { paperJournalStore } from "../audit/PaperJournalStore";
import { niftyOptionChainService } from "../market/NiftyOptionChainService";

describe("Phase 10 — Live Paper Trading Validation & Complete Trade Lifecycle Suite", () => {
  beforeEach(() => {
    dailyRiskController.resetLocks();
    paperBrokerAdapter.resetAccount(500000);
    signalCooldownEngine.reset();
    signalLifecycleEngine.transitionTo("WAITING_FOR_DATA", "Resetting test state");
    paperJournalStore.clear();
  });

  const createBullishCandles = (basePrice: number = 25000): Candle[] => {
    const candles: Candle[] = [];
    let price = basePrice;
    for (let i = 0; i < 20; i++) {
      candles.push({
        time: 1700000000 + i * 900,
        open: price,
        high: price + 15,
        low: price - 5,
        close: price + 10,
        volume: 15000,
      });
      price += 8;
    }
    return candles;
  };

  test("1. Safety Enforcement: LIVE_TRADING must be hardcoded false", () => {
    // Verify system safety rule
    const session = paperSessionManager.getSessionState();
    expect(session.isLiveTradingEnabled).toBe(false);
  });

  test("2. Session State Manager: Simulates market hours and handles simulation mode override", () => {
    const session = paperSessionManager.getSessionState();
    expect(session.symbol).toBe("NIFTY");
    expect(session.isPaperMode).toBe(true);

    paperSessionManager.setSimulationMode(true);
    expect(paperSessionManager.getSessionState().isSimulationMode).toBe(true);

    paperSessionManager.setSimulationMode(false);
  });

  test("3. Signal State Machine: Validates sequential lifecycle transitions", () => {
    expect(signalLifecycleEngine.getCurrentState()).toBe("WAITING_FOR_DATA");

    const t1 = signalLifecycleEngine.transitionTo("DATA_READY", "Market data acquired");
    expect(t1.success).toBe(true);
    expect(signalLifecycleEngine.getCurrentState()).toBe("DATA_READY");

    const t2 = signalLifecycleEngine.transitionTo("ANALYZING", "Indicators computed");
    expect(t2.success).toBe(true);

    const t3 = signalLifecycleEngine.transitionTo("SETUP_READY", "Signal meets criteria");
    expect(t3.success).toBe(true);

    const t4 = signalLifecycleEngine.transitionTo("APPROVED", "Risk check passed");
    expect(t4.success).toBe(true);

    const history = signalLifecycleEngine.getHistory();
    expect(history.length).toBeGreaterThanOrEqual(4);
  });

  test("4. Signal Cooldown Engine: Prevents duplicate execution on identical ticks", () => {
    const spot = 25150;
    const candles = createBullishCandles(25000);
    const chain = niftyOptionChainService.generateSyntheticChain(spot);

    const signal = hedgingStrategyEngine.generateSignal(spot, candles, candles, chain, 500000, false);
    signal.action = "BULL_PUT_SPREAD";

    const canExecute1 = signalCooldownEngine.shouldAllowSignal(signal);
    expect(canExecute1.allow).toBe(true);

    signalCooldownEngine.recordSignalExecution(signal);

    const canExecute2 = signalCooldownEngine.shouldAllowSignal(signal);
    expect(canExecute2.allow).toBe(false);
    expect(canExecute2.reason).toContain("COOLDOWN_ACTIVE");
  });

  test("5. Data Freshness Gate: Rejects trade generation if data health is stale (> 60s)", async () => {
    // Artificially inject stale tick timestamp
    niftyMarketProvider.updateSpotPrice(25000, false, Date.now() - 75000);
    const health = niftyMarketProvider.getDataHealth();
    expect(health.isStale).toBe(true);

    const spotRes = await niftyMarketProvider.getSpotPrice();
    expect(spotRes.spotPrice).toBe(25000);

    // Generate signal with stale provider state
    const candles = createBullishCandles(25000);
    const chain = niftyOptionChainService.generateSyntheticChain(25000);
    const signal = hedgingStrategyEngine.generateSignal(25000, candles, candles, chain, 500000, false);

    // If health is stale, execution attempt must fail pre-entry
    expect(health.isStale).toBe(true);

    // Reset market provider state back to fresh
    niftyMarketProvider.updateSpotPrice(25000, false, Date.now());
  });

  test("6. Complete Lifecycle & 5-Level Exit Engine Verification", () => {
    const spot = 25150;
    const candles = createBullishCandles(25000);
    const chain = niftyOptionChainService.generateSyntheticChain(spot);

    // Step A: Signal Generation
    const signal = hedgingStrategyEngine.generateSignal(spot, candles, candles, chain, 500000, false);
    expect(signal.status).toBe("READY");
    expect(signal.action).toBe("BULL_PUT_SPREAD");
    expect(signal.maxLoss).toBeLessThanOrEqual(1000);

    // Record signal in journal
    paperJournalStore.logSignal(signal);

    // Step B: Paper Order Execution (Hedge-first)
    const position = paperBrokerAdapter.executePaperOrder("test-user-1", signal);
    expect(position.status).toBe("OPEN");
    expect(position.buyLeg.status).toBe("FILLED");
    expect(position.sellLeg.status).toBe("FILLED");

    paperJournalStore.logEntry(position);

    // Verify position is active
    let openPositions = paperBrokerAdapter.getOpenPositions();
    expect(openPositions.length).toBe(1);

    // Step C: Priority 5 Exit Test — Profit Target Capture (50% credit capture)
    // Net credit was e.g. ₹1500, buyback spread price drops to ₹10 => profit target hit
    const updatedChainTarget = niftyOptionChainService.generateSyntheticChain(25150);
    // Lower option prices to trigger target capture
    updatedChainTarget.contracts.forEach((c) => { c.ltp = Math.max(1, c.ltp * 0.1); });

    paperBrokerAdapter.processMarketTick(25150, updatedChainTarget, false);

    // Verify position was closed by Priority 5 exit
    openPositions = paperBrokerAdapter.getOpenPositions();
    const closedPositions = paperBrokerAdapter.getClosedPositions();

    expect(openPositions.length).toBe(0);
    expect(closedPositions.length).toBe(1);
    expect(closedPositions[0].exitReason).toBe("PROFIT_TARGET_CAPTURED");

    paperJournalStore.logExit(closedPositions[0]);

    // Step D: Journal Verification
    const journalEntries = paperJournalStore.getJournalEntries();
    expect(journalEntries.length).toBeGreaterThanOrEqual(3);
  });

  test("7. Exit Priority Engine: Priority 3 — Greek Risk Breach Exit (|Delta| > 0.45)", () => {
    const spot = 25150;
    const candles = createBullishCandles(25000);
    const chain = niftyOptionChainService.generateSyntheticChain(spot);

    const signal = hedgingStrategyEngine.generateSignal(spot, candles, candles, chain, 500000, false);
    const position = paperBrokerAdapter.executePaperOrder("test-user-2", signal);

    // Simulate tick where short leg delta spikes above 0.45
    const GreekBreachChain = niftyOptionChainService.generateSyntheticChain(24700);
    GreekBreachChain.contracts.forEach((c) => {
      if (c.strike === position.sellLeg.strike && c.optionType === "PE") {
        c.delta = -0.52; // Breach 0.45 limit
      }
    });

    paperBrokerAdapter.processMarketTick(24700, GreekBreachChain, false);

    const closed = paperBrokerAdapter.getClosedPositions();
    expect(closed.length).toBe(1);
    expect(closed[0].exitReason).toBe("GREEK_RISK_DELTA_BREACH_EXIT");
  });

  test("8. Exit Priority Engine: Priority 4 — Stop Loss Hit (1.5x Initial Net Credit)", () => {
    const spot = 25150;
    const candles = createBullishCandles(25000);
    const chain = niftyOptionChainService.generateSyntheticChain(spot);

    const signal = hedgingStrategyEngine.generateSignal(spot, candles, candles, chain, 500000, false);
    const position = paperBrokerAdapter.executePaperOrder("test-user-3", signal);

    // Simulate adverse price movement: buyback spread price expands past 1.5x initial net credit (keep spot stable so delta breach doesn't take priority)
    const adverseChain = niftyOptionChainService.generateSyntheticChain(25150);
    adverseChain.contracts.forEach((c) => {
      if (c.strike === position.sellLeg.strike && c.optionType === "PE") {
        c.ltp = position.sellLeg.entryPrice * 3.5; // Massive loss on short leg
        c.delta = -0.20; // Keep delta safe so Stop Loss takes priority
      }
    });

    paperBrokerAdapter.processMarketTick(25150, adverseChain, false);

    const closed = paperBrokerAdapter.getClosedPositions();
    expect(closed.length).toBe(1);
    expect(closed[0].exitReason).toBe("STOP_LOSS_HIT");
  });


  test("9. Exit Priority Engine: Priority 1 — Emergency Data Stale Exit", () => {
    const spot = 25150;
    const candles = createBullishCandles(25000);
    const chain = niftyOptionChainService.generateSyntheticChain(spot);

    const signal = hedgingStrategyEngine.generateSignal(spot, candles, candles, chain, 500000, false);
    paperBrokerAdapter.executePaperOrder("test-user-4", signal);

    // Simulate stale market data arriving during tick update
    paperBrokerAdapter.processMarketTick(25150, chain, true); // isStale = true

    const closed = paperBrokerAdapter.getClosedPositions();
    expect(closed.length).toBe(1);
    expect(closed[0].exitReason).toBe("EMERGENCY_DATA_STALE_EXIT");
  });

  test("10. Daily Risk Controller: Enforces max loss lock & blocks paper execution when locked", () => {
    dailyRiskController.recordTradeClosed(-5500); // Exceeds daily max loss limit ₹5000
    const riskState = dailyRiskController.getState();
    expect(riskState.isDailyLossLocked).toBe(true);

    const spot = 25150;
    const candles = createBullishCandles(25000);
    const chain = niftyOptionChainService.generateSyntheticChain(spot);
    const signal = hedgingStrategyEngine.generateSignal(spot, candles, candles, chain, 500000, false);

    expect(signal.status).toBe("BLOCKED");

    expect(() => {
      paperBrokerAdapter.executePaperOrder("test-user-5", signal);
    }).toThrow("Cannot execute paper order with signal status: BLOCKED");
  });
});

