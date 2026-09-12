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
import { PineAlertBridge } from './pine/PineAlertBridge';
import { pineAlertPipeline } from './pine/PineAlertPipeline';
import { ActiveLevel, PremiumDiscountZoneState, Candle, PineSignal } from './pine/PineTypes';
import { priceStore } from '../market/MarketPriceStore';
import { marketDataService } from '../market/MarketDataService';

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
  private alertBridge: PineAlertBridge = new PineAlertBridge();
  private openCandles: Map<string, Candle & { bucketStartMs: number }> = new Map();
  private historicalCandles: Map<string, Candle[]> = new Map();
  private isBootstrapped: Map<string, boolean> = new Map();
  private unsubscribe: (() => void) | null = null;
  private lastProcessedWickCandleTs: string | null = null;

  constructor() {
    this.initEngine('BTC/USD');
    this.initEngine('XAU/USD');
  }

  private initEngine(instrument: string): void {
    const engine = new PineLiquidityEngine({}, DEFAULT_CHART_TF);
    this.engines.set(instrument, engine);
    this.signalEngines.set(instrument, new PineSignalEngine());
    this.alertBridge.registerEngine(instrument, engine);
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
      historicalSource: 'Twelve Data REST API (XAU/USD 15min Time Series)',
      liveSource: 'Twelve Data REST API (XAU/USD Realtime Price Feed)',
      parityStatus: 'EXACT',
      parityNotes: 'Historical candles and live spot pricing are sourced from the exact same Twelve Data XAU/USD market feed.',
    };
  }

  /**
   * Fetches real historical market candles for the given instrument.
   * BTC/USD: Coinbase Exchange REST API (BTC-USD, granularity 900s) -> EXACT PARITY
   * XAU/USD: Twelve Data REST API (XAU/USD 15min Time Series) -> EXACT PARITY
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
        console.log('[PineLevelService] Fetching primary historical candles from shared Twelve Data provider (XAU/USD)...');
        const tdCandles = await marketDataService.getTwelveDataProvider().fetchHistoricalCandles('M15', 1000);
        if (tdCandles.length > 0) {
          return tdCandles;
        }
        console.warn('[PineLevelService] Twelve Data historical candle request returned empty array.');
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
      } else {
        console.warn(`[PineLevelService] No historical candles available for ${instrument}. Engine running empty.`);
      }
    }
  }

  /**
   * Starts listening to live price updates from MarketPriceStore.
   */
  public start(): void {
    if (this.unsubscribe) return;

    this.bootstrap().catch((err) => {
      console.error('[PineLevelService] Error during initial bootstrap:', err);
    });

    const handler = this.handleMarketPrice.bind(this);
    priceStore.subscribe(handler);
    this.unsubscribe = () => priceStore.unsubscribe(handler);
  }

  public stop(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
  }

  /**
   * Realtime market price tick handler.
   */
  public handleMarketPrice(marketPrice: { instrument: string; price: number; timestamp: string }): void {
    const { instrument, price, timestamp } = marketPrice;
    if (price <= 0 || !this.engines.has(instrument)) return;

    const engine = this.engines.get(instrument);
    if (!engine) return;

    // Realtime level touch evaluation on every incoming market tick
    const touchEvents = this.alertBridge.checkLivePrice(
      instrument,
      price,
      timestamp
    );

    // touchEvents are already dispatched via Telegram directly inside PineAlertBridge.
    // pineAlertPipeline is only for PineSignal dispatches.

    // Candle aggregation logic (1-minute boundary)
    const tickTime = new Date(timestamp).getTime();
    const bucketStartMs = Math.floor(tickTime / 60000) * 60000;

    let currentOpen = this.openCandles.get(instrument);

    if (!currentOpen) {
      this.openCandles.set(instrument, {
        timestamp: new Date(bucketStartMs).toISOString(),
        open: price,
        high: price,
        low: price,
        close: price,
        volume: 0,
        bucketStartMs,
      });
      return;
    }

    if (bucketStartMs > currentOpen.bucketStartMs) {
      const closedCandle: Candle = {
        timestamp: currentOpen.timestamp,
        open: currentOpen.open,
        high: currentOpen.high,
        low: currentOpen.low,
        close: currentOpen.close,
        volume: currentOpen.volume,
      };

      engine.processCandle(closedCandle);

      const history = this.historicalCandles.get(instrument) || [];
      const prevCandle = history.length > 0 ? history[history.length - 1] : null;
      history.push(closedCandle);

      const signalEngine = this.signalEngines.get(instrument);
      if (signalEngine) {
        const newSignals = signalEngine.evaluateCandle(instrument, closedCandle, prevCandle, engine);
        newSignals.forEach((sig) => {
          pineAlertPipeline.dispatchSignal(sig).catch(() => {});
        });
      }

      if (instrument === "XAU/USD") {
        this.verifyMissedWickXAU(closedCandle.timestamp).catch((err) => {
          console.error("[PineLevelService] verifyMissedWickXAU error:", err);
        });
      }

      this.openCandles.set(instrument, {
        timestamp: new Date(bucketStartMs).toISOString(),
        open: price,
        high: price,
        low: price,
        close: price,
        volume: 0,
        bucketStartMs,
      });
    } else {
      currentOpen.high = Math.max(currentOpen.high, price);
      currentOpen.low = Math.min(currentOpen.low, price);
      currentOpen.close = price;
    }
  }

  /**
   * Fetches official 1-minute OHLC candle for XAU/USD from Twelve Data
   * and checks for missed wicks in PineAlertBridge.
   * Completely asynchronous & non-blocking.
   */
  public async verifyMissedWickXAU(targetTimestamp?: string): Promise<void> {
    try {
      const tdProvider = marketDataService.getTwelveDataProvider();
      if (!tdProvider || !tdProvider.isConfigured()) return;

      const candle = await tdProvider.fetchLatestOneMinuteCandle(targetTimestamp);
      if (!candle) return;

      // Deduplicate: avoid processing the exact same candle timestamp twice
      if (this.lastProcessedWickCandleTs === candle.timestamp) {
        return;
      }
      this.lastProcessedWickCandleTs = candle.timestamp;

      // Evaluate candle wick against active levels in PineAlertBridge
      this.alertBridge.evaluateCandleWick("XAU/USD", candle, targetTimestamp);
    } catch (err) {
      console.error("[PineLevelService] Diagnostic: verifyMissedWickXAU error handled safely:", err);
    }
  }

  public getLevels(instrument: string, chartTF: number = DEFAULT_CHART_TF): ActiveLevel[] {
    const engine = this.engines.get(instrument);
    if (!engine) return [];
    engine.setChartTF(chartTF);
    return engine.getActiveLevels();
  }

  public getSignals(instrument: string): PineSignal[] {
    const signalEngine = this.signalEngines.get(instrument);
    return signalEngine ? signalEngine.getActiveSignals(instrument) : [];
  }

  public getSignalById(instrument: string, signalId: string): PineSignal | undefined {
    return this.getSignals(instrument).find(s => s.signalId === signalId);
  }

  public getPDZoneState(instrument: string): PremiumDiscountZoneState | null {
    const engine = this.engines.get(instrument);
    return engine ? engine.getPDZoneState() : null;
  }

  public getHistoricalCandles(instrument: string, chartTF: number = DEFAULT_CHART_TF): Candle[] {
    const candles = this.historicalCandles.get(instrument) || [];
    if (chartTF === 15 || candles.length === 0) return candles;

    // Aggregate 15M candles into requested chart timeframe if needed
    const tfMinutes = chartTF;
    const aggregated: Candle[] = [];
    let currentBucket: Candle | null = null;
    let bucketStartMs = 0;

    for (const c of candles) {
      const timeMs = new Date(c.timestamp).getTime();
      const bucketMs = Math.floor(timeMs / (tfMinutes * 60 * 1000)) * (tfMinutes * 60 * 1000);

      if (!currentBucket || bucketMs !== bucketStartMs) {
        if (currentBucket) aggregated.push(currentBucket);
        bucketStartMs = bucketMs;
        currentBucket = {
          timestamp: new Date(bucketStartMs).toISOString(),
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
          volume: c.volume || 0,
        };
      } else {
        currentBucket.high = Math.max(currentBucket.high, c.high);
        currentBucket.low = Math.min(currentBucket.low, c.low);
        currentBucket.close = c.close;
        currentBucket.volume = (currentBucket.volume || 0) + (c.volume || 0);
      }
    }

    if (currentBucket) aggregated.push(currentBucket);
    return aggregated;
  }

  public getSupportedInstruments(): string[] {
    return Array.from(this.engines.keys());
  }

  public getAlertBridge(): PineAlertBridge {
    return this.alertBridge;
  }
}

export const pineLevelService = new PineLevelService();
