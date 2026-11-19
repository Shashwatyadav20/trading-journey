import type { ExtractedFinancialFactRecord } from "../BseXbrlBackfillService.js";
import type { DailyCandleBar } from "../HistoricalValidationEngine.js";
import type { DiscoverySignal } from "./Strategy03InstitutionalAccumulationResearch.js";

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

/**
 * Hypothesis 2: Post-Earnings Momentum.
 * Triggers ONLY within 5 trading days AFTER official quarterly results publication timestamp,
 * requiring YoY/QoQ revenue & net profit growth + positive post-results closing strength & volume expansion.
 * Never fabricates consensus estimates.
 */
export function evaluatePostEarningsMomentumHypothesis(params: {
  symbol: string;
  sector: string;
  marketCapCategory: string;
  asOfDate: string;
  pitFinancials: ExtractedFinancialFactRecord[];
  pitCandles: DailyCandleBar[];
}): DiscoverySignal {
  const verifiedFins = params.pitFinancials.filter((f) => f.verificationStatus === "VERIFIED");
  if (verifiedFins.length < 2 || params.pitCandles.length < 25) {
    return {
      hypothesis: "H2_POST_EARNINGS_MOMENTUM",
      symbol: params.symbol,
      sector: params.sector,
      marketCapCategory: params.marketCapCategory,
      signalDate: params.asOfDate,
      publicationTimestamp: params.asOfDate,
      eligible: false,
      waitReason: "MISSING_VERIFIED_EARNINGS_OR_CANDLES",
      entryRefClose: null,
      structuralStopLoss: null,
      target1: null,
      target2: null,
      evidence: { sourceNames: [], reportingPeriods: [], verificationStatuses: ["WAIT"] },
    };
  }

  const latestFin = verifiedFins[verifiedFins.length - 1];
  const prevFin = verifiedFins[verifiedFins.length - 2];
  const pubDate = (latestFin.filingDate ?? latestFin.reportingPeriod).slice(0, 10);
  const daysSincePub = (Date.parse(params.asOfDate) - Date.parse(pubDate)) / 86400_000;

  const withinPostEarningsWindow = daysSincePub >= 0 && daysSincePub <= 7;
  const revGrowth =
    latestFin.revenueCr !== null && prevFin.revenueCr !== null && prevFin.revenueCr > 0
      ? (latestFin.revenueCr - prevFin.revenueCr) / prevFin.revenueCr
      : null;
  const patGrowth =
    latestFin.netProfitCr !== null && prevFin.netProfitCr !== null && prevFin.netProfitCr > 0
      ? (latestFin.netProfitCr - prevFin.netProfitCr) / prevFin.netProfitCr
      : null;

  const lastBar = params.pitCandles[params.pitCandles.length - 1];
  const prevBar = params.pitCandles[params.pitCandles.length - 2];
  const avgVol20 = params.pitCandles.slice(-21, -1).reduce((a, c) => a + c.volume, 0) / 20;
  const range = lastBar.high - lastBar.low;
  const closeStrength = range > 0 ? (lastBar.close - lastBar.open) / range : 0;
  const momentumOk =
    lastBar.close > prevBar.close * 1.01 &&
    closeStrength >= 0.45 &&
    avgVol20 > 0 &&
    lastBar.volume >= avgVol20 * 1.3;

  const passed =
    withinPostEarningsWindow &&
    revGrowth !== null &&
    revGrowth > 0.05 &&
    patGrowth !== null &&
    patGrowth > 0.08 &&
    momentumOk;

  const sl = round2(Math.min(lastBar.low, prevBar.low) * 0.99);
  const risk = lastBar.close - sl;

  return {
    hypothesis: "H2_POST_EARNINGS_MOMENTUM",
    symbol: params.symbol,
    sector: params.sector,
    marketCapCategory: params.marketCapCategory,
    signalDate: params.asOfDate,
    publicationTimestamp: pubDate,
    eligible: passed && risk > 0,
    waitReason: passed ? null : "HYPOTHESIS_2_CRITERIA_NOT_MET",
    entryRefClose: lastBar.close,
    structuralStopLoss: sl,
    target1: risk > 0 ? round2(lastBar.close + risk * 1.5) : null,
    target2: risk > 0 ? round2(lastBar.close + risk * 3.0) : null,
    evidence: {
      sourceNames: [latestFin.sourceName],
      reportingPeriods: [latestFin.reportingPeriod],
      verificationStatuses: [latestFin.verificationStatus],
    },
  };
}

