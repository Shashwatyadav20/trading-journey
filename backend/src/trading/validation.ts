import { MarketOrderRequest, LimitOrderRequest, SUPPORTED_INSTRUMENTS, SupportedInstrument } from "./types";

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

export function validateSlTpForLong(entryPrice: number, sl?: number | null, tp?: number | null) {
  if (sl != null && sl >= entryPrice) {
    throw new ValidationError("For LONG positions, Stop Loss must be below the entry price.");
  }
  if (tp != null && tp <= entryPrice) {
    throw new ValidationError("For LONG positions, Take Profit must be above the entry price.");
  }
}

export function validateSlTpForShort(entryPrice: number, sl?: number | null, tp?: number | null) {
  if (sl != null && sl <= entryPrice) {
    throw new ValidationError("For SHORT positions, Stop Loss must be above the entry price.");
  }
  if (tp != null && tp >= entryPrice) {
    throw new ValidationError("For SHORT positions, Take Profit must be below the entry price.");
  }
}

export function validateMarketOrder(req: any, currentPrice: number): MarketOrderRequest {
  if (!req || typeof req !== "object") {
    throw new ValidationError("Invalid order request payload.");
  }

  const instrument = req.instrument as string;
  if (!SUPPORTED_INSTRUMENTS.includes(instrument as SupportedInstrument)) {
    throw new ValidationError(`Unsupported instrument: ${instrument}. Supported are: ${SUPPORTED_INSTRUMENTS.join(", ")}`);
  }

  const side = req.side;
  if (side !== "BUY" && side !== "SELL") {
    throw new ValidationError("Side must be 'BUY' or 'SELL'.");
  }

  const quantity = Number(req.quantity);
  if (isNaN(quantity) || quantity <= 0 || !isFinite(quantity)) {
    throw new ValidationError("Quantity must be a positive finite number.");
  }

  const stopLoss = req.stopLoss != null ? Number(req.stopLoss) : null;
  const takeProfit = req.takeProfit != null ? Number(req.takeProfit) : null;
  const strategy = typeof req.strategy === "string" ? req.strategy : undefined;
  const signalId = typeof req.signalId === "string" ? req.signalId : undefined;
  const idempotencyKey = typeof req.idempotencyKey === "string" ? req.idempotencyKey : undefined;

  if (side === "BUY") {
    validateSlTpForLong(currentPrice, stopLoss, takeProfit);
  } else {
    validateSlTpForShort(currentPrice, stopLoss, takeProfit);
  }

  return {
    instrument: instrument as SupportedInstrument,
    side,
    quantity,
    stopLoss,
    takeProfit,
    strategy,
    signalId,
    idempotencyKey,
  };
}

export function validateLimitOrder(req: any, currentPrice: number): LimitOrderRequest {
  if (!req || typeof req !== "object") {
    throw new ValidationError("Invalid order request payload.");
  }

  const instrument = req.instrument as string;
  if (!SUPPORTED_INSTRUMENTS.includes(instrument as SupportedInstrument)) {
    throw new ValidationError(`Unsupported instrument: ${instrument}. Supported are: ${SUPPORTED_INSTRUMENTS.join(", ")}`);
  }

  const side = req.side;
  if (side !== "BUY" && side !== "SELL") {
    throw new ValidationError("Side must be 'BUY' or 'SELL'.");
  }

  const quantity = Number(req.quantity);
  if (isNaN(quantity) || quantity <= 0 || !isFinite(quantity)) {
    throw new ValidationError("Quantity must be a positive finite number.");
  }

  const limitPrice = Number(req.limitPrice);
  if (isNaN(limitPrice) || limitPrice <= 0 || !isFinite(limitPrice)) {
    throw new ValidationError("Limit price must be a positive finite number.");
  }

  if (side === "BUY" && limitPrice >= currentPrice) {
    throw new ValidationError("BUY LIMIT price must be below the current market price.");
  }
  if (side === "SELL" && limitPrice <= currentPrice) {
    throw new ValidationError("SELL LIMIT price must be above the current market price.");
  }

  const stopLoss = req.stopLoss != null ? Number(req.stopLoss) : null;
  const takeProfit = req.takeProfit != null ? Number(req.takeProfit) : null;
  const strategy = typeof req.strategy === "string" ? req.strategy : undefined;
  const signalId = typeof req.signalId === "string" ? req.signalId : undefined;
  const idempotencyKey = typeof req.idempotencyKey === "string" ? req.idempotencyKey : undefined;

  if (side === "BUY") {
    validateSlTpForLong(limitPrice, stopLoss, takeProfit);
  } else {
    validateSlTpForShort(limitPrice, stopLoss, takeProfit);
  }

  return {
    instrument: instrument as SupportedInstrument,
    side,
    quantity,
    limitPrice,
    stopLoss,
    takeProfit,
    strategy,
    signalId,
    idempotencyKey,
  };
}
