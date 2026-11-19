import { AITaskTier } from "../core/ModelRouter";
import { RawEvidenceInput, sanitizeUntrustedText } from "../evidence/EvidenceSchema";
import { EvidencePackage } from "../services/EvidenceIntelligenceService";

export class NewsMacroValidationError extends Error {
  public readonly statusCode = 400;
  public readonly code = "NEWS_MACRO_VALIDATION_ERROR";

  public constructor(message: string) {
    super(message);
    this.name = "NewsMacroValidationError";
  }
}

export interface NewsMacroRequestInput {
  symbol?: string;
  focus?: string;
  tier: AITaskTier;
}

const VALID_TIERS: ReadonlySet<string> = new Set(["deep", "balanced", "fast"]);
const NSE_SYMBOL_PATTERN = /^[A-Z0-9&-]{1,20}$/;

export function validateNewsMacroRequest(raw: unknown): NewsMacroRequestInput {
  if (
    raw !== undefined &&
    raw !== null &&
    (typeof raw !== "object" || Array.isArray(raw))
  ) {
    throw new NewsMacroValidationError("Request body must be a JSON object.");
  }

  const body = (raw as Record<string, unknown>) || {};

  let symbol: string | undefined;
  if (body.symbol !== undefined && body.symbol !== null && body.symbol !== "") {
    if (typeof body.symbol !== "string") {
      throw new NewsMacroValidationError(
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
      throw new NewsMacroValidationError(`Invalid NSE symbol "${body.symbol}".`);
    }
    symbol = normalized;
  }

  let focus: string | undefined;
  if (body.focus !== undefined && body.focus !== null) {
    if (typeof body.focus !== "string") {
      throw new NewsMacroValidationError(
        "Focus must be a string when provided."
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
    throw new NewsMacroValidationError(
      `Invalid AI tier "${tierRaw}". Allowed: deep, balanced, fast.`
    );
  }

  return { symbol, focus, tier: tierRaw as AITaskTier };
}

/**
 * Detects duplicate news stories across feeds by normalized headline/value text,
 * keeping the highest-priority source (official exchange > institutional > third-party)
 * and recording duplicate count.
 */
export function deduplicateNewsInputs(inputs: RawEvidenceInput[]): {
  deduplicated: RawEvidenceInput[];
  duplicateStoriesDetected: number;
} {
  const seenText = new Map<string, RawEvidenceInput>();
  const passthrough: RawEvidenceInput[] = [];
  let duplicateStoriesDetected = 0;

  for (const item of inputs) {
    if (
      (item.category === "THIRD_PARTY_NEWS" ||
        item.category === "COMPANY_ANNOUNCEMENT") &&
      typeof item.value === "string" &&
      item.value.trim().length > 0
    ) {
      const normKey = `${item.symbol}::${item.value
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, "")
        .replace(/\s+/g, " ")
        .trim()}`;

      const existing = seenText.get(normKey);
      if (existing) {
        duplicateStoriesDetected += 1;
        existing.metadata = {
          ...(existing.metadata ?? {}),
          duplicateCount: Number(existing.metadata?.duplicateCount ?? 0) + 1,
        };
        continue;
      }
      const copy: RawEvidenceInput = {
        ...item,
        metadata: item.metadata ? { ...item.metadata } : undefined,
      };
      seenText.set(normKey, copy);
      passthrough.push(copy);
    } else {
      passthrough.push(item);
    }
  }

  return { deduplicated: passthrough, duplicateStoriesDetected };
}

export type EventClassification = "POSITIVE" | "NEGATIVE" | "NEUTRAL" | "UNCERTAIN";
export type EpistemicStatus =
  | "CONFIRMED_FACT"
  | "PRELIMINARY_REPORT"
  | "ANALYST_INTERPRETATION"
  | "AI_ASSUMPTION";

export interface NewsMacroEventItem {
  title: string;
  source: string;
  publishedAt: string | null;
  eventTimestamp: string | null;
  affectedCompanies: string[];
  affectedSectors: string[];
  classification: EventClassification;
  epistemicStatus: EpistemicStatus;
  impactAssessment: string;
  supportingEvidenceIds: string[];
  contradictingEvidenceIds: string[];
  missingInformation: string[];
  grounded: boolean;
}

export interface GroundedStatement {
  statement: string;
  evidenceIds: string[];
  grounded: boolean;
}

export interface NewsMacroReportOutput {
  companyNews: { summary: string; evidenceIds: string[] };
  rbiAndMonetaryPolicy: {
    summary: string;
    repoRateMentioned: boolean;
    evidenceIds: string[];
  };
  indianEconomicIndicators: {
    summary: string;
    indicatorsCovered: string[];
    evidenceIds: string[];
  };
  globalMacro: {
    summary: string;
    driversCovered: string[];
    evidenceIds: string[];
  };
  events: NewsMacroEventItem[];
  confirmedFacts: GroundedStatement[];
  preliminaryReports: GroundedStatement[];
  analystInterpretations: Array<{
    statement: string;
    basis: string;
    evidenceIds: string[];
    verificationStatus: "LLM_INTERPRETATION_UNVERIFIED";
  }>;
  aiAssumptions: string[];
  missingData: string[];
  conflictingReports: string[];
  conclusion: {
    summary: string;
    evidenceIds: string[];
    verificationStatus: "LLM_NEWS_MACRO_UNVERIFIED";
  };
}

export interface NewsMacroAgentResponse {
  symbol: string | null;
  focus: string | null;
  verificationStatus: "LLM_NEWS_MACRO_UNVERIFIED";
  readOnly: true;
  model: string;
  provider?: string;
  evidenceRecords?: import("../evidence/EvidenceSchema").EvidenceRecord[];
  tier: AITaskTier;
  generatedAt: string;
  duplicateStoriesDetected: number;
  report: NewsMacroReportOutput;
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

const VALID_CLASSIFICATIONS: ReadonlySet<string> = new Set([
  "POSITIVE",
  "NEGATIVE",
  "NEUTRAL",
  "UNCERTAIN",
]);

const VALID_EPISTEMIC: ReadonlySet<string> = new Set([
  "CONFIRMED_FACT",
  "PRELIMINARY_REPORT",
  "ANALYST_INTERPRETATION",
  "AI_ASSUMPTION",
]);

interface RawNewsMacroPayload {
  companyNews?: { summary?: unknown; evidenceIds?: unknown };
  rbiAndMonetaryPolicy?: {
    summary?: unknown;
    repoRateMentioned?: unknown;
    evidenceIds?: unknown;
  };
  indianEconomicIndicators?: {
    summary?: unknown;
    indicatorsCovered?: unknown;
    evidenceIds?: unknown;
  };
  globalMacro?: {
    summary?: unknown;
    driversCovered?: unknown;
    evidenceIds?: unknown;
  };
  events?: Array<{
    title?: unknown;
    source?: unknown;
    publishedAt?: unknown;
    eventTimestamp?: unknown;
    affectedCompanies?: unknown;
    affectedSectors?: unknown;
    classification?: unknown;
    epistemicStatus?: unknown;
    impactAssessment?: unknown;
    supportingEvidenceIds?: unknown;
    contradictingEvidenceIds?: unknown;
    missingInformation?: unknown;
  }>;
  confirmedFacts?: Array<{ statement?: unknown; evidenceIds?: unknown }>;
  preliminaryReports?: Array<{ statement?: unknown; evidenceIds?: unknown }>;
  analystInterpretations?: Array<{
    statement?: unknown;
    basis?: unknown;
    evidenceIds?: unknown;
  }>;
  aiAssumptions?: unknown[];
  missingData?: unknown[];
  conflictingReports?: unknown[];
  conclusion?: { summary?: unknown; evidenceIds?: unknown };
}

function safeParseJson(raw: string): RawNewsMacroPayload | null {
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
    return parsed as RawNewsMacroPayload;
  } catch {
    return null;
  }
}

export function validateAndGroundNewsMacroOutput(
  rawText: string,
  pkg: EvidencePackage
): {
  report: NewsMacroReportOutput;
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

  const companySummary = sanitizeUntrustedText(
    typeof parsed.companyNews?.summary === "string"
      ? parsed.companyNews.summary
      : ""
  );
  const companyIds = filterIds(
    parsed.companyNews?.evidenceIds,
    companySummary ? `companyNews: ${companySummary}` : ""
  );

  const rbiSummary = sanitizeUntrustedText(
    typeof parsed.rbiAndMonetaryPolicy?.summary === "string"
      ? parsed.rbiAndMonetaryPolicy.summary
      : ""
  );
  const rbiIds = filterIds(
    parsed.rbiAndMonetaryPolicy?.evidenceIds,
    rbiSummary ? `rbiAndMonetaryPolicy: ${rbiSummary}` : ""
  );

  const econSummary = sanitizeUntrustedText(
    typeof parsed.indianEconomicIndicators?.summary === "string"
      ? parsed.indianEconomicIndicators.summary
      : ""
  );
  const econIds = filterIds(
    parsed.indianEconomicIndicators?.evidenceIds,
    econSummary ? `indianEconomicIndicators: ${econSummary}` : ""
  );

  const globalSummary = sanitizeUntrustedText(
    typeof parsed.globalMacro?.summary === "string"
      ? parsed.globalMacro.summary
      : ""
  );
  const globalIds = filterIds(
    parsed.globalMacro?.evidenceIds,
    globalSummary ? `globalMacro: ${globalSummary}` : ""
  );

  const events: NewsMacroEventItem[] = (
    Array.isArray(parsed.events) ? parsed.events : []
  )
    .map((ev) => {
      const title = sanitizeUntrustedText(
        typeof ev?.title === "string" ? ev.title : ""
      );
      if (!title) return null;
      const supportIds = filterIds(
        ev?.supportingEvidenceIds,
        `event: ${title}`
      );
      const contraIds = filterIds(ev?.contradictingEvidenceIds, "");
      const rawClass =
        typeof ev?.classification === "string"
          ? ev.classification.trim().toUpperCase()
          : "UNCERTAIN";
      const rawEpistemic =
        typeof ev?.epistemicStatus === "string"
          ? ev.epistemicStatus.trim().toUpperCase()
          : "PRELIMINARY_REPORT";

      return {
        title,
        source: sanitizeUntrustedText(
          typeof ev?.source === "string" ? ev.source : "UNKNOWN"
        ),
        publishedAt:
          typeof ev?.publishedAt === "string" ? ev.publishedAt : null,
        eventTimestamp:
          typeof ev?.eventTimestamp === "string" ? ev.eventTimestamp : null,
        affectedCompanies: sanitizeArray(ev?.affectedCompanies),
        affectedSectors: sanitizeArray(ev?.affectedSectors),
        classification: VALID_CLASSIFICATIONS.has(rawClass)
          ? (rawClass as EventClassification)
          : "UNCERTAIN",
        epistemicStatus: VALID_EPISTEMIC.has(rawEpistemic)
          ? (rawEpistemic as EpistemicStatus)
          : "PRELIMINARY_REPORT",
        impactAssessment: sanitizeUntrustedText(
          typeof ev?.impactAssessment === "string" ? ev.impactAssessment : ""
        ),
        supportingEvidenceIds: supportIds,
        contradictingEvidenceIds: contraIds,
        missingInformation: sanitizeArray(ev?.missingInformation),
        grounded: supportIds.length > 0,
      };
    })
    .filter((x): x is NewsMacroEventItem => x !== null);

  const parseStatements = (
    rawList: unknown,
    label: string
  ): GroundedStatement[] =>
    (Array.isArray(rawList) ? rawList : [])
      .map((item: { statement?: unknown; evidenceIds?: unknown }) => {
        const statement = sanitizeUntrustedText(
          typeof item?.statement === "string" ? item.statement : ""
        );
        if (!statement) return null;
        const ids = filterIds(item?.evidenceIds, `${label}: ${statement}`);
        return { statement, evidenceIds: ids, grounded: ids.length > 0 };
      })
      .filter((x): x is GroundedStatement => x !== null);

  const confirmedFacts = parseStatements(
    parsed.confirmedFacts,
    "confirmedFacts"
  );
  const preliminaryReports = parseStatements(
    parsed.preliminaryReports,
    "preliminaryReports"
  );

  const analystInterpretations = (
    Array.isArray(parsed.analystInterpretations)
      ? parsed.analystInterpretations
      : []
  )
    .map((item) => {
      const statement = sanitizeUntrustedText(
        typeof item?.statement === "string" ? item.statement : ""
      );
      if (!statement) return null;
      const ids = filterIds(
        item?.evidenceIds,
        `analystInterpretations: ${statement}`
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
    .filter(
      (
        x
      ): x is NewsMacroReportOutput["analystInterpretations"][number] =>
        x !== null
    );

  const conclusionSummary = sanitizeUntrustedText(
    typeof parsed.conclusion?.summary === "string"
      ? parsed.conclusion.summary
      : ""
  );
  const conclusionIds = filterIds(
    parsed.conclusion?.evidenceIds,
    conclusionSummary ? `conclusion: ${conclusionSummary}` : ""
  );

  const conflictReports = Array.from(
    new Set([
      ...pkg.conflicts.map(
        (c) =>
          `Conflicting reports for ${c.claim}: ${c.values
            .map((v) => `${v.source}=${v.value}`)
            .join(" vs ")}`
      ),
      ...sanitizeArray(parsed.conflictingReports),
    ])
  );

  return {
    report: {
      companyNews: {
        summary: companySummary || "Company news evidence unavailable.",
        evidenceIds: companyIds,
      },
      rbiAndMonetaryPolicy: {
        summary: rbiSummary || "RBI & monetary policy evidence unavailable.",
        repoRateMentioned:
          Boolean(parsed.rbiAndMonetaryPolicy?.repoRateMentioned) &&
          rbiIds.length > 0,
        evidenceIds: rbiIds,
      },
      indianEconomicIndicators: {
        summary: econSummary || "Indian macro indicator evidence unavailable.",
        indicatorsCovered: sanitizeArray(
          parsed.indianEconomicIndicators?.indicatorsCovered
        ),
        evidenceIds: econIds,
      },
      globalMacro: {
        summary: globalSummary || "Global macro evidence unavailable.",
        driversCovered: sanitizeArray(parsed.globalMacro?.driversCovered),
        evidenceIds: globalIds,
      },
      events,
      confirmedFacts,
      preliminaryReports,
      analystInterpretations,
      aiAssumptions: sanitizeArray(parsed.aiAssumptions),
      missingData: Array.from(
        new Set([...pkg.missingInformation, ...sanitizeArray(parsed.missingData)])
      ),
      conflictingReports: conflictReports,
      conclusion: {
        summary:
          conclusionSummary ||
          "Insufficient grounded news/macro evidence for a conclusion.",
        evidenceIds: conclusionIds,
        verificationStatus: "LLM_NEWS_MACRO_UNVERIFIED",
      },
    },
    unsupportedClaims: Array.from(unsupportedClaims),
    invalidEvidenceIdsCited: Array.from(invalidEvidenceIdsCited),
    evidenceIdsUsed: Array.from(evidenceIdsUsed),
    rawResponseInvalid: false,
  };
}

function buildFallbackReport(pkg: EvidencePackage): NewsMacroReportOutput {
  return {
    companyNews: { summary: "Unavailable.", evidenceIds: [] },
    rbiAndMonetaryPolicy: {
      summary: "Unavailable.",
      repoRateMentioned: false,
      evidenceIds: [],
    },
    indianEconomicIndicators: {
      summary: "Unavailable.",
      indicatorsCovered: [],
      evidenceIds: [],
    },
    globalMacro: {
      summary: "Unavailable.",
      driversCovered: [],
      evidenceIds: [],
    },
    events: [],
    confirmedFacts: [],
    preliminaryReports: [],
    analystInterpretations: [],
    aiAssumptions: [],
    missingData: pkg.missingInformation,
    conflictingReports: pkg.conflicts.map((c) => `Conflict for ${c.claim}`),
    conclusion: {
      summary: "Model output could not be validated against evidence.",
      evidenceIds: [],
      verificationStatus: "LLM_NEWS_MACRO_UNVERIFIED",
    },
  };
}

