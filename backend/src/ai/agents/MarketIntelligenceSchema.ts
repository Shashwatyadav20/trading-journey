import { AITaskTier } from "../core/ModelRouter";
import { EvidenceRecord, sanitizeUntrustedText } from "../evidence/EvidenceSchema";
import { EvidencePackage } from "../services/EvidenceIntelligenceService";

export class MarketIntelligenceValidationError extends Error {
  public readonly statusCode = 400;
  public readonly code = "MARKET_INTELLIGENCE_VALIDATION_ERROR";

  public constructor(message: string) {
    super(message);
    this.name = "MarketIntelligenceValidationError";
  }
}

export type MarketRegime =
  | "BULLISH"
  | "BEARISH"
  | "RANGE_BOUND"
  | "HIGH_VOLATILITY"
  | "INSUFFICIENT_DATA";

export interface MarketIntelligenceRequestInput {
  focus?: string;
  tier: AITaskTier;
}

const VALID_TIERS: ReadonlySet<string> = new Set(["deep", "balanced", "fast"]);

export function validateMarketIntelligenceRequest(
  raw: unknown
): MarketIntelligenceRequestInput {
  if (raw !== undefined && raw !== null && (typeof raw !== "object" || Array.isArray(raw))) {
    throw new MarketIntelligenceValidationError(
      "Request body must be a JSON object."
    );
  }

  const body = (raw as Record<string, unknown>) || {};

  let focus: string | undefined;
  if (body.focus !== undefined && body.focus !== null) {
    if (typeof body.focus !== "string") {
      throw new MarketIntelligenceValidationError(
        "Focus parameter must be a string when provided."
      );
    }
    const sanitized = sanitizeUntrustedText(body.focus).slice(0, 500);
    if (sanitized.length > 0) {
      focus = sanitized;
    }
  }

  const tierRaw =
    typeof body.tier === "string" ? body.tier.trim().toLowerCase() : "balanced";
  if (!VALID_TIERS.has(tierRaw)) {
    throw new MarketIntelligenceValidationError(
      `Invalid AI tier "${tierRaw}". Allowed: deep, balanced, fast.`
    );
  }

  return {
    focus,
    tier: tierRaw as AITaskTier,
  };
}

export interface DeterministicRegimeAssessment {
  regime: MarketRegime;
  methodology: string;
  evidenceIds: string[];
  metricsUsed: {
    niftyChangePct: number | null;
    indiaVix: number | null;
    advanceDeclineRatio: number | null;
  };
}

function findUsableNumericClaim(
  records: EvidenceRecord[],
  claimPattern: RegExp
): { value: number; evidenceId: string } | null {
  const candidates = records.filter(
    (r) =>
      r.value !== null &&
      typeof r.value === "number" &&
      Number.isFinite(r.value) &&
      r.freshness !== "EXPIRED" &&
      r.verificationStatus !== "CONFLICTED" &&
      claimPattern.test(r.claim)
  );
  if (candidates.length === 0) return null;
  // Prefer VERIFIED + FRESH over UNVERIFIED or STALE
  candidates.sort((a, b) => {
    const scoreA =
      (a.verificationStatus === "VERIFIED" ? 2 : 0) +
      (a.freshness === "FRESH" ? 1 : 0);
    const scoreB =
      (b.verificationStatus === "VERIFIED" ? 2 : 0) +
      (b.freshness === "FRESH" ? 1 : 0);
    return scoreB - scoreA;
  });
  return {
    value: candidates[0].value as number,
    evidenceId: candidates[0].evidenceId,
  };
}

/**
 * Deterministic, transparent market regime assessment from collected evidence.
 * Does not invent data; returns INSUFFICIENT_DATA if core index/volatility data is missing.
 */
