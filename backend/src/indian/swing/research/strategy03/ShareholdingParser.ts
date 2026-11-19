import { fetchWithBackoff, type Strategy03EvidenceContract } from "./Strategy03DataTypes";

export interface ShareholdingQuarterRecord {
  symbol: string;
  reportingQuarter: string; // e.g. "Sep 2026"
  version: number;
  promoterPct: number | null;
  fiiPct: number | null;
  diiPct: number | null;
  mutualFundPct: number | null; // explicitly null when undisclosed
  publicPct: number | null;
  promoterPledgedPct: number | null; // explicitly null when undisclosed
  totalReportedPct: number | null;
  isPlausibleSum: boolean;
  evidence: Strategy03EvidenceContract;
}

export interface ShareholdingQoQDiff {
  symbol: string;
  fromQuarter: string;
  toQuarter: string;
  promoterDeltaPct: number | null;
  fiiDeltaPct: number | null;
  diiDeltaPct: number | null;
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
}

function parsePct(raw: string): number | null {
  const cleaned = raw.replace(/[%,\s]/g, "").trim();
  if (!cleaned || cleaned === "-" || cleaned === "NA") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) && n >= 0 && n <= 100 ? Math.round(n * 100) / 100 : null;
}

export function validateShareholdingPlausibility(record: {
  promoterPct: number | null;
  fiiPct: number | null;
  diiPct: number | null;
  publicPct: number | null;
  govtPct?: number | null;
}): { totalReportedPct: number | null; isPlausibleSum: boolean } {
  const parts = [
    record.promoterPct,
    record.fiiPct,
    record.diiPct,
    record.publicPct,
    record.govtPct ?? 0,
  ].filter((x): x is number => x !== null && Number.isFinite(x));
  if (parts.length === 0) return { totalReportedPct: null, isPlausibleSum: false };
  const total = Math.round(parts.reduce((a, b) => a + b, 0) * 100) / 100;
  return { totalReportedPct: total, isPlausibleSum: total >= 95 && total <= 105 };
}

