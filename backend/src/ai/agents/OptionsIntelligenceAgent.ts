import { priceStore } from "../../market/MarketPriceStore";
import { OpenAIClientService, openAIClient } from "../core/OpenAIClient";
import { RawEvidenceInput } from "../evidence/EvidenceSchema";
import {
  EvidenceIntelligenceService,
  EvidencePackage,
  evidenceIntelligenceService,
} from "../services/EvidenceIntelligenceService";
import {
  OPTIONS_SYSTEM_INSTRUCTIONS,
  buildOptionsPrompt,
} from "./PortfolioIntelligencePrompts";
import {
  OptionContractRecord,
  OptionsIntelligenceAgentResponse,
  computeDeterministicOptionAnalytics,
  validateAndGroundOptionsOutput,
  validateOptionsRequest,
} from "./OptionsIntelligenceSchema";

export type OptionChainLoader = (params: {
  symbol: string;
  expiry?: string;
  referenceDate: Date;
}) => Promise<{
  spotPrice: number | null;
  contracts: OptionContractRecord[];
  sourceUrl: string | null;
}>;

export interface OptionsIntelligenceAgentDeps {
  aiClient?: OpenAIClientService;
  evidenceService?: EvidenceIntelligenceService;
  optionChainLoader?: OptionChainLoader;
}

export interface OptionsRunOptions {
  referenceDate?: Date;
  extraEvidenceInputs?: RawEvidenceInput[];
  timeoutMs?: number;
  onEvidenceCollected?: (
    pkg: EvidencePackage,
    extraPayload?: Record<string, unknown>
  ) => void;
}

export async function defaultOptionChainLoader(params: {
  symbol: string;
}): Promise<{
  spotPrice: number | null;
  contracts: OptionContractRecord[];
  sourceUrl: string | null;
}> {
  const spot = priceStore.getPrice(params.symbol)?.price ?? null;
  return {
    spotPrice: spot,
    contracts: [],
    sourceUrl: null,
  };
}

export class OptionsIntelligenceAgent {
  private readonly aiClient: OpenAIClientService;
  private readonly evidenceService: EvidenceIntelligenceService;
  private readonly optionChainLoader: OptionChainLoader;

  public constructor(deps: OptionsIntelligenceAgentDeps = {}) {
    this.aiClient = deps.aiClient ?? openAIClient;
    this.evidenceService = deps.evidenceService ?? evidenceIntelligenceService;
    this.optionChainLoader =
      deps.optionChainLoader ?? defaultOptionChainLoader;
  }

  public async analyze(
    userId: string,
    rawRequest: unknown,
    options: OptionsRunOptions = {}
  ): Promise<OptionsIntelligenceAgentResponse> {
    if (!userId || typeof userId !== "string") {
      throw new Error("Authenticated userId is required for options analysis.");
    }

    const validated = validateOptionsRequest(rawRequest);
    const referenceDate = options.referenceDate ?? new Date();

    const loaded = await this.optionChainLoader({
      symbol: validated.symbol,
      expiry: validated.expiry,
      referenceDate,
    });

    const analytics = computeDeterministicOptionAnalytics(
      validated.symbol,
      loaded.spotPrice,
      loaded.contracts,
      referenceDate
    );

    const newestTs =
      loaded.contracts
        .map((c) => c.timestamp)
        .filter((t): t is string => Boolean(t))
        .sort()
        .pop() ?? null;

    const evidenceInputs: RawEvidenceInput[] = [
      {
        symbol: validated.symbol,
        category: "INTRADAY_PRICE",
        claim: "Underlying Spot Price",
        value: analytics.spotPrice,
        unit: "INR",
        currency: "INR",
        source: loaded.sourceUrl ? "NSE_OFFICIAL" : "INTERNAL_PRICE_STORE",
        sourceUrl: loaded.sourceUrl,
        publishedAt: newestTs ?? referenceDate.toISOString(),
      },
      {
        symbol: validated.symbol,
        category: "INTRADAY_PRICE",
        claim: "Option Chain PCR (OI)",
        value: analytics.pcrOi,
        unit: "RATIO",
        currency: null,
        source: loaded.sourceUrl ? "NSE_OFFICIAL" : "INTERNAL_OPTION_ANALYTICS",
        sourceUrl: loaded.sourceUrl,
        publishedAt: newestTs,
      },
      {
        symbol: validated.symbol,
        category: "INTRADAY_PRICE",
        claim: "Option Chain Max Pain Strike",
        value: analytics.maxPainStrike,
        unit: "INR",
        currency: "INR",
        source: loaded.sourceUrl ? "NSE_OFFICIAL" : "INTERNAL_OPTION_ANALYTICS",
        sourceUrl: loaded.sourceUrl,
        publishedAt: newestTs,
      },
      ...(options.extraEvidenceInputs ?? []),
    ];

    const pkg = this.evidenceService.buildEvidencePackage(
      validated.symbol,
      evidenceInputs,
      { referenceDate }
    );

    options.onEvidenceCollected?.(pkg, {
      analytics,
    });

    const promptInput = buildOptionsPrompt(pkg, analytics, validated.focus);

    let aiResult;
    try {
      aiResult = await this.aiClient.createResponse({
        tier: validated.tier,
        instructions: OPTIONS_SYSTEM_INSTRUCTIONS,
        input: promptInput,
        timeoutMs: options.timeoutMs,
        metadata: {
          agent: "OptionsIntelligenceAgent",
          symbol: validated.symbol,
          userId,
        },
      });
    } catch (err: unknown) {
      if (err && typeof err === "object") {
        (err as Record<string, unknown>).collectedEvidencePackage = pkg;
        (err as Record<string, unknown>).analytics = analytics;
      }
      throw err;
    }

    const grounded = validateAndGroundOptionsOutput(
      aiResult.outputText,
      pkg,
      analytics
    );

    return {
      symbol: validated.symbol,
      focus: validated.focus ?? null,
      verificationStatus: "LLM_OPTIONS_INTELLIGENCE_UNVERIFIED",
      readOnly: true,
      model: aiResult.model,
      provider: aiResult.provider,
      evidenceRecords: pkg.allRecords.map((r) => ({ ...r })),
      tier: validated.tier,
      generatedAt: referenceDate.toISOString(),
      analytics,
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

export const optionsIntelligenceAgent = new OptionsIntelligenceAgent();

