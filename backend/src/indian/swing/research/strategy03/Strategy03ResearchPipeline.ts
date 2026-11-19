import crypto from "node:crypto";
import { getAdminSupabaseClient } from "../../../../db/supabaseClient";
import {
  classifyDataFreshness,
  fetchBseOfficialResultFiling,
  fetchScreenerFundamentals,
  fetchReadOnlyNseDailyCandles,
} from "./Strategy03ExternalDataHelpers";
import { isTimestampStale, type Strategy03EvidenceContract } from "./Strategy03DataTypes";
import {
  computeShareholdingQoQDiff,
  fetchStockShareholdingHistory,
  type ShareholdingQuarterRecord,
} from "./ShareholdingParser";
import {
  detectRepeatedDealPatterns,
  type BulkBlockDealRecord,
} from "./BulkBlockDealCollector";
import {
  fetchBseCorporateAnnouncements,
  type CorporateAnnouncementRecord,
} from "./CorporateAnnouncementCollector";
import type { NseDeliveryRecord } from "./NseDeliveryCollector";
import type { StrategyCandle } from "../../strategies/ImpulseConsolidationDojiStrategy";
import { fetchBseOfficialFinancialFilingIndex } from "./AuthoritativeFinancialAdapter";
import {
  computeShareholdingTrends,
  type NormalizedShareholdingRecord,
} from "./OfficialShareholdingIntelligenceEngine";

export interface Strategy03ScoringWeights {
  futureGrowthPotential: number; // 20
  earningsQuality: number; // 20
  institutionalOwnership: number; // 15
  financialStrength: number; // 15
  valuation: number; // 10
  businessExpansion: number; // 10
  technicalConfirmation: number; // 10
}

export const DEFAULT_STRATEGY03_SCORING_WEIGHTS: Strategy03ScoringWeights = {
  futureGrowthPotential: 20,
  earningsQuality: 20,
  institutionalOwnership: 15,
  financialStrength: 15,
  valuation: 10,
  businessExpansion: 10,
  technicalConfirmation: 10,
};

export interface FundamentalResearchOutput {
  symbol: string;
  statementScope: "CONSOLIDATED" | "STANDALONE" | "UNKNOWN";
  reportingPeriod: string | null;
  priorPeriodCompared: string | null;
  periodsCompatible: boolean;
  publishedAt: string | null;
  freshnessStatus: "FRESH" | "STALE" | "UNKNOWN";
  revenueGrowthYoYPct: number | null;
  netProfitGrowthYoYPct: number | null;
  epsGrowthYoYPct: number | null;
  operatingMarginPct: number | null;
  roePct: number | null;
  rocePct: number | null;
  debtToEquity: number | null;
  operatingCashFlowCr: number | null;
  freeCashFlowCr: number | null;
  trailingPE: number | null;
  priceToBook: number | null;
  evToEbitda: number | null;
  priceToSales: number | null;
  evidence: Strategy03EvidenceContract[];
  missingFields: string[];
}

export interface InstitutionalResearchOutput {
  symbol: string;
  marketWideFlowExcluded: true; // Always true: market-wide daily flows never used as stock ownership
  latestQuarter: string | null;
  priorQuarter: string | null;
  fiiDeltaPct: number | null;
  diiDeltaPct: number | null;
  promoterDeltaPct: number | null;
  mutualFundPct: number | null; // MISSING unless verified
  promoterPledgedPct: number | null; // MISSING unless verified
  repeatedDealPatterns: Array<{ side: "BUY" | "SELL"; dealCount: number; totalQuantity: number }>;
  shareholdingVerificationStatus: "VERIFIED" | "UNVERIFIED" | "MISSING" | "CONFLICTED";
  evidence: Strategy03EvidenceContract[];
  missingFields: string[];
}

export interface CorporateResearchOutput {
  symbol: string;
  verifiedExpansionCount: number;
  unverifiedClaimsCount: number;
  categoriesDetected: string[];
  announcements: CorporateAnnouncementRecord[];
  evidence: Strategy03EvidenceContract[];
  missingFields: string[];
}

export interface TechnicalResearchOutput {
  symbol: string;
  trendStructure: "UPTREND" | "DOWNTREND" | "RANGE" | "INSUFFICIENT";
  aboveSma50: boolean | null;
  aboveSma200: boolean | null;
  relativeStrength3MPct: number | null;
  avg20DTurnoverCr: number | null;
  latestDeliveryPct: number | null;
  deliveryVerificationStatus: "VERIFIED" | "UNVERIFIED" | "MISSING" | "STALE" | "CONFLICTED";
  majorSupport: number | null;
  majorResistance: number | null;
  evidence: Strategy03EvidenceContract[];
  missingFields: string[];
}

export interface FactorScoreDetail {
  key: keyof Strategy03ScoringWeights;
  label: string;
  score: number;
  maxScore: number;
  explanation: string;
  evidenceSources: string[];
}

export interface Strategy03EvaluationResult {
  evaluationId: string;
  runId: string;
  idempotencyKey: string;
  researchOnly: true;
  symbol: string;
  isin: string | null;
  companyName: string;
  decision: "ENTER_CANDIDATE" | "WAIT" | "REJECT";
  totalScore: number;
  factorScores: Record<keyof Strategy03ScoringWeights, FactorScoreDetail>;
  evidenceSummary: Strategy03EvidenceContract[];
  positiveFactors: string[];
  negativeFactors: string[];
  missingData: string[];
  conflicts: string[];
  sourceReferences: string[];
  confidence: number;
  decisionExplanation: string;
  evaluatedAt: string;
}

