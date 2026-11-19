import type { OhlcvCandle } from "../entry/EntrySetupTypes.js";
import type { BullishImpulseResult } from "./Strategy03ImpulseDetector.js";

export interface BullishOrderBlockResult {
  detected: boolean;
  obHigh: number | null;
  obLow: number | null;
  timestampIst: string;
  mitigated: boolean;
  invalidated: boolean;
  qualityTier: "HIGH" | "MEDIUM" | "REJECTED";
  reason: string;
}

function toIstIso(utcIso: string): string {
  const ms = Date.parse(utcIso);
  if (!Number.isFinite(ms)) return utcIso;
  return new Date(ms + 330 * 60_000).toISOString().replace("Z", "+05:30");
}

/**
 * Identifies a genuine Bullish Order Block (last bearish candle or validated base before bullish displacement).
 * Rejects arbitrary candles without confirmed displacement.
 */
export function detectBullishOrderBlock(params: {
  completedCandles: OhlcvCandle[];
  impulse: BullishImpulseResult;
}): BullishOrderBlockResult {
  const empty: BullishOrderBlockResult = {
    detected: false,
    obHigh: null,
    obLow: null,
    timestampIst: "",
    mitigated: false,
    invalidated: false,
    qualityTier: "REJECTED",
    reason: "NO_VALID_DISPLACEMENT_FOR_OB",
  };

  if (!params.impulse.detected || params.impulse.startIndex < 1) {
    return empty;
  }

  // Confirm displacement (>= 1.5% expansion or BOS/Sweep)
  if (params.impulse.displacementPct < 1.5 && params.impulse.structureEvidence === "NONE") {
    return empty;
  }

  // Look back up to 3 candles before impulse start for the last bearish candle
  const lookStart = Math.max(0, params.impulse.startIndex - 3);
  const priorSlice = params.completedCandles.slice(lookStart, params.impulse.startIndex);
  const bearish = [...priorSlice].reverse().find((c) => c.close < c.open);
  const obCandle = bearish ?? params.completedCandles[params.impulse.startIndex - 1];
  if (!obCandle) return empty;

  const obHigh = obCandle.high;
  const obLow = obCandle.low;
  const postImpulse = params.completedCandles.slice(params.impulse.endIndex + 1);
  const mitigated = postImpulse.some((c) => c.low <= obHigh && c.close >= obLow);
  const invalidated = postImpulse.some((c) => c.close < obLow);

  const highQuality =
    Boolean(bearish) &&
    (params.impulse.structureEvidence === "LIQUIDITY_SWEEP" ||
      params.impulse.structureEvidence === "BOS_SWING_HIGH");

  return {
    detected: true,
    obHigh,
    obLow,
    timestampIst: toIstIso(obCandle.timestamp),
    mitigated,
    invalidated,
    qualityTier: highQuality ? "HIGH" : "MEDIUM",
    reason: bearish
      ? `BEARISH_CANDLE_BEFORE_${params.impulse.structureEvidence}`
      : `BASE_CANDLE_BEFORE_${params.impulse.structureEvidence}`,
  };
}

