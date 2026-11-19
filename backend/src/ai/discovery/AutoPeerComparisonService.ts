import { compileCompanyResearchReport } from "../../../../lib/ai/companyResearchEngine";
import { ExternalCompanyResearchSnapshot } from "../evidence/EvidenceCollector";
import {
  MarketCapCategory,
  MarketUniverseEquity,
  MarketUniverseService,
  marketUniverseService,
} from "./MarketUniverseService";

export interface AutoPeerMetrics {
  symbol: string;
  companyName: string;
  exchange: string;
  marketCapCategory: MarketCapCategory;
  marketCapCr: number | null;
  sector: string | null;
  industry: string | null;
  reportingPeriod: string | null;
  reportingBasis: "CONSOLIDATED" | "STANDALONE" | "UNSPECIFIED";
  // Financial Performance
  revenueGrowthPct: number | null;
  netProfitGrowthPct: number | null;
  ebitdaGrowthPct: number | null;
  ebitdaMarginPct: number | null;
  operatingMarginPct: number | null;
  epsGrowthPct: number | null;
  roePct: number | null;
  rocePct: number | null;
  roaPct: number | null;
  debtToEquity: number | null;
  interestCoverage: number | null;
  operatingCashFlowCr: number | null;
  freeCashFlowCr: number | null;
  // Valuation
  peRatio: number | null;
  pbRatio: number | null;
  evToEbitda: number | null;
  pegRatio: number | null;
  // Institutional Activity
  promoterHoldingPct: number | null;
  promoterPledgePct: number | null;
  fiiHoldingPct: number | null;
  diiHoldingPct: number | null;
  // Quality & Risk
  earningsConsistency: string;
  cashFlowQuality: string;
  debtRisk: string;
  governanceDisclosures: string;
  // Provenance & Quality
  sourceName: string;
  retrievalTimestamp: string;
  publicationTimestamp: string | null;
  verificationStatus: "VERIFIED" | "UNVERIFIED";
  freshnessStatus: "FRESH" | "STALE" | "UNKNOWN";
  missingMetrics: string[];
}

export interface MetricRankingEntry {
  metric: string;
  label: string;
  comparable: boolean;
  incompatibilityReason: string | null;
  strongestSymbol: string | null;
  weakestSymbol: string | null;
  rankings: Array<{
    rank: number;
    symbol: string;
    value: number | null;
    reportingPeriod: string | null;
    reportingBasis: string;
  }>;
}

export interface AutoPeerComparisonResult {
  targetSymbol: string;
  discoveredSector: string | null;
  discoveredIndustry: string | null;
  discoveredMarketCapCategory: MarketCapCategory;
  selectedPeerSymbols: string[];
  selectionMode: "AUTO_INDUSTRY_CAP" | "AUTO_INDUSTRY_ANY_CAP" | "AUTO_SECTOR_FALLBACK" | "MANUAL_OVERRIDE" | "NO_SUITABLE_PEERS";
  exceptions: string[];
  comparablePeriodValid: boolean;
  comparableBasisValid: boolean;
  compatibilityWarnings: string[];
  rows: AutoPeerMetrics[];
  metricRankings: MetricRankingEntry[];
  generatedAt: string;
  readOnly: true;
}

export type SnapshotFetcher = (
  symbol: string
) => Promise<ExternalCompanyResearchSnapshot>;

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