export function assessMarketRegimeFromEvidence(
  pkg: EvidencePackage
): DeterministicRegimeAssessment {
  const niftyPct = findUsableNumericClaim(
    pkg.allRecords,
    /^NIFTY\s*50\s+Change\s*%$/i
  );
  const vix = findUsableNumericClaim(pkg.allRecords, /^India\s*VIX$/i);
  const adRatio = findUsableNumericClaim(
    pkg.allRecords,
    /^Market\s+Breadth\s+Advance\/Decline\s+Ratio$/i
  );

  const evidenceIds: string[] = [];
  if (niftyPct) evidenceIds.push(niftyPct.evidenceId);
  if (vix) evidenceIds.push(vix.evidenceId);
  if (adRatio) evidenceIds.push(adRatio.evidenceId);

  const methodology =
    "Deterministic rule-based check over non-expired, non-conflicted evidence: " +
    "1) India VIX >= 20 -> HIGH_VOLATILITY; " +
    "2) NIFTY 50 Change >= +0.5% (and A/D >= 1.2 if available) -> BULLISH; " +
    "3) NIFTY 50 Change <= -0.5% (and A/D <= 0.85 if available) -> BEARISH; " +
    "4) Otherwise if NIFTY 50 Change is within (-0.5%, +0.5%) -> RANGE_BOUND; " +
    "5) Missing/conflicted/expired NIFTY 50 Change -> INSUFFICIENT_DATA.";

  if (!niftyPct && !vix) {
    return {
      regime: "INSUFFICIENT_DATA",
      methodology,
      evidenceIds,
      metricsUsed: {
        niftyChangePct: null,
        indiaVix: null,
        advanceDeclineRatio: adRatio?.value ?? null,
      },
    };
  }

  if (vix && vix.value >= 20) {
    return {
      regime: "HIGH_VOLATILITY",
      methodology,
      evidenceIds,
      metricsUsed: {
        niftyChangePct: niftyPct?.value ?? null,
        indiaVix: vix.value,
        advanceDeclineRatio: adRatio?.value ?? null,
      },
    };
  }

  if (!niftyPct) {
    return {
      regime: "INSUFFICIENT_DATA",
      methodology,
      evidenceIds,
      metricsUsed: {
        niftyChangePct: null,
        indiaVix: vix?.value ?? null,
        advanceDeclineRatio: adRatio?.value ?? null,
      },
    };
  }

  let regime: MarketRegime = "RANGE_BOUND";
  if (niftyPct.value >= 0.5 && (!adRatio || adRatio.value >= 1.2)) {
    regime = "BULLISH";
  } else if (niftyPct.value <= -0.5 && (!adRatio || adRatio.value <= 0.85)) {
    regime = "BEARISH";
  }

  return {
    regime,
    methodology,
    evidenceIds,
    metricsUsed: {
      niftyChangePct: niftyPct.value,
      indiaVix: vix?.value ?? null,
      advanceDeclineRatio: adRatio?.value ?? null,
    },
  };
}

export interface MarketEvidencePoint {
  point: string;
  evidenceIds: string[];
  grounded: boolean;
}

export interface MarketRiskItem {
  risk: string;
  evidenceIds: string[];
  grounded: boolean;
}

export interface MarketIntelligenceReportOutput {
  marketOverview: {
    summary: string;
    sessionStatus: string;
    evidenceIds: string[];
  };
  indexAnalysis: {
    summary: string;
    indicesCovered: string[];
    evidenceIds: string[];
  };
  marketBreadth: {
    summary: string;
    breadthAvailable: boolean;
    evidenceIds: string[];
  };
  sectorStrength: {
    summary: string;
    leadingSectors: string[];
    laggingSectors: string[];
    evidenceIds: string[];
  };
  volatility: {
    summary: string;
    indiaVixAvailable: boolean;
    volatilityRegime: string;
    evidenceIds: string[];
  };
  supportingEvidence: MarketEvidencePoint[];
  contradictingEvidence: MarketEvidencePoint[];
  majorRisks: MarketRiskItem[];
  missingData: string[];
  invalidationConditions: string[];
  conclusion: {
    summary: string;
    regime: MarketRegime;
    methodology: string;
    evidenceIds: string[];
    verificationStatus: "LLM_MARKET_INTELLIGENCE_UNVERIFIED";
  };
}

