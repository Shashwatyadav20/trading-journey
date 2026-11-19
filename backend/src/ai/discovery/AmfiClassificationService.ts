import type { MarketCapCategory } from "./MarketUniverseService";

export interface OfficialAmfiRecord {
  isin: string;
  symbol?: string | null;
  companyName: string;
  amfiRank: number;
  amfiCategory: Exclude<MarketCapCategory, "UNCLASSIFIED">;
  sixMonthAvgMarketCapCr: number | null;
  classificationPeriod: string;
  publicationDate: string;
  source: string;
}

export interface AmfiDatasetMetadata {
  classificationPeriod: string | null;
  publicationDate: string | null;
  source: string;
  totalSourceRows: number;
  totalOfficialRecords: number;
  duplicateIsinCount: number;
  rejectedRowCount: number;
  officialCategoryCounts: {
    largeCap: number;
    midCap: number;
    smallCap: number;
  };
  lastLoadedAt: string | null;
  limitations: string[];
}

function normalizeIsin(isin: string | null | undefined): string | null {
  if (!isin || typeof isin !== "string") return null;
  const clean = isin.trim().toUpperCase();
  return /^IN[E0-9A-Z]{10}$/.test(clean) ? clean : null;
}

export function mapAmfiRankToCategory(
  rank: number
): Exclude<MarketCapCategory, "UNCLASSIFIED"> {
  if (rank <= 100) return "LARGE_CAP";
  if (rank <= 250) return "MID_CAP";
  return "SMALL_CAP";
}

function splitCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

export interface ParsedAmfiCsvResult {
  records: OfficialAmfiRecord[];
  totalSourceRows: number;
  duplicateIsinCount: number;
  rejectedRowCount: number;
}

export function parseAmfiCsvDetailed(
  csvText: string,
  params: { classificationPeriod: string; publicationDate: string; source?: string }
): ParsedAmfiCsvResult {
  const lines = csvText.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) {
    return { records: [], totalSourceRows: 0, duplicateIsinCount: 0, rejectedRowCount: 0 };
  }

  // Find header row (contains ISIN)
  let startIdx = 0;
  for (let i = 0; i < Math.min(lines.length, 5); i++) {
    if (/\bISIN\b/i.test(lines[i])) {
      startIdx = i + 1;
      break;
    }
  }
  if (startIdx === 0) startIdx = 1;

  const seenIsins = new Set<string>();
  const records: OfficialAmfiRecord[] = [];
  let totalSourceRows = 0;
  let duplicateIsinCount = 0;
  let rejectedRowCount = 0;

  for (let i = startIdx; i < lines.length; i++) {
    const cols = splitCsvLine(lines[i]);
    if (cols.length < 3) {
      rejectedRowCount += 1;
      continue;
    }
    totalSourceRows += 1;

    const isinCol = cols.find((c) => /^IN[E0-9A-Z]{10}$/i.test(c));
    const isin = normalizeIsin(isinCol);
    if (!isin) {
      rejectedRowCount += 1;
      continue;
    }
    if (seenIsins.has(isin)) {
      duplicateIsinCount += 1;
      continue;
    }
    seenIsins.add(isin);

    const rankCandidate = Number(cols[0]);
    const rank =
      Number.isFinite(rankCandidate) && rankCandidate > 0
        ? Math.floor(rankCandidate)
        : records.length + 1;

    const lastCol = (cols[cols.length - 1] ?? "").toUpperCase();
    const amfiCategory: Exclude<MarketCapCategory, "UNCLASSIFIED"> =
      lastCol.includes("LARGE CAP")
        ? "LARGE_CAP"
        : lastCol.includes("MID CAP")
          ? "MID_CAP"
          : lastCol.includes("SMALL CAP")
            ? "SMALL_CAP"
            : mapAmfiRankToCategory(rank);

    // Official AMFI Average of All Exchanges (Rs. Cr.) is column 9 (or fallback numeric col)
    const avgExchNum = Number((cols[9] ?? "").replace(/,/g, ""));
    const avgCap =
      Number.isFinite(avgExchNum) && avgExchNum > 0
        ? avgExchNum
        : cols
            .slice(1)
            .map((c) => Number(c.replace(/,/g, "")))
            .find((n) => Number.isFinite(n) && n > 0) ?? null;

    const nseSym = cols[5] && cols[5] !== "-" ? cols[5].trim() : null;
    const bseSym = cols[3] && cols[3] !== "-" ? cols[3].trim() : null;

    records.push({
      isin,
      symbol: nseSym || bseSym,
      companyName: cols[1] || isin,
      amfiRank: rank,
      amfiCategory,
      sixMonthAvgMarketCapCr: avgCap,
      classificationPeriod: params.classificationPeriod,
      publicationDate: params.publicationDate,
      source:
        params.source ??
        "AMFI Official Categorization (6-Month Avg Full Market Cap)",
    });
  }

  return { records, totalSourceRows, duplicateIsinCount, rejectedRowCount };
}

export function parseAmfiCsvText(
  csvText: string,
  params: { classificationPeriod: string; publicationDate: string; source?: string }
): OfficialAmfiRecord[] {
  return parseAmfiCsvDetailed(csvText, params).records;
}

