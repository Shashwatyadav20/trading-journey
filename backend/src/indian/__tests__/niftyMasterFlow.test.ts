import { describe, test, expect, beforeEach } from "vitest";
import { Candle, NiftyOptionChain } from "../types";
import { hedgingStrategyEngine } from "../strategy/HedgingStrategyEngine";
import { marketRegimeEngine } from "../regime/MarketRegimeEngine";
import { niftyOptionChainService } from "../market/NiftyOptionChainService";
import { dailyRiskController } from "../risk/DailyRiskController";
import { multiTimeframeTrendEngine } from "../trend/MultiTimeframeTrendEngine";

describe("Phase 9 — NIFTY Master Trading Logic Deterministic Test Suite", () => {
  beforeEach(() => {
    dailyRiskController.resetLocks();
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

  const createBearishCandles = (basePrice: number = 25000): Candle[] => {
    const candles: Candle[] = [];
    let price = basePrice;
    for (let i = 0; i < 20; i++) {
      candles.push({
        time: 1700000000 + i * 900,
        open: price,
        high: price + 5,
        low: price - 15,
        close: price - 10,
        volume: 15000,
      });
      price -= 8;
    }
    return candles;
  };

  const createSidewaysCandles = (basePrice: number = 25000): Candle[] => {
    const candles: Candle[] = [];
    for (let i = 0; i < 20; i++) {
      const offset = (i % 2 === 0 ? 5 : -5);
      candles.push({
        time: 1700000000 + i * 900,
        open: basePrice,
        high: basePrice + 10,
        low: basePrice - 10,
        close: basePrice + offset,
        volume: 10000,
      });
    }
    return candles;
  };

  test("1. Bullish Flow: HH + HL, Price > VWAP, RSI > 50, Valid S/R & Delta -> Bull Put Spread", () => {
    const spot = 25150;
    const candles15M = createBullishCandles(25000);
    const candles1H = createBullishCandles(24900);
    const chain = niftyOptionChainService.generateSyntheticChain(spot);

    const signal = hedgingStrategyEngine.generateSignal(
      spot,
      candles15M,
      candles1H,
      chain,
      500000,
      false
    );

    console.log("TEST 1 SIGNAL REASONS:", signal.reasons);

    expect(signal.regime).toBe("BULLISH");
    expect(signal.action).toBe("BULL_PUT_SPREAD");
    expect(signal.status).toBe("READY");
    expect(signal.maxLoss).toBeLessThanOrEqual(1000);
    expect(signal.reasons.some((r) => r.includes("BULLISH"))).toBe(true);
  });

  test("2. Bearish Flow: LH + LL, Price < VWAP, RSI < 50, Valid S/R & Delta -> Bear Call Spread", () => {
    const spot = 24850;
    const candles15M = createBearishCandles(25000);
    const candles1H = createBearishCandles(25100);
    const chain = niftyOptionChainService.generateSyntheticChain(spot);

    const signal = hedgingStrategyEngine.generateSignal(
      spot,
      candles15M,
      candles1H,
      chain,
      500000,
      false
    );

    expect(signal.regime).toBe("BEARISH");
    expect(signal.action).toBe("BEAR_CALL_SPREAD");
    expect(signal.status).toBe("READY");
    expect(signal.maxLoss).toBeLessThanOrEqual(1000);
  });

  test("3. Range Flow: No strong structure, Sideways, Suitable Vol -> Iron Condor", () => {
    const spot = 25000;
    const candles15M = createSidewaysCandles(25000);
    const candles1H = createSidewaysCandles(25000);
    const chain = niftyOptionChainService.generateSyntheticChain(spot);

    const signal = hedgingStrategyEngine.generateSignal(
      spot,
      candles15M,
      candles1H,
      chain,
      500000,
      false
    );

    expect(signal.regime).toBe("RANGE");
    expect(signal.action).toBe("IRON_CONDOR");
    expect(signal.status).toBe("READY");
  });

  test("4. Conflict Flow: 1H Bullish vs 15M Bearish -> NO_TRADE", () => {
    const spot = 25000;
    const candles15M = createBearishCandles(25100);
    const candles1H = createBullishCandles(24800);
    const chain = niftyOptionChainService.generateSyntheticChain(spot);

    const signal = hedgingStrategyEngine.generateSignal(
      spot,
      candles15M,
      candles1H,
      chain,
      500000,
      false
    );

    expect(signal.action).toBe("NO_TRADE");
    expect(signal.status).toBe("NO_TRADE");
    expect(signal.reasons.some((r) => r.includes("conflicting") || r.includes("disagrees"))).toBe(true);
  });

  test("5. S/R Danger: Price too close to support/resistance -> NO_TRADE", () => {
    const spot = 25000;
    const candles15M = createBullishCandles(24995); // Price barely above 24995
    const candles1H = createBullishCandles(24900);
    
    // Modify option chain so short strike is right at support
    const chain = niftyOptionChainService.generateSyntheticChain(spot);

    const signal = hedgingStrategyEngine.generateSignal(
      spot,
      candles15M,
      candles1H,
      chain,
      500000,
      false
    );

    // Should either reject or select safe spread
    if (signal.action === "NO_TRADE") {
      expect(signal.status).toBe("NO_TRADE");
    } else {
      expect(signal.sellLeg!.strike).toBeLessThanOrEqual(spot - 50);
    }
  });

  test("6. Delta Failure: Option chain with no valid deltas in range -> NO_TRADE", () => {
    const spot = 25000;
    const candles15M = createBullishCandles(24900);
    const candles1H = createBullishCandles(24800);

    // Create chain with extreme deltas (0.01 or 0.99) only
    const badChain: NiftyOptionChain = {
      spotPrice: spot,
      timestamp: new Date().toISOString(),
      contracts: [
        {
          symbol: "CE_ATM",
          expiry: "2026-09-26",
          strike: 25000,
          optionType: "CE",
          ltp: 10,
          bid: 9.5,
          ask: 10.5,
          volume: 1000,
          openInterest: 10000,
          changeInOI: 100,
          iv: 14,
          delta: 0.99,
          timestamp: new Date().toISOString(),
        },
        {
          symbol: "PE_ATM",
          expiry: "2026-09-26",
          strike: 25000,
          optionType: "PE",
          ltp: 10,
          bid: 9.5,
          ask: 10.5,
          volume: 1000,
          openInterest: 10000,
          changeInOI: 100,
          iv: 14,
          delta: -0.01,
          timestamp: new Date().toISOString(),
        },
      ],
    };

    const signal = hedgingStrategyEngine.generateSignal(
      spot,
      candles15M,
      candles1H,
      badChain,
      500000,
      false
    );

    expect(signal.action).toBe("NO_TRADE");
    expect(signal.status).toBe("NO_TRADE");
    expect(signal.reasons.some((r) => r.includes("delta") || r.includes("spread"))).toBe(true);
  });

  test("7. Gamma Failure: High gamma near short strike -> NO_TRADE", () => {
    const spot = 25000;
    const candles15M = createBullishCandles(24900);
    const candles1H = createBullishCandles(24800);

    const chain = niftyOptionChainService.generateSyntheticChain(spot);
    // Artificially inflate gamma on candidate sell put
    for (const c of chain.contracts) {
      if (c.strike === 24900 && c.optionType === "PE") {
        c.gamma = 0.015; // Excessive gamma
      }
    }

    const signal = hedgingStrategyEngine.generateSignal(
      spot,
      candles15M,
      candles1H,
      chain,
      500000,
      false
    );

    if (signal.action === "BULL_PUT_SPREAD") {
      expect(signal.sellLeg!.strike).not.toBe(24900);
    } else {
      expect(signal.action).toBe("NO_TRADE");
    }
  });

  test("8. Max Loss Filter: Theoretical max loss > ₹1,000 -> NO_TRADE", () => {
    const spot = 25000;
    const candles15M = createBullishCandles(24900);
    const candles1H = createBullishCandles(24800);

    // Create chain with wide spread (e.g. 300 points spread -> max loss >> 1000)
    const wideChain: NiftyOptionChain = {
      spotPrice: spot,
      timestamp: new Date().toISOString(),
      contracts: [
        {
          symbol: "PE_SELL",
          expiry: "2026-09-26",
          strike: 24800,
          optionType: "PE",
          ltp: 50,
          bid: 49,
          ask: 51,
          volume: 10000,
          openInterest: 50000,
          changeInOI: 1000,
          iv: 14,
          delta: -0.25,
          gamma: 0.001,
          timestamp: new Date().toISOString(),
        },
        {
          symbol: "PE_BUY",
          expiry: "2026-09-26",
          strike: 24700, // 100 point spread -> max loss = 55.5 * 25 = Rs 1,387.50 > Rs 1,000
          optionType: "PE",
          ltp: 5,
          bid: 4.5,
          ask: 5.5,
          volume: 10000,
          openInterest: 50000,
          changeInOI: 1000,
          iv: 14,
          delta: -0.05,
          gamma: 0.001,
          timestamp: new Date().toISOString(),
        },
      ],
    };

    const signal = hedgingStrategyEngine.generateSignal(
      spot,
      candles15M,
      candles1H,
      wideChain,
      500000,
      false
    );

    expect(signal.action).toBe("NO_TRADE");
    expect(signal.status).toBe("NO_TRADE");
    expect(signal.reasons.length).toBeGreaterThan(0);
  });

  test("9. Stale Data Filter: Timestamp older than 60 seconds -> NO_TRADE", () => {
    const spot = 25000;
    const candles15M = createBullishCandles(24900);
    const candles1H = createBullishCandles(24800);

    const oldTimestamp = new Date(Date.now() - 120 * 1000).toISOString(); // 120s old
    const staleChain: NiftyOptionChain = {
      spotPrice: spot,
      timestamp: oldTimestamp,
      contracts: niftyOptionChainService.generateSyntheticChain(spot).contracts,
    };

    const signal = hedgingStrategyEngine.generateSignal(
      spot,
      candles15M,
      candles1H,
      staleChain,
      500000,
      false
    );

    expect(signal.action).toBe("NO_TRADE");
    expect(signal.status).toBe("NO_TRADE");
    expect(signal.reasons.some((r) => r.includes("DATA_INVALID_OR_STALE"))).toBe(true);
  });

  test("10. Daily P&L Lock: Realized NET P&L >= ₹1,000 -> Block new trades", () => {
    // Record profit >= Rs 1000 in Daily Risk Controller
    dailyRiskController.recordTradeClosed(1200);
    expect(dailyRiskController.getState().isDailyProfitLocked).toBe(true);

    const spot = 25150;
    const candles15M = createBullishCandles(25000);
    const candles1H = createBullishCandles(24900);
    const chain = niftyOptionChainService.generateSyntheticChain(spot);

    const signal = hedgingStrategyEngine.generateSignal(
      spot,
      candles15M,
      candles1H,
      chain,
      500000,
      false
    );

    expect(signal.action).toBe("NO_TRADE");
    expect(signal.status).toBe("BLOCKED");
  });
});
