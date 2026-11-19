import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import crypto from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  normalizeAmountToCrores,
  type MonetaryUnit,
  type PeriodType,
  type StatementScope,
} from "./AuthoritativeFinancialAdapter.js";

export type VerificationStatus = "VERIFIED" | "UNVERIFIED" | "MISSING" | "STALE" | "CONFLICTED";

const ALLOWED_OFFICIAL_HOSTS = new Set([
  "www.bseindia.com",
  "api.bseindia.com",
  "www.nseindia.com",
  "nsearchives.nseindia.in",
]);

export type ExtractionMethod =
  | "XBRL_XML"
  | "PDF_ONLY_NO_XML"
  | "OFFICIAL_JSON"
  | "THIRD_PARTY_FALLBACK";

export interface ZipCentralDirEntry {
  name: string;
  compMethod: number;
  compSize: number;
  uncompSize: number;
  localHeaderOffset: number;
}

export interface ExtractedZipFile {
  name: string;
  sizeBytes: number;
  content: Buffer;
}

export interface ZipExtractionResult {
  ok: boolean;
  error?: string;
  totalEntries: number;
  xmlFiles: ExtractedZipFile[];
  pdfFileNames: string[];
  otherFileNames: string[];
  totalExtractedBytes: number;
}

export interface XbrlContextInfo {
  id: string;
  startDate: string | null;
  endDate: string | null;
  instant: string | null;
  hasExplicitMember: boolean;
}

export interface ExtractedFinancialFactRecord {
  idempotencyKey: string;
  symbol: string;
  bseCode: string | null;
  statementScope: StatementScope;
  periodType: PeriodType;
  financialYear: string;
  reportingPeriod: string;
  filingDate: string | null;
  version: number;
  isRestated: boolean;
  isDerivedQuarterly: boolean;

  revenueCr: number | null;
  ebitdaCr: number | null;
  operatingProfitCr: number | null;
  pbtCr: number | null;
  netProfitCr: number | null;
  epsInr: number | null;
  interestExpenseCr: number | null;
  depreciationCr: number | null;
  totalDebtCr: number | null;
  cashAndEquivalentsCr: number | null;
  equityCr: number | null;
  cfoCr: number | null;
  capexCr: number | null;
  fcfCr: number | null;

  sourceName: string;
  sourceFilingId: string | null;
  sourceUrl: string;
  extractedFileName: string | null;
  extractionMethod: ExtractionMethod;
  verificationStatus: VerificationStatus;
  hasSourceConflict: boolean;
  conflictNotes: string[];
  confidence: number;
  rawContextSummary: Record<string, unknown>;
  retrievedAt: string;
}

export function validateOfficialSourceUrl(rawUrl: string): { ok: boolean; reason?: string } {
  try {
    const u = new URL(rawUrl);
    if (u.protocol !== "https:") {
      return { ok: false, reason: `Disallowed protocol: ${u.protocol}` };
    }
    if (!ALLOWED_OFFICIAL_HOSTS.has(u.hostname.toLowerCase())) {
      return { ok: false, reason: `Untrusted host: ${u.hostname}` };
    }
    return { ok: true };
  } catch {
    return { ok: false, reason: "Invalid URL" };
  }
}

export function isSafeZipEntryName(entryName: string): boolean {
  if (!entryName || entryName.includes("\0")) return false;
  if (entryName.startsWith("/") || entryName.startsWith("\\")) return false;
  if (/^[A-Za-z]:/.test(entryName)) return false;
  const normalized = entryName.replace(/\\/g, "/");
  const segments = normalized.split("/");
  if (segments.some((s) => s === "..")) return false;
  return true;
}

/**
 * Pure-Node ZIP Central Directory extractor supporting stored (method 0) and deflate (method 8).
 * Reads Central Directory (0x02014b50) via EOCD (0x06054b50) so bit-3 data-descriptor ZIPs work reliably.
 */
