import {
  fetchWithBackoff,
  isTimestampStale,
  type Strategy03EvidenceContract,
} from "./Strategy03DataTypes";

export type AnnouncementCategory =
  | "ORDER_WIN"
  | "ORDER_BOOK"
  | "CAPACITY_EXPANSION"
  | "CAPEX"
  | "ACQUISITION"
  | "PRODUCT_LAUNCH"
  | "GUIDANCE"
  | "MATERIAL_CONTRACT"
  | "OTHER";

export interface CorporateAnnouncementRecord {
  exchange: "NSE" | "BSE";
  filingId: string;
  symbol: string;
  companyName: string | null;
  category: AnnouncementCategory;
  headline: string;
  extractedText: string | null;
  extractionStatus: "EXTRACTED" | "PDF_ATTACHMENT_ONLY" | "FAILED";
  extractionConfidence: number;
  isAmbiguous: boolean;
  evidence: Strategy03EvidenceContract;
}

export function classifyAnnouncementCategory(text: string): {
  category: AnnouncementCategory;
  confidence: number;
  isAmbiguous: boolean;
} {
  const u = text.toUpperCase();
  if (/ORDER BOOK|UNEXECUTED ORDER/.test(u)) return { category: "ORDER_BOOK", confidence: 0.85, isAmbiguous: false };
  if (/AWARD OF ORDER|BAG(GED|S)? ORDER|WORK ORDER|RECEIPT OF ORDER|LETTER OF AWARD|\bLOA\b/.test(u)) {
    return { category: "ORDER_WIN", confidence: 0.9, isAmbiguous: false };
  }
  if (/CAPACITY EXPANSION|NEW PLANT|COMMISSION(ING|ED)|GREENFIELD|BROWNFIELD/.test(u)) {
    return { category: "CAPACITY_EXPANSION", confidence: 0.85, isAmbiguous: false };
  }
  if (/CAPITAL EXPENDITURE|\bCAPEX\b/.test(u)) return { category: "CAPEX", confidence: 0.85, isAmbiguous: false };
  if (/ACQUISITION|ACQUIRE|MERGER|STAKE/.test(u)) return { category: "ACQUISITION", confidence: 0.8, isAmbiguous: false };
  if (/LAUNCH OF|NEW PRODUCT/.test(u)) return { category: "PRODUCT_LAUNCH", confidence: 0.8, isAmbiguous: false };
  if (/GUIDANCE|OUTLOOK/.test(u)) return { category: "GUIDANCE", confidence: 0.7, isAmbiguous: true };
  if (/MATERIAL CONTRACT|AGREEMENT|MOU/.test(u)) return { category: "MATERIAL_CONTRACT", confidence: 0.7, isAmbiguous: true };
  return { category: "OTHER", confidence: 0.5, isAmbiguous: true };
}

