import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { validateOfficialSourceUrl } from "./BseXbrlBackfillService.js";
import type { VerificationStatus } from "./BseXbrlBackfillService.js";

export interface NseShpMasterItem {
  symbol: string;
  name?: string;
  isin?: string | null;
  date: string; // e.g. "30-SEP-2026"
  broadcastDate?: string | null;
  submissionDate?: string | null;
  recordId: string;
  pr_and_prgrp?: string | null;
  public_val?: string | null;
  employeeTrusts?: string | null;
  revisedData?: string | null;
  revisedDate?: string | null;
  xbrl?: string | null;
}

export interface NormalizedShareholdingRecord {
  idempotencyKey: string;
  symbol: string;
  isin: string | null;
  exchange: "NSE" | "BSE";
  reportingQuarter: string; // YYYY-MM-DD
  filingDate: string | null;
  publicationTimestamp: string | null;
  retrievedAt: string;
  filingId: string | null;
  sourceName: string;
  sourceUrl: string;
  extractionVersion: string;
  version: number;
  isRestated: boolean;

  promoterPct: number | null;
  promoterPledgedPct: number | null;
  fiiPct: number | null;
  fpiCat1Pct: number | null;
  fpiCat2Pct: number | null;
  diiPct: number | null;
  mutualFundPct: number | null;
  insurancePct: number | null;
  banksFiPct: number | null;
  governmentPct: number | null;
  publicPct: number | null;
  otherInstitutionalPct: number | null;
  totalReportedPct: number | null;
  isTotalReconciled: boolean;

  fiiQoqChangePp: number | null;
  diiQoqChangePp: number | null;
  mfQoqChangePp: number | null;
  promoterQoqChangePp: number | null;
  pledgeQoqChangePp: number | null;
  fiiYoyChangePp: number | null;
  diiYoyChangePp: number | null;
  mfYoyChangePp: number | null;
  consecutiveFiiAccumQtrs: number;
  consecutiveFiiReduceQtrs: number;
  consecutiveDiiAccumQtrs: number;
  consecutiveDiiReduceQtrs: number;

