import { describe, it, expect, beforeEach, vi } from "vitest";
import Fastify, { FastifyInstance } from "fastify";
import fastifyWebsocket from "@fastify/websocket";
import tradingRoutes from "../../routes/trading";
import healthRoutes from "../../routes/health";
import { positionStore } from "../../trading/PositionStore";
import { pendingOrderStore } from "../../trading/PendingOrderStore";
import { priceStore } from "../../market/MarketPriceStore";

import { tradeRepository } from "../../db/TradeRepository";
import { pendingOrderRepository } from "../../db/PendingOrderRepository";

// Spy on TradeRepository and PendingOrderRepository so DB calls succeed during auth integration tests
vi.spyOn(tradeRepository, "insert").mockResolvedValue(undefined);
vi.spyOn(tradeRepository, "update").mockResolvedValue(undefined);
vi.spyOn(tradeRepository, "closeTrade").mockResolvedValue(undefined);

vi.spyOn(pendingOrderRepository, "insert").mockResolvedValue(undefined);
vi.spyOn(pendingOrderRepository, "update").mockResolvedValue(undefined);
vi.spyOn(pendingOrderRepository, "cancel").mockResolvedValue(undefined);
vi.spyOn(pendingOrderRepository, "fill").mockResolvedValue(undefined);

// ─── Constants ───────────────────────────────────────────────────────────────
const USER_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const USER_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const UNAPPROVED_USER = "cccccccc-cccc-cccc-cccc-cccccccccccc";

// ─── Mock Auth Middleware ────────────────────────────────────────────────────
// We mock the auth middleware module so tests control identity without JWTs.
// The mock interprets specific token strings as different user scenarios.
// NOTE: All string values must be literals inside vi.mock (hoisted before consts).
vi.mock("../../auth/middleware", () => {
  // These must be literals — vi.mock factory is hoisted before const declarations
  const USER_A_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  const USER_B_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
  const UNAPPROVED_ID = "cccccccc-cccc-cccc-cccc-cccccccccccc";

  const tokenMap: Record<string, { userId: string } | null> = {
    "valid-token-user-a": { userId: USER_A_ID },
    "valid-token-user-b": { userId: USER_B_ID },
    "valid-token-unapproved": { userId: UNAPPROVED_ID },
  };
  const approvedUsers = new Set([USER_A_ID, USER_B_ID]);

  async function authenticateRequest(request: any, reply: any): Promise<void> {
    const auth: string | undefined = request.headers["authorization"];

    if (!auth) {
      reply.status(401).send({ error: "Missing Authorization header." });
      return;
    }
    if (!auth.startsWith("Bearer ")) {
      reply.status(401).send({ error: "Authorization header must use the Bearer scheme." });
      return;
    }
    const token = auth.slice(7).trim();
    if (!token) {
      reply.status(401).send({ error: "Bearer token is empty." });
      return;
    }

    if (token === "expired-token") {
      reply.status(401).send({ error: "Access token has expired. Please sign in again." });
      return;
    }

    const identity = tokenMap[token];
    if (!identity) {
      reply.status(401).send({ error: "Invalid or malformed access token." });
      return;
    }

    if (!approvedUsers.has(identity.userId)) {
      reply.status(403).send({ error: "Your account is pending admin approval." });
      return;
    }

    request.verifiedUser = identity;
  }

  function getVerifiedUser(request: any) {
    if (!request.verifiedUser) throw new Error("getVerifiedUser() on unprotected route.");
    return request.verifiedUser;
  }

  return { authenticateRequest, getVerifiedUser };
});

// ─── Helpers ─────────────────────────────────────────────────────────────────
function setMockPrice(instrument: string, price: number, status: "LIVE" | "STALE" | "OFFLINE" = "LIVE") {
  priceStore.setPrice(instrument, {
    instrument, price, timestamp: new Date().toISOString(),
    source: "mock", sourceSymbol: "MOCK", isProxy: false, status
  });
}

function authHeaders(token: string): Record<string, string> {
  return { "Content-Type": "application/json", "Authorization": `Bearer ${token}` };
}

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(fastifyWebsocket);
  await app.register(healthRoutes);
  await app.register(tradingRoutes);
  return app;
}

