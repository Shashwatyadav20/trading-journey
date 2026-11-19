import { fetchWithBackoff, type Strategy03EvidenceContract } from "./Strategy03DataTypes";
import { parseNseDateToIso } from "./NseDeliveryCollector";

export interface BulkBlockDealRecord {
  exchange: "NSE" | "BSE";
  dealType: "BULK" | "BLOCK";
  tradingDate: string;
  symbol: string;
  securityName: string | null;
  clientName: string;
  clientCategory: "UNKNOWN" | "INSTITUTIONAL_FUND" | "CORPORATE_OR_INDIVIDUAL";
  side: "BUY" | "SELL";
  quantity: number;
  price: number;
  remarks: string | null;
  evidence: Strategy03EvidenceContract;
}

export interface RepeatedDealPattern {
  symbol: string;
  side: "BUY" | "SELL";
  dealCount: number;
  totalQuantity: number;
  distinctClients: string[];
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      out.push(cur.trim());
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur.trim());
  return out;
}

function classifyClientCategory(clientName: string): BulkBlockDealRecord["clientCategory"] {
  const u = clientName.toUpperCase();
  if (
    /\b(MUTUAL FUND|MF|FII|FPI|FUND|ASSET MANAGEMENT|AMC|INSURANCE|PENSION|GOLDMAN|MORGAN STANLEY|FIDELITY|VANGUARD|BLACKROCK|SBI|HDFC|ICICI|NIPPON|KOTAK)\b/.test(
      u
    )
  ) {
    return "INSTITUTIONAL_FUND";
  }
  return "UNKNOWN";
}

export function parseNseBulkBlockCsv(params: {
  csvText: string;
  dealType: "BULK" | "BLOCK";
  sourceUrl: string;
  retrievedAt?: string;
}): { records: BulkBlockDealRecord[]; rejectedRows: number; duplicateRows: number } {
  const retrievedAt = params.retrievedAt ?? new Date().toISOString();
  const lines = params.csvText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) return { records: [], rejectedRows: 0, duplicateRows: 0 };

  const seen = new Set<string>();
  const records: BulkBlockDealRecord[] = [];
  let rejectedRows = 0;
  let duplicateRows = 0;

  for (let i = 1; i < lines.length; i++) {
    if (lines[i].toUpperCase().startsWith("NO RECORDS")) continue;
    const cols = splitCsvLine(lines[i]);
    if (cols.length < 7) {
      rejectedRows += 1;
      continue;
    }
    const tradingDate = parseNseDateToIso(cols[0]);
    const symbol = (cols[1] || "").toUpperCase();
    const securityName = cols[2] || null;
    const clientName = cols[3] || "DISCLOSED_UNKNOWN";
    const rawSide = (cols[4] || "").toUpperCase();
    const side: "BUY" | "SELL" | null =
      rawSide === "BUY" ? "BUY" : rawSide === "SELL" ? "SELL" : null;
    const quantity = Number((cols[5] || "").replace(/,/g, ""));
    const price = Number((cols[6] || "").replace(/,/g, ""));
    const remarks = cols[7] || null;

    if (!tradingDate || !symbol || !side || !Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(price) || price <= 0) {
      rejectedRows += 1;
      continue;
    }

    const dedupeKey = `NSE|${params.dealType}|${tradingDate}|${symbol}|${clientName}|${side}|${quantity}|${price}`;
    if (seen.has(dedupeKey)) {
      duplicateRows += 1;
      continue;
    }
    seen.add(dedupeKey);

    records.push({
      exchange: "NSE",
      dealType: params.dealType,
      tradingDate,
      symbol,
      securityName,
      clientName,
      clientCategory: classifyClientCategory(clientName),
      side,
      quantity,
      price,
      remarks,
      evidence: {
        sourceName: `NSE Official ${params.dealType} Deals`,
        sourceUrlOrFilingId: params.sourceUrl,
        reportingPeriod: tradingDate,
        publishedAt: `${tradingDate}T18:30:00+05:30`,
        retrievedAt,
        verificationStatus: "VERIFIED",
        confidence: 1.0,
        hasSourceConflict: false,
      },
    });
  }

  return { records, rejectedRows, duplicateRows };
}

/**
 * Detects repeated buying/selling patterns ONLY when >= 2 verified disclosures exist.
 */
export function detectRepeatedDealPatterns(
  deals: BulkBlockDealRecord[],
  minDeals = 2
): RepeatedDealPattern[] {
  const verified = deals.filter((d) => d.evidence.verificationStatus === "VERIFIED");
  const groups = new Map<string, BulkBlockDealRecord[]>();
  for (const d of verified) {
    const k = `${d.symbol}|${d.side}`;
    const arr = groups.get(k);
    if (arr) arr.push(d);
    else groups.set(k, [d]);
  }
  const patterns: RepeatedDealPattern[] = [];
  for (const [k, arr] of groups.entries()) {
    if (arr.length >= minDeals) {
      const [symbol, side] = k.split("|") as [string, "BUY" | "SELL"];
      patterns.push({
        symbol,
        side,
        dealCount: arr.length,
        totalQuantity: arr.reduce((s, x) => s + x.quantity, 0),
        distinctClients: Array.from(new Set(arr.map((x) => x.clientName))),
      });
    }
  }
  return patterns;
}

export async function fetchNseBulkAndBlockDeals(
  fetchImpl: typeof fetchWithBackoff = fetchWithBackoff
): Promise<{
  ok: boolean;
  records: BulkBlockDealRecord[];
  errors: string[];
}> {
  const urls: Array<{ type: "BULK" | "BLOCK"; url: string }> = [
    { type: "BULK", url: "https://nsearchives.nseindia.com/content/equities/bulk.csv" },
    { type: "BLOCK", url: "https://nsearchives.nseindia.com/content/equities/block.csv" },
  ];
  const records: BulkBlockDealRecord[] = [];
  const errors: string[] = [];
  for (const item of urls) {
    try {
      const res = await fetchImpl(item.url, {
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
      });
      if (!res.ok) {
        errors.push(`${item.type}: HTTP ${res.status}`);
        continue;
      }
      const text = await res.text();
      const parsed = parseNseBulkBlockCsv({ csvText: text, dealType: item.type, sourceUrl: item.url });
      records.push(...parsed.records);
    } catch (err: any) {
      errors.push(`${item.type}: ${err?.message ?? "fetch failed"}`);
    }
  }
  return { ok: errors.length < urls.length, records, errors };
}

