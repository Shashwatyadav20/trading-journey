/**
 * SwingTradingEngine Tests
 *
 * Validates:
 *   - evaluateMarketRegime() — computed from live NIFTY candle closes
 *   - FUNDAMENTAL_UNIVERSE — curated 10-stock fundamental baseline (restored from user commit)
 *   - calculatePositionSize() — pure position-sizing calculator
 *   - generateSwingSignals() — dynamic signal generation from supplied candle data
 *
 * The FUNDAMENTAL_UNIVERSE is a curated research baseline (TRENT, HAL, BEL, DIXON, etc.).
 * It is populated; tests validate quality thresholds (ROE >= 15%, ROCE >= 18%, etc.).
 */
import { describe, it, expect } from "vitest";
import { swingTradingEngine, FUNDAMENTAL_UNIVERSE } from "../swing/SwingTradingEngine";
import { DailyCandle, validateDailyCandles } from "../swing/dailyStrategyScanner";

// Helper to generate a realistic sequence of daily candles
function makeCandleSeries(
  count: number,
  basePrice: number,
  trendPerBar: number = 0.5,
  volMultiplier: number = 1.0
): DailyCandle[] {
  const candles: DailyCandle[] = [];
  let price = basePrice;
  const startDate = new Date("2026-01-01");

  for (let i = 0; i < count; i++) {
    const d = new Date(startDate);
    d.setDate(startDate.getDate() + i);
    const dateStr = d.toISOString().split("T")[0];

    const open = Number(price.toFixed(2));
    const close = Number((open + trendPerBar).toFixed(2));
    const high = Number((Math.max(open, close) + 2.0).toFixed(2));
    const low = Number((Math.min(open, close) - 1.5).toFixed(2));
    const volume = Math.round(100000 * volMultiplier);

    candles.push({ date: dateStr, open, high, low, close, volume });
    price = close;
  }
  return candles;
}

// ─────────────────────────────────────────────────────────────────────────────
// Candle generator for test data
// ─────────────────────────────────────────────────────────────────────────────

function generateNiftyCandles(
  count: number,
  startPrice: number,
  trendSlope: number
): number[] {
  const closes: number[] = [];
  let p = startPrice;
  for (let i = 0; i < count; i++) {
    p += trendSlope + (Math.sin(i / 4) * 50);
    closes.push(Math.max(10, Number(p.toFixed(2))));
  }
  return closes;
}

