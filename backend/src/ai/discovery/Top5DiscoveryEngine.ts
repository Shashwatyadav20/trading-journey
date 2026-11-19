import { randomUUID } from "node:crypto";
import { compileCompanyResearchReport } from "../../../../lib/ai/companyResearchEngine";
import {
  getAdminSupabaseClient,
  isSupabaseConfigured,
} from "../../db/supabaseClient";
import { ExternalCompanyResearchSnapshot } from "../evidence/EvidenceCollector";
import {
  computeResearchConfidence,
  type MultiDimensionalConfidence,
} from "./ConfidenceEngine";
import {
  fundamentalsVerificationService,
  type DataFreshnessStatus,
  type VerifiedCompanyFundamentalsResult,
} from "./FundamentalsVerificationService";
import {
  MarketCapCategory,
  MarketUniverseEquity,
  MarketUniverseService,
  marketUniverseService,
} from "./MarketUniverseService";

export type DiscoveryRiskProfile = "CONSERVATIVE" | "BALANCED" | "AGGRESSIVE";
export type MinDataQualityFilter = "COMPLETE" | "PARTIAL" | "ANY";

export interface Top5DiscoveryFilters {
  marketCap: MarketCapCategory | "ALL";
  sector?: string;
  industry?: string;
  riskProfile: DiscoveryRiskProfile;
  minDataQuality: MinDataQualityFilter;
  minLiquidityCr?: number;
}

export const RESEARCH_METHODOLOGY_WEIGHTS = {
  version: "PHASE_9_6_12_V1",
  factors: [
    { id: "fundamental_quality", label: "Fundamental Quality", weightPct: 10 },
    { id: "revenue_earnings_growth", label: "Revenue & Earnings Growth", weightPct: 10 },
    { id: "profitability_roce_roe", label: "Profitability & ROCE/ROE", weightPct: 12 },
    { id: "balance_sheet_strength", label: "Balance Sheet Strength", weightPct: 10 },
    { id: "cash_flow_quality", label: "Cash Flow Quality", weightPct: 10 },
    { id: "valuation_attractiveness", label: "Valuation Attractiveness", weightPct: 10 },
    { id: "institutional_ownership", label: "Institutional Ownership Trends", weightPct: 8 },
    { id: "promoter_quality_pledge", label: "Promoter Quality & Pledge Risk", weightPct: 8 },
    { id: "industry_sector_outlook", label: "Industry & Sector Outlook", weightPct: 5 },
    { id: "news_macro_environment", label: "News & Macro Environment", weightPct: 5 },
    { id: "liquidity_trading_risk", label: "Liquidity & Trading Risk", weightPct: 4 },
    { id: "evidence_quality_freshness", label: "Evidence Quality & Data Freshness", weightPct: 8 },
  ],
  disclaimer:
    "Research scores measure historical fundamental strength and evidence quality only — never probability of future price returns, target prices, or buy/sell recommendations.",
} as const;

export interface Top5ResearchCandidate {
  rank: number;
  symbol: string;
  companyName: string;
  exchange: string;
  isin: string;
  marketCapCr: number | null;
  marketCapCategory: MarketCapCategory;
  sector: string | null;
  industry: string | null;
  reportingPeriod: string | null;
  // Separated quality & risk dimensions (never probability of returns)
  compositeResearchScore: number;
  researchQualityScore: number;
  businessQualityScore: number;
  valuationAttractivenessScore: number;
  riskLevel: "LOW" | "MODERATE" | "HIGH";
  evidenceConfidence: "HIGH" | "MODERATE" | "LOW" | "INSUFFICIENT";
  researchConclusion: string;
  valuationAssessment: string;
  financialStrength: string;
  institutionalActivity: string;
  whySelected: {
    summary: string;
    supportingMetrics: string[];
    growthEvidence: string;
    balanceSheetAndCashFlow: string;
    valuationVsPeers: string;
    institutionalTrends: string;
    competitiveAdvantages: string;
  };
  risks: string[];
  investmentResearchView: {
    whyConsiderResearching: string;
    thesisInvalidationTriggers: string[];
    developmentsToMonitor: string[];
    missingInformation: string[];
  };
  dataProvenance: {
    sourceName: string;
    sourceUrl?: string | null;
    retrievalTimestamp: string;
    publicationTimestamp: string | null;
    metricVerificationStatus: "UNVERIFIED" | "PARTIAL" | "VERIFIED";
  };
  factorBreakdown?: {
    factors: Array<{ id: string; label: string; points: number; maxWeightPct: number }>;
    rawUncappedTotal: number;
    safeguardCapsApplied: string[];
    finalCompositeScore: number;
  };
  confidenceBreakdown?: MultiDimensionalConfidence;
  metricVerificationSummary?: {
    verifiedMetricCount: number;
    unverifiedMetricCount: number;
    missingMetricCount: number;
    freshnessStatus: DataFreshnessStatus;
    staleWarnings: string[];
    officialFilingHeadline?: string | null;
  };
}

export interface RankingVersionDiffItem {
  symbol: string;
  companyName: string;
  previousRank: number | null;
  newRank: number;
  rankChange: string;
  previousScore: number | null;
  newScore: number;
  scoreChange: number | null;
  previousConfidence: string | null;
  newConfidence: string;
  reasonForChange: string;
}

export interface RankingVersionSnapshot {
  version: number;
  publishedAt: string;
  label: string;
  methodologyVersion: string;
  topPicks: Top5ResearchCandidate[];
  diffsFromPrevious?: RankingVersionDiffItem[];
}

export interface MarketDiscoveryScanResult {
  scanId: string;
  userId: string;
  status: "COMPLETED" | "PARTIAL" | "FAILED";
  scanCompleteness: "COMPLETE_SCAN" | "PARTIAL_SCAN";
  publishedFinalTop5: boolean;
  publicationLabel: "OVERALL TOP 5" | "PARTIAL SCAN — PROVISIONAL CANDIDATES ONLY";
  completionPct: number;
  filters: Top5DiscoveryFilters;
  totalUniverseCount: number;
  eligibleAfterFiltersCount: number;
  scannedCount: number;
  succeededCount: number;
  failedCount: number;
  excludedCount?: number;
  pendingCount?: number;
  retryPendingCount?: number;
  remainingCount: number;
  cursorOffset: number;
  nextCursorOffset: number | null;
  failedSymbols: Array<{
    symbol: string;
    isin?: string;
    reason: string;
    retries?: number;
    legacyRetries?: number;
    postFixRetries?: number;
    resolverFixVersion?: string;
    status?: "FAILED" | "EXCLUDED_UNAVAILABLE_DATA";
    exclusionReason?: string;
    excludedAt?: string;
  }>;
  methodology: typeof RESEARCH_METHODOLOGY_WEIGHTS;
  topPicks: Top5ResearchCandidate[];
  version?: number;
  rankingHistory?: RankingVersionSnapshot[];
  startedAt: string;
  completedAt: string;
  advisoryDisclaimer: string;
}

export type DiscoverySnapshotFetcher = (
  symbol: string,
  equity?: MarketUniverseEquity
) => Promise<ExternalCompanyResearchSnapshot>;

/** Maximum provider attempts per symbol before it is recorded as a terminal (permanent) failure. */
export const MAX_SYMBOL_RETRIES = 3;

/** Fix-version tag for the BSE `<SYMBOL>.BO` resolver fix (allows bounded post-fix retries without erasing history). */
export const CURRENT_RESOLVER_FIX_VERSION = "BSE_SYMBOL_BO_V2";
export const MAX_POST_FIX_RETRIES = 2;

export interface FailedSymbolEntry {
  symbol?: string;
  reason: string;
  retries: number;
  legacyRetries?: number;
  postFixRetries?: number;
  resolverFixVersion?: string;
  status?: "FAILED" | "EXCLUDED_UNAVAILABLE_DATA";
  exclusionReason?: string;
  excludedAt?: string;
}

export function isFailedSymbolRetryEligible(f: FailedSymbolEntry): boolean {
  if (f.status === "EXCLUDED_UNAVAILABLE_DATA") {
    return false;
  }
  if (f.resolverFixVersion === CURRENT_RESOLVER_FIX_VERSION) {
    return (f.postFixRetries ?? 0) < MAX_POST_FIX_RETRIES;
  }
  return f.retries < MAX_SYMBOL_RETRIES;
}

/**
 * Resolves the exchange-correct Yahoo ticker for a universe equity.
 * NSE / dual-listed equities use `<NSE_SYMBOL>.NS`; BSE-only equities use `<BSE_SYMBOL>.BO`
 * (Yahoo indexes BSE equities by their BSE scrip_id symbol rather than numeric scrip code).
 * Never maps a BSE-only scrip onto a guessed NSE symbol.
 */
