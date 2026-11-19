import type { ExtractedFinancialFactRecord } from "../BseXbrlBackfillService.js";
import type { DailyCandleBar } from "../HistoricalValidationEngine.js";
import type { DiscoverySignal } from "./Strategy03InstitutionalAccumulationResearch.js";

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

/**
 * Hypothesis 3: Relative Strength Leader + Healthy Pullback.
 * - Outperforms NIFTY 50 over 20D, 60D, and 120D
 * - Uptrend aligned (close > 50-SMA > 200-SMA)
 * - Healthy pullback toward 20-SMA (not extended > 5% above 20-SMA) with volume contraction & bullish reversal
 */
export function evaluateRelativeStrengthPullbackHypothesis(params: {
  symbol: string;
  sector: string;
  marketCapCategory: string;
  asOfDate: string;
  pitFinancials: ExtractedFinancialFactRecord[];
  pitCandles: DailyCandleBar[];
  pitBenchmarkCandles: DailyCandleBar[];
}): DiscoverySignal {
  const verifiedFins = params.pitFinancials.filter((f) => f.verificationStatus === "VERIFIED");
  const c = params.pitCandles;
  const b = params.pitBenchmarkCandles;

  if (verifiedFins.length < 1 || c.length < 125 || b.length < 125) {
    return {
      hypothesis: "H3_RS_PULLBACK",
      symbol: params.symbol,
      sector: params.sector,
      marketCapCategory: params.marketCapCategory,
      signalDate: params.asOfDate,
      publicationTimestamp: params.asOfDate,
      eligible: false,
      waitReason: "INSUFFICIENT_RS_OR_FUNDAMENTAL_HISTORY",
      entryRefClose: null,
      structuralStopLoss: null,
      target1: null,
      target2: null,
      evidence: { sourceNames: [], reportingPeriods: [], verificationStatuses: ["WAIT"] },
    };
  }

  const rsOutperforms = (days: number) => {
    const sRet = c[c.length - 1].adjClose / c[c.length - 1 - days].adjClose - 1;
    const bRet = b[b.length - 1].adjClose / b[b.length - 1 - days].adjClose - 1;
    return sRet > bRet;
  };

  const rsLeader = rsOutperforms(20) && rsOutperforms(60) && rsOutperforms(120);
  const last = c[c.length - 1];
  const prev = c[c.length - 2];
  const sma20 = c.slice(-20).reduce((a, x) => a + x.adjClose, 0) / 20;
  const sma50 = c.slice(-50).reduce((a, x) => a + x.adjClose, 0) / 50;
  const sma200 = c.length >= 200 ? c.slice(-200).reduce((a, x) => a + x.adjClose, 0) / 200 : sma50;

  const uptrend = last.adjClose > sma50 && sma50 > sma200;
  const nearPullbackZone = last.adjClose >= sma20 * 0.97 && last.adjClose <= sma20 * 1.03;
  const avgVol20 = c.slice(-21, -1).reduce((a, x) => a + x.volume, 0) / 20;
  const priorPullbackLowVol = avgVol20 > 0 && prev.volume <= avgVol20 * 1.05;
  const bullishReversal = last.close > last.open && last.close > prev.high;

  const passed = rsLeader && uptrend && nearPullbackZone && priorPullbackLowVol && bullishReversal;
  const sl = round2(Math.min(last.low, prev.low, sma50 * 0.985));
  const risk = last.close - sl;
  const latestFin = verifiedFins[verifiedFins.length - 1];

  return {
    hypothesis: "H3_RS_PULLBACK",
    symbol: params.symbol,
    sector: params.sector,
    marketCapCategory: params.marketCapCategory,
    signalDate: params.asOfDate,
    publicationTimestamp: latestFin.filingDate ?? latestFin.reportingPeriod,
    eligible: passed && risk > 0,
    waitReason: passed ? null : "HYPOTHESIS_3_CRITERIA_NOT_MET",
    entryRefClose: last.close,
    structuralStopLoss: sl,
    target1: risk > 0 ? round2(last.close + risk * 1.5) : null,
    target2: risk > 0 ? round2(last.close + risk * 3.0) : null,
    evidence: {
      sourceNames: [latestFin.sourceName, "YAHOO_5Y_ADJUSTED_RS"],
      reportingPeriods: [latestFin.reportingPeriod],
      verificationStatuses: [latestFin.verificationStatus],
    },
  };
}

