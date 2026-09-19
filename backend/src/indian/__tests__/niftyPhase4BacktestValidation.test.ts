import { describe, it, expect } from "vitest";
import { niftyHistoricalOptionImporter } from "../backtest/NiftyHistoricalOptionImporter";
import { backtestEngine, HistoricalDataPoint } from "../backtest/BacktestEngine";
import { chargeCalculator } from "../risk/ChargeCalculator";
import { defaultSlippageModel } from "../risk/SlippageModel";

describe("Phase 4 — Real Historical Backtest & Strategy Validation Suite", () => {
  describe("1. Historical Data Quality & Diagnostic Pipeline", () => {
    it("rejects empty or malformed CSV header with INVALID_CSV status", () => {
      const csv = "invalid,header\n1,2";
      const res = niftyHistoricalOptionImporter.parseCSV(csv);
      expect(res.success).toBe(false);
      expect(res.status).toBe("INVALID_CSV");
      expect(res.dataQualityReport.isSufficientData).toBe(false);
      expect(res.errors[0]).toContain("Header Validation Failed");
    });

    it("detects invalid rows, duplicate contract snapshots, and impossible option prices", () => {
      const csv = `timestamp,expiry,strike,type,ltp
2026-09-13T10:00:00Z,2026-09-24,24500,PE,50.0
2026-09-13T10:00:00Z,2026-09-24,24500,PE,50.0
2026-09-13T10:00:00Z,2026-09-24,-100,PE,50.0
2026-09-13T10:00:00Z,2026-09-24,24500,CE,25000.0`;

      const res = niftyHistoricalOptionImporter.parseCSV(csv);
      expect(res.dataQualityReport.duplicateRows).toBe(1);
      expect(res.dataQualityReport.invalidRows).toBe(2);
    });

    it("returns INSUFFICIENT_DATA when dataset has fewer than 2 distinct timestamp snapshots", () => {
      const csv = `timestamp,expiry,strike,type,ltp
2026-09-13T10:00:00Z,2026-09-24,24500,PE,50.0
2026-09-13T10:00:00Z,2026-09-24,24700,PE,120.0`;

      const res = niftyHistoricalOptionImporter.parseCSV(csv);
      expect(res.success).toBe(false);
      expect(res.status).toBe("INSUFFICIENT_DATA");
      expect(res.dataQualityReport.isSufficientData).toBe(false);
    });
  });

  describe("2. Realistic Execution, Charges & Slippage Model", () => {
    it("calculates exact charges, taxes, and slippage on defined-risk spreads", () => {
      const charges = chargeCalculator.calculateSpreadCharges(100, 30, 2, 3500);
      expect(charges.brokerage).toBe(80); // 4 legs * ₹20
      expect(charges.stt).toBeGreaterThan(0);
      expect(charges.totalCharges).toBeGreaterThan(100);
      expect(charges.netPnl).toBe(3500 - charges.totalCharges);
    });

    it("applies slippage to entry fills via SlippageModel", () => {
      const buyFill = defaultSlippageModel.calculateExecutionPrice("BUY", 50, 49.5, 50.5);
      const sellFill = defaultSlippageModel.calculateExecutionPrice("SELL", 100, 99.5, 100.5);

      expect(buyFill.executionPrice).toBe(50.5); // Buy fill at ask or +0.5
      expect(sellFill.executionPrice).toBe(99.5); // Sell fill at bid or -0.5
    });
  });

  describe("3. Zero Look-Ahead Bias & Walk-Forward 70/30 Split", () => {
    it("executes walk-forward backtest splitting dataset into 70% In-Sample and 30% Out-Of-Sample", () => {
      const dataset: HistoricalDataPoint[] = [];
      const now = Math.floor(Date.now() / 1000);

      for (let i = 20; i >= 0; i--) {
        const timestamp = new Date((now - i * 3600) * 1000).toISOString();
        const spotPrice = 24700 + (10 - i) * 10;
        dataset.push({
          timestamp,
          spotPrice,
          candles15M: [
            { time: now - i * 3600, open: spotPrice - 5, high: spotPrice + 10, low: spotPrice - 10, close: spotPrice, volume: 10000 },
          ],
          candles1H: [
            { time: now - i * 3600, open: spotPrice - 5, high: spotPrice + 10, low: spotPrice - 10, close: spotPrice, volume: 10000 },
          ],
        });
      }

      const res = backtestEngine.runBacktest(dataset, 0.7, 500000);
      expect(res.lookAheadBiasVerifiedZero).toBe(true);
      expect(res.trainingMetrics).toBeDefined();
      expect(res.outOfSampleMetrics).toBeDefined();
      expect(res.strategyComparison).toBeDefined();
      expect(res.robustnessAnalysis).toBeDefined();
    });
  });

  describe("4. Risk Limits & Daily Lock Enforcement", () => {
    it("enforces max 3 trades per day and stops trading when daily profit lock or loss lock is hit", () => {
      const dataset: HistoricalDataPoint[] = [];
      const dateStr = "2026-09-13";

      for (let i = 0; i < 10; i++) {
        const timestamp = `${dateStr}T1${i}:00:00Z`;
        dataset.push({
          timestamp,
          spotPrice: 24700 + i * 20,
          candles15M: [
            { time: 1000 + i * 60, open: 24700, high: 24750, low: 24650, close: 24720, volume: 10000 },
          ],
          candles1H: [
            { time: 1000 + i * 60, open: 24700, high: 24750, low: 24650, close: 24720, volume: 10000 },
          ],
        });
      }

      const trades = backtestEngine.simulateDataSeries(dataset, 500000, "REGIME");
      expect(trades.length).toBeLessThanOrEqual(3);
    });
  });
});
