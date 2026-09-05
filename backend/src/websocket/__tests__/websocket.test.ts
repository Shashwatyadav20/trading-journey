import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify, { FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import fastifyWebsocket from "@fastify/websocket";
import WebSocket from "ws";
import websocketRoutes from "../market";
import { priceStore } from "../../market/MarketPriceStore";
import { env } from "../../config/env";

describe("WebSocket Market Data Route (/ws/market)", () => {
  let server: FastifyInstance;
  let serverUrl: string;

  beforeEach(async () => {
    server = Fastify({ logger: false });

    // CORS configuration mirroring server.ts
    server.register(cors, {
      origin: (origin, cb) => {
        if (!origin) return cb(null, true);
        const allowedOrigins = (env.FRONTEND_URL || "")
          .split(",")
          .map((o) => o.trim().replace(/\/$/, ""));

        const cleanOrigin = origin.replace(/\/$/, "");

        if (
          env.NODE_ENV === "development" ||
          allowedOrigins.includes(cleanOrigin) ||
          cleanOrigin.endsWith(".vercel.app") ||
          cleanOrigin.startsWith("http://localhost:") ||
          cleanOrigin.startsWith("http://127.0.0.1:")
        ) {
          return cb(null, true);
        }
        return cb(new Error("Not allowed by CORS"), false);
      },
    });

    server.register(fastifyWebsocket);
    server.register(websocketRoutes);

    const address = await server.listen({ port: 0, host: "127.0.0.1" });
    const port = (server.server.address() as any).port;
    serverUrl = `ws://127.0.0.1:${port}/ws/market`;
  });

  afterEach(async () => {
    await server.close();
  });

  it("successfully connects and receives initial price snapshot", async () => {
    const mockPrice = {
      instrument: "BTC/USD",
      price: 65000,
      timestamp: new Date().toISOString(),
      source: "coinbase",
      sourceSymbol: "BTC-USD",
      isProxy: false,
      status: "LIVE" as const,
      expectedUpdateIntervalMs: 5000,
    };
    priceStore.setPrice("BTC/USD", mockPrice);

    const client = new WebSocket(serverUrl);

    const receivedMessages: any[] = [];
    await new Promise<void>((resolve, reject) => {
      client.on("open", () => {});
      client.on("message", (data) => {
        const msg = JSON.parse(data.toString());
        receivedMessages.push(msg);
        if (msg.type === "priceUpdate") {
          client.close();
          resolve();
        }
      });
      client.on("error", (err) => reject(err));
    });

    expect(receivedMessages.length).toBeGreaterThan(0);
    expect(receivedMessages[0].type).toBe("priceUpdate");
    expect(receivedMessages[0].data.instrument).toBe("BTC/USD");
    expect(receivedMessages[0].data.price).toBe(65000);
  });

  it("allows connection from Vercel origins (.vercel.app)", async () => {
    const client = new WebSocket(serverUrl, {
      headers: { Origin: "https://trading-journey-three.vercel.app" },
    });

    await new Promise<void>((resolve, reject) => {
      client.on("open", () => {
        client.close();
        resolve();
      });
      client.on("error", (err) => reject(err));
    });
  });

  it("streams real-time price updates when MarketPriceStore updates", async () => {
    const client = new WebSocket(serverUrl);

    const messages: any[] = [];

    await new Promise<void>((resolve, reject) => {
      client.on("open", () => {
        // Emit new price update after connected
        priceStore.setPrice("XAU/USD", {
          instrument: "XAU/USD",
          price: 2450.5,
          timestamp: new Date().toISOString(),
          source: "xaus",
          sourceSymbol: "XAU/USD",
          isProxy: false,
          status: "LIVE",
          expectedUpdateIntervalMs: 30000,
        });
      });

      client.on("message", (data) => {
        const msg = JSON.parse(data.toString());
        messages.push(msg);
        if (msg.data && msg.data.instrument === "XAU/USD") {
          client.close();
          resolve();
        }
      });

      client.on("error", (err) => reject(err));
    });

    const xauMsg = messages.find((m) => m.data?.instrument === "XAU/USD");
    expect(xauMsg).toBeDefined();
    expect(xauMsg.data.price).toBe(2450.5);
  });
});
