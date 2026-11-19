import type { DailyCandleBar } from "../HistoricalValidationEngine.js";
import { analyzeRelativeStrength, type RelativeStrengthMetrics } from "./Strategy03RelativeStrengthAnalyzer.js";
import { analyzeVolumeMomentum, type VolumeMomentumMetrics } from "./Strategy03VolumeMomentumAnalyzer.js";
import { detectPriceExpansion, type PriceExpansionMetrics } from "./Strategy03PriceExpansionDetector.js";

export type MomentumFilterClassification = "MOMENTUM_WATCHLIST" | "EXTENDED_WAIT" | "WEAK_MOMENTUM";

export interface MomentumStockFilterResult {
  symbol: string;
  sector: string;
  classification: MomentumFilterClassification;
  momentumScore: number; // 0..100 research score
  relativeStrength: RelativeStrengthMetrics;
  volumeMomentum: VolumeMomentumMetrics;
  priceExpansion: PriceExpansionMetrics;
  sectorLeading: boolean;
}

export function filterMomentumStock(params: {
  symbol: string;
  sector: string;
  candles: DailyCandleBar[];
  niftyCandles: DailyCandleBar[];
  sectorLeading?: boolean;
  minTurnoverCr?: number;
}): MomentumStockFilterResult {
  const rs = analyzeRelativeStrength({ candles: params.candles, niftyCandles: params.niftyCandles });
  const vol = analyzeVolumeMomentum(params.candles, params.minTurnoverCr ?? 2.0);
  const exp = detectPriceExpansion(params.candles);
  const sectorLeading = params.sectorLeading ?? true;

  let score = 0;
  if ((rs.rsVsNifty20dPp ?? -99) > 0) score += 15;
  if ((rs.rsVsNifty50dPp ?? -99) > 0) score += 20;
  if (rs.dailyTrendAligned) score += 20;
  if (rs.weeklyTrendAligned) score += 15;
  if (exp.hasRecentBullishExpansion) score += 15;
  if (vol.liquidEnough) score += 10;
  if (sectorLeading) score += 5;

  let classification: MomentumFilterClassification = "WEAK_MOMENTUM";
  if (score >= 60 && vol.liquidEnough && rs.dailyTrendAligned) {
    classification = exp.isOverextended ? "EXTENDED_WAIT" : "MOMENTUM_WATCHLIST";
  }

  return {
    symbol: params.symbol,
    sector: params.sector,
    classification,
    momentumScore: score,
    relativeStrength: rs,
    volumeMomentum: vol,
    priceExpansion: exp,
    sectorLeading,
  };
}

