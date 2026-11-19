import type { ExtractedFinancialFactRecord } from "../BseXbrlBackfillService.js";
import type { NormalizedShareholdingRecord } from "../OfficialShareholdingIntelligenceEngine.js";
import type { DailyCandleBar } from "../HistoricalValidationEngine.js";

export interface DiscoverySignal {
  hypothesis: "H1_INSTITUTIONAL_ACCUMULATION" | "H2_POST_EARNINGS_MOMENTUM" | "H3_RS_PULLBACK";
  symbol: string;
  sector: string;
  marketCapCategory: string;
  signalDate: string;
  publicationTimestamp: string;
  eligible: boolean;
  waitReason: string | null;
  entryRefClose: number | null;
  structuralStopLoss: number | null;
  target1: number | null;
  target2: number | null;
  evidence: {
    sourceNames: string[];
    reportingPeriods: string[];
    verificationStatuses: string[];
  };
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

/**
 * Hypothesis 1: Verified earnings growth + verified FII/MF accumulation + pledge check + price/vol confirmation.
 * Missing ownership or financial data strictly produces eligible=false (WAIT).
 */
export function evaluateInstitutionalAccumulationHypothesis(params: {
  symbol: string;
  sector: string;
  marketCapCategory: string;
  asOfDate: string;
  pitFinancials: ExtractedFinancialFactRecord[];
  pitOwnership: NormalizedShareholdingRecord[];
  pitCandles: DailyCandleBar[];
}): DiscoverySignal {
  const verifiedFins = params.pitFinancials.filter((f) => f.verificationStatus === "VERIFIED");
  const verifiedOwn = params.pitOwnership.filter((o) => o.verificationStatus === "VERIFIED");

  if (verifiedFins.length < 2 || verifiedOwn.length < 1 || params.pitCandles.length < 50) {
    return {
      hypothesis: "H1_INSTITUTIONAL_ACCUMULATION",
      symbol: params.symbol,
      sector: params.sector,
      marketCapCategory: params.marketCapCategory,
      signalDate: params.asOfDate,
      publicationTimestamp: params.asOfDate,
      eligible: false,
      waitReason: "MISSING_VERIFIED_FINANCIAL_OR_OWNERSHIP_OR_CANDLES",
      entryRefClose: null,
      structuralStopLoss: null,
      target1: null,
      target2: null,
      evidence: { sourceNames: [], reportingPeriods: [], verificationStatuses: ["WAIT"] },
    };
  }

  const latestFin = verifiedFins[verifiedFins.length - 1];
  const prevFin = verifiedFins[verifiedFins.length - 2];
  const revGrowth =
    latestFin.revenueCr !== null && prevFin.revenueCr !== null && prevFin.revenueCr > 0
      ? (latestFin.revenueCr - prevFin.revenueCr) / prevFin.revenueCr
      : null;
  const patGrowth =
    latestFin.netProfitCr !== null && prevFin.netProfitCr !== null && prevFin.netProfitCr > 0
      ? (latestFin.netProfitCr - prevFin.netProfitCr) / prevFin.netProfitCr
      : null;

  const latestOwn = verifiedOwn[verifiedOwn.length - 1];
  const hasInstAccum =
    (latestOwn.fiiQoqChangePp !== null && latestOwn.fiiQoqChangePp > 0.1) ||
    (latestOwn.diiQoqChangePp !== null && latestOwn.diiQoqChangePp > 0.1) ||
    (latestOwn.mfQoqChangePp !== null && latestOwn.mfQoqChangePp > 0.1);
  const pledgeOk = latestOwn.promoterPledgedPct === null || latestOwn.promoterPledgedPct <= 10;

  const lastBar = params.pitCandles[params.pitCandles.length - 1];
  const sma50 = params.pitCandles.slice(-50).reduce((a, c) => a + c.adjClose, 0) / 50;
  const avgVol20 = params.pitCandles.slice(-21, -1).reduce((a, c) => a + c.volume, 0) / 20;
  const priceVolOk = lastBar.adjClose > sma50 && avgVol20 > 0 && lastBar.volume >= avgVol20 * 1.1;

  const passed =
    revGrowth !== null &&
    revGrowth > 0.05 &&
    patGrowth !== null &&
    patGrowth > 0.05 &&
    hasInstAccum &&
    pledgeOk &&
    priceVolOk;

  const sl = round2(Math.min(lastBar.low * 0.98, sma50 * 0.97));
  const risk = lastBar.close - sl;

  return {
    hypothesis: "H1_INSTITUTIONAL_ACCUMULATION",
    symbol: params.symbol,
    sector: params.sector,
    marketCapCategory: params.marketCapCategory,
    signalDate: params.asOfDate,
    publicationTimestamp: latestOwn.publicationTimestamp ?? latestOwn.filingDate ?? params.asOfDate,
    eligible: passed && risk > 0,
    waitReason: passed ? null : "HYPOTHESIS_1_CRITERIA_NOT_MET",
    entryRefClose: lastBar.close,
    structuralStopLoss: sl,
    target1: risk > 0 ? round2(lastBar.close + risk * 1.5) : null,
    target2: risk > 0 ? round2(lastBar.close + risk * 3.0) : null,
    evidence: {
      sourceNames: [latestFin.sourceName, latestOwn.sourceName],
      reportingPeriods: [latestFin.reportingPeriod, latestOwn.reportingQuarter],
      verificationStatuses: [latestFin.verificationStatus, latestOwn.verificationStatus],
    },
  };
}

