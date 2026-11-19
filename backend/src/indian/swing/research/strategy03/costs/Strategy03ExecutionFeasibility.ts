export interface TradeExecutionFeasibilityRecord {
  symbol: string;
  entryDate: string;
  stockDayTurnoverCr: number;
  avg20dTurnoverCr: number;
  assumedOrderValueInr: number;
  orderPctOf20dAvgTurnover: number;
  historicalBidAskAvailability: "MISSING";
  nextExecutableEntryPrice: number;
  nextExecutableExitPrice: number;
  gapThroughStop: boolean;
  marketImpactRisk: "LOW" | "MODERATE" | "HIGH";
  partialFillFeasibility: "HIGH_LIQUIDITY_FULL_FILL_LIKELY" | "MODERATE_LIQUIDITY_VERIFY_DEPTH";
}

function round4(v: number): number {
  return Math.round(v * 10000) / 10000;
}

export function evaluateExecutionFeasibility(params: {
  symbol: string;
  entryDate: string;
  stockDayTurnoverCr: number;
  avg20dTurnoverCr: number;
  assumedOrderValueInr: number;
  nextExecutableEntryPrice: number;
  nextExecutableExitPrice: number;
  gapThroughStop: boolean;
}): TradeExecutionFeasibilityRecord {
  const avg20dInr = params.avg20dTurnoverCr * 1e7;
  const pctOfAdv = avg20dInr > 0 ? round4((params.assumedOrderValueInr / avg20dInr) * 100) : 99;
  const impact: "LOW" | "MODERATE" | "HIGH" =
    pctOfAdv <= 0.1 ? "LOW" : pctOfAdv <= 0.5 ? "MODERATE" : "HIGH";
  return {
    symbol: params.symbol,
    entryDate: params.entryDate,
    stockDayTurnoverCr: Math.round(params.stockDayTurnoverCr * 100) / 100,
    avg20dTurnoverCr: Math.round(params.avg20dTurnoverCr * 100) / 100,
    assumedOrderValueInr: params.assumedOrderValueInr,
    orderPctOf20dAvgTurnover: pctOfAdv,
    historicalBidAskAvailability: "MISSING",
    nextExecutableEntryPrice: params.nextExecutableEntryPrice,
    nextExecutableExitPrice: params.nextExecutableExitPrice,
    gapThroughStop: params.gapThroughStop,
    marketImpactRisk: impact,
    partialFillFeasibility:
      pctOfAdv <= 0.1 ? "HIGH_LIQUIDITY_FULL_FILL_LIKELY" : "MODERATE_LIQUIDITY_VERIFY_DEPTH",
  };
}

