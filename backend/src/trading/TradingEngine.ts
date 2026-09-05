import { MarketOrderRequest, LimitOrderRequest, Position, PendingOrder, ExitReason } from "./types";
import { positionStore } from "./PositionStore";
import { pendingOrderStore } from "./PendingOrderStore";
import { priceStore } from "../market/MarketPriceStore";
import { tradeRepository } from "../db/TradeRepository";
import { pendingOrderRepository } from "../db/PendingOrderRepository";
import { pineLevelService } from "../alerts/PineLevelService";
import { randomUUID } from "crypto";

import { validatePositionModification } from "./validation";

export class TradingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TradingError";
  }
}

export class TradingEngine {
  constructor() {
    // Subscribe to market price updates to process ticks (SL/TP, Limit Fills, Unrealized PnL)
    priceStore.subscribe((marketPrice) => {
      this.processMarketTick(marketPrice.instrument, marketPrice.price, marketPrice.status);
    });
  }

  private processMarketTick(instrument: string, currentPrice: number, status: string) {
    // Only process automated executions on LIVE prices
    if (status !== "LIVE") return;

    // 1. Process Pending Orders
    const pendingOrders = pendingOrderStore.getAllPending().filter(o => o.instrument === instrument);
    for (const order of pendingOrders) {
      let shouldFill = false;

      if (order.side === "LONG" && currentPrice <= order.limitPrice) {
        shouldFill = true;
      } else if (order.side === "SHORT" && currentPrice >= order.limitPrice) {
        shouldFill = true;
      }

      if (shouldFill) {
        if (pendingOrderStore.tryTransitionToFilled(order.id)) {
          const now = new Date().toISOString();
          const position: Position = {
            id: randomUUID(),
            userId: order.userId,
            instrument: order.instrument,
            side: order.side,
            quantity: order.quantity,
            entryPrice: order.limitPrice, // Limit order paper execution simulates exact fill
            entryTime: now,
            status: "OPEN",
            stopLoss: order.stopLoss,
            takeProfit: order.takeProfit,
            unrealizedPnl: 0,
            strategy: order.strategy,
            signalId: order.signalId,
            orderType: "LIMIT",
            createdAt: now,
            updatedAt: now,
          };

          // Synchronously finish in-memory fill and add position
          pendingOrderStore.finishFill(order, position.id);
          positionStore.add(position);

          // Asynchronously persist to DB with failure rollback
          pendingOrderRepository.atomicFillAndCreateTrade(order.userId, order, position).then((success) => {
            if (!success) {
              // Rollback in-memory status if DB check failed (e.g. order cancelled concurrently in DB)
              order.status = "PENDING";
              order.filledAt = undefined;
              order.positionId = undefined;
              pendingOrderStore.update(order);
              positionStore.remove(position.id);
            }
          }).catch((err: any) => {
            console.error("[TradingEngine] Failed to persist pending order fill:", err.message);
            // Rollback in-memory status on DB error
            order.status = "PENDING";
            order.filledAt = undefined;
            order.positionId = undefined;
            pendingOrderStore.update(order);
            positionStore.remove(position.id);
          });
        }
      }
    }

    // 2. Process SL/TP on OPEN positions (including newly created ones)
    const openPositions = positionStore.getAllOpen().filter(p => p.instrument === instrument);
    for (const position of openPositions) {
      let exitReason: ExitReason | null = null;

      if (position.side === "LONG") {
        if (position.stopLoss != null && currentPrice <= position.stopLoss) {
          exitReason = "STOP_LOSS";
        } else if (position.takeProfit != null && currentPrice >= position.takeProfit) {
          exitReason = "TAKE_PROFIT";
        }
      } else { // SHORT
        if (position.stopLoss != null && currentPrice >= position.stopLoss) {
          exitReason = "STOP_LOSS";
        } else if (position.takeProfit != null && currentPrice <= position.takeProfit) {
          exitReason = "TAKE_PROFIT";
        }
      }

      if (exitReason) {
        if (positionStore.tryTransitionToClosing(position.id)) {
          this.executeClose(position, currentPrice, exitReason).catch((err: any) => {
            console.error(`[TradingEngine] SL/TP close failed for position ${position.id}:`, err.message);
          });
        }
      } else {
        // 3. Update unrealized P/L for positions that didn't close
        if (position.side === "LONG") {
          position.unrealizedPnl = (currentPrice - position.entryPrice) * position.quantity;
        } else {
          position.unrealizedPnl = (position.entryPrice - currentPrice) * position.quantity;
        }
        
        position.updatedAt = new Date().toISOString();
        positionStore.update(position);
      }
    }
  }