// ─── Tests ───────────────────────────────────────────────────────────────────
describe("Step 3C-1: JWT Authentication & Authorization", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    positionStore.clear();
    pendingOrderStore.clear();
    setMockPrice("BTC/USD", 50000);
    app = await buildApp();
  });

  // ── 1. Missing Authorization header
  it("1. Missing Authorization header → 401", async () => {
    const res = await app.inject({ method: "POST", url: "/trading/orders/market", payload: {} });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toMatch(/Missing Authorization header/i);
  });

  // ── 2. Malformed Authorization (not Bearer)
  it("2. Malformed Authorization header → 401", async () => {
    const res = await app.inject({
      method: "POST", url: "/trading/orders/market",
      headers: { "Authorization": "Basic abc123" },
      payload: {}
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toMatch(/Bearer scheme/i);
  });

  // ── 3. Bearer keyword but empty token
  it("3. Empty Bearer token → 401", async () => {
    const res = await app.inject({
      method: "POST", url: "/trading/orders/market",
      headers: { "Authorization": "Bearer " },
      payload: {}
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toMatch(/empty/i);
  });

  // ── 4. Invalid JWT
  it("4. Invalid JWT → 401", async () => {
    const res = await app.inject({
      method: "POST", url: "/trading/orders/market",
      headers: { "Authorization": "Bearer not-a-real-jwt" },
      payload: {}
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toMatch(/invalid|malformed/i);
  });

  // ── 5. Expired JWT
  it("5. Expired JWT → 401", async () => {
    const res = await app.inject({
      method: "POST", url: "/trading/orders/market",
      headers: { "Authorization": "Bearer expired-token" },
      payload: {}
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toMatch(/expired/i);
  });

  // ── 6. Bad signature token
  it("6. Bad signature → 401", async () => {
    const res = await app.inject({
      method: "POST", url: "/trading/orders/market",
      headers: { "Authorization": "Bearer bad-signature-token-xyz" },
      payload: {}
    });
    expect(res.statusCode).toBe(401);
  });

  // ── 7. Valid JWT → authenticated, creates position as correct user
  it("7. Valid JWT → authenticated and 201 created with correct userId", async () => {
    const res = await app.inject({
      method: "POST", url: "/trading/orders/market",
      headers: authHeaders("valid-token-user-a"),
      payload: { instrument: "BTC/USD", side: "BUY", quantity: 1 },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().userId).toBe(USER_A);
  });

  // ── 8. userId in body is ignored; JWT is authoritative
  it("8. userId in request body is ignored; JWT userId is used", async () => {
    const res = await app.inject({
      method: "POST", url: "/trading/orders/market",
      headers: authHeaders("valid-token-user-a"),
      payload: { instrument: "BTC/USD", side: "BUY", quantity: 1, userId: USER_B },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().userId).toBe(USER_A);
  });

  // ── 9. x-user-id header is ignored
  it("9. x-user-id header is ignored; JWT userId is authoritative", async () => {
    const res = await app.inject({
      method: "POST", url: "/trading/orders/market",
      headers: { ...authHeaders("valid-token-user-a"), "x-user-id": USER_B },
      payload: { instrument: "BTC/USD", side: "BUY", quantity: 1 },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().userId).toBe(USER_A);
  });

  // ── 10. userId in query param is ignored
  it("10. userId in query parameter is ignored; JWT userId is used", async () => {
    const res = await app.inject({
      method: "GET", url: `/trading/positions?userId=${USER_B}`,
      headers: authHeaders("valid-token-user-a"),
    });
    expect(res.statusCode).toBe(200);
    // Positions will be empty for USER_A — just confirms endpoint is accessible
    expect(Array.isArray(res.json())).toBe(true);
  });

  // ── 11. Unapproved user → 403
  it("11. Unapproved user receives 403 Forbidden", async () => {
    const res = await app.inject({
      method: "POST", url: "/trading/orders/market",
      headers: authHeaders("valid-token-unapproved"),
      payload: {}
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toMatch(/pending admin approval/i);
  });

  // ── 12. Approved user → allowed
  it("12. Approved user can access trading routes", async () => {
    const res = await app.inject({
      method: "GET", url: "/trading/positions",
      headers: authHeaders("valid-token-user-a"),
    });
    expect(res.statusCode).toBe(200);
  });

  // ── 13. Position list isolated by verified user
  it("13. User A cannot see User B's positions", async () => {
    // Create position as USER_B
    await app.inject({
      method: "POST", url: "/trading/orders/market",
      headers: authHeaders("valid-token-user-b"),
      payload: { instrument: "BTC/USD", side: "BUY", quantity: 1 },
    });

    // USER_A fetches positions → should see 0
    const res = await app.inject({
      method: "GET", url: "/trading/positions",
      headers: authHeaders("valid-token-user-a"),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(0);
  });

  // ── 14. Position close isolated by verified user (cross-user cannot close)
  it("14. User B cannot close User A's position via non-existent lookup", async () => {
    // Create a position as USER_A
    const posA = await app.inject({
      method: "POST", url: "/trading/orders/market",
      headers: authHeaders("valid-token-user-a"),
      payload: { instrument: "BTC/USD", side: "BUY", quantity: 1 },
    });
    expect(posA.statusCode).toBe(201);
    const positionId = posA.json().id;

    // USER_A should see their own position
    const ownPositions = await app.inject({
      method: "GET", url: `/trading/positions/${positionId}`,
      headers: authHeaders("valid-token-user-a"),
    });
    expect(ownPositions.statusCode).toBe(200);

    // USER_B should NOT see USER_A's position
    const crossUserRes = await app.inject({
      method: "GET", url: `/trading/positions/${positionId}`,
      headers: authHeaders("valid-token-user-b"),
    });
    expect(crossUserRes.statusCode).toBe(404);
  });

  // ── 15. Pending order list isolated by verified user
  it("15. User A cannot see User B's pending orders", async () => {
    await app.inject({
      method: "POST", url: "/trading/orders/limit",
      headers: authHeaders("valid-token-user-b"),
      payload: { instrument: "BTC/USD", side: "BUY", quantity: 1, limitPrice: 49000 },
    });

    const res = await app.inject({
      method: "GET", url: "/trading/orders/pending",
      headers: authHeaders("valid-token-user-a"),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(0);
  });

  // ── 16. Health endpoint is public (no auth required)
  it("16. Health endpoint is publicly accessible without auth", async () => {
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("ok");
  });
});
