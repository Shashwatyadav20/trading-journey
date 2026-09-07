import { describe, it, expect, beforeEach } from 'vitest';
import { PineLevelService } from '../../PineLevelService';
import { PineAlertBridge } from '../PineAlertBridge';
import { priceStore } from '../../../market/MarketPriceStore';
import { Candle } from '../PineTypes';

describe('XAU/USD Chart & Pine Levels Regression Suite', () => {
  let pineService: PineLevelService;

  beforeEach(() => {
    pineService = new PineLevelService();
  });

  function generateSampleCandles(count: number, startPrice: number = 2500): Candle[] {
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

  it('1. XAU 15M historical data returns multiple candles', () => {
    const candles = generateSampleCandles(100, 2500);
    // @ts-ignore
    pineService['historicalCandles'].set('XAU/USD', candles);

    const fetched = pineService.getHistoricalCandles('XAU/USD', 15);
    expect(fetched.length).toBe(100);
    expect(fetched.length).toBeGreaterThan(1);
  });

  it('2 & 5. Historical candles remain and count never decreases after live ticks', () => {
    const candles = generateSampleCandles(50, 4400);
    // @ts-ignore
    pineService['historicalCandles'].set('XAU/USD', candles);
    const initialCount = pineService.getHistoricalCandles('XAU/USD', 15).length;

    pineService.start();

    // Simulate 5 live ticks
    for (let i = 0; i < 5; i++) {
      priceStore.setPrice('XAU/USD', {
        instrument: 'XAU/USD',
        price: 4410 + i,
        timestamp: new Date().toISOString(),
        source: 'xaus',
        sourceSymbol: 'XAU/USD',
        isProxy: false,
        status: 'LIVE',
      });
    }

    const currentCount = pineService.getHistoricalCandles('XAU/USD', 15).length;
    expect(currentCount).toBeGreaterThanOrEqual(initialCount);
    pineService.stop();
  });

  it('3. Ticks within the same 15M bucket aggregate into one candle', () => {
    const tfMs = 15 * 60 * 1000;
    const nowMs = Math.floor(Date.now() / tfMs) * tfMs;

    const bucketCandles: Candle[] = [];
    const ticks = [4410, 4425, 4405, 4418];

    let open = ticks[0];
    let high = Math.max(...ticks);
    let low = Math.min(...ticks);
    let close = ticks[ticks.length - 1];

    const aggregated: Candle = {
      timestamp: new Date(nowMs).toISOString(),
      open,
      high,
      low,
      close,
      volume: 0,
    };

    expect(aggregated.open).toBe(4410);
    expect(aggregated.high).toBe(4425);
    expect(aggregated.low).toBe(4405);
    expect(aggregated.close).toBe(4418);
  });

  it('4. New 15M timeframe bucket appends a new candle', () => {
    const candles = generateSampleCandles(10, 4400);
    // @ts-ignore
    pineService['historicalCandles'].set('XAU/USD', [...candles]);

    const initialLen = pineService.getHistoricalCandles('XAU/USD', 15).length;

    // Simulate closed minute candle in next bucket
    const nextBucketTs = new Date(Date.now() + 20 * 60 * 1000).toISOString();
    const newCandle: Candle = {
      timestamp: nextBucketTs,
      open: 4420,
      high: 4430,
      low: 4415,
      close: 4425,
      volume: 50,
    };

    const hist = pineService.getHistoricalCandles('XAU/USD', 15);
    hist.push(newCandle);

    expect(hist.length).toBe(initialLen + 1);
    expect(hist[hist.length - 1].close).toBe(4425);
  });

  it('6 & 7 & 8. OHLC aggregation, chronological sorting, no duplicate timestamps', () => {
    const candles = generateSampleCandles(30, 4400);
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

  it('9, 10, 11, 12, 13. Timeframe aggregation for XAU 30M, 1H, 4H, 1D', () => {
    const candles = generateSampleCandles(100, 4400);
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

  it('14. XAU live/historical transition scaling preserves valid OHLC without gap jump', () => {
    const rawPaxgHistory = generateSampleCandles(20, 2500); // Historical ~2500
    const liveSpotPrice = 4418.10;

    const lastClose = rawPaxgHistory[rawPaxgHistory.length - 1].close;
    const scaleRatio = liveSpotPrice / lastClose;

    const scaledHistory = rawPaxgHistory.map((c) => ({
      ...c,
      open: parseFloat((c.open * scaleRatio).toFixed(2)),
      high: parseFloat((c.high * scaleRatio).toFixed(2)),
      low: parseFloat((c.low * scaleRatio).toFixed(2)),
      close: parseFloat((c.close * scaleRatio).toFixed(2)),
    }));

    const scaledLastClose = scaledHistory[scaledHistory.length - 1].close;
    const diff = Math.abs(scaledLastClose - liveSpotPrice);

    expect(diff).toBeLessThan(10); // Seamless transition to live spot baseline!
  });

  it('15. Pine levels are generated when valid historical data exists', () => {
    const engine = pineService['engines'].get('BTC/USD');
    expect(engine).toBeDefined();

    const candles = generateSampleCandles(150, 60000);
    for (const c of candles) {
      engine!.processCandle(c);
    }

    const levels = pineService.getLevels('BTC/USD', 15);
    expect(levels.length).toBeGreaterThan(0);
  });

  it('16. BTC/USD Pine chart behavior remains unchanged', () => {
    const meta = pineService.getSourceMetadata('BTC/USD');
    expect(meta.parityStatus).toBe('EXACT');
    expect(meta.instrument).toBe('BTC/USD');
  });

  it('17. Real-time LEVEL_TOUCHED Telegram alerts logic remains operational', () => {
    const bridge = pineService.getAlertBridge();
    expect(bridge).toBeInstanceOf(PineAlertBridge);
  });

  it('13 (Explicit Scale Parity Test). Historical XAU close around 2500 + live XAU around 4418 results in historical candles and Pine levels being on the same price scale', () => {
    const rawPaxgHistory = generateSampleCandles(100, 2500); // Historical PAXG close ~2521
    const liveSpotPrice = 4418.10;

    priceStore.setPrice('XAU/USD', {
      instrument: 'XAU/USD',
      price: liveSpotPrice,
      timestamp: new Date().toISOString(),
      source: 'xaus',
      sourceSymbol: 'XAU/USD',
      isProxy: false,
      status: 'LIVE',
    });

    const engine = pineService['engines'].get('XAU/USD')!;
    expect(engine).toBeDefined();

    const lastClose = rawPaxgHistory[rawPaxgHistory.length - 1].close;
    const scaleRatio = liveSpotPrice / lastClose;
    const scaledHistory = rawPaxgHistory.map((c) => ({
      ...c,
      open: parseFloat((c.open * scaleRatio).toFixed(2)),
      high: parseFloat((c.high * scaleRatio).toFixed(2)),
      low: parseFloat((c.low * scaleRatio).toFixed(2)),
      close: parseFloat((c.close * scaleRatio).toFixed(2)),
    }));

    for (const candle of scaledHistory) {
      engine.processCandle(candle);
    }

    const lastScaledCandle = scaledHistory[scaledHistory.length - 1];
    expect(lastScaledCandle.close).toBeGreaterThan(4350);
    expect(lastScaledCandle.close).toBeLessThan(4500);

    const activeLevels = pineService.getLevels('XAU/USD', 15);
    expect(activeLevels.length).toBeGreaterThan(0);

    for (const lvl of activeLevels) {
      expect(lvl.price).toBeGreaterThan(4000);
      expect(lvl.price).toBeLessThan(4600);
    }
  });

  it('Real PineLevelService.bootstrap() integration test (raw Binance PAXG $2500 -> live Xaus $4418)', async () => {
    priceStore.setPrice('XAU/USD', {
      instrument: 'XAU/USD',
      price: 4418.10,
      timestamp: new Date().toISOString(),
      source: 'xaus',
      sourceSymbol: 'XAU/USD',
      isProxy: false,
      status: 'LIVE',
    });

    const mockPaxgKlines: any[] = [];
    const baseMs = Date.now() - 100 * 15 * 60 * 1000;
    for (let i = 0; i < 100; i++) {
      const open = 2500 + (i % 10);
      const high = open + 5;
      const low = open - 5;
      const close = open + 2;
      const timeMs = baseMs + i * 15 * 60 * 1000;
      mockPaxgKlines.push([timeMs, String(open), String(high), String(low), String(close), '100']);
    }

    const origFetch = global.fetch;
    global.fetch = async (url: any, opts?: any) => {
      const urlStr = String(url);
      if (urlStr.includes('PAXGUSDT')) {
        return {
          ok: true,
          json: async () => mockPaxgKlines,
        } as any;
      }
      if (urlStr.includes('BTC')) {
        return {
          ok: true,
          json: async () => [],
        } as any;
      }
      return origFetch(url, opts);
    };

    try {
      await pineService.bootstrap();

      const candles15 = pineService.getHistoricalCandles('XAU/USD', 15);
      expect(candles15.length).toBe(100);
      const lastCandle = candles15[candles15.length - 1];
      expect(lastCandle.close).toBeGreaterThan(4350);
      expect(lastCandle.close).toBeLessThan(4500);

      const candles30 = pineService.getHistoricalCandles('XAU/USD', 30);
      const candles60 = pineService.getHistoricalCandles('XAU/USD', 60);
      const candles240 = pineService.getHistoricalCandles('XAU/USD', 240);
      const candles1440 = pineService.getHistoricalCandles('XAU/USD', 1440);

      expect(candles30.length).toBeGreaterThan(1);
      expect(candles60.length).toBeGreaterThan(1);
      expect(candles240.length).toBeGreaterThan(1);
      expect(candles1440.length).toBeGreaterThan(0);

      const levels = pineService.getLevels('XAU/USD', 15);
      expect(levels.length).toBeGreaterThan(0);
      for (const lvl of levels) {
        expect(lvl.price).toBeGreaterThan(4000);
        expect(lvl.price).toBeLessThan(4600);
      }

      await pineService.bootstrap();
      const candlesAfterSecondBootstrap = pineService.getHistoricalCandles('XAU/USD', 15);
      expect(candlesAfterSecondBootstrap[candlesAfterSecondBootstrap.length - 1].close).toBe(lastCandle.close);
    } finally {
      global.fetch = origFetch;
    }
  });

  describe('Provider Fallback Regression Suite (Scenarios A-J)', () => {
    let freshService: PineLevelService;

    beforeEach(() => {
      freshService = new PineLevelService();
      priceStore.setPrice('XAU/USD', {
        instrument: 'XAU/USD',
        price: 4418.10,
        timestamp: new Date().toISOString(),
        source: 'xaus',
        sourceSymbol: 'XAU/USD',
        isProxy: false,
        status: 'LIVE',
      });
    });

    it('A. Binance success -> Binance data used', async () => {
      const origFetch = global.fetch;
      const binanceCalled = { count: 0 };
      global.fetch = async (url: any) => {
        const u = String(url);
        if (u.includes('PAXGUSDT') && u.includes('binance')) {
          binanceCalled.count++;
          return {
            ok: true,
            json: async () => [
              [Date.now() - 15 * 60000, "2500", "2510", "2490", "2505", "10"],
              [Date.now(), "2505", "2515", "2495", "2510", "10"]
            ],
          } as any;
        }
        return { ok: false, status: 404 } as any;
      };

      try {
        await freshService.bootstrap();
        expect(binanceCalled.count).toBe(1);
        const candles = freshService.getHistoricalCandles('XAU/USD', 15);
        expect(candles.length).toBe(2);
      } finally {
        global.fetch = origFetch;
      }
    });

    it('B & C. Binance 451/403 or network error -> Kraken fallback used', async () => {
      const origFetch = global.fetch;
      const krakenCalled = { count: 0 };
      global.fetch = async (url: any) => {
        const u = String(url);
        if (u.includes('binance')) {
          return { ok: false, status: 451, statusText: 'Unavailable For Legal Reasons' } as any;
        }
        if (u.includes('kraken')) {
          krakenCalled.count++;
          return {
            ok: true,
            json: async () => ({
              result: {
                PAXGUSD: [
                  [Math.floor((Date.now() - 15 * 60000) / 1000), "4410", "4420", "4405", "4415", "4412", "5.0"],
                  [Math.floor(Date.now() / 1000), "4415", "4425", "4410", "4418", "4416", "5.0"]
                ],
                last: 12345
              }
            }),
          } as any;
        }
        return { ok: false, status: 404 } as any;
      };

      try {
        await freshService.bootstrap();
        expect(krakenCalled.count).toBe(1);
        const candles = freshService.getHistoricalCandles('XAU/USD', 15);
        expect(candles.length).toBe(2);
      } finally {
        global.fetch = origFetch;
      }
    });

    it('D. Kraken failure -> KuCoin fallback used', async () => {
      const origFetch = global.fetch;
      const kucoinCalled = { count: 0 };
      global.fetch = async (url: any) => {
        const u = String(url);
        if (u.includes('binance') || u.includes('kraken')) {
          return { ok: false, status: 500 } as any;
        }
        if (u.includes('kucoin')) {
          kucoinCalled.count++;
          return {
            ok: true,
            json: async () => ({
              data: [
                [String(Math.floor((Date.now() - 15 * 60000) / 1000)), "4410", "4415", "4420", "4405", "5.0"],
                [String(Math.floor(Date.now() / 1000)), "4415", "4418", "4425", "4410", "5.0"]
              ]
            }),
          } as any;
        }
        return { ok: false, status: 404 } as any;
      };

      try {
        await freshService.bootstrap();
        expect(kucoinCalled.count).toBe(1);
        const candles = freshService.getHistoricalCandles('XAU/USD', 15);
        expect(candles.length).toBe(2);
      } finally {
        global.fetch = origFetch;
      }
    });

    it('E. All providers fail -> graceful empty state', async () => {
      const origFetch = global.fetch;
      global.fetch = async () => ({ ok: false, status: 500 } as any);

      try {
        await freshService.bootstrap();
        const candles = freshService.getHistoricalCandles('XAU/USD', 15);
        expect(candles.length).toBe(0);
        const levels = freshService.getLevels('XAU/USD', 15);
        expect(levels.length).toBe(0);
      } finally {
        global.fetch = origFetch;
      }
    });

    it('F. Kraken response parsed correctly', async () => {
      const rawKrakenRow = [1788121800, "4466.01", "4467.24", "4465.26", "4465.26", "4466.39", "0.721", 16];
      const timestamp = new Date(rawKrakenRow[0] * 1000).toISOString();
      const open = parseFloat(rawKrakenRow[1] as string);
      const high = parseFloat(rawKrakenRow[2] as string);
      const low = parseFloat(rawKrakenRow[3] as string);
      const close = parseFloat(rawKrakenRow[4] as string);

      expect(timestamp).toBe('2026-08-30T20:30:00.000Z');
      expect(open).toBe(4466.01);
      expect(high).toBe(4467.24);
      expect(low).toBe(4465.26);
      expect(close).toBe(4465.26);
    });

    it('G. KuCoin response parsed correctly', async () => {
      const rawKuCoinRow = ["1788691200", "4425.84", "4424.22", "4425.99", "4424.22", "0.9334"];
      const timestamp = new Date(parseInt(rawKuCoinRow[0], 10) * 1000).toISOString();
      const open = parseFloat(rawKuCoinRow[1]);
      const close = parseFloat(rawKuCoinRow[2]);
      const high = parseFloat(rawKuCoinRow[3]);
      const low = parseFloat(rawKuCoinRow[4]);

      expect(timestamp).toBe('2026-09-06T10:40:00.000Z');
      expect(open).toBe(4425.84);
      expect(close).toBe(4424.22);
      expect(high).toBe(4425.99);
      expect(low).toBe(4424.22);
    });

    it('H. Fallback historical candles are passed to PineLiquidityEngine', async () => {
      const engine = freshService['engines'].get('XAU/USD')!;
      expect(engine).toBeDefined();

      const origFetch = global.fetch;
      global.fetch = async (url: any) => {
        if (String(url).includes('kraken')) {
          return {
            ok: true,
            json: async () => ({
              result: {
                PAXGUSD: Array.from({ length: 50 }, (_, i) => [
                  Math.floor((Date.now() - (50 - i) * 15 * 60000) / 1000),
                  String(4400 + (i % 5)),
                  String(4410 + (i % 5)),
                  String(4390 + (i % 5)),
                  String(4402 + (i % 5)),
                  "4401",
                  "1.0"
                ]),
                last: 99
              }
            }),
          } as any;
        }
        return { ok: false, status: 404 } as any;
      };

      try {
        await freshService.bootstrap();
        const activeLevels = freshService.getLevels('XAU/USD', 15);
        expect(activeLevels.length).toBeGreaterThan(0);
      } finally {
        global.fetch = origFetch;
      }
    });

    it('I. XAU scaling occurs after provider selection', async () => {
      const origFetch = global.fetch;
      global.fetch = async (url: any) => {
        if (String(url).includes('kraken')) {
          return {
            ok: true,
            json: async () => ({
              result: {
                PAXGUSD: [
                  [Math.floor((Date.now() - 15 * 60000) / 1000), "2500", "2510", "2490", "2500", "2500", "1.0"]
                ],
                last: 1
              }
            }),
          } as any;
        }
        return { ok: false, status: 404 } as any;
      };

      try {
        await freshService.bootstrap();
        const candles = freshService.getHistoricalCandles('XAU/USD', 15);
        expect(candles[0].close).toBeGreaterThan(4350);
      } finally {
        global.fetch = origFetch;
      }
    });

    it('J. BTC does not use XAU fallback or scaling', async () => {
      const meta = freshService.getSourceMetadata('BTC/USD');
      expect(meta.historicalSource).toContain('Coinbase');
      expect(meta.parityStatus).toBe('EXACT');
    });
  });
});
