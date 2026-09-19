import { describe, it, expect, beforeEach } from "vitest";
import { NiftyMarketProvider } from "../market/NiftyMarketProvider";
import { SlippageModel } from "../risk/SlippageModel";
import { SignalAuditStore } from "../audit/SignalAuditStore";
import { NiftyHistoricalOptionImporter } from "../backtest/NiftyHistoricalOptionImporter";
import { backtestEngine } from "../backtest/BacktestEngine";
import { AutoHedgeSignal } from "../types";

describe("Phase 3 Live Paper Validation & Backtest Integration Suite", () => {
  let provider: NiftyMarketProvider;
  let slippageModel: SlippageModel;
  let auditStore: SignalAuditStore;
  let importer: NiftyHistoricalOptionImporter;

  beforeEach(() => {
    provider = new NiftyMarketProvider(1000); // 1 sec stale timeout for testing
    slippageModel = new SlippageModel();
    auditStore = new SignalAuditStore();
    importer = new NiftyHistoricalOptionImporter();
  });

  describe("1. Market Data Provider & Stale Data Protection", () => {
    it("reports default paper/synthetic status when no live feed present", async () => {
      const res = await provider.getSpotPrice();
      expect(res.spotPrice).toBeGreaterThan(0);
      expect(res.isReal).toBe(false);
    });

    it("evaluates data health and flags stale data when timeout exceeded", async () => {
      const health = provider.getDataHealth();
      expect(health.isHealthy).toBe(true);
      expect(health.isStale).toBe(false);

      // Wait 1.1 seconds to trigger 1 sec stale timeout
      await new Promise((resolve) => setTimeout(resolve, 1100));

      const staleHealth = provider.getDataHealth();
      expect(staleHealth.isStale).toBe(true);
      expect(staleHealth.isHealthy).toBe(false);
      expect(staleHealth.errorMessage).toContain("Data is stale");
    });
  });

  describe("2. Slippage Model", () => {
    it("calculates fixed points slippage per leg", () => {
      slippageModel.setConfig({ type: "FIXED_POINTS", fixedPointsPerLeg: 0.5 });
      const buyRes = slippageModel.calculateExecutionPrice("BUY", 100);
      expect(buyRes.executionPrice).toBe(100.5);
      expect(buyRes.slippageAmount).toBe(0.5);

      const sellRes = slippageModel.calculateExecutionPrice("SELL", 100);
      expect(sellRes.executionPrice).toBe(99.5);
    });

    it("calculates bid/ask spread execution when available", () => {
      slippageModel.setConfig({ type: "BID_ASK_SPREAD" });
      const buyRes = slippageModel.calculateExecutionPrice("BUY", 100, 99.2, 100.8);
      expect(buyRes.executionPrice).toBe(100.8);

      const sellRes = slippageModel.calculateExecutionPrice("SELL", 100, 99.2, 100.8);
      expect(sellRes.executionPrice).toBe(99.2);
    });

    it("calculates percentage-based slippage", () => {
      slippageModel.setConfig({ type: "PERCENTAGE", percentageOfPremium: 0.01 }); // 1%
      const buyRes = slippageModel.calculateExecutionPrice("BUY", 100);
      expect(buyRes.executionPrice).toBe(101);
      expect(buyRes.slippageAmount).toBe(1);
    });
  });

  describe("3. Signal Audit Store", () => {
    it("records and retrieves strategy signal evaluation entries", () => {
      const mockSignal: AutoHedgeSignal = {
        symbol: "NIFTY",
        timestamp: new Date().toISOString(),
        regime: "BULLISH",
        score: 85,
        action: "BULL_PUT_SPREAD",
        expiry: "2026-09-24",
        spotPrice: 24700,
        netCredit: 45,
        maxProfit: 1125,
        maxLoss: 3875,
        entryPrice: 45,
        stopLossSpread: 67.5,
        targetSpread: 22.5,
        quantityLots: 1,
        totalQuantity: 25,
        marginRequired: 50000,
        charges: {
          grossPnl: 1125,
          entryCharges: 40,
          exitCharges: 40,
          brokerage: 80,
          stt: 15,
          exchangeFees: 10,
          gst: 18,
          sebiFees: 1,
          stampDuty: 2,
          estimatedSlippage: 25,
          totalCharges: 151,
          netPnl: 974,
        },
        expectedNetPnl: 974,
        riskPercentage: 0.8,
        rewardRiskRatio: 0.29,
        status: "READY",
        reasons: ["Strong 1H trend"],
      };

      const entry = auditStore.recordSignal(mockSignal, false);
      expect(entry.id).toBeDefined();
      expect(entry.score).toBe(85);
      expect(entry.status).toBe("READY");

      const logs = auditStore.getRecentLogs(10);
      expect(logs.length).toBe(1);
      expect(logs[0].spotPrice).toBe(24700);
    });
  });

  describe("4. Historical Option CSV Importer", () => {
    it("rejects CSV dataset when required headers are missing", () => {
      const invalidCsv = "date,close,high,low\n2026-09-13,24700,24750,24650";
      const res = importer.parseCSV(invalidCsv);
      expect(res.success).toBe(false);
      expect(res.errors[0]).toContain("Required columns");
    });

    it("parses valid historical option CSV data cleanly", () => {
      const validCsv = `timestamp,expiry,strike,type,ltp,bid,ask,volume,oi,iv
2026-09-13T10:00:00Z,2026-09-24,24500,PE,35.5,35.0,36.0,12000,65000,14.5
2026-09-13T10:00:00Z,2026-09-24,24700,PE,85.0,84.5,85.5,25000,110000,15.2
2026-09-13T11:00:00Z,2026-09-24,24500,PE,28.0,27.5,28.5,14000,68000,14.2
2026-09-13T11:00:00Z,2026-09-24,24700,PE,72.0,71.5,72.5,28000,115000,14.9`;

      const res = importer.parseCSV(validCsv);
      expect(res.success).toBe(true);
      expect(res.totalRowsParsed).toBe(4);
      expect(res.uniqueTimestamps).toBe(2);
      expect(res.datasetPoints[0].optionChain).toBeDefined();
      expect(res.datasetPoints[0].optionChain?.isSynthetic).toBe(false);
    });

    it("runs backtest engine with imported historical option CSV dataset", () => {
      const validCsv = `timestamp,expiry,strike,type,ltp,bid,ask,volume,oi,iv
2026-09-13T10:00:00Z,2026-09-24,24500,PE,35.5,35.0,36.0,12000,65000,14.5
2026-09-13T10:00:00Z,2026-09-24,24700,PE,85.0,84.5,85.5,25000,110000,15.2
2026-09-13T11:00:00Z,2026-09-24,24500,PE,28.0,27.5,28.5,14000,68000,14.2
2026-09-13T11:00:00Z,2026-09-24,24700,PE,72.0,71.5,72.5,28000,115000,14.9`;

      const parsed = importer.parseCSV(validCsv);
      expect(parsed.success).toBe(true);

      const backtestRes = backtestEngine.runBacktest(parsed.datasetPoints, 0.5, 500000);
      expect(backtestRes.overallMetrics).toBeDefined();
      expect(backtestRes.overallMetrics.isHistoricalOptionDataAvailable).toBe(true);
      expect(backtestRes.overallMetrics.dataSourceDisclosure).toContain("Historical option chain contracts provided");
    });
  });
});
