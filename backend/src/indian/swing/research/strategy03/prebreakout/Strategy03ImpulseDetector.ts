import type { OhlcvCandle } from "../entry/EntrySetupTypes.js";
import { toIstDateAndTime } from "../momentum/Strategy03IntradayEventEvaluator.js";
import { DEFAULT_PREBREAKOUT_CONFIG, type PreBreakoutConfig } from "./Strategy03PreBreakoutConfig.js";

export type ImpulseStructureEvidence =
  | "LIQUIDITY_SWEEP"
  | "BOS_SWING_HIGH"
  | "SUPPORT_ORIGINATED"
  | "NONE";

export interface BullishImpulseResult {
  detected: boolean;
  startIndex: number;
  endIndex: number;
  startIst: string;
  endIst: string;
  candleCount: number;
  bodyExpansionRatio: number;
  avgBodyToRange: number;
  displacementPct: number;
  rvol: number;
  structureEvidence: ImpulseStructureEvidence;
  impulseCandles: OhlcvCandle[];
  reason: string;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

function toIstIso(utcIso: string): string {
  const ms = Date.parse(utcIso);
  if (!Number.isFinite(ms)) return utcIso;
  return new Date(ms + 330 * 60_000).toISOString().replace("Z", "+05:30");
}

export function detectBullishImpulse(
  completedCandles: OhlcvCandle[],
  cfg: PreBreakoutConfig = DEFAULT_PREBREAKOUT_CONFIG
): BullishImpulseResult {
  const empty: BullishImpulseResult = {
    detected: false,
    startIndex: -1,
    endIndex: -1,
    startIst: "",
    endIst: "",
    candleCount: 0,
    bodyExpansionRatio: 0,
    avgBodyToRange: 0,
    displacementPct: 0,
    rvol: 0,
    structureEvidence: "NONE",
    impulseCandles: [],
    reason: "NO_BULLISH_IMPULSE",
  };

  if (completedCandles.length < 25) {
    return { ...empty, reason: "INSUFFICIENT_CANDLES_FOR_IMPULSE" };
  }

  // Search backwards for the most recent strong bullish impulse ending before the current consolidation (leave >= 3 bars after impulse)
  const searchEnd = completedCandles.length - cfg.consolidationMinCandles - 1;
  const searchStart = Math.max(15, completedCandles.length - cfg.impulseLookbackWindow - cfg.consolidationMaxCandles);

  for (let endIdx = searchEnd; endIdx >= searchStart + cfg.impulseMinBullishCandles - 1; endIdx--) {
    const spanStart = Math.max(15, endIdx - cfg.impulseMaxSpanCandles + 1);
    const window = completedCandles.slice(spanStart, endIdx + 1);

    // Baseline avg body & volume from the 15 bars strictly BEFORE spanStart
    const baseSlice = completedCandles.slice(spanStart - 15, spanStart);
    const avgBaseBody = baseSlice.reduce((a, c) => a + Math.abs(c.close - c.open), 0) / 15;
    const avgBaseVol = baseSlice.reduce((a, c) => a + c.volume, 0) / 15;
    if (avgBaseBody <= 0 || avgBaseVol <= 0) continue;

    const strongBullBars = window.filter((c) => {
      const rng = c.high - c.low;
      const body = c.close - c.open;
      return body > 0 && rng > 0 && body / rng >= cfg.impulseMinBodyToRange && body >= avgBaseBody * cfg.impulseMinBodyExpansion;
    });

    if (strongBullBars.length < cfg.impulseMinBullishCandles) continue;

    const firstBullIdx = completedCandles.indexOf(strongBullBars[0]);
    const lastBullIdx = completedCandles.indexOf(strongBullBars[strongBullBars.length - 1]);
    const impSlice = completedCandles.slice(firstBullIdx, lastBullIdx + 1);
    const startLow = Math.min(...impSlice.map((c) => c.low));
    const endClose = impSlice[impSlice.length - 1].close;
    const displacementPct = startLow > 0 ? round2(((endClose - startLow) / startLow) * 100) : 0;
    if (displacementPct < 1.5) continue;

    const avgImpBody = impSlice.reduce((a, c) => a + Math.max(0, c.close - c.open), 0) / impSlice.length;
    const bodyExpansion = round2(avgImpBody / avgBaseBody);
    const avgBodyToRange = round2(
      impSlice.reduce((a, c) => {
        const r = c.high - c.low;
        return a + (r > 0 ? Math.max(0, c.close - c.open) / r : 0);
      }, 0) / impSlice.length
    );
    const avgImpVol = impSlice.reduce((a, c) => a + c.volume, 0) / impSlice.length;
    const rvol = round2(avgImpVol / avgBaseVol);
    if (rvol < cfg.impulseMinRvol) continue;

    // Structure evidence check
    const prior10 = completedCandles.slice(Math.max(0, firstBullIdx - 10), firstBullIdx);
    const priorSwingHigh = prior10.length > 0 ? Math.max(...prior10.map((c) => c.high)) : Infinity;
    const priorSwingLow = prior10.length > 0 ? Math.min(...prior10.map((c) => c.low)) : 0;
    const sweptLow = impSlice[0].low < priorSwingLow && impSlice[0].close > priorSwingLow;

    let structureEvidence: ImpulseStructureEvidence = "SUPPORT_ORIGINATED";
    if (sweptLow) structureEvidence = "LIQUIDITY_SWEEP";
    else if (endClose > priorSwingHigh) structureEvidence = "BOS_SWING_HIGH";

    // Ensure valid IST timestamp conversion
    toIstDateAndTime(impSlice[0].timestamp);

    return {
      detected: true,
      startIndex: firstBullIdx,
      endIndex: lastBullIdx,
      startIst: toIstIso(impSlice[0].timestamp),
      endIst: toIstIso(impSlice[impSlice.length - 1].timestamp),
      candleCount: impSlice.length,
      bodyExpansionRatio: bodyExpansion,
      avgBodyToRange,
      displacementPct,
      rvol,
      structureEvidence,
      impulseCandles: impSlice,
      reason: `BULLISH_IMPULSE_${structureEvidence}`,
    };
  }

  return empty;
}

