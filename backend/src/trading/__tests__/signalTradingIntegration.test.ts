/**
 * Ticket 6: Signal-to-Trading Integration Test Suite
 * ===================================================
 * Covers all required test groups A through J:
 *   A. Signal Preparation & Validation
 *   B. Manual Trade Isolation
 *   C. Market Order Execution
 *   D. Limit Order Execution & Strategy Survival
 *   E. Stale Signal Protection
 *   F. Direction Safety
 *   G. Duplicate Execution Protection (Idempotency)
 *   H. Journal & Repository Persistence
 *   I. User Ownership & Authorization
 *   J. No Auto-Trading Guarantee
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TradingEngine, TradingError } from '../TradingEngine';
import { positionStore } from '../PositionStore';
import { pendingOrderStore } from '../PendingOrderStore';
import { priceStore } from '../../market/MarketPriceStore';
import { pineLevelService } from '../../alerts/PineLevelService';
import { tradeRepository } from '../../db/TradeRepository';
import { pendingOrderRepository } from '../../db/PendingOrderRepository';
import { Candle, ActiveLevel } from '../../alerts/pine/PineTypes';

// Spy on TradeRepository and PendingOrderRepository so unit tests don't fail on missing DB credentials
vi.spyOn(tradeRepository, "insert").mockResolvedValue(undefined);
vi.spyOn(tradeRepository, "update").mockResolvedValue(undefined);
vi.spyOn(tradeRepository, "closeTrade").mockResolvedValue(undefined);

vi.spyOn(pendingOrderRepository, "insert").mockResolvedValue(undefined);
vi.spyOn(pendingOrderRepository, "update").mockResolvedValue(undefined);
vi.spyOn(pendingOrderRepository, "cancel").mockResolvedValue(undefined);
vi.spyOn(pendingOrderRepository, "fill").mockResolvedValue(undefined);
vi.spyOn(pendingOrderRepository, "atomicFillAndCreateTrade").mockResolvedValue(true as any);

function makeCandle(
  open: number,
  high: number,
  low: number,
  close: number,
  timestamp: string = '2026-01-01T12:00:00Z'
): Candle {
  return { timestamp, open, high, low, close, volume: 100 };
}

describe('Ticket 6: Signal-to-Trading Integration Tests', () => {
  let engine: TradingEngine;
  const userId = 'user_test_ticket6';

  beforeEach(() => {
    engine = new TradingEngine();
    positionStore.clear();
    pendingOrderStore.clear();

    // Set live market price
    priceStore.setPrice('BTC/USD', {
      instrument: 'BTC/USD',
      price: 90000,
      timestamp: new Date().toISOString(),
      status: 'LIVE',
      sourceSymbol: 'BTC-USD',
      isProxy: false,
    });

    priceStore.setPrice('XAU/USD', {
      instrument: 'XAU/USD',
      price: 2500,
      timestamp: new Date().toISOString(),
      status: 'LIVE',
      sourceSymbol: 'XAUUSD',
      isProxy: false,
    });
  });

  // ─── A. SIGNAL PREPARATION & VALIDATION ────────────────────────────────────

  it('TEST A1: Active Pine signal is validated and resolved correctly', () => {
    // Inject active level and candle to generate an active EQH signal
    const eqhLevel: ActiveLevel = {
      id: 'eqh-2550',
      type: 'EQH',
      label: 'HTF EQH (15M) 2550.00',
      price: 2550,
      timeframe: '15M',
      color: '#d946ef',
      lineStyle: 'solid',
      lineWidth: 2,
      createdAtBar: 1,
    };

    // Access pineLevelService engines
    const pineEngine = (pineLevelService as any).engines.get('XAU/USD');
    const signalEngine = (pineLevelService as any).signalEngines.get('XAU/USD');
    pineEngine.getActiveLevels = () => [eqhLevel];

    const candle = makeCandle(2540, 2560, 2535, 2555);
    const newSignals = signalEngine.evaluateCandle('XAU/USD', candle, null, pineEngine);
    expect(newSignals.length).toBeGreaterThan(0);

    const activeSignal = newSignals[0];
    const resolved = engine.validateAndResolveSignal({
      instrument: 'XAU/USD',
      side: 'SELL',
      quantity: 1,
      signalId: activeSignal.signalId,
    });

    expect(resolved.strategy).toBe(activeSignal.strategy);
    expect(resolved.signalId).toBe(activeSignal.signalId);
  });

  // ─── B. MANUAL TRADE ISOLATION ──────────────────────────────────────────────

  it('TEST B1: Manual trade remains Manual Trade even when active signals exist', async () => {
    const position = await engine.openPosition(userId, {
      instrument: 'BTC/USD',
      side: 'BUY',
      quantity: 0.1,
      stopLoss: 89000,
      takeProfit: 92000,
    });

    expect(position.strategy).toBe('Manual Trade');
    expect(position.signalId).toBeUndefined();
  });

  // ─── C. MARKET EXECUTION ───────────────────────────────────────────────────

  it('TEST C1: BUY signal confirmed by user executes market order with backend price', async () => {
    const eqlLevel: ActiveLevel = {
      id: 'eql-8950',
      type: 'EQL',
      label: 'HTF EQL (15M) 8950.00',
      price: 8950,
      timeframe: '15M',
      color: '#06b6d4',
      lineStyle: 'solid',
      lineWidth: 2,
      createdAtBar: 1,
    };

    const pineEngine = (pineLevelService as any).engines.get('BTC/USD');
    const signalEngine = (pineLevelService as any).signalEngines.get('BTC/USD');
    pineEngine.getActiveLevels = () => [eqlLevel];

    const candle = makeCandle(8960, 8965, 8940, 8955);
    const signals = signalEngine.evaluateCandle('BTC/USD', candle, null, pineEngine);
    const buySignal = signals.find((s: any) => s.direction === 'BUY')!;

    const position = await engine.openPosition(userId, {
      instrument: 'BTC/USD',
      side: 'BUY',
      quantity: 0.05,
      stopLoss: 89000,
      takeProfit: 93000,
      signalId: buySignal.signalId,
    });

    expect(position.side).toBe('LONG');
    expect(position.entryPrice).toBe(90000); // Uses authoritative backend price
    expect(position.strategy).toBe(buySignal.strategy);
    expect(position.signalId).toBe(buySignal.signalId);
    expect(position.status).toBe('OPEN');
  });

  // ─── D. LIMIT EXECUTION & STRATEGY SURVIVAL ────────────────────────────────

  it('TEST D1: Signal limit order retains strategy metadata when filled', async () => {
    const pwhLevel: ActiveLevel = {
      id: 'pwh-9100',
      type: 'PWH',
      label: 'PWH 9100.00',
      price: 9100,
      timeframe: '1W',
      color: '#f97316',
      lineStyle: 'dashed',
      lineWidth: 2,
      createdAtBar: 1,
    };

    const pineEngine = (pineLevelService as any).engines.get('BTC/USD');
    const signalEngine = (pineLevelService as any).signalEngines.get('BTC/USD');
    pineEngine.getActiveLevels = () => [pwhLevel];

    const candle = makeCandle(9090, 9110, 9080, 9105);
    const signals = signalEngine.evaluateCandle('BTC/USD', candle, null, pineEngine);
    const pwhSignal = signals.find((s: any) => s.strategy === 'PWH_PWL')!;

    // Create limit order
    const pending = await engine.openLimitOrder(userId, {
      instrument: 'BTC/USD',
      side: 'SELL',
      quantity: 0.1,
      limitPrice: 91500,
      stopLoss: 92000,
      takeProfit: 88000,
      signalId: pwhSignal.signalId,
    });

    expect(pending.strategy).toBe('PWH_PWL');
    expect(pending.signalId).toBe(pwhSignal.signalId);

    // Simulate price rising to fill SELL LIMIT
    priceStore.setPrice('BTC/USD', {
      instrument: 'BTC/USD',
      price: 91550,
      timestamp: new Date().toISOString(),
      status: 'LIVE',
      sourceSymbol: 'BTC-USD',
      isProxy: false,
    });

    const openPositions = positionStore.getByUser(userId);
    expect(openPositions.length).toBe(1);
    expect(openPositions[0].strategy).toBe('PWH_PWL');
    expect(openPositions[0].signalId).toBe(pwhSignal.signalId);
  });

  // ─── E. STALE SIGNAL PROTECTION ─────────────────────────────────────────────

  it('TEST E1: Non-existent or expired signal throws TradingError', async () => {
    await expect(
      engine.openPosition(userId, {
        instrument: 'BTC/USD',
        side: 'BUY',
        quantity: 0.1,
        signalId: 'sig_non_existent_123',
      })
    ).rejects.toThrow(TradingError);
  });

  // ─── F. DIRECTION SAFETY ────────────────────────────────────────────────────

  it('TEST F1: Changing direction away from signal clears signalId attribution', () => {
    const swlLevel: ActiveLevel = {
      id: 'swl-2480',
      type: 'SWL',
      label: 'SWL 2480.00',
      price: 2480,
      timeframe: '15M+',
      color: '#ef4444',
      lineStyle: 'dotted',
      lineWidth: 2,
      createdAtBar: 1,
    };

    const pineEngine = (pineLevelService as any).engines.get('XAU/USD');
    const signalEngine = (pineLevelService as any).signalEngines.get('XAU/USD');
    pineEngine.getActiveLevels = () => [swlLevel];

    const candle = makeCandle(2490, 2495, 2475, 2485);
    const signals = signalEngine.evaluateCandle('XAU/USD', candle, null, pineEngine);
    const buySignal = signals.find((s: any) => s.direction === 'BUY')!;

    // User submits order with SELL side despite BUY signal
    const resolved = engine.validateAndResolveSignal({
      instrument: 'XAU/USD',
      side: 'SELL',
      quantity: 1,
      signalId: buySignal.signalId,
    });

    expect(resolved.strategy).toBe('Manual Trade');
    expect(resolved.signalId).toBeUndefined();
  });

  // ─── G. DUPLICATE PROTECTION (IDEMPOTENCY) ─────────────────────────────────

  it('TEST G1: Duplicate order request with same idempotencyKey is rejected', async () => {
    const req = {
      instrument: 'BTC/USD' as const,
      side: 'BUY' as const,
      quantity: 0.1,
      idempotencyKey: 'idemp_key_999',
    };

    await engine.openPosition(userId, req);

    // Second request with same idempotency key fails
    await expect(engine.openPosition(userId, req)).rejects.toThrow('Duplicate order execution request.');
  });

  // ─── H. JOURNAL & REPOSITORY PERSISTENCE ────────────────────────────────────

  it('TEST H1: Position retains strategy field for journal persistence', async () => {
    const position = await engine.openPosition(userId, {
      instrument: 'BTC/USD',
      side: 'BUY',
      quantity: 0.1,
      strategy: 'SWEEP_ENGULFING',
    });

    expect(position.strategy).toBe('SWEEP_ENGULFING');
  });

  // ─── I. USER OWNERSHIP ──────────────────────────────────────────────────────

  it('TEST I1: Positions are strictly scoped to authenticated userId', async () => {
    await engine.openPosition(userId, {
      instrument: 'BTC/USD',
      side: 'BUY',
      quantity: 0.1,
    });

    const user1Positions = positionStore.getByUser(userId);
    const user2Positions = positionStore.getByUser('other_user');

    expect(user1Positions.length).toBe(1);
    expect(user2Positions.length).toBe(0);
  });

  // ─── J. NO AUTO-TRADING GUARANTEE ─────────────────────────────────────────

  it('TEST J1: Signal creation alone produces ZERO trades', () => {
    const swlLevel: ActiveLevel = {
      id: 'swl-2480',
      type: 'SWL',
      label: 'SWL 2480.00',
      price: 2480,
      timeframe: '15M+',
      color: '#ef4444',
      lineStyle: 'dotted',
      lineWidth: 2,
      createdAtBar: 1,
    };

    const pineEngine = (pineLevelService as any).engines.get('XAU/USD');
    const signalEngine = (pineLevelService as any).signalEngines.get('XAU/USD');
    pineEngine.getActiveLevels = () => [swlLevel];

    const candle = makeCandle(2490, 2495, 2475, 2485);
    signalEngine.evaluateCandle('XAU/USD', candle, null, pineEngine);

    // Signals exist in signal engine
    const activeSignals = signalEngine.getActiveSignals('XAU/USD');
    expect(activeSignals.length).toBeGreaterThan(0);

    // ZERO trades created in positionStore
    expect(positionStore.getAllOpen().length).toBe(0);
    expect(pendingOrderStore.getAllPending().length).toBe(0);
  });
});
