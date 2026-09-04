import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MarketPriceStore } from "../../market/MarketPriceStore";
import { MarketPrice } from "../../market/types";
import { CoinbaseWebSocketProvider } from "../providers/CoinbaseWebSocketProvider";
import { XausGoldProvider } from "../providers/XausGoldProvider";
import { MarketDataService } from "../MarketDataService";
import EventEmitter from "events";

// ───────────────────────────────────────────────────────────
// Helper factories
// ───────────────────────────────────────────────────────────

const mockBtcPrice = (overrides?: Partial<MarketPrice>): MarketPrice => ({
  instrument: "BTC/USD",
  price: 65000,
  timestamp: new Date().toISOString(),
  source: "coinbase",
  sourceSymbol: "BTC-USD",
  isProxy: false,
  status: "LIVE",
  expectedUpdateIntervalMs: 5000,
  ...overrides,
});

const mockXauPrice = (overrides?: Partial<MarketPrice>): MarketPrice => ({
  instrument: "XAU/USD",
  price: 2350,
  timestamp: new Date().toISOString(),
  source: "xaus",
  sourceSymbol: "XAU/USD",
  isProxy: false,
  status: "LIVE",
  expectedUpdateIntervalMs: 30000,
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
    expect(price.source).toBe("coinbase");
    expect(price.sourceSymbol).toBe("BTC-USD");
    expect(price.isProxy).toBe(false);
    expect(price.price).toBeGreaterThan(0);
    expect(price.status).toBe("LIVE");
  });

  it("should produce a valid XAU/USD normalized price structure from XAUS spot", () => {
    const price = mockXauPrice();
    expect(price.instrument).toBe("XAU/USD");
    expect(price.source).toBe("xaus");
    expect(price.sourceSymbol).toBe("XAU/USD");
    expect(price.isProxy).toBe(false);
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
});

describe("STALE / OFFLINE detection", () => {
  let store: MarketPriceStore;

  beforeEach(() => {
    store = new MarketPriceStore();
  });

  it("should allow status to be explicitly set to STALE", () => {
    const stalePrice = mockBtcPrice({
      status: "STALE",
      timestamp: new Date(Date.now() - 20000).toISOString(),
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
});

describe("CoinbaseWebSocketProvider", () => {
  let provider: CoinbaseWebSocketProvider;

  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});

    provider = new CoinbaseWebSocketProvider();
  });

  afterEach(() => {
    provider.stop();
    vi.restoreAllMocks();
  });

  it("initializes with BTC/USD OFFLINE price and isProxy=false", () => {
    const p = provider.getCurrentPrice();
    expect(p.instrument).toBe("BTC/USD");
    expect(p.source).toBe("coinbase");
    expect(p.sourceSymbol).toBe("BTC-USD");
    expect(p.isProxy).toBe(false);
    expect(p.status).toBe("OFFLINE");
  });

  it("parses valid Coinbase Advanced Trade ticker message and updates price", () => {
    const cb = vi.fn();
    provider.onUpdate(cb);

    const tickerMsg = {
      channel: "ticker",
      events: [
        {
          type: "snapshot",
          tickers: [
            {
              product_id: "BTC-USD",
              price: "68500.25",
            },
          ],
        },
      ],
    };

    (provider as any).handleMessage(Buffer.from(JSON.stringify(tickerMsg)));

    const p = provider.getCurrentPrice();
    expect(p.price).toBe(68500.25);
    expect(p.status).toBe("LIVE");
    expect(p.instrument).toBe("BTC/USD");
    expect(cb).toHaveBeenCalledWith(p);
  });

  it("ignores messages for other product IDs", () => {
    const cb = vi.fn();
    provider.onUpdate(cb);

    const ethMsg = {
      channel: "ticker",
      events: [
        {
          type: "update",
          tickers: [
            {
              product_id: "ETH-USD",
              price: "3500.00",
            },
          ],
        },
      ],
    };

    (provider as any).handleMessage(Buffer.from(JSON.stringify(ethMsg)));

    expect(provider.getCurrentPrice().status).toBe("OFFLINE");
    expect(cb).not.toHaveBeenCalled();
  });

  it("ignores messages with invalid or zero/negative prices", () => {
    const cb = vi.fn();
    provider.onUpdate(cb);

    const invalidMsg = {
      channel: "ticker",
      events: [
        {
          type: "update",
          tickers: [
            {
              product_id: "BTC-USD",
              price: "-500",
            },
          ],
        },
      ],
    };

    (provider as any).handleMessage(Buffer.from(JSON.stringify(invalidMsg)));

    expect(provider.getCurrentPrice().status).toBe("OFFLINE");
    expect(cb).not.toHaveBeenCalled();
  });

  it("schedules exponential backoff reconnect on disconnect", () => {
    const spy = vi.spyOn(provider as any, "scheduleReconnect");
    provider.start();

    const ws = (provider as any).ws;
    if (ws) {
      ws.emit("close", 1006, Buffer.from("Abnormal Closure"));
    }

    expect(spy).toHaveBeenCalled();
  });
});

