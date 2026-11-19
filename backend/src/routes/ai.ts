import { FastifyPluginAsync } from "fastify";
import { authenticateRequest, getVerifiedUser } from "../auth/middleware";
import { AuthenticationError, AuthorizationError } from "../trading/userContext";
import { AIConfigError, AITaskTier } from "../ai/core/ModelRouter";
import { AIProviderError, openAIClient, OpenAIClientService } from "../ai/core/OpenAIClient";
import {
  CompanyResearchAgent,
  companyResearchAgent,
} from "../ai/agents/CompanyResearchAgent";
import { CompanyResearchValidationError } from "../ai/agents/CompanyResearchSchema";
import {
  MarketIntelligenceAgent,
  marketIntelligenceAgent,
} from "../ai/agents/MarketIntelligenceAgent";
import { MarketIntelligenceValidationError } from "../ai/agents/MarketIntelligenceSchema";
import {
  InstitutionalIntelligenceAgent,
  institutionalIntelligenceAgent,
} from "../ai/agents/InstitutionalIntelligenceAgent";
import { InstitutionalIntelligenceValidationError } from "../ai/agents/InstitutionalIntelligenceSchema";
import {
  NewsMacroIntelligenceAgent,
  newsMacroIntelligenceAgent,
} from "../ai/agents/NewsMacroIntelligenceAgent";
import { NewsMacroValidationError } from "../ai/agents/NewsMacroIntelligenceSchema";
import {
  PortfolioIntelligenceAgent,
  portfolioIntelligenceAgent,
} from "../ai/agents/PortfolioIntelligenceAgent";
import { PortfolioIntelligenceValidationError } from "../ai/agents/PortfolioIntelligenceSchema";
import {
  OptionsIntelligenceAgent,
  optionsIntelligenceAgent,
} from "../ai/agents/OptionsIntelligenceAgent";
import { OptionsIntelligenceValidationError } from "../ai/agents/OptionsIntelligenceSchema";
import {
  marketUniverseService,
  type MarketCapCategory,
} from "../ai/discovery/MarketUniverseService";
import {
  amfiClassificationService,
  parseAmfiCsvDetailed,
} from "../ai/discovery/AmfiClassificationService";
import { autoPeerComparisonService } from "../ai/discovery/AutoPeerComparisonService";
import {
  top5DiscoveryEngine,
  type DiscoveryRiskProfile,
  type MinDataQualityFilter,
} from "../ai/discovery/Top5DiscoveryEngine";
import {
  RiskIntelligenceAgent,
  riskIntelligenceAgent,
} from "../ai/agents/RiskIntelligenceAgent";
import { RiskIntelligenceValidationError } from "../ai/agents/RiskIntelligenceSchema";
import {
  AIOrchestrator,
  OrchestratorValidationError,
  aiOrchestrator,
} from "../ai/orchestrator/AIOrchestrator";
import { extractNseSymbolFromQuery } from "../ai/orchestrator/IntentRouter";
import {
  ConversationForbiddenError,
  ConversationNotFoundError,
  ConversationValidationError,
  validatePagination,
} from "../ai/conversation/ConversationSchema";
import {
  ConversationService,
  conversationService,
} from "../ai/conversation/ConversationService";
import { AIUsageTracker, aiUsageTracker } from "../ai/core/AIUsageTracker";
import { UnifiedContextValidationError } from "../ai/context/UnifiedContextSchema";
import {
  UnifiedIntelligenceContextBuilder,
  unifiedIntelligenceContextBuilder,
} from "../ai/context/UnifiedIntelligenceContextBuilder";
import {
  LiveResearchValidationService,
  liveResearchValidationService,
} from "../ai/context/LiveResearchValidationService";
import {
  InstitutionalTerminalService,
  institutionalTerminalService,
} from "../ai/context/InstitutionalTerminalService";
import { UserPositionsLoader } from "../ai/agents/PortfolioIntelligenceAgent";

export interface AIRoutesOptions {
  aiClient?: OpenAIClientService;
  companyResearchAgent?: CompanyResearchAgent;
  marketIntelligenceAgent?: MarketIntelligenceAgent;
  institutionalIntelligenceAgent?: InstitutionalIntelligenceAgent;
  newsMacroIntelligenceAgent?: NewsMacroIntelligenceAgent;
  portfolioIntelligenceAgent?: PortfolioIntelligenceAgent;
  optionsIntelligenceAgent?: OptionsIntelligenceAgent;
  riskIntelligenceAgent?: RiskIntelligenceAgent;
  aiOrchestrator?: AIOrchestrator;
  conversationService?: ConversationService;
  usageTracker?: AIUsageTracker;
  contextBuilder?: UnifiedIntelligenceContextBuilder;
  liveValidationService?: LiveResearchValidationService;
  terminalService?: InstitutionalTerminalService;
  positionsLoader?: UserPositionsLoader;
  rateLimitMaxRequests?: number;
  rateLimitWindowMs?: number;
}

const VALID_TIERS: ReadonlySet<string> = new Set(["deep", "balanced", "fast"]);