export function parseScreenerShareholdingHtml(params: {
  symbol: string;
  html: string;
  sourceUrl: string;
  retrievedAt?: string;
}): ShareholdingQuarterRecord[] {
  const retrievedAt = params.retrievedAt ?? new Date().toISOString();
  const secMatch = /<section[^>]*id=["']shareholding["'][\s\S]*?<\/section>/i.exec(params.html);
  if (!secMatch) return [];

  const section = secMatch[0];
  const theadMatch = /<thead[\s\S]*?<\/thead>/i.exec(section);
  const tbodyMatch = /<tbody[\s\S]*?<\/tbody>/i.exec(section);
  if (!theadMatch || !tbodyMatch) return [];

  const quarters: string[] = [];
  const thRegex = /<th[^>]*>([\s\S]*?)<\/th>/gi;
  let thM: RegExpExecArray | null;
  while ((thM = thRegex.exec(theadMatch[0])) !== null) {
    quarters.push(stripTags(thM[1]));
  }
  // First column is category label (e.g. "Promoters +" or empty header)
  const quarterLabels = quarters.slice(1).filter(Boolean);
  if (quarterLabels.length === 0) return [];

  const rowValues = new Map<string, Array<number | null>>();
  const trRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let trM: RegExpExecArray | null;
  while ((trM = trRegex.exec(tbodyMatch[0])) !== null) {
    const cells: string[] = [];
    const tdRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    let tdM: RegExpExecArray | null;
    while ((tdM = tdRegex.exec(trM[1])) !== null) {
      cells.push(stripTags(tdM[1]));
    }
    if (cells.length < 2) continue;
    const label = cells[0].toLowerCase().replace(/\+/g, "").trim();
    rowValues.set(
      label,
      cells.slice(1).map((c) => parsePct(c))
    );
  }

  const getRow = (keyMatch: string) => {
    for (const [k, v] of rowValues.entries()) {
      if (k.includes(keyMatch)) return v;
    }
    return null;
  };

  const prom = getRow("promoter");
  const fii = getRow("fii");
  const dii = getRow("dii");
  const pub = getRow("public");
  const govt = getRow("government");
  const mf = getRow("mutual fund");
  const pledge = getRow("pledge");

  const records: ShareholdingQuarterRecord[] = [];
  for (let i = 0; i < quarterLabels.length; i++) {
    const qtr = quarterLabels[i];
    const promoterPct = prom?.[i] ?? null;
    const fiiPct = fii?.[i] ?? null;
    const diiPct = dii?.[i] ?? null;
    const publicPct = pub?.[i] ?? null;
    const govtPct = govt?.[i] ?? 0;
    const mutualFundPct = mf?.[i] ?? null;
    const promoterPledgedPct = pledge?.[i] ?? null;

    const { totalReportedPct, isPlausibleSum } = validateShareholdingPlausibility({
      promoterPct,
      fiiPct,
      diiPct,
      publicPct,
      govtPct,
    });

    records.push({
      symbol: params.symbol.toUpperCase(),
      reportingQuarter: qtr,
      version: 1,
      promoterPct,
      fiiPct,
      diiPct,
      mutualFundPct,
      publicPct,
      promoterPledgedPct,
      totalReportedPct,
      isPlausibleSum,
      evidence: {
        sourceName: "Screener.in (Third-Party Aggregator - Not Direct Exchange Filing)",
        sourceUrlOrFilingId: params.sourceUrl,
        reportingPeriod: qtr,
        publishedAt: null,
        retrievedAt,
        verificationStatus: isPlausibleSum ? "UNVERIFIED" : "CONFLICTED",
        confidence: isPlausibleSum ? 0.75 : 0.3,
        hasSourceConflict: !isPlausibleSum,
      },
    });
  }

  return records;
}

/**
 * Preserves historical quarters and versions restated/corrected filings without overwriting.
 */
export function mergeShareholdingHistory(
  existing: ShareholdingQuarterRecord[],
  incoming: ShareholdingQuarterRecord[]
): ShareholdingQuarterRecord[] {
  const out = [...existing];
  for (const rec of incoming) {
    const sameQuarter = out.filter(
      (e) => e.symbol === rec.symbol && e.reportingQuarter === rec.reportingQuarter
    );
    if (sameQuarter.length === 0) {
      out.push({ ...rec, version: 1 });
      continue;
    }
    const latest = sameQuarter.reduce((a, b) => (b.version > a.version ? b : a));
    const changed =
      latest.promoterPct !== rec.promoterPct ||
      latest.fiiPct !== rec.fiiPct ||
      latest.diiPct !== rec.diiPct ||
      latest.publicPct !== rec.publicPct ||
      latest.promoterPledgedPct !== rec.promoterPledgedPct;
    if (changed) {
      out.push({ ...rec, version: latest.version + 1 });
    }
  }
  return out;
}

export function computeShareholdingQoQDiff(
  prev: ShareholdingQuarterRecord,
  curr: ShareholdingQuarterRecord
): ShareholdingQoQDiff {
  const delta = (a: number | null, b: number | null) =>
    a !== null && b !== null ? Math.round((b - a) * 100) / 100 : null;
  return {
    symbol: curr.symbol,
    fromQuarter: prev.reportingQuarter,
    toQuarter: curr.reportingQuarter,
    promoterDeltaPct: delta(prev.promoterPct, curr.promoterPct),
    fiiDeltaPct: delta(prev.fiiPct, curr.fiiPct),
    diiDeltaPct: delta(prev.diiPct, curr.diiPct),
  };
}

export async function fetchStockShareholdingHistory(
  symbol: string,
  fetchImpl: typeof fetchWithBackoff = fetchWithBackoff
): Promise<{ ok: boolean; records: ShareholdingQuarterRecord[]; error?: string }> {
  const clean = symbol.trim().toUpperCase();
  const urls = [
    `https://www.screener.in/company/${encodeURIComponent(clean)}/consolidated/`,
    `https://www.screener.in/company/${encodeURIComponent(clean)}/`,
  ];
  for (const url of urls) {
    try {
      const res = await fetchImpl(url, {
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
      });
      if (!res.ok) continue;
      const html = await res.text();
      const records = parseScreenerShareholdingHtml({ symbol: clean, html, sourceUrl: url });
      if (records.length > 0) return { ok: true, records };
    } catch (err: any) {
      return { ok: false, records: [], error: err?.message ?? "Shareholding fetch failed" };
    }
  }
  return { ok: false, records: [], error: "No shareholding table found" };
}