export function resolveDiscoveryYahooTicker(equity: MarketUniverseEquity): string | null {
  if (equity.nseSymbol) return `${equity.nseSymbol}.NS`;
  if (equity.symbol && equity.symbol.trim()) return `${equity.symbol.trim().toUpperCase()}.BO`;
  if (equity.bseCode && /^\d+$/.test(equity.bseCode)) return `${equity.bseCode}.BO`;
  return null;
}

async function defaultDiscoverySnapshotFetcher(
  symbol: string,
  equity?: MarketUniverseEquity
): Promise<ExternalCompanyResearchSnapshot> {
  const ticker = equity ? resolveDiscoveryYahooTicker(equity) : `${symbol}.NS`;
  if (!ticker) {
    throw new Error(
      "UNSUPPORTED_LISTING: no NSE symbol or numeric BSE scrip code available for exchange-correct lookup."
    );
  }
  const report = await compileCompanyResearchReport(symbol, {
    yahooTickerOverride: ticker,
  });
  const telemetry = (report as { dataTelemetry?: { fundamentalsSource?: string } })
    .dataTelemetry;
  if (telemetry && telemetry.fundamentalsSource !== "YAHOO_QUOTE_SUMMARY_LIVE") {
    throw new Error(
      `FUNDAMENTALS_UNAVAILABLE: live fundamentals not returned for ${ticker}.`
    );
  }
  return report;
}

function clampScore(v: number, min = 0, max = 100): number {
  return Math.round(Math.max(min, Math.min(max, v)) * 10) / 10;
}

