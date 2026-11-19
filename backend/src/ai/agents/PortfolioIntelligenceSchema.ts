import { AITaskTier } from "../core/ModelRouter";
import { sanitizeUntrustedText } from "../evidence/EvidenceSchema";
import { EvidencePackage } from "../services/EvidenceIntelligenceService";

export class PortfolioIntelligenceValidationError extends Error {
  public readonly statusCode = 400;
  public readonly code = "PORTFOLIO_INTELLIGENCE_VALIDATION_ERROR";

  public constructor(message: string) {
    super(message);
    this.name = "PortfolioIntelligenceValidationError";
  }
}

export interface PortfolioRequestInput {
  focus?: string;
  tier: AITaskTier;
}

const VALID_TIERS: ReadonlySet<string> = new Set(["deep", "balanced", "fast"]);

export function validatePortfolioRequest(raw: unknown): PortfolioRequestInput {
  if (
    raw !== undefined &&
    raw !== null &&
    (typeof raw !== "object" || Array.isArray(raw))
  ) {
    throw new PortfolioIntelligenceValidationError(
      "Request body must be a JSON object."
    );
  }
  const body = (raw as Record<string, unknown>) || {};

  let focus: string | undefined;
  if (body.focus !== undefined && body.focus !== null) {
    if (typeof body.focus !== "string") {
      throw new PortfolioIntelligenceValidationError(
        "Focus must be a string when provided."
      );
    }
    const sanitized = sanitizeUntrustedText(body.focus).slice(0, 500);
    if (sanitized.length > 0) focus = sanitized;
  }

  const tierRaw =
    typeof body.tier === "string" ? body.tier.trim().toLowerCase() : "balanced";
  if (!VALID_TIERS.has(tierRaw)) {
    throw new PortfolioIntelligenceValidationError(
      `Invalid AI tier "${tierRaw}". Allowed: deep, balanced, fast.`
    );
  }

  return { focus, tier: tierRaw as AITaskTier };
}

export interface PortfolioPositionRecord {
  id: string;
  userId: string;
  instrument: string;
  sector?: string | null;
  side: "BUY" | "SELL";
  quantity: number;
  entryPrice: number;
  currentPrice: number | null;
  realizedPnL?: number | null;
  stopLoss?: number | null;
  status: "OPEN" | "CLOSING" | "CLOSED";
  updatedAt?: string;
}

export interface InvalidHoldingIssue {
  positionId: string;
  instrument: string;
  reason: string;
}

export interface DeterministicPortfolioMetrics {
  userId: string;
  openPositionCount: number;
  closedPositionCount: number;
  totalExposure: number;
  unrealizedPnL: number | null;
  realizedPnL: number;
  maxPositionConcentrationPct: number | null;
  allocations: Array<{
    instrument: string;
    sector: string | null;
    exposure: number;
    allocationPct: number;
    unrealizedPnL: number | null;
  }>;
  sectorExposure: Record<string, number>;
  invalidHoldings: InvalidHoldingIssue[];
  missingPriceInstruments: string[];
}

