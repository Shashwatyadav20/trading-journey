import type { MomentumStockFilterResult } from "./Strategy03MomentumStockFilter.js";
import type { MomentumBreakoutEvaluation } from "./Strategy03MomentumBreakoutEntry.js";

export interface Strategy03WatchlistItem {
  symbol: string;
  fundamentalScore: number;
  momentumClassification: MomentumStockFilterResult["classification"];
  relativeStrength50dPp: number | null;
  volumeRatio20d: number | null;
  consolidationStatus: string;
  dojiStatus: string;
  breakoutLevel: number | null;
  setupStatus: string;
  verificationStatus: string;
}

export function buildStrategy03MomentumWatchlist(params: {
  symbol: string;
  fundamentalScore: number;
  verificationStatus: string;
  momentum: MomentumStockFilterResult;
  dojiBreakout: MomentumBreakoutEvaluation;
}): Strategy03WatchlistItem {
  return {
    symbol: params.symbol,
    fundamentalScore: params.fundamentalScore,
    momentumClassification: params.momentum.classification,
    relativeStrength50dPp: params.momentum.relativeStrength.rsVsNifty50dPp,
    volumeRatio20d: params.momentum.volumeMomentum.relativeVolume20d,
    consolidationStatus: params.dojiBreakout.consolidation.detected
      ? `TIGHT_${params.dojiBreakout.consolidation.windowCandles}C (${params.dojiBreakout.consolidation.rangePct}%)`
      : "NONE",
    dojiStatus: params.dojiBreakout.consolidation.latestDojiPattern,
    breakoutLevel: params.dojiBreakout.consolidation.consolidationHigh,
    setupStatus:
      params.verificationStatus !== "VERIFIED"
        ? "WAIT"
        : params.dojiBreakout.status,
    verificationStatus: params.verificationStatus,
  };
}

