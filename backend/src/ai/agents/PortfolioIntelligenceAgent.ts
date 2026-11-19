import { priceStore } from "../../market/MarketPriceStore";
import { positionStore } from "../../trading/PositionStore";
import { OpenAIClientService, openAIClient } from "../core/OpenAIClient";
import { RawEvidenceInput } from "../evidence/EvidenceSchema";
import {
  EvidenceIntelligenceService,
  EvidencePackage,
  evidenceIntelligenceService,
} from "../services/EvidenceIntelligenceService";
import {
  PORTFOLIO_SYSTEM_INSTRUCTIONS,
  buildPortfolioPrompt,
} from "./PortfolioIntelligencePrompts";
import {
  PortfolioIntelligenceAgentResponse,
  PortfolioPositionRecord,
  computeDeterministicPortfolioMetrics,
  validateAndGroundPortfolioOutput,
  validatePortfolioRequest,
} from "./PortfolioIntelligenceSchema";

export type UserPositionsLoader = (
  userId: string
) => Promise<PortfolioPositionRecord[]>;

export interface PortfolioIntelligenceAgentDeps {
  aiClient?: OpenAIClientService;
  evidenceService?: EvidenceIntelligenceService;
  positionsLoader?: UserPositionsLoader;
}

export interface PortfolioRunOptions {
  referenceDate?: Date;
  extraEvidenceInputs?: RawEvidenceInput[];
  timeoutMs?: number;
  onEvidenceCollected?: (
    pkg: EvidencePackage,
    extraPayload?: Record<string, unknown>
  ) => void;
}

export async function defaultUserPositionsLoader(
  userId: string
): Promise<PortfolioPositionRecord[]> {
  // Strict user isolation: only retrieve positions owned by authenticated userId
  const rawPositions = positionStore.getByUser(userId);
  return rawPositions.map((p) => {
    const livePrice = priceStore.getPrice(p.instrument)?.price ?? null;
    const normalizedSide: "BUY" | "SELL" =
      String(p.side).toUpperCase() === "SHORT" ||
      String(p.side).toUpperCase() === "SELL"
        ? "SELL"
        : "BUY";
    return {
      id: p.id,
      userId: p.userId,
      instrument: p.instrument,
      sector: null,
      side: normalizedSide,
      quantity: p.quantity,
      entryPrice: p.entryPrice,
      currentPrice: livePrice,
      realizedPnL: p.realizedPnl ?? null,
      stopLoss: p.stopLoss ?? null,
      status: p.status,
      updatedAt: p.updatedAt,
    };
  });
}

export class PortfolioIntelligenceAgent {
  private readonly aiClient: OpenAIClientService;
  private readonly evidenceService: EvidenceIntelligenceService;
  private readonly positionsLoader: UserPositionsLoader;

  public constructor(deps: PortfolioIntelligenceAgentDeps = {}) {
    this.aiClient = deps.aiClient ?? openAIClient;
    this.evidenceService = deps.evidenceService ?? evidenceIntelligenceService;
    this.positionsLoader = deps.positionsLoader ?? defaultUserPositionsLoader;
  }

  public async analyze(
    userId: string,
    rawRequest: unknown,
    options: PortfolioRunOptions = {}
  ): Promise<PortfolioIntelligenceAgentResponse> {
    if (!userId || typeof userId !== "string") {
      throw new Error("Authenticated userId is required for portfolio analysis.");
    }

    const validated = validatePortfolioRequest(rawRequest);
    const referenceDate = options.referenceDate ?? new Date();
    const targetSymbol = `PORTFOLIO_${userId.slice(0, 8).toUpperCase()}`;

    // Independently retrieve authorized positions belonging ONLY to userId
    const loadedPositions = await this.positionsLoader(userId);
    const metrics = computeDeterministicPortfolioMetrics(userId, loadedPositions);

    const ts = referenceDate.toISOString();
    const evidenceInputs: RawEvidenceInput[] = [
      {
        symbol: targetSymbol,
        category: "DAILY_MARKET_DATA",
        claim: "Portfolio Total Exposure",
        value: metrics.totalExposure,
        unit: "INR",
        currency: "INR",
        source: "INTERNAL_POSITION_STORE",
        sourceUrl: null,
        publishedAt: ts,
      },
      {
        symbol: targetSymbol,
        category: "DAILY_MARKET_DATA",
        claim: "Portfolio Unrealized PnL",
        value: metrics.unrealizedPnL,
        unit: "INR",
        currency: "INR",
        source: "INTERNAL_POSITION_STORE",
        sourceUrl: null,
        publishedAt: ts,
      },
      {
        symbol: targetSymbol,
        category: "DAILY_MARKET_DATA",
        claim: "Portfolio Realized PnL",
        value: metrics.realizedPnL,
        unit: "INR",
        currency: "INR",
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
      deterministicMetrics: metrics,
    });

    const promptInput = buildPortfolioPrompt(pkg, metrics, validated.focus);

    let aiResult;
    try {
      aiResult = await this.aiClient.createResponse({
        tier: validated.tier,
        instructions: PORTFOLIO_SYSTEM_INSTRUCTIONS,
        input: promptInput,
        timeoutMs: options.timeoutMs,
        metadata: {
          agent: "PortfolioIntelligenceAgent",
          userId,
        },
      });
    } catch (err: unknown) {
      if (err && typeof err === "object") {
        (err as Record<string, unknown>).collectedEvidencePackage = pkg;
        (err as Record<string, unknown>).deterministicMetrics = metrics;
      }
      throw err;
    }

    const grounded = validateAndGroundPortfolioOutput(aiResult.outputText, pkg);

    return {
      userId,
      focus: validated.focus ?? null,
      verificationStatus: "LLM_PORTFOLIO_INTELLIGENCE_UNVERIFIED",
      readOnly: true,
      model: aiResult.model,
      provider: aiResult.provider,
      evidenceRecords: pkg.allRecords.map((r) => ({ ...r })),
      tier: validated.tier,
      generatedAt: ts,
      deterministicMetrics: metrics,
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

export const portfolioIntelligenceAgent = new PortfolioIntelligenceAgent();
