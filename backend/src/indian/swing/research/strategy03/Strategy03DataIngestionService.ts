import crypto from "node:crypto";
import { getAdminSupabaseClient } from "../../../../db/supabaseClient";
import { fetchNseDeliveryForDate, type NseDeliveryRecord } from "./NseDeliveryCollector";
import { fetchNseBulkAndBlockDeals, type BulkBlockDealRecord } from "./BulkBlockDealCollector";
import { fetchStockShareholdingHistory, type ShareholdingQuarterRecord } from "./ShareholdingParser";
import { fetchBseCorporateAnnouncements, type CorporateAnnouncementRecord } from "./CorporateAnnouncementCollector";

export interface UniverseEquityRow {
  isin: string;
  symbol: string;
  nseSymbol: string | null;
  bseCode: string | null;
  companyName: string;
  exchange: string;
  series: string | null;
  listingStatus: string;
}

export interface Strategy03CoverageStats {
  runId: string;
  totalUniverseRecords: number;
  nseEligibleRecords: number;
  deliverySymbolsCount: number;
  bulkBlockSymbolsCount: number;
  shareholdingSymbolsCount: number;
  fiiSymbolsCount: number;
  diiSymbolsCount: number;
  mfSymbolsCount: number;
  pledgeSymbolsCount: number;
  announcementSymbolsCount: number;
  enrichedSampleAttempted: number;
  staleOrMissingCount: number;
  deliveryTradingDate: string | null;
  failures: string[];
  persistedToSupabase: boolean;
}

export class Strategy03DataIngestionService {
  /**
   * Paginates all rows from `market_universe_equities` (bypassing PostgREST 1000-row cap).
   */
  public async loadPaginatedUniverse(): Promise<UniverseEquityRow[]> {
    const supabase = getAdminSupabaseClient();
    const all: UniverseEquityRow[] = [];
    const pageSize = 1000;
    let offset = 0;

    while (true) {
      const { data, error } = await (supabase as any)
        .from("market_universe_equities")
        .select("isin, symbol, nse_symbol, bse_code, company_name, exchange, series, listing_status")
        .order("isin", { ascending: true })
        .range(offset, offset + pageSize - 1);

      if (error) {
        throw new Error(`Failed to paginate market_universe_equities: ${error.message}`);
      }
      const rows = data || [];
      for (const r of rows) {
        all.push({
          isin: r.isin,
          symbol: r.symbol,
          nseSymbol: r.nse_symbol ?? null,
          bseCode: r.bse_code ?? null,
          companyName: r.company_name,
          exchange: r.exchange,
          series: r.series ?? null,
          listingStatus: r.listing_status,
        });
      }
      if (rows.length < pageSize) break;
      offset += pageSize;
    }
    return all;
  }

