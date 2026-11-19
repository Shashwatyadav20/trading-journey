import { AITaskTier } from "../core/ModelRouter";
import { sanitizeUntrustedText } from "../evidence/EvidenceSchema";
import { EvidencePackage } from "../services/EvidenceIntelligenceService";

export class InstitutionalIntelligenceValidationError extends Error {
  public readonly statusCode = 400;
  public readonly code = "INSTITUTIONAL_INTELLIGENCE_VALIDATION_ERROR";

  public constructor(message: string) {
    super(message);
    this.name = "InstitutionalIntelligenceValidationError";
  }
}

export interface InstitutionalIntelligenceRequestInput {
  symbol?: string;
  focus?: string;
  tier: AITaskTier;
}

const VALID_TIERS: ReadonlySet<string> = new Set(["deep", "balanced", "fast"]);
const NSE_SYMBOL_PATTERN = /^[A-Z0-9&-]{1,20}$/;

export function validateInstitutionalIntelligenceRequest(
  raw: unknown
): InstitutionalIntelligenceRequestInput {
  if (
    raw !== undefined &&
    raw !== null &&
    (typeof raw !== "object" || Array.isArray(raw))
  ) {
    throw new InstitutionalIntelligenceValidationError(
      "Request body must be a JSON object."
    );
  }

  const body = (raw as Record<string, unknown>) || {};

  let symbol: string | undefined;
  if (body.symbol !== undefined && body.symbol !== null && body.symbol !== "") {
    if (typeof body.symbol !== "string") {
      throw new InstitutionalIntelligenceValidationError(
        "Symbol must be a string when provided."
      );
    }
    const normalized = body.symbol
      .trim()
      .toUpperCase()
      .replace(/^NSE:/i, "")
      .replace(/\.NS$/i, "")
      .replace(/\.BO$/i, "");
    if (!NSE_SYMBOL_PATTERN.test(normalized)) {
      throw new InstitutionalIntelligenceValidationError(
        `Invalid NSE symbol "${body.symbol}".`
      );
    }
    symbol = normalized;
  }

  let focus: string | undefined;
  if (body.focus !== undefined && body.focus !== null) {
    if (typeof body.focus !== "string") {
      throw new InstitutionalIntelligenceValidationError(
        "Focus must be a string when provided."
      );
    }
    const sanitized = sanitizeUntrustedText(body.focus).slice(0, 500);
    if (sanitized.length > 0) {
      focus = sanitized;
    }
  }

  const tierRaw =
    typeof body.tier === "string" ? body.tier.trim().toLowerCase() : "deep";
  if (!VALID_TIERS.has(tierRaw)) {
    throw new InstitutionalIntelligenceValidationError(
      `Invalid AI tier "${tierRaw}". Allowed: deep, balanced, fast.`
    );
  }

  return {
    symbol,
    focus,
    tier: tierRaw as AITaskTier,
  };
}

export interface GroundedFactClaim {
  statement: string;
  evidenceIds: string[];
  grounded: boolean;
}

export interface InstitutionalInterpretation {
  statement: string;
  basis: string;
  evidenceIds: string[];
  verificationStatus: "LLM_INTERPRETATION_UNVERIFIED";
}

export interface InstitutionalIntelligenceReportOutput {
  fiiIntelligence: {
    summary: string;
    cashFlowAvailable: boolean;
    derivativesFlowDistinguished: boolean;
    evidenceIds: string[];
  };
  diiIntelligence: {
    summary: string;
    diiFlowAvailable: boolean;
    evidenceIds: string[];
  };
  mutualFundIntelligence: {
    summary: string;
    reportingPeriod: string | null;
    disclosureDate: string | null;
    mfDataAvailable: boolean;
    evidenceIds: string[];
  };
  promoterIntelligence: {
    summary: string;
    pledgedSharesAvailable: boolean;
    reportingPeriod: string | null;
    evidenceIds: string[];
  };
  behaviourAnalysis: {
    summary: string;
    accumulationOrDistribution:
      | "ACCUMULATION"
      | "DISTRIBUTION"
      | "MIXED_OR_CONFLICTED"
      | "INSUFFICIENT_DATA";
    ownershipConcentrationNote: string;
    evidenceIds: string[];
  };
  verifiedFacts: GroundedFactClaim[];
  interpretations: InstitutionalInterpretation[];
  assumptions: string[];
  missingData: string[];
  conflictingDisclosures: string[];
  conclusion: {
    summary: string;
    evidenceIds: string[];
    verificationStatus: "LLM_INSTITUTIONAL_INTELLIGENCE_UNVERIFIED";
  };
}

