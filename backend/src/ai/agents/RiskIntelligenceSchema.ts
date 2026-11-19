import { AITaskTier } from "../core/ModelRouter";
import { sanitizeUntrustedText } from "../evidence/EvidenceSchema";
import { EvidencePackage } from "../services/EvidenceIntelligenceService";
import {
  PortfolioPositionRecord,
  computeDeterministicPortfolioMetrics,
} from "./PortfolioIntelligenceSchema";

export class RiskIntelligenceValidationError extends Error {
  public readonly statusCode = 400;
  public readonly code = "RISK_INTELLIGENCE_VALIDATION_ERROR";

  public constructor(message: string) {
    super(message);
    this.name = "RiskIntelligenceValidationError";
  }
}

export interface RiskRequestInput {
  focus?: string;
  shockPct: number;
  tier: AITaskTier;
}

const VALID_TIERS: ReadonlySet<string> = new Set(["deep", "balanced", "fast"]);

export function validateRiskRequest(raw: unknown): RiskRequestInput {
  if (
    raw !== undefined &&
    raw !== null &&
    (typeof raw !== "object" || Array.isArray(raw))
  ) {
    throw new RiskIntelligenceValidationError(
      "Request body must be a JSON object."
    );
  }
  const body = (raw as Record<string, unknown>) || {};

  let focus: string | undefined;
  if (typeof body.focus === "string" && body.focus.trim().length > 0) {
    focus = sanitizeUntrustedText(body.focus).slice(0, 500);
  }

  let shockPct = 5;
  if (body.shockPct !== undefined && body.shockPct !== null) {
    if (
      typeof body.shockPct !== "number" ||
      !Number.isFinite(body.shockPct) ||
      body.shockPct <= 0 ||
      body.shockPct > 50
    ) {
      throw new RiskIntelligenceValidationError(
        "shockPct must be a finite number between 0 and 50."
      );
    }
    shockPct = body.shockPct;
  }

  const tierRaw =
    typeof body.tier === "string" ? body.tier.trim().toLowerCase() : "deep";
  if (!VALID_TIERS.has(tierRaw)) {
    throw new RiskIntelligenceValidationError(
      `Invalid AI tier "${tierRaw}". Allowed: deep, balanced, fast.`
    );
  }

  return { focus, shockPct, tier: tierRaw as AITaskTier };
}

export interface TheoreticalScenarioResult {
  scenarioName:
    | "BULLISH"
    | "BEARISH"
    | "SIDEWAYS"
    | "VOLATILITY_EXPANSION"
    | "VOLATILITY_CONTRACTION"
    | "GAP_UP"
    | "GAP_DOWN";
  isTheoreticalScenario: true;
  spotShockPct: number;
  ivShockPct: number;
  estimatedPortfolioPnlImpact: number | null;
  note: string;
}

export interface DeterministicRiskAssessment {
  userId: string;
  grossExposure: number;
  netDirectionalExposure: number;
  maxPositionConcentrationPct: number | null;
  maxDefinedLoss: number | null;
  hasUncappedOrUndefinedStopLoss: boolean;
  hedgeCoveragePct: number | null;
  scenarios: TheoreticalScenarioResult[];
}

