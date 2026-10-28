/**
 * NseHistoricalCsvImporter.ts
 *
 * Safe local-file NSE daily OHLCV CSV importer for swing strategy backtesting.
 *
 * Scope: Stock swing strategy validation only.
 * Safety: LIVE_TRADING=false, BROKER_EXECUTION_ENABLED=false enforced by SwingTradingEngine.
 * No real orders, no production Supabase writes, no automatic data downloads.
 *
 * Accepted CSV schema (header row, case-insensitive, extra columns ignored):
 *
 *   symbol  | date (YYYY-MM-DD, IST)  | open | high | low | close | volume
 *
 * Column aliases accepted:
 *   symbol   → ticker, scrip, scrip_code, instrument
 *   date     → trading_date, datetime, timestamp, trade_date
 *   open     → open_price, o
 *   high     → high_price, h
 *   low      → low_price, l
 *   close    → close_price, c, ltp, last_price
 *   volume   → vol, traded_volume, total_volume, qty
 *
 * Design decisions:
 *   - Reuses isValidCandleOHLC() and cleanAndValidateCandles() from lib/indian/dailyStrategyScanner.
 *   - Never fabricates or back-fills missing prices.
 *   - Duplicate (symbol, date) rows are flagged and the LAST occurrence is kept (matches NSE eod revision behaviour).
 *   - Price continuity check: flags session-to-session gaps > 20% (possible split/bonus — human review required).
 *   - Source filename and SHA-256 fingerprint are stored with every imported dataset.
 *   - In-sample / out-of-sample split is explicit and configured by the caller — never inferred automatically.
 *   - Corporate actions (splits, bonuses, dividends) are NOT adjusted automatically.
 *     If prices are adjusted by the data provider, they must declare so in the metadata.
 */

import { createHash } from "crypto";
import {
  DailyCandle,
  isValidCandleOHLC,
  cleanAndValidateCandles,
} from "../../../../lib/indian/dailyStrategyScanner";

// ─────────────────────────────────────────────────────────────────────────────
// Public interfaces
// ─────────────────────────────────────────────────────────────────────────────

export interface CsvColumnMap {
  symbol: string;
  date: string;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
}

export interface CsvColumnMapResult {
  map: CsvColumnMap | null;
  isAmbiguous: boolean;
  ambiguityReason?: string;
  unmappedRequired: string[];
}

export interface RejectedRow {
  rowIndex: number;       // 1-based, excludes header
  raw: string;            // original CSV line
  reason: string;
}

export interface PriceDiscontinuity {
  symbol: string;
  date: string;
  prevDate: string;
  prevClose: number;
  open: number;
  gapPercent: number;     // abs((open - prevClose) / prevClose) * 100
}

export interface SymbolDataset {
  symbol: string;
  candles: DailyCandle[];           // chronological, validated, deduplicated
  totalRawRows: number;
  rejectedRows: number;
  duplicateRows: number;
  firstDate: string;
  lastDate: string;
  suspiciousGaps: PriceDiscontinuity[];
}

export type DataSourceDeclaration = "NSE_BHAVCOPY" | "STOOQ" | "CUSTOM" | "UNKNOWN";
export type AdjustedPriceDeclaration = "ADJUSTED" | "RAW" | "UNKNOWN";

export interface ImportMetadata {
  /** Original filename — for audit trail */
  sourceFileName: string;
  /** SHA-256 hex fingerprint of the raw CSV content (first 16 chars) */
  contentFingerprint: string;
  /** Declared data source */
  dataSource: DataSourceDeclaration;
  /** Whether prices are split/bonus/dividend adjusted */
  priceAdjustment: AdjustedPriceDeclaration;
  importedAt: string;               // ISO-8601 UTC
  totalRawRows: number;
  totalValidRows: number;
  totalRejectedRows: number;
  totalDuplicateRows: number;
  uniqueSymbols: number;
  dateRangeStart: string;           // earliest date across all symbols
  dateRangeEnd: string;             // latest date across all symbols
  columnMap: CsvColumnMap;
  suspiciousGapCount: number;
  warnings: string[];
}

export interface NseImportResult {
  success: boolean;
  errors: string[];
  warnings: string[];
  metadata: ImportMetadata | null;
  /** Keyed by clean symbol (no .NS/.BO suffix) */
  datasets: Map<string, SymbolDataset>;
  rejectedRows: RejectedRow[];
}