export interface InstitutionalIntelligenceAgentResponse {
  symbol: string | null;
  focus: string | null;
  verificationStatus: "LLM_INSTITUTIONAL_INTELLIGENCE_UNVERIFIED";
  readOnly: true;
  model: string;
  provider?: string;
  evidenceRecords?: import("../evidence/EvidenceSchema").EvidenceRecord[];
  tier: AITaskTier;
  generatedAt: string;
  report: InstitutionalIntelligenceReportOutput;
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

const VALID_ACCUMULATION: ReadonlySet<string> = new Set([
  "ACCUMULATION",
  "DISTRIBUTION",
  "MIXED_OR_CONFLICTED",
  "INSUFFICIENT_DATA",
]);

interface RawInstitutionalReportInput {
  fiiIntelligence?: {
    summary?: unknown;
    cashFlowAvailable?: unknown;
    derivativesFlowDistinguished?: unknown;
    evidenceIds?: unknown;
  };
  diiIntelligence?: {
    summary?: unknown;
    diiFlowAvailable?: unknown;
    evidenceIds?: unknown;
  };
  mutualFundIntelligence?: {
    summary?: unknown;
    reportingPeriod?: unknown;
    disclosureDate?: unknown;
    mfDataAvailable?: unknown;
    evidenceIds?: unknown;
  };
  promoterIntelligence?: {
    summary?: unknown;
    pledgedSharesAvailable?: unknown;
    reportingPeriod?: unknown;
    evidenceIds?: unknown;
  };
  behaviourAnalysis?: {
    summary?: unknown;
    accumulationOrDistribution?: unknown;
    ownershipConcentrationNote?: unknown;
    evidenceIds?: unknown;
  };
  verifiedFacts?: Array<{ statement?: unknown; evidenceIds?: unknown }>;
  interpretations?: Array<{
    statement?: unknown;
    basis?: unknown;
    evidenceIds?: unknown;
  }>;
  assumptions?: unknown[];
  missingData?: unknown[];
  conflictingDisclosures?: unknown[];
  conclusion?: {
    summary?: unknown;
    evidenceIds?: unknown;
  };
}

function safeParseJson(raw: string): RawInstitutionalReportInput | null {
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
    return parsed as RawInstitutionalReportInput;
  } catch {
    return null;
  }
}

