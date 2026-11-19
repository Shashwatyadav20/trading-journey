import fs from "node:fs";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { VerificationStatus } from "./BseXbrlBackfillService.js";

export type MaterialAnnouncementCategory =
  | "ORDER_WIN"
  | "ORDER_CANCELLATION"
  | "CAPACITY_EXPANSION"
  | "NEW_PLANT_PRODUCTION"
  | "ACQUISITION_MERGER_DEMERGER"
  | "MANAGEMENT_GUIDANCE"
  | "REGULATORY_DISCLOSURE"
  | "EARNINGS_RESULT"
  | "PROMOTER_DISCLOSURE"
  | "OTHER_UPDATE";

export interface RawNseAnnouncementItem {
  symbol: string;
  sm_name?: string;
  sm_isin?: string;
  seq_id: string;
  desc?: string;
  attchmntText?: string;
  attchmntFile?: string;
  an_dt?: string;
  sort_date?: string;
  exchdisstime?: string;
}

export interface ClassifiedAnnouncementRecord {
  exchange: "NSE";
  filingId: string;
  symbol: string;
  companyName: string | null;
  category: MaterialAnnouncementCategory;
  headline: string;
  extractedText: string | null;
  sourceUrl: string;
  publishedAt: string | null;
  retrievedAt: string;
  verificationStatus: VerificationStatus;
  extractionConfidence: number;
  isAmbiguous: boolean;
  hasSourceConflict: boolean;
}

const CATEGORY_RULES: Array<{ category: MaterialAnnouncementCategory; pattern: RegExp }> = [
  { category: "ORDER_CANCELLATION", pattern: /\b(cancel(?:lation|led)? of order|terminat(?:ed|ion) of contract)\b/i },
  { category: "ORDER_WIN", pattern: /\b(order win|bagged|awarded contract|letter of award|purchase order|work order|lo[ai])\b/i },
  { category: "NEW_PLANT_PRODUCTION", pattern: /\b(commercial production|commissioned|new plant|greenfield|brownfield|commencement of production)\b/i },
  { category: "CAPACITY_EXPANSION", pattern: /\b(capacity expansion|capex|capital expenditure|debottlenecking|expansion project)\b/i },
  { category: "ACQUISITION_MERGER_DEMERGER", pattern: /\b(acqui(?:sition|red)|merger|demerger|amalgamation|scheme of arrangement|joint venture|stake sale)\b/i },
  { category: "MANAGEMENT_GUIDANCE", pattern: /\b(guidance|outlook|revenue target|investor presentation|earnings call|concall)\b/i },
  { category: "EARNINGS_RESULT", pattern: /\b(financial results|unaudited|audited|outcome of board meeting|quarterly results)\b/i },
  { category: "PROMOTER_DISCLOSURE", pattern: /\b(promoter|sast|insider trading|pledge|encumbrance|reclassification)\b/i },
  { category: "REGULATORY_DISCLOSURE", pattern: /\b(sebi|rbi|show cause|penalty|regulatory|clarification|inspection)\b/i },
];

