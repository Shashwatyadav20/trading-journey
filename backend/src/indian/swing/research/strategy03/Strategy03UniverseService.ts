import { getAdminSupabaseClient } from "../../../../db/supabaseClient";

export type Strategy03UniverseBucket =
  | "LARGE_CAP"
  | "MID_CAP"
  | "SMALL_CAP"
  | "MICRO_CAP"
  | "SME"
  | "SUSPENDED"
  | "SPECIAL_SERIES";

export interface Strategy03UniverseEquity {
  isin: string;
  symbol: string;
  nseSymbol: string | null;
  bseCode: string | null;
  companyName: string;
  exchange: string;
  series: string | null;
  listingStatus: string;
  sector: string | null;
  industry: string | null;
  marketCapCr: number | null;
  marketCapRank: number | null;
  marketCapCategory: string;
  bucket: Strategy03UniverseBucket;
  eligibleForNseResearch: boolean;
  exclusionReason: string | null;
}

export function classifyUniverseEquity(row: {
  isin: string;
  symbol: string;
  nseSymbol: string | null;
  bseCode: string | null;
  companyName: string;
  exchange: string;
  series: string | null;
  listingStatus: string;
  sector: string | null;
  industry: string | null;
  marketCapCr: number | null;
  marketCapRank: number | null;
  marketCapCategory: string;
}): Strategy03UniverseEquity {
  const ser = (row.series || "").toUpperCase();
  let bucket: Strategy03UniverseBucket = "MICRO_CAP";
  let eligible = Boolean(row.nseSymbol);
  let exclusionReason: string | null = eligible ? null : "NO_NSE_SYMBOL";

  if (row.listingStatus !== "ACTIVE") {
    bucket = "SUSPENDED";
    eligible = false;
    exclusionReason = `LISTING_STATUS_${row.listingStatus}`;
  } else if (["SM", "ST", "M"].includes(ser)) {
    bucket = "SME";
    eligible = false;
    exclusionReason = `SME_SERIES_${ser}`;
  } else if (["BZ", "BE", "XT"].includes(ser)) {
    bucket = "SPECIAL_SERIES";
    eligible = false;
    exclusionReason = `SPECIAL_SERIES_${ser}`;
  } else if (row.marketCapCategory === "LARGE_CAP") {
    bucket = "LARGE_CAP";
  } else if (row.marketCapCategory === "MID_CAP") {
    bucket = "MID_CAP";
  } else if (row.marketCapCategory === "SMALL_CAP") {
    bucket = row.marketCapCr !== null && row.marketCapCr < 1500 ? "MICRO_CAP" : "SMALL_CAP";
  }

  return {
    ...row,
    bucket,
    eligibleForNseResearch: eligible,
    exclusionReason,
  };
}

export class Strategy03UniverseService {
  public async loadAllPaginated(pageSize = 1000): Promise<Strategy03UniverseEquity[]> {
    const supabase = getAdminSupabaseClient();
    const out: Strategy03UniverseEquity[] = [];
    let offset = 0;

    while (true) {
      const { data, error } = await (supabase as any)
        .from("market_universe_equities")
        .select(
          "isin, symbol, nse_symbol, bse_code, company_name, exchange, series, listing_status, sector, industry, market_cap_cr, market_cap_rank, market_cap_category"
        )
        .order("isin", { ascending: true })
        .range(offset, offset + pageSize - 1);

      if (error) {
        throw new Error(`Strategy03UniverseService pagination error: ${error.message}`);
      }
      const rows = data || [];
      for (const r of rows) {
        out.push(
          classifyUniverseEquity({
            isin: r.isin,
            symbol: r.symbol,
            nseSymbol: r.nse_symbol ?? null,
            bseCode: r.bse_code ?? null,
            companyName: r.company_name,
            exchange: r.exchange,
            series: r.series ?? null,
            listingStatus: r.listing_status,
            sector: r.sector ?? null,
            industry: r.industry ?? null,
            marketCapCr: r.market_cap_cr !== null ? Number(r.market_cap_cr) : null,
            marketCapRank: r.market_cap_rank !== null ? Number(r.market_cap_rank) : null,
            marketCapCategory: r.market_cap_category,
          })
        );
      }
      if (rows.length < pageSize) break;
      offset += pageSize;
    }

    return out;
  }
}

export const strategy03UniverseService = new Strategy03UniverseService();

