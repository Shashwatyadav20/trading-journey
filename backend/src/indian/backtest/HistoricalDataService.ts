import { createHash, randomUUID } from "crypto";
import {
  niftyHistoricalOptionImporter,
  DataQualityReport,
  ParsedOptionRow,
} from "./NiftyHistoricalOptionImporter";
import { backtestEngine, BacktestResult, HistoricalDataPoint } from "./BacktestEngine";

export type DatasetSourceType = "REAL_HISTORICAL" | "SYNTHETIC" | "UNKNOWN";
export type DataQualityState = "VALID" | "WARNING" | "INSUFFICIENT_DATA" | "INVALID";

export interface ColumnMappingResult {
  mappedHeaders: Record<string, string>;
  unmappedHeaders: string[];
  isAmbiguous: boolean;
  ambiguityReason?: string;
}

export interface DatasetMetadata {
  datasetId: string;
  datasetHash: string;
  sourceType: DatasetSourceType;
  qualityState: DataQualityState;
  importTimestamp: string;
  startDate: string;
  endDate: string;
  tradingDays: number;
  totalRows: number;
  uniqueTimestamps: number;
  uniqueExpiries: number;
  uniqueStrikes: number;
  ceRows: number;
  peRows: number;
  missingDataPct: number;
  duplicateRows: number;
  invalidRows: number;
  bidAskAvailabilityPct: number;
  oiAvailabilityPct: number;
  ivAvailabilityPct: number;
  columnMapping: ColumnMappingResult;
  previewRows: ParsedOptionRow[];
  dataPoints: HistoricalDataPoint[];
}

export interface ValidateCSVResponse {
  success: boolean;
  qualityState: DataQualityState;
  metadata?: DatasetMetadata;
  errors: string[];
  warnings: string[];
}

export class HistoricalDataService {
  private datasetStore = new Map<string, DatasetMetadata>();
  private MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024; // 50MB cap

