import { describe, it, expect, beforeEach } from "vitest";
import { phase19GenuineValidationEngine } from "../validation/Phase19GenuineValidationEngine";
import Fastify from "fastify";
import indianTradingRoutes from "../../routes/indianTrading";

describe("Phase 19 — Fastify API Endpoints Integration Test Suite", () => {
  let app: ReturnType<typeof Fastify>;

  beforeEach(async () => {
    phase19GenuineValidationEngine.resetState();
    app = Fastify();
    await app.register(indianTradingRoutes);
    await app.ready();
  });

  it("1. GET /api/indian/phase19/summary returns full validation report structure", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/indian/phase19/summary",
    });

    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json.success).toBe(true);
    expect(json.report).toHaveProperty("validationStatus");
    expect(json.report).toHaveProperty("finalStatus");
    expect(json.report).toHaveProperty("genuineSample");
    expect(json.report).toHaveProperty("tradeMetrics");
    expect(json.report).toHaveProperty("dailyDistribution");
    expect(json.report).toHaveProperty("drawdown");
    expect(json.report).toHaveProperty("strategies");
    expect(json.report).toHaveProperty("regimes");
    expect(json.report).toHaveProperty("exits");
    expect(json.report).toHaveProperty("riskAudit");
    expect(json.report).toHaveProperty("executionQuality");
    expect(json.report).toHaveProperty("dataReliability");
    expect(json.report).toHaveProperty("rollingMetrics");
    expect(json.report).toHaveProperty("confidence");
    expect(json.report).toHaveProperty("historicalComparison");
    expect(json.report.safetyLocks.paperTrading).toBe(true);
    expect(json.report.safetyLocks.liveTrading).toBe(false);
    expect(json.report.safetyLocks.brokerExecutionEnabled).toBe(false);
  });

  it("2. GET /api/indian/phase19/scorecard returns validation lock status and thresholds", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/indian/phase19/scorecard",
    });

    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json.success).toBe(true);
    expect(json.validationStatus).toBe("INSUFFICIENT_SAMPLE");
    expect(json.genuineSample.minRequiredSessions).toBe(20);
    expect(json.genuineSample.minRequiredTrades).toBe(30);
    expect(json.genuineSample.minRequiredActiveSessions).toBe(15);
    expect(json.safetyLocks.paperTrading).toBe(true);
    expect(json.safetyLocks.liveTrading).toBe(false);
  });

  it("3. GET /api/indian/phase19/daily returns daily P&L distribution and ₹1,000 analysis", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/indian/phase19/daily",
    });

    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json.success).toBe(true);
    expect(json.dailyDistribution).toHaveProperty("daysAbove1000");
    expect(json.dailyDistribution).toHaveProperty("days0To999");
    expect(json.dailyDistribution).toHaveProperty("daysNegative");
    expect(json.dailyDistribution).toHaveProperty("noTradeDays");
    expect(json.dailyDistribution).toHaveProperty("blockedDays");
  });

  it("4. GET /api/indian/phase19/strategies returns unranked spread breakdown", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/indian/phase19/strategies",
    });

    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json.success).toBe(true);
    expect(Array.isArray(json.strategies)).toBe(true);
    expect(json.strategies.length).toBe(3);
    const names = json.strategies.map((s: any) => s.strategy);
    expect(names).toContain("BULL_PUT");
    expect(names).toContain("BEAR_CALL");
    expect(names).toContain("IRON_CONDOR");
  });

  it("5. GET /api/indian/phase19/regimes returns market regime metrics", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/indian/phase19/regimes",
    });

    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json.success).toBe(true);
    expect(Array.isArray(json.regimes)).toBe(true);
  });

  it("6. GET /api/indian/phase19/exits returns 5-level exit priority breakdown", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/indian/phase19/exits",
    });

    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json.success).toBe(true);
    expect(Array.isArray(json.exits)).toBe(true);
  });

  it("7. GET /api/indian/phase19/risk returns zero executed risk violations and verified safety locks", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/indian/phase19/risk",
    });

    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json.success).toBe(true);
    expect(json.riskAudit.executedViolations).toBe(0);
    expect(json.executionQuality.nakedShortCount).toBe(0);
  });

  it("8. GET /api/indian/phase19/data-quality returns availability and no-trade breakdown", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/indian/phase19/data-quality",
    });

    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json.success).toBe(true);
    expect(json.dataReliability).toHaveProperty("spotAvailability");
    expect(json.dataReliability).toHaveProperty("optionChainAvailability");
    expect(Array.isArray(json.noTradeReasons)).toBe(true);
  });

  it("9. GET /api/indian/phase19/export provides sanitized genuine records without credentials", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/indian/phase19/export",
    });

    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json.success).toBe(true);
    expect(json.export.sampleClassification).toBe("REAL_GENUINE_PAPER");
    expect(json.export.safetyLocks.paperTrading).toBe(true);
    expect(json.export.safetyLocks.liveTrading).toBe(false);
  });
});
