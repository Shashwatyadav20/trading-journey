import {
  AutoHedgeSignal,
  NiftySpreadPosition,
  PositionLeg,
  PositionSnapshot,
  NiftyOptionChain,
} from "../types";
import { DEFAULT_NIFTY_CONFIG, NiftyConfig } from "../config/niftyConfig";
import { dailyRiskController } from "../risk/DailyRiskController";
import { paperSessionManager } from "../lifecycle/PaperSessionManager";
import { paperPersistenceManager } from "../persistence/PaperPersistenceManager";
import { auditLogger } from "../audit/AuditLogger";
import { SlippageModel, defaultSlippageModel } from "../risk/SlippageModel";
import { randomUUID } from "crypto";
import {
  IBrokerAdapter,
  BrokerAccount,
  BrokerConnectionStatus,
  BrokerOrder,
  BrokerOrderRequest,
  BrokerOrderResponse,
  BrokerPosition,
  BrokerQuote,
  BrokerInstrument,
} from "./IBrokerAdapter";
import { instrumentMasterResolver } from "./InstrumentMasterResolver";

export class PaperBrokerAdapter implements IBrokerAdapter {
  private config: NiftyConfig;
  private slippageModel: SlippageModel;
  private openPositions: Map<string, NiftySpreadPosition> = new Map();
  private closedPositions: NiftySpreadPosition[] = [];
  private processedSignalIds: Set<string> = new Set();
  private isConnected = true;
  private brokerOrdersMap: Map<string, BrokerOrder> = new Map();

  constructor(
    config: NiftyConfig = DEFAULT_NIFTY_CONFIG,
    slippageModel: SlippageModel = defaultSlippageModel
  ) {
    this.config = config;
    this.slippageModel = slippageModel;
  }

  public setSlippageModel(model: SlippageModel) {
    this.slippageModel = model;
  }

  /**
   * Reconstructs positions state after backend process restart.
   */
  public reconstructState(openPositions: NiftySpreadPosition[], closedPositions: NiftySpreadPosition[]) {
    this.openPositions.clear();
    for (const pos of openPositions) {
      this.openPositions.set(pos.id, pos);
      if (pos.signalId) this.processedSignalIds.add(pos.signalId);
    }
    this.closedPositions = [...closedPositions];
    for (const pos of closedPositions) {
      if (pos.signalId) this.processedSignalIds.add(pos.signalId);
    }
  }