export function computeDeterministicPortfolioMetrics(
  userId: string,
  allPositions: PortfolioPositionRecord[]
): DeterministicPortfolioMetrics {
  // Enforce strict user ownership isolation
  const userPositions = allPositions.filter((p) => p.userId === userId);

  const invalidHoldings: InvalidHoldingIssue[] = [];
  const validOpen: PortfolioPositionRecord[] = [];
  const validClosed: PortfolioPositionRecord[] = [];

  for (const pos of userPositions) {
    if (
      !pos.instrument ||
      typeof pos.quantity !== "number" ||
      !Number.isFinite(pos.quantity) ||
      pos.quantity <= 0 ||
      typeof pos.entryPrice !== "number" ||
      !Number.isFinite(pos.entryPrice) ||
      pos.entryPrice <= 0
    ) {
      invalidHoldings.push({
        positionId: pos.id,
        instrument: pos.instrument || "UNKNOWN",
        reason: "Invalid quantity or entryPrice (must be finite > 0).",
      });
      continue;
    }

    if (pos.status === "CLOSED") {
      validClosed.push(pos);
    } else {
      validOpen.push(pos);
    }
  }

  let totalExposure = 0;
  let unrealizedSum = 0;
  let hasAnyPricedOpen = false;
  let hasMissingPrice = false;
  const missingPriceInstruments: string[] = [];
  const sectorExposure: Record<string, number> = {};

  const rawAllocations: Array<{
    instrument: string;
    sector: string | null;
    exposure: number;
    unrealizedPnL: number | null;
  }> = [];

  for (const pos of validOpen) {
    const hasPrice =
      typeof pos.currentPrice === "number" &&
      Number.isFinite(pos.currentPrice) &&
      pos.currentPrice > 0;

    const markPrice = hasPrice ? pos.currentPrice! : null;
    const exposure = markPrice !== null ? Math.abs(pos.quantity * markPrice) : 0;
    const pnl =
      markPrice !== null
        ? Number(
            (
              (markPrice - pos.entryPrice) *
              pos.quantity *
              (pos.side === "SELL" ? -1 : 1)
            ).toFixed(2)
          )
        : null;

    if (markPrice !== null) {
      hasAnyPricedOpen = true;
      totalExposure += exposure;
      unrealizedSum += pnl!;
    } else {
      hasMissingPrice = true;
      missingPriceInstruments.push(pos.instrument);
    }

    const sectorKey = pos.sector?.trim() || "UNCLASSIFIED";
    sectorExposure[sectorKey] = Number(
      ((sectorExposure[sectorKey] ?? 0) + exposure).toFixed(2)
    );

    rawAllocations.push({
      instrument: pos.instrument,
      sector: pos.sector ?? null,
      exposure: Number(exposure.toFixed(2)),
      unrealizedPnL: pnl,
    });
  }

  const allocations = rawAllocations.map((a) => ({
    ...a,
    allocationPct:
      totalExposure > 0
        ? Number(((a.exposure / totalExposure) * 100).toFixed(2))
        : 0,
  }));

  const maxPositionConcentrationPct =
    allocations.length > 0 && totalExposure > 0
      ? Math.max(...allocations.map((a) => a.allocationPct))
      : null;

  const realizedPnL = Number(
    validClosed
      .reduce(
        (acc, p) =>
          acc +
          (typeof p.realizedPnL === "number" && Number.isFinite(p.realizedPnL)
            ? p.realizedPnL
            : 0),
        0
      )
      .toFixed(2)
  );

  return {
    userId,
    openPositionCount: validOpen.length,
    closedPositionCount: validClosed.length,
    totalExposure: Number(totalExposure.toFixed(2)),
    unrealizedPnL:
      validOpen.length === 0
        ? 0
        : hasAnyPricedOpen && !hasMissingPrice
          ? Number(unrealizedSum.toFixed(2))
          : hasAnyPricedOpen
            ? Number(unrealizedSum.toFixed(2))
            : null,
    realizedPnL,
    maxPositionConcentrationPct,
    allocations,
    sectorExposure,
    invalidHoldings,
    missingPriceInstruments: Array.from(new Set(missingPriceInstruments)),
  };
}

export interface PortfolioIntelligenceReportOutput {
  portfolioOverview: { summary: string; evidenceIds: string[] };
  allocationAndSectorExposure: { summary: string; evidenceIds: string[] };
  concentrationRisk: { summary: string; evidenceIds: string[] };
  pnlAndPerformance: { summary: string; evidenceIds: string[] };
  keyRisks: Array<{ risk: string; evidenceIds: string[]; grounded: boolean }>;
  missingData: string[];
  conclusion: {
    summary: string;
    evidenceIds: string[];
    verificationStatus: "LLM_PORTFOLIO_INTELLIGENCE_UNVERIFIED";
  };
}