export class Strategy03FundamentalResearchService {
  public async evaluate(params: {
    symbol: string;
    bseCode: string | null;
    overrideData?: Partial<FundamentalResearchOutput>;
  }): Promise<FundamentalResearchOutput> {
    if (params.overrideData) {
      const d = params.overrideData;
      return {
        symbol: params.symbol,
        statementScope: d.statementScope ?? "CONSOLIDATED",
        reportingPeriod: d.reportingPeriod ?? null,
        priorPeriodCompared: d.priorPeriodCompared ?? null,
        periodsCompatible: d.periodsCompatible ?? true,
        publishedAt: d.publishedAt ?? null,
        freshnessStatus: d.freshnessStatus ?? classifyDataFreshness(d.publishedAt ?? null).freshnessStatus,
        revenueGrowthYoYPct: d.revenueGrowthYoYPct ?? null,
        netProfitGrowthYoYPct: d.netProfitGrowthYoYPct ?? null,
        epsGrowthYoYPct: d.epsGrowthYoYPct ?? null,
        operatingMarginPct: d.operatingMarginPct ?? null,
        roePct: d.roePct ?? null,
        rocePct: d.rocePct ?? null,
        debtToEquity: d.debtToEquity ?? null,
        operatingCashFlowCr: d.operatingCashFlowCr ?? null,
        freeCashFlowCr: d.freeCashFlowCr ?? null,
        trailingPE: d.trailingPE ?? null,
        priceToBook: d.priceToBook ?? null,
        evToEbitda: d.evToEbitda ?? null,
        priceToSales: d.priceToSales ?? null,
        evidence: d.evidence ?? [],
        missingFields: d.missingFields ?? [],
      };
    }

    const nowIso = new Date().toISOString();
    const [official, screener, xbrlIndex] = await Promise.all([
      fetchBseOfficialResultFiling(params.bseCode).catch(() => null),
      fetchScreenerFundamentals(params.symbol).catch(() => null),
      fetchBseOfficialFinancialFilingIndex(params.bseCode, "CONSOLIDATED").catch(() => ({ ok: false, links: [] })),
    ]);

    const publishedAt = official?.publishedAt ?? null;
    const freshness = classifyDataFreshness(publishedAt);
    const evidence: Strategy03EvidenceContract[] = [];
    const missingFields: string[] = [
      "revenueGrowthYoYPct",
      "netProfitGrowthYoYPct",
      "epsGrowthYoYPct",
      "operatingMarginPct",
      "debtToEquity",
      "operatingCashFlowCr",
      "freeCashFlowCr",
      "evToEbitda",
      "priceToSales",
    ];

    if (official) {
      evidence.push({
        sourceName: official.sourceName,
        sourceUrlOrFilingId: official.sourceUrl ?? "https://www.bseindia.com/",
        reportingPeriod: official.publishedAt ? official.publishedAt.slice(0, 10) : "UNKNOWN",
        publishedAt: official.publishedAt,
        retrievedAt: nowIso,
        verificationStatus: official.verificationStatus,
        confidence: official.verificationStatus === "VERIFIED" ? 0.95 : 0.4,
        hasSourceConflict: false,
      });
    } else {
      missingFields.push("officialQuarterlyResultFiling");
    }

    if (xbrlIndex.ok && xbrlIndex.links.length > 0) {
      const latestLink = xbrlIndex.links[0];
      evidence.push({
        sourceName: `BSE Official XBRL Filing Index (${latestLink.statementScope})`,
        sourceUrlOrFilingId: latestLink.filingUrl,
        reportingPeriod: `${latestLink.financialYear} ${latestLink.periodType} (${latestLink.periodLabel})`,
        publishedAt,
        retrievedAt: latestLink.retrievedAt,
        verificationStatus: "VERIFIED",
        confidence: 0.95,
        hasSourceConflict: false,
      });
    }

    if (screener) {
      evidence.push({
        sourceName: "Screener.in (Third-Party Aggregator - Consolidated)",
        sourceUrlOrFilingId: screener.sourceUrl,
        reportingPeriod: official?.publishedAt ? official.publishedAt.slice(0, 10) : "TTM_SNAPSHOT",
        publishedAt,
        retrievedAt: screener.retrievedAt,
        verificationStatus: "UNVERIFIED",
        confidence: 0.7,
        hasSourceConflict: false,
      });
    } else {
      missingFields.push("roePct", "rocePct", "trailingPE", "priceToBook");
    }

    return {
      symbol: params.symbol,
      statementScope: screener?.sourceUrl.includes("/consolidated/") ? "CONSOLIDATED" : "UNKNOWN",
      reportingPeriod: official?.publishedAt ? official.publishedAt.slice(0, 10) : null,
      priorPeriodCompared: null,
      periodsCompatible: true,
      publishedAt,
      freshnessStatus: freshness.freshnessStatus,
      revenueGrowthYoYPct: null,
      netProfitGrowthYoYPct: null,
      epsGrowthYoYPct: null,
      operatingMarginPct: null,
      roePct: screener?.roePct ?? null,
      rocePct: screener?.rocePct ?? null,
      debtToEquity: null,
      operatingCashFlowCr: null,
      freeCashFlowCr: null,
      trailingPE: screener?.trailingPE ?? null,
      priceToBook: screener?.priceToBook ?? null,
      evToEbitda: null,
      priceToSales: null,
      evidence,
      missingFields,
    };
  }
}

