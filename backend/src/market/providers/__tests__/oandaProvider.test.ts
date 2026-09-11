import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { OandaMarketProvider } from '../OandaMarketProvider';
import { PineLevelService } from '../../../alerts/PineLevelService';
import { PineLiquidityEngine } from '../../../alerts/pine/PineLiquidityEngine';
import { priceStore } from '../../MarketPriceStore';
import { Candle } from '../../../alerts/pine/PineTypes';

describe('OANDA XAU_USD Market Provider Suite (Requirements 1-22)', () => {
  let provider: OandaMarketProvider;
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.OANDA_API_TOKEN = 'test_token_secret_12345';
    process.env.OANDA_ACCOUNT_ID = '101-001-1234567-001';
    process.env.OANDA_ENVIRONMENT = 'practice';

    provider = new OandaMarketProvider();
  });

  afterEach(() => {
    process.env = originalEnv;
    provider.stop();
  });

  it('1. OANDA candle mapping to internal Candle interface', async () => {
    const origFetch = global.fetch;
    const mockOandaCandles = {
      candles: [
        {
          time: '2026-09-07T12:00:00.000000000Z',
          mid: { o: '4418.50', h: '4422.10', l: '4415.20', c: '4420.00' },
          volume: 500,
          complete: true,
        },
      ],
    };

    global.fetch = async () => ({
      ok: true,
      json: async () => mockOandaCandles,
    }) as any;

    try {
      const candles = await provider.fetchHistoricalCandles('M15', 1);
      expect(candles.length).toBe(1);
      const c = candles[0];
      expect(c.timestamp).toBe('2026-09-07T12:00:00.000Z');
      expect(c.open).toBe(4418.50);
      expect(c.high).toBe(4422.10);
      expect(c.low).toBe(4415.20);
      expect(c.close).toBe(4420.00);
      expect(c.volume).toBe(500);
    } finally {
      global.fetch = origFetch;
    }
  });

  it('2. Uses OANDA XAU_USD symbol correctly', () => {
    const current = provider.getCurrentPrice();
    expect(current.sourceSymbol).toBe('XAU_USD');
    expect(current.source).toBe('oanda');
    expect(current.instrument).toBe('XAU/USD');
  });

  it('3-7. Maps M15, M30, H1, H4, D granularities correctly', async () => {
    const origFetch = global.fetch;
    const requestedUrls: string[] = [];

    global.fetch = async (url: any) => {
      requestedUrls.push(String(url));
      return {
        ok: true,
        json: async () => ({ candles: [] }),
      } as any;
    };

    try {
      await provider.fetchHistoricalCandles('M15');
      await provider.fetchHistoricalCandles('M30');
      await provider.fetchHistoricalCandles('H1');
      await provider.fetchHistoricalCandles('H4');
      await provider.fetchHistoricalCandles('D');

      expect(requestedUrls.some((u) => u.includes('granularity=M15'))).toBe(true);
      expect(requestedUrls.some((u) => u.includes('granularity=M30'))).toBe(true);
      expect(requestedUrls.some((u) => u.includes('granularity=H1'))).toBe(true);
      expect(requestedUrls.some((u) => u.includes('granularity=H4'))).toBe(true);
      expect(requestedUrls.some((u) => u.includes('granularity=D'))).toBe(true);
    } finally {
      global.fetch = origFetch;
    }
  });

  it('8. Sorts candles chronologically ascending', async () => {
    const origFetch = global.fetch;
    global.fetch = async () => ({
      ok: true,
      json: async () => ({
        candles: [
          { time: '2026-09-07T12:15:00.000Z', mid: { o: '4420', h: '4425', l: '4415', c: '4422' }, volume: 10, complete: true },
          { time: '2026-09-07T12:00:00.000Z', mid: { o: '4410', h: '4420', l: '4405', c: '4418' }, volume: 10, complete: true },
        ],
      }),
    }) as any;

    try {
      const candles = await provider.fetchHistoricalCandles('M15');
      expect(candles[0].timestamp).toBe('2026-09-07T12:00:00.000Z');
      expect(candles[1].timestamp).toBe('2026-09-07T12:15:00.000Z');
    } finally {
      global.fetch = origFetch;
    }
  });

  it('9. Removes duplicate candles with identical timestamps', async () => {
    const origFetch = global.fetch;
    global.fetch = async () => ({
      ok: true,
      json: async () => ({
        candles: [
          { time: '2026-09-07T12:00:00.000Z', mid: { o: '4410', h: '4420', l: '4405', c: '4418' }, volume: 10, complete: true },
          { time: '2026-09-07T12:00:00.000Z', mid: { o: '4410', h: '4420', l: '4405', c: '4418' }, volume: 10, complete: true },
        ],
      }),
    }) as any;

    try {
      const candles = await provider.fetchHistoricalCandles('M15');
      expect(candles.length).toBe(1);
    } finally {
      global.fetch = origFetch;
    }
  });

  it('10. Filters out incomplete candles', async () => {
    const origFetch = global.fetch;
    global.fetch = async () => ({
      ok: true,
      json: async () => ({
        candles: [
          { time: '2026-09-07T12:00:00.000Z', mid: { o: '4410', h: '4420', l: '4405', c: '4418' }, volume: 10, complete: true },
          { time: '2026-09-07T12:15:00.000Z', mid: { o: '4420', h: '4425', l: '4415', c: '4422' }, volume: 10, complete: false },
        ],
      }),
    }) as any;

    try {
      const candles = await provider.fetchHistoricalCandles('M15');
      expect(candles.length).toBe(1);
      expect(candles[0].timestamp).toBe('2026-09-07T12:00:00.000Z');
    } finally {
      global.fetch = origFetch;
    }
  });

  it('11. Live price tick updates current price and notifies subscribers', async () => {
    const origFetch = global.fetch;
    global.fetch = async () => ({
      ok: true,
      json: async () => ({
        prices: [
          {
            time: '2026-09-07T12:30:00.000Z',
            bids: [{ price: '4419.80' }],
            asks: [{ price: '4420.20' }],
          },
        ],
      }),
    }) as any;

    try {
      let updatedPrice: any = null;
      provider.onUpdate((p) => {
        updatedPrice = p;
      });

      const p = await provider.pollLivePrice();
      expect(p).not.toBeNull();
      expect(p?.price).toBe(4420.00); // (4419.80 + 4420.20) / 2
      expect(updatedPrice).toEqual(p);
    } finally {
      global.fetch = origFetch;
    }
  });

  it('14 & 15. Missing credentials return clear unconfigured state', () => {
    const unconfigProvider = new OandaMarketProvider({ token: '', accountID: '' });
    expect(unconfigProvider.isConfigured()).toBe(false);
    expect(unconfigProvider.getCurrentPrice().status).toBe('OFFLINE');
  });

  it('16. Authentication error (401/403) handles error safely without leaking secret token', async () => {
    const origFetch = global.fetch;
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    global.fetch = async () => ({
      ok: false,
      status: 401,
    }) as any;

    try {
      const res = await provider.pollLivePrice();
      expect(res).toBeNull();

      // Ensure logged error messages do NOT print the secret token
      consoleErrorSpy.mock.calls.forEach((call) => {
        const msg = call.join(' ');
        expect(msg).not.toContain('test_token_secret_12345');
      });
    } finally {
      consoleErrorSpy.mockRestore();
      global.fetch = origFetch;
    }
  });

  it('17 & 18. Credentials remain isolated to backend provider instance', () => {
    expect(provider['token']).toBe('test_token_secret_12345');
    const jsonStr = JSON.stringify(provider.getCurrentPrice());
    expect(jsonStr).not.toContain('test_token_secret_12345');
  });

  it('19. XAU/USD candles from TwelveDataMarketProvider are NOT scaled by PineLevelService', async () => {
    // Set API key so TwelveDataMarketProvider.isConfigured() returns true
    const savedKey = process.env.TWELVE_DATA_API_KEY;
    process.env.TWELVE_DATA_API_KEY = 'test_key_vitest_placeholder';

    const pineService = new PineLevelService();

    const origFetch = global.fetch;
    global.fetch = async (url: any) => {
      const u = String(url);
      if (u.includes('twelvedata.com') && u.includes('time_series')) {
        return {
          ok: true,
          json: async () => ({
            status: 'ok',
            values: [
              { datetime: '2026-09-07 12:00:00', open: '2410.00', high: '2420.00', low: '2405.00', close: '2415.00', volume: '0' },
            ],
          }),
        } as any;
      }
      if (u.includes('coinbase')) {
        return { ok: true, json: async () => [] } as any;
      }
      return { ok: false, status: 404 } as any;
    };

    try {
      await pineService.bootstrap();
      const candles = pineService.getHistoricalCandles('XAU/USD', 15);
      expect(candles.length).toBeGreaterThanOrEqual(1);
      // Close must remain exactly 2415.00 — NO scaleRatio applied!
      const lastCandle = candles[candles.length - 1];
      expect(lastCandle.close).toBe(2415.00);
    } finally {
      global.fetch = origFetch;
      process.env.TWELVE_DATA_API_KEY = savedKey;
    }
  });

  it('20. PineLiquidityEngine processes OANDA Candle objects seamlessly', () => {
    const engine = new PineLiquidityEngine({}, 15);
    const oandaCandle: Candle = {
      timestamp: new Date().toISOString(),
      open: 4410,
      high: 4425,
      low: 4405,
      close: 4420,
      volume: 1000,
    };

    engine.processCandle(oandaCandle);
    expect(engine.getPDZoneState()).toBeDefined();
  });

  it('21. BTC/USD regression: BTC provider remains Coinbase EXACT parity', () => {
    const pineService = new PineLevelService();
    const meta = pineService.getSourceMetadata('BTC/USD');
    expect(meta.parityStatus).toBe('EXACT');
    expect(meta.historicalSource).toContain('Coinbase');
  });

  it('22. After Twelve Data migration, XAU/USD metadata reports Twelve Data EXACT parity', () => {
    const pineService = new PineLevelService();

    const meta = pineService.getSourceMetadata('XAU/USD');
    expect(meta.parityStatus).toBe('EXACT');
    expect(meta.historicalSource).toContain('Twelve Data');
    expect(meta.liveSource).toContain('Twelve Data');
    // OANDA must NOT appear in metadata after migration
    expect(meta.historicalSource).not.toContain('OANDA');
    expect(meta.liveSource).not.toContain('OANDA');
  });
});
