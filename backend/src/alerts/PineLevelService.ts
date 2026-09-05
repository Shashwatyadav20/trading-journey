/**
 * PineLevelService
 * ================
 * Singleton that owns one PineLiquidityEngine & PineSignalEngine per instrument.
 *
 * Bootstraps each engine with historical market candles on startup
 * so that historical liquidity levels (HTF EQH/EQL, PWH/PWL, Swings, P/D Zone)
 * and strategy signals are calculated immediately before live ticks arrive.
 *
 * Realtime flow:
 *   - Subscribes to MarketPriceStore for live ticks.
 *   - Aggregates ticks into 1-minute open candles.
 *   - Closes complete minute candles, feeds them to PineLiquidityEngine,
 *     and evaluates PineSignalEngine strategy rules.
 *   - Dispatches detected signals to PineAlertPipeline (Telegram & WhatsApp adapters).
 *   - Preserves state seamlessly across historical → live boundary.
 *   - NO AUTO-TRADING: Signals are pure analytical setup records.
 */
import { PineLiquidityEngine } from './pine/PineLiquidityEngine';
import { PineSignalEngine } from './pine/PineSignalEngine';
import { pineAlertPipeline } from './pine/PineAlertPipeline';
import { ActiveLevel, PremiumDiscountZoneState, Candle, PineSignal } from './pine/PineTypes';
import { priceStore } from '../market/MarketPriceStore';

const DEFAULT_CHART_TF = 15;

export interface MarketSourceMetadata {
  instrument: string;
  historicalSource: string;
  liveSource: string;
  parityStatus: 'EXACT' | 'PARTIAL';
  parityNotes: string;
}

export class PineLevelService {
  private engines: Map<string, PineLiquidityEngine> = new Map();
  private signalEngines: Map<string, PineSignalEngine> = new Map();
  private openCandles: Map<string, Candle & { bucketStartMs: number }> = new Map();
  private historicalCandles: Map<string, Candle[]> = new Map();
  private isBootstrapped: Map<string, boolean> = new Map();
  private unsubscribe: (() => void) | null = null;

  constructor() {
    this.initEngine('BTC/USD');
    this.initEngine('XAU/USD');
  }

  private initEngine(instrument: string): void {
    this.engines.set(instrument, new PineLiquidityEngine({}, DEFAULT_CHART_TF));
    this.signalEngines.set(instrument, new PineSignalEngine());
    this.openCandles.delete(instrument);
    this.isBootstrapped.set(instrument, false);
  }

  /**
   * Returns explicit market source metadata for consistency verification.
   */
  public getSourceMetadata(instrument: string): MarketSourceMetadata {
    if (instrument === 'BTC/USD') {
      return {
        instrument: 'BTC/USD',
        historicalSource: 'Coinbase Exchange REST API (BTC-USD, granularity=900s)',
        liveSource: 'Coinbase WebSocket Feed (BTC-USD channel ticker/ticker_batch)',
        parityStatus: 'EXACT',
        parityNotes: 'Historical candles and live tick stream are sourced from the exact same Coinbase exchange product (BTC-USD).',
      };
    }
    return {
      instrument: 'XAU/USD',
      historicalSource: 'Binance PAXGUSDT Spot Physical Gold (15M klines)',
      liveSource: 'Xaus Gold Spot API (xaus.com/api/v1/spot)',
      parityStatus: 'PARTIAL',
      parityNotes: 'Xaus Gold API is a spot-only ticker feed with no historical candle REST API. Binance PAXGUSDT spot physical gold (1 PAXG = 1 oz Gold) provides real 15M historical OHLC candles.',
    };
  }

  /**
   * Fetches real historical market candles for the given instrument.
   * BTC/USD: Coinbase Exchange REST API (BTC-USD, granularity 900s) -> EXACT PARITY
   * XAU/USD: Binance PAXGUSDT spot physical gold (15M klines) -> PARTIAL PARITY
   */
  private async fetchHistoricalCandles(instrument: string): Promise<Candle[]> {
    try {
      if (instrument === 'BTC/USD') {
        const url = 'https://api.exchange.coinbase.com/products/BTC-USD/candles?granularity=900';
        const res = await fetch(url, {
          headers: { 'User-Agent': 'TradingApp/1.0' },
        });

        if (res.ok) {
          const raw = await res.json();
          const candles: Candle[] = raw.map((d: any) => ({
            timestamp: new Date(d[0] * 1000).toISOString(),
            open: parseFloat(d[3]),
            high: parseFloat(d[2]),
            low: parseFloat(d[1]),
            close: parseFloat(d[4]),
            volume: parseFloat(d[5]),
          }));

          candles.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
          if (candles.length > 0) return candles;
        }

        console.warn('[PineLevelService] Coinbase REST API unavailable, falling back to Binance BTCUSDT...');
        const fallbackUrl = 'https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=15m&limit=500';
        const fallbackRes = await fetch(fallbackUrl);
        if (fallbackRes.ok) {
          const raw = await fallbackRes.json();
          const candles: Candle[] = raw.map((d: any) => ({
            timestamp: new Date(d[0]).toISOString(),
            open: parseFloat(d[1]),
            high: parseFloat(d[2]),
            low: parseFloat(d[3]),
            close: parseFloat(d[4]),
            volume: parseFloat(d[5]),
          }));
          candles.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
          return candles;
        }
      } else if (instrument === 'XAU/USD') {
        const url = 'https://api.binance.com/api/v3/klines?symbol=PAXGUSDT&interval=15m&limit=1000';
        const res = await fetch(url);
        if (res.ok) {
          const raw = await res.json();
          const candles: Candle[] = raw.map((d: any) => ({
            timestamp: new Date(d[0]).toISOString(),
            open: parseFloat(d[1]),
            high: parseFloat(d[2]),
            low: parseFloat(d[3]),
            close: parseFloat(d[4]),
            volume: parseFloat(d[5]),
          }));
          candles.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
          return candles;
        }
      }

      return [];
    } catch (err) {
      console.error(`[PineLevelService] Failed to fetch historical candles for ${instrument}:`, err);
      return [];
    }
  }