export function evaluateCompanyForDiscovery(params: {
  equity: MarketUniverseEquity;
  snapshot: ExternalCompanyResearchSnapshot;
  riskProfile: DiscoveryRiskProfile;
  verifiedEvidence?: VerifiedCompanyFundamentalsResult;
}): {
  candidate: Top5ResearchCandidate;
  dataQualityClass: "COMPLETE" | "PARTIAL" | "INSUFFICIENT";
} {
  const { equity, riskProfile, verifiedEvidence } = params;
  const snapshot = verifiedEvidence?.enrichedSnapshot ?? params.snapshot;
  const f = snapshot.fundamentals;
  const h = snapshot.institutionalHoldings;
  const revenueCr = f.revenueCr ?? null;
  const netProfitCr = f.netProfitCr ?? null;
  const rocePct = f.rocePct ?? null;
  const ocfCr = f.operatingCashFlowCr ?? null;
  const fcfCr = f.freeCashFlowCr ?? null;
  const promoterPledgePct = f.promoterPledgePct ?? null;

  const missingInfo: string[] = [];
  if (revenueCr === null) missingInfo.push("Revenue");
  if (netProfitCr === null) missingInfo.push("Net Profit");
  if (f.roePct === null) missingInfo.push("ROE");
  if (rocePct === null) missingInfo.push("ROCE");
  if (f.debtToEquity === null) missingInfo.push("Debt-to-Equity");
  if (ocfCr === null) missingInfo.push("Operating Cash Flow");
  if (fcfCr === null) missingInfo.push("Free Cash Flow");
  if (f.trailingPE === null) missingInfo.push("Trailing P/E");
  if (promoterPledgePct === null) missingInfo.push("Promoter Pledge");
  if (h.institutionsPercentHeld === null) missingInfo.push("Institutional Holding");

  const criticalMissingCount = [
    revenueCr,
    netProfitCr,
    f.roePct,
    f.debtToEquity,
    ocfCr,
  ].filter((v) => v === null).length;

  const dataQualityClass: "COMPLETE" | "PARTIAL" | "INSUFFICIENT" =
    criticalMissingCount >= 3
      ? "INSUFFICIENT"
      : missingInfo.length <= 2
        ? "COMPLETE"
        : "PARTIAL";

  // 12-factor scoring (deterministic, evidence-grounded)
  const profitabilityPts =
    (f.roePct !== null && f.roePct >= 15 ? 7 : f.roePct !== null && f.roePct >= 10 ? 4 : 1) +
    (rocePct !== null && rocePct >= 18 ? 5 : rocePct !== null && rocePct >= 12 ? 3 : 0);

  const growthPts =
    (f.quarterlyRevenueGrowthPct !== null && f.quarterlyRevenueGrowthPct >= 10 ? 5 : f.quarterlyRevenueGrowthPct !== null && f.quarterlyRevenueGrowthPct > 0 ? 3 : 0) +
    (f.quarterlyEarningsGrowthPct !== null && f.quarterlyEarningsGrowthPct >= 12 ? 5 : f.quarterlyEarningsGrowthPct !== null && f.quarterlyEarningsGrowthPct > 0 ? 3 : 0);

  const balanceSheetPts =
    f.debtToEquity === null
      ? 2
      : f.debtToEquity <= 0.3
        ? 10
        : f.debtToEquity <= 0.7
          ? 7
          : f.debtToEquity <= 1.2
            ? 4
            : 1;

  const cashFlowPts =
    ocfCr !== null && ocfCr > 0
      ? fcfCr !== null && fcfCr > 0
        ? 10
        : 6
      : 1;

  const fundamentalQualityPts =
    f.operatingMarginPct !== null && f.operatingMarginPct >= 15
      ? 9
      : f.operatingMarginPct !== null && f.operatingMarginPct >= 8
        ? 6
        : 2;

  const valuationPts =
    f.trailingPE === null
      ? 2
      : f.trailingPE > 0 && f.trailingPE <= 22
        ? 9
        : f.trailingPE <= 35
          ? 6
          : f.trailingPE <= 50
            ? 3
            : 1;

  const institutionalPts =
    h.institutionsPercentHeld !== null && h.institutionsPercentHeld >= 20
      ? 8
      : h.institutionsPercentHeld !== null && h.institutionsPercentHeld >= 10
        ? 5
        : 2;

  const promoterPts =
    promoterPledgePct === null
      ? 4
      : promoterPledgePct === 0
        ? 8
        : promoterPledgePct <= 5
          ? 5
          : 1;

  const sectorPts = equity.sector ? 4 : 1;

  // Exclude expired news from current news/macro score
  const currentNews = (snapshot.newsAndMacro ?? []).filter(
    (n) => n.publishedAtIso !== null && n.publishedAtIso !== undefined
  );
  const newsPts = currentNews.length > 0 ? 4 : 2;

  const mcap = f.marketCapCr ?? equity.marketCapCr;
  const liquidityPts =
    mcap !== null && mcap >= 5000 ? 4 : mcap !== null && mcap >= 1000 ? 3 : 1;

  const evidenceFreshnessPts =
    (f.reportingPeriod ? 4 : 1) + (f.publishedAt ? 4 : 1);

  let rawTotal =
    fundamentalQualityPts +
    growthPts +
    profitabilityPts +
    balanceSheetPts +
    cashFlowPts +
    valuationPts +
    institutionalPts +
    promoterPts +
    sectorPts +
    newsPts +
    liquidityPts +
    evidenceFreshnessPts;

  const rawUncappedTotal = rawTotal;
  const safeguardCapsApplied: string[] = [];

  // Safeguard caps: missing critical data, high pledge, high debt, or missing timestamps cannot score artificially high
  if (criticalMissingCount >= 2) {
    if (rawTotal > 55) safeguardCapsApplied.push("CRITICAL_MISSING_DATA_CAP_55");
    rawTotal = Math.min(rawTotal, 55);
  }
  if (promoterPledgePct !== null && promoterPledgePct > 15) {
    if (rawTotal > 52) safeguardCapsApplied.push("HIGH_PROMOTER_PLEDGE_CAP_52");
    rawTotal = Math.min(rawTotal, 52);
  }
  if (f.debtToEquity !== null && f.debtToEquity > 1.5) {
    if (rawTotal > 58) safeguardCapsApplied.push("HIGH_DEBT_CAP_58");
    rawTotal = Math.min(rawTotal, 58);
  }
  if (!f.publishedAt) {
    if (rawTotal > 78) safeguardCapsApplied.push("MISSING_PUBLICATION_TIMESTAMP_CAP_78");
    rawTotal = Math.min(rawTotal, 78);
  }

  // Risk profile adjustment (only tilts preference, never overrides safety caps)
  if (riskProfile === "CONSERVATIVE" && f.debtToEquity !== null && f.debtToEquity > 0.8) {
    rawTotal -= 8;
  } else if (riskProfile === "AGGRESSIVE" && f.quarterlyEarningsGrowthPct !== null && f.quarterlyEarningsGrowthPct >= 15) {
    rawTotal += 3;
  }

  const businessQualityScore = clampScore(
    ((fundamentalQualityPts + growthPts + profitabilityPts + balanceSheetPts + cashFlowPts) / 52) * 100
  );
  const valuationAttractivenessScore = clampScore((valuationPts / 10) * 100);
  const researchQualityScore = clampScore(
    ((10 - missingInfo.length) / 10) * 60 + (evidenceFreshnessPts / 8) * 40
  );
  const compositeResearchScore = clampScore(rawTotal);

  const hasHighRisk =
    (f.debtToEquity !== null && f.debtToEquity > 1.2) ||
    (promoterPledgePct !== null && promoterPledgePct > 10) ||
    (ocfCr !== null && ocfCr < 0) ||
    criticalMissingCount >= 3;

  const riskLevel: Top5ResearchCandidate["riskLevel"] = hasHighRisk
    ? "HIGH"
    : missingInfo.length >= 4 || (f.trailingPE !== null && f.trailingPE > 40)
      ? "MODERATE"
      : "LOW";

  const evidenceConfidence: Top5ResearchCandidate["evidenceConfidence"] =
    dataQualityClass === "INSUFFICIENT"
      ? "INSUFFICIENT"
      : f.publishedAt && missingInfo.length <= 2
        ? "HIGH"
        : missingInfo.length <= 5
          ? "MODERATE"
          : "LOW";

  const supportingMetrics: string[] = [];
  if (f.roePct !== null) supportingMetrics.push(`ROE: ${f.roePct}%`);
  if (rocePct !== null) supportingMetrics.push(`ROCE: ${rocePct}%`);
  if (f.operatingMarginPct !== null) supportingMetrics.push(`Operating Margin: ${f.operatingMarginPct}%`);
  if (f.debtToEquity !== null) supportingMetrics.push(`Debt/Equity: ${f.debtToEquity}x`);
  if (ocfCr !== null) supportingMetrics.push(`Operating Cash Flow: ₹${ocfCr} Cr`);

  const risks: string[] = [];
  if (f.trailingPE !== null && f.trailingPE > 35) {
    risks.push(`Elevated valuation multiple (Trailing P/E: ${f.trailingPE}x).`);
  }
  if (f.debtToEquity !== null && f.debtToEquity > 0.8) {
    risks.push(`Leverage risk (Debt/Equity: ${f.debtToEquity}x).`);
  }
  if (promoterPledgePct !== null && promoterPledgePct > 5) {
    risks.push(`Promoter share pledge disclosed (${promoterPledgePct}%).`);
  }
  if (f.quarterlyEarningsGrowthPct !== null && f.quarterlyEarningsGrowthPct < 0) {
    risks.push(`Recent quarterly earnings contraction (${f.quarterlyEarningsGrowthPct}%).`);
  }
  if (!f.publishedAt) {
    risks.push("Source publication timestamp unavailable for fundamental snapshot.");
  }
  if (missingInfo.length > 0) {
    risks.push(`Missing financial fields (${missingInfo.length}): ${missingInfo.join(", ")}.`);
  }

  const candidate: Top5ResearchCandidate = {
    rank: 0,
    symbol: equity.symbol,
    companyName: snapshot.companyName ?? equity.companyName,
    exchange: equity.exchange,
    isin: equity.isin,
    marketCapCr: mcap,
    marketCapCategory: equity.marketCapCategory,
    sector: equity.sector,
    industry: equity.industry,
    reportingPeriod: f.reportingPeriod ?? null,
    compositeResearchScore,
    researchQualityScore,
    businessQualityScore,
    valuationAttractivenessScore,
    riskLevel,
    evidenceConfidence,
    researchConclusion:
      evidenceConfidence === "INSUFFICIENT"
        ? "INSUFFICIENT_EVIDENCE (Advisory)"
        : compositeResearchScore >= 70
          ? "CONSTRUCTIVE_RESEARCH_CANDIDATE (Advisory)"
          : "MIXED_EVIDENCE_CANDIDATE (Advisory)",
    valuationAssessment:
      f.trailingPE === null
        ? "Valuation unavailable (missing P/E)"
        : f.trailingPE <= 22
          ? `Moderate valuation (P/E ${f.trailingPE}x)`
          : f.trailingPE <= 35
            ? `Fair-to-full valuation (P/E ${f.trailingPE}x)`
            : `Rich valuation (P/E ${f.trailingPE}x)`,
    financialStrength:
      f.debtToEquity !== null && f.debtToEquity <= 0.5 && (ocfCr ?? 0) > 0
        ? "Strong balance sheet & positive operating cash flow"
        : f.debtToEquity !== null && f.debtToEquity > 1.2
          ? "Elevated leverage profile"
          : "Moderate / partially disclosed financial strength",
    institutionalActivity:
      h.institutionsPercentHeld !== null
        ? `Institutional holding: ${h.institutionsPercentHeld}%`
        : "Institutional holding data unavailable",
    whySelected: {
      summary: `Ranked for ${equity.marketCapCategory} research based on ${supportingMetrics.length} observed financial metrics and ${evidenceConfidence} evidence confidence.`,
      supportingMetrics,
      growthEvidence:
        f.quarterlyRevenueGrowthPct !== null || f.quarterlyEarningsGrowthPct !== null
          ? `Quarterly Revenue Growth: ${f.quarterlyRevenueGrowthPct ?? "N/A"}% · Earnings Growth: ${f.quarterlyEarningsGrowthPct ?? "N/A"}%`
          : "Quarterly growth metrics unavailable",
      balanceSheetAndCashFlow: `Debt/Equity: ${f.debtToEquity ?? "N/A"}x · OCF: ${ocfCr !== null ? `₹${ocfCr} Cr` : "N/A"} · FCF: ${fcfCr !== null ? `₹${fcfCr} Cr` : "N/A"}`,
      valuationVsPeers:
        f.trailingPE !== null
          ? `Trailing P/E: ${f.trailingPE}x · P/B: ${f.priceToBook ?? "N/A"}x`
          : "Peer valuation comparison incomplete",
      institutionalTrends:
        h.institutionsPercentHeld !== null
          ? `Institutions: ${h.institutionsPercentHeld}% · Promoters/Insiders: ${h.insidersPromoterPercentHeld ?? "N/A"}%`
          : "Institutional ownership trend unavailable",
      competitiveAdvantages:
        f.operatingMarginPct !== null && f.operatingMarginPct >= 18
          ? `Operating margin durability (${f.operatingMarginPct}%) supported by financial disclosures.`
          : "No verified competitive moat metric beyond reported margins.",
    },
    risks,
    investmentResearchView: {
      whyConsiderResearching: `Candidate merits further analyst due diligence on ${equity.sector ?? "sector"} fundamentals and ${supportingMetrics.slice(0, 2).join(", ") || "reported filings"}.`,
      thesisInvalidationTriggers: [
        "Sustained decline in operating margins or negative operating cash flow.",
        "Material increase in debt-to-equity or promoter share pledge.",
        "Adverse regulatory, governance, or auditor qualification disclosures.",
      ],
      developmentsToMonitor: [
        "Next quarterly financial filing and consolidated cash flow statement.",
        "FII/DII and mutual fund shareholding changes in exchange disclosures.",
      ],
      missingInformation: missingInfo,
    },
    dataProvenance: {
      sourceName: verifiedEvidence?.officialFiling?.sourceName
        ? `${verifiedEvidence.officialFiling.sourceName} + ${verifiedEvidence.screener ? "Screener.in + " : ""}Yahoo Finance`
        : verifiedEvidence?.screener
          ? "Screener.in + Yahoo Finance"
          : "Yahoo Finance",
      sourceUrl:
        verifiedEvidence?.officialFiling?.sourceUrl ??
        verifiedEvidence?.screener?.sourceUrl ??
        null,
      retrievalTimestamp:
        verifiedEvidence?.retrievedAt ??
        snapshot.fetchedAtIST ??
        new Date().toISOString(),
      publicationTimestamp: f.publishedAt ?? null,
      metricVerificationStatus: verifiedEvidence
        ? verifiedEvidence.verifiedMetricCount >= 8 &&
          verifiedEvidence.freshnessStatus === "FRESH"
          ? "VERIFIED"
          : verifiedEvidence.verifiedMetricCount > 0
            ? "PARTIAL"
            : "UNVERIFIED"
        : "UNVERIFIED",
    },
    factorBreakdown: {
      factors: [
        { id: "fundamental_quality", label: "Fundamental Quality", points: fundamentalQualityPts, maxWeightPct: 12 },
        { id: "revenue_profit_growth", label: "Revenue & Profit Growth", points: growthPts, maxWeightPct: 10 },
        { id: "profitability_capital_efficiency", label: "ROE / ROCE & Capital Efficiency", points: profitabilityPts, maxWeightPct: 12 },
        { id: "balance_sheet_leverage", label: "Balance Sheet & Leverage Safety", points: balanceSheetPts, maxWeightPct: 10 },
        { id: "cash_flow_quality", label: "Cash Flow Quality", points: cashFlowPts, maxWeightPct: 10 },
        { id: "valuation_attractiveness", label: "Valuation Attractiveness", points: valuationPts, maxWeightPct: 10 },
        { id: "institutional_ownership_trend", label: "Institutional & FII/DII Ownership", points: institutionalPts, maxWeightPct: 8 },
        { id: "promoter_stability_pledge", label: "Promoter Stability & Pledge Risk", points: promoterPts, maxWeightPct: 8 },
        { id: "sector_tailwind", label: "Sector Tailwind & Peers", points: sectorPts, maxWeightPct: 4 },
        { id: "news_macro_catalysts", label: "News & Macro Catalysts", points: newsPts, maxWeightPct: 4 },
        { id: "liquidity_trading_risk", label: "Liquidity & Trading Risk", points: liquidityPts, maxWeightPct: 4 },
        { id: "evidence_quality_freshness", label: "Evidence Quality & Data Freshness", points: evidenceFreshnessPts, maxWeightPct: 8 },
      ],
      rawUncappedTotal,
      safeguardCapsApplied,
      finalCompositeScore: compositeResearchScore,
    },
    ...(verifiedEvidence
      ? {
          confidenceBreakdown: computeResearchConfidence(verifiedEvidence),
          metricVerificationSummary: {
            verifiedMetricCount: verifiedEvidence.verifiedMetricCount,
            unverifiedMetricCount: verifiedEvidence.unverifiedMetricCount,
            missingMetricCount: verifiedEvidence.missingMetricCount,
            freshnessStatus: verifiedEvidence.freshnessStatus,
            staleWarnings: verifiedEvidence.staleWarnings,
            officialFilingHeadline: verifiedEvidence.officialFiling?.headline ?? null,
          },
        }
      : {}),
  };

  return { candidate, dataQualityClass };
}

