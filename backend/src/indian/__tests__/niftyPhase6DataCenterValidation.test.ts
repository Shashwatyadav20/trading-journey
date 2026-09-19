import { describe, it, expect } from "vitest";
import { historicalDataService } from "../backtest/HistoricalDataService";

describe("Phase 6 — Historical Data Acquisition & Import Center Suite", () => {
  describe("1. Column Mapping & Alias Resolution", () => {
    it("resolves canonical fields from flexible aliases", () => {
      const header = "datetime,expiry_date,strike_price,option_type,close,open_interest,volatility";
      const res = historicalDataService.resolveColumnMapping(header);
      expect(res.isAmbiguous).toBe(false);
      expect(res.mappedHeaders.timestamp).toBe("datetime");
      expect(res.mappedHeaders.expiry).toBe("expiry_date");
      expect(res.mappedHeaders.strike).toBe("strike_price");
      expect(res.mappedHeaders.type).toBe("option_type");
      expect(res.mappedHeaders.ltp).toBe("close");
    });

    it("detects ambiguous header mappings and rejects invalid headers", () => {
      const header = "timestamp,datetime,expiry,strike,type,ltp"; // Two timestamp aliases
      const res = historicalDataService.resolveColumnMapping(header);
      expect(res.isAmbiguous).toBe(true);
      expect(res.ambiguityReason).toContain("Ambiguous column mapping");
    });
  });

  describe("2. Security & File Validation", () => {
    it("rejects malicious script payloads in CSV uploads", () => {
      const scriptCsv = "<script>alert('xss')</script>\ntimestamp,expiry,strike,type,ltp";
      const res = historicalDataService.validateCSV(scriptCsv, "REAL_HISTORICAL");
      expect(res.success).toBe(false);
      expect(res.qualityState).toBe("INVALID");
      expect(res.errors[0]).toContain("Security violation");
    });
  });

  describe("3. Dataset Fingerprinting & Backtest Lock", () => {
    it("generates deterministic fingerprint for identical dataset contents", () => {
      const csv = `timestamp,expiry,strike,type,ltp
2026-09-13T10:00:00Z,2026-09-24,24500,PE,35.5
2026-09-13T10:00:00Z,2026-09-24,24700,PE,85.0`;

      const hash1 = historicalDataService.generateFingerprint(csv);
      const hash2 = historicalDataService.generateFingerprint(csv);
      expect(hash1).toBe(hash2);
      expect(hash1.length).toBe(16);
    });

    it("blocks real historical backtest when declared source is UNKNOWN", () => {
      const csv = `timestamp,expiry,strike,type,ltp
2026-09-13T10:00:00Z,2026-09-24,24500,PE,35.5
2026-09-13T10:00:00Z,2026-09-24,24700,PE,85.0
2026-09-13T11:00:00Z,2026-09-24,24500,PE,30.0
2026-09-13T11:00:00Z,2026-09-24,24700,PE,75.0`;

      const validation = historicalDataService.validateCSV(csv, "UNKNOWN");
      expect(validation.metadata).toBeDefined();

      const lockedRes = historicalDataService.executeLockedBacktest(validation.metadata!.datasetId);
      expect(lockedExecutionAllowed(lockedRes)).toBe(false);
      expect(lockedRes.blockReason).toContain("REAL HISTORICAL BACKTEST BLOCKED");
    });
  });
});

function lockedExecutionAllowed(res: { allowed: boolean }): boolean {
  return res.allowed;
}
