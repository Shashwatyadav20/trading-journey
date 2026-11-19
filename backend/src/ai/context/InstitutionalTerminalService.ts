import {
  UserPositionsLoader,
  defaultUserPositionsLoader,
} from "../agents/PortfolioIntelligenceAgent";
import {
  InvalidHoldingIssue,
  computeDeterministicPortfolioMetrics,
} from "../agents/PortfolioIntelligenceSchema";
import {
  ConversationService,
  conversationService,
} from "../conversation/ConversationService";
import { AITaskTier } from "../core/ModelRouter";
import { normalizeEvidenceSymbol } from "../evidence/EvidenceSchema";
import {
  InstitutionalResearchBrief,
  ResearchBriefConclusion,
  ResearchBriefConfidence,
} from "./InstitutionalResearchBriefSchema";
import {
  InstitutionalResearchBriefService,
  institutionalResearchBriefService,
} from "./InstitutionalResearchBriefService";
import {
  InstitutionalResearchIntelligenceService,
  institutionalResearchIntelligenceService,
} from "./InstitutionalResearchIntelligenceService";
import {
  ChangedPillarAssessmentItem,
  LiveResearchValidationService,
  liveResearchValidationService,
} from "./LiveResearchValidationService";
import {
  HistoricalEvidenceChangeItem,
  InstitutionalRiskItem,
  PillarQualitativeAssessment,
} from "./ResearchIntelligenceScorecardSchema";
import {
  UnifiedContextValidationError,
  UnifiedExchange,
  UnifiedIntelligenceContext,
} from "./UnifiedContextSchema";
import {
  UnifiedIntelligenceContextBuilder,
  unifiedIntelligenceContextBuilder,
} from "./UnifiedIntelligenceContextBuilder";

const TERMINAL_ADVISORY_DISCLAIMER =
  "Read-only Institutional Research & Portfolio Intelligence Terminal. Displays server-verified positions and advisory research briefs only — never executes orders, never modifies holdings, and never generates autonomous buy/sell instructions.";

export interface PortfolioHoldingResearchItem {
  positionId: string;
  symbol: string;
  instrument: string;
  side: "BUY" | "SELL";
  quantity: number;
  entryPrice: number;
  currentPrice: number | null;
  exposure: number | null;
  allocationPct: number | null;
  unrealizedPnL: number | null;
  positionStatus: string;
  ownershipContext: string;
  researchStatus: "RESEARCH_AVAILABLE" | "RESEARCH_UNAVAILABLE";
  contextId: string | null;
  lastResearchTimestamp: string | null;
  researchConclusion: ResearchBriefConclusion | "RESEARCH_UNAVAILABLE";
  confidenceClassification: ResearchBriefConfidence | "RESEARCH_UNAVAILABLE";
  fundamentalAssessment: PillarQualitativeAssessment | "RESEARCH_UNAVAILABLE";
  institutionalAssessment: PillarQualitativeAssessment | "RESEARCH_UNAVAILABLE";
  financialRiskAssessment: PillarQualitativeAssessment | "RESEARCH_UNAVAILABLE";
  financialRisks: InstitutionalRiskItem[];
  missingEvidence: string[];
  researchBrief: InstitutionalResearchBrief | null;
}

export interface PortfolioResearchIntelligenceResponse {
  userId: string;
  generatedAt: string;
  readOnly: true;
  totalHoldings: number;
  researchedHoldingsCount: number;
  unavailableHoldingsCount: number;
  totalExposure: number;
  unrealizedPnL: number | null;
  realizedPnL: number;
  maxPositionConcentrationPct: number | null;
  missingPriceInstruments: string[];
  invalidHoldings: InvalidHoldingIssue[];
  holdings: PortfolioHoldingResearchItem[];
  advisoryDisclaimer: string;
}

export interface ResearchHistoryEntry {
  contextId: string;
  symbol: string;
  exchange: UnifiedExchange;
  researchTimestamp: string;
  previousContextId: string | null;
  previousResearchTimestamp: string | null;
  historicalStatus: "COMPARED" | "NO_HISTORICAL_CONTEXT";
  previousConclusion: ResearchBriefConclusion | null;
  currentConclusion: ResearchBriefConclusion;
  confidenceClassification: ResearchBriefConfidence;
  changedPillarAssessments: ChangedPillarAssessmentItem[];
  newFinancialRisks: InstitutionalRiskItem[];
  resolvedConflicts: Array<{ conflictKey: string; claim: string }>;
  newConflicts: Array<{ conflictKey: string; claim: string; reason: string | null }>;
  improvedEvidence: HistoricalEvidenceChangeItem[];
  deterioratedEvidence: HistoricalEvidenceChangeItem[];
  newMissingInformation: string[];
  summary: string;
}