export interface MarketIntelligenceAgentResponse {
  focus: string | null;
  sessionStatus: string;
  verificationStatus: "LLM_MARKET_INTELLIGENCE_UNVERIFIED";
  readOnly: true;
  model: string;
  provider?: string;
  evidenceRecords?: import("../evidence/EvidenceSchema").EvidenceRecord[];
  tier: AITaskTier;
  generatedAt: string;
  regimeAssessment: DeterministicRegimeAssessment;
  report: MarketIntelligenceReportOutput;
  unsupportedClaims: string[];
  invalidEvidenceIdsCited: string[];
  rawResponseInvalid: boolean;
  evidenceSummary: {
    totalRecords: number;
    verifiedCount: number;
    unverifiedCount: number;
    staleCount: number;
    expiredCount: number;
    conflictedCount: number;
    conflicts: EvidencePackage["conflicts"];
    missingInformation: string[];
    evidenceIdsUsed: string[];
  };
}

const VALID_REGIMES: ReadonlySet<string> = new Set([
  "BULLISH",
  "BEARISH",
  "RANGE_BOUND",
  "HIGH_VOLATILITY",
  "INSUFFICIENT_DATA",
]);

interface RawMarketReportInput {
  marketOverview?: { summary?: unknown; evidenceIds?: unknown };
  indexAnalysis?: {
    summary?: unknown;
    indicesCovered?: unknown;
    evidenceIds?: unknown;
  };
  marketBreadth?: {
    summary?: unknown;
    breadthAvailable?: unknown;
    evidenceIds?: unknown;
  };
  sectorStrength?: {
    summary?: unknown;
    leadingSectors?: unknown;
    laggingSectors?: unknown;
    evidenceIds?: unknown;
  };
  volatility?: {
    summary?: unknown;
    indiaVixAvailable?: unknown;
    volatilityRegime?: unknown;
    evidenceIds?: unknown;
  };
  supportingEvidence?: Array<{ point?: unknown; evidenceIds?: unknown }>;
  contradictingEvidence?: Array<{ point?: unknown; evidenceIds?: unknown }>;
  majorRisks?: Array<{ risk?: unknown; evidenceIds?: unknown }>;
  missingData?: unknown[];
  invalidationConditions?: unknown[];
  conclusion?: {
    summary?: unknown;
    regime?: unknown;
    evidenceIds?: unknown;
  };
}

function safeParseMarketJson(raw: string): RawMarketReportInput | null {
  if (!raw || typeof raw !== "string") return null;
  const trimmed = raw
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return parsed as RawMarketReportInput;
  } catch {
    return null;
  }
}

