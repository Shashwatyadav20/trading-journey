import type { DhanCostBreakdown } from "./Strategy03DhanDeliveryCostCalculator.js";

export interface TradeCostAttributionRecord {
  symbol: string;
  entryDate: string;
  exitDate: string;
  segment: "EQUITY_DELIVERY" | "EQUITY_INTRADAY";
  quantity: number;
  rawEntryPrice: number;
  rawExitPrice: number;
  executableEntryPrice: number;
  executableExitPrice: number;
  grossPnlInr: number;
  grossReturnPct: number;
  dhanBrokerageInr: number;
  sttInr: number;
  exchangeChargesInr: number;
  sebiChargesInr: number;
  stampDutyInr: number;
  gstInr: number;
  dpChargesInr: number;
  totalDhanAndStatutoryInr: number;
  bidAskSpreadStatus: "MISSING";
  entrySlippageInr: number;
  exitSlippageInr: number;
  totalExecutionSlippageInr: number;
  marketImpactEstimateInr: number;
  extraStressCostInr: number;
  netPnlInr: number;
  netReturnPct: number;
  riskPct: number;
  netRMultiple: number;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

export function buildTradeCostAttribution(params: {
  symbol: string;
  entryDate: string;
  exitDate: string;
  quantity: number;
  rawEntryPrice: number;
  rawExitPrice: number;
  slPrice: number;
  slippageBps: number;
  extraOneWayStressBps?: number;
  costBreakdown: DhanCostBreakdown;
}): TradeCostAttributionRecord {
  const slip = params.slippageBps / 10_000;
  const execEntry = round2(params.rawEntryPrice * (1 + slip));
  const execExit = round2(params.rawExitPrice * (1 - slip));
  const grossPnl = round2((params.rawExitPrice - params.rawEntryPrice) * params.quantity);
  const buyVal = params.rawEntryPrice * params.quantity;
  const grossRetPct = buyVal > 0 ? round2((grossPnl / buyVal) * 100) : 0;

  const entrySlipInr = round2((execEntry - params.rawEntryPrice) * params.quantity);
  const exitSlipInr = round2((params.rawExitPrice - execExit) * params.quantity);
  const totalSlipInr = round2(entrySlipInr + exitSlipInr);

  const extraStressInr = params.extraOneWayStressBps
    ? round2((buyVal + params.rawExitPrice * params.quantity) * (params.extraOneWayStressBps / 10_000))
    : 0;

  const totalCostInr = round2(params.costBreakdown.totalChargesInr + totalSlipInr + extraStressInr);
  const netPnlInr = round2(grossPnl - totalCostInr);
  const netRetPct = buyVal > 0 ? round2((netPnlInr / buyVal) * 100) : 0;
  const riskPct = execEntry > 0 ? ((execEntry - params.slPrice) / execEntry) * 100 : 1;

  return {
    symbol: params.symbol,
    entryDate: params.entryDate,
    exitDate: params.exitDate,
    segment: params.costBreakdown.segment,
    quantity: params.quantity,
    rawEntryPrice: round2(params.rawEntryPrice),
    rawExitPrice: round2(params.rawExitPrice),
    executableEntryPrice: execEntry,
    executableExitPrice: execExit,
    grossPnlInr: grossPnl,
    grossReturnPct: grossRetPct,
    dhanBrokerageInr: params.costBreakdown.brokerageInr,
    sttInr: params.costBreakdown.sttTotalInr,
    exchangeChargesInr: params.costBreakdown.exchangeChargesInr,
    sebiChargesInr: params.costBreakdown.sebiChargesInr,
    stampDutyInr: params.costBreakdown.stampDutyInr,
    gstInr: round2(params.costBreakdown.gstOnTradingInr + params.costBreakdown.dpChargeGstInr),
    dpChargesInr: params.costBreakdown.dpTotalInr,
    totalDhanAndStatutoryInr: params.costBreakdown.totalChargesInr,
    bidAskSpreadStatus: "MISSING",
    entrySlippageInr: entrySlipInr,
    exitSlippageInr: exitSlipInr,
    totalExecutionSlippageInr: totalSlipInr,
    marketImpactEstimateInr: 0,
    extraStressCostInr: extraStressInr,
    netPnlInr,
    netReturnPct: netRetPct,
    riskPct: round2(riskPct),
    netRMultiple: riskPct > 0 ? round2(netRetPct / riskPct) : 0,
  };
}

