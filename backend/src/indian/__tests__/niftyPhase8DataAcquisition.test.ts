import { describe, it, expect } from "vitest";
import { dataSourceStatusService } from "../backtest/DataSourceStatusService";
import { niftyHistoricalDataProviderAdapter } from "../market/NiftyHistoricalDataProviderAdapter";
import { historicalDataService } from "../backtest/HistoricalDataService";
import { niftyHistoricalOptionImporter } from "../backtest/NiftyHistoricalOptionImporter";

describe("PHASE 8 — Genuine NIFTY Historical Data Source & Acquisition", () => {
  it("should audit candidate data sources matrix cleanly", () => {
    const candidates = dataSourceStatusService.getCandidateSources();
    expect(Array.isArray(candidates)).toBe(true);
    expect(candidates.length).toBeGreaterThanOrEqual(4);

    const nse = candidates.find((c) => c.provider.includes("NSE Archives"));
    expect(nse).toBeDefined();
    expect(nse?.OI).toBe("AVAILABLE");
    expect(nse?.bidAsk).toBe("NOT AVAILABLE");

    const userCsv = candidates.find((c) => c.provider.includes("User-Supplied"));
    expect(userCsv).toBeDefined();
    expect(userCsv?.integrationStatus).toBe("ACTIVE");
  });

  it("should return HISTORICAL_PROVIDER_NOT_CONFIGURED when no broker/vendor API key is present", async () => {
    const isConfigured = niftyHistoricalDataProviderAdapter.isConfigured();
    expect(isConfigured).toBe(false);

    const res = await niftyHistoricalDataProviderAdapter.fetchHistoricalData({
      symbol: "NIFTY",
      startDate: "2026-01-01",
      endDate: "2026-01-30",
    });

    expect(res.success).toBe(false);
    expect(res.status).toBe("HISTORICAL_PROVIDER_NOT_CONFIGURED");
    expect(res.dataPoints).toEqual([]);
    expect(res.error).toContain("No historical option provider API key configured");
  });

  it("should verify provider capabilities and required/optional field coverage", () => {
    const info = niftyHistoricalDataProviderAdapter.getCandidateInfo();
    expect(info.provider).toContain("Broker / Vendor API");

    const reqTimestamp = info.capabilities.find((cap) => cap.field === "timestamp");
    const reqLtp = info.capabilities.find((cap) => cap.field === "LTP");
    const optBid = info.capabilities.find((cap) => cap.field === "bid");

    expect(reqTimestamp?.status).toBe("AVAILABLE");
    expect(reqLtp?.status).toBe("AVAILABLE");
    expect(optBid?.status).toBe("NOT AVAILABLE");
  });

  it("should validate CSV importer workflow, field integrity, and SHA256 dataset hashing", () => {
    const csvContent = `timestamp,expiry,strike,optionType,LTP,bid,ask,volume,OI,IV
2026-09-13T09:15:00Z,2026-09-24,24500,PE,42.5,42.0,43.0,15000,85000,14.2
2026-09-13T09:30:00Z,2026-09-24,24700,PE,98.0,97.5,98.5,32000,140000,15.1`;

    const validation = historicalDataService.validateCSV(csvContent, "REAL_HISTORICAL");
    expect(validation.success).toBe(true);
    expect(validation.qualityState).toBe("VALID");
    expect(validation.metadata?.datasetHash).toBeDefined();
    expect(validation.metadata?.datasetHash.length).toBe(16);
    expect(validation.metadata?.totalRows).toBe(2);
  });

  it("should strictly block backtests on unverified or invalid datasets", () => {
    const csvContent = `timestamp,expiry,strike,optionType,LTP
2026-09-13T09:15:00Z,2026-09-24,24500,PE,42.5`;

    // Declaring source UNKNOWN must block backtest execution
    const valUnknown = historicalDataService.validateCSV(csvContent, "UNKNOWN");
    const unknownExec = historicalDataService.executeLockedBacktest(valUnknown.metadata!.datasetId);
    expect(unknownExec.allowed).toBe(false);
    expect(unknownExec.blockReason).toContain("Dataset source is UNKNOWN");
  });
});