export function validateAndGroundInstitutionalOutput(
  rawText: string,
  pkg: EvidencePackage
): {
  report: InstitutionalIntelligenceReportOutput;
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

  const sanitizeArray = (arr: unknown): string[] =>
    Array.isArray(arr)
      ? arr
          .filter((x): x is string => typeof x === "string")
          .map((x) => sanitizeUntrustedText(x))
          .filter(Boolean)
      : [];

  const parsed = safeParseJson(rawText);
  if (!parsed) {
    return {
      report: buildFallbackReport(pkg),
      unsupportedClaims: ["Model output was not valid JSON and was rejected."],
      invalidEvidenceIdsCited: [],
      evidenceIdsUsed: [],
      rawResponseInvalid: true,
    };
  }

  const fiiSummary = sanitizeUntrustedText(
    typeof parsed.fiiIntelligence?.summary === "string"
      ? parsed.fiiIntelligence.summary
      : ""
  );
  const fiiIds = filterIds(
    parsed.fiiIntelligence?.evidenceIds,
    fiiSummary ? `fiiIntelligence: ${fiiSummary}` : ""
  );

  const diiSummary = sanitizeUntrustedText(
    typeof parsed.diiIntelligence?.summary === "string"
      ? parsed.diiIntelligence.summary
      : ""
  );
  const diiIds = filterIds(
    parsed.diiIntelligence?.evidenceIds,
    diiSummary ? `diiIntelligence: ${diiSummary}` : ""
  );

  const mfSummary = sanitizeUntrustedText(
    typeof parsed.mutualFundIntelligence?.summary === "string"
      ? parsed.mutualFundIntelligence.summary
      : ""
  );
  const mfIds = filterIds(
    parsed.mutualFundIntelligence?.evidenceIds,
    mfSummary ? `mutualFundIntelligence: ${mfSummary}` : ""
  );

  const promSummary = sanitizeUntrustedText(
    typeof parsed.promoterIntelligence?.summary === "string"
      ? parsed.promoterIntelligence.summary
      : ""
  );
  const promIds = filterIds(
    parsed.promoterIntelligence?.evidenceIds,
    promSummary ? `promoterIntelligence: ${promSummary}` : ""
  );

  const behSummary = sanitizeUntrustedText(
    typeof parsed.behaviourAnalysis?.summary === "string"
      ? parsed.behaviourAnalysis.summary
      : ""
  );
  const behIds = filterIds(
    parsed.behaviourAnalysis?.evidenceIds,
    behSummary ? `behaviourAnalysis: ${behSummary}` : ""
  );

  const verifiedFacts: GroundedFactClaim[] = (
    Array.isArray(parsed.verifiedFacts) ? parsed.verifiedFacts : []
  )
    .map((item) => {
      const statement = sanitizeUntrustedText(
        typeof item?.statement === "string" ? item.statement : ""
      );
      if (!statement) return null;
      const ids = filterIds(item?.evidenceIds, `verifiedFacts: ${statement}`);
      return { statement, evidenceIds: ids, grounded: ids.length > 0 };
    })
    .filter((x): x is GroundedFactClaim => x !== null);

  const interpretations: InstitutionalInterpretation[] = (
    Array.isArray(parsed.interpretations) ? parsed.interpretations : []
  )
    .map((item) => {
      const statement = sanitizeUntrustedText(
        typeof item?.statement === "string" ? item.statement : ""
      );
      if (!statement) return null;
      const ids = filterIds(
        item?.evidenceIds,
        `interpretations: ${statement}`
      );
      return {
        statement,
        basis: sanitizeUntrustedText(
          typeof item?.basis === "string" ? item.basis : ""
        ),
        evidenceIds: ids,
        verificationStatus: "LLM_INTERPRETATION_UNVERIFIED" as const,
      };
    })
    .filter((x): x is InstitutionalInterpretation => x !== null);

  const conclusionSummary = sanitizeUntrustedText(
    typeof parsed.conclusion?.summary === "string"
      ? parsed.conclusion.summary
      : ""
  );
  const conclusionIds = filterIds(
    parsed.conclusion?.evidenceIds,
    conclusionSummary ? `conclusion: ${conclusionSummary}` : ""
  );

  const rawAccum =
    typeof parsed.behaviourAnalysis?.accumulationOrDistribution === "string"
      ? parsed.behaviourAnalysis.accumulationOrDistribution.trim().toUpperCase()
      : "INSUFFICIENT_DATA";
  const accumulationOrDistribution = VALID_ACCUMULATION.has(rawAccum)
    ? (rawAccum as InstitutionalIntelligenceReportOutput["behaviourAnalysis"]["accumulationOrDistribution"])
    : "INSUFFICIENT_DATA";

  const conflictDescriptions = Array.from(
    new Set([
      ...pkg.conflicts.map(
        (c) =>
          `Conflicting disclosures for ${c.claim}: ${c.values
            .map((v) => `${v.source}=${v.value}`)
            .join(" vs ")}`
      ),
      ...sanitizeArray(parsed.conflictingDisclosures),
    ])
  );

  return {
    report: {
      fiiIntelligence: {
        summary: fiiSummary || "FII flow evidence unavailable.",
        cashFlowAvailable:
          Boolean(parsed.fiiIntelligence?.cashFlowAvailable) &&
          fiiIds.length > 0,
        derivativesFlowDistinguished: Boolean(
          parsed.fiiIntelligence?.derivativesFlowDistinguished
        ),
        evidenceIds: fiiIds,
      },
      diiIntelligence: {
        summary: diiSummary || "DII flow evidence unavailable.",
        diiFlowAvailable:
          Boolean(parsed.diiIntelligence?.diiFlowAvailable) &&
          diiIds.length > 0,
        evidenceIds: diiIds,
      },
      mutualFundIntelligence: {
        summary: mfSummary || "Mutual fund holding evidence unavailable.",
        reportingPeriod:
          typeof parsed.mutualFundIntelligence?.reportingPeriod === "string"
            ? sanitizeUntrustedText(parsed.mutualFundIntelligence.reportingPeriod) || null
            : null,
        disclosureDate:
          typeof parsed.mutualFundIntelligence?.disclosureDate === "string"
            ? sanitizeUntrustedText(parsed.mutualFundIntelligence.disclosureDate) || null
            : null,
        mfDataAvailable:
          Boolean(parsed.mutualFundIntelligence?.mfDataAvailable) &&
          mfIds.length > 0,
        evidenceIds: mfIds,
      },
      promoterIntelligence: {
        summary: promSummary || "Promoter holding & pledge evidence unavailable.",
        pledgedSharesAvailable:
          Boolean(parsed.promoterIntelligence?.pledgedSharesAvailable) &&
          promIds.length > 0,
        reportingPeriod:
          typeof parsed.promoterIntelligence?.reportingPeriod === "string"
            ? sanitizeUntrustedText(parsed.promoterIntelligence.reportingPeriod) || null
            : null,
        evidenceIds: promIds,
      },
      behaviourAnalysis: {
        summary:
          behSummary ||
          "Insufficient verified institutional disclosures to assess behaviour.",
        accumulationOrDistribution:
          behIds.length === 0 ? "INSUFFICIENT_DATA" : accumulationOrDistribution,
        ownershipConcentrationNote:
          sanitizeUntrustedText(
            typeof parsed.behaviourAnalysis?.ownershipConcentrationNote === "string"
              ? parsed.behaviourAnalysis.ownershipConcentrationNote
              : ""
          ) || "Unavailable.",
        evidenceIds: behIds,
      },
      verifiedFacts,
      interpretations,
      assumptions: sanitizeArray(parsed.assumptions),
      missingData: Array.from(
        new Set([...pkg.missingInformation, ...sanitizeArray(parsed.missingData)])
      ),
      conflictingDisclosures: conflictDescriptions,
      conclusion: {
        summary:
          conclusionSummary ||
          "Insufficient grounded institutional evidence to form a conclusion.",
        evidenceIds: conclusionIds,
        verificationStatus: "LLM_INSTITUTIONAL_INTELLIGENCE_UNVERIFIED",
      },
    },
    unsupportedClaims: Array.from(unsupportedClaims),
    invalidEvidenceIdsCited: Array.from(invalidEvidenceIdsCited),
    evidenceIdsUsed: Array.from(evidenceIdsUsed),
    rawResponseInvalid: false,
  };
}