export function validateAndGroundMarketOutput(
  rawText: string,
  pkg: EvidencePackage,
  deterministicRegime: DeterministicRegimeAssessment,
  sessionStatus: string
): {
  report: MarketIntelligenceReportOutput;
  unsupportedClaims: string[];
  invalidEvidenceIdsCited: string[];
  evidenceIdsUsed: string[];
  rawResponseInvalid: boolean;
} {
  const usableRecordIds = new Set<string>();
  for (const rec of pkg.allRecords) {
    if (rec.value !== null && rec.freshness !== "EXPIRED") {
      usableRecordIds.add(rec.evidenceId);
    }
  }

  const invalidEvidenceIdsCited = new Set<string>();
  const unsupportedClaims = new Set<string>();
  const evidenceIdsUsed = new Set<string>();

  const filterIds = (rawIds: unknown, contextLabel: string): string[] => {
    if (!Array.isArray(rawIds)) {
      if (contextLabel) unsupportedClaims.add(contextLabel);
      return [];
    }
    const valid: string[] = [];
    for (const item of rawIds) {
      if (typeof item !== "string") continue;
      const id = item.trim();
      if (!id) continue;
      if (usableRecordIds.has(id)) {
        valid.push(id);
        evidenceIdsUsed.add(id);
      } else {
        invalidEvidenceIdsCited.add(id);
      }
    }
    if (valid.length === 0 && contextLabel) {
      unsupportedClaims.add(contextLabel);
    }
    return Array.from(new Set(valid));
  };

  const sanitizeStringArray = (arr: unknown): string[] =>
    Array.isArray(arr)
      ? arr
          .filter((x): x is string => typeof x === "string")
          .map((x) => sanitizeUntrustedText(x))
          .filter(Boolean)
      : [];

  const parsed = safeParseMarketJson(rawText);
  if (!parsed) {
    return {
      report: buildFallbackMarketReport(pkg, deterministicRegime, sessionStatus),
      unsupportedClaims: ["Model output was not valid JSON and was rejected."],
      invalidEvidenceIdsCited: [],
      evidenceIdsUsed: [],
      rawResponseInvalid: true,
    };
  }

  const overviewSummary = sanitizeUntrustedText(
    typeof parsed.marketOverview?.summary === "string"
      ? parsed.marketOverview.summary
      : ""
  );
  const overviewIds = filterIds(
    parsed.marketOverview?.evidenceIds,
    overviewSummary ? `marketOverview: ${overviewSummary}` : ""
  );

  const indexSummary = sanitizeUntrustedText(
    typeof parsed.indexAnalysis?.summary === "string"
      ? parsed.indexAnalysis.summary
      : ""
  );
  const indexIds = filterIds(
    parsed.indexAnalysis?.evidenceIds,
    indexSummary ? `indexAnalysis: ${indexSummary}` : ""
  );

  const breadthSummary = sanitizeUntrustedText(
    typeof parsed.marketBreadth?.summary === "string"
      ? parsed.marketBreadth.summary
      : ""
  );
  const breadthIds = filterIds(
    parsed.marketBreadth?.evidenceIds,
    breadthSummary ? `marketBreadth: ${breadthSummary}` : ""
  );

  const sectorSummary = sanitizeUntrustedText(
    typeof parsed.sectorStrength?.summary === "string"
      ? parsed.sectorStrength.summary
      : ""
  );
  const sectorIds = filterIds(
    parsed.sectorStrength?.evidenceIds,
    sectorSummary ? `sectorStrength: ${sectorSummary}` : ""
  );

  const volSummary = sanitizeUntrustedText(
    typeof parsed.volatility?.summary === "string"
      ? parsed.volatility.summary
      : ""
  );
  const volIds = filterIds(
    parsed.volatility?.evidenceIds,
    volSummary ? `volatility: ${volSummary}` : ""
  );

  const supportingEvidence: MarketEvidencePoint[] = (
    Array.isArray(parsed.supportingEvidence) ? parsed.supportingEvidence : []
  )
    .map((item) => {
      const point = sanitizeUntrustedText(
        typeof item?.point === "string" ? item.point : ""
      );
      if (!point) return null;
      const ids = filterIds(
        item?.evidenceIds,
        `supportingEvidence: ${point}`
      );
      return { point, evidenceIds: ids, grounded: ids.length > 0 };
    })
    .filter((x): x is MarketEvidencePoint => x !== null);

  const contradictingEvidence: MarketEvidencePoint[] = (
    Array.isArray(parsed.contradictingEvidence)
      ? parsed.contradictingEvidence
      : []
  )
    .map((item) => {
      const point = sanitizeUntrustedText(
        typeof item?.point === "string" ? item.point : ""
      );
      if (!point) return null;
      const ids = filterIds(
        item?.evidenceIds,
        `contradictingEvidence: ${point}`
      );
      return { point, evidenceIds: ids, grounded: ids.length > 0 };
    })
    .filter((x): x is MarketEvidencePoint => x !== null);

  const majorRisks: MarketRiskItem[] = (
    Array.isArray(parsed.majorRisks) ? parsed.majorRisks : []
  )
    .map((item) => {
      const risk = sanitizeUntrustedText(
        typeof item?.risk === "string" ? item.risk : ""
      );
      if (!risk) return null;
      const ids = filterIds(item?.evidenceIds, `majorRisks: ${risk}`);
      return { risk, evidenceIds: ids, grounded: ids.length > 0 };
    })
    .filter((x): x is MarketRiskItem => x !== null);

  const conclusionSummary = sanitizeUntrustedText(
    typeof parsed.conclusion?.summary === "string"
      ? parsed.conclusion.summary
      : ""
  );
  const conclusionIds = filterIds(
    parsed.conclusion?.evidenceIds,
    conclusionSummary ? `conclusion: ${conclusionSummary}` : ""
  );

  const rawRegime =
    typeof parsed.conclusion?.regime === "string"
      ? parsed.conclusion.regime.trim().toUpperCase()
      : deterministicRegime.regime;

  // Never allow LLM to override INSUFFICIENT_DATA when deterministic check found insufficient data
  const finalRegime: MarketRegime =
    deterministicRegime.regime === "INSUFFICIENT_DATA" ||
    conclusionIds.length === 0
      ? "INSUFFICIENT_DATA"
      : VALID_REGIMES.has(rawRegime)
        ? (rawRegime as MarketRegime)
        : deterministicRegime.regime;

  return {
    report: {
      marketOverview: {
        summary: overviewSummary || "Insufficient market overview evidence.",
        sessionStatus,
        evidenceIds: overviewIds,
      },
      indexAnalysis: {
        summary: indexSummary || "Index evidence unavailable.",
        indicesCovered: sanitizeStringArray(parsed.indexAnalysis?.indicesCovered),
        evidenceIds: indexIds,
      },
      marketBreadth: {
        summary: breadthSummary || "Market breadth data unavailable.",
        breadthAvailable:
          Boolean(parsed.marketBreadth?.breadthAvailable) &&
          breadthIds.length > 0,
        evidenceIds: breadthIds,
      },
      sectorStrength: {
        summary: sectorSummary || "Sector strength data unavailable.",
        leadingSectors: sanitizeStringArray(parsed.sectorStrength?.leadingSectors),
        laggingSectors: sanitizeStringArray(parsed.sectorStrength?.laggingSectors),
        evidenceIds: sectorIds,
      },
      volatility: {
        summary: volSummary || "India VIX / volatility data unavailable.",
        indiaVixAvailable:
          Boolean(parsed.volatility?.indiaVixAvailable) && volIds.length > 0,
        volatilityRegime:
          sanitizeUntrustedText(
            typeof parsed.volatility?.volatilityRegime === "string"
              ? parsed.volatility.volatilityRegime
              : ""
          ) || "UNKNOWN",
        evidenceIds: volIds,
      },
      supportingEvidence,
      contradictingEvidence,
      majorRisks,
      missingData: Array.from(
        new Set([
          ...pkg.missingInformation,
          ...sanitizeStringArray(parsed.missingData),
        ])
      ),
      invalidationConditions: sanitizeStringArray(parsed.invalidationConditions),
      conclusion: {
        summary:
          conclusionSummary ||
          "Insufficient grounded evidence for a market conclusion.",
        regime: finalRegime,
        methodology: deterministicRegime.methodology,
        evidenceIds: conclusionIds,
        verificationStatus: "LLM_MARKET_INTELLIGENCE_UNVERIFIED",
      },
    },
    unsupportedClaims: Array.from(unsupportedClaims),
    invalidEvidenceIdsCited: Array.from(invalidEvidenceIdsCited),
    evidenceIdsUsed: Array.from(evidenceIdsUsed),
    rawResponseInvalid: false,
  };
}