export class Strategy03InstitutionalResearchService {
  public async evaluate(params: {
    symbol: string;
    shareholdingOverride?: ShareholdingQuarterRecord[];
    officialOwnershipOverride?: NormalizedShareholdingRecord[];
    deals?: BulkBlockDealRecord[];
  }): Promise<InstitutionalResearchOutput> {
    if (!params.shareholdingOverride && !params.officialOwnershipOverride) {
      try {
        const sb = getAdminSupabaseClient();
        const { data: persistedRows } = await sb
          .from("strategy03_institutional_ownership")
          .select("*")
          .eq("symbol", params.symbol.toUpperCase())
          .order("reporting_quarter", { ascending: true })
          .order("version", { ascending: true });
        if (persistedRows && persistedRows.length > 0) {
          const mapped: NormalizedShareholdingRecord[] = persistedRows.map((row: any) => ({
            idempotencyKey: row.idempotency_key,
            symbol: row.symbol,
            isin: row.isin,
            exchange: row.exchange,
            reportingQuarter: row.reporting_quarter,
            filingDate: row.filing_date,
            publicationTimestamp: row.publication_timestamp,
            retrievedAt: row.retrieved_at,
            filingId: row.filing_id,
            sourceName: row.source_name,
            sourceUrl: row.source_url,
            extractionVersion: row.extraction_version,
            version: row.version,
            isRestated: row.is_restated,
            promoterPct: row.promoter_pct !== null ? Number(row.promoter_pct) : null,
            promoterPledgedPct: row.promoter_pledged_pct !== null ? Number(row.promoter_pledged_pct) : null,
            fiiPct: row.fii_pct !== null ? Number(row.fii_pct) : null,
            fpiCat1Pct: row.fpi_cat1_pct !== null ? Number(row.fpi_cat1_pct) : null,
            fpiCat2Pct: row.fpi_cat2_pct !== null ? Number(row.fpi_cat2_pct) : null,
            diiPct: row.dii_pct !== null ? Number(row.dii_pct) : null,
            mutualFundPct: row.mutual_fund_pct !== null ? Number(row.mutual_fund_pct) : null,
            insurancePct: row.insurance_pct !== null ? Number(row.insurance_pct) : null,
            banksFiPct: row.banks_fi_pct !== null ? Number(row.banks_fi_pct) : null,
            governmentPct: row.government_pct !== null ? Number(row.government_pct) : null,
            publicPct: row.public_pct !== null ? Number(row.public_pct) : null,
            otherInstitutionalPct: row.other_institutional_pct !== null ? Number(row.other_institutional_pct) : null,
            totalReportedPct: row.total_reported_pct !== null ? Number(row.total_reported_pct) : null,
            isTotalReconciled: Boolean(row.is_total_reconciled),
            fiiQoqChangePp: row.fii_qoq_change_pp !== null ? Number(row.fii_qoq_change_pp) : null,
            diiQoqChangePp: row.dii_qoq_change_pp !== null ? Number(row.dii_qoq_change_pp) : null,
            mfQoqChangePp: row.mf_qoq_change_pp !== null ? Number(row.mf_qoq_change_pp) : null,
            promoterQoqChangePp: row.promoter_qoq_change_pp !== null ? Number(row.promoter_qoq_change_pp) : null,
            pledgeQoqChangePp: row.pledge_qoq_change_pp !== null ? Number(row.pledge_qoq_change_pp) : null,
            fiiYoyChangePp: row.fii_yoy_change_pp !== null ? Number(row.fii_yoy_change_pp) : null,
            diiYoyChangePp: row.dii_yoy_change_pp !== null ? Number(row.dii_yoy_change_pp) : null,
            mfYoyChangePp: row.mf_yoy_change_pp !== null ? Number(row.mf_yoy_change_pp) : null,
            consecutiveFiiAccumQtrs: Number(row.consecutive_fii_accum_qtrs ?? 0),
            consecutiveFiiReduceQtrs: Number(row.consecutive_fii_reduce_qtrs ?? 0),
            consecutiveDiiAccumQtrs: Number(row.consecutive_dii_accum_qtrs ?? 0),
            consecutiveDiiReduceQtrs: Number(row.consecutive_dii_reduce_qtrs ?? 0),
            rawClassifications: row.raw_classifications ?? {},
            validationNotes: Array.isArray(row.validation_notes) ? row.validation_notes : [],
            verificationStatus: row.verification_status,
            hasSourceConflict: Boolean(row.has_source_conflict),
            confidence: Number(row.confidence ?? 0),
          }));
          return this.evaluate({ ...params, officialOwnershipOverride: mapped });
        }
      } catch {
        // Fall through to legacy shareholding parser if DB table unavailable
      }
    }

    if (params.officialOwnershipOverride && params.officialOwnershipOverride.length > 0 && !params.shareholdingOverride) {
      const trended = computeShareholdingTrends(params.officialOwnershipOverride);
      const latest = trended[trended.length - 1];
      const prev = trended.length >= 2 ? trended[trended.length - 2] : null;
      const missingFields: string[] = [];
      if (!prev) missingFields.push("priorQuarterShareholdingForQoQ");
      if (latest.mutualFundPct === null) missingFields.push("mutualFundPct");
      if (latest.promoterPledgedPct === null) missingFields.push("promoterPledgedPct");
      if (latest.verificationStatus === "STALE") missingFields.push("staleShareholdingPattern");
      const status: InstitutionalResearchOutput["shareholdingVerificationStatus"] =
        latest.verificationStatus === "CONFLICTED"
          ? "CONFLICTED"
          : latest.verificationStatus === "VERIFIED"
          ? "VERIFIED"
          : latest.verificationStatus === "MISSING"
          ? "MISSING"
          : "UNVERIFIED";
      const evidence: Strategy03EvidenceContract[] = trended.slice(-4).map((r) => ({
        sourceName: r.sourceName,
        sourceUrlOrFilingId: r.filingId ?? r.sourceUrl,
        sourceUrl: r.sourceUrl,
        reportingPeriod: r.reportingQuarter,
        retrievedAt: r.retrievedAt,
        publishedAt: r.publicationTimestamp ?? r.filingDate,
        isStale: r.verificationStatus === "STALE",
        hasSourceConflict: r.hasSourceConflict,
        verificationStatus: r.verificationStatus,
        confidence: r.confidence,
      }));
      const symDeals = (params.deals ?? []).filter((d) => d.symbol === params.symbol.toUpperCase());
      const patterns = detectRepeatedDealPatterns(symDeals, 2).map((p) => ({
        side: p.side,
        dealCount: p.dealCount,
        totalQuantity: p.totalQuantity,
      }));
      for (const d of symDeals.slice(0, 5)) evidence.push(d.evidence);
      return {
        symbol: params.symbol,
        marketWideFlowExcluded: true,
        latestQuarter: latest.reportingQuarter,
        priorQuarter: prev ? prev.reportingQuarter : null,
        fiiDeltaPct: latest.fiiQoqChangePp,
        diiDeltaPct: latest.diiQoqChangePp,
        promoterDeltaPct: latest.promoterQoqChangePp,
        mutualFundPct: latest.mutualFundPct,
        promoterPledgedPct: latest.promoterPledgedPct,
        repeatedDealPatterns: patterns,
        shareholdingVerificationStatus: status,
        evidence,
        missingFields,
      };
    }

    const shRecords =
      params.shareholdingOverride ??
      (await fetchStockShareholdingHistory(params.symbol).then((r) => r.records).catch(() => []));

    const missingFields: string[] = [];
    const evidence: Strategy03EvidenceContract[] = [];
    let latestQuarter: string | null = null;
    let priorQuarter: string | null = null;
    let fiiDeltaPct: number | null = null;
    let diiDeltaPct: number | null = null;
    let promoterDeltaPct: number | null = null;
    let mutualFundPct: number | null = null;
    let promoterPledgedPct: number | null = null;
    let status: InstitutionalResearchOutput["shareholdingVerificationStatus"] = "MISSING";

    if (shRecords.length > 0) {
      const latest = shRecords[shRecords.length - 1];
      latestQuarter = latest.reportingQuarter;
      mutualFundPct = latest.mutualFundPct;
      promoterPledgedPct = latest.promoterPledgedPct;
      status = latest.evidence.verificationStatus === "CONFLICTED" ? "CONFLICTED" : latest.evidence.verificationStatus === "VERIFIED" ? "VERIFIED" : "UNVERIFIED";
      evidence.push(latest.evidence);

      if (shRecords.length >= 2) {
        const prev = shRecords[shRecords.length - 2];
        priorQuarter = prev.reportingQuarter;
        const diff = computeShareholdingQoQDiff(prev, latest);
        fiiDeltaPct = diff.fiiDeltaPct;
        diiDeltaPct = diff.diiDeltaPct;
        promoterDeltaPct = diff.promoterDeltaPct;
      } else {
        missingFields.push("priorQuarterShareholdingForQoQ");
      }
    } else {
      missingFields.push("shareholdingHistory", "fiiDeltaPct", "diiDeltaPct", "promoterDeltaPct");
    }

    if (mutualFundPct === null) missingFields.push("mutualFundPct");
    if (promoterPledgedPct === null) missingFields.push("promoterPledgedPct");

    const symDeals = (params.deals ?? []).filter((d) => d.symbol === params.symbol.toUpperCase());
    const patterns = detectRepeatedDealPatterns(symDeals, 2).map((p) => ({
      side: p.side,
      dealCount: p.dealCount,
      totalQuantity: p.totalQuantity,
    }));
    for (const d of symDeals.slice(0, 5)) evidence.push(d.evidence);

    return {
      symbol: params.symbol,
      marketWideFlowExcluded: true,
      latestQuarter,
      priorQuarter,
      fiiDeltaPct,
      diiDeltaPct,
      promoterDeltaPct,
      mutualFundPct,
      promoterPledgedPct,
      repeatedDealPatterns: patterns,
      shareholdingVerificationStatus: status,
      evidence,
      missingFields,
    };
  }
}