  private async executeClose(position: Position, exitPrice: number, exitReason: ExitReason): Promise<Position> {
    const now = new Date().toISOString();

    const realizedPnl = position.side === "LONG"
      ? (exitPrice - position.entryPrice) * position.quantity
      : (position.entryPrice - exitPrice) * position.quantity;

    position.exitPrice = exitPrice;
    position.exitTime = now;
    position.exitReason = exitReason;
    position.status = "CLOSED";
    position.realizedPnl = realizedPnl;
    position.unrealizedPnl = 0;
    position.updatedAt = now;

    // Persist close to DB BEFORE final in-memory state transition & WS broadcast
    try {
      await tradeRepository.closeTrade(position.userId, position);
    } catch (err: any) {
      // Revert in-memory status back to OPEN on DB error so state is not falsely CLOSED
      position.status = "OPEN";
      position.exitPrice = undefined;
      position.exitTime = undefined;
      position.exitReason = undefined;
      position.realizedPnl = undefined;
      position.updatedAt = new Date().toISOString();
      positionStore.update(position);
      console.error(`[TradingEngine] Failed to persist trade close for position ${position.id}:`, err.message);
      throw err;
    }

    // Persist succeeded -> finish in-memory close and emit WS positionClosed event
    positionStore.finishClose(position);

    return position;
  }

  private executedKeys: Map<string, number> = new Map();

  public validateAndResolveSignal(req: MarketOrderRequest | LimitOrderRequest): { strategy: string; signalId?: string } {
    // 1. Idempotency check
    if (req.idempotencyKey) {
      if (this.executedKeys.has(req.idempotencyKey)) {
        throw new TradingError("Duplicate order execution request.");
      }
      this.executedKeys.set(req.idempotencyKey, Date.now());
      if (this.executedKeys.size > 500) {
        const now = Date.now();
        for (const [k, v] of this.executedKeys.entries()) {
          if (now - v > 60000) this.executedKeys.delete(k);
        }
      }
    }

    if (!req.signalId) {
      return { strategy: req.strategy || "Manual Trade" };
    }

    // 2. Validate signal via PineLevelService
    const signal = pineLevelService.getSignalById(req.instrument, req.signalId);
    if (!signal || signal.status !== "ACTIVE") {
      throw new TradingError("Signal has expired or is invalid.");
    }

    if (signal.instrument !== req.instrument) {
      throw new TradingError("Signal instrument mismatch.");
    }

    if (signal.strategy === "ORDER_BLOCK") {
      throw new TradingError("Order Block strategy is not supported.");
    }

    // 3. Direction safety check
    const expectedSide = signal.direction === "BUY" ? "BUY" : "SELL";
    if (req.side !== expectedSide) {
      // User manually altered direction away from signal -> do not attribute signal to trade
      return { strategy: req.strategy && req.strategy !== signal.strategy ? req.strategy : "Manual Trade" };
    }

    return {
      strategy: signal.strategy,
      signalId: signal.signalId,
    };
  }

  async openPosition(userId: string, req: MarketOrderRequest): Promise<Position> {
    const marketPrice = priceStore.getPrice(req.instrument);
    if (!marketPrice) {
      throw new TradingError(`No market data available for ${req.instrument}.`);
    }

    if (marketPrice.status === "STALE" || marketPrice.status === "OFFLINE") {
      throw new TradingError(`Market data for ${req.instrument} is ${marketPrice.status}. Cannot execute order.`);
    }

    const { strategy, signalId } = this.validateAndResolveSignal(req);
    const now = new Date().toISOString();
    
    const position: Position = {
      id: randomUUID(),
      userId,
      instrument: req.instrument,
      side: req.side === "BUY" ? "LONG" : "SHORT",
      quantity: req.quantity,
      entryPrice: marketPrice.price,
      entryTime: now,
      status: "OPEN",
      stopLoss: req.stopLoss,
      takeProfit: req.takeProfit,
      unrealizedPnl: 0,
      strategy,
      signalId,
      orderType: "Market",
      createdAt: now,
      updatedAt: now,
    };

    try {
      await tradeRepository.insert(userId, position);
    } catch (err: any) {
      console.error("[TradingEngine] Failed to persist open position:", err.message);
      throw new TradingError(`Failed to persist trade to database: ${err.message}`);
    }

    positionStore.add(position);
    return position;
  }

