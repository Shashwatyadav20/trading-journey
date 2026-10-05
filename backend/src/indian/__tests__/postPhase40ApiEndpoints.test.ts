/**
 * POST-PHASE-40 OPERATIONS API ENDPOINTS — Test Suite
 *
 * Verifies Fastify HTTP endpoints for:
 *   - GET /api/indian/operations/status
 *   - GET /api/indian/operations/market
 *   - GET /api/indian/operations/trading
 *   - GET /api/indian/operations/risk
 *   - GET /api/indian/operations/reconciliation
 *   - GET /api/indian/operations/alerts
 *   - GET /api/indian/operations/sample
 */

import { describe, test, expect, beforeEach, afterEach } from "vitest";
import Fastify, { FastifyInstance } from "fastify";
import indianTradingRoutes from "../../routes/indianTrading";

describe("POST-PHASE-40 OPERATIONS API ENDPOINTS — Test Suite", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = Fastify();
    await app.register(indianTradingRoutes);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  test("1. GET /api/indian/operations/status returns 200 OK and full operations status payload", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/indian/operations/status",
    });

    expect(res.statusCode).toBe(200);
    const json = JSON.parse(res.payload);
    expect(json.success).toBe(true);
    expect(json.status).toBeDefined();
    expect(json.status.system).toBeDefined();
    expect(json.status.marketData).toBeDefined();
    expect(json.status.trading).toBeDefined();
    expect(json.status.risk).toBeDefined();
    expect(json.status.reconciliation).toBeDefined();
    expect(json.status.sample).toBeDefined();
    expect(json.status.alerts).toBeDefined();
    expect(json.status.safety).toEqual({
      paperTrading: true,
      liveTrading: false,
      brokerExecution: false,
      realDataOnly: true,
      realDhanOrders: 0,
    });
  });

  test("2. GET /api/indian/operations/market returns 200 OK and market data freshness", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/indian/operations/market",
    });

    expect(res.statusCode).toBe(200);
    const json = JSON.parse(res.payload);
    expect(json.success).toBe(true);
    expect(json.marketData).toBeDefined();
    expect(json.marketData.niftySpot).toBeDefined();
    expect(json.marketData.optionChain).toBeDefined();
    expect(json.marketData.greeks).toBeDefined();
    expect(json.marketData.genuineDataGate).toBeDefined();
  });

  test("3. GET /api/indian/operations/trading returns 200 OK and active paper position monitor", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/indian/operations/trading",
    });

    expect(res.statusCode).toBe(200);
    const json = JSON.parse(res.payload);
    expect(json.success).toBe(true);
    expect(json.trading).toBeDefined();
    expect(Array.isArray(json.trading.activePositions)).toBe(true);
  });

  test("4. GET /api/indian/operations/risk returns 200 OK and daily risk status", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/indian/operations/risk",
    });

    expect(res.statusCode).toBe(200);
    const json = JSON.parse(res.payload);
    expect(json.success).toBe(true);
    expect(json.risk).toBeDefined();
    expect(json.risk.dailyProfitLockTarget).toBe(1000);
    expect(json.risk.dailyLossLockLimit).toBe(-5000);
    expect(json.risk.maxTradesPerDay).toBe(3);
  });

  test("5. GET /api/indian/operations/reconciliation returns 200 OK and reconciliation status", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/indian/operations/reconciliation",
    });

    expect(res.statusCode).toBe(200);
    const json = JSON.parse(res.payload);
    expect(json.success).toBe(true);
    expect(json.reconciliation).toBeDefined();
    expect(typeof json.reconciliation.isSafe).toBe("boolean");
  });

  test("6. GET /api/indian/operations/alerts returns 200 OK and operational alerts list", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/indian/operations/alerts",
    });

    expect(res.statusCode).toBe(200);
    const json = JSON.parse(res.payload);
    expect(json.success).toBe(true);
    expect(Array.isArray(json.alerts)).toBe(true);
  });

  test("7. GET /api/indian/operations/sample returns 200 OK and sample evidence progress", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/indian/operations/sample",
    });

    expect(res.statusCode).toBe(200);
    const json = JSON.parse(res.payload);
    expect(json.success).toBe(true);
    expect(json.sample).toBeDefined();
    expect(typeof json.sample.genuineSessions).toBe("number");
    expect(typeof json.sample.genuineTrades).toBe("number");
  });
});
