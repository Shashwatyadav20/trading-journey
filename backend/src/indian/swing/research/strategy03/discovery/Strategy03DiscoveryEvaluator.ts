import type { ExtractedFinancialFactRecord } from "../BseXbrlBackfillService.js";
import type { NormalizedShareholdingRecord } from "../OfficialShareholdingIntelligenceEngine.js";
import {
  filterCandlesAsOf,
  filterFinancialsAsOf,
  filterOwnershipAsOf,
  type DailyCandleBar,
} from "../HistoricalValidationEngine.js";
import {
  evaluateInstitutionalAccumulationHypothesis,
  type DiscoverySignal,
} from "./Strategy03InstitutionalAccumulationResearch.js";
import { evaluatePostEarningsMomentumHypothesis } from "./Strategy03PostEarningsMomentumResearch.js";
import { evaluateRelativeStrengthPullbackHypothesis } from "./Strategy03RelativeStrengthPullbackResearch.js";

export function evaluateAllDiscoveryHypothesesAsOf(params: {
  symbol: string;
  sector: string;
  marketCapCategory: string;
  asOfDate: string;
  financials: ExtractedFinancialFactRecord[];
  ownership: NormalizedShareholdingRecord[];
  candles: DailyCandleBar[];
  benchmarkCandles: DailyCandleBar[];
}): DiscoverySignal[] {
  const pitFins = filterFinancialsAsOf(params.financials, params.asOfDate);
  const pitOwn = filterOwnershipAsOf(params.ownership, params.asOfDate);
  const pitCandles = filterCandlesAsOf(params.candles, params.asOfDate);
  const pitBench = filterCandlesAsOf(params.benchmarkCandles, params.asOfDate);

  return [
    evaluateInstitutionalAccumulationHypothesis({
      symbol: params.symbol,
      sector: params.sector,
      marketCapCategory: params.marketCapCategory,
      asOfDate: params.asOfDate,
      pitFinancials: pitFins,
      pitOwnership: pitOwn,
      pitCandles,
    }),
    evaluatePostEarningsMomentumHypothesis({
      symbol: params.symbol,
      sector: params.sector,
      marketCapCategory: params.marketCapCategory,
      asOfDate: params.asOfDate,
      pitFinancials: pitFins,
      pitCandles,
    }),
    evaluateRelativeStrengthPullbackHypothesis({
      symbol: params.symbol,
      sector: params.sector,
      marketCapCategory: params.marketCapCategory,
      asOfDate: params.asOfDate,
      pitFinancials: pitFins,
      pitCandles,
      pitBenchmarkCandles: pitBench,
    }),
  ];
}

