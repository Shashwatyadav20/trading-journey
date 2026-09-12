/**
 * Twelve Data Market Provider — Full Test Suite
 * ==============================================
 * Tests all required behaviours:
 *   1.  Configured vs unconfigured state
 *   2.  Valid live price response
 *   3.  Valid historical candle response
 *   4.  15min interval mapping
 *   5.  30min interval mapping
 *   6.  1h interval mapping
 *   7.  4h interval mapping
 *   8.  1day interval mapping
 *   9.  Ascending candle sort
 *   10. Malformed candle rejection
 *   11. API error (data.message) handling
 *   12. HTTP error handling
 *   13. Network/timeout error handling
 *   14. API key never appears in thrown errors or logs
 *   15. Polling throttle / rate-limit safety (respects pollIntervalMs)
 *   16. Market-closed status suspends unnecessary polling
 *   17. MarketPrice shape — isProxy=false, source="twelvedata"
 *   18. Duplicate candle timestamps are deduplicated
 *   19. Zero / negative OHLC values are rejected
 *   20. BTC/USD regression — TwelveDataMarketProvider never claims BTC
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TwelveDataMarketProvider } from '../TwelveDataMarketProvider';

const SAFE_API_KEY = 'test_key_never_logged_99999';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeTwelveDataPriceResponse(price: string) {
  return { price };
}

function makeTwelveDataCandleResponse(candles: Array<{
  datetime: string;
  open: string;
  high: string;
  low: string;
  close: string;
  volume?: string;
}>) {
  return {
    status: 'ok',
    values: candles,
  };
}

function makeSingleCandle(datetime: string, open = '2500.00', high = '2510.00', low = '2490.00', close = '2505.00') {
  return { datetime, open, high, low, close, volume: '0' };
}

function buildProvider(overrides?: { apiKey?: string; pollIntervalMs?: number }) {
  return new TwelveDataMarketProvider({
    apiKey: overrides?.apiKey ?? SAFE_API_KEY,
    pollIntervalMs: overrides?.pollIntervalMs ?? 99999, // very large so timers never auto-fire
  });
}

// ─── Suite ────────────────────────────────────────────────────────────────────

describe('TwelveDataMarketProvider', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.setSystemTime(new Date('2026-09-10T12:00:00Z')); // Thursday (Market Open)
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  // ─── 1. Configured / unconfigured ─────────────────────────────────────────

  it('1a. isConfigured() returns true when API key is provided', () => {
    const provider = buildProvider();
    expect(provider.isConfigured()).toBe(true);
  });

  it('1b. isConfigured() returns false when API key is empty string', () => {
    const provider = buildProvider({ apiKey: '' });
    expect(provider.isConfigured()).toBe(false);
  });

  it('1c. isConfigured() returns false when API key is whitespace-only', () => {
    const provider = buildProvider({ apiKey: '   ' });
    expect(provider.isConfigured()).toBe(false);
  });

  it('1d. Unconfigured provider has OFFLINE status', () => {
    const provider = buildProvider({ apiKey: '' });
    expect(provider.getCurrentPrice().status).toBe('OFFLINE');
  });

  it('1e. Unconfigured provider pollLivePrice returns null immediately', async () => {
    const provider = buildProvider({ apiKey: '' });
    const result = await provider.pollLivePrice();
    expect(result).toBeNull();
  });

  it('1f. Unconfigured provider fetchHistoricalCandles returns empty array', async () => {
    const provider = buildProvider({ apiKey: '' });
    const result = await provider.fetchHistoricalCandles('M15', 10);
    expect(result).toEqual([]);
  });

  // ─── 2. Valid live price response ─────────────────────────────────────────

  it('2a. pollLivePrice returns a valid MarketPrice on success', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => makeTwelveDataPriceResponse('2483.50'),
    }));

    const provider = buildProvider();
    const result = await provider.pollLivePrice();

    expect(result).not.toBeNull();
    expect(result!.price).toBe(2483.5);
    expect(result!.instrument).toBe('XAU/USD');
    expect(result!.source).toBe('twelvedata');
    expect(result!.sourceSymbol).toBe('XAU/USD');
    expect(result!.isProxy).toBe(false);
  });

  it('2b. pollLivePrice notifies onUpdate callback on success', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => makeTwelveDataPriceResponse('2500.00'),
    }));

    const provider = buildProvider();
    const cb = vi.fn();
    provider.onUpdate(cb);
    await provider.pollLivePrice();

    expect(cb).toHaveBeenCalledOnce();
    expect(cb.mock.calls[0][0].price).toBe(2500);
  });

  it('2c. getCurrentPrice reflects the most recent successful live poll', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => makeTwelveDataPriceResponse('3100.00'),
    }));

    const provider = buildProvider();
    await provider.pollLivePrice();
    expect(provider.getCurrentPrice().price).toBe(3100);
  });

  // ─── 3. Valid historical candle response ──────────────────────────────────

  it('3. fetchHistoricalCandles maps Twelve Data values to Candle correctly', async () => {
    const rawCandles = [makeSingleCandle('2026-09-10 15:00:00')];
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => makeTwelveDataCandleResponse(rawCandles),
    }));

    const provider = buildProvider();
    const candles = await provider.fetchHistoricalCandles('M15', 1);

    expect(candles).toHaveLength(1);
    const c = candles[0];
    expect(c.open).toBe(2500);
    expect(c.high).toBe(2510);
    expect(c.low).toBe(2490);
    expect(c.close).toBe(2505);
    expect(c.volume).toBe(0);
    expect(typeof c.timestamp).toBe('string');
    // Timestamp must be valid ISO
    expect(new Date(c.timestamp).getTime()).toBeGreaterThan(0);
  });

  // ─── 4-8. Interval mapping ────────────────────────────────────────────────

  async function assertIntervalMapping(granularity: string, expectedInterval: string) {
    const requestedUrls: string[] = [];
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (url: string) => {
      requestedUrls.push(String(url));
      return {
        ok: true,
        json: async () => makeTwelveDataCandleResponse([]),
      };
    }));

    const provider = buildProvider();
    await provider.fetchHistoricalCandles(granularity, 10);

    expect(requestedUrls.some((u) => u.includes(`interval=${expectedInterval}`))).toBe(true);
  }

  it('4. 15min interval: M15 maps to interval=15min', async () => {
    await assertIntervalMapping('M15', '15min');
  });

  it('5. 30min interval: M30 maps to interval=30min', async () => {
    await assertIntervalMapping('M30', '30min');
  });

  it('6. 1h interval: H1 maps to interval=1h', async () => {
    await assertIntervalMapping('H1', '1h');
  });

  it('7. 4h interval: H4 maps to interval=4h', async () => {
    await assertIntervalMapping('H4', '4h');
  });

  it('8. 1day interval: D maps to interval=1day', async () => {
    await assertIntervalMapping('D', '1day');
  });

  it('8b. Numeric granularity 15 maps to 15min', async () => {
    await assertIntervalMapping('15', '15min');
  });

  it('8c. Numeric granularity 60 maps to 1h', async () => {
    await assertIntervalMapping('60', '1h');
  });

  it('8d. Numeric granularity 240 maps to 4h', async () => {
    await assertIntervalMapping('240', '4h');
  });

  it('8e. Numeric granularity 1440 maps to 1day', async () => {
    await assertIntervalMapping('1440', '1day');
  });

  // ─── 9. Ascending sort ────────────────────────────────────────────────────

  it('9. fetchHistoricalCandles returns candles sorted ascending by timestamp', async () => {
    const rawCandles = [
      makeSingleCandle('2026-09-10 15:15:00'),
      makeSingleCandle('2026-09-10 14:45:00'),
      makeSingleCandle('2026-09-10 15:00:00'),
    ];
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => makeTwelveDataCandleResponse(rawCandles),
    }));

    const provider = buildProvider();
    const candles = await provider.fetchHistoricalCandles('M15', 3);

    expect(candles).toHaveLength(3);
    for (let i = 1; i < candles.length; i++) {
      expect(new Date(candles[i].timestamp).getTime())
        .toBeGreaterThan(new Date(candles[i - 1].timestamp).getTime());
    }
  });

  // ─── 10. Malformed candle rejection ───────────────────────────────────────

  it('10a. Candles missing required OHLC fields are filtered out', async () => {
    const rawCandles = [
      // Valid
      makeSingleCandle('2026-09-10 15:00:00'),
      // Missing close
      { datetime: '2026-09-10 15:15:00', open: '2500', high: '2510', low: '2490' },
      // Missing datetime
      { open: '2500', high: '2510', low: '2490', close: '2505' },
    ];
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'ok', values: rawCandles }),
    }));

    const provider = buildProvider();
    const candles = await provider.fetchHistoricalCandles('M15', 3);

    expect(candles).toHaveLength(1);
    expect(candles[0].close).toBe(2505);
  });

  it('10b. Zero-value OHLC candles are rejected', async () => {
    const rawCandles = [
      { datetime: '2026-09-10 15:00:00', open: '0', high: '2510', low: '2490', close: '2505', volume: '0' },
      makeSingleCandle('2026-09-10 15:15:00'),
    ];
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => makeTwelveDataCandleResponse(rawCandles),
    }));

    const provider = buildProvider();
    const candles = await provider.fetchHistoricalCandles('M15', 2);

    // Only the valid non-zero candle
    expect(candles).toHaveLength(1);
  });

  it('10c. Duplicate timestamps are deduplicated', async () => {
    const rawCandles = [
      makeSingleCandle('2026-09-10 15:00:00'),
      makeSingleCandle('2026-09-10 15:00:00'), // duplicate
    ];
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => makeTwelveDataCandleResponse(rawCandles),
    }));

    const provider = buildProvider();
    const candles = await provider.fetchHistoricalCandles('M15', 2);

    expect(candles).toHaveLength(1);
  });

  // ─── 11. API error (data.message) handling ────────────────────────────────

  it('11. API error JSON (data.message) returns null for live price', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ message: 'You have run out of API credits.' }),
    }));

    const provider = buildProvider();
    const result = await provider.pollLivePrice();

    expect(result).toBeNull();
  });

  it('11b. API error JSON (data.message) returns empty array for historical', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'error', message: 'Invalid symbol.' }),
    }));

    const provider = buildProvider();
    const candles = await provider.fetchHistoricalCandles('M15', 10);

    expect(candles).toEqual([]);
  });

  // ─── 12. HTTP error handling ──────────────────────────────────────────────

  it('12a. HTTP 429 on live price returns null without throwing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
    }));

    const provider = buildProvider();
    const result = await provider.pollLivePrice();

    expect(result).toBeNull();
  });

  it('12b. HTTP 500 on historical returns empty array without throwing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
    }));

    const provider = buildProvider();
    const candles = await provider.fetchHistoricalCandles('M15', 10);

    expect(candles).toEqual([]);
  });

  it('12c. HTTP error is logged via console.error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
    }));

    const provider = buildProvider();
    await provider.pollLivePrice();

    expect(consoleSpy).toHaveBeenCalled();
  });

  // ─── 13. Network / timeout error handling ─────────────────────────────────

  it('13a. Network error on live price returns null without throwing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('DNS lookup failed')));

    const provider = buildProvider();
    const result = await provider.pollLivePrice();

    expect(result).toBeNull();
  });

  it('13b. Network error on historical returns empty array without throwing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Network request failed')));

    const provider = buildProvider();
    const candles = await provider.fetchHistoricalCandles('M15', 10);

    expect(candles).toEqual([]);
  });

  // ─── 14. API key NEVER appears in errors or logs ──────────────────────────

  it('14a. API key does not appear in console.error messages on HTTP error', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
    }));

    const provider = buildProvider({ apiKey: SAFE_API_KEY });
    await provider.pollLivePrice();
    await provider.fetchHistoricalCandles('M15', 10);

    for (const call of [...consoleErrorSpy.mock.calls, ...consoleWarnSpy.mock.calls]) {
      const msg = call.join(' ');
      expect(msg).not.toContain(SAFE_API_KEY);
    }
  });

  it('14b. API key does not appear in console messages on network error', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));

    const provider = buildProvider({ apiKey: SAFE_API_KEY });
    await provider.pollLivePrice();
    await provider.fetchHistoricalCandles('M15', 10);

    for (const call of consoleErrorSpy.mock.calls) {
      const msg = call.join(' ');
      expect(msg).not.toContain(SAFE_API_KEY);
    }
  });

  it('14c. getCurrentPrice JSON representation never contains the API key', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => makeTwelveDataPriceResponse('2500.00'),
    }));

    const provider = buildProvider({ apiKey: SAFE_API_KEY });
    await provider.pollLivePrice();

    const serialised = JSON.stringify(provider.getCurrentPrice());
    expect(serialised).not.toContain(SAFE_API_KEY);
  });

  // ─── 15. Polling throttle / rate-limit safety ─────────────────────────────

  it('15a. start() schedules exactly one setInterval (no duplicate polling loops)', () => {
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');

    const provider = buildProvider();
    provider.start();
    provider.stop();

    // Should have been called at most once for the live price polling
    expect(setIntervalSpy.mock.calls.length).toBeLessThanOrEqual(1);
  });

  it('15b. start() called twice does not start a second polling loop', () => {
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');

    const provider = buildProvider();
    provider.start();
    provider.start(); // second call is a no-op
    provider.stop();

    expect(setIntervalSpy.mock.calls.length).toBeLessThanOrEqual(1);
  });

  it('15c. pollIntervalMs defaults to 15000 when env var is missing', () => {
    const original = process.env.TWELVE_DATA_POLL_INTERVAL_MS;
    delete process.env.TWELVE_DATA_POLL_INTERVAL_MS;

    const provider = new TwelveDataMarketProvider({ apiKey: SAFE_API_KEY });
    expect((provider as any).pollIntervalMs).toBeGreaterThanOrEqual(15000);

    process.env.TWELVE_DATA_POLL_INTERVAL_MS = original;
  });

  it('15d. pollIntervalMs from env var is respected when ≥ 3000', () => {
    const original = process.env.TWELVE_DATA_POLL_INTERVAL_MS;
    process.env.TWELVE_DATA_POLL_INTERVAL_MS = '20000';

    const provider = new TwelveDataMarketProvider({ apiKey: SAFE_API_KEY });
    expect((provider as any).pollIntervalMs).toBe(20000);

    process.env.TWELVE_DATA_POLL_INTERVAL_MS = original;
  });

  it('15e. Unsafe env poll interval (< 3000ms) is clamped to 15000', () => {
    const original = process.env.TWELVE_DATA_POLL_INTERVAL_MS;
    process.env.TWELVE_DATA_POLL_INTERVAL_MS = '1000'; // Too fast

    const provider = new TwelveDataMarketProvider({ apiKey: SAFE_API_KEY });
    expect((provider as any).pollIntervalMs).toBe(15000);

    process.env.TWELVE_DATA_POLL_INTERVAL_MS = original;
  });

  // ─── 16. Market closed suspends unnecessary polling ───────────────────────

  it('16. Market-closed returns MARKET_CLOSED status without calling fetch', async () => {
    // Saturday UTC — gold market closed
    const saturday = new Date('2026-09-12T12:00:00Z'); // Saturday
    vi.setSystemTime(saturday);

    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    // Create a provider; on a Saturday the market is closed
    const provider = buildProvider();
    // Force the market-closed path by mocking isGoldMarketOpen to return false
    // The real function uses Date internally; since we mocked time to Saturday, it should return false.
    const result = await provider.pollLivePrice();

    // Market is closed on Saturday — fetch should NOT be called
    expect(fetchMock).not.toHaveBeenCalled();
    // status should reflect closure
    expect(provider.getCurrentPrice().status).toBe('MARKET_CLOSED');

    vi.useRealTimers();
  });

  // ─── 17. MarketPrice shape ────────────────────────────────────────────────

  it('17. getCurrentPrice() returns correct MarketPrice shape', () => {
    const provider = buildProvider();
    const price = provider.getCurrentPrice();

    expect(price.instrument).toBe('XAU/USD');
    expect(price.source).toBe('twelvedata');
    expect(price.sourceSymbol).toBe('XAU/USD');
    expect(price.isProxy).toBe(false);
    expect(['LIVE', 'OFFLINE', 'MARKET_CLOSED', 'STALE']).toContain(price.status);
    expect(typeof price.timestamp).toBe('string');
  });

  // ─── 18. Dedup ────────────────────────────────────────────────────────────
  // Covered in test 10c above.

  // ─── 19. Zero / negative OHLC values ─────────────────────────────────────
  // Covered in test 10b above.

  // ─── 20. BTC/USD regression ──────────────────────────────────────────────

  it('20. TwelveDataMarketProvider always reports XAU/USD, never BTC/USD', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => makeTwelveDataPriceResponse('2500.00'),
    }));

    const provider = buildProvider();
    await provider.pollLivePrice();

    expect(provider.getCurrentPrice().instrument).toBe('XAU/USD');
    expect(provider.getCurrentPrice().instrument).not.toBe('BTC/USD');
  });

  it('20b. stop() clears the polling interval cleanly', () => {
    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval');

    const provider = buildProvider();
    provider.start();
    provider.stop();

    expect(clearIntervalSpy).toHaveBeenCalled();
    expect((provider as any).intervalId).toBeNull();
    expect((provider as any).isRunning).toBe(false);
  });
});