/** In-sample / out-of-sample split configuration */
export interface BacktestDateConfig {
  /** First date (inclusive) to include in the import at all */
  dataStartDate: string;          // YYYY-MM-DD
  /** Last date (inclusive) for in-sample strategy development period */
  inSampleEndDate: string;        // YYYY-MM-DD
  /** First date (inclusive) of the held-out out-of-sample period */
  outOfSampleStartDate: string;   // YYYY-MM-DD
  /** Last date (inclusive) of the out-of-sample period */
  outOfSampleEndDate: string;     // YYYY-MM-DD
}

export interface SplitDatasets {
  inSample: Map<string, SymbolDataset>;
  outOfSample: Map<string, SymbolDataset>;
  config: BacktestDateConfig;
}

// ─────────────────────────────────────────────────────────────────────────────
// Column alias registry
// ─────────────────────────────────────────────────────────────────────────────

const COLUMN_ALIASES: Record<keyof CsvColumnMap, string[]> = {
  symbol: ["symbol", "ticker", "scrip", "scrip_code", "instrument", "nse_symbol", "stock_symbol"],
  date:   ["date", "trading_date", "datetime", "timestamp", "trade_date", "tdate", "bhav_date"],
  open:   ["open", "open_price", "o"],
  high:   ["high", "high_price", "h"],
  low:    ["low", "low_price", "l"],
  close:  ["close", "close_price", "c", "ltp", "last_price", "prev_close"],
  volume: ["volume", "vol", "traded_volume", "total_volume", "qty", "trade_quantity", "no_of_shares"],
};

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const MAX_FILE_SIZE_BYTES = 100 * 1024 * 1024; // 100 MB
const PRICE_GAP_WARN_THRESHOLD_PCT = 20;        // flag open-to-prevClose gap > 20%
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const SECURITY_BLOCK_REGEX = /<script|eval\(|exec\(|__proto__|constructor\[/i;

// ─────────────────────────────────────────────────────────────────────────────
// NseHistoricalCsvImporter
// ─────────────────────────────────────────────────────────────────────────────

export class NseHistoricalCsvImporter {

  // ── Column mapping ──────────────────────────────────────────────────────────

  /**
   * Resolves CSV header line to canonical column map.
   * Returns an error result if any required column is missing or ambiguous.
   */
  resolveColumnMap(headerLine: string): CsvColumnMapResult {
    const rawHeaders = headerLine
      .split(",")
      .map((h) => h.trim().toLowerCase().replace(/^["']|["']$/g, "").replace(/\s+/g, "_"));

    const resolved: Partial<CsvColumnMap> = {};
    const unmappedRequired: string[] = [];

    for (const [canonical, aliases] of Object.entries(COLUMN_ALIASES) as [keyof CsvColumnMap, string[]][]) {
      const matches = rawHeaders.filter((h) => aliases.includes(h));
      if (matches.length > 1) {
        return {
          map: null,
          isAmbiguous: true,
          ambiguityReason: `Column '${canonical}' matches multiple headers: [${matches.join(", ")}]`,
          unmappedRequired: [canonical],
        };
      }
      if (matches.length === 1) {
        resolved[canonical] = matches[0];
      } else {
        unmappedRequired.push(canonical);
      }
    }

    if (unmappedRequired.length > 0) {
      return {
        map: null,
        isAmbiguous: true,
        ambiguityReason: `Missing required columns: [${unmappedRequired.join(", ")}]`,
        unmappedRequired,
      };
    }

    return {
      map: resolved as CsvColumnMap,
      isAmbiguous: false,
      unmappedRequired: [],
    };
  }

  // ── CSV parsing ─────────────────────────────────────────────────────────────

  /**
   * Parses a raw CSV string into per-symbol datasets.
   *
   * @param csvContent    Raw CSV text content from the local file
   * @param sourceFileName Original filename (for audit metadata)
   * @param dataSource     Declared data source type
   * @param priceAdjustment Whether prices are split/bonus adjusted
   */
  parseCSV(
    csvContent: string,
    sourceFileName: string,
    dataSource: DataSourceDeclaration = "UNKNOWN",
    priceAdjustment: AdjustedPriceDeclaration = "UNKNOWN"
  ): NseImportResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    const rejectedRows: RejectedRow[] = [];
    const datasets = new Map<string, SymbolDataset>();

    // ── Security & size guard ──
    if (!csvContent || csvContent.trim().length === 0) {
      return this.errorResult("CSV content is empty", errors, warnings, datasets, rejectedRows);
    }
    const byteLen = Buffer.byteLength(csvContent, "utf8");
    if (byteLen > MAX_FILE_SIZE_BYTES) {
      return this.errorResult(
        `File exceeds 100 MB limit (${(byteLen / 1024 / 1024).toFixed(1)} MB)`,
        errors, warnings, datasets, rejectedRows
      );
    }
    if (SECURITY_BLOCK_REGEX.test(csvContent)) {
      return this.errorResult("Security violation: script payload detected in CSV", errors, warnings, datasets, rejectedRows);
    }

    // ── Split lines ──
    const lines = csvContent
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith("#"));

    if (lines.length < 2) {
      return this.errorResult("CSV contains header only — no data rows", errors, warnings, datasets, rejectedRows);
    }

    // ── Column map ──
    const colMapResult = this.resolveColumnMap(lines[0]);
    if (colMapResult.isAmbiguous || !colMapResult.map) {
      return this.errorResult(
        colMapResult.ambiguityReason ?? "Cannot resolve CSV columns",
        errors, warnings, datasets, rejectedRows
      );
    }
    const colMap = colMapResult.map;

    // ── Parse header indices ──
    const rawHeaders = lines[0]
      .split(",")
      .map((h) => h.trim().toLowerCase().replace(/^["']|["']$/g, "").replace(/\s+/g, "_"));

    const idx = (canonical: keyof CsvColumnMap): number =>
      rawHeaders.indexOf(colMap[canonical]);

    const iSymbol = idx("symbol");
    const iDate   = idx("date");
    const iOpen   = idx("open");
    const iHigh   = idx("high");
    const iLow    = idx("low");
    const iClose  = idx("close");
    const iVol    = idx("volume");

    // ── Row processing ──
    // symbol → (date → raw candle) for dedup
    const symbolDateMap = new Map<string, Map<string, { candle: DailyCandle; rowIndex: number }>>();
    let totalRawRows = 0;
    let totalRejectedRows = 0;
    let totalDuplicateRows = 0;

    for (let li = 1; li < lines.length; li++) {
      const rowIndex = li; // 1-based data row
      const raw = lines[li];
      totalRawRows++;

      const cells = raw.split(",").map((c) => c.trim().replace(/^["']|["']$/g, ""));

      // ── Parse cells ──
      const rawSymbol = cells[iSymbol] ?? "";
      const rawDate   = cells[iDate]   ?? "";
      const rawOpen   = cells[iOpen]   ?? "";
      const rawHigh   = cells[iHigh]   ?? "";
      const rawLow    = cells[iLow]    ?? "";
      const rawClose  = cells[iClose]  ?? "";
      const rawVol    = cells[iVol]    ?? "";

      // Symbol
      const symbol = rawSymbol.trim().toUpperCase().replace(/\.NS$|\.BO$/i, "");
      if (!symbol || symbol.length === 0 || symbol.length > 20) {
        rejectedRows.push({ rowIndex, raw, reason: `Invalid symbol: '${rawSymbol}'` });
        totalRejectedRows++;
        continue;
      }

      // Date — must be YYYY-MM-DD
      const date = this.normaliseDate(rawDate);
      if (!date) {
        rejectedRows.push({ rowIndex, raw, reason: `Unparseable date: '${rawDate}'` });
        totalRejectedRows++;
        continue;
      }
      if (!DATE_REGEX.test(date)) {
        rejectedRows.push({ rowIndex, raw, reason: `Date not in YYYY-MM-DD format: '${date}'` });
        totalRejectedRows++;
        continue;
      }

      // OHLCV numbers
      const open  = parseFloat(rawOpen);
      const high  = parseFloat(rawHigh);
      const low   = parseFloat(rawLow);
      const close = parseFloat(rawClose);
      const volume = parseFloat(rawVol);

      const candle: DailyCandle = { date, open, high, low, close, volume };
      const ohlcCheck = isValidCandleOHLC(candle);
      if (!ohlcCheck.valid) {
        rejectedRows.push({ rowIndex, raw, reason: ohlcCheck.reason ?? "OHLC validation failed" });
        totalRejectedRows++;
        continue;
      }

      // Accumulate per symbol/date (last row wins for duplicates)
      if (!symbolDateMap.has(symbol)) {
        symbolDateMap.set(symbol, new Map());
      }
      const dateMap = symbolDateMap.get(symbol)!;
      if (dateMap.has(date)) {
        totalDuplicateRows++;
        warnings.push(`Duplicate row for ${symbol} on ${date} (row ${rowIndex}) — earlier occurrence overwritten`);
      }
      dateMap.set(date, { candle, rowIndex });
    }

    // ── Build per-symbol datasets ──
    let globalMinDate = "9999-99-99";
    let globalMaxDate = "0000-00-00";
    let totalSuspiciousGaps = 0;

    for (const [symbol, dateMap] of symbolDateMap.entries()) {
      const sortedCandles = Array.from(dateMap.values())
        .map((v) => v.candle)
        .sort((a, b) => a.date.localeCompare(b.date));

      // Price continuity check (flag potential corporate actions)
      const suspiciousGaps: PriceDiscontinuity[] = [];
      for (let i = 1; i < sortedCandles.length; i++) {
        const prev = sortedCandles[i - 1];
        const curr = sortedCandles[i];
        const gapPct = Math.abs((curr.open - prev.close) / prev.close) * 100;
        if (gapPct > PRICE_GAP_WARN_THRESHOLD_PCT) {
          suspiciousGaps.push({
            symbol,
            date: curr.date,
            prevDate: prev.date,
            prevClose: prev.close,
            open: curr.open,
            gapPercent: Number(gapPct.toFixed(2)),
          });
          warnings.push(
            `[${symbol}] Suspicious price gap on ${curr.date}: prev close ₹${prev.close} → open ₹${curr.open} (${gapPct.toFixed(1)}%). Possible split/bonus/dividend — verify corporate actions.`
          );
        }
      }
      totalSuspiciousGaps += suspiciousGaps.length;

      const dupCount = Array.from(dateMap.values()).length - sortedCandles.length; // always 0 after dedup
      const firstDate = sortedCandles[0]?.date ?? "";
      const lastDate  = sortedCandles[sortedCandles.length - 1]?.date ?? "";

      if (firstDate < globalMinDate) globalMinDate = firstDate;
      if (lastDate  > globalMaxDate) globalMaxDate = lastDate;

      datasets.set(symbol, {
        symbol,
        candles: sortedCandles,
        totalRawRows: dateMap.size + dupCount,
        rejectedRows: 0,    // per-symbol rejected already counted globally
        duplicateRows: dupCount,
        firstDate,
        lastDate,
        suspiciousGaps,
      });
    }

    const contentFingerprint = createHash("sha256")
      .update(csvContent.trim())
      .digest("hex")
      .substring(0, 16);

    const totalValidRows = totalRawRows - totalRejectedRows;

    const metadata: ImportMetadata = {
      sourceFileName,
      contentFingerprint,
      dataSource,
      priceAdjustment,
      importedAt: new Date().toISOString(),
      totalRawRows,
      totalValidRows,
      totalRejectedRows,
      totalDuplicateRows,
      uniqueSymbols: datasets.size,
      dateRangeStart: globalMinDate === "9999-99-99" ? "" : globalMinDate,
      dateRangeEnd:   globalMaxDate === "0000-00-00" ? "" : globalMaxDate,
      columnMap: colMap,
      suspiciousGapCount: totalSuspiciousGaps,
      warnings: [...warnings],
    };

    if (datasets.size === 0) {
      errors.push("No valid symbol/date rows found after parsing. Check file format and column headers.");
    }

    return {
      success: errors.length === 0 && datasets.size > 0,
      errors,
      warnings,
      metadata,
      datasets,
      rejectedRows,
    };
  }

  // ── In-sample / out-of-sample split ────────────────────────────────────────

  /**
   * Splits imported datasets into in-sample and out-of-sample subsets.
   *
   * The split is EXPLICIT — caller provides both date boundaries.
   * The importer never infers which period to use for strategy design.
   *
   * IMPORTANT: strategy parameters MUST NOT be adjusted based on out-of-sample results.
   */
  splitInSampleOutOfSample(
    datasets: Map<string, SymbolDataset>,
    config: BacktestDateConfig
  ): SplitDatasets {
    this.validateDateConfig(config);

    const inSample  = new Map<string, SymbolDataset>();
    const outOfSample = new Map<string, SymbolDataset>();

    for (const [symbol, ds] of datasets.entries()) {
      const isCandles = ds.candles.filter(
        (c) => c.date >= config.dataStartDate && c.date <= config.inSampleEndDate
      );
      const oosCandles = ds.candles.filter(
        (c) => c.date >= config.outOfSampleStartDate && c.date <= config.outOfSampleEndDate
      );

      // Check for any leakage: no OOS candle should appear in IS slice
      const isDateSet = new Set(isCandles.map((c) => c.date));
      const leaked = oosCandles.filter((c) => isDateSet.has(c.date));
      if (leaked.length > 0) {
        throw new Error(
          `DATA LEAKAGE DETECTED for ${symbol}: ${leaked.length} candles appear in both in-sample and out-of-sample windows. Check date config.`
        );
      }

      if (isCandles.length > 0) {
        inSample.set(symbol, { ...ds, candles: isCandles,
          firstDate: isCandles[0].date, lastDate: isCandles[isCandles.length - 1].date });
      }
      if (oosCandles.length > 0) {
        outOfSample.set(symbol, { ...ds, candles: oosCandles,
          firstDate: oosCandles[0].date, lastDate: oosCandles[oosCandles.length - 1].date });
      }
    }

    return { inSample, outOfSample, config };
  }

  // ── Candle cleaning façade ──────────────────────────────────────────────────

  /**
   * Returns cleaned candles for a symbol using the existing cleanAndValidateCandles().
   * Pass requireCompleted=false for historical data (no live in-progress candle concern).
   */
  getCleanedCandles(ds: SymbolDataset): DailyCandle[] {
    const result = cleanAndValidateCandles(ds.candles, {
      requireCompleted: false,   // historical files contain only completed sessions
      minCandlesForScan: 45,
    });
    return result.valid ? result.candles : [];
  }

  // ── Utility ─────────────────────────────────────────────────────────────────

  /**
   * Normalises common date formats to YYYY-MM-DD.
   * Accepts: YYYY-MM-DD, DD-MM-YYYY, DD/MM/YYYY, YYYYMMDD, DD-Mon-YYYY.
   * Returns null if format is unrecognisable.
   */
  normaliseDate(raw: string): string | null {
    const s = raw.trim();
    if (!s) return null;

    // Already YYYY-MM-DD
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

    // YYYYMMDD → YYYY-MM-DD
    if (/^\d{8}$/.test(s)) {
      return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
    }

    // DD-MM-YYYY or DD/MM/YYYY
    const dmyMatch = s.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})$/);
    if (dmyMatch) {
      const [, dd, mm, yyyy] = dmyMatch;
      return `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
    }

    // DD-Mon-YYYY (e.g., 01-Jan-2024)
    const monMatch = s.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/);
    if (monMatch) {
      const [, dd, mon, yyyy] = monMatch;
      const MONTHS: Record<string, string> = {
        jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
        jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
      };
      const mm = MONTHS[mon.toLowerCase()];
      if (!mm) return null;
      return `${yyyy}-${mm}-${dd.padStart(2, "0")}`;
    }

    return null;
  }

  private validateDateConfig(cfg: BacktestDateConfig) {
    if (cfg.inSampleEndDate >= cfg.outOfSampleStartDate) {
      throw new Error(
        `Date config error: inSampleEndDate (${cfg.inSampleEndDate}) must be strictly before outOfSampleStartDate (${cfg.outOfSampleStartDate})`
      );
    }
    if (cfg.dataStartDate > cfg.inSampleEndDate) {
      throw new Error(
        `Date config error: dataStartDate (${cfg.dataStartDate}) is after inSampleEndDate (${cfg.inSampleEndDate})`
      );
    }
    if (cfg.outOfSampleStartDate > cfg.outOfSampleEndDate) {
      throw new Error(
        `Date config error: outOfSampleStartDate (${cfg.outOfSampleStartDate}) is after outOfSampleEndDate (${cfg.outOfSampleEndDate})`
      );
    }
  }

  private errorResult(
    msg: string,
    errors: string[],
    warnings: string[],
    datasets: Map<string, SymbolDataset>,
    rejectedRows: RejectedRow[]
  ): NseImportResult {
    errors.push(msg);
    return { success: false, errors, warnings, metadata: null, datasets, rejectedRows };
  }
}

export const nseHistoricalCsvImporter = new NseHistoricalCsvImporter();