export class Strategy03CorporateResearchService {
  public async evaluate(params: {
    symbol: string;
    companyName: string;
    bseCode: string | null;
    announcementsOverride?: CorporateAnnouncementRecord[];
  }): Promise<CorporateResearchOutput> {
    const anns =
      params.announcementsOverride ??
      (await fetchBseCorporateAnnouncements({
        symbol: params.symbol,
        companyName: params.companyName,
        bseCode: params.bseCode,
      })
        .then((r) => r.records)
        .catch(() => []));

    const expansionAnns = anns.filter((a) =>
      [
        "ORDER_WIN",
        "ORDER_BOOK",
        "CAPACITY_EXPANSION",
        "CAPEX",
        "ACQUISITION",
        "PRODUCT_LAUNCH",
        "MATERIAL_CONTRACT",
      ].includes(a.category)
    );
    const verifiedExpansionCount = expansionAnns.filter(
      (a) => a.evidence.verificationStatus === "VERIFIED"
    ).length;
    const unverifiedClaimsCount = expansionAnns.filter(
      (a) => a.evidence.verificationStatus !== "VERIFIED"
    ).length;

    const missingFields: string[] = [];
    if (anns.length === 0) missingFields.push("corporateAnnouncements");
    if (verifiedExpansionCount === 0) missingFields.push("verifiedOrderBookOrCapexFiling");

    return {
      symbol: params.symbol,
      verifiedExpansionCount,
      unverifiedClaimsCount,
      categoriesDetected: Array.from(new Set(anns.map((a) => a.category))),
      announcements: anns.slice(0, 10),
      evidence: anns.slice(0, 5).map((a) => a.evidence),
      missingFields,
    };
  }
}