export function extractZipFromBuffer(
  buf: Buffer,
  options?: {
    maxZipBytes?: number;
    maxExtractedBytes?: number;
    maxEntries?: number;
    extractExtensions?: string[];
  }
): ZipExtractionResult {
  const maxZipBytes = options?.maxZipBytes ?? 25 * 1024 * 1024;
  const maxExtractedBytes = options?.maxExtractedBytes ?? 50 * 1024 * 1024;
  const maxEntries = options?.maxEntries ?? 256;
  const extractExtensions = (options?.extractExtensions ?? [".xml", ".xbrl"]).map((e) => e.toLowerCase());

  if (buf.length < 22) {
    return {
      ok: false,
      error: "Malformed archive: buffer smaller than minimum ZIP EOCD (22 bytes)",
      totalEntries: 0,
      xmlFiles: [],
      pdfFileNames: [],
      otherFileNames: [],
      totalExtractedBytes: 0,
    };
  }
  if (buf.length > maxZipBytes) {
    return {
      ok: false,
      error: `ZIP exceeds maxZipBytes (${buf.length} > ${maxZipBytes})`,
      totalEntries: 0,
      xmlFiles: [],
      pdfFileNames: [],
      otherFileNames: [],
      totalExtractedBytes: 0,
    };
  }

  let eocdOffset = -1;
  const minScan = Math.max(0, buf.length - 65558);
  for (let i = buf.length - 22; i >= minScan; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset === -1) {
    return {
      ok: false,
      error: "Malformed ZIP: End of Central Directory (0x06054b50) not found",
      totalEntries: 0,
      xmlFiles: [],
      pdfFileNames: [],
      otherFileNames: [],
      totalExtractedBytes: 0,
    };
  }

  const totalEntries = buf.readUInt16LE(eocdOffset + 10);
  const cdSize = buf.readUInt32LE(eocdOffset + 12);
  const cdOffset = buf.readUInt32LE(eocdOffset + 16);

  if (totalEntries > maxEntries) {
    return {
      ok: false,
      error: `ZIP entry count exceeds maxEntries (${totalEntries} > ${maxEntries})`,
      totalEntries,
      xmlFiles: [],
      pdfFileNames: [],
      otherFileNames: [],
      totalExtractedBytes: 0,
    };
  }
  if (cdOffset + cdSize > buf.length) {
    return {
      ok: false,
      error: "Malformed ZIP: Central Directory bounds exceed buffer length",
      totalEntries,
      xmlFiles: [],
      pdfFileNames: [],
      otherFileNames: [],
      totalExtractedBytes: 0,
    };
  }

  const entries: ZipCentralDirEntry[] = [];
  let ptr = cdOffset;
  while (ptr < cdOffset + cdSize && ptr + 46 <= buf.length) {
    if (buf.readUInt32LE(ptr) !== 0x02014b50) {
      return {
        ok: false,
        error: "Malformed ZIP: invalid Central Directory signature",
        totalEntries,
        xmlFiles: [],
        pdfFileNames: [],
        otherFileNames: [],
        totalExtractedBytes: 0,
      };
    }
    const compMethod = buf.readUInt16LE(ptr + 10);
    const compSize = buf.readUInt32LE(ptr + 20);
    const uncompSize = buf.readUInt32LE(ptr + 24);
    const nameLen = buf.readUInt16LE(ptr + 28);
    const extraLen = buf.readUInt16LE(ptr + 30);
    const commentLen = buf.readUInt16LE(ptr + 32);
    const localHeaderOffset = buf.readUInt32LE(ptr + 42);
    if (ptr + 46 + nameLen > buf.length) {
      return {
        ok: false,
        error: "Malformed ZIP: truncated entry filename",
        totalEntries,
        xmlFiles: [],
        pdfFileNames: [],
        otherFileNames: [],
        totalExtractedBytes: 0,
      };
    }
    const name = buf.subarray(ptr + 46, ptr + 46 + nameLen).toString("utf8");
    if (!isSafeZipEntryName(name)) {
      return {
        ok: false,
        error: `Unsafe ZIP entry path rejected (path traversal protection): ${name}`,
        totalEntries,
        xmlFiles: [],
        pdfFileNames: [],
        otherFileNames: [],
        totalExtractedBytes: 0,
      };
    }
    entries.push({ name, compMethod, compSize, uncompSize, localHeaderOffset });
    ptr += 46 + nameLen + extraLen + commentLen;
  }

  const xmlFiles: ExtractedZipFile[] = [];
  const pdfFileNames: string[] = [];
  const otherFileNames: string[] = [];
  let totalExtractedBytes = 0;

  for (const entry of entries) {
    if (entry.name.endsWith("/")) continue;
    const lower = entry.name.toLowerCase();
    if (lower.endsWith(".pdf")) {
      pdfFileNames.push(entry.name);
      continue;
    }
    const shouldExtract = extractExtensions.some((ext) => lower.endsWith(ext));
    if (!shouldExtract) {
      otherFileNames.push(entry.name);
      continue;
    }

    if (entry.uncompSize > maxExtractedBytes || totalExtractedBytes + entry.uncompSize > maxExtractedBytes) {
      return {
        ok: false,
        error: `Extracted size exceeds maxExtractedBytes (${maxExtractedBytes})`,
        totalEntries,
        xmlFiles,
        pdfFileNames,
        otherFileNames,
        totalExtractedBytes,
      };
    }

    const lfh = entry.localHeaderOffset;
    if (lfh + 30 > buf.length || buf.readUInt32LE(lfh) !== 0x04034b50) {
      return {
        ok: false,
        error: `Malformed ZIP: invalid Local File Header for ${entry.name}`,
        totalEntries,
        xmlFiles,
        pdfFileNames,
        otherFileNames,
        totalExtractedBytes,
      };
    }
    const lfhNameLen = buf.readUInt16LE(lfh + 26);
    const lfhExtraLen = buf.readUInt16LE(lfh + 28);
    const dataStart = lfh + 30 + lfhNameLen + lfhExtraLen;
    const dataEnd = dataStart + entry.compSize;
    if (dataEnd > buf.length) {
      return {
        ok: false,
        error: `Malformed ZIP: compressed payload out of bounds for ${entry.name}`,
        totalEntries,
        xmlFiles,
        pdfFileNames,
        otherFileNames,
        totalExtractedBytes,
      };
    }
    const compressedSlice = buf.subarray(dataStart, dataEnd);
    let content: Buffer;
    try {
      if (entry.compMethod === 0) {
        content = Buffer.from(compressedSlice);
      } else if (entry.compMethod === 8) {
        content = zlib.inflateRawSync(compressedSlice, { maxOutputLength: maxExtractedBytes - totalExtractedBytes });
      } else {
        return {
          ok: false,
          error: `Unsupported ZIP compression method ${entry.compMethod} for ${entry.name}`,
          totalEntries,
          xmlFiles,
          pdfFileNames,
          otherFileNames,
          totalExtractedBytes,
        };
      }
    } catch (err) {
      return {
        ok: false,
        error: `ZIP inflate failed for ${entry.name}: ${err instanceof Error ? err.message : String(err)}`,
        totalEntries,
        xmlFiles,
        pdfFileNames,
        otherFileNames,
        totalExtractedBytes,
      };
    }

    totalExtractedBytes += content.length;
    if (totalExtractedBytes > maxExtractedBytes) {
      return {
        ok: false,
        error: `Actual inflated size exceeds maxExtractedBytes (${maxExtractedBytes})`,
        totalEntries,
        xmlFiles,
        pdfFileNames,
        otherFileNames,
        totalExtractedBytes,
      };
    }
    xmlFiles.push({ name: entry.name, sizeBytes: content.length, content });
  }

  return {
    ok: true,
    totalEntries,
    xmlFiles,
    pdfFileNames,
    otherFileNames,
    totalExtractedBytes,
  };
}

