import { AITaskTier } from "../core/ModelRouter";
import { sanitizeUntrustedText } from "../evidence/EvidenceSchema";
import { EvidencePackage } from "../services/EvidenceIntelligenceService";

export class CompanyResearchValidationError extends Error {
  public readonly statusCode = 400;
  public readonly code = "COMPANY_RESEARCH_VALIDATION_ERROR";

  public constructor(message: string) {
    super(message);
    this.name = "CompanyResearchValidationError";
  }
}

export interface CompanyResearchRequestInput {
  symbol: string;
  question?: string;
  tier: AITaskTier;
}

const VALID_TIERS: ReadonlySet<string> = new Set(["deep", "balanced", "fast"]);
const NSE_SYMBOL_PATTERN = /^[A-Z0-9&-]{1,20}$/;

export function validateCompanyResearchRequest(
  raw: unknown
): CompanyResearchRequestInput {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new CompanyResearchValidationError(
      "Request body must be a JSON object with an NSE symbol."
    );
  }

  const body = raw as Record<string, unknown>;
  if (typeof body.symbol !== "string" || body.symbol.trim().length === 0) {
    throw new CompanyResearchValidationError("NSE symbol is required.");
  }

  const normalizedSymbol = body.symbol
    .trim()
    .toUpperCase()
    .replace(/^NSE:/i, "")
    .replace(/\.NS$/i, "")
    .replace(/\.BO$/i, "");

  if (!NSE_SYMBOL_PATTERN.test(normalizedSymbol)) {
    throw new CompanyResearchValidationError(
      `Invalid NSE symbol "${body.symbol}". Expected 1-20 alphanumeric characters (e.g. RELIANCE, TCS, M&M).`
    );
  }

  let question: string | undefined;
  if (body.question !== undefined && body.question !== null) {
    if (typeof body.question !== "string") {
      throw new CompanyResearchValidationError(
        "Research question must be a string when provided."
      );
    }
    const sanitized = sanitizeUntrustedText(body.question).slice(0, 500);
    if (sanitized.length > 0) {
      question = sanitized;
    }
  }

  const tierRaw =
    typeof body.tier === "string" ? body.tier.trim().toLowerCase() : "deep";
  if (!VALID_TIERS.has(tierRaw)) {
    throw new CompanyResearchValidationError(
      `Invalid AI tier "${tierRaw}". Allowed: deep, balanced, fast.`
    );
  }

  return {
    symbol: normalizedSymbol,
    question,
    tier: tierRaw as AITaskTier,
  };
}

export interface EvidenceLinkedSection {
  summary: string;
  evidenceIds: string[];
}

export interface EvidenceLinkedPoint {
  point: string;
  evidenceIds: string[];
  grounded: boolean;
}

export interface EvidenceLinkedRisk {
  risk: string;
  evidenceIds: string[];
  grounded: boolean;
}

export type ResearchStance =
  | "CONSTRUCTIVE"
  | "NEUTRAL"
  | "CAUTIOUS"
  | "INSUFFICIENT_DATA";

export interface CompanyResearchReportOutput {
  companyOverview: EvidenceLinkedSection & {
    sector: string | null;
    industry: string | null;
  };
  financialPerformance: EvidenceLinkedSection;
  growthTrends: EvidenceLinkedSection;
  valuation: EvidenceLinkedSection & {
    valuationDataAvailable: boolean;
  };
  institutionalActivity: EvidenceLinkedSection;
  newsAndCatalysts: EvidenceLinkedSection & {
    catalysts: string[];
  };
  bullishEvidence: EvidenceLinkedPoint[];
  bearishEvidence: EvidenceLinkedPoint[];
  keyRisks: EvidenceLinkedRisk[];
  missingData: string[];
  invalidationConditions: string[];
  conclusion: {
    summary: string;
    stance: ResearchStance;
    evidenceIds: string[];
    verificationStatus: "LLM_RESEARCH_UNVERIFIED";
  };
}