export function computeDeterministicRiskAssessment(
  userId: string,
  allPositions: PortfolioPositionRecord[],
  shockPct: number = 5
): DeterministicRiskAssessment {
  const portfolio = computeDeterministicPortfolioMetrics(userId, allPositions);
  const userOpen = allPositions.filter(
    (p) =>
      p.userId === userId &&
      p.status !== "CLOSED" &&
      typeof p.quantity === "number" &&
      Number.isFinite(p.quantity) &&
      p.quantity > 0 &&
      typeof p.currentPrice === "number" &&
      Number.isFinite(p.currentPrice) &&
      p.currentPrice > 0
  );

  let longExposure = 0;
  let shortExposure = 0;
  let definedLossSum = 0;
  let hasUndefinedStop = false;

  for (const pos of userOpen) {
    const price = pos.currentPrice!;
    const notional = pos.quantity * price;
    if (pos.side === "BUY") {
      longExposure += notional;
    } else {
      shortExposure += notional;
    }

    if (
      typeof pos.stopLoss === "number" &&
      Number.isFinite(pos.stopLoss) &&
      pos.stopLoss > 0
    ) {
      const stopDist =
        pos.side === "BUY"
          ? Math.max(0, pos.entryPrice - pos.stopLoss)
          : Math.max(0, pos.stopLoss - pos.entryPrice);
      definedLossSum += stopDist * pos.quantity;
    } else {
      hasUndefinedStop = true;
    }
  }

  const grossExposure = Number((longExposure + shortExposure).toFixed(2));
  const netDirectionalExposure = Number((longExposure - shortExposure).toFixed(2));
  const hedgeCoveragePct =
    longExposure > 0 && shortExposure > 0
      ? Number(
          (
            (Math.min(longExposure, shortExposure) /
              Math.max(longExposure, shortExposure)) *
            100
          ).toFixed(2)
        )
      : userOpen.length > 0
        ? 0
        : null;

  const calcShock = (pct: number): number | null =>
    userOpen.length === 0
      ? null
      : Number((netDirectionalExposure * (pct / 100)).toFixed(2));

  const scenarios: TheoreticalScenarioResult[] = [
    {
      scenarioName: "BULLISH",
      isTheoreticalScenario: true,
      spotShockPct: shockPct,
      ivShockPct: 0,
      estimatedPortfolioPnlImpact: calcShock(shockPct),
      note: `Theoretical +${shockPct}% directional move on net exposure.`,
    },
    {
      scenarioName: "BEARISH",
      isTheoreticalScenario: true,
      spotShockPct: -shockPct,
      ivShockPct: 0,
      estimatedPortfolioPnlImpact: calcShock(-shockPct),
      note: `Theoretical -${shockPct}% directional move on net exposure.`,
    },
    {
      scenarioName: "SIDEWAYS",
      isTheoreticalScenario: true,
      spotShockPct: 0,
      ivShockPct: 0,
      estimatedPortfolioPnlImpact: userOpen.length === 0 ? null : 0,
      note: "Theoretical 0% spot move.",
    },
    {
      scenarioName: "VOLATILITY_EXPANSION",
      isTheoreticalScenario: true,
      spotShockPct: 0,
      ivShockPct: 25,
      estimatedPortfolioPnlImpact: null,
      note: "Theoretical +25% IV expansion (requires option vega for exact impact).",
    },
    {
      scenarioName: "VOLATILITY_CONTRACTION",
      isTheoreticalScenario: true,
      spotShockPct: 0,
      ivShockPct: -25,
      estimatedPortfolioPnlImpact: null,
      note: "Theoretical -25% IV contraction (requires option vega for exact impact).",
    },
    {
      scenarioName: "GAP_UP",
      isTheoreticalScenario: true,
      spotShockPct: shockPct * 2,
      ivShockPct: 0,
      estimatedPortfolioPnlImpact: calcShock(shockPct * 2),
      note: `Theoretical +${shockPct * 2}% gap-up stress test.`,
    },
    {
      scenarioName: "GAP_DOWN",
      isTheoreticalScenario: true,
      spotShockPct: -shockPct * 2,
      ivShockPct: 0,
      estimatedPortfolioPnlImpact: calcShock(-shockPct * 2),
      note: `Theoretical -${shockPct * 2}% gap-down stress test.`,
    },
  ];

  return {
    userId,
    grossExposure,
    netDirectionalExposure,
    maxPositionConcentrationPct: portfolio.maxPositionConcentrationPct,
    maxDefinedLoss:
      userOpen.length > 0 ? Number(definedLossSum.toFixed(2)) : null,
    hasUncappedOrUndefinedStopLoss: hasUndefinedStop,
    hedgeCoveragePct,
    scenarios,
  };
}

export interface RiskIntelligenceReportOutput {
  exposureAndConcentration: { summary: string; evidenceIds: string[] };
  drawdownAndMaxLoss: { summary: string; evidenceIds: string[] };
  hedgeCoverage: { summary: string; evidenceIds: string[] };
  scenarioAnalysis: { summary: string; evidenceIds: string[] };
  keyRisks: Array<{ risk: string; evidenceIds: string[]; grounded: boolean }>;
  missingData: string[];
  conclusion: {
    summary: string;
    evidenceIds: string[];
    verificationStatus: "LLM_RISK_INTELLIGENCE_UNVERIFIED";
  };
}

export interface RiskIntelligenceAgentResponse {
  userId: string;
  focus: string | null;
  verificationStatus: "LLM_RISK_INTELLIGENCE_UNVERIFIED";
  readOnly: true;
  model: string;
  provider?: string;
  evidenceRecords?: import("../evidence/EvidenceSchema").EvidenceRecord[];
  tier: AITaskTier;
  generatedAt: string;
  deterministicRisk: DeterministicRiskAssessment;
  report: RiskIntelligenceReportOutput;
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

export function validateAndGroundRiskOutput(
  rawText: string,
  pkg: EvidencePackage
): {
  report: RiskIntelligenceReportOutput;
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
        exposureAndConcentration: { summary: "Unavailable.", evidenceIds: [] },
        drawdownAndMaxLoss: { summary: "Unavailable.", evidenceIds: [] },
        hedgeCoverage: { summary: "Unavailable.", evidenceIds: [] },
        scenarioAnalysis: { summary: "Unavailable.", evidenceIds: [] },
        keyRisks: [],
        missingData: pkg.missingInformation,
        conclusion: {
          summary: "Model output could not be validated against evidence.",
          evidenceIds: [],
          verificationStatus: "LLM_RISK_INTELLIGENCE_UNVERIFIED",
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
      exposureAndConcentration: parseSec(
        parsed.exposureAndConcentration,
        "exposureAndConcentration"
      ),
      drawdownAndMaxLoss: parseSec(
        parsed.drawdownAndMaxLoss,
        "drawdownAndMaxLoss"
      ),
      hedgeCoverage: parseSec(parsed.hedgeCoverage, "hedgeCoverage"),
      scenarioAnalysis: parseSec(parsed.scenarioAnalysis, "scenarioAnalysis"),
      keyRisks,
      missingData: Array.from(new Set([...pkg.missingInformation, ...llmMissing])),
      conclusion: {
        summary: conclusionSummary || "Insufficient grounded risk evidence.",
        evidenceIds: conclusionIds,
        verificationStatus: "LLM_RISK_INTELLIGENCE_UNVERIFIED",
      },
    },
    unsupportedClaims: Array.from(unsupported),
    invalidEvidenceIdsCited: Array.from(invalidCited),
    evidenceIdsUsed: Array.from(used),
    rawResponseInvalid: false,
  };
}