export interface PortfolioIntelligenceAgentResponse {
  userId: string;
  focus: string | null;
  verificationStatus: "LLM_PORTFOLIO_INTELLIGENCE_UNVERIFIED";
  readOnly: true;
  model: string;
  provider?: string;
  evidenceRecords?: import("../evidence/EvidenceSchema").EvidenceRecord[];
  tier: AITaskTier;
  generatedAt: string;
  deterministicMetrics: DeterministicPortfolioMetrics;
  report: PortfolioIntelligenceReportOutput;
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

export function validateAndGroundPortfolioOutput(
  rawText: string,
  pkg: EvidencePackage
): {
  report: PortfolioIntelligenceReportOutput;
  unsupportedClaims: string[];
  invalidEvidenceIdsCited: string[];
  evidenceIdsUsed: string[];
  rawResponseInvalid: boolean;
} {
  const usableIds = new Set(
    pkg.allRecords
      .filter((r) => r.value !== null && r.freshness !== "EXPIRED")
      .map((r) => r.evidenceId)
  );
  const invalidCited = new Set<string>();
  const unsupported = new Set<string>();
  const used = new Set<string>();

  const filterIds = (rawIds: unknown, label: string): string[] => {
    if (!Array.isArray(rawIds)) {
      if (label) unsupported.add(label);
      return [];
    }
    const valid: string[] = [];
    for (const idRaw of rawIds) {
      if (typeof idRaw !== "string") continue;
      const id = idRaw.trim();
      if (!id) continue;
      if (usableIds.has(id)) {
        valid.push(id);
        used.add(id);
      } else {
        invalidCited.add(id);
      }
    }
    if (valid.length === 0 && label) unsupported.add(label);
    return Array.from(new Set(valid));
  };

  let parsed: Record<string, any> | null = null;
  try {
    const cleaned = rawText
      .trim()
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();
    const obj = JSON.parse(cleaned);
    if (obj && typeof obj === "object" && !Array.isArray(obj)) parsed = obj;
  } catch {
    parsed = null;
  }

  if (!parsed) {
    return {
      report: {
        portfolioOverview: { summary: "Unavailable.", evidenceIds: [] },
        allocationAndSectorExposure: { summary: "Unavailable.", evidenceIds: [] },
        concentrationRisk: { summary: "Unavailable.", evidenceIds: [] },
        pnlAndPerformance: { summary: "Unavailable.", evidenceIds: [] },
        keyRisks: [],
        missingData: pkg.missingInformation,
        conclusion: {
          summary: "Model output could not be validated against evidence.",
          evidenceIds: [],
          verificationStatus: "LLM_PORTFOLIO_INTELLIGENCE_UNVERIFIED",
        },
      },
      unsupportedClaims: ["Model output was not valid JSON and was rejected."],
      invalidEvidenceIdsCited: [],
      evidenceIdsUsed: [],
      rawResponseInvalid: true,
    };
  }

  const parseSec = (sec: any, name: string) => {
    const summary = sanitizeUntrustedText(
      typeof sec?.summary === "string" ? sec.summary : ""
    );
    const ids = filterIds(sec?.evidenceIds, summary ? `${name}: ${summary}` : "");
    return { summary: summary || "Unavailable.", evidenceIds: ids };
  };

  const keyRisks = (Array.isArray(parsed.keyRisks) ? parsed.keyRisks : [])
    .map((r: any) => {
      const risk = sanitizeUntrustedText(typeof r?.risk === "string" ? r.risk : "");
      if (!risk) return null;
      const ids = filterIds(r?.evidenceIds, `keyRisks: ${risk}`);
      return { risk, evidenceIds: ids, grounded: ids.length > 0 };
    })
    .filter((x: any): x is NonNullable<typeof x> => x !== null);

  const conclusionSummary = sanitizeUntrustedText(
    typeof parsed.conclusion?.summary === "string" ? parsed.conclusion.summary : ""
  );
  const conclusionIds = filterIds(
    parsed.conclusion?.evidenceIds,
    conclusionSummary ? `conclusion: ${conclusionSummary}` : ""
  );

  const llmMissing = Array.isArray(parsed.missingData)
    ? parsed.missingData
        .filter((x: unknown): x is string => typeof x === "string")
        .map((x: string) => sanitizeUntrustedText(x))
        .filter(Boolean)
    : [];

  return {
    report: {
      portfolioOverview: parseSec(parsed.portfolioOverview, "portfolioOverview"),
      allocationAndSectorExposure: parseSec(
        parsed.allocationAndSectorExposure,
        "allocationAndSectorExposure"
      ),
      concentrationRisk: parseSec(parsed.concentrationRisk, "concentrationRisk"),
      pnlAndPerformance: parseSec(parsed.pnlAndPerformance, "pnlAndPerformance"),
      keyRisks,
      missingData: Array.from(new Set([...pkg.missingInformation, ...llmMissing])),
      conclusion: {
        summary:
          conclusionSummary || "Insufficient grounded portfolio evidence.",
        evidenceIds: conclusionIds,
        verificationStatus: "LLM_PORTFOLIO_INTELLIGENCE_UNVERIFIED",
      },
    },
    unsupportedClaims: Array.from(unsupported),
    invalidEvidenceIdsCited: Array.from(invalidCited),
    evidenceIdsUsed: Array.from(used),
    rawResponseInvalid: false,
  };
}