export function selectAutoPeers(params: {
  target: MarketUniverseEquity | null;
  targetSymbol: string;
  universe: MarketUniverseEquity[];
  maxPeers?: number;
}): {
  peers: MarketUniverseEquity[];
  selectionMode: AutoPeerComparisonResult["selectionMode"];
  exceptions: string[];
} {
  const maxPeers = Math.min(Math.max(params.maxPeers ?? 5, 1), 5);
  const exceptions: string[] = [];
  const cleanTarget = params.targetSymbol.trim().toUpperCase();

  if (!params.target || (!params.target.industry && !params.target.sector)) {
    exceptions.push(
      `Sector/industry metadata unavailable for ${cleanTarget} in the current universe.`
    );
    return { peers: [], selectionMode: "NO_SUITABLE_PEERS", exceptions };
  }

  const others = params.universe.filter(
    (e) =>
      e.symbol !== cleanTarget &&
      e.nseSymbol !== cleanTarget &&
      e.listingStatus === "ACTIVE"
  );

  // 1. Same industry + same market-cap category
  if (params.target.industry) {
    const sameIndSameCap = others.filter(
      (e) =>
        e.industry?.toLowerCase() === params.target!.industry!.toLowerCase() &&
        e.marketCapCategory === params.target!.marketCapCategory
    );
    if (sameIndSameCap.length >= 2) {
      return {
        peers: sameIndSameCap.slice(0, maxPeers),
        selectionMode: "AUTO_INDUSTRY_CAP",
        exceptions,
      };
    }

    // 2. Same industry, any market cap
    const sameIndAnyCap = others.filter(
      (e) => e.industry?.toLowerCase() === params.target!.industry!.toLowerCase()
    );
    if (sameIndAnyCap.length > 0) {
      if (params.target.marketCapCategory !== "UNCLASSIFIED") {
        exceptions.push(
          `Insufficient ${params.target.marketCapCategory} peers in ${params.target.industry}; expanded to all market-cap categories within ${params.target.industry}.`
        );
      }
      return {
        peers: sameIndAnyCap.slice(0, maxPeers),
        selectionMode: "AUTO_INDUSTRY_ANY_CAP",
        exceptions,
      };
    }
  }

  // 3. Fallback to same sector
  if (params.target.sector) {
    const sameSector = others.filter(
      (e) => e.sector?.toLowerCase() === params.target!.sector!.toLowerCase()
    );
    if (sameSector.length > 0) {
      exceptions.push(
        `No same-industry peers found; expanded comparison to sector "${params.target.sector}".`
      );
      return {
        peers: sameSector.slice(0, maxPeers),
        selectionMode: "AUTO_SECTOR_FALLBACK",
        exceptions,
      };
    }
  }

  exceptions.push(
    `No suitable listed peers found in ${params.target.industry ?? params.target.sector}.`
  );
  return { peers: [], selectionMode: "NO_SUITABLE_PEERS", exceptions };
}

export function mapSnapshotToAutoPeerMetrics(
  snapshot: ExternalCompanyResearchSnapshot,
  universeMeta: MarketUniverseEquity | null
): AutoPeerMetrics {
  const f = snapshot.fundamentals;
  const h = snapshot.institutionalHoldings;
  const revenueCr = f.revenueCr ?? null;
  const netProfitCr = f.netProfitCr ?? null;
  const rocePct = f.rocePct ?? null;
  const ebitdaMarginPct = f.ebitdaMarginPct ?? null;
  const ocfCr = f.operatingCashFlowCr ?? null;
  const fcfCr = f.freeCashFlowCr ?? null;
  const promoterPledgePct = f.promoterPledgePct ?? null;

  // PEG only computed when reliable positive P/E and positive earnings growth exist
  const pegRatio =
    f.trailingPE !== null &&
    f.trailingPE > 0 &&
    f.quarterlyEarningsGrowthPct !== null &&
    f.quarterlyEarningsGrowthPct > 0
      ? round2(f.trailingPE / f.quarterlyEarningsGrowthPct)
      : null;

  const missingMetrics: string[] = [];
  if (revenueCr === null) missingMetrics.push("Revenue");
  if (netProfitCr === null) missingMetrics.push("Net Profit");
  if (rocePct === null) missingMetrics.push("ROCE");
  if (f.roePct === null) missingMetrics.push("ROE");
  if (ocfCr === null) missingMetrics.push("Operating Cash Flow");
  if (fcfCr === null) missingMetrics.push("Free Cash Flow");
  if (promoterPledgePct === null) missingMetrics.push("Promoter Pledge");
  if (pegRatio === null) missingMetrics.push("PEG (requires reliable positive growth)");

  const cashFlowQuality =
    ocfCr !== null && netProfitCr !== null && netProfitCr > 0
      ? ocfCr >= netProfitCr * 0.8
        ? "STRONG (OCF >= 80% Net Profit)"
        : ocfCr > 0
          ? "MODERATE (Positive OCF)"
          : "WEAK (Negative OCF)"
      : "INSUFFICIENT_DATA";

  const debtRisk =
    f.debtToEquity === null
      ? "INSUFFICIENT_DATA"
      : f.debtToEquity <= 0.5
        ? "LOW"
        : f.debtToEquity <= 1.2
          ? "MODERATE"
          : "HIGH";

  const earningsConsistency =
    f.quarterlyEarningsGrowthPct === null
      ? "INSUFFICIENT_DATA"
      : f.quarterlyEarningsGrowthPct > 0
        ? "POSITIVE_GROWTH"
        : "CONTRACTING";

  return {
    symbol: snapshot.cleanSymbol,
    companyName: snapshot.companyName ?? universeMeta?.companyName ?? snapshot.cleanSymbol,
    exchange: universeMeta?.exchange ?? "NSE",
    marketCapCategory: universeMeta?.marketCapCategory ?? "UNCLASSIFIED",
    marketCapCr: f.marketCapCr ?? universeMeta?.marketCapCr ?? null,
    sector: universeMeta?.sector ?? null,
    industry: universeMeta?.industry ?? null,
    reportingPeriod: f.reportingPeriod ?? null,
    reportingBasis: f.reportingBasis ?? "UNSPECIFIED",
    revenueGrowthPct: f.quarterlyRevenueGrowthPct,
    netProfitGrowthPct: f.quarterlyEarningsGrowthPct,
    ebitdaGrowthPct: null, // Not provided by Yahoo quoteSummary without multi-quarter series
    ebitdaMarginPct,
    operatingMarginPct: f.operatingMarginPct,
    epsGrowthPct: f.quarterlyEarningsGrowthPct,
    roePct: f.roePct,
    rocePct,
    roaPct: null,
    debtToEquity: f.debtToEquity,
    interestCoverage: null,
    operatingCashFlowCr: ocfCr,
    freeCashFlowCr: fcfCr,
    peRatio: f.trailingPE,
    pbRatio: f.priceToBook,
    evToEbitda: null,
    pegRatio,
    promoterHoldingPct: h.insidersPromoterPercentHeld,
    promoterPledgePct,
    fiiHoldingPct: h.institutionsPercentHeld,
    diiHoldingPct: null,
    earningsConsistency,
    cashFlowQuality,
    debtRisk,
    governanceDisclosures:
      promoterPledgePct !== null && promoterPledgePct > 10
        ? `Elevated promoter pledge (${promoterPledgePct}%)`
        : "No adverse pledge disclosure detected",
    sourceName: "Yahoo Finance",
    retrievalTimestamp: snapshot.fetchedAtIST ?? new Date().toISOString(),
    publicationTimestamp: f.publishedAt ?? null,
    verificationStatus: "UNVERIFIED",
    freshnessStatus: f.publishedAt ? "FRESH" : "UNKNOWN",
    missingMetrics,
  };
}

