import type { VerifiedCompanyFundamentalsResult } from "./FundamentalsVerificationService";

export type ConfidenceTier =
  | "HIGH"
  | "MODERATE"
  | "LOW"
  | "INSUFFICIENT_EVIDENCE";

export interface MultiDimensionalConfidence {
  financialDataConfidence: ConfidenceTier;
  businessQualityConfidence: ConfidenceTier;
  valuationConfidence: ConfidenceTier;
  sourceReliabilityConfidence: ConfidenceTier;
  evidenceFreshnessConfidence: ConfidenceTier;
  overallResearchConfidence: ConfidenceTier;
  rationale: string[];
}

const TIER_RANK: Record<ConfidenceTier, number> = {
  INSUFFICIENT_EVIDENCE: 0,
  LOW: 1,
  MODERATE: 2,
  HIGH: 3,
};

function minTier(a: ConfidenceTier, b: ConfidenceTier): ConfidenceTier {
  return TIER_RANK[a] <= TIER_RANK[b] ? a : b;
}

export function computeResearchConfidence(
  verified: VerifiedCompanyFundamentalsResult
): MultiDimensionalConfidence {
  const f = verified.enrichedSnapshot.fundamentals;
  const totalMetrics = verified.metrics.length;
  const availableCount = verified.verifiedMetricCount + verified.unverifiedMetricCount;
  const coverageRatio = totalMetrics > 0 ? availableCount / totalMetrics : 0;

  // 1. Financial data confidence (coverage + absence of critical gaps)
  const coreFinPresent = [
    f.revenueCr,
    f.netProfitCr,
    f.roePct,
    f.debtToEquity,
    f.operatingCashFlowCr,
  ].filter((v) => v !== null && v !== undefined).length;

  const financialDataConfidence: ConfidenceTier =
    coreFinPresent <= 2 || coverageRatio < 0.4
      ? "INSUFFICIENT_EVIDENCE"
      : coreFinPresent >= 5 && coverageRatio >= 0.8
        ? "HIGH"
        : coreFinPresent >= 4 && coverageRatio >= 0.6
          ? "MODERATE"
          : "LOW";

  // 2. Business quality confidence (ROE, ROCE, operating margin, cash flow)
  const bqPresent = [
    f.roePct,
    f.rocePct,
    f.operatingMarginPct,
    f.operatingCashFlowCr,
    f.freeCashFlowCr,
  ].filter((v) => v !== null && v !== undefined).length;

  const businessQualityConfidence: ConfidenceTier =
    bqPresent <= 1
      ? "INSUFFICIENT_EVIDENCE"
      : bqPresent >= 4
        ? "HIGH"
        : bqPresent >= 3
          ? "MODERATE"
          : "LOW";

  // 3. Valuation confidence (PE, PB, marketCap)
  const valPresent = [f.trailingPE, f.priceToBook, f.marketCapCr].filter(
    (v) => v !== null && v !== undefined
  ).length;

  const valuationConfidence: ConfidenceTier =
    valPresent === 0
      ? "INSUFFICIENT_EVIDENCE"
      : valPresent === 3
        ? "HIGH"
        : valPresent === 2
          ? "MODERATE"
          : "LOW";

  // 4. Source reliability confidence (BSE official filing / Screener cross-check vs Yahoo-only)
  const hasOfficialFiling = Boolean(verified.officialFiling?.publishedAt);
  const hasScreener = Boolean(verified.screener);
  const sourceReliabilityConfidence: ConfidenceTier =
    hasOfficialFiling && hasScreener
      ? "HIGH"
      : hasOfficialFiling || (hasScreener && verified.verifiedMetricCount >= 4)
        ? "MODERATE"
        : availableCount > 0
          ? "LOW"
          : "INSUFFICIENT_EVIDENCE";

  // 5. Evidence freshness confidence
  const evidenceFreshnessConfidence: ConfidenceTier =
    verified.freshnessStatus === "FRESH" && Boolean(verified.reportingPeriod)
      ? "HIGH"
      : verified.freshnessStatus === "FRESH"
        ? "MODERATE"
        : verified.freshnessStatus === "STALE"
          ? "LOW"
          : "INSUFFICIENT_EVIDENCE";

  // 6. Overall research confidence: bounded by weakest critical dimension
  const avgRank =
    (TIER_RANK[financialDataConfidence] +
      TIER_RANK[businessQualityConfidence] +
      TIER_RANK[valuationConfidence] +
      TIER_RANK[sourceReliabilityConfidence] +
      TIER_RANK[evidenceFreshnessConfidence]) /
    5;

  let overallResearchConfidence: ConfidenceTier =
    avgRank >= 2.5
      ? "HIGH"
      : avgRank >= 1.75
        ? "MODERATE"
        : avgRank >= 0.8
          ? "LOW"
          : "INSUFFICIENT_EVIDENCE";

  // Cannot be HIGH if source reliability or freshness is LOW / INSUFFICIENT_EVIDENCE
  if (
    TIER_RANK[sourceReliabilityConfidence] <= 1 ||
    TIER_RANK[evidenceFreshnessConfidence] <= 1
  ) {
    overallResearchConfidence = minTier(overallResearchConfidence, "MODERATE");
  }
  if (financialDataConfidence === "INSUFFICIENT_EVIDENCE") {
    overallResearchConfidence = "INSUFFICIENT_EVIDENCE";
  }

  const rationale: string[] = [
    `Metric coverage: ${verified.verifiedMetricCount} verified, ${verified.unverifiedMetricCount} unverified, ${verified.missingMetricCount} missing (of ${totalMetrics}).`,
    hasOfficialFiling
      ? `Official exchange filing verified (${verified.officialFiling!.sourceName}, published ${verified.publishedAt}).`
      : "No verified exchange filing publication timestamp; capped at MODERATE source confidence.",
    `Freshness status: ${verified.freshnessStatus}${verified.reportingPeriod ? ` (reporting period ${verified.reportingPeriod})` : ""}.`,
  ];

  return {
    financialDataConfidence,
    businessQualityConfidence,
    valuationConfidence,
    sourceReliabilityConfidence,
    evidenceFreshnessConfidence,
    overallResearchConfidence,
    rationale,
  };
}