export class AmfiClassificationService {
  private byIsin = new Map<string, OfficialAmfiRecord>();
  private metadata: AmfiDatasetMetadata = {
    classificationPeriod: null,
    publicationDate: null,
    source: "AMFI Official Categorization (Not Loaded)",
    totalSourceRows: 0,
    totalOfficialRecords: 0,
    duplicateIsinCount: 0,
    rejectedRowCount: 0,
    officialCategoryCounts: { largeCap: 0, midCap: 0, smallCap: 0 },
    lastLoadedAt: null,
    limitations: [
      "Official AMFI categorization dataset has not been loaded yet; AMFI classification remains UNCLASSIFIED until official ISIN match is available.",
    ],
  };

  public ingestOfficialAmfiRecords(params: {
    records: OfficialAmfiRecord[];
    classificationPeriod: string;
    publicationDate: string;
    source?: string;
    loadedAt?: string;
    totalSourceRows?: number;
    duplicateIsinCount?: number;
    rejectedRowCount?: number;
  }): AmfiDatasetMetadata {
    const nextMap = new Map<string, OfficialAmfiRecord>();
    let duplicateIsins = params.duplicateIsinCount ?? 0;
    let rejected = params.rejectedRowCount ?? 0;

    for (const rec of params.records) {
      const isin = normalizeIsin(rec.isin);
      if (!isin) {
        rejected += 1;
        continue;
      }
      if (nextMap.has(isin)) {
        duplicateIsins += 1;
        continue;
      }
      nextMap.set(isin, {
        ...rec,
        isin,
        classificationPeriod: rec.classificationPeriod || params.classificationPeriod,
        publicationDate: rec.publicationDate || params.publicationDate,
        source:
          rec.source ||
          params.source ||
          "AMFI Official Categorization (6-Month Avg Full Market Cap)",
      });
    }

    if (nextMap.size === 0) {
      this.metadata = {
        ...this.metadata,
        limitations: [
          "Official AMFI import contained 0 valid ISIN records; previous dataset (if any) preserved.",
        ],
      };
      return this.getMetadata();
    }

    let largeCap = 0;
    let midCap = 0;
    let smallCap = 0;
    for (const r of nextMap.values()) {
      if (r.amfiCategory === "LARGE_CAP") largeCap += 1;
      else if (r.amfiCategory === "MID_CAP") midCap += 1;
      else smallCap += 1;
    }

    this.byIsin = nextMap;
    this.metadata = {
      classificationPeriod: params.classificationPeriod,
      publicationDate: params.publicationDate,
      source:
        params.source ??
        "AMFI Official Categorization (6-Month Avg Full Market Cap)",
      totalSourceRows: params.totalSourceRows ?? params.records.length,
      totalOfficialRecords: nextMap.size,
      duplicateIsinCount: duplicateIsins,
      rejectedRowCount: rejected,
      officialCategoryCounts: { largeCap, midCap, smallCap },
      lastLoadedAt: params.loadedAt ?? new Date().toISOString(),
      limitations: [],
    };
    return this.getMetadata();
  }

  public async fetchOfficialAmfiFromPortal(options?: {
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
  }): Promise<AmfiDatasetMetadata> {
    const fetchFn = options?.fetchImpl ?? fetch;
    const timeoutMs = options?.timeoutMs ?? 8000;
    try {
      const res = await fetchFn(
        "https://www.amfiindia.com/research-information/other-data/categorization-of-stocks",
        {
          headers: { "User-Agent": "Mozilla/5.0", Accept: "text/html,*/*" },
          signal: AbortSignal.timeout(timeoutMs),
        }
      );
      if (!res.ok) {
        this.metadata = {
          ...this.metadata,
          limitations: [
            `AMFI official portal returned HTTP ${res.status}; official AMFI file must be imported directly or retried.`,
          ],
        };
        return this.getMetadata();
      }
      const html = await res.text();
      // Check for direct CSV/XLS link in AMFI portal page
      const csvMatch = html.match(/https?:\/\/[^"'\s>]+\.csv/i);
      if (!csvMatch) {
        this.metadata = {
          ...this.metadata,
          limitations: [
            "AMFI portal HTML fetched, but no direct machine-readable CSV link was exposed (AMFI distributes official categorization as .xlsx). Import official AMFI CSV/JSON via ingestOfficialAmfiRecords().",
          ],
        };
        return this.getMetadata();
      }
      const csvRes = await fetchFn(csvMatch[0], {
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!csvRes.ok) {
        this.metadata = {
          ...this.metadata,
          limitations: [`AMFI CSV download returned HTTP ${csvRes.status}.`],
        };
        return this.getMetadata();
      }
      const csvText = await csvRes.text();
      const parsed = parseAmfiCsvText(csvText, {
        classificationPeriod: "Latest AMFI Half-Year",
        publicationDate: new Date().toISOString().slice(0, 10),
        source: csvMatch[0],
      });
      return this.ingestOfficialAmfiRecords({
        records: parsed,
        classificationPeriod: "Latest AMFI Half-Year",
        publicationDate: new Date().toISOString().slice(0, 10),
        source: csvMatch[0],
      });
    } catch (err: unknown) {
      this.metadata = {
        ...this.metadata,
        limitations: [
          `AMFI portal unreachable (${err instanceof Error ? err.message : "network error"}); unmatched companies remain UNCLASSIFIED.`,
        ],
      };
      return this.getMetadata();
    }
  }

  public lookupByIsin(isin: string | null | undefined): OfficialAmfiRecord | null {
    const clean = normalizeIsin(isin);
    if (!clean) return null;
    return this.byIsin.get(clean) ?? null;
  }

  public getMetadata(): AmfiDatasetMetadata {
    return {
      ...this.metadata,
      limitations: [...this.metadata.limitations],
    };
  }
}

export const amfiClassificationService = new AmfiClassificationService();