export class AutoPeerComparisonService {
  private readonly universeService: MarketUniverseService;
  private readonly snapshotFetcher: SnapshotFetcher;

  public constructor(deps?: {
    universeService?: MarketUniverseService;
    snapshotFetcher?: SnapshotFetcher;
  }) {
    this.universeService = deps?.universeService ?? marketUniverseService;
    this.snapshotFetcher =
      deps?.snapshotFetcher ?? ((sym: string) => compileCompanyResearchReport(sym));
  }

  public async compareWithAutoPeers(params: {
    targetSymbol: string;
    manualPeerSymbols?: string[];
  }): Promise<AutoPeerComparisonResult> {
    const cleanTarget = params.targetSymbol
      .trim()
      .toUpperCase()
      .replace(/^NSE:/i, "")
      .replace(/\.NS$/i, "")
      .replace(/\.BO$/i, "");

    const universe = this.universeService.getAllEligible();
    const targetMeta = this.universeService.findBySymbol(cleanTarget);

    let selectedPeerSymbols: string[] = [];
    let selectionMode: AutoPeerComparisonResult["selectionMode"] = "NO_SUITABLE_PEERS";
    const exceptions: string[] = [];

    if (params.manualPeerSymbols && params.manualPeerSymbols.length > 0) {
      selectedPeerSymbols = params.manualPeerSymbols
        .map((s) => s.trim().toUpperCase())
        .filter((s) => s && s !== cleanTarget)
        .slice(0, 5);
      selectionMode = "MANUAL_OVERRIDE";
    } else {
      const auto = selectAutoPeers({
        target: targetMeta,
        targetSymbol: cleanTarget,
        universe,
        maxPeers: 5,
      });
      selectedPeerSymbols = auto.peers.map((p) => p.symbol);
      selectionMode = auto.selectionMode;
      exceptions.push(...auto.exceptions);
    }

    const symbolsToFetch = [cleanTarget, ...selectedPeerSymbols];
    // Bounded concurrency <= 3
    const rows: AutoPeerMetrics[] = [];
    for (let i = 0; i < symbolsToFetch.length; i += 3) {
      const batch = symbolsToFetch.slice(i, i + 3);
      const settled = await Promise.allSettled(
        batch.map(async (sym) => {
          const snap = await this.snapshotFetcher(sym);
          const meta = this.universeService.findBySymbol(sym);
          return mapSnapshotToAutoPeerMetrics(snap, meta);
        })
      );
      settled.forEach((res, idx) => {
        if (res.status === "fulfilled") {
          rows.push(res.value);
        } else {
          exceptions.push(
            `Failed to fetch peer snapshot for ${batch[idx]}: ${res.reason instanceof Error ? res.reason.message : "provider error"}.`
          );
        }
      });
    }

    const distinctPeriods = Array.from(
      new Set(rows.map((r) => r.reportingPeriod).filter((p): p is string => Boolean(p)))
    );
    const distinctBases = Array.from(
      new Set(rows.map((r) => r.reportingBasis).filter((b) => b !== "UNSPECIFIED"))
    );

    const comparablePeriodValid = distinctPeriods.length <= 1;
    const comparableBasisValid = distinctBases.length <= 1;
    const compatibilityWarnings: string[] = [];
    if (!comparablePeriodValid) {
      compatibilityWarnings.push(
        `Incompatible reporting periods detected (${distinctPeriods.join(", ")}). Rankings across incompatible periods are flagged and blocked.`
      );
    }
    if (!comparableBasisValid) {
      compatibilityWarnings.push(
        `Mixed Consolidated and Standalone financial statements detected (${distinctBases.join(", ")}). Statements must be compared on the same basis.`
      );
    }

    const metricSpecs: Array<{
      metric: keyof AutoPeerMetrics;
      label: string;
      higherIsBetter: boolean;
    }> = [
      { metric: "roePct", label: "Return on Equity (ROE %)", higherIsBetter: true },
      { metric: "rocePct", label: "ROCE (%)", higherIsBetter: true },
      { metric: "revenueGrowthPct", label: "Revenue Growth (%)", higherIsBetter: true },
      { metric: "netProfitGrowthPct", label: "Net Profit Growth (%)", higherIsBetter: true },
      { metric: "ebitdaMarginPct", label: "EBITDA Margin (%)", higherIsBetter: true },
      { metric: "debtToEquity", label: "Debt-to-Equity (lower better)", higherIsBetter: false },
      { metric: "peRatio", label: "P/E Ratio (lower better)", higherIsBetter: false },
      { metric: "operatingCashFlowCr", label: "Operating Cash Flow (Cr)", higherIsBetter: true },
    ];

    const comparable = comparablePeriodValid && comparableBasisValid;
    const incompatibilityReason = !comparable
      ? compatibilityWarnings.join(" ")
      : null;

    const metricRankings: MetricRankingEntry[] = metricSpecs.map((spec) => {
      const validRows = rows
        .map((r) => ({
          symbol: r.symbol,
          value: typeof r[spec.metric] === "number" ? (r[spec.metric] as number) : null,
          reportingPeriod: r.reportingPeriod,
          reportingBasis: r.reportingBasis,
        }))
        .filter((r) => r.value !== null);

      const sorted = [...validRows].sort((a, b) =>
        spec.higherIsBetter
          ? (b.value ?? 0) - (a.value ?? 0)
          : (a.value ?? 0) - (b.value ?? 0)
      );

      return {
        metric: String(spec.metric),
        label: spec.label,
        comparable,
        incompatibilityReason,
        strongestSymbol: comparable && sorted.length > 0 ? sorted[0].symbol : null,
        weakestSymbol:
          comparable && sorted.length > 1 ? sorted[sorted.length - 1].symbol : null,
        rankings: comparable
          ? sorted.map((r, i) => ({
              rank: i + 1,
              ...r,
            }))
          : [],
      };
    });

    const targetRow = rows.find((r) => r.symbol === cleanTarget);

    return {
      targetSymbol: cleanTarget,
      discoveredSector: targetMeta?.sector ?? targetRow?.sector ?? null,
      discoveredIndustry: targetMeta?.industry ?? targetRow?.industry ?? null,
      discoveredMarketCapCategory:
        targetMeta?.marketCapCategory ?? "UNCLASSIFIED",
      selectedPeerSymbols,
      selectionMode,
      exceptions,
      comparablePeriodValid,
      comparableBasisValid,
      compatibilityWarnings,
      rows,
      metricRankings,
      generatedAt: new Date().toISOString(),
      readOnly: true,
    };
  }
}

export const autoPeerComparisonService = new AutoPeerComparisonService();
