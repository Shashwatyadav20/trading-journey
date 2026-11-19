import type { OhlcvCandle } from "../entry/EntrySetupTypes.js";

export type DojiPatternType =
  | "CLASSIC_DOJI"
  | "LONG_LEGGED_DOJI"
  | "DRAGONFLY_DOJI"
  | "GRAVESTONE_DOJI"
  | "SPINNING_TOP"
  | "SMALL_BODY"
  | "NONE";

export interface DojiDetectionResult {
  pattern: DojiPatternType;
  isIndecisionOrSmallBody: boolean;
  bodyToRangeRatio: number;
  upperWickRatio: number;
  lowerWickRatio: number;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

export function detectDojiPattern(candle: OhlcvCandle): DojiDetectionResult {
  const range = candle.high - candle.low;
  if (range <= 0) {
    return {
      pattern: "NONE",
      isIndecisionOrSmallBody: false,
      bodyToRangeRatio: 1,
      upperWickRatio: 0,
      lowerWickRatio: 0,
    };
  }
  const body = Math.abs(candle.close - candle.open);
  const upperWick = candle.high - Math.max(candle.open, candle.close);
  const lowerWick = Math.min(candle.open, candle.close) - candle.low;

  const bodyRatio = round2(body / range);
  const upperRatio = round2(upperWick / range);
  const lowerRatio = round2(lowerWick / range);

  let pattern: DojiPatternType = "NONE";
  if (bodyRatio <= 0.12) {
    if (lowerRatio >= 0.6 && upperRatio <= 0.2) pattern = "DRAGONFLY_DOJI";
    else if (upperRatio >= 0.6 && lowerRatio <= 0.2) pattern = "GRAVESTONE_DOJI";
    else if (upperRatio >= 0.35 && lowerRatio >= 0.35) pattern = "LONG_LEGGED_DOJI";
    else pattern = "CLASSIC_DOJI";
  } else if (bodyRatio <= 0.28 && upperRatio >= 0.25 && lowerRatio >= 0.25) {
    pattern = "SPINNING_TOP";
  } else if (bodyRatio <= 0.35) {
    pattern = "SMALL_BODY";
  }

  return {
    pattern,
    isIndecisionOrSmallBody: pattern !== "NONE",
    bodyToRangeRatio: bodyRatio,
    upperWickRatio: upperRatio,
    lowerWickRatio: lowerRatio,
  };
}

