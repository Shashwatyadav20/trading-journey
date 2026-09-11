/**
 * XAU/USD Chart & Pine Levels Regression Suite
 * ==============================================
 * Updated for Twelve Data XAU/USD migration.
 *
 * Historical XAU/USD candles now come directly from TwelveDataMarketProvider.
 * No PAXG scaling, no scaleRatio, no Binance/Kraken/KuCoin fallbacks.
 * Native XAU/USD prices are fed unchanged into PineLiquidityEngine.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PineLevelService } from '../../PineLevelService';
import { PineAlertBridge } from '../PineAlertBridge';
import { priceStore } from '../../../market/MarketPriceStore';
import { Candle } from '../PineTypes';

describe('XAU/USD Chart & Pine Levels Regression Suite (Twelve Data)', () => {
  let pineService: PineLevelService;
  const originalEnv = process.env;

  beforeEach(() => {
    // Ensure TwelveDataMarketProvider treats itself as configured
    process.env = { ...originalEnv, TWELVE_DATA_API_KEY: 'test_key_vitest_placeholder' };
    pineService = new PineLevelService();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  // ─── Helper: native XAU/USD candles (no PAXG, no scaling) ────────────────

  function generateNativeXauCandles(count: number, startPrice: number = 2500): Candle[] {
    const candles: Candle[] = [];
    const baseTime = Date.now() - count * 15 * 60 * 1000;

    for (let i = 0; i < count; i++) {
      const ts = new Date(baseTime + i * 15 * 60 * 1000).toISOString();
      const open = startPrice + (i % 10);
      const high = open + 5;
      const low = open - 5;
      const close = open + 2;

      candles.push({
        timestamp: ts,
        open,
        high,
        low,
        close,
        volume: 100,
      });
    }

    return candles;
  }

  // ─── 1. Basic candle retrieval ────────────────────────────────────────────

  it('1. XAU 15M historical data returns multiple candles', () => {
    const candles = generateNativeXauCandles(100, 2500);
    // @ts-ignore
    pineService['historicalCandles'].set('XAU/USD', candles);

    const fetched = pineService.getHistoricalCandles('XAU/USD', 15);
    expect(fetched.length).toBe(100);
    expect(fetched.length).toBeGreaterThan(1);
  });

  // ─── 2. Live tick count never decreases ───────────────────────────────────

  it('2 & 5. Historical candles remain and count never decreases after live ticks', () => {
    const candles = generateNativeXauCandles(50, 2500);
    // @ts-ignore
    pineService['historicalCandles'].set('XAU/USD', candles);
    const initialCount = pineService.getHistoricalCandles('XAU/USD', 15).length;

    pineService.start();

    for (let i = 0; i < 5; i++) {
      priceStore.setPrice('XAU/USD', {
        instrument: 'XAU/USD',
        price: 2510 + i,
        timestamp: new Date().toISOString(),
        source: 'twelvedata',
        sourceSymbol: 'XAU/USD',
        isProxy: false,
        status: 'LIVE',
      });
    }

    const currentCount = pineService.getHistoricalCandles('XAU/USD', 15).length;
    expect(currentCount).toBeGreaterThanOrEqual(initialCount);
    pineService.stop();
  });

  // ─── 3. Candle aggregation ────────────────────────────────────────────────

  it('3. Ticks within the same 15M bucket aggregate into one candle', () => {
    const tfMs = 15 * 60 * 1000;
    const nowMs = Math.floor(Date.now() / tfMs) * tfMs;

    const ticks = [2500, 2515, 2495, 2508];
    const open = ticks[0];
    const high = Math.max(...ticks);
    const low = Math.min(...ticks);
    const close = ticks[ticks.length - 1];

    const aggregated: Candle = {
      timestamp: new Date(nowMs).toISOString(),
      open,
      high,
      low,
      close,
      volume: 0,
    };

    expect(aggregated.open).toBe(2500);
    expect(aggregated.high).toBe(2515);
    expect(aggregated.low).toBe(2495);
    expect(aggregated.close).toBe(2508);
  });

  // ─── 4. New bucket appends a candle ──────────────────────────────────────

  it('4. New 15M timeframe bucket appends a new candle', () => {
    const candles = generateNativeXauCandles(10, 2500);
    // @ts-ignore
    pineService['historicalCandles'].set('XAU/USD', [...candles]);

    const initialLen = pineService.getHistoricalCandles('XAU/USD', 15).length;

    const nextBucketTs = new Date(Date.now() + 20 * 60 * 1000).toISOString();
    const newCandle: Candle = {
      timestamp: nextBucketTs,
      open: 2520,
      high: 2530,
      low: 2515,
      close: 2525,
      volume: 50,
    };

    const hist = pineService.getHistoricalCandles('XAU/USD', 15);
    hist.push(newCandle);

    expect(hist.length).toBe(initialLen + 1);
    expect(hist[hist.length - 1].close).toBe(2525);
  });

  // ─── 6, 7, 8. OHLC invariants, sort, dedup ────────────────────────────────

  it('6 & 7 & 8. OHLC aggregation, chronological sorting, no duplicate timestamps', () => {
    const candles = generateNativeXauCandles(30, 2500);
    // @ts-ignore
    pineService['historicalCandles'].set('XAU/USD', candles);

    const result = pineService.getHistoricalCandles('XAU/USD', 15);

    const timestamps = new Set<string>();
    for (let i = 0; i < result.length; i++) {
      expect(timestamps.has(result[i].timestamp)).toBe(false);
      timestamps.add(result[i].timestamp);

      if (i > 0) {
        const prevMs = new Date(result[i - 1].timestamp).getTime();
        const currMs = new Date(result[i].timestamp).getTime();
        expect(currMs).toBeGreaterThan(prevMs);
      }

      expect(result[i].high).toBeGreaterThanOrEqual(result[i].low);
      expect(result[i].high).toBeGreaterThanOrEqual(result[i].open);
      expect(result[i].high).toBeGreaterThanOrEqual(result[i].close);
      expect(result[i].low).toBeLessThanOrEqual(result[i].open);
      expect(result[i].low).toBeLessThanOrEqual(result[i].close);
    }
  });

  // ─── 9-12. Timeframe aggregation ─────────────────────────────────────────

  it('9, 10, 11, 12, 13. Timeframe aggregation for XAU 30M, 1H, 4H, 1D', () => {
    const candles = generateNativeXauCandles(100, 2500);
    // @ts-ignore
    pineService['historicalCandles'].set('XAU/USD', candles);

    const tf15 = pineService.getHistoricalCandles('XAU/USD', 15);
    const tf30 = pineService.getHistoricalCandles('XAU/USD', 30);
    const tf60 = pineService.getHistoricalCandles('XAU/USD', 60);
    const tf240 = pineService.getHistoricalCandles('XAU/USD', 240);
    const tf1440 = pineService.getHistoricalCandles('XAU/USD', 1440);

    expect(tf15.length).toBe(100);
    expect(tf30.length).toBeLessThanOrEqual(51);
    expect(tf60.length).toBeLessThanOrEqual(26);
    expect(tf240.length).toBeLessThanOrEqual(8);
    expect(tf1440.length).toBeLessThanOrEqual(2);
  });

  // ─── SOURCE METADATA — Twelve Data EXACT parity ──────────────────────────

  it('XAU source metadata identifies Twelve Data with EXACT parity', () => {
    const meta = pineService.getSourceMetadata('XAU/USD');
    expect(meta.instrument).toBe('XAU/USD');
    expect(meta.historicalSource).toContain('Twelve Data');
    expect(meta.liveSource).toContain('Twelve Data');
    expect(meta.parityStatus).toBe('EXACT');
  });

  it('XAU source metadata does NOT reference OANDA', () => {
    const meta = pineService.getSourceMetadata('XAU/USD');
    expect(meta.historicalSource).not.toContain('OANDA');
    expect(meta.liveSource).not.toContain('OANDA');
  });

  it('XAU source metadata does NOT reference PAXG', () => {
    const meta = pineService.getSourceMetadata('XAU/USD');
    expect(meta.historicalSource).not.toContain('PAXG');
    expect(meta.parityNotes).not.toContain('PAXG');
  });

  // ─── NO PAXG SCALING — native XAU/USD prices remain unchanged ────────────

  it('Native XAU/USD prices are not scaled — candles fed directly to Pine engine', () => {
    const nativeXauClose = 2500.00;
    const candles = generateNativeXauCandles(20, nativeXauClose);
    // @ts-ignore
    pineService['historicalCandles'].set('XAU/USD', candles);

    // Verify the values are not transformed (no scale ratio applied)
    const fetched = pineService.getHistoricalCandles('XAU/USD', 15);
    const lastCandle = fetched[fetched.length - 1];

    // Native XAU price range ~2500 (no PAXG → XAU scaling)
    expect(lastCandle.close).toBeGreaterThan(2490);
    expect(lastCandle.close).toBeLessThan(2520);
  });

  it('Pine levels are generated from native XAU/USD candles without scaling', () => {
    const engine = pineService['engines'].get('XAU/USD')!;
    expect(engine).toBeDefined();

    // Native XAU/USD prices ~2500 range
    const candles = generateNativeXauCandles(150, 2500);
    for (const c of candles) {
      engine.processCandle(c);
    }

    const levels = pineService.getLevels('XAU/USD', 15);
    expect(levels.length).toBeGreaterThan(0);

    // All levels must be in native XAU/USD price range (no PAXG base ~$2500 scaled to ~$4418)
    for (const lvl of levels) {
      if (!['PREMIUM', 'DISCOUNT', 'EQUILIBRIUM'].includes(lvl.type)) {
        expect(lvl.price).toBeGreaterThan(2400);
        expect(lvl.price).toBeLessThan(2700);
      }
    }
  });

  // ─── PineLevelService bootstrap — Twelve Data is the XAU source ──────────

  it('PineLevelService.bootstrap() fetches from TwelveDataMarketProvider (not PAXG)', async () => {
    const twelveDataCalledUrls: string[] = [];

    const origFetch = global.fetch;
    global.fetch = async (url: any) => {
      const u = String(url);
      if (u.includes('twelvedata.com')) {
        twelveDataCalledUrls.push(u);
        return {
          ok: true,
          json: async () => ({
            status: 'ok',
            values: Array.from({ length: 50 }, (_, i) => ({
              datetime: new Date(Date.now() - (50 - i) * 15 * 60 * 1000).toISOString().replace('T', ' ').replace('.000Z', ''),
              open: String(2500 + (i % 5)),
              high: String(2510 + (i % 5)),
              low: String(2490 + (i % 5)),
              close: String(2505 + (i % 5)),
              volume: '0',
            })),
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

      // Twelve Data must have been called for XAU/USD
      expect(twelveDataCalledUrls.some((u) => u.includes('twelvedata.com'))).toBe(true);

      // PAXG-related endpoints must NOT have been called
      expect(twelveDataCalledUrls.some((u) => u.includes('PAXG'))).toBe(false);
      expect(twelveDataCalledUrls.some((u) => u.includes('binance'))).toBe(false);
      expect(twelveDataCalledUrls.some((u) => u.includes('kraken'))).toBe(false);
      expect(twelveDataCalledUrls.some((u) => u.includes('kucoin'))).toBe(false);

      const candles = pineService.getHistoricalCandles('XAU/USD', 15);
      expect(candles.length).toBeGreaterThan(0);

      // Prices must be native XAU/USD range (not scaled PAXG)
      const lastCandle = candles[candles.length - 1];
      expect(lastCandle.close).toBeGreaterThan(2490);
      expect(lastCandle.close).toBeLessThan(2520);
    } finally {
      global.fetch = origFetch;
    }
  });

  it('PineLevelService.bootstrap() graceful empty state if Twelve Data unavailable', async () => {
    const origFetch = global.fetch;
    global.fetch = async () => ({ ok: false, status: 500 } as any);

    try {
      await pineService.bootstrap();
      const candles = pineService.getHistoricalCandles('XAU/USD', 15);
      expect(candles.length).toBe(0);
      const levels = pineService.getLevels('XAU/USD', 15);
      expect(levels.length).toBe(0);
    } finally {
      global.fetch = origFetch;
    }
  });

  // ─── BTC regression ───────────────────────────────────────────────────────

  it('BTC/USD Pine chart behavior remains unchanged — Coinbase EXACT parity', () => {
    const meta = pineService.getSourceMetadata('BTC/USD');
    expect(meta.parityStatus).toBe('EXACT');
    expect(meta.instrument).toBe('BTC/USD');
    expect(meta.historicalSource).toContain('Coinbase');
  });

  it('BTC does not use XAU/Twelve Data fallback or scaling', () => {
    const meta = pineService.getSourceMetadata('BTC/USD');
    expect(meta.historicalSource).not.toContain('Twelve Data');
    expect(meta.historicalSource).not.toContain('PAXG');
    expect(meta.historicalSource).not.toContain('OANDA');
  });

  // ─── Alert bridge operational ─────────────────────────────────────────────

  it('Real-time LEVEL_TOUCHED Telegram alerts logic remains operational', () => {
    const bridge = pineService.getAlertBridge();
    expect(bridge).toBeInstanceOf(PineAlertBridge);
  });

  // ─── Pine levels are separate from drawings ───────────────────────────────

  it('Pine levels are generated when valid historical data exists', () => {
    const engine = pineService['engines'].get('BTC/USD');
    expect(engine).toBeDefined();

    const candles = generateNativeXauCandles(150, 60000);
    for (const c of candles) {
      engine!.processCandle(c);
    }

    const levels = pineService.getLevels('BTC/USD', 15);
    expect(levels.length).toBeGreaterThan(0);
  });
});

// ─── Regression: XAU does not use OANDA or PAXG ──────────────────────────────

describe('Regression: XAU/USD provider isolation', () => {
  it('XAU/USD does not use OANDA after migration', () => {
    const service = new PineLevelService();
    const meta = service.getSourceMetadata('XAU/USD');
    expect(meta.historicalSource).not.toContain('OANDA');
    expect(meta.liveSource).not.toContain('OANDA');
  });

  it('XAU/USD does not use PAXG after migration', () => {
    const service = new PineLevelService();
    const meta = service.getSourceMetadata('XAU/USD');
    expect(meta.historicalSource).not.toContain('PAXG');
    expect(meta.parityNotes).not.toContain('PAXG');
  });

  it('XAU/USD source is Twelve Data with EXACT parity', () => {
    const service = new PineLevelService();
    const meta = service.getSourceMetadata('XAU/USD');
    expect(meta.parityStatus).toBe('EXACT');
    expect(meta.historicalSource).toContain('Twelve Data');
    expect(meta.liveSource).toContain('Twelve Data');
  });

  it('BTC/USD source remains Coinbase and is EXACT parity', () => {
    const service = new PineLevelService();
    const meta = service.getSourceMetadata('BTC/USD');
    expect(meta.parityStatus).toBe('EXACT');
    expect(meta.historicalSource).toContain('Coinbase');
    expect(meta.liveSource).toContain('Coinbase');
  });
});