export async function downloadAndExtractBseZip(
  url: string,
  options?: {
    cacheDir?: string;
    timeoutMs?: number;
    maxRetries?: number;
    maxZipBytes?: number;
    maxExtractedBytes?: number;
    fetchImpl?: typeof fetch;
  }
): Promise<{
  ok: boolean;
  cached: boolean;
  httpStatus?: number;
  contentType?: string | null;
  zipBytes?: number;
  extraction?: ZipExtractionResult;
  error?: string;
}> {
  const urlCheck = validateOfficialSourceUrl(url);
  if (!urlCheck.ok) {
    return { ok: false, cached: false, error: urlCheck.reason };
  }

  const cacheDir = options?.cacheDir;
  const maxRetries = options?.maxRetries ?? 2;
  const timeoutMs = options?.timeoutMs ?? 20_000;
  const maxZipBytes = options?.maxZipBytes ?? 25 * 1024 * 1024;
  const fetchFn = options?.fetchImpl ?? fetch;

  const cacheKey = crypto.createHash("sha256").update(url).digest("hex").slice(0, 24);
  const cachePath = cacheDir ? path.join(cacheDir, `${cacheKey}.zip`) : null;

  if (cachePath && fs.existsSync(cachePath)) {
    const buf = fs.readFileSync(cachePath);
    const extraction = extractZipFromBuffer(buf, {
      maxZipBytes,
      maxExtractedBytes: options?.maxExtractedBytes,
    });
    return {
      ok: extraction.ok,
      cached: true,
      httpStatus: 200,
      contentType: "application/zip (cached)",
      zipBytes: buf.length,
      extraction,
      error: extraction.error,
    };
  }

  let lastError = "Unknown download error";
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetchFn(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          Referer: "https://www.bseindia.com/",
        },
        signal: AbortSignal.timeout(timeoutMs),
      });
      const contentType = res.headers.get("content-type");
      if (!res.ok) {
        lastError = `HTTP ${res.status}`;
        if (res.status >= 400 && res.status < 500 && res.status !== 429) {
          return { ok: false, cached: false, httpStatus: res.status, contentType, error: lastError };
        }
        continue;
      }
      if (contentType && /text\/html/i.test(contentType)) {
        return {
          ok: false,
          cached: false,
          httpStatus: res.status,
          contentType,
          error: `Unexpected content-type for ZIP: ${contentType}`,
        };
      }
      const cl = Number(res.headers.get("content-length") ?? "0");
      if (Number.isFinite(cl) && cl > maxZipBytes) {
        return {
          ok: false,
          cached: false,
          httpStatus: res.status,
          contentType,
          error: `Content-Length exceeds maxZipBytes (${cl} > ${maxZipBytes})`,
        };
      }
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > maxZipBytes) {
        return {
          ok: false,
          cached: false,
          httpStatus: res.status,
          contentType,
          zipBytes: buf.length,
          error: `Downloaded ZIP exceeds maxZipBytes (${buf.length} > ${maxZipBytes})`,
        };
      }
      const extraction = extractZipFromBuffer(buf, {
        maxZipBytes,
        maxExtractedBytes: options?.maxExtractedBytes,
      });
      if (extraction.ok && cachePath) {
        fs.mkdirSync(path.dirname(cachePath), { recursive: true });
        fs.writeFileSync(cachePath, buf);
      }
      return {
        ok: extraction.ok,
        cached: false,
        httpStatus: res.status,
        contentType,
        zipBytes: buf.length,
        extraction,
        error: extraction.error,
      };
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }
  return { ok: false, cached: false, error: lastError };
}