const aiRoutes: FastifyPluginAsync<AIRoutesOptions> = async (fastify, opts) => {
  const client = opts?.aiClient ?? openAIClient;
  const usageTracker = opts?.usageTracker ?? aiUsageTracker;
  const researchAgent =
    opts?.companyResearchAgent ??
    (opts?.aiClient
      ? new CompanyResearchAgent({ aiClient: opts.aiClient })
      : companyResearchAgent);
  const marketAgent =
    opts?.marketIntelligenceAgent ??
    (opts?.aiClient
      ? new MarketIntelligenceAgent({ aiClient: opts.aiClient })
      : marketIntelligenceAgent);
  const institutionalAgent =
    opts?.institutionalIntelligenceAgent ??
    (opts?.aiClient
      ? new InstitutionalIntelligenceAgent({ aiClient: opts.aiClient })
      : institutionalIntelligenceAgent);
  const newsMacroAgent =
    opts?.newsMacroIntelligenceAgent ??
    (opts?.aiClient
      ? new NewsMacroIntelligenceAgent({ aiClient: opts.aiClient })
      : newsMacroIntelligenceAgent);
  const portfolioAgent =
    opts?.portfolioIntelligenceAgent ??
    (opts?.aiClient
      ? new PortfolioIntelligenceAgent({ aiClient: opts.aiClient })
      : portfolioIntelligenceAgent);
  const optionsAgent =
    opts?.optionsIntelligenceAgent ??
    (opts?.aiClient
      ? new OptionsIntelligenceAgent({ aiClient: opts.aiClient })
      : optionsIntelligenceAgent);
  const riskAgent =
    opts?.riskIntelligenceAgent ??
    (opts?.aiClient
      ? new RiskIntelligenceAgent({ aiClient: opts.aiClient })
      : riskIntelligenceAgent);
  const orchestrator = opts?.aiOrchestrator ?? aiOrchestrator;
  const conversations = opts?.conversationService ?? conversationService;
  const contextBuilder = opts?.contextBuilder ?? unifiedIntelligenceContextBuilder;

  const rateLimitMax = opts?.rateLimitMaxRequests ?? 30;
  const rateLimitWindowMs = opts?.rateLimitWindowMs ?? 60_000;
  const userRequestTimestamps = new Map<string, number[]>();

  function checkUserRateLimit(userId: string): boolean {
    const now = Date.now();
    const prev = userRequestTimestamps.get(userId) ?? [];
    const recent = prev.filter((ts) => now - ts < rateLimitWindowMs);
    if (recent.length >= rateLimitMax) {
      userRequestTimestamps.set(userId, recent);
      return false;
    }
    recent.push(now);
    userRequestTimestamps.set(userId, recent);
    return true;
  }

  fastify.setErrorHandler((error, request, reply) => {
    if (
      error instanceof ConversationValidationError ||
      error instanceof OrchestratorValidationError ||
      error instanceof UnifiedContextValidationError
    ) {
      reply.status(error.statusCode).send({
        error: error.message,
        code: error.code,
      });
      return;
    }
    if (
      error instanceof ConversationNotFoundError ||
      error instanceof ConversationForbiddenError
    ) {
      reply.status(error.statusCode).send({
        error: error.message,
        code: error.code,
      });
      return;
    }
    if (error instanceof CompanyResearchValidationError) {
      reply.status(error.statusCode).send({
        error: error.message,
        code: error.code,
      });
      return;
    }
    if (error instanceof MarketIntelligenceValidationError) {
      reply.status(error.statusCode).send({
        error: error.message,
        code: error.code,
      });
      return;
    }
    if (error instanceof InstitutionalIntelligenceValidationError) {
      reply.status(error.statusCode).send({
        error: error.message,
        code: error.code,
      });
      return;
    }
    if (error instanceof NewsMacroValidationError) {
      reply.status(error.statusCode).send({
        error: error.message,
        code: error.code,
      });
      return;
    }
    if (error instanceof PortfolioIntelligenceValidationError) {
      reply.status(error.statusCode).send({
        error: error.message,
        code: error.code,
      });
      return;
    }
    if (error instanceof OptionsIntelligenceValidationError) {
      reply.status(error.statusCode).send({
        error: error.message,
        code: error.code,
      });
      return;
    }
    if (error instanceof RiskIntelligenceValidationError) {
      reply.status(error.statusCode).send({
        error: error.message,
        code: error.code,
      });
      return;
    }
    if (error instanceof AuthenticationError) {
      reply.status(401).send({ error: error.message });
      return;
    }
    if (error instanceof AuthorizationError) {
      reply.status(403).send({ error: error.message });
      return;
    }
    if (error instanceof AIConfigError) {
      reply.status(error.statusCode).send({
        error: error.message,
        code: error.code,
      });
      return;
    }
    if (error instanceof AIProviderError) {
      reply.status(error.statusCode).send({
        error: error.message,
        code: error.code,
        retryable: error.retryable,
        tier: error.tier,
        model: error.model,
      });
      return;
    }

    request.log.error(error, "Unexpected error in AI routes");
    reply.status(500).send({ error: "Internal Server Error" });
  });

  /**
   * GET /api/ai/health
   * Protected AI configuration & connectivity health check.
   * Query: ?ping=true to run a live `fast`-tier Responses API check.
   * Never exposes OPENAI_API_KEY or raw secrets.
   */
  fastify.get(
    "/api/ai/health",
    { preHandler: authenticateRequest },
    async (request, reply) => {
      const { userId } = getVerifiedUser(request);
      const query = (request.query as { ping?: string }) || {};
      const runLivePing = query.ping === "true";

      const health = await client.checkHealth({ runLivePing });
      const statusCode = health.ok ? 200 : 503;

      return reply.status(statusCode).send({
        ...health,
        requestedBy: userId,
      });
    }
  );

  /**
   * POST /api/ai/test
   * Protected non-trading AI Responses API smoke test endpoint.
   * Body: { prompt?: string, tier?: "deep" | "balanced" | "fast" }
   */
  fastify.post(
    "/api/ai/test",
    { preHandler: authenticateRequest },
    async (request, reply) => {
      const { userId } = getVerifiedUser(request);
      const body = (request.body as { prompt?: unknown; tier?: unknown }) || {};

      const tierRaw = typeof body.tier === "string" ? body.tier.trim().toLowerCase() : "fast";
      if (!VALID_TIERS.has(tierRaw)) {
        return reply.status(400).send({
          error: `Invalid AI tier "${tierRaw}". Allowed: deep, balanced, fast.`,
        });
      }
      const tier = tierRaw as AITaskTier;

      const prompt =
        typeof body.prompt === "string" && body.prompt.trim().length > 0
          ? body.prompt.trim().slice(0, 1000)
          : "Reply with a one-sentence confirmation that the institutional AI research engine is online.";

      const result = await client.createResponse({
        tier,
        input: prompt,
        instructions:
          "You are a read-only institutional research assistant. Do not propose or execute live orders.",
        maxOutputTokens: 120,
        metadata: {
          endpoint: "api_ai_test",
          userId,
        },
      });

      return reply.status(200).send({
        ok: true,
        id: result.id,
        provider: result.provider ?? "gemini",
        fallbackUsed: result.fallbackUsed ?? false,
        tier: result.tier,
        model: result.model,
        outputText: result.outputText,
        usage: result.usage,
        latencyMs: result.latencyMs,
      });
    }
  );

  /**
   * POST /api/ai/company-research
   * Protected read-only Company Research AI Agent endpoint.
   * Body: { symbol: string, question?: string, tier?: "deep" | "balanced" | "fast" }
   * Independently collects & verifies evidence on the backend; ignores client-supplied reports.
   */
  fastify.post(
    "/api/ai/company-research",
    { preHandler: authenticateRequest },
    async (request, reply) => {
      const { userId } = getVerifiedUser(request);
      const body = (request.body as Record<string, unknown>) || {};

      const result = await researchAgent.research({
        symbol: body.symbol,
        question: body.question,
        tier: body.tier,
      });

      return reply.status(200).send({
        ok: true,
        requestedBy: userId,
        ...result,
      });
    }
  );

  /**
   * POST /api/ai/market-intelligence
   * Protected read-only Market Intelligence AI Agent endpoint.
   * Body: { focus?: string, tier?: "deep" | "balanced" | "fast" }
   * Independently collects & verifies market evidence on the backend.
   */
  fastify.post(
    "/api/ai/market-intelligence",
    { preHandler: authenticateRequest },
    async (request, reply) => {
      const { userId } = getVerifiedUser(request);
      const body = (request.body as Record<string, unknown>) || {};

      const result = await marketAgent.analyze({
        focus: body.focus,
        tier: body.tier,
      });

      return reply.status(200).send({
        ok: true,
        requestedBy: userId,
        ...result,
      });
    }
  );

  /**
   * POST /api/ai/institutional-intelligence
   * Protected read-only Institutional Intelligence AI Agent endpoint.
   * Body: { symbol?: string, focus?: string, tier?: "deep" | "balanced" | "fast" }
   * Independently collects & verifies institutional evidence; ignores client-supplied figures.
   */
  fastify.post(
    "/api/ai/institutional-intelligence",
    { preHandler: authenticateRequest },
    async (request, reply) => {
      const { userId } = getVerifiedUser(request);
      const body = (request.body as Record<string, unknown>) || {};

      const result = await institutionalAgent.analyze({
        symbol: body.symbol,
        focus: body.focus,
        tier: body.tier,
      });

      return reply.status(200).send({
        ok: true,
        requestedBy: userId,
        ...result,
      });
    }
  );

  /**
   * POST /api/ai/news-macro-intelligence
   * Protected read-only News & Macro Intelligence AI Agent endpoint.
   * Body: { symbol?: string, focus?: string, tier?: "deep" | "balanced" | "fast" }
   * Independently collects & verifies news/macro evidence; ignores client-supplied evidence.
   */
  fastify.post(
    "/api/ai/news-macro-intelligence",
    { preHandler: authenticateRequest },
    async (request, reply) => {
      const { userId } = getVerifiedUser(request);
      const body = (request.body as Record<string, unknown>) || {};

      const result = await newsMacroAgent.analyze({
        symbol: body.symbol,
        focus: body.focus,
        tier: body.tier,
      });

      return reply.status(200).send({
        ok: true,
        requestedBy: userId,
        ...result,
      });
    }
  );

  /**
   * POST /api/ai/portfolio-intelligence
   * Protected read-only Portfolio Intelligence AI endpoint.
   * Body: { focus?: string, tier?: "deep" | "balanced" | "fast" }
   * Independently retrieves positions owned by authenticated userId.
   */
  fastify.post(
    "/api/ai/portfolio-intelligence",
    { preHandler: authenticateRequest },
    async (request, reply) => {
      const { userId } = getVerifiedUser(request);
      const body = (request.body as Record<string, unknown>) || {};

      const result = await portfolioAgent.analyze(userId, {
        focus: body.focus,
        tier: body.tier,
      });

      return reply.status(200).send({
        ok: true,
        requestedBy: userId,
        ...result,
      });
    }
  );

  /**
   * POST /api/ai/options-intelligence
   * Protected read-only Options Intelligence AI endpoint.
   * Body: { symbol: string, expiry?: string, focus?: string, tier?: "deep" | "balanced" | "fast" }
   * Ignores client-supplied option Greeks or chain balances.
   */
  fastify.post(
    "/api/ai/options-intelligence",
    { preHandler: authenticateRequest },
    async (request, reply) => {
      const { userId } = getVerifiedUser(request);
      const body = (request.body as Record<string, unknown>) || {};

      const result = await optionsAgent.analyze(userId, {
        symbol: body.symbol,
        expiry: body.expiry,
        focus: body.focus,
        tier: body.tier,
      });

      return reply.status(200).send({
        ok: true,
        requestedBy: userId,
        ...result,
      });
    }
  );

  /**
   * POST /api/ai/risk-intelligence
   * Protected read-only Risk & Scenario Intelligence AI endpoint.
   * Body: { focus?: string, shockPct?: number, tier?: "deep" | "balanced" | "fast" }
   * Independently retrieves positions owned by authenticated userId.
   */
  fastify.post(
    "/api/ai/risk-intelligence",
    { preHandler: authenticateRequest },
    async (request, reply) => {
      const { userId } = getVerifiedUser(request);
      const body = (request.body as Record<string, unknown>) || {};

      const result = await riskAgent.analyze(userId, {
        focus: body.focus,
        shockPct: body.shockPct,
        tier: body.tier,
      });

      return reply.status(200).send({
        ok: true,
        requestedBy: userId,
        ...result,
      });
    }
  );

  /**
   * POST /api/ai/chat
   * Unified AI Command Center chat endpoint.
   * Body: { query: string, conversationId?: string, symbol?: string, tier?: "deep" | "balanced" | "fast" }
   */
  fastify.post(
    "/api/ai/chat",
    { preHandler: authenticateRequest },
    async (request, reply) => {
      const { userId } = getVerifiedUser(request);
      if (!checkUserRateLimit(userId)) {
        return reply.status(429).send({
          error: "AI rate limit exceeded. Please wait before sending more requests.",
          code: "AI_RATE_LIMIT_EXCEEDED",
        });
      }

      const body = (request.body as Record<string, unknown>) || {};
      const hintSymbol = extractNseSymbolFromQuery(
        typeof body.query === "string" ? body.query : "",
        typeof body.symbol === "string" ? body.symbol : null
      );
      const previousContexts = hintSymbol
        ? await conversations.findPreviousUnifiedContexts(userId, hintSymbol)
        : [];
      const orchestration = await orchestrator.orchestrate(
        userId,
        {
          query: body.query,
          symbol: body.symbol,
          tier: body.tier,
        },
        { previousContexts }
      );

      let convId =
        typeof body.conversationId === "string" && body.conversationId.trim()
          ? body.conversationId.trim()
          : null;

      if (!convId) {
        const created = await conversations.createConversation(
          userId,
          orchestration.query.slice(0, 60),
          orchestration.routing.intent
        );
        convId = created.id;
      }

      const userMsg = await conversations.appendMessage(userId, convId, {
        role: "user",
        content: orchestration.query,
        lastIntent: orchestration.routing.intent,
      });

      const assistantMsg = await conversations.appendMessage(userId, convId, {
        role: "assistant",
        content: orchestration.synthesized.CONCLUSION.summary,
        structuredResponse: orchestration.synthesized as unknown as Record<string, unknown>,
        agentExecutions: orchestration.agentExecutions as unknown as Array<Record<string, unknown>>,
        unifiedContext: (orchestration.unifiedContext ?? null) as unknown as Record<string, unknown> | null,
        tokenUsage: orchestration.tokenUsage,
        lastIntent: orchestration.routing.intent,
      });

      request.log.info(
        {
          userId,
          conversationId: convId,
          intent: orchestration.routing.intent,
          agents: orchestration.routing.selectedAgents,
          latencyMs: orchestration.totalLatencyMs,
          totalTokens: orchestration.tokenUsage.totalTokens,
        },
        "AI Command Center chat completed"
      );

      return reply.status(200).send({
        ok: true,
        conversationId: convId,
        userMessageId: userMsg.id,
        assistantMessageId: assistantMsg.id,
        ...orchestration,
      });
    }
  );

  /**
   * POST /api/ai/context
   * Builds a unified, evidence-preserving intelligence context for a symbol.
   * Strictly authenticated, user-scoped, read-only, and rate-limit aware.
   */
  fastify.post(
    "/api/ai/context",
    { preHandler: authenticateRequest },
    async (request, reply) => {
      const { userId } = getVerifiedUser(request);
      if (!checkUserRateLimit(userId)) {
        return reply.status(429).send({
          error: "AI rate limit exceeded. Please wait before sending more requests.",
          code: "AI_RATE_LIMIT_EXCEEDED",
        });
      }

      const bodyObj = (request.body as Record<string, unknown>) || {};
      const rawSym =
        typeof bodyObj.symbol === "string" && bodyObj.symbol.trim()
          ? bodyObj.symbol.trim()
          : "";
      const previousContexts = rawSym
        ? await conversations.findPreviousUnifiedContexts(userId, rawSym)
        : [];

      const context = await contextBuilder.buildForSymbol(
        userId,
        request.body,
        { previousContexts }
      );
      await conversations.recordUnifiedContext(userId, context);

      const validationSvc =
        opts?.liveValidationService ??
        new LiveResearchValidationService({ contextBuilder });
      const validation = validationSvc.validateCompanyBundle(
        context,
        previousContexts
      );

      return reply.status(200).send({
        ok: true,
        context,
        unifiedContext: context,
        crossAgentSynthesis: context.crossAgentSynthesis,
        researchScorecard: context.researchScorecard,
        researchBrief: context.researchBrief,
        validation,
      });
    }
  );

  /**
   * POST /api/ai/peer-research
   * Phase 9.5 — Authenticated Multi-Company Peer Research & Live Research Validation.
   * Never trusts client-supplied financial figures.
   */
  fastify.post(
    "/api/ai/peer-research",
    { preHandler: authenticateRequest },
    async (request, reply) => {
      const { userId } = getVerifiedUser(request);
      if (!checkUserRateLimit(userId)) {
        return reply.status(429).send({
          error: "AI rate limit exceeded. Please wait before sending more requests.",
          code: "AI_RATE_LIMIT_EXCEEDED",
        });
      }

      const bodyObj = (request.body as Record<string, unknown>) || {};
      const targetSymbol =
        typeof bodyObj.targetSymbol === "string" && bodyObj.targetSymbol.trim()
          ? bodyObj.targetSymbol.trim()
          : typeof bodyObj.symbol === "string" && bodyObj.symbol.trim()
            ? bodyObj.symbol.trim()
            : "";

      const rawPeers = Array.isArray(bodyObj.peerSymbols)
        ? bodyObj.peerSymbols.filter((s): s is string => typeof s === "string")
        : [];
      const requestedPeriod =
        typeof bodyObj.requestedPeriod === "string" &&
        bodyObj.requestedPeriod.trim()
          ? bodyObj.requestedPeriod.trim()
          : null;
      const tier: AITaskTier =
        typeof bodyObj.tier === "string" && VALID_TIERS.has(bodyObj.tier)
          ? (bodyObj.tier as AITaskTier)
          : "balanced";

      const previousContexts = targetSymbol
        ? await conversations.findPreviousUnifiedContexts(userId, targetSymbol)
        : [];

      const validationSvc =
        opts?.liveValidationService ??
        new LiveResearchValidationService({ contextBuilder });

      const peerResult = await validationSvc.executePeerResearch({
        userId,
        targetSymbol,
        peerSymbols: rawPeers,
        requestedPeriod,
        tier,
        previousContextsForTarget: previousContexts,
      });

      await conversations.recordUnifiedContext(userId, peerResult.targetContext);
      for (const pCtx of peerResult.peerContexts) {
        await conversations.recordUnifiedContext(userId, pCtx);
      }

      return reply.status(200).send({
        ok: true,
        ...peerResult,
      });
    }
  );

  /**
   * GET /api/ai/portfolio-research
   * Phase 9.6 — Authenticated Portfolio Research Intelligence.
   * Maps server-side portfolio positions to server-generated research briefs.
   * Never trusts client-supplied balances or positions; never executes orders.
   */
  fastify.get(
    "/api/ai/portfolio-research",
    { preHandler: authenticateRequest },
    async (request, reply) => {
      const { userId } = getVerifiedUser(request);
      const q = (request.query as Record<string, unknown>) || {};
      const refreshMissing =
        q.refreshMissing === "true" || q.refreshMissing === true;
      if (refreshMissing && !checkUserRateLimit(userId)) {
        return reply.status(429).send({
          error: "AI rate limit exceeded. Please wait before sending more requests.",
          code: "AI_RATE_LIMIT_EXCEEDED",
        });
      }

      const tier: AITaskTier =
        typeof q.tier === "string" && VALID_TIERS.has(q.tier)
          ? (q.tier as AITaskTier)
          : "fast";

      const terminalSvc =
        opts?.terminalService ??
        new InstitutionalTerminalService({
          positionsLoader: opts?.positionsLoader,
          conversations,
          contextBuilder,
          validationService: opts?.liveValidationService,
        });

      const result = await terminalSvc.getPortfolioResearchIntelligence(
        userId,
        {
          refreshMissing,
          tier,
        }
      );

      return reply.status(200).send({
        ok: true,
        ...result,
      });
    }
  );

  /**
   * GET /api/ai/research-history
   * Phase 9.6 — Authenticated Research History with pagination and ownership isolation.
   */
  fastify.get(
    "/api/ai/research-history",
    { preHandler: authenticateRequest },
    async (request, reply) => {
      const { userId } = getVerifiedUser(request);
      const q = (request.query as Record<string, unknown>) || {};
      const pagination = validatePagination(q);
      const symbol =
        typeof q.symbol === "string" && q.symbol.trim()
          ? q.symbol.trim()
          : null;

      const terminalSvc =
        opts?.terminalService ??
        new InstitutionalTerminalService({
          positionsLoader: opts?.positionsLoader,
          conversations,
          contextBuilder,
          validationService: opts?.liveValidationService,
        });

      const history = await terminalSvc.getResearchHistory(userId, {
        symbol,
        limit: pagination.limit,
        offset: pagination.offset,
      });

      return reply.status(200).send({
        ok: true,
        ...history,
      });
    }
  );

  /**
   * GET /api/ai/conversations
   * Lists authenticated user's conversations with pagination.
   */
  fastify.get(
    "/api/ai/conversations",
    { preHandler: authenticateRequest },
    async (request, reply) => {
      const { userId } = getVerifiedUser(request);
      const pagination = validatePagination(
        (request.query as Record<string, unknown>) || {}
      );
      const result = await conversations.listConversations(userId, pagination);
      return reply.status(200).send({
        ok: true,
        ...result,
        ...pagination,
      });
    }
  );

  /**
   * GET /api/ai/conversations/:id
   * Retrieves a single conversation owned by userId with paginated messages.
   */
  fastify.get(
    "/api/ai/conversations/:id",
    { preHandler: authenticateRequest },
    async (request, reply) => {
      const { userId } = getVerifiedUser(request);
      const params = request.params as { id: string };
      const pagination = validatePagination(
        (request.query as Record<string, unknown>) || {}
      );
      const result = await conversations.getConversation(
        userId,
        params.id,
        pagination
      );
      return reply.status(200).send({
        ok: true,
        ...result,
        ...pagination,
      });
    }
  );

  /**
   * POST /api/ai/conversations/:id/messages
   * Sends a message into an existing conversation owned by userId.
   */
  fastify.post(
    "/api/ai/conversations/:id/messages",
    { preHandler: authenticateRequest },
    async (request, reply) => {
      const { userId } = getVerifiedUser(request);
      if (!checkUserRateLimit(userId)) {
        return reply.status(429).send({
          error: "AI rate limit exceeded. Please wait before sending more requests.",
          code: "AI_RATE_LIMIT_EXCEEDED",
        });
      }

      const params = request.params as { id: string };
      const body = (request.body as Record<string, unknown>) || {};

      // Verify ownership before running orchestration
      await conversations.getConversation(userId, params.id, {
        limit: 1,
        offset: 0,
      });

      const hintSymbol = extractNseSymbolFromQuery(
        typeof body.query === "string" ? body.query : "",
        typeof body.symbol === "string" ? body.symbol : null
      );
      const previousContexts = hintSymbol
        ? await conversations.findPreviousUnifiedContexts(userId, hintSymbol)
        : [];

      const orchestration = await orchestrator.orchestrate(
        userId,
        {
          query: body.query,
          symbol: body.symbol,
          tier: body.tier,
        },
        { previousContexts }
      );

      const userMsg = await conversations.appendMessage(userId, params.id, {
        role: "user",
        content: orchestration.query,
        lastIntent: orchestration.routing.intent,
      });

      const assistantMsg = await conversations.appendMessage(userId, params.id, {
        role: "assistant",
        content: orchestration.synthesized.CONCLUSION.summary,
        structuredResponse: orchestration.synthesized as unknown as Record<string, unknown>,
        agentExecutions: orchestration.agentExecutions as unknown as Array<Record<string, unknown>>,
        unifiedContext: (orchestration.unifiedContext ?? null) as unknown as Record<string, unknown> | null,
        tokenUsage: orchestration.tokenUsage,
        lastIntent: orchestration.routing.intent,
      });

      return reply.status(200).send({
        ok: true,
        conversationId: params.id,
        userMessageId: userMsg.id,
        assistantMessageId: assistantMsg.id,
        ...orchestration,
      });
    }
  );

  /**
   * GET /api/ai/usage
   * Returns authenticated user's AI usage & provider observability summary.
   * Supports optional ?provider=gemini|groq|openai&date=YYYY-MM-DD
   */
  fastify.get(
    "/api/ai/usage",
    { preHandler: authenticateRequest },
    async (request, reply) => {
      const { userId } = getVerifiedUser(request);
      const q = (request.query as Record<string, unknown>) || {};
      const provider =
        typeof q.provider === "string" && q.provider.trim()
          ? q.provider.trim().toLowerCase()
          : undefined;
      const date =
        typeof q.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(q.date.trim())
          ? q.date.trim()
          : undefined;

      const summary = usageTracker.getSummary({
        userId,
        provider,
        date,
      });

      return reply.status(200).send({
        ok: true,
        ...summary,
      });
    }
  );

  /**
   * DELETE /api/ai/conversations/:id
   * Deletes a conversation owned by userId.
   */
  fastify.delete(
    "/api/ai/conversations/:id",
    { preHandler: authenticateRequest },
    async (request, reply) => {
      const { userId } = getVerifiedUser(request);
      const params = request.params as { id: string };
      await conversations.deleteConversation(userId, params.id);
      return reply.status(200).send({
        ok: true,
        deletedId: params.id,
      });
    }
  );

  /**
   * GET /api/ai/market-universe
   * Returns NSE/BSE equity universe stats, SEBI/AMFI cap distribution, and paginated companies.
   */
  fastify.get(
    "/api/ai/market-universe",
    { preHandler: authenticateRequest },
    async (request, reply) => {
      getVerifiedUser(request);
      const q = (request.query as Record<string, unknown>) || {};
      const capRaw =
        typeof q.marketCap === "string" ? q.marketCap.trim().toUpperCase() : "ALL";
      const marketCap: MarketCapCategory | "ALL" =
        capRaw === "LARGE_CAP" ||
        capRaw === "MID_CAP" ||
        capRaw === "SMALL_CAP" ||
        capRaw === "UNCLASSIFIED"
          ? capRaw
          : "ALL";
      const result = marketUniverseService.queryUniverse({
        marketCap,
        sector: typeof q.sector === "string" ? q.sector : undefined,
        industry: typeof q.industry === "string" ? q.industry : undefined,
        search: typeof q.search === "string" ? q.search : undefined,
        limit: typeof q.limit === "string" ? Number(q.limit) : undefined,
        offset: typeof q.offset === "string" ? Number(q.offset) : undefined,
      });
      return reply.status(200).send({ ok: true, ...result });
    }
  );

  /**
   * POST /api/ai/market-universe/refresh
   * Triggers a controlled NSE/BSE official listing refresh (preserves existing universe on failure).
   */
  fastify.post(
    "/api/ai/market-universe/refresh",
    { preHandler: authenticateRequest },
    async (request, reply) => {
      const { userId } = getVerifiedUser(request);
      if (!checkUserRateLimit(userId)) {
        return reply.status(429).send({
          error: "AI rate limit exceeded. Please wait before refreshing.",
          code: "AI_RATE_LIMIT_EXCEEDED",
        });
      }
      const stats = await marketUniverseService.refreshFromOfficialExchanges();
      return reply.status(200).send({ ok: true, stats });
    }
  );

  /**
   * POST /api/ai/auto-peer-research
   * Automatic sector/industry/market-cap peer discovery & expanded comparison.
   */
  fastify.post(
    "/api/ai/auto-peer-research",
    { preHandler: authenticateRequest },
    async (request, reply) => {
      const { userId } = getVerifiedUser(request);
      if (!checkUserRateLimit(userId)) {
        return reply.status(429).send({
          error: "AI rate limit exceeded. Please wait before running peer discovery.",
          code: "AI_RATE_LIMIT_EXCEEDED",
        });
      }
      const body = (request.body as Record<string, unknown>) || {};
      const targetSymbol =
        typeof body.targetSymbol === "string" ? body.targetSymbol.trim() : "";
      if (!targetSymbol) {
        return reply.status(400).send({
          error: "targetSymbol is required.",
          code: "INVALID_TARGET_SYMBOL",
        });
      }
      const manualPeerSymbols = Array.isArray(body.manualPeerSymbols)
        ? body.manualPeerSymbols.filter((s): s is string => typeof s === "string")
        : undefined;
      const comparison = await autoPeerComparisonService.compareWithAutoPeers({
        targetSymbol,
        manualPeerSymbols,
      });
      return reply.status(200).send({ ok: true, ...comparison });
    }
  );

  /**
   * POST /api/ai/top5-discovery
   * Market-wide Top 5 Institutional Research Picks scan across the eligible NSE/BSE universe.
   */
  fastify.post(
    "/api/ai/top5-discovery",
    { preHandler: authenticateRequest },
    async (request, reply) => {
      const { userId } = getVerifiedUser(request);
      if (!checkUserRateLimit(userId)) {
        return reply.status(429).send({
          error: "AI rate limit exceeded. Please wait before running market scan.",
          code: "AI_RATE_LIMIT_EXCEEDED",
        });
      }
      const body = (request.body as Record<string, unknown>) || {};
      const rawCap =
        typeof body.marketCap === "string" ? body.marketCap.trim().toUpperCase() : "ALL";
      const marketCap: MarketCapCategory | "ALL" =
        rawCap === "LARGE_CAP" || rawCap === "MID_CAP" || rawCap === "SMALL_CAP"
          ? rawCap
          : "ALL";
      const rawRisk =
        typeof body.riskProfile === "string" ? body.riskProfile.trim().toUpperCase() : "BALANCED";
      const riskProfile: DiscoveryRiskProfile =
        rawRisk === "CONSERVATIVE" || rawRisk === "AGGRESSIVE" ? rawRisk : "BALANCED";
      const rawQual =
        typeof body.minDataQuality === "string" ? body.minDataQuality.trim().toUpperCase() : "ANY";
      const minDataQuality: MinDataQualityFilter =
        rawQual === "COMPLETE" || rawQual === "PARTIAL" ? rawQual : "ANY";

      const scan = await top5DiscoveryEngine.runDiscoveryScan({
        userId,
        filters: {
          marketCap,
          sector: typeof body.sector === "string" ? body.sector : undefined,
          industry: typeof body.industry === "string" ? body.industry : undefined,
          riskProfile,
          minDataQuality,
          minLiquidityCr:
            typeof body.minLiquidityCr === "number" ? body.minLiquidityCr : undefined,
        },
        batchSize: typeof body.batchSize === "number" ? body.batchSize : 25,
        cursorOffset: typeof body.cursorOffset === "number" ? body.cursorOffset : 0,
      });
      return reply.status(200).send({ ok: true, ...scan });
    }
  );

  /**
   * GET /api/ai/top5-discovery/history
   * Returns authenticated user's persisted market-wide Top 5 discovery scan history.
   */
  fastify.get(
    "/api/ai/top5-discovery/history",
    { preHandler: authenticateRequest },
    async (request, reply) => {
      const { userId } = getVerifiedUser(request);
      const q = (request.query as Record<string, unknown>) || {};
      const limit = typeof q.limit === "string" ? Number(q.limit) : 10;
      const offset = typeof q.offset === "string" ? Number(q.offset) : 0;
      const history = await top5DiscoveryEngine.listUserScanHistory(
        userId,
        limit,
        offset
      );
      return reply.status(200).send({ ok: true, ...history });
    }
  );

  /**
   * POST /api/ai/market-universe/amfi-import
   * Imports official AMFI categorization CSV/records and reapplies official ISIN classification.
   */
  fastify.post(
    "/api/ai/market-universe/amfi-import",
    { preHandler: authenticateRequest },
    async (request, reply) => {
      const { userId } = getVerifiedUser(request);
      if (!checkUserRateLimit(userId)) {
        return reply.status(429).send({
          error: "AI rate limit exceeded. Please wait.",
          code: "AI_RATE_LIMIT_EXCEEDED",
        });
      }
      const body = (request.body as Record<string, unknown>) || {};
      const period =
        typeof body.classificationPeriod === "string" && body.classificationPeriod.trim()
          ? body.classificationPeriod.trim()
          : "Official AMFI Half-Year";
      const pubDate =
        typeof body.publicationDate === "string" && body.publicationDate.trim()
          ? body.publicationDate.trim()
          : new Date().toISOString().slice(0, 10);

      let meta;
      if (typeof body.csvText === "string" && body.csvText.trim()) {
        const parsed = parseAmfiCsvDetailed(body.csvText, {
          classificationPeriod: period,
          publicationDate: pubDate,
        });
        meta = amfiClassificationService.ingestOfficialAmfiRecords({
          records: parsed.records,
          classificationPeriod: period,
          publicationDate: pubDate,
          totalSourceRows: parsed.totalSourceRows,
          duplicateIsinCount: parsed.duplicateIsinCount,
          rejectedRowCount: parsed.rejectedRowCount,
        });
      } else {
        meta = await amfiClassificationService.fetchOfficialAmfiFromPortal();
      }
      const stats = marketUniverseService.reapplyAmfiClassification();
      const matchedCount = stats.largeCapCount + stats.midCapCount + stats.smallCapCount;
      return reply.status(200).send({
        ok: true,
        amfi: meta,
        stats,
        matchedCount,
        unmatchedCount: stats.unclassifiedCapCount,
        duplicateIsinCount: meta.duplicateIsinCount,
        rejectedRowCount: meta.rejectedRowCount,
        officialCategoryCounts: meta.officialCategoryCounts,
      });
    }
  );

  /**
   * POST /api/ai/market-universe/enrich-sectors
   * Runs bounded-concurrency sector/industry enrichment batch across the universe.
   */
  fastify.post(
    "/api/ai/market-universe/enrich-sectors",
    { preHandler: authenticateRequest },
    async (request, reply) => {
      const { userId } = getVerifiedUser(request);
      if (!checkUserRateLimit(userId)) {
        return reply.status(429).send({
          error: "AI rate limit exceeded. Please wait.",
          code: "AI_RATE_LIMIT_EXCEEDED",
        });
      }
      const body = (request.body as Record<string, unknown>) || {};
      const result = await marketUniverseService.enrichSectorsBatch({
        batchSize: typeof body.batchSize === "number" ? body.batchSize : 25,
        cursorOffset: typeof body.cursorOffset === "number" ? body.cursorOffset : 0,
      });
      return reply.status(200).send({ ok: true, ...result });
    }
  );

  /**
   * GET /api/ai/top5-discovery/:scanId
   * Returns real-time progress and partial/final Top 5 results for an owned scan job.
   */
  fastify.get(
    "/api/ai/top5-discovery/:scanId",
    { preHandler: authenticateRequest },
    async (request, reply) => {
      const { userId } = getVerifiedUser(request);
      const params = request.params as { scanId: string };
      const scan = top5DiscoveryEngine.getScanStatus(params.scanId, userId);
      if (!scan) {
        return reply.status(404).send({
          error: "Discovery scan job not found.",
          code: "SCAN_NOT_FOUND",
        });
      }
      return reply.status(200).send({ ok: true, ...scan });
    }
  );

  /**
   * POST /api/ai/top5-discovery/:scanId/resume
   * Resumes an incomplete discovery scan without restarting already-succeeded companies.
   */
  fastify.post(
    "/api/ai/top5-discovery/:scanId/resume",
    { preHandler: authenticateRequest },
    async (request, reply) => {
      const { userId } = getVerifiedUser(request);
      if (!checkUserRateLimit(userId)) {
        return reply.status(429).send({
          error: "AI rate limit exceeded. Please wait.",
          code: "AI_RATE_LIMIT_EXCEEDED",
        });
      }
      const params = request.params as { scanId: string };
      const body = (request.body as Record<string, unknown>) || {};
      const scan = await top5DiscoveryEngine.resumeDiscoveryScan({
        scanId: params.scanId,
        userId,
        batchSize: typeof body.batchSize === "number" ? body.batchSize : 25,
        retryFailed: Boolean(body.retryFailed),
      });
      return reply.status(200).send({ ok: true, ...scan });
    }
  );
};

export default aiRoutes;