export function classifyAnnouncementDeterministically(
  item: RawNseAnnouncementItem,
  retrievedAt = new Date().toISOString()
): ClassifiedAnnouncementRecord {
  const headline = (item.desc ?? "Corporate Announcement").trim();
  const body = (item.attchmntText ?? "").trim();
  const combined = `${headline} ${body}`;

  let category: MaterialAnnouncementCategory = "OTHER_UPDATE";
  let matchedCount = 0;
  for (const rule of CATEGORY_RULES) {
    if (rule.pattern.test(combined)) {
      if (matchedCount === 0) category = rule.category;
      matchedCount += 1;
    }
  }

  const rawDate = item.sort_date ?? item.an_dt ?? item.exchdisstime ?? null;
  const parsedMs = rawDate ? Date.parse(rawDate) : NaN;
  const publishedAt = Number.isFinite(parsedMs) ? new Date(parsedMs).toISOString() : null;
  const sourceUrl =
    item.attchmntFile && item.attchmntFile.startsWith("https://")
      ? item.attchmntFile
      : `https://www.nseindia.com/companies-listing/corporate-filings-announcements?symbol=${encodeURIComponent(
          item.symbol
        )}`;

  const hasValidFiling = Boolean(item.seq_id && publishedAt);
  const isAmbiguous = matchedCount > 1 || (category === "OTHER_UPDATE" && body.length < 20);
  const verificationStatus: VerificationStatus = !hasValidFiling
    ? "MISSING"
    : matchedCount === 0
    ? "UNVERIFIED"
    : "VERIFIED";

  return {
    exchange: "NSE",
    filingId: String(item.seq_id),
    symbol: item.symbol.toUpperCase(),
    companyName: item.sm_name ?? null,
    category,
    headline: headline.slice(0, 240),
    extractedText: body ? body.slice(0, 2000) : null,
    sourceUrl,
    publishedAt,
    retrievedAt,
    verificationStatus,
    extractionConfidence: verificationStatus === "VERIFIED" ? (isAmbiguous ? 0.75 : 0.92) : 0.4,
    isAmbiguous,
    hasSourceConflict: false,
  };
}

export async function fetchNseCorporateAnnouncements(
  symbol: string,
  options?: { cacheDir?: string; fetchImpl?: typeof fetch }
): Promise<{ ok: boolean; items: RawNseAnnouncementItem[]; error?: string }> {
  const sym = symbol.toUpperCase();
  const cachePath = options?.cacheDir ? path.join(options.cacheDir, `ann_${sym}.json`) : null;
  if (cachePath && fs.existsSync(cachePath)) {
    return { ok: true, items: JSON.parse(fs.readFileSync(cachePath, "utf8")) as RawNseAnnouncementItem[] };
  }

  const url = `https://www.nseindia.com/api/corporate-announcements?index=equities&symbol=${encodeURIComponent(sym)}`;
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
    if (!res.ok) return { ok: false, items: [], error: `NSE Ann HTTP ${res.status}` };
    const json = await res.json();
    if (!Array.isArray(json)) return { ok: false, items: [], error: "Non-array response" };
    if (cachePath) {
      fs.mkdirSync(path.dirname(cachePath), { recursive: true });
      fs.writeFileSync(cachePath, JSON.stringify(json));
    }
    return { ok: true, items: json as RawNseAnnouncementItem[] };
  } catch (err) {
    return { ok: false, items: [], error: err instanceof Error ? err.message : String(err) };
  }
}

export async function persistCorporateAnnouncementsIdempotent(
  supabase: SupabaseClient<any>,
  records: ClassifiedAnnouncementRecord[]
): Promise<{ status: "PERSISTED" | "ERROR"; upsertedCount: number; error?: string }> {
  if (records.length === 0) return { status: "PERSISTED", upsertedCount: 0 };
  const rows = records.map((r) => ({
    exchange: r.exchange,
    filing_id: r.filingId,
    symbol: r.symbol,
    company_name: r.companyName,
    category: r.category,
    headline: r.headline,
    extracted_text: r.extractedText,
    source_url: r.sourceUrl,
    published_at: r.publishedAt,
    retrieved_at: r.retrievedAt,
    verification_status: r.verificationStatus,
    extraction_confidence: r.extractionConfidence,
    is_ambiguous: r.isAmbiguous,
    has_source_conflict: r.hasSourceConflict,
  }));

  const { error } = await supabase
    .from("strategy03_corporate_announcements")
    .upsert(rows, { onConflict: "exchange,filing_id" });

  if (error) {
    return { status: "ERROR", upsertedCount: 0, error: `${error.code}: ${error.message}` };
  }
  return { status: "PERSISTED", upsertedCount: rows.length };
}

