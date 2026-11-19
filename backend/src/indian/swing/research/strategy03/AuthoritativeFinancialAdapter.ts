import { fetchWithBackoff, isTimestampStale, type Strategy03EvidenceContract } from "./Strategy03DataTypes";

export type StatementScope = "CONSOLIDATED" | "STANDALONE";
export type PeriodType = "Q1" | "Q2" | "Q3" | "Q4" | "ANNUAL";
export type MonetaryUnit = "INR" | "LAKHS" | "CRORES";

export interface OfficialFinancialFilingLink {
  bseCode: string;
  statementScope: StatementScope;
  financialYear: string; // e.g. "2026-2027"
  periodType: PeriodType;
  periodLabel: string; // e.g. "Jun-26"
  filingId: string;
  filingUrl: string;
  retrievedAt: string;
}

export interface NormalizedFinancialStatement {
  symbol: string;
  statementScope: StatementScope;
  periodType: PeriodType;
  reportingPeriod: string; // e.g. "2026-09-30" or "Sep-26"
  version: number;
  isRestated: boolean;
  revenueCr: number | null;
  operatingProfitCr: number | null;
  netProfitCr: number | null;
  epsInr: number | null;
  operatingMarginPct: number | null;
  operatingCashFlowCr: number | null;
  capexCr: number | null;
  freeCashFlowCr: number | null;
  totalDebtCr: number | null;
  totalEquityCr: number | null;
  debtToEquity: number | null;
  roePct: number | null;
  rocePct: number | null;
  evidence: Strategy03EvidenceContract;
}

export function normalizeAmountToCrores(value: number, unit: MonetaryUnit): number {
  if (!Number.isFinite(value)) return NaN;
  if (unit === "CRORES") return Math.round(value * 100) / 100;
  if (unit === "LAKHS") return Math.round((value / 100) * 100) / 100;
  return Math.round((value / 1e7) * 100) / 100; // INR -> Crores
}

/**
 * Parses BSE FinancialResult HTML table to extract official XBRL zip filing links
 * per Financial Year and Q1/Q2/Q3/Q4/Y without fabricating numbers.
 */
export function parseBseFinancialResultIndexHtml(params: {
  bseCode: string;
  html: string;
  statementScope: StatementScope;
  retrievedAt?: string;
}): OfficialFinancialFilingLink[] {
  const retrievedAt = params.retrievedAt ?? new Date().toISOString();
  const links: OfficialFinancialFilingLink[] = [];
  const periodMap: PeriodType[] = ["Q1", "Q2", "Q3", "Q4", "ANNUAL"];

  const trRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let trM: RegExpExecArray | null;
  while ((trM = trRegex.exec(params.html)) !== null) {
    const tds: string[] = [];
    const tdRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    let tdM: RegExpExecArray | null;
    while ((tdM = tdRegex.exec(trM[1])) !== null) {
      tds.push(tdM[1]);
    }
    if (tds.length < 2) continue;
    const fy = tds[0].replace(/<[^>]+>/g, "").trim();
    if (!/^\d{4}-\d{4}$/.test(fy)) continue;

    for (let c = 1; c < Math.min(tds.length, 6); c++) {
      const aM = /href=['"]([^'"]+)['"][^>]*>([^<]+)<\/a>/i.exec(tds[c]);
      if (!aM) continue;
      const rawHref = aM[1].trim();
      const periodLabel = aM[2].trim();
      const filingUrl = rawHref.startsWith("http")
        ? rawHref
        : `https://www.bseindia.com${rawHref.startsWith("/") ? "" : "/"}${rawHref}`;
      const filingId = rawHref.split("/").pop() || `${params.bseCode}_${fy}_${periodMap[c - 1]}`;
      links.push({
        bseCode: params.bseCode,
        statementScope: params.statementScope,
        financialYear: fy,
        periodType: periodMap[c - 1],
        periodLabel,
        filingId,
        filingUrl,
        retrievedAt,
      });
    }
  }
  return links;
}

/**
 * Parses Ind-AS XBRL XML financial statement tags with explicit unit normalization.
 */