  async closePosition(userId: string, positionId: string): Promise<Position> {
    const position = positionStore.get(positionId);

    if (!position) {
      throw new TradingError("Position not found.");
    }

    if (position.userId !== userId) {
      throw new TradingError("Position does not belong to the authenticated user.");
    }

    const marketPrice = priceStore.getPrice(position.instrument);
    if (!marketPrice) {
      throw new TradingError(`No market data available for ${position.instrument}.`);
    }

    // Atomically transition to CLOSING to prevent double close
    if (!positionStore.tryTransitionToClosing(positionId)) {
      throw new TradingError("Position is already closed or closing.");
    }

    await this.executeClose(position, marketPrice.price, "MANUAL");
    return position;
  }

  async modifyPosition(
    userId: string,
    positionId: string,
    updates: { stopLoss?: number | null; takeProfit?: number | null }
  ): Promise<Position> {
    const position = positionStore.get(positionId);

    if (!position) {
      throw new TradingError("Position not found.");
    }

    if (position.userId !== userId) {
      throw new TradingError("Position does not belong to the authenticated user.");
    }

    if (position.status !== "OPEN") {
      throw new TradingError(`Cannot modify position in status: ${position.status}`);
    }

    const marketPrice = priceStore.getPrice(position.instrument);
    const currentPrice = marketPrice ? marketPrice.price : position.entryPrice;

    const newStopLoss = updates.stopLoss !== undefined ? updates.stopLoss : position.stopLoss;
    const newTakeProfit = updates.takeProfit !== undefined ? updates.takeProfit : position.takeProfit;

    validatePositionModification(
      position.side,
      position.entryPrice,
      currentPrice,
      newStopLoss,
      newTakeProfit
    );

    position.stopLoss = newStopLoss;
    position.takeProfit = newTakeProfit;
    position.updatedAt = new Date().toISOString();

    try {
      await tradeRepository.update(userId, position);
    } catch (err: any) {
      console.error(`[TradingEngine] Failed to persist position modification for ${positionId}:`, err.message);
      throw new TradingError(`Failed to persist position modification to database: ${err.message}`);
    }

    positionStore.update(position);
    return position;
  }

  async openLimitOrder(userId: string, req: LimitOrderRequest): Promise<PendingOrder> {
    const marketPrice = priceStore.getPrice(req.instrument);
    if (!marketPrice) {
      throw new TradingError(`No market data available for ${req.instrument}.`);
    }

    if (marketPrice.status === "STALE" || marketPrice.status === "OFFLINE") {
      throw new TradingError(`Market data for ${req.instrument} is ${marketPrice.status}. Cannot execute order.`);
    }

    const { strategy, signalId } = this.validateAndResolveSignal(req);
    const now = new Date().toISOString();
    
    const order: PendingOrder = {
      id: randomUUID(),
      userId,
      instrument: req.instrument,
      side: req.side === "BUY" ? "LONG" : "SHORT",
      quantity: req.quantity,
      limitPrice: req.limitPrice,
      stopLoss: req.stopLoss,
      takeProfit: req.takeProfit,
      status: "PENDING",
      strategy,
      signalId,
      createdAt: now,
      updatedAt: now,
    };

    try {
      await pendingOrderRepository.insert(userId, order);
    } catch (err: any) {
      console.error("[TradingEngine] Failed to persist limit order:", err.message);
      throw new TradingError(`Failed to persist limit order to database: ${err.message}`);
    }

    pendingOrderStore.add(order);
    return order;
  }

  async cancelLimitOrder(userId: string, orderId: string): Promise<PendingOrder> {
    const order = pendingOrderStore.get(orderId);

    if (!order) {
      throw new TradingError("Order not found.");
    }

    if (order.userId !== userId) {
      throw new TradingError("Order does not belong to the authenticated user.");
    }

    if (!pendingOrderStore.tryTransitionToCancelled(orderId)) {
      throw new TradingError(`Cannot cancel order in status: ${order.status}`);
    }

    const cancelledOrder = { ...order, status: "CANCELLED" as const, updatedAt: new Date().toISOString() };

    try {
      await pendingOrderRepository.cancel(userId, cancelledOrder);
    } catch (err: any) {
      console.error(`[TradingEngine] Failed to persist order cancellation for ${orderId}:`, err.message);
      // Revert in-memory status on DB error
      order.status = "PENDING";
      throw new TradingError(`Failed to persist order cancellation to database: ${err.message}`);
    }

    return order;
  }
}

export const tradingEngine = new TradingEngine();