function buildFallbackReport(
  pkg: EvidencePackage
): InstitutionalIntelligenceReportOutput {
  return {
    fiiIntelligence: {
      summary: "FII intelligence synthesis unavailable.",
      cashFlowAvailable: false,
      derivativesFlowDistinguished: false,
      evidenceIds: [],
    },
    diiIntelligence: {
      summary: "DII intelligence synthesis unavailable.",
      diiFlowAvailable: false,
      evidenceIds: [],
    },
    mutualFundIntelligence: {
      summary: "Mutual fund intelligence synthesis unavailable.",
      reportingPeriod: null,
      disclosureDate: null,
      mfDataAvailable: false,
      evidenceIds: [],
    },
    promoterIntelligence: {
      summary: "Promoter intelligence synthesis unavailable.",
      pledgedSharesAvailable: false,
      reportingPeriod: null,
      evidenceIds: [],
    },
    behaviourAnalysis: {
      summary: "Institutional behaviour synthesis unavailable.",
      accumulationOrDistribution: "INSUFFICIENT_DATA",
      ownershipConcentrationNote: "Unavailable.",
      evidenceIds: [],
    },
    verifiedFacts: [],
    interpretations: [],
    assumptions: [],
    missingData: pkg.missingInformation,
    conflictingDisclosures: pkg.conflicts.map(
      (c) => `Conflicting disclosures for ${c.claim}`
    ),
    conclusion: {
      summary: "Model output could not be validated against evidence.",
      evidenceIds: [],
      verificationStatus: "LLM_INSTITUTIONAL_INTELLIGENCE_UNVERIFIED",
    },
  };
}