  /**
   * Executes a defined-risk multi-leg spread order in Paper Trading mode.
   * Performs Hedge-First Verification and Idempotency Enforcement.
   */
  public executePaperOrder(
    userId: string,
    signal: AutoHedgeSignal
  ): NiftySpreadPosition {
    if (signal.status !== "READY" || !signal.sellLeg || !signal.buyLeg) {
      throw new Error(`Cannot execute paper order with signal status: ${signal.status}`);
    }

    const signalFingerprint = `${signal.symbol}_${signal.action}_${signal.expiry}_${signal.sellLeg.strike}_${signal.buyLeg.strike}_${signal.timestamp}`;

    // Idempotency check: Reject duplicate signal execution
    if (this.processedSignalIds.has(signalFingerprint)) {
      const existing = Array.from(this.openPositions.values()).find((p) => p.signalId === signalFingerprint);
      if (existing) return existing;
      throw new Error(`Idempotency Block: Duplicate order request for signal ${signalFingerprint}`);
    }

    // Reject invalid or zero quotes
    if (
      signal.buyLeg.ltp <= 0 ||
      signal.sellLeg.ltp <= 0 ||
      (signal.buyLeg.bid <= 0 && signal.buyLeg.ask <= 0) ||
      (signal.sellLeg.bid <= 0 && signal.sellLeg.ask <= 0)
    ) {
      throw new Error("Paper execution rejected: Stale or invalid quotes detected (LTP/bid/ask <= 0)");
    }

    const traceId = randomUUID();
    const nowIso = new Date().toISOString();

    // 1. Hedge-First Execution: Simulate Buy Hedge Leg Fill using SlippageModel
    const buyFill = this.slippageModel.calculateExecutionPrice(
      "BUY",
      signal.buyLeg.ltp,
      signal.buyLeg.bid,
      signal.buyLeg.ask
    );
    const buyLegPrice = buyFill.executionPrice;
    const buyLeg: PositionLeg = {
      symbol: signal.buyLeg.symbol,
      strike: signal.buyLeg.strike,
      optionType: signal.buyLeg.optionType,
      side: "BUY",
      entryPrice: buyLegPrice,
      currentPrice: buyLegPrice,
      quantity: signal.totalQuantity,
      delta: signal.buyLeg.delta,
      status: "FILLED",
    };

    // 2. Simulate Sell Leg Fill using SlippageModel
    const sellFill = this.slippageModel.calculateExecutionPrice(
      "SELL",
      signal.sellLeg.ltp,
      signal.sellLeg.bid,
      signal.sellLeg.ask
    );
    const sellLegPrice = sellFill.executionPrice;
    const sellLeg: PositionLeg = {
      symbol: signal.sellLeg.symbol,
      strike: signal.sellLeg.strike,
      optionType: signal.sellLeg.optionType,
      side: "SELL",
      entryPrice: sellLegPrice,
      currentPrice: sellLegPrice,
      quantity: signal.totalQuantity,
      delta: signal.sellLeg.delta,
      status: "FILLED",
    };

    const actualNetCredit = Number((sellLegPrice - buyLegPrice).toFixed(2));
    const initialSpreadPrice = Number((sellLegPrice - buyLegPrice).toFixed(2));

    const position: NiftySpreadPosition = {
      id: traceId,
      userId,
      signalId: signalFingerprint,
      symbol: signal.symbol,
      strategy: signal.action,
      expiry: signal.expiry,
      sellLeg,
      buyLeg,
      quantityLots: signal.quantityLots,
      totalQuantity: signal.totalQuantity,
      netCredit: actualNetCredit,
      maxLoss: signal.maxLoss,
      stopLossSpread: signal.stopLossSpread,
      targetSpread: signal.targetSpread,
      status: "OPEN",
      mode: "PAPER",
      entryTime: nowIso,
      currentSpreadPrice: initialSpreadPrice,
      unrealizedGrossPnl: 0,
      unrealizedNetPnl: 0,
      totalCharges: signal.charges.totalCharges,
      spotPriceAtEntry: signal.spotPrice,
      currentSpotPrice: signal.spotPrice,
      shortLegDelta: signal.sellLeg.delta,
      shortLegGamma: 0.003,
      snapshots: [],
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    this.openPositions.set(position.id, position);
    this.processedSignalIds.add(signalFingerprint);

    paperPersistenceManager.persistPositions(Array.from(this.openPositions.values()), this.closedPositions);

    auditLogger.log("PAPER_ORDER_FILLED", traceId, {
      userId,
      strategy: signal.action,
      sellStrike: sellLeg.strike,
      buyStrike: buyLeg.strike,
      netCredit: actualNetCredit,
      lots: signal.quantityLots,
      mode: "PAPER",
      hedgeFirstVerified: true,
      signalFingerprint,
    });

    return position;
  }


  /**
   * Updates market prices for open positions and checks 5-Level Deterministic Exit Priorities.
   * Flexibly handles option chain objects, strike maps, or boolean stale flags.
   */
  public processMarketTick(
    spotPrice: number,
    optionChainOrQuotes?: Record<number, number> | NiftyOptionChain | any,
    dataHealthParam?: { isHealthy: boolean; isStale: boolean } | boolean,
    structureInfo?: { supportLevel?: number; resistanceLevel?: number; isStructureValid?: boolean }
  ): void {
    const nowIso = new Date().toISOString();

    // Parse data health parameter if boolean flag was passed
    let dataHealth: { isHealthy: boolean; isStale: boolean } | undefined;
    if (typeof dataHealthParam === "boolean") {
      dataHealth = { isHealthy: !dataHealthParam, isStale: dataHealthParam };
    } else {
      dataHealth = dataHealthParam;
    }

    // Parse quotes or option chain object
    let strikeQuotesMap: Record<number, number> | undefined;
    let contractGreeksMap: Map<number, { delta?: number; gamma?: number }> = new Map();

    if (optionChainOrQuotes) {
      if (Array.isArray(optionChainOrQuotes.contracts)) {
        strikeQuotesMap = {};
        for (const c of optionChainOrQuotes.contracts) {
          strikeQuotesMap[c.strike] = c.ltp;
          contractGreeksMap.set(c.strike, { delta: c.delta, gamma: c.gamma });
        }
      } else if (typeof optionChainOrQuotes === "object") {
        strikeQuotesMap = optionChainOrQuotes;
      }
    }

    for (const [id, pos] of this.openPositions.entries()) {
      if (pos.status !== "OPEN") continue;

      pos.currentSpotPrice = spotPrice;
      const entryTimeMs = new Date(pos.entryTime).getTime();
      const nowMs = new Date(nowIso).getTime();
      pos.timeInTradeSeconds = Math.max(0, Math.floor((nowMs - entryTimeMs) / 1000));

      if (structureInfo?.supportLevel) pos.supportLevel = structureInfo.supportLevel;
      if (structureInfo?.resistanceLevel) pos.resistanceLevel = structureInfo.resistanceLevel;

      // Update current option prices
      let currentSellPrice = pos.sellLeg.entryPrice;
      let currentBuyPrice = pos.buyLeg.entryPrice;

      if (strikeQuotesMap) {
        if (strikeQuotesMap[pos.sellLeg.strike] !== undefined) {
          currentSellPrice = strikeQuotesMap[pos.sellLeg.strike];
        }
        if (strikeQuotesMap[pos.buyLeg.strike] !== undefined) {
          currentBuyPrice = strikeQuotesMap[pos.buyLeg.strike];
        }
      } else {
        // Estimate current spread price based on spot movement
        const spotDiff = spotPrice - (pos.sellLeg.strike + pos.buyLeg.strike) / 2;
        if (pos.strategy === "BULL_PUT_SPREAD") {
          currentSellPrice = Math.max(1, pos.sellLeg.entryPrice - spotDiff * 0.05);
          currentBuyPrice = Math.max(0.5, pos.buyLeg.entryPrice - spotDiff * 0.02);
        } else if (pos.strategy === "BEAR_CALL_SPREAD") {
          currentSellPrice = Math.max(1, pos.sellLeg.entryPrice + spotDiff * 0.05);
          currentBuyPrice = Math.max(0.5, pos.buyLeg.entryPrice + spotDiff * 0.02);
        }
      }

      // Update Greeks if available
      if (contractGreeksMap.has(pos.sellLeg.strike)) {
        const greeks = contractGreeksMap.get(pos.sellLeg.strike);
        if (greeks?.delta !== undefined) pos.shortLegDelta = greeks.delta;
        if (greeks?.gamma !== undefined) pos.shortLegGamma = greeks.gamma;
      }

      pos.sellLeg.currentPrice = currentSellPrice;
      pos.buyLeg.currentPrice = currentBuyPrice;

      // Current Spread Value to buy back = currentSellPrice - currentBuyPrice
      const currentSpreadValue = Number((currentSellPrice - currentBuyPrice).toFixed(2));
      pos.currentSpreadPrice = currentSpreadValue;

      // Gross P&L = (Initial Credit - Current Spread Buyback Price) * Total Quantity
      const grossPnl = Number(
        ((pos.netCredit - currentSpreadValue) * pos.totalQuantity).toFixed(2)
      );
      const netPnl = Number((grossPnl - pos.totalCharges).toFixed(2));

      pos.unrealizedGrossPnl = grossPnl;
      pos.unrealizedNetPnl = netPnl;
      pos.updatedAt = nowIso;

      // Record Periodic Position Snapshot
      const snapshot: PositionSnapshot = {
        timestamp: nowIso,
        spot: spotPrice,
        spreadPrice: currentSpreadValue,
        unrealizedPnl: netPnl,
        support: pos.supportLevel,
        resistance: pos.resistanceLevel,
        delta: pos.shortLegDelta,
        gamma: pos.shortLegGamma,
        distanceToSL: Number((pos.stopLossSpread - currentSpreadValue).toFixed(2)),
        distanceToTarget: Number((currentSpreadValue - pos.targetSpread).toFixed(2)),
      };

      if (!pos.snapshots) pos.snapshots = [];
      pos.snapshots.push(snapshot);
      if (pos.snapshots.length > 100) pos.snapshots.shift();

      // ── 5-LEVEL DETERMINISTIC EXIT ENGINE ──────────────────────────
      let exitReason: string | null = null;

      // Priority 1 — Emergency / Data Risk
      if (dataHealth && (!dataHealth.isHealthy || dataHealth.isStale)) {
        exitReason = "EMERGENCY_DATA_STALE_EXIT";
      }
      // Priority 2 — Structure Invalidation
      else if (structureInfo && structureInfo.isStructureValid === false) {
        exitReason = "STRUCTURE_INVALIDATED";
      } else if (pos.strategy === "BULL_PUT_SPREAD" && pos.supportLevel && spotPrice < pos.supportLevel - 15) {
        exitReason = "STRUCTURE_INVALIDATED_SUPPORT_BREAK";
      } else if (pos.strategy === "BEAR_CALL_SPREAD" && pos.resistanceLevel && spotPrice > pos.resistanceLevel + 15) {
        exitReason = "STRUCTURE_INVALIDATED_RESISTANCE_BREAK";
      }
      // Priority 3 — Greek Risk Breach
      else if (pos.shortLegDelta !== undefined && Math.abs(pos.shortLegDelta) > 0.45) {
        exitReason = "GREEK_RISK_DELTA_BREACH_EXIT";
      } else if (pos.shortLegGamma !== undefined && pos.shortLegGamma > 0.008) {
        exitReason = "GREEK_RISK_GAMMA_BREACH_EXIT";
      }
      // Priority 4 — Stop Loss
      else if (currentSpreadValue >= pos.stopLossSpread) {
        exitReason = "STOP_LOSS_HIT";
      }
      // Priority 5 — Target Capture
      else if (currentSpreadValue <= pos.targetSpread) {
        exitReason = "PROFIT_TARGET_CAPTURED";
      }

      if (exitReason) {
        this.closePosition(id, exitReason);
      }
    }
  }

  /**
   * Closes an open paper position.
   */
  public closePosition(id: string, exitReason: string = "MANUAL_CLOSE"): NiftySpreadPosition {
    const pos = this.openPositions.get(id);
    if (!pos) {
      throw new Error(`Position ${id} not found.`);
    }

    const nowIso = new Date().toISOString();
    pos.status = "CLOSED";
    pos.exitTime = nowIso;
    pos.exitReason = exitReason;
    pos.realizedGrossPnl = pos.unrealizedGrossPnl;
    pos.realizedNetPnl = pos.unrealizedNetPnl;
    pos.updatedAt = nowIso;

    this.openPositions.delete(id);
    this.closedPositions.push(pos);

    // Record trade result into DailyRiskController & PaperSessionManager
    dailyRiskController.recordTradeClosed(pos.realizedNetPnl || 0);
    paperSessionManager.recordTradeToSession(
      pos.realizedNetPnl || 0,
      pos.realizedGrossPnl || 0,
      pos.totalCharges,
      50
    );

    auditLogger.log("PAPER_POSITION_CLOSED", pos.id, {
      userId: pos.userId,
      strategy: pos.strategy,
      exitReason,
      realizedGrossPnl: pos.realizedGrossPnl,
      totalCharges: pos.totalCharges,
      realizedNetPnl: pos.realizedNetPnl,
    });

    return pos;
  }

  public getOpenPositions(userId?: string): NiftySpreadPosition[] {
    const all = Array.from(this.openPositions.values());
    return userId ? all.filter((p) => p.userId === userId) : all;
  }

  public getClosedPositions(userId?: string): NiftySpreadPosition[] {
    return userId
      ? this.closedPositions.filter((p) => p.userId === userId)
      : [...this.closedPositions];
  }

  public resetAccount(capital?: number) {
    this.openPositions.clear();
    this.closedPositions = [];
    this.brokerOrdersMap.clear();
  }

  // ── IBROKERADAPTER INTERFACE IMPLEMENTATION METHODS ──────────────────────

  public async connect(): Promise<BrokerConnectionStatus> {
    this.isConnected = true;
    return this.getConnectionStatus();
  }

  public async disconnect(): Promise<void> {
    this.isConnected = false;
  }

  public getConnectionStatus(): BrokerConnectionStatus {
    return {
      state: this.isConnected ? "CONNECTED" : "DISCONNECTED",
      connectedAt: new Date().toISOString(),
      brokerName: "PAPER_BROKER_ADAPTER",
      isPaper: true,
    };
  }

  public async getAccount(): Promise<BrokerAccount> {
    return {
      accountId: "PAPER_ACC_1001",
      brokerName: "PAPER_BROKER_ADAPTER",
      cashBalance: 100000,
      usedMargin: 0,
      availableMargin: 100000,
      collateralMargin: 0,
      currency: "INR",
      isPaperAccount: true,
    };
  }

  public async getPositions(): Promise<BrokerPosition[]> {
    const result: BrokerPosition[] = [];
    for (const pos of this.openPositions.values()) {
      if (pos.sellLeg) {
        result.push({
          positionId: `${pos.id}_SELL`,
          symbol: pos.symbol,
          exchange: "NFO",
          expiry: pos.expiry,
          strike: pos.sellLeg.strike,
          optionType: pos.sellLeg.optionType,
          side: "SELL",
          quantity: pos.sellLeg.quantity,
          buyQuantity: 0,
          sellQuantity: pos.sellLeg.quantity,
          averagePrice: pos.sellLeg.entryPrice,
          buyPrice: 0,
          sellPrice: pos.sellLeg.entryPrice,
          lastPrice: pos.sellLeg.currentPrice,
          unrealizedPnl: Number(((pos.sellLeg.entryPrice - pos.sellLeg.currentPrice) * pos.sellLeg.quantity).toFixed(2)),
          realizedPnl: 0,
          product: "NRML",
        });
      }
      if (pos.buyLeg) {
        result.push({
          positionId: `${pos.id}_BUY`,
          symbol: pos.symbol,
          exchange: "NFO",
          expiry: pos.expiry,
          strike: pos.buyLeg.strike,
          optionType: pos.buyLeg.optionType,
          side: "BUY",
          quantity: pos.buyLeg.quantity,
          buyQuantity: pos.buyLeg.quantity,
          sellQuantity: 0,
          averagePrice: pos.buyLeg.entryPrice,
          buyPrice: pos.buyLeg.entryPrice,
          sellPrice: 0,
          lastPrice: pos.buyLeg.currentPrice,
          unrealizedPnl: Number(((pos.buyLeg.currentPrice - pos.buyLeg.entryPrice) * pos.buyLeg.quantity).toFixed(2)),
          realizedPnl: 0,
          product: "NRML",
        });
      }
    }
    return result;
  }

  public async getOrders(): Promise<BrokerOrder[]> {
    return Array.from(this.brokerOrdersMap.values());
  }

  public async getOrder(orderId: string): Promise<BrokerOrder | null> {
    const o = this.brokerOrdersMap.get(orderId);
    if (o) return o;
    for (const ord of this.brokerOrdersMap.values()) {
      if (ord.clientOrderId === orderId) return ord;
    }
    return null;
  }

  public async placeOrder(request: BrokerOrderRequest): Promise<BrokerOrderResponse> {
    const nowIso = new Date().toISOString();
    const orderId = `PORD_${randomUUID().slice(0, 8)}`;

    const order: BrokerOrder = {
      orderId,
      clientOrderId: request.clientOrderId,
      status: "FILLED",
      symbol: request.symbol,
      exchange: request.exchange,
      instrument: request.instrument,
      expiry: request.expiry,
      strike: request.strike,
      optionType: request.optionType,
      side: request.side,
      requestedQuantity: request.quantity,
      filledQuantity: request.quantity,
      averagePrice: request.price > 0 ? request.price : 100.0,
      orderType: request.orderType,
      product: request.product,
      placedTime: nowIso,
      updatedTime: nowIso,
      timestamp: nowIso,
    };

    this.brokerOrdersMap.set(orderId, order);

    return {
      orderId,
      clientOrderId: request.clientOrderId,
      status: "FILLED",
      symbol: request.symbol,
      side: request.side,
      requestedQuantity: request.quantity,
      filledQuantity: request.quantity,
      averagePrice: order.averagePrice,
      timestamp: nowIso,
    };
  }

  public async cancelOrder(orderId: string): Promise<BrokerOrderResponse> {
    const order = this.brokerOrdersMap.get(orderId);
    const nowIso = new Date().toISOString();
    if (order) {
      order.status = "CANCELLED";
      order.updatedTime = nowIso;
      return {
        orderId: order.orderId,
        clientOrderId: order.clientOrderId,
        status: "CANCELLED",
        symbol: order.symbol,
        side: order.side,
        requestedQuantity: order.requestedQuantity,
        filledQuantity: order.filledQuantity,
        averagePrice: order.averagePrice,
        timestamp: nowIso,
      };
    }

    return {
      orderId,
      clientOrderId: `CANCEL_${orderId}`,
      status: "REJECTED",
      symbol: "NIFTY",
      side: "BUY",
      requestedQuantity: 0,
      filledQuantity: 0,
      averagePrice: 0,
      rejectionCode: "BROKER_REJECTED",
      rejectionReason: `Order ${orderId} not found`,
      timestamp: nowIso,
    };
  }

  public async modifyOrder(orderId: string, params: Partial<BrokerOrderRequest>): Promise<BrokerOrderResponse> {
    const order = this.brokerOrdersMap.get(orderId);
    const nowIso = new Date().toISOString();
    if (order) {
      if (params.price !== undefined) order.averagePrice = params.price;
      if (params.quantity !== undefined) order.requestedQuantity = params.quantity;
      order.updatedTime = nowIso;
      return {
        orderId: order.orderId,
        clientOrderId: order.clientOrderId,
        status: order.status,
        symbol: order.symbol,
        side: order.side,
        requestedQuantity: order.requestedQuantity,
        filledQuantity: order.filledQuantity,
        averagePrice: order.averagePrice,
        timestamp: nowIso,
      };
    }

    return {
      orderId,
      clientOrderId: `MODIFY_${orderId}`,
      status: "REJECTED",
      symbol: "NIFTY",
      side: "BUY",
      requestedQuantity: 0,
      filledQuantity: 0,
      averagePrice: 0,
      rejectionCode: "BROKER_REJECTED",
      rejectionReason: `Order ${orderId} not found`,
      timestamp: nowIso,
    };
  }

  public async getQuote(symbol: string): Promise<BrokerQuote> {
    return {
      symbol,
      lastPrice: 24500.0,
      bidPrice: 24498.0,
      askPrice: 24502.0,
      bidQty: 500,
      askQty: 500,
      volume: 1500000,
      openInterest: 12000000,
      timestamp: new Date().toISOString(),
    };
  }

  public async getInstrument(symbol: string): Promise<BrokerInstrument | null> {
    const res = instrumentMasterResolver.resolveInstrument("NIFTY", "2026-09-24", 24500, "CE");
    return res.instrument || null;
  }
}

export const paperBrokerAdapter = new PaperBrokerAdapter();


