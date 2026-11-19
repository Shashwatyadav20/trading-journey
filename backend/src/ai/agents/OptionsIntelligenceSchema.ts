import { AITaskTier } from "../core/ModelRouter";
import { sanitizeUntrustedText } from "../evidence/EvidenceSchema";
import { EvidencePackage } from "../services/EvidenceIntelligenceService";

export class OptionsIntelligenceValidationError extends Error {
  public readonly statusCode = 400;
  public readonly code = "OPTIONS_INTELLIGENCE_VALIDATION_ERROR";

  public constructor(message: string) {
    super(message);
    this.name = "OptionsIntelligenceValidationError";
  }
}

export interface OptionsRequestInput {
  symbol: string;
  expiry?: string;
  focus?: string;
  tier: AITaskTier;
}

const VALID_TIERS: ReadonlySet<string> = new Set(["deep", "balanced", "fast"]);
const SYMBOL_PATTERN = /^[A-Z0-9&-]{1,20}$/;

export function validateOptionsRequest(raw: unknown): OptionsRequestInput {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new OptionsIntelligenceValidationError(
      "Request body must be a JSON object with an underlying symbol."
    );
  }
  const body = raw as Record<string, unknown>;
  if (typeof body.symbol !== "string" || body.symbol.trim().length === 0) {
    throw new OptionsIntelligenceValidationError("Underlying symbol is required.");
  }
  const symbol = body.symbol
    .trim()
    .toUpperCase()
    .replace(/^NSE:/i, "")
    .replace(/\.NS$/i, "");
  if (!SYMBOL_PATTERN.test(symbol)) {
    throw new OptionsIntelligenceValidationError(`Invalid symbol "${body.symbol}".`);
  }

  let expiry: string | undefined;
  if (typeof body.expiry === "string" && body.expiry.trim().length > 0) {
    expiry = sanitizeUntrustedText(body.expiry).slice(0, 24);
  }

  let focus: string | undefined;
  if (typeof body.focus === "string" && body.focus.trim().length > 0) {
    focus = sanitizeUntrustedText(body.focus).slice(0, 500);
  }

  const tierRaw =
    typeof body.tier === "string" ? body.tier.trim().toLowerCase() : "balanced";
  if (!VALID_TIERS.has(tierRaw)) {
    throw new OptionsIntelligenceValidationError(
      `Invalid AI tier "${tierRaw}". Allowed: deep, balanced, fast.`
    );
  }

  return { symbol, expiry, focus, tier: tierRaw as AITaskTier };
}

export interface OptionContractRecord {
  strike: number;
  optionType: "CE" | "PE";
  expiry: string;
  ltp: number | null;
  oi: number | null;
  oiChange: number | null;
  volume: number | null;
  iv: number | null;
  delta: number | null;
  gamma: number | null;
  theta: number | null;
  vega: number | null;
  timestamp: string | null;
}

export type OptionDataFreshness = "LIVE" | "DELAYED" | "STALE" | "EXPIRED";

export interface DeterministicOptionAnalytics {
  symbol: string;
  spotPrice: number | null;
  totalContracts: number;
  validActiveContracts: number;
  expiredContractsCount: number;
  dataFreshness: OptionDataFreshness;
  pcrOi: number | null;
  maxPainStrike: number | null;
  pcrMethodology: string;
  maxPainMethodology: string;
  missingGreeksCount: number;
}

export function classifyOptionDataFreshness(
  timestamps: Array<string | null>,
  expiries: string[],
  referenceDate: Date
): { freshness: OptionDataFreshness; expiredContractsCount: number } {
  const refDateStr = referenceDate.toISOString().slice(0, 10);
  const expiredContractsCount = expiries.filter((e) => e < refDateStr).length;

  if (expiries.length > 0 && expiredContractsCount === expiries.length) {
    return { freshness: "EXPIRED", expiredContractsCount };
  }

  const validTimes = timestamps
    .map((t) => (t ? Date.parse(t) : Number.NaN))
    .filter((ms) => !Number.isNaN(ms));

  if (validTimes.length === 0) {
    return { freshness: "EXPIRED", expiredContractsCount };
  }

  const newestMs = Math.max(...validTimes);
  const ageMs = Math.max(0, referenceDate.getTime() - newestMs);

  if (ageMs <= 2 * 60_000) return { freshness: "LIVE", expiredContractsCount };
  if (ageMs <= 15 * 60_000) return { freshness: "DELAYED", expiredContractsCount };
  if (ageMs <= 24 * 3_600_000) return { freshness: "STALE", expiredContractsCount };
  return { freshness: "EXPIRED", expiredContractsCount };
}