  /**
   * Bootstraps the PineLiquidityEngine & PineSignalEngine for all supported instruments
   * using historical candle data.
   */
  public async bootstrap(): Promise<void> {
    for (const instrument of this.engines.keys()) {
      if (this.isBootstrapped.get(instrument)) continue;

      const engine = this.engines.get(instrument);
      const signalEngine = this.signalEngines.get(instrument);
      if (!engine || !signalEngine) continue;

      const meta = this.getSourceMetadata(instrument);
      console.log(
        `[PineLevelService] Bootstrapping historical candles for ${instrument} ` +
        `[Historical Source: ${meta.historicalSource} | Live Source: ${meta.liveSource} | Parity: ${meta.parityStatus}]...`
      );

      const history = await this.fetchHistoricalCandles(instrument);

      if (history.length > 0) {
        this.historicalCandles.set(instrument, history);

        let prev: Candle | null = null;
        for (const candle of history) {
          engine.processCandle(candle);
          const newSignals = signalEngine.evaluateCandle(instrument, candle, prev, engine);
          newSignals.forEach((sig) => {
            pineAlertPipeline.dispatchSignal(sig).catch(() => {});
          });
          prev = candle;
        }

        this.isBootstrapped.set(instrument, true);

        const activeCount = engine.getActiveLevels().length;
        const activeSignalCount = signalEngine.getActiveSignals(instrument).length;
        const pdZoneState = engine.getPDZoneState();
        console.log(
          `[PineLevelService] Bootstrapped ${history.length} historical candles for ${instrument}. ` +
          `Active levels: ${activeCount}, Active signals: ${activeSignalCount}, P/D zone active: ${pdZoneState.active}`
        );
      }
    }
  }

  /**
   * Starts listening to live priceStore ticks and updating the engine state in realtime.
   */
  start(): void {
    this.bootstrap().catch((err) => {
      console.error('[PineLevelService] Bootstrap error:', err);
    });

    const onPrice = (price: { instrument: string; price: number; timestamp: string }) => {
      const engine = this.engines.get(price.instrument);
      const signalEngine = this.signalEngines.get(price.instrument);
      if (!engine || !signalEngine) return;

      const tickMs = new Date(price.timestamp).getTime();
      const bucketMs = Math.floor(tickMs / (60 * 1000)) * 60 * 1000; // 1-minute bucket

      const open = this.openCandles.get(price.instrument);

      if (!open) {
        this.openCandles.set(price.instrument, {
          bucketStartMs: bucketMs,
          timestamp: new Date(bucketMs).toISOString(),
          open: price.price,
          high: price.price,
          low: price.price,
          close: price.price,
          volume: 0,
        });
        return;
      }

      if (bucketMs === open.bucketStartMs) {
        open.high = Math.max(open.high, price.price);
        open.low = Math.min(open.low, price.price);
        open.close = price.price;
      } else if (bucketMs > open.bucketStartMs) {
        const closed: Candle = {
          timestamp: open.timestamp,
          open: open.open,
          high: open.high,
          low: open.low,
          close: open.close,
          volume: open.volume,
        };

        const hist = this.historicalCandles.get(price.instrument) || [];
        const prevCandle = hist.length > 0 ? hist[hist.length - 1] : null;

        engine.processCandle(closed);
        const newSignals = signalEngine.evaluateCandle(price.instrument, closed, prevCandle, engine);
        newSignals.forEach((sig) => {
          pineAlertPipeline.dispatchSignal(sig).catch(() => {});
        });

        hist.push(closed);
        if (hist.length > 2000) hist.shift();
        this.historicalCandles.set(price.instrument, hist);

        this.openCandles.set(price.instrument, {
          bucketStartMs: bucketMs,
          timestamp: new Date(bucketMs).toISOString(),
          open: price.price,
          high: price.price,
          low: price.price,
          close: price.price,
          volume: 0,
        });
      }
    };

    priceStore.subscribe(onPrice as any);
    this.unsubscribe = () => priceStore.unsubscribe(onPrice as any);
  }

  stop(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
  }

  getLevels(instrument: string, chartTF: number = 15): ActiveLevel[] {
    const engine = this.engines.get(instrument);
    if (!engine) return [];
    if (chartTF) {
      engine.setChartTF(chartTF);
    }
    return engine.getActiveLevels();
  }

  getSignals(instrument: string): PineSignal[] {
    const signalEngine = this.signalEngines.get(instrument);
    if (!signalEngine) return [];
    return signalEngine.getActiveSignals(instrument);
  }

  getSignalById(instrument: string, signalId: string): PineSignal | undefined {
    const signalEngine = this.signalEngines.get(instrument);
    if (!signalEngine) return undefined;
    return signalEngine.getSignalById(signalId);
  }

  getPDZoneState(instrument: string): PremiumDiscountZoneState | null {
    const engine = this.engines.get(instrument);
    if (!engine) return null;
    return engine.getPDZoneState();
  }

  getHistoricalCandles(instrument: string): Candle[] {
    return this.historicalCandles.get(instrument) || [];
  }

  getSupportedInstruments(): string[] {
    return Array.from(this.engines.keys());
  }

  isInstrumentBootstrapped(instrument: string): boolean {
    return this.isBootstrapped.get(instrument) ?? false;
  }
}

export const pineLevelService = new PineLevelService();
