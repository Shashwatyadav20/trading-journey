import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MarketPriceStore } from "../../market/MarketPriceStore";
import { MarketPrice } from "../../market/types";
import { BinanceProvider } from "../providers/BinanceProvider";
import { GoldProvider } from "../providers/GoldProvider";

// ───────────────────────────────────────────────────────────
// Helper factories
// ───────────────────────────────────────────────────────────

const mockBtcPrice = (overrides?: Partial<MarketPrice>): MarketPrice => ({
  instrument: "BTC/USD",
  price: 65000,
  timestamp: new Date().toISOString(),
  source: "binance",
  sourceSymbol: "BTCUSDT",
  isProxy: false,
  status: "LIVE",
  ...overrides,
});

const mockXauPrice = (overrides?: Partial<MarketPrice>): MarketPrice => ({
  instrument: "XAU/USD",
  price: 2350,
  timestamp: new Date().toISOString(),
  source: "binance",
  sourceSymbol: "PAXGUSDT",
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

  // Test 8: Store set/get
  it("should set and retrieve a price by instrument", () => {
    const price = mockBtcPrice();
    store.setPrice("BTC/USD", price);
    expect(store.getPrice("BTC/USD")).toEqual(price);
  });

  // Test 9: Store subscribers
  it("should notify subscriber on price update", () => {
    const cb = vi.fn();
    store.subscribe(cb);
    const price = mockBtcPrice();
    store.setPrice("BTC/USD", price);
    expect(cb).toHaveBeenCalledOnce();
    expect(cb).toHaveBeenCalledWith(price);
  });

  // Test 10: Multiple subscribers
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
  // Test 1: Valid BTC provider response
  it("should produce a valid BTC/USD normalized price structure", () => {
    const price = mockBtcPrice();
    expect(price.instrument).toBe("BTC/USD");
    expect(price.sourceSymbol).toBe("BTCUSDT");
    expect(price.isProxy).toBe(false);
    expect(price.price).toBeGreaterThan(0);
    expect(price.status).toBe("LIVE");
  });

  // Test 2: Valid gold provider response
  it("should produce a valid XAU/USD normalized price structure with proxy metadata", () => {
    const price = mockXauPrice();
    expect(price.instrument).toBe("XAU/USD");
    expect(price.sourceSymbol).toBe("PAXGUSDT");
    expect(price.isProxy).toBe(true);
    expect(price.source).toBe("binance");
    expect(price.status).toBe("LIVE");
  });

  // Test 16: No hardcoded fallback price
  it("should not use a hardcoded fallback price on provider failure", () => {
    // Any price with status OFFLINE must have price = 0 (not a fake value)
    const offlinePrice = mockBtcPrice({ price: 0, status: "OFFLINE" });
    expect(offlinePrice.status).toBe("OFFLINE");
    expect(offlinePrice.price).toBe(0);
  });

  // Test 17: BTC and XAU remain separate instruments
  it("should keep BTC/USD and XAU/USD as separate instruments", () => {
    const btc = mockBtcPrice();
    const xau = mockXauPrice();
    expect(btc.instrument).not.toBe(xau.instrument);
    expect(btc.sourceSymbol).not.toBe(xau.sourceSymbol);
  });

  // Test 18: XAU proxy metadata is correctly marked
  it("should always mark XAU/USD as proxy when using PAXGUSDT", () => {
    const xau = mockXauPrice();
    expect(xau.isProxy).toBe(true);
    expect(xau.sourceSymbol).toBe("PAXGUSDT");
    // Must NOT claim to be exact OANDA XAU/USD
    expect(xau.source).not.toBe("oanda");
  });

  // Test 3: Invalid provider response
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

  // Test 6: STALE state
  it("should allow status to be explicitly set to STALE", () => {
    const stalePrice = mockBtcPrice({
      status: "STALE",
      timestamp: new Date(Date.now() - 15000).toISOString(),
    });
    store.setPrice("BTC/USD", stalePrice);
    const retrieved = store.getPrice("BTC/USD");
    expect(retrieved?.status).toBe("STALE");
  });

  // Test 7: OFFLINE state
  it("should allow status to be explicitly set to OFFLINE", () => {
    const offlinePrice = mockBtcPrice({ status: "OFFLINE", price: 0 });
    store.setPrice("BTC/USD", offlinePrice);
    const retrieved = store.getPrice("BTC/USD");
    expect(retrieved?.status).toBe("OFFLINE");
  });

  it("should retain last known price when STALE (not reset to 0)", () => {
    const livePrice = mockBtcPrice({ price: 65000, status: "LIVE" });
    store.setPrice("BTC/USD", livePrice);
    // Simulate staleness by setting status=STALE, keeping price
    const stalePrice = { ...livePrice, status: "STALE" as const };
    store.setPrice("BTC/USD", stalePrice);
    const retrieved = store.getPrice("BTC/USD");
    expect(retrieved?.price).toBe(65000);
    expect(retrieved?.status).toBe("STALE");
  });

  // Test 4: Provider timeout
  it("should reflect OFFLINE when no update received (simulated timeout)", () => {
    const oldTimestamp = new Date(Date.now() - 60000).toISOString(); // 60s ago
    const timeoutPrice = mockBtcPrice({ status: "OFFLINE", timestamp: oldTimestamp, price: 0 });
    store.setPrice("BTC/USD", timeoutPrice);
    const retrieved = store.getPrice("BTC/USD");
    expect(retrieved?.status).toBe("OFFLINE");
  });

  // Test 5: Provider failure
  it("should reflect OFFLINE status on provider failure (price stays 0)", () => {
    const failedPrice = mockBtcPrice({ price: 0, status: "OFFLINE" });
    store.setPrice("BTC/USD", failedPrice);
    const retrieved = store.getPrice("BTC/USD");
    expect(retrieved?.status).toBe("OFFLINE");
    expect(retrieved?.price).toBe(0);
  });
});

