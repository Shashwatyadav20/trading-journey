import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Fastify, { FastifyInstance } from "fastify";
import healthRoutes from "../health";
import indianTradingRoutes from "../indianTrading";
import { dailyScanPersistenceService } from "../../db/DailyScanPersistenceService";
import { setAdminSupabaseClient } from "../../db/supabaseClient";

describe("Health & Persistence Routes Verification", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    setAdminSupabaseClient(null);
    dailyScanPersistenceService.resetMemoryStateForTesting();

    // Default to unconfigured (in-memory) mode regardless of local .env file
    vi.spyOn(dailyScanPersistenceService, "isDatabaseConfigured").mockReturnValue(false);

    app = Fastify({ logger: false });
    await app.register(healthRoutes);
    await app.register(indianTradingRoutes);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    setAdminSupabaseClient(null);
    await app.close();
  });

  it("1. GET /health returns 200 with service status and persistence overview", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/health",
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe("ok");
    expect(body.service).toBe("trading-backend");
    expect(body.timestamp).toBeDefined();
    expect(body.persistence).toBeDefined();
    expect(body.persistence.mode).toBe("in-memory");
    expect(body.persistence.configured).toBe(false);
    expect(body.persistence.reachable).toBe(false);
  });

  it("2. GET /health/persistence returns 200 with in-memory mode when unconfigured", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/health/persistence",
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.configured).toBe(false);
    expect(body.reachable).toBe(false);
    expect(body.mode).toBe("in-memory");
    expect(body.timestamp).toBeDefined();

    // Verify secrets are NOT exposed
    expect(body.SUPABASE_URL).toBeUndefined();
    expect(body.SUPABASE_SERVICE_ROLE_KEY).toBeUndefined();
    expect(body.key).toBeUndefined();
  });

  it("3. GET /health/persistence returns 200 with healthy tables when Supabase is configured & reachable", async () => {
    const mockClient: any = {
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          limit: vi.fn().mockResolvedValue({ data: [{ id: "test-run" }], error: null }),
        })),
      })),
    };

    setAdminSupabaseClient(mockClient);
    vi.spyOn(dailyScanPersistenceService, "isDatabaseConfigured").mockReturnValue(true);

    const res = await app.inject({
      method: "GET",
      url: "/health/persistence",
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.configured).toBe(true);
    expect(body.reachable).toBe(true);
    expect(body.mode).toBe("supabase");
    expect(body.latencyMs).toBeGreaterThanOrEqual(0);
    expect(body.tableCheck?.daily_scan_runs).toBe(true);
    expect(body.tableCheck?.daily_scan_opportunities).toBe(true);
    expect(body.error).toBeUndefined();
  });

  it("4. GET /health/persistence returns 503 with sanitized error when DB is unreachable", async () => {
    const sensitiveToken = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.sensitivePayload.secretSignature";
    const mockClient: any = {
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          limit: vi.fn().mockResolvedValue({
            data: null,
            error: { message: `Connection timeout with auth token ${sensitiveToken}` },
          }),
        })),
      })),
    };

    setAdminSupabaseClient(mockClient);
    vi.spyOn(dailyScanPersistenceService, "isDatabaseConfigured").mockReturnValue(true);

    const res = await app.inject({
      method: "GET",
      url: "/health/persistence",
    });

    expect(res.statusCode).toBe(503);
    const body = res.json();
    expect(body.configured).toBe(true);
    expect(body.reachable).toBe(false);
    expect(body.mode).toBe("supabase");
    expect(body.error).toBeDefined();
    // Verify credential redaction
    expect(body.error).not.toContain(sensitiveToken);
    expect(body.error).toContain("[REDACTED_JWT]");
  });

  it("5. GET /api/indian/swing/persistence-health returns 200 with matching diagnostics", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/indian/swing/persistence-health",
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.mode).toBe("in-memory");
    expect(body.configured).toBe(false);
  });
});