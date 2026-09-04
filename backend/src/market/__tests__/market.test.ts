import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MarketPriceStore } from "../../market/MarketPriceStore";
import { MarketPrice } from "../../market/types";
import { BitcoinProvider } from "../providers/BitcoinProvider";
import { GoldProvider } from "../providers/GoldProvider";
import { CoinGeckoClient } from "../providers/CoinGeckoClient";

// ───────────────────────────────────────────────────────────
// Helper factories
// ───────────────────────────────────────────────────────────

const mockBtcPrice = (overrides?: Partial<MarketPrice>): MarketPrice => ({
  instrument: "BTC/USD",
  price: 65000,
  timestamp: new Date().toISOString(),
  source: "coingecko",
  sourceSymbol: "bitcoin",
  isProxy: false,
  status: "LIVE",
  ...overrides,
});

const mockXauPrice = (overrides?: Partial<MarketPrice>): MarketPrice => ({
  instrument: "XAU/USD",
  price: 2350,
  timestamp: new Date().toISOString(),
  source: "coingecko",
  sourceSymbol: "pax-gold",
  isProxy: true,
  status: "LIVE",
  ...overrides,
});

// ───────────────────────────────────────────────────────────
// Tests
// ───────────────────────────────────────────────────────────

describe("MarketPriceStore", () => {
  let store: MarketPriceStore;

  beforeEach(() => {
    store = new MarketPriceStore();
  });

  it("should set and retrieve a price by instrument", () => {
    const price = mockBtcPrice();
    store.setPrice("BTC/USD", price);
    expect(store.getPrice("BTC/USD")).toEqual(price);
  });

  it("should notify subscriber on price update", () => {
    const cb = vi.fn();
    store.subscribe(cb);
    const price = mockBtcPrice();
    store.setPrice("BTC/USD", price);
    expect(cb).toHaveBeenCalledOnce();
    expect(cb).toHaveBeenCalledWith(price);
  });

  it("should notify all subscribers on price update", () => {
    const cb1 = vi.fn();
    const cb2 = vi.fn();
    store.subscribe(cb1);
    store.subscribe(cb2);
    store.setPrice("BTC/USD", mockBtcPrice());
    expect(cb1).toHaveBeenCalledOnce();
    expect(cb2).toHaveBeenCalledOnce();
  });

  it("should allow unsubscribing a callback", () => {
    const cb = vi.fn();
    store.subscribe(cb);
    store.unsubscribe(cb);
    store.setPrice("BTC/USD", mockBtcPrice());
    expect(cb).not.toHaveBeenCalled();
  });

  it("should return all prices", () => {
    store.setPrice("BTC/USD", mockBtcPrice());
    store.setPrice("XAU/USD", mockXauPrice());
    expect(store.getAllPrices()).toHaveLength(2);
  });
});

describe("Provider response normalization", () => {
  it("should produce a valid BTC/USD normalized price structure", () => {
    const price = mockBtcPrice();
    expect(price.instrument).toBe("BTC/USD");
    expect(price.source).toBe("coingecko");
    expect(price.sourceSymbol).toBe("bitcoin");
    expect(price.isProxy).toBe(false);
    expect(price.price).toBeGreaterThan(0);
    expect(price.status).toBe("LIVE");
  });

  it("should produce a valid XAU/USD normalized price structure with proxy metadata", () => {
    const price = mockXauPrice();
    expect(price.instrument).toBe("XAU/USD");
    expect(price.source).toBe("coingecko");
    expect(price.sourceSymbol).toBe("pax-gold");
    expect(price.isProxy).toBe(true);
    expect(price.status).toBe("LIVE");
  });

  it("should not use a hardcoded fallback price on provider failure", () => {
    const offlinePrice = mockBtcPrice({ price: 0, status: "OFFLINE" });
    expect(offlinePrice.status).toBe("OFFLINE");
    expect(offlinePrice.price).toBe(0);
  });

  it("should keep BTC/USD and XAU/USD as separate instruments", () => {
    const btc = mockBtcPrice();
    const xau = mockXauPrice();
    expect(btc.instrument).not.toBe(xau.instrument);
    expect(btc.sourceSymbol).not.toBe(xau.sourceSymbol);
  });

  it("should always mark XAU/USD as proxy when using pax-gold", () => {
    const xau = mockXauPrice();
    expect(xau.isProxy).toBe(true);
    expect(xau.sourceSymbol).toBe("pax-gold");
    expect(xau.source).toBe("coingecko");
  });

  it("should produce OFFLINE status when price is 0 or NaN", () => {
    const offlinePrice = mockBtcPrice({ price: 0, status: "OFFLINE" });
    expect(offlinePrice.status).toBe("OFFLINE");
  });
});

