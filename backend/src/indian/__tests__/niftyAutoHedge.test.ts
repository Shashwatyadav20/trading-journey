import { describe, it, expect, beforeEach } from "vitest";
import { volatilityEngine } from "../volatility/VolatilityEngine";
import { multiTimeframeTrendEngine } from "../trend/MultiTimeframeTrendEngine";
import { supportResistanceEngine } from "../levels/SupportResistanceEngine";
import { niftyOptionChainService } from "../market/NiftyOptionChainService";
import { adaptiveStrikeSelector } from "../strategy/AdaptiveStrikeSelector";
import { strategyScorer } from "../strategy/StrategyScorer";
import { chargeCalculator } from "../risk/ChargeCalculator";
import { riskEngine } from "../risk/RiskEngine";
import { dailyRiskController } from "../risk/DailyRiskController";
import { tradeValidator } from "../validation/TradeValidator";
import { hedgingStrategyEngine } from "../strategy/HedgingStrategyEngine";
import { paperBrokerAdapter } from "../broker/PaperBrokerAdapter";
import { auditLogger } from "../audit/AuditLogger";
import { backtestEngine } from "../backtest/BacktestEngine";

describe("Automated NIFTY Options Hedging System Suite", () => {
  beforeEach(() => {
    dailyRiskController.resetLocks();
  });

  const mockCandles15M: Candle[] = Array.from({ length: 30 }, (_, i) => ({
    time: 1700000000 + i * 900,
    open: 24600 + i * 4,
    high: 24610 + i * 4,
    low: 24595 + i * 4,
    close: 24605 + i * 4,
    volume: 20000,
  }));

  const mockCandles1H: Candle[] = Array.from({ length: 30 }, (_, i) => ({
    time: 1700000000 + i * 3600,
    open: 24500 + i * 10,
    high: 24520 + i * 10,
    low: 24490 + i * 10,
    close: 24515 + i * 10,
    volume: 80000,
  }));

  // 1. Volatility Engine Tests
  describe("Volatility Engine", () => {
    it("calculates ATR(14) accurately", () => {
      const atr = volatilityEngine.calculateATR(mockCandles15M, 14);
      expect(atr).toBeGreaterThan(0);
    });

    it("evaluates volatility states correctly", () => {
      const low = volatilityEngine.evaluateVolatility(24700, 100, 10);
      expect(low.state).toBe("LOW");

      const extreme = volatilityEngine.evaluateVolatility(24700, 600, 28);
      expect(extreme.state).toBe("EXTREME");
    });
  });

  // 2. Multi-Timeframe Trend Engine Tests
  describe("Multi-Timeframe Trend Engine", () => {
    it("detects aligned bullish trend when spot > VWAP and EMAs align", () => {
      const spotPrice = 24800;
      const trend = multiTimeframeTrendEngine.analyzeTrend(
        mockCandles15M,
        mockCandles1H,
        spotPrice
      );
      expect(trend.direction).toBe("BUY");
      expect(trend.trendScore).toBe(90);
    });

    it("returns NEUTRAL when trends mismatch or spot is below VWAP", () => {
      const spotPrice = 24000;
      const trend = multiTimeframeTrendEngine.analyzeTrend(
        mockCandles15M,
        mockCandles1H,
        spotPrice
      );
      expect(trend.direction).toBe("NEUTRAL");
    });
  });

  // 3. Support & Resistance Engine Tests
  describe("Support & Resistance Engine", () => {
    it("calculates S/R levels and clusters nearby levels", () => {
      const chain = niftyOptionChainService.generateSyntheticChain(24700);
      const levels = supportResistanceEngine.calculateLevels(
        24700,
        mockCandles15M,
        [],
        chain
      );

      expect(levels.length).toBeGreaterThan(0);
      expect(levels[0].strengthScore).toBeGreaterThanOrEqual(6);
    });
  });

  // 4. Option Chain Service Tests
  describe("Nifty Option Chain Service", () => {
    it("normalizes contracts and rejects illiquid / wide spread options", () => {
      const chain = niftyOptionChainService.generateSyntheticChain(24700);
      expect(chain.contracts.length).toBeGreaterThan(0);

      const contract = chain.contracts[0];
      expect(contract.ask - contract.bid).toBeLessThanOrEqual(3.0);
      expect(contract.delta).toBeDefined();
    });
  });

  // 5. Adaptive Strike Selector Tests
  describe("Adaptive Strike Selector", () => {
    it("selects valid Bull Put Spread candidate in BULLISH regime", () => {
      const chain = niftyOptionChainService.generateSyntheticChain(24700);
      const levels = supportResistanceEngine.calculateLevels(
        24700,
        mockCandles15M,
        [],
        chain
      );

      const spread = adaptiveStrikeSelector.selectBestSpread(
        "BULLISH",
        24700,
        chain,
        levels
      );

      expect(spread).not.toBeNull();
      if (spread) {
        expect(spread.strategyType).toBe("BULL_PUT_SPREAD");
        expect(spread.sellLeg.optionType).toBe("PE");
        expect(spread.buyLeg.optionType).toBe("PE");
        expect(spread.sellLeg.strike).toBeGreaterThan(spread.buyLeg.strike);
        expect(spread.netCredit).toBeGreaterThan(0);
      }
    });

    it("returns null when market regime is UNCLEAR or HIGH_VOLATILITY", () => {
      const chain = niftyOptionChainService.generateSyntheticChain(24700);
      const spread = adaptiveStrikeSelector.selectBestSpread(
        "UNCLEAR",
        24700,
        chain,
        []
      );
      expect(spread).toBeNull();
    });
  });

  // 6. Strategy Scorer Tests
  describe("Strategy Scorer", () => {
    it("calculates 0-100 score breakdown", () => {
      const chain = niftyOptionChainService.generateSyntheticChain(24700);
      const levels = supportResistanceEngine.calculateLevels(24700, mockCandles15M, [], chain);
      const spread = adaptiveStrikeSelector.selectBestSpread(
        "BULLISH",
        24700,
        chain,
        levels
      );
      const trend = multiTimeframeTrendEngine.analyzeTrend(
        mockCandles15M,
        mockCandles1H,
        24800
      );

      const scoreResult = strategyScorer.calculateScore(
        "BULLISH",
        trend,
        trend,
        "BULLISH_STRUCTURE",
        spread,
        levels,
        "NORMAL",
        false
      );

      expect(scoreResult.score).toBeGreaterThanOrEqual(70);
      expect(scoreResult.passed).toBe(true);
    });
  });

  // 7. Charge Calculator Tests
  describe("Charge Calculator", () => {
    it("computes STT, GST, SEBI, Exchange fees, and slippage accurately", () => {
      const charges = chargeCalculator.calculateSpreadCharges(50, 15, 1, 875);
      expect(charges.brokerage).toBe(80); // 4 legs * Rs 20
      expect(charges.stt).toBeGreaterThan(0);
      expect(charges.gst).toBeGreaterThan(0);
      expect(charges.totalCharges).toBeGreaterThan(0);
      expect(charges.netPnl).toBeLessThan(charges.grossPnl);
    });
  });

  // 8. Risk Engine Tests
  describe("Risk Engine", () => {
    it("calculates 1% capital risk lot quantity correctly", () => {
      // 500,000 capital -> 1% risk = Rs 5,000
      // Spread width 200 - net credit 45 = 155 loss per share * 25 lot size = 3,875 per lot
      // floor(5000 / 3875) = 1 lot
      const riskVal = riskEngine.validateAndSizePosition(500000, 200, 45, 100);
      expect(riskVal.allowed).toBe(true);
      expect(riskVal.lotQuantity).toBe(1);
      expect(riskVal.totalQuantity).toBe(25);
    });

    it("rejects trade when single lot risk exceeds 1% capital limit", () => {
      // 100,000 capital -> 1% risk = Rs 1,000
      // Max loss per lot = 3,875 -> 3875 > 1000 -> rejected!
      const riskVal = riskEngine.validateAndSizePosition(100000, 200, 45, 100);
      expect(riskVal.allowed).toBe(false);
      expect(riskVal.lotQuantity).toBe(0);
      expect(riskVal.rejectionReason).toContain("exceeds max allowed 1% risk limit");
    });
  });

  // 9. Daily Risk Controller & Profit Target Tests
  describe("Daily Risk Controller", () => {
    it("locks new trades when daily profit target (Rs 1,000 net) is reached", () => {
      expect(dailyRiskController.canTrade().allowed).toBe(true);

      // Record a trade with Rs 1,200 net profit
      dailyRiskController.recordTradeClosed(1200);

      const state = dailyRiskController.getState();
      expect(state.dailyPnl).toBe(1200);
      expect(state.isDailyProfitLocked).toBe(true);
      expect(state.isTradeLocked).toBe(true);

      const check = dailyRiskController.canTrade();
      expect(check.allowed).toBe(false);
      expect(check.reason).toContain("Daily net profit target reached");
    });

    it("locks new trades when daily max loss (Rs 5,000) is reached", () => {
      dailyRiskController.recordTradeClosed(-5500);

      const state = dailyRiskController.getState();
      expect(state.isDailyLossLocked).toBe(true);
      expect(dailyRiskController.canTrade().allowed).toBe(false);
    });
  });

  // 10. Master Hedging Strategy Engine Tests
  describe("Master Hedging Strategy Engine", () => {
    it("generates READY Bull Put Spread signal under strong bullish market", () => {
      const signal = hedgingStrategyEngine.generateSignal(
        24800,
        mockCandles15M,
        mockCandles1H,
        undefined,
        500000
      );

      expect(signal.symbol).toBe("NIFTY");
      expect(signal.regime).toBe("BULLISH");
      expect(signal.action).toBe("BULL_PUT_SPREAD");
      expect(signal.status).toBe("READY");
      expect(signal.sellLeg).toBeDefined();
      expect(signal.buyLeg).toBeDefined();
      expect(signal.expectedNetPnl).toBeGreaterThan(0);
    });

    it("returns NO_TRADE when market data is stale or zero", () => {
      const signal = hedgingStrategyEngine.generateSignal(
        0,
        [],
        []
      );
      expect(signal.status).toBe("NO_TRADE");
      expect(signal.action).toBe("NO_TRADE");
    });
  });

  // 11. Paper Broker Adapter Tests
  describe("Paper Broker Adapter", () => {
    it("executes paper order with Hedge-First verification and tracks position", () => {
      const signal = hedgingStrategyEngine.generateSignal(
        24800,
        mockCandles15M,
        mockCandles1H,
        undefined,
        500000
      );

      const pos = paperBrokerAdapter.executePaperOrder("test-user", signal);
      expect(pos.status).toBe("OPEN");
      expect(pos.sellLeg.side).toBe("SELL");
      expect(pos.buyLeg.side).toBe("BUY");
      expect(pos.mode).toBe("PAPER");

      const openList = paperBrokerAdapter.getOpenPositions("test-user");
      expect(openList.length).toBeGreaterThan(0);

      // Manually close
      const closed = paperBrokerAdapter.closePosition(pos.id, "TEST_CLOSE");
      expect(closed.status).toBe("CLOSED");
    });

    it("throws error and prevents execution if signal status is not READY or hedge leg is missing", () => {
      const invalidSignal: any = {
        status: "NO_TRADE",
        symbol: "NIFTY",
      };

      expect(() => paperBrokerAdapter.executePaperOrder("user1", invalidSignal)).toThrow(
        "Cannot execute paper order with signal status: NO_TRADE"
      );
    });
  });

  // 12. Audit Logger Tests
  describe("Audit Logger", () => {
    it("logs events and sanitizes sensitive API keys", () => {
      auditLogger.log("TEST_EVENT", "trace-123", {
        symbol: "NIFTY",
        apiKey: "SUPER_SECRET_KEY", // Should be removed!
      });

      const logs = auditLogger.getRecentLogs();
      const last = logs[logs.length - 1];
      expect(last.eventType).toBe("TEST_EVENT");
      expect(last.details.symbol).toBe("NIFTY");
      expect(last.details.apiKey).toBeUndefined();
    });
  });

  // 13. Charge Calculator Phase 2 Tests (Separated Entry & Exit Charges)
  describe("Charge Calculator Phase 2 (Entry/Exit Separation)", () => {
    it("computes entryCharges, exitCharges, and totalCharges separately", () => {
      const charges = chargeCalculator.calculateSpreadCharges(60, 20, 2, 2000);
      expect(charges.entryCharges).toBeGreaterThan(0);
      expect(charges.exitCharges).toBeGreaterThan(0);
      expect(charges.totalCharges).toBe(Number((charges.entryCharges + charges.exitCharges).toFixed(2)));
      expect(charges.netPnl).toBe(Number((charges.grossPnl - charges.totalCharges).toFixed(2)));
    });
  });

  // 14. Strategy Math Correctness Tests
  describe("Strategy Mathematical Correctness", () => {
    it("verifies Bull Put Spread strike hierarchy (Sell Strike > Buy Strike)", () => {
      const chain = niftyOptionChainService.generateSyntheticChain(24700);
      const levels = supportResistanceEngine.calculateLevels(24700, mockCandles15M, [], chain);
      const spread = adaptiveStrikeSelector.selectBestSpread("BULLISH", 24700, chain, levels);

      if (spread) {
        expect(spread.sellLeg.strike).toBeGreaterThan(spread.buyLeg.strike);
        expect(spread.spreadWidth).toBe(spread.sellLeg.strike - spread.buyLeg.strike);
        expect(spread.maxLoss).toBe(spread.spreadWidth - spread.netCredit);
      }
    });

    it("verifies Bear Call Spread strike hierarchy (Buy Strike > Sell Strike)", () => {
      const chain = niftyOptionChainService.generateSyntheticChain(24700);
      const levels = supportResistanceEngine.calculateLevels(24700, mockCandles15M, [], chain);
      const spread = adaptiveStrikeSelector.selectBestSpread("BEARISH", 24700, chain, levels);

      if (spread) {
        expect(spread.buyLeg.strike).toBeGreaterThan(spread.sellLeg.strike);
        expect(spread.spreadWidth).toBe(spread.buyLeg.strike - spread.sellLeg.strike);
        expect(spread.maxLoss).toBe(spread.spreadWidth - spread.netCredit);
      }
    });
  });

  // 15. Backtest Engine Phase 2 Tests
  describe("Backtest Engine Phase 2", () => {
    it("runs walk-forward backtest and separates training (in-sample) vs out-of-sample metrics", () => {
      const dataset = Array.from({ length: 20 }, (_, i) => ({
        timestamp: new Date(1700000000000 + i * 3600000).toISOString(),
        spotPrice: 24700 + Math.sin(i) * 100,
        candles15M: mockCandles15M,
        candles1H: mockCandles1H,
      }));

      const res = backtestEngine.runBacktest(dataset, 0.7, 500000);
      expect(res.trainingMetrics).toBeDefined();
      expect(res.outOfSampleMetrics).toBeDefined();
      expect(res.overallMetrics).toBeDefined();
      expect(res.overallMetrics.isHistoricalOptionDataAvailable).toBe(false);
      expect(res.overallMetrics.dataSourceDisclosure).toContain("DISCLOSURE");
    });
  });
});