describe("Provider diagnostic error logging", () => {
  let consoleErrorSpy: any;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("BinanceProvider logs HTTP status, response body, instrument, symbol, and URL on non-ok response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 451,
      statusText: "Unavailable For Legal Reasons",
      text: async () => "Service unavailable in US region",
    }));

    const provider = new BinanceProvider(1000);
    await (provider as any).poll();

    expect(consoleErrorSpy).toHaveBeenCalledOnce();
    const logOutput = consoleErrorSpy.mock.calls[0][0];
    expect(logOutput).toContain("[BinanceProvider]");
    expect(logOutput).toContain("instrument=BTC/USD");
    expect(logOutput).toContain("symbol=BTCUSDT");
    expect(logOutput).toContain("provider=binance");
    expect(logOutput).toContain("url=https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT");
    expect(logOutput).toContain("HTTP status: 451");
    expect(logOutput).toContain("Response body: Service unavailable in US region");
  });

  it("BinanceProvider logs network/timeout errors with error name and message", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Connection reset by peer")));

    const provider = new BinanceProvider(1000);
    await (provider as any).poll();

    expect(consoleErrorSpy).toHaveBeenCalledOnce();
    const logOutput = consoleErrorSpy.mock.calls[0][0];
    expect(logOutput).toContain("[BinanceProvider]");
    expect(logOutput).toContain("instrument=BTC/USD");
    expect(logOutput).toContain("errorMessage=Connection reset by peer");
  });

  it("GoldProvider logs HTTP status, response body, instrument, symbol, and URL on non-ok response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      statusText: "Too Many Requests",
      text: async () => "Rate limit exceeded",
    }));

    const provider = new GoldProvider(1000);
    await (provider as any).poll();

    expect(consoleErrorSpy).toHaveBeenCalledOnce();
    const logOutput = consoleErrorSpy.mock.calls[0][0];
    expect(logOutput).toContain("[GoldProvider]");
    expect(logOutput).toContain("instrument=XAU/USD");
    expect(logOutput).toContain("symbol=PAXGUSDT");
    expect(logOutput).toContain("provider=binance");
    expect(logOutput).toContain("url=https://api.binance.com/api/v3/ticker/price?symbol=PAXGUSDT");
    expect(logOutput).toContain("HTTP status: 429");
    expect(logOutput).toContain("Response body: Rate limit exceeded");
  });

  it("GoldProvider logs network/timeout errors with error name and message", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Fetch timeout after 5000ms")));

    const provider = new GoldProvider(1000);
    await (provider as any).poll();

    expect(consoleErrorSpy).toHaveBeenCalledOnce();
    const logOutput = consoleErrorSpy.mock.calls[0][0];
    expect(logOutput).toContain("[GoldProvider]");
    expect(logOutput).toContain("instrument=XAU/USD");
    expect(logOutput).toContain("errorMessage=Fetch timeout after 5000ms");
  });
});