export interface ResearchHistoryResponse {
  userId: string;
  symbolFilter: string | null;
  readOnly: true;
  total: number;
  limit: number;
  offset: number;
  entries: ResearchHistoryEntry[];
  advisoryDisclaimer: string;
}

export interface GetPortfolioResearchOptions {
  refreshMissing?: boolean;
  tier?: AITaskTier;
  referenceDate?: Date;
}

export interface GetResearchHistoryOptions {
  symbol?: string | null;
  limit?: number;
  offset?: number;
}

export class InstitutionalTerminalService {
  private readonly positionsLoader: UserPositionsLoader;
  private readonly conversations: ConversationService;
  private readonly contextBuilder: UnifiedIntelligenceContextBuilder;
  private readonly intelligenceService: InstitutionalResearchIntelligenceService;
  private readonly briefService: InstitutionalResearchBriefService;
  private readonly validationService: LiveResearchValidationService;

  public constructor(deps?: {
    positionsLoader?: UserPositionsLoader;
    conversations?: ConversationService;
    contextBuilder?: UnifiedIntelligenceContextBuilder;
    intelligenceService?: InstitutionalResearchIntelligenceService;
    briefService?: InstitutionalResearchBriefService;
    validationService?: LiveResearchValidationService;
  }) {
    this.positionsLoader = deps?.positionsLoader ?? defaultUserPositionsLoader;
    this.conversations = deps?.conversations ?? conversationService;
    this.contextBuilder =
      deps?.contextBuilder ?? unifiedIntelligenceContextBuilder;
    this.intelligenceService =
      deps?.intelligenceService ?? institutionalResearchIntelligenceService;
    this.briefService =
      deps?.briefService ?? institutionalResearchBriefService;
    this.validationService =
      deps?.validationService ?? liveResearchValidationService;
  }