interface ScanJobState {
  scanId: string;
  userId: string;
  filters: Top5DiscoveryFilters;
  startedAt: string;
  cursorOffset: number;
  /** Keyed by ISIN (unique across NSE + BSE). */
  evaluatedBySymbol: Map<string, Top5ResearchCandidate>;
  /** Keyed by ISIN. */
  failedBySymbol: Map<string, FailedSymbolEntry>;
  /** Successful evaluations persisted before a restart that are not held in memory. */
  succeededBase?: number;
  latestResult: MarketDiscoveryScanResult;
}

export class Top5DiscoveryEngine {
  private readonly universeService: MarketUniverseService;
  private readonly snapshotFetcher: DiscoverySnapshotFetcher;
  private readonly snapshotCache = new Map<
    string,
    { snapshot: ExternalCompanyResearchSnapshot; cachedAtMs: number }
  >();
  private readonly userScanHistory = new Map<string, MarketDiscoveryScanResult[]>();
  private readonly scanJobsById = new Map<string, ScanJobState>();
  private readonly activeWorkersByScanId = new Set<string>();
  private readonly scheduledTimersByScanId = new Map<string, NodeJS.Timeout>();

  public constructor(deps?: {
    universeService?: MarketUniverseService;
    snapshotFetcher?: DiscoverySnapshotFetcher;
  }) {
    this.universeService = deps?.universeService ?? marketUniverseService;
    this.snapshotFetcher =
      deps?.snapshotFetcher ?? defaultDiscoverySnapshotFetcher;
  }

  public async runDiscoveryScan(params: {
    userId: string;
    filters?: Partial<Top5DiscoveryFilters>;
    batchSize?: number;
    cursorOffset?: number;
    cacheTtlMs?: number;
  }): Promise<MarketDiscoveryScanResult> {
    const scanId = randomUUID();
    const startedAt = new Date().toISOString();
    const filters: Top5DiscoveryFilters = {
      marketCap: params.filters?.marketCap ?? "ALL",
      sector: params.filters?.sector?.trim() || undefined,
      industry: params.filters?.industry?.trim() || undefined,
      riskProfile: params.filters?.riskProfile ?? "BALANCED",
      minDataQuality: params.filters?.minDataQuality ?? "ANY",
      minLiquidityCr: params.filters?.minLiquidityCr,
    };

    if (this.universeService.getAllEligible().length === 0) {
      await this.universeService.loadUniverseFromSupabase();
    }
    const allEligible = this.universeService.getAllEligible();
    let candidatesPool = allEligible.filter((e) => e.listingStatus === "ACTIVE");

    if (filters.marketCap !== "ALL") {
      candidatesPool = candidatesPool.filter(
        (e) => e.marketCapCategory === filters.marketCap
      );
    }
    if (filters.sector) {
      const s = filters.sector.toLowerCase();
      candidatesPool = candidatesPool.filter(
        (e) => (e.sector ?? "").toLowerCase() === s
      );
    }
    if (filters.industry) {
      const ind = filters.industry.toLowerCase();
      candidatesPool = candidatesPool.filter(
        (e) => (e.industry ?? "").toLowerCase() === ind
      );
    }
    if (typeof filters.minLiquidityCr === "number" && filters.minLiquidityCr > 0) {
      candidatesPool = candidatesPool.filter(
        (e) => (e.marketCapCr ?? 0) >= filters.minLiquidityCr!
      );
    }

    // Deterministic ordering so ranking and resumable cursor are 100% reproducible
    candidatesPool.sort((a, b) => {
      if (a.marketCapRank !== null && b.marketCapRank !== null) {
        return a.marketCapRank - b.marketCapRank;
      }
      if (a.marketCapRank !== null) return -1;
      if (b.marketCapRank !== null) return 1;
      return a.symbol.localeCompare(b.symbol);
    });

    const cursorOffset = Math.max(params.cursorOffset ?? 0, 0);
    const batchSize = Math.min(Math.max(params.batchSize ?? 25, 1), 100);
    const slice = candidatesPool.slice(cursorOffset, cursorOffset + batchSize);
    const cacheTtlMs = params.cacheTtlMs ?? 15 * 60 * 1000;

    const evaluated: Top5ResearchCandidate[] = [];
    const failedSymbols: Array<{ symbol: string; isin?: string; reason: string; retries?: number }> = [];

    // Bounded concurrency <= 3
    for (let i = 0; i < slice.length; i += 3) {
      const batch = slice.slice(i, i + 3);
      const settled = await Promise.allSettled(
        batch.map(async (eq) => {
          const cached = this.snapshotCache.get(eq.isin);
          let snap: ExternalCompanyResearchSnapshot;
          if (cached && Date.now() - cached.cachedAtMs < cacheTtlMs) {
            snap = cached.snapshot;
          } else {
            snap = await this.snapshotFetcher(eq.symbol, eq);
            this.snapshotCache.set(eq.isin, {
              snapshot: snap,
              cachedAtMs: Date.now(),
            });
          }
          return { eq, snap };
        })
      );

      settled.forEach((res, idx) => {
        if (res.status === "fulfilled") {
          const { candidate, dataQualityClass } = evaluateCompanyForDiscovery({
            equity: res.value.eq,
            snapshot: res.value.snap,
            riskProfile: filters.riskProfile,
          });
          if (
            filters.minDataQuality === "COMPLETE" &&
            dataQualityClass !== "COMPLETE"
          ) {
            return;
          }
          if (
            filters.minDataQuality === "PARTIAL" &&
            dataQualityClass === "INSUFFICIENT"
          ) {
            return;
          }
          evaluated.push(candidate);
        } else {
          failedSymbols.push({
            symbol: batch[idx].symbol,
            isin: batch[idx].isin,
            reason:
              res.reason instanceof Error ? res.reason.message : "Provider error",
            retries: 1,
          });
        }
      });
    }

    // Reproducible sort: compositeResearchScore desc, then researchQualityScore desc, then symbol asc
    evaluated.sort((a, b) => {
      if (b.compositeResearchScore !== a.compositeResearchScore) {
        return b.compositeResearchScore - a.compositeResearchScore;
      }
      if (b.researchQualityScore !== a.researchQualityScore) {
        return b.researchQualityScore - a.researchQualityScore;
      }
      return a.symbol.localeCompare(b.symbol);
    });

    const topPicks = evaluated.slice(0, 5).map((item, idx) => ({
      ...item,
      rank: idx + 1,
    }));

    const scannedCount = slice.length;
    const isCompleteScan =
      candidatesPool.length > 0 &&
      cursorOffset === 0 &&
      scannedCount === candidatesPool.length &&
      failedSymbols.length === 0;

    const completionPct =
      candidatesPool.length > 0
        ? Math.round((scannedCount / candidatesPool.length) * 10000) / 100
        : 0;

    const nextCursorOffset =
      cursorOffset + scannedCount < candidatesPool.length
        ? cursorOffset + scannedCount
        : null;

    const result: MarketDiscoveryScanResult = {
      scanId,
      userId: params.userId,
      status:
        scannedCount === 0 && candidatesPool.length > 0
          ? "FAILED"
          : isCompleteScan
            ? "COMPLETED"
            : "PARTIAL",
      scanCompleteness: isCompleteScan ? "COMPLETE_SCAN" : "PARTIAL_SCAN",
      publishedFinalTop5: isCompleteScan,
      publicationLabel: isCompleteScan
        ? "OVERALL TOP 5"
        : "PARTIAL SCAN — PROVISIONAL CANDIDATES ONLY",
      completionPct,
      filters,
      totalUniverseCount: allEligible.length,
      eligibleAfterFiltersCount: candidatesPool.length,
      scannedCount,
      succeededCount: evaluated.length,
      failedCount: failedSymbols.length,
      pendingCount: Math.max(0, candidatesPool.length - (cursorOffset + scannedCount)),
      retryPendingCount: failedSymbols.filter((f) => (f.retries ?? 0) < MAX_SYMBOL_RETRIES).length,
      remainingCount: Math.max(0, candidatesPool.length - (cursorOffset + scannedCount)),
      cursorOffset: cursorOffset + scannedCount,
      nextCursorOffset,
      failedSymbols,
      methodology: RESEARCH_METHODOLOGY_WEIGHTS,
      topPicks,
      startedAt,
      completedAt: new Date().toISOString(),
      advisoryDisclaimer: RESEARCH_METHODOLOGY_WEIGHTS.disclaimer,
    };

    const evaluatedBySymbol = new Map(evaluated.map((c) => [c.isin, c]));
    const failedBySymbol = new Map(
      failedSymbols.map((f) => [
        f.isin ?? f.symbol,
        { symbol: f.symbol, reason: f.reason, retries: 1 },
      ])
    );
    this.scanJobsById.set(scanId, {
      scanId,
      userId: params.userId,
      filters,
      startedAt,
      cursorOffset: cursorOffset + scannedCount,
      evaluatedBySymbol,
      failedBySymbol,
      succeededBase: 0,
      latestResult: result,
    });

    const existingHistory = this.userScanHistory.get(params.userId) ?? [];
    this.userScanHistory.set(params.userId, [result, ...existingHistory].slice(0, 50));
    await this.persistScanSafe(result);

    return result;
  }

