import { FastifyPluginAsync } from "fastify";
import { tradingEngine, TradingError } from "../trading/TradingEngine";
import { positionStore } from "../trading/PositionStore";
import { pendingOrderStore } from "../trading/PendingOrderStore";
import { priceStore } from "../market/MarketPriceStore";
import { validateMarketOrder, validateLimitOrder, ValidationError } from "../trading/validation";
import { AuthenticationError, AuthorizationError } from "../trading/userContext";
import { authenticateRequest, getVerifiedUser } from "../auth/middleware";
import { tradeRepository } from "../db/TradeRepository";
import { AnalyticsService } from "../trading/AnalyticsService";

const tradingRoutes: FastifyPluginAsync = async (fastify) => {

  // ─── Global error handler for this plugin ───────────────────────────────
  fastify.setErrorHandler((error, request, reply) => {
    if (error instanceof AuthenticationError) {
      reply.status(401).send({ error: error.message });
      return;
    }
    if (error instanceof AuthorizationError) {
      reply.status(403).send({ error: error.message });
      return;
    }
    if (error instanceof ValidationError) {
      reply.status(400).send({ error: error.message });
      return;
    }
    if (error instanceof TradingError) {
      if (error.message.includes("already closed or closing") || error.message.includes("Cannot cancel order")) {
        reply.status(409).send({ error: error.message });
      } else if (
        error.message.toLowerCase().includes("not found") ||
        error.message.toLowerCase().includes("does not belong")
      ) {
        reply.status(404).send({ error: "Not found." });
      } else {
        reply.status(400).send({ error: error.message });
      }
      return;
    }

    fastify.log.error(error);
    reply.status(500).send({ error: "Internal Server Error" });
  });

  // ─── Analytics Endpoint ───────────────────────────────────────────────

  fastify.get('/trading/analytics', {
    preHandler: authenticateRequest
  }, async (request, reply) => {
    const { userId } = getVerifiedUser(request);
    const rows = await tradeRepository.findAllTrades(userId);
    const records = rows.map((r) => AnalyticsService.normalizeRow(r));

    const query = request.query as { year?: string; month?: string; startingCapital?: string } || {};
    const startingCapital = query.startingCapital ? parseFloat(query.startingCapital) : 500;

    const dashboard = AnalyticsService.calculateDashboard(records, startingCapital);
    const strategies = AnalyticsService.calculateStrategies(records);
    const calendar = AnalyticsService.calculateCalendar(records);
    const equityCurve = AnalyticsService.calculateEquityCurve(
      AnalyticsService.getClosedTrades(records),
      startingCapital
    );

    let monthlyReview = null;
    if (query.year && query.month) {
      monthlyReview = AnalyticsService.calculateMonthlyReview(
        records,
        parseInt(query.year, 10),
        parseInt(query.month, 10),
        startingCapital
      );
    }

    reply.status(200).send({
      userId,
      dashboard,
      strategies,
      calendar,
      equityCurve,
      monthlyReview,
    });
  });

  // ─── Market Orders ───────────────────────────────────────────────────────

  fastify.post('/trading/orders/market', {
    preHandler: authenticateRequest
  }, async (request, reply) => {
    const { userId } = getVerifiedUser(request);

    const body = (request.body as any) || {};
    const marketPrice = priceStore.getPrice(body.instrument);
    if (!marketPrice || marketPrice.status !== "LIVE") {
      throw new TradingError(`Live market data not available for ${body.instrument}. Cannot validate order.`);
    }

    const orderRequest = validateMarketOrder(body, marketPrice.price);
    const position = await tradingEngine.openPosition(userId, orderRequest);
    reply.status(201).send(position);
  });

  // ─── Limit Orders ────────────────────────────────────────────────────────

  fastify.post('/trading/orders/limit', {
    preHandler: authenticateRequest
  }, async (request, reply) => {
    const { userId } = getVerifiedUser(request);

    const body = (request.body as any) || {};
    const marketPrice = priceStore.getPrice(body.instrument);
    if (!marketPrice || marketPrice.status !== "LIVE") {
      throw new TradingError(`Live market data not available for ${body.instrument}. Cannot validate limit order.`);
    }

    const orderRequest = validateLimitOrder(body, marketPrice.price);
    const order = await tradingEngine.openLimitOrder(userId, orderRequest);
    reply.status(201).send(order);
  });

  fastify.post('/trading/orders/:id/cancel', {
    preHandler: authenticateRequest
  }, async (request, reply) => {
    const { userId } = getVerifiedUser(request);
    const { id } = request.params as { id: string };

    const order = await tradingEngine.cancelLimitOrder(userId, id);
    reply.status(200).send(order);
  });

  fastify.get('/trading/orders/pending', {
    preHandler: authenticateRequest
  }, async (request, reply) => {
    const { userId } = getVerifiedUser(request);
    const orders = pendingOrderStore.getByUser(userId).filter(o => o.status === "PENDING");
    reply.status(200).send(orders);
  });

  fastify.get('/trading/orders', {
    preHandler: authenticateRequest
  }, async (request, reply) => {
    const { userId } = getVerifiedUser(request);
    const orders = pendingOrderStore.getByUser(userId);
    reply.status(200).send(orders);
  });

  fastify.get('/trading/orders/:id', {
    preHandler: authenticateRequest
  }, async (request, reply) => {
    const { userId } = getVerifiedUser(request);
    const { id } = request.params as { id: string };

    const order = pendingOrderStore.get(id);
    if (!order || order.userId !== userId) {
      reply.status(404).send({ error: "Order not found." });
      return;
    }

    reply.status(200).send(order);
  });

  // ─── Positions ───────────────────────────────────────────────────────────

  fastify.get('/trading/positions', {
    preHandler: authenticateRequest
  }, async (request, reply) => {
    const { userId } = getVerifiedUser(request);
    const positions = positionStore.getByUser(userId);
    reply.status(200).send(positions);
  });

  fastify.get('/trading/positions/:id', {
    preHandler: authenticateRequest
  }, async (request, reply) => {
    const { userId } = getVerifiedUser(request);
    const { id } = request.params as { id: string };

    const position = positionStore.get(id);
    if (!position || position.userId !== userId) {
      reply.status(404).send({ error: "Position not found." });
      return;
    }

    reply.status(200).send(position);
  });

  fastify.post('/trading/positions/:id/close', {
    preHandler: authenticateRequest
  }, async (request, reply) => {
    const { userId } = getVerifiedUser(request);
    const { id } = request.params as { id: string };

    // Check ownership before calling engine so we return 404 vs 400/error
    const existing = positionStore.get(id);
    if (!existing || existing.userId !== userId) {
      reply.status(404).send({ error: "Not found." });
      return;
    }

    const position = await tradingEngine.closePosition(userId, id);
    reply.status(200).send(position);
  });
};

export default tradingRoutes;