function parseXbrlContexts(xmlText: string): Map<string, XbrlContextInfo> {
  const map = new Map<string, XbrlContextInfo>();
  const ctxRx = /<(?:[a-z0-9_-]+:)?context\b[^>]*\bid=["']([^"']+)["'][^>]*>([\s\S]*?)<\/(?:[a-z0-9_-]+:)?context>/gi;
  let m: RegExpExecArray | null;
  while ((m = ctxRx.exec(xmlText)) !== null) {
    const id = m[1];
    const body = m[2];
    const startM = /<(?:[a-z0-9_-]+:)?startDate[^>]*>\s*([^<\s]+)\s*<\/(?:[a-z0-9_-]+:)?startDate>/i.exec(body);
    const endM = /<(?:[a-z0-9_-]+:)?endDate[^>]*>\s*([^<\s]+)\s*<\/(?:[a-z0-9_-]+:)?endDate>/i.exec(body);
    const instM = /<(?:[a-z0-9_-]+:)?instant[^>]*>\s*([^<\s]+)\s*<\/(?:[a-z0-9_-]+:)?instant>/i.exec(body);
    const hasExplicitMember = /explicitMember|typedMember/i.test(body);
    map.set(id, {
      id,
      startDate: startM ? startM[1].trim() : null,
      endDate: endM ? endM[1].trim() : null,
      instant: instM ? instM[1].trim() : null,
      hasExplicitMember,
    });
  }
  return map;
}

function parseXbrlUnits(xmlText: string): Map<string, string> {
  const map = new Map<string, string>();
  const unitRx = /<(?:[a-z0-9_-]+:)?unit\b[^>]*\bid=["']([^"']+)["'][^>]*>([\s\S]*?)<\/(?:[a-z0-9_-]+:)?unit>/gi;
  let m: RegExpExecArray | null;
  while ((m = unitRx.exec(xmlText)) !== null) {
    map.set(m[1], m[2].replace(/\s+/g, " ").trim());
  }
  return map;
}

function extractTextTag(xmlText: string, tagNames: string[]): string | null {
  for (const tag of tagNames) {
    const rx = new RegExp(`<(?:[a-z0-9_-]+:)?${tag}\\b[^>]*>\\s*([^<]+?)\\s*<\\/(?:[a-z0-9_-]+:)?${tag}>`, "i");
    const m = rx.exec(xmlText);
    if (m && m[1].trim()) return m[1].trim();
  }
  return null;
}

function convertXbrlNumericToCrores(
  rawVal: number,
  unitRef: string | null,
  unitsMap: Map<string, string>,
  fallbackUnit: MonetaryUnit
): number {
  const unitBody = unitRef ? unitsMap.get(unitRef) ?? "" : "";
  if (/iso4217:INR/i.test(unitBody) && !/xbrli:shares/i.test(unitBody)) {
    // Standard in-bse-fin XBRL stores monetary values in exact INR (1 Cr = 1e7 INR)
    return Math.round((rawVal / 10_000_000) * 100) / 100;
  }
  if (unitRef && /^inr$/i.test(unitRef) && unitsMap.size === 0) {
    return Math.round((rawVal / 10_000_000) * 100) / 100;
  }
  return normalizeAmountToCrores(rawVal, fallbackUnit);
}