  /**
   * Section 4: Integrates authenticated server-side portfolio positions with research briefs.
   * Never modifies positions, never trusts client-supplied balances/positions, and marks
   * unresearched holdings as RESEARCH_UNAVAILABLE.
   */
  public async getPortfolioResearchIntelligence(
    userId: string,
    options: GetPortfolioResearchOptions = {}
  ): Promise<PortfolioResearchIntelligenceResponse> {
    if (!userId || typeof userId !== "string" || !userId.trim()) {
      throw new UnifiedContextValidationError("Authenticated userId is required.");
    }
    const cleanUserId = userId.trim();
    const generatedAt = (options.referenceDate ?? new Date()).toISOString();

    // Load positions strictly from server-side position store for this userId
    const positions = await this.positionsLoader(cleanUserId);
    const portfolioMetrics = computeDeterministicPortfolioMetrics(
      cleanUserId,
      positions
    );
    const invalidHoldingIds = new Set(
      portfolioMetrics.invalidHoldings.map((i) => i.positionId)
    );

    // Deduplicate symbol lookups so multiple lots of the same symbol never trigger duplicate research calls
    const contextBySymbol = new Map<string, UnifiedIntelligenceContext | null>();
    const uniqueSymbols = Array.from(
      new Set(
        positions
          .map((p) => normalizeEvidenceSymbol(p.instrument))
          .filter((s): s is string => Boolean(s && s !== "MARKET"))
      )
    );

    // Cap live refreshes at 4 symbols per request to respect free-tier staging limits
    let liveRefreshesUsed = 0;
    const maxLiveRefreshes = 4;

    for (const sym of uniqueSymbols) {
      const prevContexts = await this.conversations.findPreviousUnifiedContexts(
        cleanUserId,
        sym
      );
      if (prevContexts.length > 0) {
        contextBySymbol.set(sym, prevContexts[0]);
      } else if (options.refreshMissing && liveRefreshesUsed < maxLiveRefreshes) {
        liveRefreshesUsed += 1;
        const built = await this.contextBuilder.buildForSymbol(
          cleanUserId,
          {
            symbol: sym,
            tier: options.tier ?? "fast",
          },
          {
            referenceDate: options.referenceDate,
            previousContexts: [],
          }
        );
        await this.conversations.recordUnifiedContext(cleanUserId, built);
        contextBySymbol.set(sym, built);
      } else {
        contextBySymbol.set(sym, null);
      }
    }

    let researchedHoldingsCount = 0;
    let unavailableHoldingsCount = 0;

    const holdings: PortfolioHoldingResearchItem[] = positions.map((pos) => {
      const normSym = normalizeEvidenceSymbol(pos.instrument) || pos.instrument;
      const ctx = contextBySymbol.get(normSym) ?? null;

      const isInvalid = invalidHoldingIds.has(pos.id);
      const isClosed = pos.status === "CLOSED";
      const hasValidPrice =
        !isInvalid &&
        !isClosed &&
        typeof pos.currentPrice === "number" &&
        Number.isFinite(pos.currentPrice) &&
        pos.currentPrice > 0;
      const exposure = hasValidPrice
        ? Number(Math.abs(pos.quantity * pos.currentPrice!).toFixed(2))
        : null;
      const allocationPct =
        exposure !== null && portfolioMetrics.totalExposure > 0
          ? Number(((exposure / portfolioMetrics.totalExposure) * 100).toFixed(2))
          : null;
      const unrealizedPnL = hasValidPrice
        ? Number(
            (
              (pos.currentPrice! - pos.entryPrice) *
              pos.quantity *
              (pos.side === "SELL" ? -1 : 1)
            ).toFixed(2)
          )
        : null;

      const ownershipContext = `${pos.side} ${pos.quantity} qty @ ${pos.entryPrice}${
        pos.currentPrice !== null ? ` (LTP: ${pos.currentPrice})` : ""
      } [${pos.status}]`;

      if (!ctx) {
        unavailableHoldingsCount += 1;
        return {
          positionId: pos.id,
          symbol: normSym,
          instrument: pos.instrument,
          side: pos.side,
          quantity: pos.quantity,
          entryPrice: pos.entryPrice,
          currentPrice: pos.currentPrice,
          exposure,
          allocationPct,
          unrealizedPnL,
          positionStatus: pos.status,
          ownershipContext,
          researchStatus: "RESEARCH_UNAVAILABLE",
          contextId: null,
          lastResearchTimestamp: null,
          researchConclusion: "RESEARCH_UNAVAILABLE",
          confidenceClassification: "RESEARCH_UNAVAILABLE",
          fundamentalAssessment: "RESEARCH_UNAVAILABLE",
          institutionalAssessment: "RESEARCH_UNAVAILABLE",
          financialRiskAssessment: "RESEARCH_UNAVAILABLE",
          financialRisks: [],
          missingEvidence: [
            `No persisted institutional research brief exists yet for ${normSym}.`,
          ],
          researchBrief: null,
        };
      }

      researchedHoldingsCount += 1;
      const scorecard =
        ctx.researchScorecard ??
        this.intelligenceService.buildScorecard(ctx, []);
      const brief =
        ctx.researchBrief ??
        this.briefService.buildBrief({
          ...ctx,
          researchScorecard: scorecard,
        });

      return {
        positionId: pos.id,
        symbol: normSym,
        instrument: pos.instrument,
        side: pos.side,
        quantity: pos.quantity,
        entryPrice: pos.entryPrice,
        currentPrice: pos.currentPrice,
        exposure,
        allocationPct,
        unrealizedPnL,
        positionStatus: pos.status,
        ownershipContext,
        researchStatus: "RESEARCH_AVAILABLE",
        contextId: ctx.contextId,
        lastResearchTimestamp: ctx.createdAt,
        researchConclusion: brief.conclusion,
        confidenceClassification: brief.confidenceClassification,
        fundamentalAssessment: brief.fundamentalAssessment.assessment,
        institutionalAssessment: brief.institutionalAssessment.assessment,
        financialRiskAssessment: brief.financialRiskAssessment.assessment,
        financialRisks: brief.supportedRisks,
        missingEvidence: brief.missingInformation,
        researchBrief: brief,
      };
    });

    return {
      userId: cleanUserId,
      generatedAt,
      readOnly: true,
      totalHoldings: holdings.length,
      researchedHoldingsCount,
      unavailableHoldingsCount,
      totalExposure: portfolioMetrics.totalExposure,
      unrealizedPnL: portfolioMetrics.unrealizedPnL,
      realizedPnL: portfolioMetrics.realizedPnL,
      maxPositionConcentrationPct: portfolioMetrics.maxPositionConcentrationPct,
      missingPriceInstruments: portfolioMetrics.missingPriceInstruments,
      invalidHoldings: portfolioMetrics.invalidHoldings,
      holdings,
      advisoryDisclaimer: TERMINAL_ADVISORY_DISCLAIMER,
    };
  }

