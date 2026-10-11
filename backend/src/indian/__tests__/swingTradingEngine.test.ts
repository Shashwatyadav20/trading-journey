import { describe, it, expect } from "vitest";
import { swingTradingEngine, FUNDAMENTAL_UNIVERSE } from "../swing/SwingTradingEngine";

describe("5-Pillar Swing Trading Engine Suite", () => {
  // ── Pillar 1: Market Regime ──────────────────────────────────────────────────
  describe("Pillar 1: Market Regime (NIFTY Trend & Range)", () => {
    it("classifies bullish trend when price > 20 EMA > 50 EMA", () => {
      const regime = swingTradingEngine.evaluateMarketRegime(24700.45);
      expect(regime.bias).toBe("BULLISH_TREND");
      expect(regime.clearance).toBe("HIGH_CONVICTION");
      expect(regime.regimeScore).toBeGreaterThanOrEqual(80);
      expect(regime.analysisSummary).toContain("20 EMA");
    });

    it("classifies range-bound regime when price is between 50 EMA and 20 EMA", () => {
      const regime = swingTradingEngine.evaluateMarketRegime(24450.0);
      expect(regime.bias).toBe("RANGE_BOUND");
      expect(regime.clearance).toBe("SELECTIVE_OPPORTUNITIES");
    });

    it("classifies defensive regime when price is below 50 EMA", () => {
      const regime = swingTradingEngine.evaluateMarketRegime(24100.0);
      expect(regime.bias).toBe("BEARISH_CORRECTION");
      expect(regime.clearance).toBe("DEFENSIVE_CASH");
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

  // ── Pillar 3 & 4: Setups A, B, C, D ─────────────────────────────────────────
  describe("Pillars 3 & 4: Price Action, Liquidity & Setups", () => {
    const signals = swingTradingEngine.generateSwingSignals(24700.45);

    it("generates active signals with 5-pillar checklist verification", () => {
      expect(signals.length).toBeGreaterThan(0);
      for (const sig of signals) {
        expect(sig.fivePillarChecklist.pillar1MarketRegime.passed).toBe(true);
        expect(sig.fivePillarChecklist.pillar2Fundamentals.passed).toBe(true);
        expect(sig.fivePillarChecklist.pillar3LiquidityLevels.passed).toBe(true);
        expect(sig.fivePillarChecklist.pillar4PriceActionVolume.passed).toBe(true);
        expect(sig.fivePillarChecklist.pillar5RiskManagement.passed).toBe(true);
        expect(sig.rewardRiskRatio).toBeGreaterThanOrEqual(2.0);
      }
    });

    it("verifies Setup A (Breakout + Retest) criteria", () => {
      const setupA = signals.find((s) => s.setupId === "SETUP_A_BREAKOUT_RETEST");
      expect(setupA).toBeDefined();
      expect(setupA?.volumeMultiplier).toBeGreaterThanOrEqual(1.5);
      expect(setupA?.retestLow).toBeDefined();
      expect(setupA?.stopLossPrice).toBeLessThan(setupA!.entryPrice);
      expect(setupA?.rejectionCandle).toBeDefined();
    });

    it("verifies Setup B (Liquidity Sweep + Reversal) criteria", () => {
      const setupB = signals.find((s) => s.setupId === "SETUP_B_LIQUIDITY_SWEEP");
      expect(setupB).toBeDefined();
      expect(setupB?.sweepLow).toBeDefined();
      expect(setupB?.stopLossPrice).toBeLessThanOrEqual(setupB!.sweepLow!);
      expect(setupB?.tradeRationale.some((r) => r.includes("CHoCH") || r.includes("liquidity"))).toBe(true);
    });

    it("verifies Setup C (Pullback in Strong Trend) criteria", () => {
      const setupC = signals.find((s) => s.setupId === "SETUP_C_TREND_PULLBACK");
      expect(setupC).toBeDefined();
      expect(setupC?.currentPrice).toBeGreaterThan(setupC!.ema20);
      expect(setupC?.stopLossPrice).toBeLessThan(setupC!.entryPrice);
    });

    it("verifies Setup D (Base Breakout) criteria and extension check", () => {
      const setupD = signals.find((s) => s.setupId === "SETUP_D_BASE_BREAKOUT" && s.status === "ACTIVE_OPPORTUNITY");
      expect(setupD).toBeDefined();
      expect(setupD?.baseLengthWeeks).toBeGreaterThanOrEqual(4);
      expect(setupD?.extensionFromPivotPercent).toBeLessThanOrEqual(7.0); // Strict rule: avoid chasing if > 5-7% extended
      expect(setupD?.volumeMultiplier).toBeGreaterThanOrEqual(1.5);
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
        stopLossPrice: 950, // ₹50 risk
        targetPrice: 1060, // ₹60 gain -> 1.2 R:R (Violates 1:2 rule)
      });

      expect(result.rewardRiskRatio).toBe(1.2);
      expect(result.isRiskValid).toBe(false);
      expect(result.validationWarnings.some((w) => w.includes("rejected by Rule 5"))).toBe(true);
    });

    it("warns when risk percent exceeds strict swing rule (> 2%)", () => {
      const result = swingTradingEngine.calculatePositionSize({
        accountCapital: 500000,
        riskPercent: 3.0,
        entryPrice: 1000,
        stopLossPrice: 900,
        targetPrice: 1200,
      });

      expect(result.validationWarnings.some((w) => w.includes("CAUTION: Risk exceeds"))).toBe(true);
    });
  });
});
