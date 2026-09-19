import { describe, it, expect, beforeEach, vi } from "vitest";
import Fastify from "fastify";
import indianTradingRoutes from "../../routes/indianTrading";
import { dhanBrokerAdapter } from "../broker/DhanBrokerAdapter";

describe("Phase 20 — Fastify Broker API Endpoints Integration Test Suite", () => {
  let app: ReturnType<typeof Fastify>;

  beforeEach(async () => {
    vi.restoreAllMocks();
    app = Fastify();
    await app.register(indianTradingRoutes);
    await app.ready();
  });

  it("1. GET /api/indian/broker/status returns diagnostics, permanent safety flags, and scorecard", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/indian/broker/status",
    });

    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json.success).toBe(true);
    expect(json).toHaveProperty("statusBanner");
    expect(json).toHaveProperty("diagnostics");
    expect(json).toHaveProperty("scorecard");
    expect(json.diagnostics.safetyState.PAPER_TRADING).toBe(true);
    expect(json.diagnostics.safetyState.LIVE_TRADING).toBe(false);
    expect(json.diagnostics.safetyState.BROKER_EXECUTION_ENABLED).toBe(false);
    expect(json.diagnostics.realOrdersSent).toBe(0);

    // Verify scorecard includes Execution Lock as PASS
    expect(json.scorecard["Execution Lock"]).toBe("PASS");
  });

  it("2. GET /api/indian/broker/account returns read-only account data without secrets", async () => {
    vi.spyOn(dhanBrokerAdapter, "getAccount").mockResolvedValue({
      accountId: "110****334",
      brokerName: "DHAN",
      cashBalance: 100000,
      usedMargin: 10000,
      availableMargin: 90000,
      collateralMargin: 0,
      currency: "INR",
      isPaperAccount: false,
    });

    const res = await app.inject({
      method: "GET",
      url: "/api/indian/broker/account",
    });

    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json.success).toBe(true);
    expect(json.account.brokerName).toBe("DHAN");
    expect(json.account.accountId).toContain("****");

    // Token must never appear in response payload
    const rawString = JSON.stringify(json);
    const token = process.env.BROKER_ACCESS_TOKEN;
    if (token) {
      expect(rawString).not.toContain(token);
    }
  });

  it("3. GET /api/indian/broker/positions returns normalized positions list", async () => {
    vi.spyOn(dhanBrokerAdapter, "getPositions").mockResolvedValue([]);

    const res = await app.inject({
      method: "GET",
      url: "/api/indian/broker/positions",
    });

    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json.success).toBe(true);
    expect(Array.isArray(json.positions)).toBe(true);
  });

  it("4. GET /api/indian/broker/orders returns normalized orders list", async () => {
    vi.spyOn(dhanBrokerAdapter, "getOrders").mockResolvedValue([]);

    const res = await app.inject({
      method: "GET",
      url: "/api/indian/broker/orders",
    });

    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json.success).toBe(true);
    expect(Array.isArray(json.orders)).toBe(true);
  });

  it("5. GET /api/indian/broker/instruments returns resolved NIFTY instruments", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/indian/broker/instruments",
    });

    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json.success).toBe(true);
    expect(Array.isArray(json.instruments)).toBe(true);
    if (json.instruments.length > 0) {
      expect(json.instruments[0].symbol).toBe("NIFTY");
      expect(json.instruments[0].strike).toBe(24500);
    }
  });

  it("6. GET /api/indian/broker/reconciliation runs observational reconciliation without placing orders", async () => {
    vi.spyOn(dhanBrokerAdapter, "getPositions").mockResolvedValue([]);
    vi.spyOn(dhanBrokerAdapter, "getOrders").mockResolvedValue([]);
    vi.spyOn(dhanBrokerAdapter, "getAccount").mockResolvedValue({
      accountId: "110****334",
      brokerName: "DHAN",
      cashBalance: 100000,
      usedMargin: 0,
      availableMargin: 100000,
      collateralMargin: 0,
      currency: "INR",
      isPaperAccount: false,
    });

    const res = await app.inject({
      method: "GET",
      url: "/api/indian/broker/reconciliation",
    });

    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json.success).toBe(true);
    expect(json.reconciliation).toHaveProperty("positionReconciliation");
    expect(json.reconciliation).toHaveProperty("orderReconciliation");
    expect(json.reconciliation).toHaveProperty("pnlReconciliation");
    expect(json.reconciliation).toHaveProperty("criticalMismatchDetected");
  });
});
