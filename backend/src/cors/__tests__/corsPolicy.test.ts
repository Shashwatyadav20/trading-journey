/**
 * Ticket 11.2 — CORS Policy Regression Tests
 *
 * Verifies the locked-down production CORS behaviour introduced in Ticket 11.2:
 *   - Only explicitly configured FRONTEND_URL origins are allowed in production.
 *   - Arbitrary *.vercel.app preview deployments are REJECTED in production.
 *   - localhost is REJECTED in production.
 *   - Development mode continues to allow all origins.
 *
 * Tests are pure-logic unit tests (no live network calls) using the same
 * `isCorsAllowed` helper that mirrors server.ts exactly, plus live Fastify
 * integration tests exercising the actual HTTP CORS header behaviour.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify, { FastifyInstance } from "fastify";
import cors from "@fastify/cors";

// ────────────────────────────────────────────────────────────────────────────
// Pure-logic helper — mirrors server.ts CORS origin callback exactly.
// ────────────────────────────────────────────────────────────────────────────
function isCorsAllowed(
  origin: string | undefined,
  frontendUrl: string,
  nodeEnv: string
): boolean {
  if (!origin) return true; // No Origin header → always pass

  const allowedOrigins = frontendUrl
    .split(",")
    .map((o) => o.trim().replace(/\/$/, ""))
    .filter(Boolean);

  const cleanOrigin = origin.replace(/\/$/, "");

  // Development: allow everything
  if (nodeEnv === "development") return true;

  // Production: only explicitly configured origins
  return allowedOrigins.includes(cleanOrigin);
}

// ────────────────────────────────────────────────────────────────────────────
// Helper: build a minimal Fastify server with the locked-down CORS policy
// ────────────────────────────────────────────────────────────────────────────
function buildCorsServer(frontendUrl: string, nodeEnv: string): FastifyInstance {
  const server = Fastify({ logger: false });

  server.register(cors, {
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);

      const allowedOrigins = frontendUrl
        .split(",")
        .map((o) => o.trim().replace(/\/$/, ""))
        .filter(Boolean);

      const cleanOrigin = origin.replace(/\/$/, "");

      if (nodeEnv === "development") return cb(null, true);
      if (allowedOrigins.includes(cleanOrigin)) return cb(null, true);

      return cb(new Error("Not allowed by CORS"), false);
    },
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  });

  server.get("/ping", async () => ({ ok: true }));

  return server;
}

// ────────────────────────────────────────────────────────────────────────────
// 1. Pure-logic unit tests
// ────────────────────────────────────────────────────────────────────────────
describe("Ticket 11.2 — CORS Policy: Pure-Logic Unit Tests", () => {
  const PROD_ORIGIN = "https://trading-journey-three.vercel.app";
  const PROD_FRONTEND_URL = "https://trading-journey-three.vercel.app";

  // A. Exact configured production frontend origin → ALLOWED
  it("A. Exact configured production origin is allowed", () => {
    expect(isCorsAllowed(PROD_ORIGIN, PROD_FRONTEND_URL, "production")).toBe(true);
  });

  // B. Second explicitly configured production origin (comma-separated) → ALLOWED
  it("B. Second comma-separated configured origin is allowed", () => {
    const multiUrl = `${PROD_FRONTEND_URL},https://www.trading-journey.com`;
    expect(isCorsAllowed("https://www.trading-journey.com", multiUrl, "production")).toBe(true);
    // First origin still works
    expect(isCorsAllowed(PROD_ORIGIN, multiUrl, "production")).toBe(true);
  });

  // C. Arbitrary Vercel preview origin → REJECTED (key regression)
  it("C. Arbitrary *.vercel.app preview is REJECTED in production", () => {
    expect(
      isCorsAllowed("https://attacker-example.vercel.app", PROD_FRONTEND_URL, "production")
    ).toBe(false);
    expect(
      isCorsAllowed(
        "https://trading-journey-three-preview-abc123.vercel.app",
        PROD_FRONTEND_URL,
        "production"
      )
    ).toBe(false);
    expect(
      isCorsAllowed("https://malicious.vercel.app", PROD_FRONTEND_URL, "production")
    ).toBe(false);
  });

  // D. Completely unrelated origin → REJECTED
  it("D. Unrelated origin is REJECTED in production", () => {
    expect(isCorsAllowed("https://evil.example.com", PROD_FRONTEND_URL, "production")).toBe(false);
    expect(isCorsAllowed("https://phishing-site.io", PROD_FRONTEND_URL, "production")).toBe(false);
    expect(isCorsAllowed("https://malicious-site.com", PROD_FRONTEND_URL, "production")).toBe(false);
  });

  // E. localhost in production → REJECTED
  it("E. localhost origins are REJECTED in production", () => {
    expect(isCorsAllowed("http://localhost:3000", PROD_FRONTEND_URL, "production")).toBe(false);
    expect(isCorsAllowed("http://localhost:4000", PROD_FRONTEND_URL, "production")).toBe(false);
    expect(isCorsAllowed("http://127.0.0.1:3000", PROD_FRONTEND_URL, "production")).toBe(false);
    expect(isCorsAllowed("http://127.0.0.1:4000", PROD_FRONTEND_URL, "production")).toBe(false);
  });

  // F. localhost in development → ALLOWED
  it("F. localhost origins are ALLOWED in development", () => {
    expect(isCorsAllowed("http://localhost:3000", PROD_FRONTEND_URL, "development")).toBe(true);
    expect(isCorsAllowed("http://localhost:4000", PROD_FRONTEND_URL, "development")).toBe(true);
    expect(isCorsAllowed("http://127.0.0.1:3000", PROD_FRONTEND_URL, "development")).toBe(true);
    // Even arbitrary Vercel previews pass in development
    expect(
      isCorsAllowed("https://attacker-example.vercel.app", PROD_FRONTEND_URL, "development")
    ).toBe(true);
  });

  // G. Trailing slash normalization → works correctly
  it("G. Trailing-slash normalization works correctly", () => {
    // Origin with trailing slash still matches configured origin (no trailing slash)
    expect(isCorsAllowed(`${PROD_ORIGIN}/`, PROD_FRONTEND_URL, "production")).toBe(true);
    // FRONTEND_URL with trailing slash still parses correctly
    expect(isCorsAllowed(PROD_ORIGIN, `${PROD_FRONTEND_URL}/`, "production")).toBe(true);
  });

  // H. Whitespace around configured origin in FRONTEND_URL → works correctly
  it("H. Whitespace trimming works correctly for comma-separated FRONTEND_URL", () => {
    const spacedUrl = `  ${PROD_FRONTEND_URL}  `;
    expect(isCorsAllowed(PROD_ORIGIN, spacedUrl, "production")).toBe(true);

    const spacedMulti = `  ${PROD_FRONTEND_URL}  ,  https://www.trading-journey.com  `;
    expect(isCorsAllowed("https://www.trading-journey.com", spacedMulti, "production")).toBe(true);
  });

  // No origin header → always allowed (same-origin / server-to-server)
  it("No Origin header is always allowed", () => {
    expect(isCorsAllowed(undefined, PROD_FRONTEND_URL, "production")).toBe(true);
    expect(isCorsAllowed("", PROD_FRONTEND_URL, "production")).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 2. HTTP integration tests — actual Fastify CORS headers
// ────────────────────────────────────────────────────────────────────────────
describe("Ticket 11.2 — CORS Policy: HTTP Integration Tests", () => {
  const PROD_FRONTEND_URL = "https://trading-journey-three.vercel.app";
  let server: FastifyInstance;

  afterEach(async () => {
    await server.close();
  });

  it("REST: Exact configured origin receives ACAO header in production", async () => {
    server = buildCorsServer(PROD_FRONTEND_URL, "production");
    await server.ready();

    const res = await server.inject({
      method: "GET",
      url: "/ping",
      headers: { origin: PROD_FRONTEND_URL },
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers["access-control-allow-origin"]).toBe(PROD_FRONTEND_URL);
  });

  it("REST: Arbitrary Vercel preview origin is REJECTED in production (no ACAO, non-200)", async () => {
    server = buildCorsServer(PROD_FRONTEND_URL, "production");
    await server.ready();

    const res = await server.inject({
      method: "GET",
      url: "/ping",
      headers: { origin: "https://attacker-example.vercel.app" },
    });

    // Fastify/cors rejects cross-origin requests with a non-200 status code.
    // The exact code (403 or 500) may vary by @fastify/cors version.
    // The key invariant is: NOT 200 and NO Access-Control-Allow-Origin header.
    expect(res.statusCode).not.toBe(200);
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("REST: Unrelated origin is REJECTED in production (no ACAO, non-200)", async () => {
    server = buildCorsServer(PROD_FRONTEND_URL, "production");
    await server.ready();

    const res = await server.inject({
      method: "GET",
      url: "/ping",
      headers: { origin: "https://evil.example.com" },
    });

    expect(res.statusCode).not.toBe(200);
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("REST: localhost origin is REJECTED in production (no ACAO, non-200)", async () => {
    server = buildCorsServer(PROD_FRONTEND_URL, "production");
    await server.ready();

    const res = await server.inject({
      method: "GET",
      url: "/ping",
      headers: { origin: "http://localhost:3000" },
    });

    expect(res.statusCode).not.toBe(200);
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("REST: localhost origin is ALLOWED in development", async () => {
    server = buildCorsServer(PROD_FRONTEND_URL, "development");
    await server.ready();

    const res = await server.inject({
      method: "GET",
      url: "/ping",
      headers: { origin: "http://localhost:3000" },
    });

    expect(res.statusCode).toBe(200);
  });

  it("REST: Arbitrary Vercel preview is ALLOWED in development", async () => {
    server = buildCorsServer(PROD_FRONTEND_URL, "development");
    await server.ready();

    const res = await server.inject({
      method: "GET",
      url: "/ping",
      headers: { origin: "https://any-preview.vercel.app" },
    });

    expect(res.statusCode).toBe(200);
  });

  it("REST: Preflight OPTIONS for allowed origin returns correct CORS headers", async () => {
    server = buildCorsServer(PROD_FRONTEND_URL, "production");
    await server.ready();

    const res = await server.inject({
      method: "OPTIONS",
      url: "/ping",
      headers: {
        origin: PROD_FRONTEND_URL,
        "access-control-request-method": "POST",
      },
    });

    // Preflight should succeed (204 or 200)
    expect([200, 204]).toContain(res.statusCode);
    expect(res.headers["access-control-allow-origin"]).toBe(PROD_FRONTEND_URL);
  });

  it("REST: Preflight OPTIONS for rejected origin returns non-200 with no ACAO header", async () => {
    server = buildCorsServer(PROD_FRONTEND_URL, "production");
    await server.ready();

    const res = await server.inject({
      method: "OPTIONS",
      url: "/ping",
      headers: {
        origin: "https://attacker-example.vercel.app",
        "access-control-request-method": "POST",
      },
    });

    expect(res.statusCode).not.toBe(200);
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });
});
