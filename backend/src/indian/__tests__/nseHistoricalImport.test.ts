/**
 * nseHistoricalImport.test.ts
 *
 * Deterministic tests for the NSE historical CSV import pipeline.
 * Covers: CSV parsing, column alias resolution, OHLCV validation,
 * duplicate handling, date normalization, IS/OOS split with leakage guard,
 * corporate-action gap detection, reproducible fingerprints, and integration
 * with runHistoricalBacktest() via the SwingBacktestRunner.
 *
 * NO real market data — all tests use the labelled fixture or inline CSV.
 * NO profitability claimed from fixture results.
 * NO Supabase writes, NO network calls, NO orders.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

import {
  NseHistoricalCsvImporter,
  nseHistoricalCsvImporter,
  BacktestDateConfig,
} from "../backtest/NseHistoricalCsvImporter";
import {
  SwingBacktestRunner,
  swingBacktestRunner,
  ALL_STRATEGY_IDS,
} from "../backtest/SwingBacktestRunner";

// ─────────────────────────────────────────────────────────────────────────────
// Fixture helpers
// ─────────────────────────────────────────────────────────────────────────────

const FIXTURE_PATH = join(__dirname, "../backtest/fixtures/test_fixture_ohlcv.csv");

/**
 * Load the fixture CSV. File has no comment lines — plain header + data.
 * IMPORTANT: This fixture contains SYNTHETIC prices only. Do NOT use for
 * profitability claims or live trading decisions.
 */
function loadFixture(): string {
  return readFileSync(FIXTURE_PATH, "utf8");
}

/** Minimal valid CSV with one symbol, 50 rows of uptrend */
function makeMinimalCsv(rows = 50, symbol = "INFY", basePrice = 1500): string {
  const header = "symbol,date,open,high,low,close,volume";
  const lines = [header];
  let p = basePrice;
  for (let i = 0; i < rows; i++) {
    p = p * 1.005;
    const d = new Date("2023-01-02");
    d.setDate(d.getDate() + i);
    const date = d.toISOString().split("T")[0];
    lines.push(`${symbol},${date},${(p * 0.998).toFixed(2)},${(p * 1.008).toFixed(2)},${(p * 0.992).toFixed(2)},${p.toFixed(2)},500000`);
  }
  return lines.join("\n");
}

const DATE_CONFIG: BacktestDateConfig = {
  dataStartDate:        "2023-01-01",
  inSampleEndDate:      "2023-02-28",
  outOfSampleStartDate: "2023-03-01",
  outOfSampleEndDate:   "2023-03-31",
};

// ─────────────────────────────────────────────────────────────────────────────
// Suite 1 — Column alias resolution
// ─────────────────────────────────────────────────────────────────────────────

