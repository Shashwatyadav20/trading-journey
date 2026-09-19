import { describe, it, expect } from "vitest";
import { niftyHistoricalOptionImporter } from "../backtest/NiftyHistoricalOptionImporter";
import { backtestEngine, HistoricalDataPoint } from "../backtest/BacktestEngine";
import { defaultSlippageModel } from "../risk/SlippageModel";

describe("Phase 5 — Real NIFTY Option Data Integration & Validation Suite", () => {
  describe("1. Real vs Synthetic Data Separation & Disclosure", () => {
    it("flags synthetic data correctly and returns REAL_DATA_REQUIRED when no real dataset is present", () => {
      const emptyRes = backtestEngine.runBacktest([]);
      expect(emptyRes.dataSource).toBe("SYNTHETIC_PAPER_DATA");
      expect(emptyRes.finalVerdict.verdict).toBe("REAL_DATA_REQUIRED");
      expect(emptyRes.finalVerdict.summary).toContain("Backtest engine is ready");
    });

    it("marks dataset as REAL_HISTORICAL_DATA when real option contracts are provided in CSV", () => {
      const csv = `timestamp,expiry,strike,type,ltp,bid,ask,volume,oi,iv
2026-09-13T10:00:00Z,2026-09-24,24500,PE,35.5,35.0,36.0,12000,65000,14.5
2026-09-13T10:00:00Z,2026-09-24,24700,PE,85.0,84.5,85.5,25000,110000,15.2
2026-09-13T11:00:00Z,2026-09-24,24500,PE,30.0,29.5,30.5,14000,66000,14.2
2026-09-13T11:00:00Z,2026-09-24,24700,PE,75.0,74.5,75.5,28000,115000,15.0`;

      const parseResult = niftyHistoricalOptionImporter.parseCSV(csv);
      expect(parseResult.success).toBe(true);
      expect(parseResult.status).toBe("OK");

      const backtestRes = backtestEngine.runBacktest(parseResult.datasetPoints, 0.7, 500000);
      expect(backtestRes.dataSource).toBe("REAL_HISTORICAL_DATA");
      expect(backtestRes.riskValidation.passedAllRules).toBe(true);
    });
  });

  describe("2. Data Quality Gate & Diagnostics", () => {
    it("handles data gaps and reports invalid rows without crashing", () => {
      const csv = `timestamp,expiry,strike,type,ltp
2026-09-13T10:00:00Z,2026-09-24,24500,PE,35.5
2026-09-13T10:00:00Z,2026-09-24,INVALID_STRIKE,PE,35.5
2026-09-13T11:00:00Z,2026-09-24,24500,PE,30.0`;

      const parseResult = niftyHistoricalOptionImporter.parseCSV(csv);
      expect(parseResult.dataQualityReport.invalidRows).toBe(1);
      expect(parseResult.datasetPoints.length).toBe(2);
    });
  });

  describe("3. Final Verdict Evaluation", () => {
    it("returns REAL_DATA_REQUIRED when running backtest on empty or purely synthetic dataset", () => {
      const dataset: HistoricalDataPoint[] = [];
      const res = backtestEngine.runBacktest(dataset);
      expect(res.finalVerdict.verdict).toBe("REAL_DATA_REQUIRED");
      expect(res.finalVerdict.title).toBe("REAL DATA REQUIRED");
    });
  });
});