  public getScanStatus(
    scanId: string,
    userId: string
  ): MarketDiscoveryScanResult | null {
    const job = this.scanJobsById.get(scanId);
    if (!job || job.userId !== userId) return null;
    return job.latestResult;
  }

  public async resumeDiscoveryScan(params: {
    scanId: string;
    userId: string;
    batchSize?: number;
    retryFailed?: boolean;
    retryOnly?: boolean;
    cacheTtlMs?: number;
  }): Promise<MarketDiscoveryScanResult> {
    if (this.activeWorkersByScanId.has(params.scanId)) {
      throw new Error("Discovery scan worker already active for this scanId.");
    }
    this.activeWorkersByScanId.add(params.scanId);
    try {
    let job = this.scanJobsById.get(params.scanId);
    if (!job) {
      job = (await this.loadScanJobFromSupabase(params.scanId, params.userId)) ?? undefined;
    }
    if (!job || job.userId !== params.userId) {
      throw new Error("Discovery scan job not found for authenticated user.");
    }

    if (this.universeService.getAllEligible().length === 0) {
      await this.universeService.loadUniverseFromSupabase();
    }
    const allEligible = this.universeService.getAllEligible();
    let pool = allEligible.filter((e) => e.listingStatus === "ACTIVE");
    if (job.filters.marketCap !== "ALL") {
      pool = pool.filter((e) => e.marketCapCategory === job.filters.marketCap);
    }
    if (job.filters.sector) {
      const s = job.filters.sector.toLowerCase();
      pool = pool.filter((e) => (e.sector ?? "").toLowerCase() === s);
    }
    if (job.filters.industry) {
      const ind = job.filters.industry.toLowerCase();
      pool = pool.filter((e) => (e.industry ?? "").toLowerCase() === ind);
    }
    if (typeof job.filters.minLiquidityCr === "number" && job.filters.minLiquidityCr > 0) {
      pool = pool.filter((e) => (e.marketCapCr ?? 0) >= job.filters.minLiquidityCr!);
    }
    pool.sort((a, b) => {
      if (a.marketCapRank !== null && b.marketCapRank !== null) {
        return a.marketCapRank - b.marketCapRank;
      }
      if (a.marketCapRank !== null) return -1;
      if (b.marketCapRank !== null) return 1;
      return a.symbol.localeCompare(b.symbol);
    });

    const batchSize = Math.min(Math.max(params.batchSize ?? 25, 1), 100);
    const cacheTtlMs = params.cacheTtlMs ?? 15 * 60 * 1000;

    // Bounded retries for failed symbols; in normal mode cap at half the batch so new symbols progress
    const maxRetrySlice = params.retryOnly
      ? batchSize
      : Math.max(1, Math.ceil(batchSize / 2));
    const retryTargets =
      params.retryFailed || params.retryOnly
        ? pool
            .filter((e) => {
              const f = job.failedBySymbol.get(e.isin);
              return f !== undefined && isFailedSymbolRetryEligible(f);
            })
            .slice(0, maxRetrySlice)
        : [];

    // Walk the deterministic pool from the persisted cursor. The cursor only advances past
    // symbols actually taken into this batch, so no symbol is ever silently skipped.
    let slots = params.retryOnly ? 0 : batchSize - retryTargets.length;
    const newTargets: MarketUniverseEquity[] = [];
    let scanIdx = job.cursorOffset;
    while (scanIdx < pool.length && slots > 0) {
      const e = pool[scanIdx];
      scanIdx += 1;
      if (job.evaluatedBySymbol.has(e.isin) || job.failedBySymbol.has(e.isin)) {
        continue; // already in a terminal or retry-tracked state — never reprocess
      }
      newTargets.push(e);
      slots -= 1;
    }
    const toProcess = [...retryTargets, ...newTargets];
    const nextCursor = scanIdx;

    for (let i = 0; i < toProcess.length; i += 3) {
      const batch = toProcess.slice(i, i + 3);
      const settled = await Promise.allSettled(
        batch.map(async (eq) => {
          const prevFail = job.failedBySymbol.get(eq.isin);
          if (prevFail && prevFail.retries > 0) {
            await new Promise((r) =>
              setTimeout(r, Math.min(250 * 2 ** prevFail.retries, 4000))
            );
          }
          const cached = this.snapshotCache.get(eq.isin);
          let snap: ExternalCompanyResearchSnapshot;
          if (cached && Date.now() - cached.cachedAtMs < cacheTtlMs) {
            snap = cached.snapshot;
          } else {
            snap = await this.snapshotFetcher(eq.symbol, eq);
            this.snapshotCache.set(eq.isin, {
              snapshot: snap,
              cachedAtMs: Date.now(),
            });
          }
          return { eq, snap };
        })
      );

      settled.forEach((res, idx) => {
        const eqItem = batch[idx];
        const key = eqItem.isin;
        if (res.status === "fulfilled") {
          const { candidate, dataQualityClass } = evaluateCompanyForDiscovery({
            equity: res.value.eq,
            snapshot: res.value.snap,
            riskProfile: job.filters.riskProfile,
          });
          job.failedBySymbol.delete(key);
          if (
            (job.filters.minDataQuality === "COMPLETE" &&
              dataQualityClass !== "COMPLETE") ||
            (job.filters.minDataQuality === "PARTIAL" &&
              dataQualityClass === "INSUFFICIENT")
          ) {
            return;
          }
          job.evaluatedBySymbol.set(key, candidate);
        } else {
          const prev = job.failedBySymbol.get(key);
          const isPostFix =
            prev?.resolverFixVersion === CURRENT_RESOLVER_FIX_VERSION;
          job.failedBySymbol.set(key, {
            symbol: eqItem.symbol,
            reason:
              res.reason instanceof Error ? res.reason.message : "Provider error",
            retries: (prev?.retries ?? 0) + 1,
            legacyRetries: prev?.legacyRetries,
            postFixRetries: isPostFix
              ? (prev?.postFixRetries ?? 0) + 1
              : prev?.postFixRetries,
            resolverFixVersion: prev?.resolverFixVersion ?? CURRENT_RESOLVER_FIX_VERSION,
          });
        }
      });
    }

    job.cursorOffset = nextCursor;
    const evaluated = Array.from(job.evaluatedBySymbol.values()).sort((a, b) => {
      if (b.compositeResearchScore !== a.compositeResearchScore) {
        return b.compositeResearchScore - a.compositeResearchScore;
      }
      if (b.researchQualityScore !== a.researchQualityScore) {
        return b.researchQualityScore - a.researchQualityScore;
      }
      return a.symbol.localeCompare(b.symbol);
    });

    const topPicks = evaluated.slice(0, 5).map((item, idx) => ({
      ...item,
      rank: idx + 1,
    }));
    const failedSymbols = Array.from(job.failedBySymbol.entries()).map(
      ([key, info]) => ({
        symbol: info.symbol ?? key,
        isin: key,
        reason: info.reason,
        retries: info.retries,
        ...(info.legacyRetries !== undefined ? { legacyRetries: info.legacyRetries } : {}),
        ...(info.postFixRetries !== undefined ? { postFixRetries: info.postFixRetries } : {}),
        ...(info.resolverFixVersion ? { resolverFixVersion: info.resolverFixVersion } : {}),
        ...(info.status ? { status: info.status } : {}),
        ...(info.exclusionReason ? { exclusionReason: info.exclusionReason } : {}),
        ...(info.excludedAt ? { excludedAt: info.excludedAt } : {}),
      })
    );
    const totalProcessed = job.cursorOffset;
    const retryPendingCount = Array.from(job.failedBySymbol.values()).filter(
      (f) => isFailedSymbolRetryEligible(f)
    ).length;
    const unresolvedFailedCount = failedSymbols.filter(
      (f) => f.status !== "EXCLUDED_UNAVAILABLE_DATA"
    ).length;
    const excludedCount = failedSymbols.filter(
      (f) => f.status === "EXCLUDED_UNAVAILABLE_DATA"
    ).length;
    const totalSucceeded = (job.succeededBase ?? 0) + evaluated.length;
    const isCompleteScan =
      pool.length > 0 &&
      job.cursorOffset >= pool.length &&
      retryPendingCount === 0 &&
      unresolvedFailedCount === 0 &&
      totalSucceeded + excludedCount >= pool.length;

    const result: MarketDiscoveryScanResult = {
      scanId: job.scanId,
      userId: job.userId,
      status: isCompleteScan ? "COMPLETED" : "PARTIAL",
      scanCompleteness: isCompleteScan ? "COMPLETE_SCAN" : "PARTIAL_SCAN",
      publishedFinalTop5: isCompleteScan,
      publicationLabel: isCompleteScan
        ? "OVERALL TOP 5"
        : "PARTIAL SCAN — PROVISIONAL CANDIDATES ONLY",
      completionPct:
        pool.length > 0
          ? Math.round((totalProcessed / pool.length) * 10000) / 100
          : 0,
      filters: job.filters,
      totalUniverseCount: allEligible.length,
      eligibleAfterFiltersCount: pool.length,
      scannedCount: totalProcessed,
      succeededCount: totalSucceeded,
      failedCount: unresolvedFailedCount,
      excludedCount,
      pendingCount: Math.max(0, pool.length - totalProcessed),
      retryPendingCount,
      remainingCount: Math.max(0, pool.length - totalProcessed),
      cursorOffset: job.cursorOffset,
      nextCursorOffset: job.cursorOffset < pool.length ? job.cursorOffset : null,
      failedSymbols,
      methodology: RESEARCH_METHODOLOGY_WEIGHTS,
      topPicks,
      startedAt: job.startedAt,
      completedAt: new Date().toISOString(),
      advisoryDisclaimer: RESEARCH_METHODOLOGY_WEIGHTS.disclaimer,
    };

    job.latestResult = result;
    const existingHistory = this.userScanHistory.get(job.userId) ?? [];
    this.userScanHistory.set(
      job.userId,
      [result, ...existingHistory.filter((s) => s.scanId !== result.scanId)].slice(0, 50)
    );
    await this.persistScanSafe(result);
    return result;
    } finally {
      this.activeWorkersByScanId.delete(params.scanId);
    }
  }

