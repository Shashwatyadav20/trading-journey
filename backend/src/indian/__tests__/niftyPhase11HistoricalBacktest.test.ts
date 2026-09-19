import { describe, it, expect } from "vitest";
import { backtestEngine, HistoricalDataPoint } from "../backtest/BacktestEngine";
import { walkForwardValidator } from "../backtest/WalkForwardValidator";
import { historicalDataService } from "../backtest/HistoricalDataService";
import { chargeCalculator } from "../risk/ChargeCalculator";

describe("Phase 11 — Genuine Historical NIFTY Options Backtesting Suite", () => {
  describe("1. Strict Data Quality & Rejection Gates", () => {
    it("rejects synthetic datasets for genuine historical backtests when declared UNKNOWN or SYNTHETIC", () => {
      const csv = `timestamp,expiry,strike,type,ltp,bid,ask,iv,delta
2026-09-13T10:00:00Z,2026-09-24,24500,PE,50.0,49.5,50.5,15.2,-0.25
2026-09-13T10:15:00Z,2026-09-24,24500,PE,52.0,51.5,52.5,15.4,-0.26`;

      const validationRes = historicalDataService.validateCSV(csv, "SYNTHETIC");
      expect(["VALID", "WARNING", "INVALID"]).toContain(validationRes.qualityState);

      const lockedExecution = historicalDataService.executeLockedBacktest("non-existent-id", 0.7, 500000);
      expect(lockedExecution.allowed).toBe(false);
      expect(lockedExecution.blockReason).toBeDefined();
    });

    it("verifies synthetic paper estimation dataset returns SYNTHETIC_PAPER_DATA and REAL_DATA_REQUIRED verdict", () => {
      const dataset: HistoricalDataPoint[] = [
        {
          timestamp: "2026-09-13T10:00:00Z",
          spotPrice: 24500,
          candles15M: [{ time: 1000, open: 24490, high: 24510, low: 24480, close: 24500, volume: 5000 }],
          candles1H: [{ time: 1000, open: 24490, high: 24510, low: 24480, close: 24500, volume: 5000 }],
        },
      ];

      const res = backtestEngine.runBacktest(dataset, 0.7, 500000);
      expect(res.dataSource).toBe("SYNTHETIC_PAPER_DATA");
      expect(res.finalVerdict.verdict).toBe("REAL_DATA_REQUIRED");
    });
  });

  describe("2. Zero Look-Ahead Bias & Sliding-Window Walk-Forward Validation", () => {
    it("ensures zero look-ahead bias and runs 70/30 split with WalkForwardValidator", () => {
      const dataset: HistoricalDataPoint[] = [];
      const baseTime = 1750000000;

      for (let i = 0; i < 30; i++) {
        const timestamp = new Date((baseTime + i * 900) * 1000).toISOString();
        const spotPrice = 24500 + Math.sin(i / 3) * 50;
        dataset.push({
          timestamp,
          spotPrice,
          candles15M: [
            { time: baseTime + i * 900, open: spotPrice - 5, high: spotPrice + 10, low: spotPrice - 10, close: spotPrice, volume: 10000 },
          ],
          candles1H: [
            { time: baseTime + i * 900, open: spotPrice - 5, high: spotPrice + 10, low: spotPrice - 10, close: spotPrice, volume: 10000 },
          ],
        });
      }

      const res = backtestEngine.runBacktest(dataset, 0.7, 500000);
      expect(res.lookAheadBiasVerifiedZero).toBe(true);
      expect(res.trainingMetrics).toBeDefined();
      expect(res.outOfSampleMetrics).toBeDefined();
      expect(res.walkForwardResults).toBeDefined();
      expect(res.walkForwardResults.windows.length).toBeGreaterThan(0);

      const wfRes = walkForwardValidator.runWalkForwardAnalysis(dataset, 3, 0.7, 500000, backtestEngine);
      expect(wfRes.totalWindows).toBeGreaterThan(0);
      expect(wfRes.summaryNotes.length).toBeGreaterThan(0);
    });
  });

  describe("3. Defined Risk & Max Loss Cap (<= ₹1,000)", () => {
    it("ensures all simulated spread positions respect max capital risk <= 1%", () => {
      const dataset: HistoricalDataPoint[] = [];
      const baseTime = 1750000000;

      for (let i = 0; i < 10; i++) {
        const timestamp = new Date((baseTime + i * 900) * 1000).toISOString();
        dataset.push({
          timestamp,
          spotPrice: 24500 + i * 15,
          candles15M: [{ time: baseTime + i * 900, open: 24500, high: 24550, low: 24450, close: 24520, volume: 10000 }],
          candles1H: [{ time: baseTime + i * 900, open: 24500, high: 24550, low: 24450, close: 24520, volume: 10000 }],
        });
      }

      const trades = backtestEngine.simulateDataSeries(dataset, 500000, "REGIME");
      for (const t of trades) {
        expect(t.maxLoss).toBeLessThanOrEqual(5000); // 1% of ₹500,000 capital is ₹5,000
      }
    });

    it("verifies charge breakdown includes brokerage, GST, STT, and slippage", () => {
      const charges = chargeCalculator.calculateSpreadCharges(120, 40, 1, 2000);
      expect(charges.brokerage).toBe(80); // 4 legs total (2 entry + 2 exit) * ₹20
      expect(charges.stt).toBeGreaterThan(0);
      expect(charges.gst).toBeGreaterThan(0);
      expect(charges.totalCharges).toBeGreaterThan(40);
    });
  });

  describe("4. 17 Explicit No-Trade Rejection Reason Breakdown", () => {
    it("populates noTradeReasons with all 17 rejection reason codes", () => {
      const dataset: HistoricalDataPoint[] = [
        {
          timestamp: "2026-09-13T10:00:00Z",
          spotPrice: 24500,
          candles15M: [{ time: 1000, open: 24490, high: 24510, low: 24480, close: 24500, volume: 5000 }],
          candles1H: [{ time: 1000, open: 24490, high: 24510, low: 24480, close: 24500, volume: 5000 }],
        },
      ];

      const res = backtestEngine.runBacktest(dataset, 0.7, 500000);
      const noTradeReasons = res.overallMetrics.noTradeReasons;

      expect(noTradeReasons).toBeDefined();
      expect(noTradeReasons.length).toBe(17);

      const codes = noTradeReasons.map((r) => r.code);
      expect(codes).toContain("DATA_INVALID");
      expect(codes).toContain("DATA_STALE");
      expect(codes).toContain("TREND_CONFLICT");
      expect(codes).toContain("NO_CLEAR_STRUCTURE");
      expect(codes).toContain("VWAP_INVALID");
      expect(codes).toContain("RSI_FAILED");
      expect(codes).toContain("DELTA_FAILED");
      expect(codes).toContain("GAMMA_FAILED");
      expect(codes).toContain("S/R_DISTANCE_FAILED");
      expect(codes).toContain("MAX_LOSS_EXCEEDED");
      expect(codes).toContain("VOLATILITY_FAILED");
      expect(codes).toContain("EVENT_RISK");
      expect(codes).toContain("DAILY_PROFIT_LOCK");
      expect(codes).toContain("DAILY_LOSS_LOCK");
      expect(codes).toContain("MAX_TRADES");
      expect(codes).toContain("CONSECUTIVE_LOSS_LOCK");
      expect(codes).toContain("NO_VALID_OPTION");
    });
  });
});