export function computeDeterministicOptionAnalytics(
  symbol: string,
  spotPrice: number | null,
  contracts: OptionContractRecord[],
  referenceDate: Date
): DeterministicOptionAnalytics {
  const refDateStr = referenceDate.toISOString().slice(0, 10);
  const { freshness, expiredContractsCount } = classifyOptionDataFreshness(
    contracts.map((c) => c.timestamp),
    contracts.map((c) => c.expiry),
    referenceDate
  );

  const active = contracts.filter((c) => c.expiry >= refDateStr);

  let totalCeOi = 0;
  let totalPeOi = 0;
  let missingGreeksCount = 0;

  for (const c of active) {
    if (
      c.delta === null ||
      c.gamma === null ||
      c.theta === null ||
      c.vega === null ||
      c.iv === null
    ) {
      missingGreeksCount += 1;
    }
    if (typeof c.oi === "number" && Number.isFinite(c.oi) && c.oi > 0) {
      if (c.optionType === "CE") totalCeOi += c.oi;
      else totalPeOi += c.oi;
    }
  }

  const pcrOi =
    totalCeOi > 0 && totalPeOi > 0
      ? Number((totalPeOi / totalCeOi).toFixed(3))
      : null;

  // Max pain calculation only when >= 2 strikes have valid OI
  const strikes = Array.from(new Set(active.map((c) => c.strike))).sort(
    (a, b) => a - b
  );
  let maxPainStrike: number | null = null;
  if (strikes.length >= 2 && totalCeOi + totalPeOi > 0) {
    let minPainValue = Number.POSITIVE_INFINITY;
    for (const candidateStrike of strikes) {
      let pain = 0;
      for (const c of active) {
        if (typeof c.oi !== "number" || c.oi <= 0) continue;
        if (c.optionType === "CE" && candidateStrike > c.strike) {
          pain += (candidateStrike - c.strike) * c.oi;
        } else if (c.optionType === "PE" && candidateStrike < c.strike) {
          pain += (c.strike - candidateStrike) * c.oi;
        }
      }
      if (pain < minPainValue) {
        minPainValue = pain;
        maxPainStrike = candidateStrike;
      }
    }
  }

  return {
    symbol,
    spotPrice,
    totalContracts: contracts.length,
    validActiveContracts: active.length,
    expiredContractsCount,
    dataFreshness: freshness,
    pcrOi,
    maxPainStrike,
    pcrMethodology: "Sum(Put OI) / Sum(Call OI) over non-expired contracts.",
    maxPainMethodology:
      "Strike minimizing total intrinsic option-buyer payoff at expiry across active OI.",
    missingGreeksCount,
  };
}

export function computeOptionPayoffAtExpiry(params: {
  optionType: "CE" | "PE";
  side: "BUY" | "SELL";
  strike: number;
  premium: number;
  quantity: number;
  spotAtExpiry: number;
}): number {
  const intrinsic =
    params.optionType === "CE"
      ? Math.max(0, params.spotAtExpiry - params.strike)
      : Math.max(0, params.strike - params.spotAtExpiry);
  const perUnit =
    params.side === "BUY"
      ? intrinsic - params.premium
      : params.premium - intrinsic;
  return Number((perUnit * params.quantity).toFixed(2));
}

export interface OptionsIntelligenceReportOutput {
  chainOverview: { summary: string; dataFreshness: OptionDataFreshness; evidenceIds: string[] };
  oiAndVolumeAnalysis: { summary: string; evidenceIds: string[] };
  greeksAndVolatility: { summary: string; missingGreeksNoted: boolean; evidenceIds: string[] };
  pcrAndMaxPain: { summary: string; evidenceIds: string[] };
  keyRisks: Array<{ risk: string; evidenceIds: string[]; grounded: boolean }>;
  missingData: string[];
  conclusion: {
    summary: string;
    evidenceIds: string[];
    verificationStatus: "LLM_OPTIONS_INTELLIGENCE_UNVERIFIED";
  };
}

export interface OptionsIntelligenceAgentResponse {
  symbol: string;
  focus: string | null;
  verificationStatus: "LLM_OPTIONS_INTELLIGENCE_UNVERIFIED";
  readOnly: true;
  model: string;
  provider?: string;
  evidenceRecords?: import("../evidence/EvidenceSchema").EvidenceRecord[];
  tier: AITaskTier;
  generatedAt: string;
  analytics: DeterministicOptionAnalytics;
  report: OptionsIntelligenceReportOutput;
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

export function validateAndGroundOptionsOutput(
  rawText: string,
  pkg: EvidencePackage,
  analytics: DeterministicOptionAnalytics
): {
  report: OptionsIntelligenceReportOutput;
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
        chainOverview: {
          summary: "Unavailable.",
          dataFreshness: analytics.dataFreshness,
          evidenceIds: [],
        },
        oiAndVolumeAnalysis: { summary: "Unavailable.", evidenceIds: [] },
        greeksAndVolatility: {
          summary: "Unavailable.",
          missingGreeksNoted: analytics.missingGreeksCount > 0,
          evidenceIds: [],
        },
        pcrAndMaxPain: { summary: "Unavailable.", evidenceIds: [] },
        keyRisks: [],
        missingData: pkg.missingInformation,
        conclusion: {
          summary: "Model output could not be validated against evidence.",
          evidenceIds: [],
          verificationStatus: "LLM_OPTIONS_INTELLIGENCE_UNVERIFIED",
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
      chainOverview: {
        ...parseSec(parsed.chainOverview, "chainOverview"),
        dataFreshness: analytics.dataFreshness,
      },
      oiAndVolumeAnalysis: parseSec(
        parsed.oiAndVolumeAnalysis,
        "oiAndVolumeAnalysis"
      ),
      greeksAndVolatility: {
        ...parseSec(parsed.greeksAndVolatility, "greeksAndVolatility"),
        missingGreeksNoted:
          Boolean(parsed.greeksAndVolatility?.missingGreeksNoted) ||
          analytics.missingGreeksCount > 0,
      },
      pcrAndMaxPain: parseSec(parsed.pcrAndMaxPain, "pcrAndMaxPain"),
      keyRisks,
      missingData: Array.from(new Set([...pkg.missingInformation, ...llmMissing])),
      conclusion: {
        summary: conclusionSummary || "Insufficient grounded option evidence.",
        evidenceIds: conclusionIds,
        verificationStatus: "LLM_OPTIONS_INTELLIGENCE_UNVERIFIED",
      },
    },
    unsupportedClaims: Array.from(unsupported),
    invalidEvidenceIdsCited: Array.from(invalidCited),
    evidenceIdsUsed: Array.from(used),
    rawResponseInvalid: false,
  };
}

