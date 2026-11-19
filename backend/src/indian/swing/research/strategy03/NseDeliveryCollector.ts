import { fetchWithBackoff, type Strategy03EvidenceContract } from "./Strategy03DataTypes";

export interface NseDeliveryRecord {
  symbol: string;
  series: string;
  tradingDate: string; // YYYY-MM-DD
  closePrice: number | null;
  tradedQty: number;
  deliveryQty: number | null; // NEVER substituted with tradedQty
  deliveryPct: number | null;
  turnoverLacs: number | null;
  evidence: Strategy03EvidenceContract;
}

const MONTH_MAP: Record<string, string> = {
  JAN: "01", FEB: "02", MAR: "03", APR: "04", MAY: "05", JUN: "06",
  JUL: "07", AUG: "08", SEP: "09", OCT: "10", NOV: "11", DEC: "12",
};

export function parseNseDateToIso(raw: string): string | null {
  const clean = raw.trim().toUpperCase();
  const m = /^(\d{2})-([A-Z]{3})-(\d{4})$/.exec(clean);
  if (!m) return null;
  const mon = MONTH_MAP[m[2]];
  if (!mon) return null;
  return `${m[3]}-${mon}-${m[1]}`;
}

export function formatNseFileDate(isoDate: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate.trim());
  if (!m) return null;
  return `${m[3]}${m[2]}${m[1]}`; // DDMMYYYY
}

export function parseNseSecBhavdataCsv(
  csvText: string,
  sourceUrl: string,
  retrievedAt: string = new Date().toISOString()
): { records: NseDeliveryRecord[]; rejectedRows: number; duplicateRows: number } {
  const lines = csvText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) return { records: [], rejectedRows: 0, duplicateRows: 0 };

  const header = lines[0].split(",").map((h) => h.trim().toUpperCase());
  const idx = (name: string) => header.indexOf(name);
  const iSym = idx("SYMBOL");
  const iSer = idx("SERIES");
  const iDate = idx("DATE1");
  const iClose = idx("CLOSE_PRICE");
  const iTraded = idx("TTL_TRD_QNTY");
  const iTurn = idx("TURNOVER_LACS");
  const iDelivQty = idx("DELIV_QTY");
  const iDelivPct = idx("DELIV_PER");

  if (iSym === -1 || iSer === -1 || iDate === -1 || iTraded === -1) {
    return { records: [], rejectedRows: lines.length - 1, duplicateRows: 0 };
  }

  const seenKeys = new Set<string>();
  const records: NseDeliveryRecord[] = [];
  let rejectedRows = 0;
  let duplicateRows = 0;

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",").map((c) => c.trim());
    if (cols.length < header.length - 1) {
      rejectedRows += 1;
      continue;
    }
    const symbol = (cols[iSym] || "").toUpperCase();
    const series = (cols[iSer] || "").toUpperCase();
    const tradingDate = parseNseDateToIso(cols[iDate] || "");
    const tradedQty = Number(cols[iTraded]);
    if (!symbol || !series || !tradingDate || !Number.isFinite(tradedQty) || tradedQty < 0) {
      rejectedRows += 1;
      continue;
    }

    const dedupeKey = `${symbol}|${series}|${tradingDate}`;
    if (seenKeys.has(dedupeKey)) {
      duplicateRows += 1;
      continue;
    }
    seenKeys.add(dedupeKey);

    const rawClose = iClose !== -1 ? Number(cols[iClose]) : NaN;
    const closePrice = Number.isFinite(rawClose) && rawClose > 0 ? rawClose : null;
    const rawTurn = iTurn !== -1 ? Number(cols[iTurn]) : NaN;
    const turnoverLacs = Number.isFinite(rawTurn) && rawTurn >= 0 ? rawTurn : null;

    // Never substitute tradedQty for missing deliveryQty
    const rawDeliv = iDelivQty !== -1 ? cols[iDelivQty] : "";
    const parsedDeliv = rawDeliv && rawDeliv !== "-" ? Number(rawDeliv) : NaN;
    const deliveryQty = Number.isFinite(parsedDeliv) && parsedDeliv >= 0 ? parsedDeliv : null;

    const rawDelivPct = iDelivPct !== -1 ? cols[iDelivPct] : "";
    const parsedDelivPct = rawDelivPct && rawDelivPct !== "-" ? Number(rawDelivPct) : NaN;
    const validDelivPct =
      Number.isFinite(parsedDelivPct) && parsedDelivPct >= 0 && parsedDelivPct <= 100
        ? parsedDelivPct
        : null;
    const impossibleDelivPct =
      Number.isFinite(parsedDelivPct) && (parsedDelivPct < 0 || parsedDelivPct > 100);
    const qtyConflict = deliveryQty !== null && deliveryQty > tradedQty;

    const verificationStatus =
      qtyConflict || impossibleDelivPct
        ? "CONFLICTED"
        : tradedQty === 0 || deliveryQty === null
          ? "MISSING"
          : "VERIFIED";

    records.push({
      symbol,
      series,
      tradingDate,
      closePrice,
      tradedQty,
      deliveryQty,
      deliveryPct: validDelivPct,
      turnoverLacs,
      evidence: {
        sourceName: "NSE Official Equity Bhavcopy & Delivery",
        sourceUrlOrFilingId: sourceUrl,
        reportingPeriod: tradingDate,
        publishedAt: `${tradingDate}T18:30:00+05:30`,
        retrievedAt,
        verificationStatus,
        confidence: verificationStatus === "VERIFIED" ? 1.0 : 0.3,
        hasSourceConflict: qtyConflict || impossibleDelivPct,
      },
    });
  }

  return { records, rejectedRows, duplicateRows };
}

export async function fetchNseDeliveryForDate(
  isoDate: string,
  fetchImpl: typeof fetchWithBackoff = fetchWithBackoff
): Promise<{
  ok: boolean;
  sourceUrl: string;
  records: NseDeliveryRecord[];
  rejectedRows: number;
  duplicateRows: number;
  error?: string;
}> {
  const ddmmyyyy = formatNseFileDate(isoDate);
  if (!ddmmyyyy) {
    return { ok: false, sourceUrl: "", records: [], rejectedRows: 0, duplicateRows: 0, error: "Invalid ISO date" };
  }
  const sourceUrl = `https://nsearchives.nseindia.com/products/content/sec_bhavdata_full_${ddmmyyyy}.csv`;
  try {
    const res = await fetchImpl(sourceUrl, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
    });
    if (!res.ok) {
      return { ok: false, sourceUrl, records: [], rejectedRows: 0, duplicateRows: 0, error: `HTTP ${res.status}` };
    }
    const text = await res.text();
    const parsed = parseNseSecBhavdataCsv(text, sourceUrl);
    return { ok: true, sourceUrl, ...parsed };
  } catch (err: any) {
    return {
      ok: false,
      sourceUrl,
      records: [],
      rejectedRows: 0,
      duplicateRows: 0,
      error: err?.message ?? "NSE delivery fetch failed",
    };
  }
}