  public async runControlledIngestion(params?: {
    deliveryDateIso?: string;
    maxEnrichedSymbols?: number;
    persist?: boolean;
  }): Promise<{
    stats: Strategy03CoverageStats;
    deliverySample: NseDeliveryRecord[];
    deals: BulkBlockDealRecord[];
    shareholdingSample: ShareholdingQuarterRecord[];
    announcementsSample: CorporateAnnouncementRecord[];
  }> {
    const runId = crypto.randomUUID();
    const maxEnrichedSymbols = Math.min(100, Math.max(0, params?.maxEnrichedSymbols ?? 20));
    const persist = params?.persist ?? false;
    const failures: string[] = [];

    const universe = await this.loadPaginatedUniverse();
    const nseMap = new Map<string, UniverseEquityRow>();
    for (const row of universe) {
      if (row.nseSymbol) nseMap.set(row.nseSymbol.toUpperCase(), row);
    }

    // 1. Fetch NSE Delivery CSV (try requested date, else walk back up to 5 days to find last trading day)
    let deliveryRecords: NseDeliveryRecord[] = [];
    let deliveryDateUsed: string | null = null;
    const candidateDates: string[] = [];
    if (params?.deliveryDateIso) {
      candidateDates.push(params.deliveryDateIso);
    } else {
      const now = Date.now();
      for (let d = 0; d < 6; d++) {
        candidateDates.push(new Date(now - d * 86400_000).toISOString().slice(0, 10));
      }
    }
    for (const dt of candidateDates) {
      const res = await fetchNseDeliveryForDate(dt);
      if (res.ok && res.records.length > 0) {
        deliveryRecords = res.records.filter((r) => nseMap.has(r.symbol));
        deliveryDateUsed = dt;
        break;
      }
    }
    if (!deliveryDateUsed) failures.push("NSE Delivery Bhavcopy unavailable for recent candidate dates.");

    // 2. Fetch NSE Bulk & Block Deals
    const dealsRes = await fetchNseBulkAndBlockDeals();
    if (!dealsRes.ok) failures.push(...dealsRes.errors);
    const universeDeals = dealsRes.records.filter((d) => nseMap.has(d.symbol));

    // 3. Controlled, rate-limited enrichment (Shareholding + BSE Announcements) for top N NSE symbols
    const enrichedTargets = Array.from(nseMap.values()).slice(0, maxEnrichedSymbols);
    const shareholdingAll: ShareholdingQuarterRecord[] = [];
    const announcementsAll: CorporateAnnouncementRecord[] = [];

    for (let i = 0; i < enrichedTargets.length; i += 4) {
      const batch = enrichedTargets.slice(i, i + 4);
      const settled = await Promise.allSettled(
        batch.map(async (eq) => {
          const sym = eq.nseSymbol!;
          const [sh, ann] = await Promise.all([
            fetchStockShareholdingHistory(sym),
            fetchBseCorporateAnnouncements({
              symbol: sym,
              companyName: eq.companyName,
              bseCode: eq.bseCode,
            }),
          ]);
          return { sym, sh, ann };
        })
      );
      for (const item of settled) {
        if (item.status === "fulfilled") {
          shareholdingAll.push(...item.value.sh.records);
          announcementsAll.push(...item.value.ann.records);
        }
      }
      if (i + 4 < enrichedTargets.length) {
        await new Promise((r) => setTimeout(r, 250));
      }
    }

    const deliverySymbols = new Set(deliveryRecords.filter((r) => r.deliveryQty !== null).map((r) => r.symbol));
    const dealSymbols = new Set(universeDeals.map((d) => d.symbol));
    const shSymbols = new Set(shareholdingAll.map((s) => s.symbol));
    const fiiSymbols = new Set(shareholdingAll.filter((s) => s.fiiPct !== null).map((s) => s.symbol));
    const diiSymbols = new Set(shareholdingAll.filter((s) => s.diiPct !== null).map((s) => s.symbol));
    const mfSymbols = new Set(shareholdingAll.filter((s) => s.mutualFundPct !== null).map((s) => s.symbol));
    const pledgeSymbols = new Set(shareholdingAll.filter((s) => s.promoterPledgedPct !== null).map((s) => s.symbol));
    const annSymbols = new Set(announcementsAll.map((a) => a.symbol));

    let persistedToSupabase = false;
    if (persist) {
      persistedToSupabase = await this.persistBatch({
        runId,
        universeCount: universe.length,
        deliveryRecords,
        deals: universeDeals,
        shareholding: shareholdingAll,
        announcements: announcementsAll,
        counts: {
          delivery: deliverySymbols.size,
          shareholding: shSymbols.size,
          fii: fiiSymbols.size,
          dii: diiSymbols.size,
          mf: mfSymbols.size,
          pledge: pledgeSymbols.size,
          deals: dealSymbols.size,
          announcements: annSymbols.size,
        },
        failures,
      });
    }

    const stats: Strategy03CoverageStats = {
      runId,
      totalUniverseRecords: universe.length,
      nseEligibleRecords: nseMap.size,
      deliverySymbolsCount: deliverySymbols.size,
      bulkBlockSymbolsCount: dealSymbols.size,
      shareholdingSymbolsCount: shSymbols.size,
      fiiSymbolsCount: fiiSymbols.size,
      diiSymbolsCount: diiSymbols.size,
      mfSymbolsCount: mfSymbols.size,
      pledgeSymbolsCount: pledgeSymbols.size,
      announcementSymbolsCount: annSymbols.size,
      enrichedSampleAttempted: enrichedTargets.length,
      staleOrMissingCount: Math.max(0, nseMap.size - deliverySymbols.size),
      deliveryTradingDate: deliveryDateUsed,
      failures,
      persistedToSupabase,
    };

    return {
      stats,
      deliverySample: deliveryRecords.slice(0, 10),
      deals: universeDeals,
      shareholdingSample: shareholdingAll.slice(0, 10),
      announcementsSample: announcementsAll.slice(0, 10),
    };
  }