export function extractXbrlFinancialFactsFromXml(params: {
  symbol: string;
  bseCode?: string | null;
  xmlText: string;
  sourceUrl: string;
  sourceFilingId?: string | null;
  extractedFileName?: string | null;
  statementScopeHint?: StatementScope;
  periodTypeHint?: PeriodType;
  financialYearHint?: string;
  reportingPeriodHint?: string;
  filingDate?: string | null;
  fallbackUnit?: MonetaryUnit;
  version?: number;
  isRestated?: boolean;
  retrievedAt?: string;
}): ExtractedFinancialFactRecord {
  const retrievedAt = params.retrievedAt ?? new Date().toISOString();
  const contexts = parseXbrlContexts(params.xmlText);
  const units = parseXbrlUnits(params.xmlText);

  const bseCodeTag = extractTextTag(params.xmlText, ["ScripCode"]);
  const scopeTag = extractTextTag(params.xmlText, ["NatureOfReportStandaloneConsolidated"]);
  const startPeriodTag = extractTextTag(params.xmlText, ["DateOfStartOfReportingPeriod"]);
  const endPeriodTag = extractTextTag(params.xmlText, ["DateOfEndOfReportingPeriod"]);
  const fyStartTag = extractTextTag(params.xmlText, ["DateOfStartOfFinancialYear"]);
  const fyEndTag = extractTextTag(params.xmlText, ["DateOfEndOfFinancialYear"]);
  const quarterTag = extractTextTag(params.xmlText, ["ReportingQuarter"]);
  const roundingTag = extractTextTag(params.xmlText, ["LevelOfRoundingUsedInFinancialStatements"]);

  const statementScope: StatementScope =
    scopeTag && /standalone/i.test(scopeTag)
      ? "STANDALONE"
      : scopeTag && /consolidated/i.test(scopeTag)
      ? "CONSOLIDATED"
      : params.statementScopeHint ?? "CONSOLIDATED";

  const reportingPeriod = endPeriodTag ?? params.reportingPeriodHint ?? new Date().toISOString().slice(0, 10);
  const periodType: PeriodType = (() => {
    if (quarterTag) {
      const q = quarterTag.toLowerCase();
      if (q.includes("first")) return "Q1";
      if (q.includes("second")) return "Q2";
      if (q.includes("third")) return "Q3";
      if (q.includes("fourth")) return "Q4";
      if (q.includes("yearly") || q.includes("annual")) return "ANNUAL";
    }
    return params.periodTypeHint ?? "Q1";
  })();

  const financialYear =
    fyStartTag && fyEndTag
      ? `${fyStartTag.slice(0, 4)}-${fyEndTag.slice(0, 4)}`
      : params.financialYearHint ?? `${reportingPeriod.slice(0, 4)}`;

  const fallbackUnit: MonetaryUnit =
    params.fallbackUnit ??
    (roundingTag && /lakh/i.test(roundingTag)
      ? "LAKHS"
      : roundingTag && /crore/i.test(roundingTag)
      ? "CRORES"
      : "LAKHS");

  const extractNumericFact = (tagNames: string[], kind: "duration" | "instant" | "eps"): number | null => {
    for (const tag of tagNames) {
      const rx = new RegExp(
        `<(?:[a-z0-9_-]+:)?${tag}\\b([^>]*)>([\\s\\S]*?)<\\/(?:[a-z0-9_-]+:)?${tag}>`,
        "gi"
      );
      const candidates: Array<{
        val: number;
        unitRef: string | null;
        score: number;
      }> = [];
      let m: RegExpExecArray | null;
      while ((m = rx.exec(params.xmlText)) !== null) {
        const attrs = m[1];
        if (/xsi:nil\s*=\s*["']true["']/i.test(attrs)) continue;
        const rawStr = m[2].trim();
        if (!rawStr) continue;
        const num = Number(rawStr);
        if (!Number.isFinite(num)) continue;

        const ctxRefM = /\bcontextRef\s*=\s*["']([^"']+)["']/i.exec(attrs);
        const unitRefM = /\bunitRef\s*=\s*["']([^"']+)["']/i.exec(attrs);
        const ctxId = ctxRefM ? ctxRefM[1] : null;
        const unitRef = unitRefM ? unitRefM[1] : null;
        const ctx = ctxId ? contexts.get(ctxId) : undefined;

        if (ctx?.hasExplicitMember) continue; // Skip segment/axis breakdowns

        let score = 1;
        if (ctx) {
          if (kind === "instant" && ctx.instant) {
            score += ctx.instant === reportingPeriod ? 10 : 3;
          } else if (kind !== "instant" && ctx.startDate && ctx.endDate) {
            if (startPeriodTag && endPeriodTag && ctx.startDate === startPeriodTag && ctx.endDate === endPeriodTag) {
              score += 12;
            } else if (ctx.endDate === reportingPeriod) {
              score += 6;
            }
          }
          if (ctxId === "OneD" || ctxId === "OneI") score += 2;
        }
        candidates.push({ val: num, unitRef, score });
      }

      if (candidates.length > 0) {
        candidates.sort((a, b) => b.score - a.score);
        const best = candidates[0];
        if (kind === "eps") {
          return Math.round(best.val * 100) / 100;
        }
        return convertXbrlNumericToCrores(best.val, best.unitRef, units, fallbackUnit);
      }
    }
    return null;
  };

  const revenueCr = extractNumericFact(["RevenueFromOperations", "IncomeFromOperations"], "duration");
  const pbtCr = extractNumericFact(["ProfitBeforeTax", "ProfitBeforeExceptionalItemsAndTax"], "duration");
  const netProfitCr = extractNumericFact(["ProfitLossForPeriod", "ProfitLossForThePeriod"], "duration");
  const epsInr = extractNumericFact(
    ["BasicEarningsLossPerShareFromContinuingOperations", "BasicEarningsLossPerShare"],
    "eps"
  );
  const interestExpenseCr = extractNumericFact(["FinanceCosts", "InterestExpense"], "duration");
  const depreciationCr = extractNumericFact(
    ["DepreciationDepletionAndAmortisationExpense", "DepreciationAndAmortisationExpense"],
    "duration"
  );
  const operatingProfitRaw = extractNumericFact(["ProfitLossFromOperatingActivities"], "duration");
  const operatingProfitCr =
    operatingProfitRaw !== null
      ? operatingProfitRaw
      : pbtCr !== null && interestExpenseCr !== null
      ? Math.round((pbtCr + interestExpenseCr) * 100) / 100
      : null;
  const ebitdaCr =
    operatingProfitCr !== null && depreciationCr !== null
      ? Math.round((operatingProfitCr + depreciationCr) * 100) / 100
      : pbtCr !== null && interestExpenseCr !== null && depreciationCr !== null
      ? Math.round((pbtCr + interestExpenseCr + depreciationCr) * 100) / 100
      : null;

  const directDebt = extractNumericFact(
    ["Borrowings", "TotalBorrowings", "NoncurrentFinancialLiabilitiesBorrowings"],
    "instant"
  );
  const nonCurrentDebt = extractNumericFact(["BorrowingsNoncurrent"], "instant");
  const currentDebt = extractNumericFact(["BorrowingsCurrent"], "instant");
  const totalDebtCr =
    directDebt !== null
      ? directDebt
      : nonCurrentDebt !== null || currentDebt !== null
      ? Math.round(((nonCurrentDebt ?? 0) + (currentDebt ?? 0)) * 100) / 100
      : null;

  const cashAndEquivalentsCr = extractNumericFact(
    ["CashAndCashEquivalents", "CashAndBankBalances"],
    "instant"
  );
  const equityCr = extractNumericFact(["Equity", "TotalEquity", "EquityAttributableToOwnersOfParent"], "instant");
  const cfoCr = extractNumericFact(["CashFlowsFromUsedInOperatingActivities"], "duration");
  const rawCapex = extractNumericFact(
    [
      "PurchaseOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities",
      "PurchaseOfPropertyPlantAndEquipment",
      "AdditionsToPropertyPlantAndEquipment",
    ],
    "duration"
  );
  const capexCr = rawCapex !== null ? Math.abs(rawCapex) : null;
  const fcfCr = cfoCr !== null && capexCr !== null ? Math.round((cfoCr - capexCr) * 100) / 100 : null;

  const hasCore = revenueCr !== null && netProfitCr !== null;
  const verificationStatus: VerificationStatus = hasCore ? "VERIFIED" : "MISSING";
  const version = params.version ?? 1;
  const symbolUpper = params.symbol.toUpperCase();
  const idempotencyKey = `${symbolUpper}|${statementScope}|${periodType}|${reportingPeriod}|v${version}`;

  return {
    idempotencyKey,
    symbol: symbolUpper,
    bseCode: bseCodeTag ?? params.bseCode ?? null,
    statementScope,
    periodType,
    financialYear,
    reportingPeriod,
    filingDate: params.filingDate ?? null,
    version,
    isRestated: params.isRestated ?? false,
    isDerivedQuarterly: false,

    revenueCr,
    ebitdaCr,
    operatingProfitCr,
    pbtCr,
    netProfitCr,
    epsInr,
    interestExpenseCr,
    depreciationCr,
    totalDebtCr,
    cashAndEquivalentsCr,
    equityCr,
    cfoCr,
    capexCr,
    fcfCr,

    sourceName: "NSE_BSE_INDAS_XBRL",
    sourceFilingId: params.sourceFilingId ?? null,
    sourceUrl: params.sourceUrl,
    extractedFileName: params.extractedFileName ?? null,
    extractionMethod: "XBRL_XML",
    verificationStatus,
    hasSourceConflict: false,
    conflictNotes: [],
    confidence: hasCore ? 0.96 : 0.2,
    rawContextSummary: {
      contextCount: contexts.size,
      unitCount: units.size,
      startPeriodTag,
      endPeriodTag,
      quarterTag,
      roundingTag,
    },
    retrievedAt,
  };
}

/**
 * Derives standalone Q4 (or Q2/Q3) from cumulative YTD/Annual minus prior cumulative period.
 */
export function deriveQuarterlyFromYtd(params: {
  cumulativeFact: ExtractedFinancialFactRecord;
  priorCumulativeFact: ExtractedFinancialFactRecord;
  targetPeriodType: PeriodType;
}): ExtractedFinancialFactRecord {
  const { cumulativeFact, priorCumulativeFact, targetPeriodType } = params;
  const sub = (a: number | null, b: number | null) =>
    a !== null && b !== null ? Math.round((a - b) * 100) / 100 : null;

  const revenueCr = sub(cumulativeFact.revenueCr, priorCumulativeFact.revenueCr);
  const pbtCr = sub(cumulativeFact.pbtCr, priorCumulativeFact.pbtCr);
  const netProfitCr = sub(cumulativeFact.netProfitCr, priorCumulativeFact.netProfitCr);
  const interestExpenseCr = sub(cumulativeFact.interestExpenseCr, priorCumulativeFact.interestExpenseCr);
  const depreciationCr = sub(cumulativeFact.depreciationCr, priorCumulativeFact.depreciationCr);
  const operatingProfitCr = sub(cumulativeFact.operatingProfitCr, priorCumulativeFact.operatingProfitCr);
  const ebitdaCr = sub(cumulativeFact.ebitdaCr, priorCumulativeFact.ebitdaCr);
  const epsInr = sub(cumulativeFact.epsInr, priorCumulativeFact.epsInr);

  return {
    ...cumulativeFact,
    idempotencyKey: `${cumulativeFact.symbol}|${cumulativeFact.statementScope}|${targetPeriodType}|${cumulativeFact.reportingPeriod}|v${cumulativeFact.version}`,
    periodType: targetPeriodType,
    isDerivedQuarterly: true,
    revenueCr,
    ebitdaCr,
    operatingProfitCr,
    pbtCr,
    netProfitCr,
    epsInr,
    interestExpenseCr,
    depreciationCr,
    rawContextSummary: {
      ...cumulativeFact.rawContextSummary,
      derivedFrom: cumulativeFact.idempotencyKey,
      subtractedPrior: priorCumulativeFact.idempotencyKey,
    },
  };
}

export interface OfficialNseFilingItem {
  symbol: string;
  companyName: string;
  consolidated: string;
  cumulative: string;
  period: string;
  relatingTo: string;
  financialYear: string;
  fromDate: string;
  toDate: string;
  filingDate: string;
  xbrl: string | null;
  seqNumber: string;
}

function parseNseDateToIso(d: string): string {
  const parsed = Date.parse(d);
  if (Number.isFinite(parsed)) {
    return new Date(parsed).toISOString().slice(0, 10);
  }
  return d;
}

export async function fetchOfficialNseXbrlFilingList(
  symbol: string,
  options?: { period?: "Quarterly" | "Annual"; fetchImpl?: typeof fetch }
): Promise<{ ok: boolean; filings: OfficialNseFilingItem[]; error?: string }> {
  const period = options?.period ?? "Quarterly";
  const url = `https://www.nseindia.com/api/corporates-financial-results?index=equities&symbol=${encodeURIComponent(
    symbol.toUpperCase()
  )}&period=${period}`;
  const fetchFn = options?.fetchImpl ?? fetch;
  try {
    const res = await fetchFn(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        Referer: "https://www.nseindia.com/",
        Accept: "application/json, text/plain, */*",
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      return { ok: false, filings: [], error: `NSE HTTP ${res.status}` };
    }
    const json = await res.json();
    if (!Array.isArray(json)) {
      return { ok: false, filings: [], error: "Unexpected non-array response from NSE" };
    }
    return { ok: true, filings: json as OfficialNseFilingItem[] };
  } catch (err) {
    return { ok: false, filings: [], error: err instanceof Error ? err.message : String(err) };
  }
}

export interface OfficialNseIntegratedFilingItem {
  symbol: string;
  cmName?: string;
  consolidated: string | null;
  type: string | null;
  type_Sub: string | null;
  qe_Date: string | null;
  broadcast_Date: string | null;
  creation_Date: string | null;
  seq_Id: string;
  xbrl: string | null;
}

export async function fetchOfficialNseIntegratedFilingList(
  symbol: string,
  options?: { fetchImpl?: typeof fetch }
): Promise<{ ok: boolean; filings: OfficialNseIntegratedFilingItem[]; error?: string }> {
  const url = `https://www.nseindia.com/api/integrated-filing-results?index=equities&symbol=${encodeURIComponent(
    symbol.toUpperCase()
  )}`;
  const fetchFn = options?.fetchImpl ?? fetch;
  try {
    const res = await fetchFn(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        Referer: "https://www.nseindia.com/",
        Accept: "application/json, text/plain, */*",
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return { ok: false, filings: [], error: `NSE Integrated HTTP ${res.status}` };
    const json = (await res.json()) as { data?: OfficialNseIntegratedFilingItem[] };
    const items = Array.isArray(json?.data) ? json.data : [];
    const finItems = items.filter(
      (i) =>
        Boolean(i.xbrl && i.xbrl.endsWith(".xml")) &&
        (i.type?.toLowerCase().includes("financial") || i.xbrl?.includes("INDAS"))
    );
    return { ok: true, filings: finItems };
  } catch (err) {
    return { ok: false, filings: [], error: err instanceof Error ? err.message : String(err) };
  }
}

export async function downloadXbrlXmlWithCache(
  url: string,
  options?: { cacheDir?: string; fetchImpl?: typeof fetch }
): Promise<{ ok: boolean; cached: boolean; xmlText?: string; error?: string }> {
  const urlCheck = validateOfficialSourceUrl(url);
  if (!urlCheck.ok) {
    return { ok: false, cached: false, error: urlCheck.reason };
  }
  const cacheKey = crypto.createHash("sha256").update(url).digest("hex").slice(0, 24);
  const cachePath = options?.cacheDir ? path.join(options.cacheDir, `${cacheKey}.xml`) : null;
  if (cachePath && fs.existsSync(cachePath)) {
    return { ok: true, cached: true, xmlText: fs.readFileSync(cachePath, "utf8") };
  }
  const fetchFn = options?.fetchImpl ?? fetch;
  try {
    const res = await fetchFn(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        Referer: "https://www.nseindia.com/",
      },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) {
      return { ok: false, cached: false, error: `HTTP ${res.status}` };
    }
    const xmlText = await res.text();
    if (!xmlText.includes("<xbrli:xbrl") && !xmlText.includes("<xbrl")) {
      return { ok: false, cached: false, error: "Response is not valid XBRL XML" };
    }
    if (cachePath) {
      fs.mkdirSync(path.dirname(cachePath), { recursive: true });
      fs.writeFileSync(cachePath, xmlText, "utf8");
    }
    return { ok: true, cached: false, xmlText };
  } catch (err) {
    return { ok: false, cached: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export function mapNseItemMetadataToFactHints(item: OfficialNseFilingItem) {
  const scope: StatementScope =
    item.consolidated && item.consolidated.toLowerCase() === "consolidated" ? "CONSOLIDATED" : "STANDALONE";
  const rel = (item.relatingTo ?? "").toLowerCase();
  const periodType: PeriodType = rel.includes("first")
    ? "Q1"
    : rel.includes("second")
    ? "Q2"
    : rel.includes("third")
    ? "Q3"
    : rel.includes("fourth")
    ? "Q4"
    : "ANNUAL";
  const reportingPeriod = parseNseDateToIso(item.toDate);
  const filingDate = parseNseDateToIso(item.filingDate);
  return {
    statementScope: scope,
    periodType,
    reportingPeriod,
    filingDate,
    financialYear: item.financialYear,
  };
}

export async function persistFinancialFactsIdempotent(
  supabase: SupabaseClient,
  facts: ExtractedFinancialFactRecord[]
): Promise<{
  status: "PERSISTED" | "LOCAL_ONLY_NOT_APPLIED_REMOTELY" | "ERROR";
  upsertedCount: number;
  error?: string;
}> {
  if (facts.length === 0) {
    return { status: "PERSISTED", upsertedCount: 0 };
  }
  const rows = facts.map((f) => ({
    idempotency_key: f.idempotencyKey,
    symbol: f.symbol,
    bse_code: f.bseCode,
    statement_scope: f.statementScope,
    period_type: f.periodType,
    financial_year: f.financialYear,
    reporting_period: f.reportingPeriod,
    filing_date: f.filingDate,
    version: f.version,
    is_restated: f.isRestated,
    is_derived_quarterly: f.isDerivedQuarterly,
    revenue_cr: f.revenueCr,
    ebitda_cr: f.ebitdaCr,
    operating_profit_cr: f.operatingProfitCr,
    pbt_cr: f.pbtCr,
    net_profit_cr: f.netProfitCr,
    eps_inr: f.epsInr,
    interest_expense_cr: f.interestExpenseCr,
    depreciation_cr: f.depreciationCr,
    total_debt_cr: f.totalDebtCr,
    cash_and_equivalents_cr: f.cashAndEquivalentsCr,
    equity_cr: f.equityCr,
    cfo_cr: f.cfoCr,
    capex_cr: f.capexCr,
    fcf_cr: f.fcfCr,
    source_name: f.sourceName,
    source_filing_id: f.sourceFilingId,
    source_url: f.sourceUrl,
    extracted_file_name: f.extractedFileName,
    extraction_method: f.extractionMethod,
    verification_status: f.verificationStatus,
    has_source_conflict: f.hasSourceConflict,
    conflict_notes: f.conflictNotes,
    confidence: f.confidence,
    raw_context_summary: f.rawContextSummary,
    retrieved_at: f.retrievedAt,
    updated_at: new Date().toISOString(),
  }));

  const { error } = await supabase
    .from("strategy03_financial_facts")
    .upsert(rows, { onConflict: "idempotency_key" });

  if (error) {
    if (error.code === "PGRST205" || /could not find the table/i.test(error.message)) {
      return {
        status: "LOCAL_ONLY_NOT_APPLIED_REMOTELY",
        upsertedCount: 0,
        error: `${error.code}: ${error.message}`,
      };
    }
    return { status: "ERROR", upsertedCount: 0, error: `${error.code}: ${error.message}` };
  }

  return { status: "PERSISTED", upsertedCount: rows.length };
}
