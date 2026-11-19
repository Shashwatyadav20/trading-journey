import crypto from "node:crypto";
import { STRATEGY03_FROZEN_SPEC_V61018 } from "./Strategy03FrozenSpec.js";
import { calculateDhanDeliveryCost } from "../costs/Strategy03DhanDeliveryCostCalculator.js";

export interface ForwardSignalRecord {
  id: string;
  signalTimestamp: string;
  symbol: string;
  score: number;
  verificationStatus: string;
  marketRegime: string;
  referenceEntryPrice: number;
  nextExecutableCandlePrice: number | null;
  hypotheticalStopPrice: number;
  hypotheticalTargetPrice: number | null;
  exitTrigger: string | null;
  referenceExitPrice: number | null;
  dhanEstimatedChargesInr: number | null;
  slippageBpsAssumed: number;
  hypotheticalGrossPnlInr: number | null;
  hypotheticalNetPnlInr: number | null;
  isMature: boolean;
  dataQualityFlags: string[];
}

export function isStrictlyForwardTimestamp(tsIso: string, phaseStartIso = STRATEGY03_FROZEN_SPEC_V61018.phaseStartTimestamp): boolean {
  const t = Date.parse(tsIso);
  const s = Date.parse(phaseStartIso);
  if (!Number.isFinite(t) || !Number.isFinite(s)) return false;
  return t > s;
}

export function buildForwardSignalRecord(params: {
  id: string;
  signalTimestamp: string;
  symbol: string;
  score: number;
  verificationStatus: string;
  marketRegime: string;
  referenceEntryPrice: number;
  nextExecutableCandlePrice: number | null;
  hypotheticalStopPrice: number;
  hypotheticalTargetPrice: number | null;
  exitTrigger: string | null;
  referenceExitPrice: number | null;
  notionalInr?: number;
  slippageBps?: number;
  dataQualityFlags?: string[];
}): ForwardSignalRecord {
  const notional = params.notionalInr ?? 100_000;
  const slipBps = params.slippageBps ?? 8;
  const isMature = params.referenceExitPrice !== null && params.nextExecutableCandlePrice !== null;

  let dhanCharges: number | null = null;
  let grossPnl: number | null = null;
  let netPnl: number | null = null;

  if (isMature && params.nextExecutableCandlePrice! > 0) {
    const qty = Math.max(1, Math.floor(notional / params.nextExecutableCandlePrice!));
    const buyExec = params.nextExecutableCandlePrice! * (1 + slipBps / 10_000);
    const sellExec = params.referenceExitPrice! * (1 - slipBps / 10_000);
    const cost = calculateDhanDeliveryCost({ buyPriceInr: buyExec, sellPriceInr: sellExec, quantity: qty });
    dhanCharges = cost.totalChargesInr;
    grossPnl = Math.round((params.referenceExitPrice! - params.nextExecutableCandlePrice!) * qty * 100) / 100;
    const slipCost = Math.round(((buyExec - params.nextExecutableCandlePrice!) + (params.referenceExitPrice! - sellExec)) * qty * 100) / 100;
    netPnl = Math.round((grossPnl - dhanCharges - slipCost) * 100) / 100;
  }

  return {
    id: params.id,
    signalTimestamp: params.signalTimestamp,
    symbol: params.symbol,
    score: params.score,
    verificationStatus: params.verificationStatus,
    marketRegime: params.marketRegime,
    referenceEntryPrice: params.referenceEntryPrice,
    nextExecutableCandlePrice: params.nextExecutableCandlePrice,
    hypotheticalStopPrice: params.hypotheticalStopPrice,
    hypotheticalTargetPrice: params.hypotheticalTargetPrice,
    exitTrigger: params.exitTrigger,
    referenceExitPrice: params.referenceExitPrice,
    dhanEstimatedChargesInr: dhanCharges,
    slippageBpsAssumed: slipBps,
    hypotheticalGrossPnlInr: grossPnl,
    hypotheticalNetPnlInr: netPnl,
    isMature,
    dataQualityFlags: params.dataQualityFlags ?? [],
  };
}

export function computeLedgerChecksum(payload: unknown): string {
  return crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