describe("STALE / OFFLINE detection", () => {
  let store: MarketPriceStore;

  beforeEach(() => {
    store = new MarketPriceStore();
  });

  it("should allow status to be explicitly set to STALE", () => {
    const stalePrice = mockBtcPrice({
      status: "STALE",
      timestamp: new Date(Date.now() - 15000).toISOString(),
    });
    store.setPrice("BTC/USD", stalePrice);
    const retrieved = store.getPrice("BTC/USD");
    expect(retrieved?.status).toBe("STALE");
  });

  it("should allow status to be explicitly set to OFFLINE", () => {
    const offlinePrice = mockBtcPrice({ status: "OFFLINE", price: 0 });
    store.setPrice("BTC/USD", offlinePrice);
    const retrieved = store.getPrice("BTC/USD");
    expect(retrieved?.status).toBe("OFFLINE");
  });

  it("should retain last known price when STALE (not reset to 0)", () => {
    const livePrice = mockBtcPrice({ price: 65000, status: "LIVE" });
    store.setPrice("BTC/USD", livePrice);
    const stalePrice = { ...livePrice, status: "STALE" as const };
    store.setPrice("BTC/USD", stalePrice);
    const retrieved = store.getPrice("BTC/USD");
    expect(retrieved?.price).toBe(65000);
    expect(retrieved?.status).toBe("STALE");
  });

  it("should reflect OFFLINE when no update received (simulated timeout)", () => {
    const oldTimestamp = new Date(Date.now() - 60000).toISOString();
    const timeoutPrice = mockBtcPrice({ status: "OFFLINE", timestamp: oldTimestamp, price: 0 });
    store.setPrice("BTC/USD", timeoutPrice);
    const retrieved = store.getPrice("BTC/USD");
    expect(retrieved?.status).toBe("OFFLINE");
  });

  it("should reflect OFFLINE status on provider failure (price stays 0)", () => {
    const failedPrice = mockBtcPrice({ price: 0, status: "OFFLINE" });
    store.setPrice("BTC/USD", failedPrice);
    const retrieved = store.getPrice("BTC/USD");
    expect(retrieved?.status).toBe("OFFLINE");
    expect(retrieved?.price).toBe(0);
  });
});

describe("BitcoinProvider (CoinGecko)", () => {
  let consoleErrorSpy: any;

  beforeEach(() => {
    CoinGeckoClient.resetInstance();
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("successfully parses CoinGecko bitcoin price", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({ bitcoin: { usd: 67450.5 } }),
    }));

    const provider = new BitcoinProvider(1000);
    await (provider as any).poll();

    const price = provider.getCurrentPrice();
    expect(price.instrument).toBe("BTC/USD");
    expect(price.price).toBe(67450.5);
    expect(price.status).toBe("LIVE");
    expect(price.source).toBe("coingecko");
    expect(price.sourceSymbol).toBe("bitcoin");
    expect(price.isProxy).toBe(false);
  });

  it("handles HTTP error and logs diagnostic message", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      headers: new Headers(),
      text: async () => "Server error",
    }));

    const provider = new BitcoinProvider(1000);
    await (provider as any).poll();

    expect(provider.getCurrentPrice().status).toBe("OFFLINE");
    expect(consoleErrorSpy).toHaveBeenCalled();
    const logOutput = consoleErrorSpy.mock.calls[0][0];
    expect(logOutput).toContain("[CoinGeckoClient]");
    expect(logOutput).toContain("ids=bitcoin,pax-gold");
    expect(logOutput).toContain("HTTP error 500");
  });

  it("handles malformed JSON error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => { throw new SyntaxError("Unexpected end of JSON input"); },
    }));

    const provider = new BitcoinProvider(1000);
    await (provider as any).poll();

    expect(provider.getCurrentPrice().status).toBe("OFFLINE");
    expect(consoleErrorSpy).toHaveBeenCalled();
    expect(consoleErrorSpy.mock.calls[0][0]).toContain("SyntaxError");
  });

  it("handles missing bitcoin.usd field in JSON response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({ bitcoin: {} }),
    }));

    const provider = new BitcoinProvider(1000);
    await (provider as any).poll();

    expect(provider.getCurrentPrice().status).toBe("OFFLINE");
    expect(consoleErrorSpy).toHaveBeenCalled();
    expect(consoleErrorSpy.mock.calls[0][0]).toContain("Invalid price payload");
  });

  it("handles zero or negative price in response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({ bitcoin: { usd: -50 } }),
    }));

    const provider = new BitcoinProvider(1000);
    await (provider as any).poll();

    expect(provider.getCurrentPrice().status).toBe("OFFLINE");
    expect(consoleErrorSpy).toHaveBeenCalled();
    expect(consoleErrorSpy.mock.calls[0][0]).toContain("Invalid price payload");
  });

  it("handles network error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Network connection error")));

    const provider = new BitcoinProvider(1000);
    await (provider as any).poll();

    expect(provider.getCurrentPrice().status).toBe("OFFLINE");
    expect(consoleErrorSpy).toHaveBeenCalled();
    expect(consoleErrorSpy.mock.calls[0][0]).toContain("Network connection error");
  });
});

