import { describe, it, expect, beforeEach, vi } from "vitest";
import Fastify from "fastify";
import indianTradingRoutes from "../../routes/indianTrading";
import { phase21OperationalMonitor } from "../validation/Phase21OperationalMonitor";
import { operationalAlertLogger } from "../audit/OperationalAlertLogger";

describe("Phase 21 — Fastify API Endpoints Integration Test Suite", () => {
  let app: ReturnType<typeof Fastify>;

  beforeEach(async () => {
    vi.restoreAllMocks();
    operationalAlertLogger.clearAlerts();
    app = Fastify();
    await app.register(indianTradingRoutes);
    await app.ready();
  });

  it("1. GET /api/indian/phase21/operational-status returns 3-source telemetry, safety flags and systemStatus", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/indian/phase21/operational-status",
    });

    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json.success).toBe(true);
    expect(json.data).toBeDefined();

    // Check systemStatus
    expect(["HEALTHY", "DEGRADED", "BLOCKED", "ERROR"]).toContain(json.data.systemStatus);

    // Check safety flags
    expect(json.data.safetyFlags.paperTrading).toBe(true);
    expect(json.data.safetyFlags.liveTrading).toBe(false);
    expect(json.data.safetyFlags.brokerExecutionEnabled).toBe(false);
    expect(json.data.safetyFlags.realBrokerOrdersSent).toBe(0);

    // Check 3 sources
    expect(json.data.sources.nse).toBeDefined();
    expect(json.data.sources.dhan).toBeDefined();
    expect(json.data.sources.paperEngine).toBeDefined();

    // Check marketSession and heartbeat
    expect(json.data.marketSession).toBeDefined();
    expect(json.data.heartbeat).toBeDefined();
  });

  it("2. GET /api/indian/phase21/quote-comparison returns observational quote comparison between NSE and Dhan", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/indian/phase21/quote-comparison?symbol=NIFTY&expiry=26924&strike=24500&optionType=CE&customNseLtp=120&customDhanLtp=121",
    });

    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json.success).toBe(true);
    expect(json.comparison).toBeDefined();
    expect(json.comparison.symbol).toBe("NIFTY");
    expect(json.comparison.nseLtp).toBe(120);
    expect(json.comparison.dhanLtp).toBe(121);
    expect(json.comparison.priceDifference).toBe(1);
    expect(json.comparison.isMismatch).toBe(false);
    expect(json.comparison.observationalOnly).toBe(true);
  });

  it("3. GET /api/indian/phase21/instrument-reconciliation verifies instrument lot size and attributes across sources", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/indian/phase21/instrument-reconciliation?symbol=NIFTY&expiry=26924&strike=24500&optionType=CE&customNseLotSize=50&customDhanLotSize=50",
    });

    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json.success).toBe(true);
    expect(json.reconciliation).toBeDefined();
    expect(json.reconciliation.isReconciled).toBe(true);
    expect(json.reconciliation.lotSizeMatch).toBe(true);
    expect(json.reconciliation.blocksPaperTrading).toBe(false);
  });

  it("4. GET /api/indian/phase21/heartbeat returns 11-point heartbeat array", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/indian/phase21/heartbeat",
    });

    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json.success).toBe(true);
    expect(json.heartbeat).toBeDefined();
    expect(json.heartbeat.lastNseSpot).toBeDefined();
    expect(json.heartbeat.lastNseOptionChain).toBeDefined();
    expect(json.heartbeat.lastNseOptionPrice).toBeDefined();
    expect(json.heartbeat.lastDhanConnection).toBeDefined();
    expect(json.heartbeat.lastDhanQuote).toBeDefined();
    expect(json.heartbeat.lastDhanPositionSync).toBeDefined();
    expect(json.heartbeat.lastDhanOrderSync).toBeDefined();
    expect(json.heartbeat.lastStrategyEvaluation).toBeDefined();
    expect(json.heartbeat.lastPaperOrder).toBeDefined();
    expect(json.heartbeat.lastPaperExit).toBeDefined();
    expect(json.heartbeat.lastReconciliation).toBeDefined();
    expect(json.heartbeat.latencyMs).toBeGreaterThanOrEqual(5);
  });

  it("5. GET /api/indian/phase21/session-monitor returns session metrics and uptime", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/indian/phase21/session-monitor",
    });

    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json.success).toBe(true);
    expect(json.marketSession).toBeDefined();
    expect(typeof json.marketSession.isMarketSessionOpen).toBe("boolean");
    expect(json.marketSession.sessionStartTimeIst).toBe("09:15:00 IST");
    expect(json.marketSession.sessionEndTimeIst).toBe("15:30:00 IST");
    expect(typeof json.marketSession.nseUptimePercent).toBe("number");
    expect(typeof json.marketSession.dhanUptimePercent).toBe("number");
  });

  it("6. GET /api/indian/phase21/alerts returns recent operational alerts", async () => {
    operationalAlertLogger.logAlert(
      "DATA_SOURCE_MISMATCH",
      "Test alert for Phase 21 endpoint",
      "WARNING"
    );

    const res = await app.inject({
      method: "GET",
      url: "/api/indian/phase21/alerts",
    });

    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json.success).toBe(true);
    expect(Array.isArray(json.alerts)).toBe(true);
    expect(json.alerts.length).toBeGreaterThanOrEqual(1);
    expect(json.alerts[0].eventType).toBe("DATA_SOURCE_MISMATCH");
  });
});