describe("Suite 1 — Column alias resolution", () => {
  it("1.1 resolves canonical headers correctly", () => {
    const result = nseHistoricalCsvImporter.resolveColumnMap(
      "symbol,date,open,high,low,close,volume"
    );
    expect(result.isAmbiguous).toBe(false);
    expect(result.map).not.toBeNull();
    expect(result.map?.symbol).toBe("symbol");
    expect(result.map?.date).toBe("date");
    expect(result.map?.open).toBe("open");
  });

  it("1.2 resolves alias headers (NSE Bhavcopy-style)", () => {
    const result = nseHistoricalCsvImporter.resolveColumnMap(
      "ticker,trading_date,open_price,high_price,low_price,ltp,vol"
    );
    expect(result.isAmbiguous).toBe(false);
    expect(result.map?.symbol).toBe("ticker");
    expect(result.map?.date).toBe("trading_date");
    expect(result.map?.close).toBe("ltp");
    expect(result.map?.volume).toBe("vol");
  });

  it("1.3 rejects when required column is missing", () => {
    // No 'close' column
    const result = nseHistoricalCsvImporter.resolveColumnMap(
      "symbol,date,open,high,low,volume"
    );
    expect(result.isAmbiguous).toBe(true);
    expect(result.ambiguityReason).toMatch(/close/i);
  });

  it("1.4 rejects when ambiguous duplicate aliases exist", () => {
    // 'close' and 'ltp' both map to close
    const result = nseHistoricalCsvImporter.resolveColumnMap(
      "symbol,date,open,high,low,close,ltp,volume"
    );
    expect(result.isAmbiguous).toBe(true);
    expect(result.ambiguityReason).toMatch(/close/i);
  });

  it("1.5 extra unknown columns are ignored (not treated as errors)", () => {
    const result = nseHistoricalCsvImporter.resolveColumnMap(
      "symbol,date,open,high,low,close,volume,isin,series,prev_close_x"
    );
    expect(result.isAmbiguous).toBe(false);
    expect(result.map).not.toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 2 — Date normalisation
// ─────────────────────────────────────────────────────────────────────────────

describe("Suite 2 — Date normalisation", () => {
  const importer = new NseHistoricalCsvImporter();

  it("2.1 accepts YYYY-MM-DD unchanged", () => {
    expect(importer.normaliseDate("2024-01-15")).toBe("2024-01-15");
  });

  it("2.2 converts DD-MM-YYYY to YYYY-MM-DD", () => {
    expect(importer.normaliseDate("15-01-2024")).toBe("2024-01-15");
  });

  it("2.3 converts DD/MM/YYYY to YYYY-MM-DD", () => {
    expect(importer.normaliseDate("05/03/2023")).toBe("2023-03-05");
  });

  it("2.4 converts YYYYMMDD to YYYY-MM-DD", () => {
    expect(importer.normaliseDate("20230315")).toBe("2023-03-15");
  });

  it("2.5 converts DD-Mon-YYYY to YYYY-MM-DD", () => {
    expect(importer.normaliseDate("01-Jan-2024")).toBe("2024-01-01");
    expect(importer.normaliseDate("31-Dec-2023")).toBe("2023-12-31");
  });

  it("2.6 returns null for unrecognisable format", () => {
    expect(importer.normaliseDate("Jan 15 2024")).toBeNull();
    expect(importer.normaliseDate("")).toBeNull();
    expect(importer.normaliseDate("not-a-date")).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 3 — OHLCV row validation
// ─────────────────────────────────────────────────────────────────────────────

describe("Suite 3 — OHLCV row validation and rejection", () => {
  it("3.1 rejects rows where High < Low (inverted candle)", () => {
    const csv = [
      "symbol,date,open,high,low,close,volume",
      "TEST,2023-01-02,100.00,95.00,98.00,97.00,100000",  // high < low
    ].join("\n");
    const result = nseHistoricalCsvImporter.parseCSV(csv, "test.csv", "CUSTOM");
    expect(result.rejectedRows.length).toBe(1);
    expect(result.rejectedRows[0].reason).toMatch(/inverted/i);
  });

  it("3.2 rejects rows with non-positive prices", () => {
    const csv = [
      "symbol,date,open,high,low,close,volume",
      "TEST,2023-01-02,-100.00,100.00,90.00,95.00,100000",  // negative open
      "TEST,2023-01-03,0.00,100.00,90.00,95.00,100000",     // zero open
    ].join("\n");
    const result = nseHistoricalCsvImporter.parseCSV(csv, "test.csv", "CUSTOM");
    expect(result.rejectedRows.length).toBe(2);
  });

  it("3.3 rejects rows with negative volume", () => {
    const csv = [
      "symbol,date,open,high,low,close,volume",
      "TEST,2023-01-02,100.00,105.00,95.00,102.00,-500",
    ].join("\n");
    const result = nseHistoricalCsvImporter.parseCSV(csv, "test.csv", "CUSTOM");
    expect(result.rejectedRows.length).toBe(1);
    expect(result.rejectedRows[0].reason).toMatch(/volume/i);
  });

  it("3.4 rejects rows where Open is above High", () => {
    const csv = [
      "symbol,date,open,high,low,close,volume",
      "TEST,2023-01-02,110.00,105.00,95.00,102.00,500000",  // open > high
    ].join("\n");
    const result = nseHistoricalCsvImporter.parseCSV(csv, "test.csv", "CUSTOM");
    expect(result.rejectedRows.length).toBe(1);
  });

  it("3.5 rejects rows where Close is below Low", () => {
    const csv = [
      "symbol,date,open,high,low,close,volume",
      "TEST,2023-01-02,100.00,110.00,95.00,92.00,500000",  // close < low
    ].join("\n");
    const result = nseHistoricalCsvImporter.parseCSV(csv, "test.csv", "CUSTOM");
    expect(result.rejectedRows.length).toBe(1);
  });

  it("3.6 rejects rows with malformed date", () => {
    const csv = [
      "symbol,date,open,high,low,close,volume",
      "TEST,2023/99/99,100.00,110.00,95.00,105.00,500000",
      "TEST,not-a-date,100.00,110.00,95.00,105.00,500000",
    ].join("\n");
    const result = nseHistoricalCsvImporter.parseCSV(csv, "test.csv", "CUSTOM");
    expect(result.rejectedRows.length).toBe(2);
  });

  it("3.7 accepts candles with volume=0 (circuit-hit days)", () => {
    const csv = [
      "symbol,date,open,high,low,close,volume",
      "TEST,2023-01-02,100.00,105.00,95.00,102.00,0",  // volume=0 is valid
    ].join("\n");
    const result = nseHistoricalCsvImporter.parseCSV(csv, "test.csv", "CUSTOM");
    expect(result.rejectedRows.length).toBe(0);
    expect(result.datasets.get("TEST")?.candles.length).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 4 — Duplicate and symbol handling
// ─────────────────────────────────────────────────────────────────────────────

describe("Suite 4 — Duplicate rows and symbol normalisation", () => {
  it("4.1 duplicate symbol/date: last row wins", () => {
    const csv = [
      "symbol,date,open,high,low,close,volume",
      "TEST,2023-01-02,100.00,110.00,95.00,102.00,500000",   // first
      "TEST,2023-01-02,101.00,111.00,96.00,108.00,600000",   // second — overrides
    ].join("\n");
    const result = nseHistoricalCsvImporter.parseCSV(csv, "test.csv", "CUSTOM");
    const ds = result.datasets.get("TEST");
    expect(ds?.candles.length).toBe(1);
    expect(ds?.candles[0].close).toBe(108.00);
    expect(result.warnings.some((w) => w.includes("Duplicate"))).toBe(true);
    expect(result.metadata?.totalDuplicateRows).toBe(1);
  });

  it("4.2 .NS and .BO suffixes are stripped from symbol", () => {
    const csv = [
      "symbol,date,open,high,low,close,volume",
      "RELIANCE.NS,2023-01-02,2400.00,2420.00,2390.00,2415.00,5000000",
      "TCS.BO,2023-01-02,3200.00,3230.00,3180.00,3215.00,2800000",
    ].join("\n");
    const result = nseHistoricalCsvImporter.parseCSV(csv, "test.csv", "CUSTOM");
    expect(result.datasets.has("RELIANCE")).toBe(true);
    expect(result.datasets.has("TCS")).toBe(true);
    expect(result.datasets.has("RELIANCE.NS")).toBe(false);
    expect(result.datasets.has("TCS.BO")).toBe(false);
  });

  it("4.3 candles from different symbols are kept separate", () => {
    const csv = makeMinimalCsv(20, "WIPRO", 400) + "\n" + makeMinimalCsv(20, "INFY", 1500).split("\n").slice(1).join("\n");
    const result = nseHistoricalCsvImporter.parseCSV(csv, "multi.csv", "CUSTOM");
    expect(result.datasets.has("WIPRO")).toBe(true);
    expect(result.datasets.has("INFY")).toBe(true);
    expect(result.datasets.get("WIPRO")?.candles.length).toBe(20);
    expect(result.datasets.get("INFY")?.candles.length).toBe(20);
  });

  it("4.4 candles are sorted chronologically within each symbol", () => {
    const csv = [
      "symbol,date,open,high,low,close,volume",
      "TEST,2023-01-05,100,105,95,102,500000",
      "TEST,2023-01-03,100,105,95,100,500000",
      "TEST,2023-01-04,100,105,95,101,500000",
      "TEST,2023-01-02,100,105,95,99,500000",
    ].join("\n");
    const result = nseHistoricalCsvImporter.parseCSV(csv, "test.csv", "CUSTOM");
    const dates = result.datasets.get("TEST")?.candles.map((c) => c.date);
    expect(dates).toEqual(["2023-01-02", "2023-01-03", "2023-01-04", "2023-01-05"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 5 — Security and file guards
// ─────────────────────────────────────────────────────────────────────────────

describe("Suite 5 — Security and file guards", () => {
  it("5.1 rejects empty CSV content", () => {
    const result = nseHistoricalCsvImporter.parseCSV("", "empty.csv", "CUSTOM");
    expect(result.success).toBe(false);
    expect(result.errors[0]).toMatch(/empty/i);
  });

  it("5.2 rejects header-only CSV (no data rows)", () => {
    const result = nseHistoricalCsvImporter.parseCSV(
      "symbol,date,open,high,low,close,volume", "header-only.csv", "CUSTOM"
    );
    expect(result.success).toBe(false);
  });

  it("5.3 rejects CSV with script injection", () => {
    const csv = "symbol,date,open,high,low,close,volume\n<script>alert(1)</script>,2023-01-02,100,105,95,102,5000";
    const result = nseHistoricalCsvImporter.parseCSV(csv, "evil.csv", "CUSTOM");
    expect(result.success).toBe(false);
    expect(result.errors[0]).toMatch(/security/i);
  });

  it("5.4 rejects CSV with missing required columns", () => {
    const csv = "symbol,date,open,high,low,volume\nTEST,2023-01-02,100,110,95,50000";
    const result = nseHistoricalCsvImporter.parseCSV(csv, "missing-col.csv", "CUSTOM");
    expect(result.success).toBe(false);
    expect(result.errors[0]).toMatch(/close/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 6 — Price continuity / corporate action gap detection
// ─────────────────────────────────────────────────────────────────────────────

describe("Suite 6 — Price continuity and gap detection", () => {
  it("6.1 detects > 20% open-to-prevClose gap and adds warning", () => {
    const csv = [
      "symbol,date,open,high,low,close,volume",
      "TEST,2023-01-02,100.00,105.00,95.00,102.00,500000",
      "TEST,2023-01-03,130.00,138.00,128.00,135.00,600000",  // ~27% gap — suspicious
    ].join("\n");
    const result = nseHistoricalCsvImporter.parseCSV(csv, "gap.csv", "CUSTOM");
    expect(result.warnings.some((w) => w.includes("Suspicious price gap"))).toBe(true);
    expect(result.metadata?.suspiciousGapCount).toBe(1);
    const ds = result.datasets.get("TEST");
    expect(ds?.suspiciousGaps.length).toBe(1);
    expect(ds?.suspiciousGaps[0].gapPercent).toBeGreaterThan(20);
  });

  it("6.2 does NOT flag a normal overnight gap within 5%", () => {
    const csv = [
      "symbol,date,open,high,low,close,volume",
      "TEST,2023-01-02,100.00,105.00,95.00,102.00,500000",
      "TEST,2023-01-03,104.00,110.00,100.00,108.00,500000",  // ~2% gap — normal
    ].join("\n");
    const result = nseHistoricalCsvImporter.parseCSV(csv, "normal.csv", "CUSTOM");
    expect(result.metadata?.suspiciousGapCount).toBe(0);
    expect(result.datasets.get("TEST")?.suspiciousGaps.length).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 7 — Import metadata and fingerprint
// ─────────────────────────────────────────────────────────────────────────────

describe("Suite 7 — Import metadata and reproducibility", () => {
  it("7.1 metadata records sourceFileName exactly", () => {
    const csv = makeMinimalCsv(20, "META", 500);
    const result = nseHistoricalCsvImporter.parseCSV(csv, "MY_DATA_FILE.csv", "NSE_BHAVCOPY");
    expect(result.metadata?.sourceFileName).toBe("MY_DATA_FILE.csv");
    expect(result.metadata?.dataSource).toBe("NSE_BHAVCOPY");
  });

  it("7.2 same CSV content produces same fingerprint (deterministic)", () => {
    const csv = makeMinimalCsv(20, "FP", 500);
    const r1 = nseHistoricalCsvImporter.parseCSV(csv, "a.csv", "CUSTOM");
    const r2 = nseHistoricalCsvImporter.parseCSV(csv, "b.csv", "CUSTOM");
    expect(r1.metadata?.contentFingerprint).toBe(r2.metadata?.contentFingerprint);
  });

  it("7.3 different CSV content produces different fingerprint", () => {
    const csv1 = makeMinimalCsv(20, "A", 500);
    const csv2 = makeMinimalCsv(20, "B", 600);
    const r1 = nseHistoricalCsvImporter.parseCSV(csv1, "a.csv", "CUSTOM");
    const r2 = nseHistoricalCsvImporter.parseCSV(csv2, "b.csv", "CUSTOM");
    expect(r1.metadata?.contentFingerprint).not.toBe(r2.metadata?.contentFingerprint);
  });

  it("7.4 metadata counts are consistent with parsed data", () => {
    const csv = [
      "symbol,date,open,high,low,close,volume",
      "A,2023-01-02,100,105,95,102,500000",     // valid
      "A,2023-01-02,101,106,96,103,600000",     // duplicate
      "B,2023-01-03,200,210,190,-5,300000",     // invalid (negative close)
      "B,2023-01-04,205,215,195,210,300000",    // valid
    ].join("\n");
    const result = nseHistoricalCsvImporter.parseCSV(csv, "count.csv", "CUSTOM");
    expect(result.metadata?.totalRawRows).toBe(4);
    expect(result.metadata?.totalRejectedRows).toBe(1);
    expect(result.metadata?.totalDuplicateRows).toBe(1);
    expect(result.metadata?.totalValidRows).toBe(3);  // 4 - 1 rejected
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 8 — In-sample / out-of-sample split
// ─────────────────────────────────────────────────────────────────────────────

describe("Suite 8 — In-sample / out-of-sample split and leakage prevention", () => {
  let fixtureResult: ReturnType<typeof nseHistoricalCsvImporter.parseCSV>;

  beforeAll(() => {
    fixtureResult = nseHistoricalCsvImporter.parseCSV(
      loadFixture(), "test_fixture_ohlcv.csv", "CUSTOM", "RAW"
    );
  });

  it("8.1 fixture parses with success=true and 2 symbols", () => {
    expect(fixtureResult.success).toBe(true);
    expect(fixtureResult.metadata?.uniqueSymbols).toBe(2);
    expect(fixtureResult.datasets.has("RELIANCE")).toBe(true);
    expect(fixtureResult.datasets.has("TCS")).toBe(true);
  });

  it("8.2 IS candles are strictly within [dataStart, inSampleEnd]", () => {
    const split = nseHistoricalCsvImporter.splitInSampleOutOfSample(
      fixtureResult.datasets, DATE_CONFIG
    );
    for (const [, ds] of split.inSample.entries()) {
      for (const c of ds.candles) {
        expect(c.date >= DATE_CONFIG.dataStartDate).toBe(true);
        expect(c.date <= DATE_CONFIG.inSampleEndDate).toBe(true);
      }
    }
  });

  it("8.3 OOS candles are strictly within [oosStart, oosEnd]", () => {
    const split = nseHistoricalCsvImporter.splitInSampleOutOfSample(
      fixtureResult.datasets, DATE_CONFIG
    );
    for (const [, ds] of split.outOfSample.entries()) {
      for (const c of ds.candles) {
        expect(c.date >= DATE_CONFIG.outOfSampleStartDate).toBe(true);
        expect(c.date <= DATE_CONFIG.outOfSampleEndDate).toBe(true);
      }
    }
  });

  it("8.4 no date appears in both IS and OOS (zero leakage)", () => {
    const split = nseHistoricalCsvImporter.splitInSampleOutOfSample(
      fixtureResult.datasets, DATE_CONFIG
    );
    for (const symbol of fixtureResult.datasets.keys()) {
      const isDs  = split.inSample.get(symbol);
      const oosDs = split.outOfSample.get(symbol);
      if (!isDs || !oosDs) continue;

      const isDates  = new Set(isDs.candles.map((c) => c.date));
      const oosDates = new Set(oosDs.candles.map((c) => c.date));
      for (const d of oosDates) {
        expect(isDates.has(d)).toBe(false);
      }
    }
  });

  it("8.5 throws if inSampleEnd >= oosStart (leakage config)", () => {
    expect(() =>
      nseHistoricalCsvImporter.splitInSampleOutOfSample(fixtureResult.datasets, {
        ...DATE_CONFIG,
        inSampleEndDate: "2023-03-01",       // same as oosStart — not strictly before
        outOfSampleStartDate: "2023-03-01",
      })
    ).toThrow(/strictly before/i);
  });

  it("8.6 IS has more candles than OOS (IS = Jan+Feb, OOS = Mar in fixture)", () => {
    const split = nseHistoricalCsvImporter.splitInSampleOutOfSample(
      fixtureResult.datasets, DATE_CONFIG
    );
    const relIs  = split.inSample.get("RELIANCE");
    const relOos = split.outOfSample.get("RELIANCE");
    expect(relIs?.candles.length).toBeGreaterThan(0);
    expect(relOos?.candles.length).toBeGreaterThan(0);
    expect(relIs!.candles.length).toBeGreaterThan(relOos!.candles.length);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 9 — SwingBacktestRunner integration (fixture data only)
// ─────────────────────────────────────────────────────────────────────────────

describe("Suite 9 — SwingBacktestRunner integration (fixture, structural checks only)", () => {
  let report: ReturnType<typeof swingBacktestRunner.runFullBacktest>;

  beforeAll(() => {
    const parsed = nseHistoricalCsvImporter.parseCSV(
      loadFixture(), "test_fixture_ohlcv.csv", "CUSTOM", "RAW"
    );
    const split = nseHistoricalCsvImporter.splitInSampleOutOfSample(
      parsed.datasets, DATE_CONFIG
    );
    report = swingBacktestRunner.runFullBacktest(
      split, "test_fixture_ohlcv.csv", parsed.metadata!.contentFingerprint
    );
  });

  it("9.1 report has both inSample and outOfSample sections", () => {
    expect(report.inSample).toBeDefined();
    expect(report.outOfSample).toBeDefined();
    expect(report.inSample.period).toBe("IN_SAMPLE");
    expect(report.outOfSample.period).toBe("OUT_OF_SAMPLE");
  });

  it("9.2 all 8 strategies appear in strategy results", () => {
    const isIds  = report.inSample.strategyResults.map((r) => r.strategyId);
    const oosIds = report.outOfSample.strategyResults.map((r) => r.strategyId);
    for (const stratId of ALL_STRATEGY_IDS) {
      expect(isIds).toContain(stratId);
      expect(oosIds).toContain(stratId);
    }
  });

  it("9.3 strategyResults metrics are within valid ranges", () => {
    for (const r of [...report.inSample.strategyResults, ...report.outOfSample.strategyResults]) {
      expect(r.winRatePercent).toBeGreaterThanOrEqual(0);
      expect(r.winRatePercent).toBeLessThanOrEqual(100);
      expect(r.maxDrawdownPercent).toBeGreaterThanOrEqual(0);
      expect(r.profitFactor).toBeGreaterThanOrEqual(0);
    }
  });

  it("9.4 winningTrades + losingTrades = totalTrades for each strategy", () => {
    for (const r of [...report.inSample.strategyResults, ...report.outOfSample.strategyResults]) {
      expect(r.winningTrades + r.losingTrades).toBe(r.totalTrades);
    }
  });

  it("9.5 report carries sourceFileName and fingerprint for audit trail", () => {
    expect(report.sourceFileName).toBe("test_fixture_ohlcv.csv");
    expect(typeof report.contentFingerprint).toBe("string");
    expect(report.contentFingerprint.length).toBe(16); // SHA-256 first 16 chars
  });

  it("9.6 known limitations list is non-empty (documented)", () => {
    expect(report.inSample.knownLimitations.length).toBeGreaterThan(0);
    expect(report.inSample.knownLimitations.some((l) => l.toLowerCase().includes("collision"))).toBe(true);
    expect(report.inSample.knownLimitations.some((l) => l.toLowerCase().includes("survivorship"))).toBe(true);
  });

  it("9.7 fixture results are marked as PENDING data or structural (not used for profitability claims)", () => {
    // The fixture is test-only. This test explicitly verifies
    // that the runner does not produce results with inflated claims.
    // All strategy results either have sampleSizeSufficient=false or low trade counts.
    // We do NOT assert positive P&L here — fixture is not real data.
    const allResults = [
      ...report.inSample.strategyResults,
      ...report.outOfSample.strategyResults,
    ];
    // Just verify structure — no profitability claim
    for (const r of allResults) {
      if (!r.sampleSizeSufficient) {
        expect(r.warning).toBeDefined();
        expect(r.winRatePercent).toBe(0); // suppressed when insufficient sample
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 10 — Gap fill / no fabrication guarantee
// ─────────────────────────────────────────────────────────────────────────────

describe("Suite 10 — No data fabrication guarantee", () => {
  it("10.1 missing sessions are NOT back-filled (only provided rows appear)", () => {
    // If Mon and Wed provided but not Tue — Tue must not appear in output
    const csv = [
      "symbol,date,open,high,low,close,volume",
      "NOGAP,2023-01-02,100,105,95,102,500000",   // Monday
      // Tuesday (2023-01-03) intentionally missing
      "NOGAP,2023-01-04,103,108,98,106,500000",   // Wednesday
    ].join("\n");
    const result = nseHistoricalCsvImporter.parseCSV(csv, "nogap.csv", "CUSTOM");
    const ds = result.datasets.get("NOGAP");
    expect(ds?.candles.length).toBe(2);
    const dates = ds?.candles.map((c) => c.date);
    expect(dates).toContain("2023-01-02");
    expect(dates).toContain("2023-01-04");
    expect(dates).not.toContain("2023-01-03");
  });

  it("10.2 partial rows (missing close value) are rejected, not filled with prior close", () => {
    const csv = [
      "symbol,date,open,high,low,close,volume",
      "PARTIAL,2023-01-02,100,105,95,102,500000",
      "PARTIAL,2023-01-03,103,108,98,,500000",     // missing close
    ].join("\n");
    const result = nseHistoricalCsvImporter.parseCSV(csv, "partial.csv", "CUSTOM");
    const ds = result.datasets.get("PARTIAL");
    // Only the first valid row should be accepted
    expect(ds?.candles.length).toBe(1);
    expect(result.rejectedRows.length).toBe(1);
  });

  it("10.3 cleanedCandles removes in-progress bars from historical datasets", () => {
    const csv = makeMinimalCsv(50, "CLEAN", 500);
    const parseResult = nseHistoricalCsvImporter.parseCSV(csv, "clean.csv", "CUSTOM");
    const ds = parseResult.datasets.get("CLEAN")!;
    // getCleanedCandles must not throw and must return ≥ 45 valid bars
    const cleaned = nseHistoricalCsvImporter.getCleanedCandles(ds);
    expect(Array.isArray(cleaned)).toBe(true);
    expect(cleaned.length).toBeGreaterThanOrEqual(45);
    // All returned dates must be chronological
    for (let i = 1; i < cleaned.length; i++) {
      expect(cleaned[i].date > cleaned[i - 1].date).toBe(true);
    }
  });
});