function buildFallbackMarketReport(
  pkg: EvidencePackage,
  deterministicRegime: DeterministicRegimeAssessment,
  sessionStatus: string
): MarketIntelligenceReportOutput {
  return {
    marketOverview: {
      summary: "Structured market overview unavailable.",
      sessionStatus,
      evidenceIds: [],
    },
    indexAnalysis: {
      summary: "Structured index analysis unavailable.",
      indicesCovered: [],
      evidenceIds: [],
    },
    marketBreadth: {
      summary: "Market breadth data unavailable.",
      breadthAvailable: false,
      evidenceIds: [],
    },
    sectorStrength: {
      summary: "Sector strength data unavailable.",
      leadingSectors: [],
      laggingSectors: [],
      evidenceIds: [],
    },
    volatility: {
      summary: "Volatility data unavailable.",
      indiaVixAvailable: false,
      volatilityRegime: "UNKNOWN",
      evidenceIds: [],
    },
    supportingEvidence: [],
    contradictingEvidence: [],
    majorRisks: [],
    missingData: pkg.missingInformation,
    invalidationConditions: [],
    conclusion: {
      summary: "Model output could not be validated against evidence.",
      regime: deterministicRegime.regime,
      methodology: deterministicRegime.methodology,
      evidenceIds: [],
      verificationStatus: "LLM_MARKET_INTELLIGENCE_UNVERIFIED",
    },
  };
}

