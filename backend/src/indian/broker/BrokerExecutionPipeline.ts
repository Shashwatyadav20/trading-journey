import {
  IBrokerAdapter,
  BrokerOrderRequest,
  BrokerOrderResponse,
  HedgeLegState,
  IdempotencyRecord,
} from "./IBrokerAdapter";
import { brokerSafetyLock } from "../security/BrokerSafetyLock";
import { brokerOrderValidator } from "./BrokerOrderValidator";
import { auditLogger } from "../audit/AuditLogger";
import { AutoHedgeSignal } from "../types";
import { instrumentMasterResolver } from "./InstrumentMasterResolver";

export interface PipelineExecutionResult {
  success: boolean;
  signalId: string;
  hedgeLegState: HedgeLegState;
  hedgeResponse?: BrokerOrderResponse;
  shortResponse?: BrokerOrderResponse;
  hedgeResponse2?: BrokerOrderResponse;
  shortResponse2?: BrokerOrderResponse;
  totalHedgeQuantity: number;
  totalShortQuantity: number;
  rejectionCode?: string;
  rejectionReason?: string;
}

export class BrokerExecutionPipeline {
  private brokerAdapter: IBrokerAdapter;
  private idempotencyStore: Map<string, IdempotencyRecord> = new Map();

  constructor(brokerAdapter: IBrokerAdapter) {
    this.brokerAdapter = brokerAdapter;
  }

  public setBrokerAdapter(adapter: IBrokerAdapter): void {
    this.brokerAdapter = adapter;
  }

  public getBrokerAdapter(): IBrokerAdapter {
    return this.brokerAdapter;
  }

  /**
   * Generates deterministic idempotency key for an order request.
   */
  public generateIdempotencyKey(
    signalId: string,
    side: "BUY" | "SELL",
    strike: number,
    optionType: "CE" | "PE",
    quantity: number
  ): string {
    return `IDEM_${signalId}_${side}_${strike}_${optionType}_${quantity}`;
  }

  /**
   * Reconciles a timed-out or unknown order request against broker history.
   */
  public async reconcileTimeoutOrder(
    clientOrderId: string
  ): Promise<BrokerOrderResponse | null> {
    try {
      const orders = await this.brokerAdapter.getOrders();
      const match = orders.find((o) => o.clientOrderId === clientOrderId);
      if (match) {
        return {
          orderId: match.orderId,
          clientOrderId: match.clientOrderId,
          status: match.status,
          symbol: match.symbol,
          side: match.side,
          requestedQuantity: match.requestedQuantity,
          filledQuantity: match.filledQuantity,
          averagePrice: match.averagePrice,
          timestamp: match.updatedTime,
        };
      }
      return null;
    } catch (err) {
      return null;
    }
  }