  /**
   * Resolves flexible CSV column headers and detects ambiguous mapping rules.
   */
  public resolveColumnMapping(headerLine: string): ColumnMappingResult {
    const rawHeaders = headerLine
      .toLowerCase()
      .split(",")
      .map((h) => h.trim().replace(/^["']|["']$/g, ""));

    const mappedHeaders: Record<string, string> = {};
    const unmappedHeaders: string[] = [];

    const aliases: Record<string, string[]> = {
      timestamp: ["timestamp", "datetime", "date_time", "time", "date"],
      expiry: ["expiry", "expiry_date", "exp_date", "expiration"],
      strike: ["strike", "strike_price", "strikeprice"],
      type: ["type", "optiontype", "option_type", "ce_pe"],
      ltp: ["ltp", "close", "last_price", "price", "trade_price"],
      bid: ["bid", "bid_price"],
      ask: ["ask", "ask_price"],
      volume: ["volume", "vol", "traded_volume"],
      oi: ["oi", "open_interest", "openinterest"],
      iv: ["iv", "implied_volatility", "volatility"],
    };

    // Check header matching
    for (const [canonicalField, aliasList] of Object.entries(aliases)) {
      const matches = rawHeaders.filter((h) => aliasList.includes(h));
      if (matches.length > 1) {
        return {
          mappedHeaders: {},
          unmappedHeaders: rawHeaders,
          isAmbiguous: true,
          ambiguityReason: `Ambiguous column mapping detected for '${canonicalField}'. Found multiple matching headers: [${matches.join(", ")}]`,
        };
      }
      if (matches.length === 1) {
        mappedHeaders[canonicalField] = matches[0];
      }
    }

    // Required fields check
    const requiredCanonical = ["timestamp", "expiry", "strike", "type", "ltp"];
    const missingCanonical = requiredCanonical.filter((f) => !mappedHeaders[f]);

    if (missingCanonical.length > 0) {
      return {
        mappedHeaders,
        unmappedHeaders: rawHeaders.filter((h) => !Object.values(mappedHeaders).includes(h)),
        isAmbiguous: true,
        ambiguityReason: `Missing required canonical headers: [${missingCanonical.join(", ")}]`,
      };
    }

    return {
      mappedHeaders,
      unmappedHeaders: rawHeaders.filter((h) => !Object.values(mappedHeaders).includes(h)),
      isAmbiguous: false,
    };
  }

  /**
   * Generates a deterministic SHA256 fingerprint for the dataset.
   */
  public generateFingerprint(csvContent: string): string {
    return createHash("sha256").update(csvContent.trim()).digest("hex").substring(0, 16);
  }

  /**
   * Validates uploaded CSV content against security, column mapping, and quality gates.
   */
  public validateCSV(
    csvContent: string,
    declaredSource: DatasetSourceType = "UNKNOWN"
  ): ValidateCSVResponse {
    // 1. Security & File Size Check
    if (!csvContent || csvContent.trim().length === 0) {
      return {
        success: false,
        qualityState: "INVALID",
        errors: ["CSV upload rejected: Empty content."],
        warnings: [],
      };
    }

    const byteLength = Buffer.byteLength(csvContent, "utf8");
    if (byteLength > this.MAX_FILE_SIZE_BYTES) {
      return {
        success: false,
        qualityState: "INVALID",
        errors: [`CSV upload rejected: Exceeds 50MB maximum size limit (${(byteLength / 1024 / 1024).toFixed(1)}MB)`],
        warnings: [],
      };
    }

    // Path traversal / arbitrary script injection safety check
    if (/<script|eval\(|exec\(/i.test(csvContent)) {
      return {
        success: false,
        qualityState: "INVALID",
        errors: ["CSV upload rejected: Security violation - illegal script payload detected."],
        warnings: [],
      };
    }

    const lines = csvContent
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    if (lines.length < 2) {
      return {
        success: false,
        qualityState: "INVALID",
        errors: ["CSV contains header line only, no data rows found."],
        warnings: [],
      };
    }

    // 2. Column Mapping Resolution
    const mapping = this.resolveColumnMapping(lines[0]);
    if (mapping.isAmbiguous) {
      return {
        success: false,
        qualityState: "INVALID",
        errors: [mapping.ambiguityReason || "Ambiguous header mapping."],
        warnings: [],
      };
    }

    // 3. Delegate to Importer for row parsing & DataQualityReport
    const parseResult = niftyHistoricalOptionImporter.parseCSV(csvContent);
    const report = parseResult.dataQualityReport;

    const errors = [...parseResult.errors];
    const warnings: string[] = [];

    // Evaluate Quality Gate State
    let qualityState: DataQualityState = "VALID";

    if (parseResult.status === "INVALID_CSV" || !parseResult.success && parseResult.status !== "INSUFFICIENT_DATA") {
      qualityState = "INVALID";
    } else if (parseResult.status === "INSUFFICIENT_DATA" || !report.isSufficientData) {
      qualityState = "INSUFFICIENT_DATA";
    } else {
      // Check for WARNING state (missing optional fields)
      if (report.bidAskAvailabilityPct < 10) {
        warnings.push("Bid/Ask spread data is unavailable or incomplete in dataset (< 10%). Execution model will fallback to LTP slippage.");
      }
      if (report.oiAvailabilityPct < 10) {
        warnings.push("Open Interest (OI) data is unavailable in dataset (< 10%).");
      }
      if (report.ivAvailabilityPct < 10) {
        warnings.push("Implied Volatility (IV) data is unavailable in dataset (< 10%). Estimated IV will be used.");
      }
      if (warnings.length > 0) {
        qualityState = "WARNING";
      }
    }

    const datasetHash = this.generateFingerprint(csvContent);
    const datasetId = `DS_${datasetHash}`;

    // Extract first 20 parsed rows for preview
    const previewRows: ParsedOptionRow[] = parseResult.datasetPoints.flatMap((dp) =>
      dp.optionChain ? dp.optionChain.contracts.map((c) => ({
        timestamp: dp.timestamp,
        expiry: c.expiry,
        strike: c.strike,
        type: c.optionType,
        ltp: c.ltp,
        bid: c.bid,
        ask: c.ask,
        volume: c.volume,
        oi: c.openInterest,
        iv: c.iv,
      })) : []
    ).slice(0, 20);

    const metadata: DatasetMetadata = {
      datasetId,
      datasetHash,
      sourceType: declaredSource,
      qualityState,
      importTimestamp: new Date().toISOString(),
      startDate: report.startDate,
      endDate: report.endDate,
      tradingDays: report.tradingDays,
      totalRows: report.totalRows,
      uniqueTimestamps: parseResult.uniqueTimestamps,
      uniqueExpiries: report.uniqueExpiries,
      uniqueStrikes: report.uniqueStrikes,
      ceRows: report.ceRows,
      peRows: report.peRows,
      missingDataPct: report.missingDataPct,
      duplicateRows: report.duplicateRows,
      invalidRows: report.invalidRows,
      bidAskAvailabilityPct: report.bidAskAvailabilityPct,
      oiAvailabilityPct: report.oiAvailabilityPct,
      ivAvailabilityPct: report.ivAvailabilityPct,
      columnMapping: mapping,
      previewRows,
      dataPoints: parseResult.datasetPoints,
    };

    // Store metadata in store
    this.datasetStore.set(datasetId, metadata);

    return {
      success: qualityState === "VALID" || qualityState === "WARNING",
      qualityState,
      metadata,
      errors,
      warnings,
    };
  }

  /**
   * Retrieves metadata for an imported dataset by datasetId.
   */
  public getDataset(datasetId: string): DatasetMetadata | null {
    return this.datasetStore.get(datasetId) || null;
  }

  /**
   * Lists all stored dataset metadata items.
   */
  public listDatasets(): DatasetMetadata[] {
    return Array.from(this.datasetStore.values());
  }

  /**
   * Executes backtest with strict Phase 6 Backtest Lock.
   */
  public executeLockedBacktest(
    datasetId: string,
    trainingRatio: number = 0.7,
    initialCapital: number = 500000
  ): { allowed: boolean; blockReason?: string; result?: BacktestResult } {
    const dataset = this.getDataset(datasetId);

    if (!dataset) {
      return {
        allowed: false,
        blockReason: "REAL HISTORICAL BACKTEST BLOCKED: Dataset not found in import store.",
      };
    }

    if (dataset.sourceType === "UNKNOWN") {
      return {
        allowed: false,
        blockReason: "REAL HISTORICAL BACKTEST BLOCKED: Dataset source is UNKNOWN. Source must be declared as REAL_HISTORICAL.",
      };
    }

    if (dataset.qualityState === "INVALID") {
      return {
        allowed: false,
        blockReason: "REAL HISTORICAL BACKTEST BLOCKED: Dataset status is INVALID due to malformed or illegal quotes.",
      };
    }

    if (dataset.qualityState === "INSUFFICIENT_DATA") {
      return {
        allowed: false,
        blockReason: "REAL HISTORICAL BACKTEST BLOCKED: Dataset contains INSUFFICIENT_DATA for walk-forward testing.",
      };
    }

    // Run backtest
    const result = backtestEngine.runBacktest(dataset.dataPoints, trainingRatio, initialCapital);

    return {
      allowed: true,
      result,
    };
  }
}

export const historicalDataService = new HistoricalDataService();