  /**
   * Section 5: Retrieves authenticated user's research history with pagination,
   * tracking conclusion transitions, changed pillar assessments, new financial risks,
   * resolved conflicts, and improved/deteriorated evidence.
   */
  public async getResearchHistory(
    userId: string,
    options: GetResearchHistoryOptions = {}
  ): Promise<ResearchHistoryResponse> {
    if (!userId || typeof userId !== "string" || !userId.trim()) {
      throw new UnifiedContextValidationError("Authenticated userId is required.");
    }
    const cleanUserId = userId.trim();
    const limit = Math.max(1, Math.min(options.limit ?? 20, 100));
    const offset = Math.max(0, options.offset ?? 0);
    const symbolFilter =
      options.symbol && options.symbol.trim()
        ? normalizeEvidenceSymbol(options.symbol.trim())
        : null;

    // Fetch all user-owned contexts for accurate chronological pairing per symbol
    const { contexts: allOwnedContexts, total } =
      await this.conversations.listUserUnifiedContexts(cleanUserId, {
        symbol: symbolFilter,
        limit: 1000,
        offset: 0,
      });

    const pageContexts = allOwnedContexts.slice(offset, offset + limit);

    const entries: ResearchHistoryEntry[] = pageContexts.map((ctx) => {
      // Find older contexts for the same user and symbol (strictly older createdAt or appearing after in newest-first list)
      const ctxIndex = allOwnedContexts.findIndex(
        (c) => c.contextId === ctx.contextId
      );
      const olderForSymbol = allOwnedContexts
        .slice(ctxIndex + 1)
        .filter((c) => c.symbol === ctx.symbol && c.userId === cleanUserId);

      const currScorecard =
        ctx.researchScorecard ??
        this.intelligenceService.buildScorecard(ctx, olderForSymbol);
      const currBrief =
        ctx.researchBrief ??
        this.briefService.buildBrief(
          { ...ctx, researchScorecard: currScorecard },
          { previousContexts: olderForSymbol }
        );

      const histSummary = this.validationService.buildHistoricalResearchSummary(
        {
          ...ctx,
          researchScorecard: currScorecard,
          researchBrief: currBrief,
        },
        olderForSymbol
      );

      let newFinancialRisks: InstitutionalRiskItem[] = [];
      if (olderForSymbol.length > 0) {
        const prevCtx = olderForSymbol[0];
        const prevScorecard =
          prevCtx.researchScorecard ??
          this.intelligenceService.buildScorecard(prevCtx, []);
        const prevRiskCategories = new Set(
          prevScorecard.supportedRisks.map((r) => `${r.category}:${r.severity}`)
        );
        newFinancialRisks = currScorecard.supportedRisks.filter(
          (r) => !prevRiskCategories.has(`${r.category}:${r.severity}`)
        );
      }

      return {
        contextId: ctx.contextId,
        symbol: ctx.symbol,
        exchange: ctx.exchange,
        researchTimestamp: ctx.createdAt,
        previousContextId: histSummary.previousContextId,
        previousResearchTimestamp: histSummary.previousTimestamp,
        historicalStatus: histSummary.status,
        previousConclusion: histSummary.previousConclusion,
        currentConclusion: histSummary.currentConclusion,
        confidenceClassification: currBrief.confidenceClassification,
        changedPillarAssessments: histSummary.changedPillarAssessments,
        newFinancialRisks,
        resolvedConflicts: histSummary.resolvedConflicts,
        newConflicts: histSummary.newConflicts,
        improvedEvidence: histSummary.improvedEvidence,
        deterioratedEvidence: histSummary.deterioratedEvidence,
        newMissingInformation: histSummary.newMissingInformation,
        summary: histSummary.summary,
      };
    });

    return {
      userId: cleanUserId,
      symbolFilter,
      readOnly: true,
      total,
      limit,
      offset,
      entries,
      advisoryDisclaimer: TERMINAL_ADVISORY_DISCLAIMER,
    };
  }
}

export const institutionalTerminalService =
  new InstitutionalTerminalService();