export function parseIndAsXbrlFinancialXml(params: {
  symbol: string;
  xmlText: string;
  statementScope: StatementScope;
  periodType: PeriodType;
  reportingPeriod: string;
  publishedAt: string | null;
  filingUrl: string;
  unit?: MonetaryUnit;
  isRestated?: boolean;
  retrievedAt?: string;
}): NormalizedFinancialStatement {
  const retrievedAt = params.retrievedAt ?? new Date().toISOString();
  const unit: MonetaryUnit = params.unit ?? "LAKHS";

  const extractTag = (patterns: string[]): number | null => {
    for (const tag of patterns) {
      const rx = new RegExp(`<(?:[a-z0-9_-]+:)?${tag}[^>]*>\\s*([-+]?\\d+(?:\\.\\d+)?)\\s*<\\/`, "i");
      const m = rx.exec(params.xmlText);
      if (m) {
        const val = Number(m[1]);
        if (Number.isFinite(val)) return val;
      }
    }
    return null;
  };

  const rawRev = extractTag(["RevenueFromOperations", "IncomeFromOperations"]);
  const rawOp = extractTag(["ProfitLossFromOperatingActivities", "ProfitBeforeExceptionalItemsAndTax", "ProfitBeforeTax"]);
  const rawNet = extractTag(["ProfitLossForPeriod", "ProfitLossForThePeriod"]);
  const epsInr = extractTag(["BasicEarningsLossPerShareFromContinuingOperations", "BasicEarningsLossPerShare"]);
  const rawOcf = extractTag(["CashFlowsFromUsedInOperatingActivities"]);
  const rawCapex = extractTag(["PurchaseOfPropertyPlantAndEquipment", "AdditionsToPropertyPlantAndEquipment"]);
  const rawDebt = extractTag(["Borrowings", "TotalBorrowings"]);
  const rawEq = extractTag(["Equity", "TotalEquity"]);

  const toCr = (v: number | null) => (v !== null ? normalizeAmountToCrores(v, unit) : null);
  const revenueCr = toCr(rawRev);
  const operatingProfitCr = toCr(rawOp);
  const netProfitCr = toCr(rawNet);
  const operatingCashFlowCr = toCr(rawOcf);
  const capexCr = rawCapex !== null ? Math.abs(normalizeAmountToCrores(rawCapex, unit)) : null;
  const freeCashFlowCr =
    operatingCashFlowCr !== null && capexCr !== null
      ? Math.round((operatingCashFlowCr - capexCr) * 100) / 100
      : null;
  const totalDebtCr = toCr(rawDebt);
  const totalEquityCr = toCr(rawEq);

  const operatingMarginPct =
    revenueCr !== null && revenueCr > 0 && operatingProfitCr !== null
      ? Math.round((operatingProfitCr / revenueCr) * 10000) / 100
      : null;
  const debtToEquity =
    totalDebtCr !== null && totalEquityCr !== null && totalEquityCr > 0
      ? Math.round((totalDebtCr / totalEquityCr) * 100) / 100
      : null;
  const roePct =
    netProfitCr !== null && totalEquityCr !== null && totalEquityCr > 0
      ? Math.round((netProfitCr / totalEquityCr) * 10000) / 100
      : null;
  const capEmployed =
    totalEquityCr !== null && totalDebtCr !== null ? totalEquityCr + totalDebtCr : null;
  const rocePct =
    operatingProfitCr !== null && capEmployed !== null && capEmployed > 0
      ? Math.round((operatingProfitCr / capEmployed) * 10000) / 100
      : null;

  const isStale = isTimestampStale(params.publishedAt, 150);
  const hasCore = revenueCr !== null && netProfitCr !== null;
  const verificationStatus = !hasCore ? "MISSING" : isStale ? "STALE" : "VERIFIED";

  return {
    symbol: params.symbol.toUpperCase(),
    statementScope: params.statementScope,
    periodType: params.periodType,
    reportingPeriod: params.reportingPeriod,
    version: params.isRestated ? 2 : 1,
    isRestated: Boolean(params.isRestated),
    revenueCr,
    operatingProfitCr,
    netProfitCr,
    epsInr,
    operatingMarginPct,
    operatingCashFlowCr,
    capexCr,
    freeCashFlowCr,
    totalDebtCr,
    totalEquityCr,
    debtToEquity,
    roePct,
    rocePct,
    evidence: {
      sourceName: `BSE Official XBRL Filing (${params.statementScope})`,
      sourceUrlOrFilingId: params.filingUrl,
      reportingPeriod: params.reportingPeriod,
      publishedAt: params.publishedAt,
      retrievedAt,
      verificationStatus,
      confidence: verificationStatus === "VERIFIED" ? 1.0 : 0.3,
      hasSourceConflict: false,
    },
  };
}

/**
 * Checks whether an authoritative exchange filing and a third-party supplement conflict (> 5% diff)
 * or whether quarter sequences are valid & non-duplicate.
 */