export function parseBseAnnouncementsResponse(params: {
  symbol: string;
  companyName: string | null;
  rows: Array<Record<string, unknown>>;
  retrievedAt?: string;
  maxAgeDays?: number;
}): { records: CorporateAnnouncementRecord[]; duplicateCount: number; staleCount: number } {
  const retrievedAt = params.retrievedAt ?? new Date().toISOString();
  const maxAgeDays = params.maxAgeDays ?? 180;
  const seen = new Set<string>();
  const records: CorporateAnnouncementRecord[] = [];
  let duplicateCount = 0;
  let staleCount = 0;

  for (const row of params.rows) {
    const headline = String(row.HEADLINE || row.NEWSSUB || "").trim();
    if (!headline) continue;
    const rawDt =
      (typeof row.DissemDT === "string" && row.DissemDT) ||
      (typeof row.News_submission_dt === "string" && row.News_submission_dt) ||
      (typeof row.DT_TM === "string" && row.DT_TM) ||
      null;
    const publishedAt =
      rawDt && Number.isFinite(Date.parse(rawDt)) ? new Date(rawDt).toISOString() : null;

    if (isTimestampStale(publishedAt, maxAgeDays)) {
      staleCount += 1;
      continue;
    }

    const newsId = String(row.NEWSID || row.ATTACHMENTNAME || `${headline.slice(0, 48)}_${publishedAt ?? ""}`);
    if (seen.has(newsId)) {
      duplicateCount += 1;
      continue;
    }
    seen.add(newsId);

    const hasAttachment =
      typeof row.ATTACHMENTNAME === "string" && row.ATTACHMENTNAME.trim().length > 0;
    const attachUrl = hasAttachment
      ? `https://www.bseindia.com/xml-data/corpfiling/AttachLive/${String(row.ATTACHMENTNAME).trim()}`
      : typeof row.NSURL === "string" && row.NSURL.trim()
        ? row.NSURL.trim()
        : "https://www.bseindia.com/corporates/ann.html";

    const extractedText = typeof row.MORE === "string" && row.MORE.trim() ? row.MORE.trim() : null;
    const extractionStatus: CorporateAnnouncementRecord["extractionStatus"] = extractedText
      ? "EXTRACTED"
      : hasAttachment
        ? "PDF_ATTACHMENT_ONLY"
        : "FAILED";
    const cls = classifyAnnouncementCategory(`${headline} ${extractedText ?? ""}`);
    const isMaterialGrowth =
      cls.category === "ORDER_WIN" ||
      cls.category === "ORDER_BOOK" ||
      cls.category === "CAPEX" ||
      cls.category === "CAPACITY_EXPANSION";
    const verifiedFiling = Boolean(publishedAt) && (hasAttachment || extractedText !== null);
    const verificationStatus =
      isMaterialGrowth && !hasAttachment
        ? "UNVERIFIED"
        : verifiedFiling
          ? "VERIFIED"
          : "UNVERIFIED";

    records.push({
      exchange: "BSE",
      filingId: newsId,
      symbol: params.symbol.toUpperCase(),
      companyName: params.companyName,
      category: cls.category,
      headline,
      extractedText: extractedText ?? headline,
      extractionStatus,
      extractionConfidence: cls.confidence,
      isAmbiguous: cls.isAmbiguous,
      evidence: {
        sourceName: "BSE Official Corporate Announcements",
        sourceUrlOrFilingId: attachUrl,
        reportingPeriod: publishedAt ? publishedAt.slice(0, 10) : "UNKNOWN",
        publishedAt,
        retrievedAt,
        verificationStatus,
        confidence: cls.confidence,
        hasSourceConflict: false,
      },
    });
  }

  return { records, duplicateCount, staleCount };
}

export async function fetchBseCorporateAnnouncements(params: {
  symbol: string;
  companyName: string | null;
  bseCode: string | null;
  lookbackDays?: number;
  fetchImpl?: typeof fetchWithBackoff;
}): Promise<{ ok: boolean; records: CorporateAnnouncementRecord[]; error?: string }> {
  if (!params.bseCode || !/^\d+$/.test(params.bseCode.trim())) {
    return { ok: false, records: [], error: "Missing numeric BSE code" };
  }
  const fetchImpl = params.fetchImpl ?? fetchWithBackoff;
  const now = new Date();
  const toDate = now.toISOString().slice(0, 10).replace(/-/g, "");
  const fromDate = new Date(now.getTime() - (params.lookbackDays ?? 90) * 86400_000)
    .toISOString()
    .slice(0, 10)
    .replace(/-/g, "");

  const url =
    `https://api.bseindia.com/BseIndiaAPI/api/AnnSubCategoryGetData/w` +
    `?pageno=1&strCat=-1&strPrevDate=${fromDate}&strScrip=${encodeURIComponent(params.bseCode.trim())}` +
    `&strSearch=P&strToDate=${toDate}&strType=C&subcategory=-1`;

  try {
    const res = await fetchImpl(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        Referer: "https://www.bseindia.com/",
        Accept: "application/json",
      },
    });
    if (!res.ok) return { ok: false, records: [], error: `HTTP ${res.status}` };
    const json = (await res.json()) as { Table?: Array<Record<string, unknown>> };
    const rows = Array.isArray(json?.Table) ? json.Table : [];
    const parsed = parseBseAnnouncementsResponse({
      symbol: params.symbol,
      companyName: params.companyName,
      rows,
    });
    return { ok: true, records: parsed.records };
  } catch (err: any) {
    return { ok: false, records: [], error: err?.message ?? "BSE announcements fetch failed" };
  }
}