export class Strategy03TechnicalResearchService {
  public async evaluate(params: {
    symbol: string;
    candlesOverride?: StrategyCandle[];
    niftyCandlesOverride?: StrategyCandle[];
    deliveryRecord?: NseDeliveryRecord | null;
  }): Promise<TechnicalResearchOutput> {
    const candles =
      params.candlesOverride ??
      (await fetchReadOnlyNseDailyCandles(params.symbol, "1y").then((r) => r.candles).catch(() => []));

    const missingFields: string[] = [];
    const evidence: Strategy03EvidenceContract[] = [];

    if (candles.length < 50) {
      return {
        symbol: params.symbol,
        trendStructure: "INSUFFICIENT",
        aboveSma50: null,
        aboveSma200: null,
        relativeStrength3MPct: null,
        avg20DTurnoverCr: null,
        latestDeliveryPct: params.deliveryRecord?.deliveryPct ?? null,
        deliveryVerificationStatus: params.deliveryRecord?.evidence.verificationStatus ?? "MISSING",
        majorSupport: null,
        majorResistance: null,
        evidence,
        missingFields: ["dailyOhlcvHistory50PlusBars"],
      };
    }

    const last = candles[candles.length - 1];
    const sma50 = candles.slice(-50).reduce((s, c) => s + c.close, 0) / 50;
    const sma200 =
      candles.length >= 200
        ? candles.slice(-200).reduce((s, c) => s + c.close, 0) / 200
        : null;
    const aboveSma50 = last.close > sma50;
    const aboveSma200 = sma200 !== null ? last.close > sma200 : null;
    const trendStructure: TechnicalResearchOutput["trendStructure"] =
      aboveSma50 && (aboveSma200 === null || aboveSma200)
        ? "UPTREND"
        : !aboveSma50 && aboveSma200 === false
          ? "DOWNTREND"
          : "RANGE";

    const avg20DTurnoverCr =
      Math.round(
        (candles.slice(-20).reduce((s, c) => s + c.close * c.volume, 0) / 20 / 1e7) * 100
      ) / 100;

    let rs3M: number | null = null;
    const nifty = params.niftyCandlesOverride ?? [];
    if (candles.length >= 63 && nifty.length >= 63) {
      const sRet = (last.close - candles[candles.length - 63].close) / candles[candles.length - 63].close;
      const nLast = nifty[nifty.length - 1].close;
      const nPrev = nifty[nifty.length - 63].close;
      const nRet = (nLast - nPrev) / nPrev;
      rs3M = Math.round((sRet - nRet) * 10000) / 100;
    } else {
      missingFields.push("relativeStrengthVsNifty3M");
    }

    const recent60 = candles.slice(-60);
    const majorSupport = Math.round(Math.min(...recent60.map((c) => c.low)) * 100) / 100;
    const majorResistance = Math.round(Math.max(...recent60.map((c) => c.high)) * 100) / 100;

    evidence.push({
      sourceName: "Yahoo Finance Daily OHLCV",
      sourceUrlOrFilingId: `https://finance.yahoo.com/quote/${encodeURIComponent(params.symbol)}.NS`,
      reportingPeriod: new Date(last.time).toISOString().slice(0, 10),
      publishedAt: new Date(last.time).toISOString(),
      retrievedAt: new Date().toISOString(),
      verificationStatus: "VERIFIED",
      confidence: 0.95,
      hasSourceConflict: false,
    });

    if (params.deliveryRecord) {
      evidence.push(params.deliveryRecord.evidence);
    } else {
      missingFields.push("nseDeliveryPct");
    }

    return {
      symbol: params.symbol,
      trendStructure,
      aboveSma50,
      aboveSma200,
      relativeStrength3MPct: rs3M,
      avg20DTurnoverCr,
      latestDeliveryPct: params.deliveryRecord?.deliveryPct ?? null,
      deliveryVerificationStatus: params.deliveryRecord?.evidence.verificationStatus ?? "MISSING",
      majorSupport,
      majorResistance,
      evidence,
      missingFields,
    };
  }
}

export class Strategy03EvidenceVerifier {
  public verify(params: {
    fundamental: FundamentalResearchOutput;
    institutional: InstitutionalResearchOutput;
    corporate: CorporateResearchOutput;
    technical: TechnicalResearchOutput;
  }): {
    hasCriticalFailure: boolean;
    mustWaitReason: string | null;
    conflicts: string[];
    missingData: string[];
    allEvidence: Strategy03EvidenceContract[];
  } {
    const conflicts: string[] = [];
    const missingData = Array.from(
      new Set([
        ...params.fundamental.missingFields,
        ...params.institutional.missingFields,
        ...params.corporate.missingFields,
        ...params.technical.missingFields,
      ])
    );
    const allEvidence = [
      ...params.fundamental.evidence,
      ...params.institutional.evidence,
      ...params.corporate.evidence,
      ...params.technical.evidence,
    ];

    for (const ev of allEvidence) {
      if (ev.hasSourceConflict || ev.verificationStatus === "CONFLICTED") {
        conflicts.push(`Source conflict in ${ev.sourceName} (${ev.reportingPeriod}).`);
      }
      if (ev.publishedAt && isTimestampStale(ev.publishedAt, 180) && ev.sourceName.includes("Result")) {
        conflicts.push(`Stale official result filing (${ev.publishedAt}).`);
      }
    }

    if (!params.fundamental.periodsCompatible) {
      conflicts.push("Incompatible reporting periods compared in fundamental analysis.");
    }

    let mustWaitReason: string | null = null;
    if (conflicts.length > 0) {
      mustWaitReason = conflicts[0];
    } else if (params.fundamental.freshnessStatus === "STALE" || params.fundamental.freshnessStatus === "UNKNOWN") {
      mustWaitReason = `Official quarterly result freshness is ${params.fundamental.freshnessStatus}.`;
    } else if (
      params.institutional.shareholdingVerificationStatus === "UNVERIFIED" ||
      params.institutional.shareholdingVerificationStatus === "MISSING"
    ) {
      mustWaitReason = `Shareholding data status is ${params.institutional.shareholdingVerificationStatus} (third-party or missing).`;
    } else if (params.technical.trendStructure === "INSUFFICIENT") {
      mustWaitReason = "Insufficient historical OHLCV data for technical confirmation.";
    }

    return {
      hasCriticalFailure: mustWaitReason !== null,
      mustWaitReason,
      conflicts,
      missingData,
      allEvidence,
    };
  }
}

export class Strategy03ScoringEngine {
  constructor(private readonly weights: Strategy03ScoringWeights = DEFAULT_STRATEGY03_SCORING_WEIGHTS) {}