export interface CompanyResearchAgentResponse {
  symbol: string;
  question: string | null;
  verificationStatus: "LLM_RESEARCH_UNVERIFIED";
  readOnly: true;
  model: string;
  provider?: string;
  evidenceRecords?: import("../evidence/EvidenceSchema").EvidenceRecord[];
  tier: AITaskTier;
  generatedAt: string;
  report: CompanyResearchReportOutput;
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

interface RawSectionInput {
  summary?: unknown;
  evidenceIds?: unknown;
  sector?: unknown;
  industry?: unknown;
  valuationDataAvailable?: unknown;
  catalysts?: unknown;
}

interface RawReportInput {
  companyOverview?: RawSectionInput;
  financialPerformance?: RawSectionInput;
  growthTrends?: RawSectionInput;
  valuation?: RawSectionInput;
  institutionalActivity?: RawSectionInput;
  newsAndCatalysts?: RawSectionInput;
  bullishEvidence?: Array<{ point?: unknown; evidenceIds?: unknown }>;
  bearishEvidence?: Array<{ point?: unknown; evidenceIds?: unknown }>;
  keyRisks?: Array<{ risk?: unknown; evidenceIds?: unknown }>;
  missingData?: unknown[];
  invalidationConditions?: unknown[];
  conclusion?: {
    summary?: unknown;
    stance?: unknown;
    evidenceIds?: unknown;
  };
}

const VALID_STANCES: ReadonlySet<string> = new Set([
  "CONSTRUCTIVE",
  "NEUTRAL",
  "CAUTIOUS",
  "INSUFFICIENT_DATA",
]);

function safeParseJsonObject(raw: string): RawReportInput | null {
  if (!raw || typeof raw !== "string") {
    return null;
  }
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
    return parsed as RawReportInput;
  } catch {
    return null;
  }
}