  public stopAutonomousWorker(scanId: string): void {
    const timer = this.scheduledTimersByScanId.get(scanId);
    if (timer) {
      clearTimeout(timer);
      this.scheduledTimersByScanId.delete(scanId);
    }
  }

  public async startAutonomousDiscoveryScan(params: {
    userId: string;
    filters?: Partial<Top5DiscoveryFilters>;
    batchSize?: number;
    batchDelayMs?: number;
  }): Promise<MarketDiscoveryScanResult> {
    const batchSize = Math.min(Math.max(params.batchSize ?? 25, 1), 100);
    const batchDelayMs = Math.max(params.batchDelayMs ?? 1500, 100);
    const initial = await this.runDiscoveryScan({
      userId: params.userId,
      filters: params.filters,
      batchSize,
      cursorOffset: 0,
    });

    const scheduleNext = (scanId: string) => {
      if (this.scheduledTimersByScanId.has(scanId)) return;
      const timer = setTimeout(async () => {
        this.scheduledTimersByScanId.delete(scanId);
        try {
          const next = await this.resumeDiscoveryScan({
            scanId,
            userId: params.userId,
            batchSize,
            retryFailed: true,
          });
          const hasMoreWork =
            next.nextCursorOffset !== null || (next.retryPendingCount ?? 0) > 0;
          if (!next.publishedFinalTop5 && hasMoreWork) {
            scheduleNext(scanId);
          }
        } catch {
          // Worker lock or transient error; can be manually resumed via /resume
        }
      }, batchDelayMs);
      timer.unref?.();
      this.scheduledTimersByScanId.set(scanId, timer);
    };

    const hasMoreWork =
      initial.nextCursorOffset !== null ||
      initial.failedSymbols.length > 0;
    if (!initial.publishedFinalTop5 && hasMoreWork) {
      scheduleNext(initial.scanId);
    }
    return initial;
  }

  public async listUserScanHistory(
    userId: string,
    limit = 10,
    offset = 0
  ): Promise<{
    total: number;
    limit: number;
    offset: number;
    scans: MarketDiscoveryScanResult[];
  }> {
    const safeLimit = Math.min(Math.max(limit, 1), 50);
    const safeOffset = Math.max(offset, 0);

    if (isSupabaseConfigured()) {
      try {
        const supabase = getAdminSupabaseClient();
        const { data, count, error } = await (supabase as any)
          .from("market_discovery_scans")
          .select("*", { count: "exact" })
          .eq("user_id", userId)
          .order("started_at", { ascending: false })
          .range(safeOffset, safeOffset + safeLimit - 1);

        if (!error && Array.isArray(data) && data.length > 0) {
          const scans: MarketDiscoveryScanResult[] = data.map((row: any) => ({
            scanId: row.id,
            userId: row.user_id,
            status: row.status,
            scanCompleteness: row.scan_completeness,
            publishedFinalTop5: row.scan_completeness === "COMPLETE_SCAN",
            publicationLabel:
              row.scan_completeness === "COMPLETE_SCAN"
                ? "OVERALL TOP 5"
                : "PARTIAL SCAN — PROVISIONAL CANDIDATES ONLY",
            completionPct:
              row.total_universe_count > 0
                ? Math.round((row.scanned_count / row.total_universe_count) * 10000) / 100
                : 0,
            filters: row.filters,
            totalUniverseCount: row.total_universe_count,
            eligibleAfterFiltersCount: row.total_universe_count,
            scannedCount: row.scanned_count,
            succeededCount: row.succeeded_count,
            failedCount: row.failed_count,
            remainingCount: Math.max(0, Number(row.total_universe_count ?? 0) - Number(row.scanned_count ?? 0)),
            cursorOffset: row.cursor_offset ?? 0,
            nextCursorOffset: null,
            failedSymbols: Array.isArray(row.failed_symbols) ? row.failed_symbols : [],
            methodology: RESEARCH_METHODOLOGY_WEIGHTS,
            topPicks: Array.isArray(row.top_picks) ? row.top_picks : [],
            startedAt: row.started_at,
            completedAt: row.completed_at ?? row.started_at,
            advisoryDisclaimer: RESEARCH_METHODOLOGY_WEIGHTS.disclaimer,
          }));
          return {
            total: count ?? scans.length,
            limit: safeLimit,
            offset: safeOffset,
            scans,
          };
        }
      } catch {
        // Fallback to in-memory user-scoped store
      }
    }

    const mem = this.userScanHistory.get(userId) ?? [];
    return {
      total: mem.length,
      limit: safeLimit,
      offset: safeOffset,
      scans: mem.slice(safeOffset, safeOffset + safeLimit),
    };
  }