  public score(params: {
    fundamental: FundamentalResearchOutput;
    institutional: InstitutionalResearchOutput;
    corporate: CorporateResearchOutput;
    technical: TechnicalResearchOutput;
  }): {
    totalScore: number;
    factorScores: Record<keyof Strategy03ScoringWeights, FactorScoreDetail>;
    positiveFactors: string[];
    negativeFactors: string[];
  } {
    const f = params.fundamental;
    const inst = params.institutional;
    const corp = params.corporate;
    const tech = params.technical;
    const pos: string[] = [];
    const neg: string[] = [];

    // 1. Future growth potential (20) — zero points for missing data
    let fgScore = 0;
    if (f.revenueGrowthYoYPct !== null) {
      if (f.revenueGrowthYoYPct >= 15) { fgScore += 10; pos.push(`Revenue YoY +${f.revenueGrowthYoYPct}%`); }
      else if (f.revenueGrowthYoYPct >= 5) fgScore += 5;
      else neg.push(`Weak Revenue YoY (${f.revenueGrowthYoYPct}%)`);
    }
    if (f.epsGrowthYoYPct !== null) {
      if (f.epsGrowthYoYPct >= 15) { fgScore += 10; pos.push(`EPS YoY +${f.epsGrowthYoYPct}%`); }
      else if (f.epsGrowthYoYPct >= 5) fgScore += 5;
      else neg.push(`Weak EPS YoY (${f.epsGrowthYoYPct}%)`);
    }
    fgScore = Math.min(this.weights.futureGrowthPotential, fgScore);

    // 2. Earnings quality (20)
    let eqScore = 0;
    if (f.netProfitGrowthYoYPct !== null && f.netProfitGrowthYoYPct >= 10) eqScore += 10;
    if (f.operatingCashFlowCr !== null && f.operatingCashFlowCr > 0) {
      eqScore += 10;
      pos.push(`Positive OCF ₹${f.operatingCashFlowCr} Cr`);
    } else if (f.operatingCashFlowCr !== null && f.operatingCashFlowCr <= 0) {
      neg.push("Negative Operating Cash Flow");
    }
    eqScore = Math.min(this.weights.earningsQuality, eqScore);

    // 3. Institutional ownership (15) — never award points for UNVERIFIED/MISSING/CONFLICTED
    let ioScore = 0;
    if (inst.shareholdingVerificationStatus === "VERIFIED") {
      if (inst.fiiDeltaPct !== null && inst.fiiDeltaPct > 0) { ioScore += 7; pos.push(`FII QoQ +${inst.fiiDeltaPct}%`); }
      if (inst.diiDeltaPct !== null && inst.diiDeltaPct > 0) { ioScore += 5; pos.push(`DII QoQ +${inst.diiDeltaPct}%`); }
      if (inst.repeatedDealPatterns.some((p) => p.side === "BUY")) ioScore += 3;
    }
    ioScore = Math.min(this.weights.institutionalOwnership, ioScore);

    // 4. Financial strength (15)
    let fsScore = 0;
    if (f.rocePct !== null) {
      if (f.rocePct >= 15) { fsScore += 8; pos.push(`ROCE ${f.rocePct}%`); }
      else if (f.rocePct >= 10) fsScore += 4;
      else neg.push(`Low ROCE (${f.rocePct}%)`);
    }
    if (f.debtToEquity !== null) {
      if (f.debtToEquity <= 0.5) fsScore += 7;
      else if (f.debtToEquity <= 1.0) fsScore += 3;
      else neg.push(`High Debt/Equity (${f.debtToEquity})`);
    }
    fsScore = Math.min(this.weights.financialStrength, fsScore);

    // 5. Valuation (10)
    let valScore = 0;
    if (f.trailingPE !== null) {
      if (f.trailingPE > 0 && f.trailingPE <= 30) valScore += 6;
      else if (f.trailingPE > 60) neg.push(`Elevated P/E (${f.trailingPE}x)`);
      else if (f.trailingPE > 0) valScore += 3;
    }
    if (f.priceToBook !== null && f.priceToBook > 0 && f.priceToBook <= 5) valScore += 4;
    valScore = Math.min(this.weights.valuation, valScore);

    // 6. Business expansion (10)
    let beScore = 0;
    if (corp.verifiedExpansionCount > 0) {
      beScore = Math.min(this.weights.businessExpansion, corp.verifiedExpansionCount * 5);
      pos.push(`${corp.verifiedExpansionCount} verified expansion/order filing(s)`);
    }

    // 7. Technical confirmation (10)
    let tcScore = 0;
    if (tech.trendStructure === "UPTREND") tcScore += 5;
    if (tech.avg20DTurnoverCr !== null && tech.avg20DTurnoverCr >= 5) tcScore += 3;
    if (tech.deliveryVerificationStatus === "VERIFIED" && (tech.latestDeliveryPct ?? 0) >= 45) tcScore += 2;
    tcScore = Math.min(this.weights.technicalConfirmation, tcScore);

    const factorScores: Record<keyof Strategy03ScoringWeights, FactorScoreDetail> = {
      futureGrowthPotential: {
        key: "futureGrowthPotential",
        label: "Future Growth Potential",
        score: fgScore,
        maxScore: this.weights.futureGrowthPotential,
        explanation: f.revenueGrowthYoYPct !== null || f.epsGrowthYoYPct !== null ? "Scored from verified YoY revenue/EPS growth." : "Missing YoY growth data (0 pts).",
        evidenceSources: f.evidence.map((e) => e.sourceName),
      },
      earningsQuality: {
        key: "earningsQuality",
        label: "Earnings Quality",
        score: eqScore,
        maxScore: this.weights.earningsQuality,
        explanation: f.operatingCashFlowCr !== null ? "Scored from profit growth and OCF." : "Missing OCF/profit growth (0 pts).",
        evidenceSources: f.evidence.map((e) => e.sourceName),
      },
      institutionalOwnership: {
        key: "institutionalOwnership",
        label: "Institutional Ownership",
        score: ioScore,
        maxScore: this.weights.institutionalOwnership,
        explanation: inst.shareholdingVerificationStatus === "VERIFIED" ? "Scored from verified QoQ FII/DII changes." : `Status=${inst.shareholdingVerificationStatus}; 0 pts awarded.`,
        evidenceSources: inst.evidence.map((e) => e.sourceName),
      },
      financialStrength: {
        key: "financialStrength",
        label: "Financial Strength",
        score: fsScore,
        maxScore: this.weights.financialStrength,
        explanation: f.rocePct !== null || f.debtToEquity !== null ? "Scored from ROCE and Debt/Equity." : "Missing ROCE/D:E (0 pts).",
        evidenceSources: f.evidence.map((e) => e.sourceName),
      },
      valuation: {
        key: "valuation",
        label: "Valuation",
        score: valScore,
        maxScore: this.weights.valuation,
        explanation: f.trailingPE !== null || f.priceToBook !== null ? "Scored from trailing P/E & P/B." : "Missing valuation multiples (0 pts).",
        evidenceSources: f.evidence.map((e) => e.sourceName),
      },
      businessExpansion: {
        key: "businessExpansion",
        label: "Business Expansion",
        score: beScore,
        maxScore: this.weights.businessExpansion,
        explanation: corp.verifiedExpansionCount > 0 ? "Scored from verified order/capex filings." : "No verified expansion filings (0 pts).",
        evidenceSources: corp.evidence.map((e) => e.sourceName),
      },
      technicalConfirmation: {
        key: "technicalConfirmation",
        label: "Technical Confirmation",
        score: tcScore,
        maxScore: this.weights.technicalConfirmation,
        explanation: tech.trendStructure !== "INSUFFICIENT" ? `Trend=${tech.trendStructure}, 20D Turnover=₹${tech.avg20DTurnoverCr ?? 0} Cr.` : "Insufficient OHLCV.",
        evidenceSources: tech.evidence.map((e) => e.sourceName),
      },
    };

    const totalScore =
      fgScore + eqScore + ioScore + fsScore + valScore + beScore + tcScore;

    return { totalScore, factorScores, positiveFactors: pos, negativeFactors: neg };
  }
}