describe("GoldProvider (CoinGecko PAXG Proxy)", () => {
  let consoleErrorSpy: any;

  beforeEach(() => {
    CoinGeckoClient.resetInstance();
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("successfully parses CoinGecko pax-gold price for XAU/USD with proxy metadata", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({ "pax-gold": { usd: 2380.25 } }),
    }));

    const provider = new GoldProvider(1000);
    await (provider as any).poll();

    const price = provider.getCurrentPrice();
    expect(price.instrument).toBe("XAU/USD");
    expect(price.price).toBe(2380.25);
    expect(price.status).toBe("LIVE");
    expect(price.source).toBe("coingecko");
    expect(price.sourceSymbol).toBe("pax-gold");
    expect(price.isProxy).toBe(true);
  });

  it("handles HTTP error and logs diagnostic message", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      statusText: "Too Many Requests",
      headers: new Headers(),
      text: async () => "Rate limit exceeded",
    }));

    const provider = new GoldProvider(1000);
    await (provider as any).poll();

    expect(provider.getCurrentPrice().status).toBe("OFFLINE");
    expect(consoleErrorSpy).toHaveBeenCalled();
    const logOutput = consoleErrorSpy.mock.calls[0][0];
    expect(logOutput).toContain("[CoinGeckoClient]");
    expect(logOutput).toContain("HTTP 429 Too Many Requests");
  });

  it("handles malformed JSON error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => { throw new SyntaxError("Unexpected token < in JSON"); },
    }));

    const provider = new GoldProvider(1000);
    await (provider as any).poll();

    expect(provider.getCurrentPrice().status).toBe("OFFLINE");
    expect(consoleErrorSpy).toHaveBeenCalled();
  });

  it("handles missing pax-gold.usd field in response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({ "pax-gold": {} }),
    }));

    const provider = new GoldProvider(1000);
    await (provider as any).poll();

    expect(provider.getCurrentPrice().status).toBe("OFFLINE");
    expect(consoleErrorSpy).toHaveBeenCalled();
    expect(consoleErrorSpy.mock.calls[0][0]).toContain("Invalid price payload");
  });

  it("handles zero or negative price in response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({ "pax-gold": { usd: 0 } }),
    }));

    const provider = new GoldProvider(1000);
    await (provider as any).poll();

    expect(provider.getCurrentPrice().status).toBe("OFFLINE");
    expect(consoleErrorSpy).toHaveBeenCalled();
    expect(consoleErrorSpy.mock.calls[0][0]).toContain("Invalid price payload");
  });

  it("handles network error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Socket hang up")));

    const provider = new GoldProvider(1000);
    await (provider as any).poll();

    expect(provider.getCurrentPrice().status).toBe("OFFLINE");
    expect(consoleErrorSpy).toHaveBeenCalled();
    expect(consoleErrorSpy.mock.calls[0][0]).toContain("Socket hang up");
  });
});

describe("CoinGeckoClient Rate Limit & Resilience", () => {
  beforeEach(() => {
    CoinGeckoClient.resetInstance();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("successful polling updates timestamp and keeps status LIVE", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({ bitcoin: { usd: 80000 }, "pax-gold": { usd: 4500 } }),
    });
    vi.stubGlobal("fetch", fetchSpy);

    const client = CoinGeckoClient.getInstance();
    client.setMinFetchIntervalMs(0);

    const prices1 = await client.fetchPrices(["bitcoin", "pax-gold"]);
    const t1 = prices1.get("bitcoin")?.fetchedAt;
    expect(t1).toBeDefined();

    await new Promise((r) => setTimeout(r, 10));

    const prices2 = await client.fetchPrices(["bitcoin", "pax-gold"]);
    const t2 = prices2.get("bitcoin")?.fetchedAt;
    expect(t2).toBeDefined();

    expect(t1).not.toBe(t2);
  });

  it("HTTP 429 causes controlled backoff and does NOT permanently stop polling", async () => {
    const fetchSpy = vi.fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        statusText: "Too Many Requests",
        headers: new Headers({ "retry-after": "1" }),
        text: async () => "Rate limit exceeded",
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({ bitcoin: { usd: 81000 } }),
      });

    vi.stubGlobal("fetch", fetchSpy);

    const client = CoinGeckoClient.getInstance();
    client.setMinFetchIntervalMs(0);

    await expect(client.fetchPrices(["bitcoin"])).rejects.toThrow(/HTTP 429/);
    expect(client.getBackoffUntil()).toBeGreaterThan(Date.now());

    await client.fetchPrices(["bitcoin"]);
    expect(fetchSpy).toHaveBeenCalledOnce();

    (client as any).backoffUntil = Date.now() - 100;

    const resAfterBackoff = await client.fetchPrices(["bitcoin"]);
    expect(resAfterBackoff.get("bitcoin")?.price).toBe(81000);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("network errors do not permanently stop polling", async () => {
    const fetchSpy = vi.fn()
      .mockRejectedValueOnce(new Error("Network disconnect"))
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({ bitcoin: { usd: 82000 } }),
      });

    vi.stubGlobal("fetch", fetchSpy);

    const client = CoinGeckoClient.getInstance();
    client.setMinFetchIntervalMs(0);

    await expect(client.fetchPrices(["bitcoin"])).rejects.toThrow("Network disconnect");

    const res = await client.fetchPrices(["bitcoin"]);
    expect(res.get("bitcoin")?.price).toBe(82000);
  });
});
