export interface PreBreakoutConfig {
  timeframe: "1H";
  impulseLookbackWindow: number;
  impulseMinBullishCandles: number;
  impulseMaxSpanCandles: number;
  impulseMinBodyExpansion: number;
  impulseMinBodyToRange: number;
  impulseMinRvol: number;
  consolidationMinCandles: number;
  consolidationMaxCandles: number;
  consolidationMaxRangePct: number;
  readyMaxBreakoutDistancePct: number;
  minHistoryCandles: number;
}

export const DEFAULT_PREBREAKOUT_CONFIG: PreBreakoutConfig = {
  timeframe: "1H",
  impulseLookbackWindow: 25,
  impulseMinBullishCandles: 3,
  impulseMaxSpanCandles: 6,
  impulseMinBodyExpansion: 1.35,
  impulseMinBodyToRange: 0.5,
  impulseMinRvol: 1.15,
  consolidationMinCandles: 3,
  consolidationMaxCandles: 10,
  consolidationMaxRangePct: 4.5,
  readyMaxBreakoutDistancePct: 3.5,
  minHistoryCandles: 35,
};

