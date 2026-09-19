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
  BrokerRejectionCode,
  OrderStatus,
} from "./IBrokerAdapter";
import { instrumentMasterResolver } from "./InstrumentMasterResolver";
import { randomUUID } from "crypto";

export class SimulatedBrokerAdapter implements IBrokerAdapter {
  private isConnected = false;
  private isDegraded = false;
  private account: BrokerAccount;
  private orders: Map<string, BrokerOrder> = new Map();
  private positions: Map<string, BrokerPosition> = new Map();

  // Failure Injection & Simulation Configuration
  private forceRejectCode: BrokerRejectionCode | null = null;
  private forceRejectReason: string | null = null;
  private forceTimeout = false;
  private forceUnknownState = false;
  private forcePartialFillQty: number | null = null;
  private forcePositionMismatch = false;

  constructor(initialCapital = 100000) {
    this.account = {
      accountId: "MOCK_ACC_1001",
      brokerName: "SIMULATED_MOCK_BROKER",
      cashBalance: initialCapital,
      usedMargin: 0,
      availableMargin: initialCapital,
      collateralMargin: 0,
      currency: "INR",
      isPaperAccount: true,
    };
  }

  // ── FAILURE INJECTION CONTROL METHODS ────────────────────────────────────

  public setForceReject(code: BrokerRejectionCode, reason: string): void {
    this.forceRejectCode = code;
    this.forceRejectReason = reason;
  }

  public clearForceReject(): void {
    this.forceRejectCode = null;
    this.forceRejectReason = null;
  }

  public setForceTimeout(timeout: boolean): void {
    this.forceTimeout = timeout;
  }

  public setForceUnknownState(unknownState: boolean): void {
    this.forceUnknownState = unknownState;
  }

  public setForcePartialFill(qty: number | null): void {
    this.forcePartialFillQty = qty;
  }

  public setForcePositionMismatch(mismatch: boolean): void {
    this.forcePositionMismatch = mismatch;
  }

  public simulateDisconnect(): void {
    this.isConnected = false;
  }

  public simulateReconnect(): void {
    this.isConnected = true;
  }

  // ── IBROKERADAPTER IMPLEMENTATION ────────────────────────────────────────

  public async connect(): Promise<BrokerConnectionStatus> {
    this.isConnected = true;
    return this.getConnectionStatus();
  }

  public async disconnect(): Promise<void> {
    this.isConnected = false;
  }

  public getConnectionStatus(): BrokerConnectionStatus {
    return {
      state: this.isConnected ? (this.isDegraded ? "DEGRADED" : "CONNECTED") : "DISCONNECTED",
      connectedAt: this.isConnected ? new Date().toISOString() : undefined,
      brokerName: "SIMULATED_MOCK_BROKER",
      isPaper: true,
    };
  }

  public async getAccount(): Promise<BrokerAccount> {
    return { ...this.account };
  }

  public async getPositions(): Promise<BrokerPosition[]> {
    const list = Array.from(this.positions.values());
    if (this.forcePositionMismatch) {
      // Inject phantom position for position mismatch test
      list.push({
        positionId: "PHANTOM_POS_99",
        symbol: "NIFTY",
        exchange: "NFO",
        expiry: "2026-09-24",
        strike: 25000,
        optionType: "CE",
        side: "BUY",
        quantity: 130,
        buyQuantity: 130,
        sellQuantity: 0,
        averagePrice: 150,
        buyPrice: 150,
        sellPrice: 0,
        lastPrice: 155,
        unrealizedPnl: 650,
        realizedPnl: 0,
        product: "NRML",
      });
    }
    return list;
  }

  public async getOrders(): Promise<BrokerOrder[]> {
    return Array.from(this.orders.values());
  }

  public async getOrder(orderId: string): Promise<BrokerOrder | null> {
    const order = this.orders.get(orderId);
    if (!order) {
      // Check by clientOrderId if orderId matched clientOrderId
      for (const o of this.orders.values()) {
        if (o.clientOrderId === orderId) return o;
      }
      return null;
    }
    return order;
  }

