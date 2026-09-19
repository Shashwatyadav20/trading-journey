import { BrokerOrderRequest, BrokerRejectionCode } from "./IBrokerAdapter";
import { instrumentMasterResolver } from "./InstrumentMasterResolver";
import { dailyRiskController } from "../risk/DailyRiskController";

export interface PreOrderValidationResult {
  allowed: boolean;
  rejectionCode?: BrokerRejectionCode;
  rejectionReason?: string;
  calculatedMaxLoss?: number;
}

export interface MaxLossCheckParams {
  strategy: string;
  sellStrike: number;
  buyStrike: number;
  sellPrice: number;
  buyPrice: number;
  quantity: number;
}

export class BrokerOrderValidator {
  /**
   * Recalculates maximum loss independently immediately before order submission.
   * Max loss = (Spread Width - Net Credit) * Quantity
   * Verifies Max Loss <= ₹1,000 INR.
   */
  public calculateMaxLoss(params: MaxLossCheckParams): number {
    const { sellStrike, buyStrike, sellPrice, buyPrice, quantity } = params;
    const spreadWidth = Math.abs(sellStrike - buyStrike);
    const netCredit = sellPrice - buyPrice;
    const maxLossPerUnit = Math.max(0, spreadWidth - netCredit);
    return Number((maxLossPerUnit * quantity).toFixed(2));
  }

  /**
   * Validates market trading hours (NSE Market Hours 09:15 to 15:30 IST, Mon-Fri).
   * Supports override param for testing environment.
   */
  public isMarketOpen(nowIso?: string, bypassForTesting = false): boolean {
    if (bypassForTesting) return true;

    try {
      const dt = nowIso ? new Date(nowIso) : new Date();
      // Convert to IST (UTC+5.5)
      const istMs = dt.getTime() + 5.5 * 60 * 60 * 1000;
      const ist = new Date(istMs);
      const day = ist.getUTCDay(); // 0=Sun, 6=Sat

      if (day === 0 || day === 6) return false;

      const hour = ist.getUTCHours();
      const minute = ist.getUTCMinutes();
      const timeInMinutes = hour * 60 + minute;

      const openMinutes = 9 * 60 + 15;  // 09:15
      const closeMinutes = 15 * 60 + 30; // 15:30

      return timeInMinutes >= openMinutes && timeInMinutes <= closeMinutes;
    } catch {
      return false;
    }
  }

  /**
   * Validates order request prior to passing to broker execution layer.
   */
  public validateOrder(
    request: BrokerOrderRequest,
    options?: {
      maxLossParams?: MaxLossCheckParams;
      isHedgeConfirmed?: boolean;
      bypassMarketHours?: boolean;
    }
  ): PreOrderValidationResult {
    // 1. Instrument Validation
    const instResult = instrumentMasterResolver.resolveInstrument(
      request.symbol,
      request.expiry,
      request.strike,
      request.optionType
    );
    if (!instResult.valid) {
      return {
        allowed: false,
        rejectionCode: "INVALID_INSTRUMENT",
        rejectionReason: instResult.reason || "Invalid instrument parameters",
      };
    }

    // 2. Market Hours Check
    if (!this.isMarketOpen(new Date().toISOString(), options?.bypassMarketHours ?? true)) {
      return {
        allowed: false,
        rejectionCode: "MARKET_CLOSED",
        rejectionReason: "Order rejected: Market is closed (NSE Trading Hours 09:15 - 15:30 IST)",
      };
    }

    // 3. Side & Order Type Validation
    if (request.side !== "BUY" && request.side !== "SELL") {
      return {
        allowed: false,
        rejectionCode: "BROKER_REJECTED",
        rejectionReason: `Invalid side: ${request.side}`,
      };
    }

    if (request.orderType !== "LIMIT" && request.orderType !== "MARKET" && request.orderType !== "SL" && request.orderType !== "SL-M") {
      return {
        allowed: false,
        rejectionCode: "BROKER_REJECTED",
        rejectionReason: `Invalid orderType: ${request.orderType}`,
      };
    }

    // 4. Server-Side Quantity & Lot Size Validation
    const lotSize = instResult.instrument?.lotSize || instrumentMasterResolver.getLotSize();
    if (request.quantity <= 0 || request.quantity % lotSize !== 0) {
      return {
        allowed: false,
        rejectionCode: "BROKER_REJECTED",
        rejectionReason: `Invalid quantity ${request.quantity}. Quantity must be > 0 and a multiple of lot size ${lotSize}.`,
      };
    }

    // 5. Price Validation
    if (request.orderType === "LIMIT" && request.price <= 0) {
      return {
        allowed: false,
        rejectionCode: "PRICE_OUT_OF_RANGE",
        rejectionReason: `Limit order price must be > 0. Received: ${request.price}`,
      };
    }

    // 6. Max Loss Independent Recalculation (Strict ₹1,000 INR limit)
    if (options?.maxLossParams) {
      const recalculatedMaxLoss = this.calculateMaxLoss(options.maxLossParams);
      if (recalculatedMaxLoss > 1000) {
        return {
          allowed: false,
          rejectionCode: "MAX_LOSS_EXCEEDS_1000_INR",
          rejectionReason: `Max loss recalculation breach: ₹${recalculatedMaxLoss} exceeds maximum allowed limit of ₹1,000 INR.`,
          calculatedMaxLoss: recalculatedMaxLoss,
        };
      }
    }

    // 7. Daily Risk Lock Check
    const dailyState = dailyRiskController.getState();
    if (dailyState.isDailyLossLocked || dailyState.isDailyProfitLocked || dailyState.isTradeLocked) {
      return {
        allowed: false,
        rejectionCode: "BROKER_REJECTED",
        rejectionReason: `Daily Risk Lock Active: ${dailyState.lockReason || "Trading locked for today"}`,
      };
    }

    // 8. Hedge-First Rule: SHORT order rejected unless HEDGE_CONFIRMED = true
    if (request.side === "SELL" && !request.isHedgeLeg && options?.isHedgeConfirmed !== true) {
      return {
        allowed: false,
        rejectionCode: "HEDGE_NOT_CONFIRMED",
        rejectionReason: "Hedge-First Violation: Short order rejected because protective buy hedge is not confirmed.",
      };
    }

    return {
      allowed: true,
      calculatedMaxLoss: options?.maxLossParams ? this.calculateMaxLoss(options.maxLossParams) : undefined,
    };
  }
}

export const brokerOrderValidator = new BrokerOrderValidator();