export function reconcileFinancialStatements(params: {
  authoritative: NormalizedFinancialStatement;
  thirdParty?: Partial<NormalizedFinancialStatement> | null;
}): {
  statement: NormalizedFinancialStatement;
  conflicts: string[];
} {
  const conflicts: string[] = [];
  const stmt = { ...params.authoritative, evidence: { ...params.authoritative.evidence } };

  if (params.thirdParty) {
    if (
      stmt.revenueCr !== null &&
      params.thirdParty.revenueCr !== null &&
      params.thirdParty.revenueCr !== undefined &&
      stmt.revenueCr > 0
    ) {
      const diffPct = Math.abs(stmt.revenueCr - params.thirdParty.revenueCr) / stmt.revenueCr;
      if (diffPct > 0.05) {
        conflicts.push(
          `Revenue conflict (${stmt.reportingPeriod}): Official ₹${stmt.revenueCr} Cr vs Third-Party ₹${params.thirdParty.revenueCr} Cr.`
        );
      }
    }
    if (
      stmt.netProfitCr !== null &&
      params.thirdParty.netProfitCr !== null &&
      params.thirdParty.netProfitCr !== undefined &&
      Math.abs(stmt.netProfitCr) > 1
    ) {
      const diffPct = Math.abs(stmt.netProfitCr - params.thirdParty.netProfitCr) / Math.abs(stmt.netProfitCr);
      if (diffPct > 0.05) {
        conflicts.push(
          `Net Profit conflict (${stmt.reportingPeriod}): Official ₹${stmt.netProfitCr} Cr vs Third-Party ₹${params.thirdParty.netProfitCr} Cr.`
        );
      }
    }
  }

  if (conflicts.length > 0) {
    stmt.evidence.hasSourceConflict = true;
    stmt.evidence.verificationStatus = "CONFLICTED";
    stmt.evidence.confidence = 0.2;
  }
  return { statement: stmt, conflicts };
}

/**
 * Validates chronological quarter sequence and versions restated filings without overwriting.
 */
export function mergeAndValidateQuarterSequence(
  statements: NormalizedFinancialStatement[]
): {
  merged: NormalizedFinancialStatement[];
  sequenceWarnings: string[];
} {
  const byScopePeriod = new Map<string, NormalizedFinancialStatement[]>();
  for (const s of statements) {
    const key = `${s.symbol}|${s.statementScope}|${s.periodType}|${s.reportingPeriod}`;
    const arr = byScopePeriod.get(key) ?? [];
    const nextVersion = arr.length + 1;
    arr.push({ ...s, version: nextVersion, isRestated: nextVersion > 1 || s.isRestated });
    byScopePeriod.set(key, arr);
  }

  const merged: NormalizedFinancialStatement[] = [];
  for (const arr of byScopePeriod.values()) {
    merged.push(...arr);
  }
  merged.sort((a, b) => a.reportingPeriod.localeCompare(b.reportingPeriod));

  const sequenceWarnings: string[] = [];
  const quarterly = merged.filter((m) => m.periodType !== "ANNUAL");
  for (let i = 1; i < quarterly.length; i++) {
    const prevMs = Date.parse(quarterly[i - 1].reportingPeriod);
    const currMs = Date.parse(quarterly[i].reportingPeriod);
    if (Number.isFinite(prevMs) && Number.isFinite(currMs)) {
      const days = (currMs - prevMs) / 86400_000;
      if (days > 110) {
        sequenceWarnings.push(
          `Missing quarter gap (${Math.round(days)} days) between ${quarterly[i - 1].reportingPeriod} and ${quarterly[i].reportingPeriod}.`
        );
      }
    }
  }
  return { merged, sequenceWarnings };
}

export async function fetchBseOfficialFinancialFilingIndex(
  bseCode: string | null,
  statementScope: StatementScope = "CONSOLIDATED",
  fetchImpl: typeof fetchWithBackoff = fetchWithBackoff
): Promise<{ ok: boolean; links: OfficialFinancialFilingLink[]; error?: string }> {
  if (!bseCode || !/^\d+$/.test(bseCode.trim())) {
    return { ok: false, links: [], error: "Missing numeric BSE code" };
  }
  const typeParam = statementScope === "CONSOLIDATED" ? 1 : 0;
  const url = `https://api.bseindia.com/BseIndiaAPI/api/FinancialResult/w?scripcode=${encodeURIComponent(bseCode.trim())}&type=${typeParam}`;
  try {
    const res = await fetchImpl(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        Referer: "https://www.bseindia.com/",
        Accept: "application/json",
      },
    });
    if (!res.ok) return { ok: false, links: [], error: `HTTP ${res.status}` };
    const json = (await res.json()) as { Data?: string };
    const html = typeof json?.Data === "string" ? json.Data : "";
    const links = parseBseFinancialResultIndexHtml({
      bseCode: bseCode.trim(),
      html,
      statementScope,
    });
    return { ok: true, links };
  } catch (err: any) {
    return { ok: false, links: [], error: err?.message ?? "BSE FinancialResult fetch failed" };
  }
}