export function validateAndGroundResearchOutput(
  rawText: string,
  pkg: EvidencePackage
): {
  report: CompanyResearchReportOutput;
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
      if (contextLabel) {
        unsupportedClaims.add(contextLabel);
      }
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

  const parsed = safeParseJsonObject(rawText);
  if (!parsed) {
    return {
      report: buildFallbackReport(pkg),
      unsupportedClaims: ["Model output was not valid JSON and was rejected."],
      invalidEvidenceIdsCited: [],
      evidenceIdsUsed: [],
      rawResponseInvalid: true,
    };
  }

  const parseSection = (
    sec: RawSectionInput | undefined,
    sectionName: string
  ): EvidenceLinkedSection => {
    const summary = sanitizeUntrustedText(
      typeof sec?.summary === "string" ? sec.summary : ""
    );
    const ids = filterIds(
      sec?.evidenceIds,
      summary ? `${sectionName}: ${summary}` : ""
    );
    return {
      summary: summary || "Insufficient verified evidence available.",
      evidenceIds: ids,
    };
  };

  const companyOverviewBase = parseSection(
    parsed.companyOverview,
    "companyOverview"
  );
  const financialPerformance = parseSection(
    parsed.financialPerformance,
    "financialPerformance"
  );
  const growthTrends = parseSection(parsed.growthTrends, "growthTrends");
  const valuationBase = parseSection(parsed.valuation, "valuation");
  const institutionalActivity = parseSection(
    parsed.institutionalActivity,
    "institutionalActivity"
  );
  const newsBase = parseSection(parsed.newsAndCatalysts, "newsAndCatalysts");

  const bullishEvidence: EvidenceLinkedPoint[] = (
    Array.isArray(parsed.bullishEvidence) ? parsed.bullishEvidence : []
  )
    .map((item) => {
      const point = sanitizeUntrustedText(
        typeof item?.point === "string" ? item.point : ""
      );
      if (!point) return null;
      const ids = filterIds(item?.evidenceIds, `bullishEvidence: ${point}`);
      return {
        point,
        evidenceIds: ids,
        grounded: ids.length > 0,
      };
    })
    .filter((x): x is EvidenceLinkedPoint => x !== null);

  const bearishEvidence: EvidenceLinkedPoint[] = (
    Array.isArray(parsed.bearishEvidence) ? parsed.bearishEvidence : []
  )
    .map((item) => {
      const point = sanitizeUntrustedText(
        typeof item?.point === "string" ? item.point : ""
      );
      if (!point) return null;
      const ids = filterIds(item?.evidenceIds, `bearishEvidence: ${point}`);
      return {
        point,
        evidenceIds: ids,
        grounded: ids.length > 0,
      };
    })
    .filter((x): x is EvidenceLinkedPoint => x !== null);

  const keyRisks: EvidenceLinkedRisk[] = (
    Array.isArray(parsed.keyRisks) ? parsed.keyRisks : []
  )
    .map((item) => {
      const risk = sanitizeUntrustedText(
        typeof item?.risk === "string" ? item.risk : ""
      );
      if (!risk) return null;
      const ids = filterIds(item?.evidenceIds, `keyRisks: ${risk}`);
      return {
        risk,
        evidenceIds: ids,
        grounded: ids.length > 0,
      };
    })
    .filter((x): x is EvidenceLinkedRisk => x !== null);

  const llmMissing = Array.isArray(parsed.missingData)
    ? parsed.missingData
        .filter((m): m is string => typeof m === "string")
        .map((m) => sanitizeUntrustedText(m))
        .filter(Boolean)
    : [];

  const invalidationConditions = Array.isArray(parsed.invalidationConditions)
    ? parsed.invalidationConditions
        .filter((c): c is string => typeof c === "string")
        .map((c) => sanitizeUntrustedText(c))
        .filter(Boolean)
    : [];

  const conclusionSummary = sanitizeUntrustedText(
    typeof parsed.conclusion?.summary === "string"
      ? parsed.conclusion.summary
      : ""
  );
  const rawStance =
    typeof parsed.conclusion?.stance === "string"
      ? parsed.conclusion.stance.trim().toUpperCase()
      : "INSUFFICIENT_DATA";
  const stance: ResearchStance = VALID_STANCES.has(rawStance)
    ? (rawStance as ResearchStance)
    : "INSUFFICIENT_DATA";
  const conclusionIds = filterIds(
    parsed.conclusion?.evidenceIds,
    conclusionSummary ? `conclusion: ${conclusionSummary}` : ""
  );

  const catalysts = Array.isArray(parsed.newsAndCatalysts?.catalysts)
    ? parsed.newsAndCatalysts.catalysts
        .filter((c): c is string => typeof c === "string")
        .map((c) => sanitizeUntrustedText(c))
        .filter(Boolean)
    : [];

  return {
    report: {
      companyOverview: {
        ...companyOverviewBase,
        sector:
          typeof parsed.companyOverview?.sector === "string"
            ? sanitizeUntrustedText(parsed.companyOverview.sector) || null
            : null,
        industry:
          typeof parsed.companyOverview?.industry === "string"
            ? sanitizeUntrustedText(parsed.companyOverview.industry) || null
            : null,
      },
      financialPerformance,
      growthTrends,
      valuation: {
        ...valuationBase,
        valuationDataAvailable:
          Boolean(parsed.valuation?.valuationDataAvailable) &&
          valuationBase.evidenceIds.length > 0,
      },
      institutionalActivity,
      newsAndCatalysts: {
        ...newsBase,
        catalysts,
      },
      bullishEvidence,
      bearishEvidence,
      keyRisks,
      missingData: Array.from(
        new Set([...pkg.missingInformation, ...llmMissing])
      ),
      invalidationConditions,
      conclusion: {
        summary:
          conclusionSummary ||
          "Insufficient grounded evidence to form a research conclusion.",
        stance:
          conclusionIds.length === 0 ? "INSUFFICIENT_DATA" : stance,
        evidenceIds: conclusionIds,
        verificationStatus: "LLM_RESEARCH_UNVERIFIED",
      },
    },
    unsupportedClaims: Array.from(unsupportedClaims),
    invalidEvidenceIdsCited: Array.from(invalidEvidenceIdsCited),
    evidenceIdsUsed: Array.from(evidenceIdsUsed),
    rawResponseInvalid: false,
  };
}

function buildFallbackReport(pkg: EvidencePackage): CompanyResearchReportOutput {
  return {
    companyOverview: {
      summary: "Structured research synthesis unavailable.",
      sector: null,
      industry: null,
      evidenceIds: [],
    },
    financialPerformance: {
      summary: "Structured financial synthesis unavailable.",
      evidenceIds: [],
    },
    growthTrends: {
      summary: "Structured growth synthesis unavailable.",
      evidenceIds: [],
    },
    valuation: {
      summary: "Structured valuation synthesis unavailable.",
      valuationDataAvailable: false,
      evidenceIds: [],
    },
    institutionalActivity: {
      summary: "Structured institutional activity synthesis unavailable.",
      evidenceIds: [],
    },
    newsAndCatalysts: {
      summary: "Structured news synthesis unavailable.",
      catalysts: [],
      evidenceIds: [],
    },
    bullishEvidence: [],
    bearishEvidence: [],
    keyRisks: [],
    missingData: pkg.missingInformation,
    invalidationConditions: [],
    conclusion: {
      summary: "Model output could not be validated against evidence.",
      stance: "INSUFFICIENT_DATA",
      evidenceIds: [],
      verificationStatus: "LLM_RESEARCH_UNVERIFIED",
    },
  };
}