export interface Strategy03EvaluationStore {
  save(evalResult: Strategy03EvaluationResult): Promise<void>;
  list(params?: { limit?: number; offset?: number; decision?: string }): Promise<Strategy03EvaluationResult[]>;
  getBySymbol(symbol: string): Promise<Strategy03EvaluationResult[]>;
}

export class InMemoryStrategy03EvaluationStore implements Strategy03EvaluationStore {
  private rows = new Map<string, Strategy03EvaluationResult>();

  async save(evalResult: Strategy03EvaluationResult): Promise<void> {
    for (const r of this.rows.values()) {
      if (r.idempotencyKey === evalResult.idempotencyKey) return;
    }
    this.rows.set(evalResult.evaluationId, evalResult);
  }

  async list(params?: { limit?: number; offset?: number; decision?: string }): Promise<Strategy03EvaluationResult[]> {
    const all = Array.from(this.rows.values())
      .filter((r) => !params?.decision || r.decision === params.decision)
      .sort((a, b) => b.totalScore - a.totalScore || b.evaluatedAt.localeCompare(a.evaluatedAt));
    const off = params?.offset ?? 0;
    const lim = params?.limit ?? 50;
    return all.slice(off, off + lim);
  }

  async getBySymbol(symbol: string): Promise<Strategy03EvaluationResult[]> {
    return Array.from(this.rows.values())
      .filter((r) => r.symbol === symbol.toUpperCase())
      .sort((a, b) => b.evaluatedAt.localeCompare(a.evaluatedAt));
  }
}

export class SupabaseStrategy03EvaluationStore implements Strategy03EvaluationStore {
  async save(evalResult: Strategy03EvaluationResult): Promise<void> {
    const sb = getAdminSupabaseClient();
    const { error } = await (sb as any)
      .from("strategy03_research_evaluations")
      .upsert(
        {
          evaluation_id: evalResult.evaluationId,
          run_id: evalResult.runId,
          idempotency_key: evalResult.idempotencyKey,
          symbol: evalResult.symbol,
          isin: evalResult.isin,
          company_name: evalResult.companyName,
          decision: evalResult.decision,
          total_score: evalResult.totalScore,
          factor_scores: evalResult.factorScores,
          evidence_summary: evalResult.evidenceSummary,
          positive_factors: evalResult.positiveFactors,
          negative_factors: evalResult.negativeFactors,
          missing_data: evalResult.missingData,
          conflicts: evalResult.conflicts,
          source_references: evalResult.sourceReferences,
          confidence: evalResult.confidence,
          decision_explanation: evalResult.decisionExplanation,
          evaluated_at: evalResult.evaluatedAt,
        },
        { onConflict: "idempotency_key" }
      );
    if (error) throw new Error(`Failed to persist Strategy03 evaluation: ${error.message}`);
  }

  async list(params?: { limit?: number; offset?: number; decision?: string }): Promise<Strategy03EvaluationResult[]> {
    const sb = getAdminSupabaseClient();
    let q = (sb as any).from("strategy03_research_evaluations").select("*");
    if (params?.decision) q = q.eq("decision", params.decision);
    const off = params?.offset ?? 0;
    const lim = params?.limit ?? 50;
    const { data, error } = await q
      .order("total_score", { ascending: false })
      .order("evaluated_at", { ascending: false })
      .range(off, off + lim - 1);
    if (error) throw new Error(`Failed to list Strategy03 evaluations: ${error.message}`);
    return (data || []).map((r: any) => ({
      evaluationId: r.evaluation_id,
      runId: r.run_id,
      idempotencyKey: r.idempotency_key,
      researchOnly: true,
      symbol: r.symbol,
      isin: r.isin ?? null,
      companyName: r.company_name,
      decision: r.decision,
      totalScore: Number(r.total_score),
      factorScores: r.factor_scores,
      evidenceSummary: r.evidence_summary ?? [],
      positiveFactors: r.positive_factors ?? [],
      negativeFactors: r.negative_factors ?? [],
      missingData: r.missing_data ?? [],
      conflicts: r.conflicts ?? [],
      sourceReferences: r.source_references ?? [],
      confidence: Number(r.confidence),
      decisionExplanation: r.decision_explanation,
      evaluatedAt: r.evaluated_at,
    }));
  }

