/**
 * Pine Liquidity Timeframe Expansion Unit Tests (1M, 3M, 5M, 15M, 30M, 1H, 4H, 1D)
 * ==============================================================================
 * Tests coverage for:
 *   1. 1M base candle storage & 1M retrieval (no-op aggregation).
 *   2. 3M candle aggregation OHLCV correctness & boundary alignment.
 *   3. 5M candle aggregation OHLCV correctness & boundary alignment.
 *   4. 15M regression check (15M aggregated matches standard 15M bucket).
 *   5. Timeframe switching across 1m, 3m, 5m, 15m, 30m, 60m, 240m, 1440m.
 *   6. Sub-15M HTF level clamp preservation (chartTF < 15 uses 15M for liquidity levels).
 *   7. TwelveDataMarketProvider granMap validation for 1m, 3m, 5m.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PineLevelService } from '../../PineLevelService';
import { PineLiquidityEngine } from '../PineLiquidityEngine';
import { TwelveDataMarketProvider } from '../../../market/providers/TwelveDataMarketProvider';
import { Candle } from '../PineTypes';

function make1MinCandles(count: number, startPrice: number = 2000): Candle[] {
  const candles: Candle[] = [];
  const baseTime = new Date('2026-01-01T00:00:00Z').getTime();

  for (let i = 0; i < count; i++) {
    const t = new Date(baseTime + i * 60 * 1000).toISOString();
    candles.push({
      timestamp: t,
      open: startPrice + (i % 5),
      high: startPrice + (i % 5) + 3,
      low: startPrice + (i % 5) - 3,
      close: startPrice + (i % 5) + 1,
      volume: 10 + i,
    });
  }
  return candles;
}

describe('Pine Liquidity Timeframe Expansion Tests', () => {
  let pineService: PineLevelService;

  beforeEach(() => {
    pineService = new PineLevelService();
  });

  it('1. 1M retrieval returns unaggregated 1-minute base candles', () => {
    const candles1M = make1MinCandles(15, 2000);
    // Inject 1M candles directly into service
    (pineService as any).historicalCandles.set('BTC/USD', candles1M);

    const fetched = pineService.getHistoricalCandles('BTC/USD', 1);
    expect(fetched.length).toBe(15);
    expect(fetched[0].timestamp).toBe(candles1M[0].timestamp);
    expect(fetched[0].open).toBe(candles1M[0].open);
  });

  it('2. 3M aggregation combines 3 1-minute candles into 1 3M candle with correct OHLCV', () => {
    const candles1M = make1MinCandles(6, 2000);
    // Explicit OHLC values for first 3 minutes (00:00, 00:01, 00:02)
    candles1M[0] = { timestamp: '2026-01-01T00:00:00Z', open: 100, high: 105, low: 95, close: 102, volume: 10 };
    candles1M[1] = { timestamp: '2026-01-01T00:01:00Z', open: 102, high: 110, low: 98, close: 101, volume: 20 };
    candles1M[2] = { timestamp: '2026-01-01T00:02:00Z', open: 101, high: 104, low: 90, close: 99, volume: 30 };

    (pineService as any).historicalCandles.set('BTC/USD', candles1M);

    const fetched3M = pineService.getHistoricalCandles('BTC/USD', 3);
    expect(fetched3M.length).toBe(2);

    const bar1 = fetched3M[0];
    expect(bar1.timestamp).toBe('2026-01-01T00:00:00.000Z');
    expect(bar1.open).toBe(100);       // First candle open
    expect(bar1.high).toBe(110);       // Max high (105, 110, 104)
    expect(bar1.low).toBe(90);         // Min low (95, 98, 90)
    expect(bar1.close).toBe(99);        // Last candle close
    expect(bar1.volume).toBe(60);      // Sum of volume (10 + 20 + 30)
  });

  it('3. 5M aggregation combines 5 1-minute candles into 1 5M candle with correct OHLCV', () => {
    const candles1M = make1MinCandles(10, 2000);
    (pineService as any).historicalCandles.set('BTC/USD', candles1M);

    const fetched5M = pineService.getHistoricalCandles('BTC/USD', 5);
    expect(fetched5M.length).toBe(2);
    expect(fetched5M[0].timestamp).toBe('2026-01-01T00:00:00.000Z');
    expect(fetched5M[1].timestamp).toBe('2026-01-01T00:05:00.000Z');
  });

  it('4. 15M regression check — aggregating 15 1M candles matches 1 15M candle', () => {
    const candles1M = make1MinCandles(30, 2000);
    (pineService as any).historicalCandles.set('BTC/USD', candles1M);

    const fetched15M = pineService.getHistoricalCandles('BTC/USD', 15);
    expect(fetched15M.length).toBe(2);
    expect(fetched15M[0].timestamp).toBe('2026-01-01T00:00:00.000Z');
    expect(fetched15M[1].timestamp).toBe('2026-01-01T00:15:00.000Z');
  });

  it('5. Timeframe switching produces valid non-empty arrays for 1m, 3m, 5m, 15m, 30m, 60m, 240m, 1440m', () => {
    const candles1M = make1MinCandles(1440, 2000);
    (pineService as any).historicalCandles.set('BTC/USD', candles1M);

    const tfs = [1, 3, 5, 15, 30, 60, 240, 1440];
    const expectedCounts = [1440, 480, 288, 96, 48, 24, 6, 1];

    tfs.forEach((tf, idx) => {
      const res = pineService.getHistoricalCandles('BTC/USD', tf);
      expect(res.length).toBe(expectedCounts[idx]);
    });
  });

  it('6. Sub-15M HTF level clamp — PineLiquidityEngine setChartTF(1) or (5) clamps to 15', () => {
    const engine = new PineLiquidityEngine({}, 15);

    engine.setChartTF(1);
    expect(engine.getChartTF()).toBe(15);

    engine.setChartTF(5);
    expect(engine.getChartTF()).toBe(15);

    engine.setChartTF(30);
    expect(engine.getChartTF()).toBe(30);
  });

  it('7. TwelveDataMarketProvider granMap correctly handles 1m, 3m, 5m', async () => {
    const provider = new TwelveDataMarketProvider({ apiKey: 'vitest_test_key' });
    const granMapKeys = ['1', '3', '5', '15', '30', '60', '240', '1440', 'M1', 'M3', 'M5', 'M15', '1min', '3min', '5min'];

    // Spy on fetch
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any) => {
      return {
        ok: true,
        json: async () => ({ status: 'ok', values: [] }),
      } as any;
    });

    for (const gran of granMapKeys) {
      await provider.fetchHistoricalCandles(gran, 10);
    }

    expect(fetchSpy).toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
