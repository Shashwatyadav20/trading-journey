import { OpenAIClientService, openAIClient } from "../core/OpenAIClient";
import { RawEvidenceInput } from "../evidence/EvidenceSchema";
import {
  EvidenceIntelligenceService,
  EvidencePackage,
  evidenceIntelligenceService,
} from "../services/EvidenceIntelligenceService";
import {
  UserPositionsLoader,
  defaultUserPositionsLoader,
} from "./PortfolioIntelligenceAgent";
import {
  RISK_SYSTEM_INSTRUCTIONS,
  buildRiskPrompt,
} from "./PortfolioIntelligencePrompts";
import {
  RiskIntelligenceAgentResponse,
  computeDeterministicRiskAssessment,
  validateAndGroundRiskOutput,
  validateRiskRequest,
} from "./RiskIntelligenceSchema";

export interface RiskIntelligenceAgentDeps {
  aiClient?: OpenAIClientService;
  evidenceService?: EvidenceIntelligenceService;
  positionsLoader?: UserPositionsLoader;
}

export interface RiskRunOptions {
  referenceDate?: Date;
  extraEvidenceInputs?: RawEvidenceInput[];
  timeoutMs?: number;
  onEvidenceCollected?: (
    pkg: EvidencePackage,
    extraPayload?: Record<string, unknown>
  ) => void;
}

export class RiskIntelligenceAgent {
  private readonly aiClient: OpenAIClientService;
  private readonly evidenceService: EvidenceIntelligenceService;
  private readonly positionsLoader: UserPositionsLoader;

  public constructor(deps: RiskIntelligenceAgentDeps = {}) {
    this.aiClient = deps.aiClient ?? openAIClient;
    this.evidenceService = deps.evidenceService ?? evidenceIntelligenceService;
    this.positionsLoader = deps.positionsLoader ?? defaultUserPositionsLoader;
  }

  public async analyze(
    userId: string,
    rawRequest: unknown,
    options: RiskRunOptions = {}
  ): Promise<RiskIntelligenceAgentResponse> {
    if (!userId || typeof userId !== "string") {
      throw new Error("Authenticated userId is required for risk analysis.");
    }

    const validated = validateRiskRequest(rawRequest);
    const referenceDate = options.referenceDate ?? new Date();
    const targetSymbol = `RISK_${userId.slice(0, 8).toUpperCase()}`;

    // Strictly load positions owned by authenticated userId
    const positions = await this.positionsLoader(userId);
    const risk = computeDeterministicRiskAssessment(
      userId,
      positions,
      validated.shockPct
    );

    const ts = referenceDate.toISOString();
    const evidenceInputs: RawEvidenceInput[] = [
      {
        symbol: targetSymbol,
        category: "DAILY_MARKET_DATA",
        claim: "Portfolio Gross Exposure",
        value: risk.grossExposure,
        unit: "INR",
        currency: "INR",
        source: "INTERNAL_POSITION_STORE",
        sourceUrl: null,
        publishedAt: ts,
      },
      {
        symbol: targetSymbol,
        category: "DAILY_MARKET_DATA",
        claim: "Portfolio Max Defined Loss",
        value: risk.maxDefinedLoss,
        unit: "INR",
        currency: "INR",
        source: "INTERNAL_POSITION_STORE",
        sourceUrl: null,
        publishedAt: ts,
      },
      {
        symbol: targetSymbol,
        category: "DAILY_MARKET_DATA",
        claim: "Portfolio Hedge Coverage %",
        value: risk.hedgeCoveragePct,
        unit: "%",
        currency: null,
        source: "INTERNAL_POSITION_STORE",
        sourceUrl: null,
        publishedAt: ts,
      },
      ...(options.extraEvidenceInputs ?? []),
    ];

    const pkg = this.evidenceService.buildEvidencePackage(
      targetSymbol,
      evidenceInputs,
      { referenceDate }
    );

    options.onEvidenceCollected?.(pkg, {
      deterministicRisk: risk,
    });

    const promptInput = buildRiskPrompt(pkg, risk, validated.focus);

    let aiResult;
    try {
      aiResult = await this.aiClient.createResponse({
        tier: validated.tier,
        instructions: RISK_SYSTEM_INSTRUCTIONS,
        input: promptInput,
        timeoutMs: options.timeoutMs,
        metadata: {
          agent: "RiskIntelligenceAgent",
          userId,
        },
      });
    } catch (err: unknown) {
      if (err && typeof err === "object") {
        (err as Record<string, unknown>).collectedEvidencePackage = pkg;
        (err as Record<string, unknown>).deterministicRisk = risk;
      }
      throw err;
    }

    const grounded = validateAndGroundRiskOutput(aiResult.outputText, pkg);

    return {
      userId,
      focus: validated.focus ?? null,
      verificationStatus: "LLM_RISK_INTELLIGENCE_UNVERIFIED",
      readOnly: true,
      model: aiResult.model,
      provider: aiResult.provider,
      evidenceRecords: pkg.allRecords.map((r) => ({ ...r })),
      tier: validated.tier,
      generatedAt: ts,
      deterministicRisk: risk,
      report: grounded.report,
      unsupportedClaims: grounded.unsupportedClaims,
      invalidEvidenceIdsCited: grounded.invalidEvidenceIdsCited,
      rawResponseInvalid: grounded.rawResponseInvalid,
      evidenceSummary: {
        totalRecords: pkg.allRecords.length,
        verifiedCount: pkg.stats.verifiedCount,
        unverifiedCount: pkg.stats.unverifiedCount,
        staleCount: pkg.stats.staleCount,
        expiredCount: pkg.stats.expiredCount,
        conflictedCount: pkg.stats.conflictedCount,
        conflicts: pkg.conflicts,
        missingInformation: pkg.missingInformation,
        evidenceIdsUsed: grounded.evidenceIdsUsed,
      },
    };
  }
}

export const riskIntelligenceAgent = new RiskIntelligenceAgent();