  async getBySymbol(symbol: string): Promise<Strategy03EvaluationResult[]> {
    const sb = getAdminSupabaseClient();
    const { data, error } = await (sb as any)
      .from("strategy03_research_evaluations")
      .select("*")
      .eq("symbol", symbol.toUpperCase())
      .order("evaluated_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(`Failed to load Strategy03 history: ${error.message}`);
    return (data || []).map((r: any) => ({
      evaluationId: r.evaluation_id,
      runId: r.run_id,
      idempotencyKey: r.idempotency_key,
      researchOnly: true,
      symbol: r.symbol,
      isin: r.isin ?? null,
      companyName: r.company_name,
      decision: r.decision,
      totalScore: Number(r.total_score),
      factorScores: r.factor_scores,
      evidenceSummary: r.evidence_summary ?? [],
      positiveFactors: r.positive_factors ?? [],
      negativeFactors: r.negative_factors ?? [],
      missingData: r.missing_data ?? [],
      conflicts: r.conflicts ?? [],
      sourceReferences: r.source_references ?? [],
      confidence: Number(r.confidence),
      decisionExplanation: r.decision_explanation,
      evaluatedAt: r.evaluated_at,
    }));
  }
}

export class Strategy03ResearchEvaluator {
  private readonly fundamentalSvc = new Strategy03FundamentalResearchService();
  private readonly institutionalSvc = new Strategy03InstitutionalResearchService();
  private readonly corporateSvc = new Strategy03CorporateResearchService();
  private readonly technicalSvc = new Strategy03TechnicalResearchService();
  private readonly verifier = new Strategy03EvidenceVerifier();
  private readonly scorer = new Strategy03ScoringEngine();
  private readonly store: Strategy03EvaluationStore;

  constructor(store?: Strategy03EvaluationStore) {
    this.store = store ?? new SupabaseStrategy03EvaluationStore();
  }

  public async evaluateSymbol(params: {
    symbol: string;
    isin?: string | null;
    companyName?: string;
    bseCode?: string | null;
    runId?: string;
    persist?: boolean;
    fundamentalOverride?: Partial<FundamentalResearchOutput>;
    shareholdingOverride?: ShareholdingQuarterRecord[];
    deals?: BulkBlockDealRecord[];
    announcementsOverride?: CorporateAnnouncementRecord[];
    candlesOverride?: StrategyCandle[];
    niftyCandlesOverride?: StrategyCandle[];
    deliveryRecord?: NseDeliveryRecord | null;
  }): Promise<Strategy03EvaluationResult> {
    const symbol = params.symbol.trim().toUpperCase();
    const companyName = params.companyName ?? symbol;
    const runId = params.runId ?? crypto.randomUUID();
    const evaluatedAt = new Date().toISOString();

    const [fundamental, institutional, corporate, technical] = await Promise.all([
      this.fundamentalSvc.evaluate({ symbol, bseCode: params.bseCode ?? null, overrideData: params.fundamentalOverride }),
      this.institutionalSvc.evaluate({ symbol, shareholdingOverride: params.shareholdingOverride, deals: params.deals }),
      this.corporateSvc.evaluate({ symbol, companyName, bseCode: params.bseCode ?? null, announcementsOverride: params.announcementsOverride }),
      this.technicalSvc.evaluate({ symbol, candlesOverride: params.candlesOverride, niftyCandlesOverride: params.niftyCandlesOverride, deliveryRecord: params.deliveryRecord }),
    ]);

    const verification = this.verifier.verify({ fundamental, institutional, corporate, technical });
    const scored = this.scorer.score({ fundamental, institutional, corporate, technical });

    // Deterministic decision authority: critical missing/stale/unverified/conflicted -> WAIT
    let decision: Strategy03EvaluationResult["decision"] = "REJECT";
    let decisionExplanation = "";
    if (verification.hasCriticalFailure) {
      decision = "WAIT";
      decisionExplanation = `WAIT (Deterministic Gate): ${verification.mustWaitReason}`;
    } else if (scored.totalScore >= 65 && technical.trendStructure === "UPTREND") {
      decision = "ENTER_CANDIDATE";
      decisionExplanation = `ENTER_CANDIDATE (Research Only): Score ${scored.totalScore}/100 with verified fundamentals, ownership, and UPTREND confirmation.`;
    } else if (scored.totalScore >= 45) {
      decision = "WAIT";
      decisionExplanation = `WAIT (Research Only): Score ${scored.totalScore}/100 below candidate threshold or awaiting stronger trend/fundamental alignment.`;
    } else {
      decision = "REJECT";
      decisionExplanation = `REJECT (Research Only): Score ${scored.totalScore}/100 insufficient under verified evidence.`;
    }

    const sourceReferences = Array.from(
      new Set(verification.allEvidence.map((e) => `${e.sourceName}: ${e.sourceUrlOrFilingId}`))
    );
    const verifiedCount = verification.allEvidence.filter((e) => e.verificationStatus === "VERIFIED").length;
    const confidence =
      verification.allEvidence.length > 0
        ? Math.round((verifiedCount / verification.allEvidence.length) * 100) / 100
        : 0;

    const result: Strategy03EvaluationResult = {
      evaluationId: crypto.randomUUID(),
      runId,
      idempotencyKey: `S03:${symbol}:${evaluatedAt.slice(0, 10)}:${runId}`,
      researchOnly: true,
      symbol,
      isin: params.isin ?? null,
      companyName,
      decision,
      totalScore: scored.totalScore,
      factorScores: scored.factorScores,
      evidenceSummary: verification.allEvidence,
      positiveFactors: scored.positiveFactors,
      negativeFactors: scored.negativeFactors,
      missingData: verification.missingData,
      conflicts: verification.conflicts,
      sourceReferences,
      confidence,
      decisionExplanation,
      evaluatedAt,
    };

    if (params.persist) {
      await this.store.save(result);
    }
    return result;
  }

  public async listResults(params?: { limit?: number; offset?: number; decision?: string }) {
    return this.store.list(params);
  }

  public async getSymbolHistory(symbol: string) {
    return this.store.getBySymbol(symbol);
  }
}

export const strategy03ResearchEvaluator = new Strategy03ResearchEvaluator();