  /**
   * Safely places an order with idempotency check, timeout reconciliation, and audit logging.
   */
  public async placeOrderSafely(
    request: BrokerOrderRequest,
    isHedgeConfirmed: boolean,
    maxLossParams?: any
  ): Promise<BrokerOrderResponse> {
    const clientOrderId = request.clientOrderId;

    // 1. Idempotency Store Check
    if (this.idempotencyStore.has(clientOrderId)) {
      const record = this.idempotencyStore.get(clientOrderId)!;
      auditLogger.log("IDEMPOTENCY_DUPLICATE_BLOCKED", clientOrderId, {
        signalId: request.signalId,
        clientOrderId,
        status: record.orderResponse.status,
      });
      return record.orderResponse;
    }

    // 2. Pre-Order Validation (Risk, Max Loss <= ₹1,000, Quantity, Lot Size, Hedge-First)
    const valResult = brokerOrderValidator.validateOrder(request, {
      maxLossParams,
      isHedgeConfirmed,
      bypassMarketHours: true,
    });

    if (!valResult.allowed) {
      const errResponse: BrokerOrderResponse = {
        orderId: `REJ_${request.clientOrderId}`,
        clientOrderId,
        status: "REJECTED",
        symbol: request.symbol,
        side: request.side,
        requestedQuantity: request.quantity,
        filledQuantity: 0,
        averagePrice: 0,
        rejectionCode: valResult.rejectionCode || "BROKER_REJECTED",
        rejectionReason: valResult.rejectionReason || "Pre-order validation failed",
        timestamp: new Date().toISOString(),
      };

      auditLogger.log("BROKER_ORDER_PRE_VALIDATION_REJECTED", clientOrderId, {
        rejectionCode: errResponse.rejectionCode,
        rejectionReason: errResponse.rejectionReason,
      });

      return errResponse;
    }

    // 3. Submit to Broker with Timeout / Error Reconciliation
    let response: BrokerOrderResponse;
    try {
      response = await this.brokerAdapter.placeOrder(request);
    } catch (err: any) {
      // Timeout or Network Failure Handling -> Reconcile Order State
      auditLogger.log("BROKER_ORDER_TIMEOUT_DETECTED", clientOrderId, { error: err.message });
      const reconciled = await this.reconcileTimeoutOrder(clientOrderId);

      if (reconciled) {
        response = reconciled;
      } else {
        response = {
          orderId: `UNK_${clientOrderId}`,
          clientOrderId,
          status: "UNKNOWN",
          symbol: request.symbol,
          side: request.side,
          requestedQuantity: request.quantity,
          filledQuantity: 0,
          averagePrice: 0,
          rejectionCode: "TIMEOUT",
          rejectionReason: `Order timed out and status unconfirmed: ${err.message}`,
          timestamp: new Date().toISOString(),
        };
      }
    }

    // 4. Store Idempotency Record
    const record: IdempotencyRecord = {
      clientOrderId,
      internalOrderId: response.orderId,
      tradeId: request.tradeId || `TR_${request.signalId}`,
      signalId: request.signalId || "DIRECT_ORDER",
      timestamp: new Date().toISOString(),
      strategy: "OPTION_SPREAD",
      side: request.side,
      quantity: request.quantity,
      orderResponse: response,
    };
    this.idempotencyStore.set(clientOrderId, record);

    auditLogger.log("BROKER_ORDER_AUDIT", response.orderId, {
      clientOrderId,
      status: response.status,
      side: response.side,
      requestedQty: response.requestedQuantity,
      filledQty: response.filledQuantity,
      avgPrice: response.averagePrice,
    });

    return response;
  }