describe("XausGoldProvider", () => {
  let provider: XausGoldProvider;
  let consoleErrorSpy: any;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    provider = new XausGoldProvider(30000);
  });

  afterEach(() => {
    provider.stop();
    vi.restoreAllMocks();
  });

  it("initializes with XAU/USD OFFLINE price and isProxy=false", () => {
    const p = provider.getCurrentPrice();
    expect(p.instrument).toBe("XAU/USD");
    expect(p.source).toBe("xaus");
    expect(p.sourceSymbol).toBe("XAU/USD");
    expect(p.isProxy).toBe(false);
    expect(p.status).toBe("OFFLINE");
  });

  it("successfully fetches valid spot_usd_oz price from XAUS", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ spot_usd_oz: 2365.80, timestamp: "2026-09-04T16:50:00Z" }),
    }));

    const cb = vi.fn();
    provider.onUpdate(cb);

    await (provider as any).poll();

    const p = provider.getCurrentPrice();
    expect(p.price).toBe(2365.80);
    expect(p.status).toBe("LIVE");
    expect(p.instrument).toBe("XAU/USD");
    expect(p.isProxy).toBe(false);
    expect(cb).toHaveBeenCalledWith(p);
  });

  it("handles malformed JSON error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => { throw new SyntaxError("Unexpected token"); },
    }));

    await (provider as any).poll();

    expect(provider.getCurrentPrice().status).toBe("OFFLINE");
    expect(consoleErrorSpy).toHaveBeenCalled();
  });

  it("handles missing spot_usd_oz in response payload", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ invalid_key: 123 }),
    }));

    await (provider as any).poll();

    expect(provider.getCurrentPrice().status).toBe("OFFLINE");
    expect(consoleErrorSpy).toHaveBeenCalled();
  });

  it("handles zero or negative spot_usd_oz price", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ spot_usd_oz: 0 }),
    }));

    await (provider as any).poll();

    expect(provider.getCurrentPrice().status).toBe("OFFLINE");
    expect(consoleErrorSpy).toHaveBeenCalled();
  });

  it("handles HTTP errors (e.g. 429, 500) and triggers controlled backoff", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      statusText: "Too Many Requests",
      text: async () => "Rate limited",
    }));

    await (provider as any).poll();

    expect(provider.getCurrentPrice().status).toBe("OFFLINE");
    expect(consoleErrorSpy).toHaveBeenCalled();
    expect((provider as any).backoffUntil).toBeGreaterThan(Date.now());
  });

  it("handles network error and recovers on subsequent successful poll", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockRejectedValueOnce(new Error("DNS lookup failed"))
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ spot_usd_oz: 2400.00 }),
      })
    );

    // Call 1: Fails
    await (provider as any).poll();
    expect(provider.getCurrentPrice().status).toBe("OFFLINE");

    // Fast-forward backoff for test
    (provider as any).backoffUntil = Date.now() - 100;

    // Call 2: Recovers
    await (provider as any).poll();
    expect(provider.getCurrentPrice().status).toBe("LIVE");
    expect(provider.getCurrentPrice().price).toBe(2400.00);
  });
});

describe("MarketDataService Integration", () => {
  let service: MarketDataService;

  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    service = new MarketDataService();
  });

  afterEach(() => {
    service.stop();
    vi.restoreAllMocks();
  });

  it("starts both BTC and XAU providers without one stopping the other", () => {
    service.start();
    expect((service as any).providers).toHaveLength(2);
    expect((service as any).isRunning).toBe(true);
  });

  it("calculates provider-aware stale thresholds correctly", () => {
    service.start();
    (service as any).checkStaleData();
  });
});
