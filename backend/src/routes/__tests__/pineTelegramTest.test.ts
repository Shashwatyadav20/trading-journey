import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify, { FastifyInstance } from "fastify";
import pineRoutes from "../pine";

vi.mock("../../auth/middleware", () => {
  return {
    authenticateRequest: async (request: any, reply: any) => {
      const auth = request.headers["authorization"];
      if (!auth || !auth.startsWith("Bearer ")) {
        reply.status(401).send({ error: "Missing Authorization header." });
        return;
      }
      request.verifiedUser = { userId: "test-user-id" };
    },
    getVerifiedUser: (request: any) => request.verifiedUser,
  };
});

vi.mock("../../alerts/telegram/TelegramClient", () => {
  return {
    isTelegramConfigured: () => true,
    sendTelegramMessage: async (text: string) => ({ sent: true }),
  };
});

describe("Pine Telegram Test Route Verification", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = Fastify({ logger: false });
    await app.register(pineRoutes);
  });

  it("1. GET request to /pine/telegram/test with Bearer token → 200 OK", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/pine/telegram/test",
      headers: {
        authorization: "Bearer valid-token",
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ sent: true, configured: true });
  });

  it("2. POST request to /pine/telegram/test with payload {} → 200 OK", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/pine/telegram/test",
      headers: {
        authorization: "Bearer valid-token",
        "content-type": "application/json",
      },
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ sent: true, configured: true });
  });

  it("3. POST request to /pine/telegram/test with Content-Type: application/json and empty body → 200 OK", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/pine/telegram/test",
      headers: {
        authorization: "Bearer valid-token",
        "content-type": "application/json",
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ sent: true, configured: true });
  });

  it("4. POST request without content-type / empty payload → 200 OK", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/pine/telegram/test",
      headers: {
        authorization: "Bearer valid-token",
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ sent: true, configured: true });
  });

  it("5. Unauthenticated GET request → 401 Unauthorized", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/pine/telegram/test",
    });
    expect(res.statusCode).toBe(401);
  });

  it("6. Unauthenticated POST request → 401 Unauthorized", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/pine/telegram/test",
    });
    expect(res.statusCode).toBe(401);
  });
});