  public async excludeUnavailableFailedSymbols(params: {
    scanId: string;
    userId: string;
    exclusionReason?: string;
    skipRetryCheckForBseUnavailable?: boolean;
  }): Promise<MarketDiscoveryScanResult> {
    let job = this.scanJobsById.get(params.scanId);
    if (!job) {
      job =
        (await this.loadScanJobFromSupabase(params.scanId, params.userId)) ??
        undefined;
    }
    if (!job || job.userId !== params.userId) {
      throw new Error("Discovery scan job not found for authenticated user.");
    }
    if (this.universeService.getAllEligible().length === 0) {
      await this.universeService.loadUniverseFromSupabase();
    }
    const allEligible = this.universeService.getAllEligible();
    const byIsin = new Map(allEligible.map((e) => [e.isin, e]));
    const nowIso = new Date().toISOString();
    const reasonTag = params.exclusionReason ?? "BSE_ONLY_FUNDAMENTALS_UNAVAILABLE";
    const newlyExcludedRows: Array<{
      symbol: string;
      isin: string | null;
      exchange: "NSE" | "BSE";
      series: string | null;
      instrument_type: string;
      exclusion_reason: string;
      raw_name: string;
      detected_at: string;
    }> = [];

    for (const [key, info] of job.failedBySymbol.entries()) {
      if (info.status === "EXCLUDED_UNAVAILABLE_DATA") continue;
      if (!params.skipRetryCheckForBseUnavailable && isFailedSymbolRetryEligible(info)) {
        continue;
      }
      const eq = byIsin.get(key);
      if (
        eq?.exchange === "BSE" &&
        info.reason.startsWith("FUNDAMENTALS_UNAVAILABLE:")
      ) {
        job.failedBySymbol.set(key, {
          ...info,
          status: "EXCLUDED_UNAVAILABLE_DATA",
          exclusionReason: reasonTag,
          excludedAt: nowIso,
        });
        newlyExcludedRows.push({
          symbol: eq.symbol,
          isin: eq.isin,
          exchange: "BSE",
          series: eq.series ?? null,
          instrument_type: "EQ",
          exclusion_reason: reasonTag,
          raw_name: `${eq.companyName} | ${info.reason}`,
          detected_at: nowIso,
        });
      }
    }

    if (newlyExcludedRows.length > 0 && isSupabaseConfigured()) {
      try {
        const supabase = getAdminSupabaseClient();
        await (supabase as any)
          .from("market_universe_excluded")
          .insert(newlyExcludedRows);
      } catch {
        // Non-fatal audit table insert
      }
    }

    let pool = allEligible.filter((e) => e.listingStatus === "ACTIVE");
    if (job.filters.marketCap !== "ALL") {
      pool = pool.filter((e) => e.marketCapCategory === job.filters.marketCap);
    }
    const evaluated = Array.from(job.evaluatedBySymbol.values()).sort((a, b) => {
      if (b.compositeResearchScore !== a.compositeResearchScore) {
        return b.compositeResearchScore - a.compositeResearchScore;
      }
      if (b.researchQualityScore !== a.researchQualityScore) {
        return b.researchQualityScore - a.researchQualityScore;
      }
      return a.symbol.localeCompare(b.symbol);
    });
    const topPicks = evaluated.slice(0, 5).map((item, idx) => ({
      ...item,
      rank: idx + 1,
    }));
    const failedSymbols = Array.from(job.failedBySymbol.entries()).map(
      ([key, info]) => ({
        symbol: info.symbol ?? key,
        isin: key,
        reason: info.reason,
        retries: info.retries,
        ...(info.legacyRetries !== undefined ? { legacyRetries: info.legacyRetries } : {}),
        ...(info.postFixRetries !== undefined ? { postFixRetries: info.postFixRetries } : {}),
        ...(info.resolverFixVersion ? { resolverFixVersion: info.resolverFixVersion } : {}),
        ...(info.status ? { status: info.status } : {}),
        ...(info.exclusionReason ? { exclusionReason: info.exclusionReason } : {}),
        ...(info.excludedAt ? { excludedAt: info.excludedAt } : {}),
      })
    );
    const retryPendingCount = Array.from(job.failedBySymbol.values()).filter(
      (f) => isFailedSymbolRetryEligible(f)
    ).length;
    const unresolvedFailedCount = failedSymbols.filter(
      (f) => f.status !== "EXCLUDED_UNAVAILABLE_DATA"
    ).length;
    const excludedCount = failedSymbols.filter(
      (f) => f.status === "EXCLUDED_UNAVAILABLE_DATA"
    ).length;
    const totalSucceeded = (job.succeededBase ?? 0) + evaluated.length;
    const isCompleteScan =
      pool.length > 0 &&
      job.cursorOffset >= pool.length &&
      retryPendingCount === 0 &&
      unresolvedFailedCount === 0 &&
      totalSucceeded + excludedCount >= pool.length;

    const result: MarketDiscoveryScanResult = {
      ...job.latestResult,
      status: isCompleteScan ? "COMPLETED" : "PARTIAL",
      scanCompleteness: isCompleteScan ? "COMPLETE_SCAN" : "PARTIAL_SCAN",
      publishedFinalTop5: isCompleteScan,
      publicationLabel: isCompleteScan
        ? "OVERALL TOP 5"
        : "PARTIAL SCAN — PROVISIONAL CANDIDATES ONLY",
      completionPct:
        pool.length > 0
          ? Math.round((job.cursorOffset / pool.length) * 10000) / 100
          : 0,
      eligibleAfterFiltersCount: pool.length,
      scannedCount: job.cursorOffset,
      succeededCount: totalSucceeded,
      failedCount: unresolvedFailedCount,
      excludedCount,
      pendingCount: Math.max(0, pool.length - job.cursorOffset),
      retryPendingCount,
      remainingCount: Math.max(0, pool.length - job.cursorOffset),
      failedSymbols,
      topPicks,
      completedAt: nowIso,
    };

    job.latestResult = result;
    const existingHistory = this.userScanHistory.get(job.userId) ?? [];
    this.userScanHistory.set(
      job.userId,
      [result, ...existingHistory.filter((s) => s.scanId !== result.scanId)].slice(
        0,
        50
      )
    );
    await this.persistScanSafe(result);
    return result;
  }

  /**
   * Preserves the existing published Top 5 as Version 1, runs official exchange filing +
   * Screener cross-verification on candidate equities, and publishes Version 2 with
   * full rank/score/confidence/evidence diffs without overwriting Version 1 history.
   */
  public async publishVerifiedTop5Version2(params: {
    scanId: string;
    userId: string;
    candidateSymbols?: string[];
    verifier?: typeof fundamentalsVerificationService;
  }): Promise<MarketDiscoveryScanResult> {
    let job = this.scanJobsById.get(params.scanId);
    if (!job) {
      job =
        (await this.loadScanJobFromSupabase(params.scanId, params.userId)) ??
        undefined;
    }
    if (!job || job.userId !== params.userId) {
      throw new Error("Discovery scan job not found for authenticated user.");
    }
    if (!job.latestResult.publishedFinalTop5) {
      throw new Error(
        "Cannot publish Version 2 before Version 1 completeness gate is satisfied."
      );
    }

    if (this.universeService.getAllEligible().length === 0) {
      await this.universeService.loadUniverseFromSupabase();
    }
    const verifierSvc = params.verifier ?? fundamentalsVerificationService;
    const prevTop5 = job.latestResult.topPicks;
    const prevBySymbol = new Map(prevTop5.map((p) => [p.symbol, p]));

    const existingHistory: RankingVersionSnapshot[] =
      job.latestResult.rankingHistory && job.latestResult.rankingHistory.length > 0
        ? [...job.latestResult.rankingHistory]
        : [
            {
              version: 1,
              publishedAt: job.latestResult.completedAt,
              label: "Version 1 (Initial Full-Universe Scan — Yahoo Supplementary)",
              methodologyVersion: job.latestResult.methodology.version,
              topPicks: prevTop5,
            },
          ];

    // Candidate pool for deep official verification: explicit symbols or persisted topPicks + evaluated
    const targetSymbols =
      params.candidateSymbols && params.candidateSymbols.length > 0
        ? params.candidateSymbols
        : Array.from(
            new Set([
              ...prevTop5.map((p) => p.symbol),
              ...Array.from(job.evaluatedBySymbol.values()).map((c) => c.symbol),
            ])
          ).slice(0, 25);

    const equitiesToVerify = targetSymbols
      .map((sym) => this.universeService.findBySymbol(sym))
      .filter((e): e is MarketUniverseEquity => Boolean(e));

    const reEvaluated: Top5ResearchCandidate[] = [];
    for (let i = 0; i < equitiesToVerify.length; i += 3) {
      const batch = equitiesToVerify.slice(i, i + 3);
      const settled = await Promise.allSettled(
        batch.map(async (eq) => {
          const snap = await this.snapshotFetcher(eq.symbol, eq);
          const verified = await verifierSvc.verifyCompanyEvidence({
            equity: eq,
            snapshot: snap,
          });
          // Never silently overwrite verified sector
          const sectorUpdatedEq: MarketUniverseEquity =
            !eq.sector && verified.screener?.sector
              ? {
                  ...eq,
                  sector: verified.screener.sector,
                  industry: eq.industry ?? verified.screener.industry,
                }
              : eq;
          return evaluateCompanyForDiscovery({
            equity: sectorUpdatedEq,
            snapshot: snap,
            riskProfile: job!.filters.riskProfile,
            verifiedEvidence: verified,
          }).candidate;
        })
      );
      for (const item of settled) {
        if (item.status === "fulfilled") {
          reEvaluated.push(item.value);
          job.evaluatedBySymbol.set(item.value.isin, item.value);
        }
      }
    }

    reEvaluated.sort((a, b) => {
      if (b.compositeResearchScore !== a.compositeResearchScore) {
        return b.compositeResearchScore - a.compositeResearchScore;
      }
      if (b.researchQualityScore !== a.researchQualityScore) {
        return b.researchQualityScore - a.researchQualityScore;
      }
      return a.symbol.localeCompare(b.symbol);
    });

    const newTop5 = reEvaluated.slice(0, 5).map((item, idx) => ({
      ...item,
      rank: idx + 1,
    }));
    const nowIso = new Date().toISOString();

    const diffs: RankingVersionDiffItem[] = newTop5.map((curr) => {
      const prev = prevBySymbol.get(curr.symbol);
      const prevRank = prev?.rank ?? null;
      const rankChange =
        prevRank === null
          ? "NEW_ENTRY"
          : prevRank === curr.rank
            ? "UNCHANGED"
            : prevRank > curr.rank
              ? `+${prevRank - curr.rank}`
              : `${prevRank - curr.rank}`;
      const scoreChange =
        prev !== undefined
          ? Math.round((curr.compositeResearchScore - prev.compositeResearchScore) * 10) / 10
          : null;
      return {
        symbol: curr.symbol,
        companyName: curr.companyName,
        previousRank: prevRank,
        newRank: curr.rank,
        rankChange,
        previousScore: prev?.compositeResearchScore ?? null,
        newScore: curr.compositeResearchScore,
        scoreChange,
        previousConfidence: prev?.evidenceConfidence ?? null,
        newConfidence: curr.evidenceConfidence,
        reasonForChange: curr.dataProvenance.publicationTimestamp
          ? `Official filing timestamp verified (${curr.dataProvenance.publicationTimestamp.slice(0, 10)}); ${curr.metricVerificationSummary?.verifiedMetricCount ?? 0} metrics verified.`
          : "Publication timestamp still unavailable; safeguard cap remains active.",
      };
    });

    const nextVersion = existingHistory[existingHistory.length - 1].version + 1;
    const vNextSnapshot: RankingVersionSnapshot = {
      version: nextVersion,
      publishedAt: nowIso,
      label: `Version ${nextVersion} (Evidence-Verified Overall Top 5)`,
      methodologyVersion: job.latestResult.methodology.version,
      topPicks: newTop5,
      diffsFromPrevious: diffs,
    };
    const rankingHistory = [...existingHistory, vNextSnapshot];

    const result: MarketDiscoveryScanResult = {
      ...job.latestResult,
      topPicks: newTop5,
      version: nextVersion,
      rankingHistory,
      completedAt: nowIso,
    };

    job.latestResult = result;
    await this.persistScanSafe(result);
    return result;
  }