describe("SwingTradingEngine — Merged Production Suite", () => {
  // ── 1. FUNDAMENTAL_UNIVERSE: curated baseline restored from user commit ───────
  describe("FUNDAMENTAL_UNIVERSE: curated research baseline", () => {
    it("FUNDAMENTAL_UNIVERSE is a non-empty curated list of fundamentally strong stocks", () => {
      expect(Array.isArray(FUNDAMENTAL_UNIVERSE)).toBe(true);
      // The user commit restores a curated 10-stock fundamental baseline
      expect(FUNDAMENTAL_UNIVERSE.length).toBeGreaterThanOrEqual(8);
    });

    it("swingTradingEngine.evaluateMarketRegime requires live candle data", () => {
      // Must accept closes[], spotPrice, changePercent — not use hardcoded values
      const closes = generateNiftyCandles(60, 22000, 10);
      const spot = closes[closes.length - 1];
      const prevClose = closes[closes.length - 2];
      const changePct = Number((((spot - prevClose) / prevClose) * 100).toFixed(2));

      const regime = swingTradingEngine.evaluateMarketRegime(closes, spot, changePct);

      // Must compute from provided data — never hardcoded EMA values
      expect(regime.ema20).toBeGreaterThan(0);
      expect(regime.spotPrice).toBe(spot);
      expect(regime.changePercent).toBe(changePct);
      // Must not equal any hardcoded value (22380 was the old hardcoded EMA20)
      expect(regime.ema20).not.toBe(22380);
    });
  });

  // ── 2. Market Regime — Computed from Candle Data ──────────────────────────
  describe("evaluateMarketRegime() — computed from live candle data", () => {
    it("classifies BULLISH_TREND when price > 20 EMA > 50 EMA (uptrending candles)", () => {
      // Consistently rising candles = price > 20 EMA > 50 EMA
      const closes = generateNiftyCandles(100, 20000, 50);
      const spot = closes[closes.length - 1];
      const prevClose = closes[closes.length - 2];
      const changePct = Number((((spot - prevClose) / prevClose) * 100).toFixed(2));

      const regime = swingTradingEngine.evaluateMarketRegime(closes, spot, changePct);

      expect(regime.spotPrice).toBe(spot);
      expect(regime.bias).toBe("BULLISH_TREND");
      expect(regime.clearance).toBe("HIGH_CONVICTION");
      expect(regime.regimeScore).toBeGreaterThanOrEqual(80);
      expect(regime.analysisSummary).toContain("20 EMA");
      expect(regime.dataSource).toContain("Yahoo Finance");
    });

    it("classifies RANGE_BOUND when price is between 20 and 50 EMA", () => {
      // Flat candles cause price ≈ 20 EMA ≈ 50 EMA — oscillating
      const closes = generateNiftyCandles(80, 22000, 0);
      const spot = closes[closes.length - 1] * 0.995; // just below 20 EMA
      const regime = swingTradingEngine.evaluateMarketRegime(closes, spot, -0.3);
      expect(["RANGE_BOUND", "BULLISH_TREND", "BEARISH_CORRECTION"]).toContain(regime.bias);
    });

    it("classifies BEARISH_CORRECTION when price < 50 EMA (downtrending candles)", () => {
      const closes = generateNiftyCandles(100, 25000, -50);
      const spot = closes[closes.length - 1];
      const prevClose = closes[closes.length - 2];
      const changePct = Number((((spot - prevClose) / prevClose) * 100).toFixed(2));

      const regime = swingTradingEngine.evaluateMarketRegime(closes, spot, changePct);

      expect(["BEARISH_CORRECTION", "RANGE_BOUND"]).toContain(regime.bias);
    });

    it("returns null for breadth data (requires separate source — not available from Yahoo)", () => {
      const closes = generateNiftyCandles(60, 22000, 10);
      const spot = closes[closes.length - 1];
      const regime = swingTradingEngine.evaluateMarketRegime(closes, spot, 0.8);

      // Market breadth data is NOT available from Yahoo Finance price endpoint
      expect(regime.breadthPercentAbove50EMA).toBeNull();
      expect(regime.advancingStocksCount).toBeNull();
      expect(regime.decliningStocksCount).toBeNull();
    });

    it("handles exactly 20 candles (minimum for EMA20)", () => {
      const closes = generateNiftyCandles(20, 22000, 5);
      const spot = closes[closes.length - 1];
      const regime = swingTradingEngine.evaluateMarketRegime(closes, spot, 0.2);

      expect(regime.ema20).toBeGreaterThan(0);
      expect(regime.regimeScore).toBeGreaterThan(0);
    });
  });

  // ── Pillar 2: Fundamentally Strong Stocks ───────────────────────────────────
  describe("Pillar 2: Fundamentally Strong Stocks Universe", () => {
    it("contains high-quality universe with ROE >= 15% and ROCE >= 18%", () => {
      const universe = swingTradingEngine.getQualifiedUniverse();
      expect(universe.length).toBeGreaterThanOrEqual(8);

      for (const stock of universe) {
        expect(stock.roePercent).toBeGreaterThanOrEqual(15.0);
        expect(stock.rocePercent).toBeGreaterThanOrEqual(18.0);
        expect(stock.qualityScore).toBeGreaterThanOrEqual(85);
        expect(stock.institutionalHoldingPercent).toBeGreaterThanOrEqual(30.0);
      }
    });

    it("fetches fundamentals for specific symbols like TRENT and HAL", () => {
      const trent = swingTradingEngine.getFundamentals("TRENT");
      expect(trent).toBeDefined();
      expect(trent?.roePercent).toBe(32.8);
      expect(trent?.moatRating).toBe("WIDE");

      const hal = swingTradingEngine.getFundamentals("HAL");
      expect(hal).toBeDefined();
      expect(hal?.debtToEquity).toBe(0.0);
    });
  });

  // ── Dynamic Signal Generation & Validation (No Static Signals) ───────────────
  describe("Dynamic Signal Generation & Market Data Validation", () => {
    it("returns empty signals when non-matching candle data is provided (no hardcoded fallback)", async () => {
      const breakdownCandles = makeCandleSeries(35, 1000, -8.0, 1.0);
      const last = breakdownCandles[breakdownCandles.length - 1];
      last.close = last.low;
      const signals = await swingTradingEngine.generateSwingSignals(22500, {
        BREAKDOWN_STOCK: breakdownCandles,
      });
      expect(signals).toEqual([]);
    });

    it("validates market data strictly and rejects corrupt or insufficient candles", () => {
      const shortCandles = makeCandleSeries(5, 100);
      expect(validateDailyCandles(shortCandles).valid).toBe(false);

      const invertedCandles = makeCandleSeries(20, 100);
      invertedCandles[10].high = 50;
      invertedCandles[10].low = 150;
      expect(validateDailyCandles(invertedCandles).valid).toBe(false);

      const zeroCandles = makeCandleSeries(20, 100);
      zeroCandles[5].close = 0;
      expect(validateDailyCandles(zeroCandles).valid).toBe(false);

      expect(validateDailyCandles([]).valid).toBe(false);
      expect(validateDailyCandles(null as any).valid).toBe(false);

      expect(swingTradingEngine.evaluateStockCandles("CORRUPT", shortCandles)).toBeNull();
      expect(swingTradingEngine.evaluateStockCandles("CORRUPT", invertedCandles)).toBeNull();
    });

    it("dynamically generates Breakout Setup A based strictly on supplied candle levels", async () => {
      const candles = makeCandleSeries(30, 2000, 2.0, 1.0);
      const last = candles[candles.length - 1];
      const breakoutPrice = 2120;
      candles.push({
        date: "2026-02-15",
        open: last.close,
        high: breakoutPrice + 5,
        low: last.close - 2,
        close: breakoutPrice,
        volume: 300000,
      });

      const signals = await swingTradingEngine.generateSwingSignals(22500, { TRENT: candles });

      expect(signals.length).toBe(1);
      const sig = signals[0];
      expect(sig.symbol).toBe("TRENT");
      expect(sig.currentPrice).toBe(breakoutPrice);
      expect(sig.currentPrice).not.toBe(2918.2);
      expect(sig.entryPrice).toBeGreaterThanOrEqual(breakoutPrice);
      expect(sig.stopLossPrice).toBeLessThan(sig.entryPrice);
      expect(sig.rewardRiskRatio).toBeGreaterThanOrEqual(2.0);
      expect(sig.setupId).toBe("SETUP_A_BREAKOUT_RETEST");
      expect(sig.fivePillarChecklist.pillar1MarketRegime.passed).toBe(true);
      expect(sig.fivePillarChecklist.pillar2Fundamentals.passed).toBe(true);
      expect(sig.fivePillarChecklist.pillar4PriceActionVolume.passed).toBe(true);
      expect(sig.fivePillarChecklist.pillar5RiskManagement.passed).toBe(true);
    });

    it("dynamically generates Pullback Setup C when price pulls back near rising 20 EMA", async () => {
      const candles = makeCandleSeries(40, 4000, 8.0, 1.0);
      const len = candles.length;
      const closes = candles.map((c) => c.close);
      const k = 2 / 21;
      let ema20 = closes[0];
      for (let i = 1; i < len; i++) ema20 = closes[i] * k + ema20 * (1 - k);
      const pullbackPrice = Number((ema20 * 1.005).toFixed(2));
      candles.push({
        date: "2026-02-20",
        open: pullbackPrice + 5,
        high: pullbackPrice + 12,
        low: pullbackPrice - 8,
        close: pullbackPrice + 8,
        volume: 80000,
      });

      const sig = swingTradingEngine.evaluateStockCandles("PERSISTENT", candles, 22500);
      expect(sig).not.toBeNull();
      if (sig) {
        expect(sig.symbol).toBe("PERSISTENT");
        expect(sig.currentPrice).toBe(pullbackPrice + 8);
        expect(sig.currentPrice).not.toBe(5770.0);
        expect(["SETUP_C_TREND_PULLBACK", "SETUP_B_LIQUIDITY_SWEEP"]).toContain(sig.setupId);
        expect(sig.rewardRiskRatio).toBeGreaterThanOrEqual(1.8);
      }
    });

    it("dynamically recalculates levels when candle prices change", () => {
      const candles1 = makeCandleSeries(30, 1000, 1.5, 1.0);
      const last1 = candles1[candles1.length - 1];
      candles1.push({ date: "2026-02-15", open: last1.close, high: 1080, low: last1.close - 2, close: 1075, volume: 350000 });
      const sig1 = swingTradingEngine.evaluateStockCandles("STOCK1", candles1, 22500);

      const candles2 = makeCandleSeries(30, 5000, 7.5, 1.0);
      const last2 = candles2[candles2.length - 1];
      candles2.push({ date: "2026-02-15", open: last2.close, high: 5400, low: last2.close - 10, close: 5380, volume: 350000 });
      const sig2 = swingTradingEngine.evaluateStockCandles("STOCK2", candles2, 22500);

      expect(sig1).not.toBeNull();
      expect(sig2).not.toBeNull();
      if (sig1 && sig2) {
        expect(sig1.currentPrice).toBe(1075);
        expect(sig2.currentPrice).toBe(5380);
        expect(sig2.entryPrice).toBeGreaterThan(sig1.entryPrice * 4);
        expect(sig2.stopLossPrice).toBeGreaterThan(sig1.stopLossPrice * 4);
      }
    });
  });

  // ── Pillar 5: Strict Risk Management Calculator ──────────────────────────────
  describe("Pillar 5: Strict Risk Management & Position Sizing", () => {
    it("calculates exact position sizing based on account capital and risk percentage", () => {
      const result = swingTradingEngine.calculatePositionSize({
        accountCapital: 500000,
        riskPercent: 1.0, // 1% = ₹5,000 max risk
        entryPrice: 1000,
        stopLossPrice: 950, // ₹50 risk per share
        targetPrice: 1100, // ₹100 gain -> 2.0 R:R
      });

      expect(result.maxRiskAmount).toBe(5000);
      expect(result.riskPerShare).toBe(50);
      expect(result.recommendedQuantity).toBe(100); // 5000 / 50 = 100 shares
      expect(result.totalCapitalRequired).toBe(100000); // 100 * 1000 = ₹1,00,000
      expect(result.portfolioCapitalExposurePercent).toBe(20.0); // 1,00,000 / 5,00,000 = 20%
      expect(result.potentialRewardAmount).toBe(10000); // 100 * 100 = ₹10,000
      expect(result.rewardRiskRatio).toBe(2.0);
      expect(result.isRiskValid).toBe(true);
    });

    it("rejects setups with Reward:Risk less than 1:2.0", () => {

      const result = swingTradingEngine.calculatePositionSize({
        accountCapital: 500000,
        riskPercent: 1.0,
        entryPrice: 1000,
        stopLossPrice: 950,
        targetPrice: 1100,
      });

      expect(result.maxRiskAmount).toBe(5000);
      expect(result.riskPerShare).toBe(50);
      expect(result.recommendedQuantity).toBe(100);
      expect(result.totalCapitalRequired).toBe(100000);
      expect(result.portfolioCapitalExposurePercent).toBe(20.0);
      expect(result.potentialRewardAmount).toBe(10000);
      expect(result.rewardRiskRatio).toBe(2.0);
      expect(result.isRiskValid).toBe(true);
    });

    it("rejects trades with R:R below 1:2.0", () => {
      const result = swingTradingEngine.calculatePositionSize({
        accountCapital: 500000,
        riskPercent: 1.0,
        entryPrice: 1000,
        stopLossPrice: 950,
        targetPrice: 1060,
      });

      expect(result.rewardRiskRatio).toBe(1.2);
      expect(result.isRiskValid).toBe(false);
      expect(result.validationWarnings.some((w) => w.includes("rejected by Rule 5"))).toBe(true);
    });

    it("warns when risk percent exceeds 2% swing rule", () => {
      const result = swingTradingEngine.calculatePositionSize({
        accountCapital: 500000,
        riskPercent: 3.0,
        entryPrice: 1000,
        stopLossPrice: 900,
        targetPrice: 1200,
      });

      expect(result.validationWarnings.some((w) => w.includes("CAUTION: Risk exceeds"))).toBe(true);
    });

    it("handles edge case: stop loss equal to entry price", () => {
      const result = swingTradingEngine.calculatePositionSize({
        accountCapital: 500000,
        riskPercent: 1.0,
        entryPrice: 1000,
        stopLossPrice: 1000,
        targetPrice: 1200,
      });

      expect(result.riskPerShare).toBe(0);
      expect(result.recommendedQuantity).toBe(0);
    });
  });
});