  public async placeOrder(request: BrokerOrderRequest): Promise<BrokerOrderResponse> {
    const nowIso = new Date().toISOString();

    // 1. Connection check
    if (!this.isConnected) {
      return {
        orderId: `ERR_${randomUUID()}`,
        clientOrderId: request.clientOrderId,
        status: "REJECTED",
        symbol: request.symbol,
        side: request.side,
        requestedQuantity: request.quantity,
        filledQuantity: 0,
        averagePrice: 0,
        rejectionCode: "BROKER_REJECTED",
        rejectionReason: "Broker is disconnected",
        timestamp: nowIso,
      };
    }

    // 2. Forced Timeout Injection
    if (this.forceTimeout) {
      throw new Error("TIMEOUT: Broker response timed out after 10000ms");
    }

    // 3. Forced Reject Injection
    if (this.forceRejectCode) {
      return {
        orderId: `REJ_${randomUUID()}`,
        clientOrderId: request.clientOrderId,
        status: "REJECTED",
        symbol: request.symbol,
        side: request.side,
        requestedQuantity: request.quantity,
        filledQuantity: 0,
        averagePrice: 0,
        rejectionCode: this.forceRejectCode,
        rejectionReason: this.forceRejectReason || "Forced simulation reject",
        timestamp: nowIso,
      };
    }

    // 4. Idempotency Check (Existing order with same clientOrderId)
    for (const existing of this.orders.values()) {
      if (existing.clientOrderId === request.clientOrderId) {
        return {
          orderId: existing.orderId,
          clientOrderId: existing.clientOrderId,
          status: existing.status,
          symbol: existing.symbol,
          side: existing.side,
          requestedQuantity: existing.requestedQuantity,
          filledQuantity: existing.filledQuantity,
          averagePrice: existing.averagePrice,
          timestamp: existing.updatedTime,
        };
      }
    }

    // 5. Forced Unknown State Injection
    if (this.forceUnknownState) {
      const orderId = `UNK_${randomUUID()}`;
      const unkOrder: BrokerOrder = {
        orderId,
        clientOrderId: request.clientOrderId,
        status: "UNKNOWN",
        symbol: request.symbol,
        exchange: request.exchange,
        instrument: request.instrument,
        expiry: request.expiry,
        strike: request.strike,
        optionType: request.optionType,
        side: request.side,
        requestedQuantity: request.quantity,
        filledQuantity: 0,
        averagePrice: 0,
        orderType: request.orderType,
        product: request.product,
        placedTime: nowIso,
        updatedTime: nowIso,
        timestamp: nowIso,
        rejectionCode: "UNKNOWN_ERROR",
        rejectionReason: "Order state unconfirmed by exchange API",
      };
      this.orders.set(orderId, unkOrder);

      return {
        orderId,
        clientOrderId: request.clientOrderId,
        status: "UNKNOWN",
        symbol: request.symbol,
        side: request.side,
        requestedQuantity: request.quantity,
        filledQuantity: 0,
        averagePrice: 0,
        rejectionCode: "UNKNOWN_ERROR",
        rejectionReason: "Order status unknown from broker feed",
        timestamp: nowIso,
      };
    }

    // 6. Normal Fill vs Forced Partial Fill
    const orderId = `ORD_${randomUUID().slice(0, 8)}`;
    let status: OrderStatus = "FILLED";
    let filledQty = request.quantity;

    if (this.forcePartialFillQty !== null && this.forcePartialFillQty < request.quantity) {
      status = "PARTIALLY_FILLED";
      filledQty = Math.max(0, this.forcePartialFillQty);
    }

    const execPrice = request.price > 0 ? request.price : 100.0;

    const fullOrder: BrokerOrder = {
      orderId,
      clientOrderId: request.clientOrderId,
      status,
      symbol: request.symbol,
      exchange: request.exchange,
      instrument: request.instrument,
      expiry: request.expiry,
      strike: request.strike,
      optionType: request.optionType,
      side: request.side,
      requestedQuantity: request.quantity,
      filledQuantity: filledQty,
      averagePrice: execPrice,
      orderType: request.orderType,
      product: request.product,
      placedTime: nowIso,
      updatedTime: nowIso,
      timestamp: nowIso,
    };

    this.orders.set(orderId, fullOrder);

    // Update position ledger
    if (filledQty > 0) {
      const posId = `POS_${request.symbol}_${request.strike}_${request.optionType}`;
      let pos = this.positions.get(posId);
      if (!pos) {
        pos = {
          positionId: posId,
          symbol: request.symbol,
          exchange: request.exchange,
          expiry: request.expiry,
          strike: request.strike,
          optionType: request.optionType,
          side: request.side,
          quantity: 0,
          buyQuantity: 0,
          sellQuantity: 0,
          averagePrice: execPrice,
          buyPrice: 0,
          sellPrice: 0,
          lastPrice: execPrice,
          unrealizedPnl: 0,
          realizedPnl: 0,
          product: request.product,
        };
      }

      if (request.side === "BUY") {
        pos.buyQuantity += filledQty;
        pos.buyPrice = execPrice;
        pos.quantity += filledQty;
      } else {
        pos.sellQuantity += filledQty;
        pos.sellPrice = execPrice;
        pos.quantity -= filledQty;
      }
      this.positions.set(posId, pos);
    }

    return {
      orderId,
      clientOrderId: request.clientOrderId,
      status,
      symbol: request.symbol,
      side: request.side,
      requestedQuantity: request.quantity,
      filledQuantity: filledQty,
      averagePrice: execPrice,
      timestamp: nowIso,
    };
  }

  public async cancelOrder(orderId: string): Promise<BrokerOrderResponse> {
    const order = this.orders.get(orderId);
    const nowIso = new Date().toISOString();
    if (!order) {
      return {
        orderId,
        clientOrderId: `CANCEL_UNKNOWN`,
        status: "REJECTED",
        symbol: "NIFTY",
        side: "BUY",
        requestedQuantity: 0,
        filledQuantity: 0,
        averagePrice: 0,
        rejectionCode: "BROKER_REJECTED",
        rejectionReason: `Order ${orderId} not found to cancel`,
        timestamp: nowIso,
      };
    }

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

  public async modifyOrder(orderId: string, params: Partial<BrokerOrderRequest>): Promise<BrokerOrderResponse> {
    const order = this.orders.get(orderId);
    const nowIso = new Date().toISOString();
    if (!order) {
      return {
        orderId,
        clientOrderId: `MODIFY_UNKNOWN`,
        status: "REJECTED",
        symbol: "NIFTY",
        side: "BUY",
        requestedQuantity: 0,
        filledQuantity: 0,
        averagePrice: 0,
        rejectionCode: "BROKER_REJECTED",
        rejectionReason: `Order ${orderId} not found to modify`,
        timestamp: nowIso,
      };
    }

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

export const simulatedBrokerAdapter = new SimulatedBrokerAdapter();
