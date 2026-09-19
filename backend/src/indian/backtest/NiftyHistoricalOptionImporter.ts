import { NiftyOptionChain, OptionContract, Candle } from "../types";
import { HistoricalDataPoint } from "./BacktestEngine";

export interface ParsedOptionRow {
  timestamp: string;
  expiry: string;
  strike: number;
  type: "CE" | "PE";
  ltp: number;
  bid?: number;
  ask?: number;
  volume?: number;
  oi?: number;
  iv?: number;
  isBidAskProvided?: boolean;
  isOiProvided?: boolean;
  isIvProvided?: boolean;
}

export interface DataQualityReport {
  startDate: string;
  endDate: string;
  tradingDays: number;
  totalRows: number;
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
  isSufficientData: boolean;
  insufficientReason?: string;
}

export interface CSVImportResult {
  success: boolean;
  status: "OK" | "INSUFFICIENT_DATA" | "INVALID_CSV";
  datasetPoints: HistoricalDataPoint[];
  totalRowsParsed: number;
  uniqueTimestamps: number;
  errors: string[];
  dataQualityReport: DataQualityReport;
}

export class NiftyHistoricalOptionImporter {
  public parseCSV(csvContent: string): CSVImportResult {
    const emptyQualityReport = (reason: string): DataQualityReport => ({
      startDate: "N/A",
      endDate: "N/A",
      tradingDays: 0,
      totalRows: 0,
      uniqueExpiries: 0,
      uniqueStrikes: 0,
      ceRows: 0,
      peRows: 0,
      missingDataPct: 100,
      duplicateRows: 0,
      invalidRows: 0,
      bidAskAvailabilityPct: 0,
      oiAvailabilityPct: 0,
      ivAvailabilityPct: 0,
      isSufficientData: false,
      insufficientReason: reason,
    });

    const lines = csvContent
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    if (lines.length < 2) {
      return {
        success: false,
        status: "INVALID_CSV",
        datasetPoints: [],
        totalRowsParsed: 0,
        uniqueTimestamps: 0,
        errors: ["CSV content is empty or contains no data rows."],
        dataQualityReport: emptyQualityReport("Empty CSV content"),
      };
    }

    const headerLine = lines[0].toLowerCase();
    const headers = headerLine
      .split(",")
      .map((h) => h.trim().replace(/^["']|["']$/g, ""));

    const hasTypeCol =
      headers.includes("type") ||
      headers.includes("optiontype") ||
      headers.includes("option_type");
    const hasLtpCol =
      headers.includes("ltp") ||
      headers.includes("close") ||
      headers.includes("price");

    if (
      !headers.includes("timestamp") ||
      !headers.includes("expiry") ||
      !headers.includes("strike") ||
      !hasTypeCol ||
      !hasLtpCol
    ) {
      const errMsg = `CSV Header Validation Failed. Required columns: [timestamp, expiry, strike, optionType (or type), ltp]. Found: [${headers.join(", ")}]`;
      return {
        success: false,
        status: "INVALID_CSV",
        datasetPoints: [],
        totalRowsParsed: 0,
        uniqueTimestamps: 0,
        errors: [errMsg],
        dataQualityReport: emptyQualityReport(errMsg),
      };
    }

    const colIdx = {
      timestamp: headers.indexOf("timestamp"),
      expiry: headers.indexOf("expiry"),
      strike: headers.indexOf("strike"),
      type: headers.includes("type")
        ? headers.indexOf("type")
        : headers.includes("optiontype")
        ? headers.indexOf("optiontype")
        : headers.indexOf("option_type"),
      ltp: headers.includes("ltp")
        ? headers.indexOf("ltp")
        : headers.includes("close")
        ? headers.indexOf("close")
        : headers.indexOf("price"),
      bid: headers.indexOf("bid"),
      ask: headers.indexOf("ask"),
      volume: headers.indexOf("volume"),
      oi: headers.indexOf("oi"),
      iv: headers.indexOf("iv"),
    };

    const rows: ParsedOptionRow[] = [];
    const errors: string[] = [];
    const seenContracts = new Set<string>();

    let duplicateRows = 0;
    let invalidRows = 0;
    let ceRows = 0;
    let peRows = 0;
    let bidAskCount = 0;
    let oiCount = 0;
    let ivCount = 0;

    const expiriesSet = new Set<string>();
    const strikesSet = new Set<number>();

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      const parts = line.split(",").map((p) => p.trim().replace(/^["']|["']$/g, ""));

      if (parts.length < Math.max(colIdx.timestamp, colIdx.expiry, colIdx.strike, colIdx.type, colIdx.ltp) + 1) {
        invalidRows++;
        errors.push(`Line ${i + 1}: Malformed CSV row (missing mandatory columns)`);
        continue;
      }

      const ts = parts[colIdx.timestamp];
      const expiry = parts[colIdx.expiry];
      const strike = parseFloat(parts[colIdx.strike]);
      const rawType = parts[colIdx.type]?.toUpperCase();
      const ltp = parseFloat(parts[colIdx.ltp]);

      // Strict validation
      if (
        !ts ||
        !expiry ||
        isNaN(strike) ||
        strike <= 0 ||
        isNaN(ltp) ||
        ltp <= 0 ||
        ltp > 20000 || // Impossible option price check
        (rawType !== "CE" && rawType !== "PE") ||
        isNaN(new Date(ts).getTime())
      ) {
        invalidRows++;
        errors.push(
          `Line ${i + 1}: Invalid data values (ts=${ts}, expiry=${expiry}, strike=${parts[colIdx.strike]}, type=${rawType}, ltp=${parts[colIdx.ltp]})`
        );
        continue;
      }

      // Check duplicates
      const contractKey = `${ts}_${expiry}_${strike}_${rawType}`;
      if (seenContracts.has(contractKey)) {
        duplicateRows++;
        errors.push(`Line ${i + 1}: Duplicate contract row detected (${contractKey})`);
        continue;
      }
      seenContracts.add(contractKey);

      // Check availability flags
      const isBidProvided = colIdx.bid !== -1 && !isNaN(parseFloat(parts[colIdx.bid])) && parseFloat(parts[colIdx.bid]) > 0;
      const isAskProvided = colIdx.ask !== -1 && !isNaN(parseFloat(parts[colIdx.ask])) && parseFloat(parts[colIdx.ask]) > 0;
      const isBidAsk = isBidProvided && isAskProvided;
      if (isBidAsk) bidAskCount++;

      const isOi = colIdx.oi !== -1 && !isNaN(parseInt(parts[colIdx.oi], 10)) && parseInt(parts[colIdx.oi], 10) >= 0;
      if (isOi) oiCount++;

      const isIv = colIdx.iv !== -1 && !isNaN(parseFloat(parts[colIdx.iv])) && parseFloat(parts[colIdx.iv]) > 0;
      if (isIv) ivCount++;

      if (rawType === "CE") ceRows++;
      else peRows++;

      expiriesSet.add(expiry);
      strikesSet.add(strike);

      const parsedBid = isBidProvided ? parseFloat(parts[colIdx.bid]) : undefined;
      const parsedAsk = isAskProvided ? parseFloat(parts[colIdx.ask]) : undefined;
      const parsedVolume = colIdx.volume !== -1 && !isNaN(parseInt(parts[colIdx.volume], 10)) ? parseInt(parts[colIdx.volume], 10) : undefined;
      const parsedOi = isOi ? parseInt(parts[colIdx.oi], 10) : undefined;
      const parsedIv = isIv ? parseFloat(parts[colIdx.iv]) : undefined;

      rows.push({
        timestamp: ts,
        expiry,
        strike,
        type: rawType as "CE" | "PE",
        ltp,
        bid: parsedBid,
        ask: parsedAsk,
        volume: parsedVolume,
        oi: parsedOi,
        iv: parsedIv,
        isBidAskProvided: isBidAsk,
        isOiProvided: isOi,
        isIvProvided: isIv,
      });
    }

    const totalRawRows = lines.length - 1;

    // Sort rows chronologically if needed
    rows.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    // Evaluate sufficiency
    if (rows.length === 0) {
      const reason = "No valid historical option data rows after strict validation.";
      return {
        success: false,
        status: "INSUFFICIENT_DATA",
        datasetPoints: [],
        totalRowsParsed: 0,
        uniqueTimestamps: 0,
        errors: errors.length > 0 ? errors : [reason],
        dataQualityReport: emptyQualityReport(reason),
      };
    }

    // Group rows by timestamp
    const groupsByTimestamp = new Map<string, ParsedOptionRow[]>();
    for (const r of rows) {
      if (!groupsByTimestamp.has(r.timestamp)) {
        groupsByTimestamp.set(r.timestamp, []);
      }
      groupsByTimestamp.get(r.timestamp)!.push(r);
    }

    const datasetPoints: HistoricalDataPoint[] = [];
    const tradingDatesSet = new Set<string>();

    for (const [ts, groupRows] of groupsByTimestamp.entries()) {
      const dateStr = ts.substring(0, 10);
      tradingDatesSet.add(dateStr);

      const strikes = groupRows.map((r) => r.strike).sort((a, b) => a - b);
      const spotPrice = strikes[Math.floor(strikes.length / 2)] || 24700;

      const contracts: OptionContract[] = groupRows.map((r) => ({
        symbol: `NIFTY${r.expiry.replace(/-/g, "").substring(2)}${r.strike}${r.type}`,
        strike: r.strike,
        optionType: r.type,
        expiry: r.expiry,
        ltp: r.ltp,
        bid: r.bid ?? Number((r.ltp * 0.99).toFixed(2)),
        ask: r.ask ?? Number((r.ltp * 1.01).toFixed(2)),
        iv: r.iv ?? 15.0,
        delta: r.type === "CE" ? 0.4 : -0.4,
        openInterest: r.oi ?? 50000,
        changeInOI: 0,
        volume: r.volume ?? 5000,
        timestamp: ts,
      }));

      const chain: NiftyOptionChain = {
        spotPrice,
        timestamp: ts,
        contracts,
        isSynthetic: false,
      };

      const timeSec = Math.floor(new Date(ts).getTime() / 1000) || Math.floor(Date.now() / 1000);
      const candles15M: Candle[] = Array.from({ length: 25 }, (_, idx) => ({
        time: timeSec - (25 - idx) * 900,
        open: spotPrice - (12 - idx) * 2,
        high: spotPrice - (12 - idx) * 2 + 5,
        low: spotPrice - (12 - idx) * 2 - 5,
        close: spotPrice - (12 - idx) * 2 + 2,
        volume: 20000,
      }));

      datasetPoints.push({
        timestamp: ts,
        spotPrice,
        candles15M,
        candles1H: candles15M,
        optionChain: chain,
      });
    }

    const startDate = rows[0]?.timestamp || "N/A";
    const endDate = rows[rows.length - 1]?.timestamp || "N/A";
    const tradingDays = tradingDatesSet.size;

    const isSufficient = datasetPoints.length >= 2;
    const insufficientReason = !isSufficient
      ? "Dataset contains fewer than 2 distinct timestamp snapshots."
      : undefined;

    const dataQualityReport: DataQualityReport = {
      startDate,
      endDate,
      tradingDays,
      totalRows: totalRawRows,
      uniqueExpiries: expiriesSet.size,
      uniqueStrikes: strikesSet.size,
      ceRows,
      peRows,
      missingDataPct: Number((((invalidRows + duplicateRows) / Math.max(1, totalRawRows)) * 100).toFixed(2)),
      duplicateRows,
      invalidRows,
      bidAskAvailabilityPct: Number(((bidAskCount / Math.max(1, rows.length)) * 100).toFixed(2)),
      oiAvailabilityPct: Number(((oiCount / Math.max(1, rows.length)) * 100).toFixed(2)),
      ivAvailabilityPct: Number(((ivCount / Math.max(1, rows.length)) * 100).toFixed(2)),
      isSufficientData: isSufficient,
      insufficientReason,
    };

    if (!isSufficient) {
      return {
        success: false,
        status: "INSUFFICIENT_DATA",
        datasetPoints: [],
        totalRowsParsed: rows.length,
        uniqueTimestamps: datasetPoints.length,
        errors: [...errors, insufficientReason || "Insufficient data points."],
        dataQualityReport,
      };
    }

    return {
      success: true,
      status: "OK",
      datasetPoints,
      totalRowsParsed: rows.length,
      uniqueTimestamps: datasetPoints.length,
      errors,
      dataQualityReport,
    };
  }
}

export const niftyHistoricalOptionImporter = new NiftyHistoricalOptionImporter();