  rawClassifications: Record<string, number>;
  validationNotes: string[];
  verificationStatus: VerificationStatus;
  hasSourceConflict: boolean;
  confidence: number;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

function parseNseShpDateToIso(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  const ms = Date.parse(trimmed);
  if (Number.isFinite(ms)) {
    return new Date(ms).toISOString().slice(0, 10);
  }
  return null;
}

function parseNseTimestampToIso(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const ms = Date.parse(raw.trim());
  if (Number.isFinite(ms)) {
    return new Date(ms).toISOString();
  }
  return null;
}

export async function fetchNseShareholdingMaster(
  symbol: string,
  options?: { fetchImpl?: typeof fetch; timeoutMs?: number }
): Promise<{ ok: boolean; items: NseShpMasterItem[]; error?: string }> {
  const url = `https://www.nseindia.com/api/corporate-share-holdings-master?index=equities&symbol=${encodeURIComponent(
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
      signal: AbortSignal.timeout(options?.timeoutMs ?? 15_000),
    });
    if (!res.ok) {
      return { ok: false, items: [], error: `NSE SHP HTTP ${res.status}` };
    }
    const json = await res.json();
    if (!Array.isArray(json)) {
      return { ok: false, items: [], error: "Unexpected non-array response from NSE SHP" };
    }
    return { ok: true, items: json as NseShpMasterItem[] };
  } catch (err) {
    return { ok: false, items: [], error: err instanceof Error ? err.message : String(err) };
  }
}

export async function downloadShpXbrlWithCache(
  url: string,
  options?: { cacheDir?: string; fetchImpl?: typeof fetch }
): Promise<{ ok: boolean; cached: boolean; xmlText?: string; error?: string }> {
  const check = validateOfficialSourceUrl(url);
  if (!check.ok) return { ok: false, cached: false, error: check.reason };
  const key = crypto.createHash("sha256").update(url).digest("hex").slice(0, 24);
  const cachePath = options?.cacheDir ? path.join(options.cacheDir, `shp_${key}.xml`) : null;
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
    if (!res.ok) return { ok: false, cached: false, error: `HTTP ${res.status}` };
    const xmlText = await res.text();
    if (!xmlText.includes("<xbrli:xbrl") && !xmlText.includes("<xbrl")) {
      return { ok: false, cached: false, error: "Not valid SHP XBRL XML" };
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

export function parseShareholdingXbrlXml(params: {
  symbol: string;
  isin?: string | null;
  exchange?: "NSE" | "BSE";
  reportingQuarter: string;
  filingDate?: string | null;
  publicationTimestamp?: string | null;
  filingId?: string | null;
  sourceUrl: string;
  xmlText: string;
  masterPromoterPct?: number | null;
  masterPublicPct?: number | null;
  isRestated?: boolean;
  version?: number;
  retrievedAt?: string;
}): NormalizedShareholdingRecord {
  const retrievedAt = params.retrievedAt ?? new Date().toISOString();
  const exchange = params.exchange ?? "NSE";
  const version = params.version ?? 1;
  const symbol = params.symbol.toUpperCase();

  // Map context id -> explicitMember local name
  const ctxMembers = new Map<string, string[]>();
  const ctxRx = /<(?:[a-z0-9_-]+:)?context\b[^>]*\bid=["']([^"']+)["'][^>]*>([\s\S]*?)<\/(?:[a-z0-9_-]+:)?context>/gi;
  let cm: RegExpExecArray | null;
  while ((cm = ctxRx.exec(params.xmlText)) !== null) {
    const members = [...cm[2].matchAll(/<(?:[a-z0-9_-]+:)?explicitMember[^>]*>([^<]+)<\/(?:[a-z0-9_-]+:)?explicitMember>/gi)].map(
      (x) => x[1].trim().replace(/^[^:]+:/, "")
    );
    ctxMembers.set(cm[1], members);
  }

  // Extract ShareholdingAsAPercentageOfTotalNumberOfShares per member
  const rawMemberValues = new Map<string, number>();
  const pctRx =
    /<(?:[a-z0-9_-]+:)?ShareholdingAsAPercentageOfTotalNumberOfShares\b([^>]*)>([^<]+)<\/(?:[a-z0-9_-]+:)?ShareholdingAsAPercentageOfTotalNumberOfShares>/gi;
  let pm: RegExpExecArray | null;
  while ((pm = pctRx.exec(params.xmlText)) !== null) {
    const ctxRefM = /\bcontextRef=["']([^"']+)["']/i.exec(pm[1]);
    if (!ctxRefM) continue;
    const ctxId = ctxRefM[1];
    // Skip individual shareholder line-item contexts (Context15, Context16, etc.)
    if (/Context\d+/i.test(ctxId)) continue;
    const val = Number(pm[2].trim());
    if (!Number.isFinite(val)) continue;
    const members = ctxMembers.get(ctxId) ?? [];
    for (const mem of members) {
      if (!rawMemberValues.has(mem)) {
        rawMemberValues.set(mem, val);
      }
    }
  }

  // Detect whether values are decimal fractions [0..1] or already percentages [0..100]
  const promoterRaw = rawMemberValues.get("ShareholdingOfPromoterAndPromoterGroupMember") ?? null;
  const diiRaw = rawMemberValues.get("InstitutionsDomesticMember") ?? null;
  const fiiRaw = rawMemberValues.get("InstitutionsForeignMember") ?? null;
  const sumRaw = (promoterRaw ?? 0) + (diiRaw ?? 0) + (fiiRaw ?? 0);
  const scale = sumRaw > 0 && sumRaw <= 1.05 ? 100 : 1;

  const getPct = (member: string): number | null => {
    const v = rawMemberValues.get(member);
    return v !== undefined ? round2(v * scale) : null;
  };

  const rawClassifications: Record<string, number> = {};
  for (const [k, v] of rawMemberValues.entries()) {
    rawClassifications[k] = round2(v * scale);
  }

  const promoterPct = getPct("ShareholdingOfPromoterAndPromoterGroupMember") ?? params.masterPromoterPct ?? null;
  const fpiCat1Pct = getPct("InstitutionsForeignPortfolioInvestorCategoryOneMember");
  const fpiCat2Pct = getPct("InstitutionsForeignPortfolioInvestorCategoryTwoMember");
  const fiiPct =
    getPct("InstitutionsForeignMember") ??
    (fpiCat1Pct !== null || fpiCat2Pct !== null
      ? round2((fpiCat1Pct ?? 0) + (fpiCat2Pct ?? 0))
      : null);

  const mutualFundPct = getPct("MutualFundsOrUTIMember");
  const insurancePct = getPct("InsuranceCompaniesMember");
  const banksVal = getPct("BanksMember");
  const nbfcVal = getPct("NBFCsRegisteredWithRBIMember");
  const otherFiVal = getPct("OtherFinancialInstitutionsMember");
  const banksFiPct =
    banksVal !== null || nbfcVal !== null || otherFiVal !== null
      ? round2((banksVal ?? 0) + (nbfcVal ?? 0) + (otherFiVal ?? 0))
      : null;

  // Mutual funds are a sub-component of InstitutionsDomesticMember; never add mutualFundPct on top of diiPct
  const diiPct = getPct("InstitutionsDomesticMember");
  const governmentPct = getPct("GovernmentsMember");
  const aifVal = getPct("AlternativeInvestmentFundsMember");
  const pfVal = getPct("ProvidentFundsOrPensionFundsMember");
  const swfVal = getPct("SovereignWealthFundsDomesticMember");
  const otherInstitutionalPct =
    aifVal !== null || pfVal !== null || swfVal !== null
      ? round2((aifVal ?? 0) + (pfVal ?? 0) + (swfVal ?? 0))
      : null;

  const publicPct =
    getPct("PublicShareholdingMember") ??
    params.masterPublicPct ??
    (promoterPct !== null ? round2(100 - promoterPct) : null);

  // Promoter pledge extraction
  let promoterPledgedPct: number | null = null;
  const pledgePctM =
    /<(?:[a-z0-9_-]+:)?(?:PercentageOfSharesPledgedOrOtherwiseEncumbered|SharesPledgedOrOtherwiseEncumberedAsPercentage)[^>]*>([^<]+)<\/(?:[a-z0-9_-]+:)?(?:PercentageOfSharesPledgedOrOtherwiseEncumbered|SharesPledgedOrOtherwiseEncumberedAsPercentage)>/i.exec(
      params.xmlText
    );
  if (pledgePctM) {
    const pv = Number(pledgePctM[1].trim());
    if (Number.isFinite(pv)) {
      promoterPledgedPct = round2(pv <= 1 ? pv * 100 : pv);
    }
  } else {
    const encumberedBoolM =
      /<(?:[a-z0-9_-]+:)?WhetherAnySharesHeldByPromotersAreEncumberedUnderPledgedForPromoterAndPromoterGroup[^>]*>([^<]+)<\/(?:[a-z0-9_-]+:)?WhetherAnySharesHeldByPromotersAreEncumberedUnderPledgedForPromoterAndPromoterGroup>/i.exec(
        params.xmlText
      );
    if (encumberedBoolM && encumberedBoolM[1].trim().toLowerCase() === "false") {
      promoterPledgedPct = 0;
    }
  }

  const record: NormalizedShareholdingRecord = {
    idempotencyKey: `${symbol}|${exchange}|${params.reportingQuarter}|v${version}`,
    symbol,
    isin: params.isin ?? null,
    exchange,
    reportingQuarter: params.reportingQuarter,
    filingDate: params.filingDate ?? null,
    publicationTimestamp: params.publicationTimestamp ?? null,
    retrievedAt,
    filingId: params.filingId ?? null,
    sourceName: "NSE_BSE_SHP_XBRL",
    sourceUrl: params.sourceUrl,
    extractionVersion: "1.0.0",
    version,
    isRestated: params.isRestated ?? false,
    promoterPct,
    promoterPledgedPct,
    fiiPct,
    fpiCat1Pct,
    fpiCat2Pct,
    diiPct,
    mutualFundPct,
    insurancePct,
    banksFiPct,
    governmentPct,
    publicPct,
    otherInstitutionalPct,
    totalReportedPct:
      promoterPct !== null && publicPct !== null ? round2(promoterPct + publicPct) : null,
    isTotalReconciled: false,
    fiiQoqChangePp: null,
    diiQoqChangePp: null,
    mfQoqChangePp: null,
    promoterQoqChangePp: null,
    pledgeQoqChangePp: null,
    fiiYoyChangePp: null,
    diiYoyChangePp: null,
    mfYoyChangePp: null,
    consecutiveFiiAccumQtrs: 0,
    consecutiveFiiReduceQtrs: 0,
    consecutiveDiiAccumQtrs: 0,
    consecutiveDiiReduceQtrs: 0,
    rawClassifications,
    validationNotes: [],
    verificationStatus: "UNVERIFIED",
    hasSourceConflict: false,
    confidence: 0,
  };

  return validateShareholdingRecord(record);
}

export function validateShareholdingRecord(
  record: NormalizedShareholdingRecord,
  options?: { staleAfterDays?: number; referenceNowMs?: number }
): NormalizedShareholdingRecord {
  const notes: string[] = [...record.validationNotes];
  const pctFields: Array<[string, number | null]> = [
    ["promoterPct", record.promoterPct],
    ["promoterPledgedPct", record.promoterPledgedPct],
    ["fiiPct", record.fiiPct],
    ["diiPct", record.diiPct],
    ["mutualFundPct", record.mutualFundPct],
    ["publicPct", record.publicPct],
  ];

  let outOfRange = false;
  for (const [name, val] of pctFields) {
    if (val !== null && (val < 0 || val > 100)) {
      outOfRange = true;
      notes.push(`Out-of-range percentage for ${name}: ${val}`);
    }
  }

  // Mutual fund vs DII double-count check
  if (record.mutualFundPct !== null && record.diiPct !== null && record.mutualFundPct > record.diiPct + 0.1) {
    notes.push(`Mutual fund (${record.mutualFundPct}%) exceeds DII total (${record.diiPct}%)`);
  }

  // Ownership total reconciliation (promoter + public should be ~100%, allowing employee trusts)
  let isTotalReconciled = false;
  if (record.promoterPct !== null && record.publicPct !== null) {
    const sum = record.promoterPct + record.publicPct;
    if (sum >= 95 && sum <= 100.5) {
      isTotalReconciled = true;
    } else {
      notes.push(`Promoter + Public sum (${round2(sum)}%) outside [95%, 100.5%]`);
    }
  }

  // Filing date vs reporting quarter sanity
  if (record.filingDate && record.reportingQuarter) {
    const qMs = Date.parse(record.reportingQuarter);
    const fMs = Date.parse(record.filingDate);
    if (Number.isFinite(qMs) && Number.isFinite(fMs) && fMs < qMs - 10 * 86400_000) {
      notes.push(`Filing date ${record.filingDate} precedes reporting quarter ${record.reportingQuarter}`);
    }
  }

  // Staleness check
  const staleAfterDays = options?.staleAfterDays ?? 150;
  const nowMs = options?.referenceNowMs ?? Date.now();
  const qMs = Date.parse(record.reportingQuarter);
  const isStale = Number.isFinite(qMs) && (nowMs - qMs) / 86400_000 > staleAfterDays;

  const hasCore =
    record.promoterPct !== null && (record.fiiPct !== null || record.diiPct !== null);

  let status: VerificationStatus;
  if (record.hasSourceConflict) status = "CONFLICTED";
  else if (outOfRange) status = "UNVERIFIED";
  else if (!hasCore) status = "MISSING";
  else if (isStale) status = "STALE";
  else status = "VERIFIED";

  const confidence =
    status === "VERIFIED"
      ? isTotalReconciled
        ? 0.96
        : 0.88
      : status === "STALE"
      ? 0.65
      : status === "CONFLICTED"
      ? 0.25
      : 0.2;

  return {
    ...record,
    isTotalReconciled,
    validationNotes: notes,
    verificationStatus: status,
    confidence,
  };
}

export function detectShareholdingSourceConflict(
  official: NormalizedShareholdingRecord,
  thirdParty: { promoterPct?: number | null; fiiPct?: number | null; diiPct?: number | null; mutualFundPct?: number | null }
): NormalizedShareholdingRecord {
  const conflicts: string[] = [];
  const check = (label: string, a: number | null, b: number | null | undefined) => {
    if (a !== null && b !== null && b !== undefined && Math.abs(a - b) > 1.0) {
      conflicts.push(`${label} conflict: Official ${a}% vs Third-Party ${b}%`);
    }
  };
  check("Promoter", official.promoterPct, thirdParty.promoterPct);
  check("FII", official.fiiPct, thirdParty.fiiPct);
  check("DII", official.diiPct, thirdParty.diiPct);
  check("MutualFund", official.mutualFundPct, thirdParty.mutualFundPct);

  if (conflicts.length === 0) return official;
  return {
    ...official,
    hasSourceConflict: true,
    verificationStatus: "CONFLICTED",
    confidence: 0.2,
    validationNotes: [...official.validationNotes, ...conflicts],
  };
}

/**
 * Computes QoQ, YoY, and consecutive accumulation/reduction streaks across chronologically sorted quarters.
 * Handles restated versions cleanly (picks highest version per quarter for trend comparison without dropping older versions).
 */
export function computeShareholdingTrends(
  records: NormalizedShareholdingRecord[]
): NormalizedShareholdingRecord[] {
  const byQtr = new Map<string, NormalizedShareholdingRecord>();
  for (const r of records) {
    const existing = byQtr.get(r.reportingQuarter);
    if (!existing || r.version > existing.version) {
      byQtr.set(r.reportingQuarter, r);
    }
  }
  const latestPerQtr = [...byQtr.values()].sort((a, b) =>
    a.reportingQuarter.localeCompare(b.reportingQuarter)
  );

  const enrichedLatest = new Map<string, NormalizedShareholdingRecord>();
  let fiiAccum = 0;
  let fiiReduce = 0;
  let diiAccum = 0;
  let diiReduce = 0;

  for (let i = 0; i < latestPerQtr.length; i++) {
    const curr = { ...latestPerQtr[i] };
    const prev = i > 0 ? latestPerQtr[i - 1] : null;
    if (prev) {
      const days = (Date.parse(curr.reportingQuarter) - Date.parse(prev.reportingQuarter)) / 86400_000;
      if (days >= 75 && days <= 115) {
        const diff = (a: number | null, b: number | null) =>
          a !== null && b !== null ? round2(a - b) : null;
        curr.fiiQoqChangePp = diff(curr.fiiPct, prev.fiiPct);
        curr.diiQoqChangePp = diff(curr.diiPct, prev.diiPct);
        curr.mfQoqChangePp = diff(curr.mutualFundPct, prev.mutualFundPct);
        curr.promoterQoqChangePp = diff(curr.promoterPct, prev.promoterPct);
        curr.pledgeQoqChangePp = diff(curr.promoterPledgedPct, prev.promoterPledgedPct);

        if (curr.fiiQoqChangePp !== null) {
          if (curr.fiiQoqChangePp > 0.05) {
            fiiAccum += 1;
            fiiReduce = 0;
          } else if (curr.fiiQoqChangePp < -0.05) {
            fiiReduce += 1;
            fiiAccum = 0;
          } else {
            fiiAccum = 0;
            fiiReduce = 0;
          }
        }
        if (curr.diiQoqChangePp !== null) {
          if (curr.diiQoqChangePp > 0.05) {
            diiAccum += 1;
            diiReduce = 0;
          } else if (curr.diiQoqChangePp < -0.05) {
            diiReduce += 1;
            diiAccum = 0;
          } else {
            diiAccum = 0;
            diiReduce = 0;
          }
        }
      } else {
        fiiAccum = 0;
        fiiReduce = 0;
        diiAccum = 0;
        diiReduce = 0;
      }
    }

    // YoY comparison (~350..380 days prior)
    const yoyMatch = latestPerQtr.find((cand) => {
      const d = (Date.parse(curr.reportingQuarter) - Date.parse(cand.reportingQuarter)) / 86400_000;
      return d >= 350 && d <= 380;
    });
    if (yoyMatch) {
      curr.fiiYoyChangePp =
        curr.fiiPct !== null && yoyMatch.fiiPct !== null ? round2(curr.fiiPct - yoyMatch.fiiPct) : null;
      curr.diiYoyChangePp =
        curr.diiPct !== null && yoyMatch.diiPct !== null ? round2(curr.diiPct - yoyMatch.diiPct) : null;
      curr.mfYoyChangePp =
        curr.mutualFundPct !== null && yoyMatch.mutualFundPct !== null
          ? round2(curr.mutualFundPct - yoyMatch.mutualFundPct)
          : null;
    }

    curr.consecutiveFiiAccumQtrs = fiiAccum;
    curr.consecutiveFiiReduceQtrs = fiiReduce;
    curr.consecutiveDiiAccumQtrs = diiAccum;
    curr.consecutiveDiiReduceQtrs = diiReduce;
    enrichedLatest.set(curr.idempotencyKey, curr);
  }

  return records.map((r) => enrichedLatest.get(r.idempotencyKey) ?? r);
}

export function mapNseMasterItemToHints(item: NseShpMasterItem) {
  return {
    reportingQuarter: parseNseShpDateToIso(item.date) ?? item.date,
    filingDate: parseNseShpDateToIso(item.submissionDate),
    publicationTimestamp: parseNseTimestampToIso(item.broadcastDate),
    masterPromoterPct: item.pr_and_prgrp ? Number(item.pr_and_prgrp) : null,
    masterPublicPct: item.public_val ? Number(item.public_val) : null,
    isRestated: item.revisedData?.toUpperCase() === "Y",
  };
}

export async function persistInstitutionalOwnershipIdempotent(
  supabase: SupabaseClient<any>,
  records: NormalizedShareholdingRecord[]
): Promise<{
  status: "PERSISTED" | "LOCAL_ONLY_NOT_APPLIED_REMOTELY" | "ERROR";
  upsertedCount: number;
  error?: string;
}> {
  if (records.length === 0) return { status: "PERSISTED", upsertedCount: 0 };

  const rows = records.map((r) => ({
    idempotency_key: r.idempotencyKey,
    symbol: r.symbol,
    isin: r.isin,
    exchange: r.exchange,
    reporting_quarter: r.reportingQuarter,
    filing_date: r.filingDate,
    publication_timestamp: r.publicationTimestamp,
    retrieved_at: r.retrievedAt,
    filing_id: r.filingId,
    source_name: r.sourceName,
    source_url: r.sourceUrl,
    extraction_version: r.extractionVersion,
    version: r.version,
    is_restated: r.isRestated,
    promoter_pct: r.promoterPct,
    promoter_pledged_pct: r.promoterPledgedPct,
    fii_pct: r.fiiPct,
    fpi_cat1_pct: r.fpiCat1Pct,
    fpi_cat2_pct: r.fpiCat2Pct,
    dii_pct: r.diiPct,
    mutual_fund_pct: r.mutualFundPct,
    insurance_pct: r.insurancePct,
    banks_fi_pct: r.banksFiPct,
    government_pct: r.governmentPct,
    public_pct: r.publicPct,
    other_institutional_pct: r.otherInstitutionalPct,
    total_reported_pct: r.totalReportedPct,
    is_total_reconciled: r.isTotalReconciled,
    fii_qoq_change_pp: r.fiiQoqChangePp,
    dii_qoq_change_pp: r.diiQoqChangePp,
    mf_qoq_change_pp: r.mfQoqChangePp,
    promoter_qoq_change_pp: r.promoterQoqChangePp,
    pledge_qoq_change_pp: r.pledgeQoqChangePp,
    fii_yoy_change_pp: r.fiiYoyChangePp,
    dii_yoy_change_pp: r.diiYoyChangePp,
    mf_yoy_change_pp: r.mfYoyChangePp,
    consecutive_fii_accum_qtrs: r.consecutiveFiiAccumQtrs,
    consecutive_fii_reduce_qtrs: r.consecutiveFiiReduceQtrs,
    consecutive_dii_accum_qtrs: r.consecutiveDiiAccumQtrs,
    consecutive_dii_reduce_qtrs: r.consecutiveDiiReduceQtrs,
    raw_classifications: r.rawClassifications,
    validation_notes: r.validationNotes,
    verification_status: r.verificationStatus,
    has_source_conflict: r.hasSourceConflict,
    confidence: r.confidence,
    updated_at: new Date().toISOString(),
  }));

  const { error } = await supabase
    .from("strategy03_institutional_ownership")
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