  private async persistBatch(input: {
    runId: string;
    universeCount: number;
    deliveryRecords: NseDeliveryRecord[];
    deals: BulkBlockDealRecord[];
    shareholding: ShareholdingQuarterRecord[];
    announcements: CorporateAnnouncementRecord[];
    counts: Record<string, number>;
    failures: string[];
  }): Promise<boolean> {
    const supabase = getAdminSupabaseClient();

    if (input.deliveryRecords.length > 0) {
      const chunk = input.deliveryRecords.slice(0, 500).map((r) => ({
        symbol: r.symbol,
        series: r.series,
        trading_date: r.tradingDate,
        close_price: r.closePrice,
        traded_qty: r.tradedQty,
        delivery_qty: r.deliveryQty,
        delivery_pct: r.deliveryPct,
        turnover_lacs: r.turnoverLacs,
        source_name: r.evidence.sourceName,
        source_url: r.evidence.sourceUrlOrFilingId,
        published_at: r.evidence.publishedAt,
        retrieved_at: r.evidence.retrievedAt,
        verification_status: r.evidence.verificationStatus,
        confidence: r.evidence.confidence,
        has_source_conflict: r.evidence.hasSourceConflict,
      }));
      await (supabase as any)
        .from("strategy03_delivery_data")
        .upsert(chunk, { onConflict: "symbol,series,trading_date" });
    }

    if (input.deals.length > 0) {
      const rows = input.deals.map((d) => ({
        exchange: d.exchange,
        deal_type: d.dealType,
        trading_date: d.tradingDate,
        symbol: d.symbol,
        security_name: d.securityName,
        client_name: d.clientName,
        client_category: d.clientCategory,
        side: d.side,
        quantity: d.quantity,
        price: d.price,
        remarks: d.remarks,
        source_name: d.evidence.sourceName,
        source_url: d.evidence.sourceUrlOrFilingId,
        retrieved_at: d.evidence.retrievedAt,
        verification_status: d.evidence.verificationStatus,
        confidence: d.evidence.confidence,
        has_source_conflict: d.evidence.hasSourceConflict,
      }));
      await (supabase as any)
        .from("strategy03_bulk_block_deals")
        .upsert(rows, { onConflict: "exchange,deal_type,trading_date,symbol,client_name,side,quantity,price" });
    }

    if (input.shareholding.length > 0) {
      const rows = input.shareholding.map((s) => ({
        symbol: s.symbol,
        reporting_quarter: s.reportingQuarter,
        version: s.version,
        promoter_pct: s.promoterPct,
        fii_pct: s.fiiPct,
        dii_pct: s.diiPct,
        mutual_fund_pct: s.mutualFundPct,
        public_pct: s.publicPct,
        promoter_pledged_pct: s.promoterPledgedPct,
        total_reported_pct: s.totalReportedPct,
        is_plausible_sum: s.isPlausibleSum,
        source_name: s.evidence.sourceName,
        source_url: s.evidence.sourceUrlOrFilingId,
        published_at: s.evidence.publishedAt,
        retrieved_at: s.evidence.retrievedAt,
        verification_status: s.evidence.verificationStatus,
        confidence: s.evidence.confidence,
        has_source_conflict: s.evidence.hasSourceConflict,
      }));
      await (supabase as any)
        .from("strategy03_shareholding_history")
        .upsert(rows, { onConflict: "symbol,reporting_quarter,version" });
    }

    if (input.announcements.length > 0) {
      const rows = input.announcements.map((a) => ({
        exchange: a.exchange,
        filing_id: a.filingId,
        symbol: a.symbol,
        company_name: a.companyName,
        category: a.category,
        headline: a.headline,
        extracted_text: a.extractedText,
        source_url: a.evidence.sourceUrlOrFilingId,
        published_at: a.evidence.publishedAt,
        retrieved_at: a.evidence.retrievedAt,
        verification_status: a.evidence.verificationStatus,
        extraction_confidence: a.extractionConfidence,
        is_ambiguous: a.isAmbiguous,
        has_source_conflict: a.evidence.hasSourceConflict,
      }));
      await (supabase as any)
        .from("strategy03_corporate_announcements")
        .upsert(rows, { onConflict: "exchange,filing_id" });
    }

    await (supabase as any).from("strategy03_data_collection_runs").insert({
      run_id: input.runId,
      status: input.failures.length > 0 ? "PARTIAL" : "COMPLETED",
      total_universe_symbols: input.universeCount,
      delivery_symbols_count: input.counts.delivery,
      shareholding_symbols_count: input.counts.shareholding,
      fii_symbols_count: input.counts.fii,
      dii_symbols_count: input.counts.dii,
      mf_symbols_count: input.counts.mf,
      pledge_symbols_count: input.counts.pledge,
      bulk_block_symbols_count: input.counts.deals,
      announcement_symbols_count: input.counts.announcements,
      failures: input.failures,
      completed_at: new Date().toISOString(),
    });
    return true;
  }
}

export const strategy03DataIngestionService = new Strategy03DataIngestionService();