  private async loadScanJobFromSupabase(
    scanId: string,
    userId: string
  ) {
    if (!isSupabaseConfigured()) return null;
    try {
      const supabase = getAdminSupabaseClient();
      const { data, error } = await (supabase as any)
        .from("market_discovery_scans")
        .select("*")
        .eq("id", scanId)
        .eq("user_id", userId)
        .single();
      if (error || !data) return null;

      const failedBySymbol = new Map<string, FailedSymbolEntry>();
      if (Array.isArray(data.failed_symbols)) {
        for (const f of data.failed_symbols) {
          if (f && typeof f.symbol === "string") {
            const resolvedIsin =
              typeof f.isin === "string" && f.isin
                ? f.isin
                : this.universeService.findBySymbol(f.symbol)?.isin ?? f.symbol;
            failedBySymbol.set(resolvedIsin, {
              symbol: f.symbol,
              reason: typeof f.reason === "string" ? f.reason : "Unknown error",
              retries: typeof f.retries === "number" ? f.retries : 1,
              legacyRetries:
                typeof f.legacyRetries === "number" ? f.legacyRetries : undefined,
              postFixRetries:
                typeof f.postFixRetries === "number"
                  ? f.postFixRetries
                  : undefined,
              resolverFixVersion:
                typeof f.resolverFixVersion === "string"
                  ? f.resolverFixVersion
                  : undefined,
              status:
                f.status === "EXCLUDED_UNAVAILABLE_DATA"
                  ? "EXCLUDED_UNAVAILABLE_DATA"
                  : "FAILED",
              exclusionReason:
                typeof f.exclusionReason === "string"
                  ? f.exclusionReason
                  : undefined,
              excludedAt:
                typeof f.excludedAt === "string" ? f.excludedAt : undefined,
            });
          }
        }
      }

      const evaluatedBySymbol = new Map<string, Top5ResearchCandidate>();
      if (Array.isArray(data.top_picks)) {
        for (const pick of data.top_picks) {
          if (pick && typeof pick.symbol === "string") {
            const key =
              typeof pick.isin === "string" && pick.isin
                ? pick.isin
                : pick.symbol;
            evaluatedBySymbol.set(key, pick as Top5ResearchCandidate);
          }
        }
      }

      const topPicks = Array.isArray(data.top_picks)
        ? (data.top_picks as Top5ResearchCandidate[])
        : [];
      const totalUniverseCount = Number(data.total_universe_count ?? 0);
      const scannedCount = Number(data.scanned_count ?? 0);
      const isComplete = data.scan_completeness === "COMPLETE_SCAN";
      const latestResult: MarketDiscoveryScanResult = {
        scanId: data.id,
        userId: data.user_id,
        status: data.status,
        scanCompleteness: data.scan_completeness,
        publishedFinalTop5: isComplete,
        publicationLabel: isComplete
          ? "OVERALL TOP 5"
          : "PARTIAL SCAN — PROVISIONAL CANDIDATES ONLY",
        completionPct:
          totalUniverseCount > 0
            ? Math.round((scannedCount / totalUniverseCount) * 10000) / 100
            : 0,
        filters: data.filters ?? {
          marketCap: "ALL",
          riskProfile: "BALANCED",
          minDataQuality: "ANY",
        },
        totalUniverseCount,
        eligibleAfterFiltersCount: totalUniverseCount,
        scannedCount,
        succeededCount: Number(data.succeeded_count ?? 0),
        failedCount: Number(data.failed_count ?? 0),
        remainingCount: Math.max(0, totalUniverseCount - scannedCount),
        cursorOffset: Number(data.cursor_offset ?? 0),
        nextCursorOffset: null,
        failedSymbols: Array.from(failedBySymbol.entries()).map(
          ([key, info]) => ({
            symbol: info.symbol ?? key,
            reason: info.reason,
            retries: info.retries,
          })
        ),
        methodology: RESEARCH_METHODOLOGY_WEIGHTS,
        topPicks,
        version:
          typeof data.filters?._version === "number" ? data.filters._version : 1,
        rankingHistory: Array.isArray(data.filters?._rankingHistory)
          ? (data.filters._rankingHistory as RankingVersionSnapshot[])
          : undefined,
        startedAt: data.started_at,
        completedAt: data.completed_at ?? data.started_at,
        advisoryDisclaimer: RESEARCH_METHODOLOGY_WEIGHTS.disclaimer,
      };

      const restoredJob: ScanJobState = {
        scanId: data.id as string,
        userId: data.user_id as string,
        filters: latestResult.filters,
        startedAt: data.started_at as string,
        cursorOffset: Number(data.cursor_offset ?? 0),
        evaluatedBySymbol,
        failedBySymbol,
        succeededBase: Math.max(
          0,
          Number(data.succeeded_count ?? 0) - evaluatedBySymbol.size
        ),
        latestResult,
      };
      this.scanJobsById.set(restoredJob.scanId, restoredJob);
      return restoredJob;
    } catch {
      return null;
    }
  }

  private async persistScanSafe(scan: MarketDiscoveryScanResult): Promise<void> {
    if (!isSupabaseConfigured()) return;
    try {
      const supabase = getAdminSupabaseClient();
      await (supabase as any)
        .from("market_discovery_scans")
        .upsert(
          {
            id: scan.scanId,
            user_id: scan.userId,
            status: scan.status,
            scan_completeness: scan.scanCompleteness,
            published_final_top5: scan.publishedFinalTop5,
            completion_pct: scan.completionPct,
            filters: {
              ...scan.filters,
              ...(scan.version !== undefined ? { _version: scan.version } : {}),
              ...(scan.rankingHistory ? { _rankingHistory: scan.rankingHistory } : {}),
            },
            total_universe_count: scan.totalUniverseCount,
            scanned_count: scan.scannedCount,
            succeeded_count: scan.succeededCount,
            failed_count: scan.failedCount,
            cursor_offset: scan.cursorOffset,
            failed_symbols: scan.failedSymbols,
            top_picks: scan.topPicks,
            methodology_version: scan.methodology.version,
            started_at: scan.startedAt,
            completed_at: scan.completedAt,
          },
          { onConflict: "id" }
        );
    } catch {
      // Non-fatal in-memory fallback
    }
  }
}

export const top5DiscoveryEngine = new Top5DiscoveryEngine();
