import { describe, it, expect } from "vitest";
import { dataSourceStatusService } from "../backtest/DataSourceStatusService";
import { historicalDataService } from "../backtest/HistoricalDataService";
import { niftyHistoricalOptionImporter } from "../backtest/NiftyHistoricalOptionImporter";

describe("PHASE 7 — Real NIFTY Data Source Audit & Backtest Validation", () => {
  it("should return NO_HISTORICAL_OPTION_PROVIDER_CONFIGURED when no real historical options provider exists", () => {
    const status = dataSourceStatusService.getDataSourceStatus(false);
    expect(status.historicalProviderAvailable).toBe(false);
    expect(status.historicalProviderName).toBe("NOT CONFIGURED");
    expect(status.csvImportAvailable).toBe(true);
    expect(status.realDataAvailable).toBe(false);
    expect(status.syntheticDataAvailable).toBe(true);
    expect(status.backtestReady).toBe(false);
    expect(status.reason).toContain("No genuine historical NIFTY option-chain provider");
  });

  it("should audit workspace market data providers without exposing secrets", () => {
    const audit = dataSourceStatusService.getProvidersAudit();
    expect(Array.isArray(audit)).toBe(true);
    expect(audit.length).toBeGreaterThanOrEqual(4);

    const twelveData = audit.find((p) => p.provider.includes("Twelve Data"));
    expect(twelveData).toBeDefined();
    expect(twelveData?.spotData).toBe(true);
    expect(twelveData?.historicalOptions).toBe(false);

    const broker = audit.find((p) => p.provider.includes("Broker"));
    expect(broker).toBeDefined();
    expect(broker?.currentlyWorking).toBe(false); // Locked OFF via LIVE_TRADING = false
  });

  it("should generate canonical CSV template labeled TEMPLATE_ONLY", () => {
    const template = dataSourceStatusService.getCSVTemplate();
    expect(template).toContain("TEMPLATE_ONLY — NOT REAL MARKET DATA");
    expect(template).toContain("timestamp,expiry,strike,optionType,LTP,bid,ask,volume,OI,IV");
  });

  it("should validate CSV format and handle missing provider scenario cleanly", () => {
    const template = dataSourceStatusService.getCSVTemplate();
    // Validating template should return INVALID because headers only have no data rows
    const res = historicalDataService.validateCSV(template, "REAL_HISTORICAL");
    expect(res.success).toBe(false);
    expect(res.qualityState).toBe("INVALID");
  });

  it("should enforce real vs synthetic dataset separation", () => {
    const sampleCsv = `timestamp,expiry,strike,optionType,LTP
2026-09-13T10:00:00Z,2026-09-24,24500,PE,35.5
2026-09-13T10:00:00Z,2026-09-24,24700,PE,85.0`;

    const imported = niftyHistoricalOptionImporter.parseCSV(sampleCsv);
    expect(imported.dataQualityReport.totalRows).toBe(2);

    // If source is declared UNKNOWN, backtest is blocked
    const validation = historicalDataService.validateCSV(sampleCsv, "UNKNOWN");
    expect(validation.metadata?.datasetId).toBeDefined();

    const lockedTest = historicalDataService.executeLockedBacktest(
      validation.metadata!.datasetId,
      0.7,
      500000
    );
    expect(lockedTest.allowed).toBe(false);
    expect(lockedTest.blockReason).toContain("Dataset source is UNKNOWN");
  });
});