  /**
   * Executes a complete Hedge-First spread trade sequence:
   * BUY HEDGE -> CONFIRM HEDGE -> SELL SHORT -> CONFIRM SHORT
   * Caps short order quantity strictly to confirmed protective hedge quantity.
   */
  public async executeSignalPipeline(
    signal: AutoHedgeSignal,
    tradeId?: string
  ): Promise<PipelineExecutionResult> {
    const tid = tradeId || `TR_${Date.now()}`;
    const lotSize = instrumentMasterResolver.getLotSize();
    const requestedQuantity = signal.totalQuantity || signal.quantityLots * lotSize;

    // ── STEP 0: Multi-Layer Safety Lock Check ────────────────────────────────
    const safety = brokerSafetyLock.validateExecutionSafety();
    if (!safety.allowed) {
      return {
        success: false,
        signalId: signal.symbol,
        hedgeLegState: "HEDGE_REQUIRED",
        totalHedgeQuantity: 0,
        totalShortQuantity: 0,
        rejectionCode: safety.errorCode || "FAIL_CLOSED_LOCK",
        rejectionReason: safety.reason || "Safety lock rejected execution",
      };
    }

    if (!signal.buyLeg || !signal.sellLeg) {
      return {
        success: false,
        signalId: signal.symbol,
        hedgeLegState: "HEDGE_REQUIRED",
        totalHedgeQuantity: 0,
        totalShortQuantity: 0,
        rejectionCode: "INVALID_INSTRUMENT",
        rejectionReason: "Signal missing required buy leg or sell leg definition",
      };
    }

    let currentLegState: HedgeLegState = "HEDGE_REQUIRED";

    // ── STEP 1: Submit Protective BUY Hedge Leg ──────────────────────────────
    currentLegState = "HEDGE_PENDING";
    const hedgeClientId = this.generateIdempotencyKey(
      signal.timestamp,
      "BUY",
      signal.buyLeg.strike,
      signal.buyLeg.optionType,
      requestedQuantity
    );

    const hedgeRequest: BrokerOrderRequest = {
      clientOrderId: hedgeClientId,
      signalId: signal.timestamp,
      tradeId: tid,
      symbol: "NIFTY",
      exchange: "NFO",
      instrument: signal.buyLeg.symbol,
      expiry: signal.expiry,
      strike: signal.buyLeg.strike,
      optionType: signal.buyLeg.optionType,
      side: "BUY",
      quantity: requestedQuantity,
      orderType: "LIMIT",
      price: signal.buyLeg.ask || signal.buyLeg.ltp,
      product: "NRML",
      isHedgeLeg: true,
    };

    const hedgeResponse = await this.placeOrderSafely(hedgeRequest, true);

    // Evaluate Hedge Fill
    if (hedgeResponse.status !== "FILLED" && hedgeResponse.status !== "PARTIALLY_FILLED") {
      return {
        success: false,
        signalId: signal.timestamp,
        hedgeLegState: "HEDGE_REQUIRED",
        hedgeResponse,
        totalHedgeQuantity: 0,
        totalShortQuantity: 0,
        rejectionCode: hedgeResponse.rejectionCode || "BROKER_REJECTED",
        rejectionReason: `Hedge Order Failed: ${hedgeResponse.rejectionReason || "Hedge buy leg not filled"}`,
      };
    }

    const confirmedHedgeQuantity = hedgeResponse.filledQuantity;
    if (confirmedHedgeQuantity <= 0) {
      return {
        success: false,
        signalId: signal.timestamp,
        hedgeLegState: "HEDGE_REQUIRED",
        hedgeResponse,
        totalHedgeQuantity: 0,
        totalShortQuantity: 0,
        rejectionCode: "BROKER_REJECTED",
        rejectionReason: "Hedge Order filled quantity is 0",
      };
    }

    currentLegState = "HEDGE_CONFIRMED";

    // ── STEP 2: Partial Fill Rule — Cap Short Leg Quantity to Confirmed Protection ─
    currentLegState = "SHORT_ALLOWED";

    // Round short quantity down to valid lot multiple of confirmed hedge quantity
    const allowedShortLots = Math.floor(confirmedHedgeQuantity / lotSize);
    const shortQuantityToSubmit = allowedShortLots * lotSize;

    if (shortQuantityToSubmit <= 0) {
      return {
        success: false,
        signalId: signal.timestamp,
        hedgeLegState: "HEDGE_CONFIRMED",
        hedgeResponse,
        totalHedgeQuantity: confirmedHedgeQuantity,
        totalShortQuantity: 0,
        rejectionCode: "BROKER_REJECTED",
        rejectionReason: "Hedge partial fill insufficient for even 1 full lot of short position",
      };
    }

    // ── STEP 3: Submit SELL Short Leg ─────────────────────────────────────────
    currentLegState = "SHORT_PENDING";
    const shortClientId = this.generateIdempotencyKey(
      signal.timestamp,
      "SELL",
      signal.sellLeg.strike,
      signal.sellLeg.optionType,
      shortQuantityToSubmit
    );

    const maxLossParams = {
      strategy: signal.action,
      sellStrike: signal.sellLeg.strike,
      buyStrike: signal.buyLeg.strike,
      sellPrice: signal.sellLeg.bid || signal.sellLeg.ltp,
      buyPrice: hedgeResponse.averagePrice,
      quantity: shortQuantityToSubmit,
    };

    const shortRequest: BrokerOrderRequest = {
      clientOrderId: shortClientId,
      signalId: signal.timestamp,
      tradeId: tid,
      symbol: "NIFTY",
      exchange: "NFO",
      instrument: signal.sellLeg.symbol,
      expiry: signal.expiry,
      strike: signal.sellLeg.strike,
      optionType: signal.sellLeg.optionType,
      side: "SELL",
      quantity: shortQuantityToSubmit,
      orderType: "LIMIT",
      price: signal.sellLeg.bid || signal.sellLeg.ltp,
      product: "NRML",
      isHedgeLeg: false,
    };

    const shortResponse = await this.placeOrderSafely(shortRequest, true, maxLossParams);

    if (shortResponse.status !== "FILLED" && shortResponse.status !== "PARTIALLY_FILLED") {
      return {
        success: false,
        signalId: signal.timestamp,
        hedgeLegState: "HEDGE_CONFIRMED",
        hedgeResponse,
        shortResponse,
        totalHedgeQuantity: confirmedHedgeQuantity,
        totalShortQuantity: 0,
        rejectionCode: shortResponse.rejectionCode || "BROKER_REJECTED",
        rejectionReason: `Short Order Failed: ${shortResponse.rejectionReason || "Sell leg not filled"}`,
      };
    }

    currentLegState = "SHORT_CONFIRMED";

    return {
      success: true,
      signalId: signal.timestamp,
      hedgeLegState: currentLegState,
      hedgeResponse,
      shortResponse,
      totalHedgeQuantity: confirmedHedgeQuantity,
      totalShortQuantity: shortResponse.filledQuantity,
    };
  }

  public clearIdempotencyStore(): void {
    this.idempotencyStore.clear();
  }
}
